'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/design-system';
import { getConvictionList } from '@/lib/conviction-beats';
import {
  normalizeSymbol,
  toQuoteLite,
  extractQuoteRows,
  computeHHI,
  gradeHHI,
  topNConcentration,
  type QuoteLite,
  type RiskPosition,
  type Region,
} from '@/lib/risk-metrics';

// ── theme tokens (CSS vars only, for theme switching) ───────────────────────
const C = {
  bg0: 'var(--mc-bg-0)',
  bg1: 'var(--mc-bg-1)',
  bg2: 'var(--mc-bg-2)',
  bg3: 'var(--mc-bg-3)',
  bg4: 'var(--mc-bg-4)',
  t0: 'var(--mc-text-0)',
  t1: 'var(--mc-text-1)',
  t2: 'var(--mc-text-2)',
  t3: 'var(--mc-text-3)',
  t4: 'var(--mc-text-4)',
  b1: 'var(--mc-border-1)',
  b2: 'var(--mc-border-2)',
  b3: 'var(--mc-border-3)',
  bull: 'var(--mc-bullish)',
  bear: 'var(--mc-bearish)',
  warn: 'var(--mc-warn)',
  err: 'var(--mc-err)',
  info: 'var(--mc-info)',
  accent: 'var(--mc-accent)',
  cyan: 'var(--mc-cyan)',
  saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
} as const;

const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';
const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', fontFamily: MONO };

// ── holding shape from localStorage ─────────────────────────────────────────
interface Holding {
  symbol: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  addedAt: string;
  notes?: string;
}

// ── thresholds ──────────────────────────────────────────────────────────────
const SINGLE_NAME_FLAG = 0.15;   // 15% of book
const SECTOR_FLAG = 0.35;        // 35% of book
const DRAWDOWN_FLAG = 25;        // % off 52w high
const THIN_LIQUIDITY_ABS = 50_000; // fallback abs threshold for volume-like proxy
const FX_FALLBACK = 83.5;        // USD→INR fallback when no live rate is available — edit if stale

// ── formatting ──────────────────────────────────────────────────────────────
const pct = (n: number | null | undefined, dp = 1) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(dp)}%`;

function money(n: number | null | undefined, region: Region | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sym = region === 'us' ? '$' : '₹';
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1e7) body = `${(n / 1e7).toFixed(2)}Cr`;
  else if (abs >= 1e5) body = `${(n / 1e5).toFixed(2)}L`;
  else if (abs >= 1e3) body = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  else body = n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${sym}${body}`;
}

