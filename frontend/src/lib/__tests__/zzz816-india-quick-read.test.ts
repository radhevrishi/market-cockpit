// zzz816 — India Portfolio Catalysts: quick read (no AI), financial-sector
// type fit, Special Focus source labels. Synthetic fixtures + the real IOLCP
// transcript sentences (fixtures/zzz809-iolcp.ts). No network, no model.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  quickExtract, quickSummary, quickReadQueue, needsQuickRead, quickTier, isQuickReadPeriod, latestIsQuickRead,
  quickProgressLine, QUICK_READ_LABEL, QUICK_READ_VERSION, QUICK_READ_MODE,
} from '../thesis/quick-read';
import { runQuickRead, quickSelection, resetQuickMemoForTests } from '../thesis/quick-read-server';
import { setEvidenceKvForTests, loadLedger, persistEvidenceRun } from '../thesis/evidence-store';
import { resolveDiscovery, type DocCandidate, type DiscoveryAttempt } from '../thesis/evidence-discovery';
import { freshnessOf, emptyLedger, type CompanyLedger } from '../thesis/evidence-ledger';
import { financialKindOf, financialProvisionalType } from '../thesis/provisional-type';
import { assessBookRow, applyLedger, type BookRow } from '../thesis/use-book';
import { evidenceCounts } from '../thesis/evidence-counts';
import { evidenceStateLine } from '../thesis/taxonomy';
import { focusRowIndex, focusSourceLabel, specialFocusQueue } from '../catalyst/cross-view';
import { IOLCP_EVENTS } from './fixtures/zzz809-iolcp';

// ── fixtures ───────────────────────────────────────────────────────────────

const IOLCP_TRANSCRIPT = (IOLCP_EVENTS as any[]).map((e) => e.evidence_text).join(' ');
const PRESENTATION = [
  'Q1 FY27 Investor Presentation',
  'Capacity utilisation at 78% across the formulations plant in Q1 FY27',
  'Order book stands at ₹1,240 crore as on 30 June 2026, providing strong revenue visibility.',
  'Order inflow of ₹310 crore during the quarter from defence and railway customers.',
].join('\n');
const LENDER_DECK = 'Our AUM grew 28% YoY to ₹1,52,000 crore during the quarter. Disbursements stood at ₹22,400 crore in the quarter. The net interest margin was 6.4% for the quarter. Gross Stage 3 improved to 2.1% while credit cost was 1.2%. Our loan book is well diversified across 1,200 branches and borrowers.';

const cand = (url: string, kind: DocCandidate['kind'], label: string, dateIso = '2026-08-12'): DocCandidate =>
  ({ url, kind, tier: 1, source: 'screener.in company page', period: dateIso, dateIso, label });
const found = (n: number): DiscoveryAttempt => ({ source: 'screener.in company page', outcome: 'found', detail: `${n} document(s)`, found: n });

function memKv() {
  const m = new Map<string, any>();
  return {
    map: m,
    get: async <T = any>(k: string) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) as T : null),
    set: async (k: string, v: any) => { m.set(k, JSON.parse(JSON.stringify(v))); },
  };
}

let kv = memKv();
beforeEach(() => { kv = memKv(); setEvidenceKvForTests(kv); resetQuickMemoForTests(); });
afterEach(() => setEvidenceKvForTests(null));

const texts: Record<string, string> = {
  'https://x.test/transcript.pdf': IOLCP_TRANSCRIPT,
  'https://x.test/ppt.pdf': PRESENTATION,
  'https://x.test/lender.pdf': LENDER_DECK,
};
const okExtract = async (url: string) => {
  const t = texts[url];
  if (!t) return { source: 'FAILED', failure_reason: 'HTTP 403' };
  // Long enough to be a filing, not a scan.
  const text = `${t}\n${'Management discussion and analysis of the quarter. '.repeat(40)}`;
  return { text, pages: 3, source: 'FRESH' };
};

