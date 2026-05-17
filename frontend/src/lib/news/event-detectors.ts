// PATCH 0449 — Institutional news-engine detectors.
//
// Built in response to the 17 May 2026 institutional audit. Adds five
// missing detector layers + one canonicalization helper. Each detector
// runs on the raw article (title + summary), returns a tag object the
// NewsCard render can surface as a chip, and exposes a numeric severity
// 0..1 that the priority ranker multiplies into the source-quality weight.
//
// Detectors:
//   1. detectCreditStress    — rating downgrade, covenant breach, FCCB
//                              maturity, pledge invocation, delayed interest,
//                              refi wall, DRT/SARFAESI action
//   2. detectPromoterBehavior — open-market buying, pledge release/reduction,
//                               inter-se transfer, creeping acquisition,
//                               ESOP dump, PE/anchor exit, block deal
//   3. detectWorkingCapital  — receivables spike, inventory build, debtor
//                              days widening, LC/BG issues, negative CFO
//                              despite PAT
//   4. detectOrderBookQuality — pass-through clause, govt vs private,
//                               execution duration band, margin profile hint,
//                               customer concentration
//   5. detectAggregatorListicle — '5 stocks to watch', 'top picks this week',
//                                 'buyback alert! 4 stocks' style headlines
//   6. detectExpectationGap  — light heuristic: 'beats estimates', 'misses',
//                              'street expectations', 'consensus too bearish/bullish'
//
// All detectors are deterministic — no LLM call. Regex-driven. Cheap to
// run client-side on every render.

export interface NewsTag {
  key: string;
  label: string;
  color: string;
  emoji: string;
  severity: number;        // 0..1 — multiplier into priority score
  evidence?: string;       // optional matched substring for tooltip
}

const lc = (s: string) => (s || '').toLowerCase();

// ────────────────────────────────────────────────────────────────────────
// 1. CREDIT STRESS
// ────────────────────────────────────────────────────────────────────────

const CREDIT_STRESS_PATTERNS: Array<{ pattern: RegExp; label: string; severity: number; emoji: string }> = [
  { pattern: /\b(rating (?:cut|downgrade|downgraded|lowered)|credit rating (?:revised|cut|lowered)|placed on (?:credit )?watch (?:negative|developing)|outlook (?:revised to )?negative)\b/i,
    label: 'Rating downgrade', severity: 0.85, emoji: '⬇️' },
  { pattern: /\b(covenant (?:breach|broken|violation|waiver)|debt covenant|loan covenant)\b/i,
    label: 'Covenant breach', severity: 0.90, emoji: '⚠️' },
  { pattern: /\b(fccb (?:matur|redempt|conver)|foreign currency convertible bond|debt wall|refinanc(?:e|ing) (?:wall|maturity|due)|debt maturity wall)\b/i,
    label: 'Refi / FCCB wall', severity: 0.80, emoji: '🧱' },
  { pattern: /\b(pledge (?:invok|forfeit|enforced|invocation|sold)|invoke(?:d|s)? pledge|promoter pledge (?:invok|forfeit))\b/i,
    label: 'Pledge invocation', severity: 0.95, emoji: '🚨' },
  { pattern: /\b(delayed (?:interest|coupon|payment)|missed (?:interest|coupon|payment)|default(?:ed|s)? on (?:interest|coupon|debt|payment)|non[- ]?payment of interest)\b/i,
    label: 'Missed interest payment', severity: 0.95, emoji: '🛑' },
  { pattern: /\b(drt (?:action|notice|proceeding)|sarfaesi notice|sarfaesi action|insolvency petition (?:filed|admitted)|nclt petition)\b/i,
    label: 'DRT / SARFAESI / NCLT action', severity: 0.92, emoji: '⚖️' },
  { pattern: /\b(working capital (?:strain|crisis|crunch|stretched)|cash flow strain|liquidity (?:crunch|strain|crisis)|debt servic(?:ing|e) (?:concerns|strain))\b/i,
    label: 'Liquidity strain', severity: 0.70, emoji: '💧' },
];

