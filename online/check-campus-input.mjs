import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {createStudyServer} from '../src/server.mjs';

const webBase=process.argv[2] || 'https://knu-direct-plaza.vercel.app';
const server=createStudyServer({hub:true,roomCode:'input-check'});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const lanBase=process.env.CAMPUS_CHECK_URL || 'http://127.0.0.1:'+server.address().port+'/r/input-check';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH || (existsSync(edge)?edge:undefined)});
const output=process.env.CAMPUS_CHECK_IMAGES;
if(output)await mkdir(output,{recursive:true});

async function capture(page,file){
  if(output)await page.screenshot({path:path.join(output,file+'.png')});
}
async function physical(stage,type,code,key,extra={}){
  await stage.dispatchEvent(type,{bubbles:true,cancelable:true,code,key,...extra});
}

async function checkLibraryHud(page,lan,width,height){
  const map=page.locator(lan?'#world':'#landscape');
  if(lan){
    await page.locator('.scene-chip').click();
    await page.locator('#scene-list').getByRole('button',{name:/도서관/}).click();
    await page.locator('#world[data-scene=lounge]').waitFor();
  }else{
    await page.locator('#place').click();
    await page.locator('.destination-card').filter({hasText:'도서관'}).click();
    await page.locator('#seat-list').waitFor();
  }
  const use=page.locator(lan?'#jump':'#quick-jump');
  const point=await map.evaluate(el=>{
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width*855/1536,y:r.top+r.height*856/1024};
  });
  if(lan){
    await page.mouse.click(point.x,point.y);
    await use.locator('.action-verb').filter({hasText:'은행나무길 가기'}).waitFor();
  }else{
    await page.locator('#quick-jump[data-action="광장 가기"]').waitFor();
    await page.locator('#world').focus();
    await page.keyboard.down('KeyD');
    try{await use.locator('.action-verb').filter({hasText:'은행나무길 가기'}).waitFor();}
    finally{await page.keyboard.up('KeyD');}
  }
  for(const [w,h] of (width===390?[[320,740],[360,800],[390,844],[667,375]]:[[width,height]])){
    await page.setViewportSize({width:w,height:h});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const issues=await page.evaluate(l=>{
      const selectors=l?['#jump .action-verb','#find-seat','.gesture-toggle','.bottom-dock button span']:['#quick-jump .action-verb','#place','.play-tools button','.campus-dock button'];
      const issues=[];
      for(const selector of selectors)for(const item of document.querySelectorAll(selector)){
        if(!item.checkVisibility())continue;
        const parent=item.closest('button'), box=parent.getBoundingClientRect();
        const range=document.createRange(); const text=[...item.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
        if(!text)continue;
        range.selectNodeContents(text);const r=range.getBoundingClientRect();
        if(range.getClientRects().length!==1 || r.left<box.left+2 || r.right>box.right-2 || box.left<0 || box.right>innerWidth+.5 || box.bottom>innerHeight+.5)
          issues.push([selector,item.textContent.trim(),r.left,r.right,box.left,box.right]);
      }
      const action=document.querySelector(l?'#jump':'#quick-jump').getBoundingClientRect();
      const joy=document.querySelector(l?'#joystick':'#stick').getBoundingClientRect();
      if(joy.width && action.left<joy.right && action.bottom>joy.top)issues.push('action covers joystick');
      if(l){
        const place=document.querySelector('.scene-chip').getBoundingClientRect();
        const choices=document.querySelector('.map-actions').getBoundingClientRect();
        if(choices.left-place.right<5)issues.push(['short toolbar gutter',choices.left-place.right]);
      }
      const dock=document.querySelector(l?'.bottom-dock .ui-icon':'.campus-dock button');
      const iconWidth=l?dock.getBoundingClientRect().width:parseFloat(getComputedStyle(dock,'::before').backgroundSize);
      if(iconWidth*19/32<20)issues.push(['small icon',iconWidth]);
      return issues;
    },lan);
    assert.deepEqual(issues,[],(lan?'LAN':'Web')+' '+w+'px library controls');
    await capture(page,(lan?'lan':'web')+'-'+w+'-library-exit');
  }
}
async function run(mode,width,height){
  const lan=mode==='lan', mobile=width<500;
  const page=await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
  page.setDefaultTimeout(16000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.addInitScript(()=>{
      const proto=CanvasRenderingContext2D.prototype,write=proto.fillText,ellipse=proto.ellipse;
      proto.fillText=function(label,x,y,...rest){
        if(this.canvas.id==='world'&&String(label).endsWith(' · 나'))this.canvas.dataset.nameX=String(x);
        return write.call(this,label,x,y,...rest);
      };
      proto.ellipse=function(x,y,rx,ry,...rest){
        if(this.canvas.id==='world'&&rx<18&&rx>=10&&Math.abs(ry-rx*5/18)<0.01)this.canvas.dataset.jumped='true';
        return ellipse.call(this,x,y,rx,ry,...rest);
      };
    });
    if(!lan&&process.env.CAMPUS_CHECK_DIST){
      for(const file of ['main.js','style.css','interface.css','index.html']){
        const pattern=file==='index.html'?'**/?room=*':'**/'+file;
        await page.route(pattern,route=>route.fulfill({path:path.resolve(process.env.CAMPUS_CHECK_DIST,file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}));
      }
    }
    // Only the isolated test host delays movement. Room/session APIs otherwise run normally.
    if(lan && !process.env.CAMPUS_CHECK_URL){
      await page.route('**/api/*/action',async route=>{
        if(route.request().postDataJSON()?.type==='campus-move')await new Promise(resolve=>setTimeout(resolve,950));
        await route.continue().catch(()=>{});
      });
    }
    await page.goto(lan?lanBase:webBase+'/?room=input-'+Date.now().toString(36)+(process.env.PLAZA_CHECK_WEB==='1'?'&mode=web':''));
    if(lan){await page.locator('#nickname').fill('조작 점검');await page.locator('#join-button').click();await page.locator('#player:visible').waitFor();}
    else await page.getByRole('button',{name:'친구 목록 열기'}).filter({hasText:'친구 0명'}).waitFor();
    const stage=page.locator(lan?'#viewport':'#world'), action=page.locator(lan?'#jump':'#quick-jump');
    const readX=()=>page.evaluate(l=>l?parseFloat(document.querySelector('#player').style.left):Number(document.querySelector('#world').dataset.nameX),lan);
    const actionNamed=label=>page.locator((lan?'#jump':'#quick-jump')+'[data-action="'+label+'"]');
    await actionNamed('점프').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await capture(page,mode+'-'+width+'-plaza');
    const bounds=await page.evaluate(l=>{
      const dock=document.querySelector(l?'.bottom-dock':'footer');
      const buttons=[...dock.querySelectorAll('button')].map(el=>el.getBoundingClientRect());
      const heading=document.querySelector('header');
      return {first:Math.min(...buttons.map(el=>el.top)),bottom:Math.max(...buttons.map(el=>el.bottom)),top:heading.getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth};
    },lan);
    assert(!bounds.overflow && bounds.bottom<=height-2 && bounds.first>bounds.top,'게임 메뉴가 화면 밖으로 잘림 '+JSON.stringify(bounds));
    await stage.focus();
    const x=await readX();
    await physical(stage,'keydown','KeyD','ㅇ',{keyCode:229});
    await page.waitForTimeout(270);
    await physical(stage,'keyup','KeyD','ㅇ');
    assert(await readX()>x+10,'한글 배열 D 이동 실패');
    const stop=await readX();
    await physical(stage,'keydown','KeyA','ㅁ',{isComposing:true});
    await page.waitForTimeout(120);await physical(stage,'keyup','KeyA','ㅁ');
    assert(Math.abs(await readX()-stop)<2,'조합 중 게임으로 이동');
    await stage.press('Enter');
    const chat=page.locator(lan?'#chat-input':'#message');
    assert(await chat.evaluate(el=>el===document.activeElement));
    await chat.fill('한글');await chat.press('Space');await chat.press('d');
    assert.equal(await chat.inputValue(),'한글 d');assert(Math.abs(await readX()-stop)<2);
    if(lan && !process.env.CAMPUS_CHECK_URL){await chat.press('Enter');await page.locator('#messages').getByText('한글 d',{exact:true}).last().waitFor();}
    await chat.fill('');await chat.press('Escape');await page.waitForFunction(id=>document.activeElement.id===id,lan?'viewport':'world');
    if(lan){
      // Walk into the painted library portal, including its server-confirmed transition.
      if(!mobile){
        const point=await page.locator('#world').evaluate(el=>{const b=el.getBoundingClientRect();return {x:b.left+b.width*1080/1536,y:b.top+b.height*410/1024};});
        await page.mouse.click(point.x,point.y);
      }else{
        await page.locator('.scene-chip').tap();await page.locator('#scene-list').getByRole('button',{name:/도서관/}).tap();
      }
      await page.locator('#world[data-scene=lounge]').waitFor();
    }else{
      await page.locator('#place').click();await page.locator('.destination-card').filter({hasText:'도서관'}).click();
      await page.locator('#seat-list').waitFor();
    }
    if(!mobile){
      // At the library door turn inward until an empty chair is the closest interaction.
      await stage.focus();await physical(stage,'keydown','KeyW','ㅈ');
      try{await actionNamed('앉기').waitFor({timeout:4200});}finally{await physical(stage,'keyup','KeyW','ㅈ');}
      await physical(stage,'keydown','Space','Process',{keyCode:229});
      for(let index=0;index<4;index++){await page.waitForTimeout(150);await physical(stage,'keydown','Space',' ',{repeat:true});}
      await physical(stage,'keyup','Space',' ');
    }else{
      const list=page.locator(lan?'#find-seat':'#seat-list');await list.tap();
      if(lan){assert.equal(await page.locator('#seat-options option').count(),30);await page.locator('#seat-options').selectOption('lounge-west-1');await page.locator('#take-seat').tap();}
      else await page.getByRole('button',{name:'1번 · 빈자리',exact:true}).tap();
    }
    await actionNamed('일어나기').waitFor();
    if(lan)await page.locator('#player.seated').waitFor();
    await page.waitForTimeout(400);await capture(page,mode+'-'+width+'-seated');
    if(mobile)await action.tap();else await stage.press('Space');
    await actionNamed('앉기').waitFor();
    if(!mobile){
      // Use the same control again from the approach point and stand without bouncing back.
      await stage.press('Space');await actionNamed('일어나기').waitFor();
      await stage.press('Space');await actionNamed('앉기').waitFor();
    }
    if(lan){
      await page.locator('.scene-chip').click();await page.locator('#scene-list').getByRole('button',{name:/일청담/}).click();await page.locator('#world[data-scene=plaza]').waitFor();
    }else{
      await page.locator('#place').click();await page.locator('.destination-card').filter({hasText:'일청담'}).click();
      await page.locator('#seat-list').waitFor({state:'hidden'});
      await stage.focus();await page.keyboard.down('KeyA');await page.waitForTimeout(620);await page.keyboard.up('KeyA');
    }
    await actionNamed('점프').waitFor();await stage.focus();
    if(lan){
      const sent=page.waitForResponse(resp=>resp.url().endsWith('/action')&&resp.request().postDataJSON()?.type==='jump'&&resp.ok());
      await stage.press('Space');await sent;
      await page.waitForFunction(()=>parseFloat(document.querySelector('#player').style.getPropertyValue('--actor-lift'))<0);
    }else{await stage.press('Space');await page.locator('#world[data-jumped=true]').waitFor();}
    await checkLibraryHud(page,lan,width,height);
    assert.deepEqual(errors,[]);
    console.log(mode,width+'×'+height,'Korean-layout movement, chat focus, seating, stand, jump and dock bounds OK');
  }catch(error){
    console.error(mode,width,await page.locator(lan?'#toast':'#notice').textContent(),await page.locator(lan?'#jump':'#quick-jump').innerText());throw error;
  }finally{
    if(lan && await page.locator('#connection[data-mode=online]').count()){
      await Promise.all([
        page.waitForResponse(resp=>resp.url().endsWith('/action')&&resp.request().postDataJSON()?.type==='leave',{timeout:5000}),
        page.evaluate(()=>document.querySelector('#leave').click())
      ]).catch(()=>{});
    }
    await page.close();
  }
}
try{
  for(const mode of (process.env.CAMPUS_CHECK_MODE?[process.env.CAMPUS_CHECK_MODE]:['lan','web']))
    for(const [width,height] of [[1280,800],[390,844]])await run(mode,width,height);
}finally{
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
