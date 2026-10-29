// zzz924 — re-collect resolves the BSE scrip code of a symbol-only, BSE-only company.
// Run: npx tsx --test src/lib/__tests__/zzz924-bse-resolve.test.ts
// No network: fetch and pdftotext are injected fakes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPTS = join(__dirname, '..', '..', '..', '..', '.github', 'scripts');
const libPath = pathToFileURL(join(SCRIPTS, 'guidance-docs-lib.mjs')).href;
const runnerPath = pathToFileURL(join(SCRIPTS, 'scrape-guidance-docs.mjs')).href;

const TRANSCRIPT = (company: string, quote: string) => `${company}\nQ1 FY27 Earnings Conference Call\nAugust 13, 2026\n\nModerator: Ladies and gentlemen, good day.\n${'Management: The quarter saw strong demand across our businesses and we continue to invest in capacity. '.repeat(40)}\nManagement: ${quote}\n`;

describe('zzz924 helpers', () => {
  test('validBseCode: six digits starting with 5 only', async () => {
    const L = await import(libPath);
    assert.equal(L.validBseCode('543711'), '543711');
    assert.equal(L.validBseCode(' 512345 '), '512345');
    for (const bad of ['443711', '54371', '5437111', 'ABC123', '', null, undefined, '5x3711']) assert.equal(L.validBseCode(bad), null);
  });
  test('parseBseScripIds: trading id → code, ambiguous / invalid ids dropped', async () => {
    const L = await import(libPath);
    const m = L.parseBseScripIds([
      { SCRIP_CD: '543711', scrip_id: 'mobavenue' }, { SCRIP_CD: '513502', scrip_id: 'BAROEXT' },
      { SCRIP_CD: '500001', scrip_id: 'TWIN' }, { SCRIP_CD: '500002', scrip_id: 'TWIN' },
      { SCRIP_CD: '400001', scrip_id: 'BADCODE' }, { SCRIP_CD: '500003', scrip_id: '' },
    ]);
    assert.equal(m.get('MOBAVENUE'), '543711'); assert.equal(m.get('BAROEXT'), '513502');
    assert.equal(m.has('TWIN'), false); assert.equal(m.has('BADCODE'), false); assert.equal(m.size, 2);
    assert.equal(L.parseBseScripIds(null).size, 0);
  });
});

