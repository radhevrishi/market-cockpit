// ═══════════════════════════════════════════════════════════════════════════
// NASDAQ EARNINGS CALENDAR (server-only) — free, keyless.
//
//   https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
//
// Gives, per expected reporter on a date: symbol, name, market cap, report
// time (pre-market / after-hours), fiscal quarter ending, the analyst EPS
// consensus and how many estimates it rests on, and last year's EPS.
//
// This is the piece the free-data plan assumed did not exist. It gives us
// two things EDGAR cannot:
//   1. UPCOMING dates — the calendar can show who is scheduled to report
//      tomorrow, and "scheduled today · results pending" empties out as the
//      8-Ks land, exactly the India board-meeting flow.
//   2. CONSENSUS — actual EPS from the filing vs the estimate = the surprise,
//      the axis the grade was previously built without.
//
// Same User-Agent rule as the Nasdaq price fallback (browser UA, Accept
// header). Dates are per-request, so everything is cached: a completed date
// never changes (24h), today/future refresh hourly (companies add and move
// dates right up to the day).
// ═══════════════════════════════════════════════════════════════════════════

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface ExpectedReporter {
  ticker: string;
  company: string;
  time: 'pre-market' | 'after-hours' | 'unknown';
  market_cap_musd: number | null;
  fiscal_quarter: string | null;     // e.g. "Jul/2026"
  eps_estimate: number | null;
  estimates_n: number | null;
  eps_last_year: number | null;
  last_year_report_date: string | null;
  /** A foreign private issuer: reports on a 6-K, never an 8-K Item 2.02, so it
   *  can never move out of "results pending" into a graded tier. */
  foreign_filer?: boolean;
}

const _cal = new Map<string, { at: number; data: ExpectedReporter[] }>();
const CAL_MAX = 200;

function etToday(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}
const money = (s: any): number | null => {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t || t === 'N/A') return null;
  const neg = /^\(.*\)$/.test(t);
  const n = parseFloat(t.replace(/[$,()]/g, ''));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
};
const mdyToIso = (s: any): string | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
};

/** Expected reporters for one date. Empty array when Nasdaq has nothing (or is unreachable). */
export async function nasdaqEarningsOn(date: string): Promise<ExpectedReporter[]> {
  const today = etToday();
  const ttl = date < today ? 24 * 3600_000 : 60 * 60_000;
  const hit = _cal.get(date);
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  let out: ExpectedReporter[] = [];
  try {
    const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const j: any = await res.json();
      const rows: any[] = j?.data?.rows || [];
      for (const r of rows) {
        const sym = String(r?.symbol || '').trim().toUpperCase();
        if (!sym) continue;
        const t = String(r?.time || '');
        out.push({
          ticker: sym,
          company: String(r?.name || sym),
          time: t.includes('pre') ? 'pre-market' : t.includes('after') ? 'after-hours' : 'unknown',
          market_cap_musd: (() => { const v = money(r?.marketCap); return v == null ? null : v / 1e6; })(),
          fiscal_quarter: r?.fiscalQuarterEnding ? String(r.fiscalQuarterEnding) : null,
          eps_estimate: money(r?.epsForecast),
          estimates_n: (() => { const n = parseInt(String(r?.noOfEsts || ''), 10); return Number.isFinite(n) ? n : null; })(),
          eps_last_year: money(r?.lastYearEPS),
          last_year_report_date: mdyToIso(r?.lastYearRptDt),
        });
      }
    }
  } catch { out = []; }

  if (_cal.size >= CAL_MAX) {
    const oldest = Array.from(_cal.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 50);
    for (const [k] of oldest) _cal.delete(k);
  }
  _cal.set(date, { at: Date.now(), data: out });
  return out;
}

// ─── earnings surprise history (actual ADJUSTED EPS vs consensus) ───────────
//   https://api.nasdaq.com/api/company/{TICKER}/earnings-surprise
// Populated the same day a company reports — days or weeks before the 10-Q
// carries the GAAP numbers to EDGAR. Lets a fresh print (DELL, AVGO, PANW on
// the evening they report) get a PRELIMINARY grade on EPS growth + surprise +
// price reaction, replaced by the full XBRL grade when the filing posts.
// NOTE these are street-basis (adjusted) EPS, not GAAP — label them so.
export interface SurpriseRow {
  fiscal_qtr_end: string | null;     // "Jul 2026"
  period_end: string | null;         // ISO last day of that month
  date_reported: string | null;      // ISO
  eps: number | null;                // actual, adjusted
  consensus: number | null;
  surprise_pct: number | null;
}
const _sur = new Map<string, { at: number; data: SurpriseRow[] }>();
const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

export async function nasdaqSurprises(ticker: string): Promise<SurpriseRow[]> {
  const t = ticker.toUpperCase();
  const hit = _sur.get(t);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.data;
  let out: SurpriseRow[] = [];
  try {
    const res = await fetch(`https://api.nasdaq.com/api/company/${encodeURIComponent(t)}/earnings-surprise`, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const j: any = await res.json();
      const rows: any[] = j?.data?.earningsSurpriseTable?.rows || [];
      for (const r of rows) {
        const fq = r?.fiscalQtrEnd ? String(r.fiscalQtrEnd) : null;
        let periodEnd: string | null = null;
        const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(fq || '');
        if (m && MONTHS[m[1]]) {
          const mo = MONTHS[m[1]], y = parseInt(m[2], 10);
          const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
          periodEnd = `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
        }
        out.push({
          fiscal_qtr_end: fq,
          period_end: periodEnd,
          date_reported: mdyToIso(r?.dateReported),
          eps: typeof r?.eps === 'number' ? r.eps : money(r?.eps),
          consensus: money(r?.consensusForecast),
          surprise_pct: money(r?.percentageSurprise),
        });
      }
    }
  } catch { out = []; }
  if (_sur.size > 2000) {
    const oldest = Array.from(_sur.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 400);
    for (const [k] of oldest) _sur.delete(k);
  }
  _sur.set(t, { at: Date.now(), data: out });
  return out;
}

/**
 * Consensus lookup for a filing: Nasdaq keys the estimate to the EXPECTED
 * date, which can differ from the 8-K date by a day (after-hours release on
 * D, 8-K accepted D or D+1). Look at D−1..D+1 and take the first match.
 */
export async function consensusFor(ticker: string, filingDate: string): Promise<ExpectedReporter | null> {
  const t = ticker.toUpperCase();
  const base = Date.parse(filingDate + 'T00:00:00Z');
  for (const off of [0, -1, 1, -2]) {
    const d = new Date(base + off * 86_400_000).toISOString().slice(0, 10);
    const rows = await nasdaqEarningsOn(d);
    const hit = rows.find((r) => r.ticker === t);
    if (hit) return hit;
  }
  return null;
}
