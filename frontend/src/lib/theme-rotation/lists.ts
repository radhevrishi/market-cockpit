// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — NAMES ON YOUR LISTS, AND YOUR HOLDINGS  (zzz795)
//
// Two different things the old page merged under "Your Book":
//
//   · NAMES ON YOUR LISTS — Technicals uploads, Multibagger uploads and the
//     Conviction bench. These are research lists, not positions. The old copy
//     said "You are heavy in themes rolling over — review the trim list" while
//     counting watchlist uploads; that sentence is now only ever said about
//     real holdings.
//   · HOLDINGS — the India portfolio and the US book, read-only.
//
// Also the honest replacement for the "Dummy Portfolio": it ranks names only
// by real quality evidence (your Fundo grade, or a graded print and how
// recent it is). When neither exists it declines to rank, instead of sorting
// by the alphabet and looking ranked.
// ═══════════════════════════════════════════════════════════════════════════

import type { ClassifyResult } from '@/lib/theme-classify';
import { sanitizeTicker } from './evidence-inputs';

export interface RawListRow { symbol?: string; ticker?: string; sector?: string | null; industry?: string | null; company?: string | null; name?: string | null; grade?: string | null; mcap?: number | null }
export interface RawBenchRow { ticker: string; company?: string | null; sector?: string | null; industry?: string | null; tier?: string | null; filing_date?: string | null; pe?: number | null; url?: string | null; mcap?: number | null }

export interface ListEntry {
  ticker: string;
  company?: string | null;
  sector?: string | null;
  industry?: string | null;
  grade?: string | null;
  inTech: boolean;
  inFundo: boolean;
  inBench: boolean;
  held: boolean;
  benchTier?: string | null;
  filingDate?: string | null;
  pe?: number | null;
  url?: string | null;
  /** zzz797 — market cap when a source carries one (US $M, India ₹ Cr). */
  mcap?: number | null;
  theme: string | null;
  via: ClassifyResult['via'] | null;
}

/** Index / benchmark funds are not research names. */
export const NOT_A_NAME = new Set(['SPY', 'QQQ', 'QQQM', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'SPX', 'NDX', 'RUT', 'NIFTY', 'NIFTYBEES', 'BANKBEES', 'GOLDBEES']);

export function buildListEntries(
  tech: RawListRow[], fundo: RawListRow[], bench: RawBenchRow[], held: Set<string>,
  classify: (e: { ticker: string; sector?: string | null; industry?: string | null; company?: string | null }) => ClassifyResult | null,
): ListEntry[] {
  const map = new Map<string, ListEntry>();
  const get = (raw: unknown): ListEntry | null => {
    const t = sanitizeTicker(raw);
    if (!t || NOT_A_NAME.has(t)) return null;
    let e = map.get(t);
    if (!e) { e = { ticker: t, inTech: false, inFundo: false, inBench: false, held: held.has(t), theme: null, via: null }; map.set(t, e); }
    return e;
  };
  const capOk = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0;
  for (const r of tech) { const e = get(r.symbol ?? r.ticker); if (!e) continue; e.inTech = true; e.sector ||= r.sector; e.industry ||= r.industry; e.company ||= r.company || r.name; if (capOk(r.mcap) && e.mcap == null) e.mcap = r.mcap; }
  for (const r of fundo) { const e = get(r.symbol ?? r.ticker); if (!e) continue; e.inFundo = true; e.sector ||= r.sector; e.industry ||= r.industry; e.company ||= r.company || r.name; if (r.grade) e.grade = r.grade; if (capOk(r.mcap) && e.mcap == null) e.mcap = r.mcap; }
  for (const b of bench) {
    const e = get(b.ticker); if (!e) continue;
    e.inBench = true; e.sector ||= b.sector; e.industry ||= b.industry; e.company ||= b.company;
    if (capOk(b.mcap)) e.mcap = b.mcap;
    // Keep the most recent graded print for the name.
    if (!e.filingDate || (b.filing_date && b.filing_date > e.filingDate)) { e.benchTier = b.tier; e.filingDate = b.filing_date; e.url = b.url; }
    if (typeof b.pe === 'number' && b.pe > 0) e.pe = b.pe;
  }
  // Holdings that are on no list still count as names on the page.
  for (const h of held) get(h);
  for (const e of map.values()) {
    const c = classify(e);
    e.theme = c?.theme ?? null; e.via = c?.via ?? null;
  }
  return [...map.values()];
}

