'use client';

import React, { useMemo, useState } from 'react';
import {
  computeBands,
  DEFAULT_INPUTS,
  type BandInputs,
  type ScenarioResult,
} from '@/lib/valuation-bands';

// ── theme tokens (CSS vars only, for theme switching) ───────────────────────
const C = {
  bg0: 'var(--mc-bg-0)',
  bg1: 'var(--mc-bg-1)',
  bg2: 'var(--mc-bg-2)',
  bg3: 'var(--mc-bg-3)',
  bg4: 'var(--mc-bg-4)',
  t0: 'var(--mc-text-0)',
  t1: 'var(--mc-text-1)',
  t2: 'var(--mc-text-2)',
  t3: 'var(--mc-text-3)',
  t4: 'var(--mc-text-4)',
  b1: 'var(--mc-border-1)',
  b2: 'var(--mc-border-2)',
  b3: 'var(--mc-border-3)',
  bull: 'var(--mc-bullish)',
  bear: 'var(--mc-bearish)',
  warn: 'var(--mc-warn)',
  err: 'var(--mc-err)',
  info: 'var(--mc-info)',
  accent: 'var(--mc-accent)',
  cyan: 'var(--mc-cyan)',
  saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
} as const;

const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';
const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', fontFamily: MONO };

// scenario accent colours: bear=bearish, base=info, bull=bullish
const SCEN_COLOR: Record<string, string> = { bear: C.bear, base: C.info, bull: C.bull };

// ── formatting ──────────────────────────────────────────────────────────────
const rupee = (n: number | null | undefined, dp = 0) =>
  n == null || !Number.isFinite(n) ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: dp, minimumFractionDigits: dp })}`;

const cr = (n: number | null | undefined, dp = 0) =>
  n == null || !Number.isFinite(n) ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: dp })} cr`;

const pctSigned = (n: number | null | undefined, dp = 1) =>
  n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`;

const pctPlain = (n: number | null | undefined, dp = 1) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(dp)}%`;

