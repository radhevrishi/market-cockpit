'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/design-system';
import {
  LTCG_RATE,
  STCG_RATE,
  LTCG_EXEMPTION,
  LTCG_MONTHS,
  LTCG_WARN_DAYS,
  LTCG_CALLOUT_DAYS,
  normalizeSymbol,
  extractQuoteRows,
  toQuotePrice,
  computeTaxRow,
  computePortfolioTax,
  ltcgSwitchSaving,
  ltcgSortKey,
  toISODate,
  parseDate,
  type QuotePrice,
  type TaxRow,
  type Region,
} from '@/lib/tax-planner';

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
} as const;

const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';
const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', fontFamily: MONO };

const ACQDATE_KEY = 'mc:tax-acqdate:v1';
const HOLDINGS_KEY = 'mc_portfolio_holdings';

// ── holding shape from localStorage ─────────────────────────────────────────
interface Holding {
  symbol: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  addedAt: string;
  notes?: string;
}

// ── formatting ──────────────────────────────────────────────────────────────
/** Money in ₹ with lakh/crore compaction. This tool is India-equity focused,
 *  so figures are shown in ₹; US holdings (priced in $) are flagged inline. */
function inr(n: number | null | undefined, dp = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1e7) body = `${(abs / 1e7).toFixed(2)}Cr`;
  else if (abs >= 1e5) body = `${(abs / 1e5).toFixed(2)}L`;
  else body = abs.toLocaleString(undefined, { maximumFractionDigits: dp });
  return `${sign}₹${body}`;
}

