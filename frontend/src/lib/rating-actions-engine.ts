// ═══════════════════════════════════════════════════════════════════════════
// RATING ACTIONS DETECTION ENGINE (PATCH 0765)
//
// Production-grade pipeline per user blueprint. Replaces the v1 heuristic
// "scan all news for ICRA|CRISIL|CARE tokens" approach with exchange-native
// structured ingestion + canonical normalization + old→new transition
// extraction + dedup.
//
// Architecture:
//   1. PRIMARY INGEST   — NSE credit-rating pages (debt CRD + Reg 30 SDD)
//   2. NORMALIZATION    — canonical Agency + ActionType enums
//   3. ENRICHMENT       — extract old/new rating, outlook, instrument
//   4. DEDUP            — across filings + news by (company, agency, action,
//                         newRating, date)
//   5. HIGH-SIGNAL      — default view only shows upgrade/downgrade/material
//                         outlook changes; soft "verify-needed" bucket for
//                         agency mentions where action couldn't be extracted
//
// Source priority (highest confidence first):
//   nse_credit (debt CRD)   → confidence 0.97 baseline
//   nse_reg30 (Reg 30 SDD)  → confidence 0.95 baseline
//   news                    → confidence 0.6-0.9 depending on classifier
//
// User feedback: "your current version is returning 0 rows" — root cause is
// scraping generic announcements instead of dedicated credit-rating endpoints.
// This engine targets the right sources.
// ═══════════════════════════════════════════════════════════════════════════

export type Agency = 'ICRA' | 'CRISIL' | 'CARE' | 'IND_RA' | 'OTHER';
export type ActionType =
  | 'upgrade'
  | 'downgrade'
  | 'outlook_change'
  | 'reaffirmed'
  | 'withdrawn'
  | 'assigned'
  | 'watch'
  | 'unknown';
export type SourceType = 'nse_credit' | 'nse_reg30' | 'news' | 'pdf';

export interface RatingActionRow {
  id: string;
  company: string;
  symbol?: string;
  isin?: string;
  agency: Agency;
  actionType: ActionType;
  actionLabel: string;
  instrument?: string;
  oldRating?: string;
  newRating?: string;
  oldOutlook?: string;
  newOutlook?: string;
  effectiveDate?: string;
  reportedAt?: string;
  sourceType: SourceType;
  sourceUrl: string;
  headline?: string;
  remarks?: string;
  confidence: number;       // 0..1
  verifyRequired: boolean;
}

export interface RatingWidgetState {
  asOf: string;
  sourceHealth: {
    nseCredit: 'ok' | 'empty' | 'failed';
    nseReg30: 'ok' | 'empty' | 'failed';
    news: 'ok' | 'empty' | 'failed';
  };
  totals: {
    detected: number;          // high-signal: upgrade/downgrade/material outlook
    agencyMentions: number;    // agency mentioned but action unknown
    verifyNeeded: number;      // PDF/news found but old/new missing
  };
  rows: RatingActionRow[];     // high-signal rows only (default view)
  verifyRows?: RatingActionRow[]; // optional: "needs verification" bucket
}

// ─── Normalization ──────────────────────────────────────────────────────

export function normalizeAgency(input?: string): Agency {
  const s = (input || '').toUpperCase().trim();
  if (s.includes('ICRA')) return 'ICRA';
  if (s.includes('CRISIL')) return 'CRISIL';
  if (s.includes('CARE')) return 'CARE';
  if (
    s.includes('INDIA RATINGS') ||
    s.includes('IND-RA') ||
    s.includes('IND RA') ||
    s.includes('INDIARATINGS') ||
    s.includes('FITCH')
  ) return 'IND_RA';
  return 'OTHER';
}

export function normalizeStructuredAction(input?: string): ActionType {
  const s = (input || '').toLowerCase();
  if (s.includes('upgrade')) return 'upgrade';
  if (s.includes('downgrade')) return 'downgrade';
  if (s.includes('outlook')) return 'outlook_change';
  if (s.includes('reaffirm')) return 'reaffirmed';
  if (s.includes('withdraw')) return 'withdrawn';
  if (s.includes('assign')) return 'assigned';
  if (s.includes('watch')) return 'watch';
  return 'unknown';
}

