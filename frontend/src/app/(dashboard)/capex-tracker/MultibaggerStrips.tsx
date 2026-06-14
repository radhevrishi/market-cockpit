// ============================================================
// MultibaggerStrips.tsx — v4 (Institutional Format)
// One-view per-company panel rendered inside the 🚀 Multibagger tab.
// v4 fixes:
//   - TRUE OPM (= OP / Sales where OP = PBT + Interest + Depreciation - OtherIncome)
//     matches Screener.in exactly
//   - TRUE Gross Margin (= (Sales - RM - ChgInv) / Sales) when chgInv extracted
//     falls back to (Sales - RM) / Sales if chgInv missing
//   - Cleaner institutional format: monospace numbers, threshold lines,
//     section dividers, tighter type scale
// ============================================================

import React, { useMemo } from 'react';
// PATCH 1079 — HANDOFF §6 wire-up: promoter-trajectory + asset-rich detail.
import { PromoterStrip } from '@/components/promoter-trajectory';
import { AssetRichDetailCard, type AssetRichStock } from '@/components/asset-rich-filter';

// ── Concall data lookup (reads from localStorage; no parser dependency) ──
// The capex-tracker stores transcripts at this key as
// Record<companyName, ConcallEntry[]> where ConcallEntry.extract has
// utilization / orderBook / capexGuidance / timeline / growthNote / marginNote / demandNote
const CONCALL_STORAGE_KEY = 'mc:capex-tracker:concalls:v1';

// Tiny tone heuristic — counts positive vs cautious phrasing in raw text
const POSITIVE_WORDS = [
  'strong', 'robust', 'healthy', 'accelerating', 'momentum', 'traction',
  'expanding', 'growth', 'optimistic', 'confident', 'on track', 'target',
  'beat', 'exceeded', 'record', 'strategic', 'tailwind',
];
const CAUTIOUS_WORDS = [
  'challenging', 'headwind', 'slowdown', 'uncertain', 'delay', 'declined',
  'weak', 'pressure', 'volatile', 'soft', 'cautious', 'watchful',
  'monitor', 'subdued', 'muted', 'miss', 'missed',
];
function tonePct(text: string): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  let pos = 0, caut = 0;
  for (const w of POSITIVE_WORDS) {
    const re = new RegExp('\\b' + w + '\\b', 'g');
    pos += (t.match(re) || []).length;
  }
  for (const w of CAUTIOUS_WORDS) {
    const re = new RegExp('\\b' + w + '\\b', 'g');
    caut += (t.match(re) || []).length;
  }
  const total = pos + caut;
  if (total === 0) return null;
  return (pos / total) * 100;
}

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
  rm?: (number | null)[];
  chgInv?: (number | null)[];
  ocf: (number | null)[];
  cfi: (number | null)[];
  cff: (number | null)[];
  shares: (number | null)[];
};

// Institutional palette — Bloomberg/FactSet-style
const C = {
  bg: '#0a0e1a',
  card: '#0f1421',
  divider: '#1a2233',
  text: '#d8dee9',
  textDim: '#7c8ba1',
  textMuted: '#5a677d',
  white: '#f4f6fa',
  green: '#1d9e75',
  greenDim: '#0f6e56',
  amber: '#ef9f27',
  amberDim: '#ba7517',
  red: '#e24b4a',
  redDim: '#a32d2d',
  blue: '#4d8fcc',
  purple: '#A78BFA',
  capex: '#f08e3a',
  nb: '#1d9e75',
  cwip: '#ef9f27',
  dep: '#4d8fcc',
  threshold: '#3a4660',
};

const BAR_MAX = 30;
const MONO: React.CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

const n = (v: number | null | undefined): number => (v == null || !isFinite(v as number) ? 0 : (v as number));
function bandLow(v: number, greenAt: number, amberAt: number): string {
  if (v <= greenAt) return C.green;
  if (v <= amberAt) return C.amber;
  if (v <= amberAt + 1) return C.red;
  return C.redDim;
}
function bandHigh(v: number, greenAt: number, amberAt: number): string {
  if (v >= greenAt) return C.green;
  if (v >= amberAt) return C.amber;
  if (v >= amberAt - 1) return C.red;
  return C.redDim;
}
function fmtCr(v: number): string {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  return v.toFixed(0);
}

