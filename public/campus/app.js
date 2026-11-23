import { RoomConnection, latestSender, saved, profileKey } from './network.js';
import { COATS, AVATARS, WORLD, walkable as worldWalkable, cameraTransform, directionFor, normalizeDirection } from './world.js';
import { Avatars } from './avatar.js';
import { WardrobeUI } from './wardrobe-ui.js';
import { canWearStyle, styleForAvatar } from './wardrobe.js';
import { STUDENT_ACTION, actionInProgress } from './student-motion.js';
import { fountain } from './effects.js';
import { PLAY, canPlay, nearestFriend, acceptPosition, stepKnockback, movementReady } from './play.js';
import { Impacts } from './impact.js';
import { StudyUI } from './study.js';
import { TutorUI } from './tutor.js';
import { SpacesUI } from './spaces.js';
import {Ambient} from './ambient.js';
import {SceneView} from './scene-view.js';
import {walkingRoute} from './terrain.js';
import {showSpaceAction,onPortalSurface} from './wayfinding.js';
import {sameScene,sceneInfo} from './scenes.js';
import {furnitureSeats,sceneFurniture,seatedFeetOffset,seatApproach,seatAtPoint,nearbyUse,closestFriend,portalActionLabel} from './furniture.js';
import {dailyStudy,monthKey,renderCalendar} from './study-calendar.js';
import {LocalVault} from './local-vault.js';
import {LocalUI} from './local-ui.js';

const $=id=>document.getElementById(id), viewport=$('viewport'), world=$('world');
const legacyKey=profileKey();let vault=null,localOpenError='';
try{vault=await LocalVault.open({key:legacyKey,initial:{name:saved.get('localStorage','knu-name')||'',avatar:saved.get('localStorage','knu-avatar')||'male',coat:saved.get('localStorage','knu-coat')||'burgundy'}});}catch{localOpenError='브라우저 저장을 열지 못했어요. 광장 이용은 계속할 수 있어요';}
if(vault){const p=vault.state.profile;for(const [key,value]of Object.entries({'knu-profile-key':p.key,'knu-name':p.name,'knu-avatar':p.avatar,'knu-coat':p.coat}))saved.set('localStorage',key,value);}
const room=new RoomConnection(location.pathname.split('/')[2],{key:vault?.state.profile.key||legacyKey,generation:vault?.generation}), art=new Avatars(), water=fountain($('fountain')), impacts=new Impacts(world);
const state={scene:'plaza',x:860,y:520,coat:'burgundy',avatar:'male',style:null,facing:'south',motion:'idle',running:false,target:null,walkTime:0,overview:false,stepUntil:0,positionRevision:0,hitUntil:0,knockback:null};
const keys=new Set(), actors=new Map(), openers=new WeakMap(), lastMessages=new Map();
let snapshot={players:[],messages:[]}, joystick={x:0,y:0}, pointer=null, offset=0, needsSync=true;
let sceneScale=1,sceneX=0,sceneY=0,lastTransform='',lastTime=performance.now(),lastMoveKey='',peopleKey='',messageKey='',initialHistory=true,unread=0,toastTimer;
let joinBusy=false,chatBusy=false,composing=false,assetBusy=false,bumpBusy=false,playfulBusy=false,selectedTarget=null,bumpLabel='',localAttackUntil=0;
let frameId=0,lastDraw=-Infinity,powerSave=saved.get('localStorage','knu-power-save')==='1';
let pendingAction=null;
let seatBusy=false, furnitureScene=null, seatAfterStanding=null, friendSeatTrip=null;
const seatButtons=new Map();
let markedChair=null;
let localSeats=[],tabNavigation=false;
document.addEventListener('pointerdown',()=>{tabNavigation=false;},true);
document.addEventListener('keydown',e=>{if(e.key==='Tab')tabNavigation=true;},true);
function walkable(x,y,scene){return worldWalkable(x,y,scene,snapshot.pondSeating===true);}
function nearbyAction(){
  const place=nearbyUse(state.scene,state,localSeats,seat=>seatButtons.get(seat.id)?.dataset.occupied==='true');
  if(place)return place;
  const friend=closestFriend(state.scene,state,snapshot.players,p=>p.id===room.me?.id?null:p.campus);
  return friend?{friend}:null;
}
function startWalk(goal,action={}){
  const path=walkingRoute(state,goal,(x,y)=>walkable(x,y,state.scene));
  if(!path.length)return false;
  stopInput();
  state.target={...path.shift(),path,...action};
  return true;
}
function walkToGate(gate){
  viewport.focus({preventScroll:true});
  if(state.furnitureSeat||seatBusy||!actionReady(Date.now()+offset))return;
  startWalk(gate,{gate});
}
function approachSeat(seat){
  if(state.furnitureSeat){void chooseFurnitureSeat(null,seat.id);return;}
  if(!startWalk(seatApproach(seat),{seat:seat.id}))toast('이 자리까지 가는 길을 찾지 못했어요');
}
function spaceAction(){
  if(!actionReady(Date.now()+offset)||seatBusy)return;
  if(state.target?.seat||state.target?.gate){stopInput();publishMovement();return;}
  if(state.furnitureSeat){void chooseFurnitureSeat(null);return;}
  const action=nearbyAction();
  if(action?.gate){startWalk(action.gate,{gate:action.gate});return;}
  if(action?.seat){viewport.focus({preventScroll:true});approachSeat(action.seat);return;}
  void playAction(action?.friend?'wave':'jump');
}

