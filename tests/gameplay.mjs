import * as THREE from 'three';
import assert from 'node:assert/strict';
import { createTempleGameplay } from '../src/shaders/temple-night/templeGameplay.js';
globalThis.performance ??= { now: () => Date.now() };
globalThis.window=new EventTarget(); window.performance=globalThis.performance; globalThis.document=new EventTarget();
document.pointerLockElement=null; document.hidden=false;
const canvas=new EventTarget(); canvas.requestPointerLock=()=>Promise.resolve();
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera();
const mat=new THREE.MeshStandardMaterial();
const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),mat); floor.rotation.x=-Math.PI/2; scene.add(floor);
for(let i=0;i<40;i++) { const h=(i+1)*.175; const s=new THREE.Mesh(new THREE.BoxGeometry(8.4,h,.55),mat); s.position.set(0,h/2,-11-(i+.5)*.55); scene.add(s); }
const platform=new THREE.Mesh(new THREE.BoxGeometry(42,7,24),mat); platform.position.set(0,3.5,-45); scene.add(platform);
const wall=new THREE.Mesh(new THREE.BoxGeometry(1,5,100),mat); wall.position.set(10,2.5,0); scene.add(wall);
const game=createTempleGameplay({scene,camera,canvas}); const player=scene.getObjectByName('Playable wanderer');
await game.ready;
let state; game.subscribe(s=>state=s); game.start(); game.setKey('KeyW',true);
for(let i=0;i<60;i++) game.update(1/60);
const release=player.position.clone(); game.setKey('KeyW',false);
for(let i=0;i<12;i++) game.update(1/60);
const braking=player.position.distanceTo(release);
assert(braking>.05 && braking<.3, `Controlled braking step: ${braking}`);
for(let i=0;i<60;i++) game.update(1/60);
const stopped=player.position.clone();
for(let i=0;i<60;i++) game.update(1/60);
assert(player.position.distanceTo(stopped)<.01,`No idle drift: ${player.position.distanceTo(stopped)}`);
game.setKey('KeyW',true);
for(let i=0;i<1050;i++) game.update(1/60);
assert(player.position.y>6.9,`Expected summit, got ${player.position.toArray()}`);
assert(player.position.z < -33);
game.setKey('KeyW',false); game.setKey('KeyS',true);
for(let i=0;i<1050;i++) game.update(1/60);
assert(player.position.y<.1,'Descends stairs');
game.setKey('KeyS',false); game.setKey('KeyD',true);
for(let i=0;i<600;i++) game.update(1/60);
assert(player.position.x>9 && player.position.x<9.5,'Stops before wall');
game.attack(); assert.equal(state.drawn,true); for(let i=0;i<100;i++) game.update(1/60); game.toggleSword(); assert.equal(state.drawn,false);
game.pause(); const before=player.position.clone(); game.setKey('KeyW',true); game.update(.05); assert.equal(player.position.distanceTo(before),0);
game.dispose(); console.log('PASS: braking distance, idle stability, stairs, walls, sword states, pause.');

async function cameraFixture() {
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(55);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),mat); floor.rotation.x=-Math.PI/2; scene.add(floor);
  const obstacle=new THREE.Mesh(new THREE.BoxGeometry(20,8,.4),mat); obstacle.position.set(0,4,9); scene.add(obstacle);
  const game=createTempleGameplay({scene,camera,canvas});
  await game.ready;
  game.update(1/60);
  assert(camera.position.z<8.8,'Camera stays in front of obstacle');
  game.start(); game.setKey('KeyW',true);
  let last=camera.position.clone();
  for(let i=0;i<240;i++) {
    game.update(1/60);
    assert(camera.position.distanceTo(last)<.25,'Camera recovery has no large jump');
    last.copy(camera.position);
  }
  assert(camera.position.distanceTo(scene.getObjectByName('Playable wanderer').position)>5,'Camera recovers orbit distance');
  game.dispose();
}
await cameraFixture();
console.log('PASS: camera obstruction and smooth recovery.');

/* Pose-clip layering with injected clips (the fetch path is browser-only):
   stance keys, the draw clip's katanaInHand event timing, the attack clip
   taking over the swing, and the .9 s chiburi sheathe. */
