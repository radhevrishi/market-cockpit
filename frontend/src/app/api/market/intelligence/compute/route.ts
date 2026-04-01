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

type ActionFlag = 'BUY WATCH' | 'TRACK' | 'IGNORE';
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

  signalStackCount?: number;
  signalStackLevel?: 'STRONG' | 'BUILDING' | 'WEAK';
  portfolioImpactScore?: number;
  dataConfidence?: 'VERIFIED' | 'ESTIMATED' | 'LOW';
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
}

interface DailyBias {
  netBias: 'Bullish' | 'Neutral' | 'Bearish';
  highImpactCount: number;
  activeSectors: string[];
  buyWatchCount: number;
  trackCount: number;
  totalSignals: number;
  totalOrderValueCr: number;
  totalDealValueCr: number;
  portfolioAlerts: number;
  negativeSignals: number;
  summary: string;
}

interface IntelligenceResponse {
  top3: IntelSignal[];
  signals: IntelSignal[];
  trends: CompanyTrend[];
  bias: DailyBias;
  updatedAt: string;
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
  'acquisition', 'merger', 'amalgamation', 'buyout', 'demerger',
  'fund raising', 'qip', 'rights issue', 'capital raising', 'preferential allotment',
  'appointment', 'resignation', 'ceo', 'cfo', 'managing director',
  'dividend', 'buyback',
  'guidance', 'outlook', 'forecast', 'target', 'revenue guidance',
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
): ActionFlag {
  if (impactPct >= 5 && sentiment === 'Bullish') return 'BUY WATCH';
  if (impactPct >= 2 && (isWatchlist || isPortfolio) && sentiment !== 'Bearish') return 'BUY WATCH';
  if (impactPct >= 3 && earningsScore !== null && earningsScore >= 60) return 'BUY WATCH';
  if (impactPct >= 10) return 'BUY WATCH';
  return 'TRACK';
}

// ==================== TIME DECAY ====================

function computeTimeWeight(dateStr: string): number {
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
    return Math.max(0.05, parseFloat(Math.exp(-daysOld / 7).toFixed(3)));
  } catch {
    return 0.5;
  }
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
  const { eventType, impactLevel, pctRevenue, pctMcap, valueCr, client, segment, isNegative, buyerSeller, premiumDiscount } = opts;

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
    if (client) return `New order from ${client} — client diversification + execution track record`;
    if (segment === 'Defence' || segment === 'Railways') return `Govt order in ${segment} — long cycle, stable margin profile`;
    return 'New order win — improves revenue pipeline visibility';
  }

  if (eventType === 'Capex/Expansion') {
    if (pctMcap !== null && pctMcap >= 5) return `Large capex at ${pctMcap.toFixed(1)}% of MCap — operating leverage play, watch execution`;
    return 'Capacity expansion — forward revenue visibility, watch ROI timeline';
  }

  if (eventType === 'M&A') {
    if (pctRevenue !== null && pctRevenue >= 10) return 'Transformative acquisition — changes revenue mix significantly';
    if (pctMcap !== null && pctMcap >= 5) return `Material M&A at ${pctMcap.toFixed(1)}% MCap — integration risk but growth potential`;
    return 'Strategic acquisition — improves market position or backward integration';
  }

  if (eventType === 'Demerger') return 'Value unlock — sum-of-parts may exceed current market cap';
  if (eventType === 'Fund Raising') return 'Capital raise — fuels growth but watch dilution impact';
  if (eventType === 'Buyback') return 'Management conviction in undervaluation — capital return signal';
  if (eventType === 'Dividend') return 'Cash return to shareholders — signals healthy cash flow';
  if (eventType === 'JV/Partnership') return 'Strategic partnership — technology or market access play';
  if (eventType === 'Guidance') return 'Management outlook update — forward visibility signal';
  if (eventType === 'Mgmt Change') return 'Leadership transition — watch for strategy continuity';

  if (eventType.includes('Block Buy') || eventType.includes('Bulk Buy')) {
    if (buyerSeller && /mutual fund|fii|institutional/i.test(buyerSeller)) return 'Institutional buying — smart money accumulation signal';
    if (premiumDiscount !== null && premiumDiscount > 2) return `Premium deal at +${premiumDiscount.toFixed(1)}% — buyer conviction strong`;
    return 'Block/bulk buying — institutional interest building';
  }

  if (eventType.includes('Block Sell') || eventType.includes('Bulk Sell')) {
    if (premiumDiscount !== null && premiumDiscount < -2) return `Discount exit at ${premiumDiscount.toFixed(1)}% — urgency to sell, watch supply pressure`;
    return 'Institutional selling — check if rebalancing or conviction change';
  }

  return impactLevel === 'HIGH' ? 'High impact corporate event — direct business impact' :
         impactLevel === 'MEDIUM' ? 'Moderate impact — worth tracking for pattern changes' :
         'Low impact — informational only';
}

