// zzz829 — US Portfolio Catalysts "New · last 10 days": results 8-Ks take the year-ago comparison from the card's
// SEC XBRL quarter, one filing = one card, deltas only from the headline's own metric, 8-K typing from the
// document (acquisition, debt offering, no clinical misread, no bank-capital tables), materiality scaled to the
// company, US units, boilerplate never evidence, stale XBRL said on the card, and the BOOK filter on the US tab.
// Synthetic tickers only (ZZUS …). Run: npx tsx --test src/lib/__tests__/zzz829-us-10d.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildRecentCatalysts, xbrlResultsClaims, usMateriality,
  type RawEvent, type FilingRead, type ThesisCtx, type UsCardFacts,
} from '../catalyst/recent-events';
import { tidyFigure, usScaleAmounts, usTableScale, usdShort, usdAmountIn } from '../catalyst/event-card';
import { readFilingText, filingReadVersion, FILING_READ_VERSION } from '../catalyst/filing-read';
import { usBoilerplateEvidence, sanitizeUsEvents, sanitizeUsSummary } from '../us-thesis/sanitize';
import { US_DET_VERSION, withUsDetEvidence } from '../us-thesis/det-evidence';
import { formatDeltaAbs } from '../thesis/evidence-ledger';
import { usGradedRow } from '../us-thesis/adapter';
import { latestPeriodic, xbrlBehindNote, usFactsRowStale, US_FACTS_KEY } from '../us-thesis/facts-server';
import NewCatalystsTab from '../../components/catalyst/new-catalysts-tab';

(globalThis as any).React = React;
const TODAY = '2026-09-28';
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const B: ThesisCtx = { pattern: 'B', fit: 'exact', assessment: null };
let n = 0;
const acc = () => `0000000000260${String(++n).padStart(5, '0')}`;
const sec = (a: string, doc: string) => `https://www.sec.gov/Archives/edgar/data/111/${a}/${doc}`;
const usFiling = (o: Partial<RawEvent>): RawEvent => ({ ticker: 'ZZUS', date: '2026-09-25', title: 'x', origin: 'feed', source: 'SEC EDGAR', badge: 'filed', url: sec(acc(), 'd8k.htm'), ctx: B, ...o });
const rd = (url: string, o: Partial<FilingRead>): FilingRead => ({ url, status: 'read', figures: [], touches: [], version: 'r4-us', ...o });
const all = (r: ReturnType<typeof buildRecentCatalysts>) => [...r.items, ...r.minor];
const PAD = ' The company designs and sells precision instruments to industrial customers across North America and Europe, and reports in US dollars.';

const FX: UsCardFacts = { fiscal_label: 'Q2 FY2026', period: 'Q2 FY2026 (quarter ended 2026-06-30)', q_end: '2026-06-30',
  revenue_curr_musd: 163, revenue_prev_musd: 129.4, net_income_curr_musd: 43.2, net_income_prev_musd: 16.95, opm_pct: 13.2, opm_prev_pct: 11.1,
  sales_yoy_pct: 26, net_profit_yoy_pct: 154.9 };

