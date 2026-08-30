'use client';

// ═══════════════════════════════════════════════════════════════════════════
// VALUATION CALCULATORS (PATCH 0628)
//
// Institutional P/S, P/E, EV/EBITDA target-multiple calculators.
// Each takes management guidance + multiple band → projects market cap +
// bull/base/bear cases with annualized upside.
//
// Worked examples ship in /lib/valuation-calculators.ts (Rubicon, Bajaj
// Consumer, TD Power, Sterlite, Aeroflex, Atlanta Electricals, DEE Dev).
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  calculatePS, calculatePE, calculateEvEbitda,
  fetchQuoteAutofill,
  loadSavedValuations, saveValuation, deleteValuation,
  loadTickerUniverse, searchTickerUniverse,
  WORKED_EXAMPLES, SECTOR_CALCULATOR_MAP,
  type CalculatorResult, type QuoteAutoFill, type SavedValuation, type TickerHit,
} from '@/lib/valuation-calculators';
import { armBookFlag } from '@/lib/book-flags-client';

// PATCH 0858 — BUY-zone upside threshold (percent). Reuses the same 25%
// "buy-ready" bar the Analytics tab already applies (ValuationAnalyticsPanel
// buyReady = base upside >= 25). A saved valuation whose LIVE upside crosses
// from below this to at/above it is a fresh WATCH→BUY signal.
const BUY_UPSIDE = 25;

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

type CalcKind = 'FAIR_VALUE' | 'PS' | 'PE' | 'EV_EBITDA' | 'REVERSE_DCF' | 'MORE' | 'ANALYTICS' | 'LEARN';

// PATCH 0633 — save-valuation button shown above result cards
function SaveValuationBar({ calcKind, result, onLoaded }: {
  calcKind: 'PS' | 'PE' | 'EV_EBITDA';
  result: CalculatorResult;
  onLoaded?: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const handleSave = () => {
    const v = saveValuation({
      calcKind,
      ticker: result.ticker,
      company: result.company,
      inputs: result.inputs,
      baseSummary: result.baseSummary,
      notes: notes.trim() || undefined,
    });
    setSavedId(v.id);
    setNotes('');
    onLoaded?.();
    setTimeout(() => setSavedId(null), 3000);
  };
  return (
    <div style={{
      marginTop: 14, padding: '10px 12px',
      background: 'color-mix(in srgb, var(--mc-bullish) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional note (e.g. 'mgmt FY27 guidance · cross-confirmed by CB')"
        style={{
          flex: 1, minWidth: 240,
          background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`,
          padding: '6px 10px', borderRadius: 4, fontSize: 12,
        }}
      />
      <button onClick={handleSave} style={{
        fontSize: 12, padding: '6px 14px',
        background: 'var(--mc-bullish)', border: 'none', color: 'var(--mc-bg-0)',
        borderRadius: 4, cursor: 'pointer', fontWeight: 800,
      }}>
        💾 SAVE VALUATION
      </button>
      {savedId && (
        <span style={{ fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 700 }}>
          ✓ saved
        </span>
      )}
    </div>
  );
}

// PATCH 0634 — ANALYTICS over saved valuations
function ValuationAnalyticsPanel() {
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

// PATCH 0858 — recompute a saved valuation's BASE fair value + upside from its
// frozen inputs (same technique the Analytics tab uses). fairValue is the BASE
// target stock price (independent of current price), priceAtSave is the price
// captured in inputs.currentPrice at save time, savedUpside is the frozen
// (fairValue − priceAtSave)/priceAtSave the row was saved with.
type EnrichedSaved = {
  v: SavedValuation;
  fairValue?: number;
  priceAtSave?: number;
  savedUpside?: number;
  currency: '₹' | '$';
  isUS: boolean;
};
function enrichSaved(v: SavedValuation): EnrichedSaved {
  let result: CalculatorResult | null = null;
  try {
    if (v.calcKind === 'PS') result = calculatePS(v.inputs);
    else if (v.calcKind === 'PE') result = calculatePE(v.inputs);
    else result = calculateEvEbitda(v.inputs);
  } catch { /* keep result null; row still renders without live chip */ }
  const base = result?.cases.find(c => c.label === 'BASE');
  const currency: '₹' | '$' = (v.inputs as any)?.currency === '$' ? '$' : '₹';
  return {
    v,
    fairValue: base?.targetPrice,
    priceAtSave: typeof (v.inputs as any)?.currentPrice === 'number' ? (v.inputs as any).currentPrice : undefined,
    savedUpside: base?.upsidePct,
    currency,
    isUS: currency === '$',
  };
}

function SavedValuationsPanel({ onLoad }: { onLoad?: (v: SavedValuation) => void }) {
  const [tick, setTick] = useState(0);
  // PATCH 0858 — ticker→live-price map fetched once on mount (and on save).
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('mc:valuations-updated', h);
    return () => window.removeEventListener('mc:valuations-updated', h);
  }, []);
  const saved = loadSavedValuations();
  const enriched = useMemo(() => saved.map(enrichSaved), [saved]);

  // PATCH 0858 — fetch live prices via the canonical quotes endpoint. India
  // always; US too if any saved entry is a $-denominated valuation. Never throws.
  useEffect(() => {
    let cancelled = false;
    const needsUS = enriched.some(e => e.isUS);
    const run = async () => {
      const markets: Array<'india' | 'us'> = needsUS ? ['india', 'us'] : ['india'];
      const map: Record<string, number> = {};
      for (const m of markets) {
        try {
          const res = await fetch(`/api/market/quotes?market=${m}`, { cache: 'no-store' });
          if (!res.ok) continue;
          const j = await res.json();
          const stocks = Array.isArray(j?.stocks) ? j.stocks : [];
          for (const s of stocks) {
            const t = String(s?.ticker || '').toUpperCase().trim();
            const p = Number(s?.price);
            if (t && Number.isFinite(p) && p > 0) map[t] = p;
          }
        } catch { /* ignore this market, never throw */ }
      }
      if (!cancelled) setLivePrices(map);
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // PATCH 0858 — arm a Book Watch flag on a FRESH WATCH→BUY crossing:
  // saved upside was below the BUY bar, live upside is now at/above it.
  // armBookFlag self-dedups by kind+ticker+day, so this is safe to re-run.
  useEffect(() => {
    if (Object.keys(livePrices).length === 0) return;
    for (const e of enriched) {
      const sym = String(e.v.ticker || '').toUpperCase().trim();
      if (!sym) continue;
      const live = livePrices[sym];
      const fair = e.fairValue;
      if (!live || !fair) continue;
      const liveUpside = ((fair - live) / live) * 100;
      const savedUpside = e.savedUpside;
      if (savedUpside === undefined) continue;
      if (savedUpside < BUY_UPSIDE && liveUpside >= BUY_UPSIDE) {
        armBookFlag({
          kind: 'THESIS_DRIFT_REOPEN', ticker: sym, company: e.v.company, severity: 'warning',
          message: `${sym} valuation crossed into BUY zone — live upside +${Math.round(liveUpside)}% (fair ₹${Math.round(fair)} vs ₹${Math.round(live)})`,
          detail: 'saved valuation',
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePrices]);

  if (saved.length === 0) {
    return (
      <div style={{ background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: '14px 16px', fontSize: 12, color: DIM, fontStyle: 'italic' }}>
        💾 No saved valuations yet. Run a calculator and click <b style={{ color: 'var(--mc-bullish)' }}>SAVE VALUATION</b> to persist it here for later review.
      </div>
    );
  }
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>💾 Saved Valuations ({saved.length})</h2>
        <span style={{ fontSize: 10, color: DIM, fontFamily: 'ui-monospace, monospace' }}>persists in your browser</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {enriched.slice(0, 30).map(({ v, fairValue, priceAtSave, savedUpside, currency }) => {
          // PATCH 0858 — live upside recomputed against the live price.
          const sym = String(v.ticker || '').toUpperCase().trim();
          const live = sym ? livePrices[sym] : undefined;
          const hasLive = !!(live && fairValue);
          const liveUpside = hasLive ? ((fairValue! - live!) / live!) * 100 : undefined;
          const crossed = savedUpside !== undefined && liveUpside !== undefined
            && savedUpside < BUY_UPSIDE && liveUpside >= BUY_UPSIDE;
          const upColor = liveUpside === undefined ? DIM
            : liveUpside >= BUY_UPSIDE ? 'var(--mc-bullish)'
            : liveUpside >= 0 ? 'var(--mc-warn)' : 'var(--mc-bearish)';
          const arrow = (liveUpside !== undefined && savedUpside !== undefined)
            ? (liveUpside >= savedUpside ? '▲' : '▼') : '▲';
          const chipTitle = [
            `Saved upside: ${savedUpside !== undefined ? (savedUpside >= 0 ? '+' : '') + Math.round(savedUpside) + '%' : 'n/a'}`,
            priceAtSave ? `Price at save: ${currency}${Math.round(priceAtSave).toLocaleString('en-IN')}` : '',
            (hasLive) ? `Live price: ${currency}${Math.round(live!).toLocaleString('en-IN')}` : '',
            fairValue ? `Fair value (base): ${currency}${Math.round(fairValue).toLocaleString('en-IN')}` : '',
          ].filter(Boolean).join(' · ');
          /*
           * PATCH 0965 UX — Saved-valuation row label.
           * Root cause: when neither ticker nor company was populated at
           * save time, the visible row showed only "—" and the internal
           * UUID id was carried around as the React key + delete handle.
           * If the user opens the underlying JSON or exports a PDF the
           * UUID surfaced as the "name" — making rows indistinguishable.
           * Fix: build a stable user-facing label from
           *   ${company || ticker} · ${YYYY-MM-DD}
           * with a sensible "Untitled" fallback. The UUID `v.id` is kept
           * as React key + the delete handler argument — purely internal.
           */
          const dateStr = (v.savedAt || '').slice(0, 10);
          const primary = (v.company || v.ticker || '').trim();
          const displayLabel = primary
            ? `${primary} · ${dateStr}`
            : `Untitled valuation · ${dateStr}`;
          return (
          <div key={v.id} style={{
            background: 'var(--mc-bg-0)', border: `1px solid ${BORDER}`, borderRadius: 5,
            padding: '8px 10px',
            display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 50 }}>
              {v.calcKind === 'EV_EBITDA' ? 'EV/EB' : v.calcKind}
            </span>
            <span style={{ fontSize: 12, color: TEXT, fontWeight: 700 }} title={`Saved ${v.savedAt}`}>{displayLabel}</span>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--mc-text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {v.baseSummary}
            </span>
            {v.notes && (
              <span style={{ fontSize: 10, color: DIM, fontStyle: 'italic' }} title={v.notes}>
                📝 {v.notes.slice(0, 40)}{v.notes.length > 40 ? '…' : ''}
              </span>
            )}
            {/* PATCH 0858 — live-upside chip (saved upside on hover) + WATCH→BUY crossing chip */}
            {liveUpside !== undefined && (
              <span
                title={chipTitle}
                style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 3, fontWeight: 800,
                  fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', cursor: 'help',
                  color: upColor,
                  background: `color-mix(in srgb, ${upColor} 10%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${upColor} 30%, transparent)`,
                }}
              >
                {arrow} upside now {liveUpside >= 0 ? '+' : ''}{Math.round(liveUpside)}%
                {savedUpside !== undefined ? ` (was ${savedUpside >= 0 ? '+' : ''}${Math.round(savedUpside)}%)` : ''}
              </span>
            )}
            {crossed && (
              <span
                title={`Live upside +${Math.round(liveUpside!)}% ≥ BUY bar ${BUY_UPSIDE}% (saved ${Math.round(savedUpside!)}%)`}
                style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 3, fontWeight: 800,
                  whiteSpace: 'nowrap',
                  color: 'var(--mc-bullish)',
                  background: 'color-mix(in srgb, var(--mc-bullish) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--mc-bullish) 45%, transparent)',
                }}
              >
                🎯 crossed into BUY zone
              </span>
            )}
            <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace' }}>
              {v.savedAt.slice(0, 10)}
            </span>
            <button onClick={() => {
              // PATCH 0636 — fire event so the matching calculator tab loads it
              window.dispatchEvent(new CustomEvent('mc:load-valuation', { detail: v }));
              onLoad?.(v);
            }} style={{
              fontSize: 10, padding: '3px 8px',
              background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 31%, transparent)', color: 'var(--mc-cyan)',
              borderRadius: 3, cursor: 'pointer', fontWeight: 700,
            }}>EDIT</button>
            <button onClick={() => { if (confirm(`Delete saved valuation for ${v.ticker || '—'}?`)) deleteValuation(v.id); }} style={{
              fontSize: 10, padding: '3px 8px',
              background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 31%, transparent)', color: 'var(--mc-bearish)',
              borderRadius: 3, cursor: 'pointer', fontWeight: 700,
            }}>×</button>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function CalcResultDisplay({ result, calcKind }: { result: CalculatorResult; calcKind?: 'PS' | 'PE' | 'EV_EBITDA' }) {
  const baseUpside = result.cases.find(c => c.label === 'BASE')?.upsidePct ?? 0;
  const showSanity = Math.abs(baseUpside) >= 300;
  return (
    <div style={{ marginTop: 18 }}>
      {showSanity && (
        <div style={{
          background: 'color-mix(in srgb, var(--mc-warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 38%, transparent)', borderRadius: 6,
          padding: '10px 14px', marginBottom: 10, fontSize: 12, color: TEXT, lineHeight: 1.55,
        }}>
          ⚠ <b style={{ color: 'var(--mc-warn)' }}>Sanity check:</b> base-case upside is {baseUpside.toFixed(0)}% — that&apos;s unusual.
          Common causes: (1) current market cap not yet auto-filled — click 🔄 above to pull live data;
          (2) forward revenue / PAT input is much larger than current scale — verify the FY27/FY28 guidance is realistic;
          (3) multiple band may be too generous for the sector. Adjust inputs or open <a href="/playbook" style={{ color: 'var(--mc-cyan)' }}>Playbook</a> for sector-appropriate ranges.
        </div>
      )}
      <div style={{
        background: 'color-mix(in srgb, var(--mc-cyan) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', borderRadius: 6,
        padding: '12px 14px', marginBottom: 12, fontSize: 13, color: TEXT, lineHeight: 1.6,
      }}>
        <b style={{ color: 'var(--mc-cyan)' }}>📊 Base case:</b> {result.baseSummary}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {result.cases.map((c) => (
          <div key={c.label} style={{
            background: CARD, border: `1px solid ${c.color}50`, borderLeft: `4px solid ${c.color}`,
            borderRadius: 6, padding: '14px 16px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: c.color, letterSpacing: '1px', marginBottom: 6 }}>
              {c.label} CASE
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>
              {c.currency || '₹'}{Math.round(c.marketCapCr).toLocaleString('en-IN')} Cr
            </div>
            <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>target market cap</div>
            {/* PATCH 0631 — target stock price */}
            {c.targetPrice !== undefined && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.color}30` }}>
                <div style={{ fontSize: 9, color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>TARGET STOCK PRICE</div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 3 }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: c.color, fontVariantNumeric: 'tabular-nums' }}>
                    {c.currency || '₹'}{c.targetPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                  {c.currentPrice && (
                    <span style={{ fontSize: 10, color: DIM, fontVariantNumeric: 'tabular-nums' }}>
                      from {c.currency || '₹'}{c.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  )}
                </div>
              </div>
            )}
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: DIM }}>Total upside</span>
              <span style={{ color: c.color, fontWeight: 800 }}>{c.upsidePct >= 0 ? '+' : ''}{c.upsidePct.toFixed(0)}%</span>
            </div>
            <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: DIM }}>Annualized</span>
              <span style={{ color: c.color, fontWeight: 800 }}>{c.annualizedPct >= 0 ? '+' : ''}{c.annualizedPct.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// PATCH 0636 — Ticker autocomplete combo box.
// Loads /api/market/quotes universe once (cached 5min in lib), then filters
// client-side as user types. On select: ticker + price + market cap autofill.
function TickerCombo({ value, onChange, onSelect, market = 'india' }: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (hit: TickerHit) => void;
  market?: 'india' | 'us';
}) {
  const [hits, setHits] = useState<TickerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loadingUni, setLoadingUni] = useState(false);

  // Load universe on first focus
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingUni(true);
      await loadTickerUniverse(market);
      if (!cancelled) {
        setHits(searchTickerUniverse(value, market));
        setLoadingUni(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [market]);

  // Re-filter as user types
  useEffect(() => {
    setHits(searchTickerUniverse(value, market));
  }, [value, market]);

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value.toUpperCase()); setOpen(true); }}
        onFocus={() => { setOpen(true); setHits(searchTickerUniverse(value, market)); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={loadingUni ? 'Loading universe…' : 'Start typing ticker or company'}
        autoComplete="off"
        style={{
          width: '100%', boxSizing: 'border-box',
          background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`,
          padding: '7px 10px', borderRadius: 4, fontSize: 13, fontWeight: 600,
          fontFamily: 'ui-monospace, monospace',
        }}
      />
      {open && hits.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          marginTop: 4, maxHeight: 280, overflowY: 'auto',
          background: CARD, border: `1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)`, borderRadius: 4,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {hits.map((h) => (
            <button
              key={h.ticker}
              onMouseDown={(e) => { e.preventDefault(); onChange(h.ticker); onSelect(h); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 10px', background: 'transparent', border: 'none',
                borderBottom: `1px solid ${BORDER}`, color: TEXT,
                cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#1A2540'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 11, color: 'var(--mc-cyan)', fontFamily: 'ui-monospace, monospace', fontWeight: 800, minWidth: 80 }}>
                {h.ticker}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.company}
              </span>
              {h.sector && <span style={{ fontSize: 9, color: DIM, whiteSpace: 'nowrap' }}>{h.sector}</span>}
              {h.price && (
                <span style={{ fontSize: 10, color: 'var(--mc-bullish)', fontFamily: 'ui-monospace, monospace', fontWeight: 700, minWidth: 50, textAlign: 'right' }}>
                  ₹{h.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** PATCH 0631/0633 — auto-fetch with debounce on ticker change.
 *  User asked: 'CURRENT MARKET CAP SHOULD BE AUTOAMTICAL DERIVED ALWAYS.'
 *  So we auto-fire fetchQuoteAutofill 600ms after the ticker stops changing,
 *  PLUS a manual button for instant refresh. */
function AutoFillBtn({ ticker, market, onFill, currentPrice, onNotInUniverse }: { ticker: string; market: 'india' | 'us'; onFill: (q: QuoteAutoFill) => void; currentPrice?: number; onNotInUniverse?: (state: boolean) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string>('');

  const fire = async (t: string) => {
    if (!t.trim()) return;
    setLoading(true); setError(null);
    try {
      const q = await fetchQuoteAutofill(t, market);
      if (q) { onFill(q); setLastFetched(t); setError(null); onNotInUniverse?.(false); /* PATCH 0696 */ }
      // PATCH 0645 — Clearer message: distinguish 'not in universe' from 'fetch error'.
      else { setError(`'${t.toUpperCase()}' not in live universe — enter market cap manually below`); onNotInUniverse?.(true); /* PATCH 0696 */ }
    } catch { setError('Live quote fetch failed — enter market cap manually below'); onNotInUniverse?.(true); /* PATCH 0696 */ }
    finally { setLoading(false); }
  };

  // Debounced auto-fire when ticker changes
  useEffect(() => {
    if (!ticker.trim() || ticker === lastFetched) return;
    const t = setTimeout(() => fire(ticker), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, market]);

  const handleClick = () => fire(ticker);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <button onClick={handleClick} disabled={loading} style={{
        fontSize: 11, padding: '5px 12px',
        background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 31%, transparent)',
        color: 'var(--mc-bullish)', borderRadius: 4, cursor: loading ? 'wait' : 'pointer', fontWeight: 800,
      }}>
        {loading ? '⏳ Fetching…' : '🔄 Auto-fill price + market cap'}
      </button>
      {currentPrice && (
        <span style={{ fontSize: 11, color: DIM, fontFamily: 'ui-monospace, monospace' }}>
          live price: <b style={{ color: 'var(--mc-bullish)' }}>{market === 'us' ? '$' : '₹'}{currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</b>
        </span>
      )}
      {error && <span style={{ fontSize: 10, color: 'var(--mc-warn)' }}>{error}</span>}
    </div>
  );
}

function NumberInput({ label, value, onChange, suffix, inputRef, highlight, helper, ticker }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; inputRef?: React.RefObject<HTMLInputElement>; highlight?: boolean; helper?: string; ticker?: string }) {
  // PATCH 0696 — optional ref + highlight border + helper text + ticker
  // deeplink. When `highlight` toggles true (ticker not in live universe),
  // the caller useEffects this input's ref into focus.
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
      <span style={{ color: DIM, fontWeight: 700, letterSpacing: '0.3px' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          ref={inputRef}
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          title={highlight ? 'Not in live price feed — enter current market cap from Screener.in or moneycontrol.' : undefined}
          style={{
            background: 'var(--mc-bg-0)', color: TEXT,
            border: `1px solid ${highlight ? 'var(--mc-warn)' : BORDER}`,
            padding: '7px 10px', borderRadius: 4, fontSize: 13, fontFamily: 'ui-monospace, monospace',
            width: 130, fontWeight: 600,
            boxShadow: highlight ? '0 0 0 2px rgba(245,158,11,0.15)' : undefined,
          }}
        />
        {suffix && <span style={{ fontSize: 11, color: DIM }}>{suffix}</span>}
      </div>
      {highlight && (
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--mc-warn)', lineHeight: 1.5 }}>
          {helper || 'Not in live price feed — enter current market cap from Screener.in or moneycontrol.'}
          {ticker && (
            <>
              {' '}
              <a
                href={`https://www.screener.in/company/${encodeURIComponent(ticker.toUpperCase())}/`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--mc-warn)', textDecoration: 'underline', fontWeight: 700 }}
              >
                Look up on Screener.in →
              </a>
            </>
          )}
        </div>
      )}
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// zzz499 — FORWARD FAIR VALUE (Excel-driven P&L waterfall).
// Upload a Screener.in "Data Sheet" export → auto-fill the latest-year P&L →
// set the forward target (revenue, OPM, other income, dep, interest, tax) →
// forward PBT → PAT → EPS → apply a peer-derived P/E band → target price band,
// upside vs current price, and implied N-year CAGR. All client-side, all editable.
// This is exactly the by-hand method: Sales × OPM = Op Profit; + Other Income
// − Depreciation − Interest = PBT; × (1−tax) = PAT; ÷ shares = EPS; × P/E = price.
// ═══════════════════════════════════════════════════════════════════════════
const r1 = (v: number) => Math.round((Number(v) || 0) * 10) / 10;
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const crFmt = (v: number) => Number.isFinite(v) ? `₹${(Math.abs(v) >= 100 ? Math.round(v) : r1(v)).toLocaleString('en-IN')} Cr` : '—';
const rsFmt = (v: number) => Number.isFinite(v) ? `₹${Math.round(v).toLocaleString('en-IN')}` : '—';
const epsFmt = (v: number) => Number.isFinite(v) ? `₹${v.toFixed(1)}` : '—';

