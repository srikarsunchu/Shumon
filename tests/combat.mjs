/* The duel (docs/GAME.md) under the same Node stub as tests/gameplay.mjs:
   the wave-1 standoff's three verdicts, the cut's window, reach and cone,
   the stance multiplier, parry and guard, the dodge's invulnerability,
   death and restart, and a full three-wave run to the victory card. Every
   random draw comes from a seeded generator and the flinch is pinned with
   `standoffFlinchAt`, so the run plays the same every time. */
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { createTempleGameplay, WAVES } from '../src/shaders/temple-night/templeGameplay.js';
import { ENEMY_TYPES, STANDOFF_DISTANCE } from '../src/shaders/temple-night/templeEnemies.js';
globalThis.performance ??= { now: () => Date.now() };
globalThis.window=new EventTarget(); window.performance=globalThis.performance; globalThis.document=new EventTarget();
document.pointerLockElement=null; document.hidden=false;
const canvas=new EventTarget(); canvas.requestPointerLock=()=>Promise.resolve();
const mat=new THREE.MeshStandardMaterial();
function seeded(a) { return () => { a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
async function world(options={}) {
  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(55);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,120),mat); floor.rotation.x=-Math.PI/2; scene.add(floor);
  const game=createTempleGameplay({scene,camera,canvas,random:seeded(7),standoffFlinchAt:2,...options});
  await game.ready;
  return { game, scene, player: scene.getObjectByName('Playable wanderer') };
}
const step=(game,n)=>{ for(let i=0;i<n;i++) game.update(1/60); };
function until(game,pred,max,label) { for(let i=0;i<max;i++){ game.update(1/60); if(pred(game.getState())) return i; } throw new Error(`Never reached: ${label}`); }
const press=(code,type='keydown')=>{ const e=new Event(type); e.code=code; window.dispatchEvent(e); };
const near=(a,b,eps,msg)=>assert(Math.abs(a-b)<=eps,`${msg}: ${a} vs ${b}`);

/* ---- the state contract and several listeners ---- */
{
  const { game }=await world();
  const s=game.getState();
  for(const key of ['active','phase','wave','waves','health','maxHealth','hitFlash','guarding','parryWindow','dodging','drawn','stance','enemies','target','standoff','banner','result','seconds','sound','body','motion','fps'])
    assert(key in s,`state has ${key}`);
  assert.equal(s.phase,'title'); assert.equal(s.active,false); assert.equal(s.wave,0); assert.equal(s.waves,3); assert.equal(s.health,100); assert.deepEqual(s.enemies,[]); assert.equal(s.target,null);
  let a=0,b=0; const offA=game.subscribe(()=>a++); game.subscribe(()=>b++);
  game.setStance('water'); assert(a===2 && b===2,'both listeners hear the stance');
  offA(); game.setStance('wind'); assert(a===2 && b===3,'an unsubscribed listener is quiet');
  game.dispose();
}
console.log('PASS: state contract fields, several listeners.');

