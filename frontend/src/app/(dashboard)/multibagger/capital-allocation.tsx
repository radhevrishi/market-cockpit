'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState } from 'react';
import type { Grade } from '@/lib/multibagger-india-scoring';
import { F, MUTED, PURPLE, TEXT } from './constants';
import { type CapAllocAnalysis } from './types';

async function analyseCapAlloc(ticker: string): Promise<CapAllocAnalysis | null> {
  const norm = ticker.includes('.') ? ticker : `${ticker}.NS`;
  const res = await fetch(`/api/earnings/india-screener?ticker=${encodeURIComponent(norm)}`);
  const json = await res.json().catch(() => null);
  if (!json?.ok) return null;
  const annual: any[] = json.annual || [];
  const cf: any[] = json.cashFlow || [];
  const bs: any[] = json.balanceSheet || [];
  const recent = annual.slice(-3);
  const recentCf = cf.slice(-3);
  const capexSum = recentCf.reduce((s: number, q: any) => {
    const inv = q.fromInvesting ?? 0;
    return s + (typeof inv === 'number' && inv < 0 ? Math.abs(inv) : 0);
  }, 0);
  const ebitStart = recent[0]?.operatingProfit ?? null;
  const ebitEnd = recent[recent.length - 1]?.operatingProfit ?? null;
  const ebitDelta = ebitStart != null && ebitEnd != null ? ebitEnd - ebitStart : null;
  const capexEff = capexSum > 0 && ebitDelta != null ? Math.round((ebitDelta / capexSum) * 10000) / 100 : null;
  let capexGrade = 'C';
  let capexLabel = 'Capex deployed but EBIT lift unclear';
  if (capexEff !== null) {
    if (capexEff >= 50) { capexGrade = 'A'; capexLabel = `Each Rs 1 of capex generated Rs ${(capexEff / 100).toFixed(2)} of incremental EBIT — excellent`; }
    else if (capexEff >= 25) { capexGrade = 'B'; capexLabel = `Reasonable capex returns (${capexEff.toFixed(0)}% incremental EBIT/capex)`; }
    else if (capexEff >= 10) { capexGrade = 'C'; capexLabel = `Modest returns (${capexEff.toFixed(0)}%) — capex deploying but EBIT lagging`; }
    else if (capexEff >= 0) { capexGrade = 'D'; capexLabel = `Weak returns (${capexEff.toFixed(0)}%) — capex not translating to EBIT`; }
    else { capexGrade = 'F'; capexLabel = 'Negative incremental EBIT despite capex — value destruction'; }
  }
  const ratios: any[] = json.ratios || [];
  const roceArr = ratios.map((r) => r.roce).filter((r: any) => r !== null && r !== undefined);
  const roceBefore = roceArr.length >= 3 ? roceArr[Math.max(0, roceArr.length - 3)] : null;
  const roceAfter = roceArr.length >= 1 ? roceArr[roceArr.length - 1] : null;
  const roceDelta = roceBefore != null && roceAfter != null ? Math.round((roceAfter - roceBefore) * 100) / 100 : null;
  const equityArr = bs.map((b: any) => b.equityCapital).filter((v: any) => v != null);
  const dilutionPct = equityArr.length >= 2 && equityArr[0] !== 0
    ? Math.round(((equityArr[equityArr.length - 1] - equityArr[0]) / equityArr[0]) * 10000) / 100
    : null;
  let dilutionVerdict = 'Share count steady';
  if (dilutionPct !== null) {
    if (dilutionPct > 10) dilutionVerdict = `Heavy dilution +${dilutionPct.toFixed(1)}% — value-destructive unless deployed accretively`;
    else if (dilutionPct > 3) dilutionVerdict = `Moderate dilution +${dilutionPct.toFixed(1)}%`;
    else if (dilutionPct < -3) dilutionVerdict = `Buybacks shrinking float ${dilutionPct.toFixed(1)}% — shareholder-friendly`;
  }
  const lastEps = recent[recent.length - 1]?.eps ?? null;
  const firstEps = recent[0]?.eps ?? null;
  const epsGrowth = firstEps != null && lastEps != null && firstEps !== 0 ? Math.round(((lastEps - firstEps) / Math.abs(firstEps)) * 10000) / 100 : null;
  const div = (json.topMetrics?.dividendYieldPct ?? null);
  const pe = (json.topMetrics?.peRatio ?? null);
  const payoutPct = div != null && pe != null ? Math.round(div * pe * 100) / 100 : null;
  let divVerdict = 'No dividend data';
  if (payoutPct !== null) {
    if (payoutPct < 15 && epsGrowth !== null && epsGrowth > 15) divVerdict = `Low payout (${payoutPct.toFixed(0)}%) + strong EPS growth — reinvesting well`;
    else if (payoutPct > 60 && epsGrowth !== null && epsGrowth < 5) divVerdict = `High payout (${payoutPct.toFixed(0)}%) + weak EPS growth — over-distributing`;
    else if (payoutPct > 80) divVerdict = `Very high payout (${payoutPct.toFixed(0)}%) — limited reinvestment`;
    else divVerdict = `Payout ${payoutPct.toFixed(0)}% — ${epsGrowth !== null ? `EPS ${epsGrowth >= 0 ? '+' : ''}${epsGrowth.toFixed(0)}% over period` : 'EPS context unclear'}`;
  }
  const lastReserves = bs[bs.length - 1]?.reserves ?? null;
  const lastCapex = recentCf[recentCf.length - 1]?.fromInvesting ? Math.abs(recentCf[recentCf.length - 1].fromInvesting) : null;
  const reinvestYears = lastReserves != null && lastCapex && lastCapex > 0 ? Math.round((lastReserves / lastCapex) * 10) / 10 : null;
  const reinvestVerdict = reinvestYears == null ? 'No data'
    : reinvestYears >= 8 ? `${reinvestYears.toFixed(1)} years of capex covered by reserves — long runway`
    : reinvestYears >= 3 ? `${reinvestYears.toFixed(1)}y runway — adequate`
    : `${reinvestYears.toFixed(1)}y runway — short, may need external funding`;
  const gradeMap: Record<string, number> = { A: 90, B: 75, C: 55, D: 35, F: 15 };
  const overall = Math.round(
    (gradeMap[capexGrade] || 50) * 0.4 +
    (roceDelta !== null ? Math.max(0, Math.min(100, 60 + roceDelta * 5)) : 50) * 0.2 +
    (dilutionPct !== null ? (dilutionPct < 0 ? 80 : dilutionPct < 3 ? 70 : dilutionPct < 10 ? 50 : 25) : 60) * 0.15 +
    (payoutPct !== null && epsGrowth !== null
      ? (epsGrowth > 15 ? 80 : epsGrowth > 5 ? 65 : epsGrowth > 0 ? 50 : 35)
      : 55) * 0.15 +
    (reinvestYears !== null
      ? (reinvestYears >= 8 ? 90 : reinvestYears >= 3 ? 70 : 45)
      : 60) * 0.10
  );
  let overallGrade = 'F'; let overallLabel = '';
  if (overall >= 80) { overallGrade = 'A'; overallLabel = 'Disciplined capital allocator — capex returns + clean balance sheet'; }
  else if (overall >= 65) { overallGrade = 'B'; overallLabel = 'Solid capital allocation, minor inefficiencies'; }
  else if (overall >= 50) { overallGrade = 'C'; overallLabel = 'Mixed — capex deploying but returns not yet visible'; }
  else if (overall >= 35) { overallGrade = 'D'; overallLabel = 'Capital deployment outpacing incremental returns'; }
  else { overallGrade = 'F'; overallLabel = 'Material capital-allocation concerns'; }
  return {
    ticker: norm, company: json.company || norm,
    capexEfficiency: { value: capexEff, grade: capexGrade, label: capexLabel },
    roceShift: { before: roceBefore, after: roceAfter, delta: roceDelta },
    dilution: { sharesYoYPct: dilutionPct, verdict: dilutionVerdict },
    buybackQuality: { sharesRepurchasedPct: dilutionPct !== null && dilutionPct < 0 ? -dilutionPct : null, verdict: dilutionPct !== null && dilutionPct < -1 ? `Buyback of ~${(-dilutionPct).toFixed(1)}% of float` : 'No material buybacks' },
    dividendRationality: { payoutPct, epsGrowthPct: epsGrowth, verdict: divVerdict },
    reinvestmentRunway: { years: reinvestYears, verdict: reinvestVerdict },
    overall: { score: overall, grade: overallGrade, label: overallLabel },
  };
}

