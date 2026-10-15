// zzz1054 — PRICE ALERTS (TradingView-style "Create alert on <watchlist>"), India + USA. Shared shapes and the input check.
//
// An alert watches ONE ticker or a whole LIST (a /charts watchlist, the /watchlists list, the India / US book, Conviction Beats
// India / US). A list alert follows the list's CURRENT members at every check. All conditions must hold at once (AND).
// Every ticker is market-qualified — "IN:HAL" and "US:HAL" are different companies and never share state.
// Pure: no window, no server imports (the dialog, the API and the checker all use this file).

export type AlertMarket = 'IN' | 'US';

export type CondType =
  | 'price_cross' | 'price_cross_up' | 'price_cross_down'   // price crossing a level (either way / up / down)
  | 'price_above' | 'price_below'                           // price greater than / less than a level
  | 'move_up_pct' | 'move_down_pct'                         // price moving up / down X% in N bars (D or W)
  | 'ma_cross' | 'ma_cross_up' | 'ma_cross_down'            // price crossing a daily moving average
  | 'high_52w' | 'low_52w'                                  // new 52-week high / low today
  | 'gap_up' | 'gap_down'                                   // today's open vs the previous close ≥ X%
  | 'rel_volume'                                            // today's volume ≥ X × its 50-day average
  | 'rsi_cross_up' | 'rsi_cross_down'                       // daily RSI(14) crossing a level
  | 'near_52w_high'                                         // within X% of the 52-week high
  // zzz1061 — the app's OWN signals (lib/alerts/signals.ts). STATE-CHANGE conditions: they fire when the state becomes true
  // compared with the previous reading of its source (screener build, graded results, guidance archive) — never on the first.
  | 'stage_2' | 'stage_to' | 'stage2_weak' | 'stage_1_to_2' | 'sata_cross_up' | 'sata_cross_down' | 'mrs_cross_up'
  | 'cheat_any' | 'cheat_50' | 'cheat_200' | 'cheat_support'
  | 'pattern_breakout' | 'pattern_near_pivot' | 'tight_3w' | 'darvas_breakout' | 'donchian_20' | 'donchian_55' | 'squeeze_up'
  | 'episodic_pivot' | 'pocket_pivot' | 'trend_template' | 'rs_rating'
  | 'acc_ab' | 'dist_warn' | 'vol_breakout'
  | 'result_strong' | 'result_blockbuster' | 'guidance_raised';

/** zzz1061 — the signal (state-change) condition types, in dialog order. */
export const SIGNAL_COND_TYPES: readonly CondType[] = [
  'stage_2', 'stage_to', 'stage2_weak', 'stage_1_to_2', 'sata_cross_up', 'sata_cross_down', 'mrs_cross_up',
  'cheat_any', 'cheat_50', 'cheat_200', 'cheat_support',
  'pattern_breakout', 'pattern_near_pivot', 'tight_3w', 'darvas_breakout', 'donchian_20', 'donchian_55', 'squeeze_up',
  'episodic_pivot', 'pocket_pivot', 'trend_template', 'rs_rating',
  'acc_ab', 'dist_warn', 'vol_breakout',
  'result_strong', 'result_blockbuster', 'guidance_raised',
];
export const isSignalCond = (c: Pick<AlertCondition, 'type'>): boolean => SIGNAL_COND_TYPES.includes(c.type);
export type PatternTf = 'D' | 'W' | 'M';

export const COND_TYPES: readonly CondType[] = [
  'price_cross', 'price_cross_up', 'price_cross_down', 'price_above', 'price_below', 'move_up_pct', 'move_down_pct',
  'ma_cross', 'ma_cross_up', 'ma_cross_down', 'high_52w', 'low_52w', 'gap_up', 'gap_down', 'rel_volume',
  'rsi_cross_up', 'rsi_cross_down', 'near_52w_high',
  ...SIGNAL_COND_TYPES,
];

export type MaKind = 'SMA' | 'EMA';
export const MA_LENGTHS = [20, 50, 150, 200] as const;
export type MaLen = (typeof MA_LENGTHS)[number];