/* ---- wave 1: perfect ---- */
{
  const { game }=await world(); let state; game.subscribe(s=>state=s);
  game.start();
  assert.equal(state.phase,'standoff'); assert.equal(state.wave,1); assert.equal(state.active,true);
  assert.equal(state.enemies.length,1); assert.equal(state.enemies[0].type,'swordsman'); assert.equal(state.enemies[0].maxHealth,ENEMY_TYPES.swordsman.health);
  assert.equal(state.drawn,false,'both sheathed');
  assert.deepEqual(state.standoff,{holding:false,flinched:false,result:null});
  assert.equal(state.banner?.kind,'wave');
  press('Space'); assert.equal(game.getState().standoff.holding,true,'Space holds the standoff');
  game.start();
  assert.equal(game.getState().standoff.holding,true,'repeated start preserves the Space hold');
  const lead=game.enemies.living()[0];
  until(game,()=>lead.mode==='standoff',900,'the lead takes its mark');
  near(lead.distance,STANDOFF_DISTANCE,.4,'six metres off');
  assert.equal(game.getState().standoff.flinched,false);
  const frames=until(game,s=>s.standoff.flinched,200,'the flinch');
  near((frames+1)/60,2,.05,'the flinch lands at standoffFlinchAt');
  step(game,6);                                      /* .1 s after the flinch */
  press('Space','keyup');
  assert.equal(game.getState().standoff.result,'perfect');
  assert.equal(game.getState().drawn,true,'the perfect draw');
  until(game,s=>s.enemies[0].alive===false,120,'the one cut');
  assert.equal(game.getState().health,100);
  until(game,s=>s.phase==='clear',30,'the clear');
  assert.equal(game.getState().standoff,null,'the standoff clears with the wave');
  until(game,s=>s.phase==='standoff' && s.wave===2,240,'wave 2');
  assert.equal(game.getState().health,100);
  game.dispose();
}
console.log('PASS: wave-1 standoff resolves perfect on a release .1 s after the flinch.');

/* ---- early and late ---- */
{
  const { game }=await world(); game.start();
  game.holdStandoff(true); step(game,10); game.holdStandoff(false);
  const s=game.getState();
  assert.equal(s.standoff.result,'early'); assert.equal(s.health,78,'an early release costs 22'); assert.equal(s.phase,'fight'); assert(s.hitFlash>.9,'the flash');
  game.dispose();
}
{
  const { game }=await world(); let state; game.subscribe(s=>state=s); game.start();
  game.holdStandoff(true);
  until(game,s=>s.standoff.flinched,900,'the flinch');
  until(game,s=>s.standoff?.result==='late',70,'the late verdict at .9 s');
  assert.equal(state.phase,'fight');
  until(game,s=>s.health<100,120,'the enemy strikes first');
  assert.equal(game.getState().health,78,'the late strike costs 22');
  game.dispose();
}
console.log('PASS: early release costs 22; not releasing lets the enemy strike first for 22.');

/* ---- moving skips the standoff ---- */
{
  const { game }=await world(); game.start();
  game.setKey('KeyW',true); step(game,3); game.setKey('KeyW',false);
  const s=game.getState(); assert.equal(s.phase,'fight'); assert.equal(s.standoff,null); assert.equal(s.health,100);
  game.dispose();
}
console.log('PASS: moving skips the standoff.');

/* ---- the cut: window, reach, cone, stance ---- */
{
  const { game, player }=await world(); game.start({practice:true});
  assert.equal(game.getState().phase,'fight'); assert.equal(game.getState().wave,0);
  game.toggleSword(); step(game,40);
  /* a fighter spawned inside six metres with `standoff` holds its mark: a still target */
  const behind=game.spawnEnemy('swordsman',{x:0,z:player.position.z+1.4,standoff:true});
  game.setStance('wind'); game.attack(); step(game,60);
  assert.equal(behind.health,80,'a cut never lands behind'); behind.kill();
  const far=game.spawnEnemy('swordsman',{x:0,z:player.position.z-2.6,standoff:true});
  game.attack(); step(game,60);
  assert.equal(far.health,80,'2.6 m is past the reach'); far.kill();
  const front=game.spawnEnemy('swordsman',{x:0,z:player.position.z-1.4,standoff:true});
  game.attack(); step(game,15);                     /* swingT .29: not yet */
  assert.equal(front.health,80,'no damage before the window');
  step(game,6);                                      /* swingT .39: inside */
  assert.equal(front.health,46,'34 in a mismatched stance');
  step(game,60);
  assert.equal(front.health,46,'one hit per swing');
  assert.equal(front.state().staggered,false,'a mismatched cut does not stagger');
  front.kill();
  const matched=game.spawnEnemy('swordsman',{x:0,z:player.position.z-1.4,standoff:true});
  game.setStance('stone'); game.attack(); step(game,24);
  near(matched.health,80-34*1.6,1e-9,'Stone against a swordsman is ×1.6');
  assert.equal(matched.state().staggered,true,'and staggers');
  step(game,60);
  const off=game.spawnEnemy('swordsman',{x:player.position.x-1.2,z:player.position.z-1.2,standoff:true});   /* 45° off: inside the ±50° cone */
  game.attack(); step(game,24);
  assert(off.health<80,'45° is inside the cone');
  const state=game.getState();
  assert.equal(state.enemies.filter(e=>e.alive).length,1,'the second cut also finished the staggered swordsman'); assert.equal(state.target,off.id);
  assert(state.enemies.length>=2 && state.enemies.length<5,'faded bodies leave the roster');
  game.dispose();
}
console.log('PASS: the cut lands only in the window, the reach and the cone; the matching stance is ×1.6 and staggers.');

