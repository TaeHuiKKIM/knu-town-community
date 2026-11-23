import {createMeetupLink,readMeetupLink,publicPlaza,meetupKinds} from './meetup-link.js';
import {socialTopics} from '../public/campus/social-topics.js';

const prompts={
  department:['우리 과에서 같이 해 보고 싶은 활동은?','이번 학기에 가장 기대되는 수업은?'],
  club:['이번 모임에서 같이 해 보고 싶은 일은?','요즘 관심 있는 취미는?'],
  study:['오늘 한 가지 마치고 싶은 공부는?','이번에 함께 풀어 보고 싶은 문제는?'],
  social:socialTopics
};
const memoryKey=code=>'knu-meetup-agreement:'+code;
function remember(code,value) {
  try {if(value)sessionStorage.setItem(memoryKey(code),value);else sessionStorage.removeItem(memoryKey(code));}catch { /* Storage may be disabled. */ }
}
function agreement(code){try{return sessionStorage.getItem(memoryKey(code));}catch{return null;}}

export function campusMeetups({panel,add,invite,dialog,start,stop,connected,postChat,share}) {
  let current=null,awaiting=false;
  function field(body,text,type,limit) {
    const label=add(body,'label',text);
    label.className='meetup-field';
    const input=add(label,type,'');
    if(limit)input.maxLength=limit;
    return input;
  }
  function button(parent,text,click){
    const b=add(parent,'button',text);b.type='button';b.onclick=click;return b;
  }
  function form() {
    const body=panel('meetup-create','모임 만들기');
    const form=add(body,'form','');form.className='meetup-form';
    const kind=field(form,'모임 종류','select');
    for(const [value,name] of meetupKinds){const option=add(kind,'option',name);option.value=value;}
    const title=field(form,'모임 이름','input',36);title.required=true;title.placeholder='예: 자료구조 같이 공부해요';
    kind.onchange=()=>{title.placeholder=kind.value==='social'?'예: 공강에 만나는 두 학과':'예: 자료구조 같이 공부해요';};
    const group=field(form,'학교·학과·동아리 별칭 (선택)','input',30);group.placeholder='예: 캠퍼스 독서회';
    add(form,'p','링크를 받은 사람이 모임 정보를 보고 참여를 선택해요. 최대 4명까지 함께할 수 있어요.').className='muted';
    const error=add(form,'p','');error.setAttribute('role','status');
    const create=add(form,'button','모임 만들고 입장');create.type='submit';
    form.onsubmit=async e=>{
      e.preventDefault();if(create.disabled)return;create.disabled=true;
      try {
        const url=await createMeetupLink(location.href,{kind:kind.value,title:title.value,group:group.value});
        remember(url.searchParams.get('room'),'created');location.assign(url.href);
      } catch(problem){error.textContent=problem.message;create.disabled=false;}
    };
  }
  function details(body) {
    const {kind,title,group}=current.details;
    add(body,'p',meetupKinds.get(kind)+(group?' · '+group:'')).className='meetup-kind';
    add(body,'h3',title).className='meetup-title';
  }
  function returnToPlaza() {
    awaiting=false;
    if(current)remember(current.code,false);
    stop();
    location.replace(publicPlaza(location.href).href);
  }
  function enter() {
    awaiting=false;remember(current.code,'yes');
    dialog.close();
    invite.textContent='모임';invite.setAttribute('aria-label','모임 정보와 초대');
    invite.title=current.details.title;document.title=current.details.title+' · 크누타운';
    start();
  }
  async function initialize() {
    awaiting=true;
    try {
      current=await readMeetupLink(location.href);
      if(!current)throw Error('모임 초대 링크를 확인해 주세요.');
      const previous=agreement(current.code);
      if(previous==='yes'||previous==='created'){enter();if(previous==='created')openRoom();return;}
      const body=panel('meetup-preview','모임 초대');
      details(body);
      add(body,'p','참여하면 닉네임·캐릭터·공부 상태가 같은 방에 보여요. 공부 달력을 공유 중이면 기존 공유 설정도 적용돼요.').className='muted';
      button(body,'모임 참여',enter);
      button(body,'참여하지 않고 광장으로',returnToPlaza);
    } catch(error){
      const body=panel('meetup-invalid','초대 확인');
      add(body,'p',error.message);
      button(body,'광장으로',returnToPlaza);
    }
  }

  dialog.addEventListener('close',()=>{if(awaiting)returnToPlaza();});

  function activities(body) {
    const group=add(body,'section','');group.className='meetup-activities';
    add(group,'h3','모임에서 한마디');
    const greeting=field(group,'한 줄 소개 (선택)','input',100);
    greeting.placeholder='예: 다른 학교에서 왔어요. 반가워요!';
    const notice=add(group,'p','');notice.setAttribute('role','status');
    const send=text=>{
      if(!connected()){notice.textContent='모임 연결을 기다려 주세요.';return false;}
      postChat(text);notice.textContent='모임 채팅에 보냈어요.';return true;
    };
    button(group,'소개 보내기',()=>{
      const text=greeting.value.trim();
      if(!text){greeting.focus();return;}
      if(send(text))greeting.value='';
    });
    const choices=field(group,'대화 주제','select');
    for(const question of prompts[current.details.kind])add(choices,'option',question);
    button(group,'질문을 채팅에 보내기',()=>send(choices.value));
  }
  function openRoom() {
    const body=panel("meetup","모임 정보");
    details(body);
    button(body,"모임 초대 링크·QR",share);
    activities(body);
    button(body,'모임 나가기',returnToPlaza);
  }

  return {initialize,form,openRoom,get current(){return current;}};
}
