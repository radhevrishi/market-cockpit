'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo } from 'react';
import { ReturnPathTable } from './ReturnPathTable';
import { AutoFillBtn, NumberInput } from './components';
import { DIM, BORDER, TEXT, CARD } from './constants';
import { solveImpliedGrowth, chipBtn } from './helpers';

export function ReverseDcfCalculator() {
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
