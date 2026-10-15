// ═══════════════════════════════════════════════════════════════════════════
// zzz1056 — US TOP MOVERS · TOP LOSERS for the home page (pure logic, no I/O).
//
// The India home panel (app/(dashboard)/page.tsx, lib/movers-attribution.ts +
// lib/move-quality.ts) answers three things per mover: how much it moved, WHY
// (best evidence first, never invented), and how good the move looks (Q 0–100).
// This is the US mirror. The fetching lives in us-movers-server.ts; everything
// here is pure so it can be tested without the network.
//
//   1. the universe filter  — small & mid caps by default ($300M–$30B), price
//      ≥ $3, average traded value ≥ $5M a day (drops illiquid junk);
//   2. the session notice   — pre-market / live / after the close / closed day,
//      on the NYSE calendar (holidays + 13:00 early closes, us-gainers.ts);
//   3. the WHY, best first  — (a) graded earnings, (b) an SEC filing in the move
//      window, (c) a dated news headline about THIS company, (d) the sector
//      moving the same way, (e) an honest "no confirmed catalyst";
//   4. the quality score Q  — the India weights, with the US company figures
//      (revenue growth, margin, FCF, Rule of 40, accumulation grade) standing in
//      for NSE delivery %, which the US has no equivalent of;
//   5. sector breadth       — average move per sector, leaders / laggards.
//
// US tickers are kept market-qualified ('US:XYZ') wherever they meet a list
// that could also hold India names, so 'ABB' in India never marks 'ABB' in the
// US (or the other way round).
// ═══════════════════════════════════════════════════════════════════════════

import { etParts, isNyseTradingDay, prevNyseSession, closeMinutes, lastCompletedNyseSession, usPhaseAt, type UsPhase } from './ai-gainers/us-gainers';

// ── 1. UNIVERSE ────────────────────────────────────────────────────────────

export type UsMoversMode = 'smallmid' | 'all';

export const US_MOVERS_FILTER = {
  smallMid: { minMcapM: 300, maxMcapM: 30_000 },
  all: { minMcapM: 300, maxMcapM: null as number | null },
  minPrice: 3,
  minAvgDollarVolM: 5,
} as const;

/** One US name as the scanner (or the Stock Screener snapshot) gives it. Money in $ million. */
export interface UsQuoteRow {
  ticker: string;
  company: string;
  exchange: string;
  chg: number | null;         // today's % change
  price: number | null;
  mcapM: number | null;
  volume: number | null;      // today's shares
  avgVol: number | null;      // 30-day (or 10-day) average shares
  relVol: number | null;      // today ÷ average
  sector: string | null;
  hi52: number | null;
  perf1M: number | null;
  sma50: number | null;
}

export interface UsUniverseResult { kept: UsQuoteRow[]; dropped: { cap: number; price: number; liquidity: number; noMove: number } }

export const avgDollarVolM = (r: Pick<UsQuoteRow, 'avgVol' | 'price'>): number | null =>
  r.avgVol != null && r.price != null && Number.isFinite(r.avgVol) && Number.isFinite(r.price) ? (r.avgVol * r.price) / 1e6 : null;

/** Cap band + price floor + liquidity floor. A row with an unknown cap / price / average volume is dropped (not guessed). */
export function filterUsUniverse(rows: UsQuoteRow[], mode: UsMoversMode = 'smallmid'): UsUniverseResult {
  const band = mode === 'all' ? US_MOVERS_FILTER.all : US_MOVERS_FILTER.smallMid;
  const dropped = { cap: 0, price: 0, liquidity: 0, noMove: 0 };
  const kept: UsQuoteRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || !r.ticker || seen.has(r.ticker)) continue;
    if (r.chg == null || !Number.isFinite(r.chg)) { dropped.noMove++; continue; }
    if (r.mcapM == null || r.mcapM < band.minMcapM || (band.maxMcapM != null && r.mcapM > band.maxMcapM)) { dropped.cap++; continue; }
    if (r.price == null || r.price < US_MOVERS_FILTER.minPrice) { dropped.price++; continue; }
    const adv = avgDollarVolM(r);
    if (adv == null || adv < US_MOVERS_FILTER.minAvgDollarVolM) { dropped.liquidity++; continue; }
    seen.add(r.ticker);
    kept.push(r);
  }
  return { kept, dropped };
}

