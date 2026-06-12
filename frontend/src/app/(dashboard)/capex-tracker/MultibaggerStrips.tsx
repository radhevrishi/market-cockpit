// ============================================================
// MultibaggerStrips.tsx — v3
// One-view per-company panel inside the 🚀 Multibagger tab:
//   1. Capex by year (ΔNB + ΔCWIP + Dep)
//   2. Net Block by year
//   3. CWIP by year
//   4. Quality of Growth (Revenue + OPM trajectory)
//   5. Balance Sheet Stress (ND/EBITDA · IntCov · WC days · CFO/PAT)
//   6. ROCE Path (ROCE + Incremental ROCE + Capital allocation grade)
//   7. Management Credibility (placeholder)
// v3 changes: shrink bars (50→32 px max), tighter spacing, add 3 capex strips
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
  capex: '#f08e3a',
  nb: '#1d9e75',
  cwip: '#ef9f27',
};

const BAR_MAX = 32; // shrunk from 50 — more compact

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
function fmtCr(v: number): string {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(0);
}

type Bar = { year: string; value: number; display: string; color: string; live?: boolean };

function StripRow({ bars, cap }: { bars: Bar[]; cap?: number }) {
  const max = Math.max(...bars.map((b) => Math.min(Math.abs(b.value), cap ?? Infinity)), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: '2px 0', minHeight: 40 }}>
      {bars.map((b, i) => {
        const v = Math.min(Math.abs(b.value), cap ?? Infinity);
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <span style={{ fontSize: 10, color: b.live ? '#fff' : '#cdd6e0', fontWeight: b.live ? 500 : 400 }}>
              {b.display}
            </span>
            <div
              style={{
                width: '70%',
                height: Math.max(3, (v / max) * BAR_MAX),
                background: b.color,
                borderRadius: '2px 2px 0 0',
              }}
            />
            <span style={{ fontSize: 9, color: b.live ? '#cdd6e0' : '#6b7a8f', fontWeight: b.live ? 500 : 400 }}>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0.5, color }}>{title}</span>
      <span style={{ fontSize: 9, color: '#6b7a8f' }}>{sub}</span>
    </div>
  );
}
function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, color: '#9aa6b8', marginTop: 1 }}>
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
  // Keep only years where sales > 0 (skip empty placeholders)
  const keep: number[] = [];
  for (let i = 0; i < fin.years.length; i++) {
    if ((fin.sales[i] ?? 0) > 0) keep.push(i);
  }
  if (keep.length === 0) {
    return (
      <div style={{ padding: 10, fontSize: 11, color: '#6b7a8f', fontStyle: 'italic' }}>
        No revenue years available.
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
  const nb = pick(fin.nb);
  const cwip = pick(fin.cwip);

  // CAPEX = ΔNB + ΔCWIP + Dep (per existing engine identity)
  const capex = yrs.map((_, i) => {
    if (i === 0) return 0;
    return (nb[i] - nb[i - 1]) + (cwip[i] - cwip[i - 1]) + dep[i];
  });

  const ebit = pbt.map((p, i) => p + intr[i]);
  const ebitda = ebit.map((e, i) => e + dep[i]);
  const capEmp = eq.map((e, i) => e + res[i] + bor[i]);
  const netDebt = bor.map((b, i) => b - cash[i]);

  // Quality of Growth — revenue, EBITDA margin (gross proxy), OPM (EBIT margin)
  const ebitdaMargin = sales.map((s, i) => (s > 0 ? (ebitda[i] / s) * 100 : 0));
  const opm = sales.map((s, i) => (s > 0 ? (ebit[i] / s) * 100 : 0));
  const qogBars: Bar[] = yrs.map((y, i) => {
    const revG = i > 0 && sales[i - 1] > 0 ? ((sales[i] - sales[i - 1]) / sales[i - 1]) * 100 : 0;
    const omd = i > 0 ? opm[i] - opm[i - 1] : 0;
    let color = FLAG.gray;
    if (revG > 0) {
      if (omd >= -0.5) color = FLAG.green;
      else if (omd >= -2) color = FLAG.amber;
      else color = FLAG.red;
    }
    return { year: y, value: sales[i], display: fmtCr(sales[i]), color, live: i === last };
  });
  // Margin delta thresholds: green if stable/up, amber if -2pp, red if more
  const marginColor = (i: number, series: number[]): string => {
    if (i === 0) return FLAG.gray;
    const d = series[i] - series[i - 1];
    if (d >= -0.5) return FLAG.green;
    if (d >= -2) return FLAG.amber;
    return FLAG.red;
  };

  // Balance Sheet Stress
  const ndEbitda = netDebt.map((nd, i) => (ebitda[i] > 0 ? nd / ebitda[i] : 0));
  const intCovBars: Bar[] = ebit.map((e, i) => {
    const hasInt = intr[i] > 0.5;
    if (!hasInt) return { year: yrs[i], value: 10, display: 'n/d', color: FLAG.green, live: i === last };
    const v = e / intr[i];
    return { year: yrs[i], value: Math.min(v, 15), display: v.toFixed(1), color: bandHigh(v, 3, 2), live: i === last };
  });
  const wcDays = sales.map((s, i) => (s > 0 ? ((recv[i] + inv[i]) / s) * 365 : 0));
  const cfoPat3yArr: (number | null)[] = yrs.map((_, i) => {
    if (i < 2) return null;
    const cfoSum = ocf[i] + ocf[i - 1] + ocf[i - 2];
    const patSum = np[i] + np[i - 1] + np[i - 2];
    return patSum !== 0 ? (cfoSum / patSum) * 100 : null;
  });

  // ROCE Path
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

  const section: React.CSSProperties = {
    paddingBottom: 6,
    borderBottom: '0.5px solid #1f2a3a',
    marginBottom: 6,
  };

  return (
    <div
      style={{
        background: '#0b1220',
        color: '#cdd6e0',
        padding: 10,
        borderRadius: 8,
        marginTop: 8,
        marginBottom: 4,
        fontSize: 11,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#A78BFA' }}>
          🚀 ONE-VIEW{name ? ` — ${name}` : ''}
        </span>
        <span style={{ fontSize: 10, color: '#6b7a8f' }}>
          {mbGrade ? `MB ${mbGrade}` : ''}{mbScore != null ? ` · ${mbScore.toFixed(0)}` : ''}
        </span>
      </div>

      {/* 1. CAPEX BY YEAR */}
      <section style={section}>
        <Header title="CAPEX BY YEAR" sub="Cr · ΔNB + ΔCWIP + Dep" color={FLAG.capex} />
        <StripRow
          bars={capex.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: fmtCr(v),
            color: FLAG.capex,
            live: i === last,
          }))}
        />
      </section>

      {/* 2. FIXED ASSETS (NET BLOCK) BY YEAR */}
      <section style={section}>
        <Header title="FIXED ASSETS (NET BLOCK) BY YEAR" sub="Cr · gross blocks commissioned" color={FLAG.nb} />
        <StripRow
          bars={nb.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: fmtCr(v),
            color: FLAG.nb,
            live: i === last,
          }))}
        />
      </section>

      {/* 3. CWIP BY YEAR */}
      <section style={section}>
        <Header title="CWIP BY YEAR" sub="Cr · projects under construction (build → drain = commissioning)" color={FLAG.cwip} />
        <StripRow
          bars={cwip.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: fmtCr(v),
            color: FLAG.cwip,
            live: i === last,
          }))}
        />
      </section>

      {/* 4. QUALITY OF GROWTH — revenue + EBITDA margin + OPM as three stacked bar strips */}
      <section style={section}>
        <Header title="QUALITY OF GROWTH BY YEAR" sub="Revenue + EBITDA margin (GM proxy) + OPM trajectory" color="#10b981" />

        <SubLabel><b style={{ color: '#cdd6e0' }}>Revenue (₹ Cr)</b> · bar color = OPM-delta flag</SubLabel>
        <StripRow bars={qogBars} />

        <SubLabel><b style={{ color: '#cdd6e0' }}>EBITDA margin % (GM proxy)</b> · stable/up = green, falling = red</SubLabel>
        <StripRow
          bars={ebitdaMargin.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: marginColor(i, ebitdaMargin),
            live: i === last,
          }))}
        />

        <SubLabel><b style={{ color: '#cdd6e0' }}>OPM % (EBIT / Sales)</b> · operating margin trajectory</SubLabel>
        <StripRow
          bars={opm.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: marginColor(i, opm),
            live: i === last,
          }))}
        />
      </section>

      {/* 5. BALANCE SHEET STRESS */}
      <section style={section}>
        <Header title="BALANCE SHEET STRESS BY YEAR" sub="ND/EBITDA · Int Cov · WC days · CFO/PAT 3y" color={FLAG.red} />

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

        <SubLabel><b style={{ color: '#cdd6e0' }}>Interest Coverage (x)</b> · green ≥3 · n/d = no debt</SubLabel>
        <StripRow bars={intCovBars} />

        <SubLabel><b style={{ color: '#cdd6e0' }}>WC days</b> · receivables + inventory</SubLabel>
        <StripRow
          bars={wcDays.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: bandLow(v, 120, 180),
            live: i === last,
          }))}
        />

        <SubLabel><b style={{ color: '#cdd6e0' }}>CFO / PAT % (3y rolling)</b> · green ≥70 · red &lt;50</SubLabel>
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

      {/* 6. ROCE PATH */}
      <section style={section}>
        <Header title="ROCE PATH & REINVESTMENT SKILL" sub="3-5y ROCE + incremental ROCE per cycle" color="#A78BFA" />
        <SubLabel><b style={{ color: '#cdd6e0' }}>ROCE %</b> · green ≥15 · red &lt;10</SubLabel>
        <StripRow
          bars={roce.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: bandHigh(v, 15, 10),
            live: i === last,
          }))}
        />

        <SubLabel><b style={{ color: '#cdd6e0' }}>Incremental ROCE per 3y window</b> · ΔEBIT / ΔCapEmp</SubLabel>
        <StripRow
          cap={100}
          bars={incrWindows.map((w, i) => ({
            year: w.label,
            value: w.value,
            display: `${w.value.toFixed(0)}%`,
            color: bandHigh(w.value, 15, 10),
            live: i === incrWindows.length - 1,
          }))}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 4 }}>
          <span style={{ color: capGrade.c }}>● Capital Allocation: <b>{capGrade.g}</b></span>
          <span style={{ color: '#9aa6b8' }}>{capGrade.note}</span>
        </div>
      </section>

      {/* 7. MGMT */}
      <section>
        <Header title="MANAGEMENT CREDIBILITY" sub="Guidance · Pledge/holding · Disclosure" color="#d4537e" />
        <div style={{ padding: '4px 0', fontSize: 10, color: '#6b7a8f', fontStyle: 'italic' }}>
          Auto-populates from concallClassifierV2 (beat/meet/miss) + AR shareholding scrape. Stub until wired.
        </div>
      </section>
    </div>
  );
};

export default MultibaggerStrips;
