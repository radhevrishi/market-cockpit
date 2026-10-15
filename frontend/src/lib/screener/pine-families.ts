// zzz1045a — the Pine Screener's screen families: the 65 built-in screens grouped into a few families (instead of one long list),
// with favourites first and a search. Pure + guarded storage, like the Stock Screener's picker (screen-picker.ts). Screen IDs, URL
// params and saved screens are never touched here — only how the list is shown.
// Also: the "pattern timeframe vs rule timeframe" note — with W / M pattern timeframes, the extra rules (RSI, averages, Donchian,
// setups …) are still read from DAILY figures unless the figure itself is weekly or monthly.
import { fieldOf, type Filter } from './filters';
import type { PineQuery, PineScreen } from './pine';

export type PineFamilyId = 'discovery' | 'bases' | 'breakouts' | 'portfolio' | 'trend' | 'r40' | 'setups' | 'volume';
export const PINE_FAMILIES: ReadonlyArray<{ id: PineFamilyId; label: string; hint: string }> = [
  { id: 'discovery', label: 'Pattern discovery', hint: 'Chart patterns of every kind — bullish and bearish' },
  { id: 'bases', label: 'Base builder', hint: 'Bases forming on daily, weekly and monthly bars' },
  { id: 'breakouts', label: 'Breakout monitor', hint: 'Recent breakouts, breakdowns and failed breakouts' },
  { id: 'portfolio', label: 'Portfolio monitor', hint: 'Patterns on your holdings' },
  { id: 'trend', label: 'Trend & leadership', hint: 'Trend template, RS, stages, averages and RSI' },
  { id: 'r40', label: 'Rule of 40', hint: 'Growth + FCF margin, alone or with a chart setup' },
  { id: 'setups', label: 'Trader setups', hint: 'Published traders’ setups, read from daily sessions' },
  { id: 'volume', label: 'Volume & accumulation', hint: 'Heavy buying or selling read from price and volume (completed sessions)' },   // zzz1046a
];

/** The screens named one by one; the rest go by their id prefix (pf-, ts-, r40-, tw-) or, failing that, their old group. */
const NAMED: Readonly<Record<string, PineFamilyId>> = {
  'all-bullish': 'discovery', 'all-bearish': 'discovery', 'broad-candidates': 'discovery', 'near-ready': 'discovery', 'oneil-bases': 'discovery',
  'minervini-vcp': 'discovery', 'flags-pennants': 'discovery', 'triangles-wedges': 'discovery', bottoms: 'discovery', 'bearish-tops': 'discovery',
  'bear-continuation': 'discovery',
  'bases-forming': 'bases', 'weekly-bases': 'bases', 'monthly-bases': 'bases', 'monthly-reversal-bases': 'bases', 'monthly-near-pivot': 'bases',
  'mtf-aligned': 'bases', 'wl-forming-bases': 'bases',
  'breakouts-today': 'breakouts', 'breakouts-holding': 'breakouts', 'breakouts-back-below': 'breakouts', 'failed-breakouts': 'breakouts', breakdowns: 'breakouts',
  'tv-rule-of-40': 'r40',
  'tv-trend-template': 'trend', 'rs-80': 'trend', 'stage-2': 'trend', 'stage-1-2': 'trend', 'tt-bullish-base': 'trend', 'rs80-stage2-forming': 'trend',
  'tv-golden-cross': 'trend', 'tv-death-cross': 'trend', 'tv-ema-cross-up': 'trend', 'pocket-pivot': 'trend', 'ripster-bull': 'trend', 'high-rvol': 'trend',
};

/** The family a built-in screen is listed under (always one). */
export function pineFamilyOf(s: Pick<PineScreen, 'id' | 'group'>): PineFamilyId {
  const id = s.id;
  if (NAMED[id]) return NAMED[id];
  if (id.startsWith('pf-')) return 'portfolio';
  if (id.startsWith('ts-')) return 'setups';
  if (id.startsWith('acc-') || id.startsWith('dist-') || id.startsWith('dlv-')) return 'volume';   // zzz1046a
  if (id.startsWith('r40-')) return 'r40';
  if (id.startsWith('tw-') || id.startsWith('tv-rsi-')) return 'trend';
  switch (s.group) {
    case 'portfolio': return 'portfolio';
    case 'setups': return 'setups';
    case 'volume': return 'volume';
    case 'r40': return 'r40';
    case 'tv': case 'momentum': return 'trend';
    default: return 'discovery';
  }
}

// ── favourites (a display preference kept in this browser) ─────────────────────────────────────────────────────────────
export const PINE_FAV_KEY = 'mc:pine-fav-screens:v1';
export function readPineFavs(): string[] {
  try { const v = JSON.parse(localStorage.getItem(PINE_FAV_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 200) : []; } catch { return []; }
}
export function writePineFavs(ids: readonly string[]): void { try { localStorage.setItem(PINE_FAV_KEY, JSON.stringify(ids.slice(0, 200))); } catch { /* display preference only */ } }
export function togglePineFav(ids: readonly string[], id: string): string[] { return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]; }