export function detectCreditStress(text: string): NewsTag | null {
  for (const p of CREDIT_STRESS_PATTERNS) {
    const m = text.match(p.pattern);
    if (m) {
      return {
        key: 'CREDIT_STRESS',
        label: p.label,
        color: '#EF4444',
        emoji: p.emoji,
        severity: p.severity,
        evidence: m[0],
      };
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// 2. PROMOTER BEHAVIOR
// ────────────────────────────────────────────────────────────────────────

const PROMOTER_PATTERNS: Array<{ pattern: RegExp; label: string; severity: number; emoji: string; bullish: boolean }> = [
  { pattern: /\b(promoter (?:open[- ]?market )?buy|promoter (?:acquir|purchas)(?:e|ed|es|ing)|promoter (?:stake|holding) (?:increased|hike|rise|grew)|promoter (?:share )?purchase|insider (?:buy|purchase))\b/i,
    label: 'Promoter buying', severity: 0.85, emoji: '🟢', bullish: true },
  { pattern: /\b(pledge (?:release|reduction|reduced|released|cut)|reduces? pledge|pledged shares (?:released|reduced)|de[- ]?pledged?)\b/i,
    label: 'Pledge reduction', severity: 0.80, emoji: '🔓', bullish: true },
  { pattern: /\b(inter[- ]?se transfer|family transfer|promoter group (?:transfer|reorganis))\b/i,
    label: 'Inter-se transfer', severity: 0.45, emoji: '↔️', bullish: false },
  { pattern: /\b(creeping acquisition|takeover (?:trigger|threshold)|5% threshold (?:crossed|breach)|substantial acquisition of shares)\b/i,
    label: 'Creeping acquisition', severity: 0.78, emoji: '📈', bullish: true },
  { pattern: /\b(esop (?:exercise|dump|sell|sale|vesting)|stock options (?:exercised|sold)|employee (?:sale|sells?|sold) shares|stocks? (?:sold|sale) by (?:senior|management))\b/i,
    label: 'ESOP / insider sell', severity: 0.55, emoji: '💼', bullish: false },
  { pattern: /\b(pe (?:exit|sells?|sale|offload)|private equity (?:exit|exits?|offload)|anchor (?:investor )?(?:exit|sells?|sale|offload)|pre[- ]?ipo investor (?:exit|sells?)|sponsor (?:exit|sells?))\b/i,
    label: 'PE / anchor exit', severity: 0.72, emoji: '🚪', bullish: false },
  { pattern: /\b(block deal|bulk deal|large trade|institutional block)\b/i,
    label: 'Block deal', severity: 0.55, emoji: '🧊', bullish: false },
  { pattern: /\b(promoter (?:stake )?sale|promoter offload|promoter dilution|promoter sells?|insider sell)\b/i,
    label: 'Promoter selling', severity: 0.80, emoji: '🔴', bullish: false },
];

export function detectPromoterBehavior(text: string): NewsTag | null {
  for (const p of PROMOTER_PATTERNS) {
    const m = text.match(p.pattern);
    if (m) {
      return {
        key: 'PROMOTER_BEHAVIOR',
        label: p.label,
        color: p.bullish ? '#10B981' : '#F59E0B',
        emoji: p.emoji,
        severity: p.severity,
        evidence: m[0],
      };
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// 3. WORKING CAPITAL STRESS
// ────────────────────────────────────────────────────────────────────────

const WC_PATTERNS: Array<{ pattern: RegExp; label: string; severity: number; emoji: string }> = [
  { pattern: /\b(receivables (?:spike|surge|jumped|widening)|trade receivables (?:up|rose|grew) (?:sharp|significantly))\b/i,
    label: 'Receivables spike', severity: 0.75, emoji: '📊' },
  { pattern: /\b(inventory (?:build|build[- ]?up|spike|surge|piled up|accumulat)|stock days (?:up|widen|stretched))\b/i,
    label: 'Inventory build-up', severity: 0.70, emoji: '📦' },
  { pattern: /\b(debtor days (?:widen|stretched|up sharply|extended)|payment cycle (?:stretched|widening))\b/i,
    label: 'Debtor days widening', severity: 0.75, emoji: '⏳' },
  { pattern: /\b(letter of credit (?:issues|problems|delays?|default)|bank guarantee (?:invok|encash|forfeit)|lc[ /]bg (?:strain|issues)|bg (?:invok|encash))\b/i,
    label: 'LC / BG issues', severity: 0.85, emoji: '🏦' },
  { pattern: /\b(negative (?:operating )?cash flow|negative cfo|cfo[ ]?<[ ]?(?:0|pat)|cash flow (?:from operations )?negative|positive pat (?:but |with )?negative (?:cfo|cash))\b/i,
    label: 'Negative CFO vs +PAT', severity: 0.88, emoji: '⚠️' },
  { pattern: /\b(cash conversion (?:cycle|days) (?:up|widen|extended|deterior)|wc (?:days|cycle) (?:up|widen|deterior))\b/i,
    label: 'Cash conversion stress', severity: 0.65, emoji: '💸' },
];

export function detectWorkingCapital(text: string): NewsTag | null {
  for (const p of WC_PATTERNS) {
    const m = text.match(p.pattern);
    if (m) {
      return {
        key: 'WC_STRESS',
        label: p.label,
        color: '#F97316',
        emoji: p.emoji,
        severity: p.severity,
        evidence: m[0],
      };
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// 4. ORDER BOOK QUALITY
// ────────────────────────────────────────────────────────────────────────

export interface OrderBookQuality {
  hasPassThrough: boolean;     // raw-material pass-through clause
  isGovernment: boolean;
  isPrivate: boolean;
  durationLabel?: 'short' | 'medium' | 'long' | 'multi-year';
  marginHint?: 'thin' | 'standard' | 'premium';
  concentrationRisk?: boolean;
  evidence: string[];
}

const ORDER_PASS_THROUGH_RE = /\b(pass[- ]?through|cost pass[- ]?through|raw material pass[- ]?through|escalation clause|price variation clause|cost plus)\b/i;
const ORDER_GOVT_RE = /\b(government|govt|psu|ministry|defen[cs]e|railway|ntpc|powergrid|sail|hal\b|bel\b|gail|ongc|coal india|indian railway|metro rail|nhai|public sector|central government|state government)\b/i;
const ORDER_PRIVATE_RE = /\b(private|reliance industries|tata group|adani group|infosys|hcl tech|wipro|larsen|enterprise|conglomerate)\b/i;
const ORDER_DURATION_MULTI = /\b(multi[- ]?year|long[- ]?term|\d{1,2}[- ]?year contract|life[- ]?of[- ]?mine|amc (?:\d+|multi))\b/i;
const ORDER_DURATION_LONG  = /\b(\d{1,2}[- ]?year|long duration|three[- ]?year|four[- ]?year|five[- ]?year)\b/i;
const ORDER_MARGIN_THIN = /\b(thin margin|low margin|loss[- ]?making contract|aggressive bid|cut[- ]?throat|l1 bid|lowest bid)\b/i;
const ORDER_MARGIN_PREMIUM = /\b(premium pricing|high margin|cost[- ]?plus|amc (?:revenue|business)|annuity|recurring (?:revenue|business))\b/i;
const ORDER_CONCENTRATION_RE = /\b(single customer|one (?:large )?customer|customer concentration|over[- ]?reliance on|one client|key customer dependency)\b/i;

const ORDER_TRIGGER_RE = /\b(order win|order wins?|secured (?:an? )?order|bagged (?:an? )?order|awarded (?:a |the )?(?:contract|order)|contract win|new order|order book|book builder|order intake|wins? (?:an? )?contract|wins? (?:an? )?order)\b/i;

export function detectOrderBookQuality(text: string): OrderBookQuality | null {
  if (!ORDER_TRIGGER_RE.test(text)) return null;
  const evidence: string[] = [];
  const hasPassThrough = ORDER_PASS_THROUGH_RE.test(text); if (hasPassThrough) evidence.push('pass-through');
  const isGovernment   = ORDER_GOVT_RE.test(text);         if (isGovernment) evidence.push('govt');
  const isPrivate      = ORDER_PRIVATE_RE.test(text);      if (isPrivate) evidence.push('private');
  let durationLabel: OrderBookQuality['durationLabel'];
  if (ORDER_DURATION_MULTI.test(text))      { durationLabel = 'multi-year'; evidence.push('multi-year'); }
  else if (ORDER_DURATION_LONG.test(text))  { durationLabel = 'long'; evidence.push('long-duration'); }
  let marginHint: OrderBookQuality['marginHint'];
  if (ORDER_MARGIN_PREMIUM.test(text))  { marginHint = 'premium'; evidence.push('premium-margin'); }
  else if (ORDER_MARGIN_THIN.test(text)) { marginHint = 'thin'; evidence.push('thin-margin'); }
  const concentrationRisk = ORDER_CONCENTRATION_RE.test(text);
  if (concentrationRisk) evidence.push('customer-concentration');
  return { hasPassThrough, isGovernment, isPrivate, durationLabel, marginHint, concentrationRisk, evidence };
}

// ────────────────────────────────────────────────────────────────────────
// 5. AGGREGATOR LISTICLE / SPECULATION FILTER
// ────────────────────────────────────────────────────────────────────────

const LISTICLE_RE = /^\s*(top\s+\d+|\d+\s+(?:stocks?|picks?|ideas?|shares?|losers?|gainers?)\s+(?:to|for)|buyback alert!?|stocks? to (?:watch|buy|track)\b|\d+\s+stocks?\s+turning\b|today's? top\b|hot stocks?\b|stocks? in (?:focus|buzz)|stocks? (?:buzzing|in news)|trending stocks?)/i;
const SPECULATION_RE = /\b(could (?:acquire|buy|merge|hike|cut)|may consider|might (?:bid|acquire|merge)|reportedly (?:weighing|planning|considering|in talks)|in talks (?:to|with)?|exploring (?:a |the )?(?:sale|merger|deal)|speculation|rumou?red|chatter|sources say|believed to be|allegedly|likely to (?:bid|acquire|merge|win))\b/i;

export interface NoiseFlags {
  isListicle: boolean;
  isSpeculation: boolean;
  qualityMultiplier: number; // 0..1 — apply to the article's priority score
}

export function detectNoise(headline: string, summary?: string): NoiseFlags {
  const h = headline || '';
  const s = `${headline || ''} ${summary || ''}`;
  const isListicle    = LISTICLE_RE.test(h);
  const isSpeculation = SPECULATION_RE.test(s);
  // Multiplier: listicle is worse than speculation. Stacking compounds.
  let q = 1.0;
  if (isListicle)    q *= 0.30;
  if (isSpeculation) q *= 0.60;
  return { isListicle, isSpeculation, qualityMultiplier: q };
}

// ────────────────────────────────────────────────────────────────────────
// 6. EXPECTATION GAP (lightweight heuristic)
// ────────────────────────────────────────────────────────────────────────

const BEAT_RE = /\b(beat(?:s|en|ing)? (?:street|consensus|estimates?|expectations?)|tops? (?:estimates?|consensus)|surprises? (?:on the )?upside|stronger[- ]than[- ]expected|ahead of (?:street|consensus|estimates?))\b/i;
const MISS_RE = /\b(miss(?:es|ed|ing)? (?:street|consensus|estimates?|expectations?)|below (?:estimates?|consensus|expectations?)|disappoints?|weaker[- ]than[- ]expected|short of (?:street|consensus|estimates?))\b/i;
const CONSENSUS_REVISE_RE = /\b(consensus (?:revise|raise|cut|lower|reduce)|estimates? (?:revise|raise|cut|lower)|analyst (?:upgrade|downgrade|hike|cut)|target price (?:raise|cut|hike|lower))\b/i;

export interface ExpectationTag {
  direction: 'BEAT' | 'MISS' | 'REVISION' | null;
  emoji: string;
  label: string;
  color: string;
}

export function detectExpectationGap(text: string): ExpectationTag | null {
  if (BEAT_RE.test(text))   return { direction: 'BEAT',     emoji: '✨', label: 'Beats street', color: '#10B981' };
  if (MISS_RE.test(text))   return { direction: 'MISS',     emoji: '❄️', label: 'Misses street', color: '#EF4444' };
  if (CONSENSUS_REVISE_RE.test(text)) return { direction: 'REVISION', emoji: '🔁', label: 'Estimate revision', color: '#8B5CF6' };
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// 7. EVENT CANONICALIZATION
// ────────────────────────────────────────────────────────────────────────

// Returns a canonical event key for grouping duplicate stories.
// Pattern: [primary_ticker]|[event_type]|[date-bucket(YYYY-WW)]|[counterparty-hint]
// Date is bucketed by ISO week so 2-3 day reporting lag doesn't fork the same event.

function _isoWeekKey(dateIsoOrEpoch: string | number): string {
  const t = typeof dateIsoOrEpoch === 'number' ? dateIsoOrEpoch : Date.parse(dateIsoOrEpoch);
  if (!Number.isFinite(t)) return '0000-W00';
  const d = new Date(t);
  // ISO week algorithm
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target.getTime()) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const COUNTERPARTY_RE = /\b(by|to|with|acquir(?:e|ed|ing) (?:by )?|merg(?:e|er) with|tender from)\s+([A-Z][A-Za-z&\.\- ]{2,30})/;

export function canonicalEventKey(article: {
  ticker_symbols?: any[];
  tickers?: any[];
  article_type?: string;
  bottleneck_sub_tag?: string;
  published_at?: string;
  title?: string;
  headline?: string;
}): string {
  const coerce = (t: any): string => typeof t === 'string' ? t : (t?.ticker ?? t?.symbol ?? '');
  const tickers = [...(article.ticker_symbols || []), ...(article.tickers || [])]
    .map(coerce).filter(Boolean).map(t => t.toUpperCase());
  const primary = tickers.sort()[0] || 'NOTICKER';
  const eventType = (article.article_type || article.bottleneck_sub_tag || 'GENERIC').toUpperCase();
  const weekKey = article.published_at ? _isoWeekKey(article.published_at) : 'NOWEEK';
  const fullText = `${article.title || article.headline || ''}`;
  const cp = (fullText.match(COUNTERPARTY_RE)?.[2] || '').toUpperCase().replace(/\s+/g, '').slice(0, 12);
  return `${primary}|${eventType}|${weekKey}|${cp}`;
}

export interface ClusteredArticle<T> {
  master: T;
  duplicates: T[];
  cluster_size: number;
  canonical_key: string;
}

/** Cluster articles by canonical key. The master is the highest-quality
 *  (best source tier) and most recent article in each cluster. */
export function clusterByCanonical<T extends {
  ticker_symbols?: any[]; tickers?: any[];
  article_type?: string; bottleneck_sub_tag?: string;
  published_at?: string; title?: string; headline?: string;
  source_url?: string; url?: string; source_name?: string; source?: string;
}>(articles: T[], opts?: { weightFn?: (a: T) => number }): ClusteredArticle<T>[] {
  const map = new Map<string, T[]>();
  for (const a of articles) {
    const key = canonicalEventKey(a);
    const arr = map.get(key) || [];
    arr.push(a);
    map.set(key, arr);
  }
  const out: ClusteredArticle<T>[] = [];
  for (const [key, arr] of map.entries()) {
    if (arr.length === 0) continue;
    // Pick master = highest weight, tie-break on recency
    const scored = arr.map(a => ({
      a,
      w: opts?.weightFn?.(a) ?? 0.5,
      t: a.published_at ? Date.parse(a.published_at) : 0,
    }));
    scored.sort((x, y) => (y.w - x.w) || (y.t - x.t));
    const master = scored[0].a;
    const dups = scored.slice(1).map(s => s.a);
    out.push({ master, duplicates: dups, cluster_size: arr.length, canonical_key: key });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// 8. CONFIDENCE BAND
// ────────────────────────────────────────────────────────────────────────

export type ConfidenceBand = 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';

export const CONFIDENCE_VISUAL: Record<ConfidenceBand, { label: string; color: string; emoji: string; description: string }> = {
  VERY_HIGH: { label: 'Very High', color: '#10B981', emoji: '◆◆◆', description: 'Definitive primary filing (NSE/BSE/SEC) + corroborated by ≥2 secondary sources' },
  HIGH:      { label: 'High',      color: '#22D3EE', emoji: '◆◆',  description: 'Primary filing OR multiple secondary corroborations' },
  MEDIUM:    { label: 'Medium',    color: '#F59E0B', emoji: '◆',   description: 'Single secondary source — wait for confirmation' },
  LOW:       { label: 'Low',       color: '#94A3B8', emoji: '·',   description: 'Aggregator / rumor / speculation — corroborate before acting' },
};

/** Map a (source-quality-weight, corroboration count) tuple to a confidence
 *  band. Replaces synthetic-looking "73%" probability numbers with the four
 *  bands institutional analysts actually use. */
export function confidenceBand(sourceWeight: number, corroborationCount: number): ConfidenceBand {
  // Definitive filings: PRIMARY tier (weight ≥ 0.85) → at least HIGH.
  if (sourceWeight >= 0.85) {
    return corroborationCount >= 2 ? 'VERY_HIGH' : 'HIGH';
  }
  // Specialist trade press: weight ≥ 0.60 — HIGH only when corroborated.
  if (sourceWeight >= 0.60) {
    return corroborationCount >= 3 ? 'HIGH' : 'MEDIUM';
  }
  // Secondary general: weight ≥ 0.40 — MEDIUM only with corroboration.
  if (sourceWeight >= 0.40) {
    return corroborationCount >= 4 ? 'MEDIUM' : 'LOW';
  }
  // Aggregator / blog — always LOW.
  return 'LOW';
}

// ────────────────────────────────────────────────────────────────────────
// 9. COMPOSITE ANNOTATOR
// ────────────────────────────────────────────────────────────────────────

/** Run all detectors on an article. Cheap helper for NewsCard render. */
export function annotateArticle(a: {
  title?: string; headline?: string; summary?: string;
}): {
  creditStress: NewsTag | null;
  promoter: NewsTag | null;
  workingCapital: NewsTag | null;
  orderQuality: OrderBookQuality | null;
  noise: NoiseFlags;
  expectation: ExpectationTag | null;
} {
  const headline = a.title || a.headline || '';
  const fullText = `${headline} ${a.summary || ''}`;
  return {
    creditStress:   detectCreditStress(fullText),
    promoter:       detectPromoterBehavior(fullText),
    workingCapital: detectWorkingCapital(fullText),
    orderQuality:   detectOrderBookQuality(fullText),
    noise:          detectNoise(headline, a.summary),
    expectation:    detectExpectationGap(fullText),
  };
}
