// zzz1063 (A02) — delivers fired price alerts from the Postgres OUTBOX (price_alert_outbox) to Telegram, email and phone push.
//
// FIRE vs DELIVERY. A fire is recorded once (price_alert_event, unique per alert + ticker + bar / minute / once-generation) in
// the same transaction as its outbox rows (store.commitRun). Delivery is separate and retried on its own per channel:
//   claim (FOR UPDATE SKIP LOCKED, lease 10 min) → send ONE grouped message per channel → sent | failed (+1, 5, 15, 60, 60 min)
//   | gave_up (after 6 tries) | skipped (the channel is not set up on the server: no retry, nothing to fix by waiting).
// Runs right after a check that fired (engine.ts) and every minute as its own light job ('alert-delivery', lib/app-scheduler),
// INCLUDING outside market hours, so retries finish. It reads Postgres only when something is (or may be) due: the earliest due
// time is remembered in memory, with a full look every 5 minutes for rows another server copy wrote.
//
// NOT exactly-once on the network. A send that timed out may still have arrived; the retry can then repeat it. Email uses the
// provider's idempotency key (Resend `Idempotency-Key`, same rows → same key for 24 h); Telegram and Web Push have no such key,
// so a timed-out message may (rarely) come twice. A server that dies mid-send leaves its rows 'sending'; they are claimed again
// when the lease ends (same caveat), and after the last allowed try they are marked gave_up.
import { createHash } from 'node:crypto';
import type { NotifyMessage } from '@/lib/owner-notify';
import type { PushPayload } from '@/lib/push/contract';
import { externalMessage } from './messages';
import { retryDelayMin, type ClaimedRow, type DeliveryChannel, type OutboxUpdate } from './store';
import type { AlertEvent } from './types';

export interface ChannelSend { state: 'sent' | 'skipped' | 'error'; error?: string }
export interface DeliveryAdapters {
  telegram: (m: NotifyMessage) => Promise<ChannelSend>;
  email: (m: NotifyMessage) => Promise<ChannelSend>;
  push: (p: PushPayload) => Promise<ChannelSend>;
}
export interface DeliveryDeps {
  claim: (limit: number) => Promise<ClaimedRow[]>;
  events: (ids: number[]) => Promise<AlertEvent[]>;
  finish: (u: OutboxUpdate[]) => Promise<void>;
  giveUpLost: () => Promise<number>;
  nextDue: () => Promise<number | null>;
  adapters: DeliveryAdapters;
}
export interface DeliveryReport {
  ok: boolean; skipped?: string; error?: string;
  claimed: number; sent: number; failed: number; gaveUp: number; skippedRows: number;
  channels: Partial<Record<DeliveryChannel, { state: ChannelSend['state']; events: number; error?: string }>>;
}

/** Pure: how a channel's send outcome lands on each claimed row (rows may have different try counts). */
export function planOutcome(rows: readonly ClaimedRow[], res: ChannelSend): OutboxUpdate[] {
  if (res.state === 'sent') return [{ ids: rows.map((r) => r.id), status: 'sent', error: null, delayMin: null }];
  if (res.state === 'skipped') return [{ ids: rows.map((r) => r.id), status: 'skipped', error: res.error || 'channel not set up on the server', delayMin: null }];
  const groups = new Map<string, OutboxUpdate>();
  for (const r of rows) {
    const d = retryDelayMin(r.attempts);
    const k = d == null ? 'give' : `d${d}`;
    const u = groups.get(k) || { ids: [], status: d == null ? 'gave_up' : 'failed', error: res.error || 'send failed', delayMin: d };
    u.ids.push(r.id); groups.set(k, u);
  }
  return [...groups.values()];
}

/** Pure: claimed rows grouped per channel with their events; rows whose event no longer exists are returned apart. */
export function groupClaimed(rows: readonly ClaimedRow[], events: readonly AlertEvent[]): { byChannel: Map<DeliveryChannel, { rows: ClaimedRow[]; events: AlertEvent[] }>; orphans: ClaimedRow[] } {
  const ev = new Map(events.map((e) => [e.id, e]));
  const byChannel = new Map<DeliveryChannel, { rows: ClaimedRow[]; events: AlertEvent[] }>();
  const orphans: ClaimedRow[] = [];
  for (const r of rows) {
    const e = ev.get(r.eventId);
    if (!e) { orphans.push(r); continue; }
    const g = byChannel.get(r.channel) || { rows: [], events: [] };
    g.rows.push(r);
    if (!g.events.some((x) => x.id === e.id)) g.events.push(e);
    byChannel.set(r.channel, g);
  }
  return { byChannel, orphans };
}

/** Pure: idempotency key for one grouped send (same rows → same key). */
export function idempotencyKeyFor(channel: DeliveryChannel, rows: readonly ClaimedRow[]): string {
  return `mc-alert-${channel}-${createHash('sha256').update(rows.map((r) => r.id).sort((a, b) => a - b).join(',')).digest('hex').slice(0, 32)}`;
}

