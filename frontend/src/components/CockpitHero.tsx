'use client';

// ════════════════════════════════════════════════════════════════════════════
// CockpitHero (zzz532) — the "wow on open" band at the top of the home page.
// A row of premium stat tiles that tell the whole session's story at a glance:
//   • BOOK        — value per currency, day P&L, total P&L (institutional)
//   • REGIME      — India + US market regime pills with drawdown
//   • BREADTH     — advancers/decliners gauge across the live universe
//   • POSITIONS   — holdings, winners/losers, how many sit at rising support
//
// Zero new infrastructure. It reads engine views (localStorage) synchronously
// so the band paints instantly, then enriches from the SHARED, deduped quote
// feed (lib/quotes-shared — one fetch shared with every other widget) and the
// regime cache the RegimeBanner already writes. SSR-safe, alive-guarded,
// abortable, fully theme-tokenised, and every tile degrades to "—" on its own.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import { getEngineViews, type EngineView, type Market } from '@/lib/engines';
import { getQuoteMap, type Quote } from '@/lib/quotes-shared';
import { fmtMoney } from '@/lib/sizing';

const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

// ── regime cache (written by RegimeBanner) ──────────────────────────────────
type RegimeKind = 'BULL' | 'PULLBACK' | 'CORRECTION' | 'BEAR' | 'RECOVERY' | 'UNKNOWN';
interface MiniRegime { kind: RegimeKind; drawdownPct: number | null }
const REGIME_KEY = 'mc:regime:v1';
const REGIME_COLOR: Record<RegimeKind, string> = {
  BULL: 'var(--mc-bullish)',
  PULLBACK: 'var(--mc-cyan)',
  CORRECTION: 'var(--mc-warn)',
  BEAR: 'var(--mc-bearish)',
  RECOVERY: 'var(--mc-state-persistent, #A78BFA)',
  UNKNOWN: 'var(--mc-text-4)',
};

function readRegime(): { india: MiniRegime; usa: MiniRegime } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REGIME_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const d = p?.data;
    if (!d?.india || !d?.usa) return null;
    return { india: toMini(d.india), usa: toMini(d.usa) };
  } catch { return null; }
}

// map a raw market-regime object (from cache or the API) to the mini shape
function toMini(m: any): MiniRegime {
  return {
    kind: (['BULL', 'PULLBACK', 'CORRECTION', 'BEAR', 'RECOVERY'].includes(m?.kind) ? m.kind : 'UNKNOWN') as RegimeKind,
    drawdownPct: typeof m?.drawdownPct === 'number' && Number.isFinite(m.drawdownPct) ? m.drawdownPct : null,
  };
}

// ── shape the whole band computes ───────────────────────────────────────────
interface HeroModel {
  book: Record<Market, { value: number; dayPct: number | null; totalPct: number | null; n: number }>;
  holdings: number;
  winners: number;
  losers: number;
  atSupport: number;
  breadth: { adv: number; dec: number; flat: number } | null;
  regime: { india: MiniRegime; usa: MiniRegime } | null;
}

const EMPTY_MKT = { value: 0, dayPct: null as number | null, totalPct: null as number | null, n: 0 };

function assemble(views: EngineView[], quotes: Map<string, Quote> | null, regime: HeroModel['regime']): HeroModel {
  const held = views.filter((v) => v.holding);
  const book: Record<Market, { value: number; dayPct: number | null; totalPct: number | null; n: number }> = {
    IND: { ...EMPTY_MKT }, USA: { ...EMPTY_MKT },
  };
  // per-currency value-weighted day & total P&L (never mix ₹ and $)
  const acc: Record<Market, { v: number; dayW: number; dayWv: number; totW: number; totWv: number; n: number }> = {
    IND: { v: 0, dayW: 0, dayWv: 0, totW: 0, totWv: 0, n: 0 },
    USA: { v: 0, dayW: 0, dayWv: 0, totW: 0, totWv: 0, n: 0 },
  };
  let winners = 0, losers = 0, atSupport = 0;
  for (const v of held) {
    const mk: Market = v.market === 'USA' ? 'USA' : 'IND';
    const a = acc[mk];
    a.n += 1;
    const h = v.holding!;
    const q = quotes?.get(v.symbol);
    const live = q && Number.isFinite(q.price) && q.price > 0 ? q.price : null;
    const qty = typeof h.quantity === 'number' && Number.isFinite(h.quantity) ? h.quantity : null;
    const entry = typeof h.entryPrice === 'number' && Number.isFinite(h.entryPrice) && h.entryPrice > 0 ? h.entryPrice : null;
    // zzz536 — derive book value from qty × live price when the store has no currentValue
    // (the user may not have opened /portfolio to populate it), then fall back to cost basis.
    let cv = typeof h.currentValue === 'number' && Number.isFinite(h.currentValue) && h.currentValue > 0 ? h.currentValue : null;
    if (cv == null && qty != null && live != null) cv = qty * live;
    if (cv == null && qty != null && entry != null) cv = qty * entry;
    // total P&L %: stored, else derived from live vs entry
    let tot = typeof h.pnlPercent === 'number' && Number.isFinite(h.pnlPercent) ? h.pnlPercent : null;
    if (tot == null && live != null && entry != null) tot = (live / entry - 1) * 100;
    if (cv != null && cv > 0) {
      a.v += cv;
      if (tot != null) { a.totW += cv; a.totWv += cv * tot; }
      if (q && q.changePercent != null && Number.isFinite(q.changePercent)) { a.dayW += cv; a.dayWv += cv * q.changePercent; }
    }
    if (tot != null) { if (tot >= 0) winners += 1; else losers += 1; }
    // at rising support: live (or synced) price within 5% ABOVE the 200DMA
    const t = v.tech;
    const px = live ?? t?.price ?? null;
    if (t?.sma200 != null && t.sma200 > 0 && px != null && px > t.sma200 && (px - t.sma200) / t.sma200 <= 0.05) atSupport += 1;
  }
  (['IND', 'USA'] as Market[]).forEach((mk) => {
    const a = acc[mk];
    book[mk] = {
      value: a.v,
      dayPct: a.dayW > 0 ? a.dayWv / a.dayW : null,
      totalPct: a.totW > 0 ? a.totWv / a.totW : null,
      n: a.n,
    };
  });

  let breadth: HeroModel['breadth'] = null;
  if (quotes && quotes.size > 0) {
    let adv = 0, dec = 0, flat = 0;
    for (const q of quotes.values()) {
      if (q.changePercent == null || !Number.isFinite(q.changePercent)) continue;
      if (q.changePercent > 0.05) adv += 1; else if (q.changePercent < -0.05) dec += 1; else flat += 1;
    }
    if (adv + dec + flat > 0) breadth = { adv, dec, flat };
  }

  return { book, holdings: held.length, winners, losers, atSupport, breadth, regime };
}

