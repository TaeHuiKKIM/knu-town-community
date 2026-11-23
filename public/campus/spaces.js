import {socialTopics} from './social-topics.js';

const $=id=>document.getElementById(id);
const roomLabels={free:'친구',study:'공부',social:'과팅'};
export class SpacesUI {
  constructor({room,art,toast,onHallVisibility}){this.art=art;this.onHallVisibility=onHallVisibility;this.room=room;this.toast=toast;this.busy=false;this.current=null;this.attachHall();this.attachSocialQuestions();$('space-create-form').addEventListener('submit',e=>{e.preventDefault();void this.create();});}

  attachSocialQuestions(){
    const choices=$('social-question'),send=$('social-send');
    for(const text of socialTopics)choices.add(new Option(text,text));
    send.onclick=async()=>{
      if(this.current?.mode!=='social'||send.disabled)return;
      send.disabled=true;
      try{
        await this.room.send({type:'chat',text:choices.value});
        $('social-topics').open=false;
      }catch(error){if(!error.stale)this.toast(error.message);}
      finally{send.disabled=false;}
    };
  }

  attachHall(){
    const panel=document.createElement('dialog');
    panel.className='reading-panel';
    panel.setAttribute('aria-label','중앙도서관 열람실');
    panel.innerHTML='<div class="dialog-head"><h2>중앙도서관 열람실</h2><button class="close" aria-label="닫기">×</button></div><div class="dialog-body"><p class="reading-status" role="status"></p><div class="reading-seats"></div><button type="button" class="primary full">공부</button></div>';
    document.body.append(panel);
    const entry=document.createElement('button');
    entry.className='menu-action';entry.type='button';entry.textContent='열람실 좌석';entry.hidden=true;
    $('room-dialog').querySelector('.menu-grid').prepend(entry);
    entry.onclick=()=>{$('room-dialog').close();this.openHall();};
    panel.addEventListener('close',()=>this.onHallVisibility());
    panel.querySelector('.close').onclick=()=>panel.close();
    panel.querySelector('.primary').onclick=()=>{panel.close();document.querySelector('[data-open="study-dialog"]').click();};
    this.hallPanel=panel;this.hallEntry=entry;
    const grid=panel.querySelector('.reading-seats');
    this.desks=Array.from({length:64},(_,index)=>{
      const button=document.createElement('button');button.type='button';
      const art=document.createElement('img');art.loading='lazy';art.src='/campus/assets/icons/library-desk.png';art.alt='';
      const label=document.createElement('span');const student=document.createElement("canvas");student.width=96;student.height=128;student.hidden=true;button.append(art,student,label);grid.append(button);
      button.onclick=async()=>{
        if(this.deskBusy)return;
        this.deskBusy=true;
        try{await this.room.send({type:'reading-desk',desk:button.dataset.mine==='true'?null:index+1});}
        catch(error){this.toast(error.message);}
        finally{this.deskBusy=false;}
      };
      return {button,label,student};
    });
    this.room.addEventListener('state',event=>this.renderHall(event.detail));
    this.room.addEventListener('joinrequired',()=>{panel.close();this.inHall=false;entry.hidden=true;});
  }
  openHall(){this.hallPanel.showModal();this.onHallVisibility();}
  renderHall(snapshot){
    const inHall=snapshot.room?.code==='reading-hall';
    this.hallEntry.hidden=!inHall;
    if(!inHall){this.hallPanel.close();this.inHall=false;return;}
    const occupants=new Map(snapshot.players.filter(p=>p.desk!=null).map(p=>[p.desk,p]));
    const mine=snapshot.players.find(p=>p.id===this.room.me?.id);
    const signature=JSON.stringify([...occupants].map(([desk,p])=>[desk,p.id,p.name,p.avatar,p.coat,p.style,!!p.study]))+String(mine?.id)+String(!!mine?.study);
    if(this.hallSignature!==signature||!this.inHall){
      this.hallSignature=signature;
      this.hallPanel.querySelector('.reading-status').textContent='빈자리 '+(64-occupants.size)+' / 64'+(mine?.desk?' · 내 자리 '+mine.desk+'번':'');
      this.desks.forEach(({button,label,student},index)=>{
        const person=occupants.get(index+1),isMine=!!person&&person.id===mine?.id;
        student.hidden=!person;
        if(person){
          const paint=()=>this.art.paint(student,{avatar:person.avatar,coat:person.coat,style:person.style,studying:true});
          student.dataset.person=person.id;
          paint();
          if(person.style&&!this.art.hasStyle(person.style))this.art.loadStyle(person.style).then(()=>{if(student.dataset.person===person.id)paint();}).catch(()=>{});
        }else delete student.dataset.person;
        label.textContent=person?person.name+(person.study?' · 공부 중':''):(index+1)+'번';
        button.dataset.mine=String(isMine);button.disabled=!!mine?.study||!!person&&!isMine;
        button.setAttribute('aria-label',(index+1)+'번 '+(isMine?'내 자리 비우기':person?label.textContent:'빈자리 앉기'));
      });
    }
    if(!this.inHall&&mine){
      this.inHall=true;
      setTimeout(()=>{if(this.inHall&&!this.hallPanel.open&&!document.querySelector('dialog[open]'))this.openHall();},0);
    }
  }
  accept(info){if(!info)return;this.current=info;$('place-name').textContent=info.name;$('join-title').textContent=info.isMain?'일청담에서 만나':info.mode==='social'?'과팅 · '+info.name:info.name;$('space-current').textContent=info.name;$('social-topics').hidden=info.mode!=='social';}
  async info(){try{const r=await fetch(this.room.api+'info');if(r.ok)this.accept((await r.json()).room);}catch{}}
  async load(){
    $('spaces-error').textContent='';
    try{const r=await this.room.service('/api/hub/rooms/list'),list=$('spaces-list');list.replaceChildren();
      for(const space of r.rooms){const b=document.createElement('button');b.className='space-card';const title=document.createElement('strong'),detail=document.createElement('span');title.textContent=space.name;detail.textContent=`${space.isMain?'메인':roomLabels[space.mode]||'친구'} · ${space.online}/${space.capacity}명${space.code===this.current?.code?' · 현재':''}`;b.append(title,detail);b.disabled=space.code===this.current?.code;b.addEventListener('click',()=>void this.go(space.code));list.append(b);}
    }catch(error){$('spaces-error').textContent=error.message;}
  }
  async go(code){if(this.busy)return;this.busy=true;$('spaces-error').textContent='';try{await this.room.transfer(code);}catch(error){$('spaces-error').textContent=error.message;}finally{this.busy=false;}}
  async create(){if(this.busy)return;this.busy=true;$('space-create').disabled=true;$('spaces-error').textContent='';
    try{const r=await this.room.service('/api/hub/rooms/create',{name:$('space-name').value.trim(),mode:$('space-mode').value,capacity:16});this.busy=false;await this.go(r.room.code);}
    catch(error){$('spaces-error').textContent=error.message;}finally{this.busy=false;$('space-create').disabled=false;}
  }
}
