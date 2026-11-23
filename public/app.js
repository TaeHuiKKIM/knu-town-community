import { profileKey } from './campus/network.js';
const $ = id => document.getElementById(id);
const code = location.pathname.split('/')[2];
const api = `/api/${code}/`;
let me = null, state = { players: [], messages: [], seats: [] }, source, online = false, offset = 0;
let lastMessage = '', lastPing = 0, toastTimer, urls = [];
const canvas = $('room'), ctx = canvas.getContext('2d');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const positions = new Map();
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3800); }
function connection(text, mode = '') { $('connection').textContent = text; $('connection').className = `connection ${mode}`; online = mode === 'online'; $('focus').disabled = !me || !online; $('chat').disabled = !me || !online; $('send').disabled = !me || !online; $('seat-select').disabled = !me || !online; }
async function post(route, data) {
  const res = await fetch(api + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(6000) });
  const json = await res.json();
  if (!res.ok) { const e = new Error(json.error || '연결을 확인해주세요.'); e.status = res.status; throw e; }
  return json;
}
function reset() { source?.close(); source = null; me = null; connection('입장 대기'); $('leave').disabled = true; $('join-dialog').showModal(); render(); }
async function act(data) {
  if (!me || !online) return false;
  try { await post('action', { session: me.session, ...data }); return true; }
  catch (e) { if (e.status === 401) reset(); toast(e.message || '연결을 확인해주세요.'); return false; }
}
function accept(next) { state = next; offset = next.at - Date.now(); render(); }
function connect() {
  source?.close();
  connection('연결 중…');
  source = new EventSource(api + `events?session=${encodeURIComponent(me.session)}`);
  source.onmessage = event => { connection('같은 방에 연결됨', 'online'); accept(JSON.parse(event.data)); };
  source.onerror = () => { connection('연결 확인 중…', 'offline'); };
}
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function elapsed(p) { return p.focusedMs + (p.focusSince !== null ? Math.max(0, Date.now() + offset - p.focusSince) : 0); }
function time(ms, full = true) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0'), m = String(Math.floor(seconds / 60) % 60).padStart(2, '0'), s = String(seconds % 60).padStart(2, '0');
  return full ? `${h}:${m}:${s}` : `${Math.floor(seconds / 60)}분`;
}
function render() {
  $('occupancy').textContent = `${state.players.length} / ${state.capacity||8}명`;
  $('people-count').textContent = `${state.players.length}명`;
  $('people').replaceChildren();
  for (const p of state.players) {
    const row = el('li', 'person');
    const avatar = el('span', 'avatar', p.name.slice(0, 1)); avatar.style.background = p.color;
    const info = el('div', 'person-info'), name = el('strong', 'person-name', p.name);
    if (p.id === me?.id) name.append(el('span', 'you', '나'));
    info.append(name, el('span', 'person-state', p.focusSince !== null ? '● 집중하고 있어요' : p.seat !== null ? `${p.seat + 1}번 책상 · 쉬는 중` : '방 안을 둘러보는 중'));
    const timer = el('span', 'person-time', time(elapsed(p), false)); timer.dataset.playerId = p.id;
    row.append(avatar, info, timer); $('people').append(row);
  }
  if (!state.players.length) $('people').append(el('li', 'empty-people', '첫 번째 공부 친구를 기다려요.'));
  const mine = state.players.find(p => p.id === me?.id);
  $('self-name').textContent = mine ? mine.name : '아직 입장 전이에요';
  $('self-avatar').textContent = mine ? mine.name.slice(0, 1) : '나';
  $('self-avatar').style.background = mine?.color || '#dcebd8';
  $('self-status').textContent = mine ? mine.focusSince !== null ? '집중 중 · 이동하면 공부가 일시 정지돼요' : mine.seat !== null ? `${mine.seat + 1}번 책상에 앉아 있어요` : '빈 책상을 눌러 앉아주세요' : '이름을 입력하고 함께 시작해요';
  $('focus').textContent = mine?.focusSince != null ? '잠깐 쉬기' : '공부 시작';
  $('seat-select').replaceChildren(el('option', '', '책상을 골라 앉아보세요'));
  $('seat-select').firstChild.value = '';
  state.seats.forEach((seat, i) => {
    const occupant = state.players.find(p => p.seat === i);
    const option = el('option', '', `${i + 1}번 책상${occupant ? ` · ${occupant.name}` : ' · 빈자리'}`);
    option.value = i; option.disabled = !!occupant && occupant.id !== me?.id; $('seat-select').append(option);
  });
  $('seat-select').value = mine?.seat ?? '';
  const marker = state.messages.at(-1)?.id || '';
  if (marker !== lastMessage) {
    lastMessage = marker;
    const nearBottom = $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 70;
    $('messages').replaceChildren();
    for (const msg of state.messages) {
      const item = el('div', 'message'), head = el('div', 'message-head');
      head.append(el('strong', '', msg.name), el('time', '', new Date(msg.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })));
      item.append(head, el('div', 'message-text', msg.text)); $('messages').append(item);
    }
    if (nearBottom) $('messages').scrollTop = $('messages').scrollHeight;
  }
  tick();
}
function tick() {
  const mine = state.players.find(p => p.id === me?.id);
  $('timer').textContent = mine ? time(elapsed(mine)) : '00:00:00';
  for (const node of document.querySelectorAll('[data-player-id]')) {
    const p = state.players.find(p => p.id === node.dataset.playerId); if (p) node.textContent = time(elapsed(p), false);
  }
}
$('join-dialog').addEventListener('cancel', e => e.preventDefault());
$('join-form').addEventListener('submit', async e => {
  e.preventDefault(); $('join-error').textContent = ''; $('join-button').disabled = true;
  try {
    const result = await post('join', { name: $('nickname').value, profileKey:profileKey() });
    me = { session: result.session, id: result.id }; accept(result.state); $('join-dialog').close(); $('leave').disabled = false; connect();
  } catch (error) { $('join-error').textContent = error.message || '연결되지 않았어요. 방장이 방을 열어두었는지 확인해주세요.'; }
  finally { $('join-button').disabled = false; }
});
$('focus').addEventListener('click', () => { const mine = state.players.find(p => p.id === me?.id); if (mine) act({ type: 'focus', focus: mine.focusSince === null }); });
$('seat-select').addEventListener('change', e => { if (e.target.value !== '') act({ type: 'seat', seat: Number(e.target.value) }); });
$('leave').addEventListener('click', async () => { await act({ type: 'leave' }); reset(); });
$('chat-form').addEventListener('submit', async e => { e.preventDefault(); const input = $('chat'), value = input.value.trim(); if (value && await act({ type: 'chat', text: value })) { if (input.value.trim() === value) input.value = ''; $('messages').scrollTop = $('messages').scrollHeight; } });
canvas.addEventListener('click', event => {
  if (!me) return;
  const box = canvas.getBoundingClientRect(), x = (event.clientX - box.left) * 820 / box.width, y = (event.clientY - box.top) * 520 / box.height;
  const seat = state.seats.findIndex(s => Math.abs(s.x - x) < 59 && y > s.y - 28 && y < s.y + 72);
  if (seat >= 0) act({ type: 'seat', seat });
  else act({ type: 'move', x: Math.round(Math.max(35, Math.min(785, x))), y: Math.round(Math.max(70, Math.min(485, y))) });
});
let lastMove = 0;
canvas.addEventListener('keydown', e => {
  const directions = { ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0], ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1] };
  const d = directions[e.key]; if (!d) return; e.preventDefault();
  const p = state.players.find(p => p.id === me?.id); if (!p || Date.now() - lastMove < 80) return; lastMove = Date.now();
  act({ type: 'move', x: Math.max(35, Math.min(785, p.x + d[0] * 15)), y: Math.max(70, Math.min(485, p.y + d[1] * 15)) });
});
function selectNetwork() {
  const url = $('network-select').value;
  $('share-url').value = url;
  if (url) $('qr').src = api + `qr?url=${encodeURIComponent(url)}`;
}
$('invite').addEventListener('click', () => $('invite-dialog').showModal());
$('close-invite').addEventListener('click', () => $('invite-dialog').close());
$('network-select').addEventListener('change', selectNetwork);
$('copy').addEventListener('click', async () => {
  const value = $('share-url').value; if (!value) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else { $('share-url').select(); if (!document.execCommand('copy')) throw Error(); }
    toast('초대 주소를 복사했어요. 친구에게 보내주세요.');
  } catch { $('share-url').select(); toast('주소를 선택했어요. 길게 누르거나 Ctrl+C로 복사해주세요.'); }
});
async function ping() {
  if (!me || Date.now() - lastPing < 8000) return; lastPing = Date.now();
  try { await post('action', { session: me.session, type: 'ping' }); }
  catch (e) { if (e.status === 401) { reset(); toast('한동안 연결이 없어 퇴장했어요. 다시 들어와주세요.'); } else connection('연결 확인 중…', 'offline'); }
}
setInterval(() => { tick(); ping(); }, 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { lastPing = 0; ping(); } });
window.addEventListener('pagehide', () => { if (me) navigator.sendBeacon(api + 'action', new Blob([JSON.stringify({ session: me.session, type: 'leave' })], { type: 'application/json' })); });
window.addEventListener('pageshow', e => { if (e.persisted) reset(); });

