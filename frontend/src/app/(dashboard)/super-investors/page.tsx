'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SUPER INVESTOR TRACKER (PATCH 0482)
//
// Coat-tail dashboard for 10 Indian growth/value/quality investors. Two
// sub-views per investor:
//   1. HOLDINGS  — last-disclosed positions with BSE / AIF / commentary tier
//   2. NEWS      — recent news + interviews matched against investor's name
//                  (uses /api/v1/news search)
//
// Roster is curated in lib/super-investors.ts. New investors matching the
// growth / small-mid / management-quality archetype get appended there.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import {
  SUPER_INVESTORS, STYLE_META, TIER_META, getInvestor,
  holdingConviction, aggregateConviction,
  // PATCH 0491 — v4 analytics
  STYLE_SIGNAL_WEIGHT, tickerSector, classifyLifecycle, LIFECYCLE_META,
  buildSimilarityPairs, concentrationStats, crossStyleDivergence,
  type InvestorStyle, type SuperInvestor, type LifecycleStage, type Sector,
} from '@/lib/super-investors';
import { HoldingsFreshnessChip } from '@/components/holdings-freshness-chip';

const BG = '#0A0E1A';
const PANEL = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const MUTED = '#6B7A8D';
const ACCENT = '#22D3EE';

type Tab = 'HOLDINGS' | 'NEWS';

type View = 'ANALYTICS' | 'INVESTORS';
type MarketScope = 'INDIA' | 'GLOBAL' | 'ALL';

// PATCH 0489 — only NSE / BSE = Indian. Anything else is global.
function isIndianExchange(ex?: string): boolean {
  if (!ex) return true; // no tag = assume Indian (legacy data)
  return ex === 'NSE' || ex === 'BSE';
}