export interface AlertCondition {
  type: CondType;
  /** level (price / RSI), percent, or multiple — depends on the type */
  value?: number;
  /** moving % conditions: number of bars (1 = since the previous close) */
  bars?: number;
  ma?: MaKind;
  len?: MaLen;
  /** zzz1061 — pattern conditions: daily / weekly / monthly patterns */
  tf?: PatternTf;
}

export type TargetKind = 'ticker' | 'chart-list' | 'watchlist' | 'book-in' | 'book-us' | 'cb-in' | 'cb-us';
export const TARGET_KINDS: readonly TargetKind[] = ['ticker', 'chart-list', 'watchlist', 'book-in', 'book-us', 'cb-in', 'cb-us'];
export interface AlertTarget {
  kind: TargetKind;
  /** ticker: market-qualified id ("IN:HAL", "US:HAL", "IN:BSE:532540"); chart-list: the list id */
  id?: string;
  /** what the owner saw when he picked it ("Swing ideas", "HAL") — the server re-reads the real name at check time */
  label?: string;
}

export type TriggerMode = 'once' | 'per_bar' | 'per_minute';
export type SessionMode = 'regular' | 'extended';
export type AlertInterval = 'D' | 'W';
export type AlertStatus = 'active' | 'paused' | 'triggered' | 'expired';

export interface AlertNotify {
  /** the in-app list + bell — always on */
  app: true;
  toast: boolean;
  browser: boolean;
  telegram: boolean;
  email: boolean;
}

export interface AlertInput {
  name: string;
  target: AlertTarget;
  conditions: AlertCondition[];
  interval: AlertInterval;
  trigger: TriggerMode;
  session: SessionMode;
  /** ISO time, or null = open-ended */
  expiresAt: string | null;
  message: string;
  notify: AlertNotify;
}

export interface PriceAlert extends AlertInput {
  id: string;
  status: AlertStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
  lastFiredAt: string | null;
  fireCount: number;
}

export interface AlertEvent {
  id: number;
  alertId: string;
  alertName: string;
  mid: string;
  market: AlertMarket;
  ticker: string;
  name: string | null;
  price: number | null;
  changePct: number | null;
  condition: string;
  list: string | null;
  message: string;
  firedAt: string;
  dedupeKey: string;
  read: boolean;
  /** notify settings at fire time (the bell uses toast / browser) */
  toast: boolean;
  browser: boolean;
}

export const MAX_CONDITIONS = 5;
export const MAX_ALERTS = 500;
export const MAX_MESSAGE = 500;
export const DEFAULT_EXPIRY_DAYS = 30;
export const EVENT_RETENTION_DAYS = 180;
export const EVENT_CAP = 50_000;
export const DEFAULT_MESSAGE = '{{ticker}}, {{interval}} {{condition}}';
export const DEFAULT_NOTIFY: AlertNotify = { app: true, toast: true, browser: false, telegram: false, email: false };

// ── market-qualified ids ────────────────────────────────────────────────────

const IN_RE = /^[A-Z0-9][A-Z0-9&-]{0,19}$/;
const US_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const BSE_RE = /^\d{6}$/;

export interface ParsedMid { market: AlertMarket; ticker: string; bse: boolean }
/** "IN:HAL" / "US:HAL" / "IN:BSE:532540" → parts, or null when not a valid id. */
export function parseMid(mid: unknown): ParsedMid | null {
  const s = String(mid || '').trim().toUpperCase();
  let m = /^IN:BSE:(.+)$/.exec(s);
  if (m) return BSE_RE.test(m[1]) || IN_RE.test(m[1]) ? { market: 'IN', ticker: m[1], bse: true } : null;
  m = /^(IN|US):(.+)$/.exec(s);
  if (!m) return null;
  const market = m[1] as AlertMarket;
  const t = m[2];
  if (market === 'IN' ? !IN_RE.test(t) : !US_RE.test(t)) return null;
  return { market, ticker: t, bse: false };
}
/** Builds the id. India tickers lose any NSE:/BSE: prefix and .NS / .BO suffix. null when invalid. */
export function toMid(market: AlertMarket, ticker: string, exchange?: string): string | null {
  let t = String(ticker || '').trim().toUpperCase();
  if (market === 'IN') {
    const bse = exchange === 'BSE' || /^BSE:/.test(t) || /\.BO$/.test(t);
    t = t.replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO)$/, '');
    if (bse || BSE_RE.test(t)) return BSE_RE.test(t) || IN_RE.test(t) ? `IN:BSE:${t}` : null;
    return IN_RE.test(t) ? `IN:${t}` : null;
  }
  t = t.replace(/^(NASDAQ|NYSE|AMEX|NYSEARCA|BATS|CBOE):/, '');
  return US_RE.test(t) ? `US:${t}` : null;
}
/** The Yahoo symbol for a quote / bars: IN → .NS (BSE → .BO), US class shares use '-' (BRK.B → BRK-B). */
export function yahooSymbol(mid: string): string | null {
  const p = parseMid(mid);
  if (!p) return null;
  if (p.market === 'IN') return `${p.ticker}.${p.bse ? 'BO' : 'NS'}`;
  return p.ticker.replace(/\./g, '-');
}

