import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { ReadError, validatePublicUrl } from './network.ts';
import type { LinkSpan, Material, Unit } from './snapshots.ts';

export function pageKey(input: string): string { return 'page:' + validatePublicUrl(input).href; }

export function extractHtml(html: string, input: string): Material {
  const url = validatePublicUrl(input);
  const dom = new JSDOM(html, { url: url.href });
  const document = dom.window.document;
  try {
    const hasScripts = !!document.querySelector('script[src],script:not([type]),script[type="module"],script[type="text/javascript"],script[type="application/javascript"]');
    document.querySelectorAll('script,style,noscript,nav,header,footer,form,[hidden],[aria-hidden="true"]').forEach(element => element.remove());
    let root: Element | null = document.querySelector('main,article,[role="main"],#apicontent');
    let section = false;
    if (url.hash) {
      let anchor: string;
      try { anchor = decodeURIComponent(url.hash.slice(1)); }
      catch { throw new ReadError('invalid_input', 'URL 的章节锚点无效。'); }
      const target = document.getElementById(anchor) ?? [...document.querySelectorAll('a[name]')].find(element => element.getAttribute('name') === anchor);
      if (!target) throw new ReadError('content_unavailable', '页面未找到指定锚点；未读取其他章节。');
      const container = root?.contains(target) ? root : document.body;
      const headings = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')];
      const following = headings.find(element=>!!(target.compareDocumentPosition(element)&dom.window.Node.DOCUMENT_POSITION_FOLLOWING));
      let heading = target.closest('h1,h2,h3,h4,h5,h6');
      if (!heading && !target.textContent?.trim() && following) {
        const between = document.createRange(); between.setStartAfter(target); between.setEndBefore(following);
        if (!between.toString().trim()) heading = following;
      }
      if (heading) {
        const level = Number(heading.tagName.slice(1));
        const next = headings.find(element =>
          element !== heading && Number(element.tagName.slice(1)) <= level
          && !!(heading.compareDocumentPosition(element) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING));
        const range = document.createRange();
        range.setStartBefore(heading);
        if (next) range.setEndBefore(next); else range.setEnd(container, container.childNodes.length);
        root = document.createElement('div');
        root.append(range.cloneContents());
      } else if (target.textContent?.trim()) root = target;
      else {
        const range = document.createRange(); range.setStartAfter(target);
        if (following) range.setEndBefore(following); else range.setEnd(container,container.childNodes.length);
        root = document.createElement('div'); root.append(range.cloneContents());
      }
      section = true;
    }
    if (!root) {
      const article = new Readability(document.cloneNode(true) as Document, { charThreshold: 80, maxElemsToParse: 100000 }).parse();
      if (article?.content) {
        root = document.createElement('div'); root.innerHTML = article.content;
      } else root = document.body;
    }
    const links: Record<string, string> = {};
    const markers = new WeakMap<Node, string>();
    const anchors = [...(root.matches('a[href]') ? [root] : []), ...root.querySelectorAll('a[href]')];
    let linkCount = 0;
    for (const anchor of anchors) {
      let target: URL;
      try { target = validatePublicUrl(new URL(anchor.getAttribute('href')!, document.baseURI).href); }
      catch { continue; }
      const id = 'L' + ++linkCount;
      links[id] = target.href;
      if (!anchor.textContent?.trim()) anchor.append(document.createTextNode(
        anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.querySelector('img')?.getAttribute('alt') || '链接'));
      const marker = document.createTextNode(` [${id}]`);
      markers.set(marker, id);
      anchor.append(marker);
    }
    const renderText = (node: Node, preserveWhitespace = false): { text: string; links: LinkSpan[] } => {
      const walker = document.createTreeWalker(node, dom.window.NodeFilter.SHOW_TEXT);
      let current = node.nodeType === dom.window.Node.TEXT_NODE ? node : walker.nextNode();
      let text = '', length = 0;
      const spans: LinkSpan[] = [];
      while (current) {
        let value = current.textContent ?? '';
        if (!preserveWhitespace) {
          value = value.replace(/\s+/g, ' ');
          if (text.endsWith(' ')) value = value.replace(/^ /, '');
        }
        const size = [...value].length;
        const id = markers.get(current);
        if (id) spans.push({ id, from: length + size - id.length - 2, to: length + size });
        text += value; length += size;
        current = walker.nextNode();
      }
      const leading = [...text.match(/^\s*/)![0]].length;
      return { text: text.trim(), links: spans.map(span => ({ ...span, from: span.from - leading, to: span.to - leading })) };
    };
    const body: Unit[] = [];
    let hasBody = false;
    const pending: Node[] = [root];
    while (pending.length) {
      const node = pending.pop()!;
      const element = node.nodeType === dom.window.Node.ELEMENT_NODE ? node as Element : undefined;
      const block = element?.matches('h1,h2,h3,h4,h5,h6,p,pre,li,table,blockquote,a[href]');
      if (block || node.nodeType === dom.window.Node.TEXT_NODE) {
        let rendered = element?.tagName === 'TABLE' ? { text: '', links: [] as LinkSpan[] } : renderText(node, element?.tagName === 'PRE');
        if (element?.tagName === 'TABLE') {
          let length = 0;
          for (const [rowIndex, row] of [...element.querySelectorAll('tr')].entries()) {
            if (rowIndex) { rendered.text += '\n'; length++; }
            for (const [cellIndex, cell] of [...row.querySelectorAll('th,td')].entries()) {
              if (cellIndex) { rendered.text += '\t'; length++; }
              const value = renderText(cell);
              rendered.links.push(...value.links.map(span => ({ ...span, from: span.from + length, to: span.to + length })));
              rendered.text += value.text; length += [...value.text].length;
            }
          }
        }
        if (!rendered.text) continue;
        const heading = !!element && /^H[1-6]$/.test(element.tagName);
        const prefix = heading ? '#'.repeat(Number(element!.tagName.slice(1))) + ' ' : '';
        body.push({ kind: 'text', text: prefix + rendered.text + '\n\n',
          ...(rendered.links.length ? { links: rendered.links.map(span => ({ ...span, from: span.from + prefix.length, to: span.to + prefix.length })) } : {}) });
        hasBody ||= !heading;
      } else pending.push(...[...node.childNodes].reverse());
    }
    if (!hasBody) throw new ReadError('content_unavailable', '未取得网页正文，可能需要 JavaScript 或页面限制了访问。');
    return { kind: 'page', key: pageKey(input), source: url.href, title: document.title || '网页',
      scope: { kind: section ? 'web-section' : 'web-page', ...(section ? { anchor: url.hash.slice(1) } : {}), extraction: 'html',
        ...(hasScripts && body.reduce((sum,unit)=>sum+(unit.kind==='text'?[...unit.text].length:0),0)<80 ? {mayNeedRendering:true} : {}) },
      units: body, ...(Object.keys(links).length ? { links } : {}) };
  } finally { dom.window.close(); }
}
