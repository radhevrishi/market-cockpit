// zzz916 — Q1 FY27 concall guidance the page missed (owner's InvestorStack comparison, 04 Sept 2026 list).
// Run: npx tsx --test src/lib/__tests__/zzz916-concall-guidance.test.ts
// No network: fetch, pdftotext and KV are injected fakes. Phrasings are InvestorStack's, verbatim.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  horizonOf, perYearStated, isLowBoundOnly, multipleOf, cagrPct, lastCompletedFy, scopeIssueOf, isIntimationLetter, LONG_TERM_LABEL, MEDIUM_TERM_LABEL,
} from '../guidance-horizon';
import { checkRows, checkPriorActual, hasForwardNumber, extractDoc, planQueue, type Availability } from '../ai-guidance-extract';
import { buildUniverse, itemsFromExtracted, displayOf, type GuUniverseRecordX } from '../guidance-universe';
import { actualKey, actualsFromDocs, baseFyFor, type PriorActual } from '../guidance-extract-reader';
import { growthQuoteIssue } from '../guidance-growth-quote';
import {
  ingestDocs, validateIngestBody, markExtracted, pendingIntimations, mergeIndex, DOCS_INDEX_KEY, DOCS_INDEX_META_KEY, DOCS_INDEX_LOCK_KEY, INTIMATIONS_KEY,
  DocsIndexUnreadableError, type DocsKv,
} from '../guidance-docs-store';
import {
  emptyQueue, enqueue, delegateIndiaToCollector, selectDue, awaitingCount, reportQueue, collectorQueueTickers, bound, type QueueState,
} from '../guidance-upgrades-queue';
import type { ExtractedGuidance, GuidanceDoc, GuidanceDocIndexRow, GuidanceExtractResult } from '../guidance-docs-types';

const SCRIPTS = join(__dirname, '..', '..', '..', '..', '.github', 'scripts');
const libPath = pathToFileURL(join(SCRIPTS, 'guidance-docs-lib.mjs')).href;
const runnerPath = pathToFileURL(join(SCRIPTS, 'scrape-guidance-docs.mjs')).href;
const sha20 = (u: string) => createHash('sha1').update(u).digest('hex').slice(0, 20);

// ── InvestorStack phrasings (verbatim) ───────────────────────────────────────
const P = {
  MOBAVENUE: 'Management targets 30%+ revenue growth annually in the long term.',
  SUNRAKSHAK: 'Management expects 30-35% CAGR in revenue between FY25 and FY29.',
  FREDUN: 'Management expects blended revenue growth of 30-35% over the next 2 years.',
  BAROEXT: 'Management expects minimum 35-40% revenue growth for FY27.',
  KPL: 'Management expects 25-30% revenue growth in FY28.',
  CCAVENUE: 'Management expects revenue growth of ~35%+ in FY27.',
  VOEPL: 'Management expects 35-40% revenue growth in FY27.',
  UTLSOLAR: 'Management expects revenue growth of 70% in FY27.',
  GKENERGY: 'Management expects revenue to double in FY27.',
  SBCL: 'Management expects 20-30% revenue growth in FY27.',
  ATLANTAELE: 'Management targets Revenue 40% CAGR over the next three years.',
  EMERALD: 'Management expects PAT growth of 40-50% CAGR in the next 2-3 years.',
  BRPL: 'Management expects revenue growth of 25-32% in FY27.',
  JSLL: 'Management expects 30% YoY revenue growth in FY27.',
  AEQUS: 'Management expects 45-50% revenue growth in FY27.',
  BMW: 'Management targets 70-75% revenue CAGR for FY25-FY28.',
  ARSSBL: 'Management targets PAT growth of 30% to 35% in FY27.',
  FROG: 'Management targets FY27 revenue to recover to approximately Rs 220 crore from FY26 base of Rs 106 crore.',
  GHCLTEXTIL: 'Management targets doubling revenue to Rs.2,000 crores by FY29.',
  UFLEX: 'Management expects 35% revenue and EBITDA growth for FY27 and FY28.',
  SOUTHWEST: 'Management targets revenue CAGR of 20% over the medium term.',
  // unsuitable as company revenue growth
  FCL: 'Management targets US CrudeChem revenue to reach $100M in FY27 and $200M by FY28.',
  REGENCY: 'Management targets AUM growth of nearly 60% to INR500-550 crores by FY27.',
  SOBHA: 'Management targets at least 30% pre-sales growth in FY27.',
  ARVSMART: 'Management expects 35-40% bookings growth in FY27.',
  EQUITAS: 'Management expects 20%+ advances growth in FY27.',
  KSHINTL: 'Management expects FY27 volume growth of 26%.',
  TAC: 'Management expects 20% quarter-on-quarter revenue growth in Q1 FY27.',
  SAPPHIRE: 'Management targets KFC store count to double over a five-year horizon.',
  CMSINFO: 'Management expects Tech & Payments revenue to grow 35-40% in FY27.',
};
const SUITABLE = ['MOBAVENUE', 'SUNRAKSHAK', 'FREDUN', 'BAROEXT', 'KPL', 'CCAVENUE', 'VOEPL', 'UTLSOLAR', 'GKENERGY', 'SBCL', 'ATLANTAELE', 'EMERALD', 'BRPL', 'JSLL', 'AEQUS', 'BMW', 'ARSSBL', 'FROG', 'GHCLTEXTIL', 'UFLEX', 'SOUTHWEST'] as const;

// ── pure helpers ─────────────────────────────────────────────────────────────

