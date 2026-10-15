// zzz1050 — provider-enforced answer schemas, the guidance model router, and the AI run records.
// Run: node --import tsx --test src/lib/__tests__/zzz1050-ai-structured-routing.test.ts
// No network: models, KV and the database are injected fakes (or absent).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AI_SCHEMAS, GUIDANCE_TOOL as SCHEMA_GUIDANCE_TOOL, GUIDANCE_ROW_SCHEMA, strictProblems, isStrictSchema, toStrictSchema, sealObjects, fingerprint,
  STRUCTURED_OUTPUT_MODE, classifierEntities, type JsonSchema,
} from '../ai-schemas';
import {
  EXTRACT_PROMPT_VERSION, SYSTEM_PROMPT, GUIDANCE_TOOL, OK_INDEX_KEY, REFRESH_CURSOR_KEY, resultKey, extractDoc, runExtraction, refreshCandidates,
  type RawRow, type KvIo, type ModelCallResult, type ModelCallRequest, type ExtractDeps, type GuidanceDocStore,
} from '../ai-guidance-extract';
import {
  decideEscalation, EscalationGate, strongModel, escalateShare, escalateMaxPerRun, escalationDayLeft, estimateStrongUsd, guidanceWordHits, pickBetter,
  guidanceDailyCapUsd, MAX_ESCALATE_SHARE, type EscalationSignals,
} from '../ai-guidance-router';
import { buildRunRecord, insertSql, RETENTION_SQL, AI_RUN_OUTCOMES, AI_RUN_RETENTION_DAYS, normaliseRunsQuery, shortError, type AiRunRecord } from '../ai-runs';
import { toOpenAIRequest, applySchemaFailure, mergeLedgers, emptyLedger, applyCall, forcedToolName, answeredWithTool } from '../anthropic-meter';
import { MIGRATIONS, migrationsValid } from '../db-migrate';
import { isProtectedApi } from '../site-auth';
import { EVENT_TOOL } from '../thesis/evidence-extract';
import { VERDICT_TOOL } from '../ai-verify';
import { AI_TYPE_TOOL } from '../thesis/ai-type';
import { SUMMARY_TOOL } from '../earnings/ai-summary-shared';
import { RESULTS_TOOL } from '../india-results-pdf';
import { ANNOUNCEMENT_TOOL } from '../ai-gainers/announcement-reader';
import type { GuidanceDoc, GuidanceDocIndexRow, GuidanceExtractResult } from '../guidance-docs-types';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

/** Independent walker (not the module's own): every object closed, every property required, recursively. */
function assertStrict(s: JsonSchema, path = '$') {
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes('object')) {
    assert.equal(s.additionalProperties, false, `${path}: additionalProperties must be false`);
    const props = Object.keys(s.properties || {});
    assert.deepEqual([...(s.required || [])].sort(), [...props].sort(), `${path}: every property must be required`);
    for (const k of props) assertStrict(s.properties[k], `${path}.${k}`);
  }
  if (s.items) assertStrict(s.items, `${path}[]`);
  for (const [i, a] of (s.anyOf || []).entries()) assertStrict(a, `${path}|${i}`);
}

// ── 1. structured outputs: schemas ──────────────────────────────────────────