/* ---- parry, guard, dodge ---- */
{
  const { game }=await world(); let state; game.subscribe(s=>state=s); game.start({practice:true});
  const e=game.spawnEnemy('swordsman',{x:0,z:4});
  until(game,s=>s.parryWindow,900,'the parry window');
  assert.equal(e.state().attacking,true);
  press('KeyF');
  assert.equal(e.state().staggered,true,'a press in the window staggers the enemy');
  assert.equal(state.guarding,true,'F holds the guard');
  step(game,40);                                     /* past the hit frame and the .5 s draw F triggered */
  assert.equal(game.getState().health,100,'no damage through a parry');
  press('KeyF','keyup'); assert.equal(game.getState().guarding,false);
  game.setStance('wind'); game.attack(); step(game,24);
  assert.equal(e.health,12,'the next cut is doubled: 34 × 2 off a swordsman on 80');
  assert.equal(e.vulnerable,false,'and the doubling is spent');
  game.dispose();
}
{
  const { game }=await world(); game.start({practice:true});
  game.spawnEnemy('swordsman',{x:0,z:4});
  game.guard(true);                                 /* held long before any window: a guard, not a parry */
  until(game,s=>s.health<100,900,'a guarded hit');
  assert.equal(game.getState().health,89,'guard halves 22');
  game.dispose();
}
{
  const { game, player }=await world(); let sawDodge=false; game.subscribe(s=>{ if(s.dodging) sawDodge=true; }); game.start({practice:true});
  game.toggleSword(); step(game,40);
  game.spawnEnemy('swordsman',{x:0,z:4});
  until(game,s=>s.parryWindow,900,'the window');
  const from=player.position.clone();
  press('KeyQ');
  assert.equal(game.getState().dodging,true);
  step(game,40);
  assert.equal(game.getState().health,100,'invulnerable through the dodge');
  assert(sawDodge,'the dodge is reported');
  near(player.position.distanceTo(from),2.2,.35,'the dodge covers 2.2 m');
  game.dispose();
}
console.log('PASS: parry staggers and doubles the next cut, guard halves, dodge is invulnerable and travels 2.2 m.');

/* ---- death and restart ---- */
{
  const { game }=await world(); let state; game.subscribe(s=>state=s); game.start({practice:true});
  game.spawnEnemy('brute',{x:0,z:4});
  until(game,s=>s.phase==='dead',3600,'death');
  assert.equal(state.health,0); assert.equal(state.result.won,false); assert.equal(state.active,true);
  step(game,30);
  press('Enter');
  const s=game.getState();
  assert.equal(s.phase,'standoff'); assert.equal(s.wave,1); assert.equal(s.health,100); assert.equal(s.result,null); assert.equal(s.enemies.length,1);
  game.dispose();
}
console.log('PASS: death ends the run; Enter restarts at wave 1 with full health.');

