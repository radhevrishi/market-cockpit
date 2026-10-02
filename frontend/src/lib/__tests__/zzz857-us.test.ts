// zzz857 — US guidance RECALL: the GitHub EDGAR backfill's pure helpers (.github/scripts/edgar-guidance-backfill.mjs), the app-side
// backfill coverage + docId link (lib/us-edgar-backfill), the small live EDGAR window (scanUs), and the queue's hand-off of
// "numbers not found" documents to the AI extractor. Synthetic filings only (Zed …); no network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import * as B from '../../../../.github/scripts/edgar-guidance-backfill.mjs';
import { guidanceDocIdOf, parseSecFilingIndexUrl, isSecFilingIndexUrl, parseUsBackfillCoverage, backfillIndexedDays, US_BACKFILL_COVERAGE_KEY } from '../us-edgar-backfill';
import { scanUs, pickUsLiveDates, US_LIVE_SESSIONS_LONG, type EdgarDayFetcherWithBackfill } from '../guidance-upgrades-scan';
import { usSessionDates } from '../guidance-upgrades-candidates';
import { enqueue, emptyQueue, processQueue, extractorHandoffs, handedToExtractorCount, doneCandidates, type FetchDoc, type GuQueueItemX } from '../guidance-upgrades-queue';

const NOW = new Date('2026-10-02T15:00:00Z');

describe('1. 8-K item parsing and the efts hit', () => {
  test('items normalise; only a plain 8-K with 2.02 or 7.01 is kept', () => {
    assert.deepEqual(B.parseItems(['2.02', '9.01']), ['2.02', '9.01']);
    assert.deepEqual(B.parseItems('7.01, 9.01; Item 2.02'), ['7.01', '9.01', '2.02']);
    assert.deepEqual(B.parseItems(['x', '', null, '12', '2.2']), ['2.02']);
    assert.deepEqual(B.parseItems(undefined), []);
    assert.equal(B.isResultsOrRegFd('8-K', ['2.02', '9.01']), true);
    assert.equal(B.isResultsOrRegFd('8-K', ['7.01']), true);
    assert.equal(B.isResultsOrRegFd('8-K', ['5.02', '9.01']), false);
    assert.equal(B.isResultsOrRegFd('8-K/A', ['2.02']), false, 'an amendment re-files an earlier release');
    assert.equal(B.isResultsOrRegFd('10-Q', ['2.02']), false);
  });
  test('display name and archive URL use the COMPANY CIK, not the filing agent in the accession prefix', () => {
    assert.deepEqual(B.parseDisplayName('ZED WIDGETS INC  (ZZWD, ZZWD-PA)  (CIK 0000094845)'), { company: 'ZED WIDGETS INC', ticker: 'ZZWD', cik: '0000094845' });
    assert.deepEqual(B.parseDisplayName('Zed Credit Fund  (CIK 0002026448)'), { company: 'Zed Credit Fund', ticker: null, cik: '0002026448' });
    const f = B.filingFromHit({ _source: { display_names: ['ZED WIDGETS INC  (ZZWD)  (CIK 0000094845)'], ciks: ['0000094845'], adsh: '0001999371-26-021687', form: '8-K', items: ['7.01', '9.01'], file_date: '2026-09-30' } }, '2026-09-30')!;
    assert.equal(f.indexUrl, 'https://www.sec.gov/Archives/edgar/data/94845/000199937126021687/0001999371-26-021687-index.htm');
    assert.equal(f.cik, '0000094845'); assert.equal(f.filed, '2026-09-30'); assert.deepEqual(f.items, ['7.01', '9.01']);
    assert.equal(B.filingFromHit({ _source: { display_names: ['x'], adsh: 'bad' } }, '2026-09-30'), null);
    const m = B.cikTickerMapOf({ 0: { cik_str: 94845, ticker: 'zzwd', title: 'Zed' }, 1: { cik_str: 94845, ticker: 'ZZWD-PA' }, 2: { cik_str: 'x', ticker: 'NO' } });
    assert.equal(m.get(94845), 'ZZWD'); assert.equal(m.size, 1);
  });
  test('trading days skip weekends, newest first, capped at 130', () => {
    assert.deepEqual(B.tradingDays('2026-10-05', 3), ['2026-10-05', '2026-10-02', '2026-10-01']);
    assert.equal(B.tradingDays('2026-10-02', 500).length, 130);
    assert.equal(B.tradingDays('nope', 3).length, 0);
  });
});

