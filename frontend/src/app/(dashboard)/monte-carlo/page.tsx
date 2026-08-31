'use client';

// ════════════════════════════════════════════════════════════════════════════
// JOURNEY MONTE CARLO
// A probabilistic version of the deterministic wealth-journey (journey/page.tsx).
// That page draws ONE lumpy line (₹43 L seed → ~₹10.8 cr). This page draws the
// whole distribution: N random paths from a lognormal return model calibrated to
// the journey's implied CAGR, same start / horizon / top-ups. Fan chart (P10–P90
// bands), terminal-corpus distribution, drawdown & sequence-of-returns stress,
// and a plain-language read-out. All compute is pure (see lib/monte-carlo.ts) so
// it is SSR-safe; the only window access is the reproducible-seed nonce in an
// effect.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState, type CSSProperties } from 'react';
import {
  runMonteCarlo,
  journeyImpliedCagrPct,
  JOURNEY_START_CR,
  JOURNEY_YEARS,
  JOURNEY_TOPUP_CR,
  JOURNEY_START_YEAR,
  JOURNEY_TARGET_CR,
  type MCResult,
} from '@/lib/monte-carlo';

const C = {
  bg0: 'var(--mc-bg-0)', bg1: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', bg3: 'var(--mc-bg-3)', bg4: 'var(--mc-bg-4)',
  t0: 'var(--mc-text-0)', t1: 'var(--mc-text-1)', t2: 'var(--mc-text-2)', t3: 'var(--mc-text-3)', t4: 'var(--mc-text-4)',
  b1: 'var(--mc-border-1)', b2: 'var(--mc-border-2)', b3: 'var(--mc-border-3)',
  bull: 'var(--mc-bullish)', bear: 'var(--mc-bearish)', warn: 'var(--mc-warn)', err: 'var(--mc-err)',
  info: 'var(--mc-info)', accent: 'var(--mc-accent)', cyan: 'var(--mc-cyan)', saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
} as const;

const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';
const NUM: CSSProperties = { fontVariantNumeric: 'tabular-nums', fontFamily: MONO };

// ─── money formatter — lakh-aware, ₹cr for ≥1 cr ─────────────────────────────
function fmtCr(cr: number, dp?: number): string {
  if (!isFinite(cr)) return '—';
  if (cr < 1) return `₹${(cr * 100).toFixed(0)} L`;
  if (cr >= 100) return `₹${cr.toFixed(dp ?? 0)} cr`;
  if (cr >= 10) return `₹${cr.toFixed(dp ?? 1)} cr`;
  return `₹${cr.toFixed(dp ?? 2)} cr`;
}
const IMPLIED_CAGR = journeyImpliedCagrPct(); // ≈ 34.9%, computed from the path

