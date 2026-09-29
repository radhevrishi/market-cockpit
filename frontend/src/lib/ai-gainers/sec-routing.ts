// ═══════════════════════════════════════════════════════════════════════════
// US SOURCE HIERARCHY, SEC ITEM ROUTING, DEDUP AND FALLBACK.        (zzz785)
//
// Three rules this file encodes, each of which the US side broke before:
//
//   1. SOURCE HIERARCHY. An 8-K (and its EX-99.1 press release / EX-10.1
//      agreement) outranks a 10-Q/10-K, which outranks a prospectus / 6-K /
//      ownership report, which outranks the company's own IR release, which
//      outranks third-party press. Press is SECONDARY: verification required
//      until an official document states the same event.
//
//   2. AN SEC ITEM NUMBER IS A ROUTING HINT, NEVER THE CONCLUSION. "Item
//      1.01 Material Definitive Agreement" says a contract exists — it may
//      be a merger, a credit line or a customer order. The item decides
//      which document to open and what to look for; the WORDS in the
//      document decide the event (see us-extract.ts).
//
//   3. SECONDARY ≠ PRIMARY FAILURE. A Nasdaq/Google News miss is
//      SECONDARY_UNAVAILABLE; only a failure of EDGAR itself is
//      SOURCE_UNAVAILABLE. Retries back off; routes fall through in order.
//
// Everything here is pure except `withRetry` / `routeWithFallback`, which
// only call the functions they are given (so they are tested with fakes).
// ═══════════════════════════════════════════════════════════════════════════

import type { AnnouncementLite } from './catalyst-research';
import { exchangeDay, type EventKind, type SourceAccess, type SourceKind, type SourceRef } from './structured-facts';
import { usFormOf, usItemsOf } from './us-gainers';

// ── 1. HASH (sha1 of normalised text) ──────────────────────────────────────
// Pure JS so the module also loads in a client bundle (no node:crypto).

