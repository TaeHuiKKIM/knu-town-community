import {PLAY,pushDestination} from "../public/campus/play.js";
import {Impacts} from "../public/campus/impact.js";
import {sharedCalendar} from "./shared-calendar.js";
import {renderCalendar} from "../public/campus/study-calendar.js";
import {fountain} from "../public/campus/effects.js";
import {Ambient} from "../public/campus/ambient.js";
import {decorate,iconUrl} from "./pixel-icons.js";
import {tables,chairs as libraryChairs,drawFurniture,drawChair} from "./lounge.js";
import {showSpaceAction,createPortal,onPortalSurface,drawEntrance, signOffset, signFace, exitCameraX, doorOffset} from "../public/campus/wayfinding.js";
import { selectStudentFrame, actionInProgress, STUDENT_ACTION, drawStudentSprite, poseInset, CAMPUS_SPRITE_SCALE } from "../public/campus/student-motion.js";
import { ImageCache } from "../public/campus/scene-images.js";
import { addInstallOption } from "./install.js";
import { SCENES, sceneInfo, nearbyPortal, arrivalFrom } from "../public/campus/scenes.js";
import { gateRoute } from "./gate-route.js";
import {attachStudy} from "./study-ui.js";
import {COAT_LABELS,STUDY_STYLES,canWearStyle,outfitName,styleForAvatar} from "../public/campus/wardrobe.js";
import {seatedFeetOffset,seatApproach,seatAtPoint,nearbyUse,closestFriend,portalActionLabel} from "../public/campus/furniture.js";
import {benches,campusSeats as desks} from "./campus-seats.js";
let rewardMs=0, owned=[];
import QRCode from "qrcode";
import {isMeetupInvite} from "./meetup-link.js";
import {campusMeetups} from "./meetup-ui.js";
import { PlazaMesh } from "./mesh.js";
import {
  spawn,
  walkable,
  directionFor, campusKey, campusKeyName, walkKeys,
  DIRECTIONS,
  COATS,
  AVATARS,
} from "../public/campus/world.js";
import { STUDENTS } from "../public/campus/sprites/data.js";

const $ = (id) => document.getElementById(id),
  canvas = $("world"),
  ctx = canvas.getContext("2d");
const room = new URL(location.href).searchParams.get("room") || "main";
const code = /^[a-z0-9-]{1,40}$/.test(room) ? room : "main";
const meetupRoom=isMeetupInvite(location.href);
const webMode = meetupRoom || new URL(location.href).searchParams.get("mode") === "web";
const peers = new Map(),
  keys = new Set(),
  images = new Map();
let self = {
  ...spawn(0),
  seat: null,
  crouch: false,
  action: "",
  seq: 0,
  at: 0,
  name: "학생" + Math.floor(1000 + Math.random() * 9000),
  avatar: "female",
  coat: "burgundy",
};
try {
  const p = JSON.parse(localStorage.getItem("knu-web-profile"));
  if (p && typeof p.name === "string" && p.name.trim()) {
    self.name = p.name.slice(0, 16);
    if(styleForAvatar(p.style,p.avatar))self.style=p.style;
    if (AVATARS.includes(p.avatar)) self.avatar = p.avatar;
    if (COATS.includes(p.coat)) self.coat = p.coat;
  }
} catch {}
try {
  if (!localStorage.getItem("knu-web-profile"))
    localStorage.setItem(
      "knu-web-profile",
      JSON.stringify({ name: self.name, avatar: self.avatar, coat: self.coat }),
    );
} catch {}
let status = "친구 찾는 중",
  slot = 0,
  target = null,
  cam = { x: 0, y: 0, scale: 1 },
  lastSend = 0,
  lastFrame = 0,
  dirty = true,
  wasWalking = false,
  panelMode = "";
