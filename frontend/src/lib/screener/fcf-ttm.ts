// zzz1045e — a TRUE trailing-twelve-month free-cash-flow margin for the USA, as a NEW versioned figure (fcfmT / r40T). Pure: the
// server (lib/screener/us-build.ts) reads SEC's per-company "company concept" files and hands the facts here.
//
// Why a separate figure (and why the old one stays): the FCF margin the screens use today (fcfmTTM, misnamed — kept so saved screens
// keep their meaning) is the LATEST FULL FISCAL YEAR's. SEC "frames" cannot give a true last-4-quarters cash flow: companies file
// cash flow in 10-Qs only as YEAR-TO-DATE totals (3, 6, 9 months), and a frame for a calendar quarter holds only facts that span
// about 3 months — nearly nobody files those for cash flow. So this reads each company's own cash-flow facts and:
//   • keeps the latest filing of every (start, end) span — an amended 10-Q/A or 10-K/A, or a restated figure in a later report, wins;
//   • works out each fiscal quarter from the year-to-date totals that share a start date: Q1 = 3-month YTD, Q2 = 6-month YTD − Q1,
//     Q3 = 9-month YTD − 6-month YTD, Q4 = full year − 9-month YTD. The start date is the company's own fiscal-year start, so a
//     fiscal year ending June, September or on a 52 / 53-week calendar works the same as a calendar year. A 3-month figure filed on
//     its own is used as is (it wins over a worked-out one for the same quarter);
//   • adds the last four quarters only when they join up end to start (no gap, no overlap) and cover about one year;
//   • needs all four quarters of BOTH operating cash flow and capex — otherwise the figure is unknown (left blank, never 0). A capex
//     quarter that works out below zero (a reclassified year-to-date total) also makes it unknown.
// India keeps the full-year cash-flow proxy: screener.in prints no quarterly cash flow.

/** Bump when the derivation changes: stored per-company cash-flow quarters of an older version are read again. */
export const FCF_TTM_VERSION = 1;
/** Taxonomy names, in the order tried (the first that gives four joined-up quarters is used). */
export const CFO_TTM_TAGS = ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'] as const;
export const CAPEX_TTM_TAGS = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'] as const;

/** One duration fact from SEC's company-concept file (units.USD[]). */
export interface SecFact { start?: string; end: string; val: number; filed?: string; form?: string; fy?: number; fp?: string; accn?: string }
/** One fiscal quarter: start, end (YYYY-MM-DD), value ($), d = 1 when worked out from year-to-date totals. */
export interface CfQuarter { s: string; e: string; v: number; d?: 0 | 1 }
/** What is stored per company (screener_store kind 'cfq'). */
export interface CfStored { ver: number; read: string; cfo: CfQuarter[]; cx: CfQuarter[]; cfoTag?: string | null; cxTag?: string | null }

const DAY = 86_400_000;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const dt = (s?: string) => (s ? Date.parse(s) : NaN);
const span = (s?: string, e?: string) => (dt(e) - dt(s)) / DAY;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Forms whose cash-flow facts count (amendments included; registration statements and 8-Ks left out). */
const FORMS = /^(10-Q|10-K|10-KT|10-QT)(\/A)?$/;
/** A fiscal quarter: 13 weeks ± (a 16-week first quarter, as some retailers file, fits). */
const Q_MIN = 56, Q_MAX = 125;

/** Pure: SEC company-concept JSON → facts in dollars (empty when the shape is not as expected). */
export function parseCompanyConcept(j: any): SecFact[] {
  const arr: any[] = j?.units?.USD || [];
  const out: SecFact[] = [];
  for (const f of arr) {
    if (!fin(f?.val) || typeof f?.end !== 'string') continue;
    out.push({ start: typeof f.start === 'string' ? f.start : undefined, end: f.end, val: f.val, filed: f.filed, form: f.form, fy: f.fy, fp: f.fp, accn: f.accn });
  }
  return out;
}

/** Pure: one fact per (start, end) span — the one filed LATEST (an amendment or a restatement in a later report wins). Duration facts
 *  from 10-Q / 10-K (and their amendments) only. */
