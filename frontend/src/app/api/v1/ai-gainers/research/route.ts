// ═══════════════════════════════════════════════════════════════════════════
// /api/v1/ai-gainers/research — THE SWEEP, IN CHUNKS, PERSISTED.    (zzz741)
//
// POST { market, rows: [{ticker, company, move_pct, volume, price, market_cap, perf}], budget_ms? }
//   Registers today's universe (idempotent), then researches as many
//   unresearched names as fit in the budget (~40s), most-moved first, and
//   saves every finding to KV as it lands. The page calls this repeatedly
//   until `remaining` is 0. A reload resumes from the store: nothing is
//   researched twice in a day, and an interrupted sweep is not lost.
//
// GET  ?market=IN
//   The day's findings and the coverage fraction. No research happens here.
//
// A finding is produced for EVERY name swept — none / routine_only / denied /
// negative / listing_artifact / source_failed are all findings — so coverage
// is a fraction that cannot lie.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { fetchCompanyResearch } from '@/lib/ai-gainers/screener-company';
import { fetchEdgarResearch, fetchEdgarText } from '@/lib/ai-gainers/edgar-research';
import { buildFinding, coverage, classifyAnnouncement, chooseCandidate, ageDaysOf, type Finding, type AnnouncementLite } from '@/lib/ai-gainers/catalyst-research';
import { readAnnouncement, type ReadAnnouncement } from '@/lib/ai-gainers/announcement-reader';
import { extractPdfText } from '@/lib/pdf-text-extractor';
import { istToday } from '@/lib/market-hours';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_DAYS = 21;
const DEFAULT_BUDGET_MS = 40_000;
const MODEL_READS_PER_CALL = 4;

interface ResearchState {
  market: 'IN' | 'US';
  date: string;
  universe: Array<{ ticker: string; company: string | null; movePct: number | null; volume: number | null; price: number | null; marketCap: number | null; perf: any }>;
  findings: Record<string, Finding>;
  started_at: string;
  updated_at: string;
  model_reads: number;
  errors: string[];
}

const KEY = (m: string, d: string) => `ai-gainers:research:v1:${m}:${d}`;
const READ_KEY = (url: string) => `ai-gainers:annread:v1:${hash(url)}`;

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

function todayFor(market: 'IN' | 'US'): string {
  if (market === 'IN') { try { return istToday(); } catch { /* fall through */ } }
  return new Date().toISOString().slice(0, 10);
}

async function loadState(market: 'IN' | 'US', date: string): Promise<ResearchState | null> {
  try { const s = await kvGet<ResearchState>(KEY(market, date)); return s && s.findings ? s : null; } catch { return null; }
}

