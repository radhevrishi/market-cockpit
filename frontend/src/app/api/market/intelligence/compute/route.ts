/**
 * Market Cockpit Intelligence Compute Engine
 *
 * Background endpoint that precomputes all intelligence signals and stores them in Redis.
 * This allows the main GET handler to serve responses instantly from cache.
 *
 * Triggered by:
 * 1. Cron scheduler (every N minutes)
 * 2. Fire-and-forget from main GET handler when data is stale
 * 3. Manual POST requests with custom watchlist/portfolio
 *
 * Storage:
 * - 'intelligence:signals' → full IntelligenceResponse object (TTL: 3600s)
 * - 'intelligence:meta' → { computedAt, signalCount, version, ttl }
 */

import { NextResponse } from 'next/server';
import { nseApiFetch, fetchStockQuote } from '@/lib/nse';
import { normalizeTicker } from '@/lib/tickers';
import { kvGet, kvSet, kvSetNX, kvSwap, kvDel } from '@/lib/kv';

const LOCK_KEY = 'lock:intelligence:compute';
const LOCK_TTL = 120; // 2 minutes (short — Vercel may kill function without running finally block)
const TEMP_SIGNALS_KEY = 'intelligence:signals:temp';
const PROD_SIGNALS_KEY = 'intelligence:signals';
const META_KEY = 'intelligence:meta';
const STORE_TTL = 3600;

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

const INR_TO_USD = 85;

// ==================== FETCH RESILIENCE HELPERS ====================

/**
 * Wraps an async function with retry logic
 * @param fn - async function to execute
 * @param retries - number of retries on failure (default: 1)
 * @param delayMs - delay between retries in ms (default: 200)
 * @returns the result or null if all attempts fail
 */
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries: number = 1,
  delayMs: number = 200
): Promise<T | null> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  console.warn(`[Fetch Retry] Failed after ${retries + 1} attempts:`, lastError?.message);
  return null;
}

// ==================== ROUTE-LEVEL CACHE (BUG-01 fix) ====================
const ROUTE_CACHE_TTL = 180_000;
let _routeCache: { key: string; data: any; timestamp: number } | null = null;

// ==================== MONEYCONTROL NEWS SCRAPER ====================

const MC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.moneycontrol.com/',
};

const MC_SLUG_CACHE = new Map<string, string>();

async function resolveMCSlug(symbol: string): Promise<string | null> {
  if (MC_SLUG_CACHE.has(symbol)) return MC_SLUG_CACHE.get(symbol)!;
  try {
    const url = `https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?classic=true&query=${encodeURIComponent(symbol)}&type=1&format=json&callback=`;
    const res = await fetch(url, { headers: MC_HEADERS, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const text = await res.text();
    const jsonStr = text.replace(/^[^[{]*/, '').replace(/[^}\]]*$/, '');
    const data = JSON.parse(jsonStr);
    const results = Array.isArray(data) ? data : (data?.data || []);
    for (const item of results) {
      const nseCode = item.nse_symbol || item.sc_id || '';
      if (nseCode.toUpperCase() === symbol.toUpperCase() || nseCode.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === symbol.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()) {
        const slug = item.link_src || item.sc_id || '';
        if (slug) { MC_SLUG_CACHE.set(symbol, slug); return slug; }
      }
    }
    if (results.length >= 1 && results[0]?.link_src) {
      MC_SLUG_CACHE.set(symbol, results[0].link_src);
      return results[0].link_src;
    }
  } catch {}
  return null;
}

interface MCNewsItem {
  symbol: string;
  companyName: string;
  subject: string;
  desc: string;
  date: string;
  source: string;
  url: string;
}

async function fetchMoneycontrolNews(symbols: string[]): Promise<MCNewsItem[]> {
  const allNews: MCNewsItem[] = [];
  const batchSize = 4;

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async (sym) => {
      try {
        const slug = await resolveMCSlug(sym);
        if (!slug) return [];

        const newsUrl = `https://www.moneycontrol.com/stocks/company_info/stock_news.php?sc_id=${encodeURIComponent(slug)}&scat=&pageno=1&next=0&duression=latest&search_type=`;
        const res = await fetch(newsUrl, {
          headers: MC_HEADERS,
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return [];
        const html = await res.text();

        const items: MCNewsItem[] = [];
        const liRegex = /<li[^>]*class="clearfix"[^>]*>([\s\S]*?)<\/li>/gi;
        let liMatch;
        while ((liMatch = liRegex.exec(html)) !== null) {
          const liContent = liMatch[1];
          const titleMatch = liContent.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
          const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
          const dateMatch = liContent.match(/(\w+\s+\d+,\s+\d{4}\s+\d+:\d+\s*(?:AM|PM|IST))/i) ||
                           liContent.match(/<span[^>]*>([^<]+)<\/span>/);
          const dateStr = dateMatch ? dateMatch[1].trim() : new Date().toISOString();
          const urlMatch = liContent.match(/href="([^"]+)"/i);
          const url = urlMatch ? urlMatch[1] : '';

          if (title && title.length > 10) {
            items.push({
              symbol: sym,
              companyName: sym,
              subject: title,
              desc: title,
              date: dateStr,
              source: 'moneycontrol',
              url: url.startsWith('http') ? url : `https://www.moneycontrol.com${url}`,
            });
          }
        }

        if (items.length === 0) {
          const aRegex = /<a[^>]+href="([^"]*news[^"]*)"[^>]*>\s*([\s\S]*?)\s*<\/a>/gi;
          let aMatch;
          while ((aMatch = aRegex.exec(html)) !== null) {
            const url = aMatch[1];
            const title = aMatch[2].replace(/<[^>]+>/g, '').trim();
            if (title.length > 15 && !title.includes('Login') && !title.includes('Sign Up')) {
              items.push({
                symbol: sym,
                companyName: sym,
                subject: title,
                desc: title,
                date: new Date().toISOString(),
                source: 'moneycontrol',
                url: url.startsWith('http') ? url : `https://www.moneycontrol.com${url}`,
              });
            }
          }
        }

        return items.slice(0, 10);
      } catch {
        return [];
      }
    }));

    for (const r of results) {
      if (r.status === 'fulfilled') allNews.push(...r.value);
    }
    if (i + batchSize < symbols.length) await new Promise(r => setTimeout(r, 300));
  }

  return allNews;
}

