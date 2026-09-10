/* The skinned-body binding (templeBody.js) on a synthetic Rigify-named
   skeleton, so the world-space delta math is exercised without a GLB:
   after binding, every skin bone must land on its samurai joint in the
   zero pose, in the T-pose calibration templeAnimation.js relies on, and
   when the hips bob. Intermediate segments must follow their base bone. */
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { createSamurai } from '../src/shaders/temple-night/templeSamurai.js';
import { loadBody, BONES, FOLLOW } from '../src/shaders/temple-night/templeBody.js';
globalThis.performance ??= { now: () => Date.now() };
globalThis.window=new EventTarget(); globalThis.document=new EventTarget();

/* an A-posed body, two metres tall, facing +z with its left at +x (as a GLB
   exported from Blender is), so the loader's half turn puts it on the samurai */
const WORLD={ 'DEF-spine':[0,1,0],'DEF-spine.001':[0,1.1,0],'DEF-spine.002':[0,1.22,0],'DEF-spine.003':[0,1.35,0],
  'DEF-spine.004':[0,1.6,0],'DEF-spine.005':[0,1.66,0],'DEF-spine.006':[0,1.72,0] };
const PARENT={ 'DEF-spine.001':'DEF-spine','DEF-spine.002':'DEF-spine.001','DEF-spine.003':'DEF-spine.002','DEF-spine.004':'DEF-spine.003',
  'DEF-spine.005':'DEF-spine.004','DEF-spine.006':'DEF-spine.005' };
for(const [s,x] of [['L',1],['R',-1]]) {
  Object.assign(WORLD,{ [`DEF-shoulder.${s}`]:[x*.05,1.58,0],[`DEF-upper_arm.${s}`]:[x*.2,1.55,0],[`DEF-upper_arm.${s}.001`]:[x*.32,1.42,0],
    [`DEF-forearm.${s}`]:[x*.44,1.29,0],[`DEF-forearm.${s}.001`]:[x*.55,1.16,0],[`DEF-hand.${s}`]:[x*.66,1.03,0],
    [`DEF-thigh.${s}`]:[x*.1,.98,0],[`DEF-thigh.${s}.001`]:[x*.1,.75,0],[`DEF-shin.${s}`]:[x*.1,.52,0],[`DEF-shin.${s}.001`]:[x*.1,.3,0],
    [`DEF-foot.${s}`]:[x*.1,.08,0],[`DEF-toe.${s}`]:[x*.1,.02,.1] });
  Object.assign(PARENT,{ [`DEF-shoulder.${s}`]:'DEF-spine.003',[`DEF-upper_arm.${s}`]:`DEF-shoulder.${s}`,[`DEF-upper_arm.${s}.001`]:`DEF-upper_arm.${s}`,
    [`DEF-forearm.${s}`]:`DEF-upper_arm.${s}.001`,[`DEF-forearm.${s}.001`]:`DEF-forearm.${s}`,[`DEF-hand.${s}`]:`DEF-forearm.${s}.001`,
    [`DEF-thigh.${s}`]:'DEF-spine',[`DEF-thigh.${s}.001`]:`DEF-thigh.${s}`,[`DEF-shin.${s}`]:`DEF-thigh.${s}.001`,[`DEF-shin.${s}.001`]:`DEF-shin.${s}`,
    [`DEF-foot.${s}`]:`DEF-shin.${s}.001`,[`DEF-toe.${s}`]:`DEF-foot.${s}` });
}
function synthetic() {
  const bones={};
  for(const name of Object.keys(WORLD)) { const b=new THREE.Bone(); b.name=name; bones[name]=b; }
  for(const [name,b] of Object.entries(bones)) {
    const p=PARENT[name], w=WORLD[name], pw=p?WORLD[p]:[0,0,0];
    b.position.set(w[0]-pw[0],w[1]-pw[1],w[2]-pw[2]);
    if(p) bones[p].add(b);
  }
  const geometry=new THREE.BoxGeometry(1.4,2,.4); geometry.translate(0,1,0);
  const n=geometry.attributes.position.count;
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(n*4),4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(new Float32Array(n*4).map((_,i)=>i%4===0?1:0),4));
  const material=new THREE.MeshStandardMaterial(); material.name='skin';
  const mesh=new THREE.SkinnedMesh(geometry,material);
  mesh.add(bones['DEF-spine']); mesh.bind(new THREE.Skeleton(Object.values(bones)));
  const scene=new THREE.Group(); scene.add(mesh);
  return { scene, bones };
}

