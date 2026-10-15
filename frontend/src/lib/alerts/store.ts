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
    message: s.message || '', notify: { app: true, toast: s.notify?.toast !== false, browser: !!s.notify?.browser, telegram: !!s.notify?.telegram, email: !!s.notify?.email },
    expiresAt: iso(r.expires_at), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, version: Number(r.version),
    lastFiredAt: iso(r.last_fired_at), fireCount: Number(r.fire_count || 0),
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

/** Replaces the alert's settings when `baseVersion` is still current (else AlertConflict). A stopped alert (triggered / expired)
 *  starts watching again unless it was paused. */
export async function updateAlert(id: string, a: AlertInput, baseVersion: number): Promise<PriceAlert> {
  const p = await pool();
  const r = (await p.query(
    `UPDATE price_alert SET name = $2, spec = $3::jsonb, expires_at = $4, updated_at = now(), version = version + 1,
       status = CASE WHEN status = 'paused' THEN 'paused' ELSE 'active' END
     WHERE id = $1 AND version = $5 RETURNING *`,
    [id, a.name, specOf(a), a.expiresAt, baseVersion],
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

export interface EventQuery { limit?: number; beforeId?: number; afterId?: number; alertId?: string; ticker?: string; market?: 'IN' | 'US'; unread?: boolean; sinceDays?: number }
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
  const sql = `SELECT * FROM price_alert_event ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`;
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
/** Inserts in one statement; a row whose (alert, ticker, dedupe key) already exists is skipped. Returns only the new rows. */
export async function insertEvents(rows: NewEvent[]): Promise<AlertEvent[]> {
  if (!rows.length) return [];
  const p = await pool();
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
export async function recordFires(byAlert: Map<string, { count: number; status: 'active' | 'triggered' }>): Promise<void> {
  if (!byAlert.size) return;
  const p = await pool();
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
       AND (dedupe_key <> 'once' OR alert_id NOT IN (SELECT id FROM price_alert))`);
  const b = await p.query(
    `DELETE FROM price_alert_event WHERE dedupe_key <> 'once' AND id < (SELECT coalesce(min(id), 0) FROM (SELECT id FROM price_alert_event ORDER BY id DESC LIMIT ${EVENT_CAP}) t)`);
  // figures for tickers no alert has watched for 30 days are dropped
  await p.query(`DELETE FROM price_alert_daily WHERE updated_at < now() - interval '30 days'`);
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
