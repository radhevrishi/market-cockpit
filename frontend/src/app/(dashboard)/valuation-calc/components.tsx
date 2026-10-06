'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { type CalculatorResult, saveValuation, type TickerHit, loadTickerUniverse, searchTickerUniverse, type QuoteAutoFill, fetchQuoteAutofill, calculatePS, type SavedValuation, WORKED_EXAMPLES, calculatePE, calculateEvEbitda } from '@/lib/valuation-calculators';
import { TEXT, BORDER, CARD, DIM } from './constants';
import { chipBtn } from './helpers';

// PATCH 0633 — save-valuation button shown above result cards
export function SaveValuationBar({ calcKind, result, onLoaded }: {
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
export function CalcResultDisplay({ result, calcKind }: { result: CalculatorResult; calcKind?: 'PS' | 'PE' | 'EV_EBITDA' }) {
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
export function TickerCombo({ value, onChange, onSelect, market = 'india' }: {
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
export function AutoFillBtn({ ticker, market, onFill, currentPrice, onNotInUniverse }: { ticker: string; market: 'india' | 'us'; onFill: (q: QuoteAutoFill) => void; currentPrice?: number; onNotInUniverse?: (state: boolean) => void }) {
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
export function NumberInput({ label, value, onChange, suffix, inputRef, highlight, helper, ticker }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; inputRef?: React.RefObject<HTMLInputElement | null>; highlight?: boolean; helper?: string; ticker?: string }) {
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
export function PLCell({ label, value, onChange, suffix, readOnly, accent }: { label: string; value: number; onChange?: (v: number) => void; suffix?: string; readOnly?: boolean; accent?: string }) {
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
export function PSCalculator() {
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
export function PECalculator() {
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
export function EvEbitdaCalculator() {
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