/** Top N up (move > 0, biggest first) and top N down (move < 0, biggest fall first). */
export function topMovers(rows: UsQuoteRow[], n = 20): { gainers: UsQuoteRow[]; losers: UsQuoteRow[] } {
  const up = rows.filter((r) => (r.chg ?? 0) > 0).sort((a, b) => (b.chg as number) - (a.chg as number)).slice(0, n);
  const dn = rows.filter((r) => (r.chg ?? 0) < 0).sort((a, b) => (a.chg as number) - (b.chg as number)).slice(0, n);
  return { gainers: up, losers: dn };
}

// ── 2. SESSION NOTICE ──────────────────────────────────────────────────────

export interface UsSessionNotice {
  phase: UsPhase;
  live: boolean;          // the moves change until the close
  session: string;        // the ET date whose moves are shown
  prevSession: string;    // the session before it (its after-hours news can explain this move)
  closeEt: string;        // '16:00' or '13:00' on early-close days
  text: string;
}

/** What the "change" column describes at `now`, in plain words (same rule as the US gainers board). */
export function usSessionNotice(now: Date = new Date()): UsSessionNotice {
  const e = etParts(now);
  const phase = usPhaseAt(now);
  const live = phase === 'regular';
  const session = live || (phase === 'after_hours' && isNyseTradingDay(e.ymd)) ? e.ymd : lastCompletedNyseSession(now);
  const cm = closeMinutes(e.ymd);
  const closeEt = `${String(Math.floor(cm / 60)).padStart(2, '0')}:${String(cm % 60).padStart(2, '0')}`;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${session}T12:00:00Z`).getUTCDay()];
  let text: string;
  if (live) text = `live · ${e.hhmm} ET · moves change until the ${closeEt} ET close`;
  else if (phase === 'pre_market') text = `🕒 Pre-market (${e.hhmm} ET) · showing LAST CLOSE (${dow} ${session}) · NYSE opens 09:30 ET`;
  else if (phase === 'after_hours') text = `🕒 After the close · showing today's completed session (${dow} ${session})`;
  else text = `🕒 US market closed (${isWeekendYmd(e.ymd) ? 'weekend' : 'holiday'}) · showing last close (${dow} ${session})`;
  return { phase, live, session, prevSession: prevNyseSession(session), closeEt, text };
}

const isWeekendYmd = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`).getUTCDay(); return d === 0 || d === 6; };

/** How long the server keeps one answer: 3 min while the session is live, 15 min otherwise. */
export const usMoversTtlMs = (phase: UsPhase): number => (phase === 'regular' ? 3 * 60_000 : 15 * 60_000);

// ── 3. THE WHY ─────────────────────────────────────────────────────────────

export type UsWhyKind = 'EARNINGS' | 'FILING' | 'DILUTION' | 'NEWS' | 'SECTOR' | 'NONE';
export type UsWhyConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface UsWhy {
  kind: UsWhyKind;
  text: string;
  confidence: UsWhyConfidence;
  source: string | null;      // 'graded results' | 'SEC EDGAR' | publisher | 'sector'
  url: string | null;
  date: string | null;        // YYYY-MM-DD (ET)
  /** what was looked at for this name — so "no confirmed catalyst" says what was checked */
  checked: string[];
}

/** A graded earnings row, as much of it as the WHY needs (graded-us UsGradedRow). */
export interface UsEarningsLite {
  ticker: string;
  filing_date: string;
  quarter: string | null;
  sales_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  eps_swing?: string | null;
  net_profit_yoy_pct?: number | null;
  tier: string | null;
}

export interface UsFilingLite { subject: string; url: string | null; dateIso: string | null }
export interface UsNewsLite { title: string; url: string; date: string; source: string | null }

export interface UsWhyInput {
  ticker: string;
  chg: number;
  session: string;
  prevSession: string;
  closeEt?: string;
  earnings?: UsEarningsLite | null;
  /** null = filings were NOT looked up for this name (budget); [] = looked up, nothing in the window */
  filings?: UsFilingLite[] | null;
  /** null = news was NOT looked up; [] = looked up, nothing about the company */
  news?: UsNewsLite[] | null;
  sector?: string | null;
  sectorMovePct?: number | null;
}

const pctTxt = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${Math.round(v)}%` : null);
const SWING_TXT: Record<string, string> = {
  'loss-to-profit': 'turned profitable', 'profit-to-loss': 'swung to a loss', 'loss-narrowed': 'loss narrowed', 'loss-widened': 'loss widened',
};