// ==================== NEGATIVE SIGNAL DETECTION ====================

function isNegativeSignal(subject: string, desc: string): boolean {
  const combined = `${subject} ${desc}`.toLowerCase();
  return NEGATIVE_KEYWORDS.some(kw => combined.includes(kw));
}

function classifySentiment(eventType: string, isNegative: boolean, isBuyDeal: boolean): SignalSentiment {
  if (isNegative) return 'Bearish';
  if (['Order Win', 'Contract', 'LOI', 'Capex/Expansion', 'Buyback', 'Guidance'].includes(eventType)) return 'Bullish';
  if (['M&A', 'Demerger', 'Fund Raising', 'JV/Partnership'].includes(eventType)) return 'Bullish';
  if (eventType.includes('Buy')) return isBuyDeal ? 'Bullish' : 'Neutral';
  if (eventType.includes('Sell')) return 'Bearish';
  return 'Neutral';
}

// ==================== QUANT SCORE ENGINE ====================

const SIGNAL_TYPE_WEIGHTS: Record<string, number> = {
  'Order Win': 14, 'Contract': 14, 'M&A': 13, 'Capex/Expansion': 12,
  'Demerger': 11, 'Fund Raising': 10, 'LOI': 8, 'JV/Partnership': 9,
  'Buyback': 10, 'Dividend': 6, 'Guidance': 8, 'Mgmt Change': 5,
  'Block Buy': 11, 'Bulk Buy': 10, 'Block Sell': 11, 'Bulk Sell': 10,
  'Corporate': 4,
};

