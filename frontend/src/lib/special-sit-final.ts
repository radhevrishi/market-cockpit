// zzz1066 — Special Situations: ONE final event set, with stable IDs, issuer identity and evidence state.
//
// Audit S01 / S02 / S04 (New Release Audit, Oct 2026):
//  - S01: the header, coverage, Radar, All Situations and the home summary each built their own event list (All Situations
//    listed held-back, contradicted and expired items as "Low signal"). The server now sends one final set (`final_events`,
//    `final_event_ids`) and every view reads it. Raw discovery stays in its own labelled tab.
//  - S04: event IDs used to be hash(event type + first ticker), so every CEAT acquisition story in 90 days was one "event",
//    and the page then grouped again by (name | type | date) with a date field that never existed (all dates = bucket 0).
//    IDs are now built from the issuer, the real publication day and the document link of the event's EARLIEST item (or the
//    SEC filing chain), so they are stable across rebuilds, and two different deals never share one.
//  - S02: tickers taken from headlines ("PTI", "CNBC", "SPV", "EIM") were shown as companies, market was guessed from ticker
//    length, and FILED came from "tradeability". Identity now has to be confirmed in a security list (NSE symbol list / US
//    ticker list / alias table), the market comes from that list, and FILED needs an actual exchange or SEC filing document.
//
// Pure: no I/O, no Node-only imports (the page and home use the same helpers).

import { TICKER_STOP_WORDS, matchCompanies, defaultAliasIndex, normalizeCompanyName, type AliasIndex } from './company-alias';
import { NSE_TICKER_NAMES } from './nse-ticker-names';

export const FINAL_CONTRACT_VERSION = 'zzz1066-v1';

// ─── stable hash (client-safe, deterministic) ─────────────────────────────────────────────────────────────────────────────
/** 12 hex characters from two independent 32-bit FNV-1a passes. Deterministic across server and browser. */
export function stableHash(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + 0x9e), 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

