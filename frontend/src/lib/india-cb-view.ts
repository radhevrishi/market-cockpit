// ═══════════════════════════════════════════════════════════════════════════
// INDIA CONVICTION BEATS — WHAT THE TAB SHOWS, AND WHY.            (zzz827)
//
// The owner: "many stocks missing, and a lot of changes needed; not all
// companies in that tab are in Portfolio Catalysts' conviction beats". The
// pieces that answer him, all pure (no fetch, no React, no window except the
// two small storage helpers at the end, which are guarded):
//
//   • words instead of 0–100 numbers (grade strength, quality, drift);
//   • growth shown the EO way (">500% (low base)");
//   • "Q-TRENDS loading…" only while a fill pass is actually running;
//   • the "Why N names are hidden" report — per criterion, per name, with the
//     failing figure against the threshold, and "not checked" names apart;
//   • the stale-tier re-sync — a bench row takes its tier and figures from the
//     current graded row when the grading engine version moves on; a name that
//     fell below STRONG stays, labelled "now MIXED under current rules";
//   • the Conviction Beats tab ↔ Portfolio Catalysts reconciliation.
// Synthetic tickers only in tests; nothing here names a holding.
// ═══════════════════════════════════════════════════════════════════════════

import {
  cbCriteriaCheck, cbCriterionResults, cbActiveKeys, cbCashView, cbIsFinancial, cbPeadWord, cbVerdictLabel,
  isIndiaPresetActive, type ConvFilters,
} from '@/lib/conviction-filter-india';
import { notCheckedText } from '@/lib/criteria-check';
import { decodeEntities } from '@/lib/india-eo-card-data';
import type { ConvictionEntry } from '@/lib/conviction-beats';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ─── Words instead of numbers ─────────────────────────────────────────────

/** The grade composite as a word ("grade strength high"). */
export function cbStrengthWord(v: unknown): string {
  if (!fin(v)) return 'not known';
  return v >= 80 ? 'very high' : v >= 70 ? 'high' : v >= 60 ? 'fair' : 'low';
}
/** The earnings-quality score as a word. */
export function cbQualityWord(v: unknown): string {
  if (!fin(v)) return 'not known';
  return v >= 70 ? 'high' : v >= 45 ? 'fair' : 'low';
}
export { cbPeadWord, cbVerdictLabel };

/** A quality-score part ("CFO/PAT 1.20→30") without its points. */
export function cbQualityBitWord(bit: string): string {
  return String(bit || '').replace(/→0\(windfall\)$/, ' (windfall)').replace(/ cap→\d+$/, ' caps quality').replace(/→\d+$/, '');
}

