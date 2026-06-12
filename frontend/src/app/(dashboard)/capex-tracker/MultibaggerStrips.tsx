// ============================================================
// MultibaggerStrips.tsx — v2 (per-row expansion)
// 4 strip visualizations rendered INSIDE the 12-component
// expanded block of the 🚀 Multibagger tab.
// Fixes vs v1:
//  - Filters empty placeholder years (sales == 0 or null)
//  - Accepts company `name` for the header
//  - Interest Coverage: 0 interest → "no debt" (green) instead of ∞
//  - CFO/PAT bars cap visually at 200% but show real number
// ============================================================

import React from 'react';

type Fin = {
  years: string[];
  sales: (number | null)[];
  np: (number | null)[];
  pbt: (number | null)[];
  tax: (number | null)[];
  oi: (number | null)[];
  dep: (number | null)[];
  intr: (number | null)[];
  div: (number | null)[];
  eq: (number | null)[];
  res: (number | null)[];
  bor: (number | null)[];
  nb: (number | null)[];
  cwip: (number | null)[];
  cash: (number | null)[];
  recv: (number | null)[];
  inv: (number | null)[];
  ocf: (number | null)[];
  cfi: (number | null)[];
  cff: (number | null)[];
  shares: (number | null)[];
};

const FLAG = {
  green: '#1d9e75',
  amber: '#ef9f27',
  red: '#e24b4a',
  deepred: '#a32d2d',
  gray: '#6b7a8f',
  empty: '#1f2a3a',
};

const n = (v: number | null | undefined): number => (v == null || !isFinite(v as number) ? 0 : (v as number));

function bandLow(v: number, greenAt: number, amberAt: number): string {
  if (v <= greenAt) return FLAG.green;
  if (v <= amberAt) return FLAG.amber;
  if (v <= amberAt + 1) return FLAG.red;
  return FLAG.deepred;
}
function bandHigh(v: number, greenAt: number, amberAt: number): string {
  if (v >= greenAt) return FLAG.green;
  if (v >= amberAt) return FLAG.amber;
  if (v >= amberAt - 1) return FLAG.red;
  return FLAG.deepred;
}

type Bar = { year: string; value: number; display: string; color: string; live?: boolean };

function StripRow({ bars, scale = 1, cap }: { bars: Bar[]; scale?: number; cap?: number }) {
  const max = Math.max(...bars.map((b) => Math.min(Math.abs(b.value), cap ?? Infinity)), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '4px 0', minHeight: 56 }}>
      {bars.map((b, i) => {
        const v = Math.min(Math.abs(b.value), cap ?? Infinity);
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 11, color: b.live ? '#fff' : '#cdd6e0', fontWeight: b.live ? 500 : 400 }}>
              {b.display}
            </span>
            <div
              style={{
                width: '60%',
                height: Math.max(4, (v / max) * 50 * scale),
                background: b.color,
                borderRadius: '2px 2px 0 0',
              }}
            />
            <span style={{ fontSize: 10, color: b.live ? '#cdd6e0' : '#6b7a8f', fontWeight: b.live ? 500 : 400 }}>
              {b.year}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Header({ title, sub, color }: { title: string; sub: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: 0.5, color }}>{title}</span>
      <span style={{ fontSize: 10, color: '#6b7a8f' }}>{sub}</span>
    </div>
  );
}
function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0', fontSize: 10, color: '#9aa6b8' }}>
      {children}
    </div>
  );
}

interface Props {
  fin: Fin;
  name?: string;
  mbScore?: number;
  mbGrade?: string;
}

