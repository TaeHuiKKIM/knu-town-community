import assert from 'node:assert/strict';
import test from 'node:test';
import { selectStudentFrame, drawStudentSprite } from '../public/campus/student-motion.js';
import { Avatars } from '../public/campus/avatar.js';
import { STUDENTS } from '../public/campus/sprites/data.js';

const strip = length => Array.from({ length }, (_, x) => ({ x }));
const legacyRows = { idle_east: strip(1), idle_south: strip(1), walk_east: strip(6) };
const rows = { ...legacyRows, wave_south: strip(6), jump_south: strip(6), study_south: strip(4) };
const render = (state, atlas = rows) => selectStudentFrame(atlas, { facing: 'east', ...state });

test('wave uses the six front-facing frames then returns to the current walking row', () => {
  for (let frame = 0; frame < 6; frame++) {
    assert.deepEqual(render({ motion: 'walk', waveAt: 1000, epoch: 1001 + 112 * frame }),
      { pose: 'wave_south', frame, lift: 0 });
  }
  assert.deepEqual(render({ motion: 'walk', waveAt: 1000, epoch: 1667, walkTime: 0.3 }),
    { pose: 'walk_east', frame: 2, lift: 0 });
  assert.equal(render({ waveAt: 1000, epoch: 999 }).pose, 'idle_east');
  assert.deepEqual(render({ waveAt: 1000, epoch: 1200 }, legacyRows),
    { pose: 'idle_south', frame: 0, lift: 0 });
});

test('jump uses its own frames and a bounded lift only during the accepted action', () => {
  const jump = elapsed => render({ jumpAt: 1000, waveAt: 1000, epoch: 1000 + elapsed });
  assert.deepEqual(jump(0), { pose: 'walk_east', frame: 0, lift: 0 });
  assert.deepEqual(jump(275), { pose: 'walk_east', frame: 3, lift: 18 });
  assert.deepEqual(jump(549), { pose: 'walk_east', frame: 5, lift: 0 });
  assert.equal(jump(550).pose, 'wave_south');
  assert.deepEqual(render({ jumpAt: 1000, epoch: 1275 }, legacyRows), { pose: 'walk_east', frame: 3, lift: 18 });
  assert.equal(render({ jumpAt: 1000, epoch: 2000 }).pose, 'idle_east');
});

test('study and displacement take priority, and reduced motion uses stable poses', () => {
  const ongoing = { epoch: 1275, jumpAt: 1000, waveAt: 1000 };
  assert.deepEqual(render({ ...ongoing, bumpUntil: 1280 }), { pose: 'idle_east', frame: 0, lift: 0 });
  assert.deepEqual(render({ ...ongoing, hitAt: 1100 }), { pose: 'idle_east', frame: 0, lift: 0 });
  assert.deepEqual(render({ ...ongoing, studying: true, studyAt: 1000 }),
    { pose: 'study_south', frame: 1, lift: 0 });
  assert.equal(render({ studying: true, studyAt: 1000, epoch: 2500 }).frame, 0);
  assert.equal(render({ studying: true, studyAt: 1000, epoch: 1275, studyPaused: true }).frame, 0);
  assert.equal(render({ studying: true, epoch: 1275 }, legacyRows).pose, 'idle_east');
  const reducedJump = render({ ...ongoing, reduced: true });
  assert.equal(reducedJump.pose, 'walk_east');
  assert.equal(reducedJump.lift, 0);
  assert.deepEqual(render({ ...ongoing, reduced: true, epoch: 1200 }), reducedJump);
  assert.deepEqual(render({ ...ongoing, studying: true, studyAt: 1000, reduced: true }),
    { pose: 'study_south', frame: 0, lift: 0 });
});

test('painting lifts just the full-sized sprite canvas, then resets its transform after action', () => {
  const image = {}, art = new Avatars(), draws = [];
  art.ready = true;
  art.images.set('male/burgundy', image);
  const context = { clearRect() {}, drawImage(...args) { draws.push(args); } };
  const canvas = { dataset: {}, style: {}, getContext() { return context; } };
  const atlas = STUDENTS.male.frame_layout.rows;
  const frame = atlas.jump_south?.[3] || atlas.idle_south[0];
  art.paint(canvas, { jumpAt: 1000, epoch: 1275 });
  assert.equal(canvas.style.translate, '0px -18px');
  assert.deepEqual(draws[0], [image, frame.x, frame.y, frame.w, frame.h, 0, 0, 96, 128]);
  art.paint(canvas, { jumpAt: 1000, epoch: 1275, knockback: true });
  assert.equal(canvas.style.translate, '');
  assert.equal(canvas.dataset.animation, 'idle_south');
});

test('every varsity jump retains its compass direction and lands on the same baseline', () => {
  for (const {frame_layout:{rows}} of Object.values(STUDENTS)) {
    for (const facing of ['north','northeast','east','southeast','south','southwest','west','northwest']) {
      const jump = selectStudentFrame(rows,{facing,jumpAt:1000,epoch:1275});
      assert.ok(jump.pose.endsWith('_'+facing));
      assert.ok(rows[jump.pose][jump.frame]);
      assert.equal(jump.lift,18);
      assert.equal(selectStudentFrame(rows,{facing,jumpAt:1000,epoch:1550}).lift,0);
    }
  }
});

test('greeting keeps crown and soles aligned and restores torso proportions in both avatar sets',()=>{
  for(const [avatar,waist,width] of [['male',76,115.2],['female',73,107.52]]){
    const calls=[];
    const ctx={drawImage(...args){calls.push(args);}};
    drawStudentSprite(ctx,{}, {x:96,y:384,w:96,h:128}, {avatar,pose:'wave_south'});
    const torso=calls.find(c=>c[2]===392);
    assert.ok(Math.abs(torso[7]-width)<.001);
    assert.equal(torso[6],8);
    assert.equal(torso[6]+torso[8],waist);
    assert.equal(calls.at(-1)[6],120);
    assert.equal(torso[5]+torso[7]/2,48);
  }
});
