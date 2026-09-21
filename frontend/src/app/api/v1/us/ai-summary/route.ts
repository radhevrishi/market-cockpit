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
import {
  SUMMARY_TOOL, SYSTEM_BASE,
  moneyTokens, numeralsIn, supported, pctTokens, valuesIn, supportedPct,
} from '@/lib/earnings/ai-summary-shared';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5-20251001';
const PROMPT_VERSION = 'us-ai-summary-v7';  // zzz720 — structural block. A version bump invalidates every cached summary, which is correct: a v6 reading has none of the new fields and would read as "not disclosed" forever.
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

// zzz700 — the schema, the prompt and the verifier now live in one module so
// the India route asks the identical question and checks the answer the same
// way. Only the market-specific parts stay here.
const SYSTEM = SYSTEM_BASE;

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

  // ── v6 FIELDS GO THROUGH THE SAME GATE.                        (zzz699)
  //
  // Every new block carries figures, and a figure the release does not print
  // is exactly as unacceptable here as it was in a positive. The rule stays
  // per-item: one unsupported capacity number costs that project, not the
  // whole capex list. Enum and quote fields carry no arithmetic and are left
  // alone — an evidence_quote is checked by being a quote, not by numerals.
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
