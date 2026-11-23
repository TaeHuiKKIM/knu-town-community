import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const args = process.argv[2] || "https://knu-direct-plaza.vercel.app";
const web = process.env.PLAZA_CHECK_WEB === "1";
const url =
  args + "/?room=qa-" + Date.now().toString(36) + (web ? "&mode=web" : "");
const b = await chromium.launch({
  executablePath:
    process.env.BROWSER_PATH ||
    (existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")
      ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
      : undefined),
  headless: true,
});
const pages = [];
async function enter(name) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch:true });
  pages.push(p);
  if (web)
    await p.addInitScript(() => {
      window.RTCPeerConnection = class {
        constructor() {
          throw Error("Direct transport unavailable");
        }
      };
    });
  if (process.env.PLAZA_CHECK_NO_ICE === "1")
    await p.addInitScript(() => {
      const Native = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Native {
        constructor(options) {
          super({ ...options, iceTransportPolicy: "relay", iceServers: [] });
        }
      };
    });
  p.setDefaultTimeout(20000);
  p.on("requestfailed", (r) => {
    if (r.url().endsWith("/api/rendezvous"))
      console.log("directory request", name, r.failure()?.errorText);
  });
  p.on("response", (r) => {
    if (r.url().endsWith("/api/rendezvous") && !r.ok())
      console.log("directory HTTP", name, r.status());
  });
  p.on("pageerror", (e) => console.error("pageerror", name, e.message));
  p.on("websocket", (s) => {
    s.on("socketerror", (e) =>
      console.error("socketerror", name, String(e).slice(0, 60)),
    );
  });
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.locator("#profile").click();
  await p.getByRole("textbox", { name: "닉네임" }).fill(name);
  await p.getByRole("button", { name: "저장", exact: true }).click();
  await p.waitForFunction(
    (label) => document.querySelector("#network").textContent.startsWith(label),
    "친구 ",
    { timeout: 50000 },
  );
  return p;
}
async function count(p, n) {
  await p.waitForFunction(
    (label) => document.querySelector("#network").textContent === label,
    "친구 " + n + "명",
    { timeout: 30000 },
  );
}
async function chat(from, to, msg) {
  await from.locator("#message").fill(msg);
  await from.getByRole("button", { name: "보내기" }).click();
  await to.getByText(msg, { exact: false }).last().waitFor();
}
async function followSign(page,destination){
  const sign=page.locator('#gates [data-to="'+destination+'"]');
  const bounds=await sign.boundingBox(), view=page.viewportSize();
  if(bounds && bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=view.width && bounds.y+bounds.height<=view.height){
    await sign.click();
  }else{
    const label=await sign.textContent();
    await page.locator("#place").click();
    await page.locator("#panelbody").getByRole("button",{name:label,exact:true}).click();
  }
}
async function checkLibrary(a, b) {
  // A jump shrinks the shadow at the feet while the character rises.
  await a.evaluate(()=>{
    const ctx=document.querySelector("#world").getContext("2d"),ellipse=ctx.ellipse;
    let lastGround;
    const fillText=ctx.fillText;
    ctx.fillText=function(text,...args){
      if(text.endsWith(" · 나") && lastGround!==undefined)this.canvas.dataset.groundY=String(lastGround);
      return fillText.call(this,text,...args);
    };
    ctx.ellipse=function(x,y,rx,ry,...args){
      if(rx===18 && ry===5)lastGround=y+8*1.06;
      if(rx<18 && rx>=10 && Math.abs(ry-rx*5/18)<0.01)document.querySelector("#world").dataset.jumpObserved="true";
      return ellipse.call(this,x,y,rx,ry,...args);
    };
  });
  // Place both feet on open ground and wait for the sprite before measuring its shadow.
  await a.evaluate(async()=>{
    const p=JSON.parse(localStorage.getItem("knu-web-profile"));
    const sheet=new Image();sheet.src="/"+(p.style||p.avatar+"-"+p.coat)+".png";
    await sheet.decode();
  });
  await a.locator("#world").focus();
  await a.keyboard.down("ArrowLeft");
  await a.waitForTimeout(1100);
  await a.keyboard.up("ArrowLeft");
  await a.locator("#act").click();
  await a.locator(".close").click();
  await a.keyboard.press("ArrowLeft");
  await a.locator("#quick-jump[data-action=점프]").waitFor();
  await a.keyboard.press("Space");
  await a.locator("#world[data-jump-observed=true]").waitFor();
  await followSign(a,"lounge");
  const cancel=a.locator("#quick-jump[data-action='이동 취소']");
  await cancel.waitFor();
  await a.keyboard.press("Space");
  await cancel.waitFor({state:"hidden"});
  if(await a.locator("#seat-list").isVisible())throw Error("취소한 포털로 이동함");
  await followSign(a,"lounge");
  await a.locator("#seat-list").waitFor();
  await b.locator("#network").click();
  await b.locator(".friend-row").filter({hasText:"도서관 열람실"}).getByRole("button",{name:"걸어가기"}).first().click();
  for(const page of [a,b]) await page.locator("#seat-list").waitFor();
  // Tap targets stay on the painted sign even as the mobile camera pans.
  await a.waitForFunction(()=>{
    const map=document.querySelector("#landscape").getBoundingClientRect(), scale=map.width/1536;
    return [["plaza",633],["ginkgo",912]].every(([id,x])=>
      document.elementFromPoint(map.left+x*scale,map.top+866*scale-10)?.closest("button")?.dataset.to===id);
  });

  await a.locator("#world").focus();
  await a.locator("#quick-jump[data-action='광장 가기']").waitFor();
  await a.keyboard.press("e");
  await a.waitForTimeout(500);
  if(!await a.locator("#quick-jump[data-action='광장 가기']").isVisible())throw Error("E로 상호작용이 실행됨");
  await a.keyboard.press("Space");
  await a.locator("#quick-jump[data-action='도서관 가기']").waitFor();
  await a.keyboard.press("Space");
  await a.locator("#seat-list").waitFor();
  // Both players have just entered at the plaza doorway (690,848).
  const canvas = a.locator("#world");
  const chairPoint=await a.locator("#landscape").evaluate(el=>{
    const map=el.getBoundingClientRect(),scale=map.width/1536;
    return {x:map.left+739*scale,y:map.top+750*scale};
  });
  await a.mouse.click(chairPoint.x,chairPoint.y);
  await a.locator("#quick-jump[data-action=일어나기]").waitFor();
  await canvas.focus();
  await a.keyboard.press("Space");
  await a.locator("#quick-jump[data-action='앉기']").waitFor();
  // Walk into the chair just released. Stay in its aisle even at running speed.
  const y=await canvas.evaluate(n=>Number(n.dataset.groundY));
  await a.keyboard.down("Shift");
  await a.keyboard.down("ArrowUp");
  await a.waitForTimeout(450);
  await a.keyboard.up("ArrowUp");
  await a.keyboard.up("Shift");
  const stopped=await canvas.evaluate(n=>Number(n.dataset.groundY));
  if(stopped>=y || stopped<y-15)throw Error("의자 경계 밖으로 이동함: "+y+" → "+stopped);
  await a.keyboard.press("Space");
  await a.locator("#quick-jump[data-action='일어나기']").waitFor();
  await a.locator("#quick-jump").tap();
  await a.locator("#seat-list").click();
  if(await a.locator(".seat-grid button").count()!==30)throw Error("열람실 좌석 수");
  await a.getByRole("button",{name:"가까운 빈자리에 앉기"}).click();
  await a.locator("#quick-jump[data-action=일어나기]").waitFor();
  await a.locator("#quick-jump").tap();
  await a.locator("#seat-list").click();
  await a.getByRole("button", { name: "1번 · 빈자리", exact: true }).click();
  if(await a.locator("#quick-jump[data-action=일어나기]").isVisible()) throw Error("이동 전에 착석함");
  await a.locator("#quick-jump[data-action=일어나기]").waitFor();
  await a.locator("#seat-list").click();
  const scroll=a.locator(".seat-scroll");
  const lastSeat=a.locator(".seat-grid button").last();
  await lastSeat.focus();
  const scrollBefore=await scroll.evaluate(n=>n.scrollTop);
  if(scrollBefore<=0)throw Error("좌석 목록 아래로 스크롤 실패");
  await b.locator("#network").click();
  await b.locator(".friend-row").filter({hasText:"1번"}).getByRole("button",{name:"옆에 앉기"}).click();
  if(await b.locator("#quick-jump[data-action=일어나기]").isVisible())throw Error("옆자리까지 걷지 않고 착석함");
  await b.locator("#quick-jump[data-action=일어나기]").waitFor();
  await a.waitForFunction(()=>document.querySelectorAll(".seat-grid button")[1]?.dataset.occupied==="true");
  if(await scroll.evaluate(n=>n.scrollTop)!==scrollBefore || !await lastSeat.evaluate(n=>n===document.activeElement))
    throw Error("친구 착석 후 자리 목록의 위치나 초점이 바뀜");
  await a.locator(".close").click();
  await b.locator("#quick-jump[data-action=일어나기]").click();
  await a.locator("#quick-jump[data-action=일어나기]").click();
  await a.keyboard.press("c");
  await a.locator("#act").click();
  await a.getByRole("button", { name: /^일어서기/ }).click();
  await a.locator("#world").focus();
  await a.keyboard.press("Enter");
  if(!await a.locator("#message").evaluate(node=>node===document.activeElement))throw Error("대화 초점 실패");
  await a.keyboard.press("Escape");
  if(!await a.locator("#world").evaluate(node=>node===document.activeElement))throw Error("광장 초점 복귀 실패");
  await a.locator("#act").click();
  const retainedFocus=await a.evaluate(async()=>{
    document.querySelector("#panel").close();
    const world=document.querySelector("#world");
    world.focus();
    world.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return document.activeElement.id;
  });
  if(retainedFocus!=="message")throw Error("행동 창이 닫힌 뒤 채팅 초점이 풀림");
  await a.locator("#message").fill("한");
  await a.locator("#message").press("Space");
  if ((await a.locator("#message").inputValue()) !== "한 ") throw Error("채팅 띄어쓰기 실패");
  await a.locator("#message").fill("");
  await a.locator("#world").focus();
  await a.keyboard.press("c");
  await a.keyboard.press("j");
  await a.locator("#act").click();
  await a.getByRole("button", {name:/^쪼그려 앉기/}).waitFor();
  await a.locator(".close").click();
  await a.keyboard.press("ArrowDown");
  await a.keyboard.press("j");
  await a.locator("#act").click();
  await a.getByRole("button", { name: "하트", exact: true }).click();
  for (const page of [a,b]) await followSign(page,"plaza");
  for(const page of [a,b]) await page.waitForFunction(()=>document.querySelector("#place").textContent==="일청담 광장");
  console.log("Library seat occupancy, release and action controls verified");
}
async function checkPond(a,b){
  const size=a.viewportSize();
  await a.bringToFront();
  await a.setViewportSize({width:1360,height:920});
  await a.waitForFunction(()=>{
    const map=document.querySelector("#world"),ratio=Math.min(devicePixelRatio,2);
    return map.clientWidth===1360 && map.width===Math.round(map.clientWidth*ratio) &&
      map.height===Math.round(map.clientHeight*ratio);
  });
  const point=await a.locator("#landscape").evaluate(el=>{
    const m=el.getBoundingClientRect();
    return {x:m.x+938*m.width/1536,y:m.y+825*m.height/1024};
  });
  const stand=page=>page.locator("#quick-jump[data-action=일어나기]");
  await a.mouse.click(point.x,point.y);
  await stand(a).waitFor();
  if(!(await stand(a).getAttribute("aria-label")).includes("1번 · 일청담 남쪽 벤치"))throw Error("물가 벤치 1번 착석 실패");
  await b.locator("#network").click();
  await b.locator(".friend-row").filter({hasText:"일청담 남쪽 벤치"}).getByRole("button",{name:"옆에 앉기"}).click();
  await stand(b).waitFor();
  if(!(await stand(b).getAttribute("aria-label")).includes("2번 · 일청담 남쪽 벤치"))throw Error("물가 벤치 옆자리 착석 실패");
  for(const page of [a,b]){
    await page.locator("#world").focus();await page.keyboard.press("Space");
    await page.locator("#quick-jump[data-action=앉기]").waitFor();
  }
  await a.setViewportSize(size);
  console.log("Pond bench click, remote seat, adjacent seat and Space release verified");
}
async function checkPresence() {
  const a = await enter("현장PC"),
    b = await enter("현장폰");
  for (const [page, friend] of [
    [a, "현장폰"],
    [b, "현장PC"],
  ]) {
    await page.locator("#network").click();
    await page.getByRole("button",{name:"연결 상태",exact:true}).click();
    await page.waitForFunction(
      (name) =>
        document
          .querySelector("#network-details")
          ?.textContent.includes(name) &&
        document
          .querySelector("#network-details")
          .textContent.includes("포함 2명"),
      friend,
      { timeout: 40000 },
    );
    await page
      .getByText(/경로 후보 부족 · 내 기기 0개 \/ 상대 0개/)
      .first()
      .waitFor({ timeout: 40000 });
    await count(page, 0);
  }
  console.log(
    "Two visible room members, zero direct channels with ICE disabled",
  );
}
try {
  if (web) {
    const [a, c] = await Promise.all([
      enter("민서테스트"),
      enter("영한테스트"),
    ]);
    await Promise.all([count(a, 1), count(c, 1)]);
    await checkLibrary(a, c);
    await a.locator("#profile").click();
    await a.getByRole("button",{name:"남자",exact:true}).click();
    await a.getByRole("button",{name:"컴학 과잠",exact:true}).click();
    await a.getByRole("button",{name:"돌려 보기",exact:true}).click();
    await a.getByRole("textbox", { name: "닉네임" }).fill("변경한이름");
    await a.getByRole("button", { name: "저장", exact: true }).click();
    await a.locator("#profile").click();
    for(const label of ["남자","컴학 과잠"]){
      if(await a.getByRole("button",{name:label,exact:true}).getAttribute("aria-pressed")!=="true")throw Error("코디 저장 실패");
    }
    await a.locator(".close").click();
    await c.locator("#network").click();
    await c.getByRole("button",{name:"연결 상태",exact:true}).click();
    await c
      .locator("#network-details li")
      .filter({ hasText: "변경한이름" })
      .waitFor();
    await a.locator("header strong").click();
    await a.keyboard.down("ArrowLeft");
    await a.waitForTimeout(600);
    await a.keyboard.up("ArrowLeft");
    await c.waitForFunction(
      () =>
        /이동 수신 [1-9]/.test(
          document.querySelector("#network-details").textContent,
        ),
      null,
      { timeout: 30000 },
    );
    await c.locator(".close").click();
    await chat(a, c, "웹 수신 점검");
    await chat(c, a, "웹 응답 점검");
    await c.getByText("변경한이름 · 웹 수신 점검", { exact: true }).waitFor();
    await checkPond(a,c);
    console.log(
      "HTTPS-only simultaneous entry, rename, remote motion and two-way chat verified",
    );
  } else if (process.env.PLAZA_CHECK_NO_ICE === "1") await checkPresence();
  else {
    const a = await enter("첫번째"),
      c = await enter("두번째"),
      d = await enter("세번째");
    for (const p of [a, c, d]) await count(p, 2);
    await d.locator("#network").click();
    await d.getByRole("button",{name:"연결 상태",exact:true}).click();
    await d.waitForFunction(
      () =>
        [...document.querySelectorAll("#panelbody li")].length === 2 &&
        [...document.querySelectorAll("#panelbody li")].every((el) =>
          el.textContent.includes("host ↔ host"),
        ),
    );
    console.log(
      "3 connected",
      await d.locator("#panelbody li").allTextContents(),
    );
    await d.locator(".close").click();
    await a.close();
    await Promise.all([count(c, 1), count(d, 1)]);
    await chat(c, d, "퇴장 뒤 대화 확인");
    await chat(d, c, "응답 확인");
    await c.locator("header strong").click();
    await c.keyboard.down("ArrowLeft");
    await c.waitForTimeout(500);
    await c.keyboard.up("ArrowLeft");
    await d.locator("#network").click();
    await d.getByRole("button",{name:"연결 상태",exact:true}).click();
    await d.waitForFunction(() =>
      [...document.querySelectorAll("#panelbody li")].some((el) =>
        /이동 수신 [1-9]/.test(el.textContent),
      ),
    );
    console.log(
      "survivor movement",
      await d.locator("#panelbody li").allTextContents(),
    );
    await d.locator(".close").click();
    await checkLibrary(c, d);
    const e = await enter("새친구");
    for (const p of [c, d, e]) await count(p, 2);
    await chat(e, c, "새 참가자 인사");
    await chat(c, e, "새 참가자 수신");
    console.log("departure, survivor chat, fourth join verified");
  }
} catch (err) {
  for (const p of pages.filter((p) => !p.isClosed()))
    console.log(
      "status",
      await p.locator("#network").textContent(),
      await p.locator("#notice").textContent(),
    );
  throw err;
} finally {
  await b.close();
}
