import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';
import { reserveBudget, settleBudget, RESERVE_BUDGET_LUA, SETTLE_BUDGET_LUA, type BudgetEval } from '../ai-budget';

// Deterministic durable-store oracle. Actual Lua is also exercised against Redis in the local integration check.
function store() {
  const values = new Map<string, any>();
  let fail = false;
  const evaluate: BudgetEval = async (script, keys, args) => {
    if (fail) return null;
    const [total, reserved, marker] = keys;
    const spent = Number(values.get(total) || 0), held = Number(values.get(reserved) || 0);
    if (script === RESERVE_BUDGET_LUA) {
      const [floor, amount, cap] = args.map(Number), used = Math.max(spent, floor);
      if (used + held + amount > cap || (!amount && used + held >= cap)) return ['cap', String(used), String(held)];
      if (amount) { values.set(total, used); values.set(reserved, held + amount); values.set(marker, amount); }
      return ['ok', String(used), String(held + amount)];
    }
    assert.equal(script, SETTLE_BUDGET_LUA);
    const old = values.get(marker);
    if (old === 'done') return 1;
    if (old == null) return 0;
    values.set(total, spent + Number(args[0])); values.set(reserved, Math.max(0, held - Number(old))); values.set(marker, 'done');
    return 1;
  };
  return { values, evaluate, fail: (v: boolean) => { fail = v; } };
}

const input = { spentKey: 'spent', reservedKey: 'held', month: '2026-10', spentFloor: 0, estimate: 0.06, cap: 0.1, ttl: 86400 };
test('concurrent calls cannot reserve the same remaining allowance', async () => {
  const s = store();
  const gates = await Promise.all(Array.from({ length: 20 }, () => reserveBudget(input, s.evaluate)));
  assert.equal(gates.filter((g) => g.allowed).length, 1);
  assert.equal(s.values.get('held'), 0.06);
});

test('settlement exchanges held money for actual spend without an admission gap; duplicate settlement is harmless', async () => {
  const s = store(), gate = await reserveBudget(input, s.evaluate);
  const copy = { ...gate.reservation! };
  assert.equal(await settleBudget(gate.reservation, 0.04, 86400, s.evaluate), true);
  assert.equal(await settleBudget(copy, 0.04, 86400, s.evaluate), true);
  assert.equal(s.values.get('spent'), 0.04);
  assert.equal(s.values.get('held'), 0);
  assert.equal((await reserveBudget({ ...input, estimate: 0.07 }, s.evaluate)).allowed, false);
  assert.equal((await reserveBudget(input, s.evaluate)).allowed, true);
});

test('failed settlement retains the reservation and can be retried; old-month usage stays in the original month', async () => {
  const s = store(), gate = await reserveBudget(input, s.evaluate);
  s.fail(true);
  assert.equal(await settleBudget(gate.reservation, 0.03, 86400, s.evaluate), false);
  assert.equal(gate.reservation!.settled, false);
  assert.equal(s.values.get('held'), 0.06);
  s.fail(false);
  assert.equal(await settleBudget(gate.reservation, 0.03, 86400, s.evaluate), true);
  assert.equal(gate.reservation!.month, '2026-10');
  assert.equal(s.values.get('spent'), 0.03);
});

test('unavailable, invalid and malformed budget replies fail closed', async () => {
  const s = store(); s.fail(true);
  assert.equal((await reserveBudget(input, s.evaluate)).allowed, false);
  assert.equal((await reserveBudget({ ...input, estimate: NaN }, s.evaluate)).allowed, false);
  assert.equal((await reserveBudget(input, async () => ['ok', 'NaN', '0'])).allowed, false);
});

