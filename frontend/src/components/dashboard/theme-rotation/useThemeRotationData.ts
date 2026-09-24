'use client';
// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — DATA HOOKS  (zzz795)
//
// Everything the page reads, in one place:
//   · the server board (/api/market/theme-rotation), per market, cached in state;
//   · weekly history (?history=1) and the overlay write-back;
//   · the lazy per-theme drill (?theme=<id>);
//   · browser-side evidence: Technicals / Multibagger uploads, the Conviction
//     bench (India localStorage, US IndexedDB), holdings (India portfolio,
//     US book — read-only), NSE industry look-ups, and catalysts from the
//     filings / news feeds the app already has.
// Every fetch has a timeout and fails soft: a failed source becomes an
// "unknown" layer, never a blank page.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalystInput, GradedInput, Market, Payload, WeeklySnapshot } from '@/lib/theme-rotation/types';
import { readConvictionBeats } from '@/lib/conviction-beats';
import { getUsConvictionList, hydrateUsConviction } from '@/lib/conviction-beats-us';
import { getPortfolioMap } from '@/lib/portfolio-overlay';
import { classifyFiling, classifyNews, dedupeCatalysts, sanitizeTicker } from '@/lib/theme-rotation/evidence-inputs';
import type { RawBenchRow, RawListRow } from '@/lib/theme-rotation/lists';

async function getJson(url: string, ms: number, init?: RequestInit): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
const readLS = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };

// ── the server board ──────────────────────────────────────────────────────
export function useBoard(region: Market) {
  const [data, setData] = useState<Record<Market, Payload | null>>({ us: null, india: null });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<Market, string | null>>({ us: null, india: null });
  const [loadedAt, setLoadedAt] = useState<Record<Market, number>>({ us: 0, india: 0 });
  const tried = useRef<Set<Market>>(new Set());
  const load = useCallback(async (r: Market, force = false) => {
    tried.current.add(r);
    setLoading(true); setErrors((p) => ({ ...p, [r]: null }));
    try {
      const j = (await getJson(`/api/market/theme-rotation?region=${r}${force ? '&refresh=1' : ''}`, 75_000)) as Payload;
      // A failed rebuild must not wipe a good board already on screen.
      setData((p) => ({ ...p, [r]: j?.error && p[r] && !p[r]!.error ? p[r] : j }));
      setLoadedAt((p) => ({ ...p, [r]: Date.now() }));
      if (j?.error) setErrors((p) => ({ ...p, [r]: `The theme engine returned an error: ${j.error}.` }));
    } catch (e: any) {
      setErrors((p) => ({ ...p, [r]: e?.name === 'AbortError' ? 'The board took too long to build. Try again in a minute.' : 'Could not reach the theme engine.' }));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (!data[region] && !tried.current.has(region)) void load(region); }, [region, data, load]);
  return { payload: data[region], loading, error: errors[region], load, loadedAt: loadedAt[region] };
}

// ── weekly history ────────────────────────────────────────────────────────
export function useHistory(region: Market, reloadKey: number) {
  const [state, setState] = useState<{ snapshots: WeeklySnapshot[]; currentWeek: string | null; error: string | null; loaded: boolean }>({ snapshots: [], currentWeek: null, error: null, loaded: false });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loaded: false }));
    getJson(`/api/market/theme-rotation?region=${region}&history=1&weeks=12`, 15_000)
      .then((j) => { if (alive) setState({ snapshots: Array.isArray(j?.snapshots) ? j.snapshots : [], currentWeek: j?.currentWeek || null, error: j?.error || null, loaded: true }); })
      .catch(() => { if (alive) setState({ snapshots: [], currentWeek: null, error: 'History could not be read.', loaded: true }); });
    return () => { alive = false; };
  }, [region, reloadKey]);
  return state;
}

export async function postOverlay(region: Market, week: string, overlay: Record<string, unknown>): Promise<boolean> {
  try {
    const j = await getJson('/api/market/theme-rotation', 15_000, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region, week, overlay }) });
    return !!j?.ok;
  } catch { return false; }
}

