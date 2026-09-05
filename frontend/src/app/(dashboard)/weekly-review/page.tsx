'use client';

// ════════════════════════════════════════════════════════════════════════════
// 🧘 Weekly Review — the Sunday ritual. A reading page: book snapshot, decay
// changes, stale bench, conflicts, next week's setups, and the checklist.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { getEngineViews, openPassport, type EngineView } from '@/lib/engines';
import { computeVerdict } from '@/lib/verdict';
import { getConvictionList, type ConvictionEntry } from '@/lib/conviction-beats';
import { assessDecay, benchAge, isStale, type DecayAssessment, type DecaySeverity } from '@/lib/cb-decay';
import { fmtMoney } from '@/lib/sizing';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

const card: React.CSSProperties = { background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 9, padding: 14, marginBottom: 12 };
const h2: React.CSSProperties = { fontFamily: MONO, fontSize: 11, fontWeight: 900, letterSpacing: 1, color: 'var(--mc-text-2)', marginBottom: 8 };
const dim: React.CSSProperties = { fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-4)' };
const row: React.CSSProperties = { fontFamily: MONO, fontSize: 11, color: 'var(--mc-text-2)', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '3px 0' };
const tickStyle: React.CSSProperties = { fontFamily: MONO, fontSize: 11, fontWeight: 900, color: 'var(--mc-cyan)', cursor: 'pointer' };
const chip = (color = 'var(--mc-text-3)'): React.CSSProperties => ({
  fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
  border: '1px solid var(--mc-border-2)', background: 'var(--mc-bg-2)', color, whiteSpace: 'nowrap',
});

const Tick = ({ s }: { s: string }) => <span style={tickStyle} onClick={() => openPassport(s)}>{s}</span>;
const Clear = () => <div style={dim}>— clear —</div>;

interface State {
  views: EngineView[];
  decays: Array<{ entry: ConvictionEntry; d: DecayAssessment }>;
  stale: ConvictionEntry[];
  live: Map<string, number>;
}

async function fetchQuotes(market: 'india' | 'us'): Promise<Array<{ ticker: string; price: number }>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`/api/market/quotes?market=${market}&fields=ticker,price,changePercent`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.stocks) ? data.stocks : [];
  } catch { return []; } finally { clearTimeout(timer); }
}

