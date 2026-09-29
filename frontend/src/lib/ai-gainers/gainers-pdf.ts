// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — THE PAGE AS A RESEARCH PDF.                    (zzz800)
//
// "⬇ Download PDF" on the AI Daily Gainers page writes what the page is
// showing for the selected market (India or USA) to an A4 research note.
//
// THE PAGE IS WHITE. Ink-friendly: near-black text on white, hairline rules,
// colour only where it carries meaning (verdict text and thin verdict
// borders — green / amber / red / blue). No dark fills anywhere.
//
// IT PRINTS WHAT THE VIEW SAYS, AND NOTHING ELSE. The input is the same
// ResearchView the page renders. No figure is computed or invented here; a
// section the view has nothing for is left out (no empty headings).
//
// TEXT IS REAL TEXT. Drawn with jsPDF's built-in Helvetica, so the words are
// crisp, selectable and searchable, and the file stays small. Helvetica has
// no ₹ glyph and no emoji, so every string goes through pdfText(): ₹ becomes
// "Rs", arrows become "->", emoji and badge symbols are dropped or turned
// into words. Nothing is ever drawn as a broken box.
//
// PURE: buildGainersPdf(jsPDF, input) takes the jsPDF constructor and returns
// the document — no clock unless `generatedAt` is left out, no network, no
// DOM — so it runs in the node tests. downloadGainersPdf() is the browser
// entry: it loads jspdf with a dynamic import (only on the click) and saves.
// ═══════════════════════════════════════════════════════════════════════════

import type { jsPDF as JsPdfDoc } from 'jspdf';
import type { ResearchItem, ResearchView } from './research-view';
import { scoreFactorLine } from './catalyst-score';

export type GainersMarket = 'IN' | 'US';

export interface GainersPdfInput {
  view: ResearchView;
  market: GainersMarket;
  /** The line under the session block on the page (US "as of" / India intraday note). */
  sessionNote?: string | null;
  /** US only: the scan criteria line, when the scan reported one. */
  criteria?: string | null;
  /** The page is showing the ?demo=1 fixture. */
  demo?: boolean;
  /** When the PDF was made. Left out → now. */
  generatedAt?: Date | string | null;
  /** Deflate the page streams (default true). False only to inspect the raw output. */
  compress?: boolean;
}

type RGB = [number, number, number];
type JsPdfCtor = new (opts?: any) => JsPdfDoc;

// ── Ink-friendly tokens ────────────────────────────────────────────────────
const INK: RGB = [23, 29, 41];
const INK2: RGB = [60, 72, 90];
const MUTED: RGB = [118, 130, 146];
const RULE: RGB = [214, 220, 228];
const GREEN: RGB = [21, 128, 61];
const RED: RGB = [185, 28, 28];
const AMBER: RGB = [168, 108, 6];
const BLUE: RGB = [29, 78, 160];
const LINK: RGB = [29, 78, 160];

/** The line a live US scan carries at the top of the report. */
const PROVISIONAL_LINE = 'PROVISIONAL — prices and rank can change until the close at 16:00 ET';
const PROVISIONAL_LINE_IN = 'PROVISIONAL — prices and rank can change until the close at 15:30 IST';
const FOOTER_TAIL = 'Research only, not investment advice';

// ═══════════════════════════════════════════════════════════════════════════
// TEXT — what Helvetica can draw
// ═══════════════════════════════════════════════════════════════════════════

/** Characters beyond Latin-1 that jsPDF's standard fonts DO carry (WinAnsi). */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

const REPLACE: Array<[RegExp, string]> = [
  // zzz835: typographic characters become plain ASCII BEFORE anything is dropped.
  // An en-dash range "28–30%" stays "28-30%"; an em-dash between words becomes " - ".
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],
  [/[\u2010\u2011\u2012\u2013]/g, '-'],
  [/\s*[\u2014\u2015]\s*/g, ' - '],
  [/\u2026/g, '...'],
  [/\u2022/g, '-'],
  [/₹\s*/g, 'Rs '],
  [/[→⟶➔➜➝➞]/g, '->'],
  [/[←⟵]/g, '<-'],
  [/↗|↘|↻|⤴|⬇|⬆|⇑/g, ''],
  [/≈|≃|∼/g, '~'],
  [/≥/g, '>='],
  [/≤/g, '<='],
  [/≠/g, '!='],
  [/−/g, '-'],
  [/[▲△▴]/g, 'up '],
  [/[▼▽▾]/g, 'down '],
  [/[▸►▶]/g, ''],
  [/[◆◇◌●○◯⚪⚫]/g, ''],
  [/⚠️?/g, 'Caution:'],
  [/✓|✔/g, ''],
  [/✗|✘/g, 'x'],
  [/ⓘ/g, ''],
  [/[ -​  ]/g, ' '],
  [/‑/g, '-'],
];

/** One string, made safe for Helvetica: ₹ → "Rs", arrows → ASCII, emoji and
 *  badge symbols removed, everything else outside WinAnsi dropped. */
export function pdfText(s: unknown): string {
  return pdfTextKeepEdges(s).replace(/[ \u00a0]{2,}/g, ' ').trim();
}

/** pdfText without trimming the ends — for runs of mixed-weight segments,
 *  where the spaces between segments carry the layout. */
function pdfTextKeepEdges(s: unknown): string {
  let t = String(s ?? '');
  for (const [re, rep] of REPLACE) t = t.replace(re, rep);
  let out = '';
  for (const ch of t) {
    const c = ch.codePointAt(0) || 0;
    if (c === 10) { out += '\n'; continue; }
    if (c === 9) { out += ' '; continue; }
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch)) out += ch;
    // anything else (emoji, variation selectors, CJK, other symbols) is dropped
  }
  return out.replace(/ +\n/g, '\n').replace(/\( +/g, '(').replace(/ +\)/g, ')');
}

/** Text that may be missing: never "null"/"undefined". */
const has = (s: unknown): boolean => { const t = String(s ?? '').trim(); return !!t && !/^(null|undefined|nan)$/i.test(t); };
const txt = (s: unknown, fb = 'Not disclosed'): string => (has(s) ? String(s).trim() : fb);

const pct = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '-';
const pctND = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? pct(v) : 'Not disclosed';

// ═══════════════════════════════════════════════════════════════════════════
// DATES — the session date shown on the page (IST for India, New York for US)
// ═══════════════════════════════════════════════════════════════════════════

const TZ: Record<GainersMarket, string> = { IN: 'Asia/Kolkata', US: 'America/New_York' };
const MARKET_NAME: Record<GainersMarket, string> = { IN: 'India', US: 'USA' };

function ymdIn(tz: string, d: Date): string | null {
  if (!Number.isFinite(d.getTime())) return null;
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = (k: string) => p.find((x) => x.type === k)?.value || '';
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch { return null; }
}

function clockIn(tz: string, d: Date): string | null {
  if (!Number.isFinite(d.getTime())) return null;
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d); } catch { return null; }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "25 Sep 2026" — month names fixed here, not left to the runtime's locale data. */
const ymdWords = (ymd: string): string => { const [y, m, d] = ymd.split('-'); return `${d} ${MONTHS[Number(m) - 1] || m} ${y}`; };

function dayIn(tz: string, d: Date): string | null {
  const y = ymdIn(tz, d);
  return y ? ymdWords(y) : null;
}

/** The 16:00 New York close of a US session date, as an instant (early closes are not modelled). */
function nyCloseUtc(ymd: string): Date | null {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  for (const off of [4, 5]) {
    const c = new Date(Date.UTC(y, m - 1, d, 16 + off, 0));
    if (clockIn('America/New_York', c) === '16:00' && ymdIn('America/New_York', c) === ymd) return c;
  }
  return null;
}

const toDate = (v: Date | string | null | undefined): Date => (v instanceof Date ? v : v ? new Date(v) : new Date());

/** The session date the page shows: IST session for India, New York session for the US. */
export function gainersSessionYmd(view: ResearchView, market: GainersMarket, generatedAt?: Date | string | null): string {
  const d = view?.session?.sessionDate || view?.session?.date;
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  if (d && Number.isFinite(Date.parse(d))) { const y = ymdIn(TZ[market], new Date(d)); if (y) return y; }
  const scan = view?.session?.scanAt ? new Date(view.session.scanAt) : null;
  if (scan && Number.isFinite(scan.getTime())) { const y = ymdIn(TZ[market], scan); if (y) return y; }
  return ymdIn(TZ[market], toDate(generatedAt)) || toDate(generatedAt).toISOString().slice(0, 10);
}

/** "AI-Gainers-India-2026-09-25.pdf" / "AI-Gainers-USA-2026-09-24.pdf". */
export function gainersPdfFilename(view: ResearchView, market: GainersMarket, generatedAt?: Date | string | null): string {
  return `AI-Gainers-${MARKET_NAME[market]}-${gainersSessionYmd(view, market, generatedAt)}.pdf`;
}

