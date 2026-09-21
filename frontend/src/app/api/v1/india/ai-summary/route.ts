// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA AI SUMMARY — WHICH DID NOT EXIST.                       (zzz700)
//
// The US card has had a written reading of the release for months. The India
// card never has. The 📝 line under an India result LOOKS like one and is not:
// it is assembled by `lib/earnings/grader.ts` from the tier and three growth
// percentages, so it can only ever restate numbers already on the card. Every
// question an owner actually asks next — why did the margin move, what capex
// is being built and when does it earn, how full are the plants, how big is
// the order book, what in this quarter will not repeat — had no answer on the
// India side at all.
//
// THE SCHEMA IS NOT COPIED, IT IS SHARED. `lib/earnings/ai-summary-shared`
// holds the tool schema, the base prompt and the figure verifier, and both
// markets import them. Two copies of a prompt drift exactly the way the two
// copies of the grader drifted, and far more quietly: nothing fails, the two
// cards simply stop answering the same question.
//
// WHAT IS GENUINELY DIFFERENT HERE, and therefore lives in this file:
//
//   · THE DOCUMENT. There is no EDGAR. An India result is a PDF attached to
//     an exchange filing, found through the same CF worker the forward-guidance
//     route already uses, and read with the same `extractFirstPdf`.
//   · THE FILING IS OFTEN NOT THE RESULT. An Indian company files an
//     intimation of the board meeting, a newspaper advertisement and an
//     outcome letter around the same date. Spending a model call on an
//     intimation produces a confident summary of a notice about a meeting.
//     `looksLikeIndiaResults` refuses those by content, not by filename.
//   · THE CURRENCY. Figures are in rupees and crores, and the prompt says so,
//     because a model that silently reads "1,053" as millions will produce a
//     summary whose every number is wrong by two orders of magnitude.
//
// IT IS HONEST WHEN IT CANNOT ANSWER. No attachment, an image-only scan, or a
// document that is not a result each return a plain explanation rather than a
// summary of whatever text happened to come back.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { extractFirstPdf } from '@/lib/pdf-text-extractor';
import {
  SUMMARY_TOOL, SYSTEM_BASE,
  moneyTokens, numeralsIn, supported, pctTokens, valuesIn, supportedPct,
} from '@/lib/earnings/ai-summary-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = 'claude-haiku-4-5-20251001';
const PROMPT_VERSION = 'india-ai-summary-v7';  // zzz720 — structural block: capacity, demand, customers, volume/price/mix, balance, risks, targets
const TTL_S = 365 * 24 * 3600;
const MAX_CHARS = 140_000;
const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://mc-scraper.radhev-232.workers.dev';

// The India addendum to the shared prompt. Everything else — the field
// discipline, the no-invented-figures rule, the beat/miss prohibition — is
// identical to the US reading by construction.
const SYSTEM = `${SYSTEM_BASE}

THIS IS AN INDIAN LISTED COMPANY'S QUARTERLY RESULT.
- Figures are in Indian rupees, and usually in CRORE or LAKH. Copy every number in the unit the document prints it in and name that unit ("Rs 1,053 crore", "Rs 61 crore"). Never convert between crore, lakh, million and billion, and never drop the unit.
- The document is an exchange filing. It may contain a covering letter, a SEBI regulation reference and an auditor's limited-review report before the figures begin. Ignore all of it. Read the statement of financial results and any management commentary or press release attached to it.
- Indian results are commonly presented for the quarter AND the corresponding quarter of the previous year AND the preceding quarter. Compare against the CORRESPONDING QUARTER OF THE PREVIOUS YEAR unless the document itself highlights the sequential comparison, and say which one you used.
- "Other income" is a separate line in an Indian P&L and is frequently large. If profit grew much faster than operating profit, check other income, finance cost, tax and exceptional items, and name the line in margin_bridge.where_in_pnl.
- Consolidated and standalone results are often filed together. Prefer CONSOLIDATED. If you read standalone because that is all the document contains, say so in not_disclosed.
- Order book, capacity and utilisation are disclosed far more often by Indian companies than by US ones, frequently in an investor presentation attached to the same filing. Fill those fields when the document gives them.
- There is no analyst consensus in this document. Never describe anything as a beat or a miss.`;

