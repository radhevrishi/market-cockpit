'use client';

// ═══════════════════════════════════════════════════════════════════════════
// US EARNINGS OPPORTUNITIES — the US sibling of /earnings-opportunities.
//
// Same tier vocabulary, same card grammar, same accent colours as the India
// page, so the two read identically. Everything India-specific is replaced:
// ₹Cr → $M, IST → ET, Screener → SEC EDGAR.
//
// THE ONE UX DIFFERENCE FROM INDIA, AND WHY
// ──────────────────────────────────────────
// India's page is date-pinned because NSE/BSE publish the numbers with the
// announcement. In the US the 8-K announces and the 10-Q carries the XBRL, and
// they can be days or weeks apart — so a strict single-day view would show a
// near-empty page most days. This page therefore defaults to a ROLLING WINDOW
// (5 sessions) and states plainly how many filers are still waiting on their
// XBRL, rather than pretending they don't exist.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, ExternalLink, RefreshCw, ChevronDown, ChevronRight, Award, AlertTriangle } from 'lucide-react';
import { syncUsConviction } from '@/lib/conviction-beats-us';
import {
  fmtUsd, fmtPx, fmtPct, US_TIER_ORDER,
  type UsGradedRow, type EarningsTier,
} from '@/lib/us-earnings-core';
import { debouncedSetItem, getItemSync } from '@/lib/debounced-storage';

interface UsPayload {
  filing_date: string | null;
  window_days: number;
  window_start: string | null;
  candidates_total: number;
  raw_items_total: number;
  pending_xbrl_total: number;
  no_price_total: number;
  by_tier: Record<EarningsTier, UsGradedRow[]>;
  generated_at: string;
  truncated: boolean;
  notes: string[];
}

const TIER_META: Record<EarningsTier, { label: string; color: string; icon: string; tagline: string }> = {
  BLOCKBUSTER: { label: 'BLOCKBUSTER', color: '#F59E0B', icon: '🔥', tagline: 'Explosive growth, clean quality, market confirming' },
  STRONG: { label: 'STRONG', color: '#10B981', icon: '✅', tagline: 'Solid beat with at least one methodology passing' },
  MIXED: { label: 'MIXED', color: '#FACC15', icon: '⚠️', tagline: 'Growth present but with caveats — needs a second look' },
  AVOID: { label: 'AVOID', color: '#EF4444', icon: '⛔', tagline: 'Fails the bar on growth, quality or trend' },
};

const LS_PREFIX = 'mc:graded-us:v1:';
const LS_DATE = 'mc:us-eo:v1:date';
const LS_DAYS = 'mc:us-eo:v1:days';

/** ET-anchored today. US markets close at 16:00 ET; anchoring at UTC-4 keeps
 *  "today" correct for anyone loading the page from Europe after the close. */
function etToday(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}

