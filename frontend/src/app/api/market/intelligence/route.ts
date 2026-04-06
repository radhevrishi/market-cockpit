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

// ==================== v6: SIGNAL CLASS + MATERIALITY (mirrors compute route) ====================
type SignalClass = 'ECONOMIC' | 'STRATEGIC' | 'GOVERNANCE' | 'COMPLIANCE';

const ECONOMIC_EVENTS = new Set([
  'Order Win', 'Contract', 'LOI', 'Capex/Expansion', 'Fund Raising',
  'Guidance', 'Earnings', 'M&A', 'Demerger', 'Buyback', 'Dividend',
  'Block Deal', 'Bulk Deal', 'Stake Sale', 'QIP', 'Rights Issue', 'Bonus',
]);
const STRATEGIC_EVENTS = new Set(['CEO Change', 'CFO Change', 'MD Change', 'Chairman Change', 'Leadership Transition']);
const GOVERNANCE_EVENTS = new Set(['Mgmt Change', 'Board Appointment', 'Board Meeting']);
const COMPLIANCE_EVENTS = new Set(['Compliance', 'Regulatory', 'Filing', 'AGM', 'EGM']);
const SENIOR_ROLES = new Set(['CEO', 'CFO', 'MD', 'Chairman', 'Managing Director', 'Chief Executive', 'Chief Financial']);

function classifySignalClass(eventType: string, headline?: string, desc?: string): SignalClass {
  if (ECONOMIC_EVENTS.has(eventType)) return 'ECONOMIC';
  if (STRATEGIC_EVENTS.has(eventType)) return 'STRATEGIC';
  if (COMPLIANCE_EVENTS.has(eventType)) return 'COMPLIANCE';
  if (GOVERNANCE_EVENTS.has(eventType)) return 'GOVERNANCE';
  const lower = (eventType || '').toLowerCase();
  if (lower.includes('order') || lower.includes('contract') || lower.includes('capex') || lower.includes('guidance') || lower.includes('earnings')) return 'ECONOMIC';
  if (lower.includes('deal') || lower.includes('acquisition') || lower.includes('merger') || lower.includes('fund') || lower.includes('stake') || lower.includes('buyback')) return 'ECONOMIC';
  if ((lower.includes('ceo') || lower.includes('cfo') || lower.includes('chairman')) && (lower.includes('change') || lower.includes('exit'))) return 'STRATEGIC';
  if (lower.includes('mgmt') || lower.includes('management') || lower.includes('board') || lower.includes('appointment') || lower.includes('director')) return 'GOVERNANCE';
  // Check headline/desc for economic keywords before defaulting
  const fullText = `${headline || ''} ${desc || ''}`.toLowerCase();
  if (fullText.includes('order') || fullText.includes('contract') || fullText.includes('capex') || fullText.includes('expansion') ||
      fullText.includes('acquisition') || fullText.includes('deal') || fullText.includes('revenue') || fullText.includes('profit') ||
      fullText.includes('investment') || fullText.includes('fund') || fullText.includes('ipo') || fullText.includes('qip')) return 'ECONOMIC';
  // Default: ECONOMIC for unknown (most NSE corporate actions are economic events)
  // COMPLIANCE was causing ALL unknown signals to be governance-blocked
  return 'ECONOMIC';
}

function extractMgmtRole(headline?: string, desc?: string): string {
  const text = ((headline || '') + ' ' + (desc || '')).toLowerCase();
  if (text.includes('ceo') || text.includes('chief executive')) return 'CEO';
  if (text.includes('cfo') || text.includes('chief financial')) return 'CFO';
  if (text.includes('managing director') || /\bmd\b/.test(text)) return 'MD';
  if (text.includes('chairman') || text.includes('chairperson')) return 'Chairman';
  if (text.includes('director')) return 'Director';
  return 'Other';
}

const EVT_WEIGHTS: Record<string, number> = {
  'Guidance': 100, 'Earnings': 90, 'Capex/Expansion': 75, 'Order Win': 70, 'Contract': 70,
  'M&A': 65, 'Demerger': 60, 'Fund Raising': 55, 'LOI': 50,
  'Block Deal': 45, 'Bulk Deal': 45, 'Stake Sale': 40,
  'CEO Change': 50, 'CFO Change': 45, 'MD Change': 45,
  'Mgmt Change': 10, 'Board Appointment': 10,
};
const ROLE_SCORES: Record<string, number> = {
  'CEO': 100, 'CFO': 90, 'MD': 90, 'Chairman': 85, 'Director': 30, 'Other': 10,
};

// Governance materiality ladder
function governanceMateriality(role: string): 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW' {
  if (['CEO', 'CFO', 'MD', 'Chairman', 'Managing Director', 'COO', 'CTO', 'President', 'Promoter'].includes(role)) return 'HIGH';
  if (['Director', 'Whole-Time Director', 'Independent Director'].includes(role)) return 'MEDIUM';
  if (['VP', 'Company Secretary', 'Auditor'].includes(role)) return 'LOW';
  // 'Other' / unknown = MEDIUM (not LOW) — NSE filings often lack role detail
  return 'MEDIUM';
}

// False classification guard — checks if a mgmt change signal is actually real
// NSE-sourced signals default to real (corporate filings are authoritative)
function isRealMgmtChange(headline?: string, desc?: string, dataSource?: string): boolean {
  const text = ((headline || '') + ' ' + (desc || '')).toLowerCase();
  // Explicit "no change" negations → not a real change
  if (text.includes('no change in management') || text.includes('no change in control') || text.includes('no material change')) return false;
  // NSE corporate filings about mgmt changes are inherently real events
  if (dataSource === 'nse' || dataSource === 'NSE') return true;
  const hasChangeKw = /appoint|resign|step.?down|relinquish|cessation|retire|join|elevat|promot|succeed|replac|interim|addition|designat|re-?appoint|change|director|board|committee/.test(text);
  if (!hasChangeKw && text.length > 20) return false;
  return true;
}

// ── v7 EVENT WEIGHTS (normalized 0-1) — kept in sync with compute route ──
const V7_EVENT_WEIGHTS: Record<string, number> = {
  'Guidance': 1.0, 'Earnings': 0.9,
  'Open Offer': 0.9, 'Takeover': 0.9,
  'Turnaround': 0.85,
  'Capex/Expansion': 0.8, 'M&A': 0.8,
  'Demerger': 0.8, 'Spinoff': 0.8,
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

function classifyMgmtChangeType(signal: any): 'STRATEGIC' | 'ROUTINE' {
  const role = signal.managementRole || 'Other';
  if (['CEO', 'CFO', 'MD', 'Chairman', 'Managing Director', 'COO', 'CTO', 'President', 'Promoter'].includes(role)) return 'STRATEGIC';
  const text = ((signal.headline || '') + ' ' + (signal.whyItMatters || '')).toLowerCase();
  if (text.includes('ai') || text.includes('business unit head') || text.includes('strategy') || text.includes('restructur')) return 'STRATEGIC';
  return 'ROUTINE';
}

function computeV7RankScore(signal: any): number {
  const confScore = signal.dataConfidenceScore || signal.confidenceScore || 50;
  const confidenceWeight = confScore / 100;
  let eventWeight = V7_EVENT_WEIGHTS[signal.eventType] || 0.1;
  if (signal.eventType === 'Mgmt Change' || signal.eventType === 'Board Appointment') {
    eventWeight = classifyMgmtChangeType(signal) === 'STRATEGIC' ? 0.6 : 0.2;
  }
  const impactPct = Math.abs(signal.impactPct || 0);
  const materialityWeight = impactPct > 0 ? Math.min(impactPct / 5, 1.0) : 0.1;
  const freshnessWeight = signal.freshness === 'FRESH' ? 1.0 : signal.freshness === 'RECENT' ? 0.8 : signal.freshness === 'AGING' ? 0.5 : 0.3;
  const verifiedBonus = (signal.confidenceType === 'ACTUAL' && !signal.inferenceUsed) ? 1.2 : 1.0;
  return Math.round(
    (signal.materialityScore || 30) * confidenceWeight * eventWeight * materialityWeight * freshnessWeight * verifiedBonus
  );
}

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

// ── v8: Alpha Theme (mirrors compute route) ──
interface AlphaTheme {
  tag: string;
  label: string;
  score: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  narrative: string;
}

// ── v8: Thematic Idea (always-present alpha output layer) ──
interface ThematicIdea {
  symbol: string;
  company: string;
  theme: AlphaTheme;
  signals: number;
  isPortfolio: boolean;
  isWatchlist: boolean;
  lastPrice?: number | null;
  segment?: string | null;
}

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

  // Value source transparency
  valueSource?: 'EXACT' | 'AGGREGATED' | 'HEURISTIC';

  // Source traceability
  dataSource?: string;  // 'NSE' | 'Moneycontrol' | 'Google News' | 'Block Deal' | 'Bulk Deal'

  // Trend stacking (set at aggregation)
  signalStackCount?: number;
  signalStackLevel?: 'STRONG' | 'BUILDING' | 'WEAK';

  // v8: Thematic Alpha Engine
  alphaTheme?: AlphaTheme;
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

/** Extract ALL monetary values from text, normalize to Crores, and return the MAX.
 *  This prevents partial extraction (e.g. picking ₹165 Cr from a ₹580 Cr filing). */
function parseAllValues(text: string): number[] {
  if (!text) return [];
  const values: number[] = [];
  const s = text;

  // ── Extract all ₹/Rs/INR + Crore values ──
  const croreMatches = s.matchAll(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/gi);
  for (const m of croreMatches) values.push(parseFloat(m[1].replace(/,/g, '')));

  // Standalone "X crore" without ₹ prefix
  const standaloneCr = s.matchAll(/\b([\d,]+(?:\.\d+)?)\s*(?:crore|crores|cr)\b/gi);
  for (const m of standaloneCr) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (val > 0.5) values.push(val);
  }

  // Lakh → Cr
  const lakhMatches = s.matchAll(/(?:rs\.?|₹|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs)\b/gi);
  for (const m of lakhMatches) {
    const val = parseFloat(m[1].replace(/,/g, '')) / 100;
    if (val > 0.01) values.push(val);
  }

  // USD Million → Cr
  const usdMnMatches = s.matchAll(/(?:usd|\$|us\$|us\s*dollar)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/gi);
  for (const m of usdMnMatches) values.push((parseFloat(m[1].replace(/,/g, '')) * INR_TO_USD) / 10);

  // "X million USD"
  const mnUsdMatches = s.matchAll(/\b([\d,]+(?:\.\d+)?)\s*(?:million|mn)\s*(?:usd|us\s*dollar|dollar)/gi);
  for (const m of mnUsdMatches) values.push((parseFloat(m[1].replace(/,/g, '')) * INR_TO_USD) / 10);

  // USD Billion → Cr
  const usdBnMatches = s.matchAll(/(?:usd|\$|us\$)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn|b)\b/gi);
  for (const m of usdBnMatches) values.push(parseFloat(m[1].replace(/,/g, '')) * INR_TO_USD * 100);

  // INR Million → Cr
  const inrMnMatches = s.matchAll(/(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn)\b/gi);
  for (const m of inrMnMatches) values.push(parseFloat(m[1].replace(/,/g, '')) / 10);

  // EUR Million → Cr
  const eurMatches = s.matchAll(/(?:eur|€|euro)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn|m)\b/gi);
  for (const m of eurMatches) values.push((parseFloat(m[1].replace(/,/g, '')) * INR_TO_USD * 1.08) / 10);

  return values.filter(v => v > 0 && isFinite(v));
}

