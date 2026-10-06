// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA CONVICTION BEATS FILTER — ONE COPY, TWO PAGES.           (zzz811)
//
// Moved VERBATIM out of app/(dashboard)/watchlists/page.tsx (the Conviction
// Beats tab) so Portfolio Catalysts can apply the SAME function
// (passesConvictionFilter), with the SAME filters (the India preset, or none
// when the owner switched it off — `mc:cb:preset:v3:optout`), to the SAME
// list (this browser's Conviction Beats merged with the server bench, newest
// filing wins). Before this, Portfolio Catalysts judged the bench with the
// ALERT preset (passesIndiaPreset) on a different row, which disagrees with
// the Conviction Beats page on nulls, PEAD, margin direction, financials and
// the verdict — so the two pages could never show the same list.
//
// Only additions below the moved code: the list merge the page did inline,
// the owner's saved on/off choice, and the per-criterion fail reasons (each
// probed THROUGH passesConvictionFilter, so a label can never disagree).
// ═══════════════════════════════════════════════════════════════════════════

import { peadScore } from '@/lib/pead-score';
import { INDIA_PRESET } from '@/lib/quality-preset';
import type { ConvictionEntry } from '@/lib/conviction-beats';
import { runCriteriaCheck, type CriteriaCheck } from '@/lib/criteria-check';
import { decodeEntities, financialKindOfRow, driftBand } from '@/lib/india-eo-card-data';
import { CASH_RATIO_MAX } from '@/lib/india-cash';

// zzz253 — hardcoded sector map for known NSE tickers. Backend enrichment
// often returns null sector; this fallback ensures peer comparison + sector-
// median P/E coloring work even when Screener/Worker skip sector data.
export const NSE_SECTOR_MAP: Record<string, string> = {
  LAURUSLABS: 'Pharma', GRANULES: 'Pharma', VENUSREM: 'Pharma', IPCALAB: 'Pharma', GLENMARK: 'Pharma', GUFICBIO: 'Pharma',
  ATUL: 'Chemicals', KRISHANA: 'Chemicals/Fertilizers', PLASTIBLEN: 'Chemicals/Additives',
  MAHLIFE: 'Real Estate', DBREALTY: 'Real Estate', PROZONER: 'Real Estate',
  CYIENTDLM: 'EMS/Defence', AVANTEL: 'Defence', KERNEX: 'Defence',
  RPEL: 'Refractories', TINNARUBR: 'Rubber Products',
  SGFIN: 'NBFC', POONAWALLA: 'NBFC', FEDFINA: 'NBFC', LTF: 'NBFC', BFINVEST: 'NBFC',
  MENONBE: 'Auto Parts', SSWL: 'Auto Parts', JAMNAAUTO: 'Auto Parts', LUMAXTECH: 'Auto Parts',
  'BAJAJ-AUTO': 'Auto OEM',
  SESHAPAPER: 'Paper',
  IDFCFIRSTB: 'Banks', UJJIVANSFB: 'Banks', CSBBANK: 'Banks', KARURVYSYA: 'Banks', JSFB: 'Banks', MAHABANK: 'PSU Banks',
  ADANIENSOL: 'Power/Transmission', ADANIPOWER: 'Power', GIPCL: 'Power', IREDA: 'Power/Green Finance',
  JSWSTEEL: 'Steel', JAYNECOIND: 'Steel', STEELXIND: 'Steel',
  ANGELONE: 'Broker/Fintech',
  BAJAJCON: 'FMCG', NESTLEIND: 'FMCG',
  'NAM-INDIA': 'AMC',
  ORIENTELEC: 'Consumer Durables',
  LALPATHLAB: 'Diagnostics',
  CRISIL: 'Ratings/Analytics',
  GLOBUSSPR: 'Distillers/Breweries',
  TECHM: 'IT Services', KSOLVES: 'IT Services',
  ITCHOTELS: 'Hotels',
  NEWGEN: 'IT Products',
  SONAMLTD: 'Jewelry/Bullion',
  INOXGREEN: 'Renewables', OLECTRA: 'EVs/Buses', NIBE: 'Defence/Aerospace',
  SBC: 'Textiles', ASMS: 'Electronics/Bartronics',
  SHREEJISPG: 'Textiles',
  GICL: 'Auto Parts/Globe',
  RUBICON: 'IT Products',
  WANBURY: 'Pharma',
  PASHUPATI: 'Overseas Products',
  NCLIND: 'Cement',
  AEGISLOG: 'Logistics',
  GRMOVER: 'Overseas Trading',
  ASIANPAINT: 'Paints',
  DYNPRO: 'Engineering',
};

// zzz253 — sector resolver: prefer explicit entry.sector, fall back to map
export const resolveSector = (e: any): string | null => {
  if (e?.sector && typeof e.sector === 'string' && e.sector.trim() !== '') return e.sector.trim();
  const t = (e?.ticker || '').toUpperCase();
  return NSE_SECTOR_MAP[t] || null;
};

// USER-REQ — Conviction Beats composable filters
//   1) Op-leverage (PAT/Sales ratio)  ≥1.5× / ≥2× / ≥3×
//   2) Sales YoY  ≥20/30/40/50%
//   3) PAT YoY    ≥20/30/40/50/60/100%
//   4) EPS YoY    ≥20/40/60%
// All compose AND-style. Counts beside each chip reflect the current
// post-filter universe so the user can see how each chip narrows.
export type ConvFilters = {
  opLev: number | null;     // ratio threshold (1.5/2/3)
  sales: number | null;     // % threshold
  pat: number | null;
  eps: number | null;
  pead: number | null;      // USER-REQ — minimum PEAD score (50/60/70/80)
  // zzz223 — OPM margin delta (pp YoY): v ≥ 0 means "expansion ≥ v pp",
  // v < 0 means "squeeze ≤ v pp". Mirrors the EO margin signal.
  opmDelta?: number | null;
  // zzz225 — minimum composite tier score (the big number on each card,
  // e.g. 67) — the EO grading composite, distinct from the PEAD score.
  score?: number | null;
  // zzz226e — minimum ABSOLUTE OPM level (latest quarter %), distinct from
  // the delta filter — screens out structurally thin-margin businesses.
  opmMin?: number | null;
  // zzz329 — max trailing P/E (null = no cap; excludes negative-earnings tickers)
  peMax?: number | null;
  // zzz332 - when true, entries with filing_date within last 3 business days bypass preset gates
  freshBypass?: boolean;
  // zzz348 — minimum market cap in Cr (null = no min)
  mktCapMin?: number | null;
  /** zzz883 — size CEILING (₹ Cr). The preset sets ₹30,000 Cr: small and mid caps only (Rishi's rule). Unknown size passes. */
  mktCapMax?: number | null;
  // zzz304 — minimum CFO/PAT ratio (Screener). Filters low earnings quality;
  // 0.5 = weak, 0.8 = healthy, 1.0 = pristine cash conversion.
  cfoPatMin?: number | null;
  // zzz360 — max promoter-pledge % (null = no cap). 0 = only unpledged names.
  // Null pledged_pct passes (don't over-filter unknowns).
  pledgedMax?: number | null;
  // zzz362 — multi-select verdict filter. When a non-empty array, only entries
  // whose cbComputeQuality verdict label ∈ the array pass. Labels: STRONG BUY /
  // BUY / WATCH / AVOID / HIGH RISK. null = no filter.
  verdicts?: string[] | null;
  sortByPead: boolean;
  // PATCH 1018 — ELITE / MULTIBAGGER quality filters (mirror Earnings Opps)
  elite: boolean;
  multibagger: boolean;
  // zzz540 — only entries added to the bench in the last 10 days
  newOnly?: boolean;
  // USER-REQ — Guidance in Conviction tab. null = no filter; specific label
  // means "only entries whose derived guidance matches this label".
  guidance: 'Positive' | 'Negative' | 'Neutral' | null;
  // PATCH 0909 — Indian-FY quarter + fiscal-year filter.
  //   Derived from filing_date by deriveQuarterFY() below using the
  //   Indian FY convention (Apr-Mar). User feedback: "earnings hub,
  //   conviction beats i need some way to filter dates by quarter and
  //   year and all filter logic to be perfect".
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null;
  fy: number | null;        // 26 = FY26 (Apr 2025 - Mar 2026), etc.
  // PATCH 0918 — Free-form date-range filter on filing_date.
  // User feedback: "also give option to slect dates i want with year
  // also give that optin as filter". Composes AND with Q + FY chips so
  // user can narrow even further (e.g. "Q4 FY26 entries filed
  // between May 1 and May 15"). Both nullable — either side optional.
  fromDate: string | null;  // YYYY-MM-DD or null
  toDate: string | null;    // YYYY-MM-DD or null
  // PATCH 0945 — D1 close bucket filter (same chip set as /earnings).
  // Each value is a SIGNED threshold: positive = "D1 >= N%", negative = "D1 <= N%".
  // null = no filter.
  d1Bucket: number | null;
  // zzz229 — 2D CLOSE bucket filter. d2_pct = cumulative % close change over
  // 2 trading sessions (skips weekends/holidays). Value semantics identical
  // to d1Bucket: positive = "≥ N%", negative = "≤ N%".
  d2Bucket: number | null;
  driftBucket: number | null;  // zzz245 — cumulative drift % filter
  // PATCH 1022/1024 — market-cap range filter (uses market_cap_cr in ₹ Cr).
  cap: 'all' | 'sweet' | 'mega' | 'large' | 'mid' | 'small' | 'micro';
};

