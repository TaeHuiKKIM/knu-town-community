import {nearbyPortal} from './scenes.js';
const bench = (id, x, y) => ({
  id, kind: 'bench', label: '벤치', x, y,
  seats: [-25, 25].map(offset => ({x: x + offset, y}))
});
const table = (id, kind, label, x, y, offsets, twoSided=false) => ({
  id, kind, label, x, y,
  seats: [
    ...offsets.map(offset => ({x: x + offset, y: y + 30, chair: true, facing: 'north'})),
    ...(twoSided ? offsets.map(offset => ({x: x + offset, y: y - 56, chair: true, facing: 'south'})) : [])
  ]
});
const sofa = (id, label, x, y) => ({
  id, kind: 'sofa', label, x, y,
  seats: [-51, 0, 51].map(offset => ({x: x + offset, y}))
});

// These benches are already painted into the plaza. Measure both seats and their
// approach on the paving, including the slope of each bench in the illustration.
const pondBench = (side,label,a,b,dx,dy,facing,rail) => ({
  id:'pond-'+side, label:'일청담 '+label+' 벤치', kind:'pond-bench', rail,
  x:(a[0]+b[0])/2, y:(a[1]+b[1])/2,
  seats:[a,b].map(([x,y])=>({x,y,facing,approach:{x:x+dx,y:y+dy}}))
});
const furniture = {
  plaza: [bench('plaza-west', 380, 572), bench('plaza-south', 600, 828),
    pondBench('south','남쪽',[938,838],[974,850],5,-22,'northeast',
      [[915,806],[919,802],[979,822],[984,823],[984,858],[978,862],[977,843],[920,824],[920,844],[915,846]]),
    pondBench('north','북쪽',[1026,591],[1062,583],3,19,'south'),
    pondBench('northeast','북동쪽',[1300,595],[1337,604],-5,19,'southwest'),
    pondBench('east','동쪽',[1461,676],[1486,696],-18,10,'west'),
    pondBench('southeast','남동쪽',[1325,862],[1363,849],-5,-23,'northwest',
      [[1317,842],[1379,822],[1385,821],[1386,857],[1381,859],[1380,841],[1322,861],[1322,876],[1316,880]]),
    pondBench('west','서쪽',[853,716],[867,687],24,5,'east')],
  ginkgo: [bench('ginkgo-west', 330, 700), bench('ginkgo-east', 1160, 700)],
  lounge: [
    table('lounge-west', 'desk', '왼쪽 2인 책상', 508, 635, [-34, 34], true),
    table('lounge-east', 'desk', '오른쪽 2인 책상', 1028, 635, [-34, 34], true),
    table('lounge-common', 'long-table', '공동 테이블', 768, 524, [-93, -31, 31, 93], true),
    table('lounge-round', 'round-table', '원형 테이블', 768, 733, [-29, 29], true),
    sofa('lounge-sofa-west', '왼쪽 소파', 453, 812),
    sofa('lounge-sofa-east', '오른쪽 소파', 1081, 831),
    table('lounge-nook-west', 'round-table', '왼쪽 창가 테이블', 498, 443, [0], true),
    table('lounge-nook-east', 'round-table', '오른쪽 창가 테이블', 1038, 443, [0], true)
  ],
  // Two columns of four white desks facing the chalkboard, three black chairs each (sketch from the team).
  lecture: [595, 925].flatMap((x, column) => [430, 570, 710, 850].map((y, row) =>
    table(`lecture-${column ? 'east' : 'west'}-${row + 1}`, 'lecture-desk', `${column ? '오른쪽' : '왼쪽'} ${row + 1}번째 책상`, x, y, [-70, 0, 70])))
};

export const SEAT_REACH = 80;
export function sceneFurniture(scene) {
  return Object.hasOwn(furniture, scene) ? furniture[scene] : [];
}
export function furnitureSeats(scene) {
  return sceneFurniture(scene).flatMap(item => item.seats.map((seat, index) => ({
    ...seat, id: `${item.id}-${index + 1}`, kind: item.kind, label: item.label, number: index + 1
  })));
}