/** "rose on Q3 FY26 earnings · revenue +25% · EPS +40% · STRONG" */
export function earningsWhyText(e: UsEarningsLite, chg: number): string {
  const verb = chg > 0 ? 'rose on' : chg < 0 ? 'fell on' : 'reported';
  const rev = pctTxt(e.sales_yoy_pct);
  const eps = pctTxt(e.eps_yoy_pct) || (e.eps_swing ? SWING_TXT[e.eps_swing] || null : null);
  const parts = [`${verb} ${e.quarter ? `${e.quarter} ` : ''}earnings`];
  if (rev) parts.push(`revenue ${rev}`);
  if (eps) parts.push(`EPS ${eps}`);
  if (e.tier) parts.push(String(e.tier).toUpperCase());
  return parts.join(' · ');
}

/** The move window: from the previous session's close to this session's close (ET). Filed after the close of
 *  the shown session = cannot explain it. A date with no time counts if it is the previous or the shown session. */
export function inMoveWindow(dateIso: string | null | undefined, session: string, prevSession: string, closeEt = '16:00'): boolean {
  if (!dateIso) return false;
  const d = dateIso.slice(0, 10);
  const m = /T(\d{2}):(\d{2})/.exec(dateIso);
  const hasTime = !!m && !/T00:00:00(?:\.000)?Z$/.test(dateIso);
  if (!hasTime) return d === session || d === prevSession;
  const hhmm = `${m![1]}:${m![2]}`;
  if (d === prevSession) return hhmm >= '16:00';
  if (d > prevSession && d < session) return true;          // a weekend / holiday between the two sessions
  if (d === session) return hhmm < closeEt;
  return false;
}

/** Strip the filing subject to its plain lead: "8-K: Material agreement signed [Item 1.01] · filed 07:02 ET …" → "Material agreement signed". */
export function filingLead(subject: string): string {
  const s = String(subject || '');
  const body = s.replace(/^[^:]+:\s*/, '');
  return body.split(' [')[0].split(' · filed')[0].trim() || s;
}

export interface FilingClass { kind: 'catalyst' | 'negative' | 'routine' | 'unclassified'; category: string | null; routineReason: string | null }

/** The SEC filing that best explains the move, with its WHY — or null. `classify` is classifyUsFiling (injected: keeps this file pure). */
export function filingWhy(filings: UsFilingLite[], chg: number, classify: (f: { subject: string }) => FilingClass | null, win: { session: string; prevSession: string; closeEt?: string }): Omit<UsWhy, 'checked'> | null {
  type Cand = { f: UsFilingLite; c: FilingClass; rank: number };
  const cands: Cand[] = [];
  for (const f of filings) {
    if (!inMoveWindow(f.dateIso, win.session, win.prevSession, win.closeEt)) continue;
    const c = classify(f);
    if (!c || c.kind === 'routine') continue;
    // dilution leads on a fall; an event leads on a rise; then unclassified press releases
    const rank = c.category === 'dilution' ? (chg < 0 ? 0 : 2)
      : c.kind === 'catalyst' ? (c.category === 'quarterly_result' ? 1 : 0)
        : c.kind === 'negative' ? (chg < 0 ? 0 : 3)
          : 4;
    cands.push({ f, c, rank });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.rank - b.rank || String(b.f.dateIso).localeCompare(String(a.f.dateIso)));
  const { f, c } = cands[0];
  const form = (f.subject.split(/:| · /)[0] || '').trim().toUpperCase();
  const date = f.dateIso ? f.dateIso.slice(0, 10) : null;
  const base = { source: 'SEC EDGAR', url: f.url, date };
  if (c.category === 'dilution') {
    return { ...base, kind: 'DILUTION', confidence: 'HIGH', text: `⚠ offering / dilution filed (${form}) — ${(c.routineReason || 'new share supply').replace(/^[^—]+—\s*/, '')}` };
  }
  if (c.kind === 'negative') return { ...base, kind: 'FILING', confidence: 'HIGH', text: `${form}: ${(c.routineReason || filingLead(f.subject)).replace(/^[^—]+—\s*/, '')}` };
  if (c.category === 'quarterly_result') return { ...base, kind: 'EARNINGS', confidence: 'MEDIUM', text: `${chg > 0 ? 'rose on' : chg < 0 ? 'fell on' : 'reported'} results (${form}) · figures not graded yet` };
  const what: Record<string, string> = {
    acquisition: 'merger / acquisition filing', open_offer: 'tender offer filed', buyback: 'issuer tender offer (buyback)', strategic_investor: '13D — an active stake was filed',
  };
  if (c.kind === 'catalyst') return { ...base, kind: 'FILING', confidence: c.category === 'strategic_investor' ? 'MEDIUM' : 'HIGH', text: `${what[c.category || ''] || 'SEC filing'} (${form}) · ${filingLead(f.subject)}` };
  // unclassified: an 8-K 1.01 / 7.01 / 8.01 press release whose content is not read here
  return { ...base, kind: 'FILING', confidence: 'MEDIUM', text: `${form} filed: ${filingLead(f.subject)}` };
}

