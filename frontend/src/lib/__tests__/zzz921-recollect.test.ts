// zzz921 — targeted re-collect of guidance documents (collector + store).
// Run: npx tsx --test src/lib/__tests__/zzz921-recollect.test.ts
// No network: fetch, pdftotext and KV are injected fakes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

import {
  ingestDocs, validateIngestBody, listDocs, getDoc, mergeIndex, clearExtraction, markExtracted,
  DOCS_INDEX_KEY, DOCS_INDEX_META_KEY, EXTRACT_INDEX_KEY, EXTRACT_OK_INDEX_KEY, docKey, DocsIndexUnreadableError, type DocsKv,
} from '../guidance-docs-store';
import type { GuidanceDoc } from '../guidance-docs-types';

const SCRIPTS = join(__dirname, '..', '..', '..', '..', '.github', 'scripts');
const libPath = pathToFileURL(join(SCRIPTS, 'guidance-docs-lib.mjs')).href;
const runnerPath = pathToFileURL(join(SCRIPTS, 'scrape-guidance-docs.mjs')).href;
const sha20 = (u: string) => createHash('sha1').update(u).digest('hex').slice(0, 20);

const TRANSCRIPT = (company: string, quote: string) => `${company}\nQ1 FY27 Earnings Conference Call\nAugust 13, 2026\n\nModerator: Ladies and gentlemen, good day.\n${'Management: The quarter saw strong demand across our businesses and we continue to invest in capacity. '.repeat(40)}\nManagement: ${quote}\n`;

function fakeKv(o: { strict?: boolean } = {}): DocsKv & { store: Map<string, any>; failGet: Set<string> } {
  const store = new Map<string, any>(); const failGet = new Set<string>();
  const kv: any = {
    store, failGet,
    get: async (k: string) => (failGet.has(k) ? null : store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null),
    set: async (k: string, v: any) => { store.set(k, JSON.parse(JSON.stringify(v))); },
    setNX: async (k: string, v: any) => { if (store.has(k)) return false; store.set(k, v); return true; },
    del: async (k: string) => { store.delete(k); },
    sleep: async () => undefined,
  };
  if (o.strict) kv.getStrict = async (k: string) => { if (failGet.has(k)) throw new Error('KV timeout'); return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null; };
  return kv;
}
const gdoc = (url: string, over: Partial<GuidanceDoc> = {}): GuidanceDoc => {
  const text = over.text ?? TRANSCRIPT('BARODA EXTRUSION LIMITED', 'Management expects minimum 35-40% revenue growth for FY27.');
  return { docId: sha20(url), market: 'IN', ticker: 'BAROEXT', company: 'Baroda Extrusion Ltd', kind: 'TRANSCRIPT', title: 'Transcript', url, sourceHost: 'nseindia.com', filedAt: '2026-08-14T12:00:00.000Z', periodHint: 'Q1 FY27', textChars: text.length, text, collectedAt: '2026-08-15T00:00:00.000Z', collector: 'gh-india-guidance-docs', ...over };
};
const body = (docs: GuidanceDoc[], over: any = {}) => ({ collector: 'gh-india-guidance-docs', market: 'IN' as const, docs, seen: [], status: null, coverage: null, ...over });

// ── pure collector helpers ──────────────────────────────────────────────────

