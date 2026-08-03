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
};

const STORAGE_KEY = 'mc_watchlist_tickers';

const TIER_STYLE: Record<Tier, { bg: string; fg: string; border: string; icon: string; label: string }> = {
  BLOCKBUSTER: { bg: '#78350F', fg: '#FCD34D', border: '#F59E0B', icon: 'BB', label: 'BLOCKBUSTER' },
  STRONG:      { bg: '#14532D', fg: '#86EFAC', border: '#22C55E', icon: 'ST', label: 'STRONG' },
  MIXED:       { bg: '#78350F', fg: '#FCA5A5', border: '#F59E0B', icon: 'MX', label: 'MIXED' },
  AVOID:       { bg: '#7F1D1D', fg: '#FECACA', border: '#DC2626', icon: 'AV', label: 'AVOID' },
};

const TIER_ORDER: Record<string, number> = { BLOCKBUSTER: 4, STRONG: 3, MIXED: 2, AVOID: 1 };

export default function PortfolioEarningsTab() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [grades, setGrades] = useState<Record<string, GradeEntry | null>>({});
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'tier' | 'filing' | 'score' | 'ticker'>('tier');
  const [tierFilter, setTierFilter] = useState<'all' | Tier | 'NONE'>('all');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) {
        setTickers(list.map((t: string) => String(t).toUpperCase()).filter(Boolean));
      }
    } catch {}
  }, []);

  const refresh = async () => {
    if (!tickers.length) return;
    setLoading(true);
    try {
      const url = `/api/v1/portfolio/earnings-grades?tickers=${encodeURIComponent(tickers.join(','))}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setGrades(j.results || {});
        setRefreshedAt(Date.now());
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { if (tickers.length) refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tickers.length]);

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

  const filtered = tierFilter === 'all' ? rows : rows.filter(r => (tierFilter === 'NONE' ? !r.grade : r.grade?.tier === tierFilter));

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
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 120px 110px 110px 90px',
              background: 'var(--mc-bg-2)', padding: '8px 12px', fontSize: 10, fontWeight: 800,
              color: 'var(--mc-text-3)', letterSpacing: '0.5px', borderBottom: '1px solid var(--mc-border-1)' }}>
            <div style={{ cursor: 'pointer' }} onClick={() => setSortBy('ticker')}>TICKER {sortBy === 'ticker' && '↓'}</div>
            <div>COMPANY / SECTOR</div>
            <div style={{ cursor: 'pointer' }} onClick={() => setSortBy('tier')}>TIER {sortBy === 'tier' && '↓'}</div>
            <div style={{ cursor: 'pointer' }} onClick={() => setSortBy('filing')}>FILING {sortBy === 'filing' && '↓'}</div>
            <div>QUARTER</div>
            <div style={{ cursor: 'pointer', textAlign: 'right' }} onClick={() => setSortBy('score')}>SCORE {sortBy === 'score' && '↓'}</div>
          </div>
          {sorted.map(({ ticker, grade }) => {
            const style = grade ? TIER_STYLE[grade.tier] : null;
            return (
              <div key={ticker} style={{
                display: 'grid', gridTemplateColumns: '110px 1fr 120px 110px 110px 90px',
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
