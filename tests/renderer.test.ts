import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from 'vitest';
import { chromium } from 'playwright';
import { Renderer } from '../src/renderer.ts';
import { fixtureOperation } from './browser-fixture.ts';

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
