// zzz1054 — when an alert may fire again, expiry, and the message template (pure).
//
// Trigger modes (per alert AND per ticker — a list alert treats each member on its own):
//   once        — fires once per ticker, ever. A single-ticker alert then becomes "triggered" (stopped).
//   per_bar     — at most once per bar: per market day (D) or per week (W).
//   per_minute  — at most once per minute while the conditions hold.
// The dedupe key is stored with each event under a unique index (alert, ticker, key), so two server copies can never send the
// same alert twice — the database refuses the second insert.
//
// zzz1063 (A05) — REARM. A "once" alert's key carries its activation generation (price_alert.arm_gen): generation 0 keeps the
// old key 'once' (events stored before this change still block), generation N > 0 is 'once:gN'. Only the explicit Rearm
// action raises the generation, so only Rearm lets tickers that already fired fire again. Edits:
//   • cosmetic (name, message, notifications, expiry) — nothing about firing changes; a triggered single-ticker alert stays
//     triggered (it is not reactivated, so it does not look "watching" when it cannot fire);
//   • conditions / target / interval / trigger / session — as before: the alert is watched again (status active), crossing
//     state starts fresh (new version), and per-bar / per-minute keys work at once; under "once", tickers that already fired
//     stay done until Rearm (new tickers on a list can fire).
import { barKey } from './session';
import type { AlertMarket, AlertInterval, TriggerMode, PriceAlert } from './types';

export function dedupeKey(trigger: TriggerMode, market: AlertMarket, interval: AlertInterval, now: Date, armGen = 0): string {
  if (trigger === 'once') return armGen > 0 ? `once:g${armGen}` : 'once';
  if (trigger === 'per_bar') return `bar:${barKey(market, interval, now)}`;
  return `min:${now.toISOString().slice(0, 16)}`;
}

export function isExpired(expiresAt: string | null | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= now.getTime();
}

/** Status after a fire: a single-ticker "once" alert stops; everything else keeps watching. */
export function statusAfterFire(a: Pick<PriceAlert, 'trigger' | 'target'>): 'active' | 'triggered' {
  return a.trigger === 'once' && a.target.kind === 'ticker' ? 'triggered' : 'active';
}

/** Should this alert be checked at all now (active and not expired)? */
export function isLive(a: Pick<PriceAlert, 'status' | 'expiresAt'>, now: Date): boolean {
  return a.status === 'active' && !isExpired(a.expiresAt, now);
}

export interface TemplateVars {
  ticker: string; name?: string | null; price?: number | null; change?: number | null; condition: string;
  list?: string | null; time: Date; interval: AlertInterval; exchange: string; market: AlertMarket;
}
const fmtNum = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3));
/** {{ticker}} {{name}} {{price}} {{change}} {{condition}} {{list}} {{time}} {{interval}} {{exchange}} — unknown names stay as written. */
export function renderMessage(tpl: string, v: TemplateVars): string {
  const tz = v.market === 'IN' ? 'Asia/Kolkata' : 'America/New_York';
  let time: string;
  try { time = `${new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(v.time)} ${v.market === 'IN' ? 'IST' : 'ET'}`; }
  catch { time = v.time.toISOString(); }
  const map: Record<string, string> = {
    ticker: v.ticker,
    name: v.name || v.ticker,
    price: v.price != null && Number.isFinite(v.price) ? `${v.market === 'IN' ? '₹' : '$'}${fmtNum(v.price)}` : '—',
    change: v.change != null && Number.isFinite(v.change) ? `${v.change >= 0 ? '+' : ''}${v.change.toFixed(2)}%` : '—',
    condition: v.condition,
    list: v.list || v.ticker,
    time,
    interval: v.interval === 'W' ? '1W' : '1D',
    exchange: v.exchange,
  };
  return String(tpl || '').replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (whole, k: string) => (Object.prototype.hasOwnProperty.call(map, k.toLowerCase()) ? map[k.toLowerCase()] : whole)).slice(0, 1000);
}

export function exchangeOf(mid: string): string {
  if (mid.startsWith('IN:BSE:')) return 'BSE';
  return mid.startsWith('IN:') ? 'NSE' : 'US';
}

