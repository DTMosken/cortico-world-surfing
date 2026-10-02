import { expect, test } from 'vitest';
import { extractHtml } from '../src/page.ts';

const html = `<!doctype html><title>阅读指南</title><nav>菜单与广告</nav><main>
<h1 id="guide">阅读指南</h1><p>起点说明。<a href="./next">下一步</a></p>
<h2 id="second">第二节</h2><p>第二节正文。</p><pre>line 1\nline 2</pre>
<h2 id="third">第三节</h2><p>其他内容。</p>
<script>fetch('http://127.0.0.1/')</script><p hidden>隐藏内容</p></main>`;

test('提取正文、代码和绝对链接，排除导航与脚本', () => {
  const material = extractHtml(html, 'https://example.org/docs/start');
  const body = material.units.filter(x => x.kind === 'text').map(x => x.text).join('');
  expect(body).toContain('起点说明。');
  expect(body).toContain('line 1\nline 2');
  expect(body).not.toMatch(/菜单与广告|fetch|隐藏内容/);
  expect(material.units.filter(x => x.kind === 'link')).toContainEqual({ kind: 'link', value: { text: '下一步', url: 'https://example.org/docs/next' } });
});

test('锚点只读取选定章节，不把后面的同级章节当已读', () => {
  const material = extractHtml(html, 'https://example.org/docs/start#second');
  const body = material.units.filter(x => x.kind === 'text').map(x => x.text).join('');
  expect(body).toContain('第二节正文。');
  expect(body).not.toMatch(/起点说明|其他内容/);
  expect(material.scope.kind).toBe('web-section');
  expect(() => extractHtml(html, 'https://example.org/docs/start#missing')).toThrow(/锚点/);
});

test('正文里的 div、零散文字和表格内容都保留，链接尊重 base', () => {
  const material = extractHtml('<base href="https://example.org/base/"><main><h1>正文</h1><div>直接文字<span>行内文字</span></div><p>段落。</p><table><tr><th>项目</th><th>值</th></tr><tr><td>甲</td><td>1</td></tr></table><a href="next">后续</a></main>', 'https://example.org/start');
  const body = material.units.filter(x=>x.kind==='text').map(x=>x.text).join('');
  expect(body).toContain('直接文字'); expect(body).toContain('行内文字');
  expect(body).toContain('项目\t值\n甲\t1');
  expect(material.units.filter(x=>x.kind==='link')).toContainEqual({kind:'link',value:{text:'后续',url:'https://example.org/base/next'}});
});
