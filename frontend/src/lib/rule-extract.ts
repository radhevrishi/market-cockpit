// zzz1156 — reading guidance WITHOUT an AI call where a document states it plainly (owner, 20 Oct: "lot of money going there").
// Strict sentence patterns only: in ONE management sentence that names a future fiscal year and uses a guidance word ("expect",
// "guide", "target", "aim", "will"), a measure (revenue / revenue growth / EBITDA / EBITDA margin / PAT) followed directly by its
// figure or range. The rows have the shape the AI files and then pass EXACTLY the same row checks as an AI row (verbatim quote,
// numbers in the quote, management speaker in a transcript). A document goes to the AI instead when it is from the US, describes a
// CHANGE of guidance (the AI files the earlier figure), names a part of the company next to the figure, or has nothing this plain.
// Pure, no imports.

type RowLike = Record<string, unknown>;

const CHANGE_WORDS = /\b(?:rais(?:e|ed|es|ing)\s+(?:(?:our|the|its|full[- ]year|annual)\s+)*(?:guidance|outlook|target|forecast)|revis(?:e|ed|ing)\s+(?:(?:our|the|its)\s+)?(?:guidance|outlook|target)|upgrad(?:e|ed|ing)\s+(?:(?:our|the|its)\s+)?(?:guidance|outlook)|(?:earlier|previous(?:ly)?|prior)\s+(?:guid|indicat|target|outlook)|lower(?:ed|ing)?\s+(?:(?:our|the|its)\s+)?(?:guidance|outlook|target)|from (?:our )?(?:earlier|previous|prior) (?:guidance|estimate|target))/i;
const PART_WORDS = /\b(?:segment|division|subsidiar(?:y|ies)|vertical|export|domestic|international|overseas|business unit|product line|brand|plant|region|geograph|order book|order inflow|AUM|advances|deposits|disbursement|pre-?sales|bookings|volumes?|industry|sector|market (?:size|growth)|consolidated basis of|standalone)\b/i;
const GUIDE_WORDS = /\b(?:expect(?:s|ed|ing)?|guid(?:e|ed|ance|ing)|target(?:s|ed|ing)?|aim(?:s|ed|ing)?|project(?:s|ed|ing)?|anticipat\w*|outlook|will (?:be|reach|achieve|deliver|grow|clock|cross|touch|do))\b/i;
const QUESTION = /\?\s*$|^\s*(?:analyst|participant|question)\b/i;
const FY = /\b(?:FY\s?'?(\d{2})|FY\s?20(\d{2})|20\d{2}\s?[-–]\s?(\d{2})\b|fiscal (?:year )?20(\d{2}))/gi;

const NUM = String.raw`(?:₹|Rs\.?|INR)?\s?(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const RANGE = String.raw`${NUM}\s?(?:%|crores?|cr\.?)?\s?(?:to|-|–|and)\s?${NUM}`;
const UNIT_CR = String.raw`\s?(?:crores?|cr\.?)\b`;
// measure words, then up to 6 short connecting words, then the figure (never another figure in between)
const GAP = String.raw`(?:\s+(?:of|at|to|around|about|approximately|approx\.?|in the range of|between|be|is|by|nearly|close to|upwards of|over|~))*\s*`;
const PATTERNS: Array<{ metric: string; label: string; unit: '%' | 'crore'; re: RegExp }> = [
  { metric: 'EBITDA_MARGIN', label: 'EBITDA margin', unit: '%', re: new RegExp(String.raw`\bEBITDA margins?${GAP}(?:${RANGE}|${NUM})\s?%`, 'i') },
  { metric: 'REVENUE_GROWTH', label: 'Revenue growth', unit: '%', re: new RegExp(String.raw`\b(?:revenue|top[- ]?line|sales) growth${GAP}(?:${RANGE}|${NUM})\s?%`, 'i') },
  { metric: 'REVENUE_GROWTH', label: 'Revenue growth', unit: '%', re: new RegExp(String.raw`\bgrow (?:our )?(?:revenues?|top[- ]?line|sales)${GAP}(?:${RANGE}|${NUM})\s?%`, 'i') },
  { metric: 'REVENUE', label: 'Revenue', unit: 'crore', re: new RegExp(String.raw`\b(?:revenues?|top[- ]?line|sales|turnover)(?! growth)${GAP}(?:${RANGE}|${NUM})${UNIT_CR}`, 'i') },
  { metric: 'EBITDA', label: 'EBITDA', unit: 'crore', re: new RegExp(String.raw`\bEBITDA(?! margin)${GAP}(?:${RANGE}|${NUM})${UNIT_CR}`, 'i') },
  { metric: 'PAT', label: 'PAT', unit: 'crore', re: new RegExp(String.raw`\b(?:PAT|net profit|profit after tax)${GAP}(?:${RANGE}|${NUM})${UNIT_CR}`, 'i') },
];
const toNum = (s: string | undefined) => (s == null ? null : Number(s.replace(/,/g, '')));

function sentences(text: string): string[] {
  return String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z₹"“(])/).filter((s) => s.length >= 20 && s.length <= 400);
}

/** The single future fiscal year named in the sentence ("FY27"), or null when none or several. */
function fyOf(s: string, minFy: number): string | null {
  const ys = new Set<number>();
  for (const m of s.matchAll(FY)) { const y = Number(m[1] || m[2] || m[3] || m[4]); if (Number.isFinite(y)) ys.add(y); }
  const fut = [...ys].filter((y) => y >= minFy);
  return fut.length === 1 && ys.size <= 2 ? `FY${String(fut[0]).padStart(2, '0')}` : null;
}

/** Rows the rules can file, or null when the document must go to the AI. `filedAt` sets which years count as future. */
export function ruleRowsFor(doc: { market: string; text: string; filedAt?: string | null }): RowLike[] | null {
  if (doc.market !== 'IN') return null;
  const text = String(doc.text || '');
  if (CHANGE_WORDS.test(text)) return null;
  const filed = /^\d{4}-\d{2}/.test(String(doc.filedAt || '')) ? new Date(String(doc.filedAt)) : new Date();
  // Indian fiscal year: Apr–Mar. A filing in Oct 2026 is in FY27; FY27 and later count as future.
  const curFy = (filed.getUTCFullYear() % 100) + (filed.getUTCMonth() >= 3 ? 1 : 0);
  const rows: RowLike[] = []; const vals = new Map<string, string>();
  for (const s of sentences(text)) {
    if (QUESTION.test(s) || !GUIDE_WORDS.test(s) || PART_WORDS.test(s)) continue;
    const fy = fyOf(s, curFy);
    if (!fy) continue;
    for (const p of PATTERNS) {
      const m = p.re.exec(s);
      if (!m) continue;
      const nums = m.slice(1).map(toNum).filter((v): v is number => v != null && Number.isFinite(v));
      if (!nums.length) continue;
      const lo = nums[0], hi = nums.length >= 2 ? nums[1] : nums[0];
      if (hi < lo || (p.unit === '%' && (lo > 300 || hi > 300))) continue;
      const k = `${p.metric}|${fy}`, v = `${lo}|${hi}`;
      const had = vals.get(k);
      if (had && had !== v) return null;   // two different figures for one measure and year: the AI reads it
      if (had) continue;
      vals.set(k, v);
      rows.push({
        metric: p.metric, metric_label: p.label, period: fy, period_kind: 'ANNUAL', basis: 'UNSTATED',
        currency: p.unit === 'crore' ? 'INR' : null, unit: p.unit, low: lo, high: hi,
        growth_pct_low: p.metric === 'REVENUE_GROWTH' ? lo : null, growth_pct_high: p.metric === 'REVENUE_GROWTH' ? hi : null,
        status: 'NEW', prior_low: null, prior_high: null, prior_stated_in: null, prior_actual_period: null, prior_actual_value: null, prior_actual_quote: null,
        quote: s.slice(0, 300), speaker: null, confidence: 0.8,
      });
    }
  }
  return rows.length ? rows.slice(0, 12) : null;
}
