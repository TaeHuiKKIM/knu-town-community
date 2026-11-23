import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createStudyServer} from '../src/server.mjs';

const server=createStudyServer({hub:true,roomCode:'main'});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH});
try {
  async function join(url,width,name) {
    const page=await browser.newPage({viewport:{width,height:844},hasTouch:width<600});
    page.setDefaultTimeout(12000);
    await page.goto(url);
    await page.locator('#nickname').fill(name);
    await page.locator('#join-button').click();
    await page.locator('#player:visible').waitFor();
    return page;
  }
  const host=await join(base+'/r/main',1280,'달');
  await host.getByRole('button',{name:'광장 이동',exact:true}).first().click();
  await host.getByText('친구 광장 만들기',{exact:true}).click();
  await host.getByLabel('광장 이름').fill('공강 모임');
  await host.getByLabel('함께할 일').selectOption({label:'과팅'});
  await host.locator('#space-create').click();
  await host.waitForURL(url=>url.pathname.startsWith('/r/')&&url.pathname!=='/r/main');
  await host.locator('#player:visible').waitFor();
  const guest=await join(host.url(),320,'별');
  for(const page of [host,guest]) {
    await page.locator('[data-open="chat-dialog"]:visible').first().click();
    await page.locator('#social-topics summary').waitFor();
  }
  await guest.getByText('첫 만남 질문',{exact:true}).click();
  assert.ok(await guest.locator('#social-question').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
  const question='우리 학과를 음식 하나로 소개한다면?';
  await guest.getByLabel('대화 주제').selectOption({label:question});
  await guest.locator('#social-send').click();
  await host.locator('#messages').getByText(question,{exact:true}).waitFor();
  const plaza=await join(base+'/r/main',390,'해');
  await plaza.locator('[data-open="chat-dialog"]:visible').first().click();
  assert.equal(await plaza.locator('#social-topics').isVisible(),false);
  assert.equal(await plaza.locator('#messages').getByText(question,{exact:true}).count(),0);
  console.log('LAN desktop creation, 320px invited guest, question delivery and main plaza isolation passed.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
