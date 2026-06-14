// ════════════════════════════════════════════════════════════════════════════
// TurnaroundStrips.tsx — PATCH 1080
// Per-company Turnaround scorecard rendered inside the Capex Tracker tab.
// Mirrors MultibaggerStrips.tsx layout (institutional dark palette, monospace
// numbers, year-by-year strip rows). Reads the SAME Fin series — no separate
// upload needed; appears alongside the Multibagger panel.
// ════════════════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react';
import { scoreTurnaround, type TurnaroundResult, type GateStatus } from '@/lib/turnaround-scoring';

type Fin = {
  years: string[];
  sales: (number | null)[];
  np: (number | null)[];
  pbt: (number | null)[];
  tax?: (number | null)[];
  oi: (number | null)[];
  dep: (number | null)[];
  intr: (number | null)[];
  div?: (number | null)[];
  eq: (number | null)[];
  res: (number | null)[];
  bor: (number | null)[];
  nb: (number | null)[];
  cwip?: (number | null)[];
  cash: (number | null)[];
  recv?: (number | null)[];
  inv?: (number | null)[];
  rm?: (number | null)[];
  chgInv?: (number | null)[];
  ocf?: (number | null)[];
  cfi?: (number | null)[];
  cff?: (number | null)[];
  shares?: (number | null)[];
  price?: (number | null)[];
  mcap?: number | null;
  capex?: (number | null)[];
};

const C = {
  bg: '#0a0e1a', card: '#0f1421', divider: '#1a2233',
  text: '#d8dee9', textDim: '#7c8ba1', textMuted: '#5a677d',
  white: '#f4f6fa',
  green: '#1d9e75', greenDim: '#0f6e56',
  amber: '#ef9f27', amberDim: '#ba7517',
  red: '#e24b4a', redDim: '#a32d2d',
  blue: '#4d8fcc', purple: '#A78BFA',
  threshold: '#3a4660',
};

const MONO: React.CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

const fmt = (v: number | null | undefined, d = 1): string => {
  if (v == null || !isFinite(v as number)) return '—';
  const n = Math.abs(v);
  if (n >= 1000) return ((v as number) / 1000).toFixed(1) + 'k';
  return (v as number).toFixed(d);
};
const fmtPct = (v: number | null | undefined, d = 1): string => v == null || !isFinite(v as number) ? '—' : (v as number).toFixed(d) + '%';

const gateColor = (st: GateStatus): string =>
  st === 'PASS' ? C.green : st === 'WARN' ? C.amber : st === 'FAIL' ? C.red : C.textMuted;

const sectionStyle: React.CSSProperties = {
  background: C.card,
  border: '1px solid ' + C.divider,
  borderRadius: 8,
  padding: '10px 12px',
};

// ─── Generic year strip ────────────────────────────────────────────────────
function StripRow({ years, values, fmt: fmtter = (v) => fmt(v, 1), color, threshold, lowIsGood }: {
  years: string[];
  values: number[];
  fmt?: (v: number) => string;
  color: (v: number, i: number, vals: number[]) => string;
  threshold?: number;
  lowIsGood?: boolean;
}) {
  const finite = values.filter((v) => isFinite(v));
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  const range = max - min || 1;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${years.length}, minmax(46px, 1fr))`, gap: 4 }}>
      {years.map((y, i) => {
        const v = values[i];
        const ok = isFinite(v);
        const h = ok ? Math.max(4, Math.round(((v - min) / range) * 36) + 4) : 4;
        const col = ok ? color(v, i, values) : C.textMuted;
        const isLast = i === years.length - 1;
        return (
          <div key={y + i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
            <div style={{ height: 44, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', position: 'relative' }}>
              {threshold != null && isFinite(threshold) && (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${Math.max(4, Math.round(((threshold - min) / range) * 36) + 4)}px`, height: 1, borderTop: `1px dashed ${C.threshold}` }} />
              )}
              <div style={{ width: '90%', height: `${h}px`, background: col, borderRadius: 2, boxShadow: isLast ? `0 0 0 1px ${C.white}33` : 'none' }} />
            </div>
            <div style={{ ...MONO, fontSize: 9, color: ok ? col : C.textMuted, textAlign: 'center', fontWeight: 700 }}>{ok ? fmtter(v) : '—'}</div>
            <div style={{ fontSize: 8, color: C.textMuted, textAlign: 'center' }}>{y.slice(-4) || ''}</div>
          </div>
        );
      })}
      {lowIsGood !== undefined && null}
    </div>
  );
}

