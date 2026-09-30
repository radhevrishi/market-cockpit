// zzz847 - feed-layer quality helpers for Special Situations. Pure, no I/O.
// Central place for: HTML entity decoding, non-ticker denylist, subject / company
// extraction, SEC filing-title parsing, Form 10 registration vs spin-off, content
// hints (price / preview / analyst / opinion), merger-vs-demerger subtype, and
// cross-source duplicate keys. No company is hardcoded; the lists below are
// generic (currencies, exchanges, regulators, brokers, designations, time zones).

import { resolveCompanyToTicker, NSE_TICKER_NAMES } from './nse-ticker-names';

// ─── 1. HTML entities (centralised) ──────────────────────────────────────────
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', rupee: '₹', pound: '£', euro: '€', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™',
};
export function decodeHtmlEntities(input: string): string {
  if (!input || input.indexOf('&') < 0) return input || '';
  let s = input;
  for (let pass = 0; pass < 2; pass++) { // twice: handles &amp;#8377;
    const before = s;
    s = s
      .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => { const c = parseInt(h, 16); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; })
      .replace(/&#(\d{1,7});/g, (m, d) => { const c = parseInt(d, 10); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m; })
      .replace(/&([a-z]{2,8});/gi, (m, n) => (NAMED[n.toLowerCase()] !== undefined && n.toLowerCase() !== 'amp' ? NAMED[n.toLowerCase()] : m))
      .replace(/&amp;/gi, '&');
    if (s === before) break;
  }
  return s;
}

// ─── 2. Non-ticker acronyms (generic) ────────────────────────────────────────
export const NON_TICKER_ACRONYMS: ReadonlySet<string> = new Set([
  // tribunals / regulators / govt bodies
  'SAT', 'NCLT', 'NCLAT', 'SEBI', 'RBI', 'IRDAI', 'CCI', 'SEC', 'FTC', 'DOJ', 'FDA', 'USFDA', 'CDSCO', 'CBI', 'ED', 'IBBI', 'TRAI', 'DGCA', 'MCA', 'GST', 'CBDT', 'ITAT', 'NGT', 'PIB', 'NITI', 'EPFO', 'LIC', 'FSSAI', 'CERC', 'FCA', 'ECB', 'IMF', 'OPEC', 'WTO', 'NATO', 'UN',
  // exchanges / indices
  'NSE', 'BSE', 'NYSE', 'NASDAQ', 'AMEX', 'LSE', 'TSX', 'SGX', 'HKEX', 'MSCI', 'FTSE', 'SENSEX', 'NIFTY', 'OTC', 'NCDEX', 'MCX',
  // currencies
  'INR', 'USD', 'CAD', 'EUR', 'GBP', 'JPY', 'CNY', 'RMB', 'AUD', 'CHF', 'SGD', 'AED', 'HKD', 'NZD', 'PHP', 'KRW', 'RS', 'CR', 'LAKH',
  // time zones
  'IST', 'EST', 'EDT', 'PST', 'PDT', 'CST', 'CET', 'GMT', 'UTC', 'BST', 'JST', 'HKT', 'SGT', 'ET', 'PT',
  // designations
  'CMD', 'CEO', 'CFO', 'COO', 'CTO', 'CIO', 'CXO', 'MD', 'VP', 'EVP', 'SVP', 'GM', 'DGM', 'MP', 'MLA', 'PM', 'FM', 'CM', 'NED', 'HOD',
  // ownership / labels
  'PSU', 'PSUS', 'PSB', 'PSE', 'MNC', 'SME', 'MSME', 'NBFC', 'HFC', 'AMC', 'REIT', 'INVIT', 'ETF', 'SPAC', 'FII', 'FPI', 'DII', 'QIP', 'IPO', 'FPO', 'OFS', 'NCD', 'SIP', 'AIF', 'PMS', 'LLP', 'LLC', 'LTD', 'INC', 'PLC', 'CORP', 'LP',
  // brokers / banks / advisers named in analyst context (generic broker names, not issuers of the story)
  'CLSA', 'UBS', 'HSBC', 'JPM', 'JPMORGAN', 'NOMURA', 'MACQUARIE', 'JEFFERIES', 'KOTAK', 'NUVAMA', 'CITI', 'CITIGROUP', 'BOFA', 'BNP', 'DAM', 'IIFL', 'ICICI', 'HDFC', 'AXIS', 'SBI', 'PNB', 'BOB', 'IDBI', 'BARCLAYS', 'MORGAN', 'GOLDMAN',
  // deal / news vocabulary
  'CAR', 'FY', 'FY25', 'FY26', 'FY27', 'FY28', 'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'YOY', 'QOQ', 'EPS', 'PAT', 'EBITDA', 'EBIT', 'ROE', 'ROCE', 'AGM', 'EGM', 'NAV', 'AUM', 'MW', 'GW', 'BPS', 'CAGR', 'TTM', 'NEW', 'TOP', 'BUY', 'SELL', 'HOLD', 'LIVE', 'NEWS', 'UPDATE', 'WATCH', 'STOCK', 'STOCKS', 'SHARE', 'SHARES', 'INDIA', 'CHINA', 'USA', 'UK', 'EU', 'UAE', 'US', 'AI', 'EV', 'IT', 'PE', 'VC', 'JV', 'MOU', 'LOI', 'BOD',
  // pay commission / union style acronyms
  'JCM', 'NCJCM', 'DA', 'DR', 'CGHS', 'NPS', 'OPS', 'UPS',
  // words taken from entity names
  'BEAUTY', 'TECH', 'INFRA', 'LIFE', 'CAPITAL', 'GLOBAL', 'FUND', 'TRUST', 'GROUP', 'HOLDINGS', 'PARTNERS', 'PRIVATE', 'EQUITY', 'CREDIT', 'FINANCE', 'PROPERTY', 'ENERGY', 'POWER', 'REALTY', 'SPINCO',
]);

