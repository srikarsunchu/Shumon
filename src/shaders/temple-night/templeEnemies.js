import * as THREE from 'three';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createSamurai } from './templeSamurai.js';
import { loadAuthoredMotion, createFootPlant, TELL } from './templeAnimation.js';
import { equipEnemy, applyCombatStyle } from './templeWeapons.js';
import { loadBody } from './templeBody.js';

/* ===================================================== the gate's fighters
   Enemy fighters for docs/GAME.md: the wanderer's rig and skinned body
   under a straw hat and a mask, in another clan's lacing, each with its
   own Quaternius retarget, foot plant and skin, walked over the ground
   kinematically (a ray for the foot height, soft repulsion between bodies;
   no Rapier capsule). The pool owns the shared attack token: one enemy
   strikes at a time, the rest circle. The controller decides what a strike
   does to the player through `onStrike`; the pool only reports the hit
   frame. With the retarget bound, the tell is the raise of Sword_Attack
   held, a hit plays Hit_Chest, a parry's stagger Hit_Head and a death
   Death01 held until the fade; without it (the Node tests, a failed load)
   the procedural layers below stand in. A fighter stays hidden and still
   until its motion and body are bound, so nothing pops. */

const clamp = THREE.MathUtils.clamp;
const CANVAS = typeof document !== 'undefined' && typeof document.createElement === 'function';
export const ENEMY_TYPES = {
  swordsman: { health: 80,  damage: 22, reach: 2.0, walk: 2.4, strafe: 1.3, scale: 1, palette: 'raider' },
  shieldman: { health: 110, damage: 22, reach: 1.9, walk: 2.1, strafe: 1.1, scale: 1, block: .5, palette: 'ash' },
  spearman:  { health: 90,  damage: 22, reach: 2.7, walk: 2.5, strafe: 1.4, scale: 1, palette: 'raider' },
  brute:     { health: 160, damage: 38, reach: 2.2, walk: 2.0, strafe: .9,  scale: 1.12, palette: 'iron' },
};
/* the attack: raised blade, the cut, the recovery; the hit frame sits .15 s into the cut */
export const TELEGRAPH = .6, STRIKE = .25, HIT_FRAME = .15, RECOVERY = .8;
export const STAGGER_TIME = 1.4, HIT_TIME = .33, DEATH_TIME = 2.38, FADE_AT = 2.5, FADE_TIME = .8;
/* the parry's reel: Hit_Head slowed over the first part of the stagger */
export const STAGGER_CLIP = .9;
export const STANDOFF_DISTANCE = 6, RING = [2.4, 3.2], TORII_Z = -8.6;
const STRIDE = 1.65, SEPARATION = 1.15, PLAYER_ROOM = .95, READY_TIMEOUT = 8;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/* the shared mannequin is cloned per enemy so the mixers never fight; the
   skinned mesh comes off the clone (only its bones are read), so a clone's
   dispose can never gut the geometry the original still uses */
function bonesOnly(gltf) {
  const scene = cloneRig(gltf.scene), meshes = [];
  scene.traverse(o => { if (o.isMesh) { let bone = false; o.traverse(c => { if (c.isBone) bone = true; }); if (!bone) meshes.push(o); } });
  meshes.forEach(m => m.removeFromParent());
  return { scene, animations: gltf.animations };
}

/* bodyLoader(rig) → Promise<body> dresses a fighter in the skinned body; the
   default loads its own copy of the GLB per fighter, no face painting, and
   is off under Node (no fetch, no canvas) where the procedural rig stands */