describe('schemas are strict-valid', () => {
  test('every schema in lib/ai-schemas: all properties required, additionalProperties false, recursively', () => {
    assert.ok(Object.keys(AI_SCHEMAS).length >= 5);
    for (const [site, s] of Object.entries(AI_SCHEMAS)) {
      assert.deepEqual(strictProblems(s), [], site);
      assertStrict(s, site);
    }
  });
  test('every forced-tool call site elsewhere is strict after sealing (so OpenAI gets strict: true)', () => {
    const tools: Record<string, { input_schema: any }> = { EVENT_TOOL, VERDICT_TOOL, AI_TYPE_TOOL, SUMMARY_TOOL, RESULTS_TOOL, ANNOUNCEMENT_TOOL };
    for (const [n, t] of Object.entries(tools)) {
      const strict = toStrictSchema(t.input_schema);
      assert.ok(strict, `${n} is not strict-valid: ${strictProblems(sealObjects(t.input_schema)).join('; ')}`);
      assertStrict(strict!, n);
    }
  });
  test('the checker catches an optional property and an open nested object', () => {
    const bad = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' }, b: { type: 'object', properties: { c: { type: 'string' } }, required: ['c'] } } };
    const p = strictProblems(bad);
    assert.ok(p.some((x) => x.includes('$.b: must be in required')));
    assert.ok(p.some((x) => x.includes('$.b: additionalProperties must be false')));
    assert.equal(isStrictSchema(bad), false);
    assert.equal(toStrictSchema(bad), null);   // optional b: never auto-promoted to required
  });
  test('the strict copy drops keywords strict mode refuses (maxLength) and keeps enum / bounds; property names are kept', () => {
    const s = toStrictSchema(SCHEMA_GUIDANCE_TOOL.input_schema)!;
    const row = s.properties.rows.items;
    assert.equal(row.properties.quote.maxLength, undefined);
    assert.deepEqual(row.properties.metric.enum, GUIDANCE_ROW_SCHEMA.properties.metric.enum);
    assert.equal(row.properties.confidence.maximum, 1);
    assert.equal(s.properties.rows.maxItems, 40);
    assert.equal(GUIDANCE_ROW_SCHEMA.properties.quote.maxLength, 300);   // the original keeps it (our validator checks it)
  });
  test('the guidance schema and the RawRow type stay in step', () => {
    const sample: Required<RawRow> = {
      metric: 'REVENUE', metric_label: '', period: 'FY27', period_kind: 'ANNUAL', basis: 'UNSTATED', currency: null, unit: null, low: null, high: null,
      growth_pct_low: null, growth_pct_high: null, status: 'NEW', prior_low: null, prior_high: null, prior_stated_in: null, prior_actual_period: null,
      prior_actual_value: null, prior_actual_quote: null, quote: '', speaker: null, confidence: 0,
    };
    assert.deepEqual(Object.keys(sample).sort(), [...GUIDANCE_ROW_SCHEMA.required].sort());
    assert.deepEqual(Object.keys(GUIDANCE_ROW_SCHEMA.properties).sort(), [...GUIDANCE_ROW_SCHEMA.required].sort());
    assert.equal(GUIDANCE_TOOL, SCHEMA_GUIDANCE_TOOL);
  });
  test('the prompt fingerprint includes the output mode, so the switch re-reads old results', () => {
    assert.equal(EXTRACT_PROMPT_VERSION, fingerprint('gx', [SYSTEM_PROMPT, GUIDANCE_TOOL, STRUCTURED_OUTPUT_MODE]));
    assert.notEqual(EXTRACT_PROMPT_VERSION, fingerprint('gx', [SYSTEM_PROMPT, GUIDANCE_TOOL]));
    assert.notEqual(fingerprint('gx', [SYSTEM_PROMPT + ' ', GUIDANCE_TOOL, STRUCTURED_OUTPUT_MODE]), EXTRACT_PROMPT_VERSION);
    assert.match(EXTRACT_PROMPT_VERSION, /^gx-[0-9a-f]+$/);
  });
  test('classifier entities: nulls left out, as the old text answer omitted them', () => {
    assert.equal(classifierEntities({ acquirer: null, target: null, stake_pct: null, value_cr: null }), undefined);
    assert.deepEqual(classifierEntities({ acquirer: ' Tata ', target: null, stake_pct: 43.5, value_cr: null, x: 1 }), { acquirer: 'Tata', stake_pct: 43.5 });
  });
});

describe('the meter asks OpenAI for strict structured output', () => {
  test('a strict-valid forced tool becomes a strict function (and no parallel calls)', () => {
    const r: any = toOpenAIRequest({ model: 'claude-haiku-4-5', max_tokens: 3000, messages: [{ role: 'user', content: 'x' }], tools: [GUIDANCE_TOOL], tool_choice: { type: 'tool', name: GUIDANCE_TOOL.name } }, 'gpt-5-mini', 'minimal');
    assert.equal(r.tools[0].function.strict, true);
    assert.equal(r.parallel_tool_calls, false);
    assert.equal(r.tools[0].function.parameters.properties.rows.items.properties.quote.maxLength, undefined);
    assert.deepEqual(r.tool_choice, { type: 'function', function: { name: 'file_guidance' } });
  });
  test('a schema that is not strict-valid goes as before (no strict flag, unchanged parameters)', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] };
    const r: any = toOpenAIRequest({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'f', input_schema: schema }], tool_choice: { type: 'tool', name: 'f' } }, 'gpt-5-mini');
    assert.equal(r.tools[0].function.strict, undefined);
    assert.equal(r.parallel_tool_calls, undefined);
    assert.equal(r.tools[0].function.parameters, schema);
  });
  test('a missing forced tool is detected and counted as a schema failure in the ledger', () => {
    assert.equal(forcedToolName({ tool_choice: { type: 'tool', name: 'file_guidance' } }), 'file_guidance');
    assert.equal(forcedToolName({ tool_choice: { type: 'any' } }), null);
    assert.equal(answeredWithTool({ content: [{ type: 'text', text: '{}' }] }, 'file_guidance'), false);
    assert.equal(answeredWithTool({ content: [{ type: 'tool_use', name: 'file_guidance', input: { rows: [] } }] }, 'file_guidance'), true);
    let l = applySchemaFailure(emptyLedger('2026-10'), 'guidance-extract', '2026-10-15T01:00:00Z');
    l = applySchemaFailure(l, 'guidance-extract', '2026-10-15T02:00:00Z');
    const other = applySchemaFailure(applyCall(emptyLedger('2026-10'), 'ai-desk', 0.01, { input_tokens: 10, output_tokens: 1 }, '2026-10-15T00:00:00Z'), 'ai-desk', '2026-10-15T03:00:00Z');
    const m = mergeLedgers('2026-10', [l, other, null]);
    assert.equal(m.schema_failures, 3);
    assert.equal(m.by_feature['guidance-extract'].schema_failures, 2);
    assert.equal(m.by_feature['ai-desk'].schema_failures, 1);
    assert.equal(m.calls, 1);   // a schema failure is not a second call
  });
  test('call sites that used to parse free text now force a tool with a shared schema', () => {
    for (const [f, tool] of [['lib/ai-analyst.ts', 'ANALYST_TOOL'], ['lib/anthropic-classifier.ts', 'CLASSIFIER_TOOL'], ['app/api/v1/haiku/forward-guidance/route.ts', 'FORWARD_GUIDANCE_TOOL']] as const) {
      const s = read(f);
      assert.ok(s.includes(`tool_choice: { type: 'tool', name: ${tool}.name }`), f);
    }
    assert.ok(read('lib/us-guide-check.ts').includes('schema: US_GUIDE_CHECK_SCHEMA'));
  });
});

