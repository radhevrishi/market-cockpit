// zzz1054 — the price-alert checker, run every minute by the app scheduler (lib/app-scheduler LIGHT_JOBS 'price-alerts').
//
// Cost per minute (nothing at all when no market session is open — the check is a clock test, no I/O):
//   Postgres  — claim the minute (1 UPDATE), active alerts (1 SELECT), events (≤ 1 INSERT per 200 fires), fire counts
//               (1 UPDATE per alert that fired), daily figures (load once per process, save the new ones). Hourly: expire + prune.
//   Redis     — none in the loop. Lists come from Postgres user_state (5-min memory cache); the US book (Redis-primary) is read
//               at most every 10 minutes and only when an alert targets it. The scheduler's heartbeat is posted every 15 min.
//   Yahoo     — one spark request per 20 tickers whose session is open; daily bars once per ticker per market day
//               (≤ 60 tickers a minute, the ones with gap alerts first).
// Two server copies (during a deploy) never check the same minute: claimMinute() is an atomic compare-and-set in Postgres,
// and every event row is unique per (alert, ticker, bar / minute), so nothing is ever sent twice.
import { dbAvailable } from '@/lib/db';
import { anySessionOpen, sessionOpen, marketDate, regularStarted } from './session';
import { needsDaily, needsOpen, type DailyFigs } from './conditions';
import { evaluateAlerts, firedKey, type EvalCtx } from './evaluate';
import { statusAfterFire, isLive } from './trigger';
import { parseMid, type PriceAlert, type AlertEvent } from './types';
import type { Expanded } from './targets';

export const MAX_TICKERS_PER_RUN = 2500;
export const DAILY_FETCH_PER_RUN = 60;
const DAILY_RETRY_MS = 5 * 60_000;

interface Mem {
  prev: Map<string, Array<number | undefined>>;
  firedKeys: Set<string>;
  daily: Map<string, { fetchedDay: string; figs: DailyFigs }>;
  dbLoaded: Set<string>;
  lastTry: Map<string, number>;
  lastHousekeeping: number;
  lastRun: RunReport | null;
  holidaysWarmed?: boolean;
}
const g = globalThis as any;
const mem: Mem = g.__MC_PRICE_ALERTS__ || (g.__MC_PRICE_ALERTS__ = {
  prev: new Map(), firedKeys: new Set(), daily: new Map(), dbLoaded: new Set(), lastTry: new Map(), lastHousekeeping: 0, lastRun: null,
});

export interface RunReport {
  ok: boolean; at: string; skipped?: string; error?: string;
  alerts?: number; tickers?: number; quotes?: number; dailyFetched?: number; checked?: number; waiting?: number; fired?: number;
  notified?: { telegram: string; email: string } | null; listErrors?: string[]; capped?: boolean; ms?: number;
}
export function lastRunReport(): RunReport | null { return mem.lastRun; }

/** Pure: which tickers need daily figures fetched now, best first (gap alerts after the open, then never fetched, then stale). */
export function dailyFetchPlan(
  needs: Map<string, { open: boolean }>,
  have: Map<string, { fetchedDay: string; figs: DailyFigs }>,
  now: Date, lastTry: Map<string, number>, limit: number,
  started: (market: 'IN' | 'US') => boolean,
): string[] {
  const rank: Array<[number, string]> = [];
  for (const [mid, n] of needs) {
    const p = parseMid(mid); if (!p) continue;
    const today = marketDate(p.market, now);
    const h = have.get(mid);
    const tried = lastTry.get(mid) || 0;
    if (now.getTime() - tried < DAILY_RETRY_MS) continue;
    const wantOpen = n.open && started(p.market) && h?.figs.day !== today;
    if (h && h.fetchedDay === today && !wantOpen) continue;
    rank.push([wantOpen ? 0 : !h ? 1 : 2, mid]);
  }
  rank.sort((a, b) => a[0] - b[0]);
  return rank.slice(0, limit).map((r) => r[1]);
}

