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

const SEC_UA = process.env.SEC_USER_AGENT || 'market-cockpit research radhev.232@gmail.com';

export type GuidanceLabel = 'RAISED' | 'MAINTAINED' | 'LOWERED' | 'PROVIDED' | 'WITHDRAWN';
export interface Guidance {
  label: GuidanceLabel | null;
  score: number;                 // −1 … +1
  snippets: string[];            // verbatim sentences, ≤ 3
  source_url: string | null;     // the exhibit we read
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

/**
 * Guidance for one earnings 8-K. `filingIndexUrl` is the …-index.htm URL we
 * already carry on every filing; the directory's index.json lists the exhibits.
 */
export async function guidanceFromFiling(cikNum: number, accession: string, filingIndexUrl: string): Promise<Guidance> {
  const key = accession || filingIndexUrl;
  const hit = _g.get(key);
  if (hit && Date.now() - hit.at < 7 * 24 * 3600_000) return hit.data;

  const none: Guidance = { label: null, score: 0, snippets: [], source_url: null };
  let out = none;
  try {
    const dir = filingIndexUrl.replace(/\/[^/]*$/, '');
    const idxTxt = await secGet(`${dir}/index.json`);
    if (idxTxt) {
      const idx = JSON.parse(idxTxt);
      const items: any[] = idx?.directory?.item || [];
      // The press release: EX-99 / ex99 / "pressrelease" / "earnings" .htm; fall
      // back to the largest .htm that is not the 8-K wrapper or an XML/graphic.
      const htm = items.filter((it) => /\.htm(l)?$/i.test(String(it.name)) && !/^R\d+\.htm/i.test(String(it.name)));
      let pick = htm.find((it) => /ex[-_]?99|ex99|press|earnings|release|results/i.test(String(it.name)));
      if (!pick) {
        const sorted = htm.slice().sort((a, b) => (parseInt(b.size, 10) || 0) - (parseInt(a.size, 10) || 0));
        pick = sorted[0];
      }
      if (pick) {
        const url = `${dir}/${pick.name}`;
        const html = await secGet(url);
        if (html) {
          const text = htmlToText(html);
          // Sentence split, keep only forward-looking ones near a period reference.
          const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“(])/).map((s) => s.replace(/\s+/g, ' ').trim())
            .filter((s) => s.length >= 40 && s.length <= 600)
            .filter((s) => FWD.test(s) && (PERIOD.test(s) || /guidance|outlook/i.test(s)));
          const c = classify(sentences);
          out = { label: c.label, score: c.score, snippets: c.picked, source_url: url };
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