async function loadHoldings(origin: string): Promise<Set<string>> {
  try {
    const r = await fetch(`${origin}/api/v1/book/state?feed=0`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return new Set();
    const j: any = await r.json();
    const rows: any[] = j?.book?.tickers || [];
    return new Set(rows.filter((x) => x?.held).map((x) => String(x.ticker || '').toUpperCase()));
  } catch { return new Set(); }
}

/** A model read of one filing, cached by URL for 30 days: the same PDF is
 *  never paid for twice, across days or markets. */
async function cachedRead(market: 'IN' | 'US', ticker: string, a: AnnouncementLite): Promise<ReadAnnouncement | null> {
  const k = READ_KEY(a.url);
  try {
    const hit = await kvGet<{ read: ReadAnnouncement | null }>(k);
    if (hit && 'read' in hit) return hit.read;
  } catch { /* cold */ }
  const read = await readAnnouncement(
    { symbol: ticker, subject: a.subject, attachment_url: a.url, filing_date: a.dateIso?.slice(0, 10) || null },
    async (url) => {
      if (market === 'US') return fetchEdgarText(url);
      const ext = await extractPdfText(url, { signal: AbortSignal.timeout(20_000) });
      return ext?.text || '';
    },
  );
  try { await kvSet(k, { read, at: new Date().toISOString() }, 30 * 24 * 3600); } catch { /* best effort */ }
  return read;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const market = (searchParams.get('market') || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';
  const date = searchParams.get('date') || todayFor(market);
  const st = await loadState(market, date);
  if (!st) return NextResponse.json({ ok: true, market, date, coverage: { researched: 0, total: 0, pct: 0, byStatus: {} }, findings: {}, remaining: 0, universe: [] });
  const cov = coverage(st.findings, st.universe.map((u) => u.ticker));
  return NextResponse.json({ ok: true, market, date, coverage: cov, findings: st.findings, remaining: cov.total - cov.researched, universe: st.universe, updated_at: st.updated_at, model_reads: st.model_reads, errors: st.errors.slice(-5) });
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const { origin } = new URL(req.url);
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const market: 'IN' | 'US' = String(body?.market || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';
  const date = String(body?.date || todayFor(market));
  const budget = Math.max(5_000, Math.min(48_000, Number(body?.budget_ms) || DEFAULT_BUDGET_MS));
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];

  const now = new Date();
  const nowIso = now.toISOString();
  let st = (await loadState(market, date)) || { market, date, universe: [], findings: {}, started_at: nowIso, updated_at: nowIso, model_reads: 0, errors: [] };

  // Register the universe (idempotent: a ticker already present keeps its row).
  const have = new Set(st.universe.map((u) => u.ticker));
  for (const r of rows) {
    const t = String(r?.ticker || '').toUpperCase();
    if (!t || have.has(t)) continue;
    have.add(t);
    st.universe.push({ ticker: t, company: r?.company || null, movePct: r?.move_pct ?? null, volume: r?.volume ?? null, price: r?.price ?? null, marketCap: r?.market_cap ?? null, perf: r?.perf ?? null });
  }

  const holdings = await loadHoldings(origin);
  if (body?.reprocess === true) { st.findings = {}; st.model_reads = 0; }   // explicit re-run of the day, e.g. after a rule change
  const todo = st.universe
    .filter((u) => !st.findings[u.ticker] || st.findings[u.ticker].status === 'unresearched' || (st.findings[u.ticker].status === 'source_failed' && body?.retry_failed))
    .sort((a, b) => (b.movePct ?? -Infinity) - (a.movePct ?? -Infinity));

  let done = 0, modelReads = 0;
  for (const u of todo) {
    if (Date.now() - t0 > budget) break;
    try {
      let announcements: AnnouncementLite[] = [];
      let marketCap = u.marketCap, turnover: number | null = null, returns = null as any, sources: string[] = [], sourceFailed = false;
      if (market === 'IN') {
        const cr = await fetchCompanyResearch(u.ticker, now);
        announcements = cr.announcements;
        marketCap = cr.marketCapCr ?? u.marketCap;
        returns = cr.returns;
        sources = cr.sources;
        sourceFailed = !cr.sources.length;
        const px = cr.lastClose ?? cr.price;
        turnover = u.volume != null && px != null ? (u.volume * px) / 1e7 : null;   // ₹ Cr
        if (cr.errors.length) st.errors.push(`${u.ticker}: ${cr.errors.join('; ')}`);
      } else {
        const er = await fetchEdgarResearch(u.ticker, WINDOW_DAYS, now);
        announcements = er.announcements;
        sources = er.sources;
        sourceFailed = !er.sources.length;
        returns = u.perf ? { m1: u.perf.m1 ?? null, m3: u.perf.m3 ?? null, m6: u.perf.m6 ?? null, y1: u.perf.y1 ?? null, history: 999 } : null;
        turnover = u.volume != null && u.price != null ? (u.volume * u.price) / 1e6 : null;  // $ M
        if (er.errors.length) st.errors.push(`${u.ticker}: ${er.errors.join('; ')}`);
      }

      // Model-read the best catalyst candidate when the budget allows: a
      // verbatim quote is what turns "the summary says ₹279 Cr" into a fact.
      let read: { url: string; headline: string; quote: string; category: any; valueStated?: number | null } | null = null;
      const inWindow = announcements.map((a) => ({ ...a, ageDays: a.ageDays ?? ageDaysOf(a.dateIso, now) })).filter((a) => a.ageDays == null || a.ageDays <= WINDOW_DAYS);
      // The SAME candidate the finding will score — the first version chose
      // "first catalyst in list order" here and "highest-scoring" in the
      // finding, so every verified quote was attached to the wrong filing
      // and dropped: 22 model reads, zero verified rows.
      const cand = chooseCandidate(announcements, market, { marketCap, returns, windowDays: WINDOW_DAYS, now })
        || (market === 'US' ? inWindow.map((a) => classifyAnnouncement(a, market)).find((c) => c.kind === 'unclassified' && /item (1\.01|2\.01|7\.01|8\.01)/i.test(c.subject)) : undefined);
      if (cand && modelReads < MODEL_READS_PER_CALL && Date.now() - t0 < budget - 12_000) {
        const r = await cachedRead(market, u.ticker, cand);
        modelReads++;
        if (r) read = { url: cand.url, headline: r.headline, quote: r.evidenceQuote, category: r.catalyst };
      }

      st.findings[u.ticker] = buildFinding({
        ticker: u.ticker, company: u.company, market, movePct: u.movePct, marketCap, turnover,
        announcements, returns, holding: holdings.has(u.ticker), sources, sourceFailed, windowDays: WINDOW_DAYS, now, read,
      });
      done++;
    } catch (e: any) {
      st.errors.push(`${u.ticker}: ${String(e?.message || e)}`);
      st.findings[u.ticker] = buildFinding({ ticker: u.ticker, company: u.company, market, movePct: u.movePct, marketCap: u.marketCap, turnover: null, announcements: [], returns: null, holding: holdings.has(u.ticker), sources: [], sourceFailed: true, windowDays: WINDOW_DAYS, now });
    }
    // Persist after every name: an interrupted call loses at most the one in flight.
    st.updated_at = new Date().toISOString();
    st.model_reads += modelReads; modelReads = 0;
    st.errors = st.errors.slice(-40);
    try { await kvSet(KEY(market, date), st); } catch { /* the next call re-does this name */ }
  }

  const cov = coverage(st.findings, st.universe.map((u) => u.ticker));
  return NextResponse.json({
    ok: true, market, date, researched_now: done, elapsed_ms: Date.now() - t0,
    coverage: cov, remaining: cov.total - cov.researched, findings: st.findings, updated_at: st.updated_at, model_reads: st.model_reads, errors: st.errors.slice(-5),
  });
}
