// zzz857 — guidance-document collector (GitHub Actions script) + store + ingest validation.
// Run: npx tsx --test src/lib/__tests__/zzz857-docs.test.ts
// No network: fetch, pdftotext and KV are injected fakes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  validateIngestBody, validateDoc, ingestDocs, listDocs, getDoc, markExtracted, knownDocIds, mergeIndex, mergeStatus,
  isAllowedDocUrl, readCollectorStatus, DOCS_INDEX_KEY, EXTRACT_INDEX_KEY, docKey, PASSAGE_CAP, INDEX_CAP, DOC_TTL_S, type DocsKv,
  selectGuidancePassages, storageStats, mergeCoverage, readCoverage, coverageKey, encodeText, decodeText, PASSAGE_SEP,
} from '../guidance-docs-store';
import { isProtectedApi } from '../site-auth';
import type { GuidanceDoc } from '../guidance-docs-types';

const SCRIPTS = join(__dirname, '..', '..', '..', '..', '.github', 'scripts');
const libPath = pathToFileURL(join(SCRIPTS, 'guidance-docs-lib.mjs')).href;
const runnerPath = pathToFileURL(join(SCRIPTS, 'scrape-guidance-docs.mjs')).href;

const MAN_SNIPPET = 'Moderator: Thank you. Nikhil Mansukhani: For FY27, we are guiding for a consolidated revenue of ₹5,000 to ₹5,500 crore for FY27 with EBITDA margins of 13% to 15%. This excludes Merino Shelters. FY28 could see around 25% to 30% growth from FY27.';
const MAN_TEXT = `MAN INDUSTRIES (INDIA) LIMITED\nEarnings Conference Call Q4 FY26\nMay 26, 2026\n\n${'Management discussion of the order book, pipe demand and capacity. '.repeat(20)}\n${MAN_SNIPPET}\n`;

function fakeKv(): DocsKv & { store: Map<string, { v: any; ttl?: number }> } {
  const store = new Map<string, { v: any; ttl?: number }>();
  return {
    store,
    get: async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k)!.v)) : null),
    set: async (k, v, ttl) => { store.set(k, { v: JSON.parse(JSON.stringify(v)), ttl }); },
  };
}

const sha20 = (u: string) => createHash('sha1').update(u).digest('hex').slice(0, 20);

function doc(over: Partial<GuidanceDoc> = {}): any {
  const url = over.url || 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/abc.pdf';
  return {
    docId: sha20(url), market: 'IN', ticker: 'MANINDS', bseCode: '513269', company: 'Man Industries (India) Ltd',
    kind: 'TRANSCRIPT', title: 'Transcript of Earnings Call Q4 FY26', url, sourceHost: 'bseindia.com',
    filedAt: '2026-06-01T12:00:00.000Z', periodHint: 'Q4 FY26', textChars: MAN_TEXT.length, text: MAN_TEXT,
    collectedAt: '2026-10-02T10:00:00.000Z', collector: 'gh-india-guidance-docs', ...over,
  };
}

// ── collector pure helpers ──────────────────────────────────────────────────

