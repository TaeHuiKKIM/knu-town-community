import assert from 'node:assert/strict';
import test from 'node:test';
import * as world from '../public/campus/world.js';
import {latestSender} from '../public/campus/network.js';

test('physical game keys work with a Korean layout, while native shortcuts and text composition pass through', () => {
  for (const [code, key, expected] of [['KeyW','ㅈ','w'],['KeyA','ㅁ','a'],['KeyS','ㄴ','s'],['KeyD','ㅇ','d'],['Space','Process',' ']]) {
    assert.equal(world.campusKey({code,key,keyCode:229}),expected);
    assert.equal(world.campusKey({code,key,isComposing:true}),null);
    assert.equal(world.campusKey({code,key,ctrlKey:true}),null);
  }
  assert.equal(world.campusKey({code:'KeyW',key:'ㅈ',target:{isContentEditable:true}}),null);
  assert.equal(world.campusKey({code:'Space',key:' ',target:{tagName:'TEXTAREA'}}),null);
  assert.equal(world.campusKey({key:'ArrowLeft'}),'arrowleft');
});

test('the seat claim can wait until earlier movement has finished', async () => {
  let finish;
  const moves=[];
  const queue=latestSender(async value=>{moves.push(value); if(value===1) await new Promise(resolve=>{finish=resolve;});});
  queue.push(1);queue.push(2);
  let idle=false;
  const waiting=queue.whenIdle().then(()=>{idle=true;});
  await Promise.resolve();
  assert.equal(idle,false);
  finish();
  await waiting;
  assert.deepEqual(moves,[1,2]);
});
