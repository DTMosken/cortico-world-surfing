/** Cursors authenticate an immutable source snapshot and a position, never a page number. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SurfingConfigSection } from './config.ts';
import { ReadError } from './network.ts';

export type RecordValue = Record<string, string | number | boolean>;
export type Unit = { kind: 'text'; text: string; startSec?: number; endSec?: number }
  | { kind: 'part' | 'result'; value: RecordValue };
export interface Material {
  kind: 'page' | 'bili' | 'search'; key: string; source: string; title: string;
  scope: Record<string, string | number | boolean>;
  units: Unit[];
  sourceTruncated?: boolean; truncationReason?: string;
  nextSearchPage?: number;
  sentenceTimes?: Array<{ from: number; to: number }>;
  metadataTruncated?: string[];
}
interface Snapshot { material: Material; size: number; expiresAtMs: number; nextSearchCursor?: string }
interface Position { id: string; unit: number; offset: number }
export interface PageResult {
  text: string; hasMore: boolean; sourceTruncated: boolean; estimatedTokens: number;
  nextCursor?: string; failed?: true;
}

/** Adapted from Cortico src/protocol/open-responses/tokens.ts, MIT, Phantivia. */
export function estimateTokens(text: string): number {
  let weighted = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    weighted += ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3000 && code <= 0x30ff)
      || (code >= 0xff00 && code <= 0xffef)) ? 6 : 3;
  }
  return Math.ceil(weighted / 10);
}

const clip = (value: string, count: number) => [...value].slice(0, count).join('');
const line = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
function recordText(unit: Exclude<Unit, { kind: 'text' }>): string {
  const value = unit.value;
  return unit.kind === 'part' ? `P${value.page}：${line(value.title)}（cid: ${value.cid}）\n`
    : `${line(value.title)}\nBV: ${value.bvid}；UP主：${line(value.author)}；时长：${line(value.duration)}\n\n`;
}

export class SnapshotCache {
  private readonly signingKey = randomBytes(32);
  private readonly snapshots = new Map<string, Snapshot>();
  private bytes = 0;
  constructor(private readonly now: () => number = Date.now) {}

  clear(): void { this.snapshots.clear(); this.bytes = 0; }
  get sizeBytes(): number { return this.bytes; }

  put(input: Material, config: SurfingConfigSection): string {
    this.trim(config.cache.maxBytes);
    const material = structuredClone(input);
    let remaining = config.reading.maxSourceChars;
    const units: Unit[] = [];
    for (const unit of material.units) {
      const source = unit.kind === 'text' ? unit.text : JSON.stringify(unit.value);
      const chars = [...source];
      if (chars.length > remaining) {
        if (unit.kind === 'text' && remaining > 0) units.push({ ...unit, text: chars.slice(0, remaining).join('') });
        material.sourceTruncated = true;
        material.truncationReason = 'source_chars';
        break;
      }
      units.push(unit);
      remaining -= chars.length;
    }
    material.units = units;
    const metadataTruncated: string[] = [];
    if ([...material.title].length > 100) metadataTruncated.push('title');
    material.title = clip(material.title, 100);
    const scope = Object.entries(material.scope);
    if (scope.length > 20) metadataTruncated.push('scope');
    material.scope = Object.fromEntries(scope.slice(0,20).map(([key,value])=>{
      if (typeof value !== 'string') return [key,value];
      const limited = clip(value,key==='query'?240:120);
      if (limited !== value) metadataTruncated.push('scope.'+key);
      return [key,limited];
    }));
    if (metadataTruncated.length) material.metadataTruncated = metadataTruncated;
    const size = Buffer.byteLength(JSON.stringify(material));
    if (size > config.cache.maxBytes) throw new ReadError('source_limit', '单份材料超出文本缓存上限，无法保存续读快照。');
    this.trim(config.cache.maxBytes - size);
    const id = randomBytes(12).toString('hex');
    this.snapshots.set(id, {
      material, size, expiresAtMs: this.now() + config.cache.ttlMs,
    });
    this.bytes += size;
    return this.encode({ id, unit: 0, offset: 0 });
  }

