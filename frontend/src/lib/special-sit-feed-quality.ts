// zzz847 - feed-layer quality helpers for Special Situations. Pure, no I/O.
// Central place for: HTML entity decoding, non-ticker denylist, subject / company
// extraction, SEC filing-title parsing, Form 10 registration vs spin-off, content
// hints (price / preview / analyst / opinion), merger-vs-demerger subtype, and
// cross-source duplicate keys. No company is hardcoded; the lists below are
// generic (currencies, exchanges, regulators, brokers, designations, time zones).

import { resolveCompanyToTicker, NSE_TICKER_NAMES } from './nse-ticker-names';
import type { FeedHoldBackReason } from './multibagger-radar-feed-types';

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

export interface SecTitle { form: string; company: string; isAmendment: boolean; /** EDGAR role tag at the end of the title, e.g. 'Subject', 'Filed by', 'Filer'. */ role: string | null }
export function parseSecFilingTitle(title: string): SecTitle | null {
  const m = (title || '').trim().match(SEC_TITLE_RE);
  if (!m) return null;
  const company = m[2].replace(/\s*\(\d{3,10}\)\s*/g, ' ').replace(/\s*\((?:Filer|Subject|Issuer|Filed by|Reporting)[^)]*\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!company) return null;
  const roleM = (title || '').match(/\((Subject|Filed by|Filer|Issuer|Reporting|Filed for)\b[^)]*\)\s*$/i);
  return { form: m[1].toUpperCase().replace(/\s+/g, ' '), company, isAmendment: /\/A$/i.test(m[1]), role: roleM ? roleM[1].toLowerCase() : null };
}

/** EDGAR accession number from a filing link (both the dashed and the 18-digit path form). One filing lists once per party (subject, filed-by) under the same accession. */
export function secAccession(link?: string | null): string | null {
  const l = link || '';
  const a = l.match(/(\d{10}-\d{2}-\d{6})/);
  if (a) return a[1];
  const b = l.match(/\/(\d{18})(?:\/|$|-)/);
  return b ? `${b[1].slice(0, 10)}-${b[1].slice(10, 12)}-${b[1].slice(12)}` : null;
}

export const isForm10Title = (title: string): boolean => /^\s*10-12[BG](?:\/A)?\b/i.test(title || '');

const SPIN_TEXT_RE = /\b(spin[\s-]?co|spin[\s-]?off|spun[\s-]?off|spinoff|split[\s-]?off|separation|carve[\s-]?out|distribution of (?:all |shares |approximately )?(?:of )?(?:the )?(?:outstanding )?(?:shares|common stock)|pro rata distribution|distribut\w+ (?:to|of) (?:its |the )?(?:parent|stockholders|shareholders))\b/i;

/** Form 10-12G/B is a registration of a class of securities. Only SpinCo-style filers / text are spin-offs. */
export function classifyForm10(title: string, description?: string): 'SPIN' | 'REGISTRATION' | null {
  if (!isForm10Title(title)) return null;
  if (SPIN_TEXT_RE.test(`${title} ${description || ''}`)) return 'SPIN';
  // zzz854: Form 10-12B registers a class on an exchange - the spin-off route. A pooled vehicle / partnership filer stays a registration.
  if (/^\s*10-12B/i.test(title || '')) {
    const p = parseSecFilingTitle(title);
    const name = p ? p.company : '';
    if (name && !isFundLikeName(name) && !/\b(?:l\.?p\.?|llc|lllp|trust|fund)\s*\.?$/i.test(name)) return 'SPIN';
  }
  return 'REGISTRATION';
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
const FIN_MOVE_RE = /\b(net profit|profit|pat|revenues?|sales|ebitda|net income|earnings|margins?|net loss|order book)\b[^.,;]{0,25}\b(rises?|rose|falls?|fell|drops?|dropped|jumps?|jumped|surges?|surged|climbs?|gains?|slips?|slides?|declines?|grows?|soars?|tumbles?|plunges?|up|down)\b/i;
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
  // 'Q1 net profit rises 23%' is a results headline, not a price move (zzz852): a financial-statement noun owns the verb and no share-price wording is present.
  const resultsMove = FIN_MOVE_RE.test(t) && !/\b(?:share|stock) price\b|\bshares?\b|\bstocks?\b|\bintraday\b|\b52[- ]week\b/i.test(t);
  const isPriceArticle = !isPreview && !isAnalystTarget && !resultsMove && PRICE_RE.test(t);
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
  // zzz854: '<money> <Proper Name> bet / buyout' is an investment in a named company (acquisition / stake), not a new product.
  if (NEW_PRODUCT_RE.test(t) && !/\b(acquir|merg|stake)\b/i.test(t) && !MONEY_NAME_DEAL_RE.test(t)) return 'NEW_PRODUCT';
  return null;
}