describe('collector helpers (guidance-docs-lib.mjs)', () => {
  test('classifySubject: transcripts, presentations, releases, speeches; notices dropped', async () => {
    const L = await import(libPath);
    const c = L.classifySubject;
    assert.equal(c('Analysts/Institutional Investor Meet/Con. Call Updates', { headline: 'Transcript of Earnings Conference Call held on May 26, 2026' }), 'TRANSCRIPT');
    assert.equal(c('Earnings Call Transcript', { category: 'Company Update', subcategory: 'Earnings Call Transcript' }), 'TRANSCRIPT');
    assert.equal(c('Transcript and audio recording of the earnings call'), 'TRANSCRIPT');
    assert.equal(c('Investor Presentation', { subcategory: 'Investor Presentation' }), 'PRESENTATION');
    assert.equal(c('Earnings Presentation for Q1 FY27'), 'PRESENTATION');
    assert.equal(c('Press Release - Financial Results for the quarter ended June 30, 2026'), 'RESULTS_RELEASE');
    assert.equal(c('Chairman\'s Speech at the 37th Annual General Meeting'), 'AGM_SPEECH');
    assert.equal(c('Audio recording of the earnings call'), null);
    assert.equal(c('Intimation of Earnings Conference Call scheduled on Aug 13, 2026'), null);
    assert.equal(c('Schedule of Analyst / Institutional Investor Meet'), null);
    assert.equal(c('Closure of Trading Window'), null);
    assert.equal(c('Outcome of Board Meeting - Financial Results'), null);
    assert.equal(c('Outcome of Board Meeting - Financial Results', { includePlainResults: true }), 'RESULTS_RELEASE');
    assert.equal(c('Press Release - Receipt of order'), null);
    assert.equal(c(''), null);
  });

  test('extractPeriodHint: Q/H/FY forms and Indian fiscal quarter-ended dates', async () => {
    const { extractPeriodHint: p } = await import(libPath);
    assert.equal(p('Earnings call transcript Q4 FY26'), 'Q4 FY26');
    assert.equal(p('Investor Presentation Q1FY27'), 'Q1 FY27');
    assert.equal(p('Q1 FY 2026-27 results presentation'), 'Q1 FY27');
    assert.equal(p('1QFY27 earnings call'), 'Q1 FY27');
    assert.equal(p('H1 FY27 investor update'), 'H1 FY27');
    assert.equal(p('Financial Results for the quarter ended 30th June, 2026'), 'Q1 FY27');
    assert.equal(p('Results for the quarter and year ended March 31, 2026'), 'Q4 FY26');
    assert.equal(p('Unaudited results for the quarter ended 31.12.2025'), 'Q3 FY26');
    assert.equal(p('Audited results for the year ended 31st March 2026'), 'FY26');
    assert.equal(p('Investor presentation FY2026'), 'FY26');
    assert.equal(p('Annual report letter for financial year 2025-26'), 'FY26');
    assert.equal(p('Investor Presentation'), null);
  });

  test('hasGuidanceCue: Man Industries transcript snippet passes; boilerplate fails', async () => {
    const { hasGuidanceCue } = await import(libPath);
    assert.equal(hasGuidanceCue(MAN_SNIPPET), true);
    assert.equal(hasGuidanceCue('We expect to clock a top line of 1,200 crore next year.'), true);
    assert.equal(hasGuidanceCue('Pursuant to Regulation 30, please find enclosed the transcript. Kindly take the same on record.'), false);
    assert.equal(hasGuidanceCue('Revenue for the quarter was 1,200 crore.'), false); // no forward-looking word
  });

  test('buildDoc: docId = sha1(url)[0:20], period hint, text capped, ticker carried', async () => {
    const L = await import(libPath);
    const filing = L.bseRowToFiling({ SCRIP_CD: 513269, SLONGNAME: 'Man Industries (India) Ltd', NEWSSUB: 'Analysts/Institutional Investor Meet/Con. Call Updates', HEADLINE: 'Transcript of the Earnings Conference Call for Q4 FY26', NEWS_DT: '2026-06-01T17:42:11.2', ATTACHMENTNAME: 'abc-123.pdf', PDFFLAG: 0, CATEGORYNAME: 'Company Update', SUBCATNAME: 'Earnings Call Transcript' });
    assert.ok(filing);
    assert.equal(filing.url, 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/abc-123.pdf');
    assert.equal(filing.filedAt, '2026-06-01T12:12:11.200Z'); // IST → UTC
    assert.equal(filing.bseCode, '513269');
    const kind = L.classifySubject(filing.subject, { headline: filing.headline, category: filing.category, subcategory: filing.subcategory });
    const ticker = L.resolveTicker(filing, { isinToNse: new Map([['INE993A01026', 'MANINDS']]), bseToIsin: new Map([['513269', 'INE993A01026']]), curated: new Map() });
    assert.equal(ticker, 'MANINDS');
    const d = L.buildDoc({ filing, kind, text: MAN_TEXT + 'x'.repeat(200_000), ticker, collector: 'gh-india-guidance-docs', collectedAt: '2026-10-02T10:00:00.000Z' });
    assert.equal(d.docId, sha20(filing.url));
    assert.equal(d.docId.length, 20);
    assert.equal(d.kind, 'TRANSCRIPT');
    assert.equal(d.periodHint, 'Q4 FY26');
    assert.equal(d.ticker, 'MANINDS');
    assert.equal(d.sourceHost, 'bseindia.com');
    assert.equal(d.textChars, 120_000);
    assert.equal(d.text.length, 120_000);
    assert.ok(d.text.includes('we are guiding for a consolidated revenue of ₹5,000 to ₹5,500 crore for FY27'));
    // archived attachment and an unknown code
    const his = L.bseRowToFiling({ SCRIP_CD: '999999', NEWSSUB: 'Investor Presentation', NEWS_DT: '2026-05-25T10:00:00', ATTACHMENTNAME: 'x.pdf', PDFFLAG: 1 });
    assert.ok(his.url.includes('/AttachHis/'));
    assert.equal(L.resolveTicker(his, { isinToNse: new Map(), bseToIsin: new Map(), curated: new Map() }), null);
    assert.equal(L.bseRowToFiling({ NEWSSUB: 'x', NEWS_DT: '2026-05-25', ATTACHMENTNAME: '' }), null);
  });

  test('chunkBatches: ≤25 docs and ≤ byte cap per batch, order kept', async () => {
    const { chunkBatches } = await import(libPath);
    const small = Array.from({ length: 60 }, (_, i) => ({ i, text: 'a'.repeat(100) }));
    const b1 = chunkBatches(small);
    assert.deepEqual(b1.map((b: any[]) => b.length), [25, 25, 10]);
    assert.deepEqual(b1.flat().map((d: any) => d.i), small.map((d) => d.i));
    const big = Array.from({ length: 10 }, (_, i) => ({ i, text: 'b'.repeat(1_000_000) }));
    const b2 = chunkBatches(big, { maxBytes: 4 * 1024 * 1024 });
    for (const b of b2) assert.ok(Buffer.byteLength(JSON.stringify(b)) <= 4 * 1024 * 1024);
    assert.equal(b2.flat().length, 10);
    assert.deepEqual(chunkBatches([]), []);
  });

  test('NSE rows, EQUITY_L, BSE scrip list, curated map, linked company PDF', async () => {
    const L = await import(libPath);
    const n = L.nseRowToFiling({ symbol: 'MANINDS', sm_name: 'Man Industries (India) Limited', desc: 'Analysts/Institutional Investor Meet/Con. Call Updates', attchmntText: 'Man Industries has informed the Exchange about Transcript of the earnings call', attchmntFile: 'https://nsearchives.nseindia.com/corporate/MANINDS_01062026.pdf', an_dt: '01-Jun-2026 17:42:11', sm_isin: 'INE993A01026' });
    assert.equal(n.nseSymbol, 'MANINDS');
    assert.equal(n.filedAt, '2026-06-01T12:12:11.000Z');
    assert.equal(L.classifySubject(n.subject, { headline: n.headline }), 'TRANSCRIPT');
    const eq = L.parseEquityL('SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE\nMANINDS,Man Industries (India) Limited,EQ,01-JAN-2000,5,1,INE993A01026,5\n');
    assert.equal(eq.get('INE993A01026'), 'MANINDS');
    assert.equal(L.parseBseScripList([{ SCRIP_CD: '513269', ISIN_NUMBER: 'INE993A01026' }]).get('513269'), 'INE993A01026');
    assert.equal(L.parseCuratedMap("{ nseSymbol: 'BLUEDART',   bseCode: '526612', shortName: 'x' }").get('526612'), 'BLUEDART');
    const cover = 'Dear Sir, the transcript of the earnings call is available at https://mangroup.com/wp-content/uploads/2026/06/Concall-Transcript_26.05.2026.pdf. Kindly take on record.';
    assert.equal(L.findLinkedPdf(cover), 'https://mangroup.com/wp-content/uploads/2026/06/Concall-Transcript_26.05.2026.pdf');
    assert.equal(L.findLinkedPdf('see https://www.bseindia.com/a.pdf'), null);
    assert.equal(L.findLinkedPdf('see http://10.0.0.1/a.pdf'), null);
    assert.equal(L.isUnreadableText('   \n\f\f  '), true);
    assert.equal(L.isUnreadableText(MAN_TEXT), false);
  });
});

// ── collector run with injected fetch + pdftotext ───────────────────────────

describe('collector run (injected I/O)', () => {
  test('BSE day → transcript downloaded, cue kept, cover letter follows company PDF, batches POSTed, status honest', async () => {
    const R = await import(runnerPath);
    const posts: any[] = [];
    const pdf = (tag: string) => Buffer.from(`%PDF-1.4 ${tag}`);
    const texts: Record<string, string> = {
      man: MAN_TEXT,
      cover: 'Dear Sir, transcript available at https://mangroup.com/wp-content/uploads/2026/06/Concall-Transcript_26.05.2026.pdf thank you',
      scan: '\f\f',
      boiler: `${'Pursuant to Regulation 30 please find enclosed the presentation. '.repeat(20)}`,
    };
    const rows = [
      { SCRIP_CD: 513269, SLONGNAME: 'Man Industries (India) Ltd', NEWSSUB: 'Earnings Call Transcript', HEADLINE: 'Transcript of earnings call Q4 FY26', NEWS_DT: '2026-10-02T17:00:00', ATTACHMENTNAME: 'man.pdf', PDFFLAG: 0 },
      { SCRIP_CD: 500001, SLONGNAME: 'Cover Co', NEWSSUB: 'Earnings Call Transcript', HEADLINE: 'Transcript', NEWS_DT: '2026-10-02T17:00:00', ATTACHMENTNAME: 'cover.pdf', PDFFLAG: 0 },
      { SCRIP_CD: 500002, SLONGNAME: 'Scan Co', NEWSSUB: 'Investor Presentation', NEWS_DT: '2026-10-02T17:00:00', ATTACHMENTNAME: 'scan.pdf', PDFFLAG: 0 },
      { SCRIP_CD: 500003, SLONGNAME: 'Boiler Co', NEWSSUB: 'Investor Presentation', NEWS_DT: '2026-10-02T17:00:00', ATTACHMENTNAME: 'boiler.pdf', PDFFLAG: 0 },
      { SCRIP_CD: 500004, SLONGNAME: 'Noise Co', NEWSSUB: 'Closure of Trading Window', NEWS_DT: '2026-10-02T17:00:00', ATTACHMENTNAME: 'tw.pdf', PDFFLAG: 0 },
    ];
    const resp = (body: any, status = 200, headers: Record<string, string> = {}) => new Response((typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)) as any, { status, headers });
    const fetchFake = async (url: string, init: any = {}) => {
      if (url.includes('/api/v1/guidance-docs/ingest')) {
        if ((init.method || 'GET') === 'POST') { posts.push(JSON.parse(init.body)); return resp({ ok: true, rejected: [] }); }
        return resp({ ok: true, known: [] });
      }
      if (url.includes('AnnSubCategoryGetData')) {
        const day = /strPrevDate=(\d{8})/.exec(url)![1];
        if (day === '20261002') return resp({ Table: rows, Table1: [{ ROWCNT: rows.length }] });
        if (day === '20261001') return resp('down', 503);         // BSE failed for this day
        return resp({ Table: [], Table1: [{ ROWCNT: 0 }] });
      }
      if (url.includes('nseindia.com/api/corporate-announcements')) return resp('blocked', 403);
      if (url === 'https://www.nseindia.com/') return resp('<html/>');
      if (url.includes('EQUITY_L')) return resp('SYMBOL,NAME,SERIES,DATE,PAID,LOT,ISIN NUMBER,FV\nMANINDS,Man,EQ,x,5,1,INE993A01026,5\n' + Array.from({ length: 600 }, (_, i) => `S${i},n,EQ,x,1,1,INE${String(i).padStart(6, '0')}A01,1`).join('\n'));
      if (url.includes('ListofScripData')) return resp([{ SCRIP_CD: '513269', ISIN_NUMBER: 'INE993A01026' }, ...Array.from({ length: 600 }, (_, i) => ({ SCRIP_CD: String(600000 + i), ISIN_NUMBER: `INE${String(i).padStart(6, '0')}A01` }))]);
      const m = /\/(man|cover|scan|boiler|tw)\.pdf$/.exec(url);
      if (m) return resp(pdf(m[1]), 200, { 'content-type': 'application/pdf' });
      if (url.startsWith('https://mangroup.com/')) return resp(pdf('man'), 200, { 'content-type': 'application/pdf' });
      return resp('nope', 404);
    };
    const pdftotext = async (buf: Buffer) => texts[buf.toString().split(' ')[1]] ?? '';
    const logs: string[] = [];
    const r = await R.run({
      fetch: fetchFake as any, pdftotext, sleep: async () => undefined, log: (s: string) => logs.push(s),
      env: { CRON_SECRET: 'x'.repeat(16), CRON_BASE_URL: 'https://app.test', DAYS: '3', BSE_MODE: 'sub', API_DELAY_MS: '0' },
      now: new Date('2026-10-02T12:00:00Z'),
    });
    const docs = posts.flatMap((p) => p.docs);
    assert.equal(docs.length, 2, 'man transcript + cover-linked company transcript');
    const man = docs.find((d: any) => d.url.endsWith('/man.pdf'));
    assert.equal(man.ticker, 'MANINDS');
    assert.equal(man.kind, 'TRANSCRIPT');
    assert.equal(man.periodHint, 'Q4 FY26');
    const linked = docs.find((d: any) => d.url.startsWith('https://mangroup.com/'));
    assert.equal(linked.exchangeUrl, 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/cover.pdf');
    assert.equal(linked.sourceHost, 'mangroup.com');
    const seen = posts.flatMap((p) => p.seen);
    assert.deepEqual(seen.map((s: any) => s.outcome).sort(), ['linked', 'no_cue', 'unreadable']);
    const status = posts.find((p) => p.status)!.status;
    const byDate = Object.fromEntries(status.days.map((d: any) => [d.date, d]));
    assert.equal(byDate['2026-10-02'].status, 'ok');
    assert.equal(byDate['2026-10-02'].matched, 4);
    assert.equal(byDate['2026-10-01'].status, 'failed', 'BSE 503 + NSE 403 is failed, not zero');
    assert.equal(byDate['2026-10-01'].filings, null);
    const cov = posts.find((p) => p.coverage)!.coverage;
    assert.equal(cov.market, 'IN');
    assert.equal(cov.days['2026-10-01'].status, 'failed');
    assert.equal(cov.days['2026-10-02'].docs, 2);
    assert.equal(r.counts.unreadable, 1);
    assert.equal(r.counts.noCue, 1);
    // logs carry counts, never document text or the secret
    const all = logs.join('\n');
    assert.ok(!all.includes('guiding for'));
    assert.ok(!all.includes('x'.repeat(16)));
    // every POST validates against the ingest contract
    for (const p of posts) assert.equal(validateIngestBody(p).ok, true);
    for (const p of posts) { const v = validateIngestBody(p); if (v.ok) assert.equal(v.rejected.length, 0); }
  });

  test('known docIds are not downloaded again', async () => {
    const R = await import(runnerPath);
    const url = 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/man.pdf';
    let pdfFetches = 0;
    const resp = (b: any, s = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: s });
    await R.run({
      fetch: (async (u: string, init: any = {}) => {
        if (u.includes('guidance-docs/ingest')) return (init.method === 'POST') ? resp({ ok: true }) : resp({ known: [sha20(url)] });
        if (u.includes('AnnSubCategoryGetData')) return resp({ Table: [{ SCRIP_CD: 513269, NEWSSUB: 'Earnings Call Transcript', NEWS_DT: '2026-10-02T17:00:00', ATTACHMENTNAME: 'man.pdf', PDFFLAG: 0 }], Table1: [{ ROWCNT: 1 }] });
        if (u.endsWith('.pdf')) { pdfFetches++; return resp('%PDF'); }
        return resp('x', 404);
      }) as any,
      pdftotext: async () => MAN_TEXT, sleep: async () => undefined, log: () => undefined,
      env: { CRON_SECRET: 'y'.repeat(16), DAYS: '1', BSE_MODE: 'all', API_DELAY_MS: '0' }, now: new Date('2026-10-02T12:00:00Z'),
    });
    assert.equal(pdfFetches, 0);
  });
});

