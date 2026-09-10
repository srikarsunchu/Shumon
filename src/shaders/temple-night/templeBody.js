import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/* ===================================================== the loaded body
   A skinned glTF body (MPFB/Rigify by default) worn over the procedural
   samurai. The procedural joints stay the master skeleton: everything that
   already poses them (the cycle in templeSamurai.js, the Quaternius
   retarget, pose clips, foot IK) keeps working, and sync() copies the
   result into the skin's bones once a frame.

   The copy is done in world space so bone roll conventions never matter:
   for each joint, delta = how far the joint has turned from the pose it
   held when the body was bound; the bone gets the same turn applied to
   its own rest orientation. Binding poses the joints into the body's rest
   (an A-pose) by aiming each limb at its child bone, records both sides,
   and zeroes the joints again. */

/* samurai joint → Rigify DEF bone, as MPFB's rigify.human exports them */
export const BONES = {
  hips: 'DEF-spine', spine: 'DEF-spine.001', chest: 'DEF-spine.003', neck: 'DEF-spine.004', head: 'DEF-spine.006',
  leftArm: 'DEF-upper_arm.L', leftForearm: 'DEF-forearm.L', leftHand: 'DEF-hand.L',
  rightArm: 'DEF-upper_arm.R', rightForearm: 'DEF-forearm.R', rightHand: 'DEF-hand.R',
  leftThigh: 'DEF-thigh.L', leftShin: 'DEF-shin.L', leftFoot: 'DEF-foot.L',
  rightThigh: 'DEF-thigh.R', rightShin: 'DEF-shin.R', rightFoot: 'DEF-foot.R',
};
/* the Quaternius Universal Base Character fallback uses the older names */
export const QUATERNIUS_BONES = { ...BONES, hips: 'DEF-hips', neck: 'DEF-neck', head: 'DEF-head' };

/* Rigify's intermediate segments: [bone, joint, joint?, t?]. Two joints
   means the bone takes the slerp of their deltas at t (default .5); one
   means it follows that joint. This is the list for the BONES table above;
   at load, deriveFollow() rebuilds it for whatever table is in force
   (body.json's `roles` puts MPFB's chest at DEF-spine.004, so .002 and
   .003 sit between spine and chest at a third and two thirds). */
export const FOLLOW = [
  ['DEF-spine.002', 'spine', 'chest'], ['DEF-spine.005', 'neck', 'head'],
  ['DEF-upper_arm.L.001', 'leftArm'], ['DEF-forearm.L.001', 'leftForearm'], ['DEF-thigh.L.001', 'leftThigh'], ['DEF-shin.L.001', 'leftShin'],
  ['DEF-upper_arm.R.001', 'rightArm'], ['DEF-forearm.R.001', 'rightForearm'], ['DEF-thigh.R.001', 'rightThigh'], ['DEF-shin.R.001', 'rightShin'],
];
const spineIndex = name => { const m = /^DEF-spine(?:\.(\d+))?$/.exec(name); return m ? Number(m[1] || 0) : null; };
export function deriveFollow(table, find) {
  const out = [], mapped = new Set(Object.values(table));
  /* limb segments: <bone>.001 follows <bone> (DEF-spine.001 is the spine itself, not a segment) */
  for (const [joint, name] of Object.entries(table)) if (find(name + '.001') && !mapped.has(name + '.001')) out.push([name + '.001', joint]);
  /* spine chain: an unmapped DEF-spine.00k sits between its nearest mapped neighbours */
  const chain = Object.entries(table).map(([joint, name]) => [spineIndex(name), joint]).filter(([k]) => k !== null).sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < 10; k++) {
    const name = k ? `DEF-spine.${String(k).padStart(3, '0')}` : 'DEF-spine';
    if (!find(name) || chain.some(([i]) => i === k)) continue;
    const below = [...chain].reverse().find(([i]) => i < k), above = chain.find(([i]) => i > k);
    /* the torso under the cuirass is rigid: segments between the spine and
       the chest follow the spine outright rather than easing toward the chest,
       so the skin cannot twist out from under the armour in a hard cut */
    if (below && above) out.push(above[1] === 'chest' && below[1] === 'spine' ? [name, below[1]] : [name, below[1], above[1], (k - below[0]) / (above[0] - below[0])]);
    else if (below || above) out.push([name, (below || above)[1]]);
  }
  return out;
}