// ── presentational atoms (mirrors the Risk desk) ────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.bg1, border: `1px solid ${C.b1}`, borderRadius: 10, padding: 16, ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, letterSpacing: 0.3 }}>{children}</div>
      {hint ? <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

function NumField({
  label, value, onChange, step = 1, min, suffix, prefix, width,
}: {
  label: string; value: number; onChange: (n: number) => void;
  step?: number; min?: number; suffix?: string; prefix?: string; width?: number;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: C.t3, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {prefix ? <span style={{ fontSize: 12, color: C.t3 }}>{prefix}</span> : null}
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          step={step}
          min={min}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          style={{
            ...NUM, width: width ?? '100%', boxSizing: 'border-box', fontSize: 13,
            background: C.bg2, color: C.t0, border: `1px solid ${C.b2}`, borderRadius: 6,
            padding: '6px 8px', outline: 'none',
          }}
        />
        {suffix ? <span style={{ fontSize: 12, color: C.t3, whiteSpace: 'nowrap' }}>{suffix}</span> : null}
      </span>
    </label>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function ValuationBandsPage() {
  const [inp, setInp] = useState<BandInputs>(DEFAULT_INPUTS);
  const set = <K extends keyof BandInputs>(k: K, v: BandInputs[K]) => setInp((p) => ({ ...p, [k]: v }));

  const model = useMemo(() => computeBands(inp), [inp]);
  const { bear, base, bull, ordered, mos, mosZone } = model;
  const multiYear = Math.max(1, inp.horizonYears) > 1;
  const marginLabel = inp.useNetMargin ? 'Net margin' : 'Op. margin';

  const mosColor =
    mosZone.tone === 'good' ? C.bull : mosZone.tone === 'bad' ? C.err : mosZone.tone === 'warn' ? C.warn : C.info;

  return (
    <div style={{ background: C.bg0, minHeight: '100%', padding: 20, color: C.t1, fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.t0, letterSpacing: -0.3 }}>
              Valuation Scenario Bands
            </h1>
            <div style={{ fontSize: 13, color: C.t3, marginTop: 4 }}>
              A fast bear / base / bull fair-value calculator with a margin-of-safety gauge — enter a few forward inputs and see conservative, base and optimistic target prices against today&apos;s price.
            </div>
          </div>
          {inp.ticker ? (
            <div style={{ ...NUM, fontSize: 13, color: C.t2, textAlign: 'right' }}>
              <span style={{ fontWeight: 700, color: C.t0 }}>{inp.ticker.toUpperCase()}</span>
              <span style={{ color: C.t3 }}> · {rupee(inp.currentPrice, 2)}</span>
            </div>
          ) : null}
        </div>

        {/* ── INPUTS ──────────────────────────────────────────────────────── */}
        <Card style={{ marginTop: 16 }}>
          <SectionTitle hint="All fields editable. Forward revenue is the primary driver; margins and P/E set the scenario spread.">
            Forward inputs
          </SectionTitle>

          {/* row 1: identity + price */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: C.t3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Company / ticker</span>
              <input
                type="text"
                value={inp.ticker}
                placeholder="optional label"
                onChange={(e) => set('ticker', e.target.value)}
                style={{ fontFamily: MONO, fontSize: 13, background: C.bg2, color: C.t0, border: `1px solid ${C.b2}`, borderRadius: 6, padding: '6px 8px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
              />
            </label>
            <NumField label="Current price" prefix="₹" value={inp.currentPrice} step={1} min={0} onChange={(n) => set('currentPrice', n)} />
            <NumField label="Shares out." suffix="cr" value={inp.shares} step={1} min={0} onChange={(n) => set('shares', n)} />
            <NumField label="Fwd revenue" suffix="₹cr" value={inp.fwdRevenue} step={100} min={0} onChange={(n) => set('fwdRevenue', n)} />
          </div>

          {/* row 2: margins */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
            <NumField label={`${marginLabel} (base)`} suffix="%" value={inp.opmBase} step={0.5} onChange={(n) => set('opmBase', n)} />
            <NumField label="Bear Δ margin" suffix="pp" value={inp.opmBearDelta} step={0.5} onChange={(n) => set('opmBearDelta', n)} />
            <NumField label="Bull Δ margin" suffix="pp" value={inp.opmBullDelta} step={0.5} onChange={(n) => set('opmBullDelta', n)} />
            <NumField
              label="Tax rate"
              suffix="%"
              value={inp.taxRate}
              step={1}
              min={0}
              onChange={(n) => set('taxRate', n)}
            />
          </div>

          {/* net-margin toggle */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 12, color: C.t2, cursor: 'pointer' }}>
            <input type="checkbox" checked={inp.useNetMargin} onChange={(e) => set('useNetMargin', e.target.checked)} />
            <span>
              Treat the margin as a <strong style={{ color: C.t1 }}>net margin</strong> (PAT = revenue × margin, tax ignored).
              {inp.useNetMargin ? <span style={{ color: C.t3 }}> Tax rate is not applied.</span> : <span style={{ color: C.t3 }}> EBIT route: PAT = EBIT × (1 − tax).</span>}
            </span>
          </label>

          {/* row 3: exit P/E band */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
            <NumField label="Exit P/E · bear" value={inp.peBear} step={1} min={0} onChange={(n) => set('peBear', n)} />
            <NumField label="Exit P/E · base" value={inp.peBase} step={1} min={0} onChange={(n) => set('peBase', n)} />
            <NumField label="Exit P/E · bull" value={inp.peBull} step={1} min={0} onChange={(n) => set('peBull', n)} />
          </div>

          {/* row 4: horizon */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
            <NumField label="Horizon" suffix="yr" value={inp.horizonYears} step={1} min={1} onChange={(n) => set('horizonYears', n)} />
            <NumField label="Revenue CAGR" suffix="%" value={inp.revenueCagr} step={1} onChange={(n) => set('revenueCagr', n)} />
            <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ fontSize: 11, color: C.t4, lineHeight: 1.5 }}>
                {multiYear
                  ? `Horizon > 1yr: forward revenue is compounded at the CAGR to the exit year (×${Math.pow(1 + inp.revenueCagr / 100, Math.max(1, inp.horizonYears) - 1).toFixed(2)}), and an implied annualised return is shown.`
                  : 'Horizon = 1yr: targets use the forward-year revenue directly. Raise the horizon to project a multi-year exit.'}
              </div>
            </div>
          </div>
        </Card>

        {!model.valid ? (
          <div style={{ marginTop: 12, padding: '10px 12px', background: C.bg2, border: `1px solid ${C.warn}`, borderRadius: 8, color: C.warn, fontSize: 12 }}>
            Enter a positive current price, shares outstanding and forward revenue to price the scenarios.
          </div>
        ) : null}

        {/* ── PLAIN READ-OUT ──────────────────────────────────────────────── */}
        <Card style={{ marginTop: 16, borderColor: mosColor }}>
          <div style={{ fontSize: 15, color: C.t0, lineHeight: 1.55, fontWeight: 500 }}>
            {model.valid ? (
              <>
                Base case <strong style={{ ...NUM, color: C.info }}>{rupee(base.target, 0)}</strong>{' '}
                (<span style={{ ...NUM, color: base.upsidePct >= 0 ? C.bull : C.bear }}>{pctSigned(base.upsidePct)}</span>
                {multiYear && base.annualisedPct != null ? <span style={{ color: C.t3 }}>, {pctSigned(base.annualisedPct)}/yr</span> : null});
                you&apos;re paying a{' '}
                <strong style={{ ...NUM, color: mosColor }}>
                  {mos >= 0 ? `${(mos * 100).toFixed(0)}% discount` : `${Math.abs(mos * 100).toFixed(0)}% premium`}
                </strong>{' '}
                to base fair value. Range {rupee(model.bandMin, 0)} – {rupee(model.bandMax, 0)}.
              </>
            ) : (
              <span style={{ color: C.t3 }}>Awaiting valid inputs…</span>
            )}
          </div>
        </Card>

        {/* ── TARGET PRICE BAND ───────────────────────────────────────────── */}
        <Card style={{ marginTop: 16 }}>
          <SectionTitle hint="Bear / base / bull target prices with today's price marked. Instantly shows where price sits in the range.">
            Target price band
          </SectionTitle>
          <PriceBand model={model} current={inp.currentPrice} />
        </Card>

        {/* ── SCENARIO COLUMNS ────────────────────────────────────────────── */}
        <Card style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 16, paddingBottom: 8 }}>
            <SectionTitle hint={`Every step shown so the maths is auditable: revenue → EBIT → PAT → EPS → target. ${inp.useNetMargin ? 'Net-margin route (no tax step).' : `EBIT route, ${pctPlain(inp.taxRate, 0)} tax.`}`}>
              Scenario chains — Bear / Base / Bull
            </SectionTitle>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 520 }}>
              <thead>
                <tr style={{ background: C.bg3, color: C.t3 }}>
                  <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600 }}>Step</th>
                  {ordered.map((s) => (
                    <th key={s.key} style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: SCEN_COLOR[s.key], whiteSpace: 'nowrap' }}>
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <ChainRow label={`${marginLabel} used`} render={(s) => pctPlain(s.opm)} ordered={ordered} sub />
                <ChainRow label={multiYear ? `Revenue (yr ${inp.horizonYears})` : 'Forward revenue'} render={(s) => cr(s.revenue)} ordered={ordered} />
                <ChainRow label={inp.useNetMargin ? 'EBIT (= net base)' : 'EBIT (rev × opm)'} render={(s) => cr(s.ebit)} ordered={ordered} />
                <ChainRow label={inp.useNetMargin ? 'PAT (= rev × net%)' : 'PAT (after tax)'} render={(s) => cr(s.pat)} ordered={ordered} />
                <ChainRow label="EPS (PAT / shares)" render={(s) => rupee(s.eps, 2)} ordered={ordered} />
                <ChainRow label="Exit P/E" render={(s) => `${s.pe.toFixed(0)}×`} ordered={ordered} sub />
                <ChainRow
                  label="Target price (EPS × P/E)"
                  render={(s) => rupee(s.target, 0)}
                  ordered={ordered}
                  strong
                />
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── UPSIDE TABLE ────────────────────────────────────────────────── */}
        <Card style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 16, paddingBottom: 8 }}>
            <SectionTitle hint={multiYear ? `Upside vs current price, plus the implied annualised return over ${inp.horizonYears} years.` : 'Upside vs current price. Raise the horizon to also show an annualised return.'}>
              Upside vs current
            </SectionTitle>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 460 }}>
              <thead>
                <tr style={{ background: C.bg3, color: C.t3 }}>
                  {['Scenario', 'Target', 'Upside %', ...(multiYear ? ['Annualised'] : [])].map((h, i) => (
                    <th key={h} style={{ padding: '8px 14px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((s) => (
                  <tr key={s.key} style={{ borderTop: `1px solid ${C.b3}` }}>
                    <td style={{ padding: '9px 14px', fontWeight: 700, color: SCEN_COLOR[s.key], whiteSpace: 'nowrap' }}>{s.label}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: C.t1, ...NUM }}>{rupee(s.target, 0)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: s.upsidePct >= 0 ? C.bull : C.bear, fontWeight: 600, ...NUM }}>{pctSigned(s.upsidePct)}</td>
                    {multiYear ? (
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: s.annualisedPct == null ? C.t4 : s.annualisedPct >= 0 ? C.bull : C.bear, ...NUM }}>
                        {s.annualisedPct == null ? '—' : `${pctSigned(s.annualisedPct)}/yr`}
                      </td>
                    ) : null}
                  </tr>
                ))}
                <tr style={{ borderTop: `1px solid ${C.b2}`, background: C.bg2 }}>
                  <td style={{ padding: '9px 14px', color: C.t3, whiteSpace: 'nowrap' }}>Current price</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: C.t2, ...NUM }}>{rupee(inp.currentPrice, 0)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: C.t4, ...NUM }}>—</td>
                  {multiYear ? <td style={{ padding: '9px 14px' }} /> : null}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── MARGIN-OF-SAFETY GAUGE ──────────────────────────────────────── */}
        <Card style={{ marginTop: 16 }}>
          <SectionTitle hint="MoS = (base target − current) / base target. Green >30%, blue 10–30%, amber 0–10%, red overvalued.">
            Margin of safety vs base fair value
          </SectionTitle>
          <MosGauge mos={mos} color={mosColor} label={mosZone.label} valid={model.valid} />
        </Card>

        <div style={{ fontSize: 11, color: C.t4, marginTop: 14, lineHeight: 1.5 }}>
          A quick scenario view — it complements, and does not replace, a detailed fair-value model. Targets are EPS × exit-P/E on your forward assumptions;
          bear/base/bull differ only by the operating-margin delta and the exit multiple you set. EPS uses shares in crore and PAT in ₹ crore, so ₹cr ÷ cr-shares = ₹/share.
          Not investment advice.
        </div>
      </div>
    </div>
  );
}

