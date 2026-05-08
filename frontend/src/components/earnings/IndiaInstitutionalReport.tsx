'use client';

import React from 'react';
import { EarningsSnapshot, IndiaExtras, ThemeStrength } from '@/lib/earnings/snapshot';
import { ConcallUploadModal } from './ConcallUploadModal';
import { useTheme } from '@/contexts/ThemeContext';

// ─────────────────────────────────────────────────────────────────────────────
// IndiaInstitutionalReport — fundamentals-driven layout
// ─────────────────────────────────────────────────────────────────────────────
// Distinct from the US InstitutionalReport. Designed for Indian midcaps where
// consensus coverage is sparse and what matters is:
//   - QoQ / YoY trajectory (not vs estimates)
//   - Working capital cycle
//   - Promoter / governance signals
//   - Sector-specific KPIs (FMCG / Banks / IT etc)
//   - Macro themes (rural recovery, China+1, capex cycle, etc)
// ─────────────────────────────────────────────────────────────────────────────

const BG     = '#0a0a0f';
const PANEL  = '#0f0f17';
const PANEL2 = '#13131c';
const BORDER = 'rgba(255,255,255,0.06)';
const BORDER2 = 'rgba(255,255,255,0.10)';
const TEXT   = '#e6e9ef';
const MUTED  = '#7a8599';
const FAINT  = '#475569';
const ACCENT = '#fbbf24'; // amber for India branding
const SAFFRON = '#fb923c';
const GREEN  = '#10b981';
const GREEN2 = '#34d399';
const RED    = '#ef4444';
const ORANGE = '#f97316';
const YELLOW = '#f59e0b';
const TEAL   = '#2dd4bf';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

