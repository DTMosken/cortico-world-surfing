import { PublicClient, type ReadOperation } from '../src/network.ts';

export function fixtureOperation(html: string, requestTimeoutMs = 20000): ReadOperation & {requests:string[]} {
  const guarded = new PublicClient(async()=>[{address:'127.0.0.1',family:4}])
    .operation({requestTimeoutMs,maxDownloadBytes:8*1024*1024});
  const requests: string[] = [];
  return {signal:guarded.signal,downloadedBytes:0,requests,close:()=>guarded.close(),
    async get(input,options) {
      const url = new URL(input);
      if (url.hostname !== 'example.org') return guarded.get(input,options);
      requests.push(url.pathname+url.search);
      const data = url.pathname === '/data' ? JSON.stringify({text:'动态正文已经加载。'}) : html;
      return {url:input,status:200,headers:{'content-type':url.pathname==='/data'?'application/json':'text/html; charset=utf-8'},body:Buffer.from(data)};
    },
  };
}