describe('zzz916 horizon / bound / multiple / scope helpers', () => {
  test('horizons with no year named', () => {
    assert.deepEqual(horizonOf(P.FREDUN), { label: 'Next 2 years', years: 2, kind: 'NEXT_N_YEARS' });
    assert.equal(horizonOf(P.ATLANTAELE)!.label, 'Next 3 years');
    assert.equal(horizonOf(P.EMERALD)!.label, 'Next 3 years', '"next 2-3 years" → the full span');
    assert.equal(horizonOf('Management expects 40% CAGR over 3 years.')!.label, 'Next 3 years');
    assert.equal(horizonOf('a 3-year revenue CAGR of 25%')!.label, 'Next 3 years');
    assert.equal(horizonOf(P.MOBAVENUE)!.label, LONG_TERM_LABEL);
    assert.equal(horizonOf(P.SOUTHWEST)!.label, MEDIUM_TERM_LABEL);
    assert.equal(horizonOf(P.VOEPL), null);
  });
  test('per-year wording', () => {
    for (const k of ['MOBAVENUE', 'SUNRAKSHAK', 'ATLANTAELE', 'EMERALD', 'BMW', 'SOUTHWEST', 'JSLL'] as const) assert.ok(perYearStated(P[k]), k);
    assert.equal(perYearStated(P.FREDUN), false, '"over the next 2 years" alone does not say per year');
  });
  test('open-ended figures: 30%+, ~35%+, minimum 35%, at least 30% — but "minimum 35-40%" is a range', () => {
    assert.ok(isLowBoundOnly(P.MOBAVENUE, 30));
    assert.ok(isLowBoundOnly(P.CCAVENUE, 35));
    assert.ok(isLowBoundOnly('Management expects revenue growth of minimum 35% in FY27.', 35));
    assert.ok(isLowBoundOnly(P.SOBHA, 30));
    assert.ok(isLowBoundOnly(P.EQUITAS, 20));
    assert.equal(isLowBoundOnly(P.BAROEXT, 35), false);
    assert.equal(isLowBoundOnly(P.VOEPL, 35), false);
  });
  test('multiples, CAGR, fiscal years', () => {
    assert.equal(multipleOf(P.GKENERGY), 2); assert.equal(multipleOf(P.GHCLTEXTIL), 2); assert.equal(multipleOf('3x top-line growth'), 3);
    assert.equal(multipleOf(P.VOEPL), null);
    assert.equal(cagrPct(2000, 1000, 3), 26);
    assert.equal(cagrPct(2000, 1000, 0), null);
    assert.equal(lastCompletedFy('2026-08-13'), 26); assert.equal(lastCompletedFy('2026-03-20'), 25);
    assert.equal(baseFyFor('FY29', '2026-08-13'), 'FY26'); assert.equal(baseFyFor('FY27', '2026-08-13'), null); assert.equal(baseFyFor('FY28', '2026-08-13'), 'FY26');
  });
  test('scope: segment, foreign-currency, AUM, pre-sales, bookings, advances, volume, stores, QoQ are not company revenue; the suitable ones are', () => {
    for (const k of SUITABLE) assert.equal(scopeIssueOf(P[k], { metric: /PAT/.test(P[k]) ? 'PAT' : 'REVENUE', market: 'IN', currency: 'INR' }), null, k);
    assert.match(scopeIssueOf(P.FCL, { metric: 'REVENUE', market: 'IN', currency: 'USD' })!, /one part of the company \(US CrudeChem revenue\)/);
    assert.match(scopeIssueOf('Our US subsidiary revenue will reach $100 million in FY27.', { metric: 'REVENUE', market: 'IN', currency: 'USD' })!, /part of the company|USD figure/);
    assert.match(scopeIssueOf('We expect revenue of $100 million in FY27.', { metric: 'REVENUE', market: 'IN', currency: 'USD' })!, /USD figure from an Indian company/);
    assert.match(scopeIssueOf(P.REGENCY, { metric: 'REVENUE' })!, /AUM/);
    assert.match(scopeIssueOf(P.SOBHA, { metric: 'REVENUE' })!, /pre-sales/);
    assert.match(scopeIssueOf(P.ARVSMART, { metric: 'REVENUE' })!, /bookings/);
    assert.match(scopeIssueOf(P.EQUITAS, { metric: 'REVENUE' })!, /advances/);
    assert.match(scopeIssueOf(P.KSHINTL, { metric: 'REVENUE' })!, /volume/);
    assert.match(scopeIssueOf(P.SAPPHIRE, { metric: 'REVENUE' })!, /store/);
    assert.match(scopeIssueOf(P.TAC, { metric: 'REVENUE' })!, /quarter-on-quarter/);
    assert.match(scopeIssueOf(P.CMSINFO, { metric: 'REVENUE' })!, /Tech & Payments/);
    // revenue "driven by volume growth" is still revenue; the company's own camel-case name is not "a part"
    assert.equal(scopeIssueOf('Management expects revenue growth of 20% in FY27 driven by volume growth.', { metric: 'REVENUE' }), null);
    assert.equal(scopeIssueOf('We expect AvenuesAI revenue to grow ~35%+ in FY27.', { metric: 'REVENUE', company: 'AvenuesAI Ltd' }), null);
  });
  test('growthQuoteIssue: pre-sales, bookings, stores and QoQ are not revenue growth', () => {
    assert.ok(growthQuoteIssue(P.SOBHA, 30, 30, 'REVENUE', { annual: true }));
    assert.ok(growthQuoteIssue(P.ARVSMART, 35, 40, 'REVENUE', { annual: true }));
    assert.ok(growthQuoteIssue(P.TAC, 20, 20, 'REVENUE', { annual: true }));
    assert.equal(growthQuoteIssue(P.VOEPL, 35, 40, 'REVENUE', { annual: true }), null);
    assert.equal(growthQuoteIssue(P.SUNRAKSHAK, 30, 35, 'REVENUE', { annual: false }), null);
  });
  test('intimation letters', () => {
    const letter = 'Pursuant to Regulation 30 of SEBI (LODR), the transcript of the Earnings Conference Call held on August 13, 2026 is available on the website of the Company at https://www.uflexltd.com/investors. Kindly take the same on record.';
    assert.ok(isIntimationLetter(letter));
    assert.equal(isIntimationLetter(`Moderator: ${'We expect revenue growth of 35% in FY27 and FY28. '.repeat(200)}`), false);
    assert.equal(isIntimationLetter('Pursuant to Regulation 30 please find enclosed the presentation.'), false);
  });
});

// ── collector: free cue screen, intimations, Screener.in ─────────────────────

const SCREENER_HTML = (name: string, code: string, sym: string, rows: Array<[string, string | null, string | null]>) => `<html><head><title>${name} share price | About ${name} | Key Insights - Screener</title></head><body>
<a href="https://www.bseindia.com/stock-share-price/x/${sym}/${code}/" target="_blank">BSE: ${code}</a>
<a href="https://www.nseindia.com/get-quotes/equity?symbol=${sym}" target="_blank">NSE: ${sym}</a>
<div><h3 class="margin-0">Concalls</h3><div class="show-more-box"><ul class="list-links">
${rows.map(([lab, tr, ppt]) => `<li class="flex flex-gap-8 flex-wrap-420">
  <div class="ink-600 font-size-15 font-weight-500 nowrap" style="width: 74px">${lab}</div>
  ${tr ? `<a class="button-chip" href="${tr}" target="_blank" rel="noopener noreferrer" title="Raw Transcript">Transcript</a>` : '<div class="button-chip">Transcript</div>'}
  <button class="button-chip" type="button" data-url="/concalls/summary/1/">AI Summary</button>
  ${ppt ? `<a href="${ppt}" class="button-chip" target="_blank" rel="noopener noreferrer">PPT</a>` : '<div class="button-chip">PPT</div>'}
  <a href="http://www.example.com/rec.mp3" class="button-chip" target="_blank" rel="noopener noreferrer">REC</a>
</li>`).join('\n')}
</ul></div></div></body></html>`;

