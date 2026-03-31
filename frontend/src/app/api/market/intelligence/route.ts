import { NextResponse } from 'next/server';
import { nseApiFetch, fetchStockQuote } from '@/lib/nse';
import { normalizeTicker } from '@/lib/tickers';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

const INR_TO_USD = 85;

// ==================== ROUTE-LEVEL CACHE (BUG-01 fix) ====================
// 3-minute in-memory cache for the full intelligence response
// Prevents re-computation on rapid page reloads / tab switches
const ROUTE_CACHE_TTL = 180_000;
let _routeCache: { key: string; data: any; timestamp: number } | null = null;

// ==================== MONEYCONTROL NEWS SCRAPER ====================
// Fallback data source when NSE API fails/returns empty

const MC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://www.moneycontrol.com/',
};

// MC company slug resolution cache (in-memory)
const MC_SLUG_CACHE = new Map<string, string>();

async function resolveMCSlug(symbol: string): Promise<string | null> {
  if (MC_SLUG_CACHE.has(symbol)) return MC_SLUG_CACHE.get(symbol)!;
  try {
    const url = `https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?classic=true&query=${encodeURIComponent(symbol)}&type=1&format=json&callback=`;
    const res = await fetch(url, { headers: MC_HEADERS, signal: AbortSignal.timeout(5000) });
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

/** Fetch Moneycontrol news for tracked symbols — returns announcements in NSE-like format */
async function fetchMoneycontrolNews(symbols: string[]): Promise<MCNewsItem[]> {
  const allNews: MCNewsItem[] = [];
  const batchSize = 4; // Parallel requests

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async (sym) => {
      try {
        // Use MC stock news RSS/JSON endpoint
        const slug = await resolveMCSlug(sym);
        if (!slug) return [];

        // Try MC stock news page scrape
        const newsUrl = `https://www.moneycontrol.com/stocks/company_info/stock_news.php?sc_id=${encodeURIComponent(slug)}&scat=&pageno=1&next=0&duression=latest&search_type=`;
        const res = await fetch(newsUrl, {
          headers: MC_HEADERS,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        const html = await res.text();

        // Parse news items from HTML
        const items: MCNewsItem[] = [];
        // MC news page uses <li class="clearfix"> with links and titles
        const liRegex = /<li[^>]*class="clearfix"[^>]*>([\s\S]*?)<\/li>/gi;
        let liMatch;
        while ((liMatch = liRegex.exec(html)) !== null) {
          const liContent = liMatch[1];
          // Extract title from <a> tag
          const titleMatch = liContent.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
          const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
          // Extract date
          const dateMatch = liContent.match(/(\w+\s+\d+,\s+\d{4}\s+\d+:\d+\s*(?:AM|PM|IST))/i) ||
                           liContent.match(/<span[^>]*>([^<]+)<\/span>/);
          const dateStr = dateMatch ? dateMatch[1].trim() : new Date().toISOString();
          // Extract URL
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

        // Fallback: try parsing by anchor pattern if li parsing got nothing
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

        return items.slice(0, 10); // Max 10 news per stock
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

/** Fetch Google News RSS for Indian stock announcements — broad market fallback */
async function fetchGoogleNewsRSS(symbols: string[]): Promise<MCNewsItem[]> {
  const allNews: MCNewsItem[] = [];
  // Fetch for batches of symbols
  const queryGroups: string[][] = [];
  for (let i = 0; i < symbols.length; i += 5) {
    queryGroups.push(symbols.slice(i, i + 5));
  }

  for (const group of queryGroups.slice(0, 4)) { // Max 4 queries
    try {
      const query = group.map(s => `"${s}" NSE`).join(' OR ') + ' (order OR contract OR acquisition OR expansion OR capex)';
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': MC_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const xml = await res.text();

      // Parse RSS items
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(xml)) !== null) {
        const content = match[1];
        const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() || '';
        const pubDate = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
        const link = content.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';

        // Match to a symbol
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

// ==================== SIGNAL CACHE (KV-backed) ====================
// When fresh data is available → cache it
// When all sources fail → serve stale cache

const SIGNAL_CACHE_KEY = 'intelligence:signals:latest';
const SIGNAL_CACHE_TTL = 6 * 60 * 60; // 6 hours

async function cacheSignals(data: any): Promise<void> {
  try {
    await kvSet(SIGNAL_CACHE_KEY, { ...data, cachedAt: Date.now() }, SIGNAL_CACHE_TTL);
  } catch {}
}

async function getCachedSignals(): Promise<any | null> {
  try {
    return await kvGet<any>(SIGNAL_CACHE_KEY);
  } catch { return null; }
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

  // Event
  eventType: string;
  headline: string;

  // Quantified — ALWAYS populated (inferred if not explicit)
  valueCr: number;              // NEVER null — inferred if not extracted
  valueUsd: string | null;
  mcapCr: number | null;
  revenueCr: number | null;
  impactPct: number;            // (valueCr / revenueCr) * 100 — CORE METRIC
  pctRevenue: number | null;    // Legacy alias for impactPct
  pctMcap: number | null;
  inferenceUsed: boolean;       // True if value was inferred, not extracted

  // Context
  client: string | null;
  segment: string | null;
  timeline: string | null;
  buyerSeller: string | null;
  premiumDiscount: number | null;
  lastPrice: number | null;         // Current stock price for performance tracking

  // Classification — UPGRADED v4
  impactLevel: ImpactLevel;       // HIGH / MEDIUM / LOW
  impactConfidence: 'HIGH' | 'MEDIUM' | 'LOW'; // Legacy — derived from confidenceScore
  confidenceScore: number;        // 90=ACTUAL / 70=INFERRED / 50=HEURISTIC
  confidenceType: 'ACTUAL' | 'INFERRED' | 'HEURISTIC';
  action: ActionFlag;             // BUY WATCH / TRACK / IGNORE
  score: number;                  // 0-100 (quant-based)
  timeWeight: number;             // 0-1 (time decay)
  weightedScore: number;          // score * timeWeight
  sentiment: SignalSentiment;
  whyItMatters: string;           // 1-line: "Improves backward integration → margin expansion likely"
  isNegative: boolean;            // Negative signal flag
  earningsBoost: boolean;         // True if earnings data boosts this signal

  isWatchlist: boolean;
  isPortfolio: boolean;

  // Source traceability
  dataSource?: string;  // 'NSE' | 'Moneycontrol' | 'Google News' | 'Block Deal' | 'Bulk Deal'

  // Trend stacking (set at aggregation)
  signalStackCount?: number;
  signalStackLevel?: 'STRONG' | 'BUILDING' | 'WEAK';
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
  trends: CompanyTrend[];       // Signal stacking per company
  bias: DailyBias;
  updatedAt: string;
}

// ==================== ENRICHMENT DATA ====================

interface StockEnrichment {
  symbol: string;
  mcapCr: number | null;
  annualRevenueCr: number | null;       // Best available: TTM > FY > sum of available quarters
  revenueSource: 'TTM' | 'FY' | 'PARTIAL' | null;  // How revenue was derived
  companyName: string | null;
  industry: string | null;
  lastPrice: number | null;
  issuedSize: number | null;
}

interface EarningsData {
  quarters?: Array<{ revenue?: number; quarter?: string }>;
  annualRevenue?: number;               // FY annual revenue if available
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
  // Order/Contract wins (HIGH VALUE — institutional favorite)
  'order', 'contract', 'awarded', 'loi', 'letter of intent',
  'work order', 'purchase order', 'mandate', 'supply agreement',
  'signed', 'obtained', 'bagging', 'receiving of orders',
  // Capex / Expansion (institutional catalyst)
  'capex', 'capital expenditure', 'expansion', 'new plant', 'new facility',
  'greenfield', 'brownfield', 'capacity addition', 'capacity expansion',
  // Strategic moves
  'joint venture', 'jv', 'partnership', 'mou', 'collaboration',
  'acquisition', 'merger', 'amalgamation', 'buyout', 'demerger',
  // Capital raises
  'fund raising', 'qip', 'rights issue', 'capital raising', 'preferential allotment',
  // Key leadership
  'appointment', 'resignation', 'ceo', 'cfo', 'managing director',
  // Shareholder returns
  'dividend', 'buyback',
  // Guidance / Outlook
  'guidance', 'outlook', 'forecast', 'target', 'revenue guidance',
];

// Noise patterns — these make an event ignorable
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

// Negative signal keywords — bearish events the market cares about
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

function parseOrderValue(text: string): number | null {
  if (!text) return null;
  const s = text;  // Keep original case for ₹ symbol matching

  // ── Priority-ordered regex patterns (most specific → least) ──
  // All patterns are case-insensitive via /i flag

  // Pattern 1: "worth ₹X crore" / "valued at ₹X crore" / "LOA of ₹X crore"
  const worthMatch = s.match(/(?:worth|valued\s+at|loa\s+of|loa\s+for|value\s+of|amounting\s+to|aggregating|totalling|order\s+of|contract\s+of|for\s+a\s+consideration\s+of|order\s+book\s+of|contract\s+price|project\s+value|deal\s+size)\s*(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/i);
  if (worthMatch) return parseFloat(worthMatch[1].replace(/,/g, ''));

  // Pattern 2: "₹X crore contract/order/deal/project"
  const prefixedMatch = s.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|crores|cr)\s*(?:order|contract|deal|project|mandate|loa|letter|work)/i);
  if (prefixedMatch) return parseFloat(prefixedMatch[1].replace(/,/g, ''));

  // Pattern 3: "LOI/LOA...₹X" / "LOI...₹X crore"
  const loiMatch = s.match(/(?:loi|loa|letter\s+of\s+(?:intent|award))[^₹\d]*(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|crores|cr)?\b/i);
  if (loiMatch) {
    const val = parseFloat(loiMatch[1].replace(/,/g, ''));
    // If no crore/cr suffix, determine if it's Cr or Lakhs
    if (!/crore|cr/i.test(loiMatch[0])) {
      if (val >= 10000) return val / 100; // lakhs → Cr
      return val > 0.5 ? val : null;
    }
    return val;
  }

  // Pattern 4: Standard "Rs X Cr" / "₹ X Crore"
  const crMatch = s.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/i);
  if (crMatch) return parseFloat(crMatch[1].replace(/,/g, ''));

  // Pattern 5: Standalone "X crore(s)" / "X Cr" (e.g. "1,200 Crores")
  const standaloneCr = s.match(/\b([\d,]+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/i);
  if (standaloneCr) {
    const val = parseFloat(standaloneCr[1].replace(/,/g, ''));
    if (val > 0.5) return val;
  }

  // Pattern 6: ₹ Lakh → Cr
  const lMatch = s.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs|l)\b/i);
  if (lMatch) return parseFloat(lMatch[1].replace(/,/g, '')) / 100;

  // Pattern 7: Standalone Lakh → Cr
  const standaloneLakh = s.match(/\b([\d,]+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs)\b/i);
  if (standaloneLakh) {
    const val = parseFloat(standaloneLakh[1].replace(/,/g, '')) / 100;
    if (val > 0.01) return val;
  }

  // Pattern 8: USD Million → Cr (with FX conversion)
  const usdMnMatch = s.match(/(?:usd|\$|us\$|us\s*dollar)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
  if (usdMnMatch) return (parseFloat(usdMnMatch[1].replace(/,/g, '')) * INR_TO_USD) / 10;

  // Pattern 9: "X million USD/dollars" (reversed)
  const mnUsdMatch = s.match(/\b([\d,]+(?:\.\d+)?)\s*(?:million|mn)\s*(?:usd|us\s*dollar|dollar)/i);
  if (mnUsdMatch) return (parseFloat(mnUsdMatch[1].replace(/,/g, '')) * INR_TO_USD) / 10;

  // Pattern 10: USD Billion → Cr
  const usdBnMatch = s.match(/(?:usd|\$|us\$)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/i);
  if (usdBnMatch) return parseFloat(usdBnMatch[1].replace(/,/g, '')) * INR_TO_USD * 100;

  // Pattern 11: "X billion USD/dollars" (reversed)
  const bnUsdMatch = s.match(/\b([\d,]+(?:\.\d+)?)\s*(?:billion|bn)\s*(?:usd|us\s*dollar|dollar)/i);
  if (bnUsdMatch) return parseFloat(bnUsdMatch[1].replace(/,/g, '')) * INR_TO_USD * 100;

  // Pattern 12: Plain $X (USD, no unit → assume millions if < 1000, else direct)
  const plainUsd = s.match(/\$\s*([\d,]+(?:\.\d+)?)\b/i);
  if (plainUsd) {
    const val = parseFloat(plainUsd[1].replace(/,/g, ''));
    if (val >= 1000) return (val * INR_TO_USD) / 10; // millions
    if (val >= 1) return (val * INR_TO_USD) / 10;     // millions
  }

  // Pattern 13: INR Million → Cr
  const inrMnMatch = s.match(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn)\b/i);
  if (inrMnMatch) return parseFloat(inrMnMatch[1].replace(/,/g, '')) / 10;

  // Pattern 14: Contextual bare numbers ("worth X", "valued at X", "order book of X")
  const bareNum = s.match(/(?:value|worth|amount|aggregating|totalling|size|approximately|approx|around|about|estimated|consideration)\s*(?:of\s+)?(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)/i);
  if (bareNum) {
    const val = parseFloat(bareNum[1].replace(/,/g, ''));
    if (val >= 10000) return val / 100; // lakhs → Cr
    if (val >= 10) return val; // likely Cr
  }

  // Pattern 15: EUR → Cr via USD proxy
  const eurMatch = s.match(/(?:eur|€|euro)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/i);
  if (eurMatch) return (parseFloat(eurMatch[1].replace(/,/g, '')) * INR_TO_USD * 1.08) / 10;

  return null;
}

// ==================== INFERENCE ENGINE v4 ====================
// CORE RULE: If value IS extracted → pctRevenue = value / revenue (NEVER a fixed constant)
// Only use heuristics when BOTH value AND revenue are missing.
//
// Confidence levels:
//   90 → actual disclosed value + known revenue (ACTUAL)
//   70 → extracted value but no revenue, or inferred from text context (INFERRED)
//   50 → pure sector heuristic fallback (HEURISTIC)

interface InferenceResult {
  valueCr: number;
  pctRevenue: number;
  pctRange: [number, number];     // [min, max] % range for probabilistic scoring
  confidenceScore: number;        // 90 / 70 / 50
  confidenceType: 'ACTUAL' | 'INFERRED' | 'HEURISTIC';
}

// Sector-specific heuristic ranges — [min, midpoint, max] as % of revenue
// Only invoked when NO value is extractable from text
// Range enables future probabilistic scoring and calibration
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

// Keyword magnitude boost — adjusts the heuristic based on language intensity
function getKeywordMagnitude(text: string): number {
  const lower = text.toLowerCase();
  if (/mega|landmark|transformative|game.?chang|largest ever|record|biggest/i.test(lower)) return 2.5;
  if (/large|major|significant|substantial|multi.?billion|massive|sizable/i.test(lower)) return 1.8;
  if (/medium|moderate|decent/i.test(lower)) return 1.0;
  if (/small|minor|routine|regular|nominal/i.test(lower)) return 0.4;
  return 1.0; // neutral — no magnitude keywords
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

  // ── HEURISTIC BIAS FIX (Issue 3): Apply 0.7x penalty + confidence=40 ──
  // Using midpoint creates systematic bias → penalize all heuristic results

  // Negative events — always material
  if (isNegative) {
    const negPct = Math.max(3, adjustedMid) * 0.7; // heuristic penalty
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
    // We have revenue but no extracted value → use sector heuristic × magnitude × 0.7 penalty
    const penalizedMid = adjustedMid * 0.7;
    const estimatedValue = parseFloat((rev * penalizedMid / 100).toFixed(1));
    return {
      valueCr: estimatedValue, pctRevenue: penalizedMid, pctRange,
      confidenceScore: 40, confidenceType: 'HEURISTIC',
    };
  }

  // No revenue available → absolute value estimates (sector-adjusted)
  const absBase: Record<string, number> = {
    'M&A': 400, 'Capex/Expansion': 300, 'Demerger': 500,
    'Fund Raising': 250, 'Order Win': 150, 'Contract': 150,
    'JV/Partnership': 100, 'LOI': 75, 'Buyback': 150,
    'Dividend': 30, 'Guidance': 50, 'Mgmt Change': 0,
  };
  const absVal = Math.round((absBase[eventType] || 50) * magnitude * 0.7); // heuristic penalty

  return {
    valueCr: absVal, pctRevenue: adjustedMid * 0.7, pctRange,
    confidenceScore: 40, confidenceType: 'HEURISTIC',
  };
}

function classifyOrderType(subject: string, desc: string): string {
  const c = `${subject} ${desc}`.toLowerCase();
  // Most valuable first: Orders/Contracts with quantified value
  if (c.includes('order win') || c.includes('order received') || c.includes('awarded') || c.includes('bagging')) return 'Order Win';
  if (c.includes('work order') || c.includes('purchase order')) return 'Order Win';
  if (c.includes('contract') && !c.includes('employment contract') && !c.includes('service contract for director')) return 'Contract';
  if (c.includes('letter of intent') || c.includes('loi')) return 'LOI';
  // Capex / Expansion
  if (c.includes('capex') || c.includes('capital expenditure') || c.includes('expansion') || c.includes('new plant') || c.includes('new facility') || c.includes('capacity addition') || c.includes('greenfield') || c.includes('brownfield')) return 'Capex/Expansion';
  // Strategic — only real M&A, not just "acquisition of shares"
  if ((c.includes('acquisition') || c.includes('merger') || c.includes('amalgamation') || c.includes('buyout')) &&
      !c.includes('acquisition of shares by') && !c.includes('esop')) return 'M&A';
  if (c.includes('demerger')) return 'Demerger';
  if (c.includes('joint venture') || c.includes('jv') || c.includes('partnership') || c.includes('collaboration') || c.includes('mou')) return 'JV/Partnership';
  // Capital
  if (c.includes('fund raising') || c.includes('qip') || c.includes('rights issue') || c.includes('preferential allotment')) return 'Fund Raising';
  if (c.includes('buyback')) return 'Buyback';
  if (c.includes('dividend')) return 'Dividend';
  // Guidance
  if (c.includes('guidance') || c.includes('outlook') || c.includes('forecast')) return 'Guidance';
  // People
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

  // Pattern match
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

// ==================== ECONOMIC IMPACT ENGINE (v3) ====================
// Impact classification is 100% NUMERIC. No keyword fallbacks.
// impactPct = (eventValueCr / annualRevenueCr) * 100
//
// HIGH:   impactPct >= 8
// MEDIUM: impactPct >= 3
// LOW:    impactPct < 3

function classifyImpactLevel(impactPct: number): ImpactLevel {
  // Lowered HIGH threshold from 8→5 (BUG-09 fix)
  // A ₹275 Cr deal at 2.7% MCap SHOULD be HIGH for a smallcap
  if (impactPct >= 5) return 'HIGH';
  if (impactPct >= 2) return 'MEDIUM';
  return 'LOW';
}

// ==================== FORCE ACTION ENGINE ====================
// Replaces HOLD CONTEXT — every signal gets a DECISION

// ==================== FORCE ACTION ENGINE (v3) ====================
// Pure threshold-based. No ambiguity.
//
// BUY WATCH triggers:
//   impactPct >= 8 AND sentiment == Bullish
//   impactPct >= 5 AND earningsScore >= 70
//   impactPct >= 3 AND isWatchlist AND sentiment != Bearish
//
// Everything else → TRACK (never IGNORE for meaningful signals)

function classifyAction(
  impactPct: number,
  sentiment: SignalSentiment,
  isWatchlist: boolean,
  isPortfolio: boolean,
  earningsScore: number | null,
): ActionFlag {
  // Rule 1: HIGH impact + Bullish → BUY WATCH (BUG-09 recalibrated thresholds)
  if (impactPct >= 5 && sentiment === 'Bullish') return 'BUY WATCH';

  // Rule 2: Portfolio/Watchlist stock + meaningful impact + not bearish → BUY WATCH
  if (impactPct >= 2 && (isWatchlist || isPortfolio) && sentiment !== 'Bearish') return 'BUY WATCH';

  // Rule 3: Good earnings + medium impact → BUY WATCH
  if (impactPct >= 3 && earningsScore !== null && earningsScore >= 60) return 'BUY WATCH';

  // Rule 4: Very high impact (any sentiment) → BUY WATCH
  if (impactPct >= 10) return 'BUY WATCH';

  // Rule 5: Everything else → TRACK
  return 'TRACK';
}

// ==================== TIME DECAY ====================

function computeTimeWeight(dateStr: string): number {
  try {
    // Parse date — handle both "DD-MM-YYYY" and ISO formats
    let d: Date;
    if (dateStr.includes('-') && dateStr.length === 10 && dateStr[2] === '-') {
      const [dd, mm, yyyy] = dateStr.split('-');
      d = new Date(`${yyyy}-${mm}-${dd}`);
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return 0.5;
    const daysOld = Math.max(0, (Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
    // Continuous decay: max(0.05, 1 - daysOld * 0.07)
    // 0d=1.0, 1d=0.93, 3d=0.79, 5d=0.65, 7d=0.51, 10d=0.30, 14d=0.05
    return Math.max(0.05, parseFloat((1 - daysOld * 0.07).toFixed(3)));
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

  // Positive / neutral events
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

// ==================== QUANT SCORE ENGINE (v4) ====================
//
// GRANULAR SCORING — no more score=100 flat.
// ==================== SCORING MODEL v5 ====================
// Calibrated for proper distribution: 5-10 HIGH, 20-30 BUY WATCH, 60-70 TRACK
//
// BASE SCORE = impact(0–40) + freshness(0–15) + type(0–15) = max 70
// MULTIPLIER = confidence factor (0.6–1.0) → penalizes heuristics
// MODIFIERS  = sentiment(±5) + earnings(±10) + deal quality(+5)
// STACKING   = 0–20 (applied later)
//
// Key insight: multiply by confidence instead of adding — ensures heuristic
// signals can NEVER outscore actual signals at the same impact level.

const SIGNAL_TYPE_WEIGHTS: Record<string, number> = {
  'Order Win': 14, 'Contract': 14, 'M&A': 13, 'Capex/Expansion': 12,
  'Demerger': 11, 'Fund Raising': 10, 'LOI': 8, 'JV/Partnership': 9,
  'Buyback': 10, 'Dividend': 6, 'Guidance': 8, 'Mgmt Change': 5,
  'Block Buy': 11, 'Bulk Buy': 10, 'Block Sell': 11, 'Bulk Sell': 10,
  'Corporate': 4,
};

// Sector normalization multipliers — adjusts signal weight by sector sensitivity
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

  // ── Component 1: Impact (0–40) — log curve for diminishing returns ──
  // At 3%→12, 5%→19, 8%→26, 15%→35, 25%→40
  const impactScore = Math.min(40, 40 * (1 - Math.exp(-opts.impactPct / 10)));
  score += impactScore;

  // ── Component 2: Freshness (0–15) — time decay (Issue 6: alpha preservation) ──
  // Day 1 → +13.5, Day 5 → +7.5, Day 10 → +0 — forces recency relevance
  const daysOldApprox = Math.max(0, (1 - opts.timeWeight) / 0.07);
  const freshnessScore = Math.max(0, 15 - daysOldApprox * 1.5);
  score += freshnessScore;

  // ── Component 3: Signal type weight (0–15) ──
  score += Math.min(15, SIGNAL_TYPE_WEIGHTS[opts.eventType] || 5);

  // ── CONFIDENCE MULTIPLIER (institutional standard: score = base × confidence/100) ──
  // 90→full strength, 70→70%, 40→40% (heuristic heavily penalized)
  const confidenceFactor = opts.confidenceScore / 100;
  score = score * confidenceFactor;

  // ── Modifiers (additive, after confidence scaling) ──

  // Sentiment: Bullish adds, Bearish subtracts
  score += opts.sentiment === 'Bullish' ? 5 : opts.sentiment === 'Bearish' ? -3 : 0;

  // Earnings integration (CRITICAL: negative penalty prevents value traps)
  if (opts.earningsScore !== null) {
    if (opts.earningsScore >= 70) score += 8;       // Strong earnings → alpha signal
    else if (opts.earningsScore >= 50) score += 4;   // OK earnings → mild boost
    else if (opts.earningsScore < 40) { score -= 10; } // Bad earnings → RISK penalty (was -8, now -10)
  }

  // Negative events get urgency boost
  if (opts.isNegative) score += 5;

  // Deal-specific quality
  if (opts.isDeal) {
    if (opts.buyerQuality && opts.buyerQuality >= 80) score += 4;
    if (opts.dealPremiumDiscount !== undefined && opts.dealPremiumDiscount !== null && opts.dealPremiumDiscount > 3) score += 2;
  }

  // Sector normalization — adjusts score based on sector sensitivity
  if (opts.sector) {
    const sectorKey = opts.sector.split(' ')[0]; // e.g., "IT Services" → "IT"
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
    // 2-second timeout guard per symbol — skip partial data if too slow
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

    // Revenue: TTM (4 quarters) → FY annual → partial quarters
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
      // Penalize non-TTM confidence (Issue 2 fix)
      if (result.revenueSource === 'PARTIAL') {
        // Mark as less reliable — downstream code checks revenueSource
      }
      if (!result.mcapCr && earnings.mcap) result.mcapCr = earnings.mcap;
    }
  } catch (e) {
    console.error(`[Intelligence] Enrich error ${symbol}:`, e);
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

// ==================== MAIN HANDLER ====================

export async function GET(request: Request): Promise<NextResponse<IntelligenceResponse>> {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const watchlistParam = searchParams.get('watchlist');
    const portfolioParam = searchParams.get('portfolio');
    const days = parseInt(searchParams.get('days') || '30');
    const forceRefresh = searchParams.get('force') === 'true';

    const watchlist = watchlistParam
      ? watchlistParam.split(',').map(s => normalizeTicker(s.trim())).filter(Boolean)
      : [];
    const portfolio = portfolioParam
      ? portfolioParam.split(',').map(s => normalizeTicker(s.trim())).filter(Boolean)
      : [];

    // ── Route-level cache (BUG-01 fix: instant response on repeat calls) ──
    const cacheKey = `${watchlist.join(',')}|${portfolio.join(',')}|${days}`;
    if (!forceRefresh && _routeCache && _routeCache.key === cacheKey && (Date.now() - _routeCache.timestamp) < ROUTE_CACHE_TTL) {
      console.log(`[Intelligence] Cache hit (${Date.now() - startTime}ms)`);
      return NextResponse.json(_routeCache.data);
    }

    const watchlistSet = new Set(watchlist);
    const portfolioSet = new Set(portfolio);

    console.log(`[Intelligence] Starting: ${watchlist.length} watchlist, ${portfolio.length} portfolio, ${days} days`);

    // ── Debug tracking ──
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

    // ── 1. Fetch data in parallel — MULTI-SOURCE with fallback chain ──
    const fromDate = getDateDaysAgo(days);
    const toDate = getTodayDate();
    const allTracked = [...new Set([...watchlist, ...portfolio])];

    // Phase 1: Try NSE (primary) + Deals in parallel
    const [announcementsRaw, blockRaw, bulkRaw] = await Promise.all([
      nseApiFetch(`/api/corporate-announcements?index=equities&from_date=${fromDate}&to_date=${toDate}`, 300000)
        .catch((e: any) => { debug.errors.push(`NSE announcements: ${(e as Error).message}`); return null; }),
      nseApiFetch('/api/block-deal', 300000)
        .catch((e: any) => { debug.errors.push(`NSE block deals: ${(e as Error).message}`); return null; }),
      nseApiFetch('/api/bulk-deal', 300000)
        .catch((e: any) => { debug.errors.push(`NSE bulk deals: ${(e as Error).message}`); return null; }),
    ]);

    // Parse NSE announcements
    let announcements: any[] = [];
    if (announcementsRaw) {
      announcements = Array.isArray(announcementsRaw) ? announcementsRaw : (announcementsRaw?.data || []);
    }
    debug.nseAnnouncements = announcements.length;
    if (announcements.length > 0) debug.dataSources.push('NSE');

    // Normalize deals
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

    // Phase 2: If NSE returned <5 announcements → fetch MC news + Google News as fallback
    let mcNewsAnnouncements: any[] = [];
    let googleNewsAnnouncements: any[] = [];

    if (announcements.length < 5 && allTracked.length > 0) {
      console.log(`[Intelligence] NSE returned ${announcements.length} announcements — activating Moneycontrol + Google News fallback`);

      const [mcNews, gNews] = await Promise.all([
        fetchMoneycontrolNews(allTracked.slice(0, 20)).catch((e: any) => {
          debug.errors.push(`MC news: ${(e as Error).message}`);
          return [] as MCNewsItem[];
        }),
        fetchGoogleNewsRSS(allTracked.slice(0, 15)).catch((e: any) => {
          debug.errors.push(`Google news: ${(e as Error).message}`);
          return [] as MCNewsItem[];
        }),
      ]);

      debug.mcNewsItems = mcNews.length;
      debug.googleNewsItems = gNews.length;

      // Convert MC news to NSE-like announcement format
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

    // Merge all announcements (NSE + MC + Google)
    const allAnnouncements = [
      ...announcements.map(a => ({ ...a, _source: 'nse' })),
      ...mcNewsAnnouncements,
      ...googleNewsAnnouncements,
    ];

    // Filter announcements for material events (positive + negative)
    const filteredAnn = allAnnouncements.filter(item => {
      if (!item.symbol || (!item.desc && !item.subject)) return false;
      const combined = `${item.subject || ''} ${item.desc || ''}`.toLowerCase();
      // Skip noise
      if (NOISE_PATTERNS.some(p => combined.includes(p))) return false;
      // Include positive/neutral keywords OR negative keywords
      return ORDER_KEYWORDS.some(k => combined.includes(k)) ||
             NEGATIVE_KEYWORDS.some(k => combined.includes(k));
    });

    // Track material counts per source
    debug.nseMaterial = filteredAnn.filter(a => a._source === 'nse').length;
    debug.mcMaterial = filteredAnn.filter(a => a._source === 'moneycontrol').length;
    debug.googleMaterial = filteredAnn.filter(a => a._source === 'google_news').length;

    console.log(`[Intelligence] Sources: NSE=${debug.nseAnnouncements}→${debug.nseMaterial} | MC=${debug.mcNewsItems}→${debug.mcMaterial} | Google=${debug.googleNewsItems}→${debug.googleMaterial} | Deals: ${blockDeals.length}B/${bulkDeals.length}K`);

    // ── 2. Collect symbols for enrichment (capped at 30) ──
    const symbolsToEnrich = new Set<string>();
    portfolio.forEach(s => symbolsToEnrich.add(s));
    watchlist.forEach(s => symbolsToEnrich.add(s));
    [...blockDeals, ...bulkDeals].forEach(d => symbolsToEnrich.add(normalizeTicker(d.symbol)));
    filteredAnn.forEach(a => { if (symbolsToEnrich.size < 30) symbolsToEnrich.add(normalizeTicker(a.symbol)); });
    symbolsToEnrich.delete('');

    // Batch enrich — 10 parallel with 2s per-symbol timeout (BUG-01 + Issue 10 fix)
    const enrichMap = new Map<string, StockEnrichment>();
    const symArr = Array.from(symbolsToEnrich);
    let enrichPartial = false;
    for (let i = 0; i < symArr.length; i += 10) {
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
    console.log(`[Intelligence] Enriched ${enrichMap.size} symbols`);

    // ── 3. Build signals from corporate orders ──
    const allSignals: IntelSignal[] = [];
    // CROSS-SOURCE DEDUP (Issue 7): key = symbol_eventType_valueCr_date
    // Same event from NSE + Moneycontrol + Google News → keep highest confidence
    const crossSourceSeen = new Set<string>();
    const dedupMap = new Map<string, IntelSignal>();

    // Pre-fetch earnings scores for all watchlist/portfolio symbols (batch)
    const earningsCache = new Map<string, number | null>();
    const allTrackedSymbols = [...new Set([...watchlist, ...portfolio])];
    for (let i = 0; i < allTrackedSymbols.length; i += 5) {
      const batch = allTrackedSymbols.slice(i, i + 5);
      await Promise.all(batch.map(async (sym) => {
        try {
          const ed = await kvGet<any>(`earnings:${sym}`);
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
      }));
    }

    debug.earningsCacheHits = [...earningsCache.values()].filter(v => v !== null).length;
    console.log(`[Intelligence] Earnings cache: ${earningsCache.size} symbols, ${debug.earningsCacheHits} with scores`);

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

      // ═══════ DETERMINISTIC VALUE PIPELINE v4 ═══════
      // Confidence: 90=ACTUAL (value+revenue), 70=INFERRED (value, no revenue), 50=HEURISTIC
      let extractedValue = parseOrderValue(combinedText);
      let inferenceUsed = false;
      let confidenceScore = 90;
      let confidenceType: 'ACTUAL' | 'INFERRED' | 'HEURISTIC' = 'ACTUAL';

      let valueCr: number;
      let impactPct: number;

      // Derive sector from enrichment for heuristic lookup
      const sectorRaw = enrichment?.industry || segment || null;
      const sector = sectorRaw ? sectorRaw.split(' ')[0] : null;

      if (extractedValue !== null && extractedValue > 0) {
        // EXPLICIT VALUE FOUND — pctRevenue = value / revenue (NEVER a fixed constant)
        valueCr = extractedValue;
        if (enrichment?.annualRevenueCr && enrichment.annualRevenueCr > 0) {
          impactPct = parseFloat(((valueCr / enrichment.annualRevenueCr) * 100).toFixed(2));
          confidenceScore = 90;
          confidenceType = 'ACTUAL';
        } else {
          // Value extracted but no revenue → inferred impact from absolute value
          impactPct = valueCr >= 500 ? 8 : valueCr >= 200 ? 5 : valueCr >= 50 ? 2 : 1;
          confidenceScore = 70;
          confidenceType = 'INFERRED';
        }
      } else {
        // No value extracted → MANDATORY INFERENCE (valueCr is NEVER null)
        inferenceUsed = true;
        confidenceScore = 50;
        confidenceType = 'HEURISTIC';

        // Try earnings KV cache for revenue
        let revenueCr = enrichment?.annualRevenueCr || null;
        if (!revenueCr) {
          try {
            const ed = await kvGet<any>(`earnings:${symbol}`);
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

      // Compute impact level from impactPct (100% numeric, no keywords)
      const impactLevel = classifyImpactLevel(impactPct);

      // Earnings integration
      const earningsScore = earningsCache.get(symbol) ?? null;
      // Earnings ↔ Signal cross-integration: strong earnings + positive signal = alpha layer
      const earningsBoost = (earningsScore !== null && earningsScore >= 70 && sentiment !== 'Bearish' && impactPct >= 3);

      // Force BUY WATCH if earnings boost
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

      // Build headline — always includes value now
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

      // CROSS-SOURCE DEDUP (Issue 7): same event across NSE + MC + Google News
      const dateStr = (item.date || getTodayDate()).slice(0, 10);
      const crossKey = `${symbol}_${eventType}_${Math.round(valueCr)}_${dateStr}`;
      if (crossSourceSeen.has(crossKey)) continue; // Skip duplicate from different source
      crossSourceSeen.add(crossKey);

      // DEDUP: same symbol + same event type + same day → keep highest scoring
      const dedupKey = `${symbol}:${eventType}:${dateStr}`;
      const existing = dedupMap.get(dedupKey);

      // Derive data source from announcement
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
        action, score, timeWeight, weightedScore, sentiment, whyItMatters,
        isNegative: negative, earningsBoost, isWatchlist, isPortfolio,
        dataSource,
      };

      if (!existing || weightedScore > existing.weightedScore) {
        if (existing && existing.valueCr > signal.valueCr) {
          signal.valueCr = existing.valueCr;
        }
        dedupMap.set(dedupKey, signal);
      }
    }

    // Collect deduped order signals
    allSignals.push(...dedupMap.values());

    // ── 4. Build signals from deals ──
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

      // Compute impactPct for deals (against revenue or mcap)
      let dealImpactPct: number;
      if (enrichment?.annualRevenueCr && enrichment.annualRevenueCr > 0) {
        dealImpactPct = parseFloat(((dealValueCr / enrichment.annualRevenueCr) * 100).toFixed(2));
      } else if (enrichment?.mcapCr && enrichment.mcapCr > 0) {
        dealImpactPct = parseFloat(((dealValueCr / enrichment.mcapCr) * 100).toFixed(2));
      } else {
        // Absolute value heuristic
        dealImpactPct = dealValueCr >= 100 ? 5 : dealValueCr >= 20 ? 3 : dealValueCr >= 5 ? 2 : 1;
      }

      // Buyer quality boost to impact
      if (buyerQual >= 80) dealImpactPct = Math.max(dealImpactPct, 4);

      const impactLevel = classifyImpactLevel(dealImpactPct);
      const earningsScore = earningsCache.get(symbol) ?? null;
      const action = classifyAction(dealImpactPct, sentiment, isWatchlist, isPortfolio, earningsScore);

      // Deals always have explicit value → confidence is ACTUAL if revenue known, INFERRED otherwise
      const dealConfidenceScore = (enrichment?.annualRevenueCr && enrichment.annualRevenueCr > 0) ? 90 : 70;
      const dealConfidenceType: 'ACTUAL' | 'INFERRED' | 'HEURISTIC' = dealConfidenceScore >= 90 ? 'ACTUAL' : 'INFERRED';

      const score = computeScore({
        impactPct: dealImpactPct, sentiment, timeWeight,
        earningsScore, isNegative: isSell && buyerQual >= 80, isDeal: true,
        eventType, confidenceScore: dealConfidenceScore,
        dealPremiumDiscount: premiumDiscount, buyerQuality: buyerQual,
        sector: enrichment?.industry || null,
      });
      const weightedScore = Math.round(score * timeWeight);

      const whyItMatters = generateWhyItMatters({
        eventType, impactLevel, pctRevenue: dealImpactPct, pctMcap: null, valueCr: dealValueCr,
        client: null, segment: null, isNegative: isSell, sentiment, buyerSeller: deal.clientName, premiumDiscount,
      });

      // Headline
      let headline = `${deal.type} ${isBuy ? '▲' : '▼'} ${fmtCr(dealValueCr)}`;
      headline += ` | ${deal.clientName.slice(0, 30)}`;
      if (premiumDiscount !== null) {
        headline += ` | ${premiumDiscount > 0 ? '+' : ''}${premiumDiscount.toFixed(1)}%`;
      }
      if (pctEquity !== null && pctEquity > 0.01) {
        headline += ` | ${pctEquity.toFixed(2)}% eq`;
      }
      headline += ` — ${dealImpactPct.toFixed(1)}% impact`;

      // DEDUP
      const dateStr = (deal.dealDate || getTodayDate()).slice(0, 10);
      const dedupKey = `${symbol}:${eventType}:${dateStr}`;
      const existing = dealDedupMap.get(dedupKey);

      const signal: IntelSignal = {
        symbol, company: enrichment?.companyName || symbol,
        date: deal.dealDate || getTodayDate(), source: 'deal',
        eventType, headline,
        valueCr: dealValueCr, valueUsd: null,
        mcapCr: enrichment?.mcapCr || null, revenueCr: enrichment?.annualRevenueCr || null,
        impactPct: dealImpactPct, pctRevenue: dealImpactPct, pctMcap: null,
        inferenceUsed: false,
        client: null, segment: enrichment?.industry || null, timeline: null,
        buyerSeller: deal.clientName, premiumDiscount, lastPrice: enrichment?.lastPrice || null,
        impactLevel, impactConfidence: dealConfidenceScore >= 90 ? 'HIGH' : 'MEDIUM',
        confidenceScore: dealConfidenceScore, confidenceType: dealConfidenceType,
        action, score, timeWeight, weightedScore, sentiment, whyItMatters,
        isNegative: isSell && buyerQual >= 80, earningsBoost: false,
        isWatchlist, isPortfolio,
        dataSource: deal.type === 'Block' ? 'Block Deal' : 'Bulk Deal',
      };

      if (!existing || weightedScore > existing.weightedScore) {
        if (existing && existing.valueCr > signal.valueCr) {
          signal.valueCr = existing.valueCr;
        }
        dealDedupMap.set(dedupKey, signal);
      }
    }

    allSignals.push(...dealDedupMap.values());

    // ── 5. QUALITY GATE — drop fake/noise signals (BUG-02 fix) ──
    debug.totalSignalsBeforeDedup = allSignals.length;

    const qualityFiltered = allSignals.filter(s => {
      // Gate 0 (Issue 8): STRICT fake M&A kill — ₹500 heuristic = always null
      if (s.confidenceType === 'HEURISTIC' && s.eventType === 'M&A' && Math.round(s.valueCr) === 280) return false; // 400*0.7
      if (s.confidenceType === 'HEURISTIC' && Math.round(s.valueCr) === 350) return false; // 500*0.7

      // Gate 1: Drop heuristic signals with default absolute values (post-0.7x penalty)
      if (s.confidenceType === 'HEURISTIC' && s.inferenceUsed) {
        const defaultValues = [500, 400, 350, 300, 280, 250, 210, 175, 150, 105, 100, 75, 70, 53, 50, 35, 30, 21, 0];
        if (defaultValues.includes(Math.round(s.valueCr))) {
          if (!s.isWatchlist && !s.isPortfolio) return false;
          if (s.weightedScore < 30) { s.action = 'IGNORE'; }
        }
      }

      // Gate 2: Drop low-scoring heuristic signals (Issue 8: score < 45 + heuristic → null)
      if (s.weightedScore < 20 && s.confidenceType === 'HEURISTIC') return false;
      if (s.score < 45 && s.confidenceType === 'HEURISTIC' && !s.isWatchlist && !s.isPortfolio) return false;

      // Gate 3: Drop IGNORE signals entirely unless they're for watched stocks
      if (s.action === 'IGNORE' && !s.isWatchlist && !s.isPortfolio) return false;

      return true;
    });

    debug.totalSignalsAfterDedup = qualityFiltered.length;

    const filtered = qualityFiltered
      .sort((a, b) => {
        // BUY WATCH first, then TRACK
        const actionRank: Record<ActionFlag, number> = { 'BUY WATCH': 0, 'TRACK': 1, 'IGNORE': 2 };
        const ar = actionRank[a.action] - actionRank[b.action];
        if (ar !== 0) return ar;
        // Then by weighted score (time-decayed)
        return b.weightedScore - a.weightedScore;
      });

    // ── 5.5 Build trend layer (signal stacking per company) ──
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

      // Set stack info on each signal + apply stacking bonus (0–20 points)
      for (const s of sigs) {
        s.signalStackCount = count;
        s.signalStackLevel = stackLevel;

        // Component 4: Signal stacking bonus (0–20 points)
        // Formula: min(20, 5 × signalCount)
        // 1 signal → 0, 2 → 10, 3 → 15, 4+ → 20
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

    // Top 3 = highest weighted-scoring non-IGNORE signals
    const top3 = filtered.filter(s => s.action !== 'IGNORE').slice(0, 3);

    // ── 6. Build daily bias ──
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

    // Track signal source counts
    for (const s of filtered) {
      if (s.source === 'deal') debug.signalsBySource.deal++;
      else debug.signalsBySource.nse++; // Default — individual signals don't track MC vs NSE yet
    }
    debug.totalSignalsAfterDedup = filtered.length;

    const response: IntelligenceResponse = {
      top3,
      signals: filtered.slice(0, 100), // Expanded to 100 — all signals are quantified
      trends: trends.slice(0, 10),
      bias,
      updatedAt: new Date().toISOString(),
      dataStatus: enrichPartial ? 'PARTIAL' : 'FULL',
    } as any;

    const duration = Date.now() - startTime;
    console.log(`[Intelligence] Done: ${filtered.length} signals, ${top3.length} top3, ${trends.length} trends, bias=${netBias} in ${duration}ms`);

    // ── Cache signals for stale fallback ──
    if (filtered.length > 0) {
      cacheSignals(response).catch(() => {});
    }

    // ── If 0 signals from live sources → try stale cache ──
    if (filtered.length === 0) {
      console.log(`[Intelligence] 0 live signals — checking stale cache...`);
      debug.errors.push('No live signals found — checking cached data');
      const cached = await getCachedSignals();
      if (cached && cached.signals && cached.signals.length > 0) {
        const cacheAgeMin = cached.cachedAt ? Math.round((Date.now() - cached.cachedAt) / 60000) : 0;
        console.log(`[Intelligence] Serving ${cached.signals.length} stale cached signals (${cacheAgeMin}min old)`);
        debug.cachedSignals = cached.signals.length;
        debug.dataSources.push(`KV Cache (${cacheAgeMin}min old)`);

        // Mark all cached signals with stale flag and decay scores
        const staleDecay = cacheAgeMin > 360 ? 0.5 : cacheAgeMin > 120 ? 0.7 : 0.9;
        for (const s of cached.signals) {
          s.weightedScore = Math.round((s.weightedScore || 0) * staleDecay);
          s.headline = `[STALE] ${s.headline || ''}`;
        }

        return NextResponse.json({
          ...cached,
          updatedAt: new Date().toISOString(),
          stale: true,
          staleAgeMinutes: cacheAgeMin,
          debug: searchParams.get('debug') === 'true' ? debug : undefined,
        });
      }
    }

    // Add debug info if requested
    const debugParam = searchParams.get('debug') === 'true';
    const finalResponse = { ...response, debug: debugParam ? debug : undefined };

    // Save to route-level cache (BUG-01 fix)
    _routeCache = { key: cacheKey, data: finalResponse, timestamp: Date.now() };

    console.log(`[Intelligence] Done in ${Date.now() - startTime}ms — ${response.signals?.length || 0} signals`);
    return NextResponse.json(finalResponse);
  } catch (error) {
    console.error(`[Intelligence] Fatal error:`, error);

    // Try stale cache on fatal error
    try {
      const cached = await getCachedSignals();
      if (cached && cached.signals && cached.signals.length > 0) {
        console.log(`[Intelligence] Fatal error recovery: serving ${cached.signals.length} cached signals`);
        return NextResponse.json({
          ...cached,
          updatedAt: new Date().toISOString(),
          stale: true,
          error: 'Recovered from cache after error',
          debug: { error: (error as Error).message },
        });
      }
    } catch {}

    return NextResponse.json({
      top3: [],
      signals: [],
      trends: [],
      bias: {
        netBias: 'Neutral' as const,
        highImpactCount: 0, activeSectors: [], buyWatchCount: 0, trackCount: 0,
        totalSignals: 0, totalOrderValueCr: 0, totalDealValueCr: 0,
        portfolioAlerts: 0, negativeSignals: 0,
        summary: 'Error fetching intelligence — all sources failed',
      },
      updatedAt: new Date().toISOString(),
      debug: { error: (error as Error).message },
    }, { status: 500 });
  }
}