export default function SuperInvestorsPage() {
  const [view, setView] = useState<View>('ANALYTICS');
  const [selectedId, setSelectedId] = useState<string>(SUPER_INVESTORS[0].id);
  const [tab, setTab] = useState<Tab>('HOLDINGS');
  const [styleFilter, setStyleFilter] = useState<InvestorStyle | 'ALL'>('ALL');
  // PATCH 0489 — Market scope filter. Default INDIA because the page positions
  // itself as 'growth-style Indian investors'. User can toggle to GLOBAL to
  // see Pabrai's US sleeve (Warrior Met / Transocean) and similar.
  const [marketScope, setMarketScope] = useState<MarketScope>('INDIA');

  const filtered = useMemo(() => {
    if (styleFilter === 'ALL') return SUPER_INVESTORS;
    return SUPER_INVESTORS.filter((i) => i.style === styleFilter);
  }, [styleFilter]);

  // PATCH 0486 QA-#6 — when the style filter changes and the currently
  // selected investor no longer matches, auto-select the first filtered
  // investor so the right detail pane updates immediately.
  useEffect(() => {
    if (filtered.length === 0) return;
    if (!filtered.some((i) => i.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = getInvestor(selectedId) || SUPER_INVESTORS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: BG }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${BORDER}`, backgroundColor: PANEL }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: TEXT, margin: 0 }}>Super Investor Tracker</h1>
          <span style={{
            fontSize: 11, color: ACCENT, fontWeight: 700,
            border: `1px solid ${ACCENT}50`, backgroundColor: `${ACCENT}15`,
            padding: '2px 7px', borderRadius: 4,
          }}>
            {SUPER_INVESTORS.length} INVESTORS
          </span>
          <span style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>
            Holdings + news for growth / small-mid / quality-style Indian investors
          </span>
        </div>

        {/* PATCH 0485 — Top-level view toggle: ANALYTICS vs INVESTORS */}
        <div style={{ display: 'flex', gap: 4, marginTop: 10, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {(['ANALYTICS', 'INVESTORS'] as View[]).map((v) => {
            const isActive = view === v;
            return (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  fontSize: 12, fontWeight: 700, letterSpacing: '0.4px', cursor: 'pointer',
                  border: 'none', background: 'transparent',
                  color: isActive ? ACCENT : MUTED,
                  borderBottom: `2px solid ${isActive ? ACCENT : 'transparent'}`,
                  padding: '6px 14px',
                }}
              >
                {v === 'ANALYTICS' ? '📊 Cross-Investor Analytics' : '👤 Individual Investors'}
              </button>
            );
          })}
          {/* PATCH 0489 — Market scope chip group. User flagged Pabrai's US holdings
              leaking into 'Biggest Bets' on a page positioned as Indian. */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: MUTED, fontWeight: 700, letterSpacing: '0.3px', marginRight: 4 }}>MARKET</span>
            {(['INDIA', 'GLOBAL', 'ALL'] as MarketScope[]).map((m) => {
              const isActive = marketScope === m;
              const color = m === 'INDIA' ? '#10B981' : m === 'GLOBAL' ? '#8B5CF6' : '#22D3EE';
              return (
                <button
                  key={m}
                  onClick={() => setMarketScope(m)}
                  style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.4px', cursor: 'pointer',
                    border: `1px solid ${isActive ? color : BORDER}`,
                    backgroundColor: isActive ? `${color}22` : 'transparent',
                    color: isActive ? color : MUTED,
                    padding: '3px 10px', borderRadius: 4,
                  }}
                >
                  {m === 'INDIA' ? '🇮🇳 INDIA' : m === 'GLOBAL' ? '🌍 GLOBAL' : 'ALL'}
                </button>
              );
            })}
          </div>
        </div>
        <p style={{ color: MUTED, fontSize: 12, margin: '6px 0 0', lineHeight: 1.5, maxWidth: 920 }}>
          Coat-tail intelligence. Each investor card surfaces their last-disclosed top holdings (BSE ≥1% filings,
          AIF portfolio disclosures, or public commentary) plus a live news feed for their public statements and
          portfolio moves. The roster maps to the user&apos;s Multibagger + Earnings Opportunities framework
          (growth + management quality + small/mid bias).
        </p>

        {/* Style filter chips — only relevant in INVESTORS view */}
        {view === 'INVESTORS' && <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {(['ALL', ...Object.keys(STYLE_META)] as Array<InvestorStyle | 'ALL'>).map((s) => {
            const isActive = styleFilter === s;
            const meta = s === 'ALL' ? null : STYLE_META[s as InvestorStyle];
            const label = s === 'ALL' ? 'All Styles' : meta!.label;
            const color = s === 'ALL' ? ACCENT : meta!.color;
            return (
              <button
                key={s}
                onClick={() => setStyleFilter(s)}
                style={{
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${isActive ? color : BORDER}`,
                  backgroundColor: isActive ? `${color}22` : 'transparent',
                  color: isActive ? color : MUTED,
                  padding: '4px 10px', borderRadius: 4,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>}
      </div>

      {/* ── Body — analytics OR two-column investors ──────────────────── */}
      {view === 'ANALYTICS' ? (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <AnalyticsView
            marketScope={marketScope}
            onJumpToInvestor={(id) => { setView('INVESTORS'); setSelectedId(id); }}
          />
        </div>
      ) : (
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '320px 1fr', minHeight: 0 }}>
        {/* Left: investor list */}
        <div style={{
          borderRight: `1px solid ${BORDER}`,
          overflowY: 'auto', backgroundColor: PANEL,
        }}>
          {filtered.map((inv) => {
            const meta = STYLE_META[inv.style];
            const isActive = inv.id === selectedId;
            return (
              <button
                key={inv.id}
                onClick={() => setSelectedId(inv.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  border: 'none', cursor: 'pointer',
                  background: isActive ? `${meta.color}12` : 'transparent',
                  borderLeft: `3px solid ${isActive ? meta.color : 'transparent'}`,
                  padding: '12px 14px',
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: TEXT, fontWeight: 700, fontSize: 14 }}>{inv.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.3px',
                    color: meta.color, border: `1px solid ${meta.color}40`,
                    backgroundColor: `${meta.color}10`,
                    padding: '1px 6px', borderRadius: 3,
                  }}>
                    {meta.label.toUpperCase()}
                  </span>
                  {inv.firm && (
                    <span style={{ fontSize: 10, color: MUTED }}>· {inv.firm}</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>
                  {inv.topHoldings.length} disclosed holdings
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 16, color: MUTED, fontSize: 12, fontStyle: 'italic' }}>
              No investors match this style filter.
            </div>
          )}
        </div>

        {/* Right: investor detail */}
        <div style={{ overflowY: 'auto', padding: 24 }}>
          <InvestorDetail investor={selected} tab={tab} setTab={setTab} marketScope={marketScope} />
        </div>
      </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH 0485 — Cross-investor analytics view
//
// Aggregates the roster's disclosed holdings to surface:
//   1. STATS STRIP — total investors, total holdings, average stake, consensus picks
//   2. CONSENSUS PICKS — stocks held by 3+ investors (highest conviction tickers)
//   3. TOP STAKES — single-investor positions ≥5% (biggest individual bets)
//   4. STYLE DISTRIBUTION — how the roster breaks across investing archetypes
//   5. SUGGESTIONS — actionable patterns: quality-overlap, multibagger-consensus, etc.
//
// Everything is computed in-memory from SUPER_INVESTORS so the moment a new
// investor or new holding is added to the roster, the dashboard reflects it.
// ─────────────────────────────────────────────────────────────────────────

interface PickCount {
  ticker: string;
  company: string;
  investors: { id: string; name: string; stakePct?: number; style: InvestorStyle; conviction: number }[];
  totalStakePct: number;
  styles: Set<InvestorStyle>;
  // PATCH 0487/0488 — weighted conviction across all holders
  aggregateConviction: number;
  exchange?: string;
  // PATCH 0491 — v4 derived signals
  styleAdjustedConviction: number;
  sector: Sector;
  lifecycle: LifecycleStage;
  divergent: boolean;
  divergencePattern?: 'GROWTH_VS_VALUE' | 'QUALITY_VS_MULTIBAGGER';
}

function buildPickCounts(marketScope: MarketScope = 'INDIA'): PickCount[] {
  const map = new Map<string, PickCount>();
  for (const inv of SUPER_INVESTORS) {
    for (const h of inv.topHoldings) {
      if (marketScope === 'INDIA' && !isIndianExchange(h.exchange)) continue;
      if (marketScope === 'GLOBAL' && isIndianExchange(h.exchange)) continue;
      if (!map.has(h.ticker)) {
        map.set(h.ticker, {
          ticker: h.ticker, company: h.company,
          investors: [], totalStakePct: 0, styles: new Set(),
          aggregateConviction: 0, exchange: h.exchange,
          // Filled in pass-2
          styleAdjustedConviction: 0,
          sector: 'Other',
          lifecycle: 'EMERGING',
          divergent: false,
        });
      }
      const pc = map.get(h.ticker)!;
      const conv = holdingConviction({
        investorId: inv.id, stakePct: h.stakePct, tier: h.tier, disclosedOn: h.disclosedOn,
      });
      pc.investors.push({ id: inv.id, name: inv.name, stakePct: h.stakePct, style: inv.style, conviction: conv });
      pc.totalStakePct += h.stakePct || 0;
      pc.styles.add(inv.style);
      pc.aggregateConviction += conv;
      if (!pc.exchange && h.exchange) pc.exchange = h.exchange;
    }
  }
  // PATCH 0491 v4 — pass 2: derive style-adjusted conviction + lifecycle + sector + divergence
  for (const pc of map.values()) {
    let adj = 0;
    let qualityHolderCount = 0;
    let recentDisclosures = 0;
    for (const iv of pc.investors) {
      adj += iv.conviction * STYLE_SIGNAL_WEIGHT[iv.style];
      if (iv.style === 'CONCENTRATED_QUALITY' || iv.style === 'THEMATIC_STRUCTURAL') qualityHolderCount++;
    }
    pc.styleAdjustedConviction = Math.round(adj);
    pc.sector = tickerSector(pc.ticker);
    pc.lifecycle = classifyLifecycle({
      holderCount: pc.investors.length,
      qualityHolderCount,
      recentDisclosures,
    });
    const div = crossStyleDivergence(Array.from(pc.styles));
    pc.divergent = div.isDivergent;
    pc.divergencePattern = div.pattern;
  }
  // Primary sort by style-adjusted conviction (was raw aggregate)
  return Array.from(map.values())
    .sort((a, b) => b.styleAdjustedConviction - a.styleAdjustedConviction);
}

interface FlowRow {
  ticker: string; company: string;
  addCount: number; exitCount: number; netActions: number;
  totalSignalScore: number; investors: string[];
  topDirection: 'ACCUM' | 'DISTRIB' | 'MIXED' | 'NEUTRAL';
  lastMoveAt: string;
}

function AnalyticsView({ marketScope, onJumpToInvestor }: { marketScope: MarketScope; onJumpToInvestor: (id: string) => void }) {
  // PATCH 0493 — Flow Momentum (cross-investor accumulation heatmap)
  const [flowData, setFlowData] = useState<{ rows: FlowRow[]; counts: { total: number; accumulation: number; distribution: number; mixed: number }; cached?: boolean } | null>(null);
  // PATCH 0966 — Pattern C: flow fetch had no timeout and silently swallowed
  // errors. If /api/v1/super-investor-flow is down the section just never
  // appeared (no banner, no spinner). Now: 20s AbortSignal timeout +
  // dev-only console.warn so future debugging surfaces the failure mode.
  useEffect(() => {
    let alive = true;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    fetch('/api/v1/super-investor-flow?days=30', { cache: 'no-store', signal: ctl.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (alive && d) setFlowData(d); })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[super-investors] flow fetch failed:', err);
        }
      })
      .finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); ctl.abort(); };
  }, []);

  // PATCH 0493 — Conviction Delta via client-side snapshot.
  // Persist today's conviction-by-ticker map to localStorage. On next visit
  // (different day), compute delta vs prior snapshot.
  const [convictionDelta, setConvictionDelta] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const SNAPSHOT_KEY = 'mc:super-investor-conviction-snapshot:v1';
      const raw = localStorage.getItem(SNAPSHOT_KEY);
      const cur: Record<string, number> = {};
      // Build today's map from current picks (computed by parent buildPickCounts)
      for (const inv of SUPER_INVESTORS) {
        for (const h of inv.topHoldings) {
          const k = h.ticker.toUpperCase();
          const c = holdingConviction({
            investorId: inv.id, stakePct: h.stakePct, tier: h.tier, disclosedOn: h.disclosedOn,
          });
          cur[k] = (cur[k] || 0) + c;
        }
      }
      // Compare with prior snapshot
      if (raw) {
        try {
          const prior = JSON.parse(raw) as { date: string; map: Record<string, number> };
          if (prior.date && prior.date !== today) {
            const delta: Record<string, number> = {};
            const allKeys = new Set([...Object.keys(cur), ...Object.keys(prior.map || {})]);
            for (const k of allKeys) {
              const d = (cur[k] || 0) - ((prior.map || {})[k] || 0);
              if (d !== 0) delta[k] = d;
            }
            setConvictionDelta(delta);
          }
        } catch {}
      }
      // Always write today's snapshot (overwrite same-day)
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ date: today, map: cur }));
    } catch {}
  }, []);

  const data = useMemo(() => {
    const inScope = (ex?: string) =>
      marketScope === 'ALL' ? true
        : marketScope === 'INDIA' ? isIndianExchange(ex)
        : !isIndianExchange(ex);
    const picks = buildPickCounts(marketScope);
    const totalHoldings = SUPER_INVESTORS.reduce(
      (s, i) => s + i.topHoldings.filter((h) => inScope(h.exchange)).length, 0,
    );
    const allStakes = SUPER_INVESTORS.flatMap((i) =>
      i.topHoldings.filter((h) => inScope(h.exchange))
        .map((h) => h.stakePct).filter((x): x is number => typeof x === 'number')
    );
    const avgStake = allStakes.length > 0
      ? allStakes.reduce((a, b) => a + b, 0) / allStakes.length
      : 0;
    const consensus = picks.filter((p) => p.investors.length >= 2);
    const consensus3plus = consensus.filter((p) => p.investors.length >= 3);

    // Top single-investor stakes ≥ 5% — within market scope
    const bigStakes: Array<{ inv: SuperInvestor; ticker: string; company: string; stakePct: number; exchange?: string }> = [];
    for (const inv of SUPER_INVESTORS) {
      for (const h of inv.topHoldings) {
        if (!inScope(h.exchange)) continue;
        if ((h.stakePct || 0) >= 5) {
          bigStakes.push({ inv, ticker: h.ticker, company: h.company, stakePct: h.stakePct as number, exchange: h.exchange });
        }
      }
    }
    bigStakes.sort((a, b) => b.stakePct - a.stakePct);

    // Style distribution
    const styleCounts: Record<string, number> = {};
    for (const inv of SUPER_INVESTORS) {
      styleCounts[inv.style] = (styleCounts[inv.style] || 0) + 1;
    }

    // PATCH 0491 v4 — sector exposure, similarity pairs, lifecycle dist, concentration
    const sectorExposure: Record<string, { count: number; conviction: number; tickers: string[] }> = {};
    for (const p of picks) {
      if (!sectorExposure[p.sector]) sectorExposure[p.sector] = { count: 0, conviction: 0, tickers: [] };
      sectorExposure[p.sector].count++;
      sectorExposure[p.sector].conviction += p.styleAdjustedConviction;
      if (sectorExposure[p.sector].tickers.length < 5) sectorExposure[p.sector].tickers.push(p.ticker);
    }
    const sectorRanked = Object.entries(sectorExposure)
      .map(([s, v]) => ({ sector: s, ...v }))
      .sort((a, b) => b.conviction - a.conviction);

    const lifecycleCounts: Record<string, number> = {};
    for (const p of picks) lifecycleCounts[p.lifecycle] = (lifecycleCounts[p.lifecycle] || 0) + 1;

    const similarityPairs = buildSimilarityPairs(8);
    const conc = concentrationStats(picks.map((p) => p.styleAdjustedConviction));
    // Emerging signals: 1-holder picks with recent disclosure (≤90d), filtered to current scope
    const earlySignals = picks
      .filter((p) => p.investors.length === 1)
      .slice(0, 10);
    // Cross-style divergence picks
    const divergents = picks.filter((p) => p.divergent).slice(0, 8);

    return {
      picks, consensus, consensus3plus, totalHoldings, avgStake,
      bigStakes: bigStakes.slice(0, 12),
      styleCounts,
      sectorRanked, lifecycleCounts, similarityPairs, conc, earlySignals, divergents,
    };
  }, [marketScope]);

  // Build dynamic suggestions
  const suggestions = useMemo(() => buildSuggestions(data.picks), [data]);

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <StatCard label="Investors tracked" value={String(SUPER_INVESTORS.length)} accent="#22D3EE" />
        <StatCard label="Disclosed holdings" value={String(data.totalHoldings)} accent="#10B981" />
        <StatCard label="Avg disclosed stake" value={`${data.avgStake.toFixed(1)}%`} accent="#F59E0B" />
        <StatCard label="Consensus picks (2+ investors)" value={String(data.consensus.length)} accent="#8B5CF6" />
        <StatCard label="High-conviction (3+ investors)" value={String(data.consensus3plus.length)} accent="#EC4899" />
        <StatCard label="Mega stakes (≥5% single inv)" value={String(data.bigStakes.length)} accent="#EF4444" />
      </div>

      {/* PATCH 0491 v4 — Risk Concentration Warning */}
      {data.conc.total > 0 && (
        <div style={{
          padding: '10px 14px', borderRadius: 6,
          border: `1px solid ${data.conc.top5Pct > 50 ? 'color-mix(in srgb, var(--mc-bearish) 38%, transparent)' : data.conc.top5Pct > 35 ? 'color-mix(in srgb, var(--mc-warn) 38%, transparent)' : 'color-mix(in srgb, var(--mc-bullish) 25%, transparent)'}`,
          backgroundColor: `${data.conc.top5Pct > 50 ? 'var(--mc-bearish)' : data.conc.top5Pct > 35 ? 'var(--mc-warn)' : 'var(--mc-bullish)'}10`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '0.4px',
              color: data.conc.top5Pct > 50 ? 'var(--mc-bearish)' : data.conc.top5Pct > 35 ? 'var(--mc-warn)' : 'var(--mc-bullish)',
            }}>
              {data.conc.top5Pct > 50 ? '⚠ HIGH' : data.conc.top5Pct > 35 ? '◐ MED' : '✓ LOW'} CONCENTRATION
            </span>
            <span style={{ fontSize: 12, color: TEXT }}>
              Top 5 picks represent <strong>{data.conc.top5Pct}%</strong> of total conviction · Top 10 = <strong>{data.conc.top10Pct}%</strong> · HHI {data.conc.hhi}
            </span>
            <span style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>
              {data.conc.top5Pct > 50 ? 'Crowding risk — diversify beyond top picks' :
               data.conc.top5Pct > 35 ? 'Moderate concentration; reasonable for high-conviction roster' :
               'Well-diversified conviction across the roster'}
            </span>
          </div>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Section title="💡 PATTERN-BASED SUGGESTIONS" subtitle="Detected across the roster — not a recommendation; analyst starting points only">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestions.map((s, i) => (
              <div key={i} style={{
                padding: '10px 12px', borderRadius: 6,
                border: `1px solid ${s.color}40`, backgroundColor: `${s.color}10`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.4px',
                    color: s.color, border: `1px solid ${s.color}60`,
                    backgroundColor: `${s.color}18`,
                    padding: '2px 7px', borderRadius: 3,
                  }}>{s.tag}</span>
                  <span style={{ color: TEXT, fontWeight: 600, fontSize: 13 }}>{s.title}</span>
                </div>
                <div style={{ color: 'var(--mc-text-2)', fontSize: 12, lineHeight: 1.5 }}>{s.body}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Consensus picks (3+) */}
      <Section title={`🏆 CONSENSUS PICKS — 3+ INVESTORS (${data.consensus3plus.length})`} subtitle="Stocks owned by 3 or more super investors — highest conviction across the roster">
        <ConsensusTable rows={data.consensus3plus} onJumpToInvestor={onJumpToInvestor} convictionDelta={convictionDelta} />
      </Section>

      {/* Consensus picks (2 investor overlap) */}
      <Section title={`🤝 2-INVESTOR OVERLAPS (${data.consensus.length - data.consensus3plus.length})`} subtitle="Stocks held by exactly 2 super investors">
        <ConsensusTable rows={data.consensus.filter((p) => p.investors.length === 2).slice(0, 25)} onJumpToInvestor={onJumpToInvestor} convictionDelta={convictionDelta} />
      </Section>

      {/* Top single stakes */}
      <Section title={`📈 BIGGEST INDIVIDUAL BETS — STAKE ≥5%`} subtitle="Single-investor positions ≥5% — the strongest conviction bets in the roster">
        <div style={{
          border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: PANEL }}>
                <th style={thStyle}>Investor</th>
                <th style={thStyle}>Ticker</th>
                <th style={thStyle}>Company</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Stake</th>
              </tr>
            </thead>
            <tbody>
              {data.bigStakes.map((b, i) => {
                const meta = STYLE_META[b.inv.style];
                return (
                  // AUDIT_100 #8 — stable composite key from inv id + ticker.
                  <tr key={`${b.inv.id}|${b.ticker}|${i}`} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td style={tdStyle}>
                      <button onClick={() => onJumpToInvestor(b.inv.id)} style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: meta.color, fontWeight: 700, padding: 0, textAlign: 'left',
                      }}>
                        {b.inv.name}
                      </button>
                    </td>
                    <td style={tdStyle}>
                      <a href={`/stock-sheet?ticker=${b.ticker}`} style={{
                        color: TEXT, fontWeight: 700,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        textDecoration: 'none',
                      }}>
                        {b.exchange ? <span style={{ color: 'var(--mc-cyan)', fontWeight: 500, fontSize: 10 }}>{b.exchange}:</span> : null}{b.ticker}
                      </a>
                    </td>
                    <td style={tdStyle}>{b.company}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--mc-bullish)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {b.stakePct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* PATCH 0493 — FLOW MOMENTUM (cross-investor accumulation heatmap) */}
      {flowData && flowData.rows.length > 0 && (
        <Section
          title={`💰 FLOW MOMENTUM — 30D NET ACTIVITY ACROSS ALL INVESTORS (${flowData.counts.accumulation} ACCUM · ${flowData.counts.distribution} DISTRIB · ${flowData.counts.mixed} MIXED)`}
          subtitle="Aggregated parsed BUY/ADD/TRIM/EXIT moves across the 21-investor roster — institutional accumulation heatmap"
        >
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: PANEL }}>
                  <th style={thStyle}>Company</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Adds</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Exits</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Net</th>
                  <th style={thStyle}>Direction</th>
                  <th style={thStyle}>Investors</th>
                </tr>
              </thead>
              <tbody>
                {flowData.rows.slice(0, 25).map((row, i) => {
                  const dirMeta = row.topDirection === 'ACCUM'   ? { color: '#10B981', icon: '↑', label: 'ACCUMULATION' }
                                 : row.topDirection === 'DISTRIB' ? { color: '#EF4444', icon: '↓', label: 'DISTRIBUTION' }
                                 : row.topDirection === 'MIXED'   ? { color: '#F59E0B', icon: '↔', label: 'MIXED FLOW'   }
                                 : { color: '#94A3B8', icon: '·', label: 'NEUTRAL' };
                  return (
                    // AUDIT_100 #8 — stable composite key on flow rows so child state survives re-sort.
                    <tr key={row.company || row.ticker || i} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={tdStyle}>{row.company}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--mc-bullish)', fontWeight: 700 }}>+{row.addCount}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--mc-bearish)', fontWeight: 700 }}>-{row.exitCount}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800,
                        color: row.netActions > 0 ? 'var(--mc-bullish)' : row.netActions < 0 ? 'var(--mc-bearish)' : MUTED,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {row.netActions > 0 ? '+' : ''}{row.netActions}
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          fontSize: 10, fontWeight: 800, letterSpacing: '0.3px',
                          color: dirMeta.color, border: `1px solid ${dirMeta.color}50`,
                          backgroundColor: `${dirMeta.color}15`,
                          padding: '2px 7px', borderRadius: 3,
                        }}>{dirMeta.icon} {dirMeta.label}</span>
                      </td>
                      <td style={{ ...tdStyle, color: MUTED, fontSize: 11 }}>
                        {row.investors.slice(0, 4).join(', ')}{row.investors.length > 4 ? ` +${row.investors.length - 4}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* PATCH 0491 v4 — EARLY SIGNAL DETECTOR */}
      {data.earlySignals.length > 0 && (
        <Section
          title={`🌱 EARLY SIGNALS — SINGLE-INVESTOR PICKS (${data.earlySignals.length})`}
          subtitle="Stocks owned by exactly one super investor — alpha candidates before consensus forms"
        >
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: PANEL }}>
                  <th style={thStyle}>Ticker</th>
                  <th style={thStyle}>Company</th>
                  <th style={thStyle}>Sector</th>
                  <th style={thStyle}>Investor</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Stake</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Style-Adj Conv</th>
                </tr>
              </thead>
              <tbody>
                {data.earlySignals.slice(0, 10).map((p) => {
                  const iv = p.investors[0];
                  const meta = STYLE_META[iv.style];
                  return (
                    <tr key={p.ticker} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={tdStyle}>
                        <a href={`/stock-sheet?ticker=${p.ticker}`} style={{
                          color: TEXT, fontWeight: 700,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          textDecoration: 'none',
                        }}>
                          {p.exchange ? <span style={{ color: 'var(--mc-cyan)', fontWeight: 500, fontSize: 10 }}>{p.exchange}:</span> : null}{p.ticker}
                        </a>
                      </td>
                      <td style={tdStyle}>{p.company}</td>
                      <td style={{ ...tdStyle, color: MUTED, fontSize: 11 }}>{p.sector}</td>
                      <td style={tdStyle}>
                        <button onClick={() => onJumpToInvestor(iv.id)} style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: meta.color, fontWeight: 700, padding: 0, textAlign: 'left',
                        }}>
                          {iv.name}
                        </button>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--mc-bullish)', fontVariantNumeric: 'tabular-nums' }}>
                        {iv.stakePct != null ? `${iv.stakePct.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: 'var(--mc-cyan)', fontVariantNumeric: 'tabular-nums' }}>
                        {p.styleAdjustedConviction}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* PATCH 0491 v4 — CROSS-STYLE DIVERGENCE */}
      {data.divergents.length > 0 && (
        <Section
          title={`⚡ CROSS-STYLE DIVERGENCE (${data.divergents.length})`}
          subtitle="Stocks where opposing-style investors hold simultaneously — re-rating signal candidates"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.divergents.map((p) => {
              const patternColor = p.divergencePattern === 'GROWTH_VS_VALUE' ? '#F59E0B' : '#8B5CF6';
              const patternLabel = p.divergencePattern === 'GROWTH_VS_VALUE'
                ? 'Growth & Value disagreement'
                : 'Quality & Multibagger disagreement';
              return (
                <div key={p.ticker} style={{
                  padding: '8px 12px', borderRadius: 4,
                  border: `1px solid ${patternColor}30`, backgroundColor: `${patternColor}08`,
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                }}>
                  <a href={`/stock-sheet?ticker=${p.ticker}`} style={{
                    color: TEXT, fontWeight: 800,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textDecoration: 'none',
                  }}>{p.ticker}</a>
                  <span style={{ fontSize: 12, color: TEXT }}>{p.company}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: patternColor,
                    border: `1px solid ${patternColor}50`, backgroundColor: `${patternColor}18`,
                    padding: '2px 7px', borderRadius: 3,
                  }}>{patternLabel}</span>
                  <span style={{ fontSize: 11, color: MUTED, marginLeft: 'auto' }}>
                    {Array.from(p.styles).map((s) => STYLE_META[s].label).join(' / ')}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* PATCH 0491 v4 — SECTOR / THEME EXPOSURE MAP */}
      <Section title="🧭 SECTOR EXPOSURE MAP" subtitle="What smart money is collectively betting on — total conviction by sector">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.sectorRanked.slice(0, 12).map((s) => {
            const max = data.sectorRanked[0]?.conviction || 1;
            const pct = Math.round((s.conviction / max) * 100);
            const tone = pct >= 70 ? '#10B981' : pct >= 40 ? '#22D3EE' : '#94A3B8';
            return (
              <div key={s.sector} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: TEXT, fontWeight: 600, minWidth: 170 }}>{s.sector}</span>
                <span style={{ fontSize: 10, color: MUTED, minWidth: 30, textAlign: 'right' }}>{s.count}</span>
                <div style={{ flex: 1, height: 10, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
                </div>
                <span style={{ fontSize: 11, color: tone, fontWeight: 700, minWidth: 60, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {s.conviction}
                </span>
                <span style={{ fontSize: 10, color: MUTED, fontStyle: 'italic', minWidth: 220 }}>
                  {s.tickers.slice(0, 4).join(', ')}{s.tickers.length > 4 ? '…' : ''}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* PATCH 0491 v4 — IDEA LIFECYCLE DISTRIBUTION */}
      <Section title="📈 IDEA LIFECYCLE — DISTRIBUTION BY STAGE" subtitle="Where each pick sits on the conviction-formation curve">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(['EMERGING','EARLY_ENTRY','CONSENSUS_BUILDING','PEAK_OWNERSHIP','MATURE_COMPOUNDER'] as LifecycleStage[]).map((stage) => {
            const meta = LIFECYCLE_META[stage];
            const count = data.lifecycleCounts[stage] || 0;
            const total = Object.values(data.lifecycleCounts).reduce((a, b) => a + b, 0) || 1;
            const pct = Math.round((count / total) * 100);
            return (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>{meta.icon}</span>
                <span style={{ fontSize: 11, color: meta.color, fontWeight: 700, minWidth: 200 }}>{meta.label}</span>
                <span style={{ fontSize: 11, color: MUTED, minWidth: 30, textAlign: 'right' }}>{count}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: meta.color }} />
                </div>
                <span style={{ fontSize: 10, color: MUTED, minWidth: 40, textAlign: 'right' }}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* PATCH 0491 v4 — INVESTOR SIMILARITY MATRIX (top pairs) */}
      {data.similarityPairs.length > 0 && (
        <Section title="🔗 INVESTOR SIMILARITY — WHO BEHAVES LIKE WHOM" subtitle="Top investor pairs by holdings overlap (Jaccard index)">
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: PANEL }}>
                  <th style={thStyle}>Investor A</th>
                  <th style={thStyle}>Investor B</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Similarity</th>
                  <th style={thStyle}>Shared Picks</th>
                </tr>
              </thead>
              <tbody>
                {data.similarityPairs.map((pair, i) => {
                  const ma = STYLE_META[pair.a.style];
                  const mb = STYLE_META[pair.b.style];
                  return (
                    // AUDIT_100 #8 — stable key from investor ids.
                    <tr key={`${pair.a.id}|${pair.b.id}|${i}`} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={tdStyle}>
                        <button onClick={() => onJumpToInvestor(pair.a.id)} style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: ma.color, fontWeight: 700, padding: 0, textAlign: 'left',
                        }}>{pair.a.name}</button>
                      </td>
                      <td style={tdStyle}>
                        <button onClick={() => onJumpToInvestor(pair.b.id)} style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: mb.color, fontWeight: 700, padding: 0, textAlign: 'left',
                        }}>{pair.b.name}</button>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800,
                        color: pair.sim >= 0.4 ? 'var(--mc-bullish)' : pair.sim >= 0.2 ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {pair.sim.toFixed(2)}
                      </td>
                      <td style={{ ...tdStyle, color: MUTED, fontSize: 11 }}>
                        {pair.overlap.slice(0, 5).join(', ')}{pair.overlap.length > 5 ? `… +${pair.overlap.length - 5}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Style distribution */}
      <Section title="🧬 STYLE DISTRIBUTION" subtitle="How the tracked roster breaks across investing archetypes">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(data.styleCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([style, count]) => {
              const meta = STYLE_META[style as InvestorStyle];
              const pct = (count / SUPER_INVESTORS.length) * 100;
              return (
                <div key={style} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.3px',
                    color: meta.color, minWidth: 180,
                  }}>{meta.label}</span>
                  <span style={{ fontSize: 11, color: MUTED, minWidth: 24 }}>{count}</span>
                  <div style={{ flex: 1, height: 8, background: 'var(--mc-bg-4)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: meta.color }} />
                  </div>
                  <span style={{ fontSize: 11, color: MUTED, minWidth: 40, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                </div>
              );
            })}
        </div>
      </Section>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 6,
      border: `1px solid ${accent}40`, backgroundColor: PANEL,
    }}>
      <div style={{ fontSize: 11, color: MUTED, letterSpacing: '0.3px', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: accent, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: ACCENT, fontWeight: 700, letterSpacing: '0.4px' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function ConsensusTable({ rows, onJumpToInvestor, convictionDelta = {} }: { rows: PickCount[]; onJumpToInvestor: (id: string) => void; convictionDelta?: Record<string, number> }) {
  if (rows.length === 0) {
    return <div style={{ color: MUTED, fontSize: 12, fontStyle: 'italic', padding: 12 }}>None yet.</div>;
  }
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ backgroundColor: PANEL }}>
            <th style={thStyle}>Ticker</th>
            <th style={thStyle}>Company</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Held by</th>
            <th style={{ ...thStyle, textAlign: 'right' }} title="Weighted conviction: investor quality × stake × tier × recency">Conviction</th>
            <th style={thStyle}>Investors</th>
            <th style={thStyle}>Styles</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.ticker} style={{ borderTop: `1px solid ${BORDER}` }}>
              <td style={tdStyle}>
                <a href={`/stock-sheet?ticker=${p.ticker}`} style={{
                  color: TEXT, fontWeight: 700,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  textDecoration: 'none',
                }}>
                  {p.exchange ? <span style={{ color: 'var(--mc-cyan)', fontWeight: 500 }}>{p.exchange}:</span> : null}{p.ticker}
                </a>
              </td>
              <td style={tdStyle}>{p.company}</td>
              <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 800, color: 'var(--mc-bullish)' }}>
                {p.investors.length}
              </td>
              {/* PATCH 0491 v4 — Conviction column (style-adjusted) + PATCH 0493 delta chip */}
              <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} title={`Style-adjusted weighted conviction across ${p.investors.length} holders. Base ${p.aggregateConviction} × style mix.`}>
                <span style={{
                  fontSize: 12, fontWeight: 800,
                  color: p.styleAdjustedConviction >= 220 ? 'var(--mc-bullish)'
                       : p.styleAdjustedConviction >= 130 ? 'var(--mc-cyan)'
                       : p.styleAdjustedConviction >= 70  ? 'var(--mc-warn)'
                       : 'var(--mc-text-3)',
                }}>
                  {p.styleAdjustedConviction}
                </span>
                {/* PATCH 0493 — Conviction Delta vs prior snapshot */}
                {convictionDelta[p.ticker.toUpperCase()] !== undefined && convictionDelta[p.ticker.toUpperCase()] !== 0 && (
                  <span title="Change vs prior daily snapshot" style={{
                    marginLeft: 5, fontSize: 10, fontWeight: 700,
                    color: convictionDelta[p.ticker.toUpperCase()] > 0 ? 'var(--mc-bullish)' : 'var(--mc-bearish)',
                  }}>
                    {convictionDelta[p.ticker.toUpperCase()] > 0 ? '▲' : '▼'}{Math.abs(convictionDelta[p.ticker.toUpperCase()])}
                  </span>
                )}
                {/* Lifecycle chip */}
                <div style={{ marginTop: 3 }}>
                  <span title={LIFECYCLE_META[p.lifecycle].label} style={{
                    fontSize: 9, fontWeight: 700,
                    color: LIFECYCLE_META[p.lifecycle].color,
                    border: `1px solid ${LIFECYCLE_META[p.lifecycle].color}40`,
                    backgroundColor: `${LIFECYCLE_META[p.lifecycle].color}10`,
                    padding: '1px 5px', borderRadius: 3,
                  }}>
                    {LIFECYCLE_META[p.lifecycle].icon} {p.lifecycle.replace('_', ' ')}
                  </span>
                </div>
              </td>
              <td style={tdStyle}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {p.investors.map((iv) => {
                    const meta = STYLE_META[iv.style];
                    return (
                      <button
                        key={iv.id}
                        onClick={() => onJumpToInvestor(iv.id)}
                        title={iv.stakePct != null ? `${iv.stakePct.toFixed(1)}% stake` : ''}
                        style={{
                          fontSize: 10, fontWeight: 700, cursor: 'pointer',
                          color: meta.color, border: `1px solid ${meta.color}40`,
                          backgroundColor: `${meta.color}10`,
                          padding: '2px 6px', borderRadius: 3,
                        }}
                      >
                        {iv.name.split(' ')[0]}{iv.stakePct != null ? ` ${iv.stakePct.toFixed(1)}%` : ''}
                      </button>
                    );
                  })}
                </div>
              </td>
              <td style={tdStyle}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {Array.from(p.styles).map((st) => {
                    const meta = STYLE_META[st];
                    return (
                      <span key={st} style={{
                        fontSize: 9, fontWeight: 700,
                        color: meta.color, border: `1px solid ${meta.color}40`,
                        backgroundColor: `${meta.color}08`,
                        padding: '1px 5px', borderRadius: 3,
                      }}>{meta.label}</span>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Suggestion { tag: string; title: string; body: string; color: string; }

function buildSuggestions(picks: PickCount[]): Suggestion[] {
  const out: Suggestion[] = [];

  // 1. Quality compounder overlap (Mukherjea / Bakshi / Rekha J / Damani)
  const qualityIds = new Set(['saurabh-mukherjea', 'sanjay-bakshi', 'rekha-jhunjhunwala', 'ramesh-damani', 'basant-maheshwari']);
  const qualityPicks = picks.filter((p) => p.investors.some((i) => qualityIds.has(i.id)) && p.investors.length >= 2);
  if (qualityPicks.length > 0) {
    out.push({
      tag: 'QUALITY COMPOUNDERS',
      title: `${qualityPicks.length} names held by 2+ quality-style investors`,
      body: `Compounder-style overlap: ${qualityPicks.slice(0, 6).map((p) => p.ticker).join(', ')}${qualityPicks.length > 6 ? '…' : ''}. These tend to be long-hold core positions — typically lower-volatility long-cycle compounders.`,
      color: '#22D3EE',
    });
  }

  // 2. Small/mid multibagger consensus (Kacholia / Kedia / Mukul / Dolly)
  const smallMidIds = new Set(['ashish-kacholia', 'vijay-kedia', 'mukul-agrawal', 'dolly-khanna', 'manish-bhandari']);
  const smCaps = picks.filter((p) => p.investors.some((i) => smallMidIds.has(i.id)) && p.investors.length >= 2);
  if (smCaps.length > 0) {
    out.push({
      tag: 'MULTIBAGGER CONSENSUS',
      title: `${smCaps.length} small/mid names with 2+ multibagger-style backers`,
      body: `High-conviction small/mid-cap overlap: ${smCaps.slice(0, 6).map((p) => p.ticker).join(', ')}${smCaps.length > 6 ? '…' : ''}. These are the names most likely to fit the user's Multibagger framework.`,
      color: '#10B981',
    });
  }

  // 3. Cyclical recovery (Porinju / Anil Goel)
  const cyclicalIds = new Set(['porinju-veliyath', 'anil-kumar-goel']);
  const cyclicals = picks.filter((p) => p.investors.some((i) => cyclicalIds.has(i.id)));
  if (cyclicals.length > 0) {
    out.push({
      tag: 'CONTRARIAN VALUE',
      title: `${cyclicals.length} contrarian-value picks (Porinju / Anil Goel overlap with broader roster)`,
      body: `Cyclical / turnaround candidates that also appear in the broader roster: ${cyclicals.slice(0, 5).map((p) => p.ticker).join(', ')}${cyclicals.length > 5 ? '…' : ''}. Pair with the EO Special-Situations module for filing-date catalysts.`,
      color: '#F59E0B',
    });
  }

  // 4. Structural / Bottleneck overlap (Andrade / Vora / Singhania / Khemani)
  const themIds = new Set(['kenneth-andrade', 'nikhil-vora', 'sunil-singhania', 'vikas-khemani']);
  const themPicks = picks.filter((p) => p.investors.some((i) => themIds.has(i.id)) && p.investors.length >= 2);
  if (themPicks.length > 0) {
    out.push({
      tag: 'STRUCTURAL THEMES',
      title: `${themPicks.length} structural / thematic stocks with overlap`,
      body: `Bottleneck + supply-side + thematic conviction: ${themPicks.slice(0, 6).map((p) => p.ticker).join(', ')}${themPicks.length > 6 ? '…' : ''}. Cross-check with the Transmission + Bottleneck Intel pages.`,
      color: '#8B5CF6',
    });
  }

  return out;
}


// ──────────────────────────────────────────────────────────────────────────

function InvestorDetail({
  investor, tab, setTab, marketScope,
}: {
  investor: SuperInvestor;
  tab: Tab;
  setTab: (t: Tab) => void;
  marketScope: MarketScope;
}) {
  const meta = STYLE_META[investor.style];

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: TEXT, margin: 0, marginBottom: 6 }}>
          {investor.name}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
            color: meta.color, border: `1px solid ${meta.color}50`,
            backgroundColor: `${meta.color}15`,
            padding: '3px 8px', borderRadius: 4,
          }}>
            {meta.label}
          </span>
          {investor.firm && (
            <span style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>{investor.firm}</span>
          )}
          {investor.yearsActive && (
            <span style={{ fontSize: 11, color: MUTED }}>· active {investor.yearsActive}</span>
          )}
          {investor.twitter && (
            <a
              href={`https://x.com/${investor.twitter}`}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: ACCENT, textDecoration: 'none' }}
            >
              @{investor.twitter}
            </a>
          )}
          {investor.website && (
            <a
              href={investor.website}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: ACCENT, textDecoration: 'none' }}
            >
              ↗ Website
            </a>
          )}
          {investor.trendlyneUrl && (
            <a
              href={investor.trendlyneUrl}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: ACCENT, textDecoration: 'none' }}
            >
              ↗ Trendlyne page
            </a>
          )}
          <HoldingsFreshnessChip investorId={investor.id} />
        </div>
        <p style={{ color: 'var(--mc-text-2)', fontSize: 13, lineHeight: 1.55, margin: 0, maxWidth: 760 }}>
          {investor.shortBio}
        </p>
      </div>

      {/* Sub-tab switcher */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, marginBottom: 16, gap: 4 }}>
        {(['HOLDINGS', 'NEWS'] as Tab[]).map((t) => {
          const isActive = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 12, fontWeight: 700, letterSpacing: '0.4px',
                color: isActive ? ACCENT : MUTED,
                background: 'transparent', cursor: 'pointer',
                border: 'none',
                borderBottom: `2px solid ${isActive ? ACCENT : 'transparent'}`,
                padding: '8px 14px',
              }}
            >
              {t === 'HOLDINGS' ? '📁 Holdings' : '📰 News & Interviews'}
            </button>
          );
        })}
      </div>

      {tab === 'HOLDINGS' ? (
        <HoldingsTable investor={investor} marketScope={marketScope} />
      ) : (
        <NewsPanel query={investor.newsQuery} investorName={investor.name} />
      )}

      {investor.notes && (
        <div style={{
          marginTop: 20, padding: 12, borderRadius: 6,
          backgroundColor: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-warn) 19%, transparent)',
          fontSize: 12, color: '#FCD34D', lineHeight: 1.5,
        }}>
          <strong style={{ color: 'var(--mc-warn)' }}>Note · </strong>{investor.notes}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