// ── 2. router ───────────────────────────────────────────────────────────────

const sig = (o: Partial<EscalationSignals>): EscalationSignals => ({ schemaFail: false, rawRows: 3, kept: 3, dropReasons: {}, meanConfidence: 0.9, textChars: 20_000, excerptChars: 20_000, guidanceHits: 5, ...o });

describe('router: escalates only on the listed conditions', () => {
  test('each condition, and its reason', () => {
    assert.deepEqual(decideEscalation(sig({ schemaFail: true, rawRows: 0, kept: 0 })), { escalate: true, reason: 'schema_fail' });
    assert.deepEqual(decideEscalation(sig({ rawRows: 4, kept: 1, dropReasons: { quote_not_in_document: 2, number_not_in_quote: 1 } })), { escalate: true, reason: 'quote_rejects' });
    assert.deepEqual(decideEscalation(sig({ rawRows: 0, kept: 0, guidanceHits: 3 })), { escalate: true, reason: 'no_rows_but_guidance' });
    assert.deepEqual(decideEscalation(sig({ rawRows: 1, kept: 1, textChars: 90_000, excerptChars: 30_000, guidanceHits: 2 })), { escalate: true, reason: 'long_document' });
    assert.deepEqual(decideEscalation(sig({ kept: 2, meanConfidence: 0.4 })), { escalate: true, reason: 'low_confidence' });
  });
  test('and not otherwise', () => {
    assert.equal(decideEscalation(sig({})).escalate, false);                                                        // clean read
    assert.equal(decideEscalation(sig({ rawRows: 0, kept: 0, guidanceHits: 2 })).escalate, false);                  // no rows, little guidance talk
    assert.equal(decideEscalation(sig({ rawRows: 2, kept: 0, guidanceHits: 0, dropReasons: { quote_not_in_document: 2 } })).escalate, false);   // too few rows to judge
    assert.equal(decideEscalation(sig({ rawRows: 4, kept: 3, dropReasons: { quote_not_in_document: 1 } })).escalate, false);                    // 25% rejected
    assert.equal(decideEscalation(sig({ rawRows: 4, kept: 2, dropReasons: { duplicate: 2 } })).escalate, false);                                // other drop reasons do not count
    assert.equal(decideEscalation(sig({ kept: 2, meanConfidence: 0.5 })).escalate, false);                           // exactly 0.5 is not low
    assert.equal(decideEscalation(sig({ kept: 2, textChars: 90_000, excerptChars: 30_000 })).escalate, false);       // long but rows found
    assert.equal(decideEscalation(sig({ rawRows: 0, kept: 0, textChars: 2_000, excerptChars: 2_000, guidanceHits: 1 })).escalate, false);
  });
  test('guidance words are counted plainly', () => {
    assert.ok(guidanceWordHits('We reiterate our guidance. Our outlook for FY27: we expect revenue to grow; target margin 15%.') >= 4);
    assert.equal(guidanceWordHits('Revenue for the quarter was 120 crore.'), 0);
  });
  test('the better answer is kept', () => {
    assert.equal(pickBetter({ schemaFail: true, kept: 0 }, { schemaFail: false, kept: 0 }), 'strong');
    assert.equal(pickBetter({ schemaFail: false, kept: 2 }, { schemaFail: false, kept: 1 }), 'cheap');
    assert.equal(pickBetter({ schemaFail: false, kept: 1 }, { schemaFail: false, kept: 3 }), 'strong');
    assert.equal(pickBetter({ schemaFail: false, kept: 1 }, { schemaFail: true, kept: 0 }), 'cheap');
    assert.equal(pickBetter({ schemaFail: false, kept: 1 }, null), 'cheap');
  });
});

