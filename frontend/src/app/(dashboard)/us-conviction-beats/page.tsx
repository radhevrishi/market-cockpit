'use client';

// ═══════════════════════════════════════════════════════════════════════════
// US CONVICTION BEATS — the accumulating bench of US names that graded
// BLOCKBUSTER or STRONG. The US sibling of the Conviction Beats tab on
// /watchlists.
//
// It fills itself two ways:
//   1. Every visit to /us-earnings-opportunities syncs that payload onto the
//      bench (and demotes anything that re-graded MIXED/AVOID).
//   2. A background sweep on this page walks the last N sessions of
//      /api/v1/earnings/graded-us so the bench builds up even if the
//      Opportunities page is never opened — and RE-PRICES entries older than
//      the sweep window through the explicit-ticker mode, so a name benched
//      90 days ago (exactly the one whose drift you want) is never stale.
//
// The bench lives in its OWN localStorage namespace, separate from India —
// ticker symbols are not globally unique, and a shared store would have the
// two markets silently overwriting each other. See lib/conviction-beats-us.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, RefreshCw, X, Undo2, ExternalLink, Star, ChevronDown, ChevronRight } from 'lucide-react';
import {
  getUsConvictionList, removeUsConviction, clearUsConviction, syncUsConviction,
  restoreUsConvictionBin, readUsConvictionBin,
  usFilingAgeDays, computeUsNewWindow, usVerdict,
  passesUsConvictionFilter, usPresetFilters, isUsPresetActive,
  US_FILTER_DEFAULT, US_PRESET,
  type UsConvictionEntry, type UsConvFilters,
} from '@/lib/conviction-beats-us';
import { fmtUsd, fmtPx, fmtPct } from '@/lib/us-earnings-core';

const OPT_OUT_KEY = 'mc:us-cb:preset:v1:optout';
const SWEEP_KEY = 'mc:us-cb:lastsweep:v1';
const FILTERS_KEY = 'mc:us-cb:filters:v1';
const VIEW_KEY = 'mc:us-cb:view:v1';
const VERDICT_COLOR: Record<string, string> = {
  'STRONG BUY': '#10B981', BUY: '#34D399', WATCH: '#FACC15', AVOID: '#EF4444',
};
const VERDICTS = ['STRONG BUY', 'BUY', 'WATCH', 'AVOID'];

type SortKey = 'fresh' | 'score' | 'pead' | 'sales' | 'eps' | 'drift' | 'mcap' | 'pe' | 'addv' | 'age';

function etToday(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}

/** Drift state — the sell half of the PEAD workflow. A top-tier name fading
 *  more than 12% since its print is no longer behaving like a beat. */
function driftState(e: UsConvictionEntry): 'DRIFTING' | 'FADING' | 'HOLDING' | 'RUNNING' | null {
  const m = e.move_pct;
  if (m == null) return null;
  if (m <= -12) return 'DRIFTING';
  if (m <= -5) return 'FADING';
  if (m >= 8) return 'RUNNING';
  return 'HOLDING';
}

