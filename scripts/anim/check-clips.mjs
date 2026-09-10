/* Schema check for the authored pose clips in public/anim/clips/*.json
   (plan B2): sorted keys inside the duration, sixteen unit quaternions per
   key and in the rest, events in range. Exit 1 on any failure; an empty
   folder passes with a notice so CI runs before any clip is authored. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JOINTS = ['hips', 'spine', 'neck', 'head', 'leftArm', 'leftForearm', 'leftHand', 'rightArm', 'rightForearm', 'rightHand',
  'leftThigh', 'leftShin', 'leftFoot', 'rightThigh', 'rightShin', 'rightFoot'];
const MASKS = ['full', 'upper', 'lower', 'leftArm', 'rightArm', 'arms'];
const dir = fileURLToPath(new URL('../../public/anim/clips/', import.meta.url));

const finite = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const unit = q => finite(q, 4) && Math.abs(Math.hypot(...q) - 1) < 1e-3;

function checkJoints(joints, where, problems) {
  if (!joints || typeof joints !== 'object') { problems.push(`${where}: joints missing`); return; }
  for (const j of JOINTS) {
    const e = joints[j];
    if (!e) { problems.push(`${where}: joint ${j} missing`); continue; }
    if (!unit(e.q)) problems.push(`${where}: joint ${j} q is not a unit quaternion`);
    if (e.p !== undefined && !finite(e.p, 3)) problems.push(`${where}: joint ${j} p is not [x,y,z]`);
  }
  for (const j of Object.keys(joints)) if (!JOINTS.includes(j)) problems.push(`${where}: unknown joint ${j}`);
}

export function validateClip(clip, label) {
  const p = [];
  if (!clip || typeof clip !== 'object') return [`${label}: not an object`];
  if (clip.version !== 1) p.push(`${label}: version must be 1`);
  if (typeof clip.name !== 'string' || !clip.name) p.push(`${label}: name missing`);
  if (!(clip.duration > 0)) p.push(`${label}: duration must be > 0`);
  if (typeof clip.loop !== 'boolean') p.push(`${label}: loop must be boolean`);
  if (clip.mask !== undefined && !MASKS.includes(clip.mask)) p.push(`${label}: mask must be one of ${MASKS.join('/')}`);
  if (!clip.rest) p.push(`${label}: rest missing`);
  else {
    if (!finite(clip.rest.forward, 3) || Math.hypot(clip.rest.forward[0], clip.rest.forward[2]) < 1e-6) p.push(`${label}: rest.forward must be a horizontal [x,y,z]`);
    if (!(clip.rest.height > 0)) p.push(`${label}: rest.height must be > 0`);
    checkJoints(clip.rest.joints, `${label}: rest`, p);
    if (clip.rest.joints && clip.rest.joints.hips && !finite(clip.rest.joints.hips.p, 3)) p.push(`${label}: rest hips need p`);
  }
  if (!Array.isArray(clip.keys) || !clip.keys.length) p.push(`${label}: keys must be a non-empty array`);
  else clip.keys.forEach((k, i) => {
    const where = `${label}: key ${i}`;
    if (!Number.isFinite(k.time) || k.time < 0 || (clip.duration > 0 && k.time > clip.duration)) p.push(`${where}: time out of range`);
    if (i > 0 && !(k.time > clip.keys[i - 1].time)) p.push(`${where}: keys must be sorted by ascending time`);
    if (k.label !== undefined && typeof k.label !== 'string') p.push(`${where}: label must be a string`);
    checkJoints(k.joints, where, p);
    if (k.joints && k.joints.hips && !finite(k.joints.hips.p, 3)) p.push(`${where}: hips need p`);
  });
  if (clip.events !== undefined) {
    if (!Array.isArray(clip.events)) p.push(`${label}: events must be an array`);
    else clip.events.forEach((e, i) => {
      if (!Number.isFinite(e.time) || e.time < 0 || e.time > clip.duration) p.push(`${label}: event ${i} time out of range`);
      if (typeof e.name !== 'string' || !e.name) p.push(`${label}: event ${i} name missing`);
      if (!('value' in e)) p.push(`${label}: event ${i} value missing`);
    });
  }
  return p;
}

function main() {
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
  if (!files.length) { console.log(`NOTICE: no pose clips in ${dir}; nothing to check.`); return 0; }
  let failures = 0;
  for (const f of files) {
    let problems;
    try { problems = validateClip(JSON.parse(readFileSync(join(dir, f), 'utf8')), f); }
    catch (error) { problems = [`${f}: ${error.message}`]; }
    if (problems.length) { failures++; problems.forEach(m => console.error('FAIL ' + m)); }
    else console.log(`ok   ${f}`);
  }
  if (failures) { console.error(`FAIL: ${failures} of ${files.length} clips invalid.`); return 1; }
  console.log(`PASS: ${files.length} pose clips valid.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