function weekOf(): string {
  const d = new Date();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return monday.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function WeeklyReviewPage() {
  const [st, setSt] = useState<State | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [ind, us] = await Promise.all([fetchQuotes('india'), fetchQuotes('us')]);
      if (!alive) return;
      const live = new Map<string, number>();
      for (const s of [...ind, ...us]) {
        const t = String(s?.ticker || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '');
        const p = Number(s?.price);
        if (t && Number.isFinite(p) && p > 0) live.set(t, p);
      }
      const views = Array.from(getEngineViews().values());
      const bench = (() => { try { return getConvictionList(); } catch { return [] as ConvictionEntry[]; } })();
      const decays: Array<{ entry: ConvictionEntry; d: DecayAssessment }> = [];
      const stale: ConvictionEntry[] = [];
      const held = new Set(views.filter((v) => v.holding).map((v) => v.symbol));
      for (const e of bench) {
        try {
          const d = assessDecay(e);
          if (d) decays.push({ entry: e, d });
        } catch { /* ignore */ }
        if (isStale(e) && !held.has(String(e.ticker || '').toUpperCase())) stale.push(e);
      }
      setSt({ views, decays, stale, live });
    })();
    return () => { alive = false; };
  }, []);

  if (!st) {
    return (
      <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
        <div style={dim}>preparing the ritual…</div>
      </div>
    );
  }

  // 1 · Book snapshot
  const holdings = st.views.filter((v) => v.holding);
  // zzz531 — never sum ₹ and $ into one total, nor value-weight an avg across an ~83x FX gap.
  const mktOf = (v: EngineView): 'IND' | 'USA' => String(v.market || '').toUpperCase().startsWith('US') ? 'USA' : 'IND';
  const marketTotals: Record<'IND' | 'USA', number> = { IND: 0, USA: 0 };
  for (const v of holdings) marketTotals[mktOf(v)] += (v.holding?.currentValue || 0);
  const withPnl = holdings.filter((v) => typeof v.holding?.pnlPercent === 'number');
  // value-weighted avg WITHIN each currency (weights are same-currency, so undistorted)
  const perMktAvg = (['IND', 'USA'] as const).map((mk) => {
    const legs = withPnl.filter((v) => mktOf(v) === mk);
    if (!legs.length) return null;
    const w = legs.reduce((s, v) => s + (v.holding?.currentValue || 0), 0);
    const avg = w > 0
      ? legs.reduce((s, v) => s + (v.holding!.pnlPercent as number) * (v.holding?.currentValue || 0), 0) / w
      : legs.reduce((s, v) => s + (v.holding!.pnlPercent as number), 0) / legs.length;
    return { mk, avg };
  }).filter((x): x is { mk: 'IND' | 'USA'; avg: number } => !!x);
  const byPnl = [...withPnl].sort((a, b) => (a.holding!.pnlPercent as number) - (b.holding!.pnlPercent as number));
  // zzz531 — split so the same name can't appear in both worst and best on a small book
  const worstCount = Math.min(3, Math.floor(byPnl.length / 2));
  const worst3 = byPnl.slice(0, worstCount);
  const best3 = byPnl.slice(byPnl.length - Math.min(3, byPnl.length - worstCount)).reverse();

  // 2 · Decay grouped by severity
  const bySev: Record<DecaySeverity, Array<{ entry: ConvictionEntry; d: DecayAssessment }>> = { high: [], med: [], low: [] };
  for (const x of st.decays) bySev[x.d.severity as DecaySeverity].push(x);
  const sevColor: Record<DecaySeverity, string> = { high: 'var(--mc-bearish)', med: 'var(--mc-warn)', low: 'var(--mc-text-3)' };

  // 4 · Conflicts
  const conflicts = st.views
    .map((v) => { try { return { v, verdict: computeVerdict(v) }; } catch { return null; } }) // zzz530 — one bad view can't crash the page
    .filter((x): x is { v: EngineView; verdict: ReturnType<typeof computeVerdict> } => !!x && x.verdict.conflicts.length > 0 && (!!x.v.holding || !!x.v.bench));

  // 5 · Setups
  const setups = st.views
    .filter((v) => {
      const t = v.tech;
      if (!t || t.price == null || t.price <= 0 || t.sma200 == null || t.sma200 <= 0) return false;
      const price = st.live.get(v.symbol) ?? t.price;
      if (price <= t.sma200) return false; // above 200DMA only
      const near50 = t.sma50 != null && t.sma50 > 0 && Math.abs(price - t.sma50) / t.sma50 <= 0.03;
      const near200 = Math.abs(price - t.sma200) / t.sma200 <= 0.03;
      if (!near50 && !near200) return false;
      return (v.fundo?.score != null && v.fundo.score >= 60) || !!v.bench;
    })
    .sort((a, b) => (b.fundo?.score ?? 0) - (a.fundo?.score ?? 0))
    .slice(0, 8);

  const pnlChip = (p: number) => (
    <span style={chip(p >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)')}>{p >= 0 ? '+' : ''}{p.toFixed(1)}%</span>
  );

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 900, letterSpacing: 1, color: 'var(--mc-text-1)', marginBottom: 2 }}>
        🧘 Weekly Review
      </div>
      <div style={{ ...dim, marginBottom: 14 }}>week of {weekOf()} · the Sunday ritual</div>

      {/* 1 · Book snapshot */}
      <div style={card}>
        <div style={h2}>💼 BOOK SNAPSHOT</div>
        {holdings.length === 0 ? <Clear /> : (
          <>
            <div style={{ ...row, marginBottom: 4 }}>
              <span style={chip('var(--mc-text-1)')}>{holdings.length} holdings</span>
              {(['IND', 'USA'] as const).map((mk) => marketTotals[mk] > 0 ? (
                <span key={mk} style={chip('var(--mc-text-1)')}>{fmtMoney(marketTotals[mk], mk)}</span>
              ) : null)}
              {perMktAvg.map(({ mk, avg }) => (
                <span key={mk} style={chip(avg >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)')}>
                  {perMktAvg.length > 1 ? (mk === 'USA' ? '$ ' : '₹ ') : ''}avg {avg >= 0 ? '+' : ''}{avg.toFixed(1)}%
                </span>
              ))}
            </div>
            {worst3.length > 0 && (
              <div style={row}>
                <span style={dim}>worst</span>
                {worst3.map((v) => (
                  <span key={v.symbol} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
                    <Tick s={v.symbol} />{pnlChip(v.holding!.pnlPercent as number)}
                  </span>
                ))}
              </div>
            )}
            {best3.length > 0 && (
              <div style={row}>
                <span style={dim}>best</span>
                {best3.map((v) => (
                  <span key={v.symbol} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
                    <Tick s={v.symbol} />{pnlChip(v.holding!.pnlPercent as number)}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 2 · Decay changes */}
      <div style={card}>
        <div style={h2}>⚠️ DECAY CHANGES</div>
        {st.decays.length === 0 ? <Clear /> : (
          (['high', 'med', 'low'] as DecaySeverity[]).map((sev) => bySev[sev].length === 0 ? null : (
            <div key={sev} style={row}>
              <span style={{ ...chip(sevColor[sev]), fontWeight: 900 }}>{sev.toUpperCase()}</span>
              {bySev[sev].map(({ d }) => (
                <span key={d.ticker} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
                  <Tick s={d.ticker} />
                  <span style={{ ...dim, fontSize: 9 }}>{d.reasons[0]}</span>
                </span>
              ))}
            </div>
          ))
        )}
      </div>

      {/* 3 · Stale bench */}
      <div style={card}>
        <div style={h2}>🕰 STALE BENCH</div>
        {st.stale.length === 0 ? <Clear /> : (
          <>
            <div style={row}>
              {st.stale.map((e) => (
                <span key={e.ticker} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
                  <Tick s={String(e.ticker).toUpperCase()} />
                  <span style={chip('var(--mc-warn)')}>{benchAge(e)}d</span>
                </span>
              ))}
            </div>
            <div style={{ ...dim, marginTop: 6 }}>
              promote to a position or cut — a bench name aging past 120d is a decision being avoided.
            </div>
          </>
        )}
      </div>

      {/* 4 · Conflicts to resolve */}
      <div style={card}>
        <div style={h2}>⚔️ CONFLICTS TO RESOLVE</div>
        {conflicts.length === 0 ? <Clear /> : conflicts.map(({ v, verdict }) => (
          <div key={v.symbol} style={row}>
            <Tick s={v.symbol} />
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-warn)' }}>{verdict.conflicts[0]}</span>
          </div>
        ))}
      </div>

      {/* 5 · Setups for the week */}
      <div style={card}>
        <div style={h2}>🎯 SETUPS FOR THE WEEK</div>
        {setups.length === 0 ? <Clear /> : setups.map((v) => (
          <div key={v.symbol} style={row}>
            <Tick s={v.symbol} />
            <span style={{ ...dim, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.company}</span>
            {v.fundo?.score != null && <span style={chip('var(--mc-text-2)')}>F{Math.round(v.fundo.score)}</span>}
            {v.bench && <span style={chip('var(--mc-accent)')}>{v.bench.tier}</span>}
            <span style={chip('var(--mc-cyan)')}>at MA support</span>
          </div>
        ))}
      </div>

      {/* 6 · The ritual */}
      <div style={card}>
        <div style={h2}>📋 THE RITUAL</div>
        {[
          'review each decay name',
          'resolve one conflict',
          'cut or buy one stale bench name',
          'read one Learn section',
          'check Signal Scoreboard hit rates',
        ].map((item) => (
          <div key={item} style={{ ...row, color: 'var(--mc-text-3)' }}>
            <span style={{ color: 'var(--mc-text-4)' }}>☐</span> {item}
          </div>
        ))}
      </div>
    </div>
  );
}