// ── 1. the extractors on real sentences ────────────────────────────────────

describe('zzz816 · deterministic extraction (no AI)', () => {
  test('IOLCP transcript: current vs target utilisation, derived capacity, planned capex', () => {
    const x = quickExtract([{ label: 'Concall transcript Sep 2026', kind: 'transcript', text: IOLCP_TRANSCRIPT }]);
    const by = (v: string, t?: string) => x.events.filter((e) => e.variable === v && (!t || e.value_type === t));
    assert.ok(by('utilisation', 'ACTUAL').some((e) => e.after === '90% to 95%'), 'current utilisation read as ACTUAL');
    assert.ok(by('utilisation', 'TARGET').some((e) => e.after === '25%'), 'FY28 utilisation read as a target');
    const derived = by('capacity', 'ACTUAL').find((e) => (e as any).derived);
    assert.equal(derived?.after, '12,000 MTPA');
    assert.equal((derived as any).product, 'Ibuprofen');
    assert.ok(by('capacity', 'TARGET').some((e) => e.after === '18,000 MTPA'), 'post-expansion total is not installed capacity');
    assert.ok(by('capex', 'GUIDANCE').some((e) => e.after === 'INR495 crores'), '"is being deployed" is a plan, not money spent');
    // Every figure in a non-derived value is in its own evidence sentence.
    for (const e of x.events) {
      if ((e as any).derived || e.qualitative || e.guidance_line) continue;
      for (const n of String(e.after).match(/\d[\d,]*(?:\.\d+)?/g) || []) {
        assert.ok(e.evidence_text.replace(/,/g, '').includes(n.replace(/,/g, '')), `${n} not in "${e.evidence_text}"`);
      }
    }
  });

  test('presentation lines: utilisation, order book, order inflow', () => {
    const x = quickExtract([{ label: 'Investor presentation Aug 2026', kind: 'investor_presentation', text: PRESENTATION }]);
    assert.ok(x.events.some((e) => e.variable === 'utilisation' && e.value_type === 'ACTUAL' && e.after === '78%'));
    assert.ok(x.events.some((e) => e.variable === 'order_book' && e.value_type === 'ACTUAL' && /1,240 crore/.test(String(e.after))));
    assert.ok(x.events.some((e) => e.variable === 'order_intake' && /310 crore/.test(String(e.after))));
  });

  test('a lender: book growth as volume, NIM as margin driver, asset quality as a verbatim line', () => {
    const x = quickExtract([{ label: 'Investor presentation Aug 2026', kind: 'investor_presentation', text: LENDER_DECK }]);
    assert.ok(x.events.some((e) => e.variable === 'volume' && e.after === 'AUM grew 28%'));
    assert.ok(x.events.some((e) => e.variable === 'margin_driver' && /6\.4%/.test(String(e.after))));
    assert.ok(!x.events.some((e) => e.variable === 'utilisation' || e.variable === 'capacity'), 'no plant variable for a lender');
    assert.ok(x.financialLines.some((l) => /Stage 3 improved to 2\.1%/.test(l)));
    assert.ok(x.vocabulary.lender.length >= 3);
  });

  test('a sentence it cannot type is left out, never guessed', () => {
    const x = quickExtract([{ label: 'Concall transcript', kind: 'transcript', text: 'Analyst: What is the utilisation? Management: We think the utilisation is something like 60% or so, give or take.' }]);
    assert.ok(!x.events.some((e) => e.variable === 'utilisation' && e.value_type === 'ACTUAL'));
  });

  test('an analyst\'s question and a hypothetical premise are not readings', () => {
    const x = quickExtract([{ label: 'Concall transcript', kind: 'transcript', text: 'Is the current INR495 crores capex a part of that INR2,000 crores programme? The opportunity is around INR150 crores, an asset turn of 1.2x at 90% utilization at the new plant over time.' }]);
    assert.ok(!x.events.some((e) => e.variable === 'capex' && /2,000/.test(String(e.after))));
    assert.ok(!x.events.some((e) => e.variable === 'utilisation' && e.after === '90%'));
  });

  test('an exchange: volume growth read from the concall, "Rs." does not split a sentence', () => {
    const x = quickExtract([{ label: 'Concall transcript Aug 2026', kind: 'transcript', text: 'The average daily premium turnover reached an all-time high of Rs. 29,615 crores, a robust year-on-year growth of 96% in the quarter.' }]);
    const v = x.events.find((e) => e.variable === 'volume');
    assert.ok(v && /96%/.test(String(v.after)), JSON.stringify(x.events));
    assert.ok(x.financialLines.some((l) => /Rs\. 29,615 crores/.test(l)));
  });

  test('the summary says it was read without AI', () => {
    const x = quickExtract([{ label: 'P', kind: 'investor_presentation', text: PRESENTATION }]);
    const s = quickSummary(x, [{ label: 'P', kind: 'investor_presentation' }]);
    assert.equal(s.read_kind, 'deterministic');
    assert.equal(s.read_label, QUICK_READ_LABEL);
    assert.equal(s.verdict_line, '');
  });
});

