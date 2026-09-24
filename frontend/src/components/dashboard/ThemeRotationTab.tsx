'use client';
// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION TAB — US + India  (zzz480 → zzz795 overhaul)
//
// One primary view instead of five that repeated each other. Top to bottom:
//   1. Summary strip — market condition, what changed this week, early
//      rotation, risk flags (breakdown / short-term break / crowded), and any
//      rotation between themes.
//   2. The ranked theme table — ordered by research priority (quality and
//      materiality of evidence, never by % price change), sortable on every
//      column, filterable, with an evidence panel per theme.
//   3. The rotation map (RRG) — the one chart, because it shows the path.
//   4. Names on your lists by theme — collapsed; holdings kept separate.
//
// Seven evidence layers are read separately for every theme (strength,
// breadth, capital-flow proxy, earnings, catalysts, valuation, price). No
// 0–100 score is shown anywhere: a tier word and a "Why:" line instead.
// The pure logic lives in src/lib/theme-rotation/* and is unit-tested.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Market, PrintInput } from '@/lib/theme-rotation/types';
import { buildViewModel, overlayFromView, type ThemeView } from '@/lib/theme-rotation/view-model';
import { membershipFrom, printsByTheme, catalystsByTheme, themesForTicker, sanitizeTicker } from '@/lib/theme-rotation/evidence-inputs';
import { buildListEntries, bestSupported, holdingsExposure, listOrder, type ListEntry } from '@/lib/theme-rotation/lists';
import { filterViews, sortViews, emptyFilter, type SortDir, type SortKey, type TableFilter } from '@/lib/theme-rotation/table';
import { isoWeek } from '@/lib/theme-rotation/history';
import { classifyThemeDetailed } from '@/lib/theme-classify';
import { themesForRegion, drillSymbolsFor, leadersFor } from '@/lib/theme-universe';
import { buildTvExport } from '@/lib/us-tradingview';
import { useBoard, useHistory, useDrill, useClientLists, useNseIndustry, useCatalysts, postOverlay, CATALYST_WINDOW_DAYS } from './theme-rotation/useThemeRotationData';
import { SummaryStrip } from './theme-rotation/SummaryStrip';
import { ThemeTable, THEME_ROTATION_CSS } from './theme-rotation/ThemeTable';
import { EvidencePanel } from './theme-rotation/EvidencePanel';
import { RrgMap } from './theme-rotation/RrgMap';
import { ListsByTheme } from './theme-rotation/ListsByTheme';
import { card } from './theme-rotation/ui';
import { T, tint } from './theme-rotation/tokens';

