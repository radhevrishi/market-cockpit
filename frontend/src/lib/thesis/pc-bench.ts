// ═══════════════════════════════════════════════════════════════════════════
// EVERY CONVICTION BEATS NAME ON THE PORTFOLIO CATALYSTS BENCH.      (zzz811)
//
// The owner: "I don't see all stocks from Conviction Beats." The India page
// showed "Bench 2 · 2 bench names failed the preset" while Conviction Beats
// held ~314 names. Two faults, both closed here:
//
//   1. THE WRONG LIST. The India bench was built from (a) the `benched` flags
//      in the synced book snapshot (/api/v1/book/state — overwritten whole by
//      whichever browser or phone synced last; an installed phone app with a
//      near-empty local list shrinks it to a handful) and (b) this browser's
//      local Conviction Beats copy. The server's own India Conviction Beats
//      list (/api/v1/bench, KV `bench:server:v1`, ~320 names, refreshed by its
//      cron) was never read — unlike the US page, which reads /api/v1/bench-us.
//   2. THE PRESET HID NAMES. Only preset-passing bench names were joined; a
//      name that failed — or had no graded row yet — was dropped and only
//      counted in a side note.
//
// Now: the bench is the server list + this browser's list + the synced
// book's bench flags (the same union the Conviction Beats tab shows), minus
// what he holds (a held name appears ONCE, in My book). The quality
// preset is a LABEL on each bench card and a filter chip — never a gate.
// A name with no graded row is "not checked yet" (unknown), never a fail.
//
// PURE: no fetch, no React, no window.
// ═══════════════════════════════════════════════════════════════════════════

import { normSymbol } from '@/lib/portfolio-symbols';
import { indiaPresetCheck } from '@/lib/quality-preset';
import { compactIndiaBench, mergeIndiaBench, type IndiaBenchName } from '@/lib/fundamentals/universe';
import { notCheckedText, criteriaCheckText, type CriteriaCheck, type CriteriaState } from '@/lib/criteria-check';

export const IN_CB_SOURCE = 'Conviction Beats (India)';

/** How many cards a Portfolio Catalysts page renders before "show more". */
export const PC_PAGE_STEP = 30;

/** "MTAR@Q3-2026" (a quarter archive key) → "MTAR". */
export function cbTicker(k: unknown): string {
  const s = String(k ?? '');
  const at = s.indexOf('@');
  return normSymbol(at >= 0 ? s.slice(0, at) : s);
}

export type PresetState = 'pass' | 'fail' | 'unknown';
export interface PresetLabel {
  state: PresetState;
  reasons: string[];
  /** Plain words for the card: "passes the quality preset" / "fails the preset — …" / "preset not checked yet — …". */
  text: string;
}

/**
 * The India quality preset as a LABEL. Uses the exact rule the alerts use
 * (indiaPresetCheck ⇔ passesIndiaPreset). No graded row, or a row whose only
 * gap is an unknown market cap, is UNKNOWN — silence is never a pass and
 * never a fail.
 */
export function presetLabelIndia(graded: any): PresetLabel {
  if (!graded || graded.source === 'none') {
    return { state: 'unknown', reasons: ['no graded row yet'], text: 'preset not checked yet — no graded results row for this name yet' };
  }
  const c = indiaPresetCheck(graded);
  if (c.pass) return { state: 'pass', reasons: [], text: 'passes the quality preset' };
  const real = c.reasons.filter((r) => r !== 'market cap not known');
  if (!real.length) {
    return { state: 'unknown', reasons: c.reasons, text: 'preset not checked yet — market cap not known' };
  }
  return { state: 'fail', reasons: c.reasons, text: `does not meet the quality preset — ${c.reasons.join('; ')}` };
}

export interface IndiaCbInfo {
  /** Names on India Conviction Beats (server + this browser − removals), before de-dup against holdings. */
  total: number;
  server: number;
  localOnly: number;
  /** Bench flags in the synced book that are on neither list above. */
  syncedOnly: number;
  /** Server names the owner removed on Conviction Beats, left off. */
  removed: number;
  updatedAt: string | null;
  serverError: string | null;
}

export interface IndiaBenchBuild {
  /** Bench symbols, not held, one per ticker, sorted. */
  bench: string[];
  /** Conviction Beats names the owner holds — shown once, as book. */
  heldOnCb: string[];
  companies: Record<string, string | null>;
  info: IndiaCbInfo;
}

/**
 * Pure: the India bench for Portfolio Catalysts.
 * `server` is the /api/v1/bench payload's entries (full cards or the
 * `?view=tickers` projection — both compact the same way).
 */
