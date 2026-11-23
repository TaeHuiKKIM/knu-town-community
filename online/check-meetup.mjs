// Serve the actual built app and its rendezvous handler on loopback.
// Vercel's runtime package falls back to its process-local cache for this check.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import rendezvous from './api/rendezvous.mjs';
const dist=new URL('./dist/',import.meta.url);
const registrations=[];
const server=http.createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/api/rendezvous'&&req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;
      req.body=JSON.parse(body);
      registrations.push({room:req.body.room,name:req.body.name,leave:!!req.body.leave});
      res.status=code=>{res.statusCode=code;return res;};
      res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
      await rendezvous(req,res);return;
    }
    const path=pathname.slice(1)||'index.html';
    if(!/^[a-z0-9./_-]+$/i.test(path)||path.includes('..'))throw Error('Invalid path');
    const bytes=await readFile(new URL(path,dist));
    const mime={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',woff2:'font/woff2'};
    res.setHeader('Content-Type',mime[path.split('.').at(-1)]||'application/octet-stream');res.end(bytes);
  }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try{
  const faults=[];
  async function participant(width,name) {
    const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<600});
    await context.addInitScript(n=>localStorage.setItem('knu-web-profile',JSON.stringify({name:n,avatar:'female',coat:'navy'})),name);
    const page=await context.newPage();page.setDefaultTimeout(12000);
    page.on('pageerror',error=>faults.push(error.message));
    return page;
  }
  const host=await participant(1280,'달'), guest=await participant(390,'별'), visitor=await participant(320,'구름');
  await host.goto(base+'/?mode=web');
  await host.locator('#invite').click();await host.getByRole('button',{name:'학과·동아리·스터디 모임 만들기'}).click();
  await host.getByLabel('모임 종류').selectOption('study');await host.getByLabel('모임 이름').fill('시험 전에 같이 읽기');
  await host.getByLabel('학교·학과·동아리 별칭 (선택)').fill('열린 독서회');
  await host.getByRole('button',{name:'모임 만들고 입장'}).click();
  await host.getByRole('button',{name:'모임 초대 링크·QR'}).click();
  const link=await host.getByRole('textbox',{name:'초대 링크'}).inputValue();
  const code=new URL(link).searchParams.get('room');
  assert.match(code,/^meet-/);
  assert.ok(await host.locator('img[alt="모임 초대 QR"]').evaluate(async img=>{await img.decode();return img.naturalWidth>0;}));
  await guest.goto(link);
  await guest.getByRole('heading',{name:'모임 초대',exact:true}).waitFor();
  assert.ok((await guest.locator('#panelbody').textContent()).includes('열린 독서회'));
  await guest.waitForTimeout(450);
  assert.equal(registrations.filter(r=>r.room===code&&r.name==='별').length,0);
  await guest.getByRole('button',{name:'모임 참여',exact:true}).click();
  await guest.waitForFunction(()=>document.querySelector('#network').textContent==='친구 1명');
  await host.locator('#panel .close').click();await host.waitForFunction(()=>document.querySelector('#network').textContent==='친구 1명');
  await guest.locator('#invite').click();
  await guest.getByLabel('한 줄 소개 (선택)').fill('다른 캠퍼스에서 왔어요!');
  await guest.getByRole('button',{name:'소개 보내기'}).click();
  await host.locator('#log').getByText('별 · 다른 캠퍼스에서 왔어요!',{exact:true}).waitFor();
  await guest.getByRole('button',{name:'질문을 채팅에 보내기'}).click();
  await host.locator('#log').getByText('별 · 오늘 한 가지 마치고 싶은 공부는?',{exact:true}).waitFor();
  assert.ok(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await visitor.goto(link);
  await visitor.getByRole('button',{name:'참여하지 않고 광장으로'}).click();
  await visitor.waitForURL(u=>!u.searchParams.has('room'));
  assert.ok(!registrations.some(r=>r.room===code&&r.name==='구름'));
  const tampered=new URL(link), fragment=new URLSearchParams(tampered.hash.slice(1));fragment.set('title','변경');tampered.hash=fragment.toString();
  await visitor.goto(tampered.href);
  await visitor.getByRole('heading',{name:'초대 확인',exact:true}).waitFor();
  assert.equal(await visitor.getByRole('button',{name:'모임 참여',exact:true}).count(),0);
  assert.ok(!registrations.some(r=>r.room===code&&r.name==='구름'));
  await guest.reload();
  await guest.waitForFunction(()=>document.querySelector('#network').textContent==='친구 1명');
  await guest.locator('#invite').click();await guest.getByRole('button',{name:'모임 나가기'}).click();
  await guest.waitForURL(u=>!u.searchParams.has('room'));
  await host.waitForFunction(()=>document.querySelector('#network').textContent==='친구 0명');
  await guest.goto(link);await guest.getByRole('heading',{name:'모임 초대',exact:true}).waitFor();
  await guest.getByRole('button',{name:'모임 참여',exact:true}).click();
  await host.waitForFunction(()=>document.querySelector('#network').textContent==='친구 1명');
  const two=await participant(390,'해'),three=await participant(390,'산');
  for(const [page,count] of [[two,2],[three,3]]){
    await page.goto(link);await page.getByRole('button',{name:'모임 참여',exact:true}).click();
    await host.waitForFunction(n=>document.querySelector('#network').textContent==='친구 '+n+'명',count);
  }
  await visitor.goto(link);await visitor.getByRole('button',{name:'모임 참여',exact:true}).click();
  await visitor.waitForFunction(()=>document.querySelector('#notice').textContent.includes('정원 4명'));
  await three.locator('#invite').click();await three.getByRole('button',{name:'모임 나가기'}).click();
  await visitor.waitForFunction(()=>document.querySelector('#network').textContent==='친구 3명');
  assert.deepEqual(faults,[]);
  console.log('Desktop creator, mobile guest, 320px visitor: create/share QR/preview/consent, real room chat and prompt, decline, altered link, refresh, leave/re-consent, 4 participants, 5th waits and fills a vacated seat passed.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