describe('router: configuration and cost guardrails', () => {
  test('the stronger model: default per provider, switchable off, must be priced and of the active provider', () => {
    assert.equal(strongModel('openai', 'gpt-5-mini', {}), 'gpt-5');
    assert.equal(strongModel('anthropic', 'claude-haiku-4-5-20251001', {}), 'claude-sonnet-4-5');
    for (const off of ['off', 'none', '0', 'false', 'OFF']) assert.equal(strongModel('openai', 'gpt-5-mini', { GUIDANCE_EXTRACT_STRONG_MODEL: off }), null);
    assert.equal(strongModel('openai', 'gpt-5-mini', { GUIDANCE_EXTRACT_STRONG_MODEL: 'gpt-9-ultra' }), null);          // unpriced
    assert.equal(strongModel('openai', 'gpt-5-mini', { GUIDANCE_EXTRACT_STRONG_MODEL: 'claude-sonnet-4-5' }), null);    // other provider
    assert.equal(strongModel('openai', 'gpt-5', {}), null);                                                              // same as the cheap model
    assert.equal(strongModel('openai', 'gpt-5-mini', { GUIDANCE_EXTRACT_STRONG_MODEL: 'gpt-4.1' }), 'gpt-4.1');
  });
  test('the escalation share can be lowered, never raised past 30%', () => {
    assert.equal(MAX_ESCALATE_SHARE, 0.3);
    assert.equal(escalateShare({}), 0.3);
    assert.equal(escalateShare({ GUIDANCE_EXTRACT_ESCALATE_SHARE: '0.9' }), 0.3);
    assert.equal(escalateShare({ GUIDANCE_EXTRACT_ESCALATE_SHARE: '0.1' }), 0.1);
    assert.equal(escalateShare({ GUIDANCE_EXTRACT_ESCALATE_SHARE: '-1' }), 0);
    assert.equal(escalateMaxPerRun({}), 3);
    assert.equal(escalateMaxPerRun({ GUIDANCE_EXTRACT_ESCALATE_MAX_PER_RUN: '50' }), 10);
    assert.equal(guidanceDailyCapUsd({}), 0.25);
    assert.equal(guidanceDailyCapUsd({ GUIDANCE_EXTRACT_DAILY_USD: '999' }), 20);
  });
  test('the day sub-cap: share × daily ceiling − already escalated, never below 0', () => {
    assert.equal(escalationDayLeft(0.25, 0, 0.3), 0.075);
    assert.equal(escalationDayLeft(0.25, 0.05, 0.3), 0.025);
    assert.equal(escalationDayLeft(0.25, 0.2, 0.3), 0);
    assert.equal(escalationDayLeft(0.25, 0, 0.9), 0.075);   // share clamped here too
  });
  test('the reservation: priced model only, never past the sub-cap, the run cap or the run limit', () => {
    const est = estimateStrongUsd('gpt-5', 35_000);
    assert.ok(est > 0.02 && est < 0.06, `estimate ${est}`);
    assert.equal(estimateStrongUsd('no-such-model', 1000), Infinity);
    let spent = 0;
    const g = new EscalationGate('gpt-5', 0.075, 3, () => spent, 0.25);
    assert.equal(g.tryReserve(0.04), true);
    assert.equal(g.tryReserve(0.04), false);              // 0.08 > 0.075 sub-cap (reserved, not yet spent)
    assert.equal(g.refused.sub_cap, 1);
    g.settle(0.04, 0.03); spent += 0.03;
    assert.equal(g.tryReserve(0.04), true);               // 0.03 + 0.04 = 0.07 ≤ 0.075
    g.settle(0.04, 0.045); spent += 0.045;
    assert.equal(g.tryReserve(0.001), false);             // 0.075 spent: nothing left
    assert.ok(g.spentUsd <= 0.075 + 1e-9);
    const g2 = new EscalationGate('gpt-5', 10, 1, () => 0, 10);
    assert.equal(g2.tryReserve(0.01), true); assert.equal(g2.tryReserve(0.01), false); assert.equal(g2.refused.run_limit, 1);
    const g3 = new EscalationGate('gpt-5', 1, 5, () => 0.2, 0.25);
    assert.equal(g3.tryReserve(0.04, 0.02), false); assert.equal(g3.refused.run_cap, 1);   // 0.2 spent + 0.02 this doc + 0.04 > 0.25
    const g4 = new EscalationGate(null, 1, 5, () => 0, 1);
    assert.equal(g4.tryReserve(0.01), false); assert.equal(g4.refused.off, 1);
    assert.equal(new EscalationGate('gpt-5', 1, 5, () => 0, 1).tryReserve(Infinity), false);
  });
});

// ── router inside the extractor ─────────────────────────────────────────────

