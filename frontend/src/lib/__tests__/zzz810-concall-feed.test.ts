// zzz810 — Concall feed: the Radar said "0 concalls scanned · 0 in feed … normal
// off-season" in late September (Q1 FY27 results tail). Root cause: the NSE
// adapter answered a 30-day window from a 20-row "newest filings" snapshot,
// blocked/empty fetches were cached as empty windows, and the UI turned
// "could not fetch" into "nothing filed". These tests pin the fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyConcallFiling,
  dedupeConcallFilings,
  loadConcallWindow,
  buildFeedStatus,
  countConcalls,
  subWindowsFor,
  isUsableSubwindow,
  SUBWIN_STORE_KEY,
  type WindowStore,
  type SourceFetch,
} from '../concall-feed';
import { fetchNSEAnnouncements, snapshotCoversWindow, nseRowToFiling, type FilingRecord } from '../nse-bse-feed';

const NOW = new Date('2026-09-27T10:00:00Z');   // Sun 27 Sep 2026, 15:30 IST
const NSE_CAT = 'Analysts/Institutional Investor Meet/Con. Call Updates';

function filing(p: Partial<FilingRecord> & { symbol: string; subject: string }): FilingRecord {
  const f: FilingRecord = {
    exchange: 'NSE',
    company_name: `${p.symbol} Ltd`,
    category: null,
    subcategory: null,
    filing_datetime: '2026-09-17T14:10:00.000Z',
    attachment_urls: [`https://nsearchives.nseindia.com/corporate/${p.symbol}.pdf`],
    source_url: 'https://www.nseindia.com/',
    content_hash: '',
    ...p,
  } as FilingRecord;
  if (!f.content_hash) f.content_hash = `${f.exchange}|${f.symbol}|${f.subject}|${f.detail || ''}|${f.filing_datetime}`;
  return f;
}

function memStore(): WindowStore & { data: Map<string, any>; sets: number } {
  const data = new Map<string, any>();
  const st = {
    data,
    sets: 0,
    async get(k: string) { return data.has(k) ? data.get(k) : null; },
    async set(k: string, v: any) { st.sets++; data.set(k, JSON.parse(JSON.stringify(v))); },
  };
  return st;
}

// ─── 1. Classification ──────────────────────────────────────────────────────

test('earnings-call transcript is a concall transcript', () => {
  const c = classifyConcallFiling('Earnings Call Transcript', 'Transcript of the Earnings Conference Call for Q1 FY27 results held on 12 Aug 2026');
  assert.equal(c.filing_type, 'TRANSCRIPT');
  assert.equal(c.kind, 'EARNINGS_CALL_TRANSCRIPT');
  assert.equal(c.is_concall, true);
  assert.equal(c.is_transcript, true);
});

test('business-update call transcript (IOL Chemicals, 17 Sep 2026) counts as a concall', () => {
  // NSE files it under the generic category; only the detail line says "transcript".
  const c = classifyConcallFiling(NSE_CAT, 'IOL Chemicals and Pharmaceuticals Limited has informed the Exchange about Transcript of Business Update Call');
  assert.equal(c.filing_type, 'TRANSCRIPT');
  assert.equal(c.kind, 'BUSINESS_UPDATE_TRANSCRIPT');
  assert.equal(c.is_concall, true);
  // Investor-call and analyst-meet transcripts count too.
  assert.equal(classifyConcallFiling(NSE_CAT, 'has informed the Exchange about Transcript of the Analyst / Institutional Investor Meet').is_concall, true);
  assert.equal(classifyConcallFiling('Transcript of Investor Call', '').filing_type, 'TRANSCRIPT');
});

test('investor presentation is relevant but not itself a concall', () => {
  const c = classifyConcallFiling('Investor Presentation', 'has informed the Exchange about Investor Presentation for Q1 FY27');
  assert.equal(c.filing_type, 'INVESTOR_PRESENTATION');
  assert.equal(c.kind, 'INVESTOR_PRESENTATION');
  assert.equal(c.is_transcript, false);
});

