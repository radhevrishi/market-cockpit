'use client';

import { useEffect, useState, useCallback } from 'react';

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
export default function MultibaggerPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'portfolio' | 'watchlist'>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showMethodology, setShowMethodology] = useState(false);
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
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '20px 16px' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 900, color: PURPLE, margin: 0 }}>🚀 Multibagger Scorecard</h1>
              <p style={{ fontSize: 11, color: MUTED, margin: '4px 0 0' }}>5-Pillar · Peer-normalized by sector · 20 institutional criteria · PF/WL companies only</p>
            </div>
            <button onClick={fetchData} disabled={loading} style={{ fontSize: 11, color: PURPLE, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 8, padding: '7px 14px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
              {loading ? '⟳ Analyzing...' : '↻ Refresh'}
            </button>
          </div>

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
              <div style={{ marginTop: 6 }}><strong style={{ color: TEXT }}>Peer Normalization</strong> — All metrics scored relative to sector benchmarks (IT, Pharma, Banking, etc.) not absolute thresholds. A 20% OPM is excellent for Industrials but average for IT.</div>
              <div><strong style={{ color: TEXT }}>Red Flag Override</strong> — CRITICAL flags cap grade at D regardless of composite score. HIGH flags cap at C.</div>
              <div><strong style={{ color: TEXT }}>Grade</strong> — A+ ≥80 · A ≥72 · B+ ≥63 · B ≥54 · C ≥42 · D below.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
