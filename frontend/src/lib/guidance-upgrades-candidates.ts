// zzz843 — Guidance Upgrades: maps EXISTING internal feeds into GuCandidate. Pure (no I/O of its own), so it can be tested.
// Sources: the news article cache, the concall/exchange filing feed cache, the India graded-results cache,
// and the US graded-results cache (KV `us-graded:<engine>:<date>|1`, gzip). Nothing here fetches a document,
// imports a price module, or calls an AI model.
import { gunzipSync } from 'zlib';
import type { GuCandidate, GuContext, GuMarket, GuWindow, GuidanceEvent } from './guidance-upgrades-types';

const WINDOWS: GuWindow[] = ['24H', '3D', '7D', '14D', '30D'];
/** Missing or unknown window falls back to 7D. */
export function parseWindow(v: string | null | undefined): GuWindow {
  const u = String(v ?? '').trim().toUpperCase();
  return (WINDOWS as string[]).includes(u) ? (u as GuWindow) : '7D';
}
export type MarketFilter = 'IN' | 'US' | 'ALL';
export function parseMarket(v: string | null | undefined): MarketFilter {
  const u = String(v ?? '').trim().toUpperCase();
  return u === 'IN' || u === 'US' ? u : 'ALL';
}
export function lookbackDays(w: GuWindow): number {
  return w === '24H' ? 1 : w === '3D' ? 3 : w === '7D' ? 7 : w === '14D' ? 14 : 30;
}

