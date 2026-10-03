import { expect, test } from 'vitest';
import { PageReader } from '../src/page-reader.ts';
import { fixtureOperation } from './browser-fixture.ts';

test('Worker 解析静态正文并定位章节', async () => {
  const reader = new PageReader();
  const operation = fixtureOperation('<main><h2 id="section">章节</h2><p>Worker 中的正文。</p><h2>后文</h2><p>未选中内容。</p></main>');
  try {
    const result = await reader.read('https://example.org/article#section',operation,8*1024*1024);
    expect(result.scope.kind).toBe('web-section');
    const text = result.units.filter(x=>x.kind==='text').map(x=>x.text).join('');
    expect(text).toContain('Worker 中的正文。');expect(text).not.toContain('未选中内容。');
  } finally {operation.close();await reader.stop();}
});

test.each(['','<p>Loading...</p>'])('空壳或短占位网页经浏览器后备取得正文 %s', async placeholder => {
  const operation = fixtureOperation('<main>'+placeholder+'<p id="text"></p></main><script>fetch("/data").then(r=>r.json()).then(d=>document.querySelector("#text").textContent=d.text)</script>');
  const reader = new PageReader();
  try {
    const result = await reader.read('https://example.org/article',operation,8*1024*1024);
    expect(result.scope.extraction).toBe('rendered-html');
    expect(result.units.filter(x=>x.kind==='text').map(x=>x.text).join('')).toContain('动态正文已经加载。');
  } finally {operation.close();await reader.stop();}
});
