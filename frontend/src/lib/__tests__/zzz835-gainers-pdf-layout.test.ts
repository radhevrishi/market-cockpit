// zzz835 — AI Daily Gainers PDF: compact layout, provisional banner, parity, text safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { jsPDF } from 'jspdf';
import { buildGainersPdf, pdfText, type GainersPdfInput } from '../ai-gainers/gainers-pdf';
import type { ResearchItem, ResearchView } from '../ai-gainers/research-view';
import { indiaPdfView, usPdfView, PDF_GENERATED_AT } from './fixtures/zzz800-gainers-pdf.fixture';

/** Every string drawn on every page, in draw order. */
function drawnStrings(doc: jsPDF): string[] {
  const buf = Buffer.from(doc.output('arraybuffer'));
  const bin = buf.toString('latin1');
  let raw = '';
  const sre = /stream\r?\n/g;
  let sm: RegExpExecArray | null;
  while ((sm = sre.exec(bin))) {
    const start = sm.index + sm[0].length;
    const end = bin.indexOf('endstream', start);
    if (end < 0) break;
    try { raw += inflateSync(buf.subarray(start, end)).toString('latin1') + '\n'; } catch { raw += bin.slice(start, end) + '\n'; }
    sre.lastIndex = end + 9;
  }
  const out: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[0].slice(1, m[0].lastIndexOf(')')).replace(/\\([()\\])/g, '$1').replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))));
  return out;
}
const flow = (doc: jsPDF) => drawnStrings(doc).join(' ').replace(/\s+/g, ' ');
const build = (p: Partial<GainersPdfInput> & Pick<GainersPdfInput, 'view' | 'market'>) => buildGainersPdf(jsPDF as any, { generatedAt: PDF_GENERATED_AT, ...p });

/** A 15-card queue made from the fixture cards (distinct tickers), to exercise paging. */
function bigView(base: ResearchView): ResearchView {
  const src = base.queue.length ? base.queue : base.watch;
  const queue: ResearchItem[] = [];
  for (let i = 0; i < 15; i++) { const o = src[i % src.length]; queue.push({ ...o, ticker: `${o.ticker}${i}`, displayTicker: `${o.displayTicker || o.ticker} ${i}` }); }
  return { ...base, queue, top3: queue.slice(0, 3) };
}
// Overrides the scan facts AND drops the derived run fields, so the PDF's own rules are what is tested.
const withSession = (v: ResearchView, session: Partial<ResearchView['session']>): ResearchView => {
  const { sessionDate, generatedAt, dataAsOf, timezone, sessionStatus, isFinal, marketCloseAt, runReason, ...rest } = v.session;
  return { ...v, session: { ...rest, ...session } };
};

test('compact: 15 cards take clearly fewer pages than one page per card', () => {
  for (const [v, market] of [[bigView(indiaPdfView()), 'IN'], [bigView(usPdfView()), 'US']] as Array<[ResearchView, 'IN' | 'US']>) {
    const doc = build({ view: v, market });
    assert.ok(doc.getNumberOfPages() < 15 + 4, `pages ${doc.getNumberOfPages()} must beat one-card-per-page`);
    
    assert.ok(doc.getNumberOfPages() <= 11, `pages ${doc.getNumberOfPages()} should be compact`);
  }
});

test('US live scan: PROVISIONAL line at the top and a tag on every page footer', () => {
  const v = withSession(usPdfView(), { status: 'Live', scanAt: '2026-09-24T19:43:00.000Z', date: '2026-09-24' });
  const doc = build({ view: bigView(v), market: 'US' });
  const strings = drawnStrings(doc);
  assert.ok(strings.some((s) => /PROVISIONAL - prices and rank can change until the close at 16:00 ET/.test(s)));
  assert.equal(strings.filter((s) => s === 'PROVISIONAL').length, doc.getNumberOfPages(), 'one footer tag per page');
});

test('US scan before the 16:00 ET close is provisional even when status is not "Live"', () => {
  const v = withSession(usPdfView(), { status: 'Last completed session', scanAt: '2026-09-24T19:43:00.000Z', date: '2026-09-24' });
  assert.match(flow(build({ view: v, market: 'US' })), /PROVISIONAL/);
});

test('US closed session and India: no PROVISIONAL anywhere', () => {
  const us = withSession(usPdfView(), { status: 'Last completed session', scanAt: '2026-09-24T21:12:00.000Z', date: '2026-09-24' });
  assert.doesNotMatch(flow(build({ view: us, market: 'US' })), /PROVISIONAL/);
  const inn = withSession(indiaPdfView(), { status: 'Last completed session', scanAt: '2026-09-29T01:13:00.000Z', date: '2026-09-28' });
  assert.doesNotMatch(flow(build({ view: inn, market: 'IN' })), /PROVISIONAL/);
});

