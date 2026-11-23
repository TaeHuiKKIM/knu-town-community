import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {createStudyServer} from '../src/server.mjs';
import {localTestWeb} from './local-test-web.mjs';

const site=await localTestWeb();
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH});
const errors=[];
async function joined(mode,width,name,url){
  const mobile=width<700;
  const page=await browser.newPage({viewport:{width,height:800},isMobile:mobile,hasTouch:mobile});
  page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  if(mode==='lan'){
    await page.locator('#nickname').fill(name);await page.locator('#join-button').click();
    await page.locator('#player:visible').waitFor();
    await page.locator('[data-open="chat-dialog"]:visible').first().click();
  }else await page.locator('#network').filter({hasText:/친구 \d명/}).waitFor();
  return page;
}
function gap(list){return list.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight);}
function anchor(list){
  return list.evaluate(e=>{
    const top=e.getBoundingClientRect().top;
    const row=Array.from(e.children).find(node=>node.getBoundingClientRect().bottom>top+1);
    return {text:row.textContent,offset:row.getBoundingClientRect().top-top};
  });
}
async function preserved(list,saved,reason){
  const after=await anchor(list);
  assert.equal(after.text,saved.text,reason);
  assert.ok(Math.abs(after.offset-saved.offset)<=2,reason+' offset '+after.offset+' vs '+saved.offset);
}
async function frames(page){
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function exercise(mode,width){
  const lan=mode==='lan';
  let clock=Date.now();
  const server=lan?createStudyServer({hub:true,roomCode:'scroll',now:()=>clock}):null;
  if(server)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=lan?new URL('/r/scroll','http://127.0.0.1:'+server.address().port):new URL(process.env.CAMPUS_WEB_ORIGIN||site.base);
  if(!lan){
    url.searchParams.set('room',randomUUID());
    if(mode==='web')url.searchParams.set('mode','web');else url.searchParams.delete('mode');
  }
  let reader,sender;
  try{
    reader=await joined(mode,width,'독자',url.href);
    sender=await joined(mode,width<700?1280:390,'친구',url.href);
    const list=reader.locator(lan?'#messages':'#log');
    const source=sender.locator(lan?'#chat-input':'#message');
    const ownInput=reader.locator(lan?'#chat-input':'#message');
    let seq=0;
    async function send(message){
      if(lan)clock+=550;
      const text=message??('대화 '+(++seq)+' '+('함께 읽는 긴 메시지 '.repeat(seq%3===0?8:1)).trim());
      await source.fill(text);await source.press('Enter');
      await sender.waitForFunction(sel=>!document.querySelector(sel).value,lan?'#chat-input':'#message',{timeout:6000});
      return text;
    }
    async function receive(text){await list.getByText(text,{exact:lan}).last().waitFor({state:'attached'});await frames(reader);}
    if(!lan)await reader.locator('#network').filter({hasText:'친구 1명'}).waitFor();
    for(let n=0;n<(lan?50:25);n++){
      const text=await send();if(n%6===5||n===(lan?49:24))await receive(text);
    }
    assert.ok(await gap(list)<=2,'arriving messages follow the tail');
    await list.evaluate(e=>{e.scrollTop=e.scrollHeight/2;});
    await frames(reader);
    const saved=await anchor(list);
    const next=await send('친구의 새 소식');await receive(next);
    await preserved(list,saved,'reading position when oldest message expires');
    await reader.setViewportSize({width,height:680});await frames(reader);
    await preserved(list,saved,'reading position after height changes');
    await reader.setViewportSize({width,height:800});await frames(reader);
    if(lan){
      await reader.locator('#chat-dialog [data-close]').click();
      await receive(await send('닫힌 동안 친구가 보낸 소식'));
      await reader.locator('[data-open="chat-dialog"]:visible').first().click();
      await frames(reader);
      await preserved(list,saved,'reopen reading position after incoming messages');
    }
    await list.focus();await reader.keyboard.press('End');
    await reader.waitForFunction(sel=>{const e=document.querySelector(sel);return e.scrollHeight-e.clientHeight-e.scrollTop<3;},lan?'#messages':'#log');
    await receive(await send('최신 메시지 자동 따라가기'));
    assert.ok(await gap(list)<=2);
    await list.focus();await reader.keyboard.press('Home');
    await reader.waitForFunction(sel=>document.querySelector(sel).scrollTop<3,lan?'#messages':'#log');
    await reader.keyboard.press('ArrowDown');
    await reader.waitForFunction(sel=>document.querySelector(sel).scrollTop>8,lan?'#messages':'#log');
    assert.equal(await list.evaluate(e=>e===document.activeElement),true,'arrow keys belong to the history');
    await reader.getByRole('button',{name:'최신 대화'}).click();
    assert.ok(await gap(list)<=2);
    assert.equal(await reader.getByRole('button',{name:'최신 대화'}).isVisible(),false);
    if(width<700){
      const box=await list.boundingBox(),x=box.x+box.width/2,y=box.y+box.height*.25;
      const cdp=await reader.context().newCDPSession(reader);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let step=1;step<=8;step++){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+step*box.height*.06}]});
        await frames(reader);
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await reader.getByRole('button',{name:'최신 대화'}).waitFor();
      await reader.getByRole('button',{name:'최신 대화'}).tap();
      assert.ok(await gap(list)<=2);
    }else{
      await list.hover();await reader.mouse.wheel(0,-250);
      await reader.getByRole('button',{name:'최신 대화'}).waitFor();
      await list.focus();await reader.keyboard.press('PageDown');
      await reader.keyboard.press('End');assert.ok(await gap(list)<=2);
    }
    await list.evaluate(e=>{e.scrollTop=e.scrollHeight/2;});await frames(reader);
    if(lan)clock+=550;
    await ownInput.fill('내가 보낸 답장');await ownInput.press('Enter');await receive('내가 보낸 답장');
    assert.ok(await gap(list)<=2,'sending own message returns to tail');
    await ownInput.press('Escape');
    await reader.waitForFunction(id=>document.activeElement.id===id,lan?'viewport':'world');
    console.log(mode,width+'px: trimmed row, read position, follow, latest, keyboard, own message'+(lan?', reopen':'')+(width<700?', touch':'')+' passed');
  }finally{
    await Promise.all([reader?.context().close(),sender?.context().close()]);
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
}
try{
  for(const [mode,width] of [['lan',390],['lan',1280],['web',390],['direct',1280]]){
    if(!process.argv[2]||process.argv[2]===mode)await exercise(mode,width);
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await site.close();}