type Bar = { year: string; value: number; display: string; color: string; live?: boolean };

function StripRow({ bars, cap }: { bars: Bar[]; cap?: number }) {
  const max = Math.max(...bars.map((b) => Math.min(Math.abs(b.value), cap ?? Infinity)), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: '2px 0', minHeight: 44 }}>
      {bars.map((b, i) => {
        const v = Math.min(Math.abs(b.value), cap ?? Infinity);
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <span style={{ ...MONO, fontSize: 10, color: b.live ? C.white : C.text, fontWeight: b.live ? 600 : 400 }}>
              {b.display}
            </span>
            <div
              style={{
                width: '70%',
                height: Math.max(3, (v / max) * BAR_MAX),
                background: b.color,
                borderRadius: '1px 1px 0 0',
              }}
            />
            <span style={{ ...MONO, fontSize: 9, color: b.live ? C.text : C.textMuted, fontWeight: b.live ? 500 : 400 }}>
              {b.year}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SectionHead({
  title,
  color,
  metric,
  sub,
}: {
  title: string;
  color: string;
  metric?: string;
  sub?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2, marginTop: 2 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 1.2,
          color,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </span>
      <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: 0.3 }}>
        {metric}
        {metric && sub ? ' · ' : ''}
        {sub}
      </span>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, color: C.textDim, marginTop: 2, letterSpacing: 0.3 }}>
      {children}
    </div>
  );
}

interface Props {
  fin: Fin;
  name?: string;
  mbScore?: number;
  mbGrade?: string;
  // PATCH 1079 — optional wire-ups from HANDOFF §6.
  promoterHistory?: number[];   // chronological promoter-holding %
  promoterLabels?: string[];    // matching labels (e.g. quarter strings)
  pledgePct?: number;
  assetRich?: AssetRichStock;   // when provided, AssetRichDetailCard renders
}