// ── 2. persisted through the same store, labelled, superseded by AI ────────

describe('zzz816 · quick read persists and an AI read supersedes it', () => {
  const discover = async () => resolveDiscovery('ZZQUICK', [
    cand('https://x.test/transcript.pdf', 'transcript', 'Concall transcript Aug 2026'),
    cand('https://x.test/ppt.pdf', 'investor_presentation', 'Investor presentation Aug 2026'),
    cand('https://x.test/other.pdf', 'other', 'Newspaper advertisement'),
  ], [found(3)]);

  test('facts land in the evidence store marked "read without AI (deterministic)"', async () => {
    const r = await runQuickRead('ZZQUICK', { deps: { discover, extract: okExtract, kv } });
    assert.equal(r.outcome, 'READ', r.note);
    assert.equal(r.persisted, true);
    assert.ok(r.facts > 0);
    assert.match(r.note, /without AI/);
    const l = (await loadLedger('ZZQUICK'))!;
    const p = l.periods[l.latest_period!];
    assert.equal(p.prompt_version, QUICK_READ_VERSION);
    assert.equal(p.summary.read_label, QUICK_READ_LABEL);
    assert.ok(isQuickReadPeriod(p));
    assert.ok(latestIsQuickRead(l));
    assert.equal(p.documents_read, 2);
    assert.equal(l.runs[l.runs.length - 1].mode, QUICK_READ_MODE);
    assert.ok(p.facts.some((f) => f.metric_name === 'utilisation'));
    // Per-document cache: a second forced read does not download again.
    let downloads = 0;
    const counting = async (u: string) => { downloads++; return okExtract(u); };
    const r2 = await runQuickRead('ZZQUICK', { force: true, deps: { discover, extract: counting, kv } });
    assert.equal(r2.outcome, 'READ');
    assert.equal(downloads, 0);
    assert.ok(r2.documents.every((d) => d.cached));
    // The header counts it as read, and as read without AI.
    const ec = evidenceCounts([{ origin: 'bench', ledger: l }]);
    assert.equal(ec.evidence_read, 1);
    assert.equal(ec.quick_read, 1);
  });

  test('a recent quick read is not repeated on the next page load', async () => {
    await runQuickRead('ZZQUICK', { deps: { discover, extract: okExtract, kv } });
    let asked = 0;
    const r = await runQuickRead('ZZQUICK', { deps: { discover: async () => { asked++; return discover(); }, extract: okExtract, kv } });
    assert.equal(r.outcome, 'SKIPPED');
    assert.equal(asked, 0);
  });

  test('an AI read of the same period supersedes the deterministic facts; a quick read never overwrites an AI read', async () => {
    await runQuickRead('ZZQUICK', { deps: { discover, extract: okExtract, kv } });
    const before = (await loadLedger('ZZQUICK'))!;
    const period = before.latest_period!;
    const quickFacts = before.periods[period].facts.length;
    const ai = await persistEvidenceRun({
      ticker: 'ZZQUICK', market: 'IN', runId: 'run_ai_1', startedAt: new Date().toISOString(),
      documents: [{ id: 'd1', url: 'https://x.test/transcript.pdf', label: 'Concall transcript Aug 2026', kind: 'transcript', source: 'screener.in company page', period: '2026-08-12', date_iso: '2026-08-12', outcome: 'read' } as any],
      events: [{ variable: 'utilisation', value_type: 'ACTUAL', before: null, after: '92%', unit: '%', period: null, direction: 'up', evidence_text: 'Our plants are currently operating at 92% utilisation this quarter.', source: 'Concall transcript Aug 2026', confidence: 'HIGH' }],
      summary: { verdict_line: 'AI reading', positives: [] }, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: [],
      promptVersion: 'india-ai-summary-v9', model: 'claude-haiku', rawExtraction: null, pipeline: null, mode: 'read',
    });
    assert.equal(ai.persisted, true);
    assert.equal(ai.period, period);
    const p = ai.ledger.periods[period];
    assert.ok(!isQuickReadPeriod(p), 'the period is now an AI read');
    assert.equal(p.facts.length, 1);
    assert.equal(p.facts[0].after_value, '92%');
    assert.ok((p.superseded_facts || []).length >= quickFacts, 'deterministic facts kept as history');
    assert.ok((p.superseded_facts || []).every((f) => f.record_status === 'SUPERSEDED'));
    // Now a quick read of that period is refused (forced, so the guards are bypassed up to the store).
    const again = await runQuickRead('ZZQUICK', { force: true, deps: { discover, extract: okExtract, kv } });
    assert.notEqual(again.outcome, 'READ');
    const after = (await loadLedger('ZZQUICK'))!;
    assert.equal(after.periods[period].facts[0].after_value, '92%');
  });
});