describe('zzz916 collector helpers', () => {
  test('hasGuidanceCue keeps every suitable phrasing (and "we aim to double revenue")', async () => {
    const L = await import(libPath);
    for (const k of SUITABLE) assert.ok(L.hasGuidanceCue(P[k]), k);
    assert.ok(L.hasGuidanceCue('We aim to double our revenue to Rs.2,000 crores by FY29.'));
    assert.ok(L.hasGuidanceCue('We are looking at 30-35% CAGR in revenue between FY25 and FY29.'));
  });
  test('the extractor free screen passes every suitable phrasing', () => {
    for (const k of SUITABLE) assert.ok(hasForwardNumber(P[k]), k);
  });
  test('intimation test matches the app twin; transcript-named links are candidates', async () => {
    const L = await import(libPath);
    const letter = 'The transcript of the earnings call is available on our website at https://www.ghcltextiles.co.in/investors/q1-fy27-transcript. Kindly take the same on record.';
    assert.ok(L.isIntimationText(letter)); assert.ok(isIntimationLetter(letter));
    assert.deepEqual(L.findLinkedPdfs(letter), ['https://www.ghcltextiles.co.in/investors/q1-fy27-transcript']);
    assert.equal(L.findLinkedPdf('see https://www.x.com/investors/results.html'), null);
  });
  test('Screener.in concall list: current markup, AnnPdfOpen → AttachHis, call nearest before a filing, call date from the text', async () => {
    const L = await import(libPath);
    const html = SCREENER_HTML('Fredun Pharmaceuticals Ltd', '539730', 'FREDUN', [
      ['Aug 2026', 'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=a7ffaefd-aug.pdf', null],
      ['Jun 2026', 'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=b0048ba4-jun.pdf', 'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=ppt-jun.pdf'],
      ['Feb 2026', null, null],
    ]);
    const p = L.parseScreenerCompany(html);
    assert.equal(p.name, 'Fredun Pharmaceuticals Ltd'); assert.equal(p.bseCode, '539730'); assert.equal(p.nseSymbol, 'FREDUN');
    assert.deepEqual(p.concalls.map((c: any) => [c.month, !!c.transcript, !!c.ppt]), [['2026-08', true, false], ['2026-06', true, true], ['2026-02', false, false]]);
    assert.equal(L.normaliseExchangePdfUrl(p.concalls[0].transcript), 'https://www.bseindia.com/xml-data/corpfiling/AttachHis/a7ffaefd-aug.pdf');
    assert.equal(L.pickConcallFor(p.concalls, '2026-09-02T10:00:00Z').month, '2026-08');
    assert.equal(L.pickConcallFor(p.concalls, '2026-06-20T10:00:00Z').month, '2026-06');
    assert.equal(L.pickConcallFor(p.concalls, '2026-12-20T10:00:00Z'), null, 'no call within ~75 days before the filing');
    assert.deepEqual(L.concallsSince(p.concalls, '2026-07-23').map((c: any) => c.month), ['2026-08']);
    assert.equal(L.callDateFrom('Fredun Pharmaceuticals Limited\nQ1 FY27 Earnings Conference Call\nAugust 13, 2026', '2026-08'), '2026-08-13T00:00:00.000Z');
    assert.equal(L.callDateFrom('no date here', '2026-08'), '2026-08-01T00:00:00.000Z');
    assert.equal(L.screenerSearchPath([{ id: 1, name: 'Mobavenue AI Tech Ltd', url: '/company/539682/consolidated/' }], 'MOBAVENUE'), '/company/539682/consolidated/');
    assert.equal(L.screenerSearchPath([{ id: 2, name: 'BMW Ventures Ltd', url: '/company/BMWVENTLTD/' }], 'BMW'), null, 'a short query never takes another company');
    assert.equal(L.screenerSearchPath([{ id: 3, name: 'Baroda Extrusion Ltd', url: '/company/513502/' }], 'BAROEXT'), null, 'the name must start with the query');
    assert.deepEqual(L.parseTickerList('fredun, 539682 ;GHCLTEXTIL  bad!x baroext:513502 NSE:UFLEX'), ['FREDUN', '539682', 'GHCLTEXTIL', 'BAROEXT:513502', 'UFLEX']);
    assert.deepEqual(L.sweepTarget('BAROEXT:513502'), { lookup: '513502', ticker: 'BAROEXT', bseCode: '513502' });
    assert.deepEqual(L.sweepTarget('539682'), { lookup: '539682', ticker: null, bseCode: '539682' });
    assert.deepEqual(L.sweepTarget('FREDUN'), { lookup: 'FREDUN', ticker: 'FREDUN', bseCode: null });
  });
});

const TRANSCRIPT = (company: string, quote: string) => `${company}\nQ1 FY27 Earnings Conference Call\nAugust 13, 2026\n\nModerator: Ladies and gentlemen, good day.\n${'Management: The quarter saw strong demand across our businesses and we continue to invest in capacity. '.repeat(40)}\nManagement: ${quote}\n`;

