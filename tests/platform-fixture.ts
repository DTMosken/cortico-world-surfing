import type { ReadOperation } from '../src/network.ts';

function field(number: number, input: string | Uint8Array): Buffer {
  const value = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input); const length: number[] = [];
  let size = value.length;
  do { length.push((size & 127) | (size > 127 ? 128 : 0)); size >>>= 7; } while (size);
  return Buffer.concat([Buffer.from([number * 8 + 2, ...length]), value]);
}

export class PlatformFixture implements ReadOperation {
  readonly signal = new AbortController().signal;
  downloadedBytes = 0;
  nativeRequests = 0;
  emptyResponses = 0;
  manual = false;
  nativeJson?: unknown;
  searchPages: number[] = [];
  requests = 0;
  offline = false;
  subtitleTail = '末尾结论。';
  close() {}
  async get(url: string) {
    this.requests++;
    if (this.offline) throw new Error('fixture network offline');
    const target = new URL(url); let body: unknown;
    if (target.hostname === 'b23.tv') return {url:'https://www.bilibili.com/video/BV1aa411a7aa/?p=2',status:200,headers:{},body:Buffer.alloc(0)};
    if (target.pathname.endsWith('/nav')) body = { code: -101, data: { isLogin: false,
      wbi_img: { img_url: 'https://example.org/'+'a'.repeat(32)+'.png', sub_url: 'https://example.org/'+'b'.repeat(32)+'.png' } } };
    else if (target.pathname.endsWith('/wbi/view')) body = { code: 0, data: { bvid: 'BV1aa411a7aa', aid: 100, title: '竞赛介绍',
      owner: { name: '作者' }, pages: [{ cid: 200, page: 1, part: '介绍', duration: 90 }, { cid: 201, page: 2, part: '附录', duration: 30 }] } };
    else if (target.pathname.endsWith('/subtitle/web/view')) {
      this.nativeRequests++;
      if (this.nativeJson !== undefined) body = this.nativeJson;
      else {
        const track = Buffer.concat([field(3,this.manual?'zh-Hans':'ai-zh'), field(4,'中文'),
          field(5,'https://aisubtitle.hdslb.com/'+target.searchParams.get('oid')+'.json')]);
        return { url, status:200, headers:{}, body:field(1,this.nativeRequests<=this.emptyResponses ? Buffer.alloc(0) : field(3,track)) };
      }
    } else if (target.hostname === 'aisubtitle.hdslb.com') body = {body:[
      {from:0,to:1,content:target.pathname==='/200.json'?'开头。':'附录说明。'}, {from:31,to:32,content:this.subtitleTail},
    ]};
    else if (target.pathname.endsWith('/search/type')) {
      const page = Number(target.searchParams.get('page')); this.searchPages.push(page);
      body = {code:0,data:{numPages:2,result:[{bvid:'BV1aa411a7aa',aid:100,title:`第${page}页 <em>比赛</em> &amp; 说明`,author:'作者',duration:'1:30'}]}};
    } else throw new Error('unexpected fixture request');
    return {url,status:200,headers:{},body:Buffer.from(JSON.stringify(body))};
  }
}
