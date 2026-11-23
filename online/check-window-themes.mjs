import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {createStudyServer} from '../src/server.mjs';

const baseline=process.argv.includes('--before');
const origin=process.env.CAMPUS_WEB_ORIGIN || 'https://knu-direct-plaza.vercel.app';
const out=process.env.CAMPUS_CHECK_IMAGES;
if(out)await mkdir(out,{recursive:true});
const server=createStudyServer({hub:true,roomCode:'panel-check'});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const lanUrl='http://127.0.0.1:'+server.address().port+'/r/panel-check';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH || (existsSync(edge)?edge:undefined)});
const palettes=new Map();
const luminance=color=>{
  const channels=color.match(/[\d.]+/g).slice(0,3).map(s=>Number(s)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
};
async function run(lan,width,height){
  const kind=lan?'lan':'web',page=await browser.newPage({viewport:{width,height},hasTouch:width<500,isMobile:width<500});
  const opened=()=>page.locator('dialog[open]').last();
  const close=async()=>{await opened().locator('button.close').click();};
  const dom=(selector)=>page.locator(selector+':visible').first();
  const click=(selector)=>dom(selector).click();
  async function observe(family,capture=false){
    const dialog=opened();const head=dialog.locator('.dialog-head,.panel-head').first();
    // The web notebook reads IndexedDB before replacing the shared panel.
    // Resolve its actual active screen before sampling its header.
    if(!lan){
      const modes={study:'study',records:'study',shop:'study',wardrobe:'profile',friends:'friends',network:'network',map:'directions',invite:'invite',meetup:'meetup-create'};
      const section=['study','records','shop'].includes(family)?'[data-section="'+family+'"]':'';
      await page.locator('#panel[open][data-mode="'+modes[family]+'"]'+section).waitFor();
    }
    await head.waitFor();await page.evaluate(()=>document.fonts.ready);
    const box=await head.evaluate(el=>{
      const style=getComputedStyle(el),title=el.querySelector('h1,h2')??el,rect=el.getBoundingClientRect();
      const shell=el.closest('dialog'), outer=shell.getBoundingClientRect();
      const shellStyle=getComputedStyle(shell);
      const scrollbar=shell.offsetWidth-shell.clientWidth-parseFloat(shellStyle.borderLeftWidth)-parseFloat(shellStyle.borderRightWidth);
      return {background:style.backgroundColor,ink:getComputedStyle(title).color,top:rect.top,width:rect.width,height:rect.height,
        edges:[rect.left-outer.left,outer.right-rect.right-scrollbar,rect.top-outer.top],
        border:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],
        decoration:[style.borderImageSource,style.boxShadow,style.backgroundImage,style.borderRadius]};
    });
    assert(box.top>=0 && box.width>160 && box.height>=44);
    if(!baseline){
      assert(box.edges.every(px=>px>=-1 && px<=3),'inset title bar '+family+' '+JSON.stringify(box.edges));
      assert(box.border.every(px=>px==='0px'),'framed title bar '+family);
      assert.deepEqual(box.decoration,['none','none','none','0px']);
      const rgb=box.background.match(/[\d.]+/g).slice(0,3).map(Number);
      assert(rgb.every((c,i)=>Math.abs(c-[248,238,217][i])<=25),'strong header tint '+family);
      const light=luminance(box.background),dark=luminance(box.ink);assert((Math.max(light,dark)+.05)/(Math.min(light,dark)+.05)>=4.5,family+' header contrast');
      if(palettes.has(family))assert.equal(box.background,palettes.get(family),family+' palette differs across surfaces');
      else{
        assert(![...palettes.values()].includes(box.background),'different window reused '+box.background+': '+family);
        palettes.set(family,box.background);
      }
    }
    if(out && capture)await page.screenshot({path:path.join(out,kind+'-'+width+'-'+family+(baseline?'-before':'-after')+'.png')});
  }
  async function checkScrolling(){
    const viewport=page.viewportSize();
    await page.setViewportSize({width:Math.min(viewport.width,390),height:380});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const dialog=opened();
    const handle=await dialog.evaluateHandle(node=>[node,...node.querySelectorAll('*')].find(el=>{
      const css=getComputedStyle(el);return el.clientHeight>0 && el.scrollHeight>el.clientHeight+50 && /auto|scroll/.test(css.overflowY);
    }));
    const scroll=handle.asElement();assert(scroll,'No scrolling surface in wardrobe');
    const initial=await scroll.evaluate(el=>({width:getComputedStyle(el).scrollbarWidth,height:el.clientHeight}));
    if(!baseline)assert.equal(initial.width,'thin');
    // Wheel and keyboard scrolls may animate. Wait for the previous motion to
    // settle before testing the opposite edge on a touch-capable browser.
    const settled=()=>scroll.evaluate(el=>new Promise(resolve=>{
      let previous=el.scrollTop,lastChange=performance.now();
      function tick(now){
        if(previous!==el.scrollTop){previous=el.scrollTop;lastChange=now;}
        if(now-lastChange>180)resolve();else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }));
    const bounds=await scroll.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    await page.mouse.wheel(0,900);
    await page.waitForFunction(el=>el.scrollTop>0,scroll);await settled();
    const focusable=await scroll.$('button:visible:not(:disabled)');
    assert(focusable,'No keyboard control in scrollable panel');
    await focusable.focus();await settled();
    await page.keyboard.press('End');
    await page.waitForFunction(el=>el.scrollHeight-el.clientHeight-el.scrollTop<3,scroll);await settled();
    await page.keyboard.press('Home');
    await page.waitForFunction(el=>el.scrollTop<3,scroll);
    if(width<500){
      const session=await page.context().newCDPSession(page);
      const x=Math.round(bounds.x+bounds.width*.65),start=Math.round(bounds.y+bounds.height*.77);
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start}]});
      for(let i=1;i<=5;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:start-14*i}]});
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForFunction(el=>el.scrollTop>10,scroll);
      await session.detach();
    }
    const closeButton=dialog.locator('button.close');
    await closeButton.focus();
    assert(await closeButton.evaluate(el=>el===document.activeElement));
    await page.emulateMedia({forcedColors:'active'});
    if(!baseline){
      assert.equal(await scroll.evaluate(el=>getComputedStyle(el).scrollbarColor),'auto');
      assert(await closeButton.evaluate(el=>getComputedStyle(el).outlineStyle!=='none'));
    }
    await page.emulateMedia({forcedColors:'none'});
    await page.setViewportSize(viewport);
  }
  try{
    page.setDefaultTimeout(16000);
    if(!lan && process.env.CAMPUS_CHECK_LOCAL_BUILD){
      // The release can add controls to index.html as well as JavaScript.
      // Keep the entry document and its client assets on the same revision.
      const html=await readFile(new URL('./dist/index.html',import.meta.url));
      await page.route(url=>url.origin===new URL(origin).origin && url.pathname==='/',route=>route.fulfill({contentType:'text/html',body:html}));
      for(const [name,type] of [['main.js','text/javascript'],['interface.css','text/css'],['style.css','text/css']]){
        const bytes=await readFile(new URL('./dist/'+name,import.meta.url));
        await page.route('**/'+name,route=>route.fulfill({contentType:type,body:bytes}));
      }
    }else if(!lan && process.env.CAMPUS_CHECK_LOCAL_CSS){
      const css=await readFile(new URL('../design/stage1/assets/interface.css',import.meta.url));
      await page.route('**/interface.css',route=>route.fulfill({contentType:'text/css',body:css}));
    }
    await page.goto(lan?lanUrl:origin+'/?room=windows-'+Date.now().toString(36));
    if(lan){await page.locator('#nickname').fill('창 점검');await page.locator('#join-button').click();await page.locator('#player:visible').waitFor();}
    await click(lan?'[data-open="study-dialog"]':'#study');await observe('study',true);
    if(lan){
      await click('#study-plan summary');
      await page.locator('#study-new-subject').fill('색상 확인');
      await click('#study-add-subject button');
      await page.getByRole('button',{name:'색상 확인 과목 삭제'}).click();
      await observe('confirm');await opened().getByRole('button',{name:'취소',exact:true}).click();
      await observe('study');await close();await click('[data-open="local-dialog"][data-records]');await observe('records');
      await click('#local-tab-themes');await observe('shop');
      await click('#local-tab-records');await observe('records');
    }else{
      await opened().getByRole('button',{name:'기록',exact:true}).click();await observe('records');
      await opened().getByRole('button',{name:'상점',exact:true}).click();await observe('shop');
      await opened().getByRole('button',{name:'공부',exact:true}).click();await observe('study');
    }
    await close();await click(lan?'[data-open="wardrobe-dialog"]':'#profile');await observe('wardrobe',true);
    await checkScrolling();await close();await click(lan?'[data-open="people-dialog"]':'#network');await observe('friends',true);
    if(!lan){await opened().getByRole('button',{name:'연결 상태',exact:true}).click();await observe('network');}
    await close();await click(lan?'.scene-chip':'#place');await observe('map');await close();
    await click(lan?'[data-open="invite-dialog"]':'#invite');await observe('invite');
    const create=opened().getByRole('button',{name:/학과·동아리·스터디 모임 만들기/});
    if(!lan && await create.count()){await create.click();await observe('meetup');}
    await close();
    if(lan){
      await click('[data-open="study-dialog"]');await opened().locator('[data-open="tutor-dialog"]').click();await observe('tutor');await close();
      await click('[data-open="room-dialog"]');await observe('menu');await close();
    }
    console.log(kind,width+'×'+height,(baseline?'existing headers captured':'window themes, contrast, scroll and focus verified'));
  }finally{
    if(lan&&await page.locator('#connection[data-mode=online]').count())await page.evaluate(()=>document.querySelector('#leave').click()).catch(()=>{});
    await page.goto('about:blank').catch(()=>{});await page.close();
  }
}
try{for(const lan of [true,false])for(const dims of [[1280,800],[390,844],[320,740]])await run(lan,...dims);}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
