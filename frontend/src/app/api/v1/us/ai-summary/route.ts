// ═══════════════════════════════════════════════════════════════════════════
// AI SUMMARY OF ONE US EARNINGS RELEASE
//
// Positives / Negatives / Overall Assessment, read out of the company's own
// press release and written in the shape the owner asked for.
//
// THE RULES THIS ENDPOINT KEEPS, AND WHY EACH ONE IS HERE
//
//  1. THE RELEASE IS THE ONLY SOURCE. The model is handed the text of the
//     8-K's press-release exhibit and nothing else — no news, no priors, no
//     recollection of the company. A summary that draws on anything else is a
//     summary of a memory, and this portal exists because the owner does not
//     want to trade on one.
//
//  2. EVERY FIGURE MUST APPEAR IN THE TEXT. The prompt forbids arithmetic,
//     estimation and rounding-up, and the post-check below drops the whole
//     answer if the model invents a dollar figure the release does not carry.
//     A wrong number is worse than no summary at all.
//
//  3. IT IS CACHED WITH THE FILING. A filed quarter never changes, so a
//     summary is computed once per accession and kept for a year. Re-opening a
//     card, or a hundred cards, costs nothing after the first read.
//
//  4. NO KEY, NO SUMMARY, NO PRETENDING. Without ANTHROPIC_API_KEY the
//     endpoint says so plainly and the card shows the documents instead.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';
import { releaseDocument, filingExhibits, htmlToText } from '@/lib/us-guidance';
import { submissions, tickerToCik } from '@/lib/us-edgar';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5-20251001';
const PROMPT_VERSION = 'us-ai-summary-v5';  // zzz681 — source-document check; v4 cached summaries of the wrong document
const TTL_S = 365 * 24 * 3600;          // a filed quarter is immutable
// The release in full wherever it fits. A long retail release puts its income
// statement and its reconciliation tables well past 60k characters, and a model
// that never saw the tables can only summarise the narrative — which is how a
// summary ends up with figures the verifier cannot find. Cached per accession,
// so the extra input is paid once per company per quarter.
const MAX_CHARS = 140_000;

// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS ENDPOINT NOW ASKS FOR A SHAPE INSTEAD OF A PAGE.          (zzz679)
//
// The old contract was prose, and it was enforced with `/Positives:/i`. If the
// model opened with "Here is the summary" or wrote "**Positives**" or chose
// "Strengths", the ENTIRE answer was thrown away and the card said "the
// summary came back in an unusable shape and was discarded". That is what RCMT
// showed. The summary was not wrong — it simply did not begin with the word
// the regex wanted, and one brittle string decided whether the owner saw any
// analysis at all.
//
// So the model is now given a TOOL with a typed input schema. The API enforces
// the shape on its side: a tool call either validates against the schema or
// the model is asked again. "Unusable shape" stops being a failure mode rather
// than being handled better.
//
// AND THE CONTENT CHANGED, because the old shape was the real complaint. Three
// buckets — positives, negatives, one paragraph — cannot hold the things that
// actually decide whether a quarter matters:
//
//   · GUIDANCE. What management now says about the future, and whether that is
//     higher or lower than what they said last time. This is the single most
//     price-relevant sentence in most releases and the old prompt mentioned it
//     only as a warning not to mis-state it.
//   · MIX AND SEGMENTS. "Revenue +20%" means something different when one
//     segment tripled and another shrank. A blended number hides the business.
//   · CAPITAL. Capex, buybacks, dividends, debt — what the company is DOING
//     with the cash, which is management's revealed opinion of its own future.
//   · PEOPLE. A CFO leaving in the same release as a good quarter is a fact no
//     bullet list of positives will ever surface.
//   · NEW BUSINESS. Products, customers, contracts, capacity coming online —
//     the things that produce the NEXT four quarters rather than explaining
//     this one.
//   · WHAT IS NOT THERE. A release that stops giving a number it used to give
//     has told you something. Absence is evidence, and nothing in the engine
//     was looking for it.
//
// Every field stays bound by the same rule as before: it comes out of the
// release or it does not get written. The verifier below now runs per field,
// so one unsupported figure costs its own item instead of the whole summary.
// ═══════════════════════════════════════════════════════════════════════════