export default function UsConvictionBeatsPage() {
  const [entries, setEntries] = useState<UsConvictionEntry[]>([]);
  const [filters, setFilters] = useState<UsConvFilters>(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) return { ...US_FILTER_DEFAULT, ...JSON.parse(raw) };
    } catch {}
    return US_FILTER_DEFAULT;
  });
  const [sweeping, setSweeping] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);
  const [binCount, setBinCount] = useState(0);
  const [sort, setSort] = useState<SortKey>(() => {
    try { return (JSON.parse(localStorage.getItem(VIEW_KEY) || '{}').sort as SortKey) || 'fresh'; } catch { return 'fresh'; }
  });
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>(() => {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}').dir || 'desc'; } catch { return 'desc'; }
  });
  const [view, setView] = useState<'cards' | 'table'>(() => {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}').view || 'cards'; } catch { return 'cards'; }
  });
  const [showAdv, setShowAdv] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => { try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch {} }, [filters]);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ sort, dir: sortDir, view })); } catch {} }, [sort, sortDir, view]);

  const reload = useCallback(() => {
    setEntries(getUsConvictionList());
    setBinCount(readUsConvictionBin().length);
  }, []);

  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener('conviction-beats-us:updated', h);
    return () => window.removeEventListener('conviction-beats-us:updated', h);
  }, [reload]);

  // Auto-apply the Quality Preset on first visit, unless the user opted out.
  useEffect(() => {
    try { if (localStorage.getItem(OPT_OUT_KEY) === '1') return; } catch { return; }
    setFilters((prev) => (
      prev.sales == null && prev.eps == null && prev.pead == null
        && prev.opmDelta == null && prev.cfoPatMin == null && prev.mktCapMin == null && prev.verdicts == null
        ? usPresetFilters() : prev
    ));
  }, []);

  /** Walk recent sessions of graded-us, then re-price bench names older than
   *  the swept window via explicit-ticker mode (batches of 25). */
  const sweep = useCallback(async (sessions = 30, manual = false) => {
    if (sweeping) return;
    setSweeping(true);
    setSweepMsg(null);
    let changes = 0;
    try {
      const today = etToday();
      const chunks = Math.ceil(sessions / 10);
      for (let i = 0; i < chunks; i++) {
        const end = new Date(Date.parse(today + 'T00:00:00Z') - i * 10 * 86400000).toISOString().slice(0, 10);
        const res = await fetch(`/api/v1/earnings/graded-us?date=${end}&days=10`, { cache: 'no-store' });
        if (!res.ok) continue;
        const p = await res.json();
        const batch: any[] = [];
        for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
          for (const c of (p?.by_tier?.[t] || [])) batch.push({ ...c, source_url: c.filing_url });
        }
        if (batch.length) changes += syncUsConviction(batch);
      }
      // Re-price the older part of the bench. Explicit mode grades each name
      // off its latest 8-K, so price / move / P/E / market cap refresh even for
      // names whose filing date fell outside the sessions above.
      const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - sessions * 1.5 * 86400000).toISOString().slice(0, 10);
      const stale = getUsConvictionList().filter((e) => !e.ticker.includes('@') && e.filing_date < cutoff).map((e) => e.ticker);
      for (let i = 0; i < stale.length && i < 150; i += 25) {
        const slice = stale.slice(i, i + 25);
        const res = await fetch(`/api/v1/earnings/graded-us?tickers=${encodeURIComponent(slice.join(','))}`, { cache: 'no-store' });
        if (!res.ok) continue;
        const p = await res.json();
        const batch: any[] = [];
        for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
          for (const c of (p?.by_tier?.[t] || [])) batch.push({ ...c, source_url: c.filing_url });
        }
        if (batch.length) changes += syncUsConviction(batch);
      }
      try { localStorage.setItem(SWEEP_KEY, new Date().toISOString()); } catch {}
      setSweepMsg(changes > 0
        ? `Bench updated — ${changes} change${changes > 1 ? 's' : ''} (last ${sessions} sessions swept${stale.length ? `, ${Math.min(stale.length, 150)} older names re-priced` : ''}).`
        : 'Bench already up to date.');
    } catch (e: any) {
      setSweepMsg(`Sweep failed: ${String(e?.message || e)}`);
    } finally {
      setSweeping(false);
      reload();
      if (!manual) setTimeout(() => setSweepMsg(null), 8000);
    }
  }, [sweeping, reload]);

  // Sweep once every 6 hours on load, so an unattended bench keeps growing.
  useEffect(() => {
    let last = 0;
    try { last = Date.parse(localStorage.getItem(SWEEP_KEY) || '') || 0; } catch {}
    if (Date.now() - last > 6 * 3600_000) {
      const t = setTimeout(() => sweep(20), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newWindow = useMemo(() => computeUsNewWindow(entries), [entries]);

  const sectors = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) if (e.sector) m.set(e.sector, (m.get(e.sector) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const filtered = useMemo(() => {
    const rows = entries.filter((e) => passesUsConvictionFilter(e, filters, newWindow));
    const num = (v: number | null | undefined, missing = -1e12) => (v == null || !Number.isFinite(v) ? missing : v);
    const key: Record<SortKey, (e: UsConvictionEntry) => number | string> = {
      fresh: (e) => e.filing_date,
      score: (e) => num(e.composite_score),
      pead: (e) => num(e.pead_score),
      sales: (e) => num(e.sales_yoy_pct),
      eps: (e) => num(e.eps_yoy_pct),
      drift: (e) => num(e.move_pct),
      mcap: (e) => num(e.market_cap_musd),
      pe: (e) => (e.pe != null && e.pe > 0 ? e.pe : 1e12),
      addv: (e) => num(e.addv_musd),
      age: (e) => -(usFilingAgeDays(e.filing_date) ?? 1e9),
    };
    const k = key[sort];
    const dir = sortDir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const va = k(a), vb = k(b);
      const c = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      if (c !== 0) return c * dir;
      return (b.composite_score ?? 0) - (a.composite_score ?? 0);
    });
  }, [entries, filters, sort, sortDir, newWindow]);

  /** How many names a single filter change would leave — the "(N)" on chips. */
  const countWith = useCallback((patch: Partial<UsConvFilters>) => {
    const f = { ...filters, ...patch };
    let n = 0;
    for (const e of entries) if (passesUsConvictionFilter(e, f, newWindow)) n++;
    return n;
  }, [entries, filters, newWindow]);

  const presetOn = isUsPresetActive(filters);
  const togglePreset = () => {
    setFilters((prev) => {
      if (isUsPresetActive(prev)) {
        try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch {}
        return { ...US_FILTER_DEFAULT, cap: prev.cap, q: prev.q };
      }
      try { localStorage.removeItem(OPT_OUT_KEY); } catch {}
      return { ...usPresetFilters(), cap: prev.cap, q: prev.q };
    });
  };

  const tierCounts = useMemo(() => ({
    BLOCKBUSTER: entries.filter((e) => e.tier === 'BLOCKBUSTER').length,
    STRONG: entries.filter((e) => e.tier === 'STRONG').length,
    drifting: entries.filter((e) => driftState(e) === 'DRIFTING').length,
  }), [entries]);

  const setSortKey = (k: SortKey) => {
    if (sort === k) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSort(k); setSortDir(k === 'pe' || k === 'age' ? 'asc' : 'desc'); }
  };

  const exportCsv = () => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Ticker', 'Company', 'Tier', 'Verdict', 'Score', 'Quarter', 'Filed', 'Rev YoY %', 'NI YoY %', 'EPS YoY %',
      'OPM %', 'OPM prev %', 'CFO/NI', 'PEAD', 'RS', 'Stage', '% from 52w high', 'ADDV $M', 'Mkt cap $M', 'Price', 'P/E',
      'D1 %', 'Since %', 'Sector', 'Caveats', 'SEC'];
    const body = filtered.map((e) => [e.ticker, e.company, e.tier, usVerdict(e).verdictLabel, e.composite_score, e.quarter, e.filing_date,
      e.sales_yoy_pct?.toFixed(1), e.net_profit_yoy_pct?.toFixed(1), e.eps_yoy_pct?.toFixed(1),
      e.opm_pct?.toFixed(2), e.opm_prev_pct?.toFixed(2), e.cfo_to_pat_ratio?.toFixed(2), e.pead_score, e.rs_rating, e.stage,
      e.pct_from_52w_high?.toFixed(1), e.addv_musd?.toFixed(1), e.market_cap_musd?.toFixed(0), e.price?.toFixed(2), e.pe,
      e.d1_pct?.toFixed(2), e.move_pct?.toFixed(2), e.sector, (e.caveat_tags || []).join(' | '), e.source_url].map(esc).join(','));
    download(`us-conviction-beats-${etToday()}.csv`, [head.map(esc).join(','), ...body].join('\n'));
  };
  const exportTv = () => {
    const groups = [['ELITE', filtered.filter((e) => e.is_elite)], ['BLOCKBUSTER', filtered.filter((e) => e.tier === 'BLOCKBUSTER' && !e.is_elite)], ['STRONG', filtered.filter((e) => e.tier === 'STRONG' && !e.is_elite)]] as const;
    const text = groups.filter(([, l]) => l.length).map(([g, l]) => `###${g},${l.map((e) => e.ticker).join(',')}`).join(',');
    download(`us-conviction-beats-${etToday()}-tradingview.txt`, text, 'text/plain');
  };

  return (
    <div style={{ padding: 20, maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <Award className="w-5 h-5" style={{ color: 'var(--mc-warn)' }} />
        <h1 style={{ fontSize: 'var(--mc-text-h3)', fontWeight: 800, color: 'var(--mc-text-0)', margin: 0 }}>
          US Conviction Beats
        </h1>
        <span style={{ fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 8px', borderRadius: 999, border: '1px solid var(--mc-cyan)', color: 'var(--mc-cyan)' }}>NYSE · NASDAQ</span>
        {tierCounts.drifting > 0 && (
          <span title="Top-tier names down more than 12% since their print" style={{ fontSize: 'var(--mc-text-xs)', fontWeight: 800, padding: '3px 9px', borderRadius: 999, border: '1px solid #EF4444', color: '#EF4444', backgroundColor: 'color-mix(in srgb, #EF4444 10%, transparent)' }}>
            ⚠ {tierCounts.drifting} drifting
          </span>
        )}
        <a href="/us-earnings-opportunities" style={{ fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 10px', borderRadius: 999, border: '1px solid #F59E0B', color: '#F59E0B', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Star className="w-3 h-3" /> US Earnings Opportunities →
        </a>
      </div>
      <p style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)', margin: '0 0 14px' }}>
        The bench of US names that graded BLOCKBUSTER or STRONG. It accumulates on its own from every graded window,
        demotes a name automatically when a later quarter drops out of the top tiers, and re-prices older entries on
        each sweep. Stored in this browser — nothing is sent anywhere. Educational, not investment advice.
      </p>

      {/* ── quality preset + quick toggles ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={togglePreset}
          title={`Sales YoY ≥${US_PRESET.sales}% · EPS YoY ≥${US_PRESET.eps}% · PEAD ≥${US_PRESET.pead} · OPM Δ ≥${US_PRESET.opmDelta}pp · CFO/NI ≥${US_PRESET.cfoPatMin} (skipped for banks, insurers and REITs) · Market cap ≥ $${US_PRESET.mktCapMinMusd}M · Verdict STRONG BUY / BUY / WATCH. No promoter-pledge gate — that concept does not exist in US markets.`}
          style={{ fontSize: 'var(--mc-text-xs)', fontWeight: 800, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: '1px solid #F59E0B', color: '#F59E0B', backgroundColor: presetOn ? 'color-mix(in srgb, #F59E0B 14%, transparent)' : 'var(--mc-bg-2)' }}>
          ⚡ QUALITY PRESET · Sales≥{US_PRESET.sales} · EPS≥{US_PRESET.eps} · PEAD≥{US_PRESET.pead} · OPM Δ≥0 · CFO/NI≥{US_PRESET.cfoPatMin} · MktCap≥${US_PRESET.mktCapMinMusd}M {presetOn ? '✓ ON' : '· OFF — click to enable'}
        </button>
        <button onClick={() => setFilters((p) => ({ ...p, newOnly: !p.newOnly }))} style={chip(filters.newOnly, '#10B981')}>
          NEW · {newWindow.days}d{newWindow.widened ? ' (widened from 10d)' : ''} ({newWindow.count})
        </button>
        <button onClick={() => setFilters((p) => ({ ...p, elite: !p.elite }))} style={chip(filters.elite, '#F59E0B')}>⭐ ELITE ({countWith({ elite: true })})</button>
        <button onClick={() => setFilters((p) => ({ ...p, multibagger: !p.multibagger }))} style={chip(filters.multibagger, '#8B5CF6')}>💎 MULTIBAGGER ({countWith({ multibagger: true })})</button>
        <button onClick={() => setShowAdv((v) => !v)} style={chip(showAdv)}>{showAdv ? '▴ Hide detail filters' : '▾ Detail filters'}</button>
      </div>

      {/* ── detail filters (every gate the engine enforces, with live counts) ── */}
      {showAdv && (
        <div style={{ padding: 12, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ChipRow label="Revenue YoY ≥" value={filters.sales} opts={[10, 15, 20, 30, 50]} fmt={(v) => `${v}%`} onSet={(v) => setFilters((p) => ({ ...p, sales: v }))} count={(v) => countWith({ sales: v })} />
          <ChipRow label="Net income YoY ≥" value={filters.pat} opts={[10, 25, 50, 100]} fmt={(v) => `${v}%`} onSet={(v) => setFilters((p) => ({ ...p, pat: v }))} count={(v) => countWith({ pat: v })} />
          <ChipRow label="EPS YoY ≥" value={filters.eps} opts={[15, 25, 40, 75]} fmt={(v) => `${v}%`} onSet={(v) => setFilters((p) => ({ ...p, eps: v }))} count={(v) => countWith({ eps: v })} />
          <ChipRow label="OPM Δ ≥" value={filters.opmDelta} opts={[-2, 0, 1, 3, 5]} fmt={(v) => `${v >= 0 ? '+' : ''}${v}pp`} onSet={(v) => setFilters((p) => ({ ...p, opmDelta: v }))} count={(v) => countWith({ opmDelta: v })} />
          <ChipRow label="OPM ≥" value={filters.opmMin} opts={[5, 10, 15, 20, 30]} fmt={(v) => `${v}%`} onSet={(v) => setFilters((p) => ({ ...p, opmMin: v }))} count={(v) => countWith({ opmMin: v })} />
          <ChipRow label="CFO/NI ≥" value={filters.cfoPatMin} opts={[0.5, 0.8, 1, 1.2]} fmt={(v) => `${v}×`} onSet={(v) => setFilters((p) => ({ ...p, cfoPatMin: v }))} count={(v) => countWith({ cfoPatMin: v })} />
          <ChipRow label="PEAD ≥" value={filters.pead} opts={[40, 60, 70, 80]} fmt={(v) => `${v}`} onSet={(v) => setFilters((p) => ({ ...p, pead: v }))} count={(v) => countWith({ pead: v })} />
          <ChipRow label="Score ≥" value={filters.score} opts={[60, 70, 78, 85]} fmt={(v) => `${v}`} onSet={(v) => setFilters((p) => ({ ...p, score: v }))} count={(v) => countWith({ score: v })} />
          <ChipRow label="Mkt cap ≥" value={filters.mktCapMin} opts={[300, 1000, 2000, 5000, 10000]} fmt={(v) => (v >= 1000 ? `$${v / 1000}B` : `$${v}M`)} onSet={(v) => setFilters((p) => ({ ...p, mktCapMin: v }))} count={(v) => countWith({ mktCapMin: v })} />
          <ChipRow label="P/E ≤" value={filters.peMax} opts={[15, 20, 30, 40]} fmt={(v) => `${v}×`} onSet={(v) => setFilters((p) => ({ ...p, peMax: v }))} count={(v) => countWith({ peMax: v })} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={rowLabel}>Verdict</span>
            {VERDICTS.map((v) => {
              const on = (filters.verdicts || []).includes(v);
              return (
                <button key={v} onClick={() => setFilters((p) => {
                  const cur = p.verdicts || [];
                  const next = on ? cur.filter((x) => x !== v) : [...cur, v];
                  return { ...p, verdicts: next.length ? next : null };
                })} style={chip(on, VERDICT_COLOR[v])}>{v} ({countWith({ verdicts: [v] })})</button>
              );
            })}
            <button onClick={() => setFilters((p) => ({ ...p, verdicts: null }))} style={chip(!filters.verdicts)}>Any</button>
          </div>
          {sectors.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={rowLabel}>Sector</span>
              <button onClick={() => setFilters((p) => ({ ...p, sector: null }))} style={chip(!filters.sector)}>All</button>
              {sectors.slice(0, 14).map(([s, n]) => (
                <button key={s} onClick={() => setFilters((p) => ({ ...p, sector: p.sector === s ? null : s }))} style={chip(filters.sector === s, '#22D3EE')}>{s} ({n})</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── filters row ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 12, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', marginBottom: 14 }}>
        <input value={filters.q} onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Search ticker or company…"
          style={{ fontSize: 'var(--mc-text-xs)', padding: '6px 10px', borderRadius: 999, minWidth: 200, border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-2)', color: 'var(--mc-text-0)' }} />
        <span style={rowLabel}>Cap</span>
        {[['all', 'All'], ['smid', 'Small+Mid'], ['small', 'Small'], ['mid', 'Mid'], ['large', 'Large'], ['mega', 'Mega']].map(([v, l]) => (
          <button key={v} onClick={() => setFilters((p) => ({ ...p, cap: v }))} style={chip(filters.cap === v)}>{l} ({countWith({ cap: v })})</button>
        ))}
        <span style={rowLabel}>Tier</span>
        {['BLOCKBUSTER', 'STRONG'].map((t) => {
          const on = (filters.tiers || []).includes(t);
          return (
            <button key={t} onClick={() => setFilters((p) => {
              const cur = p.tiers || [];
              const next = on ? cur.filter((x) => x !== t) : [...cur, t];
              return { ...p, tiers: next.length ? next : null };
            })} style={chip(on, t === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981')}>{t} ({countWith({ tiers: [t] })})</button>
          );
        })}
        <span style={rowLabel}>Sort</span>
        {([['fresh', 'Freshest'], ['score', 'Score'], ['pead', 'PEAD'], ['sales', 'Revenue'], ['eps', 'EPS'], ['drift', 'Since print'], ['mcap', 'Mkt cap'], ['pe', 'P/E'], ['addv', '$ Volume']] as Array<[SortKey, string]>).map(([v, l]) => (
          <button key={v} onClick={() => setSortKey(v)} style={chip(sort === v)}>{l}{sort === v ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => setView((v) => (v === 'cards' ? 'table' : 'cards'))} style={chip(false)}>{view === 'cards' ? '▦ Table' : '▤ Cards'}</button>
        <button onClick={exportCsv} style={chip(false)}>📊 CSV</button>
        <button onClick={exportTv} style={chip(false)}>📈 TradingView</button>
        <button onClick={() => { setFilters({ ...US_FILTER_DEFAULT, cap: 'all' }); try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch {} }} style={chip(false)}>Clear filters</button>
      </div>

      {/* ── status strip ── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, padding: '10px 14px', borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)' }}>
        <span><b style={{ color: 'var(--mc-text-0)' }}>{entries.length}</b> on the bench</span>
        <span><b style={{ color: '#F59E0B' }}>{tierCounts.BLOCKBUSTER}</b> blockbuster</span>
        <span><b style={{ color: '#10B981' }}>{tierCounts.STRONG}</b> strong</span>
        <span><b style={{ color: 'var(--mc-text-0)' }}>{filtered.length}</b> passing filters</span>
        <span style={{ flex: 1 }} />
        {binCount > 0 && (
          <button onClick={() => { restoreUsConvictionBin(); reload(); }} style={chip(false)}>
            <Undo2 className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />Restore {binCount} removed
          </button>
        )}
        <button onClick={() => sweep(30, true)} disabled={sweeping} style={{ ...chip(false), opacity: sweeping ? 0.5 : 1 }}>
          <RefreshCw className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4, animation: sweeping ? 'spin 1s linear infinite' : undefined }} />
          {sweeping ? 'Sweeping…' : 'Rebuild + re-price (30 sessions)'}
        </button>
        <button onClick={() => { if (confirm('Clear the entire US bench? Entries move to the recycle bin and can be restored.')) { clearUsConviction(); reload(); } }} style={chip(false, '#EF4444')}>Clear all</button>
      </div>
      {sweepMsg && <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', marginBottom: 12 }}>{sweepMsg}</div>}

      {entries.length === 0 && (
        <div style={panel()}>
          <div style={{ fontWeight: 700, color: 'var(--mc-text-0)', marginBottom: 6 }}>The bench is empty</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)' }}>
            It fills itself from graded US results. Hit <b>Rebuild + re-price</b> above, or open{' '}
            <a href="/us-earnings-opportunities" style={{ color: 'var(--mc-cyan)' }}>US Earnings Opportunities</a> — every graded window syncs here automatically.
          </div>
        </div>
      )}
      {entries.length > 0 && filtered.length === 0 && (
        <div style={panel()}>
          <div style={{ fontWeight: 700, color: 'var(--mc-text-0)', marginBottom: 6 }}>Nothing passes the current filters</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)' }}>
            {presetOn ? 'The Quality Preset is strict by design — open the detail filters to see which gate is doing the cutting (each chip shows how many names it would leave), or turn the preset off.' : 'Loosen a filter or clear them all.'}
          </div>
        </div>
      )}

      {view === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
          {filtered.map((e) => (
            <BenchCard key={`${e.ticker}-${e.filing_date}`} e={e}
              expanded={!!expanded[e.ticker]} onToggle={() => setExpanded((x) => ({ ...x, [e.ticker]: !x[e.ticker] }))}
              onRemove={() => { removeUsConviction(e.ticker); reload(); }} />
          ))}
        </div>
      ) : (
        <BenchTable rows={filtered} sort={sort} dir={sortDir} onSort={setSortKey} onRemove={(t) => { removeUsConviction(t); reload(); }} />
      )}

      <style>{'@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────
const rowLabel: React.CSSProperties = { color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)', fontWeight: 700, minWidth: 96 };

function chip(active: boolean, color = 'var(--mc-cyan)'): React.CSSProperties {
  return {
    fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '6px 10px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${active ? color : 'var(--mc-bg-4)'}`, color: active ? color : 'var(--mc-text-2)',
    backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--mc-bg-2)',
  };
}
function panel(): React.CSSProperties {
  return { padding: 20, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)' };
}
function download(name: string, text: string, mime = 'text/csv') {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8;` });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  } catch { /* download blocked */ }
}

function ChipRow<T extends number>({ label, value, opts, fmt, onSet, count }: {
  label: string; value: T | null; opts: T[]; fmt: (v: T) => string; onSet: (v: T | null) => void; count: (v: T | null) => number;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={rowLabel}>{label}</span>
      <button onClick={() => onSet(null)} style={chip(value == null)}>Any ({count(null)})</button>
      {opts.map((v) => (
        <button key={String(v)} onClick={() => onSet(value === v ? null : v)} style={chip(value === v)}>{fmt(v)} ({count(v)})</button>
      ))}
    </div>
  );
}

function MiniBar({ value, max = 100, color }: { value: number | null | undefined; max?: number; color: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ height: 4, borderRadius: 2, backgroundColor: 'var(--mc-bg-4)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color }} />
    </div>
  );
}

function Sparkline({ series, color }: { series: number[] | null | undefined; color: string }) {
  if (!series || series.length < 5) return null;
  const w = 120, h = 28;
  const min = Math.min(...series), max = Math.max(...series);
  const rng = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - ((v - min) / rng) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }} aria-label="30-day close path">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function BenchCard({ e, expanded, onToggle, onRemove }: { e: UsConvictionEntry; expanded: boolean; onToggle: () => void; onRemove: () => void }) {
  const v = usVerdict(e);
  const tierColor = e.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
  const age = usFilingAgeDays(e.filing_date);
  const opmD = (e.opm_pct != null && e.opm_prev_pct != null) ? e.opm_pct - e.opm_prev_pct : null;
  const ds = driftState(e);
  const driftColor = ds === 'DRIFTING' ? '#EF4444' : ds === 'FADING' ? '#F59E0B' : ds === 'RUNNING' ? '#10B981' : 'var(--mc-text-3)';
  const spark = e.close_30d ?? null;
  const sparkColor = spark && spark.length > 1 && spark[spark.length - 1] >= spark[0] ? '#10B981' : '#EF4444';
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', borderRadius: 'var(--mc-radius)', padding: 12, borderTop: `3px solid ${tierColor}`, position: 'relative' }}>
      <button onClick={onRemove} title="Remove from bench" style={{ position: 'absolute', top: 8, right: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mc-text-4)' }}>
        <X className="w-3 h-3" />
      </button>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', paddingRight: 18 }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text-0)' }}>{e.ticker}</span>
        <span style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.company}</span>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '6px 0 9px' }}>
        <Tag text={e.tier} color={tierColor} />
        <Tag text={v.verdictLabel} color={VERDICT_COLOR[v.verdictLabel]} />
        {ds && ds !== 'HOLDING' && <Tag text={`${ds === 'DRIFTING' ? '⚠ ' : ''}${ds} ${fmtPct(e.move_pct, 0)}`} color={driftColor} />}
        {e.quarter && <Tag text={e.quarter} />}
        {age != null && <Tag text={`·${age}d`} />}
        <Tag text={fmtUsd(e.market_cap_musd)} />
        {e.guidance && <Tag text={`📣 ${e.guidance.toLowerCase()}`} color={e.guidance === 'RAISED' ? '#10B981' : (e.guidance === 'LOWERED' || e.guidance === 'WITHDRAWN') ? '#EF4444' : e.guidance === 'MAINTAINED' ? '#FACC15' : undefined} />}
        {e.eps_surprise_pct != null && <Tag text={benchSurprise(e)} color={e.eps_surprise_pct >= 5 ? '#10B981' : e.eps_surprise_pct <= -5 ? '#EF4444' : undefined} />}
        {e.prelim && <Tag text="PRELIM" color="#8B5CF6" />}
        {e.is_elite && <Tag text="⭐ ELITE" color="#F59E0B" />}
        {e.multibagger_setup && <Tag text="💎" color="#8B5CF6" />}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <MiniTile label="REV" value={fmtPct(e.sales_yoy_pct)} good={(e.sales_yoy_pct ?? 0) >= 20} sub={e.revenue_prev_musd != null && e.revenue_curr_musd != null ? `${fmtUsd(e.revenue_prev_musd)}→${fmtUsd(e.revenue_curr_musd)}` : undefined} />
        <MiniTile label="EPS · GAAP" value={fmtPct(e.eps_yoy_pct)} good={(e.eps_yoy_pct ?? 0) >= 25} sub={e.eps_prev != null && e.eps_curr != null ? `$${e.eps_prev.toFixed(2)}→$${e.eps_curr.toFixed(2)}` : undefined} />
        <MiniTile label="OPM Δ" value={opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp` : '—'} good={(opmD ?? -1) >= 0} sub={e.opm_pct != null ? `${e.opm_pct.toFixed(1)}% now` : undefined} />
        <MiniTile label="PEAD" value={String(e.pead_score ?? '—')} good={(e.pead_score ?? 0) >= 60} sub={`score ${e.composite_score}`} />
      </div>
      {e.eps_adj != null && (
        <div style={{ marginTop: 7, fontSize: 10, color: 'var(--mc-text-3)' }}>
          street basis: adj. EPS <b style={{ color: 'var(--mc-text-1)' }}>${Number(e.eps_adj).toFixed(2)}</b>
          {e.eps_estimate != null && <> vs est ${Number(e.eps_estimate).toFixed(2)}</>}
          {e.eps_surprise_pct != null && <> · <b style={{ color: e.eps_surprise_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{benchSurpriseText(e)}</b></>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <div><div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700 }}>SCORE {e.composite_score}</div><MiniBar value={e.composite_score} color={tierColor} /></div>
        <div><div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700 }}>PEAD {e.pead_score ?? '—'}</div><MiniBar value={e.pead_score} color="#EF4444" /></div>
      </div>
      {/* tradeability — the two numbers that decide whether a small cap is investable */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)' }}>
        <span>Stage <b style={{ color: e.stage === 4 ? '#EF4444' : e.stage === 2 ? '#10B981' : 'var(--mc-text-0)' }}>{e.stage ?? '—'}</b></span>
        <span>RS <b style={{ color: 'var(--mc-text-0)' }}>{e.rs_rating ?? '—'}</b></span>
        <span>52w <b style={{ color: (e.pct_from_52w_high ?? -100) >= -15 ? 'var(--mc-text-0)' : '#F59E0B' }}>{fmtPct(e.pct_from_52w_high, 0)}</b></span>
        <span title="20-day median dollar volume">$Vol <b style={{ color: (e.addv_musd ?? 0) < 2 ? '#EF4444' : 'var(--mc-text-0)' }}>{e.addv_musd != null ? `$${e.addv_musd.toFixed(1)}M/d` : '—'}</b></span>
        <span>CFO/NI <b style={{ color: 'var(--mc-text-0)' }}>{e.cfo_to_pat_ratio != null ? e.cfo_to_pat_ratio.toFixed(2) : (e.is_financial ? 'n/a' : '—')}</b></span>
        <span>{fmtPx(e.price)}{e.pe ? ` · P/E ${e.pe}` : ''}</span>
      </div>
      {(e.caveat_tags?.length || 0) > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
          {e.caveat_tags!.map((t) => <Tag key={t} text={t} color="#EF4444" />)}
        </div>
      )}
      <button onClick={onToggle} style={{ marginTop: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {expanded ? 'Less' : 'More'}
      </button>
      {expanded && (
        <div style={{ marginTop: 8, fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', lineHeight: 1.55 }}>
          {e.narrative && <div style={{ marginBottom: 6 }}>{e.narrative}</div>}
          {Array.isArray(e.guidance_snippets) && e.guidance_snippets.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--mc-text-4)', marginBottom: 3 }}>📣 GUIDANCE · press release</div>
              {e.guidance_snippets.map((q, i) => <div key={i} style={{ borderLeft: '2px solid var(--mc-bg-4)', paddingLeft: 7, marginBottom: 3 }}>“{q}”</div>)}
            </div>
          )}
          {v.reasons.length > 0 && <div style={{ color: 'var(--mc-text-3)', marginBottom: 6 }}>{v.reasons.join(' · ')}</div>}
          {(e.quarters_revenue || e.quarters_eps || e.quarters_opm) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 6 }}>
              <Trend label="Revenue $M" s={e.quarters_revenue} fmt={(x) => x >= 1000 ? `${(x / 1000).toFixed(1)}B` : `${x.toFixed(0)}`} />
              <Trend label="EPS $" s={e.quarters_eps} fmt={(x) => x.toFixed(2)} />
              <Trend label="OPM %" s={e.quarters_opm} fmt={(x) => x.toFixed(1)} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Gap {fmtPct(e.gap_pct, 1)} · D1 <b style={{ color: (e.d1_pct ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{fmtPct(e.d1_pct, 1)}</b> · Since print <b style={{ color: driftColor }}>{fmtPct(e.move_pct, 1)}</b></span>
            {spark && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkline series={spark} color={sparkColor} /><span style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>30d</span></span>}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{e.form || ''} filed {e.filing_date}{e.sector ? ` · ${e.sector}` : ''}</span>
        {e.source_url && (
          <a href={e.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            SEC <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function Trend({ label, s, fmt }: { label: string; s: number[] | null | undefined; fmt: (x: number) => string }) {
  if (!s || s.length < 2) return null;
  const up = s[s.length - 1] >= s[0];
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '5px 7px' }}>
      <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700 }}>{label} · last {s.length}Q</div>
      <div style={{ fontSize: 11, color: up ? '#10B981' : '#EF4444', fontWeight: 700 }}>{s.map(fmt).join(' → ')}</div>
    </div>
  );
}

function Tag({ text, color }: { text: string; color?: string }) {
  const c = color || 'var(--mc-text-3)';
  return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999, border: `1px solid ${color ? c : 'var(--mc-bg-4)'}`, color: c, backgroundColor: color ? `color-mix(in srgb, ${c} 10%, transparent)` : 'transparent', whiteSpace: 'nowrap' }}>{text}</span>
  );
}

/** Same rule as the opportunities page: a percentage surprise off a near-zero
 *  estimate is arithmetic noise — state it in cents instead. */
function benchSurpriseText(e: any): string {
  const est = e.eps_estimate as number | null;
  const act = (e.eps_adj ?? e.eps_curr) as number | null;
  if (est != null && act != null && Math.abs(est) < 0.1) {
    const d = act - est;
    return `${d >= 0 ? 'beat by' : 'missed by'} $${Math.abs(d).toFixed(2)}`;
  }
  const p = e.eps_surprise_pct as number | null;
  return p == null ? '' : `${p >= 0 ? '+' : ''}${p.toFixed(0)}%`;
}
function benchSurprise(e: any): string {
  const t = benchSurpriseText(e);
  return /%$/.test(t) ? `vs est ${t}` : t;
}

function MiniTile({ label, value, good, sub }: { label: string; value: string; good: boolean; sub?: string }) {
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6, padding: '6px 8px', minWidth: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: good ? 'var(--mc-bullish)' : 'var(--mc-text-0)' }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: 'var(--mc-text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}

function BenchTable({ rows, sort, dir, onSort, onRemove }: { rows: UsConvictionEntry[]; sort: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void; onRemove: (t: string) => void }) {
  const th = (label: string, k?: SortKey, left = false): React.CSSProperties & { children?: any } => ({
    textAlign: left ? 'left' : 'right', padding: '8px 10px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
    color: k && sort === k ? 'var(--mc-cyan)' : 'var(--mc-text-3)', borderBottom: '1px solid var(--mc-bg-4)',
    cursor: k ? 'pointer' : 'default', position: 'sticky', top: 0, backgroundColor: 'var(--mc-bg-1)', zIndex: 1,
  });
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 10px', fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-1)', whiteSpace: 'nowrap' };
  const H = ({ label, k, left }: { label: string; k?: SortKey; left?: boolean }) => (
    <th style={th(label, k, left)} onClick={() => k && onSort(k)}>{label}{k && sort === k ? (dir === 'desc' ? ' ▼' : ' ▲') : ''}</th>
  );
  return (
    <div style={{ overflow: 'auto', maxHeight: '75vh', borderRadius: 'var(--mc-radius)', border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-1)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1280 }}>
        <thead>
          <tr>
            <H label="Ticker" left /><H label="Company" left /><H label="Tier" left /><H label="Verdict" left />
            <H label="Rev YoY" k="sales" /><H label="EPS YoY" k="eps" /><th style={th('OPM Δ')}>OPM Δ</th><th style={th('CFO/NI')}>CFO/NI</th>
            <H label="PEAD" k="pead" /><H label="Score" k="score" /><th style={th('RS')}>RS</th><th style={th('Stg')}>Stg</th>
            <H label="$Vol/d" k="addv" /><H label="Mkt cap" k="mcap" /><H label="P/E" k="pe" /><th style={th('D1')}>D1</th>
            <H label="Since" k="drift" /><H label="Filed" k="fresh" left /><th style={th('')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const v = usVerdict(e);
            const opmD = (e.opm_pct != null && e.opm_prev_pct != null) ? e.opm_pct - e.opm_prev_pct : null;
            const tierColor = e.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
            const ds = driftState(e);
            return (
              <tr key={`${e.ticker}-${e.filing_date}`} style={{ borderBottom: '1px solid var(--mc-bg-3)' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 800, color: 'var(--mc-text-0)' }}>
                  {e.source_url ? <a href={e.source_url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{e.ticker}</a> : e.ticker}
                </td>
                <td style={{ ...td, textAlign: 'left', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.company}>{e.company}</td>
                <td style={{ ...td, textAlign: 'left', color: tierColor, fontWeight: 800 }}>{e.tier}</td>
                <td style={{ ...td, textAlign: 'left', color: VERDICT_COLOR[v.verdictLabel], fontWeight: 800 }}>{v.verdictLabel}</td>
                <td style={td}>{fmtPct(e.sales_yoy_pct)}</td>
                <td style={td}>{fmtPct(e.eps_yoy_pct)}</td>
                <td style={td}>{opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp` : '—'}</td>
                <td style={td}>{e.cfo_to_pat_ratio != null ? e.cfo_to_pat_ratio.toFixed(2) : (e.is_financial ? 'n/a' : '—')}</td>
                <td style={td}>{e.pead_score ?? '—'}</td>
                <td style={{ ...td, fontWeight: 800, color: 'var(--mc-text-0)' }}>{e.composite_score}</td>
                <td style={td}>{e.rs_rating ?? '—'}</td>
                <td style={{ ...td, color: e.stage === 4 ? '#EF4444' : e.stage === 2 ? '#10B981' : undefined }}>{e.stage ?? '—'}</td>
                <td style={{ ...td, color: (e.addv_musd ?? 0) < 2 ? '#EF4444' : undefined }}>{e.addv_musd != null ? `$${e.addv_musd.toFixed(1)}M` : '—'}</td>
                <td style={td}>{fmtUsd(e.market_cap_musd)}</td>
                <td style={td}>{e.pe ?? '—'}</td>
                <td style={{ ...td, color: (e.d1_pct ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{fmtPct(e.d1_pct, 1)}</td>
                <td style={{ ...td, color: ds === 'DRIFTING' ? '#EF4444' : ds === 'FADING' ? '#F59E0B' : (e.move_pct ?? 0) >= 0 ? '#10B981' : 'var(--mc-text-2)', fontWeight: ds === 'DRIFTING' ? 800 : undefined }}>{fmtPct(e.move_pct, 1)}</td>
                <td style={{ ...td, textAlign: 'left', color: 'var(--mc-text-3)' }}>{e.filing_date}</td>
                <td style={td}><button onClick={() => onRemove(e.ticker)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mc-text-4)' }}><X className="w-3 h-3" /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