// ── 1. results 8-K → CHANGE from the card's SEC XBRL quarter ────────────────
describe('1 · a results 8-K takes its year-ago comparison from the card\'s SEC XBRL quarter', () => {
  const line = 'Second quarter 2026: Revenue $163 mn, EBITDA $21.1 mn, PAT $43.2 mn; guidance raised';
  const mk = (facts: Record<string, UsCardFacts> | null, l: string = line) => {
    const f = usFiling({ title: '8-K: Results of operations [Item 2.02, 9.01]' });
    return buildRecentCatalysts([f], TODAY, { market: 'US', reads: { [f.url!]: rd(f.url!, { kind: 'Results', line: l, changes: [] }) }, facts });
  };
  test('XBRL quarter = the filing\'s quarter → CHANGE with before → after, Direct, Supports', () => {
    const e = all(mk({ ZZUS: FX }))[0];
    assert.equal(e.type, 'Results');
    assert.equal(e.card!.delta.kind, 'change');
    assert.match(e.card!.delta.text, /Revenue \$129\.4 mn → \$163 mn \(\+26%\)/);
    assert.equal(e.card!.quality, 'Direct');
    assert.equal(e.card!.impact, 'Supports', e.card!.why);
    assert.match(e.card!.why, /same quarter a year earlier \(SEC XBRL\)/);
  });
  test('the deteriorating quarter → Weakens (needs attention)', () => {
    const e = all(mk({ ZZUS: { ...FX, revenue_curr_musd: 110, opm_pct: 9 } }, 'Second quarter 2026: Revenue $110 mn, PAT $43.2 mn'))[0];
    assert.equal(e.card!.impact, 'Weakens');
    assert.ok(e.card!.attention);
  });
  test('stale XBRL (the card still has Q1) → level only, and the card says why', () => {
    const e = all(mk({ ZZUS: { ...FX, fiscal_label: 'Q1 FY2026', q_end: '2026-03-31' } }))[0];
    assert.notEqual(e.card!.delta.kind, 'change');
    assert.match(e.card!.why, /not in yet \(the card still has Q1 FY2026\)/);
  });
  test('a revenue that disagrees with the XBRL quarter draws no comparison', () => {
    const r = xbrlResultsClaims({ ...FX, revenue_curr_musd: 190 }, '2026-09-25', line);
    assert.equal(r.claims.length, 0);
    assert.match(String(r.note), /not the SEC XBRL quarter/);
  });
  test('no facts → unchanged (level only, no invented prior)', () => {
    const e = all(mk(null))[0];
    assert.equal(e.card!.delta.kind, 'level');
    assert.equal(e.card!.impact, 'Neutral');
  });
});

// ── 2. one filing, one card ─────────────────────────────────────────────────
describe('2 · every document of one 8-K is one card with sub-points', () => {
  test('Results + Order win + business update from one accession → one Results card, the rest "also in this filing"', () => {
    const a = acc();
    const body = usFiling({ url: sec(a, 'd8k.htm'), title: '8-K: Results of operations [Item 2.02, 7.01, 9.01]' });
    const ex1 = usFiling({ url: sec(a, 'ex99-1.htm'), title: 'Press release — design win', origin: 'ledger-doc' });
    const ex2 = usFiling({ url: sec(a, 'ex99-2.htm'), title: 'Investor presentation', origin: 'ledger-doc' });
    const r = buildRecentCatalysts([body, ex1, ex2], TODAY, { market: 'US', facts: { ZZUS: FX }, reads: {
      [body.url!]: rd(body.url!, { kind: 'Results', line: 'Second quarter 2026: Revenue $163 mn, PAT $43.2 mn' }),
      [ex1.url!]: rd(ex1.url!, { kind: 'Order win', line: 'Major contract / order: Zzus was selected for a $100 mn design win' }),
      [ex2.url!]: rd(ex2.url!, { kind: 'Concall / business update', line: 'New product launch: Zzus launched its next-generation platform' }),
    } });
    const ev = all(r).filter((e) => e.ticker === 'ZZUS');
    assert.equal(ev.length, 1, ev.map((e) => e.type).join(', '));
    assert.equal(ev[0].type, 'Results');
    const types = (ev[0].also || []).map((x) => x.type);
    assert.ok(types.includes('Order win') && types.includes('Concall / business update'), types.join(', '));
    const html = renderToStaticMarkup(React.createElement(NewCatalystsTab, { result: r, loading: false, names: 1, sourceNotes: [], market: 'US' }));
    assert.match(html, /ALSO IN THIS FILING/);
  });
  test('India is unchanged: two orders filed the same day stay grouped as before (no accession rule)', () => {
    const inF = (u: string): RawEvent => ({ ticker: 'ZZIN', date: '2026-09-26', title: 'Bagging/Receiving of orders/contracts', origin: 'ledger-doc', source: 'BSE corporate announcements', url: `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${u}.pdf`, ctx: B });
    const r = buildRecentCatalysts([inF('a1'), inF('a2')], TODAY, { market: 'IN' });
    assert.equal(all(r).filter((e) => e.ticker === 'ZZIN').length, 1);
  });
});

