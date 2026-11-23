import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { campusAsset, wardrobeAssets } from './campus-assets.mjs';
import { COATS, AVATARS, FACINGS, MOTIONS, freeSpawn, walkable } from '../public/campus/world.js';
import { PLAY, canPlay, protectedFromHit, pushDestination } from '../public/campus/play.js';
import { StudyStore } from './study-store.mjs';
import { Room } from './room.mjs';
import { seats } from './seats.mjs';
import {sceneInfo,sameScene,arrivalFrom,canAttendClass} from '../public/campus/scenes.js';
import { furnitureSeats, seatApproach, SEAT_REACH } from '../public/campus/furniture.js';
import { STUDENT_ACTION } from '../public/campus/student-motion.js';
import { styleForAvatar } from '../public/campus/wardrobe.js';
import { createTutor, TUTOR_LIMITS } from './tutor.mjs';
export { seats } from './seats.mjs';

const palette = ['#8fd6af', '#e8b183', '#aeb8ef', '#e8a4b6', '#86c8da', '#ddce88', '#bdade0', '#b4ca8c'];
export function localAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    addresses.filter(a => a.family === 'IPv4' && !a.internal && !/vmware|virtual|vbox|bluetooth|이더넷 2/i.test(name))
      .map(a => ({ name, address: a.address })));
}

function roomInviteUrls(listener, roomCode) {
  let addresses;
  if (listener.address === '0.0.0.0' || listener.address === '::') {
    addresses = localAddresses();
  } else if (listener.address === '127.0.0.1' || listener.address === '::1') {
    addresses = [{ name: 'Local preview', address: listener.address }];
  } else {
    addresses = [localAddresses().find(entry => entry.address === listener.address)
      ?? { name: 'LAN', address: listener.address }];
  }
  return addresses.map(entry => {
    const host = entry.address.includes(':') ? `[${entry.address}]` : entry.address;
    return { ...entry, url: `http://${host}:${listener.port}/r/${roomCode}` };
  });
}