describe('zzz916 collector run (injected I/O)', () => {
  const resp = (body: any, status = 200, headers: Record<string, string> = {}) => new Response((typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)) as any, { status, headers });
  const pdf = (tag: string) => Buffer.from(`%PDF-1.4 ${tag}`);

  test('intimation → Screener.in transcript (stored with the exchange url); unresolved intimation → pending, never stored; SME listed; sweep of named tickers', async () => {
    const R = await import(runnerPath);
    const posts: any[] = []; const asked: string[] = [];
    const nseUrl = (n: string) => `https://nsearchives.nseindia.com/corporate/${n}.pdf`;
    const nseRows = [
      { symbol: 'UFLEX', sm_name: 'Uflex Limited', desc: 'Analysts/Institutional Investor Meet/Con. Call Updates', attchmntText: 'Uflex Limited has informed the Exchange about Transcript', attchmntFile: nseUrl('uflex-intimation'), an_dt: '02-Sep-2026 18:00:00', sm_isin: 'INE516A01017' },
      { symbol: 'NOLINK', sm_name: 'No Link Ltd', desc: 'Analysts/Institutional Investor Meet/Con. Call Updates', attchmntText: 'No Link Ltd has informed the Exchange about Transcript', attchmntFile: nseUrl('nolink-intimation'), an_dt: '02-Sep-2026 18:10:00', sm_isin: 'INE000000001' },
    ];
    const smeRows = [{ symbol: 'FROG', sm_name: 'Frog Innovations Ltd', desc: 'Analysts/Institutional Investor Meet/Con. Call Updates', attchmntText: 'Frog Innovations Ltd has informed the Exchange about Transcript of the earnings call', attchmntFile: nseUrl('frog'), an_dt: '02-Sep-2026 17:00:00' }];
    const texts: Record<string, string> = {
      'uflex-intimation': 'Pursuant to Regulation 30, the transcript of the Earnings Conference Call held on August 13, 2026 is available on the website of the Company at www.uflexltd.com. Kindly take the same on record.',
      'nolink-intimation': 'Pursuant to Regulation 30, the transcript of the Earnings Conference Call is available on the website of the Company. Kindly take the same on record.',
      'uflex-aug': TRANSCRIPT('UFLEX LIMITED', P.UFLEX),
      'fredun-aug': TRANSCRIPT('FREDUN PHARMACEUTICALS LIMITED', P.FREDUN),
      frog: TRANSCRIPT('FROG INNOVATIONS LIMITED', P.FROG),
      'baroext-aug': TRANSCRIPT('BARODA EXTRUSION LIMITED', P.BAROEXT),
    };
    const fetchFake = async (url: string, init: any = {}) => {
      asked.push(url);
      if (url.includes('/api/v1/guidance-docs/ingest')) {
        if ((init.method || 'GET') === 'POST') { posts.push(JSON.parse(init.body)); return resp({ ok: true, rejected: [] }); }
        return resp({ ok: true, known: [], intimations: [], queueTickers: [] });
      }
      if (url.includes('/api/v1/guidance-pipeline')) return resp({ wanted: [] });
      if (url.includes('AnnSubCategoryGetData')) return resp('refused', 403);
      if (url.includes('nseindia.com/api/corporate-announcements')) {
        const day = /from_date=(\d\d-\d\d-\d{4})/.exec(url)![1];
        if (day !== '02-09-2026') return resp([]);
        return resp(url.includes('index=sme') ? smeRows : nseRows);
      }
      if (url === 'https://www.nseindia.com/') return resp('<html/>');
      if (url.startsWith('https://www.screener.in/company/UFLEX/consolidated/')) return resp(SCREENER_HTML('Uflex Ltd', '500148', 'UFLEX', [['Aug 2026', 'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=uflex-aug.pdf', null]]));
      if (url.startsWith('https://www.screener.in/company/FREDUN/consolidated/')) return resp(SCREENER_HTML('Fredun Pharmaceuticals Ltd', '539730', 'FREDUN', [['Aug 2026', 'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=fredun-aug.pdf', null], ['May 2026', 'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=fredun-may.pdf', null]]));
      if (url.startsWith('https://www.screener.in/company/513502/consolidated/')) return resp(SCREENER_HTML('Baroda Extrusion Ltd', '513502', 'X', [['Aug 2026', 'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=baroext-aug.pdf', null]]).replace(/<a href="https:\/\/www.nseindia[^<]*<\/a>/, ''));
      if (url.startsWith('https://www.screener.in/')) return resp('not found', 404);
      const m = /\/([a-z-]+)\.pdf$/.exec(url);
      if (m && texts[m[1]]) return resp(pdf(m[1]), 200, { 'content-type': 'application/pdf' });
      return resp('nope', 404);
    };
    const pdftotext = async (buf: Buffer) => texts[buf.toString().split(' ')[1]] ?? '';
    const r = await R.run({
      fetch: fetchFake as any, pdftotext, sleep: async () => undefined, log: () => undefined,
      env: { CRON_SECRET: 'x'.repeat(16), CRON_BASE_URL: 'https://app.test', DAYS: '50', BSE_MODE: 'sub', API_DELAY_MS: '0', SCREENER_DELAY_MS: '0', SCREENER_TICKERS: 'FREDUN,BAROEXT:513502', WANTED: '0' },
      now: new Date('2026-09-03T12:00:00Z'),
    });
    const docs = posts.flatMap((p) => p.docs);
    // UFLEX: the intimation is not stored; the transcript from Screener's concall list is, with the exchange filing as its exchangeUrl
    const uf = docs.find((d: any) => d.ticker === 'UFLEX');
    assert.ok(uf, 'UFLEX transcript stored');
    assert.equal(uf.url, 'https://www.bseindia.com/xml-data/corpfiling/AttachHis/uflex-aug.pdf');
    assert.equal(uf.exchangeUrl, nseUrl('uflex-intimation'));
    assert.equal(uf.kind, 'TRANSCRIPT');
    assert.ok(uf.text.includes('35% revenue and EBITDA growth'));
    assert.ok(!docs.some((d: any) => d.url === nseUrl('uflex-intimation')), 'the intimation letter itself is never stored');
    // NOLINK: no link, no Screener page → pending intimation, seen as 'intimation' (not "read, no guidance")
    assert.ok(!docs.some((d: any) => d.ticker === 'NOLINK'));
    const seen = posts.flatMap((p) => p.seen);
    assert.deepEqual(seen.filter((s: any) => s.docId === sha20(nseUrl('nolink-intimation'))).map((s: any) => s.outcome), ['intimation']);
    const ints = posts.flatMap((p) => p.intimations || []);
    assert.deepEqual(ints.map((x: any) => [x.ticker, x.kind, x.url]), [['NOLINK', 'TRANSCRIPT', nseUrl('nolink-intimation')]]);
    // FROG (NSE SME): listed from index=sme
    assert.ok(asked.some((u) => u.includes('index=sme')));
    assert.ok(docs.some((d: any) => d.ticker === 'FROG' && d.kind === 'TRANSCRIPT'));
    // FREDUN (BSE-only for the exchange listing): the sweep collects the Aug 2026 call inside the window, not the May one
    const fr = docs.filter((d: any) => d.ticker === 'FREDUN');
    assert.equal(fr.length, 1);
    assert.equal(fr[0].bseCode, '539730');
    assert.equal(fr[0].company, 'Fredun Pharmaceuticals Ltd');
    assert.equal(fr[0].filedAt, '2026-08-13T00:00:00.000Z');
    assert.equal(fr[0].periodHint, 'Q1 FY27');
    // a BSE-only company named SYMBOL:CODE: looked up by code, filed under the symbol the site uses
    const bx = docs.find((d: any) => d.bseCode === '513502');
    assert.ok(bx); assert.equal(bx.ticker, 'BAROEXT'); assert.equal(bx.company, 'Baroda Extrusion Ltd');
    assert.equal(r.counts.intimationsResolved, 1); assert.equal(r.counts.intimationsPending, 1); assert.equal(r.counts.screenerDocs, 2);
    for (const p of posts) { const v = validateIngestBody(p); assert.ok(v.ok, JSON.stringify(v)); if (v.ok) assert.equal(v.rejected.length, 0); }
  });

  test('pending intimations from earlier runs are resolved; budget 0 reads no Screener page', async () => {
    const R = await import(runnerPath);
    const posts: any[] = []; let screener = 0;
    const intim = { docId: sha20('https://nsearchives.nseindia.com/corporate/v.pdf'), url: 'https://nsearchives.nseindia.com/corporate/v.pdf', ticker: 'VOEPL', bseCode: null, company: 'Virtuoso Optoelectronics Ltd', kind: 'TRANSCRIPT', filedAt: '2026-09-01T12:00:00.000Z' };
    const make = (max: string) => R.run({
      fetch: (async (url: string, init: any = {}) => {
        if (url.includes('/api/v1/guidance-docs/ingest')) { if ((init.method || 'GET') === 'POST') { posts.push(JSON.parse(init.body)); return resp({ ok: true }); } return resp({ known: [], intimations: [intim] }); }
        if (url.startsWith('https://www.screener.in/company/VOEPL/consolidated/')) { screener++; return resp(SCREENER_HTML('Virtuoso Optoelectronics Ltd', '543390', 'VOEPL', [['Aug 2026', 'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=voepl-aug.pdf', null]])); }
        if (url.endsWith('/voepl-aug.pdf')) return resp(pdf('voepl'), 200);
        if (url.includes('corporate-announcements')) return resp([]);
        return resp('x', 404);
      }) as any,
      pdftotext: async () => TRANSCRIPT('VIRTUOSO OPTOELECTRONICS LIMITED', P.VOEPL), sleep: async () => undefined, log: () => undefined,
      env: { CRON_SECRET: 'y'.repeat(16), DAYS: '1', BSE_MODE: 'sub', API_DELAY_MS: '0', SCREENER_DELAY_MS: '0', SCREENER_MAX: max, WANTED: '0' }, now: new Date('2026-09-03T12:00:00Z'),
    });
    await make('0');
    assert.equal(screener, 0);
    await make('5');
    const d = posts.flatMap((p) => p.docs).find((x: any) => x.ticker === 'VOEPL');
    assert.ok(d); assert.equal(d.exchangeUrl, intim.url); assert.equal(d.filedAt, intim.filedAt);
  });
});

// ── store: the index is never overwritten by a failed read; intimations; lock ─

function fakeKv(o: { lockHeld?: boolean } = {}): DocsKv & { store: Map<string, any>; failGet?: Set<string> } {
  const store = new Map<string, any>(); const failGet = new Set<string>();
  return {
    store, failGet,
    get: async (k) => (failGet.has(k) ? null : store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null),
    set: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); },
    setNX: async (k, v) => { if (o.lockHeld && k === DOCS_INDEX_LOCK_KEY) return false; if (store.has(k)) return false; store.set(k, v); return true; },
    del: async (k) => { store.delete(k); },
    sleep: async () => undefined,
  };
}
const gdoc = (url: string, over: Partial<GuidanceDoc> = {}): GuidanceDoc => {
  const text = over.text ?? TRANSCRIPT('UFLEX LIMITED', P.UFLEX);
  return { docId: sha20(url), market: 'IN', ticker: 'UFLEX', company: 'Uflex Limited', kind: 'TRANSCRIPT', title: 'Transcript', url, sourceHost: 'nseindia.com', filedAt: '2026-09-02T12:00:00.000Z', periodHint: 'Q1 FY27', textChars: text.length, text, collectedAt: '2026-09-03T00:00:00.000Z', collector: 'gh-india-guidance-docs', ...over };
};

