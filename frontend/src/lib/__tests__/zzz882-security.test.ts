import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isProtectedApi } from '../site-auth';

test('paid-AI and job-starting routes need the owner login or a service key', () => {
  for (const p of ['/api/v1/us/ai-summary', '/api/v1/ai/desk', '/api/v1/ai-gainers', '/api/v1/ai-gainers/research', '/api/v1/cron/trigger-screener-sync', '/api/v1/guidance-extract', '/api/v1/results-pdf'])
    assert.ok(isProtectedApi(p), p);
  assert.ok(!isProtectedApi('/api/v1/guidance-upgrades'));
});
test('us/ai-summary refuses a non-SEC filing URL (no server-side fetch of localhost or this app)', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'us', 'ai-summary', 'route.ts'), 'utf8');
  assert.match(src, /function isSecUrl/);
  assert.match(src, /filingUrl && !isSecUrl\(filingUrl\)/);
});
test('paid AI runs never take a lock they could not confirm', () => {
  for (const f of ['ai-guidance-extract.ts', 'ai-verify.ts']) assert.match(readFileSync(join(__dirname, '..', f), 'utf8'), /race\(m\.kvSetNX\(k, v, ttl\), false\)/, f);
  assert.match(readFileSync(join(__dirname, '..', 'india-results-pdf-run.ts'), 'utf8'), /setNX\(RP_LOCK_KEY.*\.catch\(\(\) => false\)/);
});