const INDEX_HTML = `<table class="tableFile" summary="Document Format Files">
<tr><th scope="col">Seq</th><th scope="col">Description</th><th scope="col">Document</th><th scope="col">Type</th><th scope="col">Size</th></tr>
<tr><td scope="row">1</td><td scope="row">8-K</td><td scope="row"><a href="/ix?doc=/Archives/edgar/data/1/000000000126000001/zz-20260930.htm">zz-20260930.htm</a> &nbsp;<span>iXBRL</span></td><td scope="row">8-K</td><td scope="row">26263</td></tr>
<tr class="evenRow"><td scope="row">3</td><td scope="row">CFO COMMENTARY</td><td scope="row"><a href="/Archives/edgar/data/1/000000000126000001/zz-ex992.htm">zz-ex992.htm</a></td><td scope="row">EX-99.2</td><td scope="row">51,000</td></tr>
<tr><td scope="row">2</td><td scope="row">PRESS RELEASE</td><td scope="row"><a href="/Archives/edgar/data/1/000000000126000001/zz-ex991.htm">zz-ex991.htm</a></td><td scope="row">EX-99.1</td><td scope="row">244585</td></tr>
<tr><td scope="row">4</td><td scope="row">SLIDES</td><td scope="row"><a href="/Archives/edgar/data/1/000000000126000001/zz-ex993.pdf">zz-ex993.pdf</a></td><td scope="row">EX-99.3</td><td scope="row">900000</td></tr>
<tr><td scope="row">5</td><td scope="row"></td><td scope="row"><a href="/Archives/edgar/data/1/000000000126000001/zz_g1.jpg">zz_g1.jpg</a></td><td scope="row">GRAPHIC</td><td scope="row">61899</td></tr>
</table>`;

