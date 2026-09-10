import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyCombatStyle } from './templeWeapons.js';
import { createSamurai } from './templeSamurai.js';
import { createTemplePhysics } from './templePhysics.js';
import { loadAuthoredMotion, createFootPlant } from './templeAnimation.js';
import { createTempleAudio } from './templeAudio.js';
import { loadBody } from './templeBody.js';
import { createPoseClips } from './templePoseClips.js';
import { createEnemyPool, ENEMY_TYPES, TORII_Z } from './templeEnemies.js';

const clamp = THREE.MathUtils.clamp;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
/* browser-only loaders (GLB body, pose clips) are gated on a real DOM; the
   Node test stubs document as a bare EventTarget */
const CANVAS = typeof document !== 'undefined' && typeof document.createElement === 'function';
export const STANCES = ['stone', 'water', 'wind', 'moon'];
/* the authored pose clips (plan B6), each optional: a missing file leaves
   that behaviour to the procedural rig and the Quaternius library */
/* The authored clips (anim/poses → public/anim/clips) are not loaded by
   default: hand-set keys read stiffer than the library's captured idle,
   sword idle and cut, and the procedural draw, so those stay in charge of
   the body. Stances still switch (keys 1-4) and are reported in the HUD;
   move names from AUDITION_CLIP_NAMES into CLIP_NAMES to audition one. */
export const CLIP_NAMES = [];
export const AUDITION_CLIP_NAMES = ['idle_hand_on_hilt', 'saya_hold', 'stance_stone_idle', 'stance_water_idle', 'stance_wind_idle', 'stance_moon_idle',
  'draw', 'sheathe_chiburi', 'attack_stone', 'attack_water', 'attack_wind', 'attack_moon'];
const DRAW_TIME = .5, SHEATHE_TIME = .4, SHEATHE_CLIP_TIME = .9, SWING_TIME = .85;

/* ---- the duel (docs/GAME.md is the contract for every number here) ---- */
export const WAVES = [
  [{ type: 'swordsman', lead: true }],
  [{ type: 'shieldman', lead: true }, { type: 'spearman', delay: 4 }],
  [{ type: 'brute', lead: true }, { type: 'swordsman' }],
];
export const STANCE_TARGET = { stone: 'swordsman', water: 'shieldman', wind: 'spearman', moon: 'brute' };
const PLAYER_HEALTH = 100, CUT_DAMAGE = 34, CUT_WINDOW = [.30, .62], CUT_REACH = 1.9, CUT_CONE = 50 * Math.PI / 180, STANCE_BONUS = 1.6;
const PARRY_WINDOW = .28, DODGE_TIME = .55, DODGE_MOVE = .45, DODGE_DISTANCE = 2.2, HIT_REACT = .33, DEATH_FALL = .9;
const CLEAR_TIME = 3, CLEAR_HEAL = 30, STANDOFF_FLINCH = [1.6, 4.2], STANDOFF_PERFECT = .28, STANDOFF_LATE = .9, STANDOFF_LINGER = 1.2, STANDOFF_DAMAGE = 22;
const CAMERA_BIAS = 2, MOUSE_HOLD = .8, WAVE_NAMES = ['A swordsman at the gate', 'Shield and spear', 'The brute'];
export const BANNERS = {
  wave: n => ({ text: `Wave ${n} — ${WAVE_NAMES[n - 1]}`, kind: 'wave', seconds: 3 }),
  clear: { text: 'The gate holds', kind: 'wave', seconds: CLEAR_TIME },
  perfect: { text: 'Perfect', kind: 'result', seconds: 1.4 }, early: { text: 'Early', kind: 'result', seconds: 1.4 }, late: { text: 'Late', kind: 'result', seconds: 1.4 },
  victory: { text: 'The gate held', kind: 'result', seconds: 4 }, dead: { text: 'Fallen at the gate', kind: 'result', seconds: 4 },
};

// Rapier owns movement collision; mesh queries supply foot placement and camera clearance.
/* `clips` (name → clip JSON) seeds the pose clips without fetching, for tests;
   `random` and `standoffFlinchAt` (seconds after the lead enemy takes its
   mark) pin the run down for tests */