export function buildIndiaBench(input: {
  held: Iterable<string>;
  server: unknown;
  local?: Array<{ ticker?: string | null; company?: string | null }>;
  removed?: Iterable<string>;
  synced?: Iterable<string>;
  updatedAt?: string | null;
  serverError?: string | null;
}): IndiaBenchBuild {
  const held = new Set(Array.from(input.held, (s) => cbTicker(s)).filter(Boolean));
  const server: IndiaBenchName[] = compactIndiaBench(input.server);
  const local = (input.local || [])
    .map((l) => ({ ticker: cbTicker(l?.ticker), company: l?.company || null }))
    .filter((l) => !!l.ticker);
  const removed = Array.from(input.removed || [], (t) => cbTicker(t)).filter(Boolean);
  const mg = mergeIndiaBench(server, local, removed);
  const companies: Record<string, string | null> = {};
  const all = new Set<string>();
  for (const n of mg.names) { all.add(n.symbol); companies[n.symbol] = n.company; }
  let syncedOnly = 0;
  const removedSet = new Set(removed);
  for (const s0 of input.synced || []) {
    const s = cbTicker(s0);
    if (!s || all.has(s) || removedSet.has(s)) continue;
    all.add(s); companies[s] = null; syncedOnly++;
  }
  const bench: string[] = [];
  const heldOnCb: string[] = [];
  for (const s of Array.from(all).sort()) (held.has(s) ? heldOnCb : bench).push(s);
  return {
    bench, heldOnCb, companies,
    info: {
      total: all.size, server: mg.server, localOnly: mg.localOnly, syncedOnly, removed: mg.removed,
      updatedAt: input.updatedAt ?? null, serverError: input.serverError ?? null,
    },
  };
}

export interface BenchPresetCounts { bench: number; pass: number; fail: number; unknown: number }

/** Preset split of the bench rows given (after any size filter). pass + fail + unknown = bench. */
export function benchPresetCounts(rows: Array<{ origin: string; preset?: PresetLabel | null }>): BenchPresetCounts {
  let bench = 0, pass = 0, fail = 0, unknown = 0;
  for (const r of rows) {
    if (r.origin !== 'bench') continue;
    bench++;
    const s = r.preset?.state || 'unknown';
    if (s === 'pass') pass++; else if (s === 'fail') fail++; else unknown++;
  }
  return { bench, pass, fail, unknown };
}

/**
 * The header line that says what the bench covers and adds up:
 *   "India Conviction Beats 314 = 2 you hold (shown once, in My book) + 312
 *    on the bench · bench 312 − 20 large caps hidden = 292 shown = 40 pass
 *    the preset + 210 do not + 42 not checked yet · source: …"
 */
export function indiaBenchLine(info: IndiaCbInfo | null | undefined, heldOnCb: number, benchAll: number, shown: BenchPresetCounts, hiddenLarge: number): string {
  if (!info) return 'bench: loading the India Conviction Beats list…';
  if (!info.total) {
    return `bench: 0 — the India Conviction Beats list is empty${info.serverError ? ` (the server list could not be read: ${info.serverError})` : ''}`;
  }
  const src = [
    info.server ? `server list ${info.server}${info.updatedAt ? ` (updated ${String(info.updatedAt).slice(0, 10)})` : ''}` : `server list not read${info.serverError ? ` (${info.serverError})` : ''}`,
    info.localOnly ? `${info.localOnly} only in this browser` : null,
    info.syncedOnly ? `${info.syncedOnly} only in your synced book` : null,
  ].filter(Boolean).join(' + ');
  return `${IN_CB_SOURCE} ${info.total} = ${heldOnCb} you hold (shown once, in My book) + ${benchAll} on the bench`
    + ` · bench ${benchAll}${hiddenLarge ? ` − ${hiddenLarge} large caps hidden` : ''} = ${shown.bench} shown = ${shown.pass} pass the preset + ${shown.fail} do not + ${shown.unknown} not checked yet`
    + ` · source: ${src}${info.removed ? ` · ${info.removed} you removed on Conviction Beats left off` : ''}`;
}

/** Progressive rendering: how many cards to show next. */
export function nextWindow(current: number, total: number, step = PC_PAGE_STEP): number {
  return Math.min(total, Math.max(step, current + step));
}

/**
 * zzz811 — what the bulk read buttons cover. By default only the book plus
 * the bench names that PASS the preset (India). The rest of the bench is a
 * separate, manual button — never automatic. "Pass" = meets the owner's
 * Conviction Beats criteria (India and US alike).
 */
