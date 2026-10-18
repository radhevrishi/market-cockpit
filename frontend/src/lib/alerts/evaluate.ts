// zzz1054 — one pass over all active alerts (pure: data in, events out; the caller fetched quotes / figures and writes events).
//
// zzz1063 (A01) FRESHNESS CONTRACT — an alert only ever looks at a price it can date:
//   • regular session: the exchange time of the quote (marketTime) must exist, not be in the future (> 2 min ahead), be at most
//     20 minutes old and be from today's session;
//   • US pre-market / after-hours (alert set to "extended"): the extended price must exist for THIS session (pre or post), be
//     dated and fresh (Yahoo gives no time for it, so the source dates it with the fetch time — only when Yahoo's own trading
//     period says that session is live and an extended trade exists); and the regular close it is based on must be from the
//     right session (today's for after-hours, the previous trading day's for pre-market). No extended price → wait;
//   • India pre-open / closing session (extended): the regular quote, with the same 20-minute freshness rule;
//   • daily figures (MAs, 52-week, RSI, average volume, N-bar moves) must be from the last completed exchange session
//     (the trading day before today — holidays, weekends and DST come from lib/exchange-calendar); an older set → wait.
// A wait is never a fire: it is counted with its reason (EvalReport.waitReasons) and shown in the run report.
//
// zzz1063 (A02) — with `deferState`, crossing states are NOT written into ctx.prev here; they come back in `stateUpdates` and
// the checker applies them only after the events of this pass were committed, so a failed insert never loses a crossing.
import { evalAll, needsDaily, type DailyFigs, type LiveQuote } from './conditions';
import { sessionOpen, marketDate, barKey, phaseAt, expectedDailyAsOf } from './session';
import { signalReading, stepSignal, signalKey, consumeEdges, type SignalBook, type SignalState } from './signals';
import { dedupeKey, renderMessage, exchangeOf, isLive } from './trigger';
import { condLabel, parseMid, isSignalCond, type PriceAlert, type AlertMarket } from './types';
import type { Expanded } from './targets';
import type { NewEvent } from './store';

/** A quote older than this is treated as missing (never fire on an old price). Applies in every session to the price used. */
export const STALE_QUOTE_MS = 20 * 60_000;
/** Clock skew allowed before a quote time counts as "in the future". */
export const FUTURE_SKEW_MS = 2 * 60_000;

export type WaitReason =
  | 'no-quote' | 'quote-undated' | 'quote-future' | 'quote-stale' | 'quote-old-session'
  | 'no-extended-price' | 'extended-undated' | 'extended-future' | 'extended-stale' | 'regular-ref-session'
  | 'daily-missing' | 'daily-stale' | 'data-missing' | 'signal-unknown';
/** Plain-English text for each wait reason (run report, page). */
export const WAIT_TEXT: Record<WaitReason, string> = {
  'no-quote': 'no live price',
  'quote-undated': 'price has no time stamp',
  'quote-future': 'price time is in the future',
  'quote-stale': 'price older than 20 minutes',
  'quote-old-session': 'price is from an earlier session',
  'no-extended-price': 'no pre-market / after-hours trade yet',
  'extended-undated': 'pre-market / after-hours price has no time',
  'extended-future': 'pre-market / after-hours price time is in the future',
  'extended-stale': 'pre-market / after-hours price older than 20 minutes',
  'regular-ref-session': 'last regular close is not from the right session',
  'daily-missing': 'daily figures not loaded yet',
  'daily-stale': 'daily figures are older than the last completed session',
  'data-missing': 'a figure the condition needs is missing',
  'signal-unknown': 'signal data not available',
};

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
  /** zzz1063 — collect crossing states in EvalReport.stateUpdates instead of writing ctx.prev (the checker commits them) */
  deferState?: boolean;
}
export interface EvalReport {
  events: NewEvent[]; checked: number; waiting: number; closed: number;
  /** zzz1061 — signal edges used up by this pass's events (put back when the events could not be saved) */
  consumed?: Array<[string, SignalState]>;
  /** zzz1063 — why tickers waited, counted */
  waitReasons: Partial<Record<WaitReason, number>>;
  /** zzz1063 — new crossing states (only when ctx.deferState) */
  stateUpdates: Array<[string, Array<number | undefined>]>;
}

