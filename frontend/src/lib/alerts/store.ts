// zzz1054 — Postgres storage for price alerts (server only). Personal data: every save is acknowledged only after the database
// committed it; when Postgres is not configured or unreachable the call throws AlertStoreUnavailable and the API answers 503 —
// an alert is never reported as saved when it was not. No Redis is used anywhere here.
import { randomBytes } from 'node:crypto';
import { getPool, dbAvailable } from '@/lib/db';
import { ensureSchema } from '@/lib/db-migrate';
import { EVENT_CAP, EVENT_RETENTION_DAYS, MAX_ALERTS, type AlertEvent, type AlertInput, type AlertStatus, type PriceAlert } from './types';
import type { DailyFigs } from './conditions';
import type { SignalState } from './signals';

export class AlertStoreUnavailable extends Error { constructor(msg = 'database not available — nothing was saved') { super(msg); } }
export class AlertConflict extends Error { constructor(public current: PriceAlert | null) { super('This alert was changed elsewhere; reload and try again'); } }
export class AlertLimit extends Error {}

async function pool() {
  if (!dbAvailable()) throw new AlertStoreUnavailable('Postgres is not configured — alerts cannot be saved');
  const p = getPool();
  if (!p || !(await ensureSchema())) throw new AlertStoreUnavailable();
  return p;
}
const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());

export function rowToAlert(r: any): PriceAlert {
  const s = typeof r.spec === 'string' ? JSON.parse(r.spec) : r.spec || {};
  return {
    id: r.id, name: r.name, status: r.status as AlertStatus,
    target: s.target, conditions: s.conditions || [], interval: s.interval || 'D', trigger: s.trigger || 'per_bar', session: s.session || 'regular',
    message: s.message || '', notify: { app: true, toast: s.notify?.toast !== false, browser: !!s.notify?.browser, telegram: !!s.notify?.telegram, email: !!s.notify?.email, push: s.notify?.push !== false },
    expiresAt: iso(r.expires_at), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, version: Number(r.version),
    lastFiredAt: iso(r.last_fired_at), fireCount: Number(r.fire_count || 0), armGen: Number(r.arm_gen || 0),
  };
}
const specOf = (a: AlertInput) => JSON.stringify({ target: a.target, conditions: a.conditions, interval: a.interval, trigger: a.trigger, session: a.session, message: a.message, notify: a.notify });

export async function listAlerts(): Promise<PriceAlert[]> {
  const p = await pool();
  return (await p.query('SELECT * FROM price_alert ORDER BY created_at DESC')).rows.map(rowToAlert);
}
export async function getAlert(id: string): Promise<PriceAlert | null> {
  const p = await pool();
  const r = (await p.query('SELECT * FROM price_alert WHERE id = $1', [id])).rows[0];
  return r ? rowToAlert(r) : null;
}
/** Active alerts for the checker (one query a minute; Postgres, not Redis). */
export async function activeAlerts(): Promise<PriceAlert[]> {
  const p = await pool();
  return (await p.query(`SELECT * FROM price_alert WHERE status = 'active'`)).rows.map(rowToAlert);
}

