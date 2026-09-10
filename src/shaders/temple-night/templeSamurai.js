import * as THREE from 'three';

/* ===================================================== the wanderer
   A procedural samurai in the lamellar armour of a clan retainer. Nothing
   here is a loaded asset: the body is a jointed hierarchy of primitives and
   every surface is painted on a 2D canvas at load, in the same spirit as the
   temple itself.

   What makes a figure read as a samurai at ten metres, in the order it
   matters:

     1 · the silhouette. Broad, layered shoulders (sode), a cuirass that
         flares over hanging tassets (kusazuri), and the long line of a
         katana across the left hip. A smooth cylinder with a hat on it reads
         as a garden ornament.
     2 · the lacing. Lamellar armour is rows of small plates bound with
         bright cord, and those cord rows are the only high-frequency detail
         a camera picks up at this range. Painted as a tileable band.
     3 · the walk. Weight on the heels, knees that bend, hips that counter
         the shoulders, and tassets that swing. A figure that slides is a
         chess piece however well it is dressed.

   The rig exposes one call, update(dt, state), driven by the gameplay
   controller; nothing in here reads input. */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* the test harness runs this under node with no canvas, where the figure
   falls back to flat materials and everything else stays identical */
const CANVAS = typeof document !== 'undefined' && typeof document.createElement === 'function';

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/* height → tangent-space normal map, wrapping at the edges */
function normalFromHeight(hc, strength) {
  const W = hc.width, H = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, W, H).data;
  const out = cvs(W, H), ox = out.getContext('2d');
  const im = ox.createImageData(W, H), d = im.data;
  const at = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const gy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const il = 1 / Math.hypot(gx, gy, 1);
    const i = (y * W + x) * 4;
    d[i] = (-gx * il * .5 + .5) * 255;
    d[i + 1] = (gy * il * .5 + .5) * 255;
    d[i + 2] = (il * .5 + .5) * 255;
    d[i + 3] = 255;
  }
  ox.putImageData(im, 0, 0);
  return out;
}

function tex(canvasEl, o) {
  o = o || {};
  const t = new THREE.CanvasTexture(canvasEl);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  if (o.srgb !== false) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------ textures */
/* one row of lamellae: eight lacquered plates, cord-laced along the top,
   a knot row through the middle. Tiles horizontally. */
function texLamellar() {
  const W = 256, H = 64;
  const c = cvs(W, H), x = c.getContext('2d');
  const h = cvs(W, H), hx = h.getContext('2d');
  const r = cvs(W, H), rx = r.getContext('2d');
  x.fillStyle = '#1a2136'; x.fillRect(0, 0, W, H);
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, W, H);
  rx.fillStyle = '#6e6e6e'; rx.fillRect(0, 0, W, H);
  const rnd = mulberry32(19), P = 32;
  for (let i = 0; i < 8; i++) {
    const px = i * P;
    /* the plate: lacquer with a lit left edge and a shadowed right one */
    const g = x.createLinearGradient(px, 0, px + P, 0);
    const t = .9 + rnd() * .2;
    g.addColorStop(0, `rgb(${44 * t | 0},${54 * t | 0},${84 * t | 0})`);
    g.addColorStop(.5, `rgb(${30 * t | 0},${38 * t | 0},${62 * t | 0})`);
    g.addColorStop(1, `rgb(${16 * t | 0},${20 * t | 0},${34 * t | 0})`);
    x.fillStyle = g; x.fillRect(px, 0, P, H);
    /* seams between plates, and the lower lip of each row */
    x.fillStyle = 'rgba(0,0,0,.65)'; x.fillRect(px + P - 2, 0, 2, H);
    hx.fillStyle = '#383838'; hx.fillRect(px + P - 3, 0, 3, H);
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(px, H - 3, P, 3);
    hx.fillStyle = '#2a2a2a'; hx.fillRect(px, H - 4, P, 4);
    x.fillStyle = 'rgba(160,180,220,.10)'; x.fillRect(px, H - 5, P - 2, 1);
    /* the lacing: two stitches per plate at the top, through the row below */
    [9, 21].forEach(sx => {
      const gg = x.createLinearGradient(px + sx - 3, 0, px + sx + 3, 0);
      gg.addColorStop(0, '#7a5a1c'); gg.addColorStop(.5, '#e0b652'); gg.addColorStop(1, '#8a6420');
      x.fillStyle = gg;
      x.beginPath(); x.roundRect(px + sx - 3, 4, 6, 16, 3); x.fill();
      hx.fillStyle = '#e8e8e8'; hx.beginPath(); hx.roundRect(px + sx - 3, 4, 6, 16, 3); hx.fill();
      rx.fillStyle = '#e0e0e0'; rx.fillRect(px + sx - 3, 4, 6, 16);
    });
    /* the cross-knot, in the clan's red */
    x.fillStyle = '#8d2c22';
    x.beginPath(); x.moveTo(px + 15, 30); x.lineTo(px + 22, 36); x.lineTo(px + 15, 42); x.lineTo(px + 8, 36); x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,190,170,.25)'; x.fillRect(px + 13, 33, 4, 2);
    hx.fillStyle = '#c0c0c0'; hx.beginPath(); hx.moveTo(px + 15, 30); hx.lineTo(px + 22, 36); hx.lineTo(px + 15, 42); hx.lineTo(px + 8, 36); hx.closePath(); hx.fill();
    rx.fillStyle = '#d8d8d8'; rx.fillRect(px + 8, 30, 14, 12);
  }
  /* wear: a fine grain over the lacquer */
  for (let i = 0; i < 900; i++) {
    x.fillStyle = rnd() > .5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.08)';
    x.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1);
  }
  return { map: c, normal: normalFromHeight(h, 2.2), rough: r };
}

