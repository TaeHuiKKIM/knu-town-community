// Keep the first visible message in place when older entries expire.
export function chatScroll(list,latest){
  let following=true,anchor=null,offset=0;
  function remember(){
    if(!list.clientHeight)return;
    following=list.scrollHeight-list.clientHeight-list.scrollTop<=4;
    latest.hidden=following;
    if(following){anchor=null;return;}
    const top=list.getBoundingClientRect().top;
    anchor=Array.from(list.children).find(row=>row.getBoundingClientRect().bottom>top+1);
    offset=anchor?anchor.getBoundingClientRect().top-top:0;
  }
  function restore(){
    if(!list.clientHeight)return;
    if(following)list.scrollTop=list.scrollHeight;
    else if(anchor?.parentNode===list)list.scrollTop+=anchor.getBoundingClientRect().top-list.getBoundingClientRect().top-offset;
    else list.scrollTop=0;
    remember();
  }
  list.addEventListener('scroll',remember,{passive:true});
  list.addEventListener('keydown',event=>{
    if(event.target!==list||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
    const page=Math.max(1,list.clientHeight-24);
    const distance={ArrowUp:-32,ArrowDown:32,PageUp:-page,PageDown:page,Home:-list.scrollHeight,End:list.scrollHeight,' ':event.shiftKey?-page:page};
    if(!Object.hasOwn(distance,event.key))return;
    event.preventDefault();
    list.scrollTop+=distance[event.key];
    remember();
  });
  new ResizeObserver(restore).observe(list);
  latest.onclick=()=>{
    list.focus({preventScroll:true});
    following=true;
    restore();
  };
  return {
    update(render,follow=false){
      remember();
      if(follow){following=true;anchor=null;}
      render();
      restore();
    },
    restore
  };
}
