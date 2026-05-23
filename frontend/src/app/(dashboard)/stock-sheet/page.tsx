'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE-STOCK SHEET — patch 0093
//
// Runs the user's 16-section institutional stock-buying checklist on any
// ticker.  Per section, each criterion is a yes / no / N/A signal with an
// evidence note.  Where the data exists, signals are auto-pre-filled from
// the cockpit's existing endpoints (quotes, earnings-scan, news, beneficiary
// layers).  The rest are manual research fields.
//
// At the top: summary scorecard — YES count, NO count, % aligned, and a
// final verdict (BUY / WATCH / SKIP) computed from weighted YES/NO across
// the 16 sections.  All state is persisted to localStorage keyed by ticker
// so the user can come back to a thesis.
//
// 16 sections (mirror the user's framework):
//   1.  Theme / Macro                — policy, secular trend, supply, capital flow
//   2.  Catalyst / Inflection        — earnings, contracts, regulation
//   3.  Sentiment / Market Interest  — analyst upgrades, retail attention
//   4.  Price / Volume Action        — RS, breakout, sector breadth
//   5.  Financial Quality            — growth, ROIC, gross margin, FCF
//   6.  Business Model               — segments, customers, geography
//   7.  Moat / Competitive Advantage — IP, regulatory, scale, switching cost
//   8.  Competition / Industry       — fragmentation, cycle, share gain
//   9.  Management / Insider         — founder-led, ownership, alignment
//   10. Dilution / Share Structure   — share count trend, SBC, raises
//   11. Red Flags                    — concentration, accounting, legal
//   12. TAM / Optionality            — runway, adjacencies, internationality
//   13. Valuation                    — PEG, EV/Rev, P/E, peer + history + private
//   14. Rarity Premium Multipliers   — policy alignment, monopoly, irreplaceability
//   15. Portfolio Classification     — Speculative / P&S / Leader / Rarity
//   16. Final Questions              — strategic asset, hold-through-drawdown
// ═══════════════════════════════════════════════════════════════════════════

import { Component, ErrorInfo, ReactNode, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Save, Trash2, FileDown, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
// PATCH 0455 — Surface Company Intelligence guidance items on every stock sheet.
import { CompanyIntelGuidance } from '@/components/CompanyIntelGuidance';

// PATCH 0108 — BUG-01 fix: defensive scalar extraction.  Some quote APIs
// return signed-numeric fields as `{direction, magnitude}` objects (their
// internal sentiment shape).  Rendering an object as a JSX child throws
// React Error #31.  This helper unwraps the magnitude with a sign.
function safeScalar(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object') {
    if ('magnitude' in v) {
      const mag = Number(v.magnitude);
      if (!Number.isFinite(mag)) return null;
      const dir = String(v.direction ?? '').toLowerCase();
      const sign = (dir === 'down' || dir === 'negative' || dir === 'bear' || dir === 'down_strong') ? -1 : 1;
      return mag * sign;
    }
    // AUDIT_100 #15 — explicit Number.isFinite guard mirroring the top-level
    // numeric branch. The recursive `safeScalar(v.value)` does protect via
    // its own Number.isFinite check, but a bare `Number(v.value)` here would
    // be defensive against future refactors and is cheaper than recursion.
    if ('value' in v) {
      const inner = v.value;
      if (inner == null) return null;
      const n = typeof inner === 'number' ? inner : Number(inner);
      if (Number.isFinite(n)) return n;
      return safeScalar(inner);
    }
  }
  return null;
}

// PATCH 0108 — BUG-01: ErrorBoundary so a malformed API row doesn't kill the page.
class StockSheetErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message?: string }> {
  state = { hasError: false, message: undefined as string | undefined };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message?.slice(0, 240) || 'Unknown error' };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[StockSheet] crash:', error, info?.componentStack);
  }
  reset = () => this.setState({ hasError: false, message: undefined });
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ margin: 18, padding: 16, backgroundColor: '#0D1B2E', border: '1px solid #EF4444', borderRadius: 10, color: '#FCA5A5', fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 6, color: '#EF4444' }}>
            <AlertTriangle style={{ width: 16, height: 16 }} />
            Stock Sheet — render error
          </div>
          <div style={{ marginBottom: 8 }}>{this.state.message}</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 8 }}>
            One section returned an unexpected payload shape. The header above is still usable; try a different ticker or click reset.
          </div>
          <button onClick={this.reset} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 700, borderRadius: 4, border: '1px solid #EF444460', backgroundColor: '#EF444420', color: '#EF4444', cursor: 'pointer' }}>
            Reset
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

type Signal = 'YES' | 'NO' | 'N/A';

interface CriterionSpec {
  id: string;
  label: string;
  weight: number;          // 1 (light), 2 (standard), 3 (heavy)
  // If true, the criterion is treated as DISQUALIFYING when answered NO
  // (or when answered YES, depending on polarity below).
  disqualifying?: boolean;
  // 'POSITIVE' = YES is good. 'NEGATIVE' = YES is bad (red-flag style).
  polarity?: 'POSITIVE' | 'NEGATIVE';
  hint?: string;           // tooltip / placeholder
}

interface SectionSpec {
  id: number;
  title: string;
  emoji: string;
  color: string;
  rationale: string;
  criteria: CriterionSpec[];
}

interface AnswerState {
  signal: Signal | null;
  evidence: string;
}

type SheetState = Record<string, AnswerState>;   // keyed by criterion id

interface StoredSheet {
  ticker: string;
  region: 'IN' | 'GLOBAL';
  saved_at: string;
  state: SheetState;
}

// ─── Sections ──────────────────────────────────────────────────────────────

