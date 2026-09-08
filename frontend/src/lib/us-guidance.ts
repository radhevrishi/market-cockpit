// ═══════════════════════════════════════════════════════════════════════════
// US GUIDANCE (server-only) — read straight from the earnings press release.
//
// An earnings 8-K carries the press release as Exhibit 99.1. That exhibit is
// where "raised full-year guidance" lives, and for a US print it is as
// important as the numbers: the market trades the outlook. The India engine
// has a guidance-text scan (`positiveGuidance`, Path A of the BLOCKBUSTER
// gate); this is the US equivalent, from a primary source, for free.
//
//   1. {filing index}/index.json  →  find the EX-99 press-release document
//   2. fetch it, strip HTML to text
//   3. find guidance sentences; classify RAISED / MAINTAINED / LOWERED /
//      PROVIDED (gave numbers, no explicit direction) / WITHDRAWN / null
//   4. keep up to three verbatim snippets so the card can show the words
//
// Two EDGAR requests per filer, cached with the filing (immutable). Same
// User-Agent rule as everything else on sec.gov.
// ═══════════════════════════════════════════════════════════════════════════

import { guidanceFiguresFromText, type GuidanceFigure } from './us-guidance-figures';
import { keyMetricsFromText, type KeyMetric } from './us-key-metrics';

const SEC_UA = process.env.SEC_USER_AGENT || 'market-cockpit research radhev.232@gmail.com';

export type GuidanceLabel = 'RAISED' | 'MAINTAINED' | 'LOWERED' | 'PROVIDED' | 'WITHDRAWN';

/**
 * WHY A CARD SHOWS NO OUTLOOK. Three very different facts used to look
 * identical to the reader — a blank where the guidance block goes:
 *
 *   'unreadable-format'    the company DID publish an outlook, in a document
 *                          this engine cannot read. Affirm puts its guidance
 *                          only in a shareholder letter filed as 24 JPEGs
 *                          wrapped in 7kB of HTML (FQ4 2026, 27 Aug); there is
 *                          no text to find, and no amount of pattern-matching
 *                          would ever find it. The document is linked so it can
 *                          be opened and read by eye.
 *   'none-given'           the release WAS readable and carries no
 *                          forward-looking figures. The company gave no
 *                          outlook, which is itself information.
 *   'release-unavailable'  the exhibit could not be fetched from EDGAR at all.
 *
 * The owner reads this engine as his only source. Saying which of the three it
 * is costs one line and is the difference between a fact and a silence.
 */
export type GuidanceAbsentReason = 'unreadable-format' | 'none-given' | 'release-unavailable';

export interface Guidance {
  label: GuidanceLabel | null;
  score: number;                 // −1 … +1
  snippets: string[];            // verbatim sentences, ≤ 3
  source_url: string | null;     // the exhibit we read
  /** The company's OWN name for the quarter, from the release's headline —
   *  "Q2 FY27", "Q4 FY26". This is what the street and every earnings site
   *  call it, and no calendar rule reproduces it: NetApp's July quarter is
   *  Q1 FY27, Five Below's August quarter is Q2 FY26, and SEC's own fy/fp
   *  field disagrees with the filer on both. */
  fiscal_label: string | null;
  fiscal_q: 1 | 2 | 3 | 4 | null;
  fiscal_fy: number | null;
  /** The guided numbers themselves — see lib/us-guidance-figures. */
  figures: GuidanceFigure[];
  /** REPORTED operating metrics from the same release (ARR, RPO, NRR, FCF…) —
   *  see lib/us-key-metrics. Read here so the exhibit is fetched once. */
  metrics: KeyMetric[];
  /** Set ONLY when nothing was found — never alongside a label or figures. */
  absent_reason: GuidanceAbsentReason | null;
  /** The document the outlook is in, when 'unreadable-format' says there is
   *  one. Linked on the card so it can be opened directly. */
  absent_doc_url: string | null;
  /** What that document is, in the filer's own words where EDGAR carries a
   *  description ("Shareholder Letter"), else its exhibit number. */
  absent_doc_label: string | null;
}

const _g = new Map<string, { at: number; data: Guidance }>();
let _lastSlot = 0;
async function gate() {
  const now = Date.now();
  const slot = Math.max(now, _lastSlot + 165);
  _lastSlot = slot;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}
