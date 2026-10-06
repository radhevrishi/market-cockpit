// zzz923 — GET /api/v1/guidance-upgrades/skygold?in=A,B&us=X,Y → the facts the "Next Sky Gold" score reads, for the focus-list
// names only, in ONE bounded call. India: the screener.in company page (consolidated first, standalone when the consolidated
// table is missing or stale), parsed by lib/gu-skygold-facts, cached 24 h per name (a failure 6 h). USA: the cached SEC XBRL
// row (lib/us-thesis/facts-server, cache first) and the analyst EPS estimate trend (shared 6 h cache with
// /api/v1/us-estimate-revisions). Public company data only; no model call; never the owner's holdings.
// Names not reached inside the time limit are listed in `pending` so the page can ask once more for just those.
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { rateLimitResponse } from '@/lib/rateLimit';
import { fetchScreenerHtml } from '@/lib/earnings/screener-fetch';
import { screenerSymbol } from '@/lib/earnings/screener-documents';
import { isCurrentPeriod } from '@/lib/thesis/screener-financials';
import { inFactsFromHtml, usFactsFromRow, type SkyFacts } from '@/lib/gu-skygold-facts';
import { usFactsBatch } from '@/lib/us-thesis/facts-server';
import { yahooEstimateTrend, pooled, type EstimateTrendRow } from '@/lib/us-prices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PER_MARKET = 80;
const DEADLINE_MS = 40_000;
const TTL_OK = 24 * 3600;
const TTL_FAIL = 6 * 3600;
const inKey = (t: string) => `gu-skygold:in:v1:${t}`;

const list = (v: string | null, re: RegExp) => Array.from(new Set(String(v || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => re.test(s)))).slice(0, MAX_PER_MARKET);

async function inFacts(t: string): Promise<{ facts: SkyFacts | null; error: string | null }> {
  const sym = encodeURIComponent(screenerSymbol(t));
  let last: string | null = null; let fallback: SkyFacts | null = null;
  for (const [basis, url] of [['consolidated', `https://www.screener.in/company/${sym}/consolidated/`], ['standalone', `https://www.screener.in/company/${sym}/`]] as const) {
    const got = await fetchScreenerHtml(url, 12_000);
    if (!got.html) { last = got.error || 'screener.in did not answer'; continue; }
    const f = inFactsFromHtml(t, got.html, basis, url);
    if (!f) { last = 'no quarterly table'; continue; }
    if (!isCurrentPeriod(f.period)) { last = `latest ${basis} quarter is ${f.period} — too old`; continue; }
    if (f.salesYoyQ != null || f.roce != null) return { facts: f, error: null };
    fallback = fallback || f; last = `${basis} table has no year-ago quarter`;
  }
  return fallback ? { facts: fallback, error: null } : { facts: null, error: last };
}

export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, 20, 60_000);
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const IN = list(sp.get('in'), /^[A-Z0-9][A-Z0-9&-]{0,19}$/);
  const US = list(sp.get('us'), /^[A-Z][A-Z0-9.\-]{0,9}$/);
  if (!IN.length && !US.length) return NextResponse.json({ ok: false, error: 'in or us tickers required' }, { status: 400 });
  const t0 = Date.now();
  const facts: Record<string, SkyFacts | null> = {};   // key 'IN:TICKER' / 'US:TICKER'
  const errors: Record<string, string> = {};
  const pending: string[] = [];

  const india = (async () => {
    const todo: string[] = [];
    const hits = await Promise.all(IN.map((t) => kvGet<{ facts: SkyFacts | null; error: string | null }>(inKey(t)).catch(() => null)));
    IN.forEach((t, i) => { const h = hits[i]; if (h && (h.facts ? isCurrentPeriod(h.facts.period) : true)) { facts[`IN:${t}`] = h.facts; if (h.error) errors[`IN:${t}`] = h.error; } else todo.push(t); });
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const t = todo[i++];
        if (Date.now() - t0 > DEADLINE_MS - 12_000) { pending.push(`IN:${t}`); continue; }
        const got = await inFacts(t).catch((e: any) => ({ facts: null, error: String(e?.message || e).slice(0, 120) }));
        facts[`IN:${t}`] = got.facts; if (got.error) errors[`IN:${t}`] = got.error;
        await kvSet(inKey(t), got, got.facts ? TTL_OK : TTL_FAIL).catch(() => null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
  })();

  const usa = (async () => {
    if (!US.length) return;
    const [batch, trends] = await Promise.all([
      usFactsBatch(US, { concurrency: 4, deadlineMs: DEADLINE_MS - 8_000 }).catch(() => null),
      (async () => {
        const out: Record<string, EstimateTrendRow[]> = {};
        await pooled(US, 6, async (t) => {
          const key = `us-est-trend:v1:${t}`;
          let rows = await kvGet<EstimateTrendRow[]>(key).catch(() => null);
          if (!Array.isArray(rows)) {
            rows = await Promise.race([yahooEstimateTrend(t).catch(() => [] as EstimateTrendRow[]), new Promise<EstimateTrendRow[]>((r) => setTimeout(() => r([]), 10_000))]);
            if (rows.length) await kvSet(key, rows, 6 * 3600).catch(() => {});
          }
          out[t] = rows;
        });
        return out;
      })().catch(() => ({} as Record<string, EstimateTrendRow[]>)),
    ]);
    for (const t of US) {
      const row = batch?.rows?.[t];
      if (row?.retrieval_failed) { pending.push(`US:${t}`); errors[`US:${t}`] = String(row.why || 'SEC request failed'); continue; }
      facts[`US:${t}`] = usFactsFromRow(t, row, trends[t]);
      if (!facts[`US:${t}`]) errors[`US:${t}`] = String(row?.why || 'no SEC figures');
    }
  })();

  await Promise.all([india, usa]);
  return NextResponse.json({ ok: true, facts, errors, pending, ms: Date.now() - t0 }, { headers: { 'Cache-Control': 'private, max-age=600' } });
}
