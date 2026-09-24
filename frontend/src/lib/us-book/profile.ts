// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — COMPANY NAME + SEC INDUSTRY PER HOLDING.       (zzz793)
//
// Server-only helper for /api/v1/us-book/profile. For each US-listed ticker:
//   SEC company_tickers.json   → CIK + registered company name
//   data.sec.gov submissions   → SIC code + SIC description
// then lib/us-book/sector maps the SIC code to a broad sector group.
// Class shares use the SEC spelling already (MOG-A, BRK-B), which is also
// how the book stores them, so the lookup is exact.
//
// Profiles change rarely, so they are cached in KV (one small document) for
// 30 days; a failed lookup is retried after a day, not stored as a fact.
// ═══════════════════════════════════════════════════════════════════════════

import { sicToSector, type UsSector } from './sector';

export interface UsProfile {
  ticker: string;
  name: string | null;
  cik: number | null;
  sic: string | null;
  sicDescription: string | null;
  sector: UsSector;
  /** 'sec' when found; 'not-found' when SEC does not list the ticker; 'error' when SEC could not be read. */
  status: 'sec' | 'not-found' | 'error';
  note: string | null;
  fetchedAt: string;
}

export const PROFILE_TTL_MS = 30 * 24 * 3600 * 1000;
export const PROFILE_RETRY_MS = 24 * 3600 * 1000;

const SEC_HEADERS = { 'User-Agent': 'MarketCockpit/1.0 info@market-cockpit.com', Accept: 'application/json' };

let tickerMap: { at: number; map: Record<string, { cik: number; title: string }> } | null = null;

async function secTickerMap(fetcher: typeof fetch): Promise<Record<string, { cik: number; title: string }>> {
  if (tickerMap && Date.now() - tickerMap.at < 24 * 3600 * 1000) return tickerMap.map;
  const r = await fetcher('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS, signal: AbortSignal.timeout(12_000) } as any);
  if (!r.ok) throw new Error(`SEC ticker list answered HTTP ${r.status}`);
  const data = await r.json();
  const map: Record<string, { cik: number; title: string }> = {};
  for (const e of Object.values<any>(data || {})) if (e?.ticker) map[String(e.ticker).toUpperCase()] = { cik: Number(e.cik_str), title: String(e.title || '') };
  tickerMap = { at: Date.now(), map };
  return map;
}

/** Is a cached profile still good? Pure. */
export function profileIsFresh(p: UsProfile | null | undefined, now = Date.now()): boolean {
  if (!p?.fetchedAt) return false;
  const age = now - Date.parse(p.fetchedAt);
  return p.status === 'error' ? age < PROFILE_RETRY_MS : age < PROFILE_TTL_MS;
}

export async function fetchUsProfiles(tickers: string[], fetcher: typeof fetch = fetch, now = new Date().toISOString()): Promise<Record<string, UsProfile>> {
  const out: Record<string, UsProfile> = {};
  let map: Record<string, { cik: number; title: string }>;
  try { map = await secTickerMap(fetcher); } catch (e: any) {
    for (const t of tickers) out[t] = { ticker: t, name: null, cik: null, sic: null, sicDescription: null, sector: 'Unknown', status: 'error', note: `SEC company list could not be read (${String(e?.message || e)})`, fetchedAt: now };
    return out;
  }
  const CONC = 4;
  for (let i = 0; i < tickers.length; i += CONC) {
    const slab = tickers.slice(i, i + CONC);
    await Promise.all(slab.map(async (t) => {
      const hit = map[t];
      if (!hit) { out[t] = { ticker: t, name: null, cik: null, sic: null, sicDescription: null, sector: 'Unknown', status: 'not-found', note: 'SEC does not list this ticker', fetchedAt: now }; return; }
      try {
        const r = await fetcher(`https://data.sec.gov/submissions/CIK${String(hit.cik).padStart(10, '0')}.json`, { headers: SEC_HEADERS, signal: AbortSignal.timeout(12_000) } as any);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const sic = j?.sic ? String(j.sic) : null;
        out[t] = { ticker: t, name: hit.title || j?.name || null, cik: hit.cik, sic, sicDescription: j?.sicDescription || null, sector: sicToSector(sic), status: 'sec', note: sic ? null : 'SEC record has no industry code', fetchedAt: now };
      } catch (e: any) {
        out[t] = { ticker: t, name: hit.title || null, cik: hit.cik, sic: null, sicDescription: null, sector: 'Unknown', status: 'error', note: `SEC filing record could not be read (${String(e?.message || e)})`, fetchedAt: now };
      }
    }));
    if (i + CONC < tickers.length) await new Promise((r) => setTimeout(r, 250));   // SEC asks for ≤ 10 requests / second
  }
  return out;
}