const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const movement=latestSender(data=>room.send({type:'campus-move',...data}),error=>{if(error.status&&!error.stale&&!['STALE_MOVE','KNOCKBACK','STUDY_ACTIVE','SEATED'].includes(error.code))toast(error.message);});
const ambient=new Ambient($('ambient'),world);
const sceneView=new SceneView({room,ambient,toast,onWalkToGate:walkToGate,canTravel:()=>!studying()&&!state.knockback&&Date.now()+offset>=state.hitUntil,onBusy:busy=>{if(busy){stopInput();movement.clear();}syncControls();},onShow:()=>{lastTransform='';camera();}});
let localUI, calendarMonth=monthKey(), calendarRequest=0, calendarFriend=null;
function refreshOwnCalendar(month=calendarMonth){
  calendarMonth=month;
  renderCalendar($('my-study-calendar'),month,dailyStudy(vault?.state.records??[],month),refreshOwnCalendar);
}
const shareCalendar=$('share-study-calendar');
shareCalendar.onchange=async()=>{
  shareCalendar.disabled=true;
  try{await room.send({type:'calendar-sharing',enabled:shareCalendar.checked});}
  catch(error){
    if(!error.stale)toast(error.message);
    shareCalendar.checked=snapshot.players.some(p=>p.id===room.me?.id&&p.shareCalendar);
  }finally{shareCalendar.disabled=!room.online;}
};
async function showFriendCalendar(friend,month=monthKey()){
  const request=++calendarRequest, root=$('friend-study-calendar'), status=$('friend-calendar-status');
  calendarFriend=friend.id;
  if(!$('friend-calendar-dialog').open)openPanel('friend-calendar-dialog');
  $('friend-calendar-title').textContent=friend.name+'님의 공부 달력';
  root.replaceChildren();
  status.textContent='공부 시간을 불러오는 중이에요';
  try{
    const {days}=await room.send({type:'friend-calendar',playerId:friend.id,month});
    if(request!==calendarRequest||!$('friend-calendar-dialog').open)return;
    renderCalendar(root,month,days,next=>void showFriendCalendar(friend,next));
    status.textContent='확인한 공부 시간 · 한국 시간';
  }catch(error){
    if(request===calendarRequest&&!error.stale)status.textContent=error.message;
  }
}
$('friend-calendar-dialog').addEventListener('close',()=>{
  calendarRequest++;
  calendarFriend=null;
  $('friend-study-calendar').replaceChildren();
});
const spaces=new SpacesUI({room,art,toast,onHallVisibility:focusScene}),studyUI=new StudyUI({room,open:openPanel,toast,onFocus:focusScene,onSummary:data=>localUI?.observe(data),localTotals:()=>localUI?.totals,localRecords:()=>localUI?.stale?[]:vault?.state.records,onChange:()=>{if(studying()){stopInput();movement.clear();}syncControls();}});
const tutor=new TutorUI({room,toast});
localUI=new LocalUI({vault,room,study:studyUI,toast,openError:localOpenError,onTotals:()=>{
  rewards=localUI.totals?.rewardMs??0;studyUI.renderTotals();studyUI.renderSubjectTimes();if($('local-dialog').open)refreshOwnCalendar();syncControls();
}});
let rewards=localUI.totals?.rewardMs??0;
const wardrobe=new WardrobeUI({art,appearance:()=>state,owned:()=>localUI.stale?[]:localUI.vault?.state.purchases.map(p=>p.itemId)??[],rewardMs:()=>localUI.stale?0:rewards,
  canApply:()=>room.online&&!room.transferring&&!localUI.stale,
  apply:async ({coat,style})=>{
    await room.send({type:'outfit',coat,style});
    state.coat=coat;state.style=style;saved.set('localStorage','knu-coat',coat);
    void localUI.saveAppearance({coat,style});
    portraits();toast(style?'코디를 입었어요':'과잠을 갈아입었어요');
  }
});
function studying(){return !!studyUI.active||!!snapshot.players.find(p=>p.id===room.me?.id)?.study;}
function schedule(){if(!frameId&&!document.hidden&&!studyUI.focused&&!spaces.hallPanel.open)frameId=requestAnimationFrame(animate);}
function focusScene(){stopInput();if(frameId)cancelAnimationFrame(frameId);frameId=0;lastTime=performance.now();room.setView(document.hidden||studyUI.focused||spaces.hallPanel.open?'study':'campus');schedule();}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function toast(message){const node=$('toast'),host=document.querySelector('dialog[open]')||document.body;host.append(node);node.textContent=message;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,2800);}
function typing(){return /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);}
function blocking(){return [...document.querySelectorAll('dialog[open]')].some(d=>d.id!=='chat-dialog'||d.dataset.modal==='true');}
function actionReady(epoch,gestures=false){
  return room.online&&room.me&&!room.transferring&&sceneView.ready&&!sceneView.busy&&!needsSync
    &&!document.hidden&&!studyUI.focused&&!studying()&&!composing&&!typing()&&(!blocking() || gestures&&$('gesture-dialog').open)&&movementReady(state,epoch);
}
function syncActionControls(mine,epoch){
  const blocked=!mine||pendingAction?.owner===room.me||!actionReady(epoch);
  const gestureBlocked=!mine||pendingAction?.owner===room.me||!actionReady(epoch,true);
  for(const id of ['wave','cheer','heart','crouch'])$(id).disabled=gestureBlocked;
  const posture=mine?.campus.crouch?'일어서기':'쪼그려 앉기';
  if($('posture-label').textContent!==posture)$('posture-label').textContent=posture;
  $('crouch').disabled ||= !!mine?.campus.furnitureSeat;
  const action=nearbyAction();
  const targetSeat = state.target?.seat || state.furnitureSeat;
  const seat = targetSeat ? localSeats.find(item=>item.id===targetSeat) : action?.seat;
  const detail = seat ? seat.number+'번 · '+seat.label : state.target?.gate
    ? sceneInfo(state.target.gate.target).name : action?.friend?.name || '';
  let label='점프', icon='jump', kind='jump';
  if(seatBusy || sceneView.busy){label=seatBusy?'자리 변경 중':'입장 중';icon=seatBusy?'library-desk':'map';kind='busy';}
  else if(state.target?.seat||state.target?.gate){label='이동 취소';icon='map';kind='cancel';}
  else if(state.furnitureSeat){label='일어나기';icon='library-desk';kind='use';}
  else if(action?.gate){label=portalActionLabel(action.gate);icon='map';kind='use';}
  else if(action?.seat){label='앉기';icon='library-desk';kind='use';}
  else if(action?.friend){label='인사';icon='actions-frame-2';kind='use';}
  const nextChair = kind==='cancel'||label==='앉기' ? seatButtons.get(seat?.id) : null;
  if(nextChair!==markedChair){
    markedChair?.classList.remove('space-target');
    nextChair?.classList.add('space-target');
    markedChair=nextChair;
  }
  const jump=$('jump');
  showSpaceAction(jump,label,detail,'/campus/assets/icons/'+icon+'.png',kind);
  jump.disabled=blocked||seatBusy||(kind==='jump' && epoch<(mine?.campus.nextJumpAt||0));
}
function syncControls(){
  $('join-button').disabled=!art.ready||joinBusy||!!localUI?.stale;$('nickname').disabled=joinBusy;$('avatar-options').disabled=joinBusy;
  shareCalendar.disabled=!room.online;
  $('chat-input').disabled=!room.online;updateChatButton();
  wardrobe.refresh();
  syncActionControls(snapshot.players.find(p=>p.id===room.me?.id),Date.now()+offset);
  $('run').disabled=!room.online||studying()||!!state.furnitureSeat;
  for(const [id,button] of seatButtons){
    const occupant=snapshot.players.find(p=>p.campus.furnitureSeat===id);
    button.disabled=!!occupant||!room.online||studying()||seatBusy||!sceneView.ready||sceneView.busy;
    button.dataset.occupied=String(!!occupant);
    button.title=occupant?`${occupant.name} 님이 앉아 있어요`:button.getAttribute('aria-label');
  }
  $('playful-toggle').disabled=!room.online||playfulBusy;
  if(!room.online||studying()||sceneView.busy||!sceneView.ready)$('bump').disabled=true;
}
async function chooseFurnitureSeat(id, nextSeat=null) {
  if(seatBusy||!actionReady(Date.now()+offset))return;
  seatBusy=true;
  stopInput();
  seatAfterStanding=nextSeat;
  movement.clear();
  syncControls();
  try {
    await room.send({type:'furniture-seat',seat:id,scene:state.scene,positionRevision:state.positionRevision});
  } catch(error) {
    seatAfterStanding=null;
    if(!error.stale)toast(error.message);
  } finally {
    seatBusy=false;
    syncControls();
  }
}

