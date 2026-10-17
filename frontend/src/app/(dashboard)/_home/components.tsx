'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo, useCallback, useEffect } from 'react';
import NavLink from '@/components/NavLink';   // zzz1052 — prefetch on hover / focus / press, not on scroll-into-view
import { getConvictionList } from '@/lib/conviction-beats';
import { fetchQuoteAutofill, calculatePE } from '@/lib/valuation-calculators';
import { getJson } from '@/lib/client-fetch';
import type { TierAction, InboxSignal, LaneKey } from './types';
import { HOME_QUOTES_INDIA_URL, TTL_QUOTES, TTL_FEED, TEXT, DIM, cardStyle } from './constants';
import { readTransform } from './helpers';

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
            <NavLink key={a.symbol + i} href={a.href}
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
            </NavLink>
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
        <NavLink href="/valuation-calc" style={{ fontSize: 10, color: 'var(--mc-cyan)', textDecoration: 'none' }}>Full calculator →</NavLink>
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

    // ══ PHASE 1 · INSTANT (localStorage only) — the bench lane shows at once ══
    // zzz1052 — the "Quality pullbacks" lane (and its live-quote / 52-week-high passes) was removed at the owner's request.
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

    } catch { /* bench lane stays empty */ }
    setLoading(false);   // instant content is up — stop the "scanning feeds…" spinner

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
          <span style={{ fontSize: 11, color: DIM }}>{loading ? 'scanning feeds…' : `${total} signal${total === 1 ? '' : 's'} across ${activeLaneCount} lane${activeLaneCount === 1 ? '' : 's'}`}</span>
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

      {!collapsed && !loading && total === 0 && (
        <div style={{ fontSize: 11.5, color: DIM, marginTop: 10, lineHeight: 1.6 }}>
          No signals surfaced right now — the concall feeds may be mid-refresh and your Conviction Bench is empty. This inbox fills from movers, warrant setups, the transformation radar and your bench. Try Refresh, or open <NavLink href="/concall-intel" style={{ color: '#60A5FA' }}>Concall Intel</NavLink> / <NavLink href="/watchlists?tab=conviction" style={{ color: '#F59E0B' }}>Conviction Beats</NavLink>.
        </div>
      )}

      {!collapsed && total > 0 && (
        // zzz1052 — the four lanes side by side (one row on a wide screen, 2 × 2 on a laptop, stacked on a phone);
        // each lane uses the width the old Quality-pullbacks column took.
        // zzz1065 — explicit 1 / 2 / 4 columns by the inbox's own width (CSS container query `.mc-inbox-lanes` in
        // globals.css, breakpoints in lib/inbox-lanes.ts). auto-fit could give 3 + 1 on a laptop.
        <div className="mc-inbox-wrap">
        <div data-testid="inbox-lanes" className="mc-inbox-lanes" style={{ display: 'grid', gap: 10, marginTop: 12, alignItems: 'start' }}>
            {lanes.map((lane) => {
              const laneSignals = signals.filter((s) => s.lane === lane).sort((a, b) => b.score - a.score);
              const meta = LANE_META[lane];
              const laneCount = laneSignals.length;
              return (
                <div key={lane} data-lane={lane} style={{ background: '#0D1623', border: `1px solid ${meta.c}33`, borderLeft: `3px solid ${meta.c}`, borderRadius: 9, padding: '10px 12px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
                        <NavLink key={`${s.symbol}-${i}`} href={s.href} title={s.note || undefined} style={{ textDecoration: 'none', display: 'block', padding: '5px 7px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: `1px solid ${s.soft ? 'rgba(255,255,255,0.05)' : `${(s.hColor || meta.c)}22`}`, opacity: s.soft ? 0.82 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 900, color: TEXT }}>{s.symbol}</span>
                            <span style={{ fontSize: 9, color: DIM, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.company}</span>
                            {s.soft && <span style={{ fontSize: 7.5, color: DIM, marginLeft: 'auto', flexShrink: 0 }}>watch</span>}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: s.hColor || meta.c, marginTop: 1 }}>{s.headline}</div>
                          <div style={{ fontSize: 9, color: DIM, marginTop: 1, lineHeight: 1.35 }}>{s.detail}</div>
                          {s.quote ? <div style={{ fontSize: 8.5, color: 'var(--mc-text-3)', marginTop: 3, lineHeight: 1.35, fontStyle: 'italic', borderLeft: `2px solid ${s.hColor || meta.c}`, paddingLeft: 5 }}>“{s.quote.length > 120 ? s.quote.slice(0, 120) + '…' : s.quote}”</div> : null}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        </div>
      )}

      {!collapsed && total > 0 && (
        <div style={{ fontSize: 9, color: DIM, marginTop: 10, fontStyle: 'italic', lineHeight: 1.5 }}>
          Lanes aggregate concall Movers + today&rsquo;s price leaders, Warrant setups, the Transformation Radar{transformWindowDays ? ` (${transformWindowDays}-day window)` : ''}, and your Conviction Bench{generatedAt ? ` · radar ${new Date(generatedAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}` : ''}. <b>watch</b> = best available when no hard event fired. Deterministic reads, not recommendations.
        </div>
      )}
    </div>
  );
}