// ── a single row of the scenario chain table ────────────────────────────────
function ChainRow({
  label, render, ordered, strong, sub,
}: {
  label: string;
  render: (s: ScenarioResult) => React.ReactNode;
  ordered: ScenarioResult[];
  strong?: boolean;
  sub?: boolean;
}) {
  const cells = ordered;
  return (
    <tr style={{ borderTop: `1px solid ${C.b3}`, background: strong ? C.bg2 : 'transparent' }}>
      <td style={{ padding: strong ? '11px 14px' : '8px 14px', color: sub ? C.t3 : C.t2, fontSize: sub ? 11.5 : 12.5, whiteSpace: 'nowrap' }}>{label}</td>
      {cells.map((s) => (
        <td
          key={s.key}
          style={{
            padding: strong ? '11px 14px' : '8px 14px',
            textAlign: 'right',
            ...NUM,
            fontWeight: strong ? 700 : sub ? 400 : 500,
            fontSize: strong ? 14 : 12.5,
            color: strong ? SCEN_COLOR[s.key] : sub ? C.t3 : C.t1,
          }}
        >
          {render(s)}
        </td>
      ))}
    </tr>
  );
}

// ── horizontal target-price band with a current-price marker ────────────────
function PriceBand({ model, current }: { model: ReturnType<typeof computeBands>; current: number }) {
  const { bandMin, bandMax, ordered } = model;
  const span = bandMax - bandMin;
  const H = 64;
  const padX = 4; // % padding at each end so end labels don't clip

  // map a value to an x% within the drawn track (padded)
  const xOf = (v: number) => {
    const f = span > 0 ? (v - bandMin) / span : 0.5;
    return padX + Math.min(1, Math.max(0, f)) * (100 - padX * 2);
  };
  const currentClamped = Math.min(bandMax, Math.max(bandMin, current));
  const inRange = current >= bandMin && current <= bandMax;

  return (
    <div>
      <div style={{ position: 'relative', height: H, marginTop: 8 }}>
        {/* gradient track: bear (red) → base (blue) → bull (green) */}
        <div
          style={{
            position: 'absolute', top: H / 2 - 7, left: `${padX}%`, right: `${padX}%`, height: 14,
            borderRadius: 7,
            background: `linear-gradient(90deg, ${C.bear}, ${C.warn} 32%, ${C.info} 50%, ${C.bull})`,
            opacity: 0.85,
          }}
        />
        {/* scenario tick markers */}
        {ordered.map((s) => {
          const x = xOf(s.target);
          return (
            <div key={s.key} style={{ position: 'absolute', top: 0, left: `${x}%`, transform: 'translateX(-50%)', textAlign: 'center', width: 90 }}>
              <div style={{ fontSize: 10, color: SCEN_COLOR[s.key], fontWeight: 700, letterSpacing: 0.4 }}>{s.label.toUpperCase()}</div>
              <div style={{ width: 2, height: 10, background: SCEN_COLOR[s.key], margin: '2px auto 0' }} />
              <div style={{ ...NUM, fontSize: 11.5, color: C.t1, fontWeight: 600, marginTop: H / 2 - 2 }}>{rupee(s.target, 0)}</div>
            </div>
          );
        })}
        {/* current-price marker */}
        <div
          style={{
            position: 'absolute', top: H / 2 - 14, left: `${xOf(currentClamped)}%`, transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}
        >
          <div style={{ width: 2, height: 28, background: C.t0 }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: C.t0, border: `2px solid ${C.bg1}`, marginTop: -7 }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <span style={{ ...NUM, fontSize: 12, color: C.t2 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: C.t0, marginRight: 6, verticalAlign: 'middle' }} />
          Current {rupee(current, 0)}
          {!inRange ? <span style={{ color: C.warn }}> · {current < bandMin ? 'below the bear target' : 'above the bull target'}</span> : null}
        </span>
      </div>
    </div>
  );
}

// ── margin-of-safety gauge (zoned horizontal bar) ───────────────────────────
function MosGauge({ mos, color, label, valid }: { mos: number; color: string; label: string; valid: boolean }) {
  // scale runs from -50% (overvalued) to +60% (deep MoS); clamp the pointer within it.
  const LO = -0.5;
  const HI = 0.6;
  const clamp01 = (f: number) => Math.min(1, Math.max(0, f));
  const posOf = (m: number) => clamp01((m - LO) / (HI - LO)) * 100;
  const pointer = valid && Number.isFinite(mos) ? posOf(mos) : posOf(0);

  // zone boundaries as % of the track
  const zeroX = posOf(0);
  const someX = posOf(0.1);
  const largeX = posOf(0.3);

  const pctText = valid && Number.isFinite(mos) ? `${mos >= 0 ? '+' : ''}${(mos * 100).toFixed(1)}%` : '—';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ ...NUM, fontSize: 32, fontWeight: 800, color }}>{pctText}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{label}</span>
      </div>

      <div style={{ position: 'relative', height: 22, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.b1}`, display: 'flex' }}>
        <div style={{ width: `${zeroX}%`, background: C.err, opacity: 0.55 }} />
        <div style={{ width: `${someX - zeroX}%`, background: C.warn, opacity: 0.55 }} />
        <div style={{ width: `${largeX - someX}%`, background: C.info, opacity: 0.55 }} />
        <div style={{ width: `${100 - largeX}%`, background: C.bull, opacity: 0.55 }} />
      </div>

      {/* pointer */}
      <div style={{ position: 'relative', height: 0 }}>
        <div style={{ position: 'absolute', top: -22, left: `${pointer}%`, transform: 'translateX(-50%)', width: 3, height: 22, background: C.t0 }} />
        <div style={{ position: 'absolute', top: 0, left: `${pointer}%`, transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `6px solid ${C.t0}` }} />
      </div>

      {/* zone legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 11, color: C.t3, ...NUM }}>
        <span style={{ color: C.err }}>&lt;0% overvalued</span>
        <span style={{ color: C.warn }}>0–10% slim</span>
        <span style={{ color: C.info }}>10–30% some</span>
        <span style={{ color: C.bull }}>&gt;30% large</span>
      </div>
    </div>
  );
}