/** Conglomerate / group prefixes: a leading token that names a group, not one listed issuer. */
const GROUP_PREFIXES: ReadonlySet<string> = new Set(['JSW', 'RPSG', 'HDFC', 'TATA', 'ADANI', 'BAJAJ', 'BIRLA', 'GODREJ', 'MAHINDRA', 'RELIANCE', 'AB', 'CK', 'ESSAR', 'SHAPOORJI', 'MURUGAPPA', 'LODHA']);
export const isGroupPrefix = (t: string): boolean => GROUP_PREFIXES.has(t.toUpperCase());

const SEC_SOURCE_RE = /\bsec\b|sec\.gov|edgar/i;
export const isSecSource = (source?: string, link?: string): boolean => SEC_SOURCE_RE.test(source || '') || /sec\.gov/i.test(link || '');

// ─── 3. SEC filing titles ────────────────────────────────────────────────────
// '10-12G/A - B-Scada, Inc. (0001341878) (Filer)'  -> form '10-12G/A', company 'B-Scada, Inc.'
const SEC_FORM_ALT = '(?:10-12[BG]|10-K|10-Q|8-K|S-1|S-4|S-11|F-1|F-4|424B\\d|SC\\s*(?:TO-[TI]|13E-?3|14D-?9|13[DG])|SCHEDULE\\s*13[DG]|DEF\\s*14A|PREM14A|DEFM14A|N-2|N-14|NT\\s*10-[KQ])';
const SEC_TITLE_RE = new RegExp(`^(${SEC_FORM_ALT}(?:\\/A)?)\\s+-\\s+(.+?)\\s*(?:\\((?:\\d{3,10})\\))?\\s*(?:\\((?:Filer|Subject|Issuer|Filed by|Reporting|Filed for)[^)]*\\))*\\s*$`, 'i');

export interface SecTitle { form: string; company: string; isAmendment: boolean }
export function parseSecFilingTitle(title: string): SecTitle | null {
  const m = (title || '').trim().match(SEC_TITLE_RE);
  if (!m) return null;
  const company = m[2].replace(/\s*\(\d{3,10}\)\s*/g, ' ').replace(/\s*\((?:Filer|Subject|Issuer|Filed by|Reporting)[^)]*\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!company) return null;
  return { form: m[1].toUpperCase().replace(/\s+/g, ' '), company, isAmendment: /\/A$/i.test(m[1]) };
}

