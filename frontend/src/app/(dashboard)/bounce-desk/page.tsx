'use client';

// ════════════════════════════════════════════════════════════════════════════
// 🌊 Bounce Desk — oversold-bounce scanner from the Bounce Playbook.
// Regime-gated: BEAR locks the single-name lane entirely. Candidates come
// only from names the portal's engines already trust; falling knives (broken
// 200DMA charts, high-severity decay, weak fundo with no bench) are refused.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { getEngineViews, openPassport, type EngineView, type Market } from '@/lib/engines';
import { logSignals } from '@/lib/signal-log';
import { suggestSize, fmtMoney } from '@/lib/sizing';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

type RegimeKind = 'BULL' | 'PULLBACK' | 'CORRECTION' | 'BEAR' | 'RECOVERY' | 'UNKNOWN';
interface RegimeSide { kind: RegimeKind; note?: string; drawdownPct?: number; above200?: number }

interface Candidate {
  v: EngineView;
  score: number;
  price: number;       // live if available, else tech price
  livePrice: number | null;
  chg: number | null;
  d21: number | null;  // % vs ema21 (null when no ema21)
  d50: number;         // % vs sma50 (always computed — sma50 is required)
  d200: number;        // % vs sma200 (always computed — sma200 is required)
}

async function fetchQuotes(market: 'india' | 'us'): Promise<Map<string, { price: number; chg: number | null }>> {
  const out = new Map<string, { price: number; chg: number | null }>();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`/api/market/quotes?market=${market}&fields=ticker,price,changePercent`, { signal: ctrl.signal });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.stocks)) for (const s of data.stocks) {
        const t = String(s?.ticker || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '');
        const p = Number(s?.price);
        if (t && Number.isFinite(p) && p > 0) {
          out.set(t, { price: p, chg: Number.isFinite(Number(s?.changePercent)) ? Number(s.changePercent) : null });
        }
      }
    }
  } catch { /* tolerate */ } finally { clearTimeout(timer); }
  return out;
}

function buildCandidates(views: Map<string, EngineView>, live: Map<string, { price: number; chg: number | null }>, market: Market): Candidate[] {
  const out: Candidate[] = [];
  for (const [, v] of views) {
    if (v.market !== market) continue;
    const t = v.tech;
    if (!t || t.price == null || t.price <= 0 || t.sma50 == null || t.sma50 <= 0 || t.sma200 == null || t.sma200 <= 0) continue;

    const q = live.get(v.symbol) || null;
    const price = q?.price ?? t.price;
    const chg = q?.chg ?? null;

    // No broken charts: must hold above 200DMA support band.
    if (price <= t.sma200 * 0.97) continue;

    const d21 = t.ema21 != null && t.ema21 > 0 ? ((price - t.ema21) / t.ema21) * 100 : null;
    const d50 = ((price - t.sma50) / t.sma50) * 100;
    const d200 = ((price - t.sma200) / t.sma200) * 100;

    // OVERSOLD: hard down day, or pulled under the 21EMA, or into the 50DMA band above 200DMA.
    const oversold =
      (chg != null && chg <= -3) ||
      (t.ema21 != null && t.ema21 > 0 && price <= t.ema21 * 0.97) ||
      (price <= t.sma50 * 1.01 && price >= t.sma200);
    if (!oversold) continue;

    // IMPAIRMENT SCREEN: refuse the falling knives.
    if (v.decay?.severity === 'high') continue;
    const fs = v.fundo?.score;
    if (typeof fs === 'number' && fs < 45 && !v.bench) continue;

    // Score 0-100
    let score = 40;
    const depth = Math.min(d21 ?? Infinity, d50); // most negative dislocation
    if (Number.isFinite(depth) && depth < 0) score += Math.min(20, Math.abs(depth) * 3);
    if (typeof fs === 'number') score += fs >= 70 ? 15 : fs >= 60 ? 8 : 0;
    if (v.bench?.tier === 'BLOCKBUSTER') score += 12; else if (v.bench?.tier === 'STRONG') score += 8;
    if (t.rs != null && t.rs >= 80) score += 5;
    if (price < t.sma200) score -= 15;
    score = Math.max(0, Math.min(100, Math.round(score)));

    out.push({ v, score, price, livePrice: q?.price ?? null, chg, d21, d50, d200 });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 25);
}

const chip = (color = 'var(--mc-text-3)'): React.CSSProperties => ({
  fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
  border: '1px solid var(--mc-border-2)', background: 'var(--mc-bg-2)', color, whiteSpace: 'nowrap',
});