function HoldingsTable({ investor, marketScope }: { investor: SuperInvestor; marketScope: MarketScope }) {
  // PATCH 0486 — disclosure-age helper for freshness chip
  const ageDays = (iso: string): number => {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return 999;
    return Math.floor((Date.now() - t) / 86_400_000);
  };
  // PATCH 0489 — filter holdings by market scope
  const filteredHoldings = useMemo(() => {
    if (marketScope === 'ALL') return investor.topHoldings;
    if (marketScope === 'INDIA') return investor.topHoldings.filter((h) => isIndianExchange(h.exchange));
    return investor.topHoldings.filter((h) => !isIndianExchange(h.exchange));
  }, [investor, marketScope]);
  return (
    <div>
      {/* PATCH 0486 — Data-quality + disclosure-lag honesty banner */}
      <div style={{
        padding: '10px 12px', marginBottom: 12, borderRadius: 6,
        border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-warn) 6%, transparent)',
        fontSize: 11, color: '#FCD34D', lineHeight: 1.5,
      }}>
        <strong style={{ color: 'var(--mc-warn)' }}>⚠ Disclosure-lag warning · </strong>
        Indian BSE ≥1% filings and AIF disclosures are backward-looking (typically 1–2 quarters
        old — March 2026 data shown in May 2026 means real positions may have shifted). For US
        13F filings (Pabrai etc.) the lag is ~45 days post quarter-end. Use the <strong>📰 News & Interviews</strong> tab
        to cross-check with the latest investor moves we&apos;ve parsed from headlines (BUY / ADD /
        TRIM / EXIT chips appear there).
      </div>

      <div style={{ fontSize: 11, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
        Last-disclosed positions. Tier ◆ = mandatory BSE / AIF filing.
        ◇ = self-disclosed in interview / book / tweet. ~ = inferred from media.
        Holdings refresh after each disclosure cycle (quarterly for BSE filings).
      </div>
      <div style={{
        border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ backgroundColor: PANEL }}>
              <th style={thStyle}>Ticker</th>
              <th style={thStyle}>Company</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Stake</th>
              <th style={thStyle}>Tier</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Disclosed</th>
              <th style={thStyle}>Thesis / Note</th>
            </tr>
          </thead>
          <tbody>
            {filteredHoldings.map((h, idx) => {
              const tierMeta = TIER_META[h.tier];
              return (
                <tr key={h.ticker + idx} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={tdStyle}>
                    <a
                      href={`/stock-sheet?ticker=${h.ticker}`}
                      style={{
                        color: TEXT, fontWeight: 700,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        textDecoration: 'none',
                      }}
                    >
                      {h.exchange ? <span style={{ color: 'var(--mc-cyan)', fontWeight: 500, fontSize: 10 }}>{h.exchange}:</span> : null}{h.ticker}
                    </a>
                  </td>
                  <td style={tdStyle}>{h.company}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {h.stakePct != null ? `${h.stakePct.toFixed(1)}%` : '—'}
                  </td>
                  <td style={tdStyle}>
                    <span title={tierMeta.description} style={{
                      fontSize: 10, fontWeight: 700,
                      color: tierMeta.color, border: `1px solid ${tierMeta.color}40`,
                      backgroundColor: `${tierMeta.color}10`,
                      padding: '2px 6px', borderRadius: 3,
                    }}>
                      {tierMeta.label}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
                    {h.disclosedOn}
                    {(() => {
                      const days = ageDays(h.disclosedOn);
                      const tone = days > 90 ? { c: '#EF4444', l: `${days}d stale` }
                        : days > 60 ? { c: '#F59E0B', l: `${days}d old` }
                        : days > 30 ? { c: '#94A3B8', l: `${days}d` }
                        : { c: '#10B981', l: 'recent' };
                      return (
                        <span title={`Disclosure age: ${days} days. Real position may have moved since.`} style={{
                          marginLeft: 6, fontSize: 9, fontWeight: 700,
                          color: tone.c, border: `1px solid ${tone.c}40`,
                          backgroundColor: `${tone.c}10`, padding: '1px 5px', borderRadius: 3,
                          display: 'inline-block', whiteSpace: 'nowrap',
                        }}>{tone.l}</span>
                      );
                    })()}
                  </td>
                  <td style={{ ...tdStyle, color: MUTED, fontStyle: h.thesis ? 'normal' : 'italic' }}>
                    {h.thesis || '—'}
                  </td>
                </tr>
              );
            })}
            {filteredHoldings.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, color: MUTED, fontStyle: 'italic', textAlign: 'center' }}>
                  {investor.topHoldings.length === 0
                    ? 'No disclosed holdings yet — check the News tab for public commentary.'
                    : `No ${marketScope === 'INDIA' ? 'Indian' : 'global'} holdings disclosed — switch market scope or check the other view.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: '0.4px',
  textAlign: 'left', padding: '8px 12px',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px', color: TEXT, fontSize: 12, verticalAlign: 'top',
};

// ──────────────────────────────────────────────────────────────────────────

interface NewsArticle {
  id?: string;
  title: string;
  url?: string;
  source?: string;
  source_tier?: string;
  publishedAt?: string;
  date?: string;
  region?: string;
  importance_score?: number;
}

// PATCH 0488 — parsed stake-change moves with signal hardening
interface StakeMove {
  direction: 'BUY' | 'ADD' | 'TRIM' | 'EXIT' | 'UNKNOWN';
  ticker?: string;
  company?: string;
  stakePct?: number;
  stakeFromPct?: number;
  stakeDeltaPct?: number;
  detail?: string;
  headline: string;
  url: string;
  source: string;
  publishedAt: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceType?: 'BSE' | 'NEWS' | 'INTERVIEW' | 'TV' | 'OTHER';
  signalScore?: number;
}

const CONF_META: Record<string, { color: string; label: string }> = {
  HIGH:   { color: '#10B981', label: 'HIGH'   },
  MEDIUM: { color: '#F59E0B', label: 'MED'    },
  LOW:    { color: '#94A3B8', label: 'LOW'    },
};

const DIR_META: Record<StakeMove['direction'], { label: string; color: string; icon: string }> = {
  BUY:     { label: 'NEW BUY',  color: '#10B981', icon: '↑' },
  ADD:     { label: 'ADDED',    color: '#22D3EE', icon: '↑' },
  TRIM:    { label: 'TRIMMED',  color: '#F59E0B', icon: '↓' },
  EXIT:    { label: 'EXITED',   color: '#EF4444', icon: '↓' },
  UNKNOWN: { label: '—',        color: '#94A3B8', icon: '·' },
};

function NewsPanel({ query, investorName }: { query: string; investorName: string }) {
  const [items, setItems] = useState<NewsArticle[]>([]);
  const [moves, setMoves] = useState<StakeMove[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // PATCH 0484 — live freshness chip + auto-refresh every 5 min.
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    const doFetch = () => {
      setLoading((prev) => prev === true ? true : prev); // keep loading state on first fetch
      setError(null);
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12_000);
      fetch(`/api/v1/super-investor-news?query=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then((r) => r.ok ? r.json() : Promise.reject(new Error('news fetch failed')))
        .then((data) => {
          if (!alive) return;
          const articles: NewsArticle[] = Array.isArray(data?.articles) ? data.articles : [];
          const moves_: StakeMove[] = Array.isArray(data?.moves) ? data.moves : [];
          setItems(articles.slice(0, 40));
          setMoves(moves_);
          setFetchedAt(Date.now());
          setLoading(false);
        })
        .catch((e) => {
          if (!alive) return;
          setError(e?.message || 'fetch error');
          setLoading(false);
        })
        .finally(() => clearTimeout(t));
    };
    doFetch();
    // AUDIT_100 #7 — skip poll when tab is hidden
    interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      doFetch();
    }, 5 * 60 * 1000); // auto-refresh every 5 min
    return () => { alive = false; if (interval) clearInterval(interval); };
  }, [query]);

  // AUDIT_100 #46 — Tick interval raised 30s → 60s. The freshness chip
  // shows minute-resolution ("Xm ago"), so re-rendering every 30s was a
  // gratuitous bump that re-painted the panel for no visible change.
  // 60s lines up with the granularity displayed.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  void tick; // suppress unused warning

  const ageMs = fetchedAt ? Date.now() - fetchedAt : 0;
  const ageLabel = fetchedAt
    ? ageMs < 60_000 ? 'just now'
    : ageMs < 60 * 60_000 ? `${Math.floor(ageMs / 60_000)}m ago`
    : `${Math.floor(ageMs / 3_600_000)}h ago`
    : '';

  return (
    <div>
      {/* PATCH 0484 — LIVE chip + freshness + Recent Moves panel ───────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.5px',
          color: 'var(--mc-bullish)',
          border: '1px solid color-mix(in srgb, var(--mc-bullish) 31%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)',
          padding: '3px 8px', borderRadius: 3,
        }}>
          ● LIVE
        </span>
        {fetchedAt && (
          <span style={{ fontSize: 11, color: MUTED }}>
            as of {new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {ageLabel}
          </span>
        )}
        <span style={{ fontSize: 11, color: MUTED, fontStyle: 'italic' }}>
          · auto-refresh every 5 min
        </span>
      </div>

      {moves.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 12, color: 'var(--mc-cyan)', fontWeight: 700, letterSpacing: '0.5px',
            marginBottom: 8,
          }}>
            🔁 RECENT MOVES — DETECTED FROM HEADLINES ({moves.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {moves.map((m, idx) => {
              const meta = DIR_META[m.direction];
              return (
                <a
                  key={idx}
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 4,
                    border: `1px solid ${meta.color}40`,
                    backgroundColor: `${meta.color}10`,
                    textDecoration: 'none',
                  }}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: '0.4px',
                    color: meta.color,
                    border: `1px solid ${meta.color}60`,
                    backgroundColor: `${meta.color}18`,
                    padding: '2px 7px', borderRadius: 3,
                    minWidth: 64, textAlign: 'center',
                  }}>
                    {meta.icon} {meta.label}
                  </span>
                  {/* PATCH 0488 — confidence chip */}
                  {m.confidence && (() => {
                    const cm = CONF_META[m.confidence];
                    return (
                      <span title={`Signal confidence: ${m.confidence}${m.signalScore != null ? ` · score ${m.signalScore}/100` : ''}`} style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.4px',
                        color: cm.color, border: `1px solid ${cm.color}50`,
                        backgroundColor: `${cm.color}12`,
                        padding: '1px 6px', borderRadius: 3,
                      }}>{cm.label}</span>
                    );
                  })()}
                  {/* Stake column: support from→to format */}
                  {(m.stakeFromPct != null || m.stakePct != null) && (
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: TEXT,
                      fontVariantNumeric: 'tabular-nums', minWidth: 76, whiteSpace: 'nowrap',
                    }}>
                      {m.stakeFromPct != null && m.stakePct != null
                        ? `${m.stakeFromPct.toFixed(1)}% → ${m.stakePct.toFixed(1)}%`
                        : m.stakePct != null
                          ? `${m.stakePct.toFixed(1)}%`
                          : m.stakeDeltaPct != null
                            ? `${m.stakeDeltaPct > 0 ? '+' : ''}${m.stakeDeltaPct.toFixed(1)}%`
                            : ''}
                    </span>
                  )}
                  {m.company && (
                    <span style={{ fontSize: 12, fontWeight: 600, color: TEXT, minWidth: 110 }}>
                      {m.company}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: MUTED, flex: 1, lineHeight: 1.4 }}>
                    {m.headline}
                  </span>
                  <span style={{ fontSize: 10, color: MUTED, fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                    {m.source}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: MUTED, marginBottom: 8, lineHeight: 1.5 }}>
        News + interviews matched to <strong style={{ color: ACCENT }}>{investorName}</strong>.
        Live RSS fan-out across Google News + Moneycontrol + Economic Times + Trendlyne.
        Click any headline to open in a new tab.
      </div>
      {loading && (
        <div style={{ padding: 24, color: MUTED, fontSize: 12, fontStyle: 'italic' }}>
          Loading news…
        </div>
      )}
      {error && !loading && (
        <div style={{
          padding: 12, color: 'var(--mc-bearish)', fontSize: 12,
          border: '1px solid color-mix(in srgb, var(--mc-bearish) 25%, transparent)', borderRadius: 4, backgroundColor: 'color-mix(in srgb, var(--mc-bearish) 6%, transparent)',
        }}>
          Could not load news ({error}). Try the global news feed for fallback coverage.
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div style={{
          padding: 12, color: MUTED, fontSize: 12, fontStyle: 'italic',
          border: `1px solid ${BORDER}`, borderRadius: 4, backgroundColor: PANEL,
        }}>
          No recent news matched. Try widening the time window on the /news page.
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((a, idx) => (
            <a
              key={a.id || a.url || idx}
              href={a.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', padding: '10px 12px',
                border: `1px solid ${BORDER}`, borderRadius: 6,
                backgroundColor: PANEL, textDecoration: 'none',
              }}
            >
              <div style={{ color: TEXT, fontSize: 13, fontWeight: 600, lineHeight: 1.4, marginBottom: 3 }}>
                {a.title}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {a.source && (
                  <span style={{ fontSize: 10, color: MUTED }}>{a.source}</span>
                )}
                {a.source_tier && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: ACCENT,
                    border: `1px solid ${ACCENT}40`, padding: '1px 5px', borderRadius: 3,
                  }}>
                    {a.source_tier}
                  </span>
                )}
                <span style={{ fontSize: 10, color: MUTED }}>
                  {a.publishedAt || a.date || ''}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
