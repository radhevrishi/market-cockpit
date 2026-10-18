// zzz1054 — the price-alert checker, run every minute by the app scheduler (lib/app-scheduler LIGHT_JOBS 'price-alerts').
//
// Cost per minute (nothing at all when no market session is open — the check is a clock test, no I/O):
//   Postgres  — claim the minute (1 UPDATE), active alerts (1 SELECT), events (≤ 1 INSERT per 200 fires), fire counts
//               (1 UPDATE per alert that fired), daily figures (load once per process, save the new ones). Hourly: expire + prune.
//   Redis     — none in the loop. Lists come from Postgres user_state (5-min memory cache); the US book (Redis-primary) is read
//               at most every 10 minutes and only when an alert targets it. The scheduler's heartbeat is posted every 15 min.
//   Yahoo     — one spark request per 20 tickers whose session is open; daily bars once per ticker per market day
//               (≤ 60 tickers a minute, the ones with gap alerts first).
//   zzz1061 signals (only when an active alert has a Stage / Cheat Entry / setup / accumulation / results / guidance condition):
//               the screener snapshot from the shared in-memory copy (a tiny built_at read a minute at most), signal states loaded
//               once per process per alert and written only when a state or edge changes; results ≤ 2 Redis reads per market
//               every 30 min, guidance 1 Postgres query every 30 min (signal-sources.ts).
// Two server copies (during a deploy) never check the same minute: claimMinute() is an atomic compare-and-set in Postgres,
// and every event row is unique per (alert, ticker, bar / minute), so nothing is ever recorded twice.
//
// zzz1063 (A01/A02/A03/A05/A06):
//   • quotes and daily figures pass the freshness contract in evaluate.ts (waits are counted per reason in the run report);
//   • sessions come from lib/exchange-calendar (13:00 ET early closes, holidays, DST);
//   • crossing states are loaded from Postgres once per alert version and written — with the events, their outbox rows and the
//     fire counts — in ONE transaction (store.commitRun); memory moves on only after it committed;
//   • Telegram / email / push go through the outbox (delivery.ts) with retries; the run delivers what it just fired at once.
import { dbAvailable } from '@/lib/db';
import { anySessionOpen, sessionOpen, marketDate, regularStarted, expectedDailyAsOf } from './session';
import { needsDaily, needsOpen, FIGS_VERSION, type DailyFigs } from './conditions';
import { evaluateAlerts, firedKey, WAIT_TEXT, type EvalCtx, type WaitReason } from './evaluate';
import { statusAfterFire, isLive } from './trigger';
import { parseMid, type PriceAlert, type AlertEvent, type AlertMarket } from './types';
import { sourcesFor, type SignalSource, type SignalState } from './signals';
import type { Expanded } from './targets';
import type { DeliveryChannel, NewEvent, CrossRow } from './store';
import type { DeliveryReport } from './delivery';
export { externalMessage } from './messages';
import { externalMessage } from './messages';

export const MAX_TICKERS_PER_RUN = 2500;
export const DAILY_FETCH_PER_RUN = 60;
const DAILY_RETRY_MS = 5 * 60_000;
const STALE_REFETCH_MS = 30 * 60_000;

interface Mem {
  prev: Map<string, Array<number | undefined>>;
  firedKeys: Set<string>;
  daily: Map<string, { fetchedDay: string; figs: DailyFigs }>;
  dbLoaded: Set<string>;
  lastTry: Map<string, number>;
  lastHousekeeping: number;
  lastRun: RunReport | null;
  holidaysWarmed?: boolean;
  /** zzz1061 — signal condition states (signals.ts), the alerts whose stored states were loaded, keys to write */
  sigStates?: Map<string, SignalState>;
  sigLoaded?: Set<string>;
  /** zzz1063 — `${alertId}|${version}` whose crossing states were loaded from Postgres; last stored state per key */
  crossLoaded?: Set<string>;
  crossSaved?: Map<string, string>;
}
const g = globalThis as any;
const mem: Mem = g.__MC_PRICE_ALERTS__ || (g.__MC_PRICE_ALERTS__ = {
  prev: new Map(), firedKeys: new Set(), daily: new Map(), dbLoaded: new Set(), lastTry: new Map(), lastHousekeeping: 0, lastRun: null,
});

