// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE FIGURES (pure) — the numbers behind "guidance raised".
//
// "Guidance raised" is a verdict; what a trader wants is its shape, the way the
// earnings feeds print it:
//
//     Raises FY26 Guide:
//       Revenue:  $5.63B–$5.71B  (Est. $5.54B)   from $5.40B–$5.48B
//       Adj. EPS: $9.83–$10.31   (Est. $9.25)    from $8.65–$9.05
//
// Every figure there except "(Est. …)" is in the press release. It is almost
// never a sentence, though — it is a small table that flattens to lines:
//
//     For the full year of Fiscal 2026:
//     Current Outlook          Prior Outlook
//     Net sales
//     $5.63 billion to $5.71 billion      $5.40 billion to $5.48 billion
//
// so this parser is LINE-oriented, not sentence-oriented, and carries three
// pieces of context down the page: which period the current section guides,
// what the columns mean (Current/Prior, or GAAP/Non-GAAP), and the units the
// table declared ("in millions").
//
// RULES, because a wrong guidance number is worse than none:
//   • figures are read only inside a guidance/outlook section that names a
//     period — never from the income statement, which uses the same row labels;
//   • the unit comes from the words beside the number or the table's own
//     caption, never from a guess;
//   • ranges must be ordered and plausible (EPS |x| < 1000, revenue ≥ $10k,
//     percentages |x| ≤ 200);
//   • two ranges on a row are only split into current/prior or GAAP/non-GAAP
//     when the section's header said so; otherwise only the first is kept.
// Anything that fails a rule is dropped silently.
// ═══════════════════════════════════════════════════════════════════════════

export type GuideMetric = 'revenue' | 'eps' | 'operating_income' | 'net_income' | 'comparable_sales' | 'gross_margin' | 'operating_margin' | 'free_cash_flow' | 'ebitda';
export type GuidePeriod = 'quarter' | 'year';

export interface GuidanceFigure {
  metric: GuideMetric;
  basis: 'gaap' | 'adjusted';
  period: GuidePeriod;
  period_label: string;              // "Q3 FY26", "FY26"
  low: number | null;
  high: number | null;
  unit: 'usd' | 'usd_share' | 'pct';
  prior_low: number | null;
  prior_high: number | null;
  raised: boolean | null;
  source: string;
}

const METRIC_RE: Array<[GuideMetric, RegExp]> = [
  // EBITDA first: "Adjusted EBITDA of $415 million to $430 million" is not
  // revenue guidance, and Petco's card said it was until this line existed.
  ['ebitda', /\bebitda\b/i],
  ['comparable_sales', /^(?:total\s+)?comp(?:arable)?(?:\s+store)?\s+sales|^same[- ]store\s+sales/i],
  ['gross_margin', /gross\s+margins?\b/i],
  ['operating_margin', /operating\s+margins?\b/i],
  ['free_cash_flow', /free\s+cash\s+flow/i],
  ['eps', /(?:earnings|income|loss|earnings\s*\(loss\))\s+per\s+(?:diluted\s+|common\s+)*share|per\s+share\b|\beps\b/i],
  ['operating_income', /operating\s+(?:income|loss|profit|earnings)|income\s*\(loss\)\s*from\s+operations|loss\s+from\s+operations|\bebit\b/i],
  ['net_income', /net\s+(?:income|earnings|loss)\b/i],
  ['revenue', /\b(?:net\s+)?(?:revenues?|sales)\b/i],
];
/** Row labels that are never guidance even inside a guidance table. */
const SKIP_ROW = /weighted\s+average|shares\s+outstanding|net\s+new\s+stores|store\s+count|tax\s+rate|capital\s+expenditure|interest\s+(?:income|expense)|depreciation|amortization|adjustments?\s+of|total\s+adjustments|stock-based|restructuring|acquisition-related|income\s+tax\s+effect|dividend/i;

