// ═══════════════════════════════════════════════════════════════════════════
// ORDER BOOK INTELLIGENCE ENGINE (PATCH 0766)
//
// Production-grade order-detection pipeline per user blueprint. Replaces the
// v1 heuristic "search announcements for 'receipt of order'" with:
//
//   1. PRIMARY STRUCTURED — NSE corp announcements filtered by XBRL category
//      = 'awarding/bagging/receiving of orders/contracts' (NEAPS circular)
//   2. PRIMARY STRUCTURED — BSE corp announcements with subCategory
//      = 'Receipt of Orders' (BSE Company Update workflow)
//   3. HEURISTIC FALLBACK — text-pattern classifier over any exchange
//      announcement when template/category is absent
//   4. NEWS BACKUP — stricter pattern + entity resolution required
//
// Why v1 returned 0 rows:
//   - It scanned GENERIC corp announcements (investor meets, transcripts,
//     credit ratings — anything Reg-30) and tried to regex out 'order' tokens.
//   - The actual order/contract filings live under specific XBRL categories
//     (NEAPS) and BSE subcategories that v1 wasn't filtering on.
//   - Net result: feed mostly returned investor-meet rows → zero matches.
//
// Output shape mirrors RatingActions engine: source-health diagnostics so
// the user sees WHY the panel is empty (feed/filter issue vs market quiet).
// ═══════════════════════════════════════════════════════════════════════════

export type CustomerTier = 'tier1_psu' | 'other';

export type OrderValueBucket =
  | 'GE_500_CR'
  | 'BETWEEN_100_500_CR'
  | 'LT_100_CR'
  | 'UNKNOWN';

export type OrderSourceType = 'nse' | 'bse' | 'news';

export interface OrderRow {
  id: string;
  company: string;
  symbol?: string;
  isin?: string;
  customerName?: string;
  customerTier: CustomerTier;
  description: string;
  orderValueRaw?: string;
  orderValueNumeric?: number;   // in INR crores
  valueBucket: OrderValueBucket;
  currency?: 'INR' | 'USD' | 'OTHER';
  region?: 'IN' | 'US' | 'OTHER';
  announcementTime?: string;
  effectiveDate?: string;
  sourceType: OrderSourceType;
  sourceUrl: string;
  contractType?: string;        // EPC, supply, O&M, turnkey, framework etc.
  isFrameworkAgreement: boolean;
  confidence: number;
  verifyRequired: boolean;
}

export interface OrderBookWidgetState {
  asOf: string;
  sourceHealth: {
    nse: 'ok' | 'empty' | 'failed';
    bse: 'ok' | 'empty' | 'failed';
    news: 'ok' | 'empty' | 'failed';
  };
  totals: {
    orders: number;
    tier1Psu: number;
    nonPsu: number;
    byBucket: Record<OrderValueBucket, number>;
  };
  rows: OrderRow[];
}

// ─── Tier-1 PSU customer set ───────────────────────────────────────────

const TIER1_PSU_NAMES = [
  'hindustan aeronautics',  // HAL
  'bharat heavy electricals', // BHEL
  'ntpc',
  'power grid corporation', 'pgcil',
  'bharat electronics', // BEL
  'defence research and development', 'drdo',
  'indian space research', 'isro',
  'reserve bank of india', 'rbi',
  'national bank for agriculture', 'nabard',
  'life insurance corporation', 'lic',
  'oil and natural gas', 'ongc',
  'indian oil corporation', 'iocl',
  'gail',
  'national highways authority', 'nhai',
  'ministry of defence', 'mod',
  'indian railways',
  'indian navy', 'indian air force', 'indian army',
  // Additional high-signal PSUs
  'mazagon dock', 'mdl',
  'cochin shipyard',
  'bharat earth movers', 'beml',
  'sail', 'steel authority',
  'coal india', 'cil',
  'rec', 'pfc',
  'hpcl', 'hindustan petroleum',
  'bpcl', 'bharat petroleum',
];

export function getCustomerTier(customerName?: string): CustomerTier {
  if (!customerName) return 'other';
  const normalized = customerName.toLowerCase();
  if (TIER1_PSU_NAMES.some(psu => normalized.includes(psu))) {
    return 'tier1_psu';
  }
  return 'other';
}

// ─── Category-based detection (PRIMARY) ────────────────────────────────

export interface NseAnnouncementRaw {
  companyName?: string;
  symbol?: string;
  isin?: string;
  headline?: string;
  category?: string;
  subCategory?: string;
  description?: string;
  attachmentUrl?: string;
  announcementTime?: string;
}

export interface BseAnnouncementRaw {
  companyName?: string;
  scripCode?: string;
  headline?: string;
  category?: string;
  subCategory?: string;
  description?: string;
  pdfUrl?: string;
  time?: string;
}