/* ---- three waves to the victory card ---- */
{
  const { game }=await world(); let state; game.subscribe(s=>state=s); game.start();
  for(let w=1;w<=WAVES.length;w++) {
    assert.equal(state.phase,'standoff'); assert.equal(state.wave,w);
    const lead=game.enemies.living().find(e=>e.standoff);
    assert.equal(lead.type,WAVES[w-1][0].type);
    game.holdStandoff(true);
    until(game,s=>s.standoff.flinched,900,`wave ${w} flinch`);
    step(game,6); game.holdStandoff(false);
    assert.equal(game.getState().standoff.result,'perfect');
    until(game,()=>!lead.alive,120,`wave ${w} perfect kill`);
    if(w===2) until(game,s=>s.enemies.filter(e=>e.alive).length===1,300,'the spearman walks in');
    for(const e of game.enemies.living()) e.hit(1000);
    if(w<WAVES.length) { until(game,s=>s.phase==='clear',30,`wave ${w} clear`); until(game,s=>s.phase==='standoff',240,`wave ${w+1}`); }
  }
  until(game,s=>s.phase==='victory',30,'victory');
  assert.equal(state.result.won,true); assert.equal(state.result.perfect,3); assert.equal(state.result.kills,5); assert(state.result.seconds>10);
  assert.equal(state.enemies.filter(e=>e.alive).length,0);
  game.dispose();
}
console.log('PASS: three waves cleared yields result.won and the victory phase.');

