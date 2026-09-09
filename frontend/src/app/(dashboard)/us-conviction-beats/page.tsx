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
import toast from 'react-hot-toast';
import { Award, RefreshCw, X, Undo2, ExternalLink, Star, Copy } from 'lucide-react';
import {
  getUsConvictionList, removeUsConviction, clearUsConviction, syncUsConviction,
  restoreUsConvictionBin, readUsConvictionBin,
  usFilingAgeDays, computeUsNewWindow, usVerdict, usRule40, usRoce,
  passesUsConvictionFilter, usPresetFilters, isUsPresetActive,
  US_FILTER_DEFAULT, US_PRESET,
  type UsConvictionEntry, type UsConvFilters,
} from '@/lib/conviction-beats-us';
import { fmtUsd, fmtPct } from '@/lib/us-earnings-core';
// ONE card, shared with /us-earnings-opportunities. See the header of
// src/components/us-earnings-card.tsx for why it is not two.
import {
  UsEarningsCard, Chip, QuarterBasisBadge, rule40Title, QUADRANT_META, quadrantTitle,
  type Rule40Like,
} from '@/components/us-earnings-card';
import { buildTvExport } from '@/lib/us-tradingview';
import { knownExchanges, resolveExchanges } from '@/lib/us-exchange-client';

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

/** Identity for the open/closed state of one card. The BENCH KEY, not the
 *  ticker: an archived quarter is stored under `TICKER@Q3-2026` and shares its
 *  ticker with the live entry, so a ticker key opened and closed both. */