const price = (n: number | null | undefined, region: Region | null) =>
  n == null || !Number.isFinite(n) ? '—' : `${region === 'us' ? '$' : '₹'}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const flag = (r: Region | null) => (r === 'us' ? '🇺🇸' : r === 'india' ? '🇮🇳' : '🏳️');

/** Defensively probe a quotes payload for an embedded USD→INR rate. Returns
 *  null when the feed carries no currency field (the current shape). */
function pickFxFromPayload(payload: any): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const direct = [payload.usdInr, payload.usdinr, payload.fxRate, payload.fx_rate, payload.fx,
    payload.usdToInr, payload.rates?.INR, payload.currency?.usdInr, payload.forex?.USDINR];
  for (const v of direct) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 1) return n; // >1 guards against an inverse (INR→USD) slipping in
  }
  // a currencies/rows array carrying USDINR=X
  for (const key of ['currencies', 'stocks', 'quotes', 'data']) {
    const arr = (payload as any)[key];
    if (Array.isArray(arr)) {
      const row = arr.find((r: any) => r && (r.symbol === 'USDINR=X' || r.ticker === 'USDINR=X' || r.name === 'USD/INR'));
      const n = Number(row?.value ?? row?.price ?? row?.ltp);
      if (Number.isFinite(n) && n > 1) return n;
    }
  }
  return null;
}

// ── small presentational atoms ──────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: C.bg1,
        border: `1px solid ${C.b1}`,
        borderRadius: 10,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, letterSpacing: 0.3 }}>{children}</div>
      {hint ? <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

function Tile({
  label, value, sub, tone,
}: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'info' }) {
  const toneColor =
    tone === 'bad' ? C.err : tone === 'warn' ? C.warn : tone === 'good' ? C.bull : tone === 'info' ? C.info : C.t0;
  return (
    <Card style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: C.t3, textTransform: 'uppercase', letterSpacing: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ ...NUM, fontSize: 24, fontWeight: 700, color: toneColor, marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {sub != null ? <div style={{ fontSize: 11, color: C.t3, marginTop: 4 }}>{sub}</div> : null}
    </Card>
  );
}

function Bar({
  label, rightLabel, frac, color, flagged,
}: { label: React.ReactNode; rightLabel: React.ReactNode; frac: number; color: string; flagged?: boolean }) {
  const w = Math.max(0, Math.min(1, frac)) * 100;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: flagged ? C.warn : C.t2, fontWeight: flagged ? 700 : 500, display: 'flex', gap: 6, alignItems: 'center' }}>
          {flagged ? <span aria-hidden>⚠</span> : null}{label}
        </span>
        <span style={{ ...NUM, color: C.t2 }}>{rightLabel}</span>
      </div>
      <div style={{ height: 8, background: C.bg3, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

// ── data hook ────────────────────────────────────────────────────────────────
interface DeskData {
  positions: RiskPosition[];
  totalValue: number;
  quoteFields: { hasDrawdown: boolean; hasLiquidity: boolean };
  updatedAt: string;
}

const REGION_COLORS = [C.accent, C.cyan, C.saffron, C.purple, C.info, C.bull];

export default function RiskDeskPage() {
  const [holdings, setHoldings] = useState<Holding[] | null>(null); // null = not yet read
  const [quotesBySymbol, setQuotesBySymbol] = useState<Map<string, QuoteLite>>(new Map());
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const [fx, setFx] = useState<{ rate: number; source: string; live: boolean }>({ rate: FX_FALLBACK, source: `fallback ${FX_FALLBACK} — edit if stale`, live: false });

  // 1) read holdings from localStorage (client only, in effect — SSR safe)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let parsed: Holding[] = [];
    try {
      const raw = window.localStorage.getItem('mc_portfolio_holdings');
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        parsed = arr
          .filter((h) => h && typeof h.symbol === 'string')
          .map((h) => ({
            symbol: String(h.symbol),
            entryPrice: Number(h.entryPrice) || 0,
            quantity: Number(h.quantity) || 0,
            weight: Number(h.weight) || 0,
            addedAt: String(h.addedAt || ''),
            notes: h.notes ? String(h.notes) : undefined,
          }));
      }
    } catch {
      parsed = [];
    }
    setHoldings(parsed);
  }, []);

  // 2) fetch both markets, merge (india first so it wins symbol collisions → ₹)
  useEffect(() => {
    if (holdings == null) return;          // wait for holdings read
    if (holdings.length === 0) {           // nothing to price
      setLoadingQuotes(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingQuotes(true);
      setQuotesError(null);
      const map = new Map<string, QuoteLite>();
      let usJson: any = null;
      const load = async (market: Region) => {
        try {
          const res = await fetch(`/api/market/quotes?market=${market}`, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          if (market === 'us') usJson = json;
          const rows = extractQuoteRows(json);
          for (const row of rows) {
            const q = toQuoteLite(row, market);
            if (q && q.symbol && !map.has(q.symbol)) map.set(q.symbol, q);
          }
          return json?.updatedAt as string | undefined;
        } catch (e) {
          return undefined;
        }
      };
      // india first — it populates the map, so a symbol on both feeds infers ₹.
      const [uIndia, uUs] = await Promise.all([load('india'), load('us')]);
      if (cancelled) return;
      if (map.size === 0) setQuotesError('Live quotes are unavailable right now — showing entry-price estimates.');
      setQuotesBySymbol(map);
      setUpdatedAt(uIndia || uUs || new Date().toISOString());

      // ── resolve USD→INR ─────────────────────────────────────────────────
      // 1) probe the us quotes payload for an embedded FX field;
      // 2) else the app's macro feed (Yahoo USD/INR, already allowed);
      // 3) else a clearly-labelled fallback constant.
      const resolveFx = async (): Promise<{ rate: number; source: string; live: boolean } | null> => {
        // 1) embedded field on the us quotes response
        const embedded = pickFxFromPayload(usJson);
        if (embedded && embedded > 0) return { rate: embedded, source: 'US quotes feed', live: true };
        // 2) macro feed → currencies[symbol=USDINR=X].value
        try {
          const mres = await fetch('/api/market/macro', { cache: 'no-store' });
          if (mres.ok) {
            const mj = await mres.json();
            const cur = Array.isArray(mj?.currencies)
              ? mj.currencies.find((c: any) => c?.symbol === 'USDINR=X' || c?.name === 'USD/INR')
              : null;
            const rate = Number(cur?.value);
            if (Number.isFinite(rate) && rate > 0) return { rate, source: 'live USD/INR (macro feed)', live: true };
          }
        } catch { /* ignore */ }
        return null;
      };
      const resolved = await resolveFx();
      if (cancelled) return;
      if (resolved) setFx(resolved);
      else setFx({ rate: FX_FALLBACK, source: `fallback ${FX_FALLBACK} — edit if stale`, live: false });

      setLoadingQuotes(false);
    })();
    return () => { cancelled = true; };
  }, [holdings]);

  // conviction fallback for sector (client only)
  const convictionSector = useMemo(() => {
    const m = new Map<string, string>();
    try {
      for (const e of getConvictionList()) {
        if (e && e.ticker && e.sector) m.set(normalizeSymbol(e.ticker), e.sector);
      }
    } catch { /* ignore */ }
    return m;
  }, [holdings]);

  // 3) derive the desk model
  const desk: DeskData | null = useMemo(() => {
    if (holdings == null || holdings.length === 0) return null;

    const rows = holdings.map((h) => {
      const sym = normalizeSymbol(h.symbol);
      const quote = quotesBySymbol.get(sym) || null;
      const region: Region | null = quote ? quote.region : null;
      const livePrice = quote?.price ?? null;
      const effPrice = livePrice != null && livePrice > 0 ? livePrice : (h.entryPrice || 0);
      const marketValue = (h.quantity || 0) * effPrice;
      const sector = quote?.sector || convictionSector.get(sym) || 'Unknown';
      const pnlPct =
        livePrice != null && livePrice > 0 && h.entryPrice > 0
          ? ((livePrice - h.entryPrice) / h.entryPrice) * 100
          : null;
      return {
        symbol: sym,
        quantity: h.quantity || 0,
        entryPrice: h.entryPrice || 0,
        storedWeight: h.weight || 0,
        notes: h.notes,
        quote,
        region,
        sector,
        livePrice,
        marketValue,
        weight: 0, // filled below
        pnlPct,
        distFromHigh: quote?.distFromHigh ?? null,
        liquidity: quote?.liquidity ?? null,
      } as RiskPosition;
    });

    const totalValue = rows.reduce((a, r) => a + r.marketValue, 0);
    for (const r of rows) {
      r.weight = totalValue > 0 ? r.marketValue / totalValue : (r.storedWeight || 0) / 100;
    }
    rows.sort((a, b) => b.weight - a.weight);

    const hasDrawdown = rows.some((r) => r.distFromHigh != null);
    const hasLiquidity = rows.some((r) => r.liquidity != null);

    return { positions: rows, totalValue, quoteFields: { hasDrawdown, hasLiquidity }, updatedAt };
  }, [holdings, quotesBySymbol, convictionSector, updatedAt]);

  // ── render: empty state ────────────────────────────────────────────────────
  if (holdings != null && holdings.length === 0) {
    return (
      <Page>
        <Header updatedAt="" loading={false} />
        <Card style={{ marginTop: 16 }}>
          <EmptyState
            icon="🛡️"
            title="No holdings to analyze yet"
            hint="Add positions in My Book to see concentration, sector exposure, drawdown and liquidity risk here."
            pad={5}
          />
        </Card>
      </Page>
    );
  }

  // still reading holdings
  if (holdings == null || desk == null) {
    return (
      <Page>
        <Header updatedAt="" loading />
        <Card style={{ marginTop: 16, color: C.t3 }}>Loading your book…</Card>
      </Page>
    );
  }

  return (
    <Page>
      <Header updatedAt={desk.updatedAt} loading={loadingQuotes} />
      {quotesError ? (
        <div style={{ marginTop: 12, padding: '8px 12px', background: C.bg2, border: `1px solid ${C.warn}`, borderRadius: 8, color: C.warn, fontSize: 12 }}>
          {quotesError}
        </div>
      ) : null}
      <DeskBody desk={desk} loadingQuotes={loadingQuotes} fx={fx} />
    </Page>
  );
}

// ── layout shells ────────────────────────────────────────────────────────────
function Page({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: C.bg0, minHeight: '100%', padding: 20, color: C.t1, fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

function Header({ updatedAt, loading }: { updatedAt: string; loading: boolean }) {
  let stamp = '—';
  if (updatedAt) {
    const d = new Date(updatedAt);
    if (!isNaN(d.getTime())) stamp = d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.t0, letterSpacing: -0.3 }}>
          Risk &amp; Concentration Desk
        </h1>
        <div style={{ fontSize: 13, color: C.t3, marginTop: 4 }}>
          Single-name, sector, region, drawdown and liquidity risk across your live book — an early-warning screen for the concentrated investor.
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.t4, textAlign: 'right', ...NUM }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: loading ? C.warn : C.bull, display: 'inline-block' }} />
          {loading ? 'Fetching live quotes…' : `Last updated ${stamp}`}
        </span>
      </div>
    </div>
  );
}

// ── the main body (only rendered when we have positions) ─────────────────────
function DeskBody({ desk, loadingQuotes, fx }: { desk: DeskData; loadingQuotes: boolean; fx: { rate: number; source: string; live: boolean } }) {
  const { positions, totalValue } = desk;
  const n = positions.length;
  const weights = positions.map((p) => p.weight);
  const largest = positions[0];
  const hhi = computeHHI(weights);
  const grade = gradeHHI(hhi);
  const top5 = topNConcentration(weights, 5);

  // region / currency split by market value
  const byRegion = { india: 0, us: 0, unknown: 0 };
  for (const p of positions) {
    if (p.region === 'india') byRegion.india += p.marketValue;
    else if (p.region === 'us') byRegion.us += p.marketValue;
    else byRegion.unknown += p.marketValue;
  }
  const inrPct = totalValue > 0 ? (byRegion.india / totalValue) * 100 : 0;
  const usdPct = totalValue > 0 ? (byRegion.us / totalValue) * 100 : 0;
  const unkPct = totalValue > 0 ? (byRegion.unknown / totalValue) * 100 : 0;

  // ── US sleeve (currency-adjusted) ─────────────────────────────────────────
  // US names are those matched via the ?market=us feed (marketValue is in USD).
  const usPositions = positions.filter((p) => p.region === 'us');
  const usSleeveUsd = usPositions.reduce((a, p) => a + p.marketValue, 0);      // native USD
  const usSleeveInr = usSleeveUsd * fx.rate;                                    // converted
  // FX-consistent book value in ₹: India & unmatched are already ₹, US converted.
  const bookInr = byRegion.india + byRegion.unknown + usSleeveInr;
  const usSleevePctOfBook = bookInr > 0 ? (usSleeveInr / bookInr) * 100 : 0;

  // sector aggregation
  const sectorMap = new Map<string, number>();
  for (const p of positions) sectorMap.set(p.sector, (sectorMap.get(p.sector) || 0) + p.weight);
  const sectors = [...sectorMap.entries()].map(([name, w]) => ({ name, w })).sort((a, b) => b.w - a.w);
  const topSector = sectors[0];

  // drawdown stats
  const hasDrawdown = desk.quoteFields.hasDrawdown;
  const drawdownRows = positions.filter((p) => p.distFromHigh != null).sort((a, b) => (b.distFromHigh || 0) - (a.distFromHigh || 0));
  const bookOffHighsPct = hasDrawdown
    ? positions.filter((p) => (p.distFromHigh || 0) > DRAWDOWN_FLAG).reduce((a, p) => a + p.weight, 0) * 100
    : 0;
  const deepDrawCount = drawdownRows.filter((p) => (p.distFromHigh || 0) > DRAWDOWN_FLAG).length;

  // liquidity — relative flag (bottom quartile of the proxy) + absolute floor
  const hasLiquidity = desk.quoteFields.hasLiquidity;
  const liqVals = positions.map((p) => p.liquidity).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
  const liqQuartile = liqVals.length >= 4 ? liqVals[Math.floor(liqVals.length * 0.25)] : (liqVals[0] ?? 0);
  const thinRows = hasLiquidity
    ? positions.filter((p) => p.liquidity != null && p.liquidity > 0 && (p.liquidity <= liqQuartile || p.liquidity < THIN_LIQUIDITY_ABS))
    : [];

  // ── risk flags ──────────────────────────────────────────────────────────
  const flags: { tone: 'bad' | 'warn'; text: string }[] = [];
  for (const p of positions) {
    if (p.weight > SINGLE_NAME_FLAG) {
      flags.push({ tone: p.weight > 0.25 ? 'bad' : 'warn', text: `${p.symbol} is ${(p.weight * 100).toFixed(0)}% of the book — single-name risk.` });
    }
  }
  for (const s of sectors) {
    if (s.w > SECTOR_FLAG) flags.push({ tone: 'bad', text: `${s.name} sector is ${(s.w * 100).toFixed(0)}% of the book — sector concentration.` });
  }
  if (hhi > 2500) flags.push({ tone: 'warn', text: `Portfolio HHI is ${Math.round(hhi)} (${grade.label}) — low effective diversification.` });
  if (top5 > 70 && n > 5) flags.push({ tone: 'warn', text: `Top-5 names are ${top5.toFixed(0)}% of the book.` });
  if (hasDrawdown && deepDrawCount > 0) {
    flags.push({ tone: deepDrawCount >= 3 ? 'bad' : 'warn', text: `${deepDrawCount} holding${deepDrawCount > 1 ? 's sit' : ' sits'} >${DRAWDOWN_FLAG}% below the 52-week high.` });
  }
  if (hasLiquidity && thinRows.length > 0) {
    flags.push({ tone: 'warn', text: `${thinRows.length} holding${thinRows.length > 1 ? 's show' : ' shows'} thin liquidity — harder to exit at size.` });
  }
  if (unkPct > 0) flags.push({ tone: 'warn', text: `${unkPct.toFixed(0)}% of the book could not be matched to a live quote — figures use entry price.` });

  return (
    <>
      {/* 1. SUMMARY TILES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginTop: 16 }}>
        <Tile label="Positions" value={n} sub={`across ${sectors.length} sector${sectors.length === 1 ? '' : 's'}`} />
        <Tile
          label="Largest position"
          value={largest ? pct(largest.weight * 100, 0) : '—'}
          sub={largest ? largest.symbol : undefined}
          tone={largest && largest.weight > SINGLE_NAME_FLAG ? 'bad' : 'good'}
        />
        <Tile label="Top-5 concentration" value={pct(top5, 0)} sub={n <= 5 ? 'entire book' : `of ${n} names`} tone={top5 > 70 ? 'warn' : undefined} />
        <Tile label="HHI" value={Math.round(hhi)} sub={grade.label} tone={grade.tone} />
        <Tile
          label="Currency split"
          value={<span style={{ fontSize: 18 }}>{`₹${inrPct.toFixed(0)} / $${usdPct.toFixed(0)}`}</span>}
          sub="INR / USD"
          tone="info"
        />
      </div>

      {/* 2 + 4 side by side on wide screens */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16, marginTop: 16 }}>
        {/* 2. CONCENTRATION */}
        <Card>
          <SectionTitle hint="By live market value (qty × price). Names over 15% flagged.">Position concentration</SectionTitle>
          {positions.map((p, i) => (
            <Bar
              key={p.symbol}
              label={<span>{flag(p.region)} {p.symbol}</span>}
              rightLabel={pct(p.weight * 100)}
              frac={p.weight}
              color={p.weight > SINGLE_NAME_FLAG ? C.err : REGION_COLORS[i % REGION_COLORS.length]}
              flagged={p.weight > SINGLE_NAME_FLAG}
            />
          ))}
        </Card>

        {/* 3. SECTOR */}
        <Card>
          <SectionTitle hint="Aggregated by sector. Any sector over 35% flagged.">Sector exposure</SectionTitle>
          {sectors.map((s) => (
            <Bar
              key={s.name}
              label={s.name}
              rightLabel={pct(s.w * 100)}
              frac={s.w}
              color={s.w > SECTOR_FLAG ? C.err : C.accent}
              flagged={s.w > SECTOR_FLAG}
            />
          ))}
        </Card>
      </div>

      {/* 4. REGION / CURRENCY SPLIT */}
      <Card style={{ marginTop: 16 }}>
        <SectionTitle hint="Share of book market value by listing currency.">Region / currency split</SectionTitle>
        <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.b1}` }}>
          {inrPct > 0 ? (
            <div style={{ width: `${inrPct}%`, background: C.saffron, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111', fontSize: 11, fontWeight: 700, ...NUM }}>
              {inrPct >= 8 ? `🇮🇳 ${inrPct.toFixed(0)}%` : ''}
            </div>
          ) : null}
          {usdPct > 0 ? (
            <div style={{ width: `${usdPct}%`, background: C.info, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, ...NUM }}>
              {usdPct >= 8 ? `🇺🇸 ${usdPct.toFixed(0)}%` : ''}
            </div>
          ) : null}
          {unkPct > 0 ? (
            <div style={{ width: `${unkPct}%`, background: C.bg4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.t3, fontSize: 11, ...NUM }}>
              {unkPct >= 8 ? `? ${unkPct.toFixed(0)}%` : ''}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 12, color: C.t2, ...NUM }}>
          <span>🇮🇳 INR {money(byRegion.india, 'india')} · {inrPct.toFixed(1)}%</span>
          <span>🇺🇸 USD {money(byRegion.us, 'us')} · {usdPct.toFixed(1)}%</span>
          {byRegion.unknown > 0 ? <span style={{ color: C.t3 }}>Unmatched · {unkPct.toFixed(1)}%</span> : null}
        </div>
      </Card>

      {/* 4b. CURRENCY-ADJUSTED RETURNS — US SLEEVE (only when US names held) */}
      {usPositions.length > 0 ? (
        <Card style={{ marginTop: 16 }}>
          <SectionTitle
            hint={`USD→INR ${fx.rate.toFixed(2)} · ${fx.source}. Native return is USD-vs-USD; ₹ value converts at the current rate.`}
          >
            Currency-adjusted returns — US sleeve
          </SectionTitle>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
            <Tile label="US sleeve (USD)" value={money(usSleeveUsd, 'us')} sub={`${usPositions.length} name${usPositions.length === 1 ? '' : 's'}`} tone="info" />
            <Tile label="US sleeve (INR)" value={money(usSleeveInr, 'india')} sub={`@ ₹${fx.rate.toFixed(2)}/$`} tone="info" />
            <Tile label="US % of book" value={pct(usSleevePctOfBook, 0)} sub="FX-consistent ₹ basis" />
            <Tile label="USD/INR" value={fx.rate.toFixed(2)} sub={fx.live ? 'live' : 'fallback — edit if stale'} tone={fx.live ? 'good' : 'warn'} />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
              <thead>
                <tr style={{ background: C.bg3, color: C.t3 }}>
                  {['Symbol', 'Entry $', 'Live $', 'Native ret%', 'Value $', 'Value ₹'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usPositions.map((p) => (
                  <tr key={p.symbol} style={{ borderTop: `1px solid ${C.b3}` }}>
                    <td style={{ padding: '8px 12px', color: C.t1, fontWeight: 600, whiteSpace: 'nowrap' }}>🇺🇸 {p.symbol}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.t2, ...NUM }}>{price(p.entryPrice, 'us')}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: p.livePrice == null ? C.t4 : C.t1, ...NUM }}>{p.livePrice == null ? '—' : price(p.livePrice, 'us')}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: p.pnlPct == null ? C.t4 : p.pnlPct >= 0 ? C.bull : C.bear, ...NUM }}>
                      {p.pnlPct == null ? '—' : `${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%`}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.t1, ...NUM }}>{money(p.marketValue, 'us')}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.saffron, ...NUM }}>{money(p.marketValue * fx.rate, 'india')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, padding: '10px 12px', background: C.bg2, border: `1px solid ${C.b2}`, borderRadius: 8, fontSize: 11.5, color: C.t3, lineHeight: 1.5 }}>
            <strong style={{ color: C.t2 }}>FX contribution.</strong> Native returns above are USD-vs-USD and carry no currency effect.
            Your rupee outcome on this sleeve — worth {money(usSleeveInr, 'india')} today at ₹{fx.rate.toFixed(2)}/$ — also moves with USD/INR:
            a stronger rupee erodes it, a weaker rupee lifts it, independent of the underlying stocks.
            We don&apos;t store the exchange rate at purchase, so a precise ₹ P&amp;L (with its FX split) can&apos;t be shown — treat the ₹ figure as a current-rate snapshot, not a locked-in gain.
            {fx.live ? '' : ` Rate shown is a fallback (${fx.rate.toFixed(2)}) — no live USD/INR was available; edit ${'FX_FALLBACK'} if stale.`}
          </div>
        </Card>
      ) : null}

      {/* 5. DRAWDOWN (only if data available) */}
      {hasDrawdown ? (
        <Card style={{ marginTop: 16 }}>
          <SectionTitle hint={`Distance below 52-week high. ${pct(bookOffHighsPct, 0)} of the book sits >${DRAWDOWN_FLAG}% off highs.`}>
            Drawdown / distance from 52-week high
          </SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '0 24px' }}>
            {drawdownRows.map((p) => (
              <Bar
                key={p.symbol}
                label={<span>{flag(p.region)} {p.symbol}</span>}
                rightLabel={`-${(p.distFromHigh || 0).toFixed(0)}%`}
                frac={(p.distFromHigh || 0) / 100}
                color={(p.distFromHigh || 0) > DRAWDOWN_FLAG ? C.warn : C.t4}
                flagged={(p.distFromHigh || 0) > DRAWDOWN_FLAG}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {/* 6. LIQUIDITY (only if data available) */}
      {hasLiquidity && thinRows.length > 0 ? (
        <Card style={{ marginTop: 16 }}>
          <SectionTitle hint="Holdings in the thinnest-liquidity quartile of your book — costlier to exit at size.">
            Liquidity / thin-float watch
          </SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {thinRows.map((p) => (
              <span key={p.symbol} style={{ ...NUM, fontSize: 12, background: C.bg2, border: `1px solid ${C.warn}`, color: C.t1, borderRadius: 6, padding: '4px 10px' }}>
                {flag(p.region)} {p.symbol} · {pct(p.weight * 100, 0)} of book
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {/* 7. RISK FLAGS */}
      <Card style={{ marginTop: 16 }}>
        <SectionTitle hint="Concrete warnings derived from the metrics above.">Risk flags</SectionTitle>
        {flags.length === 0 ? (
          <div style={{ fontSize: 13, color: C.bull, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span aria-hidden>✓</span> No material concentration, sector, drawdown or liquidity warnings.
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {flags.map((f, i) => (
              <li key={i} style={{ fontSize: 13, color: f.tone === 'bad' ? C.err : C.warn, lineHeight: 1.4 }}>{f.text}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* 8. POSITIONS TABLE */}
      <Card style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 16, paddingBottom: 8 }}>
          <SectionTitle hint={loadingQuotes ? 'Live prices loading…' : 'Live prices merged from India + US feeds.'}>Positions</SectionTitle>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
            <thead>
              <tr style={{ background: C.bg3, color: C.t3, textAlign: 'right' }}>
                {['Symbol', 'Rgn', 'Sector', 'Qty', 'Entry', 'Live', 'Value', 'Weight', 'P&L%', 'Off high'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: i <= 2 ? 'left' : 'right', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.symbol} style={{ borderTop: `1px solid ${C.b3}` }}>
                  <td style={{ padding: '8px 12px', color: C.t1, fontWeight: 600, whiteSpace: 'nowrap' }}>{p.symbol}</td>
                  <td style={{ padding: '8px 12px' }}>{flag(p.region)}</td>
                  <td style={{ padding: '8px 12px', color: C.t2, whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.sector}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: C.t2, ...NUM }}>{p.quantity.toLocaleString()}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: C.t2, ...NUM }}>{price(p.entryPrice, p.region)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: p.livePrice == null ? C.t4 : C.t1, ...NUM }}>{p.livePrice == null ? '—' : price(p.livePrice, p.region)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: C.t1, ...NUM }}>{money(p.marketValue, p.region)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: p.weight > SINGLE_NAME_FLAG ? C.err : C.t1, fontWeight: p.weight > SINGLE_NAME_FLAG ? 700 : 400, ...NUM }}>{pct(p.weight * 100)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: p.pnlPct == null ? C.t4 : p.pnlPct >= 0 ? C.bull : C.bear, ...NUM }}>
                    {p.pnlPct == null ? '—' : `${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%`}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: (p.distFromHigh || 0) > DRAWDOWN_FLAG ? C.warn : C.t3, ...NUM }}>
                    {p.distFromHigh == null ? '—' : `-${p.distFromHigh.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ fontSize: 11, color: C.t4, marginTop: 14, lineHeight: 1.5 }}>
        Weights are computed from live market value (quantity × live price; entry price when a live quote is unavailable).
        Region and currency are inferred from which feed each symbol matched. Not investment advice.
      </div>
    </>
  );
}
