#!/usr/bin/env node
/* A tiny local sink for in-game captures: the page POSTs a data URL to
   http://localhost:5177/shot?name=<label> and it lands in anim/shots/game/.
   Used when the browser pane cannot be screenshotted from outside. */
import { createServer } from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(root, 'anim/shots/game');
await mkdir(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 5177;
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const url = new URL(req.url, 'http://x');
  if (req.method !== 'POST' || url.pathname !== '/shot') { res.statusCode = 404; res.end('no'); return; }
  const name = (url.searchParams.get('name') || 'shot').replace(/[^\w.-]/g, '_');
  let body = '';
  req.on('data', d => body += d);
  req.on('end', async () => {
    const m = /^data:image\/(png|jpeg);base64,(.*)$/s.exec(body);
    if (!m) { res.statusCode = 400; res.end('bad data url'); return; }
    const file = join(OUT, `${name}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
    await writeFile(file, Buffer.from(m[2], 'base64'));
    res.end(file);
    console.log('saved', file);
  });
}).listen(PORT, () => console.log(`shot sink on http://localhost:${PORT}/shot`));