const price = (n: number | null | undefined, region: Region | null) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : `${region === 'us' ? '$' : '₹'}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const flag = (r: Region | null) => (r === 'us' ? '🇺🇸' : r === 'india' ? '🇮🇳' : '🏳️');

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// ── small presentational atoms ──────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.bg1, border: `1px solid ${C.b1}`, borderRadius: 10, padding: 16, ...style }}>
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
      <div style={{ ...NUM, fontSize: 22, fontWeight: 700, color: toneColor, marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {sub != null ? <div style={{ fontSize: 11, color: C.t3, marginTop: 4 }}>{sub}</div> : null}
    </Card>
  );
}

// holding-status chip
function TermChip({ row }: { row: TaxRow }) {
  if (!row.acqDate || row.term == null) {
    return <span style={chipStyle(C.t4, C.bg3)}>NO DATE</span>;
  }
  if (row.term === 'long') {
    return <span style={chipStyle(C.bull, 'transparent')}>LONG-TERM</span>;
  }
  // short-term — is it about to cross?
  if (row.daysToLtcg != null && row.daysToLtcg <= LTCG_WARN_DAYS) {
    return (
      <span style={{ ...chipStyle(C.warn, 'transparent'), whiteSpace: 'nowrap' }}>
        ⏳ LTCG in {row.daysToLtcg}d
      </span>
    );
  }
  return <span style={chipStyle(C.bear, 'transparent')}>SHORT-TERM</span>;
}

function chipStyle(color: string, bg: string): React.CSSProperties {
  return {
    display: 'inline-block',
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color,
    background: bg,
    border: `1px solid ${color}`,
    borderRadius: 5,
    padding: '2px 7px',
    fontFamily: MONO,
  };
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function TaxPlannerPage() {
  const [mounted, setMounted] = useState(false);
  const [holdings, setHoldings] = useState<Holding[] | null>(null); // null = not yet read
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [quotesBySymbol, setQuotesBySymbol] = useState<Map<string, QuotePrice>>(new Map());
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>('');

  // "today" pinned once on mount so all rows share a consistent reference.
  const [today, setToday] = useState<Date | null>(null);

  // 1) read holdings + acq-date overrides from localStorage (client only) ------
  useEffect(() => {
    setMounted(true);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    setToday(now);
    if (typeof window === 'undefined') return;

    let parsed: Holding[] = [];
    try {
      const raw = window.localStorage.getItem(HOLDINGS_KEY);
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
    } catch { parsed = []; }
    setHoldings(parsed);

    try {
      const raw = window.localStorage.getItem(ACQDATE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string' && parseDate(v)) clean[normalizeSymbol(k)] = v;
        }
        setOverrides(clean);
      }
    } catch { /* ignore */ }
  }, []);

  // persist overrides whenever they change (after mount) -----------------------
  const setOverride = (symbol: string, iso: string | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      const key = normalizeSymbol(symbol);
      if (iso && parseDate(iso)) next[key] = iso;
      else delete next[key];
      if (typeof window !== 'undefined') {
        try { window.localStorage.setItem(ACQDATE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      }
      return next;
    });
  };

  // 2) fetch both markets, merge (india first → ₹ wins collisions) ------------
  useEffect(() => {
    if (holdings == null) return;
    if (holdings.length === 0) { setLoadingQuotes(false); return; }
    let cancelled = false;
    (async () => {
      setLoadingQuotes(true);
      setQuotesError(null);
      const map = new Map<string, QuotePrice>();
      const load = async (market: Region) => {
        try {
          const res = await fetch(`/api/market/quotes?market=${market}`, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          for (const raw of extractQuoteRows(json)) {
            const q = toQuotePrice(raw, market);
            if (q && q.symbol && !map.has(q.symbol)) map.set(q.symbol, q);
          }
          return json?.updatedAt as string | undefined;
        } catch { return undefined; }
      };
      const [uIndia, uUs] = await Promise.all([load('india'), load('us')]);
      if (cancelled) return;
      if (map.size === 0) setQuotesError('Live quotes are unavailable right now — values fall back to your entry price, so unrealised gains and tax show as ₹0 until quotes return.');
      setQuotesBySymbol(map);
      setUpdatedAt(uIndia || uUs || new Date().toISOString());
      setLoadingQuotes(false);
    })();
    return () => { cancelled = true; };
  }, [holdings]);

  // 3) derive rows + portfolio roll-up ----------------------------------------
  const rows = useMemo<TaxRow[]>(() => {
    if (holdings == null || today == null) return [];
    const out = holdings.map((h) => {
      const sym = normalizeSymbol(h.symbol);
      const q = quotesBySymbol.get(sym) || null;
      const ov = overrides[sym] || null;
      return computeTaxRow(h, q, ov, today);
    });
    out.sort((a, b) => ltcgSortKey(a) - ltcgSortKey(b));
    return out;
  }, [holdings, quotesBySymbol, overrides, today]);

  const portfolio = useMemo(() => computePortfolioTax(rows), [rows]);

  // holdings crossing into LTCG within the callout window ----------------------
  const crossers = useMemo(
    () => rows
      .filter((r) => r.term === 'short' && r.daysToLtcg != null && r.daysToLtcg > 0 && r.daysToLtcg <= LTCG_CALLOUT_DAYS)
      .sort((a, b) => (a.daysToLtcg || 0) - (b.daysToLtcg || 0)),
    [rows],
  );

  // ── render gates ───────────────────────────────────────────────────────────
  if (!mounted || holdings == null) {
    return (
      <Page>
        <Header updatedAt="" loading />
        <Card style={{ marginTop: 16, color: C.t3 }}>Loading your book…</Card>
      </Page>
    );
  }

  if (holdings.length === 0) {
    return (
      <Page>
        <Header updatedAt="" loading={false} />
        <Disclaimer />
        <Card style={{ marginTop: 16 }}>
          <EmptyState
            icon="🧾"
            title="No holdings to plan around yet"
            hint="Add positions in My Book, then come back to see holding periods, LTCG/STCG status and estimated tax if you sold today."
            pad={5}
          />
        </Card>
      </Page>
    );
  }

  const unmatched = rows.filter((r) => !r.hasLiveQuote).length;
  const usCount = rows.filter((r) => r.region === 'us').length;

  return (
    <Page>
      <Header updatedAt={updatedAt} loading={loadingQuotes} />
      <Disclaimer />

      {quotesError ? (
        <div style={{ marginTop: 12, padding: '8px 12px', background: C.bg2, border: `1px solid ${C.warn}`, borderRadius: 8, color: C.warn, fontSize: 12 }}>
          {quotesError}
        </div>
      ) : null}

      {/* SUMMARY TILES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginTop: 16 }}>
        <Tile
          label="Total unrealised gain"
          value={inr(portfolio.totalUnrealised)}
          sub={`on ${inr(portfolio.totalCurrentValue)} value`}
          tone={portfolio.totalUnrealised >= 0 ? 'good' : 'bad'}
        />
        <Tile
          label="Est. tax if sold today"
          value={inr(portfolio.estTotalTax)}
          sub="STCG + LTCG, after exemption"
          tone={portfolio.estTotalTax > 0 ? 'warn' : 'good'}
        />
        <Tile
          label="Short-term tax @ 20%"
          value={inr(portfolio.estShortTax)}
          sub={`on ${inr(portfolio.netShortGain)} net ST gain`}
          tone={portfolio.estShortTax > 0 ? 'bad' : undefined}
        />
        <Tile
          label="Long-term tax @ 12.5%"
          value={inr(portfolio.estLongTax)}
          sub={`on ${inr(portfolio.netLongGain)} net LT gain`}
          tone="info"
        />
        <Tile
          label="₹1.25L exemption left"
          value={inr(portfolio.exemptionRemaining)}
          sub={portfolio.exemptionRemaining > 0 ? 'LT gains still tax-free' : 'fully used this book'}
          tone={portfolio.exemptionRemaining > 0 ? 'good' : 'warn'}
        />
      </div>

      {/* CROSS-TO-LTCG CALLOUT */}
      <CrossCallout crossers={crossers} />

      {/* HARVEST / SUMMARY PANEL */}
      <HarvestPanel portfolio={portfolio} />

      {/* PER-HOLDING TABLE */}
      <HoldingsTable rows={rows} loadingQuotes={loadingQuotes} setOverride={setOverride} />

      {/* footnotes */}
      <div style={{ fontSize: 11, color: C.t4, marginTop: 14, lineHeight: 1.6 }}>
        Sorted by days-to-LTCG so near-crossers surface first. Per-line tax applies the flat STCG (20%) or LTCG (12.5%) rate to that
        line&apos;s unrealised gain and is <strong>gross</strong> of the ₹1.25 lakh annual LTCG exemption — the exemption is netted once, at the
        portfolio level, in the harvest panel. Only positive gains are taxed; losses reduce the matching bucket.
        {usCount > 0 ? ` ${usCount} US holding${usCount > 1 ? 's are' : ' is'} priced in $ and shown for completeness — US positions do not follow these India equity rules.` : ''}
        {unmatched > 0 ? ` ${unmatched} holding${unmatched > 1 ? 's' : ''} could not be matched to a live quote; those use entry price (₹0 gain).` : ''}
      </div>
    </Page>
  );
}

// ── disclaimer banner ─────────────────────────────────────────────────────────
function Disclaimer() {
  return (
    <div
      style={{
        marginTop: 14,
        padding: '10px 14px',
        background: C.bg2,
        border: `1px solid ${C.saffron}`,
        borderRadius: 8,
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <span aria-hidden style={{ fontSize: 16, lineHeight: 1.2 }}>⚠️</span>
      <div style={{ fontSize: 12, color: C.t1, lineHeight: 1.55 }}>
        <strong style={{ color: C.saffron }}>Approximate — not tax advice.</strong>{' '}
        This tool has <strong>no real purchase dates</strong>. It uses the date each holding was <em>added in this app</em> as an
        approximate acquisition date. Edit the <strong>Acquisition date</strong> per row to your actual buy date to make the numbers exact.
        Rates shown ({(LTCG_RATE * 100)}% LTCG above ₹1.25L, {(STCG_RATE * 100)}% STCG, &gt;{LTCG_MONTHS}-month threshold) are simplified
        FY2024-25 defaults for listed equity — verify current rates and your own situation with a qualified professional (your CA).
      </div>
    </div>
  );
}

// ── cross-to-LTCG callout ─────────────────────────────────────────────────────
function CrossCallout({ crossers }: { crossers: TaxRow[] }) {
  if (crossers.length === 0) return null;
  return (
    <Card style={{ marginTop: 16, borderColor: C.warn, background: C.bg2 }}>
      <SectionTitle hint={`Holding a bit longer flips these from ${STCG_RATE * 100}% short-term to ${LTCG_RATE * 100}% long-term tax.`}>
        <span style={{ color: C.warn }}>⏳ Crossing into LTCG within {LTCG_CALLOUT_DAYS} days</span>
      </SectionTitle>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {crossers.map((r) => {
          const saving = ltcgSwitchSaving(r);
          return (
            <li key={r.symbol} style={{ fontSize: 13, color: C.t1, lineHeight: 1.45 }}>
              Waiting <strong style={{ ...NUM, color: C.warn }}>{r.daysToLtcg}</strong> more day{r.daysToLtcg === 1 ? '' : 's'} on{' '}
              <strong>{flag(r.region)} {r.symbol}</strong> (LTCG from {fmtDate(r.ltcgDate)})
              {saving > 0
                ? <> saves ~<strong style={{ ...NUM, color: C.bull }}>{inr(saving)}</strong> in tax at today&apos;s gain.</>
                : <span style={{ color: C.t3 }}> — no gain to tax yet, but locks the lower long-term rate.</span>}
              {!r.acqIsOverride ? <span style={{ color: C.t4 }}> (approx date — confirm your real buy date)</span> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── harvest / summary panel ───────────────────────────────────────────────────
function HarvestPanel({ portfolio }: { portfolio: ReturnType<typeof computePortfolioTax> }) {
  const p = portfolio;
  const exemptFrac = LTCG_EXEMPTION > 0 ? Math.min(1, p.exemptionUsed / LTCG_EXEMPTION) : 0;
  return (
    <Card style={{ marginTop: 16 }}>
      <SectionTitle hint="If you sold the entire book today. Gains are split by holding term; the LTCG exemption is applied once here.">
        Harvest &amp; tax summary
      </SectionTitle>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
        {/* short-term bucket */}
        <div style={{ border: `1px solid ${C.b2}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: C.bear, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>Short-term (≤{LTCG_MONTHS}mo)</div>
          <Row label="Gross gains" value={inr(p.shortTermGain)} />
          {p.shortTermLoss > 0 ? <Row label="Losses" value={`-${inr(p.shortTermLoss)}`} color={C.bear} /> : null}
          <Row label="Net taxable gain" value={inr(p.netShortGain)} strong />
          <Row label={`Est. tax @ ${STCG_RATE * 100}%`} value={inr(p.estShortTax)} color={p.estShortTax > 0 ? C.err : C.t1} strong />
        </div>

        {/* long-term bucket */}
        <div style={{ border: `1px solid ${C.b2}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: C.bull, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>Long-term (&gt;{LTCG_MONTHS}mo)</div>
          <Row label="Gross gains" value={inr(p.longTermGain)} />
          {p.longTermLoss > 0 ? <Row label="Losses" value={`-${inr(p.longTermLoss)}`} color={C.bear} /> : null}
          <Row label="Net LT gain" value={inr(p.netLongGain)} strong />
          <Row label="Less exemption used" value={`-${inr(p.exemptionUsed)}`} color={C.bull} />
          <Row label={`Est. tax @ ${LTCG_RATE * 100}%`} value={inr(p.estLongTax)} color={C.info} strong />
        </div>
      </div>

      {/* exemption headroom bar */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, color: C.t2 }}>
          <span>₹1.25L LTCG exemption used</span>
          <span style={NUM}>{inr(p.exemptionUsed)} / {inr(LTCG_EXEMPTION)} · {inr(p.exemptionRemaining)} left</span>
        </div>
        <div style={{ height: 10, background: C.bg3, borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ width: `${exemptFrac * 100}%`, height: '100%', background: exemptFrac >= 1 ? C.warn : C.bull, borderRadius: 5, transition: 'width .3s' }} />
        </div>
        <div style={{ fontSize: 11, color: C.t3, marginTop: 6, lineHeight: 1.5 }}>
          {p.exemptionRemaining > 0
            ? <>You can realise up to <strong style={{ color: C.bull }}>{inr(p.exemptionRemaining)}</strong> more in long-term gains this year fully tax-free.</>
            : <>Long-term gains have used the full ₹1.25 lakh exemption; further LT gains are taxed at {LTCG_RATE * 100}%.</>}
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.b3}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 13, color: C.t2, fontWeight: 600 }}>Total estimated tax if sold today</span>
        <span style={{ ...NUM, fontSize: 20, fontWeight: 800, color: p.estTotalTax > 0 ? C.warn : C.bull }}>{inr(p.estTotalTax)}</span>
      </div>
    </Card>
  );
}

function Row({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12.5 }}>
      <span style={{ color: C.t3 }}>{label}</span>
      <span style={{ ...NUM, color: color || C.t1, fontWeight: strong ? 700 : 400 }}>{value}</span>
    </div>
  );
}

// ── per-holding table ─────────────────────────────────────────────────────────
function HoldingsTable({
  rows, loadingQuotes, setOverride,
}: { rows: TaxRow[]; loadingQuotes: boolean; setOverride: (sym: string, iso: string | null) => void }) {
  return (
    <Card style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: 16, paddingBottom: 8 }}>
        <SectionTitle hint={loadingQuotes ? 'Live prices loading…' : 'Days/months held are approximate unless you set a real acquisition date. Edit the date cell to override — it saves to this browser.'}>
          Per-holding tax &amp; holding period
        </SectionTitle>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 980 }}>
          <thead>
            <tr style={{ background: C.bg3, color: C.t3 }}>
              {['Symbol', 'Acquisition date', 'Held', 'Status', 'Qty', 'Cost', 'Value', 'Unrealised ₹', 'Est. tax'].map((h, i) => (
                <th key={h} style={{ padding: '8px 12px', textAlign: i <= 3 ? 'left' : 'right', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const g = r.unrealisedGain;
              const near = r.term === 'short' && r.daysToLtcg != null && r.daysToLtcg <= LTCG_WARN_DAYS;
              return (
                <tr key={r.symbol} style={{ borderTop: `1px solid ${C.b3}`, background: near ? C.bg2 : 'transparent' }}>
                  {/* symbol */}
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    <span style={{ color: C.t1, fontWeight: 600 }}>{flag(r.region)} {r.symbol}</span>
                    {!r.hasLiveQuote ? <span style={{ color: C.t4, fontSize: 10, marginLeft: 6 }}>no quote</span> : null}
                  </td>
                  {/* acquisition date editor */}
                  <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <input
                        type="date"
                        value={r.acqDate ? toISODate(r.acqDate) : ''}
                        max={toISODate(new Date())}
                        onChange={(e) => setOverride(r.symbol, e.target.value || null)}
                        style={{
                          background: C.bg0,
                          color: C.t1,
                          border: `1px solid ${r.acqIsOverride ? C.accent : C.b2}`,
                          borderRadius: 5,
                          padding: '3px 6px',
                          fontSize: 11.5,
                          fontFamily: MONO,
                          colorScheme: 'dark light',
                        }}
                      />
                      <span style={{ fontSize: 9.5, color: r.acqIsOverride ? C.bull : C.warn }}>
                        {r.acqIsOverride ? '✓ your buy date' : 'approx (when added here)'}
                      </span>
                    </div>
                  </td>
                  {/* held */}
                  <td style={{ padding: '8px 12px', textAlign: 'left', ...NUM, color: C.t2, whiteSpace: 'nowrap' }}>
                    {r.daysHeld == null ? '—' : (
                      <>
                        {r.daysHeld}d
                        <span style={{ color: C.t4 }}> · {r.monthsHeld != null ? r.monthsHeld.toFixed(1) : '—'}mo</span>
                      </>
                    )}
                  </td>
                  {/* status chip */}
                  <td style={{ padding: '8px 12px', textAlign: 'left' }}><TermChip row={r} /></td>
                  {/* qty */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', ...NUM, color: C.t2 }}>{r.quantity.toLocaleString()}</td>
                  {/* cost */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', ...NUM, color: C.t2 }}>{price(r.entryPrice, r.region)}<span style={{ color: C.t4 }}> ×</span></td>
                  {/* value */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', ...NUM, color: r.hasLiveQuote ? C.t1 : C.t4 }}>{inr(r.currentValue)}</td>
                  {/* unrealised */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', ...NUM, color: !r.hasLiveQuote ? C.t4 : g >= 0 ? C.bull : C.bear, fontWeight: 600 }}>
                    {r.hasLiveQuote ? `${g >= 0 ? '+' : ''}${inr(g)}` : '—'}
                  </td>
                  {/* est tax */}
                  <td style={{ padding: '8px 12px', textAlign: 'right', ...NUM, color: r.estTaxIfSoldToday > 0 ? (r.term === 'long' ? C.info : C.err) : C.t3 }}>
                    {r.estTaxIfSoldToday > 0 ? inr(r.estTaxIfSoldToday) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '10px 16px', fontSize: 10.5, color: C.t4, borderTop: `1px solid ${C.b3}`, lineHeight: 1.5 }}>
        Cost = entry price × qty. Value uses the live quote (₹ India / $ US) when available, else entry price. Est. tax is per-line and gross of the ₹1.25L exemption.
        Filling in your real buy date makes “Held”, “Status” and the LTCG countdown exact.
      </div>
    </Card>
  );
}

// ── layout shells ──────────────────────────────────────────────────────────────
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
          India Tax &amp; Holding-Period Planner
        </h1>
        <div style={{ fontSize: 13, color: C.t3, marginTop: 4, maxWidth: 720 }}>
          Holding periods, LTCG/STCG status and estimated tax-if-sold-today across your live book — built to help a long-term
          Indian investor time exits past the 12-month mark. Approximate until you enter real buy dates.
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.t4, textAlign: 'right', ...NUM }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: loading ? C.warn : C.bull, display: 'inline-block' }} />
          {loading ? 'Fetching live quotes…' : `Prices ${stamp}`}
        </span>
      </div>
    </div>
  );
}