const SECTOR_MULTIPLIER: Record<string, number> = {
  'Infra': 1.2, 'Defence': 1.2, 'Power': 1.15, 'Railways': 1.15,
  'Construction': 1.1, 'Metals': 1.1, 'Oil & Gas': 1.1, 'Chemicals': 1.05,
  'Auto': 1.0, 'Pharma': 0.95, 'Realty': 1.0, 'Telecom': 0.9,
  'IT': 0.8, 'FMCG': 0.7, 'Textiles': 0.9,
};

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
  let score = 0;

  const impactScore = Math.min(40, 40 * (1 - Math.exp(-opts.impactPct / 10)));
  score += impactScore;

  const daysOldApprox = Math.max(0, (1 - opts.timeWeight) / 0.07);
  const freshnessScore = Math.max(0, 15 - daysOldApprox * 1.5);
  score += freshnessScore;

  score += Math.min(15, SIGNAL_TYPE_WEIGHTS[opts.eventType] || 5);

  const confidenceFactor = opts.confidenceScore / 100;
  score = score * confidenceFactor;

  score += opts.sentiment === 'Bullish' ? 5 : opts.sentiment === 'Bearish' ? -3 : 0;

  if (opts.earningsScore !== null) {
    if (opts.earningsScore >= 70) score += 8;
    else if (opts.earningsScore >= 50) score += 4;
    else if (opts.earningsScore < 40) { score -= 10; }
  }

  if (opts.isNegative) score += 5;

  if (opts.isDeal) {
    if (opts.buyerQuality && opts.buyerQuality >= 80) score += 4;
    if (opts.dealPremiumDiscount !== undefined && opts.dealPremiumDiscount !== null && opts.dealPremiumDiscount > 3) score += 2;
  }

  if (opts.sector) {
    const sectorKey = opts.sector.split(' ')[0];
    const mult = SECTOR_MULTIPLIER[sectorKey] || 1.0;
    score *= mult;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ==================== ENRICHMENT ====================

async function enrichSymbol(symbol: string): Promise<StockEnrichment> {
  const result: StockEnrichment = {
    symbol, mcapCr: null, annualRevenueCr: null, revenueSource: null,
    companyName: null, industry: null, lastPrice: null, issuedSize: null,
  };

  try {
    const quotePromise = fetchStockQuote(symbol);
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

    const earnings = await kvGet<EarningsData>(`earnings:${symbol}`);
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
    console.error(`[Compute] Enrich error ${symbol}:`, e);
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
  portfolio.forEach(s => symbolsToEnrich.add(s));
  watchlist.forEach(s => symbolsToEnrich.add(s));
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
      batch.map(symbol =>
        Promise.race([
          enrichSymbol(symbol),
          new Promise<StockEnrichment>(res => setTimeout(() => res({
            symbol, mcapCr: null, annualRevenueCr: null, revenueSource: null,
            companyName: null, industry: null, lastPrice: null, issuedSize: null,
          }), 2000))
        ])
      )
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
    const timeWeight = computeTimeWeight(item.date || getTodayDate());

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

    let action = classifyAction(impactPct, sentiment, isWatchlist, isPortfolio, earningsScore);
    if (earningsBoost) action = 'BUY WATCH';

    const pctMcap = (enrichment?.mcapCr && valueCr > 0)
      ? parseFloat(((valueCr / enrichment.mcapCr) * 100).toFixed(2))
      : null;

    const score = computeScore({
      impactPct, sentiment, timeWeight,
      earningsScore, isNegative: negative, isDeal: false,
      eventType, confidenceScore, sector,
    });
    const weightedScore = Math.round(score * timeWeight);

    const whyItMatters = generateWhyItMatters({
      eventType, impactLevel, pctRevenue: impactPct, pctMcap, valueCr,
      client, segment, isNegative: negative, sentiment, buyerSeller: null, premiumDiscount: null,
    });

    let headline = `${fmtCr(valueCr)} ${eventType}`;
    if (inferenceUsed) headline += ' (est.)';
    if (client) headline += ` from ${client}`;
    const matParts: string[] = [];
    matParts.push(`${impactPct.toFixed(1)}% of revenue`);
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

    const signal: IntelSignal = {
      symbol, company: item.companyName || enrichment?.companyName || symbol,
      date: item.date || getTodayDate(), source: 'order',
      eventType, headline,
      valueCr, valueUsd: `$${((valueCr * 10000000) / INR_TO_USD / 1000000).toFixed(1)}M`,
      mcapCr: enrichment?.mcapCr || null, revenueCr: enrichment?.annualRevenueCr || null,
      impactPct, pctRevenue: impactPct, pctMcap,
      inferenceUsed,
      client, segment, timeline,
      buyerSeller: null, premiumDiscount: null, lastPrice: enrichment?.lastPrice || null,
      impactLevel, impactConfidence: confidenceScore >= 90 ? 'HIGH' : confidenceScore >= 70 ? 'MEDIUM' : 'LOW',
      confidenceScore, confidenceType,
      valueSource,
      action, score, timeWeight, weightedScore, sentiment, whyItMatters,
      isNegative: negative, earningsBoost, isWatchlist, isPortfolio,
      dataSource,
    };

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
    const timeWeight = computeTimeWeight(deal.dealDate || getTodayDate());

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
    const action = classifyAction(dealImpactPct, sentiment, isWatchlist, isPortfolio, earningsScore);

    const score = computeScore({
      impactPct: dealImpactPct, sentiment, timeWeight,
      earningsScore, isNegative: false, isDeal: true,
      eventType, confidenceScore: 85, buyerQuality: buyerQual,
      dealPremiumDiscount: premiumDiscount,
    });
    const weightedScore = Math.round(score * timeWeight);

    const dealHeadline = `${fmtCr(dealValueCr)} ${eventType} — ${deal.clientName}${pctEquity !== null ? ` (${pctEquity.toFixed(2)}% equity)` : ''}${premiumDiscount !== null ? ` @${premiumDiscount > 0 ? '+' : ''}${premiumDiscount.toFixed(1)}%` : ''}`;

    const dealSignal: IntelSignal = {
      symbol, company: enrichment?.companyName || symbol,
      date: deal.dealDate || getTodayDate(), source: 'deal',
      eventType, headline: dealHeadline,
      valueCr: dealValueCr,
      valueUsd: `$${((dealValueCr * 10000000) / INR_TO_USD / 1000000).toFixed(1)}M`,
      mcapCr: enrichment?.mcapCr || null, revenueCr: enrichment?.annualRevenueCr || null,
      impactPct: dealImpactPct, pctRevenue: null, pctMcap: enrichment?.mcapCr ? parseFloat(((dealValueCr / enrichment.mcapCr) * 100).toFixed(2)) : null,
      inferenceUsed: false,
      client: null, segment: null, timeline: null,
      buyerSeller: deal.clientName, premiumDiscount, lastPrice: enrichment?.lastPrice || null,
      impactLevel, impactConfidence: 'HIGH',
      confidenceScore: 85, confidenceType: 'ACTUAL',
      valueSource: 'EXACT',
      action, score, timeWeight, weightedScore, sentiment,
      whyItMatters: generateWhyItMatters({
        eventType, impactLevel, pctRevenue: null, pctMcap: enrichment?.mcapCr ? parseFloat(((dealValueCr / enrichment.mcapCr) * 100).toFixed(2)) : null,
        valueCr: dealValueCr, client: null, segment: null,
        isNegative: isSell, sentiment, buyerSeller: deal.clientName, premiumDiscount,
      }),
      isNegative: isSell, earningsBoost: false, isWatchlist, isPortfolio,
      dataSource: 'NSE',
    };

    const dealDedupKey = `${symbol}:${eventType}:${(deal.dealDate || getTodayDate()).slice(0, 10)}`;
    const existingDeal = dealDedupMap.get(dealDedupKey);
    if (!existingDeal || weightedScore > existingDeal.weightedScore) {
      dealDedupMap.set(dealDedupKey, dealSignal);
    }
  }

  allSignals.push(...dealDedupMap.values());

  // ── Materiality filter: remove noise signals that don't meet thresholds ──
  const materialSignals = allSignals.filter(s => {
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

    const bullish = sigs.filter(s => s.sentiment === 'Bullish').length;
    const bearish = sigs.filter(s => s.sentiment === 'Bearish').length;

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
      });
    }
  }
  trends.sort((a, b) => b.avgScore - a.avgScore);

  // ── Portfolio Impact Scoring: (positionWeight) × (signalScore) ──
  // positionWeight defaults to equal-weight (1/portfolioSize) when position sizes unavailable
  const pfSize = portfolio.length || 1;
  for (const s of filtered) {
    if (s.isPortfolio) {
      const posWeight = 1 / pfSize; // Equal weight fallback
      s.portfolioImpactScore = Math.round(s.weightedScore * posWeight * 100);
    }
    // Data confidence flag
    if (s.confidenceType === 'ACTUAL' && s.valueSource === 'EXACT') {
      s.dataConfidence = 'VERIFIED';
    } else if (s.confidenceType === 'INFERRED') {
      s.dataConfidence = 'ESTIMATED';
    } else {
      s.dataConfidence = 'LOW';
    }
  }

  const top3 = filtered.filter(s => s.action !== 'IGNORE').slice(0, 3);

  const sectorSet = new Set<string>();
  let totalOrderValueCr = 0;
  let totalDealValueCr = 0;
  let buyWatchCount = 0;
  let trackCount = 0;
  let highImpactCount = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let portfolioAlerts = 0;
  let negativeSignals = 0;

  for (const s of filtered) {
    if (s.segment) sectorSet.add(s.segment);
    if (s.source === 'order' && s.valueCr) totalOrderValueCr += s.valueCr;
    if (s.source === 'deal' && s.valueCr) totalDealValueCr += s.valueCr;
    if (s.action === 'BUY WATCH') buyWatchCount++;
    if (s.action === 'TRACK') trackCount++;
    if (s.impactLevel === 'HIGH') highImpactCount++;
    if (s.sentiment === 'Bullish') bullishCount++;
    if (s.sentiment === 'Bearish') bearishCount++;
    if (s.isPortfolio && s.action !== 'IGNORE') portfolioAlerts++;
    if (s.isNegative) negativeSignals++;
  }

  const netBias: DailyBias['netBias'] = bullishCount > bearishCount + 2 ? 'Bullish' :
                                         bearishCount > bullishCount + 2 ? 'Bearish' : 'Neutral';
  const activeSectors = Array.from(sectorSet).slice(0, 5);

  const biasParts: string[] = [];
  if (highImpactCount > 0) biasParts.push(`${highImpactCount} High Impact`);
  if (buyWatchCount > 0) biasParts.push(`${buyWatchCount} BUY WATCH`);
  if (negativeSignals > 0) biasParts.push(`${negativeSignals} ⚠ Negative`);
  if (portfolioAlerts > 0) biasParts.push(`${portfolioAlerts} Portfolio Alert${portfolioAlerts > 1 ? 's' : ''}`);
  biasParts.push(`Net: ${netBias}`);
  const biasStr = biasParts.join(' · ');

  const bias: DailyBias = {
    netBias, highImpactCount, activeSectors, buyWatchCount, trackCount,
    totalSignals: filtered.length,
    totalOrderValueCr: Math.round(totalOrderValueCr),
    totalDealValueCr: Math.round(totalDealValueCr),
    portfolioAlerts, negativeSignals,
    summary: biasStr,
  };

  for (const s of filtered) {
    if (s.source === 'deal') debug.signalsBySource.deal++;
    else debug.signalsBySource.nse++;
  }
  debug.totalSignalsAfterDedup = filtered.length;

  const duration = Date.now() - startTime;
  console.log(`[Compute] Done: ${filtered.length} signals, ${top3.length} top3, ${trends.length} trends in ${duration}ms`);

  return {
    top3,
    signals: filtered.slice(0, 100),
    trends: trends.slice(0, 10),
    bias,
    updatedAt: new Date().toISOString(),
    _debug: debug,
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

    if (!response || !response.signals || response.signals.length === 0) {
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

    console.log(`[Compute] Done: ${response.signals.length} signals stored atomically`);
    return { ok: true, signalCount: response.signals.length, computedAt: new Date().toISOString(), _debug: response._debug };
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
