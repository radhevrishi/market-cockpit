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

import { useState, useMemo, useEffect } from 'react';
import {
  calculatePS, calculatePE, calculateEvEbitda,
  fetchQuoteAutofill,
  loadSavedValuations, saveValuation, deleteValuation,
  loadTickerUniverse, searchTickerUniverse,
  WORKED_EXAMPLES, SECTOR_CALCULATOR_MAP,
  type CalculatorResult, type QuoteAutoFill, type SavedValuation, type TickerHit,
} from '@/lib/valuation-calculators';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

type CalcKind = 'PS' | 'PE' | 'EV_EBITDA' | 'ANALYTICS';

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
      background: '#10B98112', border: '1px solid #10B98140', borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional note (e.g. 'mgmt FY27 guidance · cross-confirmed by CB')"
        style={{
          flex: 1, minWidth: 240,
          background: '#0A1422', color: TEXT, border: `1px solid ${BORDER}`,
          padding: '6px 10px', borderRadius: 4, fontSize: 12,
        }}
      />
      <button onClick={handleSave} style={{
        fontSize: 12, padding: '6px 14px',
        background: '#10B981', border: 'none', color: '#0A0E1A',
        borderRadius: 4, cursor: 'pointer', fontWeight: 800,
      }}>
        💾 SAVE VALUATION
      </button>
      {savedId && (
        <span style={{ fontSize: 10, color: '#10B981', fontWeight: 700 }}>
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
          No saved valuations yet. Run a calculator → click <b style={{ color: '#10B981' }}>💾 SAVE VALUATION</b> on the result.<br />
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
          <div style={{ fontSize: 22, fontWeight: 900, color: '#10B981', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            +{avgBullUpside.toFixed(0)}%
          </div>
          <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>book-wide best-case</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BEAR CASE AVG</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#EF4444', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {avgBearUpside >= 0 ? '+' : ''}{avgBearUpside.toFixed(0)}%
          </div>
          <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>downside if multiples compress</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BUY-READY</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#10B981', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
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
              background: '#22D3EE15', border: '1px solid #22D3EE40',
              color: '#22D3EE', borderRadius: 4, fontWeight: 800, fontFamily: 'ui-monospace, monospace',
            }}>
              {k === 'EV_EBITDA' ? 'EV/EBITDA' : k}: {n}
            </span>
          ))}
        </div>
      </div>

      {/* Top conviction */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderLeft: '3px solid #10B981', borderRadius: 6, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#10B981', letterSpacing: '0.5px', marginBottom: 4 }}>🏆 TOP CONVICTION (by annualized base-case)</div>
        <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>Highest expected CAGR across your saved valuations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {topConviction.map((e, i) => (
            <div key={e.v.id} style={{ background: '#0A1422', borderRadius: 5, padding: '8px 12px', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: '#10B981', fontWeight: 900, minWidth: 24 }}>#{i + 1}</span>
              <span style={{ fontSize: 13, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{e.v.ticker || e.v.company || '—'}</span>
              <span style={{ fontSize: 10, color: '#22D3EE', background: '#22D3EE15', padding: '2px 7px', borderRadius: 3, fontWeight: 800 }}>
                {e.v.calcKind === 'EV_EBITDA' ? 'EV/EBITDA' : e.v.calcKind}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: '#C9D4E0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {e.v.baseSummary}
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: '#10B981', fontVariantNumeric: 'tabular-nums' }}>
                {e.base!.annualizedPct >= 0 ? '+' : ''}{e.base!.annualizedPct.toFixed(0)}% CAGR
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Worst risk */}
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderLeft: '3px solid #EF4444', borderRadius: 6, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#EF4444', letterSpacing: '0.5px', marginBottom: 4 }}>⚠ WORST DOWNSIDE (by bear-case)</div>
        <div style={{ fontSize: 11, color: DIM, marginBottom: 10 }}>Maximum drawdown if multiples compress to bear scenario</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {worstRisk.map((e) => (
            <div key={e.v.id} style={{ background: '#0A1422', borderRadius: 5, padding: '8px 12px', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: TEXT, fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{e.v.ticker || e.v.company || '—'}</span>
              <span style={{ fontSize: 10, color: '#EF4444', background: '#EF444415', padding: '2px 7px', borderRadius: 3, fontWeight: 800 }}>
                {e.v.calcKind === 'EV_EBITDA' ? 'EV/EBITDA' : e.v.calcKind}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: '#C9D4E0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {e.v.notes || e.v.baseSummary}
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: '#EF4444', fontVariantNumeric: 'tabular-nums' }}>
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
              <div key={e.v.id+'-c'} style={{ color: '#22D3EE', fontFamily: 'ui-monospace, monospace' }}>{e.v.calcKind === 'EV_EBITDA' ? 'EVE' : e.v.calcKind}</div>
              <div key={e.v.id+'-s'} style={{ color: '#C9D4E0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.v.baseSummary.slice(0, 90)}</div>
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

function SavedValuationsPanel({ onLoad }: { onLoad?: (v: SavedValuation) => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('mc:valuations-updated', h);
    return () => window.removeEventListener('mc:valuations-updated', h);
  }, []);
  const saved = loadSavedValuations();
  if (saved.length === 0) {
    return (
      <div style={{ background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: '14px 16px', fontSize: 12, color: DIM, fontStyle: 'italic' }}>
        💾 No saved valuations yet. Run a calculator and click <b style={{ color: '#10B981' }}>SAVE VALUATION</b> to persist it here for later review.
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
        {saved.slice(0, 30).map((v) => (
          <div key={v.id} style={{
            background: '#0A1422', border: `1px solid ${BORDER}`, borderRadius: 5,
            padding: '8px 10px',
            display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 11, color: '#22D3EE', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 50 }}>
              {v.calcKind === 'EV_EBITDA' ? 'EV/EB' : v.calcKind}
            </span>
            <span style={{ fontSize: 12, color: TEXT, fontWeight: 700 }}>{v.ticker || v.company || '—'}</span>
            <span style={{ flex: 1, fontSize: 11, color: '#C9D4E0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {v.baseSummary}
            </span>
            {v.notes && (
              <span style={{ fontSize: 10, color: DIM, fontStyle: 'italic' }} title={v.notes}>
                📝 {v.notes.slice(0, 40)}{v.notes.length > 40 ? '…' : ''}
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
              background: '#22D3EE15', border: '1px solid #22D3EE50', color: '#22D3EE',
              borderRadius: 3, cursor: 'pointer', fontWeight: 700,
            }}>EDIT</button>
            <button onClick={() => { if (confirm(`Delete saved valuation for ${v.ticker || '—'}?`)) deleteValuation(v.id); }} style={{
              fontSize: 10, padding: '3px 8px',
              background: '#EF444415', border: '1px solid #EF444450', color: '#EF4444',
              borderRadius: 3, cursor: 'pointer', fontWeight: 700,
            }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalcResultDisplay({ result, calcKind }: { result: CalculatorResult; calcKind?: 'PS' | 'PE' | 'EV_EBITDA' }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        background: '#22D3EE12', border: '1px solid #22D3EE40', borderRadius: 6,
        padding: '12px 14px', marginBottom: 12, fontSize: 13, color: TEXT, lineHeight: 1.6,
      }}>
        <b style={{ color: '#22D3EE' }}>📊 Base case:</b> {result.baseSummary}
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
          background: '#0A1422', color: TEXT, border: `1px solid ${BORDER}`,
          padding: '7px 10px', borderRadius: 4, fontSize: 13, fontWeight: 600,
          fontFamily: 'ui-monospace, monospace',
        }}
      />
      {open && hits.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          marginTop: 4, maxHeight: 280, overflowY: 'auto',
          background: CARD, border: `1px solid #22D3EE60`, borderRadius: 4,
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
              <span style={{ fontSize: 11, color: '#22D3EE', fontFamily: 'ui-monospace, monospace', fontWeight: 800, minWidth: 80 }}>
                {h.ticker}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.company}
              </span>
              {h.sector && <span style={{ fontSize: 9, color: DIM, whiteSpace: 'nowrap' }}>{h.sector}</span>}
              {h.price && (
                <span style={{ fontSize: 10, color: '#10B981', fontFamily: 'ui-monospace, monospace', fontWeight: 700, minWidth: 50, textAlign: 'right' }}>
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
function AutoFillBtn({ ticker, market, onFill, currentPrice }: { ticker: string; market: 'india' | 'us'; onFill: (q: QuoteAutoFill) => void; currentPrice?: number }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string>('');

  const fire = async (t: string) => {
    if (!t.trim()) return;
    setLoading(true); setError(null);
    try {
      const q = await fetchQuoteAutofill(t, market);
      if (q) { onFill(q); setLastFetched(t); setError(null); }
      else setError('Quote not found — using manual values');
    } catch { setError('Fetch failed'); }
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
        background: '#10B98115', border: '1px solid #10B98150',
        color: '#10B981', borderRadius: 4, cursor: loading ? 'wait' : 'pointer', fontWeight: 800,
      }}>
        {loading ? '⏳ Fetching…' : '🔄 Auto-fill price + market cap'}
      </button>
      {currentPrice && (
        <span style={{ fontSize: 11, color: DIM, fontFamily: 'ui-monospace, monospace' }}>
          live price: <b style={{ color: '#10B981' }}>{market === 'us' ? '$' : '₹'}{currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</b>
        </span>
      )}
      {error && <span style={{ fontSize: 10, color: '#F59E0B' }}>{error}</span>}
    </div>
  );
}

function NumberInput({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
      <span style={{ color: DIM, fontWeight: 700, letterSpacing: '0.3px' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            background: '#0A1422', color: TEXT, border: `1px solid ${BORDER}`,
            padding: '7px 10px', borderRadius: 4, fontSize: 13, fontFamily: 'ui-monospace, monospace',
            width: 130, fontWeight: 600,
          }}
        />
        {suffix && <span style={{ fontSize: 11, color: DIM }}>{suffix}</span>}
      </div>
    </label>
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
      <AutoFillBtn ticker={ticker} market="india" currentPrice={currentPrice} onFill={(q) => {
        if (q.currentPrice) setCurrentPrice(q.currentPrice);
        if (q.currentMarketCapCr) setMarketCap(Math.round(q.currentMarketCapCr));
        // PATCH 0636 — set shares explicitly from live API so target-price math
        // doesn't drift when user manually overrides market cap later.
        if (q.sharesOutstandingCr) setShares(q.sharesOutstandingCr);
      }} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: DIM, alignSelf: 'center', marginRight: 4, fontWeight: 700 }}>EXAMPLES</span>
        <button onClick={() => loadExample('rubicon')} style={chipBtn('#22D3EE')}>Rubicon Research</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: DIM, fontWeight: 700, letterSpacing: '0.3px' }}>Ticker</span>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)}
            style={{ background: '#0A1422', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 10px', borderRadius: 4, fontSize: 13, fontWeight: 600 }} />
        </label>
        <NumberInput label="Forward Revenue (FY27/FY28)" value={revenue} onChange={setRevenue} suffix="₹ Cr" />
        <NumberInput label="Current Market Cap" value={marketCap} onChange={setMarketCap} suffix="₹ Cr" />
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
      <AutoFillBtn ticker={ticker} market="india" currentPrice={currentPrice} onFill={(q) => {
        if (q.currentPrice) setCurrentPrice(q.currentPrice);
        if (q.currentMarketCapCr) setMarketCap(Math.round(q.currentMarketCapCr));
        // PATCH 0636 — set shares explicitly from live API so target-price math
        // doesn't drift when user manually overrides market cap later.
        if (q.sharesOutstandingCr) setShares(q.sharesOutstandingCr);
      }} />
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
          <input value={ticker} onChange={(e) => setTicker(e.target.value)}
            style={{ background: '#0A1422', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 10px', borderRadius: 4, fontSize: 13, fontWeight: 600 }} />
        </label>
        <NumberInput label="Forward PAT (FY27)" value={pat} onChange={setPat} suffix="₹ Cr" />
        <NumberInput label="Current Market Cap" value={marketCap} onChange={setMarketCap} suffix="₹ Cr" />
        <NumberInput label="Horizon" value={horizon} onChange={setHorizon} suffix="months" />
        <NumberInput label="Bear P/E" value={bearPE} onChange={setBearPE} suffix="x" />
        <NumberInput label="Base P/E (3yr median)" value={basePE} onChange={setBasePE} suffix="x" />
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
      <AutoFillBtn ticker={ticker} market="india" currentPrice={currentPrice} onFill={(q) => {
        if (q.currentPrice) setCurrentPrice(q.currentPrice);
        if (q.currentMarketCapCr) setMarketCap(Math.round(q.currentMarketCapCr));
        // PATCH 0636 — set shares explicitly from live API so target-price math
        // doesn't drift when user manually overrides market cap later.
        if (q.sharesOutstandingCr) setShares(q.sharesOutstandingCr);
      }} />
      <div style={{ marginBottom: 14, fontSize: 11, color: DIM, fontStyle: 'italic' }}>
        EV/EBITDA best for cyclicals, industrials, leveraged businesses. Always subtract net debt to get equity value.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: DIM, fontWeight: 700, letterSpacing: '0.3px' }}>Ticker</span>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)}
            style={{ background: '#0A1422', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 10px', borderRadius: 4, fontSize: 13, fontWeight: 600 }} />
        </label>
        <NumberInput label="Forward EBITDA" value={ebitda} onChange={setEbitda} suffix="₹ Cr" />
        <NumberInput label="Net Debt" value={netDebt} onChange={setNetDebt} suffix="₹ Cr" />
        <NumberInput label="Current Market Cap" value={marketCap} onChange={setMarketCap} suffix="₹ Cr" />
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
            { id: 'PE',         label: 'P/E Target',        emoji: '📈' },
            { id: 'PS',         label: 'P/S Target',        emoji: '💰' },
            { id: 'EV_EBITDA',  label: 'EV / EBITDA',       emoji: '🏭' },
            { id: 'ANALYTICS',  label: 'Analytics',         emoji: '📊' },
          ] as const).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              fontSize: 13, padding: '10px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #22D3EE' : '2px solid transparent',
              color: tab === t.id ? '#22D3EE' : DIM,
              cursor: 'pointer',
              fontWeight: 700,
            }}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '20px 22px' }}>
          {tab === 'PS' && <PSCalculator />}
          {tab === 'PE' && <PECalculator />}
          {tab === 'EV_EBITDA' && <EvEbitdaCalculator />}
          {tab === 'ANALYTICS' && <ValuationAnalyticsPanel />}
        </div>

        {/* PATCH 0633 — Saved valuations panel */}
        <SavedValuationsPanel />

        {/* Sector → calculator map */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '16px 18px' }}>
          <h2 style={{ margin: '0 0 4px 0', fontSize: 16, fontWeight: 800, color: TEXT }}>
            📋 Sector → Calculator Lookup
          </h2>
          <div style={{ fontSize: 11, color: DIM, marginBottom: 12, lineHeight: 1.5 }}>
            Match your name&apos;s sector → use the listed calculator → benchmark against the multiple hint. Examples are drawn from names actually discussed in the portal (Multibagger, Conviction Beats, Critical Themes).
          </div>
          {/* PATCH 0636 — proper grid layout: each sector is a horizontal row
              with aligned columns (sector | calc badge | multiple range | examples).
              Sticky header row. Alternating row backgrounds for readability. */}
          <div style={{ overflow: 'auto', border: `1px solid ${BORDER}`, borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#1A2540' }}>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', borderBottom: `1px solid ${BORDER}` }}>SECTOR</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', borderBottom: `1px solid ${BORDER}`, width: 110 }}>CALCULATOR</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', borderBottom: `1px solid ${BORDER}`, width: 280 }}>MULTIPLE RANGE</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, color: DIM, letterSpacing: '0.5px', borderBottom: `1px solid ${BORDER}` }}>EXAMPLE COMPANIES</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(SECTOR_CALCULATOR_MAP).map(([sector, conf], i) => (
                  <tr key={sector} style={{ background: i % 2 === 0 ? '#0A1422' : '#0D1623' }}>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: TEXT, fontWeight: 700, borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' }}>
                      {sector}
                    </td>
                    <td style={{ padding: '12px 12px', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' }}>
                      <span style={{ fontSize: 11, color: '#22D3EE', background: '#22D3EE15', border: '1px solid #22D3EE40', padding: '3px 9px', borderRadius: 4, fontFamily: 'ui-monospace, monospace', fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {conf.calc === 'EV_EBITDA' ? 'EV / EBITDA' : conf.calc === 'PS' ? 'P / S' : 'P / E'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: 12, color: '#C9D4E0', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top', lineHeight: 1.5 }}>
                      {conf.multipleHint}
                    </td>
                    <td style={{ padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {conf.examples.map((ex) => (
                          <span key={ex} style={{
                            fontSize: 11, padding: '3px 8px',
                            background: '#1A2540', border: '1px solid #2A3A55',
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
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ fontSize: 11, color: DIM, padding: '12px 0', lineHeight: 1.6, fontStyle: 'italic' }}>
          All calculators run client-side — no data leaves your browser. Edit assumptions freely. Worked examples (Rubicon, Bajaj Consumer, TD Power, Sterlite, Aeroflex, Atlanta Electricals, DEE Dev) ship in <code style={{ background: '#1A2540', padding: '1px 4px', borderRadius: 3 }}>frontend/src/lib/valuation-calculators.ts</code> — load any to see the inputs and tweak.
        </div>
      </div>
    </div>
  );
}