// ── input check ─────────────────────────────────────────────────────────────

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

/** Range of `value` per condition type (null = the type takes no value). */
export function valueRange(t: CondType): [number, number] | null {
  switch (t) {
    case 'price_cross': case 'price_cross_up': case 'price_cross_down': case 'price_above': case 'price_below': return [0.0001, 1e9];
    case 'move_up_pct': case 'move_down_pct': return [0.01, 1000];
    case 'gap_up': case 'gap_down': return [0.01, 100];
    case 'rel_volume': return [0.1, 100];
    case 'rsi_cross_up': case 'rsi_cross_down': return [1, 99];
    case 'near_52w_high': return [0, 100];
    case 'stage_to': return [1, 4];
    case 'sata_cross_up': case 'sata_cross_down': return [0, 10];
    case 'pattern_near_pivot': return [0.1, 50];
    case 'rs_rating': return [1, 99];
    default: return null;
  }
}

export function sanitizeCondition(raw: unknown): { ok: true; c: AlertCondition } | { ok: false; error: string } {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const type = r.type as CondType;
  if (!COND_TYPES.includes(type)) return { ok: false, error: `unknown condition "${String(r.type).slice(0, 30)}"` };
  const c: AlertCondition = { type };
  const range = valueRange(type);
  if (range) {
    const v = typeof r.value === 'string' ? Number(r.value) : r.value;
    if (!fin(v) || v < range[0] || v > range[1]) return { ok: false, error: `${condLabel({ type })}: enter a number between ${range[0]} and ${range[1]}` };
    c.value = v;
  }
  if (type === 'move_up_pct' || type === 'move_down_pct') {
    const b = r.bars == null ? 1 : Number(r.bars);
    if (!Number.isInteger(b) || b < 1 || b > 50) return { ok: false, error: 'bars must be a whole number from 1 to 50' };
    c.bars = b;
  }
  if (type === 'ma_cross' || type === 'ma_cross_up' || type === 'ma_cross_down') {
    const ma = r.ma === 'EMA' ? 'EMA' : r.ma === 'SMA' || r.ma == null ? 'SMA' : null;
    const len = Number(r.len ?? 50);
    if (!ma || !(MA_LENGTHS as readonly number[]).includes(len)) return { ok: false, error: 'moving average must be SMA or EMA 20, 50, 150 or 200' };
    c.ma = ma; c.len = len as MaLen;
  }
  if (type === 'stage_to' && !Number.isInteger(c.value)) return { ok: false, error: 'stage must be 1, 2, 3 or 4' };
  if (type === 'pattern_breakout' || type === 'pattern_near_pivot') {
    const tf = r.tf == null ? 'D' : r.tf;
    if (tf !== 'D' && tf !== 'W' && tf !== 'M') return { ok: false, error: 'pattern timeframe must be daily, weekly or monthly' };
    c.tf = tf;
  }
  return { ok: true, c };
}