export const stateKey = (a: Pick<PriceAlert, 'id' | 'version'>, mid: string) => `${a.id}|${a.version}|${mid}`;
export const firedKey = (alertId: string, mid: string, key: string) => `${alertId}|${mid}|${key}`;

/** Legacy helper (kept for callers / tests): the regular price, or in the US extended session the price implied by extPct. */
export function effectivePrice(q: LiveQuote & { extPct?: number | null }, market: 'IN' | 'US', extendedNow: boolean): number {
  if (market === 'US' && extendedNow && typeof q.extPct === 'number' && Number.isFinite(q.extPct)) return q.price * (1 + q.extPct / 100);
  return q.price;
}

export type PriceUse =
  | { ok: true; quote: LiveQuote; session: 'regular' | 'pre' | 'post'; observedAt: number; provider: string }
  | { ok: false; reason: WaitReason };

function checkTime(t: number | null | undefined, now: number): 'undated' | 'future' | 'stale' | null {
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return 'undated';
  if (t > now + FUTURE_SKEW_MS) return 'future';
  if (now - t > STALE_QUOTE_MS) return 'stale';
  return null;
}

/**
 * zzz1063 (A01) — the price an alert may use right now, or why it must wait. Pure.
 * The returned quote is what the conditions see: in US pre-market the previous close is the last regular close and today's
 * high / low / volume are unknown (Yahoo still shows yesterday's), so volume and new-high conditions wait for the open.
 */
export function priceForAlert(q: (LiveQuote & { extPct?: number | null }) | undefined, market: AlertMarket, now: Date, isNseHoliday?: (d: string) => boolean): PriceUse {
  if (!q || !(q.price > 0)) return { ok: false, reason: 'no-quote' };
  const ph = phaseAt(market, now, isNseHoliday);
  const n = now.getTime();
  const today = marketDate(market, now);
  const provider = q.provider || 'unknown';
  if (ph === 'pre' || ph === 'post') {
    if (market === 'US') {
      const e = q.ext;
      if (!e || !(e.price > 0) || e.session !== ph) return { ok: false, reason: 'no-extended-price' };
      const bad = checkTime(e.observedAt, n);
      if (bad) return { ok: false, reason: bad === 'undated' ? 'extended-undated' : bad === 'future' ? 'extended-future' : 'extended-stale' };
      // the regular close the extended price follows must be from the right session
      if (typeof q.marketTime !== 'number' || !Number.isFinite(q.marketTime)) return { ok: false, reason: 'regular-ref-session' };
      const refDay = marketDate(market, new Date(q.marketTime));
      const want = ph === 'post' ? today : expectedDailyAsOf(market, today, isNseHoliday);
      if (refDay !== want) return { ok: false, reason: 'regular-ref-session' };
      const quote: LiveQuote = ph === 'pre'
        ? { ...q, price: e.price, prevClose: q.price, dayHigh: null, dayLow: null, volume: null }
        : { ...q, price: e.price };
      return { ok: true, quote, session: ph, observedAt: e.observedAt!, provider };
    }
    // India pre-open (09:00–09:15) / closing session (15:30–16:00): the regular quote under the same freshness rule
  }
  const bad = checkTime(q.marketTime, n);
  if (bad) return { ok: false, reason: bad === 'undated' ? 'quote-undated' : bad === 'future' ? 'quote-future' : 'quote-stale' };
  if (marketDate(market, new Date(q.marketTime!)) !== today) return { ok: false, reason: 'quote-old-session' };
  return { ok: true, quote: { ...q }, session: ph === 'pre' || ph === 'post' ? ph : 'regular', observedAt: q.marketTime!, provider };
}

