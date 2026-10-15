// zzz1051 — DOCUMENT SEARCH: cut a company document into passages for search.
//
// Pure (no I/O, tested in zzz1051-doc-search.test.ts). A passage is ≈ 300–500 words:
//   • it closes on a natural boundary when it can — a new speaker in a call transcript, a heading, a break between stored excerpts —
//     and never runs past MAX_WORDS (an over-long paragraph is cut at sentence ends);
//   • a passage cut only for size carries the last sentence(s) (≤ OVERLAP_WORDS) into the next one, so a sentence
//     that answers a question is never split across two passages and lost to both;
//   • no overlap across a hard break ("\n[…]\n" between stored excerpts) or into a new section;
//   • each passage keeps the speaker who says most of it (transcripts), the page it starts on (form-feed pages or
//     "Page N" lines) and the last heading above it.
// The text itself is never rewritten — passages are verbatim slices — so a quote shown to the owner is the company's.

export interface DocChunk {
  seq: number;
  text: string;
  words: number;
  speaker: string | null;
  page: number | null;
  section: string | null;
  /** words carried over from the previous passage (0 when it starts on a boundary) */
  overlapWords: number;
}

export const MIN_WORDS = 300;
export const TARGET_WORDS = 420;
export const MAX_WORDS = 500;
export const OVERLAP_WORDS = 50;
/** a last passage shorter than this joins the previous one when the two still fit */
const TAIL_WORDS = 80;

/** the separator lib/guidance-docs-store puts between stored excerpts */
const EXCERPT_SEP = /\n\s*\[…\]\s*\n/;

type UnitKind = 'para' | 'heading' | 'turn';
interface Unit { text: string; words: number; kind: UnitKind; speaker: string | null; page: number | null; hardBefore: boolean }

const wc = (s: string) => (s.match(/\S+/g) || []).length;

