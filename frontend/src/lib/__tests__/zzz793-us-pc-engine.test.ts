// zzz793 — US Portfolio Catalysts through the shared engine: provisional
// thesis types for every holding with SEC data, THESIS NOT SET only with no
// data, no junk figures, no routine-capex "not built", no ROCE row unless
// computed, $M and the company's own fiscal periods on the card, SEC wording,
// export and research-priority lines without a score.
// Run: npx tsx --test src/lib/__tests__/zzz793-us-pc-engine.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { usFactsResult, type UsSecProfile } from '../us-thesis/facts-row';
import { newUsRow, applyUsLedger, assessUsRow, autoPattern, usCapexChain } from '../us-thesis/assess';
import { usNearestType, usTypeInputs } from '../us-thesis/us-type';
import { plausibleUsFigure, sanitizeUsSummary } from '../us-thesis/sanitize';
import { usDisplayRow, usText, usPeriodNamer } from '../us-thesis/display';
import { usExportLine, usWhyLine, usBatchLine } from '../us-thesis/page-words';
import { usCandidatesFromSubmissions, usLedgerDocuments } from '../us-thesis/adapter';
import { setUsEvidenceKvForTests, persistUsEvidenceRun } from '../us-thesis/evidence-store';
import { buildCapexChain } from '../thesis/capex-chain';
import { ThesisCard } from '../../components/thesis-card';

(globalThis as any).React = React;  // the card's JSX compiles to React.createElement under tsx
const FX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zzz793-us-pc-edgar.json'), 'utf8'));
const AFFIRMATIVE = ['STRENGTHENING', 'ON_TRACK', 'POSITIVE_EXPECTATION_GAP'];
const rowFrom = (t: string) => {
  const c = FX.companies[t];
  const r = usFactsResult(t, c.facts, { cik: c.cik, company: c.entityName, sic: c.sic, sicDescription: c.sicDescription, forms: c.forms });
  return newUsRow(t, 'book', r.row, r.why, 'NYSE', r.profile);
};
const profile = (p: Partial<UsSecProfile>): UsSecProfile => ({ cik: 1, company: null, sic: null, sic_description: null, filer: 'domestic', forms_line: 'files 10-Q / 10-K', calendar: null, period: null, roce: null, rpo_growth_pct: null, note: null, ...p });

