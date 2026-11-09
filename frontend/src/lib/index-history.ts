// zzz1231 — NSE's daily close of every index (archive file ind_close_all_<DDMMYYYY>.csv), kept in Postgres. Yahoo has no
// history for Nifty Smallcap 100 (^CNXSC answers one bar), so the tradebook benchmark reads it from here. Filled on demand
// (oldest missing days first is not needed — every weekday in the window is asked once; a 404 = holiday, remembered).
import { dbQuery } from './db';
import { ensureSchema } from './db-migrate';
import { proxiedFetch } from './proxy-fetch';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DAY = 86_400_000;
export const fileDate = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
export const indexCloseUrl = (iso: string) => `https://nsearchives.nseindia.com/content/indices/ind_close_all_${fileDate(iso)}.csv`;

/** The CSV → { name, close } for one day. Names are NSE's ("NIFTY Smallcap 100"). */
export function parseIndexClose(csv: string, iso: string): Array<{ name: string; close: number }> {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length || !/index name/i.test(lines[0])) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iN = head.indexOf('index name'), iD = head.indexOf('index date'), iC = head.findIndex((h) => h.startsWith('closing index value'));
  const want = `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
  const out: Array<{ name: string; close: number }> = [];
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    const name = (c[iN] || '').trim(), close = Number(c[iC]);
    if (!name || !(close > 0)) continue;
    if (iD >= 0 && c[iD] && c[iD].trim() !== want) continue;
    out.push({ name, close });
  }
  return out;
}

async function fetchDay(iso: string): Promise<{ rows: Array<{ name: string; close: number }> | null; missing?: boolean }> {
  const url = indexCloseUrl(iso);
  const once = async (relay: boolean) => {
    const init = { headers: { 'User-Agent': UA, Accept: 'text/csv,*/*', Referer: 'https://www.nseindia.com/' }, signal: AbortSignal.timeout(12_000) };
    const r = relay ? await proxiedFetch(url, init) : await fetch(url, init);
    if (r.status === 404) return { rows: null, missing: true };
    if (!r.ok) return { rows: null };
    const rows = parseIndexClose(await r.text(), iso);
    return rows.length ? { rows } : { rows: null };
  };
  try { const a = await once(false); if (a.rows || a.missing) return a; } catch { /* relay */ }
  try { return await once(true); } catch { return { rows: null }; }
}

/** Fetches the weekdays in [from, to] not stored yet (newest first), within the time budget. */
export async function ensureIndexHistory(from: string, to: string, budgetMs = 90_000): Promise<{ fetched: number; pending: number }> {
  if (!(await ensureSchema())) return { fetched: 0, pending: 0 };
  const have = new Set((await dbQuery<{ d: string }>(`SELECT to_char(d, 'YYYY-MM-DD') AS d FROM index_close_day WHERE state = 'ok' OR (state = 'none' AND (checked > now() - interval '3 days' OR d < now()::date - 7))`)).map((r) => r.d));
  const days: string[] = [];
  for (let t = Date.parse(`${to}T00:00:00Z`); t >= Date.parse(`${from}T00:00:00Z`); t -= DAY) {
    const d = new Date(t), wd = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (wd !== 0 && wd !== 6 && !have.has(iso)) days.push(iso);
  }
  const deadline = Date.now() + budgetMs;
  let i = 0, fetched = 0;
  const worker = async () => {
    while (i < days.length && Date.now() < deadline) {
      const iso = days[i++];
      const r = await fetchDay(iso);
      if (r.rows) {
        await dbQuery(`INSERT INTO index_close (name, d, close) SELECT * FROM unnest($1::text[], $2::date[], $3::float8[]) ON CONFLICT (name, d) DO UPDATE SET close = EXCLUDED.close`,
          [r.rows.map((x) => x.name), r.rows.map(() => iso), r.rows.map((x) => x.close)]);
        await dbQuery(`INSERT INTO index_close_day (d, state) VALUES ($1, 'ok') ON CONFLICT (d) DO UPDATE SET state = 'ok', checked = now()`, [iso]);
        fetched++;
      } else if (r.missing) {
        await dbQuery(`INSERT INTO index_close_day (d, state) VALUES ($1, 'none') ON CONFLICT (d) DO UPDATE SET state = 'none', checked = now()`, [iso]);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { fetched, pending: Math.max(0, days.length - i) };
}

/** Stored closes of one index, oldest first. Name matched without regard to case. */
export async function indexCloses(name: string): Promise<Array<{ t: number; c: number }>> {
  if (!(await ensureSchema())) return [];
  const r = await dbQuery<{ d: string; close: number }>(`SELECT to_char(d, 'YYYY-MM-DD') AS d, close FROM index_close WHERE lower(name) = lower($1) ORDER BY d`, [name]);
  return r.map((x) => ({ t: Date.parse(`${x.d}T00:00:00Z`), c: Number(x.close) }));
}
