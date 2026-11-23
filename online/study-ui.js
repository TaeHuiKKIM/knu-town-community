import {addTutorLink} from "./lan-tutor.js";
import {decorate} from "./pixel-icons.js";
import {openNotebook} from "./study-notebook.js";
import {summary,serializeBackup,parseBackup,MAX_BACKUP_BYTES,remainingOutfitSets} from "../public/campus/local-data.js";
import {clock,CHECK_MS} from "../public/campus/study-time.js";
import {dailyStudy,monthKey,renderCalendar} from "../public/campus/study-calendar.js";

export function attachStudy({button,profile,legacyAppearance,panel,add,onStatus,onAppearance,rankings}){
  let book,write,pending=false;
  const dialog=document.getElementById("panel");
  let channel;
  try{channel=new BroadcastChannel("knu-web-study");}catch{}
  let sharing=false;
  try{sharing=localStorage.getItem("knu-share-current-calendar")==="on";}catch{}
  const publish=next=>{
    book=next;
    button.textContent=book.active?"공부 중":"공부";
    const month=monthKey();
    onStatus(book.active?.from??null,summary(book.archive),sharing?{month,days:dailyStudy(book.archive.records,month).map(ms=>Math.floor(ms/60000))}:null);
    onAppearance(book.archive.profile);
  };
  async function read(){
    write??=await openNotebook(profile,legacyAppearance);
    publish(await write());
  }
  const refresh=()=>read().catch(()=>{});
  if(channel)channel.onmessage=refresh;
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
  refresh();
  async function show(tab="study"){
    try{await read();}catch{add(panel("study","공부"),"p","이 브라우저에서 기록을 저장할 수 없어요.");return;}
    const title={study:"내 공부",records:"공부 기록",shop:"씨앗 상점"}[tab];
    const body=panel("study",title), section=add(body,"section","");
    section.className="study-notebook";
    dialog.dataset.section=tab;
    const nav=add(section,"div","");nav.className="study-tabs";
    for(const [key,text] of [["study","공부"],["records","기록"],["shop","상점"]]){
      const choice=decorate(add(nav,"button",text),key);choice.setAttribute("aria-current",key===tab?"page":"false");choice.disabled=key===tab;choice.onclick=()=>show(key);
    }
    const totals=summary(book.archive);
    const error=add(section,"p","");error.setAttribute("role","status");
    function field(label,max){
      const wrap=add(section,"label",label),input=add(wrap,"input","");
      input.maxLength=max;return input;
    }
    function action(label,operation,icon,parent=section){
      const b=decorate(add(parent,"button",label),icon);
      b.onclick=async()=>{
        if(pending)return;
        pending=true;b.disabled=true;
        try{publish(await write(operation()));channel?.postMessage(1);await show(tab);}
        catch(e){error.textContent=e.message;}
        finally{pending=false;b.disabled=false;}
      };
      return b;
    }
    if(tab==="study"){
      section.dataset.theme=totals.theme;
      const active=book.active;
      if(!active){
        add(section,"p","오늘 확인한 시간 "+clock(totals.todayMs));
        const subject=field("과목",30),goal=field("이번 목표",120);
        action("공부 시작",()=>({type:"start",subject:subject.value,goal:goal.value}));
      }else{
        add(section,"h3",active.subject);add(section,"p",active.goal);
        const time=add(section,"strong",""),hint=add(section,"p","");
        time.className="study-clock";
        const tick=()=>{
          const ms=Math.max(0,Date.now()-active.from);
          time.textContent=clock(Math.min(ms,CHECK_MS));
          hint.textContent=ms>=CHECK_MS?"90분 경과 · 공부 확인 필요":"90분마다 공부한 내용을 확인해요.";
        };
        tick();
        const timer=setInterval(()=>{if(!time.isConnected||!dialog.open){clearInterval(timer);return;}if(!document.hidden)tick();},1000);
        const note=field("공부한 내용",160);
        for(const [label,more] of [["확인하고 마치기",false],["확인하고 계속",true]])
          action(label,()=>({type:"confirm",segment:active.segment,note:note.value,more}));
      }
      addTutorLink(section,add);
    }else if(tab==="records"){
      add(section,"p","오늘 "+clock(totals.todayMs)+" · 이번 주 "+clock(totals.weekMs));
      const calendar=add(section,"div","");
      const month=m=>renderCalendar(calendar,m,dailyStudy(book.archive.records,m),month);
      month(monthKey());
      const share=add(section,"label",""),toggle=add(share,"input","");
      toggle.type="checkbox";toggle.checked=sharing;
      add(share,"span","같은 방에 이번 달 일별 공부 시간 공유");
      toggle.onchange=()=>{
        sharing=toggle.checked;
        try{localStorage.setItem("knu-share-current-calendar",sharing?"on":"off");}catch{}
        publish(book);show("records");
      };
      const ranking=add(section,"details","");
      add(ranking,"summary","이 방의 이번 달 공부 순위");
      const list=add(ranking,"ol","");
      ranking.ontoggle=()=>{
        if(!ranking.open)return;
        list.replaceChildren();
        const rows=rankings();
        for(const person of rows)add(list,"li",person.name+" · "+person.minutes+"분");
        if(!rows.length)add(list,"li","시간을 공유한 참가자가 아직 없어요.");
      };
      for(const row of totals.recent)add(section,"p",row.subject+" · "+row.note+" · "+clock(row.toAt-row.fromAt));
      const download=add(section,"button","확인 기록 백업");
      download.onclick=()=>{
        const url=URL.createObjectURL(new Blob([serializeBackup(book.archive)],{type:"application/json"}));
        const link=document.createElement("a");link.href=url;link.download="web-study.knutown.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
      const label=add(section,"label","LAN·웹 백업 가져오기"),file=add(label,"input","");
      file.type="file";file.accept=".json";let confirmImport;
      file.onchange=async()=>{
        confirmImport?.remove();const source=file.files[0];if(!source)return;
        try{
          if(source.size>MAX_BACKUP_BYTES)throw Error("백업 파일은 20 MiB까지 사용할 수 있어요.");
          const text=await source.text(),incoming=parseBackup(text);
          action(incoming.records.length+"개 기록 가져오기",()=>({type:"import",text}));
          confirmImport=section.lastChild;
        }catch(e){error.textContent=e.message;}
      };
    }else{
      decorate(add(section,"p","보유 씨앗 "+totals.balance+"개 · 확인한 공부 10분당 1개"),"wallet");
      const offers=add(section,"div","");offers.className="shop-offers";
      const hasGlove=totals.ownedItemIds.includes("play-bump");
      const glove=action(hasGlove?"툭 치기 장갑 · 보유":"툭 치기 장갑 · 6씨앗",()=>({type:"glove"}),"wave",offers);
      glove.disabled=totals.balance<6||hasGlove;
      const box=action("랜덤 코디 상자 · 8씨앗",()=>({type:"outfit-box"}),"shop",offers);
      box.disabled=totals.balance<8||!remainingOutfitSets(totals.rewardMs,totals.ownedItemIds).length;
      const outfits=totals.ownedItemIds.filter(id=>id.startsWith("wear-"));
      if(outfits.length)add(section,"p",outfits.map(id=>id==="wear-ash"?"애쉬 과잠 세트 보유":"후드·오프숄더 세트 보유").join(" · "));
      const shelf=add(section,"div","");shelf.className="theme-shelf";
      for(const [theme,name,price] of [["plain","기본",0],["ginkgo","은행나무길",24],["lounge","도서관",36]]){
        const owned=!price||totals.ownedItemIds.includes("focus-"+theme);
        action(name+(theme===totals.theme?" · 사용 중":owned?" · 적용":" · "+price+"씨앗"),()=>({type:"theme",theme}));
        section.lastChild.classList.add("theme-offer");section.lastChild.style.setProperty("--scene-preview",'url(/previews/'+(theme==="plain"?"plaza":theme)+'.png)');
        const card=section.lastChild;
        card.disabled=theme===totals.theme||(!owned&&totals.balance<price);
        card.replaceChildren();add(card,"span",name);add(card,"small",theme===totals.theme?"사용 중":owned?"적용":price+"씨앗");
        shelf.append(card);
      }
    }
  }
  button.onclick=()=>show();
  document.getElementById("records").onclick=()=>show("records");
  return async appearance=>{
    try{write??=await openNotebook(profile,legacyAppearance);}
    catch{onAppearance(appearance);return;}
    publish(await write({type:"appearance",appearance}));
    channel?.postMessage(1);
  };
}
