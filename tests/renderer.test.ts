import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from 'vitest';
import { Renderer } from '../src/renderer.ts';
import { PublicClient, type ReadOperation } from '../src/network.ts';
import { PageReader } from '../src/page-reader.ts';

function fixtureOperation(html: string): ReadOperation {
  const guarded = new PublicClient(async () => [{address:'127.0.0.1',family:4}])
    .operation({requestTimeoutMs:20000,maxDownloadBytes:8*1024*1024});
  return { signal:guarded.signal, downloadedBytes:0, close:()=>guarded.close(),
    async get(input,options) {
      const url = new URL(input);
      if (url.hostname !== 'example.org') return guarded.get(input,options);
      const data = url.pathname === '/data' ? JSON.stringify({text:'动态正文已经加载。'}) : html;
      return { url:input,status:200,headers:{'content-type':url.pathname==='/data'?'application/json':'text/html'},body:Buffer.from(data) };
    },
  };
}

test('真实浏览器读取动态正文并拦截内网 fetch、iframe、WebSocket 和提交', async () => {
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
  try { new WebSocket('ws://127.0.0.1:${port}/socket'); } catch {}
  const form=document.createElement('form');form.method='POST';form.action='http://127.0.0.1:${port}/submit';
  form.target='hidden';document.body.append(form);
  const frame=document.createElement('iframe');frame.name='hidden';document.body.append(frame);form.submit();
  </script>`;
  const renderer = new Renderer(); const operation = fixtureOperation(html);
  try {
    const result = await renderer.render('https://example.org/article',operation,8*1024*1024);
    expect(result.html).toContain('动态正文已经加载。 RTC=undefined');
    expect(connections).toBe(0);
  } finally { operation.close(); await renderer.stop(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});

test('PageReader 在 Worker 中解析静态正文并定位章节', async () => {
  const reader = new PageReader();
  const operation = fixtureOperation('<main><h2 id="section">章节</h2><p>Worker 中的正文。</p><h2>后文</h2><p>未选中内容。</p></main>');
  try {
    const result = await reader.read('https://example.org/article#section',operation,8*1024*1024);
    expect(result.scope.kind).toBe('web-section');
    const text = result.units.filter(x=>x.kind==='text').map(x=>x.text).join('');
    expect(text).toContain('Worker 中的正文。'); expect(text).not.toContain('未选中内容。');
  } finally { operation.close(); await reader.stop(); }
});

test('空壳网页经浏览器后备取得正文', async () => {
  const operation = fixtureOperation('<main><p id="text"></p></main><script>fetch("/data").then(r=>r.json()).then(d=>document.querySelector("#text").textContent=d.text)</script>');
  const reader = new PageReader();
  try {
    const result = await reader.read('https://example.org/article',operation,8*1024*1024);
    expect(result.scope.extraction).toBe('rendered-html');
    expect(result.units.filter(x=>x.kind==='text').map(x=>x.text).join('')).toContain('动态正文已经加载。');
  } finally { operation.close(); await reader.stop(); }
});

test('每次渲染使用新的匿名上下文', async () => {
  const renderer = new Renderer();
  const operation = fixtureOperation('<main><p id="text"></p></main><script>document.querySelector("#text").textContent="before="+localStorage.getItem("value");localStorage.setItem("value","saved")</script>');
  try {
    for(let i=0;i<2;i++) {
      const result = await renderer.render('https://example.org/article',operation,8*1024*1024);
      expect(result.html).toContain('before=null');
    }
  } finally { operation.close(); await renderer.stop(); }
});
