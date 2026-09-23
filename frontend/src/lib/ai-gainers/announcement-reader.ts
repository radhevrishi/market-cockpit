// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — PHASE 2. THE ANNOUNCEMENT READER.              (zzz725)
//
// Phase 1 answers "which gainers also filed a quarterly result", which is the
// largest single class of catalyst and the only one available without a model.
// It leaves the more interesting half untouched: the stock up 20% today on an
// order win, a qualification, a regulatory approval or a promoter purchase —
// none of which waits for a quarterly filing, and all of which sit in the
// exchange announcement feed the portal already polls.
//
// THE THREE RULES THIS FILE EXISTS TO ENFORCE, from the owner's spec:
//
//   1. THE MODEL MAY NOT INVENT A CATEGORY. The catalyst taxonomy is passed as
//      an enum in a forced tool call, so the answer is one of the listed types
//      or `none_identified`. The earlier pipeline labelled eight companies
//      `revenue_guidance_increase` because that string happened to be first in
//      a list; a fabricated category wearing a tier-1 filing link is the worst
//      shape a wrong answer takes here, and a schema is the only durable fix.
//
//   2. EVERY CLAIM CARRIES THE SENTENCE THAT EVIDENCES IT. `evidence_quote` is
//      required and must be verbatim. A claim with no quote is dropped rather
//      than shown, because "the company announced a large order" with nothing
//      behind it is indistinguishable from the model having imagined one.
//
//   3. ADMINISTRATIVE IS A REAL ANSWER, AND THE COMMON ONE. Most exchange
//      announcements are board-meeting intimations, AGM notices, voting
//      results and share-transfer-agent changes. The schema names those
//      explicitly so the model has somewhere honest to put them, and the
//      scorer weights `administrative` at 1 point out of 15. A reader with no
//      way to say "this is nothing" will always find something.
//
// WHAT IT DELIBERATELY DOES NOT DO: it never reads a PRICE, and it is never
// told the stock is up. A reader that knows the answer it is looking for will
// find it in a share-transfer notice.
// ═══════════════════════════════════════════════════════════════════════════

import {
  OPERATING_CATALYSTS, CORPORATE_CATALYSTS, NEGATIVE_CATALYSTS,
  type CatalystType, type Materiality, type StructuralDuration,
} from './events';
import { anthropicMessages, modelConfigured } from '@/lib/anthropic-meter';
import { kvGet, kvSet } from '@/lib/kv';

const MODEL = 'claude-haiku-4-5-20251001';
export const READ_CHARS = 24_000;

const CATALYST_ENUM: string[] = [
  ...OPERATING_CATALYSTS, ...CORPORATE_CATALYSTS, ...NEGATIVE_CATALYSTS,
  'none_identified',
];

export interface AnnouncementItem {
  symbol: string;
  subject?: string | null;
  attachment_url?: string | null;
  filing_date?: string | null;
  company_name?: string | null;
}

export interface ReadAnnouncement {
  symbol: string;
  catalyst: CatalystType;
  materiality: Materiality;
  structuralDuration: StructuralDuration;
  headline: string;
  evidenceQuote: string;
  sizeVsCompany: string | null;
  impactFrom: string | null;
  sourceUrl: string;
  filingDate: string | null;
  /** True when the reader concluded this is routine housekeeping. */
  administrative: boolean;
}

/**
 * ── THE QUOTE GATE, as a pure function.                            (zzz728)
 *
 * A model asked for a verbatim quote will produce something quote-shaped
 * whether or not it read one, so the quote is checked against the document
 * rather than trusted. Normalisation handles the three things that legitimately
 * differ between a PDF's text layer and a quote copied out of it: collapsed
 * whitespace, Unicode punctuation (curly quotes, en/em dashes, the rupee sign)
 * and hyphenation across a line break.
 *
 * Exported and pure so the fabricated-quote case can be tested directly —
 * it is the single most important safeguard in the reader.
 */
export function normaliseForQuoteMatch(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201B\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/-\s*\n\s*/g, '')          // hyphenation across a PDF line break
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 .,%$-]/g, '')
    .trim();
}

export function quoteIsInDocument(documentText: string, quote: string): boolean {
  const q = normaliseForQuoteMatch(quote);
  if (q.length < 25) return false;
  // Match on a leading window rather than the whole quote: a model may append
  // a clause from the next sentence, which is a formatting slip rather than a
  // fabrication. A 60-character run that is absent IS a fabrication.
  return normaliseForQuoteMatch(documentText).includes(q.slice(0, 60));
}