const SECTIONS: ReadonlyArray<SectionSpec> = [
  {
    id: 1, title: 'Theme / Macro', emoji: '🌐', color: '#22D3EE',
    rationale: 'Policy alignment + secular tailwind = the multi-year wind at your back. Without theme, multiples compress regardless of execution.',
    criteria: [
      { id: 't1', label: 'Policy aligned (EOs / DoD / IRA / subsidies / export controls)?', weight: 3 },
      { id: 't2', label: 'Multi-year secular trend (not cyclical)?', weight: 3 },
      { id: 't3', label: 'Supply-constrained industry?', weight: 2 },
      { id: 't4', label: 'Strategic / national importance?', weight: 2 },
      { id: 't5', label: 'Multi-theme exposure (≥2 megatrends)?', weight: 2 },
      { id: 't6', label: 'Capital flowing into theme (capex visible)?', weight: 2 },
      { id: 't7', label: 'Theme activation visible in ordering / news?', weight: 2 },
    ],
  },
  {
    id: 2, title: 'Catalyst / Inflection', emoji: '⚡', color: '#FBBF24',
    rationale: 'A clean catalyst within 6-18 months separates timely from "theoretically good". Earnings inflection or contract-led re-rating is the dominant alpha trigger.',
    criteria: [
      { id: 'c1', label: 'Government / mega contracts disclosed?', weight: 3 },
      { id: 'c2', label: 'Earnings inflection visible (rising rev × improving margin)?', weight: 3 },
      { id: 'c3', label: 'Strategic partnership / JV announced?', weight: 2 },
      { id: 'c4', label: 'Product / capacity launch within 12 months?', weight: 2 },
      { id: 'c5', label: 'Regulatory tailwind (PLI / FDI / approvals)?', weight: 2 },
      { id: 'c6', label: 'Estimate revisions accelerating up?', weight: 2 },
      { id: 'c7', label: 'Verifiable re-rating event within 6-18 months?', weight: 3 },
    ],
  },
  {
    id: 3, title: 'Sentiment / Market Interest', emoji: '📡', color: '#A78BFA',
    rationale: 'Underfollowed + accumulating quietly = best setup. Crowded trades cap upside.',
    criteria: [
      { id: 's1', label: 'Analyst upgrades / target hikes recent?', weight: 2 },
      { id: 's2', label: 'Conference / industry mentions rising?', weight: 1 },
      { id: 's3', label: 'Twitter / Reddit / institutional commentary increasing?', weight: 1 },
      { id: 's4', label: 'Institutional accumulation (FII / DII flows positive)?', weight: 2 },
      { id: 's5', label: 'Underfollowed by Wall Street / sell-side (<10 analysts)?', weight: 2 },
    ],
  },
  {
    id: 4, title: 'Price / Volume Action', emoji: '📈', color: '#38BDF8',
    rationale: 'Confirms the institutional read. If price/volume disagrees, the thesis is early — or wrong.',
    criteria: [
      { id: 'p1', label: 'Chart setup constructive (no broken structure)?', weight: 2 },
      { id: 'p2', label: 'Relative strength leading the broad market?', weight: 2 },
      { id: 'p3', label: 'High-volume breakout in last 60 days?', weight: 2 },
      { id: 'p4', label: 'Sector breadth participating (peers also strong)?', weight: 2 },
      { id: 'p5', label: 'Dark-pool / block-deal activity flagged?', weight: 1 },
      { id: 'p6', label: 'Real money entering the sector (not just retail)?', weight: 2 },
    ],
  },
  {
    id: 5, title: 'Financial Quality', emoji: '💎', color: '#10B981',
    rationale: 'Hard numerical bar. Misses here = high mortality even with great theme.',
    criteria: [
      { id: 'f1', label: 'Revenue growth >20% (last 4 quarters)?', weight: 3 },
      { id: 'f2', label: 'EPS growth accelerating?', weight: 3 },
      { id: 'f3', label: 'ROIC > 15%?', weight: 2 },
      { id: 'f4', label: 'Gross margin > 40%?', weight: 2 },
      { id: 'f5', label: 'Gross margins stable or expanding?', weight: 2 },
      { id: 'f6', label: 'Operating leverage visible (margin > revenue growth)?', weight: 2 },
      { id: 'f7', label: 'FCF positive OR clear path within 12 months?', weight: 3 },
      { id: 'f8', label: 'Debt / Equity < 1.5?', weight: 2 },
      { id: 'f9', label: 'Strong liquidity / cash runway?', weight: 2 },
      { id: 'f10', label: 'Can avoid emergency dilution / raise?', weight: 2 },
    ],
  },
  {
    id: 6, title: 'Business Model', emoji: '🏗️', color: '#06B6D4',
    rationale: 'Understand WHAT they sell, to WHOM, HOW. Concentration kills.',
    criteria: [
      { id: 'b1', label: '2-3 products generate ≥80% of revenue (clear focus)?', weight: 2 },
      { id: 'b2', label: 'Customer concentration < 30%?', weight: 2 },
      { id: 'b3', label: 'Blue-chip customers / partners?', weight: 2 },
      { id: 'b4', label: 'Geography diversified (not single-region risk)?', weight: 1 },
      { id: 'b5', label: 'Recurring / contracted revenue base?', weight: 2 },
    ],
  },
  {
    id: 7, title: 'Moat / Competitive Advantage', emoji: '🏰', color: '#8B5CF6',
    rationale: 'Without moat, growth gets competed away. Rarity premium > theme premium.',
    criteria: [
      { id: 'm1', label: 'Technology or IP advantage?', weight: 3 },
      { id: 'm2', label: 'Regulatory moat (license / approval barrier)?', weight: 3 },
      { id: 'm3', label: 'Scale advantage?', weight: 2 },
      { id: 'm4', label: 'High switching costs?', weight: 2 },
      { id: 'm5', label: 'Scarcity / monopoly asset?', weight: 3 },
      { id: 'm6', label: 'National security relevance?', weight: 2 },
      { id: 'm7', label: 'Competitive advantage WIDENING (not just present)?', weight: 3 },
      { id: 'm8', label: 'Rarity premium credibly exists (vs commodity peers)?', weight: 3 },
    ],
  },
  {
    id: 8, title: 'Competition / Industry Structure', emoji: '⚔️', color: '#F59E0B',
    rationale: 'Where is the cycle, who is gaining share, how fragmented?',
    criteria: [
      { id: 'co1', label: 'Direct competitor count manageable (≤5 serious players)?', weight: 2 },
      { id: 'co2', label: 'Industry consolidating (not fragmenting)?', weight: 2 },
      { id: 'co3', label: 'Secular vs cyclical (preference: secular)?', weight: 2 },
      { id: 'co4', label: 'Early in cycle (capacity tight, prices firm)?', weight: 2 },
      { id: 'co5', label: 'Market share INCREASING?', weight: 3 },
    ],
  },
  {
    id: 9, title: 'Management / Insider', emoji: '👤', color: '#EC4899',
    rationale: 'Skin in game + capital discipline = compounding edge.',
    criteria: [
      { id: 'mg1', label: 'Founder-led OR long-tenured operator CEO?', weight: 2 },
      { id: 'mg2', label: 'Insider ownership > 5%?', weight: 2 },
      { id: 'mg3', label: 'CEO / founder skin in the game (recent buys)?', weight: 2 },
      { id: 'mg4', label: 'Recent insider transactions are NET BUYS?', weight: 2 },
      { id: 'mg5', label: 'Capital allocation history disciplined?', weight: 3 },
      { id: 'mg6', label: 'Track record of hitting / raising guidance?', weight: 2 },
    ],
  },
  {
    id: 10, title: 'Dilution / Share Structure', emoji: '🧾', color: '#94A3B8',
    rationale: 'Best business gets ruined by serial dilution. Watch the share count, not the buzz.',
    criteria: [
      { id: 'd1', label: 'Share count flat or shrinking over 3-5 years?', weight: 3 },
      { id: 'd2', label: 'Stock-based comp moderate (≤8% of revenue)?', weight: 2 },
      { id: 'd3', label: 'No frequent equity raises?', weight: 2 },
      { id: 'd4', label: 'No convertible-debt overhang?', weight: 2 },
      { id: 'd5', label: 'Warrants / outstanding dilution manageable?', weight: 1 },
      { id: 'd6', label: 'Company can self-fund growth (no forced raises)?', weight: 2 },
    ],
  },
  {
    id: 11, title: 'Red Flags', emoji: '🚩', color: '#EF4444',
    rationale: 'YES on these is BAD. Polarity inverted in scoring.',
    criteria: [
      { id: 'r1', label: 'Customer over-concentration?', weight: 2, polarity: 'NEGATIVE' },
      { id: 'r2', label: 'Accounting complexity / restatements?', weight: 3, polarity: 'NEGATIVE', disqualifying: true },
      { id: 'r3', label: 'Active legal / regulatory issues?', weight: 2, polarity: 'NEGATIVE' },
      { id: 'r4', label: 'Weak / stressed balance sheet?', weight: 3, polarity: 'NEGATIVE' },
      { id: 'r5', label: 'Cyclical earnings risk mispriced as secular?', weight: 2, polarity: 'NEGATIVE' },
      { id: 'r6', label: 'Commodity exposure mispriced?', weight: 2, polarity: 'NEGATIVE' },
      { id: 'r7', label: 'High execution / delivery risk?', weight: 2, polarity: 'NEGATIVE' },
      { id: 'r8', label: 'Heavy dependency on subsidies / single policy?', weight: 2, polarity: 'NEGATIVE' },
    ],
  },
  {
    id: 12, title: 'TAM / Optionality', emoji: '🌍', color: '#10B981',
    rationale: 'You want a small share of a giant pond, with adjacencies you didnt pay for.',
    criteria: [
      { id: 'tam1', label: 'TAM > 10x current revenue?', weight: 3 },
      { id: 'tam2', label: 'Large adjacencies (next leg of growth visible)?', weight: 2 },
      { id: 'tam3', label: 'International expansion runway?', weight: 2 },
      { id: 'tam4', label: 'Optional future products / services?', weight: 2 },
      { id: 'tam5', label: 'Multiple growth vectors (≥3 levers)?', weight: 2 },
    ],
  },
  {
    id: 13, title: 'Valuation', emoji: '⚖️', color: '#F59E0B',
    rationale: 'Even great businesses are bad investments at the wrong price. Use the right framework per business type.',
    criteria: [
      { id: 'v1', label: 'PEG < 1.5 (or appropriate alternative metric clears bar)?', weight: 3 },
      { id: 'v2', label: 'EV / Revenue reasonable for growth profile?', weight: 2 },
      { id: 'v3', label: 'Forward P/E < 30 with EPS growth > 25%?', weight: 2 },
      { id: 'v4', label: 'Cheap vs peers?', weight: 2 },
      { id: 'v5', label: 'Cheap vs own historical multiples?', weight: 2 },
      { id: 'v6', label: 'Cheap vs private-market value?', weight: 1 },
      { id: 'v7', label: 'Cheap vs strategic value (mispriced rarity)?', weight: 2 },
    ],
  },
  {
    id: 14, title: 'Rarity Premium Multipliers', emoji: '👑', color: '#FBBF24',
    rationale: 'Multiplier on top of standard valuation when policy + irreplaceability + monopoly stack.',
    criteria: [
      { id: 'rp1', label: 'Policy alignment confirmed (specific EO / law)?', weight: 3 },
      { id: 'rp2', label: 'Theme activation visible (orders / contracts)?', weight: 2 },
      { id: 'rp3', label: 'Irreplaceability confirmed (no near-term substitute)?', weight: 3 },
      { id: 'rp4', label: 'Strategic monopoly status (regulator / customer locked-in)?', weight: 3 },
      { id: 'rp5', label: 'National security importance?', weight: 2 },
    ],
  },
  {
    id: 15, title: 'Portfolio Classification', emoji: '🗂️', color: '#06B6D4',
    rationale: 'Pick the bucket honestly — sizing depends on it. Speculative gets small; Rarity Premium gets concentrated.',
    criteria: [
      { id: 'pc1', label: 'Speculative (early, optionality, binary)?', weight: 1 },
      { id: 'pc2', label: 'Picks & Shovels (enabler of theme winners)?', weight: 2 },
      { id: 'pc3', label: 'Industry Leader (dominant share, durable)?', weight: 2 },
      { id: 'pc4', label: 'Rarity Premium (strategic monopoly / irreplaceable)?', weight: 3 },
    ],
  },
  {
    id: 16, title: 'Final Questions', emoji: '🎯', color: '#10B981',
    rationale: 'The kill-switch layer. If any of these is NO, reconsider.',
    criteria: [
      { id: 'fq1', label: 'Genuine strategic asset (not narrative hype)?', weight: 3, disqualifying: true },
      { id: 'fq2', label: 'Would I hold through a 50% drawdown?', weight: 3, disqualifying: true },
      { id: 'fq3', label: 'Institutionally ownable in 3-5 years?', weight: 2 },
      { id: 'fq4', label: 'Can re-rate into a category leader?', weight: 2 },
      { id: 'fq5', label: 'Wall Street still early here?', weight: 2 },
    ],
  },
];

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useTickerQuote(ticker: string) {
  return useQuery({
    queryKey: ['ticker-quote', ticker],
    queryFn: async () => {
      // PATCH 0690 — was POSTing to /api/v1/market/quotes which doesn't
      // exist as a Next.js file route and fell through to the Render
      // backend rewrite (cold/down). Switched to GET /api/market/quote
      // (singular) — same endpoint Portfolio + Movers fallback uses
      // successfully. Remap changePercent → change_pct so the existing
      // safeScalar consumers keep working without per-call changes.
      if (!ticker) return null;
      const t = String(ticker).toUpperCase();
      // PATCH 0716 — 10s timeout + safe JSON parse + array guard.
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 10_000);
        let r: Response;
        try { r = await fetch(`/api/market/quote?symbols=${encodeURIComponent(t)}`, { cache: 'no-store', signal: ctl.signal }); }
        finally { clearTimeout(timer); }
        if (!r.ok) return null;
        let json: any = {};
        try { json = await r.json(); } catch { return null; }
        const stocksArr = Array.isArray(json?.stocks) ? json.stocks : [];
        const stock = stocksArr[0];
        if (!stock || typeof stock !== 'object') return null;
        return {
          ticker: stock.ticker,
          price: stock.price,
          change_pct: stock.changePercent ?? stock.change_pct,
          currency: stock.currency,
          exchange: stock.exchange,
          name: stock.name,
        };
      } catch {
        return null;
      }
    },
    enabled: !!ticker,
    staleTime: 60_000,
  });
}

