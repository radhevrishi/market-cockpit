// ═══════════════════════════════════════════════════════════════════════════
// INDIA EARNINGS OPPORTUNITIES — WHAT A CARD MAY HONESTLY SHOW  (zzz820)
//
// The owner: "see if all data correct or something messed up; if so fix".
// Pure helpers (no fetch, no React), unit-tested in
// src/lib/__tests__/zzz820-india-eo-data.test.ts. They run on the stored
// graded rows at display time, so rows already on file read correctly without
// being re-graded, and they never invent a figure: anything that cannot be
// shown honestly becomes '—' with a plain reason.
//
//   1. QUARTER LABEL. Indian FY runs Apr–Mar. Results filed in Jul–Sep are for
//      Apr–Jun = Q1 of the FY that ends next March (Aug 2026 → Q1 FY27). A
//      stored label for a quarter that had not even ENDED on the filing date
//      (Aether, 31 Jul 2026, stored "Q1 FY28") is impossible and is replaced
//      by the quarter the filing date implies.
//   2. YEAR-AGO BASE. Screener tables have gaps (half-yearly SME filers, a
//      company that changed its financial year). The feed used to take "four
//      columns back" as the year-ago quarter, so Sales/EPS "YoY" were
//      sometimes measured against a quarter five periods old while profit —
//      which had no such fallback — showed '—'. Those rows are recognisable
//      (sales/EPS year-ago present, profit year-ago missing, Screener feed)
//      and their growth figures are withheld with the reason.
//   3. MARGIN. An operating margin of exactly 0.0% (and 0.0% a year ago) is
//      the feed's "no figure", not a real margin. Banks, NBFCs and insurers
//      have no operating margin in the usual sense (Screener shows a
//      "financing margin" that is often negative for a profitable bank), so
//      for them the tile shows net profit ÷ total income instead — both
//      figures from the same row — and says so.
// ═══════════════════════════════════════════════════════════════════════════

const ISO_RE = /^\d{4}-\d{2}-\d{2}/;
const DAY_MS = 86_400_000;

const fin = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);

// ─── 1. Quarter label ─────────────────────────────────────────────────────

/** The results quarter a filing on this date is normally for, e.g.
 *  2026-08-12 → "Q1 FY27", 2026-05-20 → "Q4 FY26", 2026-11-10 → "Q2 FY27",
 *  2027-02-05 → "Q3 FY27". Null for an unreadable date. */
export function resultsQuarterFor(filingIso: string | null | undefined): string | null {
  const s = String(filingIso || '');
  if (!ISO_RE.test(s)) return null;
  const y = +s.slice(0, 4), m = +s.slice(5, 7);
  if (!y || !m) return null;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  if (m <= 3) return `Q3 FY${yy(y)}`;       // Oct–Dec quarter, FY ends this March
  if (m <= 6) return `Q4 FY${yy(y)}`;       // Jan–Mar quarter, FY ended this March
  if (m <= 9) return `Q1 FY${yy(y + 1)}`;   // Apr–Jun quarter, FY ends next March
  return `Q2 FY${yy(y + 1)}`;               // Jul–Sep quarter, FY ends next March
}

