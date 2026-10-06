// zzz912 — US EARNINGS WATCH: which of the latest US results are worth an alert, and the words of that alert.
//
// Replaces two Claude scheduled tasks (US-hours sweep + late after-close sweep). Rules only, no AI:
//   • rows graded BLOCKBUSTER or STRONG by /api/v1/earnings/graded-us
//   • that the US Conviction Beats page would show under its Quality Preset + "Under $30B" cap band — the SAME
//     check the page runs (usCbCriteriaCheck with usPresetFilters()): a name that fails a gate on real data is out;
//     a name only missing a figure (e.g. cash flow before the 10-Q) is kept and the alert says what was not checked
//   • small/mid caps only: market cap must be known and under $30B (the preset's $300M floor still applies)
// Ranked BLOCKBUSTER first, then by score. Each company + report date is alerted once (owner-notify keys).
// PURE: no fetch, no KV, no env.

import {
  usBenchFields, usCbCriteriaCheck, usPresetFilters, usVerdict, usVerdictWord, usPeadWord, US_CB_U30_MUSD,
  type UsConvictionEntry, type UsConvFilters,
} from '@/lib/conviction-beats-us';

export const US_WATCH_KEY_PREFIX = 'us-earnings';
export const US_WATCH_FILTERS: UsConvFilters = { ...usPresetFilters(), cap: 'u30' };

export interface UsWatchPick {
  key: string;
  entry: UsConvictionEntry;
  row: any;
  /** 'pass' = every gate checked; 'unknown' = passed what could be checked */
  state: 'pass' | 'unknown';
  notChecked: string[];
}

const TIER_RANK: Record<string, number> = { BLOCKBUSTER: 2, STRONG: 1 };
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const usWatchKey = (ticker: string, filingDate: string) =>
  `${US_WATCH_KEY_PREFIX}:${String(ticker).toUpperCase()}:${String(filingDate).slice(0, 10)}`;

/** The alert-worthy rows of one graded-us payload, ranked. */
export function pickUsWatchRows(payload: any, filters: UsConvFilters = US_WATCH_FILTERS): UsWatchPick[] {
  const best = new Map<string, UsWatchPick>();
  for (const tier of ['BLOCKBUSTER', 'STRONG']) {
    for (const row of (payload?.by_tier?.[tier] || []) as any[]) {
      if (!row?.ticker || !row?.filing_date) continue;
      const entry = { ...(usBenchFields(row) as any), tier } as UsConvictionEntry;
      const cap = n(entry.market_cap_musd);
      if (cap == null || cap >= US_CB_U30_MUSD) continue;              // small / mid caps only
      const check = usCbCriteriaCheck(entry, filters);
      if (check.state === 'fail') continue;
      const pick: UsWatchPick = { key: usWatchKey(entry.ticker, entry.filing_date), entry, row, state: check.state, notChecked: check.missing };
      const prev = best.get(entry.ticker);
      if (!prev || entry.filing_date > prev.entry.filing_date
        || (entry.filing_date === prev.entry.filing_date && (TIER_RANK[tier] || 0) > (TIER_RANK[prev.entry.tier] || 0))) best.set(entry.ticker, pick);
    }
  }
  return Array.from(best.values()).sort((a, b) =>
    (TIER_RANK[b.entry.tier] || 0) - (TIER_RANK[a.entry.tier] || 0)
    || (n(b.entry.composite_score) ?? 0) - (n(a.entry.composite_score) ?? 0)
    || (n(b.entry.pead_score) ?? 0) - (n(a.entry.pead_score) ?? 0)
    || a.entry.ticker.localeCompare(b.entry.ticker));
}