export const isForm10Title = (title: string): boolean => /^\s*10-12[BG](?:\/A)?\b/i.test(title || '');

const SPIN_TEXT_RE = /\b(spin[\s-]?co|spin[\s-]?off|spun[\s-]?off|spinoff|split[\s-]?off|separation|carve[\s-]?out|distribution of (?:all |shares |approximately )?(?:of )?(?:the )?(?:outstanding )?(?:shares|common stock)|pro rata distribution|distribut\w+ (?:to|of) (?:its |the )?(?:parent|stockholders|shareholders))\b/i;

/** Form 10-12G/B is a registration of a class of securities. Only SpinCo-style filers / text are spin-offs. */
export function classifyForm10(title: string, description?: string): 'SPIN' | 'REGISTRATION' | null {
  if (!isForm10Title(title)) return null;
  return SPIN_TEXT_RE.test(`${title} ${description || ''}`) ? 'SPIN' : 'REGISTRATION';
}

// ─── 4. Content hints: price / preview / analyst / opinion / non-corporate ─────
export interface FeedContentHints {
  isPriceArticle: boolean;
  isPreview: boolean;
  isAnalystTarget: boolean;
  isOpinion: boolean;
  isNonCorporate: boolean;
  isRegistration: boolean;
  /** Text spans that are price / dividend / percentage moves, never earnings evidence. */
  nonEarningsNumbers: string[];
}
export type SubtypeHint = 'MERGER' | 'SPIN' | 'FINANCING' | 'GUIDANCE_PLAN' | 'LISTING_DONE' | 'NEW_PRODUCT' | null;

const PRICE_RE = /\b(share price|stock price)\b.{0,40}\b(falls?|fell|drops?|dropped|slips?|slides?|jumps?|rallies|rally|surges?|climbs?|gains?|tumbles?|plunges?|down|up|rises?|hits?)\b|\b(falls?|drops?|slips?|slides?|jumps?|rallies|rally|surges?|climbs?|tumbles?|plunges?|rises?|gains?|zooms?|soars?|sinks?|hits? (?:52|upper|lower))\b[^.]{0,30}\d+(?:\.\d+)?\s?%|\bshare price\b.{0,30}\bsince\b|\bsince (?:the )?(?:demerger|listing|ipo)\b|\b(?:shares?|stock) (?:rally|jump|surge|fall|drop|slump|tank|zoom|soar)s?\b.{0,20}\d+\s?%|\bzooms? \d+\s?%|\bwhat'?s dragging\b|\bintraday\b/i;
const PREVIEW_RE = /\b(q[1-4]|fy\d{2}|quarterly|half[- ]yearly)?\s*results? (?:today|tomorrow|preview|date|on)\b|\bresults? today\b|\bwhat to watch\b|\b(?:earnings|results) (?:preview|calendar|date)\b|\bdate, time\b|\b(?:record date|ex[- ]date) (?:alert|details|list)\b|\blast chance to buy\b|\bwhat to expect\b|\bahead of (?:q[1-4]|results|earnings)\b|\b(?:stock split|bonus|dividend) watch\b|\brecord date alert\b|\bcheck (?:ratio|record date|dates?)\b/i;
const ANALYST_RE = /\b(price target|target price|share price target|brokerages?|analysts?)\b.{0,60}\b(upside|see|sees|raises?|cuts?|lifts?|target|rating)\b|\b(?:citi|clsa|nuvama|jefferies|nomura|goldman|morgan stanley|macquarie|kotak|motilal|iifl|jpmorgan|ubs|bofa|hsbc|bernstein)\b.{0,50}\b(?:target|upside|buy|overweight|outperform|rating)\b|\bup to \d+% upside\b|\b(?:buy|sell|hold) (?:rating|call)\b|\bstocks? to buy\b|\b(?:brokerage|analyst) (?:picks?|calls?)\b|\bwhat (?:goldman|nomura|citi|analysts?|brokerages?)\b.{0,30}\bsay\b|\bhere'?s what .{0,30}\bsay\b/i;
const OPINION_RE = /^\s*(prediction|opinion|analysis|explained|explainer|view|column|commentary|will\b.{0,80}\?|should you|can\b.{0,60}\?|is it (?:time|worth))\b|\?\s*$|\bwhy (?:buy|sell)\b|\bbull(?:ish)? case\b|\bbear(?:ish)? case\b|\bprediction\b/i;
const NON_CORPORATE_RE = /\b(pay commission|pensioners?|pension (?:rumou?rs|scheme)|retirees|dearness allowance|staff side|union (?:leader|demands?)|lok sabha|rajya sabha|cabinet approves|general secy)\b/i;