/** "Q1 FY27" → "2026-06-30" (the quarter's last day), or null. */
export function quarterEndIso(label: string | null | undefined): string | null {
  const m = String(label || '').match(/Q([1-4])\s*FY\s?'?(\d{2}|\d{4})\b/i);
  if (!m) return null;
  const q = +m[1];
  const fy = m[2].length === 4 ? +m[2] : 2000 + +m[2];
  if (q === 1) return `${fy - 1}-06-30`;
  if (q === 2) return `${fy - 1}-09-30`;
  if (q === 3) return `${fy - 1}-12-31`;
  return `${fy}-03-31`;
}

/** A late filer or a new listing may file the PREVIOUS quarter, up to this
 *  many days after it ended; anything older is not this season's result. */
export const MAX_FILING_LAG_DAYS = 200;

export interface QuarterCheck {
  /** What the card shows. */
  label: string | null;
  /** True when the stored label was replaced. */
  corrected: boolean;
  /** The stored label, when it was replaced (for the tooltip). */
  stored?: string;
  reason?: string;
}

/**
 * The quarter label a card may show. A stored label is kept when the quarter
 * had ended by the filing date and ended no more than MAX_FILING_LAG_DAYS
 * before it. Otherwise — a quarter still in the future, a years-old one, or a
 * bare "Q1" with no year — the label comes from the filing date.
 */
export function checkQuarterLabel(stored: string | null | undefined, filingIso: string | null | undefined): QuarterCheck {
  const s = String(stored || '').trim();
  const derived = resultsQuarterFor(filingIso);
  if (!derived) return { label: s || null, corrected: false };
  if (!s) return { label: derived, corrected: false };
  const end = quarterEndIso(s);
  if (!end) {
    // "Q1" alone (older payloads) — same quarter, add the year.
    const bare = s.match(/^Q([1-4])$/i);
    if (bare && derived.startsWith(`Q${bare[1]} `)) return { label: derived, corrected: false };
    return { label: derived, corrected: true, stored: s, reason: `stored label "${s}" is not a quarter this filing can be for` };
  }
  const filed = Date.parse(String(filingIso).slice(0, 10) + 'T00:00:00Z');
  const ended = Date.parse(end + 'T00:00:00Z');
  const lag = (filed - ended) / DAY_MS;
  if (lag < 0) return { label: derived, corrected: true, stored: s, reason: `stored "${s}" had not ended on the filing date` };
  if (lag > MAX_FILING_LAG_DAYS) return { label: derived, corrected: true, stored: s, reason: `stored "${s}" ended ${Math.round(lag)} days before the filing` };
  // Normalise spacing/case ("Q1FY27" → "Q1 FY27").
  const m = s.match(/Q([1-4])\s*FY\s?'?(\d{2}|\d{4})/i)!;
  return { label: `Q${m[1]} FY${m[2].slice(-2)}`, corrected: false };
}

// ─── 3. Financial companies (banks, NBFCs, insurers) ──────────────────────

const FIN_TEXT_RE = /\b(bank|banks|banking|nbfc|non[- ]banking|lending|lender|micro ?finance|housing finance|finance|financiers?|financial services|fincorp|finserv|finvest|finlease|leasing|credit|insurance|assurance)\b/i;

export type FinancialKind = 'lender' | 'insurer';

/**
 * Is this a bank / NBFC / insurer, for which an operating margin is not a
 * meaningful figure? Read from the sector/industry fields when the feed has
 * them, else from the company's registered name ("… Bank Ltd", "… Finance
 * Ltd", "… Small Finance Bank", "… Housing Finance", "… Fincorp"). Never from
 * a ticker list.
 */
export function financialKind(r: { sector?: any; industry?: any; sub_sector?: any; company?: any } | null | undefined): FinancialKind | null {
  if (!r) return null;
  const text = [r.sector, r.industry, r.sub_sector, r.company].filter(Boolean).map(String).join(' | ');
  if (!text) return null;
  if (/\b(insurance|assurance)\b/i.test(text) && !/\bbank\b/i.test(text)) return 'insurer';
  // "Capital" alone is NOT enough (CP Capital is an education company); it
  // needs a finance word.
  return FIN_TEXT_RE.test(text) ? 'lender' : null;
}

export interface MarginView {
  /** 'opm' — operating margin; 'net' — net profit ÷ total income (financials). */
  mode: 'opm' | 'net';
  label: string;
  value: number | null;
  prev: number | null;
  /** One short line under the figure. */
  note: string;
  /** Tooltip. */
  title: string;
}

const pctOf = (num: any, den: any): number | null =>
  fin(num) && fin(den) && den > 0 ? Math.round((num / den) * 1000) / 10 : null;

/** What the margin tile shows. See header §3. */
export function marginView(r: any, opts: { newlyListed?: boolean } = {}): MarginView {
  const kind = financialKind(r);
  if (kind) {
    const value = pctOf(r?.pat_curr_cr, r?.sales_curr_cr);
    const prev = pctOf(r?.pat_prev_cr, r?.sales_prev_cr);
    const who = kind === 'insurer' ? 'insurer' : 'bank / lender';
    return {
      mode: 'net',
      label: 'NET MARGIN',
      value, prev,
      note: value == null ? `${who} — profit or income not in source` : (prev == null ? `${who} · prior n/a` : `${who} · vs ${prev.toFixed(1)}%`),
      title: `${who[0].toUpperCase()}${who.slice(1)}: operating margin is not a meaningful figure (Screener shows a "financing margin" that can be negative for a profitable lender). Shown instead: net profit ÷ total income, both from this quarter's result${prev != null ? ', against the same quarter last year' : ''}.`,
    };
  }
  let value: number | null = fin(r?.opm_pct) ? r.opm_pct : null;
  let prev: number | null = fin(r?.opm_prev_pct) ? r.opm_prev_pct : null;
  // Exactly 0.0% is the feed's "no figure" (the Screener worker writes 0 when
  // the row is absent). A real margin is essentially never exactly zero.
  const zeroNow = value === 0, zeroPrev = prev === 0;
  if (zeroNow) value = null;
  if (zeroPrev) prev = null;
  const note = value != null
    ? (prev != null ? `vs ${prev.toFixed(1)}%` : 'prior n/a')
    : (zeroNow ? 'not in source' : (opts.newlyListed ? 'newly listed' : 'not in source'));
  return {
    mode: 'opm',
    label: 'OPM MARGIN',
    value, prev, note,
    title: zeroNow || zeroPrev
      ? 'The source reported the margin as 0.0% — that is its "no figure" value, so it is shown as unknown rather than as a zero margin.'
      : 'Operating profit ÷ sales for the quarter, against the same quarter last year.',
  };
}

// ─── 2. Year-ago base ─────────────────────────────────────────────────────

/**
 * True when the row's Sales/EPS "YoY" came from a positional look-back over a
 * gappy Screener table and so may compare against the wrong quarter. The
 * signature: Screener-worker feed, profit this quarter known, profit a year
 * ago missing, yet a sales or EPS year-ago figure present (the worker's own
 * year-ago block carries all three together; only the positional fallback
 * fills sales and EPS without profit).
 */
export function yearAgoUnverified(r: any): boolean {
  if (!r) return false;
  const src = String(r.source || r.financials_source || '');
  if (src !== 'screener-worker') return false;
  if (!fin(r.pat_curr_cr) || fin(r.pat_prev_cr)) return false;
  return fin(r.sales_prev_cr) || fin(r.eps_prev);
}

export const YEAR_AGO_UNVERIFIED_NOTE =
  'Growth not shown: the same quarter last year could not be matched in the Screener table (it has a gap), so the stored growth figures may compare against the wrong quarter.';

export interface GrowthView {
  sales: number | null; salesPrev: number | null;
  pat: number | null; patPrev: number | null;
  eps: number | null; epsPrev: number | null;
  /** Set when growth is withheld. */
  withheld: string | null;
  /** Why the profit figure is '—' while EPS is present, if it is. */
  patNote: string | null;
}

/** The growth figures a card may show. Never back-computes a figure. */
export function growthView(r: any): GrowthView {
  const n = (v: any) => (fin(v) ? v : null);
  if (yearAgoUnverified(r)) {
    return {
      sales: null, salesPrev: null, pat: null, patPrev: null, eps: null, epsPrev: null,
      withheld: YEAR_AGO_UNVERIFIED_NOTE,
      patNote: null,
    };
  }
  const pat = n(r?.net_profit_yoy_pct ?? r?.pat_yoy_pct);
  const patPrev = n(r?.pat_prev_cr);
  const patNote = pat == null && patPrev == null && fin(r?.pat_curr_cr) && fin(r?.eps_yoy_pct)
    ? 'year-ago profit not in source'
    : null;
  return {
    sales: n(r?.sales_yoy_pct), salesPrev: n(r?.sales_prev_cr),
    pat, patPrev,
    eps: n(r?.eps_yoy_pct), epsPrev: n(r?.eps_prev),
    withheld: null,
    patNote,
  };
}

// ─── Words instead of 0–100 numbers ───────────────────────────────────────

/** Quality / inflection axis as a word (the number is not shown). */
export function axisWord(v: any, kind: 'quality' | 'inflection'): string | null {
  if (!fin(v)) return null;
  if (kind === 'quality') return v >= 70 ? 'high quality' : v >= 45 ? 'fair quality' : 'low quality';
  return v >= 70 ? 'strong inflection' : v >= 45 ? 'some inflection' : 'little inflection';
}

/** Post-earnings drift signal as a word. */
export function driftWord(v: any): string | null {
  if (!fin(v)) return null;
  return v >= 70 ? 'strong drift signal' : v >= 50 ? 'moderate drift signal' : 'weak drift signal';
}

/** A quadrant component ("cash conversion 20/20") as words. */
export function partWord(p: { label: string; points: number; of: number }): string {
  const f = p.of > 0 ? p.points / p.of : 0;
  return `${p.label} (${f >= 0.85 ? 'full marks' : f >= 0.4 ? 'partial' : f > 0 ? 'weak' : 'none'})`;
}

// ─── Stale rows (graded under previous rules) ─────────────────────────────

/** Rows graded by an older engine may lack RS / Stage: say so, never blank. */
export function notRecordedNote(r: any): string | null {
  if (!r?._engine_stale) return null;
  const miss: string[] = [];
  if (!fin(r.rs_rating)) miss.push('RS');
  if (!fin(r.stage)) miss.push('Stage');
  return miss.length ? `${miss.join(' & ')} not recorded (older grading rules)` : null;
}

// ─── One-call display fix for a stored row ────────────────────────────────

/**
 * The stored row with its quarter label made honest. Everything else on the
 * card is decided by marginView / growthView at render time; this only fixes
 * the label because it is read in many places (search, CSV, the chips).
 */
export function withHonestQuarter<R extends { quarter?: any; filing_date?: any; _window_date?: any }>(r: R): R & { _quarter_note?: string; _quarter_stored?: string } {
  const q = checkQuarterLabel(r?.quarter, r?._window_date || r?.filing_date);
  if (!q.label || (q.label === r.quarter && !q.corrected)) return r;
  return { ...r, quarter: q.label, ...(q.corrected ? { _quarter_note: q.reason, _quarter_stored: q.stored } : {}) };
}

// ─── Feed-side helpers (used by /api/v1/earnings/enrich) ──────────────────

/** A Screener page whose newest quarter ended more than this many days ago is
 *  stale for a results filing (typically the consolidated page of a company
 *  that stopped consolidating while its standalone page is current). */
export const SCREENER_STALE_DAYS = 120;

export function isQuarterEndStale(iso: string | null | undefined, now: number = Date.now()): boolean {
  if (!iso || !ISO_RE.test(String(iso))) return true;
  return (now - Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z')) / DAY_MS > SCREENER_STALE_DAYS;
}

/**
 * The latest value of a quarterly series and the value for the SAME month one
 * year earlier, found by the column's DATE label ("Jun 2026" → "Jun 2025").
 * Null when the dates are missing, do not line up with the series, or the
 * year-ago column is not there — never a positional guess.
 */
export function yoyFromDatedSeries(arr: any, dates: any): { curr: number; prev: number } | null {
  if (!Array.isArray(arr) || !Array.isArray(dates) || arr.length < 2 || arr.length !== dates.length) return null;
  const last = arr.length - 1;
  const lm = String(dates[last] || '').trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!lm) return null;
  const want = `${lm[1]} ${+lm[2] - 1}`.toLowerCase();
  const i = dates.findIndex((d: any) => {
    const m = String(d || '').trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
    return !!m && `${m[1]} ${m[2]}`.toLowerCase() === want;
  });
  if (i < 0) return null;
  const curr = Number(arr[last]), prev = Number(arr[i]);
  if (arr[last] == null || arr[i] == null || !Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  return { curr, prev };
}

/** Two reported figures describe the same number (within rounding: 2%, or
 *  ₹0.5 Cr for small values). Used to prove two sources read the same quarter
 *  on the same statement basis before mixing their figures. */
export function sameFigure(a: any, b: any): boolean {
  if (!fin(a) || !fin(b)) return false;
  const d = Math.abs(a - b);
  return d <= 0.5 || d <= 0.02 * Math.max(Math.abs(a), Math.abs(b));
}

/**
 * How many of a graded day's dropped companies are worth re-checking later —
 * the ones dropped for data that can still ARRIVE: the new quarter not yet on
 * Screener (or Screener serving a stale page), a filing not yet confirmed, or
 * the stale-data guard. Not: rows with no reason, or duplicates of one ticker.
 */
export function recheckableDrops(dropped: any): number {
  if (!Array.isArray(dropped)) return 0;
  const seen = new Set<string>();
  let n = 0;
  for (const x of dropped) {
    const t = String(x?.ticker || '').toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const r = String(x?.reason || '').toLowerCase();
    if (/not on screener|before the filing|scheduled|upcoming|no filing confirmed|stale-data guard|quarter not fresh/.test(r)) n++;
  }
  return n;
}

/** The stored one-line narrative, minus its growth percentages when those
 *  were withheld on the card (so the text never contradicts the tiles). */
export function narrativeForDisplay(r: any): string {
  let n = String(r?.narrative || '');
  // A corrected quarter label is corrected in the sentence too.
  const q = checkQuarterLabel(r?._quarter_stored || r?.quarter, r?._window_date || r?.filing_date);
  if (q.corrected && q.stored && q.label) n = n.split(q.stored).join(q.label);
  if (r?._quarter_stored && r?.quarter && r._quarter_stored !== r.quarter) n = n.split(r._quarter_stored).join(r.quarter);
  if (!yearAgoUnverified(r)) return n;
  return n
    .replace(/\s*\((?:[^()]*\bYoY\b[^()]*)\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() + ' (Growth figures withheld — year-ago quarter not matched.)';
}

// ─── zzz820b — a tier built on unverified growth does not stand silently ──

export const UNCONFIRMED_LABEL = 'UNCONFIRMED — figures being re-checked';
const TOP = new Set(['BLOCKBUSTER', 'STRONG']);

/**
 * A stored row whose growth was measured against an unverified year-ago
 * quarter (yearAgoUnverified) keeps its stored tier only as `_tier_unconfirmed`
 * (shown small and grey). A BLOCKBUSTER / STRONG row is held in MIXED so it
 * is never counted, chipped, exported or benched as a top-tier result until it
 * is regraded with correct figures. Idempotent.
 */
export function holdUnconfirmed<R extends { tier?: any }>(r: R): R & { _tier_unconfirmed?: string } {
  if (!r || (r as any)._tier_unconfirmed || !yearAgoUnverified(r)) return r;
  const stored = String(r.tier ?? '');
  return { ...r, _tier_unconfirmed: stored || 'unknown', tier: TOP.has(stored) ? 'MIXED' : r.tier };
}

/** holdUnconfirmed over a graded payload's by_tier (rows move bucket with their tier). */
export function holdUnconfirmedPayload<P extends { by_tier?: any }>(p: P): P {
  if (!p || !p.by_tier) return p;
  const out: Record<string, any[]> = {};
  for (const k of Object.keys(p.by_tier)) out[k] = [];
  let moved = false;
  for (const [k, list] of Object.entries(p.by_tier as Record<string, any[]>)) {
    if (!Array.isArray(list)) { out[k] = list as any; continue; }
    for (const r of list) {
      const h = holdUnconfirmed(r);
      const t = h && h !== r ? String(h.tier) : k;
      if (h !== r) moved = true;
      (out[t] ||= []).push(h);
    }
  }
  return moved ? { ...p, by_tier: out } : p;
}

/** How many rows of a stored day carry growth measured against an unverified
 *  year-ago quarter (for the prewarm re-check). */
export function unconfirmedRows(p: any): number {
  let n = 0;
  for (const list of Object.values(p?.by_tier || {})) {
    if (Array.isArray(list)) for (const r of list) if (yearAgoUnverified(r)) n++;
  }
  return n;
}

/** A graded payload without the grader's stored input (never kept in the
 *  browser — it is large and only the server regrade reads it). */
export function stripGradeInputForStorage<P extends { by_tier?: any }>(p: P): P {
  if (!p || !p.by_tier) return p;
  const by_tier: Record<string, any> = {};
  for (const [k, list] of Object.entries(p.by_tier as Record<string, any>)) {
    by_tier[k] = Array.isArray(list)
      ? list.map((r: any) => {
          if (!r || typeof r !== 'object' || !('grade_input' in r || '_stored_input' in r)) return r;
          const { grade_input: _g, _stored_input: _s, ...rest } = r;
          return rest;
        })
      : list;
  }
  return { ...p, by_tier };
}