export function createTempleGameplay({ scene, camera, canvas, wind, grade, clips, random = Math.random, standoffFlinchAt, journey = false }) {
  scene.updateMatrixWorld(true);
  const solids = [];
  scene.traverse(o => {
    if (!o.isInstancedMesh && !o.userData.noCollision && o.isMesh && o.material?.isMeshStandardMaterial && !o.material.transparent) solids.push(o);
  });
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const position = new THREE.Vector3(0, .02, 7);
  const keys = new Set();
  const velocity = new THREE.Vector3();
  const requested = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const probeOrigin = new THREE.Vector3();
  const dodgeDir = new THREE.Vector3();
  let frameSeconds=0,frameCount=0,fps=0;
  let cameraReady = false, cameraDistance = 5.6, cameraYaw = 0, cameraPitch = .22;
  let gaitSpeed = 0, turnLean = 0;
  let active = false, yaw = 0, pitch = .22, swing = 0, drawn = false, phase = 0;
  let speed = 0, dragging = false, lastX = 0, lastY = 0;
  const listeners = new Set();
  let startedAt = -1;
  /* the run */
  let gamePhase='title', wave=0, health=PLAYER_HEALTH, hitFlash=0, guardHeld=false, guardBlend=0, parryAt=-Infinity, dodgeT=0, hitReact=0, deadT=-1;
  let standoff=null, standoffLead=null, standoffAt=-1, flinchDelay=0, flinchTime=-1, standoffLinger=-1, lunge=null, killPending=null;
  let arrivalTime=0, encounterDone=false;
  let banner=null, result=null, seconds=0, perfects=0, pending=[], clearUntil=-1, practice=false, mouseAt=-Infinity, emitAt=-1, swingTarget=null;
  const hitThisSwing=new Set();

  /* The wanderer: a jointed, armoured figure built in templeSamurai.js. The
     controller only tells it how fast it is moving and what the sword is
     doing; the rig works out the rest. */
  const samurai = createSamurai({ hat: false });
  const player = samurai.group;
  player.name = 'Playable wanderer';
  scene.add(player);
  player.visible = false;
  let time = 0, physics, motion, disposed=false, sound=false, stepPhase=0, cutSound=false, drawTime=0, queuedAttack=false;
  const audio=createTempleAudio();
  const plantFeet=createFootPlant(samurai);
  const ready=createTemplePhysics(solids,position).then(value=>{if(disposed)value.dispose();else physics=value;});
  let motionStatus='procedural';
  /* one parsed library for the player and every enemy; the pool clones its bones per fighter */
  const animationData=CANVAS ? new GLTFLoader().loadAsync('/assets/quaternius/animations.gltf') : Promise.resolve(null);
  const animationReady=CANVAS ? animationData.then(gltf=>loadAuthoredMotion(samurai,gltf)).then(value=>{
    if(disposed)value.dispose();else {motion=value;motionStatus='authored';emit();}
  }).catch(error=>{motionStatus='fallback';console.warn('Authored animation unavailable; procedural samurai retained.',error);emit();}) : Promise.resolve();
  const pool=createEnemyPool({scene,solids,samuraiFactory:createSamurai,animationData:animationData.catch(()=>null),random});
  /* the skinned body wears the same joints; without it the primitives stay */
  let body=null, bodyStatus='procedural';
  const bodyReady=CANVAS ? loadBody(samurai).then(value=>{
    if(disposed)value.dispose();else {body=value;bodyStatus='glb';emit();}
  }).catch(error=>{console.warn('Skinned body unavailable; procedural samurai retained.',error);emit();}) : Promise.resolve();
  /* pose clips, each tolerated missing (404 or bad JSON) on its own */
  let poseClips=createPoseClips(samurai,clips||{}), stance='stone';
  const clipsReady=CANVAS && typeof fetch==='function' ? Promise.all(CLIP_NAMES.map(name=>fetch(`/anim/clips/${name}.json`)
    .then(r=>r.ok?r.json():null).catch(()=>null).then(clip=>[name,clip]))).then(entries=>{
    if(disposed)return;
    poseClips=createPoseClips(samurai,Object.fromEntries(entries.filter(([,clip])=>clip && clip.keys)));
    emit();
  }).catch(error=>console.warn('Pose clips unavailable.',error)) : Promise.resolve();
  const bladePoints=[];
  const trailGeometry=new THREE.BufferGeometry();
  const trailPositions=new Float32Array(12*6*3);trailGeometry.setAttribute('position',new THREE.BufferAttribute(trailPositions,3));trailGeometry.setDrawRange(0,0);
  const trail=new THREE.Mesh(trailGeometry,new THREE.MeshBasicMaterial({color:0xc7e3e7,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
  trail.frustumCulled=false;trail.userData.noCollision=true;scene.add(trail);
  const bladeBase=new THREE.Vector3(),bladeTip=new THREE.Vector3();

  const guarding=()=>guardHeld && drawn && gamePhase!=='dead';
  const inStandoff=()=>gamePhase==='standoff' && standoff && !standoff.result;
  const fighting=()=>gamePhase==='standoff' || gamePhase==='fight';
  function getState() {
    const nearest=pool.nearest(position);
    return {
      fps, active, phase:gamePhase, wave, waves:WAVES.length, health, maxHealth:PLAYER_HEALTH, hitFlash,
      guarding:guarding(), parryWindow:gamePhase==='fight' && pool.living().some(e=>{const h=e.hitIn();return h>0 && h<=PARRY_WINDOW;}), dodging:dodgeT>0,
      drawn, stance, enemies:pool.states(), target:nearest?nearest.id:null,
      standoff:standoff?{holding:standoff.holding,flinched:standoff.flinched,result:standoff.result}:null,
      banner:banner?{...banner}:null, result:result?{...result}:null, seconds,
      sound, body:bodyStatus, motion:motionStatus, clips:poseClips.names, physics:!!physics, position:position.toArray(), speed,
    };
  }
  function emit() { emitAt=time; if(!listeners.size)return; const s=getState(); listeners.forEach(fn=>fn(s)); }
  function setBanner(spec) { banner={text:spec.text,kind:spec.kind,until:seconds+spec.seconds}; }
  function resetInput() { keys.clear(); dragging = false; speed = 0; gaitSpeed = 0; velocity.set(0,0,0); guardHeld=false; if(standoff)standoff.holding=false; }
  function pause() { active = false; audio.setActive(false); audio.standoffDrum?.(false); resetInput(); if(document.pointerLockElement === canvas) document.exitPointerLock(); emit(); }
  /* the sheathe takes the chiburi's length when that clip is authored */
  const sheatheTime=()=>poseClips.has('sheathe_chiburi')?SHEATHE_CLIP_TIME:SHEATHE_TIME;
  function beginSwing() { swing=SWING_TIME; cutSound=false; hitThisSwing.clear();
    /* a soft turn toward whoever is in front: the cut never spins the wanderer round */
    const near=pool.nearest(position); swingTarget=near && near.distance<3.2 && Math.abs(wrap(Math.atan2(-(near.position.x-position.x),-(near.position.z-position.z))-player.rotation.y))<=75*Math.PI/180 ? near : null; }
  function attack() {
    if(!active || swing > 0 || gamePhase==='dead' || hitReact>0 || dodgeT>0 || lunge || killPending || inStandoff()) return;
    if(drawTime>0)return;
    if(!drawn){drawTime=DRAW_TIME;audio.draw();queuedAttack=true;drawn=true;} else beginSwing();
    emit();
  }
  function toggleSword() { if(active && swing <= 0 && drawTime<=0 && gamePhase!=='dead') { drawn = !drawn; drawTime=drawn?DRAW_TIME:sheatheTime(); audio.draw(); emit(); } }
  function setStance(name) { if(!STANCES.includes(name))throw new Error(`Unknown stance: ${name}`); if(stance!==name){stance=name;emit();} return stance; }

  /* ---- the run ---- */
  function beginRun(practiceMode) {
    position.set(journey?-1.5:0,journey?1.02:.02,journey?80:7); physics?.reset(position); resetInput();
    arrivalTime=0; encounterDone=false;
    yaw=0; pitch=.22; cameraReady=false; stance='stone'; drawn=false; drawTime=0;
    player.rotation.set(0,0,0); player.position.copy(position);
    pool.clear(); practice=practiceMode; wave=0; health=PLAYER_HEALTH; hitFlash=0; perfects=0; seconds=0; result=null; standoff=null; standoffLead=null;
    banner=null; pending=[]; lunge=null; killPending=null; deadT=-1; dodgeT=0; hitReact=0; guardHeld=false; parryAt=-Infinity; swingTarget=null;
    player.rotation.x=0; player.rotation.z=0; swing=0; queuedAttack=false;
    if(practice) gamePhase='fight'; else if(journey) gamePhase='roam'; else nextWave();
  }
  function nextWave() {
    wave++; gamePhase='standoff'; standoff={holding:false,flinched:false,result:null}; standoffAt=-1; flinchTime=-1; standoffLinger=-1; lunge=null; killPending=null;
    drawn=false; drawTime=0; swing=0; queuedAttack=false; samurai.katana.visible=false; samurai.sheathedHilt.visible=true;
    let side=1;
    for(const entry of WAVES[wave-1]) {
      if(entry.lead) standoffLead=pool.spawn(entry.type,{x:0,z:TORII_Z,standoff:true});
      else if(entry.delay) pending.push({type:entry.type,at:time+entry.delay,x:1.4*side});
      else pool.spawn(entry.type,{x:1.4*side,z:TORII_Z-.4});
      if(!entry.lead) side=-side;
    }
    audio.bell?.(); setBanner(BANNERS.wave(wave)); emit();
  }
  function releaseEnemies() { for(const e of pool.living()) e.release(); }
  function skipStandoff() { if(!inStandoff())return; audio.standoffDrum?.(false); standoff=null; gamePhase='fight'; releaseEnemies(); emit(); }
  function resolveStandoff(outcome) {
    if(!inStandoff())return;
    standoff.result=outcome; standoff.holding=false; audio.standoffDrum?.(false); setBanner(BANNERS[outcome]);
    const lead=standoffLead;
    if(outcome==='perfect') {
      /* the draw and the cut are one motion: a lunge to reach, then the blade */
      perfects++; drawn=true; drawTime=0; queuedAttack=false; lunge={enemy:lead,t:0};
    } else {
      gamePhase='fight'; standoffLinger=time+STANDOFF_LINGER; releaseEnemies();
      if(outcome==='early') damagePlayer(STANDOFF_DAMAGE,{unblockable:true}); else lead?.strikeNow();
    }
    emit();
  }
  function holdStandoff(down) {
    if(!active || !inStandoff())return;
    if(down) { if(!standoff.holding){standoff.holding=true;emit();} }
    else if(standoff.holding) { standoff.holding=false; resolveStandoff(standoff.flinched ? (time-flinchTime<=STANDOFF_PERFECT?'perfect':'late') : 'early'); }
  }
  function parryEnemy(e) { e.stagger(); e.vulnerable=true; parryAt=-Infinity; audio.parry?.(); emit(); }
  function parry() {
    if(!active || gamePhase==='dead')return;
    parryAt=time;
    const e=pool.living().find(o=>{const h=o.hitIn();return h>0 && h<=PARRY_WINDOW;});
    if(e) parryEnemy(e);
  }
  function guard(down) {
    guardHeld=!!down;
    if(down && active && gamePhase!=='dead') { if(!drawn && drawTime<=0 && swing<=0) toggleSword(); parry(); }
    emit();
  }
  function dodge() {
    if(!active || dodgeT>0 || gamePhase==='dead' || hitReact>0 || lunge || killPending)return;
    skipStandoff();
    const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    const right=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    if(forward||right) { const angle=yaw+Math.atan2(-right,forward); dodgeDir.set(-Math.sin(angle),0,-Math.cos(angle)); }
    else dodgeDir.set(Math.sin(player.rotation.y),0,Math.cos(player.rotation.y));     /* backwards, away from the facing */
    dodgeT=DODGE_TIME; swing=0; queuedAttack=false; emit();
  }
  function damagePlayer(amount,{enemy=null,unblockable=false}={}) {
    if(gamePhase==='dead')return;
    if(!unblockable) {
      if(dodgeT>0) return;
      if(enemy && time-parryAt<=PARRY_WINDOW) { parryEnemy(enemy); return; }
      if(guarding()) { amount*=.5; audio.guard?.(); } else { hitReact=HIT_REACT; audio.hit?.(); }
    } else audio.hit?.();
    health=Math.max(0,health-amount); hitFlash=1;
    if(health<=0) die(); else emit();
  }
  function die() {
    gamePhase='dead'; deadT=0; result={won:false,kills:pool.killed,seconds:Math.round(seconds),perfect:perfects};
    standoff=null; lunge=null; killPending=null; guardHeld=false; dodgeT=0; swing=0; audio.standoffDrum?.(false); audio.death?.(); setBanner(BANNERS.dead); emit();
  }
  function victory() { gamePhase='victory'; result={won:true,kills:pool.killed,seconds:Math.round(seconds),perfect:perfects}; audio.victory?.(); setBanner(BANNERS.victory); emit(); }
  function onStrike(e,distance) {
    if(gamePhase==='dead' || !active)return;
    if(e.lunge) { damagePlayer(e.spec.damage,{enemy:e,unblockable:true}); return; }
    if(distance>e.spec.reach+.45)return;                     /* a whiff */
    damagePlayer(e.spec.damage,{enemy:e});
  }
  function resolveCut(e) {
    const match=STANCE_TARGET[stance]===e.type;
    if(e.type==='shieldman' && stance!=='water' && random()<ENEMY_TYPES.shieldman.block) { e.block(); audio.guard?.(); emit(); return; }
    const died=e.hit(CUT_DAMAGE*(match?STANCE_BONUS:1)*(e.vulnerable?2:1),{stagger:match});
    if(died)audio.death?.(); else {audio.hit?.();if(match)audio.stagger?.();}
    emit();
  }
  function restart() { if(disposed)return; beginRun(false); if(!active && physics){active=true;audio.setActive(true);} emit(); }

  function keydown(e) {
    if (!active) return;
    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyE','KeyM','KeyF','KeyQ','Enter','Escape','Digit1','Digit2','Digit3','Digit4'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if(!e.repeat && e.code === 'KeyE') toggleSword();
    if(!e.repeat && e.code === 'Space') { if(inStandoff()) holdStandoff(true); else attack(); }
    if(!e.repeat && e.code === 'KeyF') guard(true);
    if(!e.repeat && e.code === 'KeyQ') dodge();
    if(!journey && !e.repeat && e.code === 'Enter' && (gamePhase==='dead' || gamePhase==='victory')) restart();
    if(!e.repeat && e.code === 'KeyM') toggleSound();
    if(!e.repeat && /^Digit[1-4]$/.test(e.code)) setStance(STANCES[Number(e.code[5])-1]);
    if(e.code === 'Escape') pause();
  }
  function toggleSound(){sound=audio.setEnabled(!sound);emit();}
  const keyup = e => { keys.delete(e.code); if(e.code==='Space') holdStandoff(false); if(e.code==='KeyF') guard(false); };
  function move(e) {
    if (!active) return;
    if(document.pointerLockElement === canvas || dragging) {
      const dx = document.pointerLockElement === canvas ? e.movementX : e.clientX-lastX;
      const dy = document.pointerLockElement === canvas ? e.movementY : e.clientY-lastY;
      yaw -= dx*.003; pitch = clamp(pitch+dy*.0025,-.18,.9);
      if(dx||dy) mouseAt=time;
    }
    lastX=e.clientX; lastY=e.clientY;
  }
  function pointerdown(e) {
    if(!active) return;
    lastX=e.clientX; lastY=e.clientY;
    if(e.button === 2 || e.pointerType === 'touch') { dragging = true; canvas.setPointerCapture(e.pointerId); }
    /* the click that dismissed the entry screen must not also draw the sword */
    else if(e.button === 0 && performance.now() - startedAt > 250) { if(inStandoff()) holdStandoff(true); else attack(); }
  }
  const pointerup = e => { dragging=false; if(e.button!==2) holdStandoff(false); };
  const contextmenu = e => e.preventDefault();
  const lockchange = () => { if(active && document.pointerLockElement !== canvas) pause(); };
  const hidden = () => { if(document.hidden) pause(); };
  const listenerPairs = [[window,'keydown',keydown],[window,'keyup',keyup],[window,'blur',pause],
    [document,'visibilitychange',hidden],[document,'pointerlockchange',lockchange],
    [canvas,'pointermove',move],[canvas,'pointerdown',pointerdown],[canvas,'pointerup',pointerup],
    [canvas,'pointercancel',pointerup],[canvas,'contextmenu',contextmenu]];
  listenerPairs.forEach(([el,event,fn]) => el.addEventListener(event,fn));

  function groundAt(x,z,y) {
    ray.set(origin.set(x,y+.36,z),down); ray.far=.85;
    const hit=ray.intersectObjects(solids,false).find(h=>h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .45);
    return hit?.point.y;
  }
  const yawTo=e=>Math.atan2(-(e.position.x-position.x),-(e.position.z-position.z));
  function update(dt) {
    dt = clamp(dt, 0, .05);
    player.visible = gamePhase!=='title';
    const dead=gamePhase==='dead';
    const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    const right=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    const moving=active && gamePhase!=='arrival' && !dead && !lunge && (forward !== 0 || right !== 0);
    const run=keys.has('ShiftLeft')||keys.has('ShiftRight');
    const cutting = swing > .15;
    const topSpeed = (cutting ? .65 : drawn ? (run ? 4.4 : 2.4) : (run ? 5.6 : 2.8))*(hitReact>0?.4:1);
    requested.set(0,0,0);
    if(moving) {
      const angle=yaw+Math.atan2(-right,forward);
      requested.set(-Math.sin(angle),0,-Math.cos(angle)).multiplyScalar(topSpeed);
    }
    if(active && moving) skipStandoff();
    // Velocity survives key release, so the body actually travels through its
    // braking step. Reversal decelerates first rather than pivoting at full speed.
    const response = cutting ? 20 : moving ? 8 : 14;
    velocity.lerp(requested, 1-Math.exp(-response*dt));
    /* the dodge and the standoff lunge own the capsule for their burst */
    if(active && dodgeT>0 && dodgeT>DODGE_TIME-DODGE_MOVE) velocity.copy(dodgeDir).multiplyScalar(DODGE_DISTANCE/DODGE_MOVE);
    if(active && lunge) {
      lunge.t+=dt; const e=lunge.enemy, d=Math.hypot(e.position.x-position.x,e.position.z-position.z);
      if(d>CUT_REACH-.2 && lunge.t<.6) velocity.set(e.position.x-position.x,0,e.position.z-position.z).normalize().multiplyScalar(9);
      else { velocity.set(0,0,0); player.rotation.y=yawTo(e); lunge=null; beginSwing(); killPending=e; }
    }
    if(velocity.lengthSq()<.0004 || !active || gamePhase==='arrival') velocity.set(0,0,0);
    previous.copy(position);
    if(active && physics) {
      physics.move(velocity.x*dt,velocity.z*dt,dt,position);
    }
    const dx=position.x-previous.x, dz=position.z-previous.z;
    const travel=Math.hypot(dx,dz);
    speed=dt>0 ? travel/dt : 0;
    // Remove blocked velocity; animation is based only on distance achieved.
    if(Math.abs(dx)<.00001) velocity.x=0;
    if(Math.abs(dz)<.00001) velocity.z=0;
    let turn=0;
    if(speed>.08 && !cutting && dodgeT<=0) {
      const angle=Math.atan2(-dx,-dz);
      const delta=wrap(angle-player.rotation.y);
      turn=delta*(1-Math.exp(-11*dt));
      player.rotation.y+=turn;
    }
    const nearest=pool.nearest(position);
    if(active && !dead) {
      /* facing in a fight: the cut turns toward its target, and an idle, drawn wanderer squares up to the nearest fighter */
      if(swing>SWING_TIME-.25 && swingTarget?.alive) player.rotation.y+=wrap(yawTo(swingTarget)-player.rotation.y)*(1-Math.exp(-14*dt));
      else if(!moving && !cutting && !lunge && drawn && gamePhase==='fight' && nearest && nearest.distance<5) {
        const delta=wrap(yawTo(nearest)-player.rotation.y); if(Math.abs(delta)<=100*Math.PI/180) player.rotation.y+=delta*(1-Math.exp(-5*dt));
      }
    }
    turnLean=THREE.MathUtils.damp(turnLean,dt>0?clamp(turn/dt,-3,3)*Math.min(speed/5.6,1):0,9,dt);
    gaitSpeed=THREE.MathUtils.damp(gaitSpeed,speed,18,dt);
    if(active) {
      const strideLength=THREE.MathUtils.lerp(1.65,2.35,clamp((speed-2.8)/2.8,0,1));
      phase+=travel/strideLength*Math.PI*2;
      swing=Math.max(0,swing-dt);drawTime=Math.max(0,drawTime-dt);time+=dt;
      if(gamePhase!=='title') seconds+=dt;
      hitFlash=Math.max(0,hitFlash-dt*2); dodgeT=Math.max(0,dodgeT-dt); hitReact=Math.max(0,hitReact-dt); if(deadT>=0)deadT+=dt;
      if(gamePhase==='roam' && !encounterDone && Math.abs(position.x)<8 && position.z<10 && position.z>-10) {
        gamePhase='arrival'; arrivalTime=0; resetInput(); emit();
      }
      if(gamePhase==='arrival') {
        arrivalTime+=dt; yaw=0; pitch=.22;
        if(arrivalTime>=4.2) { position.set(0,.02,7);physics?.reset(position);player.rotation.y=0;cameraReady=false;nextWave(); }
      }
      /* the post grade follows the fight: a hit dips the exposure, a standoff
         (and the end cards) deepen the vignette */
      if(grade){ grade.hit=hitFlash; const want=inStandoff()?1:(gamePhase==='dead'||gamePhase==='victory')?.6:0; grade.standoff+= (want-grade.standoff)*(1-Math.exp(-4*dt)); }
      if(drawTime===0 && queuedAttack){queuedAttack=false;beginSwing();}
      if(Math.floor(phase/Math.PI)>stepPhase && speed>.3){audio.step(Math.abs(position.x)<13,speed>3.5);stepPhase=Math.floor(phase/Math.PI);}
      if(swing>0 && swing<.55 && !cutSound){audio.sword();cutSound=true;}
      if(banner && seconds>=banner.until) banner=null;
      if(standoff && standoff.result && standoffLinger>=0 && time>=standoffLinger) { standoff=null; standoffLinger=-1; }
      /* the standoff: the lead takes its mark, the drum, the flinch, the verdict */
      if(inStandoff() && standoffLead) {
        if(standoffAt<0 && standoffLead.mode==='standoff') { standoffAt=time; flinchDelay=standoffFlinchAt ?? STANDOFF_FLINCH[0]+random()*(STANDOFF_FLINCH[1]-STANDOFF_FLINCH[0]); audio.standoffDrum?.(true); emit(); }
        if(standoffAt>=0 && !standoff.flinched && time-standoffAt>=flinchDelay) { standoff.flinched=true; flinchTime=time; standoffLead.flinch(); audio.flinch?.(); emit(); }
        if(standoff.flinched && time-flinchTime>STANDOFF_LATE) resolveStandoff('late');
      }
      /* late arrivals walk in from the gate */
      if(fighting()) for(const p of pending.splice(0).filter(p=>{if(time>=p.at){pool.spawn(p.type,{x:p.x,z:TORII_Z});return false;}return true;})) pending.push(p);
    }
    player.position.copy(position);
    /* enemies move after the wanderer, so their reach reads off this frame's position */
    pool.update(active?dt:0,{player:position,playerDead:dead,tokenAllowed:gamePhase==='fight' && !lunge && !killPending,onStrike});
    /* the cut: one hit per fighter per swing, inside the window, the reach and the cone */
    const swingT=swing>0?1-swing/SWING_TIME:-1;
    if(active && !dead && swingT>=CUT_WINDOW[0] && swingT<=CUT_WINDOW[1]) {
      if(killPending) { const e=killPending; killPending=null; hitThisSwing.add(e.id); if(e.alive){e.kill();audio.death?.();} gamePhase='fight'; standoffLinger=time+STANDOFF_LINGER; releaseEnemies(); emit(); }
      for(const e of pool.living()) {
        if(hitThisSwing.has(e.id))continue;
        if(e.distance>CUT_REACH+.25*e.spec.scale || Math.abs(wrap(yawTo(e)-player.rotation.y))>CUT_CONE)continue;
        hitThisSwing.add(e.id); resolveCut(e);
      }
    }
    /* the wave */
    if(active && !practice) {
      if(gamePhase==='fight' && !pending.length && !lunge && !killPending && !pool.living().length) {
        standoff=null; standoffLinger=-1;
        if(wave>=WAVES.length) victory();
        else { gamePhase='clear'; clearUntil=time+CLEAR_TIME; health=Math.min(PLAYER_HEALTH,health+CLEAR_HEAL); setBanner(BANNERS.clear); emit(); }
      } else if(gamePhase==='clear' && time>=clearUntil) nextWave();
    }
    /* frame order: rig cycle → Quaternius retarget → pose-clip layers →
       foot IK → skinned body → sword trail → camera */
    const attackClip=swing>0 && poseClips.has(`attack_${stance}`) ? `attack_${stance}` : null;
    const pose={stance,speed:gaitSpeed/5.6,run:clamp((gaitSpeed-2.8)/2.8,0,1),turnLean,phase,drawn,wind:wind?.strength.value ?? 1,swing:attackClip?-1:swingT,time,dodge:dodgeT>0,
      /* the library's reactions (templeAnimation.js): the dodge is the roll, a hit Hit_Chest */
      react:dodgeT>0?{clip:'Roll',t:1-dodgeT/DODGE_TIME}:hitReact>0?{clip:'Hit_Chest',t:1-hitReact/HIT_REACT}:null};
    samurai.update(active?dt:0,pose);
    motion?.update(active?dt:0,pose);
    if(!attackClip) applyCombatStyle(samurai,pose);
    /* the authored layers (plan B4). The attack envelope is the one the
       Quaternius blend uses, so the clip and Sword_Attack never overlap. */
    const move=THREE.MathUtils.smoothstep(gaitSpeed,.1,.8);
    const attackWeight=swing>0?Math.min(1,swingT*12,(1-swingT)*10):0;
    if(drawTime>0) {
      const clipName=drawn?'draw':'sheathe_chiburi', duration=drawn?DRAW_TIME:sheatheTime();
      const progress=1-drawTime/duration;
      if(poseClips.has(clipName)) {
        const ct=progress*poseClips.duration(clipName);
        poseClips.apply(clipName,ct,clamp(Math.min(progress,1-progress)*8,0,1),'upper');
        const inHand=poseClips.event(clipName,'katanaInHand',ct);
        samurai.katana.visible=inHand===undefined?!drawn:!!inHand;
      } else {
        const reach=Math.sin(Math.PI*progress);
        samurai.joints.rightArm.rotation.x+=reach*.85;
        samurai.joints.rightArm.rotation.z-=reach*.75;
        samurai.joints.rightForearm.rotation.x+=reach*.6;
        samurai.katana.visible=drawn?progress>.45:progress<.55;
      }
      samurai.sheathedHilt.visible=!samurai.katana.visible;
    } else if(attackClip) {
      poseClips.apply(attackClip,swingT*poseClips.duration(attackClip),attackWeight,'full');
    } else if(!drawn) {
      poseClips.apply('saya_hold',time,move,'leftArm');
      poseClips.apply('idle_hand_on_hilt',time,1-move,'arms');
    } else {
      /* the stance: whole body at rest, upper body only once the legs are walking */
      const idle=`stance_${stance}_idle`;
      poseClips.apply(idle,time,1-attackWeight,'upper');
      poseClips.apply(idle,time,(1-move)*(1-attackWeight),'lower');
    }
    /* the fight's procedural layers: the guard, the fall, and without the
       retarget (which plays Roll and Hit_Chest from `pose.react`) the dodge
       crouch and the hit */
    const J=samurai.joints;
    guardBlend=THREE.MathUtils.damp(guardBlend,guarding()&&swing<=0&&drawTime<=0?1:0,12,dt);
    if(guardBlend>.001) { const g=guardBlend; J.rightArm.rotation.x+=.75*g; J.rightArm.rotation.z-=.25*g; J.rightForearm.rotation.x+=.55*g; J.leftArm.rotation.x+=.6*g; J.leftArm.rotation.z+=.3*g; J.leftForearm.rotation.x+=.7*g; }
    if(dodgeT>0 && !motion) { const k=Math.sin(Math.PI*clamp(1-dodgeT/DODGE_TIME,0,1)); J.hips.position.y-=.32*k; J.chest.rotation.x-=.45*k; J.head.rotation.x+=.2*k; J.leftArm.rotation.x+=.4*k; J.rightArm.rotation.x+=.4*k; }
    if(hitReact>0 && !motion) { const k=Math.sin(Math.PI*clamp(1-hitReact/HIT_REACT,0,1)); J.chest.rotation.x+=.35*k; J.head.rotation.x+=.25*k; }
    if(dead && deadT>=0) { const t=clamp(deadT/DEATH_FALL,0,1), fall=t*t*(3-2*t); player.rotation.x=fall*Math.PI*.47; J.hips.position.y-=.25*Math.min(1,deadT/.3); J.leftThigh.rotation.x+=.5*fall; J.rightThigh.rotation.x+=.4*fall; J.leftArm.rotation.z-=.4*fall; J.rightArm.rotation.z+=.5*fall; }
    player.updateMatrixWorld(true);
    if(!dead) plantFeet((x,z,y)=>groundAt(x,z,y-.1),dt,gaitSpeed);
    player.updateMatrixWorld(true);
    body?.sync();
    if(active && swing>.20 && swing<.57) {
      bladeBase.set(0,0,-.12).applyMatrix4(samurai.katana.matrixWorld);
      bladeTip.set(0,0,-.73).applyMatrix4(samurai.katana.matrixWorld);
      bladePoints.unshift([bladeBase.clone(),bladeTip.clone()]);if(bladePoints.length>12)bladePoints.pop();
    } else bladePoints.pop();
    let vertex=0;for(let i=1;i<bladePoints.length;i++)for(const point of [bladePoints[i-1][0],bladePoints[i-1][1],bladePoints[i][0],bladePoints[i][0],bladePoints[i-1][1],bladePoints[i][1]])point.toArray(trailPositions,vertex++*3);
    trailGeometry.setDrawRange(0,vertex);trailGeometry.attributes.position.needsUpdate=true;
    audio.update(wind?.strength.value ?? .7);
    audio.ambience?.({rain:position.y>6 && position.z<-39 && Math.abs(position.x)<15 ? 0 : wind?.strength.value ?? .7,insects:fighting()?.25:1});

    // A damped look target absorbs stair risers. Mouse orbit remains responsive;
    // the small shoulder offset keeps the character out of the path ahead.
    /* with fighters about, the look drifts toward the nearest unless the mouse spoke recently */
    if(active && nearest && fighting() && time-mouseAt>MOUSE_HOLD) yaw+=wrap(yawTo(nearest)-yaw)*(1-Math.exp(-CAMERA_BIAS*dt));
    target.copy(position); target.y+=1.35;
    const angularDelta=wrap(yaw-cameraYaw);
    cameraYaw+=angularDelta*(1-Math.exp(-20*dt));
    cameraPitch=THREE.MathUtils.damp(cameraPitch,pitch,20,dt);
    cameraRight.set(Math.cos(cameraYaw),0,-Math.sin(cameraYaw));
    target.addScaledVector(cameraRight,.32);
    if(!cameraReady) { cameraTarget.copy(target); cameraYaw=yaw; cameraPitch=pitch; cameraReady=true; }
    cameraTarget.x=THREE.MathUtils.damp(cameraTarget.x,target.x,12,dt);
    cameraTarget.z=THREE.MathUtils.damp(cameraTarget.z,target.z,12,dt);
    cameraTarget.y=THREE.MathUtils.damp(cameraTarget.y,target.y,8,dt);
    const sprint=clamp((gaitSpeed-2.8)/2.8,0,1);
    desired.set(Math.sin(cameraYaw)*Math.cos(cameraPitch),.16+Math.sin(cameraPitch),Math.cos(cameraYaw)*Math.cos(cameraPitch)).normalize();
    let safeDistance=position.y>6 && position.z<-38 && Math.abs(position.x)<15 ? 2.2 : 5.6+sprint*.55;
    // Probe a small camera volume, not only its centre, to protect near edges.
    for(const [horizontal,vertical] of [[0,0],[.20,0],[-.20,0],[0,.16],[0,-.16]]) {
      probeOrigin.copy(cameraTarget).addScaledVector(cameraRight,horizontal); probeOrigin.y+=vertical;
      ray.set(probeOrigin,desired); ray.far=safeDistance+.25;
      const hit=ray.intersectObjects(solids,false)[0];
      if(hit) safeDistance=Math.min(safeDistance,Math.max(.12,hit.distance-.25));
    }
    // Pull in immediately to avoid clipping, then ease back out of obstructions.
    cameraDistance=safeDistance<cameraDistance?safeDistance:THREE.MathUtils.damp(cameraDistance,safeDistance,4,dt);
    camera.position.copy(cameraTarget).addScaledVector(desired,cameraDistance);
    camera.lookAt(cameraTarget);
    const fov=THREE.MathUtils.damp(camera.fov,55+sprint*3,5,dt);
    if(Math.abs(camera.fov-fov)>.001 || camera.near!==.08) { camera.fov=fov; camera.near=.08; camera.updateProjectionMatrix(); }
    /* the continuous fields (distances, flash, clock) reach subscribers ten times a second */
    if(active && time-emitAt>.1) emit();
  }
  return {
    update, ready, animationReady, bodyReady, clipsReady, position, toggleSound, enemies:pool,
    look(horizontal,vertical=0){yaw+=horizontal;pitch=clamp(pitch+vertical,-.18,.9);mouseAt=time;},
    recordFrame(raw){if(raw>0 && raw<.3){frameSeconds+=raw;frameCount++;if(frameSeconds>1){fps=Math.round(frameCount/frameSeconds);frameSeconds=frameCount=0;}}},
    getState,
    /* start() enters the standoff of wave 1 (or resumes a paused run); { practice: true } is the open grounds with no waves */
    start(options={}) { if(!physics || disposed)return;
      const fresh=options.restart===true || gamePhase==='title' || gamePhase==='dead' || gamePhase==='victory' || !!options.practice!==practice;
      /* a second start() mid-run (a stray "press any key", a focused button
         taking Space) must not clear the input, drop a standoff hold or
         re-request pointer lock: it is a no-op unless the run is over */
      if(active && !fresh) return;
      if(fresh) beginRun(!!options.practice); active=true;audio.setActive(true); startedAt=performance.now(); resetInput(); emit(); const result=canvas.requestPointerLock?.(); result?.catch?.(()=>{}); },
    continueExploring() { if(gamePhase!=='victory')return; pool.clear();encounterDone=true;gamePhase='roam';drawn=false;drawTime=0;resetInput();active=true;audio.setActive(true);emit();const lock=canvas.requestPointerLock?.();lock?.catch?.(()=>{}); },
    returnToTitle() { pause(); beginRun(true); practice=false; gamePhase="title";position.set(0,.02,7);physics?.reset(position);cameraReady=false; emit(); },
    pause, restart, attack, holdStandoff, guard, parry, dodge, toggleSword, setStance,
    /* a fighter on demand, for practice and tests */
    spawnEnemy(type,options){ return pool.spawn(type,options); },
    setKey(key,pressed) { if(pressed && active) keys.add(key); else keys.delete(key); },
    subscribe(fn) { listeners.add(fn); fn(getState()); return ()=>listeners.delete(fn); },
    dispose() { disposed=true;pause();pool.dispose();physics?.dispose();motion?.dispose();body?.dispose();audio.dispose();trailGeometry.dispose();trail.material.dispose();scene.remove(trail);listenerPairs.forEach(([el,event,fn])=>el.removeEventListener(event,fn)); },
  };
}