function useTickerNews(ticker: string) {
  return useQuery({
    queryKey: ['ticker-news', ticker],
    queryFn: async () => {
      if (!ticker) return [] as any[];
      // PATCH 0095: default /news returns ARRAY (not { articles }).  Use
      // `watchlist` param (CSV of tickers) which the backend honours — that
      // restricts the feed to articles mentioning the requested ticker.
      // Then filter to last 90 days client-side.
      // PATCH 0737 — additionally fan out to /api/v1/news-india/<ticker>
      // (Yahoo + Google RSS free fallback, KV-cached 6h) in parallel. The
      // editorial /news cache is genuinely sparse for sub-₹5000Cr Indian
      // smallcaps (MINDACORP, SPARC, RATEGAIN-class). Merging the two
      // sources gives those names a real news section. USA tickers won't
      // typically get hits from the India fallback, so the merge is a
      // no-op for them.
      const [primaryRes, indiaRes] = await Promise.allSettled([
        api.get('/news', { params: { watchlist: ticker } }),
        // /api/v1/news-india/<ticker> — direct fetch, this endpoint isn't
        // under the api.get baseURL prefix the way /news is.
        fetch(`/api/v1/news-india/${encodeURIComponent(ticker)}`, { cache: 'no-store' })
          .then((r) => r.ok ? r.json() : { articles: [] })
          .catch(() => ({ articles: [] })),
      ]);

      const primary: any[] = primaryRes.status === 'fulfilled'
        ? (Array.isArray(primaryRes.value.data)
            ? primaryRes.value.data
            : (primaryRes.value.data?.articles || primaryRes.value.data?.items || []))
        : [];

      const indiaPayload: any = indiaRes.status === 'fulfilled' ? indiaRes.value : { articles: [] };
      const indiaArticles: any[] = (indiaPayload?.articles || []).map((n: any) => ({
        id: `india-rss:${n.url || n.title}`,
        title: n.title,
        url: n.url,
        source: n.source || 'India RSS',
        source_name: n.source || 'India RSS',
        published_at: n.publishedAt || n.published_at,
        // mark so the UI can tag these as fallback-source if desired
        _source_tier: 'INDIA_FALLBACK',
      }));

      // Merge + dedupe by URL/title — primary wins (editorial curation
      // is higher quality than raw RSS).
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const a of [...primary, ...indiaArticles]) {
        const key = (a?.url || a?.title || '').slice(0, 200);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(a);
      }

      const cutoff = Date.now() - 90 * 86400000;
      return merged.filter((a: any) => {
        if (!a?.published_at) return true;
        const t = new Date(a.published_at).getTime();
        return isNaN(t) || t >= cutoff;
      });
    },
    enabled: !!ticker,
    staleTime: 5 * 60_000,
  });
}

