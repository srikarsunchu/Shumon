#!/usr/bin/env node
/* Drives open-media's Shot Composer over its MCP server to turn the pose
   specs in anim/poses/*.json into playable clips in public/anim/clips/.

   Usage:
     node scripts/anim/author.mjs [--open-media ../open-media] [--only draw,stance_stone_idle]
                                  [--shots out/dir] [--dry]

   Requires: the open-media dev server running with the composer page open in
   a browser tab (it connects to ws://localhost:39217 on its own), and
   `npm install` done in open-media/mcp. This script spawns the MCP server
   itself, so nothing else may be listening on 39217.

   A pose spec is a small authoring format, deliberately in mannequin.js's
   own joint vocabulary so it stays hand-editable:

     { "name": "stance_stone_idle", "loop": true, "mask": "full",
       "events": [{ "time": .45, "name": "katanaInHand", "value": true }],
       "keys": [
         { "time": 0, "label": "settle",
           "use": "stance_stone_idle#0",             // optional: start from another key
           "joints": { "r_arm": { "raise": 50, "straddle": -8 }, "r_elbow": { "bend": 55 } } },
         ...
       ] }

   Angles are degrees on mannequin.js DOFs (raise/straddle/turn, bend/tilt/turn,
   nod for the head). Unlisted joints reset to zero for that key unless the
   key `use`s another key as its base. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OM = resolve(root, opt('--open-media', '../open-media'));
const ONLY = opt('--only', '') ? opt('--only', '').split(',') : null;
const SHOTS = opt('--shots', join(root, 'anim/shots'));
const DRY = args.includes('--dry');
const POSES = join(root, 'anim/poses');
const CLIPS = join(root, 'public/anim/clips');

/* a direct file import bypasses the package's exports map, so point at the
   ESM build itself */
const sdk = p => import(pathToFileURL(join(OM, 'mcp/node_modules/@modelcontextprotocol/sdk/dist/esm', p)).href);
const { Client } = await sdk('client/index.js');
const { StdioClientTransport } = await sdk('client/stdio.js');

/* ---------------------------------------------------------- specs */
const specs = {};
for (const f of (await readdir(POSES)).filter(f => f.endsWith('.json')).sort()) {
  const s = JSON.parse(await readFile(join(POSES, f), 'utf8'));
  if (!s.name) s.name = f.replace(/\.json$/, '');
  specs[s.name] = s;
}
/* resolve `use` references into flat joint dictionaries, recursively */
function resolveKey(spec, k, seen = new Set()) {
  let base = {};
  if (k.use) {
    const [name, idx] = k.use.split('#');
    const tag = `${name}#${idx}`;
    if (seen.has(tag)) throw new Error(`circular use: ${tag}`);
    seen.add(tag);
    const other = specs[name]; if (!other) throw new Error(`${spec.name}: unknown spec in use: ${name}`);
    const ok = other.keys[+idx]; if (!ok) throw new Error(`${spec.name}: unknown key in use: ${tag}`);
    base = resolveKey(other, ok, seen);
  }
  const out = {};
  for (const j of Object.keys(base)) out[j] = { ...base[j] };
  for (const j of Object.keys(k.joints || {})) out[j] = { ...(out[j] || {}), ...k.joints[j] };
  return out;
}
/* mannequin.js keeps the figure's facing in body.turn (−90 on a fresh Male),
   and set_joints writes the DOF absolutely — so a spec's body.turn is
   authored relative to that facing and offset here, or a 6° twist turns the
   whole figure to the side and the exported hip delta carries a quarter turn */
const BODY_FACING = -90;
function toComposer(flat) {
  const out = {};
  for (const j of Object.keys(flat)) {
    out[j] = { ...flat[j] };
    if (j === 'body' && out[j].turn !== undefined) out[j].turn += BODY_FACING;
  }
  return out;
}

/* ---------------------------------------------------------- mcp */
const transport = new StdioClientTransport({ command: 'node', args: [join(OM, 'mcp/server.js')], stderr: 'pipe' });
transport.stderr?.on('data', d => process.stderr.write('[mcp] ' + d));
const client = new Client({ name: 'temple-night-author', version: '1.0.0' });
await client.connect(transport);
const tools = (await client.listTools()).tools.map(t => t.name);
for (const need of ['get_scene', 'add_object', 'set_mode', 'set_joints', 'add_keyframe', 'export_clip', 'capture_shot', 'clear_scene', 'set_duration'])
  if (!tools.includes(need)) throw new Error(`MCP server lacks tool ${need}; got ${tools.join(', ')}`);

