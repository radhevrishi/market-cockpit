// zzz983 — built-in PINE SCREENS (data). zzz994: screens named after the owner's TradingView scripts say "based on your TradingView
// script" — our own implementation of the published rules, not a certified copy of the script; IDs never change.
// Each one is a pattern set + stage + likelihood + pivot window + optional extra rules in
// the Stock Screener's filter language. Add a screen by adding an entry here (e.g. the owner's own TradingView Pine screens):
// an `id` (stable, used in saved choices), a `name`, an optional `note` (shown under the controls), an optional `market`
// (opens that market) and a `q` — any field left out of `q` takes DEFAULT_QUERY's value (see screen()).
import type { Filter, NumKey } from './filters';
import { DEFAULT_QUERY, type PineGroup, type PineQuery, type PineScreen } from './pine';

type Opts = { note?: string; market?: PineScreen['market']; group?: PineGroup; scope?: string };
const screen = (id: string, name: string, q: Partial<PineQuery>, o: Opts | string = {}): PineScreen => {
  const opt: Opts = typeof o === 'string' ? { note: o } : o;
  return {
    id, name, q: { ...DEFAULT_QUERY, ...q, dist: { ...DEFAULT_QUERY.dist, ...(q.dist || {}) } }, builtIn: true, group: opt.group || 'patterns',
    ...(opt.note ? { note: opt.note } : {}), ...(opt.market ? { market: opt.market } : {}), ...(opt.scope !== undefined ? { scope: opt.scope } : {}),
  };
};
/** A screen decided by rules alone (no chart pattern needed); bullish and bearish patterns are still shown next to each company. */
const rules = (id: string, name: string, filters: Filter[], cols: NumKey[], group: PineGroup, note: string, q: Partial<PineQuery> = {}): PineScreen =>
  screen(id, name, { bias: 'both', need: 'any', stages: ['f', 'b'], minConf: 55, dist: { on: false, lo: -15, hi: 5 }, filters, cols, ...q }, { note, group });
const ge = (key: NumKey, v: number): Filter => ({ kind: 'num', key, op: 'ge', v });
const le = (key: NumKey, v: number): Filter => ({ kind: 'num', key, op: 'le', v });
const eq = (key: NumKey, v: number): Filter => ({ kind: 'num', key, op: 'between', v, v2: v });

/** zzz984 — his own "minervni script" (Minervini trend template, all six rules) — computed field ttOk (tv-screens.ts). */
const TREND_TEMPLATE: Filter[] = [ge('ttOk', 1)];
/** zzz987 — Stage Analysis (TheWrap method) columns and the note every one of its screens starts with. */
const TW_COLS: NumKey[] = ['twSt', 'sata', 'mrs', 'twWk', 'rsR'];
const TW_NOTE = 'Stage Analysis (TheWrap method) — our own version that follows the published rules (weekly 10/30/40-week averages, 13-week closing range, SATA score, Mansfield RS vs the index); not the original script.';
/** zzz999 — the bullish base family (O'Neil bases + VCP) used by the setup cards. */
const BASE_IDS: PineQuery['ids'] = ['flat_base', 'cup', 'cup_handle', 'u_base', 'ascending_base', 'base_on_base', 'ipo_base', 'vcp'];
/** zzz1004 — the monthly families: bases read on M (U / rounding base, cup, VCP — the base types the engine reads on monthly bars) and
 *  reversal bases (double / triple bottom, inverse H&S), counted apart. */
export const MONTHLY_BASE_IDS: PineQuery['ids'] = ['u_base', 'cup', 'vcp'];
export const MONTHLY_REVERSAL_IDS: PineQuery['ids'] = ['double_bottom', 'triple_bottom', 'inverse_hs'];
/** zzz1007 — the Rule of 40 columns and the sentence every Rule of 40 screen starts with. */
const R40_COLS: NumKey[] = ['r40', 'revQYoY', 'fcfmTTM'];
const R40_NOTE = 'Rule of 40 ≥ 40: latest quarter revenue growth YoY + FCF margin (your TradingView script). Left blank — so the company does not pass — when growth is above +300% or the FCF margin is outside −100% to +100% (a tiny sales base).';
const ABOVE_200: Filter[] = [{ kind: 'cmp', key: 'px', op: 'above', other: 'sma200' }];
const BELOW_200: Filter[] = [{ kind: 'cmp', key: 'px', op: 'below', other: 'sma200' }];

