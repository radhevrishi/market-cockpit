// zzz1054 — one pass over all active alerts (pure: data in, events out; the caller fetched quotes / figures and writes events).
import { evalAll, type DailyFigs, type LiveQuote } from './conditions';
import { sessionOpen, marketDate } from './session';
import { dedupeKey, renderMessage, exchangeOf, isLive } from './trigger';
import { condLabel, parseMid, type PriceAlert } from './types';
import type { Expanded } from './targets';
import type { NewEvent } from './store';

/** A quote older than this while the regular session is open is treated as missing (never fire on an old price). */
export const STALE_QUOTE_MS = 20 * 60_000;

export interface EvalCtx {
  now: Date;
  quotes: Map<string, LiveQuote & { extPct?: number | null }>;
  daily: Map<string, DailyFigs>;
  /** remembered crossing states, key `${alertId}|${version}|${mid}` (an edit resets them) */
  prev: Map<string, Array<number | undefined>>;
  /** (alert, ticker, dedupe key) already written or refused — skip without a database round trip */
  firedKeys: Set<string>;
  expansions: Map<string, Expanded>;
  isNseHoliday?: (d: string) => boolean;
}
export interface EvalReport { events: NewEvent[]; checked: number; waiting: number; closed: number }

export const stateKey = (a: Pick<PriceAlert, 'id' | 'version'>, mid: string) => `${a.id}|${a.version}|${mid}`;
export const firedKey = (alertId: string, mid: string, key: string) => `${alertId}|${mid}|${key}`;

/** The price an alert sees: the regular price, or in the US extended session (alert set to extended) the pre / post price. */
export function effectivePrice(q: LiveQuote & { extPct?: number | null }, market: 'IN' | 'US', extendedNow: boolean): number {
  if (market === 'US' && extendedNow && typeof q.extPct === 'number' && Number.isFinite(q.extPct)) return q.price * (1 + q.extPct / 100);
  return q.price;
}

export function evaluateAlerts(alerts: readonly PriceAlert[], ctx: EvalCtx): EvalReport {
  const events: NewEvent[] = [];
  let checked = 0, waiting = 0, closed = 0;
  for (const a of alerts) {
    if (!isLive(a, ctx.now)) continue;
    const ex = ctx.expansions.get(a.id);
    if (!ex) continue;
    const condText = a.conditions.map((c) => condLabel(c, a.interval)).join(' and ');
    for (const mid of ex.mids) {
      const p = parseMid(mid);
      if (!p) continue;
      if (!sessionOpen(p.market, a.session, ctx.now, ctx.isNseHoliday)) { closed++; continue; }
      const q0 = ctx.quotes.get(mid);
      const regularNow = sessionOpen(p.market, 'regular', ctx.now, ctx.isNseHoliday);
      if (!q0 || (regularNow && q0.marketTime && ctx.now.getTime() - q0.marketTime > STALE_QUOTE_MS)) { waiting++; continue; }
      const q: LiveQuote = { ...q0, price: effectivePrice(q0, p.market, !regularNow) };
      const today = marketDate(p.market, ctx.now);
      const sk = stateKey(a, mid);
      const r = evalAll(a.conditions, q, ctx.daily.get(mid) ?? null, ctx.prev.get(sk) ?? [], a.interval, today);
      ctx.prev.set(sk, r.states);
      checked++;
      if (!r.known) { waiting++; continue; }
      if (!r.met) continue;
      const key = dedupeKey(a.trigger, p.market, a.interval, ctx.now);
      const fk = firedKey(a.id, mid, key);
      if (ctx.firedKeys.has(fk)) continue;
      ctx.firedKeys.add(fk);
      const change = q.prevClose && q.prevClose > 0 ? (q.price / q.prevClose - 1) * 100 : null;
      const list = a.target.kind === 'ticker' ? null : ex.label;
      events.push({
        alertId: a.id, alertName: a.name, mid, market: p.market, ticker: p.ticker, name: q.name ?? null, price: q.price, changePct: change,
        condition: condText, list, dedupeKey: key, toast: a.notify.toast, browser: a.notify.browser,
        message: renderMessage(a.message, { ticker: p.ticker, name: q.name, price: q.price, change, condition: condText, list, time: ctx.now, interval: a.interval, exchange: exchangeOf(mid), market: p.market }),
      });
    }
  }
  return { events, checked, waiting, closed };
}