const bubbles=new Map();
function chatBubble(id,text){
  const entry={text};
  bubbles.set(id,entry);dirty=true;
  setTimeout(()=>{if(bubbles.get(id)===entry){bubbles.delete(id);dirty=true;}},4200);
}
document.fonts.ready.then(()=>{dirty=true;});
function scenery(src) {
  const image = new Image();
  image.onload = () => (dirty = true);
  image.src = src;
  return image;
}
const benchArt=scenery("/campus-bench.png");
const wayfinding=scenery("/wayfinding.png");
let opening=null;
const sceneArtUrl=id=>"/"+(id==="lounge"?"library":id)+".png";
const sceneImages=new ImageCache();
let displayedImage=null, warmedGate=null;
const reactions=Object.fromEntries(["wave","cheer","heart","coffee","idea"].map(key=>[key,scenery(iconUrl(key))]));
const loungeArt=Object.fromEntries(["desk","long-table","round-table","sofa","chair-back","chair-front"].map(key=>[key,scenery("/lounge/"+key+".png")]));
for(const [id,key] of Object.entries({place:"map",invite:"invite",network:"friends",study:"study",act:"wave",profile:"outfit",records:"records","seat-list":"seat"}))decorate($(id),key);
decorate($("chat").querySelector("button"),"chat");
const landscape=$("landscape"), water=fountain($("web-fountain")), ambient=new Ambient($("web-ambient"),landscape);
let motionOn=true, powerSave=false, lastWater=-Infinity;
try{motionOn=localStorage.getItem("knu-motion")!=="off";powerSave=localStorage.getItem("knu-power")==="on";}catch{}
function applyMotion(){water.setEnabled(motionOn);ambient.setEnabled(motionOn);landscape.classList.toggle("still-portals",!motionOn);landscape.classList.toggle("slow-portals",powerSave);}
applyMotion();
function displayBackdrop(scene,image){
  image.id="web-scene-art";image.alt="";image.draggable=false;
  if(displayedImage!==image){
    if(displayedImage)displayedImage.replaceWith(image);
    else landscape.prepend(image);
  }
  displayedImage=image;
  landscape.dataset.scene=scene;
  $("web-fountain").hidden=scene!=="plaza";
  ambient.configure(image,SCENES[scene]);
  $("scene-art-retry").hidden=true;
  dirty=true;
}
function initialBackdrop(){
  sceneImages.load(sceneArtUrl("plaza")).then(image=>{
    if(self.scene==="plaza"&&!displayedImage)displayBackdrop("plaza",image);
  }).catch(()=>{
    if(!displayedImage){const retry=$("scene-art-retry");retry.hidden=false;retry.onclick=initialBackdrop;}
  });
}
initialBackdrop();
const impacts=new Impacts(landscape);impacts.accept([],Date.now());
let lastHit=0,lastSwing=0,playful=true;
try{playful=localStorage.getItem("knu-playful")!=="off";}catch{}
function canBump(p){return p.seat==null&&!p.studying&&p.playful!==false&&SCENES[p.scene]?.play;}
function swing(){
  if(!owned.includes("play-bump") || !playful || !canBump(self) || Date.now()-lastSwing<PLAY.cooldown)return;
  const friend=[...peers.values()].filter(p=>p.scene===self.scene&&canBump(p))
    .sort((a,b)=>Math.hypot(a.x-self.x,a.y-self.y)-Math.hypot(b.x-self.x,b.y-self.y))[0];
  if(!friend||Math.hypot(friend.x-self.x,friend.y-self.y)>PLAY.range){log("가까이 있는 친구에게만 사용할 수 있어요.");return;}
  lastSwing=Date.now();self.bumpSlot=friend.slot;perform("bump");mesh.maintain();
}
function environmentalEffects(now){
  if(impacts.active.length)impacts.draw(Date.now());
  if(landscape.dataset.scene!==self.scene)return;
  ambient.draw(now,powerSave);
  if(self.scene==="plaza" && now-lastWater>=(powerSave?100:33)){
    water.draw(now);lastWater=now;
  }
}
const plates=Object.fromEntries(["name-own","name-friend","speech-paper"].map(key=>[key,scenery("/skins/"+key+".png")]));
// Stretch the plain middle only, preserving the pixel corners on long names.
function drawPlate(key,x,y,width,height){
  const image=plates[key],left=Math.round(x-width/2),top=Math.round(y);
  if(!image.naturalWidth){ctx.fillStyle="#fff5e5";ctx.fillRect(left,top,width,height);return;}
  ctx.drawImage(image,0,0,8,24,left,top,8,height);
  ctx.drawImage(image,8,0,16,24,left+8,top,width-16,height);
  ctx.drawImage(image,24,0,8,24,left+width-8,top,8,height);
}
function announcePose() {
  dirty = true;
  if (slot) {
    sendPose();
    if (webMode) mesh.maintain();
  }
}
let lastReleasedSeat=null;
function releaseSeat() {
  if(self.seat!==null)lastReleasedSeat=self.seat;
  if (self.seat !== null) Object.assign(self,seatApproach(desks[self.seat]));
  self.seat = null;
}
function perform(action) {
  if(opening)return;
  if (self.seat !== null && ["jump", "crouch"].includes(action)) return;
  if (action === "crouch") {
    self.crouch = !self.crouch;
    stopRoute();
  } else {
    if (
      action === "jump" &&
      self.action === action &&
      Date.now() - self.at < 800
    )
      return;
    self.crouch = false;
  }
  self.action = action === "crouch" ? "" : action;
  self.seq++;
  self.at = Date.now();
  announcePose();
}
let route=[], destination=null, approachingSeat=null;
const gateButtons=new Map(),portalArt=new Map();
function stopRoute(){
  if(target || destination || approachingSeat!==null)dirty=true;
  route=[];destination=null;target=null;approachingSeat=null;
}
function showGates(){
  $("gates").replaceChildren();
  gateButtons.clear();
  for(const node of portalArt.values())node.remove();
  portalArt.clear();
  for(const gate of SCENES[self.scene].portals){
    const portal=createPortal(gate,"/campus-warp.png");
    landscape.append(portal);portalArt.set(gate,portal);
    const button=document.createElement("button");
    button.type="button";button.dataset.to=gate.target;
    button.textContent=SCENES[gate.target].name;button.title=button.textContent;
    button.dataset.label=gate.target==="lounge"?"도서관":button.textContent;
    if(self.scene==="lounge")button.dataset.side=gate.target==="plaza"?"left":"right";
    button.onclick=()=>{
      if(self.seat!==null || opening) return;
      stopRoute();
      route=gateRoute(self,gate,(x,y)=>walkable(x,y,self.scene));
      if(!route.length)return;
      sceneImages.warm(sceneArtUrl(gate.target));
      keys.clear();resetStick();destination=gate;target=route.shift();dirty=true;
      canvas.focus({preventScroll:true});
    };
    $("gates").append(button);gateButtons.set(gate,button);
  }
}
showGates();
$("place").onclick=()=>{
  const body=panel("directions","목적지");
  for(const [gate,sign] of gateButtons){
    const choice=add(body,"button","");choice.className="destination-card";
    const photo=add(choice,"img","");photo.alt="";
    photo.src="/previews/"+gate.target+".png";
    add(choice,"span",SCENES[gate.target].name);
    choice.disabled=self.seat!==null || !!opening;
    choice.onclick=()=>{$("panel").close();sign.click();};
  }
};
function beginGate(gate,now) {
  if(opening)return;
  const origin=self.scene;
  const animate=gate.target==="lounge"&&!matchMedia("(prefers-reduced-motion: reduce)").matches;
  const trip={gate,start:now,x:self.x,y:self.y,animate,image:null};
  opening=trip;stopRoute();keys.clear();resetStick();dirty=true;
  $("scene-art-retry").hidden=true;
  sceneImages.load(sceneArtUrl(gate.target)).then(image=>{
    if(opening===trip && self.scene===origin)trip.image=image;
  }).catch(()=>{
    if(opening!==trip||self.scene!==origin)return;
    opening=null;dirty=true;
    const retry=$("scene-art-retry");retry.hidden=false;
    retry.onclick=()=>{
      if(self.scene!==origin)return;
      if(Math.hypot(self.x-gate.x,self.y-gate.y)<=78)beginGate(gate,performance.now());
      else gateButtons.get(gate)?.click();
    };
  });
}
function crossGate(gate,image) {
  const scene=gate.target, arrival=arrivalFrom(self.scene,scene);
  displayBackdrop(scene,image);
  Object.assign(self,arrival,{scene,action:"",crouch:false});
  stopRoute();keys.clear();resetStick();wasWalking=false;
  $("seat-list").hidden=scene!=="lounge";
  const placeName=scene==="lounge"?"도서관 열람실":SCENES[scene].name;
  $("place").textContent={lounge:"도서관",it:"융복합관",it4:"IT4호관"}[scene] || placeName;
  $("place").title=placeName+" · 길 찾기";
  $("place").setAttribute("aria-label",placeName+" · 현재 장소와 길 찾기");
  canvas.setAttribute("aria-label",placeName+". 바닥을 눌러 이동");
  showGates();announcePose();
}
function seatLabel(index){
  const chair=desks[index];
  return chair.scene==="lounge" ? (index+1)+"번 좌석" : chair.number+"번 · "+chair.table.label;
}
function occupant(seat) {
  return [self, ...peers.values()].find(
    (p) => p.scene === desks[seat]?.scene && p.seat === seat,
  );
}
function adjacentSeat(seat) {
  const choices = [seat - 1, seat + 1].filter(index =>
    desks[index] && desks[index].table === desks[seat].table && (!desks[seat].chair || desks[index].y===desks[seat].y) && !occupant(index));
  choices.sort((a,b) => Math.abs(desks[a].x-self.x) - Math.abs(desks[b].x-self.x));
  return choices[0];
}
function nearbyAction(){
  if(opening || self.seat!==null || approachingSeat!==null || destination)return null;
  const place=nearbyUse(self.scene,self,slot?desks:[],(_,index)=>occupant(index));
  if(place)return place;
  const friend=closestFriend(self.scene,self,peers.values(),player=>player);
  return friend?{friend}:null;
}
function interact(){
  if(opening)return;
  if(destination || approachingSeat!==null){stopRoute();return;}
  if(self.seat!==null){releaseSeat();announcePose();return;}
  const action=nearbyAction();
  if(action?.gate)gateButtons.get(action.gate).click();
  else if(action?.seat)walkToSeat(action.index);
  else if(action?.friend)perform("wave");
  else perform("jump");
}
function walkToSeat(index) {
  if (!slot || self.scene !== desks[index]?.scene || opening) return;
  const person = occupant(index);
  if (person === self) return;
  const seat = person ? adjacentSeat(index) : index;
  if (seat === undefined) {log("친구 양옆에 빈자리가 없어요.");return;}
  const chair = desks[seat];
  const approach = seatApproach(chair);
  const start = self.seat === null ? self : seatApproach(desks[self.seat]);
  const path = gateRoute(start, approach, (x,y)=>walkable(x,y,self.scene));
  if (!path.length) {log("이 자리까지 가는 길을 찾지 못했어요.");return;}
  stopRoute();
  releaseSeat();
  keys.clear();resetStick();
  self.crouch=false;
  approachingSeat=seat;
  route=path;
  target=route.shift();
  announcePose();
}
function settleIntoSeat(seat) {
  stopRoute();
  if (occupant(seat)) {log("다른 친구가 먼저 앉았어요.");return;}
  Object.assign(self,{seat,seatedAt:performance.now(),facing:"north",action:"",crouch:false});
  wasWalking=false;
  announcePose();
}
function seatList() {
  const takeSeat = index=>{walkToSeat(index);$("panel").close();};
  if(panelMode!=="seats" || !$("panel").open){
    const body=panel("seats","자리 찾기");
    decorate(add(body,"button",""),"seat").classList.add("nearest-seat");
    const list=add(body,"div","");
    list.className="seat-scroll";
    let currentTable, grid;
    for(const [index,chair] of libraryChairs.entries()){
      if(currentTable!==chair.table){
        currentTable=chair.table;
        add(list,"h3",currentTable.label).className="seat-heading";
        grid=add(list,"div","");
        grid.className="seat-grid";
      }
      const button=add(grid,"button","");
      add(button,"strong",(index+1)+"번");
      add(button,"small","");
      add(button,"small","옆에 앉기").className="seat-neighbor";
      button.onclick=()=>takeSeat(index);
    }
  }
  let nearest, bestDistance=Infinity;
  const buttons=$("panelbody").querySelectorAll(".seat-grid button");
  for(const [index,button] of buttons.entries()){
    const person=occupant(index), neighbor=person && person!==self && adjacentSeat(index)!==undefined;
    if(!person){
      const point=seatApproach(desks[index]),distance=Math.hypot(point.x-self.x,point.y-self.y);
      if(distance<bestDistance){nearest=index;bestDistance=distance;}
    }
    const status=person===self?"내 자리":person?.name || "빈자리";
    button.children[1].textContent=status;
    button.children[2].hidden=!neighbor;
    button.dataset.occupied=String(!!person);
    button.setAttribute("aria-label",(index+1)+"번 · "+status+(neighbor?" · 옆에 앉기":""));
    button.title=button.getAttribute("aria-label");
    button.disabled=!slot || (!!person && !neighbor);
  }
  const quick=$("panelbody").querySelector(".nearest-seat");
  quick.textContent=nearest!==undefined?"가까운 빈자리에 앉기":"모든 자리 사용 중";
  quick.disabled=!slot || nearest===undefined;
  quick.onclick=()=>takeSeat(nearest);
}
$("seat-list").onclick = seatList;
$("quick-jump").onclick=()=>interact();
$("act").onclick = () => {
  const grid = add(panel("action", "행동"), "div", "");
  grid.className = "action-grid emote-grid";
  if(owned.includes("play-bump")){
    const hit=decorate(add(grid,"button","툭 치기"),"wave");add(hit,"kbd","F");hit.disabled=!playful||!canBump(self);
    hit.onclick=()=>{$("panel").close();swing();};
  }
  for (const [id, label] of [
    ["crouch", self.crouch ? "일어서기" : "쪼그려 앉기"],
    ["wave", "손 흔들기"],
    ["cheer", "응원"],
    ["heart", "하트"], ["coffee","커피 한 잔"], ["idea","떠올랐어!"],
  ]) {
    const button = decorate(add(grid, "button", label),id==="crouch"?"step":id);
    if(id==="crouch")add(button,"kbd","C");
    button.disabled = self.seat !== null && ["jump", "crouch"].includes(id);
    button.onclick = () => {
      $("panel").close();
      perform(id);
    };
  }
};
function portrait(p) {
  const key = styleForAvatar(p.style,p.avatar)?p.style:p.avatar + "-" + p.coat;
  if (!images.has(key)) {
    const img = new Image();
    img.onload = () => (dirty = true);
    img.src = "/" + key + ".png";
    images.set(key, img);
  }
  return images.get(key);
}
function log(text) {
  const li = document.createElement("li");
  li.textContent = text;
  const feed=$("log");
  const atEnd=feed.scrollHeight-feed.clientHeight-feed.scrollTop<8;
  feed.append(li);
  while ($("log").children.length > 25) $("log").firstChild.remove();
  if(atEnd)feed.scrollTop=feed.scrollHeight;
}
function controls() {
  $("network").textContent = slot
    ? "친구 " + mesh.links.size + "명"
    : "연결 상태";
  $("notice").textContent = !slot
    ? status
    : status.includes("확인") || status.includes("재연결")
      ? status
      : !webMode && mesh.roster.some((p) => !mesh.links.has(p.slot))
        ? "같은 방에 친구가 있어요 · 직결 시도 중"
        : "";
  updateChatButton();
  if (panelMode === "network" && $("panel").open) renderDiagnostics();
  if(panelMode==="friends" && $("panel").open) renderFriends();
  $("profile").textContent = "옷장";
  $("profile").title = self.name+" · 내 캐릭터";
  $("message").placeholder=mesh.links.size?"친구에게 한마디":"친구 입장 대기";
  dirty = true;
}
function currentPose() {
  return {
    t: "pose",
    scene: self.scene,
    playful,bumpSlot:self.action==="bump"?self.bumpSlot:null,calendar:sharedCalendar(self.calendar),chair:self.seat,seat:null,studying:!!self.studying,style:self.style||null,
    crouch: self.crouch,
    seq: self.seq,
    action: Date.now() - self.at < 4500 ? self.action : "",
    x: self.x,
    y: self.y,
    f: self.facing,
    w: wasWalking,run:wasWalking && keys.has("shift"),
    name: self.name,
    avatar: self.avatar,
    coat: self.coat,
  };
}
function sendPose(to) {
  mesh.send(currentPose(), to);
}
const mesh = new PlazaMesh(
  code,
  {
    name: () => self.name,
    pose: currentPose,
    ready(i) {
      if (!slot && self.scene === "plaza") Object.assign(self, spawn(i - 1));
      slot = i;
      controls();
    },
    status(s) {
      status = s;
      controls();
    },
    connected(i) {
      sendPose(i);
      controls();
    },
    left(i) {
      const p = peers.get(i);
      if (p) log(p.name + " 퇴장");
      peers.delete(i);bubbles.delete(i);
      if (panelMode === "seats" && $("panel").open) seatList();
      controls();
    },
    data(i, d) {
      if (!d || typeof d !== "object") return;
      const scene=sceneInfo(d.scene)?.id||"plaza";
      const chair=Number.isInteger(d.chair) && desks[d.chair]?.scene===d.scene ? desks[d.chair] : null;
      const aisle=chair?seatApproach(chair):null;
      // Earlier clients report the front aisle even for a rear-facing chair.
      const seatedPose=chair && (Math.hypot(d.x-aisle.x,d.y-aisle.y)<=2 ||
        Math.hypot(d.x-chair.x,d.y-chair.y-18)<=2);
      if (
        d.t === "pose" &&
        Number.isFinite(d.x) &&
        Number.isFinite(d.y) &&
        (seatedPose || walkable(d.x, d.y, scene)) &&
        DIRECTIONS.includes(d.f) &&
        AVATARS.includes(d.avatar) &&
        COATS.includes(d.coat) &&
        typeof d.name === "string"
      ) {
        if (!peers.has(i)) log(d.name.slice(0, 16) + " 입장");
        const previous = peers.get(i);
        const moves =
          (previous?.moves || 0) +
          (previous && (previous.x !== d.x || previous.y !== d.y) ? 1 : 0);
        peers.set(i, {
          slot:i,moves,playful:d.playful!==false,calendar:sharedCalendar(d.calendar),studying:d.studying===true,style:styleForAvatar(d.style,d.avatar)?d.style:null,
          seatedAt:previous && previous.seat === (d.chair ?? null) ? previous.seatedAt : performance.now(),
          scene,
          seat:
            seatedPose ? d.chair : null,
          crouch: d.crouch === true,
          action: d.action,
          seq: d.seq,
          at: previous && previous.seq === d.seq ? previous.at : Date.now(),
          x: seatedPose?aisle.x:d.x,
          y: seatedPose?aisle.y:d.y,
          facing: d.f,
          name: d.name.slice(0, 16),
          avatar: d.avatar,
          coat: d.coat,
          running:d.run===true,walkTill: d.w ? performance.now() + 220 : 0,
        });
        if(previous && d.seq!==previous.seq && d.action==="bump" && d.bumpSlot===slot && playful && canBump(self) &&
          canBump(peers.get(i)) && self.scene===peers.get(i).scene && Date.now()-lastHit>=PLAY.protection &&
          Math.hypot(self.x-d.x,self.y-d.y)<=PLAY.range){
          lastHit=Date.now();stopRoute();
          impacts.accept([{id:crypto.randomUUID(),from:{x:self.x,y:self.y},at:lastHit}],lastHit);
          Object.assign(self,pushDestination(peers.get(i),self));announcePose();
        }
        if (approachingSeat !== null && peers.get(i).seat === approachingSeat) {
          stopRoute();log("다른 친구가 먼저 앉았어요.");
        }
        if (
          self.scene === peers.get(i).scene &&
          self.seat !== null &&
          peers.get(i).seat === self.seat &&
          i < slot
        ) {
          releaseSeat();
          announcePose();
        }
        if (
          panelMode === "seats" &&
          $("panel").open &&
          (previous?.seat !== peers.get(i).seat || previous?.name !== d.name)
        )
          seatList();
        if(panelMode==="friends" && $("panel").open) renderFriends();
        dirty = true;
      } else if (d.t === "chat" && typeof d.text === "string") {
        const name =
          peers.get(i)?.name ??
          mesh.roster.find((person) => person.slot === i)?.name;
        if (name){const text=d.text.slice(0,160);log(name+" · "+text);chatBubble(i,text);}
      }
    },
  },
  webMode,
  !meetupRoom,
);
controls();
function paint(now) {
  const w = canvas.clientWidth,
    h = canvas.clientHeight,
    dpr = Math.min(devicePixelRatio, 2);
  if (!w || !h) return;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const scale = Math.max(w / 1536, h / 1024),
    x = Math.max(w - 1536 * scale, Math.min(0, w / 2 - exitCameraX(self.scene,self.x,self.y,self.x,w,scale) * scale)),
    y = Math.max(h - 1024 * scale, Math.min(0, h * 0.57 - self.y * scale));
  cam = { x, y, scale };
  const action=nearbyAction(), jump=$("quick-jump");
  const selectedSeat = approachingSeat ?? self.seat ?? action?.index;
  const detail = selectedSeat != null
    ? seatLabel(selectedSeat)
    : destination ? SCENES[destination.target].name : action?.friend?.name || "";
  let label="점프", icon="step", kind="jump";
  if(opening){label="입장 중";icon="map";kind="busy";}
  else if(destination || approachingSeat!==null){label="이동 취소";icon="map";kind="cancel";}
  else if(self.seat!==null){label="일어나기";icon="seat";kind="use";}
  else if(action?.gate){label=portalActionLabel(action.gate);icon="map";kind="use";}
  else if(action?.seat){label="앉기";icon="seat";kind="use";}
  else if(action?.friend){label="인사";icon="wave";kind="use";}
  jump.disabled=!!opening;
  showSpaceAction(jump,label,detail,iconUrl(icon),kind);
  const nearestGate=nearbyPortal(self.scene,self.x,self.y);
  if(warmedGate!==nearestGate){warmedGate=nearestGate;if(nearestGate)sceneImages.warm(sceneArtUrl(nearestGate.target));}
  for (const [gate, button] of gateButtons) {
    button.classList.toggle("near",nearestGate===gate);
    portalArt.get(gate).classList.toggle("is-near",nearestGate===gate);
    const library=self.scene==="lounge",face=signFace(gate);
    const signX=x+(library?face.x:gate.x+signOffset(gate))*scale;
    const signWidth=Math.max(44,(library?face.width:80)*scale);
    const height=Math.max(44,(library?face.bottom-face.top:84)*scale);
    const centerY=library?(face.top+face.bottom)/2:gate.y-40;
    button.hidden=signX+signWidth/2<0 || signX-signWidth/2>w;
    button.style.setProperty("--sign-x",signX+"px");
    if(library)button.style.setProperty("--caption-top",(height/2+(face.top-4-centerY)*scale)+"px");
    button.style.left=signX+"px";
    button.style.top=(y+centerY*scale)+"px";
    button.style.width=signWidth+"px";
    button.style.height=height+"px";
    button.disabled=self.seat!==null || !!opening;
  }
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * x, dpr * y);
  ctx.imageSmoothingEnabled = false;
  landscape.style.transform="translate("+x+"px,"+y+"px) scale("+scale+")";
  ctx.clearRect(-x/scale,-y/scale,w/scale,h/scale);
  const markedSeat = approachingSeat!==null ? desks[approachingSeat] : action?.seat;
  if(markedSeat){
    const floor=seatApproach(markedSeat);
    for(const [color,inset] of [["#543b35",0],["#ffe69d",2]]){
      ctx.fillStyle=color;
      for(const side of [-1,1]){
        const edge=floor.x+side*(19-inset);
        ctx.fillRect(edge-2,floor.y-5+inset,4,9-inset);
        ctx.fillRect(side===1?edge-8:edge-2,floor.y+2-inset,10,3);
      }
    }
  }
  for(const gate of SCENES[self.scene].portals){
    ctx.save();ctx.translate(gate.x,gate.y);
    drawEntrance(ctx,wayfinding,self.scene,gate,opening?.animate&&opening.gate===gate?Math.min(1,(now-opening.start)/280):0,false);
    ctx.restore();
  }
  const actors = [...peers.values(), self].filter(
    (p) => p.scene === self.scene,
  );
  const objects = self.scene === "lounge" ? [...actors, ...tables, ...libraryChairs.filter(c=>c.table.kind!=="sofa")] : [...actors,...benches.filter(t=>t.scene===self.scene && (t.kind==="bench" || t.rail))];
  const epoch = Date.now(),
    reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const depth=p=>p.rail?Math.max(...p.seats.map(s=>s.y))+1:p.seat!=null?desks[p.seat].y+0.5:p.y;
  for (const p of objects.sort((a,b)=>depth(a)-depth(b))) {
    if(p.rail){
      if(displayedImage?.naturalWidth && self.scene==="plaza"){
        ctx.save();ctx.beginPath();
        p.rail.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
        ctx.closePath();ctx.clip();ctx.drawImage(displayedImage,0,0,1536,1024);ctx.restore();
      }
      continue;
    }
    if(p.kind==="bench"){
      if(benchArt.naturalWidth)ctx.drawImage(benchArt,p.x-64,p.y-56,128,56);
      continue;
    }
    if(p.table){drawChair(ctx,p,loungeArt);continue;}
    if (tables.includes(p)) {
      drawFurniture(ctx,p,loungeArt);
      continue;
    }
    const walking = p === self ? wasWalking : p.walkTill > now;
    const rows = WEB_OUTFIT_ROWS[p.style] || STUDENTS[p.avatar].frame_layout.rows,
      state = selectStudentFrame(rows, {
        facing: p.seat != null ? desks[p.seat]?.facing || "south" : p.facing,
        motion: walking ? "walk" : "idle",
        studying:p.studying && !walking && !(p.action==="jump" && actionInProgress(p.at,epoch,STUDENT_ACTION.jumpDuration)),studyPaused:true,
        walkTime: now / 1000 * ((p===self?keys.has("shift"):p.running)?1.5:1),
        jumpAt: p.action === "jump" ? p.at : 0,
        waveAt: p.action === "wave" ? p.at : 0,
        epoch,
        reduced,
      }),
      r = rows[state.pose][state.frame],
      img = portrait(p);
    const age = epoch - p.at;
    const bob =
      !reduced && p.action === "cheer" && age >= 0 && age < 700
        ? Math.round(6 * Math.abs(Math.sin((age * Math.PI) / 350)))
        : 0;
    const seated = p.seat == null ? 0 : reduced ? 1 : Math.min(1,Math.max(0,(now-(p.seatedAt ?? 0))/240));
    const height = (r.h - poseInset(p.crouch,seated)) * CAMPUS_SPRITE_SCALE,
      feet = (p.seat!=null ? p.y+(desks[p.seat].y+seatedFeetOffset(desks[p.seat])-p.y)*seated : p.y) - state.lift - bob + (p===self && opening?.animate ? doorOffset(self.scene)*Math.min(1,Math.max(0,(now-opening.start-210)/200)) : 0);
    const chair = p.seat != null ? desks[p.seat] : null;
    const center = chair ? p.x+(chair.x-p.x)*seated : p.x;
    if(img.naturalWidth && !chair){
      const size=Math.max(.57,1-state.lift/85);
      ctx.fillStyle="rgba(51,36,46,"+(.22*size)+")";
      ctx.beginPath();ctx.ellipse(center,p.y-8*CAMPUS_SPRITE_SCALE,18*size,5*size,0,0,Math.PI*2);ctx.fill();
    }
    if (img.naturalWidth) {
      drawStudentSprite(ctx,img,r,{avatar:p.avatar,pose:state.pose,crouch:p.crouch,seated,
        x:center,feet,scale:CAMPUS_SPRITE_SCALE});
      if(chair?.chair && chair.facing==="north")drawChair(ctx,chair,loungeArt,true);
    }
    ctx.font = "700 "+Math.max(16,Math.min(23,14/scale))+"px Pixel, sans-serif";
    ctx.textAlign = "center";
    const emote=Object.hasOwn(reactions,p.action)?reactions[p.action]:null;
    if(emote?.naturalWidth && age>=0 && age<1700){
      const rise=reduced?0:Math.min(age/80,4);
      ctx.drawImage(emote,center-17,feet-height-(bubbles.has(p===self?"me":p.slot)?83:59)-rise,34,34);
    }
    const label =
      (p.studying?"공부 중 · ":"")+p.name +
      (p === self ? " · 나" : "");
    const width = ctx.measureText(label).width + 20;
    drawPlate(p===self?"name-own":"name-friend",center,feet-height-27,width,27);
    ctx.fillStyle = "#342323";
    ctx.fillText(label, center, feet - height - 7);
    const bubble=bubbles.get(p===self?"me":p.slot);
    if(bubble){
      const chars=Array.from(bubble.text),line=chars.slice(0,22).join("")+(chars.length>22?"…":"");
      const width=ctx.measureText(line).width+14,top=feet-height-53;
      drawPlate("speech-paper",center,top-4,Math.max(width+8,26),26);
      ctx.fillStyle="#483230";ctx.fillText(line,center,top+16);
    }
  }
}
const stick=$("stick"),pad={pointer:null,x:0,y:0};
function resetStick(){
  const pointer=pad.pointer;
  pad.pointer=null;pad.x=0;pad.y=0;stick.firstElementChild.style.transform="";
  if(pointer!==null && stick.hasPointerCapture(pointer))stick.releasePointerCapture(pointer);
}
function moveStick(e){
  if(e.pointerId!==pad.pointer)return;
  const box=stick.getBoundingClientRect(),x=e.clientX-box.left-box.width/2,y=e.clientY-box.top-box.height/2;
  const length=Math.hypot(x,y),max=box.width*.27,ratio=Math.min(1,max/(length||1));
  pad.x=length>6?x/length:0;pad.y=length>6?y/length:0;
  stick.firstElementChild.style.transform="translate("+x*ratio+"px,"+y*ratio+"px)";
}
stick.onpointerdown=e=>{
  if(pad.pointer!==null||self.seat!==null||opening||$("panel").open)return;
  e.preventDefault();canvas.focus({preventScroll:true});pad.pointer=e.pointerId;stick.setPointerCapture(pad.pointer);moveStick(e);
};
stick.onpointermove=moveStick;
stick.onpointerup=stick.onpointercancel=stick.onlostpointercapture=e=>{if(e.pointerId===pad.pointer)resetStick();};
function frame(now) {
  if (document.hidden) return;
  environmentalEffects(now);
  if(opening){
    const progress=opening.animate?Math.min(1,Math.max(0,(now-opening.start-210)/200)):1;
    self.x=opening.x+(opening.gate.x-opening.x)*progress;
    self.y=opening.y+(opening.gate.y-opening.y)*progress;
    if(progress===1&&opening.image){const {gate,image}=opening;opening=null;crossGate(gate,image);}
    paint(now);lastFrame=now;frameId=requestAnimationFrame(frame);return;
  }
  const dt = Math.min((now - lastFrame) / 1000, 0.06);
  lastFrame = now;
  let dx =
      Number(keys.has("d") || keys.has("arrowright")) -
      Number(keys.has("a") || keys.has("arrowleft"))+pad.x,
    dy =
      Number(keys.has("s") || keys.has("arrowdown")) -
      Number(keys.has("w") || keys.has("arrowup"))+pad.y;
  if (dx || dy) stopRoute();
  else if (target) {
    dx = target.x - self.x;
    dy = target.y - self.y;
    if (Math.hypot(dx, dy) < 0.01) {
      target = route.shift() || null;
      if (!target && approachingSeat !== null) settleIntoSeat(approachingSeat);
      dx = dy = 0;
    }
  }
  const n = Math.hypot(dx, dy),
    distance = Math.min((keys.has("shift")?295:185) * dt, target ? n : Infinity);
  let moved = false;
  if (n && self.seat === null) {
    if (self.crouch) {
      self.crouch = false;
      announcePose();
    }
    const nx = self.x + (dx / n) * distance,
      ny = self.y + (dy / n) * distance;
    if (walkable(nx, ny, self.scene)) {
      self.x = nx;
      self.y = ny;
      moved = true;
    } else if(!target && nx!==self.x && walkable(nx,self.y,self.scene)){
      self.x=nx;moved=true;
    } else if(!target && ny!==self.y && walkable(self.x,ny,self.scene)){
      self.y=ny;moved=true;
    } else stopRoute();
    self.facing = directionFor(dx, dy, self.facing);
  }
  // Crossing a chair's approach point on foot seats the player. Walking along
  // the aisle or standing up at that same point must not claim a seat.
  if(moved && slot && !destination && approachingSeat===null){
    const previous=desks[lastReleasedSeat], floor=previous && seatApproach(previous);
    if(floor && Math.hypot(self.x-floor.x,self.y-floor.y)>35)lastReleasedSeat=null;
    const entered=desks.findIndex((c,index)=>{
      if(c.scene!==self.scene)return false;
      const approach=seatApproach(c), x=approach.x-self.x,y=approach.y-self.y, d=Math.hypot(x,y);
      return index!==lastReleasedSeat && d<=13 && (x*dx+y*dy)>=0.5*d*n && !occupant(index);
    });
    if(entered>=0){resetStick();keys.clear();walkToSeat(entered);}
  }
  const gate=moved && approachingSeat===null && SCENES[self.scene].portals.find(g=>(!destination||g===destination)&&Math.hypot(g.x-self.x,g.y-self.y)<=22);
  if(gate){
    beginGate(gate,now);
    moved=false;
  }
  const change = moved !== wasWalking;
  wasWalking = moved;
  if (slot && (change || (moved && now - lastSend > 90))) {
    sendPose();
    lastSend = now;
  }
  if (
    dirty ||
    moved ||
    change ||
    [self, ...peers.values()].some(
      (p) => p.scene === self.scene && ((p.action && Date.now() - p.at < 2000) || (p.seat != null && now-p.seatedAt < 300)),
    ) ||
    [...peers.values()].some((p) => p.walkTill + 120 > now)
  ) {
    paint(now);
    dirty = false;
  }
  frameId = requestAnimationFrame(frame);
}
let frameId = requestAnimationFrame(frame);
// Publish the new map transform in the same layout cycle as the resized controls.
new ResizeObserver(() => {
  if (!document.hidden) paint(performance.now());
  dirty = true;
}).observe(canvas);
canvas.onpointerdown = (e) => {
  if(opening)return;
  const pixelRatio=Math.min(devicePixelRatio,2);
  if(canvas.width!==Math.round(canvas.clientWidth*pixelRatio) || canvas.height!==Math.round(canvas.clientHeight*pixelRatio))
    paint(performance.now());
  canvas.focus({preventScroll:true});
  const r = canvas.getBoundingClientRect();
  const point = {
    x: (e.clientX - r.left - cam.x) / cam.scale,
    y: (e.clientY - r.top - cam.y) / cam.scale,
  };
  const floorGate=SCENES[self.scene].portals.find(g=>onPortalSurface(g,point.x,point.y));
  if(floorGate){gateButtons.get(floorGate).click();return;}
  const hit=seatAtPoint(self.scene,point.x,point.y);
  if(hit){
    const seat=hit.item.seats[hit.index];
    const index=desks.findIndex(c=>c.table.id===hit.item.id && c.x===seat.x && c.y===seat.y);
    if(index>=0)walkToSeat(index);
    return;
  }
  if (self.seat === null) {
    stopRoute();route=gateRoute(self,point,(x,y)=>walkable(x,y,self.scene));
    target=route.shift()||null;
  }
};
let tabNavigation=false;
document.addEventListener("pointerdown",()=>{tabNavigation=false;},true);
$("panel").addEventListener("close",()=>{
  // A queued close event may arrive after the user has already started chatting.
  if(!tabNavigation && !$("panel").open && document.activeElement!==$("message"))canvas.focus({preventScroll:true});
});
onkeydown = (e) => {
  if(e.key==="Tab")tabNavigation=true;
  if(opening)return;
  if(e.target===$("message") && e.key==="Escape" && !e.isComposing){
    canvas.focus({preventScroll:true});return;
  }
  const key=campusKey(e);
  if(!key || $("panel").open)return;
  if(key==="shift"){
    keys.add("shift");return;
  }
  if(key==="f" && !e.repeat && (e.target===canvas || e.target===document.body)){swing();return;}
  if(key==="enter" && (e.target===canvas || e.target===document.body)){
    e.preventDefault();$("message").focus();return;
  }
  if (
    (key !== " " || !tabNavigation || !e.target.closest?.("button,a,summary")) &&
    [" ", "j", "c"].includes(key)
  ) {
    e.preventDefault();
    if(!e.repeat){if(key===" ")interact();else perform(key==="c"?"crouch":"jump");}
    return;
  }
  const direction=walkKeys.get(key);
  if(!direction || self.seat!==null)return;
  e.preventDefault();
  if(e.repeat && (approachingSeat!==null || destination) && !keys.has(key))return;
  tabNavigation=false;canvas.focus({preventScroll:true});
  if(!e.repeat && !keys.has(key)){
    stopRoute();
    const [dx,dy]=direction, x=self.x+dx*4, y=self.y+dy*4;
    if(walkable(x,y,self.scene)){
      self.x=x;self.y=y;self.facing=directionFor(dx,dy,self.facing);self.crouch=false;
      dirty=true;if(slot)sendPose();
    }
  }
  keys.add(key);
};
onkeyup = (e) => keys.delete(campusKeyName(e));
onblur = () => {
  resetStick();
  keys.clear();
  stopRoute();
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(frameId);
    resetStick();keys.clear();
    stopRoute();
    if (wasWalking) {
      wasWalking = false;
      sendPose();
    }
  } else {
    dirty = true;
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(frame);
  }
});
function updateChatButton(){
  $("chat").querySelector("button").disabled=!slot || !mesh.links.size || !$("message").value.trim();
}
$("message").oninput=updateChatButton;
$("message").onfocus=()=>keys.clear();
$("chat").onsubmit = (e) => {
  e.preventDefault();
  const input = $("message"),
    text = input.value.trim().slice(0, 160);
  if (!text || !mesh.links.size) return;
  postRoomChat(text);
  input.value = "";updateChatButton();
};
function postRoomChat(text) {
  mesh.send({t:"chat",text});
  log(self.name+" · "+text);chatBubble("me",text);
}
function panel(mode, title) {
  resetStick();
  keys.clear();
  panelMode = mode;
  $("panel").dataset.mode=mode;
  const body = $("panelbody");
  body.replaceChildren();
  body.scrollTop=0;
  $("profile-footer").replaceChildren();
  $("profile-footer").hidden=mode!=="profile";
  $("panel-title").textContent=title;
  $("panel").scrollTop=0;
  if (!$("panel").open) $("panel").showModal();
  return body;
}
function add(body, tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  body.append(el);
  return el;
}
$("profile").onclick = () => {
  const b = panel("profile", "옷장");
  const layout=add(b,"div","");layout.className="fitting-layout";
  const stage=add(layout,"div","");stage.className="fitting-preview";
  const scene=add(stage,"div","");scene.className="fitting-scene";
  const preview=add(scene,"canvas","");
  preview.className="profile-preview";preview.width=96;preview.height=128;
  preview.setAttribute("aria-label","선택한 캐릭터 미리보기");
  const toolbar=add(stage,"div","");toolbar.className="fitting-toolbar";
  const caption=add(toolbar,"div","");caption.className="fitting-caption";caption.setAttribute("role","status");
  const itemName=add(caption,"strong",""),itemState=add(caption,"span","");
  const rotate=add(toolbar,"button","");rotate.className="fitting-rotate";
  add(rotate,"img","").src=iconUrl("rotate");rotate.firstChild.alt="";
  add(rotate,"span","돌려 보기");
  const options=add(layout,"div","");options.className="fitting-choices";
  const draft={avatar:self.avatar,coat:self.coat,style:canWearStyle(self.style,self.avatar,rewardMs,owned)?self.style||"":""};
  const facings=["south","southwest","west","northwest","north","northeast","east","southeast"];
  let view=0;
  rotate.onclick=()=>{view=(view+1)%facings.length;updatePreview();};

  function drawStudent(canvas,appearance,facing){
    const image=portrait(appearance);
    const rows=WEB_OUTFIT_ROWS[appearance.style]||STUDENTS[appearance.avatar].frame_layout.rows;
    const frame=rows["idle_"+facing][0];
    const draw=()=>{
      if(canvas.isConnected && image.naturalWidth){
        const c=canvas.getContext("2d");c.clearRect(0,0,canvas.width,canvas.height);
        c.imageSmoothingEnabled=false;
        c.drawImage(image,frame.x,frame.y,frame.w,frame.h,0,0,canvas.width,canvas.height);
      }
    };
    if(image.complete) draw();
    else {
      canvas.getContext("2d").clearRect(0,0,canvas.width,canvas.height);
      image.decode().then(()=>{
        if(canvas===preview && canvas.isConnected) updatePreview();
        else draw();
      }).catch(()=>{});
    }
  }
  function updatePreview(){
    drawStudent(preview,draft,facings[view]);
    const wearing=draft.avatar===self.avatar && draft.coat===self.coat && draft.style===(self.style||"");
    const label=outfitName(draft.coat,draft.style),state=wearing?"입는 중":"미리보기";
    if(itemName.textContent!==label) itemName.textContent=label;
    if(itemState.textContent!==state) itemState.textContent=state;
    updateSave();
  }
  function updateSave(){
    const available=canWearStyle(draft.style||null,draft.avatar,rewardMs,owned);
    save.disabled=!name.value.trim() || !available;
    save.textContent=available?"저장":"공부 보상 잠김";
  }
  function choiceGroup(parent,title){
    const group=add(parent,"fieldset","");group.className="look-options";
    add(group,"legend",title);
    const grid=add(group,"div","");grid.className="look-grid";return grid;
  }
  const coats=choiceGroup(options,"과잠"),cards=choiceGroup(options,"공부 코디");
  const profile=add(layout,"div","");profile.className="fitting-account";
  const avatars=choiceGroup(profile,"캐릭터");avatars.classList.add("avatar-choices");
  const nicknameField=add(profile,"div","");nicknameField.className="fitting-name-field";
  const nicknameLabel=add(nicknameField,"label","닉네임");nicknameLabel.htmlFor="edit-nickname";
  const name=add(nicknameField,"input","");name.id="edit-nickname";name.value=self.name;name.maxLength=16;
  coats.classList.add("coat-choices");
  cards.className="outfit-cards";
  function portraitChoices(grid,key,values,labels){
    grid.replaceChildren();
    values.forEach((value,i)=>{
      const button=add(grid,"button","");button.type="button";
      button.setAttribute("aria-pressed",String(draft[key]===value && (key!=="coat" || !draft.style)));
      const icon=add(button,"canvas","");icon.width=48;icon.height=64;icon.setAttribute("aria-hidden","true");
      drawStudent(icon,{...draft,[key]:value,style:""},"south");
      add(button,"span",labels[i]);
      button.onclick=()=>{
        if(draft[key]===value && (key==="avatar"||!draft.style))return;
        draft[key]=value;draft.style="";renderChoices();
        grid.children[i].focus({preventScroll:true});
      };
    });
  }
  function renderChoices(){
    portraitChoices(avatars,"avatar",AVATARS,["남자","여자"]);
    portraitChoices(coats,"coat",COATS,COATS.map(coat=>COAT_LABELS[coat]));
    cards.replaceChildren();
    const styles=STUDY_STYLES.filter(item=>item.avatar===draft.avatar);
    for(const item of styles){
      const available=canWearStyle(item.id,draft.avatar,rewardMs,owned);
      const button=add(cards,"button",""),img=add(button,"img","");
      img.alt="";img.src="/icons/outfit-"+item.id+".png";
      add(button,"span",item.name);
      if(!available)add(button,"small",item.hours+"시간 해금");
      button.setAttribute("aria-pressed",String(draft.style===item.id));
      button.onclick=()=>{draft.style=item.id;
        for(const card of cards.children)card.setAttribute("aria-pressed",String(card===button));
        for(const [i,coat] of Array.from(coats.children).entries())coat.setAttribute("aria-pressed",String(!draft.style && COATS[i]===draft.coat));
        updatePreview();
      };
    }
    updatePreview();
  }
  const save=add($("profile-footer"),"button","저장");
  save.className="save-look";
  name.oninput=updateSave;
  renderChoices();
  name.onkeydown=e=>{if(e.key==="Enter"&&!e.isComposing&&e.keyCode!==229){e.preventDefault();save.click();}};
  save.onclick = () => {
    if (!name.value.trim() || !canWearStyle(draft.style||null,draft.avatar,rewardMs,owned)) return;
    Object.assign(self, {
      name: name.value.trim(),
      avatar:draft.avatar,coat:draft.coat,style:draft.style||null,
    });
    try {
      localStorage.setItem(
        "knu-web-profile",
        JSON.stringify({
          name: self.name,
          avatar: self.avatar,
          coat: self.coat,style:self.style,
        }),
      );
    } catch {}
    sendPose();
    mesh.maintain();
    controls();
    $("panel").close();
  };
  const settings=add(b,"details","");settings.className="effect-options";
  add(settings,"summary","화면 설정 · 문의");
  for(const [text,key,value] of [["배경 움직임","knu-motion",motionOn],["절전 모드","knu-power",powerSave],["장난 받기","knu-playful",playful]]){
    const label=add(settings,"label",""),input=add(label,"input","");
    input.type="checkbox";input.checked=value;add(label,"span",text);
    input.onchange=()=>{
      if(key==="knu-motion"){motionOn=input.checked;applyMotion();}else if(key==="knu-playful"){playful=input.checked;announcePose();}else {powerSave=input.checked;applyMotion();}
      try{localStorage.setItem(key,input.checked?"on":"off");}catch{}
    };
  }
  addInstallOption(settings);
  add(settings,"a","문의 게시판 열기").href="https://github.com/TaeHuiKKIM/knu-town-community/issues";

};
function renderDiagnostics() {
  const b = $("network-details");
  if (!b) return;
  b.replaceChildren();
  add(b, "p", (slot ? "내 자리 " + slot + "번 · " : "") + status);
  const lines = add(b, "ul", "");
  for (const i of mesh.links.keys()) {
    const li = add(
      lines,
      "li",
      (peers.get(i)?.name || i + "번") + " · 확인 중",
    );
    mesh
      .route(i)
      .then(
        (r) =>
          (li.textContent =
            (peers.get(i)?.name || i + "번") +
            " · " +
            r +
            " · 이동 수신 " +
            (peers.get(i)?.moves || 0) +
            "회"),
      );
  }
  add(
    b,
    "p",
    "같은 방 · " +
      (code === "main" ? "메인 광장" : code) +
      " · 내 기기 포함 " +
      (slot ? mesh.roster.length + 1 : 0) +
      "명",
  );
  for (const p of mesh.roster) {
    if (!mesh.links.has(p.slot))
      add(b, "p", p.name + " · " + p.slot + "번 · " + mesh.pendingDetail(p));
  }
  if (!mesh.links.size)
    add(
      b,
      "p",
      !slot
        ? "광장에 등록하는 중이에요."
        : mesh.roster.length
          ? "같은 방의 친구와 직결 시도 중"
          : "다른 친구의 입장을 기다리고 있어요.",
    );
  if(webMode)add(b,"p","이동과 채팅은 웹 서버를 거쳐요.");
}
function diagnostics() {
  const b = panel("network", webMode ? "웹 연결 확인" : "직결 확인");
  add(b, "section", "").id = "network-details";
  renderDiagnostics();
  if (!webMode)
    add(b, "button", "웹 연결 방으로 이동").onclick = () => {
      const url = new URL(location.href);
      url.searchParams.set("mode", "web");
      location.assign(url.href);
    };
  if (!webMode)
    add(b, "button", "직결 진단 결과 보기").onclick = async () => {
      const section = panel("report", "직결 진단 결과");
      add(
        section,
        "p",
        "내 자리 " + (slot || "대기") + " · 친구 " + mesh.roster.length + "명",
      );
      for (const peer of mesh.roster) {
        const session = mesh.sessions.get(peer.slot),
          last = mesh.lastProbe.get(peer.slot);
        add(section, "strong", peer.slot + "번 친구");
        const stage = mesh.pendingStage(peer.slot);
        const row = add(section, "p", stage);
        if (session) {
          const { measurePath } = await import("./path-report.js");
          row.textContent = await measurePath(session.pc);
        }
        if (last?.id === peer.id)
          add(section, "p", "이전 시도 · " + last.report);
      }
      add(section, "button", "다시 확인").onclick = diagnostics;
    };
  add(b, "button", "다시 확인").onclick = () => mesh.maintain(true);
}
function renderFriends(){
  const list=$("friend-list");
  if(!list)return;
  const members=new Map(mesh.roster.map(member=>[member.slot,member]));
  for(const i of mesh.links.keys())if(!members.has(i))members.set(i,{slot:i,name:peers.get(i)?.name||i+"번 친구"});
  const entries=Array.from(members.values(),member=>{
    const friend=peers.get(member.slot);
    return {slot:member.slot,calendar:sharedCalendar(friend?.calendar),name:friend?.name||member.name,scene:friend?.scene,seat:friend?.seat,
      beside:friend?.seat!=null && adjacentSeat(friend.seat)!==undefined};
  });
  const signature=JSON.stringify([self.scene,self.seat,!!opening,entries]);
  if(list.dataset.state===signature)return;
  list.dataset.state=signature;list.replaceChildren();
  if(!entries.length){
    add(list,"p","아직 혼자 있어요.");
    decorate(add(list,"button","친구 초대"),"invite").onclick=()=>$("invite").click();
  }
  for(const entry of entries){
    const row=add(list,"div","");row.className="friend-row";
    const info=add(row,"div","");
    add(info,"strong",entry.name);
    const place=entry.scene==="lounge"?"도서관 열람실":SCENES[entry.scene]?.name;
    add(info,"small",place ? place+(entry.seat!=null?" · "+seatLabel(entry.seat):"") : "연결 중");
    if(entry.calendar){
      const details=add(info,"details","");add(details,"summary","공부 달력");
      const view=add(details,"div","");
      renderCalendar(view,entry.calendar.month,entry.calendar.days.map(v=>v*60000),()=>{});
      for(const button of view.querySelectorAll("button"))button.hidden=true;
    }
    const gate=SCENES[self.scene].portals.find(portal=>portal.target===entry.scene);
    if(gate){
      const go=add(row,"button","걸어가기");
      go.disabled=self.seat!==null||!!opening;
      go.onclick=()=>{
        $("panel").close();gateButtons.get(gate).click();
      };
    }else if(entry.beside && entry.scene===self.scene){
      add(row,"button","옆에 앉기").onclick=()=>{
        const friend=peers.get(entry.slot);
        if(friend?.seat!=null){$("panel").close();walkToSeat(friend.seat);}
      };
    }
  }
}
$("network").onclick = ()=>{
  const body=panel("friends","같은 방 친구");
  add(body,"section","").id="friend-list";
  add(body,"button",meetups.current?"모임 정보":"모임 만들기").onclick=meetups.current?meetups.openRoom:meetups.form;
  add(body,"button","연결 상태").onclick=diagnostics;
  renderFriends();
};
const meetups=campusMeetups({panel,add,invite:$("invite"),dialog:$("panel"),
  start:()=>mesh.start(),stop:()=>mesh.close(),connected:()=>mesh.active&&!!slot,
  postChat:postRoomChat,share:inviteLink});