function drawFurniture(scene) {
  const pondSeating=snapshot.pondSeating===true;
  const layout=scene==='plaza'&&pondSeating?'plaza-with-pond':scene;
  if(furnitureScene===layout)return;
  furnitureScene=layout;
  for(const item of world.querySelectorAll('.furniture'))item.remove();
  seatButtons.clear();
  for(const item of sceneFurniture(scene)){
    if(item.kind==='pond-bench'){
      if(pondSeating && item.rail){
        const back=el('div','furniture pond-rail');
        const x=Math.min(...item.rail.map(p=>p[0])), y=Math.min(...item.rail.map(p=>p[1]));
        Object.assign(back.style,{
          left:x+'px',top:y+'px',width:(Math.max(...item.rail.map(p=>p[0]))-x)+'px',height:(Math.max(...item.rail.map(p=>p[1]))-y)+'px',
          backgroundPosition:-x+'px '+(-y)+'px',
          clipPath:'polygon('+item.rail.map(([px,py])=>(px-x)+'px '+(py-y)+'px').join(',')+')',
          zIndex:String(Math.max(...item.seats.map(s=>s.y))+1)
        });
        back.setAttribute('aria-hidden','true');world.append(back);
      }
      continue;
    }
    const piece=el('div',`furniture furniture-${item.kind}`);
    piece.setAttribute('aria-hidden','true');
    position(piece,item.x,item.y);
    piece.style.zIndex=String(item.y-1);
    world.append(piece);
  }
  localSeats=furnitureSeats(scene).filter(seat=>pondSeating||seat.kind!=='pond-bench');
  for(const seat of localSeats){
    const button=el('button',`furniture furniture-seat furniture-seat-${seat.chair?'desk':seat.kind} seat-of-${seat.kind}`);
    button.type='button';
    if(seat.chair)button.dataset.facing=seat.facing;
    button.setAttribute('aria-label',`${seat.label} ${seat.number}번 자리 앉기`);
    position(button,seat.x,seat.y);
    button.style.zIndex=String(seat.y-1);
    button.onclick=()=>{
      viewport.focus({preventScroll:true});
      if(!actionReady(Date.now()+offset))return;
      approachSeat(seat);
    };
    seatButtons.set(seat.id,button);
    world.append(button);
  }
}
function stopInput(){seatAfterStanding=null;const captured=pointer;pointer=null;if(captured!==null&&$('joystick').hasPointerCapture(captured))$('joystick').releasePointerCapture(captured);keys.clear();joystick={x:0,y:0};state.target=null;state.stepUntil=0;state.motion='idle';$('stick').style.transform='';}
function publishMovement(){if(seatBusy||state.furnitureSeat||!room.online||!room.me||studying()||sceneView.busy||!sceneView.ready||needsSync||state.knockback||Date.now()+offset<state.hitUntil)return;const key=`${state.positionRevision},${Math.round(state.x)},${Math.round(state.y)},${state.facing},${state.motion}`;if(key===lastMoveKey)return;lastMoveKey=key;movement.push({scene:state.scene,x:state.x,y:state.y,facing:state.facing,motion:state.motion,positionRevision:state.positionRevision});}
function camera(){const c=cameraTransform({width:viewport.clientWidth,height:viewport.clientHeight,x:state.x,y:state.y,scene:state.scene,mobile:innerWidth<761,overview:state.overview});sceneScale=c.scale;sceneX=c.x;sceneY=c.y;const transform=`translate(${Math.round(c.x)}px,${Math.round(c.y)}px) scale(${c.scale})`;if(transform!==lastTransform){world.style.transform=transform;world.style.setProperty('--inv',1/c.scale);lastTransform=transform;}}
function position(node,x,y){const left=`${Math.round(x*100)/100}px`,top=`${Math.round(y*100)/100}px`;if(node.style.left!==left)node.style.left=left;if(node.style.top!==top)node.style.top=top;node.style.zIndex=String(Math.floor(y));}
function nameTag(node,name,mine=false){if(node.dataset.name===name)return;node.dataset.name=name;node.title=name;node.replaceChildren(el('span','name',name));if(mine)node.append(el('b','','나'));}
function portraits(){
  document.querySelectorAll('canvas[data-portrait]').forEach(c=>art.paint(c,{avatar:c.dataset.portrait,coat:state.coat}));
  wardrobe.refresh();
}
function chooseAvatar(avatar){state.avatar=avatar;document.querySelectorAll('input[name=avatar]').forEach(n=>{n.checked=n.value===avatar;n.closest('label').classList.toggle('selected',n.checked);});}
function warmStyle(participant){
  const style=styleForAvatar(participant?.style,participant?.avatar);
  if(!style||art.hasStyle(style.id))return;
  void art.loadStyle(style.id).then(()=>{peopleKey='';renderPeople();wardrobe.refresh();},()=>{});
}
function openPanel(id,opener=document.activeElement){
  if(!room.me&&!['invite-dialog','local-dialog'].includes(id))return;
  const dialog=$(id);if(dialog.open){dialog.close();return;}
  document.querySelectorAll('dialog[open]').forEach(d=>{if(d.id!=='join-dialog')d.close();});
  stopInput();publishMovement();openers.set(dialog,opener);
  if(id==='wardrobe-dialog')wardrobe.open();
  if(id==='people-dialog')snapshot.players.forEach(warmStyle);
  if(id==='invite-dialog')void loadInvite();
  if(id==='spaces-dialog')void spaces.load();
  if(id==='scene-dialog')sceneView.sync();
  if(id==='study-dialog')void studyUI.refresh();
  if(id==='tutor-dialog')void tutor.open();
  if(id==='local-dialog'){refreshOwnCalendar();localUI.render();if(room.online)void studyUI.refresh();}
  if(id==='chat-dialog'){unread=0;$('unread').hidden=true;$('chat-error').textContent='';}
  const modal=id!=='chat-dialog'||innerWidth<761;dialog.dataset.modal=String(modal);if(modal)dialog.showModal();else dialog.show();
  document.querySelectorAll(`[data-open="${id}"]`).forEach(b=>b.setAttribute('aria-expanded','true'));
  if(id==='chat-dialog'){$('messages').scrollTop=$('messages').scrollHeight;$('chat-input').focus({preventScroll:true});}
}
for(const d of document.querySelectorAll('dialog'))d.addEventListener('close',()=>{document.querySelectorAll(`[data-open="${d.id}"]`).forEach(b=>b.setAttribute('aria-expanded','false'));const opener=openers.get(d);if(!tabNavigation && room.me && !document.querySelector('dialog[open]'))viewport.focus({preventScroll:true});else if(opener?.isConnected&&!opener.closest('dialog:not([open])'))opener.focus({preventScroll:true});});
document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>{
  if(b.hasAttribute('data-records'))localUI.setTab('records');
  if(b.classList.contains('dock-button')&&b.dataset.open==='study-dialog')studyUI.setTab('timer');
  openPanel(b.dataset.open,b);
}));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('join-dialog').addEventListener('cancel',e=>e.preventDefault());
for(const id of ['friend-invite'])$(id).addEventListener('click',()=>openPanel('invite-dialog'));
$('connection').addEventListener('click',()=>{if(!room.online){if(room.me){room.connect();void room.probe();}else void room.resume();}else openPanel('room-dialog',$('connection'));});
$('reconnect').addEventListener('click',()=>{if(room.me){room.connect();void room.probe();}else void room.resume();});
function adjacentFurnitureSeat(friend){
  const occupied=friend.campus.furnitureSeat;
  if(!occupied)return null;
  const scene=friend.campus.scene||'plaza',group=occupied.slice(0,occupied.lastIndexOf('-'));
  const seats=furnitureSeats(scene),current=seats.find(seat=>seat.id===occupied);
  if(!current)return null;
  return seats.filter(seat=>seat.id.startsWith(group+'-')&&(!current.chair||seat.y===current.y)
    &&!snapshot.players.some(p=>p.campus.furnitureSeat===seat.id))
    .sort((a,b)=>Math.abs(a.x-current.x)-Math.abs(b.x-current.x))[0]||null;
}
async function goBeside(friend){
  if(!room.online||studying()){toast('공부를 마치고 연결된 상태에서 이동할 수 있어요');return;}
  const scene=friend.campus.scene||'plaza',owner=room.me;
  $('people-dialog').close();
  studyUI.setFocus(false);
  viewport.focus({preventScroll:true});
  if(scene!==state.scene&&!await sceneView.travel(scene))return;
  if(room.me===owner)friendSeatTrip={id:friend.id,scene,owner};
}
function renderPeople(){
  const key=JSON.stringify(snapshot.players.map(p=>[p.id,p.name,p.avatar,p.coat,p.style,p.campus.scene,p.campus.furnitureSeat,p.study,p.shareCalendar]));if(key===peopleKey)return;peopleKey=key;
  $('people-count').textContent=String(snapshot.players.length);$('people-total').textContent=`${snapshot.players.length}/${snapshot.capacity??'–'}`;
  const list=$('people');list.replaceChildren();if(!snapshot.players.length){list.append(el('p','empty','아직 입장한 친구가 없어요'));return;}
  for(const p of snapshot.players){
    const row=el('div','person'),canvas=el('canvas');
    canvas.width=96;canvas.height=128;row.dataset.playerId=p.id;art.paint(canvas,p);
    const name=el('span','person-name',p.name),mine=p.id===room.me?.id;
    if(mine)name.append(el('small','','나'));
    const details=el('div','person-details');
    details.append(name,el('span','person-state',`${sceneInfo(p.campus.scene||'plaza').name}${p.study?' · 공부 중':''}${p.inClass?' · 수업중':''}`));
    row.append(canvas,details);
    if(!mine&&p.shareCalendar){
      const calendar=el('button','menu-action person-beside','공부 달력');
      calendar.type='button';
      calendar.onclick=()=>void showFriendCalendar(p);
      row.append(calendar);
    }
    if(!mine&&adjacentFurnitureSeat(p)){
      const beside=el('button','menu-action person-beside','옆자리로 가기');
      beside.type='button';
      beside.onclick=()=>void goBeside(p);
      row.append(beside);
    }
    list.append(row);
  }
}
function renderMessages(){
  const key=snapshot.messages.map(m=>m.id).join(',');if(key===messageKey&&!initialHistory)return;
  const old=new Set(messageKey.split(',')),fresh=snapshot.messages.filter(m=>!old.has(m.id));messageKey=key;lastMessages.clear();for(const m of snapshot.messages)lastMessages.set(m.playerId,m);
  if(!initialHistory&&!$('chat-dialog').open){unread+=fresh.filter(m=>m.playerId!==room.me?.id).length;$('unread').textContent=String(Math.min(99,unread));$('unread').hidden=!unread;}
  const list=$('messages'),nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<64;list.replaceChildren();
  if(!snapshot.messages.length)list.append(el('p','chat-empty','친구에게 인사해보세요'));
  for(const m of snapshot.messages){
    const row=el('div',`chat-item${m.playerId===room.me?.id?' mine':''}`);
    const portrait=el('span','chat-portrait'),canvas=el('canvas');
    portrait.setAttribute('aria-hidden','true');
    canvas.width=96;
    canvas.height=128;
    const sender=m.avatar?m:snapshot.players.find(p=>p.id===m.playerId);
    if(sender){
      const appearance={avatar:sender.avatar,coat:sender.coat,style:sender.style,facing:'south'};
      art.paint(canvas,appearance);
      if(appearance.style)void art.loadStyle(appearance.style).then(()=>{
        if(canvas.isConnected)art.paint(canvas,appearance);
      },()=>{});
      portrait.append(canvas);
    }else portrait.textContent=m.name.slice(0,1);
    const content=el('div','chat-content'),head=el('div','chat-meta');
    const time=el('time','',new Date(m.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}));
    time.dateTime=new Date(m.at).toISOString();
    head.append(el('strong','',m.name),time);
    content.append(head,el('p','chat-bubble',m.text));
    row.append(portrait,content);
    list.append(row);
  }
  if(nearBottom||initialHistory||fresh.some(m=>m.playerId===room.me?.id))list.scrollTop=list.scrollHeight;initialHistory=false;
}
function accept(next){
  snapshot=next;offset=next.at-Date.now();const mine=next.players.find(p=>p.id===room.me?.id);
  shareCalendar.checked=!!mine?.shareCalendar;
  if(calendarFriend&&!next.players.some(p=>p.id===calendarFriend&&p.shareCalendar)){
    calendarRequest++;
    $('friend-study-calendar').replaceChildren();
    $('friend-calendar-status').textContent='친구가 현재 공부 달력을 공유하지 않아요.';
  }
  if(mine){const scene=mine.campus.scene||'plaza';if(scene!==state.scene){stopInput();movement.clear();needsSync=true;state.scene=scene;impacts.reset();void sceneView.show(scene);}
    const initial=needsSync, seatChanged=state.furnitureSeat!==mine.campus.furnitureSeat;
    const previousSeat=state.furnitureSeat;
    state.furnitureSeat=mine.campus.furnitureSeat;
    drawFurniture(scene);
    if(acceptPosition(state,mine.campus,{initial,now:performance.now(),reduced:motionPreference.matches||seatChanged})){state.target=null;state.stepUntil=0;movement.clear();lastMoveKey='';}
    if(initial||seatChanged){
      state.facing=normalizeDirection(mine.campus.facing);state.motion='idle';needsSync=false;
      // An older host leaves the player at the chair center when standing up.
      if(!state.furnitureSeat && !walkable(state.x,state.y,scene)){
        const oldSeat=localSeats.find(seat=>seat.id===previousSeat) || localSeats.find(seat=>seat.x===state.x&&seat.y===state.y);
        const floor=oldSeat?seatApproach(oldSeat):sceneInfo(scene).spawn;
        Object.assign(state,floor);publishMovement();
      }
    }
    if(seatChanged&&!state.furnitureSeat&&seatAfterStanding){
      const nextSeat=localSeats.find(seat=>seat.id===seatAfterStanding);
      seatAfterStanding=null;
      if(nextSeat)approachSeat(nextSeat);
    }
    const style=styleForAvatar(mine.style,mine.avatar)?.id??null;
    if(state.coat!==mine.coat||state.avatar!==mine.avatar||state.style!==style){
      state.coat=mine.coat;state.avatar=mine.avatar;state.style=style;warmStyle(mine);portraits();syncControls();
    }
    $('player').hidden=false;$('player').dataset.playerId=mine.id;nameTag($('own-name'),mine.name,true);$('playful-toggle').checked=mine.playful!==false;}
  const visible=next.players.filter(p=>sameScene(p.campus,state));
  const active=new Set(visible.map(p=>p.id));for(const[id,a]of actors)if(!active.has(id)){a.node.remove();actors.delete(id);}
  for(const p of visible){if(p.id===room.me?.id)continue;let a=actors.get(p.id);if(!a){const node=el('div','actor remote'),canvas=el('canvas'),tag=el('span','name-tag'),speech=el('div','speech');canvas.width=96;canvas.height=128;canvas.setAttribute('aria-label',p.name+' 캐릭터');speech.hidden=true;nameTag(tag,p.name);node.append(canvas,tag,speech);node.dataset.playerId=p.id;world.append(node);a={node,canvas,speech,x:p.campus.x,y:p.campus.y,walkTime:0};actors.set(p.id,a);}if(a.p?.style!==p.style)warmStyle(p);a.p=p;}
  $('player').classList.toggle('studying',studying());for(const a of actors.values()){a.node.classList.toggle('studying',!!a.p.study);a.node.classList.toggle('in-class',!!a.p.inClass);}
  syncClass(next.players.find(p=>p.id===room.me?.id));
  spaces.accept(next.room);studyUI.acceptRoom(next);if(studying()){stopInput();movement.clear();}syncControls();
  impacts.accept((next.impacts||[]).filter(e=>(e.scene||'plaza')===state.scene),Date.now()+offset);renderPeople();renderMessages();
}
function updatePlay(epoch){
  const mine=snapshot.players.find(p=>p.id===room.me?.id),me=mine?{...mine,campus:{...mine.campus,x:state.x,y:state.y}}:null;
  syncActionControls(mine,epoch);
  $('bump').hidden=!localUI.hasBump || !sceneInfo(state.scene).play;
  $('glove-shop').hidden=localUI.hasBump;
  if(!localUI.hasBump){
    selectedTarget=null;
    $('bump').disabled=!room.online||blocking()||studying();
    $('bump').dataset.ready='false';
    if(bumpLabel!=='장갑 상점'){
      for(const actor of actors.values())actor.node.classList.remove('play-target');
      bumpLabel='장갑 상점';$('bump-label').textContent=bumpLabel;
      $('bump').setAttribute('aria-label','툭 치기 장갑 상점');
    }
    return;
  }
  selectedTarget=room.online&&!blocking()&&!studying()&&snapshot.room?.mode!=='study'?nearestFriend(me,snapshot.players,epoch):null;
  const remaining=mine?Math.max(0,PLAY.cooldown-(epoch-mine.campus.attackAt),localAttackUntil-epoch):0;
  const disabled=!room.online||!sceneView.ready||sceneView.busy||!canPlay(me)||!selectedTarget||bumpBusy||remaining>0||state.knockback||epoch<state.hitUntil;
  $('bump').disabled=!!disabled;$('bump').dataset.ready=String(!disabled);
  const label=remaining>0?`${(remaining/1000).toFixed(1)}초`:'툭 치기';if(label!==bumpLabel){$('bump-label').textContent=label;bumpLabel=label;}
  const accessible=selectedTarget?`${selectedTarget.name} 툭 치기`:'툭 치기 · 가까운 친구가 없어요';if($('bump').getAttribute('aria-label')!==accessible)$('bump').setAttribute('aria-label',accessible);
  for(const [id,a]of actors)a.node.classList.toggle('play-target',id===selectedTarget?.id&&!disabled);
}
function speech(node,p,epoch){const m=lastMessages.get(p.id),wave=p.campus.waveAt;const text=m&&m.at>=wave&&epoch-m.at<4500?m.text:wave>0&&epoch-wave<2200?(p.campus.reaction==='heart'?'♥':p.campus.reaction==='cheer'?'파이팅!':'안녕!'):'';node.hidden=!text;if(node.textContent!==text)node.textContent=text;}
function animate(now){
  if(friendSeatTrip&&room.me!==friendSeatTrip.owner)friendSeatTrip=null;
  if(friendSeatTrip&&state.scene===friendSeatTrip.scene&&sceneView.ready&&!sceneView.busy){
    const friend=snapshot.players.find(p=>p.id===friendSeatTrip.id);
    friendSeatTrip=null;
    const seat=friend&&(friend.campus.scene||'plaza')===state.scene&&adjacentFurnitureSeat(friend);
    if(!seat)toast('친구 옆에 빈자리가 없어요');
    else if(actionReady(Date.now()+offset)){
      approachSeat(seat);
    }
  }
  frameId=0;if(document.hidden||studyUI.focused)return;
  const epoch=Date.now()+offset,reduced=motionPreference.matches;
  const active=keys.size||Math.hypot(joystick.x,joystick.y)>.1||state.target||state.knockback||
    room.online&&snapshot.players.some(({campus,study})=>sameScene(campus,state)&&!study&&(
      campus.motion!=='idle'&&actionInProgress(campus.movedAt,epoch,500)||
      actionInProgress(campus.waveAt,epoch,STUDENT_ACTION.waveDuration)||
      actionInProgress(campus.jumpAt,epoch,STUDENT_ACTION.jumpDuration)));
  if(now-lastDraw<(powerSave?(active?33:100):(active?16:66))){schedule();return;}lastDraw=now;
  const dt=Math.min((now-lastTime)/1000,.04);lastTime=now;const pushed=stepKnockback(state,now),canMove=!seatBusy&&!state.furnitureSeat&&room.online&&sceneView.ready&&!sceneView.busy&&!blocking()&&!typing()&&!studying()&&!pushed&&movementReady(state,epoch);
  let dx=canMove?joystick.x+Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')):0;
  let dy=canMove?joystick.y+Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup')):0;
  if(dx||dy)state.target=null;else if(canMove&&state.target){const x=state.target.x-state.x,y=state.target.y-state.y,d=Math.hypot(x,y);if(state.target.path&&d<1){
    state.x=state.target.x;state.y=state.target.y;
    const next=state.target.path.shift();
    if(next)Object.assign(state.target,next);
    else{const {seat,gate}=state.target;state.target=null;if(seat)void chooseFurnitureSeat(seat);else if(gate)void sceneView.travel(gate.target,gate.id);}
  }else if(!state.target.path&&d<4)state.target=null;else{dx=x/d;dy=y/d;}}
  const length=Math.hypot(dx,dy),run=state.running||keys.has('shift');let moved=false;
  if(length>.12){const speed=Math.min((run?250:155)*dt,state.target?Math.hypot(state.target.x-state.x,state.target.y-state.y):Infinity),ox=state.x,oy=state.y,nx=ox+dx/Math.max(1,length)*speed,ny=oy+dy/Math.max(1,length)*speed;
    if(walkable(nx,ny,state.scene)){state.x=nx;state.y=ny;}else if(walkable(nx,oy,state.scene))state.x=nx;else if(walkable(ox,ny,state.scene))state.y=ny;else state.target=null;
    moved=Math.hypot(state.x-ox,state.y-oy)>.01;if(moved)state.facing=directionFor(state.x-ox,state.y-oy,state.facing);}
  state.motion=moved||canMove&&now<state.stepUntil?(run?'run':'walk'):'idle';if(state.motion!=='idle')state.walkTime+=dt*(run?1.5:1);
  position($('player'),state.x,state.y);camera();if(state.scene==='plaza')water.draw(now);ambient.draw(now,powerSave);sceneView.tick(state);impacts.draw(epoch);updatePlay(epoch);
  if(art.ready&&room.me){
    const mine=snapshot.players.find(p=>p.id===room.me.id),myStudy=studyUI.active||mine?.study;
    paintActor($('player'),$('player-sprite'),mine,{...state,bumpUntil:state.hitUntil},myStudy,epoch,reduced);
    if(mine)speech($('player-speech'),mine,epoch);
    for(const a of actors.values()){
      const p=a.p,factor=reduced?1:1-Math.exp(-dt*17);
      if(p.campus.furnitureSeat||Math.hypot(p.campus.x-a.x,p.campus.y-a.y)>350){a.x=p.campus.x;a.y=p.campus.y;}
      else {a.x+=(p.campus.x-a.x)*factor;a.y+=(p.campus.y-a.y)*factor;}
      const motion=room.online&&!p.study&&actionInProgress(p.campus.movedAt,epoch,500)?p.campus.motion:'idle';
      if(motion!=='idle')a.walkTime+=dt*(motion==='run'?1.5:1);
      position(a.node,a.x,a.y);
      paintActor(a.node,a.canvas,p,{motion,walkTime:a.walkTime,bumpUntil:p.campus.bumpUntil},p.study,epoch,reduced);
      speech(a.speech,p,epoch);
    }
  }
  schedule();
}
function paintActor(actor,canvas,participant,movement,study,epoch,reduced){
  const campus=participant?.campus;
  const crouch=!!campus?.crouch&&!study&&movement.motion!=='walk'&&movement.motion!=='run';
  const seat=campus?.furnitureSeat && localSeats.find(s=>s.id===campus.furnitureSeat);
  actor.classList.toggle('seated',!!seat);
  actor.classList.toggle('behind-backrest',!!seat?.chair&&seat.facing==='north');
  actor.classList.toggle('lecture-chair',seat?.kind==='lecture-desk');
  actor.classList.toggle('crouching',crouch&&!campus?.furnitureSeat);
  actor.classList.toggle('hit',actionInProgress(campus?.hitAt,epoch,PLAY.effect));
  art.paint(canvas,{
    avatar:participant?.avatar,coat:participant?.coat,style:participant?.style,facing:campus?.facing,...movement,
    waveAt:room.online?campus?.waveAt:0,jumpAt:room.online?campus?.jumpAt:0,hitAt:campus?.hitAt,
    seated:!!seat,seatOffset:seat?seatedFeetOffset(seat):0,crouch,studying:!!study,studyAt:study?.segmentStartAt||study?.startedAt,
    studyPaused:!room.online||study?.status==='awaiting'||epoch>=(study?.deadlineAt??Infinity),epoch,reduced
  });
}
function openInvitedTutor(){
  if(location.hash!=='#tutor'||!room.online||!room.me||$('join-dialog').open)return;
  history.replaceState(history.state,'',location.pathname+location.search);
  if(!$('tutor-dialog').open)openPanel('tutor-dialog',$('viewport'));
}
room.addEventListener('status',()=>requestAnimationFrame(openInvitedTutor));
$('join-dialog').addEventListener('close',openInvitedTutor);
room.addEventListener('state',e=>{accept(e.detail);if(location.hash==='#tutor')openInvitedTutor();});
room.addEventListener('status',e=>{const mode=e.detail,text={online:'연결됨',offline:'다시 연결하는 중',connecting:'연결 중',waiting:'입장 대기'}[mode];$('connection').dataset.mode=mode;$('connection').setAttribute('aria-label',text+' · 연결 상태');$('connection-detail').textContent=text;
  $('connection-banner').hidden=mode==='online'||mode==='waiting';$('connection-banner').textContent=text;
  if(mode!=='online'){stopInput();needsSync=true;movement.clear();}else void studyUI.refresh();$('player').classList.toggle('offline',mode!=='online');syncControls();sceneView.sync();studyUI.renderClock();});
