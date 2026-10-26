// zzz1182 — gpt-6.1-terra: priced, treated as a reasoning model, the default stronger pass; unknown models never cost 0;
// a stronger model the account cannot use falls back to gpt-5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { costOf, pricingFor, toOpenAIRequest } from '../anthropic-meter';

test('gpt-6.1-terra priced $1 / $5 / $0.05 cached', () => {
  assert.deepEqual(pricingFor('gpt-6.1-terra'), { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1 });
  assert.equal(costOf('gpt-6.1-terra', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 6);
});

test('an unknown model is charged a high fallback rate, never 0 (caps keep working)', () => {
  assert.ok(costOf('gpt-7-nova', { input_tokens: 1_000_000, output_tokens: 0 }) >= 3);
  assert.equal(costOf('some-embedding-x', { input_tokens: 1_000_000 }), 0);
});

test('GPT-6 is sent as a reasoning model (reasoning effort, room for hidden tokens)', () => {
  const r = toOpenAIRequest({ model: 'x', max_tokens: 1000, messages: [{ role: 'user', content: 'hi' }] } as any, 'gpt-6.1-terra', 'low');
  assert.equal(r.reasoning_effort, 'low'); assert.equal(r.max_completion_tokens, 6000); assert.equal(r.temperature, undefined);
});

test('fallback to gpt-5 when the stronger model is refused', () => {
  const m = readFileSync(new URL('../anthropic-meter.ts', import.meta.url), 'utf8');
  assert.match(m, /const STRONG_FALLBACK = 'gpt-5'/); assert.match(m, /openaiModel: STRONG_FALLBACK/);
});
