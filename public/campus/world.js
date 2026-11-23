import {exitCameraX} from './wayfinding.js';
import {furnitureBlocked} from './furniture.js';
import {canStand} from './terrain.js';
import {sceneInfo,originalPlazaFloor} from './scenes.js';
export const COATS = ['burgundy', 'forest', 'navy', 'cse'];
export const AVATARS = ['male', 'female'];
export const DIRECTIONS = ['east','southeast','south','southwest','west','northwest','north','northeast'];
export const FACINGS = [...DIRECTIONS, 'left', 'right'];
export const MOTIONS = ['idle', 'walk', 'run'];
export const WORLD = { width: 1536, height: 1024 };

const physicalKeys = new Map([
  ['KeyW','w'], ['KeyA','a'], ['KeyS','s'], ['KeyD','d'],
  ['KeyJ','j'], ['KeyC','c'], ['KeyF','f'], ['Space',' '],
  ['ShiftLeft','shift'], ['ShiftRight','shift']
]);
export const walkKeys = new Map([
  ['w',[0,-1]], ['arrowup',[0,-1]], ['s',[0,1]], ['arrowdown',[0,1]],
  ['a',[-1,0]], ['arrowleft',[-1,0]], ['d',[1,0]], ['arrowright',[1,0]]
]);
export function campusKeyName(event) {
  return physicalKeys.get(event.code) ?? event.key?.toLowerCase();
}
export function campusKey(event) {
  const target = event.target;
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
      target?.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)) return null;
  if (event.keyCode === 229 && !physicalKeys.has(event.code)) return null;
  return campusKeyName(event);
}

// Same world coordinates are used for local collision and server validation.
export function walkable(x,y,scene='plaza',pondSeating=true){
  const ground=scene==='plaza'&&!pondSeating?originalPlazaFloor:sceneInfo(scene);
  return canStand(ground,x,y)&&!furnitureBlocked(scene,x,y);
}

const spawnCache=new Map();
function slots(scene){
  if(spawnCache.has(scene))return spawnCache.get(scene);
  const info=sceneInfo(scene);if(!info)throw Error('Unknown scene');
  const points=[],candidates=scene==='plaza'?Array.from({length:8},(_,i)=>({x:860-(i%4)*84,y:520+Math.floor(i/4)*100+(i%2)*24})):[info.spawn];
  for(let y=500;y<=900;y+=80)for(let x=260;x<=1380;x+=80)candidates.push({x,y});
  for(const p of candidates)if(walkable(p.x,p.y,scene)&&points.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=65))points.push(p);
  spawnCache.set(scene,points);return points;
}
export function spawn(index,scene='plaza'){return {...slots(scene)[index%slots(scene).length],scene,facing:'south',motion:'idle',waveAt:0,movedAt:0};}
let extraPlazaSlots;
function expandedPlazaSlots() {
  if (extraPlazaSlots) return extraPlazaSlots;
  const choices = [...slots('plaza')];
  for (let y = 370; y <= 950; y += 10) {
    for (let x = 210; x <= 1510; x += 10) {
      if (walkable(x,y) && choices.every(p => (p.x-x)**2 + (p.y-y)**2 >= 56**2)) choices.push({x,y});
    }
  }
  extraPlazaSlots = choices;
  return choices;
}
export function freeSpawn(positions, scene='plaza', eventPlaza=false) {
  const choices = slots(scene);
  const available = (list, distance) => list.find(p => positions.every(other =>
    (p.x-other.x)**2 + (p.y-other.y)**2 >= distance**2));
  let point = available(choices, 60);
  if (!point && eventPlaza && scene === 'plaza') point = available(expandedPlazaSlots(), 56);
  point ??= choices[positions.length % choices.length];
  return {...point,scene,facing:'south',motion:'idle',waveAt:0,movedAt:0};
}

export function directionFor(dx,dy,previous='south') {
  if(Math.hypot(dx,dy)<.01) return previous;
  return DIRECTIONS[(Math.round(Math.atan2(dy,dx)/(Math.PI/4))+8)%8];
}
export function normalizeDirection(direction) { return direction==='left'?'west':direction==='right'?'east':DIRECTIONS.includes(direction)?direction:'south'; }

export function cameraTransform({ width, height, x, y, scene, mobile = false, overview = false }) {
  const scale = overview ? Math.min(width / WORLD.width, height / WORLD.height)
    : Math.max(width / WORLD.width, height / WORLD.height) * (mobile ? 1.02 : 1);
  function axis(screen, world, focus, anchor) {
    const extent = world * scale;
    if (overview || extent <= screen) return (screen - extent) / 2;
    return Math.max(screen - extent, Math.min(0, screen * anchor - focus * scale));
  }
  return { scale, x: axis(width, WORLD.width, exitCameraX(scene,x,y,x+(mobile?130:0),width,scale), .5), y: axis(height, WORLD.height, y, .6) };
}