const TOOL = {
  name: 'file_announcement_reading',
  description: 'Record what a single exchange announcement actually says.',
  input_schema: {
    type: 'object' as const,
    properties: {
      catalyst: {
        type: 'string',
        enum: CATALYST_ENUM,
        description: 'The ONE category this announcement belongs to. Use "none_identified" when the announcement is routine housekeeping — a board-meeting intimation, AGM notice, voting result, newspaper publication, registrar change, trading-window closure, or a disclosure with no operating content. Most announcements are exactly that, and saying so is the correct answer.',
      },
      is_administrative: {
        type: 'boolean',
        description: 'True when this is routine housekeeping with no operating or corporate substance.',
      },
      headline: {
        type: 'string',
        description: 'One clause, under 18 words, in the company\'s own proper nouns, stating what was announced. Empty string if administrative.',
      },
      evidence_quote: {
        type: 'string',
        description: 'The sentence from the announcement that evidences the headline, QUOTED VERBATIM. Never paraphrase, never stitch two sentences together. Empty string if administrative or if no single sentence supports it — an empty quote causes the reading to be discarded, which is the correct outcome.',
      },
      size_vs_company: {
        type: 'string',
        description: 'How large this is relative to the company, using ONLY figures the announcement states — an order value, a capacity, an investment. "not quantified" when the announcement gives no number, which is common.',
      },
      impact_from: {
        type: 'string',
        description: 'The period from which it should show in the numbers, in the announcement\'s own words. "not stated" if absent.',
      },
      materiality: {
        type: 'string',
        enum: ['high', 'medium', 'low', 'unknown'],
        description: 'Potential effect on EARNINGS, judged only from what the announcement quantifies. An unquantified announcement is "unknown", never "high" — an order with no value attached tells you nothing about earnings.',
      },
      structural_duration: {
        type: 'string',
        enum: ['long', 'medium', 'short', 'unknown'],
        description: 'How long the effect lasts. A multi-year order or a new plant is long; a single shipment is short; an unquantified item is unknown.',
      },
    },
    required: ['catalyst', 'is_administrative', 'headline', 'evidence_quote',
      'size_vs_company', 'impact_from', 'materiality', 'structural_duration'],
  },
};

const SYSTEM = `You read ONE exchange announcement from an Indian or US listed company and record what it says. Nothing else.

THE ONLY THING YOU KNOW about this company is the text in front of you. You are not told the share price, whether it moved, or why anyone is asking. Do not speculate about market reaction.

RULES THAT OVERRIDE EVERYTHING ELSE:
1. The catalyst must be one of the listed categories. If nothing fits, it is "none_identified". Never stretch a category to make an announcement look interesting.
2. MOST ANNOUNCEMENTS ARE ADMINISTRATIVE — board-meeting intimations, AGM notices, voting results, newspaper publications, registrar or auditor changes, trading-window closures, credit-rating reaffirmations with no change. Set is_administrative true and catalyst "none_identified" for these. This is the expected answer, not a failure.
3. evidence_quote is VERBATIM, one sentence, copied from the text. If you cannot find a single sentence that supports your headline, leave the quote empty — the reading is then discarded, which is correct.
4. Never state a figure the text does not contain. "not quantified" and "not stated" are always available and always preferred over a number you inferred.
5. Materiality is about EARNINGS and is judged only from quantified facts. An order with no value, a "strategic partnership" with no terms, an MoU — all "unknown" materiality, whatever the language of the announcement suggests.
6. Promotional language is not evidence. An announcement calling something "transformational" or "landmark" with no figures is an unquantified announcement written enthusiastically.`;

/** Pick the announcements most likely to carry operating content, cheaply,
 *  before spending a model call on any of them. */
const NOISE = /(board meeting|agm|annual general|voting result|scrutiniz|newspaper|registrar|share transfer|trading window|postal ballot|duplicate share|investor (meet|presentation) schedul|compliance certificate|reconciliation of share|loss of share)/i;

export function worthReading(a: AnnouncementItem): boolean {
  const hay = `${a.subject || ''} ${decodeURIComponent(String(a.attachment_url || ''))}`;
  return !NOISE.test(hay);
}

/**
 * Read one announcement. Returns null when nothing survives the rules — an
 * administrative filing, a missing quote, or a model call that failed. Null is
 * a normal and frequent outcome and the caller must treat it as "no catalyst",
 * never as an error.
 */
