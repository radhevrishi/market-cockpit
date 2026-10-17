// zzz1061 — what the Create alert dialog shows for each condition: the six groups (a grouped dropdown), the name in the list,
// a short description with WHEN it updates, and the one-click templates. Pure (the dialog and the tests use it).
import { SIGNAL_META } from './signals';
import { parseMid, toMid } from './types';
import type { AlertCondition, AlertTarget, CondType } from './types';

export const COND_GROUPS: ReadonlyArray<{ label: string; types: CondType[] }> = [
  { label: 'Price', types: ['price_cross', 'price_cross_up', 'price_cross_down', 'price_above', 'price_below', 'move_up_pct', 'move_down_pct', 'gap_up', 'gap_down', 'high_52w', 'low_52w', 'near_52w_high'] },
  { label: 'Moving averages & momentum', types: ['ma_cross', 'ma_cross_up', 'ma_cross_down', 'rsi_cross_up', 'rsi_cross_down'] },
  { label: 'Stage Analysis', types: ['stage_2', 'stage_to', 'stage2_weak', 'stage_1_to_2', 'sata_cross_up', 'sata_cross_down', 'mrs_cross_up'] },
  { label: 'Setups & patterns', types: ['cheat_any', 'cheat_50', 'cheat_200', 'cheat_support', 'pattern_breakout', 'pattern_near_pivot', 'tight_3w', 'darvas_breakout', 'donchian_20', 'donchian_55', 'squeeze_up', 'episodic_pivot', 'pocket_pivot', 'trend_template', 'rs_rating'] },
  { label: 'Volume & accumulation', types: ['rel_volume', 'acc_ab', 'dist_warn', 'vol_breakout'] },
  { label: 'Fundamentals & results', types: ['result_strong', 'result_blockbuster', 'guidance_raised'] },
];

const LIVE = 'Checked every minute with the live price while the market is open.';
const DAILY_LIVE = 'Checked every minute: daily bars with today’s live price as the current bar.';
const PRICE_HELP: Partial<Record<CondType, { name: string; desc: string; updates: string }>> = {
  price_cross: { name: 'Price — crossing', desc: 'Price moves through the level, either way.', updates: LIVE },
  price_cross_up: { name: 'Price — crossing up', desc: 'Price moves from at / under the level to above it.', updates: LIVE },
  price_cross_down: { name: 'Price — crossing down', desc: 'Price moves from at / above the level to under it.', updates: LIVE },
  price_above: { name: 'Price — greater than', desc: 'Price is above the level.', updates: LIVE },
  price_below: { name: 'Price — less than', desc: 'Price is under the level.', updates: LIVE },
  move_up_pct: { name: 'Moving up %', desc: 'Price is up at least this % from the close N bars ago (1 bar = since the previous close).', updates: LIVE },
  move_down_pct: { name: 'Moving down %', desc: 'Price is down at least this % from the close N bars ago.', updates: LIVE },
  gap_up: { name: 'Gap up % at the open', desc: 'Today’s open is at least this % above the previous close.', updates: 'Checked after the open, from today’s daily bar.' },
  gap_down: { name: 'Gap down % at the open', desc: 'Today’s open is at least this % under the previous close.', updates: 'Checked after the open, from today’s daily bar.' },
  high_52w: { name: 'New 52-week high', desc: 'Today’s high goes above the highest high of the last 52 weeks.', updates: DAILY_LIVE },
  low_52w: { name: 'New 52-week low', desc: 'Today’s low goes under the lowest low of the last 52 weeks.', updates: DAILY_LIVE },
  near_52w_high: { name: 'Within % of the 52-week high', desc: 'Price is no more than this % under the 52-week high.', updates: DAILY_LIVE },
  ma_cross: { name: 'Price crossing a moving average', desc: 'Price moves through a daily SMA / EMA, either way.', updates: DAILY_LIVE },
  ma_cross_up: { name: 'Price crossing up a moving average', desc: 'Price moves from under a daily SMA / EMA to above it.', updates: DAILY_LIVE },
  ma_cross_down: { name: 'Price crossing down a moving average', desc: 'Price moves from above a daily SMA / EMA to under it.', updates: DAILY_LIVE },
  rsi_cross_up: { name: 'RSI(14) crossing up', desc: 'Daily RSI(14) rises through the level.', updates: DAILY_LIVE },
  rsi_cross_down: { name: 'RSI(14) crossing down', desc: 'Daily RSI(14) falls through the level.', updates: DAILY_LIVE },
  rel_volume: { name: 'Volume ≥ × 50-day average', desc: 'Today’s volume so far is at least this multiple of the 50-day average.', updates: DAILY_LIVE },
};

/** The name shown in the dropdown. */
export function condName(t: CondType): string {
  return PRICE_HELP[t]?.name ?? SIGNAL_META[t]?.name ?? t;
}
/** The short description under the chosen condition and when it updates. */
export function condHelp(t: CondType): { desc: string; updates: string } {
  const p = PRICE_HELP[t];
  if (p) return { desc: p.desc, updates: p.updates };
  const s = SIGNAL_META[t];
  return s ? { desc: s.desc, updates: s.updates } : { desc: '', updates: '' };
}