export default function MonteCarloPage() {
  // ─── Controls — prefilled from the real journey model ──────────────────────
  const [startCr, setStartCr] = useState<number>(JOURNEY_START_CR);      // ₹43 L
  const [years, setYears] = useState<number>(JOURNEY_YEARS);             // 10 steps (2025→2035)
  const [cagr, setCagr] = useState<number>(Math.round(IMPLIED_CAGR));    // ~35%
  const [vol, setVol] = useState<number>(25);                           // concentrated equity default
  const [sims, setSims] = useState<number>(5000);
  const [taxOn, setTaxOn] = useState<boolean>(true);
  const [taxRate, setTaxRate] = useState<number>(12.5);                  // India LTCG
  const [target, setTarget] = useState<number>(JOURNEY_TARGET_CR);       // ₹10 cr goal
  const [topupOn, setTopupOn] = useState<boolean>(true);
  const [topupCr, setTopupCr] = useState<number>(JOURNEY_TOPUP_CR);      // ₹20 L
  const [topupYear, setTopupYear] = useState<number>(3);                 // end-2028 = index 3
  const [seedNonce, setSeedNonce] = useState<number>(1);                 // bump = fresh draw

  const result: MCResult = useMemo(() => {
    const topups: Record<number, number> = {};
    if (topupOn && topupCr > 0 && topupYear >= 1 && topupYear <= years) topups[topupYear] = topupCr;
    return runMonteCarlo({
      startCr, years: Math.max(1, Math.round(years)), cagrPct: cagr, volPct: vol,
      sims: Math.max(200, Math.min(50000, Math.round(sims))),
      topups, taxOn, taxRatePct: taxRate, targetCr: target,
      seed: 0x9e3779b1 ^ (seedNonce * 2654435761),
    });
  }, [startCr, years, cagr, vol, sims, taxOn, taxRate, target, topupOn, topupCr, topupYear, seedNonce]);

  const r = result;
  const inv = r.totalInvested;

  return (
    <div style={{ background: C.bg0, minHeight: '100%', padding: 20, color: C.t1 }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ─── HEADER ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: C.cyan, letterSpacing: -0.4 }}>
              🎲 Journey Monte Carlo
            </h1>
            <div style={{ fontSize: 12.5, color: C.t3, marginTop: 5, lineHeight: 1.5, maxWidth: 820 }}>
              The Journey shows one line to ~{fmtCr(10.83)}. Reality is a <em>distribution</em>. This runs{' '}
              <strong style={{ color: C.t1 }}>{r.years} years</strong> of random returns off the same seed
              (<strong style={{ color: C.t1 }}>{fmtCr(startCr)}</strong>), CAGR and top-ups — thousands of futures instead of one —
              so you see the odds, not just the dream.
            </div>
          </div>
          <button
            onClick={() => setSeedNonce((n) => n + 1)}
            style={{
              padding: '9px 18px', background: 'color-mix(in srgb, var(--mc-cyan) 16%, transparent)',
              border: '1px solid ' + C.cyan, borderRadius: 7, color: C.cyan, fontSize: 13, fontWeight: 800,
              cursor: 'pointer', letterSpacing: 0.4, ...NUM,
            }}
          >
            ↻ RE-RUN ({r.years > 0 ? Math.max(200, Math.min(50000, Math.round(sims))).toLocaleString() : ''} sims)
          </button>
        </div>

        {/* ─── CONTROLS ───────────────────────────────────────────────── */}
        <div style={{ background: C.bg1, border: '1px solid ' + C.b1, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.saffron, letterSpacing: 0.3, marginBottom: 12 }}>
            ⚙ ASSUMPTIONS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <NumField label="Start capital (₹ cr)" value={startCr} onChange={setStartCr} step={0.05} min={0.05} />
            <NumField label="Years (compounding)" value={years} onChange={setYears} step={1} min={1} max={40} />
            <NumField label="Expected CAGR (%)" value={cagr} onChange={setCagr} step={1} min={-20} max={80} />
            <NumField label="Volatility σ (%/yr)" value={vol} onChange={setVol} step={1} min={1} max={80} />
            <NumField label="Simulations" value={sims} onChange={setSims} step={1000} min={200} max={50000} />
            <NumField label="Target corpus (₹ cr)" value={target} onChange={setTarget} step={1} min={0.5} />
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', marginTop: 14, paddingTop: 14, borderTop: '1px solid ' + C.b3 }}>
            {/* tax drag */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, color: C.t2 }}>
              <input type="checkbox" checked={taxOn} onChange={(e) => setTaxOn(e.target.checked)} style={{ accentColor: 'var(--mc-cyan)', width: 15, height: 15 }} />
              <span style={{ fontWeight: 700 }}>Tax drag</span>
              <span style={{ color: C.t4 }}>· India LTCG on terminal gains</span>
            </label>
            <div style={{ opacity: taxOn ? 1 : 0.4, pointerEvents: taxOn ? 'auto' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: C.t3, fontWeight: 700 }}>RATE</span>
              <MiniNum value={taxRate} onChange={setTaxRate} step={0.5} min={0} max={40} suffix="%" width={54} />
            </div>

            {/* top-up */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, color: C.t2, marginLeft: 8 }}>
              <input type="checkbox" checked={topupOn} onChange={(e) => setTopupOn(e.target.checked)} style={{ accentColor: 'var(--mc-saffron)', width: 15, height: 15 }} />
              <span style={{ fontWeight: 700 }}>Top-up</span>
            </label>
            <div style={{ opacity: topupOn ? 1 : 0.4, pointerEvents: topupOn ? 'auto' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
              <MiniNum value={topupCr} onChange={setTopupCr} step={0.05} min={0} suffix="cr" width={58} />
              <span style={{ fontSize: 11, color: C.t3, fontWeight: 700 }}>at end of Y</span>
              <MiniNum value={topupYear} onChange={setTopupYear} step={1} min={1} max={years} width={46} />
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: C.t4, lineHeight: 1.55 }}>
            Model: annual growth is <strong>lognormal</strong> — <code>g = exp(μ + σ·Z)</code>, Z ~ N(0,1) via Box–Muller —
            calibrated so the expected (mean) annual return equals the CAGR above. Because of volatility drag the <em>median</em>{' '}
            path lands below the naive {fmtCr(startCr)}×(1+{cagr}%)<sup>{r.years}</sup> line. CAGR prefilled from the journey's implied{' '}
            <strong style={{ color: C.t2 }}>{IMPLIED_CAGR.toFixed(1)}%</strong> (geometric mean of its path). Tax = one-shot LTCG on
            terminal gain above invested capital. Not investment advice.
          </div>
        </div>

        {/* ─── HEADLINE READ-OUT ──────────────────────────────────────── */}
        <div style={{
          background: 'linear-gradient(135deg, var(--mc-bg-1), var(--mc-bg-2))',
          border: '1px solid ' + C.cyan + '55', borderLeft: '4px solid ' + C.cyan, borderRadius: 10, padding: '16px 20px',
        }}>
          <div style={{ fontSize: 10, color: C.cyan, fontWeight: 800, letterSpacing: 0.5, marginBottom: 6 }}>THE ODDS, IN PLAIN WORDS</div>
          <div style={{ fontSize: 15.5, color: C.t1, lineHeight: 1.6 }}>
            You invest <strong style={{ color: C.t0 }}>{fmtCr(inv)}</strong> of your own money over {r.years} years.
            In <strong style={{ color: C.bull }}>half of futures</strong> you end above{' '}
            <strong style={{ color: C.bull }}>{fmtCr(r.terminal.p50)}</strong>{' '}
            (<span style={{ ...NUM }}>{r.medianTerminalMultiple.toFixed(1)}×</span> your capital).
            In the <strong style={{ color: C.warn }}>best 1-in-10</strong> you clear{' '}
            <strong style={{ color: C.bull }}>{fmtCr(r.terminal.p90)}</strong>; in the{' '}
            <strong style={{ color: C.err }}>worst 1-in-10</strong> you end below{' '}
            <strong style={{ color: C.err }}>{fmtCr(r.worstCaseTerminalCr)}</strong>.
            You hit the <strong style={{ color: C.saffron }}>{fmtCr(target)}</strong> goal in{' '}
            <strong style={{ color: r.probTargetPct >= 50 ? C.bull : C.warn }}>{r.probTargetPct.toFixed(0)}%</strong>{' '}
            of runs, and end with less than you put in{' '}
            <strong style={{ color: r.probLossPct > 15 ? C.err : C.t2 }}>{r.probLossPct.toFixed(0)}%</strong> of the time.
          </div>
        </div>

        {/* ─── FAN CHART ──────────────────────────────────────────────── */}
        <div style={{ background: C.bg1, border: '1px solid ' + C.b1, borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.t1, letterSpacing: 0.3 }}>📈 Fan chart · percentile wealth bands</div>
            <div style={{ fontSize: 11, color: C.t3 }}>log ₹ cr axis · pre-tax mark-to-market</div>
          </div>
          <div style={{ fontSize: 11, color: C.t3, marginBottom: 10 }}>
            Outer band P10–P90, inner band P25–P75, solid line the median. Dashed gold is the deterministic journey base case.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <FanChart result={r} target={target} />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: C.t3 }}>
            <Legend swatch={C.cyan} alpha={0.16} label="P10–P90" />
            <Legend swatch={C.cyan} alpha={0.34} label="P25–P75" />
            <Legend line={C.cyan} label="Median (P50)" />
            <Legend line={C.saffron} dashed label="Journey base case" />
            <Legend line={C.warn} dashed label={`Target ${fmtCr(target)}`} />
          </div>
        </div>

        {/* ─── TERMINAL DISTRIBUTION ──────────────────────────────────── */}
        <div style={{ background: C.bg1, border: '1px solid ' + C.b1, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.t1, letterSpacing: 0.3, marginBottom: 4 }}>
            🎯 Terminal corpus {taxOn ? '(after LTCG)' : '(pre-tax)'}
          </div>
          <div style={{ fontSize: 11, color: C.t3, marginBottom: 12 }}>
            Where you stand at year {r.years}. Multiple is on {fmtCr(inv)} of own capital invested.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Tile label="P10 · worst 1-in-10" value={fmtCr(r.terminal.p10)} sub={`${(r.terminal.p10 / inv).toFixed(1)}× capital`} tone="bad" />
            <Tile label="P50 · median" value={fmtCr(r.terminal.p50)} sub={`${(r.terminal.p50 / inv).toFixed(1)}× capital`} tone="good" />
            <Tile label="P90 · best 1-in-10" value={fmtCr(r.terminal.p90)} sub={`${(r.terminal.p90 / inv).toFixed(1)}× capital`} tone="info" />
            <Tile
              label={`P(reach ${fmtCr(target)})`}
              value={`${r.probTargetPct.toFixed(0)}%`}
              sub={r.probTargetPct >= 50 ? 'more likely than not' : 'a stretch'}
              tone={r.probTargetPct >= 50 ? 'good' : 'warn'}
            />
            <Tile
              label="P(loss on capital)"
              value={`${r.probLossPct.toFixed(0)}%`}
              sub={`end below ${fmtCr(inv)}`}
              tone={r.probLossPct > 15 ? 'bad' : 'good'}
            />
          </div>

          {/* terminal histogram */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: C.t3, marginBottom: 6 }}>Spread of outcomes (P10 · P25 · P50 · P75 · P90 · mean):</div>
            <TerminalStrip result={r} target={target} />
          </div>
        </div>

        {/* ─── DRAWDOWN / SEQUENCE-OF-RETURNS STRESS ──────────────────── */}
        <div style={{ background: C.bg1, border: '1px solid ' + C.warn + '44', borderLeft: '3px solid ' + C.warn, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.warn, letterSpacing: 0.3, marginBottom: 4 }}>
            ⚠ Downside & sequence-of-returns stress
          </div>
          <div style={{ fontSize: 11, color: C.t3, marginBottom: 12 }}>
            The median outcome hides the ride. A concentrated book at {vol}% vol takes deep intra-journey hits — order of returns matters.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <Tile label="Median max drawdown" value={`-${r.medianMaxDrawdownPct.toFixed(0)}%`} sub="typical peak-to-trough on the way" tone="warn" />
            <Tile label="Worst 1-in-10 ending" value={fmtCr(r.worstCaseTerminalCr)} sub={`${(r.worstCaseTerminalCr / inv).toFixed(1)}× capital`} tone="bad" />
            <Tile label="Median ending" value={fmtCr(r.terminal.p50)} sub="the coin-flip middle" tone="good" />
            <Tile label="Journey base case" value={fmtCr(r.determTerminalCr)} sub="the single deterministic line" tone="info" />
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: C.t2, lineHeight: 1.6, background: C.bg0, border: '1px solid ' + C.b3, borderRadius: 8, padding: '11px 14px' }}>
            Half of paths draw down at least <strong style={{ color: C.warn }}>-{r.medianMaxDrawdownPct.toFixed(0)}%</strong> from a
            peak at some point — the emotional cost of the {fmtCr(r.terminal.p50)} median. If the bad years arrive early
            (poor sequence of returns), even a strong average CAGR can strand you near{' '}
            <strong style={{ color: C.err }}>{fmtCr(r.worstCaseTerminalCr)}</strong>. Surviving the drawdown without selling is the
            whole game.
          </div>
        </div>

        <div style={{ fontSize: 11, color: C.t4, lineHeight: 1.55, paddingBottom: 8 }}>
          Deterministic base case ({fmtCr(JOURNEY_START_CR)} seed {JOURNEY_START_YEAR}, {fmtCr(JOURNEY_TOPUP_CR)} top-up end-2028,
          {' '}{JOURNEY_YEARS}-step path) lands ~{fmtCr(10.83)} — this Monte Carlo re-rolls that journey {Math.max(200, Math.min(50000, Math.round(sims))).toLocaleString()} times.
          Percentiles are nearest-rank. Randomness is seeded, so a given set of inputs reproduces until you press Re-run. Educational, not investment advice.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FAN CHART — inline SVG, log-₹cr y-axis, no chart library