test('audio recording link is a call that happened, not a transcript', () => {
  const c = classifyConcallFiling(NSE_CAT, 'has informed the Exchange about Link of Audio Recording of the Earnings Call held on 14 Aug 2026');
  assert.equal(c.filing_type, 'AUDIO_RECORDING');
  assert.equal(c.is_concall, true);
  assert.equal(c.is_transcript, false);
  assert.equal(classifyConcallFiling('Audio/Video recording of Analyst Meet', '').filing_type, 'AUDIO_RECORDING');
  // Live NSE wording is often terse: "…about Link of Recording" under the con-call category.
  assert.equal(classifyConcallFiling(NSE_CAT, 'IOL Chemicals and Pharmaceuticals Limited has informed the Exchange about Link of Recording').kind, 'AUDIO_RECORDING');
});

test('terse NSE wording: bare "Presentation" under the con-call category; AGM transcripts are not concalls', () => {
  assert.equal(classifyConcallFiling(NSE_CAT, 'Persistent Systems Limited has informed the Exchange about Presentation').kind, 'INVESTOR_PRESENTATION');
  const agm = classifyConcallFiling('Shareholders meeting', 'Transcript of 49th Annual General Meeting of Metro Brands Limited');
  assert.equal(agm.kind, 'AGM_TRANSCRIPT');
  assert.equal(agm.is_concall, false);
  assert.deepEqual(countConcalls([{ subject: 'Shareholders meeting', detail: 'Transcript of 37th AGM' }]), { concall_filings: 0, transcripts: 0 });
});

test('routine intimation of an upcoming call is not counted as a concall', () => {
  const c = classifyConcallFiling(NSE_CAT, 'has informed the Exchange about Schedule of Analyst / Institutional Investor Meet to be held on 30 Sep 2026');
  assert.equal(c.filing_type, 'CONCALL_INVITE');
  assert.equal(c.kind, 'CALL_INTIMATION');
  assert.equal(c.is_concall, false);
  // "the transcript will be uploaded" in a notice is still just a notice.
  const c2 = classifyConcallFiling('Intimation of Earnings Call', 'The earnings call is scheduled on 5 Oct 2026; the transcript will be uploaded on the website');
  assert.equal(c2.kind, 'CALL_INTIMATION');
  assert.equal(c2.is_concall, false);
});

test('NSE row keeps the detail line (attchmntText) the classifier needs', () => {
  const f = nseRowToFiling({
    symbol: 'IOLCP', sm_name: 'IOL Chemicals and Pharmaceuticals Limited', desc: NSE_CAT,
    an_dt: '17-Sep-2026 19:45:12', attchmntFile: 'https://nsearchives.nseindia.com/corporate/IOLCP_17092026.pdf',
    attchmntText: 'IOL Chemicals and Pharmaceuticals Limited has informed the Exchange about Transcript of Business Update Call',
  });
  assert.ok(f);
  assert.equal(f!.subject, NSE_CAT);
  assert.match(f!.detail || '', /Transcript of Business Update Call/);
  assert.equal(classifyConcallFiling(f!.subject, f!.detail).kind, 'BUSINESS_UPDATE_TRANSCRIPT');
});

// ─── 2. Backfill when the store is empty ────────────────────────────────────

test('empty store → window is fetched from NSE/BSE, stored, and reused next time', async () => {
  const store = memStore();
  let nseCalls = 0, bseCalls = 0;
  const tx = filing({ symbol: 'IOLCP', subject: NSE_CAT, detail: 'Transcript of Business Update Call' });
  const deps = {
    store, now: () => NOW, politeDelayMs: 0,
    fetchNSE: async (): Promise<SourceFetch> => { nseCalls++; return { filings: [tx], source: 'NSE_OK' }; },
    fetchBSE: async (): Promise<SourceFetch> => { bseCalls++; return { filings: [], source: 'BSE_OK' }; },
  };
  const a = await loadConcallWindow(30, deps);
  assert.equal(nseCalls, 1);
  assert.equal(bseCalls, 1);
  assert.equal(a.windows_backfilled, 1);
  assert.equal(a.filings.length, 1);
  assert.equal(a.nse, 'OK');
  assert.equal(a.from_iso, '2026-08-29');
  assert.equal(a.to_iso, '2026-09-27');
  assert.equal(store.sets, 1);

  const b = await loadConcallWindow(30, deps);
  assert.equal(nseCalls, 1, 'second load is served from the store');
  assert.equal(b.windows_from_store, 1);
  assert.equal(b.filings.length, 1);
});

