import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { commentQuery } from '../src/youtube-comments.ts';
import { fixtureRenderer } from './browser-fixture.ts';
import { visualOperation } from './visual-fixture.ts';

const endpoint = 'https://www.youtube.com/youtubei/v1/next';
const watch = 'https://www.youtube.com/watch?v=testVideo01';
const query = { context: {client: {clientName: 'WEB', clientVersion: '2.20261119.00'}}, continuation: 'page-two' };

test('公开评论查询支持压缩请求，只取客户端版本和续读标记', () => {
  const encoded = gzipSync(JSON.stringify({...query, context:{client:{...query.context.client, visitorData:'discard'}}, tracking:'discard'}));
  expect(commentQuery(encoded)).toEqual(query);
  expect(commentQuery(gzipSync(Buffer.alloc(65537, 32)))).toBeUndefined();
  expect(commentQuery(Buffer.from('not JSON'))).toBeUndefined();
  expect(commentQuery(Buffer.from(JSON.stringify({context:query.context, videoId:'testVideo01'})))).toBeUndefined();
});

test.each([[watch, true], ['https://example.org/watch?v=testVideo01', false]] as const)(
  '点击评论后仅在指定视频站内返回匿名查询结果：%s', async (url, allowed) => {
    const html = `<button id="comments">Comments</button><script>
      comments.onclick = async () => {
        try {
          const r = await fetch('${endpoint}?tracking=discard', {method:'POST',body:JSON.stringify(${JSON.stringify(query)})});
          document.title = (await r.json()).text;
        } catch { document.title = '评论请求被拦截'; }
      };
    </script>`;
    const op = visualOperation({[url]:{type:'text/html; charset=utf-8',body:html}});
    const sent: Array<{url:string; body:unknown}> = [];
    op.postJson = async (url, body) => {
      sent.push({url,body});
      return {url,status:200,headers:{},body:Buffer.from(JSON.stringify({text:'实际加载的评论正文'}))};
    };
    const renderer = fixtureRenderer(op);
    try {
      const result = await renderer.render(url,op,100000,undefined,
        {mode:'visual',page:1,maxImageDimension:800,steps:[{page:1,button:{tag:'button',id:'comments',label:'Comments'}}],afterClick:true},
        async () => true);
      expect(result.image?.title).toBe(allowed ? '实际加载的评论正文' : '评论请求被拦截');
      expect(sent).toEqual(allowed ? [{url:endpoint,body:query}] : []);
      expect(op.requests.some(url=>url.includes('/youtubei/'))).toBe(false);
    } finally { await renderer.stop(); }
  });