describe('(0) every US holding with SEC data gets a provisional type', () => {
  test('the names that were THESIS NOT SET with filings now carry a nearest-fit type — CONFIRMATION REQUIRED at most, never affirmative', () => {
    for (const t of ['ITW', 'RSKD', 'XPEV', 'GFS', 'LAR']) {
      const r = rowFrom(t);
      assert.ok(r.pattern, `${t} typed`);
      assert.equal(r.pattern!.fit, 'nearest', t);
      assert.notEqual(r.assessment!.status, 'THESIS_NOT_SET', t);
      assert.ok(!AFFIRMATIVE.includes(r.assessment!.status), `${t} ${r.assessment!.status}`);
      assert.match(r.pattern!.because, /provisional|Nearest fit/);
    }
    assert.equal(rowFrom('ITW').pattern!.pattern, 'G', 'ITW: revenue +6.1%, earnings +7.9%, cash-backed → G');
  });
  test('foreign filer with annual figures only: typed provisionally, status EVIDENCE INCOMPLETE (no quarterly row)', () => {
    const r = rowFrom('RSKD');
    assert.equal(r.graded, null);
    assert.equal(r.assessment!.status, 'EVIDENCE_INCOMPLETE');
  });
  test('rules: B on backlog ahead of revenue, F on a loss-to-profit swing, A on margin or fast revenue, G on steady cash-backed, SIC fallback said as a weak fit', () => {
    const base = { salesY: null, earnY: null, niCur: null, niPrev: null, opmChange: null, cfoToPat: null, rpoY: null, sic: null, sicDescription: null, periodWords: 'x' };
    assert.equal(usNearestType({ ...base, salesY: 5, rpoY: 40 })!.pattern, 'B');
    assert.equal(usNearestType({ ...base, salesY: 5, niPrev: -3, niCur: 2 })!.pattern, 'F');
    assert.equal(usNearestType({ ...base, salesY: 2, opmChange: 3 })!.pattern, 'A');
    assert.equal(usNearestType({ ...base, salesY: 7, niCur: 10, earnY: 5, cfoToPat: 1.1 })!.pattern, 'G');
    const weak = usNearestType({ ...base, salesY: -20, niCur: -5, niPrev: -2, sic: '3760', sicDescription: 'Guided Missiles & Space Vehicles & Parts' })!;
    assert.equal(weak.pattern, 'B'); assert.match(weak.because, /weak fit/);
    assert.equal(usNearestType({ ...base }), null, 'nothing to fit from → no type');
    for (const r of [usNearestType({ ...base, salesY: 5, rpoY: 40 })!, weak]) assert.equal(r.fit, 'nearest');
  });
  test('THESIS NOT SET only when there is truly no data — and the reason is said', () => {
    const none = newUsRow('ZZZZ', 'book', null, 'ZZZZ is not in the SEC company list — no SEC filer, so there are no SEC figures to read', 'NYSE', null);
    assert.equal(none.assessment!.status, 'THESIS_NOT_SET');
    assert.match(none.assessment!.because, /not in the SEC company list/);
  });
  test('the owner\'s saved type always wins', () => {
    const r = assessUsRow(rowFrom('ITW'), { ITW: 'B' });
    assert.equal(r.pattern!.fit, 'manual'); assert.equal(r.pattern!.pattern, 'B');
  });
  test('rows built without an SEC profile keep India\'s classifier only (India behaviour unchanged)', () => {
    assert.equal(autoPattern({ sales_yoy_pct: 3, net_profit_yoy_pct: -40, cfo_to_pat_ratio: 0.5 }, undefined), null);
    assert.ok(autoPattern({ sales_yoy_pct: 3, net_profit_yoy_pct: -40, cfo_to_pat_ratio: 0.5, net_income_curr_musd: 5 }, profile({ sic: '3560' })));
  });
});

describe('(k) junk management-statement numbers are rejected', () => {
  test('a bare number or a percentage with no unit that fits the variable is dropped', () => {
    assert.equal(plausibleUsFigure('volume', 'volume 65').ok, false);
    assert.equal(plausibleUsFigure('working_capital', 'working capital 83%').ok, false);
    assert.equal(plausibleUsFigure('order_book', '2026').ok, false);
    assert.equal(plausibleUsFigure('capacity', 'see page 65').ok, false);
    assert.equal(plausibleUsFigure('utilisation', '85%').ok, true);
    assert.equal(plausibleUsFigure('volume', '65', 'Energy storage volume 65 kilotonnes in the quarter').ok, true, 'unit adjacent in the sentence');
    assert.equal(plausibleUsFigure('volume', '65', 'see page 65 for volumes').ok, false);
    assert.equal(plausibleUsFigure('working_capital', '$120.5 million').ok, true);
    assert.equal(plausibleUsFigure('new_customer', 'a new hyperscale customer in Europe').ok, true, 'words without figures are kept');
  });
  test('the ALB summary loses its junk; events without a real figure are dropped', () => {
    const { summary, dropped } = sanitizeUsSummary({ volume_price_mix: { volume: 'volume 65', price: '', mix: '', exports: '' }, balance: { working_capital: 'working capital 83%', fcf: '$210 million', debt: '' },
      events: [{ variable: 'volume', after: '65', unit: null, evidence_text: 'volume 65' }, { variable: 'order_book', after: '$1.9 billion', unit: null, evidence_text: 'Backlog $1.9 billion' }] });
    assert.equal(summary.volume_price_mix.volume, '');
    assert.equal(summary.balance.working_capital, '');
    assert.equal(summary.balance.fcf, '$210 million');
    assert.deepEqual(summary.events.map((e: any) => e.variable), ['order_book']);
    assert.ok(dropped.length >= 3);
  });
});

