'use client';
// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION TAB (zzz480) — USA + India in one tab, separated by a toggle.
// Reads /api/market/theme-rotation and renders: a BUY / AVOID + rotation call
// strip, an RRG quadrant map (Leading / Improving / Weakening / Lagging), and a
// multi-timeframe leaderboard. The whole point: always clear what to buy / avoid.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { readConvictionBeats } from '@/lib/conviction-beats';
import { getUsConvictionList, hydrateUsConviction } from '@/lib/conviction-beats-us';
import { classifyTheme } from '@/lib/theme-classify';
import { buildTvExport } from '@/lib/us-tradingview';

type Region = 'us' | 'india';
interface Ret { w1: number; m1: number; m3: number; m6: number; ytd: number; y1: number }
interface ThemeRow {
  id: string; name: string; emoji: string; group: string; note?: string;
  proxy: string | null; members: string[];
  price?: number; dayChangePct?: number;
  ret?: Ret; rsRatio?: number; rsMomentum?: number; quadrant?: string; trail?: { x: number; y: number }[];
  aboveSMA50?: boolean; breadthAbove50?: number | null;
  characterChange?: 'bullish' | 'bearish' | null;
  conviction?: number; rotationVelocity?: number; rotation?: string; action?: string | null;
  verdict?: string; verdictColor?: string; verdictNote?: string;
  // what changed (derived from the weekly RRG trail, no stored history)
  quadrant1w?: string | null; quadrant4w?: string | null;
  quadrantMove?: QuadMove | null; quadrantMove4w?: QuadMove | null;
  rsDelta1w?: number | null; momDelta1w?: number | null;
  fallingLeader?: boolean;
  // risk / extension / damage, and how crowded this theme is with the others
  vol?: number | null; dd1y?: number | null; rangePos?: number | null;
  dist50?: number | null; excess3m?: number | null; riskAdj?: number | null; rsSlope?: number | null;
  cluster?: number | null; clusterLabel?: string | null; clusterSize?: number | null; clusterCorr?: number | null;
  ok?: boolean;
}
interface QuadMove { from: string; to: string; dir: 'upgrade' | 'downgrade' }
interface Payload {
  region: Region; benchmark: { symbol: string; name: string; price: number; changePercent: number };
  benchmarkRet?: Ret | null;
  themes: ThemeRow[]; rotatingIn: string[]; rotatingOut: string[]; topBuy: string[]; topAvoid: string[];
  movedUp?: string[]; movedDown?: string[];
  clusters?: Array<{ id: number; label: string; members: string[] }>;
  asOf: string; source?: string; error?: string;
}

const QC: Record<string, string> = { Leading: '#16A34A', Improving: '#3B82F6', Weakening: '#F97316', Lagging: '#EF4444' };
const BG = '#0B111C', CARD = '#0F1A2A', BORD = 'rgba(255,255,255,0.08)', TXT = '#E6EDF3', DIM = '#7D8DA6', MUT = '#9FB0C8';