const ADJ_LABEL = /\b(adjusted|non-?gaap|pro\s*forma)\b/i;
// A section only counts as guidance when its HEADING says so. "expects" inside
// a results bullet is not a guidance section — that looseness is what let an
// income-statement row be read as a forecast.
const SECTION_ON = /\b(outlook|guidance|expects?\s+the\s+following|is\s+issuing\s+the\s+following|provided\s+the\s+following\s+financial)\b/i;
/** A line that puts us back into REPORTED results, whatever came before. */
const RESULTS_LINE = /\b(year\s+to\s+date|compared\s+to\s+(?:the\s+)?(?:first|second|third|fourth)\s+quarter|(?:first|second|third|fourth)\s+quarter\s+(?:and\s+)?(?:fiscal\s+)?(?:year\s+)?(?:\d{4}\s+)?results\b|results\s+of\s+operations|highlights?\b)/i;
/** A forward verb, required when the numbers sit on the label line itself. */
const FORWARD_VERB = /\b(expects?|expected|anticipates?|guidance|outlook|forecasts?|projects?|sees?|to\s+be\s+in\s+the\s+range|in\s+the\s+range\s+of|now\s+(?:expects|sees))\b/i;
const SECTION_OFF = /\b(condensed\s+consolidated|consolidated\s+(?:statements?|balance)|balance\s+sheets?|statements?\s+of\s+operations|cash\s+flows?|non-?gaap\s+information|forward-?looking\s+statements|about\s+the\s+company|investor\s+(?:relations|contact)|conference\s+call|reconciliation\s+of\s+(?:gaap\s+)?net|use\s+of\s+non-?gaap)\b/i;

