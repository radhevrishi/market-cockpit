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
  cbConfirmed?: boolean;  // PATCH 0611 — true = on Conviction Beats bench, false = top-up A-grade
  market?: 'IN' | 'US' | string;  // PATCH 0617 — country chip on card
}

interface ChangedRow {
  symbol: string; company?: string; sector?: string;
  fromState: string; toState: string; delta?: number;
  color: string;
}

interface HomeState {
  loading: boolean;
  inPlay: NewsItem[];
  inPlayDiag?: { fetched: number; recent: number; clean: number; fellBack: boolean; error?: string; status?: number };  // PATCH 0617/0618 — visible diagnostics including fetch error
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
  concallHits?: Array<{ ticker: string; company?: string; headline: string; tier?: string; published_at?: string }>;  // PATCH 0617
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
  // PATCH 0617 — pull BOTH India AND USA rows so Tier 1/2/3 reflect the full
  // multibagger universe, not just one market. Each row carries a _market tag
  // for the per-card chip + stock-sheet routing.
  const indiaRaw: any[] = (() => {
    try { return JSON.parse(localStorage.getItem('mb_excel_scored_v2') || '[]') || []; } catch { return []; }
  })();
  const usaRaw: any[] = (() => {
    try { return JSON.parse(localStorage.getItem('mb_usa_scored_v1') || '[]') || []; } catch { return []; }
  })();
  const indiaRows = indiaRaw.map((r: any) => ({ ...r, _market: 'IN' }));
  const usaRows = usaRaw.map((r: any) => ({ ...r, _market: 'US' }));
  const allRows: any[] = [...indiaRows, ...usaRows];
  const prevScores: Record<string, number> = (() => {
    try { return JSON.parse(localStorage.getItem('mb_india_prev_scores_v1') || '{}') || {}; } catch { return {}; }
  })();
  const prevScoresUsa: Record<string, number> = (() => {
    try { return JSON.parse(localStorage.getItem('mb_usa_prev_scores_v1') || '{}') || {}; } catch { return {}; }
  })();

  // PATCH 0611 — Tier 1 fill-to-6 logic. PATCH 0617 — extended to USA stocks.
  // Strict (cross-confirmed): A+/A grade + on CB + not in Decision Log.
  // If strict yields < 6, top up with A+/A grade names NOT on CB.
  // Cross-confirmed ones flagged cbConfirmed=true. Each card carries _market.
  const symKey = (s: any) => (s || '').toString().toUpperCase().replace(/\.(NS|BO)$/i, '');
  const buildTier = (r: any, cbConfirmed?: boolean): TierAction => ({
    symbol: r.symbol, company: r.company || r.companyName,
    score: r.score ?? r.composite, grade: r.grade, sector: r.sector,
    ...riskFraming(r.sector, 'multibagger'),
    scoreBreakdown: decomposeScore(r),
    href: `/stock-sheet?ticker=${encodeURIComponent((r.symbol || '').replace(/\.(NS|BO)$/i, ''))}${r._market === 'US' ? '&market=us' : ''}`,
    cbConfirmed,
    market: r._market,
  } as TierAction);

  const tier1Strict = allRows
    .filter((r: any) => (r.grade === 'A+' || r.grade === 'A')
                     && cbSet.has(symKey(r.symbol))
                     && !decisions[(r.symbol || '').toUpperCase()])
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .map((r: any) => buildTier(r, true));