// "Moderator:", "Ashish Mehta:", "Ashish Mehta – CFO:", "Mr. R. Kumar - Managing Director:", "Q - Analyst:" at a line start
const SPEAKER_RE = /^((?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Shri|Smt\.?)?\s?[A-Z][A-Za-z.'’\-]*(?:\s+[A-Z][A-Za-z.'’\-]*){0,4})(?:\s*[-–—,(]\s*[A-Za-z&.,'’()\- ]{1,80}?)?\s*:\s+(?=\S)/;
const NOT_SPEAKER = /^(?:note|source|page|table|figure|fig|safe harbou?r|disclaimer|q[1-4]|fy\s?\d|h[12]|total|revenue|ebitda|pat|net|gross|operating|key|highlights?|agenda|date|time|subject|re|ref|ph|tel|email|website|cin|isin|regd|registered)\b/i;

/** The speaker name when a line opens a turn ("Name: …" / "Name – Title: …"), else null. */
export function speakerOf(line: string): string | null {
  const m = SPEAKER_RE.exec(line.trim());
  if (!m) return null;
  const name = m[1].trim();
  if (NOT_SPEAKER.test(name) || name.length < 2 || /\d/.test(name)) return null;
  return name;
}

const PAGE_LINE = /^\s*(?:-\s*)?(?:page\s+)?(\d{1,3})(?:\s*(?:of|\/)\s*\d{1,3})?(?:\s*-)?\s*$/i;
/** true for a short title-like line: no end punctuation, ≤ 12 words, mostly capitalised */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 90 || /[.,;:?!]$/.test(t) || /^\d+(\.\d+)?%?$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 12) return false;
  const caps = words.filter((w) => /^[A-Z0-9&(]/.test(w)).length;
  return t === t.toUpperCase() ? /[A-Z]{3}/.test(t) : caps / words.length >= 0.8 && words.length <= 8;
}

/** Splits text into sentences (keeps the end mark). */
function sentences(s: string): string[] {
  const out: string[] = [];
  const re = /[^.!?\n]+(?:[.!?]+["'’”)]*|\n|$)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) { const x = m[0]; if (x.trim()) out.push(x); if (re.lastIndex === m.index) re.lastIndex++; }
  return out.length ? out : [s];
}

/** Paragraph / turn / heading units, in order, each ≤ MAX_WORDS. */
function toUnits(raw: string): Unit[] {
  const text = String(raw || '').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ');
  const units: Unit[] = [];
  let speaker: string | null = null;
  let page: number | null = text.includes('\f') ? 1 : null;
  let hard = true;
  const blocks = text.split(EXCERPT_SEP);
  for (let bi = 0; bi < blocks.length; bi++) {
    hard = true;
    if (bi > 0) speaker = null;   // an excerpt boundary: who speaks next is unknown
    const pages = blocks[bi].split('\f');
    for (let pi = 0; pi < pages.length; pi++) {
      if (pi > 0) page = (page ?? 1) + 1;   // a page break is not a passage break (sentences run across pages)
      let buf: string[] = [];
      let bufKind: UnitKind = 'para';
      const flush = () => {
        const t = buf.join('\n').trim();
        buf = [];
        if (!t) return;
        const w = wc(t);
        if (w <= MAX_WORDS) { units.push({ text: t, words: w, kind: bufKind, speaker, page, hardBefore: hard }); hard = false; bufKind = 'para'; return; }
        // over-long paragraph: cut at sentence ends
        let cur = '', cw = 0, first = true;
        for (const s of sentences(t)) {
          const sw = wc(s);
          if (cw && cw + sw > TARGET_WORDS) {
            units.push({ text: cur.trim(), words: cw, kind: first ? bufKind : 'para', speaker, page, hardBefore: hard }); hard = false; first = false;
            cur = ''; cw = 0;
          }
          if (sw > MAX_WORDS) {   // a "sentence" with no stops (a table dump): cut by words
            const ws = s.trim().split(/\s+/);
            for (let i = 0; i < ws.length; i += TARGET_WORDS) {
              units.push({ text: ws.slice(i, i + TARGET_WORDS).join(' '), words: Math.min(TARGET_WORDS, ws.length - i), kind: 'para', speaker, page, hardBefore: hard }); hard = false;
            }
            continue;
          }
          cur += s; cw += sw;
        }
        if (cw) { units.push({ text: cur.trim(), words: cw, kind: first ? bufKind : 'para', speaker, page, hardBefore: hard }); hard = false; }
        bufKind = 'para';
      };
      for (const line of pages[pi].split('\n')) {
        const t = line.trim();
        if (!t) { flush(); continue; }
        const pm = PAGE_LINE.exec(t);
        if (pm && t.length <= 14) { flush(); const n = Number(pm[1]); if (n >= 1 && n <= 999) page = n; continue; }
        const sp = speakerOf(t);
        if (sp) { flush(); speaker = sp; bufKind = 'turn'; buf.push(t); continue; }
        if (isHeading(t) && !buf.length) { flush(); units.push({ text: t, words: wc(t), kind: 'heading', speaker, page, hardBefore: true }); hard = false; continue; }
        buf.push(t);
      }
      flush();
    }
  }
  return units;
}

/** Last sentence(s) of a passage, ≤ OVERLAP_WORDS, for the next passage to start with. */
export function overlapTail(text: string, maxWords = OVERLAP_WORDS): string {
  const ss = sentences(text);
  let out = '', w = 0;
  for (let i = ss.length - 1; i >= 0; i--) {
    const sw = wc(ss[i]);
    if (w + sw > maxWords) break;
    out = ss[i] + out; w += sw;
  }
  return out.trim();
}

/** Cut a document into passages. */
export function chunkDocument(text: string, opts: { minWords?: number; maxWords?: number; overlapWords?: number } = {}): DocChunk[] {
  const MIN = opts.minWords ?? MIN_WORDS, MAX = opts.maxWords ?? MAX_WORDS, OV = opts.overlapWords ?? OVERLAP_WORDS;
  const units = toUnits(text);
  const out: DocChunk[] = [];
  let cur: Unit[] = [];
  let curWords = 0;
  let carry = '';
  let section: string | null = null;
  let chunkSection: string | null = null;
  const close = (bySize: boolean) => {
    if (!cur.length) return;
    const body = (carry ? carry + '\n' : '') + cur.map((u) => u.text).join('\n\n');
    const bySpeaker = new Map<string, number>();
    for (const u of cur) if (u.speaker) bySpeaker.set(u.speaker, (bySpeaker.get(u.speaker) || 0) + u.words);
    let speaker: string | null = null, best = 0;
    for (const [k, v] of bySpeaker) if (v > best) { best = v; speaker = k; }
    const page = cur.find((u) => u.page != null)?.page ?? null;
    out.push({ seq: out.length, text: body, words: wc(body), speaker, page, section: chunkSection, overlapWords: carry ? wc(carry) : 0 });
    carry = bySize && OV > 0 ? overlapTail(cur.map((u) => u.text).join('\n\n'), OV) : '';
    cur = []; curWords = 0;
  };
  for (const u of units) {
    if (cur.length) {
      if (u.hardBefore) close(false);                                        // excerpt / page break: always a new passage
      else if (u.kind === 'heading' && curWords >= MIN / 2) close(false);    // a new section
      else if (u.kind === 'turn' && curWords >= MIN) close(false);           // a new speaker, once the passage is long enough
      else if (curWords + u.words > MAX) close(true);                        // too long: cut, carry the last sentence(s)
    }
    if (u.kind === 'heading') section = u.text.slice(0, 120);
    if (!cur.length) {
      if (u.hardBefore || u.kind === 'heading') carry = '';
      chunkSection = section;
      curWords = carry ? wc(carry) : 0;
    }
    cur.push(u); curWords += u.words;
  }
  close(false);
  // a short last passage joins the previous one when they still fit
  if (out.length >= 2) {
    const last = out[out.length - 1], prev = out[out.length - 2];
    if (last.words - last.overlapWords < TAIL_WORDS && prev.words + last.words - last.overlapWords <= Math.round(MAX * 1.2)) {
      const own = last.overlapWords ? last.text.slice(last.text.indexOf('\n') + 1) : last.text;
      prev.text = prev.text + '\n\n' + own;
      prev.words = wc(prev.text);
      out.pop();
    }
  }
  // drop passages that are only a heading or a page number
  return out.filter((c) => c.words >= 8 || out.length === 1).map((c, i) => ({ ...c, seq: i }));
}

// ── quarter label ────────────────────────────────────────────────────────────

/** 'Q1 FY27' (India, from the hint or the filing date) / 'Q2 2026' (US calendar quarter of the results). null when unknown. */
export function quarterLabel(market: 'IN' | 'US', filedAt: string | null | undefined, periodHint?: string | null): string | null {
  const h = String(periodHint || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const mh = /\bQ([1-4])\s?(?:FY\s?'?)(\d{2,4})\b/.exec(h);
  if (mh) return `Q${mh[1]} FY${mh[2].slice(-2)}`;
  const d = filedAt ? new Date(filedAt) : null;
  if (!d || isNaN(d.getTime())) return null;
  // results filed in a month report the last quarter that ended before that month
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;   // 1..12
  let qEnd = Math.floor((m - 1) / 3) * 3;                 // 0, 3, 6, 9  (month of the previous quarter end)
  if (qEnd === 0) { qEnd = 12; y -= 1; }
  if (market === 'US') return `Q${qEnd / 3} ${y}`;
  const fyQ = qEnd === 6 ? 1 : qEnd === 9 ? 2 : qEnd === 12 ? 3 : 4;
  const fy = qEnd === 3 ? y : y + 1;
  return `Q${fyQ} FY${String(fy).slice(-2)}`;
}
