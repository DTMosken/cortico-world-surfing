// src/page-engine.ts
import { parentPort, workerData } from "node:worker_threads";

// src/page.ts
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

// src/network.ts
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
var ReadError = class extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
  kind;
};
function asReadError(error) {
  if (error instanceof ReadError) return error;
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    return new ReadError("timeout", "\u8BFB\u53D6\u5DF2\u53D6\u6D88\u6216\u8D85\u65F6\u3002");
  return new ReadError("network_error", "\u8BFB\u53D6\u5931\u8D25\uFF0C\u672A\u53D6\u5F97\u53EF\u7528\u6587\u672C\u3002");
}
function validatePublicUrl(input) {
  if (typeof input !== "string" || input.length > 8192) throw new ReadError("invalid_input", "URL \u4E3A\u7A7A\u6216\u8FC7\u957F\u3002");
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new ReadError("invalid_input", "\u9700\u8981\u5B8C\u6574\u7684 HTTP(S) URL\u3002");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isIP(hostname.replace(/^\[|\]$/g, "")) || !hostname.includes(".") || /(^|\.)(localhost|local|localdomain|internal|lan|home|onion)$/.test(hostname))
    throw new ReadError("address_denied", "\u53EA\u5141\u8BB8\u516C\u5F00\u57DF\u540D\uFF0C\u4E0D\u80FD\u8BFB\u53D6\u672C\u5730\u3001IP \u6216\u5E26\u8D26\u53F7\u4FE1\u606F\u7684\u5730\u5740\u3002");
  url.hostname = hostname;
  return url;
}