export function readScope<T extends { origin: string; preset?: { state?: string } | null }>(rows: T[], market: 'IN' | 'US' = 'IN'): { primary: T[]; otherBench: T[] } {
  const primary: T[] = [], otherBench: T[] = [];
  for (const r of rows) {
    // zzz811: both pages now label bench names with the owner's Conviction
    // Beats criteria, so the rule is the same on both.
    void market;
    const inDefault = r.origin !== 'bench' || r.preset?.state === 'pass';
    (inDefault ? primary : otherBench).push(r);
  }
  return { primary, otherBench };
}

/** "Also read the other 212 bench names (about 212 AI reads)". */
export function otherBenchLabel(n: number): string {
  return `Also read the other ${n} bench name${n === 1 ? '' : 's'} (about ${n} AI read${n === 1 ? '' : 's'})`;
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz811 (owner follow-up) — "preset on criteria also, as I set on Conviction
// Beats". The bench is the Conviction Beats page's OWN list, selected by the
// owner's OWN criteria with the page's OWN function:
//   India: lib/conviction-filter-india (passesConvictionFilter; the preset,
//          or none when he switched it off) over this browser's list merged
//          with the server bench — exactly the Conviction Beats tab.
//   US:    lib/conviction-beats-us (passesUsConvictionFilter; his saved US
//          filters, else the preset + Small/Mid) over the US bench list.
// Membership is not the thesis engine: the US criteria may read price (50/200-
// day averages) to CHOOSE names; the thesis engine still reads no price.
// ═══════════════════════════════════════════════════════════════════════════

export interface CbSelection {
  /** Names on the Conviction Beats list (before criteria). */
  listTotal: number;
  /** Names the Conviction Beats page shows under his criteria: those that
   *  meet them PLUS those not checked for want of data (zzz823 — unknown is
   *  not a fail). `unknown` lists the second group. */
  passing: string[];
  /** zzz823: shown but not checked — a criterion's data is missing. */
  unknown: string[];
  failing: string[];
  /** Passing names he does not hold → the default bench. */
  bench: string[];
  /** Failing names he does not hold → only with "Also show names failing your criteria". */
  benchFailing: string[];
  heldPassing: string[];
  labels: Record<string, PresetLabel>;
  companies: Record<string, string | null>;
}

/** zzz823: the key two tickers are compared by when deciding "held" — case,
 *  exchange prefix / suffix and the NSE series suffix (-BE, -SM …) never make
 *  a held name look unheld (it would then show twice: once in the book and
 *  once on the bench). */
export function heldKey(t: unknown): string {
  return String(t ?? '').toUpperCase().trim()
    .replace(/^(NSE|BSE|NYSE|NASDAQ|AMEX):/, '')
    .replace(/\.(NS|BO|BSE|NSE)$/, '')
    .replace(/-(BE|SM|ST|BZ|E1|EQ)$/, '');
}

const RANK: Record<CriteriaState, number> = { pass: 2, unknown: 1, fail: 0 };

function selectByCriteria<E>(
  entries: E[], held: Set<string>, key: (e: E) => string,
  check: (e: E) => CriteriaCheck, company: (e: E) => string | null, criteriaOff: boolean,
  heldOf: (t: string) => string = heldKey,
): CbSelection {
  // One verdict per ticker: the best of its entries (pass > not checked > fail)
  // — the Conviction Beats page lists it then.
  const by = new Map<string, { c: CriteriaCheck; company: string | null }>();
  for (const e of entries) {
    const t = key(e);
    if (!t) continue;
    const c = check(e);
    const had = by.get(t);
    if (had && RANK[had.c.state] >= RANK[c.state]) continue;
    by.set(t, { c, company: company(e) || had?.company || null });
  }
  const passing: string[] = [], unknown: string[] = [], failing: string[] = [], bench: string[] = [], benchFailing: string[] = [], heldPassing: string[] = [];
  const labels: Record<string, PresetLabel> = {}, companies: Record<string, string | null> = {};
  for (const t of Array.from(by.keys()).sort()) {
    const v = by.get(t)!;
    companies[t] = v.company;
    const shown = v.c.state !== 'fail';
    labels[t] = v.c.state === 'pass'
      ? { state: 'pass', reasons: [], text: criteriaOff ? 'on your Conviction Beats list (your preset is switched off there, so every name is listed)' : 'meets your Conviction Beats criteria' }
      : v.c.state === 'unknown'
        ? { state: 'unknown', reasons: v.c.missing, text: `${notCheckedText(v.c.missing)} — shown, not failed` }
        : { state: 'fail', reasons: v.c.failed, text: criteriaCheckText(v.c, '') };
    (shown ? passing : failing).push(t);
    if (v.c.state === 'unknown') unknown.push(t);
    if (held.has(heldOf(t))) { if (shown) heldPassing.push(t); continue; }
    (shown ? bench : benchFailing).push(t);
  }
  return { listTotal: by.size, passing, unknown, failing, bench, benchFailing, heldPassing, labels, companies };
}

/** A yes/no filter as a check (no "not checked" state) — for callers that
 *  have no per-criterion probe. */
function yesNo<E>(passes: (e: E) => boolean, reasons: (e: E) => string[]): (e: E) => CriteriaCheck {
  return (e) => (passes(e) ? { state: 'pass', failed: [], missing: [] } : { state: 'fail', failed: reasons(e), missing: [] });
}

/** India: the Conviction Beats tab's list and verdict. `check` is
 *  cbCriteriaCheck bound to his filters (or `passes`/`reasons` for a plain
 *  yes/no). Held names are compared by heldKey. */
export function selectIndiaCb<E extends { ticker?: string | null; company?: string | null }>(input: {
  held: Iterable<string>; list: E[]; criteriaOff: boolean;
  check?: (e: E) => CriteriaCheck; passes?: (e: E) => boolean; reasons?: (e: E) => string[];
}): CbSelection {
  const held = new Set(Array.from(input.held, (s) => heldKey(cbTicker(s))).filter(Boolean));
  const check = input.check || yesNo(input.passes || (() => true), input.reasons || (() => []));
  return selectByCriteria(input.list, held, (e) => cbTicker(e?.ticker), check, (e) => (e?.company ? String(e.company) : null), input.criteriaOff);
}

/** US: same shape; tickers are compared as the US engine keys them. */
export function selectUsCb<E extends { ticker?: string | null; company?: string | null }>(input: {
  held: Iterable<string>; list: E[]; key: (t: string) => string; criteriaOff: boolean;
  check?: (e: E) => CriteriaCheck; passes?: (e: E) => boolean; reasons?: (e: E) => string[];
}): CbSelection {
  const held = new Set(Array.from(input.held, (s) => input.key(String(s).split('@')[0])).filter(Boolean));
  const check = input.check || yesNo(input.passes || (() => true), input.reasons || (() => []));
  return selectByCriteria(input.list, held, (e) => input.key(String(e?.ticker || '').split('@')[0]), check, (e) => (e?.company ? String(e.company) : null), input.criteriaOff, (t) => t);
}

export interface CbCriteriaInfo {
  market: 'IN' | 'US';
  listTotal: number;
  passing: number;
  failing: number;
  heldPassing: number;
  /** zzz823: of `passing`, names shown but not checked (a criterion's data is missing). */
  unknown?: number;
  /** Plain words for the criteria in force ("your quality preset", "preset switched off", "your saved US filters"). */
  criteria: string;
  source: string;
  error: string | null;
}

/**
 * The header: what the bench is and whether it matches the Conviction Beats
 * page. `onPage` = passing names actually present on this page (book + bench,
 * before the size filter). A mismatch is said, never hidden.
 */
export function cbCriteriaLine(info: CbCriteriaInfo | null | undefined, onPage: number, showingFailing: boolean): string {
  const label = info?.market === 'US' ? 'Conviction Beats (US)' : 'Conviction Beats (India)';
  if (!info) return `${label}: loading the list…`;
  if (!info.listTotal) return `${label} under your criteria: 0 — the Conviction Beats list is empty${info.error ? ` (${info.error})` : ''}`;
  const match = onPage === info.passing
    ? `matches Conviction Beats page: ${info.passing} names`
    : `⚠ does NOT match the Conviction Beats page: ${onPage} here vs ${info.passing} there`;
  const unk = info.unknown ? ` (${info.passing - info.unknown} meet them + ${info.unknown} not checked — a figure is missing, so shown and labelled, never failed)` : '';
  return `${label} under your criteria: ${info.passing}${unk} — same list as the Conviction Beats page · selected by your Conviction Beats criteria (${info.criteria})`
    + ` · ${match} = ${info.heldPassing} you hold (in My book) + ${info.passing - info.heldPassing} on the bench`
    + ` · ${info.failing} of the ${info.listTotal} on the list miss your criteria${showingFailing ? ' (shown, labelled)' : ' (hidden — use the chip to show them)'}`
    + ` · source: ${info.source}`;
}
