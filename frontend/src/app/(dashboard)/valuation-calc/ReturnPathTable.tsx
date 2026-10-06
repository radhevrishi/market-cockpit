'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo } from 'react';
import { NumberInput } from './components';
import { DIM, TEXT, CARD, BORDER } from './constants';
import { chipBtn } from './helpers';

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
export function ReturnPathTable() {
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