// ─── 6. Subject / company / ticker ───────────────────────────────────────────
const LEAD_STOP = new Set(['will', 'here', 'how', 'why', 'what', 'when', 'is', 'are', 'can', 'should', 'from', 'after', 'as', 'with', 'the', 'a', 'an', 'new', 'top', 'breaking', 'live', 'watch', 'prediction', 'dividend', 'stock', 'stocks', 'share', 'shares', 'buzzing', 'these', 'this', 'big', 'govt', 'government', 'india', 'indian', 'q1', 'q2', 'q3', 'q4', 'report', 'exclusive', 'explained', 'opinion', 'analysis', 'update', 'results', 'result', 'earnings', 'last', 'check', 'today', 'rs', 'in', 'on', 'for', 'at', 'to', 'of', 'and', 'but', 'maharatna', 'navratna', 'miniratna', 'smallcap', 'midcap', 'largecap', 'multibagger', 'penny']);
const NAME_CONNECT = new Set(['of', 'and', '&', 'the', 'de', 'for']);
const NAME_TAIL_STOP = new Set(['board', 'shares', 'share', 'stock', 'stocks', 'results', 'result', 'merger', 'proposal', 'dividend', 'cmd', 'ceo', 'md', 'q1', 'q2', 'q3', 'q4', 'fy', 'plans', 'may', 'says', 'to']);
export const NOT_IDENTIFIED = 'Not identified';