/** A document link without tracking parameters, fragment or trailing slash; host lower-cased. */
export function normaliseLink(link: string | null | undefined): string {
  const raw = String(link || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const keep = new URLSearchParams();
    u.searchParams.forEach((v, k) => { if (!/^(utm_|ref$|src$|source$|feed|cmp$|from$)/i.test(k)) keep.append(k, v); });
    const q = keep.toString();
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${q ? `?${q}` : ''}`;
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

const dayOf = (iso: string | null | undefined): string => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
};
const normKey = (s: string | null | undefined): string => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface CanonicalIdInput {
  eventType: string;
  /** listed issuer ticker or name; blank / unresolved issuers still get a unique id from the document link */
  issuerKey?: string | null;
  /** SEC chain (form family + subject CIK / name): original filing and its amendments share one id */
  secChain?: string | null;
  pubDate?: string | null;
  link?: string | null;
  title?: string | null;
}

/**
 * Canonical event id. SEC chains key on the chain only (amendments link to the original). Everything else keys on event type +
 * issuer + publication day + document link, so a blank issuer never merges with another event and two different deals for the
 * same issuer stay apart. Syndicated copies of one story are merged BEFORE this (by the clusterer); the id is then taken from
 * the earliest item of the merged group, so it does not change when newer copies arrive.
 */
export function specSitCanonicalId(a: CanonicalIdInput): string {
  const type = String(a.eventType || 'UNCLASSIFIED').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (a.secChain) return `SS_SEC_${stableHash(`sec|${a.secChain}`)}`;
  const doc = normaliseLink(a.link) || `title:${normKey(a.title).slice(0, 160)}`;
  const issuer = normKey(a.issuerKey) || 'unresolved';
  return `SS_${type}_${stableHash(`${type}|${issuer}|${dayOf(a.pubDate) || 'nodate'}|${doc}`)}`;
}

/** The earliest item of a merged group (by publication time, then link): the id anchor. Undated items sort last. */
export function earliestItem<T extends { pub_date?: string | null; link?: string | null; title?: string | null }>(items: ReadonlyArray<T>): T | null {
  let best: T | null = null;
  let bestT = Infinity;
  for (const it of items) {
    const t = it?.pub_date ? Date.parse(it.pub_date) : NaN;
    const tv = Number.isFinite(t) ? t : Infinity;
    if (!best || tv < bestT || (tv === bestT && `${it.link || ''}|${it.title || ''}` < `${best.link || ''}|${best.title || ''}`)) { best = it; bestT = tv; }
  }
  return best;
}

// ─── S02: issuer identity ────────────────────────────────────────────────────────────────────────────────────────────────
export type IdentityState = 'RESOLVED' | 'UNRESOLVED';
export type Market = 'IN' | 'US';
export interface SpecSitIdentity {
  state: IdentityState;
  /** the company named by the source (may be unresolved) */
  name: string | null;
  /** set ONLY when confirmed in a security list */
  ticker: string | null;
  market: Market | null;
  exchange: string | null;
  basis: string;
  /** headline tokens that were offered as tickers and refused (publisher, deal vehicle, not in any list) */
  rejected?: string[];
}

/**
 * Words that are never an issuer ticker in this feed, even when a headline puts them in ticker position: wire services and
 * broadcasters (PTI, CNBC), deal vehicles (SPV), funding / process words (QIP, OFS), regulators and tribunals.
 */
export const NON_ISSUER_TOKENS: ReadonlySet<string> = new Set([
  'PTI', 'ANI', 'IANS', 'UNI', 'CNBC', 'CNN', 'BBC', 'WSJ', 'FT', 'ET', 'BS', 'AP', 'AFP', 'REUTERS', 'BLOOMBERG', 'MINT', 'NYT',
  'SPV', 'SPVS', 'JV', 'JVS', 'MOU', 'LOI', 'LOA', 'QIP', 'OFS', 'IPO', 'FPO', 'NCD', 'NCDS', 'FCCB', 'ECB', 'ESOP', 'REIT', 'INVIT',
  'IRP', 'RP', 'CIRP', 'OTP', 'OTS', 'NCLT', 'NCLAT', 'DRT', 'SEBI', 'RBI', 'CCI', 'SEC', 'FDA', 'USFDA', 'FTC', 'DOJ', 'IBC',
  'CEO', 'CFO', 'MD', 'ED', 'CMD', 'BOARD', 'AGM', 'EGM', 'NSE', 'BSE', 'NYSE', 'NASDAQ', 'GST', 'PSU', 'MSME', 'EV', 'EVS',
]);

export interface SecurityLookups {
  /** NSE symbol list (EQUITY_L / symbol master). Unknown list → null. */
  nseHasTicker?: (t: string) => boolean;
  /** normalised company name → NSE symbol */
  nseByName?: (normName: string) => string | null;
  /** US ticker list (SEC / Nasdaq). */
  usHasTicker?: (t: string) => boolean;
  usByName?: (normName: string) => string | null;
  /** alias table (curated names + NSE names); default: the static one */
  aliasIndex?: AliasIndex;
  /** true when the full lists were loaded (else only the static tables are checked; said in the basis) */
  nseListLoaded?: boolean;
  usListLoaded?: boolean;
}

const STATIC_NSE = new Set(Object.keys(NSE_TICKER_NAMES));
const cleanTicker = (t: string | null | undefined): string => String(t || '').trim().toUpperCase().replace(/^(NSE|BSE|NASDAQ|NYSE)\s*:\s*/, '').replace(/\.(NS|BO)$/, '');

/** Market from the text when the source does not name an exchange: rupee / crore / Indian regulators → IN; feed region otherwise. */
export function marketHintOf(text: string, region?: string | null): Market | null {
  const t = String(text || '');
  if (/₹|\bRs\.?\s?\d|\bINR\b|\bcrores?\b|\blakh\b|\bSEBI\b|\bNSE\b|\bBSE\b|\bNCLT\b|\bPvt\.? Ltd\b/i.test(t)) return 'IN';
  if (region === 'IN') return 'IN';
  if (region === 'US') return 'US';
  if (/\bNYSE\b|\bNasdaq\b|\bSEC\b|\$\s?\d/.test(t)) return 'US';
  return null;
}

export interface IdentityInput {
  /** the issuer / subject name the adapter found ('Not identified' when none) */
  name?: string | null;
  /** tickers the feed or headline offered (untrusted) */
  candidateTickers?: ReadonlyArray<string | null | undefined>;
  /** the adapter's entity resolution (a CIK / explicit exchange-tag resolution is trusted) */
  entity?: { state?: string; ticker?: string | null; exchange?: string | null; basis?: string | null } | null;
  title?: string;
  description?: string;
  region?: string | null;
  /** source / publisher label: a ticker equal to a publisher word is refused */
  sourceLabel?: string | null;
}

const US_EXCH = /^(?:NYSE|NASDAQ|NYSE ?AMERICAN|NYSE ?ARCA|AMEX|CBOE|OTC)/i;

/** Resolves the issuer to a listed security, or says plainly that it is unresolved. Never invents a ticker. */
export function resolveSpecSitIssuer(inp: IdentityInput, lk: SecurityLookups = {}): SpecSitIdentity {
  const text = `${inp.title || ''} ${inp.description || ''}`;
  const hint = marketHintOf(text, inp.region);
  const rawName = String(inp.name || '').replace(/\s+/g, ' ').trim();
  const name = !rawName || /^(not identified|unnamed company|unknown company)$/i.test(rawName) ? null : rawName;
  const pubWords = new Set(String(inp.sourceLabel || '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 2));
  const nseHas = (t: string) => STATIC_NSE.has(t) || !!lk.nseHasTicker?.(t);
  const usHas = (t: string) => !!lk.usHasTicker?.(t);
  const rejected: string[] = [];
  const nameIsToken = (n: string | null) => !!n && /^[A-Z0-9&.-]{2,8}$/.test(n) && (NON_ISSUER_TOKENS.has(n.toUpperCase()) || pubWords.has(n.toUpperCase()));

  // 1. a resolution the adapter made from the filing header (CIK) or an explicit exchange tag in the source is trusted
  const en = inp.entity;
  if (en && en.state === 'RESOLVED' && en.ticker && /filing header CIK|explicit ticker tag|SEC ticker map/i.test(en.basis || '')) {
    const t = cleanTicker(en.ticker);
    const ex = en.exchange || null;
    const market: Market | null = ex && /NSE|BSE/i.test(ex) ? 'IN' : ex && US_EXCH.test(ex) ? 'US' : /CIK|SEC/i.test(en.basis || '') ? 'US' : hint;
    if (!NON_ISSUER_TOKENS.has(t)) return { state: 'RESOLVED', name: name || t, ticker: t, market, exchange: ex, basis: en.basis || 'filing header' };
  }

  // 2. offered tickers: each must be a real listed security (and not a publisher / vehicle word)
  const offered = Array.from(new Set([en?.ticker, ...(inp.candidateTickers || [])].map(cleanTicker).filter(Boolean)));
  for (const t of offered) {
    if (NON_ISSUER_TOKENS.has(t) || pubWords.has(t)) { rejected.push(t); continue; }
    const inN = nseHas(t), inU = usHas(t);
    if (!inN && !inU) { rejected.push(t); continue; }
    const market: Market = inN && inU ? (hint === 'US' ? 'US' : 'IN') : inN ? 'IN' : 'US';
    if (hint && market !== hint && !(inN && inU)) { rejected.push(t); continue; }
    return { state: 'RESOLVED', name: name || t, ticker: t, market, exchange: market === 'IN' ? 'NSE' : null, basis: market === 'IN' ? 'NSE symbol list' : 'US ticker list', ...(rejected.length ? { rejected } : {}) };
  }

  // 3. the issuer name in a security list
  const nn = name && !nameIsToken(name) ? normalizeCompanyName(name) : '';
  if (nn) {
    if (hint !== 'US') { const t = lk.nseByName?.(nn) || null; if (t) return { state: 'RESOLVED', name, ticker: t, market: 'IN', exchange: 'NSE', basis: 'company name in the NSE symbol list', ...(rejected.length ? { rejected } : {}) }; }
    if (hint !== 'IN') { const t = lk.usByName?.(nn) || null; if (t) return { state: 'RESOLVED', name, ticker: t, market: 'US', exchange: null, basis: 'company name in the US ticker list', ...(rejected.length ? { rejected } : {}) }; }
  }

  // 4. exactly one listed company named in the headline (alias table); several = ambiguous, not guessed
  const idx = lk.aliasIndex || defaultAliasIndex();
  const hits = matchCompanies(inp.title || '', idx).filter((m) => m.confidence >= 0.7 && !NON_ISSUER_TOKENS.has(m.ticker) && !pubWords.has(m.ticker) && (m.market === 'IN' || m.market === 'US'));
  const uniq = Array.from(new Map(hits.map((m) => [m.ticker, m])).values());
  const fitting = uniq.filter((m) => !hint || m.market === hint);
  if (fitting.length === 1) {
    const m = fitting[0];
    const mn = normalizeCompanyName(m.matched);
    const isSubject = !nn || mn === nn || nn.startsWith(`${mn} `) || mn.startsWith(`${nn} `);
    const basis = isSubject
      ? `company named in the headline ("${m.matched}", alias table)`
      : `the only listed company named in the headline ("${m.matched}"); the headline subject "${name}" is not a listed security`;
    return { state: 'RESOLVED', name: m.matched, ticker: m.ticker, market: m.market as Market, exchange: m.market === 'IN' ? 'NSE' : null, basis, ...(rejected.length ? { rejected } : {}) };
  }

  const lists = [lk.nseListLoaded ? 'NSE symbol list' : 'NSE names table (full list not loaded)', lk.usListLoaded ? 'US ticker list' : 'US list not loaded'].join(', ');
  const why = rejected.length ? `refused ${rejected.join(', ')} (publisher, deal vehicle or not a listed symbol); ` : '';
  return { state: 'UNRESOLVED', name: name && !nameIsToken(name) ? name : null, ticker: null, market: hint, exchange: null, basis: `${why}no listed security found (${lists})`, ...(rejected.length ? { rejected } : {}) };
}

/**
 * Security lookups from listing rows (NSE EQUITY_L / symbol master; SEC / Nasdaq list). Name match = exact normalised name, or
 * a unique listed name that starts with the (2+ word) source name ("Ola Electric" → "Ola Electric Mobility"). Pure.
 */
export function buildSecurityLookups(a: { nseRows?: ReadonlyArray<{ symbol: string; name?: string | null }> | null; usRows?: ReadonlyArray<{ ticker: string; name?: string | null }> | null; aliasIndex?: AliasIndex }): SecurityLookups {
  const mk = (rows: ReadonlyArray<{ t: string; n: string }>) => {
    const tickers = new Set<string>();
    const names = new Map<string, Set<string>>();
    for (const r of rows) {
      const t = cleanTicker(r.t);
      if (!t) continue;
      tickers.add(t);
      const n = r.n ? normalizeCompanyName(r.n) : '';
      if (n) names.set(n, (names.get(n) || new Set()).add(t));
    }
    const sorted = Array.from(names.keys()).sort();
    const byName = (q: string): string | null => {
      const exact = names.get(q);
      if (exact) return exact.size === 1 ? Array.from(exact)[0] : null;
      if (q.split(' ').length < 2) return null;
      const hits = new Set<string>();
      // binary search to the first name >= q, then walk while the prefix holds
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < q) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < sorted.length && sorted[i].startsWith(q); i++) {
        if (sorted[i] !== q && !sorted[i].startsWith(`${q} `)) continue;
        for (const t of names.get(sorted[i])!) hits.add(t);
        if (hits.size > 1) return null;
      }
      return hits.size === 1 ? Array.from(hits)[0] : null;
    };
    return { has: (t: string) => tickers.has(cleanTicker(t)), byName, size: tickers.size };
  };
  const nse = a.nseRows && a.nseRows.length ? mk(a.nseRows.map((r) => ({ t: r.symbol, n: r.name || '' }))) : null;
  const us = a.usRows && a.usRows.length ? mk(a.usRows.map((r) => ({ t: r.ticker, n: r.name || '' }))) : null;
  return {
    nseHasTicker: nse ? nse.has : undefined, nseByName: nse ? nse.byName : undefined,
    usHasTicker: us ? us.has : undefined, usByName: us ? us.byName : undefined,
    aliasIndex: a.aliasIndex, nseListLoaded: !!nse, usListLoaded: !!us,
  };
}

// ─── S02: provenance ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type Provenance = 'FILED' | 'REPORTED';
/** An actual exchange / SEC filing document (not a news page, not a company press-release wire). */
export const FILING_DOC_RE = /^(?:https?:\/\/)?(?:www\.)?(?:sec\.gov\/(?:Archives|cgi-bin\/browse-edgar|ix\?|edgar)|[a-z0-9.-]*bseindia\.com\/|[a-z0-9.-]*nseindia\.com\/|nsearchives\.nseindia\.com\/|archives\.nseindia\.com\/)/i;
export const isFilingDocUrl = (u: string | null | undefined): boolean => !!u && FILING_DOC_RE.test(String(u).trim());

export function provenanceOf(a: { links: ReadonlyArray<string | null | undefined>; primaryDocumentUrl?: string | null; confirmed: boolean }): { provenance: Provenance; basis: string; url: string | null } {
  const filed = a.links.find((l) => isFilingDocUrl(l));
  if (filed) return { provenance: 'FILED', basis: 'The source is an exchange / SEC filing document.', url: String(filed) };
  if (a.confirmed && isFilingDocUrl(a.primaryDocumentUrl)) return { provenance: 'FILED', basis: 'The company filing for this event was found and checked.', url: String(a.primaryDocumentUrl) };
  return { provenance: 'REPORTED', basis: 'Reported in the news; no exchange or SEC filing document is linked yet.', url: null };
}

// ─── final record (one per final event) ──────────────────────────────────────────────────────────────────────────────────
export type EvidenceState = 'CONFIRMED' | 'PENDING';
export const TERM_LABEL: Record<string, string> = {
  offer_price: 'Offer price', consideration_type: 'Consideration type', reference_price: 'Reference price', premium_or_discount: 'Premium / discount',
  minimum_tender: 'Minimum tender', maximum_tender: 'Maximum tender', expiry_date: 'Expiry date', settlement: 'Settlement', financing: 'Financing',
  regulatory_approvals: 'Regulatory approvals', purchase_price: 'Purchase price (total)', target_revenue: 'Target revenue', target_ebitda: 'Target EBITDA',
  multiple: 'Valuation multiple', new_shares_or_dilution: 'New shares / dilution', expected_close: 'Expected completion', exchange_ratio: 'Exchange ratio',
  shares_issued: 'Shares issued', ownership_split: 'Ownership split', approvals: 'Approvals', record_date: 'Record date', ratio: 'Ratio',
  listing_date: 'Listing date', business_transferred: 'Business transferred', debt_cash_allocation: 'Debt / cash allocation', size: 'Programme size (total)',
  pct_of_market_cap: '% of market cap', method: 'Method', funding: 'Funding', price: 'Price per share', consideration_per_share: 'Consideration per share',
  buyer_group: 'Buyer group', vote_condition: 'Vote condition', fairness_opinion: 'Fairness opinion', amount_per_share: 'Amount per share',
};
export const termLabel = (k: string): string => TERM_LABEL[k] || k.replace(/_/g, ' ');

export interface SpecSitFinalMeta {
  id: string;
  contract: string;
  evidence_state: EvidenceState;
  evidence_basis: string;
  pending_reason: string | null;
  provenance: Provenance;
  provenance_basis: string;
  /** the filing document when FILED, else the news link */
  source_url: string | null;
  source_label: string | null;
  issuer: SpecSitIdentity;
  roles: { issuer: string | null; acquirer: string | null; target: string | null; line: string | null };
  terms_kind: string | null;
  reported_terms: Array<{ field: string; label: string; value: string }>;
  /** raw sourced fields (for the deal maths; never playbook numbers) */
  terms_fields: Record<string, string>;
  missing_fields: string[];
  last_checked: string | null;
  linked_records: number;
  amendments: number;
  event_date: string | null;
  /** pre-zzz1066 id, so a user's MONITOR notes keyed on the old id still show */
  legacy_ids?: string[];
}

export interface FinalRecordInput {
  ev: {
    event_id: string; event_type?: string; region?: string | null; tickers?: string[]; amendment_count?: number; target_name?: string;
    primary_filing?: { title?: string; link?: string; source?: string; description?: string; pub_date?: string } | null;
    filings?: Array<{ link?: string; pub_date?: string; source?: string }>;
    verification_pending?: { reason?: string; reasonText?: string } | null;
    aiVerification?: { checkedAt?: string | null; status?: string } | null;
    primaryDocument?: { url?: string | null; filedAt?: string | null; primaryVerifiedFrom?: string | null } | null;
    legacy_event_id?: string | null;
  };
  /** the radar adapter's input for this event (entity, roles, terms) */
  input?: {
    company?: string; entity?: IdentityInput['entity']; sourceLabel?: string;
    dealRoles?: { acquirer?: string | null; target?: string | null; subject?: string | null; roleLine?: string | null } | null;
    dealTerms?: { kind?: string; fields?: Record<string, string>; missing?: string[] } | null;
    eventHeadlineKind?: string | null;
    sourceSubject?: { role?: string | null; counterparty?: string | null } | null;
  } | null;
  /** primary-document check passed (company's own words carry the terms) */
  primaryVerified: boolean;
  /** when the feed / check ran (the "last checked" time for primary-verified items) */
  checkedAt?: string | null;
}

const ACQ_TARGET_RE = /^(.{2,80}?)\s+(?:to\s+)?(?:acquires?|acquiring|to acquire|buys?|to buy|completes? (?:the )?acquisition of|takeover of|bid for)\s+(?:a\s+)?(?:\d+(?:\.\d+)?\s?%\s+(?:stake\s+)?(?:in\s+)?)?(.{2,80}?)(?:\s+(?:for|in|at|from|via|worth)\b|[;:,]|$)/i;

/** Acquirer / target from a headline when the filing roles are not known ('X to acquire 26% stake in Y for …'). */
export function headlineRoles(title: string): { acquirer: string | null; target: string | null } {
  const t = String(title || '').replace(/[’']s\b/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(ACQ_TARGET_RE);
  if (m) return { acquirer: m[1].trim() || null, target: m[2].replace(/^(?:stake in|the)\s+/i, '').trim() || null };
  const tk = t.match(/^(.{2,60}?)\s+shareholders approve\s+(.{2,60}?)\s+(?:takeover|acquisition|offer|bid)/i);
  if (tk) return { acquirer: tk[2].trim(), target: tk[1].trim() };
  return { acquirer: null, target: null };
}

export function buildFinalMeta(a: FinalRecordInput, lk: SecurityLookups = {}): SpecSitFinalMeta {
  const ev = a.ev;
  const pf = ev.primary_filing || {};
  const inp = a.input || {};
  const issuer = resolveSpecSitIssuer({
    name: inp.company || ev.target_name || null, candidateTickers: ev.tickers || [], entity: inp.entity || null,
    title: pf.title, description: pf.description, region: ev.region, sourceLabel: inp.sourceLabel || pf.source || null,
  }, lk);
  const pending = ev.verification_pending || null;
  const confirmed = !pending && (a.primaryVerified || !!ev.primaryDocument?.url || /confirm/i.test(String(ev.aiVerification?.status || '')));
  const evidence_state: EvidenceState = confirmed ? 'CONFIRMED' : 'PENDING';
  const evidence_basis = confirmed
    ? (ev.aiVerification ? 'Checked against the company document (AI check confirmed it).' : ev.primaryDocument?.url ? 'The company filing found for this event states the terms.' : 'The primary source itself states the terms.')
    : (pending?.reasonText || 'Not checked yet against the company document.');
  const links = [pf.link, ...((ev.filings || []).map((f) => f?.link))];
  const prov = provenanceOf({ links, primaryDocumentUrl: ev.primaryDocument?.url || null, confirmed });
  const roles0 = inp.dealRoles || null;
  const hr = headlineRoles(pf.title || '');
  const acquirer = roles0?.acquirer || hr.acquirer || null;
  const target = roles0?.target || hr.target || null;
  const roles = {
    issuer: issuer.name, acquirer, target,
    line: roles0?.roleLine || (acquirer || target ? [acquirer ? `Acquirer: ${acquirer}` : null, target ? `Target: ${target}` : null].filter(Boolean).join(' → ') : null),
  };
  const fields = { ...(inp.dealTerms?.fields || {}) };
  const reported_terms = Object.entries(fields).map(([k, v]) => ({ field: k, label: termLabel(k), value: v }));
  const missing_fields = (inp.dealTerms?.missing || []).map(termLabel);
  const dates = [pf.pub_date, ...((ev.filings || []).map((f) => f?.pub_date))].filter((d) => d && Number.isFinite(Date.parse(String(d)))) as string[];
  const event_date = dates.length ? dates.sort()[0] : null;
  const last_checked = pending ? null : (ev.aiVerification?.checkedAt || a.checkedAt || null);
  return {
    id: ev.event_id, contract: FINAL_CONTRACT_VERSION, evidence_state, evidence_basis, pending_reason: pending ? (pending.reason || 'queued') : null,
    provenance: prov.provenance, provenance_basis: prov.basis, source_url: prov.url || pf.link || null, source_label: pf.source || null,
    issuer, roles, terms_kind: inp.dealTerms?.kind || null, reported_terms, terms_fields: fields, missing_fields, last_checked,
    linked_records: Math.max(1, (ev.filings || []).length), amendments: Number(ev.amendment_count) || 0, event_date,
    ...(ev.legacy_event_id && ev.legacy_event_id !== ev.event_id ? { legacy_ids: [ev.legacy_event_id] } : {}),
  };
}

// ─── the final set and its counts ─────────────────────────────────────────────────────────────────────────────────────────
export interface FinalCounts {
  total: number;
  confirmed: number;
  pending: number;
  /** held back from the final set: contradicted, expired, quarantined, awaiting (not shown) */
  archived: number;
  archived_by_reason: Record<string, number>;
  by_tier: Record<string, number>;
  by_region: Record<string, number>;
  by_market: Record<string, number>;
}

export function finalCountsOf(final: ReadonlyArray<{ tier?: string; region?: string | null; final: SpecSitFinalMeta }>, held: ReadonlyArray<{ quarantine_reason?: string | null; merged_into?: string | null }>): FinalCounts {
  const c: FinalCounts = { total: final.length, confirmed: 0, pending: 0, archived: 0, archived_by_reason: {}, by_tier: {}, by_region: {}, by_market: {} };
  for (const e of final) {
    if (e.final.evidence_state === 'CONFIRMED') c.confirmed += 1; else c.pending += 1;
    const t = e.tier || 'NOISE'; c.by_tier[t] = (c.by_tier[t] || 0) + 1;
    const r = e.region || 'GLOBAL'; c.by_region[r] = (c.by_region[r] || 0) + 1;
    const m = e.final.issuer.market || 'UNKNOWN'; c.by_market[m] = (c.by_market[m] || 0) + 1;
  }
  for (const h of held) {
    if (h.merged_into) continue; // a merged copy is part of a final event, not archived
    const r = String(h.quarantine_reason || 'HELD_BACK');
    c.archived += 1; c.archived_by_reason[r] = (c.archived_by_reason[r] || 0) + 1;
  }
  return c;
}

/** Reasons that keep an event out of the final set for good (never shown as a final card). */
export const ARCHIVED_REASONS: ReadonlySet<string> = new Set(['AI_CONTRADICTED', 'VERIFICATION_EXPIRED', 'COURT_CASE_REPORT', 'FUND_REPURCHASE_OFFER', 'PARTNERSHIP_UNIT_REPURCHASE', 'DEBT_TENDER', 'ROUTINE_ISSUER_TENDER', 'ISSUER_TENDER_TERMS_NOT_READ', 'EXCLUDED_FROM_EQUITY_RADAR', 'AWAITING_VERIFICATION']);

// ─── home summary rows (home and full page read the same identity) ───────────────────────────────────────────────────────
export interface HomeSpecSitRow {
  id: string;
  label: string;
  ticker: string | null;
  name: string | null;
  resolved: boolean;
  market: Market | null;
  provenance: Provenance;
  evidence: EvidenceState;
  event_type: string;
  headline: string;
  announced_at: string | null;
  source_url: string | null;
  href: string;
}

export function homeRowsFromFinal(final: ReadonlyArray<{ event_id: string; event_type?: string; tier?: string; primary_filing?: { title?: string; pub_date?: string; link?: string } | null; final?: SpecSitFinalMeta | null }>, limit = 12): HomeSpecSitRow[] {
  const tierRank: Record<string, number> = { TIER_1: 0, TIER_2: 1, WATCHLIST: 2, NOISE: 3 };
  const rows: Array<HomeSpecSitRow & { _t: number; _r: number }> = [];
  for (const e of final || []) {
    const f = e?.final;
    if (!f) continue;
    const id = f.issuer;
    const label = id.ticker || id.name || 'Unresolved issuer';
    const href = id.state === 'RESOLVED' && id.ticker
      ? `/stock-sheet?ticker=${encodeURIComponent(id.ticker)}${id.market ? `&market=${id.market}` : ''}`
      : `/special-situations?tab=all&event=${encodeURIComponent(e.event_id)}`;
    const at = f.event_date || e.primary_filing?.pub_date || null;
    rows.push({
      id: e.event_id, label, ticker: id.state === 'RESOLVED' ? id.ticker : null, name: id.name, resolved: id.state === 'RESOLVED', market: id.market,
      provenance: f.provenance, evidence: f.evidence_state, event_type: String(e.event_type || 'CORPORATE_ACTION'),
      headline: String(e.primary_filing?.title || '').replace(/\s+/g, ' ').trim().slice(0, 140), announced_at: at, source_url: f.source_url, href,
      _t: at ? Date.parse(at) || 0 : 0, _r: tierRank[String(e.tier)] ?? 3,
    });
  }
  // filed first, then confirmed, then tier, then newest
  rows.sort((a, b) => (a.provenance === b.provenance ? 0 : a.provenance === 'FILED' ? -1 : 1) || (a.evidence === b.evidence ? 0 : a.evidence === 'CONFIRMED' ? -1 : 1) || a._r - b._r || b._t - a._t);
  return rows.slice(0, limit).map(({ _t, _r, ...r }) => { void _t; void _r; return r; });
}