$("invite").onclick=()=>meetups.current ? meetups.openRoom() : inviteLink();
function inviteLink() {
  const active=meetups.current;
  const b=panel("invite",active?"모임 초대":"광장 초대");
  const url=active ? new URL(active.link) : new URL(location.href);
  if(!active){
    url.hash="";
    decorate(add(b,"button","학과·동아리·스터디 모임 만들기"),"friends").onclick=meetups.form;
  }
  if(navigator.share){
    decorate(add(b,"button","초대 링크 공유"),"invite").onclick=async()=>{
      try{await navigator.share({title:active?active.details.title:"크누타운 광장",url:url.href});}
      catch(error){if(error.name!=="AbortError"){input.focus();input.select();}}
    };
  }
  const img = add(b, "img", "");
  img.alt=active?"모임 초대 QR":"광장 초대 QR";
  QRCode.toDataURL(url.href).then(src=>img.src=src).catch(()=>img.remove());
  const input = add(b, "input", "");
  input.readOnly = true;
  input.value = url.href;
  input.setAttribute("aria-label", "초대 링크");
  add(b, "button", "링크 복사").onclick = async (e) => {
    try {
      await navigator.clipboard.writeText(url.href);
      e.target.textContent = "복사됨";
    } catch {
      input.select();
    }
  };
  if(active){add(b,"button","모임 정보로").onclick=meetups.openRoom;return;}
  decorate(add(b, "button", "새 친구 방 만들기"),"friends").onclick = () => {
    url.searchParams.set("room", crypto.randomUUID());
    location.assign(url.href);
  };
}
attachStudy({button:$("study"),profile:self,panel,add,rankings:()=>[self,...peers.values()]
  .filter(p=>sharedCalendar(p.calendar))
  .map(p=>({name:p.name,minutes:p.calendar.days.reduce((sum,n)=>sum+n,0)}))
  .sort((a,b)=>b.minutes-a.minutes),onStatus:(studying,totals,calendar)=>{
  const changed=JSON.stringify(calendar)!==JSON.stringify(self.calendar);
  self.calendar=calendar;
  rewardMs=totals.rewardMs;owned=totals.ownedItemIds;
  if(changed||self.studying!==studying){self.studying=studying;announcePose();}
}});
if(meetupRoom)void meetups.initialize();
window.addEventListener('hashchange',event=>{
  if(isMeetupInvite(event.oldURL)||isMeetupInvite(event.newURL))location.reload();
});
onpagehide = () => mesh.close();
onpageshow = (e) => {
  if (e.persisted) location.reload();
};
