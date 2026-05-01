'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG      = '#0a0a0f';
const CARD_BG = '#13131a';
const BORDER  = 'rgba(255,255,255,0.06)';
const TEXT    = '#e2e8f0';
const MUTED   = '#64748b';
const PURPLE  = '#a78bfa';
const ACCENT  = '#38bdf8';
const GREEN   = '#10b981';
const RED     = '#ef4444';
const ORANGE  = '#f97316';
const YELLOW  = '#f59e0b';

type Signal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'CAUTION' | 'AVOID';
type Grade  = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'NR';

const SIG_COLOR: Record<Signal, string> = {
  STRONG_BUY: '#10b981', BUY: '#34d399', NEUTRAL: '#f59e0b', CAUTION: '#f97316', AVOID: '#ef4444',
};
const GRADE_COLOR: Record<Grade, string> = {
  'A+': '#10b981', 'A': '#34d399', 'B+': '#f59e0b', 'B': '#f97316', 'C': '#fb923c', 'D': '#ef4444', 'NR': '#64748b',
};
const PILLAR_COLOR: Record<string, string> = {
  QUALITY: '#a78bfa', GROWTH: '#38bdf8', FIN_STRENGTH: '#10b981', VALUATION: '#f59e0b', MARKET: '#f97316',
};
const CONF_COLOR = { HIGH: GREEN, MEDIUM: YELLOW, LOW: ORANGE, VERY_LOW: RED };

interface CriterionDetail {
  id: string; label: string; pillar: string;
  rawValue: number | null; rawDisplay: string;
  sectorPercentile: number | null; score: number; signal: Signal;
  weight: number; insight: string; dataAvailable: boolean;
}
interface PillarScore { id: string; label: string; weight: number; score: number; coverage: number; topStrength: string; topRisk: string; }
interface RedFlag { id: string; label: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'; detail: string; }
interface DataQuality { valid: boolean; reason: string | null; coveragePct: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW'; source: string; fetchedAt: string; }
interface MultibaggerResult {
  symbol: string; company: string; sector: string; sectorGroup: string;
  lastPrice: number | null; marketCapCr: number | null;
  overallScore: number; scoreRange?: { low: number; high: number }; grade: Grade;
  pillars: PillarScore[]; criteria: CriterionDetail[]; redFlags: RedFlag[];
  quality: DataQuality; isPortfolio: boolean; isWatchlist: boolean; errors: string[];
  _debug?: Record<string, any>;
}
interface ApiMeta { total: number; valid: number; portfolio: number; watchlist: number; topScore: number; avgScore: number; topPicks: number; computedAt: string; methodology: string; }
interface ApiResponse { results: MultibaggerResult[]; meta?: ApiMeta; message?: string; degradedMode?: boolean; }

const CHAT_ID = '5057319640';

// ── Mini components ───────────────────────────────────────────────────────────
function Bar({ score, color, height = 5 }: { score: number; color: string; height?: number }) {
  return (
    <div style={{ height, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden', flex: 1 }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, score))}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
    </div>
  );
}

function ConfBadge({ conf }: { conf: DataQuality['confidence'] }) {
  const c = CONF_COLOR[conf];
  return <span style={{ fontSize: 10, fontWeight: 700, color: c, background: `${c}18`, padding: '2px 7px', borderRadius: 10 }}>{conf.replace('_', ' ')} CONF</span>;
}

function FlagBadge({ flag }: { flag: RedFlag }) {
  const color = flag.severity === 'CRITICAL' ? RED : flag.severity === 'HIGH' ? ORANGE : YELLOW;
  return (
    <div style={{ fontSize: 11, color, background: `${color}12`, border: `1px solid ${color}30`, borderRadius: 7, padding: '5px 10px', marginBottom: 5 }}>
      <span style={{ fontWeight: 700 }}>{'⛔'} {flag.label}</span><span style={{ color: `${color}cc`, marginLeft: 6 }}>{flag.detail}</span>
    </div>
  );
}

function PillarBar({ pillar }: { pillar: PillarScore }) {
  const color = PILLAR_COLOR[pillar.id] || MUTED;
  const sig: Signal = pillar.score >= 78 ? 'STRONG_BUY' : pillar.score >= 63 ? 'BUY' : pillar.score >= 48 ? 'NEUTRAL' : pillar.score >= 33 ? 'CAUTION' : 'AVOID';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
          <span style={{ fontSize: 11, color: TEXT, fontWeight: 600 }}>{pillar.label}</span>
          <span style={{ fontSize: 9, color: MUTED }}>{Math.round(pillar.weight * 100)}%</span>
          <span style={{ fontSize: 9, color: MUTED }}>· {Math.round(pillar.coverage * 100)}% data</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: SIG_COLOR[sig], fontWeight: 700 }}>{sig.replace('_', ' ')}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color, minWidth: 28, textAlign: 'right' }}>{pillar.score}</span>
        </div>
      </div>
      <Bar score={pillar.score} color={color} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ fontSize: 9, color: GREEN }}>+ {pillar.topStrength}</span>
        <span style={{ fontSize: 9, color: RED }}>– {pillar.topRisk}</span>
      </div>
    </div>
  );
}

function CriterionRow({ c }: { c: CriterionDetail }) {
  const color = SIG_COLOR[c.signal];
  const pillarColor = PILLAR_COLOR[c.pillar] || MUTED;
  return (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <span style={{ fontSize: 11, color: TEXT, fontWeight: 600 }}>{c.label}</span>
          <span style={{ fontSize: 9, color: pillarColor, marginLeft: 6, background: `${pillarColor}18`, padding: '1px 5px', borderRadius: 8 }}>{c.pillar.replace('_', ' ')}</span>
          {!c.dataAvailable && <span style={{ fontSize: 9, color: MUTED, marginLeft: 5 }}>⚠ N/A</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: MUTED }}>{c.rawDisplay}</span>
          {c.sectorPercentile !== null && <span style={{ fontSize: 9, color: MUTED }}>{c.sectorPercentile}th pct</span>}
          <span style={{ fontSize: 13, fontWeight: 800, color, minWidth: 28, textAlign: 'right' }}>{c.score}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Bar score={c.score} color={color} />
        <span style={{ fontSize: 10, fontWeight: 700, color, minWidth: 50 }}>{c.signal.replace('_', ' ')}</span>
      </div>
      <div style={{ fontSize: 10, color: MUTED, fontStyle: 'italic' }}>{c.insight}</div>
    </div>
  );
}