describe('zzz924 collector run: BSE code resolution in re-collect', () => {
  const resp = (b: any, status = 200, headers: Record<string, string> = {}) => new Response((typeof b === 'string' || Buffer.isBuffer(b) ? b : JSON.stringify(b)) as any, { status, headers });
  const bseRow = (code: string, name: string, file: string) => ({ SCRIP_CD: code, SLONGNAME: name, NEWSSUB: 'Transcript of the earnings call', HEADLINE: 'Earnings call transcript', ATTACHMENTNAME: `${file}.pdf`, PDFFLAG: '0', NEWS_DT: '2026-08-14T10:00:00', CATEGORYNAME: 'Company Update', SUBCATNAME: 'Earnings Call Transcript' });
  const scripList = (extra: any[]) => [...Array.from({ length: 520 }, (_, i) => ({ SCRIP_CD: String(500100 + i), ISIN_NUMBER: `INE${String(1000000 + i)}01`, scrip_id: `FILL${i}` })), ...extra];
  const screenerHtml = (name: string, bse: string, nse?: string) => `<html><title>${name} share price</title><a href="https://www.bseindia.com/stock-share-price/x/y/${bse}/">BSE</a>${nse ? `<a href="https://www.nseindia.com/get-quotes/equity?symbol=${nse}">NSE</a>` : ''}<h2>Concalls</h2><ul></ul></html>`;
  const texts: Record<string, string> = { 'moba-aug': TRANSCRIPT('MOBAVENUE AI TECH LIMITED', 'Management expects 40% revenue growth in FY27.'), 'brpl-aug': TRANSCRIPT('BRPL LIMITED', 'Management expects 25% revenue growth in FY27.') };

  function harness(o: { scrip?: any[]; screener?: Record<string, string>; bse?: Record<string, any[]> } = {}) {
    const asked: string[] = []; const posts: any[] = [];
    const fetchFake = async (url: string, init: any = {}) => {
      asked.push(url);
      if (url.includes('/api/v1/guidance-docs/ingest')) { if ((init.method || 'GET') === 'POST') { posts.push(JSON.parse(init.body)); return resp({ ok: true, stored: JSON.parse(init.body).docs?.length || 0, rejected: [] }); } return resp({ ok: true, known: [], intimations: [], queueTickers: [] }); }
      if (url.includes('/api/v1/guidance-pipeline')) return resp({ wanted: [] });
      if (url === 'https://www.nseindia.com/') return resp('<html/>');
      if (url.includes('nseindia.com/api/corporate-announcements')) return resp([]);
      if (url.includes('ListofScripData')) return resp(scripList(o.scrip || []));
      if (url.includes('AnnSubCategoryGetData')) {
        const code = /strScrip=(\d+)/.exec(url)?.[1] || '';
        return resp({ Table: o.bse?.[code] || [], Table1: [{ ROWCNT: (o.bse?.[code] || []).length }] });
      }
      if (url.startsWith('https://www.screener.in/company/')) {
        const sym = decodeURIComponent(url.split('/company/')[1].split('/')[0]);
        return o.screener?.[sym] ? resp(o.screener[sym]) : resp('not found', 404);
      }
      if (url.startsWith('https://www.screener.in/api/company/search')) return resp([]);
      const m = /\/([a-z-]+)\.pdf$/.exec(url);
      if (m && texts[m[1]]) return resp(Buffer.from(`%PDF-1.4 ${m[1]}`), 200, { 'content-type': 'application/pdf' });
      return resp('nope', 404);
    };
    const pdftotext = async (buf: Buffer) => texts[buf.toString().split(' ')[1]] ?? '';
    return { asked, posts, fetchFake, pdftotext };
  }
  const baseEnv = { CRON_SECRET: 'x'.repeat(16), CRON_BASE_URL: 'https://app.test', API_DELAY_MS: '0', SCREENER_DELAY_MS: '0', BSE_MODE: 'sub', GITHUB_EVENT_NAME: 'workflow_dispatch' };
  const now = new Date('2026-10-03T12:00:00Z');
  const go = async (h: any, tickers: string, extraEnv: any = {}) => {
    const R = await import(runnerPath); const logs: string[] = [];
    const r = await R.run({ fetch: h.fetchFake, pdftotext: h.pdftotext, sleep: async () => undefined, log: (s: string) => logs.push(s), env: { ...baseEnv, RECOLLECT_TICKERS: tickers, ...extraEnv }, now });
    return { r, logs };
  };

  test('resolves through the BSE scrip list, lists BSE filings for that code, logs the source', async () => {
    const h = harness({ scrip: [{ SCRIP_CD: '543711', ISIN_NUMBER: 'INE999999991', scrip_id: 'MOBAVENUE' }], bse: { '543711': [bseRow('543711', 'Mobavenue AI Tech Ltd', 'moba-aug')] } });
    const { logs } = await go(h, 'MOBAVENUE');
    assert.ok(logs.includes('recollect: MOBAVENUE: BSE code 543711 (resolved via BSE scrip list)'), logs.join('\n'));
    assert.ok(h.asked.some((u) => u.includes('AnnSubCategoryGetData') && u.includes('strScrip=543711')));
    const docs = h.posts.flatMap((p) => p.docs);
    assert.equal(docs.length, 1); assert.equal(docs[0].ticker, 'MOBAVENUE'); assert.equal(h.posts.find((p) => p.docs.length)?.reextract, true);
  });

  test('falls back to the Screener.in page when the scrip list has no such id', async () => {
    const h = harness({ screener: { BRPL: screenerHtml('BRPL Ltd', '539999') }, bse: { '539999': [bseRow('539999', 'BRPL Ltd', 'brpl-aug')] } });
    const { logs } = await go(h, 'BRPL');
    assert.ok(logs.includes('recollect: BRPL: BSE code 539999 (resolved via Screener.in)'), logs.join('\n'));
    assert.equal(h.posts.flatMap((p) => p.docs).length, 1);
    assert.equal(h.asked.filter((u) => u.startsWith('https://www.screener.in/company/BRPL')).length, 1, 'one Screener lookup per company (page cached for the sweep)');
  });

  test('an explicit SYMBOL:CODE is used as given: no lookup at all', async () => {
    const h = harness({ bse: { '543711': [bseRow('543711', 'Mobavenue AI Tech Ltd', 'moba-aug')] } });
    const { logs } = await go(h, 'MOBAVENUE:543711');
    assert.ok(!logs.some((l) => l.includes('resolved via')));
    assert.ok(h.asked.some((u) => u.includes('strScrip=543711')));
  });

  test('unresolvable: no BSE listing, clear log line', async () => {
    const h = harness();
    const { logs, r } = await go(h, 'NOSUCHCO');
    assert.ok(logs.some((l) => l.startsWith('recollect: NOSUCHCO: listed 0 on NSE and no BSE code could be resolved')), logs.join('\n'));
    assert.ok(!h.asked.some((u) => u.includes('AnnSubCategoryGetData')));
    assert.equal(r.counts.recollectDocs, 0);
  });

  test('an invalid code (not 5xxxxx) or a Screener page for another NSE symbol is rejected', async () => {
    const h = harness({
      scrip: [{ SCRIP_CD: '443711', ISIN_NUMBER: 'INE999999992', scrip_id: 'BADONE' }],
      screener: { OTHERCO: screenerHtml('Some Other Ltd', '539000', 'DIFFERENT'), SHORTCD: screenerHtml('Short Ltd', '43999') },
    });
    const { logs } = await go(h, 'BADONE,OTHERCO,SHORTCD');
    for (const s of ['BADONE', 'OTHERCO', 'SHORTCD']) assert.ok(logs.some((l) => l.startsWith(`recollect: ${s}: listed 0 on NSE and no BSE code could be resolved`)), s);
    assert.ok(!h.asked.some((u) => u.includes('AnnSubCategoryGetData')));
  });

  test('a company that lists on NSE is never looked up (no BSE call, no Screener lookup for resolution)', async () => {
    const row = { symbol: 'BAROEXT', sm_name: 'Baroda Extrusion Ltd', desc: 'Analysts/Institutional Investor Meet/Con. Call Updates', attchmntText: 'Transcript of the earnings call', attchmntFile: 'https://nsearchives.nseindia.com/corporate/moba-aug.pdf', an_dt: '13-Aug-2026 18:00:00' };
    const h = harness();
    const base = h.fetchFake;
    h.fetchFake = async (url: string, init: any = {}) => (url.includes('corporate-announcements') && url.includes('symbol=BAROEXT') && url.includes('index=equities') ? (h.asked.push(url), resp([row])) : base(url, init));
    const { logs } = await go(h, 'BAROEXT', { SCREENER_MAX: '0' });
    assert.ok(!logs.some((l) => l.includes('BSE code')));
    assert.ok(!h.asked.some((u) => u.includes('AnnSubCategoryGetData')));
  });
});
