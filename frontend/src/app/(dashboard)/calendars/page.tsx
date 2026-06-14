'use client';

import { useEffect, useState } from 'react';

interface EarningsResult {
  ticker: string;
  company: string;
  resultDate: string;
  quarter: string;
  quality: 'Excellent' | 'Great' | 'Good' | 'OK' | 'Weak' | 'Upcoming' | 'Preview';
  sector: string;
  industry: string;
  marketCap: string;
  edp: number | null;
  cmp: number | null;
  priceMove: number | null;
  timing: string;
  source: string;
}

interface EarningsResponse {
  results: EarningsResult[];
  summary: { total: number; excellent?: number; great?: number; good: number; ok?: number; weak: number; upcoming: number };
  quarter: string;
  dateRange: { from: string; to: string };
  stockUniverse: number;
  source: string;
  updatedAt: string;
  // 3-state data contract: distinguish UNKNOWN (never ingested) from ZERO_FILINGS.
  coverage?: string;            // 'known' | 'unknown' (month-level)
  ingested_from?: string | null; // earliest captured result date in month
  ingested_to?: string | null;   // latest captured result date in month
  ingested_dates?: string[];     // explicit INGESTED dates (no inference)
}

const THEME = {
  background: '#0A0E1A',
  card: '#111B35',
  cardHover: '#162040',
  border: '#1A2840',
  textPrimary: '#F5F7FA',
  textSecondary: '#8A95A3',
  accent: '#0F7ABF',
  green: '#10B981',
  red: '#EF4444',
  orange: '#F59E0B',
  purple: '#8B5CF6',
};

const qualityColors: Record<string, string> = {
  Excellent: '#10B981',
  Great: '#34D399',
  Good: '#3B82F6',
  OK: '#F59E0B',
  Weak: THEME.red,
  Upcoming: '#6366F1',
  Preview: '#8B5CF6',
};

// Tab cache for calendar data (5 min TTL per month, max 24 entries to prevent unbounded growth)
const CALENDAR_CACHE_TTL = 300_000;
const CALENDAR_CACHE_MAX = 24;
const _calendarCache = new Map<string, { data: EarningsResponse; ts: number }>();

function evictExpiredCalendarCache() {
  // AUDIT_100 #14 — eviction must also run on read path
  // (previously only on set; a read-only session never tripped eviction)
  const now = Date.now();
  for (const [k, v] of _calendarCache.entries()) {
    if (now - v.ts > CALENDAR_CACHE_TTL) _calendarCache.delete(k);
  }
}

function calendarCacheGet(key: string) {
  // AUDIT_100 #14 — proactively evict expired entries on every get
  evictExpiredCalendarCache();
  return _calendarCache.get(key);
}

