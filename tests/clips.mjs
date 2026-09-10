/* Pose clips on the rig, under the same Node stub as tests/gameplay.mjs.
   1. A synthetic in-memory clip pins the delta math down without any files.
   2. Every authored clip in public/anim/clips is applied at weight 1 and 0. */
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSamurai } from '../src/shaders/temple-night/templeSamurai.js';
import { createPoseClips, CLIP_JOINTS } from '../src/shaders/temple-night/templePoseClips.js';
globalThis.performance ??= { now: () => Date.now() };
globalThis.window=new EventTarget(); globalThis.document=new EventTarget();

const JOINTS=['hips','spine','chest','neck','head','leftArm','leftForearm','leftHand','rightArm','rightForearm','rightHand',
  'leftThigh','leftShin','leftFoot','rightThigh','rightShin','rightFoot'];
const near=(a,b,eps,msg)=>assert(Math.abs(a-b)<eps,`${msg}: ${a} vs ${b}`);
const nearQ=(q,e,msg)=>{ const d=Math.min(q.angleTo(e),Math.PI); assert(d<1e-4,`${msg}: ${q.toArray().map(v=>v.toFixed(4))} vs ${e.toArray().map(v=>v.toFixed(4))} (angle ${d})`); };
const snapshot=s=>JOINTS.map(n=>s.joints[n].quaternion.clone());
const finiteJoints=s=>JOINTS.every(n=>s.joints[n].quaternion.toArray().every(Number.isFinite));

/* ---- 1. synthetic clip -------------------------------------------------
   The mannequin faces +z, the samurai faces −z, so the calibration C is a
   half turn about y. A key rotation about the mannequin's x must come out
   about −x on the samurai: C·R_x(θ)·C⁻¹ = R_x(−θ). The spine's turn must be
   carried by the chest (identity local), the hips must drop by the key's
   height loss scaled by 1.74 / rest.height, and weight scales the slerp. */
{
  const theta=.7, phi=.4;
  const X=new THREE.Vector3(1,0,0), Z=new THREE.Vector3(0,0,1);
  const id={q:[0,0,0,1],p:[0,0,0]};
  const rest={ forward:[0,0,1], height:2, joints:Object.fromEntries(CLIP_JOINTS.map(j=>[j,j==='hips'?{q:[0,0,0,1],p:[0,1,0]}:id])) };
  const key=(time,over)=>({time,joints:{...rest.joints,...over}});
  const single={ version:1,name:'synthetic',duration:1,loop:false,mask:'full',rest,
    keys:[key(0,{leftArm:{q:new THREE.Quaternion().setFromAxisAngle(X,theta).toArray(),p:[0,0,0]},
      spine:{q:new THREE.Quaternion().setFromAxisAngle(Z,phi).toArray(),p:[0,0,0]},hips:{q:[0,0,0,1],p:[0,.9,0]}})],
    events:[{time:.45,name:'katanaInHand',value:true}] };
  const looped={ version:1,name:'looped',duration:2,loop:true,mask:'leftArm',rest,
    keys:[key(0,{}),key(1,{leftArm:{q:new THREE.Quaternion().setFromAxisAngle(X,theta).toArray(),p:[0,0,0]}})] };
  const samurai=createSamurai(); samurai.group.rotation.y=.9; samurai.group.updateMatrixWorld(true);
  const clips=createPoseClips(samurai,{single,looped,broken:null});
  assert.deepEqual(clips.names.sort(),['looped','single']); assert(clips.has('single') && !clips.has('broken'));
  const hipRest=samurai.joints.hips.position.y, before=snapshot(samurai);
  assert.equal(clips.apply('single',0,0,'full'),false,'weight 0 applies nothing');
  JOINTS.forEach((n,i)=>nearQ(samurai.joints[n].quaternion,before[i],`weight 0 leaves ${n}`));
  near(samurai.joints.hips.position.y,hipRest,1e-9,'weight 0 leaves the hips');
  assert.equal(clips.apply('single',0,1,'full'),true);
  /* clip orientations are world-frame, so they are checked in the root
     frame: the group's own yaw must not leak in, and the arm must reach
     R_x(−θ) even though its parent chain (the spine) has turned by φ */
  const rootFrame=n=>samurai.joints[n].getWorldQuaternion(new THREE.Quaternion()).premultiply(samurai.group.getWorldQuaternion(new THREE.Quaternion()).invert());
  nearQ(rootFrame('leftArm'),new THREE.Quaternion().setFromAxisAngle(X,-theta),'C mirrors the x axis');
  nearQ(samurai.joints.leftArm.quaternion,new THREE.Quaternion().setFromAxisAngle(Z,phi).multiply(new THREE.Quaternion().setFromAxisAngle(X,-theta)),'local arm = parent⁻¹ · world');
  nearQ(samurai.joints.spine.quaternion,new THREE.Quaternion().setFromAxisAngle(Z,-phi),'spine takes its own delta');
  nearQ(samurai.joints.chest.quaternion,new THREE.Quaternion(),'chest carries the spine turn without adding to it');
  nearQ(rootFrame('rightArm'),new THREE.Quaternion(),'a joint keyed at rest holds its world orientation against the spine turn');
  near(samurai.joints.hips.position.y,hipRest-.1*1.74/2,1e-9,'hip drop scaled by height ratio');
  samurai.joints.hips.position.y=hipRest;
  /* masks and partial weight */
  JOINTS.forEach(n=>samurai.joints[n].quaternion.identity());
  clips.apply('single',0,.5,'leftArm');
  nearQ(samurai.joints.leftArm.quaternion,new THREE.Quaternion().setFromAxisAngle(X,-theta/2),'weight .5 is half the turn');
  nearQ(samurai.joints.spine.quaternion,new THREE.Quaternion(),'leftArm mask leaves the spine');
  JOINTS.forEach(n=>samurai.joints[n].quaternion.identity());
  clips.apply('single',0,1,'upper');
  near(samurai.joints.hips.position.y,hipRest,1e-9,'upper mask leaves the hips');
  JOINTS.forEach(n=>samurai.joints[n].quaternion.identity());
  clips.apply('single',0,1,'rightArm');
  nearQ(samurai.joints.leftArm.quaternion,new THREE.Quaternion(),'rightArm mask leaves the left arm');
  /* events step, loop wrap, cosine ease at the midpoint */
  assert.equal(clips.event('single','katanaInHand',.3),undefined); assert.equal(clips.event('single','katanaInHand',.5),true);
  assert.equal(clips.event('single','nothing',.5),undefined); assert.equal(clips.event('missing','katanaInHand',.5),undefined);
  const half=new THREE.Quaternion().setFromAxisAngle(X,-theta/2);
  for(const t of [.5,2.5,-1.5,1.5]) { JOINTS.forEach(n=>samurai.joints[n].quaternion.identity()); clips.apply('looped',t,1); nearQ(samurai.joints.leftArm.quaternion,half,`loop sample at t=${t}`); }
  JOINTS.forEach(n=>samurai.joints[n].quaternion.identity()); clips.apply('looped',1,1);
  nearQ(samurai.joints.leftArm.quaternion,new THREE.Quaternion().setFromAxisAngle(X,-theta),'exact key time');
  near(clips.duration('looped'),2,1e-9,'duration'); near(clips.duration('missing'),0,1e-9,'missing duration');
  assert.equal(clips.apply('missing',0,1),false);
  console.log('PASS: synthetic clip: yaw calibration, chest carry, hip scaling, weight, masks, events, loop wrap.');
}

