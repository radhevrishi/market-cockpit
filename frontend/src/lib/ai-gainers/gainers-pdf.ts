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

const FOOTER_TAIL = 'Research only, not investment advice';

// ═══════════════════════════════════════════════════════════════════════════
// TEXT — what Helvetica can draw
// ═══════════════════════════════════════════════════════════════════════════

/** Characters beyond Latin-1 that jsPDF's standard fonts DO carry (WinAnsi). */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

const REPLACE: Array<[RegExp, string]> = [
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

const toDate = (v: Date | string | null | undefined): Date => (v instanceof Date ? v : v ? new Date(v) : new Date());

/** The session date the page shows: IST session for India, New York session for the US. */
export function gainersSessionYmd(view: ResearchView, market: GainersMarket, generatedAt?: Date | string | null): string {
  const d = view?.session?.date;
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
  return '-';
};
const trailOf = (it: ResearchItem): string => {
  const r = it.returns || { w1: null, m1: null, m3: null };
  const p = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? pct(v) : 'n/a');
  return `1W ${p(r.w1)} · 1M ${p(r.m1)} · 3M ${p(r.m3)}`;
};
const ageOf = (it: ResearchItem): string => (typeof it.ageDays === 'number' && Number.isFinite(it.ageDays) ? `${Math.max(0, Math.round(it.ageDays))}d` : '');