// ── store + ingest validation ───────────────────────────────────────────────

describe('guidance-docs-store', () => {
  test('host policy: exchange / SEC hosts; company domain only via an exchange filing', () => {
    assert.ok(isAllowedDocUrl('https://www.bseindia.com/xml-data/corpfiling/AttachLive/a.pdf'));
    assert.ok(isAllowedDocUrl('https://nsearchives.nseindia.com/corporate/a.pdf'));
    assert.ok(isAllowedDocUrl('https://archives.nseindia.com/corporate/a.pdf'));
    assert.ok(isAllowedDocUrl('https://www.sec.gov/Archives/edgar/data/1/2/ex99.htm'));
    assert.ok(!isAllowedDocUrl('https://mangroup.com/a.pdf'));
    assert.ok(isAllowedDocUrl('https://mangroup.com/a.pdf', 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/c.pdf'));
    assert.ok(!isAllowedDocUrl('https://mangroup.com/a.pdf', 'https://evil.example.com/x'));
    assert.ok(!isAllowedDocUrl('https://127.0.0.1/a.pdf', 'https://www.bseindia.com/x.pdf'));
    assert.ok(!isAllowedDocUrl('https://fakebseindia.com/a.pdf'));
    assert.ok(!isAllowedDocUrl('http://localhost/a.pdf', 'https://www.bseindia.com/x.pdf'));
    assert.ok(!isAllowedDocUrl('javascript:alert(1)'));
  });

  test('validateIngestBody: strict shape, per-doc rejection, text capped, sourceHost derived', () => {
    const bad = validateIngestBody({ collector: 'x y', docs: [] });
    assert.equal(bad.ok, false);
    assert.equal(validateIngestBody({ collector: 'ok', docs: Array.from({ length: 26 }, () => doc()) }).ok, false);
    const v = validateIngestBody({
      collector: 'gh-india-guidance-docs',
      docs: [
        doc({ text: 'y'.repeat(130_000) + MAN_SNIPPET, sourceHost: 'lies.example' }),
        doc({ docId: 'ZZ' } as any),
        doc({ url: 'https://evil.example.com/a.pdf' }),
        doc({ kind: 'TWEET' } as any),
        doc({ ticker: 'man inds' } as any),
        doc({ text: 'short' }),
      ],
      seen: [{ docId: 'a'.repeat(20), outcome: 'no_cue' }, { docId: 'bad', outcome: 'no_cue' }, { docId: 'b'.repeat(20), outcome: 'whatever' }],
      status: { days: [{ date: '2026-10-01', source: 'BSE', status: 'failed', filings: 0, matched: 0 }, { date: 'x', source: 'BSE', status: 'ok' }] },
    });
    assert.ok(v.ok);
    if (!v.ok) return;
    assert.equal(v.body.docs.length, 1);
    assert.deepEqual(v.rejected.map((r) => r.i), [1, 2, 3, 4, 5]);
    assert.ok(v.body.docs[0].text!.length <= PASSAGE_CAP);
    assert.equal(v.body.docs[0].textChars, v.body.docs[0].text!.length);
    assert.equal(v.body.docs[0].originalChars, 130_000 + MAN_SNIPPET.length);
    assert.ok(v.body.docs[0].text!.includes('we are guiding for a consolidated revenue of ₹5,000 to ₹5,500 crore for FY27'));
    assert.equal(v.body.docs[0].sourceHost, 'bseindia.com');
    assert.equal(v.body.seen.length, 1);
    assert.equal(v.body.status!.days.length, 1);
    assert.equal(v.body.status!.days[0].filings, null, 'a failed day never reports 0 filings');
  });

  test('ingest → listDocs / getDoc / markExtracted; dedupe by docId keeps extracted flag; TTL 120d', async () => {
    const kv = fakeKv();
    const now = new Date('2026-10-02T10:00:00Z');
    const a = doc();
    const b = doc({ url: 'https://www.bseindia.com/xml-data/corpfiling/AttachLive/b.pdf', docId: sha20('https://www.bseindia.com/xml-data/corpfiling/AttachLive/b.pdf'), kind: 'PRESENTATION', filedAt: '2026-08-13T10:00:00.000Z', ticker: null });
    const us = doc({ url: 'https://www.sec.gov/Archives/edgar/data/1/x/ex991.htm', docId: sha20('https://www.sec.gov/Archives/edgar/data/1/x/ex991.htm'), market: 'US', ticker: 'ACME', bseCode: null, cik: '1', kind: 'RESULTS_RELEASE', filedAt: '2026-09-30T10:00:00.000Z' } as any);
    const v = validateIngestBody({ collector: 'gh-india-guidance-docs', docs: [a, b, us, a] });
    assert.ok(v.ok);
    if (!v.ok) return;
    const r = await ingestDocs(v.body, kv, now);
    assert.equal(r.stored, 3);
    assert.equal(kv.store.get(docKey(a.docId))!.ttl, DOC_TTL_S);
    assert.equal(DOC_TTL_S, 120 * 86_400);
    const all = await listDocs({}, kv, now);
    assert.deepEqual(all.map((x) => x.docId), [us.docId, b.docId, a.docId]);
    assert.equal((all[0] as any).text, undefined, 'index rows never carry text');
    assert.deepEqual((await listDocs({ market: 'IN' }, kv, now)).map((x) => x.docId), [b.docId, a.docId]);
    assert.deepEqual((await listDocs({ market: 'IN', sinceDays: 60 }, kv, now)).map((x) => x.docId), [b.docId]);
    assert.deepEqual((await listDocs({ kinds: ['PRESENTATION'] }, kv, now)).map((x) => x.docId), [b.docId]);
    const got = await getDoc(a.docId, kv);
    assert.ok(got && got.text!.includes('₹5,000 to ₹5,500 crore'));
    assert.equal(await getDoc('nope', kv), null);
    assert.equal(await markExtracted(a.docId, kv, now), true);
    assert.equal(await markExtracted('f'.repeat(20), kv, now), false);
    // the extractor's own index also hides a doc whose flag got lost
    await kv.set(EXTRACT_INDEX_KEY, [b.docId]);
    assert.deepEqual((await listDocs({ unextractedOnly: true }, kv, now)).map((x) => x.docId), [us.docId]);
    // re-ingest of a: replaced, flag kept, no duplicate row
    const v2 = validateIngestBody({ collector: 'gh-india-guidance-docs', docs: [doc({ title: 'Updated title' })] });
    assert.ok(v2.ok);
    if (!v2.ok) return;
    await ingestDocs(v2.body, kv, now);
    const idx = (await kv.get<any>(DOCS_INDEX_KEY)).rows;
    assert.equal(idx.filter((x: any) => x.docId === a.docId).length, 1);
    assert.equal(idx.find((x: any) => x.docId === a.docId).extracted, true);
    assert.equal((await getDoc(a.docId, kv))!.title, 'Updated title');
  });

  test('index cap keeps the newest rows; seen + known ids; status merge never lets a failure erase a read', async () => {
    const now = new Date('2026-10-02T10:00:00Z');
    const many = Array.from({ length: INDEX_CAP + 5 }, (_, i) => doc({ docId: i.toString(16).padStart(20, '0'), filedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }));
    const idx = mergeIndex(null, many as any, now);
    assert.equal(idx.rows.length, INDEX_CAP);
    assert.equal(idx.rows[0].docId, (INDEX_CAP + 4).toString(16).padStart(20, '0'));
    const kv = fakeKv();
    const v = validateIngestBody({ collector: 'gh-india-guidance-docs', docs: [doc()], seen: [{ docId: 'c'.repeat(20), outcome: 'unreadable' }], status: { days: [{ date: '2026-10-01', source: 'BSE', status: 'ok', filings: 120, matched: 9 }] } });
    assert.ok(v.ok);
    if (!v.ok) return;
    await ingestDocs(v.body, kv, now);
    const known = await knownDocIds(kv, 'IN');
    assert.ok(known.includes(doc().docId) && known.includes('c'.repeat(20)));
    const later = mergeStatus(await readCollectorStatus(kv, 'gh-india-guidance-docs'), 'gh-india-guidance-docs', { days: [{ date: '2026-10-01', source: 'NONE', status: 'failed', filings: null, matched: null }, { date: '2026-09-30', source: 'NONE', status: 'failed', filings: null, matched: null }] }, now);
    assert.equal(later.days.find((d) => d.date === '2026-10-01')!.status, 'ok');
    assert.equal(later.days.find((d) => d.date === '2026-09-30')!.status, 'failed');
  });

  test('validateDoc: US doc on sec.gov accepted; ingest route prefix is protected', () => {
    const v = validateDoc(doc({ url: 'https://www.sec.gov/Archives/edgar/data/320193/x/ex99-1.htm', docId: sha20('https://www.sec.gov/Archives/edgar/data/320193/x/ex99-1.htm'), market: 'US', ticker: 'AAPL', bseCode: null, cik: '320193', kind: 'RESULTS_RELEASE' } as any), 'edgar');
    assert.ok(v.ok);
    assert.ok(isProtectedApi('/api/v1/guidance-docs/ingest'));
    assert.ok(isProtectedApi('/api/v1/guidance-docs'));
  });
});

// ── wave 2: storage discipline + coverage ───────────────────────────────────

describe('wave 2: passages, compression, text drop, coverage', () => {
  const BOILER = 'The Company has complied with the requirements of the Listing Regulations and the Board has noted the same. ';
  const buried = () => {
    const pre = BOILER.repeat(Math.ceil(110_000 / BOILER.length));
    const post = BOILER.repeat(Math.ceil(95_000 / BOILER.length));
    return `MAN INDUSTRIES (INDIA) LIMITED\nTranscript of the earnings call\n${pre}\n${MAN_SNIPPET}\n${post}`;
  };

  test('selectGuidancePassages keeps the Man Industries guidance sentence buried in 200k chars, ≤ 30k, verbatim', () => {
    const t = buried();
    assert.ok(t.length > 200_000);
    const p = selectGuidancePassages(t);
    assert.ok(p.length <= PASSAGE_CAP, `got ${p.length}`);
    assert.ok(p.startsWith('MAN INDUSTRIES (INDIA) LIMITED'), 'first 2k chars kept');
    assert.ok(p.includes('we are guiding for a consolidated revenue of ₹5,000 to ₹5,500 crore for FY27 with EBITDA margins of 13% to 15%'));
    assert.ok(p.includes('FY28 could see around 25% to 30% growth from FY27'));
    for (const part of p.split(PASSAGE_SEP)) assert.ok(t.includes(part), 'every passage is a verbatim excerpt');
    // short text untouched
    assert.equal(selectGuidancePassages(MAN_TEXT), MAN_TEXT);
    // strong cues are preferred over a wall of weak "%" / "crore" tables
    const table = Array.from({ length: 4000 }, (_, i) => `Segment ${i} revenue 12.5% crore 100`).join('\n');
    const p2 = selectGuidancePassages(`${table}\nWe reaffirm our full-year outlook of 18% growth.\n${table}`);
    assert.ok(p2.length <= PASSAGE_CAP);
    assert.ok(p2.includes('We reaffirm our full-year outlook of 18% growth.'));
  });

  test('gzip round-trip: stored compressed (textEnc gz64), getDoc returns the text, storageStats counts bytes', async () => {
    assert.equal(decodeText(encodeText('₹5,000 crore — FY27')), '₹5,000 crore — FY27');
    const kv = fakeKv();
    const v = validateIngestBody({ collector: 'gh-india-guidance-docs', market: 'IN', docs: [doc({ text: buried() })] });
    assert.ok(v.ok);
    if (!v.ok) return;
    await ingestDocs(v.body, kv, new Date('2026-10-02T10:00:00Z'));
    const raw = kv.store.get(docKey(doc().docId))!.v;
    assert.equal(raw.textEnc, 'gz64');
    assert.equal(raw.text, undefined);
    assert.ok(raw.textGz.length < 30_000);
    const got = await getDoc(doc().docId, kv);
    assert.ok(got!.text!.includes('we are guiding for a consolidated revenue of ₹5,000 to ₹5,500 crore'));
    assert.equal(got!.textChars, got!.text!.length);
    const st = await storageStats(kv);
    assert.equal(st.docs, 1);
    assert.equal(st.textBytes, raw.textGz.length);
    assert.equal(st.byMarket.IN.docs, 1);
  });

  test('markExtracted drops the text only after a successful final extract result', async () => {
    const kv = fakeKv();
    const now = new Date('2026-10-02T10:00:00Z');
    const v = validateIngestBody({ collector: 'gh-india-guidance-docs', docs: [doc()] });
    assert.ok(v.ok);
    if (!v.ok) return;
    await ingestDocs(v.body, kv, now);
    const id = doc().docId;
    // an errored result: flag set, text kept
    await kv.set(`guidance-extract:v1:${id}`, { status: 'error' });
    assert.equal(await markExtracted(id, kv, now), true);
    assert.ok((await getDoc(id, kv))!.text!.length > 0);
    // an ok result: text dropped, metadata + url kept
    await kv.set(`guidance-extract:v1:${id}`, { status: 'ok', rows: [] });
    assert.equal(await markExtracted(id, kv, now), true);
    const after = await getDoc(id, kv);
    assert.ok(after);
    assert.equal(after!.text, undefined);
    assert.equal(after!.url, doc().url);
    assert.equal(kv.store.get(docKey(id))!.v.textGz, undefined);
    assert.equal((await storageStats(kv)).textBytes, 0);
    assert.equal((await listDocs({}, kv, now))[0].extracted, true);
  });

  test('coverage: US payload stored, failed never overwrites ok, >140 days older than newest dropped; IN from the collector', async () => {
    const kv = fakeKv();
    const now = new Date('2026-10-02T10:00:00Z');
    const v = validateIngestBody({ market: 'US', collector: 'gh:edgar-guidance-backfill', docs: [], coverage: { market: 'US', days: { '2026-10-01': { status: 'ok', filings: 300, docs: 12, at: '2026-10-02T01:00:00Z' }, '2026-06-01': { status: 'partial', filings: 1, docs: 0 }, bad: { status: 'ok' } } } });
    assert.ok(v.ok);
    if (!v.ok) return;
    const r = await ingestDocs(v.body, kv, now);
    assert.equal(r.coverageDays, 2);
    assert.equal(kv.store.get(coverageKey('US'))!.ttl, 150 * 86_400);
    const v2 = validateIngestBody({ market: 'US', collector: 'gh:edgar-guidance-backfill', docs: [], coverage: { market: 'US', days: { '2026-10-01': { status: 'failed' }, '2026-09-30': { status: 'failed' } } } });
    assert.ok(v2.ok);
    if (!v2.ok) return;
    await ingestDocs(v2.body, kv, now);
    const cov = await readCoverage(kv, 'US');
    assert.equal(cov!.v, 1);
    assert.equal(cov!.market, 'US');
    assert.equal(cov!.days['2026-10-01'].status, 'ok');
    assert.equal(cov!.days['2026-09-30'].status, 'failed');
    const pruned = mergeCoverage(cov, 'US', { '2026-12-01': { status: 'ok' } }, now);
    assert.equal(pruned.days['2026-06-01'], undefined);
    assert.equal(cov!.days['2026-06-01'].status, 'partial');
    // a US doc posted under market IN is rejected
    const mix = validateIngestBody({ market: 'IN', collector: 'x1', docs: [doc({ url: 'https://www.sec.gov/a.htm', docId: sha20('https://www.sec.gov/a.htm'), market: 'US' } as any)] });
    assert.ok(mix.ok && mix.body.docs.length === 0 && mix.rejected[0].reason.includes('market'));
    // India collector rows
    const R = await import(runnerPath);
    const rows = R.coverageRows([{ date: '2026-10-02', status: 'ok', filings: 40, stored: 3 }, { date: '2026-10-01', status: 'failed', filings: null }, { date: '2026-09-30', status: 'ok', filings: 9, stored: 0, partial: true }], 'T');
    assert.deepEqual(rows['2026-10-02'], { status: 'ok', filings: 40, docs: 3, at: 'T' });
    assert.equal(rows['2026-10-01'].status, 'failed');
    assert.equal(rows['2026-09-30'].status, 'partial');
  });
});
