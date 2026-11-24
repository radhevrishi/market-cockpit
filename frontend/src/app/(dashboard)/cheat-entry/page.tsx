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

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { getConvictionList } from '@/lib/conviction-beats';
import { openPassport } from '@/lib/engines';     // zzz524 — click a ticker → Stock Passport
import { logSignals } from '@/lib/signal-log';    // zzz524 — feed the Signal Scoreboard
import Sparkline from '@/components/Sparkline';    // zzz536 — inline price trend
import { cheatSetup, type CheatSetupKind, type CheatStopMa } from '@/lib/cheat-entry-setup';   // zzz1061

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', bg3: 'var(--mc-bg-3)',
  border: 'var(--mc-border-1)', border2: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', text2: 'var(--mc-text-2)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: 'var(--mc-warn)', cyan: 'var(--mc-cyan)', accent: 'var(--mc-accent)',
};

const EXCLUDE = new Set(['SPY', 'QQQ', 'QQQM', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'SPX', 'NDX', 'RUT', 'NIFTY', 'NIFTYBEES', 'BANKBEES', 'GOLDBEES', 'JUNIORBEES', 'SETFNIF50']);

type Market = 'IND' | 'USA';
type SetupKind = CheatSetupKind;
type StopMa = CheatStopMa;

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

    // zzz1061 — the setup rules live in lib/cheat-entry-setup.ts (the price alerts use the same rules)
    const cs = cheatSetup(livePrice, t.sma50, t.sma200);
    if (!cs) continue; // clearly below the 200DMA = broken chart, not a dip
    const { d50, d200, setup, setupScore, stopMa, riskPct, testingSupport, atSupportNow } = cs;
    const d21 = t.ema21 != null && t.ema21 > 0 ? (livePrice - t.ema21) / t.ema21 * 100 : null;

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
  const [sparks, setSparks] = useState<Map<string, number[]>>(new Map()); // zzz536 — inline price context

  const runRef = useRef(0);       // zzz530 — newest build wins; stale async can't clobber
  const aliveRef = useRef(true);  // zzz530 — no setState after unmount
  const build = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const run = ++runRef.current;
    // instant pass — synced prices, board up immediately
    const base = assemble(new Map());
    if (!aliveRef.current || run !== runRef.current) return;
    setCands(base.cands); setSkipped(base.skipped);
    // live pass — re-score once quotes land
    setQuotesState('loading');
    const live = await fetchLiveQuotes();
    if (!aliveRef.current || run !== runRef.current) return; // a newer REFRESH superseded us
    if (live.size > 0) {
      const fresh = assemble(live);
      setCands(fresh.cands); setSkipped(fresh.skipped);
      setLiveCount(live.size); setQuotesState('live');
      // zzz524 — log today's top actionable setups for the scoreboard
      try {
        logSignals('cheat-entry', fresh.cands
          .filter((c) => c.setup === 'AT_200' || c.setup === 'AT_50')
          .slice(0, 10)
          .map((c) => ({ ticker: c.symbol, note: `${c.setupLabel} score ${c.score}`, priceAt: c.livePrice })));
      } catch { /* never load-bearing */ }
      // zzz536 — decorate the board with sparklines via the existing /api/market/spark route
      try {
        const syms = fresh.cands.slice(0, 24).map((c) => c.symbol);
        if (syms.length) {
          const ctl = new AbortController();
          const to = setTimeout(() => ctl.abort(), 12000);
          const r = await fetch(`/api/market/spark?symbols=${encodeURIComponent(syms.join(','))}`, { cache: 'no-store', signal: ctl.signal });
          clearTimeout(to);
          if (r.ok && aliveRef.current && run === runRef.current) {
            const j = await r.json();
            const m = new Map<string, number[]>();
            for (const row of (Array.isArray(j?.rows) ? j.rows : [])) {
              const sym = String(row?.symbol || '').toUpperCase();
              if (sym && Array.isArray(row?.spark) && row.spark.length >= 3) m.set(sym, row.spark);
            }
            if (aliveRef.current && run === runRef.current) setSparks(m);
          }
        }
      } catch { /* sparks are decorative */ }
    } else {
      setLiveCount(0); setQuotesState('failed');
    }
  }, []);

  useEffect(() => { aliveRef.current = true; build(); return () => { aliveRef.current = false; }; }, [build, refreshTick]);

  const shown = useMemo(() => {
    if (!cands) return [];
    let r = cands;
    if (marketF !== 'ALL') r = r.filter((c) => c.market === marketF);
    if (setupF === 'ACTIONABLE') r = r.filter((c) => c.setup === 'AT_200' || c.setup === 'AT_50');
    else if (setupF !== 'ALL') r = r.filter((c) => c.setup === setupF);
    return r;
  }, [cands, marketF, setupF]);

  const atSupport = useMemo(() => (cands || []).filter((c) => c.atSupportNow).length, [cands]);

  const chip = (active: boolean, color: string): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
    border: `1px solid ${active ? color : C.border}`,
    background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : 'transparent',
    color: active ? color : C.muted,
  });

  // zzz1301n — chart structure per row (trendlines / breakout + retest / cups, graded like Options Ideas), loaded for the rows shown
  const [briefs, setBriefs] = useState<Map<string, any>>(new Map());
  const [sortK, setSortK] = useState<'score' | 'risk' | 'd50' | 'd200' | 'struct' | 'today'>('score');
  const top = useMemo(() => shown.slice(0, 60), [shown]);
  useEffect(() => {
    let off = false;
    const need = top.filter((c) => !briefs.has(`${c.market}:${c.symbol}`));
    if (!need.length) return;
    (async () => {
      const groups: Array<{ m: 'US' | 'IN'; t: string[] }> = [];
      for (const mk of ['IND', 'USA'] as const) {
        const ts = need.filter((c) => c.market === mk).map((c) => c.symbol);
        for (let i = 0; i < ts.length; i += 12) groups.push({ m: mk === 'IND' ? 'IN' : 'US', t: ts.slice(i, i + 12) });
      }
      let gi = 0;
      await Promise.all([0, 1].map(async () => {
        while (gi < groups.length && !off) {
          const g = groups[gi++];
          const j = await fetch(`/api/v1/options-ideas?market=${g.m}&structure=1&tickers=${encodeURIComponent(g.t.join(','))}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (off || !j?.briefs) continue;
          setBriefs((prev) => { const m = new Map(prev); for (const b of j.briefs) m.set(`${g.m === 'IN' ? 'IND' : 'USA'}:${b.ticker}`, b); return m; });
        }
      }));
    })();
    return () => { off = true; };
  }, [top]); // eslint-disable-line react-hooks/exhaustive-deps

  const structRank = (b: any) => (!b ? 9 : b.best ? ({ 'A+': 0, A: 1, B: 2, C: 4 } as any)[b.best.grade] ?? 5 : b.lines + b.levels > 0 ? 6 : 8);
  const rows = useMemo(() => {
    const r = [...top];
    const key = (c: Candidate): number => {
      const b = briefs.get(`${c.market}:${c.symbol}`);
      switch (sortK) {
        case 'risk': return c.riskPct ?? 99;
        case 'd50': return Math.abs(c.d50 ?? 99);
        case 'd200': return Math.abs(c.d200 ?? 99);
        case 'struct': return structRank(b);
        case 'today': return -(c.dayChg ?? -99);
        default: return -c.score;
      }
    };
    return r.sort((a, b) => key(a) - key(b));
  }, [top, sortK, briefs]);

  const th: React.CSSProperties = { padding: '8px 8px', textAlign: 'left', fontSize: 11.5, fontWeight: 800, color: C.muted, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.bg };
  const td: React.CSSProperties = { padding: '8px 8px', fontSize: 13, borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle', fontVariantNumeric: 'tabular-nums' };
  const H = ({ k, children, title }: { k?: typeof sortK; children: any; title?: string }) => (
    <th style={{ ...th, cursor: k ? 'pointer' : 'default', color: k && sortK === k ? C.cyan : C.muted }} title={title} onClick={() => k && setSortK(k)}>{children}{k && sortK === k ? ' ▼' : ''}</th>
  );
  const pct = (x: number | null, d = 1) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(d)}%`);
  const GCOL: Record<string, string> = { 'A+': '#A855F7', A: 'var(--mc-bullish)', B: 'var(--mc-warn)', C: 'var(--mc-bearish)' };

  return (
    <div style={{ padding: '16px 20px', width: '100%', boxSizing: 'border-box' }}>
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: C.text }}>🥷 Cheat Entry</h1>
        <span style={{ fontSize: 13.5, color: C.muted }}>Quality names sitting on a rising 50- or 200-day average — the entry where the stop is closest.</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {atSupport > 0 && <span style={{ fontSize: 13, fontWeight: 800, color: C.green, border: `1px solid color-mix(in srgb, var(--mc-bullish) 40%, transparent)`, borderRadius: 8, padding: '4px 10px' }}>🔥 {atSupport} at support now</span>}
          <span style={{ fontSize: 12, fontWeight: 700, color: quotesState === 'live' ? C.green : quotesState === 'loading' ? C.dim : C.amber }}>
            {quotesState === 'live' ? `● live prices (${liveCount.toLocaleString()})` : quotesState === 'loading' ? '○ fetching live prices…' : '● live prices not reached — using synced prices'}
          </span>
          <button onClick={() => setRefreshTick((x) => x + 1)} style={chip(false, C.cyan)}>↻ Refresh</button>
        </div>
      </div>
      {quotesState === 'failed' && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: C.amber, border: `1px solid color-mix(in srgb, var(--mc-warn) 35%, transparent)`, borderRadius: 8, padding: '6px 10px' }}>
          ⚠ The live quote feed didn&rsquo;t answer in time (common right after a deploy). Distances use your last Technicals-sync prices. Refresh in ~30 s.
        </div>
      )}

      {/* ── filters ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        {(['ALL', 'IND', 'USA'] as const).map((m) => (
          <button key={m} onClick={() => setMarketF(m)} style={chip(marketF === m, C.accent)}>{m === 'ALL' ? 'All markets' : m === 'IND' ? '🇮🇳 India' : '🇺🇸 USA'}</button>
        ))}
        <span style={{ width: 10 }} />
        <button onClick={() => setSetupF('ACTIONABLE')} style={chip(setupF === 'ACTIONABLE', C.green)}>✅ Actionable</button>
        {(['AT_200', 'AT_50'] as SetupKind[]).map((s) => (
          <button key={s} onClick={() => setSetupF(s)} style={chip(setupF === s, SETUP_META[s].color)}>{SETUP_META[s].label}</button>
        ))}
        <button onClick={() => setSetupF('ALL')} style={chip(setupF === 'ALL', C.muted)}>All</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.dim }}>
          {cands ? `${shown.length} of ${cands.length} ranked` : ''}{skipped > 0 ? ` · ${skipped} quality names without moving-average data (add them to a Technicals list)` : ''}
        </span>
      </div>

      {/* ── body ───────────────────────────────────────────────────────────── */}
      {cands == null ? (
        <div style={{ marginTop: 24, fontSize: 13, color: C.muted, fontStyle: 'italic' }}>Building the board…</div>
      ) : cands.length === 0 ? (
        <div style={{ marginTop: 24, fontSize: 13, color: C.muted, lineHeight: 1.7 }}>
          No rankable names yet. The board needs your <Link href="/multibagger?tab=technicals-ind" style={{ color: C.cyan }}>India</Link> /{' '}
          <Link href="/multibagger?tab=technicals-usa" style={{ color: C.cyan }}>USA Technicals</Link> rows (they carry each name&rsquo;s 50 &amp; 200-day averages)
          plus, optionally, the <Link href="/multibagger" style={{ color: C.cyan }}>Multibagger rankings</Link> and{' '}
          <Link href="/watchlists?tab=conviction" style={{ color: C.cyan }}>Conviction bench</Link>.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 10, overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, background: C.bg }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <thead><tr>
                <H>#</H><H>Company</H><H k="score" title="Setup (0–60) + quality (0–40)">Score</H><H>Entry type</H>
                <H k="d50" title="Distance from the 50-day average">vs 50-day</H><H k="d200" title="Distance from the 200-day average">vs 200-day</H>
                <H k="risk" title="Drop to a stop 2% under the average you are buying against">Stop risk</H><H k="today">Today</H><H>3-month trend</H>
                <H k="struct" title="Trendlines / breakout + retest / cups on the chart, graded like Options Ideas (A+ best). Sort to put the most interesting charts first.">Chart structure</H>
                <H>Quality</H><H>Sector</H><H>Open</H>
              </tr></thead>
              <tbody>
                {rows.map((c, i) => {
                  const meta = SETUP_META[c.setup];
                  const scoreCol = c.score >= 75 ? C.green : c.score >= 55 ? C.cyan : c.score >= 40 ? C.amber : C.muted;
                  const b = briefs.get(`${c.market}:${c.symbol}`);
                  const m = c.market === 'IND' ? 'IN' : 'US';
                  return (
                    <tr key={c.symbol + c.market} style={{ background: c.atSupportNow ? 'color-mix(in srgb, var(--mc-bullish) 6%, transparent)' : undefined }}>
                      <td style={{ ...td, color: C.dim, width: 28 }}>{i + 1}</td>
                      <td style={{ ...td, minWidth: 200 }}>
                        <span onClick={() => openPassport(c.symbol)} title="Open Stock Passport" style={{ fontWeight: 900, cursor: 'pointer', color: C.text }}>{c.symbol}</span>
                        <span style={{ marginLeft: 5, fontSize: 11 }}>{c.market === 'IND' ? '🇮🇳' : '🇺🇸'}</span>
                        {c.atSupportNow && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 900, color: C.green }}>{c.testingSupport ? '🧪 testing support' : '🔥 at support'}</span>}
                        <div style={{ fontSize: 11.5, color: C.muted, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company}</div>
                      </td>
                      <td style={{ ...td, fontWeight: 900, fontSize: 15, color: scoreCol }} title={`Setup ${c.setupScore}/60 + Quality ${c.qualityScore}/40`}>{c.score}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}><span title={meta.blurb} style={{ fontWeight: 800, color: meta.color }}>{meta.label}</span></td>
                      <td style={{ ...td, color: c.d50 != null && Math.abs(c.d50) <= 3 ? C.green : C.text2 }}>{pct(c.d50)}</td>
                      <td style={{ ...td, color: c.d200 != null && Math.abs(c.d200) <= 4 ? C.cyan : C.text2 }}>{pct(c.d200)}</td>
                      <td style={{ ...td, fontWeight: 800, color: c.riskPct == null ? C.muted : c.riskPct <= 4 ? C.green : c.riskPct <= 8 ? C.amber : C.red }} title={c.stopMa ? `Stop 2% under the ${c.stopMa}` : ''}>{c.riskPct != null ? `${c.riskPct.toFixed(1)}%` : '—'}{c.stopMa ? <span style={{ fontSize: 10.5, color: C.dim, fontWeight: 600 }}> under {c.stopMa}</span> : null}</td>
                      <td style={{ ...td, color: c.dayChg == null ? C.dim : c.dayChg >= 0 ? C.green : C.red }}>{c.dayChg != null ? pct(c.dayChg) : (quotesState === 'live' ? <span title="No live quote — synced price">synced</span> : '—')}</td>
                      <td style={td}>{sparks.get(c.symbol) ? <Sparkline data={sparks.get(c.symbol)} width={80} height={22} /> : <span style={{ color: C.dim }}>—</span>}</td>
                      <td style={{ ...td, minWidth: 190 }}>
                        {!b ? <span style={{ color: C.dim, fontSize: 12 }}>reading chart…</span>
                          : !b.ok ? <span style={{ color: C.dim, fontSize: 12 }}>no chart data</span>
                          : b.best ? <span title={`${b.setups} setup(s) found on the chart — open Options Ideas for the full plan`}><b style={{ color: '#fff', background: GCOL[b.best.grade] || '#64748B', borderRadius: 5, padding: '1px 6px', fontSize: 12 }}>{b.best.grade}</b> <span style={{ fontWeight: 700 }}>{b.best.label}</span>{b.setups > 1 ? <span style={{ color: C.dim, fontSize: 11.5 }}> +{b.setups - 1}</span> : null}</span>
                          : b.lines + b.levels > 0 ? <span style={{ fontSize: 12, color: C.text2 }} title={b.nearest || ''}>{b.lines} line{b.lines === 1 ? '' : 's'} · {b.levels} level{b.levels === 1 ? '' : 's'}{b.nearestPct != null ? <span style={{ color: C.dim }}> · nearest {b.nearestPct > 0 ? '+' : ''}{b.nearestPct}%</span> : null}</span>
                          : <span style={{ color: C.dim, fontSize: 12 }}>no clean structure</span>}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {c.sources.filter((s) => !s.startsWith('Tech')).map((s, k) => <span key={k} style={{ fontSize: 11, fontWeight: 700, color: C.text2, background: C.bg2, border: `1px solid ${C.border2}`, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>{s}</span>)}
                        </div>
                      </td>
                      <td style={{ ...td, fontSize: 12, color: C.muted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sector || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <a href={`/charts?m=${m}&t=${encodeURIComponent(c.symbol)}`} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan, fontWeight: 700, textDecoration: 'none' }} title="Open the chart">📈 Chart</a>
                        <a href={`/options-ideas?view=one&ticker=${encodeURIComponent(c.symbol)}`} onClick={() => { try { localStorage.setItem('mc:options-ideas:market:v1', JSON.stringify(m)); } catch { /* */ } }} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan, fontWeight: 700, textDecoration: 'none', marginLeft: 10 }} title="Trendlines, setups and the option plan">🎯 Setups</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length > 60 && <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>Top 60 shown of {shown.length} — narrow the filters to see the rest.</div>}
          <div style={{ fontSize: 12, color: C.dim, marginTop: 12, lineHeight: 1.6 }}>
            <b style={{ color: C.muted }}>Score</b> = setup (0–60) + quality (0–40). The setup is the nearest rising average underneath (200-day scores highest, then 50-day); names more than 15% above the 50-day are extended; names graded below 45 by the Multibagger engine are left out unless the Conviction bench vouches.
            <b style={{ color: C.muted }}> Stop risk</b> = the drop to a stop 2% under that average — small is the point. 🔥 within ±1% of it; 🧪 1–3% under it.
            <b style={{ color: C.muted }}> Chart structure</b> = trendlines, 3-touch levels and cups found on the daily chart, graded like Options Ideas — sort by it to open the most interesting charts first. Not a recommendation.
          </div>
        </>
      )}
    </div>
  );
}
