'use client';

import React from 'react';
import {
  EarningsSnapshot,
  MetricLine,
  surpriseClassColor,
  surpriseClassLabel,
  ThemeStrength,
} from '@/lib/earnings/snapshot';

// ── Design tokens ────────────────────────────────────────────────────────
const BG     = '#0a0a0f';
const PANEL  = '#0f0f17';
const PANEL2 = '#13131c';
const BORDER = 'rgba(255,255,255,0.06)';
const BORDER2 = 'rgba(255,255,255,0.10)';
const TEXT   = '#e6e9ef';
const MUTED  = '#7a8599';
const FAINT  = '#475569';
const ACCENT = '#7dd3fc';
const GREEN  = '#10b981';
const GREEN2 = '#34d399';
const RED    = '#ef4444';
const ORANGE = '#f97316';
const YELLOW = '#f59e0b';

// Mono numerics
const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

// ── Number formatters ────────────────────────────────────────────────────
function fmtNum(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}B`;
  return v.toFixed(digits);
}

function fmtCurrency(v: number | null, scaleLabel: string, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(2)} B`;
  return `${sign}${abs.toFixed(digits)}`;
}

function fmtPct(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtBps(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${Math.round(v)} bps`;
}

function fmtMcap(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

// ── Visual helpers ───────────────────────────────────────────────────────
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

const GUIDANCE_LABEL: Record<string, { label: string; color: string; arrow: string }> = {
  raised:      { label: 'Raised', color: GREEN, arrow: '↑' },
  introduced:  { label: 'Introduced', color: GREEN2, arrow: '◆' },
  maintained:  { label: 'Maintained', color: MUTED, arrow: '→' },
  lowered:     { label: 'Lowered', color: RED, arrow: '↓' },
  na:          { label: 'Not provided', color: FAINT, arrow: '—' },
};

// ── Component ────────────────────────────────────────────────────────────
export interface InstitutionalReportProps {
  snapshot: EarningsSnapshot;
  onReset?: () => void;
  onCopy?: () => void;
}

export function InstitutionalReport({ snapshot: s, onReset, onCopy }: InstitutionalReportProps) {
  const tone = TONE_LABEL[s.qualitative.mgmtTone] ?? TONE_LABEL.neutral;
  const guideLabel = GUIDANCE_LABEL[s.guidance.direction] ?? GUIDANCE_LABEL.na;
  const reaction = s.scores.reaction;
  const acct = s.scores.accounting;
  const narrative = s.scores.narrative;
  const jat = s.scores.jat;

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, fontFamily: FONT, padding: '24px 20px', maxWidth: 1280, margin: '0 auto' }}>

      {/* ═══════════════════════════════════════════════════════════════════
          A. HEADER — identity + market data
         ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18, paddingBottom: 14, borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: TEXT, margin: 0, letterSpacing: '-0.5px' }}>{s.company}</h1>
            <span style={{ fontSize: 13, fontWeight: 700, color: ACCENT, background: 'rgba(125,211,252,0.10)', padding: '3px 9px', borderRadius: 4, fontFamily: MONO }}>
              {s.ticker}
            </span>
            {s.exchange && <span style={{ fontSize: 11, color: MUTED }}>{s.exchange}</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 12, color: MUTED }}>
            <span style={{ fontWeight: 600, color: TEXT }}>{s.quarter}</span>
            <span style={{ color: FAINT }}>·</span>
            <span>{s.filingType}</span>
            <span style={{ color: FAINT }}>·</span>
            <span style={{ fontFamily: MONO }}>{s.scaleLabel}</span>
            {s.sector && <><span style={{ color: FAINT }}>·</span><span>{s.sector}</span></>}
            {s.industry && <span style={{ color: FAINT }}>{s.industry}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, fontSize: 11 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <Stat label="Market Cap" value={fmtMcap(s.marketCap)} />
            <Stat label="EV" value={fmtMcap(s.enterpriseValue)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Pill label="Tone" value={tone.label} color={tone.color} />
            <Pill label="Guidance" value={`${guideLabel.arrow} ${guideLabel.label}`} color={guideLabel.color} />
          </div>
          {(onCopy || onReset) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {onCopy && <button onClick={onCopy} style={btnSec()}>Copy summary</button>}
              {onReset && <button onClick={onReset} style={btnSec()}>New analysis</button>}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          B. EARNINGS SCORECARD — the headline beat/miss matrix
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Earnings Scorecard" subtitle={`${s.quarter} actuals vs consensus`} />
      <div style={{ overflowX: 'auto', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, marginBottom: 22 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER2}`, background: PANEL2 }}>
              <Th>Metric</Th>
              <Th right>Actual</Th>
              <Th right>Consensus</Th>
              <Th right>Surprise</Th>
              <Th right>YoY</Th>
              <Th right>QoQ</Th>
              <Th right>Verdict</Th>
            </tr>
          </thead>
          <tbody>
            <MetricRow line={s.metrics.revenue} scaleLabel={s.scaleLabel} />
            <MetricRow line={s.metrics.eps} scaleLabel={s.scaleLabel} />
            <MetricRow line={s.metrics.ebitda} scaleLabel={s.scaleLabel} />
            <MetricRow line={s.metrics.grossMargin} scaleLabel={s.scaleLabel} />
            <MetricRow line={s.metrics.ebitdaMargin} scaleLabel={s.scaleLabel} />
            <MetricRow line={s.metrics.operatingMargin} scaleLabel={s.scaleLabel} />
            <MetricRow line={s.metrics.netIncome} scaleLabel={s.scaleLabel} />
            <MetricRow line={s.metrics.fcf} scaleLabel={s.scaleLabel} />
          </tbody>
        </table>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          C. KEY TAKEAWAYS + REACTION PROBABILITY
         ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 22 }}>
        <Panel title="Key Takeaways">
          {s.qualitative.keyTakeaways.length === 0 ? (
            <Empty>No deterministic takeaways — insufficient consensus data.</Empty>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, color: TEXT, fontSize: 13, lineHeight: 1.75 }}>
              {s.qualitative.keyTakeaways.map((t, i) => (<li key={i}>{t}</li>))}
            </ul>
          )}
        </Panel>
        <Panel title="Expected Reaction">
          <div style={{ textAlign: 'center', padding: '4px 0' }}>
            <div style={{ fontSize: 38, fontWeight: 800, color: reactionColor(s.reactionProbability.expected), fontFamily: MONO, lineHeight: 1 }}>
              {s.reactionProbability.expected}
            </div>
            <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>
              expected magnitude
            </div>
            <div style={{ fontSize: 11, color: TEXT, marginTop: 10, lineHeight: 1.5 }}>
              {s.reactionProbability.summary}
            </div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 8 }}>
              Confidence: <span style={{ color: TEXT, fontWeight: 600 }}>{s.reactionProbability.confidence}</span>
            </div>
          </div>
        </Panel>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          D. SCORE BREAKDOWN — 4 deterministic engines
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Scoring Engines" subtitle="Deterministic methodology · weighted formulas, not heuristics" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 22 }}>
        <ScoreCard
          title="Reaction Score"
          score={reaction.score}
          grade={reaction.grade}
          subtitle="Surprise + guidance + tone + theme"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {Object.entries(reaction.breakdown).map(([k, b]) => (
              <BarRow key={k} label={prettyKey(k)} value={b.score} weight={b.weight} />
            ))}
          </div>
        </ScoreCard>

        <ScoreCard
          title="Accounting Quality"
          score={acct.score}
          grade={acct.grade}
          subtitle="CFO/PAT, AR, inventory, leverage"
        >
          {acct.flags.length === 0 ? (
            <div style={{ fontSize: 11, color: GREEN, marginTop: 8 }}>No quality flags raised</div>
          ) : (
            <ul style={{ margin: '8px 0 0', paddingLeft: 16, color: ORANGE, fontSize: 11, lineHeight: 1.55 }}>
              {acct.flags.slice(0, 4).map((f, i) => (<li key={i}>{f}</li>))}
            </ul>
          )}
        </ScoreCard>

        <ScoreCard
          title="Narrative Strength"
          score={narrative.score}
          grade={narrative.grade}
          subtitle="Theme exposure × premium weight"
        >
          {narrative.themes.length === 0 ? (
            <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>No themes detected</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              {narrative.themes.slice(0, 6).map((t, i) => (
                <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'rgba(125,211,252,0.08)', color: ACCENT, border: `1px solid rgba(125,211,252,0.20)` }}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </ScoreCard>

        <ScoreCard
          title="JAT (Just-Ahead Trajectory)"
          score={jat.score}
          grade={jat.grade}
          subtitle={`Direction: ${jat.direction} · ${jat.confidence} confidence`}
        >
          {jat.signals.length === 0 ? (
            <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>Insufficient forward signals</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8, fontSize: 11 }}>
              {jat.signals.slice(0, 6).map((sg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: MUTED }}>
                  <span>{sg.name}</span>
                  <span style={{ color: directionColor(sg.direction), fontWeight: 600 }}>
                    {directionGlyph(sg.direction)} {sg.direction}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ScoreCard>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          E. BEAT STREAK + 8Q TREND
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Trend & Beat Streak" subtitle="Last 8 quarters, FMP earnings calendar" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, marginBottom: 22 }}>
        <Panel title="Beat Streak">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <StreakStat
              label="Revenue beats"
              num={s.streak.revenueBeats}
              denom={s.streak.revenueAttempts}
              avgSurprise={s.streak.avgRevenueSurprise}
            />
            <StreakStat
              label="EPS beats"
              num={s.streak.epsBeats}
              denom={s.streak.epsAttempts}
              avgSurprise={s.streak.avgEpsSurprise}
            />
          </div>
        </Panel>

        <Panel title="8-Quarter Margin & Surprise Trend">
          {s.history.length === 0 ? (
            <Empty>No quarterly history available.</Empty>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER2}`, color: MUTED }}>
                    <Th sm>Period</Th>
                    <Th sm right>Rev</Th>
                    <Th sm right>Rev Surp</Th>
                    <Th sm right>GM%</Th>
                    <Th sm right>EBITDA M%</Th>
                    <Th sm right>EPS</Th>
                    <Th sm right>EPS Surp</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.history.slice(0, 8).map((q) => (
                    <tr key={q.date} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <Td>{q.period || q.date}</Td>
                      <Td right mono>{fmtCurrency(q.revenue, s.scaleLabel)}</Td>
                      <Td right mono color={surpColor(q.revenueSurprisePct)}>{fmtPct(q.revenueSurprisePct)}</Td>
                      <Td right mono>{fmtPct(q.grossMargin)}</Td>
                      <Td right mono>{fmtPct(q.ebitdaMargin)}</Td>
                      <Td right mono>{fmtNum(q.eps, 2)}</Td>
                      <Td right mono color={surpColor(q.epsSurprisePct)}>{fmtPct(q.epsSurprisePct)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          F. SELL-SIDE SENTIMENT
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Sell-Side Sentiment" subtitle="Rating distribution, target price, recent rating actions" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 22 }}>
        {!s.sellSide ? (
          <Panel title="Coverage"><Empty>No sell-side coverage data available.</Empty></Panel>
        ) : (
          <>
            <Panel title="Rating Distribution">
              <RatingBars ss={s.sellSide} />
              <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>
                {s.sellSide.total} actions in last 90 days
              </div>
            </Panel>
            <Panel title="Price Target">
              <div style={{ fontSize: 24, fontWeight: 800, color: TEXT, fontFamily: MONO }}>
                ${(s.sellSide.consensusTargetPrice ?? 0).toFixed(2)}
              </div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                Current ${(s.sellSide.currentPrice ?? 0).toFixed(2)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: (s.sellSide.upsidePct ?? 0) >= 0 ? GREEN : RED, marginTop: 6 }}>
                {fmtPct(s.sellSide.upsidePct)} implied
              </div>
            </Panel>
            <Panel title="Recent Actions (30d)">
              <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '6px 0' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: GREEN, fontFamily: MONO }}>{s.sellSide.recentUpgrades30d}</div>
                  <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 }}>upgrades</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: RED, fontFamily: MONO }}>{s.sellSide.recentDowngrades30d}</div>
                  <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 }}>downgrades</div>
                </div>
              </div>
            </Panel>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          G. THEME EXPOSURE (with strength)
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Theme Exposure" subtitle="Deterministic keyword matching · strength = distinct evidence count" />
      <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 14, marginBottom: 22 }}>
        {s.qualitative.themes.length === 0 ? (
          <Empty>No thematic exposure detected from available text.</Empty>
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
                  <Td>
                    <span style={{ fontSize: 11, color: MUTED }}>
                      {th.evidence.slice(0, 4).join(' · ')}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          H. ACCOUNTING QUALITY (deterministic indicators)
         ═══════════════════════════════════════════════════════════════════ */}
      <SectionTitle title="Accounting Quality" subtitle="Working-capital, leverage, and cash-conversion indicators" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 22 }}>
        <KpiTile
          label="CFO / PAT"
          value={s.accountingQuality.cfoOverPat !== null ? s.accountingQuality.cfoOverPat.toFixed(2) + 'x' : '—'}
          tone={qualityTone(s.accountingQuality.cfoOverPat, [0.85, 0.5, 0])}
        />
        <KpiTile
          label="AR vs Rev growth"
          value={fmtPct(s.accountingQuality.arGrowthVsRevenuePct, 0)}
          tone={qualityTone(s.accountingQuality.arGrowthVsRevenuePct === null ? null : -s.accountingQuality.arGrowthVsRevenuePct, [-10, -25, -50])}
        />
        <KpiTile
          label="Inventory vs Rev"
          value={fmtPct(s.accountingQuality.inventoryGrowthVsRevenuePct, 0)}
          tone={qualityTone(s.accountingQuality.inventoryGrowthVsRevenuePct === null ? null : -s.accountingQuality.inventoryGrowthVsRevenuePct, [-15, -30, -50])}
        />
        <KpiTile
          label="SBC intensity"
          value={s.accountingQuality.sbcIntensity !== null ? (s.accountingQuality.sbcIntensity * 100).toFixed(1) + '%' : '—'}
          tone={qualityTone(s.accountingQuality.sbcIntensity === null ? null : -s.accountingQuality.sbcIntensity, [-0.05, -0.10, -0.20])}
        />
        <KpiTile
          label="Net Debt / EBITDA"
          value={s.accountingQuality.debtToEbitda !== null ? s.accountingQuality.debtToEbitda.toFixed(1) + 'x' : '—'}
          tone={qualityTone(s.accountingQuality.debtToEbitda === null ? null : -s.accountingQuality.debtToEbitda, [-2, -3, -5])}
        />
        <KpiTile
          label="FCF Margin"
          value={s.accountingQuality.fcfMargin !== null ? (s.accountingQuality.fcfMargin * 100).toFixed(1) + '%' : '—'}
          tone={qualityTone(s.accountingQuality.fcfMargin, [0.10, 0, -0.10])}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          I. PROVENANCE
         ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ marginTop: 30, paddingTop: 14, borderTop: `1px solid ${BORDER}`, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, fontSize: 10, color: MUTED, fontFamily: MONO }}>
        <div>
          financials: <span style={{ color: ACCENT }}>{s.sources.financials}</span>
          <span style={{ color: FAINT, padding: '0 8px' }}>·</span>
          estimates: <span style={{ color: ACCENT }}>{s.sources.estimates}</span>
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

// ── Small render helpers ─────────────────────────────────────────────────
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

function MetricRow({ line, scaleLabel }: { line: MetricLine; scaleLabel: string }) {
  const surpColor = surpriseClassColor(line.surpriseClass);
  const surpLabel = surpriseClassLabel(line.surpriseClass);
  const isPercent = line.unit === 'percent';
  const surprise = isPercent ? fmtBps(line.surpriseBps) : fmtPct(line.surprisePct);
  const yoy = isPercent ? fmtBps(line.yoyBps) : fmtPct(line.yoyPct);
  const qoq = isPercent ? fmtBps(line.qoqBps) : fmtPct(line.qoqPct);
  const fmtVal = (v: number | null) =>
    v === null
      ? '—'
      : isPercent
      ? fmtPct(v)
      : line.unit === 'count'
      ? fmtNum(v, 2)
      : fmtCurrency(v, scaleLabel);
  return (
    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
      <td style={{ padding: '8px 12px', fontSize: 12, color: TEXT, fontWeight: 600 }}>{line.metric}</td>
      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 13, color: TEXT, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {fmtVal(line.actual)}
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 13, color: line.estimate === null ? FAINT : MUTED, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
        {fmtVal(line.estimate)}
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, color: surpColor, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
        {surprise}
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, color: yoyColor(line.yoyPct ?? line.yoyBps), fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
        {yoy}
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, color: yoyColor(line.qoqPct ?? line.qoqBps), fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
        {qoq}
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
        <span style={{ fontSize: 10, color: surpColor, background: surpColor + '14', border: `1px solid ${surpColor}30`, padding: '2px 8px', borderRadius: 3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {surpLabel}
        </span>
      </td>
    </tr>
  );
}

function ScoreCard({ title, score, grade, subtitle, children }: { title: string; score: number; grade: string; subtitle?: string; children?: React.ReactNode }) {
  const c = scoreColor(score);
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${c}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10, color: FAINT, marginTop: 2 }}>{subtitle}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: c, fontFamily: MONO, lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>{grade}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function BarRow({ label, value, weight }: { label: string; value: number; weight: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
      <div style={{ width: 105, color: MUTED }}>{label}</div>
      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: scoreColor(value), borderRadius: 3 }} />
      </div>
      <div style={{ width: 28, textAlign: 'right', color: TEXT, fontFamily: MONO, fontWeight: 600 }}>{value}</div>
      <div style={{ width: 36, textAlign: 'right', color: FAINT, fontFamily: MONO }}>×{weight.toFixed(2)}</div>
    </div>
  );
}

function StreakStat({ label, num, denom, avgSurprise }: { label: string; num: number; denom: number; avgSurprise: number | null }) {
  const ratio = denom > 0 ? num / denom : 0;
  const c = ratio >= 0.6 ? GREEN : ratio >= 0.4 ? YELLOW : RED;
  return (
    <div>
      <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: c, fontFamily: MONO, lineHeight: 1 }}>
        {num}<span style={{ fontSize: 14, color: MUTED, fontWeight: 600 }}>/{denom}</span>
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
        avg surprise <span style={{ color: surpColor(avgSurprise), fontWeight: 600 }}>{fmtPct(avgSurprise)}</span>
      </div>
    </div>
  );
}

function RatingBars({ ss }: { ss: NonNullable<EarningsSnapshot['sellSide']> }) {
  const total = Math.max(ss.total, 1);
  const buckets: Array<[string, number, string]> = [
    ['Strong Buy', ss.strongBuy, GREEN],
    ['Buy', ss.buy, GREEN2],
    ['Hold', ss.hold, MUTED],
    ['Sell', ss.sell, ORANGE],
    ['Strong Sell', ss.strongSell, RED],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {buckets.map(([label, n, c]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
          <div style={{ width: 70, color: MUTED }}>{label}</div>
          <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(n / total) * 100}%`, background: c, borderRadius: 2 }} />
          </div>
          <div style={{ width: 18, textAlign: 'right', color: TEXT, fontFamily: MONO, fontWeight: 600 }}>{n}</div>
        </div>
      ))}
    </div>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone: 'good' | 'mid' | 'bad' | 'na' }) {
  const c = tone === 'good' ? GREEN : tone === 'mid' ? YELLOW : tone === 'bad' ? RED : FAINT;
  return (
    <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '11px 13px' }}>
      <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 17, color: c, fontFamily: MONO, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ── Color helpers ────────────────────────────────────────────────────────
