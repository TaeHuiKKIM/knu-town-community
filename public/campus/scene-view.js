import {createPortal,drawEntrance,signOffset,signFace} from './wayfinding.js';
import {SCENES,sceneInfo,nearbyPortal} from './scenes.js';
const $=id=>document.getElementById(id);

import {ImageCache} from './scene-images.js';
export {ImageCache} from './scene-images.js';

export class SceneView {
  constructor({room,ambient,onBusy,onShow,canTravel,confirmArrival,onWalkToGate,toast}){
    Object.assign(this,{room,ambient,onBusy,onShow,canTravel,confirmArrival,onWalkToGate,toast});this.images=new ImageCache();this.gateArt=new Map();this.current='plaza';this.ready=false;this.busy=false;this.version=0;this.travelVersion=0;this.near=null;this.cards=new Map();
    for(const scene of Object.values(SCENES)){
      const b=document.createElement('button');b.className='scene-card';const img=document.createElement('img');img.src='/campus/assets/previews/'+scene.id+'.png';img.alt='';img.loading='lazy';const title=document.createElement('strong');title.textContent=scene.name;const detail=document.createElement('span');detail.textContent=scene.play?'산책과 놀이':'조용한 휴식';b.append(img,title,detail);b.addEventListener('click',()=>void this.travel(scene.id));$('scene-list').append(b);this.cards.set(scene.id,b);
    }
    $('scene-retry').addEventListener('click',()=>this.failedTravel ? void this.travel(this.failedTravel.id,this.failedTravel.via) : void this.show(this.requested||this.current));
  }
  reset(){this.travelVersion++;this.version++;this.failedTravel=null;this.requested=null;this.busy=false;this.near=null;this.sync();}
  sync(){
    const blocked=this.busy||!this.ready;this.onBusy(blocked);$('scene-loading').hidden=!blocked&&!this.failedTravel;
    $('scene-loading').classList?.toggle('over-map',!!this.hasBackdrop);
    for(const [id,b]of this.cards){b.disabled=this.busy||!this.room.online||id===this.current;b.setAttribute('aria-current',String(id===this.current));}
  }
  async show(id){
    const scene=sceneInfo(id);if(!scene)return;const version=++this.version;this.requested=id;this.failedTravel=null;this.ready=false;$('scene-loading-text').textContent='장소 불러오는 중';$('scene-retry').hidden=true;this.sync();
    try{const [image,atlas]=await Promise.all([this.images.load(scene.image),this.images.load('/campus/assets/campus-wayfinding.png')]);if(version!==this.version)return;
      const previous=$('scene-art');
      image.id='scene-art';image.className=previous.className;image.alt=scene.alt;image.draggable=false;
      if(previous!==image)previous.replaceWith(image);
      this.current=id;this.requested=null;this.hasBackdrop=true;$('scene-label').textContent=scene.name;$('viewport').setAttribute('aria-label',scene.name+'. 방향키 또는 WASD로 이동');$('world').dataset.scene=id;$('fountain').hidden=id!=='plaza';
      this.threshold=null;this.near=null;
      for(const old of this.gateArt.values()){old.canvas.remove();old.caption.remove();old.portal.remove();}
      this.gateArt.clear();
      for(const old of document.querySelectorAll('#world .building-sign'))old.remove();
      for(const sign of scene.signs||[]){const node=document.createElement('span');node.className='building-sign';node.textContent=sign.text;node.setAttribute('aria-hidden','true');Object.assign(node.style,{left:sign.x+'px',top:sign.y+'px',width:sign.width+'px'});$('world').append(node);}
      for(const gate of scene.portals){
        const portal=createPortal(gate,'/campus/assets/campus-warp.png');
        $('world').append(portal);
        const canvas=document.createElement('canvas');canvas.className='entrance-art';
        canvas.width=200;canvas.height=250;canvas.style.left=(gate.x-100)+'px';canvas.style.top=(gate.y-150)+'px';
        canvas.setAttribute('aria-label',sceneInfo(gate.target).name+' 안내판');
        const ctx=canvas.getContext('2d');
        const paint=phase=>{
          ctx.clearRect(0,0,200,250);ctx.save();ctx.translate(100,150);
          drawEntrance(ctx,atlas,id,gate,phase,false);ctx.restore();
        };
        const library=id==='lounge',face=signFace(gate);
        const caption=document.createElement(library?'button':'span');
        caption.className='entrance-caption';caption.textContent=gate.target==='lounge'?'도서관':sceneInfo(gate.target).name;
        caption.style.left=(library?face.x:gate.x+signOffset(gate))+'px';
        caption.style.top=(library?face.top-4:gate.y-57)+'px';
        if(library){
          caption.type='button';caption.dataset.to=gate.target;
          caption.onclick=()=>this.onWalkToGate(gate);
        }
        $('world').append(caption);
        this.gateArt.set(gate.id,{canvas,paint,caption,portal});$('world').append(canvas);paint(0);
      }
      this.ambient.configure(image,scene);this.ready=true;this.onShow(scene);
    }catch(error){if(version!==this.version)return;$('scene-loading-text').textContent=error.message;$('scene-retry').hidden=false;}
    finally{if(version===this.version)this.sync();}
  }
  async travel(id,via){
    if(this.busy||!this.room.me||!this.room.online||id===this.current)return;
    const scene=sceneInfo(id);if(!scene)return;
    if(!this.canTravel()){this.toast('공부를 확인하고 휴식한 뒤 이동해주세요');return;}
    if($('scene-dialog').open)$('scene-dialog').close();
    this.failedTravel=null;const generation=++this.travelVersion,owner=this.room.me,origin=this.current;this.busy=true;$('scene-loading-text').textContent='장소 불러오는 중';$('scene-retry').hidden=true;this.sync();
    try{
      try {await this.images.load(scene.image);} catch(error) {
        if(generation===this.travelVersion && this.room.me===owner && this.current===origin){
          this.failedTravel={id,via};$('scene-loading-text').textContent=error.message;$('scene-retry').hidden=false;
        }
        return false;
      }
      if(generation!==this.travelVersion||this.room.me!==owner||this.current!==origin)return;
      if(via && id==='lounge' && !matchMedia('(prefers-reduced-motion: reduce)').matches){
        $('scene-loading').hidden=true;
        const entrance=this.gateArt.get(via);
        if(entrance){
          try{
            for(let frame=1;frame<=4;frame++){
              if(generation!==this.travelVersion||this.room.me!==owner||this.current!==origin)return;
              entrance.paint(frame/4);await new Promise(resolve=>setTimeout(resolve,85));
            }
          }finally{entrance.paint(0);}
        }
      }
      if(generation!==this.travelVersion||this.room.me!==owner||this.current!==origin)return;
      if(via && !await this.confirmArrival())return;
      if(generation!==this.travelVersion||this.room.me!==owner||this.current!==origin)return;
      await this.room.send({type:'scene',scene:id,...(via?{via}:{})});if(generation===this.travelVersion){$('scene-dialog').close();return true;}
    }catch(error){if(generation===this.travelVersion&&!error.stale)this.toast(error.message);}
    finally{if(generation===this.travelVersion){this.busy=false;this.sync();}}
  }
  tick(state){
    const near=nearbyPortal(this.current,state.x,state.y);const previous=this.near;this.near=near;
    if(previous?.id!==near?.id){
      if(near)this.images.warm(sceneInfo(near.target).image);
      this.gateArt.get(previous?.id)?.portal.classList.remove('is-near');
      this.gateArt.get(near?.id)?.portal.classList.add('is-near');
    }
    const threshold=near&&Math.hypot(state.x-near.x,state.y-near.y)<=22?near:null;
    if(!threshold)this.threshold=null;
    if(threshold&&this.threshold!==threshold.id&&state.motion!=='idle'&&this.ready&&!this.busy&&this.room.online&&this.canTravel()){
      this.threshold=threshold.id;void this.travel(threshold.target,threshold.id);
    }
  }
  useNearby(){if(!this.near||this.busy||!this.ready||!this.canTravel())return false;void this.travel(this.near.target,this.near.id);return true;}
}