// ── search + grouping ───────────────────────────────────────────────────────────────────────────────────────────────────
const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const FAMILY_LABEL = new Map(PINE_FAMILIES.map((f) => [f.id, f.label] as const));
/** Every word of the query must appear in the screen's name or its family's name. */
export function matchesPineScreen(s: Pick<PineScreen, 'id' | 'name' | 'group'>, q: string, builtIn = true): boolean {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${norm(s.name)} ${builtIn ? norm(FAMILY_LABEL.get(pineFamilyOf(s)) || '') : 'made here'}`;
  return words.every((w) => hay.includes(w));
}
export interface PineFamilyGroup { id: 'fav' | 'mine' | PineFamilyId; label: string; screens: PineScreen[] }
/** Favourites first (built-in or made here, in list order), then each family in order, then the screens made here. Empty groups are left out. */
export function pineFamilyGroups(screens: readonly PineScreen[], builtInIds: ReadonlySet<string>, favs: readonly string[], q = ''): PineFamilyGroup[] {
  const fav = new Set(favs);
  const hit = screens.filter((s) => matchesPineScreen(s, q, builtInIds.has(s.id)));
  const out: PineFamilyGroup[] = [{ id: 'fav', label: 'Favourites', screens: hit.filter((s) => fav.has(s.id)) }];
  for (const f of PINE_FAMILIES) out.push({ id: f.id, label: f.label, screens: hit.filter((s) => builtInIds.has(s.id) && !fav.has(s.id) && pineFamilyOf(s) === f.id) });
  out.push({ id: 'mine', label: 'Made here', screens: hit.filter((s) => !builtInIds.has(s.id) && !fav.has(s.id)) });
  return out.filter((g) => g.screens.length);
}

// ── pattern timeframe vs rule timeframe ─────────────────────────────────────────────────────────────────────────────────
export type RuleTf = 'D' | 'W' | 'M' | 'company';
/** Figures read from weekly bars (weekly RSI, this week's change / volume, 3 weeks tight, weekly Donchian, Weinstein stage — 30-week
 *  average —, the TheWrap Stage Analysis) and from monthly bars (monthly RSI). Every other price / average / momentum / setup figure is daily. */
const WEEKLY_KEYS = new Set(['rsiW', 'chg1W', 'vol1W', 'wt3', 'wt3P', 'dc20W', 'stage', 'st12', 'twSt', 'twWk', 'sata', 'mrs', 'bigUpW', 'bigDnW']);
const MONTHLY_KEYS = new Set(['rsiM']);
const DAILY_GROUPS = new Set(['Price & volume', 'Moving averages', 'Momentum', 'Trader setups', 'Volume & accumulation']);
export function ruleKeyTf(key: string): RuleTf {
  if (WEEKLY_KEYS.has(key)) return 'W';
  if (MONTHLY_KEYS.has(key)) return 'M';
  const g = fieldOf(key)?.group;
  return g && DAILY_GROUPS.has(g) ? 'D' : 'company';
}
/** The bars a rule is read from: weekly / monthly when its figure is, daily for other price figures, 'company' for fundamentals. */
export function ruleTf(f: Filter): RuleTf | null {
  if (f.kind === 'num' || f.kind === 'date') return ruleKeyTf(f.key);
  if (f.kind === 'cmp' || f.kind === 'near') {
    const a = ruleKeyTf(f.key), b = ruleKeyTf(f.other);
    for (const t of ['M', 'W', 'D'] as const) if (a === t || b === t) return t;
    return 'company';
  }
  return null;   // sector / exchange / pattern rules: no figure timeframe
}
const TF_WORD = { D: 'Daily', W: 'Weekly', M: 'Monthly' } as const;
/** The note beside the Rules section, '' when the pattern timeframe is daily only (rules and patterns then agree). */
export function ruleTimeframeNote(q: Pick<PineQuery, 'tfs' | 'filters'>): string {
  const tfs = q.tfs.length ? q.tfs : ['D' as const];
  if (!tfs.some((t) => t !== 'D')) return '';
  const head = `Pattern timeframe: ${tfs.map((t) => TF_WORD[t]).join(' + ')}. Rules below use daily figures unless they say weekly or monthly.`;
  const on = q.filters.filter((f) => !f.off).map(ruleTf).filter((t): t is RuleTf => t != null);
  if (!on.length) return head;
  const n = (t: RuleTf) => on.filter((x) => x === t).length;
  const parts = [n('D') ? `${n('D')} daily` : '', n('W') ? `${n('W')} weekly` : '', n('M') ? `${n('M')} monthly` : '', n('company') ? `${n('company')} company figure${n('company') === 1 ? '' : 's'}` : ''].filter(Boolean);
  return `${head} Your rules: ${parts.join(', ')}.`;
}
/** The short part for the query summary line ('' when not needed): only when patterns are read on W / M and a rule uses daily figures. */
export function ruleTimeframeSummary(q: Pick<PineQuery, 'tfs' | 'filters'>): string {
  if (!q.tfs.some((t) => t !== 'D')) return '';
  return q.filters.some((f) => !f.off && ruleTf(f) === 'D') ? 'Rules on daily figures' : '';
}
