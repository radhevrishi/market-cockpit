// zzz1155 — checking a guidance figure WITHOUT an AI call (owner, 20 Oct: "lot of money going there").
// A claim is confirmed by rules when the company's own document has, in ONE passage (a sentence, or a table row of up to ~400
// characters): every new figure of the claim, a word for its measure, and its period. When old figures are claimed, they must be
// in the same passage or right next to it. A passage that says the opposite (lowered / withdrawn / not expected) never confirms.
// No match is NOT a contradiction: the claim simply goes on to the AI check (or waits for it). Pure, no imports.

export interface RuleClaim {
  metric: string | null;
  numbers: { old: number[]; new: number[] };
  period: string | null;
  kind?: string;
}
export interface RuleVerdict { ok: boolean; quote: string | null; why: string }

const METRIC_WORDS: Array<[RegExp, RegExp]> = [
  [/^(?:REVENUE|REVENUE_GROWTH|ORGANIC_GROWTH|SALES)$/i, /\b(?:revenues?|sales|top[- ]?line|turnover|income from operations)\b/i],
  [/^(?:EBITDA)$/i, /\bEBITDA\b/i],
  [/^(?:EBIT|OP_MARGIN|OPERATING)$/i, /\b(?:EBIT|operating (?:income|profit|margin)|op(?:erating)? margin)\b/i],
  [/^(?:PAT|NET_PROFIT|NET_INCOME)$/i, /\b(?:PAT|net (?:profit|income|earnings)|profit after tax)\b/i],
  [/^(?:EPS|ADJ_EPS)$/i, /\b(?:EPS|earnings per (?:diluted )?share|per share)\b/i],
  [/^(?:FCF|FCF_CONVERSION)$/i, /\b(?:free cash flow|FCF|cash conversion)\b/i],
  [/^(?:ORDER_INTAKE|BACKLOG)$/i, /\b(?:order (?:intake|inflow|book|backlog)s?|backlog|bookings)\b/i],
  [/^(?:VOLUME|PRODUCTION|CAPACITY_UTIL)$/i, /\b(?:volumes?|production|output|capacity|utili[sz]ation|tonnes?|units)\b/i],
];
const NEGATIVE = /\b(?:lower(?:ed|s)?|cut|reduc(?:ed|es|ing)|withdr(?:ew|awn)|suspend(?:ed)?|no longer|not expect|below (?:the )?(?:previous|prior|earlier))\b/i;

/** Numbers written in a passage, as plain values ("1,234.5" → 1234.5, "₹500 Cr" → 500, "25–30%" → 25 and 30). */
export function numbersIn(s: string): number[] {
  const out: number[] = [];
  for (const m of String(s).matchAll(/(?<![\w.])(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d])/g)) {
    const v = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.005 * Math.abs(b), 0.0001);
const hasAll = (pool: number[], want: number[]) => want.every((w) => pool.some((p) => near(p, w)));

/** Words a period is written with: FY27 → FY27, FY 2027, fiscal 2027, 2026-27, 2027. */
export function periodPattern(period: string | null): RegExp | null {
  const p = String(period || '').toUpperCase().replace(/\s+/g, '');
  let m = /^FY(\d{2}|\d{4})$/.exec(p) || /^(\d{4})$/.exec(p);
  if (m) {
    const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    const yy = String(y).slice(2), py = String(y - 1), pyy = String(y - 1).slice(2);
    return new RegExp(`\\b(?:FY\\s?'?(?:${yy}|${y})|F(?:iscal)?\\s?(?:year\\s)?${y}|${py}\\s?[-–/]\\s?(?:${yy}|${y})|${y})\\b`, 'i');
  }
  m = /^Q([1-4])FY(\d{2})$/.exec(p);
  if (m) return new RegExp(`\\b(?:Q${m[1]}\\s?FY\\s?'?${m[2]}|${['first', 'second', 'third', 'fourth'][Number(m[1]) - 1]} quarter)\\b`, 'i');
  m = /^FY(\d{2})[-–](\d{2})$/.exec(p);
  if (m) return new RegExp(`\\b(?:FY\\s?${m[1]}\\s?[-–]\\s?(?:FY\\s?)?${m[2]}|20${m[2]})\\b`, 'i');
  return null;
}