room.addEventListener('joinrequired',()=>{sceneView.reset();state.scene='plaza';state.furnitureSeat=null;drawFurniture('plaza');void sceneView.show('plaza');snapshot={players:[],messages:[]};impacts.reset();state.knockback=null;state.hitUntil=0;state.positionRevision=0;actors.forEach(a=>a.node.remove());actors.clear();$('player').hidden=true;peopleKey='';messageKey='';initialHistory=true;unread=0;$('unread').hidden=true;lastMessages.clear();renderPeople();renderMessages();document.querySelectorAll('dialog[open]').forEach(d=>d.close());$('join-error').textContent='';$('nickname').value=saved.get('localStorage','knu-name')||'';chooseAvatar(AVATARS.includes(saved.get('localStorage','knu-avatar'))?saved.get('localStorage','knu-avatar'):'male');portraits();syncControls();$('join-dialog').showModal();});
room.addEventListener('resumeerror',()=>{$('connection-banner').hidden=false;$('connection-banner').textContent='연결을 복구하면 자동으로 돌아와요';});
$('join-form').addEventListener('submit',async e=>{e.preventDefault();if(joinBusy||!art.ready||composing||localUI.stale)return;joinBusy=true;$('join-error').textContent='';const name=$('nickname').value.trim(),avatar=state.avatar;syncControls();
  try{
    const chosen=styleForAvatar(vault?.state.profile.style,avatar)?.id??null;
    let style=canWearStyle(chosen,avatar,rewards,localUI.vault?.state.purchases.map(p=>p.itemId)??[])?chosen:null;
    if(style){try{await art.loadStyle(style);}catch{style=null;}}
    if(localUI.stale)throw Error('다른 탭에서 자료가 바뀌었어요. 새로고침해주세요.');
    try{await room.join(name,state.coat,avatar,style);}
    catch(error){if(!style||error.code!=='STYLE_UNAVAILABLE')throw error;await room.join(name,state.coat,avatar);}
    saved.set('localStorage','knu-name',name);saved.set('localStorage','knu-avatar',avatar);
    void localUI.saveAppearance({name,avatar,coat:state.coat});
    $('join-dialog').close();viewport.focus({preventScroll:true});
    if(chosen&&!state.style)toast('코디를 불러올 때까지 기본 과잠을 입어요');
  }
  catch(error){if(!error.stale)$('join-error').textContent=error.message;}finally{joinBusy=false;syncControls();}});
