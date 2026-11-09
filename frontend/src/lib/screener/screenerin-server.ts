// zzz1234 — the owner's screener.in screens and watchlists, built from our own Stock Screener data (no screener.in login,
// no "Sync Screener.in CSVs" workflow). Each file = members × the screener.in export columns (lib/screener/screenerin-columns).
//   members of a screen: its query when the owner pasted one (lib/screener/screenerin-query), else the last export's list
//   members of the portfolio / watchlist files: the app's own portfolio and watchlist (else the last export's list)
import { dbQuery } from '../db';
import { kvGet, kvSetDurable } from '../kv';
import { getSnapshot } from './snapshot-cache';
import type { InRaw } from './in-assemble';
import { industryPeMap, screenerInColumns, screenerInCsv, type ScreenerInRow } from './screenerin-columns';
import { compileQuery } from './screenerin-query';
import { SCREENERIN_FROZEN } from './screenerin-frozen';
import { DEFAULT_QUERY_BY_SLUG, SCREENERIN_DEFAULT_SCREENS } from './screenerin-defaults';

// zzz1238 — every screen of the owner's screener.in account (screenerin-defaults), then his three lists
export const SCREENERIN_FILES: Array<{ slug: string; display: string; kind: 'screen' | 'portfolio' | 'watchlist' }> = [
  ...SCREENERIN_DEFAULT_SCREENS.map((d) => ({ slug: d.slug, display: d.display, kind: 'screen' as const })),
  { slug: 'watchlist-10432429', display: 'Portfolio', kind: 'portfolio' },
  { slug: 'watchlist-10432585', display: 'Watchlist', kind: 'watchlist' },
  { slug: 'watchlist-8105148', display: 'Watchlist 2', kind: 'watchlist' },
];

export const QUERIES_KEY = 'screenerin:queries:v1';
export type SavedQueries = Record<string, { query: string; at: string }>;
export async function loadQueries(): Promise<SavedQueries> { return ((await kvGet<SavedQueries>(QUERIES_KEY).catch(() => null)) || {}) as SavedQueries; }
export async function saveQuery(slug: string, query: string | null): Promise<SavedQueries> {
  const q = await loadQueries();
  if (query && query.trim()) q[slug] = { query: query.trim().slice(0, 4000), at: new Date().toISOString() }; else delete q[slug];
  await kvSetDurable(QUERIES_KEY, q);
  _cache = null;
  return q;
}

async function appList(key: 'mc_portfolio_holdings' | 'mc_watchlist_tickers'): Promise<string[]> {
  try {
    const { getUserState } = await import('../user-state-store');
    const r = await getUserState(key as any);
    let v: any = r?.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = v.split(','); } }
    const arr: any[] = Array.isArray(v) ? v : Array.isArray(v?.holdings) ? v.holdings : [];
    return Array.from(new Set(arr.map((x) => String(typeof x === 'string' ? x : x?.symbol || x?.ticker || '').toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO)$/, '').trim()).filter((t) => /^[A-Z0-9&_-]{1,20}$/.test(t))));
  } catch { return []; }
}

let _cache: { at: number; built: Map<string, { csv: string; rows: number; source: string; note: string | null; members: string[] }>; builtAt: string } | null = null;