const TRANSCRIPT = `Acme Gears Limited
Q2 FY27 Earnings Conference Call

Moderator: Good day and welcome.

Ravi Kumar: Thank you. Our outlook is strong. For FY27 we expect revenue of ₹1,200 crore to ₹1,300 crore, and we reiterate our guidance of an EBITDA margin of 14% to 16%. We expect the target to be met.

Moderator: Thank you. That concludes the call.`;
const gdoc = (id = 'acme-gears-q2', over: Partial<GuidanceDoc> = {}): GuidanceDoc => ({
  docId: id, market: 'IN', ticker: 'ACMEGEAR', bseCode: null, company: 'Acme Gears Ltd', kind: 'TRANSCRIPT', title: 'Q2 FY27 call', url: 'https://example.com/x.pdf',
  sourceHost: 'example.com', filedAt: '2026-10-10T00:00:00Z', periodHint: 'Q2 FY27', text: TRANSCRIPT, textChars: TRANSCRIPT.length, collectedAt: '2026-10-11T00:00:00Z', collector: 'test', ...over,
});
const goodRow = { metric: 'REVENUE', metric_label: 'revenue', period: 'FY27', period_kind: 'ANNUAL', basis: 'UNSTATED', currency: 'INR', unit: 'crore', low: 1200, high: 1300,
  growth_pct_low: null, growth_pct_high: null, status: 'NEW', prior_low: null, prior_high: null, prior_stated_in: null, prior_actual_period: null, prior_actual_value: null,
  prior_actual_quote: null, quote: 'For FY27 we expect revenue of ₹1,200 crore to ₹1,300 crore', speaker: 'Ravi Kumar', confidence: 0.9 };

function fakeKv(): KvIo & { store: Map<string, any> } {
  const store = new Map<string, any>();
  const clone = (v: any) => (v == null ? null : JSON.parse(JSON.stringify(v)));
  return {
    store,
    get: async (k) => clone(store.get(k)),
    set: async (k, v) => { store.set(k, clone(v)); },
    mget: async (keys) => keys.map((k) => clone(store.get(k))),
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    del: async (k) => { store.delete(k); },
  };
}

/** cheap answers by `cheap`, the stronger model by `strong`; every call is logged */
function modelDeps(cheap: (n: number) => ModelCallResult, strong: (n: number) => ModelCallResult = () => ({ ok: true, raw: { unreadable: false, rows: [goodRow] }, costUsd: 0.03, model: 'gpt-5', usage: { input: 9000, output: 2500 } })) {
  const calls: ModelCallRequest[] = [];
  return {
    calls,
    callModel: async (req: ModelCallRequest) => { calls.push(req); return req.model ? strong(calls.length) : cheap(calls.length); },
    availability: async () => ({ available: true, reason: null, provider: 'openai', model: 'gpt-5-mini' }),
    now: () => new Date('2026-10-15T10:00:00Z'),
    nonce: () => 'n0nce123',
  };
}
const cheapOk = (): ModelCallResult => ({ ok: true, raw: { unreadable: false, rows: [goodRow] }, costUsd: 0.003, model: 'gpt-5-mini', usage: { input: 9000, output: 800 } });
const cheapBadShape = (): ModelCallResult => ({ ok: true, raw: { rows: 'not an array' }, costUsd: 0.003, model: 'gpt-5-mini' });