// ─── Fallback text classifier ──────────────────────────────────────────

export function classifyRatingText(text?: string): {
  actionType: ActionType;
  confidence: number;
} {
  const s = (text || '').toLowerCase();
  const has = (...terms: string[]) => terms.some(t => s.includes(t));
  if (has('upgraded', 'upgrade of credit rating', 'rating upgraded', 'revised upward')) {
    return { actionType: 'upgrade', confidence: 0.92 };
  }
  if (has('downgraded', 'downgrade of credit rating', 'rating downgraded', 'revised downward')) {
    return { actionType: 'downgrade', confidence: 0.92 };
  }
  if (has('outlook revised', 'outlook changed', 'revised outlook', 'positive outlook', 'negative outlook')) {
    return { actionType: 'outlook_change', confidence: 0.82 };
  }
  if (has('reaffirmed', 're-affirmed', 'rating reaffirmed')) {
    return { actionType: 'reaffirmed', confidence: 0.75 };
  }
  if (has('withdrawn', 'rating withdrawn', ' wd ')) {
    return { actionType: 'withdrawn', confidence: 0.75 };
  }
  if (has('rating assigned', 'initial rating')) {
    return { actionType: 'assigned', confidence: 0.66 };
  }
  if (has('credit watch', 'watch with', 'rating watch')) {
    return { actionType: 'watch', confidence: 0.70 };
  }
  return { actionType: 'unknown', confidence: 0.20 };
}

// ─── Rating transition extraction ──────────────────────────────────────

const RATING_ARROW_PATTERNS = [
  // "IND A+ to IND AA-" or "IND A+ → IND AA-"
  /([A-Z]{2,}[A-Z+\-\s]*?)\s*(?:to|->|→|–>|—>)\s*([A-Z]{2,}[A-Z+\-\s]*)/i,
  // "from X to Y"
  /from\s+([A-Z0-9+\-\s]+)\s+to\s+([A-Z0-9+\-\s]+)/i,
  // "old rating: X new rating: Y"
  /old\s*rating[:\s-]*([A-Z0-9+\-\s]+).*?new\s*rating[:\s-]*([A-Z0-9+\-\s]+)/i,
];

export function extractRatingTransition(text?: string): { oldRating?: string; newRating?: string } {
  const s = text || '';
  for (const re of RATING_ARROW_PATTERNS) {
    const m = s.match(re);
    if (m && m[1] && m[2]) {
      const oldR = m[1].trim().replace(/\s+/g, ' ').slice(0, 30);
      const newR = m[2].trim().replace(/\s+/g, ' ').slice(0, 30);
      // Sanity: both must look like rating codes (start with letter, length 2-20)
      if (/^[A-Z]/.test(oldR) && /^[A-Z]/.test(newR) && oldR.length <= 30 && newR.length <= 30) {
        return { oldRating: oldR, newRating: newR };
      }
    }
  }
  return {};
}

// ─── Outlook extraction ────────────────────────────────────────────────

export function extractOutlook(text?: string): { oldOutlook?: string; newOutlook?: string } {
  const s = (text || '').toLowerCase();
  // "outlook revised from positive to negative" / "outlook changed to stable"
  const m1 = s.match(/outlook\s+(?:revised|changed)?\s*from\s+(positive|negative|stable|developing)\s+to\s+(positive|negative|stable|developing)/i);
  if (m1) return { oldOutlook: m1[1], newOutlook: m1[2] };
  const m2 = s.match(/outlook\s+(?:revised|changed)?\s+to\s+(positive|negative|stable|developing)/i);
  if (m2) return { newOutlook: m2[1] };
  if (s.includes('positive outlook')) return { newOutlook: 'positive' };
  if (s.includes('negative outlook')) return { newOutlook: 'negative' };
  if (s.includes('stable outlook')) return { newOutlook: 'stable' };
  return {};
}

// ─── Instrument extraction ─────────────────────────────────────────────