const pct = (v: number | null) => (v == null ? 'not known' : `${v >= 0 ? '+' : ''}${Math.round(v)}%`);
export function fmtCapMusd(v: number | null): string {
  if (v == null) return 'not known';
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M`;
}
const money = (v: number | null) => (v == null ? null : `$${v.toFixed(2)}`);

/** EPS against what analysts expected, in plain words. */
export function epsVsExpected(e: UsConvictionEntry): string {
  const actual = n((e as any).eps_adj_curr) ?? n((e as any).eps_adj) ?? n(e.eps_curr);
  const est = (e as any).eps_basis_note ? null : n((e as any).eps_estimate);
  if (actual == null) return 'EPS not known yet';
  if (est == null) return `EPS ${money(actual)} (no analyst estimate)`;
  const word = actual > est ? 'beat' : actual < est ? 'missed' : 'matched';
  return `EPS ${money(actual)} vs ${money(est)} expected (${word})`;
}

const GUIDE_WORDS: Record<string, string> = {
  RAISED: 'raised', MAINTAINED: 'kept the same', LOWERED: 'cut', PROVIDED: 'given (first time)', WITHDRAWN: 'withdrawn',
};

/** The day-after move, in plain words. */
export function reactionWords(e: UsConvictionEntry): string {
  const d1 = n((e as any).d1_pct), gap = n((e as any).gap_pct), mv = n((e as any).move_pct);
  if (d1 != null) return `stock ${pct(d1)} on day 1${mv != null && Math.abs(mv - d1) >= 1 ? `, ${pct(mv)} since` : ''}`;
  if (gap != null) return `stock opened ${pct(gap)}`;
  return 'no price reaction yet';
}

/** One-line verdict: the quality word and the main reasons. */
export function verdictLine(p: UsWatchPick): string {
  const v = usVerdict(p.entry);
  const why = v.reasons.slice(0, 3).join(', ');
  return `${usVerdictWord(v.verdictLabel)}${why ? ` — ${why}` : ''}.`;
}

/** The alert text for the given picks (already ranked). */
export function formatUsWatchMessage(picks: UsWatchPick[], ctx: { date: string; windowStart?: string | null }): { subject: string; text: string } {
  const names = picks.map((p) => p.entry.ticker);
  const subject = `US results alert: ${picks.length} new name${picks.length === 1 ? '' : 's'} (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''})`;
  const lines: string[] = [
    `New US results that pass your quality check (small and mid caps, under $30B). Best first.`,
    `Results filed ${ctx.windowStart && ctx.windowStart !== ctx.date ? `${ctx.windowStart} to ${ctx.date}` : ctx.date} (SEC filing dates).`,
    '',
  ];
  picks.forEach((p, i) => {
    const e = p.entry as any;
    lines.push(`${i + 1}. ${e.ticker} — ${e.company}`);
    lines.push(`   Grade: ${e.tier}, score ${Math.round(n(e.composite_score) ?? 0)}. Quarter: ${e.quarter || 'not known'}${e.fiscal_year && !(String(e.quarter || '').includes('FY')) ? ` ${e.fiscal_year}` : ''}.`);
    lines.push(`   Sales ${pct(n(e.sales_yoy_pct))} vs last year. EPS ${pct(n(e.eps_yoy_pct))}${e.eps_swing === 'loss-to-profit' ? ' (loss turned to profit)' : ''}. ${epsVsExpected(e)}.`);
    lines.push(`   Outlook: ${e.guidance ? GUIDE_WORDS[e.guidance] || String(e.guidance).toLowerCase() : 'no outlook found'}. Drift score ${n(e.pead_score) ?? 'not known'} (${usPeadWord(n(e.pead_score))}). Market reaction: ${reactionWords(e)}.`);
    lines.push(`   Market cap ${fmtCapMusd(n(e.market_cap_musd))}. Filed ${e.filing_date}.`);
    lines.push(`   Verdict: ${verdictLine(p)}`);
    if (e.prelim) lines.push('   PRELIM: these figures come from the press release. They are replaced when the 10-Q is filed.');
    if (p.state === 'unknown' && p.notChecked.length) lines.push(`   Not checked yet (data missing): ${p.notChecked.join('; ')}.`);
    if (p.row?.filing_url) lines.push(`   SEC filing: ${p.row.filing_url}`);
    lines.push('');
  });
  lines.push('This is a rules check, not advice. Open US Conviction Beats in Market Cockpit for the full card.');
  return { subject, text: lines.join('\n') };
}
