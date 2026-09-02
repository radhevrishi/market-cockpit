'use client';

// ════════════════════════════════════════════════════════════════════════════
// 🥷 CHEAT ENTRY (zzz522) — the timing desk for the whole portal.
// ────────────────────────────────────────────────────────────────────────────
// Every other engine answers WHAT to buy: the India/USA Multibagger rankings
// (fundamental composite + grade), the India/USA Technicals universe (your
// curated TradingView lists), and the Conviction Beats bench (BB/STRONG
// earnings winners). This tab answers WHEN: it merges all of those into one
// elite universe, then ranks the names sitting ON a rising moving average —
// the institutional add point where the stop is nearest and the risk is
// smallest. "Cheat entry" = quality name + support underneath + tiny risk.
//
// Score = SETUP (0-60: how perfectly it sits on the 200/50/21 pivot, in an
// uptrend, not extended) + QUALITY (0-40: fundo composite, bench tier, and a
// multi-engine agreement bonus). Distances use LIVE prices (both markets)
// against the stored MAs, so the board moves with the market — the MAs
// themselves refresh whenever you re-sync the Technicals tabs.
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

// Index/benchmark ETFs are not cheat-entry candidates.
const EXCLUDE = new Set(['SPY', 'QQQ', 'QQQM', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'SPX', 'NDX', 'RUT', 'NIFTY', 'NIFTYBEES', 'BANKBEES', 'GOLDBEES', 'JUNIORBEES', 'SETFNIF50']);

type Market = 'IND' | 'USA';
type SetupKind = 'AT_200' | 'AT_50' | 'AT_21' | 'DRIFT' | 'EXTENDED';

interface Candidate {
  symbol: string; market: Market;
  company: string; sector: string;
  livePrice: number; priceIsLive: boolean; dayChg: number | null;
  ema21: number | null; sma50: number | null; sma200: number | null;
  d21: number | null; d50: number | null; d200: number | null;   // % of live price above each MA
  setup: SetupKind; setupLabel: string; atSupportNow: boolean;
  stopMa: '50DMA' | '200DMA' | null; riskPct: number | null;      // distance down to the MA under price
  fundoScore: number | null; fundoGrade: string | null;
  benchTier: 'BLOCKBUSTER' | 'STRONG' | null;
  sources: string[];            // which engines vouch
  setupScore: number; qualityScore: number; score: number;
}

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