/* dyed silk: a weave under a base colour, faintly mottled */
function texSilk(base, seed) {
  const W = 128, H = 128, c = cvs(W, H), x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, W, H);
  for (let i = 0; i < W; i += 2) { x.fillStyle = 'rgba(255,255,255,.045)'; x.fillRect(i, 0, 1, H); }
  for (let j = 0; j < H; j += 2) { x.fillStyle = 'rgba(0,0,0,.09)'; x.fillRect(0, j, W, 1); }
  const rnd = mulberry32(seed || 7);
  for (let i = 0; i < 260; i++) {
    x.fillStyle = rnd() > .5 ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.06)';
    x.fillRect(rnd() * W, rnd() * H, 4 + rnd() * 14, 2 + rnd() * 6);
  }
  return c;
}

/* the hilt wrap: black silk cord crossed over white ray skin */
function texIto() {
  const W = 64, H = 128, c = cvs(W, H), x = c.getContext('2d');
  x.fillStyle = '#d6cfbf'; x.fillRect(0, 0, W, H);
  const rnd = mulberry32(3);
  for (let i = 0; i < 300; i++) { x.fillStyle = 'rgba(80,70,60,.25)'; x.beginPath(); x.arc(rnd() * W, rnd() * H, 1 + rnd(), 0, TAU); x.fill(); }
  x.strokeStyle = '#141210'; x.lineWidth = 13; x.lineCap = 'butt';
  for (let k = -6; k <= 6; k++) {
    x.beginPath(); x.moveTo(k * 32, 0); x.lineTo(k * 32 + 64, 128); x.stroke();
    x.beginPath(); x.moveTo(k * 32 + 64, 0); x.lineTo(k * 32, 128); x.stroke();
  }
  x.strokeStyle = 'rgba(255,255,255,.10)'; x.lineWidth = 2;
  for (let k = -6; k <= 6; k++) {
    x.beginPath(); x.moveTo(k * 32 - 6, 0); x.lineTo(k * 32 + 58, 128); x.stroke();
  }
  return c;
}

/* the head, as an equirectangular map for a sphere: face at the front,
   hair pulled back over the crown and the nape. The front is u = .25 and
   the mesh is turned so that it faces the way the figure walks. */
function texHead() {
  const W = 512, H = 256, c = cvs(W, H), x = c.getContext('2d');
  const rnd = mulberry32(41);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#b98b6a'); g.addColorStop(.55, '#b08260'); g.addColorStop(1, '#8c6448');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  /* skin tooth */
  for (let i = 0; i < 2400; i++) {
    x.fillStyle = rnd() > .5 ? 'rgba(255,220,200,.05)' : 'rgba(60,30,20,.06)';
    x.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const fx = W * .25;                                   /* the centre of the face */
  /* hair: over the crown, down the back, and the sides above the ears,
     with a ragged hairline so it is not a helmet */
  x.fillStyle = '#1a1310';
  x.beginPath(); x.moveTo(0, 0); x.lineTo(W, 0);
  for (let u = W; u >= 0; u -= 4) {
    const d = Math.abs(((u - fx) / W + 1.5) % 1 - .5) * 2;   /* 0 at the face, 1 at the nape */
    let v = H * (.30 + .30 * smooth(.18, .62, d));
    v += Math.sin(u * .21) * 3 + (rnd() - .5) * 4;
    x.lineTo(u, v);
  }
  x.closePath(); x.fill();
  /* strands, so the hair has direction */
  x.strokeStyle = 'rgba(70,52,40,.35)'; x.lineWidth = 1.2;
  for (let i = 0; i < 160; i++) {
    const u = rnd() * W, v0 = rnd() * H * .3;
    x.beginPath(); x.moveTo(u, v0); x.lineTo(u + (rnd() - .5) * 8, v0 + 14 + rnd() * 26); x.stroke();
  }
  /* brows: heavy, level, a little drawn together */
  x.strokeStyle = '#231712'; x.lineWidth = 7; x.lineCap = 'round';
  [-1, 1].forEach(s => {
    x.beginPath(); x.moveTo(fx + s * 12, H * .455); x.lineTo(fx + s * 40, H * .445); x.stroke();
  });
  /* eyes: the lid line, then the dark of the eye beneath it */
  [-1, 1].forEach(s => {
    const ex = fx + s * 26, ey = H * .50;
    x.fillStyle = '#e8d8c8';
    x.beginPath(); x.ellipse(ex, ey, 13, 5, 0, 0, TAU); x.fill();
    x.fillStyle = '#1c1410';
    x.beginPath(); x.ellipse(ex + s * 1, ey + .5, 5.5, 5, 0, 0, TAU); x.fill();
    x.fillStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.arc(ex - s * 1.5, ey - 1.5, 1.4, 0, TAU); x.fill();
    x.strokeStyle = '#2a1a12'; x.lineWidth = 2.5;
    x.beginPath(); x.moveTo(ex - 14, ey - 1); x.quadraticCurveTo(ex, ey - 8, ex + 14, ey - 1); x.stroke();
    x.fillStyle = 'rgba(60,30,20,.18)'; x.beginPath(); x.ellipse(ex, ey + 7, 15, 5, 0, 0, TAU); x.fill();
  });
  /* nose: a shadow down one side and under the tip */
  x.fillStyle = 'rgba(60,30,20,.22)';
  x.beginPath(); x.moveTo(fx - 2, H * .50); x.lineTo(fx + 5, H * .63); x.lineTo(fx - 9, H * .64); x.closePath(); x.fill();
  x.fillStyle = 'rgba(60,30,20,.30)'; x.beginPath(); x.ellipse(fx, H * .645, 9, 3, 0, 0, TAU); x.fill();
  /* mouth: set, and a shadow under the lower lip */
  x.strokeStyle = '#5a2e26'; x.lineWidth = 2.6;
  x.beginPath(); x.moveTo(fx - 13, H * .72); x.quadraticCurveTo(fx, H * .735, fx + 13, H * .72); x.stroke();
  x.fillStyle = 'rgba(60,30,20,.18)'; x.beginPath(); x.ellipse(fx, H * .77, 10, 3, 0, 0, TAU); x.fill();
  /* stubble over the jaw and the lip, and a scar over the left brow */
  for (let i = 0; i < 900; i++) {
    const u = fx + (rnd() - .5) * 120, v = H * (.66 + rnd() * .22);
    if (Math.hypot((u - fx) / 60, (v - H * .74) / (H * .14)) > 1) continue;
    x.fillStyle = 'rgba(30,18,12,' + (.10 + rnd() * .22) + ')'; x.fillRect(u, v, 1, 1.5);
  }
  x.strokeStyle = 'rgba(120,60,50,.55)'; x.lineWidth = 1.4;
  x.beginPath(); x.moveTo(fx + 30, H * .40); x.lineTo(fx + 36, H * .47); x.stroke();
  return c;
}

/* the clan crest on the breastplate: a gold ring about a five-petal bloom */
function texMon() {
  const S = 64, c = cvs(S, S), x = c.getContext('2d');
  x.clearRect(0, 0, S, S);
  x.strokeStyle = '#d5aa4c'; x.lineWidth = 3.5;
  x.beginPath(); x.arc(S / 2, S / 2, 26, 0, TAU); x.stroke();
  x.fillStyle = '#d5aa4c';
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU - Math.PI / 2;
    x.save(); x.translate(S / 2, S / 2); x.rotate(a);
    x.beginPath(); x.ellipse(13, 0, 9, 5.5, 0, 0, TAU); x.fill();
    x.restore();
  }
  x.fillStyle = '#1a2136'; x.beginPath(); x.arc(S / 2, S / 2, 4.5, 0, TAU); x.fill();
  return c;
}