function PLCell({ label, value, onChange, suffix, readOnly, accent }: { label: string; value: number; onChange?: (v: number) => void; suffix?: string; readOnly?: boolean; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, color: DIM, fontWeight: 700 }}>{label}</span>
      {readOnly ? (
        <div style={{ padding: '7px 9px', borderRadius: 4, fontSize: 13, fontFamily: 'ui-monospace, monospace', fontWeight: 800, color: accent || TEXT, background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}` }}>
          {Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}{suffix ? <span style={{ color: DIM, fontWeight: 600, fontSize: 11 }}> {suffix}</span> : null}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <input type="number" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange?.(Number(e.target.value))}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 9px', borderRadius: 4, fontSize: 13, fontFamily: 'ui-monospace, monospace', width: '100%', fontWeight: 700 }} />
          {suffix && <span style={{ fontSize: 11, color: DIM }}>{suffix}</span>}
        </div>
      )}
    </div>
  );
}

function ForwardFairValueCalculator() {
  const [company, setCompany] = useState('');
  const [baseYear, setBaseYear] = useState('');
  const [price, setPrice] = useState(1431);
  const [shares, setShares] = useState(7.74);   // crore shares
  // base (current) P&L in ₹ Cr — defaults are Quality Power FY25 so the tab is usable before any upload
  const [bSales, setBSales] = useState(337);
  const [bOpm, setBOpm] = useState(19);
  const [bOI, setBOI] = useState(54);
  const [bDep, setBDep] = useState(5);
  const [bInt, setBInt] = useState(2);
  const [bTax, setBTax] = useState(11);
  // forward (target) P&L
  const [fSales, setFSales] = useState(800);
  const [fOpm, setFOpm] = useState(19);
  const [fOI, setFOI] = useState(54);
  const [fDep, setFDep] = useState(5);
  const [fInt, setFInt] = useState(2);
  const [fTax, setFTax] = useState(11);
  const [fShares, setFShares] = useState(7.74);
  // owner share % — reported net profit ÷ (PBT×(1−tax)). <100 = minority interest /
  // associates skimming profit before it reaches shareholders. Auto-derived from the
  // uploaded year so base EPS always reconciles to the REPORTED number, not a naive
  // PBT−tax that would overstate EPS (Quality Power reports ~67% to owners).
  const [bOwner, setBOwner] = useState(67);
  const [fOwner, setFOwner] = useState(67);
  const [years, setYears] = useState(1);
  const [peLow, setPeLow] = useState(40);
  const [peHigh, setPeHigh] = useState(60);
  const [peers, setPeers] = useState('');
  const [sector, setSector] = useState('');
  const [hist, setHist] = useState<{ yr: number; sales: number; opm: number; tax: number; pe: number }[]>([]);
  const [auto, setAuto] = useState<string[]>([]);   // human-readable list of assumptions applied
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setErr(null); setMsg(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sn = wb.SheetNames.find((n) => /data\s*sheet/i.test(n)) || wb.SheetNames.find((n) => /data/i.test(n));
      if (!sn) throw new Error('No "Data Sheet" tab found. Upload the standard Screener.in Excel export (it has a Data Sheet).');
      const ws: any = wb.Sheets[sn];
      const num = (a: string) => { const c = ws[a]; const v = c ? Number(c.v) : NaN; return Number.isFinite(v) ? v : NaN; };
      const st = (a: string) => { const c = ws[a]; return c && c.v != null ? String(c.v) : ''; };
      const cols = 'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      // rightmost annual P&L column: row 16 has a date AND row 17 (Sales) is a positive number
      let col = '';
      for (const cc of cols) { const s = num(cc + '17'); if (ws[cc + '16'] && ws[cc + '16'].v != null && Number.isFinite(s) && s > 0) col = cc; }
      if (!col) throw new Error('Could not locate the P&L rows (Sales at row 17) in the Data Sheet.');
      const sales = num(col + '17'), oi = num(col + '25'), dep = num(col + '26'), intr = num(col + '27'), pbt = num(col + '28'), tax = num(col + '29'), np = num(col + '30');
      const px = num('B8'), mcap = num('B9');
      let sh = (Number.isFinite(mcap) && Number.isFinite(px) && px > 0) ? mcap / px : NaN;
      if (!Number.isFinite(sh)) { const esc = num(col + '57'), fv = num('B7'); if (Number.isFinite(esc) && Number.isFinite(fv) && fv > 0) sh = esc / fv; }
      const g = (x: number) => (Number.isFinite(x) ? x : 0);
      const op = g(pbt) - g(oi) + g(dep) + g(intr);
      const opm = sales > 0 ? op / sales * 100 : 0;
      const taxPct = pbt > 0 ? g(tax) / pbt * 100 : 0;
      // owner share = reported net profit ÷ after-tax profit (captures minority interest)
      const afterTax = g(pbt) * (1 - taxPct / 100);
      const owner = (afterTax > 0 && Number.isFinite(np) && np > 0) ? Math.min(100, np / afterTax * 100) : 100;
      // date can arrive as a JS Date (cellDates), an Excel serial number, or a string
      const yr = (() => {
        const dv = ws[col + '16'] ? ws[col + '16'].v : null;
        if (dv instanceof Date) return String(dv.getFullYear());
        if (typeof dv === 'number' && dv > 20000) return String(new Date(Math.round((dv - 25569) * 86400000)).getUTCFullYear());
        const m = String(dv ?? '').match(/(19|20)\d{2}/);
        return m ? m[0] : '';
      })();
      const fy = yr ? `FY${Number(yr) % 100}` : '';
      setCompany(st('B1')); setBaseYear(fy);
      if (Number.isFinite(px)) setPrice(r2(px)); if (Number.isFinite(sh)) { setShares(r2(sh)); setFShares(r2(sh)); }
      setBSales(r1(sales)); setBOpm(r1(opm)); setBOI(r1(oi)); setBDep(r1(dep)); setBInt(r1(intr)); setBTax(r1(taxPct)); setBOwner(r1(owner));
      // ── parse the FULL P&L history so the forward assumptions come from the
      //    company's own track record, not a guess. Per annual column: sales, OPM
      //    (derived), effective tax %, and the year-end P/E (row-90 price ÷ EPS).
      const H: { yr: number; sales: number; opm: number; tax: number; pe: number }[] = [];
      for (const cc of cols) {
        const s = num(cc + '17'); if (!(Number.isFinite(s) && s > 0)) continue;
        const dvv = ws[cc + '16'] ? ws[cc + '16'].v : null;
        let y = 0;
        if (dvv instanceof Date) y = dvv.getFullYear();
        else if (typeof dvv === 'number' && dvv > 20000) y = new Date(Math.round((dvv - 25569) * 86400000)).getUTCFullYear();
        else { const mm = String(dvv ?? '').match(/(19|20)\d{2}/); y = mm ? Number(mm[0]) : 0; }
        const oi2 = num(cc + '25'), dep2 = num(cc + '26'), int2 = num(cc + '27'), pbt2 = num(cc + '28'), tax2 = num(cc + '29'), np2 = num(cc + '30');
        const op2 = g(pbt2) - g(oi2) + g(dep2) + g(int2);
        const yprice = num(cc + '90');
        const yeps = (Number.isFinite(np2) && sh > 0) ? np2 / sh : NaN;
        const ype = (Number.isFinite(yprice) && Number.isFinite(yeps) && yeps > 0) ? yprice / yeps : NaN;
        H.push({ yr: y, sales: s, opm: r1(s > 0 ? op2 / s * 100 : 0), tax: r1(pbt2 > 0 ? g(tax2) / pbt2 * 100 : 0), pe: Number.isFinite(ype) ? r1(ype) : 0 });
      }
      setHist(H);
      const recent = H.slice(-4);
      const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      const avgOpm = avg(recent.map((h) => h.opm).filter((x) => x > 0)) || opm;
      const avgTax = avg(recent.map((h) => h.tax).filter((x) => x > 0)) || taxPct;
      const peHistVals = H.map((h) => h.pe).filter((x) => x > 0);
      let peL = peLow, peH = peHigh, peSrc = 'kept your current band — pick a sector below for a peer band';
      if (peHistVals.length >= 2) { peL = r1(Math.min(...peHistVals)); peH = r1(Math.max(...peHistVals)); peSrc = `the stock's own year-end P/E range (${peL}–${peH}×)`; }
      else if (peHistVals.length === 1) { peL = r1(peHistVals[0] * 0.85); peH = r1(peHistVals[0] * 1.15); peSrc = `history (~${r1(peHistVals[0])}×, ±15%)`; }
      const depPct = sales > 0 ? dep / sales * 100 : 0;
      // ── auto-fill the FORWARD column: everything derives from history so you only
      //    have to type the revenue target (and nudge margin if you disagree).
      setFSales(r1(sales));                                  // ← you override this with the target
      setFOpm(r1(opm));                                      // margin HELD at the latest FY (current structure) — your knob
      setFOI(r1(oi));                                        // other income held flat (non-operating)
      setFInt(r1(intr));                                     // interest held flat (debt-driven)
      setFDep(r1(dep));                                      // dep auto-scales with revenue as you type
      setFTax(r1(taxPct));                                   // tax held at the latest effective rate
      setFOwner(r1(owner));                                  // owner share held at reported structure
      setPeLow(peL); setPeHigh(peH);
      setAuto([
        `OPM held at latest ${r1(opm)}% (hist ${recent.length}-yr avg ${r1(avgOpm)}%, range in hint — nudge if you expect margin change)`,
        `Depreciation scales with revenue (~${r1(depPct)}% of sales)`,
        `Other income ₹${r1(oi)} Cr & interest ₹${r1(intr)} Cr held flat (non-operating)`,
        `Tax held at latest ${r1(taxPct)}% (hist avg ${r1(avgTax)}%)`,
        `Owner share ${r1(owner)}%${owner < 97 ? ' (minority interest — reconciles EPS to reported)' : ''}`,
        `P/E band from ${peSrc}`,
      ]);
      const reportedEps = (Number.isFinite(np) && sh > 0) ? np / sh : NaN;
      setMsg(`Loaded ${st('B1') || 'company'} · base ${fy || '—'} · price ${rsFmt(px)} · ${g(sh).toFixed(2)} Cr shares · Sales ${crFmt(sales)} · reported EPS ${epsFmt(reportedEps)}. Forward assumptions auto-set from history — just type your revenue target →`);
    } catch (e: any) { setErr(e?.message || 'Could not read that file.'); }
  };

  const wf = (s: number, opm: number, oi: number, dep: number, intr: number, tax: number, owner: number, sh: number) => {
    const op = s * opm / 100;
    const pbt = op + oi - dep - intr;
    const pat = pbt * (1 - tax / 100) * (owner / 100);   // after tax AND minority interest → owners' profit
    const eps = sh > 0 ? pat / sh : 0;
    return { op, pbt, pat, eps };
  };
  const base = useMemo(() => wf(bSales, bOpm, bOI, bDep, bInt, bTax, bOwner, shares), [bSales, bOpm, bOI, bDep, bInt, bTax, bOwner, shares]);
  const fwd = useMemo(() => wf(fSales, fOpm, fOI, fDep, fInt, fTax, fOwner, fShares || shares), [fSales, fOpm, fOI, fDep, fInt, fTax, fOwner, fShares, shares]);
  const curPE = base.eps > 0 && price > 0 ? price / base.eps : 0;
  const tgtLow = fwd.eps * peLow, tgtHigh = fwd.eps * peHigh, tgtMid = fwd.eps * (peLow + peHigh) / 2;
  const upMid = price > 0 ? (tgtMid / price - 1) * 100 : 0;
  const yrs = Math.max(0.25, years || 1);
  const cagr = (t: number) => (price > 0 && t > 0 ? (Math.pow(t / price, 1 / yrs) - 1) * 100 : 0);
  const peerAvg = useMemo(() => { const xs = peers.split(/[^0-9.]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }, [peers]);
  const salesGrowth = bSales > 0 ? (fSales / bSales - 1) * 100 : 0;
  const upCol = upMid >= 25 ? 'var(--mc-bullish)' : upMid >= 0 ? 'var(--mc-cyan)' : 'var(--mc-bearish)';
  // typing the forward revenue auto-rescales depreciation (held at a constant % of
  // sales); other income & interest stay flat. This is why revenue is the only input
  // you must give — everything operating follows, and margin/tax are your knobs.
  const setFwdRevenue = (v: number) => { const depPct = bSales > 0 ? bDep / bSales : 0; setFSales(v); setFDep(r1(depPct * v)); };
  const impliedFwdPE = fwd.eps > 0 && price > 0 ? price / fwd.eps : 0;
  const latest = hist.length ? hist[hist.length - 1] : null;
  const cagrTo = (nBack: number) => {
    if (!latest || hist.length < 2) return 0;
    const target = latest.yr - nBack;
    let best = hist[0]; for (const h of hist) if (Math.abs(h.yr - target) < Math.abs(best.yr - target)) best = h;
    const dy = latest.yr - best.yr; return (dy > 0 && best.sales > 0) ? (Math.pow(latest.sales / best.sales, 1 / dy) - 1) * 100 : 0;
  };
  const cagr3 = cagrTo(3), cagr5 = cagrTo(5);
  const cagrMax = (() => { if (hist.length < 2) return 0; const f = hist[0], l = hist[hist.length - 1]; const dy = l.yr - f.yr; return (dy > 0 && f.sales > 0) ? (Math.pow(l.sales / f.sales, 1 / dy) - 1) * 100 : 0; })();
  const opmStats = (() => { const xs = hist.slice(-6).map((h) => h.opm).filter((x) => x > 0); if (!xs.length) return null; return { avg: xs.reduce((s, b) => s + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) }; })();
  const applyCagr = (c: number) => setFwdRevenue(r1(bSales * Math.pow(1 + c / 100, yrs)));
  const chipBtn: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, color: 'var(--mc-cyan)', background: 'transparent', border: '1px solid var(--mc-cyan)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' };

  const Waterfall = ({ w, tint }: { w: { op: number; pbt: number; pat: number; eps: number }; tint: string }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 11.5, color: DIM }}>
      <span>Op Profit <b style={{ color: TEXT, fontFamily: 'ui-monospace, monospace' }}>{crFmt(w.op)}</b></span>
      <span>PBT <b style={{ color: TEXT, fontFamily: 'ui-monospace, monospace' }}>{crFmt(w.pbt)}</b></span>
      <span>PAT <b style={{ color: TEXT, fontFamily: 'ui-monospace, monospace' }}>{crFmt(w.pat)}</b></span>
      <span>EPS <b style={{ color: tint, fontFamily: 'ui-monospace, monospace' }}>{epsFmt(w.eps)}</b></span>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 12.5, color: DIM, lineHeight: 1.6, marginBottom: 14 }}>
        <strong style={{ color: 'var(--mc-cyan)' }}>Fair value from a full P&amp;L build-up.</strong> Upload a Screener.in Excel (its <em>Data Sheet</em> tab) to auto-fill the latest year, or type it in. Set your <strong style={{ color: TEXT }}>forward target</strong> — revenue, OPM, tax — and it walks the P&amp;L down to forward EPS, then applies a peer P/E band to give a target-price range, upside, and the CAGR that implies.
      </div>

      {/* upload */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.25)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--mc-cyan)', cursor: 'pointer', border: '1px solid var(--mc-cyan)', borderRadius: 6, padding: '8px 14px' }}>
          📥 Upload Screener.in Excel
          <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] || null)} />
        </label>
        <div style={{ fontSize: 11.5, color: msg ? 'var(--mc-bullish)' : err ? 'var(--mc-bearish)' : DIM, lineHeight: 1.5, flex: 1, minWidth: 220 }}>
          {err ? `⚠ ${err}` : msg ? `✓ ${msg}` : 'The standard Screener.in export (with the START / Data Sheet tabs). Parses company, price, shares and the latest year’s Sales / Other Income / Dep / Interest / PBT / Tax automatically.'}
        </div>
      </div>

      {company && (
        <div style={{ fontSize: 13, fontWeight: 900, color: TEXT, marginBottom: 10 }}>{company}{baseYear ? <span style={{ color: DIM, fontWeight: 700, fontSize: 11.5 }}> · base {baseYear}</span> : null}</div>
      )}

      {/* shares + price */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <PLCell label="Current price (₹)" value={price} onChange={setPrice} />
        <PLCell label="Shares (Cr)" value={shares} onChange={(v) => { setShares(v); if (!fShares) setFShares(v); }} />
        <PLCell label="Current P/E (auto)" value={r1(curPE)} readOnly suffix="×" accent="var(--mc-warn)" />
      </div>

      {/* two-column P&L */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 8 }}>
        {/* CURRENT */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: DIM, letterSpacing: 0.5, marginBottom: 10 }}>📅 CURRENT {baseYear ? `· ${baseYear}` : '(base year)'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <PLCell label="Revenue" value={bSales} onChange={setBSales} suffix="Cr" />
            <PLCell label="OPM" value={bOpm} onChange={setBOpm} suffix="%" />
            <PLCell label="Other income" value={bOI} onChange={setBOI} suffix="Cr" />
            <PLCell label="Depreciation" value={bDep} onChange={setBDep} suffix="Cr" />
            <PLCell label="Interest" value={bInt} onChange={setBInt} suffix="Cr" />
            <PLCell label="Tax rate" value={bTax} onChange={setBTax} suffix="%" />
            <PLCell label="Owner share" value={bOwner} onChange={setBOwner} suffix="%" />
          </div>
          <Waterfall w={base} tint="var(--mc-warn)" />
          {bOwner < 97 && <div style={{ fontSize: 10, color: 'var(--mc-warn)', marginTop: 6, lineHeight: 1.5 }}>⚠ Owner share {r1(bOwner)}% — minority interest / associates take a cut before profit reaches shareholders. EPS here matches the <b>reported</b> number, not a naive PBT−tax. Keep this on the forward year unless the structure changes.</div>}
        </div>
        {/* FORWARD */}
        <div style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--mc-cyan)', letterSpacing: 0.5, marginBottom: 10 }}>🎯 FORWARD TARGET{salesGrowth ? ` · revenue ${salesGrowth > 0 ? '+' : ''}${Math.round(salesGrowth)}%` : ''}</div>
          <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>Type only <b style={{ color: 'var(--mc-cyan)' }}>Revenue</b> — dep auto-scales, the rest is auto-set from history. Nudge OPM if you have a margin view.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <PLCell label="Revenue (target)" value={fSales} onChange={setFwdRevenue} suffix="Cr" accent="var(--mc-cyan)" />
            <PLCell label="OPM" value={fOpm} onChange={setFOpm} suffix="%" />
            <PLCell label="Other income" value={fOI} onChange={setFOI} suffix="Cr" />
            <PLCell label="Depreciation" value={fDep} onChange={setFDep} suffix="Cr" />
            <PLCell label="Interest" value={fInt} onChange={setFInt} suffix="Cr" />
            <PLCell label="Tax rate" value={fTax} onChange={setFTax} suffix="%" />
            <PLCell label="Owner share" value={fOwner} onChange={setFOwner} suffix="%" />
          </div>
          {hist.length >= 2 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontSize: 10, color: DIM }}>Grow at hist CAGR × {yrs}yr:</span>
              {cagr3 > 0 && <button style={chipBtn} onClick={() => applyCagr(cagr3)}>3Y {r1(cagr3)}%</button>}
              {cagr5 > 0 && <button style={chipBtn} onClick={() => applyCagr(cagr5)}>5Y {r1(cagr5)}%</button>}
              {cagrMax > 0 && <button style={chipBtn} onClick={() => applyCagr(cagrMax)}>full {r1(cagrMax)}%</button>}
            </div>
          )}
          {opmStats && (
            <div style={{ fontSize: 10, marginTop: 6, color: fOpm > opmStats.max + 0.5 ? 'var(--mc-warn)' : DIM }}>
              Hist OPM avg <b>{r1(opmStats.avg)}%</b> · range {r1(opmStats.min)}–{r1(opmStats.max)}%{fOpm > opmStats.max + 0.5 ? ' — your OPM is above the historical peak ⚠' : ''}
            </div>
          )}
          <Waterfall w={fwd} tint="var(--mc-cyan)" />
        </div>
      </div>

      {auto.length > 0 && (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '11px 14px', marginBottom: 8, marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>⚙ Assumptions auto-applied to the forward year <span style={{ color: DIM, fontWeight: 600 }}>(all editable above)</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
            {auto.map((a, i) => <span key={i} style={{ fontSize: 10.5, color: DIM }}>• {a}</span>)}
          </div>
        </div>
      )}

      {/* exit multiple */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px', marginBottom: 16, marginTop: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: DIM, letterSpacing: 0.5, marginBottom: 10 }}>🏷️ EXIT MULTIPLE (P/E) &amp; HORIZON</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <PLCell label="P/E low" value={peLow} onChange={setPeLow} suffix="×" />
          <PLCell label="P/E high" value={peHigh} onChange={setPeHigh} suffix="×" />
          <PLCell label="Years to target" value={years} onChange={setYears} suffix="yr" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 210 }}>
            <span style={{ fontSize: 10.5, color: DIM, fontWeight: 700 }}>Sector → peer P/E band</span>
            <select value={sector} onChange={(e) => {
              const k = e.target.value; setSector(k);
              const hint = (SECTOR_CALCULATOR_MAP as any)[k]?.multipleHint || '';
              const m = hint.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
              if (m) { setPeLow(Number(m[1])); setPeHigh(Number(m[2])); }
            }} style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 9px', borderRadius: 4, fontSize: 12.5, fontWeight: 600 }}>
              <option value="">— pick sector for peer band —</option>
              {Object.keys(SECTOR_CALCULATOR_MAP).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {sector && (SECTOR_CALCULATOR_MAP as any)[sector]?.calc !== 'PE' && (
              <span style={{ fontSize: 9.5, color: 'var(--mc-warn)' }}>this sector is usually valued on {(SECTOR_CALCULATOR_MAP as any)[sector].calc.replace('_', '/')} — the P/E band is a rough proxy</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 10.5, color: DIM, fontWeight: 700 }}>Peer P/Es (comma-sep) → avg helper</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={peers} onChange={(e) => setPeers(e.target.value)} placeholder="e.g. 42, 55, 48"
                style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 9px', borderRadius: 4, fontSize: 13, fontFamily: 'ui-monospace, monospace', flex: 1, minWidth: 90 }} />
              {peerAvg > 0 && (
                <button onClick={() => { setPeLow(r1(peerAvg * 0.85)); setPeHigh(r1(peerAvg * 1.15)); }} title="Set band to peer-avg ±15%"
                  style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', background: 'transparent', border: '1px solid var(--mc-cyan)', borderRadius: 5, padding: '6px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>avg {r1(peerAvg)}× → band</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RESULT */}
      <div style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.08), rgba(16,185,129,0.05))', border: `1px solid ${upCol}55`, borderLeft: `4px solid ${upCol}`, borderRadius: 8, padding: '16px 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: TEXT, fontFamily: 'ui-monospace, monospace' }}>{epsFmt(fwd.eps)}</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>FORWARD EPS</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: impliedFwdPE > peHigh ? 'var(--mc-bearish)' : impliedFwdPE < peLow ? 'var(--mc-bullish)' : 'var(--mc-warn)', fontFamily: 'ui-monospace, monospace' }}>{r1(impliedFwdPE)}×</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>MARKET-IMPLIED FWD P/E</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: upCol, fontFamily: 'ui-monospace, monospace' }}>{rsFmt(tgtLow)}–{rsFmt(tgtHigh)}</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>TARGET PRICE ({peLow}–{peHigh}× P/E)</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: upCol, fontFamily: 'ui-monospace, monospace' }}>{upMid > 0 ? '+' : ''}{Math.round(upMid)}%</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>UPSIDE AT MIDPOINT</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: upCol, fontFamily: 'ui-monospace, monospace' }}>{cagr(tgtLow) > 0 ? '+' : ''}{Math.round(cagr(tgtLow))}–{Math.round(cagr(tgtHigh))}%</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>IMPLIED CAGR / {yrs}yr</div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: DIM, lineHeight: 1.6, marginTop: 12 }}>
          Forward Op Profit <b style={{ color: TEXT }}>{crFmt(fwd.op)}</b> → PBT <b style={{ color: TEXT }}>{crFmt(fwd.pbt)}</b> → PAT <b style={{ color: TEXT }}>{crFmt(fwd.pat)}</b> → EPS <b style={{ color: 'var(--mc-cyan)' }}>{epsFmt(fwd.eps)}</b>. At <b style={{ color: TEXT }}>{peLow}–{peHigh}×</b> that is <b style={{ color: upCol }}>{rsFmt(tgtLow)}–{rsFmt(tgtHigh)}</b> vs today’s <b style={{ color: TEXT }}>{rsFmt(price)}</b> (current P/E <b style={{ color: 'var(--mc-warn)' }}>{r1(curPE)}×</b>). {upMid >= 25 ? 'Base-case upside clears the 25% buy bar.' : upMid < 0 ? 'Priced above fair value at these assumptions — wait or raise the growth/margin case.' : 'Modest upside — check whether the forward P/E is really sustainable.'} Educational, not investment advice.
        </div>
      </div>
    </div>
  );
}

