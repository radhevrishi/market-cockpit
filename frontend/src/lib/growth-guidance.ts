// zzz846 — GROWTH GUIDANCE engine. Pure, deterministic, NO AI, NO network, NO composite number.
// Never invents a number: an absolute target only becomes a growth % when a base is supplied (labelled IMPLIED).
// Research only: no BUY/SELL wording. Holdings are never read here (portfolio.held is always false).
import type {
  GgMarket, GgMetric, GgKind, GgVerification, GgPeriodKind, GgOrganic, GgQuality, GgValidity, GgTracking, GgRevision, GgOutcome,
  GgExpectations, GgInflection, GgMap2x2, GgCapBand, GgCatalyst, GgLeverage, GgRerating, GgAlertKind, GgSort, GgSourceRef,
  GgGuidancePoint, GgLedgerRow, GgCredibility, GgChainStep, GgReality, GgEarnings, GgValuation, GgSurprise, GgConflict, GgCompany,
} from './growth-guidance-types';
import type { GuCandidate } from './guidance-upgrades-types';

export const GG_ENGINE_VERSION = 'zzz846-gg-v1';
export const QUARTERLY_TIMING_DEFAULT = 'Quarterly timing cannot be reliably inferred from available evidence.';
export const DRIVER_NOT_STATED = 'Management has not stated the driver in the source found';
export const DATA_UNAVAILABLE = 'DATA UNAVAILABLE';
const DAY = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = (s: string) => parseFloat(String(s).replace(/,/g, ''));

// ── units ────────────────────────────────────────────────────────────────────────────────────
export function normaliseAmount(value: number, scaleWord: string, cur: string | null, market: 'IN' | 'US'): { value: number; unit: string; currency: string } | null {
  if (!Number.isFinite(value)) return null;
  const sw = scaleWord.toLowerCase().replace(/\s+/g, ' ');
  let currency = cur ? (/₹|rs|inr/i.test(cur) ? 'INR' : /€|eur/i.test(cur) ? 'EUR' : /£|gbp/i.test(cur) ? 'GBP' : 'USD') : (/crore|lakh|\bcr\b/.test(sw) ? 'INR' : market === 'IN' ? 'INR' : 'USD');
  let v: number;
  if (/^lakh crores?$|^lakh cr$/.test(sw)) { v = value * 100_000; currency = 'INR'; }          // crore
  else if (/^crores?$|^cr$/.test(sw)) { v = value; currency = 'INR'; }
  else if (/^lakhs?$/.test(sw)) { v = value / 100; currency = 'INR'; }
  else if (/^(million|mn|m)$/.test(sw)) v = currency === 'INR' ? value / 10 : value;           // INR million -> crore ; else millions
  else if (/^(billion|bn|b)$/.test(sw)) v = currency === 'INR' ? value * 100 : value * 1000;
  else return null;
  return currency === 'INR' ? { value: v, unit: '₹ Cr', currency } : { value: v, unit: currency === 'USD' ? '$M' : `${currency} M`, currency };
}

// ── source hierarchy (1 strongest … 12 weakest). Rank <= 6 is the company's own document ─────────
export const SOURCE_RANKS: Record<number, string> = {
  1: 'Regulatory / exchange filing', 2: 'Earnings release', 3: 'Investor presentation', 4: 'Concall transcript', 5: 'Annual report / AGM',
  6: 'Company press release / IR', 7: 'On-record management interview', 8: 'Tier-1 financial news', 9: 'Broker / analyst report', 10: 'Other news / aggregator',
  11: 'Blog / forum', 12: 'Social media',
};
const SOCIAL_RE = /\b(twitter|x\.com|reddit|telegram|whatsapp|stocktwits|youtube|facebook|instagram|discord|tweet)\b/i;
const BLOG_RE = /\b(blog|substack|medium\.com|seeking ?alpha|forum|valuepickr|tradingview ideas|quora)\b/i;
const TIER1_RE = /\b(reuters|bloomberg|economic times|business standard|mint|livemint|moneycontrol|financial express|the hindu|wsj|wall street journal|cnbc|ft\.com|financial times|barron|marketwatch|yahoo finance)\b/i;
const BROKER_RE = /\b(brokerage|broker|research|securities|equity research|motilal|kotak institutional|jefferies|goldman|morgan stanley|citi|nomura|ambit|icici sec|hdfc sec)\b/i;

export function sourceRefOf(c: GuCandidate): GgSourceRef {
  const name = clean(c.sourceName || 'Unknown');
  const hay = `${c.title} ${name}`;
  const date = c.publishedAt ? String(c.publishedAt).slice(0, 10) : null;
  const mk = (rank: number, type: string): GgSourceRef => ({ name, rank, type, date, url: c.url, primary: rank <= 6 });
  if (c.kind === 'TRANSCRIPT' || /transcript/i.test(c.title)) return mk(4, 'Concall transcript');
  if (c.kind === 'DECK' || /investor presentation|earnings presentation|\bdeck\b/i.test(c.title)) return mk(3, 'Investor presentation');
  if (c.kind === 'FILING') {
    if (/\bAGM\b|annual general|annual report/i.test(c.title)) return mk(5, 'Annual report / AGM');
    if (/press release|media release|earnings release|results/i.test(hay)) return mk(2, 'Earnings release');
    return mk(1, /sec\b|8-k/i.test(name) ? 'SEC filing' : 'Exchange filing');
  }
  if (c.kind === 'RELEASE') return /sec\.gov|sec 8-k/i.test(`${c.url || ''} ${name}`) ? mk(2, 'Earnings release') : mk(6, 'Company press release (wire)');
  if (c.kind === 'OTHER') return mk(10, 'Cache row (no source link)');
  if (SOCIAL_RE.test(hay) || SOCIAL_RE.test(c.url || '')) return mk(12, 'Social media');
  if (BLOG_RE.test(hay) || BLOG_RE.test(c.url || '')) return mk(11, 'Blog / forum');
  if (BROKER_RE.test(name) && !TIER1_RE.test(name)) return mk(9, 'Broker / analyst report');
  if (TIER1_RE.test(name) || TIER1_RE.test(c.url || '')) return mk(8, 'Tier-1 financial news');
  return mk(10, 'Other news / aggregator');
}

// ── periods ──────────────────────────────────────────────────────────────────────────────────
export interface PeriodInfo { period: string; kind: GgPeriodKind; end: Date | null; cumulativeYears?: number | null }
const yy = (s: string) => { const n = parseInt(s, 10); return s.length <= 2 ? 2000 + n : n; };
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 23, 59, 59));
const short = (y: number) => String(y).slice(2);
/** Indian FY ends 31 Mar of its named year. US / unstated: fiscal year treated as calendar year (ends 31 Dec) unless stated. */
export function fyEnd(year: number, market: 'IN' | 'US'): Date { return market === 'IN' ? utc(year, 2, 31) : utc(year, 11, 31); }
export function quarterEnd(q: number, year: number, market: 'IN' | 'US'): Date {
  if (market === 'IN') return q === 1 ? utc(year - 1, 5, 30) : q === 2 ? utc(year - 1, 8, 30) : q === 3 ? utc(year - 1, 11, 31) : utc(year, 2, 31);
  return [utc(year, 2, 31), utc(year, 5, 30), utc(year, 8, 30), utc(year, 11, 31)][q - 1];
}
export function currentFyYear(now: Date, market: 'IN' | 'US'): number {
  return market === 'IN' ? (now.getUTCMonth() >= 3 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()) : now.getUTCFullYear();
}
const ROLLING_RE = /(?:next|coming|following|forward)\s*(?:12|twelve)\s*months?|\bNTM\b|rolling\s*(?:12|twelve)[- ]months?|(?:12|twelve)[- ]months? (?:ahead|forward)/i;

