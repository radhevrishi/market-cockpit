// zzz923 — GET /api/v1/guidance-upgrades/skygold?in=A,B&us=X,Y → the facts the "Next Sky Gold" score reads, for the focus-list
// names only, in ONE bounded call. India: the screener.in company page (consolidated first, standalone when the consolidated
// table is missing or stale), parsed by lib/gu-skygold-facts, cached 24 h per name (a failure 6 h). USA: the cached SEC XBRL
// row (lib/us-thesis/facts-server, cache first) and the analyst EPS estimate trend (shared 6 h cache with
// /api/v1/us-estimate-revisions). Public company data only; no model call; never the owner's holdings.
// Names not reached inside the time limit are listed in `pending` so the page can ask once more for just those.
// zzz925: also the market cap of each name (`caps`: India ₹ Cr from screener.in, USA $M from the Nasdaq quote summary, cached 24 h) so
// the focus list can size US names and keep large caps out of "Small & mid only"; and a BSE-only company whose symbol has no screener.in
// page (BMW Industries, "BMW") is found by its company name (`n=SYMBOL:Company name`, optional) through the screener.in search.
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { rateLimitResponse } from '@/lib/rateLimit';
import { fetchScreenerHtml } from '@/lib/earnings/screener-fetch';
import { screenerSymbol } from '@/lib/earnings/screener-documents';
import { isCurrentPeriod } from '@/lib/thesis/screener-financials';
import { inFactsFromHtml, usFactsFromRow, type SkyFacts } from '@/lib/gu-skygold-facts';
import { usFactsBatch } from '@/lib/us-thesis/facts-server';
import { yahooEstimateTrend, pooled, type EstimateTrendRow } from '@/lib/us-prices';
import { proxiedFetch } from '@/lib/proxy-fetch';
import { nasdaqMarketCapMusd, pickScreenerSlug } from '@/lib/gu-skygold-lookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PER_MARKET = 80;
const DEADLINE_MS = 40_000;
const TTL_OK = 24 * 3600;
const TTL_FAIL = 6 * 3600;
const inKey = (t: string) => `gu-skygold:in:v2:${t}`;   // zzz925: v2 — a name the old symbol-only lookup missed (BMW) is read again
const slugKey = (t: string) => `gu-skygold:slug:v1:${t}`;
const usCapKey = (t: string) => `gu-skygold:uscap:v1:${t}`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** zzz925: the screener.in page slug of a company whose symbol page does not exist, from the screener.in search (by company name). KV cached. */
async function screenerSlug(t: string, company: string | null): Promise<string | null> {
  const hit = await kvGet<string>(slugKey(t)).catch(() => null);
  if (hit === '-') return null;
  if (hit) return hit;
  const url = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(company || t)}`;
  const init = { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: 'https://www.screener.in/' }, signal: AbortSignal.timeout(6000) };
  for (const via of ['direct', 'relay'] as const) {
    try {
      const res = via === 'direct' ? await fetch(url, init) : await proxiedFetch(url, init);
      if (!res.ok) continue;
      const j: any = await res.json().catch(() => null);
      const list = Array.isArray(j) ? j : Array.isArray(j?.companies) ? j.companies : null;
      if (!list) continue;
      const slug = pickScreenerSlug(list, t, company);
      await kvSet(slugKey(t), slug || '-', slug ? 30 * 86400 : 86400).catch(() => null);
      return slug;
    } catch { /* next hop */ }
  }
  return null;
}

/** zzz925: US market cap in $ million from the Nasdaq quote summary. KV cached (24 h; a miss 2 h). */
async function usCap(t: string): Promise<number | null> {
  const hit = await kvGet<{ cap: number | null }>(usCapKey(t)).catch(() => null);
  if (hit && typeof hit === 'object') return hit.cap ?? null;
  let cap: number | null = null;
  try {
    const res = await fetch(`https://api.nasdaq.com/api/quote/${encodeURIComponent(t)}/summary?assetclass=stocks`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (res.ok) cap = nasdaqMarketCapMusd(await res.json().catch(() => null));
  } catch { cap = null; }
  await kvSet(usCapKey(t), { cap }, cap != null ? TTL_OK : 2 * 3600).catch(() => null);
  return cap;
}

const list = (v: string | null, re: RegExp) => Array.from(new Set(String(v || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => re.test(s)))).slice(0, MAX_PER_MARKET);

async function inFacts(t: string, company: string | null): Promise<{ facts: SkyFacts | null; error: string | null }> {
  const first = await inFactsAt(t, screenerSymbol(t));
  if (first.facts || !first.missing) return first;
  // zzz925: no screener.in page under this symbol (a BSE-only company): find its page by the company name, then read that page
  const slug = await screenerSlug(t, company);
  if (!slug || slug.toUpperCase() === screenerSymbol(t).toUpperCase()) return { facts: null, error: `${first.error || 'no screener.in page'}; no screener.in page found for ${company || t} by name either` };
  const second = await inFactsAt(t, slug);
  return { facts: second.facts, error: second.error };
}

