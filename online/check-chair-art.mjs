import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {localTestWeb} from './local-test-web.mjs';
import {createStudyServer} from '../src/server.mjs';
import {SCENES} from '../public/campus/scenes.js';

const lanServer=createStudyServer({hub:true,roomCode:'chairs'});
await new Promise(resolve=>lanServer.listen(0,'127.0.0.1',resolve));
const web=await localTestWeb();
const webOrigin=process.env.CAMPUS_WEB_ORIGIN || web.base;
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH || (existsSync(edge)?edge:undefined)});
const out=process.env.CAMPUS_CHECK_IMAGES;
if(out)await mkdir(out,{recursive:true});

async function check(lan,width){
  const mode=lan?'lan':'web',mobile=width<600;
  const p=await browser.newPage({viewport:{width,height:mobile?844:820},hasTouch:mobile,isMobile:mobile});
  const errors=[];
  p.on('pageerror',err=>errors.push(err.message));
  const mapSelector=lan?'#world':'#landscape';
  const map=p.locator(mapSelector),stage=p.locator(lan?'#viewport':'#world'),use=p.locator(lan?'#jump':'#quick-jump');
  const waitText=(expression)=>use.filter({hasText:expression}).waitFor({timeout:25000});
  const screenshot=async label=>{if(out)await p.screenshot({path:path.join(out,mode+'-'+width+'-'+label+'.png')});};
  async function travel(scene){
    if(lan){
      await p.locator('.scene-chip').click();
      await p.locator('#scene-list .scene-card').filter({hasText:SCENES[scene].name}).click();
    }else{
      const title=await p.locator('#gates [data-to="'+scene+'"]').textContent();
      await p.locator('#place').click();
      await p.locator('.destination-card').filter({hasText:title}).click();
    }
    await p.locator(mapSelector+'[data-scene="'+scene+'"]').waitFor();
  }
  async function point(x,y){
    const at=await map.evaluate((node,[x,y])=>{
      const box=node.getBoundingClientRect(),cx=box.left+x*box.width/1536,cy=box.top+y*box.height/1024;
      const hit=document.elementFromPoint(cx,cy);
      return {x:cx,y:cy,onMap:hit?.id==='world'||!!hit?.closest('#world,#viewport')};
    },[x,y]);
    assert(at.onMap,'Tap outside the visible game '+JSON.stringify({mode,width,x,y,at}));
    if(mobile)await p.touchscreen.tap(at.x,at.y);else await p.mouse.click(at.x,at.y);
  }
  async function stand(){
    if(mobile)await use.click();
    else{await stage.focus();await p.keyboard.press('Space');}
    await p.waitForFunction(id=>!document.getElementById(id).textContent.includes('일어나기'),lan?'jump':'quick-jump');
  }
  try{
    p.setDefaultTimeout(20000);
    if(lan){
      await p.goto('http://127.0.0.1:'+lanServer.address().port+'/r/chairs');
      await p.locator('#nickname').fill('의자 확인');await p.locator('#join-button').click();await p.locator('#player:visible').waitFor();
    }else{
      const invite=new URL('/',webOrigin);invite.searchParams.set('mode','web');invite.searchParams.set('room',randomUUID());
      await p.goto(invite.href);await p.locator('#network').filter({hasText:'친구 0명'}).waitFor();
    }
    for(const scene of ['it','it4','lecture'])await travel(scene);
    await point(665,765); // The white top of the last desk, above its third chair.
    await waitText(/3번.*왼쪽 4번째 책상.*일어나기/);
    if(lan){
      const top=await p.locator('#player').evaluate(node=>parseFloat(getComputedStyle(node,'::after').bottom)+parseFloat(getComputedStyle(node,'::after').height));
      assert.equal(top,56,'The backrest overlay must line up with the actual 56px chair');
    }
    await screenshot('lecture');
    await stand();await waitText(/앉기/);
    if(mobile)await use.click();else await p.keyboard.press('Space');
    await waitText(/일어나기/);await stand();
    for(const scene of ['it4','it','plaza','lounge'])await travel(scene);
    await point(727,632); // Visible corner of the backrest on the far side of the round table.
    await waitText(/일어나기/);
    const first=await use.textContent();
    await point(795,706); // Select the other far-side seat through the tabletop while seated.
    await p.waitForFunction(({id,first})=>{
      const text=document.getElementById(id).textContent;
      return text.includes('일어나기') && text!==first;
    },{id:lan?'jump':'quick-jump',first},{timeout:10000});
    await screenshot('library');await stand();
    await travel('plaza');
    // The west pond bench is painted into the background, with its own approach aisle.
    await point(853,703);
    await waitText(/일어나기/);await screenshot('pond');await stand();
    assert.deepEqual(errors,[]);
    console.log(mode,width,'passed: illustrated desk, backrest, seated chair switch, Space/touch, outdoor bench');
  }catch(error){
    console.error(mode,width,await use.textContent(),await map.getAttribute('data-scene'),await p.locator('#toast').allTextContents());
    if(out)await screenshot('failure');
    throw error;
  }finally{
    if(lan)await p.evaluate(()=>document.querySelector('#leave')?.click()).catch(()=>{});
    await p.goto('about:blank').catch(()=>{});await p.close();
  }
}
try{
  const cases=process.argv.slice(2);
  for(const [mode,width] of [['lan',1280],['web',1280],['lan',390],['web',390]]){
    if(!cases.length || cases.includes(mode+width))await check(mode==='lan',width);
  }
}finally{
  await browser.close();await web.close();lanServer.closeAllConnections();await new Promise(r=>lanServer.close(r));
}
