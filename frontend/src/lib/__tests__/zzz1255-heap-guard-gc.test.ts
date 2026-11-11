// zzz1255 — the heap guard held the 12:23 UTC transformational-archive slot at 2.3–2.4 GB of heap with nothing running.
// heapUsed counts dead objects until V8 collects, so the guard now runs a full collection before holding jobs, and the
// portfolio grades route keeps compact per-session rows instead of re-reading 120 whole graded payloads on each call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forceGcDue, forceFullGc, FORCE_GC_MIN_GAP_MS } from '../force-gc';

test('forced collection is rate-limited', () => {
  const now = Date.parse('2026-11-11T12:30:00Z');
  assert.equal(forceGcDue(0, now), true);
  assert.equal(forceGcDue(now - FORCE_GC_MIN_GAP_MS + 1, now), false);
  assert.equal(forceGcDue(now - FORCE_GC_MIN_GAP_MS, now), true);
});

test('forceFullGc frees dead objects', () => {
  let junk: any[] | null = [];
  for (let i = 0; i < 200; i++) junk.push(new Array(50_000).fill({ i }));
  junk = null;
  const r = forceFullGc();
  assert.ok(r, 'gc available');
  assert.ok(r!.afterMb <= r!.beforeMb);
  assert.equal(forceFullGc(), null);   // second call within 5 min is skipped
});

test('scheduler collects before deferring heavy jobs', () => {
  const src = readFileSync(new URL('../app-scheduler.ts', import.meta.url), 'utf8');
  assert.match(src, /const \{ forceFullGc \} = await import\('\.\/force-gc'\);/);
  const i = src.indexOf('forceFullGc()'), j = src.indexOf('if (!shouldDeferHeavyJob(heapUsedBytes)) heapBlockedSince = 0;');
  assert.ok(i > 0 && j > i);
});

test('portfolio grades keep compact per-session rows', () => {
  const src = readFileSync(new URL('../../app/api/v1/portfolio/earnings-grades/route.ts', import.meta.url), 'utf8');
  assert.match(src, /const SESSION_MEMO = new Map/);
  assert.match(src, /rows = compactOf\(withCurrentIndiaRules\(v, keys\[i\]\), d\)/);
  assert.match(src, /if \(!want\.has\(r\.t\)\) continue;/);
});