const QTR_HEAD = /\b(?:for\s+the\s+)?(first|second|third|fourth)\s+(?:fiscal\s+)?quarter\b(?:[^.\n]{0,40}?\b(?:fiscal(?:\s+year)?|fy)\s*(?:'(\d{2})|(\d{4})))?/i;
const YEAR_HEAD = /\b(?:for\s+the\s+)?(?:full[- ]year|full\s+fiscal\s+year|fiscal\s+year|fiscal)\b(?:\s+(?:year\s+)?'?(\d{4}))?/i;
/** "For 2026, the Company now expects…" — a calendar-year filer's full-year guide. */
const BARE_YEAR_HEAD = /^for\s+(?:the\s+)?(?:full\s+year\s+)?(20\d{2})\b(?!\s*(?:q[1-4]|first|second|third|fourth))/i;
const CAPTION_SCALE = /\(\s*(?:\$\s*)?in\s+(thousands|millions|billions)/i;
const COL_GAAP = /^\s*gaap\s*$/i;
const COL_NONGAAP = /^\s*non-?gaap\s*$/i;
const COL_CURRENT = /\b(current|updated|new)\s+(?:outlook|guidance)\b/i;
const COL_PRIOR = /\b(prior|previous)\s+(?:outlook|guidance)\b/i;
/** Dell's guidance table labels its columns just "Previous" and "Updated". */
const COL_PREV_BARE = /\bprevious\b/i;
const COL_UPD_BARE = /\b(updated|current)\b/i;

/** Only these phrasings mark the SECOND range on a line as prior guidance. */
const PRIOR_GUIDANCE = /\b(?:up\s+from|down\s+from|from\s+(?:the\s+)?(?:previous|prior)|(?:previous|prior)\s+(?:guidance|outlook|range|view)|compared\s+to\s+(?:the\s+)?(?:previous|prior)|versus\s+(?:the\s+)?(?:previous|prior)|raised\s+from|increased\s+from)\b/i;

const MULT: Record<string, number> = { thousand: 1e3, thousands: 1e3, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9 };

interface Tok { v: number; unit: 'usd' | 'usd_share' | 'pct'; at: number; end: number; scaled: boolean; }

function tokens(s: string, scale: number | null, perShare: boolean): Tok[] {
  const out: Tok[] = [];
  const re = /(\(\s*)?\$?\s*(\(\s*)?(-|−|–|—)?\s*(\d[\d,]*(?:\.\d+)?)\s*(\))?\s*(billion|million|thousand|%)?/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(s)) && guard++ < 60) {
    const raw = m[4].replace(/,/g, '');
    let v = parseFloat(raw);
    if (!Number.isFinite(v)) continue;
    const openParen = !!(m[1] || m[2]);
    // "24.3% - 25.3%" is a range, not a negative: a dash that FOLLOWS a number,
    // a percent sign or a closing bracket is a separator.
    let signIsMinus = !!m[3];
    if (signIsMinus) {
      const before = s.slice(0, m.index + m[0].indexOf(m[3]!)).replace(/[\s$]+$/, '');
      if (/[\d%)]$/.test(before)) signIsMinus = false;
    }
    const neg = signIsMinus || (openParen && !!m[5]);
    const word = (m[6] || '').toLowerCase();
    const dollar = /\$/.test(m[0]);
    let unit: Tok['unit'];
    let scaled = false;
    if (word === '%') unit = 'pct';
    else if (word) { unit = 'usd'; v *= MULT[word]; scaled = true; }
    else if (perShare && dollar) unit = 'usd_share';
    else if (dollar && scale) { unit = 'usd'; v *= scale; scaled = true; }
    else if (dollar) unit = 'usd_share';
    else continue;                                   // a bare number: a year, a store count
    const digitsAt = m.index + m[0].indexOf(m[4]);
    out.push({ v: neg ? -v : v, unit, at: digitsAt, end: m.index + m[0].length, scaled });
  }
  return out;
}

/** Ranges ("A to B"), plus-or-minus bands and single points, in document order. */
function ranges(s: string, toks: Tok[]): Array<{ lo: number; hi: number; unit: Tok['unit']; at: number; band?: boolean }> {
  const out: Array<{ lo: number; hi: number; unit: Tok['unit']; at: number; band?: boolean }> = [];
  let i = 0;
  while (i < toks.length) {
    const a = toks[i], b = toks[i + 1];
    // Ciena and Marvell guide as a MIDPOINT with a tolerance: "$1.75 billion
    // +/- $50 million", "$3.15 billion +/- 5%". That is a range, and reading
    // only the midpoint (or, worse, pairing the two numbers) loses the band.
    if (b && /^\s*(?:\+\/-|\+-|±|plus\s+or\s+minus)\s*\$?\s*$/i.test(s.slice(a.end, b.at))) {
      const delta = b.unit === 'pct' && a.unit !== 'pct' ? Math.abs(a.v) * (b.v / 100) : Math.abs(b.v);
      out.push({ lo: a.v - delta, hi: a.v + delta, unit: a.unit, at: a.at, band: true });
      i += 2;
      continue;
    }
    const byIncrease = /\bby\s*[$]?\s*$/i.test(s.slice(Math.max(0, a.at - 12), a.at));
    if (!byIncrease && b && a.unit === b.unit && /^\s*(?:to|-|–|—|and|through)\s*[$+]*\s*$/i.test(s.slice(a.end, b.at)) && b.v >= a.v) {
      out.push({ lo: a.v, hi: b.v, unit: a.unit, at: a.at });
      i += 2;
    } else {
      out.push({ lo: a.v, hi: a.v, unit: a.unit, at: a.at });
      i += 1;
    }
  }
  return out;
}

function sane(metric: GuideMetric, unit: Tok['unit'], lo: number, hi: number): boolean {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return false;
  if (metric === 'gross_margin' || metric === 'operating_margin' || metric === 'comparable_sales') {
    return unit === 'pct' && Math.abs(lo) <= 200 && Math.abs(hi) <= 200;
  }
  if (metric === 'eps') return unit === 'usd_share' && Math.abs(lo) < 1000 && Math.abs(hi) < 1000;
  if (metric === 'ebitda' && unit === 'usd_share') return false;
  if (unit === 'pct') return Math.abs(lo) <= 200 && Math.abs(hi) <= 200;   // "revenue growth of 6% to 8%"
  if (lo > 0 && hi / lo > 4) return false;                                  // a guidance band is never 8x wide
  return unit === 'usd' && Math.abs(hi) >= 1e4 && Math.abs(hi) <= 2e12;
}

function metricOf(label: string): GuideMetric | null {
  if (SKIP_ROW.test(label)) return null;
  for (const [m, re] of METRIC_RE) if (re.test(label)) return m;
  return null;
}

const qLabel = (n: number, fy?: string | null) => `Q${n}${fy ? ` FY${String(fy).slice(-2)}` : ''}`;

/**
 * Guidance figures from the plain text of an earnings release (the same text
 * the guidance classifier reads).
 */
export function guidanceFiguresFromText(text: string): GuidanceFigure[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out: GuidanceFigure[] = [];
  const seen = new Set<string>();

  let zone = false;              // inside a guidance/outlook section
  let period: { kind: GuidePeriod; label: string } | null = null;
  let scale: number | null = null;
  let cols: 'gaap' | 'currprior' | 'prevfirst' | null = null;
  let sinceHeading = 0;          // lines since the guidance heading
  let sincePeriod = 0;           // lines since the period was set

  const setPeriodFromHeading = (l: string): boolean => {
    // A heading may name both ("Third Quarter and Fiscal 2026 Outlook") — that
    // one only opens the zone; the sub-headings that follow set the period.
    const q = QTR_HEAD.exec(l);
    // "full year fiscal 2027" — take the fiscal year wherever it sits in the
    // heading, then fall back to an unnumbered "full year".
    const fyNum = /\b(?:fiscal(?:\s+year)?|fy)\s*'?(\d{4})\b/i.exec(l);
    const y = fyNum || YEAR_HEAD.exec(l);
    const bare = BARE_YEAR_HEAD.exec(l);
    if (bare && !q) { period = { kind: 'year', label: `FY${bare[1].slice(2)}` }; return true; }
    const both = !!q && !!y;
    if (both && /and/i.test(l.slice(Math.min(q!.index, y!.index), Math.max(q!.index, y!.index) + 12))) return false;
    if (q) {
      const n = { first: 1, second: 2, third: 3, fourth: 4 }[q[1].toLowerCase() as 'first'];
      // The fiscal year can sit either side of the quarter word ("Fiscal 2026
      // Fourth Quarter Outlook", "Fourth Quarter Fiscal 2026").
      let fy = q[3] || q[2] || (y ? (y[1] || null) : null);
      const prevLabel = period?.label || '';
      if (!fy && period?.kind === 'quarter' && prevLabel.startsWith(`Q${n} FY`)) {
        fy = `20${prevLabel.slice(-2)}`;
      }
      period = { kind: 'quarter', label: qLabel(n, fy) };
      return true;
    }
    if (y) {
      period = { kind: 'year', label: y[1] ? `FY${String(y[1]).slice(-2)}` : 'full year' };
      return true;
    }
    return false;
  };

  // A guidance paragraph often carries two metrics in two sentences ("…expects
  // net revenue in the range of $2.29 to $2.32 billion. Diluted earnings per
  // share are expected to be $2.35 to $2.40"). Treat each sentence as its own
  // row, or the first metric found swallows the other's numbers.
  const expanded: Array<{ text: string; ord: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 120 && /\d/.test(l)) {
      const parts = l.split(/(?<=[.;])\s+(?=[A-Z“"(])/).map((x) => x.trim()).filter(Boolean);
      for (const part of parts) expanded.push({ text: part, ord: i });
    } else {
      expanded.push({ text: l, ord: i });
    }
  }

  for (let i = 0; i < expanded.length; i++) {
    const l = expanded[i].text;
    if ((SECTION_OFF.test(l) || RESULTS_LINE.test(l)) && !SECTION_ON.test(l)) {
      zone = false; period = null; cols = null; scale = null; continue;
    }
    // "Current Outlook" / "Prior Outlook" are COLUMN headers, not section
    // headings — treating them as headings wiped the period mid-table.
    const isColHeader = COL_CURRENT.test(l) || COL_PRIOR.test(l)
      || (l.length < 30 && (COL_PREV_BARE.test(l) || COL_UPD_BARE.test(l)));
    if (SECTION_ON.test(l) && l.length < 200 && !isColHeader) {
      zone = true; sinceHeading = 0;
      // A new, short guidance heading that names no period must NOT inherit the
      // last one — that is how Ollie's full-year outlook table came out
      // labelled "Q2", from the quarter named in the results headline above it.
      if (setPeriodFromHeading(l)) sincePeriod = 0;
      else if (l.length < 60) { period = null; cols = null; }
    } else if (zone) {
      sinceHeading++;
      if (sinceHeading > 60) { zone = false; period = null; cols = null; continue; }
      // A sub-heading inside the zone ("For the full year of Fiscal 2026:")
      // "…is updating its financial outlook figures for the fiscal year 2026"
      // sets the period as surely as a heading does.
      const setter = /^for\s+(?:the\s+)?(?:fiscal|full|first|second|third|fourth|q[1-4]|\d{4})/i.test(l)
        || /\bfor\s+(?:the\s+)?(?:fiscal\s+year|full\s+year|full\s+fiscal\s+year|fiscal)\s*'?\d{4}\b/i.test(l)
        || /\bfor\s+the\s+(?:first|second|third|fourth)\s+(?:fiscal\s+)?quarter\b/i.test(l);
      if (setter && l.length < 400 && setPeriodFromHeading(l)) sincePeriod = 0;
      else sincePeriod++;
      // A period's table does not run for pages; past ~35 rows we are elsewhere.
      if (sincePeriod > 35) { period = null; }
    }
    if (!zone) continue;

    const cap = CAPTION_SCALE.exec(l);
    if (cap) scale = MULT[cap[1].toLowerCase()];
    if (COL_GAAP.test(l) && COL_NONGAAP.test(expanded[i + 1]?.text || '')) cols = 'gaap';
    else if (/\bgaap\b/i.test(l) && /\bnon-?gaap\b/i.test(l) && l.length < 40) cols = 'gaap';
    else if (COL_CURRENT.test(l) && (COL_PRIOR.test(l) || COL_PRIOR.test(expanded[i + 1]?.text || ''))) cols = 'currprior';
    else if (COL_CURRENT.test(l) && l.length < 40) cols = null;   // current only
    else if (l.length < 90 && COL_PREV_BARE.test(l) && COL_UPD_BARE.test(l)) {
      cols = COL_PREV_BARE.exec(l)!.index < COL_UPD_BARE.exec(l)!.index ? 'prevfirst' : 'currprior';
    } else if (l.length < 60 && COL_PREV_BARE.test(l) && COL_UPD_BARE.test(expanded[i + 1]?.text || '') && (expanded[i + 1]?.text.length ?? 99) < 60) {
      cols = 'prevfirst';
    } else if (l.length < 60 && COL_UPD_BARE.test(l) && COL_PREV_BARE.test(expanded[i + 1]?.text || '') && (expanded[i + 1]?.text.length ?? 99) < 60) {
      cols = 'currprior';
    }

    if (!period) continue;
    const metric = metricOf(l);
    if (!metric) continue;

    // The values are on this line, or on the next few (a table row flattens to
    // "label" then one line per cell).
    const perShare = /per\s+(?:diluted\s+|common\s+)*share|\beps\b/i.test(l);
    const own = tokens(l, scale, perShare);
    // Numbers on the label line itself are only guidance when the line says so
    // ("Revenue is expected to be in the range of $105 million to $115 million"),
    // or when the line is a bullet under a lead-in that did ("…the company
    // expects:" followed by "Revenue of $935 million to $939 million").
    const leadIn = [expanded[i - 1]?.text, expanded[i - 2]?.text]
      .some((prev) => !!prev && /\b(expects?|anticipates?|guidance|outlook|projects?|sees?)\b[^.]{0,40}:?\s*$/i.test(prev));
    if (own.length && !FORWARD_VERB.test(l) && !leadIn) continue;
    let valueText = l;
    let toks = own;
    if (!own.length) {
      const parts: string[] = [];
      for (let k = 1; k <= 3 && i + k < expanded.length; k++) {
        const nx = expanded[i + k].text;
        if (metricOf(nx) && !tokens(nx, scale, perShare).length) break;   // next label row
        parts.push(nx);
        const t = tokens(parts.join(' '), scale, perShare);
        if (t.length >= (cols ? 4 : 2)) break;
      }
      valueText = parts.join(' ');
      toks = tokens(valueText, scale, perShare);
    }
    if (!toks.length) continue;

    const growthWords = /\b(growth|increase|decline|decrease|change|up|down)\b/i.test(l);
    const rs = ranges(valueText, toks)
      .filter((r) => sane(metric, r.unit, r.lo, r.hi))
      // "$" metrics quoted as a percentage are growth rates; accept them only
      // when the row actually says so, otherwise a stray margin figure lands in
      // the revenue row.
      .filter((r) => !(r.unit === 'pct'
        && (metric === 'revenue' || metric === 'eps' || metric === 'net_income' || metric === 'operating_income' || metric === 'free_cash_flow')
        && !growthWords));
    if (!rs.length) continue;

    const emit = (r: typeof rs[number], basis: 'gaap' | 'adjusted', prior?: typeof rs[number]) => {
      const key = `${metric}|${period!.label}|${basis}`;
      if (seen.has(key)) {
        // Keep the better statement: a range beats a bare point (an early
        // mention in the CEO quote should not block the guidance table).
        const idx = out.findIndex((x) => `${x.metric}|${x.period_label}|${x.basis}` === key);
        if (idx < 0) return;
        const cur = out[idx];
        const curIsPoint = cur.low === cur.high;
        const newIsRange = r.lo !== r.hi;
        const gainsPrior = prior && cur.prior_low == null;
        if (!((curIsPoint && newIsRange) || gainsPrior)) return;
        out.splice(idx, 1);
      }
      seen.add(key);
      out.push({
        metric, basis, period: period!.kind, period_label: period!.label,
        low: r.lo, high: r.hi, unit: r.unit,
        prior_low: prior ? prior.lo : null, prior_high: prior ? prior.hi : null,
        raised: prior ? (r.lo > prior.lo || r.hi > prior.hi) : null,
        source: `${l}${valueText === l ? '' : ' ' + valueText}`.slice(0, 240),
      });
    };

    const labelAdj = ADJ_LABEL.test(l);
    if (rs.length >= 2 && cols === 'gaap' && rs[0].unit === rs[1].unit) {
      emit(rs[0], 'gaap');
      emit(rs[1], 'adjusted');
    } else if (rs.length >= 2 && cols === 'prevfirst' && rs[0].unit === rs[1].unit) {
      emit(rs[1], labelAdj ? 'adjusted' : 'gaap', rs[0]);
    } else if (rs.length >= 2 && cols === 'currprior' && rs[0].unit === rs[1].unit) {
      emit(rs[0], labelAdj ? 'adjusted' : 'gaap', rs[1]);
    } else if (rs.length >= 2 && rs[0].unit === rs[1].unit && PRIOR_GUIDANCE.test(l)) {
      // "…up from the previous range of $8.65 to $9.05" — a prior GUIDANCE, not
      // last year's actual, which the same sentence shape also produces.
      emit(rs[0], labelAdj ? 'adjusted' : 'gaap', rs[1]);
    } else {
      emit(rs[0], labelAdj ? 'adjusted' : 'gaap');
    }
  }

  // A guidance figure is usually a RANGE, and a lone number in a release is
  // often a reported figure that shares a row label. But plenty of companies do
  // guide to a point — Dell to "$192 billion", Broadcom to "approximately $34.8
  // billion", Snowflake to a single product-revenue figure — and dropping those
  // left their cards looking as if the engine had missed the guidance. So a
  // point is kept when it is unambiguous: it carries a prior, or its own line
  // states the forecast in words ("expects…", "outlook", "approximately"),
  // which is what separates a guided number from a reported one.
  const POINT_OK = /\b(expects?|expected|anticipates?|guidance|outlook|forecasts?|projects?|now\s+(?:expects|sees))\b/i;
  // …and never when the same line reads as a REPORTED figure. "GAAP diluted net
  // EPS of $1.06" and "included a $0.86 per-share tariff benefit" both sit near
  // an outlook heading in their releases; the tense is what separates them.
  const POINT_PAST = /\b(was|were|increased|decreased|declined|rose|fell|reported|delivered|included|compared\s+to|versus|in\s+the\s+(?:first|second|third|fourth)\s+quarter|year\s+to\s+date|per-share\s+benefit)\b/i;
  const ranged = out.filter((f) => {
    if (f.low !== f.high || f.prior_low != null) return true;
    // A point under a quarter label with no fiscal year is the shakiest thing
    // this parser can produce — HPE's reported "$1.06" sat under one. Ranges
    // from such a section are fine; single numbers are not.
    if (f.period === 'quarter' && !/FY\d{2}$/.test(f.period_label)) return false;
    return POINT_OK.test(f.source) && !POINT_PAST.test(f.source);
  });
  out.length = 0;
  out.push(...ranged);

  // "full year" and "FY26" are the same period stated two ways; when a document
  // uses both, keep one label so the card does not print the guide twice.
  const fyLabels = Array.from(new Set(out.filter((f) => /^FY\d{2}$/.test(f.period_label)).map((f) => f.period_label)));
  if (fyLabels.length === 1) {
    for (const f of out) if (f.period_label === 'full year') f.period_label = fyLabels[0];
    const kept = new Map<string, GuidanceFigure>();
    for (const f of out) {
      const k = `${f.metric}|${f.period_label}|${f.basis}`;
      const prev = kept.get(k);
      if (!prev || (prev.low === prev.high && f.low !== f.high) || (prev.prior_low == null && f.prior_low != null)) kept.set(k, f);
    }
    out.length = 0; out.push(...Array.from(kept.values()));
  }

  const mOrder: GuideMetric[] = ['revenue', 'eps', 'ebitda', 'operating_income', 'operating_margin', 'net_income', 'comparable_sales', 'gross_margin', 'free_cash_flow'];
  out.sort((a, b) =>
    (a.period === b.period ? 0 : a.period === 'year' ? -1 : 1) ||
    (mOrder.indexOf(a.metric) - mOrder.indexOf(b.metric)) ||
    (a.basis === b.basis ? 0 : a.basis === 'adjusted' ? -1 : 1));
  return out.slice(0, 12);
}

/** "$5.63B–$5.71B", "$9.83–$10.31", "+10% to +12%" */
export function fmtGuideRange(g: { low: number | null; high: number | null; unit: GuidanceFigure['unit'] }): string {
  if (g.low == null || g.high == null) return '—';
  // A narrow band must not collapse to the same string on both sides.
  const narrow = g.low !== g.high && Math.abs(g.high - g.low) / Math.max(1e-9, Math.abs(g.high)) < 0.01;
  const one = (v: number): string => {
    if (g.unit === 'pct') return `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%`;
    if (g.unit === 'usd_share') return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
    const a = Math.abs(v);
    const body = a >= 1e12 ? `$${(a / 1e12).toFixed(narrow ? 3 : 2)}T`
      : a >= 1e9 ? `$${(a / 1e9).toFixed(narrow ? 3 : 2)}B`
      : a >= 1e6 ? `$${(a / 1e6).toFixed(narrow ? 1 : a >= 1e8 ? 0 : 1)}M`
      : `$${Math.round(a).toLocaleString()}`;
    return v < 0 ? `-${body}` : body;
  };
  return g.low === g.high ? one(g.low) : `${one(g.low)}–${one(g.high)}`;
}

export const GUIDE_METRIC_LABEL: Record<GuideMetric, string> = {
  revenue: 'Revenue', eps: 'EPS', operating_income: 'Operating income',
  operating_margin: 'Operating margin', net_income: 'Net income',
  comparable_sales: 'Comparable sales', gross_margin: 'Gross margin',
  free_cash_flow: 'Free cash flow', ebitda: 'EBITDA',
};
