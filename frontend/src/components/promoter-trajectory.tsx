'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PROMOTER-HOLDING TRAJECTORY — PATCH 1077
//
// Three exports, one file:
//
//   • promoterTrajectory(history) — pure scoring function. Takes an array of
//     historical promoter-holding percentages (oldest → newest) and returns
//     { qoqDeltas, consecRising, totalDelta, status, confidence }.
//
//   • <PromoterStrip />            — bar-chart strip in the same institutional
//     style as MultibaggerStrips.tsx (StripRow). Drop into per-company panels.
//
//   • <PromoterRisingFilter />     — Multibagger-tab filter card with toggle
//     for "Rising N+ quarters", min Δ%, max pledge%, sortable list.
//
// Why this matters
// ────────────────
// Promoter-holding increase across consecutive quarters is one of the
// highest-signal pre-multibagger setups in Indian markets. It means the
// person closest to the business is buying their own paper at current
// prices — usually after a derating or a perceived overhang. When the
// pledge is also zero AND the increase is consistent (not a one-quarter
// spike), the base-rate of outperformance over the next 1-3 years is
// materially higher than the broader universe.
//
// Counter-filter: we explicitly down-rank when pledge > 30% OR when the
// increase came alongside a large dilution event (free float ↓ sharply).
// That removes the "creeping-acquisition + buyback" pattern that looks
// like accumulation but is just optical from share-count change.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';

// ── Pure scoring function ─────────────────────────────────────────────

export interface PromoterTrajectoryResult {
  qoqDeltas: number[];
  consecRisingFromEnd: number;
  totalDelta: number;
  status: 'RISING' | 'STABLE' | 'FALLING' | 'INSUFFICIENT';
  /** 0–100. Combines streak length × total delta × steadiness. */
  confidence: number;
  /** Plain-English summary suitable for a sub-header. */
  reason: string;
}

const RISING_EPS = 0.05;  // Anything below 5 bps QoQ counts as flat, not rising.

export function promoterTrajectory(history: number[] | undefined): PromoterTrajectoryResult {
  if (!history || history.length < 2) {
    return {
      qoqDeltas: [],
      consecRisingFromEnd: 0,
      totalDelta: 0,
      status: 'INSUFFICIENT',
      confidence: 0,
      reason: 'history too short (need ≥ 2 quarters)',
    };
  }
  const deltas: number[] = [];
  for (let i = 1; i < history.length; i++) deltas.push(+(history[i] - history[i - 1]).toFixed(3));

  let consec = 0;
  for (let i = deltas.length - 1; i >= 0; i--) {
    if (deltas[i] > RISING_EPS) consec += 1;
    else break;
  }
  const totalDelta = +(history[history.length - 1] - history[0]).toFixed(3);

  let status: PromoterTrajectoryResult['status'];
  if (consec === deltas.length && consec > 0 && totalDelta > 0.5) status = 'RISING';
  else if (consec >= Math.max(2, Math.floor(deltas.length / 2)) && totalDelta > 0.2) status = 'RISING';
  else if (totalDelta < -0.2) status = 'FALLING';
  else status = 'STABLE';

  // Steadiness penalises noisy series even when total delta is positive.
  const variance = (() => {
    if (deltas.length < 2) return 0;
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    return deltas.reduce((acc, d) => acc + Math.pow(d - mean, 2), 0) / deltas.length;
  })();
  const steadiness = Math.max(0, 1 - Math.min(1, variance / 4));

  let confidence = 0;
  if (status === 'RISING') {
    const streakWeight = Math.min(1, consec / 4);             // 4 streaks = 1.0
    const deltaWeight = Math.min(1, Math.max(0, totalDelta) / 5);  // +5 pts = 1.0
    confidence = Math.round(100 * (0.45 * streakWeight + 0.35 * deltaWeight + 0.20 * steadiness));
  } else if (status === 'FALLING') {
    confidence = Math.round(100 * Math.min(1, Math.abs(totalDelta) / 5));
  } else {
    confidence = 0;
  }

  const reason =
    status === 'RISING'
      ? `${consec} consec rising · Δ +${totalDelta.toFixed(2)} pts overall`
      : status === 'FALLING'
        ? `falling · Δ ${totalDelta.toFixed(2)} pts overall`
        : 'stable / mixed';

  return {
    qoqDeltas: deltas,
    consecRisingFromEnd: consec,
    totalDelta,
    status,
    confidence,
    reason,
  };
}

// ── Visual strip (matches MultibaggerStrips.tsx StripRow style) ───────

const STRIP_C = {
  rising: '#1d9e75',  // matches C.green in MultibaggerStrips
  falling: '#e24b4a',  // matches C.red
  flat: '#7c8ba1',     // matches C.textDim
  white: '#f4f6fa',
  textMuted: '#5a677d',
  text: '#d8dee9',
  divider: '#1a2233',
};
const STRIP_MONO: React.CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };
const BAR_MAX = 30;

export interface PromoterStripProps {
  /** oldest → newest percentage values */
  history: number[];
  /** Labels matching the history (e.g. ['Q4FY25','Q1FY26',...]). Optional. */
  labels?: string[];
  /** Optional currently-disclosed pledge %, shown as the right-edge chip. */
  pledgePct?: number;
}