const samurai=createSamurai(); const scene=new THREE.Scene(); scene.add(samurai.group);
samurai.group.position.set(3,0,-2); samurai.group.rotation.y=.7;
const gltf=synthetic();
const body=await loadBody(samurai,{gltf,meta:{},height:1.74});
assert.equal(samurai.bodyMode,'glb'); assert(samurai.skinParts.every(m=>!m.visible),'skin parts hidden');
assert.equal(body.skinnedMeshes.length,1); assert(body.skinnedMeshes[0].frustumCulled===false && body.skinnedMeshes[0].userData.noCollision);
assert.equal(Object.keys(body.bones).length,Object.keys(BONES).length);
assert(Object.values(samurai.joints).every(j=>j.rotation.x===0&&j.rotation.y===0&&j.rotation.z===0),'joints zeroed after binding');
const near=(a,b,eps,msg)=>assert(a.distanceTo(b)<eps,`${msg}: ${a.toArray().map(v=>v.toFixed(3))} vs ${b.toArray().map(v=>v.toFixed(3))}`);
const jw=new THREE.Vector3(), bw=new THREE.Vector3();
const scaled=1.74/2;
assert(Math.abs(samurai.hipY-scaled)<1e-6,`hips refitted to the body: ${samurai.hipY}`);
/* the left is still the samurai's left after the half turn */
samurai.group.updateMatrixWorld(true);
const leftX=samurai.group.worldToLocal(body.bones.leftHand.getWorldPosition(new THREE.Vector3())).x;
assert(leftX<-.3,`left hand bone lies at −x in group space: ${leftX}`);
function check(label,tolerance=2e-3) {
  scene.updateMatrixWorld(true); body.sync(); scene.updateMatrixWorld(true);
  for(const [joint,bone] of Object.entries(body.bones)) {
    samurai.joints[joint].getWorldPosition(jw); bone.getWorldPosition(bw);
    near(bw,jw,tolerance,`${label}: ${joint} bone on its joint`);
    assert(bone.quaternion.toArray().every(Number.isFinite),`${label}: ${joint} finite`);
  }
}
/* zero pose: arms hanging, though the body's rest is an A-pose */
check('zero pose');
/* the T-pose calibration used by templeAnimation.js */
samurai.joints.leftArm.rotation.z=-Math.PI/2; samurai.joints.rightArm.rotation.z=Math.PI/2;
check('T-pose');
samurai.joints.leftHand.getWorldPosition(jw); samurai.joints.leftArm.getWorldPosition(bw);
assert(Math.abs(jw.y-bw.y)<1e-6,'T-pose arm is level');
/* a walking frame from the rig's own cycle, with a hip bob */
samurai.update(1/60,{speed:.6,run:.2,phase:1.3,drawn:true,swing:.4,time:2});
samurai.joints.hips.position.y-=.08;
check('gait frame');
/* intermediate segments follow their base bone; spine.002 sits between its neighbours */
const qa=new THREE.Quaternion(), qb=new THREE.Quaternion();
for(const [name,from,to] of FOLLOW) {
  if(to) continue;
  gltf.bones[name].getWorldQuaternion(qa); body.bones[from].getWorldQuaternion(qb);
  assert(qa.angleTo(qb)<1e-6,`${name} follows ${from}`);
}
gltf.bones['DEF-spine.002'].getWorldQuaternion(qa);
const a=qa.angleTo(body.bones.spine.getWorldQuaternion(new THREE.Quaternion())), b=qa.angleTo(body.bones.chest.getWorldQuaternion(new THREE.Quaternion()));
assert(Math.abs(a-b)<1e-6,`spine.002 is the half-way slerp: ${a} vs ${b}`);
/* toes stay at rest relative to the foot */
assert(gltf.bones['DEF-toe.L'].quaternion.angleTo(new THREE.Quaternion())<1e-9,'toe untouched');
body.dispose();
assert.equal(samurai.bodyMode,'procedural'); assert(samurai.skinParts.every(m=>m.visible),'skin parts restored');
assert(!samurai.group.children.includes(gltf.scene),'body removed');
/* a missing bone names what is available */
await assert.rejects(loadBody(samurai,{gltf:synthetic(),meta:{},bones:{...BONES,head:'DEF-nope'}}),/DEF-nope.*Available:.*DEF-spine\.006/s);
console.log('PASS: body binding: zero pose, T-pose, gait frame with hip bob, follow segments, dispose, bone errors.');
