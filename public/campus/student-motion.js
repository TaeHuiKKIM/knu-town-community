import { normalizeDirection } from './world.js';

export const STUDENT_ACTION = Object.freeze({ waveDuration: 667, jumpDuration: 550, jumpCooldown: 800, jumpHeight: 18 });

export function actionInProgress(at, epoch, duration) {
  return at > 0 && epoch >= at && epoch - at < duration;
}

export function selectStudentFrame(rows, {
  facing = 'south', motion = 'idle', walkTime = 0, waveAt = 0, jumpAt = 0, hitAt = 0, bumpUntil = 0,
  knockback = false, studying = false, studyAt = 0, studyPaused = false, epoch = 0, reduced = false
} = {}) {
  const direction = normalizeDirection(facing), idle = { pose: `idle_${direction}`, frame: 0, lift: 0 };
  if (knockback || epoch < bumpUntil) return idle;

  if (studying) {
    const frames = rows.study_south;
    if (!frames?.length) return idle;
    const phase = Math.max(0, epoch - studyAt) % 5200;
    const reading = !reduced && !studyPaused && phase < frames.length * 250;
    return { pose: 'study_south', frame: reading ? Math.floor(phase / 250) : 0, lift: 0 };
  }

  if (jumpAt > hitAt && actionInProgress(jumpAt, epoch, STUDENT_ACTION.jumpDuration)) {
    const elapsed = epoch - jumpAt, progress = elapsed / STUDENT_ACTION.jumpDuration;
    const lift = reduced ? 0 : Math.round(STUDENT_ACTION.jumpHeight * 4 * progress * (1 - progress));
    const pose = rows[`jump_${direction}`]?.length ? `jump_${direction}` : `walk_${direction}`;
    const frames = rows[pose];
    if (!frames?.length) return { ...idle, lift };
    const frame = reduced ? Math.floor(frames.length / 2) : Math.min(frames.length - 1, Math.floor(elapsed * 11 / 1000));
    return { pose, frame, lift };
  }

  if (waveAt > hitAt && actionInProgress(waveAt, epoch, STUDENT_ACTION.waveDuration)) {
    const frames = rows.wave_south;
    if (!frames?.length) return { pose: 'idle_south', frame: 0, lift: 0 };
    const frame = reduced ? Math.floor(frames.length / 2) : Math.min(frames.length - 1, Math.floor((epoch - waveAt) * 9 / 1000));
    return { pose: 'wave_south', frame, lift: 0 };
  }

  if (motion === 'idle') return idle;
  const pose = `walk_${direction}`;
  return { pose, frame: Math.floor(walkTime * 9) % rows[pose].length, lift: 0 };
}

// Native student frames are 96 by 128. The ground point stays fixed across poses.
export const CAMPUS_SPRITE_SCALE = 1.06;
export function poseInset(crouch, seated) {
  return seated ? 21 * seated : crouch ? 32 : 0;
}

// The wave artwork has a narrower head and a higher waist than its idle reference.
// Keep the crown (row 8) and soles (row 120) fixed when matching those proportions.
const WAVE_FIT = {
  male: { width: 1.20, waist: 68, idleWaist: 76 },
  female: { width: 1.12, waist: 68, idleWaist: 73 },
};
const crown = 8, soles = 120;
function waveY(y, fromWaist, toWaist) {
  if (y <= crown || y >= soles) return y;
  if (y <= fromWaist) return crown + (y - crown) * (toWaist - crown) / (fromWaist - crown);
  return soles - (soles - y) * (soles - toWaist) / (soles - fromWaist);
}

export function drawStudentSprite(ctx, img, frame, { avatar, pose, crouch = false, seated = 0, x = 48, feet = 128, scale = 1 }) {
  const {x:sx, y:sy, w, h} = frame;
  const fit = pose === 'wave_south' ? WAVE_FIT[avatar] : null;
  const width = w * (fit?.width ?? 1) * scale;
  const left = x - width / 2, top = feet - h * scale;
  const inset = poseInset(crouch, seated);
  if (!inset && !fit) {
    ctx.drawImage(img, sx, sy, w, h, left, top, width, h * scale);
    return;
  }

  // Bend the lower body while preserving the size of the head and shoulders.
  const joint = Math.round(h * (seated ? .69 : .57));
  const cuts = fit ? [crown, fit.waist, soles] : [];
  // In profile the knees move towards the front edge while the hips stay on the seat.
  const forward=pose.endsWith('east')?1:pose.endsWith('west')?-1:0;
  const knee=Math.round(h*.83), reach=forward*seated*(pose==='idle_east'||pose==='idle_west'?12:8)*scale;
  const kneeOffset=row=>reach*Math.min(1,Math.max(0,(row-joint)/(knee-joint)));
  if(reach)cuts.push(knee);
  if (inset) cuts.push(fit ? Math.round(waveY(joint, fit.idleWaist, fit.waist)) : joint);
  cuts.sort((a,b) => a-b);
  cuts.push(h);
  let from = 0, y = top + inset * scale;
  for (const to of cuts) {
    if (to <= from) continue;
    const row = fit ? waveY(to, fit.waist, fit.idleWaist) : to;
    const bent = row <= joint ? row + inset : h - (h-row) * (h-joint-inset)/(h-joint);
    const end = top + bent * scale;
    const startX=reach?kneeOffset(from):0, endX=reach?kneeOffset(to):0;
    if(startX!==endX){
      ctx.save();
      ctx.translate(left+startX,y);
      ctx.transform(1,0,(endX-startX)/(end-y),1,0,0);
      ctx.drawImage(img,sx,sy+from,w,to-from,0,0,width,end-y);
      ctx.restore();
    }else ctx.drawImage(img,sx,sy+from,w,to-from,left+startX,y,width,end-y);
    from = to; y = end;
  }
}
