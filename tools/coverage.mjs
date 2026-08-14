#!/usr/bin/env node
/* ============================================================================
   tools/coverage.mjs — TDD.md §10.11

       node tools/coverage.mjs

   Runs the suite under V8's own coverage collector and reports executed-byte
   coverage per module, gating at 90% over the engine — src/10-normalise.js
   through src/60-engine.js. The UI layer is exempt by §10.11, and 00-config.js
   is declarations only, so both are reported but not gated.

   Byte coverage rather than statement coverage: V8 reports ranges, which is
   also what node's own --experimental-test-coverage derives its numbers from.
   Ranges are strictly harsher than statement counting on a file full of
   short-circuit expressions, so a figure that clears 90% here would clear it
   on any statement counter too.
   ========================================================================= */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GATE = 0.90;
const GATED = /src[\\/](?:10|20|30|40|50|60)-/;

const dir = mkdtempSync(join(tmpdir(), 'callover-cov-'));
console.log('\nrunning the suite under V8 coverage…\n');
const run = spawnSync(process.execPath, [join(ROOT, 'tests', 'run.mjs')], {
  cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: dir }, encoding: 'utf8'
});
const tail = (run.stdout || '').trim().split('\n').slice(-4).join('\n');
console.log(tail);
if (run.status !== 0) {
  console.error('\nthe test suite failed; coverage is not reported for a red suite.\n');
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

/* Merge every coverage file, keeping the highest count seen for each range. */
const byUrl = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const s of data.result || []) {
    if (!/[\\/]src[\\/]\d\d-.*\.js$/.test(decodeURIComponent(s.url))) continue;
    const key = decodeURIComponent(s.url).replace(/^file:\/\/\/?/, '');
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(...s.functions);
  }
}
rmSync(dir, { recursive: true, force: true });

if (!byUrl.size) {
  console.error('\nno coverage was collected for src/ — did the suite import the modules?\n');
  process.exit(1);
}

console.log('\n  module                     bytes   covered   %      gate');
console.log('  ' + '-'.repeat(60));

let gatedCovered = 0, gatedTotal = 0, worst = null;
const rows = [];

for (const [url, functions] of [...byUrl].sort()) {
  const path = url.replace(/\//g, process.platform === 'win32' ? '\\' : '/');
  let size;
  try { size = statSync(path).size; } catch { size = 0; }
  if (!size) continue;

  /* Mark every byte the engine never entered. A range with count 0 is dead;
     a nested range with a count reinstates its bytes. */
  const dead = new Uint8Array(size);
  const all = functions.flatMap(fn => fn.ranges.map(r => ({ ...r, len: r.endOffset - r.startOffset })));
  all.sort((a, b) => b.len - a.len);                 // widest first, so inner ranges win
  for (const r of all) {
    const from = Math.max(0, r.startOffset), to = Math.min(size, r.endOffset);
    const v = r.count === 0 ? 1 : 0;
    for (let i = from; i < to; i++) dead[i] = v;
  }
  let uncovered = 0;
  for (let i = 0; i < size; i++) if (dead[i]) uncovered++;

  const covered = size - uncovered;
  const pct = covered / size;
  const name = 'src/' + path.split(/[\\/]/).pop();
  const gated = GATED.test(path);
  if (gated) { gatedCovered += covered; gatedTotal += size; if (!worst || pct < worst.pct) worst = { name, pct }; }
  rows.push({ name, size, covered, pct, gated });
}

for (const r of rows.sort((a, b) => a.name.localeCompare(b.name)))
  console.log(`  ${r.name.padEnd(22)} ${String(r.size).padStart(7)} ${String(r.covered).padStart(9)}` +
              `  ${(r.pct * 100).toFixed(1).padStart(5)}%  ${r.gated ? (r.pct >= GATE ? 'ok' : 'BELOW') : 'exempt'}`);

const overall = gatedTotal ? gatedCovered / gatedTotal : 0;
console.log('  ' + '-'.repeat(60));
console.log(`  engine (10- … 60-)     ${String(gatedTotal).padStart(7)} ${String(gatedCovered).padStart(9)}` +
            `  ${(overall * 100).toFixed(1).padStart(5)}%  gate ${(GATE * 100).toFixed(0)}%`);
if (worst) console.log(`  lowest gated module: ${worst.name} at ${(worst.pct * 100).toFixed(1)}%`);

if (overall < GATE) {
  console.error(`\ncoverage gate not met: ${(overall * 100).toFixed(1)}% < ${(GATE * 100).toFixed(0)}% (§10.11)\n`);
  process.exit(1);
}
console.log(`\ncoverage gate met.\n`);