async function secGet(url: string): Promise<string | null> {
  try {
    await gate();
    const res = await fetch(url, {
      headers: { 'User-Agent': SEC_UA, 'Accept': '*/*', 'Accept-Encoding': 'gzip, deflate' },
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#\d+;/g, ' ')
    // HEX ENTITIES LEAVE A FOUR-DIGIT NUMBER BEHIND, AND IT READS AS A YEAR.
    //
    // Only the DECIMAL form was stripped, so ServiceTitan's release — which
    // writes its dateline dashes as `&#x2013;` — reached the fiscal-year scan
    // as "…Announces Fiscal Second Quarter Financial Results LOS ANGELES x2013
    // September 8, 2026…". The bare-year pattern read the 2013 out of `x2013`
    // and labelled a quarter that ended in July 2026 "Q2 FY13". Every filer
    // that types an en-dash, an em-dash or a curly quote (which is most of
    // them) carries this hazard; it only surfaces on the ones whose entity
    // digits look like a year. Hex entities are now removed exactly as the
    // decimal ones are.
    .replace(/&#x[0-9a-f]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const FWD = /\b(guidance|outlook|expects?|expected|anticipates?|forecasts?|projects?|targets?|we (?:now )?see|is (?:now )?expected to be|to be in the range|in the range of)\b/i;
const PERIOD = /\b(full[- ]year|fiscal (?:year|\d{4}|q[1-4])|fy\s?'?\d{2,4}|(?:first|second|third|fourth|next) quarter|q[1-4]\s?(?:fy)?'?\d{2,4}|for (?:the )?(?:year|quarter)|remainder of (?:the )?(?:year|fiscal))\b/i;
const MONEY = /(\$\s?\d[\d,.]*\s?(?:million|billion|thousand|m|b)?|\d+(?:\.\d+)?\s?%|\$\d+\.\d{2})/i;

const RAISE = /\b(rais(?:e|es|ed|ing)|increas(?:e|es|ed|ing)|upward|above (?:the )?(?:prior|previous)|higher end|ahead of)\b[^.]{0,80}\b(guidance|outlook|forecast|range|view)|\b(guidance|outlook|forecast)s?\b[^.]{0,60}\b(rais(?:e|es|ed|ing)|increas(?:e|es|ed|ing)|upward)/i;
const LOWER = /\b(lower(?:s|ed|ing)?|reduc(?:e|es|ed|ing)|cut(?:s|ting)?|below (?:the )?(?:prior|previous)|downward|trim(?:s|med|ming)?)\b[^.]{0,80}\b(guidance|outlook|forecast|range|view)|\b(guidance|outlook|forecast)s?\b[^.]{0,60}\b(lower(?:s|ed|ing)?|reduc(?:e|es|ed|ing)|cut|downward|trim)/i;
const MAINTAIN = /\b(reaffirm(?:s|ed|ing)?|reiterat(?:e|es|ed|ing)|maintain(?:s|ed|ing)?|unchanged|affirm(?:s|ed|ing)?|confirm(?:s|ed|ing)?)\b[^.]{0,80}\b(guidance|outlook|expectation|forecast|range)/i;
const WITHDRAW = /\b(withdraw(?:s|n|ing)?|suspend(?:s|ed|ing)?|no longer providing)\b[^.]{0,60}\b(guidance|outlook)/i;

function classify(sentences: string[]): { label: GuidanceLabel | null; score: number; picked: string[] } {
  let raised = 0, lowered = 0, maintained = 0, provided = 0, withdrawn = 0;
  const picked: string[] = [];
  for (const s of sentences) {
    const isRaise = RAISE.test(s), isLower = LOWER.test(s), isMaint = MAINTAIN.test(s), isWd = WITHDRAW.test(s);
    if (isWd) { withdrawn++; picked.push(s); continue; }
    if (isRaise && !isLower) { raised++; picked.push(s); continue; }
    if (isLower && !isRaise) { lowered++; picked.push(s); continue; }
    if (isMaint) { maintained++; picked.push(s); continue; }
    if (FWD.test(s) && PERIOD.test(s) && MONEY.test(s)) { provided++; if (picked.length < 6) picked.push(s); }
  }
  let label: GuidanceLabel | null = null;
  let score = 0;
  if (withdrawn && !raised) { label = 'WITHDRAWN'; score = -0.8; }
  else if (raised && lowered) { label = raised >= lowered ? 'RAISED' : 'LOWERED'; score = raised >= lowered ? 0.5 : -0.5; }
  else if (raised) { label = 'RAISED'; score = 1; }
  else if (lowered) { label = 'LOWERED'; score = -1; }
  else if (maintained) { label = 'MAINTAINED'; score = 0.15; }
  else if (provided) { label = 'PROVIDED'; score = 0.25; }
  // prefer directional sentences first, then numeric ones; cap at 3, trim
  const ordered = picked
    .sort((a, b) => Number(RAISE.test(b) || LOWER.test(b) || WITHDRAW.test(b)) - Number(RAISE.test(a) || LOWER.test(a) || WITHDRAW.test(a)))
    // strip the EDGAR exhibit header that sometimes precedes the first sentence
    .map((s) => s.replace(/^(?:EX-99(?:\.\d+)?\s+\d+\s+\S+\.htm\s+)?(?:EX-99(?:\.\d+)?\s+)?(?:Document\s+)?(?:Exhibit\s+99(?:\.\d+)?\s+)?/i, '').trim())
    .map((s) => s.length > 260 ? s.slice(0, 257) + '…' : s)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 3);
  return { label, score, picked: ordered };
}

// ─── the company's own fiscal-quarter name ────────────────────────────────
const ORD: Record<string, 1 | 2 | 3 | 4> = {
  first: 1, second: 2, third: 3, fourth: 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4,
};
/**
 * "…Announces Second Quarter Fiscal 2026 Results" → { q: 2, fy: 2026 }.
 * Read from the top of the release, where the filer names the period. Falls
 * back through several phrasings; returns nulls when it cannot be certain.
 */
export function fiscalLabelFromText(text: string): { q: 1 | 2 | 3 | 4 | null; fy: number | null } {
  const yr = (s: string): number | null => {
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) return null;
    if (n >= 1990 && n <= 2100) return n;
    if (n >= 0 && n <= 99) return 2000 + n;
    return null;
  };
  const pats: Array<[RegExp, (m: RegExpExecArray) => { q: 1 | 2 | 3 | 4 | null; fy: number | null }]> = [
    // "second quarter of fiscal year 2027", "fourth quarter and full year fiscal 2026"
    // "FY 2026" is the same token as "fiscal 2026" and is how a filer writes it
    // when the year leads: Toll Brothers' headline is "Reports FY 2026 Third
    // Quarter Results", which no pattern here used to match at all, so the
    // scan fell through to a comparative sentence deeper in the release.
    [/\b(first|second|third|fourth|1st|2nd|3rd|4th)[\s\-]+quarter\b[^.]{0,60}?\b(?:fiscal(?:\s+year)?|FY)\s*'?(\d{4}|\d{2})\b/i,
      (m) => ({ q: ORD[m[1].toLowerCase()], fy: yr(m[2]) })],
    // "Third Fiscal Quarter of 2026" (FuelCell's phrasing)
    [/\b(first|second|third|fourth|1st|2nd|3rd|4th)[\s\-]+fiscal[\s\-]+quarter\s+(?:of\s+)?'?(\d{4}|\d{2})\b/i,
      (m) => ({ q: ORD[m[1].toLowerCase()], fy: yr(m[2]) })],
    // "fiscal 2027 second quarter", "FY 2026 Third Quarter"
    [/\b(?:fiscal(?:\s+year)?|FY)\s*'?(\d{4}|\d{2})\b[^.]{0,40}?\b(first|second|third|fourth|1st|2nd|3rd|4th)[\s\-]+quarter\b/i,
      (m) => ({ q: ORD[m[2].toLowerCase()], fy: yr(m[1]) })],
    // "Q2 FY27", "Q2 FY2027", "Q2 fiscal 2027"
    [/\bQ([1-4])\s*(?:FY|fiscal(?:\s+year)?)\s*'?(\d{4}|\d{2})\b/i,
      (m) => ({ q: Number(m[1]) as 1 | 2 | 3 | 4, fy: yr(m[2]) })],
    // "second quarter 2026 results" (no "fiscal" — calendar-year filers)
    // The year must stand alone: `(?<!\d)` let "x2013" — the tail of an
    // undecoded `&#x2013;` en-dash — pass as the year 2013. A year glued to any
    // letter or digit is part of another token, never a fiscal year.
    [/\b(first|second|third|fourth)[\s\-]+quarter\b[^.]{0,40}?(?<![A-Za-z0-9])(20\d{2})\b/i,
      (m) => ({ q: ORD[m[1].toLowerCase()], fy: yr(m[2]) })],
  ];
  // Position matters more than pattern order. A release names the quarter it is
  // REPORTING in its headline and the quarter it is GUIDING later on — eGain's
  // release says "Fourth Quarter and Fiscal Year 2026 Results" at the top and
  // "first quarter of fiscal 2027" in the outlook, and matching by pattern
  // order picked the outlook. So: take the EARLIEST match in the document,
  // searching the headline region first.
  //
  // THE HEADLINE OWNS THE QUARTER; THE BODY MAY ONLY SUPPLY ITS YEAR.
  //
  // The scans below reach up to 6,000 characters into the release to find a
  // year, and everything that deep is a comparative, a footnote or a forward
  // reference. Dick's says "Reports Second Quarter Results" at the top and, four
  // thousand characters down, "Foot Locker will not be included in quarterly
  // comparable sales until the fourth quarter of fiscal 2026" — a sentence that
  // is about neither the quarter reported nor the year of it, and which relabelled
  // the card Q4. A quarter ordinal that disagrees with the one in the headline is
  // therefore never the reported quarter, whatever year sits beside it.
  //
  // Only the HEADLINE may veto, not the first ordinal anywhere in the release:
  // plenty of filers name no quarter up top at all ("H&R Block Reports Fiscal
  // 2026 Results"; VF's release opens with a 53-week-calendar footnote), and the
  // first ordinal in their body text is as arbitrary as the deep matches this
  // rule exists to reject. When the headline is silent the rule stands down.
  const flat = text.replace(/\s+/g, ' ');
  const headQ = quarterOrdinalFromText(flat.slice(0, 400));
  const scan = (window: string): { q: 1 | 2 | 3 | 4 | null; fy: number | null } => {
    let best: { q: 1 | 2 | 3 | 4 | null; fy: number | null; at: number } | null = null;
    for (const [re, take] of pats) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = g.exec(window)) && guard++ < 20) {
        const got = take(m);
        if (!got.q || !got.fy) continue;
        if (headQ != null && got.q !== headQ) continue;   // see the headline note above
        // Never take a phrase that is plainly about the period AHEAD.
        //
        // "FOR THE SECOND QUARTER OF …" IS NOT A FORWARD-LOOKING PHRASE.
        //
        // This test used to carry `for the (third|fourth|first|second) quarter
        // of` as one of its forward-looking signals, and that string is the
        // ordinary way an American income-statement paragraph names the quarter
        // it is REPORTING: The Buckle's release says "Net income for the second
        // quarter of fiscal 2026 was $44.4 million". No "results/reported/
        // announce" happened to sit in the surrounding 130 characters, so the
        // filer's own, correct label was thrown away — and the scan walked on
        // and took "the second quarter of fiscal 2025" out of a comparative
        // sentence 1,600 characters further down, which is how a quarter that
        // ended in August 2026 came out labelled Q2 FY25. The genuinely
        // forward-looking words below are enough; a quarter ordinal that
        // disagrees with the headline is already rejected by `headQ`.
        const ctx = window.slice(Math.max(0, m.index - 90), m.index + m[0].length + 40);
        if (/\b(guidance|outlook|expects?|expected|forecast|anticipat)\b/i.test(ctx)
          && !/\b(results?|reported?|reports|announce)/i.test(ctx)) continue;
        // A YEAR THAT BELONGS TO THE OUTLOOK IS NOT THE YEAR BEING REPORTED.
        //
        // The sentence guard above is a blunt instrument on a headline that
        // states BOTH periods, because one "Reports" anywhere in the 90
        // characters around the match exempts the whole thing. Donaldson's Q4
        // release — a July year-end, so its just-closed year and the year it is
        // guiding differ — reads "Donaldson Reports Record Fourth Quarter and
        // Full-Year 2026 Sales and Earnings · Fiscal 2027 Guidance Projects
        // All-Time High Sales and EPS". The first pattern's 60-character bridge
        // steps straight over "Full-Year 2026" and marries "Fourth Quarter" to
        // "Fiscal 2027", and the card said Q4 FY27 for a quarter Donaldson
        // itself calls Q4 FY26. Two positional rules fix that class:
        const spanned = Array.from(m[0].matchAll(/(?<!\d)(?:'\d{2}|(?:19|20)\d{2})(?!\d)/g))
          .map((y) => yr(y[0].replace(/^'/, '')))
          .filter((n): n is number => n != null);
        //  • A match that spans TWO DIFFERENT years has bridged two period
        //    phrases and cannot say which one owns the quarter. Drop it and let
        //    a tighter pattern — one that stops at the nearer year — speak.
        if (new Set(spanned).size > 1) continue;
        //  • A year immediately followed by "guidance"/"outlook" is the period
        //    being GUIDED, however the rest of the headline reads. This is the
        //    same trap without an intervening year: "Reports Fourth Quarter
        //    Results; Provides Fiscal 2027 Guidance".
        const after = window.slice(m.index + m[0].length, m.index + m[0].length + 24);
        if (/^[\s\-–—·|,;]{0,4}(?:full[\s-]?year\s+)?(?:guidance|outlook|forecast|targets?)\b/i.test(after)) continue;
        // A PERIOD-END DATE IS NOT A FISCAL YEAR.
        //
        // Titan Machinery's headline is "Announces Results for Fiscal Second
        // Quarter Ended July 31, 2026". The last pattern — the one that accepts
        // a bare year with no "fiscal" in front of it, for calendar-year
        // filers — read the "2026" out of that date and labelled the quarter
        // Q2 FY26. Titan's year ends in January, so the quarter that closed on
        // 31 Jul 2026 is Q2 FY27, which is what its own body text and its XBRL
        // both say. A written month-day-year at the END of the match is a date,
        // never a fiscal-year name: drop it, and the fiscal year comes from a
        // phrase that actually names one ("our fiscal 2027 second quarter") or
        // from XBRL, which is dependable on the year.
        if (/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*'?\d{2,4}\s*$/i.test(m[0])) continue;
        // NOR IS THE PERIOD IT IS BEING COMPARED AGAINST.
        //
        // The guard above sends the reader deeper into the release, and the
        // next quarter phrase in the text is usually the YEAR-AGO one:
        // AutoZone's release says "net sales of $4.8 billion for its third
        // quarter (12 weeks) ended May 9, 2026, an increase of 8.4% from the
        // third quarter of fiscal 2025" — and "fiscal 2025" is the comparative,
        // not the quarter being reported. A phrase introduced by from / versus
        // / compared to names a prior period by construction.
        const before = window.slice(Math.max(0, m.index - 30), m.index);
        if (/\b(?:from|versus|vs\.?|compared\s+(?:to|with)|against|over|than)\s+(?:the\s+)?$/i.test(before)) continue;
        // THE CONNECTIVE IS RARELY THE WORD IMMEDIATELY BEFORE THE PERIOD.
        //
        // The rule above only fires when the comparative word sits directly
        // against the phrase, and an earnings release almost never writes it
        // that way: La Rosa Holdings says "Total revenue was $15.1 million,
        // compared with $20.2 million in the second quarter of 2025", and The
        // Buckle says "compared with 440 stores in 42 states at the end of the
        // second quarter of fiscal 2025". Both name a PRIOR period, and both
        // slipped through with a whole clause between the connective and the
        // phrase — which is how each of them ended up labelled with a fiscal
        // year two years stale on a quarter that ended in mid-2026.
        //
        // So look back a full clause rather than thirty characters, and stop at
        // the sentence boundary so a connective belonging to the PREVIOUS
        // sentence can never condemn this one. Anything introduced by a
        // comparison — or explicitly named as the year-ago period — is a
        // comparative and is not the quarter being reported.
        const clause = window.slice(Math.max(0, m.index - 200), m.index);
        const sentence = clause.slice(Math.max(
          clause.lastIndexOf('. ') + 1, Math.max(clause.lastIndexOf(';'), clause.lastIndexOf('•')) + 1));
        if (/\b(?:compared\s+(?:to|with)|versus|vs\.?|against|than|from|over|up\s+from|down\s+from|prior[-\s]year|year[-\s]ago|same\s+(?:period|quarter)\s+(?:of|in|a\s+year))\b/i.test(sentence)) continue;
        if (!best || m.index < best.at) best = { ...got, at: m.index };
      }
    }
    return best ? { q: best.q, fy: best.fy } : { q: null, fy: null };
  };
  const near = scan(flat.slice(0, 1500));
  if (near.q && near.fy) return near;
  const wide = scan(flat.slice(0, 6000));
  if (wide.q && wide.fy) return wide;
  // THE QUARTER ALONE IS STILL THE FILER'S OWN WORD.
  //
  // Requiring the ordinal and the fiscal year to appear in one phrase threw
  // away the half we can trust. Dick's headline reads "Reports Second Quarter
  // Results" and puts the year elsewhere, so nothing matched and the label fell
  // back to SEC's fy/fp — which said Q4. Agilent's Q3 FY26 came out FY25 the
  // same way. SEC's fiscal YEAR is dependable; its fiscal PERIOD is what
  // disagrees with the filer. So return the ordinal on its own and let the
  // caller pair it with the year from XBRL.
  const q = quarterOrdinalFromText(flat);
  return { q, fy: null };
}

/**
 * The reported quarter's ordinal, from the release's own headline — no fiscal
 * year required. Guarded the same way as the full parser: a phrase that is
 * plainly about the period AHEAD is never the quarter being reported.
 */
export function quarterOrdinalFromText(text: string): 1 | 2 | 3 | 4 | null {
  const flat = text.replace(/\s+/g, ' ').slice(0, 2500);
  const re = /\b(first|second|third|fourth|1st|2nd|3rd|4th)[\s\-]+(?:fiscal[\s\-]+)?quarter\b/gi;
  let m: RegExpExecArray | null, guard = 0;
  while ((m = re.exec(flat)) && guard++ < 20) {
    const ctx = flat.slice(Math.max(0, m.index - 90), m.index + m[0].length + 60);
    if (/\b(guidance|outlook|expects?|expected|forecast|anticipat)\b/i.test(ctx)
      && !/\b(results?|reported?|reports|announce|ended)/i.test(ctx)) continue;
    const q = ORD[m[1].toLowerCase()];
    if (q) return q;
  }
  // "…for the fiscal year ended June 30, 2026" with no quarter named at all is
  // a Q4 release: the fourth quarter is the one that closes the year.
  if (/\bfull[\s\-]?year\b|\bfiscal year (?:ended|results)\b/i.test(flat)
    && !/\b(first|second|third)[\s\-]+quarter\b/i.test(flat)) return 4;
  return null;
}

/**
 * The earnings press release itself (Exhibit 99.1) for one filing, cached with
 * the filing (immutable). Shared by the guidance scan and the press-release
 * income-statement reader so a filing's exhibit is fetched ONCE.
 */
export interface ReleaseDoc { url: string | null; html: string | null; }
const _doc = new Map<string, { at: number; data: ReleaseDoc }>();
export async function releaseDocument(cikNum: number, accession: string, filingIndexUrl: string): Promise<ReleaseDoc> {
  const key = accession || filingIndexUrl;
  const hit = _doc.get(key);
  if (hit && Date.now() - hit.at < 7 * 24 * 3600_000) return hit.data;
  let out: ReleaseDoc = { url: null, html: null };
  try {
    const dir = filingIndexUrl.replace(/\/[^/]*$/, '');
    const idxTxt = await secGet(`${dir}/index.json`);
    if (idxTxt) {
      const idx = JSON.parse(idxTxt);
      const items: any[] = idx?.directory?.item || [];
      // The press release: EX-99 / ex99 / "pressrelease" / "earnings" .htm; fall
      // back to the largest .htm that is not the 8-K wrapper or an XML/graphic.
      const htm = items.filter((it) => /\.htm(l)?$/i.test(String(it.name)) && !/^R\d+\.htm/i.test(String(it.name)));
      // THE FIRST NAME THAT MATCHES IS NOT THE PRESS RELEASE.
      //
      // The old rule was `find(name matches ex99|press|earnings|release|results)`
      // over EDGAR's directory listing, which is alphabetical. SentinelOne
      // (ticker S) files two EX-99 documents with every print: the release
      // (…q127exhibit991.htm) and an earnings SLIDE DECK whose wrapper is
      // …q1fy27earningspresenta.htm — 40 .jpg files behind 45kB of HTML. The
      // word "earnings" matches both, "s-q1…" sorts before "sentinelone…", and
      // so every SentinelOne quarter was read out of a picture of a deck. The
      // deck's thin text still yielded a guidance LABEL, which suppressed the
      // sibling-exhibit fallback below, so `priorGuidanceFor` came back "no
      // parseable guidance figures" and the card said "No prior guide to compare
      // against" for a company that had guided the quarter explicitly.
      //
      // So: RANK, then VERIFY. A name that says press/news release outranks a
      // bare "ex99", which outranks a name that merely contains "earnings"; a
      // name that says presentation, deck, slides, transcript or letter is
      // pushed behind all of them, because those documents exist ALONGSIDE a
      // release rather than instead of one. Then the winner is fetched and its
      // text measured: a wrapper around images yields almost nothing against its
      // own byte size, and the next candidate is tried instead. Both halves are
      // generic — the ranking reads words every filer uses, and the verification
      // reads the file, not the filer.
      const DECKISH = /present|slide|deck|infograph|prepared[-_\s]*remarks|transcript|script|supplement|letter|webcast|graphic|logo/i;
      const rank = (name: string): number => {
        const n = name.toLowerCase();
        let base = 5;
        if (/press[-_]?release|news[-_]?release|earnings[-_]?release/.test(n)) base = 0;
        else if (/ex[-_.]?99[-_.]?1(?![0-9])|exhibit[-_]?99[-_.]?1(?![0-9])/.test(n)) base = 1;
        else if (/ex[-_.]?99|exhibit[-_]?99/.test(n)) base = 2;
        else if (/earnings|results|release/.test(n)) base = 3;
        return base + (DECKISH.test(n) ? 10 : 0);
      };
      const ranked = htm.slice().sort((a, b) =>
        rank(String(a.name)) - rank(String(b.name))
        || (parseInt(String(b.size), 10) || 0) - (parseInt(String(a.size), 10) || 0));
      let firstTried: ReleaseDoc | null = null;
      for (const cand of ranked.slice(0, 3)) {
        const url = `${dir}/${cand.name}`;
        const html = await secGet(url);
        if (!html) continue;
        const doc: ReleaseDoc = { url, html };
        if (!firstTried) firstTried = doc;
        // A picture of a document is not a document. Same ratio test the
        // sibling-exhibit scan uses, so the two agree on what "readable" means.
        if (!textIsNegligible(html, parseInt(String(cand.size), 10) || 0)) { out = doc; break; }
      }
      // Every candidate was a picture. Hand back the best-ranked one anyway, so
      // the caller still reports 'unreadable-format' rather than a blank.
      if (!out.html && firstTried) out = firstTried;
    }
  } catch { out = { url: null, html: null }; }
  if (_doc.size > 600) {
    const oldest = Array.from(_doc.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 150);
    for (const [k] of oldest) _doc.delete(k);
  }
  _doc.set(key, { at: Date.now(), data: out });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE EXHIBIT SET, AND WHICH OF IT THIS ENGINE CAN READ
//
// `index.json` lists a filing's files but types every one of them by the ICON
// EDGAR draws beside it ("text.gif"), so it cannot say which file is EX-99.2.
// The filing's own …-index.htm carries the real document table — sequence,
// description, document, TYPE, size — and that is what is parsed here.
//
// Nothing about this is company-specific: an exhibit is unreadable when the
// text that can be extracted from it is negligible against its own byte size,
// or when it is a format this engine does not decode at all (a PDF, an image).
// No OCR is attempted, and none is planned — an OCR'd number is a guess, and a
// guessed number is worse than an honest blank.
// ═══════════════════════════════════════════════════════════════════════════

export interface FilingExhibit {
  name: string;          // file name
  url: string;           // absolute
  type: string;          // "EX-99.1", "EX-99.2", "8-K"…
  description: string;   // EDGAR's own description, often "Shareholder Letter"
  size: number;          // bytes, as EDGAR reports them
}

const _exh = new Map<string, { at: number; data: FilingExhibit[] }>();
/** The filing's document table, from its …-index.htm. Cached with the filing
 *  (immutable). One request, and only ever made when guidance came up empty. */
async function filingExhibits(filingIndexUrl: string): Promise<FilingExhibit[]> {
  const hit = _exh.get(filingIndexUrl);
  if (hit && Date.now() - hit.at < 7 * 24 * 3600_000) return hit.data;
  const out: FilingExhibit[] = [];
  try {
    const html = await secGet(filingIndexUrl);
    if (html) {
      const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      for (const r of rows.slice(0, 200)) {
        const cells = (r.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []);
        if (cells.length < 4) continue;
        const href = /<a[^>]+href=["']([^"']+)["']/i.exec(r)?.[1] || '';
        if (!href) continue;
        const txt = cells.map((c) => c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim());
        // EDGAR's document table has a fixed shape — seq, description,
        // DOCUMENT, type, size — so the columns are read relative to the one
        // carrying the link rather than by guessing which cell looks like a
        // type. (Affirm's description column repeats the exhibit number, so a
        // "cell that looks like EX-99.x" rule lands on the wrong column and
        // then reads the file NAME as the byte size.)
        const aIdx = cells.findIndex((c) => /<a[^>]+href=/i.test(c));
        if (aIdx < 0) continue;
        const size = parseInt((txt[aIdx + 2] || '').replace(/[^\d]/g, ''), 10);
        const name = href.split('/').pop() || '';
        const desc = aIdx > 0 ? txt[aIdx - 1] : '';
        out.push({
          name,
          url: href.startsWith('http') ? href : `https://www.sec.gov${href.replace(/^\/ix\?doc=/, '')}`,
          type: txt[aIdx + 1] || '',
          description: desc && desc !== name ? desc : '',
          size: Number.isFinite(size) ? size : 0,
        });
      }
    }
  } catch { /* an index we cannot read leaves the reason at 'none-given' */ }
  if (_exh.size > 800) {
    const oldest = Array.from(_exh.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 200);
    for (const [k] of oldest) _exh.delete(k);
  }
  _exh.set(filingIndexUrl, { at: Date.now(), data: out });
  return out;
}

/**
 * Wording for the card. EDGAR's own description is used when it says something
 * — many filers write "Shareholder Letter" there — but plenty just repeat the
 * exhibit number, and "its EX-99.2 carries no extractable text" tells a reader
 * nothing about what they would be opening. The file name is the fallback:
 * a document called …shareholderle.htm is a shareholder letter whatever the
 * description column says.
 */
function exhibitLabel(e: FilingExhibit): string {
  const d = (e.description || '').trim();
  const bareNumber = /^(?:ex[-\s.]?99[\d.]*|exhibit\s*99[\d.]*|99[\d.]*)$/i.test(d);
  if (d && !bareNumber && d.length <= 60 && /[A-Za-z]{3}/.test(d)) return d.toLowerCase();
  const n = `${e.name} ${d}`;
  if (/shareholder|stockholder/i.test(n)) return 'shareholder letter';
  if (/letter/i.test(n)) return 'letter to investors';
  if (/present|slide|deck/i.test(n)) return 'investor presentation';
  if (/supplement/i.test(n)) return 'supplemental exhibit';
  return e.type ? `${e.type} exhibit` : 'exhibit';
}

/**
 * Is this exhibit readable as TEXT by this engine?
 *
 * The rule is a ratio, not a list of file names: a document whose extracted
 * text is negligible against its own byte size is a picture of a document.
 * Affirm's FQ4-2026 shareholder letter is 7,678 bytes of HTML that yield 71
 * characters — the filename, twice — around 24 <img> tags; its FQ3-2026 letter
 * is the same 24 images WITH a text layer and yields 59,253 characters, and
 * that one the engine reads normally. Same company, same document, opposite
 * answers, decided by the file and not by the ticker.
 */
function textIsNegligible(html: string, bytes: number): boolean {
  const text = htmlToText(html);
  const len = text.replace(/\s+/g, ' ').trim().length;
  const size = Math.max(bytes || 0, html.length);
  if (len >= 2000) return false;                    // enough prose to scan either way
  return len < 600 || (size > 0 && len / size < 0.02);
}
const IMAGE_EXT = /\.(?:jpe?g|png|gif|tif{1,2}|bmp|webp)$/i;
const PDF_EXT = /\.pdf$/i;

/**
 * The guidance scan over one document's text. Split out of `guidanceFromFiling`
 * so the SAME scan can be run over a sibling exhibit — a company that files its
 * outlook in a shareholder letter rather than in the press release is not a
 * company without an outlook.
 */
function scanRelease(text: string): Pick<Guidance, 'label' | 'score' | 'snippets' | 'figures' | 'metrics'> {
  // A press release is not prose: the guidance line is as often a bullet
  // ("• Full-year FY27 revenue guidance of $192.0 billion") or a clause inside
  // a long CEO quote as it is a standalone sentence. Splitting ONLY on ". "
  // missed Dell's "we're raising our full-year FY27 revenue outlook by $25
  // billion" because the quote ran past the 600-character cap. So split on
  // sentence ends, bullets and line breaks, then split anything still oversized
  // at clause boundaries before the length filter.
  const rough = text.split(/(?<=[.!?])\s+(?=[A-Z"“(])|\n+|\s*[•·▪]\s*/);
  // Also keep the coarse pass (sentence ends only): a guidance TABLE reaches us
  // as one long line whose pieces, split apart, each lose either the period
  // reference or the number.
  const sentences: string[] = text.split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x.length >= 40 && x.length <= 600);
  for (const r0 of rough) {
    const r = r0.replace(/\s+/g, ' ').trim();
    if (!r) continue;
    if (r.length <= 600) { sentences.push(r); continue; }
    for (const piece of r.split(/(?<=[.;])\s+|\s+(?=and\s+(?:we|the\s+company)\b)/i)) {
      const p = piece.replace(/\s+/g, ' ').trim();
      if (p) sentences.push(p.length > 600 ? p.slice(0, 600) : p);
    }
  }
  const kept = Array.from(new Set(sentences))
    .filter((x) => x.length >= 30 && x.length <= 600)
    .filter((x) => FWD.test(x) && (PERIOD.test(x) || /guidance|outlook/i.test(x)))
    // Safe-harbour boilerplate lists every forward-looking verb there is; it is
    // not guidance.
    .filter((x) => !/forward[- ]looking statements|safe harbor|private securities litigation|words or expressions that refer to future/i.test(x));
  const c = classify(kept);
  return {
    label: c.label, score: c.score, snippets: c.picked,
    figures: guidanceFiguresFromText(text),
    metrics: keyMetricsFromText(text),
  };
}

/**
 * Guidance for one earnings 8-K. `filingIndexUrl` is the …-index.htm URL we
 * already carry on every filing; the directory's index.json lists the exhibits.
 */
export async function guidanceFromFiling(cikNum: number, accession: string, filingIndexUrl: string): Promise<Guidance> {
  const key = accession || filingIndexUrl;
  const hit = _g.get(key);
  if (hit && Date.now() - hit.at < 7 * 24 * 3600_000) return hit.data;

  const none: Guidance = {
    label: null, score: 0, snippets: [], source_url: null,
    fiscal_label: null, fiscal_q: null, fiscal_fy: null, figures: [], metrics: [],
    absent_reason: null, absent_doc_url: null, absent_doc_label: null,
  };
  let out = none;
  try {
    const doc = await releaseDocument(cikNum, accession, filingIndexUrl);
    if (!doc.html || !doc.url) {
      // Nothing was retrieved at all. That is not "the company gave no
      // outlook"; it is "we could not look".
      out = { ...none, absent_reason: 'release-unavailable' };
    } else {
      const text = htmlToText(doc.html);
      const scan = scanRelease(text);
      const fl = fiscalLabelFromText(text);
      out = {
        ...scan,
        source_url: doc.url,
        fiscal_label: (fl.q && fl.fy) ? `Q${fl.q} FY${String(fl.fy).slice(2)}` : null,
        fiscal_q: fl.q, fiscal_fy: fl.fy,
        absent_reason: null, absent_doc_url: null, absent_doc_label: null,
      };

      // ── nothing found: say WHY ────────────────────────────────────────────
      // The outlook may be in a SIBLING exhibit — a shareholder letter or a
      // deck filed as EX-99.2 — and that exhibit may or may not have any text
      // in it. Both cases are worth the extra request, and this is the only
      // path that makes one: a filer whose release states its guidance never
      // reaches here.
      // A LABEL WITHOUT FIGURES IS NOT A REASON TO STOP LOOKING.
      //
      // This used to require BOTH to be empty, and that conjunction is what
      // turned SentinelOne's mis-picked slide deck (see `releaseDocument`) into
      // a silent dead end: the deck's boilerplate scored a 'PROVIDED' label, the
      // label satisfied `!out.label`, and the real EX-99.1 sitting beside it in
      // the same filing was never opened. The numbers are the whole point of
      // this module — a "raised guidance" verdict with nothing under it cannot
      // be compared to a prior guide or to the street — so the sibling scan now
      // runs whenever the FIGURES are missing, and any label already found is
      // kept unless the sibling produces one of its own.
      if (!out.figures.length) {
        const readUrl = doc.url;
        const readName = readUrl.split('/').pop() || '';
        const sibs = (await filingExhibits(filingIndexUrl))
          .filter((e) => /^EX-99/i.test(e.type) && e.name && e.name !== readName)
          // A letter or a deck is where an outlook hides; plain graphics filed
          // alongside a release are not exhibits at all and never match.
          .sort((a, b) => Number(/letter|present|slide|deck|supplement/i.test(b.name + ' ' + b.description))
            - Number(/letter|present|slide|deck|supplement/i.test(a.name + ' ' + a.description)))
          .slice(0, 3);
        let unreadable: FilingExhibit | null = null;
        for (const e of sibs) {
          // A format this engine does not decode. No OCR is attempted.
          if (PDF_EXT.test(e.name) || IMAGE_EXT.test(e.name)) { unreadable = unreadable || e; continue; }
          if (!/\.(?:html?|txt)$/i.test(e.name) || e.size > 4_000_000) continue;
          const h = await secGet(e.url);
          if (!h) continue;
          if (textIsNegligible(h, e.size)) { unreadable = unreadable || e; continue; }
          // Readable, and possibly where the outlook actually is.
          const t2 = htmlToText(h);
          const s2 = scanRelease(t2);
          if (s2.label || s2.figures.length) {
            out = {
              ...out, ...s2, source_url: e.url,
              // The release's own directional wording outranks a sibling's when
              // the release had one and the sibling only carries the table.
              label: out.label ?? s2.label,
              snippets: out.snippets.length ? out.snippets : s2.snippets,
              metrics: out.metrics.length ? out.metrics : s2.metrics,
            };
            break;
          }
        }
        if (!out.label && !out.figures.length) {
          out = unreadable
            ? { ...out, absent_reason: 'unreadable-format', absent_doc_url: unreadable.url, absent_doc_label: exhibitLabel(unreadable) }
            : { ...out, absent_reason: 'none-given' };
        }
      }
    }
  } catch { out = none; }

  if (_g.size > 1500) {
    const oldest = Array.from(_g.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 300);
    for (const [k] of oldest) _g.delete(k);
  }
  _g.set(key, { at: Date.now(), data: out });
  return out;
}
