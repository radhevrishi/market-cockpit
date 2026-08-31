'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/design-system';
import OwnBadge from '@/components/OwnBadge';
import { getConvictionList, type ConvictionEntry } from '@/lib/conviction-beats';
import { getPortfolioMap } from '@/lib/portfolio-overlay';
import {
  buildPlan,
  normTicker,
  SIZING,
  CAP_BUCKETS,
  CAP_UNKNOWN_HAIRCUT,
  type Plan,
  type PlanRow,
  type Action,
} from '@/lib/position-sizing';

// ── theme tokens (CSS vars only) ────────────────────────────────────────────
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

// ── guardrail thresholds ────────────────────────────────────────────────────
const TOP5_FLAG = 0.4;    // 40% of book in the top-5 targets
const SECTOR_FLAG = 0.35; // 35% of book in any one sector

// ── holding shape ───────────────────────────────────────────────────────────
interface Holding {
  symbol: string;
  entryPrice: number;
  quantity: number;
  weight: number;
  addedAt: string;
  notes?: string;
}

// ── quote lite for optional live valuation ──────────────────────────────────
interface QuoteLite { price: number; }

// ── formatting ──────────────────────────────────────────────────────────────
const pct = (frac: number | null | undefined, dp = 1) =>
  frac == null || !Number.isFinite(frac) ? '—' : `${(frac * 100).toFixed(dp)}%`;
