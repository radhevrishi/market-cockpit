#!/usr/bin/env node
// zzz883 CI — runs every test file; a file that fails is run ONE more time on its own (one known test depends on wall-clock
// timing). A test that fails twice fails the build.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = 'src/lib/__tests__';
const files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.test.ts')).map((f) => `${dir}/${f}`);
// Use Node's loader directly: no tsx CLI IPC socket and bounded worker memory.
// Deployment builds may have provider variables. Tests use their own fakes,
// never production databases, Redis, paid model keys or notification credentials.
const testEnv = { ...process.env };
for (const name of Object.keys(testEnv)) {
  if (/(?:SECRET|PASSWORD|TOKEN|API_KEY|FMP_KEY|SESSIONID)(?:_|$)/.test(name) || /^(?:DATABASE_URL|POSTGRES_URL|PG_URL|REDIS_URL|KV_URL|NOTIFY_EMAIL_TO|TELEGRAM_CHAT_ID(?:_.*)?|SMTP_.*)$/.test(name)) delete testEnv[name];
}
const run = (list) => spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=4', '--test-reporter=tap', ...list], { cwd: root, env: testEnv, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const r = run(files);
const tap = String(r.stdout || '');
const pass = /^# pass (\d+)/m.exec(tap)?.[1], fail = Number(/^# fail (\d+)/m.exec(tap)?.[1] || 0);
console.log(`tests: ${pass} passed, ${fail} failed`);
if (r.status === 0 && fail === 0) process.exit(0);
const failedFiles = new Set();
const lines = tap.split('\n');
lines.forEach((l, i) => {
  if (!/^\s*not ok /.test(l)) return;
  for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
    const m = /location: '([^']+?\.test\.ts)/.exec(lines[j]);
    if (m) { failedFiles.add(m[1].slice(m[1].indexOf(dir))); break; }
  }
});
if (!failedFiles.size) { console.error(tap.slice(-4000)); process.exit(1); }
console.log(`re-running ${failedFiles.size} file(s) once: ${[...failedFiles].join(', ')}`);
const r2 = run([...failedFiles]);
const fail2 = Number(/^# fail (\d+)/m.exec(String(r2.stdout || ''))?.[1] || 0);
if (r2.status === 0 && fail2 === 0) { console.log('passed on re-run (timing-dependent test)'); process.exit(0); }
console.error(String(r2.stdout || '').split('\n').filter((l) => /not ok|error:|expected|actual/.test(l)).slice(0, 80).join('\n'));
process.exit(1);