async function pool<T, R>(items: T[], conc: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/** One minute's check. Never throws. */
export async function runPriceAlerts(opts: { now?: Date; force?: boolean } = {}): Promise<RunReport> {
  const t0 = Date.now();
  const now = opts.now ?? new Date();
  const done = (r: Omit<RunReport, 'at'>): RunReport => { const rep = { ...r, at: now.toISOString(), ms: Date.now() - t0 }; if (!r.skipped) mem.lastRun = rep; return rep; };
  // the collected NSE holiday list (read from its store at most every 12 h; until then the built-in list is used)
  if (!mem.holidaysWarmed) { mem.holidaysWarmed = true; void import('@/lib/nse-holidays-server').then((m) => m.warmNseHolidays()).catch(() => { mem.holidaysWarmed = false; }); }
  if (!opts.force && !anySessionOpen(now)) return done({ ok: true, skipped: 'no market session open' });
  if (!dbAvailable()) return done({ ok: false, error: 'Postgres is not configured' });
  try {
    const store = await import('./store');
    if (!opts.force && !(await store.claimMinute(now.toISOString().slice(0, 16)))) return done({ ok: true, skipped: 'minute already checked by another server copy' });
    if (Date.now() - mem.lastHousekeeping > 3600_000) {
      mem.lastHousekeeping = Date.now();
      await store.expireDue().catch(() => 0);
      await store.pruneEvents().catch(() => 0);
      if (mem.firedKeys.size > 200_000) mem.firedKeys.clear();
      if (mem.prev.size > 200_000) mem.prev.clear();
    }
    const alerts = (await store.activeAlerts()).filter((a) => isLive(a, now));
    if (!alerts.length) return done({ ok: true, alerts: 0, tickers: 0, fired: 0 });

    // members right now (only alerts whose market session could be open are worth expanding... lists are cached anyway)
    const { expandAll, fetchLiveQuotes, fetchDailyFigs } = await import('./sources');
    const exp = await expandAll(alerts.map((a) => a.target));
    const expansions = new Map<string, Expanded>();
    const listErrors: string[] = [];
    alerts.forEach((a, i) => { expansions.set(a.id, exp[i]); if (exp[i].error) listErrors.push(`${a.name}: ${exp[i].error}`); });

    // tickers whose session (per the alert's setting) is open; single-ticker alerts first when over the cap
    const want = new Map<string, { daily: boolean; open: boolean; prio: number }>();
    for (const a of alerts) {
      const ex = expansions.get(a.id)!;
      const daily = a.conditions.some((c) => needsDaily(c, a.interval));
      const open = a.conditions.some(needsOpen);
      for (const mid of ex.mids) {
        const p = parseMid(mid);
        if (!p || !sessionOpen(p.market, a.session, now)) continue;
        const w = want.get(mid) || { daily: false, open: false, prio: 9 };
        w.daily ||= daily; w.open ||= open; w.prio = Math.min(w.prio, a.target.kind === 'ticker' ? 0 : 1);
        want.set(mid, w);
      }
    }
    let mids = [...want.keys()];
    const capped = mids.length > MAX_TICKERS_PER_RUN;
    if (capped) mids = mids.sort((x, y) => want.get(x)!.prio - want.get(y)!.prio).slice(0, MAX_TICKERS_PER_RUN);
    if (!mids.length) return done({ ok: true, alerts: alerts.length, tickers: 0, fired: 0, listErrors });

    // daily figures: memory → Postgres (once per process) → Yahoo for the ones due
    const dailyMids = mids.filter((m) => want.get(m)!.daily);
    const unseen = dailyMids.filter((m) => !mem.dbLoaded.has(m));
    if (unseen.length) {
      const got = await store.loadDaily(unseen).catch(() => new Map());
      for (const m of unseen) { mem.dbLoaded.add(m); const r = got.get(m); if (r && !mem.daily.has(m)) mem.daily.set(m, r); }
    }
    const needs = new Map(dailyMids.map((m) => [m, { open: want.get(m)!.open }] as const));
    const plan = dailyFetchPlan(needs, mem.daily, now, mem.lastTry, DAILY_FETCH_PER_RUN, (mk) => regularStarted(mk, now));
    const [quotes, fetched] = await Promise.all([
      fetchLiveQuotes(mids),
      pool(plan, 6, async (m) => {
        mem.lastTry.set(m, Date.now());
        const today = marketDate(parseMid(m)!.market, now);
        const figs = await fetchDailyFigs(m, today);
        return figs ? { mid: m, fetchedDay: today, figs } : null;
      }),
    ]);
    const fresh = fetched.filter((x): x is { mid: string; fetchedDay: string; figs: DailyFigs } => !!x);
    for (const f of fresh) mem.daily.set(f.mid, { fetchedDay: f.fetchedDay, figs: f.figs });
    if (fresh.length) await store.saveDaily(fresh).catch((e) => console.warn('[price-alerts] daily save failed', e?.message || e));

    const daily = new Map<string, DailyFigs>();
    for (const m of dailyMids) {
      const d = mem.daily.get(m);
      // figures from an earlier day are still usable for everything except today's gap (conditions check the date)
      if (d) daily.set(m, d.figs);
    }
    const ctx: EvalCtx = { now, quotes, daily, prev: mem.prev, firedKeys: mem.firedKeys, expansions };
    const rep = evaluateAlerts(alerts, ctx);
    let inserted: AlertEvent[];
    try { inserted = await store.insertEvents(rep.events); }
    catch (e) {
      // not written → forget the "already sent" marks so the next minute tries again
      for (const ev of rep.events) mem.firedKeys.delete(firedKey(ev.alertId, ev.mid, ev.dedupeKey));
      throw e;
    }

    const byAlert = new Map<string, { count: number; status: 'active' | 'triggered' }>();
    const alertById = new Map(alerts.map((a) => [a.id, a]));
    for (const e of inserted) {
      const a = alertById.get(e.alertId)!;
      const cur = byAlert.get(e.alertId) || { count: 0, status: statusAfterFire(a) };
      cur.count++; byAlert.set(e.alertId, cur);
    }
    await store.recordFires(byAlert);
    const notified = await sendExternal(inserted, alertById);
    return done({ ok: true, alerts: alerts.length, tickers: mids.length, quotes: quotes.size, dailyFetched: fresh.length, checked: rep.checked, waiting: rep.waiting, fired: inserted.length, notified, listErrors: listErrors.slice(0, 10), capped });
  } catch (e: any) {
    console.warn('[price-alerts] run failed', e?.message || e);
    return done({ ok: false, error: String(e?.message || e).slice(0, 300) });
  }
}

/** One Telegram / email message per run for the alerts that asked for it (≤ 30 lines). */
export function externalMessage(events: readonly AlertEvent[]): { subject: string; text: string } | null {
  if (!events.length) return null;
  const lines = events.slice(0, 30).map((e) => `• ${e.message}${e.price != null ? ` — ${e.market === 'IN' ? '₹' : '$'}${e.price.toFixed(2)}` : ''}${e.list ? ` (${e.list})` : ''}`);
  if (events.length > 30) lines.push(`… and ${events.length - 30} more — open Price alerts in Market Cockpit`);
  return { subject: `🔔 ${events.length === 1 ? `${events[0].ticker}: ${events[0].condition}` : `${events.length} price alerts fired`}`, text: lines.join('\n') };
}

async function sendExternal(inserted: AlertEvent[], alerts: Map<string, PriceAlert>): Promise<{ telegram: string; email: string } | null> {
  const tg = inserted.filter((e) => alerts.get(e.alertId)?.notify.telegram);
  const em = inserted.filter((e) => alerts.get(e.alertId)?.notify.email);
  if (!tg.length && !em.length) return null;
  const { notifyOwnerVia } = await import('@/lib/owner-notify');
  const res = { telegram: 'skipped', email: 'skipped' };
  // the same set on both channels when both are chosen for the same events; otherwise one message each
  const sameSet = tg.length === em.length && tg.every((e, i) => e.id === em[i].id);
  if (sameSet) {
    const m = externalMessage(tg)!;
    const r = await notifyOwnerVia({ ...m, topic: 'ALERTS' }, { telegram: true, email: true });
    return { telegram: r.telegram, email: r.email };
  }
  if (tg.length) res.telegram = (await notifyOwnerVia({ ...externalMessage(tg)!, topic: 'ALERTS' }, { telegram: true, email: false })).telegram;
  if (em.length) res.email = (await notifyOwnerVia({ ...externalMessage(em)!, topic: 'ALERTS' }, { telegram: false, email: true })).email;
  return res;
}

/** "Test" button: one event for the alert's first ticker with its live quote, sent on the alert's channels. */
export async function testFire(a: PriceAlert): Promise<{ event: AlertEvent | null; notified: { telegram: string; email: string } | null; error?: string }> {
  const { expandAll, fetchLiveQuotes } = await import('./sources');
  const store = await import('./store');
  const { renderMessage, exchangeOf } = await import('./trigger');
  const ex = (await expandAll([a.target]))[0];
  const mid = ex.mids[0];
  if (!mid) return { event: null, notified: null, error: ex.error || 'the list has no tickers' };
  const p = parseMid(mid)!;
  const q = (await fetchLiveQuotes([mid])).get(mid);
  const now = new Date();
  const change = q?.prevClose ? (q.price / q.prevClose - 1) * 100 : null;
  const condition = 'Test alert (conditions not checked)';
  const list = a.target.kind === 'ticker' ? null : ex.label;
  const [ev] = await store.insertEvents([{
    alertId: a.id, alertName: a.name, mid, market: p.market, ticker: p.ticker, name: q?.name ?? null, price: q?.price ?? null, changePct: change,
    condition, list, dedupeKey: `test:${now.toISOString()}`, toast: true, browser: a.notify.browser,
    message: `TEST · ${renderMessage(a.message, { ticker: p.ticker, name: q?.name, price: q?.price ?? null, change, condition, list, time: now, interval: a.interval, exchange: exchangeOf(mid), market: p.market })}`,
  }]);
  if (!ev) return { event: null, notified: null, error: 'not saved' };
  const notified = await sendExternal([ev], new Map([[a.id, a]]));
  return { event: ev, notified };
}
