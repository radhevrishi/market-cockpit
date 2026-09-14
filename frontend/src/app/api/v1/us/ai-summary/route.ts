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
const PROMPT_VERSION = 'us-ai-summary-v1';
const TTL_S = 365 * 24 * 3600;          // a filed quarter is immutable
const MAX_CHARS = 60_000;               // ~15k tokens of release text

const SYSTEM = `You summarise a single quarterly earnings press release for a professional investor who has already seen the headline numbers.

ABSOLUTE RULES
- Use ONLY the release text provided. You have no other knowledge of this company. Never add context, history, competitor comparison, valuation or market reaction.
- Every number you write must appear verbatim in the release text. Do not compute, derive, annualise, convert or round any figure. If a figure is not in the text, write the point without a figure.
- Never describe anything as a beat or a miss unless the release itself says so: you have not been given consensus estimates.
- Guidance is what management SAYS WILL happen. Never present it as achieved.
- If the release genuinely contains no negatives, say so in one line rather than inventing one.

OUTPUT — exactly this structure, no preamble, no headings other than these:

Positives:
* <3 to 5 bullets. Each names the specific fact and its figure from the release.>

Negatives:
* <3 to 5 bullets. Segment declines, margin pressure, cash outflows, elevated spend, stated risks, weak guided lines.>

Overall Assessment: <one paragraph, 3-6 sentences: what the quarter establishes, what it leaves open, and what will decide the next few quarters according to the release itself. No recommendation, no price view.>`;

/** Every dollar figure the model wrote, so an invented one can be caught. */
function moneyTokens(text: string): string[] {
  return (text.match(/\$\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|thousand|bn|mm)?/gi) || [])
    .map((t) => t.replace(/\s+/g, ' ').trim().toLowerCase());
}

/** Loose containment: the release writes "$1.5 billion" and the model may too,
 *  but it may also write "$1.5B". Compare on the numeral, which is the part
 *  that can be wrong. */
function numeralsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(/\d[\d,]*(?:\.\d+)?/g) || []) out.add(m.replace(/,/g, ''));
  return out;
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
  const inRelease = numeralsIn(text);
  const bad = moneyTokens(summary)
    .map((t) => (t.match(/\d[\d,]*(?:\.\d+)?/) || [''])[0].replace(/,/g, ''))
    .filter((n) => n && !inRelease.has(n));
  if (bad.length) {
    return NextResponse.json({
      ok: false,
      error: `The summary cited ${bad.length === 1 ? 'a figure' : 'figures'} that ${bad.length === 1 ? 'does' : 'do'} not appear in the release (${bad.slice(0, 3).map((b) => `$${b}`).join(', ')}), so it was discarded rather than shown.`,
    });
  }

  let documents: any[] = [];
  try { documents = (await filingExhibits(filingUrl)).slice(0, 12); } catch { documents = []; }

  const payload = {
    summary, source_url: sourceUrl, model: MODEL, documents,
    generated_at: new Date().toISOString(),
  };
  await kvSet(key, payload, TTL_S);
  return NextResponse.json({ ok: true, cached: false, ...payload });
}
