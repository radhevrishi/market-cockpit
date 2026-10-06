// zzz843 — GUIDANCE UPGRADES engine. Pure, deterministic, client-safe. No I/O, no AI, no fetch.
// Only import: the types contract. Nothing from any price or quote module (price is context only).
//
// Product rules this file enforces:
//  - never invent numbers: missing -> null / 'UNAVAILABLE' / 'DATA UNAVAILABLE'
//  - unknown is not negative (no consensus -> gap UNKNOWN)
//  - silence never passes (no primary source -> UNVERIFIED, no final decision)
//  - price / momentum never drives classification, decision level or rank (price only chooses WATCHLIST vs DELAYED_EP)
//  - an estimate is always MODEL_ESTIMATE with a formula and assumptions
//  - decisions are only IMMEDIATE_BUY / WATCHLIST / DELAYED_EP / REJECT (+ UNVERIFIED); thesis labels only A/B/F/G
//  - no visible 0-100 scores (rankKey is internal only)

import { earlierPriorMismatch } from './guidance-prior-match';
import type {
  GuCandidate, GuChange, GuChain, GuContext, GuDecision, GuDuration, GuEvidence, GuFlag, GuGap,
  GuGuidancePoint, GuHistoryStats, GuLedgerRow, GuMarket, GuMateriality, GuMetric, GuNumber,
  GuPortfolioImpact, GuQuality, GuSourceRef, GuSourceTier, GuSummary, GuThesis, GuType,
  GuValuation, GuVerification, GuWindow, GuidanceEvent,
  GuRangeMath, GuRangeClass, GuEventV2, GuScoreItem, GuStage, GuDurabilityLevel, GuMetricBasis,
  GuClassification, GuSourceClaim, GuSourceConflict, GuPrimaryState,
  GuTaxonomy, GuPipeline, GuPipelineCounts, GuPrimarySourceState, GuReviewItem, GuValidationIssue,
} from './guidance-upgrades-types';
import {
  validateChanges, duplicatesAcrossEvents, splitByBasis, consensusLooksMismatched, financingVerdict, brokerWordIsCompanyName,
  periodGrain, metricName as vMetricName,
} from './guidance-upgrades-validate';

export const DATA_UNAVAILABLE = 'DATA UNAVAILABLE';

/** Thresholds in one place (documented in each function). */
export const GU_THRESHOLDS = {
  GAP_LARGE_POSITIVE_PCT: 5,      // guidance mid >= +5% above consensus
  GAP_POSITIVE_PCT: 2,            // +2..+5%
  GAP_INLINE_FLOOR_PCT: -2,       // zzz854: -2..+2 is in line (neutral); only below -2% is NEGATIVE. A tiny gap never drives a decision.
  // zzz854 materiality: from the size of the change in the headline (basis-preferred) metric, midpoint %:
  MAT_HIGH_PROFIT_PCT: 10,        // EPS / EBITDA / EBIT / net profit / FCF midpoint up >= 10% -> HIGH
  MAT_HIGH_REVENUE_PCT: 5,        // revenue midpoint up >= 5% -> HIGH (on its own)
  MAT_HIGH_MARGIN_PP: 3,          // margin up >= 3pp -> HIGH
  MAT_HIGH_VOLUME_PCT: 20,        // volume / order / backlog up >= 20% -> HIGH
  MAT_MED_PROFIT_PCT: 5,          // profit-like up >= 5% -> MEDIUM
  MAT_MED_REVENUE_PCT: 2.5,       // revenue up >= 2.5% -> MEDIUM (so +0.3% / +2% stay LOW)
  MAT_MED_MARGIN_PP: 1,           // margin up >= 1pp -> MEDIUM
  MAT_MED_VOLUME_PCT: 10,         // volume / order / backlog up >= 10% -> MEDIUM
  REPEAT_WINDOW_DAYS: 365,        // REPEATED UPGRADER: >= 1 PRIOR verified raise (earlier announcement) within this many days
  STRETCHED_PE: 40,               // current P/E at or above this = valuation already stretched (context)
  BIG_MOVE_7D_PCT: 15,            // move7dPct >= 15 -> wait for confirmation (only WATCHLIST vs DELAYED_EP)
  SECOND_RAISE_TOL_PCT: 0.5,      // second raise: before must equal previous after within 0.5%
  F_MIN_GAP_PP: 5,                // profit % must beat revenue % by at least 5 points for thesis F
} as const;

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------
const round = (n: number, d = 4): number => { const f = 10 ** d; return Math.round(n * f) / f; };
const DASH = '–';

function fmtNum(n: number | null | undefined, d = 2): string {
  if (n == null || !isFinite(n)) return DATA_UNAVAILABLE;
  const r = round(n, d);
  if (Math.abs(r) >= 1000) return r.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(r);
}
const signed = (n: number, d = 1): string => `${n >= 0 ? '+' : '-'}${Math.abs(round(n, d)).toFixed(d)}`;

function scaleLabel(u: string | undefined): string {
  if (!u || u === '%') return '';
  return u.length > 1 ? ` ${u}` : u; // 'B','M','K' attach; 'Cr','L Cr' get a space
}
export function fmtPoint(p: GuGuidancePoint | null | undefined): string {
  if (!p || p.low == null || p.high == null) return DATA_UNAVAILABLE;
  // zzz881: never print a range whose two ends look the same ('$1.69–1.69B' for 1.685–1.693): add decimals until they differ
  let d = 2;
  while (p.low !== p.high && d < 4 && fmtNum(p.low, d) === fmtNum(p.high, d)) d++;
  const rng = p.low === p.high ? fmtNum(p.low) : `${fmtNum(p.low, d)}${DASH}${fmtNum(p.high, d)}`;
  if (p.isGrowthRate) return `${rng}%`;
  return `${p.currency ?? ''}${rng}${scaleLabel(p.unit)}`;
}
function unitOf(p: GuGuidancePoint): string {
  if (p.isGrowthRate) return '%';
  const s = scaleLabel(p.unit);
  return `${p.currency ?? ''}${s}`.trim();
}

const METRIC_LABEL: Record<GuMetric, string> = {
  REVENUE: 'revenue', REVENUE_GROWTH: 'revenue growth', EBITDA: 'EBITDA', EBIT: 'operating profit',
  OP_MARGIN: 'operating margin', EPS: 'EPS', ADJ_EPS: 'adjusted EPS', FCF: 'free cash flow',
  FCF_CONVERSION: 'cash conversion', ORGANIC_GROWTH: 'organic growth', ORDER_INTAKE: 'order intake',
  BACKLOG: 'order backlog', VOLUME: 'volume', PRODUCTION: 'production', CAPACITY_UTIL: 'capacity utilisation',
  NET_PROFIT: 'net profit', OTHER: 'profit',
};
function metricLabel(c: GuChange): string {
  if (c.metric === 'OTHER' && !isProfitOther(c)) return 'other measure';
  return METRIC_LABEL[c.metric];
}

function isoDate(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}
function dayNum(iso: string): number { return Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86400000); }

function fnv(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function stableId(key: string): string {
  const a = fnv(key, 2166136261).toString(16).padStart(8, '0');
  const b = fnv(key, 3266489917).toString(16).padStart(8, '0');
  return `gu_${a}${b}`;
}

const na = (label: GuNumber['label'] = 'UNAVAILABLE', source?: string): GuNumber =>
  source ? { value: null, label, source } : { value: null, label };

// ---------------------------------------------------------------------------------------------
// window helpers (20)
// ---------------------------------------------------------------------------------------------
export function windowDays(w: GuWindow): number {
  switch (w) { case '24H': return 1; case '3D': return 3; case '7D': return 7; case '14D': return 14; case '30D': return 30; case '120D': return 120; default: return 7; }
}
/** True when dateIso is inside the window ending at `now`. Date-only strings use calendar days (UTC);
 *  timestamps use exact hours. Never extends silently: an 8-day-old event is outside 7D. */
export function withinWindow(dateIso: string, w: GuWindow, now: Date): boolean {
  if (!dateIso) return false;
  const days = windowDays(w);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    const diff = Math.floor(now.getTime() / 86400000) - dayNum(dateIso);
    return diff >= -1 && diff <= days;
  }
  const t = Date.parse(dateIso);
  if (isNaN(t)) return false;
  const diffMs = now.getTime() - t;
  return diffMs >= -2 * 3600000 && diffMs <= days * 86400000;
}

// ---------------------------------------------------------------------------------------------
// 6. source tier + verification
// ---------------------------------------------------------------------------------------------
const PRIMARY_KINDS = new Set(['FILING', 'RELEASE', 'TRANSCRIPT', 'DECK']);
const PRIMARY_HOSTS = ['sec.gov', 'nseindia.com', 'bseindia.com'];
const DISCOVERY_HOSTS = ['finance.yahoo.com', 'yahoo.com', 'investing.com', 'seekingalpha.com', 'benzinga.com', 'marketbeat.com',
  'stocktwits.com', 'reddit.com', 'x.com', 'twitter.com', 'medium.com', 'substack.com', 'blogspot.com', 'wordpress.com',
  'tradingview.com', 'fool.com', 'zacks.com', 'investorplace.com', 'telegram.org', 't.me', 'facebook.com', 'youtube.com'];
const SECONDARY_HOSTS = ['reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'cnbc.com', 'business-standard.com', 'economictimes.indiatimes.com',
  'moneycontrol.com', 'livemint.com', 'thehindubusinessline.com', 'barrons.com', 'apnews.com', 'financialexpress.com', 'businesstoday.in',
  'cnbctv18.com', 'ndtvprofit.com', 'marketwatch.com', 'thehindu.com', 'nikkei.com', 'scmp.com'];
const PRIMARY_NAME_RE = /\b(sec filing|8-?k|10-?q|10-?k|20-?f|6-?k|exchange filing|regulation 30|reg\.? ?30|earnings release|press release from the company|investor presentation|investor deck|earnings call transcript|concall transcript|company filing|investor relations)\b/i;
const SECONDARY_NAME_RE = /\b(reuters|bloomberg|financial times|ft\.com|wall street journal|wsj|cnbc|business standard|economic times|et markets|moneycontrol|mint|livemint|hindu businessline|businessline|barron'?s|associated press|ap news|financial express|business today|ndtv profit|marketwatch)\b/i;
const DISCOVERY_NAME_RE = /\b(yahoo|investing\.com|seeking ?alpha|benzinga|marketbeat|stocktwits|reddit|twitter|x \(formerly|tradingview|motley fool|zacks|blog|substack|medium|telegram|whatsapp|aggregator|newsfeed|google news)\b/i;

function hostOf(url?: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
const hostIn = (host: string, list: string[]): boolean => list.some(d => host === d || host.endsWith('.' + d));

export function sourceTier(name: string, kind?: GuCandidate['kind'], url?: string): GuSourceTier {
  const host = hostOf(url);
  if (kind && PRIMARY_KINDS.has(kind)) return 'PRIMARY';
  if (host && hostIn(host, PRIMARY_HOSTS)) return 'PRIMARY';
  if (host && (/^(ir|investor|investors)\./.test(host) || /\/(investors?|investor-relations)(\/|$)/i.test(url ?? ''))) return 'PRIMARY';
  if (host && hostIn(host, DISCOVERY_HOSTS)) return 'DISCOVERY';
  if (host && hostIn(host, SECONDARY_HOSTS)) return 'SECONDARY';
  const n = name || '';
  if (PRIMARY_NAME_RE.test(n) && !SECONDARY_NAME_RE.test(n) && !DISCOVERY_NAME_RE.test(n)) return 'PRIMARY';
  if (DISCOVERY_NAME_RE.test(n)) return 'DISCOVERY';
  if (SECONDARY_NAME_RE.test(n)) return 'SECONDARY';
  return 'DISCOVERY';
}

function sourceTypeLabel(name: string, kind: GuCandidate['kind'] | undefined, url?: string): string {
  const host = hostOf(url);
  if (kind === 'FILING') return hostIn(host, ['sec.gov']) ? 'SEC filing' : hostIn(host, ['nseindia.com', 'bseindia.com']) ? 'Exchange filing' : 'Company filing';
  if (kind === 'RELEASE') return 'Earnings release';
  if (kind === 'TRANSCRIPT') return 'Transcript';
  if (kind === 'DECK') return 'Investor deck';
  return name;
}

export function verificationOf(sources: GuSourceRef[]): { verification: GuVerification; primaryAvailable: boolean; note: string | null } {
  const primary = sources.some(s => s.tier === 'PRIMARY');
  if (primary) return { verification: 'VERIFIED', primaryAvailable: true, note: null };
  const secondary = sources.some(s => s.tier === 'SECONDARY');
  return {
    verification: 'UNVERIFIED', primaryAvailable: false,
    note: secondary ? 'Primary source not found yet (only news coverage so far)' : 'Primary source not found yet (only discovery-level sources)',
  };
}

// ---------------------------------------------------------------------------------------------
// 2. extractGuidance
// ---------------------------------------------------------------------------------------------
type ScaleKey = 'B' | 'M' | 'K' | 'Cr' | 'LCr';
const SCALE_FACTOR: Record<ScaleKey, number> = { B: 1e9, M: 1e6, K: 1e3, Cr: 1e7, LCr: 1e12 };
const SCALE_TEXT: Record<ScaleKey, string> = { B: 'B', M: 'M', K: 'K', Cr: 'Cr', LCr: 'L Cr' };

const CUR_RE = '(?:US\\$|\\$|₹|€|£|Rs\\.?|INR|USD|EUR|GBP)';
const NUM_RE = '\\d[\\d,]*(?:\\.\\d+)?';
const SCALE_RE = '(?:lakh\\s+crores?\\b|lakh\\s+cr\\b|crores?\\b|cr\\b|million\\b|billion\\b|bn\\b|mn\\b|thousand\\b|m\\b|b\\b|k\\b)';
const VALUE_SRC = `(?<![A-Za-z0-9.])(${CUR_RE})?\\s*(${NUM_RE})\\s*(${SCALE_RE})?(?:\\s*(-|–|—|to)\\s*(${CUR_RE})?\\s*(${NUM_RE})\\s*(${SCALE_RE})?)?\\s*(%|percent\\b|per cent\\b)?`;

interface RawVal {
  start: number; end: number; text: string;
  cur: string | null; scale: ScaleKey | null; pct: boolean;
  lo: number; hi: number; sep: 'to' | 'dash' | null; negative: boolean;
}

function curSymbol(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (t === '$' || t === 'us$' || t === 'usd') return '$';
  if (t === '₹' || t.startsWith('rs') || t === 'inr') return '₹';
  if (t === '€' || t === 'eur') return '€';
  if (t === '£' || t === 'gbp') return '£';
  return null;
}
function scaleKey(s: string | undefined): ScaleKey | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/\s+/g, ' ');
  if (t.startsWith('lakh')) return 'LCr';
  if (t.startsWith('cr')) return 'Cr';
  if (t === 'million' || t === 'mn' || t === 'm') return 'M';
  if (t === 'billion' || t === 'bn' || t === 'b') return 'B';
  if (t === 'thousand' || t === 'k') return 'K';
  return null;
}
const toNum = (s: string): number => parseFloat(s.replace(/,/g, ''));

function findValues(sent: string): RawVal[] {
  const out: RawVal[] = [];
  const re = new RegExp(VALUE_SRC, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(sent)) !== null) {
    if (m[0].trim() === '') { re.lastIndex++; continue; }
    const [, c1, n1, s1, sep, c2, n2, s2, pctS] = m;
    let lo = toNum(n1);
    let hi = n2 != null ? toNum(n2) : lo;
    if (!isFinite(lo) || !isFinite(hi)) continue;
    let sc1 = scaleKey(s1); let sc2 = scaleKey(s2);
    let scale: ScaleKey | null;
    if (sc1 && sc2 && sc1 !== sc2) { // "$800 million to $1.2 billion": express in the larger scale
      const big = SCALE_FACTOR[sc1] >= SCALE_FACTOR[sc2] ? sc1 : sc2;
      lo = lo * SCALE_FACTOR[sc1] / SCALE_FACTOR[big]; hi = hi * SCALE_FACTOR[sc2] / SCALE_FACTOR[big]; scale = big;
    } else scale = sc2 ?? sc1;
    const cur = curSymbol(c1) ?? curSymbol(c2);
    const pct = !!pctS;
    if (hi < lo) continue;                                   // "10-5" is not a range we can trust
    const text = m[0].replace(/\s+$/, '');
    const start = m.index; const end = m.index + text.length;
    // bare integer that looks like a year is not a guidance number
    if (!cur && !scale && !pct && Number.isInteger(lo) && lo >= 1900 && lo <= 2100 && !sep) continue;
    if (!cur && !scale && !pct && /^\d{4}-\d{2}/.test(text)) continue;
    const prev = start > 0 ? sent[start - 1] : '';
    const negative = prev === '-' || prev === '−' || (prev === '(' && sent[end] === ')');
    out.push({ start, end, text, cur, scale, pct, lo, hi, sep: sep ? (sep.toLowerCase() === 'to' ? 'to' : 'dash') : null, negative });
    re.lastIndex = end;
  }
  return out;
}

const KW_RULES: Array<[RegExp, GuMetric]> = [
  [/\b(?:organic (?:revenue |sales )?growth)\b/gi, 'ORGANIC_GROWTH'],
  [/\b(?:revenue|sales|top[- ]?line|turnover) growth\b|\bgrowth in (?:revenue|sales)\b/gi, 'REVENUE_GROWTH'],
  [/\b(?:free cash flow conversion|fcf conversion|cash conversion)\b/gi, 'FCF_CONVERSION'],
  [/\b(?:free cash flow|fcf|operating cash flow|cash flow from operations)\b/gi, 'FCF'],
  [/\b(?:ebitda margin|operating margin|op margin|opm|ebit margin|operating profit margin|profit margin|margins?)\b/gi, 'OP_MARGIN'],
  [/\bebitda\b/gi, 'EBITDA'],
  [/\b(?:ebit|operating income|operating profit)\b/gi, 'EBIT'],
  [/\b(?:adjusted eps|adj\.? eps|non-gaap eps|adjusted earnings per share)\b/gi, 'ADJ_EPS'],
  [/\b(?:eps|earnings per share)\b/gi, 'EPS'],
  [/\b(?:income from continuing operations|net profit|net income|profit after tax|profit after taxes|pat|net earnings|earnings|profit)\b/gi, 'NET_PROFIT'],
  [/\b(?:order intake|order inflows?|order wins|new orders|order flow)\b/gi, 'ORDER_INTAKE'],
  [/\b(?:order book|order backlog|backlog)\b/gi, 'BACKLOG'],
  [/\b(?:capacity utili[sz]ation|utili[sz]ation)\b/gi, 'CAPACITY_UTIL'],
  [/\b(?:sales volumes?|volumes?|shipments)\b/gi, 'VOLUME'],
  [/\b(?:production|output)\b/gi, 'PRODUCTION'],
  [/\b(?:revenues?|sales|top[- ]?line|turnover)\b/gi, 'REVENUE'],
];
interface Kw { start: number; end: number; metric: GuMetric; text: string }
function findMetricKws(sent: string): Kw[] {
  const all: Kw[] = [];
  for (const [re, metric] of KW_RULES) {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(sent)) !== null) all.push({ start: m.index, end: m.index + m[0].length, metric, text: m[0] });
  }
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: Kw[] = []; let lastEnd = -1;
  for (const k of all) { if (k.start >= lastEnd) { kept.push(k); lastEnd = k.end; } }
  return kept;
}

const sameMetricFamily = (m: GuMetric): string => (m === 'ADJ_EPS' ? 'EPS' : m === 'ORGANIC_GROWTH' || m === 'REVENUE_GROWTH' ? 'REVENUE' : m === 'REVENUE' ? 'REVENUE' : m);
const PER_SHARE_KW = new Set<GuMetric>(['EPS', 'ADJ_EPS']);
const PCT_METRICS = new Set<GuMetric>(['REVENUE_GROWTH', 'ORGANIC_GROWTH', 'OP_MARGIN', 'FCF_CONVERSION', 'CAPACITY_UTIL']);
const PCT_OK_METRICS = new Set<GuMetric>([...PCT_METRICS, 'VOLUME', 'PRODUCTION', 'ORDER_INTAKE', 'BACKLOG']);

