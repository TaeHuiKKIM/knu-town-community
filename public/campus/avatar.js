import { STUDENTS } from './sprites/data.js';
import { COATS, AVATARS } from './world.js';
import { selectStudentFrame, drawStudentSprite } from './student-motion.js';
import { studyStyle, styleForAvatar, styleLayout } from './wardrobe.js';

export class Avatars {
  constructor({imageFactory=()=>new Image(),fetchImpl=(...args)=>fetch(...args)}={}){
    Object.assign(this,{imageFactory,fetchImpl});this.images=new Map();this.styles=new Map();this.styleRequests=new Map();this.ready=false;
  }
  loadImage(src){
    return new Promise((resolve,reject)=>{
      const img=this.imageFactory(),finish=ok=>{
        clearTimeout(timer);img.onload=img.onerror=null;
        if(ok)resolve(img);else reject(Error('캐릭터를 불러오지 못했어요'));
      };
      const timer=setTimeout(()=>finish(false),8000);
      img.onload=()=>finish(true);img.onerror=()=>finish(false);img.src=src;
    });
  }
  async load(){
    await Promise.all(AVATARS.flatMap(avatar=>COATS.map(async coat=>{
      this.images.set(`${avatar}/${coat}`,await this.loadImage(`/campus/sprites/${avatar}/${coat}.png`));
    })));this.ready=true;
  }
  hasStyle(id){return this.styles.has(id);}
  async loadStyle(id){
    if(!studyStyle(id))throw Error('코디를 확인해주세요.');
    if(this.hasStyle(id))return;
    if(!this.styleRequests.has(id)){
      const request=this.fetchStyle(id).finally(()=>this.styleRequests.delete(id));
      this.styleRequests.set(id,request);
    }
    return this.styleRequests.get(id);
  }
  async fetchStyle(id){
    const root=`/campus/wardrobe/${id}`,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    let layout;
    try{
      const response=await this.fetchImpl(root+'/runtime-manifest.json',{signal:controller.signal});
      if(!response.ok)throw Error('코디 그림을 불러오지 못했어요.');
      layout=styleLayout(await response.json());
    }finally{clearTimeout(timer);}
    if(!layout)throw Error('코디 그림 정보를 읽지 못했어요.');
    const image=await this.loadImage(root+'/sprite-sheet-alpha.png');
    if(image.naturalWidth!==layout.sheetWidth||image.naturalHeight!==layout.sheetHeight)throw Error('코디 그림 크기를 확인해주세요.');
    this.styles.set(id,{image,rows:layout.rows});
  }
  paint(canvas,{avatar='male',coat='burgundy',style=null,...state}={}){
    if(!this.ready||!canvas)return;
    const outfit=styleForAvatar(style,avatar)?this.styles.get(style):null;
    const rows=outfit?.rows||STUDENTS[avatar].frame_layout.rows,{pose,frame,lift}=selectStudentFrame(rows,state);
    // Move the whole canvas so heads can rise past its normal box and the ground actor stays put.
    const shift=lift-(state.seatOffset||0);
    const translate=shift?`0px ${-shift}px`:'';
    if(canvas.style.translate!==translate){
      canvas.style.translate=translate;
      const actor=canvas.parentElement;
      if(actor?.classList.contains('actor'))actor.style.setProperty('--actor-lift',(-shift)+'px');
    }
    const key=`${avatar}/${coat}/${outfit?style:''}/${pose}/${frame}/${!!state.crouch}/${!!state.seated}`;if(canvas.dataset.paint===key)return;canvas.dataset.paint=key;
    const r=rows[pose][frame],ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,96,128);ctx.imageSmoothingEnabled=false;
    const image=outfit?.image||this.images.get(`${avatar}/${coat}`);
    drawStudentSprite(ctx,image,r,{avatar,pose,crouch:state.crouch,seated:Number(!!state.seated)});
    Object.assign(canvas.dataset,{avatar,coat,style:outfit?style:'',animation:pose,frame:String(frame)});
  }
}
