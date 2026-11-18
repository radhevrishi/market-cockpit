// zzz1280 — "Since added": how the share has done from the close of the session it joined the Transformational Gainers board
// to the latest close. Prices come from the free daily chart series the app already uses (Yahoo / NSE, cached) — no AI, no paid API.
import type { Bar } from '../chart-math';

export interface SinceAdded { base: number; baseDate: string; last: number; lastDate: string; pct: number; sessions: number }

const isoOf = (t: number) => new Date(t < 1e11 ? t * 1000 : t).toISOString().slice(0, 10);

/** Pure: close on the added session (or the first session after it) → latest close. Null when the series does not cover it. */
export function sinceAdded(bars: Bar[], sessionDate: string): SinceAdded | null {
  const ok = (bars || []).filter((b) => Number.isFinite(b.c) && b.c > 0);
  if (!ok.length) return null;
  const i = ok.findIndex((b) => isoOf(b.t) >= sessionDate);
  if (i < 0) return null;
  // the added session must be in the series (within 4 days), else the base would be a different day's price
  const baseDate = isoOf(ok[i].t);
  if ((Date.parse(`${baseDate}T00:00:00Z`) - Date.parse(`${sessionDate}T00:00:00Z`)) / 86_400_000 > 4) return null;
  const last = ok[ok.length - 1];
  const pct = Math.round(((last.c - ok[i].c) / ok[i].c) * 1000) / 10;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { base: r2(ok[i].c), baseDate, last: r2(last.c), lastDate: isoOf(last.t), pct, sessions: ok.length - 1 - i };
}

const MEMO = new Map<string, { at: number; v: SinceAdded | null }>();
const TTL_MS = 30 * 60_000;

/** For each "market:ticker:date", the since-added move. Uses the shared chart cache; 6 at a time; memoised 30 min. */
export async function sinceAddedMany(keys: string[]): Promise<Record<string, SinceAdded | null>> {
  const { getDailySeries } = await import('../chart-data');
  const out: Record<string, SinceAdded | null> = {};
  const todo = [...new Set(keys)].filter((k) => /^(IN|US):[A-Z0-9&.\-]{1,20}:\d{4}-\d{2}-\d{2}$/.test(k));
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const k = todo[i++];
      const hit = MEMO.get(k);
      if (hit && Date.now() - hit.at < TTL_MS) { out[k] = hit.v; continue; }
      const [m, t, d] = k.split(':');
      let v: SinceAdded | null = null;
      try { const s = await getDailySeries(m as 'IN' | 'US', t, '2y'); v = s ? sinceAdded(s.bars, d) : null; } catch { v = null; }
      MEMO.set(k, { at: Date.now(), v });
      out[k] = v;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (MEMO.size > 3000) for (const k of [...MEMO.keys()].slice(0, MEMO.size - 3000)) MEMO.delete(k);
  return out;
}