/** One delivery pass. Never throws. */
export async function deliverOnce(deps: DeliveryDeps, limit = 200): Promise<DeliveryReport> {
  const rep: DeliveryReport = { ok: true, claimed: 0, sent: 0, failed: 0, gaveUp: 0, skippedRows: 0, channels: {} };
  try {
    rep.gaveUp += await deps.giveUpLost();
    const rows = await deps.claim(limit);
    rep.claimed = rows.length;
    if (!rows.length) return rep;
    const events = await deps.events([...new Set(rows.map((r) => r.eventId))]);
    const { byChannel, orphans } = groupClaimed(rows, events);
    const updates: OutboxUpdate[] = [];
    if (orphans.length) { updates.push({ ids: orphans.map((r) => r.id), status: 'gave_up', error: 'the alert event was deleted', delayMin: null }); rep.gaveUp += orphans.length; }
    await Promise.all([...byChannel].map(async ([ch, g]) => {
      let res: ChannelSend;
      try {
        if (ch === 'push') {
          const { pushForEvents } = await import('@/lib/push/server');
          res = await deps.adapters.push(pushForEvents(g.events)!);
        } else {
          const m = externalMessage(g.events)!;
          res = await deps.adapters[ch]({ ...m, topic: 'ALERTS', idempotencyKey: idempotencyKeyFor(ch, g.rows) });
        }
      } catch (e: any) { res = { state: 'error', error: String(e?.message || e).slice(0, 200) }; }
      rep.channels[ch] = { state: res.state, events: g.events.length, error: res.error };
      const plan = planOutcome(g.rows, res);
      for (const u of plan) {
        if (u.status === 'sent') rep.sent += u.ids.length; else if (u.status === 'failed') rep.failed += u.ids.length;
        else if (u.status === 'gave_up') rep.gaveUp += u.ids.length; else rep.skippedRows += u.ids.length;
      }
      updates.push(...plan);
    }));
    await deps.finish(updates);
    return rep;
  } catch (e: any) {
    return { ...rep, ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}

// ── the real thing: Postgres + owner-notify + push ───────────────────────────

export async function defaultAdapters(): Promise<DeliveryAdapters> {
  const [{ notifyOwnerVia }, { sendPushToAll }] = await Promise.all([import('@/lib/owner-notify'), import('@/lib/push/server')]);
  const one = (which: 'telegram' | 'email') => async (m: NotifyMessage): Promise<ChannelSend> => {
    const r = await notifyOwnerVia(m, { telegram: which === 'telegram', email: which === 'email' });
    const state = r[which];
    const prefixes = which === 'email' ? ['email', 'smtp'] : ['telegram'];
    return { state, error: r.errors.find((e) => prefixes.some((p) => e.startsWith(p))) };
  };
  return {
    telegram: one('telegram'),
    email: one('email'),
    push: async (p) => { const r = await sendPushToAll(p); return { state: r.state, error: r.error }; },
  };
}
async function defaultDeps(): Promise<DeliveryDeps> {
  const store = await import('./store');
  return {
    claim: (n) => store.claimOutbox(n), events: (ids) => store.eventsByIds(ids), finish: (u) => store.finishOutbox(u),
    giveUpLost: () => store.giveUpLostSends(), nextDue: () => store.nextOutboxDue(), adapters: await defaultAdapters(),
  };
}

const SWEEP_MS = 5 * 60_000;
const g = globalThis as any;
const mem: { nextDueAt: number | null; lastSweep: number; running: Promise<DeliveryReport> | null; last: DeliveryReport | null } =
  g.__MC_ALERT_DELIVERY__ || (g.__MC_ALERT_DELIVERY__ = { nextDueAt: null, lastSweep: 0, running: null, last: null });

/** Something was just written to the outbox (by this process): deliver on the next call. */
export function noteOutboxWork(): void { mem.nextDueAt = Date.now(); }
export function lastDeliveryReport(): DeliveryReport | null { return mem.last; }

/** Pure: should the delivery job read Postgres now? */
export function deliveryDue(nextDueAt: number | null, lastSweep: number, now: number): boolean {
  if (now - lastSweep >= SWEEP_MS) return true;
  return nextDueAt != null && nextDueAt <= now;
}

/**
 * Delivers what is due (a few passes while rows keep coming, ≤ 4). With no Postgres it does nothing. One run at a time per
 * process; other server copies are kept apart by SKIP LOCKED. Never throws.
 */
export async function deliverDue(opts: { force?: boolean; deps?: DeliveryDeps; now?: number } = {}): Promise<DeliveryReport> {
  const now = opts.now ?? Date.now();
  if (!opts.deps) {
    const { dbAvailable } = await import('@/lib/db');
    if (!dbAvailable()) return { ok: true, skipped: 'Postgres is not configured', claimed: 0, sent: 0, failed: 0, gaveUp: 0, skippedRows: 0, channels: {} };
  }
  if (!opts.force && !deliveryDue(mem.nextDueAt, mem.lastSweep, now)) return { ok: true, skipped: 'nothing due', claimed: 0, sent: 0, failed: 0, gaveUp: 0, skippedRows: 0, channels: {} };
  if (mem.running) return mem.running;
  mem.running = (async () => {
    const deps = opts.deps ?? await defaultDeps();
    const total: DeliveryReport = { ok: true, claimed: 0, sent: 0, failed: 0, gaveUp: 0, skippedRows: 0, channels: {} };
    for (let i = 0; i < 4; i++) {
      const r = await deliverOnce(deps);
      total.claimed += r.claimed; total.sent += r.sent; total.failed += r.failed; total.gaveUp += r.gaveUp; total.skippedRows += r.skippedRows;
      Object.assign(total.channels, r.channels);
      if (!r.ok) { total.ok = false; total.error = r.error; break; }
      if (r.claimed < 200) break;
    }
    mem.lastSweep = Date.now();
    mem.nextDueAt = await deps.nextDue().catch(() => Date.now() + 60_000);
    if (total.claimed || total.gaveUp || !total.ok) mem.last = total;
    return total;
  })().finally(() => { mem.running = null; });
  return mem.running;
}
