// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS OPPORTUNITIES PRO — grading engine (patch 0131)
//
// V2: MB-driven (not news-regex driven).  Replicates the analytical depth
// of earningspulse.ai/opportunities/earnings using the cockpit's existing
// data backbone:
//   PRIMARY: Multibagger upload (mb_excel_scored_v2) — has full Q4
//            financials: yoySalesGrowth, yoyProfitGrowth, epsGrowth,
//            opm, opmExpansion, accelSignal, pe, peg, marketCap, sector
//            + optional absolute Cr pairs (Sales, Sales preceding year,
//            Net profit, etc.) if user included those Screener columns.
//   ENRICHMENT: news feed (article_type=EARNINGS) for narrative flavor +
//               filing URL when a matching article exists.
//
// Output: ParsedEarning per MB row, graded into 4 tiers.
// No trade plan logic (per user instruction).
// ═══════════════════════════════════════════════════════════════════════════

export type EarningsTier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

export interface NewsArticleLite {
  id?: string;
  title: string;
  summary?: string;
  description?: string;
  article_type?: string;
  primary_ticker?: string | null;
  ticker_symbols?: string[];
  tickers?: Array<string | { ticker?: string }>;
  published_at?: string;
  source_name?: string;
  source?: string;
  source_url?: string;
  url?: string;
}

// MBLite — extended to capture absolute Cr pairs + result date if present.
// Reads BOTH normalized fields (yoySalesGrowth etc.) AND raw column names
// (Screener.in headers like 'Sales latest quarter') for robust extraction.
export interface MBLite {
  // Identity
  symbol: string;
  company?: string;
  sector?: string;

  // Margins
  opm?: number;
  opmPrev?: number;
  opmExpansion?: number;
  roce?: number;

  // Growth (YoY, percentages)
  revCagr?: number;
  profitCagr?: number;
  epsGrowth?: number;
  yoySalesGrowth?: number;
  yoyProfitGrowth?: number;
  revenueAcceleration?: number;
  profitAcceleration?: number;
  accelSignal?: 'ACCELERATING' | 'STABLE' | 'DECELERATING';

  // Valuation / size
  pe?: number;
  peg?: number;
  price?: number;
  marketCapCr?: number;

  // Ownership
  promoter?: number;
  fii?: number;
  dii?: number;
  fiiPlusDii?: number;

  // Quality
  fcfAbsolute?: number;
  cfoToPat?: number;
  de?: number;

  // Scoring (if pre-scored by MB engine)
  score?: number;
  grade?: string;

  // Absolute Cr pairs (optional — present if Screener columns included)
  salesCurrCr?: number;
  salesPrevCr?: number;
  patCurrCr?: number;
  patPrevCr?: number;
  epsCurr?: number;
  epsPrev?: number;

  // Result metadata
  resultDate?: string;        // YYYY-MM-DD if Screener "Last Result Date" present
  latestQuarter?: string;     // 'Q4FY26' or similar

  // Raw row — fallback for absolute-Cr extraction
  _raw?: Record<string, any>;
}

export interface ParsedEarning {
  ticker: string;
  company: string;
  sector?: string;
  filing_date?: string;
  quarter?: string;
  market_cap_bucket?: 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'MICRO' | 'UNKNOWN';
  pe?: number | null;
  price?: number | null;

  // Reported metrics
  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  sales_curr_cr: number | null;
  sales_prev_cr: number | null;
  pat_curr_cr: number | null;
  pat_prev_cr: number | null;
  eps_curr: number | null;
  eps_prev: number | null;

  // Price reaction
  gap_pct: number | null;
  d1_pct: number | null;

  // Scoring
  composite_score: number;
  tier: EarningsTier;
  methodology_tags: MethodologyTag[];
  caveat_tags: CaveatTag[];

  // Narrative
  narrative: string;

  // Provenance
  filing_url?: string;
  source_article_id?: string;
}

export type MethodologyTag =
  | 'trend template'
  | 'sepa'
  | 'canslim'
  | 'bonde ep';

export type CaveatTag =
  | 'ocf divergence'
  | 'optical eps'
  | 'tax distortion'
  | 'low quality'
  | 'segment mix shift'
  | 'accelerated depreciation'
  | 'exceptional item'
  | 'forex loss'
  | 'forex gain'
  | 'one time order';

const TIER_THRESHOLDS = {
  BLOCKBUSTER: 85,
  STRONG: 70,
  MIXED: 50,
} as const;