export function createStudyServer({ roomCode = randomBytes(12).toString('hex'), now = Date.now, ttl = 45000, onRequest = () => {},hub=false,studyPath=':memory:',tutor=hub?createTutor():null } = {}) {
  const study=hub?new StudyStore(studyPath,{now}):null,rooms=new Map(),transfers=new Map(),metrics={movementBroadcasts:0,framesSent:0,bytesSent:0,maxBufferedBytes:0};
  const outfitRequests=new WeakMap();
  const addRoom=info=>{const room=new Room({...info,study,now,metrics,batch:hub});rooms.set(room.code,room);return room;};
  addRoom({code:roomCode,name:'일청담 광장',capacity:hub?100:8,isMain:true});
  const hallCode = 'reading-hall';
  if (hub) addRoom({code:hallCode,name:'중앙도서관 열람실',capacity:64,mode:'study'});
  for(const s of study?.allSpaces()||[])addRoom(s);
  function arrival(room) {
    const scene = hub && room.code === hallCode ? 'lounge' : 'plaza';
    const occupied = [...room.players.values()].map(player => player.campus).filter(campus => campus.scene === scene);
    return freeSpawn(occupied, scene, hub && room.isMain);
  }
  const notifyStudy=profileId=>{
    const active=study.getActive(profileId);
    for(const room of rooms.values()){
      const participants=[...room.players.values()].filter(p=>p.profileId===profileId);
      if(!participants.length)continue;
      for(const p of participants){
        p.focusSince=active?.startedAt??null;
        if(active){p.campus.jumpAt=0;p.campus.waveAt=0;p.campus.crouch=false;}
      }
      room.broadcast();
    }
  };
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  async function body(req,limit=4096) {
    let size=0;
    const chunks=[];
    for await (const chunk of req) {
      size+=chunk.length;
      if(size>limit)throw Object.assign(new Error('요청이 너무 커요.'),{status:413});
      chunks.push(chunk);
    }
    const data=Buffer.concat(chunks,size).toString('utf8');
    try { const parsed = JSON.parse(data); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); return parsed; }
    catch { throw Object.assign(new Error('요청 형식을 확인해주세요.'), { status: 400 }); }
  }
  // AI 튜터(src/tutor.mjs). 답은 한 줄에 JSON 하나씩(NDJSON) 흘려보낸다: {wait} {text} {done} {error}.
  async function tutorRoute(req,res,route){
    const data=await body(req,TUTOR_LIMITS.body),profile=study.profile(data.profileKey);
    if(route==='status'){const result=await tutor.status(profile.id);if(result.ready&&data.warm)tutor.warm();return json(res,200,result);}
    if(route!=='ask')return json(res,404,{error:'없는 요청이에요.'});
    const active=study.getActive(profile.id),controller=new AbortController();
    res.on('close',()=>{if(!res.writableFinished)controller.abort();});
    let started=false;
    const send=event=>{
      if(!started){started=true;res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'});}
      if(!res.destroyed)res.write(JSON.stringify(event)+'\n');
    };
    try{
      await tutor.ask({profileId:profile.id,question:data.question,history:data.history,study:active&&{subject:active.subject,goal:active.goal},signal:controller.signal,onEvent:send});
      res.end();
    }catch(error){
      if(error.code==='ABORT'||controller.signal.aborted)return res.end();
      const message=error.status?error.message:'튜터가 답을 만들지 못했어요. 다시 물어봐 주세요.';
      if(!started)return json(res,error.status||500,{error:message,code:error.code});
      send({error:message,code:error.code});res.end();
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const requestKind = url.pathname === '/health' ? 'health' : url.pathname.startsWith('/r/') ? 'room-page' : ['info', 'qr', 'join', 'events', 'action'].includes(url.pathname.split('/').at(-1)) ? url.pathname.split('/').at(-1) : 'asset';
      onRequest({ method: req.method, kind: requestKind, remote: req.socket.remoteAddress });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: '이 방의 화면에서 다시 시도해주세요.' });
      if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
      if (url.pathname === '/' && req.method === 'GET') { res.writeHead(302, { Location: `/r/${roomCode}` }); return res.end(); }
      if(tutor&&study&&req.method==='POST'&&url.pathname.startsWith('/api/tutor/'))return await tutorRoute(req,res,url.pathname.slice('/api/tutor/'.length));
      if(hub&&req.method==='POST'&&(url.pathname.startsWith('/api/hub/')||url.pathname.startsWith('/api/study/'))){
        const data=await body(req),profile=study.profile(data.profileKey);
        if(url.pathname==='/api/hub/rooms/list')return json(res,200,{rooms:[rooms.get(roomCode).info(),rooms.get(hallCode).info(),...study.spaces(profile.id).map(s=>rooms.get(s.code)?.info()).filter(Boolean)]});
        if(url.pathname==='/api/hub/rooms/create'){const info=study.createSpace(profile.id,data);addRoom(info);study.visit(profile.id,info.code);return json(res,200,{room:rooms.get(info.code).info()});}
        if(url.pathname==='/api/study/me')return json(res,200,{study:study.summary(profile.id)});
        if(url.pathname==='/api/study/archive')return json(res,200,study.archive(profile.id,data.since));
        if(url.pathname==='/api/study/start'){study.start(profile.id,data.subject,data.goal);notifyStudy(profile.id);return json(res,200,{study:study.summary(profile.id)});}
        if(url.pathname==='/api/study/confirm'){const result=study.confirm(profile.id,data);notifyStudy(profile.id);return json(res,200,{study:result});}
        if(url.pathname==='/api/study/ranking'){const rows=study.ranking(data.scope);return json(res,200,{at:now(),rows:rows.slice(0,50),mine:rows.find(p=>p.id===profile.id)||null});}
        return json(res,404,{error:'없는 요청이에요.'});
      }
      if (req.method === 'GET' && url.pathname.startsWith('/campus/')) {
        const asset = await campusAsset(url.pathname);
        if (!asset) return json(res, 404, { error: '없는 파일이에요.' });
        res.writeHead(200, { 'Content-Type': asset.type }); return res.end(asset.content);
      }
      const requestedCode=url.pathname.split('/')[2],currentRoom=rooms.get(requestedCode),assets = { ...(currentRoom?{[`/r/${requestedCode}`]:[url.searchParams.get('view')==='classic'?'index.html':'campus/index.html','text/html']}:{}), '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        const content = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(content);
      }
      if(req.method==='GET'&&url.pathname.startsWith('/r/')) {
        res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});
        return res.end(await readFile(new URL('../public/campus/expired.html',import.meta.url)));
      }
      const prefix = `/api/${requestedCode}/`;
      if (!currentRoom||!url.pathname.startsWith(prefix)) return json(res, 404, { error: '초대 링크 전체를 열어주세요. 방장이 보낸 주소가 필요해요.' });
      const {players,joins,streams,messages,impacts}=currentRoom,snapshot=()=>currentRoom.snapshot(),broadcast=options=>currentRoom.broadcast(options),remove=session=>currentRoom.remove(session);
      const route = url.pathname.slice(prefix.length);
      if (req.method === 'GET' && route === 'info') {
        return json(res, 200, { room: currentRoom.info(), urls: roomInviteUrls(server.address(), requestedCode) });
      }
      if (req.method === 'GET' && route === 'qr') {
        const target = url.searchParams.get('url');
        const listener = server.address();
        const allowed = roomInviteUrls(listener, requestedCode).map(entry => entry.url);
        if (listener.address === '0.0.0.0' || listener.address === '::') {
          allowed.push(`http://127.0.0.1:${listener.port}/r/${requestedCode}`);
        }
        if (!allowed.includes(target)) return json(res, 400, { error: '공유 주소를 확인해주세요.' });
        const svg = await QRCode.toString(target, { type: 'svg', width: 240, margin: 2, color: { dark: '#20352cff', light: '#ffffffff' } });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(svg);
      }
      if (req.method === 'GET' && route === 'events') {
        const session = url.searchParams.get('session');
        const p = players.get(session);
        if (!p) return json(res, 401, { error: '다시 입장해주세요.' });
        p.lastSeen = now();
        req.socket.setKeepAlive(true, 10000);
        streams.get(session)?.end();
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.compactMoves = hub && currentRoom.isMain && url.searchParams.get('moves') === '1';
        res.studyOnly=url.searchParams.get('view')==='study';res.write(`data: ${JSON.stringify(snapshot())}\n\n`); streams.set(session, res);
        req.on('close', () => { if (streams.get(session) === res) { streams.delete(session); if (players.has(session)) players.get(session).lastSeen = now(); } });
        return;
      }
      if (req.method !== 'POST') return json(res, 405, { error: '지원하지 않는 요청이에요.' });
      const data = await body(req);
      if (route === 'join') {
        const name = typeof data.name === 'string' ? data.name.trim() : '';
        if (!name || name.length > 16 || /[\x00-\x1f\x7f]/.test(name)) return json(res, 400, { error: '이름을 1~16자로 입력해주세요.' });
        if (data.coat !== undefined && !COATS.includes(data.coat)) return json(res, 400, { error: '과잠 색상을 다시 선택해주세요.' });
        if(data.avatar!==undefined&&!AVATARS.includes(data.avatar)) return json(res,400,{error:'캐릭터를 다시 골라주세요.'});
        if(data.joinKey!==undefined&&(typeof data.joinKey!=='string'||!/^[a-f0-9]{32}$/.test(data.joinKey))) return json(res,400,{error:'입장 정보를 다시 확인해주세요.'});
        if(data.style!=null){
          if(!styleForAvatar(data.style,data.avatar??'male'))return json(res,400,{error:'캐릭터에 맞는 코디를 골라주세요.'});
          if(!await wardrobeAssets(data.style))return json(res,409,{error:'이 코디 그림을 아직 사용할 수 없어요.',code:'STYLE_UNAVAILABLE'});
        }
        const existing=data.joinKey?players.get(joins.get(data.joinKey)):null;
        if(existing) { existing.lastSeen=now(); return json(res,200,{session:existing.session,id:existing.id,state:snapshot()}); }
        if (players.size >= currentRoom.capacity) return json(res, 409, { error: `${currentRoom.capacity}명이 모두 찼어요. 다른 광장을 이용해주세요.` });
        const profile=study?study.profile(data.profileKey,name,true):null;
        const session = randomBytes(24).toString('hex');
        const used = new Set([...players.values()].map(p => p.color));
        // The classic canvas shares this room and has a 785px right boundary.
        const wrapClassic = hub && currentRoom.isMain;
        const classicColumn = wrapClassic ? players.size % 19 : players.size;
        const classicRow = wrapClassic ? Math.floor(players.size / 19) : 0;
        const p = { id: randomUUID(), name, color: palette.find(c => !used.has(c)) || palette[0], x: 350 + classicColumn * 24, y: 450 - classicRow * 24,
          coat: data.coat ?? 'burgundy', avatar: data.avatar??'male', ...(data.style?{style:data.style}:{}), playful:true, joinKey:data.joinKey,
          profileId:profile?.id,campus: {...arrival(currentRoom),positionRevision:0,hitAt:0,bumpUntil:0,attackAt:0,jumpAt:0,nextJumpAt:0,crouch:false},
          seat: null, focusSince: study?.getActive(profile?.id)?.startedAt??null, focusedMs: 0, lastSeen: now(), session, lastChat: 0 };
        if(study&&!currentRoom.isMain&&currentRoom.code!==hallCode)study.visit(profile.id,currentRoom.code);
        players.set(session, p); if(data.joinKey)joins.set(data.joinKey,session); broadcast({membership:true});
        return json(res, 200, { session, id: p.id, state: snapshot() });
      }
      if (route === 'resume') {
        const p = players.get(data.session);
        if (!p) return json(res, 401, { error: '연결이 만료됐어요. 다시 입장해주세요.' });
        p.lastSeen = now();
        return json(res, 200, { id: p.id, state: snapshot() });
      }
      if (route !== 'action') return json(res, 404, { error: '없는 요청이에요.' });
      const transferId=`${data.session}:${data.transferKey}`;
      if(data.type==='transfer'&&transfers.has(transferId))return json(res,200,transfers.get(transferId).result);
      const p = players.get(data.session);
      if (!p) return json(res, 401, { error: '연결이 만료됐어요. 다시 입장해주세요.' });
      p.lastSeen = now();
      if(study?.getActive(p.profileId)){
        p.focusSince=study.getActive(p.profileId).startedAt;
        if(['move','seat','focus'].includes(data.type))return json(res,409,{error:'공부를 확인하고 휴식한 뒤 이동해주세요.',code:'STUDY_ACTIVE'});
      }
      const stopFocus = () => { if (p.focusSince !== null) { p.focusedMs += now() - p.focusSince; p.focusSince = null; } };
      switch (data.type) {
        case 'reading-desk': {
          if (!hub || currentRoom.code !== hallCode) return json(res,400,{error:'열람실에서 자리를 골라주세요.'});
          if (study.getActive(p.profileId)) return json(res,409,{error:'공부를 마친 뒤 자리를 옮겨주세요.'});
          const desk = data.desk;
          if (desk !== null && (!Number.isInteger(desk) || desk < 1 || desk > 64)) return json(res,400,{error:'1~64번 좌석을 골라주세요.'});
          if (desk !== null && [...players.values()].some(other => other.id !== p.id && (other.desk === desk || other.profileId === p.profileId && other.desk != null))) {
            return json(res,409,{error:'이미 사용 중인 자리예요.'});
          }
          p.desk = desk;
          break;
        }
        case 'scene':{
          const target=sceneInfo(data.scene);if(!target)return json(res,400,{error:'이동할 장소를 다시 골라주세요.'});
          if(study?.getActive(p.profileId)||p.focusSince!==null)return json(res,409,{error:'공부를 확인하고 휴식한 뒤 이동해주세요.',code:'STUDY_ACTIVE'});
          if(now()<p.campus.bumpUntil)return json(res,409,{error:'위치를 맞춘 뒤 이동해주세요.',code:'KNOCKBACK'});
          if((p.campus.scene||'plaza')===target.id)return json(res,200,{ok:true});
          if(data.via!==undefined){const gate=sceneInfo(p.campus.scene||'plaza').portals.find(g=>g.id===data.via&&g.target===target.id);if(!gate||Math.hypot(p.campus.x-gate.x,p.campus.y-gate.y)>78)return json(res,409,{error:'입구 가까이에서 이동해주세요.'});}
          const revision=p.campus.positionRevision+1;p.inClass=false;
          Object.assign(p.campus,freeSpawn([...players.values()].filter(q=>q.id!==p.id&&(q.campus.scene||'plaza')===target.id).map(q=>q.campus),target.id),{...(data.via?arrivalFrom(p.campus.scene||'plaza',target.id):{}),positionRevision:revision,movedAt:now(),jumpAt:0,crouch:false,furnitureSeat:null});p.seat=null;
          break;
        }
        case 'transfer': {
          const target=rooms.get(data.targetCode);
          if(!hub||!target||target===currentRoom||typeof data.transferKey!=='string'||!/^[a-f0-9]{32}$/.test(data.transferKey))return json(res,400,{error:'이동할 광장을 다시 골라주세요.'});
          if(target.players.size>=target.capacity)return json(res,409,{error:'그 광장이 가득 찼어요. 지금 광장은 유지했어요.'});
          const nextSession=randomBytes(24).toString('hex'),next={...p,inClass:false,shareCalendar:false,desk:null,session:nextSession,joinKey:undefined,seat:null,lastSeen:now(),campus:{...arrival(target),positionRevision:0,hitAt:0,bumpUntil:0,attackAt:0,jumpAt:0,nextJumpAt:p.campus.nextJumpAt}};
          if(!target.isMain&&target.code!==hallCode)study.visit(p.profileId,target.code);
          remove(data.session);target.players.set(nextSession,next);broadcast({membership:true});target.broadcast({membership:true});
          const result={code:target.code,id:p.id,session:nextSession};transfers.set(transferId,{at:now(),result});
          if(transfers.size>256)transfers.delete(transfers.keys().next().value);
          return json(res,200,result);
        }
        case 'ping': return json(res, 200, { ok: true });
        case 'furniture-seat': {
          if (!hub || currentRoom.code === hallCode) return json(res,400,{error:'광장에서 자리를 골라주세요.'});
          if (study.getActive(p.profileId) || p.focusSince !== null)
            return json(res,409,{error:'공부를 확인하고 휴식한 뒤 자리를 바꿔주세요.',code:'STUDY_ACTIVE'});
          const campus = p.campus, scene = campus.scene || 'plaza';
          if (data.scene !== scene || data.positionRevision !== campus.positionRevision)
            return json(res,409,{error:'위치가 바뀌었어요. 다시 시도해주세요.',code:'STALE_ACTION'});
          if (now() < campus.bumpUntil) return json(res,409,{error:'위치를 맞춘 뒤 시도해주세요.',code:'KNOCKBACK'});
          if (data.seat === null) {
            if (!campus.furnitureSeat) break;
            const previous=furnitureSeats(scene).find(seat=>seat.id===campus.furnitureSeat);
            if(previous)Object.assign(campus,seatApproach(previous));
            campus.furnitureSeat = null;
            campus.positionRevision++;
            break;
          }
          const seat = furnitureSeats(scene).find(seat => seat.id === data.seat);
          if (!seat) return json(res,400,{error:'이 장소의 자리를 골라주세요.'});
          if (Math.hypot(seat.x - campus.x, seat.y - campus.y) > SEAT_REACH)
            return json(res,409,{error:'자리에 조금 더 가까이 가주세요.'});
          if ([...players.values()].some(other => other !== p && other.campus.furnitureSeat === seat.id))
            return json(res,409,{error:'이미 다른 사람이 앉아 있어요.'});
          p.seat = null;
          Object.assign(campus,{x:seat.x,y:seat.y,facing:seat.facing ?? 'south',motion:'idle',movedAt:now(),
            crouch:false,jumpAt:0,waveAt:0,furnitureSeat:seat.id,positionRevision:campus.positionRevision+1});
          break;
        }
        case 'campus-move':
          if(study?.getActive(p.profileId))return json(res,409,{error:'공부를 확인하고 휴식한 뒤 이동해주세요.',code:'STUDY_ACTIVE'});
          if((data.positionRevision??0)!==p.campus.positionRevision||data.scene!==undefined&&data.scene!==(p.campus.scene||'plaza'))
            return json(res,409,{error:'밀린 위치를 맞추고 있어요.',code:'STALE_MOVE'});
          if(p.campus.furnitureSeat)return json(res,409,{error:'먼저 자리에서 일어나주세요.',code:'SEATED'});
          if (!walkable(data.x, data.y,p.campus.scene||'plaza') || !FACINGS.includes(data.facing) || !MOTIONS.includes(data.motion))
            return json(res, 400, { error: '길 위의 위치와 이동 방향을 확인해주세요.' });
          if(now()<p.campus.bumpUntil)
            return json(res,409,{error:'잠깐 밀리고 있어요.',code:'KNOCKBACK'});
          stopFocus(); p.seat = null;
          if(data.motion!=='idle')p.campus.crouch=false;
          Object.assign(p.campus, { x: data.x, y: data.y, facing: data.facing, motion: data.motion, movedAt: now() }); break;
        case 'outfit': {
          if (!COATS.includes(data.coat)) return json(res, 400, { error: '과잠 색상을 다시 선택해주세요.' });
          if(data.style!=null&&!styleForAvatar(data.style,p.avatar))return json(res,400,{error:'캐릭터에 맞는 코디를 골라주세요.'});
          const request={};outfitRequests.set(p,request);
          if(data.style!=null){
            if(!await wardrobeAssets(data.style))return json(res,409,{error:'이 코디 그림을 아직 사용할 수 없어요.',code:'STYLE_UNAVAILABLE'});
            if(players.get(data.session)!==p||outfitRequests.get(p)!==request)
              return json(res,409,{error:'새 코디 선택을 먼저 처리했어요.',code:'STALE_OUTFIT'});
            p.style=data.style;
          }else delete p.style;
          p.coat=data.coat;
          break;
        }
        case 'crouch':
        case 'cheer':
        case 'heart':
        case 'wave':
        case 'jump': {
          const at=now(),jumping=data.type==='jump';
          if(p.campus.furnitureSeat&&(jumping||data.type==='crouch'))return json(res,409,{error:'먼저 자리에서 일어나주세요.',code:'SEATED'});
          if(p.focusSince!==null)return json(res,409,{error:'휴식한 뒤에 할 수 있어요.',code:'STUDY_ACTIVE'});
          // Legacy wave callers omit location. Jump always carries the current scene and feet revision.
          if((jumping||data.scene!==undefined||data.positionRevision!==undefined)&&
             (data.scene!==(p.campus.scene||'plaza')||data.positionRevision!==p.campus.positionRevision))
            return json(res,409,{error:'위치가 바뀌었어요.',code:'STALE_ACTION'});
          if(at<p.campus.bumpUntil)return json(res,409,{error:'잠깐 밀리고 있어요.',code:'KNOCKBACK'});
          if(jumping){
            if(at<p.campus.nextJumpAt)return json(res,429,{error:'잠깐 쉬고 다시 뛰어요.',code:'COOLDOWN'});
            p.campus.jumpAt=at;
            p.campus.nextJumpAt=at+STUDENT_ACTION.jumpCooldown;
          }else if(data.type==='crouch'){
            p.campus.crouch=!p.campus.crouch;
            p.campus.jumpAt=0;
          }else{
            p.campus.waveAt=at;
            p.campus.reaction=data.type;
          }
          if(data.type!=='crouch')p.campus.crouch=false;
          break;
        }
        case 'class':
          // 수업중 status: only on the IT5 forecourt; leaving the scene ends it.
          if(typeof data.on!=='boolean')return json(res,400,{error:'수업 상태를 다시 골라주세요.'});
          if(data.on&&!canAttendClass(p.campus.scene))return json(res,409,{error:'수업은 IT대학 융복합관에서만 들을 수 있어요.',code:'CLASS_PLACE'});
          p.inClass=data.on;break;
        case 'playful':
          if(typeof data.enabled!=='boolean')return json(res,400,{error:'장난 설정을 다시 확인해주세요.'});
          p.playful=data.enabled;break;
        case 'bump': {
          if(currentRoom.mode==='study')return json(res,409,{error:'공부 광장에서는 장난을 쉬어요.'});
          if(!canPlay(p))return json(res,409,{error:'장난 받기를 켜고 쉬는 중에 할 수 있어요.'});
          const at=now();
          if(p.campus.attackAt>0&&at-p.campus.attackAt<PLAY.cooldown)return json(res,429,{error:'잠깐 쉬었다 툭!',code:'COOLDOWN'});
          const target=[...players.values()].find(other=>other.id===data.targetId);
          if(!target||target.id===p.id||!sameScene(p.campus,target.campus)||study?.getActive(target.profileId)||!canPlay(target)||protectedFromHit(target,at)||at<p.campus.bumpUntil)
            return json(res,409,{error:'지금은 그 친구를 칠 수 없어요.'});
          if(Math.hypot(target.campus.x-p.campus.x,target.campus.y-p.campus.y)>PLAY.range)
            return json(res,409,{error:'친구에게 조금 더 가까이 가주세요.'});
          const from={x:target.campus.x,y:target.campus.y},to=pushDestination(p.campus,target.campus);
          p.campus.attackAt=at;
          Object.assign(target.campus,{x:to.x,y:to.y,motion:'idle',movedAt:at,hitAt:at,bumpUntil:at+PLAY.settle,positionRevision:target.campus.positionRevision+1,crouch:false,jumpAt:0,waveAt:0});
          impacts.push({id:randomUUID(),attackerId:p.id,targetId:target.id,scene:p.campus.scene||'plaza',at,from,to:{x:to.x,y:to.y}});
          if(impacts.length>8)impacts.shift();
          break;
        }
        case 'move':
          if (!Number.isFinite(data.x) || !Number.isFinite(data.y) || data.x < 35 || data.x > 785 || data.y < 70 || data.y > 485)
            return json(res, 400, { error: '방 안의 위치를 선택해주세요.' });
          stopFocus(); p.seat = null;
          p.campus.crouch=false; p.x = data.x; p.y = data.y; break;
        case 'seat':
          if (!Number.isInteger(data.seat) || !seats[data.seat]) return json(res, 400, { error: '책상을 선택해주세요.' });
          if ([...players.values()].some(other => other.id !== p.id && other.seat === data.seat)) return json(res, 409, { error: '이미 다른 사람이 앉아 있어요.' });
          stopFocus(); p.seat = data.seat; p.x = seats[data.seat].x; p.y = seats[data.seat].y + 53; break;
        case 'focus':
          if (typeof data.focus !== 'boolean') return json(res, 400, { error: '공부 상태를 확인해주세요.' });
          if (data.focus && p.seat === null) return json(res, 400, { error: '먼저 빈 책상을 눌러 앉아주세요.' });
          if (data.focus && p.focusSince === null) { p.focusSince = now(); p.campus.jumpAt=0; p.campus.waveAt=0; }
          if (!data.focus) stopFocus(); break;
        case 'calendar-sharing':
          if(!study||typeof data.enabled!=='boolean')return json(res,400,{error:'공부 달력 공유 설정을 확인해주세요.'});
          p.shareCalendar=data.enabled;
          break;
        case 'friend-calendar': {
          const friend=[...players.values()].find(other=>other.id===data.playerId);
          if(!study||!friend?.shareCalendar)return json(res,404,{error:'친구가 현재 공부 달력을 공유하지 않아요.'});
          return json(res,200,{days:study.calendar(friend.profileId,data.month)});
        }
        case 'chat': {
          const text = typeof data.text === 'string' ? data.text.trim() : '';
          if (!text || text.length > 200) return json(res, 400, { error: '메시지는 1~200자로 입력해주세요.' });
          if (now() - p.lastChat < 500) return json(res, 429, { error: '잠깐만 기다렸다 보내주세요.' });
          p.lastChat = now(); messages.push({ id: randomUUID(), playerId: p.id, name: p.name, color: p.color, avatar: p.avatar, coat: p.coat, style: p.style, text, at: now() });
          if (messages.length > 50) messages.shift(); break;
        }
        case 'leave': remove(data.session); break;
        default: return json(res, 400, { error: '지원하지 않는 동작이에요.' });
      }
      broadcast({movement:data.type==='campus-move',player:p,membership:data.type==='leave'}); return json(res, 200, { ok: true });
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '잠시 후 다시 시도해주세요.',code:error.code });
      else res.end();
    }
  });
  const cleanup = setInterval(() => {
    for(const[key,receipt]of transfers)if(now()-receipt.at>300000)transfers.delete(key);
    for(const room of rooms.values()){
      let changed=false;for(const [session,p]of room.players)if(!room.streams.has(session)&&now()-p.lastSeen>ttl){room.remove(session);changed=true;}
      if(changed)room.broadcast();for(const res of room.streams.values())res.write(': heartbeat\n\n');
    }
  }, 5000);
  cleanup.unref();
  const movementTimer=hub?setInterval(()=>{for(const room of rooms.values())room.flush();},100):null;movementTimer?.unref();
  server.on('close', () => { clearInterval(cleanup);if(movementTimer)clearInterval(movementTimer);for(const room of rooms.values())room.close();study?.close(); });
  server.metrics=metrics;
  server.roomCode = roomCode;
  return server;
}
