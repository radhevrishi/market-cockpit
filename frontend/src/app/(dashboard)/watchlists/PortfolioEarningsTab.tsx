'use client';
// zzz283 — Portfolio Earnings tab. For each ticker in the user's watchlist,
// shows the latest graded earnings entry (BLOCKBUSTER/STRONG/MIXED/AVOID) with
// score, filing date, quarter, and a click-through to the full card in
// /earnings-opportunities. Analytics row across the top summarises the tier
// mix so an investor can see at a glance "how is my book grading this season".
//
// Data source: /api/v1/portfolio/earnings-grades (backed by the search:idx:v2
// KV index) — one request returns grades for every portfolio ticker.

import { useEffect, useMemo, useState } from 'react';

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

type GradeEntry = {
  ticker: string;
  company: string;
  filing_date: string;
  tier: Tier;
  sector?: string | null;
  market_cap_cr?: number | null;
  quarter?: string | null;
  composite_score?: number | null;
  pead_score?: number | null; // zzz294 — from earnings-scan priceScore
};

const STORAGE_KEY = 'mc_watchlist_tickers';

const TIER_STYLE: Record<Tier, { bg: string; fg: string; border: string; icon: string; label: string }> = {
  BLOCKBUSTER: { bg: '#78350F', fg: '#FCD34D', border: '#F59E0B', icon: 'BB', label: 'BLOCKBUSTER' },
  STRONG:      { bg: '#14532D', fg: '#86EFAC', border: '#22C55E', icon: 'ST', label: 'STRONG' },
  MIXED:       { bg: '#78350F', fg: '#FCA5A5', border: '#F59E0B', icon: 'MX', label: 'MIXED' },
  AVOID:       { bg: '#7F1D1D', fg: '#FECACA', border: '#DC2626', icon: 'AV', label: 'AVOID' },
};

const TIER_ORDER: Record<string, number> = { BLOCKBUSTER: 4, STRONG: 3, MIXED: 2, AVOID: 1 };