// ════════════════════════════════════════════════════════════════════════════
function FanChart({ result, target }: { result: MCResult; target: number }) {
  const W = 960, H = 400, padL = 62, padR = 96, padT = 18, padB = 40;
  const n = result.years;
  const b = result.bands;

  // y-range across every band + deterministic + target, in log space
  let lo = Infinity, hi = -Infinity;
  const scan = (v: number) => { if (v > 0 && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  b.p10.forEach(scan); b.p90.forEach(scan);
  result.determPath.forEach((v, i) => { if (i <= n) scan(v); });
  scan(target);
  if (!isFinite(lo) || !isFinite(hi) || lo <= 0) { lo = 0.1; hi = 100; }
  lo = lo * 0.85; hi = hi * 1.15;
  const l10lo = Math.log10(lo), l10hi = Math.log10(hi);
  const span = Math.max(1e-6, l10hi - l10lo);

  const x = (i: number) => padL + (n === 0 ? 0 : i / n) * (W - padL - padR);
  const y = (v: number) => {
    const vv = v > 0 ? v : lo;
    return padT + (1 - (Math.log10(vv) - l10lo) / span) * (H - padT - padB);
  };

  // log-nice y ticks: 1,2,5 × 10^k within [lo,hi]
  const ticks: number[] = [];
  const kMin = Math.floor(l10lo), kMax = Math.ceil(l10hi);
  for (let k = kMin; k <= kMax; k++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, k);
      if (v >= lo && v <= hi) ticks.push(v);
    }
  }

  const area = (upper: number[], lower: number[]) => {
    let d = '';
    for (let i = 0; i <= n; i++) d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(upper[i]).toFixed(1)} `;
    for (let i = n; i >= 0; i--) d += `L${x(i).toFixed(1)},${y(lower[i]).toFixed(1)} `;
    return d + 'Z';
  };
  const line = (s: number[], upto = n) => {
    let d = '';
    for (let i = 0; i <= upto; i++) d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s[i]).toFixed(1)} `;
    return d;
  };

  const determUpto = Math.min(result.determPath.length - 1, n);
  const determEndX = x(determUpto);
  const determEndY = y(result.determPath[determUpto]);
  const targetInRange = target >= lo && target <= hi;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640, display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {/* y grid + labels */}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={C.b3} strokeWidth={1} />
          <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={C.t3} fontFamily={MONO}>{fmtCrAxis(v)}</text>
        </g>
      ))}
      {/* x axis year labels */}
      {Array.from({ length: n + 1 }, (_, i) => i).filter((i) => n <= 12 || i % Math.ceil(n / 12) === 0 || i === n).map((i) => (
        <text key={i} x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize={9.5} fill={C.t4} fontFamily={MONO}>
          {JOURNEY_START_YEAR + i}
        </text>
      ))}
      <text x={(padL + W - padR) / 2} y={H - 4} textAnchor="middle" fontSize={10} fill={C.t4} fontFamily={MONO}>year</text>

      {/* bands */}
      <path d={area(b.p90, b.p10)} fill={C.cyan} fillOpacity={0.14} stroke="none" />
      <path d={area(b.p75, b.p25)} fill={C.cyan} fillOpacity={0.22} stroke="none" />

      {/* target line */}
      {targetInRange && (
        <>
          <line x1={padL} y1={y(target)} x2={W - padR} y2={y(target)} stroke={C.warn} strokeWidth={1.3} strokeDasharray="5 4" opacity={0.9} />
          <text x={W - padR + 5} y={y(target) + 3.5} fontSize={9.5} fill={C.warn} fontFamily={MONO} fontWeight={700}>goal</text>
        </>
      )}

      {/* median */}
      <path d={line(b.p50)} fill="none" stroke={C.cyan} strokeWidth={2.4} />

      {/* deterministic journey base case */}
      <path d={line(result.determPath, determUpto)} fill="none" stroke={C.saffron} strokeWidth={2} strokeDasharray="6 4" />
      <circle cx={determEndX} cy={determEndY} r={4} fill={C.saffron} />
      <text x={determEndX + 6} y={determEndY - 6} fontSize={10} fill={C.saffron} fontFamily={MONO} fontWeight={800}>
        {fmtCr(result.determTerminalCr)}
      </text>

      {/* median endpoint marker */}
      <circle cx={x(n)} cy={y(b.p50[n])} r={4} fill={C.cyan} />
      <text x={W - padR + 5} y={y(b.p50[n]) + 3.5} fontSize={9.5} fill={C.cyan} fontFamily={MONO} fontWeight={700}>P50</text>
      <text x={W - padR + 5} y={y(b.p90[n]) + 3.5} fontSize={9.5} fill={C.t3} fontFamily={MONO}>P90</text>
      <text x={W - padR + 5} y={y(b.p10[n]) + 3.5} fontSize={9.5} fill={C.t3} fontFamily={MONO}>P10</text>
    </svg>
  );
}

