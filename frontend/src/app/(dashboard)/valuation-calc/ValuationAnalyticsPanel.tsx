'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect, useMemo } from 'react';
import { loadSavedValuations, type CalculatorResult, calculatePS, calculatePE, calculateEvEbitda } from '@/lib/valuation-calculators';
import { CARD, BORDER, TEXT, DIM } from './constants';

// PATCH 0634 — ANALYTICS over saved valuations
export function ValuationAnalyticsPanel() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('mc:valuations-updated', h);
    window.addEventListener('storage', h);
    return () => {
      window.removeEventListener('mc:valuations-updated', h);
      window.removeEventListener('storage', h);
    };
  }, []);
  const saved = useMemo(() => loadSavedValuations(), [tick]);

  const stats = useMemo(() => {
    if (saved.length === 0) return null;
    // Derive base-case upside from each saved valuation by re-running its calculator
    const enriched = saved.map((v) => {
      let result: CalculatorResult | null = null;
      try {
        if (v.calcKind === 'PS') result = calculatePS(v.inputs);
        else if (v.calcKind === 'PE') result = calculatePE(v.inputs);
        else result = calculateEvEbitda(v.inputs);
      } catch {}
      const base = result?.cases.find(c => c.label === 'BASE');
      const bull = result?.cases.find(c => c.label === 'BULL');
      const bear = result?.cases.find(c => c.label === 'BEAR');
      return { v, base, bull, bear };
    });
    const valid = enriched.filter(e => e.base);
    const avgBaseUpside = valid.length > 0
      ? valid.reduce((s, e) => s + (e.base!.upsidePct || 0), 0) / valid.length : 0;
    const avgBullUpside = valid.length > 0
      ? valid.reduce((s, e) => s + (e.bull?.upsidePct || 0), 0) / valid.length : 0;
    const avgBearUpside = valid.length > 0
      ? valid.reduce((s, e) => s + (e.bear?.upsidePct || 0), 0) / valid.length : 0;

    // Top conviction (highest annualized base)
    const topConviction = [...valid]
      .sort((a, b) => (b.base!.annualizedPct || 0) - (a.base!.annualizedPct || 0))
      .slice(0, 5);

    // Worst risk (lowest bear)
    const worstRisk = [...valid]
      .sort((a, b) => (a.bear?.upsidePct ?? 0) - (b.bear?.upsidePct ?? 0))
      .slice(0, 5);

    // By calculator type
    const byKind: Record<string, number> = {};
    for (const e of valid) byKind[e.v.calcKind] = (byKind[e.v.calcKind] || 0) + 1;

    // Buy-readiness — base upside >= 25%
    const buyReady = valid.filter(e => (e.base!.upsidePct || 0) >= 25);

    return { enriched: valid, avgBaseUpside, avgBullUpside, avgBearUpside, topConviction, worstRisk, byKind, buyReady };
  }, [saved]);

  if (!stats || stats.enriched.length === 0) {
    return (
      <div style={{ background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: '20px 22px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: TEXT, fontWeight: 700, marginBottom: 8 }}>📊 Valuation Analytics</div>
        <div style={{ fontSize: 12, color: DIM, fontStyle: 'italic', lineHeight: 1.6 }}>
          No saved valuations yet. Run a calculator → click <b style={{ color: 'var(--mc-bullish)' }}>💾 SAVE VALUATION</b> on the result.<br />
          Once you have 5+ saved runs, this tab will surface aggregated insights: avg upside, top conviction, worst risk, calculator mix.
        </div>
      </div>
    );
  }

  const { enriched, avgBaseUpside, avgBullUpside, avgBearUpside, topConviction, worstRisk, byKind, buyReady } = stats;
  const sigColor = (pct: number) => pct >= 50 ? '#10B981' : pct >= 25 ? '#22D3EE' : pct >= 0 ? '#F59E0B' : '#EF4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: TEXT }}>📊 Valuation Analytics</h2>
        <div style={{ fontSize: 12, color: DIM, marginTop: 4 }}>
          Aggregated insights across {enriched.length} saved valuations · re-computes on every load
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BASE CASE AVG</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: sigColor(avgBaseUpside), marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {avgBaseUpside >= 0 ? '+' : ''}{avgBaseUpside.toFixed(0)}%
          </div>
          <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>across {enriched.length} valuations</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BULL CASE AVG</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-bullish)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            +{avgBullUpside.toFixed(0)}%
          </div>
          <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>book-wide best-case</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BEAR CASE AVG</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-bearish)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {avgBearUpside >= 0 ? '+' : ''}{avgBearUpside.toFixed(0)}%
          </div>
          <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>downside if multiples compress</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BUY-READY</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--mc-bullish)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {buyReady.length}/{enriched.length}
          </div>
          <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>base upside ≥ 25%</div>
        </div>
      </div>

      {/* Calculator mix */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '14px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 8 }}>CALCULATOR MIX</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(byKind).map(([k, n]) => (
            <span key={k} style={{
              fontSize: 12, padding: '5px 11px',
              background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)',
              color: 'var(--mc-cyan)', borderRadius: 4, fontWeight: 800, fontFamily: 'ui-monospace, monospace',
            }}>
              {k === 'EV_EBITDA' ? 'EV/EBITDA' : k}: {n}
            </span>
          ))}
        </div>
      </div>

      {/* Top conviction */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderLeft: '3px solid var(--mc-bullish)', borderRadius: 6, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.5px', marginBottom: 4 }}>🏆 TOP CONVICTION (by annualized base-case)</div>
        <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>Highest expected CAGR across your saved valuations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {topConviction.map((e, i) => (
            <div key={e.v.id} style={{ background: 'var(--mc-bg-0)', borderRadius: 5, padding: '8px 12px', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: 'var(--mc-bullish)', fontWeight: 900, minWidth: 24 }}>#{i + 1}</span>
              <span style={{ fontSize: 13, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{e.v.ticker || e.v.company || '—'}</span>
              <span style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', padding: '2px 7px', borderRadius: 3, fontWeight: 800 }}>
                {e.v.calcKind === 'EV_EBITDA' ? 'EV/EBITDA' : e.v.calcKind}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--mc-text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {e.v.baseSummary}
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' }}>
                {e.base!.annualizedPct >= 0 ? '+' : ''}{e.base!.annualizedPct.toFixed(0)}% CAGR
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Worst risk */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderLeft: '3px solid var(--mc-bearish)', borderRadius: 6, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-bearish)', letterSpacing: '0.5px', marginBottom: 4 }}>⚠ WORST DOWNSIDE (by bear-case)</div>
        <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>Maximum drawdown if multiples compress to bear scenario</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {worstRisk.map((e) => (
            <div key={e.v.id} style={{ background: 'var(--mc-bg-0)', borderRadius: 5, padding: '8px 12px', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{e.v.ticker || e.v.company || '—'}</span>
              <span style={{ fontSize: 10, color: 'var(--mc-bearish)', background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', padding: '2px 7px', borderRadius: 3, fontWeight: 800 }}>
                {e.v.calcKind === 'EV_EBITDA' ? 'EV/EBITDA' : e.v.calcKind}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--mc-text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {e.v.notes || e.v.baseSummary}
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--mc-bearish)', fontVariantNumeric: 'tabular-nums' }}>
                {(e.bear?.upsidePct ?? 0).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* All saved — table */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 10 }}>FULL SAVED LIST ({enriched.length})</div>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 60px 1fr 90px 90px 90px', gap: '6px 10px', fontSize: 11 }}>
          <div style={{ color: DIM, fontWeight: 800, paddingBottom: 4, borderBottom: `1px solid ${BORDER}` }}>TICKER</div>
          <div style={{ color: DIM, fontWeight: 800, paddingBottom: 4, borderBottom: `1px solid ${BORDER}` }}>CALC</div>
          <div style={{ color: DIM, fontWeight: 800, paddingBottom: 4, borderBottom: `1px solid ${BORDER}` }}>SUMMARY</div>
          <div style={{ color: DIM, fontWeight: 800, paddingBottom: 4, borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>BEAR%</div>
          <div style={{ color: DIM, fontWeight: 800, paddingBottom: 4, borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>BASE%</div>
          <div style={{ color: DIM, fontWeight: 800, paddingBottom: 4, borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>BULL%</div>
          {enriched.map(e => (
            <>
              <div key={e.v.id+'-t'} style={{ color: TEXT, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{e.v.ticker || '—'}</div>
              <div key={e.v.id+'-c'} style={{ color: 'var(--mc-cyan)', fontFamily: 'ui-monospace, monospace' }}>{e.v.calcKind === 'EV_EBITDA' ? 'EVE' : e.v.calcKind}</div>
              <div key={e.v.id+'-s'} style={{ color: 'var(--mc-text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.v.baseSummary.slice(0, 90)}</div>
              <div key={e.v.id+'-1'} style={{ color: sigColor(e.bear?.upsidePct || 0), fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(e.bear?.upsidePct ?? 0).toFixed(0)}%</div>
              <div key={e.v.id+'-2'} style={{ color: sigColor(e.base!.upsidePct || 0), fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(e.base!.upsidePct ?? 0).toFixed(0)}%</div>
              <div key={e.v.id+'-3'} style={{ color: sigColor(e.bull?.upsidePct || 0), fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(e.bull?.upsidePct ?? 0).toFixed(0)}%</div>
            </>
          ))}
        </div>
      </div>
    </div>
  );
}