const clean = (s: unknown, max = 1500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const iso = (s: unknown): string | null => { const t = Date.parse(String(s ?? '')); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const tick = (s: unknown): string | undefined => { const t = String(s ?? '').trim().toUpperCase().replace(/\.(NS|BO)$/, ''); return t || undefined; };

const hostOf = (u: unknown): string => { try { return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const isSecUrl = (u: unknown): boolean => { const h = hostOf(u); return h === 'sec.gov' || h.endsWith('.sec.gov'); };
/** Wires that publish the COMPANY'S OWN release (issuer-paid). Reuters, Yahoo, Benzinga etc. are not here on purpose. */
const WIRE_HOSTS = ['businesswire.com', 'prnewswire.com', 'globenewswire.com', 'accesswire.com', 'newsfilecorp.com'];
const WIRE_NAME_RE = /\b(business ?wire|pr ?newswire|globe ?newswire|accesswire|newsfile)\b/i;
export function isCompanyWire(sourceName: unknown, url: unknown): boolean {
  const h = hostOf(url);
  if (h && WIRE_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))) return true;
  return WIRE_NAME_RE.test(String(sourceName || '')) && !/\b(yahoo|reuters|benzinga|seeking ?alpha|marketwatch)\b/i.test(String(sourceName || ''));
}

export function newsToCandidate(a: any): GuCandidate | null {
  const publishedAt = iso(a?.published_at);
  const title = clean(a?.title || a?.headline, 300);
  if (!publishedAt || !title) return null;
  const region = String(a?.region || '').toUpperCase();
  const market: GuMarket = region === 'IN' || region === 'INDIA' ? 'IN' : region === 'US' || region === 'USA' ? 'US' : 'GLOBAL';
  const tickers: string[] = Array.isArray(a?.ticker_symbols) ? a.ticker_symbols : [];
  const ticker = tick(a?.primary_ticker || tickers[0]);
  const url = a?.source_url || a?.url || undefined;
  const sourceName = clean(a?.source_name || a?.source || 'News', 80);
  // PRIMARY only when the item IS the company's own document: the SEC's own site, or a wire release that names a company.
  const kind: GuCandidate['kind'] = isSecUrl(url) ? 'FILING' : ticker && isCompanyWire(sourceName, url) ? 'RELEASE' : 'NEWS';
  return { id: `news:${a?.id ?? title.slice(0, 40)}`, ticker, market, title, text: clean(a?.summary), url, sourceName, publishedAt, kind };
}

export function filingToCandidate(f: any): GuCandidate | null {
  const publishedAt = iso(f?.filing_datetime);
  const title = clean(f?.subject, 300);
  if (!publishedAt || !title) return null;
  return {
    id: `filing:${f?.content_hash ?? `${f?.exchange}:${f?.symbol}:${publishedAt}`}`,
    ticker: tick(f?.symbol), company: clean(f?.company_name, 120) || undefined, market: 'IN',
    title, text: clean(f?.detail), url: (Array.isArray(f?.attachment_urls) && f.attachment_urls[0]) || f?.source_url || undefined,
    sourceName: `${f?.exchange || 'Exchange'} filing`, publishedAt, kind: 'FILING',
  };
}

/** One India graded results row. Its guidance text is the company's own words. */
export function gradedRowToCandidate(r: any, fallbackDate: string): GuCandidate | null {
  const text = clean(r?.guidance_text);
  if (!text) return null;
  const publishedAt = iso(r?.filing_date) || iso(fallbackDate);
  if (!publishedAt) return null;
  return {
    id: `graded:${r?.symbol}:${publishedAt.slice(0, 10)}`,
    ticker: tick(r?.symbol), company: clean(r?.company, 120) || undefined, market: 'IN',
    title: `${clean(r?.company || r?.symbol, 80)} results${r?.guidance_raised ? ': guidance raised' : ''}`,
    text, url: r?.source_url || undefined, sourceName: 'Exchange results filing', publishedAt, kind: 'FILING',
  };
}

export function collectGradedRows(payload: any): any[] {
  if (!payload?.by_tier || typeof payload.by_tier !== 'object') return [];
  const out: any[] = [];
  for (const k of Object.keys(payload.by_tier)) if (Array.isArray(payload.by_tier[k])) out.push(...payload.by_tier[k]);
  return out;
}

export function dateList(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.min(days, 30); i++) out.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Same ticker + same headline start = one candidate. First seen wins (filings are added before news). */
export function dedupeCandidates(list: GuCandidate[]): GuCandidate[] {
  const seen = new Set<string>();
  const out: GuCandidate[] = [];
  for (const c of list) {
    const k = `${c.ticker || ''}|${c.publishedAt.slice(0, 10)}|${c.title.toLowerCase().slice(0, 60)}`;
    if (seen.has(k) || seen.has(c.id)) continue;
    seen.add(k); seen.add(c.id); out.push(c);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// US: the graded-results cache
// The route's graded-US cache (`us-graded:<engine>:<date>|1`) already holds, per filer, the guidance the company
// published (`guidance_figures`), the company's OWN previous full-year guidance (`guide_change`, built from two
// filed releases), the release link, and the street estimate matched to the guided period (`est`).
// We turn those STRUCTURED figures into the plain sentence a company release would carry and let the engine read
// it. Nothing is invented: every number in the sentence is a number the company published.
// ═══════════════════════════════════════════════════════════════════════════

/** graded-us stores `{ z: base64(gzip(json)) }`; older rows are plain objects. */
export function unzipUsPayload(raw: any): any | null {
  if (!raw) return null;
  if (typeof raw?.z === 'string') {
    try { return JSON.parse(gunzipSync(Buffer.from(raw.z, 'base64')).toString('utf8')); } catch { return null; }
  }
  return raw?.by_tier ? raw : null;
}

/** US session dates (Eastern time, weekdays only), newest first. Enough sessions to cover the window. */
export function usSessionDates(now: Date, days: number): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const out: string[] = [];
  const span = Math.min(Math.max(days, 1), 30) + 1;
  for (let i = 0; i <= span; i++) {
    const d = fmt.format(new Date(now.getTime() - i * 86_400_000));
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6 || out.includes(d)) continue;
    out.push(d);
  }
  return out;
}

export interface UsSessions {
  rows: Array<{ date: string; payload: any; version: string }>;
  total: number; warm: number; olderEngine: number;
}
/**
 * Read the graded-US sessions from KV (reader injected, so this stays testable). Cache only: a missing session is
 * COLD and is reported, never graded here. `versions[0]` is the current engine; later versions are tried only for
 * sessions the current one does not hold (a rules change does not change the company's guidance).
 */
export async function loadUsSessions(
  dates: string[], versions: string[], mget: (keys: string[]) => Promise<any[]>, chunk = 6,
): Promise<UsSessions> {
  const rows: UsSessions['rows'] = [];
  const have = new Set<string>();
  let olderEngine = 0;
  for (let vi = 0; vi < versions.length; vi++) {
    const missing = dates.filter((d) => !have.has(d));
    if (!missing.length) break;
    const parts: string[][] = [];
    for (let i = 0; i < missing.length; i += chunk) parts.push(missing.slice(i, i + chunk));
    const got = await Promise.all(parts.map(async (ds) => {
      try { const vals = await mget(ds.map((d) => `us-graded:${versions[vi]}:${d}|1`)); return ds.map((d, i) => ({ d, p: unzipUsPayload(vals?.[i]) })); }
      catch { return ds.map((d) => ({ d, p: null })); }
    }));
    for (const g of got.flat()) if (g.p?.by_tier) { rows.push({ date: g.d, payload: g.p, version: versions[vi] }); have.add(g.d); if (vi > 0) olderEngine++; }
  }
  return { rows, total: dates.length, warm: have.size, olderEngine };
}

type UsLine = { metric: string; basis: string | null; period: string | null; unit: string; low: number | null; high: number | null; prevLow: number | null; prevHigh: number | null; est: number | null };

const fyNorm = (label: unknown): string => {
  const t = String(label ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!t || t === 'FULL YEAR') return '';
  return t.replace(/\bFY(\d{4})\b/, (_m, y: string) => `FY${y.slice(2)}`);
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const US_METRIC_WORDS: Record<string, { word: string; unit: 'usd' | 'usd_share' | 'pct'; engine: 'REVENUE' | 'ADJ_EPS' | 'EPS' | null }> = {
  revenue: { word: 'revenue', unit: 'usd', engine: 'REVENUE' },
  eps: { word: 'EPS', unit: 'usd_share', engine: 'EPS' },
  operating_income: { word: 'operating income', unit: 'usd', engine: null },
  ebitda: { word: 'EBITDA', unit: 'usd', engine: null },
  free_cash_flow: { word: 'free cash flow', unit: 'usd', engine: null },
  net_income: { word: 'net income', unit: 'usd', engine: null },
  operating_margin: { word: 'operating margin', unit: 'pct', engine: null },
};

type Scale = { key: 'B' | 'M' | 'K' | ''; div: number; word: string };
const scaleFor = (v: number): Scale => {
  const a = Math.abs(v);
  return a >= 1e9 ? { key: 'B', div: 1e9, word: ' billion' } : a >= 1e6 ? { key: 'M', div: 1e6, word: ' million' } : a >= 1e3 ? { key: 'K', div: 1e3, word: ' thousand' } : { key: '', div: 1, word: '' };
};
const trim = (v: number, dp: number): string => String(parseFloat(v.toFixed(dp)));

function sentenceFor(l: UsLine, company: string, verb = 'raised'): { text: string; label: string; scale: Scale | null; fmt: (lo: number | null, hi: number | null) => string } | null {
  const w = US_METRIC_WORDS[l.metric];
  if (!w || w.unit !== l.unit) return null;
  const newV = [l.low, l.high].filter((x): x is number => x != null);
  const oldV = [l.prevLow, l.prevHigh].filter((x): x is number => x != null);
  if (!newV.length || !oldV.length) return null;
  const scale = l.unit === 'usd' ? scaleFor(Math.max(...newV.map(Math.abs))) : null;
  const one = (v: number): string => l.unit === 'pct' ? `${trim(v, 2)}%` : l.unit === 'usd_share' ? `$${v.toFixed(2)}` : `$${trim(v / scale!.div, 3)}${scale!.word}`;
  const fmt = (lo: number | null, hi: number | null): string => {
    const a = lo ?? hi!; const b = hi ?? lo!;
    return a === b ? one(a) : `${one(Math.min(a, b))} to ${one(Math.max(a, b))}`;
  };
  const adj = l.basis === 'adjusted' && l.metric !== 'revenue';
  const word = l.metric === 'eps' ? (adj ? 'adjusted EPS' : 'GAAP EPS') : `${adj ? 'adjusted ' : ''}${w.word}`;
  const per = fyNorm(l.period) || 'full-year';
  const text = `The company ${verb} ${per} ${word} guidance to ${fmt(l.low, l.high)} from ${fmt(l.prevLow, l.prevHigh)}.`;
  return { text, label: `${per} ${word}`, scale, fmt };
}

export interface UsRowResult {
  cand: GuCandidate;
  consensus?: NonNullable<GuContext['consensus']>;
  pe?: number;
  /** Lines the SAME release lowered. The engine keeps raises only, so the route adds these as a stated risk. */
  cuts: string[];
}

/** One graded-US row -> a candidate (or null when the row carries no raised guidance). */
export function usGradedRowToCandidate(row: any, sessionDate: string, generatedAt?: string): UsRowResult | null {
  const ticker = tick(row?.ticker);
  if (!ticker) return null;
  const company = clean(row?.company, 120) || ticker;
  const fd = String(row?.filing_date || '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(fd) ? fd : /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ? sessionDate : '';
  if (!date) return null;

  const figs: any[] = Array.isArray(row?.guidance_figures) ? row.guidance_figures : [];
  const chgs: any[] = Array.isArray(row?.guide_change) ? row.guide_change : [];
  const key = (m: unknown, b: unknown, p: unknown) => `${m}|${b || ''}|${fyNorm(p)}`;
  const figBy = new Map<string, any>();
  for (const f of figs) figBy.set(key(f?.metric, f?.basis, f?.period_label), f);

  const raised: UsLine[] = []; const lowered: UsLine[] = []; const seen = new Set<string>();
  for (const c of chgs) {
    const k = key(c?.metric, c?.basis, c?.period_label); seen.add(k);
    const f = figBy.get(k);
    const line: UsLine = { metric: String(c?.metric), basis: c?.basis ?? null, period: c?.period_label ?? null, unit: String(c?.unit ?? f?.unit ?? ''),
      low: num(c?.new_low), high: num(c?.new_high), prevLow: num(c?.prev_low), prevHigh: num(c?.prev_high), est: num(f?.est) };
    if (c?.direction === 'raised') raised.push(line); else if (c?.direction === 'lowered') lowered.push(line);
  }
  for (const f of figs) {   // a prior column printed inside the release's own outlook table
    const k = key(f?.metric, f?.basis, f?.period_label);
    if (seen.has(k) || (f?.prior_low == null && f?.prior_high == null)) continue;
    const line: UsLine = { metric: String(f?.metric), basis: f?.basis ?? null, period: f?.period_label ?? null, unit: String(f?.unit ?? ''),
      low: num(f?.low), high: num(f?.high), prevLow: num(f?.prior_low), prevHigh: num(f?.prior_high), est: num(f?.est) };
    if (f?.raised === true) raised.push(line); else if (f?.raised === false) lowered.push(line);
  }

  const sentences: string[] = []; const periods: string[] = []; const built: Array<{ l: UsLine; s: NonNullable<ReturnType<typeof sentenceFor>> }> = [];
  for (const l of raised) {
    const s = sentenceFor(l, company); if (!s) continue;
    sentences.push(s.text); built.push({ l, s }); const p = fyNorm(l.period) || 'full-year'; if (!periods.includes(p)) periods.push(p);
  }
  const cuts: string[] = [];
  for (const l of lowered) {
    const s = sentenceFor(l, company, 'lowered'); if (!s) continue;
    cuts.push(`The same release lowered ${s.label} guidance to ${s.fmt(l.low, l.high)} from ${s.fmt(l.prevLow, l.prevHigh)}`);
  }

  let title: string; let text: string;
  if (sentences.length) { title = `${company} raises ${periods.join(' and ')} guidance`; text = sentences.join(' '); }
  else {
    // No structured before/after: use the company's own verbatim outlook sentences, only when the row's own verdict is RAISED.
    const snips: string[] = Array.isArray(row?.guidance_snippets) ? row.guidance_snippets.map((x: unknown) => clean(x, 400)).filter(Boolean) : [];
    if (String(row?.guidance || '').toUpperCase() !== 'RAISED' || !snips.length) return null;
    title = `${company} raises guidance`; text = snips.join(' ');
  }

  // Source: PRIMARY only when we hold the SEC document link. Without one it stays a cache row (DISCOVERY tier -> UNVERIFIED).
  const gUrl = row?.guidance_url; const fUrl = row?.filing_url;
  const url = isSecUrl(gUrl) ? String(gUrl) : isSecUrl(fUrl) ? String(fUrl) : undefined;
  const kind: GuCandidate['kind'] = url ? (isSecUrl(gUrl) ? 'RELEASE' : 'FILING') : 'OTHER';
  const sourceName = url ? (isSecUrl(gUrl) ? 'Company earnings release (SEC 8-K exhibit)' : 'SEC filing (8-K)') : 'US graded results cache (no source link)';
  const cand: GuCandidate = { id: `usgraded:${ticker}:${date}`, ticker, company, market: 'US', title, text, url, sourceName, publishedAt: date, kind };

  // Street estimate: only one the results row already matched to THIS guided period (revenue first, then adjusted EPS).
  let consensus: UsRowResult['consensus'];
  const pick = built.find((b) => b.l.metric === 'revenue' && b.l.est != null) ?? built.find((b) => b.l.metric === 'eps' && b.l.basis === 'adjusted' && b.l.est != null);
  if (pick && pick.l.est != null) {
    const per = fyNorm(pick.l.period) || 'UNSTATED';
    const isRev = pick.l.metric === 'revenue';
    const sc = pick.s.scale;
    consensus = {
      metric: isRev ? 'REVENUE' : 'ADJ_EPS', period: per,
      value: isRev ? parseFloat((pick.l.est / (sc?.div ?? 1)).toFixed(4)) : pick.l.est,
      unit: isRev ? `$${sc?.key ?? ''}` : '$',
      source: `Analyst estimate attached to this results row (vendor estimate feed, read when the session was graded${generatedAt ? ` on ${String(generatedAt).slice(0, 10)}` : ''}; it may already reflect the raise)`,
    };
  }
  const pe = num(row?.pe);
  return { cand, consensus, pe: pe != null && pe > 0 ? pe : undefined, cuts };
}

// ═══════════════════════════════════════════════════════════════════════════
// Markets: keep IN and US apart, filter, and say honestly what was covered
// ═══════════════════════════════════════════════════════════════════════════

/** A wire/news item with no region but a ticker the US graded cache knows is a US item. */
export function reassignGlobalToUs(list: GuCandidate[], usTickers: ReadonlySet<string>): GuCandidate[] {
  return list.map((c) => (c.market === 'GLOBAL' && c.ticker && usTickers.has(c.ticker) ? { ...c, market: 'US' as GuMarket } : c));
}

/** Split so a US ticker and an India ticker with the same letters can never be merged into one event. */
export function splitByMarket(list: GuCandidate[], perMarketCap = 200): Record<GuMarket, GuCandidate[]> {
  const out: Record<GuMarket, GuCandidate[]> = { IN: [], US: [], GLOBAL: [] };
  for (const c of list) if (out[c.market].length < perMarketCap) out[c.market].push(c);
  return out;
}

export function filterByMarket(events: GuidanceEvent[], market: MarketFilter): GuidanceEvent[] {
  return market === 'ALL' ? events : events.filter((e) => e.market === market);
}

export type CandidateOrigin = 'graded' | 'filings' | 'news';
export const originOf = (c: GuCandidate): CandidateOrigin => c.id.startsWith('graded:') || c.id.startsWith('usgraded:') ? 'graded' : c.id.startsWith('filing:') ? 'filings' : 'news';

export interface MarketCoverage {
  market: 'IN' | 'US';
  candidates: Record<CandidateOrigin, number>;   // raise candidates that passed the guidance filter
  sessions?: { warm: number; total: number; olderEngine: number };   // US graded sessions found in KV
  cacheEmpty: string[];                          // feeds that returned nothing
  events: number; withConsensus: number;
  newest: string | null;
}

export function coverageLine(c: MarketCoverage, now: Date = new Date()): string {
  const name = c.market === 'IN' ? 'India' : 'US';
  const gradedWord = c.market === 'IN' ? 'results filings' : 'graded results (SEC releases)';
  const parts: string[] = [];
  if (c.candidates.graded) parts.push(`${c.candidates.graded} from ${gradedWord}`);
  if (c.candidates.filings) parts.push(`${c.candidates.filings} from the exchange filing feed`);
  if (c.candidates.news) parts.push(`${c.candidates.news} from news`);
  const total = c.candidates.graded + c.candidates.filings + c.candidates.news;
  let s = `${name}: ${total} raise candidate${total === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  if (c.market === 'US' && c.sessions) {
    if (c.sessions.total > 0 && c.sessions.warm === 0) s += `. The US graded-results cache is cold (0 of ${c.sessions.total} sessions found), so US coverage is from news only`;
    else if (c.sessions.total > 0) s += `. ${c.sessions.warm} of ${c.sessions.total} US sessions were in the cache${c.sessions.warm < c.sessions.total ? ' (the rest are not graded yet)' : ''}${c.sessions.olderEngine ? `, ${c.sessions.olderEngine} from an earlier grading version` : ''}`;
  }
  if (c.cacheEmpty.length) s += `. Empty: ${c.cacheEmpty.join(', ')}`;
  if (c.market === 'IN') s += '. Consensus unavailable (no analyst estimates feed for India)';
  else if (c.events === 0) s += '. Consensus unavailable';
  else if (c.withConsensus === 0) s += `. Consensus unavailable for all ${c.events} event${c.events === 1 ? '' : 's'} (no analyst estimate matched a guided period)`;
  else if (c.withConsensus >= c.events) s += `. Analyst consensus matched for all ${c.events} event${c.events === 1 ? '' : 's'}`;
  else s += `. Analyst consensus matched for ${c.withConsensus} of ${c.events} events; DATA UNAVAILABLE for the rest`;
  if (c.newest) {
    const d = Math.max(0, Math.floor((now.getTime() - Date.parse(c.newest)) / 86_400_000));
    s += `. Newest announcement ${c.newest.slice(0, 10)} (${d === 0 ? 'today' : `${d}d ago`})`;
  } else s += '. No announcement in this window';
  return `${s}.`;
}

export function coverageNote(list: MarketCoverage[], now: Date = new Date()): string {
  return list.map((c) => coverageLine(c, now)).join(' ');
}
