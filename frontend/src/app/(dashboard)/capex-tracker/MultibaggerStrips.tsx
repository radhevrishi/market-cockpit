// ============================================================
// MultibaggerStrips.tsx — 4 strip visualizations for the
// 🚀 Multibagger tab in capex-tracker page.tsx
// Consumes the project's Fin type (parseFin output).
//
// Insertion: import at top of page.tsx, render inside
// the multibagger tab body (right after the opening fragment,
// before the existing companies table).
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

const FLAG: Record<string, string> = {
  green: '#1d9e75',
  amber: '#ef9f27',
  red: '#e24b4a',
  deepred: '#a32d2d',
  gray: '#6b7a8f',
  empty: '#1f2a3a',
};

const n = (v: number | null | undefined): number => (v == null || !isFinite(v as number) ? 0 : (v as number));

function bandLow(v: number, greenAt: number, amberAt: number): string {
  // For metrics where LOWER is better (ND/EBITDA, WC days)
  if (v <= greenAt) return FLAG.green;
  if (v <= amberAt) return FLAG.amber;
  if (v <= amberAt + 1) return FLAG.red;
  return FLAG.deepred;
}

function bandHigh(v: number, greenAt: number, amberAt: number): string {
  // For metrics where HIGHER is better (Int cov, CFO/PAT, ROCE)
  if (v >= greenAt) return FLAG.green;
  if (v >= amberAt) return FLAG.amber;
  if (v >= amberAt - 1) return FLAG.red;
  return FLAG.deepred;
}

type Bar = { year: string; value: number; display: string; color: string; live?: boolean };