async function clipFixture() {
  const { CLIP_JOINTS } = await import('../src/shaders/temple-night/templePoseClips.js');
  const id={q:[0,0,0,1],p:[0,0,0]};
  const rest={forward:[0,0,-1],height:1.74,joints:Object.fromEntries(CLIP_JOINTS.map(j=>[j,j==='hips'?{q:[0,0,0,1],p:[0,.93,0]}:id]))};
  const turned={q:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.9).toArray(),p:[0,0,0]};
  const key=(time,over)=>({time,joints:{...rest.joints,...over}});
  const clip=(name,duration,loop,keys,events)=>({version:1,name,duration,loop,mask:'full',rest,keys,events});
  const clips={
    draw:clip('draw',.5,false,[key(0,{}),key(.5,{rightArm:turned})],[{time:.45,name:'katanaInHand',value:true}]),
    sheathe_chiburi:clip('sheathe_chiburi',.9,false,[key(0,{rightArm:turned}),key(.9,{})],[{time:.7,name:'katanaInHand',value:false}]),
    stance_wind_idle:clip('stance_wind_idle',2,true,[key(0,{}),key(1,{leftArm:turned})]),
    attack_wind:clip('attack_wind',.85,false,[key(0,{}),key(.4,{rightArm:turned}),key(.85,{})]),
  };
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(55);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),mat); floor.rotation.x=-Math.PI/2; scene.add(floor);
  const game=createTempleGameplay({scene,camera,canvas,clips});
  await game.ready; await game.bodyReady; await game.clipsReady;
  const player=scene.getObjectByName('Playable wanderer'), katana=player.getObjectByName('katana'), hilt=player.getObjectByName('sheathedHilt');
  const rightArm=katana.parent.parent.parent;      /* hand ← forearm ← arm */
  let state; game.subscribe(s=>state=s); game.start();
  assert.equal(game.getState().body,'procedural'); assert.deepEqual(game.getState().clips.sort(),Object.keys(clips).sort());
  assert.equal(state.stance,'stone');
  const press=code=>{ for(const type of ['keydown','keyup']) { const e=new Event(type); e.code=code; window.dispatchEvent(e); } };
  press('Digit3'); assert.equal(state.stance,'wind'); assert.equal(game.getState().stance,'wind');
  assert.throws(()=>game.setStance('fire'),/Unknown stance/);
  /* draw (.5 s): the blade stays in the saya until the event at .45 of the clip, i.e. .45 s in */
  game.toggleSword(); assert.equal(state.drawn,true);
  for(let i=0;i<20;i++) game.update(1/60);
  assert(!katana.visible && hilt.visible,'blade still sheathed a third of the way through the draw');
  for(let i=0;i<9;i++) game.update(1/60);
  assert(katana.visible && !hilt.visible,'blade in hand after the katanaInHand event');
  for(let i=0;i<60;i++) game.update(1/60);
  /* the swing hands over to attack_wind: the arm leaves the stance pose mid-swing */
  const idleArm=rightArm.quaternion.clone();
  game.attack(); for(let i=0;i<24;i++) game.update(1/60);
  assert(rightArm.quaternion.angleTo(idleArm)>.3,`attack clip moves the sword arm: ${rightArm.quaternion.angleTo(idleArm)}`);
  assert(katana.visible,'blade stays in hand through the cut');
  for(let i=0;i<50;i++) game.update(1/60);
  /* sheathe takes the chiburi's .9 s: refused at .6 s, accepted after 1 s */
  game.toggleSword(); assert.equal(state.drawn,false);
  for(let i=0;i<36;i++) game.update(1/60);
  assert(katana.visible,'blade still out before the sheathe event at .7 of .9 s');
  game.toggleSword(); assert.equal(state.drawn,false,'a second toggle is refused mid-sheathe');
  for(let i=0;i<30;i++) game.update(1/60);
  assert(!katana.visible && hilt.visible,'blade home after the sheathe');
  game.toggleSword(); assert.equal(state.drawn,true,'toggle accepted once the .9 s sheathe is over');
  for(let i=0;i<40;i++) game.update(1/60);
  game.setKey('KeyW',true); for(let i=0;i<120;i++) game.update(1/60); game.setKey('KeyW',false);
  assert(Number.isFinite(player.position.x) && Number.isFinite(camera.position.x),'finite after clip layering while moving');
  game.dispose();
}
await clipFixture();
console.log('PASS: pose-clip layering: stance keys, draw event timing, attack clip, .9 s sheathe.');
