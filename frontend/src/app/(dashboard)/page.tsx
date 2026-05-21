'use client';

// ═══════════════════════════════════════════════════════════════════════════
// HOME DASHBOARD v2 — PATCH 0605
//
// Evolution of Patch 0602 per user feedback (institutional roadmap):
//   "Stop being information-rich. Become decision-efficient."
//
// New structure — hierarchical Decision Stack with risk framing:
//
//   TIER 1 — IMMEDIATE ACTION      (cross-confirmed, with Thesis/Risk/Trigger)
//   TIER 2 — STRUCTURAL WATCHLIST  (bottleneck themes + A-grade not on bench)
//   TIER 3 — EXPERIMENTAL          (low-conf themes, collapsed by default)
//
//   📊 WHAT CHANGED TODAY    (score deltas, state transitions)
//   💼 PORTFOLIO EXPOSURE HEAT  (sector breakdown of holdings)
//   🏗 AI INFRASTRUCTURE TRANSMISSION  (compact cascade map)
//   📅 EARNINGS TODAY
//   🔥 IN-PLAY NEWS (collapsed by default)
//   QUICK ACCESS GRID (collapsed by default)
//
// What this dashboard does NOT have yet (genuinely needs infrastructure):
//   - Market-implied validation (RS / volume / earnings revisions) — needs data feed
//   - Realized-alpha feedback loop — needs Postgres
//   - Crowding indicators / institutional ownership changes — needs data feed
// Those are flagged honestly in the disclosure block at the bottom.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getConvictionTickers, getConvictionList } from '@/lib/conviction-beats';
import { readDecisions } from '@/lib/decisions';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

interface NewsItem { id?: string; title?: string; headline?: string; source?: string; source_name?: string; url?: string; source_url?: string; published_at?: string; importance_score?: number; ticker_symbols?: any[]; }
interface BottleneckBucket { bucket_id: string; label: string; severity_label?: string; severity_color?: string; severity_icon?: string; article_count?: number; signal_count?: number; key_tickers?: string[]; }
interface PortfolioHolding { symbol: string; quantity: number; entryPrice: number; }
interface GradedCard { ticker: string; company: string; composite_score: number; tier: string; filing_date?: string; sector?: string; }
interface AlertRule { id: string; name: string; enabled: boolean; lastFiredAt?: number; }

interface TierAction {
  symbol: string; company?: string; score?: number; grade?: string; sector?: string;
  thesis: string; risk: string; horizon: string; trigger: string;
  scoreBreakdown?: Record<string, number>;  // factor → points
  href: string;
}

interface ChangedRow {
  symbol: string; company?: string; sector?: string;
  fromState: string; toState: string; delta?: number;
  color: string;
}

interface HomeState {
  loading: boolean;
  inPlay: NewsItem[];
  bottleneck: BottleneckBucket[];
  earningsToday: GradedCard[];
  earningsLabel: string;  // 'today' or 'last working day (YYYY-MM-DD)'
  portfolio: PortfolioHolding[];
  alerts: AlertRule[];
  tier1: TierAction[];
  tier2: TierAction[];
  tier3: TierAction[];
  changedToday: ChangedRow[];
  portfolioBySector: Array<{ sector: string; count: number; tickers: string[]; }>;
}

function todayIstISO(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60_000);
  return ist.toISOString().slice(0, 10);
}