document.querySelectorAll('input[name=avatar]').forEach(n=>n.addEventListener('change',()=>chooseAvatar(n.value)));
function updateChatButton(){$('send-chat').disabled=!room.online||chatBusy||!$('chat-input').value.trim();}
$('chat-input').addEventListener('input',updateChatButton);
$('chat-form').addEventListener('submit',async e=>{e.preventDefault();if(chatBusy||composing)return;const text=$('chat-input').value.trim();if(!text)return;chatBusy=true;syncControls();$('chat-error').textContent='';
  try{await room.send({type:'chat',text});if($('chat-input').value.trim()===text)$('chat-input').value='';}catch(error){if(!error.stale)$('chat-error').textContent=error.message;}finally{chatBusy=false;syncControls();}});
for(const input of [$('chat-input'),$('nickname')]){input.addEventListener('compositionstart',()=>{composing=true;stopInput();publishMovement();});input.addEventListener('compositionend',()=>composing=false);input.addEventListener('focus',()=>{stopInput();publishMovement();});}
async function playAction(type){
  const mine=snapshot.players.find(p=>p.id===room.me?.id);
  syncActionControls(mine,Date.now()+offset);
  if($(type).disabled)return;
  const request={owner:room.me};
  pendingAction=request;
  if(type==='wave'){stopInput();publishMovement();}
  syncActionControls(mine,Date.now()+offset);
  try{await room.send({type,scene:state.scene,positionRevision:state.positionRevision});}
  catch(error){if(!error.stale&&!['STALE_ACTION','KNOCKBACK','STUDY_ACTIVE','COOLDOWN'].includes(error.code))toast(error.message);}
  finally{if(pendingAction===request)pendingAction=null;}
}
for(const action of ['crouch','cheer','heart']){
  $(action).onclick=()=>{ $('gesture-dialog').close(); void playAction(action); };
}
for (const action of ['wave', 'jump']) {
  const button = $(action);
  const activate=()=>{
    if(action==='jump')return spaceAction();
    if($('gesture-dialog').open)$('gesture-dialog').close();
    return playAction(action);
  };
  let contact = null, lastTouch = -Infinity;
  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') contact = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  button.addEventListener('pointercancel', () => { contact = null; });
  button.addEventListener('pointerup', event => {
    if (event.pointerId !== contact?.id) return;
    const distance = Math.hypot(event.clientX - contact.x, event.clientY - contact.y);
    contact = null;
    lastTouch = performance.now();
    if (distance <= 14 && button.contains(document.elementFromPoint(event.clientX, event.clientY))) void activate();
  });
  button.addEventListener('click', event => {
    if (event.detail && performance.now() - lastTouch < 600 && event.pointerType !== 'mouse') return;
    void activate();
  });
}
$('run').addEventListener('click',()=>{state.running=!state.running;$('run').setAttribute('aria-pressed',String(state.running));});
async function bump(){
  if(bumpBusy||studying()||$('bump').disabled||typing()||blocking())return;
  if(!localUI.hasBump){localUI.setTab('themes');openPanel('local-dialog');return;}
  const target=selectedTarget,owner=room.me;if(!target||!owner)return;bumpBusy=true;localAttackUntil=Date.now()+offset+PLAY.cooldown;
  try{await room.send({type:'bump',targetId:target.id});}
  catch(error){if(room.me===owner)localAttackUntil=0;if(!error.stale)toast(error.message);}
  finally{bumpBusy=false;}
}
$('bump').addEventListener('click',()=>void bump());
$('glove-shop').onclick=()=>{localUI.setTab('themes');openPanel('local-dialog');};
$('playful-toggle').addEventListener('change',async e=>{const enabled=e.target.checked;playfulBusy=true;syncControls();try{await room.send({type:'playful',enabled});}catch(error){if(!error.stale)toast(error.message);const mine=snapshot.players.find(p=>p.id===room.me?.id);$('playful-toggle').checked=mine?.playful!==false;}finally{playfulBusy=false;syncControls();}});
$('overview').addEventListener('click',()=>{state.overview=true;$('room-dialog').close();camera();});$('recenter').addEventListener('click',()=>{state.overview=false;$('room-dialog').close();camera();});
world.classList.toggle('still-portals',motionPreference.matches);world.classList.toggle('slow-portals',powerSave);
$('motion-toggle').checked=!motionPreference.matches;water.setEnabled(!motionPreference.matches);ambient.setEnabled(!motionPreference.matches);$('motion-toggle').addEventListener('change',e=>{water.setEnabled(e.target.checked);ambient.setEnabled(e.target.checked);world.classList.toggle('still-portals',!e.target.checked);});
$('power-toggle').checked=powerSave;$('power-toggle').addEventListener('change',e=>{powerSave=e.target.checked;world.classList.toggle('slow-portals',powerSave);saved.set('localStorage','knu-power-save',powerSave?'1':'0');});
$('leave').addEventListener('click',async()=>{stopInput();try{await room.leave();}catch(error){if(!error.stale)toast('연결이 끊겨 광장에서 나왔어요');}});
viewport.addEventListener('click',e=>{
  if(seatBusy||state.furnitureSeat||!room.online||studying()||!sceneView.ready||sceneView.busy||blocking())return;
  if((e.target!==viewport && !world.contains(e.target)) || e.target.closest('button,dialog'))return;
  const box=viewport.getBoundingClientRect(),x=(e.clientX-box.left-sceneX)/sceneScale,y=(e.clientY-box.top-sceneY)/sceneScale;
  viewport.focus({preventScroll:true});
  const portal=sceneInfo(state.scene).portals.find(gate=>onPortalSurface(gate,x,y));
  if(portal){walkToGate(portal);return;}
  const hit=seatAtPoint(state.scene,x,y);
  if(hit){
    const selected=localSeats.find(seat=>seat.id===hit.id);
    if(!selected)return;
    if(seatButtons.get(selected.id)?.dataset.occupied!=='true')approachSeat(selected);
    else toast('이미 다른 사람이 앉아 있어요');
    return;
  }
  startWalk({x,y});
});
window.addEventListener('keydown',e=>{if(e.isComposing||composing||e.keyCode===229)return;const key=e.key.toLowerCase();if(key==='escape'){const d=[...document.querySelectorAll('dialog[open]')].at(-1);if(d&&d.id!=='join-dialog'){e.preventDefault();d.close();}return;}if(!room.online||typing()||blocking())return;
  const tap={w:[0,-1],arrowup:[0,-1],s:[0,1],arrowdown:[0,1],a:[-1,0],arrowleft:[-1,0],d:[1,0],arrowright:[1,0]}[key];
  if(tap && e.repeat && (state.target?.seat||state.target?.gate) && !keys.has(key))return;
  if(tap||key==='shift'){if(tap){tabNavigation=false;viewport.focus({preventScroll:true});}e.preventDefault();keys.add(key);if(tap&&!e.repeat&&!seatBusy&&!state.furnitureSeat&&!studying()&&sceneView.ready&&!sceneView.busy&&movementReady(state,Date.now()+offset)){const x=state.x+tap[0]*5,y=state.y+tap[1]*5;if(walkable(x,y,state.scene)){state.x=x;state.y=y;state.target=null;state.facing=directionFor(...tap,state.facing);state.stepUntil=performance.now()+120;}}}
  if(key==='f'&&!(e.ctrlKey||e.metaKey||e.altKey)){e.preventDefault();if(!e.repeat)void bump();}
  if(key==='c'&&!e.repeat&&!(e.ctrlKey||e.metaKey||e.altKey)){e.preventDefault();void playAction('crouch');}
  if((key==='j'||key===' '&&(!tabNavigation||!e.target.closest?.('button,a,summary')))&&!(e.ctrlKey||e.metaKey||e.altKey)){e.preventDefault();if(!e.repeat){if(key==='j'){if(!state.furnitureSeat)void playAction('jump');}else spaceAction();}}
  if(key==='enter'&&e.target.tagName!=='BUTTON'){e.preventDefault();if(!$('chat-dialog').open)openPanel('chat-dialog');else $('chat-input').focus();}});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>{stopInput();publishMovement();});