function PSCalculator() {
  const [ticker, setTicker] = useState('RUBICON');
  const [revenue, setRevenue] = useState(2995);
  const [bearPS, setBearPS] = useState(8);
  const [basePS, setBasePS] = useState(11.4);
  const [bullPS, setBullPS] = useState(15);
  const [marketCap, setMarketCap] = useState(21000);
  const [horizon, setHorizon] = useState(18);
  const [currentPrice, setCurrentPrice] = useState<number | undefined>();
  // PATCH 0636 — explicit shares state; locked from live API, user-overridable
  const [shares, setShares] = useState<number | undefined>();
  // PATCH 0696 — track "not in live universe" state to auto-focus + highlight
  // the Market Cap input so the user immediately knows where to type.
  const [notInUniverse, setNotInUniverse] = useState(false);
  const marketCapRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (notInUniverse && marketCapRef.current) {
      marketCapRef.current.focus();
      marketCapRef.current.select?.();
    }
  }, [notInUniverse]);
  const result = useMemo(() => calculatePS({
    ticker, currentMarketCapCr: marketCap, horizonMonths: horizon,
    forwardRevenueCr: revenue, bearPS, basePS, bullPS,
    currentPrice, sharesOutstandingCr: shares, currency: '₹',
  }), [ticker, marketCap, horizon, revenue, bearPS, basePS, bullPS, currentPrice, shares]);

  // PATCH 0636 — listen for EDIT events on this calculator
  useEffect(() => {
    const h = (e: any) => {
      const v = e?.detail as SavedValuation | undefined;
      if (!v || v.calcKind !== 'PS') return;
      const i = v.inputs as any;
      if (i.ticker) setTicker(i.ticker);
      if (i.forwardRevenueCr !== undefined) setRevenue(i.forwardRevenueCr);
      if (i.bearPS !== undefined) setBearPS(i.bearPS);
      if (i.basePS !== undefined) setBasePS(i.basePS);
      if (i.bullPS !== undefined) setBullPS(i.bullPS);
      if (i.currentMarketCapCr !== undefined) setMarketCap(i.currentMarketCapCr);
      if (i.horizonMonths !== undefined) setHorizon(i.horizonMonths);
      if (i.currentPrice !== undefined) setCurrentPrice(i.currentPrice);
      if (i.sharesOutstandingCr !== undefined) setShares(i.sharesOutstandingCr);
    };
    window.addEventListener('mc:load-valuation', h);
    return () => window.removeEventListener('mc:load-valuation', h);
  }, []);

  const loadExample = (key: keyof typeof WORKED_EXAMPLES) => {
    const ex = WORKED_EXAMPLES[key];
    if (ex.type !== 'PS') return;
    const i = ex.input;
    setTicker(i.ticker || '');
    setRevenue(i.forwardRevenueCr);
    setBearPS(i.bearPS); setBasePS(i.basePS); setBullPS(i.bullPS);
    setMarketCap(i.currentMarketCapCr); setHorizon(i.horizonMonths);
    // PATCH 0636 — reset shares + price so auto-fill (debounced 600ms) re-derives them.
    setShares(undefined); setCurrentPrice(undefined);
  };

  return (
    <div>
      <AutoFillBtn ticker={ticker} market="india" currentPrice={currentPrice} onNotInUniverse={setNotInUniverse /* PATCH 0696 */} onFill={(q) => {
        if (q.currentPrice) setCurrentPrice(q.currentPrice);
        if (q.currentMarketCapCr) setMarketCap(Math.round(q.currentMarketCapCr));
        // PATCH 0636 — set shares explicitly from live API so target-price math
        // doesn't drift when user manually overrides market cap later.
        if (q.sharesOutstandingCr) setShares(q.sharesOutstandingCr);
      }} />
      {/* PATCH 0673 — what-to-enter hint */}
      <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--mc-bg-4)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 3, fontSize: 11.5, color: TEXT, lineHeight: 1.55 }}>
        <div><strong style={{ color: 'var(--mc-cyan)' }}>What to enter:</strong> Forward revenue (₹ Cr) from management guidance or your own projection. Bear/Base/Bull P/S multiples — Base should be the stock's 5-yr median P/S (Screener shows this), not sector average.</div>
        <div style={{ marginTop: 4 }}><strong style={{ color: 'var(--mc-warn)' }}>Tip:</strong> Best for SaaS, growth, capex-heavy names where PAT is volatile but topline visibility is clean. Don't use for cyclicals at peak revenue (multiple compresses).</div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: DIM, alignSelf: 'center', marginRight: 4, fontWeight: 700 }}>EXAMPLES</span>
        <button onClick={() => loadExample('rubicon')} style={chipBtn('#22D3EE')}>Rubicon Research</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: DIM, fontWeight: 700, letterSpacing: '0.3px' }}>Ticker</span>
          <TickerCombo value={ticker} onChange={setTicker} market="india" onSelect={(h) => {
            // PATCH 0636 — on select fill the rest from the live hit instantly
            if (h.price) setCurrentPrice(h.price);
            if (h.marketCap) {
              const mcapCr = h.marketCap / 1e7;
              setMarketCap(Math.round(mcapCr));
              if (h.price) setShares(mcapCr / h.price);
            }
          }} />
        </label>
        <NumberInput label="Forward Revenue (FY27/FY28)" value={revenue} onChange={setRevenue} suffix="₹ Cr" />
        {/* PATCH 0696 — Market Cap input gets ref + yellow border + helper when ticker is not in live universe. */}
        <NumberInput label="Current Market Cap" value={marketCap} onChange={setMarketCap} suffix="₹ Cr" inputRef={marketCapRef} highlight={notInUniverse} ticker={ticker} />
        <NumberInput label="Horizon" value={horizon} onChange={setHorizon} suffix="months" />
        <NumberInput label="Bear P/S" value={bearPS} onChange={setBearPS} suffix="x" />
        <NumberInput label="Base P/S (5yr median)" value={basePS} onChange={setBasePS} suffix="x" />
        <NumberInput label="Bull P/S" value={bullPS} onChange={setBullPS} suffix="x" />
      </div>
      <CalcResultDisplay result={result} />
      <SaveValuationBar calcKind={(result.inputs as any)?.bearPS !== undefined ? 'PS' : (result.inputs as any)?.bearPE !== undefined ? 'PE' : 'EV_EBITDA'} result={result} />
    </div>
  );
}

function PECalculator() {
  const [ticker, setTicker] = useState('BAJAJCON');
  const [pat, setPat] = useState(190);
  const [bearPE, setBearPE] = useState(20);
  const [basePE, setBasePE] = useState(24);
  const [bullPE, setBullPE] = useState(30);
  const [marketCap, setMarketCap] = useState(2700);
  const [horizon, setHorizon] = useState(12);
  const [currentPrice, setCurrentPrice] = useState<number | undefined>();
  const [shares, setShares] = useState<number | undefined>();
  // PATCH 0696 — auto-focus / highlight Market Cap when not in live universe
  const [notInUniverse, setNotInUniverse] = useState(false);
  const marketCapRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (notInUniverse && marketCapRef.current) {
      marketCapRef.current.focus();
      marketCapRef.current.select?.();
    }
  }, [notInUniverse]);
  const result = useMemo(() => calculatePE({
    ticker, currentMarketCapCr: marketCap, horizonMonths: horizon,
    forwardPATCr: pat, bearPE, basePE, bullPE,
    currentPrice, sharesOutstandingCr: shares, currency: '₹',
  }), [ticker, marketCap, horizon, pat, bearPE, basePE, bullPE, currentPrice, shares]);

  // PATCH 0636 — EDIT event listener for P/E calc
  useEffect(() => {
    const h = (e: any) => {
      const v = e?.detail as SavedValuation | undefined;
      if (!v || v.calcKind !== 'PE') return;
      const i = v.inputs as any;
      if (i.ticker) setTicker(i.ticker);
      if (i.forwardPATCr !== undefined) setPat(i.forwardPATCr);
      if (i.bearPE !== undefined) setBearPE(i.bearPE);
      if (i.basePE !== undefined) setBasePE(i.basePE);
      if (i.bullPE !== undefined) setBullPE(i.bullPE);
      if (i.currentMarketCapCr !== undefined) setMarketCap(i.currentMarketCapCr);
      if (i.horizonMonths !== undefined) setHorizon(i.horizonMonths);
      if (i.currentPrice !== undefined) setCurrentPrice(i.currentPrice);
      if (i.sharesOutstandingCr !== undefined) setShares(i.sharesOutstandingCr);
    };
    window.addEventListener('mc:load-valuation', h);
    return () => window.removeEventListener('mc:load-valuation', h);
  }, []);

  const loadExample = (key: keyof typeof WORKED_EXAMPLES) => {
    const ex = WORKED_EXAMPLES[key];
    if (ex.type !== 'PE') return;
    const i = ex.input;
    setTicker(i.ticker || '');
    setPat(i.forwardPATCr);
    setBearPE(i.bearPE); setBasePE(i.basePE); setBullPE(i.bullPE);
    setMarketCap(i.currentMarketCapCr); setHorizon(i.horizonMonths);
    // PATCH 0636 — reset shares + price so auto-fill (debounced 600ms) re-derives them.
    setShares(undefined); setCurrentPrice(undefined);
  };

  return (
    <div>
      <AutoFillBtn ticker={ticker} market="india" currentPrice={currentPrice} onNotInUniverse={setNotInUniverse /* PATCH 0696 */} onFill={(q) => {
        if (q.currentPrice) setCurrentPrice(q.currentPrice);
        if (q.currentMarketCapCr) setMarketCap(Math.round(q.currentMarketCapCr));
        // PATCH 0636 — set shares explicitly from live API so target-price math
        // doesn't drift when user manually overrides market cap later.
        if (q.sharesOutstandingCr) setShares(q.sharesOutstandingCr);
      }} />
      {/* PATCH 0673 — what-to-enter hint */}
      <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--mc-bg-4)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 3, fontSize: 11.5, color: TEXT, lineHeight: 1.55 }}>
        <div><strong style={{ color: 'var(--mc-cyan)' }}>What to enter:</strong> Forward PAT (₹ Cr) from concall guidance or Bloomberg consensus. Bear/Base/Bull P/E — Base should be the stock&apos;s 5-yr trailing median P/E (Screener → Stock → &ldquo;Median PE&rdquo;), not sector average.</div>
        <div style={{ marginTop: 4 }}><strong style={{ color: 'var(--mc-warn)' }}>Tip:</strong> Best for FMCG, quality compounders, financials. Don't use for capex-heavy capital goods (PAT lags), pre-revenue tech (no earnings), or cyclicals at trough (PAT mis-states earning power).</div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: DIM, alignSelf: 'center', marginRight: 4, fontWeight: 700 }}>EXAMPLES</span>
        <button onClick={() => loadExample('bajajConsumer')} style={chipBtn('#22D3EE')}>Bajaj Consumer</button>
        <button onClick={() => loadExample('tdPower')} style={chipBtn('#22D3EE')}>TD Power</button>
        <button onClick={() => loadExample('sterlite')} style={chipBtn('#22D3EE')}>Sterlite (AI rerate)</button>
        <button onClick={() => loadExample('aeroflex')} style={chipBtn('#22D3EE')}>Aeroflex</button>
        <button onClick={() => loadExample('atlantaElectricals')} style={chipBtn('#22D3EE')}>Atlanta Electricals</button>
        <button onClick={() => loadExample('deeDev')} style={chipBtn('#22D3EE')}>DEE Development</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: DIM, fontWeight: 700, letterSpacing: '0.3px' }}>Ticker</span>
          <TickerCombo value={ticker} onChange={setTicker} market="india" onSelect={(h) => {
            // PATCH 0636 — on select fill the rest from the live hit instantly
            if (h.price) setCurrentPrice(h.price);
            if (h.marketCap) {
              const mcapCr = h.marketCap / 1e7;
              setMarketCap(Math.round(mcapCr));
              if (h.price) setShares(mcapCr / h.price);
            }
          }} />
        </label>
        <NumberInput label="Forward PAT (FY27)" value={pat} onChange={setPat} suffix="₹ Cr" />
        {/* PATCH 0696 — Market Cap input gets ref + yellow border + helper when ticker is not in live universe. */}
        <NumberInput label="Current Market Cap" value={marketCap} onChange={setMarketCap} suffix="₹ Cr" inputRef={marketCapRef} highlight={notInUniverse} ticker={ticker} />
        <NumberInput label="Horizon" value={horizon} onChange={setHorizon} suffix="months" />
        <NumberInput label="Bear P/E" value={bearPE} onChange={setBearPE} suffix="x" />
        <NumberInput label="Base P/E (5yr median)" value={basePE} onChange={setBasePE} suffix="x" />
        <NumberInput label="Bull P/E" value={bullPE} onChange={setBullPE} suffix="x" />
      </div>
      <CalcResultDisplay result={result} />
      <SaveValuationBar calcKind={(result.inputs as any)?.bearPS !== undefined ? 'PS' : (result.inputs as any)?.bearPE !== undefined ? 'PE' : 'EV_EBITDA'} result={result} />
    </div>
  );
}

function EvEbitdaCalculator() {
  const [ticker, setTicker] = useState('');
  const [ebitda, setEbitda] = useState(500);
  const [bear, setBear] = useState(12);
  const [base, setBase] = useState(18);
  const [bull, setBull] = useState(25);
  const [netDebt, setNetDebt] = useState(0);
  const [marketCap, setMarketCap] = useState(8000);
  const [horizon, setHorizon] = useState(18);
  const [currentPrice, setCurrentPrice] = useState<number | undefined>();
  const [shares, setShares] = useState<number | undefined>();
  // PATCH 0696 — auto-focus / highlight Market Cap when not in live universe
  const [notInUniverse, setNotInUniverse] = useState(false);
  const marketCapRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (notInUniverse && marketCapRef.current) {
      marketCapRef.current.focus();
      marketCapRef.current.select?.();
    }
  }, [notInUniverse]);
  const result = useMemo(() => calculateEvEbitda({
    ticker, currentMarketCapCr: marketCap, horizonMonths: horizon,
    forwardEBITDACr: ebitda, bearMultiple: bear, baseMultiple: base, bullMultiple: bull, netDebtCr: netDebt,
    currentPrice, sharesOutstandingCr: shares, currency: '₹',
  }), [ticker, marketCap, horizon, ebitda, bear, base, bull, netDebt, currentPrice, shares]);

  // PATCH 0636 — EDIT event listener for EV/EBITDA calc
  useEffect(() => {
    const h = (e: any) => {
      const v = e?.detail as SavedValuation | undefined;
      if (!v || v.calcKind !== 'EV_EBITDA') return;
      const i = v.inputs as any;
      if (i.ticker) setTicker(i.ticker);
      if (i.forwardEBITDACr !== undefined) setEbitda(i.forwardEBITDACr);
      if (i.bearMultiple !== undefined) setBear(i.bearMultiple);
      if (i.baseMultiple !== undefined) setBase(i.baseMultiple);
      if (i.bullMultiple !== undefined) setBull(i.bullMultiple);
      if (i.netDebtCr !== undefined) setNetDebt(i.netDebtCr);
      if (i.currentMarketCapCr !== undefined) setMarketCap(i.currentMarketCapCr);
      if (i.horizonMonths !== undefined) setHorizon(i.horizonMonths);
      if (i.currentPrice !== undefined) setCurrentPrice(i.currentPrice);
      if (i.sharesOutstandingCr !== undefined) setShares(i.sharesOutstandingCr);
    };
    window.addEventListener('mc:load-valuation', h);
    return () => window.removeEventListener('mc:load-valuation', h);
  }, []);

  return (
    <div>
      <AutoFillBtn ticker={ticker} market="india" currentPrice={currentPrice} onNotInUniverse={setNotInUniverse /* PATCH 0696 */} onFill={(q) => {
        if (q.currentPrice) setCurrentPrice(q.currentPrice);
        if (q.currentMarketCapCr) setMarketCap(Math.round(q.currentMarketCapCr));
        // PATCH 0636 — set shares explicitly from live API so target-price math
        // doesn't drift when user manually overrides market cap later.
        if (q.sharesOutstandingCr) setShares(q.sharesOutstandingCr);
      }} />
      {/* PATCH 0673 — what-to-enter hint */}
      <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--mc-bg-4)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 3, fontSize: 11.5, color: TEXT, lineHeight: 1.55 }}>
        <div><strong style={{ color: 'var(--mc-cyan)' }}>What to enter:</strong> Forward EBITDA (₹ Cr) from guidance — usually mgmt gives margin %, multiply by forward revenue. Net Debt = Total Debt − Cash (from balance sheet). Bear/Base/Bull multiple — Base = stock's 5-yr median EV/EBITDA.</div>
        <div style={{ marginTop: 4 }}><strong style={{ color: 'var(--mc-warn)' }}>Tip:</strong> Best for cyclicals, industrials, leveraged businesses where PAT is distorted by depreciation/interest. Apply 12-18× for cyclicals, 18-25× for premium industrials, 25-35× for niche precision/chemistry premium names.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: DIM, fontWeight: 700, letterSpacing: '0.3px' }}>Ticker</span>
          <TickerCombo value={ticker} onChange={setTicker} market="india" onSelect={(h) => {
            // PATCH 0636 — on select fill the rest from the live hit instantly
            if (h.price) setCurrentPrice(h.price);
            if (h.marketCap) {
              const mcapCr = h.marketCap / 1e7;
              setMarketCap(Math.round(mcapCr));
              if (h.price) setShares(mcapCr / h.price);
            }
          }} />
        </label>
        <NumberInput label="Forward EBITDA" value={ebitda} onChange={setEbitda} suffix="₹ Cr" />
        <NumberInput label="Net Debt" value={netDebt} onChange={setNetDebt} suffix="₹ Cr" />
        {/* PATCH 0696 — Market Cap input gets ref + yellow border + helper when ticker is not in live universe. */}
        <NumberInput label="Current Market Cap" value={marketCap} onChange={setMarketCap} suffix="₹ Cr" inputRef={marketCapRef} highlight={notInUniverse} ticker={ticker} />
        <NumberInput label="Horizon" value={horizon} onChange={setHorizon} suffix="months" />
        <NumberInput label="Bear EV/EBITDA" value={bear} onChange={setBear} suffix="x" />
        <NumberInput label="Base EV/EBITDA" value={base} onChange={setBase} suffix="x" />
        <NumberInput label="Bull EV/EBITDA" value={bull} onChange={setBull} suffix="x" />
      </div>
      <CalcResultDisplay result={result} />
      <SaveValuationBar calcKind={(result.inputs as any)?.bearPS !== undefined ? 'PS' : (result.inputs as any)?.bearPE !== undefined ? 'PE' : 'EV_EBITDA'} result={result} />
    </div>
  );
}