function useTickerEarnings(ticker: string) {
  return useQuery({
    queryKey: ['ticker-earnings', ticker],
    queryFn: async () => {
      if (!ticker) return null;
      try {
        const { data } = await api.get(`/market/earnings-scan`, { params: { symbols: ticker } });
        return data;
      } catch { return null; }
    },
    enabled: !!ticker,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}

// ─── Storage ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'mc:stock-sheet:v1:';

// PATCH 0125 — bulletproof scalar coercion.  Returns a primitive renderable
// string from any input.  Handles {direction, magnitude} sentiment shape,
// arrays, null, undefined, deep objects.  Used EVERYWHERE dynamic text
// touches JSX inside Stock Sheet — eliminates React Error #31 at source.
function safeText(v: any, max = 240): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    // Sentiment shape — render as readable string
    if ('direction' in v && 'magnitude' in v) {
      const dir = String((v as any).direction ?? '');
      const mag = Number((v as any).magnitude);
      const pct = Number.isFinite(mag) ? `${(mag * 100).toFixed(1)}%` : '';
      return `${dir} ${pct}`.trim();
    }
    try { return JSON.stringify(v).slice(0, max); } catch { return '[unrenderable]'; }
  }
  return '';
}

function loadSheet(ticker: string): StoredSheet | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY + ticker.toUpperCase());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSheet;
    // PATCH 0112/0125/0350: sanitize EVERY field in state — both signal and
    // evidence.  Any object-typed signal (legacy poisoned save) gets
    // coerced to null.  Evidence gets coerced to string.  This eliminates
    // the lingering React Error #31 from old localStorage entries.
    // PATCH 0350: nuke ANY extra object-typed fields on an AnswerState (old
    // schemas may have had `confidence`, `sentiment`, etc. as {direction,
    // magnitude} objects). Strip them entirely so they can't reach JSX.
    if (parsed?.state) {
      for (const k of Object.keys(parsed.state)) {
        const ans = parsed.state[k] as any;
        if (!ans) continue;
        if (ans.signal !== 'YES' && ans.signal !== 'NO' && ans.signal !== 'N/A') {
          ans.signal = null;
        }
        if (typeof ans.evidence !== 'string') {
          ans.evidence = safeText(ans.evidence);
        }
        // Strip every other field — only signal + evidence may live here.
        for (const f of Object.keys(ans)) {
          if (f !== 'signal' && f !== 'evidence') delete ans[f];
        }
      }
    }
    return parsed;
  } catch { return null; }
}
function saveSheet(s: StoredSheet) {
  try { localStorage.setItem(STORAGE_KEY + s.ticker.toUpperCase(), JSON.stringify(s)); } catch {}
}
function deleteSheet(ticker: string) {
  try { localStorage.removeItem(STORAGE_KEY + ticker.toUpperCase()); } catch {}
}
function listSavedTickers(): string[] {
  if (typeof window === 'undefined') return [];
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(STORAGE_KEY)) out.push(k.slice(STORAGE_KEY.length));
  }
  return out.sort();
}

// PATCH 0125 — one-time scrub of ALL Stock Sheet localStorage entries.
// Runs once per session.  Eliminates the lingering React Error #31 caused
// by older saves containing {direction, magnitude} sentiment objects in
// signal / evidence fields.  Re-uses loadSheet() sanitizer + saves back.
// PATCH 0163 — bump scrub key to force re-sanitise EVERY localStorage entry
// on next page load.  This catches any legacy {direction, magnitude} or
// object-typed signal/evidence values that slipped past previous scrubs.
const SCRUB_KEY = 'mc:stock-sheet:v4:scrub-2026-05-13';
function scrubAllSavedSheets() {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(SCRUB_KEY)) return;
    const tickers = listSavedTickers();
    for (const t of tickers) {
      const stored = loadSheet(t);
      if (stored) saveSheet(stored);
    }
    localStorage.setItem(SCRUB_KEY, '1');
  } catch {}
}

// PATCH 0114 — IMP-11: Stock Sheet blank-state shortcuts.
// Reads top Multibagger upload tickers from localStorage (mb_excel_scored_v2)
// so the user can jump straight from "I just uploaded my Excel" → "run sheet
// on my best-scoring stock" without typing.  Returns up to N entries sorted
// by composite score descending.
interface MBTopPick { symbol: string; score?: number; opmExpansion?: number; epsGrowth?: number; }
function listTopMultibaggerTickers(limit = 5): MBTopPick[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('mb_excel_scored_v2');
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    const picks: MBTopPick[] = [];
    for (const r of rows) {
      const sym = (r?.symbol || r?.ticker || r?.Symbol || '').toString().trim().toUpperCase();
      if (!sym) continue;
      const score = Number(r?.composite_score ?? r?.score ?? r?.compositeScore ?? 0) || 0;
      picks.push({
        symbol: sym,
        score,
        opmExpansion: Number(r?.opm_expansion ?? r?.opmExpansion ?? 0) || 0,
        epsGrowth: Number(r?.eps_growth ?? r?.epsGrowth ?? 0) || 0,
      });
    }
    return picks.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
  } catch { return []; }
}

