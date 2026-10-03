import { expect, test } from 'vitest';
import { extractHtml } from '../src/page.ts';

const html = `<!doctype html><title>阅读指南</title><nav>菜单与广告</nav><main>
<h1 id="guide">阅读指南</h1><p>起点说明。<a href="./next">下一步</a></p>
<h2 id="second">第二节</h2><p>第二节正文。</p><pre>line 1\nline 2</pre>
<h2 id="third">第三节</h2><p>其他内容。</p>
<script>fetch('http://127.0.0.1/')</script><p hidden>隐藏内容</p></main>`;

test('提取正文和代码，正文链接保留文字与编号，排除导航与脚本', () => {
  const material = extractHtml(html, 'https://example.org/docs/start');
  const body = material.units.filter(x => x.kind === 'text').map(x => x.text).join('');
  expect(body).toContain('起点说明。');
  expect(body).toContain('line 1\nline 2');
  expect(body).not.toMatch(/菜单与广告|fetch|隐藏内容/);
  expect(body).toContain('下一步 [L1]');
  expect(material.links).toEqual({ L1: 'https://example.org/docs/next' });
  expect(body).not.toContain('https://');
  expect(material.units.every(x => x.kind === 'text')).toBe(true);
});

test('锚点只读取选定章节，不把后面的同级章节当已读', () => {
  const material = extractHtml(html, 'https://example.org/docs/start#second');
  const body = material.units.filter(x => x.kind === 'text').map(x => x.text).join('');
  expect(body).toContain('第二节正文。');
  expect(body).not.toMatch(/起点说明|其他内容/);
  expect(material.scope.kind).toBe('web-section');
  expect(() => extractHtml(html, 'https://example.org/docs/start#missing')).toThrow(/锚点/);
});

test('正文里的 div、零散文字、表格和链接文字都保留', () => {
  const material = extractHtml('<base href="https://example.org/base/"><main><h1>正文</h1><div>直接文字<span>行内文字</span></div><p>段落。</p><table><tr><th>项目</th><th>值</th></tr><tr><td>甲</td><td>1</td></tr></table><a href="next">后续</a></main>', 'https://example.org/start');
  const body = material.units.filter(x=>x.kind==='text').map(x=>x.text).join('');
  expect(body).toContain('直接文字'); expect(body).toContain('行内文字');
  expect(body).toContain('项目\t值\n甲\t1');
  expect(body).toContain('后续');
  expect(material.units.every(x=>x.kind==='text')).toBe(true);
});

test('空命名锚点定位后面的章节，截在下一同级标题之前', () => {
  const material = extractHtml('<main><a name="intro"></a><h2>简介</h2><p>所选正文。</p><h2>下一章</h2><p>其他正文。</p></main>','https://example.org/article#intro');
  const content = material.units.filter(x=>x.kind==='text').map(x=>x.text).join('');
  expect(content).toContain('所选正文。'); expect(content).not.toContain('其他正文。');
  expect(material.scope.kind).toBe('web-section');
});

test('仅编号正文中的公开链接，按 base 解析相对链接和锚点', () => {
  const material = extractHtml(`<title>指南</title><base href="https://example.org/docs/">
    <nav><a href="menu">导航</a></nav><main><p>请读 <a href="next#setup">安装指南</a>。
    <a href="#setup">本页章节</a><a href="mailto:help@example.org">邮箱</a>
    <a href="javascript:void(0)">按钮</a><a href="http://localhost/">本机</a>
    <a href="http://127.0.0.1/">IP</a><a href="https://user:pass@example.org/">带账号</a></p></main>
    <footer><a href="footer">页脚</a></footer>`, 'https://example.org/start');
  const text = material.units.filter(x => x.kind === 'text').map(x => x.text).join('');
  expect(material.links).toEqual({ L1: 'https://example.org/docs/next#setup', L2: 'https://example.org/docs/#setup' });
  expect(text).toContain('安装指南 [L1]'); expect(text).toContain('本页章节 [L2]');
  expect(text).not.toMatch(/导航|页脚|https?:\/\//);
  expect([...text.matchAll(/\[L\d+\]/g)].map(match => match[0])).toEqual(['[L1]', '[L2]']);
});

test('链接标记位置保留混合 Unicode、空白、标题、表格与独立链接', () => {
  const material = extractHtml(`<main>
    <h2>🌌 <a href="heading">  标题 <span>后文</span>  </a></h2>
    <p>🌌\n 文字 <a href="first"><strong>指南</strong></a>\t末尾。</p>
    <table><tr><th>项目</th><th>阅读</th></tr><tr><td>🌌</td><td><a href="table">参考</a></td></tr></table>
    <a href="standalone"><img alt="独立链接"></a>
    <pre>line 1\n<a href="code">line 2</a></pre>
    </main>`, 'https://example.org/start');
  const visible: string[] = [];
  for (const unit of material.units) {
    if (unit.kind !== 'text') continue;
    for (const span of unit.links ?? []) {
      expect([...unit.text].slice(span.from, span.to).join('')).toBe(`[${span.id}]`);
      expect(material.links?.[span.id]).toMatch(/^https:\/\/example.org\//);
      visible.push(span.id);
    }
  }
  expect(visible).toEqual(Object.keys(material.links!));
  expect(material.units.filter(x => x.kind === 'text').map(x => x.text).join('')).toContain('独立链接 [L4]');
});

test('章节快照只保留所选章节的链接', () => {
  const material = extractHtml('<main><h2 id="one">一</h2><p><a href="a">甲</a></p><h2 id="two">二</h2><p><a href="b">乙</a></p></main>', 'https://example.org/article#two');
  expect(material.links).toEqual({ L1: 'https://example.org/b' });
  const text = material.units.filter(x => x.kind === 'text').map(x => x.text).join('');
  expect(text).toContain('乙 [L1]'); expect(text).not.toContain('甲');
});