const pctPts = (n: number | null | undefined, dp = 1) =>
  n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(dp)}`;

function inr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `₹${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `₹${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
const num = (n: number | null | undefined, dp = 1) =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(dp);

// ── presentational atoms ────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.bg1, border: `1px solid ${C.b1}`, borderRadius: 10, padding: 16, ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.t1, letterSpacing: 0.3 }}>{children}</div>
      {hint ? <div style={{ fontSize: 11, color: C.t3, marginTop: 2, lineHeight: 1.5 }}>{hint}</div> : null}
    </div>
  );
}

function Tile({ label, value, sub, tone }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'info';
}) {
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

function Bar({ label, rightLabel, frac, color, flagged }: {
  label: React.ReactNode; rightLabel: React.ReactNode; frac: number; color: string; flagged?: boolean;
}) {
  const w = Math.max(0, Math.min(1, frac)) * 100;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3, gap: 8 }}>
        <span style={{ color: flagged ? C.warn : C.t2, fontWeight: flagged ? 700 : 500, display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {flagged ? <span aria-hidden>⚠</span> : null}{label}
        </span>
        <span style={{ ...NUM, color: C.t2, whiteSpace: 'nowrap' }}>{rightLabel}</span>
      </div>
      <div style={{ height: 8, background: C.bg3, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

const TIER_COLOR: Record<string, string> = { BLOCKBUSTER: C.saffron, STRONG: C.cyan };
const ACTION_COLOR: Record<Action, string> = { BUY: C.bull, ADD: C.info, TRIM: C.warn, HOLD: C.t3 };

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', padding: '1px 6px', borderRadius: 4,
      color, background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`, fontFamily: MONO, whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

// ── input controls ──────────────────────────────────────────────────────────
function NumberField({ label, value, onChange, step, min, max, suffix, hint }: {
  label: string; value: number; onChange: (n: number) => void;
  step?: number; min?: number; max?: number; suffix?: string; hint?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: C.t3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.bg2, border: `1px solid ${C.b2}`, borderRadius: 8, padding: '6px 10px' }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(Number.isFinite(v) ? v : 0);
          }}
          style={{ ...NUM, flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: C.t0, fontSize: 14, fontWeight: 600 }}
        />
        {suffix ? <span style={{ fontSize: 12, color: C.t3, ...NUM }}>{suffix}</span> : null}
      </span>
      {hint ? <span style={{ fontSize: 10.5, color: C.t4 }}>{hint}</span> : null}
    </label>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function PositionSizingPage() {
  const [mounted, setMounted] = useState(false);
  const [bench, setBench] = useState<ConvictionEntry[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [quotes, setQuotes] = useState<Map<string, QuoteLite>>(new Map());
  const [screenerSector, setScreenerSector] = useState<Record<string, string>>({});  // zzz513 — Screener Industry Group map

  // zzz513 — load the Screener sector map once (best India sector source)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/market/sector-map', { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j?.sectors) setScreenerSector(j.sectors); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // inputs
  const [capital, setCapital] = useState<number>(1_000_000);
  const [capitalTouched, setCapitalTouched] = useState(false);
  const [maxSinglePct, setMaxSinglePct] = useState<number>(8);
  const [numNames, setNumNames] = useState<number>(20);
  const [applyCapTilt, setApplyCapTilt] = useState<boolean>(true);

  // 1) read client stores in an effect (SSR-safe)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setMounted(true);
    try { setBench(getConvictionList()); } catch { setBench([]); }
    try {
      const raw = window.localStorage.getItem('mc_portfolio_holdings');
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        setHoldings(arr.filter((h: any) => h && typeof h.symbol === 'string').map((h: any) => ({
          symbol: String(h.symbol),
          entryPrice: Number(h.entryPrice) || 0,
          quantity: Number(h.quantity) || 0,
          weight: Number(h.weight) || 0,
          addedAt: String(h.addedAt || ''),
          notes: h.notes ? String(h.notes) : undefined,
        })));
      }
    } catch { setHoldings([]); }
    const onBench = () => { try { setBench(getConvictionList()); } catch {} };
    window.addEventListener('conviction-beats:updated', onBench);
    return () => window.removeEventListener('conviction-beats:updated', onBench);
  }, []);

  // 2) optional live quotes (india + us) to refine current market value
  useEffect(() => {
    if (!mounted || holdings.length === 0) return;
    let cancelled = false;
    (async () => {
      const map = new Map<string, QuoteLite>();
      const load = async (market: 'india' | 'us') => {
        try {
          const res = await fetch(`/api/market/quotes?market=${market}`, { cache: 'no-store' });
          if (!res.ok) return;
          const json = await res.json();
          const rows: any[] = Array.isArray(json?.stocks) ? json.stocks : [];
          for (const r of rows) {
            const t = normTicker(String(r?.ticker || ''));
            const p = Number(r?.price);
            const sec = String(r?.sector || r?.industry || '').trim() || undefined;  // zzz512 — keep sector
            if (t && Number.isFinite(p) && p > 0 && !map.has(t)) map.set(t, { price: p, sector: sec } as QuoteLite);
          }
        } catch { /* offline → entry-price fallback */ }
      };
      await Promise.all([load('india'), load('us')]);
      if (!cancelled) setQuotes(map);
    })();
    return () => { cancelled = true; };
  }, [mounted, holdings]);

  // 3) current book: market value per held name + total (live price, else entry price)
  const book = useMemo(() => {
    const perSymbol = new Map<string, number>(); // normalized symbol → current value
    const heldSymbols = new Set<string>();
    let total = 0;
    for (const h of holdings) {
      const sym = normTicker(h.symbol);
      heldSymbols.add(sym);
      const live = quotes.get(sym)?.price;
      const eff = live != null && live > 0 ? live : h.entryPrice;
      const val = (h.quantity || 0) * (eff || 0);
      perSymbol.set(sym, (perSymbol.get(sym) || 0) + val);
      total += val;
    }
    // membership also via portfolio-overlay (handles alternate symbol casing)
    try { for (const k of getPortfolioMap().keys()) heldSymbols.add(normTicker(k)); } catch { /* noop */ }
    const heldWeights = new Map<string, number>();
    if (total > 0) for (const [s, v] of perSymbol) heldWeights.set(s, v / total);
    return { total, heldWeights, heldSymbols };
  }, [holdings, quotes]);

  // prefill capital from current book value once (until user edits)
  useEffect(() => {
    if (!capitalTouched && book.total > 0) setCapital(Math.round(book.total));
  }, [book.total, capitalTouched]);

  // 4) build the plan
  const plan: Plan | null = useMemo(() => {
    if (bench.length === 0) return null;
    // zzz512/513 — sector resolver: Screener "Industry Group" first (covers the
    // micro-caps the NSE feed calls "Other"), then the quotes-feed sector.
    const sectorOf = new Map<string, string>();
    quotes.forEach((v, k) => { const s = (v as any)?.sector; if (s && s !== 'Other') sectorOf.set(k, s); });
    for (const [k, v] of Object.entries(screenerSector)) { if (v) sectorOf.set(normTicker(k), v); }
    return buildPlan({
      bench,
      capital: capital > 0 ? capital : 0,
      maxSinglePct,
      numNames,
      applyCapTilt,
      heldWeights: book.heldWeights,
      heldSymbols: book.heldSymbols,
      sectorOf,
    });
  }, [bench, capital, maxSinglePct, numNames, applyCapTilt, book.heldWeights, book.heldSymbols, quotes, screenerSector]);

  // ── empty state ────────────────────────────────────────────────────────────
  if (mounted && bench.length === 0) {
    return (
      <Page>
        <Header />
        <Card style={{ marginTop: 16 }}>
          <EmptyState
            icon="📐"
            title="Your Conviction bench is empty"
            hint="Grade earnings in Earnings Opportunities to build your Conviction bench — BLOCKBUSTER and STRONG names flow here and become an allocation plan."
            pad={5}
          />
        </Card>
      </Page>
    );
  }

  if (!mounted || !plan) {
    return (
      <Page>
        <Header />
        <Card style={{ marginTop: 16, color: C.t3 }}>Building your allocation plan…</Card>
      </Page>
    );
  }

  return (
    <Page>
      <Header benchCount={bench.length} />
      <Inputs
        capital={capital} setCapital={(n) => { setCapital(n); setCapitalTouched(true); }}
        maxSinglePct={maxSinglePct} setMaxSinglePct={setMaxSinglePct}
        numNames={numNames} setNumNames={setNumNames}
        applyCapTilt={applyCapTilt} setApplyCapTilt={setApplyCapTilt}
        bookValue={book.total} heldCount={book.heldSymbols.size}
      />
      <Body plan={plan} capital={capital} applyCapTilt={applyCapTilt} />
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

function Header({ benchCount }: { benchCount?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.t0, letterSpacing: -0.3 }}>Position Sizing</h1>
        <div style={{ fontSize: 13, color: C.t3, marginTop: 4, maxWidth: 720 }}>
          Turn your Conviction Beats bench into a concrete allocation plan — conviction-weighted target sizes, single-name and sector guardrails, and a buy / rebalance cut against the book you already hold.
        </div>
      </div>
      {benchCount != null ? (
        <div style={{ fontSize: 11, color: C.t4, textAlign: 'right', ...NUM }}>
          {benchCount} name{benchCount === 1 ? '' : 's'} on bench
        </div>
      ) : null}
    </div>
  );
}