export const FILTER_DEFAULT: ConvFilters = { opLev: null, sales: null, pat: null, eps: null, pead: null, sortByPead: false, elite: false, multibagger: false, newOnly: false, guidance: null, quarter: null, fy: null, fromDate: null, toDate: null, d1Bucket: null, d2Bucket: null, driftBucket: null, opmDelta: null, score: null, opmMin: null, peMax: null, freshBypass: false, mktCapMin: null, cfoPatMin: null, pledgedMax: null, verdicts: null /* zzz362 */, cap: 'all' };

// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA QUALITY PRESET — ONE DEFINITION, THREE READERS.        (zzz672)
//
// These numbers used to be written out three times: once in the auto-apply on
// mount, once in the button's click handler, and once in the `presetActive`
// test that decides whether the chip reads ON. zzz659 lowered PEAD from 60 to
// 40 and edited the first two. The third kept demanding `pead === 60`, and a
// state nobody could ever produce reads as "not active" forever.
//
// The visible symptom is worse than a wrong label. Auto-apply DID set pead 40
// on mount, so the screen was running with the preset on while the chip said
// "OFF — click to enable". Clicking it took the `else` branch and applied the
// very same values, so nothing changed on screen and the chip stayed OFF. The
// button looked dead because it was writing a state its own test rejected.
//
// So the gate is written once. `indiaPresetFilters()` applies it, and
// `isIndiaPresetActive()` recognises it, off the same constant — the next
// threshold change is one edit, and the applier and the detector cannot
// disagree about what the preset IS.
// ═══════════════════════════════════════════════════════════════════════════
// zzz675 — INDIA_PRESET now lives in lib/quality-preset so the alert path
// (which runs with no browser) tests rows against the SAME numbers this chip
// applies. Imported at the top of this file.

// ── zzz879 — THE PRESET'S SIZE FLOOR IS A CHOICE ────────────────────────────
// ₹3,000 Cr hid about 105 of the 195 bench names — HIIL (≈₹1,140 Cr) among
// them — while the owner's universe is small caps. The preset now offers three
// floors: ₹3k Cr (his saved setting, the default), ₹500 Cr, or any size. The
// choice is remembered in this browser and Portfolio Catalysts reads the same
// key through indiaPresetFilters(), so both apply the same floor.
export const CB_PRESET_CAP_KEY = 'mc:cb:preset-cap:v1';
/** zzz883 — small & mid only: India large cap from ₹30,000 Cr (same line as the guidance focus list). */
export const CB_SMALL_MID_MAX_CR = 30_000;
export type CbCapFloor = 3000 | 500 | null;
export const CB_CAP_FLOORS: ReadonlyArray<{ v: CbCapFloor; label: string }> = [
  { v: 3000, label: '≥₹3k Cr' }, { v: 500, label: '≥₹500 Cr' }, { v: null, label: 'Any size' },
];
export function parseCbCapFloor(raw: string | null | undefined): CbCapFloor {
  return raw === '500' ? 500 : raw === 'none' ? null : 3000;
}
export function cbCapFloorRaw(v: CbCapFloor): string { return v == null ? 'none' : String(v); }
/** The saved floor in this browser; ₹3k Cr on the server or when nothing is saved. */
export function readCbPresetCapFloor(): CbCapFloor {
  if (typeof window === 'undefined') return INDIA_PRESET.mktCapMin as CbCapFloor;
  try { return parseCbCapFloor(window.localStorage.getItem(CB_PRESET_CAP_KEY)); } catch { return 3000; }
}
const isCapFloor = (v: unknown): boolean => v == null || v === 3000 || v === 500;

/** The preset as a filter patch. Spread over FILTER_DEFAULT (or prev). */
export const indiaPresetFilters = (floor: CbCapFloor = readCbPresetCapFloor()) => ({
  sales: INDIA_PRESET.sales,
  eps: INDIA_PRESET.eps,
  pead: INDIA_PRESET.pead,
  opmDelta: INDIA_PRESET.opmDelta,
  opmMin: INDIA_PRESET.opmMin,   // zzz893
  cfoPatMin: INDIA_PRESET.cfoPatMin,
  mktCapMin: floor,
  mktCapMax: CB_SMALL_MID_MAX_CR,
  pledgedMax: INDIA_PRESET.pledgedMax,
  verdicts: [...INDIA_PRESET.verdicts],
});

export const VERDICTS_SORTED = JSON.stringify([...INDIA_PRESET.verdicts].sort());

/** True when the live filters ARE the preset — what lights the chip. */
export function isIndiaPresetActive(f: ConvFilters): boolean {
  return f.sales === INDIA_PRESET.sales
    && f.eps === INDIA_PRESET.eps
    && f.pead === INDIA_PRESET.pead
    && f.opmDelta === INDIA_PRESET.opmDelta
    && f.opmMin === INDIA_PRESET.opmMin   // zzz893
    && f.cfoPatMin === INDIA_PRESET.cfoPatMin
    && isCapFloor(f.mktCapMin)   // zzz879 — any of the three size floors
    && f.pledgedMax === INDIA_PRESET.pledgedMax
    && f.driftBucket == null
    && JSON.stringify((f.verdicts || []).map((v) => normalizeVerdictKey(v) || String(v)).sort()) === VERDICTS_SORTED;
}

// zzz543 — SINGLE source of truth for "days since filing". The NEW·Nd filter and
// the "·Nd" freshness badge MUST use the exact same formula, or a name can badge
// "31d" yet still pass a "30d" filter (which is exactly the bug Rishi hit). We
// anchor to the NSE/BSE trading-day start (09:30 IST) and round — the same way the
// badge has always displayed it — so what you SEE (·Nd) is what gets filtered.
// Returns null when there is no parseable filing_date.
export function filingAgeDays(fd?: string | null): number | null {
  if (!fd) return null;
  const s = String(fd).slice(0, 10);
  const ms = Date.parse(s + 'T09:30:00+05:30');
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 86400000));
}

// zzz544 — ADAPTIVE "NEW" window. Rishi wants a 10-day recency lens, but Indian
// Q1 results season ends ~mid-Aug, so for weeks at a time NOTHING files inside
// 10 days and a hard 10d filter would render BLANK (his complaint: "even 30d not
// working"). So: target 10d; if 10d is empty (off-season), widen to the SMALLEST
// step that captures the freshest cohort, and flag it so the chip can say so.
// Never blank, never mislabeled. Recomputed each render from the live bench.
export let __NEW_WIN: { days: number; widened: boolean; count: number; base: number } = { days: 10, widened: false, count: 0, base: 10 };
export function computeNewWindow(list: ReadonlyArray<{ filing_date?: string | null }>): typeof __NEW_WIN {
  const BASE = 10;
  const STEPS = [10, 14, 21, 30, 45, 60, 90];
  const ages: number[] = [];
  for (const e of list) { const a = filingAgeDays(e && e.filing_date); if (a !== null && a >= 0) ages.push(a); }
  const countLE = (w: number) => ages.reduce((n, a) => (a <= w ? n + 1 : n), 0);
  const base = countLE(BASE);
  if (base > 0) return { days: BASE, widened: false, count: base, base };
  for (const w of STEPS) { const c = countLE(w); if (c > 0) return { days: w, widened: w > BASE, count: c, base: 0 }; }
  return { days: BASE, widened: false, count: 0, base: 0 };
}

// PATCH 1022 — shared market-cap range matcher (value in ₹ Cr). Buckets mirror
// the enrich-route thresholds. Null market cap never matches a specific range.
export function convCapInRange(cr: number | null | undefined, f: ConvFilters['cap']): boolean {
  if (f === 'all') return true;
  if (cr == null || !Number.isFinite(cr)) return false;
  switch (f) {
    // PATCH 1024 — user multibagger sweet-spot band ₹5k–50k Cr.
    case 'sweet': return cr >= 5_000 && cr <= 50_000;
    case 'mega': return cr >= 200_000;
    case 'large': return cr >= 20_000 && cr < 200_000;
    case 'mid': return cr >= 5_000 && cr < 20_000;
    case 'small': return cr >= 500 && cr < 5_000;
    case 'micro': return cr < 500;
    default: return true;
  }
}

