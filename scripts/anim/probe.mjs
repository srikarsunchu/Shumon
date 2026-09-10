#!/usr/bin/env node
/* Poses one joint through open-media's bridge at a series of values and
   captures a profile shot for each, so a DOF's real meaning can be read off
   before it is written into a spec.

   node scripts/anim/probe.mjs r_arm raise 60,90,120,150 [--angle profile] */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const OM = resolve(root, '../open-media');
const [joint, dof, list] = process.argv.slice(2);
const angleArg = process.argv.indexOf('--angle');
const angle = angleArg > 0 ? process.argv[angleArg + 1] : 'profile';
if (!joint || !dof || !list) { console.error('usage: probe.mjs <joint> <dof> <v1,v2,...>'); process.exit(1); }
const values = list.split(',').map(Number);
const OUT = join(root, 'anim/shots/probe');

const sdk = p => import(pathToFileURL(join(OM, 'mcp/node_modules/@modelcontextprotocol/sdk/dist/esm', p)).href);
const { Client } = await sdk('client/index.js');
const { StdioClientTransport } = await sdk('client/stdio.js');
const transport = new StdioClientTransport({ command: 'node', args: [join(OM, 'mcp/server.js')], stderr: 'pipe' });
const client = new Client({ name: 'temple-night-probe', version: '1.0.0' });
await client.connect(transport);
async function call(name, params = {}) {
  const r = await client.callTool({ name, arguments: params });
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content).slice(0, 300)}`);
  const text = r.content?.find(c => c.type === 'text')?.text;
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { json, image: r.content?.find(c => c.type === 'image') };
}
for (let i = 0; ; i++) {
  try { await call('get_scene'); break; }
  catch (e) { if (i > 120) throw e; await new Promise(r => setTimeout(r, 1000)); }
}
await mkdir(OUT, { recursive: true });
await call('clear_scene');
const a = await call('add_object', { type: 'male' });
const id = a.json?.id || (await call('get_scene')).json.objects[0].id;
await call('set_shot', { shotSize: 'full', angle, elevation: 'eye', composition: 'center' });
for (const v of values) {
  await call('reset_pose', { id });
  const r = await call('set_joints', { id, joints: { [joint]: { [dof]: v } } });
  const t = r.json?.transforms?.joints;
  const key = joint.replace(/^l_/, 'left').replace(/^r_/, 'right').replace('arm', 'Arm').replace('elbow', 'Forearm').replace('wrist', 'Hand').replace('leg', 'Thigh').replace('knee', 'Shin').replace('ankle', 'Foot');
  const p = t?.[key]?.p, hand = t?.[key.replace('Arm', 'Hand').replace('Thigh', 'Foot')]?.p;
  console.log(`${joint}.${dof}=${v}`, 'applied', JSON.stringify(r.json?.joints?.[joint]), 'jointP', p?.map(x => x.toFixed(2)).join(','), 'endP', hand?.map(x => x.toFixed(2)).join(','));
  const shot = await call('capture_shot', { download: false });
  if (shot.image) await writeFile(join(OUT, `${joint}.${dof}.${v}.png`), Buffer.from(shot.image.data, 'base64'));
}
await client.close();
