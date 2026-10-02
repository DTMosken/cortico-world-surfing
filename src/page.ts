import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { ReadError } from './errors.ts';
import { validatePublicUrl } from './network.ts';
import type { Material, Unit } from './snapshots.ts';

export function pageKey(input: string): string { return 'page:' + validatePublicUrl(input).href; }

export function extractHtml(html: string, input: string): Material {
  const url = validatePublicUrl(input);
  const dom = new JSDOM(html, { url: url.href });
  const document = dom.window.document;
  try {
    document.querySelectorAll('script,style,noscript,nav,header,footer,form,[hidden],[aria-hidden="true"]').forEach(element => element.remove());
    let root: Element | null = document.querySelector('main,article,[role="main"],#apicontent');
    let section = false;
    if (url.hash) {
      let anchor: string;
      try { anchor = decodeURIComponent(url.hash.slice(1)); }
      catch { throw new ReadError('invalid_input', 'URL 的章节锚点无效。'); }
      const target = document.getElementById(anchor) ?? [...document.querySelectorAll('a[name]')].find(element => element.getAttribute('name') === anchor);
      if (!target) throw new ReadError('content_unavailable', '页面未找到指定锚点；未读取其他章节。');
      const heading = target.closest('h1,h2,h3,h4,h5,h6');
      if (heading) {
        const container = root?.contains(heading) ? root : document.body;
        const level = Number(heading.tagName.slice(1));
        const next = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(element =>
          element !== heading && Number(element.tagName.slice(1)) <= level
          && !!(heading.compareDocumentPosition(element) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING));
        const range = document.createRange();
        range.setStartBefore(heading);
        if (next) range.setEndBefore(next); else range.setEnd(container, container.childNodes.length);
        root = document.createElement('div');
        root.append(range.cloneContents());
      } else root = target;
      section = true;
    }
    if (!root) {
      const article = new Readability(document.cloneNode(true) as Document, { charThreshold: 80, maxElemsToParse: 100000 }).parse();
      if (article?.content) {
        root = document.createElement('div'); root.innerHTML = article.content;
      } else root = document.body;
    }
    const body: Unit[] = [];
    let hasBody = false;
    const pending: Node[] = [root];
    while (pending.length) {
      const node = pending.pop()!;
      const element = node.nodeType === dom.window.Node.ELEMENT_NODE ? node as Element : undefined;
      const block = element?.matches('h1,h2,h3,h4,h5,h6,p,pre,li,table,blockquote');
      if (block || node.nodeType === dom.window.Node.TEXT_NODE) {
        let text = element?.tagName === 'PRE' ? node.textContent?.trim() : node.textContent?.replace(/\s+/g, ' ').trim();
        if (element?.tagName === 'TABLE') text = [...element.querySelectorAll('tr')].map(row =>
          [...row.querySelectorAll('th,td')].map(cell => cell.textContent?.replace(/\s+/g,' ').trim()).join('\t')).join('\n');
        if (!text) continue;
        const heading = !!element && /^H[1-6]$/.test(element.tagName);
        const prefix = heading ? '#'.repeat(Number(element!.tagName.slice(1))) + ' ' : '';
        body.push({ kind: 'text', text: prefix + text + '\n\n' });
        hasBody ||= !heading;
      } else pending.push(...[...node.childNodes].reverse());
    }
    if (!hasBody) throw new ReadError('content_unavailable', '未取得网页正文，可能需要 JavaScript 或页面限制了访问。');
    const links = new Map<string, Unit>();
    for (const element of root.querySelectorAll('a[href]')) {
      const text = element.textContent?.replace(/\s+/g, ' ').trim() || element.getAttribute('aria-label');
      if (!text) continue;
      try {
        const target = validatePublicUrl(new URL(element.getAttribute('href')!, document.baseURI).href);
        links.set(target.href, { kind: 'link', value: { text, url: target.href } });
      } catch { /* Non-public or non-HTTP links remain text and are not offered for opening. */ }
    }
    const outline = [...root.querySelectorAll('h1[id],h2[id],h3[id]')].map(element => {
      const target = new URL(url); target.hash = element.id;
      return { text: element.textContent?.trim() ?? '', url: target.href };
    });
    return { kind: 'page', key: pageKey(input), source: url.href, title: document.title || '网页',
      scope: { kind: section ? 'web-section' : 'web-page', ...(section ? { anchor: url.hash.slice(1) } : {}), extraction: 'html' },
      units: [...body, ...links.values()], outline };
  } finally { dom.window.close(); }
}