// ─── Raw-row absolute-Cr extractor ─────────────────────────────────────────
// Screener.in users often add columns like 'Sales', 'Sales preceding year',
// 'Net profit', 'Net profit preceding year', 'EPS', 'EPS preceding year'.
// These map to absolute Cr pairs.  Try every common variant.
function extractAbsolutes(row: Record<string, any>): {
  sales: { curr: number | null; prev: number | null };
  pat:   { curr: number | null; prev: number | null };
  eps:   { curr: number | null; prev: number | null };
  result_date: string | null;
} {
  const num = (v: any): number | null => {
    if (v == null || v === '') return null;
    const s = String(v).replace(/[,\s₹$]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  // Try multiple key variants
  const pick = (...keys: string[]): any => {
    for (const k of keys) {
      if (row[k] != null && row[k] !== '') return row[k];
    }
    return undefined;
  };
  const sales_curr = num(pick('Sales', 'Sales latest quarter', 'Revenue', 'Total revenue'));
  const sales_prev = num(pick('Sales preceding year', 'Sales preceding year quarter', 'Revenue preceding year', 'Revenue preceding year quarter'));
  const pat_curr   = num(pick('Net profit', 'Net Profit', 'PAT', 'Net profit latest quarter', 'PAT latest quarter'));
  const pat_prev   = num(pick('Net profit preceding year', 'Net Profit preceding year', 'Net profit preceding year quarter', 'PAT preceding year'));
  const eps_curr   = num(pick('EPS', 'EPS latest quarter', 'EPS in Rs'));
  const eps_prev   = num(pick('EPS preceding year', 'EPS preceding year quarter'));
  const rd = pick('Last Result Date', 'Result Date', 'Latest Result Date', 'Filing Date');
  let result_date: string | null = null;
  if (rd) {
    try {
      const d = new Date(String(rd));
      if (!isNaN(d.getTime())) result_date = d.toISOString().slice(0, 10);
    } catch {}
  }
  return {
    sales: { curr: sales_curr, prev: sales_prev },
    pat:   { curr: pat_curr,   prev: pat_prev },
    eps:   { curr: eps_curr,   prev: eps_prev },
    result_date,
  };
}

// ─── Market-cap bucket ────────────────────────────────────────────────────
function inferMarketCapBucket(mb?: MBLite): ParsedEarning['market_cap_bucket'] {
  const mc = mb?.marketCapCr;
  if (mc == null) return 'UNKNOWN';
  if (mc >= 200_000) return 'MEGA';
  if (mc >=  20_000) return 'LARGE';
  if (mc >=   5_000) return 'MID';
  if (mc >=     500) return 'SMALL';
  return 'MICRO';
}

// ─── Methodology tag inference ──────────────────────────────────────────────
function inferMethodologyTags(p: Partial<ParsedEarning>, mb?: MBLite): MethodologyTag[] {
  const tags = new Set<MethodologyTag>();
  const epsY = p.eps_yoy_pct ?? mb?.epsGrowth ?? null;
  const salesY = p.sales_yoy_pct ?? mb?.yoySalesGrowth ?? null;
  const patY = p.net_profit_yoy_pct ?? mb?.yoyProfitGrowth ?? null;

  // bonde ep — operating leverage + EPS magnitude.  Most permissive.
  // EPS ≥ 20% YoY AND (sales ≥ 5% OR sales N/A) AND CFO/PAT not red
  if (epsY != null && epsY >= 20 && (salesY == null || salesY >= 5)) {
    if (mb?.cfoToPat == null || mb.cfoToPat >= 0.5) tags.add('bonde ep');
  }

  // trend template — Minervini Stage 2 proxies.  We don't have live RS / DMA
  // here so fire when:
  //   - accelSignal === ACCELERATING (proxy for upward chart)
  //   - AND eps ≥ 25% (earnings leadership)
  //   - AND revCagr ≥ 15% (longer-run leadership)
  if (mb?.accelSignal === 'ACCELERATING' && epsY != null && epsY >= 25 && (mb.revCagr ?? 0) >= 15) {
    tags.add('trend template');
  }

  // sepa — SEPA strict.  Required: trend template + EPS ≥ 30% AND sales ≥ 15%
  if (mb?.accelSignal === 'ACCELERATING' && epsY != null && epsY >= 30 && salesY != null && salesY >= 15) {
    tags.add('sepa');
    tags.add('trend template'); // SEPA implies trend
  }

  // canslim — O'Neil checklist:
  //   C: current quarterly EPS ≥ 25%
  //   A: annual EPS growth ≥ 25% (proxy: profitCagr or epsGrowth)
  //   N: new — accelerating signal
  //   L: leader — sector / size leader (proxy: not MICRO)
  //   I: institutional — fiiPlusDii > 5
  //   M: market direction — assumed neutral
  if (epsY != null && epsY >= 25 && (mb?.profitCagr ?? mb?.epsGrowth ?? 0) >= 25 &&
      mb?.accelSignal !== 'DECELERATING' && (mb?.fiiPlusDii ?? 0) >= 5) {
    tags.add('canslim');
  }

  return Array.from(tags);
}

// ─── Caveat tag inference ───────────────────────────────────────────────────
function inferCaveatTags(mb?: MBLite, p?: Partial<ParsedEarning>, articleText?: string): CaveatTag[] {
  const tags = new Set<CaveatTag>();
  const text = (articleText || '').toLowerCase();

  // OCF divergence — CFO/PAT < 0.8
  if (mb?.cfoToPat != null && mb.cfoToPat < 0.8) tags.add('ocf divergence');

  // Optical EPS — EPS YoY > 3x sales YoY OR > 100% AND prior near zero (base effect)
  const epsY = p?.eps_yoy_pct ?? mb?.epsGrowth ?? null;
  const salesY = p?.sales_yoy_pct ?? mb?.yoySalesGrowth ?? null;
  if (epsY != null && salesY != null && salesY > 0 && epsY >= salesY * 3 && epsY >= 50) {
    tags.add('optical eps');
  }
  if (epsY != null && epsY >= 200) tags.add('optical eps');  // 200%+ usually base effect
  if (p?.eps_prev != null && p.eps_curr != null && Math.abs(p.eps_prev) < 1 && p.eps_curr > 5) {
    tags.add('optical eps');
  }

  // Tax distortion — explicit text mention
  if (/\b(tax\s+(?:refund|credit|reversal|write[- ]back)|effective tax rate fell|deferred tax|itat\s+order)\b/i.test(text)) {
    tags.add('tax distortion');
  }
  // Segment mix shift
  if (/\b(segment\s+(?:mix|shift|reclassification)|business mix changed|consolidation of)\b/i.test(text)) {
    tags.add('segment mix shift');
  }
  // Accelerated depreciation
  if (/\b(accelerated depreciation|one[- ]time depreciation|write[- ]?down|impairment charge)\b/i.test(text)) {
    tags.add('accelerated depreciation');
  }
  // Exceptional item
  if (/\b(exceptional item|one[- ]time gain|one[- ]time loss|extraordinary item|impairment|robotics divestment|labour code)\b/i.test(text)) {
    tags.add('exceptional item');
  }
  // Forex
  if (/\bforex\s+loss\b|\bfx\s+loss\b|\bcurrency\s+(?:headwind|hit|loss)\b/i.test(text)) tags.add('forex loss');
  if (/\bforex\s+gain\b|\bfx\s+gain\b|\bcurrency\s+tailwind\b/i.test(text)) tags.add('forex gain');
  // One-time order
  if (/\bone[- ]time\s+order\b|\bsingle\s+order\b|\blarge\s+one[- ]off\s+order\b|\bdamas\b/i.test(text)) tags.add('one time order');

  // Net-profit YoY > 100% but sales YoY < 25% → optical
  const patY = p?.net_profit_yoy_pct ?? mb?.yoyProfitGrowth ?? null;
  if (patY != null && salesY != null && patY >= 100 && salesY < 25) tags.add('optical eps');

  // Multiple quality flags → low quality
  if (tags.size >= 3) tags.add('low quality');

  return Array.from(tags);
}

// ─── Quarter inference ──────────────────────────────────────────────────────
function inferQuarter(mb?: MBLite, article?: NewsArticleLite): string | undefined {
  if (mb?.latestQuarter) return mb.latestQuarter.toUpperCase();
  const text = `${article?.title || ''} ${article?.summary || ''}`;
  const m = /\b(Q[1-4])\s*(?:FY)?(?:20)?(\d{2})?\b/i.exec(text);
  return m ? m[1].toUpperCase() : 'Q4';  // default to Q4 — most recent
}

// ─── Scoring engine ────────────────────────────────────────────────────────
function computeScore(p: Partial<ParsedEarning>, mb: MBLite | undefined, methodologyCount: number, caveatCount: number): number {
  // Growth pillar (30%)
  const salesY = p.sales_yoy_pct ?? mb?.yoySalesGrowth ?? null;
  const patY   = p.net_profit_yoy_pct ?? mb?.yoyProfitGrowth ?? null;
  const epsY   = p.eps_yoy_pct ?? mb?.epsGrowth ?? null;
  const growthInputs = [salesY, patY, epsY].filter((v): v is number => v != null);
  let growth = 40;
  if (growthInputs.length > 0) {
    const score = (s: number) =>
      s >= 200 ? 100 : s >= 100 ? 95 : s >= 50 ? 88 : s >= 25 ? 75 : s >= 10 ? 60 : s >= 0 ? 45 : s >= -10 ? 32 : s >= -25 ? 20 : 8;
    let totalW = 0, weighted = 0;
    if (salesY != null) { weighted += score(salesY) * 0.20; totalW += 0.20; }
    if (patY   != null) { weighted += score(patY)   * 0.30; totalW += 0.30; }
    if (epsY   != null) { weighted += score(epsY)   * 0.50; totalW += 0.50; }
    growth = totalW > 0 ? weighted / totalW : 50;
  }

  // Earnings quality pillar (30%) — CFO/PAT + OPM expansion + promoter alignment
  let earnings_quality = 60;
  if (mb) {
    let s = 50;
    if (mb.cfoToPat != null) s += mb.cfoToPat >= 1.0 ? 25 : mb.cfoToPat >= 0.8 ? 15 : mb.cfoToPat >= 0.5 ? 0 : -18;
    if (mb.opmExpansion != null) s += mb.opmExpansion >= 3 ? 18 : mb.opmExpansion >= 1 ? 10 : mb.opmExpansion >= -1 ? 0 : -12;
    if (mb.promoter != null && mb.promoter >= 45) s += 5;
    earnings_quality = Math.max(0, Math.min(100, s));
  }

  // Acceleration pillar (25%)
  let acceleration = 50;
  if (mb) {
    if (mb.accelSignal === 'ACCELERATING') acceleration = 85;
    else if (mb.accelSignal === 'STABLE') acceleration = 55;
    else if (mb.accelSignal === 'DECELERATING') acceleration = 25;
    if (mb.profitAcceleration != null) {
      if      (mb.profitAcceleration >= 20) acceleration = Math.max(acceleration, 90);
      else if (mb.profitAcceleration >= 10) acceleration = Math.max(acceleration, 75);
      else if (mb.profitAcceleration <= -20) acceleration = Math.min(acceleration, 25);
    }
  }

  // Technical pillar (15%) — methodology tag count
  const technical = 50 + methodologyCount * 13;

  const composite = growth * 0.30 + earnings_quality * 0.30 + acceleration * 0.25 + technical * 0.15;
  const penalized = composite - caveatCount * 3.5;
  return Math.max(0, Math.min(100, penalized));
}

function assignTier(composite: number, caveatCount: number): EarningsTier {
  // Caveat-aware cap: 3+ caveats can never be BLOCKBUSTER
  if (caveatCount >= 3 && composite >= TIER_THRESHOLDS.BLOCKBUSTER) return 'STRONG';
  if      (composite >= TIER_THRESHOLDS.BLOCKBUSTER) return 'BLOCKBUSTER';
  else if (composite >= TIER_THRESHOLDS.STRONG)     return 'STRONG';
  else if (composite >= TIER_THRESHOLDS.MIXED)      return 'MIXED';
  else                                              return 'AVOID';
}

// ─── Narrative builder ─────────────────────────────────────────────────────
function fmtGrowth(label: string, pct: number | null | undefined): string {
  if (pct == null) return '';
  return `${label} ${pct >= 0 ? '+' : ''}${Math.round(pct)}% YoY`;
}

function buildNarrative(p: ParsedEarning, mb?: MBLite, articleSummary?: string): string {
  const parts: string[] = [];
  const ticker = p.company || p.ticker;
  const q = p.quarter || 'Q4';

  if (p.tier === 'BLOCKBUSTER') {
    parts.push(`${ticker} prints a blockbuster ${q} (${[
      fmtGrowth('revenue', p.sales_yoy_pct),
      fmtGrowth('PAT', p.net_profit_yoy_pct),
      fmtGrowth('EPS', p.eps_yoy_pct),
    ].filter(Boolean).join(', ')})`);
    if (p.methodology_tags.length >= 2) parts.push(`with ${p.methodology_tags.join('/')} all passing`);
    if (mb?.opmExpansion != null && mb.opmExpansion >= 2) parts.push(`and OPM expanding ${mb.opmExpansion.toFixed(1)}pp`);
    parts.push('.');
  } else if (p.tier === 'STRONG') {
    parts.push(`${ticker} delivers strong ${q} (${[fmtGrowth('revenue', p.sales_yoy_pct), fmtGrowth('EPS', p.eps_yoy_pct)].filter(Boolean).join(', ')})`);
    if (p.caveat_tags.length > 0) parts.push(`but ${p.caveat_tags.slice(0, 2).join(' + ')} keep it below BLOCKBUSTER`);
    parts.push('.');
  } else if (p.tier === 'MIXED') {
    const positiveBit = fmtGrowth('EPS', p.eps_yoy_pct) || fmtGrowth('PAT', p.net_profit_yoy_pct) || 'mixed print';
    parts.push(`${ticker} ${q} shows ${positiveBit}`);
    if (p.caveat_tags.length > 0) parts.push(`but ${p.caveat_tags.slice(0, 2).join(' + ')} cloud the read`);
    if (mb?.accelSignal === 'DECELERATING') parts.push(`with the accel signal turning DECELERATING`);
    parts.push('.');
  } else {
    parts.push(`${ticker} ${q} fails the bar`);
    const epsY = p.eps_yoy_pct;
    if (epsY != null && epsY < 0) parts.push(` — EPS ${Math.round(epsY)}% YoY`);
    else if (p.sales_yoy_pct != null && p.sales_yoy_pct < 10) parts.push(` — revenue growth only ${Math.round(p.sales_yoy_pct)}%`);
    if (p.caveat_tags.length >= 2) parts.push(` with ${p.caveat_tags.slice(0, 3).join(' + ')}`);
    parts.push('.');
  }

  if (articleSummary && articleSummary.length > 40) {
    const flavour = articleSummary.split(/[.!?]/)[0].trim();
    if (flavour && flavour.length < 220 && flavour.length > 20) parts.push(` ${flavour}.`);
  }
  return parts.join(' ').replace(/\s+\./g, '.').replace(/\s+/g, ' ').trim();
}

// ─── Main entry: grade from MB row ─────────────────────────────────────────
export function gradeFromMB(mb: MBLite, article?: NewsArticleLite): ParsedEarning | null {
  if (!mb.symbol) return null;

  // Pull absolute Cr pairs from explicit fields OR raw row
  let absSalesCurr = mb.salesCurrCr ?? null;
  let absSalesPrev = mb.salesPrevCr ?? null;
  let absPatCurr   = mb.patCurrCr ?? null;
  let absPatPrev   = mb.patPrevCr ?? null;
  let absEpsCurr   = mb.epsCurr ?? null;
  let absEpsPrev   = mb.epsPrev ?? null;
  let resultDate   = mb.resultDate ?? null;

  if (mb._raw) {
    const abs = extractAbsolutes(mb._raw);
    if (absSalesCurr == null) absSalesCurr = abs.sales.curr;
    if (absSalesPrev == null) absSalesPrev = abs.sales.prev;
    if (absPatCurr   == null) absPatCurr   = abs.pat.curr;
    if (absPatPrev   == null) absPatPrev   = abs.pat.prev;
    if (absEpsCurr   == null) absEpsCurr   = abs.eps.curr;
    if (absEpsPrev   == null) absEpsPrev   = abs.eps.prev;
    if (!resultDate)          resultDate   = abs.result_date;
  }

  // Derive YoY percentages.  Prefer MB-supplied normalised values; fall back
  // to computing from absolute pair if both are present.
  const calcPct = (curr: number | null, prev: number | null): number | null => {
    if (curr == null || prev == null) return null;
    if (prev === 0) return curr > 0 ? 200 : null;
    return ((curr - prev) / Math.abs(prev)) * 100;
  };
  const sales_yoy = mb.yoySalesGrowth ?? calcPct(absSalesCurr, absSalesPrev) ?? mb.revCagr ?? null;
  const pat_yoy   = mb.yoyProfitGrowth ?? calcPct(absPatCurr, absPatPrev) ?? mb.profitCagr ?? null;
  const eps_yoy   = mb.epsGrowth ?? calcPct(absEpsCurr, absEpsPrev) ?? null;

  const ticker = mb.symbol.toUpperCase();
  const articleText = `${article?.title || ''} ${article?.summary || article?.description || ''}`;

  const partial: Partial<ParsedEarning> = {
    ticker,
    company: mb.company || ticker.replace(/\.(NS|BO)$/i, ''),
    sector: mb.sector,
    filing_date: resultDate || article?.published_at?.slice(0, 10),
    quarter: inferQuarter(mb, article),
    market_cap_bucket: inferMarketCapBucket(mb),
    pe: mb.pe ?? null,
    price: mb.price ?? null,
    sales_yoy_pct: sales_yoy,
    net_profit_yoy_pct: pat_yoy,
    eps_yoy_pct: eps_yoy,
    sales_curr_cr: absSalesCurr,
    sales_prev_cr: absSalesPrev,
    pat_curr_cr: absPatCurr,
    pat_prev_cr: absPatPrev,
    eps_curr: absEpsCurr,
    eps_prev: absEpsPrev,
    gap_pct: null,
    d1_pct: null,
  };

  const methodology_tags = inferMethodologyTags(partial, mb);
  const caveat_tags = inferCaveatTags(mb, partial, articleText);
  const composite = computeScore(partial, mb, methodology_tags.length, caveat_tags.length);
  const tier = assignTier(composite, caveat_tags.length);

  const out: ParsedEarning = {
    ticker,
    company: partial.company || ticker,
    sector: partial.sector,
    filing_date: partial.filing_date,
    quarter: partial.quarter,
    market_cap_bucket: partial.market_cap_bucket || 'UNKNOWN',
    pe: partial.pe ?? null,
    price: partial.price ?? null,
    sales_yoy_pct: sales_yoy,
    net_profit_yoy_pct: pat_yoy,
    eps_yoy_pct: eps_yoy,
    sales_curr_cr: absSalesCurr,
    sales_prev_cr: absSalesPrev,
    pat_curr_cr: absPatCurr,
    pat_prev_cr: absPatPrev,
    eps_curr: absEpsCurr,
    eps_prev: absEpsPrev,
    gap_pct: null,
    d1_pct: null,
    composite_score: Math.round(composite),
    tier,
    methodology_tags,
    caveat_tags,
    narrative: '',
    filing_url: article?.source_url || article?.url,
    source_article_id: article?.id,
  };
  out.narrative = buildNarrative(out, mb, article?.summary || article?.description);
  return out;
}

// ─── Batch builder ──────────────────────────────────────────────────────────
export interface OpportunitiesView {
  filing_date: string | null;
  candidates_total: number;
  by_tier: Record<EarningsTier, ParsedEarning[]>;
}

export function buildOpportunities(articles: NewsArticleLite[], mbRows: MBLite[], filterDate?: string): OpportunitiesView {
  // Index news articles by stripped ticker for fast lookup
  const articlesByTicker = new Map<string, NewsArticleLite>();
  for (const a of articles) {
    if ((a.article_type || '').toUpperCase() !== 'EARNINGS') continue;
    const pt = a.primary_ticker
      ?? (Array.isArray(a.ticker_symbols) ? a.ticker_symbols[0] : undefined)
      ?? (Array.isArray(a.tickers) ? (typeof a.tickers[0] === 'string' ? a.tickers[0] : (a.tickers[0] as any)?.ticker) : undefined);
    if (!pt) continue;
    const T = String(pt).toUpperCase().replace(/\.(NS|BO)$/i, '');
    if (!articlesByTicker.has(T)) articlesByTicker.set(T, a);
  }

  const candidates: ParsedEarning[] = [];
  for (const mb of mbRows) {
    if (!mb.symbol) continue;
    // If filterDate given, prefer MB resultDate; if MB doesn't have it, include all.
    // (User wants to see graded universe — date filter narrows when data exists.)
    if (filterDate && mb.resultDate) {
      if (!mb.resultDate.startsWith(filterDate)) continue;
    }
    const lookupKey = mb.symbol.toUpperCase().replace(/\.(NS|BO)$/i, '');
    const article = articlesByTicker.get(lookupKey);
    const parsed = gradeFromMB(mb, article);
    if (parsed) candidates.push(parsed);
  }

  const by_tier: Record<EarningsTier, ParsedEarning[]> = {
    BLOCKBUSTER: [], STRONG: [], MIXED: [], AVOID: [],
  };
  for (const c of candidates) by_tier[c.tier].push(c);
  for (const t of Object.keys(by_tier) as EarningsTier[]) {
    by_tier[t].sort((a, b) => b.composite_score - a.composite_score);
  }
  return {
    filing_date: filterDate ?? null,
    candidates_total: candidates.length,
    by_tier,
  };
}
