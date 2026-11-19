import {expect, test} from 'vitest';
import {PageReader} from '../src/page-reader.ts';
import {fixtureRenderer} from './browser-fixture.ts';
import {visualOperation} from './visual-fixture.ts';
import {parseCommentBatch} from '../src/short-video-comments.ts';

const url = 'https://www.douyin.com/video/1234567890123456789';
const list = 'https://www-hj.douyin.com/aweme/v1/web/comment/list/?aweme_id=1234567890123456789&cursor=';
const options = {mode:'comments' as const,page:1,maxImageDimension:800};
const batch = (text: string, cursor: number, more: number) => JSON.stringify({
  status_code:0, comments:[{text,user:{nickname:'读者'}}], cursor, has_more:more
});

test('抖音原址刷新后读取第一页，续读按页面实际返回的游标滚动加载', async () => {
  const html = `<meta charset="utf-8"><div data-e2e="comment-list"></div><script>
    if(!sessionStorage.ready){sessionStorage.ready='yes';location.reload()}else{
      const list=document.querySelector('div');
      fetch('${list}0').then(r=>r.json()).then(j=>{
        list.style.paddingTop='150vh';
        list.innerHTML='<p data-e2e="comment-item">首条评论</p>';
        new IntersectionObserver(([e],o)=>{if(e.isIntersecting){o.disconnect();fetch('${list}'+j.cursor)}}).observe(list.firstChild);
      });
    }
  </script>`;
  const op = visualOperation({[url]:{type:'text/html',body:html},
    [list+'0']:{type:'application/json',body:batch('首条评论',5,1)},
    [list+'5']:{type:'application/json',body:batch('第二批评论',10,0)}});
  const get = op.get.bind(op);
  op.get = async input => {
    const reply = await get(input);
    if (input.startsWith(list)) reply.headers['access-control-allow-origin'] = 'https://www.douyin.com';
    return reply;
  };
  const reader = new PageReader(fixtureRenderer(op));
  try {
    const result = await reader.read(url,op,100000,options);
    expect(result.units).toEqual([{kind:'text',text:'读者：首条评论'},{kind:'text',text:'读者：第二批评论'}]);
    expect(result.nextBatch).toBeUndefined();
  } finally {await reader.stop();}
});

test('空 HTTP 响应不表示评论读完，分页标记不能停留在当前批次', () => {
  expect(()=>parseCommentBatch(Buffer.alloc(0),0)).toThrow('空响应');
  expect(()=>parseCommentBatch(Buffer.from(batch('评论',5,1)),5)).toThrow('分页');
});

test('同一次匿名访问按评论 ID 合并跨批重复项，保留不同用户的同文评论', () => {
  const seen = new Set<string>();
  const item = (cid: string) => ({cid,text:'同意',user:{nickname:'读者'}});
  const response = (ids: string[]) => Buffer.from(JSON.stringify({status_code:0,has_more:0,comments:ids.map(item)}));
  expect(parseCommentBatch(response(['1']),0,seen).text).toBe('读者：同意');
  expect(parseCommentBatch(response(['1','2']),5,seen).text).toBe('读者：同意');
});

test('抖音入口不能连续刷新两次', async () => {
  const op = visualOperation({[url]:{type:'text/html',body:'<script>location.reload()</script>'}});
  const reader = new PageReader(fixtureRenderer(op));
  try { await expect(reader.read(url,op,100000,options)).rejects.toThrow('动态读取仅允许入口页面'); }
  finally { await reader.stop(); }
});
