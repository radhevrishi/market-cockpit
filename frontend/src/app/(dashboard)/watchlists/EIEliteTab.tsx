'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect, useCallback, useMemo } from 'react';
import TickerExportToolbar from '@/components/TickerExportToolbar';
import { EI_ELITE_LS_KEY, EI_ELITE_HIDDEN_KEY } from './constants';
import { type EIEliteRow } from './types';

export function EIEliteTab() {
  const [rows, setRows] = useState<EIEliteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [sort, setSort] = useState<{col: string; dir: 'asc'|'desc'}>({col: 'score', dir: 'desc'});
  // zzz266 — Quality Preset default ON: Sales≥20, PAT≥20, EPS≥25, OPM≥11
  const [qualityPreset, setQualityPreset] = useState(true);
  // zzz267 — time window selector; period filtered on scan result
  const [timeWindow, setTimeWindow] = useState<'7d' | '1m' | '2m' | '3m'>('1m');
  // Load from cache on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(EI_ELITE_LS_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw);
      if (cached && Array.isArray(cached.rows) && typeof cached.ts === 'number') {
        setRows(cached.rows);
        setLastFetch(cached.ts);
      }
    } catch {}
  }, []);
  // zzz263 — hidden set: tickers user has manually removed (× button).
  // Never re-added by auto-sync so removals are permanent unless user restores.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(EI_ELITE_HIDDEN_KEY);
      if (raw) setHidden(new Set(JSON.parse(raw)));
    } catch {}
  }, []);
  const removeRow = useCallback((sym: string) => {
    const symUp = sym.toUpperCase();
    setHidden((prev) => {
      const next = new Set(prev); next.add(symUp);
      try { localStorage.setItem(EI_ELITE_HIDDEN_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
    setRows((prev) => {
      const next = prev.filter(r => r.symbol.toUpperCase() !== symUp);
      try { localStorage.setItem(EI_ELITE_LS_KEY, JSON.stringify({ rows: next, ts: Date.now() })); } catch {}
      return next;
    });
  }, []);
  // zzz263 — Full Screener-universe sticky sync. Mirrors what EI page does:
  // (1) fetch /api/market/quotes to get all NSE tickers (~2317)
  // (2) worker-pool through /api/market/earnings-scan in 15-ticker batches
  // (3) filter EXCELLENT+STRONG within 30 days of filing
  // (4) ADDITIVE merge — new tickers added, existing kept; nothing auto-removed
  // (5) User-hidden set persists across syncs
  const fetchElite = useCallback(async () => {
    setLoading(true);
    setProgress('Loading Screener universe…');
    // Step 1: full stock list
    let allStocks: string[] = [];
    try {
      const qres = await fetch('/api/market/quotes?market=india', { cache: 'no-store' });
      if (!qres.ok) throw new Error('Failed to load stock list');
      const qj = await qres.json();
      allStocks = (Array.isArray(qj?.stocks) ? qj.stocks : [])
        .map((s: any) => s?.ticker).filter((t: any): t is string => typeof t === 'string' && t.length > 0);
    } catch (e) {
      setLoading(false); setProgress(null);
      alert('Failed to load Screener universe: ' + String(e)); return;
    }
    // Step 2: worker-pool batched scan
    const BATCH = 15, WORKERS = 12;
    const batches: string[][] = [];
    for (let i = 0; i < allStocks.length; i += BATCH) batches.push(allStocks.slice(i, i + BATCH));
    let cursor = 0, done = 0;
    const claimNext = (): string[] | null => cursor < batches.length ? batches[cursor++] : null;
    const acc: EIEliteRow[] = [];
    const worker = async () => {
      while (true) {
        const batch = claimNext();
        if (!batch) return;
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 20000);
          const url = '/api/market/earnings-scan?symbols=' + encodeURIComponent(batch.join(','));
          const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
          clearTimeout(timer);
          if (r.ok) {
            const j = await r.json();
            const cards = Array.isArray(j?.cards) ? j.cards : Array.isArray(j?.data) ? j.data : [];
            for (const c of cards) {
              const grade = c?.grade || c?.tier;
              if (grade !== 'EXCELLENT' && grade !== 'STRONG') continue;
              const qs = Array.isArray(c.quarters) ? c.quarters : [];
              const lastQ = qs[qs.length - 1] || {};
              acc.push({
                symbol: (c.symbol || c.ticker || '').toUpperCase(), company: c.company || c.name || '',
                grade, score: c.totalScore ?? c.total_score ?? c.score,
                pe: c.pe, marketCapCr: c.mcap ?? c.marketCapCr ?? c.market_cap_cr,
                revenueYoy: c.revenueYoY ?? c.revenueYoy ?? c.rev_yoy_pct ?? c.sales_yoy_pct,
                patYoy: c.patYoY ?? c.patYoy ?? c.pat_yoy_pct,
                epsYoy: c.epsYoY ?? c.epsYoy ?? c.eps_yoy_pct,
                opmPct: lastQ.opm ?? c.opmPct ?? c.opm_pct,
                guidance: c.guidance, price: c.cmp ?? c.price ?? c.currentPrice,
                d1_close_pct: c.d1_close_pct ?? c.d1_pct, // zzz266: dropped priceScore fallback (was 50 default)
                filed_date: c.resultDate ?? c.filed_date ?? c.filing_date, period: c.period ?? lastQ.period,
                fetched_at: new Date().toISOString(),
              });
            }
          }
        } catch {}
        done++;
        setProgress(`Scanning ${done}/${batches.length} batches (${acc.length} elite found so far)…`);
      }
    };
    await Promise.all(Array.from({length: WORKERS}, () => worker()));
    // Step 3: filter — drop hidden + apply time-window filter via period quarter.
    // zzz267 — Use the period string (e.g. "Jun 2026") as a proxy for recency.
    // We map today → current quarter, then count quarters back based on window.
    // 7d/1M → only current quarter | 2M → current + prev | 3M → current + prev 2
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth(); // 0-11
    // Quarter mapping: Jan-Mar → Q4 prev FY (Mar), Apr-Jun → Q1 (Jun), Jul-Sep → Q2 (Sep), Oct-Dec → Q3 (Dec)
    const quarterOf = (m: number) => m <= 2 ? 'Mar' : m <= 5 ? 'Jun' : m <= 8 ? 'Sep' : 'Dec';
    const yearOf = (m: number, y: number) => m <= 2 ? y : y; // simplified — same calendar year
    // Build acceptable "period" strings based on window
    const acceptPeriods: Set<string> = new Set();
    const monthsBack = timeWindow === '7d' || timeWindow === '1m' ? 0 : timeWindow === '2m' ? 3 : 6;
    const quartersBack = Math.ceil(monthsBack / 3);
    for (let q = 0; q <= quartersBack + 1; q++) {
      const monthOffset = curMonth - q * 3;
      let year = curYear;
      let month = monthOffset;
      while (month < 0) { month += 12; year -= 1; }
      acceptPeriods.add(`${quarterOf(month)} ${year}`);
    }
    const freshOnly = acc.filter(r => {
      if (hidden.has(r.symbol.toUpperCase())) return false;
      // If period is unknown, keep (data quality) unless very strict window
      if (!r.period) return timeWindow !== '7d';
      return acceptPeriods.has(String(r.period));
    });
    // Step 4: additive merge — union existing rows + new fresh (dedupe by symbol, prefer new)
    // zzz264 — add diagnostic so user can verify: found X elite, Y after date filter, Z stored total.
    const foundElite = acc.length;
    const afterFilter = freshOnly.length;
    let finalCount = 0;
    setRows((prev) => {
      const merged = new Map<string, EIEliteRow>();
      for (const r of prev) if (!hidden.has(r.symbol.toUpperCase())) merged.set(r.symbol.toUpperCase(), r);
      for (const r of freshOnly) merged.set(r.symbol.toUpperCase(), r); // new overwrites stale
      const arr = Array.from(merged.values());
      finalCount = arr.length;
      try { localStorage.setItem(EI_ELITE_LS_KEY, JSON.stringify({ rows: arr, ts: Date.now() })); } catch {}
      return arr;
    });
    setTimeout(() => {
      console.log('[EI Elite] Sync complete:', { foundElite, afterFilter, finalCount });
    }, 100);
    setLastFetch(Date.now()); setLoading(false); setProgress(null);
  }, [hidden]);
  // zzz267 — NO auto-fetch. User must click Refresh with a time window selected.
  // Prevents 90-second scan running silently on every tab visit.
  const sorted = useMemo(() => {
    // zzz266 — apply Quality Preset filter (Sales≥20, PAT≥20, EPS≥25, OPM≥11) before sort
    const filtered = qualityPreset
      ? rows.filter((r) => {
          const s = typeof r.revenueYoy === 'number' ? r.revenueYoy : -Infinity;
          const pt = typeof r.patYoy === 'number' ? r.patYoy : -Infinity;
          const ep = typeof r.epsYoy === 'number' ? r.epsYoy : -Infinity;
          const om = typeof r.opmPct === 'number' ? r.opmPct : -Infinity;
          return s >= 20 && pt >= 20 && ep >= 25 && om >= 11;
        })
      : rows;
    return [...filtered].sort((a: any, b: any) => {
      const av = a[sort.col], bv = b[sort.col];
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'asc' ? av - bv : bv - av;
      const as = String(av || ''), bs = String(bv || '');
      return sort.dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [rows, sort, qualityPreset]);
  const onSort = (col: string) => setSort((s) => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });
  const arrow = (c: string) => sort.col === c ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const fmtPct = (v: any) => typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';
  const fmtNum = (v: any) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—';
  const fmtMcap = (v: any) => typeof v === 'number' && v > 0 ? (v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : v >= 1000 ? `₹${(v/1000).toFixed(1)}k` : `₹${Math.round(v)}`) : '—';
  const pctCol = (v: any) => (typeof v === 'number' && v >= 0) ? 'var(--mc-bullish)' : (typeof v === 'number' ? 'var(--mc-bearish)' : 'var(--mc-text-4)');
  const excellents = rows.filter(r => r.grade === 'EXCELLENT').length;
  const strongs = rows.filter(r => r.grade === 'STRONG').length;
  // zzz268 — export toolbar respects Quality Preset filter (use sorted, not rows)
  const filteredExcellents = sorted.filter(r => r.grade === 'EXCELLENT').length;
  const filteredStrongs = sorted.filter(r => r.grade === 'STRONG').length;
  const allTickers = sorted.map(r => r.symbol);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--mc-text-2)' }}>
          <strong style={{ color: '#8B5CF6' }}>🎖️ EI Elite</strong> — sticky bench of EXCELLENT+STRONG from EI (last 30d, additive, × to remove)
        </div>
        <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
          {/* zzz268 — show filtered counts when preset ON so header matches export */}
          <span style={{ padding: '2px 8px', background: 'color-mix(in srgb, #10B981 15%, transparent)', color: '#10B981', borderRadius: 4, fontWeight: 700 }}>
            EXCELLENT · {qualityPreset ? `${filteredExcellents}/${excellents}` : excellents}
          </span>
          <span style={{ padding: '2px 8px', background: 'color-mix(in srgb, #22D3EE 15%, transparent)', color: '#22D3EE', borderRadius: 4, fontWeight: 700 }}>
            STRONG · {qualityPreset ? `${filteredStrongs}/${strongs}` : strongs}
          </span>
          {qualityPreset && (
            <span style={{ padding: '2px 8px', background: 'color-mix(in srgb, #F59E0B 15%, transparent)', color: '#F59E0B', borderRadius: 4, fontWeight: 700 }}>Total · {sorted.length}</span>
          )}
        </div>
        {/* zzz266 — Quality Preset toggle, default ON */}
        <button onClick={() => setQualityPreset(v => !v)} title="Toggle Quality Preset: Sales≥20, PAT≥20, EPS≥25, OPM≥11. Same institutional gate as Conviction Beats."
          style={{ padding: '6px 12px', fontSize: 11.5, fontWeight: 800, borderRadius: 6, background: qualityPreset ? '#F59E0B' : 'none', border: '1px solid #F59E0B', color: qualityPreset ? '#0B1220' : '#F59E0B', cursor: 'pointer' }}>
          ⚡ Quality Preset {qualityPreset ? '✓ ON' : 'OFF'}
        </button>
        {/* zzz267 — Time window selector */}
        <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.3px', marginLeft: 8 }}>WINDOW:</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(['7d', '1m', '2m', '3m'] as const).map((w) => (
            <button key={w} onClick={() => setTimeWindow(w)}
              title={w === '7d' ? 'Last 7 days (current quarter only)' : w === '1m' ? 'Last 1 month' : w === '2m' ? 'Last 2 months' : 'Last 3 months'}
              style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5, background: timeWindow === w ? '#22D3EE' : 'none', border: '1px solid #22D3EE', color: timeWindow === w ? '#0B1220' : '#22D3EE', cursor: 'pointer' }}>
              {w === '7d' ? '7D' : w.toUpperCase()}
            </button>
          ))}
        </div>
        <button onClick={fetchElite} disabled={loading}
          style={{ padding: '6px 12px', fontSize: 11.5, fontWeight: 700, borderRadius: 6, background: 'none', border: '1px solid #8B5CF6', color: '#8B5CF6', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? '⏳ Fetching…' : '🔄 Refresh'}
        </button>
        {hidden.size > 0 && (
          <button onClick={() => {
            if (!confirm(`Restore all ${hidden.size} hidden tickers? They will be eligible for re-add on next sync.`)) return;
            setHidden(new Set());
            try { localStorage.removeItem(EI_ELITE_HIDDEN_KEY); } catch {}
          }} style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, background: 'none', border: '1px solid var(--mc-text-4)', color: 'var(--mc-text-3)', cursor: 'pointer' }}>
            ↩ Restore ({hidden.size})
          </button>
        )}
        {lastFetch && (
          <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>
            Last: {new Date(lastFetch).toLocaleString()}
          </span>
        )}
      </div>
      {progress && (
        <div style={{ padding: '8px 12px', background: 'color-mix(in srgb, #8B5CF6 8%, transparent)', border: '1px solid color-mix(in srgb, #8B5CF6 25%, transparent)', borderRadius: 6, fontSize: 11.5, color: '#8B5CF6' }}>
          {progress}
        </div>
      )}
      {rows.length === 0 && !loading && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--mc-text-3)', background: 'var(--mc-bg-1)', border: '1px dashed var(--mc-bg-4)', borderRadius: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--mc-text-2)', marginBottom: 6 }}>No EI Elite data yet</div>
          <div style={{ fontSize: 12 }}>1. Pick a time window (7D / 1M / 2M / 3M) — smaller windows scan fewer quarters<br/>2. Click <strong>🔄 Refresh</strong> to scan the Screener universe once<br/>Subsequent visits show cached data (never auto-fetches).</div>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <TickerExportToolbar
            compact
            tickers={allTickers}
            groups={[
              // zzz268 — groups reflect filtered subset (Quality Preset ON respected)
              { label: 'EXCELLENT', emoji: '⭐', tickers: sorted.filter(r => r.grade === 'EXCELLENT').map(r => r.symbol), color: '#10B981' },
              { label: 'STRONG', emoji: '🔵', tickers: sorted.filter(r => r.grade === 'STRONG').map(r => r.symbol), color: '#22D3EE' },
            ]}
            exchange="NSE"
            filenameHint="ei-elite"
            tickerCompanyMap={sorted.reduce<Record<string, string>>((acc, r) => { if (r.symbol && r.company) acc[r.symbol.toUpperCase()] = r.company; return acc; }, {})}
          />
          <div style={{ background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10, overflow: 'auto', maxHeight: '75vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'ui-sans-serif, system-ui' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--mc-bg-1)', zIndex: 1 }}>
                <tr>
                  {[
                    ['grade', 'Grade'], ['symbol', 'Ticker'], ['company', 'Company'], ['period', 'Period'],
                    ['score', 'Score'], ['pe', 'P/E'], ['marketCapCr', 'MktCap'],
                    ['revenueYoy', 'Rev YoY'], ['patYoy', 'PAT YoY'], ['epsYoy', 'EPS YoY'], ['opmPct', 'OPM'],
                    ['filed_date', 'Filed'], ['guidance', 'Guidance']
                  ].map(([k, l]) => (
                    <th key={k} onClick={() => onSort(k)}
                      style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-text-3)', padding: '6px 8px', borderBottom: '1px solid var(--mc-bg-4)', cursor: 'pointer', textAlign: 'left', letterSpacing: '0.3px', textTransform: 'uppercase', whiteSpace: 'nowrap', userSelect: 'none' }}>
                      {l}{arrow(k)}
                    </th>
                  ))}
                  <th style={{ fontSize: 10, fontWeight: 800, color: 'var(--mc-text-3)', padding: '6px 8px', borderBottom: '1px solid var(--mc-bg-4)', textAlign: 'center' }}>·</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const gColor = r.grade === 'EXCELLENT' ? '#10B981' : '#22D3EE';
                  return (
                    <tr key={r.symbol} style={{ transition: 'background 0.1s' }}
                      onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'var(--mc-bg-2)'; }}
                      onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                      <td style={{ fontSize: 10, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: gColor, fontWeight: 800 }}>{r.grade}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{r.symbol}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: 'var(--mc-text-1)', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</td>
                      <td style={{ fontSize: 10.5, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: 'var(--mc-text-3)' }}>{r.period || '—'}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: gColor, fontWeight: 700 }}>{r.score ?? '—'}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right' }}>{fmtNum(r.pe)}{typeof r.pe === 'number' ? 'x' : ''}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: 'var(--mc-text-3)' }}>{fmtMcap(r.marketCapCr)}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: pctCol(r.revenueYoy), fontVariantNumeric: 'tabular-nums' as any }}>{fmtPct(r.revenueYoy)}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: pctCol(r.patYoy), fontVariantNumeric: 'tabular-nums' as any }}>{fmtPct(r.patYoy)}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right', color: pctCol(r.epsYoy), fontVariantNumeric: 'tabular-nums' as any }}>{fmtPct(r.epsYoy)}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'right' }}>{typeof r.opmPct === 'number' ? r.opmPct.toFixed(1) + '%' : '—'}</td>
                      <td style={{ fontSize: 10.5, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: 'var(--mc-text-3)' }}>{r.filed_date || '—'}</td>
                      <td style={{ fontSize: 10.5, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', color: 'var(--mc-text-3)' }}>{r.guidance || '—'}</td>
                      <td style={{ fontSize: 12, padding: '5px 8px', borderBottom: '1px solid var(--mc-bg-3)', textAlign: 'center' }}>
                        <button onClick={() => removeRow(r.symbol)} title="Remove from EI Elite (permanent unless restored)"
                          style={{ background: 'none', border: 'none', color: 'var(--mc-text-4)', cursor: 'pointer', padding: 0, fontSize: 14 }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