// ── drill-down per theme ──────────────────────────────────────────────────
export function useDrill(region: Market) {
  const [drill, setDrill] = useState<Record<string, any>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const asked = useRef<Set<string>>(new Set());
  // zzz797 — `extra`: small / mid caps from your lists and the graded history
  // mapped to this theme, priced alongside the declared constituents.
  const loadDrill = useCallback(async (themeId: string, force = false, extra: string[] = []) => {
    const key = `${region}:${themeId}`;
    if (asked.current.has(key) && !force) return;
    asked.current.add(key);
    setLoadingKey(key);
    try {
      const ex = extra.length ? `&extra=${encodeURIComponent(extra.slice(0, 12).join(','))}` : '';
      const j = await getJson(`/api/market/theme-rotation?region=${region}&theme=${encodeURIComponent(themeId)}${ex}${force ? '&refresh=1' : ''}`, 45_000);
      setDrill((p) => ({ ...p, [key]: j }));
    } catch {
      setDrill((p) => ({ ...p, [key]: { themeId, stocks: [], error: 'Constituents could not be loaded. Try again.' } }));
      asked.current.delete(key);
    } finally { setLoadingKey((k) => (k === key ? null : k)); }
  }, [region]);
  const reset = useCallback(() => { asked.current.clear(); setDrill({}); }, []);
  return { drill, loadingKey, loadDrill, reset };
}

// ── browser-side lists, bench and holdings ────────────────────────────────
export interface ClientLists {
  tech: RawListRow[];
  fundo: RawListRow[];
  bench: RawBenchRow[];
  benchReady: boolean;
  held: Set<string>;
  holdingsSource: string;
  holdingsNote: string | null;
  /** zzz797 — held lines left out of theme counts (non-US listings), with why. */
  nonUs: Map<string, string>;
  /** zzz797 — quantity held (US book), for value weights. */
  qty: Map<string, number>;
  /** zzz797 — current value where the portfolio page stores one (India). */
  values: Map<string, number>;
}