test('a blocked fetch is never stored as an empty window; an old empty entry is backfilled', async () => {
  const store = memStore();
  const [w] = subWindowsFor(30, NOW);
  // Poisoned entry from the old code: both sources "blocked", zero rows.
  store.data.set(SUBWIN_STORE_KEY(w.fromIso, w.toIso), { nse: { filings: [], source: 'NSE_BLOCKED' }, bse: { filings: [], source: 'BSE_BLOCKED' } });
  assert.equal(isUsableSubwindow(store.data.get(SUBWIN_STORE_KEY(w.fromIso, w.toIso))), false);
  let calls = 0;
  const blocked = await loadConcallWindow(30, {
    store, now: () => NOW, politeDelayMs: 0,
    fetchNSE: async () => { calls++; return { filings: [], source: 'NSE_BLOCKED', reason: 'NSE HTTP 403' }; },
    fetchBSE: async () => ({ filings: [], source: 'BSE_BLOCKED', reason: 'BSE timeout' }),
  });
  assert.equal(calls, 1, 'poisoned entry treated as a miss');
  assert.equal(blocked.nse, 'BLOCKED');
  assert.equal(blocked.nse_reason, 'NSE HTTP 403');
  assert.equal(blocked.bse_reason, 'BSE timeout');
  assert.equal(store.sets, 0, 'failure not cached');
});

test('sub-windows follow the IST calendar and split long windows into ≤30-day chunks', () => {
  // 20:00 UTC on 27 Sep is already 28 Sep in India.
  const late = new Date('2026-09-27T20:00:00Z');
  assert.equal(subWindowsFor(1, late)[0].toIso, '2026-09-28');
  const w = subWindowsFor(90, NOW);
  assert.equal(w.length, 3);
  assert.deepEqual(w[0], { fromIso: '2026-08-29', toIso: '2026-09-27' });
  assert.equal(w[2].fromIso, '2026-06-30');
});

test('NSE adapter: a 20-row newest snapshot does not answer a 30-day window — it fetches live', async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  const cfRows = Array.from({ length: 20 }, (_, i) => ({
    symbol: `SYM${i}`, company: `Sym ${i} Ltd`, subject: 'Trading Window',
    filing_date: '27-Sep-2026 14:28:42', attachment_url: '',
  }));
  (globalThis as any).fetch = async (url: string) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('workers.dev')) {
      return new Response(JSON.stringify({ generated_at: new Date().toISOString(), count: 20, filings: cfRows }), { status: 200 });
    }
    if (u === 'https://www.nseindia.com/') {
      return new Response('<html></html>', { status: 200, headers: { 'set-cookie': 'nsit=abc; Path=/' } });
    }
    if (u.includes('/api/corporate-announcements')) {
      return new Response(JSON.stringify([
        { symbol: 'IOLCP', sm_name: 'IOL Chemicals and Pharmaceuticals Limited', desc: NSE_CAT, an_dt: '17-Sep-2026 19:45:12',
          attchmntFile: 'https://nsearchives.nseindia.com/corporate/IOLCP.pdf', attchmntText: 'has informed the Exchange about Transcript of Business Update Call' },
      ]), { status: 200 });
    }
    return new Response('nope', { status: 404 });
  };
  try {
    const r = await fetchNSEAnnouncements({ fromIso: '2026-08-28', toIso: '2026-09-27' });
    assert.ok(seen.some((u) => u.includes('/api/corporate-announcements') && u.includes('from_date=28-08-2026')), 'live windowed fetch ran');
    assert.equal(r.source, 'NSE_OK');
    assert.equal(r.via, 'SNAPSHOT+LIVE');
    assert.ok(r.filings.some((f) => f.symbol === 'IOLCP'));
    assert.equal(snapshotCoversWindow(r.filings.filter((f) => f.symbol.startsWith('SYM')), '2026-08-28'), false);
  } finally {
    (globalThis as any).fetch = realFetch;
  }
});

// ─── 3. Honest status ───────────────────────────────────────────────────────