// ── inputs panel ─────────────────────────────────────────────────────────────
function Inputs({
  capital, setCapital, maxSinglePct, setMaxSinglePct, numNames, setNumNames,
  applyCapTilt, setApplyCapTilt, bookValue, heldCount,
}: {
  capital: number; setCapital: (n: number) => void;
  maxSinglePct: number; setMaxSinglePct: (n: number) => void;
  numNames: number; setNumNames: (n: number) => void;
  applyCapTilt: boolean; setApplyCapTilt: (b: boolean) => void;
  bookValue: number; heldCount: number;
}) {
  return (
    <Card style={{ marginTop: 16 }}>
      <SectionTitle hint={bookValue > 0
        ? `Capital prefilled from your current book value (${inr(bookValue)}, ${heldCount} held name${heldCount === 1 ? '' : 's'}). Edit any field to re-plan.`
        : 'No holdings found — enter the capital you intend to deploy. Edit any field to re-plan.'}>
        Plan inputs
      </SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, alignItems: 'start' }}>
        <NumberField label="Total capital" value={capital} onChange={setCapital} step={50000} min={0} suffix="₹" hint="Deployable portfolio size" />
        <NumberField label="Max single position" value={maxSinglePct} onChange={setMaxSinglePct} step={0.5} min={1} max={100} suffix="%" hint="Hard cap per name" />
        <NumberField label="Names to hold" value={numNames} onChange={setNumNames} step={1} min={1} max={100} hint="Top N by conviction" />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: C.t3, textTransform: 'uppercase', letterSpacing: 0.5 }}>Market-cap tilt</span>
          <span
            onClick={() => setApplyCapTilt(!applyCapTilt)}
            role="switch"
            aria-checked={applyCapTilt}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setApplyCapTilt(!applyCapTilt); } }}
            style={{
              cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 8,
              background: C.bg2, border: `1px solid ${applyCapTilt ? C.info : C.b2}`, borderRadius: 8, padding: '6px 10px',
            }}
          >
            <span style={{ width: 34, height: 18, borderRadius: 10, background: applyCapTilt ? C.info : C.bg4, position: 'relative', transition: 'background .2s', flex: '0 0 auto' }}>
              <span style={{ position: 'absolute', top: 2, left: applyCapTilt ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: C.t0, transition: 'left .2s' }} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: applyCapTilt ? C.t0 : C.t3 }}>{applyCapTilt ? 'On' : 'Off'}</span>
          </span>
          <span style={{ fontSize: 10.5, color: C.t4 }}>Heuristic size haircut</span>
        </label>
      </div>
    </Card>
  );
}