describe('2. exhibit picking', () => {
  test('the document table is read by column; EX-99.1 then EX-99.2, readable formats only', () => {
    const rows = B.parseFilingIndex(INDEX_HTML);
    assert.equal(rows.length, 5);
    assert.equal(rows[0].url, 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/zz-20260930.htm', 'the /ix?doc= viewer prefix is removed');
    assert.equal(rows[1].type, 'EX-99.2'); assert.equal(rows[1].size, 51000); assert.equal(rows[1].description, 'CFO COMMENTARY');
    const picked = B.pickExhibits(rows);
    assert.deepEqual(picked.map((r: any) => r.type), ['EX-99.1', 'EX-99.2']);
    assert.deepEqual(B.pickExhibits(rows, 1).map((r: any) => r.name), ['zz-ex991.htm']);
    // a bare EX-99 only when no .1/.2; pdf / graphics never
    assert.deepEqual(B.pickExhibits([{ name: 'a.htm', type: 'EX-99', url: 'u1' }, { name: 'b.pdf', type: 'EX-99.1', url: 'u2' }]).map((r: any) => r.url), ['u1']);
    assert.deepEqual(B.pickExhibits([{ name: 'a.jpg', type: 'GRAPHIC', url: 'u' }]), []);
  });
});

describe('3. HTML to text', () => {
  test('hidden XBRL, scripts and comments go; entities decode (hex too); tables keep rows on one line', () => {
    const html = `<html><head><title>t</title><style>p{}</style></head><body>
      <div style="display:none"><ix:header><ix:hidden>dei:EntityRegistrantName 2013</ix:hidden></ix:header></div>
      <script>var x = "Raises guidance";</script><!-- comment outlook -->
      <p>Zed Widgets&#160;Inc. &#x2013; Fiscal 2027 Outlook</p>
      <p>Revenue of &#36;1.2 billion to $1.3&nbsp;billion &amp; EPS &lt;b&gt; &rsquo;27&rsquo; &zzunknown; done</p>
      <table><tr><td>Net sales</td><td>$5.63 billion</td><td>$5.40 billion</td></tr><tr><td></td><td></td></tr></table>
      Line<br/>break</body></html>`;
    const t = B.htmlToText(html);
    assert.doesNotMatch(t, /EntityRegistrantName|var x|comment outlook|p\{\}/);
    assert.doesNotMatch(t, /x2013|&#|&nbsp;|&amp;/);
    assert.match(t, /Zed Widgets Inc\. – Fiscal 2027 Outlook/);
    assert.match(t, /Revenue of \$1\.2 billion to \$1\.3 billion & EPS <b> ’27’ {1,2}done/);
    assert.match(t, /^Net sales \| \$5\.63 billion \| \$5\.40 billion$/m);
    assert.match(t, /^Line$/m); assert.match(t, /^break$/m);
    assert.doesNotMatch(t, /^\s*\|\s*$/m, 'an empty table row leaves no bare separator line');
  });
  test('a .txt exhibit passes through with SEC markers removed', () => {
    assert.equal(B.htmlToText('<PAGE>\nZed sees FY27 revenue of $10 million.\n\n\nEnd'), 'Zed sees FY27 revenue of $10 million.\nEnd');
    assert.equal(B.decodeEntities('&#xD800;&#0;&#x1F600;'), '  \u{1F600}');
  });
});

describe('4. guidance cue filter', () => {
  const SAFE = 'Forward-Looking Statements\nThis press release contains forward-looking statements. Words such as expects, anticipates, outlook and guidance identify such statements and are subject to risks and uncertainties that could cause actual results to differ materially from those expressed or implied.';
  test('a cue counts only outside the safe-harbor boilerplate', () => {
    assert.equal(B.hasGuidanceCue(`Zed Widgets reports third quarter results. Revenue was $12 million.\n${SAFE}`), false);
    assert.equal(B.hasGuidanceCue(`Zed Widgets raises full-year guidance to $1.2 billion to $1.3 billion.\n${SAFE}`), true);
    for (const t of ['The company now sees revenue of $5 million', 'Fiscal 2027 Outlook\nNet sales: 4% to 6% growth', 'Zed reaffirms its adjusted EPS range of 2.10 to 2.30',
      'We expect revenue growth of 12%', 'Zed now anticipates gross margin of 41%', 'Zed reiterates revenue of $80M-$85M'])
      assert.equal(B.hasGuidanceCue(t), true, t);
    // wave 2: a cue with no figure within ~300 chars is not kept; "fiscal 2027" itself is not a figure
    for (const t of ['Zed Widgets raises full-year guidance.', 'Fiscal 2027 Outlook', 'Zed reaffirms its plan', 'Fiscal year 2026 results were strong across segments',
      'Zed Widgets announces a new director. The board approved the appointment.'])
      assert.equal(B.hasGuidanceCue(t), false, t);
    assert.equal(B.hasGuidanceCue(`Zed expects strong demand.${' filler'.repeat(80)} Revenue was $12 million.`), false, 'the figure is too far from the cue');
    assert.equal(B.hasGuidanceCue(`Revenue was $12 million.${' filler'.repeat(80)} Zed expects strong demand.`), false);
  });
  test('period hint from the head of the document; null when unsure', () => {
    assert.equal(B.periodHintOf('Zed Announces Second Quarter Fiscal 2027 Results'), 'Q2 FY27');
    assert.equal(B.periodHintOf('Zed Posts Fourth Quarter and Fiscal Year 2026 Results'), 'Q4 FY26');
    assert.equal(B.periodHintOf('Zed reports Q3 2026 results'), 'Q3 FY26');
    assert.equal(B.periodHintOf('Zed fiscal 2026 third quarter results'), 'Q3 FY26');
    assert.equal(B.periodHintOf('Zed updates full-year 2026 guidance'), 'FY26');
    assert.equal(B.periodHintOf('Zed announces a new credit agreement'), null);
  });
});

describe('5. docId and the GuidanceDoc', () => {
  const url = 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/zz-ex991.htm';
  test('docId = sha1(url) hex, first 20 chars — the same in the script and in the app', () => {
    const want = createHash('sha1').update(url).digest('hex').slice(0, 20);
    assert.equal(B.docIdOf(url), want); assert.equal(guidanceDocIdOf(url), want); assert.equal(want.length, 20);
    assert.notEqual(B.docIdOf(`${url}?x`), want);
  });
  test('the GuidanceDoc follows the shared contract', () => {
    const filing = B.filingFromHit({ _source: { display_names: ['Zed Widgets Inc  (ZZWD)  (CIK 0000000001)'], adsh: '0000000001-26-000001', form: '8-K', items: ['2.02', '9.01'], file_date: '2026-09-30' } }, '2026-09-30');
    const exhibit = { name: 'zz-ex991.htm', url, type: 'EX-99.1', description: 'PRESS RELEASE', size: 1 };
    const text = `Zed Widgets Announces Fourth Quarter Fiscal 2026 Results\nFiscal 2027 Outlook: revenue of $44.5 billion.\n${'x'.repeat(130_000)}`;
    const d = B.buildGuidanceDoc({ filing, exhibit, text, ticker: 'ZZWD', now: NOW });
    assert.equal(d.docId, guidanceDocIdOf(url)); assert.equal(d.market, 'US'); assert.equal(d.ticker, 'ZZWD'); assert.equal(d.cik, '0000000001');
    assert.equal(d.kind, 'RESULTS_RELEASE'); assert.equal(d.url, url); assert.equal(d.sourceHost, 'sec.gov'); assert.equal(d.filedAt, '2026-09-30');
    assert.equal(d.periodHint, 'Q4 FY26'); assert.equal(d.textChars, B.TEXT_CAP); assert.equal(d.text.length, B.TEXT_CAP);
    assert.equal(d.collectedAt, NOW.toISOString()); assert.equal(d.collector, 'gh:edgar-guidance-backfill');
    assert.match(d.title, /^Zed Widgets Inc: PRESS RELEASE \(8-K item 2\.02\)$/);
    assert.equal(B.kindOf(['7.01'], { name: 'zz-investorpresentation.htm', description: '' }), 'PRESENTATION');
    assert.equal(B.kindOf(['7.01'], { name: 'ex99.htm', description: 'Transcript of conference call' }), 'TRANSCRIPT');
    assert.equal(B.kindOf(['7.01'], { name: 'ex99.htm', description: 'Press release' }), 'RESULTS_RELEASE');
    assert.equal(B.kindOf(['7.01'], { name: 'ex99.htm', description: 'Letter to holders' }), 'OTHER_COMPANY_DOC');
  });
  test('batches are bounded by count and by size', () => {
    const docs = Array.from({ length: 40 }, (_, i) => ({ docId: String(i), text: 'y'.repeat(100_000) }));
    const b = B.batchBySize(docs, 1_500_000, 15);
    assert.ok(b.every((x: any[]) => x.length <= 14 && JSON.stringify(x).length <= 1_500_000 + 101_000));
    assert.equal(b.flat().length, 40);
    assert.deepEqual(B.batchBySize([], 10, 1), []);
  });
});

describe('6. coverage record', () => {
  test('per-day status; a failed re-run never un-reads an ok day; old days trimmed', () => {
    assert.equal(B.dayStatus({ indexOk: false, exhibitFailures: 0, postFailures: 0 }), 'failed');
    assert.equal(B.dayStatus({ indexOk: true, exhibitFailures: 1, postFailures: 0 }), 'partial');
    assert.equal(B.dayStatus({ indexOk: true, exhibitFailures: 0, postFailures: 0 }), 'ok');
    let c = B.mergeCoverage(null, { '2026-09-30': { status: 'ok', filings: 91, docs: 51 }, '2026-09-29': 'partial', bad: 'ok', '2026-09-28': 'weird' }, NOW);
    assert.deepEqual(Object.keys(c.days).sort(), ['2026-09-29', '2026-09-30']);
    c = B.mergeCoverage(c, { '2026-09-30': { status: 'failed' }, '2026-09-29': { status: 'ok', filings: 3, docs: 1 } }, NOW);
    assert.equal(c.days['2026-09-30'].status, 'ok'); assert.equal(c.days['2026-09-30'].docs, 51); assert.equal(c.days['2026-09-29'].status, 'ok');
    c = B.mergeCoverage(c, { '2026-04-01': 'ok' }, NOW, 140);
    assert.equal(c.days['2026-04-01'], undefined, 'older than 140 days before the newest day');
    assert.equal(c.v, 1); assert.equal(c.market, 'US');
  });
  test('the app reads the same record; only ok days count as indexed', () => {
    assert.equal(US_BACKFILL_COVERAGE_KEY, B.COVERAGE_KEY);
    const rec = B.mergeCoverage(null, { '2026-09-30': 'ok', '2026-09-29': 'partial', '2026-09-28': 'failed' }, NOW);
    assert.deepEqual([...backfillIndexedDays(parseUsBackfillCoverage(rec))], ['2026-09-30']);
    assert.deepEqual([...backfillIndexedDays(parseUsBackfillCoverage({ '2026-09-30': 'ok', '2026-09-29': 'ok', junk: 1 }))].sort(), ['2026-09-29', '2026-09-30']);
    assert.equal(parseUsBackfillCoverage(null), null); assert.equal(parseUsBackfillCoverage({ days: {} }), null);
  });
  test('SEC filing index URLs are recognised; exhibits and other hosts are not', () => {
    assert.deepEqual(parseSecFilingIndexUrl('https://www.sec.gov/Archives/edgar/data/94845/000199937126021687/0001999371-26-021687-index.htm'), { cikNum: 94845, accession: '0001999371-26-021687' });
    assert.equal(isSecFilingIndexUrl('https://www.sec.gov/Archives/edgar/data/1/000000000126000001/zz-ex991.htm'), false);
    assert.equal(isSecFilingIndexUrl('https://www.sec.gov/Archives/edgar/data/1/000000000126000002/0000000001-26-000001-index.htm'), false, 'folder and accession must agree');
    assert.equal(isSecFilingIndexUrl('https://example.com/0000000001-26-000001-index.htm'), false);
  });
});

describe('7. live EDGAR window + backfill coverage (scanUs)', () => {
  test('no backfill record: short windows read every session as before; long windows read a small recent window', () => {
    const s7 = usSessionDates(NOW, 7); const s120 = usSessionDates(NOW, 120);
    assert.deepEqual(pickUsLiveDates(s7, { long: false }), s7);
    assert.equal(pickUsLiveDates(s120, { long: true }).length, US_LIVE_SESSIONS_LONG);
    const bf = new Set(s7.slice(1));
    assert.deepEqual(pickUsLiveDates(s7, { long: false, backfill: bf }), s7.slice(0, 2), 'the newest two sessions are always read live');
  });
  test('120D: sessions the backfill indexed count as read; the live read stays small', async () => {
    const sessions = usSessionDates(NOW, 120); const calls: string[] = [];
    const base = { now: NOW, days: 120, window: '120D' as const, warmSessions: 0, totalSessions: sessions.length, warmDates: new Set<string>() };
    const without = await scanUs({ ...base, fetchEdgar: async () => [] });
    const withBf = await scanUs({ ...base, backfillIndexed: new Set(sessions), fetchEdgar: async (d) => { calls.push(d); return []; } });
    assert.ok(calls.length <= US_LIVE_SESSIONS_LONG, `live calls ${calls.length}`);
    const edgar = withBf.status.sources.find((s) => s.name.startsWith('SEC EDGAR'))!;
    assert.equal(edgar.state, 'COMPLETE'); assert.equal(edgar.daysOk!.length, sessions.length);
    assert.match(edgar.detail, /indexed by the GitHub EDGAR backfill/);
    assert.equal(withBf.status.daysCovered, 120); assert.ok(without.status.daysCovered < 40, `without ${without.status.daysCovered}`);
    assert.equal(withBf.status.complete, false, 'the graded cache is still empty, so the scan is not COMPLETE');
  });
  test('the real fetcher carries the reader; a partial backfill leaves the other days to the live read', async () => {
    const sessions = usSessionDates(NOW, 7); const calls: string[] = [];
    const fe: EdgarDayFetcherWithBackfill = async (d) => { calls.push(d); return []; };
    fe.backfillIndexed = async () => new Set(sessions.slice(2, 4));
    const r = await scanUs({ now: NOW, days: 7, warmSessions: 0, totalSessions: sessions.length, warmDates: new Set(), fetchEdgar: fe });
    assert.deepEqual(calls.sort(), sessions.filter((d, i) => i < 2 || i >= 4).sort());
    const edgar = r.status.sources[1];
    assert.equal(edgar.state, 'COMPLETE'); assert.equal(r.status.daysCovered, 2, 'two backfill days covered; the rest are neither graded nor indexed');
    // a backfill reader that throws changes nothing
    const fe2: EdgarDayFetcherWithBackfill = async () => []; fe2.backfillIndexed = async () => { throw new Error('kv down'); };
    const r2 = await scanUs({ now: NOW, days: 7, warmSessions: 0, totalSessions: sessions.length, warmDates: new Set(), fetchEdgar: fe2 });
    assert.equal(r2.status.daysCovered, 0); assert.equal(r2.status.sources[1].state, 'COMPLETE');
  });
});

describe('8. queue: "numbers not found" documents are handed to the AI extractor', () => {
  const IDX = 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/0000000001-26-000001-index.htm';
  const EX = 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/zz-ex991.htm';
  const NO_NUMBERS = 'Zed Widgets Inc announced results for its fiscal 2026 fourth quarter on September 30, 2026. Management discussed the outlook in general terms with investors and gave no figures for the year ahead, only commentary on demand, pricing and the order pipeline across its end markets.';
  test('the read exhibit links to the GuidanceDoc docId; a complete read is not handed off', async () => {
    const q0 = enqueue(emptyQueue(NOW), [
      { market: 'US', ticker: 'ZZWD', company: 'Zed Widgets Inc', sourceUrl: IDX, sourceType: 'SEC EDGAR', subject: 'Form 8-K earnings release (items 2.02 / 7.01)', eventDate: '2026-09-30', priority: 'P0' },
      { market: 'IN', ticker: 'ZZAA', company: 'Zed Alpha Ltd', sourceUrl: 'https://x.test/a.pdf', sourceType: 'NSE', subject: 'Investor Presentation', eventDate: '2026-09-29' },
    ], NOW).queue;
    const fetchDoc: FetchDoc = async (url) => url === IDX
      ? { ok: true, status: 200, contentType: 'text/html', text: NO_NUMBERS, resolvedUrl: EX }
      : { ok: true, status: 200, contentType: 'application/pdf', text: 'Zed Alpha Ltd investor presentation, May 2026. For FY27 the company expects revenue of Rs 500 crore to Rs 550 crore, up from Rs 400 crore in FY26, with EBITDA margin of 15% to 17%. The board and management discussed capacity, the order book and the outlook for exports in detail with analysts.' };
    const r = await processQueue(q0, { now: NOW, fetchDoc });
    assert.equal(r.done, 2);
    const us = r.queue.items.find((x) => x.market === 'US') as GuQueueItemX;
    assert.equal(us.result?.complete, false);
    assert.equal(us.doc_url, EX); assert.equal(us.doc_id, guidanceDocIdOf(EX));
    assert.deepEqual(us.handoff && { to: us.handoff.to, docId: us.handoff.docId, reason: us.handoff.reason }, { to: 'AI_EXTRACTOR', docId: B.docIdOf(EX), reason: 'NUMBERS_NOT_FOUND' });
    const rows = extractorHandoffs(r.queue);
    assert.deepEqual(rows.map((x) => [x.market, x.ticker, x.docId]), [['US', 'ZZWD', B.docIdOf(EX)]]);
    assert.equal(handedToExtractorCount(r.queue, 'US'), 1); assert.equal(handedToExtractorCount(r.queue, 'IN'), 0);
    const ind = r.queue.items.find((x) => x.market === 'IN') as GuQueueItemX;
    if (ind.result?.complete) { assert.equal(ind.handoff, null); assert.equal(doneCandidates(r.queue).length, 1); }
    assert.equal(ind.doc_id, guidanceDocIdOf('https://x.test/a.pdf'), 'without a resolved url the queued link is the document');
  });
});
