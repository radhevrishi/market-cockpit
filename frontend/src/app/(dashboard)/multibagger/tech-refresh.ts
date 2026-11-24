'use client';
// zzz1308 — keeps the Technicals rows in this browser (mb_tech_rows_usa_v1 / mb_tech_rows_ind_v1) up to date on EVERY page,
// not only when the Technicals tab is opened. Many pages read these rows (Entry Desk, Cockpit, Theme Rotation, alerts, engines),
// and they were frozen at the first pull. Pulls when the server has a newer build or when rows are from before the fix.
import { TV_MANIFEST_URL, tvFileUrl } from '@/lib/screener-data-loader';
import { parseUSARow } from './usa-parse';
import { mergeServerPull, tagRows } from './tech-merge';

const LAST_KEY = 'mb_tech_last_pulled_sync_v1';
const KEYS = { usa: 'mb_tech_rows_usa_v1', ind: 'mb_tech_rows_ind_v1' } as const;
const USA_EX = new Set(['NYSE', 'NASDAQ', 'NMS', 'ARCA', 'AMEX', 'BATS', 'OTC', 'NYSE ARCA', 'NYSEARCA']);
const IND_EX = new Set(['NSE', 'BSE']);
let running = false;

const read = (k: string): any[] => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };

export async function refreshTechRowsIfStale(): Promise<'pulled' | 'fresh' | 'failed'> {
  if (running || typeof window === 'undefined') return 'fresh';
  running = true;
  try {
    const manifest = await fetch(TV_MANIFEST_URL, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
    const sync: string | undefined = manifest?.lastSync;
    if (!sync) return 'failed';
    const last = localStorage.getItem(LAST_KEY);
    const frozen = [...read(KEYS.usa), ...read(KEYS.ind)].some((r) => !r?._src);
    if (!frozen && last && Date.parse(sync) <= Date.parse(last)) return 'fresh';
    const files = (manifest.files || []).filter((f: any) => f.ok);
    if (!files.length) return 'failed';
    const XLSX = await import('xlsx');
    const usa: any[] = [], ind: any[] = [];
    const texts = await Promise.all(files.map((f: any) => fetch(tvFileUrl(f.name), { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).catch(() => '')));
    for (const t of texts) {
      if (!t) continue;
      const wb = XLSX.read(t, { type: 'string' });
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      for (const r of raw) {
        const p = parseUSARow(r);
        if (!p || !p.symbol) continue;
        const ex = String((p as any).exchange || '').toUpperCase().trim();
        if (IND_EX.has(ex)) ind.push(p); else if (USA_EX.has(ex)) usa.push(p);
      }
    }
    if (!usa.length && !ind.length) return 'failed';   // never wipe the kept rows on an empty answer
    if (usa.length) localStorage.setItem(KEYS.usa, JSON.stringify(mergeServerPull(read(KEYS.usa), tagRows(usa, 'server', sync)).rows));
    if (ind.length) localStorage.setItem(KEYS.ind, JSON.stringify(mergeServerPull(read(KEYS.ind), tagRows(ind, 'server', sync)).rows));
    localStorage.setItem(LAST_KEY, sync);
    try { window.dispatchEvent(new CustomEvent('mb-tech-updated')); } catch { /* ignore */ }
    return 'pulled';
  } catch { return 'failed'; } finally { running = false; }
}

/** Starts the refresher: once when idle, then every 20 minutes while the site is open. */
export function startTechRefresh(): () => void {
  const run = () => { void refreshTechRowsIfStale(); };
  const t0 = window.setTimeout(run, 4000);
  const iv = window.setInterval(run, 20 * 60_000);
  return () => { window.clearTimeout(t0); window.clearInterval(iv); };
}
