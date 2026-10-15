'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useCallback, useEffect } from 'react';
import { getJson } from '@/lib/client-fetch';
import { TV_MANIFEST_URL } from '@/lib/screener-data-loader';
import type { FeedHealth } from './types';
import { TTL_NEWS, TEXT, DIM } from './constants';

export function PipelineHealth() {
  const [feeds, setFeeds] = useState<FeedHealth[]>([]);
  // zzz855 — collapsed by default, so it no longer probes 8 feeds (incl. the
  // ~830 KB bench and the unparameterised /api/v1/news) on every home load.
  // It checks on first open; ↻ re-checks. Until then the header says so.
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  const load = useCallback(async (bypass = false) => {
    setLoading(true);
    const now = Date.now();
    const j = (url: string): Promise<any | null> => getJson<any>(url, { timeoutMs: 30_000, ttlMs: TTL_NEWS, force: bypass });
    const today = new Date().toISOString().slice(0, 10);
    const [graded, bench, live, movers, warrant, keyword, tv, news] = await Promise.all([
      j(`/api/v1/earnings/graded?date=${today}`),
      j('/api/v1/bench'),
      j('/api/v1/concall-intel/live-feed?days=2&view=summary'), // reads generated_at + counts only
      j('/api/v1/concall-intel/movers'),
      j('/api/v1/concall-intel/warrant-feed?days=7'),
      j('/api/v1/concall-intel/keyword-watch?days=14'),
      j(TV_MANIFEST_URL),   // zzz1048 — the TradingView-shaped files, now built by our own Stock Screener
      j('/api/v1/news?fields=published_at'), // only the newest published_at is read
    ]);

    const parse = (v: any): number | null => {
      if (!v) return null;
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : null;
    };
    const newsTs = Array.isArray(news)
      ? news.reduce((mx: number, n: any) => { const t = parse(n?.published_at); return t && t > mx ? t : mx; }, 0) || null
      : parse(news?.generated_at);

    const raw: Array<Omit<FeedHealth, 'status'>> = [
      { key: 'graded',  label: '📊 Earnings Graded',   ts: parse(graded?.generated_at), note: graded ? `${graded.candidates_total ?? '?'} candidates · ${(graded._failed_tickers?.length ?? 0)} failed` : 'no response', freshH: 12, ageH: 36 },
      { key: 'bench',   label: '🏆 Conviction Bench',  ts: parse(bench?.updatedAt), note: bench?.updatedAt ? 'built' : 'not yet built', freshH: 24, ageH: 72 },
      { key: 'live',    label: '🔥 Concall Live Feed', ts: parse(live?.generated_at), note: live ? `${live.count_relevant ?? '?'} relevant · ${live.count_high_bullish ?? '?'} high-bull` : 'no response', freshH: 6, ageH: 24 },
      { key: 'movers',  label: '📈 Concall Movers',    ts: parse(movers?.generated_at), note: movers?.reference_date ? `vs ${movers.reference_date}` : 'no reference snapshot', freshH: 24, ageH: 48 },
      { key: 'warrant', label: '🎯 Warrant Feed',      ts: parse(warrant?.generated_at), note: warrant ? `${warrant.count_passing ?? '?'} passing` : 'no response', freshH: 12, ageH: 48 },
      { key: 'keyword', label: '🔑 Keyword Watch',     ts: parse(keyword?.generated_at), note: keyword ? 'ok' : 'no response', freshH: 24, ageH: 72 },
      { key: 'tv',      label: '📉 Screener files (was TradingView)', ts: parse(tv?.lastSync), note: tv?.lastSync ? `${tv.ok ?? '?'} files from our own screener${(tv.files || []).some((f: any) => f?.source === 'old-tradingview-export') ? ' · some OLD TradingView data' : ''}` : 'no snapshot', freshH: 30, ageH: 80 },
      { key: 'news',    label: '📰 News Feed',         ts: newsTs, note: newsTs ? 'latest article' : 'no dated items', freshH: 6, ageH: 24 },
    ];

    const classify = (f: Omit<FeedHealth, 'status'>): FeedHealth => {
      if (f.ts == null) return { ...f, status: 'DOWN' };
      const hrs = (now - f.ts) / 3_600_000;
      const status: FeedHealth['status'] = hrs <= f.freshH ? 'FRESH' : hrs <= f.ageH ? 'AGING' : 'STALE';
      return { ...f, status };
    };

    setFeeds(raw.map(classify));
    setCheckedAt(now);
    setLoading(false);
  }, []);

  // zzz855 — first expand triggers the first check (was: on mount).
  useEffect(() => { if (!collapsed && checkedAt == null && !loading) load(); }, [collapsed, checkedAt, loading, load]);

  const STATUS_META: Record<FeedHealth['status'], { c: string; dot: string; label: string }> = {
    FRESH: { c: '#10B981', dot: '🟢', label: 'Fresh' },
    AGING: { c: '#F59E0B', dot: '🟡', label: 'Aging' },
    STALE: { c: '#EF4444', dot: '🔴', label: 'Stale' },
    DOWN:  { c: '#64748B', dot: '⚫', label: 'Down' },
  };
  const agoStr = (ts: number | null): string => {
    if (ts == null) return '—';
    const h = (Date.now() - ts) / 3_600_000;
    if (h < 1) return `${Math.round(h * 60)}m ago`;
    if (h < 48) return `${h.toFixed(1)}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };
  const problems = feeds.filter((f) => f.status === 'STALE' || f.status === 'DOWN').length;
  const summaryColor = problems === 0 ? '#10B981' : problems <= 2 ? '#F59E0B' : '#EF4444';

  return (
    <div style={{ background: 'rgba(148,163,184,0.05)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 12, padding: '12px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: '#94A3B8', letterSpacing: '0.5px' }}>🩺 PIPELINE HEALTH</span>
          {loading ? (
            <span style={{ fontSize: 11, color: DIM }}>checking feeds…</span>
          ) : checkedAt == null ? (
            <span style={{ fontSize: 11, color: DIM }}>not checked yet — Show to check</span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 800, color: summaryColor }}>
              {problems === 0 ? 'all feeds healthy' : `${problems} feed${problems === 1 ? '' : 's'} need attention`}
            </span>
          )}
          {checkedAt && !loading && <span style={{ fontSize: 9.5, color: DIM }}>checked {agoStr(checkedAt)}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => load(true)} disabled={loading} style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 6, cursor: loading ? 'wait' : 'pointer', border: '1px solid rgba(148,163,184,0.4)', background: 'transparent', color: '#94A3B8' }}>{loading ? '⏳' : '↻'}</button>
          <button onClick={() => setCollapsed((c) => !c)} style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--mc-border-1)', background: 'transparent', color: DIM }}>{collapsed ? 'Show' : 'Hide'}</button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 12 }}>
          {feeds.map((f) => {
            const m = STATUS_META[f.status];
            return (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', background: '#0D1623', border: `1px solid ${m.c}33`, borderRadius: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</div>
                  <div style={{ fontSize: 9.5, color: DIM, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.note}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: m.c }}>{m.dot} {m.label}</div>
                  <div style={{ fontSize: 9.5, color: DIM, fontFamily: 'ui-monospace, monospace' }}>{agoStr(f.ts)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
