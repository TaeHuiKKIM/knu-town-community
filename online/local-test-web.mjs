import http from 'node:http';
import {readFile} from 'node:fs/promises';
import rendezvous from './api/rendezvous.mjs';

// Isolated built site with its real handler and the SDK's process-local cache.
export async function localTestWeb(onPost=()=>{}) {
  const dist=new URL('./dist/',import.meta.url);
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/api/rendezvous'&&req.method==='POST'){
        let body='';for await(const chunk of req)body+=chunk;
        req.body=JSON.parse(body);
        onPost(req.body);
        res.status=code=>{res.statusCode=code;return res;};
        res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
        await rendezvous(req,res);return;
      }
      const path=pathname.slice(1)||'index.html';
      if(!/^[a-z0-9./_-]+$/i.test(path)||path.includes('..'))throw Error('Invalid path');
      const bytes=await readFile(new URL(path,dist));
      const mime={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',woff2:'font/woff2',webmanifest:'application/manifest+json'};
      res.setHeader('Content-Type',mime[path.split('.').at(-1)]||'application/octet-stream');res.end(bytes);
    }catch{if(!res.headersSent)res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {
    base:'http://127.0.0.1:'+server.address().port,
    async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  };
}
