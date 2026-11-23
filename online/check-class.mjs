import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {localTestWeb} from './local-test-web.mjs';

const site=await localTestWeb();
const browserBase=process.argv[2]||site.base;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
const faults=[];
async function participant(name,width) {
  const page=await browser.newPage({viewport:{width,height:844},isMobile:width<600,hasTouch:width<600});
  await page.addInitScript(n=>{
    localStorage.setItem('knu-web-profile',JSON.stringify({name:n,avatar:'female',coat:'navy'}));
    window.classProbe={poses:[],labels:[]};
    function record(p){
      if(p?.t!=='pose')return;
      classProbe.poses.push(p);
      if(classProbe.poses.length>300)classProbe.poses.shift();
    }
    const send=RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send=function(payload){
      if(typeof payload==='string')record(JSON.parse(payload));
      return send.call(this,payload);
    };
    const request=window.fetch;
    window.fetch=function(input,init){
      if(input==='/api/rendezvous'&&init?.body)record(JSON.parse(init.body).pose);
      return request.call(this,input,init);
    };
    const fill=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(label,...args){
      if(label.includes('수업중')&&!classProbe.labels.includes(label))classProbe.labels.push(label);
      return fill.call(this,label,...args);
    };
  },name);
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>faults.push(error.message));
  return page;
}
async function travel(page,destination){
  const name=await page.locator('#gates [data-to="'+destination+'"]').textContent();
  await page.locator('#place').click();
  await page.locator('.destination-card').filter({hasText:name}).click();
  await page.locator('#landscape[data-scene="'+destination+'"]').waitFor();
}
async function friendStatus(page,place,inClass){
  if(!await page.locator('#friend-list').isVisible())await page.locator('#network').click();
  await page.waitForFunction(({place,inClass})=>[...document.querySelectorAll('#friend-list .friend-row')].some(row=>
    row.querySelector('strong')?.textContent==='풀잎'&&row.querySelector('small')?.textContent===place+(inClass?' · 수업중':'')),{place,inClass});
}
async function journey(web){
  const host=await participant('풀잎',web?390:1280);
  const guest=await participant('연두',web?1280:390);
  const url=new URL(browserBase);
  url.searchParams.set('room',randomUUID());
  if(web)url.searchParams.set('mode','web');else url.searchParams.delete('mode');
  try{
    await host.goto(url.href);
    await host.locator('#network').filter({hasText:'친구 0명'}).waitFor();
    const toggle=host.locator('#class-toggle');
    assert.equal(await toggle.isVisible(),false,'no class in plaza');
    await travel(host,'it');
    await host.getByRole('button',{name:'수업 듣기',exact:true}).click();
    assert.equal(await toggle.getAttribute('aria-pressed'),'true');
    assert.ok(await toggle.isVisible());
    const control=await toggle.boundingBox();
    assert.ok(control.x>=0&&control.x+control.width<=host.viewportSize().width+1&&control.height>=44,'tappable class control');
    await guest.goto(url.href);
    await friendStatus(guest,'IT대학 융복합관',true);
    await guest.locator('#panel .close').click();
    await travel(guest,'it');
    await guest.waitForFunction(()=>classProbe.labels.includes('풀잎 · 수업중'));
    await host.waitForFunction(()=>classProbe.poses.some(p=>p.scene==='it'&&p.inClass===true&&p.studying===false));
    await host.locator('#world').focus();
    await host.keyboard.down('ArrowUp');
    await host.waitForTimeout(650);
    await host.keyboard.up('ArrowUp');
    await host.locator('#quick-jump[data-action="점프"]').waitFor();
    await host.keyboard.press('Space');
    await host.waitForFunction(()=>classProbe.poses.some(p=>p.inClass===true&&p.action==='jump')&&
      new Set(classProbe.poses.filter(p=>p.inClass===true).map(p=>p.y)).size>1);
    await host.getByRole('button',{name:'수업중 · 끝내기'}).click();
    await friendStatus(guest,'IT대학 융복합관',false);
    await host.getByRole('button',{name:'수업 듣기',exact:true}).click();
    await friendStatus(guest,'IT대학 융복합관',true);
    await guest.reload();
    await friendStatus(guest,'IT대학 융복합관',true);
    await travel(host,'it4');
    await friendStatus(guest,'IT대학 4호관',false);
    assert.equal(await toggle.isVisible(),false);
    await travel(host,'lecture');
    assert.equal(await toggle.isVisible(),false);
    await travel(host,'it4');
    await travel(host,'it');
    assert.equal(await toggle.getAttribute('aria-pressed'),'false');
    await host.getByRole('button',{name:'수업 듣기',exact:true}).click();
    await friendStatus(guest,'IT대학 융복합관',true);
    await host.reload();
    await host.locator('#landscape[data-scene="plaza"]').waitFor();
    await friendStatus(guest,'일청담 광장',false);
    assert.equal(await toggle.isVisible(),false);
    assert.ok(await host.evaluate(()=>!localStorage.getItem('knu-web-profile').includes('inClass')));
    console.log((web?'Web room':'RTCDataChannel')+' passed: late join, nameplate, walk and Space, end/resume, viewer reload, IT4 classroom round trip, host reload.');
  }finally{await Promise.all([host.context().close(),guest.context().close()]);}
}
try {
  const registration={name:'풀잎',room:randomUUID(),secret:randomUUID(),mode:'web'};
  const basePose={x:768,y:700,avatar:'female',coat:'navy',f:'north'};
  async function checkedPose(scene,fields){
    const response=await fetch(site.base+'/api/rendezvous',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...registration,pose:{...basePose,scene,...fields}})});
    assert.equal(response.status,200);
    return (await response.json()).roster[0].pose;
  }
  for(const [scene,value,expected] of [['it',true,true],['it',false,false],['it','true',false],['it',1,false],['lecture',true,false],['it4',true,false],['plaza',true,false],['unknown',true,false]]){
    const pose=await checkedPose(scene,{inClass:value,realName:'unused'});
    assert.equal(pose.inClass,expected,scene+' with '+JSON.stringify(value));
    assert.ok(!Object.hasOwn(pose,'realName'));
    assert.equal(pose.studying,false);
  }
  assert.equal((await checkedPose('it',{})).inClass,false,'older clients');
  console.log('Room handler checks passed.');
  await journey(true);
  await journey(false);
  assert.deepEqual(faults,[]);
}finally{await browser.close();await site.close();}
