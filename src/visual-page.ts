import type { Page, ElementHandle, Request } from 'playwright';
import { ReadError } from './network.ts';

export interface VisualButton { tag: string; id: string; label: string }
export interface VisualStep { page: number; button: VisualButton }
export interface VisualState { entry: string; steps: VisualStep[]; buttons: VisualButton[]; page: number }

async function scrollArea(page: Page) {
  return page.evaluateHandle(() => {
    const doc = document.scrollingElement!;
    let best = doc;
    let area = innerWidth * Math.min(innerHeight, Math.max(0, doc.scrollHeight - innerHeight));
    for (const el of document.querySelectorAll('*')) {
      if (el === doc || el.clientHeight < 1 || el.scrollHeight <= el.clientHeight + 1 ||
        !/^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY)) continue;
      const r = el.getBoundingClientRect();
      const visible = Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left))
        * Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
      const score = visible * Math.min(1, (el.scrollHeight - el.clientHeight) / el.clientHeight);
      if (score > area) { best = el; area = score; }
    }
    return best;
  });
}

// A previous navigation can stay marked idle while a button's fetch is in flight.
function watchRendering(page: Page) {
  const pending = new Set<Request>();
  let revision = 0;
  page.on('request', request => { pending.add(request); revision++; });
  const finish = (request: Request) => { pending.delete(request); revision++; };
  page.on('requestfinished', finish);
  page.on('requestfailed', finish);
  return async () => {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    let previous: number;
    do {
      previous = revision;
      await page.waitForTimeout(200);
    } while (pending.size || previous !== revision);
  };
}

async function screenPosition(area: ElementHandle<Element>) {
  return area.evaluate(el => {
    const height = el === document.scrollingElement ? innerHeight : el.clientHeight;
    return { height, pages: Math.max(1, Math.ceil(el.scrollHeight / height)), y: Math.round(el.scrollTop) };
  });
}

async function position(page: Page, number: number, settle: () => Promise<void>) {
  const area = await scrollArea(page);
  try {
    await area.evaluate(el => el.scrollTo({top: 0, behavior: 'instant'}));
    let pos = await screenPosition(area);
    for (let current = 2; current <= number; current++) {
      if (current > pos.pages) throw new ReadError('invalid_input', `网页共 ${pos.pages} 屏，请提供范围内的 page。`);
      const before = await area.evaluate(el => el.scrollHeight);
      await area.evaluate((el, top) => el.scrollTo({ top, behavior: 'instant' }), (current - 1) * pos.height);
      await settle();
      if (current === pos.pages) {
        await page.waitForFunction(({ el, before }) => el.scrollHeight > before, { el: area, before }, {timeout: 750})
          .catch(error => { if (error.name !== 'TimeoutError') throw error; });
        const top = (current - 1) * pos.height;
        if (await area.evaluate((el, top) => el.scrollTop < top && el.scrollHeight > el.scrollTop + el.clientHeight + 1, top)) {
          await area.evaluate((el, top) => el.scrollTo({top, behavior: 'instant'}), top);
          await settle();
        }
      }
      pos = await screenPosition(area);
    }
    return pos;
  } finally { await area.dispose(); }
}

function inspectButtons(target: VisualButton | null) {
  const matches = new Map<string, {button: VisualButton; el: Element} | null>();
  for (const el of document.querySelectorAll('button,[role="button"],input[type="button"],[onclick],a[href="#"]')) {
    const anchor = el.closest('a[href]');
    if (anchor && anchor.getAttribute('href') !== '#' && !anchor.getAttribute('href')?.startsWith('javascript:')) continue;
    if (el.closest('form,[inert],[aria-disabled="true"]') || el.matches(':disabled,[form]')) continue;
    const rect = el.getBoundingClientRect();
    const x = (Math.max(0,rect.left) + Math.min(innerWidth,rect.right))/2;
    const y = (Math.max(0,rect.top) + Math.min(innerHeight,rect.bottom))/2;
    const hit = document.elementFromPoint(x,y);
    if (!hit || !el.contains(hit) || !rect.width || !rect.height) continue;
    const label = (el.getAttribute('aria-label') || el.getAttribute('title') ||
      (el instanceof HTMLInputElement ? el.value : (el as HTMLElement).innerText) || '').trim().replace(/\s+/g, ' ');
    if (!label || label.length > 160) continue;
    const button = {tag: el.localName, id: el.id, label};
    const key = JSON.stringify([button.tag, button.id, button.label]);
    matches.set(key, matches.has(key) ? null : {button, el});
  }
  if (target) return matches.get(JSON.stringify([target.tag, target.id, target.label]))?.el ?? null;
  return Array.from(matches.values()).flatMap(row => row ? [row.button] : []);
}

export async function captureScreen(page: Page, number: number, steps: VisualStep[], afterClick: boolean) {
  const settle = watchRendering(page);
  await settle();
  for (const step of steps) {
    await position(page, step.page, settle);
    const handle = await page.evaluateHandle(inspectButtons, step.button);
    try {
      const el = handle.asElement();
      if (!el) throw new ReadError('content_unavailable', '网页按钮已变化或有重名，请重新查看该屏。');
      await el.click({ timeout: 3000 });
      await settle();
    } finally { await handle.dispose(); }
  }
  let screen = number;
  let pos;
  if (afterClick) {
    const area = await scrollArea(page);
    try { pos = await screenPosition(area); }
    finally { await area.dispose(); }
    screen = Math.min(pos.pages, Math.ceil(pos.y / pos.height) + 1);
  } else {
    pos = await position(page, number, settle);
  }
  const buttons = await page.evaluate(inspectButtons, null) as VisualButton[];
  return { page: screen, pages: pos.pages, y: pos.y, buttons, title: await page.title(),
    bytes: await page.screenshot({ type: 'png', timeout: 0 }) };
}