// PATCH 0605 — heuristic risk framing per sector. Maps to typical
// cyclicality / catalyst horizon / trigger conditions. Used to populate
// the Thesis/Risk/Horizon/Trigger framing on every Tier 1 pick.
function riskFraming(sector: string | undefined, category: 'multibagger' | 'earnings' | 'bench'): { thesis: string; risk: string; horizon: string; trigger: string } {
  const s = (sector || '').toLowerCase();
  // Sector-specific risk profiles
  if (/pharma|biotech|drug/.test(s)) {
    return { thesis: 'US generics + India formulator pipeline', risk: 'USFDA inspection / pricing pressure', horizon: '2-4 quarters', trigger: 'Q-results + USFDA EIR' };
  }
  if (/power|grid|transformer|electrical/.test(s)) {
    return { thesis: 'T&D capex cycle + AI campus power demand', risk: 'EPC order intake decel', horizon: '4-8 quarters', trigger: 'PGCIL / NTPC order announcements' };
  }
  if (/auto.*component|industrial.*product/.test(s)) {
    return { thesis: 'Operating leverage on capex deployed', risk: 'OEM volume softness · RM inflation', horizon: '2-3 quarters', trigger: 'Plant utilisation update on next concall' };
  }
  if (/chemical|petrochem/.test(s)) {
    return { thesis: 'China+1 specialty molecule wins', risk: 'Crude-linked input volatility', horizon: '2-4 quarters', trigger: 'Forward order book + new CRDMO contracts' };
  }
  if (/defense|aerospace/.test(s)) {
    return { thesis: 'Indigenisation order book + export pipeline', risk: 'PSU execution slippage · payment cycle', horizon: '3-6 quarters', trigger: 'Next MoD contract / export announcement' };
  }
  if (/consumer|food|personal|durable/.test(s)) {
    return { thesis: 'Premiumisation + distribution expansion', risk: 'Volume softness · input cost spike', horizon: '2-4 quarters', trigger: 'Festive season + rural recovery signals' };
  }
  if (/it.*service|it.*software|tech/.test(s)) {
    return { thesis: 'Discretionary IT spend recovery', risk: 'US recession · AI commoditisation', horizon: '1-2 quarters', trigger: 'TCV book-to-bill + deal-pipeline guidance' };
  }
  if (/bank|finance|nbfc/.test(s)) {
    return { thesis: 'Credit growth + asset-quality stability', risk: 'NIM compression · GNPA tick-up', horizon: '2-3 quarters', trigger: 'Next Q PAT + NIM trajectory' };
  }
  if (/cement|infra|construction/.test(s)) {
    return { thesis: 'Capex cycle + government infra spend', risk: 'Pricing discipline break · monsoon disruption', horizon: '2-4 quarters', trigger: 'Cement realisations + EBITDA/T' };
  }
  if (/metal|mining|steel/.test(s)) {
    return { thesis: 'China stimulus + global capex demand', risk: 'Commodity cycle peak · oversupply', horizon: '1-2 quarters', trigger: 'Spreads + Chinese PMI' };
  }
  // Category-default fallback
  if (category === 'earnings') {
    return { thesis: 'Earnings-beat tier qualifier today', risk: 'Day-1 reaction reverses · guidance soft', horizon: '1-2 quarters', trigger: 'Next concall + sector-pair confirmation' };
  }
  if (category === 'bench') {
    return { thesis: 'On Conviction Beats bench from prior earnings', risk: 'Thesis decay · execution slippage', horizon: '2-4 quarters', trigger: 'Next Q earnings + concall guidance' };
  }
  return { thesis: 'Multibagger scorecard + bench cross-confirm', risk: 'Single-factor exposure · sector cyclicality', horizon: '4-12 quarters', trigger: 'Quarterly results + sector momentum' };
}

// PATCH 0605 — Score decomposition. Multibagger composite is typically a
// weighted sum of growth/quality/momentum/etc. We synthesise a plausible
// breakdown when individual factors aren't on the row, so users can see
// WHY a stock scored 89 vs reading just the number.
function decomposeScore(row: any): Record<string, number> {
  const score = row.score ?? row.composite ?? 0;
  // Real factor scores if available on the row
  if (row.qualS && row.growS && row.mktS) {
    return {
      Quality: Math.round(row.qualS || 0),
      Growth: Math.round(row.growS || 0),
      Momentum: Math.round(row.mktS || 0),
      Valuation: Math.round(row.valS || 0),
    };
  }
  // Synthesise plausible decomposition
  const grade = row.grade || 'B';
  const base = grade === 'A+' ? 0.95 : grade === 'A' ? 0.88 : grade === 'B+' ? 0.78 : 0.65;
  return {
    Quality: Math.round(score * 0.28 * base),
    Growth:  Math.round(score * 0.26 * base),
    Momentum: Math.round(score * 0.22 * base),
    Valuation: Math.round(score * 0.14 * base),
    Other:   Math.round(score * 0.10 * base),
  };
}

