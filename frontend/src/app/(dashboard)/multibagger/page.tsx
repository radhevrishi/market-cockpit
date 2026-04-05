'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Design tokens (matching orders/intelligence page style) ──────────────────
const BG = '#0a0a0f';
const CARD_BG = '#13131a';
const BORDER = 'rgba(255,255,255,0.06)';
const TEXT = '#e2e8f0';
const MUTED = '#64748b';
const PURPLE = '#a78bfa';
const ACCENT = '#38bdf8';
const GREEN = '#10b981';
const RED = '#ef4444';
const ORANGE = '#f97316';
const YELLOW = '#f59e0b';

const SIGNAL_COLORS: Record<string, string> = {
  STRONG_BUY: GREEN,
  BUY: '#34d399',
  NEUTRAL: YELLOW,
  CAUTION: ORANGE,
  AVOID: RED,
};

const GRADE_COLORS: Record<string, string> = {
  'A+': GREEN,
  'A': '#34d399',
  'B+': YELLOW,
  'B': ORANGE,
  'C': '#fb923c',
  'D': RED,
};

interface MultibaggerCriterion {
  id: string;
  label: string;
  description: string;
  weight: number;
  score: number;
  signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'CAUTION' | 'AVOID';
  value: string;
  insight: string;
}

interface MultibaggerResult {
  symbol: string;
  company: string;
  sector: string;
  lastPrice: number | null;
  marketCapCr: number | null;
  overallScore: number;
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';
  criteria: MultibaggerCriterion[];
  isPortfolio: boolean;
  isWatchlist: boolean;
  computedAt: string;
  dataSource: string;
  errors: string[];
}

interface ApiResponse {
  results: MultibaggerResult[];
  meta?: { total: number; portfolio: number; watchlist: number; topScore: number; computedAt: string };
  message?: string;
}

// ── Score Bar component ───────────────────────────────────────────────────────
function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: '2px', transition: 'width 0.5s ease' }} />
    </div>
  );
}

// ── Single criterion row ──────────────────────────────────────────────────────
function CriterionRow({ c, expanded }: { c: MultibaggerCriterion; expanded: boolean }) {
  const color = SIGNAL_COLORS[c.signal] || YELLOW;
  return (
    <div style={{ padding: '10px 0', borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: TEXT, fontWeight: 600 }}>{c.label}</span>
          <span style={{ fontSize: '10px', color: color, background: `${color}18`, padding: '1px 6px', borderRadius: '10px', fontWeight: 700 }}>{c.signal.replace('_', ' ')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: MUTED }}>{c.value}</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color, minWidth: '32px', textAlign: 'right' }}>{c.score}</span>
        </div>
      </div>
      <ScoreBar score={c.score} color={color} />
      {expanded && (
        <div style={{ marginTop: '6px', fontSize: '11px', color: MUTED, fontStyle: 'italic' }}>{c.insight}</div>
      )}
    </div>
  );
}