// src/page.ts
function pageKey(input) {
  return "page:" + validatePublicUrl(input).href;
}
function extractHtml(html, input) {
  const url = validatePublicUrl(input);
  const dom = new JSDOM(html, { url: url.href });
  const document = dom.window.document;
  try {
    const hasScripts = !!document.querySelector('script[src],script:not([type]),script[type="module"],script[type="text/javascript"],script[type="application/javascript"]');
    document.querySelectorAll('script,style,noscript,nav,header,footer,form,[hidden],[aria-hidden="true"]').forEach((element) => element.remove());
    let root = document.querySelector('main,article,[role="main"],#apicontent');
    let section = false;
    if (url.hash) {
      let anchor;
      try {
        anchor = decodeURIComponent(url.hash.slice(1));
      } catch {
        throw new ReadError("invalid_input", "URL \u7684\u7AE0\u8282\u951A\u70B9\u65E0\u6548\u3002");
      }
      const target = document.getElementById(anchor) ?? [...document.querySelectorAll("a[name]")].find((element) => element.getAttribute("name") === anchor);
      if (!target) throw new ReadError("content_unavailable", "\u9875\u9762\u672A\u627E\u5230\u6307\u5B9A\u951A\u70B9\uFF1B\u672A\u8BFB\u53D6\u5176\u4ED6\u7AE0\u8282\u3002");
      const container = root?.contains(target) ? root : document.body;
      const headings = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")];
      const following = headings.find((element) => !!(target.compareDocumentPosition(element) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING));
      let heading = target.closest("h1,h2,h3,h4,h5,h6");
      if (!heading && !target.textContent?.trim() && following) {
        const between = document.createRange();
        between.setStartAfter(target);
        between.setEndBefore(following);
        if (!between.toString().trim()) heading = following;
      }
      if (heading) {
        const level = Number(heading.tagName.slice(1));
        const next = headings.find((element) => element !== heading && Number(element.tagName.slice(1)) <= level && !!(heading.compareDocumentPosition(element) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING));
        const range = document.createRange();
        range.setStartBefore(heading);
        if (next) range.setEndBefore(next);
        else range.setEnd(container, container.childNodes.length);
        root = document.createElement("div");
        root.append(range.cloneContents());
      } else if (target.textContent?.trim()) root = target;
      else {
        const range = document.createRange();
        range.setStartAfter(target);
        if (following) range.setEndBefore(following);
        else range.setEnd(container, container.childNodes.length);
        root = document.createElement("div");
        root.append(range.cloneContents());
      }
      section = true;
    }
    if (!root) {
      const article = new Readability(document.cloneNode(true), { charThreshold: 80, maxElemsToParse: 1e5 }).parse();
      if (article?.content) {
        root = document.createElement("div");
        root.innerHTML = article.content;
      } else root = document.body;
    }
    const links = {};
    const markers = /* @__PURE__ */ new WeakMap();
    const anchors = [...root.matches("a[href]") ? [root] : [], ...root.querySelectorAll("a[href]")];
    let linkCount = 0;
    for (const anchor of anchors) {
      let target;
      try {
        target = validatePublicUrl(new URL(anchor.getAttribute("href"), document.baseURI).href);
      } catch {
        continue;
      }
      const id = "L" + ++linkCount;
      links[id] = target.href;
      if (!anchor.textContent?.trim()) anchor.append(document.createTextNode(
        anchor.getAttribute("aria-label") || anchor.getAttribute("title") || anchor.querySelector("img")?.getAttribute("alt") || "\u94FE\u63A5"
      ));
      const marker = document.createTextNode(` [${id}]`);
      markers.set(marker, id);
      anchor.append(marker);
    }
    const renderText = (node, preserveWhitespace = false) => {
      const walker = document.createTreeWalker(node, dom.window.NodeFilter.SHOW_TEXT);
      let current = node.nodeType === dom.window.Node.TEXT_NODE ? node : walker.nextNode();
      let text = "", length = 0;
      const spans = [];
      while (current) {
        let value = current.textContent ?? "";
        if (!preserveWhitespace) {
          value = value.replace(/\s+/g, " ");
          if (text.endsWith(" ")) value = value.replace(/^ /, "");
        }
        const size = [...value].length;
        const id = markers.get(current);
        if (id) spans.push({ id, from: length + size - id.length - 2, to: length + size });
        text += value;
        length += size;
        current = walker.nextNode();
      }
      const leading = [...text.match(/^\s*/)[0]].length;
      return { text: text.trim(), links: spans.map((span) => ({ ...span, from: span.from - leading, to: span.to - leading })) };
    };
    const body = [];
    let hasBody = false;
    const pending = [root];
    while (pending.length) {
      const node = pending.pop();
      const element = node.nodeType === dom.window.Node.ELEMENT_NODE ? node : void 0;
      const block = element?.matches("h1,h2,h3,h4,h5,h6,p,pre,li,table,blockquote,a[href]");
      if (block || node.nodeType === dom.window.Node.TEXT_NODE) {
        let rendered = element?.tagName === "TABLE" ? { text: "", links: [] } : renderText(node, element?.tagName === "PRE");
        if (element?.tagName === "TABLE") {
          let length = 0;
          for (const [rowIndex, row] of [...element.querySelectorAll("tr")].entries()) {
            if (rowIndex) {
              rendered.text += "\n";
              length++;
            }
            for (const [cellIndex, cell] of [...row.querySelectorAll("th,td")].entries()) {
              if (cellIndex) {
                rendered.text += "	";
                length++;
              }
              const value = renderText(cell);
              rendered.links.push(...value.links.map((span) => ({ ...span, from: span.from + length, to: span.to + length })));
              rendered.text += value.text;
              length += [...value.text].length;
            }
          }
        }
        if (!rendered.text) continue;
        const heading = !!element && /^H[1-6]$/.test(element.tagName);
        const prefix = heading ? "#".repeat(Number(element.tagName.slice(1))) + " " : "";
        body.push({
          kind: "text",
          text: prefix + rendered.text + "\n\n",
          ...rendered.links.length ? { links: rendered.links.map((span) => ({ ...span, from: span.from + prefix.length, to: span.to + prefix.length })) } : {}
        });
        hasBody ||= !heading;
      } else pending.push(...[...node.childNodes].reverse());
    }
    if (!hasBody) throw new ReadError("content_unavailable", "\u672A\u53D6\u5F97\u7F51\u9875\u6B63\u6587\uFF0C\u53EF\u80FD\u9700\u8981 JavaScript \u6216\u9875\u9762\u9650\u5236\u4E86\u8BBF\u95EE\u3002");
    return {
      kind: "page",
      key: pageKey(input),
      source: url.href,
      title: document.title || "\u7F51\u9875",
      scope: {
        kind: section ? "web-section" : "web-page",
        ...section ? { anchor: url.hash.slice(1) } : {},
        extraction: "html",
        ...hasScripts && body.reduce((sum, unit) => sum + (unit.kind === "text" ? [...unit.text].length : 0), 0) < 80 ? { mayNeedRendering: true } : {}
      },
      units: body,
      ...Object.keys(links).length ? { links } : {}
    };
  } finally {
    dom.window.close();
  }
}

// src/page-engine.ts
try {
  parentPort.postMessage({ material: extractHtml(workerData.html, workerData.url) });
} catch (error) {
  const failure = asReadError(error);
  parentPort.postMessage({ error: { kind: failure.kind, message: failure.message } });
}