const isCapWord = (w: string): boolean => /^[A-Z][\w'&.\u2019-]*$/.test(w);

/** 'Vedanta Aluminium\u2019s' -> 'Vedanta Aluminium'; strips wrapping quotes and a trailing possessive. */
export function stripPossessiveAndQuotes(name: string): string {
  let n = (name || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const before = n;
    n = n.replace(/^[\u2018\u2019'"\u201c\u201d`]+/, '').replace(/[\u2018\u2019'"\u201c\u201d`]+$/, '').replace(/['\u2019]s$/i, '').replace(/s['\u2019]$/i, (m) => m.slice(0, 1)).trim();
    if (n === before) break;
  }
  return n;
}

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
  const name = stripPossessiveAndQuotes(run.join(' '));
  if (name.length < 2) return null;
  if (NON_TICKER_ACRONYMS.has(name.toUpperCase()) && name === name.toUpperCase() && !(name.toUpperCase() in NSE_TICKER_NAMES)) return null;
  return name;
}

const PAREN_EXCH_RE = /\((?:NYSE|NASDAQ|NYSEARCA|AMEX|NSE|BSE|TSX|LSE)\s*[:\s]\s*([A-Z][A-Z0-9.]{0,5})\)/;
const PAREN_TKR_RE = /\(([A-Z]{2,6})\)/;

export interface SubjectIdentity {
  company: string; ticker: string | null; tickerSource: 'feed' | 'suffix' | 'paren' | 'lead' | 'possessive' | 'master' | 'parent' | null;
  /** The subject is a group / promoter name ('<X> Group'), not one listed issuer. Ticker is null. */
  group?: boolean;
  /** Name of the listed parent when the ticker is the parent's (a subsidiary / brand). Show it as 'via parent'. */
  viaParent?: string | null;
}

// Group / promoter names are not listed issuers. Data, not logic: a name ending in 'Group' (without a corporate
// suffix) or a bare token below is a group. A group name the company master resolves (a real listed 'X Group') is kept.
const GROUP_NAME_RE = /^(.+?)\s+(?:group|conglomerate|family|promoter group|business house)$/i;
export const UNLISTED_GROUP_TOKENS: ReadonlySet<string> = new Set(['RPSG', 'SHAPOORJI', 'MURUGAPPA', 'ESSAR']);
export function isGroupName(name: string | null | undefined): boolean {
  const n = (name || '').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  const bare = n.replace(/\s+group$/i, '');
  if (UNLISTED_GROUP_TOKENS.has(n.toUpperCase()) || UNLISTED_GROUP_TOKENS.has(bare.toUpperCase())) return !resolveCompanyToTicker(n);
  if (!GROUP_NAME_RE.test(n)) return false;
  return !resolveCompanyToTicker(n);
}

/**
 * Subsidiary / brand -> listed parent aliases. DATA ONLY and empty by default: a parent is attached only when an
 * entry says so (or the resolver already maps the exact name). No prefix guessing: 'X Cement' is not 'X'.
 * Entry: match the subsidiary name, give the parent's name (resolved through the master) and optionally its ticker.
 */
export interface SubsidiaryAlias { match: RegExp; parent: string; parentTicker?: string }
export const SUBSIDIARY_PARENT_ALIASES: ReadonlyArray<SubsidiaryAlias> = [];
export function resolveViaParent(name: string, aliases: ReadonlyArray<SubsidiaryAlias> = SUBSIDIARY_PARENT_ALIASES): { ticker: string; parent: string } | null {
  for (const a of aliases) {
    if (!a.match.test(name)) continue;
    const t = resolveCompanyToTicker(a.parent) || (a.parentTicker && okTicker(a.parentTicker.toUpperCase()) ? a.parentTicker.toUpperCase() : undefined);
    if (t) return { ticker: t, parent: a.parent };
  }
  return null;
}

const okTicker = (t: string): boolean => /^[A-Z][A-Z0-9&-]{1,9}$/.test(t) && !NON_TICKER_ACRONYMS.has(t.replace(/\.(NS|BO)$/, ''));

/**
 * A ticker is accepted only when (a) the feed supplied one, or (b) it resolves
 * from the SUBJECT of the headline: .NS/.BO suffix, "(TKR)" right after the subject,
 * the leading acronym itself, a possessive acronym ("ITC's"), or the subject name
 * found in the company master. Everything else in the text (lenders, brokers,
 * exchanges, currencies, tribunals, designations) is ignored.
 */
export function identifySubject(args: { title: string; feedTicker?: string | null; isSec?: boolean; explicitName?: string | null; subsidiaryAliases?: ReadonlyArray<SubsidiaryAlias> }): SubjectIdentity {
  const id = identifySubjectCore(args);
  // A group / promoter name is never a listed ticker; only an explicit exchange tag in the headline survives.
  const grp = isGroupName(id.company) || (id.ticker != null && UNLISTED_GROUP_TOKENS.has(id.ticker.toUpperCase()) && !(id.ticker.toUpperCase() in NSE_TICKER_NAMES));
  if (grp && id.tickerSource !== 'suffix' && id.tickerSource !== 'paren') return { company: id.company, ticker: null, tickerSource: null, group: true, viaParent: null };
  return id;
}

function identifySubjectCore(args: { title: string; feedTicker?: string | null; isSec?: boolean; explicitName?: string | null; subsidiaryAliases?: ReadonlyArray<SubsidiaryAlias> }): SubjectIdentity {
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
    const par = resolveViaParent(name, args.subsidiaryAliases);
    if (par) return { company: name, ticker: par.ticker, tickerSource: 'parent', viaParent: par.parent };
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
const UNIT_NORM: Record<string, string> = { crore: 'cr', crores: 'cr', cr: 'cr', 'lakh crore': 'lakhcr', billion: 'bn', bn: 'bn', million: 'mn', mn: 'mn' };
export function keyNumbers(title: string): Set<string> {
  const out = new Set<string>();
  const t = (title || '').replace(/(\d),(?=\d{3}\b)/g, '$1');
  for (const m of t.matchAll(/\b(\d{1,4})\s?:\s?(\d{1,4})\b/g)) out.add(`${m[1]}:${m[2]}`);
  for (const m of t.matchAll(/(?:rs\.?|inr|\u20b9|\$|us\$|usd|\u20ac|eur|\u00a3|gbp|cad)\s?(\d+(?:\.\d+)?)\s*(lakh crores?|crores?|cr|billion|million|bn|mn)?\b/gi)) {
    const u = (m[2] || '').toLowerCase().replace(/crores$/, 'crore').replace(/lakh crores$/, 'lakh crore');
    out.add(`${m[1]}${UNIT_NORM[u] || u}`);
  }
  for (const m of t.matchAll(/\b(\d+(?:\.\d+)?)\s?(mw|gw|mwh)\b/gi)) out.add(`${m[1]}${m[2].toLowerCase()}`);
  return out;
}
export type EventFamily = 'MERGER' | 'SPIN' | 'ACQUISITION' | 'BUYBACK' | 'DIVIDEND' | 'CAPITAL_RAISE' | 'OTHER';
/** '<Acquirer>'s Rs 900 cr <Target Name> bet / buyout / takeover': money + a mixed-case proper name + a deal noun (not 'bet on ...'). */
export const MONEY_NAME_DEAL_RE = /(?:[Rr][Ss]\.?|\u20b9|INR|US\$|\$|\u20ac|\u00a3)\s?[\d,.]+\s?(?:[Ll]akh [Cc]rores?|[Cc]rores?|[Cc]r|[Mm]illion|mn|[Bb]illion|bn)?\s+((?:[A-Z][a-z][\w&.'\u2019-]*\s){1,4})(?:[Bb]et|[Bb]uyout|[Tt]akeover|[Aa]cquisition|[Ss]take buy)\b(?!\s+on\b)/;
export function eventFamily(title: string, eventType?: string): EventFamily {
  if (MONEY_NAME_DEAL_RE.test(title || '')) return 'ACQUISITION';
  const sub = subtypeHint(title);
  if (sub === 'MERGER') return 'MERGER';
  if (sub === 'SPIN' || sub === 'LISTING_DONE') return 'SPIN';
  const t = `${title} ${(eventType || '').replace(/_/g, ' ')}`;
  if (/\b(acquir|acquisition|takeover|open offer|buys? stake|stake (?:buy|sale))/i.test(t) || (/\b(?:buys?(?!\s*-?back)|bought|snaps up|picks up|agrees? to buy)\s+[A-Z\u20b9$]/.test(t) && !/\bstocks?\s+to\s+buy\b/i.test(t))) return 'ACQUISITION';
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
  const reps = new Map<string, Array<{ id: string; title: string; eventType?: string; toks: Set<string>; nums: Set<string>; canon: CanonicalEventKey; acc: string | null }>>();
  return {
    /** Returns an earlier id when the item is the same event, else registers it under `id` and returns `id`. */
    assign(id: string, title: string, region: string, eventType?: string, extra?: { link?: string; pubDate?: string | null }): string {
      const fam = eventFamily(title, eventType);
      const acc = secAccession(extra?.link);
      const canon = canonicalEventKey({ title, eventType, pubDate: extra?.pubDate });
      // One SEC filing lists once per party (subject / filed-by) under the same accession: always one event.
      if (acc) for (const list of reps.values()) for (const r of list) if (r.acc === acc) return r.id;
      if (fam === 'OTHER') { if (acc) { const k = `${region}|OTHER`; const l = reps.get(k) || []; l.push({ id, title, eventType, toks: new Set(), nums: new Set(), canon, acc }); reps.set(k, l); } return id; }
      const key = `${region}|${fam}`;
      const list = reps.get(key) || [];
      const toks = entityTokens(title), nums = keyNumbers(title);
      for (const r of list) {
        if (sameCanonicalEvent(canon, r.canon)) return r.id;
        let shared = 0;
        toks.forEach((x) => { if (r.toks.has(x)) shared += 1; });
        let sharedNum = 0;
        nums.forEach((x) => { if (r.nums.has(x)) sharedNum += 1; });
        const minSize = Math.min(toks.size, r.toks.size);
        if (!minSize) continue;
        if ((sharedNum > 0 && shared >= 1) || (shared >= 2 && shared / minSize >= 0.6)) return r.id;
      }
      list.push({ id, title, eventType, toks, nums, canon, acc });
      reps.set(key, list);
      return id;
    },
  };
}

// ─── 9. Canonical event key (company + event type + amount + date window) ────
const LEGAL_SUFFIX = /\b(?:ltd|limited|inc|incorporated|corp|corporation|plc|llc|co|company|nv|sa|ag)\b\.?/gi;
const normSubject = (s: string): string => (s || '').toLowerCase().replace(/['\u2019]s\b/g, '').replace(LEGAL_SUFFIX, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export interface CanonicalEventKey { subject: string; family: EventFamily; amounts: string[]; ts: number | null; key: string }
export function canonicalEventKey(a: { title: string; eventType?: string; pubDate?: string | null }): CanonicalEventKey {
  const subject = normSubject(subjectFromHeadline(decodeHtmlEntities(a.title || '')) || '');
  const family = eventFamily(a.title, a.eventType);
  const amounts = Array.from(keyNumbers(a.title)).filter((x) => !x.includes(':')).sort();
  const t = a.pubDate ? Date.parse(a.pubDate) : NaN;
  return { subject, family, amounts, ts: Number.isNaN(t) ? null : t, key: `${family}|${subject}|${amounts[0] || ''}` };
}
/** Same company + same event family + compatible amount + within the date window. Syndicated copies (ET / Moneycontrol / Mint) of one story merge. */
export function sameCanonicalEvent(a: CanonicalEventKey, b: CanonicalEventKey, windowHours = 72): boolean {
  if (a.family === 'OTHER' || a.family !== b.family) return false;
  if (!a.subject || !b.subject) return false;
  const ta = a.subject.split(' '), tb = b.subject.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (!short.every((w, i) => long[i] === w)) return false;
  if (a.amounts.length && b.amounts.length && !a.amounts.some((x) => b.amounts.includes(x))) return false;
  if (a.ts != null && b.ts != null && Math.abs(a.ts - b.ts) > windowHours * 3600000) return false;
  return true;
}

// ─── 10. Held back from Special Situations (pooled vehicles, partnership units, debt / routine issuer tenders) ──
// zzz854: one reason per item; counts are kept per reason. Classification lives in special-sit-security.ts (classifyFeedHoldBack).
export type FeedQuarantineReason = FeedHoldBackReason;
export const FEED_QUARANTINE_LABEL: Record<FeedQuarantineReason, string> = {
  FUND_REPURCHASE_OFFER: 'Fund repurchase offer: a periodic tender by a pooled investment vehicle (interval fund, BDC, feeder, private credit, non-traded REIT), not an equity special situation',
  PARTNERSHIP_UNIT_REPURCHASE: 'Partnership / LLC unit repurchase: interests in an LP, LLLP or LLC, not listed common equity',
  DEBT_TENDER: 'Debt tender offer: the offer is for notes or bonds, not equity',
  ROUTINE_ISSUER_TENDER: 'Routine issuer tender (employee / option exchange, odd-lot or periodic), not an equity special situation',
  ISSUER_TENDER_TERMS_NOT_READ: 'Issuer tender — terms not read (could be odd-lot, employee or debt)',
  EXCLUDED_FROM_EQUITY_RADAR: 'Not an equity special situation (regulator, court, unlisted or unidentified entity)',
  AWAITING_VERIFICATION: 'Awaiting verification: not confirmed from the primary document yet',
  AI_CONTRADICTED: 'Removed: the primary document contradicts the headline',
};
/** BDC / private-credit vehicle names: a name ENDING in Capital / Lending / Credit / Income (+ corporate suffix, optional series). Only meaningful with an SEC tender form. */
export const BDC_STYLE_NAME_RE = /\b(?:capital|lending|credit|income)(?:\s+(?:corp(?:oration)?|co|company|fund|trust))?\.?(?:\s*,?\s*(?:inc|llc|l\.?p)\.?)?(?:\s+(?:i{1,3}|iv|v|vi|\d))?\s*$/i;
/** Private-credit / non-traded vehicle wording in a name. Only meaningful with an SEC tender form. */
export const CREDIT_VEHICLE_NAME_RE = /\b(lending solutions|strategic lending|credit strateg\w*|lower middle[- ]market|middle[- ]market (?:capital|lending|credit|income)|direct lending|private credit|specialty lending|senior lending|credit (?:company|co)\b|income (?:corp|corporation)\b|technology income|real estate income|non[- ]traded)\b/i;
const ISSUER_TENDER_FORM_RE = /\bSC\s*TO-I(?:\/A)?\b/i;
const TENDER_TEXT_RE = /\b(tender offer|repurchase offer|offer to (?:purchase|repurchase)|periodic repurchase|issuer tender)\b/i;
// Name / text patterns are data. Strong: a pooled-vehicle word. Credit-style: only with an issuer tender form.
const FUND_NAME_STRONG_RE = /\b(funds?|trusts?(?!\s+(?:bancorp|bancshares|company|co\b|bank|financial))|bdc|feeder|interval|evergreen|hedge|private (?:credit|equity|markets?|assets?|debt|lending)|multi[- ]?(?:alpha|strategy|manager|asset)|structured credit|floating rate|portfolio solutions?|master (?:fund|llc)|offshore|alternative (?:access|income|investments?|strategies)|l\.?p\.?)\s*(?:,|\.|$|\b)/i;
const FUND_NAME_CREDIT_RE = /\b(credit (?:solutions|opportunit\w+|strategies|income|fund)|senior (?:loan|secured)|direct lending|lending (?:fund|partners)|income (?:fund|partners|opportunit\w+)|real (?:assets|estate income)|infrastructure income|alternative (?:credit|income))\b/i;
const OPERATING_GUARD_RE = /\b(bancorp|bancshares|bankshares|bank\b|savings|insurance|industries|technologies|pharma\w*|holdings? (?:ltd|inc))\b/i;
const INVESTMENT_COMPANY_HINT_RE = /\binvestment company act\b|\bN-2\b|\b1940 act\b|\bclosed-end (?:management )?(?:investment )?(?:company|fund)\b|\binterval fund\b|\bbusiness development company\b|\bBDC\b|\bnet asset value\b|\bNAV\b|\bfeeder fund\b|\bmaster fund\b|\b(?:LLC|limited liability company) (?:interests|units)\b|\bshares of beneficial interest\b|\bregistered under the investment company\b/i;

export function isFundRepurchaseOffer(a: { title?: string; description?: string; source?: string; company?: string | null; eventType?: string }): boolean {
  const title = decodeHtmlEntities(a.title || '');
  const desc = decodeHtmlEntities(a.description || '');
  const issuerForm = ISSUER_TENDER_FORM_RE.test(`${title} ${a.source || ''}`);
  const tenderish = issuerForm || TENDER_TEXT_RE.test(title) || /\brepurchase|tender/i.test(a.eventType || '');
  if (!tenderish) return false;
  const sec = parseSecFilingTitle(title);
  const name = (a.company || (sec ? sec.company : subjectFromHeadline(title)) || '').trim();
  const hint = INVESTMENT_COMPANY_HINT_RE.test(`${title} ${desc}`);
  if (hint && (issuerForm || FUND_NAME_STRONG_RE.test(name) || FUND_NAME_CREDIT_RE.test(name))) return true;
  if (FUND_NAME_STRONG_RE.test(name) && !OPERATING_GUARD_RE.test(name)) return true;
  if (issuerForm && FUND_NAME_CREDIT_RE.test(name)) return true;
  // zzz854: BDC / private-credit vehicles ('<X> Capital Corp', '<X> Lending Solutions LLC', '<X> Income Corp') in an issuer tender.
  if (issuerForm && (CREDIT_VEHICLE_NAME_RE.test(name) || (BDC_STYLE_NAME_RE.test(name) && !/\b(?:bank|bancorp|bancshares|insurance)\b/i.test(name)))) return true;
  return false;
}

export interface HeldBackSummary {
  total: number;
  byReason: Partial<Record<FeedQuarantineReason, number>>;
  line: string;
  examples: string[];
  /** zzz854: per reason, label + count + up to 5 example names (largest count first) */
  reasons?: Array<{ reason: FeedQuarantineReason; label: string; count: number; examples: string[] }>;
}
/** Visible 'held back' line for items kept out of the main list. One reason per item; the per-reason counts sum to total. */
export function summariseHeldBack(items: ReadonlyArray<{ reason: FeedQuarantineReason; name?: string }>): HeldBackSummary {
  const byReason: Partial<Record<FeedQuarantineReason, number>> = {};
  const ex: Partial<Record<FeedQuarantineReason, string[]>> = {};
  for (const i of items) {
    byReason[i.reason] = (byReason[i.reason] || 0) + 1;
    const l = (ex[i.reason] = ex[i.reason] || []);
    if (i.name && l.length < 5 && !l.includes(i.name)) l.push(i.name);
  }
  const order = (Object.keys(byReason) as FeedQuarantineReason[]).sort((a, b) => (byReason[b] || 0) - (byReason[a] || 0));
  const parts = order.map((r) => `${byReason[r]} held back: ${FEED_QUARANTINE_LABEL[r] || r}`);
  const reasons = order.map((r) => ({ reason: r, label: FEED_QUARANTINE_LABEL[r] || r, count: byReason[r] || 0, examples: ex[r] || [] }));
  return { total: items.length, byReason, line: parts.join('; '), examples: items.map((i) => i.name || '').filter(Boolean).slice(0, 5), reasons };
}

// ─── 11. 13E-3 legal boilerplate and price-reaction wording ──────────────────
export const is13e3Text = (form?: string | null, text?: string): boolean => /13E-?3/i.test(form || '') || /\brule\s*13e-?3\b|\bschedule\s*13e-?3\b/i.test(text || '');
const PCT_RE = /\b\d{1,3}(?:\.\d+)?\s?%/g;
/** In SC 13E-3 text a bare percentage (for example '40%') is a legal-boilerplate figure, never a deal amount. */
export function legalBoilerplatePercents(text: string): string[] { return Array.from(new Set((text || '').match(PCT_RE) || [])).map((x) => x.trim()); }
export function stripLegalBoilerplatePercents(text: string): string {
  return (text || '').replace(PCT_RE, ' ').replace(/\s+([,.;])/g, '$1').replace(/\s+/g, ' ').trim();
}

const PRICE_PHRASE_RE = /\b(?:hits?|hit|touch(?:es|ed)?|scal(?:es|ed)|reach(?:es|ed)|trade[sd]? at|at)\s+(?:a\s+)?(?:fresh\s+)?(?:all[- ]time high|record high|52[- ]week high|lifetime high|multi[- ]year high|upper circuit|lower circuit)\b|\b(?:all[- ]time high|record high|52[- ]week high|lifetime high)\b/gi;
/** Share-price reaction wording ('hits all-time high'). Context only: the adapter hands these spans to the radar as non-evidence. */
export function priceReactionSpans(text: string): string[] { return Array.from(new Set((text || '').match(PRICE_PHRASE_RE) || [])).map((x) => x.trim()); }

// ─── 12. zzz852: name-level fund / regulator / court checks (data patterns, shared with the entity resolver) ──
/** A pooled investment vehicle by name alone (fund, trust, BDC, LP ...). Operating-company words (bank, bancorp ...) veto. */
export function isFundLikeName(name: string | null | undefined): boolean {
  const n = (name || '').trim();
  if (!n) return false;
  if (OPERATING_GUARD_RE.test(n)) return false;
  return FUND_NAME_STRONG_RE.test(n) || FUND_NAME_CREDIT_RE.test(n);
}
