'use client';

// ═══════════════════════════════════════════════════════════════════════════
// MARKET BREADTH INDICATOR (PATCH 0168)
//
// Visualises the composite breadth score and pillar breakdowns from
// /api/v1/breadth.  Updated automatically every 5 minutes by Vercel edge.
// ═══════════════════════════════════════════════════════════════════════════

import { useQuery } from '@tanstack/react-query';
// PATCH 0274 — Surface refresh freshness so the 5-min cron lag is visible.
import { PanelFreshness } from '@/components/PanelFreshness';

interface BreadthPayload {
  composite: number;
  regime: string;
  regime_color: string;
  regime_desc: string;
  suggested_cash_pct: number;
  pillars: {
    trend:    { score: number; weight: number; pct50: number; pct200: number; newHigh: number; newLow: number; hlSpread: number; proxy?: boolean; proxyNote?: string };
    sector:   { score: number; weight: number; above: number; total: number; topSectors?: any[]; bottomSectors?: any[] };
    smallcap: { score: number; weight: number; smPct?: number; lgPct?: number; smCount?: number; lgCount?: number };
    flow:     { score: number; weight: number; lcAbove?: number; lcTotal?: number; proxy?: boolean; proxyNote?: string };
    momentum: { score: number; weight: number; makingHigherHighs?: number; aligned?: number; total: number };
  };
  universe_size: number;
  scope?: 'broad' | 'basket';                          // PATCH 0807
  scope_label?: string;
  source?: string;
  cohort_date?: string;
  ms: number;
  generated_at: string;
}