document.addEventListener('visibilitychange',()=>{stopInput();publishMovement();focusScene();if(document.visibilityState==='visible'){void room.probe();void studyUI.refresh();}});
window.addEventListener('online',()=>{if(room.me){room.connect();void room.probe();}else if(room.pendingSession)void room.resume();});window.addEventListener('offline',()=>room.status('offline'));
window.addEventListener('pagehide',()=>{stopInput();publishMovement();room.source?.close();});window.addEventListener('pageshow',e=>{if(e.persisted&&room.me){room.connect();void room.probe();}});
function updateJoystick(e){
  const base=$('joystick').getBoundingClientRect(),stick=$('stick');
  const dx=e.clientX-base.left-base.width/2,dy=e.clientY-base.top-base.height/2;
  const reach=Math.max(1,Math.min(28,(base.width-stick.offsetWidth)/2));
  const factor=Math.min(1,reach/Math.max(1,Math.hypot(dx,dy)));
  joystick={x:dx*factor/reach,y:dy*factor/reach};
  stick.style.transform=`translate(${dx*factor}px,${dy*factor}px)`;
}
$('joystick').addEventListener('pointerdown',e=>{if(seatBusy||state.furnitureSeat||pointer!==null||!room.online||studying()||sceneView.busy||!sceneView.ready||blocking())return;e.preventDefault();pointer=e.pointerId;viewport.focus({preventScroll:true});$('joystick').setPointerCapture(pointer);updateJoystick(e);});$('joystick').addEventListener('pointermove',e=>{if(e.pointerId===pointer)updateJoystick(e);});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('joystick').addEventListener(event,e=>{if(e.pointerId!==pointer)return;pointer=null;joystick={x:0,y:0};$('stick').style.transform='';});
async function loadInvite(){let target=`${location.origin}/r/${location.pathname.split('/')[2]}`;$('share-url').value=target;$('invite-error').textContent='';$('invite-qr').hidden=true;
  try{const response=await fetch(room.api+'info');if(!response.ok)throw Error();const info=await response.json();const urls=info.urls.sort((a,b)=>Number(!/wi-fi|wlan|무선/i.test(a.name))-Number(!/wi-fi|wlan|무선/i.test(b.name)));if(['localhost','127.0.0.1'].includes(location.hostname)&&urls.length)target=urls[0].url;$('share-url').value=target;const qr=$('invite-qr');qr.onload=()=>qr.hidden=false;qr.onerror=()=>{$('invite-error').textContent='QR을 불러오지 못했어요. 링크를 복사해주세요';};qr.src=`${room.api}qr?url=${encodeURIComponent(target)}`;}catch{$('invite-error').textContent='QR을 불러오지 못했어요. 링크를 복사해주세요';}}
