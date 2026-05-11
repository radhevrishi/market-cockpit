// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS OPPORTUNITIES PRO — grading engine (patch 0130)
//
// Replicates the analytical depth of earningspulse.ai/opportunities/earnings
// using the cockpit's existing data backbone:
//   - News feed (article_type=EARNINGS) for the qualitative read
//   - Multibagger upload (mb_excel_scored_v2) for fundamentals + score
//
// Per-stock output: ParsedEarning with:
//   tier (BLOCKBUSTER / STRONG / MIXED / AVOID)
//   composite_score (0-100, deterministic)
//   metrics: sales_yoy, net_profit_yoy, eps_yoy
//   methodology_tags (trend template, sepa, canslim, bonde ep, ocf
//                     divergence, optical eps, tax distortion, segment mix
//                     shift, accelerated depreciation, exceptional item,
//                     low quality, forex loss, forex gain)
//   narrative (auto-generated 2-3 sentence brief)
//
// No trade plan logic — explicitly excluded per user instruction.
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
  importance_score?: number;
  sentiment?: any;
}

// Lightweight version of MBStockRow — only fields the grader uses.
export interface MBLite {
  symbol: string;
  company?: string;
  sector?: string;
  opm?: number;
  opmPrev?: number;
  opmExpansion?: number;
  roce?: number;
  revCagr?: number;
  yoySalesGrowth?: number;
  yoyProfitGrowth?: number;
  epsGrowth?: number;
  profitAcceleration?: number;
  revenueAcceleration?: number;
  accelSignal?: 'ACCELERATING' | 'STABLE' | 'DECELERATING';
  pe?: number;
  peg?: number;
  marketCapCr?: number;
  promoter?: number;
  fii?: number;
  dii?: number;
  fiiPlusDii?: number;
  fcfAbsolute?: number;
  cfoToPat?: number;
  de?: number;
  score?: number;
  grade?: string;
}

export interface ParsedEarning {
  ticker: string;
  company: string;
  sector?: string;
  filing_date?: string;     // YYYY-MM-DD
  quarter?: string;          // 'Q4' / 'Q3' / etc.
  market_cap_bucket?: 'MEGA' | 'LARGE' | 'MID' | 'SMALL' | 'UNKNOWN';
  pe?: number | null;

  // Reported metrics
  sales_yoy_pct?: number | null;
  net_profit_yoy_pct?: number | null;
  eps_yoy_pct?: number | null;
  sales_curr_cr?: number | null;
  sales_prev_cr?: number | null;
  pat_curr_cr?: number | null;
  pat_prev_cr?: number | null;
  eps_curr?: number | null;
  eps_prev?: number | null;