export function isOrderTemplateNse(raw: NseAnnouncementRaw): boolean {
  const cat = (raw.category || '').toLowerCase();
  const sub = (raw.subCategory || '').toLowerCase();
  // NEAPS XBRL template phrases per the SEBI circular
  if (cat.includes('order') || cat.includes('contract')) return true;
  if (sub.includes('order') || sub.includes('contract')) return true;
  if (cat.includes('awarding') || sub.includes('awarding')) return true;
  if (cat.includes('bagging') || sub.includes('bagging')) return true;
  return false;
}

export function isOrderCategoryBse(raw: BseAnnouncementRaw): boolean {
  const cat = (raw.category || '').toLowerCase();
  const sub = (raw.subCategory || '').toLowerCase();
  if (sub.includes('receipt of order')) return true;
  if (cat.includes('company update') && sub.includes('order')) return true;
  if (sub.includes('award') || sub.includes('contract')) return true;
  return false;
}

// ─── Text-pattern classifier (FALLBACK) ────────────────────────────────

export function isOrderLikeText(text?: string): boolean {
  const s = (text || '').toLowerCase();
  const positive = [
    'bagged an order', 'bagged orders', 'received an order', 'received orders',
    'receipt of order', 'letter of award', ' loa ', '\nloa\n',
    'work order', 'contract awarded', 'awarded a contract', 'awarded the contract',
    'order from', 'purchase order', 'supply order', 'won a contract',
    'order/contract', 'order win', 'won an order',
  ];
  const negativeNoise = [
    'investor presentation', 'earnings conference call', 'transcript of',
    'intimation regarding board meeting', 'press release of results',
    'closure of trading window', 'voting results',
  ];
  if (!positive.some(p => s.includes(p))) return false;
  if (negativeNoise.some(n => s.includes(n))) return false;
  return true;
}

// ─── Order value extraction + bucketing ────────────────────────────────

const INR_PATTERN = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|million|mn|billion|bn|lakh|lakhs)?/i;
const USD_PATTERN = /(?:\$|usd)\s*([\d,]+(?:\.\d+)?)\s*(million|mn|billion|bn|crore|cr)?/i;

export interface ValueExtractionResult {
  amountInCr?: number;
  currency?: 'INR' | 'USD' | 'OTHER';
  rawMatch?: string;
}

export function extractOrderValue(text?: string): ValueExtractionResult {
  const s = text || '';
  const mInr = s.match(INR_PATTERN);
  if (mInr) {
    const num = parseFloat(mInr[1].replace(/,/g, ''));
    const unit = (mInr[2] || '').toLowerCase();
    let amountInCr = num;
    if (unit === 'million' || unit === 'mn') amountInCr = num / 10;
    else if (unit === 'billion' || unit === 'bn') amountInCr = num * 100;
    else if (unit === 'lakh' || unit === 'lakhs') amountInCr = num / 100;
    if (Number.isFinite(amountInCr)) {
      return { amountInCr, currency: 'INR', rawMatch: mInr[0] };
    }
  }
  const mUsd = s.match(USD_PATTERN);
  if (mUsd) {
    const num = parseFloat(mUsd[1].replace(/,/g, ''));
    const unit = (mUsd[2] || '').toLowerCase();
    let amountInUsd = num;
    if (unit === 'million' || unit === 'mn') amountInUsd = num / 10; // USD m → ~₹crore at 1:10 rough
    if (unit === 'billion' || unit === 'bn') amountInUsd = num * 100;
    // Apply USD/INR FX conversion (default 85)
    const amountInCr = amountInUsd * 8.5;
    return { amountInCr, currency: 'USD', rawMatch: mUsd[0] };
  }
  return {};
}

export function bucketOrderValue(amountInCr?: number): OrderValueBucket {
  if (amountInCr == null || !Number.isFinite(amountInCr)) return 'UNKNOWN';
  if (amountInCr >= 500) return 'GE_500_CR';
  if (amountInCr >= 100) return 'BETWEEN_100_500_CR';
  if (amountInCr > 0)   return 'LT_100_CR';
  return 'UNKNOWN';
}

// ─── Customer extraction ───────────────────────────────────────────────

export function extractCustomerName(text?: string): string | undefined {
  const s = text || '';
  // Common patterns: "from <Customer>", "by <Customer>", "awarded by <Customer>"
  const patterns: RegExp[] = [
    /\b(?:order|contract|loa|work order)\s+from\s+(.+?)(?:\s+for\s+|\s+worth\s+|\s+of\s+|\s+to\s+supply|,|\.)/i,
    /\bawarded\s+by\s+(.+?)(?:\s+for\s+|\s+worth\s+|\s+to\s+|,|\.)/i,
    /\bcustomer[:\s]+(.+?)(?:\s+for\s+|\s+worth\s+|,|\.)/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) {
      const candidate = m[1].trim().replace(/\s+/g, ' ').slice(0, 80);
      if (candidate.length >= 3) return candidate;
    }
  }
  return undefined;
}