const chipBtn = (color: string): React.CSSProperties => ({
  fontSize: 11, padding: '4px 10px',
  background: `${color}15`, border: `1px solid ${color}50`,
  color, borderRadius: 4, cursor: 'pointer', fontWeight: 700,
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTOR SCENARIOS (PATCH 0674)
//
// Real-time worked example for ONE representative company per sector row.
// Triggered when user expands the sector row in the lookup table.
// Same calc the user would run by hand — input table → math → fair value.
// All inputs are approximate (TTM revenue, mcap) — marked with ~.
// ═══════════════════════════════════════════════════════════════════════════

interface SectorScenario {
  ticker: string;
  company: string;
  method: 'PE' | 'PS' | 'EV_EBITDA';
  // Input
  driverLabel: string;   // "Forward PAT (FY27)" / "Forward Revenue (FY27)" / "Forward EBITDA (FY27)"
  driverValue: number;   // ₹ Cr
  multiple: number;      // base multiple
  currentMcap: number;   // ₹ Cr
  netDebt?: number;      // for EV/EBITDA
  // Note for analyst
  rationale: string;
}

const SECTOR_SCENARIOS: Record<string, SectorScenario> = {
  'Industrials / Capital Goods': {
    ticker: 'TDPOWERSYS', company: 'TD Power Systems', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 240, multiple: 35,
    currentMcap: 6800,
    rationale: 'Generator OEM with order-book backed FY27 revenue ₹2,200+ Cr guidance. PAT margin ~10%. Base P/E 35× for industrial cycle midpoint.',
  },
  'Defence': {
    ticker: 'HAL', company: 'Hindustan Aeronautics', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 9500, multiple: 40,
    currentMcap: 380000,
    rationale: 'PSU defence prime with multi-year order book. PE 30-50× sustainable on Govt-backed visibility. Discount premium when order intake decelerates.',
  },
  'Power / Transmission': {
    ticker: 'ATLANTAELE', company: 'Atlanta Electricals', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27)', driverValue: 180, multiple: 22,
    currentMcap: 3800, netDebt: 50,
    rationale: 'Power transformer manufacturer; capex cycle premium. EV/EBITDA 18-28× on China+1 mfg shift + grid modernization tailwind.',
  },
  'Pharmaceuticals': {
    ticker: 'RUBICON', company: 'Rubicon Research', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 220, multiple: 38,
    currentMcap: 8500,
    rationale: 'USFDA-approved specialty pharma. PE 30-45× sustainable on patent-pipeline visibility. Apply margin-pressure discount if generics pricing softens.',
  },
  'Specialty Chemicals': {
    ticker: 'NEOGEN', company: 'Neogen Chemicals', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27)', driverValue: 250, multiple: 25,
    currentMcap: 7200, netDebt: 200,
    rationale: 'Bromine specialty chemistry with CDMO contracts. Premium EV/EBITDA 20-30× on long-cycle visibility + import-substitution moat.',
  },
  'Consumer Durables / FMCG': {
    ticker: 'TITAN', company: 'Titan Company', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 5200, multiple: 55,
    currentMcap: 320000,
    rationale: 'Quality moat / category leader. PE 40-70× justifiable on brand pricing power + retail expansion. Stretches at cycle peak.',
  },
  'Auto Components': {
    ticker: 'CEAT', company: 'CEAT Tyres', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27)', driverValue: 1800, multiple: 14,
    currentMcap: 17500, netDebt: 1200,
    rationale: 'Auto-cycle exposure. EV/EBITDA 12-18× at cycle midpoint. Apply 0.8× multiple at cycle peak (raw material pressure ahead).',
  },
  'Financial Services / NBFC': {
    ticker: 'BAJFINANCE', company: 'Bajaj Finance', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 22000, multiple: 25,
    currentMcap: 480000,
    rationale: 'Premier NBFC. PE 18-28× pegged to ROE 22-25%. Higher ROE = higher multiple. Watch for credit-cost spikes that compress PE.',
  },
  'IT / Tech Services': {
    ticker: 'INFY', company: 'Infosys', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 30000, multiple: 26,
    currentMcap: 750000,
    rationale: 'Large-cap IT services. PE 20-35× tied to USD revenue growth + margin trajectory. Tighter band than 5-yr median during deal-velocity slowdown.',
  },
  'SaaS / Software (US)': {
    ticker: 'CRWD', company: 'CrowdStrike', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $M)', driverValue: 4500, multiple: 16,
    currentMcap: 88000,
    rationale: 'Rule-of-40 SaaS. P/S 8-25× tied to ARR growth + FCF margin. Premium 15-25× when both >25%. Avoid <Rule-of-30 names.',
  },
  'Pre-revenue / Growth': {
    ticker: 'CRDO', company: 'Credo Technology', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $M)', driverValue: 420, multiple: 18,
    currentMcap: 8500,
    rationale: 'Pre-profit growth name. P/S only — earnings noisy. Watch gross margin trajectory — must trend toward 50%+ for the multiple to compound.',
  },
  'AI Compute & Infrastructure (US)': {
    ticker: 'NVDA', company: 'NVIDIA', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $B)', driverValue: 220, multiple: 18,
    currentMcap: 4200000,
    rationale: 'AI capex cycle. P/S 12-30× justified by GPU monopoly + 75%+ gross margins. Track Blackwell adoption + hyperscaler capex announcements.',
  },
  'AI Infrastructure (India)': {
    ticker: 'KAYNES', company: 'Kaynes Technology', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 600, multiple: 50,
    currentMcap: 35000,
    rationale: 'ESDM (electronics manufacturing services) premium. PE 35-60× on India semicon push + capex-cycle order book. Stretches if PLI subsidies normalise.',
  },
  'Robotics & Automation': {
    ticker: 'ABB', company: 'ABB India', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 1900, multiple: 52,
    currentMcap: 120000,
    rationale: 'Industrial automation premium. PE 40-65× on India automation tailwind. Multiple compresses when order intake decelerates >2 consecutive quarters.',
  },
  'EV / Battery / Charging': {
    ticker: 'EXIDEIND', company: 'Exide Industries', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27)', driverValue: 2400, multiple: 22,
    currentMcap: 42000, netDebt: 800,
    rationale: 'Legacy lead-acid + lithium-ion capex. EV/EBITDA 18-30× as EV adoption scales. Watch capex-EBITDA ratio (>1.5× = stretched).',
  },
  'Nuclear / Clean Energy (US)': {
    ticker: 'CEG', company: 'Constellation Energy', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27 $B)', driverValue: 5.2, multiple: 22,
    currentMcap: 95000, netDebt: 8000,
    rationale: 'PPA-linked nuclear power producer. EV/EBITDA 18-30× on 20-yr contract visibility. Premium when AI hyperscalers sign long-term PPAs.',
  },
  'Rail / Metro / Mobility': {
    ticker: 'TITAGARH', company: 'Titagarh Rail Systems', method: 'PE',
    driverLabel: 'Forward PAT (FY27)', driverValue: 480, multiple: 32,
    currentMcap: 18000,
    rationale: 'Rail/metro coach maker. PE 25-40× on Vande Bharat + metro order pipeline. Order-book to revenue ratio >3× justifies upper band.',
  },
  'Critical Minerals / Rare Earth (US)': {
    ticker: 'MP', company: 'MP Materials', method: 'EV_EBITDA',
    driverLabel: 'Forward EBITDA (FY27 $M)', driverValue: 220, multiple: 15,
    currentMcap: 4200, netDebt: 700,
    rationale: 'Rare-earth supply-crunch optionality. EV/EBITDA 10-22× volatile on REE pricing. Apply lower band — China pricing risk is non-trivial.',
  },
  'GLP-1 / Healthcare (US)': {
    ticker: 'LLY', company: 'Eli Lilly', method: 'PE',
    driverLabel: 'Forward PAT (FY27 $B)', driverValue: 22, multiple: 38,
    currentMcap: 850000,
    rationale: 'GLP-1 patent runway 8-12 years. PE 30-50× sustainable until biosimilars arrive (~2032+). Discount as patent cliff approaches.',
  },
  'Cybersecurity (US)': {
    ticker: 'PANW', company: 'Palo Alto Networks', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $B)', driverValue: 13, multiple: 14,
    currentMcap: 130000,
    rationale: 'Cloud-native cyber leader. P/S 10-25× on platform consolidation theme. Premium when Next-Gen Security ARR growth >35%.',
  },
  'Quantum / Frontier Tech': {
    ticker: 'IONQ', company: 'IonQ', method: 'PS',
    driverLabel: 'Forward Revenue (FY27 $M)', driverValue: 130, multiple: 35,
    currentMcap: 8000,
    rationale: 'Pre-commercial quantum. P/S highly volatile — narrative-driven. Only size at <2% portfolio; multiple compresses fast on competitive announcements.',
  },
};

function SectorScenarioRow({ sector, scenario }: { sector: string; scenario: SectorScenario }) {
  const isPE = scenario.method === 'PE';
  const isPS = scenario.method === 'PS';
  // const isEV = scenario.method === 'EV_EBITDA';
  let fairMcap: number;
  let stepCalc: string;
  if (isPE) {
    fairMcap = scenario.driverValue * scenario.multiple;
    stepCalc = `₹${scenario.driverValue} Cr PAT × ${scenario.multiple}× P/E`;
  } else if (isPS) {
    fairMcap = scenario.driverValue * scenario.multiple;
    stepCalc = `₹${scenario.driverValue} × ${scenario.multiple}× P/S`;
  } else {
    const ev = scenario.driverValue * scenario.multiple;
    fairMcap = ev - (scenario.netDebt || 0);
    stepCalc = `EV ₹${ev} Cr − net debt ₹${scenario.netDebt || 0} Cr`;
  }
  const upside = ((fairMcap / scenario.currentMcap) - 1) * 100;
  const color = upside >= 25 ? '#10B981' : upside >= 0 ? '#22D3EE' : upside >= -25 ? '#F59E0B' : '#EF4444';
  return (
    <tr style={{ background: 'var(--mc-bg-0)' }}>
      <td colSpan={4} style={{ padding: '12px 18px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ background: 'var(--mc-bg-1)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 4, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)' }}>SCENARIO →</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{scenario.ticker}</span>
            <span style={{ fontSize: 11, color: DIM }}>({scenario.company})</span>
          </div>
          <div style={{ fontSize: 11.5, color: TEXT, lineHeight: 1.6, marginBottom: 10 }}>
            <strong style={{ color: 'var(--mc-warn)' }}>Why this multiple:</strong> {scenario.rationale}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
            <tbody>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={{ padding: '5px 0', color: DIM, width: 200 }}>{scenario.driverLabel} <span style={{ color: 'var(--mc-warn)' }}>~</span></td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: TEXT, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>₹{scenario.driverValue.toLocaleString('en-IN')} Cr</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={{ padding: '5px 0', color: DIM }}>Base multiple</td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: TEXT, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{scenario.multiple}× ({scenario.method === 'PE' ? 'P/E' : scenario.method === 'PS' ? 'P/S' : 'EV/EBITDA'})</td>
              </tr>
              {scenario.netDebt !== undefined && (
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '5px 0', color: DIM }}>Net debt <span style={{ color: 'var(--mc-warn)' }}>~</span></td>
                  <td style={{ padding: '5px 0', textAlign: 'right', color: TEXT, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>₹{scenario.netDebt.toLocaleString('en-IN')} Cr</td>
                </tr>
              )}
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={{ padding: '5px 0', color: DIM }}>Current market cap <span style={{ color: 'var(--mc-warn)' }}>~</span></td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: TEXT, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>₹{scenario.currentMcap.toLocaleString('en-IN')} Cr</td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <td style={{ padding: '5px 0', color: TEXT, fontWeight: 700 }}>Fair value calc</td>
                <td style={{ padding: '5px 0', textAlign: 'right', color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{stepCalc}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color }}>
              FAIR VALUE → ₹{Math.round(fairMcap).toLocaleString('en-IN')} Cr
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color, fontFamily: 'ui-monospace, monospace' }}>
              {upside >= 0 ? '+' : ''}{upside.toFixed(0)}% upside
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: DIM, fontStyle: 'italic' }}>
            All inputs marked ~ are approximate (used the sector-typical FY27 driver). Swap in fresh numbers from the live calculator above for precise output. Tilde (~) marks approximate; multiples and rationale are sector-standard.
          </div>
        </div>
      </td>
    </tr>
  );
}