export interface AlertTemplate { id: string; label: string; help: string; conditions: AlertCondition[] }
/** One-click templates at the top of the dialog ("on my list" = the list picked under "Create alert on"). */
export const ALERT_TEMPLATES: readonly AlertTemplate[] = [
  { id: 'stage2', label: 'Stage 2 confirmed on my list', help: 'Fires when a stock on the list moves into a confirmed Stage 2 (weekly).', conditions: [{ type: 'stage_2' }] },
  { id: 'breakout', label: 'Breakout on my list', help: 'Fires when a stock on the list breaks out of a bullish daily chart pattern.', conditions: [{ type: 'pattern_breakout', tf: 'D' }] },
  { id: 'acc', label: 'Accumulation A/B on my list', help: 'Fires when a stock on the list reaches accumulation grade A or B.', conditions: [{ type: 'acc_ab' }] },
  { id: 'cheat', label: 'Cheat entry on my list', help: 'Fires when a stock on the list comes onto its 50-day or 200-day average (the Cheat Entry board rules).', conditions: [{ type: 'cheat_any' }] },
];

// ── zzz1064 (A04): the one-ticker form keeps the exchange the owner chose (NSE vs BSE) ─────────────────────────────────────

export type TickerExchange = 'NSE' | 'BSE' | 'US';
export interface TickerForm { market: 'IN' | 'US'; ticker: string; exchange: TickerExchange }

/** The form's starting state from a saved target, or the ticker on screen. A BSE id ("IN:BSE:TATVA") stays BSE. Pure. */
export function tickerFormFrom(target: AlertTarget | null | undefined, current?: { m: 'IN' | 'US'; t: string; x?: string } | null): TickerForm {
  if (target?.kind === 'ticker') {
    const p = parseMid(target.id);
    if (p) return { market: p.market, ticker: p.ticker, exchange: p.market === 'US' ? 'US' : p.bse ? 'BSE' : 'NSE' };
  }
  if (current) {
    const mid = toMid(current.m, current.t, current.x);
    const p = mid ? parseMid(mid) : null;
    if (p) return { market: p.market, ticker: p.ticker, exchange: p.market === 'US' ? 'US' : p.bse ? 'BSE' : 'NSE' };
    return { market: current.m, ticker: String(current.t || '').toUpperCase(), exchange: current.m === 'US' ? 'US' : current.x === 'BSE' ? 'BSE' : 'NSE' };
  }
  return { market: 'IN', ticker: '', exchange: 'NSE' };
}

/** Typed text → form. "BSE:TATVA", "TATVA.BO" and a 6-digit BSE code switch the exchange to BSE; "NSE:X" / ".NS" to NSE. Pure. */
export function tickerFormInput(prev: TickerForm, text: string): TickerForm {
  const raw = String(text || '').toUpperCase().replace(/\s+/g, '');
  if (prev.market === 'US') return { ...prev, ticker: raw.replace(/^(NASDAQ|NYSE|AMEX|NYSEARCA|BATS|CBOE):/, ''), exchange: 'US' };
  let exchange: TickerExchange = prev.exchange === 'US' ? 'NSE' : prev.exchange;
  if (/^BSE:/.test(raw) || /\.BO$/.test(raw) || /^\d{6}$/.test(raw)) exchange = 'BSE';
  else if (/^NSE:/.test(raw) || /\.NS$/.test(raw)) exchange = 'NSE';
  return { market: 'IN', ticker: raw.replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO)$/, ''), exchange };
}

/** Market switch: India keeps / defaults to NSE, USA is US. Pure. */
export function tickerFormMarket(prev: TickerForm, market: 'IN' | 'US'): TickerForm {
  return { ...prev, market, exchange: market === 'US' ? 'US' : prev.exchange === 'BSE' ? 'BSE' : 'NSE' };
}

/** Form → the saved market-qualified id ("IN:TATVA", "IN:BSE:TATVA", "IN:BSE:543262", "US:HAL"), or null when invalid. Pure. */
export function tickerFormMid(f: TickerForm): string | null {
  if (!f.ticker) return null;
  return toMid(f.market, f.ticker, f.market === 'IN' && f.exchange === 'BSE' ? 'BSE' : undefined);
}

/** The small badge next to the ticker box. Pure. */
export function exchangeBadge(f: TickerForm): string {
  return f.market === 'US' ? 'USA' : f.exchange === 'BSE' ? 'BSE' : 'NSE';
}

/** Focus trap: the element to focus on Tab / Shift+Tab inside the dialog, or null to let the browser move normally. Pure. */
export function trapFocusTarget<T>(items: readonly T[], active: T | null, shift: boolean): T | null {
  if (!items.length) return null;
  const i = active == null ? -1 : items.indexOf(active);
  if (shift && i <= 0) return items[items.length - 1];
  if (!shift && (i === -1 || i === items.length - 1)) return items[0];
  return null;
}
