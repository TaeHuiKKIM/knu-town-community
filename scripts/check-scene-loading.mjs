import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {SCENES} from '../public/campus/scenes.js';
import {createStudyServer} from '../src/server.mjs';
const {chromium}=createRequire(new URL('../online/package.json',import.meta.url))('playwright-core');
const host=createStudyServer({hub:true,roomCode:'main',studyPath:':memory:',tutor:null});
const root=new URL('../online/dist/',import.meta.url);
const web=http.createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!/^[a-z0-9./_-]+$/i.test(path)||path.includes('..')||path.startsWith('api/'))throw Error();
    const mime={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',woff2:'font/woff2'}[path.split('.').at(-1)];
    const bytes=await readFile(new URL(path,root));res.writeHead(200,{'Content-Type':mime||'application/octet-stream'});res.end(bytes);
  }catch{res.writeHead(404).end();}
});
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>{s.close(r);s.closeAllConnections();});
await Promise.all([listen(web),listen(host)]);
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try {
  for(const mode of ['web','lan']){
    for(const [width,height] of [[1280,800],[390,844]]){
      const ctx=await browser.newContext({viewport:{width,height},hasTouch:width<500,reducedMotion:'reduce'});
      const page=await ctx.newPage();page.setDefaultTimeout(12000);
      const browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));
      const base='http://127.0.0.1:'+(mode==='web'?web:host).address().port;
      let release,started,attempts=0;
      const began=new Promise(r=>{started=r;});
      const hold=new Promise(r=>{release=r;});
      const image=mode==='web'?'**/library.png':'**/assets/library-lounge-v2.png';
      await page.route(image,async route=>{attempts++;started();await hold;await route.continue();});
      async function go(target,painted=false){
        if(mode==='lan' && width>600 && painted){
          const origin=await page.locator('#world').getAttribute('data-scene');
          const gate=SCENES[origin].portals.find(p=>p.target===target);
          const screen=await page.locator('#world').evaluate((el,g)=>{
            const b=el.getBoundingClientRect();
            return {x:b.left+b.width*g.x/1536,y:b.top+b.height*g.y/1024};
          },gate);
          await page.mouse.click(screen.x,screen.y);return;
        }
        if(mode==='web'){
          await page.locator('#place').click();
          const label=await page.locator('#gates [data-to="'+target+'"]').textContent();
          await page.locator('#panelbody button').filter({hasText:label}).click();
        }else{
          await page.locator('[data-open="scene-dialog"]').first().click();
          await page.locator('#scene-list button').filter({hasText:SCENES[target].name}).click();
        }
      }
      await page.goto(base+(mode==='web'?'/?room=qa-scene':'/r/main'));
      if(mode==='lan'){await page.locator('#nickname').fill('장소테스트');await page.locator('#nickname').press('Enter');await page.locator('#player:not([hidden])').waitFor();}
      const showScene=name=>page.waitForFunction(({id,name})=>[document.getElementById(id).textContent,document.getElementById(id).getAttribute('aria-label')].some(label=>label?.includes(name)),{id:mode==='web'?'place':'scene-label',name});
      const location=page.locator(mode==='web'?'#place':'#scene-label');
      const art=page.locator(mode==='web'?'#web-scene-art':'#scene-art');
      await go('lounge',true);await Promise.race([began,page.waitForTimeout(9000).then(()=>{throw Error('no image request');})]);
      await page.waitForTimeout(1600);
      const during=await location.textContent();
      const oldPixels=await art.evaluate(el=>el.complete&&el.naturalWidth>0&&el.src.includes('plaza'));
      release();
      assert.match(during,/일청담/,mode+' changed the scene while its background was unavailable');
      await page.waitForFunction(id=>document.getElementById(id).textContent.includes('도서관'),mode==='web'?'place':'scene-label');
      assert.ok(oldPixels,'original plaza pixels remain visible during delay');
      const ready=await art.evaluate(el=>el.complete&&el.naturalWidth>0&&el.src.includes('librar'));
      assert.ok(ready,'destination pixels are available when the location changes');
      await go('plaza');
      await page.waitForFunction(id=>document.getElementById(id).textContent.includes('일청담'),mode==='web'?'place':'scene-label');
      await go('lounge');await page.waitForFunction(id=>document.getElementById(id).textContent.includes('도서관'),mode==='web'?'place':'scene-label');
      assert.equal(attempts,1,'returning to a recent map reuses its decoded image');
      console.log(mode+' '+width+'x'+height+': 1.6s hold, origin retained, loaded destination, cached return passed');
      await go('plaza');await showScene('일청담');
      let fail=true;
      const failedImage=mode==='web'?'**/it.png':'**/assets/it-college-v2.png';
      await page.route(failedImage,async route=>fail?route.abort('failed'):route.continue());
      await go('it');
      const retry=page.locator(mode==='web'?'#scene-art-retry':'#scene-retry');
      await retry.waitFor();
      assert.match(await location.textContent(),/일청담/);
      fail=false;await retry.click();await showScene(SCENES.it.name);
      await go('it4');await showScene(SCENES.it4.name);
      let resumeLecture,lectureStart;
      const beganLecture=new Promise(r=>{lectureStart=r;});
      const lectureHold=new Promise(r=>{resumeLecture=r;});
      await page.route(mode==='web'?'**/lecture.png':'**/assets/lecture-hall-v3.png',async route=>{lectureStart();await lectureHold;await route.continue();});
      await go('lecture',true);
      await Promise.race([beganLecture,page.waitForTimeout(9000).then(()=>{throw Error('no classroom request');})]);
      await page.waitForTimeout(1600);
      assert.match(await location.textContent(),/4호관/);
      assert.ok(await art.evaluate(el=>el.complete&&el.naturalWidth>0&&el.src.includes('it4')));
      resumeLecture();await showScene(SCENES.lecture.name);
      assert.ok(await art.evaluate(el=>el.complete&&el.naturalWidth>0&&el.src.includes('lecture')));
      console.log(mode+' '+width+'x'+height+': failed load kept plaza, retry succeeded, IT4 stayed visible during 1.6s lecture hold');
      assert.deepEqual(browserErrors,[]);await ctx.close();
    }
  }
}finally{await browser.close();await Promise.all([close(host),close(web)]);}