export function useClientLists(region: Market, reloadKey: number): ClientLists {
  const [benchReady, setBenchReady] = useState(false);
  const [usBook, setUsBook] = useState<{ held: string[]; note: string | null; nonUs: Array<[string, string]>; qty: Array<[string, number]> } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { void hydrateUsConviction().catch(() => 0).finally(() => setBenchReady(true)); }, []);
  // Re-read when another tab updates the bench or the portfolio.
  useEffect(() => {
    const bump = () => setTick((x) => x + 1);
    window.addEventListener('storage', bump);
    window.addEventListener('conviction-beats:updated', bump as any);
    return () => { window.removeEventListener('storage', bump); window.removeEventListener('conviction-beats:updated', bump as any); };
  }, []);
  useEffect(() => {
    if (region !== 'us') return;
    let alive = true;
    // zzz797 — the full book (holdings only; cash is kept apart in the book
    // and never read here): tickers, listing and quantity. A Frankfurt (FWB2)
    // or other non-US line is kept OUT of the theme counts and labelled.
    getJson('/api/v1/us-book', 15_000)
      .then((j) => {
        if (!alive) return;
        const hs = Array.isArray(j?.book?.holdings) ? j.book.holdings : [];
        const held: string[] = [], nonUs: Array<[string, string]> = [], qty = new Map<string, number>();
        const isUs = new Set<string>();
        for (const h of hs) { const t = sanitizeTicker(h?.ticker); if (t && h?.listing === 'US') isUs.add(t); }
        for (const h of hs) {
          const t = sanitizeTicker(h?.ticker); if (!t) continue;
          held.push(t);
          if (!isUs.has(t)) nonUs.push([t, `held on ${h?.listingNote || h?.exchange || 'a non-US venue'} — no US theme`]);
          else if (h?.listing === 'US' && typeof h?.quantity === 'number') qty.set(t, (qty.get(t) || 0) + h.quantity);
        }
        setUsBook({ held: [...new Set(held)], note: j?.ok === false ? 'The US book could not be read.' : null, nonUs, qty: [...qty.entries()] });
      })
      .catch(() => { if (alive) setUsBook({ held: [], note: 'The US book could not be read (you may need to sign in).', nonUs: [], qty: [] }); });
    return () => { alive = false; };
  }, [region, reloadKey]);

  return useMemo(() => {
    const tech = (readLS(region === 'us' ? 'mb_tech_rows_usa_v1' : 'mb_tech_rows_ind_v1') || []) as RawListRow[];
    const fundo = (readLS(region === 'us' ? 'mb_usa_scored_v2' : 'mb_excel_scored_v2') || []) as RawListRow[];
    const bench: RawBenchRow[] = [];
    try {
      if (region === 'us') {
        for (const e of getUsConvictionList() as any[]) bench.push({ ticker: e.ticker, company: e.company, sector: e.sector, industry: e.industry, tier: e.tier, filing_date: e.filing_date, pe: e.pe, url: e.release_url || e.source_url || null, mcap: typeof e.market_cap_musd === 'number' ? e.market_cap_musd : null });
      } else {
        const cb = readConvictionBeats() as Record<string, any>;
        for (const k of Object.keys(cb)) { const e = cb[k]; bench.push({ ticker: e?.ticker || k, company: e?.company, sector: e?.sector, industry: e?.industry, tier: e?.tier, filing_date: e?.filing_date, pe: e?.pe, url: e?.source_url || null, mcap: typeof e?.market_cap_cr === 'number' ? e.market_cap_cr : null }); }
      }
    } catch { /* bench unreadable → earnings layer reads "unknown" */ }
    const held = new Set<string>();
    const values = new Map<string, number>();
    const pfQty = new Map<string, number>();
    let holdingsSource = '';
    try {
      for (const [sym, h] of getPortfolioMap()) {
        const isUs = h.market === 'US';
        if ((region === 'us') === isUs) {
          const t = sanitizeTicker(sym); if (!t) continue;
          held.add(t);
          if (region === 'india' && typeof h.currentValue === 'number' && h.currentValue > 0) values.set(t, h.currentValue);
          if (typeof h.quantity === 'number' && h.quantity > 0) pfQty.set(t, h.quantity);
        }
      }
      holdingsSource = region === 'us' ? 'US book + portfolio page' : 'Portfolio page (this browser)';
    } catch { /* none */ }
    if (region === 'us' && usBook) for (const t of usBook.held) held.add(t);
    // The US book's quantity wins; the portfolio page fills the rest.
    const qty = new Map<string, number>(pfQty);
    if (region === 'us' && usBook) for (const [t, q] of usBook.qty) qty.set(t, q);
    return {
      tech: Array.isArray(tech) ? tech : [], fundo: Array.isArray(fundo) ? fundo : [], bench,
      benchReady: region === 'us' ? benchReady : true,
      held, holdingsSource, holdingsNote: region === 'us' ? (usBook?.note ?? null) : null,
      nonUs: new Map(region === 'us' && usBook ? usBook.nonUs : []), qty, values,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, benchReady, usBook, tick, reloadKey]);
}

