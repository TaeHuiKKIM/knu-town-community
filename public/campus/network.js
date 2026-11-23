export function latestSender(send, onError = () => {}) {
  let pending = null, busy = false;
  const waiting = [];
  async function flush() {
    if (busy) return;
    busy = true;
    try {
      while (pending) {
        const value = pending; pending = null;
        try { await send(value); } catch (error) { onError(error); }
      }
    } finally {
      busy = false;
      for (const resolve of waiting.splice(0)) resolve();
    }
  }
  return {
    push(value) { pending = value; void flush(); },
    clear() { pending = null; },
    whenIdle() { return busy ? new Promise(resolve => waiting.push(resolve)) : Promise.resolve(); }
  };
}

export const saved = {
  get(store, key) { try { return globalThis[store].getItem(key); } catch { return null; } },
  set(store, key, value) { try { globalThis[store].setItem(key, value); } catch { /* Storage is optional, including in private Safari. */ } },
  remove(store, key) { try { globalThis[store].removeItem(key); } catch { /* Nothing to clear. */ } },
};
export function profileKey(){let key=saved.get('localStorage','knu-profile-key');if(!/^[a-f0-9]{64}$/.test(key||'')){key=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');saved.set('localStorage','knu-profile-key',key);}return key;}

// The server sends a complete roster on subscribe and every membership change.
// Subsequent movement rows address that roster in the same ordered SSE stream.
export function applyMovement(previous, {at,moves}) {
  const players=previous.players.slice();
  for(const [index,x,y,facing,motion,age,crouch,focusedMs] of moves) {
    const player=players[index];
    players[index]={...player,seat:null,focusSince:null,focusedMs,campus:{
      ...player.campus,x,y,facing,motion,movedAt:at-age,crouch
    }};
  }
  return {...previous,at,players};
}

export class RoomConnection extends EventTarget {
  constructor(code,{key,generation}={}) {
    super(); this.api = `/api/${encodeURIComponent(code)}/`; this.key = `knu-session:${code}`;
    this.me = null; this.source = null; this.online = false; this.mode = 'waiting'; this.probing = false; this.pendingSession = null; this.restoring = false; this.joinKey = null; this.revision = 0;this.profileKey=key??profileKey();this.saveGeneration=Number.isSafeInteger(generation)&&generation>=0?generation:undefined;this.view='campus';this.transferring=false;
  }
  rememberProfile(key=this.key){saved.set('sessionStorage',key+':profile',this.profileKey);if(this.saveGeneration!==undefined)saved.set('sessionStorage',key+':save',String(this.saveGeneration));}
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  status(mode) { this.online = mode === 'online'; if(this.mode===mode)return; this.mode=mode; this.emit('status', mode); }
  async request(route, data) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(this.api + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || '연결을 확인해주세요.'), { status: response.status, code:result.code });
      return result;
    } catch (error) {
      if (error.status) throw error;
      throw new Error('방장과 연결되지 않았어요. 같은 Wi-Fi인지 확인해주세요.');
    } finally { clearTimeout(timer); }
  }
  accept(state) {
    if (this.me && !state.players.some(p => p.id === this.me.id)) { this.expire(); return; }
    this.emit('state', state);
  }
  connect() {
    if (!this.me || this.transferring || this.pendingTransfer()) return;
    this.source?.close(); this.status('connecting');
    const source = new EventSource(this.api + `events?session=${encodeURIComponent(this.me.session)}&view=${this.view}&moves=1`);
    this.source = source;
    let lastState;
    source.onmessage = event => {
      if (this.source !== source) return;
      try {
        const frame=JSON.parse(event.data);
        lastState=frame.moves ? applyMovement(lastState,frame) : frame;
        this.status('online'); this.accept(lastState);
      }
      catch { this.status('offline'); }
    };
    source.onerror = () => { if (this.source === source) { this.status('offline'); void this.probe(); } };
  }
  async join(name, coat, avatar = 'male', style = null) {
    const revision=this.revision;
    let joinKey=this.joinKey||saved.get('sessionStorage',this.key+':join');
    if(!joinKey) { joinKey=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''); saved.set('sessionStorage',this.key+':join',joinKey); }
    this.joinKey=joinKey;
    // Bind the pending join before the host can accept it, even if the response is lost.
    this.rememberProfile();
    const result = await this.request('join', { name, coat, avatar, ...(style ? { style } : {}), joinKey,profileKey:this.profileKey });
    if(this.revision!==revision)throw Object.assign(Error('이전 입장 요청이에요'),{stale:true});
    this.revision++;
    this.me = { id: result.id, session: result.session };
    saved.set('sessionStorage', this.key, result.session);
    saved.remove('sessionStorage',this.key+':join');
    this.joinKey=null;
    this.accept(result.state); this.connect();
  }
  async resume() {
    if (this.restoring || this.me) return;
    const sessionSave=saved.get('sessionStorage',this.key+':save');
    if(this.saveGeneration!==undefined&&(sessionSave!==null?sessionSave!==String(this.saveGeneration):this.saveGeneration>0)){this.expire();return;}
    const sessionProfile=saved.get('sessionStorage',this.key+':profile');
    if(/^[a-f0-9]{64}$/.test(sessionProfile||'')&&sessionProfile!==this.profileKey){this.expire();return;}
    const transfer=this.pendingTransfer();
    if(transfer){try{const result=await this.request('action',transfer);this.finishTransfer(result);return;}catch(error){if(!error.status){this.status('offline');this.emit('resumeerror',error.message);this.pendingSession=saved.get('sessionStorage',this.key);return;}saved.remove('sessionStorage',this.key+':transfer');}}
    const session = this.pendingSession || saved.get('sessionStorage', this.key);
    if (!session) { this.emit('joinrequired'); return; }
    this.pendingSession = session; this.restoring = true; const revision=this.revision;
    this.status('connecting');
    try {
      const result = await this.request('resume', { session });
      if(this.revision!==revision)return;
      this.revision++;
      this.me = { id: result.id, session }; this.pendingSession = null;this.rememberProfile(); this.accept(result.state); this.connect();
    } catch (error) {
      if(this.revision!==revision)return;
      if (error.status === 401) this.expire();
      else { this.status('offline'); this.emit('resumeerror', error.message); }
    } finally { this.restoring = false; }
  }
  expire() {
    this.revision++;
    this.source?.close(); this.source = null; this.me = null; this.pendingSession = null;
    this.joinKey=null;
    saved.remove('sessionStorage', this.key); this.status('waiting'); this.emit('joinrequired');
    saved.remove('sessionStorage', this.key+':join');
    saved.remove('sessionStorage', this.key+':transfer');
    saved.remove('sessionStorage',this.key+':profile');saved.remove('sessionStorage',this.key+':save');
  }
  async send(data) {
    if (!this.me || !this.online) throw new Error('연결이 돌아오면 다시 시도해주세요.');
    const owner=this.me;
    try { const result=await this.request('action', { ...data, session: owner.session }); if(this.me!==owner)throw Object.assign(Error('이전 동작이에요'),{stale:true});return result; }
    catch (error) {
      if(this.me!==owner)throw Object.assign(error,{stale:true});
      if (error.status === 401) this.expire();
      else if (!error.status) this.status('offline');
      throw error;
    }
  }
  async probe() {
    if (this.probing || this.transferring) return;
    const transfer=this.pendingTransfer();
    if(transfer&&this.me){try{await this.transfer(transfer.targetCode);}catch{}return;}
    if (!this.me) { if (this.pendingSession || transfer) await this.resume(); return; }
    this.probing = true;
    const owner=this.me;
    try {
      await this.request('action', { session: owner.session, type: 'ping' });
      if(this.me!==owner)return;
      // SSE heartbeats are comments, so a recovered request alone produces no state event.
      // Reopen to get a fresh snapshot even when everyone in the room is standing still.
      if (!this.online && this.me) this.connect();
    }
    catch (error) { if(this.me!==owner)return; if (error.status === 401) this.expire(); else this.status('offline'); }
    finally { this.probing = false; }
  }
  async leave() {
    if (!this.me) return;
    const owner=this.me;
    try { await this.request('action', { session: owner.session, type: 'leave' }); }
    catch(error){if(this.me!==owner)error.stale=true;throw error;}
    finally { if(this.me===owner)this.expire(); }
  }
  setView(view){if(this.view===view)return;this.view=view;if(this.me)this.connect();}
  pendingTransfer(){const raw=saved.get('sessionStorage',this.key+':transfer');if(!raw)return null;try{const p=JSON.parse(raw);if(p.type!=='transfer'||typeof p.session!=='string'||typeof p.targetCode!=='string'||!/^[a-f0-9]{32}$/.test(p.transferKey))throw Error();return p;}catch{saved.remove('sessionStorage',this.key+':transfer');return null;}}
  finishTransfer(result){saved.set('sessionStorage',`knu-session:${result.code}`,result.session);this.rememberProfile(`knu-session:${result.code}`);saved.remove('sessionStorage',this.key+':profile');saved.remove('sessionStorage',this.key+':save');saved.remove('sessionStorage',this.key);saved.remove('sessionStorage',this.key+':transfer');this.source?.close();this.source=null;this.me=null;this.revision++;location.assign(`/r/${encodeURIComponent(result.code)}`);}
  async transfer(code){
    if(!this.me||this.transferring)return;
    // In-flight requests from the old room must lose ownership before it removes us.
    const owner=this.me={...this.me},existing=this.pendingTransfer();this.revision++;this.transferring=true;
    const payload=existing||{session:owner.session,type:'transfer',targetCode:code,transferKey:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')};
    saved.set('sessionStorage',this.key+':transfer',JSON.stringify(payload));this.source?.close();this.source=null;this.status('connecting');
    try{const result=await this.request('action',payload);if(this.me!==owner)return;this.finishTransfer(result);}
    catch(error){if(error.status)saved.remove('sessionStorage',this.key+':transfer');if(this.me===owner){this.transferring=false;if(error.status)this.connect();else this.status('offline');}throw error;}
    finally{this.transferring=false;}
  }
  async service(path,data={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
    try{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,profileKey:this.profileKey}),signal:controller.signal});const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'다시 시도해주세요.'),{status:response.status,code:result.code});return result;}
    catch(error){if(error.status)throw error;throw Error('연결을 확인한 뒤 다시 시도해주세요.');}finally{clearTimeout(timer);}
  }
}