// teal(up) → grey(flat) → red(down) ramp, clamped at ±25%
function pctColor(v: number | undefined): string {
  if (v == null || isNaN(v)) return DIM;
  const x = Math.max(-25, Math.min(25, v)) / 25;
  if (x >= 0) { const a = 0.12 + x * 0.55; return `rgba(22,163,74,${a.toFixed(2)})`; }
  const a = 0.12 + (-x) * 0.55; return `rgba(239,68,68,${a.toFixed(2)})`;
}
const fmtPct = (v?: number) => (v == null || isNaN(v) ? '·' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

export default function ThemeRotationTab() {
  const [region, setRegion] = useState<Region>('us');
  const [data, setData] = useState<Record<Region, Payload | null>>({ us: null, india: null });
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<'conv' | 'rs' | 'w1' | 'm1' | 'm3' | 'ytd' | 'y1' | 'risk' | 'vol'>('conv');
  const [hover, setHover] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());   // zzz486 — multi-expand
  const [drill, setDrill] = useState<Record<string, any>>({});
  const [drillLoading, setDrillLoading] = useState<string | null>(null);

  const load = useCallback(async (r: Region, force = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market/theme-rotation?region=${r}${force ? '&refresh=1' : ''}`, { cache: 'no-store' });
      const j = (await res.json()) as Payload;
      setData((prev) => ({ ...prev, [r]: j }));
    } catch { /* keep prior */ } finally { setLoading(false); }
  }, []);

  const loadDrill = useCallback(async (r: Region, themeId: string) => {
    const key = `${r}:${themeId}`;
    setDrill((prev) => { if (prev[key]) return prev; return prev; });
    setDrillLoading(key);
    try {
      const res = await fetch(`/api/market/theme-rotation?region=${r}&theme=${themeId}`, { cache: 'no-store' });
      const j = await res.json();
      setDrill((prev) => ({ ...prev, [key]: j }));
    } catch { /* ignore */ } finally { setDrillLoading(null); }
  }, []);

  const toggleExpand = useCallback((themeId: string) => {
    setExpandedIds((cur) => {
      const nxt = new Set(cur);
      if (nxt.has(themeId)) nxt.delete(themeId);
      else { nxt.add(themeId); if (!drill[`${region}:${themeId}`]) loadDrill(region, themeId); }
      return nxt;
    });
  }, [region, drill, loadDrill]);

  // The US conviction bench lives in IndexedDB (localStorage cannot hold three
  // hundred graded records). Without hydrating it here this page would see only
  // whatever the localStorage mirror still held — a short, arbitrary subset.
  const [benchReady, setBenchReady] = useState(false);
  useEffect(() => { void hydrateUsConviction().finally(() => setBenchReady(true)); }, []);

  useEffect(() => { if (!data[region]) load(region); }, [region, data, load]);
  useEffect(() => { setExpandedIds(new Set()); }, [region]);

  const payload = data[region];
  const themes = payload?.themes?.filter((t) => t.ok) || [];

  // zzz486 — expand / collapse ALL themes at once so every theme's stocks show
  // together. Drills load staggered (120ms apart) so Yahoo isn't hit in one burst.
  const expandAll = useCallback(() => {
    const ids = themes.map((t) => t.id);
    setExpandedIds(new Set(ids));
    ids.forEach((id, i) => { if (!drill[`${region}:${id}`]) setTimeout(() => loadDrill(region, id), i * 120); });
  }, [themes, region, drill, loadDrill]);
  const collapseAll = useCallback(() => setExpandedIds(new Set()), []);
  const byId = useMemo(() => { const m = new Map<string, ThemeRow>(); themes.forEach((t) => m.set(t.id, t)); return m; }, [themes]);


  // zzz484 — read the user's OWN lists (Multibagger fundamental pool + India/USA
  // Technicals + Conviction bench) so drill-down stocks that are on the user's
  // lists get a ★ and their fundo score. Client-side because these live in the
  // browser. Wrapped in try/catch; if nothing's uploaded the drill still works.
  const userLists = useMemo(() => {
    const norm = (s: any) => (s || '').toString().toUpperCase().replace(/\.(NS|BO)$/, '').replace(/^(NSE|BSE):/, '').trim();
    const fundo = new Map<string, { score?: number; grade?: string }>();
    const tech = new Set<string>();
    // Tier AND score, because the bench is the only quality signal available
    // when no Multibagger grade has been uploaded for this region.
    const bench = new Map<string, { tier?: string; score?: number }>();
    const readJSON = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    const frows = readJSON(region === 'us' ? 'mb_usa_scored_v2' : 'mb_excel_scored_v2');
    if (Array.isArray(frows)) for (const r of frows) { const s = norm(r?.symbol); if (s) fundo.set(s, { score: r?.score, grade: r?.grade }); }
    const trows = readJSON(region === 'us' ? 'mb_tech_rows_usa_v1' : 'mb_tech_rows_ind_v1');
    if (Array.isArray(trows)) for (const r of trows) { const s = norm(r?.symbol); if (s) tech.add(s); }
    // ── THE CONVICTION BENCH IS PART OF YOUR BOOK  (zzz616) ───────────────
    //
    // It was read only to put a tier badge on a drill-down stock, and the
    // bench was always the INDIA one whichever region was showing — so a US
    // name that had graded BLOCKBUSTER never carried its tier, and no bench
    // name reached "Your Book by Theme" at all unless it also happened to sit
    // in a Multibagger or Technicals upload. The bench is the list of names the
    // engine itself vouched for; leaving it out of the book was leaving out the
    // best-evidenced part of it.
    try {
      if (region === 'us') {
        for (const e of getUsConvictionList()) {
          const s = norm(e.ticker);
          if (s) bench.set(s, { tier: (e as any).tier, score: (e as any).composite_score });
        }
      } else {
        const cb = readConvictionBeats() as Record<string, any>;
        for (const k in cb) { const s = norm(k); if (s) bench.set(s, { tier: cb[k]?.tier, score: cb[k]?.composite_score ?? cb[k]?.score }); }
      }
    } catch { /* none */ }
    return { fundo, tech, bench, norm };
  }, [region, payload, benchReady]);

  // zzz485 — YOUR BOOK: take every stock across the user's Technicals + Multibagger
  // lists, classify each into a theme by its sector/industry (auto — works for
  // years and for stocks added later), and group them so NONE of the user's names
  // are left uncovered. Client-side (data is in the browser); guarded.
  const userBook = useMemo(() => {
    const norm = userLists.norm;
    // zzz487 — index/benchmark ETFs are not holdings; keep them out of Your Book.
    const EXCLUDE = new Set(['SPY', 'QQQ', 'QQQM', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'SPX', 'NDX', 'RUT', 'NIFTY', 'NIFTYBEES', 'BANKBEES', 'GOLDBEES']);
    const readJSON = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    // Named, so `map.get(s) || { symbol: s }` narrows to one type rather than a
    // union TypeScript then refuses to read fields off.
    type BookEntry = { symbol: string; sector?: string; industry?: string; score?: number; grade?: string; inTech?: boolean; inFundo?: boolean; inBench?: boolean; benchTier?: string; benchScore?: number };
    const map = new Map<string, BookEntry>();
    const entryFor = (sym: string): BookEntry => map.get(sym) || { symbol: sym };
    const trows = readJSON(region === 'us' ? 'mb_tech_rows_usa_v1' : 'mb_tech_rows_ind_v1');
    if (Array.isArray(trows)) for (const r of trows) { const s = norm(r?.symbol); if (!s || EXCLUDE.has(s)) continue; const e = entryFor(s); e.sector = r?.sector || e.sector; e.industry = r?.industry || e.industry; e.inTech = true; map.set(s, e); }
    const frows = readJSON(region === 'us' ? 'mb_usa_scored_v2' : 'mb_excel_scored_v2');
    if (Array.isArray(frows)) for (const r of frows) { const s = norm(r?.symbol); if (!s || EXCLUDE.has(s)) continue; const e = entryFor(s); e.sector = r?.sector || e.sector; e.industry = r?.industry || e.industry; e.score = r?.score; e.grade = r?.grade; e.inFundo = true; map.set(s, e); }
    // ── AND THE CONVICTION BENCH  (zzz616) ────────────────────────────────
    //
    // Names the grading engine itself put on the bench belong in the book as
    // much as anything uploaded by hand — arguably more, since they are there
    // on the evidence of a filing rather than a spreadsheet. They arrive with
    // their own sector, so they classify into a theme exactly like the rest.
    try {
      if (region === 'us') {
        for (const b of getUsConvictionList()) {
          const s = norm(b.ticker); if (!s || EXCLUDE.has(s)) continue;
          const e = entryFor(s);
          e.sector = e.sector || (b as any).sector; e.inBench = true;
          e.benchTier = (b as any).tier; e.benchScore = (b as any).composite_score;
          map.set(s, e);
        }
      } else {
        const cb = readConvictionBeats() as Record<string, any>;
        for (const k in cb) {
          const s = norm(k); if (!s || EXCLUDE.has(s)) continue;
          const e = entryFor(s);
          e.sector = e.sector || cb[k]?.sector || cb[k]?.industry; e.inBench = true;
          e.benchTier = cb[k]?.tier; e.benchScore = cb[k]?.composite_score ?? cb[k]?.score;
          map.set(s, e);
        }
      }
    } catch { /* the uploads alone still build a book */ }
    const all = [...map.values()];
    const groups = new Map<string, typeof all>();
    const other: typeof all = [];
    for (const st of all) { const tid = classifyTheme(st.sector, st.industry, region, st.symbol); if (tid) { if (!groups.has(tid)) groups.set(tid, []); groups.get(tid)!.push(st); } else other.push(st); }
    // zzz487 — anything the classifier can't place still gets shown, grouped by its
    // raw sector (no rotation call, but visible) so NONE of the user's names vanish.
    const sectorGroups = new Map<string, typeof all>();
    for (const st of other) { const sec = (st.sector || st.industry || 'Unclassified').toString().trim() || 'Unclassified'; if (!sectorGroups.has(sec)) sectorGroups.set(sec, []); sectorGroups.get(sec)!.push(st); }
    // Order the names INSIDE every group by Fundo grade — best first (A+ → A → B+
    // → … → D), ungraded last, symbol as the tiebreak. Applied to both the theme
    // groups and the sector-fallback groups, on both the US and India tabs.
    const gradeRank = (g?: string | null) => {
      if (!g) return 99;
      const m = String(g).trim().toUpperCase().match(/^([A-F])\s*([+-]?)/);
      if (!m) return 99;
      const base: Record<string, number> = { A: 0, B: 3, C: 6, D: 9, E: 12, F: 12 };
      const mod = m[2] === '+' ? 0 : m[2] === '-' ? 2 : 1;   // '+' best, plain mid, '-' worst
      return (base[m[1]] ?? 90) + mod;
    };
    const byGrade = (a: { grade?: string; symbol: string }, b: { grade?: string; symbol: string }) =>
      gradeRank(a.grade) - gradeRank(b.grade) || a.symbol.localeCompare(b.symbol);
    for (const arr of groups.values()) arr.sort(byGrade);
    for (const arr of sectorGroups.values()) arr.sort(byGrade);
    const graded = all.filter((x) => x.grade).length;
    const fromBench = all.filter((x) => x.inBench).length;
    return { total: all.length, themed: all.length - other.length, groups, other, sectorGroups, graded, fromBench };
  }, [region, payload, userLists, benchReady]);

  // zzz495 — DUMMY PORTFOLIO. The best 25 of YOUR names, taken ONLY from themes the
  // engine currently rates BUY or EARLY BUY (Leading / genuine early-turn). Nothing
  // from Weakening (TRIM) or Lagging (AVOID) ever enters. Ranked by Fundo grade
  // (A+ → A → B+ … → D, ungraded last), BUY themes ahead of EARLY BUY on ties.
  // Equal-weighted as a simple starter book. Rebuilds live per region.
  const dummyPortfolio = useMemo(() => {
    const gradeRank = (g?: string | null) => {
      if (!g) return 99;
      const m = String(g).trim().toUpperCase().match(/^([A-F])\s*([+-]?)/);
      if (!m) return 99;
      const base: Record<string, number> = { A: 0, B: 3, C: 6, D: 9, E: 12, F: 12 };
      const mod = m[2] === '+' ? 0 : m[2] === '-' ? 2 : 1;
      return (base[m[1]] ?? 90) + mod;
    };
    const BUYABLE = new Set(['BUY', 'EARLY BUY']);
    const picks: { symbol: string; grade?: string; gr: number; tier?: string; escore?: number; themeName: string; themeEmoji: string; verdict: string; verdictColor?: string }[] = [];
    for (const [tid, sts] of userBook.groups.entries()) {
      const th = byId.get(tid);
      if (!th || !th.verdict || !BUYABLE.has(th.verdict)) continue;
      for (const s of sts) picks.push({
        symbol: s.symbol, grade: s.grade,
        // ── A RANK THAT DEGRADES TO SOMETHING, NOT TO NOTHING  (zzz618) ──
        //
        // Ranking was purely by Fundo grade, so with no Multibagger upload
        // every name tied at 99 and the tiebreak — the ticker string — became
        // the ranking. The "best 20" came out alphabetical: ADEA, ADUS, AGM,
        // AMZN. That is worse than useless; it looks ranked.
        //
        // The conviction bench already holds a quality signal for exactly
        // these names: the tier the engine gave their last filing, and its
        // composite score. So an ungraded name falls back to that rather than
        // to the alphabet — BLOCKBUSTER ahead of STRONG, and the engine score
        // separating names inside a tier.
        gr: gradeRank(s.grade) < 99
          ? gradeRank(s.grade)
          : (s.benchTier === 'BLOCKBUSTER' ? 30 : s.benchTier === 'STRONG' ? 40 : 99)
            - Math.min(9, Math.round((s.benchScore ?? 0) / 11)),
        tier: s.benchTier, escore: s.benchScore,
        themeName: th.name, themeEmoji: th.emoji, verdict: th.verdict, verdictColor: th.verdictColor,
      });
    }
    picks.sort((a, b) => a.gr - b.gr || ((a.verdict === 'BUY' ? 0 : 1) - (b.verdict === 'BUY' ? 0 : 1)) || a.symbol.localeCompare(b.symbol));
    // ── CONCENTRATION CAP — MAX 3 NAMES PER THEME ─────────────────────────
    //
    // Ranking 25 names purely by grade is not a portfolio. If your best-graded
    // names happen to cluster in one theme, the "best 25" came out as eleven
    // semiconductor stocks and a tail — one book with one bet in it, and the
    // whole point of a ROTATION-driven list is that it spreads across the
    // themes currently working. Worse, that concentration is invisible: every
    // row looks individually justified.
    //
    // So the list is built in passes. Pass one takes each theme's single best
    // name, pass two the second-best, pass three the third — then stops. Order
    // within a pass is still strictly by Fundo grade, so quality still decides
    // who gets in; the cap only decides how many from one theme can. The result
    // is the best names available under a constraint a human would have applied
    // anyway, and the theme spread is stated above the table so it is checkable.
    const PER_THEME_CAP = 3;
    const byTheme = new Map<string, typeof picks>();
    for (const p of picks) {
      if (!byTheme.has(p.themeName)) byTheme.set(p.themeName, []);
      byTheme.get(p.themeName)!.push(p);
    }
    const top: typeof picks = [];
    for (let pass = 0; pass < PER_THEME_CAP && top.length < 25; pass++) {
      const round = [...byTheme.values()].map((arr) => arr[pass]).filter(Boolean);
      round.sort((a, b) => a.gr - b.gr || ((a.verdict === 'BUY' ? 0 : 1) - (b.verdict === 'BUY' ? 0 : 1)) || a.symbol.localeCompare(b.symbol));
      for (const p of round) { if (top.length >= 25) break; top.push(p); }
    }
    const graded = top.filter((p) => p.grade).length;
    const wt = top.length ? +(100 / top.length).toFixed(1) : 0;
    const themeSpread = new Set(top.map((p) => p.themeName)).size;
    const rankedBy = top.some((p) => p.grade) ? 'your Fundo grade' : 'the tier the engine gave each name on its last filing';
    const excluded = Math.max(0, picks.length - top.length);
    return { top, graded, wt, themeSpread, excluded, cap: PER_THEME_CAP, rankedBy };
  }, [userBook, byId]);

  // ═══ COPY THE BOOK TO TRADINGVIEW, GROUPED BY THE ROTATION CALL  (zzz618)
  //
  // The whole point of this page is the call it puts on each name, and until
  // now that call could only be read here. Exported grouped — ###BUY,
  // ###EARLY BUY, ###TRIM, ###AVOID — the rotation travels with the watchlist,
  // so the same judgement is in front of you on the chart where you act on it.
  //
  // Venues: the US list resolves each ticker against SEC's own listing data
  // (the same endpoint the Conviction Beats export uses, including its NYSE
  // American correction). India needs no lookup — a numeric code is a BSE
  // scrip and everything else is NSE, which is the rule the India tabs
  // already use.
  const [tvBusy, setTvBusy] = useState(false);
  const [tvDone, setTvDone] = useState(false);
  const copyToTradingView = useCallback(async () => {
    setTvBusy(true);
    try {
      const buckets: Record<string, string[]> = { BUY: [], 'EARLY BUY': [], HOLD: [], WATCH: [], TRIM: [], AVOID: [] };
      for (const [tid, sts] of userBook.groups.entries()) {
        const th = byId.get(tid);
        const v = th?.verdict || '';
        if (!buckets[v]) continue;
        for (const st of sts as any[]) buckets[v].push(String(st.symbol).toUpperCase());
      }
      let venues: Record<string, string | null> = {};
      if (region === 'us') {
        const all = Object.values(buckets).flat();
        if (all.length) {
          try {
            const res = await fetch(`/api/v1/us/exchange?tickers=${encodeURIComponent(all.slice(0, 600).join(','))}`, { cache: 'no-store' });
            venues = (await res.json())?.map || {};
          } catch { /* a bare ticker still imports */ }
        }
      }
      const rowsOf = (list: string[]) => list.map((t) => ({
        ticker: t,
        exchange: region === 'us' ? (venues[t] ?? null) : (/^\d+$/.test(t) ? 'BSE' : 'NSE'),
      }));
      const out = buildTvExport(
        (['BUY', 'EARLY BUY', 'HOLD', 'WATCH', 'TRIM', 'AVOID'] as const)
          .filter((k) => buckets[k].length)
          .map((k) => ({ label: `${region === 'us' ? 'US' : 'IN'} ${k}`, rows: rowsOf(buckets[k]) })),
      );
      if (!out.count) return;
      try {
        await navigator.clipboard.writeText(out.text);
        setTvDone(true); setTimeout(() => setTvDone(false), 2500);
      } catch {
        const blob = new Blob([out.text], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `theme-rotation-${region}-tradingview.txt`;
        a.click(); URL.revokeObjectURL(a.href);
      }
    } finally { setTvBusy(false); }
  }, [region, userBook, byId]);

  const regime = useMemo(() => {
    if (!payload || !themes.length) return null;
    const nm = (id: string) => byId.get(id)?.name;
    const buys = (payload.topBuy || []).map(nm).filter(Boolean) as string[];
    const avoids = ((payload.topAvoid && payload.topAvoid.length ? payload.topAvoid : payload.rotatingOut) || []).map(nm).filter(Boolean) as string[];
    const lead = themes.filter((t) => t.quadrant === 'Leading').length;
    const lag = themes.filter((t) => t.quadrant === 'Lagging').length;
    const benchUp = (payload.benchmark?.changePercent ?? 0) >= 0;
    const risk = lead >= lag * 1.3 ? 'risk-on' : lag >= lead * 1.3 ? 'risk-off' : 'mixed';
    return { buys, avoids, lead, lag, benchUp, risk };
  }, [payload, themes, byId]);

  const sorted = useMemo(() => {
    const key = sortKey;
    const val = (r: ThemeRow) =>
      key === 'conv' ? (r.conviction ?? -999)
      : key === 'rs' ? (r.rsRatio || 0) + (r.rsMomentum || 0) - 200
      // Risk-adjusted sorts DESCEND by merit; volatility is a cost, so the
      // least volatile ranks first and the sign is flipped to keep one rule.
      : key === 'risk' ? (r.riskAdj ?? -999)
      : key === 'vol' ? -(r.vol ?? 9999)
      : (r.ret?.[key as 'w1'|'m1'|'m3'|'ytd'|'y1'] ?? -999);
    return [...themes].sort((a, b) => val(b) - val(a));
  }, [themes, sortKey]);

  const chip = (id: string, color: string) => {
    const t = byId.get(id); if (!t) return null;
    return <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 800, color, background: `${color}1a`, border: `1px solid ${color}44`, borderRadius: 20, padding: '3px 10px' }}>{t.emoji} {t.name}</span>;
  };

  return (
    <div style={{ background: BG, borderRadius: 12, padding: 16, color: TXT, minHeight: 400 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 0.3 }}>🔄 Theme Rotation</div>
          <div style={{ fontSize: 11.5, color: DIM, marginTop: 2 }}>Which themes to <b style={{ color: '#22C55E' }}>buy</b> and which to <b style={{ color: '#EF4444' }}>avoid</b> — RS-Ratio × momentum on live prices. {payload?.benchmark && <>Benchmark <b style={{ color: MUT }}>{payload.benchmark.name}</b>.</>}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: CARD, border: `1px solid ${BORD}`, borderRadius: 8, overflow: 'hidden' }}>
            {(['us', 'india'] as Region[]).map((r) => (
              <button key={r} onClick={() => setRegion(r)} style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', background: region === r ? '#1E40AF' : 'transparent', color: region === r ? '#fff' : MUT, fontSize: 13, fontWeight: 800 }}>{r === 'us' ? '🇺🇸 USA' : '🇮🇳 India'}</button>
            ))}
          </div>
          <button onClick={copyToTradingView} disabled={tvBusy || !userBook.total}
            title="Copy your book to TradingView, grouped by the rotation call — ###BUY, ###EARLY BUY, ###TRIM, ###AVOID — so the judgement travels with the watchlist."
            style={{ fontSize: 11, fontWeight: 800, padding: '6px 11px', borderRadius: 7, cursor: tvBusy ? 'wait' : 'pointer', border: `1px solid ${tvDone ? '#10B981' : 'rgba(96,165,250,0.45)'}`, background: 'transparent', color: tvDone ? '#10B981' : '#60A5FA' }}>
            {tvBusy ? '⏳' : tvDone ? '✓ Copied' : '📋 Copy → TradingView'}
          </button>
          <button onClick={() => load(region, true)} disabled={loading} title="Recompute from live prices (bypasses the 30-min cache)" style={{ fontSize: 11, fontWeight: 800, padding: '6px 11px', borderRadius: 7, cursor: loading ? 'wait' : 'pointer', border: '1px solid rgba(34,197,94,0.4)', background: 'transparent', color: '#22C55E' }}>{loading ? '⏳' : '↻ Refresh'}</button>
        </div>
      </div>

      {loading && !payload && <div style={{ color: DIM, fontSize: 13, padding: 30, textAlign: 'center' }}>Scoring themes on live prices…</div>}
      {payload?.error && <div style={{ color: '#EF4444', fontSize: 12.5, padding: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8 }}>Couldn’t load live data: {payload.error}. Try ↻ Refresh.</div>}

      {payload && !payload.error && themes.length > 0 && (
        <>
          {/* TODAY'S CALL — the punchy one-line regime summary */}
          {regime && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: regime.risk === 'risk-on' ? 'rgba(22,163,74,0.09)' : regime.risk === 'risk-off' ? 'rgba(239,68,68,0.09)' : 'rgba(148,163,184,0.09)', border: `1px solid ${regime.risk === 'risk-on' ? 'rgba(22,163,74,0.35)' : regime.risk === 'risk-off' ? 'rgba(239,68,68,0.35)' : 'rgba(148,163,184,0.3)'}`, borderRadius: 10, padding: '10px 13px', marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, fontWeight: 900, color: regime.risk === 'risk-on' ? '#22C55E' : regime.risk === 'risk-off' ? '#F87171' : '#CBD5E1', whiteSpace: 'nowrap' }}>📣 Today’s call · {regime.risk === 'risk-on' ? 'RISK-ON' : regime.risk === 'risk-off' ? 'RISK-OFF' : 'MIXED'}</span>
              <span style={{ fontSize: 12, color: MUT }}>
                {regime.buys.length ? <>Buy <b style={{ color: '#22C55E' }}>{regime.buys.slice(0, 3).join(', ')}</b>. </> : 'No clear leaders — stay patient. '}
                {regime.avoids.length ? <>Avoid <b style={{ color: '#EF4444' }}>{regime.avoids.slice(0, 3).join(', ')}</b>.</> : null}
                <span style={{ color: DIM }}> · {regime.lead} leading / {regime.lag} lagging</span>
              </span>
            </div>
          )}

          {/* BUY / AVOID / ROTATION call strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'rgba(22,163,74,0.07)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: 10, padding: '11px 13px' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#22C55E', letterSpacing: 0.5, marginBottom: 7 }}>🟢 BUY — strongest themes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{payload.topBuy.length ? payload.topBuy.map((id) => chip(id, '#16A34A')) : <span style={{ color: DIM, fontSize: 12 }}>none leading right now</span>}</div>
            </div>
            <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, padding: '11px 13px' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#60A5FA', letterSpacing: 0.5, marginBottom: 7 }}>🔵 ROTATING IN — early</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{payload.rotatingIn.length ? payload.rotatingIn.map((id) => chip(id, '#3B82F6')) : <span style={{ color: DIM, fontSize: 11 }}>none confirmed yet — no weak theme has reclaimed its 50-DMA</span>}</div>
            </div>
            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '11px 13px' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#F87171', letterSpacing: 0.5, marginBottom: 7 }}>🔴 AVOID / ROTATING OUT</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{(payload.topAvoid.length ? payload.topAvoid : payload.rotatingOut).length ? (payload.topAvoid.length ? payload.topAvoid : payload.rotatingOut).map((id) => chip(id, '#EF4444')) : <span style={{ color: DIM, fontSize: 12 }}>—</span>}</div>
            </div>
          </div>

          {/* character-change alerts (the "suddenly buyable / just rolled over" moments) */}
          {themes.some((t) => t.characterChange) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {themes.filter((t) => t.characterChange).map((t) => (
                <span key={t.id} style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: '4px 9px', color: t.characterChange === 'bullish' ? '#22C55E' : '#EF4444', background: t.characterChange === 'bullish' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${t.characterChange === 'bullish' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}` }}>
                  {t.characterChange === 'bullish' ? '⚡ Character change ↑' : '⚠️ Character change ↓'} — {t.emoji} {t.name}: {t.characterChange === 'bullish' ? 'momentum crossed up + reclaimed 50-DMA' : 'momentum rolled over + lost 50-DMA'}
                </span>
              ))}
            </div>
          )}

          {/* ═══ WHAT CHANGED THIS WEEK — the only genuinely new information ═══
              A board that shows where every theme SITS is a snapshot; a rotation
              tracker has to show where they MOVED. "Leading" reads identically
              whether a theme has led for a year or crossed the line on Friday,
              and those two mean opposite things for sizing. Derived from the
              weekly RRG trail, so it needs no stored history and survives a
              cache wipe. This is the first thing worth reading on the page. */}
          {(() => {
            const ups = themes.filter((t) => t.quadrantMove?.dir === 'upgrade');
            const downs = themes.filter((t) => t.quadrantMove?.dir === 'downgrade');
            const line = (t: ThemeRow) => (
              <button key={t.id} onClick={() => toggleExpand(t.id)}
                title={`${t.name}: ${t.quadrant1w} → ${t.quadrant} · RS-momentum ${(t.momDelta1w ?? 0) > 0 ? '+' : ''}${(t.momDelta1w ?? 0).toFixed(1)} this week · click for stocks`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', textAlign: 'left',
                  fontSize: 11.5, fontWeight: 700, color: TXT, borderRadius: 7, padding: '4px 9px',
                  background: t.quadrantMove!.dir === 'upgrade' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
                  border: `1px solid ${t.quadrantMove!.dir === 'upgrade' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
                }}>
                <span>{t.emoji} {t.name}</span>
                <span style={{ color: DIM, fontWeight: 600, fontSize: 10 }}>
                  {t.quadrant1w} <span style={{ color: t.quadrantMove!.dir === 'upgrade' ? '#22C55E' : '#EF4444' }}>→</span> {t.quadrant}
                </span>
              </button>
            );
            return (
              <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 10, padding: '11px 13px', marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 900, color: TXT, marginBottom: 2 }}>🔀 What changed this week</div>
                <div style={{ fontSize: 10.5, color: DIM, marginBottom: ups.length || downs.length ? 9 : 0, lineHeight: 1.5 }}>
                  Themes that crossed a quadrant line since last Friday — where the rotation actually moved, as opposed to where it already was. A theme that has just turned is a different trade from one that turned six months ago.
                </div>
                {!ups.length && !downs.length ? (
                  <div style={{ fontSize: 11.5, color: MUT, marginTop: 8 }}>No theme changed quadrant this week — the rotation is stable. Nothing new to act on; the board below still holds.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ups.length > 0 && (
                      <div>
                        <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: 0.5, color: '#22C55E', marginBottom: 5 }}>▲ STRENGTHENED — {ups.length}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{ups.map(line)}</div>
                      </div>
                    )}
                    {downs.length > 0 && (
                      <div>
                        <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: 0.5, color: '#F87171', marginBottom: 5 }}>▼ DETERIORATED — {downs.length}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{downs.map(line)}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ═══ RELATIVE STRENGTH IS NOT A RISING PRICE ═══
              Every RS number on this page is measured against the benchmark, so
              a theme can sit in Leading while its own price falls — it is simply
              falling less. That is a defensive rotation, not a buy, and reading
              the board without the distinction is the easiest way to buy a
              downtrend. Named here once, and badged per row below. */}
          {(() => {
            const falling = themes.filter((t) => t.fallingLeader && (t.verdict === 'BUY' || t.verdict === 'EARLY BUY' || t.quadrant === 'Leading'));
            const b3 = payload.benchmarkRet?.m3;
            if (!falling.length && b3 == null) return null;
            return (
              <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '9px 13px', marginBottom: 14, fontSize: 11.5, color: MUT, lineHeight: 1.55 }}>
                <b style={{ color: '#F59E0B' }}>⚖️ Relative vs absolute.</b>{' '}
                {b3 != null && <>The benchmark ({payload.benchmark.name}) is <b style={{ color: b3 >= 0 ? '#22C55E' : '#F87171' }}>{fmtPct(b3)}</b> over 3 months — every RS number below is measured against that. </>}
                {falling.length > 0 && (
                  <>
                    <b style={{ color: TXT }}>{falling.length} theme{falling.length > 1 ? 's are' : ' is'} leading on relative strength while its own price is still down over 3 months</b>
                    {' '}({falling.slice(0, 4).map((t) => t.name).join(', ')}{falling.length > 4 ? `, +${falling.length - 4}` : ''}) — outperforming a falling market is defence, not a buy signal. Marked <span style={{ color: '#F59E0B', fontWeight: 800 }}>↓abs</span> in the table.
                  </>
                )}
              </div>
            );
          })()}

          {/* CLEAR rotation board — the RRG map beside the 2×2 you read at a glance */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: 12, alignItems: 'start', marginBottom: 14 }} className="mc-rrg-split">
            <div style={{ background: CARD, border: `1px solid ${BORD}`, borderRadius: 10, padding: '10px 11px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: TXT, marginBottom: 1 }}>🎯 Rotation map</div>
              <div style={{ fontSize: 9.5, color: DIM, marginBottom: 6, lineHeight: 1.45 }}>
                Each theme plotted on relative strength (→) against its own momentum (↑), with an eight-week tail: the tail shows the path it took to get there, which is the part a list of quadrant labels cannot show. Themes travel clockwise. Hover a dot to name it; click to open its stocks.
              </div>
              <RRG themes={themes} hover={hover} setHover={setHover} onPick={(id) => toggleExpand(id)} />
            </div>
            <QuadrantBoard themes={themes} onPick={(id) => toggleExpand(id)} expandedIds={expandedIds} />
          </div>
          <style>{`@media (max-width: 860px){ .mc-rrg-split{ grid-template-columns: 1fr !important; } }`}</style>

          {/* YOUR BOOK — every stock on your lists, mapped to a theme. Sits BELOW the
              rotation board (below Leading/Improving/Lagging) per the user's ask.
              Nothing hidden: themed stocks show the theme's call; the rest are
              grouped by their sector. */}
          {userBook.total > 0 && (
            <div style={{ margin: '14px 0', background: CARD, border: `1px solid ${BORD}`, borderRadius: 10, padding: 13 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: TXT, marginBottom: 2 }}>📋 Your Book by Theme</div>
              <div style={{ fontSize: 10.5, color: DIM, marginBottom: 10, lineHeight: 1.55 }}>
                Every stock on your Technicals / Multibagger lists <b style={{ color: MUT }}>and on the {region === 'us' ? 'US' : 'India'} Conviction Beats bench</b>, auto-sorted into its theme by sector so you see the rotation call for each.{' '}
                <b style={{ color: MUT }}>{userBook.total}</b> names · <b style={{ color: MUT }}>{userBook.themed}</b> in a rotation theme{userBook.fromBench ? <> · <b style={{ color: MUT }}>{userBook.fromBench}</b> from the graded bench</> : null}{userBook.sectorGroups.size ? <> · <b style={{ color: MUT }}>{userBook.other.length}</b> grouped by sector below</> : null}.
                {/* A GRADE COLUMN THAT IS EMPTY MUST SAY WHY. "0 graded" beside a
                    full book reads as a broken page; it actually means the
                    Multibagger upload for this region is missing, which is a
                    thing the reader can fix in ten seconds if they are told. */}
                {userBook.graded === 0
                  ? <> <b style={{ color: '#F59E0B' }}>No Fundo grades are loaded for {region === 'us' ? 'USA' : 'India'}</b> — upload the {region === 'us' ? 'USA Multibagger' : 'India Multibagger'} sheet and every name here gains its grade, and the starter book below can rank by it.</>
                  : <> Grade = your Fundo (<b style={{ color: MUT }}>{userBook.graded}</b> of {userBook.total} graded).</>}
              </div>
              {/* ── A MOSAIC, NOT A UNIFORM GRID ─────────────────────────────
                  Forty-two Software names and one Gaming name were given
                  identical 250px boxes, so the big group wrapped into a tall
                  column of chips while the small one left most of its box
                  empty — half the panel was whitespace and the eye had to
                  travel much further than the information warranted.
                  Each card now claims columns in proportion to how many of
                  your names it holds, and `dense` packing backfills the gaps
                  the wide cards leave, so the panel fills itself. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gridAutoFlow: 'dense', gap: 9, alignItems: 'start' }}>
                {[...userBook.groups.entries()]
                  .map(([tid, sts]) => ({ tid, sts, th: byId.get(tid) }))
                  .sort((a, b) => { const rk = (v?: string) => v === 'BUY' ? 0 : v === 'EARLY BUY' ? 1 : v === 'HOLD' || v === 'WATCH' ? 2 : v === 'TRIM' ? 3 : v === 'AVOID' ? 4 : 5; return rk(a.th?.verdict) - rk(b.th?.verdict) || b.sts.length - a.sts.length; })
                  .map(({ tid, sts, th }) => (
                    <div key={tid} style={{
                      // Span follows population: a group holding a quarter of
                      // your book should look like it does.
                      gridColumn: `span ${sts.length >= 26 ? 3 : sts.length >= 10 ? 2 : 1}`,
                      border: `1px solid ${(th?.verdictColor || '#64748B')}44`, borderRadius: 8, padding: '8px 10px', background: BG,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                        <button onClick={() => th && toggleExpand(tid)} style={{ background: 'transparent', border: 'none', color: TXT, fontWeight: 800, fontSize: 12, cursor: th ? 'pointer' : 'default', padding: 0, textAlign: 'left' }}>{th ? `${th.emoji} ${th.name}` : tid} <span style={{ color: DIM, fontWeight: 600 }}>· {sts.length}</span></button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          {th?.action === 'ADD' && <span title="Rotating into strength — add 25%" style={{ fontSize: 8.5, fontWeight: 900, color: '#22C55E', background: 'rgba(34,197,94,0.16)', border: '1px solid rgba(34,197,94,0.45)', borderRadius: 5, padding: '2px 5px' }}>➕ ADD 25%</span>}
                          {th?.action === 'TRIM' && <span title="Rolling over — trim 25%" style={{ fontSize: 8.5, fontWeight: 900, color: '#EF4444', background: 'rgba(239,68,68,0.16)', border: '1px solid rgba(239,68,68,0.45)', borderRadius: 5, padding: '2px 5px' }}>✂️ TRIM 25%</span>}
                          {th?.verdict ? <span style={{ fontSize: 9, fontWeight: 900, color: th.verdictColor, background: `${th.verdictColor}1a`, border: `1px solid ${th.verdictColor}55`, borderRadius: 5, padding: '2px 6px' }}>{th.verdict}</span> : null}
                        </div>
                      </div>
                      {/* The star on every chip was decoration: inside "Your
                          Book" every name is yours, so it said nothing and
                          cost a character of width on each of 236 chips. The
                          grade is what actually varies, so it is what shows. */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {sts.map((s) => {
                          // ── COLOUR SAYS WHERE THE NAME CAME FROM  (zzz618) ──
                          //
                          // Every chip looked the same, so a name the grading
                          // engine put on the bench off an actual filing was
                          // indistinguishable from one typed into a spreadsheet.
                          // Those are different kinds of evidence and the book is
                          // now mostly the former, so the distinction has to be
                          // visible without hovering: red for a BLOCKBUSTER
                          // print, green for STRONG, amber for your own upload.
                          const t = String(s.benchTier || '').toUpperCase();
                          const col = t === 'BLOCKBUSTER' ? '#F87171' : t === 'STRONG' ? '#34D399' : '#F59E0B';
                          const bgc = t === 'BLOCKBUSTER' ? 'rgba(248,113,113,0.14)' : t === 'STRONG' ? 'rgba(52,211,153,0.13)' : 'rgba(245,158,11,0.12)';
                          return (
                            <span key={s.symbol}
                              title={`${s.symbol}${s.sector ? ` · ${s.sector}` : ''}${s.grade ? ` · Fundo ${s.grade}` : ''}${t ? ` · graded ${t} on its last filing${s.benchScore != null ? ` (engine ${s.benchScore})` : ''}` : ' · from your own list'}`}
                              style={{ fontSize: 10.5, fontWeight: 700, color: col, background: bgc, borderRadius: 4, padding: '1px 5px', lineHeight: 1.5, border: t ? `1px solid ${col}44` : '1px solid transparent' }}>
                              {s.symbol}{s.grade ? <span style={{ color: DIM, fontWeight: 600 }}> {s.grade}</span> : null}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                {/* sector-fallback groups — visible even without a rotation theme */}
                {[...userBook.sectorGroups.entries()].sort((a, b) => b[1].length - a[1].length).map(([sec, sts]) => (
                  <div key={`sec:${sec}`} style={{ gridColumn: `span ${sts.length >= 26 ? 3 : sts.length >= 10 ? 2 : 1}`, border: `1px dashed ${BORD}`, borderRadius: 8, padding: '8px 10px', background: BG }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                      <span style={{ color: MUT, fontWeight: 800, fontSize: 11.5 }}>{sec} <span style={{ color: DIM, fontWeight: 600 }}>· {sts.length}</span></span>
                      <span style={{ fontSize: 8.5, color: DIM }}>no theme call</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {sts.map((s) => (
                        <span key={s.symbol} title={`${s.symbol}${s.sector ? ` · ${s.sector}` : ''}${s.grade ? ` · Grade ${s.grade}` : ''}`} style={{ fontSize: 10.5, fontWeight: 700, color: MUT, background: 'rgba(148,163,184,0.12)', borderRadius: 4, padding: '1px 5px', lineHeight: 1.5 }}>{s.symbol}{s.grade ? <span style={{ color: DIM, fontWeight: 600 }}> {s.grade}</span> : null}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* leaderboard */}
            <div style={{ flex: '1 1 100%', minWidth: 320, overflowX: 'auto', marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, color: DIM }}>{themes.length} themes{expandedIds.size ? ` · ${expandedIds.size} expanded` : ''} · click a row to see its stocks</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={expandAll} style={{ fontSize: 11, fontWeight: 800, padding: '5px 11px', borderRadius: 7, cursor: 'pointer', border: '1px solid rgba(59,130,246,0.45)', background: 'transparent', color: '#60A5FA' }}>⤢ Expand all</button>
                  <button onClick={collapseAll} disabled={!expandedIds.size} style={{ fontSize: 11, fontWeight: 800, padding: '5px 11px', borderRadius: 7, cursor: expandedIds.size ? 'pointer' : 'default', border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: expandedIds.size ? MUT : DIM }}>⤡ Collapse all</button>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: DIM, textAlign: 'right' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Theme</th>
                    <th style={{ padding: '6px 6px', fontWeight: 700, textAlign: 'center' }}>Verdict</th>
                    {([['w1', '1W'], ['m1', '1M'], ['m3', '3M'], ['ytd', 'YTD'], ['y1', '1Y']] as const).map(([k, lbl]) => (
                      <th key={k} onClick={() => setSortKey(k as any)} style={{ padding: '6px 6px', fontWeight: sortKey === k ? 900 : 700, color: sortKey === k ? TXT : DIM, cursor: 'pointer' }}>{lbl}{sortKey === k ? ' ▾' : ''}</th>
                    ))}
                    <th onClick={() => setSortKey('rs')} style={{ padding: '6px 8px', fontWeight: sortKey === 'rs' ? 900 : 700, color: sortKey === 'rs' ? TXT : DIM, cursor: 'pointer' }}>RS{sortKey === 'rs' ? ' ▾' : ''}</th>
                    <th onClick={() => setSortKey('vol')} title="Annualised volatility of the theme over the last three months. A cost, not a virtue — sorting puts the calmest first." style={{ padding: '6px 6px', fontWeight: sortKey === 'vol' ? 900 : 700, color: sortKey === 'vol' ? TXT : DIM, cursor: 'pointer' }}>Vol{sortKey === 'vol' ? ' ▾' : ''}</th>
                    <th onClick={() => setSortKey('risk')} title="Excess return over the benchmark per unit of risk (3M excess, annualised, ÷ annualised volatility). How a desk ranks a rotation: beating the market by 9 points with 14% vol is a better use of capital than beating it by 15 with 50%." style={{ padding: '6px 6px', fontWeight: sortKey === 'risk' ? 900 : 700, color: sortKey === 'risk' ? TXT : DIM, cursor: 'pointer' }}>R/Risk{sortKey === 'risk' ? ' ▾' : ''}</th>
                    <th onClick={() => setSortKey('conv')} title="Conviction score 0-100 — RS × momentum × 50-DMA trend × breadth" style={{ padding: '6px 8px', fontWeight: sortKey === 'conv' ? 900 : 700, color: sortKey === 'conv' ? TXT : DIM, cursor: 'pointer' }}>Conv{sortKey === 'conv' ? ' ▾' : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => {
                    const isOpen = expandedIds.has(t.id);
                    const dkey = `${region}:${t.id}`;
                    const dd = drill[dkey];
                    const dLoading = drillLoading === dkey;
                    return (
                    <React.Fragment key={t.id}>
                    <tr onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)} onClick={() => toggleExpand(t.id)}
                      style={{ borderTop: `1px solid ${BORD}`, background: isOpen ? 'rgba(59,130,246,0.06)' : hover === t.id ? 'rgba(255,255,255,0.03)' : 'transparent', cursor: 'pointer' }}>
                      <td style={{ padding: '7px 8px', textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ color: DIM, fontSize: 9, width: 8, flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
                          <span style={{ width: 8, height: 8, borderRadius: 8, background: QC[t.quadrant || 'Lagging'], flexShrink: 0 }} />
                          <div>
                            <div style={{ fontWeight: 800, color: TXT }}>{t.emoji} {t.name}
                              {t.action === 'ADD' && <span title="Rotating into strength — add" style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 900, color: '#22C55E', background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 4, padding: '1px 5px' }}>➕ ADD</span>}
                              {t.action === 'TRIM' && <span title="Rolling over — trim" style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 900, color: '#EF4444', background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4, padding: '1px 5px' }}>✂️ TRIM</span>}
                              {/* Outperforming a falling market is defence, not a buy. The
                                  RS columns cannot show this — they are relative by
                                  construction — so it is said in words on the row itself. */}
                              {t.fallingLeader && <span title="Leading on relative strength, but its own price is still down over 3 months — it is falling less than the market, not rising" style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 900, color: '#F59E0B', background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 4, padding: '1px 5px' }}>↓abs</span>}
                              {t.quadrantMove && <span title={`Crossed ${t.quadrantMove.from} → ${t.quadrantMove.to} this week`} style={{ marginLeft: 6, fontSize: 8.5, fontWeight: 900, color: t.quadrantMove.dir === 'upgrade' ? '#22C55E' : '#EF4444', background: t.quadrantMove.dir === 'upgrade' ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)', border: `1px solid ${t.quadrantMove.dir === 'upgrade' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`, borderRadius: 4, padding: '1px 5px' }}>{t.quadrantMove.dir === 'upgrade' ? '▲' : '▼'} NEW</span>}
                            </div>
                            <div style={{ fontSize: 9.5, color: DIM }}>{t.quadrant}{t.quadrantMove ? <span style={{ color: MUT }}> (was {t.quadrantMove.from})</span> : t.quadrant4w && t.quadrant4w !== t.quadrant ? <span style={{ color: MUT }}> (was {t.quadrant4w} a month ago)</span> : ''}{t.aboveSMA50 ? ' · >50DMA' : ' · <50DMA'}{t.breadthAbove50 != null ? ` · ${t.breadthAbove50}% brdth` : ''}{t.proxy ? ` · ${t.proxy}` : ' · basket'}{t.rotation === 'fast' ? ' · ⚡ fast rotator' : t.rotation === 'steady' ? ' · 🐢 steady' : ''}
                              {/* WHERE IN THE MOVE YOU ARE. "Above the 50-DMA"
                                  is a yes/no; 22% above it is a different entry
                                  from 1% above, and a theme can lead on relative
                                  strength while sitting a third below its own high. */}
                              {t.dist50 != null && <span title="Distance from the 50-day average"> · {t.dist50 > 0 ? '+' : ''}{t.dist50.toFixed(0)}% vs 50DMA</span>}
                              {t.dd1y != null && t.dd1y <= -5 && <span title="Below its own 1-year high" style={{ color: t.dd1y <= -25 ? '#F87171' : undefined }}> · {t.dd1y.toFixed(0)}% from high</span>}
                              {t.rangePos != null && <span title="Position in the 1-year range"> · 52w {t.rangePos}%</span>}
                              {t.clusterSize != null && t.clusterSize > 1 && t.clusterLabel && t.clusterLabel !== t.name &&
                                <span title={`Moves with ${t.clusterLabel} and ${t.clusterSize - 1} other theme(s) — correlation ${t.clusterCorr ?? '?'}. Owning both is closer to one position than two.`} style={{ color: '#C084FC' }}> · ⧉ moves with {t.clusterLabel}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '7px 6px', textAlign: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, color: t.verdictColor, background: `${t.verdictColor}1a`, border: `1px solid ${t.verdictColor}55`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }} title={t.verdictNote}>{t.verdict}</span>
                      </td>
                      {(['w1', 'm1', 'm3', 'ytd', 'y1'] as const).map((k) => (
                        <td key={k} style={{ padding: '7px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: TXT, background: pctColor(t.ret?.[k]), borderRadius: 4 }}>{fmtPct(t.ret?.[k])}</td>
                      ))}
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: MUT }}
                        title={t.momDelta1w != null ? `RS-momentum ${t.momDelta1w > 0 ? '+' : ''}${t.momDelta1w.toFixed(1)} over the past week — the rate of change, not the level` : undefined}>
                        {t.rsRatio?.toFixed(0)}<span style={{ color: (t.rsMomentum || 100) >= 100 ? '#22C55E' : '#EF4444', marginLeft: 4 }}>{(t.rsMomentum || 100) >= 100 ? '↑' : '↓'}</span>
                        {/* The level says where it is; the weekly delta says whether it is
                            still getting there. A Leading theme with a negative delta is
                            already on its way out and the level alone will not show it. */}
                        {t.momDelta1w != null && Math.abs(t.momDelta1w) >= 0.2 && (
                          <div style={{ fontSize: 8.5, color: t.momDelta1w > 0 ? '#22C55E' : '#EF4444' }}>{t.momDelta1w > 0 ? '+' : ''}{t.momDelta1w.toFixed(1)}/wk</div>
                        )}
                      </td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontSize: 11, color: t.vol == null ? DIM : t.vol >= 40 ? '#F87171' : t.vol >= 25 ? '#EAB308' : MUT }}
                        title={t.vol != null ? `${t.vol}% annualised volatility` : undefined}>
                        {t.vol != null ? `${t.vol.toFixed(0)}%` : '·'}
                      </td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', fontSize: 11 }}
                        title={t.excess3m != null ? `${t.excess3m > 0 ? '+' : ''}${t.excess3m.toFixed(1)}pp vs benchmark over 3M, per unit of risk` : undefined}>
                        {t.riskAdj != null
                          ? <b style={{ color: t.riskAdj >= 0.5 ? '#22C55E' : t.riskAdj >= 0 ? MUT : '#EF4444' }}>{t.riskAdj > 0 ? '+' : ''}{t.riskAdj.toFixed(2)}</b>
                          : <span style={{ color: DIM }}>·</span>}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace' }}>
                        {typeof t.conviction === 'number'
                          ? <span style={{ fontWeight: 800, color: t.conviction >= 66 ? '#22C55E' : t.conviction >= 45 ? '#EAB308' : '#EF4444' }}>{t.conviction}</span>
                          : <span style={{ color: DIM }}>·</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={11} style={{ padding: '2px 8px 12px 24px', background: 'rgba(59,130,246,0.04)' }}>
                          {dLoading && <div style={{ color: DIM, fontSize: 11, padding: 8 }}>Loading {t.name} leaders…</div>}
                          {!dLoading && dd?.note && <div style={{ color: DIM, fontSize: 11, padding: 8 }}>{dd.note}</div>}
                          {!dLoading && dd?.stocks && dd.stocks.length > 0 && (
                            <div>
                              <div style={{ fontSize: 10, color: DIM, margin: '4px 0 6px' }}>Buyable leaders in {t.emoji} {t.name} — sorted by relative strength (3M). <b style={{ color: '#22C55E' }}>✓</b> = above 50-DMA and outperforming. <b style={{ color: '#F59E0B' }}>★</b> = on your Multibagger / Technicals list (shows your <b>Fundo</b> grade; <b>FT</b> = combined Fundo-Techno).</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                                {dd.stocks.map((s: any) => {
                                  const nsym = userLists.norm(s.sym);
                                  const f = userLists.fundo.get(nsym);
                                  const inTech = userLists.tech.has(nsym);
                                  const benchHit = userLists.bench.get(nsym);
                                  const tier = benchHit?.tier;
                                  const inList = !!f || inTech || !!benchHit;
                                  const fundoScore = f?.score;
                                  const ft = (typeof s.techno === 'number' && typeof fundoScore === 'number') ? Math.round((s.techno + fundoScore) / 2) : null;
                                  const scoreCol = (v: number) => v >= 70 ? '#22C55E' : v >= 50 ? '#EAB308' : '#EF4444';
                                  const bord = s.buyReady ? 'rgba(34,197,94,0.5)' : inList ? 'rgba(245,158,11,0.5)' : BORD;
                                  return (
                                  <div key={s.sym} style={{ minWidth: 156, flex: '0 0 auto', background: CARD, border: `1px solid ${bord}`, borderRadius: 8, padding: '7px 9px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                      <span style={{ fontWeight: 900, color: TXT, fontSize: 12 }}>{inList && <span style={{ color: '#F59E0B' }} title="on your list">★ </span>}{s.sym}</span>
                                      <span style={{ fontSize: 9, fontWeight: 800, color: s.buyReady ? '#22C55E' : s.aboveSMA50 ? '#EAB308' : '#EF4444' }}>{s.buyReady ? '✓ buy-ready' : s.aboveSMA50 ? '~ watch' : '✕ weak'}</span>
                                    </div>
                                    <div style={{ fontSize: 9.5, marginTop: 4, fontFamily: 'ui-monospace,monospace', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <span style={{ color: DIM }}>Techno <b style={{ color: scoreCol(s.techno ?? 0) }}>{s.techno ?? '·'}</b></span>
                                      {f ? <span style={{ color: DIM }}>Fundo <b style={{ color: f.grade ? (String(f.grade).startsWith('A') ? '#22C55E' : String(f.grade).startsWith('B') ? '#EAB308' : '#EF4444') : DIM }}>{f.grade || '·'}{typeof fundoScore === 'number' ? `(${fundoScore})` : ''}</b></span> : null}
                                      {ft != null ? <span style={{ color: DIM }}>FT <b style={{ color: scoreCol(ft) }}>{ft}</b></span> : null}
                                    </div>
                                    <div style={{ fontSize: 9, color: DIM, marginTop: 3, fontFamily: 'ui-monospace,monospace' }}>
                                      3M <span style={{ color: (s.m3 ?? 0) >= 0 ? '#22C55E' : '#EF4444' }}>{fmtPct(s.m3)}</span> · RS <span style={{ color: (s.rs3m ?? 0) >= 0 ? '#22C55E' : '#EF4444' }}>{s.rs3m > 0 ? '+' : ''}{s.rs3m}</span>{tier ? <span style={{ color: '#F59E0B' }}> · {tier === 'BLOCKBUSTER' ? 'BB' : tier}</span> : null}{inTech ? <span style={{ color: '#60A5FA' }}> · in tech</span> : null}
                                    </div>
                                  </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {!dLoading && dd?.stocks && dd.stocks.length === 0 && !dd?.note && <div style={{ color: DIM, fontSize: 11, padding: 8 }}>No constituent data available.</div>}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>


          {/* ═══ zzz514 — YOUR EXPOSURE vs THE ROTATION CALL ═══ */}
          {(() => {
            const tById = new Map<string, any>((payload.themes || []).map((t: any) => [t.id, t]));
            const rows: { theme: any; names: string[] }[] = [];
            for (const [tid, names] of userBook.groups) { const t = tById.get(tid); if (t) rows.push({ theme: t, names: (names as any[]).map((n) => n.symbol) }); }
            const LEAD = new Set(['BUY', 'EARLY BUY']);
            const FADE = new Set(['TRIM', 'AVOID']);
            const leading = rows.filter((r) => LEAD.has(r.theme.verdict)).sort((a, b) => b.names.length - a.names.length);
            const fading = rows.filter((r) => FADE.has(r.theme.verdict)).sort((a, b) => b.names.length - a.names.length);
            const nLead = leading.reduce((a, r) => a + r.names.length, 0);
            const nFade = fading.reduce((a, r) => a + r.names.length, 0);
            const nTot = rows.reduce((a, r) => a + r.names.length, 0);
            if (nTot === 0) return null;
            const tiltGood = nLead >= nFade;
            return (
              <div style={{ marginTop: 18, background: CARD, border: `1px solid ${BORD}`, borderRadius: 12, padding: 15 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: TXT, marginBottom: 3 }}>🧭 Your exposure vs the rotation call</div>
                <div style={{ fontSize: 10.5, color: DIM, marginBottom: 11, lineHeight: 1.5 }}>
                  Where your book actually sits against today's rotation. <b style={{ color: '#22C55E' }}>{nLead}</b> of your {nTot} themed names are in leading / early-buy themes; <b style={{ color: '#EF4444' }}>{nFade}</b> sit in fading themes (trim / avoid). {tiltGood ? 'Your tilt is with the rotation.' : 'You are heavy in themes rolling over — review the trim list.'}
                </div>
                {leading.length > 0 && (
                  <div>
                    {/* ── THE BUY SIDE, AT THE SAME WEIGHT  (zzz616) ─────────
                        The trim side named every stock; this side named only
                        the themes and a count. That asymmetry is not neutral —
                        it makes what to SELL concrete and what to HOLD or ADD
                        abstract, and a reader acts on whichever half they can
                        actually read. Both halves now carry the names. */}
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.4px', color: '#22C55E', textTransform: 'uppercase', marginBottom: 6 }}>✓ Aligned — in leading / early-buy themes, hold or add</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {leading.map((r) => (
                        <div key={r.theme.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5 }}>
                          <span style={{ color: TXT, fontWeight: 700, minWidth: 150 }}>{r.theme.emoji} {r.theme.name}</span>
                          <span style={{ fontSize: 9.5, fontWeight: 800, color: '#22C55E', background: 'color-mix(in srgb, #22C55E 12%, transparent)', border: '1px solid color-mix(in srgb, #22C55E 30%, transparent)', padding: '1px 6px', borderRadius: 4 }}>{r.theme.verdict}</span>
                          <span style={{ color: MUT, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.names.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {fading.length > 0 && (
                  <div style={{ marginTop: leading.length ? 14 : 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.4px', color: '#EF4444', textTransform: 'uppercase', marginBottom: 6 }}>✂️ Exposed to fading themes — trim candidates</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {fading.map((r) => (
                        <div key={r.theme.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5 }}>
                          <span style={{ color: TXT, fontWeight: 700, minWidth: 150 }}>{r.theme.emoji} {r.theme.name}</span>
                          <span style={{ fontSize: 9.5, fontWeight: 800, color: '#EF4444', background: 'color-mix(in srgb, #EF4444 12%, transparent)', border: '1px solid color-mix(in srgb, #EF4444 30%, transparent)', padding: '1px 6px', borderRadius: 4 }}>{r.theme.verdict}</span>
                          <span style={{ color: MUT, fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.names.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ═══ CROWDING — HOW MANY BETS IS YOUR BOOK ACTUALLY MAKING? ═══
              "Your exposure vs the rotation call" answers whether you are on
              the right side. This answers something the board could not:
              whether the themes you are spread across are spread at all.
              Software, Internet, Fintech and Cloud can all read BUY while
              moving as one position — four labels, one bet — and a reader who
              diversified across them has concentrated without knowing it.
              Themes are grouped by measured correlation of daily returns, so
              this is what your book DID, not what its labels say. */}
          {(() => {
            const groups = [...userBook.groups.entries()]
              .map(([tid, sts]) => ({ th: byId.get(tid), n: (sts as any[]).length }))
              .filter((g) => g.th) as Array<{ th: ThemeRow; n: number }>;
            if (!groups.length) return null;
            const byCluster = new Map<string, { label: string; names: number; themes: string[] }>();
            let unclustered = 0;
            for (const g of groups) {
              const key = g.th.cluster != null ? String(g.th.cluster) : null;
              if (key == null) { unclustered += g.n; continue; }
              const cur = byCluster.get(key) || { label: g.th.clusterLabel || g.th.name, names: 0, themes: [] };
              cur.names += g.n; cur.themes.push(g.th.name);
              byCluster.set(key, cur);
            }
            const rows = [...byCluster.values()].sort((a, b) => b.names - a.names);
            if (!rows.length) return null;
            const total = rows.reduce((a, r) => a + r.names, 0) + unclustered;
            const top = rows[0];
            const topPct = total ? Math.round((top.names / total) * 100) : 0;
            const heavy = topPct >= 35;
            return (
              <div style={{ marginTop: 18, background: CARD, border: `1px solid ${heavy ? 'rgba(245,158,11,0.4)' : BORD}`, borderRadius: 12, padding: 15 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: TXT, marginBottom: 3 }}>⧉ Crowding — how many bets is your book really making?</div>
                <div style={{ fontSize: 10.5, color: DIM, marginBottom: 11, lineHeight: 1.55 }}>
                  Themes grouped by how they actually MOVE (correlation of daily returns ≥ 0.8 over six months), not by what they are called.
                  Your {total} themed names sit in <b style={{ color: MUT }}>{rows.length}</b> such group{rows.length > 1 ? 's' : ''}.
                  {heavy
                    ? <> <b style={{ color: '#F59E0B' }}>{topPct}% of them are in one</b> — the {top.label} complex. Spreading across its members is closer to one position than to several.</>
                    : <> No single group holds more than {topPct}% of them, so the spread is real rather than nominal.</>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {rows.slice(0, 7).map((r, i) => {
                    const pct = total ? (r.names / total) * 100 : 0;
                    const col = pct >= 35 ? '#F59E0B' : pct >= 20 ? '#60A5FA' : '#64748B';
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11 }}>
                        <span style={{ width: 118, flexShrink: 0, color: TXT, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.themes.join(', ')}>{r.label}</span>
                        <span style={{ flex: 1, height: 9, background: BG, borderRadius: 5, overflow: 'hidden', minWidth: 60 }}>
                          <span style={{ display: 'block', width: `${Math.max(2, pct)}%`, height: '100%', background: col }} />
                        </span>
                        <span style={{ width: 96, flexShrink: 0, textAlign: 'right', color: MUT, fontFamily: 'ui-monospace,monospace' }}>
                          {r.names} names · {Math.round(pct)}%
                        </span>
                        <span style={{ width: 150, flexShrink: 0, color: DIM, fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.themes.join(', ')}>
                          {r.themes.length > 1 ? `${r.themes.length} themes: ${r.themes.join(', ')}` : r.themes[0]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ═══ DUMMY PORTFOLIO — best 25 of your names from BUY / EARLY-BUY themes ═══ */}
          <div style={{ marginTop: 18, background: CARD, border: `1px solid ${BORD}`, borderRadius: 12, padding: 15 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 3 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: TXT }}>🧪 Dummy Portfolio — Best {dummyPortfolio.top.length} <span style={{ color: DIM, fontWeight: 700 }}>({region === 'us' ? '🇺🇸 USA' : '🇮🇳 India'})</span></div>
              {dummyPortfolio.top.length > 0 && <div style={{ fontSize: 10.5, color: DIM }}><b style={{ color: MUT }}>{dummyPortfolio.graded}</b> graded · across <b style={{ color: MUT }}>{dummyPortfolio.themeSpread}</b> themes · equal-weight <b style={{ color: MUT }}>{dummyPortfolio.wt}%</b> each</div>}
            </div>
            <div style={{ fontSize: 10.5, color: DIM, marginBottom: 11, lineHeight: 1.5 }}>Your Multibagger / Technicals names that sit in a theme the engine rates <b style={{ color: '#22C55E' }}>BUY</b> or <b style={{ color: '#22C55E' }}>EARLY BUY</b> right now — <b style={{ color: MUT }}>nothing from Weakening or Lagging</b>. Ranked by your Fundo grade (A+ first), <b style={{ color: MUT }}>capped at {dummyPortfolio.cap} names per theme</b> so the book spreads across the rotation instead of stacking into whichever theme your best grades happen to sit in{dummyPortfolio.excluded ? <> — {dummyPortfolio.excluded} eligible name{dummyPortfolio.excluded > 1 ? 's' : ''} left out by that cap</> : null}. A simple starter book, not advice.</div>
            {dummyPortfolio.top.length === 0 ? (
              <div style={{ fontSize: 11.5, color: DIM, padding: '10px 0' }}>No names from your lists currently sit in a BUY / EARLY-BUY theme. When a theme you own rotates into a buy call, its best-graded names appear here.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: DIM, textAlign: 'left' }}>
                      <th style={{ padding: '5px 8px', fontWeight: 700, width: 30 }}>#</th>
                      <th style={{ padding: '5px 8px', fontWeight: 700 }}>Ticker</th>
                      <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'center' }}>Fundo</th>
                      <th style={{ padding: '5px 8px', fontWeight: 700 }}>Theme</th>
                      <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'center' }}>Call</th>
                      <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'right' }}>Wt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dummyPortfolio.top.map((p, i) => {
                      const gcol = p.grade ? (String(p.grade).startsWith('A') ? '#22C55E' : String(p.grade).startsWith('B') ? '#EAB308' : '#F59E0B') : DIM;
                      return (
                        <tr key={p.symbol} style={{ borderTop: `1px solid ${BORD}` }}>
                          <td style={{ padding: '6px 8px', color: DIM, fontWeight: 700 }}>{i + 1}</td>
                          <td style={{ padding: '6px 8px', color: '#F59E0B', fontWeight: 800 }}>★ {p.symbol}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 800, color: p.grade ? gcol : (p.tier === 'BLOCKBUSTER' ? '#F87171' : p.tier === 'STRONG' ? '#34D399' : DIM), fontSize: p.grade ? undefined : 9.5 }}
                            title={p.grade ? `Fundo grade ${p.grade}` : p.tier ? `No Fundo grade — graded ${p.tier} on its last filing${p.escore != null ? ` (engine ${p.escore})` : ''}` : undefined}>
                            {p.grade || (p.tier === 'BLOCKBUSTER' ? '🔥 BB' : p.tier === 'STRONG' ? '✅ STR' : '·')}</td>
                          <td style={{ padding: '6px 8px', color: MUT, whiteSpace: 'nowrap' }}>{p.themeEmoji} {p.themeName}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}><span style={{ fontSize: 9, fontWeight: 900, color: p.verdictColor, background: `${p.verdictColor}1a`, border: `1px solid ${p.verdictColor}55`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }}>{p.verdict}</span></td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: MUT, fontWeight: 700 }}>{dummyPortfolio.wt}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, fontSize: 10, color: DIM, lineHeight: 1.6 }}>
            <b style={{ color: MUT }}>How to read it:</b> Leading (green) = strong &amp; rising → buy leaders. Improving (blue) = weak but turning up → early buy on 50-DMA reclaim. Weakening (orange) = strong but rolling over → trim. Lagging (red) = weak &amp; falling → avoid. Verdicts combine the quadrant with the price’s position vs its 50-DMA. Live prices via {payload.source}. Themes with no clean ETF use an equal-weight basket of leaders. Educational, not investment advice.
            {payload.asOf && <span> · updated {new Date(payload.asOf).toLocaleString()}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Quadrant board (zzz485) — the clear "read it at a glance" rotation view ───
// Four boxes, positioned like the RRG (right = strong, top = rising momentum):
//   IMPROVING (early buy) | LEADING (buy)
//   LAGGING   (avoid)     | WEAKENING (trim)
function QuadrantBoard({ themes, onPick, expandedIds }: { themes: ThemeRow[]; onPick: (id: string) => void; expandedIds: Set<string> }) {
  const bucket = (q: string) => themes.filter((t) => t.quadrant === q);
  const strength = (t: ThemeRow) => (t.rsRatio || 0) + (t.rsMomentum || 0);
  const boxes: { q: string; label: string; action: string; color: string; tint: string; emoji: string; items: ThemeRow[] }[] = [
    { q: 'Improving', label: 'IMPROVING', action: 'rotating in — early buy', color: '#3B82F6', tint: 'rgba(59,130,246,0.07)', emoji: '🔵', items: bucket('Improving').sort((a, b) => (b.rsMomentum || 0) - (a.rsMomentum || 0)) },
    { q: 'Leading', label: 'LEADING', action: 'strongest — buy leaders', color: '#16A34A', tint: 'rgba(22,163,74,0.08)', emoji: '🟢', items: bucket('Leading').sort((a, b) => strength(b) - strength(a)) },
    { q: 'Lagging', label: 'LAGGING', action: 'weak & falling — avoid', color: '#EF4444', tint: 'rgba(239,68,68,0.07)', emoji: '🔴', items: bucket('Lagging').sort((a, b) => strength(a) - strength(b)) },
    { q: 'Weakening', label: 'WEAKENING', action: 'rolling over — trim', color: '#F97316', tint: 'rgba(249,115,22,0.07)', emoji: '🟠', items: bucket('Weakening').sort((a, b) => (a.rsMomentum || 0) - (b.rsMomentum || 0)) },
  ];
  return (
    <div>
      <div style={{ fontSize: 11.5, color: DIM, marginBottom: 6 }}>Rotation board — where every theme sits right now. <b style={{ color: '#22C55E' }}>Top-right = buy</b>, moving clockwise to <b style={{ color: '#EF4444' }}>bottom-left = avoid</b>. A <span style={{ color: '#FBBF24', fontWeight: 800 }}>◆</span> marks a theme that crossed into this quadrant <b style={{ color: MUT }}>this week</b> — newly arrived, not long-settled. Click any theme to see its stocks.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {boxes.map((b) => (
          <div key={b.q} style={{ background: b.tint, border: `1px solid ${b.color}55`, borderRadius: 10, padding: '10px 11px', minHeight: 92 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: b.color, letterSpacing: 0.4 }}>{b.emoji} {b.label}</span>
              <span style={{ fontSize: 9.5, color: DIM }}>{b.items.length} · {b.action}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {b.items.length ? b.items.map((t) => (
                <button key={t.id} onClick={() => onPick(t.id)} title={`${t.name} — RS ${t.rsRatio?.toFixed(0)} · click for stocks`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', color: expandedIds.has(t.id) ? '#fff' : TXT, background: expandedIds.has(t.id) ? b.color : `${b.color}18`, border: `1px solid ${b.color}${expandedIds.has(t.id) ? '' : '44'}`, borderRadius: 20, padding: '3px 9px' }}>
                  {t.quadrantMove && <span title={`Crossed ${t.quadrant1w} → ${t.quadrant} this week`} style={{ color: '#FBBF24', fontSize: 9 }}>◆</span>}
                  {t.emoji} {t.name}
                  <span style={{ color: (t.rsMomentum || 100) >= 100 ? (expandedIds.has(t.id) ? '#fff' : '#22C55E') : (expandedIds.has(t.id) ? '#fff' : '#EF4444'), fontWeight: 900 }}>{(t.rsMomentum || 100) >= 100 ? '↑' : '↓'}</span>
                </button>
              )) : <span style={{ fontSize: 11, color: DIM }}>—</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══ RRG SCATTER — the one view that shows PATH rather than position ═══════
//
// This component existed for months and was never rendered: the quadrant board
// replaced it because a wall of 49 unlabelled dots is unreadable. But the board
// throws away the single most useful thing the engine computes — the eight-week
// TAIL. A dot sitting in Leading tells you nothing about whether it arrived
// last week from Improving (a young trend worth adding to) or is drifting out
// towards Weakening (a trade to trim). The tail shows that at a glance, and no
// table column can.
//
// So the scatter comes back, fixed rather than restored: the tail fades from
// old to recent so direction of travel is visible without an animation, the
// current point is a filled dot with a ring on whatever is hovered or already
// expanded, and labels are drawn only for the themes worth naming — the ones
// that MOVED quadrant this week, plus whatever the pointer is on — so the chart
// stays legible at 49 themes instead of turning into a smear of text.
function RRG({ themes, hover, setHover, onPick }: { themes: ThemeRow[]; hover: string | null; setHover: (s: string | null) => void; onPick?: (id: string) => void }) {
  const W = 360, H = 320, pad = 30;
  const pts = themes.filter((t) => t.rsRatio != null && t.rsMomentum != null);
  const xs = pts.map((t) => t.rsRatio as number), ys = pts.map((t) => t.rsMomentum as number);
  const span = (arr: number[]) => { const mn = Math.min(100, ...arr), mx = Math.max(100, ...arr); const pad2 = Math.max(1.5, (mx - mn) * 0.15); return [mn - pad2, mx + pad2] as const; };
  const [x0, x1] = pts.length ? span(xs) : [96, 104] as const;
  const [y0, y1] = pts.length ? span(ys) : [96, 104] as const;
  const sx = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const sy = (v: number) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
  const cx = sx(100), cy = sy(100);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* quadrant fills */}
      <rect x={cx} y={pad} width={W - pad - cx} height={cy - pad} fill="rgba(22,163,74,0.06)" />
      <rect x={pad} y={pad} width={cx - pad} height={cy - pad} fill="rgba(59,130,246,0.06)" />
      <rect x={pad} y={cy} width={cx - pad} height={H - pad - cy} fill="rgba(239,68,68,0.06)" />
      <rect x={cx} y={cy} width={W - pad - cx} height={H - pad - cy} fill="rgba(249,115,22,0.06)" />
      <line x1={cx} y1={pad} x2={cx} y2={H - pad} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" />
      <line x1={pad} y1={cy} x2={W - pad} y2={cy} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" />
      <text x={W - pad} y={pad + 10} fill="#16A34A" fontSize="9" textAnchor="end" fontWeight="700">LEADING</text>
      <text x={pad} y={pad + 10} fill="#3B82F6" fontSize="9" fontWeight="700">IMPROVING</text>
      <text x={pad} y={H - pad - 4} fill="#EF4444" fontSize="9" fontWeight="700">LAGGING</text>
      <text x={W - pad} y={H - pad - 4} fill="#F97316" fontSize="9" textAnchor="end" fontWeight="700">WEAKENING</text>
      <text x={W / 2} y={H - 6} fill="#5B6B85" fontSize="8" textAnchor="middle">relative strength vs benchmark →</text>
      <text x={9} y={H / 2} fill="#5B6B85" fontSize="8" textAnchor="middle" transform={`rotate(-90 9 ${H / 2})`}>momentum →</text>
      {/* Tails first, so every dot sits above every line. Drawn as fading
          segments rather than one polyline: opacity rising towards the present
          is what makes the direction of travel readable without animation. */}
      {pts.map((t) => {
        const tr = t.trail || [];
        if (tr.length < 2) return null;
        const c = QC[t.quadrant || 'Lagging'];
        const on = hover === t.id;
        return (
          <g key={`tr:${t.id}`} pointerEvents="none">
            {tr.slice(1).map((p, i) => {
              const a = tr[i], b = p;
              const frac = (i + 1) / (tr.length - 1);          // 0 = oldest, 1 = now
              return (
                <line key={i} x1={sx(a.x)} y1={sy(a.y)} x2={sx(b.x)} y2={sy(b.y)}
                  stroke={c} strokeWidth={on ? 0.6 + frac * 1.8 : 0.3 + frac * 0.9}
                  opacity={on ? 0.35 + frac * 0.55 : (t.quadrantMove ? 0.16 : 0.09) + frac * 0.22}
                  strokeLinecap="round" />
              );
            })}
          </g>
        );
      })}
      {pts.map((t) => {
        const x = sx(t.rsRatio as number), y = sy(t.rsMomentum as number);
        const c = QC[t.quadrant || 'Lagging'];
        const on = hover === t.id;
        return (
          <g key={t.id} onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}
            onClick={() => onPick?.(t.id)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={10} fill="transparent" />
            {t.quadrantMove && <circle cx={x} cy={y} r={on ? 8.5 : 7} fill="none" stroke="#FBBF24" strokeWidth="1.2" opacity={0.9} />}
            <circle cx={x} cy={y} r={on ? 6 : t.quadrantMove ? 4.5 : 3.6} fill={c} stroke="#0B111C" strokeWidth="1" />
          </g>
        );
      })}
      {/* ── LABELS LAST, AND DE-COLLIDED ────────────────────────────────────
          Only what is worth naming gets a label: the pointer's target, and the
          themes that crossed a quadrant line this week. At 49 themes, labelling
          everything is the same as labelling nothing.

          Those movers are exactly the points that CLUSTER, though — a theme
          changes quadrant by sitting near the 100/100 lines, so all of them
          crowd the centre and their labels landed on top of each other,
          unreadable. So each label is nudged down until it clears the one
          before it and joined to its dot by a hairline, which keeps every name
          legible without moving the data. */}
      {(() => {
        const labelled = pts.filter((t) => (hover ? hover === t.id : !!t.quadrantMove));
        const placed: number[] = [];
        return labelled
          .map((t) => ({ t, x: sx(t.rsRatio as number), y: sy(t.rsMomentum as number) }))
          .sort((a, b) => a.y - b.y)
          .map(({ t, x, y }) => {
            let ly = y + 3;
            while (placed.some((p) => Math.abs(p - ly) < 11)) ly += 11;
            ly = Math.max(pad + 8, Math.min(H - pad - 2, ly));
            placed.push(ly);
            const on = hover === t.id;
            const right = x > W * 0.6;
            const lx = x + (right ? -9 : 9);
            return (
              <g key={`lb:${t.id}`} pointerEvents="none">
                {Math.abs(ly - (y + 3)) > 3 && <line x1={x} y1={y} x2={lx} y2={ly - 3} stroke="#5B6B85" strokeWidth="0.6" opacity={0.7} />}
                <text x={lx} y={ly} textAnchor={right ? 'end' : 'start'}
                  fill={on ? '#fff' : '#C8D4E4'} fontSize={on ? 10 : 8.5} fontWeight={on ? 800 : 700}
                  stroke="#0B111C" strokeWidth={on ? 2.8 : 2.2} paintOrder="stroke" strokeLinejoin="round">
                  {t.emoji} {t.name}
                </text>
              </g>
            );
          });
      })()}
    </svg>
  );
}
