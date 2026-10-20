// zzz1155–1156 — guidance checking and reading without an AI call where the text is plain; AI only for the rest.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ruleVerify, numbersIn, periodPattern } from '../rule-verify';
import { ruleRowsFor } from '../rule-extract';
import { extractDoc } from '../ai-guidance-extract';
import { verifyClaim } from '../ai-verify';

describe('rule-verify', () => {
  const doc = 'Q2 results. Management said: For FY27 we expect revenue growth of 25-30%, with EBITDA margin of 18%. Order book stands at ₹1,234.5 crore. The board declared a dividend.';
  test('numbers and periods are read', () => {
    assert.deepEqual(numbersIn('₹1,234.5 crore and 25-30%'), [1234.5, 25, 30]);
    assert.ok(periodPattern('FY27')!.test('fiscal 2027')); assert.ok(periodPattern('FY27')!.test('2026-27')); assert.ok(!periodPattern('FY27')!.test('FY26'));
  });
  test('confirmed when figures, measure and period are in one sentence', () => {
    const v = ruleVerify({ metric: 'REVENUE_GROWTH', numbers: { old: [], new: [25, 30] }, period: 'FY27' }, doc);
    assert.equal(v.ok, true); assert.match(v.quote!, /revenue growth of 25-30%/);
  });
  test('not confirmed: wrong period, other measure, figures apart, a lowered figure', () => {
    assert.equal(ruleVerify({ metric: 'REVENUE_GROWTH', numbers: { old: [], new: [25, 30] }, period: 'FY28' }, doc).ok, false);
    assert.equal(ruleVerify({ metric: 'PAT', numbers: { old: [], new: [25, 30] }, period: 'FY27' }, doc).ok, false);
    assert.equal(ruleVerify({ metric: 'REVENUE', numbers: { old: [], new: [18] }, period: 'FY27' }, 'Revenue in FY27 should be strong. Margins of 18% are likely.').ok, false);
    assert.equal(ruleVerify({ metric: 'REVENUE_GROWTH', numbers: { old: [], new: [10] }, period: 'FY27' }, 'We have lowered our FY27 revenue growth outlook to 10%.').ok, false);
  });
  test('a small round figure is never matched inside a table window', () => {
    const table = 'Revenue FY27 100 200 300 25 40 50 60 70 30 x'.repeat(3);
    assert.equal(ruleVerify({ metric: 'REVENUE_GROWTH', numbers: { old: [], new: [25, 30] }, period: 'FY27' }, table).ok, false);
  });
  test('old figures must be right there too', () => {
    const t = 'We raise FY2026 revenue guidance to $305 million to $310 million, from $290 million to $300 million earlier.';
    assert.equal(ruleVerify({ metric: 'REVENUE', numbers: { old: [290, 300], new: [305, 310] }, period: 'FY2026' }, t).ok, true);
    assert.equal(ruleVerify({ metric: 'REVENUE', numbers: { old: [280, 295], new: [305, 310] }, period: 'FY2026' }, t).ok, false);
  });
});

describe('verifyClaim: rules first, AI only for the rest, waiting without AI', () => {
  const claim: any = { claimId: 'c1', kind: 'guidance', market: 'IN', company: 'Acme', ticker: 'ACME', claimText: 'x', metric: 'REVENUE_GROWTH', numbers: { old: [], new: [25, 30] }, unit: '%', period: 'FY27', basis: null, primaryUrl: 'https://www.bseindia.com/x.pdf', sourceUrl: null, refId: 'r' };
  const docText = 'Management said: For FY27 we expect revenue growth of 25-30%, with EBITDA margin of 18% and more text to make it long enough for the check.';
  const deps = (avail: boolean, called: { n: number }): any => ({
    rulesFirst: true,
    fetchDoc: async () => ({ text: docText }), kv: { get: async () => null, set: async () => {}, mget: async (k: string[]) => k.map(() => null) },
    availability: async () => ({ available: avail, reason: avail ? null : 'no credit', provider: 'openai', model: 'm' }),
    callModel: async () => { called.n++; return { ok: false, kind: 'error', status: 500, message: 'x' }; },
  });
  test('confirmed by rules with no model call, even when no AI is available', async () => {
    const called = { n: 0 };
    const v = await verifyClaim(claim, deps(false, called));
    assert.equal(v.status, 'confirmed'); assert.equal(v.provider, 'rules'); assert.equal(v.costUsd, 0); assert.equal(called.n, 0);
  });
  test('not confirmable by rules + no AI → waits (no stop, no final answer)', async () => {
    const called = { n: 0 };
    const v: any = await verifyClaim({ ...claim, period: 'FY28' }, deps(false, called));
    assert.equal(v.status, 'verification_unavailable'); assert.equal(v.noAi, true); assert.equal(called.n, 0);
  });
  test('not confirmable by rules + AI available → the model is asked', async () => {
    const called = { n: 0 };
    await verifyClaim({ ...claim, period: 'FY28' }, deps(true, called));
    assert.equal(called.n, 1);
  });
});

describe('rule-extract: plain India guidance read without AI; the rest goes to the AI', () => {
  const body = 'Earnings call transcript. Management: Thank you. For FY27 we expect revenue of ₹1,500 crore to ₹1,600 crore, and an EBITDA margin of 18% to 20% in FY27. We continue to invest in capacity. '.repeat(2);
  test('rows in the AI shape', () => {
    const rows = ruleRowsFor({ market: 'IN', text: body }) || [];
    assert.ok(rows.length >= 1, JSON.stringify(rows));
    assert.ok(rows.every((r: any) => r.period === 'FY27' && r.status === 'NEW' && typeof r.quote === 'string'));
  });
  test('US documents, a change of guidance and part-of-company figures go to the AI', () => {
    assert.equal(ruleRowsFor({ market: 'US', text: body }), null);
    assert.equal(ruleRowsFor({ market: 'IN', text: `${body} We have raised our guidance for the year.` }), null);
    assert.equal(ruleRowsFor({ market: 'IN', text: 'For FY27 we expect export revenue of ₹1,500 crore to ₹1,600 crore.' }), null);
  });
  test('extractDoc: rules read it with no model call; with nothing plain and no AI it waits', async () => {
    let called = 0;
    const deps: any = { rulesFirst: true, availability: async () => ({ available: false, reason: 'no credit', provider: 'openai', model: 'm' }), callModel: async () => { called++; return { ok: false }; } };
    const doc: any = { docId: 'd1', market: 'IN', ticker: 'ACME', company: 'Acme', url: 'https://x', kind: 'PRESS_RELEASE', filedAt: '2026-10-15', text: body };
    const a = await extractDoc(doc, deps);
    if (a.status === 'ok') { assert.equal(a.model, 'rules'); assert.equal(a.costUsd, 0); }
    else assert.equal((a as any).noAi, true);
    const b: any = await extractDoc({ ...doc, text: `${body} We have raised our guidance for FY27 from earlier levels.` }, deps);
    assert.equal(b.noAi, true); assert.equal(b.stop, undefined); assert.equal(called, 0);
  });
});