// ── NSE industry look-ups (India) ─────────────────────────────────────────
export function useNseIndustry(region: Market, missing: string[]) {
  const [map, setMap] = useState<Record<string, string>>({});
  const asked = useRef<Set<string>>(new Set());
  // Bumped after every batch, hit or miss, so the next batch always follows —
  // a batch that resolves nothing must not stall the queue.
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (region !== 'india') return;
    let alive = true;
    const local = readLS('mc:nse-industry:v2');
    if (local && typeof local === 'object') setMap((p) => ({ ...local, ...p }));
    getJson('/api/v1/nse-industry', 20_000).then((j) => { if (alive && j?.map) setMap((p) => ({ ...j.map, ...p })); }).catch(() => { /* stays as is */ });
    return () => { alive = false; };
  }, [region]);
  // The long tail, ten at a time; every answer is kept server-side for good.
  useEffect(() => {
    if (region !== 'india' || !missing.length) return;
    const batch = missing.filter((t) => !map[t] && !asked.current.has(t) && !/^\d+$/.test(t)).slice(0, 10);
    if (!batch.length) return;
    batch.forEach((t) => asked.current.add(t));
    getJson(`/api/v1/nse-industry?tickers=${encodeURIComponent(batch.join(','))}`, 30_000).then((j) => {
      if (!j?.map) return;
      const add: Record<string, string> = {};
      for (const [k, v] of Object.entries(j.map as Record<string, string | null>)) if (v) add[k] = v;
      if (Object.keys(add).length) setMap((p) => {
        const next = { ...p, ...add };
        try { localStorage.setItem('mc:nse-industry:v2', JSON.stringify(next)); } catch { /* quota */ }
        return next;
      });
    }).catch(() => { /* retried on a later visit */ }).finally(() => setRound((r) => r + 1));
  }, [region, missing, map, round]);
  // Names not yet asked about (numeric BSE codes cannot be looked up).
  const pending = region === 'india' ? missing.filter((t) => !map[t] && !asked.current.has(t) && !/^\d+$/.test(t)).length : 0;
  return { map, pending };
}

// ── catalysts from filings and news ───────────────────────────────────────
// zzz797 — the layer compares the last 14 days with the 14 before, so the
// feeds are asked for 28 days. `coverageDays` is how far back the items that
// came back actually reach (market-wide): a news feed of the latest 300
// headlines may cover only a few days, and then the layer reads as a level.
export const CATALYST_WINDOW_DAYS = 14;
export function useCatalysts(region: Market, reloadKey: number) {
  const [state, setState] = useState<{ items: CatalystInput[] | null; loaded: boolean; sources: string[]; coverageDays: number }>({ items: null, loaded: false, sources: [], coverageDays: 0 });
  useEffect(() => {
    let alive = true;
    setState({ items: null, loaded: false, sources: [], coverageDays: 0 });
    (async () => {
      const now = Date.now();
      const reach = (dates: string[]) => { const ts = dates.map((d) => new Date(d).getTime()).filter(Number.isFinite); return ts.length ? (now - Math.min(...ts)) / 86_400_000 : 0; };
      const jobs: Array<Promise<{ src: string; items: CatalystInput[]; reach: number } | null>> = [];
      if (region === 'india') {
        const feed = async (days: number) => {
          const j = await getJson(`/api/v1/concall-intel/live-feed?days=${days}&bullishOnly=false&cacheOnly=1`, 12_000);
          const fs = Array.isArray(j?.filings) ? j.filings : [];
          if (!fs.length && (j?.cacheStatus === 'CACHE_WARMING' || j?.error)) return null;
          return { src: `NSE/BSE filings (${days}d)`, items: fs.map(classifyFiling).filter(Boolean) as CatalystInput[], reach: Math.min(days, reach(fs.map((f: any) => String(f?.filing_datetime || '')))) };
        };
        jobs.push(feed(CATALYST_WINDOW_DAYS * 2).then((r) => r || feed(CATALYST_WINDOW_DAYS)).catch(() => null));
      }
      jobs.push(getJson(`/api/v1/news?region=${region === 'us' ? 'US' : 'IN'}&limit=300`, 15_000).then((j) => {
        const arr = Array.isArray(j) ? j : Array.isArray(j?.articles) ? j.articles : [];
        return { src: 'News feed', items: arr.flatMap(classifyNews), reach: reach(arr.map((a: any) => String(a?.published_at || ''))) };
      }).catch(() => null));
      const got = await Promise.all(jobs);
      if (!alive) return;
      const ok = got.filter(Boolean) as Array<{ src: string; items: CatalystInput[]; reach: number }>;
      setState({ items: ok.length ? dedupeCatalysts(ok.flatMap((g) => g.items)) : null, loaded: true, sources: ok.map((g) => g.src), coverageDays: ok.length ? Math.max(...ok.map((g) => g.reach)) : 0 });
    })();
    return () => { alive = false; };
  }, [region, reloadKey]);
  return state;
}