// PATCH 0911 — Robust derivation of Indian-FY quarter + fiscal year.
//
// Lookup order:
//   1. Use the entry's explicit `quarter` + `fiscal_year` fields (set by
//      Patch 0911 sync from EO graded payload — authoritative; doesn't
//      mis-classify late filings or amendments).
//   2. Fall back to heuristic from filing_date (for legacy bench entries
//      that pre-date Patch 0911). Multiple date formats accepted:
//        - "YYYY-MM-DD" (canonical)
//        - "YYYY-MM-DDT..." (ISO with time)
//        - "DD/MM/YYYY" or "DD-MM-YYYY" (Indian dd/mm/yyyy)
//        - "Mon DD, YYYY" or "DD Mon YYYY" (human)
//
// Indian FY convention (long-term — works through year 2099):
//   FY26 = Apr 2025 → Mar 2026. The reported QUARTER differs from the
//   FILING month — filings happen 1-3 months after quarter end.
//   Filing Apr-Jun YYYY → reports Q4 FY{YYYY}
//   Filing Jul-Sep YYYY → reports Q1 FY{YYYY+1}
//   Filing Oct-Dec YYYY → reports Q2 FY{YYYY+1}
//   Filing Jan-Mar YYYY → reports Q3 FY{YYYY}
//
// FY display: we return the LAST 2 digits (FY26, FY27 …). The 2-digit
// label is unambiguous through FY99; for completeness deriveQuarterFY
// also returns the full 4-digit calendar year of FY end so chip tooltips
// can show "FY26 = Apr 2025 → Mar 2026".
export function parseDateLoose(s: string): { y: number; m: number; d: number } | null {
  if (!s || typeof s !== 'string') return null;
  // Canonical ISO
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  // dd/mm/yyyy or dd-mm-yyyy (Indian convention)
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };
  // "Mon DD, YYYY" or "DD Mon YYYY"
  const months: Record<string, number> = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
  m = s.match(/(?:([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4}))|(?:(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4}))/);
  if (m) {
    if (m[1]) {
      const mm = months[m[1].slice(0, 3).toUpperCase()];
      if (mm) return { y: +m[3], m: mm, d: +m[2] };
    } else if (m[5]) {
      const mm = months[m[5].slice(0, 3).toUpperCase()];
      if (mm) return { y: +m[6], m: mm, d: +m[4] };
    }
  }
  // Last resort — let Date parse it
  const d = new Date(s);
  if (!isNaN(d.getTime())) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  return null;
}
export function deriveQuarterFY(e: ConvictionEntry | string): { q: 'Q1' | 'Q2' | 'Q3' | 'Q4'; fy: number; fyFull: number } | null {
  // PATCH 0915 — Bug fix: bench entries can have a `quarter` field stored
  // as the full graded-route string "Q4 FY26" (not just "Q4"). Previously
  // the tier-1 path cast the raw value to 'Q1'-'Q4' without validation, so
  // countQ('Q4') compared against runtime "Q4 FY26" and returned 0 for
  // every entry. User report: "FILTERS · 0 of 359" with all Q chips (0)
  // but FY26 chip (358). Now we regex-extract the clean Q before trusting.
  //
  // Tier 1 — explicit fields. Extract clean Q1-Q4 from whatever shape.
  if (typeof e === 'object' && e && e.fiscal_year) {
    let validQ: 'Q1' | 'Q2' | 'Q3' | 'Q4' | null = null;
    if (typeof e.quarter === 'string') {
      const qm = e.quarter.match(/Q([1-4])/i);
      if (qm) validQ = ('Q' + qm[1]) as 'Q1' | 'Q2' | 'Q3' | 'Q4';
    }
    if (validQ) {
      return {
        q: validQ,
        fy: e.fiscal_year % 100,
        fyFull: e.fiscal_year,
      };
    }
    // Explicit fiscal_year is set but quarter is missing/dirty —
    // fall through to heuristic so we still derive a Q from filing_date.
  }
  // Tier 2 — heuristic from filing_date
  const fdate = typeof e === 'string' ? e : e?.filing_date;
  const parsed = parseDateLoose(fdate);
  if (!parsed) return null;
  const { y, m } = parsed;
  if (m >= 4 && m <= 6)  return { q: 'Q4', fy: y % 100, fyFull: y };
  if (m >= 7 && m <= 9)  return { q: 'Q1', fy: (y + 1) % 100, fyFull: y + 1 };
  if (m >= 10 && m <= 12) return { q: 'Q2', fy: (y + 1) % 100, fyFull: y + 1 };
  if (m >= 1 && m <= 3)  return { q: 'Q3', fy: y % 100, fyFull: y };
  return null;
}

// PATCH 0546 / 0547 — Derive guidance from YoY metrics when the entry
// doesn't have an explicit guidance field. Tightened thresholds so the
// distribution is MEANINGFUL within the bench (Patch 0546 v1 marked all
// 70 BLOCKBUSTER+STRONG entries Positive because every one of them had
// PAT ≥20 / Sales ≥0 / EPS ≥10 trivially).
//
// Discriminating heuristic — separates margin-expanding compounders from
// margin-compressing or earnings-quality risks:
//   POSITIVE : op-leverage AND quality
//              PAT ≥ 40 AND PAT > Sales × 1.2 AND EPS ≥ 25 (PAT outpacing
//              sales = margin expansion; EPS keeping up = no dilution)
//   NEGATIVE : margin compression OR earnings quality concern
//              PAT < 0  OR  (sales > 30 AND pat < sales × 0.6)  OR
//              (pat > 0 AND eps < pat × 0.4)  (heavy dilution)
//   NEUTRAL  : everything else (clean growth without standout margin signal)
export function deriveGuidanceLabel(e: ConvictionEntry): 'Positive' | 'Negative' | 'Neutral' {
  // PATCH 0925 — Only trust EXPLICIT Positive/Negative from the stored
  // entry. Stored "Neutral" gets re-derived from YoY metrics — bench
  // entries written before Patch 0925 were ALL written as Neutral because
  // their narrative_text was empty, but their metrics (Sales+300% etc)
  // clearly warranted Positive. Re-derive to fix retroactively.
  if (e.guidance === 'Positive' || e.guidance === 'Negative') return e.guidance;
  const sales = e.sales_yoy_pct ?? 0;
  const pat = e.net_profit_yoy_pct ?? 0;
  const eps = e.eps_yoy_pct ?? 0;
  // Negative gates
  if (pat < 0) return 'Negative';
  if (sales > 30 && pat < sales * 0.6) return 'Negative';   // margin compression
  // PATCH 0925 — dilution gate only when EPS is genuinely weak (< 50%).
  // Otherwise the ratio test mis-classifies hyper-growth (Sales+224, PAT
  // +1404, EPS +398 → EPS<PAT*0.4 but EPS is still strong absolute).
  if (pat > 0 && eps < pat * 0.4 && eps < 50) return 'Negative';
  // Positive gates — op-leverage + quality
  if (pat >= 40 && pat > sales * 1.2 && eps >= 25) return 'Positive';
  // PATCH 0925 — Secondary Positive: strong growth across all 3 metrics
  // (Sales ≥ 20, PAT ≥ 30, EPS ≥ 20) without sharp op-leverage. This
  // catches solid Compounders that the strict op-leverage gate misses.
  if (pat >= 30 && sales >= 20 && eps >= 20) return 'Positive';
  return 'Neutral';
}