export async function createAlert(a: AlertInput): Promise<PriceAlert> {
  const p = await pool();
  const n = Number((await p.query('SELECT count(*)::int AS n FROM price_alert')).rows[0]?.n || 0);
  if (n >= MAX_ALERTS) throw new AlertLimit(`at most ${MAX_ALERTS} alerts — delete old ones first`);
  const id = `pa_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
  const r = (await p.query(
    `INSERT INTO price_alert (id, name, spec, status, expires_at) VALUES ($1, $2, $3::jsonb, 'active', $4) RETURNING *`,
    [id, a.name, specOf(a), a.expiresAt],
  )).rows[0];
  return rowToAlert(r);
}

/** zzz1063 (A05) — does this edit change WHAT fires (target, conditions, interval, trigger, session)? Name, message,
 *  notifications and expiry are cosmetic. Pure; exported for tests. */
export function firingChanged(before: Pick<AlertInput, 'target' | 'conditions' | 'interval' | 'trigger' | 'session'>, after: Pick<AlertInput, 'target' | 'conditions' | 'interval' | 'trigger' | 'session'>): boolean {
  const k = (x: typeof before) => JSON.stringify([x.target, x.conditions, x.interval, x.trigger, x.session]);
  return k(before) !== k(after);
}

/** Replaces the alert's settings when `baseVersion` is still current (else AlertConflict).
 *  zzz1063 (A05): a FIRING edit (target / conditions / interval / trigger / session) makes a stopped alert (triggered / expired)
 *  watch again unless it was paused — as before. A COSMETIC edit (name / message / notifications / expiry) keeps the status,
 *  so a triggered "once" alert stays triggered; only Rearm (rearmAlert) starts a new "once" lifecycle. An expired alert whose
 *  new expiry is in the future is watched again either way. */
export async function updateAlert(id: string, a: AlertInput, baseVersion: number): Promise<PriceAlert> {
  const p = await pool();
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    const cur = (await c.query('SELECT * FROM price_alert WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur || Number(cur.version) !== baseVersion) { await c.query('ROLLBACK'); throw new AlertConflict(cur ? rowToAlert(cur) : null); }
    const firing = firingChanged(rowToAlert(cur), a);
    const r = (await c.query(
      `UPDATE price_alert SET name = $2, spec = $3::jsonb, expires_at = $4, updated_at = now(), version = version + 1,
         status = CASE WHEN status = 'paused' THEN 'paused'
                       WHEN $5 THEN 'active'
                       WHEN status = 'expired' AND ($4::timestamptz IS NULL OR $4::timestamptz > now()) THEN 'active'
                       ELSE status END
       WHERE id = $1 RETURNING *`,
      [id, a.name, specOf(a), a.expiresAt, firing],
    )).rows[0];
    await c.query('COMMIT');
    return rowToAlert(r);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

/** zzz1063 (A05) — Rearm: a new "once" lifecycle. Raises the activation generation (new dedupe key 'once:gN', so every ticker
 *  may fire once more), starts a triggered alert watching again (a paused one stays paused; one past its expiry stays expired)
 *  and resets crossing state (new version). */
export async function rearmAlert(id: string, baseVersion: number): Promise<PriceAlert> {
  const p = await pool();
  const r = (await p.query(
    `UPDATE price_alert SET arm_gen = arm_gen + 1, version = version + 1, updated_at = now(),
       status = CASE WHEN status = 'paused' THEN 'paused'
                     WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'expired'
                     ELSE 'active' END
     WHERE id = $1 AND version = $2 RETURNING *`,
    [id, baseVersion],
  )).rows[0];
  if (!r) throw new AlertConflict(await getAlert(id));
  return rowToAlert(r);
}

export async function setAlertStatus(id: string, status: 'active' | 'paused', baseVersion: number): Promise<PriceAlert> {
  const p = await pool();
  const r = (await p.query(
    `UPDATE price_alert SET status = $2, updated_at = now(), version = version + 1 WHERE id = $1 AND version = $3 RETURNING *`,
    [id, status, baseVersion],
  )).rows[0];
  if (!r) throw new AlertConflict(await getAlert(id));
  return rowToAlert(r);
}

export async function deleteAlert(id: string): Promise<boolean> {
  const p = await pool();
  return ((await p.query('DELETE FROM price_alert WHERE id = $1', [id])).rowCount || 0) > 0;
}

// ── events ──────────────────────────────────────────────────────────────────

export function rowToEvent(r: any): AlertEvent {
  return {
    id: Number(r.id), alertId: r.alert_id, alertName: r.alert_name, mid: r.mid, market: r.market, ticker: r.ticker, name: r.name ?? null,
    price: r.price == null ? null : Number(r.price), changePct: r.change_pct == null ? null : Number(r.change_pct),
    condition: r.condition, list: r.list ?? null, message: r.message, firedAt: iso(r.fired_at)!, dedupeKey: r.dedupe_key,
    read: r.read_at != null, toast: !!r.toast, browser: !!r.browser,
  };
}

/** zzz1063 — `order: 'asc'` lists oldest first (the bell's cursor: after afterId, ascending, so a burst is read page by page). */
export interface EventQuery { limit?: number; beforeId?: number; afterId?: number; alertId?: string; ticker?: string; market?: 'IN' | 'US'; unread?: boolean; sinceDays?: number; order?: 'asc' | 'desc' }
export async function listEvents(q: EventQuery = {}): Promise<AlertEvent[]> {
  const p = await pool();
  const where: string[] = [], args: any[] = [];
  const add = (sql: string, v: any) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
  if (q.beforeId) add('id < ?', q.beforeId);
  if (q.afterId) add('id > ?', q.afterId);
  if (q.alertId) add('alert_id = ?', q.alertId);
  if (q.ticker) add('ticker = ?', q.ticker.toUpperCase());
  if (q.market) add('market = ?', q.market);
  if (q.unread) where.push('read_at IS NULL');
  if (q.sinceDays) add(`fired_at > now() - (? || ' days')::interval`, String(Math.min(EVENT_RETENTION_DAYS, Math.max(1, Math.round(q.sinceDays)))));
  const limit = Math.min(500, Math.max(1, q.limit || 100));
  const sql = `SELECT * FROM price_alert_event ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id ${q.order === 'asc' ? 'ASC' : 'DESC'} LIMIT ${limit}`;
  return (await p.query(sql, args)).rows.map(rowToEvent);
}
export async function unreadSummary(): Promise<{ unread: number; latestId: number }> {
  const p = await pool();
  const r = (await p.query(`SELECT (SELECT count(*)::int FROM price_alert_event WHERE read_at IS NULL) AS unread, (SELECT coalesce(max(id), 0) FROM price_alert_event) AS latest`)).rows[0];
  return { unread: Number(r?.unread || 0), latestId: Number(r?.latest || 0) };
}
export async function markRead(ids: number[] | 'all'): Promise<number> {
  const p = await pool();
  const r = ids === 'all'
    ? await p.query('UPDATE price_alert_event SET read_at = now() WHERE read_at IS NULL')
    : await p.query('UPDATE price_alert_event SET read_at = now() WHERE read_at IS NULL AND id = ANY($1::bigint[])', [ids.filter((x) => Number.isInteger(x)).slice(0, 1000)]);
  return r.rowCount || 0;
}

export interface NewEvent {
  alertId: string; alertName: string; mid: string; market: string; ticker: string; name: string | null; price: number | null;
  changePct: number | null; condition: string; list: string | null; message: string; dedupeKey: string; toast: boolean; browser: boolean;
}
export type Queryable = { query: (sql: string, args?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
/** Inserts in one statement; a row whose (alert, ticker, dedupe key) already exists is skipped. Returns only the new rows. */
export async function insertEvents(rows: NewEvent[], q?: Queryable): Promise<AlertEvent[]> {
  if (!rows.length) return [];
  const p: Queryable = q ?? await pool();
  const out: AlertEvent[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const args: any[] = [];
    const vals = part.map((e) => {
      const base = args.length;
      args.push(e.alertId, e.alertName, e.mid, e.market, e.ticker, e.name, e.price, e.changePct, e.condition, e.list, e.message, e.dedupeKey, e.toast, e.browser);
      return `(${Array.from({ length: 14 }, (_, k) => `$${base + k + 1}`).join(',')})`;
    });
    const res = await p.query(
      `INSERT INTO price_alert_event (alert_id, alert_name, mid, market, ticker, name, price, change_pct, condition, list, message, dedupe_key, toast, browser)
       VALUES ${vals.join(',')} ON CONFLICT (alert_id, mid, dedupe_key) DO NOTHING RETURNING *`, args);
    out.push(...res.rows.map(rowToEvent));
  }
  return out;
}

/** After a run: fire counts, last fired time, and "triggered" for single-ticker once-only alerts. */
export async function recordFires(byAlert: Map<string, { count: number; status: 'active' | 'triggered' }>, q?: Queryable): Promise<void> {
  if (!byAlert.size) return;
  const p: Queryable = q ?? await pool();
  for (const [id, f] of byAlert) {
    await p.query(
      `UPDATE price_alert SET fire_count = fire_count + $2, last_fired_at = now(),
         status = CASE WHEN $3 = 'triggered' AND status = 'active' THEN 'triggered' ELSE status END,
         version = CASE WHEN $3 = 'triggered' AND status = 'active' THEN version + 1 ELSE version END
       WHERE id = $1`, [id, f.count, f.status]);
  }
}
export async function expireDue(): Promise<number> {
  const p = await pool();
  return (await p.query(`UPDATE price_alert SET status = 'expired', version = version + 1, updated_at = now() WHERE status IN ('active', 'paused') AND expires_at IS NOT NULL AND expires_at <= now()`)).rowCount || 0;
}
/** 180-day retention + a total cap. "Only once" records stay while their alert exists (they are what keeps it from re-firing). */
export async function pruneEvents(): Promise<number> {
  const p = await pool();
  const a = await p.query(
    `DELETE FROM price_alert_event WHERE fired_at < now() - interval '${EVENT_RETENTION_DAYS} days'
       AND (dedupe_key NOT LIKE 'once%' OR alert_id NOT IN (SELECT id FROM price_alert))`);
  const b = await p.query(
    `DELETE FROM price_alert_event WHERE dedupe_key NOT LIKE 'once%' AND id < (SELECT coalesce(min(id), 0) FROM (SELECT id FROM price_alert_event ORDER BY id DESC LIMIT ${EVENT_CAP}) t)`);
  // figures for tickers no alert has watched for 30 days are dropped
  await p.query(`DELETE FROM price_alert_daily WHERE updated_at < now() - interval '30 days'`);
  // zzz1063 — finished outbox rows after 30 days (rows of pruned events go with them: ON DELETE CASCADE), and the crossing
  // states of deleted alerts
  await p.query(`DELETE FROM price_alert_outbox WHERE status IN ('sent', 'gave_up', 'skipped') AND updated_at < now() - interval '30 days'`);
  await p.query(`DELETE FROM price_alert_cross WHERE alert_id NOT IN (SELECT id FROM price_alert)`);
  return (a.rowCount || 0) + (b.rowCount || 0);
}

// ── daily figures + the per-minute claim ────────────────────────────────────

export async function loadDaily(mids: string[]): Promise<Map<string, { fetchedDay: string; figs: DailyFigs }>> {
  const out = new Map<string, { fetchedDay: string; figs: DailyFigs }>();
  if (!mids.length) return out;
  const p = await pool();
  const rows = (await p.query('SELECT mid, fetched_day, figs FROM price_alert_daily WHERE mid = ANY($1::text[])', [mids])).rows;
  for (const r of rows) out.set(r.mid, { fetchedDay: r.fetched_day, figs: typeof r.figs === 'string' ? JSON.parse(r.figs) : r.figs });
  return out;
}
export async function saveDaily(rows: Array<{ mid: string; fetchedDay: string; figs: DailyFigs }>): Promise<void> {
  if (!rows.length) return;
  const p = await pool();
  for (let i = 0; i < rows.length; i += 100) {
    const part = rows.slice(i, i + 100);
    const args: any[] = [];
    const vals = part.map((r) => { args.push(r.mid, r.fetchedDay, JSON.stringify(r.figs)); const b = args.length; return `($${b - 2}, $${b - 1}, $${b}::jsonb, now())`; });
    await p.query(`INSERT INTO price_alert_daily (mid, fetched_day, figs, updated_at) VALUES ${vals.join(',')}
      ON CONFLICT (mid) DO UPDATE SET fetched_day = EXCLUDED.fetched_day, figs = EXCLUDED.figs, updated_at = now()`, args);
  }
}
/** Atomic claim of one minute: true for exactly one caller across all server copies. */
export async function claimMinute(minuteIso: string): Promise<boolean> {
  const p = await pool();
  const r = await p.query(`UPDATE price_alert_meta SET v = $1 WHERE k = 'last_minute' AND v < $1 RETURNING k`, [minuteIso]);
  return (r.rowCount || 0) > 0;
}

// ── zzz1061: signal (state-change) condition states ─────────────────────────

/** States of these alerts' signal conditions, keyed `${alertId}|${mid}|${condIdx}` (lib/alerts/signals signalKey). */
export async function loadSignalStates(alertIds: string[]): Promise<Map<string, SignalState>> {
  const out = new Map<string, SignalState>();
  if (!alertIds.length) return out;
  const p = await pool();
  const rows = (await p.query('SELECT alert_id, mid, cond_idx, alert_version, state, src, edge FROM price_alert_signal WHERE alert_id = ANY($1::text[])', [alertIds])).rows;
  for (const r of rows) {
    out.set(`${r.alert_id}|${r.mid}|${Number(r.cond_idx)}`, { v: r.state == null ? null : Number(r.state), src: String(r.src), edge: r.edge ?? null, ver: Number(r.alert_version) });
  }
  return out;
}
/** Upserts changed states (batches of 200). */
export async function saveSignalStates(rows: Array<[string, SignalState]>): Promise<void> {
  if (!rows.length) return;
  const p = await pool();
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const args: any[] = [];
    const vals: string[] = [];
    for (const [key, s] of part) {
      const m = /^(.+?)\|(.+)\|(\d+)$/.exec(key);
      if (!m) continue;
      args.push(m[1], m[2], Number(m[3]), s.ver, s.v, s.src, s.edge);
      const b = args.length - 7;
      vals.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, now())`);
    }
    if (!vals.length) continue;
    await p.query(`INSERT INTO price_alert_signal (alert_id, mid, cond_idx, alert_version, state, src, edge, updated_at) VALUES ${vals.join(',')}
      ON CONFLICT (alert_id, mid, cond_idx) DO UPDATE SET alert_version = EXCLUDED.alert_version, state = EXCLUDED.state, src = EXCLUDED.src,
        edge = EXCLUDED.edge, updated_at = now()`, args);
  }
}
/** Housekeeping: states of deleted alerts (an edited alert's rows are overwritten in place: same key, new alert_version). */
export async function pruneSignalStates(): Promise<number> {
  const p = await pool();
  const r = await p.query(`DELETE FROM price_alert_signal WHERE alert_id NOT IN (SELECT id FROM price_alert)`);
  return r.rowCount || 0;
}

