'use client';

// ═══════════════════════════════════════════════════════════════════════════
// RE-RATING SCREENER — patch 0094
//
// Closes the "G — Re-rating / Multiple Expansion" gap.  Three sub-tabs:
//
//   📊 MARGIN EXPANSION  — OPM expanded over last 4 quarters + ROCE rising.
//                          Operating leverage flowing to EBITDA, ahead of
//                          revenue volume peak.  Earnings-scan driven.
//
//   🔁 MODEL SHIFT       — text-mine 90/180-day news for SaaS / recurring /
//                          subscription / platform / ARR mention frequency
//                          jumps QoQ.  Captures the qualitative model
//                          transition before the multiple re-rates.
//
//   🚀 MULTIPLE EXPAND   — P/E vs EPS-growth ranker (PEG-style).  Lowest PEG
//                          with confirming earnings inflection = candidates
//                          for forward-PE re-rating.
//
// Universe: defaults to portfolio + watchlist.  User can paste custom symbol
// list.  Region filter: ALL / 🇮🇳 IN / 🌐 GLOBAL.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from 'react';
// PATCH 0277 — Conviction Beats overlay on Re-rating Screener.
import { getConvictionTickers } from '@/lib/conviction-beats';

// PATCH 0277 — Shared inline CB badge so all 3 sub-panels render the same chip.
function CbBadge({ ticker, convictionSet }: { ticker: string; convictionSet: Set<string> }) {
  const sym = (ticker || '').toUpperCase().replace(/\.NS$|\.BO$/i, '');
  if (!convictionSet.has(sym)) return null;
  return (
    <span
      title="On Conviction Beats bench (BLOCKBUSTER/STRONG earnings)"
      style={{
        marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#F59E0B',
        border: '1px solid #F59E0B60', backgroundColor: 'rgba(245,158,11,0.10)',
        padding: '1px 5px', borderRadius: 3, letterSpacing: 0.3,
      }}
    >🏆 CB</span>
  );
}
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { TrendingUp, RefreshCw, Rocket } from 'lucide-react';
import api from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────────

type Tab = 'margin' | 'model' | 'multiple';

interface Quote {
  symbol: string;
  price?: number;
  change_pct?: number;
  pe_ratio?: number;
  eps?: number;
  market_cap?: number;
}

interface EarningsRow {
  symbol: string;
  quarters?: Array<{
    period?: string;
    revenue?: number;
    operating_profit?: number;
    operating_margin?: number;
    pat?: number;
    eps?: number;
    revenue_yoy?: number;
    eps_yoy?: number;
  }>;
}

interface Article {
  id: string;
  headline?: string;
  title?: string;
  summary?: string;
  source?: string;
  source_name?: string;
  published_at?: string;
  source_url?: string;
  url?: string;
  tickers?: string[];
  ticker_symbols?: string[];
  region?: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

// PATCH 0108 — BUG-02: universe selector with Multibagger fallback.
// Old behaviour: used portfolio + watchlist (often empty). New: Multibagger
// uploaded list (mb3_symbols localStorage) is the default if non-empty,
// then watchlist/portfolio. User can switch via UI dropdown.

type UniverseChoice = 'AUTO' | 'MULTIBAGGER' | 'PORTFOLIO' | 'WATCHLIST' | 'NSE500' | 'CUSTOM';

// PATCH 0117 — IMP-06: BSE code → NSE ticker normalization.
// Screener exports sometimes carry the BSE security-code form 'BSE:523850'
// for stocks dual-listed on BSE + NSE.  Our entire pipeline (quotes, news,
// API) keys on NSE tickers.  Translate the common dual-listed mid-caps here.
// (Source: BSE-NSE dual-listing map — extend as more codes surface.)
// PATCH 0117/0127 — BSE security code → NSE symbol map.  Expanded with the
// codes the user has surfaced in Multibagger uploads (BSE:514330, etc.).
const BSE_TO_NSE: Record<string, string> = {
  '523850': 'AXTEL',       // AXTEL Industries
  '514330': 'NITTAGELA',   // Nitta Gelatin India
  '500425': 'AMBUJACEM',
  '500087': 'CIPLA',
  '500096': 'DABUR',
  '500114': 'TITAN',
  '500180': 'HDFCBANK',
  '500209': 'INFY',
  '500247': 'KOTAKBANK',
  '500325': 'RELIANCE',
  '500570': 'TATAMOTORS',
  '500875': 'ITC',
  '532174': 'ICICIBANK',
  '532540': 'TCS',
  '532555': 'NTPC',
  '532898': 'POWERGRID',
  '532978': 'BAJAJFINSV',
  '533278': 'COALINDIA',
  '500302': 'PIIND',
  '532809': 'IDEAFORGE',
  '543272': 'MTARTECH',
  '500031': 'BAJAJELEC',   // Bajaj Electricals
  '500049': 'BEL',         // Bharat Electronics
  '500103': 'BHEL',
  '500300': 'GRASIM',
  '500390': 'RELINFRA',
  '500470': 'TATASTEEL',
  '500510': 'LT',          // Larsen & Toubro
  '500520': 'M&M',         // Mahindra & Mahindra
  '500770': 'TATACHEM',
  '500790': 'NESTLEIND',
  '500800': 'TATACONSUM',
  '500820': 'ASIANPAINT',
  '500830': 'COLPAL',
  '500850': 'INDHOTEL',
  '532129': 'IDFC',
  '532215': 'AXISBANK',
  '532321': 'CADILAHC',    // Zydus (Cadila)
  '532424': 'GODREJCP',
  '532500': 'MARUTI',
  '532644': 'DIVISLAB',
  '532648': 'YESBANK',
  '532720': 'EMAMILTD',
  '532868': 'DLF',
  '532921': 'ADANIPORTS',
  '533155': 'JUBLFOOD',
  '533398': 'COROMANDEL',
  '540595': 'AVANTI',      // Avanti Feeds
  '540975': 'HAL',         // Hindustan Aeronautics
  '541557': 'BHARATFORG',
  '542652': 'CAMS',
  '542801': 'METROPOLIS',
  '543177': 'BARBEQUE',    // Barbeque Nation
  '543528': 'PARASDEF',
  '543320': 'DATAPATTNS',
  '543425': 'EPACKPEB',    // EPACK Durable / Prefab
  '543719': 'TIPSMUSIC',
};
function normalizeBseTicker(raw: string): string {
  if (!raw) return raw;
  const m = /^BSE\s*:\s*(\d{4,7})$/i.exec(raw.trim());
  if (!m) return raw.toUpperCase();
  const nse = BSE_TO_NSE[m[1]];
  return nse ? `${nse}.NS` : raw.toUpperCase();
}

function readMultibaggerSymbols(): string[] {
  if (typeof window === 'undefined') return [];
  // PATCH 0126 — BUG: '1 stocks' in universe counter when user has 84.
  // Root cause: mb3_symbols was a legacy 1-stock array, the full upload
  // lives in mb_excel_scored_v2.  Union BOTH localStorage keys so the
  // universe always reflects the largest available upload set.
  const out = new Set<string>();
  try {
    const raw = localStorage.getItem('mb3_symbols');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const s of parsed) {
          const sym = typeof s === 'string' ? s : (s?.symbol || s?.ticker || '');
          if (sym) out.add(normalizeBseTicker(String(sym).toUpperCase()));
        }
      }
    }
  } catch {}
  try {
    const raw = localStorage.getItem('mb_excel_scored_v2');
    if (raw) {
      const rows = JSON.parse(raw);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const sym = r?.symbol || r?.ticker;
          if (sym) out.add(normalizeBseTicker(String(sym).toUpperCase()));
        }
      }
    }
  } catch {}
  return Array.from(out);
}

