import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { expect, test } from 'vitest';
import { PageReader, Renderer } from '../src/page-reader.ts';
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

test('空公开文本报告未取得正文，不能误报返回预算不足', async () => {
  const operation = fixtureOperation('');
  operation.get = async url => ({ url, status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from(' \n') });
  const reader = new PageReader();
  try { await expect(reader.read('https://example.org/article', operation, 8192)).rejects.toMatchObject({kind:'content_unavailable'}); }
  finally { operation.close(); await reader.stop(); }
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

test('浏览器不可用时仍保留短静态原文，并标明未核验渲染内容', async () => {
  const operation = fixtureOperation('<main><p>公开静态正文。</p></main><script src="/analytics.js"></script>');
  const reader = new PageReader(new Renderer(async()=>{throw new Error('browser missing');}));
  try {
    const result = await reader.read('https://example.org/article',operation,8*1024*1024);
    expect(result.units.filter(x=>x.kind==='text').map(x=>x.text).join('')).toContain('公开静态正文。');
    expect(result.sourceTruncated).toBe(true); expect(result.truncationReason).toBe('rendering_unavailable');
    expect(result.scope.renderingStatus).toBe('browser_unavailable');
  } finally {operation.close();await reader.stop();}
});

test('未声明 HTTP 编码时使用 HTML meta 中的中文编码', async () => {
  const operation = fixtureOperation('');
  operation.get = async input=>({url:input,status:200,headers:{'content-type':'text/html'},body:Buffer.concat([
    Buffer.from('<meta charset="gbk"><main><p>'),Buffer.from('d6d0cec4','hex'),Buffer.from('</p></main>'),
  ])});
  const reader = new PageReader();
  try {
    const result = await reader.read('https://example.org/article',operation,8*1024*1024);
    expect(result.units.filter(x=>x.kind==='text').map(x=>x.text).join('')).toContain('中文');
  } finally {operation.close();await reader.stop();}
});

test('真实浏览器读取动态正文并拦截内网 fetch、iframe、WebSocket 和 POST', async () => {
  let connections = 0;
  const server = createServer((_request,response)=>response.end('private'));
  server.on('connection',()=>connections++);
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const port = (server.address() as {port:number}).port;
  const html = `<!doctype html><title>动态材料</title><main><p id="text"></p></main>
  <iframe src="http://127.0.0.1:${port}/frame"></iframe>
  <script>
  fetch('/data').then(r=>r.json()).then(data=>document.querySelector('#text').textContent=data.text+' RTC='+typeof RTCPeerConnection);
  fetch('http://127.0.0.1:${port}/fetch').catch(()=>{});
  fetch('http://inside.example.org:${port}/dns').catch(()=>{});
  fetch('/post',{method:'POST',body:'data'}).catch(()=>{});
  try { new WebSocket('ws://127.0.0.1:${port}/socket'); } catch {}
  </script>`;
  const renderer = new Renderer(); const operation = fixtureOperation(html);
  try {
    const result = await renderer.render('https://example.org/article',operation,8*1024*1024);
    expect(result.html).toContain('动态正文已经加载。 RTC=undefined');
    expect(connections).toBe(0); expect(operation.requests).not.toContain('/post');
  } finally {operation.close();await renderer.stop();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('每次渲染使用新的匿名上下文', async () => {
  const renderer = new Renderer();
  const operation = fixtureOperation('<main><p id="text"></p></main><script>document.querySelector("#text").textContent="before="+localStorage.getItem("value");localStorage.setItem("value","saved")</script>');
  try {
    for(let i=0;i<2;i++) expect((await renderer.render('https://example.org/article',operation,8*1024*1024)).html).toContain('before=null');
  } finally {operation.close();await renderer.stop();}
});

test('GET 表单的 submit、requestSubmit 与按钮点击都不会发送请求', async () => {
  const renderer = new Renderer();
  const operation = fixtureOperation('<main><p>正文。</p></main><iframe name="target"></iframe><form method="GET" target="target" action="/submit"><input name="field" value="payload"><button id="button">submit</button></form><script>const form=document.querySelector("form");form.submit();form.requestSubmit();document.querySelector("#button").click()</script>');
  try {
    await renderer.render('https://example.org/article',operation,8*1024*1024);
    expect(operation.requests.some(path=>path.startsWith('/submit'))).toBe(false);
  } finally {operation.close();await renderer.stop();}
});

test('GET 表单经过 window 事件截断或 Shadow DOM 也不会发送请求', async () => {
  const renderer = new Renderer();
  const operation = fixtureOperation('<main><p>正文。</p></main><iframe name="target"></iframe><form method="GET" target="target" action="/submit"><input name="field" value="payload"><button id="button">submit</button></form><div id="host"></div><script>window.addEventListener("submit",event=>event.stopPropagation(),true);document.querySelector("#button").click();const shadow=document.querySelector("#host").attachShadow({mode:"closed"});shadow.innerHTML="<form method=GET target=target action=/submit><input name=field value=shadow><button>submit</button></form>";shadow.querySelector("button").click()</script>');
  try {
    await renderer.render('https://example.org/article',operation,8*1024*1024);
    expect(operation.requests.some(path=>path.startsWith('/submit'))).toBe(false);
  } finally {operation.close();await renderer.stop();}
});

test('入口页面的 HTTP 重定向仍可读取', async () => {
  const renderer = new Renderer(); const operation = fixtureOperation('<main><p>重定向后正文。</p></main>');
  const get = operation.get.bind(operation);
  operation.get = async(input,options)=>new URL(input).pathname==='/start'
    ? {...await get('https://example.org/article',options),url:'https://example.org/article'} : get(input,options);
  try {
    const result = await renderer.render('https://example.org/start',operation,8*1024*1024);
    expect(result.url).toBe('https://example.org/article'); expect(result.html).toContain('重定向后正文。');
  } finally {operation.close();await renderer.stop();}
});

test('等待慢浏览器启动时也响应整次操作的取消', async () => {
  const renderer = new Renderer(async options=>{
    await new Promise(resolve=>setTimeout(resolve,180)); return chromium.launch(options);
  });
  const operation = fixtureOperation('<main><p>正文。</p></main>',30);
  const started = Date.now();
  try {
    await expect(renderer.render('https://example.org/article',operation,8*1024*1024)).rejects.toMatchObject({kind:'timeout'});
    expect(Date.now()-started).toBeLessThan(150);
  } finally {operation.close();await renderer.stop();}
});