  read(cursor: string, expectedKey: string, config: SurfingConfigSection): PageResult {
    this.trim(config.cache.maxBytes);
    const start = this.decode(cursor);
    const snapshot = this.snapshots.get(start.id);
    if (!snapshot) throw new ReadError('cursor_expired', '续读快照已到期或被释放，请重新读取。');
    if (snapshot.material.key !== expectedKey) throw new ReadError('cursor_mismatch', '游标与本次工具、目标或分P不匹配，请沿用原调用参数。');
    this.snapshots.delete(start.id);
    this.snapshots.set(start.id, snapshot);
    const { material } = snapshot;
    const scope = material.scope;
    const header = [material.kind === 'bili' ? `视频：${line(material.title)}`
      : material.kind === 'search' ? `B站搜索：${line(scope.query)}（第${scope.page}页）` : `网页：${line(material.title)}`];
    if (material.kind === 'bili') header.push(`P${scope.page}：${line(scope.part)}；UP主：${line(scope.author)}；${scope.isAi ? 'AI' : '人工'}字幕（${line(scope.language)}）`);
    if (scope.kind === 'web-section') header.push(`章节：${line(scope.anchor)}`);
    const notices: string[] = [];
    if (material.metadataTruncated?.some(name => ['title', 'scope.part', 'scope.author', 'scope.query'].includes(name)))
      notices.push('标题信息已截短。');
    if (material.sourceTruncated) notices.push(material.truncationReason === 'rendering_unavailable'
      ? `仅取得静态网页文本，渲染未完成：${line(scope.renderingReason)}。`
      : '材料触及保留上限，剩余内容未保留。');
    let content = material.kind === 'search' && !material.units.length && !material.sourceTruncated ? '未找到匹配的视频。' : '';
    let failure: string | undefined;
    const current = { ...start };
    const hasMore = () => current.unit < material.units.length || (!!material.nextSearchPage && !material.sourceTruncated);
    const finish = () => {
      const footer = [...notices, ...(hasMore() ? [`续读 cursor: ${this.encode(current)}`] : [])];
      const title = failure ? '[tool failed] ' + failure : header.join('\n');
      return title + '\n\n' + content + (footer.length ? '\n\n' + footer.join('\n') : '');
    };
    const cap = config.reading.maxResponseEstimatedTokens;
    if (estimateTokens(finish()) > cap) throw new ReadError('source_limit', '来源信息超过返回上限，无法生成完整回执。');
    while (current.unit < material.units.length) {
      const unit = material.units[current.unit];
      if (unit.kind !== 'text') {
        const previous = content;
        content += recordText(unit);
        current.unit++;
        if (estimateTokens(finish()) > cap) {
          content = previous; current.unit--;
          if (current.unit === start.unit && current.offset === start.offset) {
            failure = '单条记录超出返回上限；提高配置后用此游标继续。';
          }
          break;
        }
        continue;
      }
      const chars = [...unit.text];
      if (!chars.length) { current.unit++; current.offset = 0; continue; }
      const previous = content;
      const previousOffset = current.offset;
      const previousUnit = current.unit;
      let low = 0, high = Math.min(chars.length - previousOffset, cap * 4);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        content = previous + chars.slice(previousOffset, previousOffset + middle).join('');
        current.offset = previousOffset + middle;
        if (current.offset === chars.length) { current.unit++; current.offset = 0; }
        if (estimateTokens(finish()) <= cap) low = middle; else high = middle - 1;
        current.unit = previousUnit;
        current.offset = previousOffset;
      }
      let taken = low;
      if (previousOffset + taken < chars.length) {
        const text = chars.slice(previousOffset, previousOffset + taken).join('');
        const boundary = text.lastIndexOf('\n\n');
        if (boundary >= 0) {
          const length = [...text.slice(0, boundary + 2)].length;
          if (length >= taken * 0.8) taken = length;
        }
      }
      content = previous + chars.slice(previousOffset, previousOffset + taken).join('');
      current.offset = previousOffset + taken;
      if (!taken) {
        if (current.unit === start.unit && current.offset === start.offset) {
          failure = '返回上限不足以容纳正文；提高配置后用此游标继续。';
        }
      }
      if (current.offset === chars.length) { current.unit++; current.offset = 0; }
      else break;
    }
    const text = finish();
    if (estimateTokens(text) > cap) throw new ReadError('source_limit', '返回信息超过配置上限。');
    return { text, hasMore: hasMore(), ...(hasMore() ? { nextCursor: this.encode(current) } : {}),
      sourceTruncated: material.sourceTruncated ?? false, estimatedTokens: estimateTokens(text), ...(failure ? { failed: true } : {}) };
  }

  nextSearch(cursor: string, expectedKey: string, config: SurfingConfigSection): { page: number; cursor?: string } | undefined {
    this.trim(config.cache.maxBytes);
    const position = this.decode(cursor);
    const snapshot = this.snapshots.get(position.id);
    if (!snapshot) throw new ReadError('cursor_expired', '搜索快照已到期，请重新搜索。');
    if (snapshot.material.key !== expectedKey) throw new ReadError('cursor_mismatch', '游标与搜索词不匹配。');
    if (position.unit === snapshot.material.units.length && snapshot.material.nextSearchPage && !snapshot.material.sourceTruncated) {
      if (snapshot.nextSearchCursor) {
        const child = this.decode(snapshot.nextSearchCursor);
        if (!this.snapshots.has(child.id)) throw new ReadError('cursor_expired', '下一页搜索快照已释放，请重新搜索。');
      }
      return { page: snapshot.material.nextSearchPage, cursor: snapshot.nextSearchCursor };
    }
    return undefined;
  }

  rememberSearchNext(cursor: string, nextCursor: string): void {
    const position = this.decode(cursor);
    const snapshot = this.snapshots.get(position.id);
    if (snapshot) snapshot.nextSearchCursor = nextCursor;
  }

  private trim(maxBytes: number): void {
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.expiresAtMs <= this.now()) { this.bytes -= snapshot.size; this.snapshots.delete(id); }
    }
    while (this.bytes > maxBytes && this.snapshots.size) {
      const [id, snapshot] = this.snapshots.entries().next().value!;
      this.bytes -= snapshot.size; this.snapshots.delete(id);
    }
  }

  private encode(position: Position): string {
    const value = Buffer.from(`${position.id}:${position.unit}:${position.offset}`).toString('base64url');
    return value + '.' + createHmac('sha256', this.signingKey).update(value).digest().subarray(0, 12).toString('base64url');
  }

  private decode(cursor: string): Position {
    if (typeof cursor !== 'string' || cursor.length > 256) throw new ReadError('cursor_expired', '无效的续读游标。');
    const [value, signature] = cursor.split('.');
    const expected = createHmac('sha256', this.signingKey).update(value ?? '').digest().subarray(0, 12);
    const actual = Buffer.from(signature ?? '', 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ReadError('cursor_expired', '无效或其他实例的续读游标。');
    const [id, unit, offset] = Buffer.from(value, 'base64url').toString().split(':');
    return { id, unit: Number(unit), offset: Number(offset) };
  }
}