test('India completed session: Session date and Generated are separate labelled rows', () => {
  const inn = withSession(indiaPdfView(), { status: 'Last completed session', scanAt: '2026-09-29T01:13:00.000Z', date: '2026-09-28' });
  const s = drawnStrings(build({ view: inn, market: 'IN' }));
  assert.ok(s.includes('SESSION DATE'));
  assert.ok(s.includes('GENERATED'));
  assert.ok(s.includes('SCAN TIME'));
  assert.ok(s.includes('STATUS'));
  assert.ok(s.some((x) => /28 Sep 2026 \(India date\)/.test(x)));
});

test('US document has no rupee sign and no India wording', () => {
  const t = flow(build({ view: bigView(usPdfView()), market: 'US' }));
  assert.doesNotMatch(t, /₹|\bRs\b|\bNSE\b|\bBSE\b|\blakh\b|\bcrore\b/i);
});

test('no lone "-" cell, and a missing company falls back to the display name', () => {
  const v = indiaPdfView();
  const noCo = (it: ResearchItem): ResearchItem => ({ ...it, company: '' as any });
  const view: ResearchView = { ...v, queue: v.queue.map(noCo), watch: v.watch.map(noCo), noCatalyst: v.noCatalyst.map(noCo), context: (v.context || []).map(noCo), dataQuality: v.dataQuality.map(noCo) };
  const doc = build({ view, market: 'IN' });
  const t = flow(doc);
  // Table cells only: the cards' "- item" bullets are drawn as their own word, so leave the cards out.
  const tablesOnly = build({ view: { ...view, queue: [], top3: [] }, market: 'IN' });
  assert.ok(!drawnStrings(tablesOnly).some((s) => s.trim() === '-'), 'no bare dash is drawn in a table cell');
  const first = view.queue[0];
  const name = first.displayTicker || first.ticker;
  assert.ok(t.split(name).length - 1 >= 2, 'the name is printed in the Ticker and the Company cells');
});

test('en-dash ranges and smart quotes survive as plain ASCII', () => {
  assert.equal(pdfText('growth of 28–30% guided'), 'growth of 28-30% guided');
  assert.equal(pdfText('“quoted” it’s'), '"quoted" it\'s');
  assert.equal(pdfText('a — b'), 'a - b');
  assert.equal(pdfText('≥ 5 and −3'), '>= 5 and -3');
  const v = indiaPdfView();
  const q0 = { ...v.queue[0], headline: 'Guides revenue growth of 28–30% for FY27' };
  const t = flow(build({ view: { ...v, queue: [q0, ...v.queue.slice(1)], top3: [q0] }, market: 'IN' }));
  assert.match(t, /28-30%/);
});

test('catalysts-by-category line renders for both markets when cards carry catalysts', () => {
  assert.match(flow(build({ view: usPdfView(), market: 'US' })), /Catalysts found by category/);
  const inn = indiaPdfView();
  if (inn.queue.some((i) => i.inCard)) assert.match(flow(build({ view: inn, market: 'IN' })), /Catalysts found by category/);
});

// ── view data wired in (synthetic) ──
const item0 = (v: ResearchView) => v.queue[0];
const withItem = (v: ResearchView, patch: Partial<ResearchItem>): ResearchView => ({ ...v, queue: [{ ...item0(v), ...patch }, ...v.queue.slice(1)], top3: [{ ...item0(v), ...patch }] });

test('session.isFinal === false makes any market PROVISIONAL; isFinal === true does not', () => {
  const us = withSession(usPdfView(), { status: 'Last completed session', scanAt: '2026-09-24T21:12:00.000Z', date: '2026-09-24', isFinal: false });
  assert.match(flow(build({ view: us, market: 'US' })), /PROVISIONAL/);
  const fin = withSession(usPdfView(), { status: 'Live', scanAt: '2026-09-24T19:00:00.000Z', date: '2026-09-24', isFinal: true });
  assert.doesNotMatch(flow(build({ view: fin, market: 'US' })), /PROVISIONAL/);
});