const INSTRUMENT_PATTERNS: Array<[RegExp, string]> = [
  [/non[-\s]?convertible\s+debenture|\bNCD\b/i, 'NCD'],
  [/bank\s+(?:loan|facilities?|borrowings?)/i, 'bank loan'],
  [/commercial\s+paper|\bCP\b/i, 'CP'],
  [/issuer\s+rating/i, 'issuer'],
  [/perpetual|\bAT1\b/i, 'AT1'],
  [/working\s+capital/i, 'working capital'],
  [/term\s+loan/i, 'term loan'],
  [/fixed\s+deposit|\bFD\b/i, 'FD'],
];

export function extractInstrument(text?: string): string | undefined {
  const s = text || '';
  for (const [re, label] of INSTRUMENT_PATTERNS) {
    if (re.test(s)) return label;
  }
  return undefined;
}

// ─── NSE structured-row mapper ─────────────────────────────────────────

export interface NseCreditRawRow {
  companyName?: string;
  symbol?: string;
  isin?: string;
  ratingAgency?: string;
  creditRating?: string;
  ratingAction?: string;
  dateOfCreditRating?: string;
  reportingDate?: string;
  broadcastDateTime?: string;
  attachmentUrl?: string;
  remarks?: string;
}

export function mapNseCreditRow(raw: NseCreditRawRow): RatingActionRow {
  const structured = normalizeStructuredAction(raw.ratingAction);
  const combinedText = [raw.ratingAction, raw.creditRating, raw.remarks]
    .filter(Boolean).join(' | ');
  const fallback = classifyRatingText(combinedText);
  const actionType = structured !== 'unknown' ? structured : fallback.actionType;
  const confidence = structured !== 'unknown' ? 0.97 : fallback.confidence;
  const transition = extractRatingTransition(combinedText);
  const outlook = extractOutlook(combinedText);
  const instrument = extractInstrument(combinedText);

  return {
    id: [
      raw.symbol || raw.companyName || 'unknown',
      raw.ratingAgency || 'na',
      raw.broadcastDateTime || raw.reportingDate || raw.dateOfCreditRating || 'na'
    ].join('::'),
    company: raw.companyName || raw.symbol || 'Unknown',
    symbol: raw.symbol,
    isin: raw.isin,
    agency: normalizeAgency(raw.ratingAgency),
    actionType,
    actionLabel: raw.ratingAction || actionType,
    instrument,
    oldRating: transition.oldRating,
    newRating: transition.newRating || raw.creditRating,
    oldOutlook: outlook.oldOutlook,
    newOutlook: outlook.newOutlook,
    effectiveDate: raw.dateOfCreditRating,
    reportedAt: raw.broadcastDateTime || raw.reportingDate,
    sourceType: 'nse_credit',
    sourceUrl: raw.attachmentUrl || '',
    remarks: raw.remarks,
    confidence,
    verifyRequired: actionType === 'unknown' || (!transition.newRating && actionType !== 'reaffirmed'),
  };
}

// ─── News-source mapper ────────────────────────────────────────────────

export function mapNewsRow(article: {
  title?: string; headline?: string; url?: string; source_url?: string;
  published_at?: string; ticker?: string; symbol?: string;
}): RatingActionRow | null {
  const text = article.title || article.headline || '';
  if (!text) return null;
  const agencyMatch = text.match(/(ICRA|CRISIL|CARE|India Ratings|Ind-Ra|Fitch|Moody|S&P)/i);
  if (!agencyMatch) return null;
  const fallback = classifyRatingText(text);
  if (fallback.actionType === 'unknown') return null; // skip pure mentions in main feed
  const transition = extractRatingTransition(text);
  const outlook = extractOutlook(text);
  const instrument = extractInstrument(text);
  return {
    id: `news::${(article.ticker || 'na')}::${(article.published_at || '').slice(0, 10)}::${agencyMatch[1]}`,
    company: article.ticker || article.symbol || 'Unknown',
    symbol: article.ticker || article.symbol,
    agency: normalizeAgency(agencyMatch[1]),
    actionType: fallback.actionType,
    actionLabel: fallback.actionType,
    instrument,
    oldRating: transition.oldRating,
    newRating: transition.newRating,
    newOutlook: outlook.newOutlook,
    reportedAt: article.published_at,
    sourceType: 'news',
    sourceUrl: article.url || article.source_url || '',
    headline: text,
    confidence: fallback.confidence * 0.85, // news ≤ NSE structured
    verifyRequired: !transition.newRating,
  };
}