export interface RunReport {
  ok: boolean; at: string; skipped?: string; error?: string;
  alerts?: number; tickers?: number; quotes?: number; dailyFetched?: number; checked?: number; waiting?: number; fired?: number;
  /** zzz1061 — signal sources read this run (e.g. 'IN:screen') and signal states written */
  signalSources?: string[]; signalWrites?: number;
  notified?: { telegram: string; email: string } | null; listErrors?: string[]; capped?: boolean; ms?: number;
  /** zzz1063 — why tickers waited (counts) and the same in words; outbox rows written; this run's delivery pass */
  waitReasons?: Partial<Record<WaitReason, number>>; waitText?: string[]; outbox?: number; crossWrites?: number; delivery?: DeliveryReport | null;
}

/** Pure: a crossing state row is written only when its stored value changed (and it has at least one crossing side). */
export function crossChanges(updates: ReadonlyArray<[string, Array<number | undefined>]>, saved: ReadonlyMap<string, string>): Array<{ key: string; json: string; row: CrossRow }> {
  const out: Array<{ key: string; json: string; row: CrossRow }> = [];
  for (const [key, states] of updates) {
    if (!states.some((x) => x !== undefined)) continue;
    const json = JSON.stringify(states.map((x) => (x === undefined ? null : x)));
    if (saved.get(key) === json) continue;
    const m = /^(.+?)\|(\d+)\|(.+)$/.exec(key);
    if (!m) continue;
    out.push({ key, json, row: { alertId: m[1], version: Number(m[2]), mid: m[3], states } });
  }
  return out;
}
/** Pure: the outbox channels of an alert's event (push: on unless turned off). */
export function channelsOf(a: Pick<PriceAlert, 'notify'> | undefined): DeliveryChannel[] {
  if (!a) return [];
  const out: DeliveryChannel[] = [];
  if (a.notify.telegram) out.push('telegram');
  if (a.notify.email) out.push('email');
  if (a.notify.push !== false) out.push('push');
  return out;
}
export function lastRunReport(): RunReport | null { return mem.lastRun; }