// PATCH 0112: read FULL Multibagger upload data from mb_excel_scored_v2.
// Each row carries opm/opmPrev/opmExpansion/pe/peg/epsGrowth/accelSignal/
// fii/dii/roce/roceExpansion — exactly what Re-rating screeners need.
interface MBStockRow {
  symbol: string;
  company?: string;
  sector?: string;
  // Margin / profitability
  opm?: number;            // current OPM %
  opmPrev?: number;        // OPM last year %
  opmExpansion?: number;   // current - 3yr-ago
  roce?: number;
  roceExpansion?: number;
  // Growth + acceleration
  revCagr?: number;
  profitCagr?: number;
  epsGrowth?: number;
  yoySalesGrowth?: number;
  yoyProfitGrowth?: number;
  revenueAcceleration?: number;
  profitAcceleration?: number;
  accelSignal?: 'ACCELERATING' | 'STABLE' | 'DECELERATING';
  // Valuation
  pe?: number;
  peg?: number;
  marketCapCr?: number;
  // Ownership
  fii?: number;
  dii?: number;
  fiiPlusDii?: number;
  // Score
  score?: number;
  grade?: string;
}

function readMultibaggerStocks(): MBStockRow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('mb_excel_scored_v2');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // PATCH 0117 — IMP-06: normalize each row's symbol from BSE:NNNNNN
    // to NSE.NS form so quotes / earnings-scan / news cross-reference work.
    return parsed.map((r: any) => ({
      ...r,
      symbol: normalizeBseTicker(String(r?.symbol || r?.ticker || '').toUpperCase()),
    }));
  } catch {
    return [];
  }
}

// NSE500 small-cap proxy list — fetched once if user picks that universe
async function fetchNSE500(): Promise<string[]> {
  try {
    const { data } = await api.get('/market/nse500');
    if (Array.isArray(data)) return data.map((s: any) => typeof s === 'string' ? s : s?.symbol).filter(Boolean);
  } catch {}
  return [];
}

