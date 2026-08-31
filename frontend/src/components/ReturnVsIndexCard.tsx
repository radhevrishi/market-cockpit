'use client';

// ════════════════════════════════════════════════════════════════════════════
// ReturnVsIndexCard.tsx
// Self-contained "Return vs Benchmark" card for the trading terminal.
//
// Computes the portfolio's value-weighted since-inception simple return from
// the canonical `mc_portfolio_holdings` store + live quotes, and compares it
// against the closest available benchmark window from /api/market/indices.
//
// IMPORTANT data note on the benchmark feed:
//   GET /api/market/indices returns a BARE ARRAY of
//     { symbol, price, change_pct, change }
//   with symbols 'NIFTY 50' | 'SENSEX' | 'BANK NIFTY' | 'USD/INR'.
//   The ONLY return field is `change_pct`, which is a 1-DAY index move — there
//   are no pct1M / pct1Y / ret1y fields, and there is NO S&P 500 / US row.
//   So the India benchmark is honestly labelled "Nifty 1D" (window != holding
//   age), and the US benchmark is reported as unavailable rather than faked.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';

const C = {
  bg1: 'var(--mc-bg-1)',
  bg2: 'var(--mc-bg-2)',
  bg3: 'var(--mc-bg-3)',
  text1: 'var(--mc-text-1)',
  text2: 'var(--mc-text-2)',
  text3: 'var(--mc-text-3)',
  text4: 'var(--mc-text-4)',
  border1: 'var(--mc-border-1)',
  border2: 'var(--mc-border-2)',
  green: 'var(--mc-bullish)',
  red: 'var(--mc-bearish)',
  amber: 'var(--mc-warn)',
  cyan: 'var(--mc-cyan)',
  accent: 'var(--mc-accent)',
};

const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';

const HOLDINGS_KEY = 'mc_portfolio_holdings';

interface RawHolding {
  symbol: string;
  entryPrice: number;
  quantity: number;
  weight?: number;
  addedAt?: string;
  notes?: string;
  market?: 'IN' | 'US';
}

interface QuoteLite {
  price: number;
  changePercent: number;
  market: 'IN' | 'US';
}

interface IndexRow {
  symbol: string;
  price: number;
  change_pct: number | null;
  change: number | null;
}

interface Computed {
  totalInvested: number;
  currentValue: number;
  portfolioReturnPct: number; // value-weighted, %
  matched: number;
  unmatched: number;
  hasIndian: boolean;
  hasUS: boolean;
}

function normSym(s: string): string {
  return (s || '').toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
}

function fmtINR(n: number): string {
  try {
    return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));
  } catch {
    return '₹' + Math.round(n).toLocaleString();
  }
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(digits) + '%';
}

function toneColor(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return C.text3;
  if (n > 0.0001) return C.green;
  if (n < -0.0001) return C.red;
  return C.text2;
}