function SectorLookupPanel() {
  const [openSector, setOpenSector] = useState<string | null>(null);
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '16px 18px' }}>
      <h2 style={{ margin: '0 0 4px 0', fontSize: 16, fontWeight: 800, color: TEXT }}>
        📋 Sector → Calculator Lookup
      </h2>
      <div style={{ fontSize: 11, color: DIM, marginBottom: 12, lineHeight: 1.5 }}>
        Match your name&apos;s sector → use the listed calculator → benchmark against the multiple hint.{' '}
        <strong style={{ color: 'var(--mc-cyan)' }}>Click any sector row</strong> to see a real-time worked scenario with a representative company (TTM driver, multiple, fair value, upside).
      </div>
      <div style={{ overflow: 'auto', border: `1px solid ${BORDER}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--mc-bg-4)' }}>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', borderBottom: `1px solid ${BORDER}` }}>SECTOR</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', borderBottom: `1px solid ${BORDER}`, width: 110 }}>CALCULATOR</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', borderBottom: `1px solid ${BORDER}`, width: 280 }}>MULTIPLE RANGE</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', borderBottom: `1px solid ${BORDER}` }}>EXAMPLE COMPANIES</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(SECTOR_CALCULATOR_MAP).map(([sector, conf], i) => {
              const scenario = SECTOR_SCENARIOS[sector];
              const isOpen = openSector === sector;
              return (
                <React.Fragment key={sector}>
                  <tr
                    onClick={() => setOpenSector(isOpen ? null : sector)}
                    style={{ background: i % 2 === 0 ? 'var(--mc-bg-0)' : 'var(--mc-bg-1)', cursor: scenario ? 'pointer' : 'default' }}>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: TEXT, fontWeight: 700, borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' }}>
                      {scenario && (<span style={{ marginRight: 6, color: 'var(--mc-cyan)', fontSize: 11, fontWeight: 800 }}>{isOpen ? '▼' : '▶'}</span>)}
                      {sector}
                    </td>
                    <td style={{ padding: '12px 12px', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' }}>
                      <span style={{ fontSize: 11, color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', padding: '3px 9px', borderRadius: 4, fontFamily: 'ui-monospace, monospace', fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {conf.calc === 'EV_EBITDA' ? 'EV / EBITDA' : conf.calc === 'PS' ? 'P / S' : 'P / E'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 12, color: 'var(--mc-text-2)', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top', lineHeight: 1.5 }}>
                      {conf.multipleHint}
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {conf.examples.map((ex) => (
                          <span key={ex} style={{
                            fontSize: 11, padding: '3px 8px',
                            background: 'var(--mc-bg-4)', border: '1px solid #2A3A55',
                            color: TEXT, borderRadius: 4, fontWeight: 600,
                            fontFamily: 'ui-monospace, monospace',
                            whiteSpace: 'nowrap',
                          }}>
                            {ex}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {isOpen && scenario && <SectorScenarioRow sector={sector} scenario={scenario} />}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LEARN TAB (PATCH 0658)
//
// Institutional catalog of how managements give forward guidance and how
// to derive fair-value upside from each phrasing. 12 patterns total,
// drawn from a 23-company sample. Each pattern has:
//   - Description
//   - Example phrasings (real company quotes)
//   - Variables you need
//   - Formula
//   - Worked example with real numbers
//   - Fair value + upside derivation
// ═══════════════════════════════════════════════════════════════════════════

interface GuidanceMethod {
  id: string;
  emoji: string;
  title: string;
  description: string;
  examples: Array<{ company: string; quote: string }>;
  variables: string[];
  formula: string[];          // multi-line monospace
  worked: {
    company: string;
    inputs: Array<{ label: string; value: string }>;
    steps: Array<{ label: string; calc: string; result: string }>;
    fairValue: string;
    upside: string;
  };
  tips?: string[];
}

const GUIDANCE_METHODS: GuidanceMethod[] = [
  {
    id: 'revenue-growth-pct',
    emoji: '📈',
    title: 'Revenue Growth % (single year)',
    description: 'Management gives a single percentage growth target for one specific fiscal year. The cleanest, most common form. Apply growth to current TTM revenue to get forward revenue, then multiply by sector multiple.',
    examples: [
      { company: 'MTAR Technologies', quote: '50% revenue growth for FY27' },
      { company: 'Acutaas Chemicals', quote: '30% revenue growth for FY26' },
      { company: 'Lumax Auto', quote: 'Revenue growth guidance revised to 30% for FY26' },
      { company: 'Sterlite Tech', quote: '20%+ YoY revenue growth for FY26' },
    ],
    variables: ['Current TTM revenue (₹ Cr)', 'Growth guidance %', 'Sector P/S multiple', 'Current market cap (₹ Cr)'],
    formula: [
      'Forward Revenue = TTM Revenue × (1 + Growth%/100)',
      'Target Market Cap = Forward Revenue × Sector P/S Multiple',
      'Upside % = (Target Mcap / Current Mcap − 1) × 100',
    ],
    worked: {
      company: 'MTAR Technologies — "50% revenue growth for FY27"',
      inputs: [
        { label: 'TTM Revenue (FY26)', value: '₹876 Cr' },
        { label: 'Growth Guidance', value: '50%' },
        { label: 'Defence P/S Multiple (base)', value: '10×' },
        { label: 'Current Market Cap', value: '₹17,675 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward Revenue', calc: '₹876 × (1 + 0.50)', result: '₹1,314 Cr' },
        { label: 'Step 2 — Target Market Cap', calc: '₹1,314 × 10', result: '₹13,140 Cr' },
        { label: 'Step 3 — Upside %', calc: '(13,140 / 17,675) − 1', result: '−26%' },
      ],
      fairValue: '₹13,140 Cr',
      upside: '−26% (stock trading above fair value at base case)',
    },
    tips: [
      'Always check whether guidance is conservative or stretch — discount stretch by 20-30% for base case.',
      'Use sector P/S median or trailing 5yr median, not all-time high.',
    ],
  },
  {
    id: 'revenue-growth-range',
    emoji: '📊',
    title: 'Revenue Growth % Range',
    description: 'Management gives a range (e.g. 18-20%). Use the midpoint for base case, low end for bear, high end for bull. This is the institutional standard for scenario analysis.',
    examples: [
      { company: 'GNG Electronics', quote: 'Revenue growth guidance revised upward to 28-30% for FY26' },
      { company: 'Inox India', quote: '18-20% revenue growth guidance for FY27' },
      { company: 'Aimtron Electronics', quote: '40-50% CAGR revenue growth guidance for FY26' },
    ],
    variables: ['TTM Revenue', 'Growth low %', 'Growth high %', 'Multiple bands (bear/base/bull)'],
    formula: [
      'Bear Revenue = TTM × (1 + LowGrowth/100)',
      'Base Revenue = TTM × (1 + MidGrowth/100)',
      'Bull Revenue = TTM × (1 + HighGrowth/100)',
      'For each scenario: Target Mcap = Revenue × Multiple',
    ],
    worked: {
      company: 'Inox India — "18-20% revenue growth guidance for FY27"',
      inputs: [
        { label: 'TTM Revenue (FY26)', value: '₹1,200 Cr' },
        { label: 'Growth Low / High', value: '18% / 20%' },
        { label: 'Midpoint (Base)', value: '19%' },
        { label: 'P/S Bear / Base / Bull', value: '8× / 11× / 14×' },
        { label: 'Current Market Cap', value: '₹14,000 Cr' },
      ],
      steps: [
        { label: 'Bear case (18% × 8×)', calc: '1,200 × 1.18 × 8', result: '₹11,328 Cr → −19%' },
        { label: 'Base case (19% × 11×)', calc: '1,200 × 1.19 × 11', result: '₹15,708 Cr → +12%' },
        { label: 'Bull case (20% × 14×)', calc: '1,200 × 1.20 × 14', result: '₹20,160 Cr → +44%' },
      ],
      fairValue: '₹15,708 Cr (base case)',
      upside: '+12% base, with −19% downside / +44% upside scenario spread',
    },
  },
  {
    id: 'multi-year-cagr',
    emoji: '🚀',
    title: 'Multi-Year CAGR (3-5 years)',
    description: 'Management gives a CAGR over a longer horizon. Compound growth across the full window, then apply terminal multiple. Best for compounders with multi-year visibility.',
    examples: [
      { company: 'Emcure Pharmaceuticals', quote: 'Low to mid-teens revenue CAGR over 3-5 years' },
      { company: 'Sai Life Sciences', quote: '15-20% revenue CAGR over 3-5 years; EBITDA margin 28-30% by FY27' },
      { company: 'Aimtron Electronics', quote: '40-50% CAGR revenue growth guidance for FY26' },
    ],
    variables: ['TTM Revenue', 'CAGR %', 'Years (N)', 'Terminal Multiple'],
    formula: [
      'Forward Revenue (Year N) = TTM × (1 + CAGR/100)^N',
      'Target Market Cap = Forward Revenue × Terminal Multiple',
      'Annualized Upside = (Target/Current)^(1/N) − 1',
    ],
    worked: {
      company: 'Sai Life Sciences — "15-20% CAGR over 3-5 years"',
      inputs: [
        { label: 'TTM Revenue (FY26)', value: '₹1,500 Cr' },
        { label: 'CAGR (midpoint)', value: '17.5%' },
        { label: 'Horizon', value: '4 years' },
        { label: 'Pharma CDMO P/S (base)', value: '12×' },
        { label: 'Current Market Cap', value: '₹14,000 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward Revenue (4yr)', calc: '1,500 × (1.175)^4', result: '₹2,852 Cr' },
        { label: 'Step 2 — Target Mcap', calc: '2,852 × 12', result: '₹34,224 Cr' },
        { label: 'Step 3 — Total upside', calc: '(34,224 / 14,000) − 1', result: '+144%' },
        { label: 'Step 4 — Annualized', calc: '(34,224/14,000)^(1/4) − 1', result: '+25% CAGR' },
      ],
      fairValue: '₹34,224 Cr',
      upside: '+144% total / +25% annualized (4yr horizon)',
    },
    tips: [
      'Discount the bull-end CAGR by 20% for base case — most companies miss their stretch.',
      'Re-rate multiple downward if growth decelerates in years 4-5 (use 80% of base multiple for terminal).',
    ],
  },
  {
    id: 'absolute-revenue',
    emoji: '💰',
    title: 'Absolute Revenue ₹ Cr (specific FY)',
    description: 'Management gives an explicit ₹ Cr revenue number for a specific year. The easiest case — no growth math, just apply multiple directly.',
    examples: [
      { company: 'HFCL', quote: 'OFC Revenue: ₹3,500 crores in FY27 (from ₹2,400 crores in FY26)' },
      { company: 'TD Power Systems', quote: 'FY27 Revenue guidance: ₹2,200+ crores (conservative)' },
      { company: 'Sansera Engineering', quote: 'ADS Revenue: ₹550-600 crores for FY27' },
      { company: 'Quality Power Electrical', quote: '₹700-800 crores revenue guidance for FY26' },
    ],
    variables: ['Forward Revenue ₹ Cr (direct from guidance)', 'Sector Multiple', 'Current Market Cap'],
    formula: [
      'Target Market Cap = Guided Revenue × Multiple',
      'Upside % = (Target / Current Mcap − 1) × 100',
    ],
    worked: {
      company: 'TD Power Systems — "₹2,200+ Cr FY27 revenue (conservative)"',
      inputs: [
        { label: 'Guided Revenue FY27', value: '₹2,200 Cr (floor)' },
        { label: 'Industrial Cap-goods P/S (base)', value: '5×' },
        { label: 'Current Market Cap', value: '₹6,800 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Target Mcap', calc: '2,200 × 5', result: '₹11,000 Cr' },
        { label: 'Step 2 — Upside', calc: '(11,000 / 6,800) − 1', result: '+62%' },
      ],
      fairValue: '₹11,000 Cr (base, conservative)',
      upside: '+62% — "conservative" framing means upper scenarios likely larger',
    },
    tips: [
      'When guidance says "conservative" or "minimum" — these are floor numbers. Treat as your BEAR case.',
      '"Stretch" or "ambition" → these are bull-case anchors, not base case.',
    ],
  },
  {
    id: 'absolute-pat',
    emoji: '💵',
    title: 'Absolute PAT ₹ Cr (specific FY)',
    description: 'Management gives an absolute PAT target. Apply P/E multiple directly. Best when you have a clean profit number with sustainable tax rate.',
    examples: [
      { company: 'Hypothetical', quote: '₹400 Cr PAT in FY27' },
      { company: 'Hypothetical', quote: 'PAT target ₹250-300 Cr for FY28' },
    ],
    variables: ['Forward PAT ₹ Cr', 'Sector P/E Multiple', 'Current Market Cap'],
    formula: [
      'Target Market Cap = Forward PAT × P/E Multiple',
      'Upside % = (Target / Current Mcap − 1) × 100',
    ],
    worked: {
      company: 'Hypothetical — "₹400 Cr PAT in FY27"',
      inputs: [
        { label: 'Guided PAT FY27', value: '₹400 Cr' },
        { label: 'Sector P/E (Defence 30-50×)', value: '40× (base)' },
        { label: 'Current Market Cap', value: '₹12,000 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Target Mcap', calc: '400 × 40', result: '₹16,000 Cr' },
        { label: 'Step 2 — Upside', calc: '(16,000 / 12,000) − 1', result: '+33%' },
      ],
      fairValue: '₹16,000 Cr',
      upside: '+33% — base case',
    },
    tips: [
      'Always check effective tax rate. MAT credits / SEZ benefits can normalize, dropping PAT growth.',
      'Apply tighter P/E band when guidance has lumpy quarters (e.g. order-book-driven defence/infra).',
    ],
  },
  {
    id: 'ebitda-margin',
    emoji: '🎯',
    title: 'EBITDA Margin Guidance',
    description: 'Management gives target EBITDA margin for forward year. Combine with revenue projection to derive forward EBITDA, then apply EV/EBITDA multiple.',
    examples: [
      { company: 'DEE Development', quote: '18% to 20% EBITDA margin guidance for FY27' },
      { company: 'Navin Fluorine', quote: '30%+ EBITDA margin guidance for FY26' },
      { company: 'Quality Power Electrical', quote: '22%+ EBITDA margin guidance for FY26' },
      { company: 'Azad Engineering', quote: '33-35% EBITDA margin sustainable over a long period' },
    ],
    variables: ['Forward Revenue', 'Guided EBITDA Margin %', 'EV/EBITDA Multiple', 'Net Debt'],
    formula: [
      'Forward EBITDA = Forward Revenue × (EBITDA Margin / 100)',
      'Enterprise Value (EV) = Forward EBITDA × EV/EBITDA Multiple',
      'Equity Value = EV − Net Debt',
      'Upside % = (Equity Value / Current Mcap − 1) × 100',
    ],
    worked: {
      company: 'DEE Development — "18-20% EBITDA margin FY27" + revenue assumed ₹1,400 Cr',
      inputs: [
        { label: 'Forward Revenue (FY27)', value: '₹1,400 Cr' },
        { label: 'EBITDA Margin (mid)', value: '19%' },
        { label: 'EV/EBITDA (Engineering)', value: '15× (base)' },
        { label: 'Net Debt', value: '₹50 Cr' },
        { label: 'Current Market Cap', value: '₹2,800 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward EBITDA', calc: '1,400 × 0.19', result: '₹266 Cr' },
        { label: 'Step 2 — Enterprise Value', calc: '266 × 15', result: '₹3,990 Cr' },
        { label: 'Step 3 — Equity Value', calc: '3,990 − 50', result: '₹3,940 Cr' },
        { label: 'Step 4 — Upside', calc: '(3,940 / 2,800) − 1', result: '+41%' },
      ],
      fairValue: '₹3,940 Cr',
      upside: '+41% — base case',
    },
  },
  {
    id: 'ebitda-margin-bps',
    emoji: '📐',
    title: 'EBITDA Margin Improvement (bps)',
    description: 'Management gives margin EXPANSION in basis points (100 bps = 1%). Add to current margin to get forward margin, then apply revenue + EV/EBITDA chain.',
    examples: [
      { company: 'GNG Electronics', quote: 'EBITDA margin improvement of 150-200 bps' },
      { company: 'Emcure Pharmaceuticals', quote: 'EBITDA margin to rise 300-400 bps to 23-24% by FY29' },
    ],
    variables: ['Current EBITDA margin %', 'Margin expansion (bps)', 'Forward revenue'],
    formula: [
      'Forward Margin = Current Margin + (bps / 100)',
      'Forward EBITDA = Forward Revenue × (Forward Margin / 100)',
      'EV = Forward EBITDA × Multiple; Equity = EV − Net Debt',
    ],
    worked: {
      company: 'GNG Electronics — "150-200 bps margin improvement, 28-30% revenue growth FY26"',
      inputs: [
        { label: 'TTM Revenue', value: '₹450 Cr' },
        { label: 'Current EBITDA margin', value: '8%' },
        { label: 'Margin expansion (mid)', value: '175 bps' },
        { label: 'Forward margin', value: '8% + 1.75% = 9.75%' },
        { label: 'Revenue growth (mid)', value: '29%' },
        { label: 'EV/EBITDA', value: '14×' },
        { label: 'Current Market Cap', value: '₹600 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward Revenue', calc: '450 × 1.29', result: '₹581 Cr' },
        { label: 'Step 2 — Forward EBITDA', calc: '581 × 0.0975', result: '₹57 Cr' },
        { label: 'Step 3 — EV', calc: '57 × 14', result: '₹793 Cr' },
        { label: 'Step 4 — Upside', calc: '(793 / 600) − 1', result: '+32%' },
      ],
      fairValue: '₹793 Cr',
      upside: '+32%',
    },
    tips: [
      '100 bps = 1.00% margin. 150-200 bps = 1.5-2.0%.',
      'Margin expansion is often back-loaded (Q3/Q4). Check management cadence.',
    ],
  },
  {
    id: 'ebitda-growth',
    emoji: '💼',
    title: 'EBITDA Growth % (instead of revenue)',
    description: 'Management guides EBITDA growth directly without specifying revenue. Apply EBITDA growth to TTM EBITDA, then apply EV/EBITDA multiple.',
    examples: [
      { company: 'CCL Products', quote: '25% EBITDA growth guidance for FY26' },
      { company: 'Aeroflex Industries', quote: '25% EBITDA growth for FY26' },
    ],
    variables: ['TTM EBITDA', 'EBITDA growth %', 'EV/EBITDA Multiple'],
    formula: [
      'Forward EBITDA = TTM EBITDA × (1 + EBITDA Growth/100)',
      'EV = Forward EBITDA × Multiple',
      'Equity Value = EV − Net Debt',
    ],
    worked: {
      company: 'CCL Products — "25% EBITDA growth FY26"',
      inputs: [
        { label: 'TTM EBITDA (FY25)', value: '₹500 Cr' },
        { label: 'EBITDA growth guidance', value: '25%' },
        { label: 'Coffee/F&B EV/EBITDA', value: '18× (base)' },
        { label: 'Net Debt', value: '₹600 Cr' },
        { label: 'Current Market Cap', value: '₹9,500 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Forward EBITDA', calc: '500 × 1.25', result: '₹625 Cr' },
        { label: 'Step 2 — EV', calc: '625 × 18', result: '₹11,250 Cr' },
        { label: 'Step 3 — Equity', calc: '11,250 − 600', result: '₹10,650 Cr' },
        { label: 'Step 4 — Upside', calc: '(10,650 / 9,500) − 1', result: '+12%' },
      ],
      fairValue: '₹10,650 Cr',
      upside: '+12% — fairly valued',
    },
  },
  {
    id: 'peak-revenue',
    emoji: '⛰️',
    title: 'Peak Revenue Potential (by FYxx)',
    description: 'Management gives PEAK revenue achievable at full capacity ramp by a later FY. Treat as terminal-year revenue. Discount back to current year using a discount rate (10-12%).',
    examples: [
      { company: 'Aeroflex Industries', quote: 'Peak revenue potential ₹650 crores from hoses + ₹85 crores from metal bellows by FY28' },
      { company: 'Navin Fluorine', quote: '₹600-825 crores peak revenue from 15,000 MTPA R32 expansion by Q3 FY27' },
    ],
    variables: ['Peak Revenue ₹ Cr', 'Years to peak (N)', 'Discount rate'],
    formula: [
      'Sum peak revenue from all segments → Total peak revenue',
      'Apply multiple to peak revenue → Peak Mcap',
      'Discount: PV = Peak Mcap / (1 + DiscRate)^N',
      'Or simpler: take ratio (Peak Mcap / Current Mcap) and annualize over N years',
    ],
    worked: {
      company: 'Aeroflex — "₹650 Cr hoses + ₹85 Cr metal bellows peak by FY28" (2 years out)',
      inputs: [
        { label: 'Peak Revenue', value: '₹650 + ₹85 = ₹735 Cr' },
        { label: 'Years to peak', value: '2 (FY26 → FY28)' },
        { label: 'P/S (Industrial)', value: '6× (base)' },
        { label: 'Current Market Cap', value: '₹2,400 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Peak Mcap', calc: '735 × 6', result: '₹4,410 Cr' },
        { label: 'Step 2 — Total upside', calc: '(4,410 / 2,400) − 1', result: '+84%' },
        { label: 'Step 3 — Annualized (2yr)', calc: '(4,410/2,400)^(1/2) − 1', result: '+36% CAGR' },
      ],
      fairValue: '₹4,410 Cr (peak FY28)',
      upside: '+84% total / +36% annualized',
    },
    tips: [
      'Peak revenue assumes full ramp + healthy utilization. Discount 15-25% if capex commissioning has risk.',
      'If multiple segments give peak guidance, sum them. But check whether they\'re additive or overlapping.',
    ],
  },
  {
    id: 'segment-mix',
    emoji: '🔀',
    title: 'Segment Revenue Mix Shift',
    description: 'Guidance specifies that a higher-margin segment will reach X% of revenue by year N. Useful for re-rating thesis (mix-driven margin expansion).',
    examples: [
      { company: 'SJS Enterprises', quote: 'Export contribution to reach 14-15% of revenue by FY28' },
      { company: 'HFCL', quote: 'OFC Revenue: ₹3,500 Cr / Defence Revenue: ₹500 Cr in FY27' },
    ],
    variables: ['Total forward revenue', 'Segment mix %', 'Segment-specific margin'],
    formula: [
      'Segment Revenue = Total Revenue × (Segment % / 100)',
      'Blended Margin = Σ (Segment % × Segment margin)',
      'EBITDA = Total Revenue × Blended Margin',
    ],
    worked: {
      company: 'SJS — "Exports 14% of revenue by FY28, exports margin 25% vs domestic 15%"',
      inputs: [
        { label: 'Total Revenue FY28', value: '₹900 Cr' },
        { label: 'Export %', value: '14%' },
        { label: 'Export margin', value: '25%' },
        { label: 'Domestic margin', value: '15%' },
      ],
      steps: [
        { label: 'Step 1 — Export EBITDA', calc: '900 × 0.14 × 0.25', result: '₹31.5 Cr' },
        { label: 'Step 2 — Domestic EBITDA', calc: '900 × 0.86 × 0.15', result: '₹116.1 Cr' },
        { label: 'Step 3 — Total EBITDA', calc: '31.5 + 116.1', result: '₹147.6 Cr' },
        { label: 'Step 4 — Blended margin', calc: '147.6 / 900', result: '16.4%' },
      ],
      fairValue: 'EBITDA-based — apply EV/EBITDA multiple to ₹147.6 Cr',
      upside: 'Depends on multiple. At 18× → EV ₹2,657 Cr',
    },
  },
  {
    id: 'sustainable-margin',
    emoji: '🏆',
    title: 'Sustainable Margin Target (long horizon)',
    description: 'Management gives a sustainable margin for the long run (not a year-specific target). Treat as terminal margin for DCF or apply to a normalized forward year.',
    examples: [
      { company: 'Azad Engineering', quote: '33-35% EBITDA margin sustainable over a long period' },
      { company: 'Emcure', quote: 'EBITDA margin to rise 300-400 bps to 23-24% by FY29' },
    ],
    variables: ['Terminal margin %', 'Terminal revenue', 'Terminal multiple'],
    formula: [
      'Terminal EBITDA = Terminal Revenue × (Terminal Margin / 100)',
      'Terminal EV = Terminal EBITDA × Multiple',
      'For valuation today: discount terminal EV back N years at 10-12%',
    ],
    worked: {
      company: 'Azad Engineering — "33-35% sustainable EBITDA margin, current revenue ₹400 Cr"',
      inputs: [
        { label: 'Current Revenue', value: '₹400 Cr' },
        { label: 'Sustainable margin (mid)', value: '34%' },
        { label: 'Implied EBITDA today', value: '₹136 Cr' },
        { label: 'EV/EBITDA (premium precision)', value: '25×' },
        { label: 'Current Market Cap', value: '₹9,800 Cr' },
      ],
      steps: [
        { label: 'Step 1 — Steady-state EBITDA', calc: '400 × 0.34', result: '₹136 Cr' },
        { label: 'Step 2 — EV at 25×', calc: '136 × 25', result: '₹3,400 Cr' },
        { label: 'Step 3 — Underwater vs current', calc: '(3,400 / 9,800) − 1', result: '−65%' },
      ],
      fairValue: '₹3,400 Cr (steady-state)',
      upside: '−65% on steady-state — stock pricing in significant growth. Sustainable margin only validates the bull-case multiple, not the entry today.',
    },
    tips: [
      'Sustainable margin guidance is the LONG-RUN floor — pair with growth thesis, never standalone.',
      'Use 25× max for premium precision engineering. For pharma 18-22×. For autos 12-15×.',
    ],
  },
  {
    id: 'sum-of-parts',
    emoji: '🧩',
    title: 'Sum-of-Parts (Multiple segments with separate guidance)',
    description: 'Management gives separate guidance for each segment. Value each segment using its own multiple (because growth and risk profiles differ), then sum to get total fair value.',
    examples: [
      { company: 'HFCL', quote: 'OFC Revenue: ₹3,500 Cr (from ₹2,400 Cr); Defence Revenue: ₹500 Cr in FY27' },
      { company: 'Aeroflex', quote: '₹650 Cr from hoses + ₹85 Cr from metal bellows by FY28' },
    ],
    variables: ['Per-segment revenue', 'Per-segment multiple', 'Holding/corporate discount'],
    formula: [
      'For each segment: Segment Value = Segment Revenue × Segment Multiple',
      'Total Enterprise Value = Σ Segment Values',
      'Apply 10-15% conglomerate discount if 3+ segments with low synergy',
      'Equity Value = EV − Net Debt − Conglomerate Discount',
    ],
    worked: {
      company: 'HFCL — "OFC ₹3,500 Cr (P/S 4×, cyclical), Defence ₹500 Cr (P/S 8×, premium)"',
      inputs: [
        { label: 'OFC Revenue FY27', value: '₹3,500 Cr' },
        { label: 'OFC Multiple', value: '4× P/S' },
        { label: 'Defence Revenue FY27', value: '₹500 Cr' },
        { label: 'Defence Multiple', value: '8× P/S' },
        { label: 'Current Mcap', value: '₹15,000 Cr' },
      ],
      steps: [
        { label: 'OFC value', calc: '3,500 × 4', result: '₹14,000 Cr' },
        { label: 'Defence value', calc: '500 × 8', result: '₹4,000 Cr' },
        { label: 'Total EV', calc: '14,000 + 4,000', result: '₹18,000 Cr' },
        { label: 'Less: 10% conglomerate discount', calc: '18,000 × 0.90', result: '₹16,200 Cr' },
        { label: 'Upside', calc: '(16,200 / 15,000) − 1', result: '+8%' },
      ],
      fairValue: '₹16,200 Cr (post-conglomerate discount)',
      upside: '+8%',
    },
    tips: [
      'High-multiple segment (defence) drives most of the value. Always check whether it\'s really delivered margin/growth.',
      'Conglomerate discount: 10% for 2 segments, 15% for 3+, 20% for unrelated diversification.',
    ],
  },
];

function MethodCard({ m, idx }: { m: GuidanceMethod; idx: number }) {
  const [open, setOpen] = useState(idx < 3);  // first 3 open by default
  return (
    <div style={{ background: '#0D1426', border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', background: 'transparent', border: 'none',
        padding: '14px 18px', textAlign: 'left', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 800, minWidth: 40, fontFamily: 'ui-monospace, monospace' }}>#{String(idx + 1).padStart(2, '0')}</span>
        <span style={{ fontSize: 20 }}>{m.emoji}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: TEXT, flex: 1 }}>{m.title}</span>
        <span style={{ fontSize: 14, color: DIM }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 18px 18px' }}>
          <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.6, marginBottom: 14 }}>{m.description}</div>

          {/* Example quotes */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 6 }}>REAL EXAMPLES FROM INDIAN COMPANIES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {m.examples.map((e, i) => (
                <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: 'var(--mc-bg-4)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 3 }}>
                  <span style={{ fontWeight: 800, color: 'var(--mc-cyan)', marginRight: 8 }}>{e.company}:</span>
                  <span style={{ color: TEXT, fontStyle: 'italic' }}>"{e.quote}"</span>
                </div>
              ))}
            </div>
          </div>

          {/* Variables needed */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 6 }}>VARIABLES YOU NEED</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {m.variables.map((v, i) => (
                <span key={i} style={{ fontSize: 11, padding: '3px 10px', background: '#1F2940', color: TEXT, borderRadius: 12, border: `1px solid ${BORDER}` }}>{v}</span>
              ))}
            </div>
          </div>

          {/* Formula */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 6 }}>FORMULA</div>
            <div style={{ background: '#000', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '10px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.65, color: '#A7F3D0' }}>
              {m.formula.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>

          {/* Worked example */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-warn)', letterSpacing: '0.5px', marginBottom: 6 }}>WORKED EXAMPLE — {m.worked.company.toUpperCase()}</div>
            <div style={{ background: '#1A1F33', border: `1px solid ${BORDER}`, borderRadius: 4, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: DIM, marginBottom: 5 }}>INPUTS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
                <tbody>
                  {m.worked.inputs.map((inp, i) => (
                    <tr key={i} style={{ borderBottom: i === m.worked.inputs.length - 1 ? 'none' : `1px solid ${BORDER}` }}>
                      <td style={{ padding: '5px 8px 5px 0', color: DIM }}>{inp.label}</td>
                      <td style={{ padding: '5px 0', textAlign: 'right', color: TEXT, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{inp.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ fontSize: 11, fontWeight: 800, color: DIM, marginBottom: 5 }}>STEPS</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {m.worked.steps.map((s, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '6px 8px 6px 0', color: TEXT, fontWeight: 700 }}>{s.label}</td>
                      <td style={{ padding: '6px 8px', color: DIM, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{s.calc}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{s.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 12, padding: '10px 12px', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 3 }}>FAIR VALUE → {m.worked.fairValue}</div>
                <div style={{ fontSize: 12, color: TEXT }}>{m.worked.upside}</div>
              </div>
            </div>
          </div>

          {/* PATCH 0661 — Practice example shortcuts. Click any company chip
              to scroll directly to its full calculation in the Practice
              Examples section below. */}
          {(() => {
            const matches = PRACTICE_EXAMPLES.filter(ex => ex.methodIds.includes(m.id));
            if (matches.length === 0) return null;
            return (
              <div style={{ marginTop: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-bullish)', letterSpacing: '0.5px', marginBottom: 6 }}>
                  → JUMP TO PRACTICE EXAMPLE ({matches.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {matches.map((ex, i) => (
                    <a key={i} href={`#${exSlug(ex.company)}`} style={{
                      fontSize: 11, padding: '4px 10px',
                      background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)',
                      color: 'var(--mc-bullish)', borderRadius: 4, fontWeight: 700,
                      textDecoration: 'none', whiteSpace: 'nowrap',
                    }}>
                      {ex.company.replace(/ Ltd$/, '').replace(/ Industries$/, '')} ↓
                    </a>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Tips */}
          {m.tips && m.tips.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-state-persistent)', letterSpacing: '0.5px', marginBottom: 6 }}>TIPS</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: TEXT, lineHeight: 1.65 }}>
                {m.tips.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRACTICE EXAMPLES (PATCH 0659)
//
// Worked valuations for all 23 companies in the user's guidance table.
// Each example carries: the actual guidance quote, the pattern applied,
// approximate TTM revenue + market cap anchors, sector multiple, full
// step-by-step calculation, fair value, and upside. Notes call out
// which inputs are approximate vs. guidance-given so the user can swap
// in precise numbers when they have them.
// ═══════════════════════════════════════════════════════════════════════════

interface PracticeExample {
  company: string;
  ticker?: string;
  sector: string;
  guidance: string;
  pattern: string;           // matches Pattern # from GUIDANCE_METHODS
  // PATCH 0661 — tag with one or more methodIds for cross-linking back
  // from the 12-pattern table. Most examples use 1 pattern; combos
  // (e.g. Aeroflex uses EBITDA growth + Peak revenue) list both.
  methodIds: string[];
  inputs: Array<{ label: string; value: string; approx?: boolean }>;
  steps: Array<{ label: string; calc: string; result: string }>;
  fairValue: string;
  upside: string;
  upsideColor: string;       // green / amber / red
  note?: string;
}

// PATCH 0661 — slugify company name to give each example a URL-fragment ID
function exSlug(c: string): string {
  return 'ex-' + c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const PRACTICE_EXAMPLES: PracticeExample[] = [
  {
    company: 'Acutaas Chemicals Ltd', sector: 'Specialty Chemicals',
    guidance: '30% revenue growth for FY26',
    pattern: '#01 Revenue Growth %', methodIds: ['revenue-growth-pct'],
    inputs: [
      { label: 'TTM Revenue (FY25)', value: '~₹500 Cr', approx: true },
      { label: 'Current Market Cap', value: '~₹4,000 Cr', approx: true },
      { label: 'Chemicals P/S (base)', value: '8×' },
      { label: 'Guidance', value: '30% growth' },
    ],
    steps: [
      { label: 'Forward Revenue FY26', calc: '500 × 1.30', result: '₹650 Cr' },
      { label: 'Target Mcap', calc: '650 × 8', result: '₹5,200 Cr' },
      { label: 'Upside %', calc: '(5,200 / 4,000) − 1', result: '+30%' },
    ],
    fairValue: '₹5,200 Cr',
    upside: '+30% (1yr horizon) → WATCH/BUY zone',
    upsideColor: '#10B981',
  },
  {
    company: 'Aeroflex Industries Ltd', sector: 'Niche Manufacturing (Flexible hoses)',
    guidance: '25% EBITDA growth FY26 + peak ₹735 Cr revenue by FY28',
    pattern: '#08 EBITDA Growth + #09 Peak Revenue', methodIds: ['ebitda-growth', 'peak-revenue'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹350 Cr', approx: true },
      { label: 'TTM EBITDA (~26% margin)', value: '~₹91 Cr', approx: true },
      { label: 'Peak Revenue FY28', value: '₹735 Cr (₹650 + ₹85)' },
      { label: 'Current Market Cap', value: '~₹3,500 Cr', approx: true },
      { label: 'EV/EBITDA (premium industrial)', value: '20×' },
      { label: 'P/S (peak basis)', value: '8×' },
    ],
    steps: [
      { label: 'Method A — FY26 EBITDA', calc: '91 × 1.25', result: '₹114 Cr' },
      { label: '  ↳ EV at 20×', calc: '114 × 20', result: '₹2,280 Cr → −35%' },
      { label: 'Method B — Peak Mcap FY28', calc: '735 × 8', result: '₹5,880 Cr' },
      { label: '  ↳ Total upside (2yr)', calc: '(5,880 / 3,500) − 1', result: '+68%' },
      { label: '  ↳ Annualized', calc: '(5,880/3,500)^(1/2) − 1', result: '+30% CAGR' },
    ],
    fairValue: '₹2,280 Cr (FY26) → ₹5,880 Cr (FY28 peak)',
    upside: 'Near-term −35%, 2-yr +68% — patient capital story',
    upsideColor: '#22D3EE',
    note: 'Patience play — FY26 looks expensive but FY28 peak justifies hold-through.',
  },
  {
    company: 'Aimtron Electronics Ltd', sector: 'EMS / SME',
    guidance: '40-50% CAGR revenue growth for FY26',
    pattern: '#02 Revenue Range', methodIds: ['revenue-growth-range'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹250 Cr', approx: true },
      { label: 'Current Market Cap', value: '~₹1,200 Cr', approx: true },
      { label: 'EMS P/S (bear/base/bull)', value: '4× / 6× / 9×' },
    ],
    steps: [
      { label: 'Bear (40% × 4×)', calc: '250 × 1.40 × 4', result: '₹1,400 Cr → +17%' },
      { label: 'Base (45% × 6×)', calc: '250 × 1.45 × 6', result: '₹2,175 Cr → +81%' },
      { label: 'Bull (50% × 9×)', calc: '250 × 1.50 × 9', result: '₹3,375 Cr → +181%' },
    ],
    fairValue: '₹2,175 Cr (base)',
    upside: '+81% base, +17% bear / +181% bull — wide spread',
    upsideColor: '#10B981',
    note: 'SME EMS multiples re-rate fast — verify orders are signed, not pipeline.',
  },
  {
    company: 'Azad Engineering Ltd', sector: 'Premium Precision (Aero/Defence)',
    guidance: '25%+ revenue growth; 33-35% EBITDA margin sustainable',
    pattern: '#01 Growth + #11 Sustainable Margin', methodIds: ['revenue-growth-pct', 'sustainable-margin'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹400 Cr', approx: true },
      { label: 'Sustainable EBITDA Margin', value: '34% (mid)' },
      { label: 'Current Market Cap', value: '~₹12,000 Cr', approx: true },
      { label: 'EV/EBITDA (premium precision)', value: '30×' },
    ],
    steps: [
      { label: 'Forward Revenue', calc: '400 × 1.25', result: '₹500 Cr' },
      { label: 'Forward EBITDA', calc: '500 × 0.34', result: '₹170 Cr' },
      { label: 'EV at 30×', calc: '170 × 30', result: '₹5,100 Cr' },
      { label: 'Upside', calc: '(5,100 / 12,000) − 1', result: '−57%' },
    ],
    fairValue: '₹5,100 Cr',
    upside: '−57% — premium already in price',
    upsideColor: '#EF4444',
    note: 'Quality is right, price is wrong. Wait for re-rating event or accumulate on dips.',
  },
  {
    company: 'CCL Products (India) Ltd', sector: 'Coffee / F&B',
    guidance: '25% EBITDA growth guidance for FY26',
    pattern: '#08 EBITDA Growth', methodIds: ['ebitda-growth'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹2,500 Cr', approx: true },
      { label: 'TTM EBITDA (~18%)', value: '~₹450 Cr', approx: true },
      { label: 'Net Debt', value: '~₹800 Cr', approx: true },
      { label: 'Current Market Cap', value: '~₹9,500 Cr', approx: true },
      { label: 'EV/EBITDA (F&B)', value: '18×' },
    ],
    steps: [
      { label: 'Forward EBITDA', calc: '450 × 1.25', result: '₹563 Cr' },
      { label: 'EV', calc: '563 × 18', result: '₹10,134 Cr' },
      { label: 'Equity Value', calc: '10,134 − 800', result: '₹9,334 Cr' },
      { label: 'Upside', calc: '(9,334 / 9,500) − 1', result: '−2%' },
    ],
    fairValue: '₹9,334 Cr',
    upside: '−2% — fairly valued (consensus reflects guidance)',
    upsideColor: '#F59E0B',
  },
  {
    company: 'DEE Development Engineers Ltd', sector: 'Capital Goods (Piping)',
    guidance: '18% to 20% EBITDA margin guidance for FY27',
    pattern: '#06 EBITDA Margin', methodIds: ['ebitda-margin'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹1,200 Cr', approx: true },
      { label: 'Assumed Growth (no rev guidance)', value: '15% (sector default)' },
      { label: 'Margin (mid 19%)', value: '19%' },
      { label: 'EV/EBITDA (Engineering)', value: '14×' },
      { label: 'Current Market Cap', value: '~₹3,500 Cr', approx: true },
    ],
    steps: [
      { label: 'Forward Revenue FY27', calc: '1,200 × 1.15', result: '₹1,380 Cr' },
      { label: 'Forward EBITDA', calc: '1,380 × 0.19', result: '₹262 Cr' },
      { label: 'EV', calc: '262 × 14', result: '₹3,668 Cr' },
      { label: 'Upside', calc: '(3,668 / 3,500) − 1', result: '+5%' },
    ],
    fairValue: '₹3,668 Cr',
    upside: '+5% — fairly valued',
    upsideColor: '#F59E0B',
    note: 'Margin guidance only. Used 15% revenue growth assumption (sector default) — verify with actual guidance.',
  },
  {
    company: 'Emcure Pharmaceuticals Ltd', sector: 'Pharma',
    guidance: 'Low-to-mid teens CAGR 3-5yr + 300-400 bps margin rise to 23-24% by FY29',
    pattern: '#03 CAGR + #07 bps Improvement', methodIds: ['multi-year-cagr', 'ebitda-margin-bps'],
    inputs: [
      { label: 'TTM Revenue (FY26)', value: '~₹6,500 Cr', approx: true },
      { label: 'Current EBITDA margin', value: '~20%' },
      { label: 'Revenue CAGR (mid)', value: '14%' },
      { label: 'Horizon', value: '3 yr (FY26 → FY29)' },
      { label: 'Forward margin (mid 23.5%)', value: '20% + 350 bps' },
      { label: 'Net Debt', value: '~₹4,000 Cr', approx: true },
      { label: 'EV/EBITDA (Pharma)', value: '18×' },
      { label: 'Current Market Cap', value: '~₹25,000 Cr', approx: true },
    ],
    steps: [
      { label: 'Forward Revenue FY29', calc: '6,500 × (1.14)^3', result: '₹9,627 Cr' },
      { label: 'Forward EBITDA', calc: '9,627 × 0.235', result: '₹2,262 Cr' },
      { label: 'EV', calc: '2,262 × 18', result: '₹40,716 Cr' },
      { label: 'Equity', calc: '40,716 − 4,000', result: '₹36,716 Cr' },
      { label: 'Total upside (3yr)', calc: '(36,716 / 25,000) − 1', result: '+47%' },
      { label: 'Annualized', calc: '(36,716/25,000)^(1/3) − 1', result: '+14% CAGR' },
    ],
    fairValue: '₹36,716 Cr',
    upside: '+47% total / +14% CAGR — decent compounder',
    upsideColor: '#10B981',
  },
  {
    company: 'GNG Electronics Ltd', sector: 'Refurbished IT',
    guidance: 'Revenue 28-30% FY26 + EBITDA margin +150-200 bps',
    pattern: '#02 Range + #07 bps', methodIds: ['revenue-growth-range', 'ebitda-margin-bps'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹600 Cr', approx: true },
      { label: 'Current EBITDA margin', value: '~8%', approx: true },
      { label: 'Growth (mid 29%)', value: '29%' },
      { label: 'Forward margin (8% + 175 bps)', value: '9.75%' },
      { label: 'EV/EBITDA', value: '18×' },
      { label: 'Current Market Cap', value: '~₹4,000 Cr', approx: true },
    ],
    steps: [
      { label: 'Forward Revenue', calc: '600 × 1.29', result: '₹774 Cr' },
      { label: 'Forward EBITDA', calc: '774 × 0.0975', result: '₹75 Cr' },
      { label: 'EV', calc: '75 × 18', result: '₹1,350 Cr' },
      { label: 'Upside (EV/EBITDA basis)', calc: '(1,350 / 4,000) − 1', result: '−66%' },
      { label: 'Cross-check via P/S 6×', calc: '774 × 6', result: '₹4,644 → +16%' },
    ],
    fairValue: '₹1,350 Cr (EV/EBITDA) / ₹4,644 Cr (P/S)',
    upside: 'Method disagreement — refurbished biz has low EBITDA but high revenue. P/S more relevant.',
    upsideColor: '#F59E0B',
    note: 'When methods disagree, sector convention wins. Refurbished IT is typically valued on P/S (gross margin > EBITDA margin).',
  },
  {
    company: 'HFCL Ltd', sector: 'Telecom Infra (OFC + Defence)',
    guidance: 'OFC ₹3,500 Cr + Defence ₹500 Cr in FY27',
    pattern: '#12 Sum-of-Parts', methodIds: ['sum-of-parts'],
    inputs: [
      { label: 'OFC Revenue FY27', value: '₹3,500 Cr' },
      { label: 'Defence Revenue FY27', value: '₹500 Cr' },
      { label: 'Other (existing biz)', value: '~₹1,000 Cr', approx: true },
      { label: 'OFC P/S', value: '3× (cyclical)' },
      { label: 'Defence P/S', value: '8× (premium)' },
      { label: 'Other P/S', value: '2×' },
      { label: 'Net Debt', value: '~₹2,000 Cr', approx: true },
      { label: 'Current Market Cap', value: '~₹17,000 Cr', approx: true },
    ],
    steps: [
      { label: 'OFC value', calc: '3,500 × 3', result: '₹10,500 Cr' },
      { label: 'Defence value', calc: '500 × 8', result: '₹4,000 Cr' },
      { label: 'Other biz value', calc: '1,000 × 2', result: '₹2,000 Cr' },
      { label: 'Total EV', calc: '10,500 + 4,000 + 2,000', result: '₹16,500 Cr' },
      { label: 'Less: 10% conglom discount', calc: '16,500 × 0.90', result: '₹14,850 Cr' },
      { label: 'Equity (− net debt)', calc: '14,850 − 2,000', result: '₹12,850 Cr' },
      { label: 'Upside', calc: '(12,850 / 17,000) − 1', result: '−24%' },
    ],
    fairValue: '₹12,850 Cr',
    upside: '−24% — defence segment carries most of the value but doesn\'t close the gap',
    upsideColor: '#EF4444',
  },
  {
    company: 'Inox India Ltd', sector: 'Cryogenic Engineering',
    guidance: '18-20% revenue growth guidance for FY27',
    pattern: '#02 Revenue Range', methodIds: ['revenue-growth-range'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹1,300 Cr', approx: true },
      { label: 'P/S (bear/base/bull)', value: '8× / 11× / 14×' },
      { label: 'Current Market Cap', value: '~₹16,000 Cr', approx: true },
    ],
    steps: [
      { label: 'Bear (18% × 8×)', calc: '1,300 × 1.18 × 8', result: '₹12,272 Cr → −23%' },
      { label: 'Base (19% × 11×)', calc: '1,300 × 1.19 × 11', result: '₹17,017 Cr → +6%' },
      { label: 'Bull (20% × 14×)', calc: '1,300 × 1.20 × 14', result: '₹21,840 Cr → +37%' },
    ],
    fairValue: '₹17,017 Cr (base)',
    upside: '+6% base, ±25% scenario range — fair zone',
    upsideColor: '#F59E0B',
  },
  {
    company: 'Knowledge Marine & Engineering Works Ltd', sector: 'Marine Logistics',
    guidance: '20%+ YoY revenue growth for FY27',
    pattern: '#01 Revenue Growth %', methodIds: ['revenue-growth-pct'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹450 Cr', approx: true },
      { label: 'Current Market Cap', value: '~₹4,000 Cr', approx: true },
      { label: 'P/S (Marine logistics)', value: '6×' },
    ],
    steps: [
      { label: 'Forward Revenue', calc: '450 × 1.20', result: '₹540 Cr' },
      { label: 'Target Mcap', calc: '540 × 6', result: '₹3,240 Cr' },
      { label: 'Upside', calc: '(3,240 / 4,000) − 1', result: '−19%' },
    ],
    fairValue: '₹3,240 Cr',
    upside: '−19% — multiple already premium for this growth rate',
    upsideColor: '#EF4444',
    note: '20%+ growth is the FLOOR — stretch case could justify higher. But sector convention caps P/S at 6× for marine.',
  },
  {
    company: 'Lumax Auto Technologies Ltd', sector: 'Auto Ancillary',
    guidance: 'Revenue growth revised to 30% for FY26',
    pattern: '#01 Revenue Growth %', methodIds: ['revenue-growth-pct'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹3,200 Cr', approx: true },
      { label: 'Current Market Cap', value: '~₹6,500 Cr', approx: true },
      { label: 'P/S (Auto ancillary)', value: '2×' },
    ],
    steps: [
      { label: 'Forward Revenue', calc: '3,200 × 1.30', result: '₹4,160 Cr' },
      { label: 'Target Mcap', calc: '4,160 × 2', result: '₹8,320 Cr' },
      { label: 'Upside', calc: '(8,320 / 6,500) − 1', result: '+28%' },
    ],
    fairValue: '₹8,320 Cr',
    upside: '+28% — WATCH/BUY zone',
    upsideColor: '#10B981',
    note: 'Upward revision in guidance is a positive signal — actual delivery often exceeds revised target.',
  },
  {
    company: 'MTAR Technologies Ltd', sector: 'Defence / Premium Engineering',
    guidance: '50% revenue growth for FY27 (raised from earlier 50% to 80%+ in concall)',
    pattern: '#01 Growth + #03 CAGR (multi-year)', methodIds: ['revenue-growth-pct', 'multi-year-cagr'],
    inputs: [
      { label: 'TTM Revenue (FY26)', value: '₹876 Cr' },
      { label: 'Growth FY27', value: '50% (floor) → 80% (stretch)' },
      { label: 'P/S (Defence)', value: '10× base, 14× bull' },
      { label: 'Current Market Cap', value: '~₹17,675 Cr' },
    ],
    steps: [
      { label: 'Conservative (50%)', calc: '876 × 1.50 × 10', result: '₹13,140 Cr → −26%' },
      { label: 'Stretch (80%)', calc: '876 × 1.80 × 10', result: '₹15,768 Cr → −11%' },
      { label: 'Bull (80% × 14×)', calc: '876 × 1.80 × 14', result: '₹22,075 Cr → +25%' },
      { label: 'FY28 (compounded 65%/yr × 12×)', calc: '876 × 1.65 × 1.65 × 12', result: '₹28,627 Cr → +62% (2yr)' },
    ],
    fairValue: '₹13,140-22,075 Cr (FY27 range)',
    upside: 'AVOID near-term, WATCH for FY28 if growth holds',
    upsideColor: '#F59E0B',
    note: 'Same name covered in Auto-Valuation tab. Use FY28 toggle there for the 2-year view.',
  },
  {
    company: 'Navin Fluorine International Ltd', sector: 'Specialty Chemicals (Premium)',
    guidance: '30%+ EBITDA margin FY26 + ₹600-825 Cr peak revenue from R32 by Q3 FY27',
    pattern: '#06 Margin + #09 Peak Revenue', methodIds: ['ebitda-margin', 'peak-revenue'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹2,000 Cr', approx: true },
      { label: 'Forward Rev assumption', value: '~₹2,400 Cr (20% growth)', approx: true },
      { label: 'R32 Peak Revenue add', value: '~₹712 Cr (mid)' },
      { label: 'Total Forward Revenue', value: '~₹3,112 Cr' },
      { label: 'EBITDA margin', value: '30%' },
      { label: 'EV/EBITDA (premium chem)', value: '30×' },
      { label: 'Current Market Cap', value: '~₹26,000 Cr', approx: true },
    ],
    steps: [
      { label: 'Forward EBITDA', calc: '3,112 × 0.30', result: '₹934 Cr' },
      { label: 'EV', calc: '934 × 30', result: '₹28,020 Cr' },
      { label: 'Upside', calc: '(28,020 / 26,000) − 1', result: '+8%' },
    ],
    fairValue: '₹28,020 Cr',
    upside: '+8% — fully valued, near term',
    upsideColor: '#F59E0B',
  },
  {
    company: 'Quality Power Electrical Equipments Ltd', sector: 'Grid Equipment',
    guidance: '₹700-800 Cr revenue + 22%+ EBITDA margin FY26',
    pattern: '#04 Absolute Revenue + #06 Margin', methodIds: ['absolute-revenue', 'ebitda-margin'],
    inputs: [
      { label: 'Forward Revenue FY26 (mid)', value: '₹750 Cr' },
      { label: 'EBITDA margin', value: '22%' },
      { label: 'EV/EBITDA (premium grid)', value: '20×' },
      { label: 'P/S cross-check', value: '8×' },
      { label: 'Current Market Cap', value: '~₹5,500 Cr', approx: true },
    ],
    steps: [
      { label: 'Forward EBITDA', calc: '750 × 0.22', result: '₹165 Cr' },
      { label: 'EV at 20×', calc: '165 × 20', result: '₹3,300 Cr → −40%' },
      { label: 'P/S cross-check', calc: '750 × 8', result: '₹6,000 Cr → +9%' },
    ],
    fairValue: '₹3,300-6,000 Cr',
    upside: 'Methods disagree (−40% to +9%) — fair value zone',
    upsideColor: '#F59E0B',
    note: 'For high-margin niche grid names, EV/EBITDA can understate value. P/S often more reliable.',
  },
  {
    company: 'S J S Enterprises Ltd', sector: 'Auto Decoratives',
    guidance: 'Exports to reach 14-15% of revenue by FY28',
    pattern: '#10 Segment Mix Shift', methodIds: ['segment-mix'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹700 Cr', approx: true },
      { label: 'Assumed growth (18%)', value: '18% CAGR' },
      { label: 'FY28 Revenue', value: '~₹974 Cr' },
      { label: 'Export % (mid 14.5%)', value: '14.5%' },
      { label: 'Export margin', value: '25%' },
      { label: 'Domestic margin', value: '15%' },
      { label: 'P/S (Auto decoratives)', value: '5×' },
      { label: 'Current Market Cap', value: '~₹4,500 Cr', approx: true },
    ],
    steps: [
      { label: 'Export revenue', calc: '974 × 0.145', result: '₹141 Cr' },
      { label: 'Domestic revenue', calc: '974 × 0.855', result: '₹833 Cr' },
      { label: 'Blended EBITDA', calc: '(141×0.25) + (833×0.15)', result: '₹160 Cr' },
      { label: 'Blended margin', calc: '160 / 974', result: '16.4%' },
      { label: 'Target Mcap (P/S 5×)', calc: '974 × 5', result: '₹4,870 Cr → +8%' },
    ],
    fairValue: '₹4,870 Cr',
    upside: '+8% (2yr) — fair zone. Mix shift = quality premium, not big upside',
    upsideColor: '#F59E0B',
  },
  {
    company: 'Sai Life Sciences Ltd', sector: 'Pharma CDMO',
    guidance: '15-20% revenue CAGR over 3-5 years + 28-30% EBITDA margin by FY27',
    pattern: '#03 CAGR + #06 Margin', methodIds: ['multi-year-cagr', 'ebitda-margin'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹1,800 Cr', approx: true },
      { label: 'CAGR (mid 17.5%)', value: '17.5%' },
      { label: 'Horizon', value: '4 yr → FY30' },
      { label: 'EBITDA margin', value: '29%' },
      { label: 'EV/EBITDA (Pharma CDMO)', value: '22×' },
      { label: 'Current Market Cap', value: '~₹16,000 Cr', approx: true },
    ],
    steps: [
      { label: 'FY30 Revenue', calc: '1,800 × (1.175)^4', result: '₹3,423 Cr' },
      { label: 'FY30 EBITDA', calc: '3,423 × 0.29', result: '₹993 Cr' },
      { label: 'EV', calc: '993 × 22', result: '₹21,846 Cr' },
      { label: 'Total upside (4yr)', calc: '(21,846 / 16,000) − 1', result: '+37%' },
      { label: 'Annualized', calc: '(21,846/16,000)^(1/4) − 1', result: '+8% CAGR' },
    ],
    fairValue: '₹21,846 Cr (FY30)',
    upside: '+37% total / +8% CAGR — modest 4yr compounder',
    upsideColor: '#22D3EE',
  },
  {
    company: 'Sansera Engineering Ltd', sector: 'Auto Ancillary (Precision)',
    guidance: 'ADS Revenue ₹550-600 Cr for FY27 (segment only)',
    pattern: '#04 Absolute Revenue (segment) + sector default for rest', methodIds: ['absolute-revenue'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹2,800 Cr', approx: true },
      { label: 'ADS segment FY27 (mid)', value: '₹575 Cr' },
      { label: 'Other segments (15% growth)', value: '~₹2,645 Cr', approx: true },
      { label: 'Total FY27 Revenue', value: '~₹3,220 Cr' },
      { label: 'P/S (Auto precision)', value: '3×' },
      { label: 'Current Market Cap', value: '~₹8,500 Cr', approx: true },
    ],
    steps: [
      { label: 'Total FY27 revenue', calc: '575 + 2,645', result: '₹3,220 Cr' },
      { label: 'Target Mcap', calc: '3,220 × 3', result: '₹9,660 Cr' },
      { label: 'Upside', calc: '(9,660 / 8,500) − 1', result: '+14%' },
    ],
    fairValue: '₹9,660 Cr',
    upside: '+14% — modest, partial guidance limits precision',
    upsideColor: '#22D3EE',
    note: 'Only ADS segment got explicit guidance. Other segments assumed 15% sector default — verify with actual concall.',
  },
  {
    company: 'Sterlite Technologies Ltd', sector: 'Telecom (OFC)',
    guidance: '20%+ YoY revenue growth for FY26',
    pattern: '#01 Revenue Growth %', methodIds: ['revenue-growth-pct'],
    inputs: [
      { label: 'TTM Revenue', value: '~₹4,500 Cr', approx: true },
      { label: 'P/S (Commoditized telecom)', value: '1.5×' },
      { label: 'Current Market Cap', value: '~₹6,500 Cr', approx: true },
    ],
    steps: [
      { label: 'Forward Revenue', calc: '4,500 × 1.20', result: '₹5,400 Cr' },
      { label: 'Target Mcap', calc: '5,400 × 1.5', result: '₹8,100 Cr' },
      { label: 'Upside', calc: '(8,100 / 6,500) − 1', result: '+25%' },
    ],
    fairValue: '₹8,100 Cr',
    upside: '+25% — cheap on P/S basis',
    upsideColor: '#10B981',
    note: 'Cyclical telecom — verify margin recovery actually happens before sizing in.',
  },
  {
    company: 'TD Power Systems Ltd', sector: 'Generator OEM',
    guidance: '₹2,200+ Cr FY27 (conservative)',
    pattern: '#04 Absolute Revenue (floor)', methodIds: ['absolute-revenue'],
    inputs: [
      { label: 'FY27 Revenue (floor)', value: '₹2,200 Cr (treated as BEAR)' },
      { label: 'Stretch (~+10%)', value: '~₹2,420 Cr (base)' },
      { label: 'Bull (~+20%)', value: '~₹2,640 Cr' },
      { label: 'P/S (Industrial cap goods)', value: '5×' },
      { label: 'Current Market Cap', value: '~₹6,800 Cr', approx: true },
    ],
    steps: [
      { label: 'Bear (2,200 × 5×)', calc: '2,200 × 5', result: '₹11,000 Cr → +62%' },
      { label: 'Base (2,420 × 5×)', calc: '2,420 × 5', result: '₹12,100 Cr → +78%' },
      { label: 'Bull (2,640 × 5×)', calc: '2,640 × 5', result: '₹13,200 Cr → +94%' },
    ],
    fairValue: '₹12,100 Cr (base)',
    upside: '+78% base — STRONG BUY zone (conservative guidance = floor)',
    upsideColor: '#10B981',
    note: 'When mgmt explicitly says "conservative", treat as your BEAR case. Real bear is -10% to -20% below.',
  },
];

function PracticeExampleCard({ ex }: { ex: PracticeExample }) {
  const [open, setOpen] = useState(false);
  return (
    <div id={exSlug(ex.company)} style={{ background: '#0D1426', border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden', scrollMarginTop: 80 }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', background: 'transparent', border: 'none',
        padding: '10px 14px', textAlign: 'left', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: TEXT }}>{ex.company}</div>
          <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>{ex.sector} · {ex.pattern}</div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, color: ex.upsideColor, minWidth: 65, textAlign: 'right' }}>
          {ex.upside.match(/^([-+]?\d+%)/)?.[1] || '—'}
        </div>
        <span style={{ fontSize: 14, color: DIM, marginLeft: 4 }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px 14px' }}>
          <div style={{ background: 'var(--mc-bg-4)', borderLeft: '3px solid var(--mc-cyan)', padding: '8px 12px', borderRadius: 3, marginBottom: 12, fontSize: 12 }}>
            <span style={{ fontWeight: 800, color: 'var(--mc-cyan)', marginRight: 8 }}>Management quote:</span>
            <span style={{ color: TEXT, fontStyle: 'italic' }}>"{ex.guidance}"</span>
          </div>

          <div style={{ fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 5 }}>INPUTS</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
            <tbody>
              {ex.inputs.map((inp, i) => (
                <tr key={i} style={{ borderBottom: i === ex.inputs.length - 1 ? 'none' : `1px solid ${BORDER}` }}>
                  <td style={{ padding: '4px 8px 4px 0', color: DIM }}>
                    {inp.label}{inp.approx && <span style={{ color: 'var(--mc-warn)', marginLeft: 4, fontSize: 10 }}>~</span>}
                  </td>
                  <td style={{ padding: '4px 0', textAlign: 'right', color: TEXT, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{inp.value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', marginBottom: 5 }}>CALCULATION</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
            <tbody>
              {ex.steps.map((s, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '5px 8px 5px 0', color: TEXT, fontWeight: 700 }}>{s.label}</td>
                  <td style={{ padding: '5px 8px', color: DIM, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{s.calc}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{s.result}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ padding: '10px 12px', background: `${ex.upsideColor}15`, border: `1px solid ${ex.upsideColor}40`, borderRadius: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: ex.upsideColor, marginBottom: 3 }}>FAIR VALUE → {ex.fairValue}</div>
            <div style={{ fontSize: 12, color: TEXT }}>{ex.upside}</div>
          </div>

          {ex.note && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mc-warn)', fontStyle: 'italic', padding: '6px 10px', background: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)', borderRadius: 3 }}>
              💡 {ex.note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MORE METHODS TAB (PATCH 0673)
//
// 6 additional valuation lenses bundled into one tab so the top bar stays
// institutional. Each calculator: name + emoji + WHAT-TO-ENTER guide +
// TIP + inputs (no bear/base/bull bands here — these are simpler single-
// scenario sanity checks). Output: fair value or upside %.
//
// Methods covered:
//   1. DCF (simple 3-stage)   — for compounders / cash-flow stories
//   2. PEG Ratio               — P/E ÷ growth; <1 = cheap, >2 = expensive
//   3. P/B (Price-to-Book)     — for banks / financials / asset-heavy
//   4. FCF Yield               — for mature cash-flow names
//   5. Sum-of-Parts (SoP)      — for conglomerates (HFCL / Reliance style)
//   6. Dividend Discount       — Gordon Growth, for dividend yielders
// ═══════════════════════════════════════════════════════════════════════════

function MethodSection({
  emoji, title, whatToEnter, tip, children,
}: {
  emoji: string; title: string; whatToEnter: string; tip: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: '#0D1426', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 22 }}>{emoji}</span>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TEXT }}>{title}</h3>
      </div>
      <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--mc-bg-4)', borderLeft: '3px solid var(--mc-cyan)', borderRadius: 3, fontSize: 11.5, color: TEXT, lineHeight: 1.55 }}>
        <div><strong style={{ color: 'var(--mc-cyan)' }}>What to enter:</strong> {whatToEnter}</div>
        <div style={{ marginTop: 4 }}><strong style={{ color: 'var(--mc-warn)' }}>Tip:</strong> {tip}</div>
      </div>
      {children}
    </div>
  );
}

function DCFCalculator() {
  const [fcf, setFcf] = useState(100);
  const [growth, setGrowth] = useState(15);
  const [terminalGrowth, setTerminalGrowth] = useState(4);
  const [discount, setDiscount] = useState(12);
  const [years, setYears] = useState(5);
  const [shares, setShares] = useState(10);
  const [mcap, setMcap] = useState(2000);

  const result = useMemo(() => {
    // 3-stage DCF: high growth N years, then terminal Gordon.
    if (discount <= terminalGrowth) return { fairMcap: 0, perShare: 0, upside: 0, terminalPv: 0, explicitPv: 0 };
    let explicitPv = 0;
    let lastFcf = fcf;
    for (let t = 1; t <= years; t++) {
      lastFcf = lastFcf * (1 + growth / 100);
      explicitPv += lastFcf / Math.pow(1 + discount / 100, t);
    }
    const tFcf = lastFcf * (1 + terminalGrowth / 100);
    const terminalValue = tFcf / ((discount - terminalGrowth) / 100);
    const terminalPv = terminalValue / Math.pow(1 + discount / 100, years);
    const fairMcap = explicitPv + terminalPv;
    const perShare = shares > 0 ? fairMcap / shares : 0;
    const upside = mcap > 0 ? (fairMcap / mcap - 1) * 100 : 0;
    return { fairMcap, perShare, upside, terminalPv, explicitPv };
  }, [fcf, growth, terminalGrowth, discount, years, shares, mcap]);

  return (
    <MethodSection
      emoji="💸"
      title="DCF — Discounted Cash Flow (3-stage)"
      whatToEnter="Current annual Free Cash Flow (FCF) in ₹ Cr, expected growth % for the explicit period (3-7 years typical), terminal growth (2-5% — long-run inflation+real growth), and discount rate (10-14% for India; higher for risky names)."
      tip="Most fragile to discount rate — small change collapses or explodes the terminal value. Cross-check with sector EV/EBITDA. Terminal value usually drives 60-80% of total DCF — be conservative on terminal growth."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <NumberInput label="Current FCF" value={fcf} onChange={setFcf} suffix="₹ Cr" />
        <NumberInput label="Growth % (explicit)" value={growth} onChange={setGrowth} suffix="%" />
        <NumberInput label="Years (N)" value={years} onChange={setYears} suffix="yr" />
        <NumberInput label="Terminal Growth %" value={terminalGrowth} onChange={setTerminalGrowth} suffix="%" />
        <NumberInput label="Discount Rate %" value={discount} onChange={setDiscount} suffix="%" />
        <NumberInput label="Shares Outstanding" value={shares} onChange={setShares} suffix="Cr" />
        <NumberInput label="Current Market Cap" value={mcap} onChange={setMcap} suffix="₹ Cr" />
      </div>
      <div style={{ padding: '12px 14px', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderRadius: 4 }}>
        <div style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 4 }}>
          FAIR VALUE → ₹{Math.round(result.fairMcap).toLocaleString('en-IN')} Cr
          {' '}(₹{Math.round(result.perShare).toLocaleString('en-IN')}/share)
        </div>
        <div style={{ fontSize: 12, color: result.upside >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>
          Upside: {result.upside >= 0 ? '+' : ''}{result.upside.toFixed(0)}%
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: DIM }}>
          Explicit period PV: ₹{Math.round(result.explicitPv).toLocaleString('en-IN')} Cr ·{' '}
          Terminal PV: ₹{Math.round(result.terminalPv).toLocaleString('en-IN')} Cr{' '}
          ({result.fairMcap > 0 ? Math.round(result.terminalPv / result.fairMcap * 100) : 0}% of fair value)
        </div>
      </div>
    </MethodSection>
  );
}

function PEGCalculator() {
  const [pe, setPe] = useState(40);
  const [growth, setGrowth] = useState(25);

  const peg = growth > 0 ? pe / growth : 0;
  const verdict =
    peg === 0 ? { color: DIM, label: 'Enter growth %' }
      : peg < 1 ? { color: '#10B981', label: 'CHEAP — PEG < 1.0' }
        : peg < 1.5 ? { color: '#22D3EE', label: 'FAIR — PEG 1.0-1.5' }
          : peg < 2 ? { color: '#F59E0B', label: 'STRETCH — PEG 1.5-2.0' }
            : { color: '#EF4444', label: 'EXPENSIVE — PEG > 2.0' };

  return (
    <MethodSection
      emoji="⚖️"
      title="PEG — P/E to Growth Ratio (Peter Lynch)"
      whatToEnter="Forward P/E multiple (or trailing, but forward is cleaner) and the expected earnings growth rate over the next 3-5 years."
      tip="Lynch's rule: PEG below 1.0 = cheap, above 2.0 = expensive. Works for growth stocks; useless for cyclicals or value names. Always use sustainable growth — one big year doesn't count."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <NumberInput label="P/E (forward)" value={pe} onChange={setPe} suffix="x" />
        <NumberInput label="Earnings Growth" value={growth} onChange={setGrowth} suffix="%" />
      </div>
      <div style={{ padding: '12px 14px', background: `${verdict.color}15`, border: `1px solid ${verdict.color}40`, borderRadius: 4 }}>
        <div style={{ fontSize: 11, color: verdict.color, fontWeight: 800, marginBottom: 4 }}>PEG = {peg.toFixed(2)}</div>
        <div style={{ fontSize: 12, color: TEXT, fontWeight: 700 }}>{verdict.label}</div>
      </div>
    </MethodSection>
  );
}

function PBCalculator() {
  const [bvps, setBvps] = useState(120);
  const [bearPB, setBearPB] = useState(1.5);
  const [basePB, setBasePB] = useState(2.5);
  const [bullPB, setBullPB] = useState(3.5);
  const [shares, setShares] = useState(10);
  const [mcap, setMcap] = useState(3000);

  const totalBook = bvps * shares;
  const bear = totalBook * bearPB;
  const base = totalBook * basePB;
  const bull = totalBook * bullPB;
  const upsideBase = mcap > 0 ? (base / mcap - 1) * 100 : 0;

  return (
    <MethodSection
      emoji="🏦"
      title="P/B — Price-to-Book Value"
      whatToEnter="Book value per share (₹) — find on Screener under 'Book Value'. Multiple bands: typical range for the sector (banks 1-3×, NBFCs 1.5-4×, asset-heavy 0.5-1.5×). Shares outstanding and current market cap."
      tip="Use ONLY for: banks, NBFCs, insurers, REITs, and asset-heavy businesses (steel, ships). For software, FMCG, pharma — P/B is irrelevant. Always pair with ROE: P/B 2× at ROE 18% = fair; P/B 2× at ROE 8% = expensive."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <NumberInput label="Book Value / Share" value={bvps} onChange={setBvps} suffix="₹" />
        <NumberInput label="Shares Outstanding" value={shares} onChange={setShares} suffix="Cr" />
        <NumberInput label="Bear P/B" value={bearPB} onChange={setBearPB} suffix="x" />
        <NumberInput label="Base P/B" value={basePB} onChange={setBasePB} suffix="x" />
        <NumberInput label="Bull P/B" value={bullPB} onChange={setBullPB} suffix="x" />
        <NumberInput label="Current Market Cap" value={mcap} onChange={setMcap} suffix="₹ Cr" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { label: 'BEAR', val: bear, color: '#EF4444' },
          { label: 'BASE', val: base, color: '#22D3EE' },
          { label: 'BULL', val: bull, color: '#10B981' },
        ].map((c) => (
          <div key={c.label} style={{ padding: '10px 12px', background: 'var(--mc-bg-0)', border: `1px solid ${c.color}50`, borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: c.color, fontWeight: 800, letterSpacing: '1px' }}>{c.label}</div>
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
              ₹{Math.round(c.val).toLocaleString('en-IN')} Cr
            </div>
            <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>
              {mcap > 0 ? ((c.val / mcap - 1) * 100).toFixed(0) + '%' : '—'} vs current
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: DIM }}>
        Base case = book value ₹{Math.round(totalBook).toLocaleString('en-IN')} Cr × {basePB}× → ₹{Math.round(base).toLocaleString('en-IN')} Cr → {upsideBase >= 0 ? '+' : ''}{upsideBase.toFixed(0)}%
      </div>
    </MethodSection>
  );
}

function FCFYieldCalculator() {
  const [fcf, setFcf] = useState(150);
  const [mcap, setMcap] = useState(3000);
  const [riskFree, setRiskFree] = useState(7);

  const yieldPct = mcap > 0 ? (fcf / mcap) * 100 : 0;
  const spread = yieldPct - riskFree;
  const verdict =
    yieldPct === 0 ? { color: DIM, label: 'Enter inputs' }
      : spread > 3 ? { color: '#10B981', label: 'CHEAP — >3% over risk-free' }
        : spread > 0 ? { color: '#22D3EE', label: 'FAIR — slight premium to govt bond' }
          : spread > -3 ? { color: '#F59E0B', label: 'EXPENSIVE — yields less than govt bond' }
            : { color: '#EF4444', label: 'VERY EXPENSIVE — equity should pay risk premium' };

  return (
    <MethodSection
      emoji="💵"
      title="FCF Yield (Free Cash Flow Yield)"
      whatToEnter="Trailing 12-month Free Cash Flow (FCF = CFO − Capex) in ₹ Cr, current market cap, and 10-yr government bond yield (currently ~7% in India)."
      tip="For mature cash-cow businesses (FMCG, IT, dividend payers). FCF Yield should beat the risk-free rate by 2-4% to compensate for equity risk. Don't use for high-capex names where FCF is volatile."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <NumberInput label="TTM Free Cash Flow" value={fcf} onChange={setFcf} suffix="₹ Cr" />
        <NumberInput label="Current Market Cap" value={mcap} onChange={setMcap} suffix="₹ Cr" />
        <NumberInput label="10yr Govt Bond Yield" value={riskFree} onChange={setRiskFree} suffix="%" />
      </div>
      <div style={{ padding: '12px 14px', background: `${verdict.color}15`, border: `1px solid ${verdict.color}40`, borderRadius: 4 }}>
        <div style={{ fontSize: 11, color: verdict.color, fontWeight: 800, marginBottom: 4 }}>
          FCF Yield = {yieldPct.toFixed(2)}% · Spread over bond = {spread >= 0 ? '+' : ''}{spread.toFixed(2)}%
        </div>
        <div style={{ fontSize: 12, color: TEXT, fontWeight: 700 }}>{verdict.label}</div>
      </div>
    </MethodSection>
  );
}

function SumOfPartsCalculator() {
  const [s1Name, setS1Name] = useState('Segment A');
  const [s1Rev, setS1Rev] = useState(2400);
  const [s1Mult, setS1Mult] = useState(3);
  const [s2Name, setS2Name] = useState('Segment B');
  const [s2Rev, setS2Rev] = useState(500);
  const [s2Mult, setS2Mult] = useState(8);
  const [s3Name, setS3Name] = useState('Other');
  const [s3Rev, setS3Rev] = useState(1000);
  const [s3Mult, setS3Mult] = useState(2);
  const [netDebt, setNetDebt] = useState(0);
  const [discount, setDiscount] = useState(10);
  const [mcap, setMcap] = useState(15000);

  const s1Val = s1Rev * s1Mult;
  const s2Val = s2Rev * s2Mult;
  const s3Val = s3Rev * s3Mult;
  const gross = s1Val + s2Val + s3Val;
  const conglomDiscount = gross * (discount / 100);
  const ev = gross - conglomDiscount;
  const equity = ev - netDebt;
  const upside = mcap > 0 ? (equity / mcap - 1) * 100 : 0;

  return (
    <MethodSection
      emoji="🧩"
      title="Sum-of-Parts (SoP) — Multi-segment Valuation"
      whatToEnter="Each segment: name, forward revenue (₹ Cr), and sector-appropriate multiple. Plus net debt and a conglomerate discount (10% for 2 segments, 15% for 3+, 20% for unrelated)."
      tip="Use when management gives separate guidance per segment (HFCL: OFC ₹3500 + Defence ₹500). High-multiple segment drives most of value — verify margin and growth there carefully. Don't sum-of-parts unrelated lines without applying conglomerate discount."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {[
          { name: s1Name, setName: setS1Name, rev: s1Rev, setRev: setS1Rev, mult: s1Mult, setMult: setS1Mult, val: s1Val, color: '#22D3EE' },
          { name: s2Name, setName: setS2Name, rev: s2Rev, setRev: setS2Rev, mult: s2Mult, setMult: setS2Mult, val: s2Val, color: '#A78BFA' },
          { name: s3Name, setName: setS3Name, rev: s3Rev, setRev: setS3Rev, mult: s3Mult, setMult: setS3Mult, val: s3Val, color: '#F59E0B' },
        ].map((s, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
            <input type="text" value={s.name} onChange={(e) => s.setName(e.target.value)}
              placeholder="Segment name"
              style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 10px', borderRadius: 4, fontSize: 12 }} />
            <NumberInput label="" value={s.rev} onChange={s.setRev} suffix="₹ Cr" />
            <NumberInput label="" value={s.mult} onChange={s.setMult} suffix="x" />
            <span style={{ fontSize: 12, color: s.color, fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 110, textAlign: 'right' }}>
              ₹{Math.round(s.val).toLocaleString('en-IN')} Cr
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <NumberInput label="Net Debt" value={netDebt} onChange={setNetDebt} suffix="₹ Cr" />
        <NumberInput label="Conglomerate Discount" value={discount} onChange={setDiscount} suffix="%" />
        <NumberInput label="Current Market Cap" value={mcap} onChange={setMcap} suffix="₹ Cr" />
      </div>
      <div style={{ padding: '12px 14px', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderRadius: 4 }}>
        <div style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 4 }}>
          Gross EV ₹{Math.round(gross).toLocaleString('en-IN')} − discount ₹{Math.round(conglomDiscount).toLocaleString('en-IN')} = EV ₹{Math.round(ev).toLocaleString('en-IN')} Cr
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 4 }}>
          Equity = ₹{Math.round(equity).toLocaleString('en-IN')} Cr (after net debt)
        </div>
        <div style={{ fontSize: 12, color: upside >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>
          Upside: {upside >= 0 ? '+' : ''}{upside.toFixed(0)}%
        </div>
      </div>
    </MethodSection>
  );
}

function DividendDiscountCalculator() {
  const [dps, setDps] = useState(40);
  const [growth, setGrowth] = useState(8);
  const [requiredReturn, setRequiredReturn] = useState(12);
  const [currentPrice, setCurrentPrice] = useState(500);

  const fairPrice =
    requiredReturn > growth
      ? (dps * (1 + growth / 100)) / ((requiredReturn - growth) / 100)
      : 0;
  const upside = currentPrice > 0 ? (fairPrice / currentPrice - 1) * 100 : 0;
  const yieldPct = currentPrice > 0 ? (dps / currentPrice) * 100 : 0;

  return (
    <MethodSection
      emoji="💰"
      title="Dividend Discount Model (Gordon Growth)"
      whatToEnter="Current dividend per share (₹), expected dividend growth rate (sustainable, usually 5-12%), and your required rate of return (10-15% for equity)."
      tip="ONLY use for steady dividend-paying names (utilities, FMCG dividend kings, ITC, ONGC, mature IT). Useless for high-growth / no-dividend stocks. Required return must exceed growth or the model breaks."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        <NumberInput label="Dividend / Share (TTM)" value={dps} onChange={setDps} suffix="₹" />
        <NumberInput label="Expected Growth" value={growth} onChange={setGrowth} suffix="%" />
        <NumberInput label="Required Return" value={requiredReturn} onChange={setRequiredReturn} suffix="%" />
        <NumberInput label="Current Share Price" value={currentPrice} onChange={setCurrentPrice} suffix="₹" />
      </div>
      {fairPrice === 0 ? (
        <div style={{ padding: '12px 14px', background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', borderRadius: 4, fontSize: 12, color: 'var(--mc-bearish)' }}>
          ⚠ Required return ({requiredReturn}%) must exceed growth ({growth}%) for Gordon Growth to converge.
        </div>
      ) : (
        <div style={{ padding: '12px 14px', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderRadius: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--mc-bullish)', fontWeight: 800, marginBottom: 4 }}>
            Fair Value ₹{Math.round(fairPrice).toLocaleString('en-IN')}/share · Current yield {yieldPct.toFixed(2)}%
          </div>
          <div style={{ fontSize: 12, color: upside >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)', fontWeight: 700 }}>
            Upside: {upside >= 0 ? '+' : ''}{upside.toFixed(0)}%
          </div>
        </div>
      )}
    </MethodSection>
  );
}

function MoreMethodsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: TEXT }}>🧬 More Valuation Methods</h2>
        <div style={{ marginTop: 6, fontSize: 12.5, color: DIM, lineHeight: 1.55 }}>
          Six additional lenses — DCF, PEG, P/B, FCF Yield, Sum-of-Parts, Dividend Discount.
          Each one has a "what to enter" guide and a tip. Use the right method for the right
          business: DCF for compounders, PEG for growth, P/B for banks, FCF Yield for mature
          cash-cows, SoP for conglomerates, DDM for dividend yielders.
        </div>
      </div>
      <DCFCalculator />
      <PEGCalculator />
      <PBCalculator />
      <FCFYieldCalculator />
      <SumOfPartsCalculator />
      <DividendDiscountCalculator />
    </div>
  );
}

function LearnTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: TEXT }}>📚 Learn — How to Read Forward Guidance</h2>
        <div style={{ marginTop: 6, fontSize: 13, color: DIM, lineHeight: 1.55 }}>
          Twelve ways managements communicate forward numbers — and how to convert each into a fair-value estimate.
          Drawn from concall transcripts of 23 small-mid cap winners. Each pattern shows the formula, a worked example
          with real numbers, and tips on common analyst mistakes.
        </div>
      </div>

      {/* Master pattern table */}
      <div style={{ background: '#1A1F33', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.5px', marginBottom: 10 }}>
          THE 12 GUIDANCE PATTERNS
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }}>
          {GUIDANCE_METHODS.map((m, i) => (
            <a key={m.id} href={`#${m.id}`} style={{
              fontSize: 12, padding: '8px 12px',
              background: '#0D1426', border: `1px solid ${BORDER}`, borderRadius: 4,
              color: TEXT, textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 10, color: DIM, fontFamily: 'ui-monospace, monospace' }}>#{String(i + 1).padStart(2, '0')}</span>
              <span>{m.emoji}</span>
              <span style={{ fontWeight: 600 }}>{m.title}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Method cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {GUIDANCE_METHODS.map((m, i) => (
          <div key={m.id} id={m.id}>
            <MethodCard m={m} idx={i} />
          </div>
        ))}
      </div>

      {/* PATCH 0659 — Practice Examples — 20 real company calculations */}
      <div style={{ background: '#1A1F33', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '16px 18px', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--mc-cyan)' }}>
            📊 Practice Examples — 20 Companies, Live Calculations
          </h3>
          <span style={{ fontSize: 10, color: DIM, fontFamily: 'ui-monospace, monospace' }}>tilde (~) marks approximate inputs</span>
        </div>
        <div style={{ fontSize: 12, color: DIM, lineHeight: 1.55, marginBottom: 14 }}>
          Each company below uses the exact guidance from the management table you provided. TTM revenue and
          current market cap are approximate — swap in precise numbers from a fresh quote to refine. The
          methodology is what matters: each row picks the right pattern from above and works the calc end-to-end.
          Click any row to expand the full breakdown.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PRACTICE_EXAMPLES.map((ex, i) => (
            <PracticeExampleCard key={i} ex={ex} />
          ))}
        </div>
      </div>

      {/* Footer — meta-lessons */}
      <div style={{ background: '#1A1F33', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 8, padding: '16px 18px', marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-warn)', marginBottom: 8 }}>⚖️ INSTITUTIONAL LESSONS</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: TEXT, lineHeight: 1.7 }}>
          <li><b>Always pick the multiple your stock ACTUALLY trades at</b> (5-yr median), not the sector average. Premium names trade above sector, value names below.</li>
          <li><b>For ranges, base-case = midpoint</b>, but discount the upper bound by 20% — most managements miss their stretch.</li>
          <li><b>Conservative / floor guidance → BEAR case anchor</b>. Stretch / ambition guidance → BULL case. Don\'t use one as your base.</li>
          <li><b>Margin guidance compounds.</b> A 200-bp margin expansion on 30% revenue growth is 35%+ EBITDA growth — much bigger than each individually.</li>
          <li><b>Multi-year CAGR → discount terminal multiple.</b> Markets re-rate downward as growth approaches the horizon. Apply 80% of base multiple for the terminal year.</li>
          <li><b>Peak revenue ≠ steady-state revenue.</b> Peak assumes 100% capacity utilization. Discount 10-15% for realistic ramp.</li>
          <li><b>Sum-of-parts has a conglomerate discount.</b> 2 segments → 10%; 3+ → 15%; unrelated diversification → 20%.</li>
          <li><b>Sustainable margin guidance is LONG-RUN.</b> Pair with revenue growth thesis; never use standalone for current-year valuation.</li>
        </ul>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// REVERSE-DCF / FUTURE-P/E CALCULATOR (PATCH 0701)
//
// Two lenses on the same question — "is today's price asking too much?"
//   1. Reverse-DCF: hold the current market cap fixed, solve (bisection) for the
//      FCF growth rate the market is IMPLYING. Compare to what you actually
//      expect. Implied << expected  ⇒  cheap;  implied >> expected  ⇒  priced
//      for perfection.
//   2. Future P/E: project EPS forward at your growth, apply an exit multiple
//      band (bear/base/bull), and see the CAGR — decomposed into how much comes
//      from earnings vs re-rating. Kills the "great company, terrible entry"
//      trap.
// Fully client-side; auto-fill pulls live price + market cap like the others.
// ═══════════════════════════════════════════════════════════════════════════

// Two-stage DCF present value for a given high-growth rate g.
function twoStageDcfValue(fcf0: number, g: number, r: number, gt: number, years: number): number {
  if (r <= gt) return Infinity; // terminal formula degenerate
  let pv = 0;
  let fcf = fcf0;
  for (let t = 1; t <= years; t++) {
    fcf = fcf * (1 + g);
    pv += fcf / Math.pow(1 + r, t);
  }
  // terminal value at end of year N, then discounted back
  const terminalFcf = fcf * (1 + gt);
  const terminalValue = terminalFcf / (r - gt);
  pv += terminalValue / Math.pow(1 + r, years);
  return pv;
}

// Solve for the implied high-growth rate that makes DCF value == target mcap.
function solveImpliedGrowth(targetMcap: number, fcf0: number, r: number, gt: number, years: number): number | null {
  if (fcf0 <= 0 || targetMcap <= 0) return null;
  let lo = -0.5;  // -50%
  let hi = 1.5;   // +150%
  // Value is monotonic increasing in g; make sure target is bracketed.
  const vLo = twoStageDcfValue(fcf0, lo, r, gt, years);
  const vHi = twoStageDcfValue(fcf0, hi, r, gt, years);
  if (targetMcap < vLo) return lo; // even -50% overshoots — market pricing < that
  if (targetMcap > vHi) return hi; // needs > 150% — off the chart
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const v = twoStageDcfValue(fcf0, mid, r, gt, years);
    if (v > targetMcap) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

function ReverseDcfCalculator() {
  const [mode, setMode] = useState<'REVERSE' | 'FUTURE_PE' | 'RETURN_PATH'>('REVERSE');

  // shared / reverse-dcf inputs
  const [ticker, setTicker] = useState('');
  const [market, setMarket] = useState<'india' | 'us'>('india');
  const [notInUni, setNotInUni] = useState(false);
  const [mcap, setMcap] = useState<number>(10000);     // ₹ Cr
  const [fcf, setFcf] = useState<number>(400);         // ₹ Cr (current FCF or PAT proxy)
  const [discount, setDiscount] = useState<number>(12);// %
  const [terminal, setTerminal] = useState<number>(4); // %
  const [years, setYears] = useState<number>(10);
  const [expectedG, setExpectedG] = useState<number>(20); // % — what YOU expect

  // future-p/e inputs
  const [price, setPrice] = useState<number>(500);
  const [eps, setEps] = useState<number>(20);
  const [epsCagr, setEpsCagr] = useState<number>(20);
  const [holdYears, setHoldYears] = useState<number>(5);
  const [exitPeBase, setExitPeBase] = useState<number>(25);

  const cur = market === 'us' ? '$' : '₹';

  const impliedG = useMemo(
    () => solveImpliedGrowth(mcap, fcf, discount / 100, terminal / 100, Math.max(1, Math.round(years))),
    [mcap, fcf, discount, terminal, years],
  );

  // gap verdict
  const gapVerdict = useMemo(() => {
    if (impliedG === null) return null;
    const impliedPct = impliedG * 100;
    const gap = expectedG - impliedPct; // positive = you expect more than priced-in = cheap
    let label: string, color: string, note: string;
    if (impliedPct >= 1.45 * 100 - 5) { label = 'OFF THE CHART'; color = '#EF4444'; note = 'Market is pricing in >145% FCF CAGR — implausible; treat the model as saturated, not the stock as cheap.'; }
    else if (gap >= 8) { label = 'CHEAP vs your view'; color = '#10B981'; note = `You expect ~${expectedG.toFixed(0)}% but the price only demands ~${impliedPct.toFixed(1)}%. If your growth is right, there's a valuation cushion.`; }
    else if (gap >= -4) { label = 'FAIRLY PRICED'; color = '#F59E0B'; note = `The market is already discounting roughly what you expect (~${impliedPct.toFixed(1)}%). Returns will track earnings, not re-rating.`; }
    else { label = 'PRICED FOR PERFECTION'; color = '#EF4444'; note = `Price demands ~${impliedPct.toFixed(1)}% FCF CAGR — more than your ~${expectedG.toFixed(0)}% expectation. Any stumble de-rates hard.`; }
    return { impliedPct, gap, label, color, note };
  }, [impliedG, expectedG]);

  // future p/e result — three exit-multiple cases
  const futureCases = useMemo(() => {
    if (eps <= 0 || price <= 0 || holdYears <= 0) return null;
    const futureEps = eps * Math.pow(1 + epsCagr / 100, holdYears);
    const currentPe = price / eps;
    const bands: { label: string; color: string; pe: number }[] = [
      { label: 'BEAR', color: '#EF4444', pe: exitPeBase * 0.7 },
      { label: 'BASE', color: '#F59E0B', pe: exitPeBase },
      { label: 'BULL', color: '#10B981', pe: exitPeBase * 1.3 },
    ];
    return {
      futureEps, currentPe,
      cases: bands.map((b) => {
        const futurePrice = futureEps * b.pe;
        const totalRet = futurePrice / price - 1;
        const cagr = Math.pow(futurePrice / price, 1 / holdYears) - 1;
        // decomposition: earnings-driven vs multiple-driven
        const earningsMult = futureEps / eps;         // from EPS growth
        const reRating = b.pe / currentPe;            // from multiple change
        return { ...b, futurePrice, totalRet, cagr, earningsMult, reRating };
      }),
    };
  }, [eps, price, epsCagr, holdYears, exitPeBase]);

  return (
    <div>
      <div style={{ fontSize: 13, color: DIM, lineHeight: 1.6, marginBottom: 14 }}>
        The other calculators ask <i>&ldquo;what could it be worth?&rdquo;</i> — this one asks{' '}
        <b style={{ color: 'var(--mc-cyan)' }}>&ldquo;what is today&rsquo;s price already assuming?&rdquo;</b>{' '}
        Reverse-DCF backs out the growth rate baked into the current market cap; Future-P/E projects earnings forward and shows how much of your return is real growth vs a multiple you&rsquo;re hoping for.
      </div>

      {/* mode toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          { id: 'REVERSE', label: '🔎 Reverse-DCF (implied growth)' },
          { id: 'FUTURE_PE', label: '📈 Future P/E (exit-multiple return)' },
          { id: 'RETURN_PATH', label: '📅 10-Year Return Path → CAGR' },
        ] as const).map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)} style={{
            fontSize: 12, padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 800,
            background: mode === m.id ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : 'transparent',
            border: `1px solid ${mode === m.id ? 'var(--mc-cyan)' : BORDER}`,
            color: mode === m.id ? 'var(--mc-cyan)' : DIM,
          }}>{m.label}</button>
        ))}
      </div>

      {mode === 'REVERSE' ? (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ color: DIM, fontWeight: 700 }}>Ticker</span>
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="e.g. RUBICON"
                style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 10px', borderRadius: 4, fontSize: 13, width: 150, fontWeight: 600 }} />
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['india', 'us'] as const).map((mk) => (
                <button key={mk} onClick={() => setMarket(mk)} style={chipBtn(market === mk ? 'var(--mc-cyan)' : DIM)}>
                  {mk === 'india' ? '🇮🇳 India' : '🇺🇸 US'}
                </button>
              ))}
            </div>
          </div>
          <AutoFillBtn ticker={ticker} market={market} onFill={(q) => {
            if (q.currentMarketCapCr) setMcap(Math.round(q.currentMarketCapCr));
            if (q.currentPrice) setPrice(q.currentPrice);
          }} onNotInUniverse={setNotInUni} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 6 }}>
            <NumberInput label="Current market cap" value={mcap} onChange={setMcap} suffix="Cr" highlight={notInUni} helper="Not in live feed — enter market cap from Screener.in" ticker={ticker} />
            <NumberInput label="Current FCF (or PAT)" value={fcf} onChange={setFcf} suffix="Cr" />
            <NumberInput label="Discount rate" value={discount} onChange={setDiscount} suffix="%" />
            <NumberInput label="Terminal growth" value={terminal} onChange={setTerminal} suffix="%" />
            <NumberInput label="High-growth years" value={years} onChange={setYears} suffix="yr" />
            <NumberInput label="Growth YOU expect" value={expectedG} onChange={setExpectedG} suffix="%" />
          </div>

          {gapVerdict && (
            <div style={{ marginTop: 18 }}>
              <div style={{
                background: `color-mix(in srgb, ${gapVerdict.color} 9%, transparent)`,
                border: `1px solid ${gapVerdict.color}55`, borderLeft: `4px solid ${gapVerdict.color}`,
                borderRadius: 6, padding: '16px 18px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: DIM, letterSpacing: '1px' }}>MARKET-IMPLIED FCF CAGR (next {Math.round(years)}y)</div>
                    <div style={{ fontSize: 34, fontWeight: 900, color: gapVerdict.color, fontVariantNumeric: 'tabular-nums' }}>
                      {gapVerdict.impliedPct.toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: gapVerdict.color, letterSpacing: '0.5px' }}>{gapVerdict.label}</div>
                    <div style={{ fontSize: 12, color: DIM, marginTop: 3 }}>
                      you expect <b style={{ color: TEXT }}>{expectedG.toFixed(0)}%</b> · gap{' '}
                      <b style={{ color: gapVerdict.color }}>{gapVerdict.gap >= 0 ? '+' : ''}{gapVerdict.gap.toFixed(1)}pp</b>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 12.5, color: TEXT, lineHeight: 1.6 }}>{gapVerdict.note}</div>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: DIM, lineHeight: 1.6, fontStyle: 'italic' }}>
                Two-stage model: FCF grows at the implied rate for {Math.round(years)} years, then {terminal.toFixed(0)}% forever, discounted at {discount.toFixed(0)}%. FCF is the honest driver, but if you only have PAT, using it as a proxy is fine for a first read — just know rising capex makes real FCF lower, so the true implied growth is a touch higher than shown.
              </div>
            </div>
          )}
        </>
      ) : mode === 'FUTURE_PE' ? (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ color: DIM, fontWeight: 700 }}>Ticker</span>
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="e.g. RUBICON"
                style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 10px', borderRadius: 4, fontSize: 13, width: 150, fontWeight: 600 }} />
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['india', 'us'] as const).map((mk) => (
                <button key={mk} onClick={() => setMarket(mk)} style={chipBtn(market === mk ? 'var(--mc-cyan)' : DIM)}>
                  {mk === 'india' ? '🇮🇳 India' : '🇺🇸 US'}
                </button>
              ))}
            </div>
          </div>
          <AutoFillBtn ticker={ticker} market={market} currentPrice={price} onFill={(q) => {
            if (q.currentPrice) setPrice(q.currentPrice);
          }} onNotInUniverse={setNotInUni} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 6 }}>
            <NumberInput label="Current price" value={price} onChange={setPrice} suffix={cur} />
            <NumberInput label="Current EPS (TTM)" value={eps} onChange={setEps} suffix={cur} />
            <NumberInput label="EPS CAGR (your view)" value={epsCagr} onChange={setEpsCagr} suffix="%" />
            <NumberInput label="Holding period" value={holdYears} onChange={setHoldYears} suffix="yr" />
            <NumberInput label="Exit P/E (base)" value={exitPeBase} onChange={setExitPeBase} suffix="×" />
          </div>

          {futureCases && (
            <div style={{ marginTop: 18 }}>
              <div style={{
                background: 'color-mix(in srgb, var(--mc-cyan) 7%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)',
                borderRadius: 6, padding: '12px 14px', marginBottom: 12, fontSize: 13, color: TEXT, lineHeight: 1.6,
              }}>
                <b style={{ color: 'var(--mc-cyan)' }}>📊 Buying at {futureCases.currentPe.toFixed(1)}× today.</b>{' '}
                EPS compounds to <b>{cur}{futureCases.futureEps.toFixed(1)}</b> in {holdYears}y at {epsCagr.toFixed(0)}%. The exit multiple you pay for on the way out decides the rest:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {futureCases.cases.map((c) => (
                  <div key={c.label} style={{ background: CARD, border: `1px solid ${c.color}50`, borderLeft: `4px solid ${c.color}`, borderRadius: 6, padding: '14px 16px' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: c.color, letterSpacing: '1px', marginBottom: 6 }}>{c.label} · {c.pe.toFixed(1)}× exit</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{cur}{c.futurePrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                    <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>target price in {holdYears}y</div>
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: DIM }}>Total return</span>
                      <span style={{ color: c.color, fontWeight: 800 }}>{c.totalRet >= 0 ? '+' : ''}{(c.totalRet * 100).toFixed(0)}%</span>
                    </div>
                    <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: DIM }}>CAGR</span>
                      <span style={{ color: c.color, fontWeight: 800 }}>{c.cagr >= 0 ? '+' : ''}{(c.cagr * 100).toFixed(1)}%</span>
                    </div>
                    <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${c.color}30`, fontSize: 10, color: DIM, lineHeight: 1.5 }}>
                      {c.earningsMult.toFixed(1)}× from earnings ·{' '}
                      <span style={{ color: c.reRating >= 1 ? '#10B981' : '#EF4444' }}>{c.reRating >= 1 ? '+' : ''}{((c.reRating - 1) * 100).toFixed(0)}% re-rating</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: DIM, lineHeight: 1.6, fontStyle: 'italic' }}>
                Bear/Bull exit multiples are the base ±30%. Watch the re-rating line: if a chunk of your bull-case CAGR comes from the multiple <i>expanding</i>, you&rsquo;re partly betting on sentiment, not the business. The durable returns are the ones the earnings column alone can carry.
              </div>
            </div>
          )}
        </>
      ) : (
        <ReturnPathTable />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0702 — 10-YEAR RETURN PATH → CAGR
//
// The lumpy truth of multibagger compounding: returns don't arrive smoothly.
// A path with two monster years (+110%, +200%, +100%) and several flat/down
// years still compounds to a large multiple — this table makes that visible
// and computes the ONE number that matters, the overall CAGR, from whatever
// yearly path you type. Seeded with an illustrative 2025→2034 path. Fully
// editable; add/remove years; nothing here touches the other calculators.
// ═══════════════════════════════════════════════════════════════════════════
function ReturnPathTable() {
  const START_YEAR = 2025;
  const SEED = [0, 110, -20, 5, 5, 200, -10, 5, 10, 100];
  const [rets, setRets] = useState<number[]>(SEED);
  const [startCapital, setStartCapital] = useState<number>(100000);

  // running value + cumulative multiple after each year
  const rows = useMemo(() => {
    let val = startCapital;
    return rets.map((r, i) => {
      const start = val;
      val = val * (1 + r / 100);
      return {
        year: START_YEAR + i,
        ret: r,
        startVal: start,
        endVal: val,
        cumMultiple: val / startCapital,
        cumReturnPct: (val / startCapital - 1) * 100,
      };
    });
  }, [rets, startCapital]);

  const n = rets.length;
  const finalVal = rows.length ? rows[rows.length - 1].endVal : startCapital;
  const finalMultiple = finalVal / startCapital;
  const totalReturnPct = (finalMultiple - 1) * 100;
  const cagr = n > 0 && finalMultiple > 0 ? (Math.pow(finalMultiple, 1 / n) - 1) * 100 : 0;
  // how many years did the heavy lifting? share of total log-growth per year
  const logTotal = finalMultiple > 0 ? Math.log(finalMultiple) : 0;
  const contrib = rows.map((r) => (logTotal > 0 ? Math.log(1 + r.ret / 100) / logTotal * 100 : 0));

  const setYear = (i: number, v: number) => setRets((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  const addYear = () => setRets((prev) => [...prev, 0]);
  const removeYear = () => setRets((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const reset = () => { setRets(SEED); setStartCapital(100000); };

  const fmt = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
  const retColor = (r: number) => (r > 0 ? '#10B981' : r < 0 ? '#EF4444' : DIM);

  return (
    <div>
      <div style={{ fontSize: 13, color: DIM, lineHeight: 1.6, marginBottom: 14 }}>
        Type a return for each year and this computes the <b style={{ color: 'var(--mc-cyan)' }}>overall CAGR</b> the lumpy path actually delivers. Multibagger compounding is never smooth — a couple of explosive years carry a decade. The illustrative path below (2025→2034) ends at{' '}
        <b style={{ color: '#10B981' }}>{finalMultiple.toFixed(2)}×</b> your capital ={' '}
        <b style={{ color: '#10B981' }}>{cagr.toFixed(1)}% CAGR</b>.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <NumberInput label="Starting capital" value={startCapital} onChange={(v) => setStartCapital(Math.max(1, v))} suffix="₹" />
        <button onClick={addYear} style={{ ...chipBtn('var(--mc-cyan)'), padding: '7px 12px' }}>+ Add year</button>
        <button onClick={removeYear} style={{ ...chipBtn(DIM), padding: '7px 12px' }}>− Remove last</button>
        <button onClick={reset} style={{ ...chipBtn('var(--mc-warn)'), padding: '7px 12px' }}>↺ Reset to example</button>
      </div>

      {/* headline result cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: `Overall CAGR (${n}y)`, val: `${cagr >= 0 ? '+' : ''}${cagr.toFixed(1)}%`, c: cagr >= 0 ? '#10B981' : '#EF4444' },
          { label: 'Final multiple', val: `${finalMultiple.toFixed(2)}×`, c: '#F59E0B' },
          { label: 'Total return', val: `${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(0)}%`, c: totalReturnPct >= 0 ? '#10B981' : '#EF4444' },
          { label: 'Ending value', val: fmt(finalVal), c: TEXT },
        ].map((t) => (
          <div key={t.label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${t.c}`, borderRadius: 6, padding: '12px 14px' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: t.c, fontVariantNumeric: 'tabular-nums' }}>{t.val}</div>
            <div style={{ fontSize: 10.5, color: DIM, marginTop: 2 }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* the path table */}
      <div style={{ overflowX: 'auto', border: `1px solid ${BORDER}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
          <thead>
            <tr>
              {['Year', 'Return %', 'Start value', 'End value', 'Cumulative', 'Cum. return', 'Share of gain'].map((h) => (
                <th key={h} style={{ textAlign: h === 'Year' || h === 'Return %' ? 'left' : 'right', padding: '9px 12px', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: DIM, borderBottom: `1px solid ${BORDER}`, background: 'var(--mc-bg-2)', fontFamily: 'ui-monospace, monospace' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.year} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                <td style={{ padding: '8px 12px', fontWeight: 800, color: TEXT, fontFamily: 'ui-monospace, monospace' }}>Y{i + 1} · {r.year}</td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" value={r.ret} onChange={(e) => setYear(i, Number(e.target.value))}
                      style={{ width: 74, background: 'var(--mc-bg-0)', color: retColor(r.ret), border: `1px solid ${BORDER}`, padding: '5px 8px', borderRadius: 4, fontSize: 13, fontWeight: 800, fontFamily: 'ui-monospace, monospace', textAlign: 'right' }} />
                    <span style={{ fontSize: 11, color: DIM }}>%</span>
                  </div>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: DIM, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.startVal)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: TEXT, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.endVal)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: '#F59E0B', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{r.cumMultiple.toFixed(2)}×</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: r.cumReturnPct >= 0 ? '#10B981' : '#EF4444', fontVariantNumeric: 'tabular-nums' }}>{r.cumReturnPct >= 0 ? '+' : ''}{r.cumReturnPct.toFixed(0)}%</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: DIM, fontVariantNumeric: 'tabular-nums' }}>
                  {contrib[i] > 0 ? `${contrib[i].toFixed(0)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--mc-bg-2)' }}>
              <td style={{ padding: '10px 12px', fontWeight: 900, color: TEXT }}>TOTAL · {n}y</td>
              <td style={{ padding: '10px 12px', fontWeight: 900, color: cagr >= 0 ? '#10B981' : '#EF4444', fontFamily: 'ui-monospace, monospace' }}>{cagr >= 0 ? '+' : ''}{cagr.toFixed(1)}% CAGR</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', color: DIM }}>{fmt(startCapital)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{fmt(finalVal)}</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, color: '#F59E0B' }}>{finalMultiple.toFixed(2)}×</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 900, color: totalReturnPct >= 0 ? '#10B981' : '#EF4444' }}>{totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(0)}%</td>
              <td style={{ padding: '10px 12px', textAlign: 'right', color: DIM }}>100%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: DIM, lineHeight: 1.6, fontStyle: 'italic' }}>
        CAGR = (final multiple)^(1/{n}) − 1 — the single smooth rate that reproduces the whole path. &ldquo;Share of gain&rdquo; is each year&rsquo;s slice of total log-growth: notice how two or three explosive years own most of the decade, while flat and down years barely dent the compounding. That is exactly why you hold the winners through the boring years — and why one big drawdown late in the path costs so much. Illustrative math, not a forecast.
      </div>
    </div>
  );
}

export default function ValuationCalcPage() {
  const [tab, setTab] = useState<CalcKind>('PE');
  // PATCH 0636 — switch tab when EDIT is clicked on a saved valuation
  useEffect(() => {
    const h = (e: any) => {
      const v = e?.detail as SavedValuation | undefined;
      if (!v) return;
      setTab(v.calcKind);
    };
    window.addEventListener('mc:load-valuation', h);
    return () => window.removeEventListener('mc:load-valuation', h);
  }, []);
  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '24px 28px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: TEXT }}>🧮 Valuation Calculators</h1>
          <div style={{ marginTop: 4, fontSize: 13, color: DIM, lineHeight: 1.55 }}>
            Project market cap from management guidance + a sector-appropriate multiple band. Always run before sizing entry.
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap' }}>
          {([
            { id: 'FAIR_VALUE', label: 'Fair Value (Excel)', emoji: '🧾' },
            { id: 'PE',         label: 'P/E Target',        emoji: '📈' },
            { id: 'PS',         label: 'P/S Target',        emoji: '💰' },
            { id: 'EV_EBITDA',  label: 'EV / EBITDA',       emoji: '🏭' },
            { id: 'REVERSE_DCF', label: 'Reverse-DCF',      emoji: '🔎' },
            { id: 'MORE',       label: 'More Methods',      emoji: '🧬' },
            { id: 'ANALYTICS',  label: 'Analytics',         emoji: '📊' },
            { id: 'LEARN',      label: 'Learn',             emoji: '📚' },
          ] as const).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              fontSize: 13, padding: '10px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--mc-cyan)' : '2px solid transparent',
              color: tab === t.id ? 'var(--mc-cyan)' : DIM,
              cursor: 'pointer',
              fontWeight: 700,
            }}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '20px 22px' }}>
          {tab === 'FAIR_VALUE' && <ForwardFairValueCalculator />}
          {tab === 'PS' && <PSCalculator />}
          {tab === 'PE' && <PECalculator />}
          {tab === 'EV_EBITDA' && <EvEbitdaCalculator />}
          {tab === 'REVERSE_DCF' && <ReverseDcfCalculator />}
          {tab === 'MORE' && <MoreMethodsTab />}
          {tab === 'ANALYTICS' && <ValuationAnalyticsPanel />}
          {tab === 'LEARN' && <LearnTab />}
        </div>

        {/* PATCH 0633 — Saved valuations panel */}
        <SavedValuationsPanel />

        {/* Sector → calculator map */}
        <SectorLookupPanel />

        <div style={{ fontSize: 11, color: DIM, padding: '12px 0', lineHeight: 1.6, fontStyle: 'italic' }}>
          All calculators run client-side — no data leaves your browser. Edit assumptions freely. Worked examples (Rubicon, Bajaj Consumer, TD Power, Sterlite, Aeroflex, Atlanta Electricals, DEE Dev) are built in — load any to see the inputs and tweak.
        </div>
      </div>
    </div>
  );
}