export function createEnemyPool({ scene, solids, samuraiFactory = createSamurai, animationData = null, random = Math.random,
  bodyLoader = CANVAS ? rig => loadBody(rig, { face: false }) : null }) {
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), origin = new THREE.Vector3();
  const enemies = [];
  const token = { holder: null, cooldown: 1.2 };
  let nextId = 1, gltf = null, disposed = false, killed = 0;
  const motionReady = Promise.resolve(animationData).then(v => { gltf = v || null; }).catch(error => console.warn('Enemy animation unavailable; procedural rigs retained.', error));

  function groundAt(x, z, y) {
    ray.set(origin.set(x, y + .36, z), down); ray.far = .85;
    const hit = ray.intersectObjects(solids, false).find(h => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .45);
    return hit?.point.y;
  }
  function attachMotion(e) {
    return motionReady.then(() => {
      if (!gltf || e.removed || disposed) return;
      return loadAuthoredMotion(e.rig, bonesOnly(gltf)).then(m => { if (e.removed || disposed) m.dispose(); else e.motion = m; });
    }).catch(error => console.warn('Enemy retarget failed; procedural rig retained.', error));
  }
  function attachBody(e) {
    return Promise.resolve().then(() => bodyLoader(e.rig)).then(b => { if (e.removed || disposed) b.dispose(); else e.body = b; })
      .catch(error => console.warn('Enemy body unavailable; procedural rig retained.', error));
  }
  function releaseToken(e) { if (token.holder === e) { token.holder = null; token.cooldown = 1.8 + random() * 1.2; } e.holdsToken = false; }
  function endAttack(e, mode = 'circle') { releaseToken(e); e.attackT = -1; e.lunge = false; if (e.mode === 'attack') e.mode = mode; }
  function beginAttack(e, lunge = false) { e.mode = 'attack'; e.attackT = 0; e.struck = false; e.lunge = lunge; e.drawn = true; }

  function spawn(type, { x = 0, z = TORII_Z, standoff = false, yaw = 0 } = {}) {
    const spec = ENEMY_TYPES[type]; if (!spec) throw new Error(`Unknown enemy type: ${type}`);
    const rig = samuraiFactory({ hat: true, mask: true, palette: spec.palette, lights: false });
    const group = rig.group; group.name = `Enemy ${type} ${nextId}`; group.scale.setScalar(spec.scale);
    /* a factory of its own may still bring the wanderer's two face lights; a crowd of them would recompile every material */
    const lights = []; group.traverse(o => { if (o.isLight) lights.push(o); }); lights.forEach(l => l.removeFromParent());
    scene.add(group);
    const y = groundAt(x, z, 0) ?? groundAt(x, z, 1) ?? 0;
    const e = {
      id: nextId++, type, spec, rig, group, equipment: equipEnemy(rig,type), motion: null, body: null, plantFeet: createFootPlant(rig),
      /* ready: every loader has answered; shown: the first bound frame has been posed and synced */
      ready: false, shown: false, waitT: 0,
      position: new THREE.Vector3(x, y, z), velocity: new THREE.Vector3(), yaw, distance: Infinity,
      health: spec.health, maxHealth: spec.health, alive: true, removed: false,
      mode: 'enter', standoff, drawn: !standoff, holdsToken: false, vulnerable: false,
      timer: 0, attackT: -1, struck: false, lunge: false, hitT: 0, flinchT: 0, deadT: -1, faded: 0,
      ring: RING[0] + random() * (RING[1] - RING[0]), strafe: random() < .5 ? -1 : 1, strafeT: 2 + random() * 2,
      phase: 0, gait: 0, time: random() * 10,
      hitIn() { return e.mode === 'attack' && !e.struck ? TELEGRAPH + HIT_FRAME - e.attackT : Infinity; },
      state() { return { id: e.id, type: e.type, health: Math.max(0, e.health), maxHealth: e.maxHealth, alive: e.alive, attacking: e.mode === 'attack', staggered: e.mode === 'stagger', distance: e.distance }; },
      /* the standoff tell: a twitch of the sword arm and shoulders */
      flinch() { e.flinchT = .35; },
      /* the standoff over: draw and join the circle */
      release() { if (e.mode === 'standoff' || e.mode === 'enter') e.mode = 'circle'; e.standoff = false; e.drawn = true; },
      /* the late standoff: this enemy takes the token and lunges */
      strikeNow() { if (!e.alive) return; if (token.holder && token.holder !== e) releaseToken(token.holder); token.holder = e; e.holdsToken = true; e.standoff = false; beginAttack(e, true); },
      stagger() { if (!e.alive) return; endAttack(e); e.mode = 'stagger'; e.timer = STAGGER_TIME; e.standoff = false; e.drawn = true; e.hitT = HIT_TIME; },
      block() { if (!e.alive) return; e.hitT = HIT_TIME * .6; },
      /* a cut landed: true when it killed. A telegraph is broken by any hit; a cut already in motion carries through. */
      hit(damage, { stagger = false } = {}) {
        if (!e.alive) return false;
        e.health -= damage; e.vulnerable = false; e.hitT = HIT_TIME;
        if (e.health <= 0) { e.die(); return true; }
        if (stagger) e.stagger();
        else if (e.mode !== 'attack' || e.attackT < TELEGRAPH) { endAttack(e); e.mode = 'hit'; e.timer = HIT_TIME; e.standoff = false; e.drawn = true; }
        return false;
      },
      kill() { if (e.alive) { e.health = 0; e.die(); } },
      die() { e.alive = false; e.health = 0; killed++; endAttack(e, 'dead'); e.mode = 'dead'; e.deadT = 0; e.velocity.set(0, 0, 0); },
    };
    e.group.position.copy(e.position); e.group.rotation.y = yaw;
    /* with a skin to load, the fighter is hidden and held at its mark until
       the retarget and the skin are both on. A bare rig (the tests, a page
       without the body) walks at once and takes its motion whenever it lands:
       the wait is decided here, synchronously, so a stepping loop that never
       yields to the microtask queue still gets a fighter that moves */
    const motion = attachMotion(e);
    if (bodyLoader) { group.visible = false; Promise.allSettled([motion, attachBody(e)]).then(() => { e.ready = true; }); }
    else e.ready = e.shown = true;
    enemies.push(e);
    return e;
  }

  const joints = e => e.rig.joints;
  const dir = new THREE.Vector3();
  function updateEnemy(e, dt, ctx) {
    const s = e.spec, p = ctx.player;
    const dx = p.x - e.position.x, dz = p.z - e.position.z, d = Math.hypot(dx, dz);
    const nx = d > 1e-6 ? dx / d : 0, nz = d > 1e-6 ? dz / d : 1;
    e.distance = d; e.time += dt; e.timer -= dt;
    const want = dir.set(0, 0, 0);
    let swing = -1, telegraph = 0, faceYaw = Math.atan2(-nx, -nz);
    if (e.mode === 'dead') {
      e.deadT += dt; faceYaw = e.yaw;
    } else if (ctx.playerDead) {
      /* the fight is over: lower the blade and stand */
      if (e.mode === 'attack') endAttack(e); if (e.mode !== 'stagger' && e.mode !== 'hit') e.mode = 'idle';
      if (e.timer < -1.5) e.drawn = false;
    } else switch (e.mode) {
      case 'idle': e.mode = 'circle'; e.drawn = true; break;
      case 'enter': {
        const stop = e.standoff ? STANDOFF_DISTANCE : e.ring;
        if (d > stop) { want.set(nx, 0, nz).multiplyScalar(s.walk); faceYaw = Math.atan2(-nx, -nz); }
        else e.mode = e.standoff ? 'standoff' : 'circle';
        break;
      }
      case 'standoff': break;                         /* held still; the controller times the flinch */
      case 'circle': {
        if (e.holdsToken) {
          if (d > s.reach - .15) want.set(nx, 0, nz).multiplyScalar(s.walk); else beginAttack(e);
        } else {
          e.strafeT -= dt; if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = 2 + random() * 2.5; }
          const radial = clamp((d - e.ring) * 1.5, -1, 1) * s.strafe, side = e.strafe * s.strafe * .8;
          want.set(nx * radial - nz * side, 0, nz * radial + nx * side);
        }
        break;
      }
      case 'attack': {
        e.attackT += dt;
        if (e.attackT < TELEGRAPH) {
          /* the tell: the raise of the cut, held at the top */
          telegraph = e.attackT / TELEGRAPH;
          if (e.lunge) want.set(nx, 0, nz).multiplyScalar(clamp((d - s.reach + .5) * 4, 0, 9));
          else if (d > s.reach - .4) want.set(nx, 0, nz).multiplyScalar(.8);
        } else if (e.attackT < TELEGRAPH + STRIKE) {
          /* the cut resumes from the tell and accelerates into the blade's pass, just ahead of the hit frame */
          const t = (e.attackT - TELEGRAPH) / STRIKE; swing = TELL + (.62 - TELL) * t * t;
          if (!e.struck && e.attackT - TELEGRAPH >= HIT_FRAME) { e.struck = true; ctx.onStrike?.(e, d); }
        } else if (e.attackT < TELEGRAPH + STRIKE + RECOVERY) swing = .62 + (e.attackT - TELEGRAPH - STRIKE) / RECOVERY * .38;
        else endAttack(e);
        break;
      }
      case 'stagger': if (e.timer <= 0) e.mode = 'circle'; break;
      case 'hit': if (e.timer <= 0) e.mode = 'circle'; break;
    }
    if (e.mode === 'dead') want.set(0, 0, 0);
    e.velocity.lerp(want, 1 - Math.exp(-8 * dt));
    if (e.velocity.lengthSq() < .0004) e.velocity.set(0, 0, 0);
    const px = e.position.x, pz = e.position.z;
    e.position.x += e.velocity.x * dt; e.position.z += e.velocity.z * dt;
    /* soft repulsion between fighters, and never through the player */
    if (e.alive) {
      for (const o of enemies) {
        if (o === e || !o.alive) continue;
        const ox = e.position.x - o.position.x, oz = e.position.z - o.position.z, od = Math.hypot(ox, oz);
        if (od < SEPARATION && od > 1e-6) { const push = (SEPARATION - od) * .5; e.position.x += ox / od * push; e.position.z += oz / od * push; }
      }
      const rx = e.position.x - p.x, rz = e.position.z - p.z, rd = Math.hypot(rx, rz);
      if (rd < PLAYER_ROOM && rd > 1e-6) { e.position.x = p.x + rx / rd * PLAYER_ROOM; e.position.z = p.z + rz / rd * PLAYER_ROOM; }
    }
    const ground = groundAt(e.position.x, e.position.z, e.position.y);
    if (ground !== undefined) e.position.y = THREE.MathUtils.damp(e.position.y, ground, 20, dt);
    const travel = Math.hypot(e.position.x - px, e.position.z - pz);
    e.gait = THREE.MathUtils.damp(e.gait, dt > 0 ? travel / dt : 0, 18, dt);
    e.phase += travel / STRIDE * Math.PI * 2;
    if (e.mode !== 'dead') e.yaw += wrap(faceYaw - e.yaw) * (1 - Math.exp(-10 * dt));
    e.group.position.copy(e.position); e.group.rotation.y = e.yaw;
    /* the reaction, as a library clip when the retarget is bound */
    const authored = !!e.motion;
    if (e.hitT > 0) e.hitT -= dt;
    let react = null;
    if (e.mode === 'dead') react = { clip: 'Death01', t: e.deadT / DEATH_TIME };
    else if (e.mode === 'stagger') { const el = STAGGER_TIME - e.timer; if (el < STAGGER_CLIP) react = { clip: 'Hit_Head', t: el / STAGGER_CLIP }; }
    else if (e.hitT > 0 && e.mode !== 'attack') react = { clip: 'Hit_Chest', t: 1 - e.hitT / HIT_TIME };
    const pose = { speed: e.gait / 5.6, run: 0, turnLean: 0, phase: e.phase, drawn: e.drawn, wind: 1, swing, telegraph, weapon: e.type, time: e.time, react: authored ? react : null };
    e.rig.update(dt, pose); e.motion?.update(dt, pose);
    applyCombatStyle(e.rig,pose); e.equipment.update();
    /* the standoff's twitch is a tell of its own, on either rig; the reel of
       a stagger keeps a little weight in the knees under the clip */
    const J = joints(e);
    if (e.flinchT > 0) { e.flinchT -= dt; const k = Math.sin(Math.PI * clamp(1 - e.flinchT / .35, 0, 1)); J.rightArm.rotation.x += .55 * k; J.rightArm.rotation.z -= .35 * k; J.chest.rotation.y += .18 * k; J.head.rotation.x += .12 * k; }
    if (e.mode === 'stagger') { const k = Math.sin(Math.PI * clamp(1 - e.timer / STAGGER_TIME, 0, 1)) ** .5 * (authored ? .4 : 1); J.chest.rotation.x += .45 * k; J.hips.position.y -= .14 * k; J.hips.position.z += .1 * k; }
    if (!authored) {
      /* the procedural stand-ins: the hit, the fall */
      if (e.hitT > 0 && e.mode !== 'attack') { const k = Math.sin(Math.PI * clamp(1 - e.hitT / HIT_TIME, 0, 1)); J.chest.rotation.x += .38 * k; J.head.rotation.x += .3 * k; J.hips.position.z += .06 * k; }
      if (e.mode === 'dead') {
        const t = clamp(e.deadT / .9, 0, 1), fall = t * t * (3 - 2 * t);
        e.group.rotation.x = fall * Math.PI * .47; J.hips.position.y -= .25 * Math.min(1, e.deadT / .3);
        J.leftThigh.rotation.x += .5 * fall; J.rightThigh.rotation.x += .4 * fall; J.leftArm.rotation.z -= .4 * fall; J.rightArm.rotation.z += .5 * fall;
      }
    }
    if (e.mode === 'dead') {
      if (e.deadT > FADE_AT) fade(e, clamp(1 - (e.deadT - FADE_AT) / FADE_TIME, 0, 1));
      if (e.deadT > FADE_AT + FADE_TIME) { remove(e); return; }
    }
    e.group.updateMatrixWorld(true);
    /* the feet are planted on the living only: a body on the ground is the clip's to pose */
    if (e.mode !== 'dead') { e.plantFeet((x, z, y) => groundAt(x, z, y - .1), dt, e.gait); e.group.updateMatrixWorld(true); }
    e.body?.sync();
    if (!e.shown) { e.shown = true; e.group.visible = true; }
  }
  /* the fade takes the armour and the skin together; the skin keeps writing
     depth so the armour does not show through it like an x-ray on the way out */
  const skinMaterials = e => e.body ? e.body.skinnedMeshes.flatMap(m => Array.isArray(m.material) ? m.material : [m.material]) : [];
  function fade(e, opacity) {
    if (!e.faded) {
      e.faded = 1; const skin = new Set(skinMaterials(e));
      e.materials = [...new Set([...e.rig.meshes.map(m => m.material), ...skin])];
      e.materials.forEach(m => { m.transparent = true; m.depthWrite = skin.has(m); });
    }
    e.materials.forEach(m => { m.opacity = opacity; });
  }
  function remove(e) {
    if (e.removed) return;
    e.removed = true; releaseToken(e); scene.remove(e.group); e.motion?.dispose(); e.motion = null;
    e.rig.meshes.forEach(m => m.geometry?.dispose()); [...new Set(e.rig.meshes.map(m => m.material))].forEach(m => m.dispose?.());
    e.body?.dispose(); e.body = null;
  }
  const living = () => enemies.filter(e => e.alive);
  return {
    spawn, living, groundAt,
    get all() { return enemies; },
    get killed() { return killed; },
    /* ctx: { player: Vector3, playerDead, tokenAllowed, onStrike(enemy, distance) } */
    update(dt, ctx) {
      token.cooldown -= dt;
      if (token.holder && !token.holder.alive) releaseToken(token.holder);
      if (!token.holder && token.cooldown <= 0 && ctx.tokenAllowed && !ctx.playerDead) {
        const ready = living().filter(e => e.mode === 'circle').sort((a, b) => a.distance - b.distance)[0];
        if (ready) { token.holder = ready; ready.holdsToken = true; }
      }
      for (const e of enemies) {
        if (e.removed) continue;
        if (!e.ready) {
          /* still dressing: the fighter waits at its mark, hidden, though its distance is real for the controller's aim */
          e.distance = Math.hypot(ctx.player.x - e.position.x, ctx.player.z - e.position.z);
          e.waitT += dt; if (e.waitT > READY_TIMEOUT) e.ready = true; else continue;
        }
        updateEnemy(e, dt, ctx);
      }
      /* a faded body leaves the roster too, so enemies[] is the fight as it stands */
      for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].removed) enemies.splice(i, 1);
    },
    nearest(point) { let best = null, bd = Infinity; for (const e of living()) { const d = Math.hypot(e.position.x - point.x, e.position.z - point.z); if (d < bd) { bd = d; best = e; } } return best; },
    states() { return enemies.map(e => e.state()); },
    clear() { for (const e of enemies) remove(e); enemies.length = 0; killed = 0; token.holder = null; token.cooldown = 1.2; },
    dispose() { disposed = true; this.clear(); },
  };
}
