import { PLAY } from './play.js';

export class Impacts {
  constructor(world){this.world=world;this.seen=new Set();this.active=[];this.ready=false;this.reduced=matchMedia('(prefers-reduced-motion: reduce)');}
  accept(events,epoch){
    if(!this.ready){for(const e of events)this.seen.add(e.id);this.ready=true;return;}
    const fresh=[];
    for(const e of events){
      if(this.seen.has(e.id))continue;this.seen.add(e.id);
      if(epoch-e.at<0||epoch-e.at>=PLAY.effect||document.hidden)continue;
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;canvas.className='impact';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','툭! 도트 이펙트');canvas.dataset.impactId=e.id;
      canvas.style.left=`${e.from.x-64}px`;canvas.style.top=`${e.from.y-123}px`;
      this.world.append(canvas);this.active.push({e,canvas});fresh.push(e);
      if(this.active.length>8)this.active.shift().canvas.remove();
    }
    if(this.seen.size>80)this.seen=new Set([...this.seen].slice(-40));
    this.draw(epoch);
    return fresh;
  }
  draw(epoch){
    for(const item of [...this.active]){
      const t=Math.max(0,(epoch-item.e.at)/PLAY.effect);
      if(t>=1||document.hidden){item.canvas.remove();this.active.splice(this.active.indexOf(item),1);continue;}
      const c=item.canvas.getContext('2d'),calm=this.reduced.matches;c.clearRect(0,0,128,128);c.globalAlpha=1-t;
      const star=(x,y,size,color)=>{c.fillStyle='#6a4631';c.fillRect(x-size-2,y-3,size*2+4,6);c.fillRect(x-3,y-size-2,6,size*2+4);c.fillStyle=color;c.fillRect(x-size,y-1,size*2,2);c.fillRect(x-1,y-size,2,size*2);c.fillRect(x-3,y-3,6,6);};
      star(64,64,calm?9:Math.round(8+Math.sin(t*Math.PI)*9),'#ffeda2');
      if(!calm)for(let i=0;i<8;i++){const a=i*Math.PI/4+.15,r=13+t*39,x=Math.round((64+Math.cos(a)*r)/2)*2,y=Math.round((64+Math.sin(a)*r+t*t*11)/2)*2;c.fillStyle=i%2?'#fff7da':'#e3b757';c.fillRect(x,y,4,4);}
      item.canvas.dataset.rendered='true';item.canvas.dataset.mode=calm?'reduced':'particles';
    }
  }
  reset(){for(const a of this.active)a.canvas.remove();this.active=[];this.seen.clear();this.ready=false;}
}