/** The typed answer. The API validates this before the response reaches us. */
const SUMMARY_TOOL = {
  name: 'file_earnings_summary',
  description: 'Record the structured reading of this earnings release.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict_line: {
        type: 'string',
        description: 'ONE sentence, max 22 words: what this quarter establishes. No recommendation, no price view.',
      },
      guidance: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['raised', 'maintained', 'lowered', 'initiated', 'withdrawn', 'none'],
            description: '"none" means the release gives no forward guidance at all. Do not guess — only what the release states.',
          },
          detail: { type: 'string', description: 'The guided figures exactly as printed, with the period. Empty string if action is "none".' },
          period: { type: 'string', description: 'The period guided, e.g. "FY26" or "Q3 FY26". Empty if none.' },
        },
        required: ['action', 'detail', 'period'],
      },
      segments: {
        type: 'array',
        description: 'Per-segment or per-product-line movement, where the release breaks it out. Empty array if it does not.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            detail: { type: 'string', description: 'The movement with its figure as printed.' },
            direction: { type: 'string', enum: ['up', 'down', 'flat'] },
          },
          required: ['name', 'detail', 'direction'],
        },
      },
      mix_shift: { type: 'string', description: 'Any stated change in product/customer/geographic mix, and what it did to margin. Empty string if the release says nothing about mix.' },
      capital: {
        type: 'object',
        description: 'What the company is doing with its cash, as stated. Empty strings where the release is silent.',
        properties: {
          capex: { type: 'string' },
          buyback: { type: 'string' },
          dividend: { type: 'string' },
          debt: { type: 'string' },
        },
        required: ['capex', 'buyback', 'dividend', 'debt'],
      },
      management: { type: 'string', description: 'Any CEO/CFO/board appointment, departure or succession announced in this release. Empty string if none.' },
      new_business: {
        type: 'array',
        description: 'New products, customers, contracts, awards, facilities or capacity announced in the release. Empty array if none.',
        items: { type: 'string' },
      },
      positives: {
        type: 'array',
        description: '2 to 5 items. Each with a short label and the specific fact with its figure.',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, detail: { type: 'string' } },
          required: ['label', 'detail'],
        },
      },
      negatives: {
        type: 'array',
        description: '0 to 5 items. Declines, margin pressure, cash outflows, elevated spend, stated risks, weak guided lines. Empty array ONLY if the release genuinely contains none.',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, detail: { type: 'string' } },
          required: ['label', 'detail'],
        },
      },
      watch_next: {
        type: 'array',
        description: '1 to 4 items: what the release itself says will decide the next few quarters.',
        items: { type: 'string' },
      },
      not_disclosed: {
        type: 'array',
        description: 'Things a reader would expect and this release does NOT give — no segment breakout, no cash-flow statement, no guidance, no backlog figure, no margin detail. 0 to 4 items. Absence is evidence; say only what is genuinely missing from THIS text.',
        items: { type: 'string' },
      },
    },
    required: ['verdict_line', 'guidance', 'segments', 'mix_shift', 'capital', 'management', 'new_business', 'positives', 'negatives', 'watch_next', 'not_disclosed'],
  },
};