function useUniverseSymbols(choice: UniverseChoice, customCsv: string) {
  return useQuery<{ symbols: string[]; source: string; mbStocks: MBStockRow[] }>({
    queryKey: ['rerating', 'universe', choice, customCsv],
    queryFn: async () => {
      const out = new Set<string>();
      // PATCH 0112: also surface the full MB stock data so screeners can read
      // opmPrev / epsGrowth / peg / accelSignal directly from the upload.
      const mbStocks = readMultibaggerStocks();
      for (const s of mbStocks) {
        if (!s.symbol) continue;
        // Normalize BSE:NNNNNN → ticker symbol via lookup if available
        // (kept simple here — Multibagger upload already normalizes)
      }

      const addPortfolio = async () => {
        try {
          const { data } = await api.get('/portfolio');
          const positions = data?.positions || data?.holdings || data || [];
          for (const p of positions) {
            const s = p.symbol || p.ticker || p.ticker_symbol;
            if (s) out.add(String(s).toUpperCase());
          }
        } catch {}
      };
      const addWatchlist = async () => {
        try {
          const { data } = await api.get('/watchlist');
          const items = data?.items || data?.tickers || data || [];
          for (const w of items) {
            const s = typeof w === 'string' ? w : (w.symbol || w.ticker || w.ticker_symbol);
            if (s) out.add(String(s).toUpperCase());
          }
        } catch {}
      };
      const addMultibagger = () => {
        for (const s of readMultibaggerSymbols()) out.add(s);
      };

      let source = 'auto';
      // PATCH 0112: format source label with PROPER stock count
      // (not '(1)' which means 1 upload batch — confusing)
      if (choice === 'MULTIBAGGER') {
        addMultibagger();
        source = `Multibagger Upload · ${out.size} ${out.size === 1 ? 'stock' : 'stocks'}`;
      } else if (choice === 'PORTFOLIO') {
        await addPortfolio();
        source = `My Portfolio · ${out.size} ${out.size === 1 ? 'stock' : 'stocks'}`;
      } else if (choice === 'WATCHLIST') {
        await addWatchlist();
        source = `My Watchlist · ${out.size} ${out.size === 1 ? 'stock' : 'stocks'}`;
      } else if (choice === 'NSE500') {
        const list = await fetchNSE500();
        for (const s of list) out.add(s);
        source = `NSE 500 · ${out.size} ${out.size === 1 ? 'stock' : 'stocks'}`;
      } else if (choice === 'CUSTOM') {
        for (const t of customCsv.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)) out.add(t);
        source = `Custom · ${out.size} ${out.size === 1 ? 'stock' : 'stocks'}`;
      } else {
        // AUTO: prefer Multibagger upload; if empty, fall back to portfolio + watchlist union
        addMultibagger();
        if (out.size === 0) {
          await addPortfolio();
          await addWatchlist();
          const n0: number = out.size;
          source = `Portfolio + Watchlist · ${n0} ${n0 === 1 ? 'stock' : 'stocks'}`;
        } else {
          const n0 = out.size;
          source = `Multibagger Upload · ${n0} ${n0 === 1 ? 'stock' : 'stocks'}`;
        }
      }
      return { symbols: Array.from(out), source, mbStocks };
    },
    staleTime: 5 * 60_000,
  });
}