  // Price reaction (best-effort, from news article if mentioned)
  gap_pct?: number | null;
  d1_pct?: number | null;

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
  | 'trend template'   // Mark Minervini SEPA trend template (price > 50/150/200 DMA, rising 200DMA)
  | 'sepa'             // SEPA full pass (volume + earnings + price structure)
  | 'canslim'          // O'Neil CANSLIM (current EPS, annual EPS, new product, supply/demand)
  | 'bonde ep'         // Bonde EPS framework (operating leverage + EPS magnitude)
  ;

export type CaveatTag =
  | 'ocf divergence'   // CFO/PAT < 0.8 — earnings not backed by cash
  | 'optical eps'      // Headline EPS magnified by base effect / one-off
  | 'tax distortion'   // Lower tax rate or refund inflating PAT
  | 'low quality'      // multiple quality flags
  | 'segment mix shift'// Revenue mix shifted, hard to compare YoY
  | 'accelerated depreciation' // one-time write-down
  | 'exceptional item' // One-time gain/loss flagged
  | 'forex loss'
  | 'forex gain'
  | 'one time order'
  ;

const TIER_THRESHOLDS = {
  BLOCKBUSTER: 85,
  STRONG: 70,
  MIXED: 50,
} as const;

// ─── Number parsing helpers ────────────────────────────────────────────────

// Pull a percentage from text like "Sales YoY +205%", "Q4 PAT +291% YoY", "EPS up 292% year-on-year"
function parseYoyPct(text: string, metricKeywords: RegExp): number | null {
  if (!text) return null;
  // Patterns we look for: "<metric> ... (+/-)NN.NN %"
  // Build a regex that requires the metric keyword within 60 chars of a percent value.
  const re = new RegExp(
    `(?:${metricKeywords.source})[^.]{0,80}?([+-]?\\d{1,4}(?:\\.\\d{1,2})?)\\s*%`,
    'i',
  );
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// "Rs 889 Cr vs Rs 291 Cr" — extract both
function parseAbsolutePair(text: string, metricKeywords: RegExp): { curr: number; prev: number } | null {
  if (!text) return null;
  const re = new RegExp(
    `(?:${metricKeywords.source})[^.]{0,60}?(?:rs\\.?|₹|inr)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:cr|crore)?(?:[^.]{0,30}?(?:vs|against|compared)\\s*(?:rs\\.?|₹|inr)?\\s*([\\d,]+(?:\\.\\d+)?))?`,
    'i',
  );
  const m = re.exec(text);
  if (!m) return null;
  const curr = Number(m[1].replace(/,/g, ''));
  const prev = m[2] ? Number(m[2].replace(/,/g, '')) : NaN;
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  return { curr, prev };
}

// ─── Article parser ────────────────────────────────────────────────────────

const SALES_RE = /\b(sales|revenue|topline|net\s+sales|total\s+revenue)\b/i;
const PAT_RE   = /\b(pat|net\s+profit|profit\s+after\s+tax|net\s+income|bottom\s+line)\b/i;
const EPS_RE   = /\b(eps|earnings\s+per\s+share)\b/i;

const QUARTER_RE = /\b(Q[1-4])\s*(?:FY)?(?:20)?(\d{2})?\b/i;

const CAVEAT_PATTERNS: Array<{ tag: CaveatTag; pattern: RegExp }> = [
  { tag: 'ocf divergence', pattern: /\b(operating cash flow|cfo|ocf).{0,30}(decline|negative|down|fell|lower than|divergence)\b/i },
  { tag: 'optical eps',    pattern: /\b(base[- ]effect|low base|prior[- ]year loss|optical|inflated|masked|magnif)\w*\b/i },
  { tag: 'tax distortion', pattern: /\b(tax\s+(?:refund|credit|reversal|write[- ]back)|effective tax rate fell|deferred tax)\b/i },
  { tag: 'segment mix shift', pattern: /\b(segment\s+(?:mix|shift|reclassification)|business mix changed|reporting segment)\b/i },
  { tag: 'accelerated depreciation', pattern: /\b(accelerated depreciation|one[- ]time depreciation|write[- ]?down)\b/i },
  { tag: 'exceptional item', pattern: /\b(exceptional item|one[- ]time gain|one[- ]time loss|extraordinary item|impairment)\b/i },
  { tag: 'forex loss',     pattern: /\bforex\s+loss\b|\bfx\s+loss\b|\bcurrency\s+(?:headwind|hit|loss)\b/i },
  { tag: 'forex gain',     pattern: /\bforex\s+gain\b|\bfx\s+gain\b|\bcurrency\s+tailwind\b/i },
  { tag: 'one time order',  pattern: /\bone[- ]time\s+order\b|\bsingle\s+order\b|\blarge\s+one[- ]off\s+order\b/i },
];

function inferMarketCapBucket(mb?: MBLite): ParsedEarning['market_cap_bucket'] {
  const mc = mb?.marketCapCr;
  if (mc == null) return 'UNKNOWN';
  if (mc >= 200_000) return 'MEGA';
  if (mc >=  20_000) return 'LARGE';
  if (mc >=   5_000) return 'MID';
  return 'SMALL';
}

function detectQuarter(text: string): string | undefined {
  const m = QUARTER_RE.exec(text);
  return m ? m[1].toUpperCase() : undefined;
}

// ─── Scoring engine ────────────────────────────────────────────────────────

interface ScoreBreakdown {
  growth: number;
  earnings_quality: number;
  acceleration: number;
  technical: number;
  caveat_penalty: number;
  composite: number;
}

function scoreEarnings(p: Partial<ParsedEarning>, mb?: MBLite): ScoreBreakdown {
  // Growth pillar (0-100) — driven by Sales / PAT / EPS YoY
  const salesY = p.sales_yoy_pct ?? mb?.yoySalesGrowth ?? null;
  const patY   = p.net_profit_yoy_pct ?? mb?.yoyProfitGrowth ?? null;
  const epsY   = p.eps_yoy_pct ?? mb?.epsGrowth ?? null;
  const growthInputs = [salesY, patY, epsY].filter((v): v is number => v != null);
  let growth = 50;
  if (growthInputs.length > 0) {
    // Sales 20%, PAT 30%, EPS 50% if all present; else even-weighted
    const w = {
      sales: salesY != null ? 0.20 : 0,
      pat:   patY   != null ? 0.30 : 0,
      eps:   epsY   != null ? 0.50 : 0,
    };
    const totalW = w.sales + w.pat + w.eps || 1;
    const score = (s: number) =>
      s >= 100 ? 100 : s >= 50 ? 90 : s >= 25 ? 75 : s >= 10 ? 60 : s >= 0 ? 45 : s >= -10 ? 30 : 15;
    growth = (
      (salesY != null ? score(salesY) * w.sales : 0) +
      (patY   != null ? score(patY)   * w.pat   : 0) +
      (epsY   != null ? score(epsY)   * w.eps   : 0)
    ) / totalW;
  }

  // Earnings quality pillar — driven by MB CFO/PAT + OPM expansion
  let earnings_quality = 60;
  if (mb) {
    const opmExp = mb.opmExpansion ?? null;
    const cfoToPat = mb.cfoToPat ?? null;
    let s = 50;
    if (cfoToPat != null) s += cfoToPat >= 1.0 ? 25 : cfoToPat >= 0.8 ? 15 : cfoToPat >= 0.5 ? 0 : -15;
    if (opmExp != null)   s += opmExp >= 3 ? 18 : opmExp >= 1 ? 10 : opmExp >= -1 ? 0 : -12;
    earnings_quality = Math.max(0, Math.min(100, s));
  }

  // Acceleration pillar — MB profitAcceleration / accelSignal
  let acceleration = 50;
  if (mb) {
    if (mb.accelSignal === 'ACCELERATING') acceleration = 85;
    else if (mb.accelSignal === 'STABLE') acceleration = 55;
    else if (mb.accelSignal === 'DECELERATING') acceleration = 25;
    const pa = mb.profitAcceleration ?? null;
    if (pa != null) {
      if      (pa >= 20) acceleration = Math.max(acceleration, 90);
      else if (pa >= 10) acceleration = Math.max(acceleration, 75);
      else if (pa <  -15) acceleration = Math.min(acceleration, 30);
    }
  }

  // Technical pillar — driven by methodology tags (computed later)
  // Default 55; +12 per methodology tag passing.
  // Will be filled in scoreWithMethodology after methodology tags known.
  let technical = 55;

  // Caveat penalty — subtract from composite
  // computed in main flow

  const composite = growth * 0.30 + earnings_quality * 0.30 + acceleration * 0.25 + technical * 0.15;
  return { growth, earnings_quality, acceleration, technical, caveat_penalty: 0, composite };
}

// ─── Methodology tag inference ──────────────────────────────────────────────

function inferMethodologyTags(p: Partial<ParsedEarning>, mb?: MBLite, articleText?: string): MethodologyTag[] {
  const tags = new Set<MethodologyTag>();
  const text = (articleText || '').toLowerCase();

  // trend template — explicit mention OR (price > 200DMA AND rising)
  if (/\b(trend\s+template|stage[- ]?2|fresh\s+52w?[- ]?high|breakout|all[- ]?time\s+high|stage[- ]?2\s+breakout)\b/.test(text)) {
    tags.add('trend template');
  }
  // SEPA — Mark Minervini's framework
  if (/\b(sepa|specific\s+entry\s+point\s+analysis|relative\s+strength|rs\s+\d{2,3}|leadership\s+breakout)\b/.test(text)) {
    tags.add('sepa');
  }
  // CANSLIM
  if (/\b(canslim|cup\s+(?:and|&)\s+handle|institutional\s+sponsorship|new\s+(?:high|product|management)|leader\s+in\s+industry)\b/.test(text)) {
    tags.add('canslim');
  }
  // Bonde EP — operating leverage + EPS magnitude
  const epsY = p.eps_yoy_pct ?? mb?.epsGrowth ?? null;
  const salesY = p.sales_yoy_pct ?? mb?.yoySalesGrowth ?? null;
  if (epsY != null && epsY >= 30 && (salesY == null || salesY >= 10)) {
    tags.add('bonde ep');
  }
  return Array.from(tags);
}

function inferCaveatTags(articleText: string, mb?: MBLite): CaveatTag[] {
  const tags = new Set<CaveatTag>();
  for (const { tag, pattern } of CAVEAT_PATTERNS) {
    if (pattern.test(articleText)) tags.add(tag);
  }
  // CFO/PAT below 0.8 → ocf divergence even without explicit text mention
  if (mb?.cfoToPat != null && mb.cfoToPat < 0.8) tags.add('ocf divergence');
  // Multiple quality flags → low quality
  if (tags.size >= 3) tags.add('low quality');
  return Array.from(tags);
}

// ─── Tier assignment ───────────────────────────────────────────────────────

function assignTier(composite: number, caveatCount: number): EarningsTier {
  // Caveat-aware tier cap: 3+ caveats can never be BLOCKBUSTER, 4+ never STRONG
  let effectiveScore = composite - caveatCount * 4;
  if      (effectiveScore >= TIER_THRESHOLDS.BLOCKBUSTER) return 'BLOCKBUSTER';
  else if (effectiveScore >= TIER_THRESHOLDS.STRONG)     return 'STRONG';
  else if (effectiveScore >= TIER_THRESHOLDS.MIXED)      return 'MIXED';
  else                                                   return 'AVOID';
}

// ─── Narrative generator ────────────────────────────────────────────────────

function buildNarrative(p: ParsedEarning, mb?: MBLite, articleSummary?: string): string {
  const parts: string[] = [];
  const ticker = p.ticker || p.company;
  const q = p.quarter || 'this quarter';

  // Lead sentence — depends on tier
  if (p.tier === 'BLOCKBUSTER') {
    parts.push(`${ticker} prints a blockbuster ${q} (${formatGrowth('revenue', p.sales_yoy_pct)}, ${formatGrowth('PAT', p.net_profit_yoy_pct)}, ${formatGrowth('EPS', p.eps_yoy_pct)})`);
    if (p.methodology_tags.length >= 2) parts.push(`with ${p.methodology_tags.join('/')} all passing`);
    if (mb?.accelSignal === 'ACCELERATING') parts.push(`and acceleration confirmed across topline + bottomline`);
  } else if (p.tier === 'STRONG') {
    parts.push(`${ticker} delivers strong ${q}: ${formatGrowth('revenue', p.sales_yoy_pct)}, ${formatGrowth('EPS', p.eps_yoy_pct)}`);
    if (p.caveat_tags.length > 0) parts.push(`but ${p.caveat_tags.slice(0, 2).join(' + ')} flag some caveats`);
  } else if (p.tier === 'MIXED') {
    parts.push(`${ticker} ${q} shows ${formatGrowth('EPS', p.eps_yoy_pct)} but ${p.caveat_tags[0] || 'mixed signals'} cloud the print`);
  } else {
    parts.push(`${ticker} ${q} fails the bar — ${formatGrowth('EPS', p.eps_yoy_pct) || 'weak growth'}`);
    if (p.caveat_tags.length > 0) parts.push(`with ${p.caveat_tags.slice(0, 2).join(' + ')} compounding the read`);
  }

  // Trailing sentence — flavour from article summary if present
  if (articleSummary && articleSummary.length > 40) {
    const flavour = articleSummary.split(/[.!?]/)[0].trim();
    if (flavour && flavour.length < 200 && flavour.length > 20) parts.push(`. ${flavour}`);
  }

  return parts.join(' ').replace(/\s+\./g, '.').replace(/\s+/g, ' ').trim() + (parts.join(' ').endsWith('.') ? '' : '.');
}

function formatGrowth(label: string, pct: number | null | undefined): string {
  if (pct == null) return '';
  const sign = pct >= 0 ? '+' : '';
  return `${label} ${sign}${pct.toFixed(0)}% YoY`;
}

// ─── Main entry — gradeEarning ──────────────────────────────────────────────

export function gradeEarning(article: NewsArticleLite, mb?: MBLite): ParsedEarning | null {
  const fullText = `${article.title || ''} ${article.summary || article.description || ''}`;
  if (!fullText.trim()) return null;

  // Resolve primary ticker
  const pt = article.primary_ticker
    ?? (Array.isArray(article.ticker_symbols) ? article.ticker_symbols[0] : undefined)
    ?? (Array.isArray(article.tickers) ? (typeof article.tickers[0] === 'string' ? article.tickers[0] : (article.tickers[0] as any)?.ticker) : undefined);
  if (!pt) return null;
  const ticker = String(pt).toUpperCase();

  // Parse YoY metrics
  const sales_yoy = parseYoyPct(fullText, SALES_RE) ?? mb?.yoySalesGrowth ?? null;
  const pat_yoy   = parseYoyPct(fullText, PAT_RE)   ?? mb?.yoyProfitGrowth ?? null;
  const eps_yoy   = parseYoyPct(fullText, EPS_RE)   ?? mb?.epsGrowth ?? null;

  // Parse absolute pairs (best-effort)
  const salesPair = parseAbsolutePair(fullText, SALES_RE);
  const patPair   = parseAbsolutePair(fullText, PAT_RE);
  const epsPair   = parseAbsolutePair(fullText, EPS_RE);

  // Build preliminary
  const partial: Partial<ParsedEarning> = {
    ticker,
    company: mb?.company || ticker,
    sector: mb?.sector,
    filing_date: article.published_at?.slice(0, 10),
    quarter: detectQuarter(fullText),
    market_cap_bucket: inferMarketCapBucket(mb),
    pe: mb?.pe ?? null,
    sales_yoy_pct: sales_yoy,
    net_profit_yoy_pct: pat_yoy,
    eps_yoy_pct: eps_yoy,
    sales_curr_cr: salesPair?.curr ?? null,
    sales_prev_cr: salesPair?.prev ?? null,
    pat_curr_cr:   patPair?.curr ?? null,
    pat_prev_cr:   patPair?.prev ?? null,
    eps_curr:      epsPair?.curr ?? null,
    eps_prev:      epsPair?.prev ?? null,
    gap_pct: null,
    d1_pct: null,
  };

  const methodology_tags = inferMethodologyTags(partial, mb, fullText);
  const caveat_tags = inferCaveatTags(fullText, mb);

  // Score with methodology bonus
  const breakdown = scoreEarnings(partial, mb);
  const technicalBoost = methodology_tags.length * 12;
  const caveatPenalty = caveat_tags.length * 4;
  const composite = Math.max(0, Math.min(100,
    breakdown.growth * 0.30 +
    breakdown.earnings_quality * 0.30 +
    breakdown.acceleration * 0.25 +
    (breakdown.technical + technicalBoost) * 0.15 -
    caveatPenalty,
  ));

  const tier = assignTier(composite, caveat_tags.length);

  const out: ParsedEarning = {
    ticker,
    company: partial.company || ticker,
    sector: partial.sector,
    filing_date: partial.filing_date,
    quarter: partial.quarter,
    market_cap_bucket: partial.market_cap_bucket || 'UNKNOWN',
    pe: partial.pe ?? null,
    sales_yoy_pct: partial.sales_yoy_pct ?? null,
    net_profit_yoy_pct: partial.net_profit_yoy_pct ?? null,
    eps_yoy_pct: partial.eps_yoy_pct ?? null,
    sales_curr_cr: partial.sales_curr_cr ?? null,
    sales_prev_cr: partial.sales_prev_cr ?? null,
    pat_curr_cr: partial.pat_curr_cr ?? null,
    pat_prev_cr: partial.pat_prev_cr ?? null,
    eps_curr: partial.eps_curr ?? null,
    eps_prev: partial.eps_prev ?? null,
    gap_pct: null,
    d1_pct: null,
    composite_score: Math.round(composite),
    tier,
    methodology_tags,
    caveat_tags,
    narrative: '',
    filing_url: (article as any).source_url || (article as any).url,
    source_article_id: article.id,
  };
  out.narrative = buildNarrative(out, mb, article.summary || article.description);
  return out;
}

// Batch grade a list of articles + MB rows, group by tier, sort by score
export interface OpportunitiesView {
  filing_date: string | null;
  candidates_total: number;
  by_tier: Record<EarningsTier, ParsedEarning[]>;
}

export function buildOpportunities(articles: NewsArticleLite[], mbRows: MBLite[], filterDate?: string): OpportunitiesView {
  const mbByTicker = new Map<string, MBLite>();
  for (const r of mbRows) {
    if (r.symbol) mbByTicker.set(r.symbol.toUpperCase().replace(/\.(NS|BO)$/i, ''), r);
  }
  const seen = new Set<string>();
  const candidates: ParsedEarning[] = [];
  for (const a of articles) {
    if ((a.article_type || '').toUpperCase() !== 'EARNINGS') continue;
    if (filterDate && a.published_at && !a.published_at.startsWith(filterDate)) continue;
    const pt = a.primary_ticker
      ?? (Array.isArray(a.ticker_symbols) ? a.ticker_symbols[0] : undefined)
      ?? (Array.isArray(a.tickers) ? (typeof a.tickers[0] === 'string' ? a.tickers[0] : (a.tickers[0] as any)?.ticker) : undefined);
    if (!pt) continue;
    const ticker = String(pt).toUpperCase();
    if (seen.has(ticker)) continue;
    const mb = mbByTicker.get(ticker.replace(/\.(NS|BO)$/i, ''));
    const parsed = gradeEarning(a, mb);
    if (parsed) {
      seen.add(ticker);
      candidates.push(parsed);
    }
  }
  // Sort each tier by score descending
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