const PRICE_TALK = /\b(?:stock|shares?)\s+(?:is\s+|are\s+)?(?:up|down|soar\w*|surg\w*|jump\w*|plung\w*|tumbl\w*|sink\w*|slid\w*|rall\w*|climb\w*|drop\w*|fall\w*|gain\w*)\b|\bwhy\b.*\b(?:stock|shares?)\b|\b(?:top|biggest)\s+(?:gainers?|losers?|movers?)\b|\bmid-?day movers\b|\bpremarket movers\b|\bunusual (?:options|volume)\b/i;
// Headlines that are about the stock's ownership, a quote page, a schedule or a 52-week mark — never the reason it moved.
const NON_REASON = new RegExp([
  /^form (?:3|4|5|144)\b/.source,                                                     // insider filing digests
  /stock price,? news,? quote/.source,                                                // quote pages
  /\bnew (?:12|52)[- ](?:month|week) (?:high|low)\b|\b(?:12|52)[- ](?:month|week) (?:high|low)\b/.source,
  /\b(?:trims|boosts|lifts|raises|cuts|reduces|increases|decreases|sells|buys|acquires new|takes new|initiates)\b.{0,60}\b(?:stake|position|holdings?|shares)\b/.source,   // 13F digests
  /\bto (?:present|participate|host|ring|report|release|announce)\b.{0,80}\b(?:conference|summit|webcast|results on|earnings on|call on|date)\b/.source,                        // schedules
  /\b(?:short interest|options? (?:volume|activity|chain))\b/.source,
  /\b(?:stock|share) price (?:up|down|rises|falls)\b|\b(?:shares |stock )?gap(?:s|ped)? (?:up|down)\b|\bstock forecasts?\b|\bhistorical data\b|\bworth (?:examining|watching|buying)\b|\brated "?(?:hold|buy|sell|strong buy)"? by\b|\bconsensus (?:rating|recommendation)\b|\b(?:is|should you) (?:it )?(?:time to )?(?:buy|sell)\b/.source,   // quote-page / digest headlines
  /\bwithheld\b.{0,40}\bshares\b|\bvoting power\b|\bnot a market sale\b|\bmarket notice\b|\bbeneficial owner|\bvesting\b/.source,   // ownership paperwork
  /\b(?:rall(?:y|ies|ied)|soar(?:s|ed)?|surg(?:es|ed|e)|jump(?:s|ed)?|plung(?:es|ed|e)|tumbl(?:es|ed|e)|sink(?:s)?|sank|slid(?:es|e)?|climb(?:s|ed)?|drop(?:s|ped)?|fall(?:s)?|fell|gain(?:s|ed)?|spik(?:es|ed|e)|skyrocket(?:s|ed)?|slump(?:s|ed)?)\s+(?:by\s+)?\d+(?:\.\d+)?\s?%/.source,   // "rallies 11%"
].join('|'), 'i');

/** "US Critical Metals Corp. (CN:USCM) …" is about USCM, not CRML: a headline that tags a DIFFERENT ticker in exchange form
 *  ("(NYSE:XYZ)", "(CN:XYZ)") and never this one is about another company with a similar name. */
export function namesOtherTicker(title: string, ticker: string): boolean {
  // both orders occur: "(NYSE:XYZ)" and Seeking Alpha's "(XYZ:NASDAQ)"
  const T = String(ticker || '').toUpperCase();
  const tags = Array.from(String(title || '').matchAll(/\(([A-Z0-9.\-]{1,10}):\s?([A-Z0-9.\-]{1,10})\)/g));
  return tags.length > 0 && !tags.some((m) => m[1] === T || m[2] === T);
}

