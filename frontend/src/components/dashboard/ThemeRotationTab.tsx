'use client';
// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION TAB (zzz480) — USA + India in one tab, separated by a toggle.
// Reads /api/market/theme-rotation and renders: a BUY / AVOID + rotation call
// strip, an RRG quadrant map (Leading / Improving / Weakening / Lagging), and a
// multi-timeframe leaderboard. The whole point: always clear what to buy / avoid.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { readConvictionBeats } from '@/lib/conviction-beats';
import { classifyTheme } from '@/lib/theme-classify';

type Region = 'us' | 'india';
interface Ret { w1: number; m1: number; m3: number; m6: number; ytd: number; y1: number }
interface ThemeRow {
  id: string; name: string; emoji: string; group: string; note?: string;
  proxy: string | null; members: string[];
  price?: number; dayChangePct?: number;
  ret?: Ret; rsRatio?: number; rsMomentum?: number; quadrant?: string; trail?: { x: number; y: number }[];
  aboveSMA50?: boolean; breadthAbove50?: number | null;
  characterChange?: 'bullish' | 'bearish' | null;
  verdict?: string; verdictColor?: string; verdictNote?: string;
  ok?: boolean;
}
interface Payload {
  region: Region; benchmark: { symbol: string; name: string; price: number; changePercent: number };
  themes: ThemeRow[]; rotatingIn: string[]; rotatingOut: string[]; topBuy: string[]; topAvoid: string[];
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
  const [sortKey, setSortKey] = useState<'rs' | 'w1' | 'm1' | 'm3' | 'ytd' | 'y1'>('rs');
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
    const bench = new Map<string, string>();
    const readJSON = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    const frows = readJSON(region === 'us' ? 'mb_usa_scored_v2' : 'mb_excel_scored_v2');
    if (Array.isArray(frows)) for (const r of frows) { const s = norm(r?.symbol); if (s) fundo.set(s, { score: r?.score, grade: r?.grade }); }
    const trows = readJSON(region === 'us' ? 'mb_tech_rows_usa_v1' : 'mb_tech_rows_ind_v1');
    if (Array.isArray(trows)) for (const r of trows) { const s = norm(r?.symbol); if (s) tech.add(s); }
    try { const cb = readConvictionBeats() as Record<string, any>; for (const k in cb) { const s = norm(k); if (s) bench.set(s, cb[k]?.tier); } } catch { /* none */ }
    return { fundo, tech, bench, norm };
  }, [region, payload]);

  // zzz485 — YOUR BOOK: take every stock across the user's Technicals + Multibagger
  // lists, classify each into a theme by its sector/industry (auto — works for
  // years and for stocks added later), and group them so NONE of the user's names
  // are left uncovered. Client-side (data is in the browser); guarded.
  const userBook = useMemo(() => {
    const norm = userLists.norm;
    // zzz487 — index/benchmark ETFs are not holdings; keep them out of Your Book.
    const EXCLUDE = new Set(['SPY', 'QQQ', 'QQQM', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'SPX', 'NDX', 'RUT', 'NIFTY', 'NIFTYBEES', 'BANKBEES', 'GOLDBEES']);
    const readJSON = (k: string) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    const map = new Map<string, { symbol: string; sector?: string; industry?: string; score?: number; grade?: string; inTech?: boolean; inFundo?: boolean }>();
    const trows = readJSON(region === 'us' ? 'mb_tech_rows_usa_v1' : 'mb_tech_rows_ind_v1');
    if (Array.isArray(trows)) for (const r of trows) { const s = norm(r?.symbol); if (!s || EXCLUDE.has(s)) continue; const e = map.get(s) || { symbol: s }; e.sector = r?.sector || e.sector; e.industry = r?.industry || e.industry; e.inTech = true; map.set(s, e); }
    const frows = readJSON(region === 'us' ? 'mb_usa_scored_v2' : 'mb_excel_scored_v2');
    if (Array.isArray(frows)) for (const r of frows) { const s = norm(r?.symbol); if (!s || EXCLUDE.has(s)) continue; const e = map.get(s) || { symbol: s }; e.sector = r?.sector || e.sector; e.industry = r?.industry || e.industry; e.score = r?.score; e.grade = r?.grade; e.inFundo = true; map.set(s, e); }
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
    return { total: all.length, themed: all.length - other.length, groups, other, sectorGroups };
  }, [region, payload, userLists]);

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
    return [...themes].sort((a, b) => {
      const va = key === 'rs' ? (a.rsRatio || 0) + (a.rsMomentum || 0) - 200 : (a.ret?.[key] ?? -999);
      const vb = key === 'rs' ? (b.rsRatio || 0) + (b.rsMomentum || 0) - 200 : (b.ret?.[key] ?? -999);
      return vb - va;
    });
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{payload.rotatingIn.length ? payload.rotatingIn.map((id) => chip(id, '#3B82F6')) : <span style={{ color: DIM, fontSize: 12 }}>—</span>}</div>
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

          {/* CLEAR rotation board — 2×2 quadrants you read at a glance */}
          <QuadrantBoard themes={themes} onPick={(id) => toggleExpand(id)} expandedIds={expandedIds} />

          {/* YOUR BOOK — every stock on your lists, mapped to a theme. Sits BELOW the
              rotation board (below Leading/Improving/Lagging) per the user's ask.
              Nothing hidden: themed stocks show the theme's call; the rest are
              grouped by their sector. */}
          {userBook.total > 0 && (
            <div style={{ margin: '14px 0', background: CARD, border: `1px solid ${BORD}`, borderRadius: 10, padding: 13 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: TXT, marginBottom: 2 }}>📋 Your Book by Theme</div>
              <div style={{ fontSize: 10.5, color: DIM, marginBottom: 10 }}>Every stock on your Technicals / Multibagger lists, auto-sorted into its theme by sector so you see the rotation call for each. <b style={{ color: MUT }}>{userBook.total}</b> names · <b style={{ color: MUT }}>{userBook.themed}</b> in a rotation theme{userBook.sectorGroups.size ? <> · <b style={{ color: MUT }}>{userBook.other.length}</b> grouped by sector below</> : null}. ★ = your name; grade = your Fundo.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 9 }}>
                {[...userBook.groups.entries()]
                  .map(([tid, sts]) => ({ tid, sts, th: byId.get(tid) }))
                  .sort((a, b) => { const rk = (v?: string) => v === 'BUY' ? 0 : v === 'EARLY BUY' ? 1 : v === 'HOLD' || v === 'WATCH' ? 2 : v === 'TRIM' ? 3 : v === 'AVOID' ? 4 : 5; return rk(a.th?.verdict) - rk(b.th?.verdict) || b.sts.length - a.sts.length; })
                  .map(({ tid, sts, th }) => (
                    <div key={tid} style={{ border: `1px solid ${(th?.verdictColor || '#64748B')}44`, borderRadius: 8, padding: '8px 10px', background: BG }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                        <button onClick={() => th && toggleExpand(tid)} style={{ background: 'transparent', border: 'none', color: TXT, fontWeight: 800, fontSize: 12, cursor: th ? 'pointer' : 'default', padding: 0, textAlign: 'left' }}>{th ? `${th.emoji} ${th.name}` : tid} <span style={{ color: DIM, fontWeight: 600 }}>· {sts.length}</span></button>
                        {th?.verdict ? <span style={{ fontSize: 9, fontWeight: 900, color: th.verdictColor, background: `${th.verdictColor}1a`, border: `1px solid ${th.verdictColor}55`, borderRadius: 5, padding: '2px 6px', flexShrink: 0 }}>{th.verdict}</span> : null}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {sts.map((s) => (
                          <span key={s.symbol} title={`${s.sector || ''}${s.grade ? ` · Grade ${s.grade}` : ''}`} style={{ fontSize: 10.5, fontWeight: 700, color: '#F59E0B', background: 'rgba(245,158,11,0.12)', borderRadius: 4, padding: '1px 6px' }}>★ {s.symbol}{s.grade ? <span style={{ color: DIM }}> {s.grade}</span> : null}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                {/* sector-fallback groups — visible even without a rotation theme */}
                {[...userBook.sectorGroups.entries()].sort((a, b) => b[1].length - a[1].length).map(([sec, sts]) => (
                  <div key={`sec:${sec}`} style={{ border: `1px dashed ${BORD}`, borderRadius: 8, padding: '8px 10px', background: BG }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                      <span style={{ color: MUT, fontWeight: 800, fontSize: 11.5 }}>{sec} <span style={{ color: DIM, fontWeight: 600 }}>· {sts.length}</span></span>
                      <span style={{ fontSize: 8.5, color: DIM }}>no theme call</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {sts.map((s) => (
                        <span key={s.symbol} title={`${s.sector || ''}${s.grade ? ` · Grade ${s.grade}` : ''}`} style={{ fontSize: 10.5, fontWeight: 700, color: MUT, background: 'rgba(148,163,184,0.12)', borderRadius: 4, padding: '1px 6px' }}>★ {s.symbol}{s.grade ? <span style={{ color: DIM }}> {s.grade}</span> : null}</span>
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
                            <div style={{ fontWeight: 800, color: TXT }}>{t.emoji} {t.name}</div>
                            <div style={{ fontSize: 9.5, color: DIM }}>{t.quadrant}{t.aboveSMA50 ? ' · >50DMA' : ' · <50DMA'}{t.breadthAbove50 != null ? ` · ${t.breadthAbove50}% brdth` : ''}{t.proxy ? ` · ${t.proxy}` : ' · basket'}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '7px 6px', textAlign: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, color: t.verdictColor, background: `${t.verdictColor}1a`, border: `1px solid ${t.verdictColor}55`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }} title={t.verdictNote}>{t.verdict}</span>
                      </td>
                      {(['w1', 'm1', 'm3', 'ytd', 'y1'] as const).map((k) => (
                        <td key={k} style={{ padding: '7px 6px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: TXT, background: pctColor(t.ret?.[k]), borderRadius: 4 }}>{fmtPct(t.ret?.[k])}</td>
                      ))}
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'ui-monospace,monospace', color: MUT }}>
                        {t.rsRatio?.toFixed(0)}<span style={{ color: (t.rsMomentum || 100) >= 100 ? '#22C55E' : '#EF4444', marginLeft: 4 }}>{(t.rsMomentum || 100) >= 100 ? '↑' : '↓'}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={8} style={{ padding: '2px 8px 12px 24px', background: 'rgba(59,130,246,0.04)' }}>
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
                                  const tier = userLists.bench.get(nsym);
                                  const inList = !!f || inTech || !!tier;
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
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11.5, color: DIM, marginBottom: 6 }}>Rotation board — where every theme sits right now. <b style={{ color: '#22C55E' }}>Top-right = buy</b>, moving clockwise to <b style={{ color: '#EF4444' }}>bottom-left = avoid</b>. Click any theme to see its stocks.</div>
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

// ── RRG scatter (kept for reference; the quadrant board above is the primary view) ─
function RRG({ themes, hover, setHover }: { themes: ThemeRow[]; hover: string | null; setHover: (s: string | null) => void }) {
  const W = 360, H = 300, pad = 26;
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
      {pts.map((t) => {
        const x = sx(t.rsRatio as number), y = sy(t.rsMomentum as number);
        const c = QC[t.quadrant || 'Lagging'];
        const on = hover === t.id;
        const trail = (t.trail || []).map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ');
        return (
          <g key={t.id} onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            {t.trail && t.trail.length > 1 && <polyline points={trail} fill="none" stroke={c} strokeWidth={on ? 1.6 : 0.8} opacity={on ? 0.8 : 0.35} />}
            <circle cx={x} cy={y} r={on ? 6 : 4} fill={c} stroke="#0B111C" strokeWidth="1" />
            {(on || pts.length <= 22) && <text x={x + 7} y={y + 3} fill={on ? '#fff' : '#B7C4D6'} fontSize={on ? 10 : 8.5} fontWeight={on ? 800 : 600}>{t.emoji}{on ? ` ${t.name}` : ''}</text>}
          </g>
        );
      })}
    </svg>
  );
}