const GRADE_BASE: Record<string, number> = { A: 0, B: 3, C: 6, D: 9, E: 12, F: 12 };
export function gradeRank(g?: string | null): number | null {
  if (!g) return null;
  const m = String(g).trim().toUpperCase().match(/^([A-F])\s*([+-]?)/);
  if (!m) return null;
  return (GRADE_BASE[m[1]] ?? 90) + (m[2] === '+' ? 0 : m[2] === '-' ? 2 : 1);
}

/** Order inside a theme group: held first, then graded print tier/recency, then Fundo grade, then ticker. */
export function listOrder(a: ListEntry, b: ListEntry): number {
  const tierR = (e: ListEntry) => (/BLOCK/i.test(e.benchTier || '') ? 0 : /STRONG/i.test(e.benchTier || '') ? 1 : 2);
  return Number(b.held) - Number(a.held)
    || tierR(a) - tierR(b)
    || String(b.filingDate || '').localeCompare(String(a.filingDate || ''))
    || (gradeRank(a.grade) ?? 99) - (gradeRank(b.grade) ?? 99)
    || a.ticker.localeCompare(b.ticker);
}

export interface BestSupported {
  picks: Array<ListEntry & { reason: string }>;
  rankedBy: 'grade' | 'print' | 'grade+print' | null;
  /** Set when there is nothing real to rank by. */
  declined: string | null;
  eligible: number;
}

/**
 * Names on your lists inside themes the board currently favours, ranked ONLY
 * by real quality evidence. Declines (with a reason) when there is none.
 */
export function bestSupported(entries: ListEntry[], favoured: Set<string>, nowIso: string, cap = 15, perTheme = 3): BestSupported {
  const eligible = entries.filter((e) => e.theme && favoured.has(e.theme));
  const graded = eligible.filter((e) => gradeRank(e.grade) != null);
  const printed = eligible.filter((e) => /BLOCK|STRONG/i.test(e.benchTier || '') && e.filingDate);
  if (!eligible.length) return { picks: [], rankedBy: null, declined: 'None of your names sit in a theme the board currently rates BUY or EARLY BUY.', eligible: 0 };
  if (!graded.length && !printed.length) {
    return { picks: [], rankedBy: null, eligible: eligible.length, declined: `${eligible.length} of your names sit in favoured themes, but none has a Fundo grade or a graded earnings print — so any order would be arbitrary. Upload the Multibagger sheet, or let names reach the Conviction bench, and this list ranks itself.` };
  }
  const now = new Date(nowIso).getTime();
  const score = (e: ListEntry) => {
    const g = gradeRank(e.grade);
    const tier = /BLOCK/i.test(e.benchTier || '') ? 2 : /STRONG/i.test(e.benchTier || '') ? 1 : 0;
    const age = e.filingDate ? (now - new Date(e.filingDate).getTime()) / 86_400_000 : 999;
    const fresh = tier ? Math.max(0, 1 - age / 180) : 0;
    return (g != null ? (14 - g) : 0) + tier * 3 + fresh * 2;
  };
  const pool = eligible.filter((e) => gradeRank(e.grade) != null || /BLOCK|STRONG/i.test(e.benchTier || '')).sort((a, b) => score(b) - score(a) || a.ticker.localeCompare(b.ticker));
  const perT = new Map<string, number>();
  const picks: BestSupported['picks'] = [];
  for (const e of pool) {
    const n = perT.get(e.theme!) || 0;
    if (n >= perTheme) continue;
    perT.set(e.theme!, n + 1);
    const bits: string[] = [];
    if (e.grade) bits.push(`Fundo ${e.grade}`);
    if (e.benchTier) bits.push(`${/BLOCK/i.test(e.benchTier) ? 'BLOCKBUSTER' : 'STRONG'} print${e.filingDate ? ` ${e.filingDate.slice(0, 10)}` : ''}`);
    picks.push({ ...e, reason: bits.join(' · ') });
    if (picks.length >= cap) break;
  }
  const rankedBy = graded.length && printed.length ? 'grade+print' : graded.length ? 'grade' : 'print';
  return { picks, rankedBy, declined: null, eligible: eligible.length };
}