describe('extractor: routing', () => {
  test('a clean cheap read is never escalated, even with a gate', async () => {
    const d = modelDeps(cheapOk);
    const gate = new EscalationGate('gpt-5', 1, 3, () => 0, 1);
    const r = await extractDoc(gdoc(), d, { gate });
    assert.equal(r.status, 'ok'); assert.equal(d.calls.length, 1); assert.equal(r.escalation, undefined);
    assert.equal(r.runs?.length, 1); assert.equal(r.runs![0].outcome, 'ok'); assert.equal(r.runs![0].rowsKept, 1);
    assert.equal(r.runs![0].promptVersion, EXTRACT_PROMPT_VERSION); assert.equal(r.runs![0].inputTokens, 9000);
  });
  test('a wrong-shape answer goes to the stronger model; its checked rows are kept; both calls recorded and paid', async () => {
    const d = modelDeps(cheapBadShape);
    const gate = new EscalationGate('gpt-5', 0.075, 3, () => 0, 0.6);
    const r = await extractDoc(gdoc(), d, { gate, batchId: 'b1' });
    assert.equal(d.calls.length, 2); assert.equal(d.calls[1].model, 'gpt-5'); assert.equal(d.calls[0].model, undefined);
    assert.equal(r.status, 'ok'); assert.equal(r.rows.length, 1); assert.equal(r.model, 'gpt-5');
    assert.deepEqual(r.escalation, { reason: 'schema_fail', model: 'gpt-5', used: 'strong' });
    assert.deepEqual(r.models, ['gpt-5-mini', 'gpt-5']);
    assert.equal(Number(r.costUsd.toFixed(6)), 0.033); assert.equal(r.escalatedUsd, 0.03);
    assert.equal(r.runs![0].outcome, 'escalated'); assert.equal(r.runs![0].escalationReason, 'schema_fail');
    assert.equal(r.runs![1].outcome, 'ok'); assert.equal(r.runs![1].model, 'gpt-5'); assert.equal(r.runs![1].batchId, 'b1');
    assert.equal(gate.spentUsd, 0.03); assert.equal(gate.count, 1);
  });
  test('the stronger model\'s rows face the same quote check (a made-up quote is still dropped)', async () => {
    const made = { ...goodRow, quote: 'For FY27 we expect revenue of ₹9,999 crore', low: 9999, high: 9999 };
    const d = modelDeps(cheapBadShape, () => ({ ok: true, raw: { unreadable: false, rows: [made] }, costUsd: 0.03, model: 'gpt-5' }));
    const r = await extractDoc(gdoc(), d, { gate: new EscalationGate('gpt-5', 1, 3, () => 0, 1) });
    assert.equal(r.rows.length, 0); assert.equal(r.status, 'no_guidance');
    assert.equal(r.runs![1].outcome, 'quote_rejected');
  });
  test('without a gate, or with the sub-cap used, the cheap answer stands (as before) and only one call is made', async () => {
    const d1 = modelDeps(cheapBadShape);
    const r1 = await extractDoc(gdoc(), d1);
    assert.equal(d1.calls.length, 1); assert.equal(r1.status, 'error'); assert.match(String(r1.note), /invalid model answer: rows must be an array/);
    assert.equal(r1.escalation, undefined); assert.equal(r1.runs![0].outcome, 'schema_fail');
    const d2 = modelDeps(cheapBadShape);
    const r2 = await extractDoc(gdoc(), d2, { gate: new EscalationGate('gpt-5', 0, 3, () => 0, 1) });
    assert.equal(d2.calls.length, 1); assert.equal(r2.status, 'error');
    assert.deepEqual(r2.escalation, { reason: 'schema_fail', model: null, used: 'cheap', refused: 'sub_cap' });
    assert.equal(r2.runs![0].outcome, 'schema_fail'); assert.match(String(r2.runs![0].escalationReason), /not sent: sub_cap/);
  });
  test('a transport error, a provider refusal or the cap is never escalated', async () => {
    for (const res of [
      { ok: false, kind: 'error', status: 0, message: 'model call timed out' },
      { ok: false, kind: 'spend_cap', status: 402, message: 'Monthly AI cap reached' },
      { ok: false, kind: 'no_key', status: 401, message: 'no key' },
    ] as ModelCallResult[]) {
      const d = modelDeps(() => res);
      const r = await extractDoc(gdoc(), d, { gate: new EscalationGate('gpt-5', 1, 3, () => 0, 1) });
      assert.equal(d.calls.length, 1, JSON.stringify(res)); assert.equal(r.escalation, undefined);
      assert.equal(r.runs![0].outcome, res.ok ? 'ok' : res.kind === 'spend_cap' ? 'cap_reached' : 'failed');
    }
  });
  test('a cut-off answer (billed, no shape) is a schema failure and may be escalated', async () => {
    const d = modelDeps(() => ({ ok: false, kind: 'error', status: 502, message: 'answer cut off at the token limit', schema: true, costUsd: 0.004, model: 'gpt-5-mini' }));
    const r = await extractDoc(gdoc(), d, { gate: new EscalationGate('gpt-5', 1, 3, () => 0, 1) });
    assert.equal(d.calls.length, 2); assert.equal(r.escalation?.reason, 'schema_fail'); assert.equal(r.status, 'ok');
    assert.equal(Number(r.costUsd.toFixed(6)), 0.034);
  });
  test('a failed stronger call leaves the cheap answer in place', async () => {
    const d = modelDeps(() => ({ ok: true, raw: { unreadable: false, rows: [] }, costUsd: 0.003, model: 'gpt-5-mini' }), () => ({ ok: false, kind: 'error', status: 500, message: 'boom', model: 'gpt-5' }));
    const r = await extractDoc(gdoc(), d, { gate: new EscalationGate('gpt-5', 1, 3, () => 0, 1) });
    assert.equal(d.calls.length, 2); assert.equal(r.status, 'no_guidance'); assert.equal(r.escalation?.used, 'cheap'); assert.equal(r.escalation?.reason, 'no_rows_but_guidance');
    assert.equal(r.runs![1].outcome, 'failed');
  });
});

function store(docs: GuidanceDoc[]): GuidanceDocStore & { marked: string[] } {
  const marked: string[] = [];
  return {
    marked,
    listDocs: async (o) => docs.filter((x) => !o.market || x.market === o.market).filter((x) => !o.unextractedOnly || !marked.includes(x.docId))
      .map((x): GuidanceDocIndexRow => ({ docId: x.docId, market: x.market, ticker: x.ticker, company: x.company, kind: x.kind, filedAt: x.filedAt, url: x.url, textChars: x.textChars })),
    getDoc: async (id) => docs.find((x) => x.docId === id) || null,
    markExtracted: async (id) => { marked.push(id); },
  };
}

