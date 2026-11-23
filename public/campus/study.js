import { saved } from './network.js';
import { clock, pendingTime, dayWindow } from './study-time.js';
const $=id=>document.getElementById(id),node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
export class StudyUI {
  constructor({room,open,toast,onFocus,onChange,onSummary,localTotals,localRecords}){
    Object.assign(this,{room,open,toast,onFocus,onChange,onSummary,localTotals,localRecords});this.data=null;this.offset=0;this.focused=false;this.busy=false;this.refreshing=false;this.refreshAgain=false;this.version=0;this.rankVersion=0;this.scope='today';this.roomStudyKey='';this.friendsKey='';this.tab='timer';this.pendingKey='knu-study-stop';
    const subjectInput=$('study-new-subject'),subjectForm=$('study-add-subject');
    const syncSubjectAdd=()=>{subjectForm.querySelector('button').disabled=subjectInput.value.trim().length<2;};
    subjectInput.addEventListener('input',syncSubjectAdd);
    $('study-add-subject').addEventListener('submit',event=>{
      event.preventDefault();
      const input=$('study-new-subject'),name=input.value.trim();
      if(name.length<2)return;
      if(this.subjects.some(subject=>subject.name===name)){
        $('study-plan-status').textContent='이미 추가한 과목이에요.';
        return;
      }
      if(!this.saveSubjects([...this.subjects,{name,todos:[]}]))return;
      input.value='';
      syncSubjectAdd();
      const disclosure=input.closest('details');
      disclosure.open=false;
      disclosure.querySelector('summary').focus();
      this.renderSubjects();
    });
    $('study-check-form').addEventListener('submit',e=>{e.preventDefault();void this.confirm(false);});
    $('check-stop').addEventListener('click',()=>void this.confirm(true));
    for(const id of ['study-check','focus-check','map-study-status'])$(id).addEventListener('click',()=>this.openCheck());
    $('study-focus-button').addEventListener('click',()=>{this.setFocus(true);$('study-dialog').close();});
    $('focus-map').addEventListener('click',()=>this.setFocus(false));
    const tabs=[...document.querySelectorAll('[data-study-tab]')];
    tabs.forEach((button,index)=>{
      button.addEventListener('click',()=>this.setTab(button.dataset.studyTab));
      button.addEventListener('keydown',event=>{
        const destination={ArrowLeft:1-index,ArrowRight:1-index,Home:0,End:tabs.length-1}[event.key];
        if(destination===undefined)return;
        event.preventDefault();
        this.setTab(tabs[destination].dataset.studyTab);
        tabs[destination].focus();
      });
    });
    document.querySelectorAll('[data-rank-scope]').forEach(b=>b.addEventListener('click',()=>{this.scope=b.dataset.rankScope;void this.ranking();}));
    $('rank-refresh').addEventListener('click',()=>void this.ranking());
    this.tick=setInterval(()=>{if(!document.hidden)this.renderClock();},1000);
    setInterval(()=>{if(this.room.online&&($('study-dialog').open||this.focused))void this.refresh();},30000);
    window.addEventListener('online',()=>void this.refresh());
  }
  get subjectKey(){return 'knu-study-plan:'+this.room.profileKey;}
  get subjects(){
    try{
      const plan=JSON.parse(saved.get('localStorage',this.subjectKey)||'[]');
      return Array.isArray(plan)?plan:[];
    }catch{return [];}
  }
  saveSubjects(subjects){
    const serialized=JSON.stringify(subjects);
    saved.set('localStorage',this.subjectKey,serialized);
    if(saved.get('localStorage',this.subjectKey)===serialized){
      $('study-plan-status').textContent='';
      return true;
    }
    $('study-plan-status').textContent='이 브라우저에 과목을 저장하지 못했어요.';
    return false;
  }
  updateSubject(name,update){
    return this.saveSubjects(this.subjects.map(subject=>subject.name===name?update(subject):subject));
  }
  confirmDelete(message){
    const dialog=$('study-delete-dialog');
    $('study-delete-copy').textContent=message;
    dialog.returnValue='cancel';
    dialog.showModal();
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true});
    });
  }
  renderSubjects(){
    const list=$('study-subject-list');
    list.replaceChildren();
    for(const {name,todos} of this.subjects){
      const card=node('li','study-subject-card'),heading=node('div','study-subject-heading');
      const title=node('strong','',name),time=node('span','subject-time','00:00:00');
      time.dataset.subject=name;
      const play=node('button','subject-play');
      const icon=node('span','subject-play-icon');
      icon.setAttribute('aria-hidden','true');
      play.append(icon);
      play.type='button';
      play.setAttribute('aria-label',name+' 공부 시작');
      play.onclick=()=>void this.start({
        subject:name,goal:todos.find(todo=>!todo.done&&todo.text.length>=2)?.text||name+' 공부'
      });
      const removeSubject=node('button','subject-remove','×');
      removeSubject.type='button';
      removeSubject.setAttribute('aria-label',name+' 과목 삭제');
      removeSubject.onclick=async()=>{
        if(!await this.confirmDelete(`${name} 과목과 그 과목에 등록한 할 일이 삭제됩니다.`))return;
        if(!this.saveSubjects(this.subjects.filter(subject=>subject.name!==name)))return;
        this.renderSubjects();
        $('study-add-subject').closest('details').querySelector('summary').focus();
      };
      heading.append(play,title,time,removeSubject);
      card.append(heading);
      for(const [index,todo] of todos.entries()){
        const row=node('div','subject-todo-row'),label=node('label','subject-todo'),box=node('input','');
        box.type='checkbox';
        box.checked=todo.done;
        box.onchange=()=>{
          if(!this.updateSubject(name,subject=>({...subject,todos:subject.todos.map((item,i)=>i===index?{...item,done:box.checked}:item)})))
            box.checked=!box.checked;
        };
        label.append(box,node('span','',todo.text));
        const remove=node('button','subject-remove','×');
        remove.type='button';
        remove.setAttribute('aria-label',name+' '+todo.text+' 할 일 삭제');
        remove.onclick=async()=>{
          if(!await this.confirmDelete(`할 일 ‘${todo.text}’이 삭제됩니다.`))return;
          if(!this.updateSubject(name,subject=>({...subject,todos:subject.todos.filter((_,i)=>i!==index)})))return;
          this.renderSubjects();
          document.getElementById(addId)?.focus();
        };
        row.append(label,remove);
        card.append(row);
      }
      const disclosure=node('details','study-plan-add subject-todo-add');
      disclosure.name='study-plan-editor';
      const addId='todo-add-'+list.children.length;
      const summary=node('summary','','할 일 +');
      summary.id=addId;
      disclosure.append(summary);
      const form=node('form','study-plan-form subject-todo-form'),input=node('input',''),add=node('button','subject-save','↵');
      input.type='text';input.maxLength=120;input.placeholder='할 일 입력';
      add.type='submit';
      add.setAttribute('aria-label','할 일 저장');
      const marker=node('span','todo-draft-marker');
      marker.setAttribute('aria-hidden','true');
      disclosure.addEventListener('toggle',()=>{if(disclosure.open)input.focus();});
      add.disabled=true;
      input.oninput=()=>{add.disabled=!input.value.trim();};
      input.setAttribute('aria-label',name+' 할 일');
      form.onsubmit=event=>{
        event.preventDefault();
        const text=input.value.trim();
        if(!text||!this.updateSubject(name,subject=>({...subject,todos:[...subject.todos,{text,done:false}]})))return;
        this.renderSubjects();
        document.getElementById(addId)?.focus();
      };
      form.append(marker,input,add);
      disclosure.append(form);
      card.append(disclosure);
      list.append(card);
    }
    this.renderSubjectTimes();
  }
  renderSubjectTimes(){
    const window=dayWindow(Date.now()+this.offset), totals=new Map();
    const records=(this.localRecords?.()??[]).filter(r=>r.fromAt<window.end&&r.toAt>window.start)
      .sort((a,b)=>a.fromAt-b.fromAt);
    const counted=new Map();
    for(const record of records){
      const from=Math.max(window.start,record.fromAt,counted.get(record.subject)??0);
      const to=Math.min(window.end,record.toAt);
      if(to<=from)continue;
      counted.set(record.subject,to);
      totals.set(record.subject,(totals.get(record.subject)??0)+to-from);
    }
    for(const time of document.querySelectorAll('.subject-time'))time.textContent=clock(totals.get(time.dataset.subject)??0);
    for(const button of document.querySelectorAll('.subject-play'))button.disabled=this.busy||!this.room.online||!!this.active;
  }
  get active(){return this.data?.active||null;}
  accept(data){
    this.data=data;this.offset=data.at-Date.now();$('study-active').hidden=!data.active;
    this.onSummary?.(data);this.renderTotals();
    if(data.active){$('study-current-subject').textContent=data.active.subject;$('study-current-goal').textContent=data.active.goal;$('focus-subject').textContent=data.active.subject;}
    else this.setFocus(false);
    this.onChange(!!data.active);this.renderClock();
    if(data.active&&saved.get('localStorage','knu-focus-view')==='1')this.setFocus(true);
  }
  renderTotals(){const data=this.localTotals?.()||this.data;if(data){$('study-today').textContent=clock(data.todayMs);$('study-week').textContent=clock(data.weekMs);}}
  async refresh(){
    if(!this.room.me)return false;
    if(this.refreshing||this.busy){this.refreshAgain=true;return false;}
    this.refreshing=true;this.refreshAgain=false;const version=++this.version;
    try{
      let result=await this.room.service('/api/study/me');let pending;const pendingRaw=saved.get('localStorage',this.pendingKey);
      if(version!==this.version)return false;
      const clearPending=()=>{if(saved.get('localStorage',this.pendingKey)===pendingRaw)saved.remove('localStorage',this.pendingKey);};
      try{pending=JSON.parse(pendingRaw||'null');}catch{clearPending();}
      if(pending){
        if(pending.profileId!==result.study.profile.id)clearPending();
        else try{result=await this.room.service('/api/study/confirm',pending.payload);clearPending();if(version===this.version)this.toast('보류한 공부 기록을 확인했어요');}
        catch(error){if([404,409].includes(error.status)){clearPending();if(version===this.version)this.toast('이미 다른 화면에서 바뀐 기록이에요');}else throw error;}
      }
      if(version===this.version){this.accept(result.study);$('study-error').textContent='';return true;}
      return false;
    }catch(error){if(version===this.version)$('study-error').textContent=error.message;return false;}
    finally{this.refreshing=false;if(this.refreshAgain&&!this.busy)void this.refresh();}
  }
  acceptRoom(snapshot){
    const mine=snapshot.players.find(p=>p.id===this.room.me?.id),key=JSON.stringify(mine?.study||null);
    if(mine&&key!==this.roomStudyKey){this.roomStudyKey=key;void this.refresh();}
    const friends=snapshot.players.filter(p=>p.study),friendsKey=JSON.stringify(friends.map(p=>[p.id,p.name,p.study.subject]));
    if(friendsKey===this.friendsKey)return;this.friendsKey=friendsKey;
    const list=$('focus-friends');list.replaceChildren();
    for(const p of friends.slice(0,6))list.append(node('span','focus-friend',p.name+' · '+p.study.subject));
    $('focus-count').textContent=String(friends.length);
  }
  renderClock(){
    const active=this.active,pending=saved.get('localStorage',this.pendingKey),at=Date.now()+this.offset;
    let value=active?pendingTime(active,at):0;
    if(pending&&active){try{const q=JSON.parse(pending);if(q.payload.sessionId===active.id)value=pendingTime(active,q.payload.stopAt);}catch{}}
    const label=clock(value);for(const id of ['study-clock','focus-clock'])if($(id).textContent!==label)$(id).textContent=label;
    const awaiting=active&&at>=active.deadlineAt;
    $('study-phase').textContent=pending?'종료 기록 전송 대기':awaiting?'90분 확인 대기':active?'집중 중':'공부 준비';
    $('focus-phase').textContent=pending?'연결되면 종료 기록을 반영해요':awaiting?'공부 내용을 확인해주세요':'확인한 시간만 순위에 반영돼요';
    $('study-check').textContent=awaiting?'90분 기록 확인':'기록 확인';
    $('map-study-status').hidden=!active;$('map-study-status').textContent=awaiting?'90분 확인 대기 · 기록 확인':'공부 중 · 기록 확인';
    for(const button of document.querySelectorAll('.subject-play'))button.disabled=this.busy||!this.room.online||!!active;
    $('check-continue').disabled=this.busy||!!pending||!this.room.online;$('check-stop').disabled=this.busy||!!pending;
  }
  setFocus(value){value=!!value&&!!this.active;if(this.focused===value)return;this.focused=value;saved.set('localStorage','knu-focus-view',value?'1':'0');$('study-focus').hidden=!value;$('viewport').hidden=value;this.onFocus(value);}
  setTab(tab){
    this.tab=tab;
    $('study-timer-panel').hidden=tab!=='timer';
    $('study-rank-panel').hidden=tab!=='rank';
    document.querySelectorAll('[data-study-tab]').forEach(button=>{
      const selected=button.dataset.studyTab===tab;
      button.setAttribute('aria-selected',String(selected));
      button.tabIndex=selected?0:-1;
    });
    if(tab==='rank')void this.ranking();
    else{this.renderSubjects();void this.refresh();}
  }
  async start(preset){
    if(this.busy||!this.room.online||this.active)return;this.busy=true;this.version++;this.renderClock();$('study-error').textContent='';
    try{const r=await this.room.service('/api/study/start',preset);this.accept(r.study);this.setFocus(true);$('study-dialog').close();}
    catch(error){$('study-error').textContent=error.message;}finally{this.busy=false;this.renderClock();if(this.refreshAgain)void this.refresh();}
  }
  openCheck(){if(!this.active)return;if(saved.get('localStorage',this.pendingKey)){this.toast('연결되면 종료 기록을 반영해요');return;}this.checkActive={...this.active};this.open('check-dialog');$('check-note').value='';$('check-error').textContent='';$('check-duration').textContent=clock(pendingTime(this.active,Date.now()+this.offset));$('check-note').focus();}
  async confirm(stop){
    if(this.busy||!this.checkActive)return;const note=$('check-note').value.trim();if(note.length<2){$('check-error').textContent='공부한 내용을 두 글자 이상 적어주세요';return;}
    const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    const payload={sessionId:this.checkActive.id,segmentStartAt:this.checkActive.segmentStartAt,requestId,note,stop,stopAt:Date.now()+this.offset};
    this.busy=true;this.version++;this.renderClock();$('check-error').textContent='';
    try{
      const r=await this.room.service('/api/study/confirm',payload);this.accept(r.study);$('check-dialog').close();this.toast(stop?'공부 기록을 확인하고 쉬어요':'확인 완료! 다음 90분을 시작해요');
    }catch(error){
      if(!error.status&&stop){saved.set('localStorage',this.pendingKey,JSON.stringify({profileId:this.data.profile.id,payload}));$('check-dialog').close();this.setFocus(false);this.toast('종료 시각을 저장했어요. 연결되면 반영해요');}
      else{$('check-error').textContent=error.message;if(error.code==='STUDY_CHANGED')void this.refresh();}
    }finally{this.busy=false;this.renderClock();if(this.refreshAgain)void this.refresh();}
  }
  async ranking(){
    const version=++this.rankVersion,scope=this.scope;
    $('rank-error').textContent='';$('rank-refresh').disabled=true;document.querySelectorAll('[data-rank-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rankScope===this.scope)));
    try{const r=await this.room.service('/api/study/ranking',{scope});if(version!==this.rankVersion)return;const list=$('rank-list');list.replaceChildren();
      if(!r.rows.length)list.append(node('p','subtle','확인된 공부 기록이 아직 없어요'));
      for(const p of r.rows){const row=node('li',p.id===this.data?.profile.id?'rank-row mine':'rank-row');row.append(node('span','rank-place',String(p.rank)),node('span','rank-name',p.name),node('strong','',clock(p.ms)));list.append(row);}
      $('my-rank').textContent=r.mine?`내 순위 ${r.mine.rank}위 · ${clock(r.mine.ms)}`:'공부 내용을 확인하면 순위에 올라가요';
    }catch(error){if(version===this.rankVersion)$('rank-error').textContent=error.message;}finally{if(version===this.rankVersion)$('rank-refresh').disabled=false;}
  }
}