export function CapitalAllocationPanel() {
  const [ticker, setTicker] = useState('');
  const [analysis, setAnalysis] = useState<CapAllocAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const onSubmit = async () => {
    if (!ticker.trim()) return;
    setLoading(true); setError(''); setAnalysis(null);
    try {
      const a = await analyseCapAlloc(ticker.trim().toUpperCase());
      if (!a) setError('No data — verify ticker (e.g. RELIANCE.NS, BAJAJCON.NS)');
      else setAnalysis(a);
    } catch (e: any) {
      setError(e?.message || 'Analysis failed');
    }
    setLoading(false);
  };
  return (
    <div style={{ padding: '24px', maxWidth: 1800, margin: '0 auto' }}>
      <div style={{ fontSize: 13, color: MUTED, marginBottom: 16, lineHeight: 1.5 }}>
        How disciplined is management with shareholder capital? Capex efficiency · ROCE shift · dilution · buybacks · dividend rationality · reinvestment runway. Computed from Screener annual data.
      </div>
      {/* PATCH 0445 BUG-031 — Help text + auto-suffix hint */}
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
        Tip: bare tickers like <span style={{ color: TEXT }}>RELIANCE</span> auto-normalise to <span style={{ color: TEXT }}>RELIANCE.NS</span> on submit.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
          placeholder="e.g. RELIANCE or RELIANCE.NS"
          style={{ flex: 1, padding: '10px 14px', background: '#13131a', color: TEXT, border: '1px solid rgba(255,255,255,0.10)', borderRadius: 6, fontSize: 13 }}
        />
        <button onClick={onSubmit} disabled={loading || !ticker.trim()}
          style={{ padding: '10px 18px', background: PURPLE, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
          {loading ? 'Analysing…' : 'Analyse'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--mc-warn)', fontSize: 12, marginBottom: 12 }}>WARN: {error}</div>}
      {analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.06)', borderLeft: `3px solid ${PURPLE}`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>{analysis.company}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{analysis.ticker}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Capital Allocation Score</div>
                <div style={{ fontSize: 36, fontWeight: 800, fontFamily: 'ui-monospace,monospace', color: analysis.overall.score >= 70 ? 'var(--mc-bullish)' : analysis.overall.score >= 50 ? 'var(--mc-warn)' : 'var(--mc-warn)' }}>
                  {analysis.overall.score}<span style={{ fontSize: 14, color: MUTED }}>/100</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Grade {analysis.overall.grade}</div>
              </div>
              <div style={{ flex: 1, fontSize: 12, color: TEXT, lineHeight: 1.5 }}>{analysis.overall.label}</div>
            </div>
          </div>
          {[
            { title: 'Capex Efficiency', value: analysis.capexEfficiency.value !== null ? `${analysis.capexEfficiency.value.toFixed(1)}% EBIT/capex` : '-', grade: analysis.capexEfficiency.grade, body: analysis.capexEfficiency.label },
            { title: 'ROCE Shift (3y)', value: analysis.roceShift.delta !== null ? `${analysis.roceShift.delta >= 0 ? '+' : ''}${analysis.roceShift.delta.toFixed(1)} pp` : '-', grade: '', body: `Before: ${analysis.roceShift.before?.toFixed(1) ?? '-'}%   |   After: ${analysis.roceShift.after?.toFixed(1) ?? '-'}%` },
            { title: 'Equity Dilution', value: analysis.dilution.sharesYoYPct !== null ? `${analysis.dilution.sharesYoYPct >= 0 ? '+' : ''}${analysis.dilution.sharesYoYPct.toFixed(1)}%` : '-', grade: '', body: analysis.dilution.verdict },
            { title: 'Buyback Quality', value: analysis.buybackQuality.sharesRepurchasedPct !== null ? `${analysis.buybackQuality.sharesRepurchasedPct.toFixed(1)}%` : '-', grade: '', body: analysis.buybackQuality.verdict },
            { title: 'Dividend Rationality', value: analysis.dividendRationality.payoutPct !== null ? `Payout ${analysis.dividendRationality.payoutPct.toFixed(0)}%` : '-', grade: '', body: analysis.dividendRationality.verdict },
            { title: 'Reinvestment Runway', value: analysis.reinvestmentRunway.years !== null ? `${analysis.reinvestmentRunway.years.toFixed(1)} years` : '-', grade: '', body: analysis.reinvestmentRunway.verdict },
          ].map((row) => (
            <div key={row.title} style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ minWidth: 180 }}>
                <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>{row.title}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, fontFamily: 'ui-monospace,monospace' }}>{row.value}</div>
                {row.grade && <div style={{ fontSize: 11, fontWeight: 700, color: row.grade === 'A' ? 'var(--mc-bullish)' : row.grade === 'F' ? 'var(--mc-bearish)' : 'var(--mc-warn)' }}>Grade {row.grade}</div>}
              </div>
              <div style={{ flex: 1, fontSize: 12, color: TEXT, lineHeight: 1.5 }}>{row.body}</div>
            </div>
          ))}
        </div>
      )}
      {!analysis && !loading && !error && (
        <div style={{ background: '#13131a', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 20, fontSize: 12, color: MUTED }}>
          Enter an Indian ticker and we will compute capex efficiency, ROCE shift, equity dilution, buyback quality, dividend rationality, and reinvestment runway from Screener annual data.
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0872 — USA ANALYTICS TAB
//
// Self-contained analytics dashboard for the USA Multibagger universe.
// Reads USAResult[] from localStorage with proper listeners so it stays
// LIVE when the user uploads / clears / edits decisions / adjusts the
// conviction beats list — no manual refresh needed.
//
// Panels:
//   • Stats strip (count · avg score · A+/A count · R40 ≥40 · Piotroski ≥7)
//   • Grade distribution
//   • Sector exposure (top 8)
//   • Rule of 40 buckets (<0 / 0-20 / 20-40 / 40-60 / 60-80 / ≥80)
//   • Piotroski F-Score buckets (0-3 / 4-6 / 7-9)
//   • Forensic flag summary (FCF-Op divergence / post-run stretched / earnings prox)
//   • Decision overlay (BUY / WATCH / REJECTED counts)
//   • Conviction-Beats overlap
//   • Top 15 leaderboard
// ═══════════════════════════════════════════════════════════════════════════
