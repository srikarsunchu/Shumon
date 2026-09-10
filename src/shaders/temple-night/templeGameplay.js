import * as THREE from 'three';
import { createSamurai } from './templeSamurai.js';
import { createTemplePhysics } from './templePhysics.js';
import { loadAuthoredMotion, createFootPlant } from './templeAnimation.js';
import { createTempleAudio } from './templeAudio.js';
import { loadBody } from './templeBody.js';
import { createPoseClips } from './templePoseClips.js';

const clamp = THREE.MathUtils.clamp;
/* browser-only loaders (GLB body, pose clips) are gated on a real DOM; the
   Node test stubs document as a bare EventTarget */
const CANVAS = typeof document !== 'undefined' && typeof document.createElement === 'function';
export const STANCES = ['stone', 'water', 'wind', 'moon'];
/* the authored pose clips (plan B6), each optional: a missing file leaves
   that behaviour to the procedural rig and the Quaternius library */
export const CLIP_NAMES = ['idle_hand_on_hilt', 'saya_hold', 'draw', 'sheathe_chiburi',
  'stance_stone_idle', 'stance_water_idle', 'stance_wind_idle', 'stance_moon_idle',
  'attack_stone', 'attack_water', 'attack_wind', 'attack_moon'];
const DRAW_TIME = .5, SHEATHE_TIME = .4, SHEATHE_CLIP_TIME = .9, SWING_TIME = .85;

