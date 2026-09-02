'use client';

// ════════════════════════════════════════════════════════════════════════════
// 🥷 CHEAT ENTRY (zzz522, logic overhaul zzz523) — the timing desk.
// ────────────────────────────────────────────────────────────────────────────
// Every other engine answers WHAT to buy: the India/USA Multibagger rankings
// (fundamental composite + grade), the India/USA Technicals universe (your
// curated TradingView lists), and the Conviction Beats bench (BB/STRONG
// earnings winners). This tab answers WHEN: it merges those into one elite
// universe and ranks the names sitting ON a rising moving average — the add
// point where the stop is nearest and the risk smallest.
//
// zzz523 logic fixes (from first live session):
//   1. Board renders INSTANTLY from synced data, then re-scores when live
//      quotes land. Quotes get a 25s budget + one retry — the full-universe
//      build is ~25s on a cold serverless cache, and the old 12s abort meant
//      "live prices for 0 symbols" right after every deploy.
//   2. Setup = the NEAREST qualifying pivot (with a mild preference for deeper
//      MAs), not a fixed 200→50→21 priority — so a name resting exactly on its
//      21-EMA is called a 21-EMA rest even if it's also within 5% of the 50.
//   3. The stop belongs to the pivot you are buying: risk = drop to 2% under
//      THAT MA (floor 0.3%). No more "50DMA pullback, risk→200DMA 36%".
//   4. Quality gate: a name the Multibagger engine graded < 45 is OFF the
//      board (unless the Conviction bench vouches) — "good" has to mean good.
//   5. Support being TESTED (price 1-3% under the pivot) scores a touch lower
//      than support HELD; very late-stage names (>50% above the 200DMA) give
//      back a few setup points.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { getConvictionList } from '@/lib/conviction-beats';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', bg3: 'var(--mc-bg-3)',
  border: 'var(--mc-border-1)', border2: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', text2: 'var(--mc-text-2)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: 'var(--mc-warn)', cyan: 'var(--mc-cyan)', accent: 'var(--mc-accent)',
};

const EXCLUDE = new Set(['SPY', 'QQQ', 'QQQM', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'SPX', 'NDX', 'RUT', 'NIFTY', 'NIFTYBEES', 'BANKBEES', 'GOLDBEES', 'JUNIORBEES', 'SETFNIF50']);

type Market = 'IND' | 'USA';
type SetupKind = 'AT_200' | 'AT_50' | 'AT_21' | 'DRIFT' | 'EXTENDED';
type StopMa = '200DMA' | '50DMA' | '21EMA';

interface Candidate {
  symbol: string; market: Market;
  company: string; sector: string;
  livePrice: number; priceIsLive: boolean; dayChg: number | null;
  d21: number | null; d50: number | null; d200: number | null;
  setup: SetupKind; setupLabel: string; atSupportNow: boolean; testingSupport: boolean;
  stopMa: StopMa | null; riskPct: number | null;
  fundoScore: number | null; fundoGrade: string | null;
  benchTier: 'BLOCKBUSTER' | 'STRONG' | null;
  sources: string[];
  setupScore: number; qualityScore: number; score: number;
}

interface LiveQuote { price: number; chg: number | null; company?: string }

