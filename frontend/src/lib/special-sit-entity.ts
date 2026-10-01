// zzz852 C/D - entity resolution. The legal entity in a filing, the listed issuer, the security and the ticker are
// separate fields. A ticker is set ONLY when state is RESOLVED. No fuzzy guessing: exact normalised name, a unique
// >=2-token prefix, an explicit '(NASDAQ: X)' tag directly after the name, a CIK match, or a data alias.
// No network calls here. Callers inject lookups (catalog, SEC ticker rows); the route may fill the SEC rows from a KV cache.

import type { EntityResolutionState, ResolvedEntity, SourceSubject } from './radar-owned-types';
import { isFundLikeName, isGroupName, parseSecFilingTitle, subjectFromHeadline } from './special-sit-feed-quality';
import { resolveCompanyToTicker } from './nse-ticker-names';
import { normName } from './special-sit-numbers';

export interface SecTickerRow { ticker: string; name: string; cik?: string | number; exchange?: string | null }
export interface UsLookup { byName: (norm: string) => SecTickerRow[]; byCik?: (cik: string) => SecTickerRow[]; allNames?: () => Array<{ norm: string; rows: SecTickerRow[] }> }
export interface EntityDeps {
  /** exact company-name -> NSE ticker (default: the repo's NSE catalog) */
  nseLookup?: (name: string) => string | undefined;
  usLookup?: UsLookup | null;
  aliases?: Record<string, FilerAlias>;
}
export interface FilerAlias { listedIssuer: string; ticker?: string; exchange?: string; security?: string }

/** Filing entity -> listed parent / security. DATA ONLY, empty by default. Key: normalised filer name (lower case, corporate words stripped, single spaces). */
export const SEC_FILER_ALIASES: Record<string, FilerAlias> = {};

const REGULATOR_RE = /\b(securities and exchange (?:commission|board)|sebi|sec\b|competition commission|federal trade commission|ftc|department of justice|doj|reserve bank|rbi|ministry of|government of|stock exchange commission|financial conduct authority|competition (?:and markets )?authority)\b/i;
const COURT_RE = /\b(securities appellate tribunal|high court|supreme court|district court|court of appeals?|tribunal|nclt|nclat|\bsat\b|bankruptcy court|court of chancery)\b/i;
const PRIVATE_RE = /\b(pvt\.?\s*ltd\.?|private limited|privately[- ]held|unlisted|private company)\b/i;

const EXCH_NAMES: Record<string, string> = { NASDAQ: 'Nasdaq', NYSE: 'NYSE', NYSEARCA: 'NYSE Arca', AMEX: 'NYSE American', 'NYSE AMERICAN': 'NYSE American', NSE: 'NSE', BSE: 'BSE', TSX: 'TSX', LSE: 'LSE' };
const TAG_RE = /\((NYSE American|NYSEARCA|NASDAQ|NYSE|AMEX|NSE|BSE|TSX|LSE)\s*[:\s]\s*([A-Z][A-Z0-9.]{0,6})\)/g;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ticker tag that sits directly after the entity name: 'Acme Corp. (NASDAQ: ACME)'. A tag that follows a different name is ignored. */
export function explicitTickerTag(text: string, name: string): { ticker: string; exchange: string } | null {
  const tags = Array.from((text || '').matchAll(TAG_RE));
  if (!tags.length || !name) return null;
  const re = new RegExp(`${esc(name.trim())}[\\s,]*(?:Inc\\.?|Incorporated|Corp\\.?|Corporation|plc|Ltd\\.?|Limited|LLC|Co\\.?|Company|N\\.V\\.|S\\.A\\.|Holdings)?\\s*(?:\\((?:NYSE American|NYSEARCA|NASDAQ|NYSE|AMEX|NSE|BSE|TSX|LSE)\\s*[:\\s]\\s*([A-Z][A-Z0-9.]{0,6})\\))`, 'i');
  const m = (text || '').match(re);
  if (!m) return null;
  const tag = tags.find((t) => t[2] === m[1] && (m.index || 0) + m[0].length >= (t.index || 0));
  if (!tag) return null;
  return { ticker: m[1], exchange: EXCH_NAMES[tag[1].toUpperCase()] || tag[1] };
}