async function inFactsAt(t: string, slug: string): Promise<{ facts: SkyFacts | null; error: string | null; missing: boolean }> {
  const sym = encodeURIComponent(slug);
  let last: string | null = null; let fallback: SkyFacts | null = null; let pages = 0, notFound = 0;
  for (const [basis, url] of [['consolidated', `https://www.screener.in/company/${sym}/consolidated/`], ['standalone', `https://www.screener.in/company/${sym}/`]] as const) {
    pages++;
    const got = await fetchScreenerHtml(url, 12_000);
    if (!got.html) { last = got.error || 'screener.in did not answer'; if (/\b404\b|not found/i.test(last)) notFound++; continue; }
    const f = inFactsFromHtml(t, got.html, basis, url);
    if (!f) { last = 'no quarterly table'; continue; }
    if (!isCurrentPeriod(f.period)) { last = `latest ${basis} quarter is ${f.period} — too old`; continue; }
    if (f.salesYoyQ != null || f.roce != null) return { facts: f, error: null, missing: false };
    fallback = fallback || f; last = `${basis} table has no year-ago quarter`;
  }
  return fallback ? { facts: fallback, error: null, missing: false } : { facts: null, error: last, missing: notFound === pages };
}

export async function GET(req: NextRequest) {
  const limited = rateLimitResponse(req, 20, 60_000);
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const IN = list(sp.get('in'), /^[A-Z0-9][A-Z0-9&-]{0,19}$/);
  // zzz925: optional company names for India symbols ('n=BMW:BMW Industries Ltd'), used only when the symbol has no screener.in page
  const names = new Map<string, string>();
  for (const v of sp.getAll('n').slice(0, MAX_PER_MARKET)) {
    const i = v.indexOf(':'); if (i <= 0) continue;
    const name = v.slice(i + 1).replace(/[^\p{L}\p{N}&().,' -]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (name) names.set(v.slice(0, i).trim().toUpperCase(), name);
  }
  const US = list(sp.get('us'), /^[A-Z][A-Z0-9.\-]{0,9}$/);
  if (!IN.length && !US.length) return NextResponse.json({ ok: false, error: 'in or us tickers required' }, { status: 400 });
  const t0 = Date.now();
  const facts: Record<string, SkyFacts | null> = {};   // key 'IN:TICKER' / 'US:TICKER'
  const errors: Record<string, string> = {};
  const pending: string[] = [];
  const caps: { IN: Record<string, number>; US: Record<string, number> } = { IN: {}, US: {} };

  const india = (async () => {
    const todo: string[] = [];
    const hits = await Promise.all(IN.map((t) => kvGet<{ facts: SkyFacts | null; error: string | null }>(inKey(t)).catch(() => null)));
    IN.forEach((t, i) => { const h = hits[i]; if (h && (h.facts ? isCurrentPeriod(h.facts.period) : true)) { facts[`IN:${t}`] = h.facts; if (h.error) errors[`IN:${t}`] = h.error; } else todo.push(t); });
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const t = todo[i++];
        if (Date.now() - t0 > DEADLINE_MS - 12_000) { pending.push(`IN:${t}`); continue; }
        const got = await inFacts(t, names.get(t) ?? null).catch((e: any) => ({ facts: null, error: String(e?.message || e).slice(0, 120) }));
        facts[`IN:${t}`] = got.facts; if (got.error) errors[`IN:${t}`] = got.error;
        await kvSet(inKey(t), got, got.facts ? TTL_OK : TTL_FAIL).catch(() => null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
  })();

  const usa = (async () => {
    if (!US.length) return;
    const [batch, trends, usCaps] = await Promise.all([
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
      // zzz925: market caps, 6 at a time, each bounded (8 s) — names not answered stay "size not known"
      (async () => {
        const out: Record<string, number> = {};
        await pooled(US, 6, async (t) => {
          if (Date.now() - t0 > DEADLINE_MS - 8_000) return;
          const c = await usCap(t).catch(() => null);
          if (c != null) out[t] = c;
        });
        return out;
      })().catch(() => ({} as Record<string, number>)),
    ]);
    Object.assign(caps.US, usCaps);
    for (const t of US) {
      const row = batch?.rows?.[t];
      if (row?.retrieval_failed) { pending.push(`US:${t}`); errors[`US:${t}`] = String(row.why || 'SEC request failed'); continue; }
      facts[`US:${t}`] = usFactsFromRow(t, row, trends[t]);
      if (facts[`US:${t}`] && usCaps[t] != null) facts[`US:${t}`]!.mcap = usCaps[t];
      if (!facts[`US:${t}`]) errors[`US:${t}`] = String(row?.why || 'no SEC figures');
    }
  })();

  await Promise.all([india, usa]);
  for (const [k, f] of Object.entries(facts)) if (k.startsWith('IN:') && f?.mcap != null && f.mcap > 0) caps.IN[k.slice(3)] = f.mcap;
  return NextResponse.json({ ok: true, facts, caps, errors, pending, ms: Date.now() - t0 }, { headers: { 'Cache-Control': 'private, max-age=600' } });
}
