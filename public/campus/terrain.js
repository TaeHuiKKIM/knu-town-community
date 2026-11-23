// Foot positions, not character artwork bounds, define the walkable ground.
export function inPolygon(x,y,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
  const [ax,ay]=points[j],[bx,by]=points[i],cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax);
  if(Math.abs(cross)<1e-6&&x>=Math.min(ax,bx)&&x<=Math.max(ax,bx)&&y>=Math.min(ay,by)&&y<=Math.max(ay,by))return true;
  if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
}return inside;}
function edgeDistance(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);}
const floorBounds=new WeakMap();
function floorsFor(scene){
  let bounds=floorBounds.get(scene);
  if(!bounds){
    bounds=scene.floors.map(points=>{
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      return {points,left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
    });
    floorBounds.set(scene,bounds);
  }
  return bounds;
}
export function canStand(scene,x,y){
  if(!scene||!Number.isFinite(x)||!Number.isFinite(y)||!floorsFor(scene).some(r=>x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom&&inPolygon(x,y,r.points)))return false;
  for(const obstacle of scene.obstacles){
    if(obstacle.circle){const [cx,cy,r]=obstacle.circle;if(Math.hypot(x-cx,y-cy)<=r+7)return false;}
    if(obstacle.polygon){const p=obstacle.polygon;if(inPolygon(x,y,p)||p.some((a,i)=>edgeDistance(x,y,a,p[(i+1)%p.length])<7))return false;}
  }return true;
}

// Search on a destination request. Ordinary walking keeps its existing per-frame collision check.
export function walkingRoute(start, goal, canWalk) {
  if(!canWalk(goal.x,goal.y))return [];
  function clear(a, b) {
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    const steps=Math.max(1,Math.ceil(length));
    const sideX=-dy/(length||1),sideY=dx/(length||1);
    for(let i=1;i<=steps;i++){
      const x=a.x+(b.x-a.x)*i/steps,y=a.y+(b.y-a.y)*i/steps;
      if(!canWalk(x,y))return false;
      // Leave a pixel of clearance on turns so a simulation step cannot catch
      // a chair leg or a corner between navigation samples.
      if(i<steps && (!canWalk(x+sideX,y+sideY)||!canWalk(x-sideX,y-sideY)))return false;
    }
    return true;
  }
  function search(stride){
    const queue=[{x:start.x,y:start.y,previous:null}], seen=new Set([start.x+','+start.y]);
    const directions=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
    for(let i=0;i<queue.length;i++){
      const point=queue[i];
      if((i===0 || Math.hypot(point.x-goal.x,point.y-goal.y)<75) && clear(point,goal)){
        const path=[goal];
        for(let at=point;at.previous;at=at.previous)path.push({x:at.x,y:at.y});
        path.reverse();
        const turns=[];
        let anchor=start;
        for(let j=0;j<path.length;){
          let end=j;
          while(end+1<path.length && clear(anchor,path[end+1]))end++;
          anchor=path[end];turns.push(anchor);j=end+1;
        }
        return turns;
      }
      for(const [dx,dy] of directions){
        const next={x:point.x+dx*stride,y:point.y+dy*stride,previous:point}, key=Math.round(next.x)+','+Math.round(next.y);
        if(seen.has(key)||!clear(point,next))continue;
        seen.add(key);queue.push(next);
      }
    }
    return null;
  }
  // A narrow path around a fixed prop can fall between the coarse grid points.
  return search(24) ?? search(12) ?? [];
}
