import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {createStudyServer} from '../src/server.mjs';

const host=createStudyServer({hub:true,roomCode:'journey-check'});
await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));
const lan='http://127.0.0.1:'+host.address().port+'/r/journey-check';
const base=process.argv[2] || 'https://knu-direct-plaza.vercel.app';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH || (existsSync(edge)?edge:undefined)});
const participants=[];

async function join(name){
  const page=await browser.newPage({viewport:{width:1100,height:760}});
  participants.push(page);page.setDefaultTimeout(10000);
  await page.goto(lan);
  await page.locator('#nickname').fill(name);
  await page.locator('#join-button').click();
  await page.locator('#player:visible').waitFor();
  return page;
}
async function leave(page,cleanup=false){
  if(page.isClosed())return;
  if(await page.locator('#connection[data-mode=online]').count()){
    if(!cleanup){
      await page.locator('[data-open="room-dialog"]:visible').last().click();
      await page.locator('#leave').waitFor();
    }
    await Promise.all([
      page.waitForResponse(r=>r.url().endsWith('/action')&&r.request().postDataJSON()?.type==='leave'&&r.ok(),{timeout:5000}),
      cleanup?page.evaluate(()=>document.querySelector('#leave').click()):page.locator('#leave').click()
    ]);
  }
  await page.close();
}
const remote=(page,name)=>page.locator('.actor.remote').filter({has:page.getByText(name,{exact:true})});
async function expectFriends(page,count){await page.waitForFunction(n=>document.querySelectorAll('.actor.remote:not([hidden])').length===n,count);}
async function walk(from,watchers,name){
  const positions=await Promise.all(watchers.map(p=>remote(p,name).evaluate(e=>parseFloat(e.style.left))));
  await from.locator('#viewport').focus();
  await from.keyboard.down('KeyD');await from.waitForTimeout(320);await from.keyboard.up('KeyD');
  for(const [i,page] of watchers.entries()){
    await page.waitForFunction(([n,start])=>[...document.querySelectorAll('.actor.remote')].some(e=>e.querySelector('.name')?.textContent===n&&Math.abs(parseFloat(e.style.left)-start)>6),[name,positions[i]]);
  }
}
async function send(from,targets,message){
  const chat=from.locator('#chat-dialog');
  if(!await chat.isVisible())await from.locator('[data-open="chat-dialog"]:visible').first().click();
  await from.locator('#chat-input').fill(message);
  await from.locator('#send-chat').click();
  for(const page of targets){
    const panel=page.locator('#chat-dialog');
    if(!await panel.isVisible())await page.locator('[data-open="chat-dialog"]:visible').first().click();
    await panel.getByText(message,{exact:true}).waitFor();
    await panel.locator('[data-close]').click();
  }
  await chat.locator('[data-close]').click();
}
async function lanStudy(page){
  await page.locator('[data-open="study-dialog"]:visible').first().click();
  await page.locator('#study-plan summary').first().click();
  await page.locator('#study-new-subject').fill('자료구조');
  await page.locator('#study-add-subject button').click();
  await page.getByRole('button',{name:'자료구조 공부 시작'}).click();
  await page.locator('#study-focus:visible').waitFor();
  await page.locator('#focus-check').click();
  await page.locator('#check-note').fill('리스트 순회를 복습했다');
  await page.locator('#check-stop').click();
  await page.locator('#check-dialog').waitFor({state:'hidden'});
  await page.locator('[data-open="local-dialog"][data-records]').click();
  await page.locator('#local-history').getByText('공부 내용',{exact:true}).first().click();
  await page.locator('#local-dialog').getByText('리스트 순회를 복습했다',{exact:true}).first().waitFor();
  await page.locator('#local-dialog [data-close]').click();
}
async function webStudy(){
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
    const url=new URL(base);url.searchParams.set('room','parity-'+Date.now().toString(36));
    await page.goto(url.href);
    await page.getByRole('button',{name:'친구 목록 열기'}).filter({hasText:'친구 0명'}).waitFor();
    await page.locator('#invite').click();
    assert.equal(new URL(await page.getByRole('textbox',{name:'초대 링크'}).inputValue()).searchParams.get('room'),url.searchParams.get('room'));
    await page.waitForFunction(()=>[...document.querySelectorAll('#panel img')].some(img=>img.src.startsWith('data:image/png')&&img.naturalWidth>0));
    await page.locator('#panel .close').click();
    await page.locator('#study').click();
    await page.getByLabel('과목',{exact:true}).fill('자료구조');
    await page.getByLabel('이번 목표',{exact:true}).fill('리스트 순회');
    await page.getByRole('button',{name:'공부 시작',exact:true}).click();
    await page.getByLabel('공부한 내용',{exact:true}).fill('리스트 순회를 복습했다');
    await page.getByRole('button',{name:'확인하고 마치기',exact:true}).click();
    await page.getByRole('button',{name:'기록',exact:true}).last().click();
    await page.locator('#panel').getByText(/자료구조.*리스트 순회를 복습했다/).waitFor();
    await page.locator('#panel .close').click();
    await page.reload();await page.locator('#records').click();
    await page.locator('#panel').getByText(/자료구조.*리스트 순회를 복습했다/).waitFor();
    console.log('Public web: invite URL and QR, study record after reload verified');
  }finally{await page.goto('about:blank').catch(()=>{});await page.close();}
}
try{
  const a=await join('첫참가자'),b=await join('두참가자'),c=await join('세참가자');
  for(const page of [a,b,c])await expectFriends(page,2);
  await walk(a,[b,c],'첫참가자');await send(a,[b,c],'세 사람 입장 확인');
  console.log('LAN initial three saw the move and chat');
  await leave(a);for(const page of [b,c])await expectFriends(page,1);
  await walk(b,[c],'두참가자');await walk(c,[b],'세참가자');
  await send(b,[c],'퇴장 후 인사');await send(c,[b],'퇴장 후 답장');
  const d=await join('새참가자');for(const page of [b,c,d])await expectFriends(page,2);
  await walk(d,[b,c],'새참가자');await send(d,[b,c],'새 참가자 인사');await send(b,[c,d],'새 참가자 답장');
  await b.locator('[data-open="invite-dialog"]:visible').first().click();
  const link=new URL(await b.locator('#share-url').inputValue());
  assert.equal(link.pathname,'/r/journey-check');
  await b.waitForFunction(()=>document.querySelector('#invite-qr').naturalWidth>0);
  await b.locator('#invite-dialog [data-close]').click();
  console.log('LAN handoff, two-way movement/chat, QR and fourth participant verified');
  await lanStudy(b);
  for(const page of [b,c,d])await leave(page);
  const info=await (await fetch(lan.replace('/r/','/api/')+'/info')).json();
  assert.equal(info.room.online,0);
  console.log('Isolated LAN: 3 joined, first left, survivors moved/chatted both ways, fourth joined, study and QR, room empty');
  await webStudy();
}catch(error){console.error(error.message);throw error;}finally{
  await Promise.allSettled(participants.map(page=>leave(page,true)));
  await browser.close();
  host.closeAllConnections();await new Promise(resolve=>host.close(resolve));
}