function calendarCacheSet(key: string, value: { data: EarningsResponse; ts: number }) {
  evictExpiredCalendarCache();
  // If still too large, evict oldest entry
  if (_calendarCache.size >= CALENDAR_CACHE_MAX) {
    const oldest = [..._calendarCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _calendarCache.delete(oldest[0]);
  }
  _calendarCache.set(key, value);
}

export default function CalendarPage() {
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [monthOffset, setMonthOffset] = useState(0);
  const [qualityFilter, setQualityFilter] = useState<string>('All');
  const [indexFilter, setIndexFilter] = useState<string>('All');
  const [view, setView] = useState<'calendar' | 'list'>('calendar');

  const now = new Date();
  const viewMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}`;
  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // PATCH 0569 (UX #9) — Explicit timeout state. The calendar fetch was
  // previously open-ended; if /api/market/earnings hung past the user's
  // patience, they saw a perpetual spinner with no way to retry. The
  // `slowFetch` flag flips on after 8 seconds so we can show a retry CTA
  // *inside* the loading spinner, and the request is aborted at 20s with
  // a clear timeout error message.
  const [slowFetch, setSlowFetch] = useState(false);
  // PATCH 0693 — bounded retry count + last-scan timestamp so /calendars
  // never traps the user in a perpetual spinner. After MAX_RETRIES failed
  // attempts, we surface the "View in Earnings Hub instead" deeplink as
  // an escape hatch (that route uses a different upstream and works).
  const [retryCount, setRetryCount] = useState(0);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const MAX_RETRIES = 2;
  const FETCH_TIMEOUT_MS = 20_000;
  const SLOW_FETCH_HINT_MS = 8_000;
  // PATCH 0298 — AbortController so a stale fetch from a previous
  // monthOffset/indexFilter never overwrites a fresher in-flight fetch.
  const fetchData = async (signal?: AbortSignal) => {
    const cacheKey = `${monthStr}_${indexFilter}`;
    const cached = calendarCacheGet(cacheKey); // AUDIT_100 #14 — eviction on read
    if (cached && Date.now() - cached.ts < CALENDAR_CACHE_TTL) {
      setData(cached.data);
      setLoading(false);
      return;
    }
    setSlowFetch(false);
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    let abortTimer: ReturnType<typeof setTimeout> | null = null;
    let didTimeout = false;
    // PATCH 0571 — always own a local controller so the FETCH_TIMEOUT_MS
    // can fire even when the caller (useEffect cleanup) already passed
    // its own signal. We chain the caller's signal to ours so external
    // aborts still propagate, but the timeout is no longer a no-op.
    const ourController = new AbortController();
    if (signal) {
      if (signal.aborted) ourController.abort();
      else signal.addEventListener('abort', () => ourController.abort(), { once: true });
    }
    try {
      setLoading(true);
      // Slow-fetch hint: surface the retry CTA inside the spinner if the
      // request takes long enough to be perceptually broken.
      slowTimer = setTimeout(() => setSlowFetch(true), SLOW_FETCH_HINT_MS);
      abortTimer = setTimeout(() => {
        didTimeout = true;
        try { ourController.abort(); } catch {}
      }, FETCH_TIMEOUT_MS);
      const indexParam = indexFilter !== 'All' ? `&index=${indexFilter}` : '';
      const res = await fetch(`/api/market/earnings?market=india&month=${monthStr}${indexParam}`, { signal: ourController.signal });
      if (!res.ok) throw new Error('Failed to fetch earnings data');
      const json: EarningsResponse = await res.json();
      if (signal?.aborted) return;
      setData(json);
      calendarCacheSet(cacheKey, { data: json, ts: Date.now() });
      setError('');
      setLastScanAt(Date.now()); // PATCH 0693
      setRetryCount(0); // PATCH 0693 — reset on success
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        if (didTimeout) {
          setError(`Calendar fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`); // PATCH 0693
          setLastScanAt(Date.now()); // PATCH 0693 — stamp even on failure
        }
        return; // either user-aborted or our timeout — either way, stop
      }
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLastScanAt(Date.now()); // PATCH 0693
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
      if (abortTimer) clearTimeout(abortTimer);
      setSlowFetch(false);
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthOffset, indexFilter]);

  // Build calendar grid
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const lastDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
  const startDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // Group results by date
  const resultsByDate: Record<string, EarningsResult[]> = {};
  const filteredResults = data?.results.filter(r => qualityFilter === 'All' || r.quality === qualityFilter) || [];

  for (const r of filteredResults) {
    const d = r.resultDate?.split('T')[0] || '';
    if (!resultsByDate[d]) resultsByDate[d] = [];
    resultsByDate[d].push(r);
  }

  // Calendar cells
  const cells: { date: number | null; dateStr: string }[] = [];
  for (let i = 0; i < startDayOfWeek; i++) cells.push({ date: null, dateStr: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
    cells.push({ date: d, dateStr });
  }

  const todayStr = now.toISOString().split('T')[0];

  // Format date like earningspulse: "5 Mar", "14 Mar"
  // PATCH 0550 — guard against malformed `dateStr` so the cell renders
  // an em-dash instead of "NaN Invalid Date" when an upstream source
  // emits a non-ISO string (e.g. "2026-5-9", "TBD", "").
  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (!Number.isFinite(d.getTime())) return '—';
    return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`;
  };

  return (
    <div style={{ backgroundColor: THEME.background, minHeight: '100vh', padding: '24px', color: THEME.textPrimary, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <h1 style={{ fontSize: '28px', fontWeight: '700', margin: 0 }}>
            Earnings Calendar
          </h1>
          {/* PATCH 0302 — Index-filter chip surfaces the active filter prominently
              when it's narrowed below 'All'. Helps users notice when a low result
              count is filter-driven vs genuinely empty. */}
          {indexFilter !== 'All' && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: 'var(--mc-warn)',
              border: '1px solid rgba(245,158,11,0.4)',
              backgroundColor: 'rgba(245,158,11,0.10)',
              padding: '3px 10px', borderRadius: 6, letterSpacing: '0.4px',
            }}>FILTER: {indexFilter}</span>
          )}
        </div>
        <p style={{ color: THEME.textSecondary, margin: 0, fontSize: '13px' }}>
          Indian quarterly results with AI quality ratings
          {data ? ` • 1 ${viewMonth.toLocaleDateString('en-US', { month: 'short' })} — ${daysInMonth} ${viewMonth.toLocaleDateString('en-US', { month: 'short' })} (${data.summary.total} results)` : ''}
        </p>
      </div>

      {/* Summary Bar — matching earningspulse layout */}
      {data && !loading && (
        <div style={{
          display: 'flex', gap: '16px', marginBottom: '20px', alignItems: 'center',
          backgroundColor: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: '10px', padding: '14px 20px',
        }}>
          <div style={{ fontWeight: '700', fontSize: '18px' }}>
            {data.summary.total} <span style={{ fontSize: '12px', color: THEME.textSecondary, fontWeight: '500' }}>RESULTS</span>
          </div>
          <div style={{ width: '1px', height: '24px', backgroundColor: THEME.border }} />
          {(data.summary.excellent || 0) > 0 && <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--mc-bullish)', fontWeight: '600' }}>Excellent: {data.summary.excellent}</span></div>}
          {(data.summary.great || 0) > 0 && <div style={{ fontSize: '12px' }}><span style={{ color: '#34D399', fontWeight: '600' }}>Great: {data.summary.great}</span></div>}
          <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--mc-info)', fontWeight: '600' }}>Good: {data.summary.good}</span></div>
          {(data.summary.ok || 0) > 0 && <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--mc-warn)', fontWeight: '600' }}>OK: {data.summary.ok}</span></div>}
          <div style={{ fontSize: '12px' }}><span style={{ color: THEME.red, fontWeight: '600' }}>Weak: {data.summary.weak}</span></div>
          {data.summary.upcoming > 0 && <div style={{ fontSize: '12px' }}><span style={{ color: '#6366F1', fontWeight: '600' }}>Upcoming: {data.summary.upcoming}</span></div>}
          <div style={{ width: '1px', height: '24px', backgroundColor: THEME.border }} />
          <div style={{ fontSize: '13px', color: THEME.purple, fontWeight: '600' }}>{data.quarter}</div>

          {/* Quality bar */}
          <div style={{ flex: 1, height: '6px', backgroundColor: THEME.border, borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
            {(data.summary.excellent || 0) > 0 && <div style={{ width: `${((data.summary.excellent || 0) / data.summary.total) * 100}%`, backgroundColor: 'var(--mc-bullish)', height: '100%' }} />}
            {(data.summary.great || 0) > 0 && <div style={{ width: `${((data.summary.great || 0) / data.summary.total) * 100}%`, backgroundColor: '#34D399', height: '100%' }} />}
            {data.summary.good > 0 && <div style={{ width: `${(data.summary.good / data.summary.total) * 100}%`, backgroundColor: 'var(--mc-info)', height: '100%' }} />}
            {(data.summary.ok || 0) > 0 && <div style={{ width: `${((data.summary.ok || 0) / data.summary.total) * 100}%`, backgroundColor: 'var(--mc-warn)', height: '100%' }} />}
            {data.summary.weak > 0 && <div style={{ width: `${(data.summary.weak / data.summary.total) * 100}%`, backgroundColor: THEME.red, height: '100%' }} />}
          </div>
        </div>
      )}

      {/* Controls Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* View Toggle */}
          <div style={{ display: 'flex', gap: '2px', backgroundColor: THEME.card, padding: '3px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
            {[
              { label: 'Calendar', value: 'calendar' as const },
              { label: 'List', value: 'list' as const },
            ].map(opt => (
              <button key={opt.value} onClick={() => setView(opt.value)} style={{
                padding: '6px 14px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                backgroundColor: view === opt.value ? THEME.accent : 'transparent',
                color: view === opt.value ? '#fff' : THEME.textSecondary,
              }}>{opt.label}</button>
            ))}
          </div>

          {/* Month Navigation */}
          <button onClick={() => setMonthOffset(monthOffset - 1)} style={{ padding: '8px 14px', backgroundColor: THEME.card, color: THEME.textPrimary, border: `1px solid ${THEME.border}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>←</button>
          <span style={{ fontSize: '16px', fontWeight: '700', minWidth: '150px', textAlign: 'center' }}>{monthLabel}</span>
          <button onClick={() => setMonthOffset(monthOffset + 1)} style={{ padding: '8px 14px', backgroundColor: THEME.card, color: THEME.textPrimary, border: `1px solid ${THEME.border}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>→</button>
          <button onClick={() => setMonthOffset(0)} style={{ padding: '8px 14px', backgroundColor: THEME.accent, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>Today</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {/* Quality Filter */}
          <div style={{ display: 'flex', gap: '4px', backgroundColor: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
            {['All', 'Excellent', 'Great', 'Good', 'OK', 'Weak', 'Upcoming'].map(q => (
              <button key={q} onClick={() => setQualityFilter(q)} style={{
                padding: '6px 12px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                backgroundColor: qualityFilter === q ? (qualityColors[q] || THEME.accent) : 'transparent',
                color: qualityFilter === q ? '#fff' : THEME.textSecondary,
              }}>{q}</button>
            ))}
          </div>

          {/* Index Filter */}
          <div style={{ display: 'flex', gap: '4px', backgroundColor: THEME.card, padding: '4px', borderRadius: '8px', border: `1px solid ${THEME.border}` }}>
            {[
              { label: 'All', value: 'All' },
              { label: 'NIFTY 50', value: 'NIFTY50' },
              { label: 'NIFTY 500', value: 'NIFTY500' },
              { label: 'Midcap', value: 'MIDCAP' },
              { label: 'Smallcap', value: 'SMALLCAP' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setIndexFilter(opt.value)} style={{
                padding: '6px 10px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                backgroundColor: indexFilter === opt.value ? THEME.accent : 'transparent',
                color: indexFilter === opt.value ? '#fff' : THEME.textSecondary,
              }}>{opt.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading.
          PATCH 0569 (UX #9) — When the fetch is taking longer than 8s,
          surface a retry CTA *inside* the spinner so the user has
          something to click. Previously the calendar would sit blank
          past a network hiccup. */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 14 }}>
          <div style={{ width: '40px', height: '40px', border: `3px solid ${THEME.border}`, borderTop: `3px solid ${THEME.accent}`, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          {slowFetch && (
            <div style={{ textAlign: 'center', maxWidth: 380 }}>
              <div style={{ fontSize: 12, color: THEME.textSecondary, marginBottom: 8, lineHeight: 1.5 }}>
                Calendar is taking longer than usual — the NSE source may be slow today.
              </div>
              <button
                onClick={() => { setRetryCount(retryCount + 1); fetchData(); }} // PATCH 0693
                style={{
                  padding: '6px 14px', borderRadius: 6,
                  border: `1px solid ${THEME.accent}`, backgroundColor: `${THEME.accent}18`, color: THEME.accent,
                  cursor: 'pointer', fontSize: 12, fontWeight: 700,
                }}
              >
                ↻ Retry now
              </button>
            </div>
          )}
        </div>
      )}

      {error && !loading && (
        // PATCH 0693 — after MAX_RETRIES, swap the Retry button for an
        // explicit "View in Earnings Hub instead" deeplink. /earnings-hub
        // uses a different upstream + cache path so it tends to render
        // even when /calendars is being throttled.
        <div style={{ backgroundColor: THEME.card, border: `1px solid ${THEME.red}`, borderRadius: '8px', padding: '14px 16px', color: THEME.red, marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>⚠ {error} — NSE API may be temporarily unavailable.</span>
            {lastScanAt && (
              <span style={{ fontSize: 11, color: THEME.textSecondary, fontWeight: 500 }}>
                Last scan: {new Date(lastScanAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} IST · attempt {retryCount + 1}/{MAX_RETRIES + 1}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {retryCount < MAX_RETRIES ? (
              <button onClick={() => { setRetryCount(retryCount + 1); fetchData(); }} style={{ padding: '6px 14px', borderRadius: '6px', border: `1px solid ${THEME.red}`, backgroundColor: `${THEME.red}18`, color: THEME.red, cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                ↻ Retry
              </button>
            ) : (
              <a href="/earnings-hub?tab=calendar" style={{ padding: '6px 14px', borderRadius: '6px', border: `1px solid ${THEME.accent}`, backgroundColor: `${THEME.accent}18`, color: THEME.accent, cursor: 'pointer', fontSize: '12px', fontWeight: '700', textDecoration: 'none' }}>
                View in Earnings Hub instead →
              </a>
            )}
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* CALENDAR VIEW */}
          {view === 'calendar' && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, padding: '16px', marginBottom: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '6px' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: '700', color: THEME.textSecondary, padding: '6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{d}</div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
                {cells.map((cell, idx) => {
                  if (cell.date === null) return <div key={idx} />;

                  const dayResults = resultsByDate[cell.dateStr] || [];
                  const isToday = cell.dateStr === todayStr;
                  const hasResults = dayResults.length > 0;
                  const goodCount = dayResults.filter(r => ['Excellent', 'Great', 'Good'].includes(r.quality)).length;
                  const weakCount = dayResults.filter(r => ['Weak', 'OK'].includes(r.quality)).length;
                  const upCount = dayResults.filter(r => r.quality === 'Upcoming').length;
                  // AUDIT_100 #43 — distinguish weekend cells from "filing day but nothing reported".
                  // Weekend cells stay grey; weekday-with-no-results gets a faint · glyph.
                  const cellDate = new Date(cell.dateStr);
                  const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6;

                  return (
                    <div key={idx} style={{
                      backgroundColor: isToday ? 'color-mix(in srgb, var(--mc-accent) 6%, transparent)' : THEME.background,
                      border: isToday ? `2px solid ${THEME.accent}` : `1px solid ${THEME.border}`,
                      borderRadius: '6px',
                      padding: '6px',
                      minHeight: '80px',
                      opacity: isWeekend && !hasResults ? 0.55 : 1,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: isToday ? THEME.accent : THEME.textSecondary }}>
                          {cell.date}
                        </span>
                        {hasResults && (
                          <div style={{ display: 'flex', gap: '2px' }}>
                            {goodCount > 0 && <span style={{ fontSize: '9px', backgroundColor: `${THEME.green}30`, color: THEME.green, padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>{goodCount}</span>}
                            {weakCount > 0 && <span style={{ fontSize: '9px', backgroundColor: `${THEME.red}30`, color: THEME.red, padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>{weakCount}</span>}
                            {upCount > 0 && <span style={{ fontSize: '9px', backgroundColor: `#6366F130`, color: '#6366F1', padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>{upCount}</span>}
                          </div>
                        )}
                        {/* AUDIT_100 #43 — weekday with no results gets a subtle · glyph */}
                        {!hasResults && !isWeekend && (() => {
                          // MISSING != ZERO. A weekday with no rows is either:
                          //  - ZERO_FILINGS  : date was inside the ingested window (confirmed no results)
                          //  - UNKNOWN       : date was never ingested (outside source window) -> NOT zero
                          const _from = data?.ingested_from || null;
                          const _to = data?.ingested_to || null;
                          const _cov = data?.ingested_dates;
                          const _useCov = Array.isArray(_cov) && _cov.length > 0;
                          const _unknown = data?.coverage === 'unknown'
                            ? true
                            : _useCov
                              ? !_cov!.includes(cell.dateStr)
                              : (!_from || !_to || cell.dateStr < _from || cell.dateStr > _to);
                          return _unknown
                            ? <span title="Data unavailable - this date was never ingested (outside source window). This is NOT zero filings." style={{ fontSize: '9px', fontWeight: 700, color: '#B45309', opacity: 0.85, lineHeight: 1 }}>n/a</span>
                            : <span title="No filings reported (confirmed - date was ingested)" style={{ fontSize: '14px', color: THEME.textSecondary, opacity: 0.4, lineHeight: 1 }}>·</span>;
                        })()}
                      </div>
                      {hasResults && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {dayResults.slice(0, 4).map((r, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <span style={{
                                width: '5px', height: '5px', borderRadius: '50%',
                                backgroundColor: qualityColors[r.quality] || THEME.textSecondary,
                                flexShrink: 0,
                              }} />
                              <span style={{ fontSize: '10px', fontWeight: '600', color: THEME.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.ticker}
                              </span>
                            </div>
                          ))}
                          {dayResults.length > 4 && (
                            <span style={{ fontSize: '9px', color: THEME.textSecondary }}>+{dayResults.length - 4} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LIST VIEW — earningspulse-style table */}
          {view === 'list' && filteredResults.length > 0 && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${THEME.border}` }}>
                      {['DATE', 'SYMBOL', 'SECTOR', 'QUALITY', 'QUARTER', 'CAP', 'EDP', 'CMP', 'MOVE', 'TIMING'].map(h => (
                        <th key={h} style={{ padding: '12px 10px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.border}30` }}>
                        <td style={{ padding: '12px 10px', whiteSpace: 'nowrap', color: THEME.textSecondary, fontSize: '12px' }}>
                          {formatShortDate(r.resultDate)}
                        </td>
                        <td style={{ padding: '12px 10px' }}>
                          <div style={{ fontWeight: '700', fontSize: '13px' }}>{r.ticker}</div>
                          <div style={{ fontSize: '11px', color: THEME.textSecondary, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</div>
                        </td>
                        <td style={{ padding: '12px 10px', color: THEME.textSecondary, fontSize: '12px' }}>{r.sector}</td>
                        <td style={{ padding: '12px 10px' }}>
                          <span style={{
                            padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
                            backgroundColor: `${qualityColors[r.quality]}20`,
                            color: qualityColors[r.quality],
                          }}>{r.quality}</span>
                        </td>
                        <td style={{ padding: '12px 10px', color: THEME.textSecondary, fontSize: '12px' }}>{r.quarter}</td>
                        <td style={{ padding: '12px 10px', color: THEME.textSecondary, fontSize: '12px' }}>{r.marketCap || '—'}</td>
                        <td style={{ padding: '12px 10px', fontSize: '12px' }}>
                          {r.edp !== null ? `₹${r.edp.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td style={{ padding: '12px 10px', fontSize: '12px' }}>
                          {r.cmp !== null ? `₹${r.cmp.toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td style={{ padding: '12px 10px', fontWeight: '700', fontSize: '12px', color: r.priceMove !== null ? (r.priceMove >= 0 ? THEME.green : THEME.red) : THEME.textSecondary }}>
                          {r.priceMove !== null ? `${r.priceMove >= 0 ? '+' : ''}${r.priceMove.toFixed(1)}%` : '—'}
                        </td>
                        <td style={{ padding: '12px 10px', fontSize: '14px', textAlign: 'center' }}>
                          {r.timing === 'pre' ? '🌙' : r.timing === 'post' ? '☀️' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CALENDAR VIEW: Results table below */}
          {view === 'calendar' && filteredResults.length > 0 && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${THEME.border}` }}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', margin: 0 }}>
                  Results ({filteredResults.length})
                </h2>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${THEME.border}` }}>
                      {['Date', 'Symbol', 'Company', 'Quality', 'Quarter', 'Sector', 'Cap', 'CMP'].map(h => (
                        <th key={h} style={{ padding: '10px 8px', textAlign: 'left', color: THEME.textSecondary, fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.border}22` }}>
                        <td style={{ padding: '8px', whiteSpace: 'nowrap', color: THEME.textSecondary, fontSize: '11px' }}>{formatShortDate(r.resultDate)}</td>
                        <td style={{ padding: '8px', fontWeight: '700' }}>{r.ticker}</td>
                        <td style={{ padding: '8px', color: THEME.textSecondary, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '700',
                            backgroundColor: `${qualityColors[r.quality]}18`,
                            color: qualityColors[r.quality],
                          }}>{r.quality}</span>
                        </td>
                        <td style={{ padding: '8px', color: THEME.textSecondary, fontSize: '11px' }}>{r.quarter}</td>
                        <td style={{ padding: '8px', color: THEME.textSecondary, fontSize: '11px' }}>{r.sector}</td>
                        <td style={{ padding: '8px', color: THEME.textSecondary, fontSize: '11px' }}>{r.marketCap || '—'}</td>
                        <td style={{ padding: '8px', fontSize: '11px' }}>{r.cmp !== null ? `₹${r.cmp.toLocaleString('en-IN')}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {filteredResults.length === 0 && (
            <div style={{ backgroundColor: THEME.card, borderRadius: '12px', border: `1px solid ${THEME.border}`, padding: '40px', textAlign: 'center' }}>
              <div style={{ fontSize: '16px', color: THEME.textSecondary, marginBottom: '8px' }}>No earnings results found for {monthLabel}</div>
              <div style={{ fontSize: '12px', color: THEME.textSecondary }}>
                Try a different month or adjust filters
              </div>
            </div>
          )}

          {/* Source Info */}
          {data && (
            <div style={{ marginTop: '16px', fontSize: '11px', color: THEME.textSecondary, display: 'flex', justifyContent: 'space-between' }}>
              <span>Source: {data.source} • Updated: {(() => {
                // PATCH 0550 — Invalid-Date guard mirrors formatShortDate.
                if (!data.updatedAt) return 'N/A';
                const d = new Date(data.updatedAt);
                return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'N/A';
              })()}</span>
              <span>Universe: {data.stockUniverse} stocks</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
