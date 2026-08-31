'use client';

// ═══════════════════════════════════════════════════════════════════════════
// THE COFFEE CAN — a buy-and-forget sleeve
//
// Robert Kirby's "Coffee Can Portfolio": you put your highest-conviction
// compounders in a can, seal it, and DON'T touch it for a decade or more. No
// trimming, no timing, no fiddling — the discipline of inaction is the edge.
//
// This page is a curated SUBSET of the user's book (mc_portfolio_holdings).
// The user flags which holdings belong in the can; the can then celebrates
// long holding periods (multiple ×, implied CAGR, years held) and makes
// "don't touch" the easy path:
//   • Removal is a deliberate two-click Remove → Confirm (window.confirm is
//     blocked in this shell), framed by a lock/sealed-jar motif.
//   • The only recurring action is a once-a-year review nudge — otherwise the
//     visual tone (calm, muted, unhurried) discourages any interaction at all.
//
// All persistence is client-only and SSR-guarded; live prices come from the
// same /api/market/quotes feed Home/Movers use (india for ₹, us for $).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  readCoffeeCan,
  addToCoffeeCan,
  removeFromCoffeeCan,
  markCoffeeCanReviewed,
  type CoffeeCanState,
} from '@/lib/coffeecan-store';

// ── Theme tokens (CSS variables only — light/dark aware) ─────────────────────
const C = {
  bg0: 'var(--mc-bg-0)',
  bg1: 'var(--mc-bg-1)',
  bg2: 'var(--mc-bg-2)',
  bg3: 'var(--mc-bg-3)',
  bg4: 'var(--mc-bg-4)',
  text0: 'var(--mc-text-0)',
  text1: 'var(--mc-text-1)',
  text2: 'var(--mc-text-2)',
  text3: 'var(--mc-text-3)',
  text4: 'var(--mc-text-4)',
  border1: 'var(--mc-border-1)',
  border2: 'var(--mc-border-2)',
  border3: 'var(--mc-border-3)',
  bull: 'var(--mc-bullish)',
  bear: 'var(--mc-bearish)',
  warn: 'var(--mc-warn)',
  err: 'var(--mc-err)',
  info: 'var(--mc-info)',
  accent: 'var(--mc-accent)',
  cyan: 'var(--mc-cyan)',
  saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
};

const MONO = 'ui-monospace,"SF Mono",Menlo,monospace';
const NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const MS_PER_MONTH = MS_PER_YEAR / 12;

// ── Local types ──────────────────────────────────────────────────────────────
interface Holding {
  symbol: string;
  entryPrice: number;
  quantity: number;
  weight?: number;
  addedAt?: string;
  notes?: string;
}

interface Quote {
  price: number;
  changePercent?: number;
  yearHigh?: number;
}

interface CanRow {
  symbol: string;
  holding: Holding;
  entry: number;
  qty: number;
  price: number | null;        // live current price (null if not matched)
  ccy: '₹' | '$';
  multiple: number | null;
  retPct: number | null;
  years: number;               // years held (from can addedAt / holding addedAt)
  cagr: number | null;         // implied CAGR, null when too new
  tooNew: boolean;
  reviewDue: boolean;
  sealedAt: string | null;     // ISO the name entered the can
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function norm(s: string): string {
  return (s || '').toUpperCase().trim().replace(/\.(NS|BO)$/i, '');
}

function readHoldings(): Holding[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('mc_portfolio_holdings');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((h: any) => ({
        symbol: norm(String(h?.symbol || '')),
        entryPrice: Number(h?.entryPrice) || 0,
        quantity: Number(h?.quantity) || 0,
        weight: typeof h?.weight === 'number' ? h.weight : undefined,
        addedAt: typeof h?.addedAt === 'string' ? h.addedAt : undefined,
        notes: typeof h?.notes === 'string' ? h.notes : undefined,
      }))
      .filter((h: Holding) => !!h.symbol);
  } catch {
    return [];
  }
}

