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
