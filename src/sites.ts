/** Built-in surf_all sources. Each list keeps upstream order; failures stay inside their own group. */
import type { SurfingConfigSection } from './config.ts';
import type { BiliClient } from './bili.ts';
import { ReadError, asReadError, type ReadOperation } from './network.ts';
import type { Material, TiebaMore, TiebaPost, Unit } from './snapshots.ts';

export const SITE_SOURCES = ['bili', 'tieba', 'moegirl', 'baike'] as const;
type SiteSource = typeof SITE_SOURCES[number];
const LABELS: Record<SiteSource, string> = { bili: 'B站', tieba: '贴吧', moegirl: '萌娘百科', baike: '百度百科' };
const TIEBA_SEARCH = 'https://tieba.baidu.com/mo/q/search/thread';

interface Entry { text: string; url?: string; note?: string }
interface TiebaPage { posts: TiebaPost[]; page: number; hasMore: boolean }
interface Group { label: string; status?: string; entries?: Entry[]; more?: Omit<TiebaMore, 'id'> }

function short(value: unknown, max: number): string {
  const chars = [...String(value ?? '').replace(/\s+/g, ' ').trim()];
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('');
}

async function json(operation: ReadOperation, url: string, referer: string): Promise<any> {
  const response = await operation.get(url, { allowHost: host => host === new URL(referer).hostname, headers: { referer } });
  if (response.status !== 200) throw new ReadError('access_denied', '访问受限。');
  return JSON.parse(response.body.toString('utf8'));
}

async function tiebaPage(query: string, page: number, operation: ReadOperation): Promise<TiebaPage> {
  const result = await json(operation, `${TIEBA_SEARCH}?word=${encodeURIComponent(query)}&pn=${page}`, 'https://tieba.baidu.com/');
  if (result.no !== 0) throw new ReadError('access_denied', '访问受限。');
  return { page: result.data.current_page, hasMore: result.data.has_more === 1,
    posts: result.data.post_list.map((post: Record<string, unknown>) => ({ forum: short(post.forum_name, 30), title: short(post.title, 60),
      summary: short(post.content, 70), url: `https://tieba.baidu.com/mo/m?kz=${post.tid}` })) };
}

function tiebaEntries(query: string, { posts, page, hasMore }: TiebaPage, limit: number): Pick<Group, 'entries' | 'more'> {
  const rest = posts.slice(limit);
  return { entries: posts.slice(0, limit).map(post => ({ text: `· （${post.forum}吧）${post.title}`, url: post.url,
    ...(post.summary ? { note: post.summary } : {}) })),
  ...(rest.length || hasMore ? { more: { query, posts: rest, page, hasMore } } : {}) };
}

function definition(title: unknown, extract: unknown, url: string): Entry[] {
  const summary = short(extract, 120);
  return [{ text: summary ? `${short(title, 60)}：${summary}` : short(title, 60), url }];
}

async function moegirl(query: string, operation: ReadOperation): Promise<Entry[]> {
  const result = await json(operation, 'https://zh.moegirl.org.cn/api.php?action=query&format=json&prop=extracts%7Cinfo'
    + `&inprop=url&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(query)}`, 'https://zh.moegirl.org.cn/');
  const page = Object.values<Record<string, string>>(result.query.pages)[0];
  return 'missing' in page || !page.fullurl ? [] : definition(page.title, page.extract, page.fullurl);
}

async function baike(query: string, operation: ReadOperation): Promise<Entry[]> {
  const result = await json(operation, 'https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020'
    + `&bk_key=${encodeURIComponent(query)}&bk_length=600`, 'https://baike.baidu.com/');
  return result.title ? definition(result.title, result.abstract, result.wapUrl) : [];
}

function material(query: string, title: string, groups: Group[], labelled: boolean): Material {
  const units: Unit[] = [];
  const links: Record<string, string> = {};
  let more: TiebaMore | undefined;
  const add = (text: string, url: string, note = '') => {
    const id = `L${Object.keys(links).length + 1}`;
    links[id] = url;
    const from = [...text].length + 1;
    units.push({ kind: 'text', text: `${text} [${id}]\n${note && `  ${note}\n`}`, links: [{ id, from, to: from + id.length + 2 }] });
    return id;
  };
  groups.forEach((group, index) => {
    if (index) units.push({ kind: 'text', text: '\n' });
    if (group.status) { units.push({ kind: 'text', text: `【${group.label}】${group.status}\n` }); return; }
    if (labelled) units.push({ kind: 'text', text: `【${group.label}】\n` });
    for (const entry of group.entries!) {
      if (entry.url) add(entry.text, entry.url, entry.note);
      else units.push({ kind: 'text', text: entry.text + '\n' });
    }
    if (group.more) more = { ...group.more, id: add('更多贴吧结果',
      `${TIEBA_SEARCH}?word=${encodeURIComponent(group.more.query)}&pn=${group.more.page + 1}`) };
  });
  const last = units.at(-1);
  if (last?.kind === 'text') last.text = last.text.trimEnd();
  return { kind: 'site-search', key: 'site-search:' + query, source: 'surf_all', title, scope: {}, units,
    ...(Object.keys(links).length ? { links } : {}), ...(more ? { more, nextBatch: more.page + 1 } : {}) };
}

export async function searchSites(query: string, requested: unknown, config: SurfingConfigSection['search'],
  bili: BiliClient, operation: ReadOperation): Promise<Material> {
  if (requested !== undefined && (!Array.isArray(requested) || !requested.length || requested.some(source => !SITE_SOURCES.includes(source))))
    throw new ReadError('invalid_input', 'sources 需为 bili、tieba、moegirl、baike 中的一个或多个。');
  const selected = SITE_SOURCES.filter(source => requested ? (requested as unknown[]).includes(source) : config[source]);
  if (!selected.length) throw new ReadError('invalid_input', '所有来源已在配置中关闭。');
  const limit = config.maxResults;
  const load: Record<SiteSource, () => Promise<Pick<Group, 'entries' | 'more'>>> = {
    bili: async () => ({ entries: (await bili.search(query, 1, operation)).units.slice(0, limit).flatMap(unit => unit.kind === 'result'
      ? [{ text: `· ${short(unit.value.title, 60)}｜${short(unit.value.author, 30)}｜${unit.value.duration}｜${unit.value.bvid}` }] : []) }),
    tieba: async () => tiebaEntries(query, await tiebaPage(query, 1, operation), limit),
    moegirl: async () => ({ entries: await moegirl(query, operation) }),
    baike: async () => ({ entries: await baike(query, operation) }),
  };
  const groups = await Promise.all(selected.map(async (source): Promise<Group> => {
    const label = LABELS[source];
    if (!config[source]) return { label, status: '已在配置中关闭。' };
    try {
      const group = await load[source]();
      return group.entries!.length ? { label, ...group } : { label, status: '未找到匹配结果。' };
    } catch (error) { return { label, status: asReadError(error).message }; }
  }));
  return material(query, groups.some(group => group.entries) ? `「${query}」` : '', groups, true);
}

/** Shows unseen posts from the fetched upstream page before requesting the next one. */
export async function continueTieba({ query, posts, page, hasMore }: TiebaMore, limit: number, operation: ReadOperation): Promise<Material> {
  const batch = posts.length ? { posts, page, hasMore } : await tiebaPage(query, page + 1, operation);
  if (!batch.posts.length) return material(query, '', [{ label: LABELS.tieba, status: '没有更多结果。' }], true);
  return material(query, `「${query}」· 贴吧`, [{ label: LABELS.tieba, ...tiebaEntries(query, batch, limit) }], false);
}
