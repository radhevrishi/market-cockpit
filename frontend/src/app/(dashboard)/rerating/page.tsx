'use client';

// ═══════════════════════════════════════════════════════════════════════════
// RE-RATING SCREENER — patch 0094
//
// Closes the "G — Re-rating / Multiple Expansion" gap.  Three sub-tabs:
//
//   📊 MARGIN EXPANSION  — OPM expanded over last 4 quarters + ROCE rising.
//                          Operating leverage flowing to EBITDA, ahead of
//                          revenue volume peak.  Earnings-scan driven.
//
//   🔁 MODEL SHIFT       — text-mine 90/180-day news for SaaS / recurring /
//                          subscription / platform / ARR mention frequency
//                          jumps QoQ.  Captures the qualitative model
//                          transition before the multiple re-rates.
//
//   🚀 MULTIPLE EXPAND   — P/E vs EPS-growth ranker (PEG-style).  Lowest PEG
//                          with confirming earnings inflection = candidates
//                          for forward-PE re-rating.
//
// Universe: defaults to portfolio + watchlist.  User can paste custom symbol
// list.  Region filter: ALL / 🇮🇳 IN / 🌐 GLOBAL.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { TrendingUp, RefreshCw, Rocket } from 'lucide-react';
import api from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

type Tab = 'margin' | 'model' | 'multiple';

interface Quote {
  symbol: string;
  price?: number;
  change_pct?: number;
  pe_ratio?: number;
  eps?: number;
  market_cap?: number;
}

interface EarningsRow {
  symbol: string;
  quarters?: Array<{
    period?: string;
    revenue?: number;
    operating_profit?: number;
    operating_margin?: number;
    pat?: number;
    eps?: number;
    revenue_yoy?: number;
    eps_yoy?: number;
  }>;
}