/** SEC / EDGAR ticker payloads: {fields,data} (company_tickers_exchange.json) or {"0":{cik_str,ticker,title}} (company_tickers.json). Defensive: never throws. */
export function parseSecTickerPayload(payload: unknown): SecTickerRow[] {
  const rows: SecTickerRow[] = [];
  try {
    const p = payload as any;
    if (!p || typeof p !== 'object') return rows;
    if (Array.isArray(p.fields) && Array.isArray(p.data)) {
      const f: string[] = p.fields.map((x: unknown) => String(x).toLowerCase());
      const ci = f.indexOf('cik'), ni = f.indexOf('name'), ti = f.indexOf('ticker'), ei = f.indexOf('exchange');
      for (const r of p.data) if (Array.isArray(r) && r[ti] && r[ni]) rows.push({ ticker: String(r[ti]).toUpperCase(), name: String(r[ni]), cik: ci >= 0 ? r[ci] : undefined, exchange: ei >= 0 && r[ei] ? String(r[ei]) : null });
      return rows;
    }
    const arr: any[] = Array.isArray(p) ? p : Object.values(p);
    for (const r of arr) if (r && typeof r === 'object' && r.ticker && (r.title || r.name)) rows.push({ ticker: String(r.ticker).toUpperCase(), name: String(r.title || r.name), cik: r.cik_str ?? r.cik, exchange: r.exchange ? String(r.exchange) : null });
  } catch { /* defensive */ }
  return rows;
}

const normKey = (name: string): string => normName(name).join(' ');
const cikKey = (c: string | number | undefined): string => String(c ?? '').replace(/^0+/, '');

/** Index rows by normalised name and CIK. */
export function buildUsLookup(rows: ReadonlyArray<SecTickerRow>): UsLookup {
  const names = new Map<string, SecTickerRow[]>();
  const ciks = new Map<string, SecTickerRow[]>();
  for (const r of rows) {
    const k = normKey(r.name);
    if (k) names.set(k, [...(names.get(k) || []), r]);
    const c = cikKey(r.cik);
    if (c) ciks.set(c, [...(ciks.get(c) || []), r]);
  }
  return { byName: (n) => names.get(n) || [], byCik: (c) => ciks.get(cikKey(c)) || [], allNames: () => Array.from(names.entries()).map(([norm, r]) => ({ norm, rows: r })) };
}

export interface EntityInput {
  name: string;
  /** headline + description text, searched for explicit ticker tags */
  text?: string;
  cik?: string | null;
  /** a ticker the feed / headline already gave (kept as RESOLVED with its source as the basis) */
  knownTicker?: string | null;
  knownTickerBasis?: string | null;
  knownExchange?: string | null;
  viaParent?: string | null;
  isFundRepurchase?: boolean;
  isSecFiling?: boolean;
}

const mk = (name: string, state: EntityResolutionState, basis: string, extra: Partial<ResolvedEntity> = {}): ResolvedEntity => ({ legalEntity: name, listedIssuer: null, security: null, ticker: null, exchange: null, state, basis, ...extra });

function dedupeTickers(rows: SecTickerRow[]): SecTickerRow[] { const m = new Map<string, SecTickerRow>(); for (const r of rows) if (!m.has(r.ticker)) m.set(r.ticker, r); return Array.from(m.values()); }
function fromRows(name: string, rows: SecTickerRow[], basis: string): ResolvedEntity {
  const uniq = dedupeTickers(rows);
  if (uniq.length === 1) { const r = uniq[0]; return mk(name, 'RESOLVED', basis, { listedIssuer: r.name, security: 'Common stock', ticker: r.ticker, exchange: r.exchange ? (EXCH_NAMES[r.exchange.toUpperCase()] || r.exchange) : null, entityType: 'OPERATING_COMPANY' }); }
  return mk(name, 'RESOLVED_MULTIPLE', `${basis}; multiple listed securities: ${uniq.map((r) => r.ticker).join(', ')}`, { listedIssuer: uniq[0].name, entityType: 'OPERATING_COMPANY' });
}