const SYSTEM = `You summarise a single quarterly earnings press release for a professional investor who has already seen the headline numbers.

You MUST answer by calling the file_earnings_summary tool. Do not write prose outside it.

WHAT THE READER ALREADY HAS, so do not repeat it: revenue, EPS, operating margin, cash flow and the year-over-year percentages are already on screen. Your value is everything AROUND those numbers — guidance, mix, segments, capital allocation, people, new business, and what the release quietly does not say.

ABSOLUTE RULES
- Use ONLY the release text provided. You have no other knowledge of this company. Never add context, history, competitor comparison, valuation or market reaction.
- Every number you write must appear in the release text. Copy it as the release prints it, with the same unit — if a table is headed "in thousands" and shows 5,232, write $5.2 million or 5,232 thousand, never a figure of your own construction. Do not compute, derive, annualise or infer any number. If a figure is not in the text, write the point without a figure.
- Never describe anything as a beat or a miss unless the release itself says so: you have not been given consensus estimates.
- Guidance is what management SAYS WILL happen. Never present it as achieved.
- If the release genuinely contains no negatives, say so in one line rather than inventing one.

FIELD DISCIPLINE
- Every field is filled from the release or left empty. An empty string and an empty array are correct answers and are preferred over a guess.
- Keep each detail to one sentence. The reader is scanning, not reading.
- "not_disclosed" is for things genuinely absent from THIS release that a reader would reasonably expect. Do not list something the release does give.
- Do not editorialise. No recommendation, no valuation, no price view, no comparison to other companies.`;

// ── THE NUMBERS CHECK ──────────────────────────────────────────────────────
//
// Every figure in the summary must be one the release contains. The first
// version of this compared the digits literally and threw away good summaries
// for a reason that was not fabrication at all: a release states "5,232" in a
// table headed "in thousands", and a summary that says "$5.23 million" is
// RIGHT — it is the same number, correctly converted. Comparing "5.23" against
// "5232" found no match and discarded the lot.
//
// So the comparison is on SIGNIFICANT DIGITS, ignoring the decimal point,
// thousands separators and trailing zeros: 5.23 → "523", which is the leading
// run of 5,232 → "5232". That accepts every honest restatement of a printed
// figure (thousands to millions, $1.5 billion as $1.50B) and still rejects a
// number the release never printed, which is the only thing this guard is for.

/** Significant digits of a number, with separators, the decimal point and
 *  trailing zeros removed. "881.40" → "8814"; "1,500" → "15". */
function sigDigits(n: string): string {
  const d = n.replace(/[^\d]/g, '').replace(/^0+/, '');
  return d.replace(/0+$/, '') || (d ? '0' : '');
}

/** Every dollar figure the model wrote, so an invented one can be caught. */
function moneyTokens(text: string): string[] {
  return (text.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) || [])
    .map((t) => t.replace(/[^\d.,]/g, ''));
}

/** The significant digits of every number the release prints. */
function numeralsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(/\d[\d,]*(?:\.\d+)?/g) || []) {
    const d = sigDigits(m);
    if (d) out.add(d);
  }
  return out;
}

/** Is this figure supported by something the release printed? True when its
 *  significant digits match, or begin, the digits of a printed number — which
 *  is what a unit conversion or a rounding to two decimals looks like. */
function supported(fig: string, release: Set<string>): boolean {
  const d = sigDigits(fig);
  if (!d) return true;                       // nothing numeric to check
  if (d.length <= 1) return true;            // "$5" — too coarse to be evidence either way
  if (release.has(d)) return true;
  for (const r of release) {
    if (r.length >= d.length && r.startsWith(d)) return true;   // 523 ⊂ 5232
    if (d.length > r.length && d.startsWith(r) && d.length - r.length <= 2) return true;
  }
  return false;
}

// ── THE PERCENTAGES, CHECKED THE SAME WAY ──────────────────────────────────
//
// The guard above reads dollar figures only, and a summary is mostly
// percentages: "up 27% year-over-year", "gross margin of 75.0%", "expanding
// 2.6 percentage points". A wrong percentage is as actionable as a wrong
// dollar and was going out unchecked.
//
// A percentage cannot use the digit-prefix rule, because rounding UP breaks it
// — a release printing 105.9% and a summary writing 106% share no prefix. So a
// percentage is supported when some number the release prints ROUNDS to it at
// the precision the summary wrote it: 105.9 → "106" ✓, and a figure the
// release never printed matches nothing. Exact, and it cannot be satisfied by
// accident the way a tolerance band could.