export function latestFacts(facts: readonly SecFact[]): SecFact[] {
  const m = new Map<string, SecFact>();
  for (const f of facts) {
    if (!f.start || !fin(f.val) || !(span(f.start, f.end) > 0)) continue;
    if (f.form && !FORMS.test(f.form)) continue;
    const k = `${f.start}|${f.end}`;
    const prev = m.get(k);
    if (!prev || String(f.filed || '') > String(prev.filed || '') || (String(f.filed || '') === String(prev.filed || '') && /\/A$/.test(f.form || ''))) m.set(k, f);
  }
  return Array.from(m.values());
}

/** Pure: the company's fiscal quarters from its facts — filed 3-month figures, plus quarters worked out from year-to-date totals that
 *  share a start date (Q2 = H1 − Q1 …, Q4 = year − 9 months). Oldest first; one per quarter end (a filed figure wins). */
export function quartersFromFacts(facts: readonly SecFact[]): CfQuarter[] {
  const fs = latestFacts(facts);
  const byEnd = new Map<string, CfQuarter>();
  const put = (q: CfQuarter) => {
    const prev = byEnd.get(q.e);
    if (!prev || (prev.d && !q.d)) byEnd.set(q.e, q);
  };
  // filed 3-month figures
  for (const f of fs) { const d = span(f.start, f.end); if (d >= Q_MIN && d <= Q_MAX) put({ s: f.start as string, e: f.end, v: f.val, d: 0 }); }
  // year-to-date chains: facts sharing a start date, by end date; each step of about one quarter is a worked-out quarter
  const byStart = new Map<string, SecFact[]>();
  for (const f of fs) { const d = span(f.start, f.end); if (d >= Q_MIN && d <= 380) (byStart.get(f.start as string) || byStart.set(f.start as string, []).get(f.start as string)!).push(f); }
  for (const chain of byStart.values()) {
    chain.sort((a, b) => dt(a.end) - dt(b.end));
    for (let k = 1; k < chain.length; k++) {
      const a = chain[k - 1], b = chain[k];
      const step = span(a.end, b.end);
      if (!(step >= Q_MIN && step <= Q_MAX)) continue;
      put({ s: iso(dt(a.end) + DAY), e: b.end, v: b.val - a.val, d: 1 });
    }
  }
  return Array.from(byEnd.values()).sort((x, y) => dt(x.e) - dt(y.e));
}

/** Pure: the last four quarters (ending at `end` when given, else at the newest quarter) when they join up and cover about a year —
 *  their sum, first start and last end; null otherwise (a missing quarter is unknown, never 0). */
export function ttmSum(qs: readonly CfQuarter[], end?: string | null): { v: number; s: string; e: string; parts: CfQuarter[] } | null {
  const sorted = [...qs].sort((x, y) => dt(y.e) - dt(x.e));   // newest first
  let i = 0;
  if (end) { i = sorted.findIndex((q) => Math.abs(dt(q.e) - dt(end)) <= 5 * DAY); if (i < 0) return null; }
  if (!sorted[i]) return null;
  const parts: CfQuarter[] = [sorted[i]];
  for (let k = 0; k < 3; k++) {
    const cur = parts[parts.length - 1];
    const want = dt(cur.s) - DAY;   // the previous quarter ends the day before this one starts
    const prev = sorted.find((q) => Math.abs(dt(q.e) - want) <= 6 * DAY);
    if (!prev) return null;
    parts.push(prev);
  }
  for (const q of parts) { const d = span(q.s, q.e); if (!(d >= Q_MIN && d <= Q_MAX) || !fin(q.v)) return null; }
  const total = span(parts[3].s, parts[0].e);
  if (!(total >= 350 && total <= 380)) return null;
  return { v: parts.reduce((a, q) => a + q.v, 0), s: parts[3].s, e: parts[0].e, parts };
}

/** Pure: trailing-12-month free cash flow = Σ last four quarters of operating cash flow − Σ the same four quarters of capex. Both must
 *  end on the same date and have all four quarters; a capex quarter below zero (a year-to-date total that went down) is unknown. */
export function fcfTtm(cfo: readonly CfQuarter[], cx: readonly CfQuarter[], end?: string | null): { fcf: number; cfo: number; capex: number; s: string; e: string } | null {
  const a = ttmSum(cfo, end);
  if (!a) return null;
  const b = ttmSum(cx, a.e);
  if (!b || Math.abs(dt(b.e) - dt(a.e)) > 5 * DAY) return null;
  if (b.parts.some((q) => q.v < 0)) return null;
  return { fcf: a.v - b.v, cfo: a.v, capex: b.v, s: a.s, e: a.e };
}