// ── CASH LINES, NON-US LINES, AND WHY A NAME STAYS UNMATCHED  (zzz797) ────
/** A broker cash / currency line is not a holding in any theme. */
export function isCashLine(ticker: string): boolean {
  const t = String(ticker || '').toUpperCase().trim();
  return /^(USD|EUR|GBP|CHF|JPY|INR|CAD|AUD|HKD|SGD|SEK|NOK|DKK|BASE|CASH|FX|MMF)$/.test(t) || /(^|[^A-Z])CASH([^A-Z]|$)/.test(t) || /\.CASH$/.test(t);
}

export interface SecProfileLite { status?: 'sec' | 'not-found' | 'error' | string; sic?: string | null; sicDescription?: string | null }

/** Why a holding has no theme, in words the owner can act on. */
export function unmatchedReason(e: ListEntry, region: 'us' | 'india', ctx: { profile?: SecProfileLite | null; industry?: string | null } = {}): string {
  if (region === 'india') {
    if (/^\d+$/.test(e.ticker)) return 'BSE numeric code — its industry cannot be looked up';
    const ind = ctx.industry || e.industry || e.sector;
    if (ind) return `industry "${ind}" has no theme on the board`;
    return 'no industry on file yet (looked up in the background, kept for good)';
  }
  const p = ctx.profile;
  if (p?.status === 'not-found') return 'the SEC does not list this ticker (a foreign or unlisted line?)';
  if (p?.status === 'error') return 'the SEC record could not be read this visit';
  if (p?.sic || p?.sicDescription) return `SEC industry "${p.sicDescription || 'unnamed'}" (SIC ${p.sic || '?'}) has no theme on the board`;
  const ind = e.industry || e.sector;
  if (ind) return `sector "${ind}" has no theme on the board`;
  return 'no sector, industry or SEC code on file yet';
}

export interface HoldingsExposure {
  total: number;
  themed: number;
  favoured: string[];
  atRisk: string[];
  crowded: string[];
  line: string;
  /** zzz797 — holdings left out of the counts (cash lines, non-US listings), with why. */
  excluded?: Array<{ ticker: string; reason: string }>;
  /** zzz797 — held names still without a theme. */
  unmatched?: string[];
}

/**
 * Where actual HOLDINGS sit against the board. `riskThemes` = themes rated
 * TRIM/AVOID or showing a breakdown; `crowdedThemes` = crowded flag.
 * zzz797 — cash lines and `excluded` lines (non-US listings) are left out of
 * the counts and listed separately with the reason.
 */
export function holdingsExposure(entries: ListEntry[], favoured: Set<string>, riskThemes: Set<string>, crowdedThemes: Set<string>, excludedIn: Map<string, string> = new Map()): HoldingsExposure {
  const allHeld = entries.filter((e) => e.held);
  const excluded = allHeld.filter((e) => excludedIn.has(e.ticker) || isCashLine(e.ticker))
    .map((e) => ({ ticker: e.ticker, reason: excludedIn.get(e.ticker) || 'cash / currency line' }));
  const exSet = new Set(excluded.map((x) => x.ticker));
  const held = allHeld.filter((e) => !exSet.has(e.ticker));
  const themed = held.filter((e) => e.theme);
  const favouredH = themed.filter((e) => favoured.has(e.theme!)).map((e) => e.ticker);
  const atRisk = themed.filter((e) => riskThemes.has(e.theme!)).map((e) => e.ticker);
  const crowded = themed.filter((e) => crowdedThemes.has(e.theme!)).map((e) => e.ticker);
  const unmatched = held.filter((e) => !e.theme).map((e) => e.ticker);
  const line = !held.length ? '' : `${held.length} holding${held.length === 1 ? '' : 's'}: ${favouredH.length} in themes rated BUY / EARLY BUY, ${atRisk.length} in themes rated TRIM / AVOID or breaking down, ${crowded.length} in crowded themes${unmatched.length ? `, ${unmatched.length} not matched to a theme` : ''}${excluded.length ? ` (${excluded.length} cash / non-US line${excluded.length === 1 ? '' : 's'} not counted)` : ''}.`;
  return { total: held.length, themed: themed.length, favoured: favouredH, atRisk, crowded, line, excluded, unmatched };
}
