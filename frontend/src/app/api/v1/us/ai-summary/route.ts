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

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5-20251001';
const PROMPT_VERSION = 'us-ai-summary-v2';
const TTL_S = 365 * 24 * 3600;          // a filed quarter is immutable
// The release in full wherever it fits. A long retail release puts its income
// statement and its reconciliation tables well past 60k characters, and a model
// that never saw the tables can only summarise the narrative — which is how a
// summary ends up with figures the verifier cannot find. Cached per accession,
// so the extra input is paid once per company per quarter.
const MAX_CHARS = 140_000;

const SYSTEM = `You summarise a single quarterly earnings press release for a professional investor who has already seen the headline numbers.

ABSOLUTE RULES
- Use ONLY the release text provided. You have no other knowledge of this company. Never add context, history, competitor comparison, valuation or market reaction.
- Every number you write must appear in the release text. Copy it as the release prints it, with the same unit — if a table is headed "in thousands" and shows 5,232, write $5.2 million or 5,232 thousand, never a figure of your own construction. Do not compute, derive, annualise or infer any number. If a figure is not in the text, write the point without a figure.
- Never describe anything as a beat or a miss unless the release itself says so: you have not been given consensus estimates.
- Guidance is what management SAYS WILL happen. Never present it as achieved.
- If the release genuinely contains no negatives, say so in one line rather than inventing one.

OUTPUT — exactly this structure, no preamble, no headings other than these:

Positives:
* <3 to 5 bullets. Each names the specific fact and its figure from the release.>

Negatives:
* <3 to 5 bullets. Segment declines, margin pressure, cash outflows, elevated spend, stated risks, weak guided lines.>

Overall Assessment: <one paragraph, 3-6 sentences: what the quarter establishes, what it leaves open, and what will decide the next few quarters according to the release itself. No recommendation, no price view.>`;

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

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const cik = Number(u.searchParams.get('cik') || 0);
  const accession = String(u.searchParams.get('accession') || '');
  const filingUrl = String(u.searchParams.get('filing_url') || '');
  const ticker = String(u.searchParams.get('ticker') || '').toUpperCase();
  const force = u.searchParams.get('force') === '1';
  if (!cik || !accession || !filingUrl) {
    return NextResponse.json({ ok: false, error: 'cik, accession and filing_url are required' }, { status: 400 });
  }

  const key = `us-ai-summary:${PROMPT_VERSION}:${accession}`;
  if (!force) {
    const hit = await kvGet<any>(key);
    if (hit?.summary) return NextResponse.json({ ok: true, cached: true, ...hit });
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
    const doc = await releaseDocument(cik, accession, filingUrl);
    if (doc.html) { text = htmlToText(doc.html); sourceUrl = doc.url; }
  } catch { /* handled below */ }
  if (text.length < 800) {
    return NextResponse.json({
      ok: false, available: false,
      error: 'This filing carries no readable press release — the exhibit is a scanned or image-based document, and nothing is summarised from a picture.',
    });
  }
  const clipped = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  // ── the call ─────────────────────────────────────────────────────────────
  let summary = '';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1400,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: `Earnings press release${ticker ? ` for ${ticker}` : ''} — summarise it under the required structure.\n\n<release>\n${clipped}\n</release>`,
        }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: `The summary service returned HTTP ${resp.status}.` });
    }
    const j: any = await resp.json();
    summary = (j?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n').trim();
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `The summary service did not answer (${String(e?.message || e)}).` });
  }
  if (!summary || !/Positives:/i.test(summary)) {
    return NextResponse.json({ ok: false, error: 'The summary came back in an unusable shape and was discarded.' });
  }

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
  const inRelease = numeralsIn(text);
  const lines = summary.split('\n');
  const dropped: string[] = [];
  const kept = lines.filter((ln) => {
    const bad = moneyTokens(ln).filter((f) => !supported(f, inRelease));
    if (!bad.length) return true;
    dropped.push(bad[0]);
    return false;
  });
  const bulletCount = (arr: string[]) => arr.filter((l) => /^\s*[*\-•]/.test(l)).length;
  if (dropped.length) {
    const before = bulletCount(lines), after = bulletCount(kept);
    // More than a third of the substance gone means the summary as a whole is
    // not trustworthy, not that one line slipped.
    if (!after || (before && after < before * 0.67)) {
      return NextResponse.json({
        ok: false,
        error: `The summary cited figures that do not appear in the release (${dropped.slice(0, 3).map((b) => `$${b}`).join(', ')}), so it was discarded rather than shown.`,
      });
    }
    summary = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  let documents: any[] = [];
  try { documents = (await filingExhibits(filingUrl)).slice(0, 12); } catch { documents = []; }

  const payload = {
    summary, source_url: sourceUrl, model: MODEL, documents,
    dropped_lines: dropped.length || undefined,
    generated_at: new Date().toISOString(),
  };
  await kvSet(key, payload, TTL_S);
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