const NUM_SPANS: RegExp[] = [
  /(?:rs\.?|inr|₹|\$|€|£|cad|usd)\s?\d[\d,]*(?:\.\d+)?\s?\/?\s*(?:per\s+)?share/gi,
  /(?:rs\.?|inr|₹)\s?\d[\d,]*(?:\.\d+)?\s?\/\s*(?:equity\s+)?share/gi,
  /\d[\d,]*(?:\.\d+)?\s?%\s*(?:dividend|upside|downside|intraday|rally|jump|fall|drop|surge|gain|since\s+\w+)?/gi,
];
export function nonEarningsNumberSpans(text: string): string[] {
  const out: string[] = [];
  for (const re of NUM_SPANS) for (const m of text.matchAll(re)) out.push(m[0].trim());
  return Array.from(new Set(out));
}

export function contentHints(title: string, description?: string): FeedContentHints {
  const t = title || '';
  const isAnalystTarget = ANALYST_RE.test(t);
  const isPreview = PREVIEW_RE.test(t);
  // A preview or analyst headline is not a price article even when it mentions a percent.
  const isPriceArticle = !isPreview && !isAnalystTarget && PRICE_RE.test(t);
  const isOpinion = OPINION_RE.test(t) && !isAnalystTarget;
  return {
    isPriceArticle, isPreview, isAnalystTarget, isOpinion,
    isNonCorporate: NON_CORPORATE_RE.test(t),
    isRegistration: isForm10Title(t) && classifyForm10(t, description) === 'REGISTRATION',
    nonEarningsNumbers: nonEarningsNumberSpans(t),
  };
}

/** Anything the radar must not treat as a catalyst event. */
export const isNonEventContent = (h: FeedContentHints): boolean => h.isPriceArticle || h.isPreview || h.isAnalystTarget || h.isOpinion || h.isNonCorporate;

// ─── 5. Merger vs demerger vs financing vs plan ──────────────────────────────
const MERGER_RE = /\b(merger with|to merge|merges? with|merge (?:its|with|into)|merged? into|swap ratio|share[- ]exchange ratio|exchange ratio|amalgamat\w*|merger (?:proposal|agreement|scheme|announce)|merger of|\bmerger\b)/i;
const SPIN_RE = /\b(hive[- ]?off|hiving off|demerg\w*|de-?merger|spin[- ]?(?:off|out|co)\w*|spun[- ]off|split[- ]?off|carve[- ]?out|separate listing|business separation)\b/i;
const FINANCING_RE = /\b(bank loan|term loan|seeks? (?:rs\.?|₹|\$)?[\d,.]+\s*(?:crore|cr|billion|million|bn|mn)?\s*(?:bank )?loan|raises? (?:rs\.?|₹|\$)?[\d,.]+\s*(?:crore|cr|billion|million|bn|mn)?\s*(?:via|through) (?:ncd|bonds?|debentures?|loan)|credit facilit|borrow(?:ing|s)?|refinanc\w+)\b/i;
const PLAN_RE = /\b(outlines?|unveils?|lays out|charts?) (?:a |its |the )?(?:strategic )?(?:expansion|growth|strategy|plan|roadmap|vision)|\btargets? (?:rs\.?|₹|\$|inr)?\s?[\d,.]+\s*(?:crore|cr|lakh crore|billion|million|bn|mn)?\s*(?:in )?(?:revenue|sales|turnover|ebitda)|\brevenue target\b|\bguidance\b/i;
const LISTING_DONE_RE = /\b(debuts?|lists?|listed|listing) (?:on|at|with) (?:nse|bse|nasdaq|nyse|the )|\bdebuts on\b|\bmakes (?:its )?(?:stock market )?debut\b/i;
const NEW_PRODUCT_RE = /\b(?:taps|enters?|forays? into|launch(?:es|ed)?|expands? (?:into|its)|bet on|invests? (?:rs\.?|₹)?[\d,.]+\s*(?:crore|cr)?\s*in)\b.{0,80}\b(?:brand|bar|foods?|segment|market|category|portfolio|boom)\b/i;