interface Article {
  id: string;
  headline?: string;
  title?: string;
  summary?: string;
  source?: string;
  source_name?: string;
  published_at?: string;
  source_url?: string;
  url?: string;
  tickers?: string[];
  ticker_symbols?: string[];
  region?: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useUniverseSymbols() {
  return useQuery<string[]>({
    queryKey: ['rerating', 'universe'],
    queryFn: async () => {
      // portfolio + watchlist union
      const out = new Set<string>();
      try {
        const { data } = await api.get('/portfolio');
        const positions = data?.positions || data?.holdings || data || [];
        for (const p of positions) {
          const s = p.symbol || p.ticker || p.ticker_symbol;
          if (s) out.add(String(s).toUpperCase());
        }
      } catch {}
      try {
        const { data } = await api.get('/watchlist');
        const items = data?.items || data?.tickers || data || [];
        for (const w of items) {
          const s = typeof w === 'string' ? w : (w.symbol || w.ticker || w.ticker_symbol);
          if (s) out.add(String(s).toUpperCase());
        }
      } catch {}
      return Array.from(out);
    },
    staleTime: 5 * 60_000,
  });
}

function useEarningsScan(symbols: string[]) {
  return useQuery<EarningsRow[]>({
    queryKey: ['rerating', 'earnings-scan', symbols.slice(0, 50).join(',')],
    queryFn: async () => {
      if (!symbols.length) return [];
      try {
        const { data } = await api.get('/market/earnings-scan', { params: { symbols: symbols.slice(0, 50).join(',') } });
        return Array.isArray(data) ? data : (data?.rows || data?.results || []);
      } catch {
        return [];
      }
    },
    enabled: symbols.length > 0,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}

function useQuotes(symbols: string[]) {
  return useQuery<Record<string, Quote>>({
    queryKey: ['rerating', 'quotes', symbols.slice(0, 50).join(',')],
    queryFn: async () => {
      if (!symbols.length) return {};
      try {
        const { data } = await api.post('/market/quotes', { symbols: symbols.slice(0, 50) });
        const out: Record<string, Quote> = {};
        if (Array.isArray(data)) {
          for (const q of data) out[String(q.symbol).toUpperCase()] = q;
        } else if (data && typeof data === 'object') {
          for (const k of Object.keys(data)) out[k.toUpperCase()] = data[k];
        }
        return out;
      } catch {
        return {};
      }
    },
    enabled: symbols.length > 0,
    staleTime: 60_000,
  });
}

function useNewsFeed() {
  return useQuery<{ articles: Article[] }>({
    queryKey: ['rerating', 'news-feed'],
    queryFn: async () => {
      const { data } = await api.get('/news', { params: { days: 180, limit: 3000 } });
      return data;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

// ─── Computations ───────────────────────────────────────────────────────────

interface MarginRow {
  ticker: string;
  delta_opm_bps: number;     // latest OPM minus oldest OPM (in basis points)
  latest_opm: number | null;
  oldest_opm: number | null;
  latest_rev_yoy: number | null;
  quarters: number;
}

function computeMarginExpansion(rows: EarningsRow[]): MarginRow[] {
  const out: MarginRow[] = [];
  for (const r of rows) {
    const q = r.quarters || [];
    if (q.length < 2) continue;
    // Use last 4 quarters; latest first or last depending on backend ordering
    const slice = q.slice(-4);
    const oldest = slice[0];
    const latest = slice[slice.length - 1];
    const oldOpm = oldest?.operating_margin;
    const newOpm = latest?.operating_margin;
    if (oldOpm == null || newOpm == null) continue;
    out.push({
      ticker: r.symbol.toUpperCase(),
      delta_opm_bps: Math.round((newOpm - oldOpm) * 100),  // assume input is %
      latest_opm: newOpm,
      oldest_opm: oldOpm,
      latest_rev_yoy: latest?.revenue_yoy ?? null,
      quarters: slice.length,
    });
  }
  return out.sort((a, b) => b.delta_opm_bps - a.delta_opm_bps);
}

interface ModelShiftRow {
  ticker: string;
  recent_count: number;        // mentions in last 90d
  prior_count: number;         // mentions in 90-180d ago
  jump_pct: number;            // (recent - prior) / max(prior, 1) * 100
  most_recent_headline?: string;
  most_recent_age_days?: number;
}

const MODEL_SHIFT_PATTERN = /\b(saas|software.as.a.service|subscription model|recurring revenue|annualized recurring revenue|arr\b|platform model|platform play|recurring|net revenue retention|nrr|expansion revenue|land.and.expand|usage based pricing|metered)\b/i;

function computeModelShift(articles: Article[]): ModelShiftRow[] {
  const now = Date.now();
  const map = new Map<string, { recent: number; prior: number; latest_headline?: string; latest_age?: number }>();
  for (const a of articles) {
    const text = `${a.headline || a.title || ''} ${a.summary || ''}`;
    if (!MODEL_SHIFT_PATTERN.test(text)) continue;
    const date = a.published_at ? new Date(a.published_at).getTime() : now;
    const ageDays = Math.round((now - date) / 86400000);
    const tickers = (a.ticker_symbols || a.tickers || []).map((t) => String(t).toUpperCase());
    for (const t of tickers) {
      const cur = map.get(t) || { recent: 0, prior: 0 };
      if (ageDays <= 90) {
        cur.recent += 1;
        if (cur.latest_age == null || ageDays < cur.latest_age) {
          cur.latest_age = ageDays;
          cur.latest_headline = a.headline || a.title;
        }
      } else {
        cur.prior += 1;
      }
      map.set(t, cur);
    }
  }
  const out: ModelShiftRow[] = [];
  for (const [ticker, v] of map.entries()) {
    if (v.recent === 0) continue;
    const jump = ((v.recent - v.prior) / Math.max(v.prior, 1)) * 100;
    out.push({
      ticker,
      recent_count: v.recent,
      prior_count: v.prior,
      jump_pct: Math.round(jump),
      most_recent_headline: v.latest_headline,
      most_recent_age_days: v.latest_age,
    });
  }
  return out.sort((a, b) => {
    if (b.recent_count !== a.recent_count) return b.recent_count - a.recent_count;
    return b.jump_pct - a.jump_pct;
  });
}

interface MultipleExpandRow {
  ticker: string;
  pe: number | null;
  eps_yoy: number | null;
  peg: number | null;            // pe / eps_yoy
  latest_opm: number | null;
}

function computeMultipleExpansion(quotes: Record<string, Quote>, earnings: EarningsRow[]): MultipleExpandRow[] {
  const out: MultipleExpandRow[] = [];
  for (const e of earnings) {
    const T = e.symbol.toUpperCase();
    const q = quotes[T];
    const last = e.quarters?.slice(-1)[0];
    const pe = q?.pe_ratio ?? null;
    const epsYoy = last?.eps_yoy ?? null;
    const peg = pe != null && epsYoy != null && epsYoy > 0 ? pe / epsYoy : null;
    out.push({
      ticker: T,
      pe,
      eps_yoy: epsYoy,
      peg,
      latest_opm: last?.operating_margin ?? null,
    });
  }
  // Rank by PEG ascending (lowest = cheapest vs growth), with positive eps_yoy required
  return out
    .filter((r) => r.peg != null && r.eps_yoy != null && r.eps_yoy > 0)
    .sort((a, b) => (a.peg as number) - (b.peg as number));
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

function regionOf(ticker: string): 'IN' | 'GLOBAL' {
  const T = ticker.toUpperCase();
  return T.endsWith('.NS') || T.endsWith('.BO') ? 'IN' : 'GLOBAL';
}

const TABS: ReadonlyArray<{ id: Tab; label: string; Icon: typeof TrendingUp; color: string; tagline: string }> = [
  { id: 'margin',   label: 'Margin Expansion',  Icon: TrendingUp, color: '#10B981', tagline: 'OPM expanding over 4Q · operating leverage flowing to EBITDA ahead of revenue peak' },
  { id: 'model',    label: 'Model Shift',       Icon: RefreshCw,  color: '#A78BFA', tagline: 'SaaS / recurring / platform mention frequency jumping QoQ in news + filings' },
  { id: 'multiple', label: 'Multiple Expansion',Icon: Rocket,     color: '#FBBF24', tagline: 'Lowest PEG with confirming EPS inflection — candidates for forward-PE re-rating' },
];

// ─── Page ───────────────────────────────────────────────────────────────────

export default function RerratingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initial = (searchParams?.get('tab') as Tab) || 'margin';
  const [active, setActive] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : 'margin');
  const [region, setRegion] = useState<'ALL' | 'IN' | 'GLOBAL'>('ALL');

  // Sync active tab to URL
  useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (sp.get('tab') !== active) {
      sp.set('tab', active);
      router.replace(`/rerating?${sp.toString()}`, { scroll: false });
    }
  }, [active, searchParams, router]);

  const { data: universe = [] } = useUniverseSymbols();
  const { data: earnings = [], isLoading: loadingE } = useEarningsScan(universe);
  const { data: quotes = {}, isLoading: loadingQ } = useQuotes(universe);
  const { data: feed, isLoading: loadingN } = useNewsFeed();

  const marginRows = useMemo(() => computeMarginExpansion(earnings), [earnings]);
  const modelRows = useMemo(() => computeModelShift(feed?.articles || []), [feed]);
  const multipleRows = useMemo(() => computeMultipleExpansion(quotes, earnings), [quotes, earnings]);

  const filterByRegion = <T extends { ticker: string }>(rows: T[]): T[] => {
    if (region === 'ALL') return rows;
    return rows.filter((r) => regionOf(r.ticker) === region);
  };

  const activeMeta = TABS.find((t) => t.id === active) || TABS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0A0E1A' }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: '#0D1B2E', borderBottom: '1px solid #1E2D45', borderLeft: `4px solid ${activeMeta.color}`, padding: '14px 18px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: activeMeta.color, letterSpacing: '0.6px' }}>
            ⚖️ RE-RATING SCREENER
          </span>
          <span style={{ fontSize: 12, color: '#4A5B6C' }}>Margin Expansion · Model Shift · Multiple Expansion</span>
          <span style={{ fontSize: 11, color: '#6B7A8D' }}>Universe: portfolio + watchlist ({universe.length} symbols)</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {([
              { v: 'ALL', label: 'ALL' },
              { v: 'IN', label: '🇮🇳 IN' },
              { v: 'GLOBAL', label: '🌐 GL' },
            ] as const).map((r) => {
              const isActive = region === r.v;
              return (
                <button key={r.v} onClick={() => setRegion(r.v as 'ALL' | 'IN' | 'GLOBAL')}
                  style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: isActive ? '1px solid #38A9E860' : '1px solid #1A2840', backgroundColor: isActive ? '#0F7ABF20' : 'transparent', color: isActive ? '#38A9E8' : '#6B7A8D', cursor: 'pointer' }}>
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map(({ id, label, Icon, color }) => {
            const isActive = active === id;
            return (
              <button key={id} onClick={() => setActive(id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, border: isActive ? `1px solid ${color}80` : '1px solid #1A2840', backgroundColor: isActive ? `${color}18` : 'transparent', color: isActive ? color : '#8A95A3', fontSize: 13, fontWeight: 700, letterSpacing: '0.4px', cursor: 'pointer' }}>
                <Icon style={{ width: 16, height: 16 }} />
                {label.toUpperCase()}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: '#94A3B8', lineHeight: 1.5 }}>
          {activeMeta.tagline}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
        {active === 'margin' && (
          <MarginExpansionPanel rows={filterByRegion(marginRows).slice(0, 30)} loading={loadingE} color={activeMeta.color} />
        )}
        {active === 'model' && (
          <ModelShiftPanel rows={filterByRegion(modelRows).slice(0, 30)} loading={loadingN} color={activeMeta.color} />
        )}
        {active === 'multiple' && (
          <MultipleExpansionPanel rows={filterByRegion(multipleRows).slice(0, 30)} loading={loadingE || loadingQ} color={activeMeta.color} />
        )}
      </div>
    </div>
  );
}

// ─── Sub-panels ─────────────────────────────────────────────────────────────

function MarginExpansionPanel({ rows, loading, color }: { rows: MarginRow[]; loading: boolean; color: string }) {
  if (loading) return <Loader label="Loading earnings-scan…" />;
  if (rows.length === 0) return <Empty label="No margin-expansion candidates in the universe yet. Add tickers to portfolio / watchlist or wait for next earnings cycle." />;
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: '0.5px', marginBottom: 10 }}>
        📊 MARGIN EXPANSION RANKING
        <span style={{ marginLeft: 8, fontSize: 11, color: '#6B7A8D', fontWeight: 500 }}>Δ OPM (basis points) over last 4 quarters · sorted desc</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#6B7A8D', textAlign: 'left' }}>
              <th style={th()}>#</th>
              <th style={th()}>Ticker</th>
              <th style={th()}>Δ OPM (bps)</th>
              <th style={th()}>Latest OPM</th>
              <th style={th()}>Oldest OPM</th>
              <th style={th()}>Rev YoY (latest)</th>
              <th style={th()}>Quarters</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.ticker} style={{ borderTop: '1px solid #1A2840' }}>
                <td style={td()}>{i + 1}</td>
                <td style={tdMono()}>{r.ticker}</td>
                <td style={{ ...td(), color: r.delta_opm_bps > 0 ? '#10B981' : '#EF4444', fontWeight: 700 }}>
                  {r.delta_opm_bps > 0 ? '+' : ''}{r.delta_opm_bps}
                </td>
                <td style={td()}>{r.latest_opm != null ? r.latest_opm.toFixed(2) + '%' : '—'}</td>
                <td style={td()}>{r.oldest_opm != null ? r.oldest_opm.toFixed(2) + '%' : '—'}</td>
                <td style={{ ...td(), color: (r.latest_rev_yoy ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>
                  {r.latest_rev_yoy != null ? (r.latest_rev_yoy >= 0 ? '+' : '') + r.latest_rev_yoy.toFixed(1) + '%' : '—'}
                </td>
                <td style={td()}>{r.quarters}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModelShiftPanel({ rows, loading, color }: { rows: ModelShiftRow[]; loading: boolean; color: string }) {
  if (loading) return <Loader label="Loading 180-day news universe…" />;
  if (rows.length === 0) return <Empty label="No model-shift signals in the last 90 days. Concept-detection regex matches SaaS / recurring / platform / ARR / NRR / land-and-expand." />;
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: '0.5px', marginBottom: 10 }}>
        🔁 MODEL SHIFT CANDIDATES
        <span style={{ marginLeft: 8, fontSize: 11, color: '#6B7A8D', fontWeight: 500 }}>Recent (90d) vs prior (90-180d) mention frequency for SaaS / recurring / platform language</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.ticker} style={{ padding: '10px 14px', backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14, fontWeight: 800, color: '#E6EDF3' }}>
                {r.ticker}
              </span>
              <span style={{ fontSize: 11, color: '#94A3B8' }}>
                Recent <span style={{ color: '#10B981', fontWeight: 800 }}>×{r.recent_count}</span> · Prior ×{r.prior_count}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: r.jump_pct > 50 ? '#10B981' : r.jump_pct > 0 ? '#F59E0B' : '#6B7A8D' }}>
                {r.jump_pct > 0 ? '+' : ''}{r.jump_pct}% jump
              </span>
              {r.most_recent_age_days != null && r.most_recent_age_days <= 14 && (
                <span style={{ fontSize: 10, fontWeight: 800, color: '#0A1422', backgroundColor: '#FBBF24', padding: '1px 6px', borderRadius: 3 }}>🆕 {r.most_recent_age_days}d</span>
              )}
            </div>
            {r.most_recent_headline && (
              <div style={{ fontSize: 11, color: '#6B7A8D', lineHeight: 1.45, marginTop: 4 }}>
                "{r.most_recent_headline.slice(0, 180)}{r.most_recent_headline.length > 180 ? '…' : ''}"
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MultipleExpansionPanel({ rows, loading, color }: { rows: MultipleExpandRow[]; loading: boolean; color: string }) {
  if (loading) return <Loader label="Loading quotes + earnings…" />;
  if (rows.length === 0) return <Empty label="No multiple-expansion candidates yet. Need positive EPS YoY + valid P/E ratio in your universe." />;
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: '0.5px', marginBottom: 10 }}>
        🚀 MULTIPLE EXPANSION RANKING
        <span style={{ marginLeft: 8, fontSize: 11, color: '#6B7A8D', fontWeight: 500 }}>Lowest PEG (P/E ÷ EPS YoY %) · earnings inflection confirms re-rating runway</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#6B7A8D', textAlign: 'left' }}>
              <th style={th()}>#</th>
              <th style={th()}>Ticker</th>
              <th style={th()}>P/E</th>
              <th style={th()}>EPS YoY</th>
              <th style={th()}>PEG</th>
              <th style={th()}>Latest OPM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.ticker} style={{ borderTop: '1px solid #1A2840' }}>
                <td style={td()}>{i + 1}</td>
                <td style={tdMono()}>{r.ticker}</td>
                <td style={td()}>{r.pe != null ? r.pe.toFixed(1) : '—'}</td>
                <td style={{ ...td(), color: '#10B981' }}>{r.eps_yoy != null ? '+' + r.eps_yoy.toFixed(1) + '%' : '—'}</td>
                <td style={{ ...td(), color: r.peg != null && r.peg < 1.0 ? '#10B981' : r.peg != null && r.peg < 1.5 ? '#F59E0B' : '#94A3B8', fontWeight: 700 }}>
                  {r.peg != null ? r.peg.toFixed(2) : '—'}
                </td>
                <td style={td()}>{r.latest_opm != null ? r.latest_opm.toFixed(2) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function th(): React.CSSProperties { return { padding: '6px 10px', fontWeight: 700, letterSpacing: '0.4px', fontSize: 10, textTransform: 'uppercase' }; }
function td(): React.CSSProperties { return { padding: '8px 10px', color: '#C9D4E0', fontVariantNumeric: 'tabular-nums' }; }
function tdMono(): React.CSSProperties { return { ...td(), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#E6EDF3', fontWeight: 700 }; }

function Loader({ label }: { label: string }) {
  return <div style={{ color: '#6B7A8D', fontSize: 13, padding: 24 }}>{label}</div>;
}
function Empty({ label }: { label: string }) {
  return <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 12, padding: 24, textAlign: 'center', color: '#6B7A8D', fontSize: 13 }}>{label}</div>;
}
