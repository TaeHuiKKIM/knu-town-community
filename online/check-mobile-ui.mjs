import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createStudyServer } from "../src/server.mjs";

const webUrl = process.argv[2];
const server = createStudyServer({roomCode:"ui-audit", hub:true});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const lanUrl = "http://127.0.0.1:" + server.address().port + "/r/ui-audit";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
let browser;

async function checkPanel(page, stateText) {
  const panel = page.locator("dialog[open]").last();
  await panel.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const close = panel.locator("button.close").first();
  const geometry = await close.evaluate(button => {
    const rect = button.getBoundingClientRect(), style = getComputedStyle(button);
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return [rect.width >= 44, rect.height >= 44, button.contains(hit), style.borderImageSource === "none", style.borderTopWidth === "0px"];
  });
  assert(geometry.every(Boolean), "닫기 X의 터치 영역 또는 테두리");
  assert(await panel.evaluate(d => d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "가로 넘침");
  if (stateText === "사용 중") {
    const offers=panel.locator(".shop-offers");
    const geometry=await offers.evaluate(el=>({
      gap:parseFloat(getComputedStyle(el).rowGap),
      heights:[...el.children].map(button=>button.getBoundingClientRect().height),
    }));
    assert(geometry.gap>=8 && geometry.heights.length>=2 && geometry.heights.every(h=>h>=48),"상점 구매 버튼 간격과 크기");
  }
  if (stateText) {
    const state = panel.getByText(stateText, {exact:true}).first();
    const fits = await state.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rows = new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top)));
      return rows.size === 1 && el.scrollWidth <= el.clientWidth + 1;
    });
    assert(fits, stateText + " 줄바꿈 또는 잘림");
  }
  await close.click();
}

async function checkFittingRoom(page, web) {
  const dialog = page.locator("dialog[open]").last();
  const open = web ? page.locator("#profile") : page.locator('[data-open="wardrobe-dialog"]:visible').first();
  const active = dialog.locator(".fitting-caption span");
  const caption = dialog.locator(".fitting-caption strong");
  const coat = dialog.getByRole("button", {name:"네이비",exact:true});
  const apply = web ? dialog.locator(".save-look") : dialog.locator("#apply-outfit");
  await open.click();
  await active.filter({hasText:"입는 중"}).waitFor();
  const original = await caption.textContent();
  // Verify the actual border images load in both LAN and web URL layouts.
  await dialog.locator('button[aria-pressed]').evaluateAll(async buttons=>{
    const frames=new Set(buttons.filter(b=>b.getClientRects().length).map(b=>getComputedStyle(b).borderImageSource));
    for(const frame of frames){
      const url=frame.match(/^url\("(.+)"\)$/);
      if(!url)throw new Error("옷장 버튼 스킨 없음");
      const image=new Image();
      image.src=url[1];await image.decode();
    }
  });
  const controlSize = await coat.evaluate(el=>{
    const r=el.getBoundingClientRect();
    return {width:r.width,height:r.height,gap:parseFloat(getComputedStyle(el.parentElement).columnGap)};
  });
  assert(controlSize.width>=44 && controlSize.height>=44 && controlSize.gap>=8,"과잠 버튼 크기 또는 간격");
  await coat.click();
  await active.filter({hasText:"미리보기"}).waitFor();
  const rotate = dialog.getByRole("button",{name:"돌려 보기"});
  const img = dialog.locator(".fitting-scene canvas");
  await page.waitForFunction(() => {
    const canvas=document.querySelector("dialog[open] .fitting-scene canvas");
    return canvas && canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data.some(value=>value);
  });
  const before = await img.evaluate(canvas=>canvas.toDataURL());
  await rotate.click();
  await page.waitForFunction(previous=>document.querySelector("dialog[open] .fitting-scene canvas").toDataURL()!==previous,before);
  if (web) await dialog.getByRole("button",{name:/애쉬 과잠/}).click();
  else await dialog.locator('[data-look="dressy"]').click();
  assert(await apply.isDisabled(),"미해금 코디 저장");
  if (!web) {
    await dialog.locator('[data-look="dressy"]').press("Home");
    assert.equal(await caption.textContent(),"네이비 과잠","분류 복귀 시 미리보기 선택");
    await dialog.locator('[data-look="coat"]').press("End");
  }
  await checkPanel(page,"미리보기");
  await open.click();
  assert.equal(await caption.textContent(),original,"닫은 뒤 미리보기가 적용됨");
  await coat.click();
  await apply.click();
  await dialog.waitFor({state:"hidden"});
  await open.click();
  await active.filter({hasText:"입는 중"}).waitFor();
  assert.equal(await caption.textContent(),"네이비 과잠");
  await checkPanel(page,"입는 중");
}

try {
  browser = await chromium.launch({executablePath:process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined)});
  for (const [width,height] of [[320,740],[360,800],[390,844],[667,375],[1280,850]]) {
    const page = await browser.newPage({viewport:{width,height}, hasTouch:width<800, isMobile:width<800});
    try {
      await page.goto(lanUrl);
      await page.locator("#nickname").fill("화면점검");
      await page.locator("#join-button").click();
      await checkFittingRoom(page,false);
      await page.locator('[data-open="local-dialog"]:visible').first().click();
      await page.locator("#local-tab-themes").click();
      await checkPanel(page,"사용 중");
      if (webUrl) {
        const address = new URL(webUrl);
        address.searchParams.set("room","ui-audit-"+Date.now().toString(36));
        await page.goto(address.href);
        await checkFittingRoom(page,true);
        await page.locator("#study").click();
        await page.getByRole("button",{name:"상점",exact:true}).click();
        await checkPanel(page,"사용 중");
      }
      console.log(width+"×"+height+" OK");
    } finally {await page.close();}
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