export function periodOf(sentence: string, fullText: string, pub: Date, market: 'IN' | 'US', cagr: boolean, matchIdx: number): PeriodInfo {
  const s = sentence;
  const m1 = /\bFY\s?'?(\d{2,4})\s*(?:-|–|—|to)\s*(?:FY\s?)?'?(\d{2,4})\b/i.exec(s);
  if (m1) {
    const a = yy(m1[1]); const b = yy(m1[2]);
    if (cagr || b > a + 1 || (b <= a && false)) return { period: `FY${short(a)}–${short(b)}`, kind: 'MULTI_YEAR_CAGR', end: fyEnd(b, market) };
    return { period: `FY${short(b)}`, kind: 'FY', end: fyEnd(b, market) };   // 'FY2026-27' names FY27
  }
  const ny = /\bover\s+(?:the\s+)?(?:next|coming)\s+(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s*years?\b/i.exec(s);
  if (ny) {
    const n1 = parseInt(ny[1], 10); const n2 = ny[2] ? parseInt(ny[2], 10) : n1; const hi = Math.max(n1, n2);
    const label = n1 === n2 ? `Next ${n1} years` : `Next ${Math.min(n1, n2)}–${hi} years`;
    return { period: cagr ? label : `${label} (yearly vs cumulative not stated)`, kind: cagr ? 'MULTI_YEAR_CAGR' : 'UNKNOWN', end: new Date(pub.getTime() + hi * 365 * DAY) };
  }
  if (ROLLING_RE.test(s)) return { period: 'Next 12 months', kind: 'ROLLING_12M', end: new Date(pub.getTime() + 365 * DAY) };
  const mq = /\b(?:Q([1-4])|(first|second|third|fourth) quarter)\b\s*(?:of\s*)?(?:FY\s?'?(\d{2,4})|CY\s?'?(\d{2,4})|'(\d{2})\b)?/i.exec(s);
  if (mq) {
    const q = mq[1] ? parseInt(mq[1], 10) : ({ first: 1, second: 2, third: 3, fourth: 4 } as any)[mq[2].toLowerCase()];
    const yr = mq[3] ? yy(mq[3]) : mq[4] ? yy(mq[4]) : mq[5] ? yy(mq[5]) : null;
    const fy = yr ?? (/\bFY\s?'?(\d{2,4})\b/i.exec(fullText) ? yy(/\bFY\s?'?(\d{2,4})\b/i.exec(fullText)![1]) : null);
    if (fy) return { period: `Q${q} ${mq[4] ? 'CY' : 'FY'}${short(fy)}`, kind: 'QUARTER', end: quarterEnd(q, fy, market) };
    return { period: `Q${q} (year not stated)`, kind: 'QUARTER', end: null };
  }
  const mh = /\b(?:H([12])|(first|second) half)\b\s*(?:of\s*)?(?:FY\s?'?(\d{2,4}))?/i.exec(s);
  if (mh) {
    const h = mh[1] ? parseInt(mh[1], 10) : mh[2].toLowerCase() === 'first' ? 1 : 2;
    const fy = mh[3] ? yy(mh[3]) : null;
    if (fy) return { period: `H${h} FY${short(fy)}`, kind: 'HALF', end: quarterEnd(h === 1 ? 2 : 4, fy, market) };
    return { period: `H${h} (year not stated)`, kind: 'HALF', end: null };
  }
  const fyAll = Array.from(s.matchAll(/\bFY\s?'?(\d{4}|\d{2})\b|\bfiscal(?: year)?\s*'?(\d{4})\b|\bfinancial year\s*'?(\d{4})\b/gi));
  const cyAll = Array.from(s.matchAll(/\bCY\s?'?(\d{4}|\d{2})\b|\bcalendar (?:year )?(\d{4})\b/gi));
  const pick = (arr: RegExpMatchArray[]) => arr.slice().sort((a, b) => Math.abs((a.index ?? 0) - matchIdx) - Math.abs((b.index ?? 0) - matchIdx))[0];
  if (fyAll.length) {
    const m = pick(fyAll); const y = yy(m[1] || m[2] || m[3]);
    const before = s.slice(Math.max(0, (m.index ?? 0) - 25), m.index ?? 0);
    const cur = currentFyYear(pub, market);
    const cum = /\b(?:by|over|within|through|until|till)\s*$/i.test(before) && y - cur + 1 > 1 ? y - cur + 1 : null;
    return { period: `FY${short(y)}`, kind: 'FY', end: fyEnd(y, market), cumulativeYears: cum };
  }
  if (cyAll.length) { const m = pick(cyAll); const y = yy(m[1] || m[2]); return { period: `CY${short(y)}`, kind: 'CY', end: utc(y, 11, 31) }; }
  if (market === 'US') { const b = /\b(?:in|for|during|by|through)\s+(20\d{2})\b/i.exec(s); if (b) { const y = parseInt(b[1], 10); return { period: `CY${short(y)}`, kind: 'CY', end: utc(y, 11, 31) }; } }
  // text-wide fallback: one unambiguous FY token and no rolling wording anywhere
  if (!ROLLING_RE.test(fullText)) {
    const all = Array.from(new Set(Array.from(fullText.matchAll(/\bFY\s?'?(\d{4}|\d{2})\b/gi)).map((m) => yy(m[1]))));
    if (all.length === 1) return { period: `FY${short(all[0])}`, kind: 'FY', end: fyEnd(all[0], market) };
  }
  return { period: 'Period not stated', kind: 'UNKNOWN', end: null };
}

// ── extraction ───────────────────────────────────────────────────────────────────────────────
export interface ExPoint {
  point: GgGuidancePoint; cand: GuCandidate; src: GgSourceRef; hist: boolean; fp: string; end: Date | null;
  mgmtVoice: boolean; fromLedger?: boolean; docId: string; announcedAt: string;
}
const MENTION_RE = /(?<fcf>\bfree cash flows?\b|\bFCF\b)|(?<ebitda>\bEBITDA\b|\boperating profit\b|\boperating income\b|\bEBIT\b)|(?<eps>\bEPS\b|\bearnings per share\b)|(?<pat>\bPAT\b|\bnet profit\b|\bprofit after tax\b|\bnet income\b|\bbottom[- ]?line\b|\bprofits?\b)|(?<rev>\brevenues?\b|\bsales\b|\bturnover\b|\btop[- ]?line\b)/gi;
interface Mention { metric: GgMetric; start: number; end: number; margin: boolean }
function mentionsOf(s: string): Mention[] {
  const out: Mention[] = [];
  for (const m of s.matchAll(MENTION_RE)) {
    const g = m.groups || {};
    const metric: GgMetric = g.fcf ? 'FCF' : g.ebitda ? 'EBITDA' : g.eps ? 'EPS' : g.pat ? 'PAT' : 'REVENUE';
    const end = (m.index ?? 0) + m[0].length;
    const margin = /^\s*(?:(?:operating|net|gross|profit)\s+)?margins?\b/i.test(s.slice(end, end + 25));
    out.push({ metric, start: m.index ?? 0, end, margin });
  }
  return out;
}
const VAL = String.raw`(\d+(?:\.\d+)?)\s*(?:%|percent\b|per\s*cent\b)?\s*(?:(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(?:%|percent\b|per\s*cent\b))?`;
const MOD = String.raw`(?:\s+(around|about|approximately|approx\.?|nearly|almost|over|more than|at least|upto|up to|close to|in excess of|minimum of|~))?`;
const GROW_VERB = String.raw`(?:grow\w*|growth|increas\w+|rise|rising|rises|expand\w*|jump\w*|improv\w+|up|surge\w*|climb\w*|scal\w+|gain\w*|uptick)`;
const LINK = String.raw`(?:\s+(?:in|of|by|at|to|with))*`;
const PAT_A = new RegExp(String.raw`\b${GROW_VERB}\b${LINK}${MOD}\s*${VAL}`, 'gi');
const PAT_B = new RegExp(String.raw`(?:(around|about|approximately|over|more than|at least|nearly)\s+)?${VAL}\s*(?:yoy|y-o-y|year[- ]on[- ]year|annual|annualised|annualized)?\s*(?:revenue |sales |profit |PAT |EBITDA |EPS |top[- ]?line |bottom[- ]?line |net profit )?(growth|increase|rise|jump|expansion|uptick|improvement|CAGR)\b`, 'gi');
const PAT_C = new RegExp(String.raw`\b(?:CAGR|compound(?:ed)? annual growth(?: rate)?)\b\s*(?:of|at)?${MOD}\s*${VAL}`, 'gi');
const PAT_X = /\b(?:grow\w*|scale|expand\w*|increas\w+|reach|achiev\w+|deliver)\b[^.;]{0,25}?(\d+(?:\.\d+)?)\s*(?:x|times)\b/gi;
const PAT_MULT = /\b(doubl(?:e|es|ed|ing)|tripl(?:e|es|ed|ing)|two[- ]?fold|three[- ]?fold|2x|3x)\b(?![- ]?digit)/gi;
const CUR = String.raw`(?:₹|Rs\.?|INR|US\$|\$|USD)`;
const SCALE = String.raw`(lakh\s+crores?|lakh\s+cr|crores?|cr|lakhs?|million|billion|bn|mn)\b`;
const ABS_RE = new RegExp(String.raw`(?:revenues?|sales|turnover|top[- ]?line|PAT|net profit|profit after tax|net income|EBITDA|operating profit|profits?|FCF|free cash flows?|EPS)\b[^.;]{0,50}?\b(?:of|to|at|target(?:ed|s)?|reach|touch|cross|exceed|surpass|be|around|about|approximately|over|between)\s*(${CUR})?\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(${CUR})?\s*(\d[\d,]*(?:\.\d+)?))?\s*${SCALE}`, 'gi');
const FORWARD_RE = /\b(?:will|shall|expects?|expected|expecting|guid\w+|target\w*|aim\w*|aspir\w*|plans?|planning|project\w*|forecast\w*|anticipat\w*|outlook|to grow|to reach|to touch|to cross|to double|to triple|set to|poised|on track|should|likely|intend\w*|looking to|sees?|seeing|envisag\w*|confident|ambition|goal|raised|raises|upgraded)\b/i;
const PAST_RE = /\b(?:grew|grown|reported|posted|clocked|delivered|achieved|recorded|registered|was|were|had|rose|doubled|tripled|delivered|witnessed)\b/i;
const ANALYST_RE = /\b(?:analysts?|consensus|brokerages?|brokers?|street|target price|price target|research (?:house|note|report)|estimates? (?:call|show|suggest)|average estimate)\b/i;
const MGMT_VOICE_RE = /\b(?:management|the company|company (?:expects|said|has|plans|aims)|we|our|CEO|CFO|MD|chairman|managing director|promoter|board|has guided)\b/i;
const QUAL_RE = /\b(?:strong|robust|healthy|significant|substantial|solid|double[- ]digit|high|accelerat\w+|good|healthy)\s+(?:revenue |sales |profit |earnings |top[- ]?line )?growth\b/i;
const WITHDRAW_RE = /\b(?:withdr[ae]w\w*|withdrawn|suspend\w*|no longer (?:provid|giv|guid)\w*|discontinu\w* (?:its |the )?guidance|rescind\w*)\b[^.]{0,60}\b(?:guidance|outlook|targets?)\b|\b(?:guidance|outlook|targets?)\b[^.]{0,40}\b(?:withdrawn|suspended|rescinded)\b/i;
const ACQ_RE = /\b(?:acquisitions?|acquired|acquiring|consolidation of|consolidating|inorganic|merger|merged|amalgamation|demerger|demerged|scheme of arrangement|buyout|takeover|slump sale)\b/i;
const ORGANIC_RE = /(?<![a-z])organic(?:ally)?\b/i;

export function splitSentences(text: string): string[] {
  return clean(text).split(/(?<=[.!?])\s+(?=[A-Z₹$"'(])/).map((s) => s.trim()).filter(Boolean);
}
function fingerprint(c: GuCandidate): string {
  return `${c.ticker || ''}|${(c.title + ' ' + c.text).toLowerCase().replace(/[^a-z0-9%.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110)}`;
}
export function organicOf(text: string): GgOrganic {
  const acq = ACQ_RE.test(text); const org = ORGANIC_RE.test(text.replace(/inorganic/gi, ''));
  if (acq && org) return 'MIXED';
  if (acq) return 'ACQUISITION_LED';
  if (org) return 'ORGANIC';
  return 'UNKNOWN';
}
export interface ExtractOpts { now: Date; market: 'IN' | 'US'; base?: Partial<Record<GgMetric, { value: number; period: string; unit: string }>>; includeQualitative?: boolean }
interface RawGrowth { start: number; end: number; low: number | null; high: number | null; approx: boolean; cagr: boolean; mult: boolean; priorLow?: number; priorHigh?: number }

function growthMatches(s: string): RawGrowth[] {
  const out: RawGrowth[] = [];
  const hasPct = (t: string) => /%|percent|per\s*cent/i.test(t);
  const pushVal = (m: RegExpMatchArray, gi: number, modIdx: number | null, cagr: boolean) => {
    const full = m[0];
    if (!hasPct(full)) return;
    const a = num(m[gi]); const b = m[gi + 1] ? num(m[gi + 1]) : a;
    const mod = modIdx ? m[modIdx] : '';
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + full.length, low: Math.min(a, b), high: Math.max(a, b), approx: !!mod, cagr, mult: false });
  };
  for (const m of s.matchAll(PAT_C)) pushVal(m, 2, 1, true);
  for (const m of s.matchAll(PAT_B)) pushVal(m, 2, 1, /cagr/i.test(m[4] || ''));
  for (const m of s.matchAll(PAT_A)) pushVal(m, 2, 1, /cagr/i.test(m[0]));
  for (const m of s.matchAll(PAT_X)) { const x = num(m[1]); if (x > 1) out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, low: (x - 1) * 100, high: (x - 1) * 100, approx: false, cagr: false, mult: true }); }
  for (const m of s.matchAll(PAT_MULT)) {
    const w = m[1].toLowerCase(); const g = /doubl|two|2x/.test(w) ? 100 : 200;
    out.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, low: g, high: g, approx: false, cagr: false, mult: true });
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: RawGrowth[] = [];
  for (const g of out) { if (kept.some((k) => g.start < k.end && g.end > k.start)) continue; kept.push(g); }
  // earlier figure: 'from 30-35%' / 'vs 30%' right after the statement
  for (const g of kept) {
    const tail = s.slice(g.end, g.end + 70);
    const pm = new RegExp(String.raw`^[^.;]{0,40}?(?:from|vs\.?|versus|compared (?:to|with)|up from|earlier|previously|against)\s*(?:an?\s+)?(?:earlier|previous|prior)?\s*(\d+(?:\.\d+)?)\s*%?\s*(?:(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?\s*(?:%|percent)`, 'i').exec(tail);
    if (pm) { const a = num(pm[1]); const b = pm[2] ? num(pm[2]) : a; g.priorLow = Math.min(a, b); g.priorHigh = Math.max(a, b); }
  }
  return kept;
}
function metricsFor(ms: Mention[], start: number, end: number, s: string): Mention[] {
  const before = ms.filter((m) => m.end <= start && start - m.end <= 120);
  if (before.length) {
    const last = before[before.length - 1]; const res = [last];
    for (let i = before.length - 2; i >= 0; i--) { const gap = s.slice(before[i].end, res[0].start); if (/^\s*(?:,|and|&|or|\/|as well as)\s*$/i.test(gap)) res.unshift(before[i]); else break; }
    return res;
  }
  const after = ms.find((m) => m.start >= end && m.start - end <= 80);
  return after ? [after] : [];
}
function kindOfLocal(local: string, whole: string, src: GgSourceRef, hist: boolean): GgKind {
  if (hist) return 'HISTORICAL_TRAJECTORY';
  if (ANALYST_RE.test(local) || (src.rank === 9 && !MGMT_VOICE_RE.test(local))) return /consensus|street|average estimate/i.test(local) ? 'ANALYST_CONSENSUS' : 'ANALYST_ESTIMATE';
  if (/\bguid\w+|\boutlook\b|\bforecast\b/i.test(local) || /\bguid\w+/i.test(whole.slice(0, 400))) return 'MANAGEMENT_GUIDANCE';
  if (/\btarget\w*|\baim\w*|\baspir\w*|\bambition\b|\bgoal\b|\bvision\b|\bplan(?:s|ning)? to\b|\bintend\w*|\broadmap\b/i.test(local)) return 'MANAGEMENT_TARGET';
  return 'MANAGEMENT_COMMENTARY';
}

/** All growth statements in one candidate. Numbers only: 'strong growth' is never translated to a figure. */
export function extractFromCandidate(c: GuCandidate, o: ExtractOpts): ExPoint[] {
  const text = clean(`${c.title}. ${c.text}`);
  const pub = new Date(Date.parse(c.publishedAt) || o.now.getTime());
  const src = sourceRefOf(c);
  const out: ExPoint[] = [];
  const fp = fingerprint(c);
  const market: 'IN' | 'US' = c.market === 'US' ? 'US' : o.market === 'US' && c.market !== 'IN' ? 'US' : 'IN';
  const docId = c.id;
  const push = (p: GgGuidancePoint, hist: boolean, end: Date | null, mg: boolean) => out.push({ point: p, cand: c, src, hist, fp, end, mgmtVoice: mg, docId, announcedAt: String(c.publishedAt) });
  for (const s of splitSentences(text)) {
    const ms = mentionsOf(s);
    if (!ms.length) continue;
    const fwdAny = FORWARD_RE.test(s);
    const organic = organicOf(s) !== 'UNKNOWN' ? organicOf(s) : organicOf(text);
    const usedSpans: Array<[number, number]> = [];
    for (const g of growthMatches(s)) {
      usedSpans.push([g.start, g.end]);
      const targets = metricsFor(ms, g.start, g.end, s).filter((m) => !m.margin);
      if (!targets.length) continue;
      const localBefore = s.slice(Math.max(0, g.start - 80), g.end + 20);
      const fwdLocal = FORWARD_RE.test(localBefore);
      const pastLocal = PAST_RE.test(localBefore);
      const per = periodOf(s, text, pub, market, g.cagr, g.start);
      const pastPeriod = per.end != null && per.end.getTime() < pub.getTime() - 30 * DAY;
      const hist = (pastLocal && !fwdLocal) || (pastPeriod && !fwdLocal && !fwdAny);
      const kind = kindOfLocal(localBefore, s, src, hist);
      const cum = per.cumulativeYears && g.mult ? per.cumulativeYears : null;
      for (const t of targets) {
        const point: GgGuidancePoint = {
          metric: t.metric, kind, growthLow: r1(g.low!), growthHigh: r1(g.high!), growthOrigin: 'STATED', absoluteTarget: null, base: null,
          period: per.period, periodKind: g.cagr && per.kind !== 'MULTI_YEAR_CAGR' && per.kind === 'UNKNOWN' ? 'UNKNOWN' : per.kind, organic, basis: /consolidated/i.test(s) ? 'CONSOLIDATED' : /standalone/i.test(s) ? 'STANDALONE' : 'UNSTATED',
          constantCurrency: /constant currency|cc basis/i.test(s) || undefined, originalStatement: s.slice(0, 400), unit: g.cagr ? '% CAGR' : cum ? '% cumulative' : '%',
          prior: g.priorLow != null ? { low: g.priorLow, high: g.priorHigh!, unit: '%' } : null, cumulativeYears: cum, approx: g.approx || undefined,
        };
        push(point, hist, per.end, MGMT_VOICE_RE.test(s));
      }
    }
    // absolute targets (implied growth ONLY with a supplied base)
    for (const m of s.matchAll(ABS_RE)) {
      const idx = m.index ?? 0;
      if (usedSpans.some(([a, b]) => idx >= a && idx < b)) { /* a growth % in the same clause does not block an absolute one */ }
      const metric = mentionsOf(m[0]).filter((x) => !x.margin)[0]?.metric; if (!metric) continue;
      if (mentionsOf(m[0])[0]?.margin) continue;
      const cur1 = m[1] || m[3] || null;
      const lo = normaliseAmount(num(m[2]), m[5], cur1, market); const hi = m[4] ? normaliseAmount(num(m[4]), m[5], m[3] || cur1, market) : lo;
      if (!lo || !hi) continue;
      const localBefore = s.slice(Math.max(0, idx - 20), idx + m[0].length);
      const fwdLocal = FORWARD_RE.test(localBefore) || FORWARD_RE.test(s.slice(0, idx + m[0].length));
      const hist = PAST_RE.test(localBefore) && !fwdLocal;
      const per = periodOf(s, text, pub, market, false, idx);
      const kind = kindOfLocal(localBefore, s, src, hist);
      const aLo = Math.min(lo.value, hi.value); const aHi = Math.max(lo.value, hi.value);
      // earlier guidance figure ('from Rs 600 crore' / '₹600 crore earlier')
      const tail = s.slice(idx + m[0].length, idx + m[0].length + 90);
      let prior: GgGuidancePoint['prior'] = null; let baseFromText: { value: number; period: string } | null = null;
      const pm = new RegExp(String.raw`^[^.;]{0,30}?(?:from|vs\.?|versus|compared (?:to|with)|up from|against)\s*(?:an?\s+)?(?:earlier|previous|prior)?\s*(${CUR})?\s*(\d[\d,]*(?:\.\d+)?)\s*${SCALE}\s*(?:(?:in|for)\s+(FY\s?\d{2,4}|last year|the previous year|the prior year))?`, 'i').exec(tail)
        || new RegExp(String.raw`^,?\s*(?:vs\.?|versus)?\s*(${CUR})?\s*(\d[\d,]*(?:\.\d+)?)\s*${SCALE}\s*(earlier|previously|before)`, 'i').exec(tail);
      if (pm) {
        const pv = normaliseAmount(num(pm[2]), pm[3], pm[1] || cur1, market);
        if (pv && pv.unit === lo.unit) {
          const label = pm[4] && /FY|last year|previous year|prior year/i.test(pm[4]) ? pm[4] : '';
          if (label) baseFromText = { value: pv.value, period: /FY/i.test(label) ? label.toUpperCase().replace(/\s+/g, '') : 'Prior year' };
          else prior = { low: pv.value, high: pv.value, unit: lo.unit };
        }
      }
      const ext = o.base?.[metric];
      const base = baseFromText || (ext && ext.unit === lo.unit && per.kind === 'FY' ? { value: ext.value, period: ext.period } : null);
      const point: GgGuidancePoint = {
        metric, kind, growthLow: null, growthHigh: null, growthOrigin: 'STATED',
        absoluteTarget: { value: aLo === aHi ? aLo : aLo, unit: lo.unit, currency: lo.currency }, base: null,
        period: per.period, periodKind: per.kind, organic, basis: 'UNSTATED', originalStatement: s.slice(0, 400), unit: lo.unit, prior, cumulativeYears: null,
      };
      if (aHi !== aLo) (point as any).absoluteHigh = aHi;
      if (base && base.value > 0) {
        point.growthLow = r1((aLo / base.value - 1) * 100); point.growthHigh = r1((aHi / base.value - 1) * 100);
        point.growthOrigin = 'IMPLIED'; point.base = base;
      }
      push(point, hist, per.end, MGMT_VOICE_RE.test(s));
    }
    // direction-only statement: kept only on request, growth stays null
    if (o.includeQualitative && !usedSpans.length && QUAL_RE.test(s) && fwdAny) {
      const m = ms.find((x) => !x.margin) || null;
      if (m) {
        const per = periodOf(s, text, pub, market, false, 0);
        push({ metric: m.metric, kind: 'MANAGEMENT_COMMENTARY', growthLow: null, growthHigh: null, growthOrigin: 'STATED', absoluteTarget: null, base: null,
          period: per.period, periodKind: per.kind, organic, basis: 'UNSTATED', originalStatement: s.slice(0, 400), unit: '', qualitative: true }, false, per.end, true);
      }
    }
  }
  return out;
}
export function extractGrowthPoints(text: string, opts?: Partial<ExtractOpts> & { publishedAt?: string; sourceName?: string; kind?: GuCandidate['kind'] }): GgGuidancePoint[] {
  const c: GuCandidate = { id: 'adhoc', market: opts?.market === 'US' ? 'US' : 'IN', title: '', text, sourceName: opts?.sourceName || 'Exchange filing', publishedAt: opts?.publishedAt || (opts?.now || new Date()).toISOString(), kind: opts?.kind || 'FILING' };
  return extractFromCandidate(c, { now: opts?.now || new Date(), market: opts?.market || 'IN', base: opts?.base, includeQualitative: opts?.includeQualitative }).map((e) => e.point);
}
export function isWithdrawal(text: string): boolean { return WITHDRAW_RE.test(text); }
export const mid = (p: Pick<GgGuidancePoint, 'growthLow' | 'growthHigh'>): number | null => (p.growthLow == null || p.growthHigh == null ? null : r1((p.growthLow + p.growthHigh) / 2));
export function absMid(p: GgGuidancePoint): number | null {
  const a = p.absoluteTarget; if (!a) return null; const hi = (p as any).absoluteHigh; return hi != null ? (a.value + hi) / 2 : a.value;
}
/** Growth used for the threshold test: cumulative multi-year figures are annualised (arithmetic on the stated numbers). */
export function comparableGrowth(p: GgGuidancePoint): number | null {
  const m = mid(p); if (m == null) return null;
  if (p.cumulativeYears && p.cumulativeYears > 1) return r1((Math.pow(1 + m / 100, 1 / p.cumulativeYears) - 1) * 100);
  return m;
}
export function fmtGrowth(p: GgGuidancePoint): string {
  if (p.growthLow == null || p.growthHigh == null) {
    const a = p.absoluteTarget; if (!a) return 'no number stated';
    const hi = (p as any).absoluteHigh; const f = (v: number) => (a.unit === '₹ Cr' ? Math.round(v).toLocaleString('en-IN') : String(Math.round(v)));
    return `${a.unit === '₹ Cr' ? '₹' : '$'}${hi != null ? `${f(a.value)}–${f(hi)}` : f(a.value)}${a.unit === '₹ Cr' ? ' Cr' : 'M'} target`;
  }
  const s = p.growthLow === p.growthHigh ? `${p.growthLow}` : `${p.growthLow}–${p.growthHigh}`;
  return `+${s}%${p.unit === '% CAGR' ? ' CAGR' : p.unit === '% cumulative' ? ' cumulative' : ''}`;
}

// ── verification / quality / validity ────────────────────────────────────────────────────────
const MGMT_KINDS: GgKind[] = ['MANAGEMENT_GUIDANCE', 'MANAGEMENT_TARGET', 'MANAGEMENT_COMMENTARY'];
export const isMgmtKind = (k: GgKind) => MGMT_KINDS.includes(k);
export const isAnalystKind = (k: GgKind) => k === 'ANALYST_CONSENSUS' || k === 'ANALYST_ESTIMATE';
const VRANK: Record<GgVerification, number> = { VERIFIED: 3, PARTIALLY_VERIFIED: 2, SECONDARY_ONLY: 1, UNVERIFIED: 0 };

/** Verification of ONE point from ITS OWN source. Syndicated copies never raise it. */
export function verificationOfPoint(p: GgGuidancePoint, src: GgSourceRef): GgVerification {
  if (isAnalystKind(p.kind)) return src.rank === 9 || src.primary ? 'PARTIALLY_VERIFIED' : 'SECONDARY_ONLY';
  if (src.primary) {
    const exact = p.kind !== 'MANAGEMENT_COMMENTARY' && p.growthOrigin === 'STATED' && !p.approx && !p.qualitative && (p.growthLow != null || p.absoluteTarget != null)
      && !/\b(?:doubl|tripl|two[- ]?fold|three[- ]?fold)/i.test(p.originalStatement);
    return exact ? 'VERIFIED' : 'PARTIALLY_VERIFIED';
  }
  if (src.rank >= 7 && src.rank <= 12) return 'SECONDARY_ONLY';
  return 'UNVERIFIED';
}
export function qualityOf(p: GgGuidancePoint, src: GgSourceRef): GgQuality {
  const formal = p.kind === 'MANAGEMENT_GUIDANCE' || p.kind === 'MANAGEMENT_TARGET';
  const clearPeriod = p.periodKind !== 'UNKNOWN';
  const measurable = p.growthLow != null && p.growthOrigin === 'STATED' && !p.approx && !p.qualitative;
  if (formal && src.primary && clearPeriod && measurable) return 'HIGH';
  if (!src.primary || p.growthLow == null || isAnalystKind(p.kind) || !(clearPeriod || formal)) return 'LOW';
  return 'MEDIUM';
}
export function validityOf(end: Date | null, now: Date, f: { withdrawn?: boolean; superseded?: boolean; outcome?: GgOutcome | null }): GgValidity {
  if (f.withdrawn) return 'WITHDRAWN';
  if (f.outcome === 'ACHIEVED' || f.outcome === 'EXCEEDED') return 'ACHIEVED';
  if (f.outcome === 'MISSED') return 'MISSED';
  if (f.superseded) return 'SUPERSEDED';
  if (end && end.getTime() < now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}
export function capBandOf(market: 'IN' | 'US', cap: number | null | undefined, bucket?: string | null): GgCapBand {
  // Mirrors the existing classifications: India grader inferMarketCapBucket (₹ Cr: ≥20,000 large, ≥5,000 mid, ≥500 small) and US usCapBucket ($M: ≥10,000 large, ≥2,000 mid, ≥300 small).
  if (cap != null && Number.isFinite(cap) && cap > 0) {
    if (market === 'IN') return cap >= 20_000 ? 'LARGE' : cap >= 5_000 ? 'MID' : cap >= 500 ? 'SMALL' : 'MICRO';
    return cap >= 10_000 ? 'LARGE' : cap >= 2_000 ? 'MID' : cap >= 300 ? 'SMALL' : 'MICRO';
  }
  const b = String(bucket || '').toUpperCase();
  if (b === 'MEGA' || b === 'LARGE') return 'LARGE';
  if (b === 'MID' || b === 'SMALL' || b === 'MICRO') return b as GgCapBand;
  return 'UNKNOWN';
}

// ── ledger / revision / trend / credibility / outcome (pure; storage lives in growth-guidance-ledger.ts) ──
export interface GgStoredEntry {
  key: string;                       // docId|metric|period — the idempotency key
  docId: string; date: string; metric: GgMetric; period: string; periodKind: GgPeriodKind;
  low: number | null; high: number | null; absLow?: number | null; absHigh?: number | null; absUnit?: string | null;
  unit: string; kind: GgKind; verification: GgVerification; source: string; sourceRank: number; sourceUrl?: string;
  statement: string; growthOrigin: 'STATED' | 'IMPLIED'; revision?: GgRevision; withdrawn?: boolean;
  outcome?: GgOutcome; actualPct?: number | null;
}
const isoDate = (s: string) => String(s).slice(0, 10);
export function entryOf(e: ExPoint, verification: GgVerification, revision?: GgRevision, withdrawn?: boolean): GgStoredEntry {
  const p = e.point;
  return {
    key: `${e.docId}|${p.metric}|${p.period}`, docId: e.docId, date: isoDate(e.announcedAt), metric: p.metric, period: p.period, periodKind: p.periodKind,
    low: p.growthLow, high: p.growthHigh, absLow: p.absoluteTarget?.value ?? null, absHigh: (p as any).absoluteHigh ?? p.absoluteTarget?.value ?? null, absUnit: p.absoluteTarget?.unit ?? null,
    unit: p.unit, kind: p.kind, verification, source: e.src.name, sourceRank: e.src.rank, sourceUrl: e.src.url, statement: p.originalStatement.slice(0, 300), growthOrigin: p.growthOrigin, revision, withdrawn,
  };
}
const entryVal = (e: Pick<GgStoredEntry, 'low' | 'high' | 'absLow' | 'absHigh'>): number | null =>
  e.low != null && e.high != null ? (e.low + e.high) / 2 : e.absLow != null ? (e.absLow + (e.absHigh ?? e.absLow)) / 2 : null;
const fmtEntry = (e: GgStoredEntry): string =>
  e.low != null && e.high != null ? `+${e.low === e.high ? e.low : `${e.low}–${e.high}`}%` : e.absLow != null ? `${Math.round(e.absLow)}${e.absHigh != null && e.absHigh !== e.absLow ? `–${Math.round(e.absHigh)}` : ''} ${e.absUnit || ''}`.trim() : 'no number';

export function revisionOf(oldV: number | null, newV: number | null, abs: boolean): GgRevision {
  if (oldV == null || newV == null) return 'INITIAL';
  const d = abs ? (oldV !== 0 ? ((newV - oldV) / Math.abs(oldV)) * 100 : 0) : newV - oldV;
  const tol = abs ? 2 : 1;
  return d > tol ? 'RAISED' : d < -tol ? 'LOWERED' : 'MAINTAINED';
}
export function revisionSize(oldV: number | null, newV: number | null, abs: boolean): number | null {
  if (oldV == null || newV == null) return null;
  return r1(abs ? (oldV !== 0 ? ((newV - oldV) / Math.abs(oldV)) * 100 : 0) : newV - oldV);
}
export function trendOf(series: number[]): { trend: 'ACCELERATION' | 'DETERIORATION' | 'FLAT' | 'NONE'; text: string | null } {
  const s = series.filter((x) => Number.isFinite(x));
  if (s.length < 2) return { trend: 'NONE', text: null };
  const txt = s.map((x) => `${r1(x)}%`).join(' → ');
  if (s.every((x) => x === s[0])) return { trend: 'FLAT', text: `${txt} (unchanged)` };
  if (s.length >= 3 && s.every((x, i) => i === 0 || x > s[i - 1])) return { trend: 'ACCELERATION', text: `${txt}: guidance raised at each update` };
  if (s.length >= 3 && s.every((x, i) => i === 0 || x < s[i - 1])) return { trend: 'DETERIORATION', text: `${txt}: guidance lowered at each update` };
  return { trend: 'NONE', text: txt };
}
export function outcomeOf(p: { low: number | null; high: number | null }, end: Date | null, now: Date, actualPct: number | null, withdrawn: boolean): GgOutcome {
  if (withdrawn) return 'WITHDRAWN';
  if (!end || end.getTime() >= now.getTime()) return 'PENDING';
  if (actualPct == null || p.low == null || p.high == null) return 'NOT_COMPARABLE';
  if (actualPct > p.high + 2) return 'EXCEEDED';
  if (actualPct >= p.low - 1) return 'ACHIEVED';
  return 'MISSED';
}
export function credibilityOf(entries: GgStoredEntry[]): GgCredibility | null {
  const groups = new Map<string, GgStoredEntry[]>();
  for (const e of entries) { const k = `${e.metric}|${e.period}`; groups.set(k, [...(groups.get(k) || []), e]); }
  if (!groups.size) return null;
  let raised = 0, maintained = 0, cut = 0, achieved = 0, exceeded = 0, missed = 0; const beats: number[] = []; const misses: number[] = [];
  for (const g of Array.from(groups.values())) {
    for (const e of g) { if (e.revision === 'RAISED') raised++; else if (e.revision === 'MAINTAINED') maintained++; else if (e.revision === 'LOWERED') cut++; }
    const oe = g.filter((e) => e.outcome).pop(); const o = oe?.outcome; const last = oe || g[g.length - 1];
    if (o === 'ACHIEVED') achieved++; else if (o === 'EXCEEDED') { exceeded++; if (last.actualPct != null && last.high != null) beats.push(last.actualPct - last.high); }
    else if (o === 'MISSED') { missed++; if (last.actualPct != null && last.low != null) misses.push(last.low - last.actualPct); }
  }
  const cycles = groups.size;
  const parts = [`${achieved + exceeded} achieved/exceeded`]; if (maintained) parts.push(`${maintained} maintained`); if (raised) parts.push(`${raised} raised`); if (cut) parts.push(`${cut} reduced`); if (missed) parts.push(`${missed} missed`);
  const avg = (a: number[]) => (a.length ? r1(a.reduce((x, y) => x + y, 0) / a.length) : null);
  return { cycles, raised, maintained, cut, achieved, exceeded, missed, avgBeatPct: avg(beats), avgMissPct: avg(misses),
    line: `Last ${cycles} guidance cycle${cycles === 1 ? '' : 's'}: ${parts.join(', ')}` };
}
export function ledgerRowsOf(entries: GgStoredEntry[], currentValidity: GgValidity): GgLedgerRow[] {
  const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const lastIdx = new Map<string, number>(); sorted.forEach((e, i) => lastIdx.set(`${e.metric}|${e.period}`, i));
  return sorted.map((e, i) => {
    const prev = sorted.slice(0, i).reverse().find((x) => x.metric === e.metric && x.period === e.period);
    const isLast = lastIdx.get(`${e.metric}|${e.period}`) === i;
    return { date: e.date, period: e.period, metric: e.metric, old: prev ? fmtEntry(prev) : null, next: fmtEntry(e), revision: e.revision || (prev ? revisionOf(entryVal(prev), entryVal(e), e.low == null) : 'INITIAL'),
      source: e.source, reason: e.withdrawn ? 'Company withdrew the guidance' : e.revision === 'RAISED' ? 'Figure raised versus the earlier statement' : e.revision === 'LOWERED' ? 'Figure lowered versus the earlier statement' : e.revision === 'MAINTAINED' ? 'Figure restated unchanged' : 'First statement found',
      status: e.withdrawn ? 'WITHDRAWN' : isLast ? currentValidity : 'SUPERSEDED', outcome: e.outcome } as GgLedgerRow;
  });
}

// ── WHY: mechanisms → catalysts → chain ──────────────────────────────────────────────────────
interface Mech { key: string; label: string; re: RegExp; cat: GgCatalyst }
const MECHS: Mech[] = [
  { key: 'order', label: 'order book', re: /\border (?:book|inflow|intake|pipeline|win|wins|backlog)\b|\bbacklog\b|\bletters? of award\b|\bLoA\b|\borders? (?:worth|of)\b/i, cat: 'A_DEMAND_EXPLOSION' },
  { key: 'backlog', label: 'backlog conversion', re: /\bconver(?:t|sion|ting)\w*\b[^.]{0,20}\b(?:order|backlog)|\bexecution of\b[^.]{0,30}\border/i, cat: 'A_DEMAND_EXPLOSION' },
  { key: 'capacity', label: 'capacity expansion', re: /\bcapacity (?:expansion|addition|additions|ramp|increase|build)\b|\bcapex\b|\bexpand(?:ing|ed)? (?:our |its )?capacity\b|\bgreenfield\b|\bbrownfield\b/i, cat: 'B_CAPACITY_EXPANSION' },
  { key: 'plant', label: 'new plant', re: /\bnew (?:plant|facility|line|unit|factory)\b/i, cat: 'B_CAPACITY_EXPANSION' },
  { key: 'commission', label: 'commissioning', re: /\bcommission\w*\b/i, cat: 'B_CAPACITY_EXPANSION' },
  { key: 'util', label: 'utilisation', re: /\butili[sz]ation\b/i, cat: 'B_CAPACITY_EXPANSION' },
  { key: 'customer', label: 'new customer / ramp', re: /\bnew customers?\b|\bcustomer (?:ramp|wins?|addition|onboard\w*)\b|\bramp[- ]?up\b|\bdesign wins?\b|\bmarquee (?:client|customer)\b/i, cat: 'C_CUSTOMER_RAMP' },
  { key: 'qual', label: 'qualification', re: /\bqualif(?:y|ied|ication|ications)\b|\bapproved vendor\b|\bvendor approval\b|\bcustomer approval\b/i, cat: 'C_CUSTOMER_RAMP' },
  { key: 'cross', label: 'cross-selling', re: /\bcross[- ]sell\w*\b|\bupsell\w*\b/i, cat: 'C_CUSTOMER_RAMP' },
  { key: 'share', label: 'market share', re: /\bmarket share\b|\bshare gains?\b/i, cat: 'D_MARKET_SHARE' },
  { key: 'dist', label: 'distribution', re: /\bdistribution (?:network|expansion|reach)\b|\bdealer network\b|\bnew stores\b/i, cat: 'D_MARKET_SHARE' },
  { key: 'product', label: 'new product', re: /\bnew products?\b|\bproduct launch\w*\b|\bnew (?:range|variant|offering|molecule)\b|\blaunch(?:es|ed|ing)\b/i, cat: 'E_NEW_PRODUCT' },
  { key: 'geo', label: 'geography', re: /\bnew (?:geograph\w+|markets?|region)\b|\binternational expansion\b|\bentry into\b/i, cat: 'F_NEW_GEOGRAPHY' },
  { key: 'exports', label: 'exports', re: /\bexports?\b/i, cat: 'F_NEW_GEOGRAPHY' },
  { key: 'pricing', label: 'pricing', re: /\bpric(?:e|ing) (?:increase|hike|realisation|realization|power)\b|\bprice hikes?\b|\brealisations?\b|\bASP\b/i, cat: 'G_PRICING_MIX' },
  { key: 'mix', label: 'mix', re: /\b(?:product|revenue) mix\b|\bpremiumi[sz]ation\b|\bvalue[- ]added\b/i, cat: 'G_PRICING_MIX' },
  { key: 'volume', label: 'volume', re: /\bvolume (?:growth|led|increase)\b|\bvolumes\b/i, cat: 'M_OTHER' },
  { key: 'oplev', label: 'operating leverage', re: /\boperating leverage\b|\bmargin expansion\b|\bfixed cost absorption\b/i, cat: 'H_OPERATING_LEVERAGE' },
  { key: 'acq', label: 'acquisition', re: /\bacquisitions?\b|\bacquired\b|\binorganic\b|\bconsolidation of\b/i, cat: 'I_ACQUISITION' },
  { key: 'reg', label: 'regulatory', re: /\bregulat\w*\b|\bapproval\b|\bPLI\b|\bUSFDA\b|\btariffs?\b|\banti-dumping\b|\bsubsid\w*\b/i, cat: 'K_REGULATORY_POLICY' },
  { key: 'cycle', label: 'industry cycle', re: /\bindustry (?:cycle|upcycle|tailwinds?|demand)\b|\bcyclical (?:upturn|recovery)\b|\bdemand (?:recovery|environment|surge|boom)\b|\bsector tailwinds?\b|\bsupercycle\b|\bAI (?:demand|infrastructure)\b|\bdata ?cent(?:er|re)s?\b/i, cat: 'A_DEMAND_EXPLOSION' },
];
export interface WhyRead { driverText: string; mechanisms: string[]; catalysts: GgCatalyst[]; keys: string[] }
export function whyOf(growthSentence: string, fullText: string, themes?: string[] | null, specialSituation?: boolean): WhyRead {
  const own: Mech[] = []; const rest: Mech[] = [];
  for (const m of MECHS) { if (m.re.test(growthSentence)) own.push(m); else if (m.re.test(fullText)) rest.push(m); }
  const all = [...own, ...rest];
  const catalysts: GgCatalyst[] = [];
  for (const m of all) if (m.cat !== 'M_OTHER' && !catalysts.includes(m.cat)) catalysts.push(m.cat);
  if (themes?.length) catalysts.push('J_BOTTLENECK');
  if (specialSituation) catalysts.push('L_SPECIAL_SITUATION');
  if (!all.length) return { driverText: DRIVER_NOT_STATED, mechanisms: [], catalysts, keys: [] };
  const labels = all.map((m) => m.label);
  const clause = /\b(?:on the back of|driven by|due to|led by|because of|supported by|on account of|backed by|owing to|thanks to)\b[^.;]{3,160}/i.exec(growthSentence) || /\b(?:on the back of|driven by|due to|led by|because of|supported by|on account of|backed by|owing to)\b[^.;]{3,160}/i.exec(fullText);
  return { driverText: `Driver stated in the source: ${labels.slice(0, 5).join(', ')}${clause ? `. "${clean(clause[0])}"` : ''}`, mechanisms: labels, catalysts, keys: all.map((m) => m.key) };
}

// ── reported-data context (all optional) ─────────────────────────────────────────────────────
export interface GgReported {
  unit?: string;                              // '₹ Cr' | '$M'
  priorFyRevenue?: number | null; priorFyLabel?: string | null;
  latestQuarterYoyPct?: number | null; prevQuarterYoyPct?: number | null; latestAnnualGrowthPct?: number | null; ttmRevenue?: number | null;
  patYoyPct?: number | null; epsYoyPct?: number | null; ebitdaYoyPct?: number | null;
  opmFrom?: number | null; opmTo?: number | null; cfoToPat?: number | null; fcf?: number | null;
  quartersReportedInPeriod?: number | null; seasonalityPct?: number[] | null; actualPeriodGrowthPct?: number | null;
  asOf?: string | null;
}
export interface GgTickerCtx {
  company?: string; marketCap?: number | null; capBucket?: string | null; reported?: GgReported | null;
  base?: Partial<Record<GgMetric, { value: number; period: string; unit: string }>>;
  consensusGrowthPct?: number | null;
  valuation?: { pe?: number | null; evEbitda?: number | null; priceToSales?: number | null; fcfYield?: number | null; peg?: number | null; embeddedGrowthPct?: number | null } | null;
  themes?: string[]; newsIds?: string[]; specialSituation?: boolean; concall?: boolean;
  ledger?: GgStoredEntry[];
  supporting?: string[];
}

export function realityOf(p: GgGuidancePoint, validity: GgValidity, revision: GgRevision, rep: GgReported | null | undefined, pubIso: string, now: Date, end: Date | null): GgReality | null {
  if (p.metric !== 'REVENUE') return null;
  const g = mid(p); const unit = p.absoluteTarget?.unit || rep?.unit;
  const base = rep?.priorFyRevenue ?? null;
  const abs = absMid(p);
  const implied = abs ?? (base != null && g != null && p.periodKind === 'FY' ? r1(base * (1 + g / 100)) : null);
  const ttm = rep?.ttmRevenue ?? null;
  const required = implied != null && ttm != null && ttm > 0 ? r1((implied / ttm - 1) * 100) : null;
  const q = rep?.latestQuarterYoyPct ?? null;
  let tracking: GgTracking = 'NOT_ASSESSED'; let why = 'No reported revenue data was supplied for this company, so tracking is not assessed.';
  if (validity === 'WITHDRAWN') { tracking = 'BROKEN'; why = 'The company withdrew this guidance.'; }
  else if (revision === 'LOWERED') { tracking = 'BROKEN'; why = 'The company lowered this guidance after stating it.'; }
  else if (validity === 'MISSED') { tracking = 'BROKEN'; why = 'The period has ended and reported growth was below the guided range.'; }
  else if (validity === 'EXPIRED') { tracking = 'NOT_ASSESSED'; why = 'The guided period has ended; see the outcome, not tracking.'; }
  else if (rep && rep.quartersReportedInPeriod === 0) { tracking = 'EARLY'; why = 'No quarter of the guided period has been reported yet.'; }
  else if (q != null && g != null) {
    const target = required != null ? Math.max(required, 0) : g;
    if (q >= target) { tracking = 'ON_TRACK'; why = `Latest quarter revenue is ${q >= 0 ? '+' : ''}${q}% YoY, at or above the ${required != null ? `${required}% needed from the run rate` : `${g}% guided`}.`; }
    else if (q >= target * 0.7) { tracking = 'ACCELERATION_REQUIRED'; why = `Latest quarter revenue is ${q >= 0 ? '+' : ''}${q}% YoY against ${target}% ${required != null ? 'needed from the run rate' : 'guided'}: growth must speed up.`; }
    else { tracking = 'AT_RISK'; why = `Latest quarter revenue is ${q >= 0 ? '+' : ''}${q}% YoY, well below the ${target}% ${required != null ? 'needed from the run rate' : 'guided'}.`; }
  } else if (rep?.latestAnnualGrowthPct != null) { tracking = 'EARLY'; why = `Only annual growth (${rep.latestAnnualGrowthPct}%) is available; no quarterly pace to compare with the guide.`; }
  void pubIso; void now; void end;
  const season = rep?.seasonalityPct && rep.seasonalityPct.length === 4 ? `Supplied seasonality (share of annual revenue by quarter): ${rep.seasonalityPct.map((x, i) => `Q${i + 1} ${x}%`).join(', ')}.` : null;
  return { fyActualRevenue: base, guidedGrowthPct: g, impliedRevenue: implied, latestQuarterGrowthPct: q, latestAnnualGrowthPct: rep?.latestAnnualGrowthPct ?? null, ttmRevenue: ttm, requiredGrowthFromRunRate: required,
    unit: unit || undefined, tracking, trackingWhy: why, quarterlyTimingNote: season || QUARTERLY_TIMING_DEFAULT };
}
export function earningsOf(rep: GgReported | null | undefined): GgEarnings | null {
  if (!rep) return null;
  const rev = rep.latestQuarterYoyPct ?? rep.latestAnnualGrowthPct ?? null;
  const pat = rep.patYoyPct ?? null; const eps = rep.epsYoyPct ?? null; const ebitda = rep.ebitdaYoyPct ?? null;
  let inflection: GgInflection = 'NO_EVIDENCE_YET';
  const q = rep.latestQuarterYoyPct ?? null; const prevQ = rep.prevQuarterYoyPct ?? null; const ann = rep.latestAnnualGrowthPct ?? null;
  if (q != null && q >= 15) {
    if (prevQ != null && q - prevQ >= 5 && q >= 20) inflection = 'ACCELERATING_INFLECTION';
    else if (q >= 20 && ((prevQ != null && prevQ >= 20) || (ann != null && q > ann))) inflection = 'CONFIRMED_INFLECTION';
    else inflection = 'EARLY_INFLECTION';
  }
  let leverage: GgLeverage = 'UNKNOWN'; let note = 'Revenue and profit growth are not both available, so operating leverage cannot be judged.';
  if (rev != null && (pat != null || ebitda != null)) {
    const profits = [pat, ebitda].filter((x): x is number => x != null);
    if (rev > 0 && profits.every((x) => x >= rev + 10 && x >= rev * 1.3)) { leverage = 'OPERATING_LEVERAGE'; note = `Profit is growing well ahead of revenue (revenue +${rev}%, ${pat != null ? `PAT +${pat}%` : ''}${pat != null && ebitda != null ? ', ' : ''}${ebitda != null ? `EBITDA +${ebitda}%` : ''}): costs are growing slower than sales.`; }
    else if (rev > 0 && profits.some((x) => x < rev - 10 || x < rev * 0.7)) { leverage = 'MARGIN_DILUTION'; note = `Revenue is up ${rev}% but profit is lagging (${pat != null ? `PAT ${pat >= 0 ? '+' : ''}${pat}%` : `EBITDA ${ebitda! >= 0 ? '+' : ''}${ebitda}%`}): margin is being diluted.`; }
    else { leverage = 'PROPORTIONAL'; note = 'Profit is growing roughly in line with revenue.'; }
  }
  return { revenueGrowthPct: rev, patGrowthPct: pat, epsGrowthPct: eps, ebitdaGrowthPct: ebitda, opmFrom: rep.opmFrom ?? null, opmTo: rep.opmTo ?? null, cfoToPat: rep.cfoToPat ?? null, fcf: rep.fcf ?? null, inflection, leverage, leverageNote: note };
}

// ── chain, expectations, valuation ───────────────────────────────────────────────────────────
const STATUS_RANK = { UNKNOWN: 0, ASSUMED: 1, PARTIALLY_PROVEN: 2, PROVEN: 3 } as const;
export function chainOf(why: WhyRead, primary: boolean, fullText: string, p: GgGuidancePoint, others: GgGuidancePoint[], rep: GgReported | null | undefined, earn: GgEarnings | null): GgChainStep[] {
  const has = (k: string) => why.keys.includes(k);
  const stated: GgChainStep['status'] = primary ? 'PARTIALLY_PROVEN' : 'ASSUMED';
  const driverKeys = ['order', 'backlog', 'customer', 'qual', 'cycle', 'reg', 'share', 'product', 'geo', 'exports', 'cross', 'dist'].filter(has);
  const numericOrder = /\border (?:book|backlog)[^.]{0,40}?(?:₹|Rs|\$)\s*\d/i.test(fullText);
  const respKeys = ['capacity', 'plant', 'commission'].filter(has);
  const commissioned = /\b(?:commissioned|commenced (?:commercial )?production|now operational|started production)\b/i.test(fullText);
  const steps: GgChainStep[] = [];
  steps.push(driverKeys.length ? { step: 'DRIVER', status: numericOrder && primary ? 'PROVEN' : stated, text: `Stated driver: ${why.mechanisms.filter((_, i) => driverKeys.includes(why.keys[i])).join(', ')}` } : { step: 'DRIVER', status: 'UNKNOWN', text: DRIVER_NOT_STATED });
  steps.push(respKeys.length ? { step: 'COMPANY_RESPONSE', status: commissioned && primary ? 'PROVEN' : stated, text: commissioned ? 'Capacity is stated as commissioned / operational' : 'Capacity or plant expansion is stated; commissioning not evidenced' } : { step: 'COMPANY_RESPONSE', status: 'UNKNOWN', text: 'No capacity, plant or product response is stated in the source' });
  steps.push(has('util') || has('order') || has('backlog') ? { step: 'CAPACITY_DEMAND', status: stated, text: has('util') ? 'Utilisation is referred to; level not evidenced' : 'Order book / backlog is referred to; conversion pace not evidenced' } : { step: 'CAPACITY_DEMAND', status: 'UNKNOWN', text: 'No utilisation or order-book evidence in the source' });
  const g = mid(p); const q = rep?.latestQuarterYoyPct ?? null;
  steps.push(p.metric === 'REVENUE' && q != null && g != null ? { step: 'REVENUE', status: q >= (p.growthLow ?? g) ? 'PROVEN' : q > 0 ? 'PARTIALLY_PROVEN' : 'ASSUMED', text: `Latest quarter revenue ${q >= 0 ? '+' : ''}${q}% YoY versus ${fmtGrowth(p)} guided` } : { step: 'REVENUE', status: g != null || absMid(p) != null ? 'ASSUMED' : 'UNKNOWN', text: g != null || absMid(p) != null ? `Guidance states ${fmtGrowth(p)}; not yet seen in reported numbers` : 'No revenue figure' });
  if (earn && earn.opmFrom != null && earn.opmTo != null) { const d = earn.opmTo - earn.opmFrom; steps.push({ step: 'MARGIN', status: d >= 0.3 ? 'PROVEN' : d > -0.3 ? 'PARTIALLY_PROVEN' : 'ASSUMED', text: `Operating margin ${earn.opmFrom}% → ${earn.opmTo}%${d < -0.3 ? ' (margin expansion not demonstrated)' : ''}` }); }
  else steps.push({ step: 'MARGIN', status: 'UNKNOWN', text: 'No margin data supplied' });
  const patG = earn?.patGrowthPct ?? null; const revG = earn?.revenueGrowthPct ?? null; const patGuide = others.find((o) => o.metric === 'PAT' || o.metric === 'EPS');
  steps.push(patG != null ? { step: 'PAT_EPS', status: revG != null && patG >= revG ? 'PROVEN' : patG > 0 ? 'PARTIALLY_PROVEN' : 'ASSUMED', text: `PAT ${patG >= 0 ? '+' : ''}${patG}% YoY${revG != null ? ` versus revenue ${revG >= 0 ? '+' : ''}${revG}%` : ''}` } : patGuide ? { step: 'PAT_EPS', status: 'ASSUMED', text: `${patGuide.metric} guided ${fmtGrowth(patGuide)}; not yet reported` } : { step: 'PAT_EPS', status: 'UNKNOWN', text: 'No profit data or guidance' });
  const c = earn?.cfoToPat ?? null;
  steps.push(c != null ? { step: 'FCF', status: c >= 0.8 && (earn?.fcf == null || earn.fcf > 0) ? 'PROVEN' : 'PARTIALLY_PROVEN', text: `CFO/PAT ${c}${earn?.fcf != null ? `, FCF ${earn.fcf}` : ''}` } : others.some((o) => o.metric === 'FCF') ? { step: 'FCF', status: 'ASSUMED', text: 'FCF guided; not yet reported' } : { step: 'FCF', status: 'UNKNOWN', text: 'No cash-flow data supplied' });
  return steps;
}
export function nextProofOf(chain: GgChainStep[], why: WhyRead, p: GgGuidancePoint, validity: GgValidity): string {
  if (validity === 'WITHDRAWN') return 'A fresh, numbered guidance statement from the company (the old one was withdrawn)';
  if (validity === 'EXPIRED' || validity === 'MISSED' || validity === 'ACHIEVED') return 'The next guidance statement for the following period, compared with what was delivered';
  const order = ['CAPACITY_DEMAND', 'COMPANY_RESPONSE', 'REVENUE', 'DRIVER', 'MARGIN', 'PAT_EPS', 'FCF'];
  const weakest = chain.slice().sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || order.indexOf(a.step) - order.indexOf(b.step))[0];
  const has = (k: string) => why.keys.includes(k);
  if (weakest.status === 'PROVEN') return `The next quarterly result confirming the ${fmtGrowth(p)} pace is still being held`;
  switch (weakest.step) {
    case 'COMPANY_RESPONSE': return has('capacity') || has('plant') ? 'Commissioning of the new capacity: commissioning date and first-quarter utilisation' : 'A stated response (capacity, plant or launch) that can deliver the growth';
    case 'CAPACITY_DEMAND': return has('order') || has('backlog') ? 'Order intake and backlog conversion in the next quarterly result' : has('qual') || has('customer') ? 'Customer qualification completed and first volume shipments' : 'Utilisation of the new capacity stated in the next result';
    case 'REVENUE': return `Next quarterly result confirming revenue acceleration toward the guided ${fmtGrowth(p)}`;
    case 'DRIVER': return why.mechanisms.length ? 'Management naming the specific order, customer or demand behind the growth in the next concall or filing' : 'The driver is not stated: look for order book, capacity or customer evidence in the next concall';
    case 'MARGIN': return 'Operating margin in the next quarter holding or rising as revenue scales';
    case 'PAT_EPS': return 'PAT growth keeping pace with revenue in the next result';
    default: return 'CFO to PAT and working capital in the next half-year or annual filing';
  }
}
export function breakersOf(why: WhyRead): string[] {
  const k = why.keys; const out: string[] = []; const has = (x: string) => k.includes(x);
  if (has('capacity') || has('plant') || has('commission')) out.push('Commissioning of the new capacity slips beyond the stated date', 'Utilisation of the new capacity stays below plan');
  if (has('order') || has('backlog')) out.push('Order intake slows or the backlog converts to revenue slower than guided', 'Anchor order is deferred or cancelled');
  if (has('customer') || has('qual')) out.push('Customer qualification or ramp slips', 'The anchor customer pauses or cuts volumes');
  if (has('pricing') || has('mix')) out.push('Price realisation or mix benefit reverses');
  if (has('acq')) out.push('Acquisition closing is delayed or integration falls short of plan');
  if (has('reg')) out.push('Approval or policy support is delayed or withdrawn');
  if (has('exports') || has('geo')) out.push('Export demand, tariffs or currency move against the plan');
  if (has('cycle')) out.push('The industry demand cycle turns');
  if (has('product') || has('share')) out.push('Product launch slips or market-share gains stall');
  out.push('Management cuts or withdraws the guidance', 'A quarterly result lands below the guided run rate');
  return Array.from(new Set(out)).slice(0, 6);
}
export function expectationsOf(guided: number | null, consensus: number | null | undefined, prior: number | null): { level: GgExpectations; why: string } {
  if (guided == null || guided <= 0) return { level: 'UNKNOWN', why: 'No growth figure to compare. Not inferred from P/E.' };
  const band = (ratio: number): GgExpectations => (ratio < 0.6 ? 'LOW' : ratio < 0.9 ? 'MODERATE' : 'HIGH');
  if (consensus != null && consensus > 0) { const l = band(consensus / guided); return { level: l, why: `Consensus growth ${consensus}% against guided ${guided}%: expectations are ${l.toLowerCase()} relative to the guide.` }; }
  if (prior != null && prior > 0 && prior !== guided) { const l = band(prior / guided); return { level: l, why: `Earlier guidance ${prior}% against new ${guided}%: the earlier figure is the only expectation marker found.` }; }
  return { level: 'UNKNOWN', why: 'No consensus estimate or earlier guidance available. Not inferred from P/E.' };
}
export function valuationOf(ctx: GgTickerCtx, p: GgGuidancePoint, cap: number | null, calv: { revenue: boolean }): GgValuation | null {
  const v = ctx.valuation;
  if (!v && cap == null) return null;
  const g = mid(p);
  let ifA = DATA_UNAVAILABLE;
  if (g != null && v?.priceToSales != null && v.priceToSales > 0 && p.metric === 'REVENUE' && calv.revenue) ifA = `If revenue reaches the guided +${g}% and the market value is unchanged, price-to-sales falls from ${v.priceToSales}x to about ${r1(v.priceToSales / (1 + g / 100))}x. Arithmetic only, not a forecast.`;
  else if (g != null && v?.pe != null && v.pe > 0 && (p.metric === 'PAT' || p.metric === 'EPS')) ifA = `If earnings reach the guided +${g}% at an unchanged market value, P/E falls from ${v.pe}x to about ${r1(v.pe / (1 + g / 100))}x. Arithmetic only, not a forecast.`;
  const embedded = v?.embeddedGrowthPct != null ? `Market-implied growth from the valuation module: ${v.embeddedGrowthPct}%.` : DATA_UNAVAILABLE;
  return { marketCap: cap, pe: v?.pe ?? null, evEbitda: v?.evEbitda ?? null, priceToSales: v?.priceToSales ?? null, fcfYield: v?.fcfYield ?? null, peg: v?.peg ?? null, embeddedGrowthNote: embedded, ifAchievedNote: ifA, rerating: 'UNKNOWN' };
}

// ── build ────────────────────────────────────────────────────────────────────────────────────
export function endOfPeriodLabel(period: string, announced: string, market: 'IN' | 'US'): Date | null {
  const pub = Date.parse(announced) || Date.now();
  let m = /^Q([1-4]) (?:FY|CY)(\d{2})$/.exec(period); if (m) return quarterEnd(parseInt(m[1], 10), 2000 + parseInt(m[2], 10), market);
  m = /^H([12]) FY(\d{2})$/.exec(period); if (m) return quarterEnd(m[1] === '1' ? 2 : 4, 2000 + parseInt(m[2], 10), market);
  m = /^FY(\d{2})[–-](\d{2})$/.exec(period); if (m) return fyEnd(2000 + parseInt(m[2], 10), market);
  m = /^FY(\d{2})$/.exec(period); if (m) return fyEnd(2000 + parseInt(m[1], 10), market);
  m = /^CY(\d{2})$/.exec(period); if (m) return utc(2000 + parseInt(m[1], 10), 11, 31);
  if (/^Next 12 months/.test(period)) return new Date(pub + 365 * DAY);
  m = /^Next (?:\d+[–-])?(\d+) years/.exec(period); if (m) return new Date(pub + parseInt(m[1], 10) * 365 * DAY);
  return null;
}
export function exFromEntry(e: GgStoredEntry, market: 'IN' | 'US', ticker: string): ExPoint {
  const point: GgGuidancePoint = {
    metric: e.metric, kind: e.kind, growthLow: e.low, growthHigh: e.high, growthOrigin: e.growthOrigin,
    absoluteTarget: e.absLow != null ? { value: e.absLow, unit: e.absUnit || '', currency: e.absUnit === '₹ Cr' ? 'INR' : 'USD' } : null, base: null,
    period: e.period, periodKind: e.periodKind, organic: organicOf(e.statement), basis: 'UNSTATED', originalStatement: e.statement, unit: e.unit, prior: null,
  };
  if (e.absHigh != null && e.absHigh !== e.absLow) (point as any).absoluteHigh = e.absHigh;
  const src: GgSourceRef = { name: e.source, rank: e.sourceRank, type: SOURCE_RANKS[e.sourceRank] || 'Stored evidence', date: e.date, url: e.sourceUrl, primary: e.sourceRank <= 6 };
  const cand: GuCandidate = { id: e.docId, ticker, market, title: e.statement, text: '', sourceName: e.source, publishedAt: e.date };
  return { point, cand, src, hist: false, fp: `${ticker}|stored|${e.key}`, end: endOfPeriodLabel(e.period, e.date, market), mgmtVoice: true, fromLedger: true, docId: e.docId, announcedAt: e.date };
}
const hash = (s: string): string => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const sameDay = (iso: string, now: Date, market: 'IN' | 'US'): boolean => {
  if (!iso) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso) || /T00:00:00(?:\.000)?Z$/.test(iso)) { const d = iso.slice(0, 10); return d === new Intl.DateTimeFormat('en-CA', { timeZone: market === 'IN' ? 'Asia/Kolkata' : 'America/New_York' }).format(now); }
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: market === 'IN' ? 'Asia/Kolkata' : 'America/New_York' });
  const t = Date.parse(iso); return Number.isFinite(t) && f.format(new Date(t)) === f.format(now);
};
const seriesVal = (e: ExPoint): number | null => { const p = e.point; return comparableGrowth(p); };
const PRIM_ORDER = (a: ExPoint, b: ExPoint) => a.src.rank - b.src.rank;

export interface BuildInput { candidates: GuCandidate[]; ledgerTickers?: Array<{ market: 'IN' | 'US'; ticker: string }>; ctxFor: (ticker: string, market: 'IN' | 'US') => GgTickerCtx; now: Date; threshold?: number }
export interface BuildOutput { companies: GgCompany[]; newEntries: Map<string, GgStoredEntry[]>; extractedCount: number }

const SUPPORT_RE = /\b(?:order (?:win|wins|received|worth)|bagged|letter of award|capacity (?:expansion|addition)|commission(?:ed|ing)|new plant|ramp[- ]?up|qualif\w+)\b/i;

export function buildGrowthGuidance(inp: BuildInput): BuildOutput {
  const { now } = inp;
  _thr = inp.threshold ?? 30;
  const groups = new Map<string, { market: 'IN' | 'US'; ticker: string; company?: string; ex: ExPoint[]; withdrawnAt: string | null; supporting: string[]; newsIds: Set<string>; concallSeen: boolean }>();
  let extractedCount = 0;
  const gOf = (market: 'IN' | 'US', ticker: string) => {
    const k = `${market}:${ticker}`; let g = groups.get(k);
    if (!g) { g = { market, ticker, ex: [], withdrawnAt: null, supporting: [], newsIds: new Set(), concallSeen: false }; groups.set(k, g); }
    return g;
  };
  for (const c of inp.candidates) {
    if (c.market !== 'IN' && c.market !== 'US') continue;
    // A candidate with no resolved ticker is kept (India names often lack one): grouped under a private '~name' key, shown by company name.
    const nm = (c.company || '').trim();
    if (!c.ticker && !nm) continue;
    const market = c.market; const g = gOf(market, c.ticker ? c.ticker.toUpperCase() : `~${nm.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 60)}`);
    if (c.company && !g.company) g.company = c.company;
    if (c.id.startsWith('news:')) g.newsIds.add(c.id.slice(5));
    if (/^filing:/.test(c.id) && /transcript|concall|conference call|earnings call/i.test(c.title)) g.concallSeen = true;
    const text = `${c.title}. ${c.text}`;
    if (isWithdrawal(text) && (!g.withdrawnAt || c.publishedAt > g.withdrawnAt)) g.withdrawnAt = c.publishedAt;
    const ctx = inp.ctxFor(g.ticker, market);
    const pts = extractFromCandidate(c, { now, market, base: ctx.base });
    extractedCount += pts.length;
    if (!pts.length) { if (SUPPORT_RE.test(text) && now.getTime() - Date.parse(c.publishedAt) < 14 * DAY && g.supporting.length < 3) g.supporting.push(clean(c.title).slice(0, 160)); continue; }
    g.ex.push(...pts.filter((p) => !p.hist));
  }
  // tickers that only exist in the ledger (guidance seen on an earlier scan)
  for (const t of inp.ledgerTickers || []) gOf(t.market, t.ticker.toUpperCase());
  const out: GgCompany[] = []; const newEntries = new Map<string, GgStoredEntry[]>();
  for (const g of Array.from(groups.values())) {
    const ctx = inp.ctxFor(g.ticker, g.market);
    const led = ctx.ledger || [];
    const have = new Set(g.ex.map((e) => `${e.docId}|${e.point.metric}|${e.point.period}`));
    for (const e of led) if (!e.outcome && !have.has(e.key)) g.ex.push(exFromEntry(e, g.market, g.ticker));
    if (g.ex.length) out.push(...buildTicker(g, ctx, now, newEntries));
  }
  return { companies: out, newEntries, extractedCount };
}

function buildTicker(g: { market: 'IN' | 'US'; ticker: string; company?: string; ex: ExPoint[]; withdrawnAt: string | null; supporting: string[]; newsIds: Set<string>; concallSeen: boolean }, ctx: GgTickerCtx, now: Date, newEntries: Map<string, GgStoredEntry[]>): GgCompany[] {
  const { market, ticker } = g;
  const led = ctx.ledger || []; const ledKeys = new Set(led.map((e) => e.key));
  const rep = ctx.reported || null;
  const cap = ctx.marketCap ?? null; const band = capBandOf(market, cap, ctx.capBucket);
  const byMetric = new Map<GgMetric, ExPoint[]>();
  for (const e of g.ex) byMetric.set(e.point.metric, [...(byMetric.get(e.point.metric) || []), e]);
  const heads = new Map<GgMetric, { cur: ExPoint; group: ExPoint[]; verification: GgVerification; validity: GgValidity; outcome: GgOutcome | null; revision: GgRevision; revisionPp: number | null; prevVal: number | null }>();
  const fmtVerifSort = (a: ExPoint, b: ExPoint) => VRANK[verificationOfPoint(b.point, b.src)] - VRANK[verificationOfPoint(a.point, a.src)];
  for (const [metric, list] of Array.from(byMetric.entries())) {
    const periods = new Map<string, ExPoint[]>();
    for (const e of list) { const k = `${e.point.periodKind}|${e.point.period}`; periods.set(k, [...(periods.get(k) || []), e]); }
    let best: { cur: ExPoint; group: ExPoint[]; validity: GgValidity; outcome: GgOutcome | null; revision: GgRevision; revisionPp: number | null; prevVal: number | null; verification: GgVerification } | null = null;
    for (const group of Array.from(periods.values())) {
      const mgmt = group.filter((e) => isMgmtKind(e.point.kind)); const pool = mgmt.length ? mgmt : group;
      const prim = pool.filter((e) => e.src.primary);
      const cand = (prim.length ? prim : pool).slice().sort((a, b) => b.announcedAt.localeCompare(a.announcedAt) || PRIM_ORDER(a, b) || fmtVerifSort(a, b));
      const cur = cand[0];
      const series = (prim.length ? prim : pool).slice().sort((a, b) => a.announcedAt.localeCompare(b.announcedAt));
      const docs = new Map<string, ExPoint>(); for (const e of series) docs.set(e.docId, e);
      const chron = Array.from(docs.values());
      const idx = chron.findIndex((e) => e.docId === cur.docId);
      const prevEx = idx > 0 ? chron[idx - 1] : null;
      const abs = cur.point.growthLow == null;
      const curV = abs ? absMid(cur.point) : mid(cur.point);
      let prevV: number | null = prevEx ? (abs ? absMid(prevEx.point) : mid(prevEx.point)) : null;
      if (prevV == null && cur.point.prior) prevV = (cur.point.prior.low + cur.point.prior.high) / 2;
      const withdrawn = !!g.withdrawnAt && cur.announcedAt <= g.withdrawnAt;
      let revision: GgRevision = withdrawn ? 'WITHDRAWN' : revisionOf(prevV, curV, abs);
      const actual = rep?.actualPeriodGrowthPct ?? null;
      const outcome = cur.point.growthLow != null ? outcomeOf({ low: cur.point.growthLow, high: cur.point.growthHigh }, cur.end, now, cur.point.metric === 'REVENUE' ? actual : null, withdrawn) : (withdrawn ? 'WITHDRAWN' : 'NOT_COMPARABLE');
      const validity = validityOf(cur.end, now, { withdrawn, outcome: outcome === 'ACHIEVED' || outcome === 'EXCEEDED' || outcome === 'MISSED' ? outcome : null });
      if (outcome === 'EXCEEDED') revision = 'EXCEEDED'; else if (outcome === 'MISSED') revision = 'MISSED';
      const cc = { cur, group, validity, outcome, revision, revisionPp: revisionSize(prevV, curV, abs), prevVal: prevV, verification: verificationOfPoint(cur.point, cur.src) };
      const rankV = (x: { validity: GgValidity }) => (x.validity === 'ACTIVE' ? 2 : 1);
      if (!best || rankV(cc) > rankV(best) || (rankV(cc) === rankV(best) && cc.cur.announcedAt > best.cur.announcedAt)) best = cc;
    }
    if (best) heads.set(metric, best);
  }
  const companies: GgCompany[] = [];
  const unresolved = ticker.startsWith('~');
  const nameOf = g.company || ctx.company || (unresolved ? ticker.slice(1) : ticker);
  // ledger appends: every point not already stored, once
  const fresh: GgStoredEntry[] = [];
  for (const [, h] of Array.from(heads.entries())) {
    const docs = new Map<string, ExPoint>(); for (const e of h.group.slice().sort((a, b) => a.announcedAt.localeCompare(b.announcedAt))) docs.set(e.docId, e);
    let prev: ExPoint | null = null;
    for (const e of Array.from(docs.values())) {
      if (e.src.primary && !e.fromLedger) {
        const key = `${e.docId}|${e.point.metric}|${e.point.period}`;
        if (!ledKeys.has(key) && !fresh.some((f) => f.key === key)) {
          const abs = e.point.growthLow == null; const pv = prev ? (abs ? absMid(prev.point) : mid(prev.point)) : e.point.prior ? (e.point.prior.low + e.point.prior.high) / 2 : null;
          const rev = revisionOf(pv, abs ? absMid(e.point) : mid(e.point), abs);
          fresh.push(entryOf(e, verificationOfPoint(e.point, e.src), rev, !!g.withdrawnAt && e.announcedAt <= g.withdrawnAt));
        }
      }
      prev = e;
    }
    if (h.outcome && ['ACHIEVED', 'EXCEEDED', 'MISSED', 'WITHDRAWN'].includes(h.outcome) && h.cur.end && h.cur.end < now) {
      const key = `${h.cur.docId}|${h.cur.point.metric}|${h.cur.point.period}|outcome`;
      if (!ledKeys.has(key) && !fresh.some((f) => f.key === key)) fresh.push({ ...entryOf(h.cur, h.verification, h.outcome === 'EXCEEDED' ? 'EXCEEDED' : h.outcome === 'MISSED' ? 'MISSED' : 'MAINTAINED'), key, outcome: h.outcome, actualPct: rep?.actualPeriodGrowthPct ?? null, date: now.toISOString().slice(0, 10) });
    }
  }
  if (fresh.length && !unresolved) newEntries.set(`${market}:${ticker}`, fresh);
  const allEntries = [...led, ...fresh];

  for (const [metric, h] of Array.from(heads.entries())) {
    const p = h.cur.point; const src = h.cur.src;
    const fullText = h.group.map((e) => `${e.cand.title}. ${e.cand.text}`).join(' ');
    const why = whyOf(p.originalStatement, `${h.cur.cand.title}. ${h.cur.cand.text}`, ctx.themes, ctx.specialSituation);
    const others: GgGuidancePoint[] = [];
    for (const [m2, h2] of Array.from(heads.entries())) {
      if (m2 === metric) continue;
      if (VRANK[h2.verification] >= VRANK[h.verification] && isMgmtKind(h2.cur.point.kind) === isMgmtKind(p.kind) && h2.validity === h.validity) others.push(h2.cur.point);
    }
    const earn = earningsOf(rep);
    const reality = realityOf(p, h.validity, h.revision, rep, h.cur.announcedAt, now, h.cur.end);
    const chain = chainOf(why, src.primary, fullText, p, others, rep, earn);
    const nextProof = nextProofOf(chain, why, p, h.validity);
    const sameEntries = allEntries.filter((e) => e.metric === metric);
    const hist = ledgerRowsOf(sameEntries, h.validity);
    const periodSeries = sameEntries.filter((e) => e.period === p.period && !e.outcome).sort((a, b) => a.date.localeCompare(b.date)).map((e) => entryVal(e)).filter((x): x is number => x != null);
    const tr = p.growthLow != null ? trendOf(periodSeries) : { trend: 'NONE' as const, text: null };
    const cred = credibilityOf(allEntries);
    const gMid = mid(p); const curCmp = comparableGrowth(p);
    const prevPct = h.prevVal != null && p.growthLow != null ? h.prevVal : null;
    const exp = expectationsOf(gMid, ctx.consensusGrowthPct, prevPct);
    const actualPct = rep?.actualPeriodGrowthPct ?? null;
    const surprise: GgSurprise | null = (actualPct != null && h.cur.end && h.cur.end < now) || ctx.consensusGrowthPct != null ? { guidancePct: gMid, actualPct: h.cur.end && h.cur.end < now ? actualPct : null, consensusPct: ctx.consensusGrowthPct ?? null } : null;
    // durations
    const multi = p.periodKind === 'MULTI_YEAR_CAGR' || /\bmulti[- ]year\b|\bover (?:the )?next \d+ years\b|\bstructural\b|\blong[- ]term contract/i.test(fullText);
    const multiQ = why.keys.some((k) => ['order', 'backlog', 'capacity', 'plant'].includes(k));
    const structuralDuration = multi ? 'Multi-year' : multiQ ? 'Multi-quarter (years not established)' : 'Not established';
    // organic
    const organic = p.organic !== 'UNKNOWN' ? p.organic : organicOf(fullText);
    const orgWord = organic === 'UNKNOWN' ? 'unknown' : organic === 'ORGANIC' ? 'organic' : organic === 'ACQUISITION_LED' ? 'acquisition-led' : 'mixed organic and acquisition';
    const label = metric === 'REVENUE' ? 'revenue' : metric === 'PAT' ? 'PAT' : metric === 'EPS' ? 'EPS' : metric === 'EBITDA' ? 'EBITDA' : 'FCF';
    const organicNote = `${p.period} ${p.growthLow != null ? fmtGrowth(p).replace(/ CAGR| cumulative/, '') : ''} ${label}${p.growthLow == null ? ` ${fmtGrowth(p)}` : ''} — Organic component: ${orgWord}`.replace(/\s+/g, ' ').trim();
    const corp = ACQ_RE.test(p.originalStatement) || ACQ_RE.test(fullText.slice(0, 600)) || organic === 'ACQUISITION_LED';
    // quality / verification / conflict
    const quality = qualityOf(p, src);
    const srcs: GgSourceRef[] = []; const seenS = new Set<string>();
    for (const e of h.group.slice().sort(PRIM_ORDER)) { const k = `${e.src.name}|${e.src.type}`; if (!seenS.has(k) && srcs.length < 6) { seenS.add(k); srcs.push(e.src); } }
    let conflict: GgConflict | null = null;
    if (p.growthLow != null && src.primary) {
      const other = h.group.filter((e) => !e.src.primary && e.point.growthLow != null && isMgmtKind(e.point.kind)).find((e) => { const a = mid(e.point)!; return Math.abs(a - gMid!) > 5 && Math.abs(a - gMid!) / Math.max(1, gMid!) > 0.15; });
      if (other) conflict = { primary: `${fmtGrowth(p)} (${src.type}, ${src.name})`, other: `${fmtGrowth(other.point)} (${other.src.name})`, note: `SOURCE CONFLICT: the primary source states ${fmtGrowth(p)} but ${other.src.name} reports ${fmtGrowth(other.point)}. The primary source is used.` };
    }
    const primDocs = new Set(h.group.filter((e) => e.src.primary).map((e) => e.docId));
    const independent = new Set<string>(); for (const e of h.group) independent.add(e.src.primary ? `doc:${e.docId}` : `fp:${e.fp}`);
    const evidence = { independentSources: independent.size, syndicatedCopies: Math.max(0, h.group.filter((e) => !e.src.primary).length - h.group.filter((e) => !e.src.primary && true).map((e) => e.fp).filter((x, i, a) => a.indexOf(x) === i).length), primaryCount: primDocs.size,
      note: h.group.length > independent.size ? 'Repeated or syndicated copies of the same story are counted once and do not raise verification.' : 'Each source counted once.' };
    // earnings-linked flags
    const inflection = earn?.inflection ?? 'NO_EVIDENCE_YET';
    const confirmedQ = rep?.latestQuarterYoyPct ?? null;
    let map2x2: GgMap2x2 = 'FORWARD_LOOKING_EARLY';
    if (quality === 'LOW' || h.validity !== 'ACTIVE' || reality?.tracking === 'BROKEN' || reality?.tracking === 'AT_RISK') map2x2 = 'LOW_PRIORITY';
    else if (confirmedQ != null && p.growthHigh != null && confirmedQ > p.growthHigh * 1.1) map2x2 = 'POTENTIAL_UPSIDE_TO_GUIDANCE';
    else if (inflection === 'CONFIRMED_INFLECTION' || inflection === 'ACCELERATING_INFLECTION') map2x2 = 'CONFIRMED_GROWTH';
    // valuation + rerating
    const val = valuationOf(ctx, p, cap, { revenue: metric === 'REVENUE' });
    if (val) val.rerating = quality === 'LOW' ? 'UNKNOWN' : earn?.leverage === 'OPERATING_LEVERAGE' ? 'EARNINGS_PLUS_MARGIN' : multi ? 'EARNINGS_PLUS_DURATION' : exp.level === 'LOW' && h.revision === 'RAISED' ? 'EARNINGS_PLUS_EXPECTATIONS_RESET'
      : why.catalysts.some((c) => c === 'F_NEW_GEOGRAPHY' || c === 'E_NEW_PRODUCT' || c === 'A_DEMAND_EXPLOSION') ? 'EARNINGS_PLUS_MARKET_EXPANSION' : 'EARNINGS_GROWTH_ONLY';
    // radar eligibility: guidance + catalyst + transmission evidence. Never automatic.
    const transmissionKeys = why.keys.some((k) => ['order', 'backlog', 'capacity', 'plant', 'commission', 'customer', 'qual'].includes(k));
    const radarEligible = (h.verification === 'VERIFIED' || h.verification === 'PARTIALLY_VERIFIED') && isMgmtKind(p.kind) && h.validity === 'ACTIVE' && p.growthLow != null && why.mechanisms.length > 0 && (transmissionKeys || inflection !== 'NO_EVIDENCE_YET');
    const radarWhy = radarEligible ? `Guidance (${fmtGrowth(p)}), a stated catalyst (${why.mechanisms.slice(0, 2).join(', ')}) and ${inflection !== 'NO_EVIDENCE_YET' ? 'early revenue acceleration' : 'capacity / customer / order-book evidence'} are all present.`
      : `Not eligible: needs guidance from a company source, a stated catalyst and transmission evidence (capacity, customer, order book or early revenue acceleration). ${why.mechanisms.length ? '' : 'No mechanism is stated. '}${h.validity !== 'ACTIVE' ? `Guidance is ${h.validity.toLowerCase()}. ` : ''}`.trim();
    // alert
    const newToday = sameDay(h.cur.announcedAt, now, market);
    const recent = now.getTime() - (Date.parse(h.cur.announcedAt) || 0) < 3 * DAY;
    let alert: GgCompany['alert'] = null;
    const tx = `${unresolved ? nameOf : ticker} ${p.period} ${label} ${fmtGrowth(p)}`;
    if (h.revision === 'WITHDRAWN' || h.validity === 'WITHDRAWN' || h.validity === 'MISSED') alert = { level: 'HIGH', kind: 'GUIDANCE_BROKEN', text: `${tx}: guidance ${h.validity === 'MISSED' ? 'missed' : 'withdrawn'}` };
    else if (h.revision === 'LOWERED') alert = { level: 'HIGH', kind: 'GUIDANCE_CUT', text: `${tx}: guidance lowered${h.revisionPp != null ? ` (${h.revisionPp}${p.growthLow == null ? '%' : 'pp'})` : ''}` };
    else if (h.validity === 'ACHIEVED' || h.revision === 'EXCEEDED') alert = { level: 'HIGH', kind: 'GUIDANCE_ACHIEVED', text: `${tx}: guidance ${h.revision === 'EXCEEDED' ? 'exceeded' : 'achieved'}` };
    else if (h.revision === 'RAISED' && (h.revisionPp ?? 0) >= (p.growthLow == null ? 10 : 5) && recent) alert = { level: 'HIGH', kind: 'GUIDANCE_RAISED', text: `${tx}: guidance raised${h.revisionPp != null ? ` by ${h.revisionPp}${p.growthLow == null ? '%' : 'pp'}` : ''}` };
    else if (h.revision === 'INITIAL' && recent && h.validity === 'ACTIVE' && curCmp != null && (inp_threshold(ctx) <= curCmp)) alert = { level: 'HIGH', kind: 'NEW_GUIDANCE', text: `${tx}: new guidance` };
    else if ((inflection === 'CONFIRMED_INFLECTION' || inflection === 'ACCELERATING_INFLECTION') && reality?.tracking === 'ON_TRACK') alert = { level: 'HIGH', kind: 'EARNINGS_CONFIRMATION', text: `${tx}: reported growth confirms the guided pace` };
    else if (g.supporting.length || ctx.supporting?.length) alert = { level: 'MEDIUM', kind: 'SUPPORTING_EVIDENCE', text: `${unresolved ? nameOf : ticker}: supporting evidence — ${(g.supporting[0] || ctx.supporting![0])}` };
    const isNewToday = newToday && !!alert && ['NEW_GUIDANCE', 'GUIDANCE_RAISED', 'EARNINGS_CONFIRMATION', 'GUIDANCE_BROKEN', 'GUIDANCE_CUT'].includes(alert.kind);
    const dates = h.group.map((e) => e.announcedAt).sort();
    companies.push({
      id: hash(`${market}|${ticker}|${metric}|${p.period}`), ticker: unresolved ? '' : ticker, ...(unresolved ? { tickerResolved: false } : {}), company: nameOf, market, capBand: band, marketCap: cap,
      primary: p, others, verification: h.verification, quality, validity: h.validity, sources: srcs, conflict,
      driverText: why.driverText, mechanisms: why.mechanisms, catalysts: why.catalysts, chain,
      guidanceDuration: p.period, structuralDuration, history: hist, revision: h.revision, trend: tr.trend, trendText: tr.text, credibility: cred, surprise,
      reality, earnings: earn, map2x2, expectations: exp.level, expectationsWhy: exp.why, valuation: val, nextProof, breakers: breakersOf(why),
      links: { bottleneck: !!ctx.themes?.length, bottleneckThemes: ctx.themes, specialSituation: !!ctx.specialSituation, radarEligible, radarWhy, concall: g.concallSeen || !!ctx.concall, newsIds: ctx.newsIds || Array.from(g.newsIds).slice(0, 5) },
      organicNote, corporateActionGrowth: corp, portfolio: { held: false }, announcedAt: h.cur.announcedAt, lastEvidenceAt: dates[dates.length - 1] || null, isNewToday,
      evidence, revisionPp: h.revisionPp, supporting: g.supporting.length ? g.supporting : ctx.supporting, alert,
    });
  }
  return companies;
}
let _thr = 0;
function inp_threshold(_c: GgTickerCtx): number { return _thr; }
export function setAlertThreshold(t: number) { _thr = t; }

// ── filters & sorting ────────────────────────────────────────────────────────────────────────
export type GgCapFilter = 'SMALL_MICRO' | 'ALL';
export type GgKindFilter = 'MGMT' | 'ALL';
export interface GgFilters { threshold: number; metric: GgMetric; market: 'IN' | 'US' | 'ALL'; cap: GgCapFilter; kind: GgKindFilter }
export function filterCompanies(all: GgCompany[], f: GgFilters): { companies: GgCompany[]; discovery: GgCompany[]; universe: number } {
  let pool = all.filter((c) => c.primary.metric === f.metric);
  if (f.market !== 'ALL') pool = pool.filter((c) => c.market === f.market);
  if (f.kind === 'MGMT') pool = pool.filter((c) => isMgmtKind(c.primary.kind));
  else pool = pool.filter((c) => isMgmtKind(c.primary.kind) || isAnalystKind(c.primary.kind));   // historical / inference never listed
  if (f.cap === 'SMALL_MICRO') pool = pool.filter((c) => c.capBand === 'SMALL' || c.capBand === 'MICRO');
  pool = pool.filter((c) => c.validity === 'ACTIVE' || c.validity === 'ACHIEVED' || c.validity === 'MISSED' || c.validity === 'WITHDRAWN');
  const universe = pool.length;
  pool = pool.filter((c) => { const g = comparableGrowth(c.primary); return g != null && g >= f.threshold; });
  return {
    companies: pool.filter((c) => c.verification === 'VERIFIED' || c.verification === 'PARTIALLY_VERIFIED'),
    discovery: pool.filter((c) => c.verification === 'SECONDARY_ONLY' || c.verification === 'UNVERIFIED'),
    universe,
  };
}
const Q_RANK: Record<GgQuality, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const INF_RANK: Record<GgInflection, number> = { ACCELERATING_INFLECTION: 3, CONFIRMED_INFLECTION: 2, EARLY_INFLECTION: 1, NO_EVIDENCE_YET: 0 };
const DUR_RANK = (c: GgCompany) => (c.structuralDuration === 'Multi-year' ? 3 : c.structuralDuration.startsWith('Multi-quarter') ? 2 : 1);
const EXP_RANK: Record<GgExpectations, number> = { LOW: 3, MODERATE: 2, HIGH: 1, UNKNOWN: 0 };
const ALERT_RANK = (c: GgCompany) => (c.alert?.level === 'HIGH' ? 2 : c.alert?.level === 'MEDIUM' ? 1 : 0);
export function growthOf(c: GgCompany, metric: GgMetric): number | null {
  const p = c.primary.metric === metric ? c.primary : c.others.find((o) => o.metric === metric); return p ? comparableGrowth(p) : null;
}
export function sortCompanies(list: GgCompany[], sort: GgSort): GgCompany[] {
  const desc = (f: (c: GgCompany) => number | null) => (a: GgCompany, b: GgCompany) => (f(b) ?? -1e9) - (f(a) ?? -1e9);
  const tie = (a: GgCompany, b: GgCompany) => (comparableGrowth(b.primary) ?? -1) - (comparableGrowth(a.primary) ?? -1) || (a.ticker || a.company).localeCompare(b.ticker || b.company);
  const by = (...fs: Array<(a: GgCompany, b: GgCompany) => number>) => (a: GgCompany, b: GgCompany) => { for (const f of fs) { const r = f(a, b); if (r) return r; } return tie(a, b); };
  const vr = (c: GgCompany) => VRANK[c.verification];
  const rank = (f: (c: GgCompany) => number) => (a: GgCompany, b: GgCompany) => f(b) - f(a);
  const fn: Record<GgSort, (a: GgCompany, b: GgCompany) => number> = {
    // evidence first (quality, reported confirmation, duration, verification); the raw % only breaks ties
    DEFAULT: by(rank((c) => Q_RANK[c.quality]), rank((c) => INF_RANK[c.earnings?.inflection ?? 'NO_EVIDENCE_YET']), rank(DUR_RANK), rank(vr)),
    HIGHEST_REVENUE: by(desc((c) => growthOf(c, 'REVENUE'))),
    HIGHEST_PAT: by(desc((c) => growthOf(c, 'PAT'))),
    HIGHEST_COMBINED: by(desc((c) => { const r = growthOf(c, 'REVENUE'); const p = growthOf(c, 'PAT'); return r != null && p != null ? r + p : null; })),
    BIGGEST_INCREASE: by(desc((c) => c.revisionPp ?? null)),
    STRONGEST_EARNINGS: by(rank((c) => INF_RANK[c.earnings?.inflection ?? 'NO_EVIDENCE_YET']), desc((c) => c.earnings?.revenueGrowthPct ?? null)),
    LONGEST_DURATION: by(rank(DUR_RANK), (a, b) => (b.primary.periodKind === 'MULTI_YEAR_CAGR' ? 1 : 0) - (a.primary.periodKind === 'MULTI_YEAR_CAGR' ? 1 : 0)),
    STRONGEST_EVIDENCE: by(rank((c) => Q_RANK[c.quality]), rank(vr), rank((c) => c.evidence?.primaryCount ?? 0)),
    EARLIEST_INFLECTION: by(rank((c) => (c.earnings?.inflection === 'EARLY_INFLECTION' ? 3 : c.earnings?.inflection === 'CONFIRMED_INFLECTION' ? 2 : c.earnings?.inflection === 'ACCELERATING_INFLECTION' ? 1 : 0))),
    LARGEST_EXPECTATIONS_GAP: by(rank((c) => EXP_RANK[c.expectations])),
    PORTFOLIO_CHANGE: by(rank((c) => (c.isNewToday ? 1 : 0)), rank(ALERT_RANK), (a, b) => (b.lastEvidenceAt || '').localeCompare(a.lastEvidenceAt || '')),
  };
  return list.slice().sort(fn[sort] || fn.DEFAULT);
}
export const GG_SORTS: GgSort[] = ['HIGHEST_REVENUE', 'HIGHEST_PAT', 'HIGHEST_COMBINED', 'BIGGEST_INCREASE', 'STRONGEST_EARNINGS', 'LONGEST_DURATION', 'STRONGEST_EVIDENCE', 'EARLIEST_INFLECTION', 'LARGEST_EXPECTATIONS_GAP', 'PORTFOLIO_CHANGE', 'DEFAULT'];
export function newTodayOf(list: GgCompany[]): Array<{ id: string; ticker: string; company: string; text: string; kind: GgAlertKind; level: 'HIGH' | 'MEDIUM' | 'LOW' }> {
  return list.filter((c) => c.isNewToday && c.alert).map((c) => ({ id: c.id, ticker: c.ticker, company: c.company, text: c.alert!.text, kind: c.alert!.kind, level: c.alert!.level }));
}