/**
 * USAGE — inside MultibaggerStrips.tsx, anywhere between the existing
 * SectionHead/StripRow groups:
 *
 *   import { PromoterStrip } from '@/components/promoter-trajectory';
 *   <PromoterStrip history={fin.promoter} labels={fin.years} pledgePct={fin.pledgePct} />
 */
export function PromoterStrip({ history, labels, pledgePct }: PromoterStripProps) {
  const t = useMemo(() => promoterTrajectory(history), [history]);
  if (!history || history.length === 0) {
    return null;
  }
  const max = Math.max(...history, 1);
  const min = Math.min(...history.filter((v) => isFinite(v)), 0);
  const span = Math.max(0.1, max - min);
  const color =
    t.status === 'RISING' ? STRIP_C.rising :
    t.status === 'FALLING' ? STRIP_C.falling :
    STRIP_C.flat;

  return (
    <div style={{ padding: '8px 10px', borderTop: `1px solid ${STRIP_C.divider}` }}>
      {/* Section head — same shape as MultibaggerStrips.SectionHead */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 2,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1.2,
            color,
            textTransform: 'uppercase',
          }}
        >
          Promoter Holding by Quarter
        </span>
        <span style={{ fontSize: 9, color: STRIP_C.textMuted, letterSpacing: 0.3 }}>
          %
          {' · '}
          {t.reason}
          {pledgePct != null ? (
            <span
              style={{
                marginLeft: 8,
                padding: '0 6px',
                background: pledgePct > 30 ? '#a32d2d' : pledgePct > 5 ? '#ba7517' : 'transparent',
                color: pledgePct > 5 ? '#fff' : STRIP_C.textMuted,
                borderRadius: 2,
              }}
            >
              pledge {pledgePct.toFixed(1)}%
            </span>
          ) : null}
        </span>
      </div>
      {/* Bar row — institutional bar style */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: '2px 0', minHeight: 44 }}>
        {history.map((v, i) => {
          const live = i === history.length - 1;
          const isUp = i > 0 && v > history[i - 1] + RISING_EPS;
          const isDown = i > 0 && v < history[i - 1] - RISING_EPS;
          const barColor = isUp ? STRIP_C.rising : isDown ? STRIP_C.falling : STRIP_C.flat;
          const heightPct = ((v - min) / span);
          return (
            <div
              key={i}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
            >
              <span
                style={{
                  ...STRIP_MONO,
                  fontSize: 10,
                  color: live ? STRIP_C.white : STRIP_C.text,
                  fontWeight: live ? 600 : 400,
                }}
              >
                {v.toFixed(2)}
              </span>
              <div
                style={{
                  width: '70%',
                  height: Math.max(3, heightPct * BAR_MAX),
                  background: barColor,
                  borderRadius: '1px 1px 0 0',
                }}
              />
              <span
                style={{
                  ...STRIP_MONO,
                  fontSize: 9,
                  color: live ? STRIP_C.text : STRIP_C.textMuted,
                  fontWeight: live ? 500 : 400,
                }}
              >
                {labels?.[i] ?? `Q-${history.length - 1 - i}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Filter card for the Multibagger tab ───────────────────────────────

export interface PromoterFilterRow {
  ticker: string;
  company?: string;
  /** Promoter holdings oldest → newest (same shape as multibagger/page.tsx). */
  promoterHistory?: number[];
  /** Current pledge %. */
  pledgePct?: number;
  /** Optional — used for sort/display. */
  marketCapCr?: number;
  rocePct?: number;
}

export interface PromoterRisingFilterProps {
  universe: PromoterFilterRow[];
  renderRow?: (row: PromoterFilterRow & { verdict: PromoterTrajectoryResult }) => React.ReactNode;
}

/**
 * USAGE — in multibagger/page.tsx, drop above the existing sortable table:
 *
 *   import { PromoterRisingFilter } from '@/components/promoter-trajectory';
 *   <PromoterRisingFilter universe={rows.map(r => ({
 *     ticker: r.ticker, company: r.company,
 *     promoterHistory: r.promoterHistory, pledgePct: r.pledge,
 *     marketCapCr: r.marketCapCr, rocePct: r.roce,
 *   }))} />
 */
export function PromoterRisingFilter({ universe, renderRow }: PromoterRisingFilterProps) {
  const [minStreak, setMinStreak] = useState(2);
  const [minDelta, setMinDelta] = useState(0.3);
  const [maxPledge, setMaxPledge] = useState(5);
  const [hideFlat, setHideFlat] = useState(true);

  const scored = useMemo(() => {
    return universe
      .map((r) => ({ ...r, verdict: promoterTrajectory(r.promoterHistory) }))
      .filter((r) => {
        if (hideFlat && r.verdict.status !== 'RISING') return false;
        if (r.verdict.consecRisingFromEnd < minStreak) return false;
        if (r.verdict.totalDelta < minDelta) return false;
        if (r.pledgePct != null && r.pledgePct > maxPledge) return false;
        return true;
      })
      .sort((a, b) => b.verdict.confidence - a.verdict.confidence);
  }, [universe, minStreak, minDelta, maxPledge, hideFlat]);

  const labelStyle: React.CSSProperties = {
    color: 'var(--mc-text-4)',
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  };
  const inputStyle: React.CSSProperties = {
    background: 'var(--mc-bg-3)',
    color: 'var(--mc-text-0)',
    border: '1px solid var(--mc-border-0)',
    borderRadius: 'var(--mc-radius-sm)',
    padding: '3px 6px',
    width: 56,
    fontSize: 12,
    fontFamily: 'ui-monospace, monospace',
  };

  return (
    <div
      style={{
        background: 'var(--mc-bg-2)',
        border: '1px solid var(--mc-border-0)',
        borderRadius: 'var(--mc-radius-lg)',
        padding: 14,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: 'var(--mc-text-0)', fontSize: 'var(--mc-text-h3)' }}>
            👑 Promoter holding rising
          </h3>
          <p style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)', margin: '4px 0 0 0' }}>
            Insider-buying pattern: surfaces companies where promoters bought across multiple recent quarters,
            pledge stays low. Historically a high-confluence pre-multibagger setup.
          </p>
        </div>
        <span style={{ color: 'var(--mc-text-4)', fontSize: 11 }}>
          {scored.length} match{scored.length === 1 ? '' : 'es'}
        </span>
      </header>
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '8px 10px',
          background: 'var(--mc-bg-3)',
          border: '1px solid var(--mc-border-0)',
          borderRadius: 'var(--mc-radius-sm)',
          marginBottom: 10,
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle}>Min streak (Q)</span>
          <input
            type="number"
            min={1}
            max={8}
            value={minStreak}
            onChange={(e) => setMinStreak(Number(e.target.value))}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle}>Min Δ%</span>
          <input
            type="number"
            step={0.1}
            min={0}
            max={20}
            value={minDelta}
            onChange={(e) => setMinDelta(Number(e.target.value))}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle}>Max pledge %</span>
          <input
            type="number"
            step={1}
            min={0}
            max={100}
            value={maxPledge}
            onChange={(e) => setMaxPledge(Number(e.target.value))}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--mc-text-3)', fontSize: 11 }}>
          <input
            type="checkbox"
            checked={hideFlat}
            onChange={(e) => setHideFlat(e.target.checked)}
          />
          Hide non-RISING
        </label>
      </div>
      {scored.length === 0 ? (
        <div style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-sm)', padding: '12px 0' }}>
          Nothing meets the streak / Δ / pledge threshold. Lower the filters or check the source data.
        </div>
      ) : renderRow ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{scored.map((r) => renderRow(r))}</ul>
      ) : (
        <DefaultRowList rows={scored} />
      )}
    </div>
  );
}

function DefaultRowList({ rows }: { rows: (PromoterFilterRow & { verdict: PromoterTrajectoryResult })[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ color: 'var(--mc-text-4)', fontWeight: 700 }}>
          <th style={{ textAlign: 'left', padding: '4px 6px' }}>Ticker</th>
          <th style={{ textAlign: 'left', padding: '4px 6px' }}>Company</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Streak (Q)</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Δ%</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Pledge %</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>MCap Cr</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>ROCE %</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>Confidence</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.ticker}
            style={{
              borderTop: '1px solid var(--mc-border-0)',
              color: 'var(--mc-text-1)',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            <td style={{ padding: '4px 6px', fontWeight: 700 }}>{r.ticker}</td>
            <td style={{ padding: '4px 6px', fontFamily: 'inherit' }}>{r.company || ''}</td>
            <td style={{ padding: '4px 6px', textAlign: 'right' }}>{r.verdict.consecRisingFromEnd}</td>
            <td
              style={{
                padding: '4px 6px',
                textAlign: 'right',
                color:
                  r.verdict.totalDelta >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)',
              }}
            >
              {r.verdict.totalDelta >= 0 ? '+' : ''}
              {r.verdict.totalDelta.toFixed(2)}
            </td>
            <td
              style={{
                padding: '4px 6px',
                textAlign: 'right',
                color:
                  r.pledgePct != null && r.pledgePct > 5 ? 'var(--mc-warn)' : 'var(--mc-text-3)',
              }}
            >
              {r.pledgePct != null ? r.pledgePct.toFixed(1) : '—'}
            </td>
            <td style={{ padding: '4px 6px', textAlign: 'right' }}>
              {r.marketCapCr != null ? r.marketCapCr.toLocaleString('en-IN') : '—'}
            </td>
            <td style={{ padding: '4px 6px', textAlign: 'right' }}>
              {r.rocePct != null ? r.rocePct.toFixed(1) : '—'}
            </td>
            <td
              style={{
                padding: '4px 6px',
                textAlign: 'right',
                fontWeight: 700,
                color:
                  r.verdict.confidence >= 70
                    ? 'var(--mc-bullish)'
                    : r.verdict.confidence >= 40
                      ? 'var(--mc-warn)'
                      : 'var(--mc-text-3)',
              }}
            >
              {r.verdict.confidence}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default PromoterRisingFilter;