async function fetchQuoteMap(): Promise<{ india: Map<string, Quote>; us: Map<string, Quote> }> {
  const parse = async (market: 'india' | 'us'): Promise<Map<string, Quote>> => {
    const map = new Map<string, Quote>();
    try {
      const r = await fetch(`/api/market/quotes?market=${market}`, { cache: 'no-store' });
      if (!r.ok) return map;
      const j: any = await r.json();
      const stocks: any[] = Array.isArray(j?.stocks) ? j.stocks : [];
      for (const s of stocks) {
        const t = norm(String(s?.ticker || ''));
        if (!t) continue;
        map.set(t, {
          price: Number(s?.price) || 0,
          changePercent: typeof s?.changePercent === 'number' ? s.changePercent : undefined,
          yearHigh: s?.yearHigh ?? s?.week52High ?? undefined,
        });
      }
    } catch {
      /* leave map empty */
    }
    return map;
  };
  const [india, us] = await Promise.all([parse('india'), parse('us')]);
  return { india, us };
}

function fmtNum(v: number | null | undefined, dp = 2): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtYears(y: number): string {
  if (y < 1 / 12) return '< 1 mo';
  if (y < 1) return `${Math.round(y * 12)} mo`;
  return `${y.toFixed(1)} yr`;
}

function retColor(retPct: number | null): string {
  if (retPct == null) return C.text3;
  if (retPct > 0.5) return C.bull;
  if (retPct < -0.5) return C.bear;
  return C.text2;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CoffeeCanPage() {
  const [mounted, setMounted] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [can, setCan] = useState<CoffeeCanState>({ tickers: [], addedAt: {}, reviewedAt: {} });
  const [indiaQ, setIndiaQ] = useState<Map<string, Quote>>(new Map());
  const [usQ, setUsQ] = useState<Map<string, Quote>>(new Map());
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // Reload local state (holdings + can) from storage.
  const reloadLocal = useCallback(() => {
    setHoldings(readHoldings());
    setCan(readCoffeeCan());
  }, []);

  // Mount: read local state, wire up cross-surface listeners.
  useEffect(() => {
    setMounted(true);
    reloadLocal();
    if (typeof window === 'undefined') return;
    const onCan = () => setCan(readCoffeeCan());
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'mc_portfolio_holdings' || e.key === 'mc:coffeecan:v1') reloadLocal();
    };
    window.addEventListener('coffeecan:updated', onCan);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('coffeecan:updated', onCan);
      window.removeEventListener('storage', onStorage);
    };
  }, [reloadLocal]);

  // Mount: fetch live quotes once.
  useEffect(() => {
    let alive = true;
    setQuotesLoading(true);
    fetchQuoteMap().then(({ india, us }) => {
      if (!alive) return;
      setIndiaQ(india);
      setUsQ(us);
      setQuotesLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const canSet = useMemo(() => new Set(can.tickers), [can.tickers]);

  // Holdings partitioned into "in the can" and "in the book but not yet canned".
  const { canHoldings, bookHoldings } = useMemo(() => {
    const inCan: Holding[] = [];
    const inBook: Holding[] = [];
    for (const h of holdings) {
      if (canSet.has(h.symbol)) inCan.push(h);
      else inBook.push(h);
    }
    return { canHoldings: inCan, bookHoldings: inBook };
  }, [holdings, canSet]);

  const now = Date.now();

  // Enriched rows for each canned holding.
  const rows: CanRow[] = useMemo(() => {
    return canHoldings.map((h): CanRow => {
      const inIndia = indiaQ.get(h.symbol);
      const inUs = usQ.get(h.symbol);
      const matched = inIndia || inUs;
      const ccy: '₹' | '$' = inIndia ? '₹' : inUs ? '$' : '₹';
      const price = matched && matched.price > 0 ? matched.price : null;

      // years held — coffee-can seal date, fallback the holding's own addedAt.
      const sealedAt = can.addedAt[h.symbol] || h.addedAt || null;
      const sealMs = sealedAt ? Date.parse(sealedAt) : NaN;
      const years = isFinite(sealMs) ? Math.max(0, (now - sealMs) / MS_PER_YEAR) : 0;

      const multiple = price != null && h.entryPrice > 0 ? price / h.entryPrice : null;
      const retPct = multiple != null ? (multiple - 1) * 100 : null;

      const tooNew = years < 0.5;
      const cagr = !tooNew && multiple != null && multiple > 0 ? Math.pow(multiple, 1 / years) - 1 : null;

      // annual review — due when now − (reviewedAt ?? sealedAt) > 12 months.
      const revAt = can.reviewedAt?.[h.symbol] || sealedAt || null;
      const revMs = revAt ? Date.parse(revAt) : NaN;
      const reviewDue = isFinite(revMs) ? now - revMs > 12 * MS_PER_MONTH : false;

      return {
        symbol: h.symbol,
        holding: h,
        entry: h.entryPrice,
        qty: h.quantity,
        price,
        ccy,
        multiple,
        retPct,
        years,
        cagr,
        tooNew,
        reviewDue,
        sealedAt,
      };
    });
  }, [canHoldings, indiaQ, usQ, can.addedAt, can.reviewedAt, now]);

  // Summary tiles.
  const summary = useMemo(() => {
    let value = 0;
    let costOfPriced = 0;
    let valueOfPriced = 0;
    let oldest = 0;
    let dueCount = 0;
    for (const r of rows) {
      if (r.price != null) {
        value += r.price * r.qty;
        valueOfPriced += r.price * r.qty;
        costOfPriced += r.entry * r.qty;
      }
      if (r.years > oldest) oldest = r.years;
      if (r.reviewDue) dueCount += 1;
    }
    const blended = costOfPriced > 0 ? valueOfPriced / costOfPriced : null;
    return { value, blended, count: rows.length, oldest, dueCount };
  }, [rows]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const onAdd = useCallback((symbol: string) => {
    addToCoffeeCan(symbol);
    setCan(readCoffeeCan());
  }, []);

  const onConfirmRemove = useCallback((symbol: string) => {
    removeFromCoffeeCan(symbol);
    setCan(readCoffeeCan());
    setConfirmRemove(null);
  }, []);

  const onReviewed = useCallback((symbol: string) => {
    markCoffeeCanReviewed(symbol);
    setCan(readCoffeeCan());
  }, []);

  // Avoid hydration mismatch — nothing storage-derived renders until mounted.
  if (!mounted) {
    return (
      <div style={{ minHeight: '100%', backgroundColor: C.bg0, padding: 24 }}>
        <div style={{ color: C.text3, fontSize: 13 }}>Opening the coffee can…</div>
      </div>
    );
  }

  const hasHoldings = holdings.length > 0;
  const canEmpty = rows.length === 0;

  return (
    <div style={{ minHeight: '100%', backgroundColor: C.bg0, color: C.text0, padding: '20px 20px 64px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.2px', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden style={{ fontSize: 24 }}>🫙</span>
            The Coffee Can
          </h1>
          <span
            style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase',
              color: C.purple, border: `1px solid ${C.border2}`, borderRadius: 999,
              padding: '3px 9px', display: 'inline-flex', alignItems: 'center', gap: 5,
            }}
          >
            <span aria-hidden>🔒</span> Sealed · buy &amp; forget
          </span>
        </div>
        <p style={{ color: C.text3, fontSize: 12.5, lineHeight: 1.55, margin: '0 0 20px', maxWidth: 720 }}>
          Your highest-conviction compounders go in the can and stay there for a decade or more. The
          discipline is inaction: no trimming, no timing. Review each name once a year — otherwise,
          leave it alone and let time do the compounding.
        </p>

        {/* ── Summary tiles ──────────────────────────────────────────────── */}
        {!canEmpty && (
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 10, marginBottom: 24,
            }}
          >
            <Tile label="Can value" value={summary.value > 0 ? `₹${fmtNum(summary.value, 0)}` : '—'} hint="Σ qty × current" />
            <Tile
              label="Blended multiple"
              value={summary.blended != null ? `${fmtNum(summary.blended, 2)}×` : '—'}
              hint="value ÷ Σ qty × entry"
              accent={summary.blended != null && summary.blended >= 1 ? C.bull : summary.blended != null ? C.bear : undefined}
            />
            <Tile label="Holdings" value={String(summary.count)} hint="names sealed" />
            <Tile label="Oldest hold" value={summary.oldest > 0 ? fmtYears(summary.oldest) : '—'} hint="longest sealed" />
            <Tile
              label="Review due"
              value={String(summary.dueCount)}
              hint="past 12 months"
              accent={summary.dueCount > 0 ? C.warn : C.text3}
            />
          </div>
        )}

        {quotesLoading && (
          <div style={{ color: C.text4, fontSize: 11.5, marginBottom: 14, fontFamily: MONO }}>
            fetching live prices…
          </div>
        )}

        {/* ── Empty state ────────────────────────────────────────────────── */}
        {canEmpty && (
          <div
            style={{
              backgroundColor: C.bg2, border: `1px solid ${C.border1}`, borderRadius: 12,
              padding: '28px 24px', marginBottom: 24,
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden>🫙</div>
            <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 8, color: C.text0 }}>
              Your coffee can is empty
            </div>
            <p style={{ color: C.text3, fontSize: 12.5, lineHeight: 1.6, margin: '0 0 16px', maxWidth: 640 }}>
              The coffee-can idea is simple and old: pick a handful of businesses you would be happy to
              own for 10–20 years, put them in the can, and never look at the lid again. Historically
              the untouched names — the ones investors forgot they held — did the heavy lifting.
              Flag your first true multi-decade hold below to seal it in.
            </p>
            {hasHoldings ? (
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: C.text4, marginBottom: 8 }}>
                  Add from your book
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {bookHoldings.map((h) => (
                    <AddChip key={h.symbol} symbol={h.symbol} onAdd={onAdd} />
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ color: C.text4, fontSize: 12, fontStyle: 'italic' }}>
                No portfolio holdings found yet. Add positions to your book first, then seal your
                best compounders into the can.
              </div>
            )}
          </div>
        )}

        {/* ── The Coffee Can (flagged holdings) ──────────────────────────── */}
        {!canEmpty && (
          <section style={{ marginBottom: 28 }}>
            <SectionHead icon="🔒" title="The Coffee Can" sub={`${rows.length} sealed · do not touch`} />
            <div style={{ display: 'grid', gap: 12 }}>
              {rows.map((r) => (
                <CanCard
                  key={r.symbol}
                  row={r}
                  confirming={confirmRemove === r.symbol}
                  onStartRemove={() => setConfirmRemove(r.symbol)}
                  onCancelRemove={() => setConfirmRemove(null)}
                  onConfirmRemove={() => onConfirmRemove(r.symbol)}
                  onReviewed={() => onReviewed(r.symbol)}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Add from your book ─────────────────────────────────────────── */}
        {!canEmpty && bookHoldings.length > 0 && (
          <section>
            <SectionHead icon="📚" title="Add from your book" sub={`${bookHoldings.length} not yet sealed`} />
            <p style={{ color: C.text4, fontSize: 11.5, lineHeight: 1.5, margin: '0 0 12px', maxWidth: 620 }}>
              Only add a name here if you genuinely intend to hold it for a decade. Once sealed, the
              can is designed to make it hard to touch.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {bookHoldings.map((h) => (
                <AddChip key={h.symbol} symbol={h.symbol} onAdd={onAdd} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHead({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
      <span aria-hidden style={{ fontSize: 15 }}>{icon}</span>
      <h2 style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.2px', margin: 0, color: C.text0 }}>{title}</h2>
      <span style={{ fontSize: 11, color: C.text4, fontFamily: MONO }}>{sub}</span>
    </div>
  );
}

function Tile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div
      style={{
        backgroundColor: C.bg2, border: `1px solid ${C.border1}`, borderRadius: 10,
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: C.text4, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: accent || C.text0, ...NUM, fontFamily: MONO }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: C.text4, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function AddChip({ symbol, onAdd }: { symbol: string; onAdd: (s: string) => void }) {
  return (
    <button
      onClick={() => onAdd(symbol)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        backgroundColor: C.bg3, border: `1px solid ${C.border1}`, color: C.text1,
        borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        fontFamily: MONO, ...NUM,
      }}
      title={`Seal ${symbol} into the coffee can`}
    >
      <span aria-hidden style={{ color: C.text4 }}>+</span>
      {symbol}
    </button>
  );
}

function CanCard({
  row,
  confirming,
  onStartRemove,
  onCancelRemove,
  onConfirmRemove,
  onReviewed,
}: {
  row: CanRow;
  confirming: boolean;
  onStartRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
  onReviewed: () => void;
}) {
  const rc = retColor(row.retPct);
  const notMatched = row.price == null;

  return (
    <div
      style={{
        backgroundColor: C.bg2,
        border: `1px solid ${row.reviewDue ? C.warn : C.border1}`,
        borderLeft: `3px solid ${C.purple}`,
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      {/* Top row: identity + review status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span aria-hidden style={{ fontSize: 14 }}>🔒</span>
        <span style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, letterSpacing: '0.3px' }}>{row.symbol}</span>
        {row.sealedAt && (
          <span style={{ fontSize: 10.5, color: C.text4, fontFamily: MONO }}>
            sealed {new Date(row.sealedAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'short' })}
          </span>
        )}
        {row.reviewDue ? (
          <span
            style={{
              marginLeft: 'auto', fontSize: 10, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase',
              color: C.warn, border: `1px solid ${C.warn}`, borderRadius: 999, padding: '2px 8px',
            }}
          >
            ⏳ Review due
          </span>
        ) : (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: C.text4, fontFamily: MONO }}>reviewed within 12 mo</span>
        )}
      </div>

      {/* Metrics grid */}
      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
          gap: 10, marginBottom: 12,
        }}
      >
        <Metric label="Entry" value={`${row.ccy}${fmtNum(row.entry)}`} />
        <Metric label="Current" value={notMatched ? '—' : `${row.ccy}${fmtNum(row.price)}`} muted={notMatched} />
        <Metric
          label="Multiple"
          value={row.multiple != null ? `${fmtNum(row.multiple, 2)}×` : '—'}
          color={row.multiple != null ? rc : undefined}
        />
        <Metric
          label="Return"
          value={row.retPct != null ? `${row.retPct >= 0 ? '+' : ''}${fmtNum(row.retPct, 1)}%` : '—'}
          color={rc}
        />
        <Metric label="Years held" value={fmtYears(row.years)} />
        <Metric
          label="Implied CAGR"
          value={row.tooNew ? '—' : row.cagr != null ? `${row.cagr >= 0 ? '+' : ''}${fmtNum(row.cagr * 100, 1)}%` : '—'}
          color={row.tooNew || row.cagr == null ? undefined : row.cagr >= 0 ? C.bull : C.bear}
          hint={row.tooNew ? 'too new' : undefined}
        />
      </div>

      {notMatched && (
        <div style={{ fontSize: 10.5, color: C.text4, marginBottom: 10, fontStyle: 'italic' }}>
          No live quote matched for {row.symbol} — showing entry only.
        </div>
      )}

      {/* Actions — deliberate two-click removal; calm review nudge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {row.reviewDue && (
          <button
            onClick={onReviewed}
            style={{
              backgroundColor: 'transparent', border: `1px solid ${C.warn}`, color: C.warn,
              borderRadius: 6, padding: '5px 11px', fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
            }}
          >
            ✓ Mark reviewed
          </button>
        )}
        {!row.reviewDue && (
          <button
            onClick={onReviewed}
            style={{
              backgroundColor: 'transparent', border: `1px solid ${C.border1}`, color: C.text3,
              borderRadius: 6, padding: '5px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Log annual review
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {!confirming ? (
            <button
              onClick={onStartRemove}
              style={{
                backgroundColor: 'transparent', border: `1px solid ${C.border1}`, color: C.text4,
                borderRadius: 6, padding: '5px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              }}
              title="Break the seal (requires confirmation)"
            >
              🔓 Remove
            </button>
          ) : (
            <>
              <span style={{ fontSize: 11, color: C.text3 }}>Break the seal?</span>
              <button
                onClick={onCancelRemove}
                style={{
                  backgroundColor: 'transparent', border: `1px solid ${C.border1}`, color: C.text2,
                  borderRadius: 6, padding: '5px 11px', fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                }}
              >
                Keep sealed
              </button>
              <button
                onClick={onConfirmRemove}
                style={{
                  backgroundColor: 'transparent', border: `1px solid ${C.bear}`, color: C.bear,
                  borderRadius: 6, padding: '5px 11px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Confirm remove
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  color,
  muted,
  hint,
}: {
  label: string;
  value: string;
  color?: string;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: C.text4, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color: muted ? C.text4 : color || C.text1, ...NUM }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 9.5, color: C.text4, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
