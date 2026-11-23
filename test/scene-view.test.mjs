import test from 'node:test';
import assert from 'node:assert/strict';
import {SceneView,ImageCache} from '../public/campus/scene-view.js';

test('a new participant can move while an old scene image is pending; old completion cannot clear a newer transition',async()=>{
  const oldDocument=globalThis.document,fields=new Map();globalThis.document={getElementById(id){if(!fields.has(id))fields.set(id,{close(){}});return fields.get(id);}};
  try{
    const pending=new Map(),sent=[],view=Object.create(SceneView.prototype);
    Object.assign(view,{current:'plaza',ready:true,busy:false,travelVersion:0,room:{me:{id:'A'},online:true,send:async data=>sent.push(data)},canTravel:()=>true,toast(){},sync(){},images:{load:url=>new Promise(resolve=>pending.set(url,resolve))}});
    const first=view.travel('ginkgo');assert.equal(view.busy,true);view.room.me={id:'B'};view.reset();assert.equal(view.busy,false);
    const second=view.travel('lounge');pending.get('/campus/assets/ginkgo-walk-v2.png')({});await first;
    assert.equal(view.busy,true,'old completion must not unlock the new request');
    pending.get('/campus/assets/library-lounge-v2.png')({});await second;
    assert.deepEqual(sent,[{type:'scene',scene:'lounge'}]);assert.equal(view.busy,false);
  }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});

test('a stalled image times out, leaves the cache, and a retry can load successfully',async()=>{
  const created=[],cache=new ImageCache(()=>{const img={};created.push(img);return img;},15);
  const failed=cache.load('map.png');assert.equal(cache.load('map.png'),failed);
  await assert.rejects(failed,/배경/);
  const retry=cache.load('map.png');assert.equal(created.length,2);created[1].onload();assert.equal(await retry,created[1]);
});
test('the scene cache waits for decoded pixels, limits speculation to one image and evicts old entries',async()=>{
  const made=[];
  const cache=new ImageCache(()=>{const image={};made.push(image);return image;},1500,2);
  cache.warm('lounge');cache.warm('lecture');
  assert.equal(made.length,1);
  let decode,finished=false;
  made[0].decode=()=>new Promise(resolve=>{decode=resolve;});
  const first=cache.load('lounge').then(()=>{finished=true;});made[0].onload();
  await Promise.resolve();assert.equal(finished,false);
  decode();await first;
  for(const id of ['it','it4']){const item=cache.load(id);made.at(-1).onload();await item;}
  assert.equal(cache.pending.has('lounge'),false);
  const broken=cache.load('lecture');made.at(-1).decode=()=>Promise.reject(Error('decode'));
  made.at(-1).onload();await assert.rejects(broken,/배경/);
  const recovered=cache.load('lecture');made.at(-1).onload();await recovered;
});
