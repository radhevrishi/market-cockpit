// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE DISCOVERY — FIND EVERY DOCUMENT, NOT THE FIRST ONE.      (zzz733)
//
// THE BUG THIS EXISTS TO FIX, in the owner's words: "Claude is functioning as
// a grader over whatever data is already available, not as an evidence-
// retrieval agent." He is right, and the code said so plainly: the India
// reader tried the exchange feed, then ONE screener.in document, and on
// failure returned "No readable document was found" — after which the card
// was still drawn from screener financial data with every structural field
// at ○. A retrieval failure became a thesis verdict.
//
// Three separate defects sat underneath that sentence:
//
//   1. ONE DOCUMENT PER COMPANY. A quarter's evidence is spread across the
//      results PDF (the numbers), the investor presentation (capacity,
//      utilisation, order book) and the concall transcript (the cause, the
//      guidance, the ramp). Reading whichever single document answered first
//      structurally cannot populate the structural block.
//   2. A CHAIN THAT STOPPED AT THE FIRST FAILURE. screener.in is unreachable
//      from this host — it refuses datacenter IPs — so on production the
//      chain died at step one and never reached the exchange announcements
//      that WERE available.
//   3. NO RECORD OF WHAT WAS TRIED. "No readable document" is indistinguish-
//      able from "the company disclosed nothing", and those are opposite
//      facts about a holding. Every attempt is now recorded and returned.
//
// WHAT THIS MODULE DOES NOT DO. It finds and ranks documents. It does not
// extract, does not interpret, and never produces a value. Extraction is a
// separate stage precisely so a discovery failure can never be mistaken for
// a disclosure absence — the distinction the owner's spec calls
// NOT_SEARCHED vs SEARCHED_NO_EVIDENCE.
// ═══════════════════════════════════════════════════════════════════════════

import { fetchCompanyDocs, pickDocument, type CompanyDoc } from '@/lib/earnings/screener-documents';
import { resolveTicker } from '@/lib/bse-nse-mapping';
import { exchangeProxyFor } from '@/lib/pdf-text-extractor';
import { feedDateIso, bareSymbol } from './filing-dates';
import { reportingPeriodFromDate } from './evidence-ledger';

/** Where a document came from, in the owner's source hierarchy (§28). */
export type SourceTier = 1 | 2 | 3;

export type DocKind =
  | 'results'              // the numbers
  | 'investor_presentation' // capacity, utilisation, order book, capex
  | 'transcript'           // cause, guidance, ramp — the richest structural source
  | 'annual_report'
  | 'announcement'         // orders, commissioning, approvals
  | 'other';

export interface DocCandidate {
  url: string;
  kind: DocKind;
  /** Tier 1 company/exchange disclosure, tier 2 management transcript. */
  tier: SourceTier;
  /** Where this candidate was found — named so a card can cite it. */
  source: string;
  /** As the source labels it ("Sep 2026", "2026-08-14"). Null when unlabelled. */
  period: string | null;
  /** ISO date for ordering. Null when unparseable. */
  dateIso: string | null;
  /** Human label for the card's SOURCES block. */
  label: string;
}

/** One retrieval attempt, recorded whether it succeeded or not. */
export interface DiscoveryAttempt {
  source: string;
  outcome: 'found' | 'empty' | 'error';
  detail: string;
  found: number;
}

export type DiscoveryState =
  /** Documents were found and can be read. */
  | 'EVIDENCE_FOUND'
  /** Every source was reached and none of them holds a readable document. */
  | 'SEARCH_EXHAUSTED'
  /** A source could not be reached at all — this is NOT an absence of
   *  disclosure, and must never be reported as one. */
  | 'RETRIEVAL_FAILED';

export interface Discovery {
  state: DiscoveryState;
  candidates: DocCandidate[];
  attempts: DiscoveryAttempt[];
  /** Plain sentence for the card. Says what was tried, never blames the
   *  company for a network failure. */
  summary: string;
}

/**
 * How much structural evidence a kind of document typically carries.
 *
 * A TRANSCRIPT RANKS ABOVE THE RESULTS PDF, and not as a fallback. The
 * structural block asks for utilisation, capacity, order intake, commissioning
 * dates and management targets. A results PDF is a statement of financials and
 * usually contains none of them; a concall is forty minutes of analysts asking
 * management exactly those questions. The exchange feed was wired first
 * because it was available, not because it was better.
 */
