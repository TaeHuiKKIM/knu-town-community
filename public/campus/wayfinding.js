import {arrivalFrom,sceneInfo} from './scenes.js';

// The origin is the foot of the entrance in world coordinates.
export function signOffset(gate) {
  if(gate.id.startsWith('library-'))return gate.target==='plaza'?-58:58;
  return gate.x > 768 ? -58 : 58;
}
// The wooden sign occupies columns 7..58 and rows 14..59 of the 64px sprite.
// Both renderers use its visible face as the caption and tap anchor.
export function signFace(gate){
  const offset=signOffset(gate);
  return {x:gate.x+offset+(offset>0?-1:1),top:gate.y-40,bottom:gate.y+6,width:52};
}
// Near the library exit, keep both destination names inside a phone viewport.
export function exitCameraX(scene,x,y,focus,width,scale){
  if(scene!=='lounge'||width>760)return focus;
  const [leftGate,rightGate]=sceneInfo(scene).portals;
  const middle=(leftGate.x+rightGate.x)/2;
  const weight=Math.min(1,Math.max(0,(y-leftGate.y+160)/60))*Math.min(1,Math.max(0,(270-Math.abs(x-middle))/75));
  if(!weight)return focus;
  const half=(width/2-52)/scale;
  const min=signFace(rightGate).x-half, max=signFace(leftGate).x+half;
  const framed=min>max?middle:Math.max(min,Math.min(max,focus));
  return focus+(framed-focus)*weight;
}
// The painted water surface is centered at (56,44) in each 112 by 80 frame.
export function createPortal(gate, imageUrl){
  const node=document.createElement('div');
  node.className='warp-portal';node.setAttribute('aria-hidden','true');
  node.style.left=(gate.x-56)+'px';node.style.top=(gate.y-44)+'px';
  node.style.backgroundImage='url("'+imageUrl+'")';
  return node;
}
export function onPortalSurface(gate,x,y){
  return ((x-gate.x)/52)**2+((y-gate.y)/22)**2<=1;
}
// On the plaza the facade is above the collision threshold, at the top of the steps.
export function doorOffset(scene){return scene==='plaza'?-48:0;}
export function drawEntrance(ctx, atlas, scene, gate, phase=0, canvasLabel=true) {
  if (!atlas.naturalWidth) return;
  const approach=arrivalFrom(gate.target,scene);
  const dx=approach.x-gate.x, dy=approach.y-gate.y;
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  for(let row=1;row<=4;row++){
    const t=row/4, x=Math.round(dx*t), y=Math.round(dy*t);
    for(const side of [-1,1]){
      const px=x+side*7+(row%2)*2, py=y+side*2;
      ctx.fillStyle=scene==='lounge'?'#8e65463b':'#7c6b594d';
      ctx.fillRect(px-5,py,12,3);
      ctx.fillStyle=scene==='lounge'?'#dcb58d8c':'#d3c8acb0';
      ctx.fillRect(px-5,py-2,10,3);
    }
  }
  if(gate.target==='lounge'){
    const frame=Math.min(4,Math.floor(phase*5));
    ctx.drawImage(atlas,frame*64,0,64,64,-44,-83+doorOffset(scene),88,88);
  }
  const sx=signOffset(gate);
  // Paint the lettering before mirroring the arrow sprite.
  if(canvasLabel){
  const label=gate.target==='lounge'?'도서관':sceneInfo(gate.target).name;
  ctx.font='18px Galmuri, Pixel, sans-serif';
  const width=Math.ceil(ctx.measureText(label).width)+12;
  const center=scene==='lounge'?sx-Math.sign(sx)*10:sx;
  const left=Math.round(center-width/2);
  ctx.fillStyle='#503a2d';
  ctx.fillRect(left,-81,width,26);
  ctx.fillStyle='#fff1ce';
  ctx.fillRect(left+2,-79,width-4,22);
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillStyle='#422e23';
  ctx.fillText(label,center,-68);
  }
  ctx.translate(sx,3);
  if(sx>0)ctx.scale(-1,1);
  const icon=gate.target==='lounge'?0:gate.target==='ginkgo'?1:2;
  ctx.drawImage(atlas,icon*64,64,64,64,-32,-57,64,64);
  ctx.restore();
}

// The map and touch controls use the same target description on both clients.
export function showSpaceAction(button, label, detail, icon, kind) {
  if (button.dataset.action === label && button.dataset.detail === detail && button.dataset.kind === kind) return;
  button.dataset.action = label;
  button.dataset.detail = detail;
  button.dataset.kind = kind;
  button.querySelector('.action-verb').textContent = label;
  const target = button.querySelector('.action-detail');
  target.textContent = detail;
  target.hidden = !detail;
  button.querySelector('img').src = icon;
  const description = detail ? detail + ' · ' + label : label;
  button.setAttribute('aria-label', description);
  button.title = description + ' (SPACE)';
}