// zzz229 — Trading-day helper. Given an ISO date string, return the date N
// trading days earlier. Assumes Mon-Fri only (skips Sat+Sun; NSE holidays not
// modelled here — good enough for chip labels).
export function tradingDaysBefore(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();   // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

// Self-test — runs once on module load. Verifies trading-day math.
// User's example: if today = Monday, 2 trading days = Fri + Mon; 1 trading day = Fri.
if (typeof window !== 'undefined' && !(window as any).__mc_d2_test_done) {
  (window as any).__mc_d2_test_done = true;
  const t = (iso: string, n: number, expect: string, label: string) => {
    const got = tradingDaysBefore(iso, n);
    // eslint-disable-next-line no-console
    if (got !== expect) console.warn(`[zzz229 tradingDaysBefore FAIL] ${label} ${iso}-${n} => ${got} expected ${expect}`);
  };
  t('2026-07-20', 1, '2026-07-17', 'Mon 1-back = Fri');
  t('2026-07-20', 2, '2026-07-16', 'Mon 2-back = Thu (skip Sat+Sun)');
  t('2026-07-22', 2, '2026-07-20', 'Wed 2-back = Mon');
  t('2026-07-24', 2, '2026-07-22', 'Fri 2-back = Wed');
  t('2026-07-24', 5, '2026-07-17', 'Fri 5-back = prior Fri');
}

// zzz229 — extract d2_pct. Backend will populate later; frontend gracefully
// handles missing field (predicate returns false to hide unqualified rows).
export function getD2Pct(e: any): number | null {
  // zzz232 — STRICT fallback. Never return bare d1_pct here — that made the
  // 2D chip identical to the 1D chip when backend hadn't shipped real d2_pct.
  // Only return:
  //   1. real d2_pct (server-computed, strict 2-trading-day cumulative)
  //   2. move_pct (cumulative post-filing walk-forward — different from D1
  //      because it spans many days, so counts diverge from 1D naturally)
  // Otherwise return null → chip shows "…" pending state instead of a fake.
  if (typeof e?.d2_pct === 'number' && Number.isFinite(e.d2_pct)) return e.d2_pct;
  if (typeof e?.move_pct === 'number' && Number.isFinite(e.move_pct)) return e.move_pct;
  return null;
}

// zzz362 — financials: CFO/PAT is meaningless for banks/NBFCs/lenders (their
// "cash from operations" mixes financing flows), so we exempt them from the
// CFO-based quality component / red flag / chips. Conservative detection:
// sector keyword OR company-name token match. Covers BF Investment,
// Cholamandalam Financial Holdings, Muthoot Microfin, Sundaram Finance,
// Paisalo Digital, Summit Securities, Vardhman Holdings, Dhunseri Investments,
// U.Y. Fincorp, etc.
export function cbIsFinancial(e: any): boolean {
  // zzz364 (BUG 1) — base the sector test on resolveSector(e) (fallback to raw
  // e.sector) AND lower-case it, and broaden the keyword set so lenders whose
  // sector only resolves via NSE_SECTOR_MAP are caught (PAISALO etc). Company-
  // name regex now carries the `i` flag so lower-case variants match too.
  const sec = String(resolveSector(e) || e?.sector || '').toLowerCase();
  // zzz371 (audit) — the old bare `capital|housing|holding|amc` tokens exempted
  // "Capital Goods" industrials, Ashiana Housing, R-AMC-o Cements, and any
  // "Holdings" from every CFO/OPM signal (their trends went blank). Only treat
  // as financial when the token is a genuine financial phrase / word-anchored.
  if (/nbfc|bank|financ|finance|insurance|capital\s*market|housing\s*fin|holding\s*co|\bamc\b|asset\s*manag|securit|microfin|invit|reit|broking|mutual\s*fund|fincorp|investment\s*(co|trust|manag)/.test(sec)) return true;
  if (/^(capital goods|capital equipment|capital markets?\s*infra)/.test(sec)) return false; // explicit industrial carve-out
  const co = String(e?.company || '');
  if (/\b(Finance|Financial|Fincorp|Microfin|Housing Finance|Bank|Capital(?!\s*Goods)|Investments?\b|Holdings?\s*Ltd|Securities|AMC|Insurance|NBFC)\b/i.test(co)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz827 — ONE CASH FIGURE, THE SAME YEAR.
//
// The card used to show `cfo_to_pat_ratio` as stored. On a row graded before
// the same-year fix (zzz821) that figure was last fiscal year's operating
// cash flow divided by ONE QUARTER's profit ("2.66x"), and the preset's
// CFO/PAT ≥ 0.5 gate and the quality verdict both read it. Now the tab, the
// preset and the verdict read only the same-fiscal-year pair the EO engine
// builds (lib/india-cash): a ratio with its year label (`cash_fy`) and its two
// figures (`ocf_annual_cr`, `pat_annual_cr`) that agree with it. Anything else
// is UNKNOWN — "not checked", never a fail. A lender's cash flow is loan
// growth, so for banks / NBFCs / insurers the test is skipped.
// ═══════════════════════════════════════════════════════════════════════════
export interface CbCashView {
  /** Same-year CFO ÷ PAT, or null. */
  ratio: number | null;
  /** 'ok' = a same-year ratio; 'unknown' = not checked; 'na' = not meaningful (lender). */
  state: 'ok' | 'unknown' | 'na';
  /** "FY26 full year" — the year the ratio is for. */
  basis: string | null;
  /** Plain words for the card / a tooltip. */
  text: string;
}

const finN = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function cbCashView(e: any): CbCashView {
  if (cbIsFinancial(e) || financialKindOfRow(e) || e?.cash_note === 'not meaningful for lenders') {
    return { ratio: null, state: 'na', basis: null, text: 'cash conversion not meaningful for lenders (skipped)' };
  }
  const fy = typeof e?.cash_fy === 'string' && e.cash_fy.trim() ? e.cash_fy.trim() : null;
  const basis = typeof e?.cash_basis === 'string' && e.cash_basis.trim() ? e.cash_basis.trim()
    : fy ? (/^mar\s/i.test(fy) ? `FY${fy.slice(-2)} full year` : `year to ${fy}`) : null;
  const unknown = (why: string): CbCashView => ({ ratio: null, state: 'unknown', basis, text: `cash conversion not checked — ${why}` });
  if (!fy) return unknown('the same-year cash figure has not been fetched yet');
  const ocf = finN(e?.ocf_annual_cr) && e.ocf_annual_cr !== 0 ? e.ocf_annual_cr : null;
  const pat = finN(e?.pat_annual_cr) && e.pat_annual_cr !== 0 ? e.pat_annual_cr : null;
  const r0 = [e?.ocf_to_pat_ratio, e?.cfo_to_pat_ratio].find((v) => finN(v) && v !== 0) as number | undefined;
  if (ocf == null || pat == null || r0 == null) return unknown(`no ${basis || fy} cash figure in the source`);
  // The stored ratio must be the ratio of its own two figures (an older
  // inflated ratio left on the row next to newer figures is not used).
  if (pat > 0 && Math.abs(r0 - ocf / pat) > Math.max(0.05, Math.abs(ocf / pat) * 0.05)) return unknown('the stored ratio does not match its own figures');
  if (Math.abs(r0) > CASH_RATIO_MAX) return unknown('ratio outside the meaningful range');
  return { ratio: r0, state: 'ok', basis, text: `cash from operations ${r0.toFixed(2)}x profit (${basis})` };
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz827 — VERDICT KEYS vs LABELS.
//
// The stored preset and the filter keep the original keys (STRONG BUY / BUY /
// WATCH / AVOID / HIGH RISK) so every saved preset keeps working. The screen,
// exports and copies show neutral labels only. A label or a differently-cased
// key that reaches the filter is mapped back to its key — a renamed label can
// never silently drop names from the verdict gate.
// ═══════════════════════════════════════════════════════════════════════════
export const CB_VERDICT_KEYS = ['STRONG BUY', 'BUY', 'WATCH', 'AVOID', 'HIGH RISK'] as const;
export const CB_VERDICT_LABEL: Record<string, string> = {
  'STRONG BUY': 'Top setup', 'BUY': 'Good setup', 'WATCH': 'Watch', 'AVOID': 'Weak setup', 'HIGH RISK': 'High risk',
};
/** A key or a label (any case) → the stored key; unknown text → null. */
export function normalizeVerdictKey(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(/^[^A-Za-z]+/, '').replace(/\s+/g, ' ');
  if (!s) return null;
  const up = s.toUpperCase();
  if ((CB_VERDICT_KEYS as readonly string[]).includes(up)) return up;
  for (const [k, lbl] of Object.entries(CB_VERDICT_LABEL)) if (lbl.toUpperCase() === up) return k;
  return null;
}
/** The neutral label for a key ('STRONG BUY' → 'Top setup'). */
export function cbVerdictLabel(key: unknown): string {
  const k = normalizeVerdictKey(key);
  return k ? CB_VERDICT_LABEL[k] : String(key ?? '');
}

// zzz362 — extracted module-level pure earnings-quality helper. Behavior-
// preserving move of the zzz355 SCORES IIFE (incl. zzz357 ROCE weight +
// ROCE/ROE cap-at-55 + zzz357 absolute-P/E isOvervalued). Reused by the
// SCORES render AND the verdict filter gate below so the filter matches the
// rendered pill exactly. The only new behaviour vs the old inline code is the
// zzz362 financials exemption on the CFO/PAT component + CFO<0.5 red flag.
export function cbComputeQuality(e: any): {
  qScore: number; qCol: string; bits: string[]; rf: number;
  verdictLabel: string; verdictIcon: string; verdictColor: string; verdictTip: string;
  isOvervalued: boolean; triLabel: string | null; triCol: string;
} {
  // zzz827 — the same-year cash ratio only (cbCashView); unknown = no input.
  const cfo = cbCashView(e).ratio;
  const opm = e.opm_pct, opmP = e.opm_prev_pct;
  const sales = e.sales_yoy_pct, pat = e.net_profit_yoy_pct, eps = e.eps_yoy_pct;
  const pe = e.pe;
  const drift = e.move_pct;
  const fin = cbIsFinancial(e); // zzz362 — financials: CFO/PAT not meaningful
  let q = 0; const bits: string[] = [];
  if (typeof cfo === 'number' && !fin) { // zzz362 — financials: CFO/PAT not meaningful
    if (cfo >= 1) { q += 30; bits.push('CFO/PAT ' + cfo.toFixed(2) + '→30'); }
    else if (cfo >= 0.8) { q += 25; bits.push('CFO/PAT ' + cfo.toFixed(2) + '→25'); }
    else if (cfo >= 0.5) { q += 15; bits.push('CFO/PAT ' + cfo.toFixed(2) + '→15'); }
    else bits.push('CFO/PAT ' + cfo.toFixed(2) + '→0');
  }
  if (typeof opm === 'number' && typeof opmP === 'number' && !fin) { // zzz364 (BUG 2a) — financials: OPM-Δ not meaningful for lenders
    const d = opm - opmP;
    if (d > 3) { q += 25; bits.push('OPM Δ +' + d.toFixed(1) + '→25'); }
    else if (d > 1) { q += 20; bits.push('OPM Δ +' + d.toFixed(1) + '→20'); }
    else if (d >= 0) { q += 10; bits.push('OPM Δ +' + d.toFixed(1) + '→10'); }
    else bits.push('OPM Δ ' + d.toFixed(1) + '→0');
  }
  if (typeof sales === 'number' && typeof pat === 'number' && sales > 3) { // zzz364 (BUG 3) — sales<=0 makes PAT/Sales op-leverage absurd; skip it
    const r = pat / sales;
    if (r >= 1 && r <= 2) { q += 20; bits.push('PAT/Sales ' + r.toFixed(1) + '×→20'); }
    else if (r > 2 && r <= 3) { q += 10; bits.push('PAT/Sales ' + r.toFixed(1) + '×→10'); }
    else if (r > 3) bits.push('PAT/Sales ' + r.toFixed(1) + '×→0(windfall)');
    else if (r > 0) { q += 15; bits.push('PAT/Sales ' + r.toFixed(1) + '×→15'); }
  }
  if (typeof eps === 'number' && typeof pat === 'number' && Math.abs(pat) > 5) {
    const gap = Math.abs(eps - pat);
    if (gap <= 10) { q += 15; bits.push('EPS-PAT gap ' + gap.toFixed(0) + '→15'); }
    else if (gap <= 30) { q += 8; bits.push('EPS-PAT gap ' + gap.toFixed(0) + '→8'); }
    else bits.push('EPS-PAT gap ' + gap.toFixed(0) + '→0');
  }
  if (typeof pe === 'number' && pe > 0 && typeof eps === 'number' && eps > 0) {
    const peg = pe / eps;
    if (peg < 1) { q += 10; bits.push('PEG ' + peg.toFixed(2) + '→10'); }
    else if (peg < 2) { q += 5; bits.push('PEG ' + peg.toFixed(2) + '→5'); }
  }
  // zzz357 — ROCE weight (0-20). Capital efficiency is the single best quality proxy.
  const roceQ = e.roce, roeQ = e.roe;
  if (typeof roceQ === 'number' && Number.isFinite(roceQ)) {
    if (roceQ >= 25) { q += 20; bits.push('ROCE ' + roceQ.toFixed(0) + '%→20'); }
    else if (roceQ >= 20) { q += 15; bits.push('ROCE ' + roceQ.toFixed(0) + '%→15'); }
    else if (roceQ >= 15) { q += 10; bits.push('ROCE ' + roceQ.toFixed(0) + '%→10'); }
    else { bits.push('ROCE ' + roceQ.toFixed(0) + '%→0'); }
  }
  let qScore = Math.min(100, Math.round(q));
  // zzz357 — weak capital efficiency caps quality at 55 regardless of accrual metrics.
  // Fixes BHAGCHEM (ROCE 4.5%) still showing QUALITY 75 off a strong CFO/OPM print.
  if ((typeof roceQ === 'number' && Number.isFinite(roceQ) && roceQ < 15)
      || (typeof roeQ === 'number' && Number.isFinite(roeQ) && roeQ < 10)) {
    qScore = Math.min(qScore, 55);
    bits.push('ROCE/ROE cap→55');
  }
  const qCol = qScore >= 75 ? '#22C55E' : qScore >= 60 ? '#84CC16' : qScore >= 40 ? '#F59E0B' : '#EF4444';

  // Growth triangulation - is growth coherent across the three metrics?
  let triLabel: string | null = null; let triCol = '';
  if (typeof sales === 'number' && typeof pat === 'number' && typeof eps === 'number'
      && sales > 10 && pat > 0 && eps > 0) {
    const salesOK = sales >= 15;
    const patStrong = pat >= sales;
    const epsCoherent = Math.abs(eps - pat) <= 25;
    if (salesOK && patStrong && epsCoherent) { triLabel = 'GROWTH TRIPLE ✓'; triCol = '#22C55E'; }
    else if (patStrong && !salesOK) { triLabel = 'MARGIN-LED'; triCol = '#F59E0B'; }
    else if (salesOK && !patStrong) { triLabel = 'VOLUME-ONLY'; triCol = '#F59E0B'; }
  }

  // zzz366 — "cash-confirmed": CFO/PAT >= 1.5 means the period's cash generation
  // EXCEEDS reported profit by 50%+, so a headline PAT spike is validated by real
  // cash, not an accrual mirage. The MARGIN-SPIKE red flag exists to catch profit
  // that ISN'T real; when cash confirms it, the flag is a false positive. Aegis
  // Logistics (CFO/PAT 3.72, OPM +16pp, ROE 16%, undervalued) was hitting exactly
  // 3 red flags — MARGIN-SPIKE + EPS≠PAT + MKT-DOUBT — and getting AVOID purely on
  // that count, despite the beat being fully cash-backed. Suppressing MARGIN-SPIKE
  // when cash-confirmed drops it to 2 flags → WATCH (fair: real but low-base).
  const cashConfirmed = typeof cfo === 'number' && cfo >= 1.5 && cfo <= 5 && !fin; // zzz371 — |ratio|>5 is an artifact band, not confirmation
  // Count red flags (mirrors the RED FLAGS render block)
  let rf = 0;
  if (typeof cfo === 'number' && cfo > 0 && cfo < 0.5 && !fin) rf++; // zzz362/zzz364 (BUG 6) — CASH-CONV only for genuine weak-but-positive; financials exempt
  if (typeof sales === 'number' && typeof pat === 'number' && sales > 5 && pat > 5 * sales && !cashConfirmed) rf++; // zzz366 — cash-confirmed beats don't count MARGIN-SPIKE
  if (typeof eps === 'number' && typeof pat === 'number' && Math.abs(pat) > 10 && Math.abs(eps - pat) > 30) rf++;
  if (typeof opm === 'number' && typeof opmP === 'number' && !fin && (opm - opmP) < -3) rf++; // zzz364 (BUG 2a) — financials: OPM-based signal not meaningful
  if (typeof drift === 'number' && drift < -5 && ['BLOCKBUSTER','ELITE','STRONG'].includes(String(e.tier || '').toUpperCase())) rf++;

  // zzz364 (BUG 7) — GROWTH TRIPLE ✓ must not be decoupled from cash. When the
  // print is non-financial AND cash conversion is soft (CFO/PAT < 0.8) or any
  // red flag is present, downgrade the green triple to an amber "cash?" caveat.
  if (triLabel === 'GROWTH TRIPLE ✓' && !fin && ((typeof cfo === 'number' && cfo < 0.8) || rf >= 1)) {
    triLabel = 'GROWTH TRIPLE (cash?)'; triCol = '#F59E0B';
  }

  // Overall verdict — combines Quality + valuation + risk
  const valPE = typeof pe === 'number' && pe > 0 ? pe : null;
  const valGrowth = typeof eps === 'number' ? eps : null;
  // zzz364 (BUG 4) — cap the growth denominator used for VALUATION at 100 so a
  // triple-digit base-effect EPS growth can't manufacture UNDERVALUED / cheap.
  const valGrowthCap = valGrowth != null ? Math.min(valGrowth, 100) : null;
  // zzz364 (BUG 5) — a business with negative ROCE destroys capital; never cheap.
  const roceVal = e.roce;
  const roceNeg = typeof roceVal === 'number' && roceVal < 0;
  const isOvervalued = (valPE != null && valPE > 100) /* zzz357 absolute ceiling */
    || (valPE != null && valGrowthCap != null && valGrowthCap > 0 && valPE > 2 * valGrowthCap);
  const isCheap = valPE != null && valGrowthCap != null && valGrowthCap > 0 && valPE < 0.5 * valGrowthCap && !roceNeg;
  const driftBad = typeof drift === 'number' && drift < -8;
  let verdict: {label: string; icon: string; color: string; tip: string};
  // zzz827 — tips in words: no 0–100 number, no buy / sell wording.
  const qw = qScore >= 70 ? 'high' : qScore >= 45 ? 'fair' : 'low';
  if (rf >= 3 || (typeof drift === 'number' && drift < -12) || (valGrowth != null && valGrowth <= 0)) {
    verdict = { label: 'AVOID', icon: '', color: '#EF4444', tip: 'Weak setup: several quality warnings, a sharp fall since results, or EPS not growing.' };
  } else if (qScore >= 80 && !isOvervalued && rf <= 1 && !driftBad) {
    verdict = { label: 'STRONG BUY', icon: '', color: '#22C55E', tip: 'Top setup: high earnings quality, valuation not stretched, no serious warning, and the market has not faded the result.' };
  } else if (qScore >= 65 && rf <= 2 && !driftBad && !isOvervalued) { // zzz371 — the valuation gate applies here too
    verdict = { label: 'BUY', icon: '', color: '#84CC16', tip: 'Good setup: solid earnings quality and manageable warnings.' };
  } else if (qScore >= 45 && rf <= 3) {
    verdict = { label: 'WATCH', icon: '', color: '#F59E0B', tip: `Watch: mixed signals — quality ${qw}, ${rf} warning${rf === 1 ? '' : 's'}. Check what management says next.` };
  } else {
    verdict = { label: 'HIGH RISK', icon: '', color: '#EF4444', tip: `High risk: quality ${qw}, ${rf} warning${rf === 1 ? '' : 's'}.` };
  }
  void isCheap; // zzz362 — preserved from original inline (computed, not used in the chain)

  return {
    qScore, qCol, bits, rf,
    verdictLabel: verdict.label, verdictIcon: verdict.icon, verdictColor: verdict.color, verdictTip: verdict.tip,
    isOvervalued, triLabel, triCol,
  };
}

/** zzz827 — year-ago vs now for a profit / EPS figure:
 *  'turned' = a loss (or zero) a year ago, a profit now;
 *  'stillLoss' = a loss a year ago and still a loss (at most narrowed);
 *  null = no such case, or a figure is missing. */
export function cbTurn(curr: unknown, prev: unknown): 'turned' | 'stillLoss' | null {
  if (!finN(curr) || !finN(prev)) return null;
  if (prev <= 0 && curr > 0) return 'turned';
  if (prev < 0 && curr <= 0) return 'stillLoss';
  return null;
}

export function passesConvictionFilter(e: ConvictionEntry, f: ConvFilters): boolean {
  // zzz541 — NEW·10d is a RECENCY lens, not a quality screen: show every name added
  // to the bench in the last 10 days and BYPASS the strict quality preset (Sales/EPS/
  // PEAD/CFO-PAT/etc.), so it isn't crushed to a handful. Copy → TradingView then
  // exports exactly these, grouped by tier (###ELITE/###BLOCKBUSTER/###STRONG).
  if (f.newOnly) {
    // by RESULT (filing) date, not added_at — added_at is polluted by bulk bench
    // re-syncs, which made weeks-old results look "new". 30d = the current
    // results cohort (off-season this can legitimately be small/empty).
    // zzz543/zzz544 — shared badge formula + ADAPTIVE window (see computeNewWindow).
    // Target 10d; auto-widen to the freshest cohort only when 10d is empty.
    const d = filingAgeDays((e as any).filing_date);
    return d !== null && d >= 0 && d <= __NEW_WIN.days;
  }
  const sales = e.sales_yoy_pct ?? 0;
  const pat = e.net_profit_yoy_pct ?? 0;
  const eps = e.eps_yoy_pct ?? 0;
  const x0: any = e;
  // zzz340 FRESH-3D as POSITIVE filter (not bypass). When chip is ON, drop any entry NOT filed within last ~3 biz days (5 calendar days).
  // All other filters including CFO/PAT, PEAD, etc. apply strictly regardless.
  if (f.freshBypass) {
    const __fd = String((e as any).filing_date || '');
    if (!__fd) return false;
    const __ts = new Date(__fd + 'T00:00:00').getTime();
    const __d = Math.floor((Date.now() - __ts) / 86400000);
    if (__d < 0 || __d > 5) return false;
  }
  if (f.sales != null && sales < f.sales) return false;
  // zzz827 — a turn from loss to profit meets a growth gate (no % exists);
  // a loss that only narrowed never does, whatever % the feed computed.
  if (f.pat != null) { const t = cbTurn(x0.pat_curr_cr, x0.pat_prev_cr); if (t === 'stillLoss' || (t !== 'turned' && pat < f.pat)) return false; }
  if (f.eps != null) { const t = cbTurn(x0.eps_curr, x0.eps_prev); if (t === 'stillLoss' || (t !== 'turned' && eps < f.eps)) return false; }
  if (f.opLev != null && sales > 0) { // zzz364 (BUG 3) — sales<=0 makes the op-leverage ratio absurd; skip the gate for that entry
    const ratio = pat / sales;
    if (!(ratio >= f.opLev)) return false;
  }
  // zzz225 — composite tier score threshold (the card's big number)
  if (f.score != null && (e.composite_score ?? 0) < f.score) return false;
  // zzz226e — absolute OPM level threshold (latest quarter %)
  if (f.opmMin != null) {
    const o = (e as any).opm_pct;
    // zzz893: '≥0%' (positive margin, part of the preset) lets an UNKNOWN margin through — unknown is not a loss;
    // the higher levels still need a number, as before
    if (typeof o !== 'number') { if (f.opmMin > 0) return false; }
    else if (o < f.opmMin) return false;
  }
  // zzz304 — minimum CFO/PAT ratio filter.
  // zzz359 (BUG 4) — NULL-SAFE. Q1 press releases rarely bundle a cash-flow
  // statement, so cfo_to_pat_ratio is legitimately null for ~40% of legit Q1
  // filings (Divgi TorqTransfer case). Treating null as fail silently dropped
  // them. Now only reject entries that HAVE a CFO/PAT number below the floor;
  // null passes through (the WC-STRETCH chip acts as the CFO proxy on the card).
  if (f.cfoPatMin != null) {
    // zzz364 (BUG 2d) — CFO/PAT is not meaningful for lenders/NBFCs, so the
    // cfoPatMin gate must not drop financials on a metric that doesn't apply.
    // zzz827 — the same-year ratio only; unknown and lenders pass (not checked / skipped).
    const cv = cbCashView(e);
    if (cv.state === 'ok' && (cv.ratio as number) < f.cfoPatMin) return false;
  }
  // zzz360 — max promoter-pledge % filter. Null pledged_pct passes (unknown ≠
  // fail — mirrors the zzz359 CFO/PAT null-safe philosophy). 0 = valid/good.
  if (f.pledgedMax != null) {
    const p = (e as any).pledged_pct;
    if (typeof p === 'number' && Number.isFinite(p) && p > f.pledgedMax) return false;
  }
  // zzz348 — minimum market cap filter (Cr)
  if (f.mktCapMin != null) {
    const mc = (e as any).market_cap_cr;
    if (typeof mc !== 'number' || mc < f.mktCapMin) return false;
  }
  // zzz883 — size ceiling (small & mid only). A name whose size is unknown is kept.
  if (f.mktCapMax != null) {
    const mc = (e as any).market_cap_cr;
    if (typeof mc === 'number' && Number.isFinite(mc) && mc > f.mktCapMax) return false;
  }
  // zzz329 — maximum trailing P/E filter (excludes negative-earnings tickers)
  if (f.peMax != null) {
    const p = (e as any).pe;
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > f.peMax) return false;
  }
  // zzz223 — OPM margin delta filter (pp change vs prior year). Positive
  // threshold = expansion ≥ v pp; negative threshold = squeeze ≤ v pp.
  if (f.opmDelta != null) {
    const o = (e as any).opm_pct; const p = (e as any).opm_prev_pct;
    if (typeof o !== 'number' || typeof p !== 'number') return false;
    const d = o - p;
    if (f.opmDelta >= 0 ? d < f.opmDelta : d > f.opmDelta) return false;
  }
  // USER-REQ — PEAD score threshold filter (combinable with all others)
  if (f.pead != null) {
    if (peadScore(e).score < f.pead) return false;
  }
  // PATCH 1018 — ELITE / MULTIBAGGER quality filters
  if (f.elite && !(e as any).is_elite) return false;
  if (f.multibagger && !(e as any).multibagger_setup) return false;
  // PATCH 1022 — market-cap range filter
  if (f.cap && f.cap !== 'all' && !convCapInRange((e as any).market_cap_cr, f.cap)) return false;
  // PATCH 0546 — fall back to derived guidance from YoY metrics for legacy
  // entries; explicit guidance field always wins when present.
  if (f.guidance != null) {
    if (deriveGuidanceLabel(e) !== f.guidance) return false;
  }
  // PATCH 0909 — Quarter + FY filter (Indian fiscal year, derived from filing_date)
  if (f.quarter != null || f.fy != null) {
    const qfy = deriveQuarterFY(e);
    if (!qfy) return false;
    if (f.quarter != null && qfy.q !== f.quarter) return false;
    if (f.fy != null && qfy.fy !== f.fy) return false;
  }
  // PATCH 0918 + 0919 — Free-form date range filter (composes AND with
  // Q + FY). Strict validation: if EITHER bound is non-empty but malformed
  // (e.g. partial browser input "2025" or "29"), we silently ignore that
  // bound rather than treating it as a real filter — otherwise string
  // comparison filters out every entry and the user sees a confusing
  // "0 of 360" with no visible chip active. (Reported bug Patch 0919.)
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const fromOk = !!f.fromDate && DATE_RE.test(f.fromDate);
  const toOk   = !!f.toDate   && DATE_RE.test(f.toDate);
  if (fromOk || toOk) {
    const fdate = (e.filing_date || '').slice(0, 10);
    // If we can't parse the entry's filing_date, DON'T eliminate it on
    // date-range alone — let other filters decide. Only enforce when the
    // entry has a clean filing date to compare against. This prevents
    // bench entries with explicit quarter/fy but malformed filing_date
    // from getting wiped by a single bad input.
    if (DATE_RE.test(fdate)) {
      if (fromOk && fdate < (f.fromDate as string)) return false;
      if (toOk   && fdate > (f.toDate as string))   return false;
    }
  }
  // PATCH 0945 — D1 close bucket filter. Composes AND with all the above.
  // Positive threshold = require d1 >= N. Negative = require d1 <= N.
  if (f.d1Bucket != null && Number.isFinite(f.d1Bucket)) {
    const d1 = (e as any).d1_pct;
    if (typeof d1 !== 'number' || !Number.isFinite(d1)) return false;
    if (f.d1Bucket >= 0) {
      if (d1 < f.d1Bucket) return false;
    } else {
      if (d1 > f.d1Bucket) return false;
    }
  }
  // zzz229 — 2D CLOSE filter. Mirrors D1 semantics (positive = ≥ threshold,
  // negative = ≤ threshold). Uses d2_pct = cumulative % over 2 trading days.
  if (f.d2Bucket != null && Number.isFinite(f.d2Bucket)) {
    const d2 = getD2Pct(e);
    if (d2 == null) return false;
    if (f.d2Bucket >= 0) {
      if (d2 < f.d2Bucket) return false;
    } else {
      if (d2 > f.d2Bucket) return false;
    }
  }
  // zzz245 — DRIFT filter. Uses move_pct = cumulative % from filing anchor
  // to most recent close. Same positive/negative threshold convention as D1/D2.
  if (f.driftBucket != null && Number.isFinite(f.driftBucket)) {
    const m = (e as any).move_pct;
    if (typeof m !== 'number' || !Number.isFinite(m)) return false;
    if (f.driftBucket >= 0) {
      if (m < f.driftBucket) return false;
    } else {
      if (m > f.driftBucket) return false;
    }
  }
  // zzz362 — VERDICT filter (multi-select). Reuses cbComputeQuality so the gate
  // matches the rendered SCORES verdict pill exactly. Empty/null = no filter.
  if (f.verdicts && f.verdicts.length > 0) {
    const { verdictLabel } = cbComputeQuality(e);
    // zzz827 — keys and labels (any case) both map to the stored key.
    const want = f.verdicts.map(normalizeVerdictKey).filter(Boolean) as string[];
    if (want.length && !want.includes(verdictLabel)) return false;
  }
  return true;
}

/** zzz544's adaptive NEW window is module state; the page sets it each render. */
export function setNewWindow(w: typeof __NEW_WIN): void { __NEW_WIN = w; }

// ── zzz811 additions ────────────────────────────────────────────────────────

/** The owner's saved choice on the Conviction Beats tab: '1' = preset OFF. */
export const CB_PRESET_OPTOUT_KEY = 'mc:cb:preset:v3:optout';

/**
 * The filters the Conviction Beats tab opens with — exactly its mount logic:
 * the preset auto-ON unless the owner switched it off (then no filter).
 * The tab keeps no other saved filters (chips are per-session).
 */
export function cbFiltersForOwner(optedOut: boolean): ConvFilters {
  return optedOut ? { ...FILTER_DEFAULT } : { ...FILTER_DEFAULT, ...indiaPresetFilters() };
}

/** Read the owner's choice from this browser. Server/SSR: preset on. */
export function readCbPresetOptOut(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(CB_PRESET_OPTOUT_KEY) === '1'; } catch { return false; }
}

/** /api/v1/bench entries → Conviction Beats entries, as the tab maps them (zzz426/427). */
export function serverBenchToCbEntries(ents: unknown): ConvictionEntry[] {
  const arr: any[] = Array.isArray(ents) ? ents : [];
  return arr
    .filter((e: any) => e && e.ticker && (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG'))
    .map((e: any) => {
      let q: any, fy: any;
      if (typeof e.quarter === 'string') {
        const qm = e.quarter.match(/Q([1-4])/i); if (qm) q = 'Q' + qm[1];
        const fm = e.quarter.match(/FY\s?(\d{2})/i); if (fm) { const yy = parseInt(fm[1], 10); fy = yy < 50 ? 2000 + yy : 1900 + yy; }
      }
      return {
        ...(e as any),
        ticker: String(e.ticker).toUpperCase(),
        company: decodeEntities(String(e.company || e.ticker)), // zzz827 — "&amp;" never reaches the tab
        _cb_src: 'server',
        added_at: new Date().toISOString(),
        ...(q ? { quarter: q } : {}), ...(fy ? { fiscal_year: fy } : {}),
      } as ConvictionEntry;
    });
}

/** The tab's list: this browser's entries + the server bench, one per ticker —
 *  newest filing wins, a tie goes to the higher composite. (zzz426)
 *
 *  zzz827 — FIELDS ARE MERGED, NOT ONE ROW PICKED WHOLE. The old merge kept
 *  one entry per ticker. When the server's card won (a newer filing, or the
 *  same filing with a higher composite) every field this browser had filled
 *  in — ROCE, ROE, pledge, the quarterly trend series, the fill-pass markers —
 *  was dropped, so ROCE / ROE read "—" and "Q-TRENDS loading…" never cleared
 *  on those cards; when this browser's copy won, its tier stayed whatever it
 *  was when benched. Now:
 *    • newer filing wins, as before;
 *    • SAME filing: the server row (graded under the current rules) supplies
 *      the grade — tier, growth, margin, cash, composite — and this browser's
 *      row keeps the fields the server does not carry;
 *    • a newer filing keeps only the slow-moving fields (ROCE / ROE / pledge /
 *      trend series) from the older row — never its cash ratio or its grade. */
const CB_SLOW_FIELDS = ['roce', 'roe', 'debtToEquity', 'pledged_pct', 'roic', 'int_coverage', 'sector', 'market_cap_cr',
  'debtor_days', 'inventory_days', 'wc_days', 'quarters_sales', 'quarters_eps', 'quarters_opm',
  'quarters_material_cost_pct', 'quarters_other_income_pct', 'quarters_tax_pct', 'annual_cfo_pat',
  'cb_enrich_v', 'cb_trend_attempts', '_trends_status', 'close_30d'];

function cbMergeTwo(a: any, b: any): any {
  const aDate = String(a?.filing_date || ''), bDate = String(b?.filing_date || '');
  const aSrv = a?._cb_src === 'server', bSrv = b?._cb_src === 'server';
  if (aDate !== bDate || aSrv === bSrv) {
    // Different filings, or two rows from the same side: the newer (then the
    // higher composite) wins; the other only lends its slow fields.
    let win = a, lose = b;
    if (bDate > aDate) { win = b; lose = a; }
    else if (bDate === aDate && ((b?.composite_score ?? -1) > (a?.composite_score ?? -1))) { win = b; lose = a; }
    const out: any = { ...win };
    for (const k of CB_SLOW_FIELDS) if (out[k] == null && lose?.[k] != null) out[k] = lose[k];
    return out;
  }
  // Same filing, one row from each side: server grade over the browser's extras.
  const srv = aSrv ? a : b, loc = aSrv ? b : a;
  const out: any = { ...loc };
  for (const [k, v] of Object.entries(srv)) if (v != null && k !== 'added_at') out[k] = v;
  // The server row IS the current grade, so a "now MIXED" note from an older
  // pass no longer applies.
  delete out._tier_now;
  if (!out.added_at) out.added_at = srv.added_at;
  return out;
}

export function mergeCbEntries(local: ConvictionEntry[], server: ConvictionEntry[]): ConvictionEntry[] {
  const map = new Map<string, any>();
  for (const e of [...local, ...server]) {
    const t = String((e as any)?.ticker || '').toUpperCase();
    if (!t) continue;
    const cur = map.get(t);
    map.set(t, cur ? cbMergeTwo(cur, e) : e);
  }
  return Array.from(map.values()).map((e: any) => (typeof e.company === 'string' && e.company.includes('&') ? { ...e, company: decodeEntities(e.company) } : e));
}

/** zzz827 — the drift reading in words: EO's own banding (driftBand), not a copy. */
export function cbPeadWord(score: number): string {
  return driftBand(score) ?? 'not known';
}

const fmtN = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 10) / 10}` : 'not known');

/**
 * Which of the active criteria a name misses, in plain words. Each criterion
 * is probed ALONE through passesConvictionFilter, so the reasons are the
 * function's own answer. No BUY/SELL words and no 0–100 score are printed.
 */
export function cbFailReasons(e: ConvictionEntry, f: ConvFilters): string[] {
  if (passesConvictionFilter(e, f)) return [];
  const x: any = e;
  const cash = cbCashView(e);
  const words: Record<string, () => string> = {
    sales: () => `sales growth ${fmtN(x.sales_yoy_pct)}% (needs ${f.sales}%)`,
    pat: () => (cbTurn(x.pat_curr_cr, x.pat_prev_cr) === 'stillLoss'
      ? `profit still a loss (₹${fmtN(x.pat_curr_cr)} Cr vs ₹${fmtN(x.pat_prev_cr)} Cr a year ago — a narrower loss is not growth)`
      : `profit growth ${fmtN(x.net_profit_yoy_pct)}% (needs ${f.pat}%)`),
    eps: () => (cbTurn(x.eps_curr, x.eps_prev) === 'stillLoss'
      ? `EPS still a loss (${fmtN(x.eps_curr)} vs ${fmtN(x.eps_prev)} a year ago — a narrower loss is not growth)`
      : `EPS growth ${fmtN(x.eps_yoy_pct)}% (needs ${f.eps}%)`),
    opLev: () => `profit growth not ${f.opLev}x sales growth`,
    // zzz827 — words, never the 0–100 drift number.
    pead: () => `post-results drift reading ${cbPeadWord(peadScore(e).score)} (needs PEAD ${f.pead} or more)`,
    opmDelta: () => (typeof x.opm_pct === 'number' && typeof x.opm_prev_pct === 'number'
      ? `operating margin change ${fmtN(x.opm_pct - x.opm_prev_pct)} points (needs ${f.opmDelta} or better)`
      : 'operating margin change not known'),
    cfoPatMin: () => `cash from operations ${finN(cash.ratio) ? cash.ratio.toFixed(2) : 'not known'}x profit${cash.basis ? `, ${cash.basis}` : ''} (needs ${f.cfoPatMin}x)`,
    pledgedMax: () => `promoter pledge ${fmtN(x.pledged_pct)}% (needs ${f.pledgedMax}% or less)`,
    mktCapMin: () => `market cap ₹${fmtN(x.market_cap_cr)} Cr (needs ₹${f.mktCapMin} Cr)`,
    mktCapMax: () => `market cap ₹${fmtN(x.market_cap_cr)} Cr (large cap — above ₹${fmtN(f.mktCapMax)} Cr)`,
    peMax: () => `P/E above ${f.peMax}`,
    score: () => 'grade strength below your chip',
    opmMin: () => `operating margin below ${f.opmMin}%`,
    verdicts: () => `setup reads "${cbVerdictLabel(cbComputeQuality(e).verdictLabel)}" (needs ${(f.verdicts || []).map(cbVerdictLabel).join(' / ')})`,
    guidance: () => `guidance is not ${f.guidance}`,
    d1Bucket: () => 'day-one move outside your chip', d2Bucket: () => 'two-day move outside your chip', driftBucket: () => 'move since results outside your chip',
    cap: () => 'market-cap band outside your chip',
  };
  const out: string[] = [];
  const base: ConvFilters = { ...FILTER_DEFAULT };
  for (const k of Object.keys(words) as Array<keyof ConvFilters>) {
    const v: any = (f as any)[k];
    const active = k === 'cap' ? v && v !== 'all' : Array.isArray(v) ? v.length > 0 : v != null;
    if (!active) continue;
    if (!passesConvictionFilter(e, { ...base, [k]: v } as ConvFilters)) out.push(words[k as string]());
  }
  return out.length ? out : ['another active criterion'];
}

// ── zzz823: pass / fail / NOT CHECKED ───────────────────────────────────────
// The preset's criteria read `sales ?? 0`, a missing market cap or margin as
// a fail, and a quality verdict built from missing inputs as HIGH RISK — so a
// name whose data had simply not been filled in was dropped as "failing".
// cbCriteriaCheck keeps passesConvictionFilter's verdict for every name whose
// data is there, and says "not checked: <field> missing" (state 'unknown',
// shown, never failed) when the only criteria it misses are ones it had no
// data for. Only the PRESET's criteria are treated this way; a chip the owner
// sets by hand (D1 / drift / quarter / dates …) stays strict.

const has = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** The data words a preset criterion needed and this entry lacks. */
function cbMissingFor(e: ConvictionEntry, k: string, f: ConvFilters): string[] {
  const x: any = e;
  const need = (pairs: Array<[string, string]>) => pairs.filter(([field]) => !has(x[field])).map(([, word]) => word);
  switch (k) {
    case 'sales': return need([['sales_yoy_pct', 'sales growth']]);
    case 'eps': return cbTurn(x.eps_curr, x.eps_prev) ? [] : need([['eps_yoy_pct', 'EPS growth']]);
    case 'pat': return cbTurn(x.pat_curr_cr, x.pat_prev_cr) ? [] : need([['net_profit_yoy_pct', 'profit growth']]);
    case 'pead': return need([['sales_yoy_pct', 'sales growth'], ['net_profit_yoy_pct', 'profit growth'], ['eps_yoy_pct', 'EPS growth']]);
    case 'opmDelta': return need([['opm_pct', 'operating margin'], ['opm_prev_pct', 'last year’s operating margin']]);
    case 'mktCapMin': return need([['market_cap_cr', 'market cap']]);
    case 'verdicts': {
      // A verdict of AVOID is built from data that IS there (negative EPS
      // growth, three red flags, a sharp fall) — a real fail. A weak verdict
      // with quality inputs missing is not checked.
      const q = cbComputeQuality(e);
      if (q.verdictLabel === 'AVOID' || (f.verdicts || []).includes(q.verdictLabel)) return [];
      const fin = cbIsFinancial(e);
      const pairs: Array<[string, string]> = [['sales_yoy_pct', 'sales growth'], ['net_profit_yoy_pct', 'profit growth'], ['eps_yoy_pct', 'EPS growth'], ['roce', 'ROCE']];
      if (!fin) pairs.push(['opm_pct', 'operating margin'], ['opm_prev_pct', 'last year’s operating margin']);
      const m = need(pairs);
      // zzz827 — cash counts as present only as a same-year ratio.
      if (!fin && cbCashView(e).state === 'unknown') m.push('same-year cash conversion');
      return m.length ? m.map((w) => `${w} (for the quality verdict)`) : [];
    }
    default: return [];
  }
}

const CB_LENIENT = new Set(['sales', 'eps', 'pat', 'pead', 'opmDelta', 'mktCapMin', 'verdicts']);

/** Pass / fail / not checked, from passesConvictionFilter's own probes. */
export function cbCriteriaCheck(e: ConvictionEntry, f: ConvFilters): CriteriaCheck {
  const keys = Object.keys(f).filter((k) => {
    if (k === 'sortByPead') return false;
    const v: any = (f as any)[k];
    return k === 'cap' ? !!v && v !== 'all' : Array.isArray(v) ? v.length > 0 : typeof v === 'boolean' ? v : v != null && v !== '';
  });
  const base: ConvFilters = { ...FILTER_DEFAULT };
  const words = (k: string): string => {
    const r = cbFailReasons(e, { ...base, [k]: (f as any)[k] } as ConvFilters);
    return r[0] === 'another active criterion' ? `${k} criterion` : r.join('; ');
  };
  return runCriteriaCheck(
    keys,
    passesConvictionFilter(e, f),
    (k) => passesConvictionFilter(e, { ...base, [k]: (f as any)[k] } as ConvFilters),
    (k) => (CB_LENIENT.has(k) ? cbMissingFor(e, k, f) : []),
    words,
  );
}

// ── zzz827: per-criterion results, for the "Why N names are hidden" panel ───

export interface CbCriterionResult {
  key: string;
  /** 'pass' | 'fail' (on data that is there) | 'unknown' (its data is missing). */
  state: 'pass' | 'fail' | 'unknown';
  /** Plain words: the failing figure against the threshold, or what is missing. */
  text: string;
}

/** The active criteria of `f` (same rule cbCriteriaCheck uses). */
export function cbActiveKeys(f: ConvFilters): string[] {
  return Object.keys(f).filter((k) => {
    if (k === 'sortByPead') return false;
    const v: any = (f as any)[k];
    return k === 'cap' ? !!v && v !== 'all' : Array.isArray(v) ? v.length > 0 : typeof v === 'boolean' ? v : v != null && v !== '';
  });
}

/**
 * Each active criterion probed ALONE through passesConvictionFilter (so it can
 * never disagree with the filter), with the same "missing data is not a fail"
 * rule as cbCriteriaCheck.
 */
export function cbCriterionResults(e: ConvictionEntry, f: ConvFilters): CbCriterionResult[] {
  const base: ConvFilters = { ...FILTER_DEFAULT };
  const out: CbCriterionResult[] = [];
  for (const k of cbActiveKeys(f)) {
    const probe = { ...base, [k]: (f as any)[k] } as ConvFilters;
    if (passesConvictionFilter(e, probe)) { out.push({ key: k, state: 'pass', text: '' }); continue; }
    const miss = CB_LENIENT.has(k) ? cbMissingFor(e, k, f) : [];
    if (miss.length) { out.push({ key: k, state: 'unknown', text: `${miss.join(', ')} missing` }); continue; }
    const r = cbFailReasons(e, probe);
    out.push({ key: k, state: 'fail', text: r[0] === 'another active criterion' ? `${k} criterion` : r.join('; ') });
  }
  return out;
}
