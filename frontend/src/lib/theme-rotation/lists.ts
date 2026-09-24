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

export interface RawListRow { symbol?: string; ticker?: string; sector?: string | null; industry?: string | null; company?: string | null; name?: string | null; grade?: string | null }
export interface RawBenchRow { ticker: string; company?: string | null; sector?: string | null; industry?: string | null; tier?: string | null; filing_date?: string | null; pe?: number | null; url?: string | null }

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
  for (const r of tech) { const e = get(r.symbol ?? r.ticker); if (!e) continue; e.inTech = true; e.sector ||= r.sector; e.industry ||= r.industry; e.company ||= r.company || r.name; }
  for (const r of fundo) { const e = get(r.symbol ?? r.ticker); if (!e) continue; e.inFundo = true; e.sector ||= r.sector; e.industry ||= r.industry; e.company ||= r.company || r.name; if (r.grade) e.grade = r.grade; }
  for (const b of bench) {
    const e = get(b.ticker); if (!e) continue;
    e.inBench = true; e.sector ||= b.sector; e.industry ||= b.industry; e.company ||= b.company;
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

export interface HoldingsExposure {
  total: number;
  themed: number;
  favoured: string[];
  atRisk: string[];
  crowded: string[];
  line: string;
}

/**
 * Where actual HOLDINGS sit against the board. `riskThemes` = themes rated
 * TRIM/AVOID or showing a breakdown; `crowdedThemes` = crowded flag.
 */
export function holdingsExposure(entries: ListEntry[], favoured: Set<string>, riskThemes: Set<string>, crowdedThemes: Set<string>): HoldingsExposure {
  const held = entries.filter((e) => e.held);
  const themed = held.filter((e) => e.theme);
  const favouredH = themed.filter((e) => favoured.has(e.theme!)).map((e) => e.ticker);
  const atRisk = themed.filter((e) => riskThemes.has(e.theme!)).map((e) => e.ticker);
  const crowded = themed.filter((e) => crowdedThemes.has(e.theme!)).map((e) => e.ticker);
  const line = !held.length ? '' : `${held.length} holding${held.length === 1 ? '' : 's'}: ${favouredH.length} in themes rated BUY / EARLY BUY, ${atRisk.length} in themes rated TRIM / AVOID or breaking down, ${crowded.length} in crowded themes${held.length - themed.length ? `, ${held.length - themed.length} not matched to a theme` : ''}.`;
  return { total: held.length, themed: themed.length, favoured: favouredH, atRisk, crowded, line };
}