function parseOrderValue(text: string): number | null {
  const values = parseAllValues(text);
  if (values.length === 0) return null;
  // Return MAX value — prevents picking partial/truncated amounts
  return Math.max(...values);
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

  // Positive / neutral events
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
    return 'Open offer / takeover — mandatory at premium to market; creates floor price, exit opportunity';
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

    // ── STEP 1: Try precomputed Redis store first ──
    // Serves instant response from Redis. Falls back to inline compute only if Redis is empty.
    if (!forceRefresh) {
      try {
        const stored = await kvGet<any>('intelligence:signals');
        const meta = await kvGet<any>('intelligence:meta');

        if (stored && meta) {
          const ageMs = Date.now() - new Date(meta.computedAt).getTime();
          const isStale = ageMs > 15 * 60 * 1000; // 15 min

          console.log(`[Intelligence] Precomputed read: ${isStale ? 'STALE' : 'FRESH'} (${Math.round(ageMs / 1000)}s old, v${meta.version})`);

          if (isStale) {
            // Trigger background recompute (fire-and-forget)
            try {
              const url = new URL('/api/market/intelligence/compute', request.url);
              fetch(url.toString(), {
                method: 'GET',
                signal: AbortSignal.timeout(2000),
              }).catch(() => {}); // fire and forget
            } catch {}
          }

          // ── PF+WL ONLY: Filter cached signals to only tracked companies ──
          let responseData = stored;
          const wSet = new Set(watchlist.map((s: string) => s.toUpperCase()));
          const pSet = new Set(portfolio.map((s: string) => s.toUpperCase()));
          const allUserTracked = new Set([...wSet, ...pSet]);
          const shouldFilterCached = allUserTracked.size > 0;

          if (shouldFilterCached) {
            const filterToTracked = (arr: any[]) => arr
              ? arr.filter((s: any) => {
                  const sym = (s.symbol || '').toUpperCase();
                  return allUserTracked.has(sym);
                }).map((s: any) => ({
                  ...s,
                  isWatchlist: wSet.has(s.symbol),
                  isPortfolio: pSet.has(s.symbol),
                }))
              : [];
            responseData = {
              ...stored,
              signals: filterToTracked(stored.signals || []),
              notable: filterToTracked(stored.notable || []),
              observations: filterToTracked(stored.observations || []),
              top3: filterToTracked(stored.top3 || []),
              thematicIdeas: (stored.thematicIdeas || []).filter((t: any) => allUserTracked.has((t.symbol || '').toUpperCase())),
            };
          }

          // ── DATE FILTER + TIME DECAY: applied BEFORE aggregation ──
          // Critical: signals must be filtered and decay-weighted BEFORE scoring
          const nowMs = Date.now();
          const daysWindow = days <= 0 ? 90 : days;
          // ALWAYS apply date cutoff — never disable filtering
          const cutoffMs = nowMs - daysWindow * 24 * 60 * 60 * 1000;
          const DECAY_LAMBDA = 0.05; // exponential decay factor (tunable)

          // Merge ALL raw signals FIRST, then filter by PF/WL at source level, then by date
          // PRIORITY: Use _allSignals if available (includes rejected signals for re-evaluation)
          // The compute route may over-reject via TIER_D/template suppression; the GET route
          // re-classifies signalClass and can rescue economic signals that were incorrectly hidden.
          let allCachedSignals: any[] = [];
          let _usedAllSignals = false;
          if (Array.isArray(responseData._allSignals) && responseData._allSignals.length > 0) {
            allCachedSignals = responseData._allSignals;
            _usedAllSignals = true;
          } else {
            allCachedSignals = [
              ...(Array.isArray(responseData.signals) ? responseData.signals : []),
              ...(Array.isArray(responseData.observations) ? responseData.observations : []),
            ];
          }

          // ── PF/WL SOURCE-LEVEL FILTER: applied BEFORE any processing ──
          if (shouldFilterCached && allUserTracked.size > 0) {
            allCachedSignals = allCachedSignals.filter((s: any) => {
              const sym = (s.symbol || s.ticker || '').toUpperCase();
              return allUserTracked.has(sym);
            });
            // Tag each signal with portfolio/watchlist membership
            for (const s of allCachedSignals) {
              const sym = (s.symbol || s.ticker || '').toUpperCase();
              s.isPortfolio = pSet.has(sym);
              s.isWatchlist = wSet.has(sym);
            }
          }

          // Apply time decay weight to each signal
          for (const sig of allCachedSignals) {
            const d = sig.date || sig.publishedAt || sig.eventDate || sig.createdAt;
            if (d) {
              try {
                const sigMs = new Date(d).getTime();
                const daysSince = Math.max(0, (nowMs - sigMs) / 86400000);
                sig._timeDecay = Math.exp(-DECAY_LAMBDA * daysSince);
                sig._daysSince = Math.round(daysSince * 10) / 10;
              } catch { sig._timeDecay = 0.5; sig._daysSince = 7; }
            } else {
              sig._timeDecay = 0.5; // unknown date → 50% weight
              sig._daysSince = 7;
            }
          }

          // Filter by date window BEFORE any aggregation/scoring
          const dateFilteredSignals = cutoffMs > 0
            ? allCachedSignals.filter((sig: any) => {
                const d = sig.date || sig.publishedAt || sig.eventDate || sig.createdAt;
                if (!d) return true;
                try { return new Date(d).getTime() >= cutoffMs; } catch { return true; }
              })
            : allCachedSignals;
          if (dateFilteredSignals.length > 0) {
            const rawSignals = dateFilteredSignals;
            const actionableSignals: any[] = [];
            const monitorSignals: any[] = [];
            let rejectedCount = 0;
            // Debug: track rejection reasons
            const _rejectReasons: Record<string, number> = {};
            const _rejectSamples: any[] = [];

            for (const s of rawSignals) {
              // ── Validation Gate ──
              const sourceExists = s.confidenceType === 'ACTUAL' || s.sourceTier === 'VERIFIED' ||
                s.dataSource === 'nse' || s.dataSource === 'NSE' || s.source === 'deal';
              // Only hard-reject on actual template pattern (₹105Cr×11 companies, etc.)
              // heuristicSuppressed/identicalPctFlag degrade to MONITOR, not hard reject
              const hasTemplate = !!s.templatePattern;
              const isHeuristicDegraded = !!s.heuristicSuppressed || !!s.identicalPctFlag;
              const isBroken = s.dataQuality === 'BROKEN';
              const hasAnomaly = s.guidanceAnomalyFlag === 'EXTREME_UNVERIFIED' ||
                s.guidanceAnomalyFlag === 'INCONSISTENT_WITH_HISTORY';
              const isInferred = s.confidenceType === 'HEURISTIC' || s.confidenceType === 'INFERRED' ||
                s.valueSource === 'HEURISTIC' || s.inferenceUsed;
              const isGuidance = s.eventType === 'Guidance' || (s.headline || '').toLowerCase().includes('guidance');
              const periodOk = !isGuidance || (s.guidanceScope && s.guidanceScope !== 'UNKNOWN' &&
                s.guidancePeriod && s.guidancePeriod !== 'UNKNOWN');

              // Hard rejection checks — ONLY for template/broken/anomaly
              // !sourceExists is NO LONGER a hard reject — it degrades to MONITOR instead
              if (hasTemplate || isBroken || hasAnomaly) {
                const reason = hasTemplate ? 'template' : isBroken ? 'broken' : 'anomaly';
                _rejectReasons[reason] = (_rejectReasons[reason] || 0) + 1;
                if (_rejectSamples.length < 5) _rejectSamples.push({ ticker: s.ticker || s.symbol, reason, dataSource: s.dataSource, confidenceType: s.confidenceType, sourceTier: s.sourceTier, source: s.source, dataQuality: s.dataQuality, templatePattern: s.templatePattern, eventType: s.eventType });
                rejectedCount++;
                continue;
              }
              // No verified source → degrade to MONITOR, don't reject
              if (!sourceExists) {
                s.signalCategory = 'MONITOR';
                s.monitorTier = 'LOW';
                s._degradedReason = 'no_verified_source';
              }
              if (isGuidance && !periodOk) { _rejectReasons['guidance_period'] = (_rejectReasons['guidance_period'] || 0) + 1; rejectedCount++; continue; }

              // Materiality
              const revImpact = Math.abs(s.impactPct || 0);
              const isMaterial = (isGuidance && periodOk && !isInferred) ||
                (s.source === 'deal' && s.valueCr > 0) ||
                (revImpact > 5 && s.confidenceType === 'ACTUAL');

              // Inferred + non-material + no verified source → reject
              // But if source is verified (NSE, deal), keep as MONITOR with sanitized values
              if (isInferred && !isMaterial && !sourceExists) { rejectedCount++; continue; }

              // Zero Inference Policy: sanitize inferred numbers
              if (isInferred) {
                s.whyItMatters = (s.whyItMatters || '').replace(/₹[\d,.]+\s*(?:Cr|crore|cr)/gi, '[UNVERIFIED AMOUNT]')
                  .replace(/\d+\.?\d*%\s*(?:impact|revenue|of revenue|of mcap)/gi, '[UNVERIFIED %]');
              }

              s.verified = !isInferred && !isHeuristicDegraded && isMaterial;
              s.dataType = isInferred ? 'INFERENCE' : 'FACT';
              s.confidenceLayer = s.verified ? 100 : (isMaterial ? 60 : 40);
              // Heuristic-degraded signals forced to MONITOR regardless of materiality
              s.signalCategory = (isMaterial && !isInferred && !isHeuristicDegraded) ? 'ACTIONABLE' : 'MONITOR';

              // ── SIGNAL CONFIDENCE MODEL ──
              const srcScore = s.confidenceType === 'ACTUAL' ? 20 :
                s.sourceTier === 'VERIFIED' ? 15 :
                (s.dataSource === 'nse' || s.dataSource === 'NSE') ? 15 :
                s.source === 'deal' ? 15 : 5;
              const isFresh = s.freshness === 'FRESH';
              const freshScore = isFresh ? 15 : s.freshness === 'RECENT' ? 10 : s.freshness === 'AGING' ? 4 : 1;
              const hasPriceReaction = !!(s.priceChange && Math.abs(s.priceChange) > 1);
              const priceScore = hasPriceReaction ? 20 : 0;
              const hasVolumeSpike = !!(s.volumeRatio && s.volumeRatio > 2);
              const volumeScore = hasVolumeSpike ? 15 : 0;
              const hasMultipleSources = !!(s.corroborationCount && s.corroborationCount > 1);
              const multiSourceScore = hasMultipleSources ? 15 : 0;
              s.monitorScore = Math.min(100, srcScore + freshScore + priceScore + volumeScore + multiSourceScore);
              s.monitorTier = s.monitorScore >= 75 ? 'HIGH' : s.monitorScore >= 55 ? 'MEDIUM' : 'LOW';

              // EVENT CLASS SANITIZATION: strip synthetic numbers from non-financial events
              const NON_FIN_TYPES = new Set(['Mgmt Change', 'Board Appointment', 'CEO Exit', 'CFO Exit', 'Leadership Transition', 'Regulatory', 'Compliance']);
              const eventLower = (s.eventType || '').toLowerCase();
              const isNonFinancial = NON_FIN_TYPES.has(s.eventType) ||
                eventLower.includes('mgmt') || eventLower.includes('management') ||
                eventLower.includes('board') || eventLower.includes('appointment') ||
                eventLower.includes('resignation');
              const isStrategicInferred = !NON_FIN_TYPES.has(s.eventType) &&
                !['Order Win','Contract','LOI','Capex/Expansion','Fund Raising','Guidance','M&A','Demerger','Buyback','Dividend','Block Deal','Bulk Deal','Stake Sale'].includes(s.eventType) &&
                (s.confidenceType === 'HEURISTIC' || s.inferenceUsed);

              // ALWAYS neutralize watchSubtype and clean action for ALL signals
              s.watchSubtype = undefined;
              if (s.action && (s.action as string).includes('-')) {
                s.action = (s.action as string).split('-')[0] as any; // WATCH-ACTIVE → WATCH
              }

              const stripFinText = (txt: string) => txt
                .replace(/₹[\d,.]+\s*(?:Cr|crore|cr|Lakh|lakh|K\s*Cr|L|K)\s*(?:\(est\.?\))?/gi, '')
                .replace(/₹[\d,.]+/g, '')  // catch any remaining bare ₹ numbers
                .replace(/\d+\.?\d*%\s*(?:of\s+)?(?:revenue|mcap|impact|growth)\s*(?:\(est\.?\))?/gi, '')
                .replace(/\[UNVERIFIED AMOUNT\]/g, '').replace(/\[UNVERIFIED %\]/g, '')
                .replace(/\[UNVERIFIED\]\s*/g, '')
                .replace(/\(est\.?\)/g, '')  // strip standalone (est.) markers
                .replace(/\s*—\s*$/g, '').replace(/\s*·\s*$/g, '').replace(/\s{2,}/g, ' ').trim();

              if (isNonFinancial) {
                s.valueCr = 0; s.impactPct = 0; s.pctRevenue = null; s.pctMcap = null;
                s.inferenceUsed = false; s.confidenceType = 'ACTUAL';
                s.signalTier = 'TIER1_VERIFIED';  // Event itself is real
                s.valueSource = 'EXACT';
                s.heuristicSuppressed = false;  // Not relevant for non-financial
                s.anomalyFlags = [];  // Clear anomaly flags for non-financial events
                s.impactLevel = 'LOW';
                s.whyItMatters = stripFinText(s.whyItMatters || '');
                if (!s.whyItMatters || s.whyItMatters.length < 10) {
                  s.whyItMatters = (s.eventType || 'Corporate event') + ' — watch for strategy continuity';
                }
                if (s.headline) s.headline = stripFinText(s.headline);
                if (s.sourceExtract) {
                  s.sourceExtract = stripFinText(s.sourceExtract);
                  if (!s.sourceExtract || s.sourceExtract.length < 5) s.sourceExtract = undefined;
                }
                if (s.whyAction) s.whyAction = stripFinText(s.whyAction);
                if (!s.whyAction || s.whyAction.length < 5) {
                  s.whyAction = 'Monitor for strategic impact';
                }
              } else if (isStrategicInferred) {
                s.valueCr = 0; s.impactPct = 0; s.pctRevenue = null; s.pctMcap = null;
                s.whyItMatters = stripFinText(s.whyItMatters || '');
                if (s.sourceExtract) s.sourceExtract = stripFinText(s.sourceExtract);
                if (s.whyAction) s.whyAction = stripFinText(s.whyAction);
              }

              // ── v7: PRODUCTION DECISION ENGINE ──
              // ALWAYS reclassify: cached signals may have wrong class from old compute logic
              // (old default was COMPLIANCE for all unknown events, causing mass governance-block)
              const oldSignalClass = s.signalClass;
              s.signalClass = classifySignalClass(s.eventType, s.headline, s.whyItMatters);
              s.managementRole = s.managementRole || extractMgmtRole(s.headline, s.whyItMatters);

              // ── CRITICAL: Reset stale visibility from cached compute data ──
              // If signal was HIDDEN by old compute logic (when default was COMPLIANCE)
              // but NOW reclassifies as ECONOMIC/STRATEGIC, it should NOT be hidden.
              // Reset visibility and let downstream governance block re-evaluate.
              if (s.visibility === 'HIDDEN' && s.signalCategory === 'REJECTED') {
                if (s.signalClass === 'ECONOMIC' || s.signalClass === 'STRATEGIC') {
                  s.visibility = 'VISIBLE';
                  s.signalCategory = 'MONITOR'; // Let downstream logic re-tier properly
                }
              }

              // False classification guard
              if (s.signalClass === 'GOVERNANCE' && !isRealMgmtChange(s.headline, s.whyItMatters, s.dataSource)) {
                s.signalClass = 'COMPLIANCE';
              }

              // ── v8: GOVERNANCE ABSOLUTE HARD BLOCK ──
              // Non-senior governance/compliance signals are ALWAYS hidden — no exceptions
              // IMPORTANT: Only applies to ACTUAL governance events, NOT to economic/strategic signals
              // that happened to fall through to COMPLIANCE default in classifySignalClass
              const HARD_SENIOR_ROLES_GET = new Set(['CEO','CFO','MD','Chairman','Managing Director','Chief Executive','Chief Financial','Executive Director','Whole Time Director','Whole-Time Director']);
              const isActualGovernanceEvent = s.signalClass === 'GOVERNANCE' ||
                GOVERNANCE_EVENTS.has(s.eventType) || COMPLIANCE_EVENTS.has(s.eventType) ||
                s.eventType === 'Mgmt Change' || s.eventType === 'Board Appointment' || s.eventType === 'Board Change' ||
                s.eventType === 'Board Meeting' || s.eventType === 'AGM' || s.eventType === 'EGM';
              // COMPLIANCE class from fallback (not in COMPLIANCE_EVENTS set) = NOT a governance event
              const isComplianceFallback = s.signalClass === 'COMPLIANCE' && !COMPLIANCE_EVENTS.has(s.eventType) &&
                !GOVERNANCE_EVENTS.has(s.eventType);

              if (isActualGovernanceEvent && !isComplianceFallback) {
                // Layer 1: role-based block
                const role = (s.managementRole || '').trim();
                const isSeniorRole = Array.from(HARD_SENIOR_ROLES_GET).some(sr => role.toLowerCase().includes(sr.toLowerCase()));
                if (!isSeniorRole) {
                  s.visibility = 'HIDDEN';
                  s.signalCategory = 'REJECTED';
                }
              }
              // Layer 2: headline text block — catches Corporate events with non-senior roles
              const NON_SENIOR_TERMS = [
                'company secretary', 'compliance officer', 'statutory auditor', 'company auditor',
                'cost auditor', 'secretarial auditor', 'internal auditor', 'registrar',
                'transfer agent', 'share transfer agent', 'kmp change', 'company auditor change',
              ];
              const fullText_gov = `${s.headline || ''} ${s.whyItMatters || ''} ${s.sourceExtract || ''}`.toLowerCase();
              if (NON_SENIOR_TERMS.some(t => fullText_gov.includes(t))) {
                s.visibility = 'HIDDEN';
                s.signalCategory = 'REJECTED';
              }

              // Materiality score
              let ecoImpact = 0;
              if (s.signalClass === 'ECONOMIC') {
                const revPct = Math.abs(s.impactPct || 0);
                const valRatio = s.revenueCr ? (s.valueCr / s.revenueCr) * 100 : 0;
                ecoImpact = Math.min(40, (revPct * 3) + (valRatio * 2));
                if (s.confidenceType === 'ACTUAL' && s.valueCr > 0) ecoImpact = Math.min(40, ecoImpact + 10);
              }
              const evtW = (EVT_WEIGHTS[s.eventType] || 0) / 100 * 25;
              const confW = s.confidenceType === 'ACTUAL' ? 15 : s.sourceTier === 'VERIFIED' ? 12 : 5;
              let mgmtW = 0;
              if (s.signalClass === 'GOVERNANCE' || s.signalClass === 'STRATEGIC') {
                mgmtW = (ROLE_SCORES[s.managementRole] || 10) / 100 * 10;
              }
              const recW = s.freshness === 'FRESH' ? 10 : s.freshness === 'RECENT' ? 7 : 3;
              s.materialityScore = Math.min(100, Math.round(ecoImpact + evtW + confW + mgmtW + recW));

              // Apply exponential time decay to materiality score
              // Newer signals weigh more: score = baseScore * exp(-lambda * daysSince)
              s.materialityScore = Math.round(s.materialityScore * (s._timeDecay || 1));

              // Governance materiality ladder (with strategic vs routine classification)
              // IMPORTANT: never override HIDDEN visibility set by governance hard block
              if (s.signalClass === 'GOVERNANCE' && s.visibility !== 'HIDDEN') {
                const govLevel = governanceMateriality(s.managementRole || 'Other');
                const mgmtType = classifyMgmtChangeType(s);
                if (mgmtType === 'ROUTINE') {
                  s.materialityScore = Math.round(s.materialityScore * 0.3);
                  s.visibility = 'DIMMED';
                } else if (govLevel === 'LOW' || govLevel === 'VERY_LOW') {
                  s.materialityScore = Math.round(s.materialityScore * 0.3);
                  s.visibility = 'DIMMED';
                } else if (govLevel === 'MEDIUM') {
                  s.materialityScore = Math.round(s.materialityScore * 0.6);
                  s.visibility = 'DIMMED';
                } else {
                  s.visibility = 'VISIBLE';
                }
              } else if (s.signalClass === 'COMPLIANCE') {
                if (s.visibility !== 'HIDDEN') s.visibility = 'DIMMED';
              } else {
                if (s.visibility !== 'HIDDEN') s.visibility = 'VISIBLE';
              }

              // ★ HARD GATING ★
              const confSc = s.dataConfidenceScore || s.confidenceScore || 50;
              const isInferredSignal = s.inferenceUsed || s.confidenceType === 'HEURISTIC' || s.confidenceType === 'INFERRED';
              const isVerifiedSrc = s.confidenceType === 'ACTUAL' || s.sourceTier === 'VERIFIED';

              // RULE 1: confidence < 60 → CANNOT be ACTIONABLE (but never un-reject)
              if (confSc < 60 && s.signalCategory !== 'REJECTED') {
                s.signalCategory = 'MONITOR';
                s.portfolioCritical = false;
              }
              // RULE 2: inferred + confidence < 70 → max MONITOR (but never un-reject)
              if (isInferredSignal && confSc < 70 && s.signalCategory !== 'REJECTED') {
                s.signalCategory = 'MONITOR';
                s.portfolioCritical = false;
              }
              // RULE 3: CAPEX/M&A/ORDER — realistic scoring by value tier
              if (['Capex/Expansion', 'M&A', 'Order Win', 'Contract'].includes(s.eventType)) {
                const valCr = Math.abs(s.valueCr || 0);
                if (!isVerifiedSrc) {
                  // Unverified: tier by value — <₹200Cr→LOW(30-45), ₹200-500Cr→MEDIUM(45-65), >₹500Cr+funding→HIGH(65-80)
                  if (valCr < 200) {
                    s.materialityScore = Math.min(s.materialityScore, 45);
                    s.monitorTier = 'LOW';
                  } else if (valCr < 500) {
                    s.materialityScore = Math.min(s.materialityScore, 65);
                    s.monitorTier = 'MEDIUM';
                  } else {
                    s.materialityScore = Math.min(s.materialityScore, 80);
                    s.monitorTier = 'HIGH';
                  }
                } else {
                  // Verified but still tier-cap to avoid inflation
                  if (valCr < 100) {
                    s.materialityScore = Math.min(s.materialityScore, 60);
                  } else if (valCr < 500) {
                    s.materialityScore = Math.min(s.materialityScore, 80);
                  }
                  // >500Cr verified → uncapped
                }
              }
              // RULE 4: No impact % on ECONOMIC → not actionable (but never un-reject)
              if ((s.impactPct || 0) === 0 && s.signalClass === 'ECONOMIC' && s.signalCategory !== 'REJECTED') {
                s.signalCategory = 'MONITOR';
                s.materialityScore = Math.min(s.materialityScore, 50);
              }

              // Verified signal recovery (strict: non-inferred + high confidence)
              // NEVER recover HIDDEN/REJECTED signals — governance block is absolute
              const isKeyEvt = ['Guidance', 'Earnings', 'Order Win', 'Contract', 'Capex/Expansion', 'M&A'].includes(s.eventType);
              if (isVerifiedSrc && isKeyEvt && !isInferredSignal && s.visibility !== 'HIDDEN' && s.signalCategory !== 'REJECTED') {
                s.materialityScore = Math.max(s.materialityScore, 55);
                s.visibility = 'VISIBLE';
                if (confSc >= 70 && Math.abs(s.impactPct || 0) > 3) {
                  s.signalCategory = 'ACTIONABLE';
                }
              }

              // Portfolio critical filter
              if (s.isPortfolio) {
                s.portfolioCritical = (
                  confSc >= 70 && !isInferredSignal &&
                  (Math.abs(s.impactPct || 0) >= 3 || ['Guidance', 'Earnings', 'CEO Change', 'CFO Change', 'MD Change'].includes(s.eventType))
                );
              } else {
                s.portfolioCritical = false;
              }

              // Unverified ranking cap
              if (confSc < 40) {
                s.visibility = s.visibility === 'VISIBLE' ? 'DIMMED' : s.visibility;
                s.materialityScore = Math.min(s.materialityScore, 40);
              } else if (confSc < 50) {
                s.materialityScore = Math.min(s.materialityScore, 55);
              }

              // v7 composite rank score
              s.v7RankScore = computeV7RankScore(s);

              // Action from materiality
              const mscore = s.materialityScore || 0;
              if ((s.signalClass === 'GOVERNANCE' || s.signalClass === 'STRATEGIC') && (s.impactPct || 0) === 0) {
                s.action = mscore >= 45 ? 'HOLD' : 'WATCH';
              } else if (mscore >= 75) {
                s.action = s.isNegative ? 'TRIM' : 'BUY';
              } else if (mscore >= 60) {
                s.action = s.isNegative ? 'HOLD' : 'ADD';
              } else if (mscore >= 45) {
                s.action = 'HOLD';
              } else {
                s.action = 'WATCH';
              }

              // WhyItMatters override for governance/strategic
              if (s.signalClass === 'GOVERNANCE') {
                const role = s.managementRole || 'Management';
                const isSenior = SENIOR_ROLES.has(role);
                s.whyItMatters = isSenior
                  ? `${role} change at leadership level — monitor for strategy continuity`
                  : `${s.eventType || 'Mgmt Change'} — routine governance event`;
                s.whyAction = isSenior ? 'Monitor for strategic impact' : 'Low materiality governance event';
              } else if (s.signalClass === 'STRATEGIC') {
                const role = s.managementRole || 'Leadership';
                s.whyItMatters = `${role} change — potential strategy shift · Watch for execution impact`;
              }

              // ── NARRATIVE QUALITY GATE ──
              // If surfaced signal has empty or too-short narrative, demote to MONITOR
              if (s.signalTierV7 === 'NOTABLE' || s.signalTierV7 === 'ACTIONABLE') {
                const narrative = (s.whyItMatters || '').trim();
                if (narrative.length < 20 || narrative === 'Monitor for strategic impact' || narrative.includes('[UNVERIFIED')) {
                  s.signalTierV7 = 'MONITOR';
                  if (s.signalCategory === 'ACTIONABLE') s.signalCategory = 'MONITOR';
                }
              }

              // Governance scoring penalty
              if (s.signalClass === 'GOVERNANCE') {
                s.monitorScore = Math.round((s.monitorScore || 0) * 0.5);
                s.monitorTier = s.monitorScore >= 80 ? 'HIGH' : s.monitorScore >= 50 ? 'MED' : 'LOW';
                s.catalystStrength = 'WEAK';
              }

              // Signal tier classification
              // NON-NEGOTIABLE: inferred signals with conf < 60 can NEVER be NOTABLE
              const isInferredHere = s.confidenceType === 'INFERRED' || s.confidenceType === 'HEURISTIC' || s.inferenceUsed;
              const inferredBlockedHere = isInferredHere && confSc < 60;
              if (!inferredBlockedHere && s.signalCategory === 'MONITOR' && s.materialityScore >= 50 && confSc >= 50) {
                s.signalTierV7 = 'NOTABLE';
              } else if (s.signalCategory === 'ACTIONABLE') {
                s.signalTierV7 = 'ACTIONABLE';
              } else {
                s.signalTierV7 = 'MONITOR';
              }

              // ── TIER 3 EVENT ENFORCEMENT ──
              // Use eventTaxonomyTier from compute if available, else classify here
              const T3_EVENTS_GET = new Set(['Corporate', 'Compliance', 'Regulatory', 'Filing Update', 'Routine Disclosure', 'Mgmt Change', 'Board Appointment', 'Board Meeting']);
              const T3_HEADLINE_TERMS = ['company secretary', 'compliance officer', 'disclosure', 'intimation', 'routine', 'annual return', 'agm', 'egm'];
              const isT3Event = s.eventTaxonomyTier === 'TIER_3' || T3_EVENTS_GET.has(s.eventType) ||
                T3_HEADLINE_TERMS.some(t => (s.headline || '').toLowerCase().includes(t));
              if (isT3Event) {
                // Tier 3 events can NEVER be ACTIONABLE, and need corroboration to be NOTABLE
                if (s.signalTierV7 === 'ACTIONABLE' || s.signalCategory === 'ACTIONABLE') {
                  s.signalTierV7 = 'MONITOR';
                  s.signalCategory = 'MONITOR';
                  s.monitorTier = 'LOW';
                }
                if (s.signalTierV7 === 'NOTABLE') {
                  const hasCorroboration = (s.impactPct && Math.abs(s.impactPct) > 2) || (s.materialityScore >= 70);
                  if (!hasCorroboration) {
                    s.signalTierV7 = 'MONITOR';
                  }
                }
              }

              // HIDDEN → rejected
              if (s.visibility === 'HIDDEN') {
                const hiddenReason = s.signalCategory === 'REJECTED' ? 'hidden_governance' : 'hidden_other';
                _rejectReasons[hiddenReason] = (_rejectReasons[hiddenReason] || 0) + 1;
                if (_rejectSamples.length < 10) _rejectSamples.push({ ticker: s.ticker || s.symbol, reason: hiddenReason, signalClass: s.signalClass, eventType: s.eventType, managementRole: s.managementRole });
                rejectedCount++;
                continue;
              }

              if (s.signalCategory === 'ACTIONABLE') {
                actionableSignals.push(s);
              } else {
                monitorSignals.push(s);
              }
            }

            // ── SEMANTIC DEDUPE: collapse duplicate company+event pairs within 3-day window ──
            // Same company + same event type within 3 days = one signal (keep highest scoring)
            const dedupeKey = (s: any) => {
              const sym = (s.ticker || s.symbol || '').toUpperCase();
              const evt = (s.eventType || 'unknown').toLowerCase();
              const d = s.date || s.publishedAt || s.eventDate || '';
              // Bucket into 3-day windows: floor(daysSinceEpoch / 3)
              let bucket = '0';
              if (d) {
                try {
                  const ms = new Date(d).getTime();
                  bucket = String(Math.floor(ms / (86400000 * 3)));
                } catch { bucket = '0'; }
              }
              return `${sym}|${evt}|${bucket}`;
            };
            const dedupeActionable = new Map<string, any>();
            for (const s of actionableSignals) {
              const k = dedupeKey(s);
              const existing = dedupeActionable.get(k);
              if (!existing || (s.v7RankScore || 0) > (existing.v7RankScore || 0)) {
                dedupeActionable.set(k, s);
              }
            }
            const dedupeMonitor = new Map<string, any>();
            for (const s of monitorSignals) {
              const k = dedupeKey(s);
              // Also check if this key was already in actionable — skip if so
              if (dedupeActionable.has(k)) continue;
              const existing = dedupeMonitor.get(k);
              if (!existing || (s.v7RankScore || 0) > (existing.v7RankScore || 0)) {
                dedupeMonitor.set(k, s);
              }
            }
            // Replace arrays with deduped versions
            actionableSignals.length = 0;
            actionableSignals.push(...dedupeActionable.values());
            monitorSignals.length = 0;
            monitorSignals.push(...dedupeMonitor.values());

            // ── ADAPTIVE SIGNAL TIERING (India-market calibrated) ──
            // Compute universe-relative confidence for adaptive thresholds
            const allConfs = [...actionableSignals, ...monitorSignals].map((s: any) => s.monitorScore || s.confidenceScore || s.dataConfidenceScore || 0);
            const avgConf = allConfs.length > 0 ? allConfs.reduce((a, b) => a + b, 0) / allConfs.length : 50;
            const sortedConfs = [...allConfs].sort((a, b) => b - a);
            const p80Conf = sortedConfs[Math.floor(sortedConfs.length * 0.2)] || 50; // top 20% threshold

            // True corroboration: count of distinct source types (not same-source duplicates)
            const countTrueCorroboration = (s: any): number => {
              if (!s.signalStackCount || s.signalStackCount < 2) return 0;
              if (!(s as any)._stackIndependent) return 0;
              return (s as any)._stackUniqueSources || 0;
            };

            const classifyTier = (s: any): 'ACTIONABLE' | 'NOTABLE' | 'MONITOR' | 'SPECULATIVE' | 'REJECTED' => {
              const conf = s.monitorScore || s.confidenceScore || s.dataConfidenceScore || 0;
              const mat = s.materialityScore || 0;
              const isVerified = s.confidenceType === 'ACTUAL' || s.verified;
              const isInferred = s.confidenceType === 'INFERRED' || s.confidenceType === 'HEURISTIC' || s.inferenceUsed;
              const corrobCount = countTrueCorroboration(s);

              // ── HARD REJECTION: conf < 35 OR mat < 40 → never surface ──
              if (conf < 35 && mat < 40) return 'REJECTED';

              // ── NON-NEGOTIABLE INFERRED GATE ──
              // Inferred signals with conf < 60 can NEVER be ACTIONABLE or NOTABLE
              const inferredBlocked = isInferred && conf < 60;

              // Tier 1: ACTIONABLE — verified + strong confidence + material
              if (!inferredBlocked && isVerified && conf >= 75 && mat >= 70) return 'ACTIONABLE';

              // Tier 2: NOTABLE — verified + good confidence, or high-conf inferred with corroboration
              if (!inferredBlocked && isVerified && conf >= 60 && mat >= 55) return 'NOTABLE';
              if (!inferredBlocked && conf >= 60 && mat >= 55 && corrobCount >= 2) return 'NOTABLE';

              // Tier 3: MONITOR — reasonable signal
              if (conf >= 45 || corrobCount >= 2) return 'MONITOR';
              if (mat >= 45) return 'MONITOR';

              // Tier 4: SPECULATIVE — exists but below threshold
              if (conf >= 25 || mat >= 25) return 'SPECULATIVE';

              return 'REJECTED';
            };

            // Separate signals into tiers
            const speculativeSignals: any[] = [];
            const surfaceableActionable: any[] = [];
            const surfaceableMonitor: any[] = [];

            for (const s of [...actionableSignals, ...monitorSignals]) {
              const tier = classifyTier(s);
              if (tier === 'ACTIONABLE') {
                s.signalTierV7 = 'ACTIONABLE';
                s.signalCategory = 'ACTIONABLE';
                surfaceableActionable.push(s);
              } else if (tier === 'NOTABLE') {
                s.signalTierV7 = 'NOTABLE';
                s.signalCategory = 'MONITOR';
                surfaceableMonitor.push(s);
              } else if (tier === 'MONITOR') {
                s.signalTierV7 = 'MONITOR';
                s.signalCategory = 'MONITOR';
                surfaceableMonitor.push(s);
              } else if (tier === 'SPECULATIVE') {
                s._speculative = true;
                speculativeSignals.push(s);
              } else {
                // REJECTED — already counted
                rejectedCount++;
              }
            }

            // ── v7: Sort by composite rank score ──
            surfaceableActionable.sort((a: any, b: any) => (b.v7RankScore || 0) - (a.v7RankScore || 0));
            surfaceableMonitor.sort((a: any, b: any) => (b.v7RankScore || 0) - (a.v7RankScore || 0));
            speculativeSignals.sort((a: any, b: any) => (b.v7RankScore || 0) - (a.v7RankScore || 0));

            // Enforce output constraints + separate notable tier
            const MAX_ACTIONABLE = 3;
            const MAX_NOTABLE = 5;
            const MAX_MONITOR = 10;
            const MAX_SPECULATIVE = 5;

            const notableSignals = surfaceableMonitor.filter((s: any) => s.signalTierV7 === 'NOTABLE');
            const regularMonitor = surfaceableMonitor.filter((s: any) => s.signalTierV7 !== 'NOTABLE');

            // Overflow: excess actionable → notable
            if (surfaceableActionable.length > MAX_ACTIONABLE) {
              notableSignals.unshift(...surfaceableActionable.splice(MAX_ACTIONABLE));
            }

            // ── MINIMUM OUTPUT GUARANTEES (anti-empty system) ──
            // If monitor is empty but speculative has signals, promote top speculative to monitor
            if (regularMonitor.length < 3 && speculativeSignals.length > 0) {
              const needed = Math.min(5, 3 - regularMonitor.length, speculativeSignals.length);
              for (let i = 0; i < needed; i++) {
                const promoted = speculativeSignals.shift()!;
                promoted._speculative = false;
                promoted._promotedFromSpeculative = true;
                promoted.signalTierV7 = 'MONITOR';
                promoted.signalCategory = 'MONITOR';
                regularMonitor.push(promoted);
              }
            }
            // If notable is empty but there are signals at all, promote top monitor to notable
            // NON-NEGOTIABLE: inferred signals with conf < 60 cannot be promoted to NOTABLE
            if (notableSignals.length === 0 && regularMonitor.length > 0) {
              const eligibleForNotable = regularMonitor.filter((s: any) => {
                const isInf = s.confidenceType === 'INFERRED' || s.confidenceType === 'HEURISTIC' || s.inferenceUsed;
                const confVal = s.dataConfidenceScore || s.confidenceScore || 0;
                return !(isInf && confVal < 60);
              });
              const promotee = eligibleForNotable.length > 0 ? eligibleForNotable[0] : regularMonitor[0];
              if (promotee) {
                const idx = regularMonitor.indexOf(promotee);
                if (idx >= 0) regularMonitor.splice(idx, 1);
                promotee.signalTierV7 = 'NOTABLE';
                promotee._promotedToNotable = true;
                notableSignals.push(promotee);
              }
            }

            const totalProcessed = surfaceableActionable.length + notableSignals.length + regularMonitor.length + speculativeSignals.length + rejectedCount;
            const rejectedPct = totalProcessed > 0 ? (rejectedCount / totalProcessed) * 100 : 0;
            const productionReady = surfaceableActionable.length <= MAX_ACTIONABLE;

            // Rebuild bias from all valid signals (including speculative for counts)
            const validSignals = [...surfaceableActionable, ...notableSignals, ...regularMonitor];
            const validBias = responseData.bias ? { ...responseData.bias } : {} as any;
            if (validSignals.length === 0) {
              validBias.totalSignals = 0; validBias.highImpactCount = 0; validBias.buyWatchCount = 0;
              validBias.buyCount = 0; validBias.holdCount = 0; validBias.watchCount = 0;
              validBias.trackCount = 0; validBias.monitorCount = 0; validBias.trimExitCount = 0;
              validBias.reduceExitCount = 0; validBias.negativeSignals = 0; validBias.portfolioAlerts = 0;
              validBias.totalObservations = 0; validBias.totalOrderValueCr = 0; validBias.totalDealValueCr = 0;
              validBias.activeSectors = [];
              validBias.summary = `0 Actionable · 0 Notable · ${rejectedCount} Rejected — No high-confidence signals today`;
              validBias.netBias = 'Neutral';
            } else {
              let hCount = 0, wCount = 0, bCount = 0, tCount = 0, hiCount = 0, pAlerts = 0, negCount = 0;
              let bullish = 0, bearish = 0, totOrd = 0, totDeal = 0;
              for (const vs of validSignals) {
                if (vs.action === 'HOLD') hCount++;
                else if (vs.action === 'WATCH') wCount++;
                else if (vs.action === 'BUY' || vs.action === 'ADD') bCount++;
                if (vs.action === 'TRIM' || vs.action === 'EXIT') tCount++;
                if (vs.impactLevel === 'HIGH') hiCount++;
                if (vs.isPortfolio && vs.portfolioCritical) pAlerts++;
                if (vs.isNegative) negCount++;
                if (vs.sentiment === 'Bullish') bullish++;
                if (vs.sentiment === 'Bearish') bearish++;
                if (vs.source === 'order' && vs.valueCr) totOrd += vs.valueCr;
                if (vs.source === 'deal' && vs.valueCr) totDeal += vs.valueCr;
              }
              validBias.totalSignals = surfaceableActionable.length;
              validBias.totalObservations = notableSignals.length + regularMonitor.length;
              validBias.holdCount = hCount; validBias.watchCount = wCount;
              validBias.monitorCount = notableSignals.length + regularMonitor.length;
              validBias.buyCount = bCount; validBias.addCount = 0; validBias.buyWatchCount = 0;
              validBias.trimExitCount = tCount; validBias.reduceExitCount = tCount;
              validBias.highImpactCount = hiCount; validBias.portfolioAlerts = pAlerts;
              validBias.negativeSignals = negCount;
              validBias.totalOrderValueCr = Math.round(totOrd);
              validBias.totalDealValueCr = Math.round(totDeal);
              validBias.netBias = bullish > bearish + 2 ? 'Bullish' : bearish > bullish + 2 ? 'Bearish' : 'Neutral';
              validBias.activeSectors = [...new Set(validSignals.map((s: any) => s.sector || s.segment).filter(Boolean))];
              const biasParts: string[] = [];
              if (surfaceableActionable.length > 0) biasParts.push(`${surfaceableActionable.length} Actionable`);
              if (notableSignals.length > 0) biasParts.push(`${notableSignals.length} Notable`);
              biasParts.push(`${regularMonitor.length} Monitor`);
              biasParts.push(`${rejectedCount} Rejected`);
              biasParts.push(`Net: ${validBias.netBias}`);
              validBias.summary = biasParts.join(' · ');
            }

            // ── v7: Feed composition — v7RankScore sorted, ECONOMIC first ──
            const allVisibleSignals = [...surfaceableActionable, ...notableSignals, ...regularMonitor];
            allVisibleSignals.sort((a: any, b: any) => (b.v7RankScore || 0) - (a.v7RankScore || 0));
            const composedFeed = allVisibleSignals.slice(0, 10);

            // ── v8: Generate Thematic Ideas from validSignals (GET route) ──
            const SECTOR_THEME_MAP_GET: Record<string, { tag: string; label: string }> = {
              'IT': { tag: 'TECH_TRANSITION', label: 'Tech Transition Play' },
              'Technology': { tag: 'TECH_TRANSITION', label: 'Tech Transition Play' },
              'Defence': { tag: 'SUNRISE_SECTOR', label: 'Defence / Sunrise Sector' },
              'Defense': { tag: 'SUNRISE_SECTOR', label: 'Defence / Sunrise Sector' },
              'Renewable Energy': { tag: 'SUNRISE_SECTOR', label: 'Energy Transition' },
              'Pharma': { tag: 'GLOBAL_SCALING', label: 'Global Pharma Scaling' },
              'Pharmaceuticals': { tag: 'GLOBAL_SCALING', label: 'Global Pharma Scaling' },
              'Capital Goods': { tag: 'STRATEGIC_CAPEX', label: 'Strategic Capex Cycle' },
              'Infrastructure': { tag: 'STRATEGIC_CAPEX', label: 'Infrastructure Build-out' },
              'FMCG': { tag: 'OPERATING_LEVERAGE', label: 'FMCG Operating Leverage' },
              'Financials': { tag: 'POLICY_TAILWIND', label: 'Credit Cycle / Policy Tailwind' },
              'Banking': { tag: 'POLICY_TAILWIND', label: 'Credit Cycle / Policy Tailwind' },
              'Consumer': { tag: 'OPERATING_LEVERAGE', label: 'Consumer Recovery Leverage' },
              'Chemicals': { tag: 'GLOBAL_SCALING', label: 'Specialty Chemicals Export' },
            };
            const companyGroupGet = new Map<string, any[]>();
            for (const vs of validSignals) {
              const sym = (vs.ticker || vs.symbol || '').toUpperCase();
              if (!sym) continue;
              if (!companyGroupGet.has(sym)) companyGroupGet.set(sym, []);
              companyGroupGet.get(sym)!.push(vs);
            }
            const getThematicIdeas: any[] = [];
            for (const [sym, sigs] of companyGroupGet.entries()) {
              const rep = sigs[0];
              const sector = rep.sector || rep.segment || '';
              const themeEntry = SECTOR_THEME_MAP_GET[sector];
              if (!themeEntry && sigs.length < 2) continue; // skip single-signal non-sector stocks
              const tag = themeEntry?.tag || (sigs.length >= 3 ? 'MULTI_SIGNAL' : 'OPERATING_LEVERAGE');
              const label = themeEntry?.label || (sigs.length >= 3 ? 'Multi-Signal Convergence' : 'Momentum Build');
              const avgScore = Math.round(sigs.reduce((acc: number, s: any) => acc + (s.materialityScore || 40), 0) / sigs.length);
              const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = avgScore >= 65 ? 'HIGH' : avgScore >= 45 ? 'MEDIUM' : 'LOW';
              const narrative = sigs.length >= 3
                ? `${sigs.length} converging signals — ${label.toLowerCase()} thesis strengthening`
                : themeEntry
                ? `${sector} sector momentum — ${label.toLowerCase()} thesis`
                : `${sigs.length} signals detected — monitor for confirmation`;
              getThematicIdeas.push({
                symbol: sym,
                company: rep.company || rep.ticker || sym,
                theme: { tag, label, score: Math.min(95, avgScore + sigs.length * 5), confidence, narrative },
                signals: sigs.length,
                isPortfolio: !!(rep.isPortfolio),
                isWatchlist: !!(rep.isWatchlist),
                lastPrice: rep.lastPrice || null,
                segment: sector || null,
              });
            }
            // Sort: portfolio first, then by theme score desc
            getThematicIdeas.sort((a: any, b: any) => {
              if (a.isPortfolio && !b.isPortfolio) return -1;
              if (!a.isPortfolio && b.isPortfolio) return 1;
              if (a.isWatchlist && !b.isWatchlist) return -1;
              if (!a.isWatchlist && b.isWatchlist) return 1;
              return (b.theme.score || 0) - (a.theme.score || 0);
            });
            // Merge with any stored thematic ideas (prefer computed over derived)
            const storedThematicIds = new Set((responseData.thematicIdeas || []).map((t: any) => (t.symbol || '').toUpperCase()));
            const mergedThematic = [
              ...(responseData.thematicIdeas || []),
              ...getThematicIdeas.filter((t: any) => !storedThematicIds.has((t.symbol || '').toUpperCase())),
            ].slice(0, 6);

            // ── THEMATIC → SIGNAL PIPELINE ──
            // Convert strong thematic ideas into Notable signals when notable is sparse
            if (notableSignals.length < 2 && mergedThematic.length > 0) {
              for (const thematic of mergedThematic) {
                if (notableSignals.length >= 3) break;
                // Only convert if this company isn't already in notable/actionable
                const alreadyShown = surfaceableActionable.some((s: any) => (s.symbol || '').toUpperCase() === thematic.symbol) ||
                  notableSignals.some((s: any) => (s.symbol || '').toUpperCase() === thematic.symbol);
                if (alreadyShown) continue;
                // Create a derived signal from thematic idea
                const derivedSignal: any = {
                  symbol: thematic.symbol,
                  company: thematic.company,
                  date: new Date().toISOString().slice(0, 10),
                  source: 'order',
                  eventType: thematic.theme.tag === 'STRATEGIC_CAPEX' ? 'Capex/Expansion' : thematic.theme.tag === 'TURNAROUND' ? 'Turnaround' : 'Thematic',
                  headline: `${thematic.company}: ${thematic.theme.narrative}`,
                  valueCr: 0,
                  impactPct: 0,
                  pctRevenue: null,
                  pctMcap: null,
                  inferenceUsed: true,
                  client: null,
                  segment: thematic.segment,
                  timeline: null,
                  buyerSeller: null,
                  premiumDiscount: null,
                  impactLevel: 'MEDIUM' as any,
                  impactConfidence: 'MEDIUM' as any,
                  confidenceScore: thematic.theme.confidence === 'HIGH' ? 65 : thematic.theme.confidence === 'MEDIUM' ? 50 : 35,
                  confidenceType: 'HEURISTIC',
                  action: 'WATCH',
                  score: thematic.theme.score || 50,
                  timeWeight: 0.8,
                  weightedScore: thematic.theme.score || 50,
                  sentiment: 'Bullish' as any,
                  whyItMatters: thematic.theme.narrative,
                  whatHappened: `${thematic.company} has ${thematic.signals} converging signals in ${thematic.theme.label}`,
                  isNegative: false,
                  earningsBoost: false,
                  isWatchlist: !!thematic.isWatchlist,
                  isPortfolio: !!thematic.isPortfolio,
                  lastPrice: thematic.lastPrice,
                  materialityScore: thematic.theme.score || 50,
                  signalTierV7: 'NOTABLE',
                  signalCategory: 'MONITOR',
                  signalClass: 'ECONOMIC',
                  alphaTheme: thematic.theme,
                  _derivedFromThematic: true,
                  freshness: 'RECENT',
                  decision: 'WATCH',
                };
                notableSignals.push(derivedSignal);
              }
            }

            // ── QUIET MARKET MODE ──
            let finalActionable = surfaceableActionable.slice(0, MAX_ACTIONABLE);
            let finalNotable = notableSignals.slice(0, MAX_NOTABLE);
            const isQuietMarket = finalActionable.length === 0 && finalNotable.length === 0;

            // ── STRICT PF/WL FILTER: ensure no signals leak through if user has filtered portfolio ──
            // Final safety gate: all signals must pass the PF/WL filter if it was applied
            const enforceUserFilter = (arr: any[]) => shouldFilterCached
              ? arr.filter((s: any) => allUserTracked.has((s.symbol || s.ticker || '').toUpperCase()))
              : arr;

            // ── SANITIZE ALL NUMBERS: NaN/Infinity → null ──
            const sanitizeNum = (obj: any): any => {
              if (obj === null || obj === undefined) return obj;
              if (typeof obj === 'number') return isFinite(obj) ? obj : null;
              if (Array.isArray(obj)) return obj.map(sanitizeNum);
              if (typeof obj === 'object') {
                for (const k of Object.keys(obj)) { obj[k] = sanitizeNum(obj[k]); }
              }
              return obj;
            };

            responseData = sanitizeNum({
              ...responseData,
              signals: enforceUserFilter(finalActionable),
              notable: enforceUserFilter(finalNotable),
              observations: enforceUserFilter(regularMonitor.slice(0, MAX_MONITOR)),
              speculative: enforceUserFilter(speculativeSignals.slice(0, MAX_SPECULATIVE)),
              // Top Signals: ONLY ACTIONABLE or NOTABLE tier — never monitor/speculative/inferred-low-conf
              top3: enforceUserFilter(composedFeed.filter((s: any) =>
                (s.signalTierV7 === 'ACTIONABLE' || s.signalTierV7 === 'NOTABLE') &&
                !s._speculative && !s._derivedFromThematic
              ).slice(0, 5)),
              trends: validSignals.length > 0 ? responseData.trends : [],
              bias: validBias,
              thematicIdeas: mergedThematic,
              noActionableSignals: finalActionable.length === 0 && finalNotable.length === 0,
              noHighConfSignals: finalActionable.length === 0,
              quietMarket: isQuietMarket,
              _productionStatus: productionReady ? 'PRODUCTION_READY' : 'REFINEMENT_REQUIRED',
              _stats: {
                actionable: finalActionable.length, notable: finalNotable.length,
                monitor: regularMonitor.length, speculative: speculativeSignals.length,
                rejected: rejectedCount, rejectedPct: Math.round(rejectedPct),
                rawCount: rawSignals.length, _rejectReasons, _rejectSamples,
              },
            });
          }

          return NextResponse.json({
            ...responseData,
            _meta: {
              source: 'precomputed',
              computedAt: meta.computedAt,
              stale: isStale,
              ageMinutes: Math.round(ageMs / 60000),
              version: meta.version,
              totalSignalsBefore: allCachedSignals.length,
              totalSignalsDateFiltered: dateFilteredSignals.length,
              totalSignalsAfter: (responseData.signals?.length || 0) + (responseData.notable?.length || 0) + (responseData.observations?.length || 0),
              filterRange: days + 'D',
              cutoffDate: cutoffMs > 0 ? new Date(cutoffMs).toISOString() : 'none',
            }
          });
        }
      } catch (e) {
        console.warn('[Intelligence] Precomputed store read failed:', e);
      }
    }

    // ── Precomputed store is EMPTY — trigger background compute, return skeleton ──
    // Strict read-only path: never block the UI with inline compute
    if (!forceRefresh) {
      console.log('[Intelligence] No precomputed data — triggering background compute, returning skeleton');
      try {
        const computeUrl = new URL('/api/market/intelligence/compute', request.url);
        fetch(computeUrl.toString(), { method: 'GET', signal: AbortSignal.timeout(3000) }).catch(() => {});
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
          summary: 'Computing intelligence... refresh in 30 seconds',
        },
        updatedAt: new Date().toISOString(),
        _meta: { source: 'skeleton', computing: true },
      });
    }

    // ── Inline compute ONLY when force=true (admin/debug) ──
    // Route-level cache (BUG-01 fix: instant response on repeat calls)
    const cacheKey = `${watchlist.join(',')}|${portfolio.join(',')}|${days}`;
    if (_routeCache && _routeCache.key === cacheKey && (Date.now() - _routeCache.timestamp) < ROUTE_CACHE_TTL) {
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

      // Track value source for UI transparency badge
      let valueSource: 'EXACT' | 'AGGREGATED' | 'HEURISTIC' = 'HEURISTIC';

      if (extractedValue !== null && extractedValue > 0) {
        // EXPLICIT VALUE FOUND — pctRevenue = value / revenue (NEVER a fixed constant)
        valueCr = extractedValue;
        valueSource = 'EXACT';
        if (enrichment?.annualRevenueCr && enrichment.annualRevenueCr > 0) {
          impactPct = parseFloat(((valueCr / enrichment.annualRevenueCr) * 100).toFixed(2));
          // Guardrail: reject if pctRevenue > 100% (likely wrong revenue denominator)
          if (impactPct > 100) {
            impactPct = Math.min(impactPct, 100);
          }
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

      // EVENT INTEGRITY GATE: If value is HEURISTIC and impactPct > 10%, suppress confidence
      // Prevents fake high-impact signals from heuristic estimation
      if (valueSource === 'HEURISTIC' && impactPct > 10) {
        confidenceScore = Math.round(confidenceScore * 0.6);
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
        valueSource,
        action, score, timeWeight, weightedScore, sentiment, whyItMatters,
        isNegative: negative, earningsBoost, isWatchlist, isPortfolio,
        dataSource,
      };

      // MULTI-EVENT AGGREGATION: When same symbol + eventType within 3-day window,
      // SUM values (for order clusters like QPOWER ₹18+₹34+₹57+₹146 = ₹255 Cr)
      if (existing) {
        // Check if dates within 3 days of each other
        const existDate = new Date(existing.date).getTime();
        const newDate = new Date(signal.date).getTime();
        const daysDiff = Math.abs(existDate - newDate) / (1000 * 60 * 60 * 24);

        if (daysDiff <= 3 && valueSource === 'EXACT' && existing.valueSource === 'EXACT') {
          // Aggregate: sum values for order clusters
          existing.valueCr += signal.valueCr;
          existing.valueSource = 'AGGREGATED';
          // Recalculate impact
          if (enrichment?.annualRevenueCr && enrichment.annualRevenueCr > 0) {
            existing.impactPct = parseFloat(((existing.valueCr / enrichment.annualRevenueCr) * 100).toFixed(2));
            existing.pctRevenue = existing.impactPct;
          }
          existing.impactLevel = classifyImpactLevel(existing.impactPct);
          existing.headline = `${fmtCr(existing.valueCr)} ${eventType} (aggregated)`;
          if (existing.impactPct > 0) existing.headline += ` — ${existing.impactPct.toFixed(1)}% of revenue`;
        } else if (weightedScore > existing.weightedScore) {
          // Keep higher scoring signal, but preserve MAX value
          if (existing.valueCr > signal.valueCr) {
            signal.valueCr = existing.valueCr;
          }
          dedupMap.set(dedupKey, signal);
        }
      } else {
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

      // ── INDEPENDENCE VALIDATION ──
      // Stacking bonus only if 2+ independent sources OR 2+ distinct event types
      const uniqueSources = new Set(sigs.map(s => s.dataSource || s.source || 'unknown'));
      const uniqueEventTypes = new Set(sigs.map(s => s.eventType || 'unknown'));
      const isIndependent = uniqueSources.size >= 2 || uniqueEventTypes.size >= 2;
      const effectiveCount = isIndependent ? count : 1;
      const stackLevel: CompanyTrend['stackLevel'] = effectiveCount >= 4 ? 'STRONG' : effectiveCount >= 2 ? 'BUILDING' : 'WEAK';

      // Set stack info on each signal + apply stacking bonus (0–20 points) only if independent
      for (const s of sigs) {
        s.signalStackCount = effectiveCount;
        s.signalStackLevel = stackLevel;

        const stackBonus = (isIndependent && effectiveCount >= 2) ? Math.min(20, 5 * effectiveCount) : 0;
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

    // ── Store in precomputed Redis (for fast reads on subsequent requests) ──
    if (filtered.length > 0) {
      try {
        await kvSet('intelligence:signals', response, 3600);
        // Event versioning: hash signals to detect data changes for cache invalidation
        const signalHash = filtered.slice(0, 10).map((s: any) => `${s.symbol}:${s.valueCr}:${s.score}`).join('|');
        const version = Array.from(signalHash).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
        await kvSet('intelligence:meta', {
          computedAt: new Date().toISOString(),
          signalCount: filtered.length,
          version,
          signalHash: signalHash.slice(0, 200),
          ttl: 3600,
        }, 3600);
        console.log(`[Intelligence] Stored ${filtered.length} signals to Redis`);
      } catch (e) {
        console.error('[Intelligence] Failed to store to Redis:', e);
      }
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