/** zzz1063 — are the daily figures from the last completed session? null = fine, else the wait reason. */
export function dailyFreshness(f: DailyFigs | null | undefined, market: AlertMarket, today: string, isNseHoliday?: (d: string) => boolean): WaitReason | null {
  if (!f) return 'daily-missing';
  return f.asOf < expectedDailyAsOf(market, today, isNseHoliday) ? 'daily-stale' : null;
}

/** The condition text with any history note, e.g. "New 52-week high (since listing, 140 sessions)". */
export function condTextWithNotes(a: Pick<PriceAlert, 'conditions' | 'interval'>, notes?: ReadonlyArray<string | undefined>): string {
  return a.conditions.map((c, i) => `${condLabel(c, a.interval)}${notes?.[i] ? ` (${notes[i]})` : ''}`).join(' and ');
}

export function evaluateAlerts(alerts: readonly PriceAlert[], ctx: EvalCtx): EvalReport {
  const events: NewEvent[] = [];
  let checked = 0, waiting = 0, closed = 0;
  const consumed: Array<[string, SignalState]> = [];
  const waitReasons: Partial<Record<WaitReason, number>> = {};
  const stateUpdates: Array<[string, Array<number | undefined>]> = [];
  const wait = (r: WaitReason) => { waiting++; waitReasons[r] = (waitReasons[r] || 0) + 1; };
  for (const a of alerts) {
    if (!isLive(a, ctx.now)) continue;
    const ex = ctx.expansions.get(a.id);
    if (!ex) continue;
    const sigIdx = a.conditions.flatMap((c, i) => (isSignalCond(c) ? [i] : []));
    const wantsDaily = a.conditions.some((c) => needsDaily(c, a.interval));
    for (const mid of ex.mids) {
      const p = parseMid(mid);
      if (!p) continue;
      if (!sessionOpen(p.market, a.session, ctx.now, ctx.isNseHoliday)) { closed++; continue; }
      const use = priceForAlert(ctx.quotes.get(mid), p.market, ctx.now, ctx.isNseHoliday);
      if (!use.ok) { wait(use.reason); continue; }
      const q = use.quote;
      const today = marketDate(p.market, ctx.now);
      const f = ctx.daily.get(mid) ?? null;
      if (wantsDaily) { const why = dailyFreshness(f, p.market, today, ctx.isNseHoliday); if (why) { wait(why); continue; } }
      const sk = stateKey(a, mid);
      const r = evalAll(a.conditions, q, f, ctx.prev.get(sk) ?? [], a.interval, today);
      if (ctx.deferState) stateUpdates.push([sk, r.states]); else ctx.prev.set(sk, r.states);
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
      if (!r.known) { wait('data-missing'); continue; }
      if (!sigKnown) { wait('signal-unknown'); continue; }
      if (!r.met || !sigMet) continue;
      const key = dedupeKey(a.trigger, p.market, a.interval, ctx.now, a.armGen);
      const fk = firedKey(a.id, mid, key);
      if (ctx.firedKeys.has(fk)) continue;
      ctx.firedKeys.add(fk);
      if (sigKeys.length && ctx.signals) consumed.push(...consumeEdges(ctx.signals, sigKeys));
      const change = q.prevClose && q.prevClose > 0 ? (q.price / q.prevClose - 1) * 100 : null;
      const list = a.target.kind === 'ticker' ? null : ex.label;
      const condText = condTextWithNotes(a, r.notes);
      events.push({
        alertId: a.id, alertName: a.name, mid, market: p.market, ticker: p.ticker, name: q.name ?? null, price: q.price, changePct: change,
        condition: condText, list, dedupeKey: key, toast: a.notify.toast, browser: a.notify.browser,
        message: renderMessage(a.message, { ticker: p.ticker, name: q.name, price: q.price, change, condition: condText, list, time: ctx.now, interval: a.interval, exchange: exchangeOf(mid), market: p.market }),
      });
    }
  }
  return { events, checked, waiting, closed, consumed, waitReasons, stateUpdates };
}
