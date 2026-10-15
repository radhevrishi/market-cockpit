// zzz1054 — one pass over all active alerts (pure: data in, events out; the caller fetched quotes / figures and writes events).
import { evalAll, type DailyFigs, type LiveQuote } from './conditions';
import { sessionOpen, marketDate, barKey } from './session';
import { signalReading, stepSignal, signalKey, consumeEdges, type SignalBook, type SignalState } from './signals';
import { dedupeKey, renderMessage, exchangeOf, isLive } from './trigger';
import { condLabel, parseMid, isSignalCond, type PriceAlert } from './types';
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
  /** zzz1061 — the app's own signals (state-change conditions): states + the data views per market (absent = none in use) */
  signals?: SignalBook;
}
export interface EvalReport {
  events: NewEvent[]; checked: number; waiting: number; closed: number;
  /** zzz1061 — signal edges used up by this pass's events (put back when the events could not be saved) */
  consumed?: Array<[string, SignalState]>;
}

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
  const consumed: Array<[string, SignalState]> = [];
  for (const a of alerts) {
    if (!isLive(a, ctx.now)) continue;
    const ex = ctx.expansions.get(a.id);
    if (!ex) continue;
    const condText = a.conditions.map((c) => condLabel(c, a.interval)).join(' and ');
    const sigIdx = a.conditions.flatMap((c, i) => (isSignalCond(c) ? [i] : []));
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
      // zzz1061 — signal conditions: each one's state-change verdict (AND with the rest)
      let sigMet = true, sigKnown = true;
      const sigKeys: string[] = [];
      if (sigIdx.length) {
        const book = ctx.signals;
        const bar = barKey(p.market, a.interval, ctx.now);
        for (const i of sigIdx) {
          const c = a.conditions[i];
          const k = signalKey(a.id, mid, i);
          sigKeys.push(k);
          if (!book) { sigKnown = false; sigMet = false; continue; }
          const step = stepSignal(c.type, a.version, book.states.get(k), signalReading(c, book.feeds.get(p.market), p.ticker), bar);
          if (step.next) book.states.set(k, step.next);
          if (step.changed) book.dirty.add(k);
          if (!step.known) sigKnown = false;
          if (!step.met) sigMet = false;
        }
      }
      if (!r.known || !sigKnown) { waiting++; continue; }
      if (!r.met || !sigMet) continue;
      const key = dedupeKey(a.trigger, p.market, a.interval, ctx.now);
      const fk = firedKey(a.id, mid, key);
      if (ctx.firedKeys.has(fk)) continue;
      ctx.firedKeys.add(fk);
      if (sigKeys.length && ctx.signals) consumed.push(...consumeEdges(ctx.signals, sigKeys));
      const change = q.prevClose && q.prevClose > 0 ? (q.price / q.prevClose - 1) * 100 : null;
      const list = a.target.kind === 'ticker' ? null : ex.label;
      events.push({
        alertId: a.id, alertName: a.name, mid, market: p.market, ticker: p.ticker, name: q.name ?? null, price: q.price, changePct: change,
        condition: condText, list, dedupeKey: key, toast: a.notify.toast, browser: a.notify.browser,
        message: renderMessage(a.message, { ticker: p.ticker, name: q.name, price: q.price, change, condition: condText, list, time: ctx.now, interval: a.interval, exchange: exchangeOf(mid), market: p.market }),
      });
    }
  }
  return { events, checked, waiting, closed, consumed };
}