// The scene uses local vector drawing so the experiment also works without internet.
function rounded(x, y, w, h, r, fill, stroke) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } }
function label(text, x, y, size = 12, color = '#64735a', align = 'center') { ctx.font = `${size}px 'Malgun Gothic',sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(text, x, y); }
function plant(x, y) {
  ctx.fillStyle = '#c0a58a'; ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y); ctx.lineTo(x + 8, y + 21); ctx.lineTo(x - 8, y + 21); ctx.fill();
  for (const [dx, dy, a] of [[-9,-16,-.7],[8,-21,.7],[0,-30,0]]) { ctx.save(); ctx.translate(x + dx, y + dy); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0,0,6,16,0,0,Math.PI*2); ctx.fillStyle = dx < 0 ? '#71996d' : '#8cad78'; ctx.fill(); ctx.restore(); }
}
function draw() {
  ctx.clearRect(0, 0, 820, 520);
  ctx.fillStyle = '#e9eedf'; ctx.fillRect(0,0,820,520);
  rounded(26,24,768,470,16,'#f3efdf','#d8dccb');
  ctx.save();ctx.beginPath();ctx.rect(28,72,764,420);ctx.clip();
  ctx.strokeStyle = '#e7e4d3';ctx.lineWidth=1;
  for(let y=78;y<510;y+=42){ctx.beginPath();ctx.moveTo(26,y);ctx.lineTo(794,y);ctx.stroke();for(let x=(y%84?0:42);x<820;x+=84){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+42);ctx.stroke();}}
  ctx.restore();
  rounded(26,24,768,51,12,'#dce5ce'); rounded(26,59,768,16,0,'#dce5ce');
  rounded(294,23,230,40,6,'#bfd1af','#acc09b'); label('조용히, 같이 자라는 시간',409,48,12,'#506a44');
  // Window, bookshelf, greenery and a small shared rug.
  rounded(66,30,105,31,5,'#f5f6df','#aabc9b');ctx.strokeStyle='#b2c4a0';ctx.beginPath();ctx.moveTo(118,31);ctx.lineTo(118,60);ctx.stroke();
  rounded(663,29,88,34,4,'#a89071');
  ['#97b29b','#d9cb9b','#c7a082','#8caa9b','#d3bd9c','#b3bf96'].forEach((c,i)=>rounded(669+i*12,33,8,25-(i%2)*5,1,c));
  rounded(287,421,246,61,26,'#e2e6ce');label('잠깐의 쉼도 공부의 일부',410,455,10,'#88966f');
  plant(61,111);plant(761,111);plant(61,454);plant(761,454);
  const roomSeats = state.seats.length ? state.seats : [{x:170,y:160},{x:330,y:160},{x:490,y:160},{x:650,y:160},{x:170,y:320},{x:330,y:320},{x:490,y:320},{x:650,y:320}];
  roomSeats.forEach((s,i)=>{
    const p=state.players.find(p=>p.seat===i);
    rounded(s.x-45,s.y+12,90,13,5,'#c9b899');
    rounded(s.x-51,s.y-26,102,56,8,p?'#d5c2a2':'#e0cfb0','#c4b28e');
    rounded(s.x-16,s.y-13,33,23,3,'#fffdf2','#d5cdb6');ctx.strokeStyle='#d8d8c0';ctx.beginPath();ctx.moveTo(s.x,s.y-10);ctx.lineTo(s.x,s.y+7);ctx.stroke();
    rounded(s.x+29,s.y-15,9,12,3,'#a2b38e');
    rounded(s.x-21,s.y+40,42,26,9,p?'#9bb091':'#bbc8a7','#a5b696');
    if(!p)label(`${i+1}`,s.x,s.y+58,11,'#6e8260');
    if(p?.focusSince!=null){rounded(s.x-28,s.y-48,56,18,9,'#315c45');label('집중 중',s.x,s.y-35,9,'#fff');}
  });
  const active=new Set(state.players.map(p=>p.id));for(const id of positions.keys())if(!active.has(id))positions.delete(id);
  for(const p of [...state.players].sort((a,b)=>a.y-b.y)){
    let pos=positions.get(p.id);if(!pos){pos={x:p.x,y:p.y};positions.set(p.id,pos);}
    pos.x=reduceMotion?p.x:pos.x+(p.x-pos.x)*.22;pos.y=reduceMotion?p.y:pos.y+(p.y-pos.y)*.22;
    const x=pos.x,y=pos.y;
    ctx.fillStyle='#52604020';ctx.beginPath();ctx.ellipse(x,y+10,15,5,0,0,Math.PI*2);ctx.fill();
    rounded(x-12,y-5,24,22,8,p.color,'#637b5933');
    ctx.fillStyle='#f2d6b3';ctx.beginPath();ctx.arc(x,y-14,12,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#4e5544';ctx.beginPath();ctx.ellipse(x,y-20,12,7,0,Math.PI,Math.PI*2);ctx.fill();
    ctx.fillStyle='#414b3b';ctx.fillRect(x-5,y-14,2,3);ctx.fillRect(x+4,y-14,2,3);
    ctx.font="10px 'Malgun Gothic',sans-serif";const text=p.name+(p.id===me?.id?' · 나':'');const w=Math.max(40,ctx.measureText(text).width+16);
    rounded(x-w/2,y+23,w,20,7,p.id===me?.id?'#315c45':'#fffdf5e8');label(text,x,y+37,10,p.id===me?.id?'#fff':'#536548');
  }
  requestAnimationFrame(draw);
}
async function init() {
  $('join-dialog').showModal();
  try {
    const res = await fetch(api + 'info'); if (!res.ok) throw Error();
    const info = await res.json(); urls = info.urls;
    urls.sort((a,b) => Number(!/wi-fi|wlan|무선/i.test(a.name))-Number(!/wi-fi|wlan|무선/i.test(b.name)));
    for (const item of urls) { const option = el('option', '', `${item.name} · ${item.address}`); option.value=item.url; $('network-select').append(option); }
    if (!urls.length) { $('share-url').value='와이파이에 연결한 뒤 새로고침해주세요.'; $('copy').disabled=true; }
    else selectNetwork();
  } catch { $('join-error').textContent='방장이 방을 열어두었는지 확인해주세요.'; }
  draw();
}
init();
