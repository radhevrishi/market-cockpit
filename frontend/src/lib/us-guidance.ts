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
    [/\b(first|second|third|fourth|1st|2nd|3rd|4th)[\s\-]+quarter\b[^.]{0,60}?\bfiscal(?:\s+year)?\s*'?(\d{4}|\d{2})\b/i,
      (m) => ({ q: ORD[m[1].toLowerCase()], fy: yr(m[2]) })],
    // "Third Fiscal Quarter of 2026" (FuelCell's phrasing)
    [/\b(first|second|third|fourth|1st|2nd|3rd|4th)[\s\-]+fiscal[\s\-]+quarter\s+(?:of\s+)?'?(\d{4}|\d{2})\b/i,
      (m) => ({ q: ORD[m[1].toLowerCase()], fy: yr(m[2]) })],
    // "fiscal 2027 second quarter"
    [/\bfiscal(?:\s+year)?\s*'?(\d{4}|\d{2})\b[^.]{0,40}?\b(first|second|third|fourth|1st|2nd|3rd|4th)[\s\-]+quarter\b/i,
      (m) => ({ q: ORD[m[2].toLowerCase()], fy: yr(m[1]) })],
    // "Q2 FY27", "Q2 FY2027", "Q2 fiscal 2027"
    [/\bQ([1-4])\s*(?:FY|fiscal(?:\s+year)?)\s*'?(\d{4}|\d{2})\b/i,
      (m) => ({ q: Number(m[1]) as 1 | 2 | 3 | 4, fy: yr(m[2]) })],
    // "second quarter 2026 results" (no "fiscal" — calendar-year filers)
    [/\b(first|second|third|fourth)[\s\-]+quarter\b[^.]{0,40}?(?<!\d)(20\d{2})\b/i,
      (m) => ({ q: ORD[m[1].toLowerCase()], fy: yr(m[2]) })],
  ];
  // Position matters more than pattern order. A release names the quarter it is
  // REPORTING in its headline and the quarter it is GUIDING later on — eGain's
  // release says "Fourth Quarter and Fiscal Year 2026 Results" at the top and
  // "first quarter of fiscal 2027" in the outlook, and matching by pattern
  // order picked the outlook. So: take the EARLIEST match in the document,
  // searching the headline region first.
  const scan = (window: string): { q: 1 | 2 | 3 | 4 | null; fy: number | null } => {
    let best: { q: 1 | 2 | 3 | 4 | null; fy: number | null; at: number } | null = null;
    for (const [re, take] of pats) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = g.exec(window)) && guard++ < 20) {
        const got = take(m);
        if (!got.q || !got.fy) continue;
        // Never take a phrase that is plainly about the period AHEAD.
        const ctx = window.slice(Math.max(0, m.index - 90), m.index + m[0].length + 40);
        if (/\b(guidance|outlook|expects?|expected|forecast|anticipat|for the (?:third|fourth|first|second) quarter of)\b/i.test(ctx)
          && !/\b(results?|reported?|reports|announce)/i.test(ctx)) continue;
        if (!best || m.index < best.at) best = { ...got, at: m.index };
      }
    }
    return best ? { q: best.q, fy: best.fy } : { q: null, fy: null };
  };
  const flat = text.replace(/\s+/g, ' ');
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
      let pick = htm.find((it) => /ex[-_]?99|ex99|exhibit\s*99|press|earnings|release|results/i.test(String(it.name)));
      if (!pick) {
        const sorted = htm.slice().sort((a, b) => (parseInt(b.size, 10) || 0) - (parseInt(a.size, 10) || 0));
        pick = sorted[0];
      }
      if (pick) {
        const url = `${dir}/${pick.name}`;
        out = { url, html: await secGet(url) };
      }
    }
  } catch { out = { url: null, html: null }; }
  if (_doc.size > 600) {
    const oldest = Array.from(_doc.entries()).sort((a, b) => a[1].at - b[1].at).slice(0, 150);
    for (const [k] of oldest) _doc.delete(k);
  }
  _doc.set(key, { at: Date.now(), data: out });
  return out;
}

/**
 * Guidance for one earnings 8-K. `filingIndexUrl` is the …-index.htm URL we
 * already carry on every filing; the directory's index.json lists the exhibits.
 */
export async function guidanceFromFiling(cikNum: number, accession: string, filingIndexUrl: string): Promise<Guidance> {
  const key = accession || filingIndexUrl;
  const hit = _g.get(key);
  if (hit && Date.now() - hit.at < 7 * 24 * 3600_000) return hit.data;

  const none: Guidance = { label: null, score: 0, snippets: [], source_url: null, fiscal_label: null, fiscal_q: null, fiscal_fy: null, figures: [], metrics: [] };
  let out = none;
  try {
    {
      const doc = await releaseDocument(cikNum, accession, filingIndexUrl);
      {
        const url = doc.url;
        const html = doc.html;
        if (html && url) {
          const text = htmlToText(html);
          // Sentence split. A press release is not prose: the guidance line is
          // as often a bullet ("• Full-year FY27 revenue guidance of $192.0
          // billion") or a clause inside a long CEO quote as it is a standalone
          // sentence. Splitting ONLY on ". " missed Dell's "we're raising our
          // full-year FY27 revenue outlook by $25 billion" because the quote
          // ran past the 600-character cap. So split on sentence ends, bullets
          // and line breaks, then split anything still oversized at clause
          // boundaries before the length filter.
          const rough = text.split(/(?<=[.!?])\s+(?=[A-Z"“(])|\n+|\s*[•·▪]\s*/);
          // Also keep the coarse pass (sentence ends only): a guidance TABLE
          // reaches us as one long line whose pieces, split apart, each lose
          // either the period reference or the number.
          const sentences: string[] = text.split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
            .map((s) => s.replace(/\s+/g, ' ').trim())
            .filter((s) => s.length >= 40 && s.length <= 600);
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
            .filter((s) => s.length >= 30 && s.length <= 600)
            .filter((s) => FWD.test(s) && (PERIOD.test(s) || /guidance|outlook/i.test(s)))
            // Safe-harbour boilerplate lists every forward-looking verb there
            // is; it is not guidance.
            .filter((s) => !/forward[- ]looking statements|safe harbor|private securities litigation|words or expressions that refer to future/i.test(s));
          const c = classify(kept);
          const fl = fiscalLabelFromText(text);
          out = {
            label: c.label, score: c.score, snippets: c.picked, source_url: url,
            fiscal_label: (fl.q && fl.fy) ? `Q${fl.q} FY${String(fl.fy).slice(2)}` : null,
            fiscal_q: fl.q, fiscal_fy: fl.fy,
            figures: guidanceFiguresFromText(text),
            metrics: keyMetricsFromText(text),
          };
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
