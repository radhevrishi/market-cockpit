// ═══════════════════════════════════════════════════════════════════════════
// COMPANY DOCUMENTS — CONCALL TRANSCRIPTS, PPTs, ANNUAL REPORTS.    (zzz726)
//
// The India evidence reader had exactly one source: the Cloudflare worker's
// exchange-filing feed. Checked live on 21 September, that feed held 2,751
// filings spanning 14–21 September ONLY — a rolling seven-day window. Every
// holding in the owner's book reported in August, so the reader answered "no
// results attachment is on file" for all fifty-one of them, and the day-level
// endpoint (`/api/results/day/2026-08-14`) returned zero because the worker's
// KV is not populated that far back either.
//
// So the reader was not broken. It was looking in the only place it knew, and
// that place structurally cannot hold a document more than a week old.
//
// screener.in's company page can. It carries the full concall history with
// direct BSE PDF links — for KMEW: a September 2026 transcript, a June 2026
// transcript and PPT, and so on back to 2022 — plus annual reports. It is
// public, needs no session, and answers in 165KB.
//
// WHY A TRANSCRIPT IS THE BETTER DOCUMENT ANYWAY, not merely the available
// one. The v7 structural block asks for capacity, utilisation, order intake,
// commissioning dates and management targets. A results PDF is a statement of
// financials and usually contains none of those. A concall transcript is forty
// minutes of management being asked precisely those questions by analysts. The
// exchange feed was the weaker source that happened to be wired first.
//
// WHAT TRAVELS WITH EVERY DOCUMENT: its kind and its date. A transcript from
// June read as though it were this quarter's would be a quietly wrong answer,
// so the caller is always told which document it got.
// ═══════════════════════════════════════════════════════════════════════════

import { fetchScreenerHtml } from './screener-fetch';

export type DocKind = 'transcript' | 'ppt' | 'annual_report' | 'other';

export interface CompanyDoc {
  kind: DocKind;
  url: string;
  /** As screener prints it: "Sep 2026". Null when unlabelled. */
  period: string | null;
  /** First of the month, for ordering. Null when unparseable. */
  periodIso: string | null;
  label: string;
}

export interface CompanyDocs {
  docs: CompanyDoc[];
  url: string;
  error: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function toIso(period: string | null): string | null {
  if (!period) return null;
  const m = /([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(period);
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  return `${m[2]}-${String(mo).padStart(2, '0')}-01`;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/**
 * Read a company's document list from its public screener.in page.
 *
 * Audio recordings (`REC`) are deliberately excluded: this pipeline reads
 * text and has no transcription step, so returning an mp3 as a readable
 * document would produce a failure two layers downstream with a misleading
 * error. Better to not offer it.
 */
/** NSE series suffixes (-BE, -SM, -BZ, -ST …) are how the exchange marks a
 *  trade-for-trade or SME segment; screener.in keys the company page on the
 *  bare symbol and answers 404 to the suffixed one. MTARTECH-BE and
 *  IFBAGRO-BE in the book both 404'd for exactly this reason. (zzz739) */
export function screenerSymbol(ticker: string): string {
  return ticker.toUpperCase().trim().replace(/-(BE|BZ|SM|ST|BL|IL|GS|SZ|E1|N[0-9A-Z])$/, '');
}

export async function fetchCompanyDocs(ticker: string): Promise<CompanyDocs> {
  const url = `https://www.screener.in/company/${encodeURIComponent(screenerSymbol(ticker))}/`;
  // zzz729 — through the proxy chain, for the same reason the gainers screen
  // is: screener.in answers a laptop and refuses a datacenter IP.
  const got = await fetchScreenerHtml(url);
  if (!got.html) return { docs: [], url, error: got.error };
  const html = got.html;

  return { ...parseCompanyDocs(html), url };
}

/** Pure: company-page HTML in, ranked documents out. Exported so the parse
 *  can be tested against a captured page with no network. */
export function parseCompanyDocs(html: string): { docs: CompanyDoc[]; error: string | null } {
  const docs: CompanyDoc[] = [];
  const seen = new Set<string>();
  const push = (kind: DocKind, href: string, period: string | null, label: string) => {
    if (!href || seen.has(href)) return;
    // Only PDFs this pipeline can actually read. An .mp3 or a YouTube link is
    // a real document and an unreadable one.
    if (!/bseindia\.com|nseindia\.com|\.pdf/i.test(href)) return;
    if (/\.(mp3|wav|m4a)(\?|$)/i.test(href) || /youtu/i.test(href)) return;
    seen.add(href);
    docs.push({ kind, url: href, period, periodIso: toIso(period), label });
  };

  // The concall block is a list of rows, each headed by a period and carrying
  // Transcript / PPT / Notes / REC links. Parsed row by row so a transcript
  // can never be paired with the wrong quarter's date.
  for (const m of html.matchAll(/<li[^>]*>([\s\S]{0,1400}?)<\/li>/g)) {
    const row = m[1];
    if (!/Transcript|PPT|Notes/i.test(row)) continue;
    const text = decode(strip(row));
    const pm = /([A-Za-z]{3}[a-z]*\s+\d{4})/.exec(text);
    const period = pm ? pm[1] : null;
    for (const a of row.matchAll(/<a[^>]+href="([^"]+)"[^>]*>\s*([^<]{1,24})/g)) {
      const href = decode(a[1]);
      const label = decode(a[2]);
      if (/transcript/i.test(label)) push('transcript', href, period, `Concall transcript ${period || ''}`.trim());
      else if (/^ppt$/i.test(label.trim())) push('ppt', href, period, `Investor presentation ${period || ''}`.trim());
    }
  }

  // Annual reports sit outside the concall list.
  for (const a of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>\s*(Annual Report[^<]{0,20})/gi)) {
    const label = decode(a[2]);
    const ym = /(\d{4})/.exec(label);
    push('annual_report', decode(a[1]), ym ? `Mar ${ym[1]}` : null, label);
  }

  docs.sort((a, b) => String(b.periodIso || '').localeCompare(String(a.periodIso || '')));
  return {
    docs,
    error: docs.length ? null : 'no readable documents listed on the screener.in company page',
  };
}

/**
 * The best document to read for a quarter, in the order that actually answers
 * the structural questions.
 *
 * A TRANSCRIPT first, and not as a fallback: the fields this portal wants —
 * utilisation, capacity, order intake, commissioning dates, management targets
 * — are what analysts spend a concall asking about, and are usually absent
 * from a results PDF entirely. The presentation is second because it carries
 * the same content in slides. The annual report is last: it is a year old the
 * day it is published.
 *
 * `near` is the filing date of the quarter in question. A document from within
 * roughly a quarter of it is the right one; anything older is returned only
 * when nothing closer exists, and the caller is told its date either way.
 */
export function pickDocument(docs: CompanyDoc[], near?: string | null): CompanyDoc | null {
  if (!docs.length) return null;
  const nearMs = near ? Date.parse(near) : NaN;
  const score = (d: CompanyDoc): number => {
    const kindRank = d.kind === 'transcript' ? 0 : d.kind === 'ppt' ? 1 : 2;
    let ageRank = 9;
    if (Number.isFinite(nearMs) && d.periodIso) {
      const days = Math.abs(Date.parse(d.periodIso) - nearMs) / 86_400_000;
      ageRank = days <= 120 ? 0 : days <= 240 ? 1 : 2;
    } else if (d.periodIso) {
      ageRank = 0;                    // no reference date: newest already sorted first
    }
    return ageRank * 10 + kindRank;
  };
  return [...docs].sort((a, b) => score(a) - score(b))[0] || null;
}