// Rapier owns movement collision; mesh queries supply foot placement and camera clearance.
/* `clips` (name → clip JSON) seeds the pose clips without fetching, for tests */
export function createTempleGameplay({ scene, camera, canvas, wind, clips }) {
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
  let frameSeconds=0,frameCount=0,fps=0;
  let cameraReady = false, cameraDistance = 5.6, cameraYaw = 0, cameraPitch = .22;
  let gaitSpeed = 0, turnLean = 0;
  let active = false, yaw = 0, pitch = .22, swing = 0, drawn = false, phase = 0;
  let speed = 0, dragging = false, lastX = 0, lastY = 0;
  let notify = () => {};
  let startedAt = -1;

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
  const animationReady=CANVAS ? loadAuthoredMotion(samurai).then(value=>{
    if(disposed)value.dispose();else {motion=value;motionStatus='authored';emit();}
  }).catch(error=>{motionStatus='fallback';console.warn('Authored animation unavailable; procedural samurai retained.',error);emit();}) : Promise.resolve();
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

  function emit() { notify({ active, drawn, sound, motionStatus, stance, body: bodyStatus, clips: poseClips.names }); }
  function resetInput() { keys.clear(); dragging = false; speed = 0; gaitSpeed = 0; velocity.set(0,0,0); }
  function pause() { active = false; audio.setActive(false); resetInput(); if(document.pointerLockElement === canvas) document.exitPointerLock(); emit(); }
  /* the sheathe takes the chiburi's length when that clip is authored */
  const sheatheTime=()=>poseClips.has('sheathe_chiburi')?SHEATHE_CLIP_TIME:SHEATHE_TIME;
  function attack() { if(active && swing <= 0) { if(drawTime>0)return; if(!drawn){drawTime=DRAW_TIME;audio.draw();queuedAttack=true;drawn=true;} else swing=SWING_TIME; cutSound=false;emit(); } }
  function toggleSword() { if(active && swing <= 0 && drawTime<=0) { drawn = !drawn; drawTime=drawn?DRAW_TIME:sheatheTime(); audio.draw(); emit(); } }
  function setStance(name) { if(!STANCES.includes(name))throw new Error(`Unknown stance: ${name}`); if(stance!==name){stance=name;emit();} return stance; }
  function keydown(e) {
    if (!active) return;
    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyE','KeyM','Escape','Digit1','Digit2','Digit3','Digit4'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if(!e.repeat && e.code === 'KeyE') toggleSword();
    if(!e.repeat && e.code === 'Space') attack();
    if(!e.repeat && e.code === 'KeyM') toggleSound();
    if(!e.repeat && /^Digit[1-4]$/.test(e.code)) setStance(STANCES[Number(e.code[5])-1]);
    if(e.code === 'Escape') pause();
  }
  function toggleSound(){sound=audio.setEnabled(!sound);emit();}
  const keyup = e => keys.delete(e.code);
  function move(e) {
    if (!active) return;
    if(document.pointerLockElement === canvas || dragging) {
      const dx = document.pointerLockElement === canvas ? e.movementX : e.clientX-lastX;
      const dy = document.pointerLockElement === canvas ? e.movementY : e.clientY-lastY;
      yaw -= dx*.003; pitch = clamp(pitch+dy*.0025,-.18,.9);
    }
    lastX=e.clientX; lastY=e.clientY;
  }
  function pointerdown(e) {
    if(!active) return;
    lastX=e.clientX; lastY=e.clientY;
    if(e.button === 2 || e.pointerType === 'touch') { dragging = true; canvas.setPointerCapture(e.pointerId); }
    /* the click that dismissed the entry screen must not also draw the sword */
    else if(e.button === 0 && performance.now() - startedAt > 250) attack();
  }
  const pointerup = () => { dragging=false; };
  const contextmenu = e => e.preventDefault();
  const lockchange = () => { if(active && document.pointerLockElement !== canvas) pause(); };
  const hidden = () => { if(document.hidden) pause(); };
  const listeners = [[window,'keydown',keydown],[window,'keyup',keyup],[window,'blur',pause],
    [document,'visibilitychange',hidden],[document,'pointerlockchange',lockchange],
    [canvas,'pointermove',move],[canvas,'pointerdown',pointerdown],[canvas,'pointerup',pointerup],
    [canvas,'pointercancel',pointerup],[canvas,'contextmenu',contextmenu]];
  listeners.forEach(([el,event,fn]) => el.addEventListener(event,fn));

  function groundAt(x,z,y) {
    ray.set(origin.set(x,y+.36,z),down); ray.far=.85;
    const hit=ray.intersectObjects(solids,false).find(h=>h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .45);
    return hit?.point.y;
  }
  function update(dt) {
    dt = clamp(dt, 0, .05);
    player.visible = true;
    const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
    const right=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
    const moving=active && (forward !== 0 || right !== 0);
    const run=keys.has('ShiftLeft')||keys.has('ShiftRight');
    const cutting = swing > .15;
    const topSpeed = cutting ? .65 : drawn ? (run ? 4.4 : 2.4) : (run ? 5.6 : 2.8);
    requested.set(0,0,0);
    if(moving) {
      const angle=yaw+Math.atan2(-right,forward);
      requested.set(-Math.sin(angle),0,-Math.cos(angle)).multiplyScalar(topSpeed);
    }
    // Velocity survives key release, so the body actually travels through its
    // braking step. Reversal decelerates first rather than pivoting at full speed.
    const response = cutting ? 20 : moving ? 8 : 14;
    velocity.lerp(requested, 1-Math.exp(-response*dt));
    if(velocity.lengthSq()<.0004 || !active) velocity.set(0,0,0);
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
    if(speed>.08 && !cutting) {
      const angle=Math.atan2(-dx,-dz);
      const delta=Math.atan2(Math.sin(angle-player.rotation.y),Math.cos(angle-player.rotation.y));
      turn=delta*(1-Math.exp(-11*dt));
      player.rotation.y+=turn;
    }
    turnLean=THREE.MathUtils.damp(turnLean,dt>0?clamp(turn/dt,-3,3)*Math.min(speed/5.6,1):0,9,dt);
    gaitSpeed=THREE.MathUtils.damp(gaitSpeed,speed,18,dt);
    if(active) {
      const strideLength=THREE.MathUtils.lerp(1.65,2.35,clamp((speed-2.8)/2.8,0,1));
      phase+=travel/strideLength*Math.PI*2;
      swing=Math.max(0,swing-dt);drawTime=Math.max(0,drawTime-dt);time+=dt;
      if(drawTime===0 && queuedAttack){queuedAttack=false;swing=.85;cutSound=false;}
      if(Math.floor(phase/Math.PI)>stepPhase && speed>.3){audio.step(Math.abs(position.x)<13,speed>3.5);stepPhase=Math.floor(phase/Math.PI);}
      if(swing>0 && swing<.55 && !cutSound){audio.sword();cutSound=true;}
    }
    player.position.copy(position);
    /* frame order: rig cycle → Quaternius retarget → pose-clip layers →
       foot IK → skinned body → sword trail → camera */
    const attackClip=swing>0 && poseClips.has(`attack_${stance}`) ? `attack_${stance}` : null;
    const swingT=swing>0?1-swing/SWING_TIME:-1;
    const pose={speed:gaitSpeed/5.6,run:clamp((gaitSpeed-2.8)/2.8,0,1),turnLean,phase,drawn,wind:wind?.strength.value ?? 1,swing:attackClip?-1:swingT,time};
    samurai.update(active?dt:0,pose);
    motion?.update(active?dt:0,pose);
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
    player.updateMatrixWorld(true);
    plantFeet((x,z,y)=>groundAt(x,z,y-.1),dt,gaitSpeed);
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

    // A damped look target absorbs stair risers. Mouse orbit remains responsive;
    // the small shoulder offset keeps the character out of the path ahead.
    target.copy(position); target.y+=1.35;
    const angularDelta=Math.atan2(Math.sin(yaw-cameraYaw),Math.cos(yaw-cameraYaw));
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
    let safeDistance=5.6+sprint*.55;
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
  }
  return {
    update, ready, animationReady, bodyReady, clipsReady, position, toggleSound,
    look(horizontal,vertical=0){yaw+=horizontal;pitch=clamp(pitch+vertical,-.18,.9);},
    recordFrame(raw){if(raw>0 && raw<.3){frameSeconds+=raw;frameCount++;if(frameSeconds>1){fps=Math.round(frameCount/frameSeconds);frameSeconds=frameCount=0;}}},
    getState(){return {fps,active,drawn,stance,sound,motion:motionStatus,body:bodyStatus,clips:poseClips.names,physics:!!physics,position:position.toArray(),speed};},
    start() { if(!physics || disposed)return; active=true;audio.setActive(true); startedAt=performance.now(); resetInput(); emit(); const result=canvas.requestPointerLock?.(); result?.catch?.(()=>{}); },
    pause, attack, toggleSword, setStance,
    setKey(key,pressed) { if(pressed && active) keys.add(key); else keys.delete(key); },
    subscribe(fn) { notify=fn; emit(); },
    dispose() { disposed=true;pause();physics?.dispose();motion?.dispose();body?.dispose();audio.dispose();trailGeometry.dispose();trail.material.dispose();scene.remove(trail);listeners.forEach(([el,event,fn])=>el.removeEventListener(event,fn)); },
  };
}
