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
import { membershipFrom, catalystsByTheme, themesForTicker, sanitizeTicker, earningsFromBench, earningsFromGraded } from '@/lib/theme-rotation/evidence-inputs';
import { buildListEntries, bestSupported, holdingsExposure, listOrder, isCashLine, unmatchedReason, type ListEntry } from '@/lib/theme-rotation/lists';
import { filterViews, sortViews, emptyFilter, type SortDir, type SortKey, type TableFilter } from '@/lib/theme-rotation/table';
import { isoWeek, changeLog } from '@/lib/theme-rotation/history';
import { heatmapRows, clusterGroups, exposureModel, smallMidBeneficiaries, type Candidate } from '@/lib/theme-rotation/analytics';
import { splitPrints } from '@/lib/theme-rotation/layers';
import { classifyThemeDetailed, type ClassifyResult } from '@/lib/theme-classify';
import { themesForRegion, drillSymbolsFor, sizeClass } from '@/lib/theme-universe';
import { buildTvExport } from '@/lib/us-tradingview';
import { useBoard, useHistory, useDrill, useClientLists, useNseIndustry, useCatalysts, useGradedHistory, useUsProfiles, useHoldingQuotes, postOverlay, CATALYST_WINDOW_DAYS } from './theme-rotation/useThemeRotationData';
import { BreadthHeatmap, ChangeLogPanel, ClusterPanel, ExposurePanel } from './theme-rotation/AnalyticsPanels';
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
  // zzz797 — a held name on no list carries no sector, so it went unmatched.
  // Now, after the sector / industry rungs: the SEC industry code (US), then
  // theme-universe membership (the name is a declared constituent), and only
  // then the company-name / ticker guesses.
  const makeClassify = useCallback((sec: Record<string, { sic?: string | null; sicDescription?: string | null; status?: string }>) => (e: { ticker: string; sector?: string | null; industry?: string | null; company?: string | null }): ClassifyResult | null => {
    const n = region === 'india' ? nse[e.ticker] : undefined;
    const p = region === 'us' ? sec[e.ticker] : undefined;
    const c = classifyThemeDetailed(e.sector || n, e.industry || n, region, e.ticker, e.company, p ? { sic: p.sic, description: p.sicDescription } : null);
    if (c && c.via !== 'name' && c.via !== 'ticker') return c;
    const m = membership.get(sanitizeTicker(e.ticker));
    if (m && m.size) return { theme: [...m][0], via: 'constituent' };
    return c;
  }, [region, nse, membership]);
  const preEntries: ListEntry[] = useMemo(() => buildListEntries(lists.tech, lists.fundo, lists.bench, lists.held, makeClassify({})), [lists, makeClassify]);
  // SEC look-ups: holdings first (they matter most), then unplaced list names.
  const secWanted = useMemo(() => region !== 'us' ? [] : [
    ...preEntries.filter((e) => e.held && !lists.nonUs.has(e.ticker) && !isCashLine(e.ticker)).map((e) => e.ticker),
    ...preEntries.filter((e) => !e.held && !e.theme).map((e) => e.ticker),
    // zzz797 — the US bench's own labels are coarse ("IT"), which piled its
    // prints into a handful of themes and left the rest "no data"; the SEC
    // code places each bench name properly.
    ...preEntries.filter((e) => e.inBench && e.theme && e.via !== 'override').map((e) => e.ticker),
  ], [region, preEntries, lists.nonUs]);
  const { map: secMap } = useUsProfiles(region, secWanted);
  const entries: ListEntry[] = useMemo(() => (region === 'us' ? buildListEntries(lists.tech, lists.fundo, lists.bench, lists.held, makeClassify(secMap)) : preEntries), [region, lists, makeClassify, secMap, preEntries]);
  useEffect(() => {
    // Unplaced names, and names placed only by their company name or ticker:
    // a real industry is a better answer, so both are looked up (India).
    const m = entries.filter((e) => !e.theme || e.via === 'name' || e.via === 'ticker').map((e) => e.ticker);
    setMissing((prev) => (prev.length === m.length && prev.every((x, i) => x === m[i]) ? prev : m));
  }, [entries]);
  const entryTheme = useMemo(() => new Map(entries.map((e) => [e.ticker, e.theme])), [entries]);
  const themesOf = useCallback((ticker: string) => themesForTicker(ticker, membership, entryTheme.get(sanitizeTicker(ticker)) ?? null), [membership, entryTheme]);

  // ── browser-side evidence ──────────────────────────────────────────────
  const graded = useGradedHistory(region, reloadKey);
  // Graded results carry their own sector; classify each company once.
  const gradedTheme = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of graded.rows || []) {
      const t = sanitizeTicker(r.ticker); if (!t || m.has(t)) continue;
      const n = nse[t];
      const c = entryTheme.get(t) ?? classifyThemeDetailed(r.sector || n, r.sector || n, region, t, r.company)?.theme ?? null;
      m.set(t, c);
    }
    return m;
  }, [graded.rows, nse, entryTheme, region]);
  const gradedThemesOf = useCallback((ticker: string) => themesForTicker(ticker, membership, gradedTheme.get(sanitizeTicker(ticker)) ?? entryTheme.get(sanitizeTicker(ticker)) ?? null), [membership, gradedTheme, entryTheme]);

  const benchLoaded = region === 'us' ? lists.benchReady && lists.bench.length > 0 : lists.bench.length > 0;
  const benchPrints = useMemo(() => lists.bench.filter((b) => /BLOCK|STRONG/i.test(b.tier || '') && b.filing_date)
    .map((b) => ({ ticker: b.ticker, tier: String(b.tier), filingDate: String(b.filing_date), company: b.company, url: b.url, pe: b.pe } as PrintInput)), [lists.bench]);
  const themeIds = useMemo(() => defs.map((d) => d.id), [defs]);
  const earningsSource: 'graded' | 'bench' | 'none' = region === 'india' && graded.rows ? 'graded' : benchLoaded ? 'bench' : 'none';
  const earningsByTheme = useMemo(() => {
    const now = new Date();
    if (earningsSource === 'graded') return earningsFromGraded(graded.rows!, gradedThemesOf, themeIds, now);
    if (earningsSource === 'bench') return earningsFromBench(benchPrints, themesOf, themeIds, now);
    return null;
  }, [earningsSource, graded.rows, gradedThemesOf, themeIds, benchPrints, themesOf]);
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

  // ── market caps on file (US $M, India ₹ Cr) — for the small / mid filter ──
  const capMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of graded.rows || []) { const t = sanitizeTicker(r.ticker); if (t && typeof r.mcap === 'number' && r.mcap > 0) m.set(t, r.mcap); }
    for (const e of entries) if (typeof e.mcap === 'number' && e.mcap > 0) m.set(e.ticker, e.mcap);
    return m;
  }, [graded.rows, entries]);
  const capOf = useCallback((sym: string) => capMap.get(sanitizeTicker(sym)) ?? null, [capMap]);

  // Candidate small / mid names per theme: recent strong prints (graded
  // history or bench), names on your lists, declared constituents.
  const candidatesByTheme = useMemo(() => {
    const out = new Map<string, Candidate[]>();
    const push = (th: string, c: Candidate) => { (out.get(th) || out.set(th, []).get(th)!).push(c); };
    const now = new Date();
    const strong = earningsSource === 'graded'
      ? (graded.rows || []).filter((r) => /BLOCK|STRONG/i.test(r.tier)).map((r) => ({ ticker: r.ticker, tier: r.tier, filingDate: r.filingDate } as PrintInput))
      : benchPrints;
    const recent = splitPrints(strong, now).recent.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
    const ofT = earningsSource === 'graded' ? gradedThemesOf : themesOf;
    for (const p of recent) for (const th of ofT(p.ticker)) push(th, { ticker: sanitizeTicker(p.ticker), cap: capOf(p.ticker), strongPrint: p.filingDate.slice(0, 10) });
    for (const e of entries) if (e.theme) push(e.theme, { ticker: e.ticker, cap: e.mcap ?? capOf(e.ticker), onList: true });
    for (const d of defs) for (const s of drillSymbolsFor(d)) push(d.id, { ticker: sanitizeTicker(s), cap: capOf(s) });
    return out;
  }, [earningsSource, graded.rows, benchPrints, gradedThemesOf, themesOf, entries, defs, capOf]);
  const beneficiariesOf = useCallback((id: string) => smallMidBeneficiaries(candidatesByTheme.get(id) || [], region), [candidatesByTheme, region]);
  // Small / mid names to price alongside the declared constituents in a drill.
  const extraFor = useCallback((id: string) => {
    const declared = new Set((defs.find((d) => d.id === id) ? drillSymbolsFor(defs.find((d) => d.id === id)!) : []).map(sanitizeTicker));
    const out: string[] = [];
    for (const c of candidatesByTheme.get(id) || []) {
      const t = sanitizeTicker(c.ticker);
      if (!t || declared.has(t) || out.includes(t) || /^\d+$/.test(t)) continue;
      if (sizeClass(t, region, c.cap ?? null) === 'large') continue;
      if (!c.strongPrint && !c.onList) continue;
      out.push(t);
      if (out.length >= 12) break;
    }
    return out;
  }, [candidatesByTheme, defs, region]);

  const currentWeek = history.currentWeek || isoWeek(new Date());
  const vm = useMemo(() => {
    if (!payload) return null;
    return buildViewModel({
      payload, now: new Date(),
      earningsByTheme,
      benchLabel: earningsSource === 'graded' ? 'India graded results history (all tiers, ~6 months)' : `${region === 'us' ? 'US' : 'India'} Conviction bench (BLOCKBUSTER / STRONG prints)`,
      catalystsByTheme: cats, catalystWindowDays: CATALYST_WINDOW_DAYS, catalystCoverageDays: catalysts.coverageDays,
      pesByTheme, allPEs, snapshots: history.snapshots, currentWeek, beneficiariesOf,
    });
  }, [payload, earningsByTheme, earningsSource, cats, catalysts.coverageDays, pesByTheme, allPEs, history.snapshots, currentWeek, beneficiariesOf, region]);

  // ── write this week's evidence overlay (once per market per session) ──
  const posted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!vm || !vm.themes.length || !history.loaded || !catalysts.loaded || !graded.loaded || (region === 'us' && !lists.benchReady)) return;
    const key = `${region}:${currentWeek}`;
    if (posted.current.has(key)) return;
    const mine = history.snapshots.find((s) => s.week === currentWeek);
    const fresh = mine?.overlayAt && Date.now() - new Date(mine.overlayAt).getTime() < 6 * 3600_000;
    posted.current.add(key);
    if (fresh) return;
    void postOverlay(region, currentWeek, overlayFromView(vm));
  }, [vm, history.loaded, history.snapshots, catalysts.loaded, graded.loaded, lists.benchReady, region, currentWeek]);

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
    setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else { n.add(id); void loadDrill(id, false, extraFor(id)); } return n; });
  }, [loadDrill, extraFor]);
  const shownIds = useMemo(() => new Set(shown.map((v) => v.row.id)), [shown]);
  const pick = useCallback((id: string) => {
    // Clear filters only if they are hiding the theme that was asked for.
    if (!shownIds.has(id)) setFilter(emptyFilter());
    setExpanded((cur) => new Set(cur).add(id));
    void loadDrill(id, false, extraFor(id));
    setTimeout(() => { try { document.getElementById(`trt-row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ } }, 60);
  }, [loadDrill, shownIds, extraFor]);
  const expandAll = useCallback(() => {
    const ids = shown.map((v) => v.row.id);
    setExpanded(new Set(ids));
    ids.forEach((id, i) => setTimeout(() => void loadDrill(id, false, extraFor(id)), i * 150));
  }, [shown, loadDrill, extraFor]);

  // ── holdings, best-supported names ─────────────────────────────────────
  const favoured = useMemo(() => new Set((vm?.themes || []).filter((v) => (v.row.verdict === 'BUY' || v.row.verdict === 'EARLY BUY') && !v.a.flags.some((f) => f.kind === 'breakdown')).map((v) => v.row.id)), [vm]);
  const risky = useMemo(() => new Set((vm?.themes || []).filter((v) => v.row.verdict === 'TRIM' || v.row.verdict === 'AVOID' || v.a.flags.some((f) => f.kind === 'breakdown')).map((v) => v.row.id)), [vm]);
  const crowded = useMemo(() => new Set(vm?.summary.crowded || []), [vm]);
  // Cash / currency lines and non-US listings are held but have no theme:
  // left out of the counts, and listed with the reason.
  const excludedHeld = useMemo(() => {
    const m = new Map<string, string>(lists.nonUs);
    for (const t of lists.held) if (isCashLine(t)) m.set(t, 'cash / currency line');
    return m;
  }, [lists.nonUs, lists.held]);
  const holdings = useMemo(() => holdingsExposure(entries, favoured, risky, crowded, excludedHeld), [entries, favoured, risky, crowded, excludedHeld]);
  const countedHeld = useMemo(() => entries.filter((e) => e.held && !excludedHeld.has(e.ticker)).map((e) => e.ticker), [entries, excludedHeld]);
  const quotes = useHoldingQuotes(region, countedHeld.slice(0, 80), reloadKey);
  const exposure = useMemo(() => (vm ? exposureModel(
    entries, vm.byId,
    (t) => lists.values.get(t) ?? (lists.qty.get(t) && quotes[t]?.price ? lists.qty.get(t)! * quotes[t].price! : null),
    (t) => quotes[t] ?? null,
    (e) => unmatchedReason(e, region, { profile: secMap[e.ticker] || null, industry: region === 'india' ? nse[e.ticker] || null : null }),
    excludedHeld,
  ) : null), [vm, entries, lists.values, lists.qty, quotes, region, secMap, nse, excludedHeld]);
  const heatRows = useMemo(() => (vm ? heatmapRows(vm.themes) : []), [vm]);
  const clusters = useMemo(() => (vm && payload ? clusterGroups(vm.themes, payload.clusters) : []), [vm, payload]);
  const log = useMemo(() => changeLog(history.snapshots), [history.snapshots]);
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
                snapshots={history.snapshots} nameOf={nameOf} onPick={pick} region={region} capOf={capOf} />
            )}
          />

          {exposure ? <ExposurePanel model={exposure} nameOf={nameOf} onPick={pick} source={lists.holdingsSource} /> : null}
          <BreadthHeatmap rows={heatRows} nameOf={nameOf} onPick={pick} />
          <ClusterPanel groups={clusters} nameOf={nameOf} onPick={pick} />
          <ChangeLogPanel weeks={log} stored={history.snapshots.length} nameOf={nameOf} onPick={pick} />

          {/* The one chart */}
          <div className="trt-rrg-split" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 420px) 1fr', gap: 12, alignItems: 'start', marginTop: 14 }}>
            <div style={card}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text }}>Rotation map</div>
              <div style={{ fontSize: 10.5, color: T.faint, margin: '2px 0 6px', lineHeight: 1.45 }}>Relative strength (→) against its momentum (↑) with an 8-week tail. Themes travel clockwise. Ringed dots crossed a quadrant this week or carry an early-rotation / breakdown flag. Click a dot to open its evidence.</div>
              <RrgMap themes={vm.themes.map((v) => v.row)} hover={hover} setHover={setHover} onPick={pick} highlight={highlight} />
            </div>
            <div style={{ ...card, fontSize: 11.5, color: T.dim, lineHeight: 1.55 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 4 }}>How to read this page</div>
              <p style={{ margin: '0 0 6px' }}><b>Priority</b> ranks themes by the quality of the evidence. <b>Research first</b> needs at least three genuinely improving layers including earnings or catalysts, or an early-rotation signal. <b>Worth a look</b> needs a real earnings / catalyst improvement, or improving participation (breadth / volume). Price and relative strength alone stay at <b>Monitor</b>. A breakdown drops a theme to <b>Low priority</b>.</p>
              <p style={{ margin: '0 0 6px' }}><b>Verdict</b> (BUY · EARLY BUY · HOLD · WATCH · TRIM · AVOID) is the price call from price and relative strength. Priority and verdict answer different questions; where they disagree the row says so (≠ price verdict) — e.g. "fundamentals improving, price not confirming yet". A short-term break (1M ≤ −7%, or 1W ≤ −4% with 1M ≤ −3%, while below the 20-day line) blocks a BUY; a crowded move is flagged, not turned into a sell. <b>Falling less (defensive)</b> = down less than the benchmark: defence, not strength.</p>
              <p style={{ margin: '0 0 6px' }}><b>Evidence badges</b>: STR strength · BRD breadth · FLW volume flow (a proxy, not fund-flow data) · ERN graded earnings · CAT dated filings / news · VAL valuation (level only) · PRC price. ▲ improving · ● steady · ▼ weakening · ◆ level only (data now, no earlier period to compare — never counted as improving) · ○ no data (never read as negative). Earnings compare the share of a theme's reporters printing strong, this quarter vs last; breadth on fewer than 5 stocks is low confidence.</p>
              <p style={{ margin: 0, color: T.faint }}>
                Data: prices and volume from Yahoo Finance{region === 'india' ? ' and NSE published index closes' : ''}; breadth from each theme's constituent stocks{payload?.coverage?.breadthSkipped ? ` (${payload.coverage.breadthSkipped} themes not reached this build — shown as no data)` : ''}; earnings from {earningsSource === 'graded' ? `the India graded results history (${graded.coverage?.withData ?? '?'} sessions on file${graded.coverage?.oldest ? ` since ${graded.coverage.oldest}` : ''}${graded.coverage?.pending ? `; ${graded.coverage.pending} older sessions still being read — until they are, the quarter before may read as "level only"` : ''})` : `your ${region === 'us' ? 'US' : 'India'} Conviction bench${benchLoaded ? '' : ' (not loaded on this device)'}`}; catalysts from {catalysts.sources.length ? catalysts.sources.join(' and ') : 'no feed this visit'} — last {CATALYST_WINDOW_DAYS} days vs the {CATALYST_WINDOW_DAYS} before (the feed reaches back {Math.round(catalysts.coverageDays)} days); P/E from graded bench rows{region === 'us' ? '; US holdings placed by SEC industry code where no sector is on file' : ''}. Educational, not investment advice.
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
