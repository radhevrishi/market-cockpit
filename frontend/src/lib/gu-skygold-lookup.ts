// zzz925 — two lookups the "Next Sky Gold" focus list needed (owner's page, 6 Oct):
//   • US market cap. The focus list sized US names only from the graded results of the chosen window, so almost every US row said
//     "size not known" and large caps (Dell, Oracle, HPE, Vertiv, Celestica …) stayed in "Small & mid only". The skygold route now reads
//     the market cap Nasdaq prints for the listed US names (the same Nasdaq quote API the app already uses for price history), cached.
//   • The screener.in page of a BSE-only company. BMW Industries is filed as "BMW", but screener.in has no /company/BMW/ (404): its page
//     is /company/542669/. The screener.in search, asked for the COMPANY NAME, gives the right page; a search by the bare symbol is not
//     trusted unless the symbol matches exactly ("BMW" first returns BMW Ventures, a different company).
// Pure helpers here (unit-tested); the fetches live in the route.

/** Nasdaq quote summary → market cap in $ million (null when missing / not a number). */
export function nasdaqMarketCapMusd(j: any): number | null {
  const raw = j?.data?.summaryData?.MarketCap?.value;
  if (raw == null) return null;
  const v = Number(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) && v > 0 ? Math.round((v / 1e6) * 10) / 10 : null;
}

const STOP = new Set(['ltd', 'limited', 'the', 'co', 'company', 'inc', 'corp', 'corporation', 'pvt', 'private', 'plc', 'and', '&']);
/** 'BMW Industries Ltd' → 'bmw industries' (lower case, punctuation and company suffixes dropped). */
export function normCompany(name: string | null | undefined): string {
  return String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9& ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).join(' ');
}

/** The screener.in page slug for a company from its search answer: the slug equal to the symbol, else the one company whose name matches
 *  the given name (equal, or one name starting with the other, two words or more). Never "the first result" — that was another company. */
export function pickScreenerSlug(list: Array<{ name?: string; url?: string }> | null | undefined, symbol: string, company?: string | null): string | null {
  const rows = (Array.isArray(list) ? list : []).map((c) => ({ name: normCompany(c?.name), slug: /^\/company\/([^/]+)\//.exec(String(c?.url || ''))?.[1] || '' })).filter((c) => c.slug);
  const sym = String(symbol || '').toUpperCase();
  const exact = rows.find((c) => c.slug.toUpperCase() === sym);
  if (exact) return exact.slug;
  const want = normCompany(company);
  if (!want) return null;
  const hit = rows.filter((c) => c.name && (c.name === want || ((c.name.startsWith(`${want} `) || want.startsWith(`${c.name} `)) && Math.min(c.name.split(' ').length, want.split(' ').length) >= 2)));
  return hit.length === 1 ? hit[0].slug : hit.find((c) => c.name === want)?.slug ?? null;
}

/** zzz927: "$574.19" / "574.19" → 574.19 (null when not a positive number). */
export function dollarNum(raw: unknown): number | null {
  if (raw == null) return null;
  const v = Number(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}
/** zzz927: the share price, sector and industry for the fair-value estimate, from the two Nasdaq answers the route already reads
 *  (quote summary → previous close, sector, industry; quote info → last sale). The last sale wins; the previous close is the fallback. */
export function nasdaqQuoteFields(summary: any, info: any): { price: number | null; sector: string | null; industry: string | null } {
  const sd = summary?.data?.summaryData;
  const price = dollarNum(info?.data?.primaryData?.lastSalePrice) ?? dollarNum(sd?.PreviousClose?.value);
  const txt = (v: unknown) => { const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''; return t && t !== 'N/A' ? t : null; };
  return { price, sector: txt(sd?.Sector?.value), industry: txt(sd?.Industry?.value) };
}

/** zzz1141 — fill a US quote (market cap $M, price, sector, industry) from the app's own US screener snapshot where the Nasdaq read gave
 *  nothing. Nasdaq's own values win; the snapshot only fills gaps. Class shares: "MOG-A" / "MOG.A" match. Pure. */
export function fillUsQuoteFromSnapshot(
  q: { cap: number | null; price: number | null; sector: string | null; industry: string | null; at: string } | null,
  ticker: string, rows: ReadonlyArray<{ t: string; mc?: number | null; px?: number | null; sec?: string | null; ind?: string | null }>, builtAt: string | null,
): { cap: number | null; price: number | null; sector: string | null; industry: string | null; at: string } | null {
  const norm = (x: string) => String(x || '').toUpperCase().replace(/[.\-/]/g, '');
  const want = norm(ticker);
  const r = rows.find((x) => norm(x.t) === want);
  if (!r) return q;
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const base = q || { cap: null, price: null, sector: null, industry: null, at: '' };
  const usedPrice = base.price == null && ok(r.px);
  return {
    cap: base.cap ?? (ok(r.mc) ? Math.round(r.mc * 10) / 10 : null),
    price: base.price ?? (ok(r.px) ? r.px : null),
    sector: base.sector ?? (r.sec || null),
    industry: base.industry ?? (r.ind || null),
    at: usedPrice ? String(builtAt || '').slice(0, 10) || base.at : base.at || String(builtAt || '').slice(0, 10),
  };
}