// ─── Contract-type extraction ──────────────────────────────────────────

const CONTRACT_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\bEPC\b/i, 'EPC'],
  [/\bturnkey\b/i, 'turnkey'],
  [/operation\s+and\s+maintenance|\bO&M\b/i, 'O&M'],
  [/supply\s+contract|supply\s+order/i, 'supply'],
  [/framework\s+agreement|rate\s+contract/i, 'framework'],
  [/maintenance\s+contract/i, 'maintenance'],
  [/civil\s+works|civil\s+contract/i, 'civil'],
];

export function extractContractType(text?: string): string | undefined {
  const s = text || '';
  for (const [re, label] of CONTRACT_TYPE_PATTERNS) {
    if (re.test(s)) return label;
  }
  return undefined;
}

// ─── NSE raw → OrderRow ────────────────────────────────────────────────

export function mapNseOrderRow(raw: NseAnnouncementRaw): OrderRow | null {
  const headline = raw.headline || '';
  const description = raw.description || '';
  const isTemplate = isOrderTemplateNse(raw);
  const isHeuristic = isOrderLikeText(headline + ' ' + description);
  if (!isTemplate && !isHeuristic) return null;

  const textForValue = `${headline} ${description}`;
  const value = extractOrderValue(textForValue);
  const valueBucket = bucketOrderValue(value.amountInCr);
  const customerName = extractCustomerName(textForValue);
  const customerTier = getCustomerTier(customerName);
  const contractType = extractContractType(textForValue);
  const isFramework = /framework\s+agreement|rate\s+contract/i.test(textForValue);

  const confidence =
    isTemplate ? 0.95 :
    isHeuristic && value.amountInCr ? 0.85 :
    isHeuristic ? 0.75 : 0.5;

  return {
    id: ['nse', raw.symbol || raw.companyName || 'unknown', raw.announcementTime || '', value.rawMatch || ''].join('::'),
    company: raw.companyName || raw.symbol || 'Unknown',
    symbol: raw.symbol,
    isin: raw.isin,
    customerName,
    customerTier,
    description: headline || description || '',
    orderValueRaw: value.rawMatch,
    orderValueNumeric: value.amountInCr,
    valueBucket,
    currency: value.currency,
    region: 'IN',
    announcementTime: raw.announcementTime,
    effectiveDate: raw.announcementTime,
    sourceType: 'nse',
    sourceUrl: raw.attachmentUrl || '',
    contractType,
    isFrameworkAgreement: isFramework,
    confidence,
    verifyRequired: confidence < 0.9 || valueBucket === 'UNKNOWN',
  };
}

// ─── BSE raw → OrderRow ────────────────────────────────────────────────

export function mapBseOrderRow(raw: BseAnnouncementRaw): OrderRow | null {
  const headline = raw.headline || '';
  const description = raw.description || '';
  const isTemplate = isOrderCategoryBse(raw);
  const isHeuristic = isOrderLikeText(headline + ' ' + description);
  if (!isTemplate && !isHeuristic) return null;

  const textForValue = `${headline} ${description}`;
  const value = extractOrderValue(textForValue);
  const valueBucket = bucketOrderValue(value.amountInCr);
  const customerName = extractCustomerName(textForValue);
  const customerTier = getCustomerTier(customerName);
  const contractType = extractContractType(textForValue);
  const isFramework = /framework\s+agreement|rate\s+contract/i.test(textForValue);

  const confidence =
    isTemplate ? 0.95 :
    isHeuristic && value.amountInCr ? 0.85 :
    isHeuristic ? 0.75 : 0.5;

  return {
    id: ['bse', raw.scripCode || raw.companyName || 'unknown', raw.time || '', value.rawMatch || ''].join('::'),
    company: raw.companyName || 'Unknown',
    symbol: undefined,
    isin: undefined,
    customerName,
    customerTier,
    description: headline || description || '',
    orderValueRaw: value.rawMatch,
    orderValueNumeric: value.amountInCr,
    valueBucket,
    currency: value.currency,
    region: 'IN',
    announcementTime: raw.time,
    effectiveDate: raw.time,
    sourceType: 'bse',
    sourceUrl: raw.pdfUrl || '',
    contractType,
    isFrameworkAgreement: isFramework,
    confidence,
    verifyRequired: confidence < 0.9 || valueBucket === 'UNKNOWN',
  };
}

// ─── News raw → OrderRow ───────────────────────────────────────────────

