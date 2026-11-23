import { walkable, directionFor, normalizeDirection } from './world.js';
import {sceneInfo,sameScene} from './scenes.js';

export const PLAY = Object.freeze({ range:110, cooldown:800, protection:1000, push:36, settle:180, effect:380 });
export function movementReady(state,epoch) { return !state.knockback&&epoch>=(state.hitUntil||0); }
export function canPlay(player) { return !!player && player.playful!==false && player.focusSince==null&&!player.campus?.furnitureSeat&&sceneInfo(player.campus?.scene||'plaza')?.play!==false; }
export function protectedFromHit(player,now) { return player.campus.hitAt>0 && now-player.campus.hitAt<PLAY.protection; }
export function nearestFriend(me,players,now) {
  if(!canPlay(me))return null;
  let target=null,distance=PLAY.range;
  for(const other of players){
    if(other.id===me.id||!sameScene(me.campus,other.campus)||!canPlay(other)||protectedFromHit(other,now))continue;
    const d=Math.hypot(other.campus.x-me.campus.x,other.campus.y-me.campus.y);
    if(d<=distance){distance=d;target=other;}
  }
  return target;
}
export function pushDestination(attacker,target) {
  let dx=target.x-attacker.x,dy=target.y-attacker.y,length=Math.hypot(dx,dy);
  if(length<.01){const angle={east:0,southeast:1,south:2,southwest:3,west:4,northwest:5,north:6,northeast:7}[normalizeDirection(attacker.facing)]*Math.PI/4;dx=Math.cos(angle);dy=Math.sin(angle);length=1;}
  dx/=length;dy/=length;
  let x=target.x,y=target.y;
  // Check every two world pixels, stopping before the first solid boundary.
  for(let step=2;step<=PLAY.push;step+=2){const nx=target.x+dx*step,ny=target.y+dy*step;if(!walkable(nx,ny,target.scene||'plaza'))break;x=nx;y=ny;}
  return {x,y,facing:directionFor(dx,dy)};
}

// A local displacement must survive unrelated snapshots and never be replayed on resume.
export function acceptPosition(state,campus,{initial=false,now=0,reduced=false}={}) {
  const revision=campus.positionRevision||0;
  if(!initial&&revision===(state.positionRevision||0))return false;
  state.positionRevision=revision;
  state.knockback=!initial&&!reduced?{fromX:state.x,fromY:state.y,toX:campus.x,toY:campus.y,at:now}:null;
  if(!state.knockback){state.x=campus.x;state.y=campus.y;}
  state.hitUntil=initial?0:campus.bumpUntil||0;
  return true;
}
export function stepKnockback(state,now) {
  const k=state.knockback;if(!k)return false;
  const t=Math.max(0,Math.min(1,(now-k.at)/PLAY.settle)),ease=1-(1-t)**3;
  state.x=k.fromX+(k.toX-k.fromX)*ease;state.y=k.fromY+(k.toY-k.fromY)*ease;
  if(t===1)state.knockback=null;
  return true;
}