function scoreColor(v: number): string {
  if (v >= 80) return GREEN;
  if (v >= 65) return GREEN2;
  if (v >= 50) return YELLOW;
  if (v >= 35) return ORANGE;
  return RED;
}

function surpColor(v: number | null): string {
  if (v === null) return FAINT;
  if (v >= 5) return GREEN;
  if (v >= 0) return GREEN2;
  if (v >= -5) return YELLOW;
  return RED;
}

function yoyColor(v: number | null): string {
  if (v === null) return FAINT;
  if (v > 0) return GREEN2;
  if (v < 0) return ORANGE;
  return MUTED;
}

function reactionColor(r: string): string {
  if (r === '+10%') return GREEN;
  if (r === '+5%') return GREEN2;
  if (r === 'flat') return MUTED;
  if (r === '-5%') return ORANGE;
  return RED;
}

function directionColor(d: 'improving' | 'stable' | 'deteriorating'): string {
  if (d === 'improving') return GREEN;
  if (d === 'deteriorating') return RED;
  return MUTED;
}

function directionGlyph(d: 'improving' | 'stable' | 'deteriorating'): string {
  if (d === 'improving') return '↑';
  if (d === 'deteriorating') return '↓';
  return '→';
}

function qualityTone(v: number | null, thresholds: [number, number, number]): 'good' | 'mid' | 'bad' | 'na' {
  if (v === null) return 'na';
  const [good, mid, bad] = thresholds;
  if (v >= good) return 'good';
  if (v >= mid) return 'mid';
  if (v >= bad) return 'bad';
  return 'bad';
}

function prettyKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