export function ReturnVsIndexCard() {
  const [holdings, setHoldings] = useState<RawHolding[] | null>(null);
  const [quotes, setQuotes] = useState<Map<string, QuoteLite>>(new Map());
  const [indices, setIndices] = useState<IndexRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    function readHoldings(): RawHolding[] {
      try {
        const raw = window.localStorage.getItem(HOLDINGS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
          (h) => h && typeof h.symbol === 'string' &&
            Number.isFinite(h.entryPrice) && Number.isFinite(h.quantity)
        );
      } catch {
        return [];
      }
    }

    async function load() {
      const hs = readHoldings();
      if (cancelled) return;
      setHoldings(hs);

      // Fetch live quotes for both markets + benchmark indices in parallel.
      const [indiaRes, usRes, idxRes] = await Promise.allSettled([
        fetch('/api/market/quotes?market=india', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/market/quotes?market=us', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/market/indices', { cache: 'no-store' }).then((r) => r.json()),
      ]);

      if (cancelled) return;

      const qmap = new Map<string, QuoteLite>();
      const ingest = (res: PromiseSettledResult<any>, market: 'IN' | 'US') => {
        if (res.status !== 'fulfilled') return;
        const stocks = res.value?.stocks;
        if (!Array.isArray(stocks)) return;
        for (const s of stocks) {
          if (!s || typeof s.ticker !== 'string') continue;
          const price = Number(s.price);
          if (!Number.isFinite(price) || price <= 0) continue;
          const key = normSym(s.ticker);
          // Don't clobber an existing IN match with a US same-name row.
          if (!qmap.has(key)) {
            qmap.set(key, { price, changePercent: Number(s.changePercent) || 0, market });
          }
        }
      };
      // Ingest India first so it wins on symbol collisions.
      ingest(indiaRes, 'IN');
      ingest(usRes, 'US');
      setQuotes(qmap);

      if (idxRes.status === 'fulfilled') {
        // The route returns a BARE ARRAY; tolerate a wrapped { indices: [] } too.
        const raw = idxRes.value;
        const arr: IndexRow[] = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.indices)
          ? raw.indices
          : [];
        setIndices(arr);
      } else {
        setIndices([]);
      }

      setLoading(false);
    }

    load().catch((e) => {
      if (!cancelled) {
        setErr(String(e));
        setLoading(false);
      }
    });

    // Cross-tab live refresh when the portfolio page edits holdings.
    const onStorage = (e: StorageEvent) => {
      if (e.key === HOLDINGS_KEY) load().catch(() => {});
    };
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // ── Derive figures ────────────────────────────────────────────────────────
  const computed: Computed | null = (() => {
    if (!holdings) return null;
    let totalInvested = 0;
    let currentValue = 0;
    let matched = 0;
    let unmatched = 0;
    let hasIndian = false;
    let hasUS = false;
    // per-name current value + return, for value-weighting.
    const legs: { cv: number; ret: number }[] = [];

    for (const h of holdings) {
      const q = quotes.get(normSym(h.symbol));
      const invested = h.quantity * h.entryPrice;
      if (!q || h.entryPrice <= 0) {
        unmatched += 1;
        continue;
      }
      matched += 1;
      const cv = h.quantity * q.price;
      const ret = q.price / h.entryPrice - 1;
      totalInvested += invested;
      currentValue += cv;
      legs.push({ cv, ret });
      const m = h.market || q.market;
      if (m === 'US') hasUS = true;
      else hasIndian = true;
    }

    const sumCV = legs.reduce((a, l) => a + l.cv, 0);
    const portfolioReturnPct =
      sumCV > 0 ? legs.reduce((a, l) => a + (l.cv / sumCV) * l.ret, 0) * 100 : 0;

    return { totalInvested, currentValue, portfolioReturnPct, matched, unmatched, hasIndian, hasUS };
  })();

  // Benchmark: NIFTY 50 change_pct (1-DAY window). No S&P/US row exists.
  const niftyRow = (indices || []).find((r) => normSym(r.symbol) === 'NIFTY 50' || /nifty\s*50/i.test(r.symbol));
  const niftyPct: number | null =
    niftyRow && niftyRow.change_pct !== null && Number.isFinite(Number(niftyRow.change_pct))
      ? Number(niftyRow.change_pct)
      : null;
  const usBenchmarkAvailable = false; // feed exposes no S&P 500 / US index row.

  // ── Render ─────────────────────────────────────────────────────────────────
  const wrap: React.CSSProperties = {
    background: C.bg1,
    border: '1px solid ' + C.border1,
    borderRadius: 10,
    padding: '14px 16px',
    fontFamily: MONO,
    fontVariantNumeric: 'tabular-nums',
    color: C.text1,
    maxWidth: 640,
  };

  if (loading || !computed) {
    return (
      <div style={wrap}>
        <Header />
        <div style={{ fontSize: 12, color: C.text3, fontStyle: 'italic', marginTop: 10 }}>
          {err ? <span style={{ color: C.red }}>Error: {err}</span> : 'Loading portfolio & benchmark…'}
        </div>
      </div>
    );
  }

  if (computed.matched === 0) {
    const noHoldings = (holdings?.length || 0) === 0;
    return (
      <div style={wrap}>
        <Header />
        <div style={{ fontSize: 12, color: C.text3, marginTop: 10, lineHeight: 1.5 }}>
          {noHoldings
            ? 'No holdings yet. Add positions on the Portfolio page to see your return vs the index.'
            : `No live prices matched your ${holdings?.length} holding(s). Quotes may be unavailable right now — check back when the market feed refreshes.`}
        </div>
      </div>
    );
  }

  const alpha = niftyPct !== null ? computed.portfolioReturnPct - niftyPct : null;

  return (
    <div style={wrap}>
      <Header />

      {/* Tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
          marginTop: 12,
        }}
      >
        {/* Portfolio return */}
        <Tile label="Portfolio return" hint="value-weighted · since inception">
          <span style={{ fontSize: 22, fontWeight: 800, color: toneColor(computed.portfolioReturnPct) }}>
            {fmtPct(computed.portfolioReturnPct)}
          </span>
        </Tile>

        {/* Invested -> Current */}
        <Tile label="Invested → Current" hint={`${computed.matched} priced`}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: C.text2 }}>{fmtINR(computed.totalInvested)}</span>
            <span style={{ fontSize: 12, color: C.text4 }}>→</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: toneColor(computed.currentValue - computed.totalInvested) }}>
              {fmtINR(computed.currentValue)}
            </span>
          </div>
        </Tile>

        {/* Benchmark: Nifty 1D */}
        <Tile
          label="vs Nifty"
          hint="1-day window"
          hidden={!computed.hasIndian}
        >
          {niftyPct !== null ? (
            <span style={{ fontSize: 18, fontWeight: 800, color: toneColor(niftyPct) }}>
              Nifty 1D {fmtPct(niftyPct)}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: C.amber }}>benchmark data unavailable</span>
          )}
        </Tile>

        {/* Alpha */}
        <Tile
          label="Relative (alpha)"
          hint="portfolio − Nifty 1D"
          hidden={!computed.hasIndian}
        >
          {alpha !== null ? (
            <span style={{ fontSize: 20, fontWeight: 800, color: toneColor(alpha) }}>
              {(alpha >= 0 ? '+' : '') + alpha.toFixed(2)} pts
            </span>
          ) : (
            <span style={{ fontSize: 12, color: C.amber }}>n/a</span>
          )}
        </Tile>
      </div>

      {/* One-line read-out */}
      {computed.hasIndian && niftyPct !== null && alpha !== null && (
        <div
          style={{
            marginTop: 12,
            padding: '9px 11px',
            background: C.bg2,
            border: '1px solid ' + C.border1,
            borderRadius: 8,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: C.text1,
          }}
        >
          Your book is{' '}
          <b style={{ color: toneColor(computed.portfolioReturnPct) }}>{fmtPct(computed.portfolioReturnPct)}</b>{' '}
          <span style={{ color: C.text3 }}>(since inception)</span> vs Nifty{' '}
          <b style={{ color: toneColor(niftyPct) }}>{fmtPct(niftyPct)}</b>{' '}
          <span style={{ color: C.text3 }}>(1D)</span> —{' '}
          <b style={{ color: toneColor(alpha) }}>
            {alpha >= 0 ? 'ahead by' : 'behind by'} {Math.abs(alpha).toFixed(1)} pts
          </b>
          .
        </div>
      )}

      {/* US benchmark note */}
      {computed.hasUS && (
        <div style={{ marginTop: 8, fontSize: 11, color: C.amber }}>
          US benchmark data unavailable — the indices feed exposes no S&P 500 row, so no US
          comparison is shown.
        </div>
      )}

      {/* Window-mismatch honesty note */}
      {computed.hasIndian && niftyPct !== null && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: C.text4, lineHeight: 1.5 }}>
          ⚠ Window mismatch: the only index return the feed exposes is a{' '}
          <b>1-day</b> Nifty move, while your return is since inception (holdings ~1 month old).
          The alpha above is not a like-for-like comparison — treat it as directional only.
        </div>
      )}

      {/* Method caption */}
      <div style={{ marginTop: 8, fontSize: 10.5, color: C.text4, lineHeight: 1.5 }}>
        Holdings store a single blended entry price (no lots), so this is a{' '}
        <b>since-inception simple return</b>, not a true XIRR.
        {computed.unmatched > 0 && (
          <> {computed.unmatched} holding(s) had no live price and are excluded.</>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0.4,
          color: C.cyan,
          textTransform: 'uppercase',
          fontFamily: MONO,
        }}
      >
        📈 Return vs Benchmark
      </div>
      <div style={{ fontSize: 9, color: C.text4, fontFamily: MONO }}>value-weighted</div>
    </div>
  );
}

function Tile({
  label,
  hint,
  children,
  hidden,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  return (
    <div
      hidden={hidden}
      style={{
        background: C.bg2,
        border: '1px solid ' + C.border1,
        borderRadius: 8,
        padding: '9px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily: MONO,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <div style={{ fontSize: 9.5, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div>{children}</div>
      {hint && <div style={{ fontSize: 9, color: C.text4 }}>{hint}</div>}
    </div>
  );
}

export default ReturnVsIndexCard;