export default function CheatEntryPage() {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [unranked, setUnranked] = useState<{ bench: number; fundo: number }>({ bench: 0, fundo: 0 });
  const [liveCount, setLiveCount] = useState(0);
  const [marketF, setMarketF] = useState<'ALL' | Market>('ALL');
  const [setupF, setSetupF] = useState<'ACTIONABLE' | 'ALL' | SetupKind>('ACTIONABLE');
  const [refreshTick, setRefreshTick] = useState(0);

  const build = useCallback(async () => {
    if (typeof window === 'undefined') return;

    // ── 1 · fundamentals (Multibagger rankings, both markets) ────────────────
    const fundo = new Map<string, { score: number | null; grade: string | null; sector?: string; market: Market }>();
    for (const [key, market] of [['mb_excel_scored_v2', 'IND'], ['mb_usa_scored_v2', 'USA']] as [string, Market][]) {
      const rows = readJSON(key);
      if (Array.isArray(rows)) for (const r of rows) {
        const s = norm(r?.symbol); if (!s || EXCLUDE.has(s)) continue;
        fundo.set(s, { score: num(r?.score), grade: r?.grade ? String(r.grade) : null, sector: r?.sector || r?.industry, market });
      }
    }

    // ── 2 · conviction bench (BB / STRONG earnings winners) ──────────────────
    const bench = new Map<string, { tier: 'BLOCKBUSTER' | 'STRONG'; company: string; sector?: string }>();
    try {
      for (const e of getConvictionList()) {
        const s = norm(e?.ticker); if (!s || EXCLUDE.has(s)) continue;
        if (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG') bench.set(s, { tier: e.tier, company: e.company || '', sector: (e as any).sector });
      }
    } catch { /* bench unreadable */ }

    // ── 3 · technicals universe (carries the MAs — the core of the ranking) ──
    interface TechRaw { market: Market; price: number | null; ema21: number | null; sma50: number | null; sma200: number | null; sector?: string; company?: string; rs?: number | null; }
    const tech = new Map<string, TechRaw>();
    for (const [key, market] of [['mb_tech_rows_ind_v1', 'IND'], ['mb_tech_rows_usa_v1', 'USA']] as [string, Market][]) {
      const rows = readJSON(key);
      if (Array.isArray(rows)) for (const r of rows) {
        const s = norm(r?.symbol || r?.ticker); if (!s || EXCLUDE.has(s) || tech.has(s)) continue;
        tech.set(s, {
          market,
          price: num(r?.price), ema21: num(r?.ema21), sma50: num(r?.sma50), sma200: num(r?.sma200),
          sector: r?.sector || r?.industry, company: r?.description || r?.company || r?.name,
          rs: num(r?.rsRating ?? r?.rs_rating ?? r?.rs),
        });
      }
    }

    // ── 4 · live prices, both markets (the lesson from the pullback fix:
    //        never rank on a frozen snapshot) ─────────────────────────────────
    const live = new Map<string, { price: number; chg: number | null; company?: string }>();
    await Promise.all((['india', 'us'] as const).map(async (m) => {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
        const r = await fetch(`/api/market/quotes?market=${m}&fields=ticker,price,changePercent,company`, { cache: 'no-store', signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) return;
        const j = await r.json();
        const stocks = Array.isArray(j?.stocks) ? j.stocks : [];
        for (const s of stocks) {
          const sym = norm(s?.ticker); const p = num(s?.price);
          if (sym && p != null && p > 0 && !live.has(sym)) live.set(sym, { price: p, chg: num(s?.changePercent), company: s?.company });
        }
      } catch { /* one market cold — fine */ }
    }));
    setLiveCount(live.size);

    // ── 5 · assemble + score ─────────────────────────────────────────────────
    const universe = new Set<string>([...tech.keys(), ...fundo.keys(), ...bench.keys()]);
    const out: Candidate[] = [];
    let unrankedBench = 0, unrankedFundo = 0;
    for (const sym of universe) {
      const t = tech.get(sym);
      const f = fundo.get(sym) || null;
      const b = bench.get(sym) || null;
      // MA data is the spine — a name without technicals rows can't be ranked.
      if (!t || t.sma50 == null || t.sma200 == null || t.sma50 <= 0 || t.sma200 <= 0) {
        if (b) unrankedBench++; else if (f && (f.score ?? 0) >= 60) unrankedFundo++;
        continue;
      }
      const lq = live.get(sym);
      const livePrice = lq?.price ?? t.price ?? null;
      if (livePrice == null || livePrice <= 0) continue;

      const d200 = (livePrice - t.sma200) / t.sma200 * 100;
      const d50 = (livePrice - t.sma50) / t.sma50 * 100;
      const d21 = t.ema21 != null && t.ema21 > 0 ? (livePrice - t.ema21) / t.ema21 * 100 : null;

      // Uptrend gate: allow a 3% undercut of the 200DMA (a retest often pierces),
      // but a name clearly below its 200DMA is a broken chart, not a cheat entry.
      if (d200 < -3) continue;

      // ── setup classification + setup score (0-60) ──────────────────────────
      let setup: SetupKind; let setupScore: number;
      if (d50 > 15) { setup = 'EXTENDED'; setupScore = 3; }
      else if (d200 >= -3 && d200 <= 5) { setup = 'AT_200'; setupScore = Math.max(30, 60 - Math.abs(d200 - 1) * 4); }
      else if (d50 >= -3 && d50 <= 5) { setup = 'AT_50'; setupScore = Math.max(26, 52 - Math.abs(d50 - 1) * 4); }
      else if (d21 != null && d21 >= -2 && d21 <= 4) { setup = 'AT_21'; setupScore = Math.max(22, 44 - Math.abs(d21 - 1) * 4); }
      else { setup = 'DRIFT'; const nearest = Math.min(Math.abs(d50), Math.abs(d200), d21 != null ? Math.abs(d21) : 99); setupScore = Math.max(0, 22 - nearest * 1.5); }
      // Golden structure bonus: 50DMA above 200DMA = established uptrend.
      if (t.sma50 > t.sma200) setupScore = Math.min(60, setupScore + 4);

      // ── quality score (0-40) ───────────────────────────────────────────────
      const sources: string[] = [];
      sources.push(`Tech ${t.market === 'IND' ? '🇮🇳' : '🇺🇸'}`);
      if (f && f.score != null) sources.push(`Fundo ${Math.round(f.score)}${f.grade ? ` (${f.grade})` : ''}`);
      if (b) sources.push(b.tier === 'BLOCKBUSTER' ? 'CB · BB' : 'CB · STRONG');
      let quality = 0;
      quality += f && f.score != null ? Math.min(22, (f.score / 100) * 22) : 6; // tech-only base 6
      quality += b ? (b.tier === 'BLOCKBUSTER' ? 10 : 7) : 0;
      if (t.rs != null && t.rs >= 80) quality += 3;                              // momentum leadership
      const engineCount = 1 + (f && f.score != null ? 1 : 0) + (b ? 1 : 0);
      if (engineCount >= 2) quality += engineCount >= 3 ? 8 : 5;                 // agreement bonus
      quality = Math.min(40, quality);

      // ── risk to the MA underneath (the "cheat" = the stop is right there) ──
      let stopMa: Candidate['stopMa'] = null; let riskPct: number | null = null;
      const below: Array<['50DMA' | '200DMA', number]> = [];
      if (t.sma50 < livePrice) below.push(['50DMA', t.sma50]);
      if (t.sma200 < livePrice) below.push(['200DMA', t.sma200]);
      if (below.length) {
        below.sort((a, bb) => bb[1] - a[1]); // highest MA below price = nearest stop
        stopMa = below[0][0]; riskPct = (livePrice - below[0][1]) / livePrice * 100;
      }

      const atSupportNow = Math.min(Math.abs(d50), Math.abs(d200), d21 != null ? Math.abs(d21) : 99) <= 1;

      out.push({
        symbol: sym, market: t.market,
        company: b?.company || lq?.company || t.company || '',
        sector: String(f?.sector || t.sector || b?.sector || ''),
        livePrice, priceIsLive: !!lq, dayChg: lq?.chg ?? null,
        ema21: t.ema21, sma50: t.sma50, sma200: t.sma200,
        d21, d50, d200,
        setup, setupLabel: SETUP_META[setup].label, atSupportNow,
        stopMa, riskPct,
        fundoScore: f?.score ?? null, fundoGrade: f?.grade ?? null,
        benchTier: b?.tier ?? null, sources,
        setupScore: Math.round(setupScore), qualityScore: Math.round(quality),
        score: Math.round(setupScore + quality),
      });
    }
    out.sort((a, b) => b.score - a.score || (a.riskPct ?? 99) - (b.riskPct ?? 99));
    setCands(out);
    setUnranked({ bench: unrankedBench, fundo: unrankedFundo });
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

  const atSupport = useMemo(() => (cands || []).filter((c) => c.atSupportNow && c.setup !== 'EXTENDED').length, [cands]);

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
          <button onClick={() => setRefreshTick((x) => x + 1)} style={{ ...chip(false, C.cyan), background: 'transparent' }}>↻ REFRESH</button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.6, maxWidth: 900 }}>
        The whole portal votes on <b style={{ color: C.text2 }}>what</b> to buy — Multibagger rankings, your Technicals universe, the Conviction bench.
        This board decides <b style={{ color: C.text2 }}>when</b>: every vetted name sitting on a rising 200 / 50 / 21-day line, ranked by
        <b style={{ color: C.text2 }}> setup + quality</b>. The nearer the line underneath, the smaller the stop — that&rsquo;s the cheat.
        Distances use live prices; the MAs refresh when you re-sync <Link href="/multibagger?tab=technicals-ind" style={{ color: C.cyan }}>India</Link> / <Link href="/multibagger?tab=technicals-usa" style={{ color: C.cyan }}>USA</Link> Technicals.
      </div>

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
        <div style={{ marginTop: 24, fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Building the board — merging engines + fetching live prices…</div>
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
            {shown.length} of {cands.length} ranked · live prices for {liveCount.toLocaleString()} symbols
            {(unranked.bench + unranked.fundo) > 0 && (
              <> · {unranked.bench + unranked.fundo} quality name{unranked.bench + unranked.fundo === 1 ? '' : 's'} skipped (no MA data — add them to a Technicals list to rank them)</>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
            {shown.slice(0, 60).map((c, i) => {
              const meta = SETUP_META[c.setup];
              const scoreCol = c.score >= 75 ? C.green : c.score >= 55 ? C.cyan : c.score >= 40 ? C.amber : C.muted;
              return (
                <div key={c.symbol + c.market} style={{ background: C.bg, border: `1px solid ${c.atSupportNow && c.setup !== 'EXTENDED' ? 'color-mix(in srgb, var(--mc-bullish) 45%, transparent)' : C.border}`, borderRadius: 9, padding: '9px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 900, color: C.dim, width: 22 }}>{i + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{c.symbol}</span>
                    <span style={{ fontSize: 9 }}>{c.market === 'IND' ? '🇮🇳' : '🇺🇸'}</span>
                    {c.atSupportNow && c.setup !== 'EXTENDED' && (
                      <span style={{ fontSize: 8.5, fontWeight: 900, color: C.green, letterSpacing: '0.4px' }}>🔥 AT SUPPORT</span>
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
                      <span title={`Stop just under the ${c.stopMa} — the whole point of a cheat entry is that the exit is close`} style={{ fontWeight: 800, color: c.riskPct <= 4 ? C.green : c.riskPct <= 8 ? C.amber : C.red, fontVariantNumeric: 'tabular-nums' }}>
                        risk→{c.stopMa} {c.riskPct.toFixed(1)}%
                      </span>
                    )}
                    {c.dayChg != null && <span style={{ color: c.dayChg >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>{c.dayChg >= 0 ? '+' : ''}{c.dayChg.toFixed(1)}% today</span>}
                    {!c.priceIsLive && <span title="Live quote unavailable — using the price from your last Technicals sync" style={{ color: C.dim }}>· synced px</span>}
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
          <div style={{ fontSize: 9.5, color: C.dim, marginTop: 14, lineHeight: 1.6, maxWidth: 860 }}>
            How to read it: <b style={{ color: C.muted }}>score = setup (0-60) + quality (0-40)</b>. Setup peaks when price sits ~1% above a rising
            200DMA (deepest pivot), then the 50DMA, then the 21EMA; names &gt;15% above the 50DMA are marked extended. Quality blends the
            Multibagger composite, Conviction tier, RS leadership, and an agreement bonus when several engines back the same name.
            <b style={{ color: C.muted }}> risk→MA</b> is the drop to the nearest average below price — your natural stop distance. Nothing here is a
            recommendation; it&rsquo;s your own research, sorted by where the entry is cheapest.
          </div>
        </>
      )}
    </div>
  );
}
