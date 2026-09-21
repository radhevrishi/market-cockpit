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
import { discoverEvidence, selectForReading, type DocCandidate } from '@/lib/thesis/evidence-discovery';
import { extractStructuralEvents, type StructuralEvent, type ExtractionPipeline } from '@/lib/thesis/evidence-extract';
import {
  SUMMARY_TOOL, SYSTEM_BASE,
  moneyTokens, numeralsIn, supported, pctTokens, valuesIn, supportedPct,
} from '@/lib/earnings/ai-summary-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = 'claude-haiku-4-5-20251001';
const PROMPT_VERSION = 'india-ai-summary-v8';  // zzz738 — structural events stage  // zzz720 — structural block: capacity, demand, customers, volume/price/mix, balance, risks, targets
const TTL_S = 365 * 24 * 3600;
const MAX_CHARS = 140_000;
/** How many documents one company may cost. Each is a model-budget PDF
 *  download plus its share of the context window; three covers the results
 *  filing, the presentation and the concall, which answer different
 *  questions. (zzz737) */
const MAX_DOCS = 3;
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

async function fetchFeed(path: string): Promise<CFFilingItem[]> {
  try {
    const res = await fetch(`${CF_WORKER_URL}${path}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const j = await res.json();
    const arr = Array.isArray(j) ? j : (j?.items || j?.data || j?.results || []);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/**
 * ── THE "LATEST" FEED IS A ROLLING WINDOW, AND IT IS OFF-SEASON.  (zzz724)
 *
 * Every India holding tested on 21 September answered "No results attachment
 * is on file" — KMEW, MARKSANS, AVALON, GOODLUCK, DIVGIITTS, all of them.
 * Not one of them is missing a filing: they all reported in August, and the
 * worker's `/api/results/latest` is a ROLLING RECENT window that no longer
 * contains those dates. So the reader was looking in a feed that structurally
 * could not hold the document it wanted, and reported that as the company
 * having filed nothing machine-readable.
 *
 * That would have meant "Read evidence" failing on all 51 holdings — a button
 * whose whole purpose is to fill the thesis ledger, silently unable to.
 *
 * The worker already serves `/api/results/day/<date>`, and Portfolio
 * Catalysts already knows each holding's filing date from the graded row. So
 * when a filing date is supplied, that day is fetched too and merged. The
 * latest feed is still read first, because a company that filed again since
 * should be read at its newest document.
 *
 * NOT VERIFIED END-TO-END FROM HERE: the worker URL is a deployment secret
 * this container cannot read, so the day endpoint is called on the strength of
 * the worker's own source (cloudflare-worker/scraper.js, line 280) rather than
 * a live response. If it answers differently, the error text below says which
 * feed was searched rather than blaming the company.
 */
async function loadFilings(filingDate?: string | null): Promise<CFFilingItem[]> {
  const latest = await fetchFeed('/api/results/latest');
  if (!filingDate || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)) return latest;
  const day = await fetchFeed(`/api/results/day/${filingDate}`);
  if (!day.length) return latest;
  const seen = new Set(latest.map((f) => String(f?.attachment_url || '')));
  return [...latest, ...day.filter((f) => !seen.has(String(f?.attachment_url || '')))];
}

// rankAttachments lived here until zzz737. It ranked exchange attachments
// and returned at most one usable URL, and it DISCARDED every announcement
// that was not a results filing — order wins, commissioning notices,
// approvals, the exact structural evidence the thesis ledger asks for.
// candidatesFromFilings in lib/thesis/evidence-discovery keeps them.

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

  // ══════════════════════════════════════════════════════════════════════
  // EVIDENCE DISCOVERY, THEN EXTRACTION — IN THAT ORDER.          (zzz737)
  //
  // What this replaced: the exchange feed, then ONE screener.in document,
  // then `return "No readable document was found"`. Three faults in one
  // chain, and the owner named all three.
  //
  //   1. A FAILED FEED ENDED THE SEARCH. `if (!filings.length) return` ran
  //      before screener.in was consulted at all, so an outage in one source
  //      reported as the company having filed nothing.
  //   2. ONE DOCUMENT PER COMPANY. The numbers live in the results PDF;
  //      capacity, utilisation and order book in the investor presentation;
  //      the CAUSE and the guidance in the concall. Reading whichever
  //      answered first structurally cannot populate a structural block, and
  //      that is why the cards showed ○ against every mechanism variable
  //      while the financial fields were full.
  //   3. RETRIEVAL FAILURE BECAME A VERDICT. "No readable document" and "the
  //      company disclosed nothing" are opposite facts about a holding, and
  //      both printed the same empty card.
  //
  // Now: discovery gathers candidates from every source and records each
  // attempt; several documents are read, one per kind; and when nothing can
  // be read the response says WHICH state it is in and what was tried.
  // ══════════════════════════════════════════════════════════════════════
  const filings = await loadFilings(filingDate);
  const discovery = await discoverEvidence(ticker, { filings, filingDate });
  const toRead = selectForReading(discovery.candidates, MAX_DOCS);

  const read: Array<{ doc: DocCandidate; text: string }> = [];
  let budget = MAX_CHARS;
  for (const cand of toRead) {
    if (budget <= 10_000) break;                  // no room left to be useful
    const e = await extractFirstPdf([cand.url]);
    const body = String(e?.text || '');
    // The same 1,200-character floor the single-document path used: below it
    // a PDF is an intimation, a cover note, or a scan this reader cannot OCR.
    if (body.length < 1200) continue;
    const slice = body.slice(0, budget);
    budget -= slice.length;
    read.push({ doc: cand, text: slice });
  }

  if (!read.length) {
    // THE THREE STATES ARE REPORTED SEPARATELY, because the owner's next
    // action differs for each: retry, accept the absence, or look elsewhere.
    return NextResponse.json({
      ok: false,
      state: discovery.state,
      error: discovery.state === 'RETRIEVAL_FAILED'
        ? discovery.summary
        : discovery.candidates.length
          ? `${discovery.candidates.length} document(s) were found for ${ticker} but none could be read — `
            + 'they are scanned images this reader does not OCR, or the files did not download. '
            + 'This is a limit of the reader, not an absence of disclosure.'
          : discovery.summary,
      discovery_attempts: discovery.attempts,
      documents_found: discovery.candidates.length,
    });
  }

  // Every document is labelled in the prompt, so a figure can be traced to
  // the document it came from rather than to an anonymous blob of text.
  const text = read
    .map(({ doc, text: t }) => `### SOURCE: ${doc.label} (${doc.kind}, ${doc.source}${doc.period ? `, ${doc.period}` : ''})\n${t}`)
    .join('\n\n');

  const primary = read[0].doc;
  const usedDoc = primary;
  const docNote = read.length > 1
    ? `Read ${read.length} documents: ${read.map((r) => r.doc.label).join('; ')}.`
    : `Read ${primary.label}${primary.period ? ` (${primary.period})` : ''} from the ${primary.source}.`;

  // A transcript or a presentation is NOT a statement of results and must not
  // be held to that test — it is the BETTER source for the structural block.
  // The check now applies only when every document read is a results filing,
  // which is the case it was written for. (zzz737)
  if (read.every((r) => r.doc.kind === 'results') && !looksLikeIndiaResults(text)) {
    return NextResponse.json({
      ok: false,
      state: 'SEARCH_EXHAUSTED',
      error: 'The documents on file for this date are not statements of results — most likely intimations or notices. They were not summarised.',
      discovery_attempts: discovery.attempts,
      source_url: primary.url,
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

  // ══════════════════════════════════════════════════════════════════════
  // THE STRUCTURAL EVENTS STAGE.                                  (zzz738)
  //
  // The summary call above is a results summariser and it summarises. On
  // EXICOM's August 2026 concall it returned capacity, utilisation and order
  // book EMPTY while the transcript said "3x production capability",
  // "between 90% and 100% utilization" and "order book ... INR1,000 crores".
  // This second call is search-first: the sentences that name a structural
  // variable and carry a number are pulled out and the model is asked about
  // only those, with the verbatim sentence required for every figure. See
  // lib/thesis/evidence-extract.ts. Its output is validated against the
  // passages before anything reaches the ledger.
  // ══════════════════════════════════════════════════════════════════════
  let events: StructuralEvent[] = [];
  let pipeline: ExtractionPipeline | null = null;
  try {
    const r = await extractStructuralEvents(
      read.map(({ doc, text: t }) => ({ label: doc.label, kind: doc.kind, text: t })),
      ticker,
      { apiKey: process.env.ANTHROPIC_API_KEY!, model: MODEL },
    );
    events = r.events;
    pipeline = r.pipeline;
  } catch (e: any) {
    pipeline = {
      passages_by_family: {}, passages_sent: 0, events_returned: 0, events_kept: 0,
      events_by_family: {}, dropped: [], model_error: String(e?.message || e),
    };
  }
  // Carried inside `structured` so the client's extractVariables sees them
  // without a second shape to plumb through the hook.
  (data as any).events = events;

  const payload = {
    structured: data,
    events,
    evidence_pipeline: pipeline,
    source_url: usedDoc.url,
    document_kind: usedDoc.kind,
    document_period: usedDoc.period || quarter || null,
    document_note: docNote,
    // The audit trail the owner asked for: what was read, and what was tried
    // and failed. A card can now cite its sources and say what it could not
    // reach, instead of showing an unexplained circle.
    documents_read: read.map(({ doc }) => ({
      label: doc.label, kind: doc.kind, source: doc.source, tier: doc.tier,
      period: doc.period, url: doc.url,
    })),
    discovery_attempts: discovery.attempts,
    discovery_state: discovery.state,
    model: MODEL,
    ticker,
    quarter: quarter || null,
    chars_read: text.length,
    dropped_figures: dropped.slice(0, 5),
  };
  try { await kvSet(key, payload, TTL_S); } catch { /* the reading is still good uncached */ }
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