/** Passages of a document: sentences, and for tables the text cut into overlapping 400-character windows. */
function passages(text: string, windows: boolean): Array<{ p: string; win: boolean }> {
  const t = String(text || '').replace(/\s+/g, ' ');
  // a "sentence" longer than 400 characters is usually a table run together, not a sentence: only kept when windows are allowed
  const sents = t.split(/(?<=[.!?])\s+(?=[A-Z(₹$])/).filter((s) => s.length >= 15 && s.length <= (windows ? 1200 : 400)).map((p) => ({ p, win: false }));
  if (!windows) return sents;
  const wins: Array<{ p: string; win: boolean }> = [];
  for (let i = 0; i < t.length && wins.length < 4000; i += 200) wins.push({ p: t.slice(i, i + 400), win: true });
  return [...sents, ...wins];
}
/** A figure distinctive enough to be matched inside a table window (small round numbers like 25 or 30 are everywhere). */
const distinctive = (v: number) => Math.abs(v) >= 100 || !Number.isInteger(v * 1) || String(v).includes('.');

export function ruleVerify(claim: RuleClaim, text: string): RuleVerdict {
  const want = (claim.numbers?.new || []).filter((v) => Number.isFinite(v));
  if (!want.length) return { ok: false, quote: null, why: 'no claimed figure to look for' };
  const metricRe = METRIC_WORDS.find(([k]) => k.test(String(claim.metric || '')))?.[1] || null;
  if (!metricRe) return { ok: false, quote: null, why: 'measure not checkable by rules' };
  const perRe = periodPattern(claim.period);
  if (claim.period && claim.period !== 'UNSTATED' && !perRe) return { ok: false, quote: null, why: 'period not checkable by rules' };
  const t = String(text || '').replace(/\s+/g, ' ');
  const old = (claim.numbers?.old || []).filter((v) => Number.isFinite(v));
  // table windows only when every figure is distinctive; a plain percentage like 25 must sit in a sentence with its measure
  for (const { p } of passages(t, want.every(distinctive))) {
    if (!metricRe.test(p) || !hasAll(numbersIn(p), want)) continue;
    // small round figures (25, 30) must follow the measure word closely ("revenue growth of 25-30%"), not sit anywhere in the passage
    if (!want.every(distinctive)) {
      const mm = new RegExp(metricRe.source, 'gi'); let close = false; let m2: RegExpExecArray | null;
      const fmt = (v: number) => String(v).replace('.', '\\.');
      const lo = Math.min(...want), hi = Math.max(...want);
      const pair = want.length >= 2 ? new RegExp(`(?<![\\d.])${fmt(lo)}\\s?%?\\s?(?:to|-|–|and)\\s?${fmt(hi)}(?![\\d])`) : null;
      while ((m2 = mm.exec(p))) {
        const after = p.slice(m2.index, m2.index + m2[0].length + 45);
        if (pair ? pair.test(after) : hasAll(numbersIn(after), want)) { close = true; break; }
      }
      if (!close) continue;
    }
    if (perRe && !perRe.test(p)) continue;
    if (NEGATIVE.test(p) && !/\braise|increas|above|higher/i.test(p)) continue;
    if (old.length) {
      const at = t.indexOf(p.slice(0, 60));
      const ctx = at >= 0 ? t.slice(Math.max(0, at - 600), at + p.length + 600) : p;
      if (!hasAll(numbersIn(ctx), old)) continue;
    }
    return { ok: true, quote: p.trim().slice(0, 400), why: 'figures, measure and period found together in the company document' };
  }
  return { ok: false, quote: null, why: 'not found together in one passage' };
}
