// zzz1213 — PDFs are parsed in a separate, time-limited process so a bad PDF can never block or crash the web server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePdfIsolated } from '../pdf-parse-isolated';

test('garbage input fails cleanly in the child process (no throw, no hang)', async () => {
  const r: any = await parsePdfIsolated(Buffer.from('not a pdf at all'), { timeoutMs: 20_000 });
  assert.ok('error' in r);
});

test('a parse that runs too long is killed and reported', async () => {
  const r: any = await parsePdfIsolated(Buffer.from('%PDF-1.4\n'), { timeoutMs: 1 });
  assert.ok('error' in r);
});

test('the extractor uses the isolated parser and only falls back in-process for small files', () => {
  const s = readFileSync(new URL('../pdf-text-extractor.ts', import.meta.url), 'utf8');
  assert.match(s, /parsePdfIsolated\(buf/);
  assert.match(s, /buf\.length > 3 \* 1024 \* 1024/);
  const iso = readFileSync(new URL('../pdf-parse-isolated.ts', import.meta.url), 'utf8');
  assert.match(iso, /child\.kill\('SIGKILL'\)/);
  assert.match(iso, /console\.log = console\.info = console\.warn/);   // pdf.js warnings must not corrupt the result
});
