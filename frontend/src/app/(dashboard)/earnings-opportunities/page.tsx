'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS OPPORTUNITIES PRO — page (patch 0132)
//
// Pure presentation layer.  Reads from /api/v1/earnings/opportunities which
// fetches BSE/NSE results announcements + Indian results RSS feeds live and
// grades each filing into BLOCKBUSTER / STRONG / MIXED / AVOID.
//
// NO localStorage, NO Multibagger dependency, NO hardcoded data.
// All financials parsed server-side from result-announcement text.
// User: 'first calendar should be perfect with all these companies then
// getting correct data'.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar as CalendarIcon, ExternalLink, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import api from '@/lib/api';

type EarningsTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

interface ParsedEarning {
  ticker: string;
  company: string;
  sector?: string;
  filing_date: string;
  quarter: string;
  market_cap_bucket?: string;
  pe?: number | null;
  price?: number | null;
  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  sales_curr_cr: number | null;
  sales_prev_cr: number | null;
  pat_curr_cr: number | null;
  pat_prev_cr: number | null;
  eps_curr: number | null;
  eps_prev: number | null;
  gap_pct: number | null;
  d1_pct: number | null;
  composite_score: number;
  tier: EarningsTier;
  methodology_tags: string[];
  caveat_tags: string[];
  narrative: string;
  filing_url?: string;
  source: string;
}

interface OpportunitiesPayload {
  filing_date: string | null;
  candidates_total: number;
  raw_items_total: number;
  by_tier: Record<EarningsTier, ParsedEarning[]>;
  generated_at: string;
  sources_polled: number;
}

const TIER_META: Record<EarningsTier, { label: string; color: string; icon: string; tagline: string }> = {
  BLOCKBUSTER: { label: 'BLOCKBUSTER', color: '#F59E0B', icon: '⭐', tagline: 'Growth + quality aligned across Sales, EBITDA, Net Profit and EPS' },
  STRONG:      { label: 'STRONG',      color: '#10B981', icon: '🟢', tagline: 'Solid beat across most metrics — one or two caveats' },
  MIXED:       { label: 'MIXED',       color: '#FACC15', icon: '🟡', tagline: 'Optical beats — tax distortion, one-time items or methodology conflicts' },
  AVOID:       { label: 'AVOID',       color: '#EF4444', icon: '🔴', tagline: 'Fundamental or technical hard-fails — not long-trade candidates' },
};
const TIER_ORDER: EarningsTier[] = ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'];

function todayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function useEarningsOpportunities(date: string) {
  return useQuery<OpportunitiesPayload>({
    queryKey: ['earnings-opportunities', date || 'all'],
    queryFn: async () => {
      const { data } = await api.get(`/earnings/opportunities${date ? `?date=${date}` : ''}`);
      return data;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}

export default function EarningsOpportunitiesPage() {
  const [filterDate, setFilterDate] = useState<string>(todayISO());
  const [showAbout, setShowAbout] = useState(false);
  const [expanded, setExpanded] = useState<Record<EarningsTier, boolean>>({
    BLOCKBUSTER: true, STRONG: true, MIXED: false, AVOID: false,
  });

  const { data, isLoading, error, refetch } = useEarningsOpportunities(filterDate);

  const view: OpportunitiesPayload = data || {
    filing_date: filterDate || null,
    candidates_total: 0,
    raw_items_total: 0,
    by_tier: { BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [] },
    generated_at: '',
    sources_polled: 0,
  };

  const filingDateLabel = (() => {
    if (!filterDate) return 'Latest available';
    try {
      const d = new Date(filterDate);
      return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return filterDate; }
  })();

  const counts = TIER_ORDER.map((t) => ({ tier: t, n: view.by_tier[t]?.length || 0 }));

  function shiftDate(delta: number) {
    const base = filterDate || todayISO();
    const d = new Date(base);
    d.setDate(d.getDate() + delta);
    setFilterDate(d.toISOString().slice(0, 10));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0A0E1A' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #1A2540', backgroundColor: '#0D1623' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: '#E6EDF3', margin: 0 }}>Earnings Opportunities</h1>
          <button onClick={() => refetch()} title="Refresh"
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #1A2840', background: 'transparent', color: '#8A95A3', fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw style={{ width: 11, height: 11 }} /> Refresh
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7A8D' }}>
            Live BSE/NSE results pipeline · {view.sources_polled} sources polled
          </span>
        </div>

        <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#94A3B8', lineHeight: 1.55 }}>
              Yesterday's earnings, scored overnight — find the exceptional setups before the market opens.<br/>
              Every Indian filing graded into one of four conviction tiers — from <strong style={{ color: '#F59E0B' }}>BLOCKBUSTER</strong> through <strong style={{ color: '#10B981' }}>STRONG</strong>, <strong style={{ color: '#FACC15' }}>MIXED</strong>, and <strong style={{ color: '#EF4444' }}>AVOID</strong>.
            </div>
            <button onClick={() => setShowAbout((s) => !s)}
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #22D3EE60', background: '#22D3EE15', color: '#22D3EE', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              How it works {showAbout ? '▴' : '▾'}
            </button>
          </div>
          {showAbout && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1A2840', fontSize: 11.5, color: '#94A3B8', lineHeight: 1.7 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div><strong style={{ color: '#F59E0B' }}>⭐ BLOCKBUSTER</strong><br/>Exceptional fit on multiple lenses, clean earnings quality, technically primed. Rare — typically 0–3 names per day.</div>
                <div><strong style={{ color: '#10B981' }}>🟢 STRONG</strong><br/>High-conviction with clear pass on the strongest lenses; no material quality concerns.</div>
                <div><strong style={{ color: '#FACC15' }}>🟡 MIXED</strong><br/>Some lenses pass, some fail; or optically strong results shadowed by quality flags.</div>
                <div><strong style={{ color: '#EF4444' }}>🔴 AVOID</strong><br/>Multiple weakness signals or material quality flags dominate.</div>
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: '#6B7A8D', fontStyle: 'italic' }}>
                Educational only. Not investment advice. Server pipeline fetches BSE/NSE results announcements + Indian results RSS feeds. Parser accuracy depends on RSS title richness.
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid #1A2840', borderRadius: 8, padding: '2px 2px 2px 12px', backgroundColor: '#0A1422' }}>
            <span style={{ fontSize: 11, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.4px' }}>FILING DATE</span>
            <span style={{ fontSize: 12, color: '#22D3EE', fontWeight: 700 }}>· {filingDateLabel}</span>
            <button onClick={() => shiftDate(-1)} style={{ padding: '6px 10px', background: 'none', border: 'none', color: '#94A3B8', fontSize: 14, cursor: 'pointer' }}>←</button>
            <button onClick={() => shiftDate(1)}  style={{ padding: '6px 10px', background: 'none', border: 'none', color: '#94A3B8', fontSize: 14, cursor: 'pointer' }}>→</button>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1px solid #1A2840', borderRadius: 8, backgroundColor: '#0A1422', cursor: 'pointer' }}>
            <CalendarIcon style={{ width: 12, height: 12, color: '#94A3B8' }} />
            <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>Jump to</span>
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: '#22D3EE', fontSize: 12, fontWeight: 700, outline: 'none', cursor: 'pointer' }} />
          </label>
          {filterDate && (
            <button onClick={() => setFilterDate('')} title="Show latest available"
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #1A2840', backgroundColor: 'transparent', color: '#8A95A3', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              ↩ Latest
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7A8D' }}>
            {view.candidates_total} graded · {view.raw_items_total} earnings articles found
          </span>
          {counts.map((c) => (
            <span key={c.tier} style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              border: `1px solid ${TIER_META[c.tier].color}50`, backgroundColor: `${TIER_META[c.tier].color}15`, color: TIER_META[c.tier].color,
            }}>
              {TIER_META[c.tier].icon} {TIER_META[c.tier].label} {c.n}
            </span>
          ))}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isLoading && view.candidates_total === 0 && (
          <div style={{ color: '#6B7A8D', fontSize: 13, padding: 40, textAlign: 'center' }}>Fetching live results from BSE/NSE + 12 Indian results feeds…</div>
        )}
        {error && (
          <div style={{ color: '#EF4444', fontSize: 13, padding: 40, textAlign: 'center', backgroundColor: '#0D1623', border: '1px solid #EF444440', borderRadius: 10 }}>
            Error fetching earnings pipeline. Retry in a moment.
          </div>
        )}
        {!isLoading && view.candidates_total === 0 && !error && (
          <div style={{ color: '#6B7A8D', fontSize: 13, padding: 40, textAlign: 'center', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: 10 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
            No earnings filings parsed for <strong style={{ color: '#94A3B8' }}>{filingDateLabel}</strong>.<br/>
            <span style={{ fontSize: 11 }}>Server polled {view.sources_polled} feeds and found {view.raw_items_total} earnings articles — parser couldn't extract structured Q4 financials.<br/>Try a different date or clear the filter.</span>
            <div style={{ marginTop: 12 }}>
              <button onClick={() => setFilterDate('')} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #22D3EE60', backgroundColor: '#22D3EE15', color: '#22D3EE', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                Show latest available
              </button>
            </div>
          </div>
        )}
        {TIER_ORDER.map((tier) => {
          const stocks = view.by_tier[tier] || [];
          if (stocks.length === 0) return null;
          const meta = TIER_META[tier];
          const isOpen = expanded[tier];
          return (
            <div key={tier} style={{ backgroundColor: '#0D1623', border: '1px solid #1A2540', borderLeft: `4px solid ${meta.color}`, borderRadius: 12 }}>
              <button onClick={() => setExpanded((s) => ({ ...s, [tier]: !s[tier] }))}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', color: 'inherit' }}>
                {isOpen ? <ChevronDown style={{ width: 16, height: 16, color: '#6B7A8D' }} /> : <ChevronRight style={{ width: 16, height: 16, color: '#6B7A8D' }} />}
                <span style={{ fontSize: 16, fontWeight: 800, color: meta.color }}>{meta.icon} {meta.label}</span>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>{stocks.length} {stocks.length === 1 ? 'company' : 'companies'}</span>
                <span style={{ fontSize: 11, color: '#6B7A8D' }}>· {meta.tagline}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '0 18px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
                  {stocks.map((s) => <EarningsCard key={s.ticker + ':' + s.company} stock={s} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EarningsCard({ stock }: { stock: ParsedEarning }) {
  const fmtCr = (v: number | null) => v == null ? null : `₹${v.toLocaleString()} Cr`;
  const fmtPx = (v: number | null) => v == null ? null : `₹${v.toFixed(2)}`;
  return (
    <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#E6EDF3', lineHeight: 1.2 }}>{stock.company}</div>
          <div style={{ marginTop: 2, fontSize: 10.5, color: '#6B7A8D', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {stock.ticker}{stock.quarter ? ` · ${stock.quarter}` : ''}{stock.sector ? ` · ${stock.sector}` : ''}{stock.market_cap_bucket && stock.market_cap_bucket !== 'UNKNOWN' ? ` · ${stock.market_cap_bucket}` : ''}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <MetricTile label="SALES YOY" pct={stock.sales_yoy_pct} curr={fmtCr(stock.sales_curr_cr)} prev={fmtCr(stock.sales_prev_cr)} />
        <MetricTile label="NET PROFIT" pct={stock.net_profit_yoy_pct} curr={fmtCr(stock.pat_curr_cr)} prev={fmtCr(stock.pat_prev_cr)} />
        <MetricTile label="EPS YOY" pct={stock.eps_yoy_pct} curr={fmtPx(stock.eps_curr)} prev={fmtPx(stock.eps_prev)} />
        <div style={{ padding: '8px 10px', backgroundColor: '#0D1623', borderRadius: 6, border: '1px solid #1A2840' }}>
          <div style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.6px' }}>SCORE</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: TIER_META[stock.tier].color, marginTop: 2 }}>{stock.composite_score}</div>
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 11.5, color: '#C9D4E0', lineHeight: 1.6, fontStyle: 'italic', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: 6, padding: '8px 10px' }}>
        {stock.narrative}
      </div>

      {(stock.methodology_tags.length > 0 || stock.caveat_tags.length > 0) && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {stock.methodology_tags.map((t) => (
            <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, backgroundColor: '#10B98115', color: '#10B981', border: '1px solid #10B98140', fontWeight: 700 }}>✓ {t}</span>
          ))}
          {stock.caveat_tags.map((t) => (
            <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, backgroundColor: '#F59E0B15', color: '#F59E0B', border: '1px solid #F59E0B40', fontWeight: 700 }}>⚠ {t}</span>
          ))}
        </div>
      )}

      {stock.filing_url && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #1A2840' }}>
          <a href={stock.filing_url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 10.5, color: '#22D3EE', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ExternalLink style={{ width: 10, height: 10 }} /> {stock.source}
          </a>
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, pct, curr, prev }: { label: string; pct: number | null; curr: string | null; prev: string | null }) {
  const color = pct == null ? '#6B7A8D' : pct >= 0 ? '#10B981' : '#EF4444';
  const pctLabel = pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
  return (
    <div style={{ padding: '8px 10px', backgroundColor: '#0D1623', borderRadius: 6, border: '1px solid #1A2840' }}>
      <div style={{ fontSize: 9.5, color: '#6B7A8D', fontWeight: 700, letterSpacing: '0.6px' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color, marginTop: 2, lineHeight: 1 }}>{pctLabel}</div>
      {(curr || prev) && (
        <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {curr || '—'}{prev && ` vs ${prev}`}
        </div>
      )}
    </div>
  );
}