/* a woven sedge hat, ringed from the crown down */
function texStraw() {
  const W = 128, H = 128, c = cvs(W, H), x = c.getContext('2d');
  x.fillStyle = '#9a8354'; x.fillRect(0, 0, W, H);
  const rnd = mulberry32(11);
  for (let j = 0; j < H; j += 3) { x.fillStyle = j % 6 ? 'rgba(0,0,0,.22)' : 'rgba(255,240,200,.10)'; x.fillRect(0, j, W, 1.5); }
  for (let i = 0; i < W; i += 5) { x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(i + (rnd() * 2 | 0), 0, 1, H); }
  return c;
}

/* --------------------------------------------------------- the figure */
export function createSamurai(opt) {
  opt = opt || {};
  const group = new THREE.Group();
  const meshes = [];

  /* materials — every set generated once */
  let M;
  if (CANVAS) {
    const lam = texLamellar();
    const lamBand = {
      map: tex(lam.map, { repeat: [6, 1] }), normal: tex(lam.normal, { repeat: [6, 1], srgb: false }),
      rough: tex(lam.rough, { repeat: [6, 1], srgb: false })
    };
    const lamPlate = {
      map: tex(lam.map, { repeat: [1, 4] }), normal: tex(lam.normal, { repeat: [1, 4], srgb: false }),
      rough: tex(lam.rough, { repeat: [1, 4], srgb: false })
    };
    const lamSode = {
      map: tex(lam.map, { repeat: [2, 1] }), normal: tex(lam.normal, { repeat: [2, 1], srgb: false }),
      rough: tex(lam.rough, { repeat: [2, 1], srgb: false })
    };
    const lamellar = t => new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normal, roughnessMap: t.rough, normalScale: new THREE.Vector2(.9, .9),
      roughness: 1, metalness: .18, color: 0xffffff
    });
    M = {
      band: lamellar(lamBand), plate: lamellar(lamPlate), sode: lamellar(lamSode),
      lacquer: new THREE.MeshStandardMaterial({ color: 0x121419, roughness: .5, metalness: .2 }),
      silk: new THREE.MeshStandardMaterial({ map: tex(texSilk('#2a3152', 5), { repeat: [3, 3] }), roughness: .82, metalness: 0 }),
      hakama: new THREE.MeshStandardMaterial({ map: tex(texSilk('#1d1e27', 9), { repeat: [3, 3] }), roughness: .95, metalness: 0 }),
      obi: new THREE.MeshStandardMaterial({ map: tex(texSilk('#93291f', 13), { repeat: [4, 1] }), roughness: .78, metalness: 0 }),
      cord: new THREE.MeshStandardMaterial({ color: 0x9a2e22, roughness: .8 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xcfa24a, roughness: .36, metalness: .72 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: .55, metalness: .6 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xd8dee0, roughness: .22, metalness: .62, emissive: 0x1e2428, emissiveIntensity: 1 }),
      head: new THREE.MeshStandardMaterial({ map: tex(texHead()), roughness: .72, metalness: 0 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xb08260, roughness: .75 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x1a1310, roughness: .68 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x1b1c22, roughness: .9 }),
      mon: new THREE.MeshStandardMaterial({ map: tex(texMon()), transparent: true, roughness: .4, metalness: .6 }),
      straw: new THREE.MeshStandardMaterial({ map: tex(texStraw(), { repeat: [12, 1] }), roughness: 1, side: THREE.DoubleSide })
    };
  } else {
    const flat = c => new THREE.MeshStandardMaterial({ color: c });
    M = { band: flat(0x1a2136), plate: flat(0x1a2136), sode: flat(0x1a2136), lacquer: flat(0x15171d), silk: flat(0x2a3152),
      hakama: flat(0x1d1e27), obi: flat(0x93291f), cord: flat(0x9a2e22), gold: flat(0xcfa24a), iron: flat(0x2c2f33),
      steel: flat(0xd8dee0), head: flat(0xb08260), skin: flat(0xb08260), hair: flat(0x1a1310), glove: flat(0x1b1c22),
      mon: flat(0xcfa24a), straw: flat(0x9a8354) };
  }

  const bone = (parent, x, y, z) => { const b = new THREE.Group(); b.position.set(x, y, z); parent.add(b); return b; };
  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; parent.add(m); meshes.push(m); return m;
  };

  /* ---- the skeleton. Forward is −z. Heights in metres, standing. ------ */
  /* hipY and chestY are the standing rest heights; fitSkeleton() below
     rewrites them when a loaded body dictates the proportions */
  let hipY = .93, chestY = .24;
  const hips = bone(group, 0, hipY, 0);
  const spine = bone(hips, 0, .06, 0);
  const chest = bone(spine, 0, .24, 0);
  const neck = bone(chest, 0, .26, -.01);
  const head = bone(neck, 0, .08, 0);

  /* ---- under-robe and trousers --------------------------------------- */
  /* long enough to run under the sash: it rides the spine with the cuirass,
     so a forward lean cannot open the small of the back above the hips */
  const torso = add(spine, new THREE.CylinderGeometry(.195, .17, .48, 20), M.silk, 0, .06, 0);
  torso.scale.z = .78;
  /* the yoke of the kimono over the collarbones, and the collar crossed
     left over right on top of it */
  const yoke = add(chest, new THREE.CylinderGeometry(.125, .215, .16, 20), M.silk, 0, .20, 0);
  yoke.scale.z = .8;
  [-1, 1].forEach(s => {
    const lapel = add(chest, new THREE.BoxGeometry(.11, .16, .03), M.silk, s * .055, .17, -.135 + (s < 0 ? -.006 : 0));
    lapel.rotation.z = s * .55;
  });
  /* the obi, and its knot at the small of the back */
  const obi = add(hips, new THREE.CylinderGeometry(.205, .21, .085, 20), M.obi, 0, .05, 0);
  obi.scale.z = .8;
  /* the seat of the hakama, from under the sash to the top of the thighs:
     inside the tassets on the procedural body, but a real pelvis stands
     proud of the sash behind, and the plates hang with gaps between them */
  const seat = add(hips, new THREE.CylinderGeometry(.215, .19, .26, 20), M.hakama, 0, -.09, .01);
  seat.scale.z = .85;
  add(hips, new THREE.BoxGeometry(.16, .07, .06), M.obi, 0, .05, .17);
  add(hips, new THREE.BoxGeometry(.05, .12, .05), M.obi, .07, .01, .175).rotation.z = .4;
  add(hips, new THREE.BoxGeometry(.05, .12, .05), M.obi, -.07, .01, .175).rotation.z = -.4;

  /* ---- the dō: five laced rows rising to the breastplate --------------- */
  /* the cuirass was flattened front-to-back for the thin procedural torso;
     over a real chest it deepens instead (see setBodyMode) */
  const armourParts = [obi];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const band = add(spine, new THREE.CylinderGeometry(lerp(.215, .25, t), lerp(.21, .245, t), .076, 24), M.band, 0, .04 + i * .074, 0);
    band.scale.z = .82; armourParts.push(band);
  }
  /* the breastplate is a solid plate above the rows, carrying the crest */
  const breast = add(chest, new THREE.CylinderGeometry(.235, .252, .10, 24), M.lacquer, 0, .095, 0);
  breast.scale.z = .82; armourParts.push(breast);
  const trim = add(chest, new THREE.CylinderGeometry(.24, .24, .014, 24), M.gold, 0, .148, 0);
  trim.scale.z = .82; armourParts.push(trim);
  const mon = add(chest, new THREE.PlaneGeometry(.10, .10), M.mon, 0, .09, -.207);
  mon.rotation.y = Math.PI; mon.castShadow = false;
  /* shoulder straps in red cord */
  [-1, 1].forEach(s => {
    const strap = add(chest, new THREE.BoxGeometry(.045, .012, .27), M.cord, s * .12, .16, -.01);
    strap.rotation.x = 0;
  });

  /* ---- kusazuri: seven tassets hung from the waist, free to swing ------ */
  const tassets = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + Math.PI / 7;          /* a gap at the front, over the crotch */
    const piv = bone(hips, Math.sin(a) * .20, .0, Math.cos(a) * .17);
    piv.rotation.y = a;
    const plate = add(piv, new THREE.BoxGeometry(.165, .30, .018), M.plate, 0, -.15, .0);
    plate.rotation.x = -.16;                          /* flares outward */
    add(piv, new THREE.BoxGeometry(.17, .012, .022), M.gold, 0, -.006, 0);
    tassets.push({ piv: piv, a: a });
  }

  /* the parts a loaded skin replaces (bare flesh, gloves, boots) and the
     parts that ride the crown, so a body of other proportions can hide the
     one and lift the other */
  const skinParts = [], hairParts = [];
  /* the cloth a loaded body wears over its own limbs, and the gloves and
     boots it keeps: both are let out in skinned mode so no flesh shows */
  const clothParts = [torso, yoke, seat], wearParts = [];

  /* ---- arms: sleeve, sode, kote, gloved hand -------------------------- */
  const arm = s => {
    const shoulder = bone(chest, s * .215, .18, 0);
    /* the kimono sleeve, full at the upper arm */
    const sleeve = add(shoulder, new THREE.CylinderGeometry(.075, .085, .24, 12), M.silk, 0, -.13, 0);
    sleeve.scale.z = .9; clothParts.push(sleeve);
    /* the sode: four plates stepping out and down over the shoulder */
    for (let i = 0; i < 4; i++) {
      const p = add(shoulder, new THREE.BoxGeometry(.19 + i * .012, .048, .17 + i * .01), M.sode, s * (.03 + i * .006), .04 - i * .048, 0);
      p.rotation.z = s * -.28;
      p.rotation.y = s * .05;
    }
    add(shoulder, new THREE.BoxGeometry(.06, .05, .09), M.gold, s * .035, .085, 0).rotation.z = s * -.4;
    const elbow = bone(shoulder, 0, -.27, 0);
    /* the kote: a fitted sleeve of chain under a lacquered forearm plate */
    clothParts.push(add(elbow, new THREE.CylinderGeometry(.052, .045, .26, 10), M.hakama, 0, -.13, 0));
    const kote = add(elbow, new THREE.BoxGeometry(.075, .21, .04), M.lacquer, 0, -.13, -.032);
    kote.rotation.x = .04;
    add(elbow, new THREE.BoxGeometry(.08, .012, .05), M.gold, 0, -.04, -.03);
    add(elbow, new THREE.BoxGeometry(.08, .012, .05), M.gold, 0, -.225, -.03);
    const hand = bone(elbow, 0, -.27, 0);
    const glove = add(hand, new THREE.BoxGeometry(.072, .085, .04), M.glove, 0, -.04, 0);
    const fingers = add(hand, new THREE.BoxGeometry(.06, .05, .045), M.glove, 0, -.10, -.005);
    glove.userData.glove = fingers.userData.glove = true;
    wearParts.push(glove, fingers);
    return { shoulder: shoulder, elbow: elbow, hand: hand };
  };
  const L = arm(-1), R = arm(1);

  /* ---- legs: hakama, suneate, split-toe boot -------------------------- */
  const leg = s => {
    const hip = bone(hips, s * .105, -.02, 0);
    const thigh = add(hip, new THREE.CylinderGeometry(.092, .078, .40, 12), M.hakama, 0, -.2, 0);
    thigh.scale.z = .95; clothParts.push(thigh);
    const knee = bone(hip, 0, -.40, 0);
    clothParts.push(add(knee, new THREE.SphereGeometry(.07, 10, 8), M.hakama, 0, 0, 0));
    clothParts.push(add(knee, new THREE.CylinderGeometry(.068, .06, .40, 12), M.hakama, 0, -.2, 0));
    /* the shin guard: a lacquered plate with a gold lip, tied behind */
    const shin = add(knee, new THREE.CylinderGeometry(.078, .07, .34, 12, 1, false, Math.PI * .95, Math.PI * 1.1), M.lacquer, 0, -.21, 0);
    shin.rotation.y = 0;
    add(knee, new THREE.BoxGeometry(.11, .012, .06), M.gold, 0, -.05, -.05);
    const foot = bone(knee, 0, -.40, 0);
    const boot = add(foot, new THREE.BoxGeometry(.095, .07, .25), M.glove, 0, -.06, -.045);
    const sole = add(foot, new THREE.BoxGeometry(.10, .03, .26), M.lacquer, 0, -.085, -.045);
    boot.userData.boot = sole.userData.boot = true;
    wearParts.push(boot, sole);
    return { hip: hip, knee: knee, foot: foot };
  };
  const LL = leg(-1), RL = leg(1);

  /* ---- head: the face, the hair drawn up into a knot, and a hat -------- */
  const skull = add(head, new THREE.SphereGeometry(.112, 24, 18), M.head, 0, .025, 0);
  skull.scale.set(.96, 1.1, 1.0);
  skull.rotation.y = Math.PI;                        /* the face is at −z */
  skinParts.push(skull, add(neck, new THREE.CylinderGeometry(.052, .06, .10, 10), M.skin, 0, .03, 0));
  const jaw = add(head, new THREE.SphereGeometry(.075, 12, 10), M.skin, 0, -.04, -.012);
  jaw.scale.set(1.05, .8, 1.0);
  skinParts.push(jaw);
  /* the chonmage: a folded queue lying forward over the crown */
  const bun = add(head, new THREE.CylinderGeometry(.024, .028, .085, 8), M.hair, 0, .125, .03);
  bun.rotation.x = -1.15;
  const tie = add(head, new THREE.CylinderGeometry(.03, .03, .022, 8), M.cord, 0, .10, .06); tie.rotation.x = -1.15;
  const knot = add(head, new THREE.SphereGeometry(.05, 10, 8), M.hair, 0, .085, .07); knot.scale.set(1.1, .7, 1);
  hairParts.push(bun, tie, knot);
  /* loose strands the rain has pulled down */
  const strands = [];
  [[-1, .06, -.02], [1, .07, -.01], [-1, .02, .05]].forEach(([s, y, z], i) => {
    const st = add(head, new THREE.BoxGeometry(.012, .14, .02), M.hair, s * .1, y - .05, z);
    st.rotation.z = s * .12; st.userData.s = s; st.userData.i = i; strands.push(st); hairParts.push(st);
  });
  hairParts.forEach(h => { h.userData.restY = h.position.y; });
  const CROWN_Y = .025 + .112 * 1.1;                 /* top of the skull, in head space */
  let hat = null;
  if (opt.hat) {
    hat = new THREE.Group(); hat.position.set(0, .13, -.005); hat.rotation.x = .10; head.add(hat);
    const crown = add(hat, new THREE.ConeGeometry(.40, .17, 32, 1, true), M.straw, 0, .0, 0);
    crown.castShadow = true;
    add(hat, new THREE.ConeGeometry(.395, .16, 32, 1, true), M.hakama, 0, -.004, 0);
    add(hat, new THREE.CylinderGeometry(.03, .03, .05, 8), M.hakama, 0, .10, 0);
    const cord = add(hat, new THREE.CylinderGeometry(.006, .006, .26, 5), M.cord, 0, -.13, -.09);
    cord.rotation.x = -.1;
  }

  /* ---- the katana. Blade forward (−z) from the guard. ----------------- */
  function bladeGeo() {
    /* a box bent along its length: the curve (sori) and the taper to the
       point are what separate a katana from a ruler */
    const len = .72, g = new THREE.BoxGeometry(.028, .0065, len, 1, 1, 24);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), t = (-z + len / 2) / len;           /* 0 at guard, 1 at tip */
      const taper = 1 - smooth(.82, 1, t) * .78;
      let x = p.getX(i) * taper, y = p.getY(i);
      /* the edge lies toward −x: shave that side to a line */
      if (x < 0) y *= .18;
      x += .008 * (1 - taper);                                  /* the point bends to the spine */
      y += .022 * t * t;                                        /* the curve */
      p.setXYZ(i, x, y, z - len / 2);
    }
    g.computeVertexNormals();
    return g;
  }
  function hilt(parent) {
    const tsuba = add(parent, new THREE.CylinderGeometry(.037, .037, .0055, 18), M.iron, 0, 0, .004);
    tsuba.rotation.x = Math.PI / 2; tsuba.scale.x = .9;
    const tsuka = add(parent, new THREE.CylinderGeometry(.0135, .0125, .255, 10), CANVAS ? new THREE.MeshStandardMaterial({ map: tex(texIto(), { repeat: [1, 2] }), roughness: .85 }) : M.glove, 0, 0, .135);
    tsuka.rotation.x = Math.PI / 2; tsuka.scale.x = 1.35;
    const kashira = add(parent, new THREE.CylinderGeometry(.015, .015, .012, 10), M.iron, 0, 0, .268);
    kashira.rotation.x = Math.PI / 2; kashira.scale.x = 1.35;
    add(parent, new THREE.CylinderGeometry(.017, .017, .012, 10), M.gold, 0, 0, .012).rotation.x = Math.PI / 2;
  }
  /* in the hand: the blade points along −z of the hand bone, then is turned
     to lie along the forearm for the guard pose by the rig below */
  const katana = new THREE.Group(); katana.name = 'katana';
  add(katana, bladeGeo(), M.steel, 0, 0, 0);
  hilt(katana);
  R.hand.add(katana);
  /* sheathed: the saya rides the left hip in the obi, edge up, hilt
     forward; the hilt shows above the mouth of the scabbard */
  const saya = new THREE.Group(); saya.name = 'saya';
  saya.position.set(-.19, .03, .02);
  saya.rotation.set(.34, -.42, 0);
  hips.add(saya);
  const sayaBody = add(saya, new THREE.BoxGeometry(.036, .024, .76), M.lacquer, 0, 0, .38);
  sayaBody.position.z = .38;
  add(saya, new THREE.CylinderGeometry(.02, .02, .03, 8), M.iron, 0, 0, .76).rotation.x = Math.PI / 2;
  add(saya, new THREE.BoxGeometry(.04, .03, .04), M.iron, 0, 0, .02);
  add(saya, new THREE.BoxGeometry(.012, .028, .03), M.iron, 0, .02, .09);       /* kurigata */
  const sageo = add(saya, new THREE.TorusGeometry(.03, .004, 6, 14), M.cord, 0, .015, .09);
  sageo.rotation.y = Math.PI / 2;
  const sheathedHilt = new THREE.Group(); sheathedHilt.name = 'sheathedHilt';
  sheathedHilt.rotation.y = Math.PI;                        /* the hilt runs back along +z of the saya... */
  sheathedHilt.position.set(0, 0, 0);
  saya.add(sheathedHilt);
  hilt(sheathedHilt);
  /* the saya group's +z is toward the tip; the hilt group is turned so its
     +z (the tsuka) runs out of the mouth the other way */

  /* ---- a little light of his own, so the face reads under the moon ---- */
  const fill = new THREE.PointLight(0x9fb8c8, .22, 3.2, 2);
  fill.position.set(.3, 2.2, 1.1); group.add(fill);
  const rim = new THREE.PointLight(0xff9a50, .22, 3, 2);
  rim.position.set(-.7, 1.9, -1.1); group.add(rim);

  /* ------------------------------------------------------------- pose
     Joint conventions, for anyone editing the cycle: a limb hangs down −y,
     so a positive x rotation swings it forward (toward −z); the knee folds
     with a negative x, the elbow with a positive one. The spine and head
     nod forward with a negative x. Around z, positive takes the right arm
     out from the body and the left arm across it. */
  let breath = 0;
  const grip = new THREE.Vector3();
  /* state: { speed 0..1, run, phase, drawn, swing (-1 none, else 0..1), time } */
  function update(dt, s) {
    breath += dt;
    const amp = clamp(s.speed, 0, 1), p = s.phase, run = typeof s.run === "number" ? clamp(s.run, 0, 1) : s.run ? 1 : 0;
    const drawn = s.drawn, sw = s.swing === undefined ? -1 : s.swing;
    const attacking = sw >= 0;
    const t = s.time !== undefined ? s.time : breath;

    /* ---- the gait ---- */
    const swingL = Math.sin(p), swingR = Math.sin(p + Math.PI);
    const stride = (.55 + run * .35) * amp;
    LL.hip.rotation.x = swingL * stride;
    RL.hip.rotation.x = swingR * stride;
    /* the knee folds as the leg comes through, and hardly at all in stance */
    const fold = .75 + run * .55;
    LL.knee.rotation.x = -amp * (.06 + fold * Math.pow(Math.max(0, Math.sin(p + .55)), 1.4));
    RL.knee.rotation.x = -amp * (.06 + fold * Math.pow(Math.max(0, Math.sin(p + Math.PI + .55)), 1.4));
    /* the foot stays flat to the ground through stance and pushes off the
       toe as the leg leaves it */
    LL.foot.rotation.x = -(LL.hip.rotation.x + LL.knee.rotation.x) * .8 - amp * Math.max(0, -Math.sin(p - .5)) * .45;
    RL.foot.rotation.x = -(RL.hip.rotation.x + RL.knee.rotation.x) * .8 - amp * Math.max(0, -Math.sin(p + Math.PI - .5)) * .45;
    /* weight: the hips drop into each stance and rise over the standing leg */
    hips.position.y = hipY - .028 * amp - run * .03 + .035 * amp * Math.abs(Math.cos(p))
                    + (drawn && amp < .05 ? -.03 : 0);
    hips.position.x = Math.sin(p) * .012 * amp;
    hips.rotation.y = Math.sin(p) * (.10 + run * .06) * amp;
    hips.rotation.z = Math.sin(p) * .04 * amp;
    /* the torso leans into the run and counters the hips */
    spine.rotation.x = -(.06 + run * .16) * amp - (drawn ? .08 : 0) + Math.sin(t * 1.4) * .006;
    spine.rotation.z = -(s.turnLean || 0) * .055;
    spine.rotation.y = -hips.rotation.y * 1.4;
    chest.rotation.y = -hips.rotation.y * .4;
    chest.position.y = chestY + Math.sin(t * 1.4) * .004;
    head.rotation.x = -(.04 + amp * .06) - spine.rotation.x * .5;
    head.rotation.y = -spine.rotation.y * .5 + Math.sin(t * .7) * .04;

    /* ---- the arms ---- */
    const armSwing = (.45 + run * .35) * amp;
    if (!drawn) {
      L.shoulder.rotation.set(swingR * armSwing, 0, -.10);
      R.shoulder.rotation.set(swingL * armSwing, 0, .10);
      L.elbow.rotation.x = .18 + Math.max(0, swingR) * .6 * amp + run * .8 * amp;
      R.elbow.rotation.x = .18 + Math.max(0, swingL) * .6 * amp + run * .8 * amp;
      L.hand.rotation.set(0, 0, 0); R.hand.rotation.set(0, 0, 0);
      katana.rotation.set(0, 0, 0); katana.position.set(0, 0, 0);
    } else {
      /* chūdan: the sword held forward at the centre, both hands on the hilt */
      R.shoulder.rotation.set(.55 + swingL * .04 * amp, 0, -.22);
      R.elbow.rotation.x = 1.0;
      R.hand.rotation.set(0, 0, 0);
      L.shoulder.rotation.set(.42 + swingR * .04 * amp, 0, .40);
      L.elbow.rotation.x = 1.25;
      L.hand.rotation.set(0, 0, 0);
      /* the blade continues the line of the forearm, lifted a little */
      katana.rotation.set(-1.25, 0, 0);
      katana.position.set(0, -.08, 0);
    }
    if (attacking) {
      /* the cut: wound up over the right shoulder, brought down and across
         to the left, then the sword settles back to centre. One curve per
         joint, blended over the guard it started from. */
      const wind = smooth(0, .28, sw), cut = smooth(.28, .55, sw), settle = smooth(.62, 1, sw);
      const k = 1 - settle;
      const arc = (a, b, c) => lerp(lerp(a, b, wind), c, cut);   /* guard → wound → cut */
      R.shoulder.rotation.set(lerp(R.shoulder.rotation.x, arc(.55, 2.5, .25), k),
                              lerp(R.shoulder.rotation.y, arc(0, -.3, .3), k),
                              lerp(R.shoulder.rotation.z, arc(-.22, .05, -.75), k));
      R.elbow.rotation.x = lerp(R.elbow.rotation.x, arc(1.0, 1.5, .25), k);
      L.shoulder.rotation.set(lerp(L.shoulder.rotation.x, arc(.42, 2.2, .35), k),
                              lerp(L.shoulder.rotation.y, arc(0, .2, -.2), k),
                              lerp(L.shoulder.rotation.z, arc(.40, .25, .95), k));
      L.elbow.rotation.x = lerp(L.elbow.rotation.x, arc(1.25, 1.55, .45), k);
      /* the whole body turns into the cut */
      const twist = arc(0, -.4, .55) * k;
      spine.rotation.y += twist; chest.rotation.y += twist * .6; hips.rotation.y += twist * .3;
      spine.rotation.x += arc(0, .10, -.24) * k;
      head.rotation.x += arc(0, .08, -.12) * k;
      hips.position.y -= cut * k * .07;
      LL.knee.rotation.x -= cut * k * .35; RL.knee.rotation.x -= cut * k * .5;
      RL.hip.rotation.x += cut * k * .45; LL.hip.rotation.x -= cut * k * .2;
      katana.rotation.set(-1.25 + arc(0, .2, -.3) * k, 0, arc(0, 0, .35) * k);
    }
    /* the grip offset is a tuning knob for a loaded body whose hand does
       not sit where the glove box does */
    if (drawn) katana.position.add(grip);

    /* ---- the loose parts ---- */
    tassets.forEach(k => {
      /* the front tassets ride up over the thigh that swings forward, the
         side ones flare with the run */
      const front = -Math.cos(k.a);
      const side = Math.sin(k.a);
      const legSwing = side < 0 ? LL.hip.rotation.x : RL.hip.rotation.x;
      k.piv.rotation.x = -.06 - Math.max(0, front) * Math.max(0, legSwing) * .8 - amp * run * .12
                         + Math.sin(t * 2.1 + k.a) * .02;
    });
    strands.forEach(st => {
      st.rotation.z = st.userData.s * .12 + Math.sin(t * 1.7 + st.userData.i * 2) * .07 * (s.wind || 1) + amp * .25 * st.userData.s;
      st.rotation.x = amp * .35 + Math.cos(t * 1.3 + st.userData.i) * .05;
    });
    if (hat) hat.rotation.x = .10 + amp * .08;

    /* the sword is either in the hand or on the hip, never both */
    katana.visible = drawn;
    sheathedHilt.visible = !drawn;
  }

  const joints = {hips,spine,chest,neck,head,leftArm:L.shoulder,leftForearm:L.elbow,leftHand:L.hand,
    rightArm:R.shoulder,rightForearm:R.elbow,rightHand:R.hand,leftThigh:LL.hip,leftShin:LL.knee,leftFoot:LL.foot,
    rightThigh:RL.hip,rightShin:RL.knee,rightFoot:RL.foot};

  /* ------------------------------------------------------- refitting
     A loaded body brings its own proportions. fitSkeleton moves the joints
     onto its rest positions (group space, metres) with every rotation at
     zero. Joints that branch off the trunk (shoulders, hip sockets, the
     spine chain) take the literal offset; joints that continue a limb
     (elbow, wrist, knee, ankle) keep the rig's convention that a limb
     hangs down the parent's −y in the zero pose, so the pose cycle above
     and the T-pose calibration in templeAnimation.js stay valid. The
     loader then aims each limb at its child to match the body's rest. */
  const LIMB = { leftForearm: 'leftArm', leftHand: 'leftForearm', rightForearm: 'rightArm', rightHand: 'rightForearm',
    leftShin: 'leftThigh', leftFoot: 'leftShin', rightShin: 'rightThigh', rightFoot: 'rightShin' };
  const ORDER = ['hips', 'spine', 'chest', 'neck', 'head', 'leftArm', 'leftForearm', 'leftHand', 'rightArm', 'rightForearm',
    'rightHand', 'leftThigh', 'leftShin', 'leftFoot', 'rightThigh', 'rightShin', 'rightFoot'];
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  function fitSkeleton(rest) {
    ORDER.forEach(n => joints[n].rotation.set(0, 0, 0));
    group.updateMatrixWorld(true);
    for (const n of ORDER) {
      if (!rest[n]) continue;
      const j = joints[n];
      if (LIMB[n] && rest[LIMB[n]]) {
        j.position.set(0, -v.fromArray(rest[n]).distanceTo(w.fromArray(rest[LIMB[n]])), 0);
      } else {
        group.localToWorld(v.fromArray(rest[n]));
        j.parent.worldToLocal(v);
        j.position.copy(v);
      }
      j.updateMatrixWorld(true);
    }
    if (rest.hips) hipY = hips.position.y;
    if (rest.chest) chestY = chest.position.y;
    /* the scabbard keeps its place beside the left hip socket */
    saya.position.x = LL.hip.position.x - .085;
    return joints;
  }
  /* lift the topknot and strands to sit on a crown of another height */
  function fitHair(o) {
    o = o || {};
    const headY = hips.position.y + spine.position.y + chest.position.y + neck.position.y + head.position.y;
    /* a real skull is broader than the sphere the knot was tied on, so the
       hair takes an extra lift and a little growth to stay on top of it */
    const dy = (typeof o.crownY === 'number' ? (o.crownY - headY) - CROWN_Y : 0) + (o.lift || 0);
    const sc = o.scale || 1;
    /* the knot grows with the skull; the strands are already hair-thin */
    hairParts.forEach(h => { h.position.y = h.userData.restY + dy; h.scale.setScalar(h.userData.s ? 1 : sc); });
  }
  let bodyMode = 'procedural';
  [...clothParts, ...wearParts, ...armourParts].forEach(m => { m.userData.baseScale = m.scale.clone(); });
  function setBodyMode(mode) {
    bodyMode = mode === 'glb' ? 'glb' : 'procedural';
    skinParts.forEach(m => { m.visible = bodyMode !== 'glb'; });
    /* let the trousers, sleeves, gloves and boots out over the loaded body */
    const grow = bodyMode === 'glb' ? 1.3 : 1;
    clothParts.forEach(m => { m.scale.copy(m.userData.baseScale); m.scale.x *= grow; m.scale.z *= grow; });
    /* a loaded body has real hands, so the glove blocks go; the boots stay
       unless the body brought its own (templeBody.js decides that) */
    wearParts.forEach(m => { m.scale.copy(m.userData.baseScale); m.scale.multiplyScalar(bodyMode === 'glb' ? 1.35 : 1); if (m.userData.glove) m.visible = bodyMode !== 'glb'; });
    armourParts.forEach(m => { m.scale.copy(m.userData.baseScale); if (bodyMode === 'glb') { m.scale.z *= 1.24; m.scale.x *= 1.06; } });
    mon.position.z = bodyMode === 'glb' ? -.258 : -.207;
    /* a cuirass is one rigid shell. Over the skinned body the breastplate,
       its trim and the crest ride the spine with the laced rows instead of
       the chest joint, so a twisting cut cannot pull them apart and let the
       skin through the seam (the loader keeps the skin under it rigid too) */
    [breast, trim, mon].forEach(m => (bodyMode === 'glb' ? spine : chest).attach(m));
    return bodyMode;
  }

  return { group, update, meshes, height:1.74, joints,
    legs:[LL,RL], katana, saya, sheathedHilt, grip, skinParts, hairParts, clothParts, wearParts,
    fitSkeleton, fitHair, setBodyMode, get bodyMode() { return bodyMode; }, get hipY() { return hipY; },
  };
}