export default function ThemeRotationTab() {
  const [region, setRegion] = useState<Market>('us');
  // A link like /multibagger?tab=theme-rotation&region=india opens that market.
  useEffect(() => {
    try { const r = new URLSearchParams(window.location.search).get('region'); if (r === 'india' || r === 'us') setRegion(r); } catch { /* ignore */ }
  }, []);
  const [reloadKey, setReloadKey] = useState(0);
  const board = useBoard(region);
  const history = useHistory(region, reloadKey);
  const { drill, loadingKey, loadDrill, reset: resetDrill } = useDrill(region);
  const lists = useClientLists(region, reloadKey);
  const catalysts = useCatalysts(region, reloadKey);
  const [missing, setMissing] = useState<string[]>([]);
  const { map: nse, pending: nsePending } = useNseIndustry(region, missing);

  const payload = board.payload && !board.payload.error && Array.isArray(board.payload.themes) ? board.payload : null;
  const defs = useMemo(() => themesForRegion(region), [region]);
  const themeMembers = useMemo(() => Object.fromEntries(defs.map((t) => [t.id, drillSymbolsFor(t)])), [defs]);
  const membership = useMemo(() => membershipFrom(themeMembers), [themeMembers]);

  // ── names on your lists, classified ────────────────────────────────────
  const entries: ListEntry[] = useMemo(() => buildListEntries(lists.tech, lists.fundo, lists.bench, lists.held, (e) => {
    const n = region === 'india' ? nse[e.ticker] : undefined;
    return classifyThemeDetailed(e.sector || n, e.industry || n, region, e.ticker, e.company);
  }), [lists, nse, region]);
  useEffect(() => {
    // Unplaced names, and names placed only by their company name or ticker:
    // a real industry is a better answer, so both are looked up (India).
    const m = entries.filter((e) => !e.theme || e.via === 'name' || e.via === 'ticker').map((e) => e.ticker);
    setMissing((prev) => (prev.length === m.length && prev.every((x, i) => x === m[i]) ? prev : m));
  }, [entries]);
  const entryTheme = useMemo(() => new Map(entries.map((e) => [e.ticker, e.theme])), [entries]);
  const themesOf = useCallback((ticker: string) => themesForTicker(ticker, membership, entryTheme.get(sanitizeTicker(ticker)) ?? null), [membership, entryTheme]);

  // ── browser-side evidence ──────────────────────────────────────────────
  const benchLoaded = region === 'us' ? lists.benchReady && lists.bench.length > 0 : lists.bench.length > 0;
  const prints = useMemo(() => {
    if (!benchLoaded) return null;
    const ps: PrintInput[] = lists.bench.filter((b) => /BLOCK|STRONG/i.test(b.tier || '') && b.filing_date)
      .map((b) => ({ ticker: b.ticker, tier: String(b.tier), filingDate: String(b.filing_date), company: b.company, url: b.url, pe: b.pe }));
    return printsByTheme(ps, (p) => themesOf(p.ticker));
  }, [benchLoaded, lists.bench, themesOf]);
  const cats = useMemo(() => (catalysts.items ? catalystsByTheme(catalysts.items, themesOf) : null), [catalysts.items, themesOf]);
  const { pesByTheme, allPEs } = useMemo(() => {
    const by: Record<string, number[]> = {}; const all: number[] = [];
    for (const b of lists.bench) {
      if (typeof b.pe !== 'number' || !(b.pe > 0)) continue;
      all.push(b.pe);
      for (const th of themesOf(b.ticker)) (by[th] ||= []).push(b.pe);
    }
    return { pesByTheme: by, allPEs: all };
  }, [lists.bench, themesOf]);
  const beneficiariesOf = useCallback((id: string) => {
    const d = drill[`${region}:${id}`];
    const subs: any[] = Array.isArray(d?.subs) ? d.subs.filter((s: any) => !s.residual && s.leader) : [];
    if (subs.length) return subs.slice(0, 3).map((s) => `${s.leader} (${s.name})`);
    const def = defs.find((t) => t.id === id);
    return def ? leadersFor(def).slice(0, 4).map(sanitizeTicker) : [];
  }, [drill, region, defs]);

  const currentWeek = history.currentWeek || isoWeek(new Date());
  const vm = useMemo(() => {
    if (!payload) return null;
    return buildViewModel({
      payload, now: new Date(),
      printsByTheme: prints, benchLabel: `${region === 'us' ? 'US' : 'India'} Conviction bench (BLOCKBUSTER / STRONG prints)`,
      catalystsByTheme: cats, catalystWindowDays: CATALYST_WINDOW_DAYS,
      pesByTheme, allPEs, snapshots: history.snapshots, currentWeek, beneficiariesOf,
    });
  }, [payload, prints, cats, pesByTheme, allPEs, history.snapshots, currentWeek, beneficiariesOf, region]);

  // ── write this week's evidence overlay (once per market per session) ──
  const posted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!vm || !vm.themes.length || !history.loaded || !catalysts.loaded || (region === 'us' && !lists.benchReady)) return;
    const key = `${region}:${currentWeek}`;
    if (posted.current.has(key)) return;
    const mine = history.snapshots.find((s) => s.week === currentWeek);
    const fresh = mine?.overlayAt && Date.now() - new Date(mine.overlayAt).getTime() < 6 * 3600_000;
    posted.current.add(key);
    if (fresh) return;
    void postOverlay(region, currentWeek, overlayFromView(vm));
  }, [vm, history.loaded, history.snapshots, catalysts.loaded, lists.benchReady, region, currentWeek]);

  // ── table state ────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filter, setFilter] = useState<TableFilter>(emptyFilter);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => { setExpanded(new Set()); }, [region]);

  const groups = useMemo(() => {
    const byTheme = new Map<string, ListEntry[]>();
    for (const e of entries) if (e.theme) (byTheme.get(e.theme) || byTheme.set(e.theme, []).get(e.theme)!).push(e);
    for (const arr of byTheme.values()) arr.sort(listOrder);
    return byTheme;
  }, [entries]);
  const yours = useCallback((id: string) => groups.get(id)?.length || 0, [groups]);
  const heldIn = useCallback((id: string) => groups.get(id)?.filter((e) => e.held).length || 0, [groups]);

  const shown = useMemo(() => (vm ? sortViews(filterViews(vm.themes, filter, yours), sortKey, sortDir, yours) : []), [vm, filter, sortKey, sortDir, yours]);
  const nameOf = useCallback((id: string) => { const v = vm?.byId.get(id); return v ? `${v.row.emoji} ${v.row.name}` : id; }, [vm]);

  const toggle = useCallback((id: string) => {
    setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else { n.add(id); void loadDrill(id); } return n; });
  }, [loadDrill]);
  const shownIds = useMemo(() => new Set(shown.map((v) => v.row.id)), [shown]);
  const pick = useCallback((id: string) => {
    // Clear filters only if they are hiding the theme that was asked for.
    if (!shownIds.has(id)) setFilter(emptyFilter());
    setExpanded((cur) => new Set(cur).add(id));
    void loadDrill(id);
    setTimeout(() => { try { document.getElementById(`trt-row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ } }, 60);
  }, [loadDrill, shownIds]);
  const expandAll = useCallback(() => {
    const ids = shown.map((v) => v.row.id);
    setExpanded(new Set(ids));
    ids.forEach((id, i) => setTimeout(() => void loadDrill(id), i * 150));
  }, [shown, loadDrill]);

  // ── holdings, best-supported names ─────────────────────────────────────
  const favoured = useMemo(() => new Set((vm?.themes || []).filter((v) => (v.row.verdict === 'BUY' || v.row.verdict === 'EARLY BUY') && !v.a.flags.some((f) => f.kind === 'breakdown')).map((v) => v.row.id)), [vm]);
  const risky = useMemo(() => new Set((vm?.themes || []).filter((v) => v.row.verdict === 'TRIM' || v.row.verdict === 'AVOID' || v.a.flags.some((f) => f.kind === 'breakdown')).map((v) => v.row.id)), [vm]);
  const crowded = useMemo(() => new Set(vm?.summary.crowded || []), [vm]);
  const holdings = useMemo(() => holdingsExposure(entries, favoured, risky, crowded), [entries, favoured, risky, crowded]);
  const best = useMemo(() => bestSupported(entries, favoured, new Date().toISOString()), [entries, favoured]);

  // ── TradingView export (grouped by print tier × verdict) ───────────────
  const [tvScope, setTvScope] = useState<'combo' | 'hold' | 'all'>('combo');
  const [tvBusy, setTvBusy] = useState(false);
  const [tvDone, setTvDone] = useState(false);
  const tvGroups = useMemo(() => {
    const verdicts = tvScope === 'combo' ? ['BUY', 'EARLY BUY'] : tvScope === 'hold' ? ['BUY', 'EARLY BUY', 'HOLD'] : ['BUY', 'EARLY BUY', 'HOLD', 'WATCH', 'TRIM', 'AVOID'];
    const out = new Map<string, string[]>();
    for (const e of entries) {
      const v = e.theme ? vm?.byId.get(e.theme)?.row.verdict : undefined;
      if (!v || !verdicts.includes(v)) continue;
      const tier = /BLOCK/i.test(e.benchTier || '') ? 'BB' : /STRONG/i.test(e.benchTier || '') ? 'STRONG' : '';
      if (tvScope !== 'all' && !tier) continue;
      const label = tvScope === 'all' ? v : `${tier} · ${v}`;
      (out.get(label) || out.set(label, []).get(label)!).push(e.ticker);
    }
    const rank = (k: string) => { const [a, b] = k.includes(' · ') ? k.split(' · ') : ['', k]; return (a === 'BB' ? 0 : a === 'STRONG' ? 1 : 2) * 10 + Math.max(0, ['BUY', 'EARLY BUY', 'HOLD', 'WATCH', 'TRIM', 'AVOID'].indexOf(b)); };
    const ordered = [...out.entries()].sort((x, y) => rank(x[0]) - rank(y[0]));
    return { ordered, total: ordered.reduce((a, [, v]) => a + v.length, 0) };
  }, [entries, vm, tvScope]);
  const copyTv = useCallback(async () => {
    setTvBusy(true);
    try {
      const all = tvGroups.ordered.flatMap(([, v]) => v);
      if (!all.length) return;
      let venues: Record<string, string | null> = {};
      if (region === 'us') {
        try { const r = await fetch(`/api/v1/us/exchange?tickers=${encodeURIComponent(all.slice(0, 600).join(','))}`, { cache: 'no-store' }); venues = (await r.json())?.map || {}; } catch { /* bare ticker still imports */ }
      }
      const out = buildTvExport(tvGroups.ordered.map(([label, list]) => ({
        label: `${region === 'us' ? 'US' : 'IN'} ${label}`,
        rows: list.map((t) => ({ ticker: t, exchange: region === 'us' ? (venues[t] ?? null) : (/^\d+$/.test(t) ? 'BSE' : 'NSE') })),
      })));
      if (!out.count) return;
      try { await navigator.clipboard.writeText(out.text); setTvDone(true); setTimeout(() => setTvDone(false), 2500); }
      catch {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/plain' }));
        a.download = `theme-rotation-${region}-tradingview.txt`; a.click(); URL.revokeObjectURL(a.href);
      }
    } finally { setTvBusy(false); }
  }, [tvGroups, region]);

  const refresh = useCallback(() => {
    resetDrill();
    setReloadKey((k) => k + 1);
    void board.load(region, true);
  }, [board, region, resetDrill]);

  const benchName = payload?.benchmark?.name || (region === 'us' ? 'S&P 500' : 'NIFTY 50');
  const flowsFor = (id: string) => (vm?.flows || []).filter((f) => f.from === id || f.to === id);
  const clusterPeers = (v: ThemeView) => (v.row.cluster == null || !vm ? [] : vm.themes.filter((o) => o.row.id !== v.row.id && o.row.cluster === v.row.cluster).map((o) => o.row.id));
  const highlight = useMemo(() => new Set([...(vm?.summary.early || []), ...(vm?.summary.breakdown || [])]), [vm]);
  const listGroups = useMemo(() => (vm ? vm.themes.filter((v) => groups.has(v.row.id)).map((v) => ({ v, names: groups.get(v.row.id)! })) : []), [vm, groups]);
  const unclassified = useMemo(() => entries.filter((e) => !e.theme).sort(listOrder), [entries]);
  const asOf = payload?.asOf ? new Date(payload.asOf) : null;

  return (
    <div className="trt-root" style={{ background: T.bg, borderRadius: 12, padding: 14, color: T.text, minHeight: 400 }}>
      <style>{THEME_ROTATION_CSS}</style>
      {/* Header */}
      <div className="trt-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Theme Rotation</div>
          <div style={{ fontSize: 11.5, color: T.faint, marginTop: 2, lineHeight: 1.4 }}>
            Which themes deserve research first — ranked by the quality of the evidence, not by how far the price moved. Measured against {benchName}.
            {asOf ? <> Updated {asOf.toLocaleString()}.</> : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div role="group" aria-label="Market" style={{ display: 'flex', background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {(['us', 'india'] as Market[]).map((r) => (
              <button key={r} type="button" onClick={() => setRegion(r)} aria-pressed={region === r}
                style={{ padding: '6px 14px', border: 'none', cursor: 'pointer', background: region === r ? tint(T.accent, 22) : 'transparent', color: region === r ? T.text : T.faint, fontSize: 12.5, fontWeight: 800 }}>
                {r === 'us' ? 'USA' : 'India'}
              </button>
            ))}
          </div>
          <button type="button" onClick={refresh} disabled={board.loading} title="Rebuild from live prices (skips the cache) and re-read your lists, filings and news"
            style={{ fontSize: 11.5, fontWeight: 800, padding: '6px 11px', borderRadius: 7, cursor: board.loading ? 'wait' : 'pointer', border: `1px solid ${tint(T.up, 45)}`, background: 'transparent', color: T.up }}>
            {board.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Loading / error / empty */}
      {board.loading && !board.payload ? <div style={{ ...card, color: T.faint, fontSize: 12.5, textAlign: 'center', padding: 28 }}>Scoring every theme on live prices… the first build of the day can take up to a minute.</div> : null}
      {board.error ? (
        <div style={{ ...card, borderColor: tint(T.down, 45), color: T.down, fontSize: 12.5, marginBottom: 10 }}>
          {board.error} {payload ? 'Showing the last good board.' : ''}{' '}
          <button type="button" onClick={refresh} style={{ background: 'none', border: `1px solid ${T.border2}`, color: T.dim, borderRadius: 6, cursor: 'pointer', fontSize: 11.5, padding: '2px 8px' }}>Try again</button>
        </div>
      ) : null}
      {payload && !payload.themes.length ? <div style={{ ...card, color: T.faint, fontSize: 12.5 }}>No themes could be priced right now. Try Refresh in a few minutes.</div> : null}

      {vm && vm.themes.length > 0 && (
        <>
          <SummaryStrip vm={vm} benchName={benchName} nameOf={nameOf} onPick={pick} holdings={holdings.total ? holdings : null} historyLoaded={history.loaded} />

          <ThemeTable
            rows={shown} total={vm.themes.length}
            sortKey={sortKey} sortDir={sortDir} onSort={(k, d) => { setSortKey(k); setSortDir(d); }}
            filter={filter} onFilter={setFilter}
            expanded={expanded} onToggle={toggle} onExpandAll={expandAll} onCollapseAll={() => setExpanded(new Set())}
            yours={yours} heldIn={heldIn}
            renderPanel={(v) => (
              <EvidencePanel v={v} drill={drill[`${region}:${v.row.id}`]} drillLoading={loadingKey === `${region}:${v.row.id}`}
                onRetryDrill={() => void loadDrill(v.row.id, true)}
                listNames={groups.get(v.row.id) || []} flows={flowsFor(v.row.id)} clusterPeers={clusterPeers(v)}
                snapshots={history.snapshots} nameOf={nameOf} onPick={pick} />
            )}
          />

          {/* The one chart */}
          <div className="trt-rrg-split" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 420px) 1fr', gap: 12, alignItems: 'start', marginTop: 14 }}>
            <div style={card}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text }}>Rotation map</div>
              <div style={{ fontSize: 10.5, color: T.faint, margin: '2px 0 6px', lineHeight: 1.45 }}>Relative strength (→) against its momentum (↑) with an 8-week tail. Themes travel clockwise. Ringed dots crossed a quadrant this week or carry an early-rotation / breakdown flag. Click a dot to open its evidence.</div>
              <RrgMap themes={vm.themes.map((v) => v.row)} hover={hover} setHover={setHover} onPick={pick} highlight={highlight} />
            </div>
            <div style={{ ...card, fontSize: 11.5, color: T.dim, lineHeight: 1.55 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 4 }}>How to read this page</div>
              <p style={{ margin: '0 0 6px' }}><b>Priority</b> ranks themes by the quality of the evidence. <b>Research first</b> needs at least three improving layers including earnings or catalysts, or an early-rotation signal. Price and relative strength alone can reach <b>Worth a look</b>, no higher. A breakdown drops a theme to <b>Low priority</b>.</p>
              <p style={{ margin: '0 0 6px' }}><b>Verdict</b> (BUY · EARLY BUY · HOLD · WATCH · TRIM · AVOID) is the rotation call from price and relative strength. A short-term break blocks a BUY; a crowded move is flagged, not turned into a sell.</p>
              <p style={{ margin: '0 0 6px' }}><b>Evidence badges</b>: STR strength · BRD breadth · FLW volume flow (a proxy, not fund-flow data) · ERN graded earnings · CAT dated filings / news · VAL valuation (level only) · PRC price. ▲ improving · ● steady · ▼ weakening · ○ no data (never read as negative).</p>
              <p style={{ margin: 0, color: T.faint }}>
                Data: prices and volume from Yahoo Finance{region === 'india' ? ' and NSE published index closes' : ''}; breadth from each theme's constituent stocks{payload?.coverage?.breadthSkipped ? ` (${payload.coverage.breadthSkipped} themes not reached this build — shown as no data)` : ''}; earnings from your {region === 'us' ? 'US' : 'India'} Conviction bench{benchLoaded ? '' : ' (not loaded on this device)'}; catalysts from {catalysts.sources.length ? catalysts.sources.join(' and ') : 'no feed this visit'} over {CATALYST_WINDOW_DAYS} days; P/E from graded bench rows. Educational, not investment advice.
              </p>
            </div>
          </div>

          <ListsByTheme
            region={region} entries={entries} groups={listGroups} unclassified={unclassified}
            holdings={holdings} holdingsSource={lists.holdingsSource} holdingsNote={lists.holdingsNote}
            best={best} nameOf={nameOf} onPick={pick} resolving={nsePending}
            tv={{ busy: tvBusy, done: tvDone, count: tvGroups.total, onCopy: copyTv, scope: tvScope, setScope: setTvScope }}
          />
        </>
      )}
    </div>
  );
}