/**
 * Is this actually a statement of results, or one of the notices filed
 * alongside it? Decided on CONTENT: an intimation of a board meeting names the
 * meeting and nothing else, and carries none of the line items below.
 */
function looksLikeIndiaResults(t: string): boolean {
  const s = (t || '').toLowerCase();
  if (s.length < 1200) return false;
  // An intimation or a newspaper advertisement, with no figures behind it.
  const noticeOnly = /(intimation|notice is hereby given|newspaper (advertisement|publication))/i.test(s)
    && !/total income|revenue from operations/i.test(s);
  if (noticeOnly) return false;
  const markers = [
    /revenue from operations/i,
    /total income/i,
    /profit (before|after) tax/i,
    /earnings? per (equity )?share/i,
    /(un)?audited financial results/i,
    /other income/i,
    /total expenses/i,
  ].filter((re) => re.test(s)).length;
  return markers >= 3;
}

interface CFFilingItem {
  symbol: string;
  subject: string;
  filing_date: string;
  attachment_url?: string;
}

/** Subjects that carry the numbers, best first. */
const RESULTS_SUBJECT = [
  /financial\s+results/i,
  /outcome\s+of\s+(the\s+)?board\s+meeting/i,
  /investor\s+(presentation|update)/i,
  /press\s+release/i,
  /earnings\s+(update|presentation)/i,
];
/** Subjects that are never the result, however close their date. */
const NOT_RESULTS = /(intimation|newspaper|trading window|compliance certificate|voting result|scrutinizer|scrutiniser|annual report|postal ballot|\\bagm\\b|\\begm\\b|analyst meet|investor meet|schedule of|certificate under regulation|share transfer|loss of share|duplicate share|credit rating|record date|dividend distribution|related party|corporate governance report|shareholding pattern|reconciliation of share capital)/i;