// PATCH 0114 — recently viewed ring (last 5 tickers loaded in this browser).
// Distinct from "saved" — these are tickers the user opened even briefly,
// useful when they're flipping between candidates without committing a save.
const RECENT_KEY = 'mc:stock-sheet:recent:v1';
function loadRecentTickers(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string').slice(0, 8) : [];
  } catch { return []; }
}
function pushRecentTicker(ticker: string) {
  if (typeof window === 'undefined' || !ticker) return;
  try {
    const cur = loadRecentTickers().filter((t) => t !== ticker);
    cur.unshift(ticker);
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, 8)));
  } catch {}
}

// Example launches for fully empty sessions — covers US AI-DC, India PSU
// nuclear, India defense, India IT for diversity.
const EXAMPLE_TICKERS: { sym: string; label: string }[] = [
  { sym: 'LEU',          label: 'US · Nuclear fuel' },
  { sym: 'NBIS',         label: 'US · Sovereign AI' },
  { sym: 'NTPC.NS',      label: 'IN · Power' },
  { sym: 'HAL.NS',       label: 'IN · Defense' },
  { sym: 'MTARTECH.NS',  label: 'IN · Nuclear midcap' },
];

// ─── Scoring ────────────────────────────────────────────────────────────────

interface Score {
  yes: number;
  no: number;
  na: number;
  unanswered: number;
  weighted_yes: number;
  weighted_no: number;
  total_weight: number;
  alignment_pct: number;
  verdict: 'BUY' | 'WATCH' | 'SKIP' | 'INCOMPLETE';
  disqualifiers: string[];
}

function scoreSheet(state: SheetState): Score {
  let yes = 0, no = 0, na = 0, unanswered = 0;
  let weightedYes = 0, weightedNo = 0, totalWeight = 0;
  const disqualifiers: string[] = [];
  for (const s of SECTIONS) {
    for (const c of s.criteria) {
      const ans = state[c.id]?.signal;
      const polarityFlipped = c.polarity === 'NEGATIVE';
      if (ans === 'YES') {
        yes++;
        if (polarityFlipped) {
          weightedNo += c.weight;
          if (c.disqualifying) disqualifiers.push(`${s.emoji} ${c.label}`);
        } else {
          weightedYes += c.weight;
        }
        totalWeight += c.weight;
      } else if (ans === 'NO') {
        no++;
        if (polarityFlipped) {
          weightedYes += c.weight;
        } else {
          weightedNo += c.weight;
          if (c.disqualifying) disqualifiers.push(`${s.emoji} ${c.label}`);
        }
        totalWeight += c.weight;
      } else if (ans === 'N/A') {
        na++;
      } else {
        unanswered++;
      }
    }
  }
  const alignment = totalWeight > 0 ? Math.round((weightedYes / totalWeight) * 100) : 0;
  let verdict: Score['verdict'] = 'INCOMPLETE';
  const totalCriteria = SECTIONS.reduce((s, sec) => s + sec.criteria.length, 0);
  const answered = yes + no + na;
  if (answered < totalCriteria * 0.6) verdict = 'INCOMPLETE';
  else if (disqualifiers.length > 0) verdict = 'SKIP';
  else if (alignment >= 70) verdict = 'BUY';
  else if (alignment >= 50) verdict = 'WATCH';
  else verdict = 'SKIP';
  return { yes, no, na, unanswered, weighted_yes: weightedYes, weighted_no: weightedNo, total_weight: totalWeight, alignment_pct: alignment, verdict, disqualifiers };
}

// ─── Auto-prefill from existing data ────────────────────────────────────────

interface PrefillBundle {
  region: 'IN' | 'GLOBAL';
  hasRecentNews: boolean;
  newsCount90d: number;
  hasMegaContract: boolean;
  hasEarningsBeat: boolean;
  defenseRelevance: boolean;
  layeredMembership: string[];   // e.g. ['L1 (Direct Scarcity Capture)']
}

function autoPrefill(prefill: PrefillBundle, current: SheetState): SheetState {
  // Only fill criteria that are still null — never overwrite user input.
  const next = { ...current };
  const set = (id: string, signal: Signal, evidence: string) => {
    if (!next[id] || next[id].signal == null) {
      next[id] = { signal, evidence: `[auto] ${evidence}` };
    }
  };
  if (prefill.hasMegaContract) set('c1', 'YES', 'Mega-contract / strategic visibility hit detected in last 90d');
  if (prefill.hasEarningsBeat) set('c2', 'YES', 'Earnings-scan grade indicates revenue × margin inflection');
  if (prefill.newsCount90d >= 5) set('s2', 'YES', `${prefill.newsCount90d} news mentions in last 90d`);
  if (prefill.defenseRelevance) set('m6', 'YES', 'Defense / national-security cluster membership');
  return next;
}

// ─── PATCH 0118 — IMP-12: Decision Memo (Section 17) auto-generation ──────
// Synthesizes the YES/NO/NA pattern into a 3-paragraph institutional memo:
//   1. THESIS         — section 1-5 YES signals (theme / catalyst / quality)
//   2. KEY RISKS      — section 9-11 NO signals + any disqualifiers
//   3. CATALYST PATH  — section 2 + section 14 + watchitems
// Read-only output; regenerates on every state change.
interface DecisionMemo {
  thesis: string;
  risks: string;
  catalystPath: string;
  alignmentLabel: string;
}

function buildDecisionMemo(ticker: string, state: SheetState, score: Score): DecisionMemo {
  const yesEvidence = (ids: string[]): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      const ans = state[id];
      if (ans?.signal === 'YES') {
        const ev = (ans.evidence || '').replace(/^\[auto\]\s*/, '').trim();
        // Find criterion label for this id
        for (const s of SECTIONS) {
          const c = s.criteria.find((x) => x.id === id);
          if (c) {
            out.push(ev ? `${c.label.replace(/\?$/, '')} — ${ev}` : c.label.replace(/\?$/, ''));
            break;
          }
        }
      }
    }
    return out;
  };
  const noEvidence = (ids: string[]): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      const ans = state[id];
      if (ans?.signal === 'NO') {
        for (const s of SECTIONS) {
          const c = s.criteria.find((x) => x.id === id);
          if (c && c.polarity !== 'NEGATIVE') {
            // For positive-polarity criteria a NO is a concern
            out.push(c.label.replace(/\?$/, ''));
            break;
          }
        }
      }
      // For negative-polarity criteria a YES is the concern (already disqualifier path)
    }
    return out;
  };

  // Collect section IDs
  const thesisIds: string[] = [];
  const riskIds: string[] = [];
  const catalystIds: string[] = [];
  for (const s of SECTIONS) {
    if (s.id >= 1 && s.id <= 5)  thesisIds.push(...s.criteria.map((c) => c.id));
    if (s.id >= 9 && s.id <= 11) riskIds.push(...s.criteria.map((c) => c.id));
    if (s.id === 2 || s.id === 14) catalystIds.push(...s.criteria.map((c) => c.id));
  }

  const thesisHits = yesEvidence(thesisIds).slice(0, 5);
  const riskHits   = noEvidence(riskIds).slice(0, 5);
  const catHits    = yesEvidence(catalystIds).slice(0, 4);

  const sym = ticker.toUpperCase();
  const verdictLine = score.verdict === 'BUY'        ? `${sym} screens as a BUY candidate`
                    : score.verdict === 'WATCH'      ? `${sym} sits on the WATCH list`
                    : score.verdict === 'SKIP'       ? `${sym} fails the institutional bar`
                    :                                  `${sym} thesis is INCOMPLETE`;

  const thesis = thesisHits.length === 0
    ? `${verdictLine}.  Insufficient YES signals across theme / catalyst / quality (sections 1-5) to articulate a thesis — fill in those sections first.`
    : `${verdictLine} at ${score.alignment_pct.toFixed(0)}% alignment.  The case rests on: ${thesisHits.join('; ')}.`;

  const risks = riskHits.length === 0 && score.disqualifiers.length === 0
    ? `No disqualifiers flagged; sections 9-11 (management, dilution, red flags) clear.  Verify cyclical / industry-specific risk via section 8.`
    : score.disqualifiers.length > 0
      ? `Disqualifiers present: ${score.disqualifiers.join('; ')}.  Additional concerns: ${riskHits.join('; ') || 'none recorded'}.`
      : `Open concerns: ${riskHits.join('; ')}.`;

  const catalystPath = catHits.length === 0
    ? `No explicit catalyst signal in section 2 / section 14.  Position is a slow compounder bet, not a re-rating setup.  Re-test on next earnings.`
    : `Catalyst path: ${catHits.join('; ')}.  Monitor section 2 (inflection) and section 14 (rarity multipliers) on each earnings print.`;

  return {
    thesis,
    risks,
    catalystPath,
    alignmentLabel: `${score.verdict} · ${score.alignment_pct.toFixed(0)}% aligned · ${score.yes} ✓ / ${score.no} ✗ / ${score.unanswered} unanswered`,
  };
}