function useEarningsScan(symbols: string[]) {
  return useQuery<EarningsRow[]>({
    queryKey: ['rerating', 'earnings-scan', symbols.slice(0, 50).join(',')],
    queryFn: async () => {
      if (!symbols.length) return [];
      // PATCH 0435 BUG-005 — Hard 30s timeout so 'Loading earnings-scan…'
      // doesn't sit forever. Returns [] on timeout; the rerating page will
      // show "no data" instead of infinite spinner.
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 30000);
      try {
        const { data } = await api.get('/market/earnings-scan', {
          params: { symbols: symbols.slice(0, 50).join(',') },
          signal: controller.signal,
        });
        return Array.isArray(data) ? data : (data?.rows || data?.results || []);
      } catch {
        return [];
      } finally {
        clearTimeout(t);
      }
    },
    enabled: symbols.length > 0,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}

function useQuotes(symbols: string[]) {
  return useQuery<Record<string, Quote>>({
    queryKey: ['rerating', 'quotes', symbols.slice(0, 50).join(',')],
    queryFn: async () => {
      if (!symbols.length) return {};
      try {
        const { data } = await api.post('/market/quotes', { symbols: symbols.slice(0, 50) });
        const out: Record<string, Quote> = {};
        if (Array.isArray(data)) {
          for (const q of data) out[String(q.symbol).toUpperCase()] = q;
        } else if (data && typeof data === 'object') {
          for (const k of Object.keys(data)) out[k.toUpperCase()] = data[k];
        }
        return out;
      } catch {
        return {};
      }
    },
    enabled: symbols.length > 0,
    staleTime: 60_000,
  });
}

function useNewsFeed() {
  return useQuery<{ articles: Article[] }>({
    queryKey: ['rerating', 'news-feed'],
    queryFn: async () => {
      // PATCH 0095: default /news returns ARRAY (not { articles }).  Normalize
      // and filter to last 180 days client-side (the endpoint ignores `days`
      // on the default branch).
      const { data } = await api.get('/news');
      const arr: any[] = Array.isArray(data) ? data : (data?.articles || data?.items || []);
      const cutoff = Date.now() - 180 * 86400000;
      const filtered = arr.filter((a: any) => {
        if (!a?.published_at) return true;
        const t = new Date(a.published_at).getTime();
        return isNaN(t) || t >= cutoff;
      });
      return { articles: filtered };
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

// ─── Computations ───────────────────────────────────────────────────────────

interface MarginRow {
  ticker: string;
  delta_opm_bps: number;     // latest OPM minus oldest OPM (in basis points)
  latest_opm: number | null;
  oldest_opm: number | null;
  latest_rev_yoy: number | null;
  quarters: number;
}

function computeMarginExpansion(rows: EarningsRow[]): MarginRow[] {
  const out: MarginRow[] = [];
  for (const r of rows) {
    const q = r.quarters || [];
    if (q.length < 2) continue;
    // Use last 4 quarters; latest first or last depending on backend ordering
    const slice = q.slice(-4);
    const oldest = slice[0];
    const latest = slice[slice.length - 1];
    const oldOpm = oldest?.operating_margin;
    const newOpm = latest?.operating_margin;
    if (oldOpm == null || newOpm == null) continue;
    out.push({
      ticker: r.symbol.toUpperCase(),
      delta_opm_bps: Math.round((newOpm - oldOpm) * 100),  // assume input is %
      latest_opm: newOpm,
      oldest_opm: oldOpm,
      latest_rev_yoy: latest?.revenue_yoy ?? null,
      quarters: slice.length,
    });
  }
  return out.sort((a, b) => b.delta_opm_bps - a.delta_opm_bps);
}

// PATCH 0121 — 0101: size-conditional revenue-growth gate.
// User: 'ignore companies with less than 10% revenue growth if it's only large cap'.
// For LARGE_CAP (>₹20,000Cr) we require rev YoY ≥ 10% — at that size only
// genuine top-line growth justifies the bigger-base entry.  Mid/small caps
// pass this gate (their thesis is differently structured — they qualify via
// margin expansion or acceleration even at lower absolute growth).
const LARGE_CAP_THRESHOLD_CR = 20_000;
const LARGE_CAP_MIN_REV_GROWTH = 10;
function passesSizeConditionalGrowth(s: MBStockRow): boolean {
  const mcap = s.marketCapCr ?? 0;
  if (mcap < LARGE_CAP_THRESHOLD_CR) return true;            // small/mid cap — bypass
  const revG = s.yoySalesGrowth ?? s.revCagr ?? null;
  if (revG == null) return true;                              // unknown growth — don't punish data gap
  return revG >= LARGE_CAP_MIN_REV_GROWTH;
}

// PATCH 0112: Margin Expansion from Multibagger upload CSV — primary source
// for Indian small/midcaps where live earnings-scan has no data.
// User: '25 stocks uploaded with opm/opmPrev/accelSignal — must use these.'
function computeMarginExpansionFromMB(mbStocks: MBStockRow[]): MarginRow[] {
  const out: MarginRow[] = [];
  for (const s of mbStocks) {
    if (!s.symbol) continue;
    // PATCH 0121 — drop large caps that aren't growing
    if (!passesSizeConditionalGrowth(s)) continue;
    const opmCurr = s.opm;
    const opmPrev = s.opmPrev;
    const opmExpansion = s.opmExpansion;
    const accel = s.accelSignal;
    const profitAccel = s.profitAcceleration ?? 0;

    // Qualify if ANY of these hold:
    //   - opm > opmPrev (YoY margin expansion)
    //   - opmExpansion > 0 (3yr cumulative expansion)
    //   - accelSignal === ACCELERATING
    //   - profitAcceleration > 0
    const opmYoyExpand = opmCurr != null && opmPrev != null && opmCurr > opmPrev;
    const expansionPositive = opmExpansion != null && opmExpansion > 0;
    const accelerating = accel === 'ACCELERATING';
    if (!opmYoyExpand && !expansionPositive && !accelerating && profitAccel <= 0) continue;

    // delta = prefer YoY if available, else 3yr expansion, else profit accel proxy
    let deltaBps = 0;
    if (opmYoyExpand) deltaBps = Math.round((opmCurr! - opmPrev!) * 100);
    else if (expansionPositive) deltaBps = Math.round(opmExpansion! * 100);
    else if (profitAccel > 0) deltaBps = Math.round(profitAccel * 100);
    else if (accelerating) deltaBps = 50;  // sentinel for accelSignal-only matches

    // PATCH 0126 — BUG#2 fix: derive oldest_opm from any available baseline.
    // Many MB CSV rows have opmExpansion but not opmPrev → was rendering '—'.
    // Priority: opmPrev (1yr) > opm - opmExpansion (3yr derived) > null.
    const oldestOpm: number | null =
      opmPrev != null ? opmPrev :
      (opmCurr != null && opmExpansion != null) ? +(opmCurr - opmExpansion).toFixed(2) :
      null;
    const quartersCount: number =
      opmPrev != null ? 4 :
      opmExpansion != null ? 12 :
      profitAccel > 0 ? 4 :
      accelerating ? 4 : 0;
    out.push({
      ticker: s.symbol.toUpperCase(),
      delta_opm_bps: deltaBps,
      latest_opm: opmCurr ?? null,
      oldest_opm: oldestOpm,
      latest_rev_yoy: s.yoySalesGrowth ?? null,
      quarters: quartersCount,
    });
  }
  return out.sort((a, b) => b.delta_opm_bps - a.delta_opm_bps);
}

function computeMultipleExpansionFromMB(mbStocks: MBStockRow[]): MultipleExpandRow[] {
  const out: MultipleExpandRow[] = [];
  for (const s of mbStocks) {
    if (!s.symbol) continue;
    // PATCH 0121 — drop large caps with <10% rev growth from Multiple Expansion too
    if (!passesSizeConditionalGrowth(s)) continue;
    const pe = s.pe;
    const peg = s.peg;
    const epsGrowth = s.epsGrowth ?? s.yoyProfitGrowth ?? s.profitCagr ?? 0;
    if (!(pe != null && pe > 0 && pe < 200)) continue;
    if (!(epsGrowth > 0)) continue;
    const computedPeg = peg ?? (pe / Math.max(1, epsGrowth));
    if (computedPeg > 5) continue;  // too expensive
    // PATCH 0126 — exclude negative PEG (shrinking earnings ≠ re-rating
    // candidate).  User QA: 'PEG −308 / −12.86 / −9.06 are NOT re-rating
    // candidates — they are loss-making or shrinking-EPS distressed stocks'.
    // Also exclude PEG below 0.1 — a genuine re-rating setup has PEG > 0.1.
    if (computedPeg < 0.1) continue;
    out.push({
      ticker: s.symbol.toUpperCase(),
      pe,
      eps_yoy: epsGrowth,
      peg: computedPeg,
      latest_opm: s.opm ?? null,
    });
  }
  return out.sort((a, b) => (a.peg ?? 999) - (b.peg ?? 999));
}

interface ModelShiftRow {
  ticker: string;
  recent_count: number;        // mentions in last 90d
  prior_count: number;         // mentions in 90-180d ago
  jump_pct: number;            // (recent - prior) / max(prior, 1) * 100
  most_recent_headline?: string;
  most_recent_age_days?: number;
}

// PATCH 0108 — BUG-02 fix C: expanded for Indian business-model shifts.
// Old US-centric SaaS regex missed 90% of Indian model-shift signals.
// Indian context uses: order book / AMC / annuity / channel partner /
// long-term contract / maintenance / managed services / subscription /
// recurring / platform / SaaS.
const MODEL_SHIFT_PATTERN = /\b(saas|software.as.a.service|subscription (?:model|revenue|business)|recurring revenue|annualized recurring revenue|arr\b|platform (?:model|play|business|revenue)|recurring|net revenue retention|nrr|expansion revenue|land.and.expand|usage based pricing|metered|annuity (?:revenue|business|model)|retainer|long.?term contract|order ?book|amc\b|maintenance contract|maintenance services|managed services|channel partner|after.?market services|services revenue|service revenue|aftermarket|asset.?light|licensing model|royalty model|capex.?to.?opex|gross margin expansion|operating leverage|run.?rate revenue)\b/i;

// PATCH 0112 — BUG-NEW-03: tickers that are CONTRACT TYPES not companies.
// User: "EPC in a solar order article ≠ a company called EPC".
const MODEL_SHIFT_TICKER_BLACKLIST = new Set([
  'EPC','IPO','MW','GW','KW','MWH','GWH','SPV','PPA','BESS','HBM','AMC','AGM',
  'CSR','ESG','DAE','NTPC','NHPC','POWERGRID','COALINDIA','RELIANCE','TCS','INFY','WIPRO','HCLTECH',
  // PSU utilities that are NOT changing business model — they always were
  // public utilities, so a 'platform' or 'recurring' mention in their context
  // is keyword leak, not a real model shift.
]);
// Require strong evidence — the model-shift keyword must appear WITH a
// model-shift VERB in the same sentence ("transitioning to / launches /
// pivots to / shifts to / introduces / building").
// PATCH 0126 — BUG#3: expanded for Indian business-model shifts.
// Old pattern only matched SaaS-centric verbs; QA flagged this as the reason
// Model Shift was empty for Indian universe.  Added India-relevant transitions:
// EPC → product, trading → manufacturing, domestic → export, project → annuity,
// B2B → B2C, contract manufacturing → own brand, asset-heavy → asset-light,
// capex → maintenance, services → product, distributor → direct.
const MODEL_SHIFT_VERB_NEARBY = /\b(transition\w*\s+to|pivots?\s+to|shifts?\s+to|launch(?:es|ed|ing)?\s+\w*\s*(?:subscription|recurring|platform|saas)|moves?\s+to\s+(?:subscription|recurring|platform|saas|annuity)|building\s+(?:its|a|an)\s+\w*\s*(?:subscription|recurring|platform|saas)|introduces?\s+(?:subscription|recurring|platform|saas)|business\s+model\s+(?:change|shift|transition)|recurring\s+revenue\s+grows|arr\s+(?:reaches|crosses|exceeds)|epc\s+to\s+product|services?\s+to\s+product|trading\s+to\s+manufactur|domestic\s+to\s+export|project[- ]based?\s+to\s+annuity|b2b\s+to\s+b2c|contract\s+manufactur\w+\s+to\s+(?:own\s+brand|branded)|asset[- ]heavy\s+to\s+asset[- ]light|capex\s+to\s+maintenance|channel\s+to\s+direct|distributor\s+to\s+direct|wholesale\s+to\s+retail|licensee\s+to\s+manufactur|moving\s+up\s+the\s+value\s+chain|forward\s+integrat\w+|backward\s+integrat\w+|launches?\s+own\s+brand|enter(?:s|ing|ed)?\s+(?:exports?|us|europe)\s+market|annuity\s+(?:stream|revenue|business)\s+(?:grows|builds|emerges|crosses))/i;

function computeModelShift(articles: Article[]): ModelShiftRow[] {
  const now = Date.now();
  const map = new Map<string, { recent: number; prior: number; latest_headline?: string; latest_age?: number }>();
  for (const a of articles) {
    const text = `${a.headline || a.title || ''} ${a.summary || ''}`;
    if (!MODEL_SHIFT_PATTERN.test(text)) continue;
    // PATCH 0112: require model-shift VERB near the keyword (kills 'EPC contract'
    // false positives on PSU utility orders).
    if (!MODEL_SHIFT_VERB_NEARBY.test(text)) continue;
    const date = a.published_at ? new Date(a.published_at).getTime() : now;
    const ageDays = Math.round((now - date) / 86400000);
    const tickers = (a.ticker_symbols || a.tickers || []).map((t) => String(t).toUpperCase());
    for (const t of tickers) {
      // PATCH 0112: drop pseudo-tickers + PSU utility false positives
      if (MODEL_SHIFT_TICKER_BLACKLIST.has(t)) continue;
      const cur = map.get(t) || { recent: 0, prior: 0 };
      if (ageDays <= 90) {
        cur.recent += 1;
        if (cur.latest_age == null || ageDays < cur.latest_age) {
          cur.latest_age = ageDays;
          cur.latest_headline = a.headline || a.title;
        }
      } else {
        cur.prior += 1;
      }
      map.set(t, cur);
    }
  }
  const out: ModelShiftRow[] = [];
  for (const [ticker, v] of map.entries()) {
    if (v.recent === 0) continue;
    const jump = ((v.recent - v.prior) / Math.max(v.prior, 1)) * 100;
    out.push({
      ticker,
      recent_count: v.recent,
      prior_count: v.prior,
      jump_pct: Math.round(jump),
      most_recent_headline: v.latest_headline,
      most_recent_age_days: v.latest_age,
    });
  }
  return out.sort((a, b) => {
    if (b.recent_count !== a.recent_count) return b.recent_count - a.recent_count;
    return b.jump_pct - a.jump_pct;
  });
}

interface MultipleExpandRow {
  ticker: string;
  pe: number | null;
  eps_yoy: number | null;
  peg: number | null;            // pe / eps_yoy
  latest_opm: number | null;
}

function computeMultipleExpansion(quotes: Record<string, Quote>, earnings: EarningsRow[]): MultipleExpandRow[] {
  const out: MultipleExpandRow[] = [];
  for (const e of earnings) {
    const T = e.symbol.toUpperCase();
    const q = quotes[T];
    const last = e.quarters?.slice(-1)[0];
    const pe = q?.pe_ratio ?? null;
    const epsYoy = last?.eps_yoy ?? null;
    const peg = pe != null && epsYoy != null && epsYoy > 0 ? pe / epsYoy : null;
    out.push({
      ticker: T,
      pe,
      eps_yoy: epsYoy,
      peg,
      latest_opm: last?.operating_margin ?? null,
    });
  }
  // Rank by PEG ascending (lowest = cheapest vs growth), with positive eps_yoy required
  return out
    .filter((r) => r.peg != null && r.eps_yoy != null && r.eps_yoy > 0)
    .sort((a, b) => (a.peg as number) - (b.peg as number));
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

function regionOf(ticker: string): 'IN' | 'GLOBAL' {
  const T = ticker.toUpperCase();
  return T.endsWith('.NS') || T.endsWith('.BO') ? 'IN' : 'GLOBAL';
}

const TABS: ReadonlyArray<{ id: Tab; label: string; Icon: typeof TrendingUp; color: string; tagline: string }> = [
  { id: 'margin',   label: 'Margin Expansion',  Icon: TrendingUp, color: '#10B981', tagline: 'OPM expanding over 4Q · operating leverage flowing to EBITDA ahead of revenue peak' },
  { id: 'model',    label: 'Model Shift',       Icon: RefreshCw,  color: '#A78BFA', tagline: 'SaaS / recurring / platform mention frequency jumping QoQ in news + filings' },
  { id: 'multiple', label: 'Multiple Expansion',Icon: Rocket,     color: '#FBBF24', tagline: 'Lowest PEG with confirming EPS inflection — candidates for forward-PE re-rating' },
];

// ─── Page ───────────────────────────────────────────────────────────────────

export default function RerratingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initial = (searchParams?.get('tab') as Tab) || 'margin';
  const [active, setActive] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : 'margin');
  const [region, setRegion] = useState<'ALL' | 'IN' | 'GLOBAL'>('ALL');
  // PATCH 0108 — BUG-02: universe selector
  const [universeChoice, setUniverseChoice] = useState<UniverseChoice>('AUTO');
  const [customCsv, setCustomCsv] = useState('');

  // PATCH 0277 — Conviction Beats set + cross-tab sync.
  const [convictionSet, setConvictionSet] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase())); }
    catch { return new Set(); }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      try { setConvictionSet(new Set(Array.from(getConvictionTickers()).map((t: string) => t.toUpperCase()))); }
      catch {}
    };
    window.addEventListener('storage', refresh);
    window.addEventListener('conviction-beats:updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('conviction-beats:updated', refresh);
    };
  }, []);

  // Sync active tab to URL
  useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (sp.get('tab') !== active) {
      sp.set('tab', active);
      router.replace(`/rerating?${sp.toString()}`, { scroll: false });
    }
  }, [active, searchParams, router]);

  const { data: universeData = { symbols: [], source: 'loading', mbStocks: [] as MBStockRow[] } } = useUniverseSymbols(universeChoice, customCsv);
  const universe = universeData.symbols;
  const universeSource = universeData.source;
  const mbStocks = universeData.mbStocks;
  const { data: earnings = [], isLoading: loadingE } = useEarningsScan(universe);
  const { data: quotes = {}, isLoading: loadingQ } = useQuotes(universe);
  const { data: feed, isLoading: loadingN } = useNewsFeed();

  // PATCH 0112: PRIMARY = read from Multibagger upload CSV data
  // (which already has opm/opmPrev/pe/peg/epsGrowth/accelSignal computed
  // from Screener.in export). Live earnings-scan is SECONDARY enrichment
  // only — small/mid caps usually don't have live data so user saw 0 candidates.
  const marginRowsMB = useMemo(() => computeMarginExpansionFromMB(mbStocks), [mbStocks]);
  const marginRowsAPI = useMemo(() => computeMarginExpansion(earnings), [earnings]);
  const marginRows = useMemo(() => {
    // Merge — MB rows take priority; API rows fill in for unseen tickers
    const seen = new Set(marginRowsMB.map((r) => r.ticker));
    const merged = [...marginRowsMB];
    for (const r of marginRowsAPI) if (!seen.has(r.ticker)) merged.push(r);
    return merged.sort((a, b) => b.delta_opm_bps - a.delta_opm_bps);
  }, [marginRowsMB, marginRowsAPI]);

  const multipleRowsMB = useMemo(() => computeMultipleExpansionFromMB(mbStocks), [mbStocks]);
  const multipleRowsAPI = useMemo(() => computeMultipleExpansion(quotes, earnings), [quotes, earnings]);
  const multipleRows = useMemo(() => {
    const seen = new Set(multipleRowsMB.map((r) => r.ticker));
    const merged = [...multipleRowsMB];
    for (const r of multipleRowsAPI) if (!seen.has(r.ticker)) merged.push(r);
    return merged.sort((a, b) => (a.peg ?? 999) - (b.peg ?? 999));
  }, [multipleRowsMB, multipleRowsAPI]);

  const modelRows = useMemo(() => computeModelShift(feed?.articles || []), [feed]);

  const filterByRegion = <T extends { ticker: string }>(rows: T[]): T[] => {
    if (region === 'ALL') return rows;
    return rows.filter((r) => regionOf(r.ticker) === region);
  };

  const activeMeta = TABS.find((t) => t.id === active) || TABS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0A0E1A' }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: '#0D1B2E', borderBottom: '1px solid #1E2D45', borderLeft: `4px solid ${activeMeta.color}`, padding: '14px 18px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: activeMeta.color, letterSpacing: '0.6px' }}>
            ⚖️ RE-RATING SCREENER
          </span>
          <span style={{ fontSize: 12, color: '#4A5B6C' }}>Margin Expansion · Model Shift · Multiple Expansion</span>
          <span style={{ fontSize: 11, color: '#6B7A8D' }}>Universe: {universeSource}</span>
          {/* PATCH 0108 — BUG-02: universe selector */}
          <select
            value={universeChoice}
            onChange={(e) => setUniverseChoice(e.target.value as UniverseChoice)}
            style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, borderRadius: 4, border: '1px solid #1A2840', backgroundColor: '#0A1422', color: '#E6EDF3', cursor: 'pointer' }}
          >
            <option value="AUTO">Auto (MB → Portfolio + Watchlist)</option>
            <option value="MULTIBAGGER">Multibagger Upload</option>
            <option value="PORTFOLIO">My Portfolio</option>
            <option value="WATCHLIST">My Watchlist</option>
            <option value="NSE500">NSE 500</option>
            <option value="CUSTOM">Custom (CSV)</option>
          </select>
          {universeChoice === 'CUSTOM' && (
            <input
              value={customCsv}
              onChange={(e) => setCustomCsv(e.target.value)}
              placeholder="POWERGRID.NS, NTPC.NS, ..."
              style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #1A2840', backgroundColor: '#0A1422', color: '#E6EDF3', width: 240 }}
            />
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {([
              { v: 'ALL', label: 'ALL' },
              { v: 'IN', label: '🇮🇳 IN' },
              { v: 'GLOBAL', label: '🌐 GL' },
            ] as const).map((r) => {
              const isActive = region === r.v;
              return (
                <button key={r.v} onClick={() => setRegion(r.v as 'ALL' | 'IN' | 'GLOBAL')}
                  style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: isActive ? '1px solid #38A9E860' : '1px solid #1A2840', backgroundColor: isActive ? '#0F7ABF20' : 'transparent', color: isActive ? '#38A9E8' : '#6B7A8D', cursor: 'pointer' }}>
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map(({ id, label, Icon, color }) => {
            const isActive = active === id;
            return (
              <button key={id} onClick={() => setActive(id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, border: isActive ? `1px solid ${color}80` : '1px solid #1A2840', backgroundColor: isActive ? `${color}18` : 'transparent', color: isActive ? color : '#8A95A3', fontSize: 13, fontWeight: 700, letterSpacing: '0.4px', cursor: 'pointer' }}>
                <Icon style={{ width: 16, height: 16 }} />
                {label.toUpperCase()}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: '#94A3B8', lineHeight: 1.5 }}>
          {activeMeta.tagline}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
        {active === 'margin' && (
          <MarginExpansionPanel rows={filterByRegion(marginRows).slice(0, 30)} loading={loadingE} color={activeMeta.color} convictionSet={convictionSet} />
        )}
        {active === 'model' && (
          <ModelShiftPanel rows={filterByRegion(modelRows).slice(0, 30)} loading={loadingN} color={activeMeta.color} convictionSet={convictionSet} />
        )}
        {active === 'multiple' && (
          <MultipleExpansionPanel rows={filterByRegion(multipleRows).slice(0, 30)} loading={loadingE || loadingQ} color={activeMeta.color} convictionSet={convictionSet} />
        )}
      </div>
    </div>
  );
}

// ─── Sub-panels ─────────────────────────────────────────────────────────────

function MarginExpansionPanel({ rows, loading, color, convictionSet }: { rows: MarginRow[]; loading: boolean; color: string; convictionSet: Set<string> }) {
  if (loading) return <Loader label="Loading earnings-scan…" />;
  if (rows.length === 0) return <Empty label="No margin-expansion candidates in the universe yet. Add tickers to portfolio / watchlist or wait for next earnings cycle." />;
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: '0.5px', marginBottom: 10 }}>
        📊 MARGIN EXPANSION RANKING
        <span style={{ marginLeft: 8, fontSize: 11, color: '#6B7A8D', fontWeight: 500 }}>Δ OPM (basis points) over last 4 quarters · sorted desc</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#6B7A8D', textAlign: 'left' }}>
              <th style={th()}>#</th>
              <th style={th()}>Ticker</th>
              <th style={th()}>Δ OPM (bps)</th>
              <th style={th()}>Latest OPM</th>
              <th style={th()}>Oldest OPM</th>
              <th style={th()}>Rev YoY (latest)</th>
              <th style={th()}>Quarters</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.ticker} style={{ borderTop: '1px solid #1A2840' }}>
                <td style={td()}>{i + 1}</td>
                <td style={tdMono()}>{r.ticker}<CbBadge ticker={r.ticker} convictionSet={convictionSet} /></td>
                <td style={{ ...td(), color: r.delta_opm_bps > 0 ? '#10B981' : '#EF4444', fontWeight: 700 }}>
                  {r.delta_opm_bps > 0 ? '+' : ''}{r.delta_opm_bps}
                </td>
                <td style={td()}>{r.latest_opm != null ? r.latest_opm.toFixed(2) + '%' : '—'}</td>
                <td style={td()}>{r.oldest_opm != null ? r.oldest_opm.toFixed(2) + '%' : '—'}</td>
                <td style={{ ...td(), color: (r.latest_rev_yoy ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>
                  {r.latest_rev_yoy != null ? (r.latest_rev_yoy >= 0 ? '+' : '') + r.latest_rev_yoy.toFixed(1) + '%' : '—'}
                </td>
                <td style={td()}>{r.quarters}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModelShiftPanel({ rows, loading, color, convictionSet }: { rows: ModelShiftRow[]; loading: boolean; color: string; convictionSet: Set<string> }) {
  if (loading) return <Loader label="Loading 180-day news universe…" />;
  if (rows.length === 0) return <Empty label="No model-shift signals in the last 90 days. Concept-detection regex matches SaaS / recurring / platform / ARR / NRR / land-and-expand." />;
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: '0.5px', marginBottom: 10 }}>
        🔁 MODEL SHIFT CANDIDATES
        <span style={{ marginLeft: 8, fontSize: 11, color: '#6B7A8D', fontWeight: 500 }}>Recent (90d) vs prior (90-180d) mention frequency for SaaS / recurring / platform language</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.ticker} style={{ padding: '10px 14px', backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14, fontWeight: 800, color: '#E6EDF3' }}>
                {r.ticker}<CbBadge ticker={r.ticker} convictionSet={convictionSet} />
              </span>
              <span style={{ fontSize: 11, color: '#94A3B8' }}>
                Recent <span style={{ color: '#10B981', fontWeight: 800 }}>×{r.recent_count}</span> · Prior ×{r.prior_count}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: r.jump_pct > 50 ? '#10B981' : r.jump_pct > 0 ? '#F59E0B' : '#6B7A8D' }}>
                {r.jump_pct > 0 ? '+' : ''}{r.jump_pct}% jump
              </span>
              {r.most_recent_age_days != null && r.most_recent_age_days <= 14 && (
                <span style={{ fontSize: 10, fontWeight: 800, color: '#0A1422', backgroundColor: '#FBBF24', padding: '1px 6px', borderRadius: 3 }}>🆕 {r.most_recent_age_days}d</span>
              )}
            </div>
            {r.most_recent_headline && (
              <div style={{ fontSize: 11, color: '#6B7A8D', lineHeight: 1.45, marginTop: 4 }}>
                "{r.most_recent_headline.slice(0, 180)}{r.most_recent_headline.length > 180 ? '…' : ''}"
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MultipleExpansionPanel({ rows, loading, color, convictionSet }: { rows: MultipleExpandRow[]; loading: boolean; color: string; convictionSet: Set<string> }) {
  if (loading) return <Loader label="Loading quotes + earnings…" />;
  if (rows.length === 0) return <Empty label="No multiple-expansion candidates yet. Need positive EPS YoY + valid P/E ratio in your universe." />;
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: '0.5px', marginBottom: 10 }}>
        🚀 MULTIPLE EXPANSION RANKING
        <span style={{ marginLeft: 8, fontSize: 11, color: '#6B7A8D', fontWeight: 500 }}>Lowest PEG (P/E ÷ EPS YoY %) · earnings inflection confirms re-rating runway</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#6B7A8D', textAlign: 'left' }}>
              <th style={th()}>#</th>
              <th style={th()}>Ticker</th>
              <th style={th()}>P/E</th>
              <th style={th()}>EPS YoY</th>
              <th style={th()}>PEG</th>
              <th style={th()}>Latest OPM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.ticker} style={{ borderTop: '1px solid #1A2840' }}>
                <td style={td()}>{i + 1}</td>
                <td style={tdMono()}>{r.ticker}<CbBadge ticker={r.ticker} convictionSet={convictionSet} /></td>
                <td style={td()}>{r.pe != null ? r.pe.toFixed(1) : '—'}</td>
                <td style={{ ...td(), color: '#10B981' }}>{r.eps_yoy != null ? '+' + r.eps_yoy.toFixed(1) + '%' : '—'}</td>
                <td style={{ ...td(), color: r.peg != null && r.peg < 1.0 ? '#10B981' : r.peg != null && r.peg < 1.5 ? '#F59E0B' : '#94A3B8', fontWeight: 700 }}>
                  {r.peg != null ? r.peg.toFixed(2) : '—'}
                </td>
                <td style={td()}>{r.latest_opm != null ? r.latest_opm.toFixed(2) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function th(): React.CSSProperties { return { padding: '6px 10px', fontWeight: 700, letterSpacing: '0.4px', fontSize: 10, textTransform: 'uppercase' }; }
function td(): React.CSSProperties { return { padding: '8px 10px', color: '#C9D4E0', fontVariantNumeric: 'tabular-nums' }; }
function tdMono(): React.CSSProperties { return { ...td(), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#E6EDF3', fontWeight: 700 }; }

function Loader({ label }: { label: string }) {
  return <div style={{ color: '#6B7A8D', fontSize: 13, padding: 24 }}>{label}</div>;
}
function Empty({ label }: { label: string }) {
  return <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 12, padding: 24, textAlign: 'center', color: '#6B7A8D', fontSize: 13 }}>{label}</div>;
}