/* the limb pairs aimed into the rest pose at bind time */
const LIMBS = [['leftArm', 'leftForearm'], ['leftForearm', 'leftHand'], ['rightArm', 'rightForearm'], ['rightForearm', 'rightHand'],
  ['leftThigh', 'leftShin'], ['leftShin', 'leftFoot'], ['rightThigh', 'rightShin'], ['rightShin', 'rightFoot']];

const CANVAS = typeof document !== 'undefined' && typeof document.createElement === 'function';

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

async function loadMeta(url) {
  if (!url || typeof fetch !== 'function') return {};
  try { const r = await fetch(url); return r.ok ? await r.json() : {}; } catch { return {}; }
}

const depthOf = o => { let d = 0; while (o.parent) { d++; o = o.parent; } return d; };

/* opt: { url, meta, height, gltf, bones, follow, faceZ, face } — every call
   loads its own copy of the body (the browser caches the fetch; the parsed
   scene is never shared between figures, so each skin has its own bones).
   face: false skips the painted stubble and scar: the gate's fighters wear
   a mask over that part of the face and spare the canvas work. */
export async function loadBody(samurai, opt) {
  opt = opt || {};
  const { url = '/assets/samurai/body.glb', meta = '/assets/samurai/body.json', height = 1.74, face = true } = opt;
  /* opt.gltf / opt.meta as objects let tests bind a synthetic skeleton without fetching */
  const [gltf, info] = await Promise.all([opt.gltf || new GLTFLoader().loadAsync(url), typeof meta === 'object' ? meta : loadMeta(meta)]);
  const root = gltf.scene;
  /* the bone table: the default, under body.json's `roles` (the build
     script reads the real layout off the rig), under an explicit option */
  const table = { ...BONES };
  for (const src of [info.roles, opt.bones]) if (src) for (const j of Object.keys(BONES)) if (src[j]) table[j] = src[j];

  /* ---- the mesh and its bones ---- */
  const skinnedMeshes = [], byName = {};
  root.traverse(o => { if (o.isSkinnedMesh) skinnedMeshes.push(o); if (o.isBone) byName[o.name] = o; });
  if (!skinnedMeshes.length) throw new Error(`Body has no skinned mesh: ${url}`);
  /* GLTFLoader sanitizes node names (DEF-spine.001 → DEF-spine001), as
     templeAnimation.js already allows for; both spellings are accepted */
  const find = name => byName[name] || byName[name.replace(/\./g, '')];
  const bones = {};
  for (const [joint, name] of Object.entries(table)) {
    if (!find(name)) throw new Error(`Body bone missing for ${joint} (${name}). Available: ${Object.keys(byName).join(', ')}`);
    bones[joint] = find(name);
  }
  const follow = opt.follow || deriveFollow(table, find);
  skinnedMeshes.forEach(m => { m.castShadow = true; m.frustumCulled = false; m.userData.noCollision = true; });
  root.userData.noCollision = true;

  /* ---- face the way the figure walks (−z), stand height tall, feet at 0 ---- */
  let faceZ = opt.faceZ !== undefined ? opt.faceZ : true;
  if (typeof info.facing === 'string') faceZ = !/^-z$/i.test(info.facing.trim());
  root.rotation.y = faceZ ? Math.PI : 0;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const scale = height / Math.max(1e-3, box.max.y - box.min.y);
  root.scale.setScalar(scale);
  root.position.y = -box.min.y * scale;
  samurai.group.add(root);
  samurai.group.updateMatrixWorld(true);

  /* ---- fit the joints to the bones' rest positions, in group space ---- */
  const rest = {}, v = new THREE.Vector3();
  for (const [joint, bone] of Object.entries(bones)) {
    rest[joint] = samurai.group.worldToLocal(bone.getWorldPosition(v)).toArray();
  }
  samurai.fitSkeleton(rest);
  /* a body that brings its own hair mesh retires the procedural knot; one
     without it gets the knot lifted onto its larger skull */
  const hasHair = skinnedMeshes.some(m => /hair|ponytail|bob|braid|afro|short|long/i.test(m.name)) || info.hair && info.hair !== 'none';
  samurai.hairParts.forEach(h => { h.visible = !hasHair; });
  /* likewise a body wearing real shoes retires the procedural boots */
  const hasShoes = skinnedMeshes.some(m => /shoe|boot|sandal/i.test(m.name)) || info.shoes && info.shoes !== 'none';
  samurai.wearParts.forEach(m => { if (m.userData.boot) m.visible = !hasShoes; });
  samurai.fitHair({ crownY: typeof info.crownY === 'number' ? info.crownY : height, lift: .04, scale: 1.3 });

  /* ---- bind: pose the joints into the body's rest, record both sides ---- */
  const q = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), from = new THREE.Vector3(), to = new THREE.Vector3();
  function aim(joint, child, point) {
    const start = joint.getWorldPosition(new THREE.Vector3());
    from.subVectors(child.getWorldPosition(new THREE.Vector3()), start).normalize(); to.subVectors(point, start).normalize();
    q.setFromUnitVectors(from, to).multiply(joint.getWorldQuaternion(new THREE.Quaternion()));
    joint.parent.getWorldQuaternion(parentQ).invert(); joint.quaternion.copy(parentQ.multiply(q)); joint.updateWorldMatrix(false, true);
  }
  samurai.group.updateMatrixWorld(true);
  for (const [a, b] of LIMBS) aim(samurai.joints[a], samurai.joints[b], samurai.group.localToWorld(v.fromArray(rest[b])));
  samurai.group.updateMatrixWorld(true);
  const rootQ = samurai.group.getWorldQuaternion(new THREE.Quaternion()), rootInv = rootQ.clone().invert();
  const mapped = Object.entries(bones).map(([joint, bone]) => ({
    joint: samurai.joints[joint], bone, name: joint,
    jointRestInv: samurai.joints[joint].getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv).invert(),
    boneRest: bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv),
    delta: new THREE.Quaternion(),
  }));
  const deltas = Object.fromEntries(mapped.map(b => [b.name, b.delta]));
  const followers = follow.filter(f => find(f[0]) && deltas[f[1]]).map(([name, a, b, t]) => ({
    bone: find(name), from: deltas[a], to: b && deltas[b] ? deltas[b] : null, t: t === undefined ? .5 : t,
    boneRest: find(name).getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv),
  }));
  /* the hips bone also travels with the hips joint so bob and crouch reach the skin */
  const hipBone = bones.hips, hipJoint = samurai.joints.hips;
  const hipOffset = hipBone.getWorldPosition(new THREE.Vector3()).sub(hipJoint.getWorldPosition(v)).applyQuaternion(rootInv);
  const targets = [...mapped, ...followers].sort((a, b) => depthOf(a.bone) - depthOf(b.bone));
  for (const j of Object.values(samurai.joints)) j.rotation.set(0, 0, 0);
  samurai.group.updateMatrixWorld(true);
  samurai.setBodyMode('glb');

  /* ---- the face: stubble and a scar painted over the skin map ---- */
  const skinMaterial = (() => {
    const all = skinnedMeshes.flatMap(m => Array.isArray(m.material) ? m.material : [m.material]).filter(m => m && m.map);
    return all.find(m => /skin|body|face/i.test(m.name || '')) || all[0] || null;
  })();
  let faceTexture = null;
  function setFaceTexture(source, material) {
    material = material || skinMaterial;
    if (!material) return null;
    const old = material.map;
    const t = new THREE.CanvasTexture(source);
    t.flipY = false; t.encoding = THREE.sRGBEncoding;
    if (old) { t.wrapS = old.wrapS; t.wrapT = old.wrapT; t.anisotropy = old.anisotropy; }
    t.needsUpdate = true;
    material.map = t; material.needsUpdate = true;
    if (faceTexture) faceTexture.dispose();
    faceTexture = t;
    return t;
  }
  /* landmarks come as [u,v] or { uv:[u,v] } (body.json's faceLandmarks), in
     glTF UV space (v down the image, as the map is stored with flipY off).
     The face need not be upright in the atlas (MakeHuman's runs along u),
     so everything is drawn in the frame the jaw corners and chin define. */
  function paintFace(face) {
    const img = skinMaterial && skinMaterial.map && skinMaterial.map.image;
    if (!CANVAS || !img || !img.width || !img.height || !face) return false;
    const W = img.width, H = img.height;
    const px = m => { const uv = m && (Array.isArray(m) ? m : m.uv); return uv && uv.length === 2 ? [uv[0] * W, uv[1] * H] : null; };
    const chin = px(face.chin), jawL = px(face.jawL), jawR = px(face.jawR), brow = px(face.browL);
    if (!(chin && jawL && jawR) && !brow) return false;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, W, H);
    const rnd = mulberry32(23), dot = Math.max(1, W / 1024);
    /* across: jaw corner to jaw corner; down: mid-jaw to chin */
    let across = [1, 0], down = [0, 1], span = W * .04;
    if (chin && jawL && jawR) {
      const mid = [(jawL[0] + jawR[0]) / 2, (jawL[1] + jawR[1]) / 2];
      const ax = Math.hypot(jawR[0] - jawL[0], jawR[1] - jawL[1]) / 2, ay = Math.hypot(chin[0] - mid[0], chin[1] - mid[1]);
      if (ax > 1 && ay > 1) {
        across = [(jawR[0] - jawL[0]) / (2 * ax), (jawR[1] - jawL[1]) / (2 * ax)];
        down = [(chin[0] - mid[0]) / ay, (chin[1] - mid[1]) / ay];
        span = ay;
        /* stubble: a haze of dark points in the jaw ellipse, denser toward the chin */
        const cx = mid[0] + down[0] * ay * .55, cy = mid[1] + down[1] * ay * .55, ry = ay * .75;
        for (let i = 0; i < 7000; i++) {
          const u = rnd() * 2 - 1, w = rnd() * 2 - 1;
          if (u * u + w * w > 1) continue;
          const a = (.07 + rnd() * .2) * (.6 + .4 * Math.max(0, w));
          x.fillStyle = `rgba(28,18,14,${a.toFixed(3)})`;
          x.fillRect(cx + across[0] * u * ax + down[0] * w * ry, cy + across[1] * u * ax + down[1] * w * ry, dot * (1 + rnd()), dot * (1 + rnd()));
        }
      }
    }
    /* the scar: a short pale stroke with a darker centre line by the left brow, running down and out */
    if (brow) {
      const len = span * .35, dx = down[0] * .8 + across[0] * .55, dy = down[1] * .8 + across[1] * .55;
      const p0 = [brow[0] - dx * len * .5, brow[1] - dy * len * .5], p1 = [brow[0] + dx * len * .5, brow[1] + dy * len * .5];
      x.lineCap = 'round';
      for (const [style, width] of [['rgba(214,150,132,.55)', dot * 3], ['rgba(120,58,50,.5)', dot * 1.2]]) {
        x.strokeStyle = style; x.lineWidth = width;
        x.beginPath(); x.moveTo(p0[0], p0[1]); x.lineTo(p1[0], p1[1]); x.stroke();
      }
    }
    setFaceTexture(c, skinMaterial);
    return true;
  }
  if (face) try { paintFace(info.faceLandmarks || info.face || info.landmarks || null); } catch (error) { console.warn('Face overlay skipped.', error); }

  /* ---- per frame ---- */
  const boneWorld = new THREE.Quaternion(), mid = new THREE.Quaternion(), p = new THREE.Vector3();
  function sync() {
    samurai.group.getWorldQuaternion(rootQ); rootInv.copy(rootQ).invert();
    for (const b of mapped) b.delta.copy(rootInv).multiply(b.joint.getWorldQuaternion(q)).multiply(b.jointRestInv);
    hipJoint.getWorldPosition(p).add(v.copy(hipOffset).applyQuaternion(rootQ));
    hipBone.position.copy(hipBone.parent.worldToLocal(p));
    for (const b of targets) {
      const delta = b.delta || (b.to ? mid.copy(b.from).slerp(b.to, b.t) : b.from);
      boneWorld.copy(rootQ).multiply(delta).multiply(b.boneRest);
      b.bone.parent.getWorldQuaternion(parentQ).invert();
      b.bone.quaternion.copy(parentQ).multiply(boneWorld);
      b.bone.updateMatrix();
    }
    root.updateMatrixWorld(true);
  }
  function dispose() {
    samurai.group.remove(root);
    root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      mats.forEach(m => { for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) m[k] && m[k].dispose(); m.dispose(); });
    });
    faceTexture = null;
    samurai.setBodyMode('procedural');
  }
  return { sync, dispose, skinnedMeshes, bones, setFaceTexture, scene: root, rest, meta: info, scale, face: !!face };
}