// ── zzz1063 (A02): durable crossing state, one commit per run, the delivery outbox ─────────────────────────────

export type DeliveryChannel = 'telegram' | 'email' | 'push';
export const DELIVERY_CHANNELS: readonly DeliveryChannel[] = ['telegram', 'email', 'push'];
/** pending → sending (claimed, leased) → sent | failed (retry later) | gave_up (6 failures) | skipped (channel not set up) */
export type DeliveryState = 'pending' | 'sending' | 'sent' | 'failed' | 'gave_up' | 'skipped';

/** Crossing states (signs per condition) of these alerts at their CURRENT version, keyed like evaluate.ts stateKey. */
export async function loadCrossStates(alerts: Array<{ id: string; version: number }>): Promise<Map<string, Array<number | undefined>>> {
  const out = new Map<string, Array<number | undefined>>();
  if (!alerts.length) return out;
  const p = await pool();
  const ver = new Map(alerts.map((a) => [a.id, a.version]));
  const rows = (await p.query('SELECT alert_id, mid, alert_version, states FROM price_alert_cross WHERE alert_id = ANY($1::text[])', [[...ver.keys()]])).rows;
  for (const r of rows) {
    if (ver.get(r.alert_id) !== Number(r.alert_version)) continue;   // edited since: start fresh
    const st = typeof r.states === 'string' ? JSON.parse(r.states) : r.states;
    if (Array.isArray(st)) out.set(`${r.alert_id}|${Number(r.alert_version)}|${r.mid}`, st.map((x: any) => (x == null ? undefined : Number(x))));
  }
  return out;
}