/** Pure: the newest quarter end in a stored record (or null). */
export function lastQuarterEnd(qs: readonly CfQuarter[] | undefined): string | null {
  let best: string | null = null;
  for (const q of qs || []) if (!best || q.e > best) best = q.e;
  return best;
}

/** Pure: keep only the newest `n` quarters (what is stored). */
export function trimQuarters(qs: readonly CfQuarter[], n = 8): CfQuarter[] {
  return [...qs].sort((x, y) => dt(x.e) - dt(y.e)).slice(-n);
}

/** Pure: whether a company's cash-flow quarters should be read (again): never read, an older version, a newer quarter seen in the
 *  frames (`latestLabel`, e.g. CY2026Q2) than the stored one (and the last read is more than a day old), or older than 45 days. */
export function cfDue(stored: CfStored | null | undefined, latestLabel: string | null, labelOfEnd: (end: string) => string | null, now = Date.now()): boolean {
  if (!stored || stored.ver !== FCF_TTM_VERSION) return true;
  const ageD = (now - dt(stored.read)) / DAY;
  if (!(ageD >= 0)) return true;
  if (ageD > 45) return true;
  const e = lastQuarterEnd(stored.cfo);
  if (latestLabel && ageD > 1 && (!e || labelOfEnd(e) !== latestLabel)) return true;
  return false;
}

// ── before / after: who passes a Rule of 40 rule on the full-year figure vs the trailing-12-month figure ─────────────────────
export interface R40Change { t: string; fy: number | null; ttm: number | null }
export interface R40Diff { min: number; comparable: number; fyOnly: number; ttmOnly: number; gained: R40Change[]; lost: R40Change[] }
/** Pure: companies whose "Rule of 40 ≥ min" pass changes between the full-year FCF figure (r40) and the trailing-12-month one (r40T).
 *  gained = passes on TTM, not on FY (FY failing or unknown); lost = passes on FY, not on TTM (TTM failing or unknown). comparable =
 *  both known; fyOnly / ttmOnly = known on one side only. Sorted by the larger change first (one side unknown last). For the owner to review BEFORE any saved
 *  screen is moved to the TTM figure. */
export function r40TtmDiff(rows: ReadonlyArray<{ t: string; r40?: number | null; r40T?: number | null }>, min = 40): R40Diff {
  const out: R40Diff = { min, comparable: 0, fyOnly: 0, ttmOnly: 0, gained: [], lost: [] };
  for (const r of rows) {
    const fy = fin(r.r40) ? r.r40 : null, tt = fin(r.r40T) ? r.r40T : null;
    if (fy != null && tt != null) out.comparable++;
    else if (fy != null) out.fyOnly++;
    else if (tt != null) out.ttmOnly++;
    const pf = fy != null && fy >= min, pt = tt != null && tt >= min;
    if (pt && !pf) out.gained.push({ t: r.t, fy, ttm: tt });
    if (pf && !pt) out.lost.push({ t: r.t, fy, ttm: tt });
  }
  const gap = (c: R40Change) => (c.fy != null && c.ttm != null ? Math.abs(c.ttm - c.fy) : -1);
  out.gained.sort((a, b) => gap(b) - gap(a) || a.t.localeCompare(b.t));
  out.lost.sort((a, b) => gap(b) - gap(a) || a.t.localeCompare(b.t));
  return out;
}
/** Pure: the diff in one build-note line. */
export function r40TtmDiffNote(d: R40Diff, show = 12): string {
  const list = (xs: R40Change[]) => xs.slice(0, show).map((c) => `${c.t} (${c.fy ?? '—'} → ${c.ttm ?? '—'})`).join(', ') + (xs.length > show ? ` and ${xs.length - show} more` : '');
  return `Rule of 40 ≥ ${d.min}, full-year FCF vs trailing-12-month FCF: ${d.gained.length} would newly pass${d.gained.length ? ` — ${list(d.gained)}` : ''}; ${d.lost.length} would drop out${d.lost.length ? ` — ${list(d.lost)}` : ''}. Both figures known for ${d.comparable} companies (full year only: ${d.fyOnly}, trailing only: ${d.ttmOnly}). Saved screens still use the full-year figure`;
}