export interface NewsRaw {
  sourceName?: string;
  publishedAt?: string;
  headline?: string;
  summary?: string;
  ticker?: string;
  company?: string;
  url: string;
}

export function mapNewsOrderRow(raw: NewsRaw): OrderRow | null {
  const headline = raw.headline || '';
  const summary = raw.summary || '';
  const text = `${headline} ${summary}`;
  if (!isOrderLikeText(text)) return null;
  const value = extractOrderValue(text);
  const valueBucket = bucketOrderValue(value.amountInCr);
  const customerName = extractCustomerName(text);
  const customerTier = getCustomerTier(customerName);
  const contractType = extractContractType(text);
  const isFramework = /framework\s+agreement|rate\s+contract/i.test(text);
  const confidence = value.amountInCr ? 0.8 : 0.65;

  return {
    id: ['news', raw.url].join('::'),
    company: raw.company || raw.ticker || 'Unknown',
    symbol: raw.ticker,
    isin: undefined,
    customerName,
    customerTier,
    description: headline || summary || '',
    orderValueRaw: value.rawMatch,
    orderValueNumeric: value.amountInCr,
    valueBucket,
    currency: value.currency,
    region: undefined,
    announcementTime: raw.publishedAt,
    effectiveDate: raw.publishedAt,
    sourceType: 'news',
    sourceUrl: raw.url,
    contractType,
    isFrameworkAgreement: isFramework,
    confidence,
    verifyRequired: true,
  };
}

// ─── Dedup + high-signal filter ────────────────────────────────────────

export function dedupeOrders(rows: OrderRow[]): OrderRow[] {
  const best = new Map<string, OrderRow>();
  for (const row of rows) {
    const key = [
      (row.company || '').toLowerCase(),
      (row.customerName || '').toLowerCase(),
      row.orderValueNumeric ?? '',
      (row.announcementTime || '').slice(0, 10),
    ].join('|');
    const prev = best.get(key);
    if (!prev || row.confidence > prev.confidence) {
      best.set(key, row);
    }
  }
  return [...best.values()].sort((a, b) => {
    const ta = new Date(a.announcementTime || 0).getTime();
    const tb = new Date(b.announcementTime || 0).getTime();
    return tb - ta;
  });
}

export function isHighSignalOrder(row: OrderRow): boolean {
  // Show Tier-1 PSU orders + any quantified ≥₹100 Cr deals
  if (row.customerTier === 'tier1_psu') return true;
  if (row.valueBucket === 'GE_500_CR' || row.valueBucket === 'BETWEEN_100_500_CR') return true;
  return false;
}

// ─── Assemble state ────────────────────────────────────────────────────

export function assembleOrderBookState(opts: {
  nseRaw?: NseAnnouncementRaw[] | null;
  bseRaw?: BseAnnouncementRaw[] | null;
  newsRaw?: NewsRaw[] | null;
}): OrderBookWidgetState {
  const all: OrderRow[] = [];
  const sourceHealth: OrderBookWidgetState['sourceHealth'] = {
    nse: 'failed', bse: 'failed', news: 'failed',
  };

  if (opts.nseRaw !== undefined && opts.nseRaw !== null) {
    const mapped = opts.nseRaw.map(mapNseOrderRow).filter((r): r is OrderRow => !!r);
    sourceHealth.nse = mapped.length > 0 ? 'ok' : 'empty';
    all.push(...mapped);
  }
  if (opts.bseRaw !== undefined && opts.bseRaw !== null) {
    const mapped = opts.bseRaw.map(mapBseOrderRow).filter((r): r is OrderRow => !!r);
    sourceHealth.bse = mapped.length > 0 ? 'ok' : 'empty';
    all.push(...mapped);
  }
  if (opts.newsRaw !== undefined && opts.newsRaw !== null) {
    const mapped = opts.newsRaw.map(mapNewsOrderRow).filter((r): r is OrderRow => !!r);
    sourceHealth.news = mapped.length > 0 ? 'ok' : 'empty';
    all.push(...mapped);
  }

  const deduped = dedupeOrders(all);
  const visible = deduped.filter(isHighSignalOrder);

  const byBucket: Record<OrderValueBucket, number> = {
    GE_500_CR: 0, BETWEEN_100_500_CR: 0, LT_100_CR: 0, UNKNOWN: 0,
  };
  for (const r of visible) byBucket[r.valueBucket] += 1;

  return {
    asOf: new Date().toISOString(),
    sourceHealth,
    totals: {
      orders: visible.length,
      tier1Psu: visible.filter(r => r.customerTier === 'tier1_psu').length,
      nonPsu: visible.filter(r => r.customerTier === 'other').length,
      byBucket,
    },
    rows: visible,
  };
}