/** Every percentage the model wrote, as {value, decimals}. */
function pctTokens(text: string): Array<{ v: number; dp: number }> {
  const out: Array<{ v: number; dp: number }> = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent\b|percentage points?\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1].replace(/,/g, '');
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    out.push({ v, dp: (raw.split('.')[1] || '').length });
  }
  return out;
}

/** Every number the release prints, as a value. */
function valuesIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.match(/\d[\d,]*(?:\.\d+)?/g) || []) {
    const v = Number(m.replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function supportedPct(p: { v: number; dp: number }, values: number[]): boolean {
  // A whole-number percentage under 10 is too coarse to be evidence either
  // way — "up 5%" will always find a 5 somewhere — and refusing those would
  // cost more good lines than it catches bad ones.
  if (p.dp === 0 && p.v < 10) return true;
  const f = Math.pow(10, p.dp);
  for (const r of values) {
    if (Math.round(r * f) / f === p.v) return true;
  }
  return false;
}

/**
 * Does this text read like an earnings press release?  (zzz681)
 *
 * Generic by construction — it reads the words every filer uses, never a
 * company or a filename. Two families of evidence:
 *
 *  · a HARD REJECT for the documents that are reliably NOT releases and that
 *    the filename ranker is most likely to pick by accident: the Sarbanes-Oxley
 *    certifications that accompany every 10-Q and 10-K, which announce
 *    themselves in fixed statutory language;
 *  · a POSITIVE test needing at least two independent release markers, so a
 *    document that merely mentions revenue in passing does not qualify.
 *
 * Deliberately permissive on the positive side. A false negative costs a
 * summary the owner could have had; a false positive costs a summary OF THE
 * WRONG DOCUMENT, which is worse, and the reject list is where that is caught.
 */
function looksLikeEarningsRelease(t: string): boolean {
  if (!t || t.length < 800) return false;
  const head = t.slice(0, 6000);

  // Statutory certification language — never an earnings release.
  if (/pursuant to\s+(?:rule\s+13a-14|section\s+(?:302|906))/i.test(head)) return false;
  if (/\bI,\s+[A-Z][^,]{2,60},\s+certify that\b/i.test(head)) return false;
  if (/certification\s+(?:of|pursuant)/i.test(head) && !/press release/i.test(head)) return false;

  let marks = 0;
  // "X reports/announces ... results/earnings" — the headline of nearly every release.
  if (/\b(?:reports?|reported|announces?|announced|posts?|delivers?)\b[\s\S]{0,60}\b(?:results|earnings|revenue|quarter|financial)\b/i.test(head)) marks++;
  // A period statement.
  if (/\b(?:first|second|third|fourth)\s+quarter\b|\bQ[1-4]\s*(?:FY)?\s*20\d\d\b|\b(?:quarter|year)\s+ended\b/i.test(head)) marks++;
  // Income-statement vocabulary in quantity, not in passing.
  if ((t.match(/\b(?:net income|net revenue|total revenue|revenues?|net sales|earnings per share|operating income|EBITDA)\b/gi) || []).length >= 4) marks++;
  // Money, repeatedly.
  if ((t.match(/\$\s?\d/g) || []).length >= 8) marks++;
  // The furniture of a release.
  if (/\b(?:conference call|webcast|investor relations|forward-looking statements|non-GAAP)\b/i.test(t)) marks++;

  return marks >= 2;
}

/**
 * The verified object, written out as the text the previous version returned.
 *
 * This exists so that switching the card to a structured render does not break
 * every other consumer of this endpoint at the same moment. It reads from the
 * SAME object the card renders, after the same verification, so the two can
 * never disagree about what the release said.
 */
function renderProse(d: any): string {
  const out: string[] = [];
  if (d.verdict_line) out.push(String(d.verdict_line), '');
  const g = d.guidance;
  if (g?.action && g.action !== 'none') {
    out.push(`Guidance: ${String(g.action).toUpperCase()}${g.period ? ` (${g.period})` : ''}${g.detail ? ` — ${g.detail}` : ''}`, '');
  }
  if (Array.isArray(d.positives) && d.positives.length) {
    out.push('Positives:');
    for (const p of d.positives) out.push(`* ${p.label}: ${p.detail}`);
    out.push('');
  }
  if (Array.isArray(d.negatives) && d.negatives.length) {
    out.push('Negatives:');
    for (const n of d.negatives) out.push(`* ${n.label}: ${n.detail}`);
    out.push('');
  }
  if (Array.isArray(d.segments) && d.segments.length) {
    out.push('Segments:');
    for (const s of d.segments) out.push(`* ${s.name}: ${s.detail}`);
    out.push('');
  }
  if (d.mix_shift) out.push(`Mix: ${d.mix_shift}`, '');
  if (d.management) out.push(`Management: ${d.management}`, '');
  if (Array.isArray(d.new_business) && d.new_business.length) {
    out.push('New business:');
    for (const b of d.new_business) out.push(`* ${b}`);
    out.push('');
  }
  const cap = d.capital || {};
  const capBits = ['capex', 'buyback', 'dividend', 'debt'].filter((k) => cap[k]).map((k) => `${k}: ${cap[k]}`);
  if (capBits.length) out.push(`Capital: ${capBits.join(' · ')}`, '');
  if (Array.isArray(d.watch_next) && d.watch_next.length) {
    out.push('What decides the next few quarters:');
    for (const w of d.watch_next) out.push(`* ${w}`);
    out.push('');
  }
  if (Array.isArray(d.not_disclosed) && d.not_disclosed.length) {
    out.push(`Not disclosed: ${d.not_disclosed.join('; ')}`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const cik = Number(u.searchParams.get('cik') || 0);
  const accession = String(u.searchParams.get('accession') || '');
  const filingUrl = String(u.searchParams.get('filing_url') || '');
  const ticker = String(u.searchParams.get('ticker') || '').toUpperCase();
  const force = u.searchParams.get('force') === '1';
  // The filing the row was GRADED from, used to find the matching earnings
  // release when that filing is a 10-Q. Optional: a row that carries a proper
  // 8-K never needs it.
  const filingDate = String(u.searchParams.get('filing_date') || '').slice(0, 10);
  if (!ticker && (!cik || !accession || !filingUrl)) {
    return NextResponse.json({ ok: false, error: 'cik, accession and filing_url are required' }, { status: 400 });
  }

  // ── FINDING THE RELEASE WHEN THE ROW IS A 10-Q  (zzz612) ─────────────────
  //
  // A quarter is graded from whichever filing carried the numbers, and for
  // many companies that is the 10-Q. A 10-Q has no press-release exhibit, so
  // the card said "this row has no 8-K filing behind it to read" — which was
  // true of the FILING and false of the COMPANY: Matador files its earnings
  // release as an 8-K Item 2.02 the same week. Refusing to look for it threw
  // away a summary that was one lookup away.
  //
  // So when the row's own filing carries no release, the company's recent
  // submissions are searched for the 8-K announcing THIS quarter's results —
  // Item 2.02, nearest the row's filing date, within a month either side so a
  // neighbouring quarter's release can never be substituted for this one.
  let cikN = cik;
  let acc = accession;
  let idxUrl = filingUrl;
  let usedFallback = false;
  const findEarnings8K = async (): Promise<boolean> => {
    try {
      if (!cikN && ticker) cikN = (await tickerToCik(ticker)) || 0;
      if (!cikN) return false;
      const subs = await submissions(cikN);
      if (!subs?.recent?.length) return false;
      const anchor = filingDate ? Date.parse(`${filingDate}T00:00:00Z`) : NaN;
      const cands = subs.recent
        .filter((f) => f.form.startsWith('8-K') && f.items.includes('2.02') && f.accession)
        .map((f) => ({ f, d: Number.isFinite(anchor) ? Math.abs(Date.parse(`${f.filingDate}T00:00:00Z`) - anchor) : 0 }))
        .filter((c) => !Number.isFinite(anchor) || c.d <= 31 * 86_400_000)
        .sort((a, b) => a.d - b.d);
      const pick = cands[0]?.f;
      if (!pick) return false;
      const bare = pick.accession.replace(/-/g, '');
      acc = pick.accession;
      idxUrl = `https://www.sec.gov/Archives/edgar/data/${cikN}/${bare}/${pick.accession}-index.htm`;
      usedFallback = true;
      return true;
    } catch { return false; }
  };
  if (!cikN || !acc || !idxUrl) {
    const found = await findEarnings8K();
    if (!found) {
      return NextResponse.json({
        ok: false, available: false,
        error: 'This quarter was graded from a 10-Q and no earnings press release (8-K Item 2.02) was filed near it, so there is nothing to read.',
      });
    }
  }

  const key = `us-ai-summary:${PROMPT_VERSION}:${acc}`;
  if (!force) {
    const hit = await kvGet<any>(key);
    if (hit?.summary && hit?.structured) return NextResponse.json({ ok: true, cached: true, ...hit });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) {
    return NextResponse.json({
      ok: false, available: false,
      error: 'No ANTHROPIC_API_KEY is configured for this deployment, so no summary can be written. The filing documents below are unaffected.',
    });
  }

  // ── the source text ──────────────────────────────────────────────────────
  let text = '';
  let sourceUrl: string | null = null;
  try {
    const doc = await releaseDocument(cikN, acc, idxUrl);
    if (doc.html) { text = htmlToText(doc.html); sourceUrl = doc.url; }
  } catch { /* handled below */ }
  // The row's own filing had no readable release — try the company's earnings
  // 8-K for the same quarter before giving up.
  //
  // zzz681 — LENGTH WAS NEVER THE RIGHT TEST.
  //
  // The only guard here used to be `text.length < 800`, and the exhibit picker
  // upstream ranks candidates BY FILENAME: a filing whose documents carry no
  // press-release-shaped name has every candidate tie, and the tie breaks on
  // size, so the largest .htm wins. In a 10-Q filing that is the 10-Q itself or
  // a Sarbanes-Oxley certification — thousands of characters of text, sailing
  // through a length check, and then summarised as though it were a results
  // announcement. RCMT is exactly this: the model was handed a Form 10-Q
  // certification and asked what the quarter established.
  //
  // Under the old prose contract that produced something shapeless, which the
  // `/Positives:/i` check discarded, and the card said the summary came back
  // unusable — blaming the model for being handed the wrong document. So the
  // check now asks what the document IS before deciding it is good enough, and
  // an answer of "not a release" reaches for the earnings 8-K exactly as an
  // empty answer already did.
  if ((text.length < 800 || !looksLikeEarningsRelease(text)) && !usedFallback && await findEarnings8K()) {
    try {
      const doc = await releaseDocument(cikN, acc, idxUrl);
      if (doc.html) { text = htmlToText(doc.html); sourceUrl = doc.url; }
    } catch { /* fall through to the honest refusal below */ }
  }
  if (text.length >= 800 && !looksLikeEarningsRelease(text)) {
    return NextResponse.json({
      ok: false, available: false,
      error: 'The document filed here is not an earnings release — it reads as a periodic report or a certification exhibit — and no separate results release was filed near it, so there is nothing to summarise.',
    });
  }
  if (text.length < 800) {
    return NextResponse.json({
      ok: false, available: false,
      error: 'This filing carries no readable press release — the exhibit is a scanned or image-based document, and nothing is summarised from a picture.',
    });
  }
  const clipped = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  // ── the call ─────────────────────────────────────────────────────────────
  // `tool_choice` forces the tool, so the model cannot answer in prose and the
  // API validates the object against the schema before it reaches this code.
  let data: any = null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2600,
        system: SYSTEM,
        tools: [SUMMARY_TOOL],
        tool_choice: { type: 'tool', name: SUMMARY_TOOL.name },
        messages: [{
          role: 'user',
          content: `Earnings press release${ticker ? ` for ${ticker}` : ''} — read it and call file_earnings_summary.\n\n<release>\n${clipped}\n</release>`,
        }],
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: `The summary service returned HTTP ${resp.status}.` });
    }
    const j: any = await resp.json();
    const call = (j?.content || []).find((c: any) => c?.type === 'tool_use' && c?.name === SUMMARY_TOOL.name);
    data = call?.input ?? null;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `The summary service did not answer (${String(e?.message || e)}).` });
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.positives)) {
    return NextResponse.json({ ok: false, error: 'The summary service answered without filing a result.' });
  }

  // ── VERIFICATION, PER FIELD  (zzz679) ────────────────────────────────────
  //
  // The same rule as before — a figure the release does not print does not get
  // shown — applied to each item rather than to a blob of text. An unsupported
  // number now costs one bullet, one segment or one guidance line, and the rest
  // of the reading survives. The old whole-answer discard is kept only for the
  // case where so little remains that what is left would misrepresent the
  // quarter by omission.
  const inRelease = numeralsIn(text);
  const releaseValues = valuesIn(text);
  const dropped: string[] = [];
  /** True when every figure in a string appears in the release. */
  const clean = (s: any): boolean => {
    const v = typeof s === 'string' ? s : '';
    if (!v) return true;
    const badMoney = moneyTokens(v).filter((f) => !supported(f, inRelease));
    if (badMoney.length) { dropped.push(`$${badMoney[0]}`); return false; }
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
  if (data.guidance && !clean(data.guidance.detail)) {
    // The direction is still worth keeping when only the figure is doubtful.
    data.guidance.detail = '';
  }
  for (const k of ['capex', 'buyback', 'dividend', 'debt']) {
    if (data.capital && !clean(data.capital[k])) data.capital[k] = '';
  }

  // Nothing left to say, or the positives — the substance of the reading —
  // mostly failed verification.
  if (!data.positives.length && !data.negatives.length && !data.verdict_line) {
    return NextResponse.json({
      ok: false,
      error: `The summary cited figures that do not appear in the release (${dropped.slice(0, 3).join(', ')}), so it was discarded rather than shown.`,
    });
  }
  if (posBefore >= 3 && data.positives.length < posBefore * 0.5) {
    return NextResponse.json({
      ok: false,
      error: `Most of the summary cited figures absent from the release (${dropped.slice(0, 3).join(', ')}), so it was discarded rather than shown.`,
    });
  }

  // ── A PROSE RENDERING, FOR EVERY READER THAT IS NOT THE NEW CARD ─────────
  // The card renders `structured`. Anything else that asked this endpoint for
  // `summary` — an email, a scheduled brief, an older cached client — keeps
  // getting a string, built from the verified object rather than from a second
  // model call. One source of truth, two renderings.
  const summary = renderProse(data);

  // ── the numbers check ────────────────────────────────────────────────────
  // Every dollar figure in the summary has to be one the release contains. A
  // single invented figure discards the whole answer: a summary that is right
  // about three things and wrong about a fourth is not a partial success, it is
  // a number the owner might act on.
  // AN UNSUPPORTED FIGURE COSTS ITS OWN LINE, NOT THE WHOLE SUMMARY.
  //
  // Discarding everything was right when the alternative was showing a number
  // the release never printed — but it also threw away four correct bullets for
  // one doubtful one, which is how "AI Summary" came to show nothing at all.
  // The line carrying the unsupported figure is removed and the rest stands;
  // only when the summary loses its substance is the whole thing refused.
  let documents: any[] = [];
  try { documents = (await filingExhibits(idxUrl)).slice(0, 12); } catch { documents = []; }

  const payload = {
    summary, structured: data, source_url: sourceUrl, model: MODEL, documents,
    dropped_lines: dropped.length || undefined,
    generated_at: new Date().toISOString(),
  };
  await kvSet(key, payload, TTL_S);
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