describe('zzz916 docs store integrity + intimations', () => {
  test('an index read that fails while the meta says rows exist refuses to overwrite (the 381-row wipe)', async () => {
    const kv = fakeKv(); const now = new Date('2026-09-03T00:00:00Z');
    const first = Array.from({ length: 30 }, (_, i) => gdoc(`https://nsearchives.nseindia.com/corporate/a${i}.pdf`));
    await ingestDocs({ collector: 'c', market: 'IN', docs: first.slice(0, 25), seen: [], status: null, coverage: null }, kv, now);
    await ingestDocs({ collector: 'c', market: 'IN', docs: first.slice(25), seen: [], status: null, coverage: null }, kv, now);
    assert.equal(kv.store.get(DOCS_INDEX_KEY).rows.length, 30);
    assert.equal(kv.store.get(DOCS_INDEX_META_KEY).rows, 30);
    kv.failGet!.add(DOCS_INDEX_KEY);   // a slow / failed read returns null
    await assert.rejects(() => ingestDocs({ collector: 'c', market: 'IN', docs: [gdoc('https://nsearchives.nseindia.com/corporate/new.pdf')], seen: [], status: null, coverage: null }, kv, now), DocsIndexUnreadableError);
    assert.equal(kv.store.get(DOCS_INDEX_KEY).rows.length, 30, 'the index is intact');
    // before any meta exists (first write after the deploy): a strict read that FAILS refuses; a strict read that finds the index merges into it
    const legacy = fakeKv(); legacy.store.set(DOCS_INDEX_KEY, { updatedAt: '', rows: kv.store.get(DOCS_INDEX_KEY).rows }); legacy.failGet!.add(DOCS_INDEX_KEY);
    const one = [gdoc('https://nsearchives.nseindia.com/corporate/new2.pdf')];
    await assert.rejects(() => ingestDocs({ collector: 'c', market: 'IN', docs: one, seen: [], status: null, coverage: null }, { ...legacy, getStrict: async () => { throw new Error('timeout'); } }, now), DocsIndexUnreadableError);
    await ingestDocs({ collector: 'c', market: 'IN', docs: one, seen: [], status: null, coverage: null }, { ...legacy, getStrict: async (k: string) => JSON.parse(JSON.stringify(legacy.store.get(k) ?? null)) }, now);
    assert.equal(legacy.store.get(DOCS_INDEX_KEY).rows.length, 31);
  });
  test('a held lock: ingest refuses (retry later), markExtracted skips the flag without failing', async () => {
    const kv = fakeKv(); await ingestDocs({ collector: 'c', market: 'IN', docs: [gdoc('https://nsearchives.nseindia.com/corporate/x.pdf')], seen: [], status: null, coverage: null }, kv, new Date());
    const held = fakeKv({ lockHeld: true }); for (const [k, v] of kv.store) held.store.set(k, v);
    await assert.rejects(() => ingestDocs({ collector: 'c', market: 'IN', docs: [gdoc('https://nsearchives.nseindia.com/corporate/y.pdf')], seen: [], status: null, coverage: null }, held, new Date()), DocsIndexUnreadableError);
    assert.equal(await markExtracted(sha20('https://nsearchives.nseindia.com/corporate/x.pdf'), held), true);
    assert.equal(held.store.get(DOCS_INDEX_KEY).rows[0].extracted, undefined);
    assert.equal(await markExtracted(sha20('https://nsearchives.nseindia.com/corporate/x.pdf'), kv), true);
    assert.equal(kv.store.get(DOCS_INDEX_KEY).rows[0].extracted, true);
    assert.equal(kv.store.has(DOCS_INDEX_LOCK_KEY), false, 'the lock is released');
  });
  test('the real transcript replaces the stored intimation row; pending intimations list + short stored "transcripts"', async () => {
    const kv = fakeKv(); const now = new Date('2026-09-03T00:00:00Z');
    const intimUrl = 'https://nsearchives.nseindia.com/corporate/uflex-intimation.pdf';
    const shortText = 'Pursuant to Regulation 30, the transcript of the earnings call is available on the website of the Company at www.uflexltd.com. Kindly take the same on record. '.repeat(3);
    await ingestDocs({ collector: 'c', market: 'IN', docs: [gdoc(intimUrl, { text: shortText, textChars: shortText.length })], seen: [], status: null, coverage: null }, kv, now);
    const pend0 = await pendingIntimations(kv, now);
    assert.deepEqual(pend0.map((x) => x.docId), [sha20(intimUrl)], 'a stored short "transcript" is offered for resolution');
    const v = validateIngestBody({ collector: 'gh-test', market: 'IN', docs: [], seen: [{ docId: 'a'.repeat(20), outcome: 'intimation' }],
      intimations: [{ docId: 'b'.repeat(20), url: 'https://nsearchives.nseindia.com/corporate/b.pdf', ticker: 'NOLINK', bseCode: null, company: 'No Link', kind: 'TRANSCRIPT', filedAt: '2026-09-02T12:00:00Z' },
        { docId: 'c'.repeat(20), url: 'https://evil.example.com/c.pdf', ticker: 'X', bseCode: null, company: 'X', kind: 'TRANSCRIPT', filedAt: '2026-09-02T12:00:00Z' }] });
    assert.ok(v.ok); if (!v.ok) return;
    assert.equal(v.body.seen.length, 1); assert.equal(v.body.intimations!.length, 1, 'a non-exchange url is not an intimation');
    await ingestDocs(v.body, kv, now);
    assert.equal(kv.store.get(INTIMATIONS_KEY).items.length, 1);
    // the real transcript arrives with exchangeUrl = the intimation: its row leaves the index
    const real = gdoc('https://www.bseindia.com/xml-data/corpfiling/AttachHis/uflex-aug.pdf', { exchangeUrl: intimUrl });
    await ingestDocs({ collector: 'c', market: 'IN', docs: [real], seen: [], status: null, coverage: null }, kv, now);
    const ids = kv.store.get(DOCS_INDEX_KEY).rows.map((r: GuidanceDocIndexRow) => r.docId);
    assert.deepEqual(ids, [real.docId]);
    assert.deepEqual((await pendingIntimations(kv, now)).map((x) => x.ticker), ['NOLINK']);
    // a long document is never removed by a later exchangeUrl match
    const keep = mergeIndex({ updatedAt: '', rows: [{ docId: 'd'.repeat(20), market: 'IN', ticker: 'Z', company: 'Z', kind: 'RESULTS_RELEASE', filedAt: '2026-09-01', url: 'https://www.bseindia.com/z.pdf', textChars: 900 }] }, [gdoc('https://z.example.com/a.pdf', { exchangeUrl: 'https://www.bseindia.com/z.pdf' })], now);
    assert.equal(keep.rows.length, 2);
  });
});