async function call(name, params = {}) {
  const r = await client.callTool({ name, arguments: params });
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content).slice(0, 400)}`);
  const text = r.content?.find(c => c.type === 'text')?.text;
  const image = r.content?.find(c => c.type === 'image');
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { json, image, text };
}

/* wait for the composer tab to be bridged */
for (let i = 0; ; i++) {
  try { await call('get_scene'); break; }
  catch (e) {
    if (i > 120) throw e;
    if (i === 0) console.log('waiting for a Shot Composer tab on ws://localhost:39217 …');
    await new Promise(r => setTimeout(r, 1000));
  }
}

/* ---------------------------------------------------------- run */
await mkdir(CLIPS, { recursive: true });
await mkdir(SHOTS, { recursive: true });
await call('clear_scene');
const added = await call('add_object', { type: 'male' });
const scene = await call('get_scene');
const figure = scene.json.objects.find(o => o.type === 'male') || scene.json.objects[0];
const id = added.json?.id || figure?.id;
if (!id) throw new Error('no character in the scene after add_object');
await call('set_mode', { mode: 'motion' });

const names = Object.keys(specs).filter(n => !ONLY || ONLY.includes(n));
for (const name of names) {
  const spec = specs[name];
  const keys = spec.keys.map(k => ({ ...k, flat: resolveKey(spec, k) }));
  const duration = Math.max(.1, ...keys.map(k => k.time));
  console.log(`\n${name}: ${keys.length} keys, ${duration}s${spec.loop ? ', loop' : ''}`);
  if (DRY) { keys.forEach(k => console.log(`  ${k.time}s ${k.label || ''} ${Object.keys(k.flat).join(' ')}`)); continue; }

  /* a fresh figure per clip keeps the keyframe track clean */
  await call('clear_scene');
  const a = await call('add_object', { type: 'male' });
  const fid = a.json?.id || (await call('get_scene')).json.objects[0].id;
  await call('set_mode', { mode: 'motion' });
  await call('set_duration', { duration });
  for (const k of keys) {
    /* every key is described whole, so start it from the figure's default
       posture rather than layering on whatever the previous key left */
    await call('reset_pose', { id: fid });
    await call('set_joints', { id: fid, joints: toComposer(k.flat) });
    await call('add_keyframe', { id: fid, time: k.time });
    /* a contact sheet per key, three angles, for review */
    for (const [angle, tag] of [['front', 'f'], ['threeQuarterLeft', 'q'], ['profile', 'p']]) {
      await call('set_shot', { shotSize: 'full', angle, elevation: 'eye', composition: 'center' });
      /* a capture is review material, not the deliverable: a hidden or slow
         tab can miss the bridge's reply window, so retry, then move on */
      let shot = null;
      for (let attempt = 0; attempt < 3 && !shot; attempt++) {
        try { shot = await call('capture_shot', { download: false }); }
        catch (e) { console.warn(`  capture ${tag} @${k.time}s failed (${attempt + 1}/3): ${e.message.slice(0, 80)}`); await new Promise(r => setTimeout(r, 800)); }
      }
      if (shot?.image) await writeFile(join(SHOTS, `${name}.${k.time.toFixed(2)}${k.label ? '.' + k.label : ''}.${tag}.png`), Buffer.from(shot.image.data, 'base64'));
    }
  }
  const clip = await call('export_clip', {
    id: fid, name, loop: !!spec.loop, mask: spec.mask || 'full',
    keys: keys.map(k => ({ time: k.time, label: k.label })),
    events: spec.events || []
  });
  const out = clip.json;
  if (!out || !out.keys) throw new Error(`${name}: export_clip returned no clip`);
  await writeFile(join(CLIPS, `${name}.json`), JSON.stringify(out));
  console.log(`  → public/anim/clips/${name}.json (${out.keys.length} keys, rest forward ${out.rest?.forward?.map(v => v.toFixed(2)).join(',')})`);
}
await client.close();
console.log('\ndone');
