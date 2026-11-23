import {CHECK_MS} from "../public/campus/study-time.js";
import {createState, mergeRecords, mergeStates, parseBackup, openSeedBox, purchase, setFocusTheme} from "../public/campus/local-data.js";

const uuid=()=>crypto.randomUUID();
const command=()=>uuid().replaceAll("-","");
export function initialNotebook(profile) {
  return {archive:createState({key:command()+command(),name:profile.name,avatar:profile.avatar,coat:profile.coat}), active:null};
}
export function changeNotebook(book, op, now=Date.now()) {
  let {archive,active}=book;
  if(op.type==="start"){
    if(active)throw Error("이미 공부 중이에요.");
    const subject=op.subject.trim(), goal=op.goal.trim();
    if(subject.length<2||subject.length>30||goal.length<2||goal.length>120||/[\x00-\x1f]/.test(subject+goal))throw Error("과목과 목표를 두 글자 이상 입력해주세요.");
    active={id:uuid(),segment:uuid(),from:now,subject,goal};
  }else if(op.type==="confirm"){
    if(!active||active.segment!==op.segment)throw Error("다른 탭에서 공부 구간을 변경했어요.\n공부 창을 다시 열어주세요.");
    const note=op.note.trim();
    if(note.length<2||note.length>160||/[\x00-\x1f]/.test(note))throw Error("공부한 내용을 두 글자 이상 입력해주세요.");
    if(now<active.from)throw Error("기기 시간을 확인해주세요.");
    const record={sourceId:active.segment,seq:1,id:command(),sessionId:active.id,subject:active.subject,goal:active.goal,note,
      fromAt:active.from,toAt:Math.min(now,active.from+CHECK_MS),confirmedAt:now};
    archive={...archive,records:mergeRecords(archive.records,[record])};
    active=op.more?{...active,segment:uuid(),from:now}:null;
  }else if(op.type==="import"){
    if(active)throw Error("진행 중인 구간을 확인한 뒤 가져와주세요.");
    const incoming=parseBackup(op.text);
    if(archive.profile.key===incoming.profile.key)archive=mergeStates(archive,incoming);
    else if(!archive.records.length&&!archive.purchases.length)archive=incoming;
    else throw Error("기존 기록을 보호하기 위해 같은 프로필의 백업만 합칠 수 있어요.");
  }else if(op.type==="glove"){
    archive=purchase(archive,{id:command(),itemId:"play-bump",at:now});
  }else if(op.type==="outfit-box"){
    archive=openSeedBox(archive,command(),now,"outfit");
  }else if(op.type==="theme"){
    const item=op.theme==="plain"?"plain":"focus-"+op.theme;
    if(!["plain","focus-lounge","focus-ginkgo"].includes(item))throw Error("배경을 확인해주세요.");
    if(item!=="plain"&&!archive.purchases.some(p=>p.itemId===item))archive=purchase(archive,{id:command(),itemId:item,at:now});
    archive=setFocusTheme(archive,op.theme);
  }else throw Error("공부 동작을 확인해주세요.");
  return {archive:{...archive,revision:archive.revision+1,updatedAt:now},active};
}

export async function openNotebook(profile){
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open("knu-web-study",1);
    req.onupgradeneeded=()=>req.result.createObjectStore("study");
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  db.onversionchange=()=>db.close();
  // Active interval and confirmed archive commit together even across competing tabs.
  return op=>new Promise((resolve,reject)=>{
    const tx=db.transaction("study","readwrite"),store=tx.objectStore("study"),req=store.get("notebook");
    let result,error;
    req.onsuccess=()=>{
      try{
        const current=req.result||initialNotebook(profile);
        result=op?changeNotebook(current,op):current;
        if(op||!req.result)store.put(result,"notebook");
      }catch(e){error=e;tx.abort();}
    };
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||Error("기록을 저장하지 못했어요."));
  });
}