/** Growth the EO way: '>500% (low base)' above 500%, else '+42%'. */
export function cbGrowthText(v: unknown): string {
  if (!fin(v)) return '—';
  if (v >= 500) return '>500% (low base)';
  return `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
}

/** Company name with HTML entities decoded ("A &amp; B" → "A & B"). */
export function cbCompany(e: { company?: unknown; ticker?: unknown } | null | undefined): string {
  const c = e?.company != null && String(e.company).trim() ? String(e.company) : String(e?.ticker ?? '');
  return decodeEntities(c);
}

// ─── The Q-TRENDS strip ───────────────────────────────────────────────────

export type QTrendsState = 'present' | 'financial' | 'no-table' | 'fetch-failed' | 'loading' | 'not-available';

/**
 * What the Q-TRENDS line says for one card. "loading" ONLY while a fill pass
 * is running and this card has not been through one — otherwise the card is
 * told plainly that the trend is not available (it used to say "loading…"
 * forever on every card the fill pass never reached).
 */
export function qTrendsState(e: any, fillRunning: boolean): QTrendsState {
  const hasTrend = Array.isArray(e?.quarters_opm) || Array.isArray(e?.quarters_tax_pct)
    || Array.isArray(e?.quarters_other_income_pct) || Array.isArray(e?.annual_cfo_pat);
  if (hasTrend) return 'present';
  if (cbIsFinancial(e)) return 'financial';
  if (e?._trends_status === 'no-table') return 'no-table';
  if (e?._trends_status === 'fetch-failed') return 'fetch-failed';
  const tried = ((e?.cb_enrich_v || 0) >= 375) || ((e?.cb_trend_attempts || 0) >= 2);
  return !tried && fillRunning ? 'loading' : 'not-available';
}

// ─── Why N names are hidden ───────────────────────────────────────────────

export const CB_CRITERION_NAME: Record<string, string> = {
  sales: 'Sales growth', pat: 'Profit growth', eps: 'EPS growth', opLev: 'Profit vs sales growth',
  pead: 'Post-results drift', opmDelta: 'Operating margin change', cfoPatMin: 'Cash conversion (same-year)',
  pledgedMax: 'Promoter pledge', mktCapMin: 'Market cap (your setting)', peMax: 'P/E cap',
  score: 'Grade strength', opmMin: 'Operating margin level', verdicts: 'Setup label',
  guidance: 'Guidance', quarter: 'Quarter', fy: 'Fiscal year', fromDate: 'Filed from', toDate: 'Filed to',
  d1Bucket: 'Day-one move', d2Bucket: 'Two-day move', driftBucket: 'Move since results', cap: 'Market-cap band',
  freshBypass: 'Filed in the last 3 days', elite: 'ELITE only', multibagger: 'MULTIBAGGER only', newOnly: 'New in the window',
};

export interface HiddenReport {
  /** Names on the list. */
  total: number;
  /** Names shown (pass + not checked). */
  shown: number;
  /** Names hidden (fail on data that is there). */
  hidden: number;
  /** Per criterion: how many hidden names it excludes (a name can count under several). */
  byCriterion: Array<{ key: string; name: string; count: number }>;
  /** Per hidden name: every criterion it misses, with its figure against the threshold. */
  names: Array<{ ticker: string; company: string; fails: string[]; notChecked: string[] }>;
  /** Shown, but at least one criterion could not be checked (its data is missing). */
  notChecked: Array<{ ticker: string; company: string; missing: string[] }>;
  /** Names the market-cap setting excludes (on its own). */
  mktCapExcluded: number;
}

export function buildHiddenReport(entries: ConvictionEntry[], f: ConvFilters): HiddenReport {
  const counts = new Map<string, number>();
  const names: HiddenReport['names'] = [];
  const notChecked: HiddenReport['notChecked'] = [];
  let shown = 0, mktCapExcluded = 0;
  for (const e of entries) {
    const c = cbCriteriaCheck(e, f);
    const ticker = String(e.ticker || '').toUpperCase();
    const company = cbCompany(e);
    if (c.state !== 'fail') {
      shown++;
      if (c.state === 'unknown') notChecked.push({ ticker, company, missing: c.missing });
      continue;
    }
    const res = cbCriterionResults(e, f);
    const fails = res.filter((r) => r.state === 'fail');
    const unk = res.filter((r) => r.state === 'unknown');
    for (const r of fails) {
      counts.set(r.key, (counts.get(r.key) || 0) + 1);
      if (r.key === 'mktCapMin') mktCapExcluded++;
    }
    names.push({
      ticker, company,
      fails: fails.length ? fails.map((r) => `${CB_CRITERION_NAME[r.key] || r.key}: ${r.text}`) : c.failed,
      notChecked: unk.map((r) => `${CB_CRITERION_NAME[r.key] || r.key}: ${r.text}`),
    });
  }
  const order = cbActiveKeys(f);
  const byCriterion = Array.from(counts.entries())
    .map(([key, count]) => ({ key, name: CB_CRITERION_NAME[key] || key, count }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.key) - order.indexOf(b.key));
  names.sort((a, b) => a.ticker.localeCompare(b.ticker));
  notChecked.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { total: entries.length, shown, hidden: names.length, byCriterion, names, notChecked, mktCapExcluded };
}

/** "Sales growth 12 · Market cap (your setting) 9 · …" */
export function hiddenReportLine(r: HiddenReport): string {
  if (!r.hidden) return `No names are hidden — all ${r.total} meet your criteria or are shown as not checked.`;
  return `${r.hidden} of ${r.total} hidden. By criterion (a name can miss several): `
    + r.byCriterion.map((c) => `${c.name} ${c.count}`).join(' · ');
}

/** The preset bar, in words (no 0–100 number, no buy / sell words). */
export function presetBarText(capFloor: number | null = 3000): string {
  const cap = capFloor == null ? 'any market cap' : `market cap ≥₹${capFloor >= 1000 ? `${capFloor / 1000}k` : capFloor} Cr`;
  return `Sales ≥20% · EPS ≥25% · PEAD 40 or more · margin not falling · margin ≥0% · cash ≥0.5x profit (same year) · ${cap} · no pledge · setup: Top / Good / Watch`;
}

// ─── Stale tiers: re-sync from the current graded rows ────────────────────

/** Where this browser remembers the grading version its bench was synced to. */
export const CB_GRADED_V_KEY = 'mc:cb:graded-v';
/** Most filing dates one automatic re-sync reads (the rest wait for the next visit). */
export const CB_RESYNC_MAX_DATES = 40;

/** "v26" → 26; anything else → 0. */
export function gradedVersionNum(v: unknown): number {
  const m = /^v?(\d+)$/.exec(String(v ?? '').trim());
  return m ? Number(m[1]) : 0;
}

/** True when the bench was synced under an older grading version (or never). */
export function needsCbResync(stored: unknown, current: string): boolean {
  return gradedVersionNum(stored) < gradedVersionNum(current);
}

/** The fields a re-sync takes from the current graded row. Explicit nulls are
 *  written (a figure the current rules withhold must not keep its old value). */
export const CB_RESYNC_FIELDS = [
  'composite_score', 'sales_yoy_pct', 'net_profit_yoy_pct', 'eps_yoy_pct', 'opm_pct', 'opm_prev_pct',
  'cfo_to_pat_ratio', 'ocf_to_pat_ratio', 'ocf_annual_cr', 'pat_annual_cr', 'cash_fy', 'cash_basis', 'cash_note', 'cash_rule_v',
  'pead_score', 'market_cap_cr', 'tier_cap_reason', 'caveat_tags', 'quality_score', 'inflection_score', 'quadrant',
  'is_elite', 'multibagger_setup', 'fin_kind',
] as const;

export interface ResyncPatch { ticker: string; patch: Record<string, any>; change: 'tier' | 'mixed' | 'figures' | 'none'; from: string; to: string }

/**
 * One bench entry against the current graded row for the SAME filing.
 *   BLOCKBUSTER / STRONG → tier and figures replaced;
 *   MIXED / AVOID        → kept on the bench, `_tier_now` set (label: "now
 *                          MIXED under current rules"), figures replaced —
 *                          never deleted by this pass.
 * A row for another filing date is not this entry's grade → no patch.
 */
export function cbResyncPatch(entry: any, row: any): ResyncPatch | null {
  if (!entry?.ticker || !row?.ticker) return null;
  if (String(entry.ticker).toUpperCase() !== String(row.ticker).toUpperCase()) return null;
  const eDate = String(entry.filing_date || ''), rDate = String(row.filing_date || '');
  if (eDate && rDate && eDate !== rDate) return null;
  const now = String(row.tier || '').toUpperCase();
  if (!now) return null;
  const patch: Record<string, any> = {};
  for (const k of CB_RESYNC_FIELDS) if (k in row) patch[k] = row[k] ?? null;
  if (typeof row.company === 'string' && row.company.trim()) patch.company = decodeEntities(row.company);
  const from = String(entry._tier_now || entry.tier || '');
  let change: ResyncPatch['change'] = 'figures';
  if (now === 'BLOCKBUSTER' || now === 'STRONG') {
    if (entry.tier !== now || entry._tier_now) change = 'tier';
    patch.tier = now;
    patch._tier_now = null;
  } else {
    patch._tier_now = now;           // stays listed, labelled
    if (from !== now) change = 'mixed';
  }
  const same = Object.keys(patch).every((k) => JSON.stringify(entry[k] ?? null) === JSON.stringify(patch[k] ?? null));
  return { ticker: String(entry.ticker).toUpperCase(), patch, change: same ? 'none' : change, from, to: now };
}

// ─── zzz879 — this browser's list checked against the server's list ──────
// The bench in this browser keeps every card it ever saw. When a day is
// re-graded and a card turns out to be wrong (STEAMHOUSE on 5 Oct: graded on
// last quarter's numbers before its results were out), the server's list —
// rebuilt daily from the graded days, last 60 days — drops it, but this browser
// kept it until the owner pressed ×. Each visit now compares the two: a name
// filed 2–55 days ago that the server does not list is greyed and labelled
// (never deleted — × still removes it); it is un-greyed if the server lists it
// again. Names older than the server's window are not judged.
export const CB_SERVER_CHECK_MIN_AGE_DAYS = 2;
export const CB_SERVER_CHECK_MAX_AGE_DAYS = 55;
const ageDaysOf = (fd: unknown, now: number): number | null => {
  const t = Date.parse(`${String(fd || '').slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : null;
};
/** Patches that set / clear `_not_on_server` on this browser's bare bench entries. */
export function cbServerReconcile(local: any[], serverTickers: Iterable<string>, now = Date.now()): Array<{ ticker: string; patch: Record<string, any> }> {
  const srv = new Set(Array.from(serverTickers, (t) => key(t)));
  const out: Array<{ ticker: string; patch: Record<string, any> }> = [];
  for (const e of local || []) {
    const t = key(e?.ticker);
    if (!t || t.includes('@')) continue;
    if (srv.has(t)) { if (e._not_on_server) out.push({ ticker: t, patch: { _not_on_server: null } }); continue; }
    const age = ageDaysOf(e?.filing_date, now);
    if (age == null || age < CB_SERVER_CHECK_MIN_AGE_DAYS || age > CB_SERVER_CHECK_MAX_AGE_DAYS) continue;
    if (!e._not_on_server) out.push({ ticker: t, patch: { _not_on_server: true } });
  }
  return out;
}
/** A bench name the server no longer lists — greyed on the tab, left out of Portfolio Catalysts. */
export const cbIsRemoved = (e: any): boolean => !!e?._not_on_server;

/** The label a card carries when its current grade fell below STRONG. */
export function tierNowLabel(e: any): string | null {
  if (e?._not_on_server) return 'no longer on the results list (its card was removed, e.g. graded before the results were out) — × to remove';
  const t = String(e?._tier_now || '').toUpperCase();
  return t && t !== 'BLOCKBUSTER' && t !== 'STRONG' ? `now ${t} under current rules` : null;
}

/** "Re-synced 12 names to the current grading (v26): 3 changed tier, 1 now MIXED (kept, labelled)." */
export function resyncSummary(ps: ResyncPatch[], version: string, datesRead: number, datesTotal: number): string {
  const tier = ps.filter((p) => p.change === 'tier').length;
  const mixed = ps.filter((p) => p.change === 'mixed').length;
  const fig = ps.filter((p) => p.change === 'figures').length;
  const partial = datesRead < datesTotal ? ` (${datesRead} of ${datesTotal} filing dates read — the rest next visit)` : '';
  return `Bench re-synced to the current grading (${version})${partial}: ${tier} changed tier, ${mixed} now below STRONG (kept, labelled), ${fig} figures refreshed.`;
}

// ─── Conviction Beats tab ↔ Portfolio Catalysts ───────────────────────────

/** The tab writes what it shows here; Portfolio Catalysts reads it. */
export const CB_TAB_SNAPSHOT_KEY = 'mc:cb:tab-list:v1';

export interface CbTabSnapshot {
  /** Tickers the tab lists under its criteria (pass + not checked). */
  tickers: string[];
  /** True when the tab's chips were the owner's saved criteria at the time. */
  savedCriteria: boolean;
  at: string;
}

/** Are the tab's live chips the owner's saved criteria (preset on, or everything off)? */
export function filtersMatchSaved(f: ConvFilters, optedOut: boolean): boolean {
  if (!optedOut) return isIndiaPresetActive(f) && cbActiveKeys(f).every((k) => ['sales', 'eps', 'pead', 'opmDelta', 'opmMin', 'cfoPatMin', 'mktCapMin', 'mktCapMax', 'pledgedMax', 'verdicts'].includes(k));
  return cbActiveKeys(f).length === 0;
}

const key = (t: unknown) => String(t ?? '').toUpperCase().trim()
  .replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO)$/, '').replace(/-(BE|SM|ST|BZ|E1|EQ)$/, '');