/** A headline that only describes the price ("XYZ stock soars 20%"), the ownership, a quote page or a schedule is not a reason. */
export const isPriceTalk = (title: string): boolean => PRICE_TALK.test(String(title || '')) || NON_REASON.test(String(title || '').trim());

/**
 * The WHY, best evidence first: graded earnings → SEC filing → news → sector → honest none.
 * Never invents: each branch quotes what the source states, and the last branch says what was checked.
 */
export function attributeUsMover(i: UsWhyInput, classify: (f: { subject: string }) => FilingClass | null): UsWhy {
  const checked: string[] = [];
  const win = { session: i.session, prevSession: i.prevSession, closeEt: i.closeEt };
  // (a) graded earnings filed in the window
  checked.push('graded results');
  const e = i.earnings;
  if (e && (e.filing_date === i.session || e.filing_date === i.prevSession || (e.filing_date > i.prevSession && e.filing_date <= i.session))) {
    return { kind: 'EARNINGS', confidence: 'HIGH', text: earningsWhyText(e, i.chg), source: 'graded results (SEC 8-K 2.02 + XBRL)', url: `/us-earnings-opportunities?date=${e.filing_date}`, date: e.filing_date, checked };
  }
  // (b) an SEC filing in the move window
  if (i.filings) {
    checked.push('SEC filings');
    const f = filingWhy(i.filings, i.chg, classify, win);
    if (f) return { ...f, checked };
  }
  // (c) a dated headline about the company (not price commentary)
  if (i.news) {
    checked.push('news');
    const n = i.news
      .filter((x) => x && x.title && (x.date === i.session || x.date === i.prevSession || (x.date > i.prevSession && x.date <= i.session)))
      .find((x) => !isPriceTalk(x.title) && x.title.trim().split(/\s+/).length >= 5 && !namesOtherTicker(x.title, i.ticker));   // a bare company name is not a headline
    if (n) return { kind: 'NEWS', confidence: 'MEDIUM', text: n.title.length > 140 ? `${n.title.slice(0, n.title.lastIndexOf(' ', 138) > 80 ? n.title.lastIndexOf(' ', 138) : 138)}…` : n.title, source: n.source || 'news', url: n.url, date: n.date, checked };
  }
  // (d) the sector moving the same way
  const sm = i.sectorMovePct;
  if (i.sector && typeof sm === 'number' && Number.isFinite(sm) && Math.abs(sm) >= 1 && Math.sign(sm) === Math.sign(i.chg)) {
    checked.push('sector');
    return { kind: 'SECTOR', confidence: 'LOW', text: `sector rotation — ${i.sector} ${sm >= 0 ? '+' : ''}${sm.toFixed(1)}% (no stock-specific trigger found)`, source: 'sector', url: null, date: i.session, checked };
  }
  // (e) honest none
  const notChecked = [i.filings == null ? 'SEC filings' : null, i.news == null ? 'news' : null].filter(Boolean) as string[];
  const big = Math.abs(i.chg) >= 7;
  const text = notChecked.length
    ? `no confirmed catalyst in ${checked.join(' / ')} · ${notChecked.join(' + ')} not checked for this name`
    : `${big ? 'momentum only · ' : ''}no confirmed catalyst (checked ${checked.join(', ')})${big ? ' — verify before chasing' : ''}`;
  return { kind: 'NONE', confidence: 'LOW', text, source: null, url: null, date: null, checked };
}

// ── 4. QUALITY SCORE Q ─────────────────────────────────────────────────────

/** The US company figures Q reads (Stock Screener snapshot fields; all optional). */
export interface UsFundamentals {
  revQYoY?: number | null; opmTTM?: number | null; fcfm?: number | null; r40?: number | null;
  accG?: string | null; rsR?: number | null;
}

export interface UsQualityInput {
  chg: number;
  relVol?: number | null;
  price?: number | null;
  hi52?: number | null;
  perf1M?: number | null;
  sma50?: number | null;
  sectorMovePct?: number | null;
  confidence: UsWhyConfidence;
  fund?: UsFundamentals | null;
}