export function sanitizeTarget(raw: unknown): { ok: true; t: AlertTarget } | { ok: false; error: string } {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const kind = r.kind as TargetKind;
  if (!TARGET_KINDS.includes(kind)) return { ok: false, error: 'pick a ticker or a watchlist' };
  const label = clean(r.label, 80) || undefined;
  if (kind === 'ticker') {
    const p = parseMid(r.id);
    if (!p) return { ok: false, error: 'ticker must be market-qualified, e.g. IN:HAL or US:NVDA' };
    return { ok: true, t: { kind, id: p.bse ? `IN:BSE:${p.ticker}` : `${p.market}:${p.ticker}`, label } };
  }
  if (kind === 'chart-list') {
    const id = clean(r.id, 40);
    if (!id) return { ok: false, error: 'pick a chart watchlist' };
    return { ok: true, t: { kind, id, label } };
  }
  return { ok: true, t: { kind, label } };
}

/** Checks and cleans an alert from the dialog. `now` decides the default expiry (+30 days). Never throws. */
export function sanitizeAlertInput(raw: unknown, now: Date = new Date()): { ok: true; alert: AlertInput } | { ok: false; error: string } {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const tg = sanitizeTarget(r.target);
  if (!tg.ok) return tg;
  const conds = Array.isArray(r.conditions) ? r.conditions : [];
  if (!conds.length) return { ok: false, error: 'add at least one condition' };
  if (conds.length > MAX_CONDITIONS) return { ok: false, error: `at most ${MAX_CONDITIONS} conditions` };
  const conditions: AlertCondition[] = [];
  for (const c of conds) { const s = sanitizeCondition(c); if (!s.ok) return s; conditions.push(s.c); }
  const interval: AlertInterval = r.interval === 'W' ? 'W' : 'D';
  const trigger: TriggerMode = r.trigger === 'once' || r.trigger === 'per_minute' ? r.trigger : 'per_bar';
  const session: SessionMode = r.session === 'extended' ? 'extended' : 'regular';
  let expiresAt: string | null;
  if (r.expiresAt === null || r.expiresAt === 'never') expiresAt = null;
  else if (r.expiresAt === undefined || r.expiresAt === '') expiresAt = new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 86_400_000).toISOString();
  else {
    const t = Date.parse(String(r.expiresAt));
    if (!Number.isFinite(t)) return { ok: false, error: 'expiration must be a date, or open-ended' };
    if (t <= now.getTime()) return { ok: false, error: 'expiration is in the past' };
    if (t > now.getTime() + 3 * 366 * 86_400_000) return { ok: false, error: 'expiration is more than 3 years away — choose open-ended instead' };
    expiresAt = new Date(t).toISOString();
  }
  const n: any = r.notify && typeof r.notify === 'object' ? r.notify : {};
  const notify: AlertNotify = {
    app: true,
    toast: n.toast !== false,
    browser: n.browser === true,
    telegram: n.telegram === true,
    email: n.email === true,
  };
  const message = clean(r.message, MAX_MESSAGE) || DEFAULT_MESSAGE;
  const name = clean(r.name, 80) || `${tg.t.label || tg.t.id || targetKindLabel(tg.t.kind)} · ${conditions.map((c) => condLabel(c, interval)).join(' and ')}`.slice(0, 80);
  return { ok: true, alert: { name, target: tg.t, conditions, interval, trigger, session, expiresAt, message, notify } };
}

// ── plain-English labels (dialog, list, messages) ───────────────────────────