export async function readAnnouncement(
  a: AnnouncementItem,
  fetchText: (url: string) => Promise<string>,
): Promise<ReadAnnouncement | null> {
  if (!modelConfigured()) return null;
  const url = String(a.attachment_url || '');
  if (!url) return null;

  let text = '';
  try { text = await fetchText(url); } catch { return null; }
  // A very short extraction is usually a scanned PDF with no text layer. It is
  // better to return nothing than to have the model reason from a subject line
  // and call that a reading of the document.
  if (!text || text.length < 400) return null;

  try {
    // 24 000 chars, not 60 000 (zzz747). A Reg 30 order/contract intimation
    // is one to three pages; the figure, the customer and the timeline are in
    // the first paragraph. In a results presentation the headline slide is
    // early too. Reading the whole deck cost ~15k input tokens a filing for
    // a quote that sits in the first 6k. If the quote is not in the first
    // 24 000 chars, the quote gate below rejects the read the same as before.
    const resp = await anthropicMessages('gainers-read', {
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{
        role: 'user',
        content: `${a.symbol}${a.subject ? ` — ${a.subject}` : ''}\n\n${text.slice(0, READ_CHARS)}`,
      }],
    }, { signal: AbortSignal.timeout(40_000) });
    if (!resp.ok) return null;
    const j = await resp.json();
    const use = (j?.content || []).find((c: any) => c?.type === 'tool_use');
    const d = use?.input;
    if (!d) return null;

    if (d.is_administrative || d.catalyst === 'none_identified') return null;

    // ── THE QUOTE GATE. A claim with no verbatim sentence behind it, or a
    //    quote that is not actually in the document, is discarded. The second
    //    check matters more than the first: a model asked for a quote will
    //    produce something quote-shaped whether or not it read one.
    const quote = String(d.evidence_quote || '').trim();
    if (!quoteIsInDocument(text, quote)) return null;

    if (!String(d.headline || '').trim()) return null;

    return {
      symbol: a.symbol,
      catalyst: d.catalyst as CatalystType,
      materiality: (d.materiality || 'unknown') as Materiality,
      structuralDuration: (d.structural_duration || 'unknown') as StructuralDuration,
      headline: String(d.headline).trim(),
      evidenceQuote: quote,
      sizeVsCompany: /not quantified/i.test(String(d.size_vs_company || '')) ? null : String(d.size_vs_company),
      impactFrom: /not stated/i.test(String(d.impact_from || '')) ? null : String(d.impact_from),
      sourceUrl: url,
      filingDate: a.filing_date || null,
      administrative: false,
    };
  } catch {
    return null;
  }
}

// ── ONE READ PER FILING, EVER  (zzz747) ─────────────────────────────────────
//
// The research sweep cached its reads by PDF URL for 30 days; the scan route
// did not. A scan is rebuilt every 20 minutes while the tab is open, and each
// rebuild re-read up to six filings the model had already read — the same
// order intimation, paid for again three times an hour. Both routes now go
// through this one cache. A read that returned null (administrative, no
// quote, scanned image) is cached too: an unreadable filing does not become
// readable by paying again.

const READ_CACHE_TTL_S = 30 * 24 * 3600;

function urlHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export const readCacheKey = (url: string) => `ai-gainers:annread:v1:${urlHash(url)}`;

export interface CachedRead { read: ReadAnnouncement | null; cached: boolean; skipped?: boolean }

export async function readAnnouncementCached(
  a: AnnouncementItem,
  fetchText: (url: string) => Promise<string>,
  opts: { cacheOnly?: boolean } = {},
): Promise<CachedRead> {
  const url = String(a.attachment_url || '');
  if (!url) return { read: null, cached: false };
  const k = readCacheKey(url);
  try {
    const hit = await kvGet<{ read: ReadAnnouncement | null }>(k);
    if (hit && 'read' in hit) return { read: hit.read, cached: true };
  } catch { /* a cold cache is a normal cache */ }
  // A page open answers from what was already read; only a click pays. (zzz768)
  if (opts.cacheOnly) return { read: null, cached: false, skipped: true };
  const read = await readAnnouncement(a, fetchText);
  try { await kvSet(k, { read, at: new Date().toISOString() }, READ_CACHE_TTL_S); } catch { /* the read still counts; only the next one pays again */ }
  return { read, cached: false };
}