/** Resolves one entity. Pure given its deps. */
export function resolveEntity(input: EntityInput, deps: EntityDeps = {}): ResolvedEntity {
  const name = (input.name || '').replace(/\s+/g, ' ').trim();
  if (!name || /^(?:not identified|unnamed company)$/i.test(name)) return mk(name || 'Not identified', 'UNRESOLVED', 'no entity name in the source', { entityType: 'UNKNOWN' });
  if (REGULATOR_RE.test(name)) return mk(name, 'NOT_APPLICABLE', 'regulator', { entityType: 'REGULATOR' });
  if (COURT_RE.test(name)) return mk(name, 'NOT_APPLICABLE', 'court / tribunal', { entityType: 'COURT' });
  if (input.isFundRepurchase || isFundLikeName(name)) return mk(name, 'NOT_APPLICABLE', 'fund / pooled vehicle', { entityType: 'FUND' });

  const tag = explicitTickerTag(input.text || '', name);
  if (tag) return mk(name, 'RESOLVED', 'explicit ticker tag in the source', { listedIssuer: name, security: 'Common stock', ticker: tag.ticker, exchange: tag.exchange, entityType: 'OPERATING_COMPANY' });

  if (input.knownTicker) return mk(name, 'RESOLVED', input.knownTickerBasis || 'ticker given by the feed or headline subject', { listedIssuer: input.viaParent || name, security: 'Common stock', ticker: input.knownTicker, exchange: input.knownExchange || null, entityType: 'OPERATING_COMPANY' });

  if (isGroupName(name)) return mk(name, 'NOT_APPLICABLE', 'group / promoter name, not one listed issuer', { entityType: 'GROUP' });
  if (PRIVATE_RE.test(name)) return mk(name, 'UNLISTED', 'name states a private company', { entityType: 'PRIVATE' });

  const nse = deps.nseLookup || resolveCompanyToTicker;
  const bare = name.replace(/\s+(?:Ltd\.?|Limited|Inc\.?|Corp\.?)$/i, '');
  const nt = nse(name) || nse(bare);
  if (nt) return mk(name, 'RESOLVED', 'company master (exact name)', { listedIssuer: name, security: 'Common stock', ticker: nt, exchange: 'NSE', entityType: 'OPERATING_COMPANY' });

  const us = deps.usLookup || null;
  if (us && input.cik) {
    const rows = us.byCik ? us.byCik(input.cik) : [];
    if (rows.length) return fromRows(name, rows, 'filing header CIK');
  }
  const key = normKey(name);
  const aliases = deps.aliases || SEC_FILER_ALIASES;
  const al = key ? aliases[key] : undefined;
  if (al) {
    const t = al.ticker || (us ? dedupeTickers(us.byName(normKey(al.listedIssuer)))[0]?.ticker : undefined) || nse(al.listedIssuer);
    return t ? mk(name, 'RESOLVED', 'filing entity -> listed issuer (alias table)', { listedIssuer: al.listedIssuer, security: al.security || 'Common stock', ticker: t, exchange: al.exchange || null, entityType: 'OPERATING_COMPANY' })
      : mk(name, 'UNRESOLVED', 'listed issuer known, security not identified', { listedIssuer: al.listedIssuer, entityType: 'OPERATING_COMPANY' });
  }
  if (us && key) {
    const exact = us.byName(key);
    if (exact.length) return fromRows(name, exact, 'SEC ticker map (exact normalised name)');
    if (key.split(' ').length >= 2 && us.allNames) {
      const pre = us.allNames().filter((x) => x.norm.startsWith(`${key} `));
      if (pre.length === 1) return fromRows(name, pre[0].rows, 'SEC ticker map (unique name prefix)');
    }
  }
  return mk(name, 'UNRESOLVED', 'no listed security found in the sources checked', { entityType: 'UNKNOWN' });
}

/** Precise card text for the entity state. Never the bare 'No ticker'. `attempted`=false means no lookup has run. */
export function tickerLabelFor(e: ResolvedEntity, attempted = true): string {
  switch (e.state) {
    case 'RESOLVED': return e.ticker ? `Ticker: ${e.ticker}${e.exchange ? ` (${e.exchange})` : ''}` : 'Listed - security not identified';
    case 'RESOLVED_MULTIPLE': return 'Listed - security not identified';
    case 'UNLISTED': return 'Unlisted / private';
    case 'NOT_APPLICABLE':
      return e.entityType === 'FUND' ? 'Not applicable (fund)' : e.entityType === 'REGULATOR' ? 'Not applicable (regulator)' : e.entityType === 'COURT' ? 'Not applicable (court / tribunal)' : e.entityType === 'GROUP' ? 'No listed ticker (group)' : 'Not applicable';
    default:
      if (e.listedIssuer) return 'Listed - security not identified';
      return attempted ? 'Not resolved - listed status unknown' : 'Not resolved yet';
  }
}