function StripRow({ bars, scale = 1 }: { bars: Bar[]; scale?: number }) {
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '4px 0', minHeight: 56 }}>
      {bars.map((b, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontSize: 11, color: b.live ? '#fff' : '#cdd6e0', fontWeight: b.live ? 500 : 400 }}>
            {b.display}
          </span>
          <div
            style={{
              width: '60%',
              height: Math.max(4, (Math.abs(b.value) / max) * 50 * scale),
              background: b.color,
              borderRadius: '2px 2px 0 0',
            }}
          />
          <span style={{ fontSize: 10, color: b.live ? '#cdd6e0' : '#6b7a8f', fontWeight: b.live ? 500 : 400 }}>
            {b.year}
          </span>
        </div>
      ))}
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
  const yrs = fin.years;
  const last = yrs.length - 1;

  // Derive series
  const sales = fin.sales.map(n);
  const np = fin.np.map(n);
  const pbt = fin.pbt.map(n);
  const intr = fin.intr.map(n);
  const dep = fin.dep.map(n);
  const bor = fin.bor.map(n);
  const cash = fin.cash.map(n);
  const recv = fin.recv.map(n);
  const inv = fin.inv.map(n);
  const ocf = fin.ocf.map(n);
  const eq = fin.eq.map(n);
  const res = fin.res.map(n);

  const ebit = pbt.map((p, i) => p + intr[i]);
  const ebitda = ebit.map((e, i) => e + dep[i]);
  const capEmp = eq.map((e, i) => e + res[i] + bor[i]);
  const netDebt = bor.map((b, i) => b - cash[i]);

  // 1. QUALITY OF GROWTH — Revenue colored by OPM trajectory
  // (GM not available without raw-material breakdown; using OPM only)
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
    return {
      year: y,
      value: sales[i],
      display: sales[i].toFixed(0),
      color,
      live: i === last,
    };
  });

  // 2. BALANCE SHEET STRESS
  const ndEbitda = netDebt.map((nd, i) => (ebitda[i] > 0 ? nd / ebitda[i] : 0));
  const intCov = ebit.map((e, i) => (intr[i] > 0 ? e / intr[i] : 99));
  const wcDays = sales.map((s, i) => (s > 0 ? ((recv[i] + inv[i]) / s) * 365 : 0));
  const cfoPat3y: (number | null)[] = yrs.map((_, i) => {
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
        padding: 16,
        borderRadius: 10,
        marginBottom: 12,
        fontSize: 12,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#A78BFA' }}>
          🚀 QUALITY × STRESS × ROCE × MGMT — {name ?? 'top company'}
        </span>
        <span style={{ fontSize: 11, color: '#6b7a8f' }}>
          {mbGrade ? `MB grade ${mbGrade}` : ''} {mbScore != null ? `· score ${mbScore.toFixed(0)}` : ''}
        </span>
      </div>

      {/* STRIP 1: QUALITY OF GROWTH */}
      <section style={{ paddingBottom: 10, borderBottom: '0.5px solid #1f2a3a', marginBottom: 10 }}>
        <Header
          title="QUALITY OF GROWTH BY YEAR"
          sub="Rev ↑ + OPM trajectory · green=clean, amber=mix, red=margin compression"
          color="#10b981"
        />
        <SubLabel>
          <b style={{ color: '#cdd6e0' }}>Revenue (₹ Cr)</b> · bar color = quality flag
        </SubLabel>
        <StripRow bars={qogBars} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9aa6b8', padding: '1px 0' }}>
          <span>OPM%</span>
          <span>{opm.map((o, i) => `${yrs[i]} ${o.toFixed(0)}`).join(' · ')}</span>
        </div>
      </section>

      {/* STRIP 2: BALANCE SHEET STRESS */}
      <section style={{ paddingBottom: 10, borderBottom: '0.5px solid #1f2a3a', marginBottom: 10 }}>
        <Header
          title="BALANCE SHEET STRESS BY YEAR"
          sub="ND/EBITDA · Int Cov · WC days · CFO/PAT 3y · hard guardrails"
          color="#e24b4a"
        />

        <SubLabel>
          <b style={{ color: '#cdd6e0' }}>Net Debt / EBITDA (x)</b> · green ≤2 · amber 2-3 · red &gt;3
        </SubLabel>
        <StripRow
          bars={ndEbitda.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(1),
            color: bandLow(v, 2, 3),
            live: i === last,
          }))}
        />

        <SubLabel>
          <b style={{ color: '#cdd6e0' }}>Interest Coverage (x)</b> · green ≥3 · amber 2-3 · red &lt;2
        </SubLabel>
        <StripRow
          bars={intCov.map((v, i) => ({
            year: yrs[i],
            value: Math.min(v, 20),
            display: v >= 20 ? '∞' : v.toFixed(1),
            color: bandHigh(v, 3, 2),
            live: i === last,
          }))}
        />

        <SubLabel>
          <b style={{ color: '#cdd6e0' }}>Working Capital days</b> · receivables + inventory (CCC proxy)
        </SubLabel>
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

        <SubLabel>
          <b style={{ color: '#cdd6e0' }}>CFO / PAT % (3y rolling)</b> · green ≥70 · amber 50-70 · red &lt;50
        </SubLabel>
        <StripRow
          bars={cfoPat3y.map((v, i) => ({
            year: yrs[i],
            value: v ?? 0,
            display: v === null ? '—' : v.toFixed(0),
            color: v === null ? FLAG.empty : bandHigh(v, 70, 50),
            live: i === last,
          }))}
        />
      </section>

      {/* STRIP 3: ROCE PATH */}
      <section style={{ paddingBottom: 10, borderBottom: '0.5px solid #1f2a3a', marginBottom: 10 }}>
        <Header
          title="ROCE PATH & REINVESTMENT SKILL"
          sub="3-5yr ROCE + incremental ROCE per capex cycle · A/B/C grade"
          color="#A78BFA"
        />
        <SubLabel>
          <b style={{ color: '#cdd6e0' }}>ROCE % by year</b> · green ≥15 · amber 10-15 · red &lt;10 (wealth-destroying, v5.4.8)
        </SubLabel>
        <StripRow
          bars={roce.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: bandHigh(v, 15, 10),
            live: i === last,
          }))}
        />

        <SubLabel>
          <b style={{ color: '#cdd6e0' }}>Incremental ROCE per cycle</b> · ΔEBIT / ΔCapEmp (3y windows)
        </SubLabel>
        <StripRow
          bars={incrWindows.map((w, i) => ({
            year: w.label,
            value: w.value,
            display: `${w.value.toFixed(1)}%`,
            color: bandHigh(w.value, 15, 10),
            live: i === incrWindows.length - 1,
          }))}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 6 }}>
          <span style={{ color: capGrade.c }}>
            ● Capital Allocation Grade: <b>{capGrade.g}</b>
          </span>
          <span style={{ color: '#9aa6b8' }}>{capGrade.note}</span>
        </div>
      </section>

      {/* STRIP 4: MANAGEMENT (placeholder until concall + AR wiring) */}
      <section>
        <Header
          title="MANAGEMENT CREDIBILITY"
          sub="Guidance hit-rate · Promoter pledge/holding · Disclosure quality"
          color="#d4537e"
        />
        <div style={{ padding: '10px 0', fontSize: 11, color: '#6b7a8f', fontStyle: 'italic' }}>
          Auto-populates from concallClassifierV2 (beat/meet/miss regex) + AR shareholding-pattern scrape.
          Stub until wired — promoter holding, pledge %, guidance history will surface here.
        </div>
      </section>
    </div>
  );
};

export default MultibaggerStrips;
