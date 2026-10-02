import { expect, test } from 'vitest';
import type { WorldContext } from 'cortico/world.ts';
import { SURFING } from '../src/definition.ts';
import { SurfingWorld } from '../src/world.ts';
import { SURFING_DEFAULTS, type SurfingConfigSection } from '../src/config.ts';
import { estimateTokens } from '../src/tokens.ts';
import { PublicClient } from '../src/network.ts';
import { PlatformFixture } from './platform-fixture.ts';

class FixtureClient extends PublicClient {
  constructor(readonly fixture: PlatformFixture) { super(); }
  override operation() { return this.fixture; }
}
function result(outcome: Awaited<ReturnType<ReturnType<SurfingWorld['tools']>[number]['handler']>>) {
  return JSON.parse(typeof outcome==='string'?outcome:outcome.text);
}

function context(): WorldContext<SurfingConfigSection> {
  return { id: 'surfing', cfg: structuredClone(SURFING_DEFAULTS), timezone: 'UTC', botName: 'test',
    botDir: '.', packageDir: '.', dataDir: '.', repoRoot: '.', secret() { throw new Error('credentials must not be read'); },
    storeSecret() { throw new Error('credentials must not be stored'); }, persist() {}, async restart() {} };
}

test('独立 World 在没有 learn 或凭证时提供工具与可调面板', () => {
  const world = new SurfingWorld(context());
  expect(world.tools().map(x=>x.name)).toEqual(['surfing_read_page','surfing_read_bili','surfing_search_bili']);
  const groups = world.console().config!;
  const fields = groups.flatMap(group => Object.keys(group.schema.properties));
  expect(fields).toContain('worlds.surfing.reading.maxResponseEstimatedTokens');
  expect(fields.some(field => /login|cookie|apiKey|summaryModel/i.test(field))).toBe(false);
  const first = SURFING.defaults(), second = SURFING.defaults();
  first.reading.maxResponseEstimatedTokens = 1024;
  expect(second.reading.maxResponseEstimatedTokens).toBe(SURFING_DEFAULTS.reading.maxResponseEstimatedTokens);
});

test('错误回执也受完整返回上限约束', async () => {
  const ctx = context(); ctx.cfg.reading.maxResponseEstimatedTokens = 1024;
  const world = new SurfingWorld(ctx);
  const tool = world.tools()[0];
  const outcome = await tool.handler({ url: 'http://localhost/' }, { role: 'test', log: {} as never });
  const result = typeof outcome === 'string' ? { text: outcome } : outcome;
  expect(JSON.parse(result.text).status).toBe('address_denied');
  expect(estimateTokens(result.text)).toBeLessThanOrEqual(ctx.cfg.reading.maxResponseEstimatedTokens);
});

test('World 热调返回量后沿原位置续读，续读不访问平台', async () => {
  const ctx = context(); ctx.cfg.reading.maxResponseEstimatedTokens = 1024;
  const fixture = new PlatformFixture(); fixture.subtitleTail = '原文🌌'.repeat(2000);
  const world = new SurfingWorld(ctx,new FixtureClient(fixture));
  const tool = world.tools()[1]; const call = {role:'test',log:{} as never};
  let receipt = result(await tool.handler({bvid:'BV1aa411a7aa'},call));
  let content = receipt.content; expect(receipt.hasMore).toBe(true);
  expect(receipt.estimatedTokens).toBeLessThanOrEqual(ctx.cfg.reading.maxResponseEstimatedTokens);
  fixture.offline = true;
  ctx.cfg.reading.maxResponseEstimatedTokens = 2048; ctx.cfg.bili.subtitleGroupSec = 1;
  while(receipt.nextCursor) {
    receipt = result(await tool.handler({bvid:'BV1aa411a7aa',cursor:receipt.nextCursor},call));
    expect(receipt.status).toBe('ok'); expect(receipt.scope.subtitleGroupSec).toBe(SURFING_DEFAULTS.bili.subtitleGroupSec);
    expect(receipt.estimatedTokens).toBeLessThanOrEqual(ctx.cfg.reading.maxResponseEstimatedTokens);
    content += receipt.content;
  }
  expect(content).toBe('[00:00–00:01] 开头。\n\n[00:31–00:32] '+fixture.subtitleTail+'\n\n');
  await world.stop();
});

test('搜索仅在跨远端页时请求平台，重放边界游标返回相同材料', async () => {
  const fixture = new PlatformFixture(); const world = new SurfingWorld(context(),new FixtureClient(fixture));
  const tool = world.tools()[2]; const call = {role:'test',log:{} as never};
  const first = result(await tool.handler({query:'竞赛'},call));
  const second = result(await tool.handler({query:'竞赛',cursor:first.nextCursor},call));
  expect(first.results[0].title).toContain('第1页'); expect(second.results[0].title).toContain('第2页');
  expect(second.hasMore).toBe(false);
  fixture.offline = true;
  const replay = result(await tool.handler({query:'竞赛',cursor:first.nextCursor},call));
  expect(replay).toEqual(second); expect(fixture.searchPages).toEqual([1,2]);
  await world.stop();
});