export function normaliseForHash(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/[^a-z0-9$%.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sha1Hex(input: string): string {
  const bytes: number[] = [];
  for (const ch of String(input)) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else { bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); c = 0; }
  }
  const ml = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(ml / 0x100000000), lo = ml >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let i = 0; i < bytes.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = (bytes[i + 4 * j] << 24) | (bytes[i + 4 * j + 1] << 16) | (bytes[i + 4 * j + 2] << 8) | bytes[i + 4 * j + 3];
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      const f = j < 20 ? (b & c) | (~b & d) : j < 40 ? b ^ c ^ d : j < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = j < 20 ? 0x5a827999 : j < 40 ? 0x6ed9eba1 : j < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (rotl(a, 5) + f + e + k + w[j]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/** The dedup hash the SourceRef contract asks for: sha1 of normalised text. */
export function textHash(text: string | null | undefined): string | null {
  const n = normaliseForHash(text || '');
  return n.length >= 20 ? sha1Hex(n) : null;
}

// ── 2. SOURCE REFS ─────────────────────────────────────────────────────────

/** "…/Archives/edgar/data/1653558/000165355826000045/x.htm" → "0001653558-26-000045". */
export function accessionFromUrl(url: string | null | undefined): string | null {
  const m = /\/Archives\/edgar\/data\/\d+\/(\d{18})\//i.exec(String(url || '')) || /\/(\d{10}-\d{2}-\d{6})(?:-index\.htm|\.txt)?/i.exec(String(url || ''));
  if (!m) return null;
  const raw = m[1].replace(/-/g, '');
  return raw.length === 18 ? `${raw.slice(0, 10)}-${raw.slice(10, 12)}-${raw.slice(12)}` : null;
}

/** CIK (unpadded) from an EDGAR archive URL. */
export function cikFromUrl(url: string | null | undefined): string | null {
  const m = /\/Archives\/edgar\/data\/(\d+)\//i.exec(String(url || ''));
  return m ? String(parseInt(m[1], 10)) : null;
}

export type SecDocRole = 'primary' | 'ex99' | 'ex10' | 'other';

/** Which exhibit an EDGAR file name is. */
export function secDocRoleOf(name: string, primaryName?: string | null): SecDocRole {
  const n = String(name || '').toLowerCase();
  if (primaryName && n === String(primaryName).toLowerCase()) return 'primary';
  if (/(ex|exhibit)[-_ .]?99/.test(n)) return 'ex99';
  if (/(ex|exhibit)[-_ .]?10(?!\d)/.test(n) || /(ex|exhibit)[-_ .]?10[-_ .]?\d/.test(n)) return 'ex10';
  return 'other';
}

export function secSourceRef(a: {
  issuer: string; form: string; items?: string[]; date: string | null; url?: string | null; title?: string | null;
  access: SourceAccess; text?: string | null; accession?: string | null; role?: SecDocRole;
}): SourceRef {
  // The form always leads, before a colon, so usFormOf(title) is the form.
  const role = a.role && a.role !== 'primary' ? (a.role === 'ex99' ? 'EX-99 press release' : a.role === 'ex10' ? 'EX-10 agreement' : 'exhibit') : '';
  const form = String(a.form || '').toUpperCase();
  const rest = a.title ? (usFormOf(a.title) === form ? a.title.slice(a.title.indexOf(':') + 1).trim() : a.title) : '';
  const title = `${form}${role || rest ? ': ' : ''}${role}${role && rest ? ' — ' : ''}${rest}`;
  return {
    kind: 'SEC_FILING', access: a.access, issuer: a.issuer, date: exchangeDay(a.date, 'US'),   // zzz835: the New York calendar day, not the UTC one
    accession: a.accession ?? accessionFromUrl(a.url), url: a.url ?? null,
    title: title.slice(0, 300), hash: textHash(a.text), secItems: a.items && a.items.length ? a.items : undefined,
    cik: cikFromUrl(a.url), formType: form || null, exhibit: exhibitNumberOf(a.url, a.role),
  };
}

/** "…/ex99-1.htm" -> "99.1"; null for the filing body. */
export function exhibitNumberOf(url: string | null | undefined, role?: SecDocRole): string | null {
  const name = String(url || '').split('/').pop() || '';
  // ex99-1.htm / ex-991.htm / d185059dex991.htm / exhibit99_1.htm -> 99.1 ; ex10-2.htm -> 10.2
  const m = /(?:ex|exhibit)[-_ .]?(99|10)(?:[-_.]?(\d{1,2}))?(?=\D|$)/i.exec(name);
  if (m) return m[2] ? `${m[1]}.${m[2]}` : m[1] === '99' ? '99.1' : '10';
  return role === 'ex99' ? '99.1' : null;
}

/** "Official SEC filing - Exhibit 99.1 press release": a press release attached to an 8-K is part of the filing, not "press only". */
export function secOfficialLabel(ref: Pick<SourceRef, 'kind' | 'formType' | 'exhibit' | 'date' | 'secItems' | 'accession'>): string {
  if (ref.kind !== 'SEC_FILING') return ref.kind === 'PRESS' ? 'Press - secondary, verification required' : 'Official source';
  const what = ref.exhibit ? (ref.exhibit.startsWith('99') ? `Exhibit ${ref.exhibit} press release` : `Exhibit ${ref.exhibit}`) : `${ref.formType || 'filing'} body${ref.secItems && ref.secItems.length ? ` (Item ${ref.secItems.join(', ')})` : ''}`;
  return `Official SEC filing - ${what}${ref.date ? `, filed ${ref.date}` : ''}${ref.accession ? ` - accession ${ref.accession}` : ''}`;
}

/** A listed EDGAR filing (subject line only — nothing opened yet). */
export function sourceRefFromAnnouncement(issuer: string, a: Pick<AnnouncementLite, 'subject' | 'url' | 'dateIso'>, access: SourceAccess = 'SUMMARY_ONLY'): SourceRef {
  return secSourceRef({ issuer, form: usFormOf(a.subject), items: usItemsOf(a.subject), date: a.dateIso, url: a.url, title: a.subject, access });
}

// Wire services carry the company's OWN release; anything else is third-party.
const WIRE_HOST = /(globenewswire|businesswire|prnewswire|accesswire|newsfilecorp|newsfile\.|einpresswire|marketwired|investors?\.|\bir\.)/i;
const WIRE_PUBLISHER = /^(globe ?newswire|business ?wire|pr ?newswire|accesswire|newsfile|cision|marketwired|company press release)$/i;

export interface UsPressItem { title: string; url: string | null; date: string | null; publisher: string | null; summary?: string | null }

/** COMPANY_IR (the company's own words, on a wire or IR site) vs PRESS. */
export function pressKindOf(item: Pick<UsPressItem, 'url' | 'publisher'>, companyHosts: string[] = []): 'COMPANY_IR' | 'PRESS' {
  const u = String(item.url || '').toLowerCase();
  const host = /^https?:\/\/([^/]+)/.exec(u)?.[1] || '';
  if (companyHosts.some((h) => h && host.endsWith(h.toLowerCase()))) return 'COMPANY_IR';
  if (WIRE_HOST.test(host)) return 'COMPANY_IR';
  if (WIRE_PUBLISHER.test(String(item.publisher || '').trim())) return 'COMPANY_IR';
  return 'PRESS';
}

export function pressSourceRef(issuer: string, item: UsPressItem, access: SourceAccess = 'SUMMARY_ONLY', companyHosts: string[] = []): SourceRef {
  return {
    kind: pressKindOf(item, companyHosts), access, issuer, date: item.date ? item.date.slice(0, 10) : null,
    accession: null, url: item.url, title: `${item.publisher ? `${item.publisher}: ` : ''}${item.title}`.slice(0, 300),
    hash: textHash(`${item.title} ${item.summary || ''}`),
  };
}

// ── 3. THE HIERARCHY ───────────────────────────────────────────────────────
// 1 = 8-K / 8-K/A (+ EX-99.1 / EX-10.1)   2 = 10-Q / 10-K / 20-F / 40-F
// 3 = 424B / S-1 / S-3 / F-1 / F-3 / 6-K / 13D / 13G / other SEC forms
// 4 = company IR / wire release           5 = third-party press

export function sourceRankOf(ref: Pick<SourceRef, 'kind' | 'title'>): number {
  if (ref.kind === 'PRESS') return 5;
  if (ref.kind === 'COMPANY_IR') return 4;
  if (ref.kind === 'SEC_FILING' || ref.kind === 'EXCHANGE_FILING' || ref.kind === 'SUBSIDIARY_FILING') {
    const f = usFormOf(ref.title);
    if (/^8-K/.test(f)) return 1;
    if (/^(10-Q|10-K|10-KT|20-F|40-F)(\/A)?$/.test(f)) return 2;
    return 3;
  }
  return 5;
}

export const SOURCE_RANK_LABEL: Record<number, string> = {
  1: 'SEC 8-K (current report + exhibits)', 2: 'SEC periodic report (10-Q / 10-K)',
  3: 'SEC registration / ownership / 6-K filing', 4: 'Company press release (IR / wire)', 5: 'Third-party press (secondary)',
};

/** Official = SEC filing or the company's own release; press is secondary. */
export function isOfficial(ref: Pick<SourceRef, 'kind'>): boolean { return ref.kind !== 'PRESS'; }

export function rankSources(refs: SourceRef[]): SourceRef[] {
  return refs.map((r, i) => ({ r, i })).sort((a, b) => sourceRankOf(a.r) - sourceRankOf(b.r) || a.i - b.i).map((x) => x.r);
}

// ── 4. SEC ITEMS AS ROUTING HINTS ──────────────────────────────────────────

export type ExtractFocus = 'deal' | 'debt' | 'dilution' | 'governance' | 'results' | 'stake' | 'resale' | 'offering' | 'general';

export interface SecRoute {
  form: string;
  items: string[];
  /** Open the document (and its exhibits) — the item alone decides nothing. */
  open: boolean;
  /** Exhibits worth reading beside the primary document. */
  exhibits: Array<'99.1' | '10.1'>;
  /** What the extractor looks for first. The document still decides. */
  focus: ExtractFocus[];
  /** The event kind the item SUGGESTS — a prior, never a conclusion. */
  hint: EventKind | null;
  /** False for items that are context, not a catalyst, even when true (5.02). */
  catalystByItself: boolean;
  note: string;
}

const ITEM_ROUTE: Record<string, { focus: ExtractFocus[]; hint: EventKind | null; exhibits: Array<'99.1' | '10.1'>; catalyst: boolean; note: string }> = {
  '1.01': { focus: ['deal', 'dilution', 'debt', 'general'], hint: null, exhibits: ['99.1', '10.1'], catalyst: true, note: 'Material agreement: open the 8-K body and exhibits — it may be a merger, a customer contract, a credit line or an equity sales (ATM) agreement.' },
  '1.02': { focus: ['deal', 'general'], hint: null, exhibits: ['99.1'], catalyst: true, note: 'Agreement terminated: open the filing for which agreement and why.' },
  '2.01': { focus: ['deal'], hint: 'acquisition', exhibits: ['99.1'], catalyst: true, note: 'Acquisition OR disposition completed: the document says which, and for what.' },
  '2.02': { focus: ['results'], hint: 'results', exhibits: ['99.1'], catalyst: true, note: 'Results: read the release for revenue and any outlook change.' },
  '2.03': { focus: ['debt'], hint: 'debt', exhibits: ['10.1', '99.1'], catalyst: false, note: 'Debt obligation: amount, rate and maturity if stated.' },
  '2.04': { focus: ['debt'], hint: 'debt', exhibits: ['99.1'], catalyst: false, note: 'Obligation accelerated: open for amount and trigger.' },
  '3.02': { focus: ['dilution'], hint: 'fundraising', exhibits: ['10.1', '99.1'], catalyst: false, note: 'Unregistered sale of equity: shares, price and buyers if stated.' },
  '5.01': { focus: ['deal'], hint: 'acquisition', exhibits: ['99.1'], catalyst: true, note: 'Change in control: open for who and on what terms.' },
  '5.02': { focus: ['governance'], hint: 'governance', exhibits: ['99.1'], catalyst: false, note: 'Officer / director change: who and which role — governance, not a catalyst by itself.' },
  '7.01': { focus: ['general', 'deal', 'results'], hint: null, exhibits: ['99.1'], catalyst: true, note: 'Regulation FD: the event is in the attached release — open EX-99.1.' },
  '8.01': { focus: ['general', 'deal', 'debt', 'dilution'], hint: null, exhibits: ['99.1'], catalyst: true, note: 'Other events: the event is in the body or EX-99.1 — open it.' },
};

export function routeSecFiling(formIn: string, itemsIn: string[] = []): SecRoute {
  const form = String(formIn || '').trim().toUpperCase();
  const items = itemsIn.filter((i) => /^\d\.\d\d$/.test(i));
  const base: SecRoute = { form, items, open: false, exhibits: [], focus: [], hint: null, catalystByItself: false, note: '' };
  if (/^8-K(\/A)?$/.test(form)) {
    const routes = items.filter((i) => i !== '9.01').map((i) => ITEM_ROUTE[i]).filter(Boolean);
    if (!routes.length) return { ...base, open: true, exhibits: ['99.1'], focus: ['general'], catalystByItself: true, note: 'No substantive item listed: open the filing.' };
    const focus = Array.from(new Set(routes.flatMap((r) => r.focus)));
    const exhibits = Array.from(new Set(routes.flatMap((r) => r.exhibits)));
    const hints = routes.map((r) => r.hint).filter(Boolean) as EventKind[];
    return { ...base, open: true, exhibits, focus, hint: hints.length === 1 ? hints[0] : null, catalystByItself: routes.some((r) => r.catalyst), note: routes.map((r) => r.note).join(' ') };
  }
  if (/^6-K(\/A)?$/.test(form)) return { ...base, open: true, exhibits: ['99.1'], focus: ['general', 'deal', 'results', 'dilution'], catalystByItself: true, note: 'Foreign issuer report: the substance is in the attached release.' };
  if (/^(10-Q|10-K|10-KT|20-F|40-F)$/.test(form)) return { ...base, open: false, focus: ['results'], hint: 'results', catalystByItself: true, note: 'Periodic report: results.' };
  if (/^(424B3|S-1|S-1\/A|F-1|F-1\/A|S-3|S-3\/A|S-3ASR|F-3|F-3\/A|F-3ASR)$/.test(form)) {
    return { ...base, open: true, focus: ['resale', 'offering'], hint: null, note: 'Registration / prospectus: the document says whether it is a resale by existing holders or a new raise.' };
  }
  if (/^424B\d$/.test(form)) return { ...base, open: true, focus: ['offering', 'resale'], hint: 'fundraising', note: 'Prospectus supplement: pricing, size and use of proceeds if stated.' };
  if (/^(SC 13D|SCHEDULE 13D|SC 13G|SCHEDULE 13G)(\/A)?$/.test(form)) return { ...base, open: true, focus: ['stake'], hint: 'stake_by_strategic', note: 'Beneficial ownership report: who holds what percentage — a strategic holder is a POTENTIAL catalyst, a fund is not.' };
  if (/^(425|S-4|S-4\/A|F-4|DEFM14A|PREM14A|SC TO-T|SC TO-T\/A|SC 14D9|SC 13E3)$/.test(form)) return { ...base, open: true, focus: ['deal'], hint: 'acquisition', catalystByItself: true, note: 'Merger / tender document: terms, financing and timing.' };
  return base;
}

// ── 5. DEDUP LEDGER: issuer + date + accession + text hash ─────────────────

export class DocumentLedger {
  private byHash = new Map<string, SourceRef>();
  private byDoc = new Map<string, SourceRef>();

  static docKey(r: SourceRef): string {
    return `${r.issuer.toUpperCase()}|${r.date || ''}|${r.accession || ''}|${String(r.url || '').toLowerCase()}`;
  }

  /** Adds a document. A second copy — the same text under another accession
   *  (8-K + DEFA14A), or the same accession/url again — is a duplicate. */
  add(r: SourceRef): { added: boolean; duplicateOf: SourceRef | null } {
    const hk = r.hash ? `${r.issuer.toUpperCase()}|${r.hash}` : null;
    if (hk && this.byHash.has(hk)) return { added: false, duplicateOf: this.byHash.get(hk)! };
    const dk = DocumentLedger.docKey(r);
    if ((r.accession || r.url) && this.byDoc.has(dk)) return { added: false, duplicateOf: this.byDoc.get(dk)! };
    if (hk) this.byHash.set(hk, r);
    this.byDoc.set(dk, r);
    return { added: true, duplicateOf: null };
  }

  size(): number { return this.byDoc.size; }
}

/** Refs with duplicates removed, hierarchy order kept. */
export function dedupeSources(refs: SourceRef[]): SourceRef[] {
  const l = new DocumentLedger();
  return rankSources(refs).filter((r) => l.add(r).added);
}

// ── 6. RETRY + FALLBACK ROUTING ────────────────────────────────────────────

export interface RetryOpts<T> {
  retries?: number;             // extra attempts after the first (default 2)
  baseMs?: number;              // first back-off (default 400 ms), ×3 each time
  maxMs?: number;               // cap on one back-off
  deadlineMs?: number;          // absolute epoch ms: never sleep past it
  retryOn?: (r: T) => boolean;  // a RESULT worth retrying (e.g. HTTP 429 / 5xx)
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs `fn` until it returns a non-retryable result or retries run out.
 *  A thrown error is retried too; the last error is re-thrown. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOpts<T> = {}): Promise<T> {
  const retries = o.retries ?? 2, base = o.baseMs ?? 400, max = o.maxMs ?? 4_000;
  const sleep = o.sleep ?? realSleep, now = o.now ?? Date.now;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: T | undefined; let threw = false;
    try { res = await fn(attempt); } catch (e) { lastErr = e; threw = true; }
    if (!threw && !(o.retryOn && o.retryOn(res as T))) return res as T;
    if (attempt === retries) { if (threw) throw lastErr; return res as T; }
    const wait = Math.min(max, base * Math.pow(3, attempt));
    if (o.deadlineMs != null && now() + wait >= o.deadlineMs) { if (threw) throw lastErr; return res as T; }
    await sleep(wait);
  }
  throw lastErr;
}

/** Retry an HTTP status: rate limits, server errors. 404 is an answer. */
export const retryableStatus = (s: number) => s === 429 || s === 403 || s === 408 || (s >= 500 && s <= 599);

export interface RouteStep<T> { name: string; tier: 'primary' | 'secondary'; run: () => Promise<T | null> }
export interface RouteAttempt { name: string; tier: 'primary' | 'secondary'; ok: boolean; error?: string }
export interface Routed<T> {
  value: T | null;
  from: string | null;
  fromTier: 'primary' | 'secondary' | null;
  attempts: RouteAttempt[];
  /** 'OK' when a primary route answered; SOURCE_UNAVAILABLE when every
   *  primary route failed (even if a secondary answered — that answer is
   *  secondary evidence only); SECONDARY_UNAVAILABLE when only secondary
   *  routes were asked and all failed. */
  status: 'OK' | 'SECONDARY_ONLY' | Extract<SourceAccess, 'SOURCE_UNAVAILABLE' | 'SECONDARY_UNAVAILABLE'>;
}

/** Tries each route in order and stops at the first that answers. */
export async function routeWithFallback<T>(steps: RouteStep<T>[]): Promise<Routed<T>> {
  const attempts: RouteAttempt[] = [];
  for (const s of steps) {
    try {
      const v = await s.run();
      if (v != null) {
        attempts.push({ name: s.name, tier: s.tier, ok: true });
        const primaryTried = steps.some((x) => x.tier === 'primary');
        const status = s.tier === 'primary' ? 'OK' : primaryTried ? 'SECONDARY_ONLY' : 'OK';
        return { value: v, from: s.name, fromTier: s.tier, attempts, status };
      }
      attempts.push({ name: s.name, tier: s.tier, ok: false, error: 'no data' });
    } catch (e: any) {
      attempts.push({ name: s.name, tier: s.tier, ok: false, error: String(e?.message || e).slice(0, 160) });
    }
  }
  const anyPrimary = steps.some((x) => x.tier === 'primary');
  return { value: null, from: null, fromTier: null, attempts, status: anyPrimary ? 'SOURCE_UNAVAILABLE' : 'SECONDARY_UNAVAILABLE' };
}

/** One plain line for the notes. Secondary failure is never "source unavailable". */
export function describeRouting(r: Pick<Routed<unknown>, 'status' | 'attempts' | 'from'>, what = 'filings'): string {
  const failed = r.attempts.filter((a) => !a.ok).map((a) => a.name);
  if (r.status === 'OK') return failed.length ? `${what} from ${r.from} (after ${failed.join(', ')} failed).` : `${what} from ${r.from}.`;
  if (r.status === 'SECONDARY_ONLY') return `SEC EDGAR unavailable (${failed.join(', ')}); ${what} shown are from ${r.from} — secondary, verification required.`;
  if (r.status === 'SECONDARY_UNAVAILABLE') return `Secondary source unavailable (${failed.join(', ')}) — this is not "no news" and not a primary-source failure.`;
  return `Source unavailable: ${failed.join(', ')} all failed — this is not "no filing".`;
}

// ── 7. PURE PARSERS FOR THE SECONDARY ROUTES ───────────────────────────────

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function isoDate(s: string | null | undefined): string | null {
  const t = Date.parse(String(s || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Google News / any RSS 2.0 feed → press items. */
export function parseRssItems(xml: string): UsPressItem[] {
  const out: UsPressItem[] = [];
  for (const m of String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const it = m[0];
    const tag = (t: string) => { const x = new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i').exec(it); return x ? decode(x[1]) : null; };
    const title = tag('title');
    if (!title) continue;
    const publisher = tag('source');
    out.push({ title: publisher && title.endsWith(` - ${publisher}`) ? title.slice(0, -(publisher.length + 3)) : title, url: tag('link'), date: isoDate(tag('pubDate')), publisher, summary: null });
  }
  return out;
}

/** Nasdaq press-release API JSON → press items. */
export function parseNasdaqPress(json: any): UsPressItem[] {
  const rows: any[] = json?.data?.rows || json?.data?.data?.rows || [];
  return rows.filter((r) => r && r.title).map((r) => ({
    title: decode(String(r.title)),
    url: r.url ? (String(r.url).startsWith('http') ? String(r.url) : `https://www.nasdaq.com${r.url}`) : null,
    date: isoDate(r.created || r.date || r.ago),
    publisher: r.publisher ? String(r.publisher) : null,
    summary: null,
  }));
}