const KIND_RANK: Record<DocKind, number> = {
  transcript: 0,
  investor_presentation: 1,
  results: 2,
  announcement: 3,
  annual_report: 4,
  other: 5,
};

/** Pure: rank candidates for reading, nearest-period first within a kind. */
export function rankCandidates(candidates: DocCandidate[], near?: string | null): DocCandidate[] {
  const nearMs = near ? Date.parse(near) : NaN;
  const ageRank = (d: DocCandidate): number => {
    if (!d.dateIso) return 3;
    if (!Number.isFinite(nearMs)) return 0;
    const days = Math.abs(Date.parse(d.dateIso) - nearMs) / 86_400_000;
    return days <= 120 ? 0 : days <= 240 ? 1 : 2;
  };
  return [...candidates].sort((a, b) => {
    const aa = ageRank(a), ba = ageRank(b);
    if (aa !== ba) return aa - ba;
    const ak = KIND_RANK[a.kind], bk = KIND_RANK[b.kind];
    if (ak !== bk) return ak - bk;
    // Among 'results' filings the statement of results itself beats a press
    // release or a board-meeting outcome letter filed the same week: CUPID's
    // newest "results" candidate was a 22-Sep press release about a share
    // disclosure, dated after the August financial results. (zzz765)
    if (a.kind === 'results') {
      // A correction or clarification of the results names them too, and
      // CUPID filed one four days after its August results. (zzz765)
      const rs = (c: DocCandidate) => (RESULTS_CORRECTION.test(c.label) ? 2 : RESULTS_STATEMENT.test(c.label) ? 0 : 1);
      const as = rs(a), bs = rs(b);
      if (as !== bs) return as - bs;
    }
    return String(b.dateIso || '').localeCompare(String(a.dateIso || ''));
  });
}

const RESULTS_CORRECTION = /correction|typographical|clarification|inadvertent|erratum/i;
const RESULTS_STATEMENT = /financial\s+results|results?\s+for\s+the\s+(quarter|half|year)|quarter\s+ended|regulation\s+33/i;

/**
 * Pure: pick the documents worth reading, capped, and never two of the same
 * kind.
 *
 * ONE PER KIND IS THE POINT. Reading three investor presentations from three
 * quarters costs three model calls and answers the same questions three times;
 * reading the transcript AND the presentation AND the results answers three
 * different sets. The cap exists because each document is a model call against
 * the owner's budget.
 */
