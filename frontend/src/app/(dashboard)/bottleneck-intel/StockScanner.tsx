'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { SkeletonGrid, ScoreGauge, CriteriaCheck, Tag, EmptyState } from './components';
import { TIER_MAP } from './constants';
import { UNIVERSE_DEDUPED, WEEK_MS } from './constants2';
import { buildEnrichedStocks, getTickerSymbols, exchangeFlag, fmtCap, timeAgo } from './helpers';
import { type NewsArticle, type QuoteStock } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — STOCK SCANNER
// Universe = curated from Serenity framework doc (static watchlist)
// Data     = 100% live: prices from /api/market/quotes, evidence from /api/v1/news
// ═══════════════════════════════════════════════════════════════════════════════

export function StockScanner({ articles, isLoading, quotes, quotesLoading }: {
  articles: NewsArticle[]; isLoading: boolean; quotes: QuoteStock[]; quotesLoading: boolean;
}) {
  const [filterLayer, setFilterLayer] = useState('ALL');
  const [expRow, setExpRow] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'universe' | 'live'>('live'); // default to discovery-first

  const enriched = useMemo(() => buildEnrichedStocks(articles, quotes), [articles, quotes]);

  // Live News: ALL tickers from BOTTLENECK news ranked by evidence count.
  // The universe is comprehensive enough that most major names are already there,
  // so "not in universe" filter always returns 0. Instead: show everything from news,
  // badge in-universe stocks as "✓ TRACKED" and new ones as "🆕 NEW".
  const universeTickers = new Set(UNIVERSE_DEDUPED.map(u => u.ticker.replace(/\d+$/, '').toUpperCase()));
  // Text-signal detectors — scan article headline+summary for Serenity-relevant signals
  // These are dynamic scoring inputs beyond static structural filters
  const TEXT_SIGNALS: { key: string; label: string; icon: string; color: string; keywords: string[] }[] = [
    { key: 'scarcity',    label: 'Scarcity',    icon: '🔒', color: '#EF4444', keywords: ['sold out','allocation','rationed','supply tight','capacity constrained','shortage','backlog','queue'] },
    { key: 'lead_time',   label: 'Lead Time',   icon: '⏱️', color: '#F59E0B', keywords: ['lead time','delivery delay','extended lead','weeks','months backlog','order backlog'] },
    { key: 'design_win',  label: 'Design Win',  icon: '🎯', color: '#10B981', keywords: ['design win','qualification complete','ramp phase','volume production','customer win','design selection'] },
    { key: 'backlog',     label: 'Backlog',     icon: '📦', color: '#F59E0B', keywords: ['record backlog','growing backlog','order book','new orders','order flow'] },
    { key: 'capex',       label: 'Capex Signal',icon: '💰', color: '#8B5CF6', keywords: ['capex','capacity expansion','new fab','plant expansion','capacity investment','building capacity'] },
    { key: 'price_power', label: 'Pricing Pwr', icon: '💲', color: '#10B981', keywords: ['price increase','asp rising','pricing power','higher prices','premium pricing','price hike'] },
  ];

  function detectTextSignals(headlines: string[]): string[] {
    const text = headlines.join(' ').toLowerCase();
    return TEXT_SIGNALS.filter(s => s.keywords.some(kw => text.includes(kw))).map(s => s.key);
  }

  const liveExtra = useMemo(() => {
    const map = new Map<string, { symbol: string; sub_tag?: string; level?: string; evidence_count: number; headlines: string[]; latest_at?: string; price?: number; change_pct?: number; market_cap?: number; inUniverse: boolean; velocity_week: number; textSignals: string[] }>();
    const now = Date.now();
    for (const a of articles) {
      for (const sym of getTickerSymbols(a)) {
        if (!map.has(sym)) map.set(sym, { symbol: sym, sub_tag: a.bottleneck_sub_tag, level: a.bottleneck_level, evidence_count: 0, headlines: [], inUniverse: universeTickers.has(sym.toUpperCase()), velocity_week: 0, textSignals: [] });
        const r = map.get(sym)!;
        r.evidence_count++;
        const age = now - new Date(a.published_at).getTime();
        if (age < WEEK_MS) r.velocity_week++;
        if (!r.sub_tag && a.bottleneck_sub_tag) r.sub_tag = a.bottleneck_sub_tag;
        const h = a.title || a.headline || '';
        if (h && r.headlines.length < 5 && !r.headlines.includes(h)) r.headlines.push(h);
        if (!r.latest_at || (a.published_at && a.published_at > r.latest_at)) r.latest_at = a.published_at;
      }
    }
    // PATCH 0261 — defend against undefined/null quote tickers.
    // PATCH 0445 BUG-028 — Broader symbol normalization. Article tickers can
    // arrive as '$NVDA', 'NASDAQ:NVDA', 'NVDA.O', '(NVDA)'. Quote keys arrive
    // as bare 'NVDA' or 'NVDA.NS'. Normalize aggressively on both sides AND
    // fall back to alternate price fields (regularMarketPrice / lastPrice /
    // cmp) since /api/market/quotes can re-shape the field by upstream source.
    const stripSuffix = (s: string) => (s || '').toUpperCase()
      .replace(/^[\$\(]/, '')         // $NVDA → NVDA, (NVDA) → NVDA)
      .replace(/[\)]$/, '')           // (NVDA) → (NVDA → NVDA
      .replace(/^(NSE|BSE|NYSE|NASDAQ|US):/, '')
      .replace(/\.(NS|BO|BSE|NSE|O|N|OQ|TO|HK|L|PA)$/, '')
      .trim();
    const priceOf = (q: any): number | undefined => {
      if (!q) return undefined;
      const candidates = [q.price, q.regularMarketPrice, q.lastPrice, q.cmp, q.ltp];
      for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return undefined;
    };
    const pctOf = (q: any): number | undefined => {
      if (!q) return undefined;
      // PATCH 0771: skip zeros from reported field (NSE/Yahoo return
      // 0 on weekends + holidays even when prices are valid). Take
      // first finite non-zero candidate, then fall through to a
      // price-vs-prevClose compute as last resort.
      const candidates = [q.changePercent, q.regularMarketChangePercent, q.pChange, q.change_pct];
      for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n) && n !== 0) return n;
      }
      const price = Number(q.price ?? q.regularMarketPrice ?? q.lastPrice ?? q.cmp ?? q.ltp);
      const prev = Number(q.previousClose ?? q.regularMarketPreviousClose ?? q.prevClose);
      if (Number.isFinite(price) && Number.isFinite(prev) && price > 0 && prev > 0 && price !== prev) {
        return ((price - prev) / prev) * 100;
      }
      // No non-zero candidates and no price/prevClose info — preserve old
      // semantics by returning the first finite candidate (often 0).
      for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n)) return n;
      }
      return undefined;
    };
    const mcapOf = (q: any): number | undefined => {
      const n = Number(q?.marketCap ?? q?.market_cap ?? q?.mcap);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const qm = new Map<string, QuoteStock>(
      (quotes || []).filter((q: any) => q?.ticker || q?.symbol).map((q: any) => [stripSuffix(q.ticker || q.symbol), q])
    );
    return Array.from(map.values())
      .filter(r => r.inUniverse ? r.evidence_count >= 1 : r.evidence_count >= 2) // New picks need 2+ articles to filter news noise
      .map(r => {
        const q = qm.get(stripSuffix(r.symbol));
        return {
          ...r,
          price: priceOf(q),
          change_pct: pctOf(q),
          market_cap: mcapOf(q),
          textSignals: detectTextSignals(r.headlines),
        };
      })
      .sort((a, b) => {
        // Discovery score: new picks + velocity + text signals + evidence
        const sigScore = (r: typeof a) => (!r.inUniverse ? 10 : 0) + r.velocity_week * 2 + r.textSignals.length * 3 + r.evidence_count;
        return sigScore(b) - sigScore(a);
      });
  }, [articles, quotes]);

  const LAYERS = ['ALL', 'INTERCONNECT_PHOTONICS', 'MATERIALS_SUPPLY', 'FABRICATION_PACKAGING', 'COMPUTE_SCALING', 'MEMORY_STORAGE', 'POWER_GRID', 'NUCLEAR_ENERGY', 'THERMAL_COOLING'];
  const filtered = useMemo(() => filterLayer === 'ALL' ? enriched : enriched.filter(r => r.sub_tag === filterLayer), [enriched, filterLayer]);

  const multibaggers = enriched.filter(s => s.score >= 70 && s.is_small_cap);
  const withLiveSignal = enriched.filter(s => s.evidence_count > 0);

  if (isLoading) return <SkeletonGrid count={8} height={54} />;

  return (
    <div style={{ padding: '20px' }}>
      {/* Data transparency banner */}
      <div style={{ marginBottom: '14px', padding: '10px 14px', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 13%, transparent)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <Zap className="w-3 h-3" style={{ color: 'var(--mc-accent)', flexShrink: 0 }} />
        <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>
          <strong style={{ color: 'var(--mc-accent)' }}>Watchlist</strong> from Serenity framework doc ·&nbsp;
          <strong style={{ color: 'var(--mc-bullish)' }}>Prices/market cap</strong> live from Yahoo Finance ·&nbsp;
          <strong style={{ color: 'var(--mc-warn)' }}>Evidence</strong> live from news feed ·&nbsp;
          {quotesLoading ? '⏳ loading quotes…' : <span style={{ color: 'var(--mc-bullish)' }}>✅ {quotes.length} quotes loaded</span>}
        </span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* View toggle */}
        <div style={{ display: 'flex', gap: '0', backgroundColor: '#060E1A', border: '1px solid var(--mc-bg-4)', borderRadius: '8px', overflow: 'hidden' }}>
          {(['universe', 'live'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)} style={{ padding: '6px 14px', background: viewMode === m ? 'color-mix(in srgb, var(--mc-accent) 13%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', color: viewMode === m ? 'var(--mc-accent)' : 'var(--mc-text-4)', fontSize: '11px', fontWeight: viewMode === m ? '700' : '400' }}>
              {m === 'live' ? `📡 Live Discovery (${liveExtra.length}) · ${liveExtra.filter(r => !r.inUniverse).length} new` : `🔬 Framework Anchors (${enriched.length})`}
            </button>
          ))}
        </div>

        {viewMode === 'universe' && (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {multibaggers.length > 0 && (
              <div style={{ padding: '5px 12px', borderRadius: '7px', border: '1px solid color-mix(in srgb, var(--mc-warn) 19%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 3%, transparent)', fontSize: '11px', color: 'var(--mc-warn)', fontWeight: '600' }}>
                ⭐ {multibaggers.length} potential multibaggers
              </div>
            )}
            {withLiveSignal.length > 0 && (
              <div style={{ padding: '5px 12px', borderRadius: '7px', border: '1px solid color-mix(in srgb, var(--mc-bullish) 19%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 3%, transparent)', fontSize: '11px', color: 'var(--mc-bullish)', fontWeight: '600' }}>
                📡 {withLiveSignal.length} with live signal
              </div>
            )}
          </div>
        )}
        {/* PATCH 0455 TIER1-H — Bottleneck → Multibagger pivot. Copies the
            currently-filtered tickers to localStorage and opens Multibagger
            with a custom universe filter. Lets the user rank bottleneck
            winners by composite score with one click. */}
        {(viewMode === 'universe' ? filtered : liveExtra).length > 0 && (
          <button
            onClick={() => {
              const tickers = (viewMode === 'universe' ? filtered : liveExtra)
                .map((r: any) => (r.ticker || r.symbol || '').toString().toUpperCase().replace(/\.NS$|\.BO$/i, ''))
                .filter(Boolean);
              try {
                localStorage.setItem('mc:bottleneck-pivot:v1', JSON.stringify({ tickers, ts: Date.now() }));
                window.location.href = `/multibagger?universe=bottleneck&count=${tickers.length}`;
              } catch (e) {
                console.error('[bottleneck-pivot] failed', e);
              }
            }}
            title="Open these tickers in Multibagger and rank by composite score"
            style={{
              padding: '5px 12px', borderRadius: 7, border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 38%, transparent)',
              background: 'color-mix(in srgb, var(--mc-state-persistent) 8%, transparent)', color: 'var(--mc-state-persistent)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            🎯 Rank these {(viewMode === 'universe' ? filtered : liveExtra).length} in Multibagger →
          </button>
        )}
        <span style={{ fontSize: '11px', color: 'var(--mc-text-4)', marginLeft: 'auto' }}>
          {viewMode === 'universe' ? `${filtered.length} stocks` : `${liveExtra.length} tickers from live news`}
        </span>
      </div>

      {/* Layer filter (universe only) */}
      {viewMode === 'universe' && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '2px' }}>
          {LAYERS.map(lyr => {
            const cnt = lyr === 'ALL' ? enriched.length : enriched.filter(r => r.sub_tag === lyr).length;
            const ti = lyr !== 'ALL' ? TIER_MAP[lyr] : null;
            return (
              <button key={lyr} onClick={() => setFilterLayer(lyr)} style={{
                padding: '4px 10px', borderRadius: '6px', flexShrink: 0,
                border: `1px solid ${filterLayer === lyr ? (ti?.color ?? 'var(--mc-accent)') + '50' : 'var(--mc-bg-4)'}`,
                cursor: 'pointer',
                backgroundColor: filterLayer === lyr ? (ti?.color ?? 'var(--mc-accent)') + '14' : 'transparent',
                color: filterLayer === lyr ? (ti?.color ?? 'var(--mc-accent)') : 'var(--mc-text-4)',
                fontSize: '10px', fontWeight: filterLayer === lyr ? '700' : '400',
              }}>
                {lyr === 'ALL' ? 'ALL' : lyr.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).split(' ').slice(0,2).join(' ')} ({cnt})
              </button>
            );
          })}
        </div>
      )}

      {/* ── Universe view ── */}
      {viewMode === 'universe' && (
        <>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '44px 110px 1fr 160px 90px 70px', gap: '8px', padding: '6px 12px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px', color: 'var(--mc-text-4)', borderBottom: '1px solid var(--mc-bg-4)' }}>
            <span>SCORE</span><span>TICKER</span><span>CHAIN POSITION</span><span>4 SERENITY CHECKS</span><span>MKT CAP</span><span>PRICE</span>
          </div>

          {filtered.map((s, idx) => {
            const ef = exchangeFlag(s.exchange);
            const isExp = expRow === s.ticker;
            const cp = s.change_pct ?? 0;
            const ti = TIER_MAP[s.sub_tag];
            const isMultibagger = s.score >= 70 && s.is_small_cap;
            // These checks mirror the score formula — check2 uses $2B threshold (unified)
            const check1 = s.competitors === '1 public' || s.competitors === '2–3 public';
            const check2 = s.is_small_cap; // is_small_cap = mc < $2B (unified with scoring)
            const check3 = s.exchange !== 'NYSE' && s.exchange !== 'NASDAQ';
            const check4 = s.val_tier <= 4;
            const checksPass = [check1, check2, check3, check4].filter(Boolean).length;
            return (
              <div key={s.ticker} style={{ borderBottom: '1px solid color-mix(in srgb, var(--mc-bg-4) 9%, transparent)' }}>
                <button onClick={() => setExpRow(isExp ? null : s.ticker)} style={{ width: '100%', background: isExp ? 'color-mix(in srgb, var(--mc-bg-1) 25%, transparent)' : idx % 2 === 1 ? '#060E1A14' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '9px 12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '44px 110px 1fr 160px 90px 70px', gap: '8px', alignItems: 'center' }}>
                    {/* Score */}
                    <ScoreGauge score={s.score} />

                    {/* Ticker */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', minWidth: 0 }}>
                      {isMultibagger && <span title="Potential multibagger — high score + small cap" style={{ fontSize: '13px' }}>⭐</span>}
                      <span style={{ fontSize: '12px', fontWeight: '800', color: 'var(--mc-text-0)' }}>{s.ticker.replace(/\d+$/, '')}</span>
                      {ef && <span title={`${ef.label} listed`} style={{ fontSize: '12px' }}>{ef.flag}</span>}
                      {s.is_small_cap && <span style={{ fontSize: '8px', color: 'var(--mc-warn)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', padding: '0 3px', borderRadius: '3px', fontWeight: '700' }}>SC</span>}
                      {s.is_serenity_pick && <span title="Serenity explicitly mentioned this stock" style={{ fontSize: '8px', color: 'var(--mc-state-persistent)', border: '1px solid color-mix(in srgb, var(--mc-state-persistent) 25%, transparent)', padding: '0 3px', borderRadius: '3px', fontWeight: '700' }}>S✓</span>}
                      {s.evidence_count > 0 && <span style={{ fontSize: '8px', color: 'var(--mc-bullish)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', padding: '0 3px', borderRadius: '3px', fontWeight: '700' }}>📡{s.evidence_count}</span>}
                      {s.velocity.trend === '🔥' && <span title={`${s.velocity.week} articles this week vs ${s.velocity.prev} prior week`} style={{ fontSize: '9px', color: 'var(--mc-warn)', fontWeight: '700' }}>🔥</span>}
                      {s.velocity.trend === '📉' && <span style={{ fontSize: '9px', color: 'var(--mc-text-4)' }}>📉</span>}
                    </div>

                    {/* Chain position */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                        {ti && <span style={{ fontSize: '9px', fontWeight: '700', color: ti.color, border: `1px solid ${ti.color}40`, padding: '1px 4px', borderRadius: '3px', flexShrink: 0 }}>T{ti.tier}</span>}
                        <span style={{ fontSize: '11px', color: 'var(--mc-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sub_tag.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {s.key_customers.slice(0,3).map(c => <span key={c} style={{ fontSize: '9px', color: 'var(--mc-accent)', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', padding: '0 4px', borderRadius: '3px' }}>→{c}</span>)}
                      </div>
                    </div>

                    {/* 4 Criteria checks — each failed check penalises score −5pts */}
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '9px', color: checksPass === 4 ? 'var(--mc-bullish)' : checksPass >= 3 ? 'var(--mc-warn)' : 'var(--mc-bearish)', fontWeight: 700, marginBottom: 2 }}>{checksPass}/4 ✓</span>
                      <CriteriaCheck pass={check1} label={`<3 competitors (${s.competitors})`} />
                      <CriteriaCheck pass={check2} label="<$2B mkt cap" />
                      <CriteriaCheck pass={check3} label="Non-US listing" />
                      <CriteriaCheck pass={check4} label={`Tier ≤4 upstream (T${s.val_tier})`} />
                    </div>

                    {/* Market cap */}
                    <span style={{ fontSize: '11px', color: s.is_small_cap ? 'var(--mc-warn)' : 'var(--mc-text-2)', fontWeight: s.is_small_cap ? '700' : '400' }}>{fmtCap(s.market_cap)}</span>

                    {/* Price */}
                    <div>{s.price ? <><span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--mc-text-0)' }}>${s.price.toFixed(2)}</span>{cp !== 0 && <div style={{ fontSize: '10px', color: cp >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{cp >= 0 ? '+' : ''}{cp.toFixed(2)}%</div>}</> : <span style={{ fontSize: '10px', color: 'var(--mc-text-4)' }}>—</span>}</div>
                  </div>
                </button>

                {/* Expanded */}
                {isExp && (
                  <div style={{ padding: '12px 14px 16px 60px', backgroundColor: '#060E1A30', borderTop: '1px solid var(--mc-bg-4)' }}>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--mc-text-2)' }}>{s.name}</span>
                      {s.quote_name && s.quote_name !== s.name && <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>{s.quote_name}</span>}
                      <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>{s.exchange}</span>
                      {ti && <span style={{ fontSize: '11px', color: ti.color }}>{ti.label}</span>}
                    </div>

                    {/* Serenity thesis */}
                    <div style={{ padding: '10px 12px', backgroundColor: '#060E1A', border: '1px solid var(--mc-bg-4)', borderRadius: '8px', marginBottom: '10px' }}>
                      <p style={{ fontSize: '10px', color: 'var(--mc-state-persistent)', fontWeight: '700', letterSpacing: '0.8px', margin: '0 0 6px' }}>🔬 SERENITY THESIS</p>
                      <p style={{ fontSize: '12px', color: 'var(--mc-text-2)', lineHeight: '1.6', margin: 0 }}>{s.serenity_note}</p>
                    </div>

                    {/* Key customers */}
                    <div style={{ marginBottom: '10px' }}>
                      <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontWeight: '700', letterSpacing: '0.8px', margin: '0 0 6px' }}>SUPPLIES → (key customers)</p>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {s.key_customers.map(c => <span key={c} style={{ fontSize: '11px', color: 'var(--mc-accent)', backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-accent) 19%, transparent)', padding: '2px 8px', borderRadius: '5px', fontWeight: '600' }}>{c}</span>)}
                      </div>
                    </div>

                    {/* Live evidence headlines */}
                    {s.headlines.length > 0 && (
                      <div style={{ marginBottom: '10px' }}>
                        <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', fontWeight: '700', letterSpacing: '0.8px', margin: '0 0 6px' }}>📡 LIVE EVIDENCE ({s.evidence_count} articles)</p>
                        {s.headlines.map((h, i) => (
                          <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', padding: '7px 10px', marginBottom: '4px', backgroundColor: '#060E1A', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--mc-bullish) 13%, transparent)' }}>
                            <Zap className="w-3 h-3" style={{ color: 'var(--mc-bullish)', flexShrink: 0, marginTop: '2px' }} />
                            <span style={{ fontSize: '11px', color: 'var(--mc-text-2)', lineHeight: '1.45' }}>{h}</span>
                          </div>
                        ))}
                        {s.latest_at && <p style={{ fontSize: '10px', color: 'var(--mc-text-4)', margin: '4px 0 0' }}>Last signal: {timeAgo(s.latest_at)}</p>}
                      </div>
                    )}

                    {/* Applicable models */}
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                      {s.models.map(m => <Tag key={m} label={`Model ${m}`} color="#8B5CF6" />)}
                      {isMultibagger && <Tag label="⭐ Potential Multibagger" color="#F59E0B" />}
                      {!s.is_small_cap && s.val_tier <= 3 && <Tag label="Upstream anchor — look further upstream" color="#EF4444" />}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── Live Discovery view — discovery-first ── */}
      {viewMode === 'live' && (
        <>
          <div style={{ marginBottom: '10px', padding: '10px 14px', backgroundColor: '#060E1A', border: '1px solid var(--mc-bg-4)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--mc-text-0)', fontWeight: '600' }}>Discovery-first: ranked by live evidence velocity + text signals</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: 'var(--mc-warn)' }}>🆕 NEW = not in framework — research candidate</span>
              <span style={{ fontSize: '10px', color: 'var(--mc-bullish)' }}>✓ TRACKED = in watchlist</span>
              {TEXT_SIGNALS.slice(0,4).map(s => <span key={s.key} style={{ fontSize: '10px', color: s.color }}>{s.icon} {s.label}</span>)}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 100px 1fr 170px 80px', gap: '8px', padding: '6px 12px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.8px', color: 'var(--mc-text-4)', borderBottom: '1px solid var(--mc-bg-4)' }}>
            <span>SIGNALS</span><span>TICKER</span><span>LAYER + SIGNALS DETECTED</span><span>STATUS</span><span>PRICE</span>
          </div>
          {liveExtra.length === 0
            ? <EmptyState msg="No tickers in live bottleneck news right now." />
            : liveExtra.map((r, i) => {
              const ti = r.sub_tag ? TIER_MAP[r.sub_tag] : null;
              const cp = r.change_pct ?? 0;
              const isNew = !r.inUniverse;
              const isHot = r.velocity_week >= 2;
              const sigs = TEXT_SIGNALS.filter(s => r.textSignals.includes(s.key));
              return (
                <div key={r.symbol} style={{
                  display: 'grid', gridTemplateColumns: '60px 100px 1fr 170px 80px', gap: '8px',
                  padding: '10px 12px', borderBottom: '1px solid color-mix(in srgb, var(--mc-bg-4) 9%, transparent)', alignItems: 'center',
                  backgroundColor: isNew ? 'color-mix(in srgb, var(--mc-warn) 2%, transparent)' : i % 2 === 1 ? '#060E1A14' : 'transparent',
                  borderLeft: isNew ? '2px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)' : sigs.length > 0 ? '2px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)' : '2px solid transparent',
                }}>
                  {/* Signal count + velocity */}
                  <div>
                    <span style={{ fontSize: '15px', fontWeight: '800', color: isHot ? 'var(--mc-warn)' : 'var(--mc-text-2)', display: 'block' }}>{r.evidence_count}</span>
                    {isHot && <span style={{ fontSize: '9px', color: 'var(--mc-warn)' }}>🔥{r.velocity_week}wk</span>}
                  </div>

                  {/* Ticker */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: isNew ? 'var(--mc-warn)' : 'var(--mc-text-0)' }}>{r.symbol}</span>
                      {ti && <span style={{ fontSize: '8px', fontWeight: '700', color: ti.color, border: `1px solid ${ti.color}40`, padding: '0 3px', borderRadius: '3px' }}>T{ti.tier}</span>}
                    </div>
                    {r.latest_at && <span style={{ fontSize: '9px', color: 'var(--mc-text-4)' }}>{timeAgo(r.latest_at)}</span>}
                  </div>

                  {/* Layer + text signal badges */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '10px', color: 'var(--mc-text-4)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.sub_tag ? r.sub_tag.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()) : '—'}
                    </div>
                    {sigs.length > 0 && (
                      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                        {sigs.map(s => (
                          <span key={s.key} title={s.label} style={{ fontSize: '9px', fontWeight: '700', color: s.color, backgroundColor: s.color + '14', border: `1px solid ${s.color}30`, padding: '0 5px', borderRadius: '3px' }}>
                            {s.icon} {s.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Status badge */}
                  <span style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px', textAlign: 'center', color: isNew ? 'var(--mc-warn)' : 'var(--mc-bullish)', backgroundColor: isNew ? 'color-mix(in srgb, var(--mc-warn) 8%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: `1px solid ${isNew ? 'color-mix(in srgb, var(--mc-warn) 19%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 19%, transparent)'}` }}>
                    {isNew ? '🆕 NEW PICK' : '✓ TRACKED'}
                  </span>

                  {/* Price */}
                  <div>{r.price ? <><span style={{ fontSize: '12px', color: 'var(--mc-text-0)', fontWeight: '600' }}>${r.price.toFixed(2)}</span>{cp !== 0 && <div style={{ fontSize: '10px', color: cp >= 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)' }}>{cp >= 0 ? '+' : ''}{cp.toFixed(2)}%</div>}</> : <span style={{ fontSize: '11px', color: 'var(--mc-text-4)' }}>—</span>}</div>
                </div>
              );
            })
          }
        </>
      )}
    </div>
  );
}