// ── small presentational atoms ──────────────────────────────────────────────
function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-4)' }}>{label} —</span>;
  const up = pct >= 0;
  const c = up ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
  return (
    <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 800, color: c }}>
      {label} {up ? '▲' : '▼'}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function TileShell({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div
      className="mc-stat-card mc-lift mc-accent-top"
      style={{ padding: '12px 14px', minWidth: 0, ...(accent ? ({ ['--mc-accent-top-color' as any]: accent }) : {}) }}
    >
      <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 900, letterSpacing: 1.2, color: 'var(--mc-text-3)', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Skel({ w = 70, h = 18 }: { w?: number; h?: number }) {
  return <span className="mc-shimmer" style={{ display: 'inline-block', width: w, height: h }} />;
}

export default function CockpitHero() {
  const [views, setViews] = useState<EngineView[] | null>(null);
  const [quotes, setQuotes] = useState<Map<string, Quote> | null>(null);
  const [regime, setRegime] = useState<HeroModel['regime']>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    // instant paint from synced engine views + cached regime
    try { setViews(Array.from(getEngineViews().values())); } catch { setViews([]); }
    setRegime(readRegime());
    // enrich from the shared, deduped quote feed (one fetch shared app-wide)
    (async () => {
      try {
        const qm = await getQuoteMap();
        if (aliveRef.current) setQuotes(qm);
      } catch { /* keep synced view */ }
    })();
    // if no cached regime yet, fetch once (aborts on unmount)
    let ctl: AbortController | null = null;
    if (!readRegime()) {
      ctl = new AbortController();
      const timer = setTimeout(() => ctl?.abort(), 15000);
      (async () => {
        try {
          const r = await fetch('/api/market/regime', { signal: ctl!.signal });
          if (!r.ok) return;
          const j = await r.json();
          // build from the response directly — our fetch doesn't write RegimeBanner's cache
          if (aliveRef.current && j?.india && j?.usa) setRegime({ india: toMini(j.india), usa: toMini(j.usa) });
        } catch { /* leave regime null */ }
        finally { clearTimeout(timer); }
      })();
    }
    // pick up regime once RegimeBanner writes its cache
    const onFocus = () => { const r = readRegime(); if (r && aliveRef.current) setRegime(r); };
    window.addEventListener('focus', onFocus);
    return () => { aliveRef.current = false; ctl?.abort(); window.removeEventListener('focus', onFocus); };
  }, []);

  const m = useMemo(() => views ? assemble(views, quotes, regime) : null, [views, quotes, regime]);
  const loadingQuotes = quotes == null;

  if (!m) {
    return (
      <div style={heroGrid}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mc-stat-card" style={{ padding: '12px 14px' }}><Skel w={120} h={26} /></div>
        ))}
      </div>
    );
  }

  const markets = (['IND', 'USA'] as Market[]).filter((mk) => m.book[mk].n > 0);
  const bookAccent = markets.some((mk) => (m.book[mk].dayPct ?? 0) < 0) ? 'var(--mc-bearish)' : 'var(--mc-bullish)';

  // breadth gauge geometry
  const b = m.breadth;
  const total = b ? b.adv + b.dec + b.flat : 0;
  const advPct = b && total ? (b.adv / total) * 100 : 0;
  const decPct = b && total ? (b.dec / total) * 100 : 0;
  const breadthColor = advPct >= 55 ? 'var(--mc-bullish)' : advPct <= 40 ? 'var(--mc-bearish)' : 'var(--mc-warn)';

  return (
    <div style={heroGrid}>
      {/* ── BOOK ─────────────────────────────────────────────────────────── */}
      <TileShell title="YOUR BOOK" accent={bookAccent}>
        {m.holdings === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 12, color: 'var(--mc-text-4)', fontWeight: 700 }}>
            no positions yet — add holdings in <span style={{ color: 'var(--mc-cyan)' }}>My Book</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
              {markets.map((mk) => (
                <div key={mk} style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: MONO, fontSize: markets.length > 1 ? 17 : 22, fontWeight: 900, color: 'var(--mc-text-0)', lineHeight: 1.1, letterSpacing: -0.5 }}>
                    {m.book[mk].value > 0 ? fmtMoney(m.book[mk].value, mk) : <span style={{ color: 'var(--mc-text-4)' }}>{mk === 'USA' ? '$' : '₹'}—</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 3, alignItems: 'baseline' }}>
                    {loadingQuotes ? <Skel w={46} h={11} /> : <Delta pct={m.book[mk].dayPct} label="day" />}
                    <Delta pct={m.book[mk].totalPct} label="all" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </TileShell>

      {/* ── REGIME ───────────────────────────────────────────────────────── */}
      <TileShell title="MARKET REGIME" accent={m.regime ? REGIME_COLOR[m.regime.india.kind] : undefined}>
        {!m.regime ? (
          <div style={{ display: 'flex', gap: 8 }}><Skel w={90} h={22} /><Skel w={90} h={22} /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {([['🇮🇳', m.regime.india], ['🇺🇸', m.regime.usa]] as const).map(([flag, r]) => (
              <div key={flag} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12 }}>{flag}</span>
                <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 900, color: REGIME_COLOR[r.kind], letterSpacing: 0.4 }}>{r.kind}</span>
                {r.drawdownPct != null && (
                  <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700 }}>
                    {r.drawdownPct <= 0 ? `${r.drawdownPct.toFixed(1)}% off hi` : 'at highs'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </TileShell>

      {/* ── BREADTH ──────────────────────────────────────────────────────── */}
      <TileShell title="MARKET BREADTH" accent={breadthColor}>
        {!b ? (
          <div><Skel w={130} h={16} /><div style={{ marginTop: 8 }}><Skel w={90} h={10} /></div></div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 900, color: breadthColor, lineHeight: 1, letterSpacing: -0.5 }}>{advPct.toFixed(0)}%</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700 }}>advancing</span>
            </div>
            {/* split gauge */}
            <div style={{ display: 'flex', height: 8, borderRadius: 5, overflow: 'hidden', marginTop: 9, background: 'var(--mc-bg-3)', border: '1px solid var(--mc-border-1)' }}>
              <div style={{ width: `${advPct}%`, background: 'var(--mc-bullish)' }} />
              <div style={{ width: `${100 - advPct - decPct}%`, background: 'var(--mc-text-4)', opacity: 0.4 }} />
              <div style={{ width: `${decPct}%`, background: 'var(--mc-bearish)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: MONO, fontSize: 9.5, fontWeight: 800 }}>
              <span style={{ color: 'var(--mc-bullish)' }}>▲ {b.adv}</span>
              <span style={{ color: 'var(--mc-text-4)' }}>{total} names</span>
              <span style={{ color: 'var(--mc-bearish)' }}>▼ {b.dec}</span>
            </div>
          </>
        )}
      </TileShell>

      {/* ── POSITIONS ────────────────────────────────────────────────────── */}
      <TileShell title="POSITIONS" accent="var(--mc-cyan)">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 900, color: 'var(--mc-text-0)', lineHeight: 1 }}>{m.holdings}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 700 }}>held</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 9, flexWrap: 'wrap' }}>
          {(m.winners + m.losers) > 0 ? (
            <>
              <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 800, color: 'var(--mc-bullish)' }}>▲ {m.winners} up</span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 800, color: 'var(--mc-bearish)' }}>▼ {m.losers} down</span>
            </>
          ) : (
            <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: 'var(--mc-text-4)' }}>P&amp;L pending live prices</span>
          )}
        </div>
        {m.atSupport > 0 && (
          <div
            onClick={() => { try { window.location.href = '/cheat-entry'; } catch {} }}
            title="Holdings resting on a rising 200DMA — the low-risk add zone. Open Cheat Entry."
            style={{ marginTop: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10, fontWeight: 800, color: 'var(--mc-state-persistent, #A78BFA)', borderTop: '1px solid var(--mc-border-1)', paddingTop: 7 }}
          >
            🥷 {m.atSupport} at rising support →
          </div>
        )}
      </TileShell>
    </div>
  );
}

const heroGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 12,
  marginBottom: 4,
  width: '100%',        // zzz533 — a grid child in a flex column won't stretch on its own
  alignSelf: 'stretch',
};
