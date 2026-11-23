import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {localTestWeb} from './local-test-web.mjs';
import {STUDENTS} from '../public/campus/sprites/data.js';
import {walkable} from '../public/campus/world.js';

const received=[];
const site=await localTestWeb(body=>{
  if(body.mode==='web'&&body.pose)received.push({room:body.room,name:body.name,pose:body.pose});
});
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH});
const errors=[];
async function participant(name,width=1280){
  const page=await browser.newPage({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({name,studyY})=>{
    localStorage.setItem('knu-web-profile',JSON.stringify({name,avatar:'female',coat:name==='독자'?'burgundy':'navy'}));
    window.readFrames=[];
    window.sawTreeFriend=false;
    const text=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(label,...args){
      if(this.canvas.id==='world'&&label==='나무 친구')window.sawTreeFriend=true;
      return text.call(this,label,...args);
    };
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(img,x,y,...rest){
      if(this.canvas.id==='world' && img?.src?.endsWith('female-burgundy.png') && y===studyY)
        window.readFrames.push(x/96);
      return draw.call(this,img,x,y,...rest);
    };
  },{name,studyY:STUDENTS.female.frame_layout.rows.study_south[0].y});
  return page;
}
async function reading(web){
  const source=await participant('독자',390),friend=await participant('친구');
  const room=randomUUID(),url=new URL(process.env.CAMPUS_WEB_ORIGIN||site.base);
  url.searchParams.set('room',room);
  if(web)url.searchParams.set('mode','web');else url.searchParams.delete('mode');
  try{
    await source.goto(url.href);
    await source.locator('#network').filter({hasText:'친구 0명'}).waitFor();
    await source.locator('#study').click();await source.getByLabel('과목',{exact:true}).fill('읽기');
    await source.getByLabel('이번 목표',{exact:true}).fill('독서 모션 시험');
    await source.getByRole('button',{name:'공부 시작',exact:true}).click();
    await source.getByLabel('공부한 내용').waitFor();
    await source.locator('#panel .close').click();
    await friend.goto(url.href);
    for(const p of [source,friend])await p.waitForFunction(()=>new Set(readFrames).size===4,null,{timeout:45000});
    await friend.emulateMedia({reducedMotion:'reduce'});
    await friend.evaluate(()=>{window.readFrames=[];window.dispatchEvent(new Event('online'));});
    await friend.setViewportSize({width:1279,height:900});
    await friend.waitForFunction(()=>readFrames.includes(0));
    await friend.waitForTimeout(1200);
    assert.deepEqual(await friend.evaluate(()=>[...new Set(readFrames)]),[0]);
    await friend.emulateMedia({reducedMotion:'no-preference'});
    // Only this disposable browser's notebook is moved to the 90-minute check.
    await source.evaluate(()=>new Promise((resolve,reject)=>{
      const req=indexedDB.open('knu-web-study');
      req.onsuccess=()=>{
        const db=req.result,tx=db.transaction('study','readwrite'),s=tx.objectStore('study'),r=s.get('notebook');
        r.onsuccess=()=>{const book=r.result;book.active.from=Date.now()-91*60000;s.put(book,'notebook');};
        tx.oncomplete=()=>{db.close();document.dispatchEvent(new Event('visibilitychange'));resolve();};tx.onerror=()=>reject(tx.error);
      };
    }));
    if(web&&!process.env.CAMPUS_WEB_ORIGIN){
      const waitUntil=Date.now()+8000;
      while(!received.some(p=>p.room===room&&p.name==='독자'&&p.pose.studying&&!p.pose.reading)&&Date.now()<waitUntil)await source.waitForTimeout(100);
      assert.ok(received.some(p=>p.room===room&&p.name==='독자'&&p.pose.studying&&!p.pose.reading));
      assert.ok(received.filter(p=>p.room===room).every(p=>!('studyAt' in p.pose)&&!('subject' in p.pose)&&!('goal' in p.pose)));
    }
    // Allow normal HTTPS polling, then watch beyond an entire gesture cycle.
    await source.waitForTimeout(web?2200:500);
    for(const p of [source,friend]){await p.evaluate(()=>{window.readFrames=[];});await p.setViewportSize({width:p.viewportSize().width-1,height:900});}
    await source.waitForTimeout(5500);
    for(const p of [source,friend])assert.deepEqual(await p.evaluate(()=>[...new Set(readFrames)]),[0]);
    console.log(web?'Web room':'WebRTC','active own/late friend frames 0–3, reduced and waiting frame 0.');
  }finally{await Promise.all([source.context().close(),friend.context().close()]);}
}
async function layers(){
  const room=randomUUID(),reader=await participant('친구'),secret=randomUUID(),name='나무 친구';
  const pose={t:'pose',x:1079,y:858,f:'south',seq:0,scene:'plaza',avatar:'female',coat:'burgundy'};
  assert.ok(walkable(pose.x,pose.y,pose.scene));
  async function peer(patch){
    Object.assign(pose,patch);
    const r=await fetch(site.base+'/api/rendezvous',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({room,secret,name,mode:'web',pose})});assert.equal(r.status,200);return r.json();
  }
  try{
    await reader.emulateMedia({reducedMotion:'reduce'});
    await reader.goto(site.base+'/?mode=web&room='+room);
    await reader.locator('#network').filter({hasText:'친구 0명'}).waitFor();
    const directory=await peer({});
    await reader.locator('#log').getByText(name+' 입장',{exact:true}).waitFor();
    // Compare opaque leaf pixels against the final actor canvas at a walkable tree edge.
    const match=await reader.evaluate(async({x,y,frame})=>{
      const layer=[...document.querySelectorAll('.canopy-layer')].find(n=>n.style.zIndex==='1023');
      const world=document.querySelector('#world'),ctx=world.getContext('2d'),camera=new DOMMatrix(document.querySelector('#landscape').style.transform);
      const sprite=new Image();sprite.src='/female-burgundy.png';await sprite.decode();
      const ref=document.createElement('canvas');ref.width=96;ref.height=128;
      const rc=ref.getContext('2d');rc.drawImage(sprite,frame.x,frame.y,96,128,0,0,96,128);
      const pixels=rc.getImageData(0,0,96,128).data;
      const leaves=layer.getContext('2d').getImageData(0,0,layer.width,layer.height).data;
      const result=ctx.getImageData(0,0,world.width,world.height).data;
      let overlap=0,matched=0;
      for(let j=0;j<128;j++)for(let i=0;i<96;i++){
        const sp=(j*96+i)*4;if(pixels[sp+3]<230)continue;
        const wx=x+(i-47.5)*1.06,wy=y+(j-127.5)*1.06;
        const lx=Math.floor(wx-parseInt(layer.style.left)),ly=Math.floor(wy-parseInt(layer.style.top));
        if(lx<0||ly<0||lx>=layer.width||ly>=layer.height)continue;
        const leaf=(ly*layer.width+lx)*4;if(leaves[leaf+3]<230)continue;
        const screenX=Math.floor(wx*camera.a+camera.e),screenY=Math.floor(wy*camera.d+camera.f);
        if(screenX<0||screenY<0||screenX>=world.width||screenY>=world.height)continue;
        const out=(screenY*world.width+screenX)*4;
        overlap++;
        if(result[out+3]>230 && [0,1,2].every(channel=>Math.abs(result[out+channel]-leaves[leaf+channel])<28))matched++;
      }
      return {overlap,matched};
    },{x:pose.x,y:pose.y,frame:STUDENTS.female.frame_layout.rows.idle_south[0]});
    assert.ok(match.overlap>200&&match.matched>match.overlap*.55,JSON.stringify(match));
    const target=directory.roster.find(p=>p.name==='친구');
    // The entire effect lasts 380 ms. Capture the painted frame in the page
    // before the peer acts, even when automation polls after it disappeared.
    await reader.evaluate(()=>{
      const host=document.querySelector('#web-effects'),world=document.querySelector('#world');
      window.impactSample=null;
      const observer=new MutationObserver(()=>{
        const effect=host.querySelector('canvas.impact[data-rendered=true]');
        if(!effect)return;
        const bounds=effect.getBoundingClientRect(),pixel=effect.getContext('2d').getImageData(64,64,1,1).data;
        window.impactSample={
          center:[...pixel],
          visible:effect.checkVisibility({checkVisibilityCSS:true,checkOpacity:true})&&bounds.width>0&&bounds.height>0,
          foreground:!!(world.compareDocumentPosition(host)&Node.DOCUMENT_POSITION_FOLLOWING),
          passesInput:getComputedStyle(host).pointerEvents==='none',
          cameraAligned:host.style.transform===document.querySelector('#landscape').style.transform
        };
        observer.disconnect();
      });
      observer.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['data-rendered']});
    });
    await peer({x:target.pose.x+8,y:target.pose.y,seq:1,action:'bump',bumpSlot:target.slot});
    await reader.waitForFunction(()=>window.impactSample!==null);
    assert.deepEqual(await reader.evaluate(()=>window.impactSample),{
      center:[255,237,162,255],visible:true,foreground:true,passesInput:true,cameraAligned:true
    });
    assert.equal(await reader.evaluate(()=>sawTreeFriend),true);
    await reader.emulateMedia({reducedMotion:'no-preference'});
    await reader.waitForFunction(()=>document.querySelector('.canopy-layer').style.transform.includes('rotate('));
    await reader.locator('#place').click();
    await reader.getByRole('button',{name:'은행나무길',exact:true}).click();
    await reader.locator('#landscape[data-scene="ginkgo"]').waitFor();
    await reader.locator('#gates button[data-to="plaza"]').waitFor({state:'attached'});
    console.log('Plaza foliage',match,'and real incoming impact above the character canvas.');
  }finally{await reader.context().close();}
}
try{
  await layers();await reading(true);await reading(false);assert.deepEqual(errors,[]);
}finally{await browser.close();await site.close();}