export function subtypeHint(title: string): SubtypeHint {
  const t = title || '';
  if (FINANCING_RE.test(t) && !/\b(acquir|merg)/i.test(t)) return 'FINANCING';
  if (PLAN_RE.test(t) && !/\b(acquir|merg|demerg|spin|hive)/i.test(t)) return 'GUIDANCE_PLAN';
  if (LISTING_DONE_RE.test(t) && SPIN_RE.test(t)) return 'LISTING_DONE';
  // A merger is never handled as a demerger. Explicit spin words win only when no merger wording is present.
  const merger = MERGER_RE.test(t);
  const spin = SPIN_RE.test(t);
  if (merger && !spin) return 'MERGER';
  if (merger && spin) return /\b(swap ratio|merger with|to merge|merges? with|amalgamat)/i.test(t) && !/\b(hive|demerg|spin)\w*\s+(?:of|from|its|into)/i.test(t) ? 'MERGER' : 'SPIN';
  if (spin) return 'SPIN';
  if (NEW_PRODUCT_RE.test(t) && !/\b(acquir|merg|stake)\b/i.test(t)) return 'NEW_PRODUCT';
  return null;
}

// ─── 6. Subject / company / ticker ───────────────────────────────────────────
const LEAD_STOP = new Set(['will', 'here', 'how', 'why', 'what', 'when', 'is', 'are', 'can', 'should', 'from', 'after', 'as', 'with', 'the', 'a', 'an', 'new', 'top', 'breaking', 'live', 'watch', 'prediction', 'dividend', 'stock', 'stocks', 'share', 'shares', 'buzzing', 'these', 'this', 'big', 'govt', 'government', 'india', 'indian', 'q1', 'q2', 'q3', 'q4', 'report', 'exclusive', 'explained', 'opinion', 'analysis', 'update', 'results', 'result', 'earnings', 'last', 'check', 'today', 'rs', 'in', 'on', 'for', 'at', 'to', 'of', 'and', 'but', 'maharatna', 'navratna', 'miniratna', 'smallcap', 'midcap', 'largecap', 'multibagger', 'penny']);
const NAME_CONNECT = new Set(['of', 'and', '&', 'the', 'de', 'for']);
const NAME_TAIL_STOP = new Set(['board', 'shares', 'share', 'stock', 'stocks', 'results', 'result', 'merger', 'proposal', 'dividend', 'cmd', 'ceo', 'md', 'q1', 'q2', 'q3', 'q4', 'fy', 'plans', 'may', 'says', 'to']);
export const NOT_IDENTIFIED = 'Not identified';