// ─── UI ─────────────────────────────────────────────────────────────────────

function inferRegionFromTicker(t: string): 'IN' | 'GLOBAL' {
  const T = t.toUpperCase();
  return T.endsWith('.NS') || T.endsWith('.BO') ? 'IN' : 'GLOBAL';
}

const VERDICT_COLOR: Record<Score['verdict'], string> = {
  BUY: '#10B981',
  WATCH: '#F59E0B',
  SKIP: '#EF4444',
  INCOMPLETE: '#6B7A8D',
};

export default function StockSheetPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTicker = (searchParams?.get('ticker') || '').toUpperCase();
  const [tickerInput, setTickerInput] = useState(initialTicker);
  const [activeTicker, setActiveTicker] = useState(initialTicker);
  const [state, setState] = useState<SheetState>({});
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({});
  const [savedList, setSavedList] = useState<string[]>([]);
  // PATCH 0114 — IMP-11: blank-state shortcuts state
  const [recentList, setRecentList] = useState<string[]>([]);
  const [mbTopList, setMbTopList] = useState<MBTopPick[]>([]);

  // PATCH 0125 — scrub legacy localStorage on first mount
  useEffect(() => { scrubAllSavedSheets(); }, []);

  useEffect(() => {
    setSavedList(listSavedTickers());
    setRecentList(loadRecentTickers());
    setMbTopList(listTopMultibaggerTickers(5));
  }, [activeTicker]);

  // Load from storage when activeTicker changes
  useEffect(() => {
    if (!activeTicker) { setState({}); return; }
    const stored = loadSheet(activeTicker);
    setState(stored?.state || {});
    // Open first 3 sections by default
    setOpenSections({ 1: true, 2: true, 3: true });
    // PATCH 0127 — Recently Viewed no longer pushed here; moved to a
    // separate effect that only fires after the sheet has rendered AND
    // at least one data probe came back.  Prevents crashed sessions
    // from polluting the recents ring.
  }, [activeTicker]);

  // Sync URL
  useEffect(() => {
    if (!activeTicker) return;
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (sp.get('ticker') !== activeTicker) {
      sp.set('ticker', activeTicker);
      router.replace(`/stock-sheet?${sp.toString()}`, { scroll: false });
    }
  }, [activeTicker, searchParams, router]);

  const region = useMemo(() => activeTicker ? inferRegionFromTicker(activeTicker) : 'GLOBAL', [activeTicker]);
  const { data: quote } = useTickerQuote(activeTicker);
  const { data: news } = useTickerNews(activeTicker);
  const { data: earningsData } = useTickerEarnings(activeTicker);

  // PATCH 0127 — save to Recently Viewed only AFTER at least one data probe
  // settles for the active ticker.  Crashed render = no quote arrives = no
  // recents pollution.  User QA: 'HBLENGINE shows in Recently Viewed even
  // though the sheet crashed before rendering anything meaningful'.
  useEffect(() => {
    if (!activeTicker) return;
    if (quote !== undefined || news !== undefined || earningsData !== undefined) {
      pushRecentTicker(activeTicker);
    }
  }, [activeTicker, quote, news, earningsData]);

  // Auto-prefill bundle
  const prefill = useMemo<PrefillBundle>(() => ({
    region,
    hasRecentNews: (news?.length || 0) > 0,
    newsCount90d: news?.length || 0,
    hasMegaContract: (news || []).some((a: any) => a?.strategic_visibility?.qualifies),
    hasEarningsBeat: !!earningsData && JSON.stringify(earningsData).includes('Beat'),
    defenseRelevance: (news || []).some((a: any) => a?.graph_primary_node === 'DEFENSE_INFRA' || a?.graph_primary_node === 'AEROSPACE_INFRA'),
    layeredMembership: [],
  }), [region, news, earningsData]);

  // Apply auto-prefill once when news loads (only fills empty fields)
  useEffect(() => {
    if (!activeTicker) return;
    if (!news) return;
    setState((cur) => autoPrefill(prefill, cur));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker, news, earningsData]);

  const score = useMemo(() => scoreSheet(state), [state]);
  // PATCH 0118 — IMP-12: Section 17 decision memo auto-generates from state
  const memo = useMemo(() => buildDecisionMemo(activeTicker, state, score), [activeTicker, state, score]);

  const handleAnswer = (id: string, signal: Signal | null) => {
    setState((s) => ({ ...s, [id]: { signal: signal as Signal, evidence: s[id]?.evidence || '' } }));
  };
  const handleEvidence = (id: string, evidence: string) => {
    setState((s) => ({ ...s, [id]: { signal: s[id]?.signal ?? null, evidence } }));
  };
  const handleSave = () => {
    if (!activeTicker) return;
    saveSheet({ ticker: activeTicker, region, saved_at: new Date().toISOString(), state });
    setSavedList(listSavedTickers());
  };
  const handleDelete = () => {
    if (!activeTicker) return;
    if (!confirm(`Delete saved sheet for ${activeTicker}?`)) return;
    deleteSheet(activeTicker);
    setState({});
    setSavedList(listSavedTickers());
  };
  const handleSubmit = () => {
    const T = tickerInput.trim().toUpperCase();
    if (!T) return;
    setActiveTicker(T);
  };

  return (
    <StockSheetErrorBoundary>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0A0E1A' }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: '#0D1B2E', borderBottom: '1px solid #1E2D45', padding: '14px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.6px' }}>
            🧠 SINGLE-STOCK SHEET
          </span>
          <span style={{ fontSize: 12, color: '#4A5B6C' }}>16-section institutional checklist · auto-pre-fill where data exists</span>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 320px', minWidth: 220 }}>
            <Search style={{ position: 'absolute', left: 10, top: 12, width: 14, height: 14, color: '#6B7A8D' }} />
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              placeholder="Enter ticker (e.g. LEU, NBIS, RELIANCE.NS, POWERGRID.NS)"
              style={{
                width: '100%', padding: '10px 12px 10px 34px',
                backgroundColor: '#0A1422', border: '1px solid #1A2840',
                borderRadius: 8, color: '#E6EDF3', fontSize: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                outline: 'none',
              }}
            />
          </div>
          <button type="submit" style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #22D3EE60', backgroundColor: '#22D3EE20', color: '#22D3EE', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Run sheet
          </button>
          {activeTicker && (
            <>
              <button type="button" onClick={handleSave} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #10B98160', backgroundColor: '#10B98120', color: '#10B981', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Save style={{ width: 14, height: 14 }} />Save
              </button>
              <button type="button" onClick={handleDelete} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #EF444460', backgroundColor: '#EF444420', color: '#EF4444', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Trash2 style={{ width: 14, height: 14 }} />Delete
              </button>
              <button type="button" onClick={() => window.print()} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #1A2840', backgroundColor: 'transparent', color: '#8A95A3', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FileDown style={{ width: 14, height: 14 }} />Print / PDF
              </button>
            </>
          )}
        </form>

        {savedList.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#6B7A8D' }}>SAVED:</span>
            {savedList.map((t) => (
              <button key={t} onClick={() => { setTickerInput(t); setActiveTicker(t); }}
                style={{ padding: '3px 10px', borderRadius: 4, border: t === activeTicker ? '1px solid #22D3EE60' : '1px solid #1A2840', backgroundColor: t === activeTicker ? '#22D3EE15' : '#0A1422', color: t === activeTicker ? '#22D3EE' : '#8A95A3', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <StockSheetErrorBoundary>
      {!activeTicker ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: '100%', maxWidth: 880 }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>📋</div>
              <div style={{ fontSize: 17, color: '#E6EDF3', fontWeight: 700, marginBottom: 4 }}>
                Enter a ticker to run the 16-section institutional checklist
              </div>
              <div style={{ fontSize: 12, color: '#6B7A8D', lineHeight: 1.55 }}>
                Live data auto-fills theme / catalyst / sentiment / financial-quality where available.<br/>
                Remaining sections are manual research with evidence notes.
              </div>
            </div>

            {/* PATCH 0114 — IMP-11: Top from Multibagger upload (if any) */}
            {mbTopList.length > 0 && (
              <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#FACC15', fontWeight: 800, letterSpacing: '0.6px' }}>⭐ FROM YOUR MULTIBAGGER UPLOAD</div>
                    <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2 }}>Top {mbTopList.length} by composite score</div>
                  </div>
                  <button onClick={() => { setTickerInput(mbTopList[0].symbol); setActiveTicker(mbTopList[0].symbol); }}
                    style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #FACC1560', backgroundColor: '#FACC1520', color: '#FACC15', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                    RUN #1
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                  {mbTopList.map((p) => (
                    <button key={p.symbol} onClick={() => { setTickerInput(p.symbol); setActiveTicker(p.symbol); }}
                      style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid #1A2840', backgroundColor: '#0A1422', color: '#E6EDF3', cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#FACC15' }}>{p.symbol}</div>
                      <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2 }}>
                        {p.score ? `score ${p.score.toFixed(1)}` : ''}{p.opmExpansion ? ` · Δ OPM ${p.opmExpansion.toFixed(1)}pp` : ''}{p.epsGrowth ? ` · EPS ${p.epsGrowth.toFixed(0)}%` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* PATCH 0114 — IMP-11: Recently viewed */}
            {recentList.length > 0 && (
              <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: '#22D3EE', fontWeight: 800, letterSpacing: '0.6px', marginBottom: 8 }}>🕒 RECENTLY VIEWED</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {recentList.map((t) => (
                    <button key={t} onClick={() => { setTickerInput(t); setActiveTicker(t); }}
                      style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #22D3EE40', backgroundColor: '#22D3EE15', color: '#22D3EE', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* PATCH 0114 — IMP-11: Saved sheets shortcut (when blank) */}
            {savedList.length > 0 && (
              <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: '#10B981', fontWeight: 800, letterSpacing: '0.6px', marginBottom: 8 }}>💾 SAVED SHEETS</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {savedList.map((t) => (
                    <button key={t} onClick={() => { setTickerInput(t); setActiveTicker(t); }}
                      style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #10B98140', backgroundColor: '#10B98115', color: '#10B981', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* PATCH 0114 — IMP-11: Examples (always shown) */}
            <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 12, color: '#8A95A3', fontWeight: 800, letterSpacing: '0.6px', marginBottom: 8 }}>🚀 START WITH AN EXAMPLE</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {EXAMPLE_TICKERS.map((e) => (
                  <button key={e.sym} onClick={() => { setTickerInput(e.sym); setActiveTicker(e.sym); }}
                    style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid #1A2840', backgroundColor: '#0A1422', color: '#E6EDF3', cursor: 'pointer' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{e.sym}</div>
                    <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2 }}>{e.label}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Scorecard */}
          <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `4px solid ${VERDICT_COLOR[score.verdict]}`, borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: '#F5F7FA', letterSpacing: '0.5px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {activeTicker}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, backgroundColor: region === 'IN' ? '#FBBF2420' : '#22D3EE20', color: region === 'IN' ? '#FBBF24' : '#22D3EE', border: `1px solid ${region === 'IN' ? '#FBBF2440' : '#22D3EE40'}` }}>
                {region === 'IN' ? '🇮🇳 India' : '🌐 Global'}
              </span>
              {(() => {
                const px = safeScalar((quote as any)?.price);
                const ch = safeScalar((quote as any)?.change_pct);
                if (px == null) return null;
                return (
                  <span style={{ fontSize: 13, color: '#94A3B8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {px.toLocaleString()}
                    {ch != null && (
                      <span style={{ marginLeft: 8, color: ch >= 0 ? '#10B981' : '#EF4444' }}>
                        {ch >= 0 ? '+' : ''}{ch.toFixed(2)}%
                      </span>
                    )}
                  </span>
                );
              })()}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24, fontWeight: 900, color: VERDICT_COLOR[score.verdict], letterSpacing: '0.8px' }}>
                  {score.verdict}
                </span>
                <span style={{ fontSize: 13, color: '#94A3B8' }}>
                  {score.alignment_pct}% aligned · {score.yes} ✓ / {score.no} ✗ / {score.na} N/A · {score.unanswered} unanswered
                </span>
              </span>
            </div>
            {/* Alignment bar */}
            <div style={{ marginTop: 10, height: 6, backgroundColor: '#1A2840', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${score.alignment_pct}%`, height: '100%', backgroundColor: VERDICT_COLOR[score.verdict], transition: 'width 0.3s' }} />
            </div>
            {score.disqualifiers.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 6, backgroundColor: '#EF444415', border: '1px solid #EF444440', color: '#FCA5A5', fontSize: 12 }}>
                <strong style={{ color: '#EF4444' }}>Disqualifiers:</strong> {safeText(score.disqualifiers.map((d) => safeText(d)).join(' · '))}
              </div>
            )}
          </div>

          {/* PATCH 0455 — Surface uploaded Company Intelligence guidance.
              If the user has pasted concall transcripts for this ticker via
              /company-intel, all extracted guidance items render here. */}
          {activeTicker && <CompanyIntelGuidance ticker={activeTicker} compact={false} />}

          {/* Sections */}
          {SECTIONS.map((sec) => {
            const sectionAns = sec.criteria.map((c) => state[c.id]?.signal).filter(Boolean) as Signal[];
            const sectionYes = sectionAns.filter((s) => s === 'YES').length;
            const sectionNo = sectionAns.filter((s) => s === 'NO').length;
            const isOpen = openSections[sec.id] ?? false;
            return (
              <div key={sec.id} style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${sec.color}`, borderRadius: 12 }}>
                <button
                  onClick={() => setOpenSections((s) => ({ ...s, [sec.id]: !s[sec.id] }))}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
                >
                  {isOpen ? <ChevronDown style={{ width: 16, height: 16, color: '#6B7A8D' }} /> : <ChevronRight style={{ width: 16, height: 16, color: '#6B7A8D' }} />}
                  <span style={{ fontSize: 14, fontWeight: 800, color: sec.color, letterSpacing: '0.4px' }}>
                    {sec.emoji} {sec.id}. {sec.title.toUpperCase()}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7A8D' }}>
                    {sectionYes} ✓ · {sectionNo} ✗ · {sec.criteria.length - sectionAns.length} ·
                  </span>
                </button>
                {isOpen && (
                  <div style={{ padding: '0 18px 14px 18px' }}>
                    <div style={{ fontSize: 11, color: '#6B7A8D', fontStyle: 'italic', marginBottom: 12, lineHeight: 1.5 }}>
                      {sec.rationale}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {sec.criteria.map((c) => {
                        const ans = state[c.id];
                        const isAuto = ans?.evidence?.startsWith('[auto]');
                        return (
                          <div key={c.id} style={{ padding: '8px 10px', backgroundColor: '#0A1422', borderRadius: 6, border: '1px solid #1A2840' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                              <span style={{ flex: 1, fontSize: 13, color: '#E6EDF3', lineHeight: 1.5, minWidth: 240 }}>
                                {c.label}
                                {c.weight === 3 && <span style={{ color: '#FBBF24', fontSize: 10, marginLeft: 6 }}>★ heavy</span>}
                                {c.disqualifying && <span style={{ color: '#EF4444', fontSize: 10, marginLeft: 6 }}>⚠ disqualifying</span>}
                                {c.polarity === 'NEGATIVE' && <span style={{ color: '#94A3B8', fontSize: 10, marginLeft: 6 }}>(YES = bad)</span>}
                                {isAuto && <span style={{ color: '#22D3EE', fontSize: 10, marginLeft: 6 }}>auto-filled</span>}
                              </span>
                              <div style={{ display: 'inline-flex', gap: 4 }}>
                                {(['YES','NO','N/A'] as const).map((sig) => {
                                  const isPicked = ans?.signal === sig;
                                  const colorBy: Record<Signal, string> = {
                                    'YES': c.polarity === 'NEGATIVE' ? '#EF4444' : '#10B981',
                                    'NO':  c.polarity === 'NEGATIVE' ? '#10B981' : '#EF4444',
                                    'N/A': '#6B7A8D',
                                  };
                                  return (
                                    <button
                                      key={sig}
                                      onClick={() => handleAnswer(c.id, isPicked ? null : sig)}
                                      style={{
                                        padding: '3px 10px', borderRadius: 4,
                                        border: isPicked ? `1px solid ${colorBy[sig]}80` : '1px solid #2A3B4C',
                                        backgroundColor: isPicked ? `${colorBy[sig]}25` : 'transparent',
                                        color: isPicked ? colorBy[sig] : '#6B7A8D',
                                        fontSize: 11, fontWeight: 800, letterSpacing: '0.4px', cursor: 'pointer',
                                      }}
                                    >
                                      {sig}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <input
                              value={typeof ans?.evidence === 'string' ? ans.evidence : ''}
                              onChange={(e) => handleEvidence(c.id, e.target.value)}
                              placeholder="Evidence / source / 1-line note…"
                              style={{ marginTop: 6, width: '100%', padding: '5px 8px', backgroundColor: '#0D1623', border: '1px solid #1A2840', borderRadius: 4, color: '#94A3B8', fontSize: 11, outline: 'none' }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* ─── PATCH 0118 — IMP-12: Section 17 Decision Memo ─────── */}
          <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #22D3EE', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px' }}>
                🧾 17. DECISION MEMO
              </span>
              <span style={{ fontSize: 11, color: '#6B7A8D' }}>auto-generated · regenerates on every change</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94A3B8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {safeText(memo.alignmentLabel)}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: '10px 12px', backgroundColor: '#0A1422', borderRadius: 6, border: '1px solid #1A2840' }}>
                <div style={{ fontSize: 10, color: '#10B981', fontWeight: 800, letterSpacing: '0.6px', marginBottom: 4 }}>① THESIS</div>
                <div style={{ fontSize: 12, color: '#E6EDF3', lineHeight: 1.65 }}>{safeText(memo.thesis)}</div>
              </div>
              <div style={{ padding: '10px 12px', backgroundColor: '#0A1422', borderRadius: 6, border: '1px solid #1A2840' }}>
                <div style={{ fontSize: 10, color: '#EF4444', fontWeight: 800, letterSpacing: '0.6px', marginBottom: 4 }}>② KEY RISKS</div>
                <div style={{ fontSize: 12, color: '#E6EDF3', lineHeight: 1.65 }}>{safeText(memo.risks)}</div>
              </div>
              <div style={{ padding: '10px 12px', backgroundColor: '#0A1422', borderRadius: 6, border: '1px solid #1A2840' }}>
                <div style={{ fontSize: 10, color: '#FACC15', fontWeight: 800, letterSpacing: '0.6px', marginBottom: 4 }}>③ CATALYST PATH</div>
                <div style={{ fontSize: 12, color: '#E6EDF3', lineHeight: 1.65 }}>{safeText(memo.catalystPath)}</div>
              </div>
              <button
                onClick={() => {
                  const txt = `# ${activeTicker} — Decision Memo\n\n**${memo.alignmentLabel}**\n\n## Thesis\n${memo.thesis}\n\n## Key Risks\n${memo.risks}\n\n## Catalyst Path\n${memo.catalystPath}\n`;
                  try { navigator.clipboard.writeText(txt); } catch {}
                }}
                style={{ alignSelf: 'flex-start', padding: '5px 12px', borderRadius: 4, border: '1px solid #1A2840', backgroundColor: 'transparent', color: '#8A95A3', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                Copy memo as Markdown
              </button>
            </div>
          </div>
        </div>
      )}
      </StockSheetErrorBoundary>
    </div>
    </StockSheetErrorBoundary>
  );
}