/* ---- the reactions: the library's clips on the rig ----
   The Quaternius library parses under Node from a data URI (no fetch, no
   canvas), so the retarget itself is exercised: a hit reaction must move
   the joints off the idle, the tell must raise the sword arm, Death01 must
   hold its last frame from t = 1 and bring the hips to the ground, and a
   reaction over must leave the idle exactly as it was. */
{
  const { readFileSync }=await import('node:fs');
  const { GLTFLoader }=await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { loadAuthoredMotion, REACT_CLIPS, TELL }=await import('../src/shaders/temple-night/templeAnimation.js');
  const { createSamurai }=await import('../src/shaders/temple-night/templeSamurai.js');
  globalThis.ProgressEvent ??= class extends Event { constructor(type,init){ super(type); Object.assign(this,init||{}); } };
  const json=JSON.parse(readFileSync(new URL('../public/assets/quaternius/animations.gltf',import.meta.url)));
  const bin=readFileSync(new URL('../public/assets/quaternius/AnimationLibrary_Godot_Standard.bin',import.meta.url));
  json.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');
  const gltf=await new Promise((res,rej)=>new GLTFLoader().parse(JSON.stringify(json),'',res,rej));
  for(const name of Object.keys(REACT_CLIPS)) assert(gltf.animations.some(c=>c.name===name),`library has ${name}`);
  const samurai=createSamurai(); const scene=new THREE.Scene(); scene.add(samurai.group);
  const motion=await loadAuthoredMotion(samurai,gltf);
  const JOINTS=['hips','spine','chest','neck','head','leftArm','leftForearm','leftHand','rightArm','rightForearm','rightHand','leftThigh','leftShin','leftFoot','rightThigh','rightShin','rightFoot'];
  const idle={speed:0,run:0,phase:0,drawn:true,swing:-1,time:1};
  const pose=(extra,dt=0)=>{ samurai.update(dt,{...idle,...extra}); motion.update(dt,{...idle,...extra}); return { q:JOINTS.map(j=>samurai.joints[j].quaternion.clone()), hips:samurai.joints.hips.position.clone() }; };
  const spread=(a,b)=>Math.max(...a.q.map((q,i)=>q.angleTo(b.q[i])));
  const base=pose({});
  assert(spread(base,pose({}))<5e-3,'the idle is stable frame to frame');
  const hit=pose({react:{clip:'Hit_Chest',t:.5}});
  assert(spread(base,hit)>.05,`Hit_Chest at t=.5 moves the joints: ${spread(base,hit)}`);
  const head=pose({react:{clip:'Hit_Head',t:.5}});
  assert(spread(hit,head)>.02,'Hit_Head is another reaction than Hit_Chest');
  const tell=pose({telegraph:1});
  const armIdle=base.q[JOINTS.indexOf('rightArm')], armTell=tell.q[JOINTS.indexOf('rightArm')];
  assert(armIdle.angleTo(armTell)>.3,`the tell raises the sword arm: ${armIdle.angleTo(armTell)}`);
  const cut=pose({swing:TELL}), armCut=cut.q[JOINTS.indexOf('rightArm')];
  assert(armTell.angleTo(armCut)<5e-3,'the strike resumes from the held tell without a snap');
  const dead=pose({react:{clip:'Death01',t:1}});
  assert(spread(base,dead)>.5,'Death01 at t=1 is far from the idle');
  assert(dead.hips.y<base.hips.y-.5,`the fallen hips reach the ground: ${dead.hips.y} under ${base.hips.y}`);
  const held=pose({react:{clip:'Death01',t:1.4}});
  /* the mixer's two accumulation slots alternate by a thousandth of a radian frame to frame; the hold is exact otherwise */
  assert(spread(dead,held)<5e-3 && Math.abs(dead.hips.y-held.hips.y)<1e-6,'Death01 holds its last frame past t=1');
  const roll=pose({react:{clip:'Roll',t:.45}});
  assert(spread(base,roll)>.5,'the roll turns the body over');
  const {applyCombatStyle}=await import('../src/shaders/temple-night/templeWeapons.js');
  const paths=[];
  for(const stance of ['stone','water','wind','moon']) {
    const path=[];
    for(const swing of [.3,.45,.6]) {
      const state={...idle,drawn:true,stance,swing};
      samurai.update(0,state); motion.update(0,state); applyCombatStyle(samurai,state);
      samurai.group.updateMatrixWorld(true);
      path.push(samurai.katana.localToWorld(new THREE.Vector3(0,0,-.72)));
    }
    paths.push(path);
  }
  for(let a=0;a<paths.length;a++) for(let b=a+1;b<paths.length;b++)
    assert(paths[a].some((point,i)=>point.distanceTo(paths[b][i])>.25),'stance blade paths differ during the damage window');
  const after=pose({});
  assert(spread(base,after)<5e-3 && Math.abs(base.hips.y-after.hips.y)<1e-6,'a reaction over leaves the idle untouched');
  pose({dodge:true},1/60); const dodge=pose({dodge:true},1/60); pose({},1/60);
  assert(spread(base,dodge)>.05,'a bare dodge flag rolls too');
  /* the pool's fighters bind to SkeletonUtils clones of this same, by now
     animated, scene: the clone must retarget exactly as the original does */
  const { clone: cloneRig }=await import('three/examples/jsm/utils/SkeletonUtils.js');
  motion.update(.4,idle);
  const other=createSamurai({hat:true,mask:true,palette:'raider',lights:false}); scene.add(other.group);
  const cloned=await loadAuthoredMotion(other,{scene:cloneRig(gltf.scene),animations:gltf.animations});
  /* compared on the held tell, a scrubbed pose the free-running idle loops have no weight in */
  const tellPose={...idle,telegraph:1};
  other.update(0,tellPose); cloned.update(0,tellPose); samurai.update(0,tellPose); motion.update(0,tellPose);
  const drift=Math.max(...JOINTS.map(j=>samurai.joints[j].quaternion.angleTo(other.joints[j].quaternion)));
  assert(drift<5e-3,`a clone of the animated library retargets like the original: ${drift}`);
  cloned.dispose(); motion.dispose();
}
console.log('PASS: Hit_Chest, Hit_Head and the tell move the joints; Death01 holds at t ≥ 1 with the hips down; the idle returns; a clone binds like the original.');