// ─── D. source subject ───────────────────────────────────────────────────────
const NAME_END = /\s+(?:for|at|in a|in an|via|from|to|on|after|amid|as|with|worth|valued|\||-|–|:)\s.*$|[,;(].*$/;
const ACQ_HEAD_RE = /^(.+?)\s+(?:to\s+(?:acquire|buy|purchase|take over)|acquires?|buys?|bought|agrees? to (?:acquire|buy|purchase)|completes? (?:the )?(?:acquisition|purchase) of|snaps? up|picks? up|takes? over|to take over)\s+(?:(?:a|an|the|about|around|up to|\d+(?:\.\d+)?\s?%|majority|minority|controlling|remaining|additional)\s+)*(?:stake\s+(?:of\s+[\w.]+\s+)?in\s+|shares\s+in\s+)?(.+)$/i;
const BET_RE = /(?:[Rr][Ss]\.?|₹|inr|\$|us\$|€|£)\s?[\d,.]+\s?(?:lakh crores?|crores?|cr|million|mn|billion|bn)?\s+((?:[A-Z][\w&.'’-]*\s?){1,4}?)\s+(?:bet|acquisition|buyout|deal|buy)\b/;
const ACTION_VERB_TAIL = /\s+(?:declares?|announces?|approves?|recommends?|reports?|posts?|bags?|wins?|secures?|raises?|cuts?|hikes?|proposes?|launches?|plans?|signs?|completes?)\b.*$/i;
const cleanName = (s: string): string => s.replace(/\s+/g, ' ').replace(/['\u2019]s\b.*$/, '').replace(NAME_END, '').replace(/^(?:the|a|an)\s+/i, '').replace(/['’]s$/i, '').replace(/[.,;:\s]+$/, '').trim();

/** Who the headline is about, who is bought, and whose numbers belong to whom. Names only, no inference beyond headline grammar. */
export function deriveSourceSubject(args: { title: string; company: string; filerCompany?: string | null; secRole?: string | null; secForm?: string | null }): SourceSubject {
  const title = (args.title || '').replace(/\s+/g, ' ').trim();
  const sec = parseSecFilingTitle(title);
  const company = args.company && !/^not identified$/i.test(args.company) ? args.company : '';
  const form = (args.secForm || sec?.form || '').toUpperCase();
  if (sec) {
    const subject = sec.company;
    const filer = args.filerCompany && args.filerCompany !== subject ? args.filerCompany : null;
    if (/TO-T|13E-?3|14D-?9/.test(form) && filer) return { eventSubject: filer, target: subject, sourceSubject: subject, financialOwner: subject };
    if (/\bfiled by\b/i.test(sec.role || '')) return { eventSubject: subject, sourceSubject: subject };
    return { eventSubject: subject, sourceSubject: subject, financialOwner: subject };
  }
  const m = title.match(ACQ_HEAD_RE);
  if (m) {
    const acquirer = cleanName(m[1].replace(/['’]s$/i, '')) || company;
    const target = cleanName(m[2]);
    if (acquirer && target) return { eventSubject: acquirer, target, sourceSubject: acquirer, financialOwner: acquirer };
  }
  const bet = title.match(BET_RE);
  const subj = cleanName((subjectFromHeadline(title) || company).replace(ACTION_VERB_TAIL, '')) || company;
  if (bet && subj) return { eventSubject: subj, target: cleanName(bet[1]), sourceSubject: subj, financialOwner: subj };
  return { eventSubject: subj || 'Not identified', sourceSubject: subj || 'Not identified', financialOwner: subj || undefined };
}

// ─── SEC ticker map loader (read-only, defensive, memory-cached) ─────────────
/** Existing-cache keys probed in order. Read only: this module never fetches from the network and never writes. */
export const SEC_TICKER_KV_KEYS: ReadonlyArray<string> = ['sec:company_tickers_exchange', 'sec:company_tickers', 'us:company_tickers_exchange', 'us:company_tickers'];
/** Returns an async loader: reads the first key that holds data, builds the index, keeps it in memory for ttlMs (default 6h). Never throws; null when nothing is cached. */
export function createSecLookupLoader(get: (key: string) => Promise<unknown>, keys: ReadonlyArray<string> = SEC_TICKER_KV_KEYS, ttlMs = 6 * 3600_000, now: () => number = Date.now) {
  let cached: { at: number; lookup: UsLookup | null } | null = null;
  return async function load(): Promise<UsLookup | null> {
    if (cached && now() - cached.at < ttlMs) return cached.lookup;
    let lookup: UsLookup | null = null;
    for (const k of keys) {
      try {
        const rows = parseSecTickerPayload(await get(k));
        if (rows.length) { lookup = buildUsLookup(rows); break; }
      } catch { /* a missing / unreachable cache is not an error */ }
    }
    cached = { at: now(), lookup };
    return lookup;
  };
}