// ── 3. the delta must be the headline's own metric ─────────────────────────
describe('3 · no unrelated delta under a headline', () => {
  test('a design-win headline never shows the backlog change as its delta; the backlog decline still weakens a B thesis', () => {
    const f = usFiling({ title: '8-K: Other events [Item 8.01, 9.01]' });
    const ev: RawEvent = { ...f, origin: 'ledger-event', variable: 'order_book', direction: 'down', before: '$135.2 million', after: '$128.4 million',
      quote: 'Backlog was $128.4 million at quarter end compared with $135.2 million a year earlier.', text: 'Order book: $135.2 million → $128.4 million' };
    const r = buildRecentCatalysts([f, ev], TODAY, { market: 'US', facts: { ZZUS: FX }, reads: { [f.url!]: rd(f.url!, { kind: 'Order win', line: 'Major contract / order: Zzus was selected for a $100 mn design win' }) } });
    const e = all(r).find((x) => x.ticker === 'ZZUS')!;
    assert.equal(e.type, 'Order win');
    assert.notEqual(e.card!.delta.kind, 'change', e.card!.delta.text);
    assert.ok((e.also || []).some((a) => a.type === 'Stated change' && /Order book/.test(a.line) && a.dir === 'down'));
    assert.equal(e.card!.impact, 'Weakens');
    assert.match(e.card!.why, /order book down.*in the same filing/);
    assert.ok(e.card!.attention);
  });
  test('the filed RPO reading (SEC XBRL) is its own card, never grouped into the 8-K beside it', () => {
    const f = usFiling({ title: '8-K: Other events [Item 8.01, 9.01]' });
    const rpo: RawEvent = { ticker: 'ZZUS', date: '2026-09-24', title: 'Order book (remaining performance obligations, SEC XBRL): $135.2 mn → $128.4 mn',
      text: 'Order book (remaining performance obligations, SEC XBRL): $135.2 mn → $128.4 mn', variable: 'order_book', direction: 'down',
      before: '$135.2 mn', after: '$128.4 mn', quote: 'RPO $128.4 mn at Jun 30, 2026, against $135.2 mn at Jun 30, 2025', figure: '$135.2 mn → $128.4 mn',
      url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000000111&type=10-', source: '10-Q (SEC XBRL, filed 2026-09-24)', origin: 'persistent', badge: 'filed', ctx: B };
    const r = buildRecentCatalysts([f, rpo], TODAY, { market: 'US', facts: { ZZUS: FX }, reads: { [f.url!]: rd(f.url!, { kind: 'Order win', line: 'Major contract / order: Zzus was selected for a $100 mn design win' }) } });
    const ev = all(r).filter((x) => x.ticker === 'ZZUS');
    assert.equal(ev.length, 2);
    const win = ev.find((x) => /design win/.test(x.what))!;
    assert.notEqual(win.card!.delta.kind, 'change');
    const ob = ev.find((x) => x !== win)!;
    assert.equal(ob.card!.delta.kind, 'change');
    assert.equal(ob.card!.impact, 'Weakens', 'a falling backlog on an order-book thesis is not silently Neutral');
  });
});

// ── 4. typing from the 8-K text ─────────────────────────────────────────────
describe('4 · 8-K typing from the document', () => {
  test('"completes acquisition" headline → Acquisition (with the acquisition chain), not a business update', () => {
    const text = 'Zzco Completes Acquisition of Widget Robotics. Zzco Inc. today announced that it has completed its previously announced acquisition of Widget Robotics, Inc., a maker of machine-vision sensors, for $210 million in cash.' + PAD;
    const core = readFilingText({ subject: 'Business update — Regulation FD', text, market: 'US', date: '2026-09-25' });
    assert.equal(core.kind, 'Acquisition');
    assert.equal(core.strongKind, true);
    const f = usFiling({ title: 'Business update — Regulation FD', origin: 'ledger-doc' });
    const r = buildRecentCatalysts([f], TODAY, { market: 'US', reads: { [f.url!]: { ...rd(f.url!, {}), ...core } as FilingRead } });
    const e = all(r)[0];
    assert.equal(e.type, 'Acquisition');
    assert.ok(e.card!.chain && e.card!.chain[0].label === 'DEAL');
  });
  test('a bank regulatory-capital table is rejected — the subject is shown, still typed Acquisition by Item 2.01', () => {
    const text = 'Tier 1 Capital to Risk-Weighted Assets 12.1% 11.8% Well Capitalized Minimum of 10% for capital adequacy purposes, the acquisition of Harbor Bank added $73.8 million in deposits. Common Equity Tier 1 capital ratio 11.2%.' + PAD;
    const core = readFilingText({ subject: '8-K: Completion of acquisition or disposition of assets [Item 2.01, 9.01]', text, market: 'US' });
    assert.equal(core.kind, 'Acquisition');
    assert.equal(core.line, null);
    assert.equal(core.lowConfidence, true);
  });
  test('"Pricing of Upsized $125,000,000 Offering of Senior Notes" → Fund raise (debt), $125 mn, no dilution', () => {
    const text = 'Zzlb Announces Pricing of Upsized $125,000,000 Offering of Senior Notes. Zzlb, Inc. today announced the pricing of its upsized offering of $125,000,000 aggregate principal amount of 8.50% senior notes due 2031.' + PAD;
    const core = readFilingText({ subject: '8-K: Other events [Item 8.01, 9.01]', text, market: 'US' });
    assert.equal(core.kind, 'Fund raise');
    assert.match(String(core.line), /\$125 mn/);
    const f = usFiling({ title: '8-K: Other events [Item 8.01, 9.01]' });
    const e = all(buildRecentCatalysts([f], TODAY, { market: 'US', reads: { [f.url!]: { ...rd(f.url!, {}), ...core } as FilingRead } }))[0];
    assert.equal(e.type, 'Fund raise');
    assert.match(e.card!.evidence, /debt offering — notes, no new shares/);
  });
  test('a statistical footnote (p<0.001) in a non-drug filing is not clinical data', () => {
    const text = 'Zzasth reported that same-store sales rose 7% in the quarter. Customer satisfaction scores improved versus the prior year (p<0.001), based on an independent survey of 12,000 households.' + PAD;
    const core = readFilingText({ subject: '8-K: Other events [Item 8.01, 9.01]', text, market: 'US' });
    assert.ok(!/Clinical trial/.test(String(core.line)), String(core.line));
    const bio = 'Zzbio announced positive topline results from its Phase 3 trial: the study met its primary endpoint with statistical significance (p<0.001) versus placebo in 420 patients.' + PAD;
    assert.match(String(readFilingText({ subject: '8-K: Other events [Item 8.01, 9.01]', text: bio, market: 'US' }).line), /Clinical trial results/);
  });
});

// ── 5. materiality scales to the company ───────────────────────────────────
describe('5 · US materiality relative to revenue', () => {
  test('≥ 5% of annual revenue Material, ≥ 1% Notable, else Minor; under $1 mn Minor', () => {
    assert.equal(usMateriality('Order win', 'Material', 'Contract: $100 mn design win', FX), 'Material');   // 100 / 652 = 15%
    assert.equal(usMateriality('Order win', 'Material', 'Contract: $10 mn award', FX), 'Notable');          // 1.5%
    assert.equal(usMateriality('Order win', 'Material', 'Contract: $3 mn award', FX), 'Minor');             // 0.5%
    assert.equal(usMateriality('Capex / capacity', 'Material', 'Capex $500,000', FX), 'Minor');
    assert.equal(usMateriality('Capex / capacity', 'Material', 'Capex $500,000', null), 'Minor');
  });
  test('a vague guidance fragment (no metric + direction) is Minor', () => {
    assert.equal(usMateriality('Guidance', 'Material', 'Guidance: approximately 5%', FX), 'Minor');
    assert.equal(usMateriality('Guidance', 'Material', 'Guidance raised: full-year revenue now $640 mn to $660 mn', FX), 'Material');
  });
  test('in the tab: ESP-style "Capex $500,000" is not Material', () => {
    const f = usFiling({ title: '8-K: Other events [Item 8.01, 9.01]' });
    const e = all(buildRecentCatalysts([f], TODAY, { market: 'US', facts: { ZZUS: { ...FX, revenue_curr_musd: 40 } },
      reads: { [f.url!]: rd(f.url!, { kind: 'Capex / capacity', line: 'Capex / capacity expansion: capital expenditure of $500,000 for new tooling' }) } }))[0];
    assert.notEqual(e.importance, 'Material');
  });
});

// ── 6. US units ────────────────────────────────────────────────────────────
describe('6 · US units — table scale, $ mn / bn, sub-million deltas, cash amounts', () => {
  test('the filing\'s "(in thousands)" scale; "N thousand"; raw dollars', () => {
    assert.equal(usTableScale('CONSOLIDATED BALANCE SHEETS (in thousands, except per share data)'), 'thousand');
    assert.equal(usScaleAmounts('Goodwill impairment of $30,934 recorded', 'thousand'), 'Goodwill impairment of $30.9 mn recorded');
    assert.equal(usScaleAmounts('Goodwill impairment of $30,934 recorded', null), 'Goodwill impairment of $30,934 recorded', 'no stated scale → never guessed');
    assert.equal(tidyFigure('$21,803 thousand', 'US'), '$21.8 mn');
    assert.equal(tidyFigure('48,688 thousand → 55,906 thousand', 'US'), '48.7 mn → 55.9 mn');
    assert.equal(usScaleAmounts('$125,000,000 of notes'), '$125 mn of notes');
    assert.equal(usScaleAmounts('EPS $0.84 per share'), 'EPS $0.84 per share');
    assert.equal(usdShort(96), '$96');
    assert.equal(usdAmountIn('Capex $500,000'), 500000);
  });
  test('a sub-million delta is written in dollars: +$96, never +$0 mn', () => {
    assert.equal(formatDeltaAbs(0.000096, 'USD million'), '+$96');
    assert.equal(formatDeltaAbs(-0.045, 'USD million'), '−$45,000');
    assert.equal(formatDeltaAbs(12.34, 'USD million'), '+$12.3 mn');
  });
  test('"Cash conversion $46.0M (three months ended …)" is operating cash flow, not a ratio', () => {
    const f = usFiling({ title: 'Quarterly report — Form 10-Q', origin: 'ledger-doc', url: sec(acc(), 'q10.htm') });
    const ev: RawEvent = { ...f, origin: 'ledger-event', variable: 'cash_conversion', direction: 'up', after: '$46.0M (three months ended June 30, 2026)', figure: '$46.0M (three months ended June 30, 2026)',
      text: 'Cash conversion: $46.0M (three months ended June 30, 2026)', quote: 'Net cash provided by operating activities was $46.0 million for the three months ended June 30, 2026.' };
    const e = all(buildRecentCatalysts([f, ev], TODAY, { market: 'US' })).find((x) => x.ticker === 'ZZUS')!;
    assert.match(e.what, /^Operating cash flow \$46\.0 mn \(3 months\)/);
    assert.ok(!/cash conversion/i.test(e.what));
    assert.notEqual(e.card!.delta.kind, 'change', 'an amount is never a cash-conversion change');
  });
  test('a cash ratio off a tiny profit is labelled "profit small vs cash"', () => {
    const row = usGradedRow('ZZACT', { q_end: '2026-06-30', q_end_prev: '2025-06-30', q_filed: '2026-08-05', revenue: 200e6, revenue_prev: 180e6,
      operating_income: 3e6, operating_income_prev: 2e6, net_income: 1e6, net_income_prev: 0.8e6, eps: 0.01, eps_prev: 0.01, cfo: 83.06e6 })!;
    assert.equal(row.cfo_to_pat_ratio, 83.06);
    assert.match(String(row.cfo_to_pat_note), /profit small vs cash/);
    const ok = usGradedRow('ZZOK', { q_end: '2026-06-30', q_end_prev: '2025-06-30', q_filed: '2026-08-05', revenue: 200e6, revenue_prev: 180e6,
      operating_income: 40e6, operating_income_prev: 30e6, net_income: 30e6, net_income_prev: 20e6, eps: 1, eps_prev: 0.7, cfo: 36e6 })!;
    assert.equal(ok.cfo_to_pat_note, undefined);
  });
});

// ── 7. boilerplate is not evidence ─────────────────────────────────────────
describe('7 · risk-factor / hypothetical / description sentences are not evidence', () => {
  const cases: Array<[string, string]> = [
    ['new_customer', 'Changes to recurring revenue may result from pricing changes, upsells and new customer acquisition.'],
    ['new_customer', 'Capital expenditures may change due to regulatory decisions and new customer growth.'],
    ['new_plant', 'Our Industrial segment provides on-site services that support new plant construction and maintenance.'],
    ['new_plant', 'In addition to a land rights and building purchase agreement, the company holds equity in joint ventures in China.'],
    ['new_plant', 'Mercury Financial LLC'],
    ['new_customer', 'On August 1, the Company entered into an agreement with Zz Holdings to sell its dormant exchange for $2.0 million.'],
    ['new_customer', 'The bank added $73.8 million in new customer non-maturity deposits during the quarter.'],
  ];
  for (const [v, s] of cases) test(`not evidence: ${s.slice(0, 60)}`, () => assert.ok(usBoilerplateEvidence(v, s), s));
  test('a real event still is', () => {
    assert.equal(usBoilerplateEvidence('new_customer', 'Zzus signed a multi-year supply agreement with a top-five automaker.'), null);
    assert.equal(usBoilerplateEvidence('new_plant', 'Zzus opened its new 200,000 sq ft manufacturing facility in Texas in July.'), null);
    assert.equal(usBoilerplateEvidence('order_book', 'Backlog was $128.4 million at quarter end.'), null);
  });
  test('the sanitizer drops them (AI read, deterministic read, stored det records, summaries)', () => {
    const evs = sanitizeUsEvents([
      { variable: 'new_customer', after: 'new customer acquisition', evidence_text: cases[0][1] },
      { variable: 'new_plant', after: 'Mercury Financial LLC', evidence_text: 'Mercury Financial LLC' },
      { variable: 'new_customer', after: 'signed a supply agreement', evidence_text: 'Zzus signed a multi-year supply agreement with a top-five automaker.' },
    ] as any[]);
    assert.equal(evs.length, 1);
    const sum = sanitizeUsSummary({ capacity: { new_plant: 'Mercury Financial LLC' } }).summary;
    assert.equal(sum.capacity.new_plant, '');
    const det: any = { v: US_DET_VERSION, events: [{ variable: 'new_customer', after: 'x', evidence_text: cases[1][1], value_type: 'ACTUAL' }] };
    assert.equal(withUsDetEvidence(null, det), null, 'a stored boilerplate row is re-checked and dropped');
  });
  test('in the tab: a boilerplate ledger event is not an event', () => {
    const f = usFiling({ title: 'Quarterly report — Form 10-Q', origin: 'ledger-doc', url: sec(acc(), 'q10b.htm') });
    const ev: RawEvent = { ...f, origin: 'ledger-event', variable: 'new_customer', direction: 'up', text: `New customer — “${cases[0][1]}”`, quote: cases[0][1] };
    const e = all(buildRecentCatalysts([f, ev], TODAY, { market: 'US' })).find((x) => x.ticker === 'ZZUS');
    assert.ok(!e || !/new customer acquisition/.test(e.what));
  });
  test('the US read / evidence versions are bumped so cached reads re-read; India stays on r3', () => {
    assert.equal(US_DET_VERSION, 2);
    assert.equal(filingReadVersion('US'), 'r4-us');
    assert.equal(filingReadVersion('IN'), 'r3');
    assert.equal(FILING_READ_VERSION, 'r3');
    assert.match(read('components/catalyst/use-filing-reads.ts'), /r4-us/);
    assert.match(read('app/api/v1/catalyst/read-filings/route.ts'), /filingReadVersion\(market\)/);
  });
});

// ── 8. stale XBRL period ───────────────────────────────────────────────────
describe('8 · the card\'s XBRL quarter is refreshed, or the card says it is not the latest', () => {
  const recent = [
    { form: '8-K', filingDate: '2026-08-06', reportDate: '2026-08-06' },
    { form: '10-Q', filingDate: '2026-08-07', reportDate: '2026-06-30' },
    { form: '10-Q', filingDate: '2026-05-08', reportDate: '2026-03-31' },
  ];
  test('the newest 10-Q on EDGAR is found; an older XBRL quarter is said in words', () => {
    const l = latestPeriodic(recent)!;
    assert.deepEqual(l, { form: '10-Q', filed: '2026-08-07', report_date: '2026-06-30' });
    assert.match(String(xbrlBehindNote({ q_end: '2026-03-31' }, l)), /10-Q for the period ended 2026-06-30 .* not in the SEC data yet/);
    assert.equal(xbrlBehindNote({ q_end: '2026-06-30' }, l), null);
  });
  test('a cached row is re-fetched when it is behind, or when a newer quarter should be filed', () => {
    const now = Date.parse('2026-09-28T00:00:00Z');
    assert.equal(usFactsRowStale({ source: 'sec-xbrl', q_end: '2026-03-31', xbrl_behind: 'x', fetched_at: '2026-09-27T00:00:00Z' }, now), true);
    assert.equal(usFactsRowStale({ source: 'sec-xbrl', q_end: '2026-06-30', fetched_at: '2026-09-27T23:00:00Z' }, now), false);
    assert.equal(usFactsRowStale({ source: 'sec-xbrl', q_end: '2026-03-31', fetched_at: '2026-09-27T00:00:00Z' }, now), true);
    assert.equal(US_FACTS_KEY('ZZ'), 'us-thesis:facts:v5:ZZ');
  });
  test('the US card header prints the warning', () => {
    assert.match(read('app/(dashboard)/us-portfolio-catalysts/page.tsx'), /us-xbrl-behind/);
  });
});

// ── 9. BOOK filter on the US tab ───────────────────────────────────────────
describe('9 · the US tab has the BOOK filter (All / My Book / Conviction Beats)', () => {
  test('the tab renders it when holdingOf is passed, with US wording', () => {
    const f = usFiling({ title: '8-K: Other events [Item 8.01, 9.01]' });
    const r = buildRecentCatalysts([f], TODAY, { market: 'US', reads: { [f.url!]: rd(f.url!, { kind: 'Order win', line: 'Major contract / order: Zzus was selected for a $100 mn design win' }) } });
    const html = renderToStaticMarkup(React.createElement(NewCatalystsTab, { result: r, loading: false, names: 1, sourceNotes: [], market: 'US', holdingOf: () => 'book' as const }));
    assert.match(html, /My Book \(1\)/);
    assert.match(html, /US Conviction Beats names you do not hold/);
  });
  test('the US page passes holdingOf (book vs bench) and its SEC XBRL facts', () => {
    const page = read('app/(dashboard)/us-portfolio-catalysts/page.tsx');
    assert.match(page, /holdingOf=\{\(t\) => \{ const r = all\.find/);
    assert.match(page, /facts: factsMap/);
  });
});
