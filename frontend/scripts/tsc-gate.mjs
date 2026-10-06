#!/usr/bin/env node
// zzz883 CI — type-check gate. The code base carries older type errors (the build ignores them), so the gate is a RATCHET:
// it fails when any file gets MORE errors than in scripts/tsc-baseline.json, or a new file starts having errors.
// Fixing errors is always allowed; run `node scripts/tsc-gate.mjs --update` afterwards to lock the lower numbers in.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const basePath = join(here, 'tsc-baseline.json');
let out = '';
try { out = execSync('npx tsc --noEmit -p .', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
const counts = {};
for (const line of out.split('\n')) {
  const m = /^(.+?)\(\d+,\d+\): error TS\d+/.exec(line.trim());
  if (!m) continue;
  const f = m[1].replace(/\\/g, '/');
  if (f.startsWith('.next/')) continue;   // generated per build; the real page/route file is checked by `next build`
  counts[f] = (counts[f] || 0) + 1;
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (process.argv.includes('--update')) {
  writeFileSync(basePath, JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 1) + '\n');
  console.log(`baseline written: ${total} errors in ${Object.keys(counts).length} files`);
  process.exit(0);
}
const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : {};
const worse = Object.entries(counts).filter(([f, n]) => n > (base[f] || 0));
const better = Object.entries(base).filter(([f, n]) => (counts[f] || 0) < n);
console.log(`type errors: ${total} (baseline ${Object.values(base).reduce((a, b) => a + b, 0)})`);
for (const [f, n] of better) console.log(`  improved: ${f} ${base[f]} → ${counts[f] || 0}`);
if (worse.length) {
  console.error('NEW type errors (fix them before merging):');
  for (const [f, n] of worse) console.error(`  ${f}: ${base[f] || 0} → ${n}`);
  for (const line of out.split('\n')) if (worse.some(([f]) => line.startsWith(f))) console.error('   ', line.trim());
  process.exit(1);
}
console.log('type gate OK');
