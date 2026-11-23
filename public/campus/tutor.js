// AI 튜터 창. 질문을 방장 서버(/api/tutor/ask)로 보내고, 방장 노트북의 로컬 모델이 만드는 답을 한 줄씩 받아 그린다.
// 대화는 이 화면 메모리에만 두고 저장하지 않는다. 최근 몇 턴만 함께 보내서 이어 묻기를 돕는다.
const $=id=>document.getElementById(id),node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const KEEP=6;

// 작은 모델이 자주 섞는 LaTeX 수식을 평범한 글자로 바꾼다. 예: \(O(n \log n)\) → O(n log n)
export function plainMath(text){
  return text.replace(/\\\(|\\\)|\\\[|\\\]/g,'')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g,'($1) / ($2)').replace(/\\text\{([^{}]*)\}/g,'$1')
    .replace(/\\left|\\right/g,'').replace(/\\lfloor/g,'⌊').replace(/\\rfloor/g,'⌋').replace(/\\lceil/g,'⌈').replace(/\\rceil/g,'⌉')
    .replace(/\\times/g,'×').replace(/\\cdot/g,'·').replace(/\\leq?/g,'≤').replace(/\\geq?/g,'≥').replace(/\\neq/g,'≠').replace(/\\to|\\rightarrow/g,'→')
    .replace(/\\(log|ln|max|min|sum|infty)\b/g,(m,w)=>({sum:'Σ',infty:'∞'})[w]||w);
}
// 한 줄 안의 **굵게**와 `코드`만 꾸민다. 모두 textContent로 넣어 HTML로 해석하지 않는다.
function inline(target,line){
  for(const part of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/)){
    if(!part)continue;
    if(part.startsWith('**')&&part.endsWith('**')&&part.length>4)target.append(node('strong','',part.slice(2,-2)));
    else if(part.startsWith('`')&&part.endsWith('`')&&part.length>2)target.append(node('code','tutor-inline',part.slice(1,-1)));
    else target.append(document.createTextNode(part.replace(/([가-힣]\.)[ \t]+/g,'$1\n')));
  }
}
// ```로 감싼 코드는 따로 그리고, 나머지는 제목(###)·굵게·인라인 코드만 꾸민다.
export function renderAnswer(target,text){
  target.replaceChildren();
  text.split('```').forEach((part,index)=>{
    if(index%2){const code=part.replace(/^[\w+#-]*\n/,'');const pre=node('pre','tutor-code');pre.append(node('code','',code.replace(/\n$/,'')));target.append(pre);return;}
    const lines=plainMath(part).split('\n');
    lines.forEach((line,i)=>{
      const heading=/^\s*#{1,4}\s+(.*)$/.exec(line);
      if(heading)target.append(node('strong','tutor-heading',heading[1].replace(/\*\*/g,'')));
      else inline(target,line);
      if(i<lines.length-1)target.append(document.createTextNode('\n'));
    });
  });
}

export class TutorUI{
  constructor({room,toast}){
    Object.assign(this,{room,toast});this.history=[];this.busy=false;this.ready=false;this.controller=null;
    $('tutor-form').addEventListener('submit',e=>{e.preventDefault();void this.ask();});
    $('tutor-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void this.ask();}});
    $('tutor-input').addEventListener('input',()=>this.sync());
    $('tutor-stop').addEventListener('click',()=>this.controller?.abort());
    $('tutor-clear').addEventListener('click',()=>{if(this.busy)return;this.history=[];$('tutor-log').replaceChildren();this.sync();});
    $('tutor-dialog').addEventListener('close',()=>this.controller?.abort());
    this.sync();
  }
  sync(){
    const text=$('tutor-input').value.trim();
    $('tutor-input').disabled=!this.ready;$('tutor-send').disabled=!this.ready||this.busy||text.length<2;
    $('tutor-stop').hidden=!this.busy;$('tutor-clear').hidden=!this.history.length;
    $('tutor-clear').disabled=this.busy;
  }
  async open(){
    $('tutor-error').textContent='';this.sync();
    const status=$('tutor-status');
    if(!this.ready)status.textContent='튜터 상태 확인 중…';
    try{
      const result=await this.room.service('/api/tutor/status',{warm:true});
      this.ready=!!result.ready;
      $('tutor-model').textContent=result.model?'모델 · '+result.model:'';
      status.textContent=result.ready?this.label(result.left):result.message;
      status.dataset.state=result.ready?'ready':'off';
    }catch(error){this.ready=false;status.textContent=error.status===404?'이 방에서는 AI 튜터를 쓸 수 없어요.':error.message;status.dataset.state='off';}
    this.sync();
    if(this.ready&&matchMedia('(pointer:fine)').matches)$('tutor-input').focus({preventScroll:true});
  }
  label(left){return Number.isInteger(left)?`오늘 질문 ${left}개 남음`:'질문 가능';}
  bubble(role,text=''){
    const item=node('div',`tutor-msg tutor-${role}`),body=node('div','tutor-text');
    if(role==='assistant')renderAnswer(body,text);else body.textContent=text;
    item.append(body);$('tutor-log').append(item);this.scroll();return body;
  }
  scroll(){const log=$('tutor-log');log.scrollTop=log.scrollHeight;}
  async ask(){
    const input=$('tutor-input'),question=input.value.trim();
    if(this.busy||!this.ready||question.length<2)return;
    this.busy=true;$('tutor-error').textContent='';input.value='';
    const history=this.history.slice(-KEEP).map(({role,content})=>({role,content:content.slice(0,1200)}));
    this.bubble('user',question);
    const answer=this.bubble('assistant');answer.parentElement.classList.add('tutor-pending');answer.textContent='생각하는 중…';
    this.sync();
    const controller=this.controller=new AbortController();
    let text='',failed='';
    try{
      const response=await fetch('/api/tutor/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,history,profileKey:this.room.profileKey}),signal:controller.signal});
      if(!response.ok){const result=await response.json().catch(()=>({}));throw Object.assign(Error(result.error||'다시 시도해주세요.'),{status:response.status});}
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffered='';
      for(;;){
        const {value,done}=await reader.read();if(done)break;
        buffered+=decoder.decode(value,{stream:true});let split;
        while((split=buffered.indexOf('\n'))>=0){
          const line=buffered.slice(0,split);buffered=buffered.slice(split+1);if(!line.trim())continue;
          const event=JSON.parse(line);
          if(Number.isInteger(event.left))$('tutor-status').textContent=this.label(event.left);
          if(event.wait&&!text)answer.textContent=`앞의 질문 ${event.wait}개를 답하는 중이에요. 잠시만요…`;
          if(event.text){text+=event.text;answer.parentElement.classList.remove('tutor-pending');renderAnswer(answer,text);this.scroll();}
          if(event.cut)text+='\n\n…답이 길어서 여기까지예요. "이어서"라고 물어보세요.';
          if(event.error)failed=event.error;
        }
      }
    }catch(error){
      failed=controller.signal.aborted?(text?'':'질문을 취소했어요.'):error.status?error.message:'방장 노트북과 연결을 확인해 주세요.';
    }finally{
      this.busy=false;this.controller=null;answer.parentElement.classList.remove('tutor-pending');
      if(text){if(controller.signal.aborted)text+=' …(중단)';renderAnswer(answer,text);this.history.push({role:'user',content:question},{role:'assistant',content:text});this.history=this.history.slice(-KEEP*2);}
      else{answer.parentElement.remove();if(!controller.signal.aborted||failed)input.value=input.value||question;}
      if(failed)$('tutor-error').textContent=failed;
      this.sync();this.scroll();
    }
  }
}