describe('(i) routine capex is not a project', () => {
  test('purchases of property and equipment alone → capex state UNKNOWN, never "NOT STARTED / not built"', () => {
    const summary = { capital: { capex: 'Purchases of property and equipment were $25.0 million' }, capex_projects: [] };
    const vars: any[] = [{ key: 'capex', label: 'Capex', after: '$25.0 million', verdict: 'unknown', evidence: 'x', source: 'filing', kind: 'fact' }];
    const raw = buildCapexChain(summary, vars, null);
    const us = usCapexChain(raw, summary, { capex_curr_musd: 25 })!;
    assert.equal(us.earning.state, 'UNKNOWN');
    assert.ok(!/NOT STARTED|not built/i.test(JSON.stringify(us)), JSON.stringify(us.earning));
    assert.match(us.because, /routine capital spending/);
  });
  test('a named facility keeps its project status', () => {
    const summary = { capex_projects: [{ name: 'Salt Lake City actuator plant', amount: '$60 million', status: 'under construction', capacity_added: '', completes: '2027' }] };
    const raw = buildCapexChain(summary, [], null);
    assert.equal(usCapexChain(raw, summary, null), raw);
  });
});

describe('(a)(d)(e)(m) what the card prints', () => {
  const NOW = new Date('2026-09-24T12:00:00Z');
  test('$M, the company\'s own fiscal period, SEC wording; no crore / India key / ROCE NOT DISCLOSED', async () => {
    const m = new Map<string, string>();
    setUsEvidenceKvForTests({ get: async <T = any>(k: string) => (m.has(k) ? JSON.parse(m.get(k)!) as T : null), set: async (k: string, v: any) => { m.set(k, JSON.stringify(v)); } });
    try {
      const recent = [{ form: '8-K', filingDate: '2026-09-02', reportDate: '2026-09-02', items: ['2.02'], accession: '0001618732-26-000071' }, { form: '10-K', filingDate: '2026-09-18', reportDate: '2026-07-31', items: [], accession: '0001618732-26-000080' }];
      const c = usCandidatesFromSubmissions(recent, 1618732, NOW);
      const docs = usLedgerDocuments(c, c.map((x) => ({ url: x.url, outcome: 'read' as const, chars: 5000 })));
      const p = await persistUsEvidenceRun({ ticker: 'NTNX', runId: 'r', startedAt: '2026-09-20T00:00:00Z', documents: docs, events: [], summary: { verdict_line: 'Revenue $757.1 million.', positives: [], capital: { capex: 'Purchases of property and equipment were $25.0 million' } }, discoveryState: 'EVIDENCE_FOUND', discoveryAttempts: [], promptVersion: 'v', model: 'm', rawExtraction: null, pipeline: null });
      const row = applyUsLedger(rowFrom('NTNX'), p.ledger);
      assert.equal(row.reportingPeriod, 'Q1 FY27', 'the engine keeps its own key');
      const d: any = usDisplayRow(row);
      assert.equal(d.reportingPeriod, 'Q4 FY2026', 'the owner reads the company\'s own quarter');
      const html = renderToStaticMarkup(React.createElement(ThesisCard as any, { symbol: 'NTNX', market: 'US', assessment: d.assessment, pattern: d.pattern, capex: d.capex, ledger: d.ledger, reportingPeriod: d.reportingPeriod, changed: d.changed, defaultOpen: true, documentsRead: d.documentsRead, dataSource: 'sec-xbrl', freshness: d.freshness, needsRead: true }));
      const txt = html.replace(/<[^>]+>/g, ' ');
      assert.ok(!/\bCr\b|crore|lakh|₹/.test(txt), 'no rupee units');
      assert.ok(!/\bQ[1-4] FY\d\d\b(?!\d)/.test(txt), 'no India period key');
      assert.ok(!/concall|exchange announcement|screener/i.test(txt), 'no India wording');
      assert.ok(!/ROCE · NOT DISCLOSED|ROCE — NOT DISCLOSED/.test(txt), 'ROCE is computed or omitted, never NOT DISCLOSED');
      assert.match(txt, /\$38\.7M → \$1,269\.6M/);
      assert.match(txt, /Q4 FY2026/);
    } finally { setUsEvidenceKvForTests(null); }
  });
  test('ROCE left off the ledger when it cannot be computed', () => {
    const r = newUsRow('NOROCE', 'book', { ticker: 'NOROCE', market: 'US', source: 'sec-xbrl', sales_yoy_pct: 8, net_profit_yoy_pct: 9, opm_pct: 12, opm_prev_pct: 11, opm_change_pp: 1, cfo_to_pat_ratio: 1.2, cfo_period_is_current: true, net_income_curr_musd: 10 }, null, 'NYSE', profile({ sic: '3560' }));
    assert.ok(!r.assessment!.checked.some((c) => c.key === 'roce'));
  });
  test('usText maps keys, $ mn and India words; never touches a number', () => {
    const name = usPeriodNamer({ calendar: { fyeMonth: 7, fyeDay: 31, offset: 0, source: '' } });
    assert.equal(usText('WHAT CHANGED · Q1 FY27 vs Q4 FY26 · +$13.2 mn', name), 'WHAT CHANGED · Q4 FY2026 vs Q3 FY2026 · +$13.2M');
    assert.equal(usText('exist only in a filing, concall or exchange announcement', name), 'exist only in a 10-Q, 10-K, 8-K or earnings release (SEC EDGAR)');
  });
});