describe('the run: escalations stay inside the sub-cap; records are written once', () => {
  test('ten hard documents, sub-cap $0.075, ~$0.04 per strong call → at most what the sub-cap allows', async () => {
    const docs = Array.from({ length: 10 }, (_, i) => gdoc(`hard-${i}`, { ticker: `HARD${i}` }));
    const written: AiRunRecord[][] = [];
    const m = modelDeps(cheapBadShape, () => ({ ok: true, raw: { unreadable: false, rows: [goodRow] }, costUsd: 0.035, model: 'gpt-5' }));
    const deps: ExtractDeps = { ...m, store: store(docs), kv: fakeKv(), recordRuns: async (recs) => { written.push(recs); } };
    const st = await runExtraction(deps, { limit: 10, maxUsd: 1, budgetMs: 50_000, concurrency: 4, strongModel: 'gpt-5', escalationBudgetUsd: 0.075, refreshMax: 0 });
    assert.ok(st.escalations); assert.ok(st.escalations!.usd <= 0.075 + 1e-9, `escalated $${st.escalations!.usd}`);
    assert.ok(st.escalations!.count >= 1 && st.escalations!.count <= 2);
    assert.equal(st.escalations!.reasons.schema_fail, 10);
    assert.ok((st.escalations!.refused.sub_cap || 0) + (st.escalations!.refused.run_limit || 0) >= 8);
    assert.equal(st.schemaFailures, 10);
    assert.equal(written.length, 1);
    assert.equal(written[0].length, 10 + st.escalations!.count);   // one record per call
    assert.ok(written[0].every((r) => r.batchId === st.batchId && r.job === 'guidance-extract'));
    assert.equal(Math.round(st.spentUsd * 1e4), Math.round((10 * 0.003 + st.escalations!.usd) * 1e4));
  });
  test('no strong model → no escalation (budget ignored)', async () => {
    const m = modelDeps(cheapBadShape);
    const deps: ExtractDeps = { ...m, store: store([gdoc()]), kv: fakeKv() };
    const st = await runExtraction(deps, { limit: 5, maxUsd: 1, strongModel: null, escalationBudgetUsd: 5, refreshMax: 0 });
    assert.equal(m.calls.length, 1); assert.equal(st.escalations, undefined);
  });
  test('a failing record writer never fails the run', async () => {
    const m = modelDeps(cheapOk);
    const deps: ExtractDeps = { ...m, store: store([gdoc()]), kv: fakeKv(), recordRuns: async () => { throw new Error('db down'); } };
    const st = await runExtraction(deps, { limit: 5, maxUsd: 1, refreshMax: 0 });
    assert.equal(st.ok, 1);
  });
});

describe('results of an older prompt version are re-read after new documents', () => {
  const oldResult = (id: string, filedAt = '2026-10-01T00:00:00Z'): GuidanceExtractResult => ({
    docId: id, market: 'IN', ticker: 'OLD', company: 'Old Co', docUrl: 'https://example.com/x.pdf', docKind: 'TRANSCRIPT', filedAt, extractedAt: '2026-10-02T00:00:00Z',
    model: 'gpt-5-mini', promptVersion: 'gx-old', status: 'ok', rows: [{ ...(goodRow as any), metricLabel: 'revenue' }], dropped: 0,
  });
  test('candidates: older version, ok, inside the window; the cursor stops at the first candidate', async () => {
    const kv = fakeKv();
    await kv.set(OK_INDEX_KEY, ['a', 'b', 'c', 'd']);
    await kv.set(resultKey('a'), { ...oldResult('a'), promptVersion: EXTRACT_PROMPT_VERSION });
    await kv.set(resultKey('b'), oldResult('b'));
    await kv.set(resultKey('c'), oldResult('c', '2025-01-01T00:00:00Z'));    // outside the window
    await kv.set(resultKey('d'), { ...oldResult('d'), refreshedUnder: EXTRACT_PROMPT_VERSION });
    const got = await refreshCandidates(kv, 5, 210, new Date('2026-10-15T00:00:00Z'));
    assert.deepEqual(got.map((r) => r.docId), ['b']);
    assert.deepEqual(await kv.get(REFRESH_CURSOR_KEY), { v: EXTRACT_PROMPT_VERSION, pos: 1, done: false });
    await kv.set(resultKey('b'), { ...oldResult('b'), promptVersion: EXTRACT_PROMPT_VERSION });
    assert.deepEqual(await refreshCandidates(kv, 5, 210, new Date('2026-10-15T00:00:00Z')), []);
    assert.equal((await kv.get(REFRESH_CURSOR_KEY)).done, true);
    assert.deepEqual(await refreshCandidates(kv, 5, 210, new Date('2026-10-15T00:00:00Z')), []);   // done: no scan
  });
  test('a re-read with rows replaces the old result; one that finds none keeps it, marked', async () => {
    const kv = fakeKv();
    const d1 = gdoc('old-1'); const d2 = gdoc('old-2', { text: TRANSCRIPT.replace('₹1,200 crore to ₹1,300 crore', 'a good year') });
    await kv.set(OK_INDEX_KEY, ['old-1', 'old-2']);
    await kv.set(resultKey('old-1'), oldResult('old-1', d1.filedAt));
    await kv.set(resultKey('old-2'), oldResult('old-2', d2.filedAt));
    const st0 = store([d1, d2]); st0.marked.push('old-1', 'old-2');   // already extracted: only the refresh tier can reach them
    let n = 0;
    const m = modelDeps(() => (++n, { ok: true, raw: { unreadable: false, rows: [goodRow] }, costUsd: 0.003, model: 'gpt-5-mini' }));
    const st = await runExtraction({ ...m, store: st0, kv }, { limit: 5, maxUsd: 1, refreshMax: 5 });
    assert.equal(st.refreshed, 2);
    const r1 = await kv.get(resultKey('old-1')); const r2 = await kv.get(resultKey('old-2'));
    assert.equal(r1.promptVersion, EXTRACT_PROMPT_VERSION); assert.equal(r1.status, 'ok');
    assert.equal(r2.promptVersion, 'gx-old'); assert.equal(r2.refreshedUnder, EXTRACT_PROMPT_VERSION); assert.equal(r2.rows.length, 1);   // old rows kept
  });
});