const isCapWord = (w: string): boolean => /^[A-Z][\w'&.\u2019-]*$/.test(w);

/** Subject noun phrase: leading run of capitalised words up to the verb / event noun. */
export function subjectFromHeadline(title: string): string | null {
  let t = (title || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // SEC style
  const sec = parseSecFilingTitle(t);
  if (sec) return sec.company;
  // Question / lead-in: 'Will IHCL's merger ...' -> 'IHCL's merger ...'
  t = t.replace(/^(?:will|can|should|is|are|does|did|why is|why are|what (?:does|is)|how (?:will|does|did))\s+/i, '');
  if (/^[^A-Za-z]/.test(t) && !/^[A-Z0-9]/.test(t)) return null;
  if (/^\d/.test(t)) return null;
  const words = t.split(' ');
  const run: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw.replace(/[,;:]+$/, '');
    const stem = w.replace(/['\u2019]s$/i, '');
    const bare = /^[A-Z0-9&]{2,}$/.test(stem) ? stem : w; // possessive ends the subject only for acronyms ("IHCL's"), not "Lord's"
    if (!w) break;
    const connector = NAME_CONNECT.has(w.toLowerCase());
    if (!(isCapWord(w) || connector || /^\([A-Za-z.&\s]+\)$/.test(w))) break;
    if (/^\([A-Za-z]/.test(w) && run.length) { run.push(w); if (/[,;:]$/.test(raw)) break; continue; }
    if (run.length === 0 && LEAD_STOP.has(bare.toLowerCase())) return null;
    if (run.length && NAME_TAIL_STOP.has(bare.toLowerCase())) break;
    run.push(bare === w ? w : bare);
    if (bare !== w) break;              // possessive ends the subject
    if (/[,;:]$/.test(raw)) break;
    if (run.length >= 6) break;
  }
  while (run.length && NAME_CONNECT.has(run[run.length - 1].toLowerCase())) run.pop();
  while (run.length && /^\(.*\)$/.test(run[run.length - 1])) run.pop();
  if (!run.length) return null;
  const name = run.join(' ').trim();
  if (name.length < 2) return null;
  if (NON_TICKER_ACRONYMS.has(name.toUpperCase()) && name === name.toUpperCase() && !(name.toUpperCase() in NSE_TICKER_NAMES)) return null;
  return name;
}

const PAREN_EXCH_RE = /\((?:NYSE|NASDAQ|NYSEARCA|AMEX|NSE|BSE|TSX|LSE)\s*[:\s]\s*([A-Z][A-Z0-9.]{0,5})\)/;
const PAREN_TKR_RE = /\(([A-Z]{2,6})\)/;

export interface SubjectIdentity { company: string; ticker: string | null; tickerSource: 'feed' | 'suffix' | 'paren' | 'lead' | 'possessive' | 'master' | null }

const okTicker = (t: string): boolean => /^[A-Z][A-Z0-9&-]{1,9}$/.test(t) && !NON_TICKER_ACRONYMS.has(t.replace(/\.(NS|BO)$/, ''));

/**
 * A ticker is accepted only when (a) the feed supplied one, or (b) it resolves
 * from the SUBJECT of the headline: .NS/.BO suffix, "(TKR)" right after the subject,
 * the leading acronym itself, a possessive acronym ("ITC's"), or the subject name
 * found in the company master. Everything else in the text (lenders, brokers,
 * exchanges, currencies, tribunals, designations) is ignored.
 */
export function identifySubject(args: { title: string; feedTicker?: string | null; isSec?: boolean; explicitName?: string | null }): SubjectIdentity {
  const title = (args.title || '').replace(/\s+/g, ' ').trim();
  const sec = parseSecFilingTitle(title);
  const name = (args.explicitName && args.explicitName.trim()) || (sec ? sec.company : subjectFromHeadline(title));
  const feed = (args.feedTicker || '').trim().toUpperCase();
  if ((args.isSec || sec) ) {
    // EDGAR filer names carry no symbol.
    return { company: name || NOT_IDENTIFIED, ticker: feed && okTicker(feed.replace(/\.(NS|BO)$/, '')) && !sec ? feed : null, tickerSource: feed && !sec ? 'feed' : null };
  }
  const hinted = contentHints(title);
  const suffix = title.match(/\b([A-Z][A-Z0-9&-]+)\.(?:NS|BO)\b/);
  if (suffix && okTicker(suffix[1])) return { company: name || suffix[1], ticker: suffix[1], tickerSource: 'suffix' };
  const exch = title.match(PAREN_EXCH_RE);
  if (exch && okTicker(exch[1]) && title.indexOf(exch[0]) < 90) return { company: name || exch[1], ticker: exch[1], tickerSource: 'paren' };
  const paren = title.match(PAREN_TKR_RE);
  if (paren && okTicker(paren[1]) && title.indexOf(paren[0]) < 70 && !/^\(?(?:india|us|usa)\)?$/i.test(paren[1])) return { company: name || paren[1], ticker: paren[1], tickerSource: 'paren' };

  const first = title.replace(/^(?:will|can|should|is|are)\s+/i, '').split(/[\s,:;]+/)[0] || '';
  const firstBare = first.replace(/['’]s$/i, '');
  const second = (title.replace(/^(?:will|can|should|is|are)\s+/i, '').split(/\s+/)[1] || '').replace(/[,;:]+$/, '');
  if (!hinted.isNonCorporate && /^[A-Z]{3,6}$/.test(firstBare) && okTicker(firstBare) && !LEAD_STOP.has(firstBare.toLowerCase())) {
    // Group prefix followed by another name word ('JSW Cement', 'JSW Dulux') names a different issuer.
    const followedByName = /^[A-Z][a-z]/.test(second) && !/^(?:Q\d|Motor|Green|Share|Stock|Board|Ltd|Limited|India|Industries)$/.test(second);
    if (!(isGroupPrefix(firstBare) && (followedByName || !(firstBare in NSE_TICKER_NAMES)))) {
      return { company: name || firstBare, ticker: firstBare, tickerSource: first !== firstBare ? 'possessive' : 'lead' };
    }
  }
  // Possessive acronym in subject position ("... ITC's ...") when it is the only candidate.
  const poss = Array.from(title.matchAll(/\b([A-Z]{3,6})['’]s\b/g)).map((m) => m[1]).filter(okTicker);
  if (poss.length === 1 && !hinted.isNonCorporate) return { company: name && name !== NOT_IDENTIFIED ? name : poss[0], ticker: poss[0], tickerSource: 'possessive' };
  // Master lookup by the subject name only.
  if (name) {
    const t = resolveCompanyToTicker(name) || resolveCompanyToTicker(name.replace(/\s+(?:Ltd\.?|Limited|Inc\.?|Corp\.?)$/i, ''));
    if (t) return { company: name, ticker: t, tickerSource: 'master' };
  }
  if (feed && okTicker(feed.replace(/\.(NS|BO)$/, ''))) return { company: name || feed, ticker: feed, tickerSource: 'feed' };
  return { company: name || NOT_IDENTIFIED, ticker: null, tickerSource: null };
}

/** Drop-in replacement for the route's bare-caps extractor: zero or one ticker, subject only. */
export function extractSubjectTickers(title: string, description: string | undefined, source?: string, link?: string): string[] {
  if (isSecSource(source, link)) return [];
  const id = identifySubject({ title });
  void description;
  return id.ticker ? [id.ticker] : [];
}

// ─── 7. Dedupe across cards ──────────────────────────────────────────────────
export function publisherFamily(label?: string | null): string {
  const l = (label || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
  if (!l) return 'unknown';
  if (/^(et|economic times)\b/.test(l)) return 'et';
  if (/^(bl|business ?line|the hindu)\b/.test(l)) return 'bl';
  return l.split(/\s+/)[0];
}

const ENTITY_STOP = new Set(['will', 'here', 'what', 'why', 'how', 'the', 'board', 'approves', 'announces', 'says', 'said', 'to', 'of', 'and', 'with', 'its', 'for', 'from', 'by', 'in', 'on', 'at', 'report', 'unlock', 'value', 'shareholders', 'listed', 'arm', 'ratio', 'swap', 'merger', 'merge', 'merges', 'demerger', 'hive', 'off', 'ltd', 'limited', 'inc', 'corp', 'india', 'company', 'group', 'share', 'shares', 'stock', 'stocks', 'itself', 'an', 'a', 'is', 'are', 'be', 'as', 'after', 'amid', 'may', 'could', 'plans', 'new']);
export function entityTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const w of (title || '').replace(/['’]s\b/g, '').split(/[^A-Za-z0-9&]+/)) {
    if (!w || w.length < 3) continue;
    if (!/^[A-Z]/.test(w)) continue;
    const lw = w.toLowerCase();
    if (ENTITY_STOP.has(lw)) continue;
    out.add(lw);
  }
  return out;
}
export function keyNumbers(title: string): Set<string> {
  const out = new Set<string>();
  const t = (title || '').replace(/,/g, '');
  for (const m of t.matchAll(/\b(\d{1,4})\s?:\s?(\d{1,4})\b/g)) out.add(`${m[1]}:${m[2]}`);
  for (const m of t.matchAll(/(?:rs\.?|inr|₹|\$|€)\s?(\d+(?:\.\d+)?)\s*(crore|cr|lakh crore|billion|million|bn|mn)?/gi)) out.add(`${m[1]}${(m[2] || '').toLowerCase().replace('crore', 'cr')}`);
  for (const m of t.matchAll(/\b(\d+(?:\.\d+)?)\s?(mw|gw|mwh)\b/gi)) out.add(`${m[1]}${m[2].toLowerCase()}`);
  return out;
}
export type EventFamily = 'MERGER' | 'SPIN' | 'ACQUISITION' | 'BUYBACK' | 'DIVIDEND' | 'CAPITAL_RAISE' | 'OTHER';
export function eventFamily(title: string, eventType?: string): EventFamily {
  const sub = subtypeHint(title);
  if (sub === 'MERGER') return 'MERGER';
  if (sub === 'SPIN' || sub === 'LISTING_DONE') return 'SPIN';
  const t = `${title} ${(eventType || '').replace(/_/g, ' ')}`;
  if (/\b(acquir|acquisition|takeover|open offer|buys? stake|stake (?:buy|sale))/i.test(t)) return 'ACQUISITION';
  if (/\bbuyback|repurchase/i.test(t)) return 'BUYBACK';
  if (/\bdividend/i.test(t)) return 'DIVIDEND';
  if (/\b(rights issue|warrants?|qip|preferential|ncd|convertible)\b/i.test(t)) return 'CAPITAL_RAISE';
  return 'OTHER';
}

/** True when two headlines describe the same deal (same family, shared entities and/or key numbers). */
export function sameEvent(a: { title: string; eventType?: string }, b: { title: string; eventType?: string }): boolean {
  const fa = eventFamily(a.title, a.eventType), fb = eventFamily(b.title, b.eventType);
  if (fa !== fb || fa === 'OTHER') return false;
  const ea = entityTokens(a.title), eb = entityTokens(b.title);
  let shared = 0;
  ea.forEach((x) => { if (eb.has(x)) shared += 1; });
  const minSize = Math.min(ea.size, eb.size);
  if (!minSize) return false;
  const na = keyNumbers(a.title), nb = keyNumbers(b.title);
  let sharedNum = 0;
  na.forEach((x) => { if (nb.has(x)) sharedNum += 1; });
  if (sharedNum > 0 && shared >= 1) return true;
  return shared >= 2 && shared / minSize >= 0.6;
}

// ─── 8. Count audit helper ───────────────────────────────────────────────────
/** Counts events per coverage type once per canonical event: no Form 10 registrations, no price / preview / analyst / opinion items. */
export function countCanonicalEventTypes(events: ReadonlyArray<{ event_type: string; tier?: string; title?: string; filings?: ReadonlyArray<unknown> }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    if (e.event_type === 'FORM10_REGISTRATION') continue;
    if (e.title) { const h = contentHints(e.title); if (isNonEventContent(h)) continue; }
    out[e.event_type] = (out[e.event_type] || 0) + 1;
  }
  return out;
}

/** Incremental clusterer: maps each item to the id of an earlier item describing the same deal (same family + region). */
export function createEventClusterer() {
  const reps = new Map<string, Array<{ id: string; title: string; eventType?: string; toks: Set<string>; nums: Set<string> }>>();
  return {
    /** Returns an earlier id when the item is the same event, else registers it under `id` and returns `id`. */
    assign(id: string, title: string, region: string, eventType?: string): string {
      const fam = eventFamily(title, eventType);
      if (fam === 'OTHER') return id;
      const key = `${region}|${fam}`;
      const list = reps.get(key) || [];
      const toks = entityTokens(title), nums = keyNumbers(title);
      for (const r of list) {
        let shared = 0;
        toks.forEach((x) => { if (r.toks.has(x)) shared += 1; });
        let sharedNum = 0;
        nums.forEach((x) => { if (r.nums.has(x)) sharedNum += 1; });
        const minSize = Math.min(toks.size, r.toks.size);
        if (!minSize) continue;
        if ((sharedNum > 0 && shared >= 1) || (shared >= 2 && shared / minSize >= 0.6)) return r.id;
      }
      list.push({ id, title, eventType, toks, nums });
      reps.set(key, list);
      return id;
    },
  };
}