async function fetchGoogleNewsRSS(symbols: string[]): Promise<MCNewsItem[]> {
  const allNews: MCNewsItem[] = [];
  const queryGroups: string[][] = [];
  for (let i = 0; i < symbols.length; i += 5) {
    queryGroups.push(symbols.slice(i, i + 5));
  }

  for (const group of queryGroups.slice(0, 4)) {
    try {
      const query = group.map(s => `"${s}" NSE`).join(' OR ') + ' (order OR contract OR acquisition OR expansion OR capex)';
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': MC_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const xml = await res.text();

      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(xml)) !== null) {
        const content = match[1];
        const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() || '';
        const pubDate = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
        const link = content.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';

        const matchedSymbol = group.find(s => title.toUpperCase().includes(s));
        if (matchedSymbol && title.length > 10) {
          allNews.push({
            symbol: matchedSymbol,
            companyName: matchedSymbol,
            subject: title,
            desc: title,
            date: pubDate || new Date().toISOString(),
            source: 'google_news',
            url: link,
          });
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  return allNews;
}

// ==================== TYPES ====================

type ActionFlag = 'BUY' | 'ADD' | 'HOLD' | 'WATCH' | 'TRIM' | 'EXIT' | 'AVOID';
type ScoreClassification = 'HIGH_CONVICTION' | 'STRONG' | 'BUILDING' | 'WEAK' | 'NOISE';
type FreshnessLabel = 'FRESH' | 'RECENT' | 'AGING' | 'STALE';
type ImpactLevel = 'HIGH' | 'MEDIUM' | 'LOW';
type SignalSentiment = 'Bullish' | 'Neutral' | 'Bearish';

interface IntelSignal {
  symbol: string;
  company: string;
  date: string;
  source: 'order' | 'deal';

  eventType: string;
  headline: string;

  valueCr: number;
  valueUsd: string | null;
  mcapCr: number | null;
  revenueCr: number | null;
  impactPct: number;
  pctRevenue: number | null;
  pctMcap: number | null;
  inferenceUsed: boolean;

  client: string | null;
  segment: string | null;
  timeline: string | null;
  buyerSeller: string | null;
  premiumDiscount: number | null;
  lastPrice: number | null;

  impactLevel: ImpactLevel;
  impactConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceScore: number;
  confidenceType: 'ACTUAL' | 'INFERRED' | 'HEURISTIC';
  action: ActionFlag;
  score: number;
  timeWeight: number;
  weightedScore: number;
  sentiment: SignalSentiment;
  whyItMatters: string;
  isNegative: boolean;
  earningsBoost: boolean;

  isWatchlist: boolean;
  isPortfolio: boolean;

  valueSource?: 'EXACT' | 'AGGREGATED' | 'HEURISTIC';
  dataSource?: string;
  catalystStrength?: 'WEAK' | 'MODERATE' | 'STRONG';
  conflictResolution?: string;
  sectorCyclical?: boolean;
  priceReactionNote?: string;
  sector?: string;

  signalStackCount?: number;
  signalStackLevel?: 'STRONG' | 'BUILDING' | 'WEAK';
  portfolioImpactScore?: number;
  dataConfidence?: 'VERIFIED' | 'ESTIMATED' | 'LOW';

  scoreDelta?: number;
  scoreClassification?: ScoreClassification;
  freshness?: FreshnessLabel;
  sectorScore?: number;
  sectorTrend?: 'Bullish' | 'Neutral' | 'Bearish';
  decision?: ActionFlag;
  decisionReason?: string;
  tag?: string;  // e.g. 'TRANSITION PHASE', 'DATA_MISSING'

  // 3-Axis Normalized Scores (0-100 each)
  fundamentalScore?: number;     // Revenue/Margin/EPS delta
  signalStrengthScore?: number;  // Trend + direction + event type weight
  dataConfidenceScore?: number;  // Source reliability score

  // Institutional-grade fields
  signalTier?: 'TIER1_VERIFIED' | 'TIER2_INFERRED';  // Signal class separation
  contradictions?: string[];      // Detected contradictions (e.g. "Revenue decline + BUY")
  whyAction?: string;             // Explanation: "BUY despite margin decline due to..."
  anomalyFlags?: string[];        // QA flags (e.g. "DUPLICATE_VALUE", "ZERO_IMPACT")
  sourceUrl?: string;             // Provenance link to primary source
  revenueGrowth?: number | null;  // For contradiction detection
  marginChange?: number | null;   // For contradiction detection

  // Production-grade fields (v2)
  evidenceTier?: 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';  // Evidence quality ladder (D=template/suppressed)
  timeHorizon?: 'SHORT' | 'MEDIUM' | 'LONG';       // Signal time horizon
  watchSubtype?: 'ACTIVE' | 'PASSIVE';              // WATCH bucket split
  eventNovelty?: 'NEW' | 'REPEAT' | 'STALE';       // Event novelty detection
  heuristicSuppressed?: boolean;                     // Templated pattern suppression
  extremeValueFlag?: string;                         // Data accuracy concern
  // v3: Production audit fields
  templatePattern?: string;                          // e.g. "₹280Cr×19 companies"
  identicalPctFlag?: boolean;                        // Same % impact across companies
  sourceMismatch?: string;                           // Extracted vs known value mismatch
  guidanceAnomalyFlag?: string;                      // Extreme/inconsistent guidance
  visibility?: 'VISIBLE' | 'DIMMED' | 'HIDDEN';     // UI visibility control
  netSignalScore?: number;                           // Weighted net score from conflict model
  conflictBadge?: string;                            // e.g. "⚠ Conflicting: Guidance vs Capex"
  riskFactors?: string[];                            // Risk list for WHY panel
  sourceExtract?: string;                            // Extracted sentence from source
  // v4: Production audit v2 — orthogonal axes, guidance hardening
  sourceTier?: 'VERIFIED' | 'HEURISTIC' | 'INFERRED';   // Source authenticity axis
  dataQuality?: 'HIGH' | 'MEDIUM' | 'LOW' | 'BROKEN';   // Extraction correctness axis
  guidanceScope?: 'COMPANY' | 'SEGMENT' | 'PRODUCT' | 'REGION' | 'UNKNOWN'; // Guidance scope tag
  guidancePeriod?: 'FY' | 'Q' | 'RUN_RATE' | 'UNKNOWN'; // Guidance period tag
  actionScore?: number;                                   // Weighted ranking score for Top Actionable
  guidanceRangeLow?: number;                              // Range-aware: low bound
  guidanceRangeHigh?: number;                             // Range-aware: high bound
  guidanceRangeConfPenalty?: number;                       // Confidence penalty from wide range
  // v5: 3-flag verification model + signal/observation separation
  srcVerified?: boolean;        // Document exists & authentic
  numValidated?: boolean;       // Number extracted correctly (no mismatch)
  scopeValidated?: boolean;     // Correct period classification (FY/Q/segment)
  verified?: boolean;           // = srcVerified AND numValidated AND scopeValidated
  confidenceLayer?: number;     // Weighted: SRC 40% + NUM 30% + SCOPE 30%
  signalCategory?: 'ACTIONABLE' | 'MONITOR' | 'REJECTED' | 'OBSERVATION';  // FINAL: 3 dispositions
  observationReason?: string;   // Why it's non-actionable
  monitorScore?: number;           // 0-100 composite monitor quality score
  monitorTier?: 'HIGH' | 'MED' | 'LOW';  // Derived from monitorScore
  // v6: Decision Engine — Signal Class + Materiality
  signalClass?: 'ECONOMIC' | 'STRATEGIC' | 'GOVERNANCE' | 'COMPLIANCE';
  materialityScore?: number;  // 0-100 primary ranking metric
  managementRole?: string;    // Extracted role: CEO, CFO, MD, Chairman, etc.

  // v7: Production Decision Engine
  portfolioCritical?: boolean;
  v7RankScore?: number;
  signalTierV7?: 'ACTIONABLE' | 'NOTABLE' | 'MONITOR';
}

interface CompanyTrend {
  symbol: string;
  company: string;
  signalCount: number;
  stackLevel: 'STRONG' | 'BUILDING' | 'WEAK';
  topAction: ActionFlag;
  topImpact: ImpactLevel;
  netSentiment: SignalSentiment;
  avgScore: number;
  maxScore: number;
}

interface DailyBias {
  netBias: 'Bullish' | 'Neutral' | 'Bearish';
  highImpactCount: number;
  activeSectors: string[];
  buyWatchCount: number;   // renamed from buyCount (legacy compat)
  holdCount: number;
  monitorCount: number;    // new: replaces watchCount
  reduceExitCount: number; // renamed from trimExitCount
  totalSignals: number;
  totalObservations: number;  // v5
  totalOrderValueCr: number;
  totalDealValueCr: number;
  portfolioAlerts: number;
  negativeSignals: number;
  summary: string;
  // Legacy compat
  buyCount?: number;
  addCount?: number;
  watchCount?: number;
  trimExitCount?: number;
}

interface IntelligenceResponse {
  top3: IntelSignal[];
  signals: IntelSignal[];            // ACTIONABLE only (validated)
  notable?: IntelSignal[];           // v7: Notable tier (materialityScore 50-70, conf>=50)
  observations: IntelSignal[];       // Non-actionable (broken, unknown scope, etc.)
  trends: CompanyTrend[];
  bias: DailyBias;
  updatedAt: string;
  noHighConfSignals?: boolean;
  noActionableSignals?: boolean;     // v5: true when zero actionable exist
  dataStatus?: string;
  _debug?: any;
}

// ==================== ENRICHMENT DATA ====================

interface StockEnrichment {
  symbol: string;
  mcapCr: number | null;
  annualRevenueCr: number | null;
  revenueSource: 'TTM' | 'FY' | 'PARTIAL' | null;
  companyName: string | null;
  industry: string | null;
  lastPrice: number | null;
  issuedSize: number | null;
  dataStatus?: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  priceSource?: string;
}

interface EarningsData {
  quarters?: Array<{ revenue?: number; quarter?: string }>;
  annualRevenue?: number;
  mcap?: number;
  pe?: number;
  currentPrice?: number;
}

// ==================== UTILITY ====================

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function getTodayDate(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function fmtCr(v: number): string {
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  if (v >= 1) return `₹${Math.round(v)} Cr`;
  return `₹${Math.round(v * 100)}L`;
}

// ==================== PARSING ====================

const ORDER_KEYWORDS = [
  'order', 'contract', 'awarded', 'loi', 'letter of intent',
  'work order', 'purchase order', 'mandate', 'supply agreement',
  'signed', 'obtained', 'bagging', 'receiving of orders',
  'capex', 'capital expenditure', 'expansion', 'new plant', 'new facility',
  'greenfield', 'brownfield', 'capacity addition', 'capacity expansion',
  'joint venture', 'jv', 'partnership', 'mou', 'collaboration',
  'acquisition', 'merger', 'amalgamation', 'buyout', 'demerger', 'spinoff', 'hive off', 'spin off',
  'open offer', 'takeover', 'delisting offer', 'preferential acquisition',
  'fund raising', 'qip', 'rights issue', 'capital raising', 'preferential allotment',
  'appointment', 'resignation', 'ceo', 'cfo', 'managing director',
  'dividend', 'buyback',
  'guidance', 'outlook', 'forecast', 'target', 'revenue guidance',
  'turnaround', 'back to profit', 'return to profitability', 'profit after loss',
  'pli', 'production linked incentive', 'regulatory approval', 'noc obtained',
  'license obtained', 'spectrum', 'regulatory clearance',
  'platform launch', 'technology upgrade', 'digital transformation',
  'global expansion', 'international market', 'export order',
  'market share gain', 'category leader', 'market leadership',
];

const NOISE_PATTERNS = [
  'rumour verification', 'clarification on', 'regulation 30',
  'action(s) taken', 'action(s) initiated', 'newspaper publication',
  'loss of share certificate', 'duplicate share', 'certificate',
  'investor meet', 'investor call', 'analyst meet',
  'board meeting intimation', 'record date',
  'compliance certificate', 'annual report', 'annual return',
  'disclosure under', 'credit rating', 'rating rationale',
  'closure of trading window', 'trading window', 'code of conduct',
  'secretarial audit', 'related party', 'composition of',
  'book closure', 'register of members', 'agm', 'general meeting',
  'interest payment', 'coupon payment', 'debenture',
  'listing of shares', 'allotment of shares', 'esop', 'esos',
  'change in address', 'change in directorate', 'cessation',
  'outcome of board', 'schedule of analyst', 'press release',
  'change in management', 'independent director',
  'postal ballot', 'notice of', 'proceedings of',
];

const NEGATIVE_KEYWORDS = [
  'order cancellation', 'cancelled', 'revoked', 'terminated',
  'margin warning', 'margin pressure', 'margin decline',
  'promoter selling', 'promoter pledge', 'pledge of shares', 'invocation of pledge',
  'debt increase', 'debt raise', 'downgrade', 'credit downgrade',
  'forensic audit', 'fraud', 'investigation', 'sebi order', 'penalty',
  'loss', 'net loss', 'operating loss', 'winding up', 'insolvency',
  'default', 'npa', 'non-performing', 'write-off', 'write off',
  'resignation of', 'key managerial', 'auditor resignation',
  'qualified opinion', 'disclaimer of opinion', 'adverse opinion',
  'demand notice', 'tax demand', 'show cause',
  'strike', 'lockout', 'force majeure', 'fire', 'accident',
  'delisting', 'suspension',
];

function parseAllValues(text: string): number[] {
  if (!text) return [];
  const values: number[] = [];
  const s = text;

  const croreMatches = s.matchAll(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/gi);
  for (const m of croreMatches) values.push(parseFloat(m[1].replace(/,/g, '')));

  const standaloneCr = s.matchAll(/\b([\d,]+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/gi);
  for (const m of standaloneCr) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (val > 0.5) values.push(val);
  }

  const lakhMatches = s.matchAll(/(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs)\b/gi);
  for (const m of lakhMatches) {
    const val = parseFloat(m[1].replace(/,/g, '')) / 100;
    if (val > 0.01) values.push(val);
  }

  const usdMnMatches = s.matchAll(/(?:usd|\$|us\$|us\s*dollar)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/gi);
  for (const m of usdMnMatches) values.push((parseFloat(m[1].replace(/,/g, '')) * INR_TO_USD) / 10);

  const mnUsdMatches = s.matchAll(/\b([\d,]+(?:\.\d+)?)\s*(?:million|mn)\s*(?:usd|us\s*dollar|dollar)/gi);
  for (const m of mnUsdMatches) values.push((parseFloat(m[1].replace(/,/g, '')) * INR_TO_USD) / 10);

  const usdBnMatches = s.matchAll(/(?:usd|\$|us\$)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/gi);
  for (const m of usdBnMatches) values.push(parseFloat(m[1].replace(/,/g, '')) * INR_TO_USD * 100);

  const inrMnMatches = s.matchAll(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn)\b/gi);
  for (const m of inrMnMatches) values.push(parseFloat(m[1].replace(/,/g, '')) / 10);

  const eurMatches = s.matchAll(/(?:eur|€|euro)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/gi);
  for (const m of eurMatches) values.push((parseFloat(m[1].replace(/,/g, '')) * INR_TO_USD * 1.08) / 10);

  return values.filter(v => v > 0 && isFinite(v));
}

function parseOrderValue(text: string): number | null {
  const values = parseAllValues(text);
  if (values.length === 0) return null;
  return Math.max(...values);
}

// ==================== INFERENCE ENGINE v4 ====================

interface InferenceResult {
  valueCr: number;
  pctRevenue: number;
  pctRange: [number, number];
  confidenceScore: number;
  confidenceType: 'ACTUAL' | 'INFERRED' | 'HEURISTIC';
}

interface SectorRange { min: number; mid: number; max: number; }
const SECTOR_HEURISTICS: Record<string, Record<string, SectorRange>> = {
  'M&A': {
    'IT': { min: 2, mid: 3.5, max: 6 }, 'Auto': { min: 3, mid: 5.5, max: 8 },
    'Pharma': { min: 2, mid: 4, max: 7 }, 'Infra': { min: 3, mid: 6, max: 10 },
    'Power': { min: 3, mid: 5, max: 8 }, 'Defence': { min: 4, mid: 7, max: 12 },
    'Metals': { min: 3, mid: 5, max: 8 }, 'Chemicals': { min: 2, mid: 4, max: 7 },
    'Telecom': { min: 2, mid: 4.5, max: 8 }, 'default': { min: 2, mid: 4.5, max: 8 },
  },
  'Order Win': {
    'Infra': { min: 5, mid: 10, max: 15 }, 'Defence': { min: 6, mid: 12, max: 20 },
    'Power': { min: 4, mid: 8, max: 14 }, 'Railways': { min: 5, mid: 10, max: 18 },
    'Construction': { min: 5, mid: 9, max: 15 }, 'IT': { min: 1, mid: 2.5, max: 6 },
    'Auto': { min: 1.5, mid: 3, max: 6 }, 'Pharma': { min: 1, mid: 2, max: 5 },
    'Metals': { min: 2, mid: 4, max: 8 }, 'Oil & Gas': { min: 2, mid: 5, max: 10 },
    'default': { min: 2, mid: 4, max: 8 },
  },
  'Contract': {
    'Infra': { min: 4, mid: 8, max: 14 }, 'Defence': { min: 5, mid: 10, max: 18 },
    'Power': { min: 3, mid: 7, max: 12 }, 'Railways': { min: 4, mid: 9, max: 16 },
    'IT': { min: 1, mid: 2, max: 5 }, 'Auto': { min: 1, mid: 3, max: 6 },
    'default': { min: 2, mid: 4, max: 8 },
  },
  'Capex/Expansion': {
    'Infra': { min: 4, mid: 8, max: 14 }, 'Power': { min: 5, mid: 10, max: 18 },
    'Auto': { min: 3, mid: 6, max: 10 }, 'Pharma': { min: 2, mid: 5, max: 9 },
    'Chemicals': { min: 3, mid: 7, max: 12 }, 'Metals': { min: 4, mid: 8, max: 14 },
    'IT': { min: 1, mid: 3, max: 6 }, 'default': { min: 3, mid: 6, max: 10 },
  },
  'LOI': { 'default': { min: 1, mid: 2, max: 4 } },
  'JV/Partnership': { 'default': { min: 1.5, mid: 3, max: 6 } },
  'Fund Raising': { 'default': { min: 2, mid: 4, max: 8 } },
  'Demerger': { 'default': { min: 4, mid: 8, max: 15 } },
  'Buyback': { 'default': { min: 1, mid: 2.5, max: 5 } },
  'Dividend': { 'default': { min: 0.3, mid: 0.8, max: 2 } },
  'Guidance': { 'default': { min: 1, mid: 2, max: 5 } },
  'Mgmt Change': { 'default': { min: 0.5, mid: 1, max: 3 } },
  'Corporate': { 'default': { min: 0.5, mid: 1, max: 3 } },
};

// ══════════════════════════════════════════════════════════════
// ── SIGNAL CLASS + MATERIALITY ENGINE (v6) ──
// Replaces simple FINANCIAL/NON_FINANCIAL with 4-class system
// ══════════════════════════════════════════════════════════════

type SignalClass = 'ECONOMIC' | 'STRATEGIC' | 'GOVERNANCE' | 'COMPLIANCE';

// Event Type → Signal Class mapping
const ECONOMIC_EVENTS = new Set([
  'Order Win', 'Contract', 'LOI', 'Capex/Expansion', 'Fund Raising',
  'Guidance', 'Earnings', 'M&A', 'Demerger', 'Spinoff', 'Buyback', 'Dividend',
  'Open Offer', 'Takeover', 'Rights Issue', 'QIP',
  'Turnaround', 'Policy Opening', 'Regulatory Approval', 'Technology Transition',
  'Block Deal', 'Bulk Deal', 'Stake Sale', 'Bonus',
]);

const STRATEGIC_EVENTS = new Set([
  'CEO Change', 'CFO Change', 'MD Change', 'Chairman Change',
  'Leadership Transition',
]);

const GOVERNANCE_EVENTS = new Set([
  'Mgmt Change', 'Board Appointment', 'Board Meeting',
]);

const COMPLIANCE_EVENTS = new Set([
  'Compliance', 'Regulatory', 'Filing', 'AGM', 'EGM',
]);

// Senior roles that make governance signals investable
const SENIOR_ROLES = new Set(['CEO', 'CFO', 'MD', 'Chairman', 'Managing Director', 'Chief Executive', 'Chief Financial']);

function classifySignalClass(eventType: string, headline?: string, description?: string): SignalClass {
  if (ECONOMIC_EVENTS.has(eventType)) return 'ECONOMIC';
  if (STRATEGIC_EVENTS.has(eventType)) return 'STRATEGIC';
  if (COMPLIANCE_EVENTS.has(eventType)) return 'COMPLIANCE';
  if (GOVERNANCE_EVENTS.has(eventType)) return 'GOVERNANCE';

  // Keyword fallback
  const lower = (eventType || '').toLowerCase();
  const textLower = ((headline || '') + ' ' + (description || '')).toLowerCase();

  // Check if this is really an economic event misclassified
  if (lower.includes('order') || lower.includes('contract') || lower.includes('capex') ||
      lower.includes('guidance') || lower.includes('earnings') || lower.includes('revenue')) return 'ECONOMIC';

  // Check for senior leadership changes → STRATEGIC
  if ((lower.includes('ceo') || lower.includes('cfo') || lower.includes('md ') || lower.includes('chairman')) &&
      (lower.includes('change') || lower.includes('exit') || lower.includes('appoint'))) return 'STRATEGIC';

  // Check for management keywords → GOVERNANCE
  if (lower.includes('mgmt') || lower.includes('management') || lower.includes('board') ||
      lower.includes('appointment') || lower.includes('resignation') || lower.includes('director')) return 'GOVERNANCE';

  // Default: if no clear category, treat as COMPLIANCE (hidden)
  return 'COMPLIANCE';
}

// Extract management role from headline/description
function extractManagementRole(headline?: string, description?: string): string {
  const text = ((headline || '') + ' ' + (description || '')).toLowerCase();
  if (text.includes('ceo') || text.includes('chief executive')) return 'CEO';
  if (text.includes('cfo') || text.includes('chief financial')) return 'CFO';
  if (text.includes('managing director') || /\bmd\b/.test(text)) return 'MD';
  if (text.includes('chairman') || text.includes('chairperson')) return 'Chairman';
  if (text.includes('coo') || text.includes('chief operating')) return 'COO';
  if (text.includes('cto') || text.includes('chief technology')) return 'CTO';
  if (text.includes('whole-time director') || text.includes('whole time director')) return 'Director';
  if (text.includes('independent director')) return 'Independent Director';
  if (text.includes('director')) return 'Director';
  if (text.includes('vp') || text.includes('vice president')) return 'VP';
  if (text.includes('president')) return 'President';
  return 'Other';
}

// Governance materiality ladder — determines real impact of mgmt changes
function governanceMateriality(role: string): 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW' {
  if (['CEO', 'CFO', 'MD', 'Chairman', 'Managing Director'].includes(role)) return 'HIGH';
  if (['COO', 'CTO', 'President', 'Promoter'].includes(role)) return 'HIGH';
  if (['Director', 'Whole-Time Director', 'Independent Director'].includes(role)) return 'MEDIUM';
  if (['VP', 'Company Secretary', 'Auditor'].includes(role)) return 'LOW';
  // 'Other' / unknown = MEDIUM (not LOW) — NSE filings often lack role detail
  return 'MEDIUM';
}

// False classification guard — checks if a mgmt change signal is actually real
// NSE-sourced signals default to real (corporate filings are authoritative)
function isRealMgmtChange(headline?: string, description?: string, dataSource?: string): boolean {
  const text = ((headline || '') + ' ' + (description || '')).toLowerCase();
  // Explicit contradictions
  if (text.includes('no change in management') || text.includes('no change in control') ||
      text.includes('no material change')) return false;
  // NSE corporate filings about mgmt changes are inherently real events
  if (dataSource === 'nse' || dataSource === 'NSE') return true;
  // Must have appointment/change keywords for non-NSE sources
  const hasChangeKeywords = /appoint|resign|step.?down|relinquish|cessation|retire|join|elevat|promot|succeed|replac|interim|addition|designat|re-?appoint|change|director|board|committee/.test(text);
  if (!hasChangeKeywords && text.length > 20) return false;
  return true;
}

// Event type weights for materiality scoring
const EVENT_TYPE_WEIGHTS: Record<string, number> = {
  'Guidance': 100, 'Earnings': 90,
  'Open Offer': 88, 'Takeover': 88,           // Mandatory offer = hard floor price catalyst
  'Turnaround': 85,                             // Powerful re-rating signal
  'Capex/Expansion': 75, 'Order Win': 70, 'Contract': 70,
  'M&A': 68, 'Demerger': 65, 'Spinoff': 65,
  'Policy Opening': 62, 'Regulatory Approval': 60,
  'Technology Transition': 58,
  'Fund Raising': 55, 'LOI': 50, 'JV/Partnership': 50,
  'Block Deal': 45, 'Bulk Deal': 45, 'Stake Sale': 40, 'QIP': 40,
  'Rights Issue': 35, 'Buyback': 35, 'Dividend': 30, 'Bonus': 25,
  'CEO Change': 50, 'CFO Change': 45, 'MD Change': 45, 'Chairman Change': 40,
  'Leadership Transition': 35,
  'Mgmt Change': 10, 'Board Appointment': 10, 'Board Meeting': 5,
  'Compliance': 0, 'Regulatory': 5, 'Filing': 0, 'AGM': 0, 'EGM': 0,
};

// Management importance scores
const MGMT_IMPORTANCE: Record<string, number> = {
  'CEO': 100, 'CFO': 90, 'MD': 90, 'Chairman': 85, 'Managing Director': 90,
  'COO': 70, 'CTO': 65, 'President': 75, 'Director': 30,
  'Whole-Time Director': 30, 'Independent Director': 15, 'VP': 20, 'Other': 10,
};

// ── MATERIALITY SCORE: Primary ranking metric ──
// materialityScore = economicImpact(40%) + eventTypeWeight(25%) + confidence(15%) + managementImportance(10%) + recency(10%)
function computeMaterialityScore(signal: any): number {
  const signalClass: SignalClass = signal.signalClass || 'COMPLIANCE';

  // Component 1: Economic Impact (0-40)
  let economicImpact = 0;
  if (signalClass === 'ECONOMIC') {
    const revPct = Math.abs(signal.impactPct || 0);
    const valRatio = signal.revenueCr ? (signal.valueCr / signal.revenueCr) * 100 : 0;
    economicImpact = Math.min(40, (revPct * 3) + (valRatio * 2));
    // Bonus for actual (non-inferred) numbers
    if (signal.confidenceType === 'ACTUAL' && signal.valueCr > 0) economicImpact = Math.min(40, economicImpact + 10);
  }

  // Component 2: Event Type Weight (0-25)
  const evtWeight = EVENT_TYPE_WEIGHTS[signal.eventType] || 0;
  const eventComponent = (evtWeight / 100) * 25;

  // Component 3: Confidence (0-15)
  let confidence = 5; // baseline
  if (signal.confidenceType === 'ACTUAL') confidence = 15;
  else if (signal.sourceTier === 'VERIFIED') confidence = 12;
  else if (signal.dataSource === 'nse' || signal.dataSource === 'NSE') confidence = 10;
  else if (signal.confidenceType === 'INFERRED') confidence = 5;
  else if (signal.confidenceType === 'HEURISTIC') confidence = 3;

  // Component 4: Management Importance (0-10) — only for GOVERNANCE/STRATEGIC
  let mgmtComponent = 0;
  if (signalClass === 'GOVERNANCE' || signalClass === 'STRATEGIC') {
    const role = signal.managementRole || 'Other';
    const roleScore = MGMT_IMPORTANCE[role] || 10;
    mgmtComponent = (roleScore / 100) * 10;
  }

  // Component 5: Recency (0-10)
  let recency = 3;
  if (signal.freshness === 'FRESH') recency = 10;
  else if (signal.freshness === 'RECENT') recency = 7;
  else if (signal.freshness === 'AGING') recency = 3;
  else recency = 1;

  return Math.min(100, Math.round(economicImpact + eventComponent + confidence + mgmtComponent + recency));
}

// ── VISIBILITY FILTER ──
// COMPLIANCE = DIMMED (available for sparse backfill, not hard-hidden)
// GOVERNANCE = DIMMED unless senior role (CEO/CFO/MD/Chairman)
// STRATEGIC/ECONOMIC = VISIBLE
function determineVisibility(signal: any): 'VISIBLE' | 'DIMMED' | 'HIDDEN' {
  const signalClass: SignalClass = signal.signalClass || 'COMPLIANCE';

  if (signalClass === 'COMPLIANCE') return 'DIMMED';

  if (signalClass === 'GOVERNANCE') {
    const role = signal.managementRole || 'Other';
    if (SENIOR_ROLES.has(role)) return 'VISIBLE';
    return 'DIMMED';  // Non-senior governance = dimmed (available for backfill)
  }

  // ECONOMIC and STRATEGIC are always visible
  return 'VISIBLE';
}

// ── ACTION FROM MATERIALITY ──
function actionFromMateriality(signal: any): ActionFlag {
  const ms = signal.materialityScore || 0;
  const signalClass: SignalClass = signal.signalClass || 'COMPLIANCE';

  // Zero-impact non-economic signals → IGNORE (display as MONITOR)
  if (ms === 0 || signalClass === 'COMPLIANCE') return 'WATCH';  // Will be hidden anyway

  // GOVERNANCE/STRATEGIC with no economic impact
  if ((signalClass === 'GOVERNANCE' || signalClass === 'STRATEGIC') && (signal.impactPct || 0) === 0) {
    if (ms >= 45) return 'HOLD';  // Senior CEO/CFO change worth monitoring
    return 'WATCH';  // Low importance, just watch
  }

  // Materiality-driven action (primarily ECONOMIC signals)
  if (ms >= 75) return signal.isNegative ? 'TRIM' : 'BUY';
  if (ms >= 60) return signal.isNegative ? 'HOLD' : 'ADD';
  if (ms >= 45) return 'HOLD';
  return 'WATCH';
}

// ── WHY THIS MATTERS: Mandatory field ──
function buildWhyThisMatters(signal: any): string {
  const signalClass: SignalClass = signal.signalClass || 'COMPLIANCE';

  if (signalClass === 'ECONOMIC') {
    const parts: string[] = [];
    if (signal.impactPct && signal.impactPct !== 0) parts.push(`Revenue impact ${signal.impactPct > 0 ? '+' : ''}${signal.impactPct.toFixed(1)}%`);
    if (signal.valueCr && signal.valueCr > 0) {
      if (signal.revenueCr && signal.revenueCr > 0) {
        parts.push(`Order size ${((signal.valueCr / signal.revenueCr) * 100).toFixed(1)}% of revenue`);
      } else {
        parts.push(`Value ₹${Math.round(signal.valueCr)} Cr`);
      }
    }
    if (signal.catalystStrength === 'STRONG') parts.push('Strong catalyst');
    if (parts.length === 0) parts.push(signal.eventType + ' event detected');
    return parts.join(' · ');
  }

  if (signalClass === 'STRATEGIC') {
    const role = signal.managementRole || 'Leadership';
    return `${role} change — potential strategy shift · Watch for execution impact`;
  }

  if (signalClass === 'GOVERNANCE') {
    const role = signal.managementRole || 'Management';
    if (SENIOR_ROLES.has(role)) {
      return `${role} change at leadership level — monitor for strategy continuity`;
    }
    return `${signal.eventType} — routine governance event`;
  }

  return 'Compliance disclosure — no investment action required';
}

// ── v7 EVENT WEIGHTS (normalized 0-1) ──
const V7_EVENT_WEIGHTS: Record<string, number> = {
  'Guidance': 1.0, 'Earnings': 0.9,
  'Open Offer': 0.9, 'Takeover': 0.9,           // Takeover premium = floor price
  'Turnaround': 0.85,                             // Post-loss recovery = re-rating
  'Capex/Expansion': 0.8, 'M&A': 0.8,
  'Demerger': 0.8, 'Spinoff': 0.8,               // Value unlock events
  'Policy Opening': 0.75, 'Regulatory Approval': 0.75,
  'Technology Transition': 0.7,
  'Order Win': 0.7, 'Contract': 0.7,
  'CEO Change': 0.65, 'CFO Change': 0.6, 'MD Change': 0.6,
  'Fund Raising': 0.6, 'QIP': 0.55, 'LOI': 0.5,
  'JV/Partnership': 0.55,
  'Block Deal': 0.5, 'Bulk Deal': 0.5, 'Stake Sale': 0.5,
  'Rights Issue': 0.45, 'Buyback': 0.45, 'Dividend': 0.3,
  'Mgmt Change': 0.2, 'Board Appointment': 0.2,
  'Compliance': 0.05, 'Regulatory': 0.1, 'Filing': 0.05,
};

// Classify mgmt change as STRATEGIC vs ROUTINE
function classifyMgmtChangeType(signal: any): 'STRATEGIC' | 'ROUTINE' {
  const role = signal.managementRole || 'Other';
  if (['CEO', 'CFO', 'MD', 'Chairman', 'Managing Director', 'COO', 'CTO', 'President', 'Promoter'].includes(role)) return 'STRATEGIC';
  const text = ((signal.headline || '') + ' ' + (signal.whyItMatters || '')).toLowerCase();
  if (text.includes('ai') || text.includes('business unit head') || text.includes('strategy') || text.includes('restructur')) return 'STRATEGIC';
  return 'ROUTINE';
}

// v7 composite ranking score
function computeV7RankScore(signal: any): number {
  const confScore = signal.dataConfidenceScore || signal.confidenceScore || 50;
  const confidenceWeight = confScore / 100;

  // Event weight — routine mgmt changes get 0.2, strategic get 0.6
  let eventWeight = V7_EVENT_WEIGHTS[signal.eventType] || 0.1;
  if (signal.eventType === 'Mgmt Change' || signal.eventType === 'Board Appointment') {
    eventWeight = classifyMgmtChangeType(signal) === 'STRATEGIC' ? 0.6 : 0.2;
  }

  // Materiality weight — capped at 1.0, based on impact%
  const impactPct = Math.abs(signal.impactPct || 0);
  const materialityWeight = impactPct > 0 ? Math.min(impactPct / 5, 1.0) : 0.1;

  // Freshness weight
  const freshnessWeight = signal.freshness === 'FRESH' ? 1.0 : signal.freshness === 'RECENT' ? 0.8 : signal.freshness === 'AGING' ? 0.5 : 0.3;

  // Verification bonus
  const verifiedBonus = (signal.confidenceType === 'ACTUAL' && !signal.inferenceUsed) ? 1.2 : 1.0;

  return Math.round(
    (signal.materialityScore || 30)
    * confidenceWeight
    * eventWeight
    * materialityWeight
    * freshnessWeight
    * verifiedBonus
  );
}

// Aggressive text cleaning helper (reused from old sanitizeByEventClass)
const stripFinancialText = (t: string) => t
  .replace(/₹[\d,.]+\s*(?:Cr|crore|cr|Lakh|lakh|K\s*Cr|L|K)\s*(?:\(est\.?\))?/gi, '')
  .replace(/₹[\d,.]+/g, '')
  .replace(/\d+\.?\d*%\s*(?:of\s+)?(?:revenue|mcap|impact|growth)\s*(?:\(est\.?\))?/gi, '')
  .replace(/\[UNVERIFIED AMOUNT\]/g, '').replace(/\[UNVERIFIED %\]/g, '').replace(/\[UNVERIFIED\]\s*/g, '')
  .replace(/\(est\.?\)/g, '')
  .replace(/\s*—\s*$/g, '').replace(/\s*·\s*$/g, '').replace(/\s{2,}/g, ' ').trim();

// ── SANITIZE BY EVENT CLASS (updated for v6) ──
function sanitizeByEventClass(signal: any): void {
  const signalClass: SignalClass = signal.signalClass || classifySignalClass(signal.eventType);
  signal.signalClass = signalClass;

  if (signalClass === 'GOVERNANCE' || signalClass === 'COMPLIANCE') {
    // Hard strip ALL numeric enrichment
    signal.valueCr = 0; signal.impactPct = 0; signal.pctRevenue = null; signal.pctMcap = null;
    signal.impactLevel = 'LOW';
    signal.confidenceType = 'ACTUAL';
    signal.valueSource = 'EXACT';
    signal.inferenceUsed = false;
    signal.signalTier = 'TIER1_VERIFIED';
    signal.heuristicSuppressed = false;
    signal.anomalyFlags = [];
    // Clean all text fields
    signal.whyItMatters = stripFinancialText(signal.whyItMatters || '');
    if (!signal.whyItMatters || signal.whyItMatters.length < 10) {
      signal.whyItMatters = buildWhyThisMatters(signal);
    }
    if (signal.headline) signal.headline = stripFinancialText(signal.headline);
    if (signal.sourceExtract) {
      signal.sourceExtract = stripFinancialText(signal.sourceExtract);
      if (!signal.sourceExtract || signal.sourceExtract.length < 5) signal.sourceExtract = undefined;
    }
    if (signal.whyAction) {
      signal.whyAction = stripFinancialText(signal.whyAction);
      if (!signal.whyAction || signal.whyAction.length < 5) signal.whyAction = 'Monitor for strategic impact';
    }
  } else if (signalClass === 'STRATEGIC') {
    // Strategic: strip numbers only if inferred
    if (signal.confidenceType === 'HEURISTIC' || signal.inferenceUsed) {
      signal.valueCr = 0; signal.impactPct = 0; signal.pctRevenue = null; signal.pctMcap = null;
      signal.inferenceUsed = false;
      signal.whyItMatters = stripFinancialText(signal.whyItMatters || '');
      if (signal.headline) signal.headline = stripFinancialText(signal.headline);
      if (signal.sourceExtract) {
        signal.sourceExtract = stripFinancialText(signal.sourceExtract);
        if (!signal.sourceExtract || signal.sourceExtract.length < 5) signal.sourceExtract = undefined;
      }
      if (signal.whyAction) {
        signal.whyAction = stripFinancialText(signal.whyAction);
        if (!signal.whyAction || signal.whyAction.length < 5) signal.whyAction = buildWhyThisMatters(signal);
      }
    }
    signal.heuristicSuppressed = false;
    signal.anomalyFlags = [];
  }
  // ECONOMIC: keep numbers as-is (zero-inference policy handles display)
}

// ── FEED COMPOSITION ENFORCEMENT ──
// Max 10 visible signals, ≥60% ECONOMIC, ≤20% GOVERNANCE, 0% COMPLIANCE
function enforceFeedComposition(signals: any[]): any[] {
  const MAX_FEED = 10;

  // Separate by class (include DIMMED governance for backfill)
  const economic = signals.filter(s => s.signalClass === 'ECONOMIC');
  const strategic = signals.filter(s => s.signalClass === 'STRATEGIC');
  const governance = signals.filter(s => s.signalClass === 'GOVERNANCE');

  // Sort each by materialityScore descending
  economic.sort((a, b) => (b.materialityScore || 0) - (a.materialityScore || 0));
  strategic.sort((a, b) => (b.materialityScore || 0) - (a.materialityScore || 0));
  governance.sort((a, b) => (b.materialityScore || 0) - (a.materialityScore || 0));

  let feed: any[] = [];

  if (economic.length >= 6) {
    // Rich data: enforce composition (60% eco, max 2 gov)
    feed.push(...economic.slice(0, 6));
    feed.push(...governance.slice(0, 2));
    feed.push(...strategic.slice(0, Math.max(0, MAX_FEED - feed.length)));
    if (feed.length < MAX_FEED && economic.length > 6) {
      feed.push(...economic.slice(6, 6 + (MAX_FEED - feed.length)));
    }
  } else {
    // Sparse data: show best available, deduplicated by company
    feed.push(...economic);
    feed.push(...strategic);
    const usedSymbols = new Set(feed.map(s => s.symbol));
    const uniqueGov = governance.filter(s => !usedSymbols.has(s.symbol));
    feed.push(...uniqueGov);
  }

  // Quality enforcement: ensure verified signals rank above unverified
  feed.sort((a, b) => {
    // Primary: verified source gets priority
    const aVerified = (a.confidenceType === 'ACTUAL' || a.sourceTier === 'VERIFIED') ? 1 : 0;
    const bVerified = (b.confidenceType === 'ACTUAL' || b.sourceTier === 'VERIFIED') ? 1 : 0;
    if (aVerified !== bVerified) return bVerified - aVerified;
    // Secondary: materialityScore
    return (b.materialityScore || 0) - (a.materialityScore || 0);
  });

  // Cap governance at max 2 in top 5
  const top5Gov = feed.slice(0, 5).filter(s => s.signalClass === 'GOVERNANCE');
  if (top5Gov.length > 2) {
    // Move excess governance down
    let govCount = 0;
    const reordered: any[] = [];
    const deferred: any[] = [];
    for (const s of feed) {
      if (s.signalClass === 'GOVERNANCE') {
        govCount++;
        if (govCount <= 2) reordered.push(s);
        else deferred.push(s);
      } else {
        reordered.push(s);
      }
    }
    feed = [...reordered, ...deferred];
  }

  return feed.slice(0, MAX_FEED);
}

function getSectorHeuristic(eventType: string, sector: string | null): SectorRange {
  const eventMap = SECTOR_HEURISTICS[eventType] || SECTOR_HEURISTICS['Corporate'];
  if (sector && eventMap[sector]) return eventMap[sector];
  return eventMap['default'] || { min: 1, mid: 2, max: 5 };
}

function getKeywordMagnitude(text: string): number {
  const lower = text.toLowerCase();
  if (/mega|landmark|transformative|game.?chang|largest ever|record|biggest/i.test(lower)) return 2.5;
  if (/large|major|significant|substantial|multi.?billion|massive|sizable/i.test(lower)) return 1.8;
  if (/medium|moderate|decent/i.test(lower)) return 1.0;
  if (/small|minor|routine|regular|nominal/i.test(lower)) return 0.4;
  return 1.0;
}

function inferEventValue(
  text: string,
  annualRevenueCr: number | null,
  eventType: string,
  isNegative: boolean,
  sector: string | null,
): InferenceResult {
  // Non-ECONOMIC events: never generate synthetic values
  const signalClass = classifySignalClass(eventType);
  if (signalClass !== 'ECONOMIC') {
    return { valueCr: 0, pctRevenue: 0, pctRange: [0, 0], confidenceScore: 80, confidenceType: 'ACTUAL' };
  }

  const rev = (annualRevenueCr && annualRevenueCr > 0) ? annualRevenueCr : null;
  const magnitude = getKeywordMagnitude(text);
  const range = getSectorHeuristic(eventType, sector);
  const adjustedMid = parseFloat((range.mid * magnitude).toFixed(2));
  const adjustedMin = parseFloat((range.min * magnitude).toFixed(2));
  const adjustedMax = parseFloat((range.max * magnitude).toFixed(2));
  const pctRange: [number, number] = [adjustedMin, adjustedMax];

  if (isNegative) {
    const negPct = Math.max(3, adjustedMid) * 0.7;
    if (rev) {
      return {
        valueCr: parseFloat((rev * negPct / 100).toFixed(1)),
        pctRevenue: negPct, pctRange,
        confidenceScore: 40, confidenceType: 'HEURISTIC',
      };
    }
    return { valueCr: 100, pctRevenue: negPct, pctRange, confidenceScore: 40, confidenceType: 'HEURISTIC' };
  }

  if (rev) {
    const penalizedMid = adjustedMid * 0.7;
    const estimatedValue = parseFloat((rev * penalizedMid / 100).toFixed(1));
    return {
      valueCr: estimatedValue, pctRevenue: penalizedMid, pctRange,
      confidenceScore: 40, confidenceType: 'HEURISTIC',
    };
  }

  const absBase: Record<string, number> = {
    'M&A': 400, 'Capex/Expansion': 300, 'Demerger': 500,
    'Fund Raising': 250, 'Order Win': 150, 'Contract': 150,
    'JV/Partnership': 100, 'LOI': 75, 'Buyback': 150,
    'Dividend': 30, 'Guidance': 50, 'Mgmt Change': 0,
  };
  const absVal = Math.round((absBase[eventType] || 50) * magnitude * 0.7);

  return {
    valueCr: absVal, pctRevenue: adjustedMid * 0.7, pctRange,
    confidenceScore: 40, confidenceType: 'HEURISTIC',
  };
}

function classifyOrderType(subject: string, desc: string): string {
  const c = `${subject} ${desc}`.toLowerCase();
  if (c.includes('order win') || c.includes('order received') || c.includes('awarded') || c.includes('bagging')) return 'Order Win';
  if (c.includes('work order') || c.includes('purchase order')) return 'Order Win';
  if (c.includes('contract') && !c.includes('employment contract') && !c.includes('service contract for director')) return 'Contract';
  if (c.includes('letter of intent') || c.includes('loi')) return 'LOI';
  if (c.includes('capex') || c.includes('capital expenditure') || c.includes('expansion') || c.includes('new plant') || c.includes('new facility') || c.includes('capacity addition') || c.includes('greenfield') || c.includes('brownfield')) return 'Capex/Expansion';
  if ((c.includes('acquisition') || c.includes('merger') || c.includes('amalgamation') || c.includes('buyout')) &&
      !c.includes('acquisition of shares by') && !c.includes('esop')) return 'M&A';
  if (c.includes('demerger')) return 'Demerger';
  if (c.includes('joint venture') || c.includes('jv') || c.includes('partnership') || c.includes('collaboration') || c.includes('mou')) return 'JV/Partnership';
  if (c.includes('fund raising') || c.includes('qip') || c.includes('rights issue') || c.includes('preferential allotment')) return 'Fund Raising';
  if (c.includes('buyback')) return 'Buyback';
  if (c.includes('dividend')) return 'Dividend';
  if (c.includes('guidance') || c.includes('outlook') || c.includes('forecast')) return 'Guidance';
  if (c.includes('appointment') || c.includes('resignation') || c.includes('ceo') || c.includes('cfo') || c.includes('managing director')) return 'Mgmt Change';
  return 'Corporate';
}

function extractClient(text: string): string | null {
  const entities: [string, string][] = [
    ['NHAI', 'NHAI'], ['Indian Railways', 'Indian Railways'],
    ['Ministry of Defence', 'Min. of Defence'], ['NTPC', 'NTPC'],
    ['ONGC', 'ONGC'], ['IOCL', 'IOCL'], ['GAIL', 'GAIL'],
    ['HAL', 'HAL'], ['BEL', 'BEL'], ['BHEL', 'BHEL'],
    ['Coal India', 'Coal India'], ['Power Grid', 'Power Grid'],
    ['NHPC', 'NHPC'], ['SAIL', 'SAIL'], ['BPCL', 'BPCL'],
    ['Government', 'Govt'], ['Govt', 'Govt'],
  ];
  const lower = text.toLowerCase();
  for (const [keyword, label] of entities) {
    if (lower.includes(keyword.toLowerCase())) return label;
  }

  const m = text.match(/(?:from|by|with|awarded by|received from)\s+(?:M\/s\.?\s+)?([A-Z][A-Za-z &.()]+(?:Ltd|Limited|Corp|Inc))/);
  if (m) {
    const c = m[1].trim().replace(/[.,;:]+$/, '');
    if (c.length > 3 && c.length < 60) return c;
  }
  return null;
}

function extractSegment(text: string): string | null {
  const lower = text.toLowerCase();
  const map: [string[], string][] = [
    [['defence', 'defense', 'military', 'naval'], 'Defence'],
    [['railway', 'rail', 'metro'], 'Railways'],
    [['infrastructure', 'road', 'highway', 'bridge'], 'Infra'],
    [['power', 'energy', 'solar', 'wind', 'renewable', 'transmission'], 'Power'],
    [['water', 'sewage', 'irrigation'], 'Water'],
    [['oil', 'gas', 'petroleum', 'refinery'], 'Oil & Gas'],
    [['mining', 'coal', 'steel'], 'Metals'],
    [['telecom', '5g', 'fiber'], 'Telecom'],
    [['it ', 'software', 'digital', 'cloud'], 'IT'],
    [['pharma', 'drug', 'healthcare'], 'Pharma'],
    [['auto', 'vehicle', 'ev '], 'Auto'],
    [['chemical', 'specialty'], 'Chemicals'],
    [['cement', 'construction'], 'Construction'],
    [['textile', 'garment'], 'Textiles'],
    [['real estate', 'housing'], 'Realty'],
  ];
  for (const [keywords, segment] of map) {
    if (keywords.some(k => lower.includes(k))) return segment;
  }
  return null;
}

function extractTimeline(text: string): string | null {
  const m1 = text.match(/(\d+)\s*(?:months?|yrs?|years?)/i);
  if (m1) {
    const n = parseInt(m1[1]);
    if (/year/i.test(m1[0])) return `${n}Y`;
    return `${n}M`;
  }
  if (/multi.?year/i.test(text)) return 'Multi-yr';
  return null;
}

// ==================== ECONOMIC IMPACT ENGINE ====================

function classifyImpactLevel(impactPct: number): ImpactLevel {
  if (impactPct >= 5) return 'HIGH';
  if (impactPct >= 2) return 'MEDIUM';
  return 'LOW';
}

// ==================== FORCE ACTION ENGINE ====================

function classifyAction(
  impactPct: number,
  sentiment: SignalSentiment,
  isWatchlist: boolean,
  isPortfolio: boolean,
  earningsScore: number | null,
  weightedScore: number = 0,
  isNegative: boolean = false,
  signalCount: number = 1,
  guidanceStrong: boolean = false,
  fundamentalScore: number = 50,  // 3-axis fundamental score for veto logic
  revenueGrowth: number | null = null,  // NEW
  marginChange: number | null = null,    // NEW
): ActionFlag {
  // ── CRITICAL OVERRIDE: Insolvency, defaults, regulatory action → EXIT ──
  if (isNegative && impactPct >= 10) return 'EXIT';

  // ── EXIT: only portfolio stocks with severe negative signals ──
  if (isPortfolio && weightedScore < 25 && isNegative) return 'EXIT';

  // ── TRIM: ONLY for portfolio stocks with multiple negative conditions ──
  if (isPortfolio && weightedScore < 45 && isNegative && sentiment === 'Bearish') return 'TRIM';
  if (isPortfolio && weightedScore < 45 && isNegative && earningsScore !== null && earningsScore < 40) return 'TRIM';

  // ── ISSUE 1: REVENUE COLLAPSE OVERRIDE (>25% decline forces EXIT/AVOID) ──
  // Revenue collapse is a dominant Tier 1 variable — overrides all bullish signals
  if (revenueGrowth !== null && revenueGrowth < -25) {
    if (isPortfolio) return 'EXIT';
    return 'AVOID';
  }

  // ── FUNDAMENTAL VETO: declining fundamentals cap at ADD ──
  const fundamentalWeak = fundamentalScore < 40;

  // ── ISSUE 4: MARGIN-REVENUE CONSTRAINT ──
  // Revenue decline > 15% requires margin expansion > 2x decline magnitude to allow ADD
  const revDeclineSevere = revenueGrowth !== null && revenueGrowth < -15;
  const marginOffsets = marginChange !== null && marginChange > 0 && Math.abs(marginChange) > 2 * Math.abs(revenueGrowth || 0) / 100;
  const revenueVeto = revDeclineSevere && !marginOffsets;

  // ── BUY: score >= 62 with confirmation AND no fundamental veto AND no revenue collapse ──
  if (!fundamentalWeak && !revenueVeto) {
    if (weightedScore >= 62 && signalCount >= 2 && !isNegative) return 'BUY';
    if (weightedScore >= 62 && sentiment === 'Bullish' && !isNegative) return 'BUY';
    if (guidanceStrong && earningsScore !== null && earningsScore >= 70 && !isNegative) return 'BUY';
  }

  // ── ADD: 52-61 score range ──
  // Extended veto: fundamentalWeak OR revenueVeto blocks ADD → cap at HOLD
  if ((fundamentalWeak || revenueVeto) && !isNegative && weightedScore >= 52) return 'HOLD';
  if (weightedScore >= 52 && !isNegative) return 'ADD';
  if (guidanceStrong && sentiment === 'Bullish' && !isNegative && weightedScore >= 45) return 'ADD';

  // ── HOLD: 38-51 score range ──
  if (weightedScore >= 38 && weightedScore < 52) return 'HOLD';

  // ── WATCH: 28-37 score range ──
  if (weightedScore >= 28 && weightedScore < 38) return 'WATCH';

  // ── Below 28: insufficient signal quality ──
  if (!isNegative && sentiment !== 'Bearish' && weightedScore >= 20) return 'WATCH';
  return 'AVOID';
}

// ==================== TIME DECAY ====================

function computeTimeWeight(dateStr: string, eventType?: string): number {
  try {
    let d: Date;
    if (dateStr.includes('-') && dateStr.length === 10 && dateStr[2] === '-') {
      const [dd, mm, yyyy] = dateStr.split('-');
      d = new Date(`${yyyy}-${mm}-${dd}`);
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return 0.5;
    const daysOld = Math.max(0, (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
    // Use signal-type-specific half-life instead of fixed 7-day decay
    const halfLife = (eventType && SIGNAL_HALF_LIFE[eventType]) || 7;
    const decayRate = Math.LN2 / halfLife; // ln(2)/halfLife
    return Math.max(0.05, parseFloat(Math.exp(-decayRate * daysOld).toFixed(3)));
  } catch {
    return 0.5;
  }
}

function computeFreshness(dateStr: string): FreshnessLabel {
  try {
    let d: Date;
    if (dateStr.includes('-') && dateStr.length === 10 && dateStr[2] === '-') {
      const [dd, mm, yyyy] = dateStr.split('-');
      d = new Date(`${yyyy}-${mm}-${dd}`);
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return 'STALE';
    const daysOld = Math.max(0, (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
    if (daysOld <= 3) return 'FRESH';
    if (daysOld <= 7) return 'RECENT';
    if (daysOld <= 14) return 'AGING';
    return 'STALE';
  } catch {
    return 'STALE';
  }
}

function classifyScore(score: number): ScoreClassification {
  if (score > 80) return 'HIGH_CONVICTION';
  if (score >= 60) return 'STRONG';
  if (score >= 40) return 'BUILDING';
  if (score >= 20) return 'WEAK';
  return 'NOISE';
}

// ==================== WHY IT MATTERS ====================

function generateWhyItMatters(opts: {
  eventType: string;
  impactLevel: ImpactLevel;
  pctRevenue: number | null;
  pctMcap: number | null;
  valueCr: number | null;
  client: string | null;
  segment: string | null;
  isNegative: boolean;
  sentiment: SignalSentiment;
  buyerSeller: string | null;
  premiumDiscount: number | null;
}): string {
  const { eventType, impactLevel, pctRevenue, pctMcap, valueCr, client, segment, isNegative, sentiment, buyerSeller, premiumDiscount } = opts;

  // ── SUNSHINE SECTORS: Strategic India themes ──
  const SUNSHINE_SECTORS = new Set(['Defence', 'EV', 'Solar', 'Semiconductor', 'Railways', 'Infra', 'Electronics', 'PLI', 'Renewables', 'Nuclear', 'Space', 'Data Center', 'Logistics']);
  const isSunshineSector = segment && SUNSHINE_SECTORS.has(segment);

  if (isNegative) {
    if (eventType.includes('cancellation') || eventType.includes('terminated')) return 'Revenue loss risk — check order book concentration';
    if (eventType.includes('pledge') || eventType.includes('Promoter')) return 'Promoter stress signal — watch for forced selling pressure';
    if (eventType.includes('downgrade')) return 'Credit deterioration — higher cost of capital, margin pressure';
    if (eventType.includes('loss')) return 'Profitability under stress — assess if temporary or structural';
    if (eventType.includes('audit') || eventType.includes('fraud')) return 'Governance red flag — potential restatement risk';
    if (eventType.includes('resignation')) return 'Key person risk — continuity and strategy execution at risk';
    return 'Negative development — monitor for further deterioration';
  }

  if (eventType === 'Order Win' || eventType === 'Contract' || eventType === 'LOI') {
    if (pctRevenue !== null && pctRevenue >= 5) return `${pctRevenue.toFixed(0)}% of revenue — material order, direct top-line accretion`;
    if (pctRevenue !== null && pctRevenue >= 1) return `Meaningful order at ${pctRevenue.toFixed(1)}% of revenue — revenue visibility improves`;
    if (client && /global|international|export|us\b|europe|gcc|uae|germany|france|japan/i.test(client)) {
      return `Export/global order from ${client} — global scalability signal, FX revenue hedge`;
    }
    if (client) return `New order from ${client} — client diversification + execution track record`;
    if (isSunshineSector) return `Govt order in ${segment} — strategic India chokepoint, long-cycle stable margins`;
    if (segment === 'Defence' || segment === 'Railways') return `Govt order in ${segment} — long cycle, stable margin profile`;
    return 'New order win — improves revenue pipeline visibility';
  }

  if (eventType === 'Capex/Expansion') {
    if (isSunshineSector) return `Capacity build in strategic ${segment} sector — PLI/policy tailwind, operating leverage on ramp`;
    if (pctMcap !== null && pctMcap >= 10) return `Transformative capex at ${pctMcap.toFixed(1)}% MCap — high operating leverage on utilization ramp`;
    if (pctMcap !== null && pctMcap >= 5) return `Large capex at ${pctMcap.toFixed(1)}% of MCap — operating leverage play, watch execution`;
    return 'Capacity expansion — forward revenue visibility, watch ROI timeline';
  }

  if (eventType === 'M&A') {
    if (pctRevenue !== null && pctRevenue >= 20) return 'Transformative acquisition — rollup strategy, fragmented industry consolidation play';
    if (pctRevenue !== null && pctRevenue >= 10) return 'Material acquisition — changes revenue mix; check for synergy vs integration risk';
    if (pctMcap !== null && pctMcap >= 5) return `M&A at ${pctMcap.toFixed(1)}% MCap — accretive if integration succeeds; watch for category leadership`;
    return 'Strategic acquisition — improves market position or technology capability';
  }

  if (eventType === 'Demerger' || eventType === 'Spinoff') {
    return 'Value unlock via demerger — separate listing likely re-rates individual businesses; sum-of-parts > whole';
  }

  if (eventType === 'Open Offer' || eventType === 'Takeover') {
    if (pctMcap !== null && pctMcap >= 0) return 'Open offer / takeover — mandatory at premium to market; creates floor price, exit opportunity';
    return 'Open offer triggered — acquirer conviction signal, price floor established';
  }

  if (eventType === 'Fund Raising' || eventType === 'QIP') return 'Capital raise — balance sheet strengthening fuels next growth phase; watch dilution impact';
  if (eventType === 'Rights Issue') return 'Rights issue — promoter-led capital raise at discount; signals near-term growth plans';
  if (eventType === 'Buyback') return 'Buyback at premium — management conviction in undervaluation, reduces float, EPS-accretive';
  if (eventType === 'Dividend') return 'Cash dividend — signals strong FCF generation and board confidence in earnings visibility';

  if (eventType === 'JV/Partnership') {
    if (client && /global|international|export|us\b|europe|japan|korea/i.test(client)) {
      return `Global JV with ${client} — technology access + international market entry platform`;
    }
    return 'Strategic partnership — technology, market access, or platform transition play';
  }

  if (eventType === 'Guidance') {
    if (sentiment === 'Bullish') return 'Management raised guidance — earnings upgrade cycle potential; institutional buy trigger';
    if (sentiment === 'Bearish') return 'Guidance cut — earnings downgrade risk; assess if temporary headwind or structural';
    return 'Management outlook update — forward visibility signal, watch earnings revision trend';
  }

  if (eventType === 'Earnings') {
    return sentiment === 'Bullish' ? 'Beat on earnings — operating leverage kicking in; potential re-rating catalyst' :
           sentiment === 'Bearish' ? 'Earnings miss — margin pressure or volume weakness; assess recovery timeline' :
           'Earnings in line — stability signal; watch guidance for next quarter';
  }

  if (eventType === 'Turnaround') {
    return 'Post-loss recovery — operating metrics improving; watch for consecutive profitable quarters as re-rating trigger';
  }

  if (eventType === 'Policy Opening' || eventType === 'Regulatory Approval') {
    return `Policy/regulatory tailwind — addressable market expands; first-mover advantage in newly opened sector`;
  }

  if (eventType === 'Technology Transition') {
    return 'Platform/technology upgrade — unit economics improve at scale; incumbent moat strengthens';
  }

  if (eventType === 'Mgmt Change') return 'Leadership transition — watch for strategy continuity';
  if (eventType === 'CEO Change' || eventType === 'CFO Change' || eventType === 'MD Change') {
    return `${eventType} — key decision-maker change; monitor for strategy shift, guidance revision`;
  }

  if (eventType.includes('Block Buy') || eventType.includes('Bulk Buy')) {
    if (buyerSeller && /mutual fund|fii|institutional|foreign/i.test(buyerSeller)) return 'Institutional accumulation — smart money building position; supply absorption signal';
    if (premiumDiscount !== null && premiumDiscount > 3) return `Premium block at +${premiumDiscount.toFixed(1)}% — strong buyer conviction, directional signal`;
    return 'Block/bulk buying — institutional interest building, watch follow-through';
  }

  if (eventType.includes('Block Sell') || eventType.includes('Bulk Sell')) {
    if (premiumDiscount !== null && premiumDiscount < -3) return `Steep discount exit at ${premiumDiscount.toFixed(1)}% — urgency to exit, supply overhang risk`;
    return 'Institutional selling — check if portfolio rebalancing or conviction change';
  }

  return impactLevel === 'HIGH' ? 'High impact corporate event — direct business impact expected' :
         impactLevel === 'MEDIUM' ? 'Moderate impact — worth tracking for pattern development' :
         'Low impact — informational only';
}

// ==================== NEGATIVE SIGNAL DETECTION ====================

function isNegativeSignal(subject: string, desc: string): boolean {
  const combined = `${subject} ${desc}`.toLowerCase();
  return NEGATIVE_KEYWORDS.some(kw => combined.includes(kw));
}

function classifySentiment(eventType: string, isNegative: boolean, isBuyDeal: boolean): SignalSentiment {
  if (isNegative) return 'Bearish';
  const bullishEvents = [
    'Order Win', 'Contract', 'LOI', 'Capex/Expansion', 'Buyback', 'Guidance',
    'M&A', 'Demerger', 'Spinoff', 'Fund Raising', 'JV/Partnership',
    'Open Offer', 'Takeover', 'Turnaround',
    'Policy Opening', 'Regulatory Approval', 'Technology Transition',
  ];
  if (bullishEvents.includes(eventType)) return 'Bullish';
  if (eventType.includes('Buy')) return isBuyDeal ? 'Bullish' : 'Neutral';
  if (eventType.includes('Sell')) return 'Bearish';
  return 'Neutral';
}

// ==================== QUANT SCORE ENGINE ====================

const SIGNAL_TYPE_WEIGHTS: Record<string, number> = {
  'Open Offer': 18, 'Takeover': 18,         // Hard price floor
  'Turnaround': 16,                           // Biggest re-rating
  'Order Win': 14, 'Contract': 14, 'M&A': 13, 'Capex/Expansion': 15,
  'Demerger': 14, 'Spinoff': 14, 'Fund Raising': 10, 'LOI': 8, 'JV/Partnership': 9,
  'Policy Opening': 12, 'Regulatory Approval': 11, 'Technology Transition': 10,
  'Buyback': 10, 'Rights Issue': 8, 'Dividend': 6, 'Guidance': 8, 'Mgmt Change': 5,
  'Block Buy': 11, 'Bulk Buy': 10, 'Block Sell': 11, 'Bulk Sell': 10,
  'Corporate': 4,
};

const SECTOR_MULTIPLIER: Record<string, number> = {
  // Strategic India sunshine sectors — boosted multipliers
  'Defence': 1.3, 'Railways': 1.25, 'Solar': 1.25, 'EV': 1.2, 'Semiconductor': 1.25,
  'Electronics': 1.2, 'PLI': 1.2, 'Renewables': 1.2, 'Nuclear': 1.2, 'Space': 1.2,
  'Data Center': 1.15, 'Logistics': 1.1,
  // Core infrastructure
  'Infra': 1.2, 'Power': 1.15,
  'Construction': 1.1, 'Metals': 1.1, 'Oil & Gas': 1.1, 'Chemicals': 1.05,
  'Auto': 1.0, 'Pharma': 0.95, 'Realty': 1.0, 'Telecom': 0.9,
  'IT': 0.8, 'FMCG': 0.7, 'Textiles': 0.9,
};

// ── SIGNAL HIERARCHY TIERS ──
// Tier 1 (dominant): revenue, demand, order backlog
// Tier 2 (modifier): margin, capex, M&A
// Tier 3 (weak): mgmt commentary, guidance narrative, minor events
const SIGNAL_TIER_HIERARCHY: Record<string, 1 | 2 | 3> = {
  'Order Win': 1, 'Contract': 1,
  'M&A': 2, 'Capex/Expansion': 2, 'Demerger': 2, 'Fund Raising': 2,
  'LOI': 3, 'JV/Partnership': 2, 'Buyback': 3, 'Dividend': 3,
  'Guidance': 3, 'Mgmt Change': 3,
  'Block Buy': 2, 'Bulk Buy': 2, 'Block Sell': 2, 'Bulk Sell': 2,
  'Corporate': 3,
};

// ── SIGNAL HALF-LIFE (days) — different decay per event type ──
const SIGNAL_HALF_LIFE: Record<string, number> = {
  'Order Win': 14, 'Contract': 14,
  'M&A': 30, 'Capex/Expansion': 30, 'Demerger': 21,
  'Fund Raising': 14, 'LOI': 7, 'JV/Partnership': 14,
  'Buyback': 10, 'Dividend': 5, 'Guidance': 5, 'Mgmt Change': 7,
  'Block Buy': 7, 'Bulk Buy': 7, 'Block Sell': 7, 'Bulk Sell': 7,
  'Corporate': 5,
};

// ── CATALYST STRENGTH classification ──
// HARD RULE: <5% impact can NEVER be STRONG (prevents false conviction)
function classifyCatalystStrength(impactPct: number, pctMcap: number | null): 'WEAK' | 'MODERATE' | 'STRONG' {
  const mcapImpact = pctMcap || 0;
  // Hard cap: if BOTH revenue impact <5% AND mcap impact <5% → cannot be STRONG
  if (impactPct < 5 && mcapImpact < 5) {
    return (impactPct >= 3 || mcapImpact >= 1) ? 'MODERATE' : 'WEAK';
  }
  if (impactPct >= 10 || mcapImpact >= 10) return 'STRONG';
  if (impactPct >= 5 || mcapImpact >= 5) return 'MODERATE';
  return 'WEAK';
}

// ══════════════════════════════════════════════════════════════
// ── 4-TIER EVIDENCE HIERARCHY (HARD GATE) ──
// Tier A (PRIMARY VERIFIED): Exchange filing + exact/aggregated value → BUY/ADD/TRIM/EXIT
// Tier B (SECONDARY VERIFIED): Reputed media, exchange + heuristic → HOLD/WATCH-ACTIVE
// Tier C (INFERRED): NLP extraction without explicit confirmation → Monitor only, NEVER BUY/EXIT/HOLD
// Tier D (TEMPLATE/LOW CONF): Repeated patterns, missing source, conf<50 → AUTO-SUPPRESS
// ══════════════════════════════════════════════════════════════
function classifyEvidenceTier(
  confidenceType: string, valueSource: string, dataSource?: string,
  confidenceScore?: number, isHeuristicSuppressed?: boolean
): 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D' {
  // Tier D: template patterns or very low confidence → auto-suppress
  if (isHeuristicSuppressed) return 'TIER_D';
  if (confidenceScore !== undefined && confidenceScore < 50 && confidenceType === 'HEURISTIC') return 'TIER_D';

  const isExchange = dataSource === 'nse' || dataSource === 'NSE';
  const isGuidance = dataSource === 'Guidance';

  // Tier A: Exchange filing with ACTUAL confidence and EXACT/AGGREGATED value
  if (confidenceType === 'ACTUAL' && (valueSource === 'EXACT' || valueSource === 'AGGREGATED')) {
    return 'TIER_A';
  }
  if (isExchange && confidenceType === 'ACTUAL') return 'TIER_A';
  if (isGuidance && confidenceType === 'ACTUAL') return 'TIER_A';

  // Tier B: Exchange source with heuristic value, or reputed media
  if (isExchange) return 'TIER_B';
  if (isGuidance) return 'TIER_B';
  if (dataSource === 'moneycontrol' || dataSource === 'Moneycontrol') return 'TIER_B';
  if (confidenceType === 'INFERRED') return 'TIER_B';

  // Tier C: Pure heuristic / NLP inference without source confirmation
  return 'TIER_C';
}

// ══════════════════════════════════════════════════════════════
// ── TEMPLATE DETECTION ENGINE ──
// Rule-based filter to detect heuristic contamination
// ══════════════════════════════════════════════════════════════

interface TemplateDetectionResult {
  isTemplate: boolean;
  pattern?: string;
  identicalPct: boolean;
  missingSource: boolean;
  confidence: number; // Reduced confidence
}

function detectTemplatePatterns(
  signals: IntelSignal[],
): Map<string, TemplateDetectionResult> {
  const results = new Map<string, TemplateDetectionResult>();

  // Rule 1: Repetition Check — same value across 5+ unrelated companies
  const valueCountMap = new Map<number, string[]>();
  for (const s of signals) {
    if (s.valueCr > 0 && s.valueSource === 'HEURISTIC') {
      const key = Math.round(s.valueCr);
      if (!valueCountMap.has(key)) valueCountMap.set(key, []);
      valueCountMap.get(key)!.push(s.symbol);
    }
  }

  // Rule 2: Identical % Impact across companies
  const pctCountMap = new Map<string, string[]>();
  for (const s of signals) {
    if (s.valueSource === 'HEURISTIC' && s.impactPct > 0) {
      const pctKey = s.impactPct.toFixed(1);
      if (!pctCountMap.has(pctKey)) pctCountMap.set(pctKey, []);
      pctCountMap.get(pctKey)!.push(s.symbol);
    }
  }

  for (const s of signals) {
    const sigKey = `${s.symbol}:${s.eventType}:${s.date}`;
    const result: TemplateDetectionResult = {
      isTemplate: false,
      identicalPct: false,
      missingSource: false,
      confidence: s.confidenceScore,
    };

    // Rule 1 check
    if (s.valueSource === 'HEURISTIC' && s.valueCr > 0) {
      const roundedVal = Math.round(s.valueCr);
      const syms = valueCountMap.get(roundedVal) || [];
      if (syms.length >= 5) {
        result.isTemplate = true;
        result.pattern = `₹${roundedVal}Cr×${syms.length} companies`;
        result.confidence = Math.min(result.confidence, 20);
      }
    }

    // Rule 2 check
    if (s.valueSource === 'HEURISTIC' && s.impactPct > 0) {
      const pctKey = s.impactPct.toFixed(1);
      const syms = pctCountMap.get(pctKey) || [];
      if (syms.length >= 5) {
        result.identicalPct = true;
        result.confidence = Math.min(result.confidence, 25);
      }
    }

    // Rule 3: Missing Source — no URL or filing reference
    if (!s.sourceUrl && s.valueSource === 'HEURISTIC') {
      result.missingSource = true;
      // Only downgrade if combined with other issues
      if (result.isTemplate || result.identicalPct) {
        result.confidence = Math.min(result.confidence, 15);
      }
    }

    if (result.isTemplate || result.identicalPct) {
      results.set(sigKey, result);
    }
  }

  return results;
}

// ══════════════════════════════════════════════════════════════
// ── GUIDANCE VALIDATION ENGINE ──
// Catches QoQ vs YoY misreads, segment vs total confusion, extreme values
// ══════════════════════════════════════════════════════════════

interface GuidanceValidation {
  valid: boolean;
  anomalyType?: string;
  adjustedAction?: ActionFlag;
  reason?: string;
}

function validateGuidance(
  revenueGrowth: number | null,
  marginChange: number | null,
  previousGrowth: number | null, // from earnings cache
  confidenceScore: number,
  headline: string,
): GuidanceValidation {
  // Rule 1: Extreme Threshold — revenue change > ±30% requires second confirmation
  if (revenueGrowth !== null && Math.abs(revenueGrowth) > 30) {
    // Check for QoQ/segment context words
    const lower = headline.toLowerCase();
    const hasQoQ = /quarter|qoq|q-o-q|sequential/.test(lower);
    const hasSegment = /segment|division|vertical|product line/.test(lower);
    const hasTemporary = /temporary|one-time|one time|exceptional|extraordinary/.test(lower);

    if (hasQoQ || hasSegment || hasTemporary) {
      return {
        valid: false,
        anomalyType: hasQoQ ? 'QOQ_MISREAD' : hasSegment ? 'SEGMENT_NOT_TOTAL' : 'TEMPORARY_ADJUSTMENT',
        adjustedAction: 'WATCH',
        reason: `Extreme ${revenueGrowth > 0 ? '+' : ''}${revenueGrowth?.toFixed(0)}% likely ${hasQoQ ? 'QoQ not YoY' : hasSegment ? 'segment-specific' : 'temporary'} — needs verification`,
      };
    }

    // Rule 3: Consistency Check — compare with last reported growth
    if (previousGrowth !== null) {
      const delta = Math.abs((revenueGrowth || 0) - previousGrowth);
      // If previous was +20% and now parsed as -47%, that's a 67% swing — highly suspicious
      if (delta > 40 && previousGrowth > 0 && (revenueGrowth || 0) < -20) {
        return {
          valid: false,
          anomalyType: 'INCONSISTENT_WITH_HISTORY',
          adjustedAction: 'WATCH',
          reason: `Parsed ${revenueGrowth?.toFixed(0)}% conflicts with prior ${previousGrowth.toFixed(0)}% — anomaly detected`,
        };
      }
    }

    // Even if no context, flag extreme values for review
    return {
      valid: true,
      anomalyType: 'EXTREME_UNVERIFIED',
      reason: `${revenueGrowth > 0 ? '+' : ''}${revenueGrowth?.toFixed(0)}% is extreme — verify with second source`,
    };
  }

  return { valid: true };
}

// ══════════════════════════════════════════════════════════════
// ── v4: GUIDANCE SCOPE & PERIOD EXTRACTION ──
// Detects whether guidance applies to company-wide or segment/product
// ══════════════════════════════════════════════════════════════

function extractGuidanceScope(headline: string): 'COMPANY' | 'SEGMENT' | 'PRODUCT' | 'REGION' | 'UNKNOWN' {
  const lower = headline.toLowerCase();
  if (/\b(segment|division|vertical|business unit|biz unit)\b/.test(lower)) return 'SEGMENT';
  if (/\b(product line|product category|sku|brand)\b/.test(lower)) return 'PRODUCT';
  if (/\b(region|geography|domestic|international|export|india|overseas)\b/.test(lower)) return 'REGION';
  if (/\b(company|consolidated|overall|group|entity|firm-wide|company-wide|total revenue)\b/.test(lower)) return 'COMPANY';
  // If no explicit scope markers, check if it mentions specific sub-units
  if (/\b(smartphone|handset|ev |electric vehicle|solar|wind|pharma api|formulation)\b/.test(lower)) return 'SEGMENT';
  return 'UNKNOWN';
}

function extractGuidancePeriod(headline: string): 'FY' | 'Q' | 'RUN_RATE' | 'UNKNOWN' {
  const lower = headline.toLowerCase();
  if (/\b(fy\d{2}|fy \d{2}|full year|annual|yearly)\b/.test(lower)) return 'FY';
  if (/\b(q[1-4]|quarter|qoq|q-o-q|sequential|quarterly)\b/.test(lower)) return 'Q';
  if (/\b(run.?rate|annualized|trailing)\b/.test(lower)) return 'RUN_RATE';
  return 'UNKNOWN';
}

// ══════════════════════════════════════════════════════════════
// ── v4: GUIDANCE SANITY BOUND (CRITICAL RULE) ──
// IF abs(revenue_change) > 30% AND source != explicit company-wide guidance
// THEN: dataQuality = BROKEN, action = FORCE_WATCH, suppress % display
// ══════════════════════════════════════════════════════════════

function applyGuidanceSanityBound(
  revenueGrowth: number | null,
  scope: 'COMPANY' | 'SEGMENT' | 'PRODUCT' | 'REGION' | 'UNKNOWN',
  period: 'FY' | 'Q' | 'RUN_RATE' | 'UNKNOWN',
  confidenceScore: number,
): { dataQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'BROKEN'; forceWatch: boolean; reason?: string } {
  if (revenueGrowth === null) return { dataQuality: 'MEDIUM', forceWatch: false };

  const absGrowth = Math.abs(revenueGrowth);

  // v5 Rule 0: UNKNOWN scope + numeric delta = DISCARD (don't compute %)
  if (scope === 'UNKNOWN' && revenueGrowth !== null && Math.abs(revenueGrowth) > 5) {
    return {
      dataQuality: 'BROKEN',
      forceWatch: true,
      reason: `scope=UNKNOWN with ${revenueGrowth > 0 ? '+' : ''}${revenueGrowth.toFixed(0)}% delta — period unknown, cannot validate`,
    };
  }

  // Rule 1: Extreme + not company-wide = BROKEN
  if (absGrowth > 30 && scope !== 'COMPANY') {
    return {
      dataQuality: 'BROKEN',
      forceWatch: true,
      reason: `Extreme ${revenueGrowth > 0 ? '+' : ''}${revenueGrowth.toFixed(0)}% with scope=${scope} — likely segment/QoQ misread`,
    };
  }

  // Rule 2: Extreme + QoQ period = BROKEN (QoQ numbers misread as YoY)
  if (absGrowth > 30 && period === 'Q') {
    return {
      dataQuality: 'BROKEN',
      forceWatch: true,
      reason: `Extreme ${revenueGrowth > 0 ? '+' : ''}${revenueGrowth.toFixed(0)}% with period=Q — likely QoQ not YoY`,
    };
  }

  // Rule 3: Extreme + low confidence = BROKEN
  if (absGrowth > 30 && confidenceScore < 65) {
    return {
      dataQuality: 'BROKEN',
      forceWatch: true,
      reason: `Extreme ${revenueGrowth > 0 ? '+' : ''}${revenueGrowth.toFixed(0)}% with low confidence (${confidenceScore}) — unverifiable`,
    };
  }

  // Rule 4: Moderate extreme with company scope = LOW (flag but don't break)
  if (absGrowth > 30 && scope === 'COMPANY') {
    return {
      dataQuality: 'LOW',
      forceWatch: false,
      reason: `Company-wide ${revenueGrowth > 0 ? '+' : ''}${revenueGrowth.toFixed(0)}% — extreme but scoped correctly`,
    };
  }

  // Normal bounds
  if (absGrowth <= 15 && confidenceScore >= 70) return { dataQuality: 'HIGH', forceWatch: false };
  if (absGrowth <= 30) return { dataQuality: 'MEDIUM', forceWatch: false };
  return { dataQuality: 'LOW', forceWatch: false };
}

// ══════════════════════════════════════════════════════════════
// ── v4: RANGE-AWARE PARSING ──
// Uses midpoint of range + applies confidence penalty for wide ranges
// ══════════════════════════════════════════════════════════════

function parseGuidanceRange(headline: string): { low: number | null; high: number | null; midpoint: number | null; widthPct: number } {
  // Match patterns like "4000-4100 Cr", "₹4,000 - ₹4,100 crore", "4000 to 4100"
  const rangeMatch = headline.match(/(?:₹|Rs\.?\s*)?(\d[\d,.]*)\s*(?:[-–—]|to)\s*(?:₹|Rs\.?\s*)?(\d[\d,.]*)\s*(?:Cr|crore|cr)/i);
  if (rangeMatch) {
    const low = parseFloat(rangeMatch[1].replace(/,/g, ''));
    const high = parseFloat(rangeMatch[2].replace(/,/g, ''));
    if (low > 0 && high > 0 && high >= low) {
      const midpoint = (low + high) / 2;
      const widthPct = ((high - low) / midpoint) * 100;
      return { low, high, midpoint, widthPct };
    }
  }

  // Match % range patterns like "15-20% growth", "mid-teens"
  const pctRangeMatch = headline.match(/(\d+)\s*(?:[-–—]|to)\s*(\d+)\s*%/);
  if (pctRangeMatch) {
    const low = parseFloat(pctRangeMatch[1]);
    const high = parseFloat(pctRangeMatch[2]);
    if (low >= 0 && high >= low) {
      const midpoint = (low + high) / 2;
      const widthPct = high > 0 ? ((high - low) / ((low + high) / 2)) * 100 : 0;
      return { low, high, midpoint, widthPct };
    }
  }

  return { low: null, high: null, midpoint: null, widthPct: 0 };
}

function computeRangeConfidencePenalty(widthPct: number): number {
  // Wide range = low confidence. >10% width = penalty
  if (widthPct <= 5) return 1.0;   // Tight range, no penalty
  if (widthPct <= 10) return 0.9;  // Moderate range
  if (widthPct <= 20) return 0.75; // Wide range
  if (widthPct <= 50) return 0.5;  // Very wide
  return 0.3;                       // Extremely wide — near useless
}

// ══════════════════════════════════════════════════════════════
// ── v4: SOURCE/DATA QUALITY CLASSIFICATION (orthogonal) ──
// sourceTier: Was the document real? (VERIFIED / HEURISTIC / INFERRED)
// dataQuality: Was the number parsed correctly? (HIGH / MEDIUM / LOW / BROKEN)
// ══════════════════════════════════════════════════════════════

function classifySourceTier(
  confidenceType: string, valueSource: string, dataSource?: string
): 'VERIFIED' | 'HEURISTIC' | 'INFERRED' {
  if (confidenceType === 'ACTUAL' && (valueSource === 'EXACT' || valueSource === 'AGGREGATED')) return 'VERIFIED';
  const isExchange = dataSource === 'nse' || dataSource === 'NSE';
  const isGuidance = dataSource === 'Guidance';
  if (isExchange || isGuidance) return 'VERIFIED';
  if (dataSource === 'moneycontrol' || dataSource === 'Moneycontrol') return 'VERIFIED';
  if (confidenceType === 'INFERRED') return 'INFERRED';
  return 'HEURISTIC';
}

function classifyDataQuality(
  confidenceType: string, valueSource: string, confidenceScore: number,
  impactPct: number, isTemplateDetected: boolean, guidanceAnomalyFlag?: string
): 'HIGH' | 'MEDIUM' | 'LOW' | 'BROKEN' {
  if (isTemplateDetected) return 'BROKEN';
  if (guidanceAnomalyFlag === 'EXTREME_UNVERIFIED' || guidanceAnomalyFlag === 'INCONSISTENT_WITH_HISTORY') return 'BROKEN';
  if (guidanceAnomalyFlag === 'QOQ_MISREAD' || guidanceAnomalyFlag === 'SEGMENT_NOT_TOTAL') return 'BROKEN';
  if (confidenceType === 'ACTUAL' && (valueSource === 'EXACT' || valueSource === 'AGGREGATED')) return 'HIGH';
  if (confidenceScore >= 70 && impactPct <= 30) return 'MEDIUM';
  if (confidenceType === 'HEURISTIC' && impactPct > 20) return 'LOW';
  if (confidenceScore < 50) return 'LOW';
  return 'MEDIUM';
}

// ══════════════════════════════════════════════════════════════
// ── v4: ACTION SCORE FOR TOP ACTIONABLE RANKING ──
// actionScore = signalScore × evidenceWeight × dataQualityWeight
// Hard Rule: Top Actionable must contain ≥50% VERIFIED signals
// ══════════════════════════════════════════════════════════════

const EVIDENCE_WEIGHTS: Record<string, number> = {
  'VERIFIED': 1.0,
  'HEURISTIC': 0.6,
  'INFERRED': 0.3,
};

const DATA_QUALITY_WEIGHTS: Record<string, number> = {
  'HIGH': 1.0,
  'MEDIUM': 0.7,
  'LOW': 0.5,
  'BROKEN': 0.1,
};

function computeActionScore(
  weightedScore: number,
  sourceTier: 'VERIFIED' | 'HEURISTIC' | 'INFERRED',
  dataQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'BROKEN',
): number {
  const evidenceW = EVIDENCE_WEIGHTS[sourceTier] || 0.3;
  const dqW = DATA_QUALITY_WEIGHTS[dataQuality] || 0.5;
  return Math.round(weightedScore * evidenceW * dqW);
}

// ══════════════════════════════════════════════════════════════
// ── v4: SOURCE SENTENCE QUALITY CHECK ──
// Enforce minimum 8-word source extraction
// ══════════════════════════════════════════════════════════════

function extractSourceSentence(desc: string, headline: string): { sentence: string; quality: 'HIGH' | 'MEDIUM' | 'LOW' } {
  // Try to find a meaningful sentence from description
  const sentences = (desc || '').split(/[.!?;]+/).map(s => s.trim()).filter(s => s.length > 10);

  // Find the most informative sentence (contains numbers or guidance keywords)
  const guidanceKeywords = /\b(guidance|outlook|expects?|target|forecast|growth|revenue|margin|capex|order|contract|acquisition)\b/i;
  let best = sentences.find(s => guidanceKeywords.test(s) && s.split(/\s+/).length >= 8);
  if (!best) best = sentences.find(s => s.split(/\s+/).length >= 8);
  if (!best) best = sentences[0] || '';

  const wordCount = best.split(/\s+/).filter(w => w.length > 0).length;

  if (wordCount >= 12) return { sentence: best.slice(0, 200), quality: 'HIGH' };
  if (wordCount >= 8) return { sentence: best.slice(0, 200), quality: 'MEDIUM' };

  // Fallback: use headline if desc is too short
  const hlWords = (headline || '').split(/\s+/).filter(w => w.length > 0).length;
  if (hlWords >= 8) return { sentence: headline.slice(0, 200), quality: 'MEDIUM' };

  return { sentence: best.slice(0, 120) || headline.slice(0, 120), quality: 'LOW' };
}

// ══════════════════════════════════════════════════════════════
// ── v4: UPSTREAM TEMPLATE BATCH DETECTION ──
// Kill template signals BEFORE compute (not just mask after)
// IF multiple companies share same value ±1% AND same % impact ±0.2% AND same timestamp window
// THEN mark as TEMPLATE_BATCH → drop before signal processing
// ══════════════════════════════════════════════════════════════

function detectUpstreamTemplateBatch(
  items: Array<{ symbol: string; valueCr: number; impactPct: number; date: string; valueSource: string }>
): Set<string> {
  const dropSet = new Set<string>();

  // Group by approximate value (within 1%)
  const valueGroups = new Map<number, typeof items>();
  for (const item of items) {
    if (item.valueSource !== 'HEURISTIC' || item.valueCr <= 0) continue;
    const bucket = Math.round(item.valueCr); // Round to nearest integer
    let found = false;
    for (const [key, group] of valueGroups) {
      if (Math.abs(key - bucket) / Math.max(key, 1) <= 0.01) {
        group.push(item);
        found = true;
        break;
      }
    }
    if (!found) valueGroups.set(bucket, [item]);
  }

  for (const [val, group] of valueGroups) {
    if (group.length < 5) continue; // Need 5+ companies for template detection

    // Check if % impacts are also similar (±0.2%)
    const impacts = group.map(g => g.impactPct);
    const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length;
    const similarImpact = impacts.filter(i => Math.abs(i - avgImpact) <= 0.2).length;

    if (similarImpact >= 4) {
      // Template batch detected — mark all for dropping
      for (const item of group) {
        dropSet.add(`${item.symbol}:${Math.round(item.valueCr)}`);
      }
    }
  }

  return dropSet;
}

// ══════════════════════════════════════════════════════════════
// ── NET SIGNAL MODEL (Conflict Resolution v2) ──
// Formula: Net Score = Σ (Signal Score × Weight × Confidence × Freshness)
// ══════════════════════════════════════════════════════════════

const CONFLICT_WEIGHTS: Record<string, number> = {
  'Guidance': 1.0,
  'Order Win': 0.6, 'Contract': 0.6,
  'M&A': 0.7, 'Capex/Expansion': 0.5,
  'Demerger': 0.5, 'Fund Raising': 0.4,
  'JV/Partnership': 0.4, 'LOI': 0.3,
  'Buyback': 0.3, 'Dividend': 0.2,
  'Block Buy': 0.4, 'Bulk Buy': 0.3,
  'Block Sell': 0.4, 'Bulk Sell': 0.3,
  'Mgmt Change': 0.2, 'Corporate': 0.1,
};

function computeNetSignalScore(signals: IntelSignal[]): number {
  let totalWeighted = 0;
  let totalWeight = 0;

  for (const s of signals) {
    const typeWeight = CONFLICT_WEIGHTS[s.eventType] || 0.2;
    const confFactor = (s.confidenceScore || 50) / 100;
    const freshnessWeight = s.freshness === 'FRESH' ? 1.0 : s.freshness === 'RECENT' ? 0.8 : s.freshness === 'AGING' ? 0.5 : 0.3;
    const directionSign = s.isNegative ? -1 : 1;
    const heuristicPenalty = s.valueSource === 'HEURISTIC' ? 0.2 : 1.0;

    const weight = typeWeight * confFactor * freshnessWeight * heuristicPenalty;
    totalWeighted += (s.weightedScore || 0) * directionSign * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : 0;
}

// ── TIME HORIZON classification ──
// Based on event type: earnings/guidance = SHORT, capex/M&A = LONG, orders = MEDIUM
function classifyTimeHorizon(eventType: string): 'SHORT' | 'MEDIUM' | 'LONG' {
  const shortTerm = ['Guidance', 'Dividend', 'Buyback', 'Block Buy', 'Bulk Buy', 'Block Sell', 'Bulk Sell'];
  const longTerm = ['Capex/Expansion', 'M&A', 'Demerger', 'JV/Partnership', 'Fund Raising'];
  if (shortTerm.includes(eventType)) return 'SHORT';
  if (longTerm.includes(eventType)) return 'LONG';
  return 'MEDIUM'; // Order Win, Contract, Corporate, Mgmt Change, LOI
}

// ── EXTREME VALUE DETECTOR ──
// Flags suspicious data: >50% decline cluster, revenue swings that look like parsing errors
function detectExtremeValue(revenueGrowth: number | null, impactPct: number): string | undefined {
  if (revenueGrowth !== null && revenueGrowth < -50) {
    return `EXTREME_DECLINE_${Math.round(revenueGrowth)}%: verify QoQ vs YoY vs segment`;
  }
  if (revenueGrowth !== null && revenueGrowth > 200) {
    return `EXTREME_GROWTH_${Math.round(revenueGrowth)}%: verify base period`;
  }
  if (impactPct > 50) {
    return `EXTREME_IMPACT_${impactPct.toFixed(0)}%: likely data error`;
  }
  return undefined;
}

// ══════════════════════════════════════════════════════════════
// ── FINAL: 3-LAYER VALIDATION GATE ──
// LAYER A: Ingest (raw data, no decisions)
// LAYER B: Validation Gate (strict filter — pass or DROP)
// LAYER C: Decision Engine (only clean input)
//
// VALID EVENT = source_exists AND period_classified AND
//               number_origin==EXPLICIT AND no_template_pattern
// If ANY fail → DROP completely (not observe, not watch, not downgrade)
// ══════════════════════════════════════════════════════════════

type SignalDisposition = 'ACTIONABLE' | 'MONITOR' | 'REJECTED';

function validateSignal(signal: IntelSignal): {
  disposition: SignalDisposition;
  rejectReason?: string;
  isInferred: boolean;
  isMaterial: boolean;
  monitorScore: number;
} {
  // ── LAYER B: Validation Gate ──

  // Check 1: Source exists and is real
  const sourceExists = (
    signal.confidenceType === 'ACTUAL' ||
    signal.sourceTier === 'VERIFIED' ||
    signal.dataSource === 'nse' || signal.dataSource === 'NSE' ||
    signal.source === 'deal'
  );
  if (!sourceExists) {
    return { disposition: 'REJECTED', rejectReason: 'source_not_verified', isInferred: true, isMaterial: false, monitorScore: 0 };
  }

  // Check 2: No template pattern (only hard-reject on actual template pattern string)
  // heuristicSuppressed/identicalPctFlag degrade to MONITOR, not hard reject
  const hasTemplate = !!signal.templatePattern;
  const isHeuristicDegraded = !!signal.heuristicSuppressed || !!signal.identicalPctFlag;
  if (hasTemplate) {
    return { disposition: 'REJECTED', rejectReason: 'template_pattern_detected', isInferred: true, isMaterial: false, monitorScore: 0 };
  }

  // Check 3: Data quality not BROKEN
  if (signal.dataQuality === 'BROKEN') {
    return { disposition: 'REJECTED', rejectReason: 'data_quality_broken', isInferred: true, isMaterial: false, monitorScore: 0 };
  }

  // Check 4: No extreme anomaly
  if (signal.guidanceAnomalyFlag === 'EXTREME_UNVERIFIED' ||
      signal.guidanceAnomalyFlag === 'INCONSISTENT_WITH_HISTORY' ||
      signal.guidanceAnomalyFlag === 'QOQ_MISREAD' ||
      signal.guidanceAnomalyFlag === 'SEGMENT_NOT_TOTAL') {
    return { disposition: 'REJECTED', rejectReason: 'guidance_anomaly', isInferred: true, isMaterial: false, monitorScore: 0 };
  }

  // Check 5: Number origin — is the value EXPLICIT or INFERRED?
  const isInferred = (
    signal.confidenceType === 'HEURISTIC' ||
    signal.confidenceType === 'INFERRED' ||
    signal.valueSource === 'HEURISTIC' ||
    signal.inferenceUsed === true
  );

  // Check 6: Period classified (for guidance signals)
  const isGuidance = signal.eventType === 'Guidance' || (signal.headline || '').toLowerCase().includes('guidance');
  const periodClassified = !isGuidance || (
    signal.guidanceScope !== undefined && signal.guidanceScope !== 'UNKNOWN' &&
    signal.guidancePeriod !== undefined && signal.guidancePeriod !== 'UNKNOWN'
  );

  if (isGuidance && !periodClassified) {
    return { disposition: 'REJECTED', rejectReason: 'period_not_classified', isInferred, isMaterial: false, monitorScore: 0 };
  }

  // ── LAYER C: Materiality Check ──
  // Material if: revenue impact >5% confirmed, OR explicit guidance, OR material order/contract, OR margin change quantified
  const revImpact = Math.abs(signal.impactPct || 0);
  const hasExplicitGuidance = isGuidance && periodClassified && !isInferred;
  const hasMaterialOrder = (signal.eventType === 'Order Win' || signal.eventType === 'Contract') && revImpact > 5 && !isInferred;
  const hasMaterialDeal = signal.source === 'deal' && signal.valueCr > 0;
  const hasQuantifiedImpact = revImpact > 5 && signal.confidenceType === 'ACTUAL';

  const isMaterial = hasExplicitGuidance || hasMaterialOrder || hasMaterialDeal || hasQuantifiedImpact;

  // If value is inferred AND not material AND source not verified → REJECTED
  // Source-verified inferred signals become MONITOR with sanitized values
  if (isInferred && !isMaterial && !sourceExists) {
    return { disposition: 'REJECTED', rejectReason: 'inferred_non_material', isInferred, isMaterial: false, monitorScore: 0 };
  }

  // ── MONITOR SCORE (0-100) ──
  // Source credibility (0-30)
  const srcScore = signal.confidenceType === 'ACTUAL' ? 30 :
    signal.sourceTier === 'VERIFIED' ? 25 :
    (signal.dataSource === 'nse' || signal.dataSource === 'NSE') ? 20 :
    signal.source === 'deal' ? 20 : 10;

  // Event completeness (0-25)
  const hasValidEventType = ['Order Win', 'Contract', 'Capex/Expansion', 'Guidance', 'Mgmt Change', 'Acquisition', 'Block Deal', 'Bulk Deal', 'Stake Sale'].includes(signal.eventType || '');
  const hasHeadline = !!(signal.headline && signal.headline.length > 10);
  const hasWhyItMatters = !!(signal.whyItMatters && signal.whyItMatters.length > 20);
  const eventScore = (hasValidEventType ? 12 : 0) + (hasHeadline ? 7 : 0) + (hasWhyItMatters ? 6 : 0);

  // Numeric certainty (0-20)
  const numScore = !isInferred ? 20 :
    (signal.valueSource === 'AGGREGATED' ? 12 :
     signal.valueSource === 'HEURISTIC' ? 5 : 8);

  // Materiality hint (0-15)
  const matScore = isMaterial ? 15 :
    (revImpact > 3 ? 10 : revImpact > 1 ? 5 : 0);

  // Recency (0-10)
  const signalAge = signal.freshness === 'FRESH' ? 10 :
    signal.freshness === 'RECENT' ? 7 :
    signal.freshness === 'AGING' ? 3 : 1;

  const monitorScore = Math.min(100, srcScore + eventScore + numScore + matScore + signalAge);

  // ── DISPOSITION ──
  // Heuristic-degraded signals forced to MONITOR regardless of materiality
  if (isMaterial && !isInferred && !isHeuristicDegraded) {
    return { disposition: 'ACTIONABLE', isInferred: false, isMaterial: true, monitorScore: 100 };
  }

  if (isMaterial && isInferred) {
    // Material but inferred → MONITOR (show event type, hide numbers)
    return { disposition: 'MONITOR', isInferred: true, isMaterial: true, monitorScore };
  }

  // Source verified, not template, not broken, but not material → MONITOR
  // This includes: inferred but source-verified, and non-inferred non-material
  return { disposition: 'MONITOR', isInferred, isMaterial: false, monitorScore };
}

// FINAL: Strip inferred numbers from display — Zero Inference Policy
function sanitizeForDisplay(signal: IntelSignal, isInferred: boolean): void {
  if (isInferred) {
    // Don't show precise numbers for inferred values
    signal.whyItMatters = signal.whyItMatters?.replace(/₹[\d,.]+\s*(?:Cr|crore|cr)/gi, '[UNVERIFIED AMOUNT]')
      .replace(/\d+\.?\d*%\s*(?:impact|revenue|of revenue|of mcap)/gi, '[UNVERIFIED %]') || '';
    // Keep the event type visible but mark amounts as unverified
    if (signal.inferenceUsed) {
      signal.headline = signal.headline?.replace(/₹[\d,.]+\s*(?:Cr|crore|cr)/gi, '[UNVERIFIED]') || signal.headline;
    }
  }
}

// v5: Map old action labels to new severity-based labels
function mapActionToV5(action: ActionFlag, verified: boolean, dataQuality?: string): ActionFlag {
  if (!verified || dataQuality === 'BROKEN') return 'WATCH'; // MONITOR mapped to WATCH for compat
  // Keep EXIT and TRIM as-is (high severity)
  if (action === 'EXIT') return 'EXIT';
  if (action === 'TRIM') return 'TRIM';
  // HOLD stays HOLD
  if (action === 'HOLD') return 'HOLD';
  // BUY/ADD → HOLD (downgrade: we don't issue BUY in strict mode without full validation chain)
  if (action === 'BUY' || action === 'ADD') return 'HOLD';
  // WATCH/AVOID stay
  return action;
}

function computeScore(opts: {
  impactPct: number;
  sentiment: SignalSentiment;
  timeWeight: number;
  earningsScore: number | null;
  isNegative: boolean;
  isDeal: boolean;
  eventType: string;
  confidenceScore: number;
  buyerQuality?: number;
  dealPremiumDiscount?: number | null;
  sector?: string | null;
}): number {
  // Source weight mapping
  const sourceWeightMap: Record<string, number> = {
    'exchange': 1.0,
    'guidance': 0.9,
    'verified_media': 0.7,
    'rumor': 0.3,
  };

  // Confidence value mapping
  const confidenceMap = (type: string): number => {
    if (type === 'ACTUAL') return 1.0;
    if (type === 'ESTIMATED') return 0.6;
    if (type === 'LOW') return 0.4;
    return 0.5;
  };

  let score = 0;

  // ── Formula: Total Score = Σ (Magnitude × Confidence × Time Weight × Source Weight) ──
  // Magnitude (impact)
  const impactScore = Math.min(40, 40 * (1 - Math.exp(-opts.impactPct / 10)));

  // Confidence (from opts.confidenceScore, which is 0-100)
  const confFactor = opts.confidenceScore / 100;

  // Time weight (decay)
  const timeDecay = opts.timeWeight;

  // Source weight (default to 1.0 for exchange/internal)
  const sourceWeight = 1.0;

  // Base score from impact × confidence × timeWeight × source
  score = impactScore * confFactor * timeDecay * sourceWeight;

  // Event type weighting
  score += Math.min(15, (SIGNAL_TYPE_WEIGHTS[opts.eventType] || 5) * confFactor);

  // Sentiment adjustment
  score += opts.sentiment === 'Bullish' ? 5 : opts.sentiment === 'Bearish' ? -3 : 0;

  // Earnings boost
  if (opts.earningsScore !== null) {
    if (opts.earningsScore >= 70) score += 8;
    else if (opts.earningsScore >= 50) score += 4;
    else if (opts.earningsScore < 40) { score -= 10; }
  }

  // Negative signal boost
  if (opts.isNegative) score += 5;

  // Deal-specific adjustments
  if (opts.isDeal) {
    if (opts.buyerQuality && opts.buyerQuality >= 80) score += 4;
    if (opts.dealPremiumDiscount !== undefined && opts.dealPremiumDiscount !== null && opts.dealPremiumDiscount > 3) score += 2;
  }

  // Sector multiplier
  if (opts.sector) {
    const sectorKey = opts.sector.split(' ')[0];
    const mult = SECTOR_MULTIPLIER[sectorKey] || 1.0;
    score *= mult;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ==================== 3-AXIS NORMALIZED SCORE ENGINE ====================

function computeThreeAxisScore(opts: {
  impactPct: number;
  revenueGrowth: number | null;
  marginChange: number | null;
  epsGrowth: number | null;
  eventType: string;
  sentiment: SignalSentiment;
  timeWeight: number;
  signalCount: number;
  confidenceScore: number;
  confidenceType: 'ACTUAL' | 'INFERRED' | 'HEURISTIC';
  valueSource: 'EXACT' | 'AGGREGATED' | 'HEURISTIC';
  isNegative: boolean;
  sector: string | null;
  earningsScore: number | null;
  isCapex: boolean;
}): { fundamental: number; signalStrength: number; dataConfidence: number; composite: number } {
  // ── Axis 1: Fundamental Delta Score (0-100) ──
  // Measures actual business metric changes
  let fundamental = 50; // neutral baseline
  if (opts.revenueGrowth !== null) {
    if (opts.revenueGrowth >= 20) fundamental += 25;
    else if (opts.revenueGrowth >= 10) fundamental += 15;
    else if (opts.revenueGrowth >= 0) fundamental += 5;
    else if (opts.revenueGrowth >= -10) fundamental -= 10;
    else fundamental -= 20;
  }
  if (opts.marginChange !== null) {
    const mPct = opts.marginChange / 100; // bps to %
    if (mPct >= 2) fundamental += 15;
    else if (mPct >= 0) fundamental += 5;
    else if (mPct >= -2) fundamental -= 5;
    else fundamental -= 15;
  }
  if (opts.epsGrowth !== null) {
    if (opts.epsGrowth >= 20) fundamental += 10;
    else if (opts.epsGrowth >= 0) fundamental += 3;
    else fundamental -= 10;
  }
  if (opts.earningsScore !== null) {
    if (opts.earningsScore >= 70) fundamental += 8;
    else if (opts.earningsScore >= 50) fundamental += 3;
    else if (opts.earningsScore < 40) fundamental -= 8;
  }
  // Capex = leading indicator bonus
  if (opts.isCapex && opts.impactPct >= 5) fundamental += 12;
  else if (opts.isCapex && opts.impactPct >= 2) fundamental += 6;
  fundamental = Math.max(0, Math.min(100, Math.round(fundamental)));

  // ── Axis 2: Signal Strength Score (0-100) ──
  // Measures the quality/magnitude of the signal itself
  // Baseline 15: every valid signal has inherent strength (existence = information)
  let strength = 15;
  // Impact magnitude (capped at 30)
  strength += Math.min(30, 30 * (1 - Math.exp(-opts.impactPct / 8)));
  // Event type weight (capped at 20)
  const typeWeight = SIGNAL_TYPE_WEIGHTS[opts.eventType] || 5;
  strength += Math.min(20, typeWeight * 1.4);
  // Sentiment (up to ±10)
  strength += opts.sentiment === 'Bullish' ? 10 : opts.sentiment === 'Bearish' ? -5 : 0;
  // Time decay
  strength *= Math.max(0.3, opts.timeWeight);
  // Sector multiplier
  if (opts.sector) {
    const sKey = opts.sector.split(' ')[0];
    const mult = SECTOR_MULTIPLIER[sKey] || 1.0;
    strength *= mult;
  }
  // Signal stacking bonus
  if (opts.signalCount >= 3) strength += 15;
  else if (opts.signalCount >= 2) strength += 8;
  // Negative signals are still "strong" signals
  if (opts.isNegative) strength += 5;
  // Capex leading indicator boost
  if (opts.isCapex) strength += 10;
  strength = Math.max(0, Math.min(100, Math.round(strength)));

  // ── Axis 3: Data Confidence Score (0-100) ──
  // Measures source reliability
  let dataConf = opts.confidenceScore;
  // Source quality adjustments
  if (opts.confidenceType === 'ACTUAL' && opts.valueSource === 'EXACT') {
    dataConf = Math.max(dataConf, 85);
  } else if (opts.confidenceType === 'ACTUAL') {
    dataConf = Math.max(dataConf, 75);
  } else if (opts.confidenceType === 'INFERRED') {
    dataConf = Math.min(Math.max(dataConf, 50), 75);
  } else {
    dataConf = Math.min(dataConf, 55);
  }
  // Penalize high impact claims with low confidence
  if (opts.impactPct > 20 && opts.confidenceType === 'HEURISTIC') {
    dataConf = Math.round(dataConf * 0.7);
  }
  dataConf = Math.max(0, Math.min(100, Math.round(dataConf)));

  // ── Composite Score (weighted average, 0-100) ──
  // Weights: Fundamental 40%, Signal Strength 35%, Data Confidence 25%
  const composite = Math.round(0.40 * fundamental + 0.35 * strength + 0.25 * dataConf);

  return { fundamental, signalStrength: strength, dataConfidence: dataConf, composite };
}

// ==================== ENRICHMENT ====================

async function enrichSymbol(symbol: string): Promise<StockEnrichment> {
  // Normalize symbol first to ensure consistent lookups
  const normalizedSymbol = normalizeTicker(symbol);
  const result: StockEnrichment = {
    symbol: normalizedSymbol, mcapCr: null, annualRevenueCr: null, revenueSource: null,
    companyName: null, industry: null, lastPrice: null, issuedSize: null,
  };

  try {
    // Fetch stock quote using normalized symbol
    const quotePromise = fetchStockQuote(normalizedSymbol);
    const timeoutPromise = new Promise<null>(res => setTimeout(() => res(null), 2000));
    const quote = await Promise.race([quotePromise, timeoutPromise]);

    if (quote) {
      result.lastPrice = quote.priceInfo?.lastPrice || null;
      result.issuedSize = quote.securityInfo?.issuedSize || null;
      result.companyName = quote.info?.companyName || null;
      result.industry = quote.info?.industry || null;

      if (quote.priceInfo?.totalMarketCap) {
        result.mcapCr = quote.priceInfo.totalMarketCap / 10000000;
      } else if (result.lastPrice && result.issuedSize) {
        result.mcapCr = (result.lastPrice * result.issuedSize) / 10000000;
      }
    }

    // Fallback: try Redis cache if price is still missing
    if (!result.lastPrice) {
      try {
        const cachedPrice = await kvGet<number>(`price:${normalizedSymbol}`);
        if (cachedPrice) result.lastPrice = cachedPrice;
      } catch {}
    }

    const earnings = await kvGet<EarningsData>(`earnings:${normalizedSymbol}`);
    if (earnings) {
      if (earnings.quarters && Array.isArray(earnings.quarters) && earnings.quarters.length >= 4) {
        const ttmRev = earnings.quarters.slice(0, 4).reduce((s, q) => s + (q.revenue || 0), 0);
        if (ttmRev > 0) { result.annualRevenueCr = ttmRev; result.revenueSource = 'TTM'; }
      }
      if (!result.annualRevenueCr && earnings.annualRevenue && earnings.annualRevenue > 0) {
        result.annualRevenueCr = earnings.annualRevenue; result.revenueSource = 'FY';
      }
      if (!result.annualRevenueCr && earnings.quarters && Array.isArray(earnings.quarters) && earnings.quarters.length > 0 && earnings.quarters.length < 4) {
        const partialRev = earnings.quarters.reduce((s, q) => s + (q.revenue || 0), 0);
        if (partialRev > 0) {
          result.annualRevenueCr = Math.round(partialRev * (4 / earnings.quarters.length));
          result.revenueSource = 'PARTIAL';
        }
      }
      if (!result.mcapCr && earnings.mcap) result.mcapCr = earnings.mcap;
    }
  } catch (e) {
    console.error(`[Compute] Enrich error ${normalizedSymbol}:`, e);
  }

  return result;
}

// ==================== BUYER QUALITY ====================

function scoreBuyerQuality(name: string): number {
  const l = name.toLowerCase();
  if (/\b(mutual fund|mf|amc|sbi mf|hdfc mf|icici pru|axis mf|kotak mf|nippon|dsp|uti)\b/.test(l)) return 90;
  if (/\b(fii|foreign|dii|institutional|blackrock|vanguard|goldman|morgan|jp morgan|citadel|capital group)\b/.test(l)) return 90;
  if (/\b(promoter|founder|director|chairman|managing)\b/.test(l)) return 85;
  if (/\b(insurance|lic|life insurance)\b/.test(l)) return 75;
  if (/\b(pvt|private|ltd|limited|capital|invest|fund|trust|advisors|wealth|asset)\b/.test(l)) return 60;
  return 40;
}

// ==================== MAIN COMPUTE HANDLER ====================

async function performComputeLogic(watchlist: string[], portfolio: string[]): Promise<IntelligenceResponse> {
  const startTime = Date.now();
  const watchlistSet = new Set(watchlist);
  const portfolioSet = new Set(portfolio);

  console.log(`[Compute] Starting: ${watchlist.length} watchlist, ${portfolio.length} portfolio`);

  const debug = {
    nseAnnouncements: 0,
    nseMaterial: 0,
    nseBlockDeals: 0,
    nseBulkDeals: 0,
    mcNewsItems: 0,
    mcMaterial: 0,
    googleNewsItems: 0,
    googleMaterial: 0,
    cachedSignals: 0,
    dataSources: [] as string[],
    errors: [] as string[],
    enrichedSymbols: 0,
    earningsCacheHits: 0,
    totalSignalsBeforeDedup: 0,
    totalSignalsAfterDedup: 0,
    signalsBySource: { nse: 0, moneycontrol: 0, google_news: 0, deal: 0 } as Record<string, number>,
  };

  const days = 90;
  const fromDate = getDateDaysAgo(days);
  const toDate = getTodayDate();
  const allTracked = [...new Set([...watchlist, ...portfolio])];

  // NSE + MC/Google run in parallel with aggressive 12s overall timeout for NSE
  // NSE India blocks Vercel IPs, so we must not waste time waiting
  const nsePromise = Promise.race([
    Promise.all([
      nseApiFetch(`/api/corporate-announcements?index=equities&from_date=${fromDate}&to_date=${toDate}`, 15000)
        .catch((e: any) => { debug.errors.push(`NSE announcements: ${(e as Error).message}`); return null; }),
      nseApiFetch('/api/block-deal', 15000)
        .catch((e: any) => { debug.errors.push(`NSE block deals: ${(e as Error).message}`); return null; }),
      nseApiFetch('/api/bulk-deal', 15000)
        .catch((e: any) => { debug.errors.push(`NSE bulk deals: ${(e as Error).message}`); return null; }),
    ]),
    new Promise<[null, null, null]>(res => setTimeout(() => {
      debug.errors.push('NSE: overall 12s timeout — skipped');
      res([null, null, null]);
    }, 12000)),
  ]);

  // Start MC/Google in parallel with NSE (don't wait for NSE to fail first)
  const mcGooglePromise = (allTracked.length > 0) ? Promise.all([
    fetchMoneycontrolNews(allTracked.slice(0, 5)).catch((e: any) => {
      debug.errors.push(`MC news: ${(e as Error).message}`);
      return [] as MCNewsItem[];
    }),
    fetchGoogleNewsRSS(allTracked.slice(0, 3)).catch((e: any) => {
      debug.errors.push(`Google news: ${(e as Error).message}`);
      return [] as MCNewsItem[];
    }),
  ]) : Promise.resolve([[] as MCNewsItem[], [] as MCNewsItem[]]);

  // Wait for both to complete
  const [[announcementsRaw, blockRaw, bulkRaw], [mcNews, gNews]] = await Promise.all([
    nsePromise,
    mcGooglePromise,
  ]);

  console.log(`[Compute] Phase 1 done in ${Date.now() - startTime}ms`);

  let announcements: any[] = [];
  if (announcementsRaw) {
    announcements = Array.isArray(announcementsRaw) ? announcementsRaw : (announcementsRaw?.data || []);
  }
  debug.nseAnnouncements = announcements.length;
  if (announcements.length > 0) debug.dataSources.push('NSE');

  const blockDeals = (Array.isArray(blockRaw) ? blockRaw : (blockRaw?.data || []))
    .map((d: any) => ({
      symbol: d.symbol || d.BD_SYMBOL || '',
      clientName: d.clientName || d.BD_CLIENT_NAME || '',
      quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
      tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
      buySell: (d.buySell || d.BD_BUY_SELL || '').trim(),
      dealDate: d.dealDate || d.BD_DT_DATE || '',
      type: 'Block' as const,
    }))
    .filter((d: any) => d.quantity > 0 && d.tradePrice > 0 && d.symbol);
  debug.nseBlockDeals = blockDeals.length;

  const bulkDeals = (Array.isArray(bulkRaw) ? bulkRaw : (bulkRaw?.data || []))
    .map((d: any) => ({
      symbol: d.symbol || d.BD_SYMBOL || '',
      clientName: d.clientName || d.BD_CLIENT_NAME || '',
      quantity: parseInt(d.quantity || d.BD_QTY_TRD || '0'),
      tradePrice: parseFloat(d.tradePrice || d.BD_TP_WATP || '0'),
      buySell: (d.buySell || d.BD_BUY_SELL || '').trim(),
      dealDate: d.dealDate || d.BD_DT_DATE || '',
      type: 'Bulk' as const,
    }))
    .filter((d: any) => d.quantity > 0 && d.tradePrice > 0 && d.symbol);
  debug.nseBulkDeals = bulkDeals.length;
  if (blockDeals.length + bulkDeals.length > 0) {
    if (!debug.dataSources.includes('NSE')) debug.dataSources.push('NSE Deals');
  }

  // MC/Google results already fetched in parallel
  let mcNewsAnnouncements: any[] = [];
  let googleNewsAnnouncements: any[] = [];

  debug.mcNewsItems = mcNews.length;
  debug.googleNewsItems = gNews.length;
  if (mcNews.length > 0 || gNews.length > 0) {
    console.log(`[Compute] Fallback sources: MC=${mcNews.length}, Google=${gNews.length}`);

    mcNewsAnnouncements = mcNews.map(n => ({
      symbol: n.symbol,
      companyName: n.companyName,
      subject: n.subject,
      desc: n.desc,
      date: n.date,
      _source: 'moneycontrol',
    }));

    googleNewsAnnouncements = gNews.map(n => ({
      symbol: n.symbol,
      companyName: n.companyName,
      subject: n.subject,
      desc: n.desc,
      date: n.date,
      _source: 'google_news',
    }));

    if (mcNews.length > 0) debug.dataSources.push('Moneycontrol');
    if (gNews.length > 0) debug.dataSources.push('Google News');
  }

  const allAnnouncements = [
    ...announcements.map(a => ({ ...a, _source: 'nse' })),
    ...mcNewsAnnouncements,
    ...googleNewsAnnouncements,
  ];

  // Filter announcements, then cap at 100 most recent to stay within 55s Vercel limit
  const filteredAnnAll = allAnnouncements.filter(item => {
    if (!item.symbol || (!item.desc && !item.subject)) return false;
    const combined = `${item.subject || ''} ${item.desc || ''}`.toLowerCase();
    if (NOISE_PATTERNS.some(p => combined.includes(p))) return false;
    return ORDER_KEYWORDS.some(k => combined.includes(k)) ||
           NEGATIVE_KEYWORDS.some(k => combined.includes(k));
  });
  // Sort by date descending and cap at 100 to avoid timeout
  const filteredAnn = filteredAnnAll
    .sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime())
    .slice(0, 100);
  if (filteredAnnAll.length > 100) {
    console.log(`[Compute] Capped announcements: ${filteredAnnAll.length} → 100 (most recent)`);
  }

  debug.nseMaterial = filteredAnn.filter(a => a._source === 'nse').length;
  debug.mcMaterial = filteredAnn.filter(a => a._source === 'moneycontrol').length;
  debug.googleMaterial = filteredAnn.filter(a => a._source === 'google_news').length;

  console.log(`[Compute] Sources: NSE=${debug.nseAnnouncements}→${debug.nseMaterial} | MC=${debug.mcNewsItems}→${debug.mcMaterial} | Google=${debug.googleNewsItems}→${debug.googleMaterial}`);

  const symbolsToEnrich = new Set<string>();
  portfolio.forEach(s => symbolsToEnrich.add(normalizeTicker(s)));
  watchlist.forEach(s => symbolsToEnrich.add(normalizeTicker(s)));
  [...blockDeals, ...bulkDeals].forEach(d => symbolsToEnrich.add(normalizeTicker(d.symbol)));
  filteredAnn.forEach(a => { if (symbolsToEnrich.size < 15) symbolsToEnrich.add(normalizeTicker(a.symbol)); });
  symbolsToEnrich.delete('');

  const enrichMap = new Map<string, StockEnrichment>();
  const symArr = Array.from(symbolsToEnrich).slice(0, 15); // Cap at 15 to save time
  let enrichPartial = false;
  const enrichBudget = 45000 - (Date.now() - startTime); // time left before 45s safety margin
  if (enrichBudget < 5000) {
    console.warn(`[Compute] Skipping enrichment — only ${enrichBudget}ms left`);
  }
  for (let i = 0; i < symArr.length && (Date.now() - startTime) < 40000; i += 10) {
    const batch = symArr.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map(symbol => {
        const normalizedSym = normalizeTicker(symbol);
        return Promise.race([
          enrichSymbol(normalizedSym),
          new Promise<StockEnrichment>(res => setTimeout(() => res({
            symbol: normalizedSym, mcapCr: null, annualRevenueCr: null, revenueSource: null,
            companyName: null, industry: null, lastPrice: null, issuedSize: null,
          }), 2000))
        ]);
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        enrichMap.set(r.value.symbol, r.value);
      } else {
        enrichPartial = true;
      }
    }
  }

  debug.enrichedSymbols = enrichMap.size;
  console.log(`[Compute] Enriched ${enrichMap.size} symbols`);

  // Build comprehensive company name map from ALL available data sources
  // This prevents 32+ signals from showing ticker as company name
  const companyNameMap = new Map<string, string>();
  // Source 1: enrichment data (most reliable — from NSE quote API)
  for (const [sym, data] of enrichMap) {
    if (data.companyName) companyNameMap.set(sym, data.companyName);
  }
  // Source 2: NSE announcement raw data (sm_name field)
  for (const ann of (filteredAnn || [])) {
    const sym = normalizeTicker(ann.symbol || '');
    if (sym && !companyNameMap.has(sym)) {
      const name = ann.sm_name || ann.companyName || ann.company_name || ann.smName || '';
      if (name && name !== sym) companyNameMap.set(sym, name);
    }
  }
  // Source 3: MC news items
  for (const n of mcNews) {
    const sym = normalizeTicker(n.symbol);
    if (sym && !companyNameMap.has(sym) && n.companyName && n.companyName !== sym) {
      companyNameMap.set(sym, n.companyName);
    }
  }
  // Source 4: Google news items
  for (const n of gNews) {
    const sym = normalizeTicker(n.symbol);
    if (sym && !companyNameMap.has(sym) && n.companyName && n.companyName !== sym) {
      companyNameMap.set(sym, n.companyName);
    }
  }
  // Helper to resolve company name with all available sources
  const resolveCompanyName = (symbol: string, ...fallbacks: (string | null | undefined)[]): string => {
    for (const fb of fallbacks) {
      if (fb && fb !== symbol && fb.length > 1) return fb;
    }
    return companyNameMap.get(symbol) || symbol;
  };
  console.log(`[Compute] Company name map: ${companyNameMap.size} entries`);

  const allSignals: IntelSignal[] = [];
  const crossSourceSeen = new Set<string>();
  const dedupMap = new Map<string, IntelSignal>();

  // Pre-fetch ALL earnings data for tracked + announcement symbols (avoids per-item Redis calls)
  const earningsDataCache = new Map<string, any>();
  const allSymbolsNeedingEarnings = new Set<string>();
  [...watchlist, ...portfolio].forEach(s => allSymbolsNeedingEarnings.add(s));
  filteredAnn.forEach(a => { if (a.symbol) allSymbolsNeedingEarnings.add(normalizeTicker(a.symbol)); });
  allSymbolsNeedingEarnings.delete('');

  // Batch fetch earnings from Redis (10 at a time)
  const earningsSymArr = Array.from(allSymbolsNeedingEarnings);
  for (let i = 0; i < earningsSymArr.length && (Date.now() - startTime) < 35000; i += 10) {
    const batch = earningsSymArr.slice(i, i + 10);
    await Promise.all(batch.map(async (sym) => {
      try {
        const ed = await kvGet<any>(`earnings:${sym}`);
        if (ed) earningsDataCache.set(sym, ed);
      } catch {}
    }));
  }
  console.log(`[Compute] Pre-fetched earnings for ${earningsDataCache.size}/${earningsSymArr.length} symbols in ${Date.now() - startTime}ms`);

  const earningsCache = new Map<string, number | null>();
  const allTrackedSymbols = [...new Set([...watchlist, ...portfolio])];
  // Compute earnings scores from pre-fetched data (no more Redis calls)
  for (const sym of allTrackedSymbols) {
    try {
      const ed = earningsDataCache.get(sym);
      if (ed?.quarters && Array.isArray(ed.quarters) && ed.quarters.length >= 2) {
        const q0 = ed.quarters[0];
        const q1 = ed.quarters.find((q: any) => {
          const m0 = q0.period?.split(' ')[0];
          const y0 = parseInt(q0.period?.split(' ')[1] || '0');
          const m1 = q.period?.split(' ')[0];
          const y1 = parseInt(q.period?.split(' ')[1] || '0');
          return m0 === m1 && y1 === y0 - 1;
        });
        if (q1 && q1.revenue > 0) {
          const revG = ((q0.revenue - q1.revenue) / q1.revenue) * 100;
          const patG = q1.pat !== 0 ? ((q0.pat - q1.pat) / Math.abs(q1.pat)) * 100 : 0;
          earningsCache.set(sym, Math.min(100, Math.max(0, 50 + (revG > 10 ? 15 : revG > 0 ? 5 : -10) + (patG > 15 ? 15 : patG > 0 ? 5 : -10))));
        } else {
          earningsCache.set(sym, null);
        }
      }
    } catch { earningsCache.set(sym, null); }
  }

  debug.earningsCacheHits = [...earningsCache.values()].filter(v => v !== null).length;

  for (const item of filteredAnn) {
    const subject = item.subject || '';
    const desc = item.desc || '';
    const symbol = normalizeTicker(item.symbol || '');
    if (!symbol) continue;

    const enrichment = enrichMap.get(symbol);
    const combinedText = `${subject} ${desc}`;
    const eventType = classifyOrderType(subject, desc);
    const client = extractClient(combinedText);
    const segment = extractSegment(combinedText) || (enrichment?.industry ? enrichment.industry.split(' ')[0] : null);
    const timeline = extractTimeline(combinedText);
    const isWatchlist = watchlistSet.has(symbol);
    const isPortfolio = portfolioSet.has(symbol);
    const negative = isNegativeSignal(subject, desc);
    const sentiment = classifySentiment(eventType, negative, false);

    let extractedValue = parseOrderValue(combinedText);
    let inferenceUsed = false;
    let confidenceScore = 90;
    let confidenceType: 'ACTUAL' | 'INFERRED' | 'HEURISTIC' = 'ACTUAL';

    let valueCr: number;
    let impactPct: number;

    const sectorRaw = enrichment?.industry || segment || null;
    const sector = sectorRaw ? sectorRaw.split(' ')[0] : null;

    let valueSource: 'EXACT' | 'AGGREGATED' | 'HEURISTIC' = 'HEURISTIC';

    if (extractedValue !== null && extractedValue > 0) {
      valueCr = extractedValue;
      valueSource = 'EXACT';
      if (enrichment?.annualRevenueCr && enrichment.annualRevenueCr > 0) {
        impactPct = parseFloat(((valueCr / enrichment.annualRevenueCr) * 100).toFixed(2));
        if (impactPct > 100) {
          impactPct = Math.min(impactPct, 100);
        }
        confidenceScore = 90;
        confidenceType = 'ACTUAL';
      } else {
        impactPct = valueCr >= 500 ? 8 : valueCr >= 200 ? 5 : valueCr >= 50 ? 2 : 1;
        confidenceScore = 70;
        confidenceType = 'INFERRED';
      }
    } else {
      inferenceUsed = true;
      confidenceScore = 50;
      confidenceType = 'HEURISTIC';

      let revenueCr = enrichment?.annualRevenueCr || null;
      if (!revenueCr) {
        try {
          const ed = earningsDataCache.get(symbol);
          if (ed?.quarters && Array.isArray(ed.quarters)) {
            revenueCr = ed.quarters.slice(0, 4).reduce((s: number, q: any) => s + (q.revenue || 0), 0);
            if (revenueCr && revenueCr > 0) {
              if (enrichment) enrichment.annualRevenueCr = revenueCr;
            }
          }
        } catch { /* best effort */ }
      }

      const inferred = inferEventValue(combinedText, revenueCr, eventType, negative, sector);
      valueCr = inferred.valueCr;
      impactPct = inferred.pctRevenue;
      confidenceScore = inferred.confidenceScore;
      confidenceType = inferred.confidenceType;
    }

    if (valueSource === 'HEURISTIC' && impactPct > 10) {
      confidenceScore = Math.round(confidenceScore * 0.6);
    }

    const impactLevel = classifyImpactLevel(impactPct);

    const earningsScore = earningsCache.get(symbol) ?? null;
    const earningsBoost = (earningsScore !== null && earningsScore >= 70 && sentiment !== 'Bearish' && impactPct >= 3);

    const timeWeight = computeTimeWeight(item.date || getTodayDate(), eventType);
    const score = computeScore({
      impactPct, sentiment, timeWeight,
      earningsScore, isNegative: negative, isDeal: false,
      eventType, confidenceScore, sector,
    });
    const weightedScore = Math.round(score * timeWeight);

    let action = classifyAction(impactPct, sentiment, isWatchlist, isPortfolio, earningsScore, weightedScore, negative, 1, false, 50, null, null);
    if (earningsBoost && action !== 'BUY') action = 'ADD';

    const pctMcap = (enrichment?.mcapCr && valueCr > 0)
      ? parseFloat(((valueCr / enrichment.mcapCr) * 100).toFixed(2))
      : null;

    const whyItMatters = generateWhyItMatters({
      eventType, impactLevel, pctRevenue: impactPct, pctMcap, valueCr,
      client, segment, isNegative: negative, sentiment, buyerSeller: null, premiumDiscount: null,
    });

    let headline = `${fmtCr(valueCr)} ${eventType}`;
    if (inferenceUsed) headline += ' (est.)';
    if (client) headline += ` from ${client}`;
    const matParts: string[] = [];
    matParts.push(`${Math.min(100, impactPct).toFixed(1)}% of revenue`);
    if (pctMcap !== null && pctMcap > 0) matParts.push(`${pctMcap.toFixed(1)}% MCap`);
    if (segment) matParts.push(segment);
    if (timeline) matParts.push(timeline);
    headline += ` — ${matParts.join(' · ')}`;
    const descSnippet = (desc || '').slice(0, 100).replace(/\s+/g, ' ').trim();
    if (descSnippet.length > 20) headline += `. ${descSnippet}`;

    const dateStr = (item.date || getTodayDate()).slice(0, 10);
    const crossKey = `${symbol}_${eventType}_${Math.round(valueCr)}_${dateStr}`;
    if (crossSourceSeen.has(crossKey)) continue;
    crossSourceSeen.add(crossKey);

    const dedupKey = `${symbol}:${eventType}:${dateStr}`;
    const existing = dedupMap.get(dedupKey);

    const itemSource = (item as any)._source;
    const dataSource = itemSource === 'moneycontrol' ? 'Moneycontrol' : itemSource === 'google_news' ? 'Google News' : 'NSE';

    let lastPrice = enrichment?.lastPrice || null;
    if (!lastPrice) {
      try {
        const cachedPrice = await kvGet<number>(`price:${symbol}`);
        if (cachedPrice) lastPrice = cachedPrice;
      } catch {}
    }

    const signal: IntelSignal = {
      symbol, company: resolveCompanyName(symbol, item.companyName, enrichment?.companyName),
      date: item.date || getTodayDate(), source: 'order',
      eventType, headline,
      valueCr, valueUsd: `$${((valueCr * 10000000) / INR_TO_USD / 1000000).toFixed(1)}M`,
      mcapCr: enrichment?.mcapCr || null, revenueCr: enrichment?.annualRevenueCr || null,
      impactPct: Math.min(100, impactPct), pctRevenue: Math.min(100, impactPct), pctMcap,
      inferenceUsed,
      client, segment, timeline,
      buyerSeller: null, premiumDiscount: null, lastPrice,
      impactLevel, impactConfidence: confidenceScore >= 90 ? 'HIGH' : confidenceScore >= 70 ? 'MEDIUM' : 'LOW',
      confidenceScore, confidenceType,
      valueSource,
      action, score, timeWeight, weightedScore, sentiment, whyItMatters,
      isNegative: negative, earningsBoost, isWatchlist, isPortfolio,
      dataSource,
      freshness: computeFreshness(item.date || getTodayDate()),
      scoreClassification: classifyScore(weightedScore),
      decision: action,
    };

    // Add catalyst strength
    signal.catalystStrength = classifyCatalystStrength(impactPct, pctMcap);

    // Compute 3-axis normalized scores
    const threeAxis = computeThreeAxisScore({
      impactPct: Math.min(100, impactPct), revenueGrowth: null, marginChange: null, epsGrowth: null,
      eventType, sentiment, timeWeight, signalCount: 1,
      confidenceScore, confidenceType, valueSource, isNegative: negative,
      sector, earningsScore, isCapex: eventType === 'Capex/Expansion',
    });
    signal.fundamentalScore = threeAxis.fundamental;
    signal.signalStrengthScore = threeAxis.signalStrength;
    signal.dataConfidenceScore = threeAxis.dataConfidence;
    // Use composite as the new normalized weightedScore
    signal.weightedScore = threeAxis.composite;
    signal.score = threeAxis.composite;
    // Re-classify action using 3-axis composite (critical: old score was pre-normalization)
    signal.action = classifyAction(impactPct, sentiment, isWatchlist, isPortfolio, earningsScore, threeAxis.composite, negative, 1, false, threeAxis.fundamental, null, null);
    if (earningsBoost && signal.action !== 'BUY') signal.action = 'ADD';
    signal.decision = signal.action;
    signal.scoreClassification = classifyScore(threeAxis.composite);
    // Institutional fields: signal tier, provenance
    signal.signalTier = (confidenceType === 'ACTUAL' && valueSource !== 'HEURISTIC') ? 'TIER1_VERIFIED' : 'TIER2_INFERRED';
    signal.sourceUrl = item.url || null;

    // Production-grade fields (v2) — initial classification (may be updated by template detection)
    signal.evidenceTier = classifyEvidenceTier(confidenceType, valueSource, dataSource, confidenceScore, false);
    signal.timeHorizon = classifyTimeHorizon(eventType);
    signal.extremeValueFlag = detectExtremeValue(null, impactPct);
    // v4: Source sentence extraction (upgraded — min 8 words)
    const srcExtraction = extractSourceSentence(desc || '', signal.headline);
    signal.sourceExtract = srcExtraction.sentence || undefined;
    // If source extraction is LOW quality, downgrade data confidence
    if (srcExtraction.quality === 'LOW' && signal.confidenceType === 'HEURISTIC') {
      signal.confidenceScore = Math.min(signal.confidenceScore, 45);
    }

    // v4: Orthogonal axes — sourceTier + dataQuality
    signal.sourceTier = classifySourceTier(confidenceType, valueSource, dataSource);
    signal.dataQuality = classifyDataQuality(
      confidenceType, valueSource, signal.confidenceScore, impactPct, false
    );
    // v4: Scope/period (for non-guidance signals: COMPANY by default)
    signal.guidanceScope = 'COMPANY';
    signal.guidancePeriod = 'UNKNOWN';
    // v4: Action score for ranking
    signal.actionScore = computeActionScore(signal.weightedScore, signal.sourceTier, signal.dataQuality);

    if (existing) {
      const existDate = new Date(existing.date).getTime();
      const newDate = new Date(signal.date).getTime();
      const daysDiff = Math.abs(existDate - newDate) / (1000 * 60 * 60 * 24);

      if (daysDiff <= 3 && valueSource === 'EXACT' && existing.valueSource === 'EXACT') {
        existing.valueCr += signal.valueCr;
        existing.valueSource = 'AGGREGATED';
        if (enrichment?.annualRevenueCr && enrichment.annualRevenueCr > 0) {
          existing.impactPct = parseFloat(((existing.valueCr / enrichment.annualRevenueCr) * 100).toFixed(2));
          existing.pctRevenue = existing.impactPct;
        }
        existing.impactLevel = classifyImpactLevel(existing.impactPct);
        existing.headline = `${fmtCr(existing.valueCr)} ${eventType} (aggregated)`;
        if (existing.impactPct > 0) existing.headline += ` — ${existing.impactPct.toFixed(1)}% of revenue`;
      } else if (weightedScore > existing.weightedScore) {
        if (existing.valueCr > signal.valueCr) {
          signal.valueCr = existing.valueCr;
        }
        dedupMap.set(dedupKey, signal);
      }
    } else {
      dedupMap.set(dedupKey, signal);
    }
  }

  allSignals.push(...dedupMap.values());

  const dealDedupMap = new Map<string, IntelSignal>();

  for (const deal of [...blockDeals, ...bulkDeals]) {
    const symbol = normalizeTicker(deal.symbol);
    if (!symbol) continue;

    const enrichment = enrichMap.get(symbol);
    const isBuy = deal.buySell.toLowerCase().includes('buy');
    const dealValueCr = Math.max(0.01, Math.round((deal.quantity * deal.tradePrice) / 10000000 * 100) / 100);
    const cmp = enrichment?.lastPrice || null;
    const premiumDiscount = cmp && deal.tradePrice
      ? Math.round(((deal.tradePrice - cmp) / cmp) * 10000) / 100
      : null;
    const pctEquity = enrichment?.issuedSize
      ? Math.round((deal.quantity / enrichment.issuedSize) * 10000) / 100
      : null;

    const eventType = `${deal.type} ${isBuy ? 'Buy' : 'Sell'}`;
    const buyerQual = scoreBuyerQuality(deal.clientName);
    const isWatchlist = watchlistSet.has(symbol);
    const isPortfolio = portfolioSet.has(symbol);
    const isSell = !isBuy;
    const sentiment = classifySentiment(eventType, isSell && buyerQual >= 80, isBuy);
    const dealEventType = deal.type === 'Block' ? 'Block Buy' : 'Bulk Buy';
    const timeWeight = computeTimeWeight(deal.dealDate || getTodayDate(), dealEventType);

    let dealImpactPct: number;
    if (enrichment?.annualRevenueCr && enrichment.annualRevenueCr > 0) {
      dealImpactPct = parseFloat(((dealValueCr / enrichment.annualRevenueCr) * 100).toFixed(2));
    } else if (enrichment?.mcapCr && enrichment.mcapCr > 0) {
      dealImpactPct = parseFloat(((dealValueCr / enrichment.mcapCr) * 100).toFixed(2));
    } else {
      dealImpactPct = dealValueCr >= 100 ? 5 : dealValueCr >= 20 ? 3 : dealValueCr >= 5 ? 2 : 1;
    }

    if (buyerQual >= 80) dealImpactPct = Math.max(dealImpactPct, 4);

    const impactLevel = classifyImpactLevel(dealImpactPct);
    const earningsScore = earningsCache.get(symbol) ?? null;

    const score = computeScore({
      impactPct: dealImpactPct, sentiment, timeWeight,
      earningsScore, isNegative: false, isDeal: true,
      eventType, confidenceScore: 85, buyerQuality: buyerQual,
      dealPremiumDiscount: premiumDiscount,
    });
    const weightedScore = Math.round(score * timeWeight);

    const action = classifyAction(dealImpactPct, sentiment, isWatchlist, isPortfolio, earningsScore, weightedScore, isSell, 1, false, 50, null, null);

    const dealHeadline = `${fmtCr(dealValueCr)} ${eventType} — ${deal.clientName}${pctEquity !== null ? ` (${pctEquity.toFixed(2)}% equity)` : ''}${premiumDiscount !== null ? ` @${premiumDiscount > 0 ? '+' : ''}${premiumDiscount.toFixed(1)}%` : ''}`;

    let dealLastPrice = enrichment?.lastPrice || null;
    if (!dealLastPrice) {
      try {
        const cachedPrice = await kvGet<number>(`price:${symbol}`);
        if (cachedPrice) dealLastPrice = cachedPrice;
      } catch {}
    }

    const dealPctMcap = enrichment?.mcapCr ? parseFloat(((dealValueCr / enrichment.mcapCr) * 100).toFixed(2)) : null;
    const dealSignal: IntelSignal = {
      symbol, company: resolveCompanyName(symbol, enrichment?.companyName),
      date: deal.dealDate || getTodayDate(), source: 'deal',
      eventType, headline: dealHeadline,
      valueCr: dealValueCr,
      valueUsd: `$${((dealValueCr * 10000000) / INR_TO_USD / 1000000).toFixed(1)}M`,
      mcapCr: enrichment?.mcapCr || null, revenueCr: enrichment?.annualRevenueCr || null,
      impactPct: dealImpactPct, pctRevenue: null, pctMcap: dealPctMcap,
      inferenceUsed: false,
      client: null, segment: null, timeline: null,
      buyerSeller: deal.clientName, premiumDiscount, lastPrice: dealLastPrice,
      impactLevel, impactConfidence: 'HIGH',
      confidenceScore: 85, confidenceType: 'ACTUAL',
      valueSource: 'EXACT',
      action, score, timeWeight, weightedScore, sentiment,
      whyItMatters: generateWhyItMatters({
        eventType, impactLevel, pctRevenue: null, pctMcap: dealPctMcap,
        valueCr: dealValueCr, client: null, segment: null,
        isNegative: isSell, sentiment, buyerSeller: deal.clientName, premiumDiscount,
      }),
      isNegative: isSell, earningsBoost: false, isWatchlist, isPortfolio,
      dataSource: 'NSE',
      freshness: computeFreshness(deal.dealDate || getTodayDate()),
      scoreClassification: classifyScore(weightedScore),
      decision: action,
    };

    // Add catalyst strength
    dealSignal.catalystStrength = classifyCatalystStrength(dealImpactPct, dealPctMcap);

    // Compute 3-axis scores for deals
    const dealAxis = computeThreeAxisScore({
      impactPct: dealImpactPct, revenueGrowth: null, marginChange: null, epsGrowth: null,
      eventType, sentiment, timeWeight, signalCount: 1,
      confidenceScore: 85, confidenceType: 'ACTUAL', valueSource: 'EXACT',
      isNegative: isSell, sector: null, earningsScore,
      isCapex: false,
    });
    dealSignal.fundamentalScore = dealAxis.fundamental;
    dealSignal.signalStrengthScore = dealAxis.signalStrength;
    dealSignal.dataConfidenceScore = dealAxis.dataConfidence;
    dealSignal.weightedScore = dealAxis.composite;
    dealSignal.score = dealAxis.composite;
    // Re-classify using 3-axis composite
    dealSignal.action = classifyAction(dealImpactPct, sentiment, isWatchlist, isPortfolio, earningsScore, dealAxis.composite, isSell, 1, false, dealAxis.fundamental, null, null);
    dealSignal.decision = dealSignal.action;
    dealSignal.scoreClassification = classifyScore(dealAxis.composite);
    dealSignal.signalTier = 'TIER1_VERIFIED';  // Exchange-confirmed deals
    dealSignal.evidenceTier = 'TIER_A';  // Exchange-confirmed
    dealSignal.timeHorizon = classifyTimeHorizon(eventType);
    // v4: Deals are always VERIFIED + HIGH quality (exchange-confirmed)
    dealSignal.sourceTier = 'VERIFIED';
    dealSignal.dataQuality = 'HIGH';
    dealSignal.guidanceScope = 'COMPANY';
    dealSignal.guidancePeriod = 'UNKNOWN';
    dealSignal.actionScore = computeActionScore(dealSignal.weightedScore, 'VERIFIED', 'HIGH');

    const dealDedupKey = `${symbol}:${eventType}:${(deal.dealDate || getTodayDate()).slice(0, 10)}`;
    const existingDeal = dealDedupMap.get(dealDedupKey);
    if (!existingDeal || dealSignal.weightedScore > existingDeal.weightedScore) {
      dealDedupMap.set(dealDedupKey, dealSignal);
    }
  }

  allSignals.push(...dealDedupMap.values());

  // ── GUIDANCE → SIGNAL CONVERSION ENGINE ──
  // Read pre-computed guidance events from Redis and convert qualifying ones into signals
  try {
    const guidanceData = await kvGet<any>('guidance:events');
    const guidanceEvents: any[] = guidanceData?.events || guidanceData || [];
    if (Array.isArray(guidanceEvents) && guidanceEvents.length > 0) {
      let guidanceConverted = 0;
      for (const ge of guidanceEvents) {
        if (!ge.symbol || ge.confidenceScore < 50) continue;
        const symbol = normalizeTicker(ge.symbol);
        if (!symbol) continue;

        // ── VALIDATION: Reject empty/corrupt guidance (no hallucinated signals) ──
        const hasRevenue = ge.revenueGrowth !== null && ge.revenueGrowth !== undefined;
        const hasMargin = ge.marginChange !== null && ge.marginChange !== undefined;
        const hasCapex = ge.guidanceCapex !== null && ge.guidanceCapex !== undefined && ge.guidanceCapex > 0;
        const hasGrade = ge.grade && ge.grade !== '' && ge.grade !== 'UNKNOWN';
        const hasEps = ge.epsGrowth !== null && ge.epsGrowth !== undefined;

        // Must have at least ONE concrete metric — no empty signals allowed
        if (!hasRevenue && !hasMargin && !hasCapex && !hasEps) {
          continue; // Skip: DATA_INSUFFICIENT — not a valid signal
        }
        // Must have a valid grade
        if (!hasGrade) {
          continue; // Skip: no classification possible without grade
        }

        const isWatchlist = watchlistSet.has(symbol);
        const isPortfolio = portfolioSet.has(symbol);
        const enrichment = enrichMap.get(symbol);

        // ── Scoring Rules ──
        let signalScore = 0;
        let signalAction: ActionFlag = 'HOLD';
        let sentiment: SignalSentiment = 'Neutral';
        const scoreParts: string[] = [];

        // Rule 1: Revenue growth
        const revG = ge.revenueGrowth;
        if (revG !== null && revG !== undefined) {
          if (revG >= 15) { signalScore += 30; scoreParts.push(`Rev+${revG.toFixed(0)}%(High)`); sentiment = 'Bullish'; }
          else if (revG >= 8) { signalScore += 20; scoreParts.push(`Rev+${revG.toFixed(0)}%(Med)`); sentiment = 'Bullish'; }
          else if (revG >= 0) { signalScore += 5; scoreParts.push(`Rev+${revG.toFixed(0)}%`); }
          else { signalScore -= 15; scoreParts.push(`Rev${revG.toFixed(0)}%`); sentiment = 'Bearish'; }
        }

        // Rule 2: Margin change (bps)
        const marginBps = ge.marginChange !== null && ge.marginChange !== undefined ? ge.marginChange : null;
        if (marginBps !== null) {
          // Cap display at 5000 bps and show qualitatively if too high
          if (Math.abs(marginBps) > 5000) {
            signalScore += (marginBps > 0 ? 25 : -15);
            scoreParts.push(marginBps > 0 ? 'Margin: Strong expansion' : 'Margin: Severe contraction');
            if (marginBps <= 0 && sentiment !== 'Bearish') sentiment = 'Neutral';
          } else {
            const marginPct = marginBps / 100; // Convert bps to %
            if (marginBps >= 100) { signalScore += 25; scoreParts.push(`Margin+${marginPct.toFixed(1)}%`); }
            else if (marginBps >= 0) { signalScore += 10; scoreParts.push(`Margin+${marginPct.toFixed(1)}%`); }
            else { signalScore -= 10; scoreParts.push(`Margin${marginPct.toFixed(1)}%`); if (sentiment !== 'Bearish') sentiment = 'Neutral'; }
          }
        }

        // Rule 3: Capex
        const capex = ge.guidanceCapex;
        const rev = enrichment?.annualRevenueCr || null;
        if (capex !== null && capex > 0 && rev && rev > 0) {
          const capexPct = (capex / rev) * 100;
          if (capexPct >= 10) { signalScore += 20; scoreParts.push(`Capex ${capexPct.toFixed(0)}%rev`); }
          else if (capexPct >= 3) { signalScore += 10; scoreParts.push(`Capex ${capexPct.toFixed(0)}%rev`); }
          // <3% capex = ignore
        }

        // Rule 4: Sentiment from guidance text
        if (ge.grade === 'STRONG') signalScore += 15;
        else if (ge.grade === 'POSITIVE') signalScore += 10;
        else if (ge.grade === 'NEGATIVE') { signalScore -= 10; sentiment = 'Bearish'; }
        else if (ge.grade === 'WEAK') { signalScore -= 20; sentiment = 'Bearish'; }

        // Rule 5: Operating leverage / deleveraging / order book growth
        if (ge.operatingLeverage) { signalScore += 8; scoreParts.push('OpLev↑'); }
        if (ge.deleveraging) { signalScore += 5; scoreParts.push('Debt↓'); }
        if (ge.orderBookGrowth) { signalScore += 8; scoreParts.push('OrdBook↑'); }

        // Normalize to 0-100
        signalScore = Math.max(0, Math.min(100, signalScore));

        // Discard if below threshold
        if (signalScore < 20 && ge.confidenceScore < 60) continue;

        // Override for negative signals
        const isNeg = ge.grade === 'NEGATIVE' || ge.grade === 'WEAK' || (ge.sentimentScore < 30);

        const impactPct = Math.min(100, Math.abs(revG || 0));

        const timeWeight = computeTimeWeight(ge.eventDate || getTodayDate(), 'Guidance');
        const weightedScore = Math.round(signalScore * timeWeight);

        // Determine if guidance is strong
        const guidanceStrong = (ge.grade === 'STRONG' || ge.grade === 'VERY_STRONG');

        // Map to action bucket using new classifyAction
        signalAction = classifyAction(impactPct, sentiment, isWatchlist, isPortfolio, null, weightedScore, isNeg, 1, guidanceStrong, 50, revG || null, marginBps ? marginBps / 100 : null);

        const headline = `Guidance: ${scoreParts.join(' · ')} | ${ge.grade} (${ge.confidenceScore}% conf)`;

        let guidanceLastPrice = enrichment?.lastPrice || null;
        if (!guidanceLastPrice) {
          try {
            const cachedPrice = await kvGet<number>(`price:${symbol}`);
            if (cachedPrice) guidanceLastPrice = cachedPrice;
          } catch {}
        }

        const guidanceSignal: IntelSignal = {
          symbol,
          company: resolveCompanyName(symbol, ge.companyName, enrichment?.companyName),
          date: ge.eventDate || getTodayDate(),
          source: 'order',
          eventType: 'Guidance',
          headline,
          valueCr: capex || 0,
          valueUsd: capex ? `$${((capex * 10000000) / INR_TO_USD / 1000000).toFixed(1)}M` : null,
          mcapCr: enrichment?.mcapCr || null,
          revenueCr: enrichment?.annualRevenueCr || null,
          impactPct,
          pctRevenue: revG || null,
          pctMcap: null,
          inferenceUsed: false,
          client: null,
          segment: enrichment?.industry?.split(' ')[0] || null,
          timeline: null,
          buyerSeller: null,
          premiumDiscount: null,
          lastPrice: guidanceLastPrice,
          impactLevel: signalScore >= 70 ? 'HIGH' : signalScore >= 40 ? 'MEDIUM' : 'LOW',
          impactConfidence: ge.confidenceScore >= 70 ? 'HIGH' : ge.confidenceScore >= 50 ? 'MEDIUM' : 'LOW',
          confidenceScore: ge.confidenceScore,
          confidenceType: ge.confidenceScore >= 70 ? 'ACTUAL' : 'INFERRED',
          valueSource: capex ? 'EXACT' : 'HEURISTIC',
          action: signalAction,
          score: signalScore,
          timeWeight,
          weightedScore,
          sentiment,
          whyItMatters: `Guidance signal: ${scoreParts.join(', ')}. ${ge.grade} outlook with ${ge.confidenceScore}% confidence.`,
          isNegative: isNeg,
          earningsBoost: false,
          isWatchlist,
          isPortfolio,
          dataSource: 'Guidance',
          freshness: computeFreshness(ge.eventDate || getTodayDate()),
          scoreClassification: classifyScore(weightedScore),
          decision: signalAction,
        };

        // Add catalyst strength
        guidanceSignal.catalystStrength = classifyCatalystStrength(impactPct, null);

        // Compute 3-axis scores for guidance
        const guidEarningsScore = earningsCache.get(symbol) ?? null;
        const guidAxis = computeThreeAxisScore({
          impactPct, revenueGrowth: revG || null, marginChange: marginBps || null, epsGrowth: ge.epsGrowth || null,
          eventType: 'Guidance', sentiment, timeWeight, signalCount: 1,
          confidenceScore: ge.confidenceScore, confidenceType: ge.confidenceScore >= 70 ? 'ACTUAL' : 'INFERRED',
          valueSource: capex ? 'EXACT' : 'HEURISTIC',
          isNegative: isNeg, sector: enrichment?.industry?.split(' ')[0] || null,
          earningsScore: guidEarningsScore, isCapex: capex !== null && capex > 0,
        });
        guidanceSignal.fundamentalScore = guidAxis.fundamental;
        guidanceSignal.signalStrengthScore = guidAxis.signalStrength;
        guidanceSignal.dataConfidenceScore = guidAxis.dataConfidence;

        // Guidance credibility discount: management narrative is less reliable than hard data
        // Guidance weight = 70% of actual data (per institutional spec)
        const guidanceCredibilityDiscount = 0.70;
        guidanceSignal.weightedScore = Math.round(guidAxis.composite * guidanceCredibilityDiscount);
        guidanceSignal.score = guidanceSignal.weightedScore;
        guidanceSignal.dataConfidenceScore = guidAxis.dataConfidence; // no double-penalty on display

        // Re-classify using 3-axis composite with credibility discount
        guidanceSignal.action = classifyAction(impactPct, sentiment, isWatchlist, isPortfolio, guidEarningsScore, guidanceSignal.weightedScore, isNeg, 1, guidanceStrong, guidAxis.fundamental, revG || null, marginBps ? marginBps / 100 : null);
        guidanceSignal.decision = guidanceSignal.action;
        guidanceSignal.signalTier = ge.confidenceScore >= 70 ? 'TIER1_VERIFIED' : 'TIER2_INFERRED';
        guidanceSignal.revenueGrowth = revG || null;
        guidanceSignal.marginChange = marginBps ? marginBps / 100 : null;
        guidanceSignal.scoreClassification = classifyScore(guidAxis.composite);

        // Production-grade fields (v2)
        guidanceSignal.evidenceTier = ge.confidenceScore >= 70 ? 'TIER_A' : 'TIER_B';
        guidanceSignal.timeHorizon = 'SHORT';  // Guidance is always short-term
        guidanceSignal.extremeValueFlag = detectExtremeValue(revG || null, impactPct);

        // ── v4: SCOPE + PERIOD TAGGING (mandatory for all guidance) ──
        const guidanceText = ge.headline || ge.description || headline || '';
        guidanceSignal.guidanceScope = extractGuidanceScope(guidanceText);
        guidanceSignal.guidancePeriod = extractGuidancePeriod(guidanceText);

        // ── v4: RANGE-AWARE PARSING ──
        const rangeResult = parseGuidanceRange(guidanceText);
        if (rangeResult.midpoint !== null) {
          guidanceSignal.guidanceRangeLow = rangeResult.low!;
          guidanceSignal.guidanceRangeHigh = rangeResult.high!;
          const rangePenalty = computeRangeConfidencePenalty(rangeResult.widthPct);
          guidanceSignal.guidanceRangeConfPenalty = rangePenalty;
          // Apply penalty to confidence score
          guidanceSignal.confidenceScore = Math.round(guidanceSignal.confidenceScore * rangePenalty);
        }

        // ── v4: GUIDANCE SANITY BOUND (CRITICAL) ──
        const sanityResult = applyGuidanceSanityBound(
          revG || null,
          guidanceSignal.guidanceScope!,
          guidanceSignal.guidancePeriod!,
          guidanceSignal.confidenceScore,
        );
        guidanceSignal.dataQuality = sanityResult.dataQuality;
        if (sanityResult.forceWatch) {
          guidanceSignal.action = 'WATCH';
          guidanceSignal.decision = 'WATCH';
          guidanceSignal.watchSubtype = undefined;
          guidanceSignal.conflictResolution = (guidanceSignal.conflictResolution ? guidanceSignal.conflictResolution + ' · ' : '') +
            `Sanity bound: ${sanityResult.reason}`;
          if (!guidanceSignal.riskFactors) guidanceSignal.riskFactors = [];
          guidanceSignal.riskFactors.push(sanityResult.reason || 'Guidance sanity bound triggered');
        }

        // ── v4: SOURCE TIER (orthogonal) ──
        guidanceSignal.sourceTier = ge.confidenceScore >= 70 ? 'VERIFIED' : 'INFERRED';

        // ── v4: SCOPE ENFORCEMENT ──
        // IF scope != COMPANY → DO NOT compute headline % impact → Show "Segment-level signal"
        if (guidanceSignal.guidanceScope !== 'COMPANY' && guidanceSignal.guidanceScope !== 'UNKNOWN') {
          // Don't use segment data to drive company-level actions
          if (guidanceSignal.action === 'BUY' || guidanceSignal.action === 'ADD' || guidanceSignal.action === 'EXIT') {
            guidanceSignal.action = 'WATCH';
            guidanceSignal.decision = 'WATCH';
            guidanceSignal.conflictResolution = (guidanceSignal.conflictResolution ? guidanceSignal.conflictResolution + ' · ' : '') +
              `Scope gate: ${guidanceSignal.guidanceScope}-level signal cannot drive ${guidanceSignal.action}`;
          }
        }

        // ── v4: SOURCE SENTENCE QUALITY CHECK ──
        const guidanceSrcExtraction = extractSourceSentence(ge.headline || ge.description || '', headline);
        guidanceSignal.sourceExtract = guidanceSrcExtraction.sentence || undefined;
        if (guidanceSrcExtraction.quality === 'LOW') {
          guidanceSignal.dataQuality = guidanceSignal.dataQuality === 'HIGH' ? 'MEDIUM' :
            guidanceSignal.dataQuality === 'MEDIUM' ? 'LOW' : guidanceSignal.dataQuality;
        }

        // ── v4: ACTION SCORE FOR RANKING ──
        guidanceSignal.actionScore = computeActionScore(
          guidanceSignal.weightedScore,
          guidanceSignal.sourceTier!,
          guidanceSignal.dataQuality!,
        );

        // ── GUIDANCE VALIDATION (v3): Catch QoQ/segment misreads, extreme values ──
        const previousGrowthForSymbol = earningsCache.get(symbol);
        const prevGrowth = previousGrowthForSymbol !== null && previousGrowthForSymbol !== undefined
          ? (previousGrowthForSymbol - 50) * 2 // Convert 0-100 score back to approximate growth %
          : null;
        const guidanceValidation = validateGuidance(
          revG || null,
          marginBps ? marginBps / 100 : null,
          prevGrowth,
          ge.confidenceScore,
          headline,
        );
        if (!guidanceValidation.valid) {
          guidanceSignal.guidanceAnomalyFlag = guidanceValidation.anomalyType;
          guidanceSignal.action = guidanceValidation.adjustedAction || 'WATCH';
          guidanceSignal.decision = guidanceSignal.action;
          guidanceSignal.conflictResolution = (guidanceSignal.conflictResolution ? guidanceSignal.conflictResolution + ' · ' : '') +
            (guidanceValidation.reason || 'Guidance anomaly detected');
          if (!guidanceSignal.riskFactors) guidanceSignal.riskFactors = [];
          guidanceSignal.riskFactors.push(guidanceValidation.reason || 'Anomaly in guidance data');
          // v4: BROKEN data quality for invalid guidance
          guidanceSignal.dataQuality = 'BROKEN';
        } else if (guidanceValidation.anomalyType) {
          // Valid but flagged for review
          guidanceSignal.guidanceAnomalyFlag = guidanceValidation.anomalyType;
          if (!guidanceSignal.riskFactors) guidanceSignal.riskFactors = [];
          guidanceSignal.riskFactors.push(guidanceValidation.reason || 'Extreme guidance value — verify');
        }

        // ── v5: BROKEN DATA QUALITY HARD GATE ──
        // IF dataQuality == BROKEN → categorize as OBSERVATION, mark with WATCH
        if (guidanceSignal.dataQuality === 'BROKEN') {
          guidanceSignal.action = 'WATCH';
          guidanceSignal.signalCategory = 'OBSERVATION';
          guidanceSignal.observationReason =
            `Data quality BROKEN: ${guidanceSignal.guidanceAnomalyFlag || 'parsing failure'}`;
          guidanceSignal.watchSubtype = undefined;
          guidanceSignal.tag = guidanceSignal.tag || 'RISK-WATCH';
          if (guidanceSignal.whyItMatters) {
            guidanceSignal.whyItMatters =
              'Insufficient conviction — monitor for confirmation · ' +
              `Sanity bound: ${(guidanceSignal.conflictResolution || 'parsing anomaly')} · ` +
              `Data quality BROKEN: excluded from actionable signals`;
          }
        }

        // Guidance without supporting signals → note it, but don't double-penalize
        // (70% discount already accounts for guidance unreliability)
        const companyOtherSignals = allSignals.filter(s => s.symbol === symbol && s.dataSource !== 'Guidance');
        const hasSupport = companyOtherSignals.some(s =>
          (guidanceSignal.sentiment === 'Bullish' && (s.action === 'BUY' || s.action === 'ADD')) ||
          (guidanceSignal.sentiment === 'Bearish' && (s.action === 'EXIT' || s.action === 'TRIM'))
        );
        if (!hasSupport && guidanceSignal.action === 'BUY') {
          // Unsupported BUY from guidance alone → cap at ADD (one level, not two)
          guidanceSignal.action = 'ADD';
          guidanceSignal.decision = 'ADD';
          guidanceSignal.conflictResolution = 'Guidance-only BUY → ADD (no confirming signals)';
        }

        // Dedup against existing signals for same symbol
        const guidanceDedupKey = `${symbol}:Guidance:${(ge.eventDate || '').slice(0, 10)}`;
        if (!dedupMap.has(guidanceDedupKey)) {
          allSignals.push(guidanceSignal);
          guidanceConverted++;
        }
      }
      if (guidanceConverted > 0) {
        console.log(`[Compute] Converted ${guidanceConverted} guidance events → intelligence signals`);
        debug.dataSources.push('Guidance');
      }
    }
  } catch (e) {
    console.warn('[Compute] Guidance→Signal conversion error:', (e as Error).message);
  }

  // ── SIGNAL SCHEMA VALIDATION: Reject invalid signals before scoring ──
  const validatedSignals = allSignals.filter(s => {
    // Must have a valid symbol
    if (!s.symbol || s.symbol.trim() === '') return false;
    // Must have a non-zero score (zero = no data was processed)
    if (s.score === 0 && s.weightedScore === 0) return false;
    // Reject signals with empty/placeholder headlines
    if (s.headline && (s.headline === 'Guidance: ' || s.headline === 'Guidance:  | undefined (undefined% conf)')) return false;
    // Reject guidance signals where scoreParts resulted in only "Delev" with no other metrics
    if (s.eventType === 'Guidance' && s.headline) {
      const h = s.headline.toLowerCase();
      // If headline ONLY contains delev/oplev with no revenue/margin data, it's insufficient
      if ((h.includes('delev') || h.includes('oplev') || h.includes('ordbook'))
          && !h.includes('rev') && !h.includes('margin') && !h.includes('capex')) {
        // Tag as data insufficient instead of removing if portfolio/watchlist
        if (s.isPortfolio || s.isWatchlist) {
          s.action = 'WATCH';
          s.decision = 'WATCH';
          s.tag = 'DATA INSUFFICIENT';
          s.decisionReason = 'Guidance data incomplete — only secondary metrics available';
          return true; // Keep but reclassify
        }
        return false; // Remove non-portfolio/watchlist insufficient signals
      }
    }
    return true;
  });

  // ── GUIDANCE CAP: max 1 guidance signal per company per cycle ──
  const guidanceByCompany = new Map<string, IntelSignal[]>();
  const nonGuidanceSignals: IntelSignal[] = [];
  for (const s of validatedSignals) {
    if (s.eventType === 'Guidance') {
      const arr = guidanceByCompany.get(s.symbol) || [];
      arr.push(s);
      guidanceByCompany.set(s.symbol, arr);
    } else {
      nonGuidanceSignals.push(s);
    }
  }
  // Keep only the highest-scoring guidance signal per company
  const cappedGuidance: IntelSignal[] = [];
  for (const [, gSigs] of guidanceByCompany) {
    gSigs.sort((a, b) => b.weightedScore - a.weightedScore);
    cappedGuidance.push(gSigs[0]); // Keep best only
  }
  // Replace validatedSignals with capped version
  const guidanceCappedSignals = [...nonGuidanceSignals, ...cappedGuidance];

  // ── GUIDANCE DIVERSITY: auto-downweight if guidance > 45% of signals ──
  const totalSigs = guidanceCappedSignals.length;
  const guidanceCount = guidanceCappedSignals.filter(s => s.eventType === 'Guidance').length;
  if (totalSigs > 0 && (guidanceCount / totalSigs) > 0.45) {
    const downweightFactor = 0.45 / (guidanceCount / totalSigs); // bring to 45% effective weight
    for (const s of guidanceCappedSignals) {
      if (s.eventType === 'Guidance') {
        s.weightedScore = Math.round(s.weightedScore * downweightFactor);
        s.score = Math.round(s.score * downweightFactor);
        if (s.fundamentalScore) s.fundamentalScore = Math.round(s.fundamentalScore * downweightFactor);
        if (s.signalStrengthScore) s.signalStrengthScore = Math.round(s.signalStrengthScore * downweightFactor);
      }
    }
    console.log(`[Compute] Guidance diversity: ${guidanceCount}/${totalSigs} (${(guidanceCount/totalSigs*100).toFixed(0)}%) → downweighted by ${downweightFactor.toFixed(2)}`);
  }

  // ── Materiality filter: remove noise signals that don't meet thresholds ──
  const materialSignals = guidanceCappedSignals.filter(s => {
    // Always keep portfolio and watchlist signals
    if (s.isPortfolio || s.isWatchlist) return true;
    // Always keep negative signals (risk management)
    if (s.isNegative) return true;
    // Drop orders below 2% revenue (immaterial)
    if (s.source === 'order' && s.pctRevenue !== null && s.pctRevenue < 2 && s.confidenceType !== 'ACTUAL') return false;
    // Drop management changes without CEO/CFO
    if (s.eventType === 'Management Change') {
      const headline = s.headline.toLowerCase();
      if (!headline.includes('ceo') && !headline.includes('cfo') && !headline.includes('managing director') && !headline.includes('chairman')) return false;
    }
    // Drop capex below 5% revenue
    if (s.eventType === 'Capex/Expansion' && s.pctRevenue !== null && s.pctRevenue < 5 && s.confidenceType !== 'ACTUAL') return false;
    return true;
  });

  const filtered = materialSignals.sort((a, b) => b.weightedScore - a.weightedScore).slice(0, 200);

  const companySignalMap = new Map<string, IntelSignal[]>();
  for (const s of filtered) {
    const arr = companySignalMap.get(s.symbol) || [];
    arr.push(s);
    companySignalMap.set(s.symbol, arr);
  }

  const trends: CompanyTrend[] = [];
  for (const [sym, sigs] of companySignalMap) {
    const count = sigs.length;
    const stackLevel: CompanyTrend['stackLevel'] = count >= 4 ? 'STRONG' : count >= 2 ? 'BUILDING' : 'WEAK';

    for (const s of sigs) {
      s.signalStackCount = count;
      s.signalStackLevel = stackLevel;

      const stackBonus = count >= 2 ? Math.min(20, 5 * count) : 0;
      if (stackBonus > 0) {
        s.weightedScore = Math.min(100, s.weightedScore + stackBonus);
      }
    }

    // Re-classify actions after stacking bonus is applied
    for (const s of sigs) {
      if (s.signalStackCount && s.signalStackCount >= 2) {
        const newAction = classifyAction(
          s.impactPct,
          s.sentiment,
          s.isWatchlist,
          s.isPortfolio,
          null, // earningsScore
          s.weightedScore, // Updated with stack bonus
          s.isNegative,
          s.signalStackCount, // Pass actual stack count
          false, // guidanceStrong
          s.fundamentalScore || 50, // Pass fundamental for veto
          s.revenueGrowth || null, // NEW
          s.marginChange || null   // NEW
        );
        // Promote ADD to BUY if re-classification suggests it
        if (newAction === 'BUY' || (newAction === 'ADD' && s.action !== 'BUY')) {
          s.action = newAction;
          s.decision = newAction;
        }
      }
      // Post-stacking promotion rule: if score > 80 AND bullish AND signalCount >= 3 → force BUY
      if (s.signalStackCount && s.signalStackCount >= 3 && s.weightedScore > 80 && s.sentiment === 'Bullish' && !s.isNegative) {
        s.action = 'BUY';
        s.decision = 'BUY';
      }
    }

    // ── Divergence detection: strong guidance + weak earnings = Transition Phase ──
    const hasStrongGuidance = sigs.some(s => s.dataSource === 'Guidance' && s.weightedScore >= 55);
    const hasWeakEarnings = sigs.some(s => s.earningsBoost === false && s.weightedScore < 40 && s.dataSource !== 'Guidance');
    if (hasStrongGuidance && hasWeakEarnings) {
      for (const s of sigs) {
        s.tag = 'TRANSITION PHASE';
        // Promote WATCH/AVOID to ADD for transition companies
        if (s.action === 'WATCH' || s.action === 'AVOID' || s.action === 'HOLD') {
          s.action = 'ADD';
          s.decision = 'ADD';
          s.decisionReason = 'Strong guidance overrides weak recent earnings (transition phase)';
        }
      }
    }

    const bullish = sigs.filter(s => s.sentiment === 'Bullish').length;
    const bearish = sigs.filter(s => s.sentiment === 'Bearish').length;

    // ── WATCH Subtype Classification ──
    for (const s of sigs) {
      if (s.action === 'WATCH' || s.decision === 'WATCH') {
        if (s.tag === 'DATA INSUFFICIENT' || s.tag === 'DATA_INSUFFICIENT') {
          // Already tagged as data watch
        } else if (s.isNegative || s.sentiment === 'Bearish' || (s.earningsBoost === false && s.weightedScore < 35)) {
          s.tag = s.tag || 'RISK-WATCH';
          s.decisionReason = s.decisionReason || 'Potential downside risk — reduce exposure if confirmed';
        } else if (s.confidenceType === 'HEURISTIC' && s.weightedScore < 40) {
          s.tag = s.tag || 'DATA-WATCH';
          s.decisionReason = s.decisionReason || 'Insufficient data — ignore until data arrives';
        }
        // else: plain WATCH = neutral monitoring, no tag needed
      }
    }

    if (count >= 2) {
      trends.push({
        symbol: sym,
        company: sigs[0].company,
        signalCount: count,
        stackLevel,
        topAction: sigs[0].action,
        topImpact: sigs[0].impactLevel,
        netSentiment: bullish > bearish ? 'Bullish' : bearish > bullish ? 'Bearish' : 'Neutral',
        avgScore: Math.round(sigs.reduce((s, x) => s + x.weightedScore, 0) / count),
        maxScore: Math.round(Math.max(...sigs.map(x => x.weightedScore))),
      });
    }
  }
  trends.sort((a, b) => b.avgScore - a.avgScore);

  // ── CONTRADICTION DETECTION & WHY EXPLANATION ENGINE ──
  // Scan every signal for logical inconsistencies and generate explanations
  const valueCountMap = new Map<number, string[]>(); // Track duplicate values
  for (const s of filtered) {
    // Track duplicate values for anomaly detection
    if (s.valueCr > 0) {
      const key = Math.round(s.valueCr);
      if (!valueCountMap.has(key)) valueCountMap.set(key, []);
      valueCountMap.get(key)!.push(s.symbol);
    }

    const contradictions: string[] = [];
    const anomalyFlags: string[] = [];

    // Contradiction: Revenue decline + positive action
    if (s.revenueGrowth !== undefined && s.revenueGrowth !== null && s.revenueGrowth < -5 && (s.action === 'BUY' || s.action === 'ADD')) {
      contradictions.push(`Revenue ${s.revenueGrowth.toFixed(0)}% decline conflicts with ${s.action}`);
    }
    // Contradiction: Margin decline + positive action
    if (s.marginChange !== undefined && s.marginChange !== null && s.marginChange < -2 && (s.action === 'BUY' || s.action === 'ADD')) {
      contradictions.push(`Margin ${s.marginChange.toFixed(1)}% compression with ${s.action}`);
    }
    // Contradiction: Bearish sentiment + BUY
    if (s.sentiment === 'Bearish' && s.action === 'BUY') {
      contradictions.push('Bearish sentiment conflicts with BUY');
    }
    // Anomaly: Zero value
    if (s.valueCr === 0 && s.eventType !== 'Guidance' && s.eventType !== 'Mgmt Change') {
      anomalyFlags.push('ZERO_VALUE');
    }
    // Anomaly: Zero impact
    if (s.impactPct === 0 && s.impactLevel !== 'LOW') {
      anomalyFlags.push('ZERO_IMPACT');
    }
    // Anomaly: Heuristic treated as high confidence — only flag if NOT TIER1_VERIFIED
    // TIER1 guidance signals can have heuristic value estimates but verified signal quality
    if (s.valueSource === 'HEURISTIC' && s.confidenceScore >= 70 && s.signalTier !== 'TIER1_VERIFIED') {
      anomalyFlags.push('HEURISTIC_HIGH_CONF');
    }

    s.contradictions = contradictions.length > 0 ? contradictions : undefined;
    s.anomalyFlags = anomalyFlags.length > 0 ? anomalyFlags : undefined;

    // Generate WHY explanation
    const whyParts: string[] = [];
    if (s.action === 'BUY' || s.action === 'ADD') {
      if (s.revenueGrowth && s.revenueGrowth > 15) whyParts.push(`Strong revenue growth (+${s.revenueGrowth.toFixed(0)}%)`);
      if (s.marginChange && s.marginChange > 0) whyParts.push(`Margin expansion (+${s.marginChange.toFixed(1)}%)`);
      if (s.signalStackCount && s.signalStackCount >= 2) whyParts.push(`${s.signalStackCount} confirming signals`);
      if (s.impactPct >= 5) whyParts.push(`${s.impactPct.toFixed(1)}% revenue impact`);
      if (s.earningsBoost) whyParts.push('Strong earnings beat');
      if (contradictions.length > 0) {
        whyParts.push(`Despite: ${contradictions.join('; ')}`);
        if (s.revenueGrowth && s.revenueGrowth > 10) whyParts.push('Revenue growth offsets margin weakness');
        if (s.signalStackCount && s.signalStackCount >= 2) whyParts.push('Multiple signal confirmation overrides single negative');
      }
    } else if (s.action === 'EXIT' || s.action === 'TRIM') {
      if (s.revenueGrowth && s.revenueGrowth < -10) whyParts.push(`Severe revenue decline (${s.revenueGrowth.toFixed(0)}%)`);
      if (s.marginChange && s.marginChange < -2) whyParts.push(`Margin compression (${s.marginChange.toFixed(1)}%)`);
      if (s.isNegative) whyParts.push('Negative catalyst detected');
    } else if (s.action === 'HOLD') {
      whyParts.push('Mixed signals — maintain position, monitor closely');
      if (s.impactPct >= 3) whyParts.push(`${s.impactPct.toFixed(1)}% revenue impact`);
    } else if (s.action === 'WATCH') {
      whyParts.push('Insufficient conviction — monitor for confirmation');
      if (s.confidenceType === 'HEURISTIC') whyParts.push('Low data confidence');
      if (s.impactPct < 2) whyParts.push('Low revenue impact');
    } else if (s.action === 'AVOID') {
      whyParts.push('Weak signal quality — skip');
    }
    // Add conflict resolution note
    if (s.conflictResolution) {
      whyParts.push(s.conflictResolution);
    }
    // Add sector cyclical note
    if (s.sectorCyclical) {
      whyParts.push('Sector-wide pressure (cyclical, not structural)');
    }
    // Add price reaction note
    if (s.priceReactionNote) {
      whyParts.push(s.priceReactionNote);
    }
    // Add catalyst strength
    if (s.catalystStrength) {
      whyParts.push(`Catalyst: ${s.catalystStrength}`);
    }
    // Add guidance anomaly flag
    if (s.guidanceAnomalyFlag) {
      whyParts.push(`⚠ Guidance anomaly: ${s.guidanceAnomalyFlag}`);
    }
    // Add template suppression note
    if (s.heuristicSuppressed && s.templatePattern) {
      whyParts.push(`⚠ Template: ${s.templatePattern}`);
    }
    s.whyAction = whyParts.length > 0 ? whyParts.join(' · ') : undefined;

    // Build risk factors list
    if (!s.riskFactors) s.riskFactors = [];
    if (s.isNegative) s.riskFactors.push('Negative catalyst detected');
    if (s.revenueGrowth !== null && s.revenueGrowth !== undefined && s.revenueGrowth < -10) {
      s.riskFactors.push(`Revenue decline: ${s.revenueGrowth.toFixed(0)}%`);
    }
    if (s.marginChange !== null && s.marginChange !== undefined && s.marginChange < -2) {
      s.riskFactors.push(`Margin pressure: ${s.marginChange.toFixed(1)}%`);
    }
    if (s.sectorCyclical) s.riskFactors.push('Sector-wide cyclical pressure');
    if (s.heuristicSuppressed) s.riskFactors.push('Data from unverified pattern');
    if (s.evidenceTier === 'TIER_C' || s.evidenceTier === 'TIER_D') {
      s.riskFactors.push('Low evidence quality');
    }
    if (s.extremeValueFlag) s.riskFactors.push(s.extremeValueFlag);
    // Remove empty risk factors
    if (s.riskFactors.length === 0) s.riskFactors = undefined as any;
  }

  // ══════════════════════════════════════════════════════════════
  // ── TEMPLATE DETECTION ENGINE (COMPREHENSIVE) ──
  // Rule 1: Repetition check (same value across 5+ companies)
  // Rule 2: Identical % impact across companies
  // Rule 3: Missing source reference
  // Rule 4: Cross-verification failure
  // ══════════════════════════════════════════════════════════════
  const templateResults = detectTemplatePatterns(filtered);

  // Apply template detection results
  for (const s of filtered) {
    const sigKey = `${s.symbol}:${s.eventType}:${s.date}`;
    const tmpl = templateResults.get(sigKey);

    // Also catch with old value count map
    const roundedVal = Math.round(s.valueCr);
    const syms = valueCountMap.get(roundedVal) || [];

    if (tmpl?.isTemplate || (syms.length >= 4 && s.valueSource === 'HEURISTIC' && roundedVal > 0)) {
      if (!s.anomalyFlags) s.anomalyFlags = [];
      s.anomalyFlags.push(`TEMPLATE_PATTERN_${roundedVal}Cr`);
      s.heuristicSuppressed = true;
      s.templatePattern = tmpl?.pattern || `₹${roundedVal}Cr×${syms.length} companies`;
      s.confidenceScore = Math.min(s.confidenceScore, 20);
      s.visibility = 'HIDDEN'; // Hidden by default (Tier D behavior)
      s.evidenceTier = 'TIER_D';
      // Cannot be BUY/ADD/HOLD/EXIT based on templated data → force WATCH
      if (s.action === 'BUY' || s.action === 'ADD' || s.action === 'HOLD') {
        s.action = 'WATCH';
        s.decision = 'WATCH';
        s.conflictResolution = `Template suppressed: ${s.templatePattern} (unconfirmed pattern)`;
      }
    }

    // Rule 2: Identical % impact flag
    if (tmpl?.identicalPct) {
      s.identicalPctFlag = true;
      if (!s.anomalyFlags) s.anomalyFlags = [];
      s.anomalyFlags.push('IDENTICAL_PCT_IMPACT');
    }

    // Rule 3: Missing source
    if (tmpl?.missingSource && s.valueSource === 'HEURISTIC') {
      if (s.evidenceTier !== 'TIER_D') {
        s.evidenceTier = 'TIER_C'; // Downgrade to inferred
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── 4-TIER EVIDENCE HIERARCHY GATING (STRICT HARD GATE) ──
  // Tier A (PRIMARY VERIFIED)  → BUY/ADD/TRIM/EXIT allowed
  // Tier B (SECONDARY VERIFIED)→ HOLD/WATCH-ACTIVE max
  // Tier C (INFERRED)          → WATCH only ("Monitor" / "Unconfirmed signal")
  // Tier D (TEMPLATE/LOW CONF) → AUTO-SUPPRESS (hidden by default)
  // ══════════════════════════════════════════════════════════════
  for (const s of filtered) {
    if (s.evidenceTier === 'TIER_D') {
      // Tier D: auto-suppress — force WATCH, hidden visibility
      if (s.action !== 'EXIT') { // Never suppress genuine EXIT
        s.action = 'WATCH';
        s.decision = 'WATCH';
        s.visibility = 'HIDDEN';
        s.conflictResolution = (s.conflictResolution ? s.conflictResolution + ' · ' : '') +
          'Tier D: auto-suppressed (template/low confidence pattern)';
      }
    } else if (s.evidenceTier === 'TIER_C') {
      // Tier C: WATCH only — no BUY/ADD/HOLD/EXIT
      if (s.action === 'BUY' || s.action === 'ADD' || s.action === 'HOLD') {
        s.action = 'WATCH';
        s.decision = 'WATCH';
        s.visibility = 'DIMMED';
        s.conflictResolution = (s.conflictResolution ? s.conflictResolution + ' · ' : '') +
          'Tier C: inferred signal — monitor only, unconfirmed';
      }
      if (s.action === 'EXIT' && !s.isNegative) {
        s.action = 'WATCH';
        s.decision = 'WATCH';
        s.conflictResolution = (s.conflictResolution ? s.conflictResolution + ' · ' : '') +
          'Tier C: inferred EXIT downgraded — needs verification';
      }
    } else if (s.evidenceTier === 'TIER_B') {
      // Tier B: HOLD/WATCH-ACTIVE max — no BUY
      if (s.action === 'BUY') {
        s.action = 'ADD';
        s.decision = 'ADD';
        s.conflictResolution = (s.conflictResolution ? s.conflictResolution + ' · ' : '') +
          'Tier B: secondary source → BUY downgraded to ADD';
      }
      s.visibility = 'VISIBLE';
    } else {
      // Tier A: no restrictions
      s.visibility = 'VISIBLE';
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── CONFIDENCE GATING (HARD RULE) ──
  // If confidence < 60 → cannot be BUY or ADD → force WATCH
  // ACTUAL confidence type is inherently trusted — skip gating
  // ══════════════════════════════════════════════════════════════
  for (const s of filtered) {
    if (s.confidenceType !== 'ACTUAL' && s.confidenceScore < 60 && (s.action === 'BUY' || s.action === 'ADD')) {
      const oldAction = s.action;
      s.action = 'WATCH';
      s.decision = 'WATCH';
      s.conflictResolution = (s.conflictResolution ? s.conflictResolution + ' · ' : '') +
        `Confidence gating: ${oldAction}→WATCH (confidence ${s.confidenceScore} < 60)`;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── GUIDANCE ANOMALY GATE ──
  // EXTREME_UNVERIFIED guidance cannot drive EXIT/TRIM — likely parsing error
  // (e.g. AEROFLEX -47%, CCL -55%, DIXON -55% cluster from QoQ/segment misread)
  // ══════════════════════════════════════════════════════════════
  for (const s of filtered) {
    if (s.guidanceAnomalyFlag && (s.action === 'EXIT' || s.action === 'TRIM')) {
      const oldAction = s.action;
      s.action = 'WATCH';
      s.decision = 'WATCH';
      s.conflictResolution = (s.conflictResolution ? s.conflictResolution + ' · ' : '') +
        `Anomaly gate: ${oldAction}→WATCH (guidance ${s.guidanceAnomalyFlag} — needs second source verification)`;
    }
    // EXTREME_UNVERIFIED guidance with HOLD should also be WATCH
    if (s.guidanceAnomalyFlag === 'EXTREME_UNVERIFIED' && s.eventType === 'Guidance' && s.action === 'HOLD') {
      s.action = 'WATCH';
      s.decision = 'WATCH';
      s.watchSubtype = undefined;
      s.conflictResolution = (s.conflictResolution ? s.conflictResolution + ' · ' : '') +
        'Extreme guidance → WATCH (verify before acting)';
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── EVENT NOVELTY / DEDUP FILTER ──
  // If same event type for same company seen in last 7 days → reduce weight 50%
  // If repeated across many companies → suppress
  // ══════════════════════════════════════════════════════════════
  const eventFingerprints = new Map<string, { date: string; count: number }>();
  for (const s of filtered) {
    const fp = `${s.symbol}:${s.eventType}`;
    const existing = eventFingerprints.get(fp);
    if (existing) {
      existing.count++;
      // Same company + same event type = repeat
      const existDate = new Date(existing.date).getTime();
      const sigDate = new Date(s.date).getTime();
      const daysDiff = Math.abs(existDate - sigDate) / (1000 * 60 * 60 * 24);
      if (daysDiff <= 7) {
        s.eventNovelty = 'REPEAT';
        s.weightedScore = Math.round(s.weightedScore * 0.5); // 50% weight reduction
        s.score = s.weightedScore;
        if (!s.anomalyFlags) s.anomalyFlags = [];
        s.anomalyFlags.push('REPEAT_EVENT');
      } else if (daysDiff <= 14) {
        s.eventNovelty = 'STALE';
        s.weightedScore = Math.round(s.weightedScore * 0.7); // 30% reduction
        s.score = s.weightedScore;
      } else {
        s.eventNovelty = 'NEW';
      }
    } else {
      eventFingerprints.set(fp, { date: s.date, count: 1 });
      s.eventNovelty = 'NEW';
    }
  }
  // Cross-company event suppression: same event headline across 3+ companies
  const headlineMap = new Map<string, string[]>();
  for (const s of filtered) {
    // Normalize headline to detect templates
    const normHeadline = s.headline.replace(/₹[\d,.]+\s*(Cr|Lakh|Bn)/gi, 'VALUE').replace(/\d+\.\d+%/g, 'PCT');
    const existing = headlineMap.get(normHeadline) || [];
    existing.push(s.symbol);
    headlineMap.set(normHeadline, existing);
  }
  for (const [hl, syms] of headlineMap) {
    if (syms.length >= 3) {
      for (const s of filtered) {
        const normHl = s.headline.replace(/₹[\d,.]+\s*(Cr|Lakh|Bn)/gi, 'VALUE').replace(/\d+\.\d+%/g, 'PCT');
        if (normHl === hl && s.valueSource === 'HEURISTIC') {
          s.heuristicSuppressed = true;
          if (s.action === 'BUY' || s.action === 'ADD') {
            s.action = 'WATCH';
            s.decision = 'WATCH';
          }
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── NET SIGNAL CONFLICT RESOLUTION ENGINE (v2) ──
  // Uses weighted formula: Net Score = Σ (Score × TypeWeight × Confidence × Freshness)
  // Override Rule: Verified Guidance overrides ALL inferred signals
  // Produces conflict badges and net signal scores for each company
  // ══════════════════════════════════════════════════════════════
  for (const [sym, sigs] of companySignalMap) {
    // Compute net signal score for this company
    const netScore = computeNetSignalScore(sigs);
    for (const s of sigs) {
      s.netSignalScore = netScore;
    }

    if (sigs.length < 2) continue;

    const bullishSigs = sigs.filter(s => s.action === 'BUY' || s.action === 'ADD');
    const bearishSigs = sigs.filter(s => s.action === 'EXIT' || s.action === 'TRIM' || s.action === 'AVOID');

    // Check for verified guidance override
    const verifiedGuidance = sigs.find(s =>
      s.eventType === 'Guidance' && s.evidenceTier === 'TIER_A' && !s.guidanceAnomalyFlag
    );

    if (bullishSigs.length > 0 && bearishSigs.length > 0) {
      // Generate conflict badge
      const bullTypes = [...new Set(bullishSigs.map(s => s.eventType))].join(', ');
      const bearTypes = [...new Set(bearishSigs.map(s => s.eventType))].join(', ');
      const badge = `Conflicting: ${bullTypes} vs ${bearTypes}`;
      for (const s of sigs) {
        s.conflictBadge = badge;
      }

      // Override Rule: Verified Guidance dominates ALL inferred signals
      if (verifiedGuidance) {
        for (const s of sigs) {
          if (s !== verifiedGuidance && s.valueSource === 'HEURISTIC') {
            const oldAction = s.action;
            s.action = verifiedGuidance.action;
            s.decision = verifiedGuidance.action;
            s.conflictResolution = (s.conflictResolution ? s.conflictResolution + ' · ' : '') +
              `Verified guidance overrides inferred ${s.eventType}: ${oldAction}→${verifiedGuidance.action}`;
          }
        }
      } else {
        // Standard hierarchy resolution
        const dominantBearish = bearishSigs.some(s => {
          const tier = SIGNAL_TIER_HIERARCHY[s.eventType] || 3;
          return tier === 1 || (s.revenueGrowth !== null && s.revenueGrowth !== undefined && s.revenueGrowth < -15);
        });
        const dominantBullish = bullishSigs.some(s => {
          const tier = SIGNAL_TIER_HIERARCHY[s.eventType] || 3;
          return tier === 1 && s.impactPct >= 5;
        });

        if (dominantBearish && !dominantBullish) {
          for (const s of bullishSigs) {
            const oldAction = s.action;
            s.action = 'HOLD';
            s.decision = 'HOLD';
            s.conflictResolution = `Downgraded from ${oldAction}: revenue/demand decline dominates`;
            if (!s.contradictions) s.contradictions = [];
            s.contradictions.push(`Overridden: ${oldAction}→HOLD due to Tier 1 bearish signal on ${sym}`);
          }
        } else if (dominantBullish && !dominantBearish) {
          for (const s of bearishSigs) {
            if (s.action !== 'EXIT') {
              const oldAction = s.action;
              s.action = 'HOLD';
              s.decision = 'HOLD';
              s.conflictResolution = `Upgraded from ${oldAction}: strong order/demand signal dominates`;
            }
          }
        }
      }
    }

    // FORCED SINGLE OUTPUT: For multi-signal companies, ensure consistent direction
    const sorted = [...sigs].sort((a, b) => {
      // Verified guidance always first
      if (a.eventType === 'Guidance' && a.evidenceTier === 'TIER_A') return -1;
      if (b.eventType === 'Guidance' && b.evidenceTier === 'TIER_A') return 1;
      const tierA = SIGNAL_TIER_HIERARCHY[a.eventType] || 3;
      const tierB = SIGNAL_TIER_HIERARCHY[b.eventType] || 3;
      if (tierA !== tierB) return tierA - tierB;
      return b.weightedScore - a.weightedScore;
    });
    const dominant = sorted[0];
    for (const s of sigs) {
      if (s !== dominant && s.action !== dominant.action) {
        if (s.action !== 'EXIT' && dominant.action !== 'WATCH') {
          s.decision = dominant.action;
          s.conflictResolution = (s.conflictResolution ? s.conflictResolution + ' · ' : '') +
            `Aligned to dominant signal: ${dominant.eventType} (Tier ${SIGNAL_TIER_HIERARCHY[dominant.eventType] || 3})`;
        }
      }
    }
  }

  // ── SECTOR-RELATIVE SCORING ──
  // If >50% of sector shows revenue decline, classify as cyclical pressure
  const sectorRevDecline = new Map<string, { decline: number; total: number }>();
  for (const s of filtered) {
    const sector = s.sector || 'Unknown';
    const entry = sectorRevDecline.get(sector) || { decline: 0, total: 0 };
    entry.total++;
    if (s.revenueGrowth !== null && s.revenueGrowth !== undefined && s.revenueGrowth < -5) {
      entry.decline++;
    }
    sectorRevDecline.set(sector, entry);
  }
  for (const s of filtered) {
    const sector = s.sector || 'Unknown';
    const entry = sectorRevDecline.get(sector);
    if (entry && entry.total >= 3 && entry.decline / entry.total > 0.5) {
      // Sector-wide decline — downgrade severity
      if (s.revenueGrowth !== null && s.revenueGrowth !== undefined && s.revenueGrowth < -5) {
        s.sectorCyclical = true;
        if (!s.contradictions) s.contradictions = [];
        // Only add once
        if (!s.contradictions.some(c => c.includes('Sector-wide'))) {
          s.contradictions.push(`Sector-wide decline (${entry.decline}/${entry.total}) — cyclical pressure, not idiosyncratic`);
        }
        // If EXIT due to sector cyclical, soften to HOLD
        if (s.action === 'EXIT' && !s.isNegative) {
          s.action = 'HOLD';
          s.decision = 'HOLD';
        }
      }
    }
  }

  // ── PRICE REACTION LAYER ──
  // Check if negative news is already priced in
  for (const s of filtered) {
    if (s.lastPrice && s.lastPrice > 0 && s.revenueGrowth !== null && s.revenueGrowth !== undefined) {
      // We need price change data — check if addedPrices are available via portfolio
      // For now, use a heuristic: if fundamentalScore < 40 but the signal is fresh,
      // the market may not have fully reacted yet
      if (s.freshness === 'FRESH' && s.action === 'EXIT') {
        // Fresh negative signal — upgrade urgency
        s.priceReactionNote = 'FRESH negative — market may not have reacted yet';
      } else if (s.freshness === 'STALE' && (s.action === 'EXIT' || s.action === 'TRIM')) {
        // Stale negative signal — likely priced in
        s.priceReactionNote = 'Stale signal — likely already priced in';
        if (s.action === 'EXIT' && !s.isNegative) {
          s.action = 'HOLD';
          s.decision = 'HOLD';
        }
      }
    }
  }

  // ── HOLD BUCKET TIGHTENING ──
  // Cap HOLD at ~25% of total. Excess low-confidence HOLDs → downgrade to WATCH
  const holdSignals = filtered.filter(s => s.action === 'HOLD');
  const maxHold = Math.ceil(filtered.length * 0.25);
  if (holdSignals.length > maxHold) {
    // Sort HOLD signals by confidence — lowest confidence gets downgraded first
    const sortedHolds = holdSignals.sort((a, b) => (a.confidenceScore || 0) - (b.confidenceScore || 0));
    const toDowngrade = sortedHolds.slice(0, holdSignals.length - maxHold);
    for (const s of toDowngrade) {
      if (s.confidenceScore !== undefined && s.confidenceScore < 60) {
        s.action = 'WATCH';
        s.decision = 'WATCH';
        s.tag = s.tag || 'LOW-CONVICTION';
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── WATCH BUCKET SPLIT: ACTIVE vs PASSIVE ──
  // WATCH-ACTIVE: Has catalyst, needs trigger to act
  // WATCH-PASSIVE: No catalyst, monitoring only
  // ══════════════════════════════════════════════════════════════
  for (const s of filtered) {
    if (s.action === 'WATCH') {
      const hasCatalyst = s.catalystStrength === 'STRONG' || s.catalystStrength === 'MODERATE';
      const hasPositiveMomentum = s.sentiment === 'Bullish' || (s.scoreDelta !== undefined && s.scoreDelta > 0);
      const hasEvent = s.eventNovelty === 'NEW' && s.impactPct >= 2;

      if (hasCatalyst || hasPositiveMomentum || hasEvent) {
        s.watchSubtype = undefined;
        s.tag = s.tag || 'WATCH';
      } else {
        s.watchSubtype = undefined;
        s.tag = s.tag || 'WATCH';
      }
    }
  }

  // ── SECTOR CONTEXT: >40% same signal = sector trend → reduce company-specific conviction ──
  const sectorActionMap = new Map<string, Map<string, number>>();
  for (const s of filtered) {
    const sector = s.sector || s.segment || 'Unknown';
    if (!sectorActionMap.has(sector)) sectorActionMap.set(sector, new Map());
    const actionMap = sectorActionMap.get(sector)!;
    actionMap.set(s.action, (actionMap.get(s.action) || 0) + 1);
  }
  for (const s of filtered) {
    const sector = s.sector || s.segment || 'Unknown';
    const actionMap = sectorActionMap.get(sector);
    if (actionMap) {
      const sectorTotal = Array.from(actionMap.values()).reduce((a, b) => a + b, 0);
      const sameActionCount = actionMap.get(s.action) || 0;
      if (sectorTotal >= 3 && sameActionCount / sectorTotal > 0.4) {
        // Sector-wide trend — reduce company-specific conviction
        if (!s.contradictions) s.contradictions = [];
        if (!s.contradictions.some(c => c.includes('Sector trend'))) {
          s.contradictions.push(`Sector trend: ${sameActionCount}/${sectorTotal} signals are ${s.action} — less company-specific`);
        }
      }
    }
  }

  // ── Portfolio Impact Scoring: (positionWeight) × (signalScore) ──
  // positionWeight defaults to equal-weight (1/portfolioSize) when position sizes unavailable
  const pfSize = portfolio.length || 1;
  for (const s of filtered) {
    if (s.isPortfolio) {
      const posWeight = 1 / pfSize; // Equal weight fallback
      s.portfolioImpactScore = Math.round(s.weightedScore * posWeight * 100);
      // Portfolio context: lower tolerance for negative signals on larger positions
      // High position weight + negative signal = urgently flag
      if (s.isNegative && posWeight >= 0.1) {
        // Large position with negative signal — upgrade urgency
        if (s.action === 'HOLD') {
          s.action = 'TRIM';
          s.decision = 'TRIM';
          s.decisionReason = `Portfolio position (${(posWeight*100).toFixed(0)}% weight) — negative signal demands action`;
        }
      }
    }
    // Data confidence flag (legacy) + v4 orthogonal axes if not yet set
    if (s.confidenceType === 'ACTUAL' && s.valueSource === 'EXACT') {
      s.dataConfidence = 'VERIFIED';
    } else if (s.confidenceType === 'INFERRED') {
      s.dataConfidence = 'ESTIMATED';
    } else {
      s.dataConfidence = 'LOW';
    }
    // v4: Ensure sourceTier/dataQuality are set for all signals
    if (!s.sourceTier) {
      s.sourceTier = classifySourceTier(s.confidenceType || 'HEURISTIC', s.valueSource || 'HEURISTIC', s.dataSource);
    }
    if (!s.dataQuality) {
      s.dataQuality = classifyDataQuality(
        s.confidenceType || 'HEURISTIC', s.valueSource || 'HEURISTIC',
        s.confidenceScore || 50, s.impactPct, !!s.heuristicSuppressed, s.guidanceAnomalyFlag
      );
    }
    if (!s.actionScore) {
      s.actionScore = computeActionScore(s.weightedScore, s.sourceTier!, s.dataQuality!);
    }

    // FINAL: Apply 3-layer validation gate
    const validation = validateSignal(s);
    s.signalCategory = validation.disposition === 'ACTIONABLE' ? 'ACTIONABLE' :
                        validation.disposition === 'MONITOR' ? 'MONITOR' : 'REJECTED';
    s.verified = validation.disposition === 'ACTIONABLE';
    s.confidenceLayer = validation.disposition === 'ACTIONABLE' ? 100 :
                         validation.disposition === 'MONITOR' ? 60 : 0;
    s.observationReason = validation.rejectReason;
    s.monitorScore = validation.monitorScore;
    s.monitorTier = validation.monitorScore >= 80 ? 'HIGH' : validation.monitorScore >= 50 ? 'MED' : 'LOW';

    // Zero Inference Policy: sanitize display
    sanitizeForDisplay(s, validation.isInferred);

    // EVENT CLASS SANITIZATION: strip synthetic numbers from non-financial events
    sanitizeByEventClass(s);

    // ── v7: PRODUCTION DECISION ENGINE ──
    // 1. Classify signal + extract role
    s.signalClass = s.signalClass || classifySignalClass(s.eventType, s.headline, s.whyItMatters);
    s.managementRole = extractManagementRole(s.headline, s.whyItMatters);

    // 2. False classification guard
    if (s.signalClass === 'GOVERNANCE' && !isRealMgmtChange(s.headline, s.whyItMatters, s.dataSource)) {
      s.signalClass = 'COMPLIANCE';
    }

    // 3. Governance materiality ladder
    if (s.signalClass === 'GOVERNANCE') {
      const govLevel = governanceMateriality(s.managementRole || 'Other');
      const mgmtType = classifyMgmtChangeType(s);
      if (mgmtType === 'ROUTINE') {
        s.materialityScore = Math.round((s.materialityScore || 0) * 0.3);
        s.visibility = 'DIMMED';
      } else if (govLevel === 'LOW' || govLevel === 'VERY_LOW') {
        s.materialityScore = Math.round((s.materialityScore || 0) * 0.3);
        s.visibility = 'DIMMED';
      } else if (govLevel === 'MEDIUM') {
        s.materialityScore = Math.round((s.materialityScore || 0) * 0.6);
        s.visibility = 'DIMMED';
      } else {
        s.visibility = 'VISIBLE';
      }
    }

    // 4. Compute materiality score
    s.materialityScore = s.materialityScore || computeMaterialityScore(s);

    // 5. Determine visibility
    if (!s.visibility) {
      s.visibility = determineVisibility(s);
    }

    // 6. ★ HARD GATING: Confidence-based promotion limits ★
    const confScore = s.dataConfidenceScore || s.confidenceScore || 50;
    const isInferredSignal = s.inferenceUsed || s.confidenceType === 'HEURISTIC' || s.confidenceType === 'INFERRED';
    const isVerifiedSource = s.confidenceType === 'ACTUAL' || s.sourceTier === 'VERIFIED';

    // RULE 1: confidence < 60 → CANNOT be ACTIONABLE or PORTFOLIO_CRITICAL
    if (confScore < 60) {
      if (s.signalCategory === 'ACTIONABLE') s.signalCategory = 'MONITOR';
      s.portfolioCritical = false;
    }

    // RULE 2: inferred + confidence < 70 → max level MONITOR
    if (isInferredSignal && confScore < 70) {
      if (s.signalCategory === 'ACTIONABLE') s.signalCategory = 'MONITOR';
      s.portfolioCritical = false;
    }

    // RULE 3: Economic signals (CAPEX/M&A/ORDER) need verification
    if (['Capex/Expansion', 'M&A', 'Order Win', 'Contract'].includes(s.eventType)) {
      if (!isVerifiedSource) {
        s.materialityScore = Math.min(s.materialityScore || 0, 55);
      }
    }

    // RULE 4: No impact % → cannot be actionable
    if ((s.impactPct || 0) === 0 && s.signalClass === 'ECONOMIC') {
      if (s.signalCategory === 'ACTIONABLE') s.signalCategory = 'MONITOR';
      s.materialityScore = Math.min(s.materialityScore || 0, 50);
    }

    // 7. Verified signal recovery (only for HIGH confidence verified)
    const isKeyEventType = ['Guidance', 'Earnings', 'Order Win', 'Contract', 'Capex/Expansion', 'M&A'].includes(s.eventType);
    if (isVerifiedSource && isKeyEventType && !isInferredSignal) {
      s.materialityScore = Math.max(s.materialityScore || 0, 55);
      s.visibility = 'VISIBLE';
      // Only promote to ACTIONABLE if confidence >= 70 AND has real impact
      if (confScore >= 70 && Math.abs(s.impactPct || 0) > 3) {
        s.signalCategory = 'ACTIONABLE';
      }
    }

    // 8. ★ PORTFOLIO CRITICAL FILTER ★
    if (s.isPortfolio) {
      s.portfolioCritical = (
        confScore >= 70 &&
        !isInferredSignal &&
        (Math.abs(s.impactPct || 0) >= 3 || ['Guidance', 'Earnings', 'CEO Change', 'CFO Change', 'MD Change'].includes(s.eventType))
      );
    } else {
      s.portfolioCritical = false;
    }

    // 9. Unverified ranking cap
    if (confScore < 40) {
      s.visibility = s.visibility === 'VISIBLE' ? 'DIMMED' : s.visibility;
      s.materialityScore = Math.min(s.materialityScore || 0, 40);
    } else if (confScore < 50) {
      s.materialityScore = Math.min(s.materialityScore || 0, 55);
    }

    // 10. ★ v7 COMPOSITE RANK SCORE ★
    s.v7RankScore = computeV7RankScore(s);

    // 11. Action from materiality (with hard gating enforced)
    if (s.signalCategory !== 'REJECTED') {
      s.action = actionFromMateriality(s);
    }

    // 12. Override whyItMatters
    const newWhy = buildWhyThisMatters(s);
    if (newWhy && newWhy.length > 10) {
      s.whyItMatters = newWhy;
    }

    // 13. Governance scoring penalty
    if (s.signalClass === 'GOVERNANCE') {
      s.monitorScore = Math.round((s.monitorScore || 0) * 0.5);
      s.monitorTier = s.monitorScore >= 80 ? 'HIGH' : s.monitorScore >= 50 ? 'MED' : 'LOW';
      s.catalystStrength = 'WEAK';
    }

    // 14. ★ SIGNAL TIER CLASSIFICATION (ACTIONABLE / NOTABLE / MONITOR) ★
    // Notable = score 50-70, confidence >= 50, not rejected
    if (s.signalCategory === 'MONITOR' && s.materialityScore >= 50 && confScore >= 50) {
      s.signalTierV7 = 'NOTABLE';
    } else if (s.signalCategory === 'ACTIONABLE') {
      s.signalTierV7 = 'ACTIONABLE';
    } else {
      s.signalTierV7 = 'MONITOR';
    }

    // 15. HIDDEN signals → REJECTED
    if (s.visibility === 'HIDDEN') {
      s.signalCategory = 'REJECTED';
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── FINAL: 4-LAYER OUTPUT (v7) ──
  // ACTIONABLE: verified, high-confidence, real impact (max 3)
  // NOTABLE: medium impact, some uncertainty (max 5)
  // MONITOR: low-impact, routine governance (max 10)
  // REJECTED: dropped entirely
  // ══════════════════════════════════════════════════════════════

  const actionableSignals: IntelSignal[] = [];
  const notableSignals: IntelSignal[] = [];
  const monitorSignals: IntelSignal[] = [];
  let rejectedCount = 0;

  for (const s of filtered) {
    if (s.signalCategory === 'REJECTED' || s.visibility === 'HIDDEN') {
      rejectedCount++;
    } else if (s.signalCategory === 'ACTIONABLE') {
      actionableSignals.push(s);
    } else if (s.signalTierV7 === 'NOTABLE') {
      notableSignals.push(s);
    } else if (s.signalCategory === 'MONITOR') {
      monitorSignals.push(s);
    } else {
      rejectedCount++;
    }
  }

  // Sort ALL by v7RankScore (composite ranking)
  actionableSignals.sort((a, b) => (b.v7RankScore || 0) - (a.v7RankScore || 0));
  notableSignals.sort((a, b) => (b.v7RankScore || 0) - (a.v7RankScore || 0));
  monitorSignals.sort((a, b) => (b.v7RankScore || 0) - (a.v7RankScore || 0));

  // Enforce output constraints
  const MAX_ACTIONABLE = 3;
  const MAX_NOTABLE = 5;
  const MAX_MONITOR = 10;

  // Overflow: excess actionable → notable, excess notable → monitor
  if (actionableSignals.length > MAX_ACTIONABLE) {
    notableSignals.unshift(...actionableSignals.splice(MAX_ACTIONABLE));
  }
  if (notableSignals.length > MAX_NOTABLE) {
    monitorSignals.unshift(...notableSignals.splice(MAX_NOTABLE));
  }

  // ── FEED COMPOSITION: max 10 visible, balanced by signal class ──
  const allVisible = [...actionableSignals, ...notableSignals, ...monitorSignals.slice(0, MAX_MONITOR)];
  const composedFeed = enforceFeedComposition(allVisible);

  const noActionableSignals = actionableSignals.length === 0;
  const noHighConfSignals = actionableSignals.length === 0;

  // Top signals from composed feed (max 5 for hero cards)
  const top3 = composedFeed.slice(0, 5);

  // ── Production Status Check ──
  const totalActive = actionableSignals.length + notableSignals.length + monitorSignals.length;
  const totalProcessed = totalActive + rejectedCount;
  const rejectedPct = totalProcessed > 0 ? (rejectedCount / totalProcessed) * 100 : 0;
  const hybridStates = 0;
  const inferredInActive = actionableSignals.filter(s => s.inferenceUsed).length;

  const productionReady = (
    actionableSignals.length <= MAX_ACTIONABLE &&
    hybridStates === 0 &&
    inferredInActive === 0
  );

  const sectorSet = new Set<string>();
  let totalOrderValueCr = 0;
  let totalDealValueCr = 0;
  let holdCount = 0;
  let monitorCount = notableSignals.length + monitorSignals.length;
  let reduceExitCount = 0;
  let highImpactCount = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let portfolioAlerts = 0;
  let negativeSignals = 0;

  for (const s of [...actionableSignals, ...notableSignals, ...monitorSignals]) {
    if (s.segment) sectorSet.add(s.segment);
    if (s.source === 'order' && s.valueCr) totalOrderValueCr += s.valueCr;
    if (s.source === 'deal' && s.valueCr) totalDealValueCr += s.valueCr;
    if (s.action === 'HOLD') holdCount++;
    if (s.action === 'TRIM' || s.action === 'EXIT') reduceExitCount++;
    if (s.impactLevel === 'HIGH') highImpactCount++;
    if (s.sentiment === 'Bullish') bullishCount++;
    if (s.sentiment === 'Bearish') bearishCount++;
    if (s.isPortfolio && s.signalCategory === 'ACTIONABLE') portfolioAlerts++;
    if (s.isNegative) negativeSignals++;
  }

  const netBias: DailyBias['netBias'] = bullishCount > bearishCount + 2 ? 'Bullish' :
                                         bearishCount > bullishCount + 2 ? 'Bearish' : 'Neutral';
  const activeSectors = Array.from(sectorSet).slice(0, 5);

  const biasParts: string[] = [];
  if (actionableSignals.length > 0) biasParts.push(`${actionableSignals.length} Actionable`);
  if (notableSignals.length > 0) biasParts.push(`${notableSignals.length} Notable`);
  if (monitorSignals.length > 0) biasParts.push(`${monitorSignals.length} Monitor`);
  biasParts.push(`${rejectedCount} Rejected`);
  biasParts.push(`Net: ${netBias}`);
  const biasStr = biasParts.join(' · ');

  const bias: DailyBias = {
    netBias, highImpactCount, activeSectors,
    buyWatchCount: 0, holdCount, monitorCount, reduceExitCount,
    totalSignals: actionableSignals.length,
    totalObservations: notableSignals.length + monitorSignals.length,
    totalOrderValueCr: Math.round(totalOrderValueCr),
    totalDealValueCr: Math.round(totalDealValueCr),
    portfolioAlerts, negativeSignals,
    summary: biasStr,
    buyCount: 0, addCount: 0, watchCount: monitorCount, trimExitCount: reduceExitCount,
  };

  for (const s of filtered) {
    if (s.source === 'deal') debug.signalsBySource.deal++;
    else debug.signalsBySource.nse++;
  }
  debug.totalSignalsAfterDedup = filtered.length;

  // ── Score Momentum: compare with previous run ──
  try {
    const prevSignals = await kvGet<IntelligenceResponse>(PROD_SIGNALS_KEY);
    if (prevSignals?.signals) {
      const prevScoreMap = new Map<string, number>();
      for (const ps of prevSignals.signals) {
        prevScoreMap.set(ps.symbol, ps.weightedScore);
      }
      for (const s of [...actionableSignals, ...monitorSignals]) {
        const prev = prevScoreMap.get(s.symbol);
        if (prev !== undefined) {
          s.scoreDelta = s.weightedScore - prev;
        }
      }
    }
  } catch { /* best effort */ }

  // ── Sector Intelligence Layer ──
  const sectorScoreMap = new Map<string, { total: number; count: number }>();
  for (const s of [...actionableSignals, ...monitorSignals]) {
    const sector = s.segment || 'Other';
    const existing = sectorScoreMap.get(sector) || { total: 0, count: 0 };
    existing.total += s.weightedScore;
    existing.count++;
    sectorScoreMap.set(sector, existing);
  }
  for (const s of [...actionableSignals, ...monitorSignals]) {
    const sector = s.segment || 'Other';
    const sectorData = sectorScoreMap.get(sector);
    if (sectorData && sectorData.count > 0) {
      s.sectorScore = Math.round(sectorData.total / sectorData.count);
      s.sectorTrend = s.sectorScore >= 60 ? 'Bullish' : s.sectorScore >= 40 ? 'Neutral' : 'Bearish';
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[Compute] FINAL: ${actionableSignals.length} actionable, ${monitorSignals.length} monitor, ${rejectedCount} rejected (${rejectedPct.toFixed(0)}%) in ${duration}ms | STATUS=${productionReady ? 'PRODUCTION_READY' : 'REFINEMENT_REQUIRED'}`);

  return {
    top3,
    signals: actionableSignals.slice(0, MAX_ACTIONABLE),
    notable: notableSignals.slice(0, MAX_NOTABLE),
    observations: monitorSignals.slice(0, MAX_MONITOR),
    trends: trends.slice(0, 10),
    bias,
    updatedAt: new Date().toISOString(),
    noHighConfSignals,
    noActionableSignals,
    _debug: { ...debug, rejectedCount, rejectedPct: Math.round(rejectedPct), productionReady, status: productionReady ? 'PRODUCTION_READY' : 'REFINEMENT_REQUIRED' },
  };
}

// ==================== LOCKED COMPUTE PIPELINE ====================

async function runLockedCompute(watchlist: string[], portfolio: string[]): Promise<{
  ok: boolean;
  signalCount: number;
  computedAt: string;
  skipped?: boolean;
  error?: string;
  _debug?: any;
}> {
  // 1. Acquire distributed lock
  const lockAcquired = await kvSetNX(LOCK_KEY, `pid:${Date.now()}`, LOCK_TTL);
  if (!lockAcquired) {
    console.log('[Compute] Lock exists — another compute is running. Skipping.');
    const meta = await kvGet<any>(META_KEY);
    return {
      ok: true,
      signalCount: meta?.signalCount || 0,
      computedAt: meta?.computedAt || new Date().toISOString(),
      skipped: true,
    };
  }

  try {
    // 2. Perform compute
    const response = await performComputeLogic(watchlist, portfolio);

    // v5: Check both signals (actionable) and observations for emptiness
    const totalOutput = (response?.signals?.length || 0) + (response?.observations?.length || 0);
    if (!response || totalOutput === 0) {
      // Don't overwrite good data with empty
      const existing = await kvGet<any>(PROD_SIGNALS_KEY);
      if (existing) {
        console.log('[Compute] Empty result — preserving existing data');
        return { ok: true, signalCount: existing.signals?.length || 0, computedAt: new Date().toISOString() };
      }
    }

    // 3. Atomic write: temp → swap
    await kvSet(TEMP_SIGNALS_KEY, response, STORE_TTL);
    const swapped = await kvSwap(TEMP_SIGNALS_KEY, PROD_SIGNALS_KEY, STORE_TTL);
    if (!swapped) {
      // Fallback: direct write
      await kvSet(PROD_SIGNALS_KEY, response, STORE_TTL);
      console.warn('[Compute] Swap failed, used direct write');
    }

    // 4. Update metadata with version hash
    const signalHash = response.signals.slice(0, 10)
      .map((s: any) => `${s.symbol}:${s.valueCr}:${s.score}`)
      .join('|');
    const version = Array.from(signalHash).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);

    await kvSet(META_KEY, {
      computedAt: new Date().toISOString(),
      signalCount: response.signals.length,
      version,
      signalHash,
      ttl: STORE_TTL,
    }, STORE_TTL);

    const totalStored = (response.signals?.length || 0) + (response.observations?.length || 0);
    console.log(`[Compute] Done: ${response.signals.length} actionable + ${response.observations?.length || 0} observations stored atomically`);
    return { ok: true, signalCount: totalStored, computedAt: new Date().toISOString(), _debug: response._debug };
  } catch (error) {
    console.error('[Compute] Pipeline error:', error);
    return { ok: false, signalCount: 0, computedAt: new Date().toISOString(), error: (error as Error).message };
  } finally {
    // 5. Release lock
    await kvDel(LOCK_KEY);
  }
}

// ==================== AUTO-LOAD SYMBOLS ====================

const DEFAULT_CHAT_ID = '5057319640';

// Fallback symbols if Redis portfolio/watchlist are empty
const DEFAULT_TRACKED_SYMBOLS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT',
  'SBIN', 'AXISBANK', 'BAJFINANCE', 'MARUTI', 'HCLTECH',
  'SUNPHARMA', 'TATAMOTORS', 'TITAN', 'NTPC', 'POWERGRID',
  'WIPRO', 'ADANIENT', 'ULTRACEMCO', 'JSWSTEEL', 'TATASTEEL',
  'ONGC', 'COALINDIA', 'BAJAJFINSV', 'TECHM', 'DRREDDY',
];

async function autoLoadSymbols(): Promise<{ watchlist: string[]; portfolio: string[] }> {
  let watchlist: string[] = [];
  let portfolio: string[] = [];

  try {
    // Try loading from Redis (same keys the frontend uses)
    const wlData = await kvGet<any>(`watchlist:${DEFAULT_CHAT_ID}`);
    if (wlData) {
      if (Array.isArray(wlData)) {
        watchlist = wlData.map((s: string) => normalizeTicker(s)).filter(Boolean);
      } else if (wlData.watchlist && Array.isArray(wlData.watchlist)) {
        watchlist = wlData.watchlist.map((s: string) => normalizeTicker(s)).filter(Boolean);
      }
    }
  } catch (e) {
    console.warn('[Compute] Failed to load watchlist from Redis:', (e as Error).message);
  }

  try {
    const pfData = await kvGet<any>(`portfolio:${DEFAULT_CHAT_ID}`);
    if (pfData?.holdings && Array.isArray(pfData.holdings)) {
      portfolio = pfData.holdings.map((h: any) => normalizeTicker(h.symbol || h)).filter(Boolean);
    }
  } catch (e) {
    console.warn('[Compute] Failed to load portfolio from Redis:', (e as Error).message);
  }

  // If both are empty, use defaults so MC/Google News fallback can kick in
  if (watchlist.length === 0 && portfolio.length === 0) {
    console.log('[Compute] No portfolio/watchlist in Redis — using default Nifty 30 symbols');
    watchlist = [...DEFAULT_TRACKED_SYMBOLS];
  }

  console.log(`[Compute] Auto-loaded: ${watchlist.length} watchlist, ${portfolio.length} portfolio`);
  return { watchlist, portfolio };
}

// ==================== ROUTE HANDLERS ====================

export async function GET(request: Request) {
  console.log('[Compute] GET triggered (cron)');
  try {
    // Auto-load portfolio + watchlist from Redis (or use defaults)
    const { watchlist, portfolio } = await autoLoadSymbols();
    const result = await runLockedCompute(watchlist, portfolio);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Compute] Error:', error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  console.log('[Compute] POST triggered');
  try {
    const body = await request.json().catch(() => ({})) as any;
    const watchlist = (body.watchlist || []).map((s: string) => normalizeTicker(s)).filter(Boolean);
    const portfolio = (body.portfolio || []).map((s: string) => normalizeTicker(s)).filter(Boolean);

    const result = await runLockedCompute(watchlist, portfolio);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Compute] Error:', error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