// ── 3. run records ──────────────────────────────────────────────────────────

describe('run records', () => {
  test('shape: every field, clipped and cleaned', () => {
    const r = buildRunRecord({ job: 'guidance-extract', startedAt: '2026-10-15T10:00:00.000Z', finishedAt: '2026-10-15T10:00:02.500Z', model: 'gpt-5-mini', inputTokens: 9000.4, outputTokens: -3,
      costUsd: 0.0031234567, outcome: 'escalated', error: 'HTTP 401: bad key sk-proj-abcdefghijklmnop Bearer xyz', docId: 'd1', ticker: 'ACME', rowsKept: 2, rowsRejected: 1, escalationReason: 'schema_fail' });
    assert.deepEqual(Object.keys(r).sort(), ['batchId', 'costUsd', 'docId', 'durationMs', 'error', 'escalationReason', 'finishedAt', 'inputTokens', 'job', 'model', 'outcome', 'outputTokens', 'promptVersion', 'rowsKept', 'rowsRejected', 'runId', 'startedAt', 'ticker'].sort());
    assert.equal(r.durationMs, 2500); assert.equal(r.inputTokens, 9000); assert.equal(r.outputTokens, 0); assert.equal(r.costUsd, 0.003123);
    assert.ok(!/sk-proj-abc|xyz/.test(String(r.error))); assert.match(String(r.error), /\[redacted\]/);
    assert.match(r.runId, /^guidance-extract-/);
    assert.equal(buildRunRecord({ job: 'x', startedAt: '2026-10-15T10:00:00Z', outcome: 'weird' as any }).outcome, 'failed');
    assert.equal(shortError('x'.repeat(1000))!.length, 300);
    assert.deepEqual([...AI_RUN_OUTCOMES].sort(), ['cap_reached', 'escalated', 'failed', 'ok', 'quote_rejected', 'schema_fail']);
  });
  test('insert is parameterised (18 values per record); retention deletes > 90 days, bounded', () => {
    const recs = [1, 2].map((i) => buildRunRecord({ job: 'ai-desk', startedAt: `2026-10-15T10:00:0${i}Z`, outcome: 'ok' }));
    const q = insertSql(recs);
    assert.equal(q.values.length, 36);
    assert.ok(q.text.includes('$36') && !q.text.includes('$37') && q.text.includes('ON CONFLICT (run_id) DO NOTHING'));
    assert.equal(AI_RUN_RETENTION_DAYS, 90);
    assert.match(RETENTION_SQL, /interval '90 days' LIMIT \d+/);
  });
  test('the page query is clamped to safe values', () => {
    assert.deepEqual(normaliseRunsQuery({ days: 999, limit: 99_999, outcome: "ok'; drop table", job: 'x y' }), { days: 90, limit: 500, outcome: null, job: null });
    assert.deepEqual(normaliseRunsQuery({ outcome: 'schema_fail', job: 'guidance-extract' }), { days: 14, limit: 200, outcome: 'schema_fail', job: 'guidance-extract' });
  });
  test('migration 4 creates ai_run; the API is protected; the page is in the sidebar and exports only the page', () => {
    assert.ok(migrationsValid());
    const m = MIGRATIONS.find((x) => x.name === 'ai_run');
    assert.ok(m && m.id === 4 && /CREATE TABLE IF NOT EXISTS ai_run/.test(m.sql) && /escalation_reason/.test(m.sql));
    assert.equal(isProtectedApi('/api/v1/ai-runs'), true);
    const nav = read('app/(dashboard)/DashboardClient.tsx');
    assert.equal((nav.match(/href: '\/ai-runs'/g) || []).length, 2);
    assert.ok(nav.indexOf("href: '/ai-runs'") > nav.indexOf("href: '/status'"));
    const page = read('app/(dashboard)/ai-runs/page.tsx');
    assert.equal((page.match(/^export /gm) || []).length, 1);
    assert.match(page, /^export default function/m);
    const route = read('app/api/v1/ai-runs/route.ts');
    assert.match(route, /siteAuthOk\(req\)/);
  });
  test('the meter writes a record for every call unless the caller writes its own; the extractor writes its own', () => {
    const meter = read('lib/anthropic-meter.ts');
    assert.ok((meter.match(/track\(feature, /g) || []).length >= 10);
    assert.ok(read('lib/ai-guidance-extract.ts').includes('run: false'));
  });
});
