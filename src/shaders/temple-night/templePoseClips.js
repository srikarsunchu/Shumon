import * as THREE from 'three';

/* ===================================================== pose clips
   Key poses authored on open-media's mannequin, played back on the samurai
   rig. Pure: plain clip objects in, joint rotations out. No fetch, no DOM,
   so the Node tests can drive it with a synthetic clip.

   A clip (public/anim/clips/<name>.json, schema in the plan):
     { version:1, name, duration, loop, mask,
       rest:  { forward:[x,y,z], height, joints:{ hips:{q:[x,y,z,w], p:[x,y,z]}, ... } },
       keys:  [{ time, label?, joints:{...} }],
       events:[{ time, name, value }] }

   Sixteen joints (no chest; the chest takes the spine's turn). Rotations
   are the mannequin's joint orientations in its figure frame, so every key
   is reduced to a world-space delta from the mannequin's own rest, after a
   yaw C that turns the mannequin's forward onto the samurai's −z:

     delta = C · q_key · (C · q_rest)⁻¹

   and applied as  jointWorld = rootQ · delta · samuraiRest, written into the
   joint through its parent's inverse. The samurai's rest is its zero pose
   (arms hanging), which is also mannequin-js's zero, so identical poses
   give identity deltas. */

export const CLIP_JOINTS = ['hips', 'spine', 'neck', 'head', 'leftArm', 'leftForearm', 'leftHand',
  'rightArm', 'rightForearm', 'rightHand', 'leftThigh', 'leftShin', 'leftFoot', 'rightThigh', 'rightShin', 'rightFoot'];
const ORDER = ['hips', 'spine', 'chest', 'neck', 'head', 'leftArm', 'leftForearm', 'leftHand', 'rightArm', 'rightForearm',
  'rightHand', 'leftThigh', 'leftShin', 'leftFoot', 'rightThigh', 'rightShin', 'rightFoot'];
const ARM_L = ['leftArm', 'leftForearm', 'leftHand'], ARM_R = ['rightArm', 'rightForearm', 'rightHand'];
export const MASKS = {
  full: ORDER,
  upper: ['spine', 'chest', 'neck', 'head', ...ARM_L, ...ARM_R],
  lower: ['hips', 'leftThigh', 'leftShin', 'leftFoot', 'rightThigh', 'rightShin', 'rightFoot'],
  leftArm: ARM_L, rightArm: ARM_R, arms: [...ARM_L, ...ARM_R],
};
const maskSet = m => new Set(Array.isArray(m) ? m : (MASKS[m] || MASKS.full));
const ease = u => .5 - .5 * Math.cos(Math.PI * u);           /* open-media's sampleTrack easing */
const UP = new THREE.Vector3(0, 1, 0);

/* the yaw that turns the clip's forward onto (0,0,−1) */
function calibration(forward) {
  const f = Array.isArray(forward) ? forward : [0, 0, -1];
  const C = new THREE.Quaternion();
  if (Math.hypot(f[0], f[2]) < 1e-6) return C;
  return C.setFromAxisAngle(UP, Math.PI - Math.atan2(f[0], f[2]));
}

function compile(name, clip, height) {
  const C = calibration(clip.rest && clip.rest.forward);
  const restJ = (clip.rest && clip.rest.joints) || {};
  const ratio = clip.rest && clip.rest.height > 0 ? height / clip.rest.height : 1;
  const restInv = {};
  for (const j of CLIP_JOINTS) {
    if (restJ[j] && restJ[j].q) restInv[j] = C.clone().multiply(new THREE.Quaternion().fromArray(restJ[j].q)).invert();
  }
  const restHipY = restJ.hips && restJ.hips.p ? restJ.hips.p[1] : 0;
  const keys = [...(clip.keys || [])].sort((a, b) => a.time - b.time).map(k => {
    const deltas = {};
    for (const j of CLIP_JOINTS) {
      const kj = k.joints && k.joints[j];
      if (!kj || !kj.q || !restInv[j]) continue;
      deltas[j] = C.clone().multiply(new THREE.Quaternion().fromArray(kj.q)).multiply(restInv[j]).normalize();
    }
    const hipY = k.joints && k.joints.hips && k.joints.hips.p ? (k.joints.hips.p[1] - restHipY) * ratio : 0;
    return { time: k.time, deltas, hipY };
  });
  const scratch = { deltas: {}, hipY: 0 };
  for (const j of CLIP_JOINTS) if (keys.some(k => k.deltas[j])) scratch.deltas[j] = new THREE.Quaternion();
  return {
    name, keys, scratch,
    duration: clip.duration > 0 ? clip.duration : (keys.length ? keys[keys.length - 1].time : 0),
    loop: !!clip.loop, mask: clip.mask || 'full',
    events: [...(clip.events || [])].sort((a, b) => a.time - b.time),
  };
}