/* ---- the pool's fighters: palette, mask, hat, no lights, ready at once without a skin ---- */
{
  const { PALETTES }=await import('../src/shaders/temple-night/templeSamurai.js');
  const { game }=await world(); game.start({practice:true});
  const brute=game.spawnEnemy('brute',{x:0,z:4}), sword=game.spawnEnemy('swordsman',{x:2,z:4});
  const spear=game.spawnEnemy('spearman',{x:4,z:4}), shield=game.spawnEnemy('shieldman',{x:6,z:4});
  step(game,1);
  assert(brute.rig.group.getObjectByName('kanabo'),'brute carries a club');
  assert(spear.rig.group.getObjectByName('yari'),'spearman carries a spear');
  assert(shield.rig.group.getObjectByName('shield'),'shieldman carries a shield');
  assert(!spear.rig.saya.visible && !brute.rig.saya.visible,'pole weapons have no sword scabbard');
  assert(spear.rig.katana.visible && brute.rig.katana.visible,'pole weapons remain visible');
  assert.equal(brute.rig.palette,'iron'); assert.equal(sword.rig.palette,'raider'); assert(PALETTES.sakai && PALETTES.iron && PALETTES.raider && PALETTES.ash);
  near(brute.group.scale.x,1.12,1e-9,'the brute stands larger');
  assert(brute.rig.mask && brute.rig.hat,'masked, under a hat');
  let lights=0; brute.group.traverse(o=>{ if(o.isLight) lights++; }); assert.equal(lights,0,'no lights on a fighter');
  assert(brute.ready && brute.shown && brute.group.visible,'a bare rig is shown at once');
  brute.hit(10); step(game,1); assert(brute.hitT>0 && brute.mode==='hit','a hit is timed');
  game.dispose();
  /* the player's own rig keeps the sakai set and the lights */
  const own=(await import('../src/shaders/temple-night/templeSamurai.js')).createSamurai({hat:false});
  let ownLights=0; own.group.traverse(o=>{ if(o.isLight) ownLights++; }); assert.equal(own.palette,'sakai'); assert.equal(ownLights,2); assert.equal(own.mask,null);
}
console.log('PASS: fighters wear their palettes under hat and mask without lights; the wanderer is unchanged.');

/* Returning from a paused run to the title must buy a new night. */
{
  const { game }=await world(); game.start();
  game.holdStandoff(true); step(game,10); game.holdStandoff(false);
  game.pause();
  game.start({restart:true});
  const s=game.getState();
  assert.equal(s.phase,'standoff'); assert.equal(s.wave,1);
  assert.equal(s.health,100); assert.equal(s.seconds,0);
  assert.equal(s.standoff.holding,false); assert.equal(s.active,true);
  game.dispose();
}
console.log('PASS: title entry starts a fresh run after a paused fight.');

/* Every stance/enemy pairing, including both outcomes of a shield block. */
{
  const counters={stone:'swordsman',water:'shieldman',wind:'spearman',moon:'brute'};
  for(const [stance,target] of Object.entries(counters)) {
    for(const type of Object.values(counters)) {
      const {game,player}=await world({random:()=>.75});
      game.start({practice:true}); game.setStance(stance); game.toggleSword(); step(game,40);
      const enemy=game.spawnEnemy(type,{x:player.position.x,z:player.position.z-1.4,standoff:true});
      const before=enemy.health;
      game.attack(); step(game,24);
      near(before-enemy.health,34*(target===type?1.6:1),1e-9,`${stance} damage against ${type}`);
      assert.equal(enemy.state().staggered,target===type,`${stance} stagger against ${type}`);
      game.dispose();
    }
    const {game,player}=await world({random:()=>.25});
    game.start({practice:true}); game.setStance(stance); game.toggleSword(); step(game,40);
    const shield=game.spawnEnemy('shieldman',{x:player.position.x,z:player.position.z-1.4,standoff:true});
    game.attack(); step(game,24);
    near(shield.health,110-(stance==='water'?54.4:0),1e-9,`${stance}: Water bypasses a shield block; other stances are blocked`);
    game.dispose();
  }
}
console.log('PASS: all 16 stance matchups deal the correct damage and stagger; only Water bypasses shield blocks.');