describe('zzz921 collector helpers', () => {
  test('parseRecollectTickers: sanitised, de-duplicated, at most 30, symbols / BSE codes only', async () => {
    const L = await import(libPath);
    assert.deepEqual(L.parseRecollectTickers('mobavenue, BAROEXT ;utlsolar\nGKENERGY'), ['MOBAVENUE', 'BAROEXT', 'UTLSOLAR', 'GKENERGY']);
    assert.deepEqual(L.parseRecollectTickers('BAROEXT:513502,513502,bse:FROG,BAROEXT:513502'), ['BAROEXT:513502', '513502', 'FROG']);
    // anything that is not a symbol character is stripped: a shell / URL / path payload never survives as a token
    assert.ok(!L.parseRecollectTickers('FROG$(rm -rf /);`x`').some((t: string) => /[$();`/ ]/.test(t)));
    assert.deepEqual(L.parseRecollectTickers('!!!, ,'), []);
    assert.deepEqual(L.parseRecollectTickers(''), []);
    assert.deepEqual(L.parseRecollectTickers(undefined), []);
    const many = Array.from({ length: 80 }, (_, i) => `TK${i}`).join(',');
    assert.equal(L.parseRecollectTickers(many).length, 30);
    assert.equal(L.parseRecollectTickers(many, 99).length, 30, 'a larger max is clamped to 30');
    assert.equal(L.parseRecollectTickers(many, 5).length, 5);
  });
  test('recollectDays: default 120, 1..210', async () => {
    const L = await import(libPath);
    assert.equal(L.recollectDays(undefined), 120); assert.equal(L.recollectDays(''), 120); assert.equal(L.recollectDays('abc'), 120);
    assert.equal(L.recollectDays('0'), 120); assert.equal(L.recollectDays('-5'), 120); assert.equal(L.recollectDays('45'), 45);
    assert.equal(L.recollectDays('210'), 210); assert.equal(L.recollectDays('9999'), 210);
  });
  test('range urls', async () => {
    const L = await import(libPath);
    assert.equal(L.nseRangeUrl({ symbol: 'BAROEXT', from: '2026-06-05', to: '2026-10-03' }), 'https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=BAROEXT&from_date=05-06-2026&to_date=03-10-2026');
    assert.match(L.nseRangeUrl({ symbol: 'FROG', index: 'sme', from: '2026-06-05', to: '2026-10-03' }), /index=sme&symbol=FROG/);
    assert.match(L.bseScripRangeUrl({ scrip: '513502', from: '2026-06-05', to: '2026-10-03', page: 2 }), /pageno=2&strCat=-1&strPrevDate=20260605&strScrip=513502&strSearch=P&strToDate=20261003/);
  });
});

// ── store: validation ───────────────────────────────────────────────────────

describe('zzz921 ingest validation', () => {
  const d = gdoc('https://nsearchives.nseindia.com/corporate/a.pdf');
  test('reextract must be a boolean, needs market IN and at least one document', () => {
    assert.equal(validateIngestBody(body([d], { reextract: 'yes' })).ok, false);
    assert.equal(validateIngestBody(body([d], { reextract: 1 })).ok, false);
    assert.equal(validateIngestBody(body([], { reextract: true })).ok, false);
    assert.equal(validateIngestBody(body([d], { reextract: true, market: undefined })).ok, false);
    assert.equal(validateIngestBody(body([d], { reextract: true, market: 'US' })).ok, false);
    const ok = validateIngestBody(body([d], { reextract: true }));
    assert.ok(ok.ok); if (ok.ok) assert.equal(ok.body.reextract, true);
  });
  test('without the flag the body is unchanged (no reextract key)', () => {
    const ok = validateIngestBody(body([d]));
    assert.ok(ok.ok); if (ok.ok) assert.ok(!('reextract' in ok.body));
    const f = validateIngestBody(body([d], { reextract: false }));
    assert.ok(f.ok); if (f.ok) assert.ok(!('reextract' in f.body));
  });
  test('a document of another market is rejected one by one, not stored for re-extraction', () => {
    const us: any = { ...d, market: 'US', docId: sha20('https://www.sec.gov/x.htm'), url: 'https://www.sec.gov/x.htm', ticker: 'AAPL' };
    const v = validateIngestBody(body([d, us], { reextract: true }));
    assert.ok(v.ok); if (v.ok) { assert.equal(v.body.docs.length, 1); assert.equal(v.rejected.length, 1); }
  });
});

// ── store: re-ingest makes the document unextracted again ────────────────────

describe('zzz921 ingest with reextract', () => {
  const U1 = 'https://nsearchives.nseindia.com/corporate/baroext-aug.pdf';
  const U2 = 'https://nsearchives.nseindia.com/corporate/other-aug.pdf';
  const now = new Date('2026-10-06T00:00:00Z');

  /** two documents read under the old rules: text dropped, rows flagged extracted, results + indexes present */
  async function seeded(strict: boolean) {
    const kv = fakeKv({ strict });
    const a = gdoc(U1); const b = gdoc(U2, { ticker: 'OTHER', company: 'Other Ltd' });
    await ingestDocs(body([a, b]), kv, now);
    for (const x of [a, b]) {
      kv.store.set(`guidance-extract:v1:${x.docId}`, { docId: x.docId, market: 'IN', filedAt: x.filedAt, status: 'ok', rows: [] });
      kv.store.set(`guidance-extract:v1:fail:${x.docId}`, { attempts: 2, retryAfter: '2099-01-01T00:00:00Z' });
      assert.equal(await markExtracted(x.docId, kv, now), true);
    }
    kv.store.set(EXTRACT_INDEX_KEY, [b.docId, a.docId]);
    kv.store.set(EXTRACT_OK_INDEX_KEY, [a.docId, b.docId]);
    return { kv, a, b };
  }

  test('the old state: extracted, text dropped, listed as done', async () => {
    const { kv, a } = await seeded(true);
    assert.equal(kv.store.get(DOCS_INDEX_KEY).rows.find((r: any) => r.docId === a.docId).extracted, true);
    assert.equal(kv.store.get(docKey(a.docId)).textDropped, true);
    assert.equal((await getDoc(a.docId, kv))?.text, undefined);
    assert.equal((await listDocs({ market: 'IN', unextractedOnly: true }, kv, now)).length, 0);
  });

  for (const strict of [true, false]) {
    test(`reextract: text stored again, row unextracted, only that document's extractor state cleared (strict reads: ${strict})`, async () => {
      const { kv, a, b } = await seeded(strict);
      const r = await ingestDocs(body([a], { reextract: true }), kv, now);
      assert.equal(r.stored, 1); assert.equal(r.reextracted, 1);
      // the stored document has its text again and is no longer marked dropped
      const got = await getDoc(a.docId, kv);
      assert.ok(got?.text && got.text.includes('35-40% revenue growth'));
      assert.ok(!kv.store.get(docKey(a.docId)).textDropped);
      // index row: unextracted, text bytes restored; the other row is untouched
      const rows = kv.store.get(DOCS_INDEX_KEY).rows;
      const ra = rows.find((x: any) => x.docId === a.docId); const rb = rows.find((x: any) => x.docId === b.docId);
      assert.ok(!ra.extracted); assert.ok(ra.textBytes > 0);
      assert.equal(rb.extracted, true); assert.equal(rb.textBytes, 0);
      assert.equal(rows.length, 2, 'no row lost');
      assert.equal(kv.store.get(DOCS_INDEX_META_KEY).rows, 2);
      // extractor state for that document gone; the other document's kept
      assert.equal(kv.store.has(`guidance-extract:v1:${a.docId}`), false);
      assert.equal(kv.store.has(`guidance-extract:v1:fail:${a.docId}`), false);
      assert.equal(kv.store.has(`guidance-extract:v1:${b.docId}`), true);
      assert.equal(kv.store.has(`guidance-extract:v1:fail:${b.docId}`), true);
      assert.deepEqual(kv.store.get(EXTRACT_INDEX_KEY), [b.docId]);
      assert.deepEqual(kv.store.get(EXTRACT_OK_INDEX_KEY), [b.docId]);
      // and the extractor's queue now lists exactly that document
      const queue = await listDocs({ market: 'IN', unextractedOnly: true }, kv, now);
      assert.deepEqual(queue.map((x) => x.docId), [a.docId]);
    });
  }

  test('a normal re-ingest (no flag) keeps the extracted flag and clears nothing', async () => {
    const { kv, a } = await seeded(true);
    const r = await ingestDocs(body([a]), kv, now);
    assert.equal(r.reextracted, undefined);
    assert.equal(kv.store.get(DOCS_INDEX_KEY).rows.find((x: any) => x.docId === a.docId).extracted, true);
    assert.equal(kv.store.has(`guidance-extract:v1:${a.docId}`), true);
    assert.deepEqual(kv.store.get(EXTRACT_INDEX_KEY).length, 2);
  });

  test('a brand-new document with reextract is simply stored (nothing to clear)', async () => {
    const kv = fakeKv({ strict: true });
    const n = gdoc('https://nsearchives.nseindia.com/corporate/new.pdf');
    const r = await ingestDocs(body([n], { reextract: true }), kv, now);
    assert.equal(r.stored, 1);
    assert.ok(!kv.store.get(DOCS_INDEX_KEY).rows[0].extracted);
  });

  test('index integrity: an index read that fails still refuses to overwrite (503 path), and clears nothing', async () => {
    const { kv, a } = await seeded(true);
    kv.failGet.add(DOCS_INDEX_KEY);
    await assert.rejects(() => ingestDocs(body([a], { reextract: true }), kv, now), DocsIndexUnreadableError);
    assert.equal(kv.store.get(DOCS_INDEX_KEY).rows.length, 2);
    assert.equal(kv.store.has(`guidance-extract:v1:${a.docId}`), true, 'extractor state untouched');
  });

  test('an extractor index that cannot be read fails the request instead of leaving the document skipped', async () => {
    const { kv, a } = await seeded(true);
    kv.failGet.add(EXTRACT_INDEX_KEY);
    await assert.rejects(() => ingestDocs(body([a], { reextract: true }), kv, now), DocsIndexUnreadableError);
    // retrying once the read works completes the job (idempotent)
    kv.failGet.delete(EXTRACT_INDEX_KEY);
    const r = await ingestDocs(body([a], { reextract: true }), kv, now);
    assert.equal(r.reextracted, 1);
    assert.deepEqual(kv.store.get(EXTRACT_INDEX_KEY).filter((id: string) => id === a.docId), []);
  });

  test('mergeIndex: resetExtracted only affects the named ids', () => {
    const a = gdoc(U1); const b = gdoc(U2, { ticker: 'OTHER' });
    const prev = { updatedAt: '', rows: [{ ...mergeIndex(null, [a], now).rows[0], extracted: true }, { ...mergeIndex(null, [b], now).rows[0], extracted: true }] };
    const out = mergeIndex(prev, [a, b], now, 100, undefined, new Set([a.docId]));
    assert.ok(!out.rows.find((r) => r.docId === a.docId)!.extracted);
    assert.equal(out.rows.find((r) => r.docId === b.docId)!.extracted, true);
  });

  test('clearExtraction without del() blanks the keys instead', async () => {
    const kv: any = fakeKv(); delete kv.del;
    kv.store.set('guidance-extract:v1:abc', { x: 1 });
    await clearExtraction(kv, ['abc']);
    assert.equal(kv.store.get('guidance-extract:v1:abc'), null);
  });
});

// ── collector run ───────────────────────────────────────────────────────────

describe('zzz921 collector run in re-collect mode', () => {
  const resp = (b: any, status = 200, headers: Record<string, string> = {}) => new Response((typeof b === 'string' || Buffer.isBuffer(b) ? b : JSON.stringify(b)) as any, { status, headers });
  const pdf = (tag: string) => Buffer.from(`%PDF-1.4 ${tag}`);
  const nseUrl = (n: string) => `https://nsearchives.nseindia.com/corporate/${n}.pdf`;
  const row = (symbol: string, name: string, file: string, an = '13-Aug-2026 18:00:00') => ({ symbol, sm_name: name, desc: 'Analysts/Institutional Investor Meet/Con. Call Updates', attchmntText: `${name} has informed the Exchange about Transcript of the earnings call`, attchmntFile: nseUrl(file), an_dt: an });
  const texts: Record<string, string> = {
    'baroext-aug': TRANSCRIPT('BARODA EXTRUSION LIMITED', 'Management expects minimum 35-40% revenue growth for FY27.'),
    'baroext-may': TRANSCRIPT('BARODA EXTRUSION LIMITED', 'Management expects 30% revenue growth in FY27.'),
    'frog-aug': TRANSCRIPT('FROG INNOVATIONS LIMITED', 'Management targets FY27 revenue to recover to approximately Rs 220 crore from FY26 base of Rs 106 crore.'),
    'other-aug': TRANSCRIPT('OTHER LIMITED', 'Management expects 20% revenue growth in FY27.'),
  };

  function harness(opts: { knownIds?: string[] } = {}) {
    const posts: any[] = []; const asked: string[] = []; let gets = 0;
    const fetchFake = async (url: string, init: any = {}) => {
      asked.push(url);
      if (url.includes('/api/v1/guidance-docs/ingest')) {
        if ((init.method || 'GET') === 'POST') { posts.push(JSON.parse(init.body)); return resp({ ok: true, rejected: [] }); }
        gets++;
        return resp({ ok: true, known: opts.knownIds || [], intimations: [], queueTickers: [] });
      }
      if (url.includes('/api/v1/guidance-pipeline')) return resp({ wanted: [] });
      if (url === 'https://www.nseindia.com/') return resp('<html/>');
      if (url.includes('nseindia.com/api/corporate-announcements')) {
        if (url.includes('symbol=BAROEXT') && url.includes('index=equities')) return resp([row('BAROEXT', 'Baroda Extrusion Ltd', 'baroext-aug'), row('BAROEXT', 'Baroda Extrusion Ltd', 'baroext-may', '20-May-2026 18:00:00'), row('OTHER', 'Other Ltd', 'other-aug')]);
        if (url.includes('symbol=FROG') && url.includes('index=equities')) return resp([]);
        if (url.includes('symbol=FROG') && url.includes('index=sme')) return resp([row('FROG', 'Frog Innovations Ltd', 'frog-aug')]);
        return resp([]);
      }
      if (url.includes('AnnSubCategoryGetData')) return resp('refused', 403);
      if (url.startsWith('https://www.screener.in/')) return resp('not found', 404);
      const m = /\/([a-z-]+)\.pdf$/.exec(url);
      if (m && texts[m[1]]) return resp(pdf(m[1]), 200, { 'content-type': 'application/pdf' });
      return resp('nope', 404);
    };
    const pdftotext = async (buf: Buffer) => texts[buf.toString().split(' ')[1]] ?? '';
    return { posts, asked, fetchFake, pdftotext, gets: () => gets };
  }
  const baseEnv = { CRON_SECRET: 'x'.repeat(16), CRON_BASE_URL: 'https://app.test', API_DELAY_MS: '0', SCREENER_DELAY_MS: '0', BSE_MODE: 'sub', GITHUB_EVENT_NAME: 'workflow_dispatch' };
  const now = new Date('2026-10-03T12:00:00Z');

  test('named companies only: known memory ignored, own filings re-read, posted with reextract = true, no day-by-day listing', async () => {
    const R = await import(runnerPath);
    const h = harness({ knownIds: [sha20(nseUrl('baroext-aug')), sha20(nseUrl('frog-aug'))] });
    const r = await R.run({ fetch: h.fetchFake as any, pdftotext: h.pdftotext, sleep: async () => undefined, log: () => undefined, env: { ...baseEnv, RECOLLECT_TICKERS: 'BAROEXT,FROG', RECOLLECT_DAYS: '90' }, now });
    const docs = h.posts.flatMap((p) => p.docs);
    assert.deepEqual(docs.map((d: any) => d.ticker).sort(), ['BAROEXT', 'BAROEXT', 'FROG']);
    assert.ok(docs.every((d: any) => d.market === 'IN'));
    assert.ok(!docs.some((d: any) => d.ticker === 'OTHER'), "another company's filing in the same response is never re-collected");
    // the already-known documents were fetched anyway; every document batch carries the flag, nothing else does
    assert.ok(docs.some((d: any) => d.url === nseUrl('baroext-aug')) && docs.some((d: any) => d.url === nseUrl('frog-aug')));
    for (const p of h.posts) if (p.docs.length) assert.equal(p.reextract, true);
    assert.ok(h.posts.every((p) => p.docs.length === 0 || p.market === 'IN'));
    // the server's known list is not even fetched, and no day-by-day listing / status record happens
    assert.equal(h.gets(), 0);
    assert.ok(!h.asked.some((u) => u.includes('from_date') && !u.includes('symbol=')), 'no all-company daily NSE listing');
    assert.ok(!h.asked.some((u) => u.includes('AnnSubCategoryGetData')), 'no BSE call without a BSE code');
    assert.ok(!h.posts.some((p) => p.status || p.coverage), 'the scheduled collector status / coverage is not touched');
    // window = recollect_days: from 2026-07-06 to 2026-10-03
    assert.ok(h.asked.some((u) => u.includes('symbol=BAROEXT') && u.includes('from_date=06-07-2026') && u.includes('to_date=03-10-2026')));
    assert.equal(r.counts.recollectDocs, 3); assert.equal(r.counts.recollectTargets, 2);
    // every posted body is valid for the server
    for (const p of h.posts) { const v = validateIngestBody(p); assert.ok(v.ok, JSON.stringify(v)); if (v.ok) assert.equal(v.rejected.length, 0); }
  });

  test('default window is 120 days; the per-company cap holds', async () => {
    const R = await import(runnerPath);
    const h = harness();
    await R.run({ fetch: h.fetchFake as any, pdftotext: h.pdftotext, sleep: async () => undefined, log: () => undefined, env: { ...baseEnv, RECOLLECT_TICKERS: 'BAROEXT', RECOLLECT_MAX_PER_COMPANY: '1' }, now });
    assert.ok(h.asked.some((u) => u.includes('symbol=BAROEXT') && u.includes('from_date=06-06-2026')));
    const docs = h.posts.flatMap((p) => p.docs);
    assert.equal(docs.length, 1);
    assert.equal(docs[0].url, nseUrl('baroext-aug'), 'newest first');
  });

  test('tickers input is sanitised: shell-looking text never becomes a request', async () => {
    const R = await import(runnerPath);
    const h = harness();
    await R.run({ fetch: h.fetchFake as any, pdftotext: h.pdftotext, sleep: async () => undefined, log: () => undefined, env: { ...baseEnv, RECOLLECT_TICKERS: 'BAROEXT;$(curl evil)' }, now });
    assert.ok(h.asked.some((u) => u.includes('symbol=BAROEXT')));
    assert.ok(h.asked.every((u) => !/[$();`]/.test(decodeURIComponent(u.split('?')[0])) && !u.includes('$(') && !u.includes('%24')));
  });

  test('input with no valid ticker does nothing (never turns into a normal run)', async () => {
    const R = await import(runnerPath);
    const h = harness();
    const r = await R.run({ fetch: h.fetchFake as any, pdftotext: h.pdftotext, sleep: async () => undefined, log: () => undefined, env: { ...baseEnv, RECOLLECT_TICKERS: '!!!,,' }, now });
    assert.equal(r.stoppedBy, 'bad_recollect_input');
    assert.equal(h.posts.length, 0); assert.equal(h.asked.length, 0);
  });

  test('empty RECOLLECT_TICKERS: scheduled behaviour unchanged (known list read, day listing, no reextract flag)', async () => {
    const R = await import(runnerPath);
    const h = harness({ knownIds: [sha20(nseUrl('baroext-aug'))] });
    const dayRows = [row('BAROEXT', 'Baroda Extrusion Ltd', 'baroext-aug', '02-Oct-2026 18:00:00'), row('OTHER', 'Other Ltd', 'other-aug', '02-Oct-2026 18:05:00')];
    const inner = h.fetchFake;
    const fetchFake = async (url: string, init: any = {}) => {
      if (url.includes('nseindia.com/api/corporate-announcements') && !url.includes('symbol=')) {
        const day = /from_date=(\d\d-\d\d-\d{4})/.exec(url)![1];
        return resp(day === '02-10-2026' && url.includes('index=equities') ? dayRows : []);
      }
      return inner(url, init);
    };
    for (const empty of [undefined, '', '   ']) {
      h.posts.length = 0;
      const r = await R.run({ fetch: fetchFake as any, pdftotext: h.pdftotext, sleep: async () => undefined, log: () => undefined, env: { ...baseEnv, DAYS: '3', WANTED: '0', ...(empty === undefined ? {} : { RECOLLECT_TICKERS: empty }) }, now });
      assert.ok(h.gets() >= 1, 'the known list is read');
      const docs = h.posts.flatMap((p) => p.docs);
      assert.deepEqual(docs.map((d: any) => d.ticker), ['OTHER'], 'the known BAROEXT filing is skipped as before');
      assert.ok(h.posts.every((p) => !('reextract' in p)));
      assert.ok(h.posts.some((p) => p.status), 'collector status is posted as before');
      assert.equal(r.counts.recollectTargets, undefined);
    }
  });
});

// ── workflow wiring ─────────────────────────────────────────────────────────

describe('zzz921 workflow', () => {
  const wf = readFileSync(join(SCRIPTS, '..', 'workflows', 'scrape-guidance-docs.yml'), 'utf8');
  test('workflow_dispatch inputs and sanitising', () => {
    assert.match(wf, /recollect_tickers:/); assert.match(wf, /recollect_days:/);
    assert.match(wf, /tr -cd 'A-Za-z0-9,:&-'/); assert.match(wf, /cut -d, -f1-30/);
    assert.match(wf, /RECOLLECT_TICKERS/); assert.match(wf, /RECOLLECT_DAYS/);
    // never from the schedule
    assert.match(wf, /GITHUB_EVENT_NAME" = "workflow_dispatch" \]; then\s+RECOLLECT_TICKERS=/);
    // the scheduled cron line is unchanged
    assert.match(wf, /- cron: '50 3,9,11,13,15,17,21 \* \* \*'/);
  });
  test('a re-collect does not refresh the scheduled job heartbeat', () => {
    assert.match(wf, /if: always\(\) && github\.event\.inputs\.recollect_tickers == ''/);
  });
  test('no secret in the diff-able files', () => {
    for (const f of [wf, readFileSync(join(SCRIPTS, 'scrape-guidance-docs.mjs'), 'utf8')]) assert.ok(!/ghp_[A-Za-z0-9]{20}|sk-[A-Za-z0-9]{20}/.test(f));
  });
});
