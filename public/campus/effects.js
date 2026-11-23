// A small world-space canvas; no image/network work in the animation loop.
export function fountain(canvas){
  const ctx=canvas.getContext('2d'), reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let last=-Infinity,frame=0,enabled=true;
  const jets=[[160,148,1],[75,165,.43],[97,186,.35],[115,143,.4],[198,143,.4],[224,151,.4],[245,174,.35],[222,191,.3]];
  function draw(now){
    if(document.hidden)return;
    const moving=enabled&&!reduced.matches;
    if(!moving&&last!==-Infinity)return;
    if(now-last<33)return;last=now;
    const t=moving?now/1000:0;ctx.clearRect(0,0,320,260);
    for(let i=0;i<jets.length;i++){
      const [x,y,power]=jets[i];
      for(let j=0;j<34;j++){
        const age=((t*.85+j/34+i*.17)%1)*1.9;
        const spread=Math.sin(j*2.4+i)*16*power;
        const px=x+spread*age+Math.sin(t*2+j)*1.2;
        const py=y-210*power*age+108*age*age;
        if(py>y+8)continue;
        const opacity=Math.max(.18,.94-age*.35);
        ctx.fillStyle=`rgba(${j%3===0?'171,225,231':'243,255,250'},${opacity})`;
        ctx.fillRect(Math.round(px/2)*2,Math.round(py/2)*2,j%4===0?3:2,j%3===0?5:3);
      }
      const cycle=(t*.7+i*.21)%1;
      ctx.strokeStyle=`rgba(213,250,240,${(1-cycle)*.48})`;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.ellipse(x,y+8,6+cycle*18,2+cycle*5,0,0,Math.PI*2);ctx.stroke();
    }
    // Small reflections stay within the pond and drift independently of the sprays.
    for(let i=0;i<18;i++){
      const a=i*2.399,r=34+(i%5)*18,x=160+Math.cos(a)*r*1.5,y=177+Math.sin(a)*r*.34;
      ctx.fillStyle=`rgba(228,255,236,${.15+.22*Math.max(0,Math.sin(t*1.5+i))})`;
      ctx.fillRect(Math.round(x),Math.round(y),3+(i%3)*2,1);
    }
    canvas.dataset.frame=String(++frame);canvas.dataset.motion=moving?'playing':'reduced';
  }
  reduced.addEventListener('change',()=>{last=-Infinity;});
  return {draw,setEnabled(value){enabled=value;last=-Infinity;},get enabled(){return enabled;}};
}