// ── formula / methodology ────────────────────────────────────────────────────
function Formula({ applyCapTilt }: { applyCapTilt: boolean }) {
  const code: React.CSSProperties = { ...NUM, color: C.cyan, fontSize: 11.5 };
  return (
    <Card style={{ marginTop: 16 }}>
      <SectionTitle hint="Every target weight below is fully derived from these steps — nothing is hand-set.">
        How target weights are computed
      </SectionTitle>
      <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: C.t2, lineHeight: 1.55 }}>
        <li>
          <b style={{ color: C.t1 }}>Blended conviction score</b>{' '}
          <span style={code}>= composite_score × tier × (1 + PEAD tilt + ROCE tilt)</span>
          <div style={{ fontSize: 11, color: C.t3, marginTop: 3 }}>
            tier weight: BLOCKBUSTER <b style={{ color: C.saffron }}>×{SIZING.TIER_WEIGHT.BLOCKBUSTER}</b>, STRONG <b style={{ color: C.cyan }}>×{SIZING.TIER_WEIGHT.STRONG}</b>.
            PEAD tilt up to <b>+{(SIZING.PEAD_TILT_MAX * 100).toFixed(0)}%</b> (pead_score / {SIZING.PEAD_FULL}), ROCE tilt up to <b>+{(SIZING.ROCE_TILT_MAX * 100).toFixed(0)}%</b> (ROCE / {SIZING.ROCE_FULL}%). Missing tilt inputs contribute 0.
          </div>
        </li>
        <li>
          <b style={{ color: C.t1 }}>Market-cap size haircut</b>{' '}
          <span style={{ fontSize: 11, color: applyCapTilt ? C.bull : C.t4, fontWeight: 700 }}>{applyCapTilt ? 'APPLIED' : 'OFF'}</span>
          <span style={{ fontSize: 10.5, color: C.warn, marginLeft: 6 }}>heuristic</span>
          <div style={{ fontSize: 11, color: C.t3, marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {CAP_BUCKETS.map((b) => (
              <span key={b.label} style={NUM}>
                {b.label} {b.minCr > 0 ? `≥₹${(b.minCr / 1000).toFixed(0)}k Cr` : `<₹${(CAP_BUCKETS[CAP_BUCKETS.length - 2].minCr / 1000).toFixed(0)}k Cr`} → ×{b.haircut}
              </span>
            ))}
            <span style={NUM}>unknown → ×{CAP_UNKNOWN_HAIRCUT}</span>
          </div>
          <div style={{ fontSize: 10.5, color: C.t4, marginTop: 2 }}>Larger caps can be sized larger; micro / small caps get a gentle trim. Toggle it off above to size on conviction alone.</div>
        </li>
        <li>
          <b style={{ color: C.t1 }}>Rank &amp; cut</b> — take the top <b>N</b> names by sizing score.
        </li>
        <li>
          <b style={{ color: C.t1 }}>Weights &amp; cap</b> — target weight ∝ sizing score, then each name is{' '}
          <b>capped at the max single-position %</b> and the excess is water-filled back to the uncapped names. Weights sum to 100% (or leave cash if N × cap &lt; 100%).
        </li>
      </ol>
    </Card>
  );
}

