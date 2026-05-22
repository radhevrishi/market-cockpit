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

type CalcKind = 'PS' | 'PE' | 'EV_EBITDA' | 'ANALYTICS' | 'LEARN';

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
  const baseUpside = result.cases.find(c => c.label === 'BASE')?.upsidePct ?? 0;
  const showSanity = Math.abs(baseUpside) >= 300;
  return (
    <div style={{ marginTop: 18 }}>
      {showSanity && (
        <div style={{
          background: '#F59E0B15', border: '1px solid #F59E0B60', borderRadius: 6,
          padding: '10px 14px', marginBottom: 10, fontSize: 12, color: TEXT, lineHeight: 1.55,
        }}>
          ⚠ <b style={{ color: '#F59E0B' }}>Sanity check:</b> base-case upside is {baseUpside.toFixed(0)}% — that&apos;s unusual.
          Common causes: (1) current market cap not yet auto-filled — click 🔄 above to pull live data;
          (2) forward revenue / PAT input is much larger than current scale — verify the FY27/FY28 guidance is realistic;
          (3) multiple band may be too generous for the sector. Adjust inputs or open <a href="/playbook" style={{ color: '#22D3EE' }}>Playbook</a> for sector-appropriate ranges.
        </div>
      )}
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
      // PATCH 0645 — Clearer message: distinguish 'not in universe' from 'fetch error'.
      else setError(`'${t.toUpperCase()}' not in live universe — enter market cap manually below`);
    } catch { setError('Live quote fetch failed — enter market cap manually below'); }
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
        <span style={{ fontSize: 11, color: '#22D3EE', fontWeight: 800, minWidth: 40, fontFamily: 'ui-monospace, monospace' }}>#{String(idx + 1).padStart(2, '0')}</span>
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
                <div key={i} style={{ fontSize: 12, padding: '6px 10px', background: '#1A2540', borderLeft: '3px solid #22D3EE', borderRadius: 3 }}>
                  <span style={{ fontWeight: 800, color: '#22D3EE', marginRight: 8 }}>{e.company}:</span>
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
            <div style={{ fontSize: 11, fontWeight: 800, color: '#F59E0B', letterSpacing: '0.5px', marginBottom: 6 }}>WORKED EXAMPLE — {m.worked.company.toUpperCase()}</div>
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
                      <td style={{ padding: '6px 0', textAlign: 'right', color: '#22D3EE', fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>{s.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 12, padding: '10px 12px', background: '#10B98115', border: '1px solid #10B98140', borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: '#10B981', fontWeight: 800, marginBottom: 3 }}>FAIR VALUE → {m.worked.fairValue}</div>
                <div style={{ fontSize: 12, color: TEXT }}>{m.worked.upside}</div>
              </div>
            </div>
          </div>

          {/* Tips */}
          {m.tips && m.tips.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#A78BFA', letterSpacing: '0.5px', marginBottom: 6 }}>TIPS</div>
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
        <div style={{ fontSize: 12, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.5px', marginBottom: 10 }}>
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

      {/* Footer — meta-lessons */}
      <div style={{ background: '#1A1F33', border: '1px solid #F59E0B40', borderRadius: 8, padding: '16px 18px', marginTop: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B', marginBottom: 8 }}>⚖️ INSTITUTIONAL LESSONS</div>
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
            { id: 'LEARN',      label: 'Learn',             emoji: '📚' },
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
          {tab === 'LEARN' && <LearnTab />}
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