function cardKey(e: UsConvictionEntry): string {
  return e.bench_key || `${e.ticker}|${e.period_end || e.filing_date}`;
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
  // Which cards have their detail panel open, keyed by BENCH KEY rather than by
  // ticker: an archived quarter lives under `TICKER@Q3-2026` and shares its
  // ticker with the live entry, so keying by ticker opened both at once.
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);

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

  // ── expand / collapse ──────────────────────────────────────────────────
  const toggleCard = useCallback((k: string) => {
    setOpenCards((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }, []);
  // Expand-all works on the rows that pass the filters — the same set the
  // TradingView copy exports, so what you open is what you copy.
  const visibleKeys = useMemo(() => filtered.map(cardKey), [filtered]);
  const allOpen = visibleKeys.length > 0 && visibleKeys.every((k) => openCards.has(k));
  const toggleAll = () => {
    setOpenCards((prev) => {
      const n = new Set(prev);
      for (const k of visibleKeys) { if (allOpen) n.delete(k); else n.add(k); }
      return n;
    });
  };

  const setSortKey = (k: SortKey) => {
    if (sort === k) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSort(k); setSortDir(k === 'pe' || k === 'age' ? 'asc' : 'desc'); }
  };

  const exportCsv = () => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Ticker', 'Company', 'Tier', 'Quadrant', 'Quality', 'Inflection', 'Verdict', 'Score', 'Quarter', 'Filed', 'Rev YoY %', 'NI YoY %', 'EPS YoY %',
      'OPM %', 'OPM prev %', 'CFO/NI', 'Rule of 40', 'R40 basis', 'ROCE %', 'PEAD', 'RS', 'Stage', '% from 52w high', 'ADDV $M', 'Mkt cap $M', 'Price', 'P/E',
      'D1 %', 'Since %', 'Sector', 'Caveats', 'SEC'];
    const body = filtered.map((e) => [e.ticker, e.company, e.tier,
      e.quadrant ?? '', e.quality_score ?? '', e.inflection_score ?? '',
      usVerdict(e).verdictLabel, e.composite_score, e.quarter, e.filing_date,
      e.sales_yoy_pct?.toFixed(1), e.net_profit_yoy_pct?.toFixed(1), e.eps_yoy_pct?.toFixed(1),
      e.opm_pct?.toFixed(2), e.opm_prev_pct?.toFixed(2), e.cfo_to_pat_ratio?.toFixed(2),
      usRule40(e)?.score, usRule40(e)?.basis, usRoce(e)?.pct,
      e.pead_score, e.rs_rating, e.stage,
      e.pct_from_52w_high?.toFixed(1), e.addv_musd?.toFixed(1), e.market_cap_musd?.toFixed(0), e.price?.toFixed(2), e.pe,
      e.d1_pct?.toFixed(2), e.move_pct?.toFixed(2), e.sector, (e.caveat_tags || []).join(' | '), e.source_url].map(esc).join(','));
    download(`us-conviction-beats-${etToday()}.csv`, [head.map(esc).join(','), ...body].join('\n'));
  };
  /**
   * COPY → TRADINGVIEW, grouped by tier.
   *
   *   ###ELITE,NASDAQ:NVDA,NASDAQ:AVGO,###BLOCKBUSTER,NYSE:KEYS,…
   *
   * Same semantics as the India tabs: descending quality order, and a name in a
   * higher group is deduped out of every lower one. Only the rows that pass the
   * filters currently applied are copied — the export is what is on screen.
   *
   * The exchange prefix is RESOLVED, never guessed: the venue comes from the
   * bench row when the payload carried one, otherwise from SEC's
   * `company_tickers_exchange.json` through /api/v1/us/exchange (cached in this
   * browser for a week). A name whose venue genuinely cannot be established is
   * still exported, as a bare ticker — a form TradingView accepts — rather than
   * being dropped or given a guessed prefix that TradingView would silently
   * discard. See lib/us-tradingview.ts.
   */
  const exportTv = useCallback(async (mode: 'copy' | 'download') => {
    if (!filtered.length) { toast.error('Nothing passes the current filters'); return; }
    const tickers = filtered.map((e) => e.ticker);
    // Paint from whatever is already cached, then top up over the network. A
    // failed fetch degrades to bare tickers, never to a wrong prefix.
    let venues: Record<string, string | null> = knownExchanges(tickers);
    try { venues = { ...venues, ...(await resolveExchanges(tickers)) }; } catch { /* cached half still exports */ }
    const venueFor = (e: UsConvictionEntry): string | null =>
      e.exchange ?? venues[e.ticker.toUpperCase().split('@')[0]] ?? null;
    const rowsOf = (list: UsConvictionEntry[]) => list.map((e) => ({ ticker: e.ticker, exchange: venueFor(e) }));

    const out = buildTvExport([
      { label: 'ELITE', rows: rowsOf(filtered.filter((e) => e.is_elite)) },
      { label: 'BLOCKBUSTER', rows: rowsOf(filtered.filter((e) => e.tier === 'BLOCKBUSTER')) },
      { label: 'STRONG', rows: rowsOf(filtered.filter((e) => e.tier === 'STRONG')) },
    ]);
    if (!out.count) { toast.error('Nothing to copy'); return; }
    const tail = out.unresolved.length
      ? ` · ${out.unresolved.length} without a venue prefix (SEC lists no exchange for ${out.unresolved.slice(0, 3).join(', ')}${out.unresolved.length > 3 ? '…' : ''})`
      : '';
    const summary = out.groups.map((g) => `${g.label} ${g.count}`).join(' · ');

    if (mode === 'download') {
      download(`us-conviction-beats-${etToday()}-tradingview.txt`, out.text, 'text/plain');
      toast.success(`${out.count} tickers · ${summary}${tail}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(out.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success(`Copied ${out.count} tickers in ${out.groups.length} section${out.groups.length === 1 ? '' : 's'} for TradingView · ${summary}${tail}`);
    } catch {
      // Clipboard permission denied (or an insecure origin). Fall back to the
      // file so the export still reaches the user.
      download(`us-conviction-beats-${etToday()}-tradingview.txt`, out.text, 'text/plain');
      toast.error('Clipboard blocked — downloaded the list as a file instead');
    }
  }, [filtered]);

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
        <button onClick={() => setFilters((p) => ({ ...p, rule40: !p.rule40 }))} style={chip(filters.rule40, '#10B981')}
          title="Revenue growth % + free-cash-flow margin %, both trailing twelve months, at or above 40. A name whose filing does not support the arithmetic is cut, never assumed to pass.">
          ⚡ RULE OF 40 ({countWith({ rule40: true })})
        </button>
        <button onClick={() => setFilters((p) => ({ ...p, roce20: !p.roce20 }))} style={chip(filters.roce20, '#10B981')}
          title="Trailing-twelve-month operating income ÷ (total assets − current liabilities), at or above 20%. Not computed for a filer with no classified balance sheet — a bank's current liabilities are its deposits.">
          🏭 ROCE ≥20% ({countWith({ roce20: true })})
        </button>
        {/* THE SECOND AXIS, as two chips and not four — the same decision as the
            Opportunities tab, for the same reason. REJECT is a thing you filter
            OUT rather than in, and QUALITY asks almost exactly what the two
            chips to the left of it already ask. */}
        <button onClick={() => setFilters((p) => ({ ...p, turnaround: !p.turnaround }))}
          style={chip(filters.turnaround, QUADRANT_META['TURNAROUND ACCELERATOR'].color)}
          title={QUADRANT_META['TURNAROUND ACCELERATOR'].tagline}>
          {QUADRANT_META['TURNAROUND ACCELERATOR'].icon} TURNAROUND ACCELERATOR ({countWith({ turnaround: true })})
        </button>
        <button onClick={() => setFilters((p) => ({ ...p, compounder: !p.compounder }))}
          style={chip(filters.compounder, QUADRANT_META.COMPOUNDER.color)}
          title={QUADRANT_META.COMPOUNDER.tagline}>
          {QUADRANT_META.COMPOUNDER.icon} COMPOUNDER ({countWith({ compounder: true })})
        </button>
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
        {view === 'cards' && filtered.length > 0 && (
          <button onClick={toggleAll} style={chip(allOpen)} aria-expanded={allOpen}
            title="Open the full write-up — guidance, results, margins, balance sheet — on every card that passes the filters">
            {allOpen ? '⊟ Collapse all' : `⊞ Expand all ${filtered.length}`}
          </button>
        )}
        <button onClick={exportCsv} style={chip(false)}>📊 CSV</button>
        <button onClick={() => exportTv('copy')} style={chip(copied, '#10B981')}
          title="Copy the filtered bench for TradingView, grouped ###ELITE / ###BLOCKBUSTER / ###STRONG with the real exchange prefix on every symbol">
          <Copy className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
          {copied ? '✓ Copied' : 'Copy → TradingView'}
        </button>
        <button onClick={() => exportTv('download')} style={chip(false)}
          title="The same grouped list as a .txt file">📈 .txt</button>
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
            It fills itself from graded US results, or you can rebuild it now.
          </div>
          {/* THE ACTION THE EMPTY STATE DESCRIBES HAS TO BE IN THE EMPTY STATE.
              This used to say "hit Rebuild + re-price above" — and above is a
              status strip that, on a bench with nothing in it, is a row of
              zeroes the eye skips, with the button last in a wrapping flex row.
              Right after "Clear all" the auto-sweep also greys that button out,
              so the one instruction on screen pointed at a control that was
              both hard to find and disabled. */}
          <button onClick={() => sweep(30, true)} disabled={sweeping}
            style={{
              marginTop: 12, padding: '9px 16px', borderRadius: 'var(--mc-radius)',
              border: '1px solid var(--mc-cyan)', background: 'var(--mc-cyan)',
              color: '#04121A', fontWeight: 800, fontSize: 'var(--mc-text-sm)',
              cursor: sweeping ? 'default' : 'pointer', opacity: sweeping ? 0.6 : 1,
            }}>
            <RefreshCw className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6, animation: sweeping ? 'spin 1s linear infinite' : undefined }} />
            {sweeping ? 'Rebuilding…' : 'Rebuild the bench (30 sessions)'}
          </button>
          <div style={{ marginTop: 10, color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>
            Or open <a href="/us-earnings-opportunities" style={{ color: 'var(--mc-cyan)' }}>US Earnings Opportunities</a> — every graded window syncs here automatically.
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
          {filtered.map((e) => {
            const k = cardKey(e);
            return (
              <BenchCard key={k} e={e}
                open={openCards.has(k)} onToggle={() => toggleCard(k)}
                onRemove={() => { removeUsConviction(e.bench_key || e.ticker); reload(); }} />
            );
          })}
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

/**
 * THE BENCH CARD.
 *
 * It IS the Opportunities card — same five metric tiles, same secondary tiles,
 * same R40 / ROCE / SETUP chips, same expand panel with the guidance, the
 * four-period results and margin tables, the balance-sheet context and the
 * post-earnings setup scorecard. What the bench adds is the three things only
 * it knows: its own verdict, how the name has drifted since the print, and the
 * button that takes it off the bench. Those go in through the card's slots
 * rather than into a second card of our own, which is how the two tabs used to
 * end up showing the same company two different ways.
 *
 * The row handed to the card is the bench entry with three normalisations:
 *   • `filing_url` — the bench stores the same link under `source_url`.
 *   • `rule40` / `roce` — the stored figures, or the same computation over the
 *     stored series for an entry benched before the payload carried them. Null
 *     stays null: a name whose filing does not support either shows no chip.
 *   • the two tag arrays, which the card reads `.length` off.
 * Nothing else is touched, and nothing is invented.
 */
function BenchCard({ e, open, onToggle, onRemove }: {
  e: UsConvictionEntry; open: boolean; onToggle: () => void; onRemove: () => void;
}) {
  const v = usVerdict(e);
  const age = usFilingAgeDays(e.filing_date);
  const ds = driftState(e);
  const driftColor = ds === 'DRIFTING' ? '#EF4444' : ds === 'FADING' ? '#F59E0B' : ds === 'RUNNING' ? '#10B981' : 'var(--mc-text-3)';

  const row = useMemo(() => ({
    ...e,
    filing_url: e.source_url ?? null,
    rule40: usRule40(e),
    roce: usRoce(e),
    caveat_tags: Array.isArray(e.caveat_tags) ? e.caveat_tags : [],
    methodology_tags: Array.isArray(e.methodology_tags) ? e.methodology_tags : [],
  }), [e]);

  return (
    <UsEarningsCard
      r={row as any}
      open={open}
      onToggle={onToggle}
      panelId={`us-cb-panel-${String(e.bench_key || e.ticker).replace(/[^A-Za-z0-9_-]/g, '-')}`}
      topRight={
        <button onClick={onRemove} title="Remove from bench"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mc-text-4)', padding: 2, lineHeight: 0 }}>
          <X className="w-3 h-3" />
        </button>
      }
      extraChips={
        <>
          <Chip text={e.tier} color={e.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981'} />
          {/* The bench's own earnings-quality verdict, with the reasons behind
              it on the tooltip — the card is a scanning surface and a second
              line of prose under every one of them is what made the old bench
              card twice as tall as it needed to be. */}
          <span title={v.reasons.length ? v.reasons.join(' · ') : undefined}>
            <Chip text={v.verdictLabel} color={VERDICT_COLOR[v.verdictLabel]} />
          </span>
          {ds && ds !== 'HOLDING' && (
            <Chip text={`${ds === 'DRIFTING' ? '⚠ ' : ''}${ds} ${fmtPct(e.move_pct, 0)}`} color={driftColor} />
          )}
          {age != null && <Chip text={`·${age}d`} />}
          {/* Tradeability. Two numbers, because a small cap that cannot be
              bought in size is not an opportunity however good the print was:
              under $2M traded a day a position of any size moves the price. */}
          {e.addv_musd != null && (
            <span title="20-day median dollar volume">
              <Chip text={`$Vol $${e.addv_musd.toFixed(1)}M/d`} color={e.addv_musd < 2 ? '#EF4444' : undefined} />
            </span>
          )}
          {e.pct_from_52w_high != null && (
            <span title="Distance from the 52-week high">
              <Chip text={`52w ${fmtPct(e.pct_from_52w_high, 0)}`} color={e.pct_from_52w_high >= -15 ? undefined : '#F59E0B'} />
            </span>
          )}
        </>
      }
      /* NO subFooter. The collapsed card ENDS AT THE NARRATIVE — everything
         else (the filing links, the filed date, the full guidance, the results
         and margin tables, the balance sheet) is in the expand panel, which is
         the same panel the Opportunities tab shows. */
    />
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
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1480 }}>
        <thead>
          <tr>
            <H label="Ticker" left /><H label="Company" left /><H label="Tier" left />
            <th style={th('Quadrant', undefined, true)}
              title="Quality × Inflection — what the business IS against what it is BECOMING. Blank on an entry benched before the second axis existed.">Quadrant</th>
            <th style={th('Q · I')} title="Quality score · Inflection score, each out of 100.">Q · I</th>
            <H label="Verdict" left />
            <H label="Rev YoY" k="sales" /><H label="EPS YoY" k="eps" /><th style={th('OPM Δ')}>OPM Δ</th><th style={th('CFO/NI')}>CFO/NI</th>
            <th style={th('R40')} title="Revenue growth % + FCF margin %, trailing twelve months. Blank where the filing does not support it.">R40</th>
            <th style={th('ROCE')} title="TTM operating income ÷ (total assets − current liabilities). Blank for a filer with no classified balance sheet.">ROCE</th>
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
            const r40 = usRule40(e);
            const roce = usRoce(e);
            const qm = e.quadrant ? QUADRANT_META[e.quadrant] : null;
            return (
              <tr key={`${e.ticker}-${e.filing_date}`} style={{ borderBottom: '1px solid var(--mc-bg-3)' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 800, color: 'var(--mc-text-0)' }}>
                  {e.source_url ? <a href={e.source_url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{e.ticker}</a> : e.ticker}
                </td>
                <td style={{ ...td, textAlign: 'left', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.company}>{e.company}</td>
                <td style={{ ...td, textAlign: 'left', color: tierColor, fontWeight: 800 }}>{e.tier}</td>
                {/* A blank cell is the honest rendering of "this entry carries
                    no quadrant"; a dash or a zero would both read as a
                    measurement that was actually taken. */}
                <td style={{ ...td, textAlign: 'left', fontWeight: 800, color: qm ? qm.color : undefined }}
                  title={e.quadrant ? quadrantTitle(e.quadrant, e.quality_score ?? null, e.inflection_score ?? null) : undefined}>
                  {qm ? `${qm.icon} ${e.quadrant}` : ''}
                </td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: 'var(--mc-text-2)' }}>
                  {e.quality_score != null || e.inflection_score != null
                    ? `${e.quality_score ?? '—'} · ${e.inflection_score ?? '—'}` : ''}
                </td>
                <td style={{ ...td, textAlign: 'left', color: VERDICT_COLOR[v.verdictLabel], fontWeight: 800 }}>{v.verdictLabel}</td>
                <td style={td}>{fmtPct(e.sales_yoy_pct)}</td>
                <td style={td}>{fmtPct(e.eps_yoy_pct)}</td>
                <td style={td}>{opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp` : '—'}</td>
                <td style={td}>{e.cfo_to_pat_ratio != null ? e.cfo_to_pat_ratio.toFixed(2) : (e.is_financial ? 'n/a' : '—')}</td>
                {/* A blank cell is the honest rendering of "the filing does not
                    support this figure"; a zero or a dash would both read as a
                    measurement that was actually taken. */}
                {/* The quarter/TTM basis is shown with the same superscript badge
                    and the same words as the card's R40 chip (see
                    us-earnings-card.tsx) — the "·q" suffix this used to print
                    read as a typo on both surfaces. */}
                <td style={{ ...td, color: r40 == null ? undefined : r40.passes ? '#10B981' : undefined, fontWeight: r40?.passes ? 800 : undefined }}
                  title={r40 == null ? undefined : rule40Title(r40 as Rule40Like)}>
                  {r40?.score ?? ''}{r40 && r40.basis === 'quarter' ? <QuarterBasisBadge /> : null}
                </td>
                <td style={{ ...td, color: roce == null ? undefined : roce.pct != null && roce.pct >= 20 ? '#10B981' : undefined }}
                  title={roce == null ? undefined : `TTM EBIT $${roce.ebit_ttm_musd}M ÷ capital employed $${roce.capital_employed_musd}M`}>
                  {roce?.pct != null ? `${roce.pct.toFixed(0)}%` : ''}
                </td>
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