// ── events queue: India items belong to the documents collector ─────────────

describe('zzz916 queue delegation', () => {
  test('India items are delegated: never read by the route, not counted as waiting, dropped first when the queue is full, offered to the collector', () => {
    const now = new Date('2026-09-25T00:00:00Z');
    let q: QueueState = emptyQueue(now);
    q = enqueue(q, [
      { market: 'IN', ticker: 'UTLSOLAR', company: 'Fujiyama Power Systems', sourceUrl: 'https://nsearchives.nseindia.com/corporate/u.pdf', sourceType: 'NSE', subject: 'Analysts/Institutional Investor Meet/Con. Call Updates', eventDate: '2026-09-23' },
      { market: 'IN', ticker: 'GKENERGY', company: 'GK Energy', sourceUrl: 'https://nsearchives.nseindia.com/corporate/g.pdf', sourceType: 'NSE', subject: 'Press Release', eventDate: '2026-09-21' },
      { market: 'US', ticker: 'ZZ', company: 'ZZ Inc', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/0000000001-26-000001-index.htm', sourceType: '8-K', subject: 'Form 8-K earnings release', eventDate: '2026-09-22' },
    ], now).queue;
    assert.equal(awaitingCount(q, 'IN'), 2);
    assert.equal(delegateIndiaToCollector(q), 2);
    assert.equal(delegateIndiaToCollector(q), 0, 'idempotent');
    assert.deepEqual(selectDue(q, now).map((x) => x.market), ['US']);
    assert.equal(awaitingCount(q, 'IN'), 0);
    assert.match(reportQueue(q).note, /2 India filings are read by the documents collector/);
    assert.equal(reportQueue(q).queued, 1);
    assert.deepEqual(collectorQueueTickers(q, now), ['GKENERGY', 'UTLSOLAR']);
    const full: QueueState = { ...q, items: [...q.items, ...Array.from({ length: 905 }, (_, i) => ({ ...q.items[2], id: `us${i}`, event_date: '2026-09-24' }))] };
    const b = bound(full);
    assert.equal(b.items.filter((x) => x.market === 'IN').length, 0, 'delegated items go first when the queue is over its cap');
  });
});

// ── extractor checks + universe, with the exact phrasings ───────────────────

const raw = (o: Record<string, unknown>) => ({
  metric: 'REVENUE_GROWTH', metric_label: 'revenue growth', period: 'FY27', period_kind: 'ANNUAL', basis: 'UNSTATED', currency: null, unit: '%',
  low: null, high: null, growth_pct_low: null, growth_pct_high: null, status: 'NEW', prior_low: null, prior_high: null, prior_stated_in: null,
  prior_actual_period: null, prior_actual_value: null, prior_actual_quote: null, quote: '', speaker: null, confidence: 0.9, ...o,
});
const docOf = (company: string, quote: string) => ({ kind: 'TRANSCRIPT' as const, text: TRANSCRIPT(company, quote), market: 'IN' as const, filedAt: '2026-08-13T00:00:00.000Z' });
const kept = (company: string, q: string, o: Record<string, unknown>) => { const c = checkRows([raw({ quote: q, ...o })], docOf(company, q)); return { row: c.rows[0] as ExtractedGuidance | undefined, c }; };

const CASES: Record<string, { company: string; q: string; o: Record<string, unknown> }> = {
  MOBAVENUE: { company: 'Mobavenue AI Tech Ltd', q: '30%+ revenue growth annually in the long term', o: { period: 'Long term', period_kind: 'MULTI_YEAR', low: 30, high: null } },
  SUNRAKSHAK: { company: 'Sunrakshakk Industries India Ltd', q: '30-35% CAGR in revenue between FY25 and FY29', o: { period: 'FY25-FY29', period_kind: 'MULTI_YEAR', low: 30, high: 35 } },
  FREDUN: { company: 'Fredun Pharmaceuticals Ltd', q: 'blended revenue growth of 30-35% over the next 2 years', o: { period: 'Next 2 years', period_kind: 'MULTI_YEAR', low: 30, high: 35 } },
  ATLANTAELE: { company: 'Atlanta Electricals Ltd', q: 'Revenue 40% CAGR over the next three years', o: { period: 'Next 3 years', period_kind: 'MULTI_YEAR', low: 40, high: 40 } },
  EMERALD: { company: 'Emerald Leasing Finance', q: 'PAT growth of 40-50% CAGR in the next 2-3 years', o: { metric: 'PAT', metric_label: 'PAT', unit: null, period: 'Next 3 years', period_kind: 'MULTI_YEAR', growth_pct_low: 40, growth_pct_high: 50 } },
  BAROEXT: { company: 'Baroda Extrusion Ltd', q: 'minimum 35-40% revenue growth for FY27', o: { low: 35, high: 40 } },
  CCAVENUE: { company: 'AvenuesAI Ltd', q: 'revenue growth of ~35%+ in FY27', o: { low: 35, high: 35 } },
  GKENERGY: { company: 'GK Energy Ltd', q: 'we expect revenue to double in FY27', o: { low: 100, high: 100 } },
  BMW: { company: 'BMW Industries Ltd', q: '70-75% revenue CAGR for FY25-FY28', o: { period: 'FY25-FY28', period_kind: 'MULTI_YEAR', low: 70, high: 75 } },
  SOUTHWEST: { company: 'South West Pinnacle Exploration Ltd', q: 'revenue CAGR of 20% over the medium term', o: { period: 'Medium term', period_kind: 'MULTI_YEAR', low: 20, high: 20 } },
  GHCLTEXTIL: { company: 'GHCL Textiles Ltd', q: 'We are targeting doubling revenue to Rs.2,000 crores by FY29', o: { metric: 'REVENUE', metric_label: 'revenue', currency: 'INR', unit: 'crore', period: 'FY29', low: 2000, high: 2000 } },
  FROG: { company: 'Frog Innovations Ltd', q: 'FY27 revenue to recover to approximately Rs 220 crore from FY26 base of Rs 106 crore', o: { metric: 'REVENUE', metric_label: 'revenue', currency: 'INR', unit: 'crore', low: 220, high: 220, prior_actual_period: 'FY26', prior_actual_value: 106, prior_actual_quote: 'FY27 revenue to recover to approximately Rs 220 crore from FY26 base of Rs 106 crore' } },
};

describe('zzz916 extractor keeps the Q1 FY27 phrasings with the right meaning', () => {
  test('long term 30%+ a year: kept, no fixed year, floor only', () => {
    const { row } = kept(CASES.MOBAVENUE.company, CASES.MOBAVENUE.q, CASES.MOBAVENUE.o);
    assert.ok(row); assert.equal(row!.period, LONG_TERM_LABEL); assert.equal(row!.periodKind, 'MULTI_YEAR'); assert.equal(row!.low, 30); assert.equal(row!.high, null);
    // filed by the model as an FY27 row: moved to the long-term horizon, never shown as FY27 guidance
    const { row: r2, c } = kept(CASES.MOBAVENUE.company, CASES.MOBAVENUE.q, { low: 30, high: 30 });
    assert.ok(r2); assert.equal(r2!.period, LONG_TERM_LABEL); assert.equal(r2!.high, null); assert.equal(c.adjusted.period_from_horizon, 1);
  });
  test('multi-year spans: years named (FY25-FY29) and spans with no year (next 2 / next 3 years, medium term)', () => {
    assert.equal(kept(CASES.SUNRAKSHAK.company, CASES.SUNRAKSHAK.q, CASES.SUNRAKSHAK.o).row!.period, 'FY25-FY29');
    assert.equal(kept(CASES.FREDUN.company, CASES.FREDUN.q, CASES.FREDUN.o).row!.period, 'Next 2 years');
    assert.equal(kept(CASES.ATLANTAELE.company, CASES.ATLANTAELE.q, CASES.ATLANTAELE.o).row!.period, 'Next 3 years');
    const em = kept(CASES.EMERALD.company, CASES.EMERALD.q, CASES.EMERALD.o).row!;
    assert.equal(em.metric, 'PAT'); assert.equal(em.period, 'Next 3 years'); assert.equal(em.growthPctLow, 40); assert.equal(em.growthPctHigh, 50);
    assert.equal(kept(CASES.SOUTHWEST.company, CASES.SOUTHWEST.q, CASES.SOUTHWEST.o).row!.period, 'Medium term (no fixed year)');
    // an AMOUNT with no year over the long term is still an aspiration
    const asp = kept('X Ltd', 'we will reach Rs 500 crore revenue in the long term', { metric: 'REVENUE', metric_label: 'revenue', currency: 'INR', unit: 'crore', low: 500, high: 500 });
    assert.equal(asp.row, undefined); assert.equal(asp.c.reasons.long_term_without_period, 1);
  });
  test('open-ended vs range; doubling as +100%; ₹ targets and the document\'s own base', () => {
    const ba = kept(CASES.BAROEXT.company, CASES.BAROEXT.q, CASES.BAROEXT.o).row!; assert.equal(ba.low, 35); assert.equal(ba.high, 40);
    const cc = kept(CASES.CCAVENUE.company, CASES.CCAVENUE.q, CASES.CCAVENUE.o).row!; assert.equal(cc.low, 35); assert.equal(cc.high, null);
    const gk = kept(CASES.GKENERGY.company, CASES.GKENERGY.q, CASES.GKENERGY.o).row!; assert.equal(gk.low, 100);
    const gh = kept(CASES.GHCLTEXTIL.company, CASES.GHCLTEXTIL.q, CASES.GHCLTEXTIL.o).row!; assert.equal(gh.period, 'FY29'); assert.equal(gh.low, 2000);
    const fr = kept(CASES.FROG.company, CASES.FROG.q, CASES.FROG.o).row!; assert.deepEqual(fr.priorActual && [fr.priorActual.period, fr.priorActual.value], ['FY26', 106]);
    // a base two years back is accepted when the document states it
    const T = 'FY25 revenue was ₹1,000 crore. We target ₹2,000 crore revenue by FY29.';
    assert.ok(checkPriorActual({ period: 'FY29', period_kind: 'ANNUAL', prior_actual_period: 'FY25', prior_actual_value: 1000, prior_actual_quote: 'FY25 revenue was ₹1,000 crore' }, 'crore', T).ok);
    // "last year" names the year just before
    const T2 = 'Last year revenue was ₹106 crore and FY27 revenue will be ₹220 crore.';
    assert.ok(checkPriorActual({ period: 'FY27', period_kind: 'ANNUAL', prior_actual_period: 'FY26', prior_actual_value: 106, prior_actual_quote: 'Last year revenue was ₹106 crore' }, 'crore', T2).ok);
  });
});

const NOW = new Date('2026-10-06T09:00:00Z');
const xres = (key: string, rows: ExtractedGuidance[], o: Partial<GuidanceExtractResult> = {}): GuidanceExtractResult => ({
  docId: sha20(key), market: 'IN', ticker: key, company: CASES[key]?.company || key, docUrl: `https://www.bseindia.com/xml-data/corpfiling/AttachHis/${key.toLowerCase()}.pdf`, docKind: 'TRANSCRIPT',
  filedAt: '2026-08-13T00:00:00.000Z', extractedAt: '2026-10-05T00:00:00Z', model: 'test', status: 'ok', rows, dropped: 0, ...o,
});
const resultFor = (key: string) => { const k = CASES[key]; const { row } = kept(k.company, k.q, k.o); assert.ok(row, key); return xres(key, [row!]); };
const itemOf = (results: GuidanceExtractResult[], actuals: Map<string, PriorActual> | null = null) => itemsFromExtracted(results, actuals, NOW);

describe('zzz916 universe: meaning on the page', () => {
  test('long term: kept, "no fixed year", floor only', () => {
    const [it] = itemOf([resultFor('MOBAVENUE')]);
    assert.equal(it.pkind, 'MULTI_YEAR_CAGR'); assert.equal(it.period, LONG_TERM_LABEL); assert.equal(it.open, true); assert.equal(it.low, 30);
    assert.equal(displayOf({ metric: it.metric, low: it.low, high: it.high, open: it.open, origin: 'STATED', periodKind: it.pkind, period: it.period, abs: null }), 'Long-term revenue growth +30%+ a year (no fixed year)');
  });
  test('CAGR spans: FY25-29 and Next 3 years as yearly rates; "over the next 2 years" kept for review (yearly or total not said)', () => {
    const [su] = itemOf([resultFor('SUNRAKSHAK')]); assert.equal(su.pkind, 'MULTI_YEAR_CAGR'); assert.equal(su.period, 'FY25-29'); assert.deepEqual([su.low, su.high], [30, 35]); assert.equal(su.needsReview, null);
    const [at] = itemOf([resultFor('ATLANTAELE')]); assert.equal(at.pkind, 'MULTI_YEAR_CAGR'); assert.equal(at.period, 'Next 3 years'); assert.equal(at.needsReview, null);
    assert.match(displayOf({ metric: at.metric, low: at.low, high: at.high, open: at.open, origin: 'STATED', periodKind: at.pkind, period: at.period, abs: null }), /^3-yr revenue CAGR \+40%$/);
    const [fr] = itemOf([resultFor('FREDUN')]); assert.equal(fr.period, 'Next 2 years'); assert.match(fr.needsReview!, /yearly rate or the total/);
    const [em] = itemOf([resultFor('EMERALD')]); assert.equal(em.metric, 'PAT'); assert.equal(em.needsReview, null);
  });
  test('open-ended (~35%+), a range ("minimum 35-40%"), doubling in a year (+100%, not dropped)', () => {
    const [cc] = itemOf([resultFor('CCAVENUE')]); assert.equal(cc.open, true); assert.equal(cc.low, 35);
    const [ba] = itemOf([resultFor('BAROEXT')]); assert.equal(ba.open, false); assert.deepEqual([ba.low, ba.high], [35, 40]);
    const [gk] = itemOf([resultFor('GKENERGY')]); assert.equal(gk.low, 100); assert.equal(gk.gOrigin, 'STATED');
  });
  test('"doubling revenue to ₹2,000 Cr by FY29": a yearly rate worked out from company numbers (reported FY26 base, else the doubling itself)', () => {
    const r = resultFor('GHCLTEXTIL');
    const act = new Map<string, PriorActual>([[actualKey('IN', 'GHCLTEXTIL', 'REVENUE', 'FY26'), { market: 'IN', ticker: 'GHCLTEXTIL', metric: 'REVENUE', period: 'FY26', value: 1000, unit: '₹ Cr', source: 'results cache' }]]);
    const [a] = itemOf([r], act);
    assert.equal(a.pkind, 'MULTI_YEAR_CAGR'); assert.equal(a.period, 'FY26-29'); assert.equal(a.gOrigin, 'IMPLIED'); assert.equal(a.low, 26); assert.equal(a.cagrFromBase!.years, 3); assert.equal(a.cagrFromBase!.how, 'results');
    assert.match(a.notes!, /worked out from company numbers/);
    const [b] = itemOf([r]);
    assert.equal(b.low, 26); assert.equal(b.cagrFromBase!.how, 'multiple');
    // end to end: listed (Active or review) with the "worked out" label, never as a one-year +100%
    const u = buildUniverse([], [], [], NOW, { extracted: { results: [r], actuals: act } });
    const rec = [...u.defaultRecords, ...u.reviewQueue].find((x: GuUniverseRecordX) => x.tickers.includes('GHCLTEXTIL') || x.record.ticker === 'GHCLTEXTIL');
    assert.ok(rec, 'GHCL Textiles is on the page');
    const pt = rec!.points.find((p) => p.metric === 'REVENUE')!;
    assert.match(pt.display, /3-yr revenue CAGR \+26(\.0)?% \(a year, worked out from company numbers/);
    assert.equal(pt.growthType, 'DERIVED');
  });
  test('"₹220 Cr from ₹106 Cr": growth vs the document\'s own FY26 base', () => {
    const r = resultFor('FROG');
    const [it] = itemOf([r], actualsFromDocs([r]));
    assert.equal(it.period, 'FY27'); assert.equal(it.gOrigin, 'IMPLIED'); assert.equal(Math.round(it.low!), 108);
  });
  test('unsuitable: segment / foreign-currency figure kept for review only; AUM, pre-sales, bookings, advances, volume, QoQ, stores never become revenue growth', () => {
    // the transcript's wording ("$100 million"; InvestorStack abbreviates it to "$100M")
    const fq = 'We target US CrudeChem revenue to reach $100 million in FY27 and $200 million by FY28.';
    const fcl = xres('FCL', [kept('Fineotex Chemical Ltd', fq, { metric: 'REVENUE', metric_label: 'US CrudeChem revenue', currency: 'USD', unit: 'million', low: 100, high: 100, period: 'FY27' }).row!], { company: 'Fineotex Chemical Ltd' });
    const [f] = itemOf([fcl]); assert.match(f.needsReview!, /Not the company-wide figure/);
    const gone = (key: string, q: string, o: Record<string, unknown>) => { const k = kept(`${key} Ltd`, q, o); return k.row ? itemOf([xres(key, [k.row], { company: `${key} Ltd` })]).length : 0; };
    assert.equal(gone('REGENCY', P.REGENCY, { low: 60, high: 60 }), 0);
    assert.equal(gone('SOBHA', P.SOBHA, { low: 30, high: null }), 0);
    assert.equal(gone('ARVSMART', P.ARVSMART, { low: 35, high: 40 }), 0);
    assert.equal(gone('EQUITAS', P.EQUITAS, { low: 20, high: null }), 0);
    assert.equal(gone('KSHINTL', P.KSHINTL, { low: 26, high: 26 }), 0);
    assert.equal(gone('TAC', P.TAC, { low: 20, high: 20 }), 0);
    const cms = kept('CMS Info Systems Ltd', P.CMSINFO, { low: 35, high: 40 }).row!;
    const [c] = itemOf([xres('CMSINFO', [cms], { company: 'CMS Info Systems Ltd' })]); assert.match(c.needsReview!, /Tech & Payments/);
  });
  test('every suitable company produces a universe item (none silently dropped) and is on the page: Active, or review with its reason', () => {
    for (const key of Object.keys(CASES)) assert.equal(itemOf([resultFor(key)]).length, 1, key);
    const results = Object.keys(CASES).map(resultFor);
    const u = buildUniverse([], [], [], NOW, { extracted: { results, actuals: actualsFromDocs(results) } });
    const where = (k: string) => (u.defaultRecords.some((r) => r.tickers.includes(k)) ? 'ACTIVE' : u.reviewQueue.some((r) => r.tickers.includes(k)) ? 'REVIEW' : 'NONE');
    for (const k of Object.keys(CASES)) assert.notEqual(where(k), 'NONE', k);
    for (const k of ['MOBAVENUE', 'SUNRAKSHAK', 'ATLANTAELE', 'CCAVENUE', 'GKENERGY', 'GHCLTEXTIL', 'FROG', 'BMW', 'BAROEXT']) assert.equal(where(k), 'ACTIVE', k);
    assert.equal(where('FREDUN'), 'REVIEW', 'yearly-or-total not stated');
  });
});

// ── extractor: intimations are labelled, India first ─────────────────────────

describe('zzz916 extractor order and intimation screen', () => {
  const av: Availability = { available: true, reason: null, provider: 'test', model: 'm' };
  test('an intimation stored as a "transcript" is labelled, costs nothing, and is not "read, no guidance"', async () => {
    let calls = 0;
    const d = gdoc('https://nsearchives.nseindia.com/corporate/i.pdf', { text: 'Pursuant to Regulation 30, the transcript of the Earnings Conference Call held on August 13, 2026 is available on the website of the Company. Kindly take the same on record.'.repeat(2) });
    const r = await extractDoc(d, { callModel: async () => { calls++; return { ok: false, kind: 'error', status: 500, message: 'x' }; }, availability: async () => av });
    assert.equal(calls, 0); assert.equal(r.status, 'unreadable'); assert.match(r.note!, /intimation letter/); assert.equal(r.model, 'screen');
  });
  test('India before US; inside India transcripts / presentations, then results releases, then the rest', () => {
    const ir = (id: string, market: 'IN' | 'US', kind: any, filedAt: string): GuidanceDocIndexRow => ({ docId: id, market, ticker: id, company: id, kind, filedAt, url: '', textChars: 1 });
    const p = planQueue([ir('us-new', 'US', 'RESULTS_RELEASE', '2026-10-05'), ir('in-rr', 'IN', 'RESULTS_RELEASE', '2026-10-01'), ir('in-agm', 'IN', 'AGM_SPEECH', '2026-10-02'), ir('in-tr', 'IN', 'TRANSCRIPT', '2026-08-13'), ir('in-ppt', 'IN', 'PRESENTATION', '2026-08-12')],
      { handoff: new Set(['us-new']), graded: null, verified: null, looked: new Set() });
    assert.deepEqual(p.rows.map((x) => x.docId), ['in-tr', 'in-ppt', 'in-rr', 'in-agm', 'us-new']);
  });
});