/* A title return clears actors and resets both visible and physical spawn. */
{
  const {game,player}=await world();game.start({practice:true});
  game.setKey('KeyW',true);step(game,60);game.setKey('KeyW',false);
  game.spawnEnemy('brute');game.setStance('moon');game.look(1);
  game.returnToTitle();step(game,1);
  const s=game.getState();assert.equal(s.phase,'title');assert.equal(s.active,false);
  assert.equal(s.enemies.length,0);assert.equal(s.stance,'stone');assert.equal(player.visible,false);
  near(game.position.z,7,.001,'title resets the player position');
  game.start();step(game,2);
  near(game.position.z,7,.02,'physics stays at the reset spawn');assert.equal(player.visible,true);
  game.dispose();
}
console.log('PASS: returning to title clears enemies, hides the player, and resets the physical spawn.');

/* Journey: walking buys the encounter, victory returns to exploration. */
{
  const {game}=await world({journey:true});game.start();
  assert.equal(game.getState().phase,'roam');assert.equal(game.getState().enemies.length,0);
  game.setKey('KeyW',true);game.setKey('ShiftLeft',true);
  until(game,s=>s.phase==='arrival',1200,'court arrival');
  game.setKey('KeyW',false);game.setKey('ShiftLeft',false);
  assert.equal(game.getState().enemies.length,0,'no enemies during arrival cutscene');
  game.pause();step(game,300);assert.equal(game.getState().phase,'arrival','pause freezes the cutscene');
  game.start();until(game,s=>s.phase==='standoff',300,'first standoff');
  for(let wave=1;wave<=3;wave++) {
    game.setKey('KeyW',true);step(game,2);game.setKey('KeyW',false);
    step(game,250);for(const enemy of game.enemies.living())enemy.kill();step(game,2);
    if(wave<3)until(game,s=>s.phase==='standoff' && s.wave===wave+1,240,'next wave');
  }
  assert.equal(game.getState().phase,'victory');game.continueExploring();step(game,300);
  assert.equal(game.getState().phase,'roam');assert.equal(game.getState().enemies.length,0);
  game.dispose();
}
console.log('PASS: journey arrival pauses correctly and the completed encounter returns to free roam once.');

/* Real Rapier collision through the palace's hollow shell and double doorway. */
{
  const {buildPalace}=await import('../src/shaders/temple-night/templePalace.js');
  const {createTemplePhysics}=await import('../src/shaders/temple-night/templePhysics.js');
  const scene=new THREE.Scene(),temple=new THREE.Group();scene.add(temple);
  const core=new THREE.Mesh(new THREE.BoxGeometry(13.6,5,8.2),mat);core.position.set(0,9.5,-44);temple.add(core);
  const podium=new THREE.Mesh(new THREE.BoxGeometry(42,7,24),mat);podium.position.set(0,3.5,-45);scene.add(podium);
  const palace=buildPalace(scene,{temple});scene.updateMatrixWorld(true);
  const solids=[];scene.traverse(o=>{if(o.isMesh&&!o.userData.noCollision&&o.material.isMeshStandardMaterial)solids.push(o);});
  const pos=new THREE.Vector3(0,7.2,-37),physics=await createTemplePhysics(solids,pos);
  palace.update(1,pos);assert(palace.doors.every(d=>Math.abs(d.hinge.rotation.y)>1),'both leaves open on approach');
  for(let i=0;i<240;i++)physics.move(0,-2/60,1/60,pos);
  assert(pos.z<-44,'walk through front doors into hall');assert(pos.y>7,'interior has a solid floor');
  for(let i=0;i<240;i++)physics.move(0,-2/60,1/60,pos);
  assert(pos.z>-48,'rear wall prevents leaving the shell');
  physics.dispose();
}
console.log('PASS: palace doors open and its physical doorway, floor, and rear wall are navigable.');