export function createPoseClips(samurai, clipsByName) {
  const joints = samurai.joints, group = samurai.group;
  /* the samurai's rest: every joint's orientation in the root frame at the zero pose */
  const saved = ORDER.map(n => joints[n].quaternion.clone());
  ORDER.forEach(n => joints[n].quaternion.identity());
  group.updateMatrixWorld(true);
  const rootQ = group.getWorldQuaternion(new THREE.Quaternion()), rootInv = rootQ.clone().invert();
  const rest = Object.fromEntries(ORDER.map(n => [n, joints[n].getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv)]));
  ORDER.forEach((n, i) => joints[n].quaternion.copy(saved[i]));
  group.updateMatrixWorld(true);

  const clips = {};
  for (const [name, clip] of Object.entries(clipsByName || {})) if (clip && clip.keys) clips[name] = compile(name, clip, samurai.height || 1.74);

  function localTime(clip, t) {
    const d = clip.duration;
    if (!(d > 0)) return 0;
    if (clip.loop) { t = t % d; if (t < 0) t += d; return t; }
    return t < 0 ? 0 : (t > d ? d : t);
  }
  /* the pose at t: a key, or the eased slerp between two, wrapping when looped */
  function sample(name, t) {
    const clip = clips[name];
    if (!clip || !clip.keys.length) return null;
    const keys = clip.keys, s = clip.scratch, tl = localTime(clip, t);
    let a = keys[0], b = null, k = 0;
    if (keys.length > 1 && tl > keys[0].time) {
      const last = keys[keys.length - 1];
      if (tl >= last.time) {
        a = last;
        if (clip.loop && clip.duration > last.time) { b = keys[0]; k = ease((tl - last.time) / (clip.duration - last.time)); }
      } else {
        let i = 0; while (tl >= keys[i + 1].time) i++;
        a = keys[i]; b = keys[i + 1];
        const span = b.time - a.time; k = span > 0 ? ease((tl - a.time) / span) : 0;
      }
    }
    for (const j in s.deltas) {
      const qa = a.deltas[j] || (b && b.deltas[j]), qb = b ? (b.deltas[j] || qa) : null;
      if (!qa) { s.deltas[j].identity(); continue; }
      s.deltas[j].copy(qa); if (qb && k > 0) s.deltas[j].slerp(qb, k);
    }
    s.hipY = b ? a.hipY + (b.hipY - a.hipY) * k : a.hipY;
    return s;
  }
  const target = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  /* turn the masked joints toward the clip's pose by weight (1 = snap) */
  function apply(name, t, weight, mask) {
    const clip = clips[name];
    if (!clip || !(weight > 0)) return false;
    const s = sample(name, t);
    if (!s) return false;
    const w = weight > 1 ? 1 : weight, set = maskSet(mask || clip.mask);
    group.getWorldQuaternion(rootQ);
    for (const n of ORDER) {
      if (!set.has(n)) continue;
      const delta = n === 'chest' ? s.deltas.spine : s.deltas[n];
      if (!delta) continue;
      const joint = joints[n];
      target.copy(rootQ).multiply(delta).multiply(rest[n]);
      joint.parent.getWorldQuaternion(parentQ).invert();
      joint.quaternion.slerp(parentQ.multiply(target), w);
      joint.updateMatrix();
    }
    if (set.has('hips') && s.deltas.hips) joints.hips.position.y += s.hipY * w;
    return true;
  }
  /* the latest value an event has taken by t, or undefined before its first */
  function event(name, eventName, t) {
    const clip = clips[name];
    if (!clip) return undefined;
    const tl = localTime(clip, t);
    let value;
    for (const e of clip.events) { if (e.name === eventName && e.time <= tl) value = e.value; }
    return value;
  }
  return {
    apply, sample, event,
    has: name => !!clips[name],
    duration: name => clips[name] ? clips[name].duration : 0,
    get names() { return Object.keys(clips); },
    rest, calibration,
  };
}