export interface CbReconciliation {
  onlyTab: Array<{ ticker: string; reason: string }>;
  onlyPc: Array<{ ticker: string; reason: string }>;
  line: string;
}

/**
 * Name-for-name: the tab's list vs this page's Conviction Beats view.
 * `pcLabel(t)` gives Portfolio Catalysts' own label text for a ticker on its
 * list (null when it has no row) — used to say why a tab name is not here.
 */
export function reconcileCbLists(tab: CbTabSnapshot | null, pcTickers: string[], pcLabel: (t: string) => { state: string; text: string } | null): CbReconciliation {
  if (!tab) {
    return { onlyTab: [], onlyPc: [], line: 'Reconciliation with the Conviction Beats tab: open that tab once in this browser so its list can be compared here.' };
  }
  const pcSet = new Map(pcTickers.map((t) => [key(t), t] as const));
  const tabSet = new Map(tab.tickers.map((t) => [key(t), t] as const));
  const when = String(tab.at || '').slice(0, 16).replace('T', ' ');
  const onlyTab: CbReconciliation['onlyTab'] = [];
  const onlyPc: CbReconciliation['onlyPc'] = [];
  for (const [k, t] of tabSet) {
    if (pcSet.has(k)) continue;
    const lbl = pcLabel(t);
    const reason = !tab.savedCriteria ? 'the tab was showing your own chips, not your saved criteria'
      : lbl && lbl.state === 'fail' ? `misses your saved criteria here — ${lbl.text}`
      : lbl ? 'on this page but not counted — reload the page'
      : `not on this page's list (the tab listed it at ${when}; this page reads the list fresh — reopen the tab to refresh its copy)`;
    onlyTab.push({ ticker: t, reason });
  }
  for (const [k, t] of pcSet) {
    if (tabSet.has(k)) continue;
    onlyPc.push({ ticker: t, reason: !tab.savedCriteria ? 'the tab was showing your own chips, not your saved criteria' : `not listed when the tab was last opened (${when}) — reopen the tab to refresh its copy` });
  }
  const line = !onlyTab.length && !onlyPc.length
    ? `Matches the Conviction Beats tab name for name: ${pcSet.size} names (tab list saved ${when}).`
    : `⚠ Differs from the Conviction Beats tab (saved ${when}): ${onlyTab.length} only on the tab, ${onlyPc.length} only here — `
      + [...onlyTab.map((x) => `${x.ticker} (only on the tab: ${x.reason})`), ...onlyPc.map((x) => `${x.ticker} (only here: ${x.reason})`)].join('; ');
  return { onlyTab, onlyPc, line };
}