const num = (v: number | undefined) => (v == null ? '?' : Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4))));
export function condLabel(c: AlertCondition, interval: AlertInterval = 'D'): string {
  const v = num(c.value);
  const bar = interval === 'W' ? 'week' : 'bar';
  switch (c.type) {
    case 'price_cross': return `Price crossing ${v}`;
    case 'price_cross_up': return `Price crossing up ${v}`;
    case 'price_cross_down': return `Price crossing down ${v}`;
    case 'price_above': return `Price greater than ${v}`;
    case 'price_below': return `Price less than ${v}`;
    case 'move_up_pct': return `Moving Up ${v}% in ${c.bars ?? 1} ${bar}${(c.bars ?? 1) > 1 ? 's' : ''}`;
    case 'move_down_pct': return `Moving Down ${v}% in ${c.bars ?? 1} ${bar}${(c.bars ?? 1) > 1 ? 's' : ''}`;
    case 'ma_cross': return `Price crossing ${c.ma ?? 'SMA'} ${c.len ?? 50} (daily)`;
    case 'ma_cross_up': return `Price crossing up ${c.ma ?? 'SMA'} ${c.len ?? 50} (daily)`;
    case 'ma_cross_down': return `Price crossing down ${c.ma ?? 'SMA'} ${c.len ?? 50} (daily)`;
    case 'high_52w': return 'New 52-week high';
    case 'low_52w': return 'New 52-week low';
    case 'gap_up': return `Gap up ≥ ${v}% at the open`;
    case 'gap_down': return `Gap down ≥ ${v}% at the open`;
    case 'rel_volume': return `Volume ≥ ${v}× its 50-day average`;
    case 'rsi_cross_up': return `RSI(14) crossing up ${v}`;
    case 'rsi_cross_down': return `RSI(14) crossing down ${v}`;
    case 'near_52w_high': return `Within ${v}% of the 52-week high`;
    // zzz1061 — the app's own signals
    case 'stage_2': return 'Stage changes to 2 (confirmed)';
    case 'stage_to': return `Stage changes to ${v}${STAGE_WORD[Number(c.value)] ? ` (${STAGE_WORD[Number(c.value)]})` : ''}`;
    case 'stage2_weak': return 'Stage 2 weakening (topping risk)';
    case 'stage_1_to_2': return 'Stage 1 → 2 transition';
    case 'sata_cross_up': return `SATA score crosses above ${v}`;
    case 'sata_cross_down': return `SATA score crosses below ${v}`;
    case 'mrs_cross_up': return 'Mansfield RS crosses above 0';
    case 'cheat_any': return 'Cheat entry trigger (onto the 50 or 200-day average)';
    case 'cheat_50': return 'Cheat entry: 50-day average pullback';
    case 'cheat_200': return 'Cheat entry: 200-day average retest';
    case 'cheat_support': return 'Cheat entry: at support now (within 1% of the average)';
    case 'pattern_breakout': return `Breaks out of a pattern (${TF_WORD[c.tf ?? 'D']})`;
    case 'pattern_near_pivot': return `Pattern forming within ${v}% of pivot (${TF_WORD[c.tf ?? 'D']})`;
    case 'tight_3w': return '3 weeks tight';
    case 'darvas_breakout': return 'Darvas breakout';
    case 'donchian_20': return 'Donchian 20 breakout';
    case 'donchian_55': return 'Donchian 55 breakout';
    case 'squeeze_up': return 'Squeeze fired up';
    case 'episodic_pivot': return 'Episodic pivot / gap on volume';
    case 'pocket_pivot': return 'Pocket pivot';
    case 'trend_template': return 'Minervini trend template passes (all 6)';
    case 'rs_rating': return `RS Rating ≥ ${v}`;
    case 'acc_ab': return 'Accumulation grade becomes A or B';
    case 'dist_warn': return 'Distribution warning appears';
    case 'vol_breakout': return 'Volume breakout (≥1.5× on a new 50-day closing high)';
    case 'result_strong': return 'New result filed graded STRONG or BLOCKBUSTER';
    case 'result_blockbuster': return 'New result filed graded BLOCKBUSTER';
    case 'guidance_raised': return 'Guidance raised';
  }
}
const STAGE_WORD: Record<number, string> = { 1: 'basing', 2: 'advancing', 3: 'topping', 4: 'declining' };
const TF_WORD: Record<PatternTf, string> = { D: 'daily', W: 'weekly', M: 'monthly' };
export function targetKindLabel(k: TargetKind): string {
  return ({ ticker: 'Ticker', 'chart-list': 'Chart watchlist', watchlist: 'My Watchlist (/watchlists)', 'book-in': 'India book', 'book-us': 'US book', 'cb-in': 'Conviction Beats India', 'cb-us': 'Conviction Beats US' } as const)[k];
}
export function triggerLabel(t: TriggerMode): string {
  return t === 'once' ? 'Only once' : t === 'per_bar' ? 'Once per bar' : 'Once per minute';
}