function meter(available: boolean, env: Record<string, string> = {}) {
  const s = store(); let sent = 0; let mode: 'ok' | 'unreadable' | 'timeout' = 'ok'; let lastRequest: any;
  const file = join(__dirname, '..', 'anthropic-meter.ts'), req = createRequire(file);
  const kv = {
    isRedisAvailable: () => available,
    kvGet: async (k: string) => s.values.get(k) ?? null,
    kvSet: async (k: string, v: any) => { s.values.set(k, v); },
    kvIncrByFloat: async (k: string, n: number) => { const v = Number(s.values.get(k) || 0) + n; s.values.set(k, v); return v; },
  };
  const fakeRequire = (name: string) => name === '@/lib/kv' ? kv : name === './ai-budget' ? {
    reserveBudget: (p: any) => reserveBudget(p, s.evaluate), settleBudget: (r: any, usd: number, ttl: number) => settleBudget(r, usd, ttl, s.evaluate),
  } : req(name);
  const fakeFetch = async (url: string, init: any) => {
    assert.match(url, /^https:\/\/api\.(openai|anthropic)\.com\//); sent++; lastRequest = JSON.parse(init.body);
    if (mode === 'timeout') throw new Error('simulated provider timeout');
    if (mode === 'unreadable') return new Response('not JSON', { status: 200 });
    if (url.endsWith('/embeddings')) return Response.json({ usage: { prompt_tokens: 100 }, data: [{ index: 0, embedding: [1, 2] }] });
    if (url.endsWith('/responses')) return Response.json({ usage: { input_tokens: 100, output_tokens: 20 }, output: [] });
    if (url.includes('anthropic')) return Response.json({ usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'text', text: 'ok' }] });
    return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  };
  const output = { exports: {} as any };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', 'process', 'fetch', js)(fakeRequire, output, output.exports,
    { env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'unit-test-only', ANTHROPIC_API_KEY: 'unit-test-only', OPENAI_MODEL: 'gpt-5-mini', AI_MONTHLY_CAP_USD: '1', ...env } }, fakeFetch);
  return { api: output.exports, values: s.values, sent: () => sent, mode: (m: typeof mode) => { mode = m; }, request: () => lastRequest };
}
const body = { model: 'claude-haiku-4-5-20251001', max_tokens: 100, messages: [{ role: 'user', content: 'test' }] };

test('no durable budget store prevents messages, web research and embeddings from reaching any provider', async () => {
  const m = meter(false);
  assert.equal((await m.api.anthropicMessages('test', body)).status, 402);
  assert.equal((await m.api.webResearch('test', 'system', 'prompt')).ok, false);
  assert.equal((await m.api.openaiEmbeddings('test', ['text'])).status, 402);
  assert.equal(m.sent(), 0);
});

test('every paid entry point settles real usage and web search enforces the requested search limit', async () => {
  const m = meter(true);
  assert.equal((await m.api.anthropicMessages('test', body)).status, 200);
  assert.equal((await m.api.webResearch('test', 'system', 'prompt', { maxSearches: 2 })).ok, true);
  assert.equal(m.request().max_tool_calls, 2);
  assert.equal((await m.api.openaiEmbeddings('test', ['text'])).ok, true);
  assert.equal(m.sent(), 3);
  const held = [...m.values].filter(([k]) => /spend-reserved:/.test(k) && !k.includes(':call:'));
  assert.ok(held.length); for (const [, v] of held) assert.ok(Math.abs(Number(v)) < 1e-9);
  assert.ok([...m.values].some(([k, v]) => /spend-total:/.test(k) && Number(v) > 0));
});

test('successful but unreadable answers and timeouts retain their reservations', async () => {
  for (const mode of ['unreadable', 'timeout'] as const) {
    const m = meter(true); m.mode(mode);
    if (mode === 'timeout') await assert.rejects(() => m.api.anthropicMessages('test', body));
    else assert.equal((await m.api.anthropicMessages('test', body)).status, 502);
    assert.ok([...m.values].some(([k, v]) => /spend-reserved:/.test(k) && !k.includes(':call:') && Number(v) > 0));
  }
});