// ── Formatters ───────────────────────────────────────────────────────────
function fmtCr(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L Cr`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K Cr`;
  return `${sign}₹${abs.toFixed(digits)} Cr`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtBps(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${Math.round(v)} bps`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtDays(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${Math.round(v)} d`;
}

function fmtRupees(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `₹${v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function colorForChange(v: number | null | undefined, threshold = 0): string {
  if (v === null || v === undefined) return FAINT;
  if (v >= threshold + 0.5) return GREEN;
  if (v > threshold) return GREEN2;
  if (v < threshold - 0.5) return RED;
  if (v < threshold) return ORANGE;
  return MUTED;
}

const STRENGTH_COLOR: Record<ThemeStrength, string> = {
  high: GREEN,
  medium: YELLOW,
  low: MUTED,
  none: FAINT,
};

const TONE_LABEL: Record<string, { label: string; color: string }> = {
  very_bullish:  { label: 'Very Bullish', color: GREEN },
  constructive:  { label: 'Constructive', color: GREEN2 },
  neutral:       { label: 'Neutral', color: MUTED },
  cautious:      { label: 'Cautious', color: YELLOW },
  defensive:     { label: 'Defensive', color: ORANGE },
  distressed:    { label: 'Distressed', color: RED },
};

// ── Component ────────────────────────────────────────────────────────────
export interface IndiaInstitutionalReportProps {
  snapshot: EarningsSnapshot;
  onReset?: () => void;
  onCopy?: () => void;
  /** When provided, the report shows an "Upload concall" button that opens
   *  a paste-text modal. Caller is responsible for re-running the snapshot
   *  builder with the supplied transcript so guidance / tone get filled in. */
  onConcallText?: (text: string) => void;
  concallProcessing?: boolean;
}

export function IndiaInstitutionalReport({
  snapshot: s,
  onReset,
  onCopy,
  onConcallText,
  concallProcessing,
}: IndiaInstitutionalReportProps) {
  // Theme palette — overrides the module-level dark defaults so the report
  // re-renders in the active theme (dark / light / professional).
  const { palette } = useTheme();
  const BG = palette.BG;
  const PANEL = palette.PANEL;
  const PANEL2 = palette.PANEL2;
  const BORDER = palette.BORDER;
  const BORDER2 = palette.BORDER2;
  const TEXT = palette.TEXT;
  const MUTED = palette.MUTED;
  const FAINT = palette.FAINT;
  const ACCENT = palette.ACCENT;
  const SAFFRON = palette.SAFFRON;
  const GREEN = palette.GREEN;
  const ORANGE = palette.ORANGE;
  const FONT = palette.FONT;
  const MONO = palette.MONO;

  const [showConcallModal, setShowConcallModal] = React.useState(false);
  const ix: IndiaExtras | undefined = s.indiaExtras;
  if (!ix) {
    return (
      <div style={{ background: BG, padding: 24, color: TEXT, fontFamily: FONT }}>
        India institutional report unavailable — no IndiaExtras payload.
      </div>
    );
  }
  const tone = TONE_LABEL[s.qualitative.mgmtTone] ?? TONE_LABEL.neutral;
  const fs = ix.fundamentalScore;
  const lastQ = ix.quarterlyTrend.at(-1);
  const wc = ix.workingCapital;
  const gov = ix.governance;

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, fontFamily: FONT, padding: '24px 20px', maxWidth: 1280, margin: '0 auto' }}>

      {/* ═══════════════════════════════════════════════════════════════════
          A. HEADER — India branding + identity + ₹ Cr formatting
         ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 6, paddingBottom: 14, borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: TEXT, margin: 0, letterSpacing: '-0.5px' }}>{s.company}</h1>
            <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT, background: 'rgba(251,191,36,0.10)', padding: '3px 9px', borderRadius: 4, fontFamily: MONO }}>
              {s.ticker}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 12, color: MUTED }}>
            <span style={{ fontWeight: 600, color: TEXT }}>{s.quarter}</span>
            <span style={{ color: FAINT }}>·</span>
            <span>{s.filingType}</span>
            <span style={{ color: FAINT }}>·</span>
            <span style={{ fontFamily: MONO }}>₹ Cr</span>
            <span style={{ color: FAINT }}>·</span>
            <span>{ix.sector.displayName}</span>
            {ix.sector.industryString && <><span style={{ color: FAINT }}>·</span><span>{ix.sector.industryString}</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, fontSize: 11 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <Stat label="Market Cap" value={fmtCr(ix.topMetrics.marketCapCr)} />
            <Stat label="CMP" value={fmtRupees(ix.topMetrics.cmp)} />
            <Stat label="P/E" value={fmtNum(ix.topMetrics.peRatio, 1)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Pill label="Tone" value={tone.label} color={tone.color} />
            <Pill label="Promoter" value={ix.topMetrics.promoterHoldingPct !== null ? `${ix.topMetrics.promoterHoldingPct.toFixed(1)}%` : '—'} color={ACCENT} />
          </div>
          {(onCopy || onReset) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {onCopy && <button onClick={onCopy} style={btnSec()}>Copy summary</button>}
              <button
                onClick={async () => {
                  try {
                    const { exportIndiaReportPdf } = await import('@/lib/earnings/india-pdf-export');
                    await exportIndiaReportPdf(s);
                  } catch (e: any) {
                    console.error('PDF export failed:', e);
                    alert('PDF export failed: ' + (e?.message || 'unknown error'));
                  }
                }}
                style={{ ...btnSec(), background: ACCENT, color: BG, fontWeight: 700 }}
                title="Download institutional PDF report"
              >
                ↓ PDF
              </button>
              {onReset && <button onClick={onReset} style={btnSec()}>New analysis</button>}
            </div>
          )}
        </div>
      </div>

      {/* ── STALENESS BANNER — red warning when source data is > 9 months old ── */}
      {ix.staleness?.isStale && (
        <div style={{ marginTop: 14, marginBottom: 4, background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 6, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <div style={{ flex: 1, color: '#fecaca', fontSize: 12, lineHeight: 1.5 }}>
            <strong style={{ color: '#fef2f2', fontSize: 13 }}>STALE DATA WARNING</strong>
            <span style={{ marginLeft: 8 }}>
              Latest reported period is <strong style={{ color: '#fef2f2' }}>{ix.staleness.latestPeriod}</strong>
              {ix.staleness.monthsOld !== null && (
                <> — that is <strong style={{ color: '#fef2f2' }}>{ix.staleness.monthsOld} months</strong> old.</>
              )}
              {' '}The upstream source has not been updated. Verify the ticker symbol; if correct, the company may have been delisted, renamed, or has a non-standard slug on Screener.in. Treat numbers below as historical, not current.
            </span>
          </div>
        </div>
      )}

      {/* ── ONE-LINE INSTITUTIONAL VERDICT — what to do at a glance ── */}
      {ix.topLine && (() => {
        const v = ix.topLine.verdict;
        const verdictColor =
          v === 'BUY' ? GREEN : v === 'ACCUMULATE' ? '#86efac' : v === 'HOLD' ? '#fbbf24' :
          v === 'NEUTRAL' ? MUTED : v === 'AVOID' ? '#fb923c' : '#f87171';
        const fwd = ix.topLine.forwardLook;
        const fwdColor = fwd
          ? fwd.grade === 'very_positive' ? GREEN
            : fwd.grade === 'positive' ? '#86efac'
            : fwd.grade === 'mixed' ? '#fbbf24'
            : fwd.grade === 'cautious' ? '#fb923c'
            : fwd.grade === 'weak' ? '#f87171'
            : MUTED
          : MUTED;
        return (
          <div style={{ marginTop: 14, marginBottom: 10, background: PANEL, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${verdictColor}`, borderRadius: 6, padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: verdictColor, fontFamily: MONO, letterSpacing: 1, padding: '3px 10px', borderRadius: 4, background: `${verdictColor}15`, border: `1px solid ${verdictColor}40` }}>
                {v}
              </span>
              {fwd && (
                <span
                  title={fwd.evidence}
                  style={{ fontSize: 11, fontWeight: 800, color: fwdColor, fontFamily: MONO, letterSpacing: 0.8, padding: '3px 10px', borderRadius: 4, background: `${fwdColor}15`, border: `1px solid ${fwdColor}40`, cursor: 'help' }}
                >
                  FORWARD: {fwd.label}
                </span>
              )}
              <span style={{ fontSize: 14, fontWeight: 700, color: TEXT, lineHeight: 1.4, flex: 1, minWidth: 0 }}>
                {ix.topLine.headline}
              </span>
            </div>
            {fwd && (
              <div style={{ fontSize: 11, color: fwdColor, marginTop: 6, lineHeight: 1.5, fontWeight: 500 }}>
                ▶ Forward outlook: <strong>{fwd.label.toLowerCase()}</strong> — {fwd.evidence}
              </div>
            )}
            <div style={{ fontSize: 12, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>
              {ix.topLine.rationale}
              {ix.topLine.watchPoints.length > 0 && (
                <>
                  <span style={{ color: FAINT }}> · </span>
                  <strong style={{ color: ACCENT, fontWeight: 600 }}>Watch:</strong>
                  <span> {ix.topLine.watchPoints.join(' · ')}</span>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Banner removed — the top-line verdict card above is the institutional signal */}
      <div style={{ marginBottom: 14 }} />

      {/* ═══════════════════════════════════════════════════════════════════
          B. LATEST QUARTER AT A GLANCE — QoQ + YoY (no consensus column)
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Latest Quarter" subtitle={`${lastQ?.period || s.quarter} · QoQ + YoY trajectory`} />
      <div style={{ overflowX: 'auto', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, marginBottom: 22 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER2}`, background: PANEL2 }}>
              <Th>Metric</Th>
              <Th right>Latest</Th>
              <Th right>QoQ Δ</Th>
              <Th right>YoY Δ</Th>
            </tr>
          </thead>
          <tbody>
            <IndiaMetricRow label="Revenue" value={fmtCr(lastQ?.revenue)} qoq={lastQ?.qoqRevenuePct} yoy={lastQ?.yoyRevenuePct} />
            <IndiaMetricRow label="Operating Profit" value={fmtCr(lastQ?.operatingProfit)} qoq={lastQ?.qoqOpProfitPct} yoy={lastQ?.yoyOpProfitPct} />
            <IndiaMetricRow label="OPM (Operating Margin)" value={lastQ?.opmPct != null ? `${lastQ.opmPct.toFixed(1)}%` : '—'} qoq={lastQ?.qoqOpmBps} qoqAsBps yoy={lastQ?.yoyOpmBps} yoyAsBps />
            <IndiaMetricRow label="Net Profit (PAT)" value={fmtCr(lastQ?.netProfit)} qoq={lastQ?.qoqProfitPct} yoy={lastQ?.yoyProfitPct} />
            <IndiaMetricRow label="Net Margin" value={lastQ?.netMarginPct != null ? `${lastQ.netMarginPct.toFixed(1)}%` : '—'} qoq={lastQ?.qoqNetMarginBps} qoqAsBps yoy={lastQ?.yoyNetMarginBps} yoyAsBps />
            <IndiaMetricRow label="EPS" value={lastQ?.eps != null ? `₹${lastQ.eps.toFixed(2)}` : '—'} qoq={lastQ?.qoqEpsPct} yoy={lastQ?.yoyEpsPct} />
          </tbody>
        </table>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          C. KEY TAKEAWAYS + FUNDAMENTAL SCORE
         ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 22 }}>
        <Panel title="Key Takeaways">
          {s.qualitative.keyTakeaways.length === 0 ? (
            <Empty>No deterministic takeaways from available data.</Empty>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, color: TEXT, fontSize: 13, lineHeight: 1.75 }}>
              {s.qualitative.keyTakeaways.map((t, i) => (<li key={i}>{t}</li>))}
            </ul>
          )}
        </Panel>
        <Panel title="Fundamental Health">
          <div style={{ textAlign: 'center', padding: '4px 0' }}>
            <div style={{ fontSize: 38, fontWeight: 800, color: scoreColor(fs.overall), fontFamily: MONO, lineHeight: 1 }}>
              {fs.overall}<span style={{ fontSize: 14, color: MUTED }}>/100</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor(fs.overall), letterSpacing: 0.5, marginTop: 2 }}>
              {fs.grade} · {fs.direction.toUpperCase()}
            </div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>
              Confidence: <span style={{ color: TEXT, fontWeight: 600 }}>{fs.confidence}</span>
            </div>
            <div style={{ fontSize: 10, color: SAFFRON, marginTop: 8, fontStyle: 'italic' }}>
              Composite of: growth · margin · WC · promoter · cash conversion
            </div>
          </div>
        </Panel>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          D. FUNDAMENTAL COMPONENT BREAKDOWN
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Fundamental Components" subtitle="Deterministic — no consensus required" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 22 }}>
        <ComponentCard title="Revenue Growth" score={fs.components.growth.score} label={fs.components.growth.label} />
        <ComponentCard title="Margin Trajectory" score={fs.components.margin.score} label={fs.components.margin.label} />
        <ComponentCard title="Working Capital" score={fs.components.working_capital.score} label={fs.components.working_capital.label} />
        <ComponentCard title="Promoter Signal" score={fs.components.promoter.score} label={fs.components.promoter.label} />
        <ComponentCard title="Cash Conversion" score={fs.components.cash_conversion.score} label={fs.components.cash_conversion.label} />
        {fs.components.forward && (
          <ComponentCard title="Forward Outlook" score={fs.components.forward.score} label={fs.components.forward.label} />
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          E. 8-QUARTER TREND TABLE
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Quarterly Trend (8Q)" subtitle="Sales / OPM / PAT / EPS · QoQ and YoY %" />
      <div style={{ overflowX: 'auto', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, marginBottom: 22 }}>
        {ix.quarterlyTrend.length === 0 ? (
          <div style={{ padding: 14 }}><Empty>No quarterly trend extracted from Screener.</Empty></div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER2}`, color: MUTED, background: PANEL2 }}>
                <Th sm>Period</Th>
                <Th sm right>Revenue</Th>
                <Th sm right>YoY%</Th>
                <Th sm right>Op Profit</Th>
                <Th sm right>OP YoY%</Th>
                <Th sm right>OPM%</Th>
                <Th sm right>OPM YoY</Th>
                <Th sm right>PAT</Th>
                <Th sm right>QoQ%</Th>
                <Th sm right>YoY%</Th>
                <Th sm right>EPS</Th>
                <Th sm right>YoY%</Th>
              </tr>
            </thead>
            <tbody>
              {ix.quarterlyTrend.map((q) => (
                <tr key={q.period} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <Td>{q.period}</Td>
                  <Td right mono>{fmtCr(q.revenue, 0)}</Td>
                  <Td right mono color={colorForChange(q.yoyRevenuePct)}>{fmtPct(q.yoyRevenuePct)}</Td>
                  <Td right mono>{fmtCr(q.operatingProfit, 0)}</Td>
                  <Td right mono color={colorForChange(q.yoyOpProfitPct)}>{fmtPct(q.yoyOpProfitPct)}</Td>
                  <Td right mono>{q.opmPct != null ? `${q.opmPct.toFixed(0)}%` : '—'}</Td>
                  <Td right mono color={colorForChange(q.yoyOpmBps)}>{fmtBps(q.yoyOpmBps)}</Td>
                  <Td right mono>{fmtCr(q.netProfit, 0)}</Td>
                  <Td right mono color={colorForChange(q.qoqProfitPct)}>{fmtPct(q.qoqProfitPct)}</Td>
                  <Td right mono color={colorForChange(q.yoyProfitPct)}>{fmtPct(q.yoyProfitPct)}</Td>
                  <Td right mono>{q.eps != null ? `₹${q.eps.toFixed(1)}` : '—'}</Td>
                  <Td right mono color={colorForChange(q.yoyEpsPct)}>{fmtPct(q.yoyEpsPct)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          E2. CONCALL INSIGHTS — only renders when transcript was uploaded
         ═══════════════════════════════════════════════════════════════════ */}
      {ix.concall && (
        <>
          <SectionTitle
            title="Concall Insights"
            subtitle={`${ix.concall.charsAnalyzed.toLocaleString()} chars analysed · ${ix.concall.topQuotes.length} key quotes · ${ix.concall.toneSignals.length} tone signals`}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 22 }}>
            {/* Top quotes */}
            <Panel title={`Top Quotes (ranked by signal density)`}>
              {ix.concall.topQuotes.length === 0 ? (
                <Empty>No high-signal quotes extracted. Try a longer transcript.</Empty>
              ) : (
                <ol style={{ margin: 0, paddingLeft: 22, color: TEXT, fontSize: 12, lineHeight: 1.7 }}>
                  {ix.concall.topQuotes.map((q, i) => (
                    <li key={i} style={{ marginBottom: 8, fontStyle: 'italic' }}>"{q}"</li>
                  ))}
                </ol>
              )}
            </Panel>
            {/* Concall score */}
            <Panel title="Concall Score">
              <div style={{ textAlign: 'center', padding: '4px 0' }}>
                <div style={{ fontSize: 38, fontWeight: 800, color: scoreColor(ix.concall.concallScore), fontFamily: MONO, lineHeight: 1 }}>
                  {ix.concall.concallScore}<span style={{ fontSize: 14, color: MUTED }}>/100</span>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: scoreColor(ix.concall.concallScore), letterSpacing: 0.5, marginTop: 2 }}>
                  {ix.concall.concallGrade}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 10, fontSize: 10, fontFamily: MONO }}>
                  <span style={{ color: GREEN }}>+{ix.concall.positiveCount}</span>
                  <span style={{ color: ACCENT }}>~{ix.concall.cautiousCount}</span>
                  <span style={{ color: ORANGE }}>−{ix.concall.negativeCount}</span>
                </div>
                <div style={{ fontSize: 9, color: MUTED, marginTop: 6, lineHeight: 1.4 }}>
                  positive · cautious · negative cues
                </div>
              </div>
            </Panel>
          </div>

          {/* Tone signals */}
          {ix.concall.toneSignals.length > 0 && (
            <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14, marginBottom: 22 }}>
              <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 10 }}>
                Tone Signals
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ix.concall.toneSignals.map((t, i) => {
                  const color = t.sentiment === 'positive' ? GREEN : t.sentiment === 'negative' ? ORANGE : ACCENT;
                  return (
                    <span
                      key={i}
                      title={t.context}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color,
                        border: `1px solid ${color}40`,
                        background: `${color}10`,
                        padding: '4px 10px',
                        borderRadius: 999,
                        cursor: 'help',
                      }}
                    >
                      {t.sentiment === 'positive' ? '↑ ' : t.sentiment === 'negative' ? '↓ ' : '~ '}
                      {t.phrase}
                    </span>
                  );
                })}
              </div>
              <div style={{ fontSize: 9, color: FAINT, marginTop: 8 }}>
                Hover any chip to see the source sentence.
              </div>
            </div>
          )}

          {/* Key topical mentions */}
          {ix.concall.keyMentions.length > 0 && (
            <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14, marginBottom: 22 }}>
              <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 10 }}>
                Topical Mentions
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <tbody>
                  {ix.concall.keyMentions.map((m, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '8px 10px', verticalAlign: 'top', textTransform: 'capitalize', color: ACCENT, fontWeight: 700, width: 160 }}>
                        {m.topic.replace(/_/g, ' ')}
                      </td>
                      <td style={{ padding: '8px 10px', color: TEXT, lineHeight: 1.6, fontStyle: 'italic' }}>
                        "{m.quote}"
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          F. WORKING CAPITAL CYCLE
         ═══════════════════════════════════════════════════════════════════ */}
      {/* Sector-aware WC tone — capital goods companies legitimately run
          long debtor/inventory cycles. Default thresholds kept as fallback
          for snapshots built before the benchmarks field existed. */}
      <SectionTitle
        title="Working Capital & Cash Conversion"
        subtitle={
          wc.benchmarks?.sectorLabel
            ? `As of ${wc.asOfPeriod || 'annual'} · benchmarks vs ${wc.benchmarks.sectorLabel}`
            : (wc.asOfPeriod ? `As of ${wc.asOfPeriod}` : 'Annual ratios')
        }
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 22 }}>
        <KpiTile label="Debtor Days" value={fmtDays(wc.debtorDays)} tone={wcTone(wc.debtorDays, wc.benchmarks?.debtorDays || [60, 90, 120])} hint="Days of receivables outstanding" />
        <KpiTile label="Inventory Days" value={fmtDays(wc.inventoryDays)} tone={wcTone(wc.inventoryDays, wc.benchmarks?.inventoryDays || [60, 100, 150])} hint="Days of inventory on hand" />
        <KpiTile label="Days Payable" value={fmtDays(wc.daysPayable)} tone={wcTone(wc.daysPayable, wc.benchmarks?.daysPayable || [120, 60, 30], 'reverse')} hint="Higher is better — supplier float" />
        <KpiTile label="Cash Conv. Cycle" value={fmtDays(wc.cashConversionCycle)} tone={wcTone(wc.cashConversionCycle, wc.benchmarks?.cashConvCycle || [30, 60, 90])} hint="Lower is better — cash freed" />
        <KpiTile label="Working Cap. Days" value={fmtDays(wc.workingCapitalDays)} tone={wcTone(wc.workingCapitalDays, wc.benchmarks?.workingCapitalDays || [60, 100, 140])} hint="WC tied to operations" />
        <KpiTile
          label="CFO / PAT"
          value={wc.cfoOverPat != null ? `${wc.cfoOverPat.toFixed(2)}x` : '—'}
          tone={
            wc.cfoOverPat == null
              ? 'na'
              : wc.cfoOverPat >= (wc.benchmarks?.cfoOverPat?.good ?? 0.85)
                ? 'good'
                : wc.cfoOverPat >= (wc.benchmarks?.cfoOverPat?.mid ?? 0.5)
                  ? 'mid'
                  : 'bad'
          }
          hint="Earnings → cash conversion"
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          G. PROMOTER & GOVERNANCE
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Promoter & Governance" subtitle="Holding pattern + Trust Score" />
      {gov.trustScore && (() => {
        const t = gov.trustScore;
        const trustColor = t.score >= 70 ? GREEN : t.score >= 50 ? ACCENT : t.score >= 30 ? ORANGE : '#ef4444';
        return (
          <div style={{ marginBottom: 12, background: PANEL, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${trustColor}`, borderRadius: 6, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 110 }}>
                <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: 700 }}>Promoter Trust</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: trustColor, fontFamily: MONO, lineHeight: 1.1 }}>{t.score}<span style={{ fontSize: 12, color: MUTED }}>/100</span></div>
                <div style={{ fontSize: 12, fontWeight: 700, color: trustColor, letterSpacing: 0.5 }}>Grade {t.grade}</div>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, color: TEXT, fontWeight: 600, marginBottom: 6 }}>{t.verdict}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6, fontSize: 10, color: MUTED }}>
                  <div title={t.breakdown.stability.reason}><strong style={{ color: TEXT }}>Stability {t.breakdown.stability.score}</strong> · {t.breakdown.stability.reason}</div>
                  <div title={t.breakdown.pledge.reason}><strong style={{ color: TEXT }}>Pledge {t.breakdown.pledge.score}</strong> · {t.breakdown.pledge.reason}</div>
                  <div title={t.breakdown.consistency.reason}><strong style={{ color: TEXT }}>Consistency {t.breakdown.consistency.score}</strong> · {t.breakdown.consistency.reason}</div>
                  <div title={t.breakdown.institutional.reason}><strong style={{ color: TEXT }}>Institutional {t.breakdown.institutional.score}</strong> · {t.breakdown.institutional.reason}</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
        <Panel title="Promoter Holding">
          <div style={{ fontSize: 28, fontWeight: 800, color: ACCENT, fontFamily: MONO }}>
            {gov.promoterHoldingPct != null ? `${gov.promoterHoldingPct.toFixed(2)}%` : '—'}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4, display: 'flex', gap: 12 }}>
            <span>QoQ <span style={{ color: colorForChange(gov.promoterChangeQoQ), fontWeight: 600 }}>{gov.promoterChangeQoQ != null ? `${gov.promoterChangeQoQ >= 0 ? '+' : ''}${gov.promoterChangeQoQ.toFixed(2)} pp` : '—'}</span></span>
            <span>YoY <span style={{ color: colorForChange(gov.promoterChangeYoY), fontWeight: 600 }}>{gov.promoterChangeYoY != null ? `${gov.promoterChangeYoY >= 0 ? '+' : ''}${gov.promoterChangeYoY.toFixed(2)} pp` : '—'}</span></span>
          </div>
        </Panel>
        <Panel title="FII Holding">
          <div style={{ fontSize: 28, fontWeight: 800, color: TEAL, fontFamily: MONO }}>
            {gov.fiiHoldingPct != null ? `${gov.fiiHoldingPct.toFixed(2)}%` : '—'}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
            QoQ <span style={{ color: colorForChange(gov.fiiChangeQoQ), fontWeight: 600 }}>{gov.fiiChangeQoQ != null ? `${gov.fiiChangeQoQ >= 0 ? '+' : ''}${gov.fiiChangeQoQ.toFixed(2)} pp` : '—'}</span>
          </div>
        </Panel>
        <Panel title="DII Holding">
          <div style={{ fontSize: 28, fontWeight: 800, color: GREEN2, fontFamily: MONO }}>
            {gov.diiHoldingPct != null ? `${gov.diiHoldingPct.toFixed(2)}%` : '—'}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
            QoQ <span style={{ color: colorForChange(gov.diiChangeQoQ), fontWeight: 600 }}>{gov.diiChangeQoQ != null ? `${gov.diiChangeQoQ >= 0 ? '+' : ''}${gov.diiChangeQoQ.toFixed(2)} pp` : '—'}</span>
          </div>
        </Panel>
      </div>
      {gov.flags.length > 0 && (
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${ORANGE}`, borderRadius: 6, padding: '10px 14px', marginBottom: 22, fontSize: 12, color: TEXT, lineHeight: 1.7 }}>
          {gov.flags.map((f, i) => (<div key={i}>· {f}</div>))}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          H. SECTOR-SPECIFIC KPIs
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title={`${ix.sector.displayName} — Sector KPIs`} subtitle={`What institutional investors track in ${ix.sector.displayName}`} />
      <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14, marginBottom: 22 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER2}`, color: MUTED }}>
              <Th sm>KPI</Th>
              <Th sm>Importance</Th>
              <Th sm>Status</Th>
              <Th sm>Description</Th>
            </tr>
          </thead>
          <tbody>
            {ix.sector.kpis.map((k) => {
              const concallQuote = ix.concall?.sectorKpiHits.find((h) => h.label === k.label)?.quote;
              return (
                <tr key={k.label} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <Td><span style={{ fontWeight: 600, color: TEXT }}>{k.label}</span></Td>
                  <Td>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 3, color: importanceColor(k.importance), background: importanceColor(k.importance) + '20', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {k.importance}
                    </span>
                  </Td>
                  <Td>
                    {k.tracked ? (
                      <span
                        title={concallQuote || ''}
                        style={{ fontSize: 11, color: GREEN, fontWeight: 600, fontFamily: MONO, cursor: concallQuote ? 'help' : 'default' }}
                      >
                        ● {k.value || 'tracked'}
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: FAINT }}>○ not extracted</span>
                    )}
                  </Td>
                  <Td>
                    <span style={{ fontSize: 11, color: MUTED }}>{k.description}</span>
                    {concallQuote && (
                      <div style={{ fontSize: 10, color: GREEN, marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>
                        ↳ "{concallQuote.slice(0, 180)}{concallQuote.length > 180 ? '…' : ''}"
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: MUTED, marginTop: 10, lineHeight: 1.6 }}>
          <strong style={{ color: SAFFRON }}>Sector themes to watch:</strong> {ix.sector.macroThemes.join(' · ')}
          <br />
          <strong style={{ color: ORANGE }}>Red flags for this sector:</strong> {ix.sector.redFlags.join(' · ')}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          I. INDIA MACRO THEMES
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="India Macro Themes" subtitle="Detected from company description + sector context" />
      <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14, marginBottom: 22 }}>
        {s.qualitative.themes.length === 0 ? (
          <Empty>{s.sectionStatus.themes.reason || 'No India macro themes matched.'}</Empty>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER2}`, color: MUTED }}>
                <Th sm>Theme</Th>
                <Th sm>Strength</Th>
                <Th sm>Evidence</Th>
              </tr>
            </thead>
            <tbody>
              {s.qualitative.themes.map((th) => (
                <tr key={th.theme} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <Td><span style={{ fontWeight: 600, color: TEXT }}>{th.theme}</span></Td>
                  <Td>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3, background: STRENGTH_COLOR[th.strength] + '20', color: STRENGTH_COLOR[th.strength], textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {th.strength}
                    </span>
                  </Td>
                  <Td><span style={{ fontSize: 11, color: MUTED }}>{th.evidence.slice(0, 4).join(' · ')}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          J. PROFITABILITY METRICS — ROCE / ROE / D/E
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Profitability & Leverage" subtitle="TTM ratios from Screener" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 22 }}>
        <KpiTile label="ROCE" value={ix.topMetrics.roce != null ? `${ix.topMetrics.roce.toFixed(1)}%` : '—'} tone={profitTone(ix.topMetrics.roce, [25, 15, 10])} />
        <KpiTile label="ROE" value={ix.topMetrics.roe != null ? `${ix.topMetrics.roe.toFixed(1)}%` : '—'} tone={profitTone(ix.topMetrics.roe, [20, 12, 8])} />
        <KpiTile label="P/E" value={fmtNum(ix.topMetrics.peRatio, 1) + 'x'} tone="na" />
        <KpiTile label="Book Value" value={ix.topMetrics.bookValue != null ? `₹${ix.topMetrics.bookValue.toFixed(0)}` : '—'} tone="na" />
        <KpiTile label="D / E" value={ix.topMetrics.debtToEquity != null ? `${ix.topMetrics.debtToEquity.toFixed(2)}x` : '—'} tone={debtTone(ix.topMetrics.debtToEquity)} />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          K. COVERAGE & SOURCES
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Coverage & Sources" subtitle="What we have data for · what's missing" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 22 }}>
        {([
          ['Quarterly P&L', s.sectionStatus.history],
          ['Working Capital', { available: wc.cashConversionCycle != null, confidence: wc.cashConversionCycle != null ? 90 : 0, reason: 'Annual ratios from Screener.in' }],
          ['Promoter Trend', { available: ix.governance.promoterHoldingPct != null, confidence: 90, reason: 'Quarterly shareholding from Screener.in' }],
          ['Themes', s.sectionStatus.themes],
          ['Concall / Guidance', s.sectionStatus.guidance ?? { available: false, confidence: 0, reason: 'Upload concall transcript or investor presentation for tone + guidance extraction' }],
          ['Consensus / Sell-Side', { available: false, confidence: 0, reason: 'India sell-side coverage suppressed — fundamentals-only mode (correct institutional behavior)' }],
        ] as const).map(([label, st]) => (
          <div key={label} style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>{label}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: confColor(st.confidence), fontFamily: MONO }}>
                {st.available ? `${st.confidence}%` : 'n/a'}
              </div>
            </div>
            <div style={{ fontSize: 10, color: st.available ? GREEN : ORANGE, marginTop: 4 }}>
              {st.available ? '● available' : '○ unavailable'}
            </div>
            {st.reason && (
              <div style={{ fontSize: 9, color: FAINT, marginTop: 4, lineHeight: 1.4 }}>{st.reason}</div>
            )}
            {label === 'Concall / Guidance' && onConcallText && !st.available && (
              <button
                onClick={() => setShowConcallModal(true)}
                disabled={concallProcessing}
                style={{
                  marginTop: 8,
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  color: BG,
                  background: ACCENT,
                  border: 'none',
                  borderRadius: 5,
                  cursor: concallProcessing ? 'wait' : 'pointer',
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}
              >
                {concallProcessing ? 'Extracting…' : '+ Upload Concall'}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ── Concall upload modal ──────────────────────────────────────── */}
      {showConcallModal && onConcallText && (
        <ConcallUploadModal
          accentColor={ACCENT}
          bg={BG}
          panel={PANEL}
          panelBorder={BORDER}
          panelBorder2={BORDER2}
          textColor={TEXT}
          mutedColor={MUTED}
          mono={MONO}
          processing={!!concallProcessing}
          onClose={() => setShowConcallModal(false)}
          onSubmit={(combined) => {
            onConcallText(combined);
            setShowConcallModal(false);
          }}
        />
      )}

      {/* Debug provenance */}
      <details style={{ marginTop: 6, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 14px' }}>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.7 }}>
          Debug · India Pipeline Provenance
        </summary>
        <div style={{ marginTop: 12, fontSize: 11, fontFamily: MONO, lineHeight: 1.7 }}>
          <div><span style={{ color: MUTED }}>analysis mode:</span> <span style={{ color: ACCENT }}>{s.analysisMode || 'india_fundamental_only'}</span></div>
          <div><span style={{ color: MUTED }}>endpoints hit:</span> <span style={{ color: GREEN }}>{s.debug.endpointsHit.join(', ')}</span></div>
          <div><span style={{ color: MUTED }}>endpoints failed:</span> <span style={{ color: ORANGE }}>{s.debug.endpointsFailed.join(', ') || 'none'}</span></div>
          <div><span style={{ color: MUTED }}>sector classified:</span> <span style={{ color: TEXT }}>{ix.sector.slug} ({ix.sector.displayName})</span></div>
          <div><span style={{ color: MUTED }}>screener sector:</span> <span style={{ color: TEXT }}>{ix.sector.sectorString} → {ix.sector.industryString}</span></div>
          <div><span style={{ color: MUTED }}>fallbacks used:</span> <span style={{ color: YELLOW }}>{s.debug.fallbacksUsed.join('; ')}</span></div>
          <div><span style={{ color: MUTED }}>theme corpus:</span> <span style={{ color: TEXT }}>{s.debug.corpusChars} chars</span></div>
        </div>
      </details>

      {/* Footer */}
      <div style={{ marginTop: 22, paddingTop: 14, borderTop: `1px solid ${BORDER}`, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, fontSize: 10, color: MUTED, fontFamily: MONO }}>
        <div>
          financials: <span style={{ color: ACCENT }}>{s.sources.financials}</span>
          <span style={{ color: FAINT, padding: '0 8px' }}>·</span>
          history: <span style={{ color: ACCENT }}>{s.sources.history}</span>
        </div>
        <div>generated {new Date(s.generatedAt).toLocaleString()}</div>
      </div>
      {s.validationWarnings.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 10, color: MUTED, lineHeight: 1.5 }}>
          {s.validationWarnings.map((w, i) => (<div key={i}>· {w}</div>))}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────
function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, color: TEXT, margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
      {subtitle && <span style={{ fontSize: 11, color: MUTED }}>{subtitle}</span>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: FAINT, fontStyle: 'italic', padding: '6px 0' }}>{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.7 }}>{label}</div>
      <div style={{ fontSize: 13, color: TEXT, fontWeight: 700, fontFamily: MONO }}>{value}</div>
    </div>
  );
}

function Pill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ fontSize: 10, color, background: color + '15', border: `1px solid ${color}30`, padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>
      <span style={{ color: MUTED, marginRight: 5 }}>{label}</span>{value}
    </span>
  );
}

function Th({ children, right, sm }: { children?: React.ReactNode; right?: boolean; sm?: boolean }) {
  return (
    <th style={{
      textAlign: right ? 'right' : 'left',
      padding: sm ? '6px 8px' : '10px 12px',
      fontSize: sm ? 10 : 11,
      fontWeight: 700,
      color: MUTED,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
    }}>{children}</th>
  );
}

function Td({ children, right, mono, color }: { children?: React.ReactNode; right?: boolean; mono?: boolean; color?: string }) {
  return (
    <td style={{
      textAlign: right ? 'right' : 'left',
      padding: '6px 8px',
      fontSize: 11,
      color: color ?? TEXT,
      fontFamily: mono ? MONO : FONT,
      fontVariantNumeric: 'tabular-nums',
    }}>{children}</td>
  );
}

function IndiaMetricRow({ label, value, qoq, yoy, qoqAsBps, yoyAsBps }: {
  label: string;
  value: string;
  qoq: number | null | undefined;
  yoy: number | null | undefined;
  qoqAsBps?: boolean;
  yoyAsBps?: boolean;
}) {
  return (
    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
      <td style={{ padding: '10px 12px', fontSize: 12, color: TEXT, fontWeight: 600 }}>{label}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 14, color: TEXT, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{value}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: colorForChange(qoq), fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {qoq != null ? (qoqAsBps ? fmtBps(qoq) : fmtPct(qoq)) : '—'}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: colorForChange(yoy), fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {yoy != null ? (yoyAsBps ? fmtBps(yoy) : fmtPct(yoy)) : '—'}
      </td>
    </tr>
  );
}

function ComponentCard({ title, score, label }: { title: string; score: number; label: string }) {
  const c = scoreColor(score);
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${c}`, borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: c, fontFamily: MONO, lineHeight: 1, marginTop: 4 }}>{score}<span style={{ fontSize: 11, color: MUTED }}>/100</span></div>
      <div style={{ fontSize: 11, color: TEXT, fontWeight: 600, marginTop: 2, textTransform: 'capitalize' }}>{label}</div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
        <div style={{ height: '100%', width: `${score}%`, background: c, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function KpiTile({ label, value, tone, hint }: { label: string; value: string; tone: 'good' | 'mid' | 'bad' | 'na'; hint?: string }) {
  const c = tone === 'good' ? GREEN : tone === 'mid' ? YELLOW : tone === 'bad' ? RED : FAINT;
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 16, color: c, fontFamily: MONO, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 9, color: FAINT, marginTop: 4, lineHeight: 1.3 }}>{hint}</div>}
    </div>
  );
}

// ── Color / tone helpers ─────────────────────────────────────────────────
function scoreColor(v: number): string {
  if (v >= 80) return GREEN;
  if (v >= 65) return GREEN2;
  if (v >= 50) return YELLOW;
  if (v >= 35) return ORANGE;
  return RED;
}

function confColor(c: number): string {
  if (c >= 80) return GREEN;
  if (c >= 60) return GREEN2;
  if (c >= 40) return YELLOW;
  if (c > 0) return ORANGE;
  return FAINT;
}

function importanceColor(i: 'critical' | 'high' | 'medium'): string {
  if (i === 'critical') return RED;
  if (i === 'high') return ORANGE;
  return YELLOW;
}

function wcTone(v: number | null | undefined, thresholds: [number, number, number], reverse?: 'reverse'): 'good' | 'mid' | 'bad' | 'na' {
  if (v == null) return 'na';
  const [g, m, b] = thresholds;
  if (reverse === 'reverse') {
    if (v >= g) return 'good';
    if (v >= m) return 'mid';
    return 'bad';
  }
  if (v <= g) return 'good';
  if (v <= m) return 'mid';
  return 'bad';
}

function profitTone(v: number | null | undefined, thresholds: [number, number, number]): 'good' | 'mid' | 'bad' | 'na' {
  if (v == null) return 'na';
  const [g, m, b] = thresholds;
  if (v >= g) return 'good';
  if (v >= m) return 'mid';
  if (v >= b) return 'bad';
  return 'bad';
}

function debtTone(v: number | null | undefined): 'good' | 'mid' | 'bad' | 'na' {
  if (v == null) return 'na';
  if (v <= 0.3) return 'good';
  if (v <= 1.0) return 'mid';
  return 'bad';
}

function btnSec(): React.CSSProperties {
  return {
    fontSize: 10,
    color: TEXT,
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${BORDER2}`,
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
  };
}