// ── graded-earnings history (India)  (zzz797) ─────────────────────────────
export function useGradedHistory(region: Market, reloadKey: number) {
  const [state, setState] = useState<{ rows: GradedInput[] | null; loaded: boolean; coverage: any; note: string | null }>({ rows: null, loaded: false, coverage: null, note: null });
  useEffect(() => {
    let alive = true;
    setState({ rows: null, loaded: false, coverage: null, note: null });
    if (region !== 'india') { setState({ rows: null, loaded: true, coverage: null, note: null }); return; }
    getJson(`/api/market/theme-rotation?region=india&earnings=1`, 55_000)
      .then((j) => { if (alive) setState({ rows: Array.isArray(j?.rows) && j.rows.length ? j.rows as GradedInput[] : null, loaded: true, coverage: j?.coverage || null, note: j?.error || j?.note || null }); })
      .catch(() => { if (alive) setState({ rows: null, loaded: true, coverage: null, note: 'Graded history could not be read; the bench is used instead.' }); });
    return () => { alive = false; };
  }, [region, reloadKey]);
  return state;
}

// ── SEC industry for US names  (zzz797) ───────────────────────────────────
export interface SecProfile { ticker: string; status?: string; sic?: string | null; sicDescription?: string | null; name?: string | null }
export function useUsProfiles(region: Market, tickers: string[]) {
  const [map, setMap] = useState<Record<string, SecProfile>>({});
  const [loaded, setLoaded] = useState(false);
  // Order kept (holdings first): the server looks up at most 40 new names a call.
  const key = region === 'us' ? [...new Set(tickers)].join(',') : '';
  useEffect(() => {
    if (!key) { setLoaded(true); return; }
    let alive = true;
    setLoaded(false);
    const LS = 'mc:theme-rotation:us-profile:v1';
    const local = readLS(LS);
    if (local && typeof local === 'object') setMap((p) => ({ ...local, ...p }));
    const want = key.split(',').filter((t) => !(local && local[t]?.status === 'sec'));
    if (!want.length) { setLoaded(true); return; }
    // The server looks up at most 40 new names per call (the SEC's pace), so
    // ask in rounds of 40, holdings first, at most five rounds per visit.
    (async () => {
      for (let i = 0; i < want.length && i < 200 && alive; i += 40) {
        try {
          const j = await getJson(`/api/market/theme-rotation?region=us&profiles=1&tickers=${encodeURIComponent(want.slice(i, i + 40).join(','))}`, 55_000);
          if (!alive || !j?.profiles) break;
          setMap((p) => {
            const next = { ...p, ...j.profiles };
            try { localStorage.setItem(LS, JSON.stringify(next)); } catch { /* quota */ }
            return next;
          });
        } catch { break; /* names stay unplaced, with the reason shown */ }
      }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [key]);
  return { map, loaded };
}

// ── holdings' own price moves  (zzz797) ───────────────────────────────────
export function useHoldingQuotes(region: Market, tickers: string[], reloadKey: number) {
  const [quotes, setQuotes] = useState<Record<string, { price: number | null; w1: number | null; m1: number | null }>>({});
  const key = [...new Set(tickers)].sort().join(',');
  useEffect(() => {
    if (!key) { setQuotes({}); return; }
    let alive = true;
    getJson(`/api/market/theme-rotation?region=${region}&holdings=1&tickers=${encodeURIComponent(key)}`, 45_000)
      .then((j) => { if (alive) setQuotes(j?.quotes || {}); })
      .catch(() => { if (alive) setQuotes({}); });
    return () => { alive = false; };
  }, [region, key, reloadKey]);
  return quotes;
}