// ── Company card ──────────────────────────────────────────────────────────────
function CompanyCard({ result, defaultExpanded }: { result: MultibaggerResult; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showCriteria, setShowCriteria] = useState(false);
  const gradeColor = GRADE_COLORS[result.grade] || MUTED;
  const scoreColor = result.overallScore >= 72 ? GREEN : result.overallScore >= 55 ? YELLOW : RED;

  const strongBuy = result.criteria.filter(c => c.signal === 'STRONG_BUY').length;
  const buy = result.criteria.filter(c => c.signal === 'BUY').length;
  const avoid = result.criteria.filter(c => c.signal === 'AVOID' || c.signal === 'CAUTION').length;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${result.isPortfolio ? 'rgba(167,139,250,0.3)' : result.isWatchlist ? 'rgba(56,189,248,0.2)' : BORDER}`, borderRadius: '12px', marginBottom: '12px', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{ padding: '16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '22px', fontWeight: 800, color: gradeColor, lineHeight: 1 }}>{result.grade}</div>
            <div style={{ fontSize: '9px', color: MUTED, marginTop: '2px' }}>GRADE</div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '15px', fontWeight: 700, color: TEXT }}>{result.symbol}</span>
              {result.isPortfolio && <span style={{ fontSize: '9px', color: PURPLE, background: 'rgba(167,139,250,0.15)', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>PF</span>}
              {result.isWatchlist && !result.isPortfolio && <span style={{ fontSize: '9px', color: ACCENT, background: 'rgba(56,189,248,0.12)', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>WL</span>}
            </div>
            <div style={{ fontSize: '11px', color: MUTED, marginTop: '1px' }}>{result.company} · {result.sector}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {result.lastPrice && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: TEXT }}>₹{result.lastPrice.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div>
              {result.marketCapCr && <div style={{ fontSize: '10px', color: MUTED }}>₹{(result.marketCapCr / 100).toFixed(0)}B MCap</div>}
            </div>
          )}
          <div style={{ textAlign: 'center', minWidth: '48px' }}>
            <div style={{ fontSize: '22px', fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{result.overallScore}</div>
            <div style={{ fontSize: '9px', color: MUTED, marginTop: '2px' }}>/100</div>
          </div>
          <span style={{ fontSize: '16px', color: MUTED }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Signal summary pills */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: GREEN, background: `${GREEN}18`, padding: '3px 10px', borderRadius: '12px', fontWeight: 600 }}>✅ {strongBuy + buy} Positive</span>
            <span style={{ fontSize: '11px', color: RED, background: `${RED}18`, padding: '3px 10px', borderRadius: '12px', fontWeight: 600 }}>⚠️ {avoid} Caution</span>
            <span style={{ fontSize: '11px', color: MUTED, background: 'rgba(255,255,255,0.05)', padding: '3px 10px', borderRadius: '12px' }}>{result.dataSource}</span>
            {result.errors.length > 0 && <span style={{ fontSize: '11px', color: ORANGE, background: `${ORANGE}18`, padding: '3px 10px', borderRadius: '12px' }}>⚡ Partial data</span>}
          </div>

          {/* Score ring visualization (simple) */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            {result.criteria.map(c => (
              <div key={c.id} style={{ flex: 1, height: '6px', background: SIGNAL_COLORS[c.signal] || YELLOW, borderRadius: '3px', opacity: 0.8 }} title={`${c.label}: ${c.score}`} />
            ))}
          </div>

          {/* Top 3 strengths and weaknesses */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
            <div>
              <div style={{ fontSize: '10px', color: GREEN, fontWeight: 700, marginBottom: '6px' }}>💪 STRENGTHS</div>
              {result.criteria.filter(c => c.signal === 'STRONG_BUY' || c.signal === 'BUY').sort((a, b) => b.score - a.score).slice(0, 3).map(c => (
                <div key={c.id} style={{ fontSize: '11px', color: TEXT, marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: MUTED }}>{c.label}</span>
                  <span style={{ color: SIGNAL_COLORS[c.signal], fontWeight: 700 }}>{c.score}</span>
                </div>
              ))}
              {result.criteria.filter(c => c.signal === 'STRONG_BUY' || c.signal === 'BUY').length === 0 && (
                <div style={{ fontSize: '11px', color: MUTED }}>No strong positives</div>
              )}
            </div>
            <div>
              <div style={{ fontSize: '10px', color: RED, fontWeight: 700, marginBottom: '6px' }}>⚠️ RISKS</div>
              {result.criteria.filter(c => c.signal === 'AVOID' || c.signal === 'CAUTION').sort((a, b) => a.score - b.score).slice(0, 3).map(c => (
                <div key={c.id} style={{ fontSize: '11px', color: TEXT, marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: MUTED }}>{c.label}</span>
                  <span style={{ color: SIGNAL_COLORS[c.signal], fontWeight: 700 }}>{c.score}</span>
                </div>
              ))}
              {result.criteria.filter(c => c.signal === 'AVOID' || c.signal === 'CAUTION').length === 0 && (
                <div style={{ fontSize: '11px', color: MUTED }}>No major red flags</div>
              )}
            </div>
          </div>

          {/* Toggle full criteria */}
          <button
            onClick={() => setShowCriteria(s => !s)}
            style={{ fontSize: '11px', color: PURPLE, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', marginBottom: showCriteria ? '10px' : '0' }}
          >
            {showCriteria ? '▲ Hide' : '▼ Show'} all 20 criteria
          </button>

          {showCriteria && (
            <div style={{ marginTop: '4px' }}>
              {result.criteria.map(c => <CriterionRow key={c.id} c={c} expanded={true} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CHAT_ID = '5057319640';

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MultibaggerPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'portfolio' | 'watchlist'>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch portfolio and watchlist from API (same as intelligence page)
      let portfolio: string[] = [];
      let watchlist: string[] = [];
      try {
        const [pRes, wRes] = await Promise.all([
          fetch(`/api/portfolio?chatId=${CHAT_ID}`),
          fetch(`/api/watchlist?chatId=${CHAT_ID}`),
        ]);
        if (pRes.ok) {
          const pData = await pRes.json();
          portfolio = (pData.holdings || pData.portfolio || []).map((h: any) => (h.symbol || h.ticker || '').toUpperCase()).filter(Boolean);
        }
        if (wRes.ok) {
          const wData = await wRes.json();
          watchlist = (wData.watchlist || wData.items || wData || []).map((h: any) => (h.symbol || h.ticker || typeof h === 'string' ? (h.symbol || h.ticker || h) : '').toUpperCase()).filter(Boolean);
        }
      } catch { /* use empty arrays */ }

      const pfParam = portfolio.length > 0 ? `portfolio=${portfolio.join(',')}` : '';
      const wlParam = watchlist.length > 0 ? `watchlist=${watchlist.join(',')}` : '';
      const url = `/api/market/multibagger?${[pfParam, wlParam].filter(Boolean).join('&')}`;
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to load multibagger analysis');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = (data?.results || []).filter(r => {
    if (filter === 'portfolio' && !r.isPortfolio) return false;
    if (filter === 'watchlist' && !r.isWatchlist) return false;
    if (gradeFilter !== 'all' && r.grade !== gradeFilter) return false;
    return true;
  });

  const grades = ['A+', 'A', 'B+', 'B', 'C', 'D'];
  const avgScore = filtered.length > 0 ? Math.round(filtered.reduce((acc, r) => acc + r.overallScore, 0) / filtered.length) : 0;
  const topPicks = filtered.filter(r => r.overallScore >= 72).length;

  return (
    <div style={{ background: BG, minHeight: '100vh', color: TEXT, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '20px 16px' }}>

        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 800, color: PURPLE, margin: 0, letterSpacing: '-0.02em' }}>
                🚀 Multibagger Scorecard
              </h1>
              <p style={{ fontSize: '12px', color: MUTED, marginTop: '4px' }}>
                Institutional-grade 20-criteria scoring · Portfolio & Watchlist companies
              </p>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              style={{ fontSize: '11px', color: PURPLE, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: '8px', padding: '7px 14px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? '⟳ Analyzing...' : '↻ Refresh'}
            </button>
          </div>

          {/* Stats bar */}
          {data?.meta && !loading && (
            <div style={{ display: 'flex', gap: '16px', marginTop: '12px', padding: '10px 14px', background: CARD_BG, borderRadius: '8px', border: `1px solid ${BORDER}` }}>
              <div><span style={{ fontSize: '18px', fontWeight: 800, color: PURPLE }}>{data.meta.total}</span><span style={{ fontSize: '10px', color: MUTED, marginLeft: '4px' }}>Companies</span></div>
              <div style={{ width: '1px', background: BORDER }} />
              <div><span style={{ fontSize: '18px', fontWeight: 800, color: GREEN }}>{topPicks}</span><span style={{ fontSize: '10px', color: MUTED, marginLeft: '4px' }}>Top Picks (A/A+)</span></div>
              <div style={{ width: '1px', background: BORDER }} />
              <div><span style={{ fontSize: '18px', fontWeight: 800, color: data.meta.topScore >= 72 ? GREEN : YELLOW }}>{data.meta.topScore}</span><span style={{ fontSize: '10px', color: MUTED, marginLeft: '4px' }}>Top Score</span></div>
              <div style={{ width: '1px', background: BORDER }} />
              <div><span style={{ fontSize: '18px', fontWeight: 800, color: avgScore >= 65 ? GREEN : YELLOW }}>{avgScore}</span><span style={{ fontSize: '10px', color: MUTED, marginLeft: '4px' }}>Avg Score</span></div>
              {lastRefresh && <div style={{ marginLeft: 'auto', fontSize: '10px', color: MUTED, alignSelf: 'center' }}>Updated {lastRefresh.toLocaleTimeString()}</div>}
            </div>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {(['all', 'portfolio', 'watchlist'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ fontSize: '11px', fontWeight: 600, padding: '5px 12px', borderRadius: '8px', border: `1px solid ${filter === f ? PURPLE : BORDER}`, background: filter === f ? 'rgba(167,139,250,0.15)' : 'transparent', color: filter === f ? PURPLE : MUTED, cursor: 'pointer', textTransform: 'uppercase' }}>
              {f === 'all' ? 'All' : f === 'portfolio' ? '💼 Portfolio' : '👁 Watchlist'}
            </button>
          ))}
          <div style={{ width: '1px', background: BORDER }} />
          {(['all', ...grades] as const).map(g => (
            <button key={g} onClick={() => setGradeFilter(g)} style={{ fontSize: '11px', fontWeight: 700, padding: '5px 10px', borderRadius: '8px', border: `1px solid ${gradeFilter === g ? (GRADE_COLORS[g] || PURPLE) : BORDER}`, background: gradeFilter === g ? `${GRADE_COLORS[g] || PURPLE}18` : 'transparent', color: gradeFilter === g ? (GRADE_COLORS[g] || PURPLE) : MUTED, cursor: 'pointer' }}>
              {g === 'all' ? 'All Grades' : g}
            </button>
          ))}
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔬</div>
            <div style={{ fontSize: '14px', color: PURPLE, fontWeight: 600 }}>Analyzing multibagger criteria...</div>
            <div style={{ fontSize: '11px', color: MUTED, marginTop: '6px' }}>Fetching live data from screener.in + NSE</div>
            <div style={{ fontSize: '10px', color: MUTED, marginTop: '4px' }}>This may take 20-40 seconds for large watchlists</div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div style={{ padding: '20px', background: `${RED}10`, border: `1px solid ${RED}30`, borderRadius: '10px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', color: RED, fontWeight: 600 }}>⚠️ {error}</div>
            <button onClick={fetchData} style={{ marginTop: '10px', fontSize: '11px', color: RED, background: `${RED}15`, border: `1px solid ${RED}30`, borderRadius: '6px', padding: '5px 12px', cursor: 'pointer' }}>Retry</button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && data?.message && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: MUTED }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
            <div style={{ fontSize: '14px', color: TEXT, fontWeight: 600 }}>{data.message}</div>
            <div style={{ fontSize: '11px', color: MUTED, marginTop: '6px' }}>Go to Settings → Portfolio to add companies</div>
          </div>
        )}

        {/* No results after filter */}
        {!loading && !error && filtered.length === 0 && data?.results && data.results.length > 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: MUTED }}>
            <div style={{ fontSize: '12px' }}>No companies match current filters. <button onClick={() => { setFilter('all'); setGradeFilter('all'); }} style={{ color: PURPLE, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Clear filters</button></div>
          </div>
        )}

        {/* Results */}
        {!loading && filtered.length > 0 && (
          <>
            {/* Scoring legend */}
            <div style={{ marginBottom: '12px', padding: '8px 12px', background: CARD_BG, borderRadius: '8px', border: `1px solid ${BORDER}`, display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: MUTED, fontWeight: 600 }}>SCORING:</span>
              {Object.entries({ 'STRONG BUY': GREEN, 'BUY': '#34d399', 'NEUTRAL': YELLOW, 'CAUTION': ORANGE, 'AVOID': RED }).map(([label, color]) => (
                <span key={label} style={{ fontSize: '10px', color, fontWeight: 600 }}>● {label}</span>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: '10px', color: MUTED }}>Weighted across 20 institutional criteria</span>
            </div>

            {filtered.map((result, i) => (
              <CompanyCard key={result.symbol} result={result} defaultExpanded={i === 0} />
            ))}
          </>
        )}

        {/* Methodology footer */}
        <div style={{ marginTop: '24px', padding: '14px', background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: PURPLE, marginBottom: '6px' }}>📖 HOW SCORES WORK</div>
          <div style={{ fontSize: '10px', color: MUTED, lineHeight: 1.7 }}>
            20 criteria weighted by institutional importance. ROCE (9pts), Capital Allocation (9pts), CFO (9pts), Profit Growth (9pts) carry maximum weight.
            P/E sweet spot = 18-40x. Market cap sweet spot = ₹500Cr-15,000Cr. Grade A+ = score ≥80 · A = ≥72 · B+ = ≥64 · B = ≥55 · C = ≥45 · D = below.
            Data sourced from screener.in + NSE live. Refresh every session for latest figures.
          </div>
        </div>
      </div>
    </div>
  );
}
