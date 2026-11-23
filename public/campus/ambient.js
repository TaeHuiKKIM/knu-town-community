import {walkable} from './world.js';

export class Ambient {
  constructor(canvas,world){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.world=world;this.layers=[];this.enabled=true;this.dirty=true;this.last=-Infinity;this.frame=0;this.scene=null;this.reduced=matchMedia('(prefers-reduced-motion: reduce)');this.reduced.addEventListener('change',()=>{this.dirty=true;});}
  configure(image,scene){
    for(const layer of this.layers)layer.node.remove();this.layers=[];this.scene=scene;
    for(const [index,canopy]of scene.canopies.entries()){
      const [x,y,w,h]=canopy.box,node=document.createElement('canvas');node.width=w;node.height=h;node.className='canopy-layer';node.setAttribute('aria-hidden','true');Object.assign(node.style,{left:x+'px',top:y+'px',zIndex:String(canopy.root)});
      const ctx=node.getContext('2d');ctx.drawImage(image,x,y,w,h,0,0,w,h);
      // Cache foliage only once; windows, trunks, ground and furniture stay fixed.
      const pixels=ctx.getImageData(0,0,w,h),d=pixels.data;
      for(let py=0;py<h;py++)for(let px=0;px<w;px++){
        const i=(py*w+px)*4,r=d[i],g=d[i+1],b=d[i+2],inside=((px-w/2)/(w/2))**2+((py-h/2)/(h/2))**2<1;
        const leaf=g>r*1.04&&g>b*1.15||r>85&&g>80&&r/g<1.36&&r/g>.85&&b<g*.68;
        if(!inside||!leaf)d[i+3]=0;
      }
      ctx.putImageData(pixels,0,0);this.world.append(node);this.layers.push({node,index,canopy,dx:0,angle:0});
    }
    this.last=-Infinity;this.dirty=true;this.draw(performance.now());
  }
  setEnabled(value){this.enabled=value;this.dirty=true;}
  draw(now,powerSave=false){
    if(!this.scene||document.hidden)return;
    const moving=this.enabled&&!this.reduced.matches;
    if(!moving&&!this.dirty||now-this.last<(powerSave?100:66)&&!this.dirty)return;
    this.last=now;this.dirty=false;const t=moving?now/1000:0;
    for(const layer of this.layers){
      const {node,index}=layer;
      layer.dx=moving?Number((Math.sin(t*.8+index*1.7)*1.8).toFixed(2)):0;
      layer.angle=moving?Number((Math.sin(t*.65+index)*.28).toFixed(3)):0;
      node.style.transform=moving?`translateX(${layer.dx}px) rotate(${layer.angle}deg)`:'none';
    }
    const ctx=this.ctx;ctx.clearRect(0,0,768,512);ctx.save();ctx.scale(.5,.5);
    if(moving)for(let i=0;i<18;i++){
      const x=300+((i*113+t*(5+i%4))%1000),y=390+((i*83+t*(8+i%3))%570);
      if(!walkable(x,y,this.scene.id))continue;
      if(this.scene.ambient==='light'){ctx.fillStyle=`rgba(255,239,182,${(.15+.12*Math.sin(t+i)).toFixed(2)})`;ctx.fillRect(x,y,2,2);}
      else{ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(t+i)*.8);ctx.fillStyle=i%3?'#d5a335aa':'#9f681f99';ctx.fillRect(-2,-1,4,2);ctx.restore();}
    }
    ctx.restore();this.canvas.dataset.frame=String(++this.frame);this.canvas.dataset.motion=moving?'playing':'reduced';
  }
  // LAN orders foliage and actors by depth in the DOM. A canvas actor only
  // needs the part of a nearer canopy that overlaps its sprite.
  coverActor(ctx,depth,left,top,width,height){
    let covered=false;
    for(const {node,canopy,dx,angle} of this.layers){
      const [x,y,w,h]=canopy.box;
      if(depth>=canopy.root || left+width<x-4 || x+w+4<left || top+height<y-4 || y+h+4<top)continue;
      ctx.save();ctx.beginPath();ctx.rect(left,top,width,height);ctx.clip();
      ctx.translate(x+w/2+dx,y+h);ctx.rotate(angle*Math.PI/180);ctx.drawImage(node,-w/2,-h);ctx.restore();
      covered=true;
    }
    return covered;
  }
}