// ── body ─────────────────────────────────────────────────────────────────────
function Body({ plan, capital, applyCapTilt }: { plan: Plan; capital: number; applyCapTilt: boolean }) {
  const { rows, sectors, top5Weight, cashWeight, buyCount, rebalanceCount, droppedHeld } = plan;

  // guardrails
  const flags: { tone: 'bad' | 'warn'; text: string }[] = [];
  if (top5Weight > TOP5_FLAG) flags.push({ tone: top5Weight > 0.55 ? 'bad' : 'warn', text: `Top-5 targets are ${pct(top5Weight, 0)} of the book — concentrated. Consider a lower single-position cap or more names.` });
  for (const s of sectors) {
    if (s.weight > SECTOR_FLAG) flags.push({ tone: s.weight > 0.5 ? 'bad' : 'warn', text: `${s.sector} would be ${pct(s.weight, 0)} of the book — sector concentration above ${Math.round(SECTOR_FLAG * 100)}%.` });
  }
  if (cashWeight > 0.02) flags.push({ tone: 'warn', text: `${pct(cashWeight, 0)} of capital stays in cash — N × cap can't fill 100%. Raise the single-position cap or add names to deploy fully.` });

  const buyRows = rows.filter((r) => !r.held);
  const buyCapital = buyRows.reduce((a, r) => a + r.targetAmount, 0);
  const SEC_COLORS = [C.accent, C.cyan, C.saffron, C.purple, C.info, C.bull, C.bear, C.warn];

  return (
    <>
      <Formula applyCapTilt={applyCapTilt} />

      {/* summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginTop: 16 }}>
        <Tile label="Names in plan" value={rows.length} sub={`of your bench`} />
        <Tile label="Buy candidates" value={buyCount} sub={`${inr(buyCapital)} to deploy`} tone="good" />
        <Tile label="Rebalance (held)" value={rebalanceCount} sub={droppedHeld.length ? `${droppedHeld.length} held not in plan` : 'all held names kept'} tone="info" />
        <Tile label="Top-5 target" value={pct(top5Weight, 0)} tone={top5Weight > TOP5_FLAG ? 'warn' : undefined} sub="of the book" />
        <Tile label="Cash left" value={pct(cashWeight, 0)} tone={cashWeight > 0.02 ? 'warn' : 'good'} sub={cashWeight > 0.02 ? 'under-deployed' : 'fully deployed'} />
      </div>

      {/* guardrails */}
      <Card style={{ marginTop: 16 }}>
        <SectionTitle hint="Concentration checks on the PROPOSED book (top-5 and per-sector).">Concentration guardrails</SectionTitle>
        {flags.length === 0 ? (
          <div style={{ fontSize: 13, color: C.bull, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span aria-hidden>✓</span> No top-5 or sector concentration breaches in the proposed book.
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {flags.map((f, i) => (
              <li key={i} style={{ fontSize: 13, color: f.tone === 'bad' ? C.err : C.warn, lineHeight: 1.45 }}>{f.text}</li>
            ))}
          </ul>
        )}
      </Card>

      {/* sector allocation of proposed book */}
      <Card style={{ marginTop: 16 }}>
        <SectionTitle hint={`Aggregate target weight by sector. Any sector over ${Math.round(SECTOR_FLAG * 100)}% is flagged.`}>Proposed sector allocation</SectionTitle>
        {sectors.map((s, i) => (
          <Bar
            key={s.sector}
            label={s.sector}
            rightLabel={`${pct(s.weight)} · ${inr(s.weight * capital)}`}
            frac={s.weight}
            color={s.weight > SECTOR_FLAG ? C.err : SEC_COLORS[i % SEC_COLORS.length]}
            flagged={s.weight > SECTOR_FLAG}
          />
        ))}
      </Card>

      {/* held-but-dropped */}
      {droppedHeld.length > 0 ? (
        <Card style={{ marginTop: 16 }}>
          <SectionTitle hint="You hold these, but they did not make the top-N conviction cut — review for exit / trim.">Held names outside the plan</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {droppedHeld.map((s) => (
              <span key={s} style={{ ...NUM, fontSize: 12, background: C.bg2, border: `1px solid ${C.warn}`, color: C.t1, borderRadius: 6, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {s} <Chip text="REVIEW" color={C.warn} />
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {/* the plan table */}
      <Card style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 16, paddingBottom: 8 }}>
          <SectionTitle hint="Full allocation plan. BUY = new position, ADD / TRIM = rebalance a held name toward target, HOLD = already at target.">Allocation plan</SectionTitle>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
            <thead>
              <tr style={{ background: C.bg3, color: C.t3 }}>
                {[
                  ['#', 'left'], ['Ticker', 'left'], ['Tier', 'left'], ['Conv.', 'right'], ['Cap', 'left'],
                  ['Target %', 'right'], ['Target ₹', 'right'], ['Current %', 'right'], ['Δ pts', 'right'],
                  ['Action', 'left'], ['Sector', 'left'],
                ].map(([h, align]) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: align as any, fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <Row key={r.ticker} r={r} />)}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ fontSize: 11, color: C.t4, marginTop: 14, lineHeight: 1.5 }}>
        Target weights are conviction-proportional, capped and redistributed as shown in the methodology. Current weights use live market value where a quote matched, otherwise entry price × quantity. The market-cap size haircut is a labelled heuristic, not a risk model. This is a planning aid, not investment advice.
      </div>
    </>
  );
}

function Row({ r }: { r: PlanRow }) {
  return (
    <tr style={{ borderTop: `1px solid ${C.b3}` }}>
      <td style={{ padding: '8px 12px', color: C.t3, ...NUM }}>{r.rank}</td>
      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: C.t0, fontWeight: 700 }}>{r.ticker}</span>
          <OwnBadge symbol={r.ticker} />
        </span>
        <div style={{ fontSize: 10.5, color: C.t4, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</div>
      </td>
      <td style={{ padding: '8px 12px' }}><Chip text={r.tier} color={TIER_COLOR[r.tier] || C.t3} /></td>
      <td style={{ padding: '8px 12px', textAlign: 'right', color: C.t2, ...NUM }} title={`blended ${r.blended.toFixed(1)} · sizing ${r.sizingScore.toFixed(1)}`}>{num(r.compositeScore, 0)}</td>
      <td style={{ padding: '8px 12px', color: C.t3, whiteSpace: 'nowrap', fontSize: 11 }}>
        {r.capBucket ? <span style={NUM}>{r.capBucket}{r.haircut !== 1 ? ` ×${r.haircut}` : ''}</span> : '—'}
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right', color: C.t0, fontWeight: 700, ...NUM }}>{pct(r.targetWeight)}</td>
      <td style={{ padding: '8px 12px', textAlign: 'right', color: C.t1, ...NUM }}>{inr(r.targetAmount)}</td>
      <td style={{ padding: '8px 12px', textAlign: 'right', color: r.currentWeight == null ? C.t4 : C.t2, ...NUM }}>{r.currentWeight == null ? '—' : pct(r.currentWeight)}</td>
      <td style={{ padding: '8px 12px', textAlign: 'right', ...NUM, color: r.deltaPct == null ? C.t4 : r.deltaPct > 0.5 ? C.info : r.deltaPct < -0.5 ? C.warn : C.t3 }}>
        {r.deltaPct == null ? '—' : pctPts(r.deltaPct)}
      </td>
      <td style={{ padding: '8px 12px' }}><Chip text={r.action} color={ACTION_COLOR[r.action]} /></td>
      <td style={{ padding: '8px 12px', color: C.t2, whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sector}</td>
    </tr>
  );
}