// ─── Deduplication ─────────────────────────────────────────────────────

export function dedupeRatingActions(rows: RatingActionRow[]): RatingActionRow[] {
  const best = new Map<string, RatingActionRow>();
  for (const row of rows) {
    const company = (row.company || '').toLowerCase().trim();
    const date = (row.effectiveDate || row.reportedAt || '').slice(0, 10);
    const key = [
      company,
      row.agency,
      row.actionType,
      (row.newRating || '').toUpperCase().replace(/\s+/g, ''),
      date,
    ].join('|');
    const prev = best.get(key);
    if (!prev || row.confidence > prev.confidence) {
      best.set(key, row);
    }
  }
  return [...best.values()].sort((a, b) => {
    const ta = new Date(a.reportedAt || a.effectiveDate || 0).getTime();
    const tb = new Date(b.reportedAt || b.effectiveDate || 0).getTime();
    return tb - ta;
  });
}

// ─── High-signal filter ────────────────────────────────────────────────

export function isHighSignal(row: RatingActionRow): boolean {
  if (row.actionType === 'upgrade' || row.actionType === 'downgrade') return true;
  if (
    row.actionType === 'outlook_change' &&
    (row.newOutlook?.toLowerCase() === 'positive' || row.newOutlook?.toLowerCase() === 'negative')
  ) {
    return true;
  }
  return false;
}

// ─── Assemble state from multiple sources ──────────────────────────────

export function assembleRatingWidgetState(opts: {
  nseCreditRows?: NseCreditRawRow[] | null;
  nseReg30Rows?: NseCreditRawRow[] | null;
  newsArticles?: Array<{ title?: string; headline?: string; url?: string; source_url?: string; published_at?: string; ticker?: string; symbol?: string }> | null;
}): RatingWidgetState {
  const all: RatingActionRow[] = [];
  const sourceHealth: RatingWidgetState['sourceHealth'] = {
    nseCredit: 'failed',
    nseReg30: 'failed',
    news: 'failed',
  };

  if (opts.nseCreditRows !== undefined && opts.nseCreditRows !== null) {
    sourceHealth.nseCredit = opts.nseCreditRows.length > 0 ? 'ok' : 'empty';
    for (const raw of opts.nseCreditRows) all.push(mapNseCreditRow(raw));
  }
  if (opts.nseReg30Rows !== undefined && opts.nseReg30Rows !== null) {
    sourceHealth.nseReg30 = opts.nseReg30Rows.length > 0 ? 'ok' : 'empty';
    for (const raw of opts.nseReg30Rows) {
      const mapped = mapNseCreditRow(raw);
      mapped.sourceType = 'nse_reg30';
      mapped.confidence = Math.min(mapped.confidence, 0.95);
      all.push(mapped);
    }
  }
  if (opts.newsArticles !== undefined && opts.newsArticles !== null) {
    let newsRows = 0;
    for (const a of opts.newsArticles) {
      const mapped = mapNewsRow(a);
      if (mapped) { all.push(mapped); newsRows++; }
    }
    sourceHealth.news = newsRows > 0 ? 'ok' : 'empty';
  }

  const deduped = dedupeRatingActions(all);
  const highSignal = deduped.filter(isHighSignal);
  const agencyMentions = deduped.filter(r => r.actionType === 'unknown');
  const verifyNeeded = deduped.filter(r => r.verifyRequired && !isHighSignal(r));

  return {
    asOf: new Date().toISOString(),
    sourceHealth,
    totals: {
      detected: highSignal.length,
      agencyMentions: agencyMentions.length,
      verifyNeeded: verifyNeeded.length,
    },
    rows: highSignal,
    verifyRows: verifyNeeded,
  };
}
