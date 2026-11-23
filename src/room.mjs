import { seats } from './seats.mjs';
export class Room {
  constructor({code,name='일청담 광장',capacity=8,mode='free',isMain=false,study=null,now=Date.now,metrics,batch=false}){
    Object.assign(this,{code,name,capacity,mode,isMain,study,now,metrics,batch});this.players=new Map();this.joins=new Map();this.streams=new Map();this.messages=[];this.impacts=[];this.dirty=false;
    this.movers = new Set();
    this.rosterDirty = false;
  }
  info(){return {code:this.code,name:this.name,capacity:this.capacity,mode:this.mode,isMain:this.isMain,online:this.players.size};}
  snapshot(){return {pondSeating:true,at:this.now(),capacity:this.capacity,seats,room:this.info(),players:[...this.players.values()].map(({session,joinKey,lastSeen,lastChat,...p})=>{const study=this.study?.publicStudy(p.profileId);return this.study?{...p,study,focusSince:study?.startedAt??p.focusSince}:p;}),messages:this.messages,impacts:this.impacts};}
  broadcast({movement=false, player, membership=false}={}){
    if(membership && this.batch && this.isMain && this.players.size>=24){this.rosterDirty=true;return;}
    if(movement&&this.batch){this.dirty=true;this.movers.add(player);return;}
    this.send(movement);
    this.movers.clear();
    this.dirty=false;
    this.rosterDirty=false;
  }
  movementPatch(){
    const at=this.now(), moves=[];
    let index=0;
    for(const player of this.players.values()){
      if(this.movers.has(player)){
        const {x,y,facing,motion,movedAt,crouch}=player.campus;
        moves.push([index,x,y,facing,motion,at-movedAt,!!crouch,player.focusedMs]);
      }
      index++;
    }
    return {at,moves};
  }
  send(movement=false){
    if(!this.streams.size)return;
    let full, patch;
    const frame=data=>{const event='data: '+JSON.stringify(data)+'\n\n';return {event,bytes:Buffer.byteLength(event)};};
    if(movement)this.metrics.movementBroadcasts++;
    for(const res of this.streams.values()){
      if(res.destroyed||movement&&res.studyOnly)continue;
      this.metrics.maxBufferedBytes=Math.max(this.metrics.maxBufferedBytes,res.writableLength);
      if(res.writableLength>131072){res.destroy();continue;}
      const packet=movement&&res.compactMoves ? (patch??=frame(this.movementPatch())) : (full??=frame(this.snapshot()));
      res.write(packet.event);this.metrics.framesSent++;this.metrics.bytesSent+=packet.bytes;
    }
  }
  flush(){
    if(this.rosterDirty){this.broadcast();return;}
    if(this.dirty){this.dirty=false;this.send(true);this.movers.clear();}
  }
  remove(session){const p=this.players.get(session);if(p?.joinKey)this.joins.delete(p.joinKey);this.streams.get(session)?.end();this.streams.delete(session);this.players.delete(session);}
  close(){for(const res of this.streams.values())res.end();this.streams.clear();}
}