test('fetch failure says so, with the reason and the last successful fetch — never "off-season"', () => {
  const st = buildFeedStatus({
    nse: 'BLOCKED', bse: 'BLOCKED', nse_reason: 'NSE HTTP 403', bse_reason: 'BSE timeout',
    announcements_total: 0, concall_filings: 0, transcripts: 0, window_days: 30,
    last_success_at: '2026-09-17T14:15:00Z',
  });
  assert.equal(st.state, 'FAILED');
  assert.equal(st.retrying, true);
  assert.match(st.message, /^Couldn't reach NSE\/BSE announcements \(NSE HTTP 403; BSE timeout\) — last successful fetch Thu 17 Sep, 19:45 IST; retrying\.$/);
  assert.doesNotMatch(st.message, /off-season|no transcripts/i);
  // "OK" sources that returned zero announcements for a whole window = soft block, still a failure.
  assert.equal(buildFeedStatus({ nse: 'OK', bse: 'EMPTY', announcements_total: 0, concall_filings: 0, transcripts: 0, window_days: 30, last_success_at: null }).state, 'FAILED');
});

test('true empty: exchanges answered, nothing concall-related filed', () => {
  const st = buildFeedStatus({ nse: 'OK', bse: 'OK', announcements_total: 812, concall_filings: 0, transcripts: 0, window_days: 7, last_success_at: NOW.toISOString() });
  assert.equal(st.state, 'EMPTY');
  assert.equal(st.retrying, false);
  assert.match(st.message, /812 announcements in the last 7 days, and none were concall transcripts/);
});

test('real counts are shown; a low count is stated as a number, not an excuse', () => {
  const ok = buildFeedStatus({ nse: 'OK', bse: 'OK', announcements_total: 24000, concall_filings: 640, transcripts: 410, window_days: 30, last_success_at: null });
  assert.equal(ok.state, 'OK');
  assert.match(ok.message, /^640 concall filings \(410 transcripts\) out of 24000 announcements in the last 30 days\.$/);
  const low = buildFeedStatus({ nse: 'OK', bse: 'OK', announcements_total: 300, concall_filings: 3, transcripts: 1, window_days: 7, last_success_at: null });
  assert.match(low.message, /^3 concall filings \(1 transcript\) .* low count/);
  const partial = buildFeedStatus({ nse: 'OK', bse: 'BLOCKED', bse_reason: 'BSE HTTP 403', announcements_total: 9000, concall_filings: 200, transcripts: 150, window_days: 30, last_success_at: null });
  assert.equal(partial.state, 'PARTIAL');
  assert.match(partial.message, /BSE could not be reached \(BSE HTTP 403\)/);
});

test('countConcalls counts transcripts, recordings and presentations, not intimations', () => {
  const c = countConcalls([
    { subject: NSE_CAT, detail: 'Transcript of Business Update Call' },
    { subject: 'Investor Presentation' },
    { subject: NSE_CAT, detail: 'Link of Audio Recording of Earnings Call' },
    { subject: NSE_CAT, detail: 'Schedule of Analyst / Institutional Investor Meet to be held on 30 Sep' },
    { subject: 'Trading Window' },
  ]);
  assert.deepEqual(c, { concall_filings: 3, transcripts: 1 });
});

// ─── 4. Dedupe across NSE / BSE ─────────────────────────────────────────────

test('same transcript on NSE and BSE collapses to one (NSE kept); different documents stay', () => {
  const nse = filing({ symbol: 'IOLCP', company_name: 'IOL Chemicals and Pharmaceuticals Limited', subject: NSE_CAT, detail: 'Transcript of Business Update Call' });
  const bse = filing({ exchange: 'BSE', symbol: '524164', company_name: 'IOL CHEMICALS AND PHARMACEUTICALS LTD.', subject: 'Transcript of Business Update Call', filing_datetime: '2026-09-17T14:20:00.000Z' });
  const pres = filing({ symbol: 'IOLCP', company_name: 'IOL Chemicals and Pharmaceuticals Limited', subject: 'Investor Presentation' });
  const exactDup = { ...nse };
  const out = dedupeConcallFilings([bse, nse, exactDup, pres]);
  assert.equal(out.length, 2);
  const tx = out.find((f) => classifyConcallFiling(f.subject, f.detail).is_transcript)!;
  assert.equal(tx.exchange, 'NSE');
  assert.ok(out.some((f) => f.subject === 'Investor Presentation'));
});