export interface CrossRow { alertId: string; version: number; mid: string; states: Array<number | undefined> }
/** Pure: a state key `${alertId}|${version}|${mid}` → its parts (a mid never contains '|'). */
export function parseStateKey(k: string): { alertId: string; version: number; mid: string } | null {
  const m = /^(.+?)\|(\d+)\|(.+)$/.exec(k);
  return m ? { alertId: m[1], version: Number(m[2]), mid: m[3] } : null;
}

export interface CommitInput {
  events: NewEvent[];
  /** channels to deliver an event on (from its alert's notify settings) */
  channelsFor: (e: NewEvent) => DeliveryChannel[];
  /** crossing states that changed this run */
  cross: CrossRow[];
  /** status after a fire, per alert */
  statusFor: (alertId: string) => 'active' | 'triggered';
}
/**
 * ONE transaction per run: the new events (duplicates refused by the dedupe index), one outbox row per (event, channel), the
 * changed crossing states and the fire counts. Either all of it is stored or none of it: a failed insert keeps the crossing
 * (the checker moves its memory on only after this commits), and an event is never stored without its delivery rows — a crash
 * right after the commit still leaves every delivery to the next delivery run.
 */
export async function commitRun(inp: CommitInput, q?: { connect: () => Promise<any> }): Promise<{ inserted: AlertEvent[]; outbox: number }> {
  if (!inp.events.length && !inp.cross.length) return { inserted: [], outbox: 0 };
  const p = q ?? await pool();
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    const inserted = await insertEvents(inp.events, c);
    const byKey = new Map(inp.events.map((e) => [`${e.alertId}|${e.mid}|${e.dedupeKey}`, e]));
    const ob: Array<[number, DeliveryChannel]> = [];
    for (const ev of inserted) {
      const src = byKey.get(`${ev.alertId}|${ev.mid}|${ev.dedupeKey}`);
      for (const ch of src ? inp.channelsFor(src) : []) ob.push([ev.id, ch]);
    }
    for (let i = 0; i < ob.length; i += 300) {
      const part = ob.slice(i, i + 300);
      const args: any[] = [];
      const vals = part.map(([id, ch]) => { args.push(id, ch); return `($${args.length - 1}, $${args.length})`; });
      await c.query(`INSERT INTO price_alert_outbox (event_id, channel) VALUES ${vals.join(',')} ON CONFLICT (event_id, channel) DO NOTHING`, args);
    }
    for (let i = 0; i < inp.cross.length; i += 200) {
      const part = inp.cross.slice(i, i + 200);
      const args: any[] = [];
      const vals = part.map((r) => {
        args.push(r.alertId, r.mid, r.version, JSON.stringify(r.states.map((x) => (x === undefined ? null : x))));
        const b = args.length;
        return `($${b - 3}, $${b - 2}, $${b - 1}, $${b}::jsonb, now())`;
      });
      await c.query(`INSERT INTO price_alert_cross (alert_id, mid, alert_version, states, updated_at) VALUES ${vals.join(',')}
        ON CONFLICT (alert_id, mid) DO UPDATE SET alert_version = EXCLUDED.alert_version, states = EXCLUDED.states, updated_at = now()`, args);
    }
    const byAlert = new Map<string, { count: number; status: 'active' | 'triggered' }>();
    for (const e of inserted) {
      const cur = byAlert.get(e.alertId) || { count: 0, status: inp.statusFor(e.alertId) };
      cur.count++; byAlert.set(e.alertId, cur);
    }
    await recordFires(byAlert, c);
    await c.query('COMMIT');
    return { inserted, outbox: ob.length };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

/** Retry plan: wait 1, 5, 15, 60, 60 minutes after failed tries 1–5; the 6th failure gives up (about 2 h 20 min in all). */
export const DELIVERY_BACKOFF_MIN: readonly number[] = [1, 5, 15, 60, 60];
export const DELIVERY_MAX_ATTEMPTS = 6;
/** While a row is being sent it is leased this long; a row of a server that died mid-send is claimed again after it. */
export const DELIVERY_LEASE_MIN = 10;
/** Pure: after `attempts` tries that all failed, minutes until the next try, or null = give up. */
export function retryDelayMin(attempts: number): number | null {
  if (attempts >= DELIVERY_MAX_ATTEMPTS) return null;
  return DELIVERY_BACKOFF_MIN[Math.max(0, Math.min(DELIVERY_BACKOFF_MIN.length - 1, attempts - 1))];
}

/**
 * Atomic claim of due outbox rows. FOR UPDATE SKIP LOCKED: two server copies running this at the same moment get disjoint rows
 * (a row locked by one is skipped by the other, never waited on or taken twice), and the UPDATE moves the claimed rows to
 * 'sending' with a lease, so they are not due again until the lease ends. Rows that already had their last try are left to
 * giveUpLostSends.
 */
export const CLAIM_OUTBOX_SQL = `
  WITH due AS (
    SELECT id FROM price_alert_outbox
     WHERE status IN ('pending', 'failed', 'sending') AND next_attempt_at <= now() AND attempts < $2
     ORDER BY next_attempt_at, id
     LIMIT $1
     FOR UPDATE SKIP LOCKED
  )
  UPDATE price_alert_outbox o
     SET status = 'sending', attempts = o.attempts + 1, updated_at = now(),
         next_attempt_at = now() + make_interval(mins => $3)
    FROM due
   WHERE o.id = due.id
  RETURNING o.id, o.event_id, o.channel, o.attempts`;

export interface ClaimedRow { id: number; eventId: number; channel: DeliveryChannel; attempts: number }
export async function claimOutbox(limit = 200, q?: Queryable): Promise<ClaimedRow[]> {
  const p: Queryable = q ?? await pool();
  const rows = (await p.query(CLAIM_OUTBOX_SQL, [limit, DELIVERY_MAX_ATTEMPTS, DELIVERY_LEASE_MIN])).rows;
  return rows.map((r) => ({ id: Number(r.id), eventId: Number(r.event_id), channel: r.channel as DeliveryChannel, attempts: Number(r.attempts) }))
    .sort((a, b) => a.eventId - b.eventId || a.id - b.id);
}
/** A send that never reported back (server died) after its LAST allowed try: give up so it does not sit in 'sending'. */
export async function giveUpLostSends(q?: Queryable): Promise<number> {
  const p: Queryable = q ?? await pool();
  return (await p.query(
    `UPDATE price_alert_outbox SET status = 'gave_up', updated_at = now(),
        last_error = coalesce(last_error || ' · ', '') || 'no answer from the last try (server restarted while sending?)'
      WHERE status = 'sending' AND next_attempt_at <= now() AND attempts >= $1`, [DELIVERY_MAX_ATTEMPTS])).rowCount || 0;
}

export interface OutboxUpdate { ids: number[]; status: Exclude<DeliveryState, 'pending' | 'sending'>; error: string | null; delayMin: number | null }
/** Writes the outcome of one send (one UPDATE per distinct status / delay). Only rows still 'sending' are touched. */
export async function finishOutbox(updates: OutboxUpdate[], q?: Queryable): Promise<void> {
  if (!updates.length) return;
  const p: Queryable = q ?? await pool();
  for (const u of updates) {
    if (!u.ids.length) continue;
    await p.query(
      `UPDATE price_alert_outbox SET status = $2, last_error = $3, updated_at = now(),
         sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
         next_attempt_at = CASE WHEN $4::int IS NULL THEN next_attempt_at ELSE now() + make_interval(mins => $4::int) END
       WHERE id = ANY($1::bigint[]) AND status = 'sending'`,
      [u.ids, u.status, u.error ? u.error.slice(0, 300) : null, u.delayMin],
    );
  }
}
export async function eventsByIds(ids: number[], q?: Queryable): Promise<AlertEvent[]> {
  if (!ids.length) return [];
  const p: Queryable = q ?? await pool();
  return (await p.query('SELECT * FROM price_alert_event WHERE id = ANY($1::bigint[]) ORDER BY id', [ids])).rows.map(rowToEvent);
}
/** Earliest time a row is due (null = nothing waiting). Lets the delivery job skip the claim query until then. */
export async function nextOutboxDue(q?: Queryable): Promise<number | null> {
  const p: Queryable = q ?? await pool();
  const r = (await p.query(`SELECT min(next_attempt_at) AS t FROM price_alert_outbox WHERE status IN ('pending', 'failed', 'sending') AND attempts < $1`, [DELIVERY_MAX_ATTEMPTS])).rows[0];
  const lost = (await p.query(`SELECT 1 FROM price_alert_outbox WHERE status = 'sending' AND attempts >= $1 LIMIT 1`, [DELIVERY_MAX_ATTEMPTS])).rows.length > 0;
  if (lost) return Date.now();
  return r?.t ? new Date(r.t).getTime() : null;
}

export interface ChannelDelivery { state: DeliveryState; attempts: number; error: string | null; at: string | null }
/** Per-event delivery state per channel (GET ?view=events). */
export async function deliveryFor(eventIds: number[]): Promise<Map<number, Partial<Record<DeliveryChannel, ChannelDelivery>>>> {
  const out = new Map<number, Partial<Record<DeliveryChannel, ChannelDelivery>>>();
  if (!eventIds.length) return out;
  const p = await pool();
  const rows = (await p.query('SELECT event_id, channel, status, attempts, last_error, sent_at, updated_at FROM price_alert_outbox WHERE event_id = ANY($1::bigint[])', [eventIds])).rows;
  for (const r of rows) {
    const id = Number(r.event_id);
    const m = out.get(id) || {};
    m[r.channel as DeliveryChannel] = { state: r.status, attempts: Number(r.attempts), error: r.last_error ?? null, at: iso(r.sent_at ?? r.updated_at) };
    out.set(id, m);
  }
  return out;
}
export interface ChannelSummary { pending: number; sent: number; failed: number; gaveUp: number; skipped: number; lastError: string | null; lastErrorAt: string | null; lastSentAt: string | null }
/** Per channel: counts by state over the last 7 days, the last delivery time and the latest error (GET summary). */
export async function deliverySummary(): Promise<Record<DeliveryChannel, ChannelSummary>> {
  const p = await pool();
  const blank = (): ChannelSummary => ({ pending: 0, sent: 0, failed: 0, gaveUp: 0, skipped: 0, lastError: null, lastErrorAt: null, lastSentAt: null });
  const out: Record<DeliveryChannel, ChannelSummary> = { telegram: blank(), email: blank(), push: blank() };
  const counts = (await p.query(`SELECT channel, status, count(*)::int AS n, max(sent_at) AS last_sent FROM price_alert_outbox WHERE created_at > now() - interval '7 days' GROUP BY channel, status`)).rows;
  for (const r of counts) {
    const o = out[r.channel as DeliveryChannel]; if (!o) continue;
    const n = Number(r.n);
    if (r.status === 'pending' || r.status === 'sending') o.pending += n;
    else if (r.status === 'sent') { o.sent += n; o.lastSentAt = iso(r.last_sent); }
    else if (r.status === 'failed') o.failed += n;
    else if (r.status === 'gave_up') o.gaveUp += n;
    else if (r.status === 'skipped') o.skipped += n;
  }
  const errs = (await p.query(`SELECT DISTINCT ON (channel) channel, last_error, updated_at FROM price_alert_outbox WHERE last_error IS NOT NULL AND status <> 'sent' ORDER BY channel, updated_at DESC`)).rows;
  for (const r of errs) { const o = out[r.channel as DeliveryChannel]; if (o) { o.lastError = r.last_error; o.lastErrorAt = iso(r.updated_at); } }
  return out;
}
