// zzz1166 — where Transformational Gainers live: Postgres (record of truth, table transformational_event). Without Postgres
// (a local run) a Redis key per market holds the same items, pruned to 75 days. Server-only.
import type { AiMb, TgItem, TgMarket } from './core';

const KV_KEY = (m: TgMarket) => `transformational:v1:${m}`;
const KEEP_DAYS = 75;
const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function db(): Promise<boolean> {
  try { const { ensureSchema } = await import('../db-migrate'); return await ensureSchema(); } catch { return false; }
}

/** Upsert the items of one session. `data` is refreshed; the AI read is never touched here. Returns how many were written. */
export async function saveItems(items: TgItem[]): Promise<number> {
  if (!items.length) return 0;
  if (await db()) {
    const { dbQuery } = await import('../db');
    let n = 0;
    // zzz1168 — a session re-read under a stricter rule drops what it no longer lists (rows first seen on that session only)
    const bySession = new Map<string, string[]>();
    for (const x of items) bySession.set(`${x.market}|${x.sessionDate}`, [...(bySession.get(`${x.market}|${x.sessionDate}`) || []), x.id]);
    for (const [k, ids] of bySession) {
      const [m, d] = k.split('|');
      await dbQuery('DELETE FROM transformational_event WHERE market = $1 AND session_date = $2 AND NOT (id = ANY($3::text[])) AND ai IS NULL', [m, d, ids]).catch(() => undefined);
    }
    for (const x of items) {
      const { ai: _ai, ...data } = x;
      // the FIRST session the event was seen on is kept; the newest move / figures are refreshed
      await dbQuery(
        `INSERT INTO transformational_event (id, market, ticker, session_date, event_date, theme, strength, mb_score, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET theme = EXCLUDED.theme, strength = EXCLUDED.strength, mb_score = EXCLUDED.mb_score,
           data = EXCLUDED.data || jsonb_build_object('sessionDate', transformational_event.data->>'sessionDate', 'lastSession', EXCLUDED.data->>'sessionDate'),
           last_seen = now()`,
        [x.id, x.market, x.ticker, x.sessionDate, x.eventDate, x.theme, x.strength, x.mb.score, JSON.stringify(data)],
      );
      n++;
    }
    return n;
  }
  const { kvGet, kvSet } = await import('../kv');
  const byMarket = new Map<TgMarket, TgItem[]>();
  for (const x of items) byMarket.set(x.market, [...(byMarket.get(x.market) || []), x]);
  let n = 0;
  for (const [m, add] of byMarket) {
    const cur = ((await kvGet<TgItem[]>(KV_KEY(m)).catch(() => null)) || []).filter((x) => x.sessionDate >= cutoff(KEEP_DAYS));
    const map = new Map(cur.map((x) => [x.id, x]));
    for (const x of add) { const old = map.get(x.id); map.set(x.id, { ...x, sessionDate: old?.sessionDate || x.sessionDate, ai: old?.ai ?? null }); n++; }
    await kvSet(KV_KEY(m), [...map.values()], (KEEP_DAYS + 5) * 86_400).catch(() => undefined);
  }
  return n;
}

/** Items whose first session is within `days` (both markets unless one is named). */
export async function loadItems(days = 60, market?: TgMarket): Promise<TgItem[]> {
  const since = cutoff(days + 1);
  if (await db()) {
    const { dbQuery } = await import('../db');
    const rows = await dbQuery<{ data: any; ai: any }>(
      `SELECT data, ai FROM transformational_event WHERE session_date >= $1 ${market ? 'AND market = $2' : ''} ORDER BY session_date DESC, mb_score DESC LIMIT 3000`,
      market ? [since, market] : [since],
    );
    return rows.map((r) => ({ ...(r.data as TgItem), ai: r.ai ?? null }));
  }
  const { kvGet } = await import('../kv');
  const ms: TgMarket[] = market ? [market] : ['IN', 'US'];
  const out: TgItem[] = [];
  for (const m of ms) out.push(...(((await kvGet<TgItem[]>(KV_KEY(m)).catch(() => null)) || []).filter((x) => x.sessionDate >= since)));
  return out;
}

/** Write the AI read of one item. */
export async function saveAi(id: string, market: TgMarket, ai: AiMb): Promise<void> {
  if (await db()) {
    const { dbQuery } = await import('../db');
    await dbQuery('UPDATE transformational_event SET ai = $2 WHERE id = $1', [id, JSON.stringify(ai)]);
    return;
  }
  const { kvGet, kvSet } = await import('../kv');
  const cur = (await kvGet<TgItem[]>(KV_KEY(market)).catch(() => null)) || [];
  await kvSet(KV_KEY(market), cur.map((x) => (x.id === id ? { ...x, ai } : x)), (KEEP_DAYS + 5) * 86_400).catch(() => undefined);
}