function readCache(key: string, isToday: boolean): UsPayload | null {
  try {
    const raw = getItemSync(LS_PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const age = Date.now() - Date.parse(o?._cachedAt || '');
    const maxAge = isToday ? 15 * 60_000 : 7 * 24 * 3600_000;
    if (!Number.isFinite(age) || age > maxAge) return null;
    if (!o?.by_tier) return null;
    return o as UsPayload;
  } catch { return null; }
}

export default function UsEarningsOpportunitiesPage() {
  const today = etToday();
  const [date, setDate] = useState<string>(() => {
    try { return getItemSync(LS_DATE) || today; } catch { return today; }
  });
  const [days, setDays] = useState<number>(() => {
    try { return parseInt(getItemSync(LS_DAYS) || '5', 10) || 5; } catch { return 5; }
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    BLOCKBUSTER: true, STRONG: true, MIXED: false, AVOID: false,
  });
  const [minCap, setMinCap] = useState<number | null>(null);
  const [smidOnly, setSmidOnly] = useState(false);
  const [forceKey, setForceKey] = useState(0);

  useEffect(() => { try { debouncedSetItem(LS_DATE, date); } catch {} }, [date]);
  useEffect(() => { try { debouncedSetItem(LS_DAYS, String(days)); } catch {} }, [days]);

  const cacheKey = `${date}|${days}`;
  const isToday = date >= today;

  const { data, isLoading, isFetching, error, refetch } = useQuery<UsPayload>({
    queryKey: ['graded-us', cacheKey, forceKey],
    queryFn: async () => {
      if (forceKey === 0) {
        const cached = readCache(cacheKey, isToday);
        if (cached) return cached;
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 280_000);
      try {
        const res = await fetch(
          `/api/v1/earnings/graded-us?date=${date}&days=${days}${forceKey > 0 ? '&force=1' : ''}`,
          { cache: 'no-store', signal: ctrl.signal },
        );
        if (!res.ok) throw new Error(`Grading failed (HTTP ${res.status})`);
        const payload = await res.json();
        try {
          debouncedSetItem(LS_PREFIX + cacheKey, JSON.stringify({ ...payload, _cachedAt: new Date().toISOString() }));
        } catch { /* quota — the payload still renders, it just isn't cached */ }
        return payload;
      } finally { clearTimeout(timer); }
    },
    staleTime: isToday ? 3 * 60_000 : 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Push BLOCKBUSTER / STRONG (and demotions) onto the US bench.
  useEffect(() => {
    if (!data?.by_tier) return;
    const entries: any[] = [];
    for (const tier of US_TIER_ORDER) {
      for (const c of (data.by_tier[tier] || [])) {
        entries.push({
          ticker: c.ticker, company: c.company, tier: c.tier,
          composite_score: c.composite_score,
          sales_yoy_pct: c.sales_yoy_pct, net_profit_yoy_pct: c.net_profit_yoy_pct, eps_yoy_pct: c.eps_yoy_pct,
          filing_date: c.filing_date, period_end: c.period_end,
          quarter: c.quarter, fiscal_year: c.fiscal_year, sector: c.sector, form: c.form,
          market_cap_musd: c.market_cap_musd, market_cap_bucket: c.market_cap_bucket,
          price: c.price, pe: c.pe,
          revenue_curr_musd: c.revenue_curr_musd, revenue_prev_musd: c.revenue_prev_musd,
          net_income_curr_musd: c.net_income_curr_musd,
          eps_curr: c.eps_curr, eps_prev: c.eps_prev, cfo_curr_musd: c.cfo_curr_musd,
          opm_pct: c.opm_pct, opm_prev_pct: c.opm_prev_pct, cfo_to_pat_ratio: c.cfo_to_pat_ratio,
          d1_pct: c.d1_pct, gap_pct: c.gap_pct, move_pct: c.move_pct,
          rs_rating: c.rs_rating, stage: c.stage, pct_from_52w_high: c.pct_from_52w_high,
          addv_musd: c.addv_musd, vol_ratio_20d: c.vol_ratio_20d,
          quarters_revenue: c.quarters_revenue, quarters_eps: c.quarters_eps, quarters_opm: c.quarters_opm,
          close_30d: (c as any).close_30d,
          is_elite: c.is_elite, pead_score: c.pead_score, multibagger_setup: c.multibagger_setup,
          is_financial: (c as any).is_financial,
          caveat_tags: c.caveat_tags, methodology_tags: c.methodology_tags, narrative: c.narrative,
          source_url: c.filing_url,
        });
      }
    }
    if (entries.length) syncUsConviction(entries);
  }, [data]);

  const view = useMemo(() => {
    const out: Record<EarningsTier, UsGradedRow[]> = { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] };
    if (!data?.by_tier) return out;
    for (const t of US_TIER_ORDER) {
      out[t] = (data.by_tier[t] || []).filter((r) => {
        if (minCap != null && (r.market_cap_musd == null || r.market_cap_musd < minCap)) return false;
        if (smidOnly) {
          const b = r.market_cap_bucket;
          if (b !== 'small' && b !== 'mid') return false;
        }
        return true;
      });
    }
    return out;
  }, [data, minCap, smidOnly]);

  const shownTotal = US_TIER_ORDER.reduce((n, t) => n + view[t].length, 0);

  const shiftDate = (n: number) => {
    const d = new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000);
    const iso = d.toISOString().slice(0, 10);
    setDate(iso > today ? today : iso);
  };

  return (
    <div style={{ padding: '20px', maxWidth: 1500, margin: '0 auto' }}>
      {/* ── header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <Star className="w-5 h-5" style={{ color: '#F59E0B' }} />
        <h1 style={{ fontSize: 'var(--mc-text-h3)', fontWeight: 800, color: 'var(--mc-text-0)', margin: 0 }}>
          US Earnings Opportunities
        </h1>
        <span style={{
          fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 8px', borderRadius: 999,
          border: '1px solid var(--mc-cyan)', color: 'var(--mc-cyan)',
        }}>NYSE · NASDAQ</span>
        <a href="/us-conviction-beats" style={{
          fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 10px', borderRadius: 999,
          border: '1px solid var(--mc-warn)', color: 'var(--mc-warn)', textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}><Award className="w-3 h-3" /> US Conviction Beats →</a>
      </div>
      <p style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)', margin: '0 0 16px' }}>
        Every US company that filed results in the window, graded on the same scale as the India engine.
        Numbers come straight from the SEC EDGAR XBRL filings — not an aggregator — with prices and the
        post-earnings reaction from daily bars. Educational, not investment advice.
      </p>

      {/* ── controls ── */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        padding: 12, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)',
        border: '1px solid var(--mc-bg-4)', marginBottom: 16,
      }}>
        <button onClick={() => shiftDate(-1)} style={btn()}>←</button>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)}
          style={{ ...btn(), padding: '6px 10px', colorScheme: 'light dark' }} />
        <button onClick={() => shiftDate(1)} style={btn()}>→</button>
        <button onClick={() => setDate(today)} style={btn(date === today)}>Today</button>

        <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)', marginLeft: 8 }}>Window</span>
        {[1, 3, 5, 10].map((d) => (
          <button key={d} onClick={() => setDays(d)} style={btn(days === d)}>{d}d</button>
        ))}

        <span style={{ width: 1, height: 22, backgroundColor: 'var(--mc-bg-4)', margin: '0 4px' }} />
        <button onClick={() => setSmidOnly((v) => !v)} style={btn(smidOnly, '#8B5CF6')}>
          Small + Mid only
        </button>
        {[null, 300, 1000, 5000].map((c) => (
          <button key={String(c)} onClick={() => setMinCap(c)} style={btn(minCap === c)}>
            {c == null ? 'Any cap' : `≥ $${c >= 1000 ? `${c / 1000}B` : `${c}M`}`}
          </button>
        ))}

        <span style={{ flex: 1 }} />
        <button onClick={() => { setForceKey((k) => k + 1); setTimeout(() => refetch(), 0); }}
          disabled={isFetching} style={{ ...btn(), opacity: isFetching ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw className="w-3 h-3" style={{ animation: isFetching ? 'spin 1s linear infinite' : undefined }} />
          {isFetching ? 'Scanning…' : 'Force re-scan'}
        </button>
      </div>

      {/* ── coverage strip ── */}
      {data && (
        <div style={{
          display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16,
          padding: '10px 14px', borderRadius: 'var(--mc-radius)',
          backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
          fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)',
        }}>
          <span><b style={{ color: 'var(--mc-text-0)' }}>{data.raw_items_total}</b> filers {data.window_start ? `${data.window_start} → ${data.filing_date}` : ''}</span>
          <span><b style={{ color: 'var(--mc-text-0)' }}>{data.candidates_total}</b> graded</span>
          <span><b style={{ color: 'var(--mc-text-0)' }}>{shownTotal}</b> shown after filters</span>
          {data.pending_xbrl_total > 0 && (
            <span style={{ color: 'var(--mc-text-3)' }}>
              <AlertTriangle className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
              {data.pending_xbrl_total} announced, XBRL not posted yet
            </span>
          )}
          {data.no_price_total > 0 && <span style={{ color: 'var(--mc-text-3)' }}>{data.no_price_total} without price history</span>}
          <span style={{ marginLeft: 'auto', color: 'var(--mc-text-4)' }}>
            SEC EDGAR · updated {new Date(data.generated_at).toLocaleTimeString()}
          </span>
        </div>
      )}

      {isLoading && (
        <div style={panel()}>
          <div style={{ color: 'var(--mc-text-2)' }}>
            Pulling the filing list from EDGAR, then the XBRL for each filer. A busy window takes 20–60 seconds.
          </div>
        </div>
      )}
      {!!error && (
        <div style={{ ...panel(), borderLeft: '4px solid #EF4444' }}>
          <div style={{ color: '#EF4444', fontWeight: 700 }}>Could not grade this window</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)', marginTop: 4 }}>
            {String((error as any)?.message || error)}
          </div>
        </div>
      )}

      {data && shownTotal === 0 && !isLoading && (
        <div style={panel()}>
          <div style={{ fontWeight: 700, color: 'var(--mc-text-0)', marginBottom: 6 }}>Nothing graded in this window</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)' }}>
            {data.raw_items_total > 0
              ? `${data.raw_items_total} companies filed, but none cleared the filters (or their XBRL has not posted yet). Try widening the window to 10d, or clearing the market-cap filter.`
              : 'No US earnings filings in this window — try a weekday during earnings season (the fortnight after each quarter end is the dense stretch).'}
          </div>
        </div>
      )}

      {/* ── tier sections ── */}
      {US_TIER_ORDER.map((tier) => {
        const rows = view[tier];
        if (!rows.length) return null;
        const meta = TIER_META[tier];
        const open = expanded[tier];
        return (
          <div key={tier} style={{
            marginBottom: 18, borderRadius: 'var(--mc-radius)', overflow: 'hidden',
            backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
            borderLeft: `4px solid ${meta.color}`,
          }}>
            <button onClick={() => setExpanded((e) => ({ ...e, [tier]: !e[tier] }))}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}>
              {open ? <ChevronDown className="w-4 h-4" style={{ color: meta.color }} /> : <ChevronRight className="w-4 h-4" style={{ color: meta.color }} />}
              <span style={{ fontSize: 16 }}>{meta.icon}</span>
              <span style={{ fontWeight: 800, color: meta.color, letterSpacing: 0.4 }}>{meta.label}</span>
              <span style={{
                fontWeight: 800, fontSize: 'var(--mc-text-xs)', padding: '2px 8px', borderRadius: 999,
                backgroundColor: `color-mix(in srgb, ${meta.color} 15%, transparent)`, color: meta.color,
              }}>{rows.length}</span>
              <span style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>{meta.tagline}</span>
            </button>
            {open && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
                gap: 12, padding: '0 14px 14px',
              }}>
                {rows.map((r) => <UsEarningsCard key={`${r.ticker}:${r.filing_date}`} r={r} />)}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ color: 'var(--mc-text-4)', fontSize: 'var(--mc-text-xs)', marginTop: 20, lineHeight: 1.6 }}>
        <b>How a US grade is built.</b> An earnings release is an 8-K carrying Item 2.02; the numbers come
        from the company&apos;s own XBRL tags in its 10-Q/10-K. Quarterly cash flow is de-cumulated from the
        year-to-date figure, a missing Q4 is derived as the full year minus its three quarters, and the
        year-ago quarter is matched by nearest period end so 52/53-week and non-calendar fiscal years line
        up. Operating margin uses GAAP <code>OperatingIncomeLoss</code>, which is why it can differ from a
        screener&apos;s &quot;normalized&quot; operating income. Market cap is SEC cover-page shares × last
        price. RS is a cohort percentile blended with performance versus SPY — it is our construction, not
        an IBD rating. Analyst-consensus &quot;beat vs estimate&quot; is not available free, so the grade is
        built on absolute growth, margins, cash conversion and the market&apos;s own reaction.
      </div>
      <style>{'@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

function btn(active = false, color = 'var(--mc-cyan)'): React.CSSProperties {
  return {
    fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '6px 10px',
    borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? color : 'var(--mc-bg-4)'}`,
    color: active ? color : 'var(--mc-text-2)',
    backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--mc-bg-2)',
  };
}
function panel(): React.CSSProperties {
  return {
    padding: 16, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)',
    border: '1px solid var(--mc-bg-4)', marginBottom: 16,
  };
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 6,
      padding: '7px 9px', minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || 'var(--mc-text-0)', lineHeight: 1.25 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--mc-text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}

const growthColor = (v: number | null | undefined) =>
  v == null ? 'var(--mc-text-3)' : v >= 25 ? 'var(--mc-bullish)' : v >= 0 ? 'var(--mc-text-0)' : 'var(--mc-bearish)';

function UsEarningsCard({ r }: { r: UsGradedRow }) {
  const meta = TIER_META[r.tier];
  const opmD = (r.opm_pct != null && r.opm_prev_pct != null) ? r.opm_pct - r.opm_prev_pct : null;
  return (
    <div style={{
      backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
      borderRadius: 'var(--mc-radius)', padding: 12, borderTop: `3px solid ${meta.color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--mc-text-0)' }}>{r.ticker}</span>
        <span style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.company}
        </span>
        <span style={{ fontWeight: 800, fontSize: 13, color: meta.color }}>{r.composite_score}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0 9px' }}>
        <Chip text={r.quarter} />
        {r.sector && <Chip text={r.sector} />}
        <Chip text={fmtUsd(r.market_cap_musd)} />
        {r.is_elite && <Chip text="⭐ ELITE" color="#F59E0B" />}
        {r.multibagger_setup && <Chip text="💎 MULTIBAGGER" color="#8B5CF6" />}
        {(r.pead_score ?? 0) >= 70 && <Chip text={`🔥 PEAD ${r.pead_score}`} color="#EF4444" />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <Tile label="REVENUE" value={fmtPct(r.sales_yoy_pct)} color={growthColor(r.sales_yoy_pct)}
          sub={`${fmtUsd(r.revenue_prev_musd)} → ${fmtUsd(r.revenue_curr_musd)}`} />
        <Tile label="EPS" value={fmtPct(r.eps_yoy_pct)} color={growthColor(r.eps_yoy_pct)}
          sub={r.eps_prev != null && r.eps_curr != null ? `$${r.eps_prev.toFixed(2)} → $${r.eps_curr.toFixed(2)}` : 'n/m — negative base'} />
        <Tile label="OPM" value={r.opm_pct != null ? `${r.opm_pct.toFixed(1)}%` : '—'}
          color={opmD == null ? undefined : opmD >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)'}
          sub={opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp YoY` : 'no prior margin'} />
        <Tile label="CFO/NI" value={r.cfo_to_pat_ratio != null ? r.cfo_to_pat_ratio.toFixed(2) : '—'}
          color={r.cfo_to_pat_ratio == null ? undefined : r.cfo_to_pat_ratio >= 1 ? 'var(--mc-bullish)' : r.cfo_to_pat_ratio >= 0.5 ? undefined : 'var(--mc-bearish)'}
          sub={r.cfo_curr_musd != null ? `CFO ${fmtUsd(r.cfo_curr_musd)}` : 'cash flow pending'} />
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '9px 0 0', fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)' }}>
        <span>Reaction <b style={{ color: r.d1_pct == null ? 'var(--mc-text-3)' : r.d1_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.d1_pct, 1)}</b></span>
        <span>Since <b style={{ color: r.move_pct == null ? 'var(--mc-text-3)' : r.move_pct >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{fmtPct(r.move_pct, 1)}</b></span>
        <span>PEAD <b style={{ color: 'var(--mc-text-0)' }}>{r.pead_score}</b></span>
        <span>RS <b style={{ color: 'var(--mc-text-0)' }}>{r.rs_rating ?? '—'}</b></span>
        <span>Stage <b style={{ color: r.stage === 4 ? 'var(--mc-bearish)' : r.stage === 2 ? 'var(--mc-bullish)' : 'var(--mc-text-0)' }}>{r.stage ?? '—'}</b></span>
        <span>{fmtPx(r.price)}{r.pe ? ` · P/E ${r.pe}` : ''}</span>
      </div>

      <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', marginTop: 9, lineHeight: 1.5 }}>
        {r.narrative}
      </div>

      {(r.methodology_tags.length > 0 || r.caveat_tags.length > 0) && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
          {r.methodology_tags.map((t) => <Chip key={t} text={t} color="#10B981" />)}
          {r.caveat_tags.map((t) => <Chip key={t} text={t} color="#EF4444" />)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 9, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>{r.form} · filed {r.filing_date}</span>
        {r.filing_url && (
          <a href={r.filing_url} target="_blank" rel="noreferrer"
            style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            SEC filing <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function Chip({ text, color }: { text: string; color?: string }) {
  const c = color || 'var(--mc-text-3)';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
      border: `1px solid ${color ? c : 'var(--mc-bg-4)'}`, color: c,
      backgroundColor: color ? `color-mix(in srgb, ${c} 10%, transparent)` : 'transparent',
      whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}