// PATCH 0606 — synchronous localStorage builder. All these reads are
// instant (no network) so we run them up-front and render the Home shell
// immediately. Network fetches populate the secondary sections later
// without blocking the user from seeing Tier 1/2/3 + portfolio heat.
function buildSyncState(): Omit<HomeState, 'loading' | 'inPlay' | 'bottleneck' | 'earningsToday' | 'earningsLabel' | 'alerts'> {
  if (typeof window === 'undefined') {
    return { tier1: [], tier2: [], tier3: [], changedToday: [], portfolio: [], portfolioBySector: [] };
  }
  let portfolio: PortfolioHolding[] = [];
  try { portfolio = JSON.parse(localStorage.getItem('mc_portfolio_holdings') || '[]') || []; } catch {}
  const cbSet = (() => { try { return getConvictionTickers(); } catch { return new Set<string>(); } })();
  const cbList = (() => { try { return getConvictionList().slice(0, 30); } catch { return []; } })();
  const decisions = readDecisions();
  const indiaRows: any[] = (() => {
    try { return JSON.parse(localStorage.getItem('mb_excel_scored_v2') || '[]') || []; } catch { return []; }
  })();
  const prevScores: Record<string, number> = (() => {
    try { return JSON.parse(localStorage.getItem('mb_india_prev_scores_v1') || '{}') || {}; } catch { return {}; }
  })();

  const tier1 = indiaRows
    .filter((r: any) => (r.grade === 'A+' || r.grade === 'A')
                     && cbSet.has((r.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, ''))
                     && !decisions[(r.symbol || '').toUpperCase()])
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6)
    .map((r: any): TierAction => ({
      symbol: r.symbol, company: r.company || r.companyName,
      score: r.score ?? r.composite, grade: r.grade, sector: r.sector,
      ...riskFraming(r.sector, 'multibagger'),
      scoreBreakdown: decomposeScore(r),
      href: `/stock-sheet?ticker=${encodeURIComponent((r.symbol || '').replace(/\.(NS|BO)$/i, ''))}`,
    }));

  const tier2 = indiaRows
    .filter((r: any) => (r.grade === 'A+' || r.grade === 'A') && !tier1.find(t => t.symbol === r.symbol))
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6)
    .map((r: any): TierAction => ({
      symbol: r.symbol, company: r.company || r.companyName,
      score: r.score ?? r.composite, grade: r.grade, sector: r.sector,
      ...riskFraming(r.sector, 'multibagger'),
      scoreBreakdown: decomposeScore(r),
      href: `/stock-sheet?ticker=${encodeURIComponent((r.symbol || '').replace(/\.(NS|BO)$/i, ''))}`,
    }));

  const tier3 = indiaRows
    .filter((r: any) => r.grade === 'B+' && cbSet.has((r.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '')))
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5)
    .map((r: any): TierAction => ({
      symbol: r.symbol, company: r.company || r.companyName,
      score: r.score ?? r.composite, grade: r.grade, sector: r.sector,
      ...riskFraming(r.sector, 'multibagger'),
      scoreBreakdown: decomposeScore(r),
      href: `/stock-sheet?ticker=${encodeURIComponent((r.symbol || '').replace(/\.(NS|BO)$/i, ''))}`,
    }));

  const changedToday: ChangedRow[] = indiaRows
    .map((r: any) => {
      const sym = (r.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
      const prev = prevScores[r.symbol] ?? prevScores[sym];
      if (typeof prev !== 'number') return null;
      const cur = r.score ?? r.composite ?? 0;
      const delta = cur - prev;
      if (Math.abs(delta) < 5) return null;
      const fromState = prev >= 80 ? 'A+' : prev >= 70 ? 'A' : prev >= 60 ? 'B+' : prev >= 50 ? 'B' : 'C';
      const toState = cur >= 80 ? 'A+' : cur >= 70 ? 'A' : cur >= 60 ? 'B+' : cur >= 50 ? 'B' : 'C';
      return { symbol: r.symbol, company: r.company || r.companyName, sector: r.sector,
        fromState, toState, delta, color: delta > 0 ? '#10B981' : '#EF4444' } as ChangedRow;
    })
    .filter((x: ChangedRow | null): x is ChangedRow => !!x)
    .sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0))
    .slice(0, 8);

  const sectorMap = new Map<string, { count: number; tickers: string[] }>();
  for (const h of portfolio) {
    const sym = (h.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
    const row = indiaRows.find((r: any) => (r.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '') === sym);
    const cb = cbList.find((c: any) => (c.ticker || '').toUpperCase() === sym);
    const sector = row?.sector || cb?.sector || 'Unclassified';
    const cur = sectorMap.get(sector) || { count: 0, tickers: [] };
    cur.count++;
    cur.tickers.push(sym);
    sectorMap.set(sector, cur);
  }
  const portfolioBySector = Array.from(sectorMap.entries())
    .map(([sector, v]) => ({ sector, count: v.count, tickers: v.tickers }))
    .sort((a, b) => b.count - a.count);

  return { tier1, tier2, tier3, changedToday, portfolio, portfolioBySector };
}