export default function BreadthPage() {
  const { data, isLoading, isFetching, dataUpdatedAt, error, refetch } = useQuery<BreadthPayload>({
    queryKey: ['market-breadth'],
    queryFn: async () => {
      // PATCH 0966 — Pattern C: add 20s AbortSignal timeout. The breadth
      // endpoint can hang behind a cold backend; the loading state was
      // tied to react-query's isLoading with no upstream timeout, so the
      // spinner stayed up indefinitely waiting on the socket.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20_000);
      try {
        const r = await fetch('/api/v1/breadth', { signal: ctl.signal });
        if (!r.ok) throw new Error('breadth fetch failed');
        return await r.json();
      } finally {
        clearTimeout(timer);
      }
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  // PATCH 0460 — explicit error state with Retry. Previously the page hung on
  // the loading spinner forever when /api/v1/breadth was down.
  if (error && !data) {
    return (
      <div style={{ padding: 40, color: 'var(--mc-text-3)', fontSize: 13, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⚠</div>
        <div style={{ color: 'var(--mc-text-1)', fontWeight: 700, marginBottom: 6 }}>Market Breadth unavailable</div>
        <div style={{ marginBottom: 14 }}>{(error as any)?.message || 'Upstream feed returned an error.'}</div>
        <button
          onClick={() => refetch()}
          style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid var(--mc-bg-4)',
            background: 'var(--mc-accent)', color: '#fff', fontWeight: 700, cursor: 'pointer',
          }}
        >Retry</button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div style={{ padding: 40, color: 'var(--mc-text-3)', fontSize: 13, textAlign: 'center' }}>
        Loading market breadth…
      </div>
    );
  }

  // PATCH 0763 — IMP10. 30-day historical sparkline of the composite score.
  // Appends today's value on each load (deduped by IST date) and renders an
  // inline SVG trend. localStorage-only so no backend dependency.
  if (typeof window !== 'undefined' && data?.composite !== undefined) {
    try {
      const STORE = 'mc:breadth-history:v1';
      const ist = new Date();
      const istIso = new Date(ist.getTime() + (ist.getTimezoneOffset() + 330) * 60_000).toISOString().slice(0, 10);
      const raw = localStorage.getItem(STORE);
      const arr: Array<{ d: string; v: number }> = raw ? JSON.parse(raw) : [];
      if (arr.length === 0 || arr[arr.length - 1].d !== istIso) {
        arr.push({ d: istIso, v: data.composite });
        if (arr.length > 30) arr.shift();
        localStorage.setItem(STORE, JSON.stringify(arr));
      } else if (arr[arr.length - 1].v !== data.composite) {
        // Same day, different value — refresh last entry
        arr[arr.length - 1] = { d: istIso, v: data.composite };
        localStorage.setItem(STORE, JSON.stringify(arr));
      }
    } catch { /* silent */ }
  }

  /*
   * PATCH 0965 BUG #4 — Breadth: "undefined/2362 making higher highs"
   * --------------------------------------------------------------
   * ROOT CAUSE: The /api/v1/breadth route has TWO code paths with
   * DIFFERENT field shapes for the momentum pillar:
   *   - Broad-universe (BHAVCOPY-backed, ~2369 tickers) returns
   *       { score, weight, aligned, total }     ← NO makingHigherHighs
   *   - Basket fallback (25-symbol Yahoo) returns
   *       { score, weight, makingHigherHighs, total }
   * The page only read `makingHigherHighs`, so on the broad path
   * the numerator rendered as the JS string "undefined".
   *
   * FIX: Defensive numeric guards on EVERY field we render. Each
   * pillar field falls back through known aliases, then to a safe
   * placeholder ('—') when truly missing, so we never emit the
   * literal word "undefined" again.
   *
   * Fields guarded:
   *   trend.pct50, trend.pct200, trend.newHigh, trend.newLow
   *   sector.above, sector.total
   *   momentum.makingHigherHighs (fallback to aligned), momentum.total
   *   pillars.*.score (already numeric from API; coerced via ?? 0)
   */
  const fmt = (v: any): string => (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) ? '—' : String(v);

  const t = data.pillars.trend || ({} as any);
  const s = data.pillars.sector || ({} as any);
  const sc = data.pillars.smallcap || ({} as any);
  const fl = data.pillars.flow || ({} as any);
  const m: any = data.pillars.momentum || {};

  // PATCH 0965 BUG #4 — fall through aliases for the momentum numerator.
  const momNumerator = m.makingHigherHighs ?? m.higherHighs ?? m.higher_highs ?? m.momentum_count ?? m.aligned;
  const momDenominator = m.total;

  const pillars = [
    { name: 'Trend Breadth',    weight: 35, score: t.score ?? 0,    sub: `% >50DMA ${fmt(t.pct50)}% · % >200DMA ${fmt(t.pct200)}% · ${fmt(t.newHigh)} new highs / ${fmt(t.newLow)} new lows` },
    { name: 'Sector Breadth',   weight: 25, score: s.score ?? 0,    sub: `${fmt(s.above)}/${fmt(s.total)} sectors above 50DMA` },
    { name: 'Smallcap Particip.', weight: 20, score: sc.score ?? 0, sub: 'SMID vs Nifty 1m + smallcap above 200DMA' },
    // AUDIT_100 #82 — flag the single-proxy fragility of the flow pillar.
    // The proxy is PSU Bank 1m vs Nifty 1m; not a real DII flow feed.
    { name: 'Institutional Flow', weight: 10, score: fl.score ?? 0, sub: 'PSU Bank vs Nifty 1m (proxy for DII) · ⚠ LOW CONFIDENCE — single proxy' },
    { name: 'Momentum Breadth',   weight: 10, score: m.score ?? 0,  sub: `${fmt(momNumerator)}/${fmt(momDenominator)} making higher highs` },
  ];

  return (
    <div style={{ padding: '20px 24px', backgroundColor: 'var(--mc-bg-0)', minHeight: '100%', color: 'var(--mc-text-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>📊 Market Breadth Indicator</h1>
        {/* PATCH 0274 — Freshness chip; turns amber when the 5-min cron lags. */}
        <PanelFreshness dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} staleAfterMs={10 * 60_000} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--mc-text-3)', margin: 0, marginBottom: 18 }}>
        Composite of 5 breadth pillars · Updates every 5 min · Modify stock scores by regime
      </p>

      {/* ── Headline composite + regime ──────────────────────────────── */}
      <div style={{
        backgroundColor: 'var(--mc-bg-1)',
        border: `1px solid ${data.regime_color}40`,
        borderLeft: `4px solid ${data.regime_color}`,
        borderRadius: 12, padding: '18px 22px',
        marginBottom: 14,
        display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.6px' }}>COMPOSITE SCORE</div>
          <div style={{ fontSize: 56, fontWeight: 900, color: data.regime_color, lineHeight: 1 }}>
            {data.composite}<span style={{ fontSize: 18, color: 'var(--mc-text-3)', fontWeight: 600 }}>/100</span>
          </div>
          {/* PATCH 0763 — IMP10 sparkline. Reads from mc:breadth-history:v1
              localStorage and draws a 30-day trend. Lets the user see if
              breadth is improving or deteriorating. */}
          {typeof window !== 'undefined' && (() => {
            try {
              const raw = localStorage.getItem('mc:breadth-history:v1');
              const arr: Array<{ d: string; v: number }> = raw ? JSON.parse(raw) : [];
              if (arr.length < 2) return null;
              const w = 120, h = 28;
              const min = Math.min(...arr.map(x => x.v));
              const max = Math.max(...arr.map(x => x.v));
              const range = Math.max(1, max - min);
              const pts = arr.map((p, i) => {
                const x = (i / (arr.length - 1)) * w;
                const y = h - ((p.v - min) / range) * (h - 4) - 2;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');
              const first = arr[0].v;
              const last = arr[arr.length - 1].v;
              const delta = last - first;
              const trendColor = delta > 0 ? '#10B981' : delta < 0 ? '#EF4444' : '#6B7A8D';
              return (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width={w} height={h} style={{ overflow: 'visible' }}>
                    <polyline points={pts} fill="none" stroke={trendColor} strokeWidth={1.6} />
                  </svg>
                  <span style={{ fontSize: 10, color: trendColor, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                    {delta >= 0 ? '+' : ''}{delta} · {arr.length}d
                  </span>
                </div>
              );
            } catch { return null; }
          })()}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          {/* AUDIT_100 #29 — regime label deeplinks to news search so users can
              immediately see "why" the regime is what it is. */}
          <a
            href={`/news?search=${encodeURIComponent('breadth ' + (data.regime || ''))}`}
            title="See related news"
            style={{ fontSize: 20, fontWeight: 800, color: data.regime_color, marginBottom: 6, textDecoration: 'none', display: 'inline-block' }}
          >
            {data.regime} <span style={{ fontSize: 12, opacity: 0.5 }}>→</span>
          </a>
          <div style={{ fontSize: 13, color: '#C9D4E0', marginBottom: 8, marginTop: 6 }}>{data.regime_desc}</div>
          <div style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>
            Suggested cash allocation: <strong style={{ color: 'var(--mc-text-1)' }}>{data.suggested_cash_pct}%</strong>
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)', textAlign: 'right' }}>
          {/* AUDIT_100 #19 — guard against missing/malformed generated_at so
              the cell doesn't render "Invalid Date" for a partial payload. */}
          Updated {(() => {
            try {
              const d = new Date(data.generated_at);
              return Number.isFinite(d.getTime()) ? d.toLocaleString('en-IN') : '—';
            } catch { return '—'; }
          })()}<br />
          {/* PATCH 0807 — broad-universe scope label. The breadth engine now
              reads nse-ticker-universe + nse-rolling-stats blobs populated by
              the GH Actions BHAVCOPY scraper. Falls back to a 25-symbol Yahoo
              basket when the blobs are missing or stale. */}
          <span title={data.source ? `Source: ${data.source}` : ''}>
            {data.scope_label || `Universe · ${data.universe_size} symbols`} · data: NSE EOD
          </span>
          <div style={{ fontSize: 9, color: 'var(--mc-text-4)', marginTop: 4, fontStyle: 'italic' }}>
            {data.scope === 'broad'
              ? <>scope: full NSE universe · for per-stock detail see <a href="/movers" style={{ color: 'var(--mc-cyan)', textDecoration: 'underline' }}>/movers</a></>
              : <>scope: curated 25-symbol basket (fallback) · for per-stock detail see <a href="/movers" style={{ color: 'var(--mc-cyan)', textDecoration: 'underline' }}>/movers</a></>}
          </div>
        </div>
      </div>

      {/* ── Pillar breakdown ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {pillars.map((p) => {
          const color = p.score >= 70 ? '#10B981' : p.score >= 50 ? '#FBBF24' : p.score >= 30 ? '#F59E0B' : '#EF4444';
          return (
            <div key={p.name} style={{
              backgroundColor: '#0A1422',
              border: `1px solid ${color}30`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 8, padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-text-1)' }}>{p.name}</span>
                <span style={{ fontSize: 10, color: 'var(--mc-text-4)' }}>weight {p.weight}%</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color, lineHeight: 1 }}>{p.score}<span style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>/100</span></div>
              <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginTop: 6, lineHeight: 1.4 }}>{p.sub}</div>
              <div style={{ height: 4, backgroundColor: 'var(--mc-bg-4)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${p.score}%`, backgroundColor: color, transition: 'width 0.4s' }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Score-modifier guide ────────────────────────────────────── */}
      <div style={{ marginTop: 18, backgroundColor: '#0A1422', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: '12px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px', marginBottom: 8 }}>HOW BREADTH MODIFIES STOCK SCORES</div>
        <div style={{ fontSize: 11.5, color: '#C9D4E0', lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 4px' }}><strong style={{ color: 'var(--mc-bullish)' }}>80+ Expansion:</strong> aggressively reward acceleration (Earnings Ops boosts magnitude weight, Re-rating loosens trend bar).</p>
          <p style={{ margin: '0 0 4px' }}><strong style={{ color: 'var(--mc-cyan)' }}>60-79 Healthy Bull:</strong> normal scoring; methodology pills weighted as default.</p>
          <p style={{ margin: '0 0 4px' }}><strong style={{ color: 'var(--mc-warn)' }}>40-59 Transitional:</strong> penalize weak balance sheets (FCF, debt, OCF/PAT) more heavily; demote low-quality earnings.</p>
          <p style={{ margin: 0 }}><strong style={{ color: 'var(--mc-bearish)' }}>&lt;40 Risk-Off:</strong> only quality / FCF / cash-flow leaders survive; methodology pills require all-pass for BLOCKBUSTER.</p>
        </div>
      </div>
    </div>
  );
}