/* ---- 2. authored clips ------------------------------------------------- */
{
  const dir=fileURLToPath(new URL('../public/anim/clips/',import.meta.url));
  const files=existsSync(dir)?readdirSync(dir).filter(f=>f.endsWith('.json')).sort():[];
  if(!files.length) console.log('NOTICE: no authored clips in public/anim/clips; synthetic coverage only.');
  else {
    const clipsByName=Object.fromEntries(files.map(f=>[f.replace(/\.json$/,''),JSON.parse(readFileSync(join(dir,f),'utf8'))]));
    const samurai=createSamurai(); const clips=createPoseClips(samurai,clipsByName);
    const hipRest=samurai.joints.hips.position.y;
    for(const name of Object.keys(clipsByName)) {
      assert(clips.has(name),`${name} compiled`);
      const before=snapshot(samurai);
      clips.apply(name,.3,0); JOINTS.forEach((n,i)=>nearQ(samurai.joints[n].quaternion,before[i],`${name}: weight 0 leaves ${n}`));
      near(samurai.joints.hips.position.y,hipRest,1e-9,`${name}: weight 0 leaves the hips`);
      const d=clips.duration(name);
      for(const t of [0,d/3,2*d/3,d,d*1.5]) {
        JOINTS.forEach(n=>samurai.joints[n].quaternion.identity()); samurai.joints.hips.position.y=hipRest;
        assert.equal(clips.apply(name,t,1),true,`${name}: applies at t=${t}`);
        assert(finiteJoints(samurai),`${name}: finite quaternions at t=${t}`);
        near(samurai.joints.hips.position.y,hipRest,.25,`${name}: hips within ±.25 of rest at t=${t}`);
      }
      JOINTS.forEach(n=>samurai.joints[n].quaternion.identity()); samurai.joints.hips.position.y=hipRest;
    }
    console.log(`PASS: ${files.length} authored clips apply at weight 1 and 0.`);
  }
}