function sessionWords(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return ymd;
  return `${WEEKDAYS[d.getUTCDay()]}, ${ymdWords(ymd)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// WORDS — the page's badges as plain English (no emoji)
// ═══════════════════════════════════════════════════════════════════════════

const CLASS_WORD: Record<string, { word: string; rgb: RGB }> = {
  CONFIRMED_MATERIAL: { word: 'Confirmed material event', rgb: GREEN },
  CONFIRMED_LOW_MATERIALITY: { word: 'Confirmed, low materiality', rgb: BLUE },
  POTENTIAL_UNVERIFIED: { word: 'Potential, source unverified', rgb: AMBER },
  NEGATIVE: { word: 'Negative evidence', rgb: RED },
  NO_CATALYST: { word: 'No identified catalyst', rgb: MUTED },
  MARKET_MOVE_ONLY: { word: 'Market move only', rgb: MUTED },
  LISTING: { word: 'Recent listing', rgb: MUTED },
  DATA_UNAVAILABLE: { word: 'Data unavailable', rgb: AMBER },
};

/** The status badge on the card, in words (mirrors StatusPill). */
export function statusWord(it: ResearchItem): { word: string; rgb: RGB } {
  const base = CLASS_WORD[it.eventClass] || CLASS_WORD.NO_CATALYST;
  if (it.eventClass === 'NEGATIVE' && it.immaterialNegative) return { word: 'Immaterial negative', rgb: MUTED };
  if (it.eventClass === 'NO_CATALYST' && it.flags?.denial) return { word: 'Company: no undisclosed info', rgb: MUTED };
  if (it.eventClass === 'POTENTIAL_UNVERIFIED') {
    const filed = it.sourceConfidence === 'VERIFIED_DOCUMENT' || it.sourceConfidence === 'VERIFIED_FILING';
    return filed ? { word: 'Event filed, impact unknown', rgb: AMBER } : base;
  }
  if (it.eventClass === 'NEGATIVE' && it.flags?.denial) return { word: 'Company denial', rgb: RED };
  return base;
}

/** The triage word — what kind of attention it deserves (mirrors triageLabel). */
export function triageWord(it: ResearchItem): string {
  const held = it.portfolio?.relevance === 'HOLDING';
  switch (it.eventClass) {
    case 'CONFIRMED_MATERIAL': return held ? 'Thesis evidence' : 'Investigate';
    case 'CONFIRMED_LOW_MATERIALITY': return held ? 'Thesis evidence' : 'Monitor';
    case 'POTENTIAL_UNVERIFIED': return held ? 'Review' : 'Monitor';
    case 'NEGATIVE': return 'Negative evidence';
    case 'NO_CATALYST': case 'MARKET_MOVE_ONLY': return 'No catalyst';
    case 'LISTING': return 'Monitor';
    default: return 'Review';
  }
}

const SOURCE_WORD: Record<string, string> = {
  VERIFIED_DOCUMENT: 'Verified document', VERIFIED_FILING: 'Exchange filing', SECONDARY_SUMMARY: 'Summary only', UNVERIFIED: 'Unverified',
};

/** Verified document / Exchange filing / Summary only / Press only / Unverified. */
export function sourceWord(it: ResearchItem): string {
  const us = it.market === 'US' ? it.usCard : null;
  if (us && us.source?.tier === 'SEC') return `Verified document${us.source.form ? ` (SEC ${us.source.form})` : ''}`;
  if (us && us.source?.tier === 'PRESS') return 'Press only';
  if (it.market === 'US' && it.sourceConfidence === 'VERIFIED_FILING') return 'SEC filing';
  // zzz803 (India): a press-only lead says so in the words the page uses.
  const inLead = it.market === 'IN' && it.inCard?.lead && it.headline && it.inCard.lead.title && it.headline.includes(it.inCard.lead.title.slice(0, 40)) ? it.inCard.lead : null;
  if (inLead && inLead.source === 'PRESS' && !inLead.confirmedByFiling) return 'Press only - reported, not confirmed by the company';
  return SOURCE_WORD[it.sourceConfidence] || 'Unverified';
}

/** SOURCE (does an official filing / press exist) - its own field; never reads as "verified". */
export function sourceExistWord(it: ResearchItem): string {
  return has(it.sourceExistenceLabel) ? String(it.sourceExistenceLabel) : sourceWord(it);
}
/** EVIDENCE (was the document read / is it secondary only) - a separate field from SOURCE. */
export function evidenceWord(it: ResearchItem): string {
  return has(it.evidenceVerificationLabel) ? String(it.evidenceVerificationLabel) : 'Not stated';
}
/** Economic direction in plain ASCII (Helvetica cannot draw arrows): + POSITIVE, - NEGATIVE, ~ MIXED, = NEUTRAL, ? UNKNOWN. */
export function directionWord(it: ResearchItem): { word: string; rgb: RGB } | null {
  switch (it.direction) {
    case 'POSITIVE': return { word: '+ POSITIVE', rgb: GREEN };
    case 'NEGATIVE': return { word: '- NEGATIVE', rgb: RED };
    case 'MIXED': return { word: '~ MIXED', rgb: AMBER };
    case 'NEUTRAL': return { word: '= NEUTRAL', rgb: MUTED };
    case 'UNKNOWN': return { word: '? UNKNOWN', rgb: MUTED };
    default: return null;
  }
}

const materialWord = (it: ResearchItem): string => {
  const l = it.materiality?.label || 'UNKNOWN';
  const w = it.market === 'US' && it.usCard && l === 'SIGNIFICANT' ? 'HIGH' : l;
  return w === 'UNKNOWN' && it.materiality?.verification === 'PENDING' ? 'UNKNOWN (pending)' : w;
};
const MATERIAL_RGB: Record<string, RGB> = { SIGNIFICANT: GREEN, HIGH: GREEN, MODERATE: BLUE, SMALL: MUTED };
const materialRgb = (it: ResearchItem): RGB => MATERIAL_RGB[materialWord(it)] || MUTED;

const STAGE_WORD: Record<string, string> = {
  RUMOUR: 'Rumour', PROPOSED: 'Proposed', ENABLING: 'Enabling', SIGNED: 'Signed', AWARDED: 'Awarded', EXECUTED: 'Executed',
  OPERATIONAL: 'Operational', MONETIZING: 'Monetizing', UNKNOWN: 'Unknown',
};
const POT_WORD: Record<string, string> = { YEARS: 'Multi-year', QUARTER: 'One period', DAYS: 'Days', UNKNOWN: 'Not established' };
const PERSIST_EV_WORD: Record<string, string> = { STRONG: 'Strong', EVIDENCE: 'Medium', EARLY: 'Early', UNPROVEN: 'Unproven', NOT_PERSISTENT: 'Not persistent' };
const CATALYST_FOR_WORD: Record<string, string> = { THIS_MOVE: 'This move', RECENT: 'Recent', CONTEXT: 'Older context' };

const nameOf = (it: ResearchItem): string => txt(it.displayTicker, '') || txt(it.ticker, '');
const companyOf = (it: ResearchItem): string => {
  const c = txt(it.company, '');
  return c && c.trim().toLowerCase() !== nameOf(it).trim().toLowerCase() ? c : '';
};
/** The headline move: the 1-day move, or the US weekly move with its window. */
const moveOf = (it: ResearchItem): string => {
  if (typeof it.move1d === 'number' && Number.isFinite(it.move1d)) return pct(it.move1d);
  if (it.move && typeof it.move.pct === 'number') return `${pct(it.move.pct)} (${it.move.window})`;
  return 'Not available';
};
/** Company cell: the company, else the display name, else "Not disclosed" - never a bare dash. */
const coCell = (it: ResearchItem): string => (has(it.companyName) ? String(it.companyName).trim() : '') || companyOf(it) || nameOf(it) || 'Not disclosed';
const trailOf = (it: ResearchItem): string => {
  const r = it.returns || { w1: null, m1: null, m3: null };
  const p = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? pct(v) : 'n/a');
  return `1W ${p(r.w1)} · 1M ${p(r.m1)} · 3M ${p(r.m3)}`;
};
const ageOf = (it: ResearchItem): string => (typeof it.ageDays === 'number' && Number.isFinite(it.ageDays) ? `${Math.max(0, Math.round(it.ageDays))}d` : '');

// ═══════════════════════════════════════════════════════════════════════════
// THE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/** Every item on the view, once each (a name in several sections is one item). */
function allItems(view: ResearchView): ResearchItem[] {
  const seen = new Set<string>(); const out: ResearchItem[] = [];
  for (const list of [view.queue, view.watch, view.needsReading, view.negative, view.noCatalyst, view.context, view.dataQuality, view.portfolio]) {
    for (const it of list || []) { if (!it || seen.has(it.ticker)) continue; seen.add(it.ticker); out.push(it); }
  }
  return out;
}

/** Catalysts found per category, from the per-card taxonomy (US usCard / India inCard). Null when no card carries one. */
function derivedCatalysts(view: ResearchView): { found: number; none: number; byCategory: Array<{ category: string; names: number; press: number }> } | null {
  const by = new Map<string, { names: Set<string>; filed: Set<string>; press: Set<string> }>();
  let found = 0, none = 0, carded = 0;
  for (const it of allItems(view)) {
    const cs: any[] | undefined = it.market === 'US' ? it.usCard?.catalysts : it.inCard?.catalysts?.filter((c) => c.id !== 'price_clarification' && c.id !== 'exchange_query');
    if (!(it.market === 'US' ? it.usCard : it.inCard)) continue;
    carded++;
    if (!cs || !cs.length) { none++; continue; }
    found++;
    for (const c of cs) {
      const key = String(c.category || 'Other');
      const b = by.get(key) || { names: new Set<string>(), filed: new Set<string>(), press: new Set<string>() };
      b.names.add(it.ticker);
      ((c.source === 'SEC' || c.source === 'FILING' || c.confirmedByFiling) ? b.filed : b.press).add(it.ticker);
      by.set(key, b);
    }
  }
  if (!carded) return null;
  return { found, none, byCategory: Array.from(by.entries()).map(([category, b]) => ({ category, names: b.names.size, press: Array.from(b.press).filter((t) => !b.filed.has(t)).length })).sort((a, b) => b.names - a.names) };
}

interface Seg { text: string; bold?: boolean; color?: RGB }

/** Build the document. Pure: pass the jsPDF constructor in. */
export function buildGainersPdf(JsPDF: JsPdfCtor, input: GainersPdfInput): JsPdfDoc {
  const { view, market } = input;
  if (!view || typeof view !== 'object') throw new Error('There is no research view to export yet.');
  const gen = toDate(input.generatedAt);
  const tz = TZ[market];
  const mName = MARKET_NAME[market];

  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: input.compress !== false });
  doc.setProperties({ title: `AI Daily Gainers - ${mName} - ${gainersSessionYmd(view, market, gen)}`, subject: 'Research only, not investment advice', creator: 'Market Cockpit' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 12;
  const W = pageW - M * 2;
  const TOP = 12;
  const BOTTOM = pageH - 15;
  let y = TOP;
  let provisional = false;

  const newPage = () => { doc.addPage(); y = TOP; };
  const room = (h: number) => { if (y + h > BOTTOM) newPage(); };
  const font = (size: number, bold = false, color: RGB = INK2) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
  };
  const lh = (size: number) => size * 0.4;   // line height in mm for a pt size
  const wrap = (s: string, w: number): string[] => doc.splitTextToSize(pdfText(s), w) as string[];

  /** Wrapped paragraph. */
  const para = (s: string, o: { size?: number; bold?: boolean; color?: RGB; indent?: number; after?: number } = {}) => {
    const size = o.size ?? 9; const ind = o.indent ?? 0;
    font(size, o.bold, o.color ?? INK2);
    for (const ln of wrap(s, W - ind)) { room(lh(size)); doc.text(ln, M + ind, y + size * 0.3); y += lh(size); }
    y += o.after ?? 0;
  };

  /** A run of segments with mixed weight/colour, word-wrapped at width w. Returns lines of segments. */
  const layoutSegs = (segs: Seg[], w: number, size: number): Seg[][] => {
    const lines: Seg[][] = [[]];
    let x = 0;
    for (const sg of segs) {
      doc.setFont('helvetica', sg.bold ? 'bold' : 'normal'); doc.setFontSize(size);
      const words = pdfTextKeepEdges(sg.text).split(/( +)/).filter((p) => p.length);
      for (const wd of words) {
        const ww = doc.getTextWidth(wd);
        if (/^ +$/.test(wd)) { if (x > 0) { lines[lines.length - 1].push({ ...sg, text: wd }); x += ww; } continue; }
        if (x + ww > w && x > 0) {
          const cur = lines[lines.length - 1];
          while (cur.length && /^ +$/.test(cur[cur.length - 1].text)) cur.pop();
          lines.push([]); x = 0;
        }
        if (ww > w) {   // a single very long token (a URL): hard split
          for (const piece of doc.splitTextToSize(wd, w) as string[]) {
            if (x > 0) { lines.push([]); x = 0; }
            lines[lines.length - 1].push({ ...sg, text: piece }); x = doc.getTextWidth(piece);
          }
          continue;
        }
        lines[lines.length - 1].push({ ...sg, text: wd }); x += ww;
      }
    }
    return lines.filter((l) => l.length);
  };
  const drawSegLine = (line: Seg[], x0: number, yy: number, size: number, base: RGB) => {
    let x = x0;
    for (const sg of line) {
      doc.setFont('helvetica', sg.bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(sg.color ?? base));
      doc.text(sg.text, x, yy); x += doc.getTextWidth(sg.text);
    }
  };

  /** Height a section heading will take (title + optional sub line). */
  const headingH = (sub?: string | null): number => {
    let h = 6 + 5;   // gap above + title
    if (sub) { font(8, false, MUTED); h += wrap(sub, W).length * lh(8) + 1.5; } else h += 1;
    return h;
  };
  /** Draw a heading with no page-break check (the caller has reserved the room). */
  const drawHeading = (title: string, sub?: string | null) => {
    if (y > TOP + 0.5) y += 4;
    font(10.5, true, INK); doc.text(pdfText(title.toUpperCase()), M, y + 3.2); y += 5.6;
    if (sub) { para(sub, { size: 8, color: MUTED, after: 1 }); } else y += 0.8;
  };
  /** A heading that belongs to the table drawn next: it moves with the table (no orphan heading). */
  let pendingHead: [string, (string | null)?] | null = null;
  const head = (title: string, sub?: string | null) => { pendingHead = [title, sub]; };
  /** Section heading: kept with at least `keep` mm of what follows (never an orphan heading). */
  const section = (title: string, sub?: string | null, keep = 14) => {
    room(headingH(sub) + keep);
    drawHeading(title, sub);
  };

  // ── Tables: wrapped + clipped cells, header row repeated on every page ────
  // Keep-together: a table starts on a new page only if its heading, header and
  // first 3 rows do not fit; it never leaves a header with fewer than 3 rows.
  interface Col { head: string; w: number; align?: 'left' | 'right' }
  interface Cell { text: string; bold?: boolean; color?: RGB; link?: string | null; maxLines?: number }
  const table = (cols: Col[], rows: Cell[][], o: { size?: number; heading?: [string, (string | null)?]; maxLines?: number } = {}) => {
    const size = o.size ?? 8;
    const padX = 1.3, padY = 1.0;
    const total = cols.reduce((sm, c) => sm + c.w, 0);
    const scale = W / total;
    const cw = cols.map((c) => c.w * scale);
    const L = lh(size);
    // Wrap (and clip long text with an ellipsis; the full text stays on the card).
    const layoutRow = (r: Cell[]) => {
      const cells = r.map((c, i) => {
        font(size, c.bold);
        let lines = wrap(c.text, cw[i] - padX * 2);
        const cap = c.maxLines ?? o.maxLines;
        if (cap && lines.length > cap) {
          lines = lines.slice(0, cap);
          let last = lines[cap - 1];
          while (last.length > 1 && doc.getTextWidth(`${last}...`) > cw[i] - padX * 2) last = last.slice(0, -1);
          lines[cap - 1] = `${last.replace(/[ ,;:.-]+$/, '')}...`;
        }
        return lines;
      });
      return { cells, h: Math.max(1, ...cells.map((c) => c.length)) * L + padY * 2 };
    };
    font(6.8, true, MUTED);
    const heads = cols.map((c, i) => wrap(c.head.toUpperCase(), cw[i] - padX * 2));
    const headH = Math.max(...heads.map((h) => h.length)) * lh(6.8) + padY * 2;
    const laid = rows.map(layoutRow);
    const drawHead = () => {
      font(6.8, true, MUTED);
      let x = M;
      heads.forEach((hl, i) => { hl.forEach((ln, k) => doc.text(ln, cols[i].align === 'right' ? x + cw[i] - padX : x + padX, y + padY + 6.8 * 0.3 + k * lh(6.8), cols[i].align === 'right' ? { align: 'right' } : undefined)); x += cw[i]; });
      y += headH;
      doc.setDrawColor(...INK2); doc.setLineWidth(0.3); doc.line(M, y, pageW - M, y);
    };
    const heading: [string, (string | null)?] | null = o.heading || pendingHead; pendingHead = null;
    const need = (heading ? headingH(heading[1]) : 0) + headH + laid.slice(0, 3).reduce((a, r) => a + r.h, 0);
    room(need);
    if (heading) drawHeading(heading[0], heading[1]);
    drawHead();
    laid.forEach((row, ri) => {
      const r = rows[ri];
      if (y + row.h > BOTTOM) {
        // Never strand fewer than 3 rows at the top of a page: the header repeats here.
        newPage(); drawHead();
      }
      let x = M;
      row.cells.forEach((lines, i) => {
        const c = r[i];
        font(size, c.bold, c.color ?? INK2);
        if (c.link && lines.length) doc.setTextColor(...LINK);
        lines.forEach((ln, k) => {
          const tx = cols[i].align === 'right' ? x + cw[i] - padX : x + padX;
          const ty = y + padY + size * 0.3 + k * L;
          if (c.link) doc.textWithLink(ln, tx, ty, { url: c.link });
          else doc.text(ln, tx, ty, cols[i].align === 'right' ? { align: 'right' } : undefined);
        });
        x += cw[i];
      });
      y += row.h;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.15); doc.line(M, y, pageW - M, y);
    });
    y += 1.5;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 1. COVER BLOCK
  // ═════════════════════════════════════════════════════════════════════════
  const s = view.session || { date: null, scanAt: null, status: 'Unknown', cached: false };
  const ymd = gainersSessionYmd(view, market, gen);
  font(7.2, true, MUTED); doc.text('MARKET COCKPIT  ·  RESEARCH NOTE', M, y + 2.2); y += 4;
  font(16, true, INK); doc.text('AI Daily Gainers', M, y + 5.2);
  const titleW = doc.getTextWidth('AI Daily Gainers');
  font(11, false, INK2); doc.text(pdfText(`${mName}${market === 'IN' ? '  (NSE / BSE)' : '  (NASDAQ / NYSE / AMEX)'}`), M + titleW + 4, y + 5.2);
  y += 8;
  para('Fundamental events filed around unusual price moves, ranked by research value, not by return. Price is context, never the ranking.', { size: 8.2, color: INK2, after: 1.5 });
  if (input.demo) para('DEMO DATA: an illustrative fixture for layout checks. No live data was read.', { size: 8.2, bold: true, color: AMBER, after: 1.5 });

  // Session box: key / value rows inside a thin border.
  const scanD = s.scanAt ? new Date(s.scanAt) : null;
  const scanOk = !!scanD && Number.isFinite(scanD.getTime());
  const tzWord = market === 'US' ? 'ET' : 'IST';
  let scanText = 'Unknown';
  if (scanOk) {
    if (market === 'US') {
      const ny = clockIn('America/New_York', scanD!), ist = clockIn('Asia/Kolkata', scanD!), istDay = dayIn('Asia/Kolkata', scanD!);
      scanText = `${ny} New York time${ist ? ` (${ist} IST${istDay ? `, ${istDay}` : ''} in India)` : ''}`;
    } else {
      scanText = `${clockIn('Asia/Kolkata', scanD!)} IST, ${dayIn('Asia/Kolkata', scanD!)}`;
    }
  }
  const live = /live/i.test(String(s.status || ''));
  const statusText = live ? 'Live' : !has(s.status) || /unknown/i.test(String(s.status)) ? 'Unknown' : String(s.status);
  // A live US scan, or one taken before the 16:00 ET close of its session, is PROVISIONAL.
  const closeAt = market === 'US' ? nyCloseUtc(ymd) : null;
  // The view's own verdict wins; the live / before-the-close rule is the US fallback.
  provisional = typeof s.isFinal === 'boolean' ? !s.isFinal : market === 'US' && (live || (scanOk && !!closeAt && scanD!.getTime() < closeAt.getTime()));
  const fmtInstant = (iso: string | null | undefined): string | null => {
    const d = iso ? new Date(iso) : null;
    if (!d || !Number.isFinite(d.getTime())) return null;
    const c = clockIn(tz, d), day = dayIn(tz, d);
    return c && day ? `${c} ${tzWord}, ${day}` : null;
  };
  const dataText = s.cached ? `Cached scan${scanOk ? ` from ${market === 'US' ? `${clockIn('America/New_York', scanD!)} ET` : `${clockIn('Asia/Kolkata', scanD!)} IST`}` : ''}` : 'Live scan completed';
  const genText = `${dayIn(tz, gen) || gen.toISOString().slice(0, 10)} ${clockIn(tz, gen) || ''} ${tzWord}`.replace(/\s+/g, ' ').trim();
  const kvRows: Array<[string, string, RGB?]> = [
    ['Market', market === 'IN' ? 'India' : 'USA'],
    ['Session date', `${sessionWords(ymd)}${market === 'US' ? ' (New York date)' : ' (India date)'}`],
    ['Scan time', scanText],
    ['Generated', fmtInstant(s.generatedAt) || genText],
    ...(fmtInstant(s.dataAsOf) ? [['Data as of', fmtInstant(s.dataAsOf) as string] as [string, string]] : []),
    ['Status', statusText, live ? BLUE : undefined],
    ['Data', dataText],
  ];
  if (!live && s.date && /last|previous|closed/i.test(String(s.status))) kvRows.push(['Note', 'These are the last completed session\'s moves, not today\'s.', AMBER]);
  if (has(input.sessionNote)) kvRows.push(['Session note', String(input.sessionNote)]);
  const criteriaText = has(view.scanCriteria) ? String(view.scanCriteria) : has(input.criteria) ? String(input.criteria) : '';
  if (criteriaText) kvRows.push(['Scan criteria', criteriaText]);
  if (provisional) {
    font(9.2, true, AMBER);
    const pl = wrap(market === 'US' ? PROVISIONAL_LINE : PROVISIONAL_LINE_IN, W - 6);
    const ph = pl.length * lh(9.2) + 3;
    room(ph + 2);
    doc.setDrawColor(...AMBER); doc.setLineWidth(0.6); doc.roundedRect(M, y, W, ph, 1.2, 1.2, 'S');
    font(9.2, true, AMBER);
    pl.forEach((ln, i) => doc.text(ln, M + 3, y + 1.5 + 9.2 * 0.3 + i * lh(9.2)));
    y += ph + 2;
  }
  {
    const keyW = 24;
    const valW = W - keyW - 6;
    const lines = kvRows.map(([, v]) => { font(8.2); return wrap(v, valW); });
    const h = lines.reduce((a, l) => a + l.length * lh(8.2) + 0.8, 0) + 3;
    room(h);
    const top = y;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.roundedRect(M, top, W, h, 1.5, 1.5, 'S');
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.9); doc.line(M + 0.45, top + 1.2, M + 0.45, top + h - 1.2);
    y = top + 1.8;
    kvRows.forEach(([k, , color], i) => {
      font(7, true, MUTED); doc.text(pdfText(k.toUpperCase()), M + 3.5, y + 8.2 * 0.3);
      font(8.2, k === 'Status' || k === 'Session date', color ?? INK);
      lines[i].forEach((ln, j) => doc.text(ln, M + 3.5 + keyW, y + 8.2 * 0.3 + j * lh(8.2)));
      y += lines[i].length * lh(8.2) + 0.8;
    });
    y = top + h + 2.5;
  }
  // Market summary: ONE partition line, exclusive buckets that add up to "scanned", overlays kept apart.
  const sm = view.summary;
  const empty = !sm || (sm.scanned || 0) === 0;
  const part = view.partition;
  if (sm && part && part.buckets?.length) {
    const shown = part.buckets.filter((bk) => bk.count > 0 || ['confirmed', 'identified_impact_unknown', 'secondary_unverified', 'negative', 'no_catalyst'].includes(bk.key));
    const BK_RGB: Record<string, RGB> = { confirmed: GREEN, identified_impact_unknown: AMBER, secondary_unverified: AMBER, negative: RED, no_catalyst: INK };
    room(30);
    font(8, true, MUTED); doc.text('MARKET SUMMARY', M, y + 2.4); y += 4.2;
    para(has(part.line) ? String(part.line) : `${part.scanned} scanned = ${shown.map((bk) => `${bk.count} ${bk.label.toLowerCase()}`).join(' + ')}`, { size: 9, bold: true, color: INK, after: 1.2 });
    const perRow = shown.length <= 6 ? shown.length : Math.ceil(shown.length / 2);
    const gap = 1.8;
    const cwid = (W - gap * (perRow - 1)) / perRow;
    const ch = 11.5;
    const rows = Math.ceil(shown.length / perRow);
    room(rows * (ch + gap) + 6);
    shown.forEach((bk, i) => {
      const cx = M + (i % perRow) * (cwid + gap);
      const cy = y + Math.floor(i / perRow) * (ch + gap);
      doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.roundedRect(cx, cy, cwid, ch, 1.2, 1.2, 'S');
      font(13, true, bk.count > 0 ? (BK_RGB[bk.key] || INK) : MUTED); doc.text(String(bk.count), cx + 2.6, cy + 5.6);
      font(6.6, true, MUTED);
      wrap(bk.label.toUpperCase(), cwid - 5).slice(0, 2).forEach((ln, k) => doc.text(ln, cx + 2.6, cy + 8.4 + k * 2.4));
    });
    y += rows * (ch + gap);
    const ov = part.overlays;
    if (ov) para(`Overlays (tags on the names above, not part of the sum): research queue ${ov.queue} · watch ${ov.watch} · portfolio matches ${ov.portfolio} · conflicts ${ov.conflicts}.`, { size: 8, color: MUTED, after: 1 });
  } else if (sm) {
    const bn = view.banner;
    if (bn) para([`Scanned ${bn.scanned}`, `Verified events ${bn.verified}`, `Unverified ${bn.unverified}`, `Conflicts ${bn.conflicts}`, `No material catalyst ${bn.noMaterialCatalyst}`, `Negative ${bn.negative}`].join('   ·   '), { size: 8.4, bold: true, color: INK, after: 2 });
    const cells: Array<{ n: number; l: string; rgb: RGB }> = [
      { n: sm.scanned, l: 'Gainers scanned', rgb: INK },
      { n: sm.confirmed, l: 'Verified events', rgb: GREEN },
      { n: sm.potential, l: 'Impact unknown / unverified', rgb: AMBER },
      { n: sm.negative, l: 'Negative evidence', rgb: RED },
      { n: sm.noCatalyst, l: 'No clear catalyst', rgb: INK },
      { n: sm.queue, l: 'Research queue', rgb: BLUE },
      { n: sm.portfolioMatches, l: 'Portfolio matches', rgb: BLUE },
      { n: sm.dataUnavailable, l: 'Data unavailable', rgb: AMBER },
    ];
    if (typeof sm.context === 'number') cells.push({ n: sm.context, l: 'Older context', rgb: INK });
    const conflicts = sm.conflicts ?? (sm as any).conflicts;
    if (typeof conflicts === 'number' && Number.isFinite(conflicts)) cells.push({ n: conflicts, l: 'Conflicts in the evidence', rgb: RED });
    const perRow = cells.length > 8 ? 5 : 4;
    const gap = 1.8;
    const cwid = (W - gap * (perRow - 1)) / perRow;
    const ch = 11.5;
    const rows = Math.ceil(cells.length / perRow);
    room(6 + rows * (ch + gap));
    font(8, true, MUTED); doc.text('MARKET SUMMARY', M, y + 2.4); y += 4.2;
    cells.forEach((c, i) => {
      const cx = M + (i % perRow) * (cwid + gap);
      const cy = y + Math.floor(i / perRow) * (ch + gap);
      const n = Number.isFinite(c.n) ? c.n : 0;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.roundedRect(cx, cy, cwid, ch, 1.2, 1.2, 'S');
      font(13, true, n > 0 ? c.rgb : MUTED); doc.text(String(n), cx + 2.6, cy + 5.6);
      font(6.6, true, MUTED);
      wrap(c.l.toUpperCase(), cwid - 5).slice(0, 2).forEach((ln, k) => doc.text(ln, cx + 2.6, cy + 8.4 + k * 2.4));
    });
    y += rows * (ch + gap) + 1;
  }
  if (sm) {
    // Catalysts found by category — both markets. The US view carries its own tally;
    // otherwise it is derived here from the cards already on the view (nothing invented).
    const uc = sm.catalysts || sm.usCatalysts || derivedCatalysts(view);
    if (uc && (uc.byCategory.length || uc.found > 0)) {
      const cats = uc.byCategory.map((c) => `${c.category} ${c.names}${c.press ? ` (${c.press} press only)` : ''}`).join('  ·  ');
      para(`Catalysts found by category: ${cats || 'none'}. ${uc.found} name${uc.found === 1 ? '' : 's'} with a catalyst found in ${market === 'US' ? 'filings or news' : 'exchange filings or news'}; ${uc.none} with none found.`, { size: 8 });
    }
  }

  if (empty) {
    section('No gainers on this board');
    para('No gainers on this board for this session. That is a real answer for this scan, not a loading state.', { size: 9 });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. TOP 3 RESEARCH PRIORITIES
  // ═════════════════════════════════════════════════════════════════════════
  const top3 = (view.top3 || []).slice(0, 3);
  if (!empty && top3.length) {
    section('Top 3 research priorities', 'The names that most deserve research time today.', 22);
    top3.forEach((it, i) => {
      const st = statusWord(it);
      const head: Seg[] = [{ text: `#${i + 1}  `, bold: true, color: MUTED }, { text: nameOf(it), bold: true, color: INK }];
      if (companyOf(it)) head.push({ text: `  ${companyOf(it)}`, color: INK2 });
      const blocks: Array<{ segs: Seg[]; size: number }> = [
        { segs: head, size: 9.6 },
        { segs: [{ text: txt(it.headline, 'Headline not available'), bold: true, color: INK }], size: 9 },
      ];
      if (has(it.whyResearch)) blocks.push({ segs: [{ text: String(it.whyResearch) }], size: 8.6 });
      blocks.push({ segs: [
        { text: 'MARKET MOVE ', bold: true, color: MUTED }, { text: moveOf(it), bold: true, color: INK }, { text: '   ·   ', color: MUTED },
        { text: st.word.toUpperCase(), bold: true, color: st.rgb }, { text: '   ·   ', color: MUTED },
        { text: triageWord(it).toUpperCase(), bold: true, color: INK2 },
        ...(directionWord(it) ? [{ text: '   ·   ', color: MUTED } as Seg, { text: directionWord(it)!.word, bold: true, color: directionWord(it)!.rgb } as Seg] : []),
        { text: '   ·   Material: ', color: MUTED }, { text: materialWord(it), bold: true, color: materialRgb(it) },
      ], size: 7.8 });
      blocks.push({ segs: [{ text: 'SOURCE ', bold: true, color: MUTED }, { text: sourceExistWord(it), color: INK2 }, { text: '   ·   EVIDENCE ', bold: true, color: MUTED }, { text: evidenceWord(it), color: INK2 }], size: 7.8 });
      const laid = blocks.map((b) => ({ ...b, lines: layoutSegs(b.segs, W - 6, b.size) }));
      const h = laid.reduce((a, b) => a + b.lines.length * lh(b.size) + 0.6, 0) + 2;
      room(h + 1.5);
      const top = y;
      doc.setDrawColor(...st.rgb); doc.setLineWidth(0.9); doc.line(M + 0.45, top + 0.6, M + 0.45, top + h - 0.6);
      y += 1.1;
      laid.forEach((b) => { b.lines.forEach((ln) => { drawSegLine(ln, M + 4, y + b.size * 0.3, b.size, INK2); y += lh(b.size); }); y += 0.6; });
      y = top + h + 1.6;
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. RESEARCH QUEUE — ranked table
  // ═════════════════════════════════════════════════════════════════════════
  const queue = view.queue || [];
  const qCols: Col[] = [
    { head: '#', w: 7 }, { head: 'Ticker', w: 24 }, { head: 'Company', w: 25 }, { head: 'Move', w: 14 },
    { head: 'Status', w: 24 }, { head: 'Direction', w: 23 }, { head: 'Event', w: 18 }, { head: 'Material', w: 24 }, { head: 'Source', w: 17 }, { head: 'Evidence', w: 17 },
  ];
  if (!empty) {
    if (!queue.length) {
      section('Research queue', 'Ranked by research value. Price is context, never the ranking.');
      para('No name on this board carries an event that deserves research time. That is a valid result, not an empty page.', { size: 9 });
    } else {
      table(qCols, queue.map((it, i) => {
        const st = statusWord(it);
        return [
          { text: String(i + 1), bold: true, color: MUTED },
          { text: nameOf(it) + (it.displayCode && it.displayCode !== nameOf(it) ? `\n${it.displayCode}` : ''), bold: true, color: INK, maxLines: 2 },
          { text: coCell(it), maxLines: 2 },
          { text: moveOf(it), color: INK, bold: true },
          { text: `${st.word}\n${triageWord(it)}${it.catalystFor ? `\n${CATALYST_FOR_WORD[it.catalystFor]}${it.catalystFor !== 'THIS_MOVE' && ageOf(it) ? ` (${ageOf(it)})` : ''}` : ''}`, color: st.rgb, maxLines: 4 },
          { text: directionWord(it)?.word || 'Not assessed', bold: !!directionWord(it), color: directionWord(it)?.rgb ?? MUTED },
          { text: txt(it.eventLabel || it.eventType, 'Not classified'), maxLines: 2 },
          { text: materialWord(it), bold: true, color: materialRgb(it), maxLines: 2 },
          { text: sourceExistWord(it), maxLines: 3 },
          { text: evidenceWord(it), maxLines: 3 },
        ];
      }), { maxLines: 3, heading: ['Research queue', 'Ranked by research value. Price is context, never the ranking. Long text is clipped here; the card below has it in full.'] });
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 4. ONE DETAILED SECTION PER RESEARCH-QUEUE CARD
  // ═════════════════════════════════════════════════════════════════════════
  type Block =
    | { k: 'segs'; segs: Seg[]; size: number; indent?: number; gapAfter?: number }
    | { k: 'grid'; pairs: Array<[string, string, RGB?]>; size: number }
    | { k: 'link'; label: string; url: string; size: number };

  const lbl = (t: string): Seg => ({ text: `${t}  `, bold: true, color: MUTED });

  /** What to print for an empty catalyst list: the view's own sentence (what was searched), never a fixed "no catalyst" when an event exists. */
  const noCatalystText = (it: ResearchItem, fallback: string): string => {
    const st = it.usCard?.catalystStatus?.status ?? it.inCard?.catalystStatus;
    const sent = has(it.catalystStatusSentence) ? String(it.catalystStatusSentence) : '';
    const sr = it.searched;
    const searched = sr && sr.sources?.length ? `Searched ${sr.sources.join(', ')}${sr.lookbackDays != null ? `, last ${sr.lookbackDays} days` : ''}${typeof sr.filings === 'number' || typeof sr.press === 'number' ? ` (${sr.filings ?? 0} filings, ${sr.press ?? 0} press items)` : ''}.` : '';
    if (sent && st !== 'no_event_found') return sent;
    if (sent) return sent;
    return [fallback, searched].filter(Boolean).join(' ');
  };
  const clusterBlocks = (it: ResearchItem): Block[] => {
    const out: Block[] = [];
    const cl = it.clusters || [];
    if (cl.length) out.push({ k: 'segs', segs: [lbl(`CATALYSTS FOUND (${cl.length} event${cl.length === 1 ? '' : 's'}, grouped)`)], size: 8.2, gapAfter: 0.3 });
    cl.forEach((k) => {
      out.push({ k: 'segs', size: 8.2, gapAfter: 0.3, segs: [lbl('CLUSTER'), { text: k.label, bold: true, color: INK }, { text: `  ${k.source}${k.independentSources ? ` · ${k.independentSources} independent source${k.independentSources === 1 ? '' : 's'}` : ''}`, color: MUTED }] });
      if (has(k.sentence)) out.push({ k: 'segs', size: 7.8, indent: 4, gapAfter: 0.3, segs: [{ text: `"${k.sentence}"` }] });
      (k.children || []).forEach((c) => out.push({ k: 'segs', size: 8, indent: 4, gapAfter: 0.2, segs: [{ text: `- ${c.label}`, bold: true, color: INK }, { text: `: ${c.sentence}${c.figures?.length ? ` (stated: ${c.figures.join(', ')})` : ''}` }] }));
    });
    return out;
  };

  const cardBlocks = (it: ResearchItem, rank: number): Block[] => {
    const b: Block[] = [];
    const st = statusWord(it);
    const head: Seg[] = [{ text: `#${rank}  `, bold: true, color: MUTED }, { text: nameOf(it), bold: true, color: INK }];
    if (it.displayCode && it.displayCode !== nameOf(it)) head.push({ text: ` (${it.displayCode})`, color: MUTED });
    if (companyOf(it)) head.push({ text: `  ·  ${companyOf(it)}`, color: INK2 });
    b.push({ k: 'segs', segs: head, size: 11, gapAfter: 0.6 });
    const tags: Seg[] = [
      { text: 'MARKET MOVE ', bold: true, color: MUTED }, { text: moveOf(it), bold: true, color: INK }, { text: `  (${trailOf(it)})`, color: MUTED }, { text: '     ' },
      { text: st.word.toUpperCase(), bold: true, color: st.rgb }, { text: '  ·  ', color: MUTED }, { text: triageWord(it).toUpperCase(), bold: true, color: INK2 },
    ];
    { const d = directionWord(it); if (d) tags.push({ text: '  ·  ', color: MUTED }, { text: d.word, bold: true, color: d.rgb }); }
    if (it.stageBadge || has(it.stageLabel)) tags.push({ text: '  ·  ', color: MUTED }, { text: `STAGE ${has(it.stageLabel) ? String(it.stageLabel).toUpperCase() : String(it.stageBadge)}`, bold: true, color: BLUE });
    if (it.contextOnly) tags.push({ text: '  ·  ', color: MUTED }, { text: 'CONTEXT ONLY', bold: true, color: AMBER });
    if (it.catalystFor) tags.push({ text: '  ·  ', color: MUTED }, { text: `${CATALYST_FOR_WORD[it.catalystFor].toUpperCase()}${it.catalystFor !== 'THIS_MOVE' && ageOf(it) ? ` (${ageOf(it)})` : ''}`, bold: true, color: it.catalystFor === 'THIS_MOVE' ? BLUE : it.catalystFor === 'RECENT' ? AMBER : MUTED });
    b.push({ k: 'segs', segs: tags, size: 7.8, gapAfter: 0.8 });
    b.push({ k: 'segs', size: 7.8, gapAfter: 1.2, segs: [{ text: 'RESEARCH QUESTION  ', bold: true, color: MUTED }, { text: has(it.researchQuestion) ? String(it.researchQuestion) : 'What fundamental event, if any, explains the move?', color: INK2 }, { text: '     SOURCE  ', bold: true, color: MUTED }, { text: sourceExistWord(it), color: INK2 }, { text: '     EVIDENCE  ', bold: true, color: MUTED }, { text: evidenceWord(it), color: INK2 }] });
    if (has(it.directionNote)) b.push({ k: 'segs', size: 8, gapAfter: 0.8, segs: [lbl('DIRECTION'), { text: String(it.directionNote), color: INK2 }] });
    b.push({ k: 'segs', segs: [{ text: txt(it.headline, 'Headline not available'), bold: true, color: INK }], size: 9.6, gapAfter: 1.6 });
    if (it.eventClass === 'NO_CATALYST' && has(it.scanNote)) b.push({ k: 'segs', segs: [lbl('SCANNED'), { text: String(it.scanNote) }], size: 8.2 });

    // WHAT CHANGED
    const us = it.market === 'US' ? it.usCard : null;
    if (us) {
      b.push({ k: 'segs', segs: [lbl('WHAT CHANGED'), { text: txt(it.whatChanged, 'Not stated in the filing'), bold: true, color: INK }], size: 8.8 });
      (us.extra || []).filter(has).forEach((x) => b.push({ k: 'segs', segs: [{ text: `- ${x}` }], size: 8.2, indent: 4 }));
      (us.flags || []).filter(has).forEach((x) => b.push({ k: 'segs', segs: [{ text: `Caution: ${x}`, color: AMBER }], size: 8.2, indent: 4 }));
      // zzz801: the catalysts the taxonomy found — SEC vs press only, the sentence, a figure only when stated.
      if (it.clusters?.length) b.push(...clusterBlocks(it));
      else if (Array.isArray(us.catalysts)) {
        if (!us.catalysts.length) b.push({ k: 'segs', segs: [lbl('CATALYSTS FOUND'), { text: noCatalystText(it, 'No catalyst found in filings or news.'), color: MUTED }], size: 8.2 });
        else {
          b.push({ k: 'segs', segs: [lbl(`CATALYSTS FOUND (${us.catalysts.length})`)], size: 8.2, gapAfter: 0.3 });
          us.catalysts.slice(0, 5).forEach((c) => {
            b.push({ k: 'segs', segs: [{ text: `- ${c.label}${c.planned ? ' (planned)' : ''}`, bold: true, color: INK }, { text: `  ${c.category} · ${c.source === 'SEC' ? 'SEC' : 'press only, not verified in a filing'}${c.date ? ` · ${c.date}` : ''}${c.figures.length ? ` · stated: ${c.figures.join(', ')}` : ''}`, color: MUTED }], size: 8, indent: 4, gapAfter: 0.2 });
            b.push({ k: 'segs', segs: [{ text: `"${c.sentence}"` }], size: 7.6, indent: 8 });
          });
        }
      }
    } else if (it.earnings) {
      const e = it.earnings;
      const margin = e.marginNow == null ? 'Not disclosed' : `${e.marginPrior != null ? `${e.marginPrior.toFixed(1)}% -> ` : ''}${e.marginNow.toFixed(1)}%`;
      const rev = e.revenueYoY == null && e.revenueQoQ == null ? 'Not disclosed' : `${pctND(e.revenueYoY)} YoY, ${pctND(e.revenueQoQ)} QoQ`;
      const g: Record<string, string> = { RAISED: 'Raised', MAINTAINED: 'Maintained', CUT: 'Cut', NOT_STATED: 'Not stated' };
      const ob: Record<string, string> = { UP: 'Up', DOWN: 'Down', UNCHANGED: 'Unchanged', NOT_STATED: 'Not stated' };
      b.push({ k: 'segs', segs: [it.olderResultLabel ? lbl(`OLDER RESULT - context (EARNINGS${e.quarter ? ` ${e.quarter}` : ''}${e.filedDaysAgo != null ? `, FILED ${e.filedDaysAgo}D AGO` : ''})`) : lbl(`WHAT CHANGED (EARNINGS${e.quarter ? ` ${e.quarter}` : ''}${e.filedDaysAgo != null ? `, FILED ${e.filedDaysAgo}D AGO` : ''})`), ...(it.olderResultLabel ? [{ text: String(it.olderResultLabel), color: AMBER } as Seg] : [])], size: 8.8, gapAfter: 0.4 });
      b.push({ k: 'grid', size: 8.2, pairs: [
        ['Revenue', rev], ['EBITDA', e.ebitdaYoY == null ? 'Not disclosed' : `${pctND(e.ebitdaYoY)} YoY`],
        ['Margin', margin, e.marginNow != null && e.marginPrior != null ? (e.marginNow >= e.marginPrior ? GREEN : RED) : undefined],
        ['PAT', e.patYoY == null ? 'Not disclosed' : `${pctND(e.patYoY)} YoY`],
        ['CFO / PAT', e.cfoToPat == null ? 'Not disclosed' : `${e.cfoToPat.toFixed(2)}x`, e.cfoToPat != null && e.cfoToPat < 0.5 ? AMBER : undefined],
        ['Guidance', g[e.guidance] || 'Not stated', e.guidance === 'RAISED' ? GREEN : e.guidance === 'CUT' ? RED : undefined],
        ['Order book', ob[e.orderBook] || 'Not stated'],
      ] });
      b.push({ k: 'segs', segs: [lbl(it.olderResultLabel ? 'OLDER RESULT' : 'KEY CHANGE'), { text: txt(e.keyChange, 'Not identified'), color: it.olderResultLabel ? INK2 : INK }], size: 8.4 });
    } else if (it.before || it.after) {
      b.push({ k: 'segs', segs: [lbl('WHAT CHANGED'), { text: txt(it.before, 'Before: not disclosed') }, { text: '  ->  ', bold: true, color: MUTED }, { text: txt(it.after, 'After: not disclosed'), bold: true, color: INK }], size: 8.8 });
      if (has(it.whatChanged)) b.push({ k: 'segs', segs: [{ text: String(it.whatChanged) }], size: 8.4, indent: 4 });
    } else {
      b.push({ k: 'segs', segs: [lbl('WHAT CHANGED'), has(it.whatChanged) ? { text: String(it.whatChanged), bold: true, color: INK } : { text: 'No change stated in a filing', color: MUTED }], size: 8.8 });
    }
    // zzz803 (India): the India card — filed vs press events, the result backdrop, the clarification; a figure only when stated.
    const inc = it.market === 'IN' ? it.inCard : null;
    if (inc && Array.isArray(inc.catalysts)) {
      const cs = it.clusters?.length ? [] : inc.catalysts.filter((c) => c.id !== 'price_clarification' && c.id !== 'exchange_query');
      if (it.clusters?.length) b.push(...clusterBlocks(it));
      if (!cs.length && !it.clusters?.length && !inc.backdrop && !inc.clarification) b.push({ k: 'segs', segs: [lbl('CATALYSTS FOUND'), { text: `${noCatalystText(it, 'No catalyst found in filings or news')}${has(it.catalystStatusSentence) ? '' : inc.routine.length ? ` (routine only: ${Array.from(new Set(inc.routine.map((r) => r.label.toLowerCase()))).slice(0, 3).join(', ')})` : ''}`, color: MUTED }], size: 8.2 });
      if (cs.length) {
        b.push({ k: 'segs', segs: [lbl(`CATALYSTS FOUND (${cs.length})`)], size: 8.2, gapAfter: 0.3 });
        cs.slice(0, 5).forEach((c) => {
          b.push({ k: 'segs', segs: [{ text: `- ${c.label}${c.planned ? (c.source === 'PRESS' ? ' (reported plan)' : ' (proposed)') : ''}`, bold: true, color: INK }, { text: `  ${c.category} · ${c.source === 'FILING' ? 'exchange filing' : c.confirmedByFiling ? 'press, also in an exchange filing' : 'reported, not confirmed by the company'}${c.date ? ` · ${c.date}` : ''}${c.figures.length ? ` · stated: ${c.figures.join(', ')}` : ''}${c.note ? ` · ${c.note}` : ''}`, color: MUTED }], size: 8, indent: 4, gapAfter: 0.2 });
          b.push({ k: 'segs', segs: [{ text: `"${c.sentence}"` }], size: 7.6, indent: 8 });
        });
      }
      if (inc.backdrop) b.push({ k: 'segs', size: 8.2, segs: [lbl('BACKDROP'), { text: inc.backdrop.label, bold: true, color: INK }, { text: inc.backdrop.lead ? ` - ${inc.backdrop.lead.source === 'PRESS' ? 'press: ' : ''}"${inc.backdrop.lead.sentence}"${inc.backdrop.lead.figures.length ? ` (stated: ${inc.backdrop.lead.figures.join(', ')})` : ''}${inc.backdrop.lead.note ? ` - ${inc.backdrop.lead.note}` : ''}` : '' }] });
      if (inc.clarification) b.push({ k: 'segs', size: 8.2, segs: [lbl('EXCHANGE CLARIFICATION'), { text: `${inc.clarification.date ? `${inc.clarification.date} - ` : ''}company says no undisclosed information. "${inc.clarification.sentence}"` }] });
    }
    if (has(it.impact)) b.push({ k: 'segs', segs: [lbl('IMPACT'), { text: String(it.impact) }], size: 8.6 });
    // zzz835 card facts (optional on the view; each prints only when the view carries it).
    const cvals = (it.conflictValues || []).filter((v) => has(v.text));
    const cwords = (it.conflicts || []).filter(has);
    if (cvals.length || cwords.length) {
      b.push({ k: 'segs', size: 8.6, gapAfter: 0.3, segs: [{ text: 'VALUES CONFLICT', bold: true, color: RED }, { text: '  two values are reported for this event; the impact is unknown until the filing is read', color: RED }] });
      cwords.forEach((x) => b.push({ k: 'segs', size: 8.2, indent: 4, gapAfter: 0.2, segs: [{ text: x, color: INK }] }));
      cvals.forEach((v) => b.push({ k: 'segs', size: 8.2, indent: 4, gapAfter: 0.2, segs: [{ text: `- ${v.text}`, bold: true, color: INK }, { text: has(v.source) ? `  (${v.source})` : '', color: MUTED }] }));
    }
    if (it.contextOnly || has(it.causalLabel)) {
      b.push({ k: 'segs', size: 8.2, segs: [it.contextOnly ? { text: 'CONTEXT ONLY  ', bold: true, color: AMBER } : lbl('TIMING'), { text: has(it.causalLabel) ? String(it.causalLabel) : 'Older than the move window; not the catalyst for this move.', color: it.contextOnly ? AMBER : MUTED }] });
    }
    if (has(it.litigationNote)) b.push({ k: 'segs', size: 8.2, segs: [lbl('LITIGATION'), { text: String(it.litigationNote), color: INK }] });
    if (it.clinical && (it.clinical.lines || []).length) {
      b.push({ k: 'segs', size: 8.4, gapAfter: 0.2, segs: [lbl('CLINICAL')] });
      it.clinical.lines.filter(has).forEach((x) => b.push({ k: 'segs', size: 8.2, indent: 4, gapAfter: 0.2, segs: [{ text: `- ${x}` }] }));
    }
    if (it.acquisition) {
      const a = it.acquisition;
      b.push({ k: 'segs', size: 8.4, gapAfter: 0.2, segs: [lbl('ACQUISITION ECONOMICS')] });
      b.push({ k: 'grid', size: 8.2, pairs: [
        ['Purchase price', txt(a.purchasePrice)], ['Upfront cash', txt(a.upfrontCash)],
        ['Contingent', txt(a.contingentConsideration)], ['Liabilities', txt(a.assumedLiabilities)],
        ['Financing', txt(a.financing)], ['Contribution', txt(a.expectedContribution)],
      ] });
    }

    // Event / stage / material / duration / persistence / catalyst state
    const pairs: Array<[string, string, RGB?]> = [
      ['Event', txt(it.eventLabel || it.eventType, 'Not classified')],
      ['Stage', `${has(it.stageLabel) ? String(it.stageLabel) : STAGE_WORD[it.stage] || 'Unknown'}${us?.stageText ? ` · ${us.stageText}` : ''}`],
      ['Material', materialWord(it), materialRgb(it)],
      ['Duration', `${it.potentialDuration ? POT_WORD[it.potentialDuration.value] || 'Not established' : POT_WORD[it.persistence] || 'Not established'}${it.potentialDuration?.basis === 'TYPE' ? ' (by type)' : ''}${it.durations?.contractual ? ` · contract: ${it.durations.contractual}` : ''}`],
      ['Persistence', it.persistenceEvidence && it.persistenceEvidence.level !== 'NONE' ? (PERSIST_EV_WORD[it.persistenceEvidence.level] || it.persistenceEvidence.level) : it.persistenceTest ? (it.persistenceTest.grade === 'EARLY' ? 'Early / unproven' : String(it.persistenceTest.grade)) : 'Not established'],
      ['Catalyst state', it.durations?.catalystState ? it.durations.catalystState.split(' (')[0] : it.catalysts?.[0] ? it.catalysts[0].stateWord : 'Not recorded'],
    ];
    b.push({ k: 'grid', size: 8.2, pairs });
    if (has(it.materialityBand)) b.push({ k: 'segs', size: 8, segs: [lbl('BAND'), { text: String(it.materialityBand), color: INK2 }] });
    const matExp = has(it.materiality?.explanation) ? String(it.materiality.explanation) : '';
    const ratios = (it.materiality?.ratios || []).map((r) => r.text).filter(has);
    if (matExp || ratios.length) {
      const sent = matExp && !/[.!?]$/.test(matExp) && ratios.length ? `${matExp}.` : matExp;
      b.push({ k: 'segs', segs: [lbl('MATERIALITY'), { text: [sent, ratios.join('; ')].filter(Boolean).join(' ') }], size: 8.2 });
    }

    if (!(has(it.researchQuestion) && has(it.whyResearch) && String(it.researchQuestion).trim() === String(it.whyResearch).trim())) b.push({ k: 'segs', segs: [lbl('WHY RESEARCH'), { text: txt(it.whyResearch, 'Not established'), color: INK }], size: 8.8 });
    if (has(it.rankReason)) b.push({ k: 'segs', segs: [lbl('WHY RANKED'), { text: String(it.rankReason) }], size: 8.4 });
    if (has(it.whyRank)) b.push({ k: 'segs', segs: [lbl(`WHY #${rank}`), { text: String(it.whyRank) }], size: 8.4 });
    // zzz839: the Catalyst Score (0-12), read-only; the price is not an input.
    const cs = it.catalystScore;
    if (cs) {
      if (!cs.scored) b.push({ k: 'segs', size: 8.4, segs: [lbl('CATALYST SCORE'), { text: `Not scored - ${cs.notScoredReason || ''}`, color: MUTED }] });
      else {
        const sc = cs.band === 'RESEARCH NOW' ? GREEN : cs.band === 'WATCH / CONFIRM' ? AMBER : cs.band.startsWith('NEGATIVE') ? RED : MUTED;
        b.push({ k: 'segs', size: 8.4, gapAfter: 0.2, segs: [lbl('CATALYST SCORE'), { text: `${cs.total}/12 ${cs.band}`, bold: true, color: sc }, { text: `${cs.unscored.length ? ` (${cs.unscored.length} unknown, up to ${cs.ceiling})` : ''}  ${scoreFactorLine(cs)}`, color: INK2 }] });
        const rule = cs.evidenceCapped || cs.weakType || cs.band.startsWith('NEGATIVE') ? `${cs.bandNote}. ` : '';
        b.push({ k: 'segs', size: 8, indent: 4, segs: [{ text: `${rule}Watch next: ${cs.kpis.slice(0, 2).join('; ')}.`, color: MUTED }] });
      }
    }

    const unknowns = (it.unknowns || []).filter(has);
    if (unknowns.length) {
      b.push({ k: 'segs', segs: [lbl('KEY UNKNOWNS (NOT NEGATIVE)')], size: 8.4, gapAfter: 0.2 });
      unknowns.forEach((u) => b.push({ k: 'segs', segs: [{ text: `- ${u}` }], size: 8.2, indent: 4 }));
    }
    const others = (it.catalysts || []).slice(1).filter((c) => c.polarity !== 'neutral' || c.kind === 'resale_registration').slice(0, 4);
    if (others.length) {
      b.push({ k: 'segs', segs: [lbl('ALSO ON FILE FOR THIS COMPANY')], size: 8.4, gapAfter: 0.2 });
      others.forEach((c) => b.push({ k: 'segs', indent: 4, size: 8.2, segs: [
        { text: c.polarity === 'negative' ? 'Negative: ' : c.polarity === 'positive' ? 'Positive: ' : 'Neutral: ', bold: true, color: c.polarity === 'negative' ? RED : c.polarity === 'positive' ? GREEN : MUTED },
        { text: txt(c.title, c.kindWord), color: INK }, { text: c.materialityText ? ` - ${c.materialityText}` : '' },
        { text: ` (${String(c.state || '').toLowerCase()} · ${c.verification})`, color: MUTED },
      ] }));
    }
    if (it.news?.narrative) {
      const n = it.news.narrative;
      b.push({ k: 'segs', size: 8.2, segs: [it.priceCommentaryOnly ? { text: 'PRICE COMMENTARY (not evidence)  ', bold: true, color: AMBER } : lbl('RUNNING STORY'), { text: `${n.label} · covered on ${n.days} days (${n.firstDate} to ${n.lastDate}) · press, secondary, verification required - "${n.lead}"` }] });
    }
    if (it.portfolio?.relevance && it.portfolio.relevance !== 'UNRELATED') {
      b.push({ k: 'segs', size: 8.2, segs: [lbl(it.portfolio.relevance === 'HOLDING' ? 'YOUR BOOK' : 'THEME'), { text: [it.portfolio.thesisVariable, it.portfolio.note].filter(has).join('. ') || 'Related to your book', color: BLUE }] });
    }
    { const also = (it.surfacedIn || []).filter((n) => !/^(research queue|unknown\s*[—-]\s*needs reading)$/i.test(n.trim()) && n.trim()); if (also.length) b.push({ k: 'segs', size: 8, segs: [lbl('ALSO LISTED UNDER'), { text: also.join(', '), color: MUTED }] }); }
    if (it.sourceUrl) b.push({ k: 'link', label: 'SOURCE', url: it.sourceUrl, size: 8.2 });
    else b.push({ k: 'segs', size: 8.2, segs: [lbl('SOURCE'), { text: 'No source link', color: MUTED }] });
    const filed = [it.filedDate ? `Filed ${String(it.filedDate).slice(0, 10)}` : '', `Source: ${sourceExistWord(it)}`, it.evidenceVerificationLabel ? `Evidence: ${evidenceWord(it)}` : '', has(it.verification) ? String(it.verification) : ''].filter(Boolean).join('  ·  ');
    b.push({ k: 'segs', size: 7.8, segs: [{ text: filed, color: MUTED }] });
    return b;
  };

  const GRID_KEY_W = 23;
  const measure = (blocks: Block[], w: number): number => blocks.reduce((a, bl) => {
    if (bl.k === 'segs') return a + layoutSegs(bl.segs, w - (bl.indent ?? 0), bl.size).length * lh(bl.size) + (bl.gapAfter ?? 1);
    if (bl.k === 'grid') {
      const colW = w / 2;
      let h = 0;
      for (let i = 0; i < bl.pairs.length; i += 2) {
        font(bl.size, true);
        const hh = Math.max(...bl.pairs.slice(i, i + 2).map((p) => wrap(p[1], colW - GRID_KEY_W - 3).length));
        h += hh * lh(bl.size) + 0.7;
      }
      return a + h + 1;
    }
    font(bl.size); return a + wrap(bl.url, w - 16).length * lh(bl.size) + 1;
  }, 0);

  /** Draw blocks with a coloured left rule; a line that would cross the bottom moves to the next page. */
  const drawBlocks = (blocks: Block[], x0: number, w: number, bar: RGB) => {
    const barLine = (h: number) => { doc.setDrawColor(...bar); doc.setLineWidth(0.9); doc.line(M + 0.45, y, M + 0.45, y + h); };
    const lineRoom = (h: number) => { if (y + h > BOTTOM) newPage(); };
    for (const bl of blocks) {
      if (bl.k === 'segs') {
        const lines = layoutSegs(bl.segs, w - (bl.indent ?? 0), bl.size);
        for (const ln of lines) { const h = lh(bl.size); lineRoom(h); barLine(h); drawSegLine(ln, x0 + (bl.indent ?? 0), y + bl.size * 0.3, bl.size, INK2); y += h; }
        const g = bl.gapAfter ?? 1; if (y + g <= BOTTOM) { barLine(g); y += g; }
      } else if (bl.k === 'grid') {
        const colW = w / 2;
        for (let i = 0; i < bl.pairs.length; i += 2) {
          const row = bl.pairs.slice(i, i + 2);
          font(bl.size, true);
          const wrapped = row.map((p) => wrap(p[1], colW - GRID_KEY_W - 3));
          const h = Math.max(...wrapped.map((x) => x.length)) * lh(bl.size) + 0.7;
          lineRoom(h); barLine(h);
          row.forEach(([k, , c], j) => {
            const cx = x0 + j * colW;
            font(6.9, true, MUTED); doc.text(pdfText(k.toUpperCase()), cx, y + bl.size * 0.3);
            font(bl.size, true, c ?? INK);
            wrapped[j].forEach((ln, n) => doc.text(ln, cx + GRID_KEY_W, y + bl.size * 0.3 + n * lh(bl.size)));
          });
          y += h;
        }
        if (y + 1 <= BOTTOM) { barLine(1); y += 1; }
      } else {
        font(bl.size);
        const lines = wrap(bl.url, w - 16);
        lines.forEach((ln, n) => {
          const h = lh(bl.size); lineRoom(h); barLine(h);
          if (n === 0) { font(bl.size, true, MUTED); doc.text(`${bl.label}`, x0, y + bl.size * 0.3); }
          font(bl.size, false, LINK);
          doc.textWithLink(ln, x0 + 16, y + bl.size * 0.3, { url: bl.url });
          const tw = doc.getTextWidth(ln);
          doc.setDrawColor(...LINK); doc.setLineWidth(0.1); doc.line(x0 + 16, y + bl.size * 0.3 + 0.5, x0 + 16 + tw, y + bl.size * 0.3 + 0.5);
          y += h;
        });
        if (y + 1 <= BOTTOM) { barLine(1); y += 1; }
      }
    }
  };

  if (!empty && queue.length) {
    const DETAIL_SUB = 'One section per card, in rank order. Every figure is as the filing states it; a missing value says "Not disclosed".';
    const usable = BOTTOM - TOP;
    // A card is kept whole when it fits on the rest of the page; otherwise it flows onto the next
    // page, but only once its head (name, move, headline, what changed) has room - no orphan heading.
    const headKeep = (blocks: Block[]): number => Math.min(measure(blocks.slice(0, 4), W - 5) + 8, usable);
    queue.forEach((it, i) => {
      const blocks = cardBlocks(it, i + 1);
      const h = measure(blocks, W - 5) + 2;
      const headerH = i === 0 ? headingH(DETAIL_SUB) : 0;
      room(headerH + (h <= 95 ? h + 3 : headKeep(blocks)));
      if (i === 0) drawHeading('Research queue: the detail', DETAIL_SUB);
      if (i > 0 && y > TOP + 0.5) { doc.setDrawColor(...RULE); doc.setLineWidth(0.15); doc.line(M + 4, y - 1.2, pageW - M, y - 1.2); }
      y += 0.6;
      drawBlocks(blocks, M + 4, W - 5, statusWord(it).rgb);
      y += 2.2;
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 5–9. THE COMPACT LISTS
  // ═════════════════════════════════════════════════════════════════════════
  const listCols: Col[] = [
    { head: 'Ticker', w: 22 }, { head: 'Company', w: 26 }, { head: 'Move', w: 14 }, { head: 'What was found', w: 46 }, { head: 'Status', w: 24 }, { head: 'Direction', w: 24 }, { head: 'Source / evidence', w: 30 },
  ];
  const listRow = (it: ResearchItem, extra?: string): Cell[] => {
    const st = statusWord(it);
    return [
      { text: nameOf(it), bold: true, color: INK },
      { text: coCell(it) },
      { text: moveOf(it), color: INK },
      { text: `${txt(it.headline, 'Headline not available')}${extra ? `\n${extra}` : ''}` },
      { text: st.word, color: st.rgb },
      { text: directionWord(it)?.word || 'Not assessed', color: directionWord(it)?.rgb ?? MUTED },
      { text: `${sourceExistWord(it)}${it.evidenceVerificationLabel ? `\n${evidenceWord(it)}` : ''}` },
    ];
  };

  if (!empty) {
    const book = view.portfolio || [];
    if (!book.length && view.bookChecked) {
      const bc = view.bookChecked;
      section('Your book', null, 8);
      para(bc.held + bc.watch === 0 ? 'No holdings or watchlist were supplied, so no match with the gainers is possible.' : `Checked ${bc.held} held and ${bc.watch} watched name${bc.held + bc.watch === 1 ? '' : 's'} against this board: none matched.`, { size: 8.6 });
    }
    if (book.length) {
      head('Your book', 'Position reviews against your thesis. Not trade instructions.');
      table([{ head: 'Ticker', w: 22 }, { head: 'Move', w: 16 }, { head: 'Event', w: 58 }, { head: 'Thesis variable', w: 34 }, { head: 'Material', w: 20 }, { head: 'Research next', w: 42 }],
        book.map((it) => [
          { text: `${nameOf(it)}${it.portfolio?.relevance === 'HOLDING' ? '\n(holding)' : ''}`, bold: true, color: INK },
          { text: moveOf(it), color: INK },
          { text: `${txt(it.headline, 'No event')}\n${statusWord(it).word}` },
          { text: txt(it.portfolio?.thesisVariable, 'Not mapped') },
          { text: materialWord(it), bold: true, color: materialRgb(it) },
          { text: (it.researchNext || []).filter(has).slice(0, 2).map((q) => `- ${q}`).join('\n') || 'Not stated' },
        ]), { maxLines: 3 });
    }

    const shownAbove = new Set([...(view.queue || []), ...(view.watch || [])].map((i) => i.ticker));
    const needsOnly = (view.needsReading || []).filter((i) => !shownAbove.has(i.ticker));
    if (needsOnly.length) {
      head('Unknown: needs reading', 'Events whose size is not established yet. Unknown is not negative: each needs its document read.');
      table(listCols, needsOnly.map((it) => listRow(it, it.economicsUnknown?.missing?.length ? `Missing: ${it.economicsUnknown.missing.join(', ')}` : 'Size not stated')), { maxLines: 4 });
    }

    const watch = view.watch || [];
    if (watch.length) {
      head('Watch / investigate', 'Real but smaller, or not yet verified.');
      table(listCols, watch.map((it) => listRow(it, [it.catalystFor ? CATALYST_FOR_WORD[it.catalystFor] + (it.catalystFor !== 'THIS_MOVE' && ageOf(it) ? ` (${ageOf(it)})` : '') : '', it.economicsUnknown ? 'Needs reading' : '', it.flags?.dilution ? 'Dilution' : '', it.flags?.band != null ? `Price band ${it.flags.band}%` : ''].filter(Boolean).join(' · '))), { maxLines: 4 });
    }

    const neg = view.negative || [];
    if (neg.length) {
      head('Negative evidence', 'Findings, not omissions. Kept even though the stock rose.');
      table(listCols, neg.map((it) => listRow(it, has(it.whyResearch) ? String(it.whyResearch) : has(it.expectationGap?.text) ? String(it.expectationGap.text) : '')), { maxLines: 4 });
    }
    const imm = view.immaterialNegative || [];
    if (imm.length) {
      para(`Immaterial tax / penalty items (under 0.25% of market cap; recorded, not ranked as negative evidence): ${imm.map((it) => `${nameOf(it)} (${it.materiality?.ratios?.[0]?.text || 'size not stated'})`).join('; ')}.`, { size: 8, color: MUTED, after: 2 });
    }

    const olderRows: Cell[][] = (view.olderFilings && view.olderFilings.length)
      ? view.olderFilings.map((r, i) => [
          { text: String(i + 1), bold: true, color: MUTED },
          { text: txt(r.name || r.ticker, 'Not disclosed'), bold: true, color: INK },
          { text: txt(r.company || r.name, 'Not disclosed'), maxLines: 2 },
          { text: pctND(r.movePct), color: INK },
          { text: `${r.filedDate ? String(r.filedDate).slice(0, 10) : 'Undated'}${typeof r.ageDays === 'number' ? `\n${Math.round(r.ageDays)}d before` : ''}` },
          { text: `${txt(r.event, 'Headline not available')}${has(r.eventLabel) ? `\n${r.eventLabel}` : ''}`, maxLines: 3, link: r.url || null },
          { text: txt(r.material, 'UNKNOWN'), bold: true, color: MUTED },
        ])
      : (view.context || []).map((it, i) => [
          { text: String(i + 1), bold: true, color: MUTED },
          { text: nameOf(it), bold: true, color: INK },
          { text: coCell(it), maxLines: 2 },
          { text: moveOf(it), color: INK },
          { text: `${it.filedDate ? String(it.filedDate).slice(0, 10) : 'Undated'}${ageOf(it) ? `\n${ageOf(it)} ago` : ''}` },
          { text: `${txt(it.headline, 'Headline not available')}\n${txt(it.eventLabel || it.eventType, '')}`, maxLines: 3 },
          { text: materialWord(it), bold: true, color: materialRgb(it) },
        ]);
    if (olderRows.length) {
      head('Older filings (context)', 'Real events filed before the move window. Context for the name, never the catalyst for this move and never counted as confirmed.');
      table([{ head: '#', w: 6 }, { head: 'Ticker', w: 21 }, { head: 'Company', w: 28 }, { head: 'Move', w: 15 }, { head: 'Filed', w: 20 }, { head: 'Event', w: 64 }, { head: 'Material', w: 20 }], olderRows, { maxLines: 3 });
    }

    const isBand = (it: ResearchItem) => it.eventClass === 'MARKET_MOVE_ONLY';
    const noCat = (view.noCatalyst || []).filter((it) => !isBand(it));
    if (noCat.length) {
      head('No identified catalyst', 'Checked: nothing meaningful filed in the window. "No catalyst" is a finding, not "nothing happened".');
      table([{ head: 'Ticker', w: 24 }, { head: 'Company', w: 34 }, { head: 'Move', w: 17 }, { head: 'What was checked', w: 103 }],
        noCat.map((it) => [
          { text: nameOf(it), bold: true, color: INK },
          { text: coCell(it) },
          { text: moveOf(it), color: INK },
          { text: [txt(it.headline, 'No meaningful filing'), it.flags?.denial ? 'Company told the exchange it has no undisclosed information.' : '', has(it.scanNote) ? (/^scanned\b/i.test(String(it.scanNote).trim()) ? String(it.scanNote) : `Scanned: ${it.scanNote}`) : '', it.evidenceGap && it.evidenceGap.code !== 'NO_CATALYST' ? it.evidenceGap.label : '', it.news?.narrative ? `Press (unverified): ${it.news.narrative.label} story over ${it.news.narrative.days} days` : ''].filter(Boolean).join('\n') },
        ]), { size: 8, maxLines: 4 });
    }
    const bands = [...(view.noCatalyst || []), ...(view.dataQuality || [])].filter(isBand);
    if (bands.length) {
      head('Price-band moves', 'Price-band movement. Does not establish demand.');
      table([{ head: 'Ticker', w: 24 }, { head: 'Company', w: 34 }, { head: 'Move', w: 17 }, { head: 'Detail', w: 103 }],
        bands.map((it) => [{ text: nameOf(it), bold: true, color: INK }, { text: coCell(it) }, { text: moveOf(it), color: INK },
          { text: `${txt(it.headline, 'No meaningful filing')}${it.flags?.band != null ? `\nBand ${it.flags.band}%` : ''}` }]), { size: 8, maxLines: 4 });
    }

    const NOTE_WORD: Record<string, string> = { new_listing: 'New listing', spac: 'SPAC', adr: 'ADR', extreme_move: 'Extreme move', band_move: 'Price-band move' };
    const notes = (view.dataNotes || []).filter((n) => !(n.kind === 'band_move' && bands.length));
    if (notes.length) {
      head('Data notes', 'Flags from the scan itself, for a second look. They say nothing about the cause of the move.');
      table([{ head: 'Ticker', w: 24 }, { head: 'Company', w: 34 }, { head: 'Move', w: 17 }, { head: 'Flag', w: 26 }, { head: 'Note', w: 77 }],
        notes.map((n) => [{ text: txt(n.name || n.ticker, 'Not disclosed'), bold: true, color: INK }, { text: txt(n.company || n.name, 'Not disclosed'), maxLines: 2 }, { text: pctND(n.movePct), color: INK }, { text: NOTE_WORD[n.kind] || n.kind, color: AMBER }, { text: txt(n.text, 'Not disclosed'), maxLines: 3 }]), { maxLines: 3 });
    }

    const dq = (view.dataQuality || []).filter((it) => !isBand(it));
    if (dq.length) {
      const listings = dq.filter((it) => it.eventClass === 'LISTING' || it.flags?.listing).length;
      head('Data quality / new listings', listings ? `${listings} recent listing${listings === 1 ? '' : 's'} excluded from fundamental comparison.` : 'Names left out of the comparison because the data is not reliable.');
      table([{ head: 'Ticker', w: 24 }, { head: 'Company', w: 34 }, { head: 'Move', w: 17 }, { head: 'Status', w: 32 }, { head: 'Detail', w: 71 }],
        dq.map((it) => { const st = statusWord(it); return [{ text: nameOf(it), bold: true, color: INK }, { text: coCell(it) }, { text: moveOf(it), color: INK }, { text: st.word, color: st.rgb }, { text: txt(it.headline, 'Not disclosed') }]; }), { size: 8, maxLines: 4 });
    }

    const fails = view.sourceFailures || [];
    if (fails.length) {
      head('Data-source failures', 'Data unavailable is not "no data found": the filing source did not answer for these names, so their filings were not checked.');
      table([{ head: 'Ticker', w: 24 }, { head: 'Reason', w: 154 }],
        fails.map((f) => [{ text: txt(f.ticker, 'Not disclosed'), bold: true, color: INK },
          { text: [txt(f.full || f.text, 'Source unavailable'), f.news?.narrative ? `Press (unverified): ${f.news.narrative.label} story, ${f.news.narrative.days} days - "${f.news.narrative.lead}"` : f.news?.items?.[0] ? `Press (unverified): ${f.news.items[0].date} - ${f.news.items[0].title}` : ''].filter(Boolean).join('\n') }]), { size: 8, maxLines: 4 });
    }
    const partial = view.partialFailures || [];
    if (partial.length) {
      head('Partial data: price history missing', 'Filings WERE checked for these names; only the price history failed, so the market response is not measured.');
      table([{ head: 'Ticker', w: 24 }, { head: 'Reason', w: 154 }], partial.map((f) => [{ text: txt(f.ticker, 'Not disclosed'), bold: true, color: INK }, { text: txt(f.text, 'Not disclosed') }]), { size: 8, maxLines: 4 });
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 10. HOW TO READ THIS
  // ═════════════════════════════════════════════════════════════════════════
  section('How to read this', null, 40);
  const legend: Array<[string, string, RGB]> = [
    ['Confirmed material event', 'The event is verified from the filing and it is large for the company.', GREEN],
    ['Confirmed, low materiality', 'A real event, but too small on its own to explain the move.', BLUE],
    ['Event filed, impact unknown', 'The event is on file; how big it is has not been established yet.', AMBER],
    ['Potential, source unverified', 'Only a summary or press line. Not yet verified from a primary document.', AMBER],
    ['Negative evidence', 'A real negative filing (tax demand, departure, cancellation, denial), kept even though the stock rose.', RED],
    ['No identified catalyst', 'Checked: no credible event in the window.', MUTED],
    ['Data unavailable', 'The source did not answer. This is not the same as "no catalyst".', AMBER],
  ];
  const legendRow = (k: string, v: string, c: RGB) => {
    const lines = layoutSegs([{ text: v }], W - 58, 8.2);
    const h = lines.length * lh(8.2) + 0.8;
    room(h);
    font(8.2, true, c); doc.text(pdfText(k), M, y + 8.2 * 0.3);
    lines.forEach((ln, i) => drawSegLine(ln, M + 58, y + 8.2 * 0.3 + i * lh(8.2), 8.2, INK2));
    y += h;
  };
  para('STATUS WORDS', { size: 7.4, bold: true, color: MUTED, after: 0.8 });
  legend.forEach(([k, v, c]) => legendRow(k, v, c));
  y += 1.5;
  para('ATTENTION WORDS', { size: 7.4, bold: true, color: MUTED, after: 0.8 });
  legendRow('Investigate / Monitor / Review', 'What kind of research attention the name deserves. These are never buy or sell instructions.', INK);
  legendRow('Thesis evidence', 'The name is in your book and the event bears on why you own it.', INK);
  y += 1.5;
  para('MATERIAL BANDS', { size: 7.4, bold: true, color: MUTED, after: 0.8 });
  legendRow(market === 'US' ? 'High / Significant' : 'Significant', 'Large against market cap or revenue (the arithmetic is shown on each card).', GREEN);
  legendRow('Moderate', 'Noticeable, but not company-changing on its own.', BLUE);
  legendRow('Small', 'Real, but small against the size of the company.', MUTED);
  legendRow('Unknown', 'The size is not stated or not yet verified. Unknown is not negative.', MUTED);
  y += 1.5;
  para('SOURCE (does a filing or press item exist?)', { size: 7.4, bold: true, color: MUTED, after: 0.8 });
  legendRow(market === 'IN' ? 'Official filing exists' : 'Official filing exists (SEC)', 'A filing on the exchange / SEC record carries the event. This alone does not mean the document was read.', BLUE);
  legendRow('Press only', 'Only press or news coverage. No official filing found yet.', AMBER);
  legendRow('Official filing and press', 'Both exist for the headline event.', BLUE);
  y += 1.5;
  para('EVIDENCE (was it checked?)', { size: 7.4, bold: true, color: MUTED, after: 0.8 });
  legendRow('Document read', 'The filing text was read and the stated facts were found in it.', GREEN);
  legendRow('Document not read', 'The filing exists but only its subject line was used. Confirm the facts in the document.', AMBER);
  legendRow('Secondary only', 'Only a third-party summary. Treat the figures as unconfirmed.', AMBER);
  legendRow('Values contradict', 'Two sources give different values. Both are shown on the card.', RED);
  y += 1.5;
  para('DIRECTION (economics of the event, never the price move)', { size: 7.4, bold: true, color: MUTED, after: 0.8 });
  legendRow('+ POSITIVE', 'The event helps the company economics.', GREEN);
  legendRow('- NEGATIVE', 'The event hurts the company economics.', RED);
  legendRow('~ MIXED / = NEUTRAL', 'Cuts both ways, or enabling / financing with no direct effect yet.', AMBER);
  legendRow('? UNKNOWN', 'The direction is not established.', MUTED);
  y += 1.5;
  para('TIMING', { size: 7.4, bold: true, color: MUTED, after: 0.8 });
  legendRow('This move / Recent / Older context', `Whether the event can be the catalyst for this move: filed within ${market === 'US' ? '7 days' : '3 sessions'}, 4 to 14 days ago, or older (context only).`, INK);
  y += 2;
  para('Price is context, never the ranking. Rank is research value: evidence, mechanism, persistence, materiality and how researchable it is. This note repeats what the page showed; it adds no figure of its own.', { size: 7.8, color: MUTED });

  // ═════════════════════════════════════════════════════════════════════════
  // FOOTER on every page: "Page N of M"
  // ═════════════════════════════════════════════════════════════════════════
  const genWords = `${dayIn(tz, gen) || gen.toISOString().slice(0, 10)} ${clockIn(tz, gen) || ''} ${market === 'US' ? 'ET' : 'IST'}`.replace(/\s+/g, ' ').trim();
  const footer = pdfText(`Market Cockpit · AI Daily Gainers · ${mName} · generated ${genWords} · ${FOOTER_TAIL}`);
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const fy = pageH - 10;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, fy - 3.2, pageW - M, fy - 3.2);
    const pg = `Page ${p} of ${pages}`;
    font(6.8, false, MUTED);
    const pw = doc.getTextWidth(pg);
    const fl = doc.splitTextToSize(footer, W - pw - (provisional ? 30 : 6)) as string[];
    fl.forEach((ln, i) => doc.text(ln, M, fy + i * 2.8));
    font(6.8, true, MUTED); doc.text(pg, pageW - M, fy, { align: 'right' });
    if (provisional) { font(6.8, true, AMBER); doc.text('PROVISIONAL', pageW - M - pw - 4, fy, { align: 'right' }); }
  }
  doc.setPage(pages);
  return doc;
}

/** Browser entry: load jspdf on the click, build, save. Returns the filename. */
export async function downloadGainersPdf(input: GainersPdfInput): Promise<string> {
  const mod: any = await import('jspdf');
  const Ctor: JsPdfCtor = mod.jsPDF || mod.default;
  const at = input.generatedAt ? toDate(input.generatedAt) : new Date();
  const doc = buildGainersPdf(Ctor, { ...input, generatedAt: at });
  const name = gainersPdfFilename(input.view, input.market, at);
  doc.save(name);
  return name;
}
