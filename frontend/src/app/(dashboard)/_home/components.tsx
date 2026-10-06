'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { getConvictionList } from '@/lib/conviction-beats';
import { logSignals } from '@/lib/signal-log';
import { openPassport } from '@/lib/engines';
import Sparkline from '@/components/Sparkline';
import { fetchQuoteAutofill, calculatePE } from '@/lib/valuation-calculators';
import { getJson } from '@/lib/client-fetch';
import type { TierAction, InboxSignal, LaneKey, InboxPullback } from './types';
import { HOME_QUOTES_INDIA_URL, TTL_QUOTES, TTL_FEED, TEXT, DIM, cardStyle } from './constants';
import { readTransform, passesQualityPreset } from './helpers';

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

export function DecisionTierBlock({
  tier, label, color, description, items, expanded, condensed = false, totalCount,
}: {
  tier: number; label: string; color: string; description: string;
  items: TierAction[]; expanded: boolean; condensed?: boolean;
  /* PATCH 1101cc — Optional unfiltered count. When a lens reduces the visible
     items, pass the original list size here so the header shows "(3 of 10)"
     instead of just "(3)" — makes it instantly clear that a filter is hiding
     results. */
  totalCount?: number;
}) {
  const hasFilter = typeof totalCount === 'number' && totalCount > items.length;
  return (
    <div style={{
      ...cardStyle,
      borderColor: `${color}70`,
      background: `linear-gradient(180deg, ${color}14 0%, transparent 100%)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color, letterSpacing: '0.4px' }}>
          {/* zzz167 — emojis for tiers 1..5: Immediate Action / India Tech / USA Tech / Turnaround / Structural */}
          {tier === 1 ? '🎯' : tier === 2 ? '📈' : tier === 3 ? '📈' : tier === 4 ? '🔄' : '👁'} TIER {tier} — {label} {hasFilter ? `(${items.length} of ${totalCount} — lens filtering)` : `(${items.length})`}
        </span>
        <span style={{ fontSize: 10, color, background: `${color}22`, padding: '2px 7px', borderRadius: 3, fontWeight: 700 }}>
          {tier === 1 || tier === 2 || tier === 3 ? 'ACTION NOW' : tier === 4 ? 'ACTION NOW' : 'WATCH'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mc-text-3)', marginBottom: 10, lineHeight: 1.45 }}>{description}</div>
      {expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${condensed ? 260 : 320}px, 1fr))`, gap: 10 }}>
          {items.map((a, i) => (
            <Link key={a.symbol + i} href={a.href}
              title={a.scoreBreakdown ? Object.entries(a.scoreBreakdown).map(([k, v]) => `${k}: +${v}`).join('  ·  ') : ''}
              style={{
                display: 'flex', flexDirection: 'column', gap: 5, padding: condensed ? '8px 10px' : '12px 14px', borderRadius: 6,
                border: `1px solid ${color}40`, background: `${color}10`, textDecoration: 'none',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {tier <= 4 && <span style={{ fontSize: 18, fontWeight: 900, color }}>#{i + 1}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: condensed ? 13 : 16, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {a.company || a.symbol}
                    {/* PATCH 0617 — market flag chip (IN/US) */}
                    {a.market && (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 3, color: a.market === 'US' ? '#F87171' : 'var(--mc-cyan)', background: a.market === 'US' ? '#F8717122' : 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' }}>
                        {a.market === 'US' ? '🇺🇸 US' : '🇮🇳 IN'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--mc-text-3)', fontFamily: 'ui-monospace, monospace', fontWeight: 600, marginTop: 2 }}>
                    {a.symbol}{a.sector ? ` · ${a.sector}` : ''}
                  </div>
                </div>
                {a.score != null && (
                  <span style={{ fontSize: condensed ? 13 : 16, color: 'var(--mc-bullish)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {a.score}{a.grade || ''}
                  </span>
                )}
                {/* PATCH 0611 — cbConfirmed glyph so Tier-1 top-ups (non-CB A-grade) are obvious */}
                {tier === 1 && a.cbConfirmed === true && (
                  <span title="Cross-confirmed: on Conviction Beats bench" style={{ fontSize: 12, color: 'var(--mc-warn)', fontWeight: 800 }}>★</span>
                )}
                {tier === 1 && a.cbConfirmed === false && (
                  <span title="A-grade top-up: not yet on Conviction Beats bench" style={{ fontSize: 10, color: 'var(--mc-text-3)', background: 'color-mix(in srgb, var(--mc-text-3) 13%, transparent)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>+</span>
                )}
              </div>
              {!condensed && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 10px', fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
                    <span style={{ color: DIM, fontWeight: 700 }}>Thesis</span>
                    {/* PATCH 1086 — UX-01: scrub stale "Not in turnaround" thesis text for non-turnaround grades */}
                    <span style={{ color: TEXT }}>{(() => {
                      const t = String(a.thesis || '');
                      if (/not in turnaround/i.test(t) || /not turnaround/i.test(t)) {
                        return `Awaiting turnaround signals — grade ${a.grade || '—'}`;
                      }
                      return a.thesis;
                    })()}</span>
                    <span style={{ color: DIM, fontWeight: 700 }}>Risk</span>
                    <span style={{ color: '#FCA5A5' }}>{a.risk}</span>
                    <span style={{ color: DIM, fontWeight: 700 }}>Horizon</span>
                    <span style={{ color: TEXT }}>{a.horizon}</span>
                    <span style={{ color: DIM, fontWeight: 700 }}>Trigger</span>
                    <span style={{ color: 'var(--mc-cyan)' }}>{a.trigger}</span>
                  </div>
                  {a.scoreBreakdown && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                      {Object.entries(a.scoreBreakdown).map(([k, v]) => (
                        <span key={k} style={{ color: DIM, padding: '2px 6px', background: 'var(--mc-bg-0)', borderRadius: 3, fontFamily: 'ui-monospace, monospace' }}>
                          {k} +{v}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// PATCH 0631 — Home Valuation Quick-Check panel
export function HomeValuationQuickCheck() {
  const [ticker, setTicker] = useState('ATLANTAELE');
  const [pat, setPat] = useState(335);
  const [pe, setPe] = useState(36);
  const [horizon, setHorizon] = useState(18);
  const [mcap, setMcap] = useState(12000);
  const [price, setPrice] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);

  const autoFill = async () => {
    if (!ticker.trim()) return;
    setLoading(true);
    try {
      const q = await fetchQuoteAutofill(ticker, 'india');
      if (q) {
        if (q.currentPrice) setPrice(q.currentPrice);
        if (q.currentMarketCapCr) setMcap(Math.round(q.currentMarketCapCr));
        setAutoFilled(true);
      }
    } finally { setLoading(false); }
  };

  const result = useMemo(() => calculatePE({
    ticker, currentMarketCapCr: mcap, horizonMonths: horizon,
    forwardPATCr: pat,
    bearPE: Math.round(pe * 0.75),
    basePE: pe,
    bullPE: Math.round(pe * 1.4),
    currentPrice: price, currency: '₹',
  }), [ticker, mcap, horizon, pat, pe, price]);

  return (
    <div style={{ ...cardStyle, borderLeft: '3px solid var(--mc-cyan)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--mc-cyan)', letterSpacing: '0.4px' }}>
          🧮 VALUATION QUICK-CHECK
        </span>
        <Link href="/valuation-calc" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Full calculator →</Link>
      </div>
      <div style={{ fontSize: 10, color: DIM, marginBottom: 10 }}>
        Quick P/E-based target. Enter ticker + forward PAT + target P/E. Auto-fills current price + market cap from /api/market/quotes.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          TICKER
          <input value={ticker} onChange={e => { setTicker(e.target.value.toUpperCase()); setAutoFilled(false); }}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          FY27 PAT (₹ Cr)
          <input type="number" value={pat} onChange={e => setPat(Number(e.target.value))}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          BASE P/E
          <input type="number" value={pe} onChange={e => setPe(Number(e.target.value))}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          MARKET CAP (₹ Cr)
          <input type="number" value={mcap} onChange={e => setMcap(Number(e.target.value))}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
        <label style={{ fontSize: 10, color: DIM, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 2 }}>
          HORIZON (months)
          <input type="number" value={horizon} onChange={e => setHorizon(Number(e.target.value))}
            style={{ background: 'var(--mc-bg-0)', color: TEXT, border: '1px solid var(--mc-bg-4)', padding: '4px 7px', borderRadius: 3, fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }} />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={autoFill} disabled={loading} style={{
          fontSize: 10, padding: '4px 10px', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 31%, transparent)',
          color: 'var(--mc-bullish)', borderRadius: 3, cursor: loading ? 'wait' : 'pointer', fontWeight: 800,
        }}>
          {loading ? '⏳ FETCHING…' : '🔄 AUTO-FILL FROM LIVE QUOTE'}
        </button>
        {price && (
          <span style={{ fontSize: 10, color: 'var(--mc-bullish)', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
            ✓ live price ₹{price.toLocaleString('en-IN', { maximumFractionDigits: 1 })} {autoFilled ? '(auto-filled)' : ''}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {result.cases.map((c) => (
          <div key={c.label} style={{ background: 'var(--mc-bg-0)', border: `1px solid ${c.color}40`, borderLeft: `3px solid ${c.color}`, borderRadius: 4, padding: '8px 10px' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: c.color, letterSpacing: '1px' }}>{c.label}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: TEXT, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
              ₹{Math.round(c.marketCapCr).toLocaleString('en-IN')} Cr
            </div>
            {c.targetPrice !== undefined && (
              <div style={{ fontSize: 11, color: c.color, fontWeight: 700, marginTop: 2 }}>
                target ₹{c.targetPrice.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 4 }}>
              <span style={{ color: DIM }}>upside</span>
              <span style={{ color: c.color, fontWeight: 800 }}>{c.upsidePct >= 0 ? '+' : ''}{c.upsidePct.toFixed(0)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 2 }}>
              <span style={{ color: DIM }}>CAGR</span>
              <span style={{ color: c.color, fontWeight: 800 }}>{c.annualizedPct >= 0 ? '+' : ''}{c.annualizedPct.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DailySignalInbox() {
  const [signals, setSignals] = useState<InboxSignal[]>([]);
  const [pullbacks, setPullbacks] = useState<InboxPullback[]>([]);
  const [pbSparks, setPbSparks] = useState<Map<string, number[]>>(new Map()); // zzz527
  const pbPhaseRef = useRef(0); // zzz530 — highest pullback phase that has written (1.5=1, 1.6=2)
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  // zzz724 — which window actually filled the Transform lane, and how many
  // names the radar saw before the buy-side gate. Both are needed to tell an
  // empty radar apart from a radar whose names all failed the gate.
  const [transformWindowDays, setTransformWindowDays] = useState<number>(0);
  const [transformSeen, setTransformSeen] = useState<number>(0);
  const [laneStatus, setLaneStatus] = useState<Record<LaneKey, boolean>>({ momentum: false, warrant: false, transform: false, bench: false });

  // zzz855 — `bypass` = a user click on Refresh/Fresh (skip the client TTL
  // cache); the first load on mount reuses whatever the page already fetched.
  const load = useCallback(async (force = false, bypass = false) => {
    setLoading(true);
    // Per-fetch timeout so one slow feed (e.g. a cold PDF-scanning warrant feed)
    // can NEVER stall the whole inbox the way the old Promise.all did.
    // zzz855 — routed through the shared GET layer (deduped + 10 min TTL).
    const j = (url: string, ms = 12000, ttlMs = TTL_FEED): Promise<any | null> =>
      getJson<any>(url, { timeoutMs: ms, ttlMs, force: bypass || force });
    const mergeLane = (lane: InboxSignal['lane'], rows: InboxSignal[], key: LaneKey) => {
      setSignals((prev) => [...prev.filter((s) => s.lane !== lane), ...rows]);
      setLaneStatus((prev) => ({ ...prev, [key]: rows.length > 0 || prev[key] }));
    };

    // ══ PHASE 1 · INSTANT (localStorage only) — bench + pullbacks show at once ══
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const benchRows: InboxSignal[] = [];
      getConvictionList().filter((b) => b.tier === 'BLOCKBUSTER' || b.tier === 'STRONG').slice(0, 12).forEach((b) => {
        const isToday = b.filing_date === todayStr;
        const parts: string[] = [];
        if (b.sales_yoy_pct != null) parts.push(`sales ${b.sales_yoy_pct >= 0 ? '+' : ''}${Math.round(b.sales_yoy_pct)}%`);
        if (b.net_profit_yoy_pct != null) parts.push(`PAT ${b.net_profit_yoy_pct >= 0 ? '+' : ''}${Math.round(b.net_profit_yoy_pct)}%`);
        if (b.move_pct != null) parts.push(`${b.move_pct >= 0 ? '+' : ''}${Math.round(b.move_pct)}% since`);
        benchRows.push({ lane: 'BENCH', symbol: b.ticker, company: b.company || '',
          headline: `${b.tier}${isToday ? ' · NEW today' : ''}`,
          detail: parts.join(' · ') || `score ${b.composite_score}`,
          score: (isToday ? 1000 : 0) + (b.composite_score || 0), href: '/watchlists?tab=conviction', soft: false });
      });
      setSignals(benchRows);
      setLaneStatus({ momentum: false, warrant: false, transform: false, bench: benchRows.length > 0 });

      const pb: InboxPullback[] = getConvictionList()
        .filter(passesQualityPreset)
        .map((b: any) => {
          const has52 = typeof b.dist_52w_pct_yahoo === 'number';
          const correction = has52 ? -b.dist_52w_pct_yahoo : (typeof b.move_pct === 'number' ? -b.move_pct : NaN);
          return { symbol: b.ticker, company: b.company || '', tier: b.tier,
            correction, basis: (has52 ? '52w high' : 'since filing') as InboxPullback['basis'],
            sales: b.sales_yoy_pct, pat: b.net_profit_yoy_pct, pead: b.pead_score, mcap: b.market_cap_cr };
        })
        .filter((p) => Number.isFinite(p.correction) && p.correction <= 60)
        .sort((a, b) => b.correction - a.correction)
        .slice(0, 10);
      setPullbacks(pb);
    } catch { setPullbacks([]); }
    setLoading(false);   // instant content is up — stop the "scanning feeds…" spinner

    // ══ PHASE 1.5 · LIVE PULLBACK REFRESH ═══════════════════════════════════
    // zzz521 — the Phase-1 pullback % came straight off the bench snapshot
    // (dist_52w_pct_yahoo, which is usually null, so it fell back to move_pct —
    // a since-filing move captured ONCE at enrichment). That froze the numbers:
    // they read the same for days because nothing recomputed them against the
    // current price. Fix: pull the live india quote map (current price + live
    // 52-week high) and recompute each preset name's correction from TODAY's
    // price, so the panel actually moves. Snapshot stays as the instant
    // fallback for any name the live feed doesn't cover.
    (async () => {
      // zzz855 — the page-wide shared India quotes request (same URL as the
      // Movers panel) instead of a separate projected call; it carries
      // ticker/price/week52High/changePercent among its fields.
      const q = await j(HOME_QUOTES_INDIA_URL, 60_000, TTL_QUOTES);
      const stocks: any[] = q && Array.isArray(q.stocks) ? q.stocks : [];
      if (!stocks.length) return;
      const live = new Map<string, { price: number; high: number | null; chg: number | null }>();
      for (const s of stocks) {
        const t = String(s?.ticker || '').toUpperCase().trim();
        if (!t) continue;
        const price = Number(s?.price);
        const high = Number(s?.week52High);
        live.set(t, {
          price: Number.isFinite(price) ? price : NaN,
          high: Number.isFinite(high) && high > 0 ? high : null,
          chg: Number.isFinite(Number(s?.changePercent)) ? Number(s.changePercent) : null,
        });
      }
      try {
        const fresh: InboxPullback[] = getConvictionList()
          .filter(passesQualityPreset)
          .map((b: any) => {
            const sym = String(b.ticker || '').toUpperCase().trim();
            const lq = live.get(sym);
            // Live correction from the CURRENT price vs the live 52-week high.
            let correction: number;
            let basis: InboxPullback['basis'];
            if (lq && Number.isFinite(lq.price) && lq.high) {
              correction = (lq.high - lq.price) / lq.high * 100; // % below 52w high, live
              basis = '52w high';
            } else if (typeof b.dist_52w_pct_yahoo === 'number') {
              correction = -b.dist_52w_pct_yahoo; basis = '52w high';
            } else if (typeof b.move_pct === 'number') {
              correction = -b.move_pct; basis = 'since filing';
            } else {
              correction = NaN; basis = 'since filing';
            }
            return { symbol: b.ticker, company: b.company || '', tier: b.tier,
              correction, basis, sales: b.sales_yoy_pct, pat: b.net_profit_yoy_pct,
              pead: b.pead_score, mcap: b.market_cap_cr };
          })
          .filter((p) => Number.isFinite(p.correction) && p.correction <= 60)
          .sort((a, b) => b.correction - a.correction)
          .slice(0, 10);
        // zzz530 — only write if the authoritative spark pass (1.6) hasn't
        // already landed; and DON'T log here (1.6 logs the final set), so the
        // slower quote pass can never re-freeze the board to "since filing".
        if (fresh.length && pbPhaseRef.current < 1) { pbPhaseRef.current = 1; setPullbacks(fresh); }
      } catch { /* keep the Phase-1 snapshot */ }
    })();

    // ══ PHASE 1.6 · TRUE 52-WEEK HIGHS (zzz527) ═════════════════════════════
    // The bulk NSE quote feed has no yearHigh for most names, so Phase 1.5's
    // "live" pass silently fell back to the frozen since-filing move — the
    // board LOOKED live but wasn't. This pass asks /api/market/spark (Yahoo
    // daily bars, server-cached) for each preset name's real 52w high + last
    // close, recomputes every correction from TODAY's price, flips the basis
    // to '52w high', and brings back a 3-month sparkline per name.
    (async () => {
      try {
        const preset = getConvictionList().filter(passesQualityPreset);
        if (!preset.length) return;
        const syms = Array.from(new Set(preset.map((b: any) => String(b.ticker || '').toUpperCase().trim()).filter(Boolean))).slice(0, 24);
        const j = await getJson<any>(`/api/market/spark?symbols=${encodeURIComponent(syms.join(','))}`, { timeoutMs: 20_000, ttlMs: TTL_FEED, force: bypass || force });
        if (!j) return;
        const bySym = new Map<string, any>();
        for (const row of (j?.rows || [])) if (row?.symbol) bySym.set(String(row.symbol), row);
        if (!bySym.size) return;
        const sparkMap = new Map<string, number[]>();
        const upgraded: InboxPullback[] = preset.map((b: any) => {
          const sym = String(b.ticker || '').toUpperCase().trim();
          const row = bySym.get(sym);
          if (row && Number.isFinite(row.ddPct)) {
            if (Array.isArray(row.spark)) sparkMap.set(sym, row.spark);
            return { symbol: b.ticker, company: b.company || '', tier: b.tier,
              correction: -row.ddPct, basis: '52w high' as InboxPullback['basis'],
              sales: b.sales_yoy_pct, pat: b.net_profit_yoy_pct, pead: b.pead_score, mcap: b.market_cap_cr };
          }
          // no bar data — keep the best stale estimate, honestly labeled
          const corr = typeof b.dist_52w_pct_yahoo === 'number' ? -b.dist_52w_pct_yahoo
            : (typeof b.move_pct === 'number' ? -b.move_pct : NaN);
          return { symbol: b.ticker, company: b.company || '', tier: b.tier,
            correction: corr, basis: (typeof b.dist_52w_pct_yahoo === 'number' ? '52w high' : 'since filing') as InboxPullback['basis'],
            sales: b.sales_yoy_pct, pat: b.net_profit_yoy_pct, pead: b.pead_score, mcap: b.market_cap_cr };
        })
          .filter((pp) => Number.isFinite(pp.correction) && pp.correction <= 60)
          .sort((a, bb) => bb.correction - a.correction)
          .slice(0, 10);
        if (upgraded.length) { pbPhaseRef.current = 2; setPullbacks(upgraded); setPbSparks(sparkMap); }
        try {
          logSignals('pullback', upgraded.slice(0, 10).map((pp) => ({
            ticker: pp.symbol,
            note: `pullback ${pp.correction >= 0 ? '-' : '+'}${Math.abs(pp.correction).toFixed(0)}% off ${pp.basis}`,
            priceAt: bySym.get(String(pp.symbol || '').toUpperCase().trim())?.last ?? null,
          })));
        } catch { /* never load-bearing */ }
      } catch { /* keep prior pullbacks */ }
    })();

    // ══ PHASE 2 · NETWORK — each lane fills in independently as it returns ══
    // MOMENTUM = concall score-movers + today's price leaders (needs both).
    Promise.all([
      // zzz855 — shared India quotes; `limit=40` used to cap gainers at 40 —
      // applied client-side below so the lane reads exactly the same rows.
      j(HOME_QUOTES_INDIA_URL, 60_000, TTL_QUOTES).then((q) => (q && Array.isArray(q.gainers) ? { ...q, gainers: q.gainers.slice(0, 40) } : q)),
      j('/api/v1/concall-intel/movers', 10000),
    ]).then(([quotes, movers]) => {
      const rows: InboxSignal[] = []; const seen = new Set<string>();
      if (movers && !movers.error) {
        (movers.new_entries || []).slice(0, 6).forEach((m: any) => { seen.add(m.symbol); rows.push({
          lane: 'MOMENTUM', symbol: m.symbol, company: m.company_name || '',
          headline: 'New to concall top-30', detail: `${(m.tier || '').replace('_', ' ')} · rank #${m.rank_today}`,
          score: (m.composite_today || 0) + 1000, href: '/concall-intel' }); });
        (movers.big_jumps || []).slice(0, 6).forEach((m: any) => { if (seen.has(m.symbol)) return; seen.add(m.symbol); rows.push({
          lane: 'MOMENTUM', symbol: m.symbol, company: m.company_name || '',
          headline: `Concall score jump +${(m.delta ?? 0).toFixed(1)}`, detail: `${(m.tier || '').replace('_', ' ')} · now #${m.rank_today}`,
          score: (m.delta || 0) + 500, href: '/concall-intel' }); });
      }
      if (quotes && Array.isArray(quotes.gainers)) {
        quotes.gainers.filter((g: any) => (g.changePercent || 0) >= 3 && (g.price || 0) >= 50).slice(0, 12).forEach((g: any) => {
          if (seen.has(g.ticker)) return; seen.add(g.ticker);
          rows.push({ lane: 'MOMENTUM', symbol: g.ticker, company: g.company || '',
            headline: `Price +${(g.changePercent || 0).toFixed(1)}% today`,
            detail: `${g.sector || '—'} · ₹${(g.price || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}`,
            score: (g.changePercent || 0), href: '/screener' });
        });
      }
      mergeLane('MOMENTUM', rows, 'momentum');
    });

    // WARRANT — 45d window (was 90d, which cold-scanned too many PDFs and stalled).
    j('/api/v1/concall-intel/warrant-feed?days=45', 16000).then((warrant) => {
      if (!warrant || warrant.error) return;
      const rows: InboxSignal[] = [];
      const all = (warrant.ranked_all && warrant.ranked_all.length ? warrant.ranked_all : warrant.filings) || [];
      const isDistress = (f: any) => /distress/i.test(f?.conviction?.tier || '') || (f?.conviction?.distress_probability ?? 0) >= 0.5;
      const passing = all.filter((f: any) => f?.conviction?.passes_gate);
      const watch = all.filter((f: any) => !f?.conviction?.passes_gate && !isDistress(f) && (f?.conviction?.conviction ?? 0) >= 3);
      passing.slice(0, 10).forEach((f: any) => rows.push({
        lane: 'WARRANT', symbol: f.symbol, company: f.company_name || '',
        headline: `Warrant qualified · ${(f.conviction?.conviction ?? 0).toFixed(1)}/10`,
        detail: f.conviction?.tier ? `${f.conviction.tier} · ${String(f.subject || '').slice(0, 40)}` : String(f.subject || '').slice(0, 50),
        score: (f.conviction?.conviction || 0) + 100, href: '/concall-intel' }));
      if (passing.length === 0) watch.slice(0, 10).forEach((f: any) => rows.push({
        lane: 'WARRANT', symbol: f.symbol, company: f.company_name || '',
        headline: `Warrant watch · ${(f.conviction?.conviction ?? 0).toFixed(1)}/10`,
        detail: `${f.conviction?.tier || 'watch'} · building, below strict gate`,
        score: (f.conviction?.conviction || 0), href: '/concall-intel', soft: true }));
      mergeLane('WARRANT', rows, 'warrant');
      setLaneStatus((prev) => ({ ...prev, warrant: true }));
    });

    // ── TRANSFORM — batch radar, WITH AN ADAPTIVE WINDOW.         (zzz724)
    //
    // The lane was pinned to days=60&limit=24 and had gone permanently silent:
    // checked against the live endpoint on 21 September, that exact query
    // returns ZERO entries while days=90&limit=200 returns forty. Indian
    // concall season ended in mid-August, so a 60-day window over the most
    // recent 24 filings now catches nothing transformational — and the widget
    // reported that as "quiet — nothing new", which is a different and much
    // more reassuring statement than "my window is too narrow to see anything".
    //
    // So the window widens until it finds something: 60 days first because a
    // recent signal is worth more than an old one, then 90, then 120. The
    // widget states which window produced the result, so a lane filled from
    // 120 days can never be mistaken for a lane filled from this week.
    const transformWindows = [
      { days: 60, limit: 60 },
      { days: 90, limit: 200 },
      { days: 120, limit: 200 },
    ];
    (async () => {
      let transform: any = null;
      let usedDays = 0;
      for (const w of transformWindows) {
        const got = await j(
          `/api/v1/concall-intel/transformation-screener?days=${w.days}&limit=${w.limit}${force ? '&refresh=1' : ''}`,
          force ? 55000 : 22000,
        );
        if (got && !got.error) {
          transform = got; usedDays = w.days;
          if ((got.entries || []).length) break;   // stop at the first window that sees anything
        }
      }
      if (!transform) { setLaneStatus((prev) => ({ ...prev, transform: true })); return; }
      setTransformWindowDays(usedDays);
      const rows: InboxSignal[] = [];
      const entries = transform.entries || [];
      // zzz452 — sort by evidence-ladder rung first (most proven at top), then
      // composite score, so the actionable "accumulate" names lead the lane and
      // the "watch, story-only" names fall to the bottom.
      const ordered = [...entries].sort((a: any, b: any) =>
        ((b.evidence_score || 0) - (a.evidence_score || 0)) || ((b.transformation_score || 0) - (a.transformation_score || 0)));
      // dedup by symbol (a company can file twice in the window) — keep the
      // highest-evidence instance, which is already first after the sort.
      const seenTf = new Set<string>();
      const orderedUniq = ordered.filter((e: any) => {
        const k = (e.symbol || '').toUpperCase();
        if (!k || seenTf.has(k)) return false;
        seenTf.add(k); return true;
      });
      // zzz464 — HOME shows buy-side only: STRONG BUY / BUY / ACCUMULATE. The
      // unproven WATCH names (story/guidance, ev<6) are dropped from the inbox.
      orderedUniq.forEach((e: any) => {
        const t = readTransform(e);
        if (!t.isBuy) return;                       // no watch / hold at home
        rows.push({
          lane: 'TRANSFORM', symbol: e.symbol, company: e.company_name || '',
          headline: t.headline, detail: t.detail, hColor: t.hColor, note: t.note, quote: t.quote,
          score: e.transformation_score || 0, href: '/concall-intel?tab=radar', soft: t.soft });
      });
      setGeneratedAt(transform.generated_at || null);
      // zzz724 — when the radar HAS names but none of them clears the buy-side
      // gate, that is a different fact from an empty radar, and the lane says
      // which. "Quiet" must never be printed over "24 names, none qualified".
      setTransformSeen(entries.length);
      mergeLane('TRANSFORM', rows, 'transform');
      setLaneStatus((prev) => ({ ...prev, transform: true }));
    })();
  }, []);

  useEffect(() => { load(); }, [load]);

  const LANE_META: Record<InboxSignal['lane'], { c: string; emoji: string; label: string }> = {
    MOMENTUM:  { c: '#60A5FA', emoji: '📈', label: 'Momentum' },
    WARRANT:   { c: '#F59E0B', emoji: '🎯', label: 'Warrant' },
    TRANSFORM: { c: '#10B981', emoji: '🚀', label: 'Transform' },
    BENCH:     { c: '#F59E0B', emoji: '🏆', label: 'Bench' },
  };
  const lanes: InboxSignal['lane'][] = ['MOMENTUM', 'WARRANT', 'TRANSFORM', 'BENCH'];
  const total = signals.length;
  const activeLaneCount = (Object.values(laneStatus) as boolean[]).filter(Boolean).length;

  return (
    <div style={{ background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.20)', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: '#60A5FA', letterSpacing: '0.5px' }}>⭐ DAILY SIGNAL INBOX</span>
          <span style={{ fontSize: 11, color: DIM }}>{loading ? 'scanning feeds…' : `${pullbacks.length ? `${pullbacks.length} quality pullback${pullbacks.length === 1 ? '' : 's'} · ` : ''}${total} signal${total === 1 ? '' : 's'} across ${activeLaneCount} lane${activeLaneCount === 1 ? '' : 's'}`}</span>
          {!loading && (
            <span style={{ fontSize: 9.5, color: DIM }}>
              {(['momentum', 'warrant', 'transform', 'bench'] as const).map((k) => (
                <span key={k} title={`${k} feed ${laneStatus[k] ? 'live' : 'cold'}`} style={{ color: laneStatus[k] ? '#10B981' : '#64748B', marginLeft: 6 }}>●{k[0].toUpperCase()}</span>
              ))}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => load(false, true)} disabled={loading} style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 6, cursor: loading ? 'wait' : 'pointer', border: '1px solid rgba(96,165,250,0.4)', background: 'transparent', color: '#60A5FA' }}>{loading ? '⏳' : '↻ Refresh'}</button>
          <button onClick={() => load(true, true)} disabled={loading} title="Force a fresh server scan (bypasses the cache) — takes ~30-50s" style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 6, cursor: loading ? 'wait' : 'pointer', border: '1px solid rgba(16,185,129,0.5)', background: 'transparent', color: '#10B981' }}>{loading ? '⏳' : '↻ Fresh'}</button>
          <button onClick={() => setCollapsed((c) => !c)} style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--mc-border-1)', background: 'transparent', color: DIM }}>{collapsed ? 'Show' : 'Hide'}</button>
        </div>
      </div>

      {!collapsed && !loading && total === 0 && pullbacks.length === 0 && (
        <div style={{ fontSize: 11.5, color: DIM, marginTop: 10, lineHeight: 1.6 }}>
          No signals surfaced right now — the concall feeds may be mid-refresh and your Conviction Bench is empty. This inbox fills from movers, warrant setups, the transformation radar, your bench, and quality pullbacks. Try Refresh, or open <Link href="/concall-intel" style={{ color: '#60A5FA' }}>Concall Intel</Link> / <Link href="/watchlists?tab=conviction" style={{ color: '#F59E0B' }}>Conviction Beats</Link>.
        </div>
      )}

      {!collapsed && (total > 0 || pullbacks.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, alignItems: 'flex-start' }}>

          {/* ── LEFT · the hero: Quality Pullbacks (great earnings on sale) ── */}
          <div style={{ flex: '1.5 1 330px', minWidth: 0, background: 'linear-gradient(135deg, rgba(239,68,68,0.07), rgba(245,158,11,0.03) 60%, transparent)', border: '1px solid rgba(245,158,11,0.28)', borderRadius: 12, padding: '13px 15px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: '#F59E0B', letterSpacing: '0.4px' }}>💎 QUALITY PULLBACKS</span>
              <span style={{ fontSize: 9.5, color: DIM }}>{pullbacks.length ? `top ${pullbacks.length}` : ''}</span>
            </div>
            <div style={{ fontSize: 10, color: DIM, marginTop: 3, lineHeight: 1.5 }}>
              Your full preset — <span style={{ color: 'var(--mc-text-3)' }}>Sales≥20 · EPS≥25 · PEAD≥40 · OPM Δ≥0 · CFO/PAT≥0.5 · ₹3k Cr+ · 0 pledge · BB/STRONG</span> — every gate strict, ranked by pullback, biggest dip first. Red = on sale; green = still near its high. Buy great earnings on the dip.
            </div>
            {pullbacks.length === 0 ? (
              <div style={{ fontSize: 10.5, color: DIM, marginTop: 12, lineHeight: 1.55 }}>
                No preset winner is in a meaningful pullback right now — your quality names are near their highs, or the bench needs enriching (52-week distance comes from the enrich pass). This lights up the moment a great-earnings name sells off. <Link href="/watchlists?tab=conviction" style={{ color: '#F59E0B' }}>Open the bench →</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 11 }}>
                {pullbacks.map((p, i) => {
                  const down = p.correction > 0.5;                 // actually pulled back
                  const col = !down ? '#10B981' : p.correction >= 20 ? '#EF4444' : p.correction >= 10 ? '#F59E0B' : '#FBBF24';
                  const depth = Math.max(3, Math.min(100, Math.abs(p.correction) * 3));
                  return (
                    <Link key={p.symbol} href="/watchlists?tab=conviction" style={{ textDecoration: 'none', display: 'block', background: 'rgba(255,255,255,0.02)', border: `1px solid ${down ? `${col}33` : 'rgba(255,255,255,0.07)'}`, borderRadius: 9, padding: '8px 11px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ fontSize: 11, fontWeight: 900, color: DIM, fontFamily: 'ui-monospace, monospace', width: 20, flexShrink: 0 }}>{i + 1}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); openPassport(p.symbol); }} title="Open Stock Passport" style={{ fontSize: 13.5, fontWeight: 900, color: TEXT, cursor: 'pointer' }}>{p.symbol}</span>
                            <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 3, background: p.tier === 'BLOCKBUSTER' ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.18)', color: p.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981' }}>{p.tier === 'BLOCKBUSTER' ? 'BB' : 'STRONG'}</span>
                            <span style={{ fontSize: 9, color: DIM, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.company}</span>
                          </div>
                        </div>
                        {pbSparks.get(String(p.symbol || '').toUpperCase().trim()) && (
                          <Sparkline data={pbSparks.get(String(p.symbol || '').toUpperCase().trim())} width={62} height={17} />
                        )}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 900, color: col, fontFamily: 'ui-monospace, monospace', lineHeight: 1 }}>{down ? '−' : '+'}{Math.abs(p.correction).toFixed(0)}%</div>
                          <div style={{ fontSize: 8, color: DIM }}>{down ? `off ${p.basis}` : 'near high'}</div>
                        </div>
                      </div>
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 7, overflow: 'hidden' }}>
                        <div style={{ width: `${depth}%`, height: '100%', background: col, opacity: down ? 1 : 0.5 }} />
                      </div>
                      <div style={{ fontSize: 9, color: DIM, marginTop: 5, fontFamily: 'ui-monospace, monospace' }}>
                        {p.sales != null && `sales +${Math.round(p.sales)}%`}{p.pat != null && ` · PAT ${p.pat >= 0 ? '+' : ''}${Math.round(p.pat)}%`}{p.pead != null && ` · PEAD ${Math.round(p.pead)}`}{p.mcap != null && ` · ₹${Math.round(p.mcap).toLocaleString('en-IN')} Cr`}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── RIGHT · the live signal lanes, balanced 2-column masonry so short
                 lanes (e.g. Warrant) don't leave big empty gaps under tall ones ── */}
          <div style={{ flex: '1.15 1 320px', minWidth: 0, columns: '150px', columnGap: 9 }}>
            {lanes.map((lane) => {
              const laneSignals = signals.filter((s) => s.lane === lane).sort((a, b) => b.score - a.score);
              const meta = LANE_META[lane];
              const laneCount = laneSignals.length;
              return (
                <div key={lane} style={{ background: '#0D1623', border: `1px solid ${meta.c}33`, borderLeft: `3px solid ${meta.c}`, borderRadius: 9, padding: '9px 11px', breakInside: 'avoid', marginBottom: 9, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: meta.c, letterSpacing: '0.4px' }}>{meta.emoji} {meta.label}</span>
                    <span style={{ fontSize: 9, fontWeight: 800, color: laneCount ? meta.c : DIM, fontFamily: 'ui-monospace, monospace', background: laneCount ? `${meta.c}1f` : 'transparent', borderRadius: 20, padding: laneCount ? '1px 7px' : 0, minWidth: 16, textAlign: 'center' }}>{laneCount}</span>
                  </div>
                  {laneSignals.length === 0 ? (
                    <div style={{ fontSize: 10, color: DIM }}>{
                      !laneStatus[lane.toLowerCase() as LaneKey]
                        ? (lane === 'BENCH' ? 'no bench names yet' : 'feed warming up')
                        : lane === 'TRANSFORM'
                          // zzz724 — three genuinely different silences, and the
                          // widget used to print the most reassuring one over all
                          // of them.
                          ? (transformSeen > 0
                            ? `${transformSeen} on the radar, none buy-side yet`
                            : transformWindowDays >= 120
                              ? 'radar empty back to 120 days — off-season'
                              : 'radar returned nothing')
                          : 'quiet — nothing new'
                    }</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {laneSignals.slice(0, 10).map((s, i) => (
                        <Link key={`${s.symbol}-${i}`} href={s.href} title={s.note || undefined} style={{ textDecoration: 'none', display: 'block', padding: '5px 7px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: `1px solid ${s.soft ? 'rgba(255,255,255,0.05)' : `${(s.hColor || meta.c)}22`}`, opacity: s.soft ? 0.82 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 900, color: TEXT }}>{s.symbol}</span>
                            <span style={{ fontSize: 9, color: DIM, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.company}</span>
                            {s.soft && <span style={{ fontSize: 7.5, color: DIM, marginLeft: 'auto', flexShrink: 0 }}>watch</span>}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: s.hColor || meta.c, marginTop: 1 }}>{s.headline}</div>
                          <div style={{ fontSize: 9, color: DIM, marginTop: 1, lineHeight: 1.35 }}>{s.detail}</div>
                          {s.quote ? <div style={{ fontSize: 8.5, color: 'var(--mc-text-3)', marginTop: 3, lineHeight: 1.35, fontStyle: 'italic', borderLeft: `2px solid ${s.hColor || meta.c}`, paddingLeft: 5 }}>“{s.quote.length > 120 ? s.quote.slice(0, 120) + '…' : s.quote}”</div> : null}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!collapsed && (total > 0 || pullbacks.length > 0) && (
        <div style={{ fontSize: 9, color: DIM, marginTop: 10, fontStyle: 'italic', lineHeight: 1.5 }}>
          💎 Pullbacks are your quality-preset winners ranked by drop from the 52-week high (buy-the-dip). Lanes aggregate concall Movers + today&rsquo;s price leaders, Warrant setups, the Transformation Radar{transformWindowDays ? ` (${transformWindowDays}-day window)` : ''}, and your Conviction Bench{generatedAt ? ` · radar ${new Date(generatedAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}` : ''}. <b>watch</b> = best available when no hard event fired. Deterministic reads, not recommendations.
        </div>
      )}
    </div>
  );
}
