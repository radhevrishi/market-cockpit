import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAllowance, allowanceState, splitSpend, runCapUsd, isLive, MAX_EXTRA_USD, MAX_HOURS, SAFETY_MARGIN_USD,
} from '../guidance-extract-allowance';
import { extractRunUsd } from '../app-scheduler';

const T0 = new Date('2026-10-06T21:00:00Z');
const h = (n: number) => new Date(T0.getTime() + n * 3_600_000);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test('clamp: never more than $15 or 12 hours', () => {
  const a = buildAllowance({ usd: 500, hours: 99, concurrency: 50 }, T0)!;
  assert.equal(a.usd, MAX_EXTRA_USD);
  assert.equal(Date.parse(a.until) - T0.getTime(), MAX_HOURS * 3_600_000);
  assert.equal(a.concurrency, 10);
  assert.equal(buildAllowance({ usd: 0 }, T0), null);
  assert.equal(buildAllowance({ usd: 'abc' }, T0), null);
  assert.equal(buildAllowance({ usd: -3 }, T0), null);
  const d = buildAllowance({ usd: 14 }, T0)!;
  assert.equal(Date.parse(d.until) - T0.getTime(), 6 * 3_600_000);   // default 6 h
  assert.equal(d.concurrency, 8);
});

test('expiry: inactive after until; the normal ceiling alone applies again', () => {
  const a = buildAllowance({ usd: 14, hours: 6 }, T0)!;
  assert.equal(allowanceState(a, 0, h(5.9)).active, true);
  const after = allowanceState(a, 0, h(6));
  assert.equal(after.active, false); assert.equal(after.leftUsd, 0);
  assert.equal(runCapUsd(0.25, 0, after), 0);
  assert.equal(runCapUsd(0.25, 0.25, after), 0.25);
});

test('spend counter: left never goes past usd (safety margin held back)', () => {
  const a = buildAllowance({ usd: 14 }, T0)!;
  near(allowanceState(a, 0, h(1)).leftUsd, 14 - SAFETY_MARGIN_USD);
  assert.equal(allowanceState(a, 13.9, h(1)).active, false);
  assert.equal(allowanceState(a, 20, h(1)).leftUsd, 0);
  const st = allowanceState(a, 13, h(1));
  assert.ok(runCapUsd(2, 0, st) <= 14 - 13);
  assert.equal(runCapUsd(2, 0, allowanceState(a, 1, h(1))), 2);   // per-request cap $2
});

test('update keeps id, setAt and the 12-hour window (no spend reset)', () => {
  const a = buildAllowance({ usd: 10, hours: 6 }, T0)!;
  const b = buildAllowance({ usd: 14, hours: 12, concurrency: 4 }, h(5), a)!;
  assert.equal(b.id, a.id); assert.equal(b.setAt, a.setAt);
  assert.equal(Date.parse(b.until), T0.getTime() + MAX_HOURS * 3_600_000);   // capped at setAt + 12 h, not h(5)+12
  assert.equal(b.concurrency, 4);
  const c = buildAllowance({ usd: 5 }, h(13), a)!;   // old one expired → a fresh allowance
  assert.notEqual(c.id, a.id);
});

test('a hand-edited record cannot stretch the window or the amount', () => {
  assert.equal(isLive({ id: 'x', usd: 15, setAt: T0.toISOString(), until: h(48).toISOString(), reason: '', concurrency: 8 }, h(1)), false);
  near(allowanceState({ id: 'x', usd: 999, setAt: T0.toISOString(), until: h(2).toISOString(), reason: '', concurrency: 8 }, 0, h(1)).leftUsd, MAX_EXTRA_USD - SAFETY_MARGIN_USD);
});

test('split: day budget first, rest to the allowance', () => {
  assert.deepEqual(splitSpend(1.5, 0.25), { day: 0.25, extra: 1.25 });
  assert.deepEqual(splitSpend(0.1, 0.25), { day: 0.1, extra: 0 });
  assert.deepEqual(splitSpend(1, 0), { day: 0, extra: 1 });
});

test('hourly job: $2 a run only while an allowance is active', () => {
  assert.equal(extractRunUsd({ allowance: { active: true, leftUsd: 5 } }), 2);
  assert.equal(extractRunUsd({ allowance: { active: false, leftUsd: 0 } }), 0.25);
  assert.equal(extractRunUsd(null), 0.25);
});

test('wiring: route sets the allowance only on POST (protected) and charges both counters', () => {
  const src = readFileSync(join(__dirname, '../../app/api/v1/guidance-extract/route.ts'), 'utf8');
  const post = src.slice(src.indexOf('export async function POST'));
  assert.ok(post.indexOf("action') === 'allowance'") > post.indexOf('authorised(req)'));
  assert.match(src, /allowanceSpendKey\(allow\.id\), part\.extra/);
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'));
  assert.ok(!get.includes('kvSet('));
  const yml = readFileSync(join(__dirname, '../../../../.github/workflows/ai-guidance-extract.yml'), 'utf8');
  assert.match(yml, /extra_usd:/); assert.match(yml, /extra_until_hours:/);
});

test('zzz928b: a provider spend / quota limit stops the run (never a per-document error)', async () => {
  const { modelErrorKind } = await import('../ai-guidance-extract');
  assert.equal(modelErrorKind(429, '', 'Your project has reached its configured enforced spend limit. Update your limit at https://platform.openai.com/x'), 'spend_cap');
  assert.equal(modelErrorKind(429, 'insufficient_quota', 'You exceeded your current quota'), 'spend_cap');
  assert.equal(modelErrorKind(402, '', ''), 'spend_cap');
  assert.equal(modelErrorKind(429, '', 'Rate limit reached for gpt-5-mini on tokens per min'), 'error');
  assert.equal(modelErrorKind(500, '', 'server error'), 'error');
  assert.equal(modelErrorKind(401, 'no_key', ''), 'no_key');
});

test('zzz978 Anthropic credit / key errors stop the run instead of failing each document', async () => {
  const { modelErrorKind } = await import('../ai-guidance-extract');
  assert.equal(modelErrorKind(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'), 'spend_cap');
  assert.equal(modelErrorKind(401, 'authentication_error', 'invalid x-api-key'), 'no_key');
  assert.equal(modelErrorKind(403, 'permission_error', 'not allowed'), 'no_key');
  assert.equal(modelErrorKind(500, 'api_error', 'Internal server error'), 'error');
  assert.equal(modelErrorKind(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit'), 'error');
});

test('zzz978b pasted keys are cleaned of spaces, line breaks and quotes', async () => {
  const { cleanKeyValue } = await import('../anthropic-meter');
  assert.equal(cleanKeyValue('  sk-ant-api03-abc\n'), 'sk-ant-api03-abc');
  assert.equal(cleanKeyValue('"sk-ant-api03-abc"'), 'sk-ant-api03-abc');
  assert.equal(cleanKeyValue('ANTHROPIC_API_KEY=sk-ant-api03-abc'), 'sk-ant-api03-abc');
  assert.equal(cleanKeyValue('\uFEFFsk-ant-api03-abc'), 'sk-ant-api03-abc');
});