const MultibaggerStrips: React.FC<Props> = ({ fin, name, mbScore, mbGrade, promoterHistory, promoterLabels, pledgePct, assetRich }) => {
  // ─── Management Credibility — read transcripts from localStorage ───
  const concallData = useMemo(() => {
    if (typeof window === 'undefined' || !name) return null;
    try {
      const raw = window.localStorage.getItem(CONCALL_STORAGE_KEY);
      if (!raw) return null;
      const map: Record<string, Array<{ id: string; label: string; addedAt: string; chars: number; text: string; extract: any }>> = JSON.parse(raw);
      // Match case-insensitively
      const keys = Object.keys(map);
      const target = name.trim().toUpperCase();
      const key = keys.find((k) => k.trim().toUpperCase() === target);
      if (!key || !map[key]?.length) return null;
      const entries = [...map[key]].sort((a, b) => (a.addedAt > b.addedAt ? -1 : 1)); // latest first
      const latest = entries[0];
      const ex = latest.extract || {};
      // Disclosure checks — 5 fields
      const disclosure = [
        { k: 'Util %', ok: ex.utilization != null },
        { k: 'Capex ₹', ok: ex.capexGuidance != null },
        { k: 'Timeline', ok: Array.isArray(ex.timeline) && ex.timeline.length > 0 },
        { k: 'Order book', ok: ex.orderBook != null },
        { k: 'Growth/Margin notes', ok: !!ex.growthNote || !!ex.marginNote || !!ex.demandNote },
      ];
      const discScore = disclosure.filter((d) => d.ok).length;
      // Tone — quick heuristic across raw text
      const tone = tonePct(latest.text || '');
      // Specificity — does mgmt give precise numbers + dates?
      const specBits = [
        ex.utilization != null,
        ex.capexGuidance != null,
        Array.isArray(ex.timeline) && ex.timeline.length > 0,
      ];
      const spec = specBits.filter(Boolean).length; // 0-3
      const specTag = spec >= 3 ? 'HIGH' : spec >= 2 ? 'MED' : 'LOW';
      const specColor = spec >= 3 ? C.green : spec >= 2 ? C.amber : C.red;
      // Tone color
      const toneColor = tone == null ? C.textMuted : tone >= 55 ? C.green : tone >= 40 ? C.amber : C.red;
      // Disclosure color
      const discColor = discScore >= 4 ? C.green : discScore >= 3 ? C.amber : C.red;
      // Overall management grade
      let mgmtGrade = 'C';
      let mgmtColor = C.red;
      if (discScore >= 4 && spec >= 2 && (tone == null || tone >= 45)) {
        mgmtGrade = 'A';
        mgmtColor = C.green;
      } else if (discScore >= 3 && spec >= 2) {
        mgmtGrade = 'B';
        mgmtColor = C.amber;
      }
      return {
        label: latest.label,
        concallCount: entries.length,
        disclosure,
        discScore,
        discColor,
        tone,
        toneColor,
        spec,
        specTag,
        specColor,
        utilization: ex.utilization,
        capexGuidance: ex.capexGuidance,
        timeline: Array.isArray(ex.timeline) ? ex.timeline : [],
        growthNote: ex.growthNote,
        marginNote: ex.marginNote,
        demandNote: ex.demandNote,
        mgmtGrade,
        mgmtColor,
      };
    } catch {
      return null;
    }
  }, [name]);

  // Drop empty placeholder years (where sales == 0)
  const keep: number[] = [];
  for (let i = 0; i < fin.years.length; i++) {
    if ((fin.sales[i] ?? 0) > 0) keep.push(i);
  }
  if (keep.length === 0) {
    return (
      <div style={{ padding: 10, fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>
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
  const oi = pick(fin.oi);
  const bor = pick(fin.bor);
  const cash = pick(fin.cash);
  const recv = pick(fin.recv);
  const inv = pick(fin.inv);
  const ocf = pick(fin.ocf);
  const eq = pick(fin.eq);
  const res = pick(fin.res);
  const nb = pick(fin.nb);
  const cwip = pick(fin.cwip);
  const rm = fin.rm ? pick(fin.rm) : sales.map(() => 0);
  const chgInv = fin.chgInv ? pick(fin.chgInv) : sales.map(() => 0);
  const hasRm = rm.some((v) => v > 0);
  const hasChgInv = chgInv.some((v) => v !== 0);

  // Capex = ΔNB + ΔCWIP + Dep
  const capex = yrs.map((_, i) => {
    if (i === 0) return 0;
    return (nb[i] - nb[i - 1]) + (cwip[i] - cwip[i - 1]) + dep[i];
  });

  // Derived
  const ebit = pbt.map((p, i) => p + intr[i]); // EBIT = PBT + Interest
  const ebitda = ebit.map((e, i) => e + dep[i]); // EBITDA = EBIT + Depreciation
  // OP = PBT + Interest + Depreciation - Other Income  (this matches Screener's "Operating Profit")
  const op = pbt.map((p, i) => p + intr[i] + dep[i] - oi[i]);
  const capEmp = eq.map((e, i) => e + res[i] + bor[i]);
  const netDebt = bor.map((b, i) => b - cash[i]);

  // Margins
  const opm = sales.map((s, i) => (s > 0 ? (op[i] / s) * 100 : 0)); // TRUE OPM
  const ebitdaMargin = sales.map((s, i) => (s > 0 ? (ebitda[i] / s) * 100 : 0));
  // True GM = (Sales - RM - ChgInv) / Sales
  const grossMargin = sales.map((s, i) =>
    s > 0 && hasRm ? ((s - rm[i] - chgInv[i]) / s) * 100 : 0
  );

  const gmLabel = hasRm
    ? hasChgInv
      ? 'Gross Margin % (Sales − RM − ΔInv)'
      : 'Gross Margin % (Sales − RM)'
    : 'EBITDA margin % (GM proxy)';
  const gmSeries = hasRm ? grossMargin : ebitdaMargin;
  const marginColor = (i: number, series: number[]): string => {
    if (i === 0) return C.textMuted;
    const d = series[i] - series[i - 1];
    if (d >= -0.5) return C.green;
    if (d >= -2) return C.amber;
    return C.red;
  };

  const qogBars: Bar[] = yrs.map((y, i) => {
    const revG = i > 0 && sales[i - 1] > 0 ? ((sales[i] - sales[i - 1]) / sales[i - 1]) * 100 : 0;
    const omd = i > 0 ? opm[i] - opm[i - 1] : 0;
    let color: string = C.textMuted;
    if (revG > 0) {
      if (omd >= -0.5) color = C.green;
      else if (omd >= -2) color = C.amber;
      else color = C.red;
    }
    return { year: y, value: sales[i], display: fmtCr(sales[i]), color, live: i === last };
  });

  // Balance Sheet Stress
  const ndEbitda = netDebt.map((nd, i) => (ebitda[i] > 0 ? nd / ebitda[i] : 0));
  // IC: only "n/d" when interest is effectively zero (< 0.05 Cr).
  // Otherwise compute real coverage even when value is huge (small interest = strong signal, don't hide it).
  const intCovBars: Bar[] = ebit.map((e, i) => {
    const hasInt = intr[i] >= 0.05;
    if (!hasInt) return { year: yrs[i], value: 10, display: 'n/d', color: C.green, live: i === last };
    const v = e / intr[i];
    // Display: 1 decimal up to 99, then integer; cap visual at 20 but show real number
    const disp = v >= 100 ? v.toFixed(0) : v.toFixed(1);
    return { year: yrs[i], value: Math.min(v, 20), display: disp, color: bandHigh(v, 3, 2), live: i === last };
  });
  const wcDays = sales.map((s, i) => (s > 0 ? ((recv[i] + inv[i]) / s) * 365 : 0));
  // CFO/PAT 3y rolling ratio (e.g. 0.67, 1.05, 2.23) — financial-analyst convention
  const cfoPat3yArr: (number | null)[] = yrs.map((_, i) => {
    if (i < 2) return null;
    const cfoSum = ocf[i] + ocf[i - 1] + ocf[i - 2];
    const patSum = np[i] + np[i - 1] + np[i - 2];
    return patSum !== 0 ? cfoSum / patSum : null;
  });

  // ROCE
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
      ? { g: 'A', c: C.green, note: 'High and rising ROCE, sensible capex' }
      : recentAvg >= 10
      ? { g: 'B', c: C.amber, note: 'Decent ROCE, neutral trend' }
      : { g: 'C', c: C.redDim, note: 'ROCE falling — wealth-destroying flag' };

  const sectionStyle: React.CSSProperties = {
    paddingBottom: 8,
    borderBottom: `0.5px solid ${C.divider}`,
    marginBottom: 8,
  };

  return (
    <div
      style={{
        background: C.bg,
        color: C.text,
        padding: 12,
        border: `0.5px solid ${C.divider}`,
        borderRadius: 4,
        marginTop: 8,
        marginBottom: 4,
        fontSize: 11,
        fontFamily: 'inherit',
      }}
    >
      {/* Panel header — institutional ticker-strip style */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: 6,
          marginBottom: 8,
          borderBottom: `0.5px solid ${C.divider}`,
        }}
      >
        <div>
          <span style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1.5, marginRight: 8 }}>
            ONE-VIEW
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.white, letterSpacing: 0.5 }}>
            {name ?? 'top company'}
          </span>
        </div>
        <div style={{ ...MONO, fontSize: 10, color: C.textDim }}>
          {mbGrade ? `MB ${mbGrade}` : ''}
          {mbScore != null ? `  ·  ${mbScore.toFixed(0)}` : ''}
          {`  ·  ${yrs[0]}—${yrs[last]}`}
        </div>
      </div>

      {/* === CAPITAL DEPLOYMENT === */}
      <div style={{ ...sectionStyle }}>
        <SectionHead title="Capex by Year" color={C.capex} metric="₹ Cr" sub="ΔNB + ΔCWIP + Dep" />
        <StripRow
          bars={capex.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: fmtCr(v),
            color: C.capex,
            live: i === last,
          }))}
        />
      </div>

      <div style={{ ...sectionStyle }}>
        <SectionHead title="Fixed Assets (Net Block)" color={C.nb} metric="₹ Cr" sub="gross blocks commissioned" />
        <StripRow
          bars={nb.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: fmtCr(v),
            color: C.nb,
            live: i === last,
          }))}
        />
      </div>

      <div style={{ ...sectionStyle }}>
        <SectionHead title="CWIP by Year" color={C.cwip} metric="₹ Cr" sub="build → drain = commissioning" />
        <StripRow
          bars={cwip.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: fmtCr(v),
            color: C.cwip,
            live: i === last,
          }))}
        />
      </div>

      <div style={{ ...sectionStyle }}>
        <SectionHead title="Depreciation by Year" color={C.dep} metric="₹ Cr" sub="capacity-cost burden after commissioning" />
        <StripRow
          bars={dep.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: fmtCr(v),
            color: C.dep,
            live: i === last,
          }))}
        />
      </div>

      {/* PATCH 1079 — Promoter trajectory (HANDOFF §6 wire-up). Renders only when data passed. */}
      {Array.isArray(promoterHistory) && promoterHistory.length > 0 && (
        <div style={{ ...sectionStyle }}>
          <SectionHead title="Promoter Holding" color={C.green} metric="%" sub="trajectory: rising = aligned, falling = exit risk" />
          <PromoterStrip history={promoterHistory} labels={promoterLabels} pledgePct={pledgePct} />
        </div>
      )}

      {/* PATCH 1079 — Asset-rich detail card (HANDOFF §6 wire-up). Renders only when data passed. */}
      {assetRich && (
        <div style={{ ...sectionStyle }}>
          <AssetRichDetailCard stock={assetRich} title="Asset-Rich Verdict" />
        </div>
      )}

      {/* === QUALITY OF GROWTH === */}
      <div style={{ ...sectionStyle }}>
        <SectionHead title="Quality of Growth" color={C.green} metric="Revenue + GM + OPM" sub="green=clean, red=margin compression" />

        <SubLabel><b style={{ color: C.text }}>Revenue (₹ Cr)</b> · bar color = OPM-delta flag</SubLabel>
        <StripRow bars={qogBars} />

        <SubLabel><b style={{ color: C.text }}>{gmLabel}</b> · stable/up = green</SubLabel>
        <StripRow
          bars={gmSeries.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: marginColor(i, gmSeries),
            live: i === last,
          }))}
        />

        <SubLabel><b style={{ color: C.text }}>OPM % (OP / Sales)</b> · OP = PBT + Intr + Dep − OI · matches Screener</SubLabel>
        <StripRow
          bars={opm.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: marginColor(i, opm),
            live: i === last,
          }))}
        />
      </div>

      {/* === BALANCE SHEET STRESS === */}
      <div style={{ ...sectionStyle }}>
        <SectionHead title="Balance Sheet Stress" color={C.red} metric="ND/EBITDA · IC · WC · CFO/PAT" sub="hard guardrails" />

        <SubLabel><b style={{ color: C.text }}>Net Debt / EBITDA (×)</b> · grn ≤2 · amb 2-3 · red &gt;3</SubLabel>
        <StripRow
          bars={ndEbitda.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(1),
            color: bandLow(v, 2, 3),
            live: i === last,
          }))}
        />

        <SubLabel><b style={{ color: C.text }}>Interest Coverage (×)</b> · grn ≥3 · n/d = no debt</SubLabel>
        <StripRow bars={intCovBars} />

        <SubLabel><b style={{ color: C.text }}>Working Capital days</b> · receivables + inventory</SubLabel>
        <StripRow
          bars={wcDays.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: bandLow(v, 120, 180),
            live: i === last,
          }))}
        />

        <SubLabel><b style={{ color: C.text }}>CFO / PAT (3y rolling ratio)</b> · grn ≥0.7 · amb 0.5-0.7 · red &lt;0.5</SubLabel>
        <StripRow
          cap={3}
          bars={cfoPat3yArr.map((v, i) => ({
            year: yrs[i],
            value: v ?? 0,
            display: v === null ? '—' : v.toFixed(2),
            color: v === null ? C.divider : bandHigh(v, 0.7, 0.5),
            live: i === last,
          }))}
        />
      </div>

      {/* === ROCE PATH === */}
      <div style={{ ...sectionStyle }}>
        <SectionHead title="ROCE Path & Reinvestment Skill" color={C.purple} metric="ROCE + Incremental ROCE" sub="3-5y trajectory" />

        <SubLabel><b style={{ color: C.text }}>ROCE %</b> · grn ≥15 · red &lt;10 (wealth-destroying)</SubLabel>
        <StripRow
          bars={roce.map((v, i) => ({
            year: yrs[i],
            value: v,
            display: v.toFixed(0),
            color: bandHigh(v, 15, 10),
            live: i === last,
          }))}
        />

        <SubLabel><b style={{ color: C.text }}>Incremental ROCE per cycle</b> · ΔEBIT / ΔCapEmp (3y)</SubLabel>
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

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 6 }}>
          <span style={{ color: capGrade.c, fontWeight: 600, letterSpacing: 0.5 }}>
            ● CAPITAL ALLOCATION: {capGrade.g}
          </span>
          <span style={{ color: C.textDim }}>{capGrade.note}</span>
        </div>
      </div>

      {/* === MANAGEMENT === */}
      <div>
        <SectionHead
          title="Management Credibility"
          color={C.blue}
          metric={concallData ? `${concallData.concallCount} concall${concallData.concallCount > 1 ? 's' : ''} analyzed` : 'Concall · Pledge · Disclosure'}
          sub={concallData ? concallData.label : 'no concall — upload via 🎙 tab'}
        />
        {concallData ? (
          <>
            {/* Header row: management grade */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: C.textDim }}>Overall grade</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: concallData.mgmtColor, letterSpacing: 0.5 }}>
                {concallData.mgmtGrade}
              </span>
            </div>

            {/* 3-cell metric strip: disclosure / tone / specificity */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 6 }}>
              <div style={{ border: `0.5px solid ${concallData.discColor}`, padding: '4px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 0.3 }}>DISCLOSURE</div>
                <div style={{ ...MONO, fontSize: 13, fontWeight: 600, color: concallData.discColor, marginTop: 1 }}>
                  {concallData.discScore}/5
                </div>
                <div style={{ fontSize: 9, color: C.textDim, marginTop: 1 }}>KPIs disclosed</div>
              </div>
              <div style={{ border: `0.5px solid ${concallData.toneColor}`, padding: '4px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 0.3 }}>TONE</div>
                <div style={{ ...MONO, fontSize: 13, fontWeight: 600, color: concallData.toneColor, marginTop: 1 }}>
                  {concallData.tone == null ? '—' : `${concallData.tone.toFixed(0)}%`}
                </div>
                <div style={{ fontSize: 9, color: C.textDim, marginTop: 1 }}>positive vs cautious</div>
              </div>
              <div style={{ border: `0.5px solid ${concallData.specColor}`, padding: '4px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 0.3 }}>SPECIFICITY</div>
                <div style={{ ...MONO, fontSize: 13, fontWeight: 600, color: concallData.specColor, marginTop: 1 }}>
                  {concallData.specTag}
                </div>
                <div style={{ fontSize: 9, color: C.textDim, marginTop: 1 }}>numbers + dates</div>
              </div>
            </div>

            {/* Disclosed-KPI chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {concallData.disclosure.map((d, i) => (
                <span
                  key={i}
                  style={{
                    ...MONO,
                    fontSize: 9,
                    padding: '1px 6px',
                    borderRadius: 2,
                    background: d.ok ? 'rgba(29,158,117,0.10)' : 'rgba(124,139,161,0.06)',
                    color: d.ok ? C.green : C.textMuted,
                    border: `0.5px solid ${d.ok ? 'rgba(29,158,117,0.35)' : C.divider}`,
                    letterSpacing: 0.3,
                  }}
                >
                  {d.ok ? '✓' : '·'} {d.k}
                </span>
              ))}
            </div>

            {/* Extracted KPI values */}
            <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.7 }}>
              {concallData.utilization != null && (
                <span style={{ marginRight: 10 }}>
                  <b style={{ color: C.text }}>Util:</b> <span style={MONO}>{concallData.utilization}%</span>
                </span>
              )}
              {concallData.capexGuidance != null && (
                <span style={{ marginRight: 10 }}>
                  <b style={{ color: C.text }}>Capex:</b> <span style={MONO}>₹{concallData.capexGuidance} Cr</span>
                </span>
              )}
              {concallData.timeline.length > 0 && (
                <span style={{ marginRight: 10 }}>
                  <b style={{ color: C.text }}>Timeline:</b> {concallData.timeline.slice(0, 2).join(', ')}
                </span>
              )}
            </div>

            <div style={{ fontSize: 9, color: C.textMuted, fontStyle: 'italic', marginTop: 6 }}>
              Promoter holding/pledge + guidance-vs-delivery (beat/meet/miss) require AR scrape + multi-quarter concall history — not yet wired.
            </div>
          </>
        ) : (
          <div style={{ padding: '4px 0', fontSize: 10, color: C.textMuted, fontStyle: 'italic' }}>
            No concall transcript for this company. Upload via the 🎙 Concall tab to unlock disclosure + tone + specificity scores.
          </div>
        )}
      </div>
    </div>
  );
};

export default MultibaggerStrips;