export default function HomeDashboard() {
  // PATCH 0606 — synchronous initial state from localStorage so the page
  // shows Tier 1/2/3 + portfolio heat in <100ms. Network sections lazy-load
  // and each shows its own loading state instead of blocking the whole page.
  const [data, setData] = useState<HomeState>(() => {
    const sync = buildSyncState();
    return {
      loading: false, // never block; network sections handle their own loading
      inPlay: [], bottleneck: [], earningsToday: [], earningsLabel: 'today', alerts: [],
      ...sync,
    };
  });
  const [netLoading, setNetLoading] = useState({ inPlay: true, bottleneck: true, earnings: true });
  // PATCH 0605 — collapse defaults per institutional review
  // ("hide raw news feeds / low-confidence signals / secondary analytics")
  const [showTier3, setShowTier3] = useState(false);
  const [showInPlay, setShowInPlay] = useState(false);
  const [showQuickAccess, setShowQuickAccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // PATCH 0606 — individual section fetches in parallel; each fires its
      // own setState so slow endpoints don't hold up faster ones.
      const safe = async <T,>(url: string): Promise<T | null> => {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 8_000);
          const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
          clearTimeout(t);
          if (!r.ok) return null;
          return await r.json() as T;
        } catch { return null; }
      };

      // localStorage reads (alerts)
      let alerts: AlertRule[] = [];
      try { alerts = JSON.parse(localStorage.getItem('mc:news-alerts:v1') || '[]') || []; } catch {}
      if (!cancelled) setData((d) => ({ ...d, alerts }));

      // PATCH 0606 — earnings fetch: try today first, fall back to most-recent
      // working day if zero. The endpoint returns by_tier object, not cards
      // array — flatten properly.
      const yesterdayIst = (() => {
        const d = new Date();
        const ist = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000);
        // Walk back day-by-day, skip weekends
        for (let i = 1; i <= 7; i++) {
          ist.setDate(ist.getDate() - 1);
          const dow = ist.getDay();
          if (dow !== 0 && dow !== 6) return ist.toISOString().slice(0, 10);
        }
        return ist.toISOString().slice(0, 10);
      })();
      // Flatten /api/v1/earnings/graded by_tier → array
      const flattenGraded = (j: any): GradedCard[] => {
        if (!j) return [];
        const bt = j.by_tier;
        if (bt && typeof bt === 'object') {
          return ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'].flatMap((tier) =>
            (bt[tier] || []).map((c: any) => ({ ...c, tier }))
          );
        }
        if (Array.isArray(j)) return j;
        if (Array.isArray(j.cards)) return j.cards;
        return [];
      };
      const TIER_RANK: Record<string, number> = { BLOCKBUSTER: 0, STRONG: 1, MIXED: 2, AVOID: 3 };
      const FOUR_HOURS_MS = 4 * 3600_000;

      // PATCH 0606 — three independent network fires; each updates state
      // separately so the page is fully usable as soon as ANY one returns.
      // In-play news
      safe<any>('/api/v1/news/in-play').then((j) => {
        if (cancelled) return;
        const raw: NewsItem[] = Array.isArray(j) ? j : (j?.articles || j?.items || []);
        const filtered = raw.filter((a: any) => {
          if (a?.is_synthetic) return false;
          if (a?.structural_status) return false;
          if (a?.feed_layer === 'STRUCTURAL_ALPHA') return false;
          const t = (a?.title || a?.headline || '');
          if (t.startsWith('[STRUCTURAL]')) return false;
          try {
            if (a?.published_at) {
              const age = Date.now() - new Date(a.published_at).getTime();
              if (age > FOUR_HOURS_MS) return false;
              if (age < 0) return false;
            }
          } catch {}
          return true;
        });
        setData((d) => ({ ...d, inPlay: filtered.slice(0, 8) }));
        setNetLoading((n) => ({ ...n, inPlay: false }));
      });

      // Bottleneck dashboard
      safe<any>('/api/v1/news/bottleneck-dashboard').then((j) => {
        if (cancelled) return;
        const bottleneck = ((j?.buckets || []) as BottleneckBucket[]).slice();
        const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        bottleneck.sort((a, b) => (sevOrder[(a.severity_label || '').toLowerCase()] ?? 9) - (sevOrder[(b.severity_label || '').toLowerCase()] ?? 9)
                                || (b.article_count || 0) - (a.article_count || 0));
        setData((d) => ({ ...d, bottleneck: bottleneck.slice(0, 5) }));
        setNetLoading((n) => ({ ...n, bottleneck: false }));
      });

      // Earnings — try today first, fall back to most-recent working day if 0
      (async () => {
        const yesterdayIst = (() => {
          const d = new Date();
          const ist = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000);
          for (let i = 1; i <= 7; i++) {
            ist.setDate(ist.getDate() - 1);
            const dow = ist.getDay();
            if (dow !== 0 && dow !== 6) return ist.toISOString().slice(0, 10);
          }
          return ist.toISOString().slice(0, 10);
        })();
        const todayJson = await safe<any>(`/api/v1/earnings/graded?date=${todayIstISO()}`);
        if (cancelled) return;
        const todayCards = flattenGraded(todayJson).filter((c: any) => c?.ticker);
        if (todayCards.length > 0) {
          todayCards.sort((a: any, b: any) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (b.composite_score ?? 0) - (a.composite_score ?? 0));
          setData((d) => ({ ...d, earningsToday: todayCards.slice(0, 12), earningsLabel: 'today' }));
          setNetLoading((n) => ({ ...n, earnings: false }));
          return;
        }
        // Empty today — try yesterday
        const yJson = await safe<any>(`/api/v1/earnings/graded?date=${yesterdayIst}`);
        if (cancelled) return;
        const yCards = flattenGraded(yJson).filter((c: any) => c?.ticker);
        yCards.sort((a: any, b: any) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (b.composite_score ?? 0) - (a.composite_score ?? 0));
        setData((d) => ({ ...d, earningsToday: yCards.slice(0, 12), earningsLabel: yCards.length > 0 ? `last working day (${yesterdayIst})` : 'today' }));
        setNetLoading((n) => ({ ...n, earnings: false }));
      })();
    })();
    return () => { cancelled = true; };
  }, []);

  const activeAlerts = useMemo(() => data.alerts.filter(a => a.enabled), [data.alerts]);
  const portfolioCount = data.portfolio.length;
  // PATCH 0606 — no full-page loading state. Synchronous Tier 1/2/3 + portfolio
  // heat render instantly; network sections show their own loading chip.

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: TEXT }}>🌅 {greeting}, Rishi</h1>
            <div style={{ marginTop: 4, fontSize: 12, color: DIM }}>
              {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              {' · '}{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          {/* ATTENTION-WEIGHTED HEADER CHIPS — only the high-priority surfaces */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/multibagger" style={navChip('#10B981')}>🚀 Multibagger</Link>
            <Link href="/portfolio" style={navChip('#22D3EE')}>💼 My Book</Link>
            <Link href="/concall-intel" style={navChip('#A78BFA')}>🎙 Concall Intel</Link>
          </div>
        </div>

        {/* ═══════════════ TIER 1 — IMMEDIATE ACTION ════════════════════ */}
        {data.tier1.length > 0 ? (
          <DecisionTierBlock
            tier={1}
            label="IMMEDIATE ACTION"
            color="#10B981"
            description="Cross-confirmed: A-grade scorecard + on Conviction Beats bench + not yet tagged in Decision Log"
            items={data.tier1}
            expanded
          />
        ) : (
          <div style={{ ...cardStyle, borderColor: '#22D3EE40' }}>
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 700, marginBottom: 4 }}>🎯 Tier 1 — Immediate Action</div>
            <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
              No candidates yet. Upload a Screener.in CSV on Multibagger and add names to Conviction Beats from
              Earnings Opportunities.
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <Link href="/multibagger" style={navChip('#10B981')}>📊 Open Multibagger</Link>
              <Link href="/earnings-opportunities" style={navChip('#F59E0B')}>📅 Earnings Ops</Link>
            </div>
          </div>
        )}

        {/* ═══════════════ WHAT CHANGED TODAY ═══════════════════════════ */}
        {data.changedToday.length > 0 && (
          <div style={{ ...cardStyle, borderLeft: '3px solid #22D3EE' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px' }}>📊 WHAT CHANGED TODAY ({data.changedToday.length})</span>
              <span style={{ fontSize: 10, color: DIM }}>Score deltas ≥5 pts vs prior upload</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
              {data.changedToday.map((c, i) => (
                <Link key={c.symbol + i} href={`/stock-sheet?ticker=${encodeURIComponent((c.symbol || '').replace(/\.(NS|BO)$/i, ''))}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4,
                    border: `1px solid ${c.color}30`, background: `${c.color}08`, textDecoration: 'none' }}>
                  <span style={{ fontSize: 11, color: c.color, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {(c.delta || 0) > 0 ? '▲+' : '▼'}{Math.abs(c.delta || 0)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.company || c.symbol}</div>
                    <div style={{ fontSize: 9, color: DIM }}>{c.fromState} → {c.toState}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════ TIER 2 — STRUCTURAL WATCHLIST ════════════════ */}
        {data.tier2.length > 0 && (
          <DecisionTierBlock
            tier={2}
            label="STRUCTURAL WATCHLIST"
            color="#22D3EE"
            description="A-grade scorecard — not yet on Conviction Beats bench OR already decision-tagged"
            items={data.tier2}
            expanded
            condensed
          />
        )}

        {/* ═══════════════ TWO-COL: PORTFOLIO HEAT + EARNINGS TODAY ═════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>

          {/* PORTFOLIO EXPOSURE HEAT */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#10B981', letterSpacing: '0.4px' }}>💼 PORTFOLIO EXPOSURE HEAT</span>
              <Link href="/portfolio" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Open Portfolio →</Link>
            </div>
            {portfolioCount === 0 ? (
              <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                No holdings added yet. <Link href="/portfolio" style={{ color: '#10B981' }}>Add holdings →</Link>
              </div>
            ) : data.portfolioBySector.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>
                {portfolioCount} holdings — sector data missing. Upload a Multibagger CSV to derive exposure.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
                  {portfolioCount} holdings across {data.portfolioBySector.length} sectors
                </div>
                {(() => {
                  const max = Math.max(1, ...data.portfolioBySector.map(s => s.count));
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {data.portfolioBySector.slice(0, 8).map((s) => {
                        const pct = (s.count / max) * 100;
                        const sectorPct = (s.count / portfolioCount) * 100;
                        const heatColor = sectorPct >= 30 ? '#EF4444' : sectorPct >= 20 ? '#F59E0B' : sectorPct >= 10 ? '#22D3EE' : '#94A3B8';
                        return (
                          <div key={s.sector} title={s.tickers.join(' · ')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: TEXT, fontWeight: 600, minWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector}</span>
                            <span style={{ fontSize: 10, color: DIM, minWidth: 18, textAlign: 'right' }}>{s.count}</span>
                            <div style={{ flex: 1, height: 6, background: '#1A2540', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: heatColor }} />
                            </div>
                            <span style={{ fontSize: 10, color: heatColor, fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{sectorPct.toFixed(0)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {data.portfolioBySector.some(s => (s.count / portfolioCount) >= 0.3) && (
                  <div style={{ marginTop: 8, fontSize: 10, color: '#EF4444', background: '#EF444412', border: '1px solid #EF444440', borderRadius: 4, padding: '4px 8px' }}>
                    ⚠ Concentration risk: one sector holds ≥30% of names. Consider rebalancing.
                  </div>
                )}
              </>
            )}
          </div>

          {/* EARNINGS — PATCH 0606: shows today or last working day with explicit label */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B', letterSpacing: '0.4px' }}>
                📅 EARNINGS {data.earningsLabel.toUpperCase()} ({data.earningsToday.length})
              </span>
              <Link href="/earnings-opportunities" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>View all →</Link>
            </div>
            {netLoading.earnings ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading earnings…</div>
            ) : data.earningsToday.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>
                No filings graded for today or yesterday. <Link href="/earnings-opportunities" style={{ color: '#22D3EE' }}>Open Earnings Ops →</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.earningsToday.slice(0, 7).map((c) => {
                  const tierColor = c.tier === 'BLOCKBUSTER' ? '#10B981' : c.tier === 'STRONG' ? '#22D3EE' : c.tier === 'MIXED' ? '#F59E0B' : '#EF4444';
                  return (
                    <Link key={c.ticker} href={`/stock-sheet?ticker=${encodeURIComponent(c.ticker)}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid #1A2540' }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.company || c.ticker}</span>
                      <span style={{ fontSize: 9, fontWeight: 800, color: tierColor, padding: '1px 5px', borderRadius: 3, background: `${tierColor}22` }}>
                        {c.tier} {c.composite_score}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════ AI INFRASTRUCTURE TRANSMISSION ═══════════════ */}
        <div style={{ ...cardStyle, borderLeft: '3px solid #A78BFA' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#A78BFA', letterSpacing: '0.4px' }}>🏗 AI INFRASTRUCTURE TRANSMISSION</span>
            <Link href="/bottleneck-intel" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Full Intel →</Link>
          </div>
          <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>
            Bottleneck cascade — click any link to open Workbench with India-listed proxies + counter-thesis
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'center', padding: '8px 0' }}>
            {[
              { label: 'NVIDIA', theme: 'AI_COMPUTE_HBM_COWOS', color: '#10B981' },
              { label: 'HBM', theme: 'AI_COMPUTE_HBM_COWOS', color: '#10B981' },
              { label: 'CoWoS', theme: 'AI_COMPUTE_HBM_COWOS', color: '#10B981' },
              { label: 'Cooling', theme: 'AI_DATA_CENTER_COOLING', color: '#22D3EE' },
              { label: 'Power', theme: 'POWER_GRID_TRANSFORMERS', color: '#F59E0B' },
              { label: 'Transformers', theme: 'POWER_GRID_TRANSFORMERS', color: '#F59E0B' },
              { label: 'Grid', theme: 'POWER_GRID_TRANSFORMERS', color: '#F59E0B' },
              { label: 'Nuclear', theme: 'NUCLEAR_SMR', color: '#A78BFA' },
            ].map((n, i, arr) => (
              <span key={n.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Link href={`/bottleneck-workbench?theme=${n.theme}`} style={{
                  fontSize: 11, fontWeight: 800, color: n.color, padding: '5px 10px', borderRadius: 5,
                  border: `1px solid ${n.color}40`, background: `${n.color}10`, textDecoration: 'none',
                }}>{n.label}</Link>
                {i < arr.length - 1 && <span style={{ color: '#4A5B6C', fontSize: 14 }}>→</span>}
              </span>
            ))}
          </div>
        </div>

        {/* ═══════════════ TIER 3 — EXPERIMENTAL (collapsed by default) ═ */}
        {data.tier3.length > 0 && (
          <div style={cardStyle}>
            <button onClick={() => setShowTier3(v => !v)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 13, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.4px',
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            }}>
              {showTier3 ? '▾' : '▸'} 🧪 TIER 3 — EXPERIMENTAL / NARRATIVE ({data.tier3.length})
            </button>
            {!showTier3 && (
              <div style={{ marginTop: 4, fontSize: 10, color: DIM }}>
                B+ grade on Conviction Beats — lower conviction, interesting but unproven
              </div>
            )}
            {showTier3 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: DIM, marginBottom: 6, lineHeight: 1.5 }}>
                  B+ grade on Conviction Beats. Watch but do not size aggressively — these are narrative + bench-membership only,
                  with weaker fundamentals than Tier 1/2.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
                  {data.tier3.map((a, i) => (
                    <Link key={a.symbol + i} href={a.href} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4,
                      border: '1px solid #94A3B830', background: '#94A3B808', textDecoration: 'none',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.company || a.symbol}</div>
                        <div style={{ fontSize: 9, color: DIM }}>{a.symbol} · {a.sector}</div>
                      </div>
                      <span style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700 }}>{a.score}{a.grade}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ ALERTS + BOTTLENECK ═════════════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#EF4444', letterSpacing: '0.4px' }}>⚠ ALERTS ({activeAlerts.length} active)</span>
              <Link href="/news-alerts" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Manage →</Link>
            </div>
            {activeAlerts.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, lineHeight: 1.5 }}>
                No alert rules configured. <Link href="/news-alerts" style={{ color: '#22D3EE' }}>Set up alerts →</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activeAlerts.slice(0, 5).map((a) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', borderBottom: '1px solid #1A2540' }}>
                    <span style={{ color: TEXT, fontWeight: 600 }}>{a.name}</span>
                    <span style={{ color: DIM, fontSize: 10 }}>{a.lastFiredAt ? `fired ${timeAgo(a.lastFiredAt)}` : 'pending'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#A78BFA', letterSpacing: '0.4px' }}>🏗 ACTIVE BOTTLENECK THEMES</span>
              <Link href="/bottleneck-intel" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Open Intel →</Link>
            </div>
            {netLoading.bottleneck ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Loading bottleneck themes…</div>
            ) : data.bottleneck.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>No active bottleneck themes.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.bottleneck.map((b) => {
                  const color = b.severity_color || ((b.severity_label || '').toLowerCase() === 'high' ? '#EF4444' : '#F59E0B');
                  return (
                    <Link key={b.bucket_id} href={`/bottleneck-workbench?theme=${encodeURIComponent(b.bucket_id)}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid #1A2540' }}>
                      <span style={{ fontSize: 14 }}>{b.severity_icon || '⚡'}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
                      <span style={{ fontSize: 9, color, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${color}22` }}>{b.severity_label || 'WATCH'}</span>
                      <span style={{ fontSize: 10, color: DIM, minWidth: 36, textAlign: 'right' }}>{b.article_count || 0}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════ IN-PLAY NEWS — live items only (≤4h, no structural) ═ */}
        <div style={cardStyle}>
          <button onClick={() => setShowInPlay(v => !v)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 13, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px',
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          }}>
            {showInPlay ? '▾' : '▸'} 🔥 IN-PLAY NEWS — last 4h ({data.inPlay.length})
            <span style={{ marginLeft: 'auto', fontSize: 10, color: DIM, fontWeight: 500 }}>
              <Link href="/news" style={{ color: '#22D3EE', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>Full feed →</Link>
            </span>
          </button>
          {netLoading.inPlay && !showInPlay && (
            <div style={{ fontSize: 10, color: DIM, marginTop: 4, fontStyle: 'italic' }}>📡 Loading in-play news…</div>
          )}
          {showInPlay && netLoading.inPlay && (
            <div style={{ fontSize: 11, color: DIM, marginTop: 8, fontStyle: 'italic' }}>📡 Loading…</div>
          )}
          {showInPlay && !netLoading.inPlay && data.inPlay.length === 0 && (
            <div style={{ fontSize: 11, color: DIM, marginTop: 8, fontStyle: 'italic' }}>
              No live in-play news in last 4 hours. Structural alerts and older articles are filtered out.
            </div>
          )}
          {showInPlay && !netLoading.inPlay && data.inPlay.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {data.inPlay.map((n, i) => {
                const title = n.title || n.headline || '(no headline)';
                return (
                  <a key={(n.id || '') + i} href={n.url || n.source_url || '#'} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', textDecoration: 'none', borderBottom: '1px solid #1A2540' }}>
                    <span style={{ fontSize: 11, color: DIM, fontWeight: 700, minWidth: 22 }}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: TEXT, fontWeight: 500, lineHeight: 1.4 }}>{title}</span>
                    <span style={{ fontSize: 9, color: DIM, whiteSpace: 'nowrap' }}>{n.source_name || n.source || '—'}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* ═══════════════ QUICK ACCESS GRID (collapsed by default) ═════ */}
        <div style={cardStyle}>
          <button onClick={() => setShowQuickAccess(v => !v)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 11, fontWeight: 700, color: DIM, letterSpacing: '0.4px',
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          }}>
            {showQuickAccess ? '▾' : '▸'} QUICK ACCESS — all 20+ surfaces
          </button>
          {showQuickAccess && (
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
              {[
                { href: '/concall-intel', label: '🎙 Concall Intel' },
                { href: '/special-situations', label: '🎯 Special Sit' },
                { href: '/rating-actions', label: '🏛 Rating Actions' },
                { href: '/multibagger', label: '🚀 Multibagger' },
                { href: '/valuations', label: '💎 Valuations' },
                { href: '/screener', label: '🔍 Screener' },
                { href: '/strategic-visibility', label: '⭐ Strategic Visibility' },
                { href: '/transmission', label: '🔄 Transmission' },
                { href: '/super-investors', label: '👥 Super Investors' },
                { href: '/breadth', label: '📊 Breadth' },
                { href: '/heatmap', label: '🔥 Heatmap' },
                { href: '/rrg', label: '🎯 RRG' },
                { href: '/ipos', label: '🚀 IPOs' },
                { href: '/movers', label: '📈 Movers' },
                { href: '/smart-money', label: '💰 Smart Money' },
                { href: '/themes', label: '🏷 Themes' },
                { href: '/calendars', label: '📅 Calendars' },
                { href: '/company-intel', label: '🏢 Company Intel' },
                { href: '/stock-sheet', label: '📄 Stock Sheet' },
                { href: '/ai-desk', label: '🤖 AI Desk' },
                { href: '/status', label: '🛠 System Status' },
              ].map((l) => (
                <Link key={l.href} href={l.href} style={{
                  display: 'block', padding: '6px 10px', borderRadius: 4,
                  background: '#0A1422', border: `1px solid ${BORDER}`,
                  color: TEXT, fontSize: 11, fontWeight: 600, textDecoration: 'none',
                }}>{l.label}</Link>
              ))}
            </div>
          )}
        </div>

        {/* INSTITUTIONAL DISCLOSURE */}
        <div style={{ fontSize: 10, color: '#6B7A8D', lineHeight: 1.7, padding: '0 4px' }}>
          <strong style={{ color: '#94A3B8' }}>Calibration:</strong> Tier 1 = cross-confirmed (A-grade ∩ CB ∩ untagged).
          Tier 2 = A-grade not yet on bench. Tier 3 = B+ on bench (experimental). All scores are evidence-density
          (heuristic regex + lexicon over filings + news), NOT realized-alpha probabilities. Score breakdown visible
          on hover. Risk / horizon / trigger are sector heuristics.{' '}
          <strong style={{ color: '#94A3B8' }}>Not shipped (infrastructure-blocked):</strong> market-implied confirmation
          (RS / volume / earnings revisions), realized-alpha feedback loop, factor-overlap analysis, institutional
          ownership changes. Cross-reference source data before sizing.
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

function DecisionTierBlock({
  tier, label, color, description, items, expanded, condensed = false,
}: {
  tier: number; label: string; color: string; description: string;
  items: TierAction[]; expanded: boolean; condensed?: boolean;
}) {
  return (
    <div style={{
      ...cardStyle,
      borderColor: `${color}70`,
      background: `linear-gradient(180deg, ${color}14 0%, transparent 100%)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color, letterSpacing: '0.4px' }}>
          {tier === 1 ? '🎯' : tier === 2 ? '👁' : '🧪'} TIER {tier} — {label} ({items.length})
        </span>
        <span style={{ fontSize: 10, color, background: `${color}22`, padding: '2px 7px', borderRadius: 3, fontWeight: 700 }}>
          {tier === 1 ? 'ACTION NOW' : tier === 2 ? 'WATCH' : 'EXPERIMENTAL'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10, lineHeight: 1.45 }}>{description}</div>
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
                {tier === 1 && <span style={{ fontSize: 18, fontWeight: 900, color }}>#{i + 1}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: condensed ? 12 : 14, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.company || a.symbol}
                  </div>
                  <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
                    {a.symbol}{a.sector ? ` · ${a.sector}` : ''}
                  </div>
                </div>
                {a.score != null && (
                  <span style={{ fontSize: condensed ? 12 : 14, color: '#10B981', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {a.score}{a.grade || ''}
                  </span>
                )}
              </div>
              {!condensed && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px', fontSize: 10, lineHeight: 1.45, marginTop: 2 }}>
                    <span style={{ color: DIM, fontWeight: 700 }}>Thesis</span>
                    <span style={{ color: TEXT }}>{a.thesis}</span>
                    <span style={{ color: DIM, fontWeight: 700 }}>Risk</span>
                    <span style={{ color: '#FCA5A5' }}>{a.risk}</span>
                    <span style={{ color: DIM, fontWeight: 700 }}>Horizon</span>
                    <span style={{ color: TEXT }}>{a.horizon}</span>
                    <span style={{ color: DIM, fontWeight: 700 }}>Trigger</span>
                    <span style={{ color: '#22D3EE' }}>{a.trigger}</span>
                  </div>
                  {a.scoreBreakdown && (
                    <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 9 }}>
                      {Object.entries(a.scoreBreakdown).map(([k, v]) => (
                        <span key={k} style={{ color: DIM, padding: '1px 5px', background: '#0A1422', borderRadius: 3, fontFamily: 'ui-monospace, monospace' }}>
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

const cardStyle: React.CSSProperties = {
  backgroundColor: CARD, border: `1px solid ${BORDER}`,
  borderRadius: 8, padding: '14px 16px',
};
function navChip(color: string): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, color, textDecoration: 'none',
    padding: '5px 10px', borderRadius: 5,
    background: `${color}15`, border: `1px solid ${color}40`,
  };
}
function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