describe('(f)(g)(h) page lines', () => {
  const label = (s: string) => s.replace(/_/g, ' ');
  test('export: "eligible for research export", reconciled — never "constructive statuses"', () => {
    const x = usExportLine([{ assessment: { status: 'ON_TRACK' } }, { assessment: { status: 'CONFIRMATION_REQUIRED' } }, { assessment: { status: 'WEAKENING' } }, { assessment: null }], label);
    assert.equal(x.eligible, 2); assert.equal(x.analysed, 3);
    assert.match(x.line, /2 eligible for research export/);
    assert.match(x.line, /2 \+ 1 = 3/);
    assert.ok(!/constructive/i.test(x.line));
  });
  test('research priority: a plain "Why: …" and no number from the ranking', () => {
    const w = usWhyLine({ output: { revenue: 27.6, earnings: 244.4, marginPp: 4.6 }, drivers: [{ group: 'Demand', text: 'order book $151.2M → $164.4M (+8.7%)' }] });
    assert.match(w, /^Why: demand — order book \$151\.2M → \$164\.4M/);
    assert.ok(!/score|\/100|\b\d{2} pts?\b/i.test(w));
  });
  test('the batch line ends: running, then stopped with counts — never stuck', () => {
    assert.equal(usBatchLine({ running: true, done: 4, total: 30 }), 'Reading 5 of 30…');
    assert.equal(usBatchLine({ running: false, done: 7, total: 30, stopped: true }), 'Stopped — 7 of 30 finished; 23 not read. Nothing in progress.');
    assert.equal(usBatchLine({ running: false, done: 30, total: 30 }), null);
  });
});

describe('source hygiene', () => {
  test('the US page file exports only its default and never prints "score" or "constructive statuses"', () => {
    const s = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'us-portfolio-catalysts', 'page.tsx'), 'utf8');
    assert.deepEqual(s.split('\n').filter((l) => /^export\s+(?!default)/.test(l)), []);
    assert.ok(!/· score \{/.test(s));
    assert.ok(!/constructive statuses/.test(s));
    assert.ok(!/engine period key/.test(s));
    assert.ok(!/filing, concall or exchange announcement/.test(s));
  });
  test('the read hook ends every read: a deadline, an abort on Stop, and a finally that clears "Reading…"', () => {
    const s = readFileSync(join(__dirname, '..', 'us-thesis', 'use-us-book.ts'), 'utf8');
    assert.match(s, /US_READ_DEADLINE_MS/);
    assert.match(s, /signal: ctl\.signal/);
    assert.match(s, /for \(const c of Array\.from\(inflight\.current\.values\(\)\)\) c\.abort\(\)/);
    assert.match(s, /finally \{[\s\S]*r\.state === 'loading'/);
  });
});