$('copy-link').addEventListener('click',async()=>{const input=$('share-url');let copied=false;try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(input.value);copied=true;}}catch{}
  if(!copied){input.focus();input.select();input.setSelectionRange(0,input.value.length);try{copied=document.execCommand('copy');}catch{}}
  $('copy-link').textContent=copied?'복사됨':'링크 선택됨';if(!copied)$('invite-error').textContent='선택한 링크를 길게 누르거나 복사해주세요';setTimeout(()=>$('copy-link').textContent='링크 복사',2200);});
async function init(){if(assetBusy)return;assetBusy=true;$('loading').hidden=false;$('loading-text').textContent='광장 불러오는 중';$('asset-retry').hidden=true;syncControls();
  const coat=saved.get('localStorage','knu-coat');if(COATS.includes(coat))state.coat=coat;
  try{await Promise.all([art.load(),spaces.info(),sceneView.show(state.scene)]);portraits();$('loading').hidden=true;syncControls();await room.resume();}catch{$('loading-text').textContent='캐릭터를 불러오지 못했어요';$('asset-retry').hidden=false;}finally{assetBusy=false;}}
$('asset-retry').addEventListener('click',()=>void init());
setInterval(publishMovement,80);setInterval(()=>void room.probe(),10000);schedule();void init();

// 수업중 status lives on the IT5 forecourt only; the server clears it when the student leaves.
function syncClass(me){
  const button=$('class-toggle'),here=(me?.campus?.scene||'plaza')==='it',on=!!me?.inClass;
  button.hidden=!here&&!on;button.setAttribute('aria-pressed',String(on));button.textContent=on?'수업중 · 끝내기':'수업 듣기';
  $('player').classList.toggle('in-class',on);
}
$('class-toggle').addEventListener('click',async()=>{
  const button=$('class-toggle'),on=button.getAttribute('aria-pressed')!=='true';button.disabled=true;
  try{await room.send({type:'class',on});}catch(error){if(!error.stale)toast(error.message||'잠시 후 다시 해주세요');}finally{button.disabled=false;}
});