export default function PortfolioEarningsTab({ tickers: propTickers }: { tickers?: string[] } = {}) {
  const [tickers, setTickers] = useState<string[]>([]);
  const [grades, setGrades] = useState<Record<string, GradeEntry | null>>({});
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'tier' | 'filing' | 'score' | 'ticker'>('tier');
  const [tierFilter, setTierFilter] = useState<'all' | Tier | 'NONE'>('all');
  const [quarterFilter, setQuarterFilter] = useState<string>('all'); // zzz294

  // zzz285 — prefer explicit tickers prop (from /portfolio holdings), fall back to
  // watchlist-tickers localStorage. Lets one component serve both entry points.
  useEffect(() => {
    if (propTickers && propTickers.length > 0) {
      setTickers(propTickers.map(t => String(t).toUpperCase()).filter(Boolean));
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) {
        setTickers(list.map((t: string) => String(t).toUpperCase()).filter(Boolean));
      }
    } catch {}
  }, [propTickers ? propTickers.join(',') : '']);

  // zzz289 — client-side scan fallback. Server portfolio-grades endpoint runs
  // into a Next.js self-loop issue when it tries to fetch /api/market/earnings-scan
  // from itself; the client has no such problem, so we call scan directly in
  // parallel and merge the freshest quarter for each ticker.
  const refresh = async () => {
    if (!tickers.length) return;
    setLoading(true);
    try {
      // zzz295 — strip NSE trading-segment suffixes (-BE, -BZ, -BL, -EQ, -SM)
      // before hitting earnings-scan; Screener uses the base ticker.
      const stripSuffix = (t: string) => t.replace(/-(BE|BZ|BL|EQ|SM|T)$/i, '');
      const normTickers = tickers.map(stripSuffix);
      const csv = encodeURIComponent(normTickers.join(','));
      const [gradesRes, scanRes] = await Promise.all([
        fetch(`/api/v1/portfolio/earnings-grades?tickers=${csv}`, { cache: 'no-store' }),
        fetch(`/api/market/earnings-scan?symbols=${csv}`, { cache: 'no-store' }),
      ]);
      const gradesJson: any = gradesRes.ok ? await gradesRes.json() : { results: {} };
      const scanJson: any = scanRes.ok ? await scanRes.json() : { cards: [] };
      const gradedResults: Record<string, any> = gradesJson.results || {};
      const scanByTicker: Record<string, any> = {};
      for (const c of (scanJson.cards || [])) {
        const sym = String(c?.symbol || '').toUpperCase();
        if (sym) scanByTicker[sym] = c;
      }
      // zzz295 — populate suffixed variants so lookup by original ticker works
      for (const t of tickers) {
        const norm = t.replace(/-(BE|BZ|BL|EQ|SM|T)$/i, '');
        if (norm !== t && scanByTicker[norm] && !scanByTicker[t]) {
          scanByTicker[t] = scanByTicker[norm];
        }
      }
      const periodToQuarter = (p?: string): string | null => {
        if (!p) return null;
        const m = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/.exec(p);
        if (!m) return null;
        const yr = parseInt(m[2]);
        const q: Record<string, [string, number]> = { Mar: ['Q4', 0], Jun: ['Q1', 1], Sep: ['Q2', 1], Dec: ['Q3', 1] };
        const it = q[m[1]]; if (!it) return null;
        return `${it[0]} FY${String(yr + it[1]).slice(-2)}`;
      };
      const monEnd = (p?: string): string | null => {
        if (!p) return null;
        const m = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/.exec(p);
        if (!m) return null;
        const idx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]);
        const yr = parseInt(m[2]);
        const day = new Date(yr, idx + 1, 0).getDate();
        return `${yr}-${String(idx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      };
      const scanToTier = (grade?: string, score?: number): Tier => {
        const g = String(grade || '').toUpperCase();
        const s = typeof score === 'number' ? score : 0;
        if (g === 'EXCELLENT' || s >= 80) return 'BLOCKBUSTER';
        if (g === 'GOOD' || s >= 65) return 'STRONG';
        if (g === 'POOR' || g === 'BAD' || s < 45) return 'AVOID';
        return 'MIXED';
      };
      const merged: Record<string, GradeEntry | null> = {};
      for (const t of tickers) {
        const scanCard = scanByTicker[t];
        const gradedEntry = gradedResults[t];
        if (!scanCard && !gradedEntry) { merged[t] = null; continue; }
        if (scanCard) {
          const rawPeriod = scanCard.period || scanCard.resultDate;
          const scanQ = periodToQuarter(rawPeriod);
          const scanScore = typeof scanCard.totalScore === 'number' ? scanCard.totalScore : null;
          const dataAge = String(scanCard.dataAge || '').toLowerCase();
          // zzz290 — reject junk from Screener:
          //   - dataAge=missing or period=N/A => not covered
          //   - grade=BAD with score 0 => empty stub
          //   - filing older than 180 days => stale (mark tier null so it shows
          //     "NO RECENT FILING" instead of misleading AVOID)
          // zzz293 — real filing_date instead of raw quarter end. Indian companies
          // typically file 30-60 days after quarter close; estimate quarter_end + 45
          // days, cap at today so we never show future dates.
          const filingDate = (() => {
            if (gradedEntry?.filing_date) return gradedEntry.filing_date;
            const qe = monEnd(rawPeriod);
            if (!qe) return '';
            const est = new Date(qe);
            if (isNaN(est.getTime())) return qe;
            est.setDate(est.getDate() + 45);
            const today = new Date();
            const pick = est > today ? today : est;
            return pick.toISOString().slice(0, 10);
          })();
          const isMissing = dataAge === 'missing' || !rawPeriod || rawPeriod === 'N/A';
          const isZeroStub = scanScore === 0 && String(scanCard.grade || '').toUpperCase() === 'BAD';
          const isStale = (() => {
            if (!filingDate) return false;
            const d = new Date(filingDate);
            if (isNaN(d.getTime())) return false;
            const ageDays = (Date.now() - d.getTime()) / (86400 * 1000);
            return ageDays > 180;
          })();
          if (isMissing || isZeroStub || (isStale && !gradedEntry)) {
            merged[t] = gradedEntry ?? null;
          } else {
            const graded2 = gradedEntry && gradedEntry.quarter === scanQ ? gradedEntry : null;
            merged[t] = {
              ticker: t,
              company: String(scanCard.company || t),
              filing_date: filingDate,
              tier: (graded2?.tier as Tier) || scanToTier(scanCard.grade, scanScore ?? undefined),
              sector: graded2?.sector || null,
              market_cap_cr: graded2?.market_cap_cr ?? null,
              quarter: scanQ || graded2?.quarter || null,
              composite_score: graded2?.composite_score ?? scanScore,
              // zzz299 — real PEAD from graded pipeline (server portfolio-grades). scan.priceScore is a stub-50.
              pead_score: (gradedEntry as any)?.pead_score ?? null,
            };
          }
        } else {
          merged[t] = gradedEntry;
        }
      }
      setGrades(merged);
      const ts = Date.now();
      setRefreshedAt(ts);
      try {
        // zzz295 — persist so next visit shows cached data instantly
        localStorage.setItem('mc:portfolio-earnings-tab:v1', JSON.stringify({ ts, grades: merged, tickers }));
      } catch {}
    } catch {}
    setLoading(false);
  };

  // zzz298 — ALWAYS use cached grades if present. Refresh only on explicit
  // Refresh-button click. New tickers show NO FILING until user refreshes; that
  // matches the professional "cache-only, manual refresh" behavior the user asked for.
  useEffect(() => {
    if (!tickers.length) return;
    try {
      const raw = localStorage.getItem('mc:portfolio-earnings-tab:v1');
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.grades) {
          setGrades(cached.grades);
          setRefreshedAt(cached.ts || null);
          return; // cache hit, no auto-fetch
        }
      }
    } catch {}
    // Cold cache (first time ever) -> fetch once to seed
    refresh();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tickers.length]);

  const rows = useMemo(() => tickers.map(t => ({ ticker: t, grade: grades[t] || null })), [tickers, grades]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { BLOCKBUSTER: 0, STRONG: 0, MIXED: 0, AVOID: 0, NONE: 0 };
    for (const r of rows) {
      if (r.grade && r.grade.tier) c[r.grade.tier] = (c[r.grade.tier] || 0) + 1;
      else c.NONE++;
    }
    return c;
  }, [rows]);

  const total = tickers.length || 1;

  const sectorBreakdown = useMemo(() => {
    const bySector: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      const sec = r.grade?.sector || 'Uncategorised';
      if (!bySector[sec]) bySector[sec] = { BLOCKBUSTER: 0, STRONG: 0, MIXED: 0, AVOID: 0, NONE: 0, TOTAL: 0 };
      const tier = r.grade?.tier || 'NONE';
      bySector[sec][tier] = (bySector[sec][tier] || 0) + 1;
      bySector[sec].TOTAL = (bySector[sec].TOTAL || 0) + 1;
    }
    return Object.entries(bySector).sort((a, b) => b[1].TOTAL - a[1].TOTAL);
  }, [rows]);

  // zzz294 — unique quarters across portfolio, sorted newest first
  const quartersInPortfolio = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.grade?.quarter) set.add(r.grade.quarter);
    const rank = (s: string) => { const m = /Q(\d)\s+FY(\d+)/.exec(s); return m ? parseInt(m[2]) * 10 + parseInt(m[1]) : 0; };
    return Array.from(set).sort((a, b) => rank(b) - rank(a));
  }, [rows]);
  const filtered = useMemo(() => {
    let out = tierFilter === 'all' ? rows : rows.filter(r => (tierFilter === 'NONE' ? !r.grade : r.grade?.tier === tierFilter));
    if (quarterFilter !== 'all') out = out.filter(r => r.grade?.quarter === quarterFilter);
    return out;
  }, [rows, tierFilter, quarterFilter]);

  const sorted = useMemo(() => {
    const s = [...filtered];
    s.sort((a, b) => {
      if (sortBy === 'tier') {
        return (TIER_ORDER[b.grade?.tier || ''] || 0) - (TIER_ORDER[a.grade?.tier || ''] || 0);
      }
      if (sortBy === 'filing') return (b.grade?.filing_date || '').localeCompare(a.grade?.filing_date || '');
      if (sortBy === 'score') return (b.grade?.composite_score || 0) - (a.grade?.composite_score || 0);
      return a.ticker.localeCompare(b.ticker);
    });
    return s;
  }, [filtered, sortBy]);

  const openInEO = (ticker: string, filing_date: string) => {
    try {
      window.location.href = `/earnings-opportunities?date=${filing_date}#eo-card-${ticker}`;
    } catch {}
  };

  const clearFilter = () => setTierFilter('all');

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--mc-text-1)', margin: 0 }}>Portfolio Earnings Grades</h2>
          <p style={{ fontSize: 12, color: 'var(--mc-text-3)', margin: '4px 0 0 0' }}>
            Latest graded earnings for every ticker in your watchlist. Click a tier chip to open the full card in Earnings Opportunities.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {refreshedAt && (
            <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>refreshed {new Date(refreshedAt).toLocaleTimeString()}</span>
          )}
          <button onClick={refresh} disabled={loading || !tickers.length} style={{
            padding: '6px 12px', background: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-1)',
            borderRadius: 6, color: 'var(--mc-text-2)', cursor: loading ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700,
            opacity: loading || !tickers.length ? 0.5 : 1,
          }}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>
      </div>

      {/* Analytics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
        {(['BLOCKBUSTER','STRONG','MIXED','AVOID'] as Tier[]).map(tier => {
          const style = TIER_STYLE[tier];
          const n = counts[tier] || 0;
          const pct = Math.round((n / total) * 100);
          const active = tierFilter === tier;
          return (
            <button key={tier} onClick={() => setTierFilter(active ? 'all' : tier)} style={{
              padding: 12, background: active ? style.bg : 'var(--mc-bg-2)',
              border: `2px solid ${active ? style.fg : style.border}`, borderRadius: 8,
              cursor: 'pointer', textAlign: 'left',
              transition: 'background 120ms',
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: style.fg, marginBottom: 4, letterSpacing: '0.4px' }}>{style.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: active ? style.fg : 'var(--mc-text-1)', lineHeight: 1 }}>{n}</div>
              <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 4 }}>{pct}% of portfolio</div>
            </button>
          );
        })}
        <button onClick={() => setTierFilter(tierFilter === 'NONE' ? 'all' : 'NONE')} style={{
          padding: 12, background: tierFilter === 'NONE' ? 'var(--mc-bg-3)' : 'var(--mc-bg-2)',
          border: `2px solid ${tierFilter === 'NONE' ? 'var(--mc-text-3)' : 'var(--mc-border-1)'}`, borderRadius: 8,
          cursor: 'pointer', textAlign: 'left',
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-3)', marginBottom: 4, letterSpacing: '0.4px' }}>NO FILING (120d)</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--mc-text-2)', lineHeight: 1 }}>{counts.NONE || 0}</div>
          <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 4 }}>{Math.round(((counts.NONE || 0) / total) * 100)}% quiet</div>
        </button>
      </div>

      {/* zzz294 — quarter filter chip row */}
      {quartersInPortfolio.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-text-4)', letterSpacing: '0.4px', marginRight: 4 }}>QUARTER:</span>
          <button onClick={() => setQuarterFilter('all')} style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: quarterFilter === 'all' ? 'var(--mc-cyan)' : 'var(--mc-bg-2)',
            color: quarterFilter === 'all' ? '#000' : 'var(--mc-text-3)',
            border: '1px solid var(--mc-border-1)', cursor: 'pointer',
          }}>All</button>
          {quartersInPortfolio.map(q => {
            const active = quarterFilter === q;
            const count = rows.filter(r => r.grade?.quarter === q).length;
            return (
              <button key={q} onClick={() => setQuarterFilter(active ? 'all' : q)} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                background: active ? 'var(--mc-cyan)' : 'var(--mc-bg-2)',
                color: active ? '#000' : 'var(--mc-text-2)',
                border: '1px solid var(--mc-border-1)', cursor: 'pointer',
              }}>{q} <span style={{ opacity: 0.6, fontFamily: 'ui-monospace, monospace', fontSize: 9 }}>{count}</span></button>
            );
          })}
        </div>
      )}
      {tierFilter !== 'all' && (
        <div style={{ marginBottom: 10 }}>
          <button onClick={clearFilter} style={{ fontSize: 11, color: 'var(--mc-cyan)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            × Clear filter ({tierFilter})
          </button>
        </div>
      )}

      {/* Sector rollup */}
      {sectorBreakdown.length > 0 && (
        <details style={{ marginBottom: 16, background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 8, padding: '10px 12px' }}>
          <summary style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-text-3)', cursor: 'pointer', letterSpacing: '0.4px' }}>
            SECTOR ROLLUP · {sectorBreakdown.length} sector{sectorBreakdown.length !== 1 ? 's' : ''}
          </summary>
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {sectorBreakdown.map(([sec, c]) => (
              <div key={sec} style={{ display: 'grid', gridTemplateColumns: '1fr repeat(5, 60px) 60px', gap: 6, alignItems: 'center', fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--mc-border-1)' }}>
                <div style={{ color: 'var(--mc-text-2)', fontWeight: 700 }}>{sec}</div>
                <div style={{ textAlign: 'right', color: TIER_STYLE.BLOCKBUSTER.fg }}>{c.BLOCKBUSTER || 0}</div>
                <div style={{ textAlign: 'right', color: TIER_STYLE.STRONG.fg }}>{c.STRONG || 0}</div>
                <div style={{ textAlign: 'right', color: TIER_STYLE.MIXED.fg }}>{c.MIXED || 0}</div>
                <div style={{ textAlign: 'right', color: TIER_STYLE.AVOID.fg }}>{c.AVOID || 0}</div>
                <div style={{ textAlign: 'right', color: 'var(--mc-text-4)' }}>{c.NONE || 0}</div>
                <div style={{ textAlign: 'right', color: 'var(--mc-text-2)', fontWeight: 700 }}>{c.TOTAL || 0}</div>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(5, 60px) 60px', gap: 6, fontSize: 9, color: 'var(--mc-text-4)', marginTop: 2 }}>
              <div>SECTOR</div><div style={{ textAlign: 'right' }}>BB</div><div style={{ textAlign: 'right' }}>ST</div>
              <div style={{ textAlign: 'right' }}>MX</div><div style={{ textAlign: 'right' }}>AV</div>
              <div style={{ textAlign: 'right' }}>NONE</div><div style={{ textAlign: 'right' }}>TOTAL</div>
            </div>
          </div>
        </details>
      )}

      {tickers.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--mc-text-4)', border: '1px dashed var(--mc-border-1)', borderRadius: 8 }}>
          Add tickers to your watchlist (Main tab) to see their earnings grades here.
        </div>
      ) : (
        <div style={{ background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-1)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 120px 110px 100px 70px 70px',
              background: 'var(--mc-bg-2)', padding: '8px 12px', fontSize: 10, fontWeight: 800,
              color: 'var(--mc-text-3)', letterSpacing: '0.5px', borderBottom: '1px solid var(--mc-border-1)' }}>
            <div style={{ cursor: 'pointer' }} onClick={() => setSortBy('ticker')}>TICKER {sortBy === 'ticker' && '↓'}</div>
            <div>COMPANY / SECTOR</div>
            <div style={{ cursor: 'pointer' }} onClick={() => setSortBy('tier')}>TIER {sortBy === 'tier' && '↓'}</div>
            <div style={{ cursor: 'pointer' }} onClick={() => setSortBy('filing')}>FILING {sortBy === 'filing' && '↓'}</div>
            <div>QUARTER</div>
            <div style={{ cursor: 'pointer', textAlign: 'right' }} onClick={() => setSortBy('score')}>SCORE {sortBy === 'score' && '↓'}</div>
            <div style={{ textAlign: 'right' }} title="PEAD (price score post-earnings)">PEAD</div>
          </div>
          {sorted.map(({ ticker, grade }) => {
            const style = grade ? TIER_STYLE[grade.tier] : null;
            return (
              <div key={ticker} style={{
                display: 'grid', gridTemplateColumns: '110px 1fr 120px 110px 100px 70px 70px',
                padding: '10px 12px', fontSize: 12, borderBottom: '1px solid var(--mc-border-1)',
                alignItems: 'center',
              }}>
                <div style={{ fontWeight: 700, color: 'var(--mc-cyan)' }}>{ticker}</div>
                <div style={{ color: 'var(--mc-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {grade?.company || <span style={{ color: 'var(--mc-text-4)' }}>—</span>}
                  {grade?.sector && (<span style={{ color: 'var(--mc-text-4)', fontSize: 10, marginLeft: 8 }}>· {grade.sector}</span>)}
                </div>
                <div>
                  {grade && style ? (
                    <button onClick={() => openInEO(grade.ticker, grade.filing_date)} title="Open card in Earnings Opportunities" style={{
                      background: style.bg, border: `1px solid ${style.border}`, color: style.fg,
                      padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 800,
                      cursor: 'pointer', letterSpacing: '0.4px',
                    }}>{style.label}</button>
                  ) : (
                    <span style={{ color: 'var(--mc-text-4)', fontSize: 10, fontWeight: 700 }}>NO FILING</span>
                  )}
                </div>
                <div style={{ color: 'var(--mc-text-3)', fontSize: 11 }}>{grade?.filing_date || '—'}</div>
                <div style={{ color: 'var(--mc-text-3)', fontSize: 11 }}>{grade?.quarter || '—'}</div>
                <div style={{ textAlign: 'right', color: 'var(--mc-text-2)', fontWeight: 700 }}>{grade?.composite_score ?? '—'}</div>
                <div style={{ textAlign: 'right', color: (grade as any)?.pead_score >= 70 ? 'var(--mc-bullish)' : (grade as any)?.pead_score >= 50 ? 'var(--mc-warn)' : 'var(--mc-text-3)', fontWeight: 700, fontSize: 11 }}>{(grade as any)?.pead_score ?? '—'}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