/** Pure: which tickers need daily figures fetched now, best first (gap alerts after the open, then never fetched, then stale). */
export function dailyFetchPlan(
  needs: Map<string, { open: boolean }>,
  have: Map<string, { fetchedDay: string; figs: DailyFigs }>,
  now: Date, lastTry: Map<string, number>, limit: number,
  started: (market: 'IN' | 'US') => boolean,
  /** zzz1063 — the completed session the figures should end on; a set fetched today that still ends earlier is fetched again
   *  (at most every 30 min) — Yahoo sometimes publishes yesterday's bar late */
  expectedAsOf?: (market: 'IN' | 'US', today: string) => string,
): string[] {
  const rank: Array<[number, string]> = [];
  for (const [mid, n] of needs) {
    const p = parseMid(mid); if (!p) continue;
    const today = marketDate(p.market, now);
    const h = have.get(mid);
    const tried = lastTry.get(mid) || 0;
    if (now.getTime() - tried < DAILY_RETRY_MS) continue;
    const wantOpen = n.open && started(p.market) && h?.figs.day !== today;
    const staleSet = !!h && !!expectedAsOf && h.figs.asOf < expectedAsOf(p.market, today) && now.getTime() - tried >= STALE_REFETCH_MS;
    if (h && h.fetchedDay === today && !wantOpen && !staleSet) continue;
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
      await store.pruneSignalStates().catch(() => 0);
      if (mem.firedKeys.size > 200_000) mem.firedKeys.clear();
      if (mem.prev.size > 200_000) mem.prev.clear();
      if ((mem.sigStates?.size ?? 0) > 300_000) { mem.sigStates!.clear(); mem.sigLoaded?.clear(); }
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
    const sigNeeds = new Map<AlertMarket, Set<SignalSource>>();   // zzz1061
    const sigAlerts: string[] = [];
    for (const a of alerts) {
      const ex = expansions.get(a.id)!;
      const daily = a.conditions.some((c) => needsDaily(c, a.interval));
      const open = a.conditions.some(needsOpen);
      const srcs = sourcesFor(a.conditions);
      if (srcs.size) sigAlerts.push(a.id);
      for (const mid of ex.mids) {
        const p = parseMid(mid);
        if (!p || !sessionOpen(p.market, a.session, now)) continue;
        if (srcs.size) { const s = sigNeeds.get(p.market) || new Set<SignalSource>(); for (const x of srcs) s.add(x); sigNeeds.set(p.market, s); }
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
      // zzz1063 — figures stored before FIGS_VERSION (no history coverage) are fetched again
      for (const m of unseen) { mem.dbLoaded.add(m); const r = got.get(m); if (r && r.figs?.v === FIGS_VERSION && !mem.daily.has(m)) mem.daily.set(m, r); }
    }
    for (const m of dailyMids) { const d = mem.daily.get(m); if (d && d.figs.v !== FIGS_VERSION) mem.daily.delete(m); }
    const needs = new Map(dailyMids.map((m) => [m, { open: want.get(m)!.open }] as const));
    const plan = dailyFetchPlan(needs, mem.daily, now, mem.lastTry, DAILY_FETCH_PER_RUN, (mk) => regularStarted(mk, now), (mk, today) => expectedDailyAsOf(mk, today));
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
    // zzz1063 (A02) — crossing states from Postgres, once per alert version per process (a restart / deploy keeps them)
    const crossLoaded = mem.crossLoaded || (mem.crossLoaded = new Set());
    const crossSaved = mem.crossSaved || (mem.crossSaved = new Map());
    const unloaded = alerts.filter((a) => !crossLoaded.has(`${a.id}|${a.version}`));
    if (unloaded.length) {
      const got = await store.loadCrossStates(unloaded.map((a) => ({ id: a.id, version: a.version }))).catch(() => null);
      if (got) {
        for (const a of unloaded) crossLoaded.add(`${a.id}|${a.version}`);
        for (const [k, st] of got) { if (!mem.prev.has(k)) mem.prev.set(k, st); crossSaved.set(k, JSON.stringify(st.map((x) => (x === undefined ? null : x)))); }
      }
    }
    const ctx: EvalCtx = { now, quotes, daily, prev: mem.prev, firedKeys: mem.firedKeys, expansions, deferState: true };

    // zzz1061 — the app's own signals: states (Postgres, once per process per alert) + the data views the alerts need
    let signalSources: string[] | undefined;
    if (sigNeeds.size) {
      const states = mem.sigStates || (mem.sigStates = new Map());
      const loaded = mem.sigLoaded || (mem.sigLoaded = new Set());
      const unseenAlerts = sigAlerts.filter((id) => !loaded.has(id));
      if (unseenAlerts.length) {
        const got = await store.loadSignalStates(unseenAlerts).catch(() => null);
        if (got) { for (const id of unseenAlerts) loaded.add(id); for (const [k, v] of got) if (!states.has(k)) states.set(k, v); }
      }
      const { readSignalFeeds } = await import('./signal-sources');
      const feeds = await readSignalFeeds(sigNeeds, now);
      ctx.signals = { states, dirty: new Set(), feeds };
      signalSources = [...sigNeeds].flatMap(([m, s]) => [...s].map((x) => `${m}:${x}${(feeds.get(m) as any)?.[x] ? '' : ' (unavailable)'}`));
    }
    const rep = evaluateAlerts(alerts, ctx);
    const alertById = new Map(alerts.map((a) => [a.id, a]));
    const changes = crossChanges(rep.stateUpdates, crossSaved);
    let inserted: AlertEvent[], outbox = 0;
    try {
      const r = await store.commitRun({
        events: rep.events,
        channelsFor: (e: NewEvent) => channelsOf(alertById.get(e.alertId)),
        cross: changes.map((c) => c.row),
        statusFor: (id) => statusAfterFire(alertById.get(id)!),
      });
      inserted = r.inserted; outbox = r.outbox;
    } catch (e) {
      // not written → crossing states are NOT moved on (the crossing is seen again next minute), the "already recorded"
      // marks are forgotten so the next minute tries again, and used signal edges are put back
      for (const ev of rep.events) mem.firedKeys.delete(firedKey(ev.alertId, ev.mid, ev.dedupeKey));
      if (ctx.signals) for (const [k, st] of rep.consumed || []) ctx.signals.states.set(k, st);
      throw e;
    }
    // committed: memory moves on
    for (const [k, st] of rep.stateUpdates) mem.prev.set(k, st);
    for (const c of changes) crossSaved.set(c.key, c.json);
    let signalWrites = 0;
    if (ctx.signals?.dirty.size) {
      const rows = [...ctx.signals.dirty].flatMap((k) => { const st = ctx.signals!.states.get(k); return st ? [[k, st] as [string, SignalState]] : []; });
      await store.saveSignalStates(rows).then(() => { signalWrites = rows.length; }).catch((e) => console.warn('[price-alerts] signal state save failed', e?.message || e));
    }

    let delivery: DeliveryReport | null = null;
    if (outbox) {
      const d = await import('./delivery');
      d.noteOutboxWork();
      delivery = await d.deliverDue();
    }
    const notified = delivery ? { telegram: delivery.channels.telegram?.state ?? 'skipped', email: delivery.channels.email?.state ?? 'skipped' } : null;
    const waitText = (Object.entries(rep.waitReasons) as Array<[WaitReason, number]>).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} waiting: ${WAIT_TEXT[k]}`);
    return done({ ok: true, alerts: alerts.length, tickers: mids.length, quotes: quotes.size, dailyFetched: fresh.length, checked: rep.checked, waiting: rep.waiting, fired: inserted.length, notified, listErrors: listErrors.slice(0, 10), capped, signalSources, signalWrites, waitReasons: rep.waitReasons, waitText, outbox, crossWrites: changes.length, delivery });
  } catch (e: any) {
    console.warn('[price-alerts] run failed', e?.message || e);
    return done({ ok: false, error: String(e?.message || e).slice(0, 300) });
  }
}

/** "Test" button: one event for the alert's first ticker with its live quote, sent on every set-up channel (not via the
 *  outbox: a test reports delivery at once). zzz1063 — also a push to every saved phone / browser, with a result line. */
export async function testFire(a: PriceAlert): Promise<{ event: AlertEvent | null; notified: { telegram: string; email: string; push?: string } | null; report?: string[]; error?: string }> {
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
  // zzz1062 — a test checks DELIVERY: it goes to every channel that is set up on the server, ticked on this alert or not,
  // and says plainly which channel was not ticked (real alerts still use only the ticked channels).
  const { notifyOwnerVia, notifyDiagnosis } = await import('@/lib/owner-notify');
  const diag = notifyDiagnosis('ALERTS');
  const via = { telegram: diag.telegram.ready, email: diag.email.ready };
  const [r, push] = await Promise.all([
    via.telegram || via.email ? notifyOwnerVia({ ...externalMessage([ev])!, topic: 'ALERTS' }, via) : Promise.resolve({ telegram: 'skipped' as const, email: 'skipped' as const, errors: [] as string[] }),
    import('@/lib/push/server').then((m) => m.sendPushToAll({ ...m.pushForEvents([ev])!, title: `TEST · ${m.pushForEvents([ev])!.title}`.slice(0, 120) })).catch((e) => ({ state: 'error' as const, error: String(e?.message || e), results: [] })),
  ]);
  return {
    event: ev,
    notified: { telegram: r.telegram, email: r.email, push: push.state },
    report: testReport(r, diag, a.notify, push),
  };
}

/** zzz1062 — plain-English lines for the Test result. Exported for tests. zzz1063 — a third line for push when given. */
export function testReport(
  r: { telegram: string; email: string; errors: string[] },
  diag: { telegram: { ready: boolean; missing: string[] }; email: { ready: boolean; missing: string[]; toMasked: string | null } },
  ticked: { telegram: boolean; email: boolean; push?: boolean },
  push?: { state: string; error?: string; results: Array<{ ok: boolean; label: string | null; endpointShort: string; error: string | null }> },
): string[] {
  const lines = testReportTgEmail(r, diag, ticked);
  if (push) lines.push(pushLine(push, ticked.push !== false));
  return lines;
}
/** zzz1063 — the push line of a Test result. */
export function pushLine(push: { state: string; error?: string; results: Array<{ ok: boolean; label: string | null; endpointShort: string; error: string | null }> }, isTicked = true): string {
  const tick = isTicked ? '' : ' Note: Push is NOT ticked on this alert, so real alerts won\'t use it — press Edit and tick Push.';
  if (push.state === 'skipped') return 'Push: no phone or browser has turned on push yet — open Price alerts on your phone and press "Turn on phone alerts".';
  const ok = push.results.filter((x) => x.ok).length;
  const bad = push.results.filter((x) => !x.ok).map((x) => `${x.label || x.endpointShort} (${x.error})`);
  if (push.state === 'sent') return `Push: sent to ${ok} device${ok === 1 ? '' : 's'}${bad.length ? `; failed on ${bad.join(', ')}` : ''}.${tick}`;
  return `Push: failed — ${bad.length ? bad.join(', ') : push.error || 'no reason given'}.${tick}`;
}
function testReportTgEmail(
  r: { telegram: string; email: string; errors: string[] },
  diag: { telegram: { ready: boolean; missing: string[] }; email: { ready: boolean; missing: string[]; toMasked: string | null } },
  ticked: { telegram: boolean; email: boolean },
): string[] {
  const err = (prefix: string) => r.errors.find((e) => e.startsWith(prefix)) || '';
  const line = (label: string, state: string, ready: boolean, missing: string[], isTicked: boolean, errText: string, sentTo: string) => {
    if (!ready) return `${label}: not set up on the server — Railway is missing ${missing.join(' and ')}.`;
    const tickNote = isTicked ? '' : ` Note: ${label} is NOT ticked on this alert, so real alerts won't use it — press Edit and tick ${label}.`;
    if (state === 'sent') return `${label}: sent${sentTo}.${tickNote}`;
    return `${label}: failed — ${errText.replace(/^(telegram|email|smtp)\s*/i, '') || 'no reason given'}.${tickNote}${hintFor(label, errText)}`;
  };
  return [
    line('Email', r.email, diag.email.ready, diag.email.missing, ticked.email, err('email') || err('smtp'), diag.email.toMasked ? ` to ${diag.email.toMasked} (check Spam too)` : ''),
    line('Telegram', r.telegram, diag.telegram.ready, diag.telegram.missing, ticked.telegram, err('telegram'), ''),
  ];
}

function hintFor(label: string, e: string): string {
  const s = e.toLowerCase();
  if (label === 'Telegram') {
    if (s.includes('chat not found')) return ' Fix: open your bot in Telegram and press Start, then put your own chat id in TELEGRAM_CHAT_ID.';
    if (s.includes('401') || s.includes('unauthorized')) return ' Fix: TELEGRAM_BOT_TOKEN is wrong — copy it again from @BotFather.';
    if (s.includes('blocked')) return ' Fix: you blocked the bot — unblock it in Telegram.';
    return '';
  }
  if (s.includes('own email') || s.includes('testing emails')) return ' Fix: with the free Resend sender, NOTIFY_EMAIL_TO must be the same address you signed up to Resend with.';
  if (s.includes('401') || s.includes('api key')) return ' Fix: RESEND_API_KEY is wrong — create a new key in Resend and paste it again.';
  if (s.includes('domain')) return ' Fix: remove NOTIFY_EMAIL_FROM (or verify that domain in Resend).';
  return '';
}