/** Builds every file (memoised 10 minutes). */
export async function buildScreenerInFiles(force = false) {
  if (!force && _cache && Date.now() - _cache.at < 10 * 60_000) return _cache;
  const snap = await getSnapshot('IN');
  const rows: any[] = snap?.rows || [];
  const byT = new Map<string, any>();
  for (const r of rows) byT.set(String(r.t).toUpperCase(), r);
  const pe = industryPeMap(rows);
  // the boiled-down screener.in pages
  const raws = new Map<string, InRaw>();
  const st = await dbQuery<{ ticker: string; payload: any }>(`SELECT ticker, payload FROM screener_store WHERE market = 'IN' AND kind = 'fund'`).catch(() => []);
  for (const x of st) if (x.payload?.raw) raws.set(String(x.ticker).toUpperCase().split(':')[0], x.payload.raw as InRaw);
  const colsFor = (t: string): ScreenerInRow | null => {
    const r = byT.get(t);
    if (!r) return null;
    return screenerInColumns(raws.get(t) || null, r, r.ind ? pe.get(r.ind) ?? null : null);
  };
  const queries = await loadQueries();
  const built = new Map<string, { csv: string; rows: number; source: string; note: string | null; members: string[] }>();
  let all: Array<{ t: string; c: ScreenerInRow }> | null = null;
  const everyone = () => (all ||= Array.from(byT.keys()).map((t) => ({ t, c: colsFor(t) as ScreenerInRow })).filter((x) => x.c));
  for (const f of SCREENERIN_FILES) {
    let members: string[] = [], source = 'last screener.in export (6 Nov 2026)', note: string | null = null;
    const saved = queries[f.slug];
    const def = DEFAULT_QUERY_BY_SLUG[f.slug];
    const q = saved || (def ? { query: def.query, at: '' } : null);
    if (f.kind === 'screen' && q) {
      const cq = compileQuery(q.query);
      if (cq.error) note = `query not understood: ${cq.error}`;
      else {
        members = everyone().filter((x) => cq.test(x.c)).map((x) => x.t);
        source = saved ? 'your pasted query, run on our data' : 'your screener.in query, run on our data';
        const bits: string[] = [];
        if (cq.unknown.length) bits.push(`not known here (those conditions fail): ${cq.unknown.join(', ')}`);
        if (cq.assumed.length) bits.push(`no data here, taken as passing: ${cq.assumed.join(', ')}`);
        note = bits.length ? bits.join(' · ') : null;
      }
    }
    if (!members.length && !(f.kind === 'screen' && q && !note)) {
      if (f.kind === 'portfolio') { const p = await appList('mc_portfolio_holdings'); if (p.length) { members = p; source = 'your portfolio in this app'; } }
      if (f.kind === 'watchlist' && f.slug === 'watchlist-10432585') { const w = await appList('mc_watchlist_tickers'); if (w.length) { members = w; source = 'your watchlist in this app'; } }
      if (!members.length) members = SCREENERIN_FROZEN[f.slug] || [];
    }
    const out = members.map((t) => colsFor(String(t).toUpperCase())).filter((c): c is ScreenerInRow => !!c);
    const missing = members.length - out.length;
    if (missing > 0) note = [note, `${missing} not in our India universe`].filter(Boolean).join(' · ');
    built.set(f.slug, { csv: screenerInCsv(out), rows: out.length, source, note, members: out.map((c) => String(c['NSE Code'] || c['Name'] || '')).filter(Boolean) });
  }
  _cache = { at: Date.now(), built, builtAt: snap?.builtAt || new Date().toISOString() };
  return _cache;
}

/** The manifest in the shape lib/screener-data-loader expects. */
export async function screenerInManifest() {
  const b = await buildScreenerInFiles();
  const queries = await loadQueries();
  return {
    lastSync: b.builtAt, ok: SCREENERIN_FILES.length, fail: 0, source: 'market-cockpit stock screener',
    files: SCREENERIN_FILES.map((f) => {
      const x = b.built.get(f.slug)!;
      const def = DEFAULT_QUERY_BY_SLUG[f.slug];
      return {
        name: `${f.slug}.csv`, size: x.csv.length, displayName: f.display, ok: true, source: x.source, note: x.note, rows: x.rows, kind: f.kind,
        query: queries[f.slug]?.query ?? def?.query ?? null, customQuery: !!queries[f.slug],
        screenerInCount: def?.ref ?? null, screenerInUrl: def ? `https://www.screener.in/screens/${def.id}/${f.slug}/` : null,
        members: x.members.slice(0, 200),
      };
    }),
  };
}