// ── 3. honest failure ──────────────────────────────────────────────────────

describe('zzz816 · failure is honest', () => {
  test('documents found but none downloadable → couldn\'t read (reason), never NOT DISCLOSED', async () => {
    const discover = async () => resolveDiscovery('ZZFAIL', [cand('https://x.test/missing.pdf', 'transcript', 'Concall transcript Aug 2026')], [found(1)]);
    const r = await runQuickRead('ZZFAIL', { deps: { discover, extract: okExtract, kv } });
    assert.equal(r.outcome, 'FAILED');
    assert.match(r.note, /Couldn't read/);
    assert.match(r.note, /HTTP 403/);
    const l = (await loadLedger('ZZFAIL'))!;
    assert.equal(l.latest_period, null);
    assert.equal(l.last_attempt?.outcome, 'SOURCE_UNAVAILABLE');
    assert.equal(freshnessOf(l).evidence_state, 'RETRIEVAL_FAILED');
    const row = assessBookRow({ ...baseRow('ZZFAIL'), graded: { sales_yoy_pct: 20, eps_yoy_pct: 25, opm_pct: 15, opm_change_pp: 1.5 } });
    const folded = assessBookRow(applyLedger(row, l));
    const mech = folded.assessment!.checked.filter((c) => c.key === 'utilisation');
    assert.equal(mech[0].state, 'RETRIEVAL_FAILED');
    assert.match(String(mech[0].stateReason), /couldn't read \(.*HTTP 403/);
  });

  test('every source answered with nothing → NOT DISCLOSED (searched), not NOT SEARCHED', async () => {
    const discover = async () => resolveDiscovery('ZZNONE', [], [found(0), { source: 'BSE corporate announcements', outcome: 'empty', detail: 'none', found: 0 }]);
    const r = await runQuickRead('ZZNONE', { deps: { discover, extract: okExtract, kv } });
    assert.equal(r.outcome, 'NO_DOCUMENTS');
    const l = (await loadLedger('ZZNONE'))!;
    assert.equal(l.last_attempt?.outcome, 'NO_DISCLOSURE');
    const folded = assessBookRow(applyLedger({ ...baseRow('ZZNONE'), graded: { sales_yoy_pct: 20, eps_yoy_pct: 25, opm_pct: 15, opm_change_pp: 1.5 } }, l));
    const u = folded.assessment!.checked.find((c) => c.key === 'utilisation')!;
    assert.equal(u.state, 'NOT_DISCLOSED');
    assert.match(evidenceStateLine('NOT_DISCLOSED', { docs: null, reason: u.stateReason }), /searched every source/);
  });

  test('a source that errored is SOURCE UNAVAILABLE, not an absence', async () => {
    const discover = async () => resolveDiscovery('ZZDOWN', [], [{ source: 'screener.in company page', outcome: 'error', detail: 'HTTP 503', found: 0 }]);
    const r = await runQuickRead('ZZDOWN', { deps: { discover, extract: okExtract, kv } });
    assert.equal(r.outcome, 'FAILED');
    assert.match(r.note, /Not a disclosure gap/);
    assert.equal((await loadLedger('ZZDOWN'))!.last_attempt?.outcome, 'SOURCE_UNAVAILABLE');
  });

  test('before any read the rows say NOT SEARCHED', () => {
    const row = assessBookRow({ ...baseRow('ZZNEW'), graded: { sales_yoy_pct: 20, eps_yoy_pct: 25, opm_pct: 15, opm_change_pp: 1.5 } });
    assert.equal(row.assessment!.checked.find((c) => c.key === 'utilisation')!.state, 'NOT_SEARCHED');
  });

  test('selection takes one transcript, one presentation, one results filing — never "other"', () => {
    const s = quickSelection([cand('a', 'other', 'x'), cand('b', 'transcript', 't'), cand('c', 'transcript', 't2'), cand('d', 'results', 'r'), cand('e', 'announcement', 'an')]);
    assert.deepEqual(s.map((c) => c.url), ['b', 'd']);
  });
});

// ── 4. batching order ──────────────────────────────────────────────────────

describe('zzz816 · page-load order: book → bench passing → rest', () => {
  const NOW = '2026-09-28T10:00:00Z';
  test('queue order and eligibility', () => {
    const old: CompanyLedger = { ...emptyLedger('OLD', 'IN', NOW), latest_period: 'Q3 FY26', periods: { 'Q3 FY26': {} as any } } as any;
    const rows = [
      { symbol: 'ZFAIL', origin: 'bench', preset: { state: 'fail' }, market: 'IN', ledger: null },
      { symbol: 'YPASS', origin: 'bench', preset: { state: 'pass' }, market: 'IN', ledger: null },
      { symbol: 'XBOOK', origin: 'book', market: 'IN', ledger: null },
      { symbol: 'WBOTH', origin: 'both', market: 'IN', ledger: old },
      { symbol: 'VUS', origin: 'book', market: 'US', ledger: null },
      { symbol: 'APASS', origin: 'bench', preset: { state: 'pass' }, market: 'IN', ledger: null },
    ];
    assert.deepEqual(quickReadQueue(rows as any, NOW).map((r) => r.symbol), ['XBOOK', 'WBOTH', 'APASS', 'YPASS', 'ZFAIL']);
    assert.equal(quickTier(rows[0] as any), 2);
    assert.equal(quickTier(rows[1] as any), 1);
    assert.equal(needsQuickRead(rows[4] as any, NOW), false, 'US names are not quick-read here');
  });
  test('a name quick-read in the last six hours waits', () => {
    const l = { ...emptyLedger('Q', 'IN', NOW), runs: [{ run_id: 'q', mode: QUICK_READ_MODE, finished_at: '2026-09-28T08:00:00Z', outcome: 'SOURCE_UNAVAILABLE' }] } as any;
    assert.equal(needsQuickRead({ symbol: 'Q', origin: 'book', market: 'IN', ledger: l }, NOW), false);
    assert.equal(needsQuickRead({ symbol: 'Q', origin: 'book', market: 'IN', ledger: l }, '2026-09-28T15:00:00Z'), true);
  });
  test('progress line', () => {
    assert.equal(quickProgressLine({ running: true, done: 11, total: 21, filled: 9, failed: 1, nothing: 1 }), 'Quick-reading 12 of 21 (no AI)…');
    assert.match(quickProgressLine({ running: false, done: 21, total: 21, filled: 17, failed: 2, nothing: 2 }), /17 filled · 2 with no readable document · 2 could not be read/);
  });
});

// ── 5. financial-sector type fit ───────────────────────────────────────────

describe('zzz816 · financial companies get a meaningful type', () => {
  test('an NBFC by industry → G, cash conversion N/A, no capacity asked', () => {
    const g = { company: 'Some Capital Ltd', sector: 'Finance', industry: 'Non Banking Financial Company (NBFC)', sales_yoy_pct: 18, eps_yoy_pct: 22, opm_pct: 60, opm_change_pp: 2, cfo_to_pat_ratio: -3.2 };
    assert.equal(financialKindOf(g, null)?.kind, 'lender');
    const t = financialProvisionalType(g, null)!;
    assert.equal(t.pattern, 'G');
    assert.equal(t.fit, 'nearest');
    assert.match(t.because, /lender/);
    assert.match(t.because, /set the type yourself/);
    const row = assessBookRow({ ...baseRow('ZZNBFC'), graded: g });
    assert.equal(row.pattern?.pattern, 'G', 'not nearest A');
    const cash = row.assessment!.checked.find((c) => c.key === 'cash_conversion')!;
    assert.equal(cash.state, 'NOT_APPLICABLE');
    assert.match(String(cash.stateReason), /lender/);
    assert.ok(!row.assessment!.checked.some((c) => c.key === 'utilisation' && c.state !== 'NOT_APPLICABLE'));
  });
  test('an exchange → A without a plant (capacity / utilisation N/A)', () => {
    const g = { company: 'BSE', sector: 'Capital Markets', industry: 'Exchange and Data Platform', sales_yoy_pct: 60, eps_yoy_pct: 90, opm_pct: 55, opm_change_pp: 6 };
    const t = financialProvisionalType(g, null)!;
    assert.equal(t.pattern, 'A');
    assert.match(t.because, /market infrastructure/);
    const row = assessBookRow({ ...baseRow('ZZEXCH'), graded: g });
    const u = row.assessment!.checked.find((c) => c.key === 'utilisation');
    assert.equal(u?.state, 'NOT_APPLICABLE');
  });
  test('a lender recognised from its own documents (quick-read vocabulary)', () => {
    const x = quickExtract([{ label: 'P', kind: 'investor_presentation', text: LENDER_DECK }]);
    const s = quickSummary(x, [{ label: 'P', kind: 'investor_presentation' }]);
    assert.equal(financialKindOf({ sales_yoy_pct: 10 }, s)?.kind, 'lender');
  });
  test('a manufacturer is never classified as financial', () => {
    assert.equal(financialKindOf({ company: 'Kirloskar Oil Engines', sector: 'Capital Goods', industry: 'Compressors, Pumps & Diesel Engines' }, null), null);
    assert.equal(financialKindOf({ company: 'Bharat Forge' }, { business_words: 'advance · deposit · loan book', verdict_line: 'plant utilisation at 80% and installed capacity of 1,000 tonnes' }), null);
  });
  test('the owner\'s own type always wins, and an exact non-A type stays', () => {
    const g = { sector: 'Finance', industry: 'NBFC', sales_yoy_pct: 5, eps_yoy_pct: 150, pat_prev_cr: -10, pat_curr_cr: 40 };
    const row = assessBookRow({ ...baseRow('ZZOWN'), graded: g, pattern: { pattern: 'F', fit: 'manual', because: 'mine', exitCondition: 'x', ratio: null } as any });
    // A 'manual' pattern on the row (not a saved override) is kept when it is not a nearest / A fit.
    assert.equal(row.pattern?.pattern, 'F');
  });
});

// ── 6. Special Focus source labels ─────────────────────────────────────────

describe('zzz816 · Special Focus labels find the Conviction Beats row', () => {
  const all = [
    { symbol: 'HAPPYFORGE', origin: 'bench', preset: { state: 'fail', text: 'misses ROCE' } },
    { symbol: 'CYIENTDLM-BE', origin: 'bench', preset: { state: 'pass' } },
    { symbol: 'IMFA', origin: 'book' },
  ];
  const inView = [all[1], all[2]];
  test('bare-symbol lookup over the whole page', () => {
    const idx = focusRowIndex(all);
    assert.equal(idx('CYIENTDLM')?.symbol, 'CYIENTDLM-BE');
    assert.equal(idx('NSE:HAPPYFORGE')?.symbol, 'HAPPYFORGE');
    assert.equal(idx('FCL'), null);
  });
  test('labels: in view, hidden by the criteria chip, and truly absent', () => {
    const view = focusRowIndex(inView);
    assert.equal(focusSourceLabel(all[2] as any, { inView: !!view('IMFA') }), '📗 Book');
    assert.equal(focusSourceLabel(all[1] as any, { inView: !!view('CYIENTDLM') }), '🏆 Bench (Conviction Beats)');
    assert.match(focusSourceLabel(all[0] as any, { inView: !!view('HAPPYFORGE') }), /misses your Conviction Beats criteria — hidden by default/);
    assert.equal(focusSourceLabel(null, { inView: false, origins: ['gainers'] }), 'Not in book / bench (Daily Gainers)');
    assert.match(focusSourceLabel(null, { inView: false, origins: ['gainers', 'portfolio'] }), /was detected on Portfolio Catalysts/);
  });
  test('the queue attaches the page row to a stored Daily Gainers record', () => {
    const idx = focusRowIndex(all);
    const pc = (ticker: string, kind: string) => ({ id: `${ticker}:${kind}`, ticker, kind, specialFocus: true, eventIds: [], origins: ['gainers'] } as any);
    const stored = {
      'HAPPYFORGE:CAPACITY_RAMP': { id: 'HAPPYFORGE:CAPACITY_RAMP', latest: pc('HAPPYFORGE', 'CAPACITY_RAMP'), user: null, focus: { inQueue: true, decayed: false, note: null } },
      'CYIENTDLM:ORDER_VISIBILITY': { id: 'CYIENTDLM:ORDER_VISIBILITY', latest: pc('CYIENTDLM', 'ORDER_VISIBILITY'), user: null, focus: { inQueue: true, decayed: false, note: null } },
      'CYIENTDLM:CAPACITY_RAMP': { id: 'CYIENTDLM:CAPACITY_RAMP', latest: pc('CYIENTDLM', 'CAPACITY_RAMP'), user: null, focus: { inQueue: true, decayed: false, note: null } },
    };
    const q = specialFocusQueue(new Map(), stored as any, (t) => idx(t));
    assert.equal(q.entries.length, 3, 'one entry per mechanism: CYIENTDLM order book and capacity ramp are two');
    assert.ok(q.entries.every((e) => e.row), 'every company is found on the page');
  });
});

function baseRow(symbol: string): BookRow {
  return { symbol, origin: 'bench', market: 'IN', graded: null, tier: null, pattern: null, radarScore: null, summary: null, sourceUrl: null, state: 'idle', assessment: null, capex: null, promiseNote: null };
}