function MarketSection({ market, regime, cands, rankOffset }: { market: Market; regime: RegimeSide | null; cands: Candidate[]; rankOffset: number }) {
  const label = market === 'IND' ? 'INDIA' : 'USA';
  const kind = regime?.kind || 'UNKNOWN';

  if (kind === 'BEAR') {
    return (
      <div style={{ background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bearish)', borderRadius: 9, padding: 16, marginBottom: 14 }}>
        <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 900, color: 'var(--mc-bearish)' }}>
          🛑 {label} regime is BEAR — the single-name bounce lane is CLOSED (playbook §4: oversold readings in bear regimes are continuation signals). Index scalps only.
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 9, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 900, letterSpacing: 1, color: 'var(--mc-text-1)' }}>
          {market === 'IND' ? '🇮🇳' : '🇺🇸'} {label}
        </div>
        <span style={chip('var(--mc-text-3)')}>regime: {kind}</span>
      </div>

      {kind === 'CORRECTION' && (
        <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 800, color: 'var(--mc-warn)', border: '1px solid var(--mc-warn)', borderRadius: 6, padding: '5px 8px', marginBottom: 8 }}>
          ⚠ CORRECTION regime — half size, confirmation mandatory.
        </div>
      )}
      {kind === 'RECOVERY' && (
        <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 800, color: 'var(--mc-accent)', border: '1px solid var(--mc-accent)', borderRadius: 6, padding: '5px 8px', marginBottom: 8 }}>
          🌊 post-capitulation window — the aggressive regime
        </div>
      )}

      {cands.length === 0 ? (
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-4)' }}>— no dislocations in trusted names right now —</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cands.map((c, i) => {
            const size = suggestSize({ price: c.price, stopPct: 8 });
            return (
              <div key={c.v.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '5px 0', borderBottom: '1px solid var(--mc-border-1)' }}>
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-4)', width: 20, flexShrink: 0 }}>#{rankOffset + i + 1}</span>
                <span
                  onClick={() => openPassport(c.v.symbol)}
                  style={{ fontFamily: MONO, fontSize: 12, fontWeight: 900, color: 'var(--mc-cyan)', cursor: 'pointer' }}
                >
                  {c.v.symbol}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10 }}>{market === 'IND' ? '🇮🇳' : '🇺🇸'}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.v.company}
                </span>
                <span style={{ ...chip(c.score >= 70 ? 'var(--mc-bullish)' : c.score >= 55 ? 'var(--mc-cyan)' : 'var(--mc-text-2)'), fontWeight: 900 }}>
                  {c.score}
                </span>
                {c.d21 != null && <span style={chip(c.d21 <= 0 ? 'var(--mc-warn)' : 'var(--mc-text-3)')}>d21 {c.d21 >= 0 ? '+' : ''}{c.d21.toFixed(1)}%</span>}
                <span style={chip(c.d50 <= 0 ? 'var(--mc-warn)' : 'var(--mc-text-3)')}>d50 {c.d50 >= 0 ? '+' : ''}{c.d50.toFixed(1)}%</span>
                <span style={chip('var(--mc-text-3)')}>d200 {c.d200 >= 0 ? '+' : ''}{c.d200.toFixed(1)}%</span>
                {c.chg != null && <span style={chip(c.chg <= 0 ? 'var(--mc-bearish)' : 'var(--mc-bullish)')}>day {c.chg >= 0 ? '+' : ''}{c.chg.toFixed(1)}%</span>}
                {c.v.fundo?.score != null && <span style={chip('var(--mc-text-2)')}>F{Math.round(c.v.fundo.score)}</span>}
                {c.v.bench && <span style={chip('var(--mc-accent)')}>{c.v.bench.tier}</span>}
                {size && (
                  <span style={chip('var(--mc-cyan)')}>
                    📐 {size.pctOfPortfolio.toFixed(1)}% · stop {fmtMoney(size.stopPrice, market)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function BounceDeskPage() {
  const [regime, setRegime] = useState<{ india: RegimeSide | null; usa: RegimeSide | null }>({ india: null, usa: null });
  const [candIND, setCandIND] = useState<Candidate[]>([]);
  const [candUSA, setCandUSA] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [reg, liveIND, liveUSA] = await Promise.all([
        fetch('/api/market/regime').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchQuotes('india'),
        fetchQuotes('us'),
      ]);
      if (!alive) return;
      const india: RegimeSide | null = reg?.india || null;
      const usa: RegimeSide | null = reg?.usa || null;
      setRegime({ india, usa });

      const views = getEngineViews();
      const ind = india?.kind === 'BEAR' ? [] : buildCandidates(views, liveIND, 'IND');
      const usaC = usa?.kind === 'BEAR' ? [] : buildCandidates(views, liveUSA, 'USA');
      setCandIND(ind);
      setCandUSA(usaC);
      setLoading(false);

      try {
        const top = [...ind, ...usaC].sort((a, b) => b.score - a.score).slice(0, 10);
        if (top.length) logSignals('bounce', top.map((c) => ({ ticker: c.v.symbol, note: `bounce ${c.score}`, priceAt: c.livePrice })));
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 4, fontFamily: MONO, fontSize: 13, fontWeight: 900, letterSpacing: 1, color: 'var(--mc-text-1)' }}>
        🌊 Bounce Desk
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-3)', marginBottom: 14 }}>
        Oversold ≠ bottom. This desk finds dislocations in names the portal already trusts, gates them by regime, and refuses the falling knives.
      </div>

      {loading ? (
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-4)' }}>scanning… (cold quote cache can take ~25s)</div>
      ) : (
        <>
          <MarketSection market="IND" regime={regime.india} cands={candIND} rankOffset={0} />
          <MarketSection market="USA" regime={regime.usa} cands={candUSA} rankOffset={0} />
        </>
      )}

      <div style={{ fontFamily: MONO, fontSize: 9, color: 'var(--mc-text-4)', marginTop: 10 }}>
        Rules from the Oversold Bounce Playbook: never fade an earnings gap; cash-flow red flags are auto-excluded; BEAR regime locks the desk. Not investment advice.
      </div>
    </div>
  );
}