function SectionHead({ title, sub, color }: { title: string; sub?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3, color: color || C.text, textTransform: 'uppercase' }}>{title}</div>
      {sub && <div style={{ fontSize: 9, color: C.textDim }}>{sub}</div>}
    </div>
  );
}

interface Props { fin: Fin | null | undefined; name?: string; }

const TurnaroundStrips: React.FC<Props> = ({ fin, name }) => {
  const result = useMemo<TurnaroundResult | null>(() => scoreTurnaround(fin as any, name || ''), [fin, name]);

  if (!result) {
    return (
      <div style={{ ...sectionStyle, color: C.textDim, fontSize: 11 }}>
        No turnaround signal — upload the Screener workbook with at least 5 years of P&L + balance-sheet data.
      </div>
    );
  }

  const d = result.derived;
  const years = d.years;

  // Per-metric color schemes
  const cMargin = (v: number, i: number, vals: number[]) => {
    if (!isFinite(v)) return C.textMuted;
    if (i === 0) return v >= 10 ? C.green : v >= 5 ? C.amber : C.red;
    const prev = vals[i - 1];
    if (isFinite(prev)) return v >= prev ? C.green : v >= prev - 1 ? C.amber : C.red;
    return v >= 10 ? C.green : v >= 5 ? C.amber : C.red;
  };
  const cDebt = (v: number) => (!isFinite(v) ? C.textMuted : v <= 0 ? C.green : v <= 200 ? C.amber : C.red);
  const cCashUp = (v: number, i: number, vals: number[]) => {
    if (!isFinite(v)) return C.textMuted;
    if (i === 0) return C.amber;
    return v >= vals[i - 1] ? C.green : C.amber;
  };
  const cYoY = (v: number) => (!isFinite(v) ? C.textMuted : v > 5 ? C.green : v > -5 ? C.amber : C.red);
  const cAccel = (v: number) => (!isFinite(v) ? C.textMuted : v > 0 ? C.green : v > -5 ? C.amber : C.red);
  const cQuality = (v: number) => (!isFinite(v) ? C.textMuted : v >= 0.8 ? C.green : v >= 0.5 ? C.amber : C.red);
  const cROCE = (v: number) => (!isFinite(v) ? C.textMuted : v >= 15 ? C.green : v >= 10 ? C.amber : C.red);
  const cDaysLow = (v: number, i: number, vals: number[]) => {
    if (!isFinite(v)) return C.textMuted;
    if (i === 0) return C.amber;
    return v <= vals[i - 1] ? C.green : C.red;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ─── 1. Action banner ─────────────────────────────────────────── */}
      <div style={{ ...sectionStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, background: result.thesisAlive ? C.card : C.redDim + '22', borderColor: result.thesisAlive ? C.divider : C.red + '66' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 9, color: C.textDim, letterSpacing: 0.4 }}>TURNAROUND VERDICT</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: result.actionColor, ...MONO }}>{result.action}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 9, color: C.textDim, letterSpacing: 0.4 }}>PHASE</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: result.phaseColor, ...MONO }}>{result.phaseLabel}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 9, color: C.textDim, letterSpacing: 0.4 }}>ARCHETYPE</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, ...MONO }}>{result.archetypeLabel}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 9, color: C.textDim, letterSpacing: 0.4 }}>SCORE</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: result.gradeColor, ...MONO }}>
              {result.grade} · {result.totalScore.toFixed(0)}/{result.totalMax}
              <span style={{ fontSize: 10, fontWeight: 600, color: C.textDim, marginLeft: 6 }}>({(result.pct * 100).toFixed(0)}%)</span>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.textDim, maxWidth: 280, textAlign: 'right' }}>
          {result.actionReason}
          {result.yearsSinceTrough != null && result.troughYearByMetric.opm && (
            <div style={{ fontSize: 9, marginTop: 2, color: C.textMuted }}>
              OPM trough · {result.troughYearByMetric.opm} · {result.yearsSinceTrough}y ago
            </div>
          )}
        </div>
      </div>

      {/* ─── 2. Six-section scorecard ─────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionHead title="Six-section Playbook scorecard (Master Playbook §VIII)" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6 }}>
          {result.sections.map((s) => {
            const col = gateColor(s.status);
            const isBinaryTrap = s.id === 'trapcheck';
            return (
              <div key={s.id} style={{ background: C.bg, border: '1px solid ' + C.divider, borderRadius: 6, padding: '6px 8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 10, color: C.text, fontWeight: 700 }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: col, fontWeight: 900, ...MONO }}>
                    {isBinaryTrap ? s.status : `${s.score.toFixed(0)}/${s.max}`}
                  </span>
                </div>
                {!isBinaryTrap && (
                  <div style={{ height: 3, background: C.divider, borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                    <div style={{ width: Math.round(s.pct * 100) + '%', height: '100%', background: col }} />
                  </div>
                )}
                {s.notes.slice(0, 2).map((nt, j) => (
                  <div key={j} style={{ fontSize: 9, color: C.textDim, marginTop: 3, lineHeight: 1.3 }}>{nt}</div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── 3. Survival gates ────────────────────────────────────────── */}
      <div style={{ ...sectionStyle, ...(result.gateFailCount > 0 ? { borderColor: C.red + '88', boxShadow: `inset 0 0 0 1px ${C.red}33` } : {}) }}>
        <SectionHead title="Survival gates — any FAIL kills the thesis" sub={result.gateFailCount > 0 ? `${result.gateFailCount} FAIL` : 'all clear'} color={result.gateFailCount > 0 ? C.red : C.green} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 6 }}>
          {result.gates.map((g) => {
            const col = gateColor(g.status);
            return (
              <div key={g.id} style={{ background: C.bg, border: '1px solid ' + col + '55', borderRadius: 6, padding: '6px 8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 10, color: C.text, fontWeight: 700 }}>{g.label}</span>
                  <span style={{ fontSize: 11, color: col, fontWeight: 900, ...MONO }}>{g.value == null ? 'n/a' : g.value}</span>
                </div>
                <div style={{ fontSize: 9, color: C.textDim, marginTop: 2 }}>{g.thresholdText}</div>
                <div style={{ fontSize: 9, color: col, marginTop: 2, fontWeight: 600 }}>{g.status} · {g.reason}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── 4. Margin trajectory strips ──────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionHead title="Margin trajectory" sub="OPM% · EBITDA-margin · NPM% — colors = ΔYoY" />
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>OPM %</div>
            <StripRow years={years} values={d.opmPct} fmt={(v) => fmtPct(v, 1)} color={cMargin} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>EBITDA margin %</div>
            <StripRow years={years} values={d.ebitdaMarginPct} fmt={(v) => fmtPct(v, 1)} color={cMargin} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>NPM %</div>
            <StripRow years={years} values={d.npm} fmt={(v) => fmtPct(v, 1)} color={cMargin} />
          </div>
        </div>
      </div>

      {/* ─── 5. Sales inflection (level + 2nd derivative) ─────────────── */}
      <div style={sectionStyle}>
        <SectionHead title="Sales inflection" sub="YoY level + 2nd derivative (acceleration)" />
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Sales YoY %</div>
            <StripRow years={years} values={d.salesYoYPct} fmt={(v) => fmtPct(v, 1)} color={cYoY} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Acceleration (ΔYoY pp)</div>
            <StripRow years={years} values={d.salesAccelerationPct} fmt={(v) => (isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) : '—')} color={cAccel} threshold={0} />
          </div>
        </div>
      </div>

      {/* ─── 6. Debt demolition ───────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionHead title="Debt demolition" sub="Borrowings + Cash, NetDebt/EBITDA, D/E" />
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Borrowings (₹ Cr)</div>
            <StripRow years={years} values={d.borrowings} fmt={(v) => fmt(v, 0)} color={(v, i, vals) => isFinite(v) && i > 0 ? (v <= vals[i - 1] ? C.green : C.red) : C.amber} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Cash & Bank (₹ Cr)</div>
            <StripRow years={years} values={d.cash} fmt={(v) => fmt(v, 0)} color={cCashUp} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Net Debt / EBITDA (x)</div>
            <StripRow years={years} values={d.netDebtToEbitda} fmt={(v) => fmt(v, 1) + 'x'} color={(v) => !isFinite(v) ? C.textMuted : v <= 0 ? C.green : v <= 4 ? C.green : v <= 6 ? C.amber : C.red} threshold={4} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Debt / Equity</div>
            <StripRow years={years} values={d.debtToEquity} fmt={(v) => fmt(v, 2)} color={(v) => !isFinite(v) ? C.textMuted : v < 0.5 ? C.green : v < 1.0 ? C.amber : C.red} threshold={0.5} />
          </div>
        </div>
      </div>

      {/* ─── 7. Quality of earnings ───────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionHead title="Quality of earnings" sub="CFO / PAT and CFO / EBITDA — high = real cash" />
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>CFO / PAT</div>
            <StripRow years={years} values={d.cfoOverPat} fmt={(v) => fmt(v, 2)} color={cQuality} threshold={0.8} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>CFO / EBITDA</div>
            <StripRow years={years} values={d.cfoOverEbitda} fmt={(v) => fmt(v, 2)} color={cQuality} threshold={0.8} />
          </div>
        </div>
      </div>

      {/* ─── 8. ROCE / ROE recovery ───────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionHead title="Return on capital recovery" sub="ROCE (%) + ROE (%) — threshold 15%" />
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>ROCE %</div>
            <StripRow years={years} values={d.roce} fmt={(v) => fmtPct(v, 1)} color={cROCE} threshold={15} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>ROE %</div>
            <StripRow years={years} values={d.roe} fmt={(v) => fmtPct(v, 1)} color={cROCE} threshold={15} />
          </div>
        </div>
      </div>

      {/* ─── 9. Working capital discipline ────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionHead title="Working capital discipline" sub="lower = better (green when shrinking YoY)" />
        <div style={{ display: 'grid', gap: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Receivable days</div>
            <StripRow years={years} values={d.receivableDays} fmt={(v) => fmt(v, 0) + 'd'} color={cDaysLow} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>Inventory days</div>
            <StripRow years={years} values={d.inventoryDays} fmt={(v) => fmt(v, 0) + 'd'} color={cDaysLow} />
          </div>
        </div>
      </div>

      {/* ─── 10. Red-flag radar (Top-10 killers) ──────────────────────── */}
      <div style={sectionStyle}>
        <SectionHead title="Trap check — top-10 killers (Master Playbook §VII)" sub={result.redFlagTrippedCount > 0 ? `${result.redFlagTrippedCount} tripped` : 'all clear'} color={result.redFlagTrippedCount > 0 ? C.red : C.green} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 5 }}>
          {result.redFlags.map((f) => (
            <div key={f.id} style={{ background: f.tripped ? C.red + '15' : C.bg, border: '1px solid ' + (f.tripped ? C.red + '66' : C.divider), borderRadius: 5, padding: '4px 7px' }}>
              <div style={{ fontSize: 10, color: f.tripped ? C.red : C.text, fontWeight: 700 }}>
                {f.tripped ? '⚠ ' : '✓ '}{f.label}
              </div>
              <div style={{ fontSize: 9, color: C.textDim, marginTop: 1, lineHeight: 1.25 }}>{f.reason}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── 11. Phase timeline ───────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SectionHead title="Phase timeline" sub="year-by-year, derived from sales+OPM trajectory" />
        <div style={{ display: 'flex', gap: 3 }}>
          {years.map((y, i) => {
            const sYoY = d.salesYoYPct[i];
            const dOPM = d.opmDeltaBps[i];
            let label = '—', col = C.textMuted;
            if (isFinite(sYoY) && sYoY < -10) { label = 'CLP'; col = C.red; }
            else if (isFinite(sYoY) && sYoY > 5 && isFinite(dOPM) && dOPM > 0) { label = 'INF'; col = C.green; }
            else if (isFinite(dOPM) && dOPM > 0) { label = 'STB'; col = C.amber; }
            else if (isFinite(sYoY) && sYoY > 0) { label = 'RR'; col = C.blue; }
            return (
              <div key={y + i} style={{ flex: 1, textAlign: 'center', padding: '4px 0', background: col + '22', border: '1px solid ' + col + '55', borderRadius: 3, ...MONO }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: col }}>{label}</div>
                <div style={{ fontSize: 8, color: C.textMuted, marginTop: 1 }}>{y.slice(-4)}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 9, color: C.textDim, marginTop: 4 }}>
          CLP = collapse · STB = stabilisation · INF = inflection · RR = re-rating
        </div>
      </div>
    </div>
  );
};

export default TurnaroundStrips;
