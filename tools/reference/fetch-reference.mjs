#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Fetch the reference logograms.

   These are the 38 real logogram frames that Wolfram isolated from the film
   for Arrival-Movie-Live-Coding. They are by far the best available reference
   for what a logogram is supposed to look like — 3300x3300 each, and the
   low-resolution "with translation" sheet that circulates online hides exactly
   the detail that matters (stroke weight, how the ink feathers, what the
   offshoots look like).

   They are deliberately NOT committed here. They are film assets, they are
   large, and they already live in a public repository. So this fetches them on
   demand into tools/reference/logograms/, which is gitignored.

     npm run reference
   ═══════════════════════════════════════════════════════════════════════════ */

import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'logograms');

const REPO = 'WolframResearch/Arrival-Movie-Live-Coding';
const API = `https://api.github.com/repos/${REPO}/contents/ScriptLogoJpegs`;
const RAW = `https://raw.githubusercontent.com/${REPO}/master/ScriptLogoJpegs`;

const FORCE = process.argv.includes('--force');

async function list() {
  const res = await fetch(API, { headers: { 'user-agent': 'arrival-reference' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  const items = await res.json();
  return items.filter((i) => i.type === 'file' && /\.jpe?g$/i.test(i.name));
}

async function main() {
  if (existsSync(OUT) && FORCE) await rm(OUT, { recursive: true });
  await mkdir(OUT, { recursive: true });

  console.log(`fetching reference logograms into ${OUT}`);
  const files = await list();
  console.log(`${files.length} available\n`);

  let got = 0, skipped = 0, failed = 0;
  for (const f of files) {
    const dest = join(OUT, f.name);
    if (existsSync(dest) && !FORCE) { skipped++; continue; }
    try {
      const res = await fetch(`${RAW}/${f.name}`, { headers: { 'user-agent': 'arrival-reference' } });
      if (!res.ok) throw new Error(String(res.status));
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      got++;
      process.stdout.write(`\r  ${got + skipped + failed}/${files.length}  ${f.name.padEnd(34)}`);
    } catch (e) {
      failed++;
      process.stdout.write(`\r  ${got + skipped + failed}/${files.length}  ${f.name}  FAILED (${e.message})\n`);
    }
  }

  const n = (await readdir(OUT)).filter((f) => /\.jpe?g$/i.test(f)).length;
  console.log(`\n\n${n} files in ${OUT}  (${got} fetched, ${skipped} already present, ${failed} failed)`);
  console.log(`\nnow open:  http://localhost:3000/tools/reference/compare.html\n`);
}

main().catch((e) => { console.error('\nfetch failed:', e.message); process.exit(1); });