// compact axis label: sub-cr in L, else cr
function fmtCrAxis(cr: number): string {
  if (cr < 1) return `${(cr * 100).toFixed(0)}L`;
  if (cr >= 100) return `${cr.toFixed(0)}cr`;
  if (cr >= 10) return `${cr.toFixed(0)}cr`;
  return `${cr.toFixed(cr < 2 ? 1 : 0)}cr`;
}

// ════════════════════════════════════════════════════════════════════════════
// TERMINAL STRIP — a horizontal P10..P90 range bar with markers
// ════════════════════════════════════════════════════════════════════════════
function TerminalStrip({ result, target }: { result: MCResult; target: number }) {
  const t = result.terminal;
  const lo = Math.min(t.p10, target) * 0.9;
  const hi = Math.max(t.p90, target) * 1.05;
  const l10lo = Math.log10(Math.max(1e-4, lo)), l10hi = Math.log10(Math.max(1e-3, hi));
  const span = Math.max(1e-6, l10hi - l10lo);
  const pos = (v: number) => `${((Math.log10(Math.max(1e-4, v)) - l10lo) / span) * 100}%`;

  const marks: { v: number; label: string; color: string; up?: boolean }[] = [
    { v: t.p10, label: 'P10', color: C.err },
    { v: t.p25, label: 'P25', color: C.t3 },
    { v: t.p50, label: 'P50', color: C.cyan, up: true },
    { v: t.p75, label: 'P75', color: C.t3 },
    { v: t.p90, label: 'P90', color: C.bull },
    { v: t.mean, label: 'mean', color: C.saffron, up: true },
  ];

  return (
    <div style={{ position: 'relative', height: 70, marginTop: 8 }}>
      {/* track */}
      <div style={{ position: 'absolute', top: 30, left: 0, right: 0, height: 10, background: C.bg3, borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: pos(t.p10), width: `calc(${pos(t.p90)} - ${pos(t.p10)})`, height: '100%', background: 'color-mix(in srgb, var(--mc-cyan) 22%, transparent)' }} />
        <div style={{ position: 'absolute', left: pos(t.p25), width: `calc(${pos(t.p75)} - ${pos(t.p25)})`, height: '100%', background: 'color-mix(in srgb, var(--mc-cyan) 40%, transparent)' }} />
      </div>
      {/* target */}
      {target >= lo && target <= hi && (
        <div style={{ position: 'absolute', top: 22, left: pos(target), transform: 'translateX(-50%)' }}>
          <div style={{ width: 2, height: 26, background: C.warn }} />
          <div style={{ position: 'absolute', top: 28, left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: C.warn, fontWeight: 800, whiteSpace: 'nowrap', ...NUM }}>goal {fmtCr(target)}</div>
        </div>
      )}
      {/* markers */}
      {marks.map((m) => (
        <div key={m.label} style={{ position: 'absolute', top: m.up ? 2 : 44, left: pos(m.v), transform: 'translateX(-50%)', textAlign: 'center' }}>
          {!m.up && <div style={{ width: 2, height: 12, background: m.color, margin: '0 auto 2px' }} />}
          <div style={{ fontSize: 9.5, color: m.color, fontWeight: 800, ...NUM }}>{m.label}</div>
          <div style={{ fontSize: 10, color: C.t2, ...NUM }}>{fmtCr(m.v)}</div>
          {m.up && <div style={{ width: 2, height: 12, background: m.color, margin: '2px auto 0' }} />}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Small presentational atoms
// ════════════════════════════════════════════════════════════════════════════
function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' | 'info' }) {
  const c = tone === 'bad' ? C.err : tone === 'warn' ? C.warn : tone === 'good' ? C.bull : tone === 'info' ? C.info : C.t0;
  return (
    <div style={{ background: C.bg0, border: '1px solid ' + C.b1, borderRadius: 8, padding: '11px 13px' }}>
      <div style={{ fontSize: 10, color: C.t3, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ ...NUM, fontSize: 23, fontWeight: 900, color: c, marginTop: 5, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: C.t3, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Legend({ swatch, alpha, line, dashed, label }: { swatch?: string; alpha?: number; line?: string; dashed?: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {swatch != null ? (
        <span style={{ width: 16, height: 11, borderRadius: 2, background: `color-mix(in srgb, ${swatch} ${Math.round((alpha ?? 0.2) * 100)}%, transparent)`, border: '1px solid ' + C.b2 }} />
      ) : (
        <span style={{ width: 16, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${line}` }} />
      )}
      <span>{label}</span>
    </span>
  );
}

// ─── number inputs ───────────────────────────────────────────────────────────
function NumField({ label, value, onChange, step = 1, min, max }: {
  label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, color: C.t3, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>{label}</label>
      <input
        type="text" inputMode="decimal"
        value={isFinite(value) ? String(value) : '0'}
        onChange={(e) => { const raw = e.target.value.trim().replace(',', '.'); if (raw === '' || raw === '.' || raw === '-') return; const nn = Number(raw); if (isFinite(nn)) onChange(nn); }}
        onBlur={(e) => { let nn = Number(String(e.target.value).trim().replace(',', '.')); if (!isFinite(nn)) nn = min ?? 0; if (min != null && nn < min) nn = min; if (max != null && nn > max) nn = max; onChange(nn); }}
        style={{ background: C.bg0, border: '1px solid ' + C.b2, color: C.t1, padding: '8px 10px', borderRadius: 5, fontSize: 14, fontWeight: 700, ...NUM }}
      />
    </div>
  );
}

function MiniNum({ value, onChange, step = 1, min, max, suffix, width = 56 }: {
  value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; suffix?: string; width?: number;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <input
        type="text" inputMode="decimal"
        value={isFinite(value) ? String(value) : '0'}
        onChange={(e) => { const raw = e.target.value.trim().replace(',', '.'); if (raw === '' || raw === '.' ) return; const nn = Number(raw); if (isFinite(nn)) onChange(nn); }}
        onBlur={(e) => { let nn = Number(String(e.target.value).trim().replace(',', '.')); if (!isFinite(nn)) nn = min ?? 0; if (min != null && nn < min) nn = min; if (max != null && nn > max) nn = max; onChange(nn); }}
        style={{ width, background: C.bg0, border: '1px solid ' + C.b2, color: C.t1, padding: '5px 7px', borderRadius: 5, fontSize: 12.5, fontWeight: 700, textAlign: 'right', ...NUM }}
      />
      {suffix && <span style={{ fontSize: 11, color: C.t3, fontWeight: 700 }}>{suffix}</span>}
    </span>
  );
}