// ═══════════════════════════════════════════════════════════════════════════
// THE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

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
  const M = 15;
  const W = pageW - M * 2;
  const TOP = 16;
  const BOTTOM = pageH - 17;
  let y = TOP;

  const newPage = () => { doc.addPage(); y = TOP; };
  const room = (h: number) => { if (y + h > BOTTOM) newPage(); };
  const font = (size: number, bold = false, color: RGB = INK2) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
  };
  const lh = (size: number) => size * 0.43;   // line height in mm for a pt size
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

  /** Section heading: rule, then the title — kept with at least `keep` mm of what follows. */
  const section = (title: string, sub?: string | null, keep = 14) => {
    room(12 + keep);
    if (y > TOP + 0.5) y += 5;
    font(11, true, INK); doc.text(pdfText(title.toUpperCase()), M, y + 3.3); y += 6;
    if (sub) { para(sub, { size: 8, color: MUTED, after: 1.5 }); } else y += 1;
  };

  // ── Tables: wrapped cells, header row repeated on every page ─────────────
  interface Col { head: string; w: number; align?: 'left' | 'right' }
  interface Cell { text: string; bold?: boolean; color?: RGB; link?: string | null }
  const table = (cols: Col[], rows: Cell[][], o: { size?: number } = {}) => {
    const size = o.size ?? 7.6;
    const padX = 1.3, padY = 1.25;
    const total = cols.reduce((s, c) => s + c.w, 0);
    const scale = W / total;
    const cw = cols.map((c) => c.w * scale);
    const L = lh(size);
    const drawHead = () => {
      font(6.8, true, MUTED);
      const heads = cols.map((c, i) => wrap(c.head.toUpperCase(), cw[i] - padX * 2));
      const h = Math.max(...heads.map((h) => h.length)) * lh(6.8) + padY * 2;
      let x = M;
      heads.forEach((hl, i) => { hl.forEach((ln, k) => doc.text(ln, cols[i].align === 'right' ? x + cw[i] - padX : x + padX, y + padY + 6.8 * 0.3 + k * lh(6.8), cols[i].align === 'right' ? { align: 'right' } : undefined)); x += cw[i]; });
      y += h;
      doc.setDrawColor(...INK2); doc.setLineWidth(0.3); doc.line(M, y, pageW - M, y);
    };
    room(lh(6.8) * 2 + L * 2 + 6);
    drawHead();
    for (const r of rows) {
      const cells = r.map((c, i) => { font(size, c.bold); return wrap(c.text, cw[i] - padX * 2); });
      const h = Math.max(1, ...cells.map((c) => c.length)) * L + padY * 2;
      if (y + h > BOTTOM) { newPage(); drawHead(); }
      let x = M;
      cells.forEach((lines, i) => {
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
      y += h;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.15); doc.line(M, y, pageW - M, y);
    }
    y += 2;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 1. COVER BLOCK
  // ═════════════════════════════════════════════════════════════════════════
  const s = view.session || { date: null, scanAt: null, status: 'Unknown', cached: false };
  const ymd = gainersSessionYmd(view, market, gen);
  font(7.5, true, MUTED); doc.text('MARKET COCKPIT  ·  RESEARCH NOTE', M, y + 2.5); y += 5;
  font(20, true, INK); doc.text('AI Daily Gainers', M, y + 6.5);
  const titleW = doc.getTextWidth('AI Daily Gainers');
  font(12, false, INK2); doc.text(pdfText(`${mName}${market === 'IN' ? '  (NSE / BSE)' : '  (NASDAQ / NYSE / AMEX)'}`), M + titleW + 4, y + 6.5);
  y += 10;
  para('Fundamental events behind the session\'s unusual moves, ranked by research value, not by return. Price is context, never the ranking.', { size: 9, color: INK2, after: 3 });
  if (input.demo) para('DEMO DATA: an illustrative fixture for layout checks. No live data was read.', { size: 8.5, bold: true, color: AMBER, after: 2 });

  // Session box: key / value rows inside a thin border.
  const scanD = s.scanAt ? new Date(s.scanAt) : null;
  const scanOk = !!scanD && Number.isFinite(scanD.getTime());
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
  const dataText = s.cached ? `Cached scan${scanOk ? ` from ${market === 'US' ? `${clockIn('America/New_York', scanD!)} ET` : `${clockIn('Asia/Kolkata', scanD!)} IST`}` : ''}` : 'Live scan completed';
  const kvRows: Array<[string, string, RGB?]> = [
    ['Market', market === 'IN' ? 'India' : 'USA'],
    ['Session', `${sessionWords(ymd)}${market === 'US' ? ' (New York date)' : ' (India date)'}`],
    ['Scan time', scanText],
    ['Status', statusText, live ? BLUE : undefined],
    ['Data', dataText],
  ];
  if (!live && s.date && /last|previous|closed/i.test(String(s.status))) kvRows.push(['Note', 'These are the last completed session\'s moves, not today\'s.', AMBER]);
  if (has(input.sessionNote)) kvRows.push(['Session note', String(input.sessionNote)]);
  if (market === 'US' && has(input.criteria)) kvRows.push(['Scan criteria', String(input.criteria)]);
  {
    const keyW = 27;
    const valW = W - keyW - 6;
    const lines = kvRows.map(([, v]) => { font(8.8); return wrap(v, valW); });
    const h = lines.reduce((a, l) => a + l.length * lh(8.8) + 1.1, 0) + 4;
    room(h);
    const top = y;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.roundedRect(M, top, W, h, 1.5, 1.5, 'S');
    doc.setDrawColor(...BLUE); doc.setLineWidth(0.9); doc.line(M + 0.45, top + 1.2, M + 0.45, top + h - 1.2);
    y = top + 2.3;
    kvRows.forEach(([k, , color], i) => {
      font(7.2, true, MUTED); doc.text(pdfText(k.toUpperCase()), M + 3.5, y + 8.8 * 0.3);
      font(8.8, k === 'Status' || k === 'Session', color ?? INK);
      lines[i].forEach((ln, j) => doc.text(ln, M + 3.5 + keyW, y + 8.8 * 0.3 + j * lh(8.8)));
      y += lines[i].length * lh(8.8) + 1.1;
    });
    y = top + h + 5;
  }

  // Market summary grid.
  const sm = view.summary;
  const empty = !sm || (sm.scanned || 0) === 0;
  if (sm) {
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
    const perRow = cells.length > 8 ? 5 : 4;
    const gap = 2.2;
    const cwid = (W - gap * (perRow - 1)) / perRow;
    const ch = 13.5;
    const rows = Math.ceil(cells.length / perRow);
    room(8 + rows * (ch + gap));
    font(8, true, MUTED); doc.text('MARKET SUMMARY', M, y + 2.6); y += 5;
    cells.forEach((c, i) => {
      const cx = M + (i % perRow) * (cwid + gap);
      const cy = y + Math.floor(i / perRow) * (ch + gap);
      const n = Number.isFinite(c.n) ? c.n : 0;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.3); doc.roundedRect(cx, cy, cwid, ch, 1.2, 1.2, 'S');
      font(14, true, n > 0 ? c.rgb : MUTED); doc.text(String(n), cx + 2.6, cy + 6.4);
      font(6.6, true, MUTED);
      wrap(c.l.toUpperCase(), cwid - 5).slice(0, 2).forEach((ln, k) => doc.text(ln, cx + 2.6, cy + 9.6 + k * 2.6));
    });
    y += rows * (ch + gap) + 2;
    // zzz801 (US only): catalysts found by category (SEC vs press only).
    const uc = sm.usCatalysts;
    if (uc) {
      const cats = uc.byCategory.map((c) => `${c.category} ${c.names}${c.press ? ` (${c.press} press only)` : ''}`).join('  ·  ');
      para(`Catalysts found by category: ${cats || 'none'}. ${uc.found} name${uc.found === 1 ? '' : 's'} with a catalyst found in filings or news; ${uc.none} with none found.`, { size: 7.8 });
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
    section('Top 3 research priorities', 'The names that most deserve research time today.');
    top3.forEach((it, i) => {
      const st = statusWord(it);
      const head: Seg[] = [{ text: `#${i + 1}  `, bold: true, color: MUTED }, { text: nameOf(it), bold: true, color: INK }];
      if (companyOf(it)) head.push({ text: `  ${companyOf(it)}`, color: INK2 });
      head.push({ text: `   ${moveOf(it)}`, bold: true, color: INK });
      const blocks: Array<{ segs: Seg[]; size: number }> = [
        { segs: head, size: 10 },
        { segs: [{ text: txt(it.headline, 'Headline not available'), bold: true, color: INK }], size: 9 },
      ];
      if (has(it.whyResearch)) blocks.push({ segs: [{ text: String(it.whyResearch) }], size: 8.6 });
      blocks.push({ segs: [
        { text: st.word.toUpperCase(), bold: true, color: st.rgb }, { text: '   ·   ', color: MUTED },
        { text: triageWord(it).toUpperCase(), bold: true, color: INK2 }, { text: '   ·   Material: ', color: MUTED },
        { text: materialWord(it), bold: true, color: materialRgb(it) }, { text: '   ·   Source: ', color: MUTED }, { text: sourceWord(it), color: INK2 },
      ], size: 7.8 });
      const laid = blocks.map((b) => ({ ...b, lines: layoutSegs(b.segs, W - 6, b.size) }));
      const h = laid.reduce((a, b) => a + b.lines.length * lh(b.size) + 0.9, 0) + 3;
      room(h + 2);
      const top = y;
      doc.setDrawColor(...st.rgb); doc.setLineWidth(0.9); doc.line(M + 0.45, top + 0.6, M + 0.45, top + h - 0.6);
      y += 1.6;
      laid.forEach((b) => { b.lines.forEach((ln) => { drawSegLine(ln, M + 4, y + b.size * 0.3, b.size, INK2); y += lh(b.size); }); y += 0.9; });
      y = top + h + 2.2;
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. RESEARCH QUEUE — ranked table
  // ═════════════════════════════════════════════════════════════════════════
  const queue = view.queue || [];
  const qCols: Col[] = [
    { head: '#', w: 6 }, { head: 'Ticker', w: 21 }, { head: 'Company', w: 25 }, { head: 'Move', w: 24 },
    { head: 'Status', w: 28 }, { head: 'Event', w: 27 }, { head: 'Material', w: 23 }, { head: 'Source', w: 23 },
  ];
  const moveCell = (it: ResearchItem): Cell => ({ text: `${moveOf(it)}\n${trailOf(it).replace(/ · /g, '\n')}`, color: INK });
  if (!empty) {
    section('Research queue', 'Ranked by research value. Price is context, never the ranking.');
    if (!queue.length) {
      para('No name on this board carries an event that deserves research time. That is a valid result, not an empty page.', { size: 9 });
    } else {
      table(qCols, queue.map((it, i) => {
        const st = statusWord(it);
        return [
          { text: String(i + 1), bold: true, color: MUTED },
          { text: nameOf(it) + (it.displayCode && it.displayCode !== nameOf(it) ? `\n${it.displayCode}` : ''), bold: true, color: INK },
          { text: companyOf(it) || '-' },
          moveCell(it),
          { text: `${st.word}\n${triageWord(it)}${it.catalystFor ? ` · ${CATALYST_FOR_WORD[it.catalystFor]}${it.catalystFor !== 'THIS_MOVE' && ageOf(it) ? ` (${ageOf(it)})` : ''}` : ''}`, color: st.rgb },
          { text: txt(it.eventLabel || it.eventType, 'Not classified') },
          { text: materialWord(it), bold: true, color: materialRgb(it) },
          { text: sourceWord(it) },
        ];
      }));
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

  const cardBlocks = (it: ResearchItem, rank: number): Block[] => {
    const b: Block[] = [];
    const st = statusWord(it);
    const head: Seg[] = [{ text: `#${rank}  `, bold: true, color: MUTED }, { text: nameOf(it), bold: true, color: INK }];
    if (it.displayCode && it.displayCode !== nameOf(it)) head.push({ text: ` (${it.displayCode})`, color: MUTED });
    if (companyOf(it)) head.push({ text: `  ·  ${companyOf(it)}`, color: INK2 });
    b.push({ k: 'segs', segs: head, size: 11, gapAfter: 0.6 });
    const tags: Seg[] = [
      { text: `Move ${moveOf(it)}`, bold: true, color: INK }, { text: `  (${trailOf(it)})`, color: MUTED }, { text: '     ' },
      { text: st.word.toUpperCase(), bold: true, color: st.rgb }, { text: '  ·  ', color: MUTED }, { text: triageWord(it).toUpperCase(), bold: true, color: INK2 },
    ];
    if (it.catalystFor) tags.push({ text: '  ·  ', color: MUTED }, { text: `${CATALYST_FOR_WORD[it.catalystFor].toUpperCase()}${it.catalystFor !== 'THIS_MOVE' && ageOf(it) ? ` (${ageOf(it)})` : ''}`, bold: true, color: it.catalystFor === 'THIS_MOVE' ? BLUE : it.catalystFor === 'RECENT' ? AMBER : MUTED });
    b.push({ k: 'segs', segs: tags, size: 7.8, gapAfter: 1.6 });
    b.push({ k: 'segs', segs: [{ text: txt(it.headline, 'Headline not available'), bold: true, color: INK }], size: 9.6, gapAfter: 1.6 });
    if (it.eventClass === 'NO_CATALYST' && has(it.scanNote)) b.push({ k: 'segs', segs: [lbl('SCANNED'), { text: String(it.scanNote) }], size: 8.2 });

    // WHAT CHANGED
    const us = it.market === 'US' ? it.usCard : null;
    if (us) {
      b.push({ k: 'segs', segs: [lbl('WHAT CHANGED'), { text: txt(it.whatChanged, 'Not stated in the filing'), bold: true, color: INK }], size: 8.8 });
      (us.extra || []).filter(has).forEach((x) => b.push({ k: 'segs', segs: [{ text: `- ${x}` }], size: 8.2, indent: 4 }));
      (us.flags || []).filter(has).forEach((x) => b.push({ k: 'segs', segs: [{ text: `Caution: ${x}`, color: AMBER }], size: 8.2, indent: 4 }));
      // zzz801: the catalysts the taxonomy found — SEC vs press only, the sentence, a figure only when stated.
      if (Array.isArray(us.catalysts)) {
        if (!us.catalysts.length) b.push({ k: 'segs', segs: [lbl('CATALYSTS FOUND'), { text: 'No catalyst found in filings or news', color: MUTED }], size: 8.2 });
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
      b.push({ k: 'segs', segs: [lbl(`WHAT CHANGED (EARNINGS${e.quarter ? ` ${e.quarter}` : ''}${e.filedDaysAgo != null ? `, FILED ${e.filedDaysAgo}D AGO` : ''})`)], size: 8.8, gapAfter: 0.4 });
      b.push({ k: 'grid', size: 8.2, pairs: [
        ['Revenue', rev], ['EBITDA', e.ebitdaYoY == null ? 'Not disclosed' : `${pctND(e.ebitdaYoY)} YoY`],
        ['Margin', margin, e.marginNow != null && e.marginPrior != null ? (e.marginNow >= e.marginPrior ? GREEN : RED) : undefined],
        ['PAT', e.patYoY == null ? 'Not disclosed' : `${pctND(e.patYoY)} YoY`],
        ['CFO / PAT', e.cfoToPat == null ? 'Not disclosed' : `${e.cfoToPat.toFixed(2)}x`, e.cfoToPat != null && e.cfoToPat < 0.5 ? AMBER : undefined],
        ['Guidance', g[e.guidance] || 'Not stated', e.guidance === 'RAISED' ? GREEN : e.guidance === 'CUT' ? RED : undefined],
        ['Order book', ob[e.orderBook] || 'Not stated'],
      ] });
      b.push({ k: 'segs', segs: [lbl('KEY CHANGE'), { text: txt(e.keyChange, 'Not identified'), color: INK }], size: 8.4 });
    } else if (it.before || it.after) {
      b.push({ k: 'segs', segs: [lbl('WHAT CHANGED'), { text: txt(it.before, 'Before: not disclosed') }, { text: '  ->  ', bold: true, color: MUTED }, { text: txt(it.after, 'After: not disclosed'), bold: true, color: INK }], size: 8.8 });
      if (has(it.whatChanged)) b.push({ k: 'segs', segs: [{ text: String(it.whatChanged) }], size: 8.4, indent: 4 });
    } else {
      b.push({ k: 'segs', segs: [lbl('WHAT CHANGED'), has(it.whatChanged) ? { text: String(it.whatChanged), bold: true, color: INK } : { text: 'No change stated in a filing', color: MUTED }], size: 8.8 });
    }
    // zzz803 (India): the India card — filed vs press events, the result backdrop, the clarification; a figure only when stated.
    const inc = it.market === 'IN' ? it.inCard : null;
    if (inc && Array.isArray(inc.catalysts)) {
      const cs = inc.catalysts.filter((c) => c.id !== 'price_clarification' && c.id !== 'exchange_query');
      if (!cs.length && !inc.backdrop && !inc.clarification) b.push({ k: 'segs', segs: [lbl('CATALYSTS FOUND'), { text: `No catalyst found in filings or news${inc.routine.length ? ` (routine only: ${Array.from(new Set(inc.routine.map((r) => r.label.toLowerCase()))).slice(0, 3).join(', ')})` : ''}`, color: MUTED }], size: 8.2 });
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

    // Event / stage / material / duration / persistence / catalyst state
    const pairs: Array<[string, string, RGB?]> = [
      ['Event', txt(it.eventLabel || it.eventType, 'Not classified')],
      ['Stage', `${STAGE_WORD[it.stage] || 'Unknown'}${us?.stageText ? ` · ${us.stageText}` : ''}`],
      ['Material', materialWord(it), materialRgb(it)],
      ['Duration', `${it.potentialDuration ? POT_WORD[it.potentialDuration.value] || 'Not established' : POT_WORD[it.persistence] || 'Not established'}${it.potentialDuration?.basis === 'TYPE' ? ' (by type)' : ''}${it.durations?.contractual ? ` · contract: ${it.durations.contractual}` : ''}`],
      ['Persistence', it.persistenceEvidence && it.persistenceEvidence.level !== 'NONE' ? (PERSIST_EV_WORD[it.persistenceEvidence.level] || it.persistenceEvidence.level) : it.persistenceTest ? (it.persistenceTest.grade === 'EARLY' ? 'Early / unproven' : String(it.persistenceTest.grade)) : 'Not established'],
      ['Catalyst state', it.durations?.catalystState ? it.durations.catalystState.split(' (')[0] : it.catalysts?.[0] ? it.catalysts[0].stateWord : 'Not recorded'],
    ];
    b.push({ k: 'grid', size: 8.2, pairs });
    const matExp = has(it.materiality?.explanation) ? String(it.materiality.explanation) : '';
    const ratios = (it.materiality?.ratios || []).map((r) => r.text).filter(has);
    if (matExp || ratios.length) {
      const sent = matExp && !/[.!?]$/.test(matExp) && ratios.length ? `${matExp}.` : matExp;
      b.push({ k: 'segs', segs: [lbl('MATERIALITY'), { text: [sent, ratios.join('; ')].filter(Boolean).join(' ') }], size: 8.2 });
    }

    b.push({ k: 'segs', segs: [lbl('WHY RESEARCH'), { text: txt(it.whyResearch, 'Not established'), color: INK }], size: 8.8 });
    if (has(it.whyRank)) b.push({ k: 'segs', segs: [lbl(`WHY #${rank}`), { text: String(it.whyRank) }], size: 8.4 });

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
      b.push({ k: 'segs', size: 8.2, segs: [lbl('RUNNING STORY'), { text: `${n.label} · covered on ${n.days} days (${n.firstDate} to ${n.lastDate}) · press, secondary, verification required - "${n.lead}"` }] });
    }
    if (it.portfolio?.relevance && it.portfolio.relevance !== 'UNRELATED') {
      b.push({ k: 'segs', size: 8.2, segs: [lbl(it.portfolio.relevance === 'HOLDING' ? 'YOUR BOOK' : 'THEME'), { text: [it.portfolio.thesisVariable, it.portfolio.note].filter(has).join('. ') || 'Related to your book', color: BLUE }] });
    }
    if (it.sourceUrl) b.push({ k: 'link', label: 'SOURCE', url: it.sourceUrl, size: 8.2 });
    else b.push({ k: 'segs', size: 8.2, segs: [lbl('SOURCE'), { text: 'No source link', color: MUTED }] });
    const filed = [it.filedDate ? `Filed ${String(it.filedDate).slice(0, 10)}` : '', `Source: ${sourceWord(it)}`, has(it.verification) ? String(it.verification) : ''].filter(Boolean).join('  ·  ');
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
    section('Research queue: the detail', 'One section per card, in rank order. Every figure is as the filing states it; a missing value says "Not disclosed".', 30);
    const usable = BOTTOM - TOP;
    queue.forEach((it, i) => {
      const blocks = cardBlocks(it, i + 1);
      const h = measure(blocks, W - 5) + 2;
      // Keep each card on one page when it fits on a page at all.
      if (h <= usable) room(h + 3); else room(40);
      if (i > 0 && y > TOP + 0.5) { doc.setDrawColor(...RULE); doc.setLineWidth(0.15); doc.line(M + 4, y - 1.6, pageW - M, y - 1.6); }
      y += 0.8;
      drawBlocks(blocks, M + 4, W - 5, statusWord(it).rgb);
      y += 3.2;
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 5–9. THE COMPACT LISTS
  // ═════════════════════════════════════════════════════════════════════════
  const listCols: Col[] = [
    { head: 'Ticker', w: 22 }, { head: 'Company', w: 30 }, { head: 'Move', w: 16 }, { head: 'What was found', w: 62 }, { head: 'Status', w: 26 }, { head: 'Source', w: 22 },
  ];
  const listRow = (it: ResearchItem, extra?: string): Cell[] => {
    const st = statusWord(it);
    return [
      { text: nameOf(it), bold: true, color: INK },
      { text: companyOf(it) || '-' },
      { text: moveOf(it), color: INK },
      { text: `${txt(it.headline, 'Headline not available')}${extra ? `\n${extra}` : ''}` },
      { text: st.word, color: st.rgb },
      { text: sourceWord(it) },
    ];
  };

  if (!empty) {
    const book = view.portfolio || [];
    if (book.length) {
      section('Your book', 'Position reviews against your thesis. Not trade instructions.');
      table([{ head: 'Ticker', w: 22 }, { head: 'Move', w: 16 }, { head: 'Event', w: 58 }, { head: 'Thesis variable', w: 34 }, { head: 'Material', w: 20 }, { head: 'Research next', w: 42 }],
        book.map((it) => [
          { text: `${nameOf(it)}${it.portfolio?.relevance === 'HOLDING' ? '\n(holding)' : ''}`, bold: true, color: INK },
          { text: moveOf(it), color: INK },
          { text: `${txt(it.headline, 'No event')}\n${statusWord(it).word}` },
          { text: txt(it.portfolio?.thesisVariable, 'Not mapped') },
          { text: materialWord(it), bold: true, color: materialRgb(it) },
          { text: (it.researchNext || []).filter(has).slice(0, 2).map((q) => `- ${q}`).join('\n') || '-' },
        ]));
    }

    const shownAbove = new Set([...(view.queue || []), ...(view.watch || [])].map((i) => i.ticker));
    const needsOnly = (view.needsReading || []).filter((i) => !shownAbove.has(i.ticker));
    if (needsOnly.length) {
      section('Unknown: needs reading', 'Events whose size is not established yet. Unknown is not negative: each needs its document read.');
      table(listCols, needsOnly.map((it) => listRow(it, it.economicsUnknown?.missing?.length ? `Missing: ${it.economicsUnknown.missing.join(', ')}` : 'Size not stated')));
    }

    const watch = view.watch || [];
    if (watch.length) {
      section('Watch / investigate', 'Real but smaller, or not yet verified.');
      table(listCols, watch.map((it) => listRow(it, [it.catalystFor ? CATALYST_FOR_WORD[it.catalystFor] + (it.catalystFor !== 'THIS_MOVE' && ageOf(it) ? ` (${ageOf(it)})` : '') : '', it.economicsUnknown ? 'Needs reading' : '', it.flags?.dilution ? 'Dilution' : '', it.flags?.band != null ? `Price band ${it.flags.band}%` : ''].filter(Boolean).join(' · '))));
    }

    const neg = view.negative || [];
    if (neg.length) {
      section('Negative evidence', 'Findings, not omissions. Kept even though the stock rose.');
      table(listCols, neg.map((it) => listRow(it, has(it.whyResearch) ? String(it.whyResearch) : has(it.expectationGap?.text) ? String(it.expectationGap.text) : '')));
    }
    const imm = view.immaterialNegative || [];
    if (imm.length) {
      para(`Immaterial tax / penalty items (under 0.25% of market cap; recorded, not ranked as negative evidence): ${imm.map((it) => `${nameOf(it)} (${it.materiality?.ratios?.[0]?.text || 'size not stated'})`).join('; ')}.`, { size: 8, color: MUTED, after: 2 });
    }

    const context = view.context || [];
    if (context.length) {
      section('Older filings (context)', 'Real events filed before the move window. Context for the name, never the catalyst for this move and never counted as confirmed.');
      table([{ head: '#', w: 6 }, { head: 'Ticker', w: 21 }, { head: 'Company', w: 28 }, { head: 'Move', w: 15 }, { head: 'Filed', w: 20 }, { head: 'Event', w: 64 }, { head: 'Material', w: 20 }],
        context.map((it, i) => [
          { text: String(i + 1), bold: true, color: MUTED },
          { text: nameOf(it), bold: true, color: INK },
          { text: companyOf(it) || '-' },
          { text: moveOf(it), color: INK },
          { text: `${it.filedDate ? String(it.filedDate).slice(0, 10) : 'Undated'}${ageOf(it) ? `\n${ageOf(it)} ago` : ''}` },
          { text: `${txt(it.headline, 'Headline not available')}\n${txt(it.eventLabel || it.eventType, '')}` },
          { text: materialWord(it), bold: true, color: materialRgb(it) },
        ]));
    }

    const isBand = (it: ResearchItem) => it.eventClass === 'MARKET_MOVE_ONLY';
    const noCat = (view.noCatalyst || []).filter((it) => !isBand(it));
    if (noCat.length) {
      section('No identified catalyst', 'Checked: nothing meaningful filed in the window. "No catalyst" is a finding, not "nothing happened".');
      table([{ head: 'Ticker', w: 24 }, { head: 'Company', w: 34 }, { head: 'Move', w: 17 }, { head: 'What was checked', w: 103 }],
        noCat.map((it) => [
          { text: nameOf(it), bold: true, color: INK },
          { text: companyOf(it) || '-' },
          { text: moveOf(it), color: INK },
          { text: [txt(it.headline, 'No meaningful filing'), it.flags?.denial ? 'Company told the exchange it has no undisclosed information.' : '', has(it.scanNote) ? (/^scanned\b/i.test(String(it.scanNote).trim()) ? String(it.scanNote) : `Scanned: ${it.scanNote}`) : '', it.evidenceGap && it.evidenceGap.code !== 'NO_CATALYST' ? it.evidenceGap.label : '', it.news?.narrative ? `Press (unverified): ${it.news.narrative.label} story over ${it.news.narrative.days} days` : ''].filter(Boolean).join('\n') },
        ]), { size: 7.4 });
    }
    const bands = [...(view.noCatalyst || []), ...(view.dataQuality || [])].filter(isBand);
    if (bands.length) {
      section('Price-band moves', 'Price-band movement. Does not establish demand.');
      table([{ head: 'Ticker', w: 24 }, { head: 'Company', w: 34 }, { head: 'Move', w: 17 }, { head: 'Detail', w: 103 }],
        bands.map((it) => [{ text: nameOf(it), bold: true, color: INK }, { text: companyOf(it) || '-' }, { text: moveOf(it), color: INK },
          { text: `${txt(it.headline, 'No meaningful filing')}${it.flags?.band != null ? `\nBand ${it.flags.band}%` : ''}` }]), { size: 7.4 });
    }

    const dq = (view.dataQuality || []).filter((it) => !isBand(it));
    if (dq.length) {
      const listings = dq.filter((it) => it.eventClass === 'LISTING' || it.flags?.listing).length;
      section('Data quality / new listings', listings ? `${listings} recent listing${listings === 1 ? '' : 's'} excluded from fundamental comparison.` : 'Names left out of the comparison because the data is not reliable.');
      table([{ head: 'Ticker', w: 24 }, { head: 'Company', w: 34 }, { head: 'Move', w: 17 }, { head: 'Status', w: 32 }, { head: 'Detail', w: 71 }],
        dq.map((it) => { const st = statusWord(it); return [{ text: nameOf(it), bold: true, color: INK }, { text: companyOf(it) || '-' }, { text: moveOf(it), color: INK }, { text: st.word, color: st.rgb }, { text: txt(it.headline, '-') }]; }), { size: 7.4 });
    }

    const fails = view.sourceFailures || [];
    if (fails.length) {
      section('Data-source failures', 'Data unavailable is not "no data found": the filing source did not answer for these names, so their filings were not checked.');
      table([{ head: 'Ticker', w: 24 }, { head: 'Reason', w: 154 }],
        fails.map((f) => [{ text: txt(f.ticker, '-'), bold: true, color: INK },
          { text: [txt(f.full || f.text, 'Source unavailable'), f.news?.narrative ? `Press (unverified): ${f.news.narrative.label} story, ${f.news.narrative.days} days - "${f.news.narrative.lead}"` : f.news?.items?.[0] ? `Press (unverified): ${f.news.items[0].date} - ${f.news.items[0].title}` : ''].filter(Boolean).join('\n') }]), { size: 7.4 });
    }
    const partial = view.partialFailures || [];
    if (partial.length) {
      section('Partial data: price history missing', 'Filings WERE checked for these names; only the price history failed, so the market response is not measured.');
      table([{ head: 'Ticker', w: 24 }, { head: 'Reason', w: 154 }], partial.map((f) => [{ text: txt(f.ticker, '-'), bold: true, color: INK }, { text: txt(f.text, '-') }]), { size: 7.4 });
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 10. HOW TO READ THIS
  // ═════════════════════════════════════════════════════════════════════════
  section('How to read this', null, market === 'US' ? 112 : 118);
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
    const h = lines.length * lh(8.2) + 1.2;
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
  para('SOURCES', { size: 7.4, bold: true, color: MUTED, after: 0.8 });
  legendRow('Verified document', market === 'US' ? 'Read from the SEC filing itself (8-K, 6-K, 10-Q, offering or 13D).' : 'The filing was read and the quoted text was found in it.', GREEN);
  legendRow(market === 'IN' ? 'Exchange filing' : 'SEC filing', `${market === 'IN' ? 'An exchange' : 'An SEC'} filing exists; its subject is verified, the full document was not read.`, BLUE);
  legendRow('Summary only', 'Only a third-party summary. Treat the figures as unconfirmed.', AMBER);
  legendRow('Press only', 'Only press or news coverage. No official filing found yet.', AMBER);
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
    const fl = doc.splitTextToSize(footer, W - pw - 6) as string[];
    fl.forEach((ln, i) => doc.text(ln, M, fy + i * 2.8));
    font(6.8, true, MUTED); doc.text(pg, pageW - M, fy, { align: 'right' });
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