const MultibaggerStrips: React.FC<Props> = ({ fin, name, mbScore, mbGrade }) => {
  // Build keep[] indices = years where sales > 0 (drop empty placeholders)
  const keep: number[] = [];
  for (let i = 0; i < fin.years.length; i++) {
    if ((fin.sales[i] ?? 0) > 0) keep.push(i);
  }
  if (keep.length === 0) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: '#6b7a8f', fontStyle: 'italic' }}>
        No revenue years available — cannot render multibagger strips.
      </div>
    );
  }

  const yrs = keep.map((i) => fin.years[i]);
  const last = yrs.length - 1;

  const pick = (arr: (number | null)[]) => keep.map((i) => n(arr[i]));
  const sales = pick(fin.sales);
  const np = pick(fin.np);
  const pbt = pick(fin.pbt);
  const intr = pick(fin.intr);
  const dep = pick(fin.dep);
  const bor = pick(fin.bor);
  const cash = pick(fin.cash);
  const recv = pick(fin.recv);
  const inv = pick(fin.inv);
  const ocf = pick(fin.ocf);
  const eq = pick(fin.eq);
  const res = pick(fin.res);

  const ebit = pbt.map((p, i) => p + intr[i]);
  const ebitda = ebit.map((e, i) => e + dep[i]);
  const capEmp = eq.map((e, i) => e + res[i] + bor[i]);
  const netDebt = bor.map((b, i) => b - cash[i]);

  // 1. QUALITY OF GROWTH — Revenue colored by OPM trajectory
  const opm = sales.map((s, i) => (s > 0 ? (ebit[i] / s) * 100 : 0));
  const qogBars: Bar[] = yrs.map((y, i) => {
    const revGrowth = i > 0 && sales[i - 1] > 0 ? ((sales[i] - sales[i - 1]) / sales[i - 1]) * 100 : 0;
    const opmDelta = i > 0 ? opm[i] - opm[i - 1] : 0;
    let color = FLAG.gray;
    if (revGrowth > 0) {
      if (opmDelta >= -0.5) color = FLAG.green;
      else if (opmDelta >= -2) color = FLAG.amber;
      else color = FLAG.red;
    }
    return { year: y, value: sales[i], display: sales[i].toFixed(0), color, live: i === last };
  });

  // 2. BALANCE SHEET STRESS
  const ndEbitda = netDebt.map((nd, i) => (ebitda[i] > 0 ? nd / ebitda[i] : 0));

  // Int Cov: when intr ≈ 0 (no debt), this is a GREEN signal — render as full green bar with "no debt"
  const intCovBars: Bar[] = ebit.map((e, i) => {
    const hasInt = intr[i] > 0.5; // treat <0.5 Cr as effectively zero
    if (!hasInt) {
      return { year: yrs[i], value: 10, display: 'n/d', color: FLAG.green, live: i === last }; // n/d = no debt
    }
    const v = e / intr[i];
    return {
      year: yrs[i],
      value: Math.min(v, 15),
      display: v.toFixed(1),
      color: bandHigh(v, 3, 2),
      live: i === last,
    };
  });

  const wcDays = sales.map((s, i) => (s > 0 ? ((recv[i] + inv[i]) / s) * 365 : 0));

  const cfoPat3yArr: (number | null)[] = yrs.map((_, i) => {
    if (i < 2) return null;
    const cfoSum = ocf[i] + ocf[i - 1] + ocf[i - 2];
    const patSum = np[i] + np[i - 1] + np[i - 2];
    return patSum !== 0 ? (cfoSum / patSum) * 100 : null;
  });

  // 3. ROCE PATH
  const roce = ebit.map((e, i) => (capEmp[i] > 0 ? (e / capEmp[i]) * 100 : 0));
  const incrWindows: { label: string; value: number }[] = [];
  for (let i = 3; i < yrs.length; i++) {
    const dE = ebit[i] - ebit[i - 3];
    const dC = capEmp[i] - capEmp[i - 3];
    incrWindows.push({ label: `${yrs[i - 3]}→${yrs[i]}`, value: dC !== 0 ? (dE / dC) * 100 : 0 });
  }
  const recent3 = roce.slice(-3);
  const recentAvg = recent3.reduce((a, b) => a + b, 0) / Math.max(1, recent3.length);
  const trend = (recent3[recent3.length - 1] ?? 0) - (recent3[0] ?? 0);
  const capGrade =
    recentAvg >= 15 && trend >= 0
      ? { g: 'A', c: FLAG.green, note: 'High and rising ROCE, sensible capex' }
      : recentAvg >= 10
      ? { g: 'B', c: FLAG.amber, note: 'Decent ROCE, neutral trend' }
      : { g: 'C', c: FLAG.deepred, note: 'ROCE falling with heavy capex — wealth-destroying flag' };

  return (
    <div
      style={{
        background: '#0b1220',
        color: '#cdd6e0',
        padding: 14,
        borderRadius: 8,
        marginTop: 10,
        marginBottom: 4,
        fontSize: 12,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#A78BFA' }}>
          🚀 QUALITY × STRESS × ROCE × MGMT{name ? ` — ${name}` : ''}
        </span>
        <span style={{ fontSize: 11, color: '#6b7a8f' }}>
          {mbGrade ? `MB grade ${mbGrade}` : ''} {mbScore != null ? `· score ${mbScore.toFixed(0)}` : ''}
        </span>
      </div>

      {/* STRIP 1 */}
      <section style={{ paddingBottom: 10, borderBottom: '0.5px solid #1f2a3a', marginBottom: 10 }}>
        <Header title="QUALITY OF GROWTH BY YEAR" sub="Rev ↑ + OPM trajectory · green/amber/red" color="#10b981" />
        <SubLabel><b style={{ color: '#cdd6e0' }}>Revenue (₹ Cr)</b> · bar color = quality flag</SubLabel>
        <StripRow bars={qogBars} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9aa6b8', padding: '1px 0' }}>
          <span>OPM%</span>
          <span>{opm.map((o, i) => `${yrs[i]} ${o.toFixed(0)}`).join(' · ')}</span>
        </div>
      </section>

      {/* STRIP 2 */}
      <section style={{ paddingBottom: 10, borderBottom: '0.5px solid #1f2a3a', marginBottom: 10 }}>
        <Header title="BALANCE SHEET STRESS BY YEAR" sub="ND/EBITDA · Int Cov · WC days · CFO/PAT 3y" color="#e24b4a" />

        <SubLabel><b style={{ color: '#cdd6e0' }}>Net Debt / EBITDA (x)</b> · green ≤2 · amber 2-3 · red &gt;3</SubLabel>
        <StripRow
          bars={ndEbitda.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(1),
            color: bandLow(v, 2, 3),
            live: i === last,
          }))}
        />

        <SubLabel><b style={{ color: '#cdd6e0' }}>Interest Coverage (x)</b> · green ≥3 · amber 2-3 · red &lt;2 · n/d = no debt</SubLabel>
        <StripRow bars={intCovBars} />

        <SubLabel><b style={{ color: '#cdd6e0' }}>Working Capital days</b> · receivables + inventory (CCC proxy)</SubLabel>
        <StripRow
          bars={wcDays.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: bandLow(v, 120, 180),
            live: i === last,
          }))}
          scale={0.5}
        />

        <SubLabel><b style={{ color: '#cdd6e0' }}>CFO / PAT % (3y rolling)</b> · green ≥70 · amber 50-70 · red &lt;50</SubLabel>
        <StripRow
          cap={200}
          bars={cfoPat3yArr.map((v, i) => ({
            year: yrs[i],
            value: v ?? 0,
            display: v === null ? '—' : v.toFixed(0),
            color: v === null ? FLAG.empty : bandHigh(v, 70, 50),
            live: i === last,
          }))}
        />
      </section>

      {/* STRIP 3 */}
      <section style={{ paddingBottom: 10, borderBottom: '0.5px solid #1f2a3a', marginBottom: 10 }}>
        <Header title="ROCE PATH & REINVESTMENT SKILL" sub="3-5yr ROCE + incremental ROCE per cycle · A/B/C" color="#A78BFA" />
        <SubLabel><b style={{ color: '#cdd6e0' }}>ROCE % by year</b> · green ≥15 · amber 10-15 · red &lt;10</SubLabel>
        <StripRow
          bars={roce.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: bandHigh(v, 15, 10),
            live: i === last,
          }))}
        />

        <SubLabel><b style={{ color: '#cdd6e0' }}>Incremental ROCE per cycle</b> · ΔEBIT / ΔCapEmp (3y windows)</SubLabel>
        <StripRow
          cap={100}
          bars={incrWindows.map((w, i) => ({
            year: w.label,
            value: w.value,
            display: `${w.value.toFixed(1)}%`,
            color: bandHigh(w.value, 15, 10),
            live: i === incrWindows.length - 1,
          }))}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 6 }}>
          <span style={{ color: capGrade.c }}>● Capital Allocation Grade: <b>{capGrade.g}</b></span>
          <span style={{ color: '#9aa6b8' }}>{capGrade.note}</span>
        </div>
      </section>

      {/* STRIP 4 */}
      <section>
        <Header title="MANAGEMENT CREDIBILITY" sub="Guidance hit-rate · Pledge/holding · Disclosure" color="#d4537e" />
        <div style={{ padding: '8px 0', fontSize: 11, color: '#6b7a8f', fontStyle: 'italic' }}>
          Auto-populates from concallClassifierV2 (beat/meet/miss) + AR shareholding scrape. Stub until wired.
        </div>
      </section>
    </div>
  );
};

export default MultibaggerStrips;
