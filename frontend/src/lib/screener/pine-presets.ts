// zzz983 — built-in PINE SCREENS (data). Each one is a pattern set + stage + likelihood + pivot window + optional extra rules in
// the Stock Screener's filter language. Add a screen by adding an entry here (e.g. the owner's own TradingView Pine screens):
// an `id` (stable, used in saved choices), a `name`, an optional `note` (shown under the controls), an optional `market`
// (opens that market) and a `q` — any field left out of `q` takes DEFAULT_QUERY's value (see screen()).
import type { Filter } from './filters';
import { DEFAULT_QUERY, type PineQuery, type PineScreen } from './pine';

const screen = (id: string, name: string, q: Partial<PineQuery>, note?: string, market?: PineScreen['market']): PineScreen =>
  ({ id, name, q: { ...DEFAULT_QUERY, ...q, dist: { ...DEFAULT_QUERY.dist, ...(q.dist || {}) } }, builtIn: true, ...(note ? { note } : {}), ...(market ? { market } : {}) });

/** Minervini's trend template: price over the 50 / 150 / 200-day averages, stacked, within 25% of the 52-week high. */
const TREND_TEMPLATE: Filter[] = [
  { kind: 'cmp', key: 'px', op: 'above', other: 'sma50' },
  { kind: 'cmp', key: 'sma50', op: 'above', other: 'sma150' },
  { kind: 'cmp', key: 'sma150', op: 'above', other: 'sma200' },
  { kind: 'near', key: 'px', other: 'hi52', lo: -25, hi: 0 },
];
const ABOVE_200: Filter[] = [{ kind: 'cmp', key: 'px', op: 'above', other: 'sma200' }];
const BELOW_200: Filter[] = [{ kind: 'cmp', key: 'px', op: 'below', other: 'sma200' }];

export const BUILT_IN_PINE_SCREENS: readonly PineScreen[] = [
  screen('all-bullish', 'All bullish patterns', { bias: 'U' }, 'Every bullish pattern, forming or just broken out, likely or better, from 15% below the pivot to 5% above it.'),
  screen('all-bearish', 'All bearish patterns', { bias: 'D' }, 'Every bearish pattern, forming or just broken down, likely or better, from 15% above the breakdown level to 5% below it.'),
  screen('oneil-bases', "Bullish bases (O'Neil)", {
    bias: 'U', ids: ['flat_base', 'cup', 'cup_handle', 'u_base', 'ascending_base', 'base_on_base', 'ipo_base'], dist: { on: true, lo: -10, hi: 5 }, filters: ABOVE_200,
  }, "O'Neil's bases within 10% of the buy point (pivot), price above its 200-day average."),
  screen('minervini-vcp', 'Minervini VCP', { bias: 'U', ids: ['vcp'], dist: { on: true, lo: -8, hi: 5 }, filters: TREND_TEMPLATE },
    'Volatility contraction patterns in stocks that pass the trend template (price > 50 > 150 > 200-day averages, within 25% of the 52-week high).'),
  screen('breakouts-today', 'Breakouts (last 5 sessions)', { bias: 'U', stages: ['b'], dist: { on: true, lo: 0, hi: 8 } },
    'Bullish patterns whose first close above the pivot came in the last 5 sessions, still no more than 8% above it.'),
  screen('flags-pennants', 'Flags & pennants', { bias: 'U', ids: ['bull_flag', 'bull_pennant', 'high_tight_flag'], dist: { on: true, lo: -10, hi: 5 } },
    'Bull flags, pennants and high tight flags — short pauses after a sharp rise.'),
  screen('triangles-wedges', 'Ascending triangles & falling wedges', { bias: 'U', ids: ['ascending_triangle', 'falling_wedge'] }),
  screen('bottoms', 'Reversal bottoms', { bias: 'U', ids: ['double_bottom', 'triple_bottom', 'inverse_hs', 'falling_wedge'], minConf: 55 },
    'Double / triple bottoms, inverse head & shoulders and falling wedges after a fall.'),
  screen('bearish-tops', 'Bearish tops', { bias: 'D', ids: ['double_top', 'triple_top', 'head_shoulders'] },
    'Double / triple tops and head & shoulders tops after a rise — names to avoid or trim.'),
  screen('breakdowns', 'Breakdowns (last 5 sessions)', { bias: 'D', stages: ['b'], dist: { on: true, lo: 0, hi: 10 }, filters: BELOW_200 },
    'Bearish patterns that closed through the breakdown level in the last 5 sessions, price below its 200-day average.'),
  screen('bear-continuation', 'Bear flags, descending triangles & rising wedges', { bias: 'D', ids: ['bear_flag', 'descending_triangle', 'rising_wedge'] }),
  screen('failed-breakouts', 'Failed breakouts', { bias: 'U', stages: ['x'], dist: { on: false, lo: -30, hi: 5 } },
    'Bullish patterns that broke out in the last 40 sessions and fell more than 7.5% back through the pivot — a warning sign.'),
];