// Solids are measured on the ground plane at the feet of the illustrated furniture.
export const furnitureWidths={'lecture-desk':220,desk:136,'long-table':246,'round-table':112,sofa:180,bench:128};
export const furnitureHeights={'lecture-desk':93,desk:106,'long-table':112,'round-table':95,sofa:89,bench:56};
function pondBenchDistance(item,x,y){
  const [a,b]=item.seats,dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(-.3,Math.min(1.3,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(x-a.x-t*dx,y-a.y-t*dy);
}
const footprints=new Map();
for(const [scene,items] of Object.entries(furniture)){
  const solids=[];
  for(const item of items){
    if(item.kind==='pond-bench'){
      // Both seat centers and the rounded ends fit inside this broad-phase box.
      solids.push({pond:item,left:item.x-58,right:item.x+58,top:item.y-60,bottom:item.y+60});
      continue;
    }
    const half=furnitureWidths[item.kind]/2;
    const depth={'lecture-desk':50,bench:29,sofa:55,desk:52,'long-table':55,'round-table':48}[item.kind];
    solids.push({left:item.x-half,right:item.x+half,top:item.y-depth,bottom:item.y+5,round:item.kind==='round-table'});
    for(const seat of item.seats){
      if(seat.chair)solids.push({left:seat.x-19,right:seat.x+19,top:seat.y-23,bottom:seat.y+5});
    }
  }
  footprints.set(scene,solids);
}
export function furnitureBlocked(scene,x,y){
  return footprints.get(scene)?.some(({left,right,top,bottom,round,pond})=>{
    if(x<left||x>right||y<top||y>bottom)return false;
    if(pond)return pondBenchDistance(pond,x,y+5)<=10.5;
    if(!round)return true;
    return ((2*x-left-right)/(right-left))**2+((2*y-top-bottom)/(bottom-top))**2<=1;
  })??false;
}

export function seatApproach(seat){
  if(seat.approach)return {...seat.approach};
  return {x:seat.x,y:seat.y+(seat.chair && seat.facing==='south'?-36:18)};
}

// Camera, feet and collision positions stay independent from the contact point
// of the sprite on the illustrated cushion.
export function seatedFeetOffset(seat){
  if(seat.chair)return seat.facing==='north'?-10:-6;
  const kind=seat.kind||seat.table?.kind;
  if(kind==='pond-bench')return 16;
  return kind==='sofa'?-12:-5;
}

// One choice drives the on-screen control and the Space key.
export function nearbyUse(scene,position,seats,isOccupied){
  const gate=nearbyPortal(scene,position.x,position.y);
  let choice=gate?{gate}:null;
  let nearest=gate?Math.hypot(gate.x-position.x,gate.y-position.y):Infinity;
  for(const [index,seat] of seats.entries()){
    if(seat.scene && seat.scene!==scene)continue;
    const approach=seatApproach(seat);
    const d=Math.hypot(approach.x-position.x,approach.y-position.y);
    if(d<=88 && d<nearest && !isOccupied(seat,index)){choice={seat,index};nearest=d;}
  }
  return choice;
}

export function friendInReach(scene,position,friend){
  return (friend.scene||'plaza')===scene && Math.hypot(friend.x-position.x,friend.y-position.y)<=58;
}

export function closestFriend(scene, position, players, getPosition) {
  let closest = null, distance = Infinity;
  for (const player of players) {
    const at = getPosition(player);
    if (!at || !friendInReach(scene, position, at)) continue;
    const d = Math.hypot(position.x - at.x, position.y - at.y);
    if (d < distance) { closest = player; distance = d; }
  }
  return closest;
}

export function portalActionLabel(gate){
  return {plaza:'광장 가기',ginkgo:'은행나무길 가기',lounge:'도서관 가기',it:'IT5 가기',it4:'IT4 가기',lecture:'강의실 가기'}[gate.target];
}

// Select by the visible furniture, then navigate to the corresponding aisle.
export function seatAtPoint(scene,x,y){
  let best=null,distance=Infinity;
  for(const item of sceneFurniture(scene)){
    const fromFeet=item.y-y, halfWidth=furnitureWidths[item.kind]/2;
    // The illustration extends above its ground collision box. A round tabletop
    // has a curved crown; the white lecture desk spans nearly its full width.
    const height=furnitureHeights[item.kind], top=height-fromFeet;
    let width=halfWidth;
    if(fromFeet>68){
      if(item.kind==='round-table')width=halfWidth*Math.sqrt(Math.max(0,1-((top-38)/38)**2));
      else if(item.kind==='lecture-desk')width=halfWidth-Math.max(0,10-top/2);
      else width=halfWidth*.88;
    }
    const surface=item.kind==='pond-bench'?pondBenchDistance(item,x,y+14)<=17:
      fromFeet>=-5 && top>=0 && Math.abs(x-item.x)<=width;
    const chairHeight=item.kind==='lecture-desk'?56:47;
    item.seats.forEach((seat,index)=>{
      const d=Math.hypot(x-seat.x,y-(seat.y-13));
      const chair=seat.chair && Math.abs(x-seat.x)<=18 && y>=seat.y-chairHeight && y<=seat.y;
      if((surface || chair || d<=32) && d<distance){
        best={item,index,id:item.id+'-'+(index+1)};distance=d;
      }
    });
  }
  return best;
}