export function writeCbTabSnapshot(s: CbTabSnapshot): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(CB_TAB_SNAPSHOT_KEY, JSON.stringify(s)); } catch { /* storage full / blocked */ }
}
export function readCbTabSnapshot(): CbTabSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const j = JSON.parse(window.localStorage.getItem(CB_TAB_SNAPSHOT_KEY) || 'null');
    return j && Array.isArray(j.tickers) ? { tickers: j.tickers.map(String), savedCriteria: !!j.savedCriteria, at: String(j.at || '') } : null;
  } catch { return null; }
}

// ─── Exports (CSV / Excel / copy) ─────────────────────────────────────────

/** The export row's word columns — never a 0–100 number, never buy / sell. */
export function cbExportWords(e: any, verdictKey: string, peadScoreValue: number): { strength: string; drift: string; setup: string; cash: string; tierNow: string } {
  const cv = cbCashView(e);
  return {
    strength: cbStrengthWord(e?.composite_score),
    drift: cbPeadWord(peadScoreValue),
    setup: cbVerdictLabel(verdictKey),
    cash: cv.state === 'ok' ? `${(cv.ratio as number).toFixed(2)}x (${cv.basis})` : cv.state === 'na' ? 'not meaningful (lender)' : 'not checked',
    tierNow: tierNowLabel(e) || '',
  };
}

/** "not checked: sales growth missing" for one name, re-exported for the panel. */
export { notCheckedText };