function periodOf(sent: string, near: number, fallback: string): string {
  const cands: Array<{ idx: number; end: number; val: string }> = [];
  const push = (re: RegExp, fmt: (m: RegExpExecArray) => string) => {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); let m: RegExpExecArray | null;
    while ((m = r.exec(sent)) !== null) cands.push({ idx: m.index, end: m.index + m[0].length, val: fmt(m) });
  };
  const yy = (s: string) => (s.length === 4 ? s.slice(2) : s);
  push(/\b(Q[1-4])\s*[-']?\s*(?:FY|F\.Y\.?)\s*'?(\d{4}|\d{2})\b/i, m => `${m[1].toUpperCase()} FY${yy(m[2])}`);
  push(/\b(H[12])\s*(?:FY|F\.Y\.?)\s*'?(\d{4}|\d{2})\b/i, m => `${m[1].toUpperCase()} FY${yy(m[2])}`);
  push(/\b(?:FY|F\.Y\.?)\s*'?(\d{4}|\d{2})(?:\s*[-–/]\s*(\d{2,4}))?(?!\d)/i, m => `FY${yy(m[2] ?? m[1])}`);
  push(/\b(?:full[- ]year|fiscal(?: year)?)\s*'?(\d{4})\b/i, m => `FY${yy(m[1])}`);
  push(/\b(?:calendar(?: year)?|CY)\s*'?(\d{4})\b/i, m => `CY${yy(m[1])}`);
  push(/\b(Q[1-4])\s+(\d{4})\b/i, m => `${m[1].toUpperCase()} ${m[2]}`);
  if (!cands.length) return fallback;
  // drop FY hits that are just the tail of a Q..FY hit
  const filtered = cands.filter(c => !cands.some(o => o !== c && o.idx <= c.idx && o.end >= c.end && (o.end - o.idx) > (c.end - c.idx)));
  const before = filtered.filter(c => c.end <= near).sort((a, b) => b.end - a.end);
  if (before.length) return before[0].val;
  return filtered.sort((a, b) => a.idx - b.idx)[0].val;
}

const WORD_NUM: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
/** zzz853: a growth target over several years ("30-35% over FY27-FY29", "CAGR of 20% over the next 3 years") is a multi-year CAGR, never a single-year figure. */
export function multiYearSpan(sent: string): { period: string; years: number | null } | null {
  const yr = (s: string) => { const n = Number(s.length === 4 ? s.slice(2) : s); return Number.isFinite(n) ? n : NaN; };
  const m = /\b(?:FY|F\.Y\.?)\s*'?(\d{4}|\d{2})\s*(?:[-–—]|to)\s*(?:FY|F\.Y\.?)?\s*'?(\d{4}|\d{2})(?!\d)/i.exec(sent);
  if (m) { const a = yr(m[1]); const b = yr(m[2]); if (b - a >= 2) return { period: `FY${String(a).padStart(2, '0')}–${String(b).padStart(2, '0')}`, years: b - a + 1 }; }
  const n = /\b(?:over|across|during|for|in)\s+(?:the\s+)?(?:next|coming|following)?\s*(\d+|two|three|four|five|six|seven)(?:\s*(?:to|-|–)\s*(?:\d+|two|three|four|five|six|seven))?[-\s]*years?\b/i.exec(sent);
  if (n) { const k = /^\d+$/.test(n[1]) ? Number(n[1]) : WORD_NUM[n[1].toLowerCase()]; if (k >= 2) return { period: `${k} years`, years: k }; }
  const y = /\b(\d+)[-\s]years?\s+(?:CAGR|growth|period|plan)\b/i.exec(sent);
  if (y && Number(y[1]) >= 2) return { period: `${y[1]} years`, years: Number(y[1]) };
  if (/\bCAGR\b/.test(sent)) return { period: '', years: null };
  return null;
}
function firstPeriod(text: string): string { return periodOf(text, 0, 'UNSTATED'); }

function basisOf(s: string): GuGuidancePoint['basis'] {
  if (/non-?gaap|adjusted|adj\./i.test(s)) return 'NON_GAAP';
  if (/\bgaap\b/i.test(s)) return 'GAAP';
  if (/organic/i.test(s)) return 'ORGANIC';
  if (/reported/i.test(s)) return 'REPORTED';
  return 'UNSTATED';
}

function makePoint(metric: GuMetric, period: string, v: RawVal, target: ScaleKey | null, cur: string | null, pct: boolean, basis: GuGuidancePoint['basis'], raw: string): GuGuidancePoint {
  const conv = (x: number) => (v.scale && target && v.scale !== target ? x * SCALE_FACTOR[v.scale] / SCALE_FACTOR[target] : x);
  const lo = round(conv(v.lo), 6); const hi = round(conv(v.hi), 6);
  return {
    metric, period, low: lo, high: hi, midpoint: round((lo + hi) / 2, 6), isGrowthRate: pct,
    currency: pct ? undefined : (cur ?? undefined), unit: pct ? '%' : (target ? SCALE_TEXT[target] : ''), basis, raw,
  };
}

/** Build a GuChange from two points. Relative % only for absolute amounts; pp only for growth/margin. */
export function makeChange(before: GuGuidancePoint | null, after: GuGuidancePoint): GuChange {
  if (!before || before.midpoint == null || after.midpoint == null) {
    return { metric: after.metric, before, after, absoluteChange: null, percentageChange: null, percentagePointChange: null, direction: 'UNKNOWN' };
  }
  const diff = round(after.midpoint - before.midpoint, 6);
  const direction: GuChange['direction'] = Math.abs(diff) < 1e-9 ? 'FLAT' : diff > 0 ? 'UP' : 'DOWN';
  if (after.isGrowthRate) {
    return { metric: after.metric, before, after, absoluteChange: diff, percentageChange: null, percentagePointChange: diff, direction };
  }
  const pctChg = before.midpoint !== 0 ? round((diff / Math.abs(before.midpoint)) * 100, 4) : null;
  return { metric: after.metric, before, after, absoluteChange: diff, percentageChange: pctChg, percentagePointChange: null, direction };
}

/** INFO ONLY: relative % between two growth/margin midpoints (e.g. 9% -> 13% = +44.4%). Never use it as the change. */
export function relativeChangeInfo(c: GuChange): number | null {
  if (!c.before || c.before.midpoint == null || c.after.midpoint == null || c.before.midpoint === 0) return null;
  return round(((c.after.midpoint - c.before.midpoint) / Math.abs(c.before.midpoint)) * 100, 1);
}

const LINK_TOKEN = /\b(from|prior|previous(?:ly)?|earlier|versus|vs\.?|compared (?:with|to)|against|was|were|before|old|had)\b/i;
const LINK_BAD = /(consensus|analysts?|estimates?|street|year[- ]ago|a year|last year|prior[- ]year|year[- ]over[- ]year|yoy|y\/y|quarter[- ]ago)/i;
const YEAR_AGO_AFTER = /^\s*[\)\],]?\s*(?:a year ago|year[- ]ago|last year|prior[- ]year|year[- ]over[- ]year|yoy|y\/y|in the (?:prior|previous|year[- ]ago))/i;
const NEG_WORD = /(declin|decreas|\bfall|\bdrop|contract(?:ion)?\b|negative|\bloss|shrink|deficit)/i;
const PAIR_SEP = /^\s*(?:,\s*and|,|and|&)\s*$/i;
const PRIOR_CUE = /(?:\b(?:from|versus|vs\.?|compared (?:with|to)|against|previously|earlier|prior)(?:\s+(?:guidance|target|forecast))?(?:\s+(?:of|at|was|were))?)\s*$/i;
const FLAT_BEFORE = /^\s*[\(,]?\s*(?:from|versus|vs\.?|previously|prior|compared (?:with|to)|earlier)\s+(?:a\s+|was\s+)?(flat|stable|zero)\b/i;

/** zzz854: the words right around ONE figure: its own period ("$71.1M in Q2 FY26"), a single-quarter tie ("in the quarter", "Q2 revenue of"),
 *  or a reported-result cue ("reported", "a year ago"). Used only for the OLD figure of a comparison. */
const FIG_AFTER_QUARTER = /^\s*[\),]?\s*(?:in|for|during)\s+(?:the\s+)?(?:(?:first|second|third|fourth|latest|last|previous|prior|june|september|december|march)[- ]quarter\b|quarter\b|three months\b|Q[1-4]\b(?!\s*(?:FY|F\.Y\.?)?\s*'?\d))/i;
const FIG_BEFORE_QUARTER = /\b(?:quarterly|(?:first|second|third|fourth)[- ]quarter|Q[1-4])\s+(?:[\w-]+\s+){0,2}(?:of\s+|at\s+|was\s+)?$/i;
const FIG_AFTER_ACTUAL = /^\s*(?:for\s+(?:Q[1-4]\s+)?FY\s?\d{2,4}\s*)?[\(\),]?\s*(?:(?:it\s+)?(?:reported|recorded|posted|achieved|delivered|generated)\b|(?:a\s+)?year[- ]ago\b|last year\b|in the (?:prior|previous|same) (?:year|quarter|period)\b|actual\b)/i;
const FIG_BEFORE_ACTUAL = /\b(?:reported|recorded|posted|achieved|delivered|generated|actual)\s+(?:[\w-]+\s+){0,3}(?:of\s+|at\s+|was\s+)?$/i;
function figureContext(sent: string, v: RawVal): { ownPeriod: string | null; quarter: boolean; actual: boolean } {
  const after = sent.slice(v.end, v.end + 32); const before = sent.slice(Math.max(0, v.start - 32), v.start);
  let ownPeriod: string | null = null;
  const lead = /^\s*[\),]?\s*(?:in|for|during)\s+(?:the\s+)?/i.exec(after);
  if (lead) { const p = periodOf(after.slice(lead[0].length, lead[0].length + 14), 0, ''); if (p) ownPeriod = p; }
  const quarter = FIG_AFTER_QUARTER.test(after) || (FIG_BEFORE_QUARTER.test(before) && !/guid|outlook|forecast|target/i.test(before.slice(-24)));
  const actual = FIG_AFTER_ACTUAL.test(after) || FIG_BEFORE_ACTUAL.test(before);
  return { ownPeriod: ownPeriod && ownPeriod !== 'UNSTATED' ? ownPeriod : null, quarter: quarter && !(ownPeriod && periodGrain(ownPeriod) !== 'QUARTER'), actual };
}

function extractFromSentence(sent: string, fallbackPeriod: string): GuChange[] {
  const vals = findValues(sent);
  if (!vals.length) return [];
  const kws = findMetricKws(sent);
  const basis = basisOf(sent);
  const out: GuChange[] = [];
  let lastEnd = 0;
  const used = new Set<number>();

  const kwFor = (v: RawVal): Kw | null => {
    const adj = kws.find(k => k.start >= v.end && /^\s*(?:of\s+)?$/i.test(sent.slice(v.end, k.start)) && k.start - v.end <= 6 && !(sent.slice(v.end, v.end + 1) === '' ));
    if (adj && (v.scale || v.cur) && !v.pct) return adj; // "Rs 750 crore revenue": the noun right after the amount owns it
    const prior = kws.filter(k => k.end <= v.start && k.start >= lastEnd - 0);
    if (prior.length) { const k = prior[prior.length - 1]; if (v.start - k.end <= 140) return k; }
    const after = kws.find(k => k.start >= v.end && k.start - v.end <= 40);
    return after ?? null;
  };

  const finish = (kw: Kw, beforeV: RawVal | null, afterV: RawVal, flatBefore: boolean, from: number, to: number, synthetic = false) => {
    let metric = kw.metric;
    let pct = afterV.pct || (beforeV?.pct ?? false);
    // metric / unit sanity
    if (pct && metric === 'REVENUE') metric = 'REVENUE_GROWTH';
    if (pct && !PCT_OK_METRICS.has(metric)) return;                   // EPS/EBITDA/etc as % is not representable
    const cur = afterV.cur ?? beforeV?.cur ?? null;
    if (!pct && PCT_METRICS.has(metric)) {
      if (cur) return;                                                 // currency amount on a growth/margin metric
      pct = true;                                                      // bare "margin 24 vs 22" treated as %
    }
    if (pct && cur) return;
    if (beforeV && beforeV.cur && afterV.cur && beforeV.cur !== afterV.cur) return; // mixed currencies
    if (beforeV && !beforeV.pct && pct && !flatBefore && beforeV.cur) return;
    const target: ScaleKey | null = pct ? null : (afterV.scale ?? beforeV?.scale ?? null);
    const span = pct ? multiYearSpan(sent) : null;   // a multi-year growth rate is never a single-year figure
    const period = span?.period ? span.period : periodOf(sent, afterV.start, fallbackPeriod);
    const rawAfter = sent.slice(Math.min(kw.start, afterV.start), afterV.end).trim();
    const after = makePoint(metric, period, afterV, target, cur, pct, basis, rawAfter);
    if (span) { after.periodKind = 'MULTI_YEAR_CAGR'; if (span.years) after.periodYears = span.years; }
    let before: GuGuidancePoint | null = null;
    if (flatBefore) {
      before = { metric, period, low: 0, high: 0, midpoint: 0, isGrowthRate: true, unit: '%', basis, raw: 'flat' };
    } else if (beforeV) {
      before = makePoint(metric, period, beforeV, target, cur, pct, basis, sent.slice(beforeV.start, beforeV.end).trim());
      // zzz854: the old figure's OWN words: a period of its own, a single quarter, or a reported result (never assumed to be guidance)
      if (!synthetic) {
        const fc = figureContext(sent, beforeV);
        if (fc.ownPeriod && fc.ownPeriod !== period) before.period = fc.ownPeriod;
        if (fc.quarter) before.grain = 'QUARTER';
        if (fc.actual) before.valueKind = 'ACTUAL';
      }
    }
    if (before && span) { before.periodKind = 'MULTI_YEAR_CAGR'; if (span.years) before.periodYears = span.years; }
    // plausibility
    if (after.midpoint == null) return;
    if (before && before.midpoint != null) {
      if (pct) {
        if (Math.abs(after.midpoint - before.midpoint) > 60 || after.midpoint > 1000 || before.midpoint > 1000) return;
      } else {
        if (before.midpoint <= 0 || after.midpoint <= 0) return;
        const ratio = after.midpoint / before.midpoint;
        if (ratio < 0.2 || ratio > 5) return;                          // wildly inconsistent units
      }
    } else if (pct && after.midpoint > 1000) return;
    out.push(makeChange(before, after));
    lastEnd = to;
    void from;
  };

  // zzz847 paired multi-metric: "revenue of A and net profit of B, up from X and Y earlier" -> priors assigned to metrics by order.
  for (let i = 0; i + 1 < vals.length; i++) {
    let j = i;
    while (j + 1 < vals.length && PAIR_SEP.test(sent.slice(vals[j].end, vals[j + 1].start))) j++;
    const n = j - i + 1;
    if (n < 2 || i - n < 0) continue;
    if (!PRIOR_CUE.test(sent.slice(Math.max(0, vals[i].start - 28), vals[i].start))) continue;
    const afters = vals.slice(i - n, i); const priors = vals.slice(i, j + 1);
    if (afters.some(a => a.negative) || priors.some(p => p.negative)) continue;
    const picks: Kw[] = []; let ok = true;
    for (let k = 0; k < n; k++) {
      const lo = k === 0 ? 0 : afters[k - 1].end;
      const cand = kws.filter(w => w.start >= lo && w.end <= afters[k].start);
      const kw = cand[cand.length - 1];
      if (!kw || afters[k].start - kw.end > 60) { ok = false; break; }
      picks.push(kw);
    }
    if (!ok || new Set(picks.map(p => p.metric)).size !== n) continue;
    for (let k = 0; k < n; k++) { used.add(i - n + k); used.add(i + k); }
    for (let k = 0; k < n; k++) finish(picks[k], priors[k], afters[k], false, afters[k].start, priors[k].end);
    i = j;
  }

  for (let i = 0; i < vals.length; i++) {
    if (used.has(i)) continue;
    const v = vals[i];
    if (v.negative) { used.add(i); continue; }
    const kw = kwFor(v);
    const nxt = vals[i + 1];
    const winBefore = sent.slice(Math.max(0, v.start - 24), v.start);
    // flat-before: "growth of 3-5% versus flat previously"
    const tail = sent.slice(v.end, v.end + 40);
    const fm = FLAT_BEFORE.exec(tail);
    if (kw && fm && (PCT_METRICS.has(kw.metric) || kw.metric === 'REVENUE') && (v.pct || PCT_METRICS.has(kw.metric)) && !NEG_WORD.test(winBefore)) {
      used.add(i); finish(kw, null, v, true, v.start, v.end + fm[0].length); continue;
    }
    if (nxt && !nxt.negative && kw && !kws.some(k => k.start >= v.end && k.end <= nxt.start && sameMetricFamily(k.metric) !== sameMetricFamily(kw.metric))) { // never pair a prior that belongs to another metric
      const link = sent.slice(v.end, nxt.start);
      const reversed = /\bfrom\s*$/i.test(winBefore) && /^\s*(?:to|->|→)\s*$/i.test(link);
      const forward = !reversed && link.length <= 40 && LINK_TOKEN.test(link) && !LINK_BAD.test(link) && !/\band\b/i.test(link);
      if (reversed || forward) {
        const yearAgo = YEAR_AGO_AFTER.test(sent.slice(nxt.end, nxt.end + 30));
        const neg = NEG_WORD.test(sent.slice(Math.max(0, v.start - 30), v.start)) || NEG_WORD.test(link);
        if (!yearAgo && !neg) {
          used.add(i); used.add(i + 1);
          if (reversed) finish(kw, v, nxt, false, v.start, nxt.end); else finish(kw, nxt, v, false, v.start, nxt.end);
          continue;
        }
        used.add(i); used.add(i + 1); continue;
      }
    }
    // a single range "from $10.0 to $10.8 billion" (sep 'to', preceded by 'from', nothing after) = before -> after
    if (kw && v.sep === 'to' && /\bfrom\s*$/i.test(winBefore) && !(nxt && LINK_TOKEN.test(sent.slice(v.end, nxt.start)))) {
      const b: RawVal = { ...v, hi: v.lo, end: v.start + 1 }; const a: RawVal = { ...v, lo: v.hi, start: v.start + 1 };
      used.add(i); finish(kw, b, a, false, v.start, v.end, true); continue;
    }
    // lone value: only with a metric keyword and a "to / of / at / now" cue right before it
    if (kw && /(?:\bto|\bof|\bat|\bbe|\btargets?|\bbetween|\baround|\babout|:|\bnow|\bsees?|\bexpects?)\s*$/i.test(winBefore.replace(/[$₹€£]|Rs\.?\s*$/gi, '').trimEnd() + ' ')
        && !NEG_WORD.test(winBefore) && !/(analysts?|consensus|estimates?)/i.test(sent.slice(Math.max(0, v.start - 40), v.start))) {
      used.add(i); finish(kw, null, v, false, v.start, v.end); continue;
    }
    used.add(i);
  }
  // de-dup identical (metric, period, after mid)
  const seen = new Set<string>();
  return out.filter(c => { const k = `${c.metric}|${c.after.period}|${c.after.midpoint}|${c.before?.midpoint ?? 'x'}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function splitSentences(text: string): string[] {
  return text.replace(/\r/g, '\n').split(/(?<=[.!?])\s+(?=[A-Z₹$€£])|\n+|;\s+/).map(s => s.trim()).filter(Boolean);
}

/** Parse before/after guidance from free text. before may be null (then it is NOT an upgrade). Negative or "decline" guidance is skipped, never guessed. */
export function extractGuidance(text: string): GuChange[] {
  if (!text) return [];
  const fb = firstPeriod(text);
  const out: GuChange[] = [];
  for (const s of splitSentences(text)) out.push(...extractFromSentence(s, fb));
  const seen = new Set<string>();
  return out.filter(c => { const k = `${c.metric}|${c.after.period}|${c.after.midpoint}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------------------------------------------------------------------------------------------
// 1. isGuidanceUpgradeCandidate
// ---------------------------------------------------------------------------------------------
const ANALYST_RE = /\b(analysts?|brokers?|brokerages?|research (?:house|firm|analysts?)|street|goldman|jpmorgan|jp morgan|morgan stanley|citi(?:group)?|jefferies|nomura|kotak|motilal|hsbc|ubs|barclays|bernstein|macquarie|clsa|bofa|wells fargo|deutsche|credit suisse|iifl|axis securities|icici securities|sbi securities|nuvama|elara|ambit|emkay|prabhudas|anand rathi|kr choksey|sharekhan)\b/gi;
const RAISE_VERB = '(?:rais(?:es|ed|ing|e)|lift(?:s|ed|ing)?|increas(?:es|ed|ing|e)|hik(?:es|ed|ing|e)|upgrad(?:es|ed|ing|e)|boost(?:s|ed|ing)?|bump(?:s|ed|ing)?|ups|upped|nudg(?:es|ed) up|revis(?:es|ed|ing) (?:up|upward|higher)|expand(?:s|ed) (?:its )?(?:guidance|outlook))';
const GUIDE_NOUN = '(?:guidance|outlook|forecasts?|projections?|guidelines?|(?:full[- ]year |annual )?expectations|view|(?:revenue|sales|profit|earnings|ebitda|margin|production|volume|eps|growth|income) targets?)';
const RE_VERB_NOUN = new RegExp(`\\b(${RAISE_VERB})\\b([^;]{0,70}?)\\b${GUIDE_NOUN}\\b`, 'gi');
const RE_PASSIVE = new RegExp(`\\b(?:guidance|outlook|forecasts?|projections?)\\b[^;]{0,30}?\\b(?:was |is |has been |were )?(raised|lifted|increased|hiked|upgraded|boosted|revised (?:up|higher|upward))\\b(?![^;]{0,15}\\bby (?:analysts?|brokers?|brokerages?))`, 'i');
const RE_GUIDE_HIGHER = /\bguid(?:es|ed|ing)\s+(?:its\s+)?(?:\w+\s+){0,4}?(?:higher|upward|up)\b/i;
const RE_FLAT_TO_GROWTH = /\b(?:(?:from|after|versus|vs\.?|previously|earlier)\s+(?:a\s+)?(?:flat|stable|steady)\b[^;]{0,60}?\b(?:to|now)\b[^;]{0,25}?\b(?:growth|grow|increase|expand)|now\s+(?:expects?|sees?|guides?|forecasts?)\s+(?:\w+\s+){0,3}?(?:growth|to grow)[^;]{0,40}?(?:previously|earlier|prior|versus|vs\.?|from)\s+(?:a\s+)?(?:flat|stable|steady))/i;
const RE_NARROW_UP = /\bnarrow(?:s|ed|ing)?\b[^;]{0,80}?\b(?:rais|lift|higher|upward|increas|up\b)\w*[^;]{0,30}?\b(?:midpoint|mid-point|low end|lower end|bottom)/i;
const NEGATION = /\b(?:not|no|never|without|hasn'?t|didn'?t|won'?t|fails? to|failed to|unlikely to|declined to|refus\w+ to)\s+(?:\w+\s+){0,2}$/i;
const SPECULATION = /\b(?:may|might|could|would|should|expected to|likely to|poised to|set to|plans? to|proposes? to|considering|mulls?|if|whether|hopes? to|seeks? to|speculat\w+ (?:that )?(?:it )?)\s*(?:\w+\s+){0,2}$/i;
const OBJ_BAD = /\b(?:price targets?|target prices?|PT|ratings?|estimates?|stock|shares|recommendation|coverage|to (?:buy|overweight|outperform|neutral|hold|sell))\b/i;
const RUMOUR = /\b(?:rumou?rs?|rumou?red|unconfirmed|speculat\w+|reportedly|allegedly|hearsay|tweets?|tweeted|stocktwits|reddit|social media|telegram|whatsapp|sources? (?:say|said|familiar)|people familiar)\b/i;

function analystSubjectBefore(sent: string, idx: number): boolean {
  const seg = sent.slice(Math.max(0, idx - 35), idx);
  const re = new RegExp(ANALYST_RE.source, 'gi'); let m: RegExpExecArray | null; let last: RegExpExecArray | null = null;
  while ((m = re.exec(seg)) !== null) last = m;
  if (!last) return false;
  // zzz854: a broker word inside the company's own name ('Abercrombie & Fitch', 'Citi Trends') is not an analyst subject
  const base = Math.max(0, idx - 35);
  if (brokerWordIsCompanyName(sent, base + last.index, last[0].length)) return false;
  const tail = seg.slice(last.index + last[0].length);
  return !/\b(after|as|following|because|when|while|but|say|says|said|note|notes|noted|after)\b/i.test(tail);
}

function managementRaise(sent: string): string | null {
  const re = new RegExp(RE_VERB_NOUN.source, 'gi'); let m: RegExpExecArray | null;
  while ((m = re.exec(sent)) !== null) {
    const verbStart = m.index; const verbEnd = m.index + m[1].length;
    const before = sent.slice(Math.max(0, verbStart - 30), verbStart);
    if (NEGATION.test(before) || SPECULATION.test(before)) continue;
    if (analystSubjectBefore(sent, verbStart)) continue;
    const objTail = sent.slice(verbEnd, verbEnd + 22);
    if (OBJ_BAD.test(objTail)) continue;
    if (/\bprice\s+targets?\b/i.test(m[0])) continue;
    return 'Company raised its guidance';
  }
  const p = RE_PASSIVE.exec(sent);
  if (p && !analystSubjectBefore(sent, p.index + 1) && !ANALYST_RE.test(sent.slice(p.index, p.index + p[0].length + 20))) {
    ANALYST_RE.lastIndex = 0;
    if (!NEGATION.test(sent.slice(Math.max(0, p.index - 30), p.index + 12))) return 'Company guidance was raised';
  }
  ANALYST_RE.lastIndex = 0;
  const g = RE_GUIDE_HIGHER.exec(sent);
  if (g && !analystSubjectBefore(sent, g.index)) return 'Company guided higher';
  if (RE_FLAT_TO_GROWTH.test(sent) && !analystSubjectBefore(sent, 0)) return 'Company moved from flat to growth guidance';
  if (RE_NARROW_UP.test(sent)) return 'Company narrowed its range upward and raised the midpoint';
  return v2Raise(sent);
}

// zzz844 V2 detection: broader management-raise wording. Never needs consensus. Analyst / speculation / price-target guards stay.
const METRIC_W = '(?:revenues?|sales|top[- ]?line|turnover|profit|pat|net profit|net income|earnings|ebitda|ebit|eps|margins?|volumes?|order inflows?|order intake|order book|production)';
const RE_RAISE_METRIC = new RegExp(`\\b(${RAISE_VERB})\\b[^;]{0,60}?\\b${METRIC_W}\\b`, 'i');
const FWD_STRICT = /\b(?:guidance|outlook|forecasts?|targets?|projections?|expects?|expected to|now (?:expects?|sees?|forecasts?|targets?|projects?))\b/i;
const FY_TOKEN = /\b(?:FY\s?'?\d{2,4}|F\.?Y\.?\s?'?\d{2,4}|full[- ]year|fiscal(?: year)?\s*'?\d{2,4}|H[12]\s?FY)\b/i;
const RE_NOW_EXPECTS = /\bnow\s+(?:expects?|forecasts?|targets?|projects?|anticipates?|sees?|guides?|estimates?)\b/i;
const RE_HIGHER_EARLIER = /\b(?:expects?|sees?|forecasts?|targets?|anticipates?|projects?|guid\w+)\b[^;]{0,120}?\bhigher than\b[^;]{0,40}?\b(?:earlier|previous(?:ly)?|prior|before|initial|original|last (?:guidance|forecast|outlook))/i;
const RE_OUTLOOK_RAISED = /\b(?:outlook|guidance|forecasts?|targets?|projections?)\s+(?:has been |was |is |were )?(?:further |again |now )?(?:raised|lifted|increased|upgraded|hiked|revised (?:up|upward|higher))\b|\bfurther (?:raised|lifted|increased|upgraded|hiked)\b/i;
const RE_REVISE_UP = /\brevis(?:es|ed|ing)\b[^;]{0,60}?\b(?:guidance|outlook|forecasts?|targets?|expectations?|revenue|profit|ebitda|eps|margins?)\b[^;]{0,40}?\b(?:upward|higher|up)\b|\b(?:upward|higher) revision\b[^;]{0,30}?\b(?:guidance|outlook|forecasts?|targets?)/i;
const HISTORIC = /\b(?:reported|posted|delivered|recorded|quarter ended|year ended|rose|grew|jumped)\b/i;

function v2Raise(sent: string): string | null {
  ANALYST_RE.lastIndex = 0;
  const analystSent = ANALYST_RE.test(sent) && !COMPANY_CUE.test(sent);
  ANALYST_RE.lastIndex = 0;
  if (analystSent) return null;
  const guard = (idx: number): boolean => {
    const before = sent.slice(Math.max(0, idx - 30), idx);
    return !NEGATION.test(before) && !SPECULATION.test(before) && !analystSubjectBefore(sent, idx);
  };
  let m: RegExpExecArray | null;
  if ((m = RE_OUTLOOK_RAISED.exec(sent)) && guard(m.index) && !OBJ_BAD.test(sent.slice(m.index, m.index + 40))) return 'Company guidance was raised';
  if ((m = RE_REVISE_UP.exec(sent)) && guard(m.index) && !OBJ_BAD.test(m[0])) return 'Company revised its guidance upward';
  if ((m = RE_HIGHER_EARLIER.exec(sent)) && guard(m.index)) return 'Company now expects more than it said earlier';
  if ((m = RE_NOW_EXPECTS.exec(sent)) && guard(m.index)) {
    const chs = extractFromSentence(sent, firstPeriod(sent));
    const withBefore = chs.filter(c => c.before);
    if (withBefore.length ? withBefore.some(c => c.direction === 'UP') : /\b(?:higher|raised|increased|up from|upward|more than)\b/i.test(sent))
      return 'Company now expects more than it said earlier';
  }
  if ((m = RE_RAISE_METRIC.exec(sent)) && guard(m.index) && !OBJ_BAD.test(sent.slice(m.index + m[1].length, m.index + m[1].length + 22)) && !/\bprice\s+targets?\b/i.test(m[0])) {
    if (FWD_STRICT.test(sent) && !(HISTORIC.test(sent) && !/\b(?:guidance|outlook|forecasts?|targets?|expects?)\b/i.test(sent))) return 'Company raised its forward numbers';
    if (FY_TOKEN.test(sent) && !HISTORIC.test(sent) && extractFromSentence(sent, firstPeriod(sent)).some(c => c.direction === 'UP' && c.before)) return 'Company raised its forward numbers';
  }
  return null;
}

/** capex / dividend / hiring guidance is not an earnings upgrade unless the same sentence also raises an earnings measure. */
const NON_EARNINGS = /\b(?:capex|capital expenditures?|capital spending|capital outlay|dividends?|buy-?backs?|hiring|headcount|store (?:count|openings?)|share repurchases?)\b/i;
const EARN_W = /\b(?:revenues?|sales|top[- ]?line|turnover|profit|pat|net income|earnings|ebitda|ebit|eps|margins?|volumes?|order (?:inflows?|intake|book))\b/i;
const FORWARD_CUE = /\b(guid\w*|outlook|expects?|expected|sees?|forecasts?|projects?|projected|anticipat\w*|target|now)\b/i;
const COMPANY_CUE = /\b(company|management|the firm|guid\w*|outlook|now expects?|now sees?|it (?:now )?(?:expects?|sees?))\b/i;

/** INCLUDE only management-issued raises. Earnings beats, analyst/broker actions, price targets, price moves,
 *  government news, contracts without a guidance change, rumours, reiterated or cut guidance are excluded. */
export function isGuidanceUpgradeCandidate(c: GuCandidate): { include: boolean; reason: string; taxonomy: GuTaxonomy } {
  const r = isGuidanceUpgradeCandidate0(c);
  return { ...r, taxonomy: taxonomyOfReason(r.include, r.reason) };
}
/** zzz854: the taxonomy a candidate-level verdict implies. An included candidate only CLAIMS a raise: the numbers decide the final taxonomy. */
export function taxonomyOfReason(include: boolean, reason: string): GuTaxonomy {
  if (include) return 'formal_upgrade';
  if (/analyst|broker/i.test(reason)) return 'analyst_revision';
  if (/cut or lowered/i.test(reason)) return 'downgrade';
  if (/unchanged or reiterated/i.test(reason)) return 'reiteration';
  if (/earnings beat/i.test(reason)) return 'earnings_beat';
  if (/contract or order/i.test(reason)) return 'operational_disclosure';
  return 'qualitative_commentary';
}
function isGuidanceUpgradeCandidate0(c: GuCandidate): { include: boolean; reason: string } {
  const text = `${c.title ?? ''}. ${c.text ?? ''}`.replace(/[ \t]+/g, ' ');
  const sents = splitSentences(text);
  let raised: string | null = null;
  for (const s of sents) { if (NON_EARNINGS.test(s) && !EARN_W.test(s)) continue; const r = managementRaise(s); if (r) { raised = r; break; } }
  if (!raised) {
    // numeric fallback: "sees FY margin 24% versus 22% earlier" -> guidance moved up, from company words only
    const fb = firstPeriod(text);
    for (const s of sents) {
      if (!FORWARD_CUE.test(s)) continue;
      if (NON_EARNINGS.test(s) && !EARN_W.test(s)) continue;
      ANALYST_RE.lastIndex = 0;
      if (ANALYST_RE.test(s) && !COMPANY_CUE.test(s)) { ANALYST_RE.lastIndex = 0; continue; }
      ANALYST_RE.lastIndex = 0;
      if (/\b(?:beats?|topped|reported|posted|rose|jumped)\b/i.test(s) && !/\b(?:guid\w*|outlook|now expects?|now sees?)\b/i.test(s)) continue;
      const up = extractFromSentence(s, fb).find(ch => ch.direction === 'UP' && ch.before);
      if (up) { raised = 'Company guidance moved up (before and after numbers found)'; break; }
    }
  }
  if (raised) {
    if (RUMOUR.test(text) && !(c.kind && PRIMARY_KINDS.has(c.kind))) return { include: false, reason: 'Rumour or social claim, not a company announcement' };
    return { include: true, reason: raised };
  }
  const t = text;
  // zzz854: a broker / analyst as the subject of the raise verb ('Jefferies raises Zed FY27 EBITDA forecast') is an analyst revision
  const brokerSubject = sents.some(s => { const m = /\b(?:rais|lift|hik|upgrad|boost|increas|revis)\w*/i.exec(s); return !!m && analystSubjectBefore(s, m.index); });
  if (brokerSubject || /(price targets?|target price|\bPT\b|buy rating|initiat\w+ coverage|downgrad\w+|upgrad\w+ (?:to|on)|analysts?\s+(?:rais|upgrad|lift|hik)\w*|brokerages?\s+(?:rais|upgrad|lift|hik)\w*|overweight|outperform rating)/i.test(t))
    return { include: false, reason: 'Analyst or broker action (rating or price target), not company guidance' };
  if (RUMOUR.test(t)) return { include: false, reason: 'Rumour or social claim, not a company announcement' };
  if (/\b(?:cut|lower(?:s|ed)?|reduc\w+|trim\w*|slash\w*|withdr\w+|warn\w*)\b[^.;]{0,40}\b(?:guidance|outlook|forecasts?)\b|profit warning|guidance (?:cut|lowered|reduced|slashed)/i.test(t))
    return { include: false, reason: 'Guidance was cut or lowered, not raised' };
  if (/\b(?:reiterat\w+|maintain\w*|unchanged|affirm\w*|reaffirm\w*|kept|keeps|leaves|left|stands? by|no change)\b[^.;]{0,50}\b(?:guidance|outlook|forecasts?)\b|\b(?:guidance|outlook|forecasts?)\b[^.;]{0,40}\b(?:unchanged|maintained|reiterated|affirmed|intact)\b/i.test(t))
    return { include: false, reason: 'Guidance was unchanged or reiterated' };
  if (/\b(?:beats?|topped|tops|surpass\w*|exceed\w*)\b[^.;]{0,30}\b(?:consensus|estimates?|expectations|forecasts?)\b/i.test(t))
    return { include: false, reason: 'Earnings beat without a guidance raise' };
  if (/\b(?:shares?|stock)\s+(?:jump|surg|rall|soar|climb|gain|hit|rise|rose)\w*|52-?week high|breakout|technical|golden cross|moving average|resistance|\brsi\b/i.test(t))
    return { include: false, reason: 'Stock price move or technical signal, not guidance' };
  if (/\b(?:government|ministry|cabinet|regulator|policy|budget|tariff|subsid\w+)\b/i.test(t))
    return { include: false, reason: 'Government or policy news without company guidance' };
  if (/\b(?:wins?|bags?|secures?|awarded|order|contract)\b/i.test(t))
    return { include: false, reason: 'New contract or order without an explicit guidance change' };
  if (/\b(?:confident|optimistic|positive|upbeat|bullish|strong)\b/i.test(t))
    return { include: false, reason: 'Positive commentary without a measurable forward number' };
  return { include: false, reason: 'No management guidance raise found' };
}

// ---------------------------------------------------------------------------------------------
// 3. classifyType
// ---------------------------------------------------------------------------------------------
type Family = 'REVENUE' | 'PROFIT' | 'MARGIN' | 'CASH' | 'VOLUME' | 'ORDER' | 'OTHER';
const PROFIT_WORDS = /\b(net profit|net income|profit after tax|pat|net earnings|earnings|profit)\b/i;
function isProfitOther(c: GuChange): boolean {
  return c.metric === 'OTHER' && PROFIT_WORDS.test(`${c.after.raw ?? ''}`);
}
function familyOf(c: GuChange): Family {
  switch (c.metric) {
    case 'REVENUE': case 'REVENUE_GROWTH': case 'ORGANIC_GROWTH': return 'REVENUE';
    case 'EBITDA': case 'EBIT': case 'EPS': case 'ADJ_EPS': case 'NET_PROFIT': return 'PROFIT';
    case 'OP_MARGIN': return 'MARGIN';
    case 'FCF': case 'FCF_CONVERSION': return 'CASH';
    case 'VOLUME': case 'PRODUCTION': case 'CAPACITY_UTIL': return 'VOLUME';
    case 'ORDER_INTAKE': case 'BACKLOG': return 'ORDER';
    case 'OTHER': return isProfitOther(c) ? 'PROFIT' : 'OTHER';
    default: return 'OTHER';
  }
}
/** A revenue, B profit/earnings, C margin, D cash flow, E volume/production, F order/backlog, G = 2+ distinct families. */
export function classifyType(changes: GuChange[]): GuType {
  const fams = new Set<Family>();
  for (const c of changes) { const f = familyOf(c); if (f !== 'OTHER') fams.add(f); }
  if (fams.size >= 2) return 'G_MULTI_METRIC';
  const f = [...fams][0];
  switch (f) {
    case 'REVENUE': return 'A_REVENUE'; case 'PROFIT': return 'B_PROFIT'; case 'MARGIN': return 'C_MARGIN';
    case 'CASH': return 'D_CASHFLOW'; case 'VOLUME': return 'E_VOLUME'; case 'ORDER': return 'F_ORDER_BACKLOG';
    default: return 'A_REVENUE'; // no recognised family: neutral default; the event still carries evidenceGaps
  }
}

// ---------------------------------------------------------------------------------------------
// 4. classifyDriver
// ---------------------------------------------------------------------------------------------
export type GuDriverKind =
  | 'ORGANIC_DEMAND' | 'VOLUME' | 'PRICING_POWER' | 'SHARE_GAIN' | 'STRUCTURAL' | 'CAPACITY' | 'MIX' | 'RECURRING' | 'BACKLOG'
  | 'FX' | 'ACQUISITION' | 'TEMP_SUPPLY' | 'COST_SAVINGS' | 'ONE_OFF_PRICING' | 'PRICE_HIKE' | 'COMMODITY'
  | 'TAX_BENEFIT' | 'ONE_TIME_ITEM' | 'ASSET_SALE' | 'COST_REVERSAL' | 'FIN_ENGINEERING';
export interface GuDriverResult { quality: GuQuality; driver: string; evidence: GuEvidence; kinds: GuDriverKind[] }

const DRIVER_RULES: Array<{ kind: GuDriverKind; q: 'HIGH' | 'MEDIUM' | 'LOW'; re: RegExp; label: string }> = [
  { kind: 'TAX_BENEFIT', q: 'LOW', label: 'a tax benefit', re: /\b(?:tax (?:benefit|credit|gain|write[- ]?back|reversal|refund|settlement|holiday|incentive)|(?:lower|reduced|favou?rable|one[- ]?time) (?:effective )?tax(?: rate)?|deferred tax (?:asset|benefit)|tax rate (?:reduction|cut|benefit))\b/i },
  { kind: 'ONE_TIME_ITEM', q: 'LOW', label: 'a one-time item', re: /\b(?:one[- ]?time|one[- ]?off|non[- ]?recurring|exceptional (?:gain|item|income)|accounting (?:change|gain|adjustment|benefit)|reclassification|provision (?:write[- ]?back|reversal|release)|write[- ]?back)\b(?!\s+(?:pric|surcharge|contract|order))/i },
  { kind: 'ASSET_SALE', q: 'LOW', label: 'the sale of an asset', re: /\b(?:(?:asset|property|stake|land|business|subsidiary) sale|sale of (?:an? )?(?:asset|property|stake|land|unit|business|subsidiary)|divestiture gain|gain on (?:sale|disposal))\b/i },
  { kind: 'COST_REVERSAL', q: 'LOW', label: 'a reversal of past costs', re: /\b(?:(?:cost|expense|accrual|bonus|provision) (?:reversal|release)|reversal of (?:cost|expense|provision|accrual))\b/i },
  { kind: 'FIN_ENGINEERING', q: 'LOW', label: 'financial engineering such as share buybacks', re: /\b(?:share (?:buy[- ]?backs?|repurchases?)|buy[- ]?backs?|financial engineering|lower (?:interest|finance) (?:cost|expense)s?)\b/i },
  { kind: 'ONE_OFF_PRICING', q: 'MEDIUM', label: 'one-off pricing', re: /\b(?:one[- ]?time|one[- ]?off|temporary|spot)\s+(?:pric\w+|surcharges?)\b/i },
  { kind: 'FX', q: 'MEDIUM', label: 'currency moves', re: /\b(?:(?:currency|foreign exchange|forex|fx)(?: tailwinds?| benefits?| gains?| translation| movements?| rates?| effects?)|favou?rable (?:currency|exchange)|weaker (?:rupee|dollar|euro|yen)|stronger (?:dollar|rupee|euro))\b/i },
  { kind: 'ACQUISITION', q: 'MEDIUM', label: 'an acquisition', re: /\b(?:acquisitions?|acquired|bolt-?on|consolidation of|inorganic)\b/i },
  { kind: 'TEMP_SUPPLY', q: 'MEDIUM', label: 'a temporary supply shortage', re: /\b(?:temporary|supply (?:constraints?|disruptions?|shortages?|tightness)|competitor outage|short-?term supply)\b/i },
  { kind: 'COST_SAVINGS', q: 'MEDIUM', label: 'cost savings', re: /\b(?:cost (?:savings?|reductions?|cutting|efficienc\w+)|efficiency (?:programme|program|gains)|restructuring savings|lower costs?)\b/i },
  { kind: 'COMMODITY', q: 'MEDIUM', label: 'commodity price moves', re: /\b(?:commodity|raw material (?:prices?|costs?)|input costs?|steel prices?|oil prices?|crude|metal prices?)\b/i },
  { kind: 'PRICE_HIKE', q: 'MEDIUM', label: 'higher selling prices (how long they last is not stated)', re: /\b(?:price (?:hikes?|increases?)|higher (?:selling )?prices|higher realisations?|higher realizations?|price realisations?)\b/i },
  { kind: 'PRICING_POWER', q: 'HIGH', label: 'pricing power', re: /\b(?:pricing power|pricing strength|pricing gains?)\b/i },
  { kind: 'ORGANIC_DEMAND', q: 'HIGH', label: 'stronger customer demand', re: /\b(?:organic (?:growth|demand)|underlying (?:growth|demand)|(?:strong(?:er)?|robust|record|healthy) demand|demand (?:strength|momentum|pick-?up|recovery|acceleration)|higher demand|customer demand)\b/i },
  { kind: 'VOLUME', q: 'HIGH', label: 'higher volumes', re: /\b(?:higher volumes?|volume (?:growth|increases?|gains?)|volumes? (?:growth|increase|up|rose)|strong volumes?)\b/i },
  { kind: 'SHARE_GAIN', q: 'HIGH', label: 'market share gains', re: /\b(?:market[- ]share (?:gains?|expansion|wins?)|gain(?:ing|ed)? (?:market )?share|share gains?)\b/i },
  { kind: 'STRUCTURAL', q: 'HIGH', label: 'structural (long-lasting) demand', re: /\b(?:structural (?:demand|growth|tailwinds?|shift)|secular|multi-?year (?:demand|growth|cycle|tailwinds?))\b/i },
  { kind: 'CAPACITY', q: 'HIGH', label: 'new or better-used capacity', re: /\b(?:capacity (?:expansion|additions?|ramp(?:-?up)?)|(?:new|expanded) (?:plant|line|facility|capacity)|utili[sz]ation|commission(?:ing|ed))\b/i },
  { kind: 'MIX', q: 'HIGH', label: 'a better product mix', re: /\b(?:(?:richer|favou?rable|better|premium|improved|product|value-added) mix|mix (?:improvement|shift)|premiumi[sz]ation)\b/i },
  { kind: 'RECURRING', q: 'HIGH', label: 'recurring customers and revenue', re: /\b(?:recurring (?:revenue|customers?)|repeat (?:orders|customers?)|subscriptions?|renewals?)\b/i },
  { kind: 'BACKLOG', q: 'HIGH', label: 'a larger order backlog', re: /\b(?:multi-?year (?:backlog|order book|contracts?)|order (?:book|backlog|pipeline)|record backlog|backlog|orders? inflows?)\b/i },
];
const LOW_KINDS = new Set<GuDriverKind>(['TAX_BENEFIT', 'ONE_TIME_ITEM', 'ASSET_SALE', 'COST_REVERSAL', 'FIN_ENGINEERING']);
const CAUSAL_CUE = /\b(?:driven by|due to|because of|reflecting|on account of|thanks to|owing to|led by|supported by|attributable to|as a result of|helped by|citing|cited|from|on the back of|boosted by|benefit(?:ing)? from)\b/i;

export function classifyDriver(text: string): GuDriverResult {
  const t = text ?? '';
  const hits = DRIVER_RULES.filter(r => r.re.test(t));
  if (!hits.length) return { quality: 'UNKNOWN', driver: 'Driver not stated in the source', evidence: 'INCOMPLETE', kinds: [] };
  const hasHigh = hits.some(h => h.q === 'HIGH'); const hasMed = hits.some(h => h.q === 'MEDIUM'); const hasLow = hits.some(h => h.q === 'LOW');
  let quality: GuQuality;
  if (hasLow) quality = hasHigh ? 'MEDIUM' : 'LOW';
  else if (hasHigh && !hasMed) quality = 'HIGH';
  else quality = 'MEDIUM';
  let labels = hits.map(h => h.label);
  const tax = hits.find(h => h.kind === 'TAX_BENEFIT'); const one = hits.find(h => h.kind === 'ONE_TIME_ITEM');
  if (tax && one) labels = labels.filter(l => l !== one.label && l !== tax.label).concat('a one-time tax benefit');
  const uniq = [...new Set(labels)].slice(0, 3);
  let driver = uniq.length === 1 ? uniq[0] : `${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`;
  driver = driver.charAt(0).toUpperCase() + driver.slice(1);
  if (hasLow && hasHigh) driver += ' (mixed: part of it is one-off)';
  const sents = splitSentences(t);
  const direct = hits.some(h => sents.some(s => h.re.test(s) && CAUSAL_CUE.test(s)));
  return { quality, driver, evidence: direct ? 'DIRECT' : 'INDIRECT', kinds: hits.map(h => h.kind) };
}


/** zzz853: a sentence names a multi-year contract / order book / backlog AND says it drives the guided number (revenue, sales, growth, guidance) with a causal or conversion cue. */
const CONTRACT_TERM = /\b(?:multi-?year|long-term|\d[- ]year|three-year|five-year)\s+(?:\w+\s+){0,2}?(?:contracts?|agreements?|orders?|order book|backlog)\b|\b(?:order book|backlog)\b[^.;]{0,50}\b(?:multi-?year|over (?:the next )?\d+ years)\b/i;
const MECHANISM_LINK = /\b(?:revenues?|sales|top[- ]?line|turnover|growth|guidance|outlook|execution|conversion|convert\w*|translat\w*|recogni[sz]\w*|drives?|driving|driven by|underpin\w*|supports?|supported by|visibility|reflect\w*)\b/i;
export function contractIsMechanism(text: string): boolean {
  return splitSentences(text ?? '').some(sn => CONTRACT_TERM.test(sn) && MECHANISM_LINK.test(sn) && /\b(?:driven by|due to|because of|reflect\w*|supported by|supports?|fuels?|lifts?|underpin\w*|visibility|convert\w*|translat\w*|execution|drives?|driving|led by|backed by|on the back of|leads? to|will (?:be )?(?:recogni[sz]ed|execut\w+))\b/i.test(sn));
}

// ---------------------------------------------------------------------------------------------
// 5. classifyDuration
// ---------------------------------------------------------------------------------------------
/** ONE_OFF when every stated driver is a one-time type; MULTI_YEAR for multi-year backlog, structural+capacity or stated multi-year;
 *  MULTI_QUARTER only when stated (next quarters / second half / rest of the year); otherwise UNKNOWN. Never inferred from price. */
export function classifyDuration(text: string, changes: GuChange[], driver: GuDriverResult): GuDuration {
  const t = text ?? ''; const k = new Set(driver.kinds);
  const allLow = driver.kinds.length > 0 && driver.kinds.every(x => LOW_KINDS.has(x));
  if (allLow) return 'ONE_OFF';
  if (/\b(?:one[- ]?time|one[- ]?off|non[- ]?recurring)\b(?!\s+(?:pric|contract|order))/i.test(t) && !k.has('STRUCTURAL') && !k.has('BACKLOG')) return 'ONE_OFF';
  // zzz853: 'several years' only when the multi-year contract / backlog is the stated MECHANISM of the guided metric (same sentence: the contract
  // or backlog, a link to revenue / orders / the guidance, and a causal or conversion cue). Generic multi-year contract wording elsewhere is not enough.
  const multiYearText = /\b(?:multi-?year|over the next (?:3|three|4|four|5|five|several) years|3-5 years|five-year|long-term contracts?|through FY\s?\d{2})\b/i.test(t);
  if ((k.has('BACKLOG') && multiYearText && contractIsMechanism(t)) || (k.has('STRUCTURAL') && k.has('CAPACITY'))) return 'MULTI_YEAR';
  const years = new Set(changes.map(c => /FY\d{2}/.exec(c.after.period)?.[0]).filter(Boolean));
  if (years.size >= 2) return 'MULTI_YEAR';
  if (/\b(?:(?:next|coming|following) (?:few |two |three |several )?quarters|second half|\bH2\b|rest of the (?:fiscal )?year|remainder of (?:the )?(?:fiscal )?year|through the year)\b/i.test(t)) return 'MULTI_QUARTER';
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------------------------
// 7. canonicalKey + mergeCandidates
// ---------------------------------------------------------------------------------------------
export function canonicalKey(ticker: string, metric: GuMetric | string, period: string, announcementDate: string): string {
  return `${(ticker || '').trim().toUpperCase()}|${metric}|${(period || 'UNSTATED').toUpperCase().replace(/\s+/g, '')}|${isoDate(announcementDate) || announcementDate.slice(0, 10)}`;
}

export interface GuSkeleton {
  canonical_key: string; guidance_event_id: string;
  ticker: string; company: string; market: GuMarket;
  announcement_date: string; announcement_timestamp?: string;
  sources: GuSourceRef[]; candidates: GuCandidate[];
  changes: GuChange[];             // latest value per metric
  history: GuLedgerRow[];          // one row per raise seen in the batch
  flags: GuFlag[];                 // SECOND_UPGRADE_IN_WINDOW when applicable
  text: string;                    // combined title + body of all merged candidates
  /** zzz857: set when the skeleton was built from AI-extracted, quote-checked rows of the company's own document (the candidate-level text verdicts are not used: the document's own status is) */
  extracted?: { docId: string; raisedNoPrior: boolean; metrics: string[] };
}

const METRIC_PRIORITY: GuMetric[] = ['REVENUE', 'EPS', 'ADJ_EPS', 'EBITDA', 'EBIT', 'NET_PROFIT', 'OTHER', 'OP_MARGIN', 'REVENUE_GROWTH', 'ORGANIC_GROWTH', 'FCF', 'FCF_CONVERSION', 'ORDER_INTAKE', 'BACKLOG', 'VOLUME', 'PRODUCTION', 'CAPACITY_UTIL'];

function rowsFromChanges(changes: GuChange[], date: string): GuLedgerRow[] {
  return changes.filter(c => c.before).map(c => {
    const narrowed = c.before && c.before.low != null && c.before.high != null && c.after.low != null && c.after.high != null
      && (c.after.high - c.after.low) < (c.before.high - c.before.low);
    let change: GuLedgerRow['change'] = 'REITERATED';
    if (c.direction === 'UP') change = narrowed ? 'NARROWED_UP' : 'RAISED';
    else if (c.direction === 'DOWN') change = narrowed ? 'NARROWED_DOWN' : 'CUT';
    return {
      date, metric: c.metric, period: c.after.period, text: fmtPoint(c.after), change,
      revisionPct: c.direction === 'UNKNOWN' ? null : (c.after.isGrowthRate ? c.percentagePointChange : c.percentageChange),
    };
  });
}

interface Cand { c: GuCandidate; date: string; changes: GuChange[]; ticker: string; tier: GuSourceTier }
interface Step { date: string; ts?: string; cands: Cand[]; changes: Map<string, GuChange> }
interface Group { ticker: string; company: string; market: GuMarket; steps: Step[]; metrics: Set<GuMetric>; period: string }

const chKey = (c: GuChange) => `${c.metric}|${c.after.period}`;
function tickerOf(c: GuCandidate): string {
  const t = (c.ticker ?? '').trim().toUpperCase();
  if (t) return t;
  return (c.company ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function preferChange(existing: GuChange | undefined, next: GuChange, nextPrimary: boolean, existingPrimary: boolean): GuChange {
  if (!existing) return next;
  if (!existing.before && next.before) return next;
  if (existing.before && !next.before) return existing;
  if (nextPrimary && !existingPrimary) return next;
  return existing;
}

function buildGroups(cands: GuCandidate[], forceOne: boolean): Group[] {
  const list: Cand[] = cands
    .map(c => ({ c, date: isoDate(c.eventDate || c.publishedAt), ticker: tickerOf(c), changes: extractGuidance(`${c.title}. ${c.text}`), tier: sourceTier(c.sourceName, c.kind, c.url) }))
    .filter(x => x.ticker && x.date)
    .sort((a, b) => a.date.localeCompare(b.date) || b.changes.length - a.changes.length);
  const groups: Group[] = [];
  const noMetric: Cand[] = [];
  const place = (x: Cand) => {
    const ms = new Set(x.changes.map(c => c.metric));
    const per = x.changes[0]?.after.period ?? 'UNSTATED';
    for (const g of groups) {
      if (g.ticker !== x.ticker) continue;
      if (!forceOne) {
        if (![...ms].some(m => g.metrics.has(m))) continue;
        if (g.period !== 'UNSTATED' && per !== 'UNSTATED' && g.period !== per) continue;
      }
      const last = g.steps[g.steps.length - 1];
      const dd = Math.abs(dayNum(x.date) - dayNum(last.date));
      const sameNumbers = x.changes.some(c => { const lc = [...last.changes.values()].find(l => chKey(l) === chKey(c)); return lc && lc.after.midpoint === c.after.midpoint && (!lc.before || !c.before || lc.before.midpoint === c.before.midpoint); });   // zzz849: an outlet that quotes only the new figure repeats the same announcement
      if (forceOne || dd <= 1 || sameNumbers) { addToStep(g, last, x); return; }
      // second raise: later date, before equals previous after
      const isLater = dayNum(x.date) > dayNum(last.date);
      const follows = isLater && x.changes.some(c => {
        const lc = [...last.changes.values()].find(l => chKey(l) === chKey(c));
        if (!lc || !c.before || lc.after.midpoint == null || c.before.midpoint == null || lc.after.midpoint === 0) return false;
        return Math.abs(c.before.midpoint - lc.after.midpoint) / Math.abs(lc.after.midpoint) * 100 <= GU_THRESHOLDS.SECOND_RAISE_TOL_PCT
          && c.direction === 'UP';
      });
      if (follows) {
        const step: Step = { date: x.date, ts: x.c.eventDate ? undefined : x.c.publishedAt, cands: [], changes: new Map() };
        g.steps.push(step); addToStep(g, step, x); return;
      }
    }
    groups.push({ ticker: x.ticker, company: x.c.company ?? x.ticker, market: x.c.market, steps: [], metrics: new Set(), period: per });
    const g = groups[groups.length - 1];
    const step: Step = { date: x.date, ts: x.c.eventDate ? undefined : x.c.publishedAt, cands: [], changes: new Map() };
    g.steps.push(step); addToStep(g, step, x);
  };
  const addToStep = (g: Group, step: Step, x: Cand) => {
    step.cands.push(x);
    if (x.date < step.date) { step.date = x.date; step.ts = x.c.eventDate ? undefined : x.c.publishedAt; }
    for (const ch of x.changes) {
      const k = chKey(ch);
      const ex = step.changes.get(k);
      const exPrimary = ex ? step.cands.some(o => o !== x && o.tier === 'PRIMARY' && o.changes.some(oc => chKey(oc) === k)) : false;
      step.changes.set(k, preferChange(ex, ch, x.tier === 'PRIMARY', exPrimary));
      g.metrics.add(ch.metric);
    }
    if (g.period === 'UNSTATED' && x.changes[0]) g.period = x.changes[0].after.period;
    if (x.c.company && (!g.company || g.company === g.ticker)) g.company = x.c.company;
  };
  for (const x of list) { if (x.changes.length === 0) noMetric.push(x); else place(x); }
  for (const x of noMetric) {
    const same = groups.filter(g => g.ticker === x.ticker);
    if (same.length >= 1 || forceOne) {
      // attach to the group whose latest step is nearest in time (ties: first)
      const g = same.slice().sort((a, b) => Math.abs(dayNum(a.steps[a.steps.length - 1].date) - dayNum(x.date)) - Math.abs(dayNum(b.steps[b.steps.length - 1].date) - dayNum(x.date)))[0];
      // zzz849: a number-less outlet repeating the announcement can run up to 3 days AFTER it (news lags the filing); the event keeps the EARLIEST (announcement) date, never the repost date
      const gap = g ? dayNum(x.date) - dayNum(g.steps[g.steps.length - 1].date) : 0;
      if (g && (forceOne || (gap >= -1 && gap <= 3))) { g.steps[g.steps.length - 1].cands.push(x); continue; }
    }
    const g: Group = { ticker: x.ticker, company: x.c.company ?? x.ticker, market: x.c.market, steps: [{ date: x.date, ts: x.c.eventDate ? undefined : x.c.publishedAt, cands: [x], changes: new Map() }], metrics: new Set(), period: 'UNSTATED' };
    groups.push(g);
  }
  return groups;
}

function sourcesOf(cands: Cand[]): GuSourceRef[] {
  const seen = new Set<string>(); const out: GuSourceRef[] = [];
  for (const x of cands) {
    const key = (x.c.url ?? '') || `${x.c.sourceName}|${x.date}`;
    if (seen.has(key)) continue; seen.add(key);
    out.push({ url: x.c.url, name: x.c.sourceName, tier: x.tier, type: sourceTypeLabel(x.c.sourceName, x.c.kind, x.c.url), date: x.date });
  }
  const order: Record<GuSourceTier, number> = { PRIMARY: 0, SECONDARY: 1, DISCOVERY: 2 };
  return out.sort((a, b) => order[a.tier] - order[b.tier]);
}

function skeletonOf(g: Group): GuSkeleton {
  const first = g.steps[0]; const latest = g.steps[g.steps.length - 1];
  const allCands = g.steps.flatMap(s => s.cands);
  // latest value per metric across steps
  const latestByKey = new Map<string, GuChange>();
  for (const s of g.steps) for (const [k, ch] of s.changes) latestByKey.set(k, ch);
  const changes = [...latestByKey.values()].sort((a, b) => METRIC_PRIORITY.indexOf(a.metric) - METRIC_PRIORITY.indexOf(b.metric));
  const history = g.steps.flatMap(s => rowsFromChanges([...s.changes.values()], s.date));
  const primaryMetric = [...g.metrics].sort((a, b) => METRIC_PRIORITY.indexOf(a) - METRIC_PRIORITY.indexOf(b))[0] ?? 'OTHER';
  const key = canonicalKey(g.ticker, primaryMetric, g.period, first.date);
  const texts: string[] = []; const seenT = new Set<string>();
  for (const x of allCands) { const t = `${x.c.title}. ${x.c.text}`; if (!seenT.has(t)) { seenT.add(t); texts.push(t); } }
  const withTs = latest.cands.filter(x => x.c.publishedAt.length > 10 && !x.c.eventDate).sort((a, b) => a.c.publishedAt.localeCompare(b.c.publishedAt))[0];
  return {
    canonical_key: key, guidance_event_id: stableId(key), ticker: g.ticker, company: g.company, market: g.market,
    announcement_date: latest.date, announcement_timestamp: withTs?.c.publishedAt,
    sources: sourcesOf(allCands), candidates: allCands.map(x => x.c), changes, history,
    flags: g.steps.length > 1 ? ['SECOND_UPGRADE_IN_WINDOW'] : [], text: texts.join('\n'),
  };
}

/** One skeleton per canonical event. Same announcement in many outlets = one event with many sources.
 *  A later raise of the same metric whose "before" equals the earlier "after" updates history + adds SECOND_UPGRADE_IN_WINDOW. */
export function mergeCandidates(candidates: GuCandidate[]): GuSkeleton[] {
  return buildGroups(candidates, false).map(skeletonOf);
}

// ---------------------------------------------------------------------------------------------
// 8. computeGap
// ---------------------------------------------------------------------------------------------
/** consensus null -> UNKNOWN (never negative). gapPct = (guidance mid - consensus) / consensus.
 *  < -0.5% NEGATIVE (even though guidance went up) | -0.5..+2 INLINE | +2..+5 POSITIVE | >= +5 LARGE_POSITIVE.
 *  SMALL_POSITIVE only when 0..+2 AND the caller says the market expected more than the old guidance
 *  (marketPrevExpectation > guidanceBefore), i.e. the raise closed a gap that was already priced. */
export function computeGap(guidanceMid: number | null, consensus: number | null, opts?: { guidanceBefore?: number | null; marketPrevExpectation?: number | null }): { gap: GuGap; gapPct: number | null } {
  if (guidanceMid == null || consensus == null || !isFinite(guidanceMid) || !isFinite(consensus) || consensus === 0) return { gap: 'UNKNOWN', gapPct: null };
  const pct = ((guidanceMid - consensus) / Math.abs(consensus)) * 100;
  const gapPct = round(pct, 1);
  if (pct < GU_THRESHOLDS.GAP_INLINE_FLOOR_PCT) return { gap: 'NEGATIVE', gapPct };
  if (pct >= GU_THRESHOLDS.GAP_LARGE_POSITIVE_PCT) return { gap: 'LARGE_POSITIVE', gapPct };
  if (pct >= GU_THRESHOLDS.GAP_POSITIVE_PCT) return { gap: 'POSITIVE', gapPct };
  const gb = opts?.guidanceBefore; const mp = opts?.marketPrevExpectation;
  if (pct >= 0 && gb != null && mp != null && mp > gb) return { gap: 'SMALL_POSITIVE', gapPct };
  return { gap: 'INLINE', gapPct };
}

// ---------------------------------------------------------------------------------------------
// 9. computeImpacts
// ---------------------------------------------------------------------------------------------
const upWithBefore = (c: GuChange) => !!c.before && c.direction !== 'UNKNOWN';
function diffNumber(c: GuChange, what: string): GuNumber {
  const unit = unitOf(c.after);
  const b = c.before!.midpoint!; const a = c.after.midpoint!;
  return {
    value: c.absoluteChange, unit, label: 'COMPANY_GUIDANCE',
    source: `Company guidance for ${c.after.period}${c.after.raw ? `: "${c.after.raw}"` : ''}`,
    formula: `New ${what} guidance midpoint (${fmtNum(a)}) minus old midpoint (${fmtNum(b)})`,
  };
}
export function computeImpacts(changes: GuChange[], ctx: GuContext): { revenueImpact: GuNumber; ebitdaImpact: GuNumber; epsImpact: GuNumber; fcfImpact: GuNumber } {
  const find = (ms: GuMetric[]) => changes.find(c => ms.includes(c.metric) && upWithBefore(c) && c.absoluteChange != null);
  const noBefore = 'Previous guidance not found, so no change can be calculated';
  const rev = find(['REVENUE']) ?? find(['REVENUE_GROWTH', 'ORGANIC_GROWTH']);
  let revenueImpact: GuNumber;
  if (rev) revenueImpact = diffNumber(rev, rev.after.isGrowthRate ? 'revenue growth' : 'revenue');
  else revenueImpact = na('UNAVAILABLE', changes.some(c => c.metric === 'REVENUE' && !c.before) ? noBefore : 'No revenue guidance found');
  if (rev && rev.after.isGrowthRate) revenueImpact.unit = 'pp';

  const eb = find(['EBITDA']);
  let ebitdaImpact: GuNumber;
  if (eb) ebitdaImpact = diffNumber(eb, 'EBITDA');
  else {
    const revAbs = find(['REVENUE']);
    const guidedMargin = changes.find(c => c.metric === 'OP_MARGIN' && c.after.midpoint != null);
    const margin = guidedMargin ? { v: guidedMargin.after.midpoint as number, src: `guided operating margin for ${guidedMargin.after.period}` }
      : ctx.reportedMargin && isFinite(ctx.reportedMargin.value) ? { v: ctx.reportedMargin.value, src: `reported margin (${ctx.reportedMargin.source})` } : null;
    if (revAbs && margin && revAbs.absoluteChange != null && margin.v > 0) {
      const v = round(revAbs.absoluteChange * margin.v / 100, 4);
      ebitdaImpact = {
        value: v, unit: unitOf(revAbs.after), label: 'MODEL_ESTIMATE', source: `Our estimate, not company guidance (uses ${margin.src})`,
        formula: `Extra revenue (${fmtNum(revAbs.absoluteChange)}) x margin (${fmtNum(margin.v)}%) = ${fmtNum(v)}`,
        assumptions: ['The extra revenue earns the same margin as the stated margin', 'No change in other costs', 'This is our model, not a company number'],
      };
    } else ebitdaImpact = na('UNAVAILABLE', 'No EBITDA guidance, and no incremental revenue with a stated margin to estimate from');
  }
  const ep = find(['ADJ_EPS']) ?? find(['EPS']);   // zzz854: adjusted first (the emphasised basis)
  const epsImpact = ep ? diffNumber(ep, ep.metric === 'ADJ_EPS' ? 'adjusted EPS' : 'EPS') : na('UNAVAILABLE', 'No EPS guidance found');
  const fc = find(['FCF']);
  const fcfImpact = fc ? diffNumber(fc, 'free cash flow') : na('UNAVAILABLE', 'No free cash flow guidance found');
  return { revenueImpact, ebitdaImpact, epsImpact, fcfImpact };
}

// ---------------------------------------------------------------------------------------------
// 10. computeValuation
// ---------------------------------------------------------------------------------------------
/** Value per share at an unchanged multiple: EPS x P/E. EPS 5.00 -> 5.80 at 20x = 100 -> 116 = +16%. */
export function valueAtUnchangedMultiple(epsBefore: number, epsAfter: number, pe: number): { before: number; after: number; pct: number } | null {
  if (!isFinite(epsBefore) || !isFinite(epsAfter) || !isFinite(pe) || epsBefore <= 0 || pe <= 0) return null;
  return { before: round(epsBefore * pe, 4), after: round(epsAfter * pe, 4), pct: round(((epsAfter - epsBefore) / epsBefore) * 100, 2) };
}
export function computeValuation(ctx: GuContext, changes: GuChange[], opts?: { multipleSensitivityPct?: number }): GuValuation {
  // zzz854: never mix bases — the adjusted EPS line is the headline when the company gives both; GAAP is never the 'earnings effect'
  const okEp = (c: GuChange) => !!c.before && c.before.midpoint != null && c.after.midpoint != null && c.direction !== 'UNKNOWN';
  const ep = changes.find(c => c.metric === 'ADJ_EPS' && okEp(c)) ?? changes.find(c => c.metric === 'EPS' && okEp(c));
  const epWord = ep?.metric === 'ADJ_EPS' ? 'adjusted EPS' : ep?.after.basis === 'GAAP' ? 'GAAP EPS' : 'EPS';
  const pc = ctx.priceContext ?? {};
  const mk = (v: number | undefined, unit: string | undefined, src: string): GuNumber =>
    v != null && isFinite(v) ? { value: v, unit, label: 'REPORTED', source: src } : { value: null, label: 'UNAVAILABLE' };
  const epsUnit = ep ? unitOf(ep.after) : undefined;
  const epsBefore: GuNumber = ep ? { value: ep.before!.midpoint, unit: epsUnit, label: 'COMPANY_GUIDANCE', source: `Old ${epWord} guidance for ${ep.after.period}` } : na();
  const epsAfter: GuNumber = ep ? { value: ep.after.midpoint, unit: epsUnit, label: 'COMPANY_GUIDANCE', source: `New ${epWord} guidance for ${ep.after.period}` } : na();
  const currentPE = mk(pc.pe, 'x', 'Market data (context)');
  let earningsEffectPct: GuNumber = na('UNAVAILABLE', 'No EPS guidance change');
  if (ep && ep.before!.midpoint! > 0) {
    const pct = round(((ep.after.midpoint! - ep.before!.midpoint!) / ep.before!.midpoint!) * 100, 2);
    const vm = pc.pe != null ? valueAtUnchangedMultiple(ep.before!.midpoint!, ep.after.midpoint!, pc.pe) : null;
    earningsEffectPct = {
      value: pct, unit: '%', label: 'MODEL_ESTIMATE', source: `Our calculation from company ${epWord} guidance (basis: ${ep.metric === 'ADJ_EPS' ? 'adjusted' : ep.after.basis === 'GAAP' ? 'GAAP' : 'as stated'})`,
      formula: vm
        ? `(New EPS - old EPS) / old EPS = ${fmtNum(pct)}%. At ${fmtNum(pc.pe)}x, value per share moves ${fmtNum(vm.before)} to ${fmtNum(vm.after)}`
        : '(New EPS - old EPS) / old EPS, with the P/E multiple unchanged',
      assumptions: ['The P/E multiple stays the same', 'Only the EPS guidance changes', 'Not a price forecast',
        // zzz881: Rubrik $0.30 → $0.50 = +67% while revenue moved +2.8% — say so beside the number
        ...(Math.abs(ep.before!.midpoint!) < (/₹|INR|Rs/i.test(String(ep.after.currency || '')) ? 5 : 1)
          ? [`Small base: the old ${epWord} was only ${ep.after.currency || ''}${fmtNum(ep.before!.midpoint!)} a share, so the percentage looks much bigger than the change in the business`] : [])],
    };
  }
  let multipleSensitivityPct: GuNumber = na('UNAVAILABLE', 'Not assumed. No multiple sensitivity supplied');
  if (opts && opts.multipleSensitivityPct != null && isFinite(opts.multipleSensitivityPct)) {
    multipleSensitivityPct = {
      value: opts.multipleSensitivityPct, unit: '%', label: 'MODEL_ESTIMATE', source: 'Supplied by the user of this module',
      formula: 'Value change if the multiple moves by the supplied percentage (separate from the earnings effect)',
      assumptions: ['Sensitivity was supplied by the caller, not inferred', 'Kept separate from the earnings effect'],
    };
  }
  const v: GuValuation = {
    epsBefore, epsAfter, currentPE, earningsEffectPct, multipleSensitivityPct,
    marketCap: mk(pc.marketCap, undefined, 'Market data (context)'),
    enterpriseValue: mk(pc.ev, undefined, 'Market data (context)'),
    evEbitda: mk(pc.evEbitda, 'x', 'Market data (context)'),
    fcfYield: mk(pc.fcfYield, '%', 'Market data (context)'),
  };
  v.priorRerating = pc.move7dPct != null && isFinite(pc.move7dPct)
    ? `Stock ${signed(pc.move7dPct, 1)}% over the last 7 days — context only, not the thesis`
    : DATA_UNAVAILABLE;
  return v;
}

// ---------------------------------------------------------------------------------------------
// 11. materiality
// ---------------------------------------------------------------------------------------------
/** Level comes from CALCULATED numbers only (raises only; cuts are ignored here), on the headline basis (adjusted preferred over GAAP).
 *  zzz854 HIGH  : EPS / EBITDA / EBIT / net profit / FCF midpoint up >= 10%, revenue midpoint up >= 5%, margin up >= 3pp, volume/order/backlog up >= 20%.
 *  MEDIUM: any profit-like up >= 5%, revenue up >= 2.5%, margin up >= 1pp, volume/order/backlog up >= 10%.
 *  LOW   : numbers exist but below those lines. UNKNOWN: no before/after numbers at all.
 *  Growth-rate guidance is converted to a revenue level change: (1+new g)/(1+old g) - 1. */
export function materiality(changes: GuChange[]): { level: GuMateriality; basis: string } {
  // zzz854: basis-aware — when a measure is given both adjusted and GAAP, only the adjusted (headline) line sizes the change
  const calc = splitByBasis(changes.filter(c => c.before && c.direction !== 'UNKNOWN' && c.after.midpoint != null && c.before.midpoint != null)).headline;
  if (!calc.length) return { level: 'UNKNOWN', basis: 'No before and after guidance numbers found, so nothing can be calculated' };
  const parts: string[] = [];
  let revPct: number | null = null; let profitMax: number | null = null; let marginPp: number | null = null; let volMax: number | null = null;
  const fams = new Set<Family>();
  for (const c of calc) {
    if (c.direction !== 'UP') continue;
    const f = familyOf(c); const b = c.before!.midpoint!; const a = c.after.midpoint!;
    fams.add(f);
    if (f === 'REVENUE') {
      const p = c.after.isGrowthRate ? round(((100 + a) / (100 + b) - 1) * 100, 1) : (c.percentageChange ?? 0);
      revPct = Math.max(revPct ?? -Infinity, p);
      parts.push(`${metricLabel(c)} guidance up ${fmtNum(round(p, 1))}% (${fmtPoint(c.before)} to ${fmtPoint(c.after)})`);
    } else if (f === 'PROFIT' || f === 'CASH') {
      const p = c.after.isGrowthRate ? (c.percentagePointChange ?? 0) : (c.percentageChange ?? 0);
      profitMax = Math.max(profitMax ?? -Infinity, p);
      parts.push(`${metricLabel(c)} guidance up ${fmtNum(round(p, 1))}${c.after.isGrowthRate ? ' points' : '%'} (${fmtPoint(c.before)} to ${fmtPoint(c.after)})`);
    } else if (f === 'MARGIN') {
      const p = c.percentagePointChange ?? 0; marginPp = Math.max(marginPp ?? -Infinity, p);
      parts.push(`margin guidance up ${fmtNum(round(p, 1))} points (${fmtPoint(c.before)} to ${fmtPoint(c.after)})`);
    } else if (f === 'VOLUME' || f === 'ORDER') {
      const p = c.after.isGrowthRate ? (c.percentagePointChange ?? 0) : (c.percentageChange ?? 0);
      volMax = Math.max(volMax ?? -Infinity, p);
      parts.push(`${metricLabel(c)} guidance up ${fmtNum(round(p, 1))}${c.after.isGrowthRate ? ' points' : '%'} (${fmtPoint(c.before)} to ${fmtPoint(c.after)})`);
    }
  }
  const T = GU_THRESHOLDS;
  if (!parts.length) {
    return { level: 'LOW', basis: `Guidance did not move up on the numbers we could calculate (${calc.map(c => `${metricLabel(c)} ${c.direction.toLowerCase()}`).join(', ')})` };
  }
  const basis = parts.join('; ');
  const multi = fams.size >= 2;
  void multi;
  if ((profitMax != null && profitMax >= T.MAT_HIGH_PROFIT_PCT) || (revPct != null && revPct >= T.MAT_HIGH_REVENUE_PCT)
    || (marginPp != null && marginPp >= T.MAT_HIGH_MARGIN_PP) || (volMax != null && volMax >= T.MAT_HIGH_VOLUME_PCT)) return { level: 'HIGH', basis };
  if ((profitMax != null && profitMax >= T.MAT_MED_PROFIT_PCT) || (revPct != null && revPct >= T.MAT_MED_REVENUE_PCT) || (marginPp != null && marginPp >= T.MAT_MED_MARGIN_PP)
    || (volMax != null && volMax >= T.MAT_MED_VOLUME_PCT)) return { level: 'MEDIUM', basis };
  return { level: 'LOW', basis };
}

// ---------------------------------------------------------------------------------------------
// 12. thesisLabel
// ---------------------------------------------------------------------------------------------
function pctOfFamily(changes: GuChange[], fam: Family): number | null {
  let best: number | null = null;
  for (const c of changes) {
    if (c.direction !== 'UP' || !c.before || familyOf(c) !== fam || c.after.midpoint == null || c.before.midpoint == null) continue;
    const p = c.after.isGrowthRate ? (fam === 'REVENUE' ? ((100 + c.after.midpoint) / (100 + c.before.midpoint) - 1) * 100 : c.percentagePointChange) : c.percentageChange;
    if (p != null) best = Math.max(best ?? -Infinity, p);
  }
  return best;
}
/** Only A / B / F / G (or null). Order: A (operating inflection), F (profit outruns revenue, numbers only), B (demand raise), G (quiet, cash-backed). */
export function thesisLabel(x: { changes: GuChange[]; driver: GuDriverResult; text?: string }): GuThesis {
  const { changes, driver } = x; const k = new Set(driver.kinds); const text = x.text ?? '';
  if (driver.quality === 'LOW') return null;
  const marginUp = changes.find(c => c.metric === 'OP_MARGIN' && c.direction === 'UP' && (c.percentagePointChange ?? 0) >= 1);
  if ((k.has('CAPACITY') && /utili[sz]ation/i.test(text)) || (marginUp && (k.has('CAPACITY') || k.has('MIX') || k.has('COST_SAVINGS') || k.has('PRICING_POWER')))) return 'A';
  const rev = pctOfFamily(changes, 'REVENUE'); const prof = pctOfFamily(changes, 'PROFIT');
  if (prof != null && rev != null && prof >= 10 && prof >= rev + GU_THRESHOLDS.F_MIN_GAP_PP) return 'F';
  const demand = ['ORGANIC_DEMAND', 'VOLUME', 'STRUCTURAL', 'SHARE_GAIN', 'BACKLOG'].some(d => k.has(d as GuDriverKind));
  if (demand && rev != null && rev > 0) return 'B';
  const cash = pctOfFamily(changes, 'CASH');
  if (cash != null && cash >= 5 && (rev == null || rev < GU_THRESHOLDS.MAT_HIGH_REVENUE_PCT) && /\b(?:cash flow|cash conversion|fcf)\b/i.test(text)) return 'G';
  return null;
}

// ---------------------------------------------------------------------------------------------
// 13. buildHistory + flags
// ---------------------------------------------------------------------------------------------
const isUp = (r: GuLedgerRow) => r.change === 'RAISED' || r.change === 'NARROWED_UP';
const isDown = (r: GuLedgerRow) => r.change === 'CUT' || r.change === 'NARROWED_DOWN';
export function buildHistory(ledger: GuLedgerRow[], current: GuLedgerRow[]): { rows: GuLedgerRow[]; stats: GuHistoryStats | null } {
  const seen = new Set<string>(); const rows: GuLedgerRow[] = [];
  for (const r of [...(ledger ?? []), ...(current ?? [])]) {
    const k = `${r.date}|${r.metric}|${r.period}|${r.change}|${r.text}`;
    if (seen.has(k)) continue; seen.add(k); rows.push(r);
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return { rows, stats: null };
  const upgrades = rows.filter(isUp).length; const downgrades = rows.filter(isDown).length;
  const reiterations = rows.filter(r => r.change === 'REITERATED').length;
  const revs = rows.filter(r => (isUp(r) || isDown(r)) && r.revisionPct != null && isFinite(r.revisionPct as number)).map(r => r.revisionPct as number);
  const avgRevisionPct = revs.length ? round(revs.reduce((a, b) => a + b, 0) / revs.length, 1) : null;
  const resolvedRows = rows.filter(r => isUp(r) && (r.result === 'BEAT' || r.result === 'INLINE' || r.result === 'MISS'));
  const resolved = resolvedRows.length;
  // beat rate counts BEAT only (meeting the raised guidance exactly is not a beat); null until 2+ resolved results
  const beatRateAfterUpgrades = resolved >= 2 ? round(resolvedRows.filter(r => r.result === 'BEAT').length / resolved, 3) : null;
  return { rows, stats: { upgrades, downgrades, reiterations, avgRevisionPct, beatRateAfterUpgrades, resolved } };
}

const DETERIORATION = /\b(?:margins? (?:pressure|compression|contraction|decline|dilution|erosion|squeeze)|(?:lower|declining|weaker|falling|shrinking) margins?|free cash flow (?:decline|declin\w+|fell|lower|negative|outflow)|(?:lower|negative|declining|weaker) (?:free )?cash flow|cash burn|working capital (?:strain|stress|build-?up))\b/i;
export function statedDeterioration(text: string, history: GuLedgerRow[] = []): boolean {
  return DETERIORATION.test(text ?? '') || history.some(r => isDown(r) && (r.metric === 'OP_MARGIN' || r.metric === 'FCF' || r.metric === 'FCF_CONVERSION'));
}
const MATRANK: Record<GuMateriality, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };
/** zzz854: distinct EARLIER announcement dates (before `date`, within REPEAT_WINDOW_DAYS) on which the ledger recorded a raise. Several metrics raised on one day = one raise. */
export function priorRaiseDates(history: readonly GuLedgerRow[], date: string): string[] {
  const d0 = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d0)) return [];
  const from = new Date(Date.parse(`${d0}T00:00:00Z`) - GU_THRESHOLDS.REPEAT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const out = new Set<string>();
  for (const r of history ?? []) { const d = String(r.date || '').slice(0, 10); if (isUp(r) && d < d0 && d >= from) out.add(d); }
  return [...out].sort();
}
export function computeFlags(x: {
  verified: boolean; changes: GuChange[]; history: GuLedgerRow[]; historyStats: GuHistoryStats | null; text: string;
  gap: GuGap; materiality: GuMateriality; bottleneckThemes?: string[]; structuralAlignment?: string; secondUpgrade?: boolean;
  /** zzz854: the current announcement date. When given, REPEATED UPGRADER needs >= 1 PRIOR raise (an earlier announcement date within REPEAT_WINDOW_DAYS); the current event's own rows never count. */
  announcementDate?: string;
}): GuFlag[] {
  const flags: GuFlag[] = [];
  const raise = x.changes.some(c => c.direction === 'UP' && !!c.before);
  if (x.secondUpgrade) flags.push('SECOND_UPGRADE_IN_WINDOW');
  const repeated = x.announcementDate ? priorRaiseDates(x.history, x.announcementDate).length >= 1 : !!x.historyStats && x.historyStats.upgrades >= 2;
  if (repeated && raise && !statedDeterioration(x.text, x.history) && x.verified) flags.push('REPEATED_UPGRADER');
  if (raise && (x.gap === 'LARGE_POSITIVE' || x.gap === 'POSITIVE') && MATRANK[x.materiality] >= MATRANK.MEDIUM) flags.push('GUIDANCE_PLUS_GAP');
  if (raise && (x.bottleneckThemes?.length ?? 0) > 0 && (x.structuralAlignment ?? '').trim().length > 0 && MATRANK[x.materiality] >= MATRANK.MEDIUM) flags.push('GUIDANCE_PLUS_BOTTLENECK');
  return flags;
}

// ---------------------------------------------------------------------------------------------
// 14-16. narrative builders (plain, simple English; no BUY/SELL wording)
// ---------------------------------------------------------------------------------------------
const upChanges = (e: Pick<GuidanceEvent, 'changes'>) => e.changes.filter(c => c.direction === 'UP' && !!c.before);

export function buildRisks(e: GuidanceEvent, x: { text: string; kinds: readonly GuDriverKind[] }): string[] {
  const k = new Set(x.kinds); const risks: string[] = [];
  const v2r = e.v2;
  if (v2r) {
    const nonClean = v2r.ranges.filter(r => r.klass === 'MIDPOINT_RAISE_RANGE_NARROWING');
    const cuts = v2r.ranges.filter(r => r.klass === 'MIDPOINT_RAISE_RANGE_NARROWING');
    if (cuts.some(r => r.afterHigh != null && r.beforeHigh != null && r.afterHigh < r.beforeHigh)) risks.push('Range narrowed: top end cut, so only the midpoint rose. The best case was lowered.');
    else if (cuts.some(r => r.afterLow != null && r.beforeLow != null && r.afterLow < r.beforeLow)) risks.push('Range narrowed: low end cut, so only the midpoint rose.');
    if (nonClean.length) risks.push('Only the midpoint of the range rose while the low end or top end was lowered, so this is not a clean raise.');
    if (v2r.ranges.some(r => r.klass === 'RANGE_WIDENING')) risks.push('The range got wider, so the higher midpoint is less certain than a clean raise.');
    if (v2r.unitWarnings.some(w => /basis/i.test(w))) risks.push('Before and after figures use different bases (for example adjusted versus GAAP), so they cannot be compared directly.');
  }
  if (/\b(?:customer concentration|top (?:customer|client)s?|largest (?:customer|client)|single (?:customer|client)|key (?:customer|client)s?|depend\w* on (?:a |few |one )?(?:customer|client))/i.test(x.text))
    risks.push('A few big customers may make up much of sales, so losing one would hurt.');
  if (k.has('FX')) risks.push('Part of the raise comes from currency moves, and currencies can move back.');
  if (e.guidance_quality === 'LOW' || [...k].some(v => LOW_KINDS.has(v)) || e.duration === 'ONE_OFF')
    risks.push('The raise leans on a one-time item, so it may not repeat next year.');
  if ((e.historyStats && e.historyStats.downgrades > 0) || e.history.some(isDown))
    risks.push('The company has cut guidance before, so trust in this raise is lower.');
  if (k.has('COMMODITY') || /\b(?:cyclical|commodity prices?|raw material prices?)\b/i.test(x.text))
    risks.push('Results depend on commodity or cycle swings, which move up and down.');
  if (k.has('ACQUISITION')) risks.push('Part of the growth is bought, not organic, and joining a new business can go wrong.');
  if (k.has('TEMP_SUPPLY')) risks.push('A temporary supply gap helped, and it can close.');
  if (k.has('ONE_OFF_PRICING') || k.has('PRICE_HIKE')) risks.push('Higher prices may not stick if customers push back.');
  if (e.expectationGap === 'NEGATIVE') risks.push('Guidance is still below what analysts expected, so the market may stay unimpressed.');
  const out = risks.slice(0, 4);
  if (out.length < 2 && out.length < 4) out.push('Demand could slow, and the company may miss the raised guidance.');
  if (out.length < 2) out.push('Other risks are not stated in the source.');
  return out;
}

/** zzz849: what the COMPUTED numbers say, so every sentence follows the numbers and never the headline verb.
 *  UPGRADE = at least one measure moved up with a before value. REITERATION = every compared measure unchanged. DOWNGRADE = a compared measure fell and none rose.
 *  NO_RAISE = compared measures moved in mixed ways without a raise. DETECTED = no before and after numbers at all. */
export type GuEventClass = 'UPGRADE' | 'REITERATION' | 'DOWNGRADE' | 'NO_RAISE' | 'DETECTED';
export const EVENT_CLASS_LABEL: Record<GuEventClass, string> = {
  UPGRADE: 'GUIDANCE RAISED', REITERATION: 'GUIDANCE REITERATED', DOWNGRADE: 'GUIDANCE LOWERED', NO_RAISE: 'NO RAISE ON THE NUMBERS', DETECTED: 'DETECTED, NUMBERS NOT FOUND',
};
export function eventClassOf(changes: readonly GuChange[], ranges?: readonly GuRangeMath[]): GuEventClass {
  const compared = changes.map((c, i) => ({ c, r: ranges?.[i] })).filter((x) => !!x.c.before && x.c.direction !== 'UNKNOWN');
  if (!compared.length) return 'DETECTED';
  if (compared.some((x) => x.c.direction === 'UP')) return 'UPGRADE';
  if (compared.every((x) => (x.r ? x.r.klass === 'REITERATION' : x.c.direction === 'FLAT'))) return 'REITERATION';
  if (compared.some((x) => x.c.direction === 'DOWN')) return 'DOWNGRADE';
  return 'NO_RAISE';
}
const classOfEvent = (e: Pick<GuidanceEvent, 'changes' | 'v2'>): GuEventClass => e.v2?.eventClass ?? eventClassOf(e.changes, e.v2?.ranges);
const comparedChanges = (e: Pick<GuidanceEvent, 'changes'>) => e.changes.filter((c) => !!c.before && c.direction !== 'UNKNOWN');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** zzz854: when the next check lands: the guided quarter's own results, else the next quarterly results (~announcement + 3 months). */
export function nextResultsWindow(e: Pick<GuidanceEvent, 'announcement_date'>, c: GuChange): string {
  if (periodGrain(c.after.period) === 'QUARTER') return `${c.after.period} results`;
  const t0 = Date.parse(`${String(e.announcement_date || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t0)) return 'Next quarterly results';
  const t = new Date(t0 + 91 * 86_400_000);
  return `Next quarterly results (~${MON[t.getUTCMonth()]} ${t.getUTCFullYear()})`;
}
/** zzz854: metric + direction + window + source. A run-rate is the guided low end / 4 (simple average, labelled), never a forecast. */
export function trackingLine(e: Pick<GuidanceEvent, 'announcement_date'>, c: GuChange): string {
  const win = nextResultsWindow(e, c); const p = c.after.period === 'UNSTATED' ? 'the guided period' : periodWords(c.after);
  const g = fmtPoint(c.after); const name = metricLabel(c);
  const src = "source: the company's next results release";
  if (c.after.isGrowthRate) return `${win}: ${name} at or above the guided ${g} for ${p} — ${src}.`;
  const grain = periodGrain(c.after.period);
  if (grain === 'QUARTER') return `${win}: ${name} at or above the guided ${g} — ${src}.`;
  if (grain === 'ANNUAL' && c.after.low != null && c.after.low > 0 && c.after.periodKind !== 'MULTI_YEAR_CAGR') {
    const q4 = round(c.after.low / 4, 4);
    const q = { ...c.after, low: q4, high: q4, midpoint: q4 };
    return `${win}: quarterly ${name} of about ${fmtPoint(q)} or more (guided low end ÷ 4, seasonality not considered) to stay on track for the guided ${g} for ${p} — ${src}.`;
  }
  return `${win}: ${name} tracking toward the guided ${g} for ${p} — ${src}.`;
}

export function buildNextEvidence(e: GuidanceEvent): string[] {
  const ups = upChanges(e);
  // zzz849: numbers WERE extracted (unchanged or lowered): the next check is tracking, not "wait for numbers"
  const tracked = (ups.length ? ups : comparedChanges(e)).slice().sort((a, b) => (ups.length ? METRIC_PRIORITY.indexOf(a.metric) - METRIC_PRIORITY.indexOf(b.metric) : narrativeRank(a) - narrativeRank(b)));
  if (!tracked.length) {
    const ms = e.v2?.statedMetrics?.length ? ` for ${e.v2.statedMetrics.join(', ')}` : '';
    const d = String(e.primarySourceDate || e.announcement_date || '').slice(0, 10);
    return [`Primary document (${sourceDocumentOf(e)}${d ? `, ${d}` : ''}): confirm the old and new guidance figures${ms} for the same period and basis.`];
  }
  const out: string[] = [trackingLine(e, tracked[0])];
  const driverSpecific = e.v2 ? nextEvidenceFor(e.v2.operatingVariable) : [];   // only when the operating variable is stated in the source
  if (driverSpecific.length) out.push(`${driverSpecific.slice(0, 2).join('; ')} (stated driver: ${e.v2!.operatingVariable})`);
  else if (tracked[1]) out.push(trackingLine(e, tracked[1]));
  else {
    const c = tracked[0]; const p = c.after.period === 'UNSTATED' ? 'the guided period' : periodWords(c.after);
    out.push(`Next guidance update: whether the company ${ups.length ? 'repeats or raises' : 'raises'} the ${metricLabel(c)} guidance for ${p} (${fmtPoint(c.after)}) — source: the next results release or guidance update.`);
  }
  return out.slice(0, 2);
}

export const WHY_NOW_UNRESOLVED = 'Driver unresolved after primary-source + recent-event research';   // kept for old imports; zzz854 never emits it
/** zzz854: the document the claim was read from: the primary source when there is one, else the first source. */
export function sourceDocumentOf(e: Pick<GuidanceEvent, 'sources'>): string {
  const p = e.sources.find(s => s.tier === 'PRIMARY') ?? e.sources[0];
  if (!p) return 'the source';
  return p.type && p.type !== p.name && !p.name.toLowerCase().includes(p.type.toLowerCase()) ? `${p.name} (${p.type})` : p.name;
}
/** zzz854: dated and specific when no driver is stated: 'Why now: guidance raised on 2026-09-30 in <document>; driver not stated in the release'. */
export function driverNotStatedLine(e: Pick<GuidanceEvent, 'sources' | 'announcement_date' | 'primarySourceDate'>, verb = 'raised'): string {
  const d = String(e.primarySourceDate || e.announcement_date || '').slice(0, 10) || 'an unstated date';
  return `Why now: guidance ${verb} on ${d} in ${sourceDocumentOf(e)}; driver not stated in the release`;
}
function driverPhrase(e: GuidanceEvent): string | null {
  const v = e.v2?.operatingVariable;
  if (e.guidance_quality === 'UNKNOWN' || /not stated|unresolved|^stated operating/i.test(e.guidance_driver)) return v ? `driven by ${v}` : null;
  return `driven by ${e.guidance_driver.charAt(0).toLowerCase()}${e.guidance_driver.slice(1)}${v ? ` (stated: ${v})` : ''}`;
}
/** 'FY27–29 (3-year CAGR)' for a multi-year growth target, the plain period otherwise */
export const periodWords = (p: GuGuidancePoint): string => (p.periodKind === 'MULTI_YEAR_CAGR' ? `${p.period && p.period !== 'UNSTATED' ? `${p.period} ` : ''}(${p.periodYears ? `${p.periodYears}-year ` : 'multi-year '}CAGR)`.trim() : p.period);
function figureWords(c: GuChange): string {
  const period = c.after.period === 'UNSTATED' ? '' : `${periodWords(c.after)} `;
  // a revenue figure quoted as a percentage reads "revenue guidance at 13%" (the % is the growth rate the company guided)
  return `${period}${c.metric === 'REVENUE_GROWTH' ? 'revenue' : metricLabel(c)} guidance`;
}
const narrativeRank = (c: GuChange): number => (c.metric === 'REVENUE' || c.metric === 'REVENUE_GROWTH' ? -1 : METRIC_PRIORITY.indexOf(c.metric));
export function buildWhyNow(e: GuidanceEvent): string {
  const ups = upChanges(e);
  const cls = classOfEvent(e);
  if (!ups.length && (cls === 'REITERATION' || cls === 'DOWNGRADE' || cls === 'NO_RAISE')) {
    const cmp = comparedChanges(e).slice().sort((a, b) => narrativeRank(a) - narrativeRank(b));
    const c = cmp[0]; const more = cmp.length - 1;
    if (cls === 'REITERATION') return `Management reiterated ${figureWords(c)} at ${fmtPoint(c.after)}.${more > 0 ? ` ${more} more measure${more === 1 ? ' was' : 's were'} also reiterated.` : ''}`;
    if (cls === 'DOWNGRADE') { const d = cmp.find((x) => x.direction === 'DOWN') ?? c; return `Management lowered ${figureWords(d)} to ${fmtPoint(d.after)} from ${fmtPoint(d.before)}.`; }
    return `No measure was raised: ${figureWords(c)} is ${fmtPoint(c.after)} against ${fmtPoint(c.before)} before.`;
  }
  if (!ups.length && e.v2?.statedDirection === 'RAISED') {
    const sm = e.v2.statedMetrics?.length ? ` ${e.v2.statedMetrics.join(', ')}` : '';
    return `${e.company} raised its${sm} guidance (direction stated by the source), but the source gives no before and after numbers (${DATA_UNAVAILABLE}). Held for review, not verified. ${driverNotStatedLine(e)}.`;
  }
  if (!ups.length) return `${e.company} raised its guidance, but the source does not give clear before and after numbers (${DATA_UNAVAILABLE}). ${driverNotStatedLine(e)}.`;
  const c = ups.slice().sort((a, b) => METRIC_PRIORITY.indexOf(a.metric) - METRIC_PRIORITY.indexOf(b.metric))[0];
  const period = c.after.period === 'UNSTATED' ? '' : ` for ${periodWords(c.after)}`;
  const more = ups.length > 1 ? ` (plus ${ups.length - 1} more measure${ups.length > 2 ? 's' : ''})` : '';
  const dp = driverPhrase(e);
  const ci = e.changes.indexOf(c); const kl = e.v2?.ranges[ci]?.klass;
  const basisWord = e.headlineBasis === 'ADJUSTED' && c.metric !== 'ADJ_EPS' && c.after.basis === 'NON_GAAP' ? 'adjusted ' : '';
  if (kl === 'MIDPOINT_RAISE_RANGE_NARROWING') return `${e.company} moved the midpoint of ${basisWord}${metricLabel(c)} guidance${period} up, to ${fmtPoint(c.after)} from ${fmtPoint(c.before)}, but narrowed the range (top end cut)${dp ? `, ${dp}.` : `. ${driverNotStatedLine(e, 'changed')}.`}`;
  return `${e.company} raised ${basisWord}${metricLabel(c)} guidance${period} to ${fmtPoint(c.after)} from ${fmtPoint(c.before)}${more}${dp ? `, ${dp}.` : `. ${driverNotStatedLine(e)}.`}`;
}

export function whatItMeans(e: GuidanceEvent): string {
  const rev = pctOfFamily(e.changes, 'REVENUE'); const prof = pctOfFamily(e.changes, 'PROFIT');
  const parts: string[] = [];
  if (rev != null) parts.push(`Revenue guidance is up ${fmtNum(round(rev, 1))}%.`);
  if (prof != null) parts.push(`Profit guidance is up ${fmtNum(round(prof, 1))}%.`);
  if (!parts.length) {
    const c = upChanges(e)[0];
    if (!c) {
      const k = classOfEvent(e);
      if (k === 'REITERATION') return 'Guidance was repeated at the same level, so there is nothing new to add to earnings estimates.';
      if (k === 'DOWNGRADE') return 'Guidance was lowered, so this is not an upgrade and earnings estimates may need to come down.';
      if (k === 'NO_RAISE') return 'No measure was raised on the numbers found, so there is no upgrade to add to earnings estimates.';
      return `${DATA_UNAVAILABLE}: the source has no before and after numbers, so we cannot say what this does to earnings.`;
    }
    return `${metricLabel(c)} guidance moved from ${fmtPoint(c.before)} to ${fmtPoint(c.after)}. The source gives no revenue or profit numbers, so the effect on earnings is not known.`;
  }
  if (rev != null && prof != null && prof > rev)
    parts.push('Profit is rising faster than revenue. That points to operating leverage: extra sales add more profit because costs do not rise as fast.');
  else if (rev != null && prof == null) parts.push('There is no profit guidance in the source, so we cannot say what this does to earnings.');
  return parts.join(' ');
}

export function marketMissing(e: GuidanceEvent): string {
  const bits: string[] = [];
  if (e.expectationGap === 'UNKNOWN') bits.push('No consensus number was supplied, so we cannot tell if the market already expects this.');
  else if (e.gapPct != null) {
    const g = `New guidance midpoint is ${signed(e.gapPct, 1)}% versus consensus`;
    if (e.expectationGap === 'NEGATIVE') bits.push(`${g}. Guidance rose but is still below what analysts expect.`);
    else if (e.expectationGap === 'INLINE') bits.push(`${g}. That is roughly in line, so there may be little the market has missed.`);
    else bits.push(`${g}. Guidance is above what analysts expect.`);
  }
  const v = e.valuation;
  const eff = v?.earningsEffectPct.value; const pe = v?.currentPE.value;
  if (eff != null && pe != null) bits.push(`At the current P/E of ${fmtNum(pe)}x, EPS ${signed(eff, 1)}% adds about ${fmtNum(round(eff, 1))}% to value if the multiple stays the same.`);
  else if (eff != null) bits.push(`EPS guidance is up ${fmtNum(round(eff, 1))}%, but there is no P/E, so the value effect is ${DATA_UNAVAILABLE}.`);
  if (!bits.length || (e.expectationGap === 'UNKNOWN' && eff == null)) return `${DATA_UNAVAILABLE}: no consensus and no valuation data, so we cannot say what the market may be missing.`;
  return bits.join(' ');
}

export function chain(e: GuidanceEvent): GuChain {
  const eff = e.valuation?.earningsEffectPct.value;
  const pe = e.valuation?.currentPE.value;
  const first = e.decisionReason[0] ?? '';
  return {
    event: buildWhyNow(e).replace(/(?:, driven by|\. Driver unresolved|\. Why now:).*$/, '.'),
    evidence: e.verification === 'VERIFIED'
      ? `Confirmed by ${e.sources.filter(s => s.tier === 'PRIMARY').map(s => s.name).slice(0, 2).join(' and ')}.`
      : `Not confirmed by a primary source yet. ${e.sources.length} source${e.sources.length === 1 ? '' : 's'} so far.`,
    driver: e.guidance_driver,
    earnings: e.materialityBasis || DATA_UNAVAILABLE,
    gap: e.expectationGap === 'UNKNOWN' ? `${DATA_UNAVAILABLE} (no consensus)` : `${e.expectationGap.replace('_', ' ').toLowerCase()} (${e.gapPct != null ? signed(e.gapPct, 1) + '%' : DATA_UNAVAILABLE} versus consensus)`,
    valuation: pe != null || eff != null
      ? `${pe != null ? `P/E ${fmtNum(pe)}x. ` : `P/E ${DATA_UNAVAILABLE}. `}${eff != null ? `EPS effect ${signed(eff, 1)}% at an unchanged multiple.` : `EPS effect ${DATA_UNAVAILABLE}.`}`
      : DATA_UNAVAILABLE,
    durability: e.duration === 'UNKNOWN' ? 'How long this lasts is not stated in the source.' : e.duration === 'ONE_OFF' ? 'One-off. It is unlikely to repeat.' : e.duration === 'MULTI_QUARTER' ? 'Should last several quarters.' : 'Should last several years.',
    risk: e.risks[0] ?? DATA_UNAVAILABLE,
    action: `${e.decision}${first ? ` — ${first}` : ''}`,
  };
}

// ---------------------------------------------------------------------------------------------
// 17. decide
// ---------------------------------------------------------------------------------------------
export const DECISION_ORDER: Record<GuDecision, number> = { IMMEDIATE_BUY: 4, WATCHLIST: 3, DELAYED_EP: 2, REJECT: 1, UNVERIFIED: 0 };

function reasonLines(e: GuidanceEvent, ctx: GuContext | undefined, thesisBreaking: boolean): string[] {
  const pe = e.valuation?.currentPE.value ?? null; const move = ctx?.priceContext?.move7dPct;
  const ups = upChanges(e);
  const changed = ups.length || classOfEvent(e) !== 'DETECTED' ? `What changed: ${buildWhyNow(e)}` : `What changed: no measurable upgrade (${DATA_UNAVAILABLE} for before and after numbers).`;
  const earnings = `Earnings effect: ${e.materialityBasis || DATA_UNAVAILABLE} (materiality ${e.materiality}).`;
  const gap = e.expectationGap === 'UNKNOWN' ? `Expectations: ${DATA_UNAVAILABLE} (no consensus, so the gap is unknown, not negative).`
    : `Expectations: guidance is ${e.expectationGap.replace('_', ' ').toLowerCase()} versus consensus${e.gapPct != null ? ` (${signed(e.gapPct, 1)}%)` : ''}.`;
  void move;
  const val = pe == null ? 'Valuation: valuation data unavailable.'
    : `Valuation: P/E ${fmtNum(pe)}x${pe >= GU_THRESHOLDS.STRETCHED_PE ? ' (stretched)' : ''}.`;
  const dur = `Durability: ${e.duration === 'UNKNOWN' ? 'not stated in the source' : e.duration.replace('_', ' ').toLowerCase()}; driver quality ${e.guidance_quality.toLowerCase()}.`;
  const risk = `Risk: ${thesisBreaking ? 'source states margin or cash flow pressure. ' : ''}${e.risks[0] ?? 'none stated'}`;
  return [changed, earnings, gap, val, dur, risk];
}

export function decide(e: GuidanceEvent, ctx?: GuContext, x?: { thesisBreaking?: boolean }): { decision: GuDecision; reasons: string[] } {
  const thesisBreaking = !!x?.thesisBreaking || e.history.some(r => isDown(r) && (r.metric === 'OP_MARGIN' || r.metric === 'FCF' || r.metric === 'FCF_CONVERSION'));
  const lines = reasonLines(e, ctx, thesisBreaking);
  if (e.verification !== 'VERIFIED') {
    return { decision: 'UNVERIFIED', reasons: ['No primary source — no final decision', ...lines] };
  }
  const T = GU_THRESHOLDS;
  const gapPos = e.expectationGap === 'POSITIVE' || e.expectationGap === 'LARGE_POSITIVE';
  const ups = upChanges(e);
  const v2Lines = v2DecisionLines(e);
  const reject = (why: string) => ({ decision: 'REJECT' as GuDecision, reasons: [...lines, ...v2Lines, `Result: REJECT — ${why}`] });
  // zzz854: REJECT is reserved for lowered / invalid / stale / capital-raise items. A verified raise is never rejected for a small size,
  // a one-time driver or a small or negative consensus gap: those cap it at WATCHLIST with the reason. No numbers = no decision.
  const watch = (why: string) => ({ decision: 'WATCHLIST' as GuDecision, reasons: [...lines, ...v2Lines, `Result: WATCHLIST — ${why}`] });
  if (!ups.length) {
    const k = classOfEvent(e);
    if (k === 'REITERATION') return watch('guidance was reiterated at the same level; nothing new, tracked only (not an upgrade)');
    if (k === 'DOWNGRADE') return reject('guidance was lowered, not raised');
    if (k === 'NO_RAISE') return watch('no measure was raised on the numbers found (range changed only); tracked, not an upgrade');
    return { decision: 'UNVERIFIED', reasons: [`No decision — old and new guidance numbers were not both found${e.v2?.unitWarnings.length ? '; a figure was dropped for a unit or basis problem, see warnings' : ''}`, ...lines] };
  }
  if (e.guidance_quality === 'LOW') return watch('the raise leans on a low-quality, one-time driver, so it is tracked rather than acted on');
  if (e.duration === 'ONE_OFF') return watch('the stated driver is one-off, so it is tracked rather than acted on');
  if (e.expectationGap === 'NEGATIVE') return watch(`guidance rose but is still clearly below consensus (${e.gapPct != null ? signed(e.gapPct, 1) + '%' : DATA_UNAVAILABLE}); tracked, not rejected`);
  if (e.materiality === 'LOW') return watch(`small raise (${e.materialityBasis}); below the size lines for a real earnings effect, so it is tracked`);
  if (e.materiality === 'UNKNOWN') return { decision: 'UNVERIFIED', reasons: ['No decision — no numbers to measure the earnings effect', ...lines] };

  const strongFund = e.materiality === 'HIGH' || (e.materiality === 'MEDIUM' && e.expectationGap === 'LARGE_POSITIVE');
  const durable = e.duration === 'MULTI_QUARTER' || e.duration === 'MULTI_YEAR';
  const core = strongFund && gapPos && e.guidance_quality === 'HIGH' && durable && !thesisBreaking;
  const pe = e.valuation?.currentPE.value ?? null; const peKnown = pe != null && pe > 0;
  const stretched = peKnown && (pe as number) >= T.STRETCHED_PE;
  const bigMove = false;   // zzz854: price is never used in a decision (the 7-day move is context only and no longer read here)
  const realRaise = hasRealRaise(e);
  if (core && peKnown && !stretched && !realRaise) return { decision: 'WATCHLIST', reasons: [...lines, ...v2Lines, 'Result: WATCHLIST — everything else lines up, but the raise is not clean (midpoint only, or before/after not comparable), so it is capped at WATCHLIST until the low end of the range moves up'] };
  if (core && peKnown && !stretched) return { decision: 'IMMEDIATE_BUY', reasons: [...lines, ...v2Lines, 'Result: IMMEDIATE_BUY — verified, material, above consensus, high-quality and lasting driver, valuation not stretched'] };
  if (core) {
    if (stretched) return { decision: 'DELAYED_EP', reasons: [...lines, ...v2Lines, 'Result: DELAYED_EP — strong fundamentals but valuation is already stretched; wait for confirmation'] };
    if (bigMove) return { decision: 'DELAYED_EP', reasons: [...lines, ...v2Lines, 'Result: DELAYED_EP — strong fundamentals; valuation data unavailable and the stock has already moved a lot; wait for confirmation'] };
    return { decision: 'WATCHLIST', reasons: [...lines, ...v2Lines, 'Result: WATCHLIST — valuation data unavailable'] };
  }
  const strongish = e.materiality === 'HIGH' && gapPos && (e.guidance_quality === 'HIGH' || e.guidance_quality === 'MEDIUM') && !thesisBreaking;
  if ((strongish && bigMove) || (strongish && stretched)) return { decision: 'DELAYED_EP', reasons: [...lines, ...v2Lines, 'Result: DELAYED_EP — strong earnings effect; wait for confirmation'] };
  const missing: string[] = [];
  if (!gapPos) missing.push(e.expectationGap === 'UNKNOWN' ? 'no consensus to compare' : 'gap versus consensus is not clearly positive');
  if (e.guidance_quality !== 'HIGH') missing.push('driver quality is not clearly high');
  if (!durable) missing.push('duration not confirmed');
  if (!peKnown) missing.push('valuation data unavailable');
  if (thesisBreaking) missing.push('source states margin or cash flow pressure');
  if (!realRaise) missing.push('the raise is not clean (midpoint only, or before/after not comparable)');
  return { decision: 'WATCHLIST', reasons: [...lines, ...v2Lines, `Result: WATCHLIST — real earnings effect, but ${missing.join('; ') || 'more evidence needed'}`] };
}

// ---------------------------------------------------------------------------------------------
// zzz844 V2 engine pieces (pure, deterministic). Consensus never drives detection; unknown is not negative.
// ---------------------------------------------------------------------------------------------
const REAL_RAISE = new Set<GuRangeClass>(['CLEAN_RAISE', 'RANGE_SHIFT_UP']);
/** True when at least one raised metric is a real raise of the range (floor moved up), not a midpoint-only or widened one.
 *  Events without V2 data behave as before (true). */
export function hasRealRaise(e: GuidanceEvent): boolean {
  if (!e.v2) return true;
  const ups = e.changes.map((c, i) => ({ c, r: e.v2!.ranges[i] })).filter(x => x.c.direction === 'UP' && !!x.c.before);
  if (!ups.length) return true;
  return ups.some(x => !x.r || REAL_RAISE.has(x.r.klass));
}

const tolOf = (a: number, b: number) => 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
/** Range maths for one changed metric. Midpoint alone is never enough: the low and high ends are checked too.
 *  For growth/margin (rate) points the *ChangePct fields hold percentage-point changes, not relative %. */
export function computeRangeMath(before: GuGuidancePoint | null, after: GuGuidancePoint): GuRangeMath {
  const ends = (p: GuGuidancePoint | null) => {
    if (!p) return { lo: null, hi: null, mid: null };
    const lo = p.low ?? p.midpoint; const hi = p.high ?? p.midpoint;
    const mid = p.midpoint ?? (lo != null && hi != null ? (lo + hi) / 2 : null);
    return { lo, hi, mid };
  };
  const b = ends(before); const a = ends(after);
  const rate = after.isGrowthRate;
  const chg = (x: number | null, y: number | null): number | null => x == null || y == null ? null : rate ? round(x - y, 4) : (y !== 0 ? round(((x - y) / Math.abs(y)) * 100, 2) : null);
  const wB = b.lo != null && b.hi != null ? round(b.hi - b.lo, 6) : null;
  const wA = a.lo != null && a.hi != null ? round(a.hi - a.lo, 6) : null;
  let klass: GuRangeClass = 'UNKNOWN';
  if (!before) klass = 'FIRST_GUIDANCE';
  else if (b.lo != null && b.hi != null && b.mid != null && a.lo != null && a.hi != null && a.mid != null) {
    const t = tolOf(a.mid, b.mid);
    const dm = a.mid - b.mid;
    if (dm < -t) klass = 'DOWNGRADE';
    else if (Math.abs(dm) <= t) klass = (wA ?? 0) > (wB ?? 0) + t ? 'RANGE_WIDENING' : 'REITERATION';
    else if (a.lo < b.lo - t || a.hi < b.hi - t) klass = 'MIDPOINT_RAISE_RANGE_NARROWING';
    else if (a.lo > b.lo + t && a.hi > b.hi + t) klass = 'CLEAN_RAISE';
    else if (a.lo > b.lo + t) klass = 'RANGE_SHIFT_UP';
    else klass = 'RANGE_WIDENING';
  }
  const floorAboveOldCeiling = !!before && a.lo != null && b.hi != null && a.lo > b.hi + tolOf(a.lo, b.hi);
  return {
    floorAboveOldCeiling,
    beforeLow: b.lo, beforeMid: b.mid, beforeHigh: b.hi, afterLow: a.lo, afterMid: a.mid, afterHigh: a.hi,
    widthBefore: wB, widthAfter: wA, lowChangePct: chg(a.lo, b.lo), midChangePct: chg(a.mid, b.mid), highChangePct: chg(a.hi, b.hi), klass,
  };
}

const PER_SHARE = new Set<GuMetric>(['EPS', 'ADJ_EPS']);
/** EPS must be a per-share amount; any scale (M/B/K/Cr), an implausible size, or before/after units that differ is a unit error:
 *  the change is dropped with a warning rather than printed. The same unit-mismatch rule covers every absolute metric. */
export function validateChangeUnits(changes: GuChange[]): { kept: GuChange[]; warnings: string[] } {
  const kept: GuChange[] = []; const warnings: string[] = [];
  const scaled = (p: GuGuidancePoint | null) => !!p && !p.isGrowthRate && !!p.unit && p.unit !== '%';
  for (const c of changes) {
    const name = METRIC_LABEL[c.metric];
    const pts = [c.after, c.before].filter((p): p is GuGuidancePoint => !!p);
    if (PER_SHARE.has(c.metric)) {
      if (pts.some(p => p.isGrowthRate)) { warnings.push(`Unit error: ${name} must be a per-share amount, not a rate. Figure dropped.`); continue; }
      if (pts.some(scaled)) { warnings.push(`Unit error: ${name} carried a scale (million, billion, crore) but must be a per-share amount. Figure dropped, not shown.`); continue; }
      if (pts.some(p => Math.abs(p.midpoint ?? 0) > 1000)) { warnings.push(`Unit error: ${name} is implausibly large for a per-share amount. Figure dropped.`); continue; }
    }
    if (c.before && !c.after.isGrowthRate && !c.before.isGrowthRate) {
      if ((c.before.unit ?? '') !== (c.after.unit ?? '') || (c.before.currency && c.after.currency && c.before.currency !== c.after.currency)) {
        warnings.push(`Unit error: before and after ${name} figures use different units or currencies. Figure dropped.`); continue;
      }
    }
    kept.push(c);
  }
  return { kept, warnings };
}

type BasisWord = 'ADJUSTED' | 'GAAP' | null;
function basisWordIn(s: string): BasisWord {
  if (/non-?gaap|adjusted|\badj\b\.?/i.test(s)) return 'ADJUSTED';
  if (/\bgaap\b|\breported\b/i.test(s)) return 'GAAP';
  return null;
}
/** A change whose before side is on one basis (GAAP) and after side on another (adjusted), read from the words right before each figure. */
export function basisMismatch(text: string, c: GuChange): boolean {
  if (!c.before?.raw || !c.after.raw) return false;
  const bRaw = c.before.raw; const aTail = c.after.raw.replace(/^[^\d$₹€£]*/, '');
  for (const sent of splitSentences(text)) {
    const bi = sent.indexOf(bRaw); const ai = aTail ? sent.indexOf(aTail) : -1;
    if (bi < 0 || ai < 0 || bi === ai) continue;
    const win = (idx: number, other: number) => sent.slice(Math.max(other < idx ? other + 1 : 0, idx - 50), idx);
    const bw = basisWordIn(win(bi, ai)); const aw = basisWordIn(win(ai, bi) + ' ' + c.after.raw.slice(0, Math.max(0, c.after.raw.indexOf(aTail))));
    if (bw && aw && bw !== aw) return true;
  }
  return false;
}
function basisOfEvent(changes: GuChange[], text: string): GuMetricBasis {
  const map: Record<string, GuMetricBasis> = { NON_GAAP: 'ADJUSTED', GAAP: 'GAAP', ORGANIC: 'ORGANIC', REPORTED: 'REPORTED' };
  const eps = changes.find(c => PER_SHARE.has(c.metric)); const pick = eps ?? changes[0];
  const b = pick?.after.basis ? map[pick.after.basis] : undefined;
  if (b) return b;
  return /constant[- ]currency|\bcc basis\b/i.test(text) ? 'CONSTANT_CURRENCY' : 'UNSTATED';
}

// ── researched WHY NOW: operating variable named only when the text states it ────────────────
interface VarRule { key: string; label: string; re: RegExp; next: string }
const VAR_RULES: VarRule[] = [
  { key: 'CAPACITY', label: 'new capacity coming on stream', next: 'Commissioning of the new plant and utilisation in the next quarter\'s results',
    re: /\b(?:new|additional|expanded|upcoming)\s+(?:\w+\s+){0,2}?(?:plants?|facilit(?:y|ies)|lines?|capacity|units?|factor(?:y|ies))\b|\bcapacity (?:expansion|addition|ramp)|\bcommission(?:ed|ing)\b/i },
  { key: 'ORDERS', label: 'order pipeline', next: 'Order book / order inflow disclosed with the next quarter\'s results',
    re: /\border (?:pipeline|book|backlog|inflows?|intake)\b|\b(?:robust|strong|strongest|healthy|record)\s+(?:\w+\s+){0,2}?pipeline\b|\bbacklog\b/i },
  { key: 'EXPORTS', label: 'exports', next: 'Export revenue share in the next quarter\'s results',
    re: /\bexports?\b|\bexport (?:revenue|sales|demand|markets?)\b|\bacross \d+\+? countries\b/i },
  { key: 'VOLUME', label: 'higher volumes', next: 'Volume growth in the next quarter\'s results against the guided pace',
    re: /\b(?:higher|strong|robust|record|rising|growth in)\s+(?:sales\s+)?volumes?\b|\bvolume (?:growth|increases?|gains?)\b|\bvolumes? (?:rose|grew|up)\b/i },
  { key: 'PRICE', label: 'price / realisation', next: 'Realisation per unit in the next quarter\'s results, and whether the price rise holds',
    re: /\bprice (?:hikes?|increases?|realisations?|realizations?)\b|\bhigher (?:selling )?(?:prices|realisations?|realizations?)\b|\bpricing (?:power|actions?)\b/i },
  { key: 'MIX', label: 'product mix', next: 'Share of higher-value products in the next quarter\'s sales mix',
    re: /\b(?:richer|favou?rable|better|premium|improved|value-added|product) mix\b|\bmix (?:improvement|shift)\b|\bpremiumi[sz]ation\b/i },
  { key: 'UTIL', label: 'capacity utilisation', next: 'Capacity utilisation in the next quarter\'s results',
    re: /\butili[sz]ation\b/i },
  { key: 'MARGIN', label: 'margin expansion', next: 'Operating margin in the next quarter\'s results against the guided level',
    re: /\bmargin (?:expansion|improvement)\b|\boperating leverage\b|\bcost (?:savings|efficienc\w+|reductions?)\b/i },
  { key: 'FX', label: 'currency moves', next: 'Constant-currency growth against reported growth in the next quarter',
    re: /\b(?:currency|foreign exchange|forex|fx)\b[^.;]{0,30}\b(?:tailwinds?|benefits?|gains?|translation)\b|\bfavou?rable (?:currency|exchange)\b/i },
  { key: 'DEMAND', label: 'customer demand', next: 'Order or volume growth in the next quarter as the demand check',
    re: /\b(?:strong|robust|healthy|record|higher)\s+(?:customer\s+)?demand\b|\bdemand (?:momentum|strength|pick-?up|recovery)\b/i },
];
export interface GuWhyNow { resolved: boolean; variable: string | null; keys: string[] }
/** Reads the operating variable from the text only when it is stated. No stated variable -> unresolved (never guessed). */
export function researchWhyNow(text: string, driver: GuDriverResult): GuWhyNow {
  const keys: string[] = []; const labels: string[] = [];
  for (const r of VAR_RULES) if (r.re.test(text ?? '')) { keys.push(r.key); labels.push(r.label); }
  // utilisation is already covered by new capacity
  const uniq = labels.filter((l, i) => !(keys[i] === 'UTIL' && keys.includes('CAPACITY')));
  const variable = uniq.length ? uniq.slice(0, 3).join(' + ') : null;
  return { resolved: variable != null || driver.quality !== 'UNKNOWN', variable, keys };
}
/** 1-2 measurable, driver-specific checks. Empty when no driver is stated (caller falls back to metric lines). */
export function nextEvidenceFor(variable: string | null): string[] {
  if (!variable) return [];
  const has = (label: string) => variable.includes(label);
  const out: string[] = [];
  for (const r of VAR_RULES) if (has(r.label) && r.key !== 'EXPORTS' && r.key !== 'ORDERS') out.push(r.next);
  const ord = has('order pipeline'); const exp = has('exports');
  if (ord && exp) out.push('Order book / export revenue share next quarter');
  else if (ord) out.push(VAR_RULES.find(r => r.key === 'ORDERS')!.next);
  else if (exp) out.push(VAR_RULES.find(r => r.key === 'EXPORTS')!.next);
  return out;
}

// ── durability from stated evidence only ─────────────────────────────────────────────────────
const SHORT_LIVED_RE = /\b(?:temporar\w+|short[- ]?term|short[- ]?lived|transient|fleeting|one[- ]quarter|this quarter only|(?:expected|likely|set) to (?:fade|reverse|normali[sz]e|ease|unwind)|will (?:fade|reverse|normali[sz]e|ease)|windfall)\b/i;
export function assessDurability(text: string, changes: GuChange[], driver: GuDriverResult, old: GuDuration, w: GuWhyNow): { level: GuDurabilityLevel; why: string } {
  const t = text ?? ''; const has = (k: string) => w.keys.includes(k);
  if (old === 'ONE_OFF') return { level: 'ONE_OFF', why: 'The stated driver is a one-time item, so it is not expected to repeat.' };
  if (/\b(?:structural|secular)\b/i.test(t) && (has('CAPACITY') || has('ORDERS') || driver.kinds.includes('STRUCTURAL') || /multi-?year/i.test(t)))
    return { level: 'STRUCTURAL', why: 'The source describes the demand as structural or secular and backs it with capacity, orders or a multi-year view.' };
  if (contractIsMechanism(t) || (old === 'MULTI_YEAR' && contractIsMechanism(t)))
    return { level: 'MULTI_YEAR', why: 'The source states a multi-year contract or backlog as the way the guided number is delivered, which reaches beyond this year.' };
  if (/\b(?:multi-?year|long-term) (?:contracts?|order book|backlog|agreements?|orders?)\b|\b\d[- ]year (?:contracts?|agreements?|orders?)\b/i.test(t) || old === 'MULTI_YEAR')
    return { level: 'UNKNOWN_INSUFFICIENT_EVIDENCE', why: 'Multi-year contracts are mentioned, but the source does not say they drive the guided number, so how long this lasts is unknown (not assumed).' };
  if (has('CAPACITY') && (has('ORDERS') || has('EXPORTS')))
    return { level: 'MULTI_QUARTER', why: 'New capacity is being added and an order pipeline or export demand is stated, so output can stay higher for several quarters. Whether it lasts years is not stated.' };
  if (has('CAPACITY')) return { level: 'MULTI_QUARTER', why: 'New capacity is being added, which stays in place after this quarter. Demand to fill it is not evidenced in the source.' };
  if (has('ORDERS')) return { level: 'MULTI_QUARTER', why: 'An order book or pipeline is stated; it converts to revenue over the coming quarters. Contract length is not stated.' };
  if (old === 'MULTI_QUARTER') return { level: 'MULTI_QUARTER', why: 'The source states the driver continues over the coming quarters.' };
  // zzz849: "one to two quarters" is claimed ONLY when the source says the driver is short-lived. A driver such as currency, prices or commodities
  // being mentioned is not evidence that it reverses; without that statement the answer is "unknown, not enough evidence".
  if (driver.kinds.some(k => k === 'FX' || k === 'TEMP_SUPPLY' || k === 'ONE_OFF_PRICING' || k === 'PRICE_HIKE' || k === 'COMMODITY') && SHORT_LIVED_RE.test(t))
    return { level: '1_2_QUARTERS', why: 'The source says the driver (currency, prices, supply or commodities) is temporary or short-lived, so it can reverse within a quarter or two.' };
  // zzz854: specific to the guided figure, not a generic line
  const c0 = changes.find(c => c.direction === 'UP' && !!c.before) ?? changes[0];
  const what = c0 ? `the guided ${c0.after.period && c0.after.period !== 'UNSTATED' ? `${c0.after.period} ` : ''}${metricLabel(c0)}` : 'the guided figure';
  return { level: 'UNKNOWN_INSUFFICIENT_EVIDENCE', why: `The source ties no new capacity, multi-year contract or order backlog to ${what}, so how long this lasts is unknown (not assumed brief).` };
}
const DUR_FROM_LEVEL: Record<GuDurabilityLevel, GuDuration> = { ONE_OFF: 'ONE_OFF', '1_2_QUARTERS': 'UNKNOWN', MULTI_QUARTER: 'MULTI_QUARTER', MULTI_YEAR: 'MULTI_YEAR', STRUCTURAL: 'MULTI_YEAR', UNKNOWN_INSUFFICIENT_EVIDENCE: 'UNKNOWN' };

// ── market cap bucket (context only; never a price signal) ───────────────────────────────────
/** India: small/mid when below ₹30,000 Cr. Input may be in ₹ Cr (< 1e9) or raw rupees (>= 1e9).
 *  US: small/mid when below $10B. Input may be raw dollars (>= 1e7), $M (1e3..1e7) or $B (< 1e3). Unknown -> null, never assumed. */
export function isSmallMidCap(market: GuMarket, cap: number | null | undefined): boolean | null {
  if (cap == null || !isFinite(cap) || cap <= 0) return null;
  if (market === 'IN') return (cap >= 1e9 ? cap / 1e7 : cap) < 30000;
  if (market === 'US') { const b = cap >= 1e7 ? cap / 1e9 : cap >= 1e3 ? cap / 1e3 : cap; return b < 10; }
  return null;
}

function pctOfChange(c: GuChange): number | null { return c.after.isGrowthRate ? c.percentagePointChange : c.percentageChange; }

export function detectedViaOf(cands: GuCandidate[]): string[] {
  const out = new Set<string>();
  for (const c of cands) {
    const host = hostOf(c.url);
    if (/graded/i.test(`${c.id} ${c.sourceName}`)) out.add('graded results');
    if (c.kind === 'FILING') out.add(hostIn(host, ['sec.gov']) || /\b8-?k\b|sec filing/i.test(c.sourceName) ? 'SEC 8-K' : 'exchange filing');
    else if (c.kind === 'RELEASE') out.add('company press release');
    else if (c.kind === 'TRANSCRIPT') out.add('concall');
    else if (c.kind === 'DECK') out.add('investor deck');
    else out.add('news');
  }
  return [...out];
}

function buildScorecard(e: GuidanceEvent, ranges: GuRangeMath[], level: GuDurabilityLevel, durWhy: string): GuScoreItem[] {
  const ups = e.changes.filter(c => c.direction === 'UP' && !!c.before);
  const pcts = ups.map(pctOfChange).filter((x): x is number => x != null);
  const best = pcts.length ? Math.max(...pcts) : null;
  const sizeText = ups.map(c => `${metricLabel(c)} ${signed(pctOfChange(c) ?? 0, 1)}${c.after.isGrowthRate ? ' points' : '%'}`).join(', ');
  const clean = hasRealRaise(e);
  const pe = e.valuation?.currentPE.value ?? null;
  const items: GuScoreItem[] = [];
  items.push({ label: 'Size of the raise', rating: best == null ? 'UNKNOWN' : best >= 20 ? 'STRONG' : best >= 8 ? 'OK' : 'WEAK',
    detail: best == null ? 'No before and after numbers, so the size cannot be measured.' : `Guidance moved up: ${sizeText}.` });
  items.push({ label: 'Earnings materiality', rating: e.materiality === 'HIGH' ? 'STRONG' : e.materiality === 'MEDIUM' ? 'OK' : e.materiality === 'LOW' ? 'WEAK' : 'UNKNOWN',
    detail: e.materialityBasis || DATA_UNAVAILABLE });
  items.push({ label: 'Guidance vs consensus', rating: e.expectationGap === 'UNKNOWN' ? 'UNKNOWN' : e.expectationGap === 'NEGATIVE' ? 'WEAK' : e.expectationGap === 'LARGE_POSITIVE' || e.expectationGap === 'POSITIVE' ? 'STRONG' : 'OK',
    detail: e.expectationGap === 'UNKNOWN' ? 'No consensus number was supplied. The comparison is unknown, not negative, and it does not lower the other scores.' : `Guidance versus consensus: ${e.gapPct != null ? signed(e.gapPct, 1) + '%' : DATA_UNAVAILABLE}.` });
  const klasses = [...new Set(ranges.map(r => r.klass))].filter(k => k !== 'UNKNOWN');
  items.push({ label: 'Quality of the raise', rating: !clean ? 'WEAK' : e.guidance_quality === 'HIGH' ? 'STRONG' : e.guidance_quality === 'MEDIUM' ? 'OK' : e.guidance_quality === 'LOW' ? 'WEAK' : 'UNKNOWN',
    detail: `${!clean ? 'Not a clean raise: the low end of the range did not move up. ' : ''}Driver: ${e.guidance_driver}.${klasses.length ? ` Range check: ${klasses.join(', ').toLowerCase().replace(/_/g, ' ')}.` : ''}` });
  items.push({ label: 'Durability', rating: level === 'STRUCTURAL' || level === 'MULTI_YEAR' ? 'STRONG' : level === 'MULTI_QUARTER' ? 'OK' : level === 'UNKNOWN_INSUFFICIENT_EVIDENCE' ? 'UNKNOWN' : 'WEAK', detail: durWhy });
  items.push({ label: 'Valuation', rating: pe == null ? 'UNKNOWN' : pe < 25 ? 'STRONG' : pe < GU_THRESHOLDS.STRETCHED_PE ? 'OK' : 'WEAK',
    detail: pe == null ? 'P/E not supplied, so valuation is unknown.' : `P/E ${fmtNum(pe)}x${pe >= GU_THRESHOLDS.STRETCHED_PE ? ', already stretched' : ''}. Context only.` });
  items.push({ label: 'Evidence', rating: e.verification !== 'VERIFIED' ? 'WEAK' : ups.length && e.driverEvidence === 'DIRECT' ? 'STRONG' : 'OK',
    detail: e.verification === 'VERIFIED' ? `Primary source found (${e.sources.filter(s => s.tier === 'PRIMARY').map(s => s.name).slice(0, 2).join(', ')}).${ups.length ? '' : ' No before and after numbers yet.'}` : 'No primary source yet, so this stays a candidate.' });
  const pi = e.links.portfolioImpact;
  items.push({ label: 'Portfolio impact', rating: pi === 'SUPPORTS' ? 'STRONG' : pi === 'NEUTRAL' ? 'OK' : pi === 'WEAKENS' || pi === 'BROKEN' ? 'WEAK' : 'UNKNOWN',
    detail: pi ? `Holding impact: ${pi.toLowerCase()}.` : 'Not a holding, or no thesis on file, so not assessed.' });
  return items;
}

function v2DecisionLines(e: GuidanceEvent): string[] {
  const v = e.v2; if (!v) return [];
  const out: string[] = [];
  const odd = v.ranges.map((r, i) => ({ r, c: e.changes[i] })).filter(x => x.c && x.c.direction === 'UP' && x.r.klass !== 'CLEAN_RAISE' && x.r.klass !== 'RANGE_SHIFT_UP');
  if (odd.length) out.push(`Range check: ${odd.map(x => `${metricLabel(x.c)} is ${x.r.klass.toLowerCase().replace(/_/g, ' ')}`).join('; ')}.`);
  else if (v.ranges.some(r => r.floorAboveOldCeiling)) out.push('Range check: FLOOR ABOVE OLD CEILING. The new low end is above the old high end (strongest kind of raise).');
  else if (v.ranges.some(r => r.klass === 'CLEAN_RAISE')) out.push('Range check: the low and high ends of the guided range both moved up (clean raise).');
  if (v.unitWarnings.length) out.push(`Warnings: ${v.unitWarnings.join(' ')}`);
  const stated = v.operatingVariable || (e.guidance_quality !== 'UNKNOWN' && !/not stated/i.test(e.guidance_driver));
  out.push(stated ? `Why now: ${v.operatingVariable ?? e.guidance_driver}.` : `${driverNotStatedLine(e, classOfEvent(e) === 'UPGRADE' ? 'raised' : 'updated')}.`);
  out.push(`Durability evidence: ${v.durabilityLevel.replace(/_/g, ' ').toLowerCase()} — ${v.durabilityWhy}`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// 18. rank
// ---------------------------------------------------------------------------------------------
const GAP_RANK: Record<GuGap, number> = { LARGE_POSITIVE: 5, POSITIVE: 4, SMALL_POSITIVE: 3, INLINE: 2, UNKNOWN: 1, NEGATIVE: 0 };
const DUR_RANK: Record<GuDuration, number> = { MULTI_YEAR: 3, MULTI_QUARTER: 2, UNKNOWN: 1, ONE_OFF: 0 };
const QUAL_RANK: Record<GuQuality, number> = { HIGH: 3, MEDIUM: 2, UNKNOWN: 1, LOW: 0 };
/** Lexicographic (packed into rankKey, internal only): verified > materiality > gap > guidance size > durability > quality >
 *  evidence quality > valuation disconnect (EPS effect) > structural alignment > portfolio relevance. NEVER price or momentum. */
export function rankKeyOf(e: GuidanceEvent): number {
  const mag = Math.max(0, ...upChanges(e).map(c => (c.after.isGrowthRate ? c.percentagePointChange : c.percentageChange) ?? 0));
  const evQ = Math.min(9, (e.primaryAvailable ? 5 : 0) + Math.min(3, e.sources.length) + (e.driverEvidence === 'DIRECT' ? 1 : 0));
  const valD = Math.min(9, Math.floor(Math.max(0, e.valuation?.earningsEffectPct.value ?? 0) / 2));
  const digits = [
    e.verification === 'VERIFIED' ? 1 : 0, MATRANK[e.materiality], GAP_RANK[e.expectationGap], Math.min(9, Math.floor(mag / 2)),
    DUR_RANK[e.duration], QUAL_RANK[e.guidance_quality], evQ, valD,
    (e.links.structuralAlignment ?? '').trim() ? 1 : 0, e.links.inBook ? 1 : 0,
  ];
  return digits.reduce((a, d) => a * 10 + d, 0);
}
export function rank(events: GuidanceEvent[]): GuidanceEvent[] {
  const out = events.map(e => ({ ...e, rankKey: rankKeyOf(e) }));
  return out.sort((a, b) => b.rankKey - a.rankKey || a.ticker.localeCompare(b.ticker) || b.announcement_date.localeCompare(a.announcement_date));
}

// ---------------------------------------------------------------------------------------------
// 19. buildGuidanceEvent / processCandidates / summarise
// ---------------------------------------------------------------------------------------------
function applyPrior(changes: GuChange[], prior?: GuGuidancePoint[]): GuChange[] {
  if (!prior?.length) return changes;
  return changes.map(c => {
    if (c.before) return c;
    const p = prior.find(x => x.metric === c.metric && x.period === c.after.period && x.midpoint != null && x.isGrowthRate === c.after.isGrowthRate
      && (x.unit == null || c.after.unit == null || x.unit === c.after.unit) && (x.currency == null || c.after.currency == null || x.currency === c.after.currency) && (x.periodKind || '') === (c.after.periodKind || '')
      // zzz880: a figure from an EARLIER document must carry exactly the same unit and currency (KSH: "67,000–74,000" with no unit vs "₹75,000")
      && (!String(x.raw || '').includes('(earlier guidance:') || ((x.unit || '') === (c.after.unit || '') && (x.currency || '') === (c.after.currency || '')
        // zzz881: same measure, same scope, company guidance on both sides, and a clean raise — else it is not "the old guidance"
        && !earlierPriorMismatch(x, c.after, c.metric))));
    return p ? makeChange(p, c.after) : c;
  });
}

function portfolioImpact(e: { inBook: boolean; bookThesis?: GuThesis; verification: GuVerification; quality: GuQuality; gap: GuGap; mat: GuMateriality; thesisBreaking: boolean }): GuPortfolioImpact | undefined {
  if (!e.inBook || !e.bookThesis) return undefined;
  if (e.thesisBreaking && e.quality === 'LOW') return 'BROKEN';
  if (e.quality === 'LOW' || e.thesisBreaking) return 'WEAKENS';
  if (e.verification === 'VERIFIED' && MATRANK[e.mat] >= 2 && (e.quality === 'HIGH' || e.quality === 'MEDIUM') && e.gap !== 'NEGATIVE') return 'SUPPORTS';
  return 'NEUTRAL';
}


// ---------------------------------------------------------------------------------------------
// zzz853: classification follows the numbers; dates; source claims and conflicts; the company's own driver sentence
// ---------------------------------------------------------------------------------------------
export const AUDIT_NOTE = 'Adjusted: headline described a raise; normalised guidance did not constitute a clean raise.';
export const LABEL_UPGRADE = 'GUIDANCE UPGRADE';
export const LABEL_UNVERIFIED = 'UNVERIFIED CLAIM';
export const LABEL_REITERATION = 'REITERATION';
export const LABEL_MIXED = 'MIXED / RANGE CHANGE';
export const LABEL_LOWERED = 'GUIDANCE LOWERED';
export const LABEL_NO_NUMBERS = 'DETECTED, NUMBERS NOT FOUND';

/**
 * What the numbers say, independent of the headline verb:
 * RAISE = at least one measure moved up with a real raise of the range (the low end moved up).
 * MIXED = a midpoint-only raise (range narrowed / top end cut), a widened range, a basis mismatch, or mixed moves without a raise.
 * REITERATION = every compared measure unchanged. DOWNGRADE = lowered. DETECTED = no before and after numbers.
 * 'GUIDANCE UPGRADE' is the label ONLY for a VERIFIED RAISE. Anything that is not a clean raise is `auditOnly` and never an upgrade.
 */
export const LABEL_REVIEW: Record<NonNullable<GuPipeline['reviewStatus']>, string> = {
  awaiting_numbers: 'AWAITING NUMBERS', awaiting_primary: 'AWAITING PRIMARY SOURCE', needs_review: 'NEEDS REVIEW', invalid: 'INVALID COMPARISON',
  stale: 'STALE PERIOD', capital_raise: 'CAPITAL RAISE (NOT GUIDANCE)', first_guidance: 'FIRST GUIDANCE (NOT A RAISE)', not_guidance: 'NOT GUIDANCE',
};
type ClassifyInput = Pick<GuidanceEvent, 'changes' | 'v2' | 'verification'> & Partial<Pick<GuidanceEvent, 'pipeline' | 'taxonomy' | 'otherChanges' | 'company' | 'announcement_date'>>;
export function classifyEvent(e: ClassifyInput): { classification: GuClassification; displayLabel: string; auditOnly: boolean; auditNote?: string; isUpgrade: boolean } {
  const cls = e.v2?.eventClass ?? eventClassOf(e.changes, e.v2?.ranges);
  const verified = e.verification === 'VERIFIED';
  let classification: GuClassification;
  if (cls === 'UPGRADE') {
    const ups = e.changes.map((c, i) => ({ c, r: e.v2?.ranges[i] })).filter(x => x.c.direction === 'UP' && !!x.c.before);
    const clean = ups.some(x => !!x.r && REAL_RAISE.has(x.r.klass)) || (!e.v2 && ups.length > 0);
    classification = clean ? 'RAISE' : 'MIXED';
    if (e.taxonomy === 'mixed_range_change') classification = 'MIXED';   // zzz854: a raise next to a cut in the same release is mixed, never a clean raise
  } else if (cls === 'REITERATION') classification = 'REITERATION';
  else if (cls === 'DOWNGRADE') classification = 'DOWNGRADE';
  else if (cls === 'NO_RAISE') classification = 'MIXED';
  else classification = 'DETECTED';
  const pl = e.pipeline;
  if (pl) {
    // zzz854: the label follows the pipeline: GUIDANCE UPGRADE only for a verified formal upgrade (a main card)
    const auditOnly = pl.status === 'AUDIT' || (classification !== 'RAISE' && classification !== 'DETECTED');
    const displayLabel = pl.status === 'CARD' ? LABEL_UPGRADE
      : pl.status === 'AUDIT' ? (classification === 'REITERATION' ? LABEL_REITERATION : classification === 'DOWNGRADE' ? LABEL_LOWERED : LABEL_MIXED)
      : pl.bucket === 'unverified' ? LABEL_UNVERIFIED : pl.reviewStatus ? LABEL_REVIEW[pl.reviewStatus] : LABEL_UNVERIFIED;
    const isUpgrade = classification === 'RAISE' && e.taxonomy === 'formal_upgrade' && (pl.status === 'CARD' || pl.bucket === 'unverified');
    return { classification, displayLabel, auditOnly, auditNote: auditOnly ? auditNoteFor(e) : undefined, isUpgrade };
  }
  const displayLabel = classification === 'RAISE' ? (verified ? LABEL_UPGRADE : LABEL_UNVERIFIED)
    : classification === 'REITERATION' ? LABEL_REITERATION
    : classification === 'MIXED' ? LABEL_MIXED
    : classification === 'DOWNGRADE' ? LABEL_LOWERED
    : verified ? LABEL_NO_NUMBERS : LABEL_UNVERIFIED;
  const auditOnly = classification !== 'RAISE' && classification !== 'DETECTED';
  return { classification, displayLabel, auditOnly, auditNote: auditOnly ? auditNoteFor(e) : undefined, isUpgrade: classification === 'RAISE' };
}

// ── zzz854: specific audit reason per row (never one generic sentence) ───────────────────────────────────────────
const endVal = (p: GuGuidancePoint, v: number | null): string => {
  if (v == null) return DATA_UNAVAILABLE;
  if (!p.isGrowthRate && !p.unit && p.currency) return `${v < 0 ? '-' : ''}${p.currency}${Math.abs(v).toFixed(2)}`;   // a per-share amount keeps its cents ($4.90)
  return fmtPoint({ ...p, low: v, high: v, midpoint: v });
};
const perWords = (c: GuChange): string => (c.after.period && c.after.period !== 'UNSTATED' ? `${periodWords(c.after)} ` : '');
/** 'Reiteration: FY26 revenue $1.2B to $1.3B unchanged' / 'Lowered: FY26 EPS high end cut from $4.50 to $4.30' / 'Mixed: revenue up, EBITDA down' */
export function auditNoteFor(e: Pick<GuidanceEvent, 'changes' | 'v2'> & Partial<Pick<GuidanceEvent, 'otherChanges'>>): string {
  const all = [...e.changes, ...(e.otherChanges ?? [])].filter(c => !!c.before && c.direction !== 'UNKNOWN').sort((a, b) => narrativeRank(a) - narrativeRank(b));
  const ups = all.filter(c => c.direction === 'UP'); const downs = all.filter(c => c.direction === 'DOWN'); const flats = all.filter(c => c.direction === 'FLAT');
  const rangeOf = (c: GuChange) => { const i = e.changes.indexOf(c); return i >= 0 ? e.v2?.ranges?.[i] : computeRangeMath(c.before, c.after); };
  if (ups.length && downs.length) {
    const nm = (l: GuChange[]) => [...new Set(l.map(c => metricLabel(c)))].join(' and ');
    return `Mixed: ${nm(ups)} up, ${nm(downs)} down (${downs.map(c => `${perWords(c)}${metricLabel(c)} ${fmtPoint(c.before)} → ${fmtPoint(c.after)}`).join('; ')})`;
  }
  if (e.v2?.unitWarnings?.some(w => /basis mismatch/i.test(w))) return `Basis mismatch: ${e.v2.unitWarnings.find(w => /basis mismatch/i.test(w))}`;
  for (const c of ups) {
    const r = rangeOf(c);
    if (r?.klass === 'MIDPOINT_RAISE_RANGE_NARROWING') {
      const top = r.afterHigh != null && r.beforeHigh != null && r.afterHigh < r.beforeHigh;
      return top ? `Midpoint up but range narrowed: ${perWords(c)}${metricLabel(c)} top end cut from ${endVal(c.before!, r.beforeHigh)} to ${endVal(c.after, r.afterHigh)} (midpoint ${endVal(c.before!, r.beforeMid)} → ${endVal(c.after, r.afterMid)})`
        : `Midpoint up but range narrowed: ${perWords(c)}${metricLabel(c)} low end cut from ${endVal(c.before!, r.beforeLow)} to ${endVal(c.after, r.afterLow)}`;
    }
    if (r?.klass === 'RANGE_WIDENING') return `Range widened: ${perWords(c)}${metricLabel(c)} ${fmtPoint(c.before)} → ${fmtPoint(c.after)}; the low end did not move up`;
  }
  if (downs.length) {
    const c = downs[0]; const r = rangeOf(c);
    if (r && r.afterHigh != null && r.beforeHigh != null && r.afterLow != null && r.beforeLow != null && r.afterHigh < r.beforeHigh && Math.abs(r.afterLow - r.beforeLow) < 1e-9)
      return `Lowered: ${perWords(c)}${metricLabel(c)} high end cut from ${endVal(c.before!, r.beforeHigh)} to ${endVal(c.after, r.afterHigh)}`;
    return `Lowered: ${perWords(c)}${metricLabel(c)} ${fmtPoint(c.before)} → ${fmtPoint(c.after)}${downs.length > 1 ? ` (plus ${downs.length - 1} more measure${downs.length > 2 ? 's' : ''} lowered)` : ''}`;
  }
  if (flats.length) {
    const c = flats[0]; const r = rangeOf(c);
    if (r?.klass === 'RANGE_WIDENING') return `Range widened: ${perWords(c)}${metricLabel(c)} ${fmtPoint(c.before)} → ${fmtPoint(c.after)}, midpoint unchanged`;
    const list = flats.slice(0, 3).map((x, i) => `${i === 0 ? perWords(x) : ''}${metricLabel(x)} ${fmtPoint(x.after)}`);
    return `Reiteration: ${list.join(list.length > 2 ? ', ' : ' and ')} unchanged${flats.length > 3 ? ` (plus ${flats.length - 3} more)` : ''}`;
  }
  if (ups.length) return `Not a clean raise: ${perWords(ups[0])}${metricLabel(ups[0])} ${fmtPoint(ups[0].before)} → ${fmtPoint(ups[0].after)}; the low end of the range did not move up`;
  return AUDIT_NOTE;
}

// ── zzz854: one primary-source state, derived from data ──────────────────────────────────────────────────────────
export const PRIMARY_SOURCE_STATE_TEXT: Record<GuPrimarySourceState, string> = {
  not_found: 'Primary source: not found yet',
  found_not_read: 'Primary source found, not read yet',
  read_numbers_found: 'Primary source read — old and new figures found',
  read_numbers_not_found: 'Primary source read — old and new figures not found in it',
};
export function primarySourceStateOf(e: Pick<GuidanceEvent, 'verification' | 'primaryAvailable' | 'changes'> & Partial<Pick<GuidanceEvent, 'primarySourceUrl' | 'primaryState' | 'otherChanges'>>): GuPrimarySourceState {
  const numbers = [...e.changes, ...(e.otherChanges ?? [])].some(c => !!c.before && c.direction !== 'UNKNOWN');
  if (e.verification === 'VERIFIED' && e.primaryAvailable) return numbers ? 'read_numbers_found' : 'read_numbers_not_found';
  if (e.primarySourceUrl || e.primaryState === 'PRIMARY_SOURCE_FOUND' || e.primaryState === 'PRIMARY_SOURCE_READ') return 'found_not_read';
  return 'not_found';
}
const LEGACY_PRIMARY: Record<GuPrimarySourceState, GuPrimaryState> = {
  not_found: 'AWAITING_PRIMARY_SOURCE', found_not_read: 'PRIMARY_SOURCE_FOUND', read_numbers_found: 'PRIMARY_SOURCE_READ', read_numbers_not_found: 'PRIMARY_SOURCE_READ',
};
/** Re-derive the primary-source fields (call after anything changes sources / verification / primarySourceUrl). Pure. */
export function withPrimarySourceState<T extends GuidanceEvent>(e: T): T {
  const st = primarySourceStateOf(e);
  const legacy = st === 'not_found' && e.primaryState === 'SECONDARY_SOURCE_CLAIM' ? 'SECONDARY_SOURCE_CLAIM' : LEGACY_PRIMARY[st];
  // the legacy wording is kept for the page; the 'read but figures not found' state says so in the same line, so 'awaiting' and 'read' never appear together
  const text = st === 'read_numbers_not_found' ? `${PRIMARY_STATE_TEXT.PRIMARY_SOURCE_READ} — old and new figures not found in it` : PRIMARY_STATE_TEXT[legacy];
  return { ...e, primarySourceState: st, primaryState: legacy, primaryStateText: text };
}

// ── zzz854: taxonomy + pipeline ──────────────────────────────────────────────────────────────────────────────────
const ASPIRATION_RE = /\b(?:aspir\w+|ambitions?|vision\s?20\d\d|long[- ]term (?:targets?|goals?|aspirations?|ambitions?)|medium[- ]term (?:targets?|goals?|ambitions?|aspirations?)|by (?:FY\s?'?|20)\d{2}\b)/i;
const FIRST_GUIDANCE_RE = /\b(?:initiat\w+|introduc\w+|first[- ](?:ever|time)|issu\w+ (?:its )?(?:first|initial)|provid\w+ (?:its )?(?:first|initial)|maiden)\b[^.;]{0,40}\b(?:guidance|outlook|forecast)/i;
const NON_GUIDANCE_TX = new Set<GuTaxonomy>(['analyst_revision', 'earnings_beat', 'operational_disclosure', 'management_target']);
export function taxonomyOf(x: {
  title: string; text: string; candidates: readonly GuCandidate[]; changes: readonly GuChange[]; otherChanges: readonly GuChange[];
  /** the candidates' bodies without their headlines (the financing check reads the headline and the body separately) */
  body?: string;
  ranges: readonly GuRangeMath[]; evClass: GuEventClass; statedRaised: boolean;
}): GuTaxonomy {
  if (financingVerdict(x.title, x.body ?? x.text).capitalRaise) return 'capital_raise_or_financing';
  const verdicts = x.candidates.map(c => isGuidanceUpgradeCandidate(c));
  if (verdicts.length && !verdicts.some(v => v.include)) {
    const t = verdicts[0].taxonomy;
    if (t === 'analyst_revision' || ((t === 'earnings_beat' || t === 'operational_disclosure') && x.evClass === 'DETECTED')) return t;
  }
  const ups = x.changes.filter(c => c.direction === 'UP' && !!c.before);
  if (x.evClass === 'UPGRADE') {
    if (ups.length && ups.every(c => c.after.periodKind === 'MULTI_YEAR_CAGR')) return 'management_target';
    if (x.otherChanges.some(c => c.direction === 'DOWN' && !!c.before)) return 'mixed_range_change';
    const clean = x.changes.some((c, i) => c.direction === 'UP' && !!c.before && (!x.ranges[i] || REAL_RAISE.has(x.ranges[i].klass)));
    return clean ? 'formal_upgrade' : 'mixed_range_change';
  }
  if (x.evClass === 'REITERATION') return 'reiteration';
  if (x.evClass === 'DOWNGRADE') return 'downgrade';
  if (x.evClass === 'NO_RAISE') return 'mixed_range_change';
  const hasNew = x.changes.some(c => c.after.midpoint != null);
  if (hasNew && x.changes.every(c => c.after.periodKind === 'MULTI_YEAR_CAGR')) return 'management_target';
  if (hasNew) return 'first_guidance';
  if (ASPIRATION_RE.test(x.text) && !x.statedRaised) return 'management_target';
  return 'qualitative_commentary';
}
const figuresOf = (e: Pick<GuidanceEvent, 'changes'> & Partial<Pick<GuidanceEvent, 'otherChanges'>>): string[] =>
  [...e.changes, ...(e.otherChanges ?? [])].slice(0, 6).map(c => `${metricLabel(c)}${c.after.period && c.after.period !== 'UNSTATED' ? ` ${periodWords(c.after)}` : ' (period not stated)'}: new ${fmtPoint(c.after)}, old ${c.before ? fmtPoint(c.before) : DATA_UNAVAILABLE}`);
/** Where an item goes and which bucket counts it. Exactly one bucket per item. */
export function pipelineOf(e: Pick<GuidanceEvent, 'changes' | 'verification' | 'v2' | 'taxonomy' | 'validationIssues' | 'company' | 'announcement_date' | 'sources'> & Partial<Pick<GuidanceEvent, 'otherChanges' | 'primarySourceState' | 'primarySourceDate'>>, rawText = ''): GuPipeline {
  const tx = e.taxonomy ?? 'qualitative_commentary';
  const issues = e.validationIssues ?? [];
  const verified = e.verification === 'VERIFIED';
  const invalidFor = (c: GuChange) => issues.some(i => i.severity === 'INVALID' && i.metric === c.metric && i.period === c.after.period);
  const compared = e.changes.filter(c => !!c.before && c.direction !== 'UNKNOWN' && !invalidFor(c));
  if (tx === 'capital_raise_or_financing') {
    const r = financingVerdict('', rawText).reason ?? 'Capital raise or financing (offering, notes, credit facility, ATM, QIP), not guidance';
    return { status: 'DROPPED', bucket: 'capitalRaise', reviewStatus: 'capital_raise', reason: r };
  }
  if (NON_GUIDANCE_TX.has(tx)) {
    const why = tx === 'analyst_revision' ? 'Analyst or broker revision, not company guidance' : tx === 'earnings_beat' ? 'Earnings beat (actual versus expectation), not a guidance change'
      : tx === 'operational_disclosure' ? 'Operational disclosure (order, contract, volume), not a guidance change' : `Long-term management target or aspiration, not formal guidance (${figuresOf(e)[0] ?? 'no figure'})`;
    return { status: 'DROPPED', bucket: 'nonGuidance', reviewStatus: 'not_guidance', reason: why };
  }
  const inv = issues.filter(i => i.severity === 'INVALID');
  if (inv.length && !compared.length) {
    const stale = inv.find(i => i.code === 'STALE_PERIOD');
    return { status: 'QUEUE', bucket: 'invalidOrStale', reviewStatus: stale && inv.every(i => i.code === 'STALE_PERIOD') ? 'stale' : 'invalid', reason: (stale && inv.every(i => i.code === 'STALE_PERIOD') ? stale : inv[0]).text };
  }
  const rev = issues.filter(i => i.severity === 'REVIEW' && (i.metric == null || compared.some(c => c.metric === i.metric && c.after.period === i.period)));
  if (rev.length) return { status: 'QUEUE', bucket: 'awaitingNumbers', reviewStatus: 'needs_review', reason: rev[0].text };
  if (!compared.length) {
    const statedRaised = e.v2?.statedDirection === 'RAISED';
    const firstWords = FIRST_GUIDANCE_RE.test(rawText);
    if (tx === 'first_guidance' && (!statedRaised || firstWords))
      return { status: 'QUEUE', bucket: 'firstGuidance', reviewStatus: 'first_guidance', reason: `First guidance, not a raise: ${figuresOf(e)[0] ?? 'new figure'} — there is no earlier guidance to compare with` };
    const read = verified;
    const fig = figuresOf(e)[0];
    return read
      ? { status: 'QUEUE', bucket: 'awaitingNumbers', reviewStatus: 'awaiting_numbers', reason: `Primary source read, but old and new guidance figures for the same period were not both found${fig ? ` (${fig})` : ''}; the source says guidance was raised` }
      : { status: 'QUEUE', bucket: 'awaitingNumbers', reviewStatus: 'awaiting_primary', reason: `Raise claimed by ${sourceDocumentOf(e)}; no primary document read and old and new figures not both found${fig ? ` (${fig})` : ''}` };
  }
  if (!verified) return { status: 'QUEUE', bucket: 'unverified', reviewStatus: 'awaiting_primary', reason: `Not verified: no primary document read yet (claim from ${sourceDocumentOf(e)}). Awaiting verification against the company's own filing.` };
  if (tx === 'formal_upgrade') return { status: 'CARD', bucket: 'verifiedUpgrades', reviewStatus: null, reason: 'Verified formal upgrade: old and new figures, same metric, basis and period' };
  if (tx === 'reiteration') return { status: 'AUDIT', bucket: 'reiterations', reviewStatus: null, reason: auditNoteFor(e) };
  if (tx === 'downgrade') return { status: 'AUDIT', bucket: 'lowered', reviewStatus: null, reason: auditNoteFor(e) };
  return { status: 'AUDIT', bucket: 'mixed', reviewStatus: null, reason: auditNoteFor(e) };
}

/** One review-queue row from an item that is not an event card. */
export function reviewItemOf(e: GuidanceEvent): GuReviewItem {
  return {
    id: e.guidance_event_id, ticker: e.ticker, company: e.company, market: e.market, announcement_date: e.announcement_date,
    status: e.pipeline?.reviewStatus ?? 'needs_review', reason: e.pipeline?.reason ?? '', taxonomy: e.taxonomy ?? 'qualitative_commentary',
    primarySourceState: e.primarySourceState ?? primarySourceStateOf(e), primarySourceUrl: e.primarySourceUrl ?? null,
    figures: figuresOf(e), sources: e.sources.map(x => ({ name: x.name, url: x.url, tier: x.tier, date: x.date })),
  };
}
const emptyPipelineCounts = (): GuPipelineCounts => ({
  processed: 0, verifiedUpgrades: 0, reiterations: 0, mixed: 0, lowered: 0, firstGuidance: 0, invalidOrStale: 0, capitalRaise: 0, awaitingNumbers: 0, unverified: 0, nonGuidance: 0,
  stale: 0, needsReview: 0, awaitingPrimary: 0, material: 0, expectationPositive: 0, cards: 0, audit: 0, queue: 0, dropped: 0,
});
/** Exact partition of processed items. verifiedUpgrades + reiterations + mixed + lowered + firstGuidance + invalidOrStale + capitalRaise + awaitingNumbers + unverified + nonGuidance === processed. */
export function pipelineCounts(events: readonly GuidanceEvent[]): GuPipelineCounts {
  const n = emptyPipelineCounts();
  for (const e of events) {
    const p = e.pipeline ?? pipelineOf(e);
    n.processed++; n[p.bucket]++;
    if (p.reviewStatus === 'stale') n.stale++;
    if (p.reviewStatus === 'needs_review') n.needsReview++;
    if (p.reviewStatus === 'awaiting_primary') n.awaitingPrimary++;
    if (p.status === 'CARD') { n.cards++; if (e.materiality === 'HIGH' || e.materiality === 'MEDIUM') n.material++; if ((e.expectationGap === 'POSITIVE' || e.expectationGap === 'LARGE_POSITIVE') && e.consensus.value != null) n.expectationPositive++; }
    else if (p.status === 'AUDIT') n.audit++; else if (p.status === 'QUEUE') n.queue++; else n.dropped++;
  }
  return n;
}
/** Split built items: main cards (verified formal upgrades), audit rows (verified reiteration / mixed / lowered), the review queue, and dropped items. */
export function partitionPipeline(events: readonly GuidanceEvent[]): { cards: GuidanceEvent[]; audit: GuidanceEvent[]; queue: GuReviewItem[]; queueEvents: GuidanceEvent[]; dropped: GuidanceEvent[]; counts: GuPipelineCounts } {
  const cards: GuidanceEvent[] = []; const audit: GuidanceEvent[] = []; const queueEvents: GuidanceEvent[] = []; const dropped: GuidanceEvent[] = [];
  for (const e of events) {
    const st = (e.pipeline ?? pipelineOf(e)).status;
    (st === 'CARD' ? cards : st === 'AUDIT' ? audit : st === 'QUEUE' ? queueEvents : dropped).push(e);
  }
  return { cards, audit, queue: [...queueEvents, ...dropped].map(reviewItemOf), queueEvents, dropped, counts: pipelineCounts(events) };
}
/** Decision that follows the pipeline: REJECT only for lowered / invalid / stale / capital raise; queued items get no decision. */
function pipelineDecision(e: GuidanceEvent, base: { decision: GuDecision; reasons: string[] }): { decision: GuDecision; reasons: string[] } {
  const p = e.pipeline; if (!p) return base;
  const verified = e.verification === 'VERIFIED';
  if (p.bucket === 'capitalRaise' || p.bucket === 'invalidOrStale')
    return { decision: verified ? 'REJECT' : 'UNVERIFIED', reasons: [`${verified ? 'Result: REJECT' : 'No decision (not verified)'} — ${p.reason}`] };
  if (p.status === 'QUEUE' || p.status === 'DROPPED') return { decision: 'UNVERIFIED', reasons: [...(verified ? [] : ['No primary source — no final decision']), `No decision — ${p.reason}`, ...base.reasons.filter(r => !/^Result:|^No primary source|^No decision/.test(r))] };
  if (p.bucket === 'mixed' && base.decision !== 'REJECT') return { decision: 'WATCHLIST', reasons: [...base.reasons.filter(r => !/^Result:/.test(r)), `Result: WATCHLIST — ${p.reason}; not a clean upgrade, tracked only`] };
  return base;
}
/** zzz854: same figures under two periods across separate events of one company and day -> both invalid. Pure; returns new objects for the affected events only. */
export function applyCrossEventChecks(events: GuidanceEvent[]): GuidanceEvent[] {
  const dup = duplicatesAcrossEvents(events.map(e => ({ id: e.guidance_event_id, ticker: e.ticker || e.company, date: e.announcement_date, changes: [...e.changes, ...(e.rejectedChanges ?? [])] })));
  if (!dup.size) return events;
  return events.map(e => {
    const iss = dup.get(e.guidance_event_id); if (!iss) return e;
    const validationIssues = [...(e.validationIssues ?? []), iss];
    const pipeline: GuPipeline = { status: 'QUEUE', bucket: 'invalidOrStale', reviewStatus: 'invalid', reason: iss.text };
    const x = { ...e, validationIssues, pipeline, evidenceGaps: [iss.text, ...e.evidenceGaps.filter(g => g !== iss.text)], flags: e.flags.filter(f => f !== 'REPEATED_UPGRADER') };
    const d = pipelineDecision(x, { decision: x.decision, reasons: x.decisionReason });
    return withClassification({ ...x, decision: d.decision, decisionReason: d.reasons });
  });
}

/** Re-stamp classification fields after something changed the event (verification, sources). Pure. */
export function withClassification<T extends GuidanceEvent>(e: T): T {
  // zzz854: a changed verification / source re-derives the pipeline (only when the event already carries one) and the single primary-source state
  const ps = withPrimarySourceState(e);
  const old = ps.pipeline;
  const KEEP: GuPipeline['bucket'][] = ['capitalRaise', 'nonGuidance', 'firstGuidance', 'invalidOrStale'];   // properties of the text / numbers, not of verification
  const pl = !old ? undefined : KEEP.includes(old.bucket) ? old : pipelineOf(ps);
  let e2: T = pl ? { ...ps, pipeline: pl } : ps;
  if (old && pl && pl.status !== old.status) {   // e.g. a primary document was read since: the decision follows the new state
    const d = pipelineDecision(e2, decide(e2));
    e2 = { ...e2, decision: d.decision, decisionReason: d.reasons };
  }
  const k = classifyEvent(e2);
  return { ...e2, classification: k.classification, displayLabel: k.displayLabel, auditOnly: k.auditOnly, auditNote: k.auditNote, isUpgrade: k.isUpgrade };
}

/** Dates: the company's announcement date is the event date; the media date is kept apart. Returns undefined when no media source is involved. */
export function mediaDateOf(cands: readonly GuCandidate[]): string | undefined {
  const media = cands.filter(c => !(c.kind && PRIMARY_KINDS.has(c.kind)) && sourceTier(c.sourceName, c.kind, c.url) !== 'PRIMARY').map(c => isoDate(c.publishedAt)).filter(Boolean).sort();
  return media[0];
}
export function dateBasisOf(cands: readonly GuCandidate[]): 'ANNOUNCEMENT' | 'MEDIA' {
  return cands.some(c => !!c.eventDate || (c.kind && PRIMARY_KINDS.has(c.kind)) || sourceTier(c.sourceName, c.kind, c.url) === 'PRIMARY') ? 'ANNOUNCEMENT' : 'MEDIA';
}

const claimsOfCandidate = (c: GuCandidate): GuSourceClaim[] => {
  const out: GuSourceClaim[] = []; const seen = new Set<string>();
  for (const ch of extractGuidance(`${c.title}. ${c.text}`)) {
    const k = `${ch.metric}|${ch.after.period}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ metric: ch.metric, period: ch.after.period, display: fmtPoint(ch.after), low: ch.after.low, high: ch.after.high, before: ch.before ? fmtPoint(ch.before) : null });
  }
  return out;
};
const sameClaimValue = (a: GuSourceClaim, b: GuSourceClaim): boolean => {
  if (a.low == null || a.high == null || b.low == null || b.high == null) return true;   // an unreadable value is never a conflict
  const tol = (x: number, y: number) => 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  return Math.abs(a.low - b.low) <= tol(a.low, b.low) && Math.abs(a.high - b.high) <= tol(a.high, b.high);
};
/** Attach each source's OWN numbers to it and report a conflict when a primary source and another source state different values for the same measure and period. Both are kept; nothing is averaged. */
export function attachClaims(sources: GuSourceRef[], cands: readonly GuCandidate[]): { sources: GuSourceRef[]; conflict: GuSourceConflict | null } {
  const keyOf = (c: GuCandidate) => (c.url ?? '') || `${c.sourceName}|${isoDate(c.publishedAt)}`;
  const byKey = new Map<string, GuSourceClaim[]>();
  for (const c of cands) { const k = keyOf(c); const cl = claimsOfCandidate(c); if (cl.length) byKey.set(k, [...(byKey.get(k) ?? []), ...cl]); }
  const out = sources.map(sr => { const k = (sr.url ?? '') || `${sr.name}|${sr.date}`; const cl = byKey.get(k); return cl ? { ...sr, claims: cl } : sr; });
  let conflict: GuSourceConflict | null = null;
  const prim = out.filter(sr => sr.tier === 'PRIMARY' && sr.claims?.length); const other = out.filter(sr => sr.tier !== 'PRIMARY' && sr.claims?.length);
  outer: for (const p of prim) for (const pc of p.claims!) for (const o of other) for (const oc of o.claims!) {
    if (pc.metric !== oc.metric || pc.period !== oc.period || sameClaimValue(pc, oc)) continue;
    conflict = { metric: pc.metric, period: pc.period, primary: pc.display, media: oc.display, primarySource: p.name, mediaSource: o.name, text: `Primary source: ${pc.display}; Media claim: ${oc.display}` };
    break outer;
  }
  return { sources: out, conflict };
}

// the company's own sentence explaining the change (text only; never invented)
const DRIVER_CUE = /\b(?:driven by|due to|because of|reflecting|reflects|on account of|thanks to|owing to|led by|supported by|attributable to|as a result of|helped by|on the back of|boosted by|benefit(?:ing)? from|backed by|fuell?ed by|underpinned by|visibility)\b/i;
const DRIVER_TERM = /\b(?:demand|orders?|order (?:book|inflows?|intake|pipeline)|backlog|capacity|customers?|pricing|prices?|price (?:hikes?|increases?)|acquisitions?|acquired|volumes?|mix|utili[sz]ation|ramp[- ]?up|new (?:plant|line|facility|products?|contracts?)|realisations?|realizations?)\b/i;
export const DRIVER_NOT_STATED = 'Driver not stated';
export function extractDriverSentence(text: string): string | null {
  for (const raw of splitSentences(text ?? '')) {
    const sn = raw.replace(/\s+/g, ' ').trim();
    if (sn.length < 25 || sn.length > 400) continue;
    if (!DRIVER_CUE.test(sn) || !DRIVER_TERM.test(sn)) continue;
    ANALYST_RE.lastIndex = 0; const analyst = ANALYST_RE.test(sn); ANALYST_RE.lastIndex = 0;
    if (analyst && !COMPANY_CUE.test(sn)) continue;
    return sn.length > 260 ? `${sn.slice(0, 257)}...` : sn;
  }
  return null;
}


export const PRIMARY_STATE_TEXT: Record<GuPrimaryState, string> = {
  PRIMARY_SOURCE_READ: 'PRIMARY SOURCE READ',
  PRIMARY_SOURCE_FOUND: 'PRIMARY SOURCE FOUND',
  AWAITING_PRIMARY_SOURCE: 'Awaiting primary source',
  SECONDARY_SOURCE_CLAIM: 'SECONDARY-SOURCE CLAIM',
};
export const PRIMARY_NOT_FOUND_TEXT = 'Primary source: not found in the filings read so far';
/** 'Awaiting primary source' only when no primary link is known; a known link is PRIMARY SOURCE FOUND (read -> PRIMARY SOURCE READ). */
export function primaryStateFor(o: { url?: string | null; read?: boolean; searched?: boolean }): { state: GuPrimaryState; text: string } {
  const state: GuPrimaryState = o.read ? 'PRIMARY_SOURCE_READ' : o.url ? 'PRIMARY_SOURCE_FOUND' : o.searched ? 'SECONDARY_SOURCE_CLAIM' : 'AWAITING_PRIMARY_SOURCE';
  return { state, text: PRIMARY_STATE_TEXT[state] };
}

export function buildGuidanceEvent(input: GuCandidate[] | GuSkeleton, ctx: GuContext, now: Date): GuidanceEvent {
  const sk: GuSkeleton = Array.isArray(input) ? (() => { const g = buildGroups(input, true); if (!g.length) throw new Error('No usable candidates (need a ticker or company and a date)'); return skeletonOf(g[0]); })() : input;
  ctx = ctx ?? {};
  const text = sk.text;
  const unitCheck = validateChangeUnits(applyPrior(sk.changes, ctx.priorGuidance));
  const unitWarnings = [...unitCheck.warnings];
  // zzz854: validate every comparison (period, actual vs guidance, range, staleness, per-share). INVALID comparisons are removed here;
  // REVIEW ones stay visible but send the item to the review queue (never verified).
  const vIssues = validateChanges(unitCheck.kept, { announcementDate: sk.announcement_date, market: sk.market });
  const invalidFor = (c: GuChange) => vIssues.some(i => i.severity === 'INVALID' && i.metric === c.metric && i.period === c.after.period);
  const valid = unitCheck.kept.filter(c => !invalidFor(c));
  const rejectedChanges = unitCheck.kept.filter(c => invalidFor(c));
  // zzz854: never mix bases. Adjusted is the headline when both are given; the GAAP line is kept apart (otherChanges) with a note.
  const bs = splitByBasis(valid);
  const allChanges = bs.headline;
  let changes = allChanges;
  const ups = changes.filter(c => c.direction === 'UP' && c.before);
  if (ups.length) changes = ups;
  const otherChanges = [...allChanges.filter(c => !changes.includes(c) && !!c.before && c.direction !== 'UNKNOWN'), ...bs.secondary];
  const ver = verificationOf(sk.sources);
  const driver = classifyDriver(text);
  const duration0 = classifyDuration(text, changes, driver);
  const why = researchWhyNow(text, driver);
  const dur2 = assessDurability(text, changes, driver, duration0, why);
  const duration: GuDuration = duration0 === 'UNKNOWN' ? DUR_FROM_LEVEL[dur2.level] : duration0;
  const ranges: GuRangeMath[] = changes.map(c => {
    const r = computeRangeMath(c.before, c.after);
    if (c.before && basisMismatch(text, c)) {
      unitWarnings.push(`Basis mismatch: ${METRIC_LABEL[c.metric]} before and after are on different bases (adjusted versus GAAP). They are not compared as a clean upgrade.`);
      return { ...r, klass: 'UNKNOWN' as GuRangeClass };
    }
    return r;
  });
  const type = classifyType(changes);
  const mat = materiality(changes);
  const impacts = computeImpacts(ups.length ? [...changes, ...allChanges.filter(c => !changes.includes(c) && c.metric === 'OP_MARGIN')] : changes, ctx); // a stated margin is kept for the labelled estimate
  const valuation = computeValuation(ctx, changes);

  // consensus + gap (same metric, same period or unstated, compatible unit)
  let consensus: GuNumber = na();
  let gap: GuGap = 'UNKNOWN'; let gapPct: number | null = null;
  const evidenceGaps: string[] = [];
  const cc = ctx.consensus;
  if (cc && isFinite(cc.value)) {
    consensus = { value: cc.value, unit: cc.unit, label: 'CONSENSUS', source: cc.source };
    const target = changes.find(c => c.metric === cc.metric && (cc.period === 'UNSTATED' || c.after.period === 'UNSTATED' || c.after.period === cc.period));
    if (target && target.after.midpoint != null) {
      const gu = unitOf(target.after).replace(/\s+/g, '').toLowerCase(); const cu = (cc.unit ?? '').replace(/\s+/g, '').toLowerCase();
      const ratio = cc.value !== 0 ? target.after.midpoint / cc.value : Infinity;
      const compatible = cu ? cu === gu : (ratio >= 0.2 && ratio <= 5);
      if (compatible) {
        const g = computeGap(target.after.midpoint, cc.value);
        if (consensusLooksMismatched(g.gapPct)) {
          // zzz854: a 'gap' beyond +/-25% is a metric or basis mismatch (an FFO or adjusted guide against a GAAP estimate), never an expectation gap
          const t = `Consensus ${fmtNum(cc.value)} differs from the guided ${METRIC_LABEL[target.metric]} midpoint by ${signed(g.gapPct as number, 1)}% — it likely measures a different metric or basis, so the expectation gap is ${DATA_UNAVAILABLE}`;
          evidenceGaps.push(t); vIssues.push({ code: 'CONSENSUS_METRIC_MISMATCH', severity: 'INFO', metric: target.metric, period: target.after.period, text: t });
        } else { gap = g.gap; gapPct = g.gapPct; }
      } else evidenceGaps.push('Consensus unit differs from guidance unit, so the gap was not calculated');
    } else evidenceGaps.push('Consensus given is for a different measure or period, so the gap was not calculated');
  }
  if (gap === 'UNKNOWN' && !evidenceGaps.some(g => /gap/.test(g))) evidenceGaps.push(`Consensus: ${DATA_UNAVAILABLE}`);
  if (!ver.primaryAvailable) evidenceGaps.push(ver.note ?? 'Primary source not found yet');
  const evClass = eventClassOf(changes, ranges);
  if (!ups.length && evClass === 'DETECTED') evidenceGaps.push('Previous guidance not found, so this cannot be called a measured upgrade');
  if (driver.quality === 'UNKNOWN') evidenceGaps.push('Driver not stated in the source');
  if (duration === 'UNKNOWN') evidenceGaps.push('How long the driver lasts is not stated');
  if (valuation.currentPE.value == null) evidenceGaps.push(`P/E: ${DATA_UNAVAILABLE}`);
  if (impacts.ebitdaImpact.value == null) evidenceGaps.push(`EBITDA effect: ${DATA_UNAVAILABLE}`);
  if (impacts.epsImpact.value == null) evidenceGaps.push(`EPS effect: ${DATA_UNAVAILABLE}`);
  for (const i of vIssues) if (i.severity !== 'INFO' && !evidenceGaps.includes(i.text)) evidenceGaps.unshift(i.text);
  if (bs.note) evidenceGaps.push(bs.note);

  const currentRows = sk.history.length ? sk.history : rowsFromChanges(changes, sk.announcement_date);
  const hist = buildHistory(ctx.ledger ?? [], currentRows);
  const thesisBreaking = statedDeterioration(text, hist.rows);
  const thesis = thesisLabel({ changes, driver, text });
  let flags = computeFlags({
    verified: ver.verification === 'VERIFIED', changes, history: hist.rows, historyStats: hist.stats, text, gap, materiality: mat.level,
    bottleneckThemes: ctx.bottleneckThemes, structuralAlignment: ctx.structuralAlignment, secondUpgrade: sk.flags.includes('SECOND_UPGRADE_IN_WINDOW'),
    announcementDate: sk.announcement_date,
  });
  // SMALL_MID_CAP_INFLECTION: needs a stated small/mid market cap, HIGH materiality, and multi-metric or a >=25% raise
  const smallMid = isSmallMidCap(sk.market, ctx.priceContext?.marketCap) === true && mat.level === 'HIGH' && ups.length > 0
    && (new Set(ups.map(familyOf)).size >= 2 || ups.some(c => (pctOfChange(c) ?? 0) >= 25));
  if (changes.some(c => c.direction === 'UP' && c.before) && !ranges.some((r, i) => changes[i].direction === 'UP' && !!changes[i].before && REAL_RAISE.has(r.klass)))
    flags = flags.filter(f => f !== 'REPEATED_UPGRADER' && f !== 'GUIDANCE_PLUS_GAP'); // a narrowed / non-clean range is not a repeated upgrade
  if (smallMid) flags = [...flags, 'SMALL_MID_CAP_INFLECTION'];
  const evidence: GuEvidence = ups.length ? (ver.primaryAvailable ? 'DIRECT' : 'INDIRECT') : (ver.primaryAvailable ? 'INCOMPLETE' : 'UNPROVEN');
  const nowIso = now.toISOString();
  const links = {
    newsIds: ctx.newsIds, bottleneckThemes: ctx.bottleneckThemes, structuralAlignment: ctx.structuralAlignment?.trim() || undefined,
    inBook: ctx.inBook, bookThesisLabel: ctx.bookThesis,
    portfolioImpact: portfolioImpact({ inBook: !!ctx.inBook, bookThesis: ctx.bookThesis, verification: ver.verification, quality: driver.quality, gap, mat: mat.level, thesisBreaking }),
  };
  const base: GuidanceEvent = {
    guidance_event_id: sk.guidance_event_id, canonical_key: sk.canonical_key, ticker: sk.ticker, company: sk.company, market: sk.market,
    announcement_date: sk.announcement_date, announcement_timestamp: sk.announcement_timestamp,
    verification: ver.verification, primaryAvailable: ver.primaryAvailable, sources: sk.sources, changes, type,
    guidance_quality: driver.quality, guidance_driver: driver.driver, driverEvidence: driver.evidence,
    history: hist.rows, historyStats: hist.stats, consensus, expectationGap: gap, gapPct,
    revenueImpact: impacts.revenueImpact, ebitdaImpact: impacts.ebitdaImpact, epsImpact: impacts.epsImpact, fcfImpact: impacts.fcfImpact,
    valuation, duration, thesis, materiality: mat.level, materialityBasis: mat.basis + (bs.note ? ` ${bs.note}` : ''), evidence, links,
    risks: [], evidenceGaps, nextEvidence: [], whyNow: '', whatItMeans: '', marketMissing: '',
    chain: { event: '', evidence: '', driver: '', earnings: '', gap: '', valuation: '', durability: '', risk: '', action: '' },
    decision: 'UNVERIFIED', decisionReason: [], flags, rankKey: 0, created_at: nowIso, updated_at: nowIso,
    otherChanges, headlineBasis: bs.basis, basisNote: bs.note, validationIssues: vIssues, rejectedChanges,
  };
  base.v2 = {
    stage: ver.primaryAvailable ? (ups.length ? 'CALCULATED' : 'PRIMARY_SOURCE_FOUND') : 'CANDIDATE',
    ranges, metricBasis: basisOfEvent(changes, text),
    // zzz854: the WHY NOW text is always specific (the stated driver, or the dated 'driver not stated in <document>' line), so it is always shown
    operatingVariable: why.variable, durabilityLevel: dur2.level, durabilityWhy: dur2.why, whyNowResolved: true,
    scorecard: [], smallMidCapInflection: smallMid, detectedVia: detectedViaOf(sk.candidates),
    consensusAvailable: consensus.value != null, unitWarnings, eventClass: evClass, eventLabel: EVENT_CLASS_LABEL[evClass],
  };
  if (!ups.length && evClass === 'DETECTED' && (sk.extracted ? sk.extracted.raisedNoPrior : sk.candidates.some(c => isGuidanceUpgradeCandidate(c).include))) {
    base.v2.statedDirection = 'RAISED';
    const names: string[] = [];
    for (const sn of splitSentences(text)) if (managementRaise(sn)) for (const k of findMetricKws(sn)) { const l = METRIC_LABEL[k.metric]; if (k.metric !== 'OTHER' && !names.includes(l)) names.push(l); }
    if (names.length) base.v2.statedMetrics = names;
  }
  if (driver.quality === 'UNKNOWN' && why.variable) base.guidance_driver = `Stated operating drivers: ${why.variable}`;
  if (unitWarnings.length) for (const w of unitWarnings) if (!base.evidenceGaps.includes(w)) base.evidenceGaps.push(w);
  // primary source (link + date) before the narrative, so WHY NOW can name the document and its date
  const prim0 = base.sources.find(x => x.tier === 'PRIMARY' && !!x.url) ?? base.sources.find(x => x.tier === 'PRIMARY');
  base.primarySourceUrl = prim0?.url ?? null; base.primarySourceDate = prim0?.date ?? null;
  // zzz854: taxonomy + pipeline (where this item goes, and why)
  const titles = sk.candidates.map(c => c.title).join('. ');
  const body = sk.candidates.map(c => c.text).filter(Boolean).join('\n');
  base.taxonomy = taxonomyOf({ title: titles, text, body, candidates: sk.extracted ? [] : sk.candidates, changes, otherChanges, ranges, evClass, statedRaised: base.v2.statedDirection === 'RAISED' });
  base.pipeline = pipelineOf(base, body);
  if (base.pipeline.status !== 'CARD') {
    // a thesis label or an upgrade flag on something that is not a verified formal upgrade is misleading (e.g. 'A Operating Inflection' on a queued claim)
    base.flags = base.flags.filter(f => f !== 'REPEATED_UPGRADER' && f !== 'GUIDANCE_PLUS_GAP' && f !== 'SMALL_MID_CAP_INFLECTION');
    if (base.pipeline.status !== 'AUDIT') base.thesis = null;
  }
  base.risks = buildRisks(base, { text, kinds: driver.kinds });
  base.nextEvidence = buildNextEvidence(base);
  base.whyNow = buildWhyNow(base);
  base.whatItMeans = whatItMeans(base);
  base.marketMissing = marketMissing(base);
  const d = pipelineDecision(base, decide(base, ctx, { thesisBreaking }));
  base.decision = d.decision; base.decisionReason = d.reasons;
  base.v2.scorecard = buildScorecard(base, ranges, dur2.level, dur2.why);
  base.v2.stage = d.decision === 'UNVERIFIED' ? 'CANDIDATE' : (ups.length && mat.level !== 'UNKNOWN') ? 'DECISION' : ups.length ? 'VERIFIED' : 'PRIMARY_SOURCE_FOUND';
  base.chain = chain(base);
  base.rankKey = rankKeyOf(base);
  // zzz853: each source's own numbers, a conflict when sources disagree, the media date kept apart from the company's date, the company's own driver sentence, and the classification
  const cl = attachClaims(base.sources, sk.candidates);
  base.sources = cl.sources; base.sourceConflict = cl.conflict;
  if (cl.conflict) base.evidenceGaps = [`Source conflict: ${cl.conflict.text}`, ...base.evidenceGaps];
  // zzz853: a quarter written without a fiscal year (or no period at all) cannot be placed on a calendar; say so, never guess the year
  if (base.changes.some(c => c.after.period === 'UNSTATED') && !base.evidenceGaps.some(g => /period unclear/i.test(g))) base.evidenceGaps = ['Guided period unclear: the source gives no fiscal year for the guided figure (a quarter without a year is not placed on a calendar)', ...base.evidenceGaps];
  if (base.changes.some(c => c.after.periodKind === 'MULTI_YEAR_CAGR') && !base.evidenceGaps.some(g => /multi-year/i.test(g))) base.evidenceGaps = ['Multi-year growth target (a CAGR over several years), not a single-year guidance figure', ...base.evidenceGaps];
  base.media_date = mediaDateOf(sk.candidates); base.dateBasis = dateBasisOf(sk.candidates);
  const drv = extractDriverSentence(text);
  base.whyNowDriver = drv ?? DRIVER_NOT_STATED;
  return withClassification(base);
}

/** zzz849: numbers the persistent guidance universe holds for the same company, offered to an event that has none of its own. */
export interface GuExtra { cand: GuCandidate; numbersFrom: NonNullable<GuEventV2['numbersFrom']> }
export type GuExtraFor = (sk: GuSkeleton) => GuExtra[];
/**
 * Build one event. When the skeleton has NO before-and-after numbers and `extraFor` offers source-backed ones (universe record), the event is rebuilt
 * from the same candidates PLUS the record's own statement, as ONE event (earliest date = the announcement). The provenance is stamped on the event:
 * `v2.numbersFrom` carries the record's own verification tier, the sources list names the record's source, and a media-only record never becomes VERIFIED.
 */
export function buildWithExtras(sk: GuSkeleton, ctx: GuContext, now: Date, extraFor?: GuExtraFor): GuidanceEvent {
  if (!extraFor || eventClassOf(sk.changes) !== 'DETECTED') return buildGuidanceEvent(sk, ctx, now);
  let extras: GuExtra[] = [];
  try { extras = extraFor(sk) || []; } catch { extras = []; }
  if (!extras.length) return buildGuidanceEvent(sk, ctx, now);
  const ev = buildGuidanceEvent([...sk.candidates, ...extras.map(x => x.cand)], ctx, now);
  if (eventClassOf(ev.changes, ev.v2?.ranges) === 'DETECTED' || !ev.v2) return buildGuidanceEvent(sk, ctx, now);   // the record added no readable numbers: leave the event as it was
  const nf = extras[0].numbersFrom;
  ev.v2.numbersFrom = nf;
  ev.v2.detectedVia = ev.v2.detectedVia.includes('guidance universe record') ? ev.v2.detectedVia : [...ev.v2.detectedVia, 'guidance universe record'];
  ev.evidenceGaps = [nf.note, ...ev.evidenceGaps.filter(g => !/^Previous guidance not found/.test(g))];
  if (!ev.primaryAvailable) ev.nextEvidence = ['Open the company\'s own filing or presentation and confirm these figures', ...ev.nextEvidence].slice(0, 3);
  return ev;
}

export function processCandidates(cands: GuCandidate[], ctxFor: (ticker: string) => GuContext, now: Date, window: GuWindow = '7D', extraFor?: GuExtraFor): GuidanceEvent[] {
  const kept = cands.filter(c => withinWindow(c.eventDate || c.publishedAt, window, now) && isGuidanceUpgradeCandidate(c).include);   // zzz853: the company's announcement date, never a republish date
  const events = mergeCandidates(kept).map(sk => buildWithExtras(sk, ctxFor(sk.ticker) ?? {}, now, extraFor));
  // zzz854: every built item is returned, stamped with `pipeline` (CARD / AUDIT / QUEUE / DROPPED). Use partitionPipeline() to split cards from the review queue.
  return rank(applyCrossEventChecks(events));
}

// ── zzz857: AI-extracted, quote-checked rows from the company's OWN documents as PRIMARY candidates ────────────────────────────────────
// One skeleton per document. Each row becomes a change on the engine's own types and goes through buildGuidanceEvent (unit, period, stale,
// basis, implausible-change validators; taxonomy; pipeline). Nothing is bypassed:
//   RAISED / LOWERED / NARROWED with the document's own stated prior -> before = prior, after = new (formal_upgrade / downgrade / mixed by the numbers)
//   NEW -> no before: taxonomy first_guidance (review queue + universe only, never an upgrade card)
//   REITERATED -> before = after (the document says unchanged): reiteration (audit row)
//   WITHDRAWN / UNCLEAR rows are not events. A RAISED row without a stated prior has no before: it waits for numbers (never a card).
/** Structural copy of GuidanceExtractResult (lib/guidance-docs-types.ts): the engine imports only its own types file and the validators. */
export interface GuidanceExtractResult {
  docId: string; market: 'IN' | 'US'; ticker: string | null; company: string; docUrl: string; docKind: string; filedAt: string; extractedAt?: string; status: string;
  rows: Array<{ metric: string; period: string; periodKind: 'ANNUAL' | 'QUARTER' | 'MULTI_YEAR'; basis: string; currency: string | null; unit: string | null; low: number | null; high: number | null;
    status: string; prior?: { low: number | null; high: number | null; statedIn: string | null } | null; quote: string }>;
}
const X_EV_METRIC: Record<string, GuMetric> = { REVENUE: 'REVENUE', REVENUE_GROWTH: 'REVENUE_GROWTH', EBITDA: 'EBITDA', EBITDA_MARGIN: 'OP_MARGIN', PAT: 'NET_PROFIT', EPS: 'EPS', ADJ_EPS: 'ADJ_EPS', FCF: 'FCF', ORDER_INFLOW: 'ORDER_INTAKE', VOLUME: 'VOLUME', OTHER: 'OTHER' };
const X_EV_DOC: Record<string, { name: string; kind: GuCandidate['kind']; type: string }> = {
  TRANSCRIPT: { name: 'Earnings call transcript', kind: 'TRANSCRIPT', type: 'Transcript' }, PRESENTATION: { name: 'Investor presentation', kind: 'DECK', type: 'Investor deck' },
  RESULTS_RELEASE: { name: 'Results press release', kind: 'RELEASE', type: 'Earnings release' }, AGM_SPEECH: { name: 'AGM / chairman speech', kind: 'FILING', type: 'Company filing' },
  OTHER_COMPANY_DOC: { name: 'Company document', kind: 'FILING', type: 'Company filing' },
};
export const EXTRACTED_VIA = 'company document (AI-read, quote-checked)';
/** 'FY2027' -> 'FY27', 'Q3 FY2027' -> 'Q3 FY27', 'FY27-FY29' -> 'FY27-29'; '' when nothing usable. */
export function extractedPeriod(p: string): string {
  let s = String(p || '').trim().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  s = s.replace(/^(FY|CY)\s?(\d{2,4})\s*-\s*(?:FY|CY)?\s?(\d{2,4})$/i, (_m, a: string, x: string, y: string) => `${a.toUpperCase()}${x.slice(-2)}-${y.slice(-2)}`);
  s = s.replace(/^(FY|CY)\s?(\d{2,4})$/i, (_m, a: string, y: string) => `${a.toUpperCase()}${y.slice(-2)}`);
  s = s.replace(/^(Q[1-4]|H[12])\s?(FY|CY)\s?(\d{2,4})$/i, (_m, q: string, a: string, y: string) => `${q.toUpperCase()} ${a.toUpperCase()}${y.slice(-2)}`);
  // zzz880 — "FY26-27" is the single Indian fiscal year 2026-27 (FY27), not a span
  const one = /^FY(\d{2})-(\d{2})$/.exec(s);
  if (one && (parseInt(one[1], 10) + 1) % 100 === parseInt(one[2], 10)) s = `FY${one[2]}`;
  return s;
}
function extractedPoint(row: GuidanceExtractResult['rows'][number], metric: GuMetric, period: string, lo: number | null, hi: number | null): GuGuidancePoint | null {
  if (lo == null && hi == null) return null;
  const l = (lo ?? hi) as number, h = (hi ?? lo) as number;
  const rate = row.unit === '%' || metric === 'REVENUE_GROWTH' || metric === 'OP_MARGIN';
  const u = String(row.unit || '').toLowerCase(); const cur = String(row.currency || '').toUpperCase();
  const currency = rate ? undefined : cur === 'INR' ? '₹' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : undefined;
  const unit = rate ? '%' : u === 'crore' || u === 'crores' ? 'Cr' : u === 'million' ? 'M' : u === 'billion' ? 'B' : u === 'thousand' ? 'K' : u === 'per_share' ? '' : u === 'lakh crore' ? 'L Cr' : '';
  const basis: GuGuidancePoint['basis'] = row.basis === 'ADJUSTED' ? 'NON_GAAP' : row.basis === 'GAAP' ? 'GAAP' : row.basis === 'REPORTED' ? 'REPORTED' : 'UNSTATED';
  const multi = row.periodKind === 'MULTI_YEAR' && rate && /^(FY|CY)\d{2}-\d{2}$/.test(period);
  const ys = multi ? /^(?:FY|CY)(\d{2})-(\d{2})$/.exec(period) : null;
  return { metric, period, low: Math.min(l, h), high: Math.max(l, h), midpoint: round((l + h) / 2, 6), isGrowthRate: rate, currency, unit, basis, raw: String(row.quote || '').slice(0, 300), valueKind: 'GUIDANCE',
    ...(multi ? { periodKind: 'MULTI_YEAR_CAGR' as const, ...(ys ? { periodYears: parseInt(ys[2], 10) - parseInt(ys[1], 10) + 1 } : {}) } : {}) };
}
/** One skeleton per extract result that has at least one usable row. Pure. */
export function skeletonsFromExtracted(results: readonly GuidanceExtractResult[]): GuSkeleton[] {
  const out: GuSkeleton[] = [];
  for (const r of results || []) {
    if (!r || r.status !== 'ok' || !Array.isArray(r.rows) || (r.market !== 'IN' && r.market !== 'US')) continue;
    const date = isoDate(r.filedAt); if (!date) continue;
    const ticker = (r.ticker || '').trim().toUpperCase().replace(/\.(NS|BO)$/, '') || (r.company || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    if (!ticker) continue;
    const changes: GuChange[] = []; let raisedNoPrior = false; const metrics: string[] = [];
    for (const row of r.rows) {
      if (!row || row.status === 'WITHDRAWN' || row.status === 'UNCLEAR') continue;
      const metric = X_EV_METRIC[row.metric]; if (!metric) continue;
      const period = extractedPeriod(row.period) || 'UNSTATED';
      const after = extractedPoint(row, metric, period, row.low, row.high); if (!after) continue;
      let before: GuGuidancePoint | null = null;
      if (row.status === 'REITERATED') before = { ...after, raw: `${after.raw ?? ''} (reiterated: unchanged)` };
      else if ((row.status === 'RAISED' || row.status === 'LOWERED' || row.status === 'NARROWED') && row.prior && (row.prior.low != null || row.prior.high != null)) before = extractedPoint(row, metric, period, row.prior.low, row.prior.high);
      if (row.status === 'RAISED' && !before) raisedNoPrior = true;
      changes.push(makeChange(before, after));
      if (!metrics.includes(METRIC_LABEL[metric])) metrics.push(METRIC_LABEL[metric]);
    }
    if (!changes.length) continue;
    changes.sort((a, b) => METRIC_PRIORITY.indexOf(a.metric) - METRIC_PRIORITY.indexOf(b.metric));
    const dn = X_EV_DOC[r.docKind] || X_EV_DOC.OTHER_COMPANY_DOC;
    const sourceName = `${dn.name} (${r.company})`;
    const cand: GuCandidate = { id: `extract:${r.docId}`, ticker, company: r.company || ticker, market: r.market, title: `${r.company || ticker}: ${dn.name.toLowerCase()} (${date})`,
      text: r.rows.filter((x) => x && x.quote).map((x) => String(x.quote)).join('\n').slice(0, 3000), url: r.docUrl || undefined, sourceName, publishedAt: r.filedAt, eventDate: date, kind: dn.kind };
    const key = canonicalKey(ticker, changes[0].metric, changes[0].after.period, date);
    out.push({ canonical_key: key, guidance_event_id: stableId(key), ticker, company: r.company || ticker, market: r.market, announcement_date: date,
      sources: [{ url: r.docUrl || undefined, name: sourceName, tier: 'PRIMARY', type: dn.type, date }], candidates: [cand], changes, history: rowsFromChanges(changes, date), flags: [],
      text: `${cand.title}. ${cand.text}`, extracted: { docId: r.docId, raisedNoPrior, metrics } });
  }
  return out;
}
/** Build the extracted events through the SAME engine path (validators, taxonomy, pipeline, decision). Window is cut on the document date. */
/**
 * zzz880 — THE COMPANY'S OWN EARLIER DOCUMENTS ARE ITS PRIOR GUIDANCE.
 *
 * India showed 0 upgrades in 120 days: 1,196 of 1,345 company documents were "first guidance (not a raise)". The before-figure came only
 * from the ledger, and the ledger is written only for events already SHOWN — India had none, so no India document could ever be compared
 * with anything (a closed loop). US 8-Ks restate "raised from X to Y" in the same filing, which is why the US worked.
 * Now every document the AI has read is history: for each document, the same company's latest EARLIER document (strictly earlier day)
 * that guided the same metric for the same period is its before-figure. Pure; the ledger points are kept as a fallback.
 */
/** zzz880 — only clearly defined money / growth / margin metrics are compared across documents. */
const CROSS_DOC_METRICS = new Set<GuMetric>(['REVENUE', 'REVENUE_GROWTH', 'EBITDA', 'EBIT', 'OP_MARGIN', 'EPS', 'ADJ_EPS', 'NET_PROFIT', 'FCF', 'ORGANIC_GROWTH']);
export function priorPointsFromExtracted(sks: readonly GuSkeleton[]): (sk: GuSkeleton) => GuGuidancePoint[] {
  const byCo = new Map<string, Array<{ date: string; p: GuGuidancePoint; src: string }>>();
  for (const sk of sks) {
    const k = `${sk.market}|${sk.ticker}`;
    const list = byCo.get(k) || [];
    for (const c of sk.changes) {
      if (!c.after || c.after.valueKind === 'ACTUAL' || c.after.period === 'UNSTATED' || c.after.midpoint == null) continue;
      if (!CROSS_DOC_METRICS.has(c.after.metric)) continue;   // "other", volume, backlog …: two documents' figures are not the same quantity
      list.push({ date: sk.announcement_date, p: c.after, src: sk.sources[0]?.name || 'earlier company document' });
    }
    byCo.set(k, list);
  }
  for (const l of Array.from(byCo.values())) l.sort((a, b) => b.date.localeCompare(a.date));   // newest first: the most recent earlier guide wins
  return (sk) => {
    const seen = new Set<string>(); const out: GuGuidancePoint[] = [];
    for (const h of byCo.get(`${sk.market}|${sk.ticker}`) || []) {
      if (h.date >= sk.announcement_date) continue;
      const key = `${h.p.metric}|${h.p.period}|${h.p.isGrowthRate}|${h.p.periodKind || ''}|${h.p.unit || ''}|${h.p.currency || ''}`;
      if (seen.has(key)) continue; seen.add(key);
      out.push({ ...h.p, raw: `${h.p.raw ?? ''} (earlier guidance: ${h.src}, ${h.date})`.trim() });
    }
    return out;
  };
}

export function buildExtractedEvents(results: readonly GuidanceExtractResult[], ctxFor: (ticker: string, market: GuMarket) => GuContext, now: Date, window: GuWindow = '7D'): GuidanceEvent[] {
  const out: GuidanceEvent[] = [];
  const sks = skeletonsFromExtracted(results);
  const earlierOf = priorPointsFromExtracted(sks);
  const seenSig = new Set<string>();   // zzz880: two documents of the same day with the same figures (press release + presentation) are one event
  for (const sk0 of sks) {
    if (!withinWindow(sk0.announcement_date, window, now)) continue;
    const sk = dropPartFigures(sk0);
    const sig = `${sk.market}|${sk.ticker}|${sk.announcement_date}|${sk.changes.map((c) => `${c.metric}:${c.after.period}:${c.after.low}:${c.after.high}`).join(',')}`;
    if (seenSig.has(sig)) continue; seenSig.add(sig);
    let ev: GuidanceEvent;
    const base = ctxFor(sk.ticker, sk.market) ?? {};
    const earlier = earlierOf(sk);
    const ctx: GuContext = earlier.length ? { ...base, priorGuidance: [...earlier, ...(base.priorGuidance || [])] } : base;
    try { ev = buildGuidanceEvent(sk, ctx, now); } catch { continue; }
    if (ev.v2) ev.v2 = { ...ev.v2, detectedVia: Array.from(new Set([EXTRACTED_VIA, ...ev.v2.detectedVia])), verifiedBy: `${sk.sources[0].name}, ${sk.announcement_date} (${EXTRACTED_VIA})` };
    out.push(withPrimarySourceState({ ...ev, primaryState: 'PRIMARY_SOURCE_READ' }));
  }
  return out;
}
/** zzz881: one document gives "revenue ₹725–750 Cr" AND "₹150 Cr" (a new business) for the same year: the small one is a part of the
 *  company, not its guide (Cupid AGM highlights). A same-metric, same-period, same-unit amount under half of the largest one is dropped. */
export function dropPartFigures<T extends { changes: GuChange[] }>(sk: T): T {
  const key = (c: GuChange) => `${c.metric}|${c.after.period}|${c.after.unit ?? ''}|${c.after.currency ?? ''}`;
  const top = new Map<string, number>();
  for (const c of sk.changes) if (!c.after.isGrowthRate && c.after.low != null && c.after.low > 0) top.set(key(c), Math.max(top.get(key(c)) ?? 0, c.after.low));
  const keep = sk.changes.filter((c) => c.after.isGrowthRate || c.after.high == null || !(c.after.high < 0.5 * (top.get(key(c)) ?? 0)));
  return keep.length === sk.changes.length || !keep.length ? sk : { ...sk, changes: keep };
}
const evNameKey = (s: string) => String(s || '').toLowerCase().replace(/\b(limited|ltd|inc|corp|corporation|plc|co|company|india)\b/g, '').replace(/[^a-z0-9]+/g, '');
/** Days apart within which a news / regex event and a company-document event are the same announcement. */
export const EXTRACTED_SAME_EVENT_DAYS = 3;
/**
 * The company-document event replaces any text-derived event for the same company (market + ticker, or the same normalised name) within
 * EXTRACTED_SAME_EVENT_DAYS: it carries the document's own numbers and status. Pure; returns the merged list and the replaced ids.
 */
export function mergeExtractedEvents(base: readonly GuidanceEvent[], extracted: readonly GuidanceEvent[]): { events: GuidanceEvent[]; replaced: string[] } {
  if (!extracted.length) return { events: base.slice(), replaced: [] };
  const replaced = new Set<string>();
  const near = (a: string, b: string) => Math.abs(dayNum(isoDate(a)) - dayNum(isoDate(b))) <= EXTRACTED_SAME_EVENT_DAYS;
  for (const x of extracted) for (const e of base) {
    if (e.market !== x.market || replaced.has(e.guidance_event_id)) continue;
    const same = (!!e.ticker && e.ticker.toUpperCase() === x.ticker.toUpperCase()) || (!!evNameKey(e.company) && evNameKey(e.company) === evNameKey(x.company));
    if (same && near(e.announcement_date, x.announcement_date)) replaced.add(e.guidance_event_id);
  }
  const ids = new Set(extracted.map((x) => x.guidance_event_id));
  return { events: [...base.filter((e) => !replaced.has(e.guidance_event_id) && !ids.has(e.guidance_event_id)), ...extracted], replaced: Array.from(replaced) };
}

export function summarise(events: GuidanceEvent[], window: GuWindow, now: Date): GuSummary {
  const today = now.toISOString().slice(0, 10);
  // zzz854: when items carry a pipeline, the headline numbers come from the exact partition: detected = processed, verified = verified cards + audit rows,
  // material / expectation positive = verified formal upgrades only. Legacy events (no pipeline) keep the old rule.
  const piped = events.length > 0 && events.every(e => !!e.pipeline);
  const shown = (e: GuidanceEvent) => !piped || e.pipeline!.status === 'CARD' || e.pipeline!.status === 'AUDIT';
  const isVer = (e: GuidanceEvent) => e.verification === 'VERIFIED' && shown(e);
  const isMat = (e: GuidanceEvent) => (e.materiality === 'HIGH' || e.materiality === 'MEDIUM') && (!piped || e.pipeline!.status === 'CARD');
  const isPos = (e: GuidanceEvent) => (e.expectationGap === 'POSITIVE' || e.expectationGap === 'LARGE_POSITIVE') && (!piped || (e.pipeline!.status === 'CARD' && e.consensus.value != null));
  const bucket = (m: 'IN' | 'US') => {
    const es = events.filter(e => e.market === m);
    return { detected: es.length, verified: es.filter(isVer).length, material: es.filter(isMat).length, expectationPositive: es.filter(isPos).length };
  };
  const out: GuSummary = {
    window, asOf: now.toISOString(), detected: events.length,
    verified: events.filter(isVer).length,
    material: events.filter(isMat).length,
    expectationPositive: events.filter(isPos).length,
    inBook: events.filter(e => e.links.inBook === true).length,
    byMarket: { IN: bucket('IN'), US: bucket('US') },
    consensusAvailable: { have: events.filter(e => e.consensus.value != null).length, of: events.length },
    today: events.filter(e => isVer(e) && e.announcement_date === today).length,
  };
  if (piped) {
    out.pipeline = pipelineCounts(events);
    out.pipelineByMarket = { IN: pipelineCounts(events.filter(e => e.market !== 'US')), US: pipelineCounts(events.filter(e => e.market === 'US')) };
  }
  return out;
}