export function selectForReading(ranked: DocCandidate[], max = 3): DocCandidate[] {
  const out: DocCandidate[] = [];
  const kinds = new Set<DocKind>();
  // 'other' is a shareholders-meeting notice, a voting result, a newspaper
  // clipping. It never carries capacity, utilisation or order-book language,
  // so reading it is a model call that returns zero passages. It stays in the
  // candidate list for the trail but is never selected. (JINDRILL read one
  // and reported 0 passages — that was the cost.)
  const readable = ranked.filter((c) => c.kind !== 'other');
  for (const c of readable) {
    if (out.length >= max) break;
    if (kinds.has(c.kind)) continue;
    kinds.add(c.kind);
    out.push(c);
  }
  // A second document of an already-taken kind is better than no second
  // document at all, so the remaining slots are filled after the sweep.
  for (const c of readable) {
    if (out.length >= max) break;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Pure: candidates that carry structural evidence (everything but 'other'). */
export function readableCandidates(candidates: DocCandidate[]): DocCandidate[] {
  return candidates.filter((c) => c.kind !== 'other');
}

/** Pure: map a screener.in document entry into a candidate. */
export function candidateFromScreenerDoc(d: CompanyDoc): DocCandidate {
  const kind: DocKind = d.kind === 'transcript' ? 'transcript'
    : d.kind === 'ppt' ? 'investor_presentation'
      : d.kind === 'annual_report' ? 'annual_report' : 'other';
  // An annual report labelled "2026" reports the year that ENDED 31 March
  // 2026. Dated 1 March it fell in Q3 FY26 (IFBAGRO's ledger said so); dated
  // the day after the year end it lands in Q4 FY26, the period it reports.
  const dateIso = kind === 'annual_report' && d.periodIso && /-03-01$/.test(d.periodIso)
    ? d.periodIso.replace(/-03-01$/, '-04-01') : d.periodIso;
  return {
    url: d.url,
    kind,
    tier: kind === 'transcript' ? 2 : 1,
    source: 'screener.in company page',
    period: d.period,
    dateIso,
    label: d.label,
  };
}

/** Pure: classify an exchange attachment by its subject and filename. The
 *  subject is frequently generic ("Announcement under Regulation 30"), so the
 *  filename is read too — the same lesson that produced zzz705. */
export function classifyExchangeDoc(subject: string, url: string): DocKind {
  const hay = `${subject} ${decodeURIComponent(url).replace(/[_-]+/g, ' ')}`;
  if (/transcript/i.test(hay)) return 'transcript';
  if (/investor\s*(presentation|update)|earnings\s*(presentation|deck)/i.test(hay)) return 'investor_presentation';
  if (/financial\s+results|outcome\s+of\s+(the\s+)?board\s+meeting|press\s+release|earnings\s+update/i.test(hay)) return 'results';
  if (/annual\s+report/i.test(hay)) return 'annual_report';
  if (/order|contract|letter\s+of\s+award|loa\b|commission|expansion|capacity|plant|approval|acquisition/i.test(hay)) return 'announcement';
  return 'other';
}

export interface ExchangeFiling {
  symbol?: string;
  subject?: string;
  attachment_url?: string;
  filing_date?: string;
}

/** Pure: every readable attachment this ticker has in the exchange feed,
 *  as candidates. Unlike the old ranker this does NOT discard announcements —
 *  an order win or a commissioning notice is exactly the structural evidence
 *  the thesis ledger asks for, and the old filter threw them away. */
export function candidatesFromFilings(all: ExchangeFiling[], ticker: string): DocCandidate[] {
  // Bare symbols on both sides: the book holds IFBAGRO-BE, the feed IFBAGRO.
  const sym = bareSymbol(ticker);
  const out: DocCandidate[] = [];
  const seen = new Set<string>();
  for (const f of all) {
    if (bareSymbol(f?.symbol) !== sym) continue;
    const url = String(f?.attachment_url || '');
    if (!url || seen.has(url)) continue;
    const subject = String(f?.subject || '');
    const hay = `${subject} ${decodeURIComponent(url).replace(/[_-]+/g, ' ')}`;
    // Documents that are never evidence of anything structural.
    if (/newspaper|trading window|voting result|scrutini[sz]er|postal ballot|duplicate share|loss of share|share transfer|reconciliation of share capital|compliance certificate/i.test(hay)) continue;
    seen.add(url);
    const kind = classifyExchangeDoc(subject, url);
    // The feed writes "22-Sep-2026 18:47:27"; an ISO-only test left every
    // exchange candidate undated. (zzz765)
    const date = feedDateIso(f?.filing_date, url);
    out.push({
      url,
      kind,
      tier: 1,
      source: 'exchange filing feed',
      period: date,
      dateIso: date,
      label: subject || 'Exchange filing',
    });
  }
  return out;
}

// ── BSE: the company's own announcement list.                     (zzz765)
//
// WHY THIS SOURCE EXISTS. CUPID and IFBAGRO showed nothing newer than Q4 FY26
// on 22 September although both filed Q1 FY27 results in August (CUPID on
// 7 Aug, "Un-Audited Financial Results … Quarter Ended June 30, 2026"). The
// two sources discovery had could not hold that PDF:
//   · the CF worker feed is a rolling ~1-week window, and its `/day/<date>`
//     endpoint answers `count: 0` for August;
//   · screener.in lists only concall transcripts, presentations and annual
//     reports — CUPID filed no August presentation or concall, and IFB Agro
//     has never held a concall at all.
// BSE's per-scrip announcement API returns every filing with its PDF, dated,
// for as far back as asked. It is the same API `fetchBSEAnnouncements` already
// reads for the whole market, asked for one scrip.

/** One row of BSE's AnnSubCategoryGetData table (the fields used). */
export interface BseAnnouncement {
  NEWSSUB?: string;
  HEADLINE?: string;
  NEWS_DT?: string;
  DT_TM?: string;
  CATEGORYNAME?: string | null;
  SUBCATNAME?: string | null;
  ATTACHMENTNAME?: string | null;
  PDFFLAG?: number | string | null;
}

/** Pure: BSE announcement rows → candidates. Insider/SAST disclosures, AGM
 *  paperwork and board-meeting INTIMATIONS are dropped (the intimation names
 *  "Financial Results" and would otherwise pose as the result). */
export function candidatesFromBse(rows: BseAnnouncement[]): DocCandidate[] {
  const out: DocCandidate[] = [];
  const seen = new Set<string>();
  for (const r of rows || []) {
    const file = String(r?.ATTACHMENTNAME || '').trim();
    if (!file || !/\.pdf$/i.test(file)) continue;
    const subject = String(r?.NEWSSUB || r?.HEADLINE || '').trim();
    const cat = `${r?.CATEGORYNAME || ''} ${r?.SUBCATNAME || ''}`.trim();
    const hay = `${cat} ${subject}`;
    if (/insider trading|sast|regulation 29|reg\. ?29|agm\/egm|postal ballot|newspaper|trading window|iepf|voting result|scrutini[sz]er|compliance certificate|certificate under reg|reg\. ?74|loss of share|duplicate share|share transfer|reconciliation of share capital|brsr|business responsibility/i.test(hay)) continue;
    if (/board meeting intimation|intimation of board meeting|prior intimation|advance intimation/i.test(hay)) continue;
    // BSE serves a live attachment from AttachLive and an archived one from
    // AttachHis; PDFFLAG says which (0 live, otherwise historical) — verified
    // against CUPID's filings: flag 1 answered 404 on AttachLive.
    const live = String(r?.PDFFLAG ?? '0') === '0';
    const url = `https://www.bseindia.com/xml-data/corpfiling/${live ? 'AttachLive' : 'AttachHis'}/${file}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const date = feedDateIso(r?.NEWS_DT || r?.DT_TM || null);
    out.push({
      url, kind: classifyExchangeDoc(hay, url), tier: 1, source: 'BSE corporate announcements',
      period: date, dateIso: date, label: subject || cat || 'BSE filing',
    });
  }
  return out;
}

const BSE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const bseHeaders = { 'User-Agent': BSE_UA, Accept: 'application/json, text/plain, */*', Referer: 'https://www.bseindia.com/', Origin: 'https://www.bseindia.com' };

/** GET a bseindia.com URL directly, then through the exchange proxy the PDF
 *  reader already uses (BSE refuses some datacenter IPs). */
async function bseGet(url: string, timeoutMs: number): Promise<{ body: string | null; outcome: string }> {
  const hops = [url, exchangeProxyFor(url)].filter((u): u is string => !!u);
  const why: string[] = [];
  for (const u of hops) {
    try {
      const r = await fetch(u, { headers: bseHeaders, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) { why.push(`HTTP ${r.status}`); continue; }
      return { body: await r.text(), outcome: 'ok' };
    } catch (e: any) {
      why.push(e?.name === 'TimeoutError' ? 'timed out' : String(e?.message || e));
    }
  }
  return { body: null, outcome: why.join('; ') || 'no response' };
}

/** The scrip code for a symbol: the screener page's link, the curated map,
 *  then BSE's own quote search (exact symbol match only). */
async function bseScripCode(ticker: string, fromScreener: string | null | undefined): Promise<{ code: string | null; error: string | null }> {
  if (fromScreener && /^\d{6}$/.test(fromScreener)) return { code: fromScreener, error: null };
  const sym = bareSymbol(ticker);
  const mapped = resolveTicker(sym).bseCode;
  if (mapped && /^\d{6}$/.test(mapped)) return { code: mapped, error: null };
  const got = await bseGet(`https://api.bseindia.com/Msource/1D/getQouteSearch.aspx?Type=EQ&text=${encodeURIComponent(sym)}&flag=site`, 10_000);
  // The search not answering is an outage; answering without the symbol means
  // the company is not listed on BSE — an answer, not an error.
  if (!got.body) return { code: null, error: `BSE symbol search: ${got.outcome}` };
  for (const m of got.body.matchAll(/stock-share-price\/[^/'"]+\/([^/'"]+)\/(\d{6})\//gi)) {
    if (m[1].toUpperCase() === sym) return { code: m[2], error: null };
  }
  return { code: null, error: null };
}

/** The company's BSE announcements over the last `days`, as candidates. */
export async function fetchBseCandidates(ticker: string, scripHint: string | null | undefined, days = 200): Promise<{ candidates: DocCandidate[]; attempt: DiscoveryAttempt }> {
  const source = 'BSE corporate announcements';
  const sc = await bseScripCode(ticker, scripHint);
  const code = sc.code;
  if (!code) {
    return { candidates: [], attempt: sc.error
      ? { source, outcome: 'error', detail: sc.error, found: 0 }
      : { source, outcome: 'empty', detail: `${bareSymbol(ticker)} is not listed on BSE`, found: 0 } };
  }
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const to = new Date(), from = new Date(Date.now() - days * 86_400_000);
  const rows: BseAnnouncement[] = [];
  for (let page = 1; page <= 3; page++) {
    const got = await bseGet(`https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${page}&strCat=-1&strPrevDate=${ymd(from)}&strScrip=${code}&strSearch=P&strToDate=${ymd(to)}&strType=C&subcategory=-1`, 15_000);
    if (!got.body) {
      if (page === 1) return { candidates: [], attempt: { source, outcome: 'error', detail: `scrip ${code}: ${got.outcome}`, found: 0 } };
      break;
    }
    let j: any = null;
    try { j = JSON.parse(got.body); } catch { j = null; }
    const table: BseAnnouncement[] = Array.isArray(j?.Table) ? j.Table : [];
    // BSE answers the string "No Record Found!" (valid JSON) for an empty range.
    if (!table.length) break;
    rows.push(...table);
    const total = Number(j?.Table1?.[0]?.ROWCNT || 0);
    if (!total || rows.length >= total) break;
  }
  const candidates = candidatesFromBse(rows);
  return {
    candidates,
    attempt: {
      source, outcome: candidates.length ? 'found' : 'empty',
      detail: candidates.length ? `${candidates.length} filing(s) with PDFs for scrip ${code} in the last ${days} days` : `scrip ${code} has no readable filing in the last ${days} days`,
      found: candidates.length,
    },
  };
}

/**
 * Pure: the next document to try when one could not be read. Same kind AND
 * same reporting period first (AETHER's August presentation failed to
 * download — its July presentation is the same quarter's slides), then any
 * readable kind of the same period. Never a different period: a substitute
 * from another quarter would be read as though it were this one.
 */
export function nextBestCandidate(ranked: DocCandidate[], failed: DocCandidate, tried: Set<string>): DocCandidate | null {
  const periodOf = (c: DocCandidate) => reportingPeriodFromDate(c.dateIso)?.period || null;
  const want = periodOf(failed);
  if (!want) return null;
  const pool = ranked.filter((c) => c.kind !== 'other' && !tried.has(c.url) && periodOf(c) === want);
  return pool.find((c) => c.kind === failed.kind) || pool[0] || null;
}

/**
 * Pure: what a read that produced nothing records. A source that errored
 * (HTTP 5xx, timeout, refused) or a document we could not download or OCR
 * makes it SOURCE_UNAVAILABLE — our failure, never the company's silence.
 * NO_DISCLOSURE only when every source answered and nothing readable exists.
 */
export function attemptOutcome(
  attempts: Array<Pick<DiscoveryAttempt, 'outcome'>>,
  documentOutcomes: Array<{ outcome: string }>,
): 'SOURCE_UNAVAILABLE' | 'NO_DISCLOSURE' {
  if (attempts.some((a) => a.outcome === 'error')) return 'SOURCE_UNAVAILABLE';
  if (documentOutcomes.some((o) => o.outcome === 'download_failed' || o.outcome === 'scanned' || o.outcome === 'budget_exhausted')) return 'SOURCE_UNAVAILABLE';
  return 'NO_DISCLOSURE';
}

/**
 * Discover every document available for one company.
 *
 * BOTH SOURCES ARE ALWAYS TRIED. The previous chain stopped as soon as one
 * answered, which meant that on production — where screener.in refuses this
 * host — the whole structural block came back empty while exchange
 * announcements sat unread. A source that fails is recorded and the next one
 * runs.
 */
export async function discoverEvidence(
  ticker: string,
  opts: { filings?: ExchangeFiling[]; filingDate?: string | null },
): Promise<Discovery> {
  const attempts: DiscoveryAttempt[] = [];
  const candidates: DocCandidate[] = [];

  // ── Source 1: the exchange feed (tier 1, but a rolling ~1-week window).
  const filings = opts.filings || [];
  if (filings.length) {
    const found = candidatesFromFilings(filings, ticker);
    candidates.push(...found);
    attempts.push({
      source: 'exchange filing feed',
      outcome: found.length ? 'found' : 'empty',
      detail: found.length
        ? `${found.length} attachment(s) for ${ticker}`
        : `the feed was read (${filings.length} filings) but holds none for ${ticker} — it is a rolling window of roughly one week`,
      found: found.length,
    });
  } else {
    attempts.push({
      source: 'exchange filing feed',
      outcome: 'error',
      detail: 'the feed could not be reached',
      found: 0,
    });
  }

  // ── Source 2: the screener.in company page (full concall history).
  let scripHint: string | null = null;
  try {
    const lib = await fetchCompanyDocs(ticker);
    scripHint = lib.bseCode || null;
    // A page that loaded and lists nothing is an answer ("empty"), not an
    // outage; only a page that could not be fetched is an error. (zzz765)
    if (lib.error && !lib.docs.length && !/no readable documents listed/i.test(lib.error)) {
      attempts.push({ source: 'screener.in company page', outcome: 'error', detail: lib.error, found: 0 });
    } else {
        const found = lib.docs.map(candidateFromScreenerDoc);
      candidates.push(...found);
      attempts.push({
        source: 'screener.in company page',
        outcome: found.length ? 'found' : 'empty',
        detail: found.length ? `${found.length} document(s) listed` : 'the page lists no transcript, presentation or annual report',
        found: found.length,
      });
    }
  } catch (e: any) {
    attempts.push({ source: 'screener.in company page', outcome: 'error', detail: String(e?.message || e), found: 0 });
  }

  // ── Source 3: BSE's announcement list for the scrip — results PDFs,
  // presentations and transcripts of any age, whatever screener.in or the
  // one-week feed can reach. Runs even when screener.in answered: screener
  // does not list results filings at all. (zzz765)
  try {
    const bse = await fetchBseCandidates(ticker, scripHint);
    const known = new Set(candidates.map((c) => c.url));
    candidates.push(...bse.candidates.filter((c) => !known.has(c.url)));
    attempts.push(bse.attempt);
  } catch (e: any) {
    attempts.push({ source: 'BSE corporate announcements', outcome: 'error', detail: String(e?.message || e), found: 0 });
  }

  return resolveDiscovery(ticker, candidates, attempts, opts.filingDate);
}

/**
 * Pure: turn what was found and what was tried into a state and a sentence.
 * Split out so the state rule is testable without a network.
 */
export function resolveDiscovery(
  ticker: string,
  candidates: DocCandidate[],
  attempts: DiscoveryAttempt[],
  filingDate?: string | null,
): Discovery {
  // Ranked around the NEWEST readable document when that is later than the
  // hint (or there is no hint). With no reference date every dated candidate
  // was "near", so kind alone decided and CUPID read a January 2024 concall
  // transcript as its latest evidence. (zzz765)
  const newest = candidates.filter((c) => c.kind !== 'other' && c.dateIso).map((c) => c.dateIso as string).sort().pop() || null;
  const near = filingDate && (!newest || filingDate >= newest) ? filingDate : (newest || filingDate || null);
  const ranked = rankCandidates(candidates, near);
  const readable = readableCandidates(ranked);
  const errored = attempts.filter((a) => a.outcome === 'error');

  // THE THREE STATES ARE NOT INTERCHANGEABLE. Anything readable found is
  // EVIDENCE_FOUND. Nothing found is SEARCH_EXHAUSTED only when EVERY source
  // answered — one source erroring is enough to make it RETRIEVAL_FAILED,
  // because the document may well sit behind the source that failed.
  // The first version of this line used `anyReached`, so a screener.in 504
  // with an empty exchange window reported "every source was reached". It
  // had not. That is exactly the bug the spec's §2 describes, and saying
  // "not disclosed" there reports our own outage as the company's silence.
  const state: DiscoveryState = readable.length ? 'EVIDENCE_FOUND'
    : errored.length ? 'RETRIEVAL_FAILED' : 'SEARCH_EXHAUSTED';

  const onlyOther = !readable.length && ranked.length > 0;
  const summary = state === 'EVIDENCE_FOUND'
    ? `${readable.length} readable document(s) found across ${attempts.filter((a) => a.outcome === 'found').length} source(s)`
      + (errored.length ? ` (${errored.map((a) => a.source).join(', ')} unreachable — coverage may be partial).` : '.')
    : state === 'SEARCH_EXHAUSTED'
      ? (onlyOther
        ? `Every source was reached; ${ranked.length} filing(s) exist for ${ticker} but none is a transcript, presentation, results or annual report. `
        : `Every source was reached and none holds a readable document for ${ticker}. `)
        + 'This is an absence of disclosure, not a failed search.'
      : `Evidence could not be retrieved for ${ticker}: ${errored.map((a) => `${a.source} — ${a.detail}`).join('; ')}. `
        + 'No conclusion about the thesis follows from this.';

  return { state, candidates: ranked, attempts, summary };
}

/** Kept so the old single-document path keeps compiling while callers move
 *  over. Prefer `discoverEvidence` + `selectForReading`. */
export { pickDocument };
