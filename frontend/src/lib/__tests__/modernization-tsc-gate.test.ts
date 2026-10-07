import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function gate(output: string, code: number, opts: { baseline?: Record<string, number>; update?: boolean; signal?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mc-tsc-gate-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'bin'));
    copyFileSync(fileURLToPath(new URL('../../../scripts/tsc-gate.mjs', import.meta.url)), join(root, 'scripts/tsc-gate.mjs'));
    const baseline = JSON.stringify(opts.baseline || {});
    writeFileSync(join(root, 'scripts/tsc-baseline.json'), baseline);
    writeFileSync(join(root, 'bin/npx'), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(output)});\n${opts.signal ? "process.kill(process.pid, 'SIGTERM');" : `process.exit(${code});`}\n`, { mode: 0o755 });
    const r = spawnSync(process.execPath, [join(root, 'scripts/tsc-gate.mjs'), ...(opts.update ? ['--update'] : [])], {
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH || ''}` }, encoding: 'utf8', timeout: 10000,
    });
    return { status: r.status, output: String(r.stdout) + String(r.stderr), baseline: readFileSync(join(root, 'scripts/tsc-baseline.json'), 'utf8'), original: baseline };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('clean compiler invocation passes', () => { assert.equal(gate('', 0).status, 0); });
test('no-emit compiler exit 1 with located diagnostics still enforces the ratchet', () => {
  const diagnostic = 'src/legacy.ts(1,1): error TS2322: Type mismatch.\n';
  assert.equal(gate(diagnostic, 1, { baseline: { 'src/legacy.ts': 1 } }).status, 0);
  assert.equal(gate(diagnostic, 1).status, 1);
});
test('known located type errors remain compatible with the existing ratchet', () => {
  assert.equal(gate('src/legacy.ts(1,1): error TS2322: Type mismatch.\n', 2, { baseline: { 'src/legacy.ts': 1 } }).status, 0);
});
test('new type errors fail', () => {
  assert.equal(gate('src/new.ts(1,1): error TS2322: Type mismatch.\n', 2).status, 1);
});
test('fatal project diagnostic fails instead of reporting zero errors', () => {
  const r = gate('error TS5058: The specified path does not exist.\n', 2);
  assert.equal(r.status, 1);
  assert.match(r.output, /could not complete/);
  assert.doesNotMatch(r.output, /type gate OK/);
});
test('configuration failure remains fatal when ordinary diagnostics also exist', () => {
  assert.equal(gate('src/legacy.ts(1,1): error TS2322: Type mismatch.\nerror TS5083: Cannot read config.\n', 2, { baseline: { 'src/legacy.ts': 1 } }).status, 1);
});
test('missing compiler or npm failure cannot pass', () => {
  assert.equal(gate('npm error could not determine executable to run\n', 1).status, 1);
});
test('silent nonzero compiler exit fails', () => { assert.equal(gate('', 2).status, 1); });
test('terminated compiler fails', () => { assert.equal(gate('', 0, { signal: true }).status, 1); });
test('baseline update cannot replace history after a fatal compiler error', () => {
  const r = gate('error TS5058: Bad project.\n', 2, { baseline: { 'src/legacy.ts': 137 }, update: true });
  assert.equal(r.status, 1);
  assert.equal(r.baseline, r.original);
});
test('successful compiler diagnostics can still update the ratchet', () => {
  const r = gate('src/legacy.ts(1,1): error TS2322: Type mismatch.\n', 2, { update: true });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.baseline), { 'src/legacy.ts': 1 });
});