test('banner rows: session date, generated, data as of, criteria, counts strip with conflicts', () => {
  const v = { ...withSession(indiaPdfView(), { sessionDate: '2026-09-28', generatedAt: '2026-09-29T02:00:00.000Z', dataAsOf: '2026-09-28T10:00:00.000Z', isFinal: true }),
    scanCriteria: 'screener.in screen X', banner: { market: 'IN' as const, scanned: 43, verified: 2, unverified: 21, conflicts: 3, noMaterialCatalyst: 16, negative: 1, provisional: false } };
  const t = flow(build({ view: v, market: 'IN' }));
  assert.match(t, /SESSION DATE/); assert.match(t, /DATA AS OF/); assert.match(t, /07:30 IST, 29 Sep 2026/); assert.match(t, /15:30 IST, 28 Sep 2026/);
  assert.match(t, /SCAN CRITERIA/); assert.match(t, /screener\.in screen X/);
  assert.match(t, /Scanned 43 · Verified events 2 · Unverified 21 · Conflicts 3 · No material catalyst 16/);
});

test('cards: rank reason, stage, conflict box, context only, litigation, clinical, acquisition, cluster', () => {
  const v = withItem(usPdfView(), {
    rankReason: 'Evidence 3, mechanism 2, materiality 1', stageBadge: 'SIGNED' as any, contextOnly: true, causalLabel: 'Filed 5 days before the move - context only',
    conflicts: ['Headline says $50M, the filing says $5M'], conflictValues: [{ text: '$50M', source: 'headline' }, { text: '$5M', source: '8-K' }],
    litigationNote: 'Gross award is not expected cash proceeds.', clinical: { lines: ['Effect size: 54%', 'P-value: not disclosed in the cited filing'], notDisclosed: ['pValue'] } as any,
    acquisition: { purchasePrice: '$40M', upfrontCash: '$30M', contingentConsideration: '', assumedLiabilities: '', financing: 'cash on hand', expectedContribution: '' } as any,
    clusters: [{ clusterId: 'c1', label: 'Fiscal 2026 results', sentence: 'Revenue was $849M.', source: 'SEC 8-K', independentSources: 1, children: [{ label: 'Revenue', sentence: 'Revenue $849M', figures: ['$849M'] }, { label: 'Net income', sentence: 'Net income $12M', figures: [] }] }],
  });
  const t = flow(build({ view: v, market: 'US' }));
  for (const re of [/WHY RANKED/, /Evidence 3, mechanism 2/, /STAGE SIGNED/, /CONTEXT ONLY/, /VALUES CONFLICT/, /\$50M/, /\$5M/, /Gross award is not expected cash proceeds/, /CLINICAL/, /P-value: not disclosed/, /ACQUISITION ECONOMICS/, /PURCHASE PRICE/, /Not disclosed/, /CLUSTER/, /Fiscal 2026 results/, /Net income/]) assert.match(t, re);
  assert.match(t, /WHY RANKED/);
});

test('empty catalysts print the view sentence with what was searched', () => {
  const base = indiaPdfView();
  const it = base.queue.find((i) => i.inCard) || base.queue[0];
  const v = withItem({ ...base, queue: [{ ...it, inCard: it.inCard ? { ...it.inCard, catalysts: [], backdrop: null, clarification: null } : it.inCard } as ResearchItem, ...base.queue.slice(1)] }, { catalystStatusSentence: 'Event found (Order win), not verified in an official filing - searched BSE filings, press over the last 14 days.', clusters: [] });
  if (v.queue[0].inCard) assert.match(flow(build({ view: v, market: 'IN' })), /searched BSE filings, press over the last 14 days/);
});

test('view.summary.catalysts, olderFilings, dataNotes, bookChecked and companyName are printed', () => {
  const b = usPdfView();
  const v: ResearchView = { ...b,
    summary: { ...b.summary, conflicts: 2, catalysts: { market: 'US', found: 4, none: 3, byCategory: [{ category: 'Earnings', names: 4, sec: 3, press: 1, tickers: [] }] } },
    olderFilings: [{ ticker: 'OLDX', name: 'OLDX', company: 'Old Corp', movePct: 6, filedDate: '2026-08-01', ageDays: 40, event: 'Old order', eventLabel: 'Contract', material: 'SMALL', url: null, moveDate: '2026-09-24' }],
    dataNotes: [{ ticker: 'NEWL', name: 'NEWL', company: 'New Listing Inc', movePct: 80, kind: 'new_listing', text: 'No prior close to compare' }],
    portfolio: [], bookChecked: { held: 5, watch: 2 },
    queue: b.queue.map((i, k) => (k === 0 ? { ...i, companyName: 'Named By View Corp' } : i)) };
  const t = flow(build({ view: v, market: 'US' }));
  assert.match(t, /Earnings 4 \(1 press only\)/); assert.match(t, /CONFLICTS IN THE EVIDENCE/);
  assert.match(t, /Old Corp/); assert.match(t, /DATA NOTES/); assert.match(t, /No prior close to compare/);
  assert.match(t, /Checked 5 held and 2 watched names/); assert.match(t, /Named By View Corp/);
});
