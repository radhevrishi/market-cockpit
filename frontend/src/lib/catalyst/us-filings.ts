// ═══════════════════════════════════════════════════════════════════════════
// US "New · last 10 days" — every SEC filing in the window, by its metadata.
//                                                                    (zzz825)
//
// The US thesis ledger only files the documents it reads for the thesis
// (8-K 2.02 earnings, 1.01 / 7.01 / 8.01 catalysts, 10-Q / 10-K). An officer
// change (5.02), an acquisition closing (2.01), an unregistered sale (3.02) or
// an offering prospectus (424B / S-3) never reached the tab. The route
// /api/v1/catalyst/us-filings lists the SEC submissions (metadata only — form,
// items, date, link; no document is opened there) and this pure adapter turns
// them into the tab's RawEvents. The card model types them by 8-K item
// (recent-events usSubjectClass) and gives them the US evidence chains
// (event-card chainSpec). A filing already in the ledger (same accession) is
// not listed twice.
// ═══════════════════════════════════════════════════════════════════════════

import type { RawEvent, ThesisCtx } from './recent-events';

/** One SEC filing, as the route answers it. */
export interface UsFilingMeta {
  ticker: string;
  /** Plain subject: "8-K: Director / officer change [Item 5.02]" / "424B5: Prospectus". */
  subject: string;
  /** The filing's primary document on sec.gov. */
  url: string | null;
  /** ISO date or datetime of the filing. */
  date: string | null;
}

/** "0001213900-26-060470" or its bare form → the bare 18 digits, from a sec.gov address. */
export function accessionOf(url: string | null | undefined): string | null {
  const m = /\/Archives\/edgar\/data\/\d+\/(\d{18})\//i.exec(String(url || '')) || /(\d{10})-(\d{2})-(\d{6})/.exec(String(url || ''));
  if (!m) return null;
  return m.length === 4 ? `${m[1]}${m[2]}${m[3]}` : m[1];
}

/** Pure: the subject without the route's " · filed 16:05 ET after the close" tail. */
export function usSubjectPlain(subject: string): string {
  return String(subject || '').replace(/\s+·\s+filed\b.*$/i, '').replace(/\s+/g, ' ').trim();
}

/** Forms that are ownership paperwork or administrative — never an event on the tab. */
const SKIP_FORM = /^(?:[345](?:\/A)?|SC 13G(?:\/A)?|SCHEDULE 13G(?:\/A)?|S-8(?: POS)?|DEF 14A|DEFA14A|PRE 14A|ARS|CORRESP|UPLOAD|EFFECT|CERT\S*|8-A12[BG]|25-NSE|15-12[BG]|10-D|SD|11-K|424H|POS AM|RW)\b/i;
/** Periodic reports come through the ledger already (with their MD&A read). */
const LEDGER_FORM = /^(?:10-Q|10-K|20-F|40-F)(?:\/A)?\b/i;

/**
 * Pure: SEC filings → RawEvents for buildRecentCatalysts. `knownUrls` are the
 * document addresses already on the page (the ledger) — a filing whose
 * accession is among them is skipped.
 */
export function rawFromUsFilings(
  rows: UsFilingMeta[] | null | undefined,
  o: { companyOf?: (t: string) => string | null; ctxOf?: (t: string) => ThesisCtx | null; knownUrls?: Iterable<string | null | undefined> } = {},
): RawEvent[] {
  const known = new Set<string>();
  for (const u of o.knownUrls || []) { const a = accessionOf(u); if (a) known.add(a); }
  const out: RawEvent[] = [];
  const seen = new Set<string>();
  for (const r of rows || []) {
    if (!r || !r.ticker || !r.date) continue;
    const subject = usSubjectPlain(r.subject);
    const form = (subject.split(':')[0] || '').trim().toUpperCase();
    if (!subject || SKIP_FORM.test(form) || LEDGER_FORM.test(form)) continue;
    const acc = accessionOf(r.url);
    if (acc && known.has(acc)) continue;
    const k = `${r.ticker.toUpperCase()}|${acc || subject}|${String(r.date).slice(0, 10)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      ticker: r.ticker.toUpperCase(), company: o.companyOf ? o.companyOf(r.ticker) : null, date: r.date, title: subject,
      url: r.url || null, source: 'SEC EDGAR', badge: 'filed', origin: 'feed', ctx: o.ctxOf ? o.ctxOf(r.ticker) : null,
    });
  }
  return out;
}