// ── Company card ──────────────────────────────────────────────────────────────
function CompanyCard({ r, defaultOpen, isDegraded }: { r: MultibaggerResult; defaultOpen: boolean; isDegraded?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const gradeColor = GRADE_COLOR[r.grade] || MUTED;
  const scoreColor = r.overallScore >= 72 ? GREEN : r.overallScore >= 54 ? YELLOW : RED;
  const isStatic = r.quality.source === 'Static';
  const borderColor = isStatic ? `${ORANGE}40` : r.isPortfolio ? 'rgba(167,139,250,0.35)' : r.isWatchlist ? 'rgba(56,189,248,0.2)' : BORDER;

  if (!r.quality.valid) {
    return (
      <div style={{ background: CARD_BG, border: `1px solid ${RED}30`, borderRadius: 10, marginBottom: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: MUTED }}>{r.symbol}</span>
        <span style={{ fontSize: 11, color: RED }}>⛔ {r.quality.reason}</span>
        <ConfBadge conf="VERY_LOW" />
      </div>
    );
  }

  const strongPositive = r.criteria.filter(c => c.signal === 'STRONG_BUY' || c.signal === 'BUY').length;
  const atRisk = r.criteria.filter(c => c.signal === 'AVOID' || c.signal === 'CAUTION').length;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${borderColor}`, borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
      {/* Card header */}
      <div onClick={() => setOpen(o => !o)} style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'center', minWidth: 36 }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: gradeColor, lineHeight: 1 }}>{r.grade}</div>
            <div style={{ fontSize: 8, color: MUTED, letterSpacing: '0.05em' }}>GRADE</div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: TEXT }}>{r.symbol}</span>
              {r.isPortfolio && <span style={{ fontSize: 9, color: PURPLE, background: 'rgba(167,139,250,0.15)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>PF</span>}
              {r.isWatchlist && !r.isPortfolio && <span style={{ fontSize: 9, color: ACCENT, background: 'rgba(56,189,248,0.12)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>WL</span>}
              <ConfBadge conf={r.quality.confidence} />
            </div>
            <div style={{ fontSize: 10, color: MUTED }}>{r.company.length > 30 ? r.company.slice(0, 30) + '…' : r.company} · {r.sector}</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              📊 {r.quality.coveragePct}% data · <span style={{ color: r.quality.source === 'Static' ? ORANGE : r.quality.source.includes('partial') ? YELLOW : MUTED }}>{r.quality.source}</span> · {strongPositive}✓ {atRisk}⚠
              {r.quality.source === 'Static' && <span style={{ fontSize: 8, color: ORANGE, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: `${ORANGE}15`, marginLeft: 2 }}>STALE DATA</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {r.lastPrice && <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>₹{r.lastPrice.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</div>
            {r.marketCapCr && r.marketCapCr > 0 && <div style={{ fontSize: 9, color: MUTED }}>₹{(r.marketCapCr / 100).toFixed(0)}B MCap</div>}
          </div>}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>
              {isDegraded && r.scoreRange ? `${r.scoreRange.low}-${r.scoreRange.high}` : r.overallScore}
            </div>
            <div style={{ fontSize: 8, color: MUTED }}>/ 100</div>
          </div>
          <span style={{ fontSize: 14, color: MUTED }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Red flags */}
          {r.redFlags.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: RED, marginBottom: 6 }}>⛔ RED FLAGS ({r.redFlags.length})</div>
              {r.redFlags.map(f => <FlagBadge key={f.id} flag={f} />)}
            </div>
          )}

          {/* Pillar scores */}
          {r.pillars.length > 0 && (
            <div style={{ marginBottom: 14, padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: PURPLE, marginBottom: 10, letterSpacing: '0.05em' }}>5-PILLAR BREAKDOWN</div>
              {r.pillars.map(p => <PillarBar key={p.id} pillar={p} />)}
            </div>
          )}

          {/* Score spectrum visualization */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: MUTED }}>Score spectrum ({r.criteria.length} criteria)</span>
              <span style={{ fontSize: 9, color: MUTED }}>
                <span style={{ color: SIG_COLOR.STRONG_BUY }}>■</span> Strong
                <span style={{ color: SIG_COLOR.BUY, marginLeft: 4 }}>■</span> Buy
                <span style={{ color: SIG_COLOR.NEUTRAL, marginLeft: 4 }}>■</span> Neutral
                <span style={{ color: SIG_COLOR.CAUTION, marginLeft: 4 }}>■</span> Caution
                <span style={{ color: SIG_COLOR.AVOID, marginLeft: 4 }}>■</span> Avoid
                {r.criteria.some(c => !c.dataAvailable) && <span style={{ opacity: 0.4, marginLeft: 4 }}>□</span>}
                {r.criteria.some(c => !c.dataAvailable) && ' N/A'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              {r.criteria.map(c => (
                <div key={c.id} title={`${c.label}: ${c.score} (${c.signal.replace('_',' ')})${!c.dataAvailable ? ' — No data' : ''}`}
                  style={{ flex: 1, height: 7, background: SIG_COLOR[c.signal], borderRadius: 3, opacity: c.dataAvailable ? 0.85 : 0.25 }} />
              ))}
            </div>
          </div>

          {/* Strengths / risks */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div style={{ padding: '10px 12px', background: `${GREEN}08`, borderRadius: 8, border: `1px solid ${GREEN}20` }}>
              <div style={{ fontSize: 10, color: GREEN, fontWeight: 700, marginBottom: 6 }}>💪 TOP STRENGTHS</div>
              {r.criteria.filter(c => c.signal === 'STRONG_BUY' || c.signal === 'BUY').sort((a, b) => b.score - a.score).slice(0, 4).map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: MUTED, maxWidth: '75%' }}>{c.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: SIG_COLOR[c.signal] }}>{c.score}</span>
                </div>
              ))}
              {strongPositive === 0 && <div style={{ fontSize: 10, color: MUTED }}>No strong positives</div>}
            </div>
            <div style={{ padding: '10px 12px', background: `${RED}06`, borderRadius: 8, border: `1px solid ${RED}18` }}>
              <div style={{ fontSize: 10, color: RED, fontWeight: 700, marginBottom: 6 }}>⚠ KEY RISKS</div>
              {r.criteria.filter(c => c.signal === 'AVOID' || c.signal === 'CAUTION').sort((a, b) => a.score - b.score).slice(0, 4).map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: MUTED, maxWidth: '75%' }}>{c.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: SIG_COLOR[c.signal] }}>{c.score}</span>
                </div>
              ))}
              {atRisk === 0 && <div style={{ fontSize: 10, color: MUTED }}>No major red flags</div>}
            </div>
          </div>

          {/* All criteria toggle */}
          <button onClick={() => setShowAll(s => !s)} style={{ fontSize: 11, color: PURPLE, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 7, padding: '5px 14px', cursor: 'pointer', width: '100%', marginBottom: showAll ? 10 : 0 }}>
            {showAll ? '▲ Collapse' : '▼ All criteria with sector percentiles'} ({r.criteria.length} metrics · Raw → Score → Signal)
          </button>
          {showAll && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 4, padding: '6px 0', marginBottom: 4 }}>
                {(['QUALITY', 'GROWTH', 'FIN_STRENGTH', 'VALUATION', 'MARKET'] as const).map(p => (
                  <div key={p} style={{ fontSize: 9, color: PILLAR_COLOR[p] || MUTED, textAlign: 'center', fontWeight: 700 }}>
                    {p.replace('_', ' ')}<br />
                    <span style={{ fontSize: 11, fontWeight: 900 }}>
                      {r.pillars.find(pl => pl.id === p)?.score ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
              {r.criteria.map(c => <CriterionRow key={c.id} c={c} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// MULTIBAGGER CHECKLIST — 21 criteria across 5 pillars
// Each item: what to check, ideal target, which pillar, weight
// ═══════════════════════════════════════════════════════════════════════════════

interface ChecklistItem {
  id: string; label: string; pillar: string; pillarColor: string;
  target: string; why: string; weight: number;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  // QUALITY (30%)
  { id: 'roce',        pillar: 'QUALITY', pillarColor: '#a78bfa', weight: 7, label: 'ROCE ≥ sector benchmark (ideally > 20%)', target: 'ROCE > 20% for most sectors; > 15% for capital-intensive', why: 'Return on Capital Employed is the #1 quality filter. High ROCE = pricing power + moat.' },
  { id: 'roe',         pillar: 'QUALITY', pillarColor: '#a78bfa', weight: 6, label: 'ROE ≥ 15% consistently (3yr average)', target: '> 15% consistently; > 20% for compounders', why: 'Measures management ability to generate returns from equity. Must be consistent, not one-off.' },
  { id: 'opm',         pillar: 'QUALITY', pillarColor: '#a78bfa', weight: 6, label: 'Operating Margin (OPM) stable or expanding', target: 'Sector-dependent; trending up is more important than absolute level', why: 'Expanding OPM = pricing power, operating leverage. Contracting = competitive pressure.' },
  { id: 'cfo',         pillar: 'QUALITY', pillarColor: '#a78bfa', weight: 5, label: 'CFO/PAT > 0.8 (cash conversion quality)', target: 'Cash Flow from Operations > 80% of reported profit', why: 'Profit without cash = accounting fiction. High CFO/PAT confirms earnings quality.' },
  { id: 'capital_alloc', pillar: 'QUALITY', pillarColor: '#a78bfa', weight: 4, label: 'Capital allocation track record — no value-destructive M&A', target: 'Debt-funded diversification = red flag; organic reinvestment preferred', why: 'Bad capital allocators destroy shareholder value even with good operations.' },
  { id: 'owner_op',    pillar: 'QUALITY', pillarColor: '#a78bfa', weight: 4, label: 'Owner-operator: promoter skin in the game', target: 'Promoter > 35%, ideally > 50%; holding stable or increasing', why: "Promoters with large stakes are aligned with shareholders. Watch for sell-offs — they know the business best." },
  { id: 'moat',        pillar: 'QUALITY', pillarColor: '#a78bfa', weight: 4, label: 'Moat indicators: pricing power / brand / switching cost', target: 'Can they raise prices without losing volume? Customers sticky?', why: 'Moats compound. Without one, ROCE will revert to mean as competition enters.' },

  // GROWTH (25%)
  { id: 'rev_cagr',    pillar: 'GROWTH', pillarColor: '#38bdf8', weight: 7, label: '5yr Revenue CAGR ≥ 15%', target: '> 15% CAGR; > 20% for high-multiple justify', why: 'Revenue growth is the engine. Profit growth without revenue growth is unsustainable.' },
  { id: 'profit_cagr', pillar: 'GROWTH', pillarColor: '#38bdf8', weight: 7, label: '5yr Profit CAGR ≥ 20% (faster than revenue = leverage)', target: '> 20% CAGR; ideally > revenue growth (operating leverage)', why: 'Profit CAGR > revenue CAGR signals operating leverage — the magic of scalable businesses.' },
  { id: 'yoy_growth',  pillar: 'GROWTH', pillarColor: '#38bdf8', weight: 6, label: 'Recent YoY growth positive and not decelerating', target: 'Latest 2 quarters showing growth; no sharp deceleration', why: 'Historical CAGR is lagging. Current quarter momentum confirms thesis is still live.' },
  { id: 'predictable', pillar: 'GROWTH', pillarColor: '#38bdf8', weight: 5, label: 'Growth predictability — not lumpy or cyclical without reason', target: 'Smooth growth curve; order book visibility; recurring revenue preferred', why: 'Lumpy growth creates earnings surprises and valuation traps. Predictability commands premium.' },

  // FINANCIAL STRENGTH (20%)
  { id: 'de',          pillar: 'FIN_STRENGTH', pillarColor: '#10b981', weight: 6, label: 'Debt/Equity ≤ 0.5 (or net cash)', target: 'D/E < 0.5 for most sectors; < 1.0 for capital-intensive (infra, power)', why: 'Leverage amplifies both gains and losses. Low D/E = resilience in downturns.' },
  { id: 'promoter',    pillar: 'FIN_STRENGTH', pillarColor: '#10b981', weight: 6, label: 'Promoter holding ≥ 35%, not declining', target: '> 35%; watch for consistent selling (red flag)', why: 'Promoter stake declining quarter-on-quarter is a warning sign even if holding is high.' },
  { id: 'pledge',      pillar: 'FIN_STRENGTH', pillarColor: '#10b981', weight: 5, label: 'Pledged shares ≤ 5% (ideally zero)', target: '< 5%; zero is best. > 25% = CRITICAL red flag', why: 'Pledged shares = promoter borrowing against company shares. Forced selling if stock falls.' },
  { id: 'icr',         pillar: 'FIN_STRENGTH', pillarColor: '#10b981', weight: 3, label: 'Interest Coverage Ratio ≥ 5x', target: '> 5x preferred; > 3x minimum; < 1.5x = CRITICAL', why: 'ICR measures ability to service debt. < 2x means earnings barely cover interest.' },

  // VALUATION (15%)
  { id: 'pe',          pillar: 'VALUATION', pillarColor: '#f59e0b', weight: 5, label: 'P/E ≤ 1.5× sector median (not expensive relative to peers)', target: 'Not the cheapest — but not paying 3× sector for average business', why: 'Relative valuation matters more than absolute. A cheap stock in a bad sector is still a trap.' },
  { id: 'pb',          pillar: 'VALUATION', pillarColor: '#f59e0b', weight: 3, label: 'P/B reasonable for ROE (P/B < ROE/10 rule of thumb)', target: 'P/B < 5× for most; P/B / ROE ratio < 0.2 is attractive', why: 'Price-to-Book without ROE context is meaningless. High ROE justifies high P/B.' },
  { id: 'mcap_zone',   pillar: 'VALUATION', pillarColor: '#f59e0b', weight: 4, label: 'Market cap in sweet spot: ₹500Cr–₹15,000Cr', target: 'Small/mid-cap with room to grow to ₹50,000Cr+ is the multibagger zone', why: 'A ₹500Cr company can 10× to ₹5,000Cr. A ₹50,000Cr company needs to become ₹5L Cr. Math matters.' },
  { id: 'fcf',         pillar: 'VALUATION', pillarColor: '#f59e0b', weight: 3, label: 'FCF positive — company generates cash, not just book profit', target: 'Free Cash Flow > 0 for at least 3 of last 5 years', why: 'FCF-generating companies can fund growth, pay dividends, or buyback without dilution.' },

  // MARKET/TECHNICAL (10%)
  { id: 'momentum',    pillar: 'MARKET', pillarColor: '#f97316', weight: 5, label: '52W momentum: stock not more than 40% below 52W high', target: 'Within 40% of 52W high; ideally making new highs', why: "Money flows toward strength. Stocks deep in bear territory need a catalyst to reverse — don't fight the tape." },
  { id: 'tailwind',    pillar: 'MARKET', pillarColor: '#f97316', weight: 5, label: 'Sector structural tailwind (not cyclical headwind)', target: 'Is the sector growing structurally? Defense, EMS, capital goods, pharma API, specialty chem', why: 'Tailwinds lift all boats. Being right on the stock in the wrong sector is painful.' },
];

// ── Per-stock checklist component ────────────────────────────────────────────

function MultibaggerChecklist({ liveResults }: { liveResults: MultibaggerResult[] }) {
  const [symbol, setSymbol] = useState('');
  const [activeSymbol, setActiveSymbol] = useState('');
  const [savedSymbols, setSavedSymbols] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const syms = JSON.parse(localStorage.getItem('mb_checklist_symbols') || '[]') as string[];
      setSavedSymbols(syms);
      if (syms.length > 0 && !activeSymbol) loadSymbol(syms[0]);
    } catch {}
  }, []);

  function loadSymbol(sym: string) {
    setActiveSymbol(sym);
    try { setChecks(JSON.parse(localStorage.getItem(`mb_checks_${sym}`) || '{}')); } catch { setChecks({}); }
    try { setNotes(JSON.parse(localStorage.getItem(`mb_notes_${sym}`) || '{}')); } catch { setNotes({}); }
  }
  function addSymbol() {
    const s = symbol.trim().toUpperCase();
    if (!s || savedSymbols.includes(s)) return;
    const next = [...savedSymbols, s];
    setSavedSymbols(next);
    localStorage.setItem('mb_checklist_symbols', JSON.stringify(next));
    loadSymbol(s);
    setSymbol('');
  }
  function removeSymbol(sym: string) {
    const next = savedSymbols.filter(x => x !== sym);
    setSavedSymbols(next);
    localStorage.setItem('mb_checklist_symbols', JSON.stringify(next));
    localStorage.removeItem(`mb_checks_${sym}`);
    localStorage.removeItem(`mb_notes_${sym}`);
    if (activeSymbol === sym) { setActiveSymbol(next[0] ?? ''); setChecks({}); setNotes({}); }
  }
  function toggleCheck(id: string) {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    if (activeSymbol) localStorage.setItem(`mb_checks_${activeSymbol}`, JSON.stringify(next));
  }
  function setNote(id: string, val: string) {
    const next = { ...notes, [id]: val };
    setNotes(next);
    if (activeSymbol) localStorage.setItem(`mb_notes_${activeSymbol}`, JSON.stringify(next));
  }

  // Auto-checks from live data
  const liveResult = liveResults.find(r => r.symbol.toUpperCase() === activeSymbol.toUpperCase());
  const autoChecks = useMemo((): Record<string, { pass: boolean; note: string } | null> => {
    if (!liveResult) return {};
    const criteria = Object.fromEntries(liveResult.criteria.map(c => [c.id, c]));
    const r: Record<string, { pass: boolean; note: string } | null> = {};
    const check = (id: string, mapId: string, passThreshold = 60) => {
      const c = criteria[mapId];
      if (!c?.dataAvailable) return;
      r[id] = { pass: c.score >= passThreshold, note: `Auto: ${c.rawDisplay} → score ${c.score}/100 (${c.signal.replace('_',' ')})` };
    };
    check('roce', 'roce'); check('roe', 'roe'); check('opm', 'opm');
    check('de', 'de'); check('promoter', 'promoter'); check('pledge', 'pledge'); check('icr', 'icr');
    check('pe', 'pe'); check('pb', 'pb'); check('fcf', 'fcf_quality');
    check('rev_cagr', 'revenue_cagr'); check('profit_cagr', 'profit_cagr');
    check('momentum', 'momentum_52w');
    // Market cap zone
    const mc = liveResult.marketCapCr;
    if (mc !== null) r['mcap_zone'] = { pass: mc >= 500 && mc <= 15000, note: `Auto: ₹${mc.toLocaleString()}Cr — ${mc >= 500 && mc <= 15000 ? '✅ in sweet spot' : '❌ outside ₹500–₹15000Cr zone'}` };
    // Red flags
    const hasHighPledge = liveResult.redFlags.some(f => f.id === 'pledge' || f.id.includes('pledge'));
    if (hasHighPledge) r['pledge'] = { pass: false, note: 'Auto: High pledge detected — RED FLAG' };
    return r;
  }, [liveResult]);

  const pillars = [...new Set(CHECKLIST_ITEMS.map(i => i.pillar))];
  const completed = CHECKLIST_ITEMS.filter(i => autoChecks[i.id]?.pass || checks[i.id]).length;
  const autoPassed = CHECKLIST_ITEMS.filter(i => autoChecks[i.id]?.pass).length;
  const total = CHECKLIST_ITEMS.length;
  const pct = Math.round((completed / total) * 100);
  const grade = pct >= 80 ? 'A+' : pct >= 68 ? 'A' : pct >= 55 ? 'B+' : pct >= 42 ? 'B' : pct >= 30 ? 'C' : 'D';

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '20px 16px' }}>
      {/* Add ticker */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && addSymbol()}
          placeholder="Add ticker (e.g. HBLENGINE)" maxLength={20}
          style={{ flex: '0 0 200px', padding: '8px 12px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT, fontSize: 13, fontWeight: 600, outline: 'none' }} />
        <button onClick={addSymbol} style={{ padding: '8px 14px', backgroundColor: `${PURPLE}20`, border: `1px solid ${PURPLE}40`, borderRadius: 8, color: PURPLE, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Add</button>
        {savedSymbols.map(s => (
          <div key={s} style={{ display: 'flex', borderRadius: 8, border: `1px solid ${activeSymbol === s ? `${PURPLE}60` : BORDER}`, overflow: 'hidden' }}>
            <button onClick={() => loadSymbol(s)} style={{ padding: '6px 12px', background: activeSymbol === s ? `${PURPLE}20` : 'transparent', border: 'none', cursor: 'pointer', color: activeSymbol === s ? PURPLE : MUTED, fontSize: 12, fontWeight: 700 }}>{s}</button>
            <button onClick={() => removeSymbol(s)} style={{ padding: '6px 8px', background: 'none', border: 'none', borderLeft: `1px solid ${BORDER}`, cursor: 'pointer', color: MUTED, fontSize: 11 }}>×</button>
          </div>
        ))}
      </div>

      {!activeSymbol ? (
        <div style={{ textAlign: 'center', padding: 48, color: MUTED }}>
          <div style={{ fontSize: 40 }}>📋</div>
          <div style={{ fontSize: 14, color: TEXT, fontWeight: 600, marginTop: 12 }}>Add a ticker to start your multibagger research checklist</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>21 criteria · 5 pillars · saves locally · auto-checks from live data where available</div>
        </div>
      ) : (
        <>
          {/* Progress */}
          <div style={{ marginBottom: 16, padding: '12px 16px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <span style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>{activeSymbol}</span>
                {liveResult && <span style={{ fontSize: 11, color: MUTED, marginLeft: 8 }}>{liveResult.company} · {liveResult.sector}</span>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: GRADE_COLOR[grade as Grade] ?? MUTED }}>{grade}</span>
                <span style={{ fontSize: 11, color: MUTED, marginLeft: 6 }}>{completed}/{total} ({pct}%)</span>
              </div>
            </div>
            <div style={{ height: 8, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct >= 70 ? GREEN : pct >= 50 ? YELLOW : RED, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <span style={{ fontSize: 10, color: GREEN }}>✅ {completed} passed</span>
              <span style={{ fontSize: 10, color: ACCENT }}>🤖 {autoPassed} auto-verified from live data</span>
              <span style={{ fontSize: 10, color: MUTED }}>{total - completed} remaining</span>
              {liveResult && <span style={{ fontSize: 10, color: MUTED, marginLeft: 'auto' }}>Live score: {liveResult.overallScore} · {liveResult.grade}</span>}
            </div>
          </div>

          {/* Checklist by pillar */}
          {pillars.map(pillar => {
            const items = CHECKLIST_ITEMS.filter(i => i.pillar === pillar);
            const pillarColor = items[0].pillarColor;
            const passed = items.filter(i => autoChecks[i.id]?.pass || checks[i.id]).length;
            return (
              <div key={pillar} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: pillarColor }}>{pillar.replace('_',' ')}</span>
                  <span style={{ fontSize: 9, color: MUTED }}>({passed}/{items.length} passed)</span>
                  <div style={{ flex: 1, height: 1, backgroundColor: `${pillarColor}20` }} />
                </div>
                {items.map(item => {
                  const auto = autoChecks[item.id];
                  const isChecked = auto?.pass || checks[item.id];
                  const isAuto = !!auto;
                  const isFail = auto && !auto.pass;
                  return (
                    <div key={item.id} style={{ marginBottom: 6, borderRadius: 8, border: `1px solid ${isChecked ? `${pillarColor}28` : isFail ? `${RED}28` : BORDER}`, backgroundColor: isChecked ? `${pillarColor}06` : isFail ? `${RED}04` : CARD_BG, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px' }}>
                        <button onClick={() => !isAuto && toggleCheck(item.id)} style={{ background: 'none', border: `1.5px solid ${isChecked ? pillarColor : isFail ? RED : MUTED}`, borderRadius: 4, width: 18, height: 18, cursor: isAuto ? 'default' : 'pointer', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isChecked ? pillarColor : isFail ? RED : 'transparent', fontSize: 11, fontWeight: 900 }}>
                          {isChecked ? '✓' : isFail ? '✗' : ''}
                        </button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, color: isChecked ? TEXT : isFail ? `${RED}CC` : TEXT, fontWeight: 500 }}>{item.label}</span>
                            {isAuto && <span style={{ fontSize: 8, fontWeight: 800, color: ACCENT, border: `1px solid ${ACCENT}30`, padding: '0 4px', borderRadius: 3 }}>AUTO</span>}
                            <span style={{ fontSize: 9, color: pillarColor, marginLeft: 'auto', fontWeight: 600 }}>wt {item.weight}%</span>
                          </div>
                          <div style={{ fontSize: 10, color: MUTED }}><strong>Target:</strong> {item.target}</div>
                          {auto?.note && <div style={{ fontSize: 10, color: isAuto && auto.pass ? GREEN : RED, marginTop: 2 }}>{auto.note}</div>}
                          {!isAuto && (
                            <input value={notes[item.id] || ''} onChange={e => setNote(item.id, e.target.value)}
                              placeholder={`Why checked? ${item.why.slice(0, 50)}...`}
                              style={{ width: '100%', marginTop: 6, padding: '4px 8px', backgroundColor: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, borderRadius: 5, color: MUTED, fontSize: 10, outline: 'none', boxSizing: 'border-box' }} />
                          )}
                        </div>
                      </div>
                      {/* Why it matters — collapsible */}
                      <div style={{ padding: '0 12px 8px 40px', fontSize: 10, color: `${MUTED}99` }}>{item.why}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL COMPARE — Client-side scoring from uploaded data
// Upload: Symbol, Company, Sector, ROCE, ROE, OPM, D/E, Rev CAGR, Profit CAGR,
//         Promoter%, Pledge%, ICR, PE, PB, Market Cap Cr, Price, 52W High
// ═══════════════════════════════════════════════════════════════════════════════

interface ExcelRow {
  symbol: string; company: string; sector: string;
  roce?: number; roe?: number; opm?: number; de?: number;
  revCagr?: number; profitCagr?: number; yoyRev?: number;
  promoter?: number; pledge?: number; icr?: number;
  pe?: number; pb?: number; marketCapCr?: number;
  price?: number; high52w?: number;
}

interface ExcelResult extends ExcelRow {
  score: number; grade: Grade;
  pillarScores: { id: string; label: string; score: number; color: string }[];
  redFlags: { label: string; severity: 'CRITICAL'|'HIGH'|'MEDIUM' }[];
  strengths: string[]; risks: string[];
}

// Simplified sector benchmarks (ROCE, OPM, PE, Rev Growth — [p25, median, p75])
const SBENCH: Record<string, { roce: number[]; opm: number[]; pe: number[]; rg: number[] }> = {
  TECHNOLOGY:   { roce: [20,28,38], opm: [18,25,35], pe: [25,35,55], rg: [12,20,30] },
  PHARMA:       { roce: [15,22,32], opm: [15,22,30], pe: [20,30,45], rg: [10,15,22] },
  BANKING_FIN:  { roce: [12,16,22], opm: [20,30,40], pe: [12,18,28], rg: [12,18,25] },
  INDUSTRIALS:  { roce: [14,20,28], opm: [8,12,18],  pe: [18,26,40], rg: [10,16,24] },
  CONSUMER:     { roce: [16,24,34], opm: [10,16,22], pe: [22,32,50], rg: [8,15,22]  },
  CHEMICALS:    { roce: [15,22,30], opm: [12,18,25], pe: [18,28,42], rg: [10,18,28] },
  AUTO:         { roce: [14,20,28], opm: [8,12,18],  pe: [15,22,35], rg: [8,14,22]  },
  INFRA:        { roce: [10,15,22], opm: [12,18,26], pe: [15,22,38], rg: [10,16,24] },
  DEFAULT:      { roce: [14,20,28], opm: [10,15,22], pe: [18,26,42], rg: [10,16,24] },
};

function getSectorKey(sector: string): string {
  const s = sector.toUpperCase();
  if (s.includes('TECH') || s.includes('SOFTWARE') || s.includes('IT ') || s === 'IT') return 'TECHNOLOGY';
  if (s.includes('PHARMA') || s.includes('DRUG') || s.includes('HEALTH')) return 'PHARMA';
  if (s.includes('BANK') || s.includes('FINANCE') || s.includes('NBFC') || s.includes('INSURANCE')) return 'BANKING_FIN';
  if (s.includes('CHEM') || s.includes('SPECIALTY')) return 'CHEMICALS';
  if (s.includes('AUTO') || s.includes('VEHICLE')) return 'AUTO';
  if (s.includes('CONSUMER') || s.includes('FMCG') || s.includes('RETAIL')) return 'CONSUMER';
  if (s.includes('INFRA') || s.includes('CONSTRUCT') || s.includes('REAL')) return 'INFRA';
  return 'INDUSTRIALS';
}

function scoreValue(v: number | undefined, bench: number[], hiGood = true): number {
  if (v === undefined || v === null || isNaN(v)) return 0;
  const [lo, mid, hi] = hiGood ? bench : bench.map(x => -x);
  const val = hiGood ? v : -v;
  if (val >= hi) return Math.min(100, 88 + (val - hi) * 0.4);
  if (val >= mid) return 72 + ((val - mid) / (hi - mid)) * 16;
  if (val >= lo) return 50 + ((val - lo) / (mid - lo)) * 22;
  return Math.max(0, 30 + (val / lo) * 20);
}

function scoreExcelRow(row: ExcelRow): ExcelResult {
  const b = SBENCH[getSectorKey(row.sector)] ?? SBENCH.DEFAULT;
  let qualScore = 0, qualCnt = 0;
  let growthScore = 0, growthCnt = 0;
  let finScore = 0, finCnt = 0;
  let valScore = 0, valCnt = 0;
  let mktScore = 50, mktCnt = 1; // default baseline

  const strengths: string[] = [];
  const risks: string[] = [];
  const redFlags: { label: string; severity: 'CRITICAL'|'HIGH'|'MEDIUM' }[] = [];

  // QUALITY
  if (row.roce !== undefined) { const s = scoreValue(row.roce, b.roce); qualScore += s; qualCnt++; if (s >= 75) strengths.push(`ROCE ${row.roce}% — strong`); else if (s < 50) risks.push(`ROCE ${row.roce}% — below sector`); }
  if (row.roe  !== undefined) { const s = scoreValue(row.roe,  [12,18,26]); qualScore += s; qualCnt++; if (s >= 75) strengths.push(`ROE ${row.roe}% — high`); }
  if (row.opm  !== undefined) { const s = scoreValue(row.opm,  b.opm); qualScore += s; qualCnt++; }

  // GROWTH
  if (row.revCagr    !== undefined) { const s = scoreValue(row.revCagr,    [8,15,25]); growthScore += s; growthCnt++; if (s >= 75) strengths.push(`Rev CAGR ${row.revCagr}% — excellent`); }
  if (row.profitCagr !== undefined) { const s = scoreValue(row.profitCagr, [10,20,30]); growthScore += s; growthCnt++; if (s >= 80) strengths.push(`Profit CAGR ${row.profitCagr}% — compounding`); }
  if (row.yoyRev     !== undefined) { const s = scoreValue(row.yoyRev,     [5,12,22]);  growthScore += s; growthCnt++; }

  // FIN STRENGTH
  if (row.de       !== undefined) { const s = scoreValue(row.de,       [0.5,1.0,2.0], false); finScore += s; finCnt++; if (row.de > 2.0) redFlags.push({ label: `D/E ${row.de}× — HIGH DEBT`, severity: 'HIGH' }); if (row.de > 3.0) redFlags.push({ label: `D/E ${row.de}× — CRITICAL DEBT`, severity: 'CRITICAL' }); }
  if (row.promoter !== undefined) { const s = scoreValue(row.promoter, [20,40,60]); finScore += s; finCnt++; if (row.promoter < 20) redFlags.push({ label: `Promoter ${row.promoter}% — very low`, severity: 'HIGH' }); }
  if (row.pledge   !== undefined) { const s = scoreValue(row.pledge,   [5,15,30], false); finScore += s; finCnt++; if (row.pledge > 50) redFlags.push({ label: `Pledge ${row.pledge}% — CRITICAL`, severity: 'CRITICAL' }); else if (row.pledge > 25) redFlags.push({ label: `Pledge ${row.pledge}% — risky`, severity: 'HIGH' }); if (row.pledge < 5) strengths.push(`Pledge ${row.pledge}% — minimal risk`); }
  if (row.icr      !== undefined) { const s = scoreValue(row.icr,      [1.5,4,8]); finScore += s; finCnt++; if (row.icr < 1.5) redFlags.push({ label: `ICR ${row.icr}× — dangerously low`, severity: 'CRITICAL' }); }

  // VALUATION
  if (row.pe !== undefined) { const s = scoreValue(row.pe, b.pe, false); valScore += s; valCnt++; if (row.pe > 150) redFlags.push({ label: `P/E ${row.pe}× — extreme valuation`, severity: 'MEDIUM' }); }
  if (row.pb !== undefined) { const s = scoreValue(row.pb, [1,3,6], false); valScore += s; valCnt++; }
  if (row.marketCapCr !== undefined) {
    const inZone = row.marketCapCr >= 500 && row.marketCapCr <= 15000;
    valScore += inZone ? 78 : row.marketCapCr < 200 ? 45 : 55; valCnt++;
    if (inZone) strengths.push(`Market cap ₹${row.marketCapCr.toLocaleString()}Cr — sweet spot`);
  }

  // MARKET
  if (row.price !== undefined && row.high52w !== undefined && row.high52w > 0) {
    const pct = (row.price / row.high52w) * 100;
    mktScore = pct >= 90 ? 88 : pct >= 70 ? 70 : pct >= 50 ? 50 : 30;
    mktCnt = 1;
    if (pct < 50) risks.push(`Stock ${Math.round(100 - pct)}% below 52W high — deep drawdown`);
  }

  const qual = qualCnt > 0 ? qualScore / qualCnt : 50;
  const growth = growthCnt > 0 ? growthScore / growthCnt : 50;
  const fin = finCnt > 0 ? finScore / finCnt : 50;
  const val = valCnt > 0 ? valScore / valCnt : 50;
  const mkt = mktScore;

  // Coverage ratio affects score (like the backend)
  const totalCnt = qualCnt + growthCnt + finCnt + valCnt + mktCnt;
  const maxCnt = 13; // total possible criteria
  const coverageRatio = Math.min(1, totalCnt / maxCnt);
  const rawScore = qual * 0.30 + growth * 0.25 + fin * 0.20 + val * 0.15 + mkt * 0.10;
  const penalized = rawScore * (0.6 + coverageRatio * 0.4); // gentler penalty than backend

  // Red flag overrides
  const hasCritical = redFlags.some(f => f.severity === 'CRITICAL');
  const highFlags = redFlags.filter(f => f.severity === 'HIGH').length;
  let effectiveScore = Math.round(penalized / 5) * 5;
  if (hasCritical) effectiveScore = Math.min(effectiveScore, 40);
  else if (highFlags >= 2) effectiveScore = Math.min(effectiveScore, 50);
  else if (highFlags === 1) effectiveScore = Math.min(effectiveScore, 62);

  const grade: Grade = effectiveScore >= 80 ? 'A+' : effectiveScore >= 72 ? 'A' : effectiveScore >= 63 ? 'B+' : effectiveScore >= 54 ? 'B' : effectiveScore >= 42 ? 'C' : 'D';

  const pillarScores = [
    { id: 'QUALITY', label: 'Quality', score: Math.round(qual), color: '#a78bfa' },
    { id: 'GROWTH', label: 'Growth', score: Math.round(growth), color: '#38bdf8' },
    { id: 'FIN_STRENGTH', label: 'Fin Strength', score: Math.round(fin), color: '#10b981' },
    { id: 'VALUATION', label: 'Valuation', score: Math.round(val), color: '#f59e0b' },
    { id: 'MARKET', label: 'Market', score: Math.round(mkt), color: '#f97316' },
  ];

  return { ...row, score: effectiveScore, grade, pillarScores, redFlags, strengths, risks };
}

function ExcelCompare() {
  const [rows, setRows] = useState<ExcelResult[]>([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expRow, setExpRow] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const REQUIRED_COLS = ['Symbol','ROCE','ROE','OPM','D/E','Rev CAGR','Profit CAGR','Promoter%','Pledge%','PE','Market Cap Cr'];
  const OPTIONAL_COLS = ['Company','Sector','ICR','PB','Price','52W High','YoY Rev'];

  async function handleFile(file: File) {
    setLoading(true); setParseError(''); setRows([]);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (raw.length === 0) { setParseError('No data rows found in the file.'); setLoading(false); return; }

      // Case-insensitive column mapping
      const colMap: Record<string, string> = {};
      const sampleRow = raw[0] as Record<string, unknown>;
      for (const col of Object.keys(sampleRow)) {
        const c = col.trim().toLowerCase().replace(/[^a-z0-9%]/g, '');
        const orig = col.trim();
        // Screener.in exact matches first
        if (orig === 'NSE Code' || orig === 'NSE code') colMap['symbol'] = col;
        else if (orig === 'Name') colMap['company'] = col;
        else if (orig === 'Industry' || orig === 'Industry Group') { if (!colMap['sector']) colMap['sector'] = col; }
        else if (orig === 'Return on capital employed') colMap['roce'] = col;
        else if (orig === 'Return on equity') colMap['roe'] = col;
        else if (orig === 'Return on invested capital') { if (!colMap['roe']) colMap['roe'] = col; }
        else if (orig === 'OPM') colMap['opm'] = col;
        else if (orig === 'Debt to equity') colMap['de'] = col;
        else if (orig === 'Sales growth') colMap['revCagr'] = col;
        else if (orig === 'Profit growth') colMap['profitCagr'] = col;
        else if (orig === 'YOY Quarterly sales growth') colMap['yoyRev'] = col;
        else if (orig === 'Promoter holding') colMap['promoter'] = col;
        else if (orig === 'Price to Earning') colMap['pe'] = col;
        else if (orig === 'Market Capitalization') colMap['marketCapCr'] = col;
        else if (orig === 'Current Price') colMap['price'] = col;
        else if (orig === 'DMA 200') colMap['high52w'] = col; // use DMA200 as momentum proxy
        // Generic fallback
        else if (!colMap['symbol'] && (c.includes('nsecode') || c.includes('symbol') || c.includes('ticker'))) colMap['symbol'] = col;
        else if (!colMap['company'] && (c.includes('company') || (c.includes('name') && !c.includes('sector')))) colMap['company'] = col;
        else if (!colMap['sector'] && (c.includes('sector') || c.includes('industry'))) colMap['sector'] = col;
        else if (!colMap['roce'] && (c === 'roce' || c.includes('returnoncap') || c.includes('returnoncapital'))) colMap['roce'] = col;
        else if (!colMap['roe'] && (c === 'roe' || c.includes('returnonequit'))) colMap['roe'] = col;
        else if (!colMap['opm'] && (c === 'opm' || c.includes('operatingmargin'))) colMap['opm'] = col;
        else if (!colMap['de'] && (c.includes('debttoequit') || c.includes('debt/equity') || c === 'de')) colMap['de'] = col;
        else if (!colMap['revCagr'] && (c.includes('salescagr') || c.includes('revcagr') || c.includes('revenuecagr'))) colMap['revCagr'] = col;
        else if (!colMap['profitCagr'] && (c.includes('profitcagr') || c.includes('patcagr'))) colMap['profitCagr'] = col;
        else if (!colMap['yoyRev'] && (c.includes('yoyrev') || c.includes('yoygrowth'))) colMap['yoyRev'] = col;
        else if (!colMap['promoter'] && c.includes('promoter') && !c.includes('pledge')) colMap['promoter'] = col;
        else if (!colMap['pledge'] && c.includes('pledge')) colMap['pledge'] = col;
        else if (!colMap['icr'] && (c.includes('icr') || c.includes('interestcoverage'))) colMap['icr'] = col;
        else if (!colMap['pe'] && (c === 'pe' || c.includes('priceearning') || c.includes('p/e'))) colMap['pe'] = col;
        else if (!colMap['pb'] && (c === 'pb' || c.includes('pricebook') || c.includes('p/b'))) colMap['pb'] = col;
        else if (!colMap['marketCapCr'] && c.includes('marketcap')) colMap['marketCapCr'] = col;
        else if (!colMap['price'] && c.includes('currentprice')) colMap['price'] = col;
        else if (!colMap['high52w'] && (c.includes('52') || c.includes('dma200') || c.includes('yearhigh'))) colMap['high52w'] = col;
      }

      if (!colMap['symbol']) { setParseError('Could not find a Symbol/Ticker column. Please check column headers match the template.'); setLoading(false); return; }

      const n = (val: unknown): number | undefined => {
        if (val === '' || val === null || val === undefined) return undefined;
        const v = parseFloat(String(val).replace(/[%,₹]/g, ''));
        return isNaN(v) ? undefined : v;
      };

      const scored: ExcelResult[] = (raw as Record<string, unknown>[]).map(row => {
        const r: ExcelRow = {
          symbol: String(row[colMap['symbol']] || '').trim().toUpperCase(),
          company: String(row[colMap['company'] ?? ''] || '').trim(),
          sector: String(row[colMap['sector'] ?? ''] || 'INDUSTRIALS').trim(),
          roce: n(colMap['roce'] ? row[colMap['roce']] : undefined),
          roe: n(colMap['roe'] ? row[colMap['roe']] : undefined),
          opm: n(colMap['opm'] ? row[colMap['opm']] : undefined),
          de: n(colMap['de'] ? row[colMap['de']] : undefined),
          revCagr: n(colMap['revCagr'] ? row[colMap['revCagr']] : undefined),
          profitCagr: n(colMap['profitCagr'] ? row[colMap['profitCagr']] : undefined),
          yoyRev: n(colMap['yoyRev'] ? row[colMap['yoyRev']] : undefined),
          promoter: n(colMap['promoter'] ? row[colMap['promoter']] : undefined),
          pledge: n(colMap['pledge'] ? row[colMap['pledge']] : undefined),
          icr: n(colMap['icr'] ? row[colMap['icr']] : undefined),
          pe: n(colMap['pe'] ? row[colMap['pe']] : undefined),
          pb: n(colMap['pb'] ? row[colMap['pb']] : undefined),
          marketCapCr: n(colMap['marketCapCr'] ? row[colMap['marketCapCr']] : undefined),
          price: n(colMap['price'] ? row[colMap['price']] : undefined),
          high52w: n(colMap['high52w'] ? row[colMap['high52w']] : undefined),
        };
        return scoreExcelRow(r);
      }).filter(r => r.symbol).sort((a, b) => b.score - a.score);

      setRows(scored);
      setFileName(file.name);
    } catch (e: unknown) {
      setParseError(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  }

  const topPicks = rows.filter(r => r.score >= 63);

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '20px 16px' }}>
      {/* Instructions */}
      <div style={{ marginBottom: 16, padding: '14px 16px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: PURPLE, marginBottom: 8 }}>📊 Upload your own fundamental data — bypass scraping entirely</div>
        <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.7, marginBottom: 8 }}>
          Export data from <strong style={{ color: TEXT }}>Screener.in</strong>, <strong style={{ color: TEXT }}>Trendlyne</strong>, <strong style={{ color: TEXT }}>Tickertape</strong>, or your own research.
          The system runs the 5-pillar scoring engine against your data — you control the data quality.
        </div>
        <div style={{ fontSize: 10, color: MUTED, fontFamily: 'monospace', padding: '8px 10px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 6, lineHeight: 1.8 }}>
          <strong style={{ color: ACCENT }}>Required columns:</strong> {REQUIRED_COLS.join(' | ')}<br/>
          <strong style={{ color: MUTED }}>Optional:</strong> {OPTIONAL_COLS.join(' | ')}<br/>
          <strong style={{ color: YELLOW }}>Formats:</strong> .xlsx, .csv · Numbers only (no ₹ or % needed) · D/E as decimal (0.5) · CAGRs as % (15 not 0.15)
        </div>
      </div>

      {/* Upload zone */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        style={{ marginBottom: 16, padding: '28px 20px', border: `2px dashed ${PURPLE}40`, borderRadius: 12, textAlign: 'center', cursor: 'pointer', backgroundColor: `${PURPLE}05`, transition: 'all 0.15s' }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>{loading ? '⏳' : '📁'}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: PURPLE }}>{loading ? 'Scoring...' : fileName ? `✅ ${fileName}` : 'Click to upload or drag & drop'}</div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>.xlsx or .csv · any number of stocks</div>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      {parseError && <div style={{ marginBottom: 12, padding: '10px 14px', backgroundColor: `${RED}10`, border: `1px solid ${RED}30`, borderRadius: 8, fontSize: 12, color: RED }}>{parseError}</div>}

      {rows.length > 0 && (
        <>
          {/* Summary */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: 'Analysed', value: rows.length, color: PURPLE },
              { label: 'Top Picks (B+ or better)', value: topPicks.length, color: GREEN },
              { label: 'Best Score', value: rows[0]?.score ?? 0, color: rows[0]?.score >= 72 ? GREEN : YELLOW },
              { label: 'Avg Score', value: Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length), color: MUTED },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ padding: '8px 14px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 900, color }}>{value}</div>
                <div style={{ fontSize: 9, color: MUTED }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 60px 60px 1fr 100px', gap: 8, padding: '6px 10px', fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
            <span>TICKER</span><span>COMPANY</span><span>SCORE</span><span>GRADE</span><span>PILLARS</span><span>FLAGS</span>
          </div>

          {rows.map((r, idx) => {
            const isExp = expRow === r.symbol;
            const hasCrit = r.redFlags.some(f => f.severity === 'CRITICAL');
            return (
              <div key={r.symbol + idx} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                <button onClick={() => setExpRow(isExp ? null : r.symbol)} style={{ width: '100%', background: isExp ? `${CARD_BG}` : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '10px 10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 60px 60px 1fr 100px', gap: 8, alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 800, color: hasCrit ? RED : TEXT }}>{r.symbol}</span>
                      {idx < 3 && <span style={{ fontSize: 9, marginLeft: 4 }}>⭐</span>}
                    </div>
                    <span style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company || '—'}</span>
                    <span style={{ fontSize: 16, fontWeight: 900, color: GRADE_COLOR[r.grade] ?? MUTED }}>{r.score}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, padding: '2px 8px', borderRadius: 5, color: GRADE_COLOR[r.grade], backgroundColor: `${GRADE_COLOR[r.grade]}18`, border: `1px solid ${GRADE_COLOR[r.grade]}30`, textAlign: 'center' }}>{r.grade}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {r.pillarScores.map(p => (
                        <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 28 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: p.color }}>{p.score}</span>
                          <div style={{ width: 20, height: 4, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${p.score}%`, backgroundColor: p.color }} />
                          </div>
                          <span style={{ fontSize: 7, color: MUTED }}>{p.label.split(' ')[0].slice(0,4)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {r.redFlags.slice(0,2).map((f, i) => <span key={i} style={{ fontSize: 8, color: f.severity === 'CRITICAL' ? RED : f.severity === 'HIGH' ? ORANGE : YELLOW, padding: '1px 4px', border: `1px solid ${f.severity === 'CRITICAL' ? RED : f.severity === 'HIGH' ? ORANGE : YELLOW}30`, borderRadius: 3 }}>⚠</span>)}
                      {r.redFlags.length === 0 && <span style={{ fontSize: 9, color: GREEN }}>✓ clean</span>}
                    </div>
                  </div>
                </button>

                {isExp && (
                  <div style={{ padding: '10px 10px 14px', backgroundColor: `${CARD_BG}80`, borderTop: `1px solid ${BORDER}` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 12, marginBottom: 10 }}>
                      {/* Key metrics */}
                      <div>
                        <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: '0.8px', marginBottom: 5 }}>KEY METRICS</div>
                        {[
                          { label: 'ROCE', val: r.roce, unit: '%' }, { label: 'ROE', val: r.roe, unit: '%' },
                          { label: 'OPM', val: r.opm, unit: '%' }, { label: 'D/E', val: r.de, unit: '×' },
                          { label: 'Rev CAGR', val: r.revCagr, unit: '%' }, { label: 'Profit CAGR', val: r.profitCagr, unit: '%' },
                          { label: 'Promoter', val: r.promoter, unit: '%' }, { label: 'Pledge', val: r.pledge, unit: '%' },
                          { label: 'P/E', val: r.pe, unit: '×' }, { label: 'Mkt Cap', val: r.marketCapCr, unit: '₹Cr' },
                        ].filter(m => m.val !== undefined).map(m => (
                          <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '2px 0', borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                            <span style={{ color: MUTED }}>{m.label}</span>
                            <span style={{ color: TEXT, fontWeight: 600 }}>{m.val}{m.unit}</span>
                          </div>
                        ))}
                      </div>
                      {/* Strengths/risks/flags */}
                      <div>
                        {r.strengths.length > 0 && <>
                          <div style={{ fontSize: 9, color: GREEN, fontWeight: 700, letterSpacing: '0.8px', marginBottom: 4 }}>✅ STRENGTHS</div>
                          {r.strengths.map((s, i) => <div key={i} style={{ fontSize: 10, color: MUTED, padding: '2px 0' }}>› {s}</div>)}
                        </>}
                        {r.risks.length > 0 && <>
                          <div style={{ fontSize: 9, color: ORANGE, fontWeight: 700, letterSpacing: '0.8px', marginTop: 8, marginBottom: 4 }}>⚠️ RISKS</div>
                          {r.risks.map((s, i) => <div key={i} style={{ fontSize: 10, color: MUTED, padding: '2px 0' }}>› {s}</div>)}
                        </>}
                        {r.redFlags.length > 0 && <>
                          <div style={{ fontSize: 9, color: RED, fontWeight: 700, letterSpacing: '0.8px', marginTop: 8, marginBottom: 4 }}>🚨 RED FLAGS</div>
                          {r.redFlags.map((f, i) => <div key={i} style={{ fontSize: 10, color: f.severity === 'CRITICAL' ? RED : ORANGE, padding: '2px 0' }}>⛔ {f.label}</div>)}
                        </>}
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: MUTED, borderTop: `1px solid ${BORDER}`, paddingTop: 6 }}>
                      Data coverage: {[r.roce,r.roe,r.opm,r.de,r.revCagr,r.profitCagr,r.promoter,r.pledge,r.pe,r.marketCapCr].filter(v => v !== undefined).length}/10 fields · Sector: {r.sector || 'INDUSTRIALS'}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {!rows.length && !loading && !parseError && (
        <div style={{ textAlign: 'center', padding: 40, color: MUTED }}>
          <div style={{ fontSize: 32 }}>📤</div>
          <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, marginTop: 10 }}>Upload your Excel / CSV to get instant scoring</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>The same 5-pillar algorithm used in the Scorecard tab — but YOUR data, so no scraping failures</div>
        </div>
      )}
    </div>
  );
}