const norm = (s: any) => String(s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();
const num = (v: any): number | null => { const n = typeof v === 'number' ? v : parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
const readJSON = (k: string): any => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };

const SETUP_META: Record<SetupKind, { label: string; color: string; blurb: string }> = {
  AT_200:   { label: '🛡 200DMA retest',  color: 'var(--mc-cyan)',    blurb: 'Deepest institutional add point — long-term trend line holding underneath.' },
  AT_50:    { label: '🎯 50DMA pullback', color: 'var(--mc-bullish)', blurb: 'The classic cheat: quality name resting on its intermediate trend.' },
  AT_21:    { label: '⚡ 21EMA rest',     color: 'var(--mc-warn)',    blurb: 'Momentum leader pausing at the fast line (Qullamaggie entry).' },
  DRIFT:    { label: '· drifting',        color: 'var(--mc-text-4)',  blurb: 'Between pivots — wait for it to come into a moving average.' },
  EXTENDED: { label: '⏳ extended',       color: 'var(--mc-bearish)', blurb: 'Too far above the 50DMA — chasing, not cheating. Let it come back.' },
};

// ── assemble the board from localStorage engines + an (optionally empty) live
//    quote map. Pure enough to run twice: instant pass, then the live re-score.
function assemble(live: Map<string, LiveQuote>): { cands: Candidate[]; skipped: number } {
  // 1 · fundamentals (Multibagger rankings)
  const fundo = new Map<string, { score: number | null; grade: string | null; sector?: string }>();
  for (const key of ['mb_excel_scored_v2', 'mb_usa_scored_v2']) {
    const rows = readJSON(key);
    if (Array.isArray(rows)) for (const r of rows) {
      const s = norm(r?.symbol); if (!s || EXCLUDE.has(s)) continue;
      fundo.set(s, { score: num(r?.score), grade: r?.grade ? String(r.grade) : null, sector: r?.sector || r?.industry });
    }
  }
  // 2 · conviction bench
  const bench = new Map<string, { tier: 'BLOCKBUSTER' | 'STRONG'; company: string; sector?: string }>();
  try {
    for (const e of getConvictionList()) {
      const s = norm(e?.ticker); if (!s || EXCLUDE.has(s)) continue;
      if (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG') bench.set(s, { tier: e.tier, company: e.company || '', sector: (e as any).sector });
    }
  } catch { /* bench unreadable */ }
  // 3 · technicals universe (the MAs)
  interface TechRaw { market: Market; price: number | null; ema21: number | null; sma50: number | null; sma200: number | null; sector?: string; company?: string; rs?: number | null }
  const tech = new Map<string, TechRaw>();
  for (const [key, market] of [['mb_tech_rows_ind_v1', 'IND'], ['mb_tech_rows_usa_v1', 'USA']] as [string, Market][]) {
    const rows = readJSON(key);
    if (Array.isArray(rows)) for (const r of rows) {
      const s = norm(r?.symbol || r?.ticker); if (!s || EXCLUDE.has(s) || tech.has(s)) continue;
      tech.set(s, {
        market, price: num(r?.price), ema21: num(r?.ema21), sma50: num(r?.sma50), sma200: num(r?.sma200),
        sector: r?.sector || r?.industry, company: r?.description || r?.company || r?.name,
        rs: num(r?.rsRating ?? r?.rs_rating ?? r?.rs),
      });
    }
  }

  const universe = new Set<string>([...tech.keys(), ...fundo.keys(), ...bench.keys()]);
  const cands: Candidate[] = [];
  let skipped = 0;
  for (const sym of universe) {
    const t = tech.get(sym);
    const f = fundo.get(sym) || null;
    const b = bench.get(sym) || null;
    if (!t || t.sma50 == null || t.sma200 == null || t.sma50 <= 0 || t.sma200 <= 0) {
      if (b || (f && (f.score ?? 0) >= 60)) skipped++;
      continue;
    }
    // Quality gate — the portal already graded this name; below 45 it is not
    // "good", so it has no business on a quality-pullback board. The bench
    // (a fresh BLOCKBUSTER/STRONG quarter) can overrule an old bad grade.
    if (f && f.score != null && f.score < 45 && !b) continue;

    const lq = live.get(sym);
    const livePrice = lq?.price ?? t.price ?? null;
    if (livePrice == null || livePrice <= 0) continue;

    const d200 = (livePrice - t.sma200) / t.sma200 * 100;
    const d50 = (livePrice - t.sma50) / t.sma50 * 100;
    const d21 = t.ema21 != null && t.ema21 > 0 ? (livePrice - t.ema21) / t.ema21 * 100 : null;
    if (d200 < -3) continue; // clearly below the 200DMA = broken chart, not a dip

    // ── setup: nearest qualifying pivot, mild preference for deeper MAs ──────
    type Pivot = { kind: SetupKind; stop: StopMa; d: number; base: number; ma: number; pref: number };
    const pivots: Pivot[] = [];
    if (d200 >= -3 && d200 <= 5) pivots.push({ kind: 'AT_200', stop: '200DMA', d: d200, base: 60, ma: t.sma200, pref: 1.2 });
    if (d50 >= -3 && d50 <= 5) pivots.push({ kind: 'AT_50', stop: '50DMA', d: d50, base: 52, ma: t.sma50, pref: 0.6 });
    if (d21 != null && d21 >= -2 && d21 <= 4 && t.ema21) pivots.push({ kind: 'AT_21', stop: '21EMA', d: d21, base: 44, ma: t.ema21!, pref: 0 });

    let setup: SetupKind; let setupScore: number;
    let stopMa: StopMa | null = null; let riskPct: number | null = null;
    let pivotD: number | null = null; let testingSupport = false;

    const nearestBelowStop = (): { stop: StopMa; ma: number } | null => {
      const below: Array<{ stop: StopMa; ma: number }> = [];
      if (t.sma50! < livePrice) below.push({ stop: '50DMA', ma: t.sma50! });
      if (t.sma200! < livePrice) below.push({ stop: '200DMA', ma: t.sma200! });
      if (!below.length) return null;
      below.sort((a, bb) => bb.ma - a.ma);
      return below[0];
    };

    if (d50 > 15) {
      setup = 'EXTENDED'; setupScore = 3;
      const nb = nearestBelowStop();
      if (nb) { stopMa = nb.stop; riskPct = Math.max(0.3, (livePrice - nb.ma * 0.98) / livePrice * 100); }
    } else if (pivots.length) {
      pivots.sort((a, bb) => (Math.abs(a.d - 1) - a.pref) - (Math.abs(bb.d - 1) - bb.pref));
      const p = pivots[0];
      setup = p.kind; pivotD = p.d;
      setupScore = Math.max(20, p.base - Math.abs(p.d - 1) * 4);
      if (p.d < -1) { setupScore -= 3; testingSupport = true; } // testing, not holding
      stopMa = p.stop;
      riskPct = Math.max(0.3, (livePrice - p.ma * 0.98) / livePrice * 100); // stop = 2% under YOUR pivot
    } else {
      setup = 'DRIFT';
      const nearest = Math.min(Math.abs(d50), Math.abs(d200), d21 != null ? Math.abs(d21) : 99);
      setupScore = Math.max(0, 22 - nearest * 1.5);
      const nb = nearestBelowStop();
      if (nb) { stopMa = nb.stop; riskPct = Math.max(0.3, (livePrice - nb.ma * 0.98) / livePrice * 100); }
    }
    if (t.sma50 > t.sma200) setupScore += 4;      // golden structure
    if (d200 > 50) setupScore -= 4;                // very late-stage — give a little back
    setupScore = Math.max(0, Math.min(60, setupScore));

    // ── quality (0-40) ───────────────────────────────────────────────────────
    const sources: string[] = [`Tech ${t.market === 'IND' ? '🇮🇳' : '🇺🇸'}`];
    if (f && f.score != null) sources.push(`Fundo ${Math.round(f.score)}${f.grade ? ` (${f.grade})` : ''}`);
    if (b) sources.push(b.tier === 'BLOCKBUSTER' ? 'CB · BB' : 'CB · STRONG');
    let quality = 0;
    quality += f && f.score != null ? Math.min(22, Math.max(0, ((f.score - 20) / 80) * 22)) : 6; // 45→~7, 60→11, 100→22
    quality += b ? (b.tier === 'BLOCKBUSTER' ? 10 : 7) : 0;
    if (t.rs != null && t.rs >= 80) quality += 3;
    const engineCount = 1 + (f && f.score != null ? 1 : 0) + (b ? 1 : 0);
    if (engineCount >= 2) quality += engineCount >= 3 ? 8 : 5;
    quality = Math.min(40, quality);

    const atSupportNow = pivotD != null && Math.abs(pivotD) <= 1 && setup !== 'EXTENDED';

    cands.push({
      symbol: sym, market: t.market,
      company: b?.company || live.get(sym)?.company || t.company || '',
      sector: String(f?.sector || t.sector || b?.sector || ''),
      livePrice, priceIsLive: !!lq, dayChg: lq?.chg ?? null,
      d21, d50, d200,
      setup, setupLabel: SETUP_META[setup].label, atSupportNow, testingSupport,
      stopMa, riskPct,
      fundoScore: f?.score ?? null, fundoGrade: f?.grade ?? null,
      benchTier: b?.tier ?? null, sources,
      setupScore: Math.round(setupScore), qualityScore: Math.round(quality),
      score: Math.round(setupScore + quality),
    });
  }
  cands.sort((a, b) => b.score - a.score || (a.riskPct ?? 99) - (b.riskPct ?? 99));
  return { cands, skipped };
}

// Live quotes with a realistic budget: the full-universe build is ~25s on a
// cold serverless cache. First try 25s; if empty, wait 3s (server keeps
// building after our abort and caches the result) and retry with 20s.
async function fetchLiveQuotes(): Promise<Map<string, LiveQuote>> {
  const live = new Map<string, LiveQuote>();
  const one = async (m: 'india' | 'us', ms: number) => {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
      const r = await fetch(`/api/market/quotes?market=${m}&fields=ticker,price,changePercent,company`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return;
      const j = await r.json();
      const stocks = Array.isArray(j?.stocks) ? j.stocks : [];
      for (const s of stocks) {
        const sym = norm(s?.ticker); const p = num(s?.price);
        if (sym && p != null && p > 0 && !live.has(sym)) live.set(sym, { price: p, chg: num(s?.changePercent), company: s?.company });
      }
    } catch { /* cold / aborted */ }
  };
  await Promise.all([one('india', 25000), one('us', 25000)]);
  if (live.size === 0) {
    await new Promise((r) => setTimeout(r, 3000));
    await Promise.all([one('india', 20000), one('us', 20000)]);
  }
  return live;
}

export default function CheatEntryPage() {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const [quotesState, setQuotesState] = useState<'loading' | 'live' | 'failed'>('loading');
  const [marketF, setMarketF] = useState<'ALL' | Market>('ALL');
  const [setupF, setSetupF] = useState<'ACTIONABLE' | 'ALL' | SetupKind>('ACTIONABLE');
  const [refreshTick, setRefreshTick] = useState(0);

  const build = useCallback(async () => {
    if (typeof window === 'undefined') return;
    // instant pass — synced prices, board up immediately
    const base = assemble(new Map());
    setCands(base.cands); setSkipped(base.skipped);
    // live pass — re-score once quotes land
    setQuotesState('loading');
    const live = await fetchLiveQuotes();
    if (live.size > 0) {
      const fresh = assemble(live);
      setCands(fresh.cands); setSkipped(fresh.skipped);
      setLiveCount(live.size); setQuotesState('live');
    } else {
      setLiveCount(0); setQuotesState('failed');
    }
  }, []);

  useEffect(() => { build(); }, [build, refreshTick]);

  const shown = useMemo(() => {
    if (!cands) return [];
    let r = cands;
    if (marketF !== 'ALL') r = r.filter((c) => c.market === marketF);
    if (setupF === 'ACTIONABLE') r = r.filter((c) => c.setup === 'AT_200' || c.setup === 'AT_50' || c.setup === 'AT_21');
    else if (setupF !== 'ALL') r = r.filter((c) => c.setup === setupF);
    return r;
  }, [cands, marketF, setupF]);

  const atSupport = useMemo(() => (cands || []).filter((c) => c.atSupportNow).length, [cands]);

  const chip = (active: boolean, color: string): React.CSSProperties => ({
    padding: '3px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
    border: `1px solid ${active ? color : C.border}`,
    background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
    color: active ? color : C.muted,
  });

  return (
    <div style={{ padding: '18px 20px', maxWidth: 1180, margin: '0 auto', fontFamily: MONO }}>
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.text }}>🥷 Cheat Entry</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {atSupport > 0 && (
            <span style={{ fontSize: 10.5, fontWeight: 800, color: C.green, border: `1px solid color-mix(in srgb, var(--mc-bullish) 40%, transparent)`, background: 'color-mix(in srgb, var(--mc-bullish) 10%, transparent)', borderRadius: 6, padding: '3px 9px' }}>
              🔥 {atSupport} at support NOW
            </span>
          )}
          <span style={{ fontSize: 9.5, fontWeight: 700, color: quotesState === 'live' ? C.green : quotesState === 'loading' ? C.dim : C.amber }}>
            {quotesState === 'live' ? `● live · ${liveCount.toLocaleString()} px` : quotesState === 'loading' ? '○ fetching live prices…' : '● quotes cold — synced px'}
          </span>
          <button onClick={() => setRefreshTick((x) => x + 1)} style={{ ...chip(false, C.cyan), background: 'transparent' }}>↻ REFRESH</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.6, maxWidth: 900 }}>
        The whole portal votes on <b style={{ color: C.text2 }}>what</b> to buy — Multibagger rankings, your Technicals universe, the Conviction bench.
        This board decides <b style={{ color: C.text2 }}>when</b>: every vetted name sitting on a rising 200 / 50 / 21-day line, ranked by
        <b style={{ color: C.text2 }}> setup + quality</b>. The nearer the line underneath, the smaller the stop — that&rsquo;s the cheat.
        The MAs refresh when you re-sync <Link href="/multibagger?tab=technicals-ind" style={{ color: C.cyan }}>India</Link> / <Link href="/multibagger?tab=technicals-usa" style={{ color: C.cyan }}>USA</Link> Technicals.
      </div>
      {quotesState === 'failed' && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: C.amber, border: `1px solid color-mix(in srgb, var(--mc-warn) 35%, transparent)`, background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', borderRadius: 6, padding: '6px 10px', maxWidth: 900 }}>
        ⚠ The live quote feed didn&rsquo;t answer in time (cold server cache — common right after a deploy). Distances below use your last Technicals-sync prices. Hit ↻ REFRESH in ~30s; the feed will be warm.
        </div>
      )}

      {/* ── filters ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {(['ALL', 'IND', 'USA'] as const).map((m) => (
          <button key={m} onClick={() => setMarketF(m)} style={chip(marketF === m, C.accent)}>{m === 'ALL' ? 'ALL MARKETS' : m === 'IND' ? '🇮🇳 INDIA' : '🇺🇸 USA'}</button>
        ))}
        <span style={{ width: 10 }} />
        <button onClick={() => setSetupF('ACTIONABLE')} style={chip(setupF === 'ACTIONABLE', C.green)}>✅ ACTIONABLE</button>
        {(['AT_200', 'AT_50', 'AT_21', 'DRIFT', 'EXTENDED'] as SetupKind[]).map((s) => (
          <button key={s} onClick={() => setSetupF(s)} style={chip(setupF === s, SETUP_META[s].color)}>{SETUP_META[s].label}</button>
        ))}
        <button onClick={() => setSetupF('ALL')} style={chip(setupF === 'ALL', C.muted)}>ALL</button>
      </div>

      {/* ── body ───────────────────────────────────────────────────────────── */}
      {cands == null ? (
        <div style={{ marginTop: 24, fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Building the board…</div>
      ) : cands.length === 0 ? (
        <div style={{ marginTop: 24, fontSize: 12, color: C.muted, lineHeight: 1.7, maxWidth: 760 }}>
          No rankable names yet. The board needs your <Link href="/multibagger?tab=technicals-ind" style={{ color: C.cyan }}>India</Link> /{' '}
          <Link href="/multibagger?tab=technicals-usa" style={{ color: C.cyan }}>USA Technicals</Link> rows (they carry each name&rsquo;s 50 &amp; 200-day averages)
          plus, optionally, the <Link href="/multibagger" style={{ color: C.cyan }}>Multibagger rankings</Link> and{' '}
          <Link href="/watchlists?tab=conviction" style={{ color: C.cyan }}>Conviction bench</Link> for the quality votes. Sync those once and this fills itself.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 10 }}>
            {shown.length} of {cands.length} ranked
            {skipped > 0 && <> · {skipped} quality name{skipped === 1 ? '' : 's'} without MA data (add to a Technicals list to rank)</>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
            {shown.slice(0, 60).map((c, i) => {
              const meta = SETUP_META[c.setup];
              const scoreCol = c.score >= 75 ? C.green : c.score >= 55 ? C.cyan : c.score >= 40 ? C.amber : C.muted;
              return (
                <div key={c.symbol + c.market} style={{ background: C.bg, border: `1px solid ${c.atSupportNow ? 'color-mix(in srgb, var(--mc-bullish) 45%, transparent)' : C.border}`, borderRadius: 9, padding: '9px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 900, color: C.dim, width: 22 }}>{i + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{c.symbol}</span>
                    <span style={{ fontSize: 9 }}>{c.market === 'IND' ? '🇮🇳' : '🇺🇸'}</span>
                    {c.atSupportNow && (
                      <span style={{ fontSize: 8.5, fontWeight: 900, color: C.green, letterSpacing: '0.4px' }}>
                        {c.testingSupport ? '🧪 TESTING SUPPORT' : '🔥 AT SUPPORT'}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{c.company}</span>
                    <span style={{ flex: 1 }} />
                    <span title={`Setup ${c.setupScore}/60 + Quality ${c.qualityScore}/40`} style={{ fontSize: 15, fontWeight: 900, color: scoreCol, fontVariantNumeric: 'tabular-nums' }}>{c.score}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6, paddingLeft: 30, fontSize: 9.5 }}>
                    <span title={meta.blurb} style={{ fontWeight: 800, color: meta.color, border: `1px solid color-mix(in srgb, ${meta.color} 40%, transparent)`, borderRadius: 4, padding: '1px 6px' }}>{meta.label}</span>
                    {c.d50 != null && <span style={{ color: Math.abs(c.d50) <= 3 ? C.green : C.muted, fontVariantNumeric: 'tabular-nums' }}>50DMA {c.d50 >= 0 ? '+' : ''}{c.d50.toFixed(1)}%</span>}
                    {c.d200 != null && <span style={{ color: Math.abs(c.d200) <= 4 ? C.cyan : C.muted, fontVariantNumeric: 'tabular-nums' }}>200DMA {c.d200 >= 0 ? '+' : ''}{c.d200.toFixed(1)}%</span>}
                    {c.d21 != null && <span style={{ color: C.dim, fontVariantNumeric: 'tabular-nums' }}>21EMA {c.d21 >= 0 ? '+' : ''}{c.d21.toFixed(1)}%</span>}
                    {c.riskPct != null && c.stopMa && (
                      <span title={`Stop 2% under the ${c.stopMa} you are buying against — a cheat entry works because the exit is close`} style={{ fontWeight: 800, color: c.riskPct <= 4 ? C.green : c.riskPct <= 8 ? C.amber : C.red, fontVariantNumeric: 'tabular-nums' }}>
                        risk {c.riskPct.toFixed(1)}% (stop&lt;{c.stopMa})
                      </span>
                    )}
                    {c.dayChg != null && <span style={{ color: c.dayChg >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>{c.dayChg >= 0 ? '+' : ''}{c.dayChg.toFixed(1)}% today</span>}
                    {!c.priceIsLive && quotesState === 'live' && <span title="No live quote for this symbol — using the price from your last Technicals sync" style={{ color: C.dim }}>· synced px</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5, paddingLeft: 30 }}>
                    {c.sources.map((s, k) => (
                      <span key={k} style={{ fontSize: 8.5, fontWeight: 700, color: C.text2, background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 4, padding: '1px 6px' }}>{s}</span>
                    ))}
                    {c.sector && <span style={{ fontSize: 8.5, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 6px' }}>{c.sector}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {shown.length > 60 && <div style={{ fontSize: 10, color: C.dim, marginTop: 8 }}>Top 60 shown of {shown.length} — tighten the filters to see the rest.</div>}
          <div style={{ fontSize: 9.5, color: C.dim, marginTop: 14, lineHeight: 1.6, maxWidth: 880 }}>
            How to read it: <b style={{ color: C.muted }}>score = setup (0-60) + quality (0-40)</b>. The setup is the NEAREST qualifying pivot
            (200DMA scores highest, then 50DMA, then 21EMA); names &gt;15% above the 50DMA are extended, names graded &lt;45 by the Multibagger
            engine are excluded outright unless the Conviction bench vouches for a fresh quarter. <b style={{ color: C.muted }}>risk</b> is the drop
            to a stop placed 2% under the pivot you&rsquo;re buying against — the whole cheat is that this number is small. 🧪 = price is 1-3% under the
            pivot (support being tested, slightly discounted); 🔥 = sitting within ±1% of it. Nothing here is a recommendation; it&rsquo;s your own
            research, sorted by where the entry is cheapest.
          </div>
        </>
      )}
    </div>
  );
}