export const BUILT_IN_PINE_SCREENS: readonly PineScreen[] = [
  // ── chart patterns (zzz983) ─────────────────────────────────────────────────────────────────────────────────────────
  screen('all-bullish', 'All bullish patterns', { bias: 'U' }, 'Every bullish pattern, forming or just broken out, likely or better, from 15% below the pivot to 5% above it.'),
  screen('all-bearish', 'All bearish patterns', { bias: 'D' }, 'Every bearish pattern, forming or just broken down, likely or better, from 15% above the breakdown level to 5% below it.'),
  screen('oneil-bases', "Bullish bases (O'Neil)", {
    bias: 'U', ids: ['flat_base', 'cup', 'cup_handle', 'u_base', 'ascending_base', 'base_on_base', 'ipo_base'], dist: { on: true, lo: -10, hi: 5 }, filters: ABOVE_200,
  }, "O'Neil's bases within 10% of the buy point (pivot), price above its 200-day average."),
  screen('minervini-vcp', 'Minervini VCP', { bias: 'U', ids: ['vcp'], dist: { on: true, lo: -8, hi: 5 }, filters: TREND_TEMPLATE, cols: ['tt', 'rsR'] },
    'Volatility contraction patterns in stocks that pass all six rules of your Minervini trend-template script.'),
  screen('breakouts-today', 'Breakouts (last 5 sessions)', { bias: 'U', stages: ['b'], dist: { on: true, lo: 0, hi: 8 }, returned: false },
    'Bullish patterns whose first close above the pivot came in the last 5 sessions, still no more than 8% above it.'),
  screen('flags-pennants', 'Flags & pennants', { bias: 'U', ids: ['bull_flag', 'bull_pennant', 'high_tight_flag'], dist: { on: true, lo: -10, hi: 5 } },
    'Bull flags, pennants and high tight flags — short pauses after a sharp rise.'),
  screen('triangles-wedges', 'Ascending triangles & falling wedges', { bias: 'U', ids: ['ascending_triangle', 'falling_wedge'] }),
  screen('bottoms', 'Reversal bottoms', { bias: 'U', ids: ['double_bottom', 'triple_bottom', 'inverse_hs', 'falling_wedge'], minConf: 55 },
    'Double / triple bottoms, inverse head & shoulders and falling wedges after a fall.'),
  screen('bearish-tops', 'Bearish tops', { bias: 'D', ids: ['double_top', 'triple_top', 'head_shoulders'] },
    'Double / triple tops and head & shoulders tops after a rise — names to avoid or trim.'),
  screen('breakdowns', 'Breakdowns (last 5 sessions)', { bias: 'D', stages: ['b'], dist: { on: true, lo: 0, hi: 10 }, filters: BELOW_200, returned: false },
    'Bearish patterns that closed through the breakdown level in the last 5 sessions, price below its 200-day average.'),
  screen('bear-continuation', 'Bear flags, descending triangles & rising wedges', { bias: 'D', ids: ['bear_flag', 'descending_triangle', 'rising_wedge'] }),
  // zzz994 — two clearly different "all patterns" sizes: a broad candidate list and a near-ready list
  screen('broad-candidates', 'Broad candidates (possible+, all bullish types)', { bias: 'U', minConf: 35, dist: { on: true, lo: -25, hi: 5 } },
    'Every bullish pattern type with a shape score of 35 or more (possible or better), forming or just broken out, from 25% below the pivot to 5% above — a wide first pass.'),
  screen('near-ready', 'Near-ready setups (likely+, within 5% of the pivot)', { bias: 'U', stages: ['f'], minConf: 55, dist: { on: true, lo: -5, hi: 0 } },
    'Bullish patterns still forming, shape score likely or better (≥ 55), with the scan close 0–5% below the pivot.'),
  // zzz999 — the setup cards' own screens (the cards at the top of the page start from these)
  screen('bases-forming', 'Bases forming', { bias: 'U', ids: BASE_IDS, stages: ['f'], dist: { on: true, lo: -15, hi: 0 } },
    "Bullish bases (O'Neil bases and VCPs) still forming, likely or better, with the scan close up to 15% below the pivot."),
  screen('weekly-bases', 'Weekly bases', { bias: 'U', ids: BASE_IDS, tfs: ['W'], stages: ['f', 'b'], dist: { on: true, lo: -20, hi: 5 }, returned: false },
    'Bullish bases read on completed weekly bars, forming or just broken out — longer, slower setups.'),
  // zzz1004 — Monthly Bases (completed calendar months only). Bases and reversal bases are kept apart (counted separately);
  // no pivot window by default (broad discovery) — the near-pivot variant is its own screen.
  screen('monthly-bases', 'Monthly bases', { bias: 'U', ids: MONTHLY_BASE_IDS, tfs: ['M'], stages: ['f', 'b'], dist: { on: false, lo: -25, hi: 5 }, returned: false },
    'U / rounding bases, cups and VCPs read on completed monthly bars, forming or broken out in the last completed month(s) — no pivot limit. A monthly reading needs at least 24 monthly bars; a long (up to 60-month) U base needs more history than that.'),
  screen('monthly-reversal-bases', 'Monthly reversal bases', { bias: 'U', ids: MONTHLY_REVERSAL_IDS, tfs: ['M'], stages: ['f', 'b'], dist: { on: false, lo: -25, hi: 5 }, returned: false },
    'Double / triple bottoms and inverse head & shoulders on completed monthly bars — reversals, counted apart from the bases. No pivot limit.'),
  screen('monthly-near-pivot', 'Monthly bases near the pivot', { bias: 'U', ids: MONTHLY_BASE_IDS, tfs: ['M'], stages: ['f', 'b'], dist: { on: true, lo: -10, hi: 5 }, returned: false },
    'The monthly bases whose last completed monthly close is from 10% below the pivot to 5% above it.'),
  screen('failed-breakouts', 'Failed breakouts', { bias: 'U', stages: ['x'], dist: { on: false, lo: -30, hi: 5 } },
    'Bullish patterns that broke out in the last 40 sessions and fell more than 7.5% back through the pivot — a warning sign.'),

  // ── zzz1004: portfolio workflows (holdings only — the screen carries its company list). Risk review is about recall: every
  // bearish pattern, forming or broken down, on D / W / M, possible or better, NO pivot window, size, liquidity or extra rule, so a
  // support broken long ago is not hidden. Holdings without a match are listed beside the result as coverage rows. ────────
  screen('pf-bearish-risks', 'Portfolio · bearish risks', { bias: 'D', tfs: ['D', 'W', 'M'], tfMode: 'any', stages: ['f', 'b'], minConf: 35, dist: { on: false, lo: -15, hi: 5 } },
    { group: 'portfolio', scope: 'pf', note: 'Every bearish pattern on your holdings — forming or broken down, daily / weekly / monthly, shape score 35 or more (weaker ones are marked possible), no distance, size or liquidity limit. Holdings with no bearish pattern, no scan or no data are listed below the table.' }),
  screen('pf-bullish-opps', 'Portfolio · bullish opportunities', { bias: 'U', tfs: ['D', 'W', 'M'], tfMode: 'any', stages: ['f', 'b'], minConf: 35, dist: { on: false, lo: -25, hi: 5 } },
    { group: 'portfolio', scope: 'pf', note: 'Every bullish pattern on your holdings — forming or broken out, daily / weekly / monthly, shape score 35 or more, no distance limit (readiness is shown per row, not required).' }),
  screen('pf-failed-bearish', 'Portfolio · recovering from failed bearish', { bias: 'D', tfs: ['D', 'W', 'M'], tfMode: 'any', stages: ['x'], minConf: 35, dist: { on: false, lo: -30, hi: 5 } },
    { group: 'portfolio', scope: 'pf', note: 'Bearish patterns on your holdings that broke down and then rose more than 7.5% back through the breakdown level — a recovery view, kept apart from the active risks.' }),

  // ── zzz984: his own TradingView scripts / the indicators in his Pine Screener ───────────────────────────────────────
  rules('tv-trend-template', 'Minervini Trend Template (based on your TradingView script)', TREND_TEMPLATE, ['tt', 'rsR', 'stage'], 'tv',
    'Your "minervni script": close > SMA 50 > SMA 150 > SMA 200, SMA 200 rising on each of the last 20 sessions, close > 1.3 × the 250-session low and > 0.75 × the 250-session high — all six rules.'),
  // zzz1007 — the Rule of 40 is back on the Pine Screener (owner: "should work with different combinations"). The old id is kept, so a
  // page that last had it open opens it again; the Stock Screener keeps its own copies ('tv-rule-of-40' / 'tv-rule-of-40-in').
  rules('tv-rule-of-40', 'Rule of 40 (based on your TradingView script)', [], R40_COLS, 'tv', `${R40_NOTE} Rules only: any chart pattern is shown beside the company.`, { r40Min: 40 }),
  rules('tv-rsi-cross', 'RSI crossed above its average', [le('rsiX', 9)], ['rsiMA', 'rsiX'], 'tv',
    'Your RSI script: RSI 14 crossed above its 14-session average in the last 10 sessions.'),
  rules('tv-rsi-50', 'RSI > 50 and above its average', [{ kind: 'num', key: 'rsi', op: 'gt', v: 50 }, { kind: 'cmp', key: 'rsi', op: 'above', other: 'rsiMA' }], ['rsiMA', 'rsiX'], 'tv',
    'Your RSI script: RSI 14 above the 50 line and above its own 14-session average.'),
  rules('tv-golden-cross', 'Golden cross (last 20 days)', [le('gcD', 19)], ['gcD'], 'tv', 'MA Cross: SMA 50 crossed above SMA 200 in the last 20 sessions.'),
  rules('tv-death-cross', 'Death cross (last 20 days)', [le('dcD', 19)], ['dcD'], 'tv', 'MA Cross: SMA 50 crossed below SMA 200 in the last 20 sessions.'),
  // zzz987 — Stage Analysis (TheWrap method): our own version following the published rules of Tar_H's invite-only
  // "TheWrap🌯 Stage Analysis" (lib/stage-analysis.ts) — not the original script, so readings can differ from TradingView.
  rules('tw-stage2-sata6', 'Stage 2 · SATA ≥ 6 (TheWrap method)', [eq('twSt', 2), ge('sata', 6)], TW_COLS, 'tv',
    `${TW_NOTE} Stage 2 (advancing) with a SATA score of 6 or more out of 10.`),
  rules('tw-fresh-stage2', 'Fresh Stage 2 (≤ 4 weeks, TheWrap method)', [eq('twSt', 2), le('twWk', 4)], TW_COLS, 'tv',
    `${TW_NOTE} Stage 2 that began in the last 4 weeks: a close above the 13-week range high and the 40-week average with SATA ≥ 6.`),
  rules('tw-stage4-sata3', 'Stage 4 · SATA ≤ 3 (TheWrap method)', [eq('twSt', 4), le('sata', 3)], TW_COLS, 'tv',
    `${TW_NOTE} Stage 4 (declining) with a SATA score of 3 or less — names to avoid or short.`),
  rules('tw-stage1-bases', 'Stage 1 bases (TheWrap method)', [eq('twSt', 1)], TW_COLS, 'tv',
    `${TW_NOTE} Stage 1 (basing): after Stage 4, price back above its 30-week average while the 40-week average is still falling.`),
  rules('tv-ema-cross-up', 'EMA 10/21 cross up (last 5 days)', [le('emaXU', 4)], ['emaXU'], 'tv', 'MA Cross: EMA 10 crossed above EMA 21 in the last 5 sessions.'),

  // ── zzz984: momentum & trend (his favourite indicators) ───────────────────────────────────────────────────────────────
  rules('rs-80', 'RS Rating ≥ 80', [ge('rsR', 80)], ['rsR', 'stage'], 'momentum',
    'IBD-style RS Rating (Fred6724): 0.4 × 3-month + 0.2 × 6, 9 and 12-month performance, ranked 1–99 against every company of this market.'),
  rules('stage-2', 'Stage 2 uptrend', [eq('stage', 2)], ['stage', 'rsR'], 'momentum', 'Weinstein stage 2: price above a rising 30-week average.'),
  rules('stage-1-2', 'Stage 1 → 2 transition', [ge('st12', 1)], ['stage', 'rsR'], 'momentum', 'Weinstein stage 2 now, stage 1 within the previous 6 weeks — a fresh advance out of a base.'),
  rules('pocket-pivot', 'Pocket pivot (last 5 days)', [le('ppD', 4)], ['ppD', 'rvol'], 'momentum',
    'Volume pocket pivot (TAPLOT): an up day with more volume than any down day of the previous 10 sessions, closing above its 10 and 50-day averages.'),
  rules('ripster-bull', 'Ripster clouds bullish', [ge('ripB', 1)], ['ripB'], 'momentum', 'Ripster EMA clouds: close above EMA 34 / 50 with EMA 5 and 12 above both.'),
  rules('high-rvol', 'High relative volume (≥ 2×)', [ge('rvol', 2)], ['rvol', 'adv$'], 'momentum', 'Swing data: the last session traded at least twice its 50-session average volume.'),
  screen('tt-bullish-base', 'Trend Template + bullish base (likely+)', {
    bias: 'U', ids: ['flat_base', 'cup', 'cup_handle', 'u_base', 'ascending_base', 'base_on_base', 'ipo_base', 'vcp'], minConf: 55, filters: TREND_TEMPLATE, cols: ['tt', 'rsR', 'stage'],
  }, { group: 'momentum', note: 'All six trend-template rules pass AND a bullish base (O\'Neil bases or VCP) is forming or just broke out, likely or better.' }),
  // ── zzz1007: Rule of 40 + chart setups (the Rule of 40 control — growth + FCF margin — combined with a pattern part) ─────────
  screen('r40-bullish', 'Rule of 40 · bullish patterns', { bias: 'U', tfs: ['D', 'W', 'M'], tfMode: 'any', stages: ['f', 'b'], minConf: 55, r40Min: 40, cols: R40_COLS.slice() },
    { group: 'r40', note: `${R40_NOTE} With a bullish pattern on the daily, weekly or monthly bars (any), forming or just broken out, likely or better, from 15% below the pivot to 5% above it.` }),
  screen('r40-ready', 'Rule of 40 · ready to break out', { bias: 'U', stages: ['f'], minConf: 55, dist: { on: true, lo: -5, hi: 0 }, r40Min: 40, cols: R40_COLS.slice() },
    { group: 'r40', note: `${R40_NOTE} With a bullish pattern still forming, likely or better, the scan close 0–5% below the pivot.` }),
  screen('r40-weekly-bases', 'Rule of 40 · Weekly bases', { bias: 'U', ids: BASE_IDS, tfs: ['W'], stages: ['f', 'b'], dist: { on: true, lo: -20, hi: 5 }, r40Min: 40, cols: R40_COLS.slice() },
    { group: 'r40', note: `${R40_NOTE} With a bullish base (O'Neil bases or VCP) on completed weekly bars, forming or just broken out.` }),
  screen('rs80-stage2-forming', 'RS ≥ 80 + Stage 2 + pattern forming', {
    bias: 'U', stages: ['f'], minConf: 55, filters: [ge('rsR', 80), eq('stage', 2)], cols: ['rsR', 'stage', 'tt'],
  }, { group: 'momentum', note: 'Leaders (RS Rating 80+) in a stage 2 uptrend with a bullish pattern still forming.' }),
];