export default function MultibaggerPage() {
  const [activeTab, setActiveTab] = useState<'scorecard' | 'checklist' | 'excel'>('scorecard');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'portfolio' | 'watchlist'>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showMethodology, setShowMethodology] = useState(true);
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let portfolio: string[] = [];
      let watchlist: string[] = [];
      try {
        const [pRes, wRes] = await Promise.all([
          fetch(`/api/portfolio?chatId=${CHAT_ID}`),
          fetch(`/api/watchlist?chatId=${CHAT_ID}`),
        ]);
        if (pRes.ok) {
          const pData = await pRes.json();
          portfolio = (pData.holdings || pData.portfolio || []).map((h: any) => String(h.symbol || h.ticker || h).toUpperCase()).filter(Boolean);
        }
        if (wRes.ok) {
          const wData = await wRes.json();
          const raw = wData.watchlist || wData.items || wData;
          if (Array.isArray(raw)) {
            watchlist = raw.map((h: any) => String(typeof h === 'string' ? h : (h.symbol || h.ticker || '')).toUpperCase()).filter(Boolean);
          }
        }
      } catch { /* no-op */ }

      const params = new URLSearchParams();
      if (portfolio.length) params.set('portfolio', portfolio.join(','));
      if (watchlist.length) params.set('watchlist', watchlist.join(','));
      const resp = await fetch(`/api/market/multibagger?${params}`, { cache: 'no-store' });
      if (!resp.ok) throw new Error(resp.status === 504 ? 'Analysis timed out — large watchlist. Retry (results may be partial).' : `API ${resp.status}`);
      setData(await resp.json());
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to load multibagger analysis');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const allResults = data?.results || [];
  const validResults = allResults.filter(r => r.quality.valid);
  const invalidResults = allResults.filter(r => !r.quality.valid);
  const eligibleResults = validResults.filter(r => r.quality.coveragePct >= 50 && r.grade !== 'NR');
  const ineligibleResults = validResults.filter(r => r.quality.coveragePct < 50 || r.grade === 'NR');
  const isDegraded = data?.degradedMode || (validResults.length > 0 && eligibleResults.length === 0);

  // In degraded mode, always show all valid results regardless of eligibleOnly toggle
  const effectiveEligibleOnly = isDegraded ? false : eligibleOnly;
  const filtered = (effectiveEligibleOnly ? eligibleResults : validResults).filter(r => {
    if (filter === 'portfolio' && !r.isPortfolio) return false;
    if (filter === 'watchlist' && !r.isWatchlist) return false;
    if (gradeFilter !== 'all' && r.grade !== gradeFilter) return false;
    return true;
  });

  const GRADES: Grade[] = ['A+', 'A', 'B+', 'B', 'C', 'D'];

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Page header + tabs */}
      <div style={{ backgroundColor: '#13131a', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '16px 20px 0' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 900, color: PURPLE, margin: 0 }}>🚀 Multibagger</h1>
              <p style={{ fontSize: 11, color: MUTED, margin: '3px 0 0' }}>5-Pillar scoring · 21-point checklist · Excel compare</p>
            </div>
            {activeTab === 'scorecard' && (
              <button onClick={fetchData} disabled={loading} style={{ fontSize: 11, color: PURPLE, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 8, padding: '7px 14px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                {loading ? '⟳ Analyzing...' : '↻ Refresh'}
              </button>
            )}
          </div>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0 }}>
            {[
              { id: 'scorecard', label: '📊 Scorecard', desc: 'Portfolio/Watchlist live scoring' },
              { id: 'checklist', label: '📋 Checklist', desc: '21-point research checklist per stock' },
              { id: 'excel',     label: '📤 Excel Compare', desc: 'Upload CSV → instant scoring' },
            ].map(tab => {
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as typeof activeTab)} style={{ padding: '9px 18px', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: active ? PURPLE : MUTED, fontSize: 13, fontWeight: active ? 700 : 400, borderBottom: active ? `2px solid ${PURPLE}` : '2px solid transparent', marginBottom: -1, flexShrink: 0, transition: 'all 0.15s' }}>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Checklist and Excel tabs */}
      {activeTab === 'checklist' && <MultibaggerChecklist liveResults={data?.results || []} />}
      {activeTab === 'excel' && <ExcelCompare />}

      {/* Scorecard tab — existing content */}
      {activeTab === 'scorecard' && <div style={{ maxWidth: 880, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div />

          {/* Stats */}
          {data?.meta && !loading && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, padding: '10px 14px', background: CARD_BG, borderRadius: 8, border: `1px solid ${BORDER}` }}>
              {[
                { label: 'Companies', value: data.meta.valid, color: PURPLE },
                { label: 'Top Picks', value: data.meta.topPicks, color: GREEN },
                { label: 'Best Score', value: data.meta.topScore, color: data.meta.topScore >= 72 ? GREEN : YELLOW },
                { label: 'Avg Score', value: data.meta.avgScore, color: data.meta.avgScore >= 60 ? GREEN : YELLOW },
                { label: 'Invalid', value: data.meta.total - data.meta.valid, color: MUTED },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color }}>{value}</span>
                  <span style={{ fontSize: 10, color: MUTED }}>{label}</span>
                </div>
              ))}
              {lastRefresh && <span style={{ fontSize: 10, color: MUTED, marginLeft: 'auto', alignSelf: 'center' }}>at {lastRefresh.toLocaleTimeString()}</span>}
            </div>
          )}
        </div>

        {/* Degraded mode banner */}
        {!loading && isDegraded && (
          <div style={{ marginBottom: 12, padding: '10px 14px', background: `${ORANGE}10`, border: `1px solid ${ORANGE}30`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 12, color: ORANGE, fontWeight: 700 }}>⚠️ INSUFFICIENT DATA FOR SCORING — Rankings below are low-confidence estimates. Verify independently before any investment decision.</div>
              <div style={{ fontSize: 10, color: MUTED }}>
                {ineligibleResults.length} of {validResults.length} companies have insufficient data for reliable scoring.
                {eligibleOnly ? ' Showing eligible only.' : ' Showing all — low-confidence scores visible.'}
              </div>
            </div>
          </div>
        )}

        {/* Diagnostics panel */}
        {!loading && data?.meta && (
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => setShowDiagnostics(s => !s)} style={{ fontSize: 10, color: MUTED, background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '3px 10px', cursor: 'pointer', marginBottom: showDiagnostics ? 8 : 0 }}>
              {showDiagnostics ? '▲' : '▼'} System Health
            </button>
            {showDiagnostics && (
              <div style={{ padding: '10px 14px', background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { label: 'Total Universe', value: allResults.length, color: MUTED },
                  { label: 'Eligible Ranked', value: eligibleResults.length, color: GREEN },
                  { label: 'Insufficient Data', value: ineligibleResults.length, color: ORANGE },
                  { label: 'Validation Failures', value: invalidResults.length, color: RED },
                  { label: 'Top Picks (A/A+)', value: data.meta.topPicks, color: GREEN },
                  { label: 'Avg Coverage', value: validResults.length > 0 ? `${Math.round(validResults.reduce((a, r) => a + r.quality.coveragePct, 0) / validResults.length)}%` : '0%', color: YELLOW },
                  { label: 'High Confidence', value: validResults.filter(r => r.quality.confidence === 'HIGH').length, color: GREEN },
                  { label: 'Last Refresh', value: lastRefresh ? lastRefresh.toLocaleTimeString() : '—', color: MUTED },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
                    <div style={{ fontSize: 9, color: MUTED }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {(['all', 'portfolio', 'watchlist'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 11px', borderRadius: 8, border: `1px solid ${filter === f ? PURPLE : BORDER}`, background: filter === f ? 'rgba(167,139,250,0.15)' : 'transparent', color: filter === f ? PURPLE : MUTED, cursor: 'pointer', textTransform: 'uppercase' }}>
              {f === 'portfolio' ? '💼 Portfolio' : f === 'watchlist' ? '👁 Watchlist' : 'All'}
            </button>
          ))}
          <div style={{ width: 1, background: BORDER }} />
          <button onClick={() => setEligibleOnly(e => !e)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 11px', borderRadius: 8, border: `1px solid ${eligibleOnly ? GREEN : BORDER}`, background: eligibleOnly ? `${GREEN}15` : 'transparent', color: eligibleOnly ? GREEN : MUTED, cursor: 'pointer' }}>
            {eligibleOnly ? '✓ Eligible Only' : 'Show All'}
          </button>
          <div style={{ width: 1, background: BORDER }} />
          {(['all', ...GRADES] as const).map(g => (
            <button key={g} onClick={() => setGradeFilter(g)} style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 8, border: `1px solid ${gradeFilter === g ? (GRADE_COLOR[g as Grade] || PURPLE) : BORDER}`, background: gradeFilter === g ? `${GRADE_COLOR[g as Grade] || PURPLE}18` : 'transparent', color: gradeFilter === g ? (GRADE_COLOR[g as Grade] || PURPLE) : MUTED, cursor: 'pointer' }}>
              {g === 'all' ? 'All Grades' : g}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 36 }}>🔬</div>
            <div style={{ fontSize: 14, color: PURPLE, fontWeight: 700, marginTop: 12 }}>Scoring across 20 institutional criteria...</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>Live data · screener.in + NSE · Peer-normalized by sector</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>20-40 seconds for large watchlists</div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={{ padding: '16px 18px', background: `${RED}10`, border: `1px solid ${RED}30`, borderRadius: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: RED, fontWeight: 600 }}>⚠️ {error}</div>
            <button onClick={fetchData} style={{ marginTop: 10, fontSize: 11, color: RED, background: `${RED}15`, border: `1px solid ${RED}30`, borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}>Retry</button>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && data?.message && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: MUTED }}>
            <div style={{ fontSize: 40 }}>📊</div>
            <div style={{ fontSize: 14, color: TEXT, fontWeight: 600, marginTop: 12 }}>{data.message}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>Go to Portfolio / Watchlist to add companies</div>
          </div>
        )}

        {/* Scoring legend */}
        {!loading && filtered.length > 0 && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: CARD_BG, borderRadius: 8, border: `1px solid ${BORDER}`, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>PILLARS:</span>
            {Object.entries(PILLAR_COLOR).map(([p, c]) => <span key={p} style={{ fontSize: 9, color: c, fontWeight: 700 }}>● {p.replace('_', ' ')}</span>)}
            <span style={{ marginLeft: 'auto', fontSize: 9, color: MUTED }}>Peer-normalized by sector · A+ ≥80 · A ≥72 · B+ ≥63</span>
          </div>
        )}

        {/* Results */}
        {!loading && !error && data && !isDegraded && eligibleOnly && filtered.length === 0 && eligibleResults.length === 0 && (
          <div style={{ marginBottom: 12, padding: '12px 14px', background: `${YELLOW}10`, border: `1px solid ${YELLOW}30`, borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: YELLOW, fontWeight: 700, marginBottom: 4 }}>⊘ No eligible companies found</div>
            <div style={{ fontSize: 10, color: MUTED }}>
              No companies have sufficient data (≥50% coverage) for reliable scoring. Toggle 'Eligible Only' off to see low-confidence estimates, or add companies with better data coverage.
            </div>
          </div>
        )}
        {!loading && filtered.map((r, i) => <CompanyCard key={r.symbol} r={r} defaultOpen={i === 0} isDegraded={isDegraded} />)}

        {/* Invalid symbols */}
        {!loading && invalidResults.length > 0 && (
          <div style={{ marginTop: 16, padding: '10px 14px', background: CARD_BG, borderRadius: 8, border: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, marginBottom: 6 }}>DATA VALIDATION FAILURES ({invalidResults.length})</div>
            {invalidResults.map((r: any) => (
              <div key={r.symbol} style={{ fontSize: 11, color: MUTED, padding: '3px 0', display: 'flex', gap: 10 }}>
                <span style={{ fontWeight: 700, color: TEXT, minWidth: 80 }}>{r.symbol}</span>
                <span>{r.quality.reason}</span>
              </div>
            ))}
          </div>
        )}

        {/* Methodology */}
        <div style={{ marginTop: 20 }}>
          <button onClick={() => setShowMethodology(s => !s)} style={{ fontSize: 10, color: MUTED, background: 'none', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', marginBottom: 8 }}>
            {showMethodology ? '▲ Hide' : '▼ Show'} Methodology
          </button>
          {showMethodology && (
            <div style={{ padding: '14px 16px', background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: 10, fontSize: 10, color: MUTED, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, color: PURPLE, marginBottom: 6 }}>📖 5-Pillar Methodology</div>
              <div><strong style={{ color: TEXT }}>Quality (30%)</strong> — ROCE, ROE, OPM, CFO quality, capital allocation. Highest weight: durable compounders need quality first.</div>
              <div><strong style={{ color: TEXT }}>Growth (25%)</strong> — 5yr revenue CAGR, 5yr profit CAGR, YoY revenue visibility.</div>
              <div><strong style={{ color: TEXT }}>Financial Strength (20%)</strong> — D/E ratio, promoter holding, pledged %, interest coverage.</div>
              <div><strong style={{ color: TEXT }}>Valuation (15%)</strong> — P/E vs sector median, P/B, FCF quality, market cap zone (₹500Cr–₹15000Cr sweet spot).</div>
              <div><strong style={{ color: TEXT }}>Market/Technical (10%)</strong> — 52W momentum, sector structural tailwind.</div>
              <div style={{ marginTop: 6 }}><strong style={{ color: TEXT }}>Peer Normalization</strong> — All metrics scored relative to sector benchmarks. A 20% OPM is excellent for Industrials but average for IT.</div>
              <div><strong style={{ color: TEXT }}>Red Flag Override</strong> — CRITICAL flags cap grade at D regardless of composite score. HIGH flags cap at C.</div>
              <div><strong style={{ color: TEXT }}>Grade</strong> — A+ ≥80 · A ≥72 · B+ ≥63 · B ≥54 · C ≥42 · D below.</div>
            </div>
          )}
        </div>
      </div>} {/* end scorecard tab */}
    </div>
  );
}