async function loadFilings(): Promise<CFFilingItem[]> {
  try {
    const res = await fetch(`${CF_WORKER_URL}/api/results/latest`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const j = await res.json();
    const arr = Array.isArray(j) ? j : (j?.items || j?.data || j?.results || []);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** The attachments for this ticker, ranked: results subjects first, then by
 *  proximity to the filing date we were given. */
function rankAttachments(all: CFFilingItem[], ticker: string, filingDate?: string | null): string[] {
  const sym = ticker.toUpperCase();
  const mine = all.filter((f) => String(f?.symbol || '').toUpperCase() === sym && f?.attachment_url);
  const wantMs = filingDate ? Date.parse(`${filingDate}T00:00:00Z`) : NaN;
  // ── THE SUBJECT LIES; THE FILENAME USUALLY DOES NOT.           (zzz705)
  //
  // Live on the first request: Divgi returned
  // "DTTS_Voting_Results_Final_Submission_signed.pdf" — a voting-results
  // filing, which `NOT_RESULTS` already lists and which was matched anyway,
  // because the exclusion was tested against the feed's `subject` field while
  // the word "Voting_Results" only ever appeared in the URL. The exchange
  // feed's subjects are frequently generic ("Announcement under Regulation
  // 30"), so the filename is the more reliable of the two and both are now
  // read. The downstream content check caught this one and refused honestly —
  // but refusing a document we could have avoided fetching is a wasted round
  // trip and, worse, hides the real results PDF sitting further down the list.
  const score = (f: CFFilingItem): number => {
    const subj = String(f.subject || '');
    const file = decodeURIComponent(String(f.attachment_url || '')).replace(/[_-]+/g, ' ');
    const hay = `${subj} ${file}`;
    if (NOT_RESULTS.test(hay)) return -1;
    const idx = RESULTS_SUBJECT.findIndex((re) => re.test(hay));
    return idx < 0 ? 50 : idx;              // unknown subjects rank after known ones
  };
  return mine
    .map((f) => ({ f, s: score(f) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => {
      if (a.s !== b.s) return a.s - b.s;
      if (!Number.isNaN(wantMs)) {
        const da = Math.abs(Date.parse(`${a.f.filing_date}T00:00:00Z`) - wantMs);
        const db = Math.abs(Date.parse(`${b.f.filing_date}T00:00:00Z`) - wantMs);
        if (da !== db) return da - db;
      }
      return String(b.f.filing_date).localeCompare(String(a.f.filing_date));
    })
    .map((x) => x.f.attachment_url!)
    .slice(0, 6);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  const quarter = (searchParams.get('quarter') || '').trim();
  const filingDate = (searchParams.get('filing_date') || '').slice(0, 10) || null;
  const force = searchParams.get('force') === '1';
  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'ticker is required' }, { status: 400 });
  }

  const key = `india-ai-summary:${PROMPT_VERSION}:${ticker}:${quarter || filingDate || 'latest'}`;
  if (!force) {
    try {
      const hit = await kvGet<any>(key);
      if (hit?.structured) return NextResponse.json({ ok: true, cached: true, ...hit });
    } catch { /* a cold cache is not an error */ }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'The summary service is not configured on this deployment.' });
  }

  const filings = await loadFilings();
  if (!filings.length) {
    return NextResponse.json({
      ok: false,
      error: 'The exchange-filing feed could not be reached, so there is no document to read. It is polled every few minutes; try again shortly.',
    });
  }
  const urls = rankAttachments(filings, ticker, filingDate);
  if (!urls.length) {
    return NextResponse.json({
      ok: false,
      error: `No results attachment is on file for ${ticker}. Indian companies sometimes file only an outcome letter with the figures inside the PDF body, and sometimes nothing machine-readable at all.`,
    });
  }

  const ext = await extractFirstPdf(urls);
  if (!ext || !ext.text || ext.text.length < 1200) {
    return NextResponse.json({
      ok: false,
      error: 'The filed PDF could not be read as text — it is most likely a scanned image, which this reader does not OCR. Nothing is summarised rather than guessed.',
    });
  }
  const text = ext.text.slice(0, MAX_CHARS);
  if (!looksLikeIndiaResults(text)) {
    return NextResponse.json({
      ok: false,
      error: 'The document on file for this date is not a statement of results — most likely an intimation or a notice. It was not summarised.',
      source_url: (ext as any).url || urls[0],
    });
  }

  // ── The model call. Forced tool use, so the shape is guaranteed. ────────
  let data: any = null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM,
        tools: [SUMMARY_TOOL],
        tool_choice: { type: 'tool', name: SUMMARY_TOOL.name },
        messages: [{ role: 'user', content: `${ticker}${quarter ? ` — ${quarter}` : ''}\n\n${text}` }],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: `The summary service returned HTTP ${resp.status}.` });
    }
    const j = await resp.json();
    const call = (j?.content || []).find((c: any) => c?.type === 'tool_use' && c?.name === SUMMARY_TOOL.name);
    data = call?.input || null;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `The summary service did not answer (${String(e?.message || e)}).` });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: 'The summary service answered without filing a result.' });
  }

  // ── VERIFICATION — the identical gate the US reading goes through. ──────
  //
  // Per field, not per answer: one unsupported figure costs its own item and
  // the rest of the reading survives.
  const inRelease = numeralsIn(text);
  const releaseValues = valuesIn(text);
  const dropped: string[] = [];
  const clean = (s: any): boolean => {
    const v = typeof s === 'string' ? s : '';
    if (!v) return true;
    const badMoney = moneyTokens(v).filter((f) => !supported(f, inRelease));
    if (badMoney.length) { dropped.push(badMoney[0]); return false; }
    const badPct = pctTokens(v).filter((p) => !supportedPct(p, releaseValues));
    if (badPct.length) { dropped.push(`${badPct[0].v}%`); return false; }
    return true;
  };
  const keepItems = (arr: any): any[] =>
    (Array.isArray(arr) ? arr : []).filter((it) =>
      typeof it === 'string' ? clean(it) : clean(it?.detail) && clean(it?.label));

  const posBefore = Array.isArray(data.positives) ? data.positives.length : 0;
  data.positives = keepItems(data.positives);
  data.negatives = keepItems(data.negatives);
  data.segments = keepItems(data.segments);
  data.new_business = keepItems(data.new_business);
  data.watch_next = keepItems(data.watch_next);
  data.not_disclosed = keepItems(data.not_disclosed);
  if (!clean(data.mix_shift)) data.mix_shift = '';
  if (!clean(data.management)) data.management = '';
  if (!clean(data.verdict_line)) data.verdict_line = '';
  if (data.guidance && !clean(data.guidance.detail)) data.guidance.detail = '';
  for (const k of ['capex', 'buyback', 'dividend', 'debt']) {
    if (data.capital && !clean(data.capital[k])) data.capital[k] = '';
  }
  data.catalysts = (Array.isArray(data.catalysts) ? data.catalysts : [])
    .filter((c: any) => clean(c?.title) && clean(c?.size_vs_company));
  data.capex_projects = (Array.isArray(data.capex_projects) ? data.capex_projects : [])
    .filter((c: any) => clean(c?.amount) && clean(c?.capacity_added) && clean(c?.name));
  data.one_offs = (Array.isArray(data.one_offs) ? data.one_offs : [])
    .filter((o: any) => clean(o?.amount) && clean(o?.item));
  if (data.margin_bridge) {
    if (!clean(data.margin_bridge.opm_change_pp)) data.margin_bridge.opm_change_pp = '';
    data.margin_bridge.drivers = (Array.isArray(data.margin_bridge.drivers) ? data.margin_bridge.drivers : [])
      .filter((d: any) => clean(d?.detail));
  }
  for (const k of ['current', 'prior', 'expected', 'expected_by', 'basis']) {
    if (data.utilisation && !clean(data.utilisation[k])) data.utilisation[k] = '';
  }
  for (const k of ['closing_value', 'growth', 'order_inflow', 'book_to_bill', 'execution_period', 'concentration']) {
    if (data.order_book && !clean(data.order_book[k])) data.order_book[k] = '';
  }
  if (!clean(data.operating_leverage_evidence)) data.operating_leverage_evidence = '';

  // ── THE v7 STRUCTURAL BLOCK GOES THROUGH THE SAME GATE.        (zzz720)
  //
  // Every figure on this portal is checked against the source text before it
  // is shown, and the structural fields are the ones most worth inventing: a
  // utilisation percentage, a capacity figure, an order-intake number. Adding
  // them to the schema without adding them here would have created exactly
  // the hole the rest of the file exists to close — and a fabricated
  // utilisation is worse than a missing one, because downstream a stated
  // figure counts as CHECKED and drives a positive verdict.
  //
  // Per field, not per answer: one unsupported figure blanks its own field
  // and the rest of the reading survives.
  for (const grp of ['capacity', 'demand', 'customers', 'volume_price_mix', 'balance', 'risks'] as const) {
    const o = (data as any)[grp];
    if (!o || typeof o !== 'object') continue;
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'string' && !clean(o[k])) o[k] = '';
    }
  }
  if (!clean((data as any).capex_earning)) (data as any).capex_earning = '';
  if (Array.isArray((data as any).management_targets)) {
    (data as any).management_targets = (data as any).management_targets
      .filter((t: any) => clean(t?.target) && clean(t?.metric));
  }


  if (!data.positives.length && !data.negatives.length && !data.verdict_line) {
    return NextResponse.json({
      ok: false,
      error: `The summary cited figures that do not appear in the filing (${dropped.slice(0, 3).join(', ')}), so it was discarded rather than shown.`,
    });
  }
  if (posBefore >= 3 && data.positives.length < posBefore * 0.5) {
    return NextResponse.json({
      ok: false,
      error: `Most of the summary's figures could not be found in the filing (${dropped.slice(0, 3).join(', ')}), so it was discarded rather than shown in part.`,
    });
  }

  const payload = {
    structured: data,
    source_url: (ext as any).url || urls[0],
    model: MODEL,
    ticker,
    quarter: quarter || null,
    chars_read: text.length,
    dropped_figures: dropped.slice(0, 5),
  };
  try { await kvSet(key, payload, TTL_S); } catch { /* the reading is still good uncached */ }
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