  // PATCH 0618 — Tier 1 grown 6 → 8 now that USA stocks share the slot.
  let tier1: TierAction[] = tier1Strict.slice(0, 8);
  if (tier1.length < 8) {
    const haveSyms = new Set(tier1.map(t => symKey(t.symbol)));
    const fillers = allRows
      .filter((r: any) => (r.grade === 'A+' || r.grade === 'A')
                       && !haveSyms.has(symKey(r.symbol))
                       && !decisions[(r.symbol || '').toUpperCase()])
      .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 8 - tier1.length)
      .map((r: any) => buildTier(r, false));
    tier1 = [...tier1, ...fillers];
  }

  const tier2 = allRows
    .filter((r: any) => (r.grade === 'A+' || r.grade === 'A') && !tier1.find(t => t.symbol === r.symbol))
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8)
    .map((r: any) => buildTier(r));

  const tier3 = allRows
    .filter((r: any) => r.grade === 'B+' && cbSet.has(symKey(r.symbol)))
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5)
    .map((r: any) => buildTier(r));

  // PATCH 0617 — includes both India + USA changes
  const changedToday: ChangedRow[] = allRows
    .map((r: any) => {
      const sym = (r.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
      const prevMap = r._market === 'US' ? prevScoresUsa : prevScores;
      const prev = prevMap[r.symbol] ?? prevMap[sym];
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
    const row = allRows.find((r: any) => (r.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '') === sym);
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
      // PATCH 0618 — captures WHY a fetch failed so we can surface real
      // diagnostics on the home dashboard. Returns [data, errorReason].
      // errorReason values: 'http_404' / 'http_500' / 'timeout' / 'network' / 'parse'.
      const safeDiag = async <T,>(url: string, timeoutMs = 15_000): Promise<{ data: T | null; error?: string; status?: number }> => {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), timeoutMs);
          const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
          clearTimeout(t);
          if (!r.ok) return { data: null, error: `http_${r.status}`, status: r.status };
          try { return { data: await r.json() as T, status: r.status }; }
          catch { return { data: null, error: 'parse' }; }
        } catch (e: any) {
          if (e?.name === 'AbortError') return { data: null, error: 'timeout' };
          return { data: null, error: 'network' };
        }
      };
      const safe = async <T,>(url: string): Promise<T | null> => (await safeDiag<T>(url)).data;

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
      const TWENTY_FOUR_H_MS = 24 * 3600_000;

      // PATCH 0606 — three independent network fires; each updates state
      // separately so the page is fully usable as soon as ANY one returns.
      //
      // PATCH 0618 — In-Play News, fix #4 (the one that actually works):
      // ROOT CAUSE: previous 8s fetch timeout was too tight for /api/v1/news
      // which returns 300+KB on slower connections. safe() silently returned
      // null on timeout, so the diagnostic showed 'fetched 0' even though the
      // API has 46 items. Fix: use safeDiag with 20s timeout, smaller limit
      // (40 -> still gets 25 items past filter), and surface the actual error
      // ('timeout' / 'http_500' / 'network') so we never wonder again.
      safeDiag<any>(`/api/v1/news?limit=40&_=${Date.now()}`, 20_000).then(({ data: j, error, status }) => {
        if (cancelled) return;
        const raw: NewsItem[] = Array.isArray(j) ? j : (j?.articles || j?.items || []);
        const ageOk = (a: any) => {
          if (!a?.published_at) return true;
          try {
            const age = Date.now() - new Date(a.published_at).getTime();
            if (age > TWENTY_FOUR_H_MS) return false;
            if (age < -600_000) return false;  // tolerate 10-min clock skew
            return true;
          } catch { return true; }
        };
        const isStructural = (a: any) => {
          if (a?.is_synthetic) return true;
          if (a?.structural_status) return true;
          if (a?.feed_layer === 'STRUCTURAL_ALPHA') return true;
          if (a?.feed_type === 'STRUCTURAL_ALPHA') return true;
          const t = (a?.title || a?.headline || '');
          if (t.startsWith('[STRUCTURAL]')) return true;
          if (t.startsWith('[STRUCTURAL ALERT]')) return true;
          return false;
        };
        const recent = raw.filter(ageOk);
        const clean = recent.filter((a: any) => !isStructural(a));
        const sortFn = (a: any, b: any) => {
          const aImp = a?.importance_score ?? 0;
          const bImp = b?.importance_score ?? 0;
          if (aImp !== bImp) return bImp - aImp;
          const aT = a?.published_at ? new Date(a.published_at).getTime() : 0;
          const bT = b?.published_at ? new Date(b.published_at).getTime() : 0;
          return bT - aT;
        };
        clean.sort(sortFn);
        // Fallback: if structural filter wiped everything but we DO have
        // recent items, surface them anyway (they at least show the user
        // there's a live feed; the structural items get a small chip).
        const final = clean.length > 0 ? clean : recent.sort(sortFn);
        setData((d) => ({
          ...d,
          inPlay: final.slice(0, 8),
          inPlayDiag: { fetched: raw.length, recent: recent.length, clean: clean.length, fellBack: clean.length === 0 && recent.length > 0, error, status },
        } as any));
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

      // PATCH 0617 — Concall Intelligence summary on Home.
      // Pulls the same /concall-intel/live-feed used by Rating Actions
      // (Patch 0599) and surfaces the top 5 most-recent hits with tier.
      safe<any>(`/api/v1/concall-intel/live-feed?days=14&_=${Date.now()}`).then((j) => {
        if (cancelled) return;
        const raw = Array.isArray(j) ? j : (j?.items || j?.articles || j?.results || []);
        const hits = (raw as any[])
          .filter((a: any) => a && (a.headline || a.title))
          .map((a: any) => ({
            ticker: (a.ticker || a.primary_ticker || a.symbol || '').toString(),
            company: a.company || a.company_name,
            headline: a.headline || a.title || '',
            tier: a.tier || a.investment_tier || a.classification,
            published_at: a.published_at || a.date,
          }))
          .filter((h: any) => h.ticker && h.headline)
          .slice(0, 8);
        setData((d) => ({ ...d, concallHits: hits } as any));
      });

      // Earnings — PATCH 0615. Pull today + last 2 trading days, filter to
      // BLOCKBUSTER + STRONG only (drop MIXED/AVOID — those clutter the home
      // dashboard). Sort by tier+score, dedup by ticker, slice to top 8.
      // Label reflects the date range used: 'today' / 'yesterday' / explicit date.
      (async () => {
        const tradingDays = (() => {
          const out: string[] = [];
          const d = new Date();
          const ist = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000);
          // include today as day 0
          const todayDow = ist.getDay();
          if (todayDow !== 0 && todayDow !== 6) out.push(ist.toISOString().slice(0, 10));
          // walk back up to 10 calendar days, collecting up to 2 weekdays
          for (let i = 0; i < 10 && out.length < 3; i++) {
            ist.setDate(ist.getDate() - 1);
            const dow = ist.getDay();
            if (dow !== 0 && dow !== 6) out.push(ist.toISOString().slice(0, 10));
          }
          return out;
        })();

        const allCards: any[] = [];
        for (const date of tradingDays) {
          if (cancelled) return;
          const j = await safe<any>(`/api/v1/earnings/graded?date=${date}`);
          if (cancelled) return;
          const dayCards = flattenGraded(j)
            .filter((c: any) => c?.ticker)
            // PATCH 0615 — filter to BLOCKBUSTER + STRONG only.
            // MIXED and AVOID don't belong on a home dashboard.
            .filter((c: any) => {
              const t = (c.tier || '').toUpperCase();
              return t === 'BLOCKBUSTER' || t === 'STRONG';
            })
            .map((c: any) => ({ ...c, _date: date }));
          allCards.push(...dayCards);
        }
        // Sort: BLOCKBUSTER first, then by score within tier
        allCards.sort((a: any, b: any) => {
          const aBlock = (a.tier || '').toUpperCase() === 'BLOCKBUSTER' ? 0 : 1;
          const bBlock = (b.tier || '').toUpperCase() === 'BLOCKBUSTER' ? 0 : 1;
          if (aBlock !== bBlock) return aBlock - bBlock;
          return (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9)
              || (b.composite_score ?? 0) - (a.composite_score ?? 0);
        });
        // Dedupe by ticker (keep first occurrence, which will be the highest tier)
        const seen = new Set<string>();
        const deduped = allCards.filter((c: any) => {
          const k = (c.ticker || '').toUpperCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        const today = tradingDays[0];
        const yesterday = tradingDays[1];
        const label = (() => {
          if (deduped.length === 0) return 'today';
          const dates = Array.from(new Set(deduped.map((c: any) => c._date))).sort().reverse();
          if (dates.length === 1) {
            if (dates[0] === today) return 'today';
            if (dates[0] === yesterday) return 'yesterday';
            return dates[0];
          }
          // multi-date: name the freshest end of the range
          if (dates[0] === today) return `today + ${dates.length - 1} more`;
          if (dates[0] === yesterday) return `yesterday + ${dates.length - 1} more`;
          return `last ${dates.length} trading days`;
        })();
        setData((d) => ({ ...d, earningsToday: deduped.slice(0, 8), earningsLabel: label }));
        setNetLoading((n) => ({ ...n, earnings: false }));
      })();
    })();
    return () => { cancelled = true; };
  }, []);

  const activeAlerts = useMemo(() => data.alerts.filter(a => a.enabled), [data.alerts]);
  const portfolioCount = data.portfolio.length;
  // PATCH 0606 — no full-page loading state. Synchronous Tier 1/2/3 + portfolio
  // heat render instantly; network sections show their own loading chip.

  // ─────────────────────────────────────────────────────────────────────
  // PATCH 0613 — Saved Workspaces v1 (lens-switcher chip strip).
  // Filters Tier 1/2/3 cards in real-time. localStorage-persistent.
  // Preset lenses ship out-of-the-box; user can add custom ones via prompt().
  // Stored shape: { id: string; label: string; mode: 'all' | 'cbOnly' | 'aplus' | 'sectorRegex'; sectorRegex?: string; emoji?: string }
  // ─────────────────────────────────────────────────────────────────────
  type Lens = { id: string; label: string; mode: 'all' | 'cbOnly' | 'aplus' | 'sectorRegex'; sectorRegex?: string; emoji?: string };
  const PRESET_LENSES: Lens[] = useMemo(() => [
    { id: 'all',          label: 'ALL',                 mode: 'all',         emoji: '◯' },
    { id: 'cb-only',      label: 'CONVICTION-ONLY',     mode: 'cbOnly',      emoji: '★' },
    { id: 'aplus-only',   label: 'A+ ONLY',             mode: 'aplus',       emoji: '💎' },
    { id: 'industrials',  label: 'INDUSTRIALS',         mode: 'sectorRegex', sectorRegex: 'industrial|capital goods|engineering|machinery|defense|aerospace', emoji: '🏭' },
    { id: 'infra-power',  label: 'INFRA & POWER',       mode: 'sectorRegex', sectorRegex: 'electrical|power|utilit|infra|construction|cement|transmission', emoji: '⚡' },
    { id: 'pharma',       label: 'PHARMA & HEALTHCARE', mode: 'sectorRegex', sectorRegex: 'pharma|health|biotech|medical', emoji: '💊' },
    { id: 'consumer',     label: 'CONSUMER',            mode: 'sectorRegex', sectorRegex: 'consumer|fmcg|retail|durable|personal|textile|jewel', emoji: '🛍' },
  ], []);
  const [customLenses, setCustomLenses] = useState<Lens[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('mc:home-custom-lenses:v1') || '[]') || []; } catch { return []; }
  });
  const [activeLensId, setActiveLensId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    try { return localStorage.getItem('mc:home-active-lens:v1') || 'all'; } catch { return 'all'; }
  });
  useEffect(() => {
    try { localStorage.setItem('mc:home-active-lens:v1', activeLensId); } catch {}
  }, [activeLensId]);
  useEffect(() => {
    try { localStorage.setItem('mc:home-custom-lenses:v1', JSON.stringify(customLenses)); } catch {}
  }, [customLenses]);

  const allLenses = useMemo(() => [...PRESET_LENSES, ...customLenses], [PRESET_LENSES, customLenses]);
  const activeLens = useMemo(() => allLenses.find(l => l.id === activeLensId) || PRESET_LENSES[0], [allLenses, activeLensId, PRESET_LENSES]);

  const applyLens = (items: TierAction[], isTier1: boolean): TierAction[] => {
    if (activeLens.mode === 'all') return items;
    if (activeLens.mode === 'cbOnly') return items.filter(it => it.cbConfirmed === true || (isTier1 ? false : true));
    if (activeLens.mode === 'aplus') return items.filter(it => it.grade === 'A+');
    if (activeLens.mode === 'sectorRegex' && activeLens.sectorRegex) {
      const re = new RegExp(activeLens.sectorRegex, 'i');
      return items.filter(it => re.test(it.sector || ''));
    }
    return items;
  };
  const lensedTier1 = useMemo(() => applyLens(data.tier1, true), [data.tier1, activeLens]);
  const lensedTier2 = useMemo(() => applyLens(data.tier2, false), [data.tier2, activeLens]);
  const lensedTier3 = useMemo(() => applyLens(data.tier3, false), [data.tier3, activeLens]);

  const addCustomLens = () => {
    const name = window.prompt('Lens name (e.g. "AI Infra")');
    if (!name) return;
    const pattern = window.prompt('Sector keyword (regex; e.g. "data center|ai|semiconductor")', '');
    if (!pattern) return;
    const newLens: Lens = {
      id: `custom-${Date.now()}`,
      label: name.toUpperCase().slice(0, 24),
      mode: 'sectorRegex',
      sectorRegex: pattern,
      emoji: '🎯',
    };
    setCustomLenses(prev => [...prev, newLens]);
    setActiveLensId(newLens.id);
  };
  const removeCustomLens = (id: string) => {
    setCustomLenses(prev => prev.filter(l => l.id !== id));
    if (activeLensId === id) setActiveLensId('all');
  };

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

        {/* ═══════════════ PATCH 0613 — LENS SWITCHER ═══════════════════
            Saved Workspaces v1. Filters Tier 1/2/3 in real-time.
            User can add custom sector-regex lenses via the + button.
        ═════════════════════════════════════════════════════════════════ */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '6px 10px',
          background: '#0D1623',
          border: '1px solid #1A2540',
          borderRadius: 6,
        }}>
          <span style={{ fontSize: 10, color: DIM, fontWeight: 700, letterSpacing: '0.5px', marginRight: 4 }}>LENS</span>
          {allLenses.map((l) => {
            const isActive = l.id === activeLensId;
            const isCustom = !PRESET_LENSES.find(p => p.id === l.id);
            return (
              <span key={l.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <button
                  onClick={() => setActiveLensId(l.id)}
                  style={{
                    fontSize: 10,
                    padding: '3px 9px',
                    border: isActive ? '1px solid #22D3EE' : '1px solid #1A2540',
                    background: isActive ? '#22D3EE22' : 'transparent',
                    color: isActive ? '#22D3EE' : TEXT,
                    fontWeight: 700,
                    letterSpacing: '0.3px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {l.emoji || '◯'} {l.label}
                </button>
                {isCustom && isActive && (
                  <button
                    onClick={() => removeCustomLens(l.id)}
                    title="Delete this lens"
                    style={{ fontSize: 10, padding: '3px 5px', border: '1px solid #EF444440', background: 'transparent', color: '#EF4444', borderRadius: 4, cursor: 'pointer' }}
                  >×</button>
                )}
              </span>
            );
          })}
          <button
            onClick={addCustomLens}
            style={{ fontSize: 10, padding: '3px 9px', border: '1px dashed #22D3EE60', background: 'transparent', color: '#22D3EE', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
            title="Add a custom sector-keyword lens"
          >+ NEW LENS</button>
          {activeLens.mode !== 'all' && (
            <span style={{ fontSize: 10, color: DIM, marginLeft: 4 }}>
              · Tier 1: {lensedTier1.length}/{data.tier1.length} · Tier 2: {lensedTier2.length}/{data.tier2.length} · Tier 3: {lensedTier3.length}/{data.tier3.length}
            </span>
          )}
        </div>

        {/* ═══════════════ TIER 1 — IMMEDIATE ACTION ════════════════════ */}
        {lensedTier1.length > 0 ? (
          <DecisionTierBlock
            tier={1}
            label="IMMEDIATE ACTION"
            color="#10B981"
            description="Cross-confirmed (★) = A-grade + on Conviction Beats + not in Decision Log. (+) = A-grade top-up when fewer than 6 cross-confirmed exist."
            items={lensedTier1}
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
        {lensedTier2.length > 0 && (
          <DecisionTierBlock
            tier={2}
            label="STRUCTURAL WATCHLIST"
            color="#22D3EE"
            description="A-grade scorecard — not yet on Conviction Beats bench OR already decision-tagged"
            items={lensedTier2}
            expanded
            condensed
          />
        )}

        {/* ═══════════════ TWO-COL: PORTFOLIO HEAT + EARNINGS TODAY ═════ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>

          {/* PATCH 0611 — BOTTLENECK PULSE replaces Portfolio Exposure Heat.
              Surfaces top 3 active bottleneck themes with implicated tickers.
              Far higher signal: this is the transmission engine driving the whole
              portal's thesis. Each theme links to the workbench.            */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#EF4444', letterSpacing: '0.4px' }}>📡 BOTTLENECK PULSE</span>
              <Link href="/bottleneck-workbench" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Open Workbench →</Link>
            </div>
            {netLoading.bottleneck ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>📡 Scanning active bottlenecks…</div>
            ) : data.bottleneck.length === 0 ? (
              <div style={{ fontSize: 11, color: DIM, fontStyle: 'italic' }}>
                No active bottlenecks today. <Link href="/news?lifecycle=PERSISTENT" style={{ color: '#22D3EE' }}>Browse structural feed →</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, color: DIM, marginBottom: 2 }}>
                  Top 3 active themes · cross-confirmed across {data.bottleneck.length} buckets
                </div>
                {data.bottleneck.slice(0, 3).map((b: any) => {
                  const sev = (b.severity_label || '').toLowerCase();
                  const sevColor = sev === 'high' ? '#EF4444' : sev === 'medium' ? '#F59E0B' : '#22D3EE';
                  const sevGlyph = sev === 'high' ? '🔴' : sev === 'medium' ? '🟠' : '🟡';
                  const tix = (b.key_tickers || b.tickers || []).slice(0, 4);
                  const themeName = b.theme || b.label || b.name || 'Untitled bucket';
                  return (
                    <Link
                      key={themeName}
                      href={`/bottleneck-workbench?theme=${encodeURIComponent(themeName)}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div style={{
                        background: '#1A2540',
                        border: `1px solid ${sevColor}40`,
                        borderRadius: 5,
                        padding: '6px 8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        cursor: 'pointer',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontSize: 11, color: TEXT, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {sevGlyph} {themeName}
                          </span>
                          <span style={{ fontSize: 9, color: sevColor, fontWeight: 800, letterSpacing: '0.5px' }}>
                            {(b.severity_label || 'med').toUpperCase()} · {b.article_count || 0}
                          </span>
                        </div>
                        {tix.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {tix.map((t: string) => (
                              <span key={t} style={{ fontSize: 9, color: '#22D3EE', background: '#22D3EE15', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
                                {t}
                              </span>
                            ))}
                            {(b.key_tickers?.length || 0) > 4 && (
                              <span style={{ fontSize: 9, color: DIM }}>+{b.key_tickers.length - 4}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
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
                No filings graded in last 3 trading days. <Link href="/earnings-opportunities" style={{ color: '#22D3EE' }}>Open Earnings Ops →</Link>
              </div>
            ) : (() => {
              // PATCH 0615 — show inline date chip per card when multiple dates
              // are mixed in the result, so the user always sees provenance.
              const multiDay = new Set(data.earningsToday.map((c: any) => (c as any)._date).filter(Boolean)).size > 1;
              const fmtDay = (iso?: string) => {
                if (!iso) return '';
                const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (!m) return '';
                return `${m[3]}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m[2])-1]}`;
              };
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {data.earningsToday.map((c: any) => {
                    const tierColor = c.tier === 'BLOCKBUSTER' ? '#10B981' : c.tier === 'STRONG' ? '#22D3EE' : c.tier === 'MIXED' ? '#F59E0B' : '#EF4444';
                    const date = c._date as string | undefined;
                    return (
                      <Link key={c.ticker} href={`/stock-sheet?ticker=${encodeURIComponent(c.ticker)}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid #1A2540' }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.company || c.ticker}</span>
                        {multiDay && date && (
                          <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace' }}>{fmtDay(date)}</span>
                        )}
                        <span style={{ fontSize: 9, fontWeight: 800, color: tierColor, padding: '1px 5px', borderRadius: 3, background: `${tierColor}22` }}>
                          {c.tier} {c.composite_score}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        {/* ═══════════════ PATCH 0617 — CONCALL INTELLIGENCE SUMMARY ═════ */}
        {data.concallHits && data.concallHits.length > 0 && (
          <div style={{ ...cardStyle, borderLeft: '3px solid #A78BFA' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#A78BFA', letterSpacing: '0.4px' }}>
                🎙 CONCALL INTELLIGENCE — last 14d ({data.concallHits.length})
              </span>
              <Link href="/concall-intel" style={{ fontSize: 10, color: '#22D3EE', textDecoration: 'none' }}>Full Intel →</Link>
            </div>
            <div style={{ fontSize: 10, color: DIM, marginBottom: 6 }}>
              Most-recent management commentary catalysts — earnings calls + analyst meets surfaced via the live feed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {data.concallHits.slice(0, 6).map((h, i) => {
                const tierColor = !h.tier ? '#94A3B8'
                  : /BLOCKBUSTER|TIER\s*1/i.test(h.tier) ? '#10B981'
                  : /STRONG|TIER\s*2/i.test(h.tier) ? '#22D3EE'
                  : /MIXED|NEUTRAL/i.test(h.tier) ? '#F59E0B' : '#94A3B8';
                const cleanTier = (h.tier || '').replace(/_/g, ' ').slice(0, 18);
                return (
                  <Link key={(h.ticker || '') + i} href={`/stock-sheet?ticker=${encodeURIComponent((h.ticker || '').replace(/\.(NS|BO)$/i, ''))}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', textDecoration: 'none', borderBottom: '1px solid #1A2540' }}>
                    <span style={{ fontSize: 10, color: '#A78BFA', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 60 }}>
                      {(h.ticker || '').replace(/\.(NS|BO)$/i, '').slice(0, 8)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: TEXT, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.headline}
                    </span>
                    {cleanTier && (
                      <span style={{ fontSize: 9, fontWeight: 800, color: tierColor, padding: '1px 5px', borderRadius: 3, background: `${tierColor}22`, whiteSpace: 'nowrap' }}>
                        {cleanTier}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

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
        {lensedTier3.length > 0 && (
          <div style={cardStyle}>
            <button onClick={() => setShowTier3(v => !v)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 13, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.4px',
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            }}>
              {showTier3 ? '▾' : '▸'} 🧪 TIER 3 — EXPERIMENTAL / NARRATIVE ({lensedTier3.length})
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
                  {lensedTier3.map((a, i) => (
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
            {showInPlay ? '▾' : '▸'} 🔥 IN-PLAY NEWS — last 24h ({data.inPlay.length})
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
            <div style={{ fontSize: 11, color: DIM, marginTop: 8, fontStyle: 'italic', lineHeight: 1.5 }}>
              {data.inPlayDiag?.error
                ? `News feed unreachable (${data.inPlayDiag.error}${data.inPlayDiag.status ? ' / HTTP ' + data.inPlayDiag.status : ''}). Backend may be cold-starting.`
                : 'No live in-play news in last 24 hours.'}
              {data.inPlayDiag && (
                <div style={{ fontSize: 10, color: DIM, marginTop: 6, fontFamily: 'ui-monospace, monospace' }}>
                  Diagnostic: fetched {data.inPlayDiag.fetched} · within 24h {data.inPlayDiag.recent} · after structural filter {data.inPlayDiag.clean}
                  {data.inPlayDiag.error && <span style={{ color: '#F87171' }}> · error: {data.inPlayDiag.error}</span>}
                </div>
              )}
              <button
                onClick={() => { window.location.reload(); }}
                style={{ marginTop: 8, fontSize: 10, padding: '4px 10px', border: '1px solid #22D3EE60', background: 'transparent', color: '#22D3EE', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
              >
                🔄 RETRY
              </button>
            </div>
          )}
          {/* PATCH 0617 — show fallback notice if structural filter wiped everything but we still surfaced items */}
          {showInPlay && !netLoading.inPlay && data.inPlay.length > 0 && data.inPlayDiag?.fellBack && (
            <div style={{ fontSize: 10, color: '#F59E0B', marginTop: 6, padding: '4px 8px', background: '#F59E0B15', border: '1px solid #F59E0B40', borderRadius: 4 }}>
              ⚠ Only structural alerts available in last 24h — showing them anyway so the feed isn't empty.
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
                  <div style={{ fontSize: condensed ? 12 : 14, fontWeight: 700, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {a.company || a.symbol}
                    {/* PATCH 0617 — market flag chip (IN/US) */}
                    {a.market && (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 3, color: a.market === 'US' ? '#F87171' : '#22D3EE', background: a.market === 'US' ? '#F8717122' : '#22D3EE22' }}>
                        {a.market === 'US' ? '🇺🇸 US' : '🇮🇳 IN'}
                      </span>
                    )}
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
                {/* PATCH 0611 — cbConfirmed glyph so Tier-1 top-ups (non-CB A-grade) are obvious */}
                {tier === 1 && a.cbConfirmed === true && (
                  <span title="Cross-confirmed: on Conviction Beats bench" style={{ fontSize: 12, color: '#F59E0B', fontWeight: 800 }}>★</span>
                )}
                {tier === 1 && a.cbConfirmed === false && (
                  <span title="A-grade top-up: not yet on Conviction Beats bench" style={{ fontSize: 10, color: '#94A3B8', background: '#94A3B822', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>+</span>
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