export interface UsQuality {
  q: number;                 // 0–100
  label: 'EXCELLENT' | 'GOOD' | 'WEAK' | 'POOR';
  trend: 'up' | 'down' | null;   // price vs its 50-day average
  vsSma50Pct: number | null;
  parts: { relVol: number; fundamentals: number; structure: number; sector: number; trigger: number };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Same curve as India (move-quality.ts): 1× = 0, 3× = 50, 8×+ = 100; unknown = 40. */
export function relVolPart(v?: number | null): number {
  if (!fin(v)) return 40;
  if (v <= 1) return 0;
  if (v >= 8) return 100;
  return v <= 3 ? ((v - 1) / 2) * 50 : 50 + ((v - 3) / 5) * 50;
}

/** Same as India: near the 52-week high + positive month = healthy structure. */
export function structurePart(pctOfHi?: number | null, mom1M?: number | null, chg?: number | null): number {
  if (!fin(pctOfHi) && !fin(mom1M)) return 45;
  let s = 40;
  if (fin(pctOfHi)) s += pctOfHi >= 0.97 ? 35 : pctOfHi >= 0.9 ? 25 : pctOfHi >= 0.75 ? 15 : pctOfHi < 0.5 ? -15 : 0;
  if (fin(mom1M)) s += mom1M > 10 ? 15 : mom1M > 0 ? 5 : mom1M < -10 ? -10 : 0;
  if (fin(chg) && fin(mom1M) && Math.sign(chg) === Math.sign(mom1M) && Math.abs(mom1M) > 5) s += 5;
  return clamp(s);
}

export function sectorPart(chg: number, sectorMove?: number | null): number {
  if (!fin(sectorMove) || Math.sign(chg) === 0 || Math.sign(sectorMove) === 0) return 50;
  return Math.sign(chg) === Math.sign(sectorMove) ? Math.min(100, 60 + Math.min(40, Math.abs(sectorMove) * 15)) : 35;
}

export const triggerPart = (c: UsWhyConfidence): number => (c === 'HIGH' ? 95 : c === 'MEDIUM' ? 60 : 25);

/** The US stand-in for India's delivery %: company quality from the snapshot. Unknown = 40 (India's neutral). */
export function fundamentalsPart(f?: UsFundamentals | null): number {
  if (!f) return 40;
  const xs: number[] = [];
  if (fin(f.revQYoY)) xs.push(f.revQYoY <= 0 ? 15 : f.revQYoY < 10 ? 35 : f.revQYoY < 25 ? 60 : f.revQYoY < 50 ? 80 : 95);
  if (fin(f.opmTTM)) xs.push(f.opmTTM < -20 ? 10 : f.opmTTM < 0 ? 25 : f.opmTTM < 10 ? 55 : f.opmTTM < 20 ? 75 : 90);
  if (fin(f.fcfm)) xs.push(f.fcfm < -10 ? 10 : f.fcfm < 0 ? 30 : f.fcfm < 10 ? 60 : 85);
  if (fin(f.r40)) xs.push(f.r40 < 0 ? 10 : f.r40 < 20 ? 35 : f.r40 < 40 ? 65 : 90);
  const acc: Record<string, number> = { A: 95, B: 80, C: 55, D: 30, E: 15 };
  if (f.accG && acc[f.accG] != null) xs.push(acc[f.accG]);
  if (!xs.length) return 40;
  return clamp(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/** India's weights (move-quality.ts: relVol .30 · delivery .25 · structure .15 · sector .15 · trigger .15), with company
 *  fundamentals in delivery's place (.25). Always an integer 0–100. */
export function usMoveQuality(i: UsQualityInput): UsQuality {
  const pctOfHi = fin(i.price) && fin(i.hi52) && i.hi52 > 0 ? i.price / i.hi52 : null;
  const parts = {
    relVol: relVolPart(i.relVol),
    fundamentals: fundamentalsPart(i.fund),
    structure: structurePart(pctOfHi, i.perf1M, i.chg),
    sector: sectorPart(i.chg, i.sectorMovePct),
    trigger: triggerPart(i.confidence),
  };
  const raw = parts.relVol * 0.3 + parts.fundamentals * 0.25 + parts.structure * 0.15 + parts.sector * 0.15 + parts.trigger * 0.15;
  const q = Math.round(clamp(Number.isFinite(raw) ? raw : 0));
  const label: UsQuality['label'] = q >= 75 ? 'EXCELLENT' : q >= 55 ? 'GOOD' : q >= 35 ? 'WEAK' : 'POOR';
  const vs = fin(i.price) && fin(i.sma50) && i.sma50 > 0 ? (i.price / i.sma50 - 1) * 100 : null;
  return { q, label, trend: vs == null ? null : vs >= 0 ? 'up' : 'down', vsSma50Pct: vs == null ? null : Math.round(vs * 10) / 10, parts };
}

// ── 5. SECTOR BREADTH ──────────────────────────────────────────────────────

export interface SectorMove { sector: string; avg: number; n: number }

/** Average move per sector across the filtered universe (sectors with ≥ minN names). */
export function sectorMoves(rows: Pick<UsQuoteRow, 'sector' | 'chg'>[], minN = 3): SectorMove[] {
  const acc = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    if (!r.sector || !fin(r.chg)) continue;
    const a = acc.get(r.sector) || { s: 0, n: 0 };
    a.s += r.chg; a.n++;
    acc.set(r.sector, a);
  }
  return Array.from(acc.entries()).filter(([, a]) => a.n >= minN)
    .map(([sector, a]) => ({ sector, avg: Math.round((a.s / a.n) * 100) / 100, n: a.n }))
    .sort((a, b) => b.avg - a.avg);
}

export interface UsBreadth { top: SectorMove | null; bottom: SectorMove | null; leaders: string[]; laggards: string[] }

export function usBreadth(moves: SectorMove[], gainers: Pick<UsQuoteRow, 'ticker' | 'sector'>[], losers: Pick<UsQuoteRow, 'ticker' | 'sector'>[]): UsBreadth {
  const top = moves[0] || null;
  const bottom = moves.length > 1 ? moves[moves.length - 1] : null;
  return {
    top, bottom,
    leaders: top ? gainers.filter((g) => g.sector === top.sector).slice(0, 3).map((g) => g.ticker) : [],
    laggards: bottom ? losers.filter((l) => l.sector === bottom.sector).slice(0, 3).map((l) => l.ticker) : [],
  };
}

// ── 6. MARKET-QUALIFIED WATCHLIST KEYS ─────────────────────────────────────

export const usKey = (t: string) => `US:${String(t || '').toUpperCase().trim()}`;

/** US names from the /charts watchlists store (items with m === 'US' only — never India rows) and the US Conviction
 *  Beats bench (keys 'TICKER' or 'TICKER@date'), as 'US:TICKER' keys. Tolerates any junk shape; never throws. */
export function usWatchKeys(chartStore: unknown, usBench: unknown): Set<string> {
  const out = new Set<string>();
  try {
    const lists = (chartStore as any)?.lists;
    if (Array.isArray(lists)) for (const l of lists) for (const s of Array.isArray(l?.sections) ? l.sections : []) for (const it of Array.isArray(s?.items) ? s.items : []) {
      if (it && it.m === 'US' && typeof it.t === 'string' && it.t) out.add(usKey(it.t));
    }
  } catch { /* ignore */ }
  try {
    if (usBench && typeof usBench === 'object' && !Array.isArray(usBench)) {
      for (const k of Object.keys(usBench as object)) { const t = k.split('@')[0]; if (t) out.add(usKey(t)); }
    }
  } catch { /* ignore */ }
  return out;
}

// ── 7. THE ANSWER SHAPE ────────────────────────────────────────────────────

export interface UsMoverRow {
  ticker: string; company: string; exchange: string;
  chg: number; price: number | null; mcapM: number | null; avgDollarVolM: number | null; relVol: number | null;
  sector: string | null;
  why: UsWhy;
  quality: UsQuality;
  accG: string | null;
  earningsTier: string | null;
  thin: boolean;              // average traded value < $10M a day — thin for real size
}

export interface UsMoversPayload {
  ok: boolean;
  market: 'US';
  mode: UsMoversMode;
  generatedAt: string;
  notice: UsSessionNotice;
  source: string;             // 'tradingview-scan' | 'stock-screener-snapshot' | 'none'
  sourceNote: string | null;
  universe: { kept: number; dropped: UsUniverseResult['dropped'] };
  gainers: UsMoverRow[];
  losers: UsMoverRow[];
  breadth: UsBreadth;
  coverage: Record<UsWhyKind, number>;
  notes: string[];
}

export function whyCoverage(rows: UsMoverRow[]): Record<UsWhyKind, number> {
  const c: Record<UsWhyKind, number> = { EARNINGS: 0, FILING: 0, DILUTION: 0, NEWS: 0, SECTOR: 0, NONE: 0 };
  for (const r of rows) c[r.why.kind]++;
  return c;
}
