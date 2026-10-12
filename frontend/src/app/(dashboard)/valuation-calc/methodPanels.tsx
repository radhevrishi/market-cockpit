'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo } from 'react';
import { SECTOR_CALCULATOR_MAP } from '@/lib/valuation-calculators';
import { MethodCard } from './MethodCard';
import { NumberInput } from './components';
import { BORDER, TEXT, DIM, CARD, SECTOR_SCENARIOS, GUIDANCE_METHODS } from './constants';
import { PRACTICE_EXAMPLES } from './constants2';
import { exSlug } from './helpers';
import { type SectorScenario, type PracticeExample } from './types';
import { ReturnLessons } from './ReturnLessons';

export function SectorScenarioRow({ sector, scenario }: { sector: string; scenario: SectorScenario }) {
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
export function SectorLookupPanel() {
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
export function PracticeExampleCard({ ex }: { ex: PracticeExample }) {
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

export function MethodSection({
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
export function DCFCalculator() {
  const [fcf, setFcf] = useState(100);
  const [growth, setGrowth] = useState(15);
  const [terminalGrowth, setTerminalGrowth] = useState(4);
  const [discount, setDiscount] = useState(12);
  const [years, setYears] = useState(5);
  const [shares, setShares] = useState(10);
  const [mcap, setMcap] = useState(2000);

  // Pure 3-stage DCF → fair market cap for a given (growth, discount) pair.
  const dcfMcap = (g: number, d: number): number => {
    if (d <= terminalGrowth) return 0;
    let explicitPv = 0;
    let lastFcf = fcf;
    for (let t = 1; t <= years; t++) {
      lastFcf = lastFcf * (1 + g / 100);
      explicitPv += lastFcf / Math.pow(1 + d / 100, t);
    }
    const tFcf = lastFcf * (1 + terminalGrowth / 100);
    const terminalValue = tFcf / ((d - terminalGrowth) / 100);
    const terminalPv = terminalValue / Math.pow(1 + d / 100, years);
    return explicitPv + terminalPv;
  };

  const result = useMemo(() => {
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

  // Sensitivity grid: growth rows × discount cols, cells = upside % vs current mcap.
  const sens = useMemo(() => {
    const gRows = [growth - 6, growth - 3, growth, growth + 3, growth + 6];
    const dCols = [discount - 2, discount - 1, discount, discount + 1, discount + 2];
    const cells = gRows.map((g) =>
      dCols.map((d) => {
        const fm = dcfMcap(g, d);
        const ups = mcap > 0 ? (fm / mcap - 1) * 100 : 0;
        const perSh = shares > 0 ? fm / shares : 0;
        return { g, d, fm, ups, perSh, valid: d > terminalGrowth && fm > 0 };
      })
    );
    return { gRows, dCols, cells };
  }, [fcf, growth, terminalGrowth, discount, years, shares, mcap]);

  const sensColor = (ups: number): string =>
    ups >= 50 ? '#10B981' : ups >= 25 ? '#22D3EE' : ups >= 0 ? '#F59E0B'
      : ups >= -25 ? '#F87171' : '#EF4444';

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

      {/* Sensitivity grid — upside % across growth (rows) × discount rate (cols) */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: TEXT, marginBottom: 2 }}>
          🎯 Sensitivity — upside % vs current price
        </div>
        <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>
          How the DCF fair value swings as growth and discount rate move ±. Your inputs sit in the centre (outlined) cell.
          A thesis that only works in the top-right corner is fragile.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, fontVariantNumeric: 'tabular-nums', minWidth: 360 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', color: DIM, fontWeight: 700, fontSize: 9, textAlign: 'left', whiteSpace: 'nowrap' }}>
                  growth ↓ / discount →
                </th>
                {sens.dCols.map((d) => (
                  <th key={d} style={{ padding: '4px 8px', color: DIM, fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {d}%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sens.cells.map((row, ri) => (
                <tr key={ri}>
                  <td style={{ padding: '4px 8px', color: DIM, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {sens.gRows[ri]}%
                  </td>
                  {row.map((c, ci) => {
                    const isCenter = ri === 2 && ci === 2;
                    const col = c.valid ? sensColor(c.ups) : DIM;
                    return (
                      <td
                        key={ci}
                        title={c.valid ? `Fair ₹${Math.round(c.perSh).toLocaleString('en-IN')}/sh` : 'discount ≤ terminal growth'}
                        style={{
                          padding: '5px 8px',
                          textAlign: 'center',
                          fontWeight: isCenter ? 800 : 600,
                          color: col,
                          background: `${col}14`,
                          border: isCenter ? `2px solid ${col}` : `1px solid ${BORDER}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.valid ? `${c.ups >= 0 ? '+' : ''}${c.ups.toFixed(0)}%` : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </MethodSection>
  );
}
export function PEGCalculator() {
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
export function PBCalculator() {
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
export function FCFYieldCalculator() {
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
export function SumOfPartsCalculator() {
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
export function DividendDiscountCalculator() {
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
export function MoreMethodsTab() {
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
export function LearnTab() {
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

      {/* zzz966 — growth vs valuation vs return, with the Return Lab */}
      <ReturnLessons />

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
          <li><b>For ranges, base-case = midpoint.</b> Haircut the top end only on evidence — this management’s own record of meeting guidance, order cover, plant use — not by a fixed 20%.</li>
          <li><b>Conservative / floor guidance → BEAR case anchor</b>. Stretch / ambition guidance → BULL case. Don’t use one as your base.</li>
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
