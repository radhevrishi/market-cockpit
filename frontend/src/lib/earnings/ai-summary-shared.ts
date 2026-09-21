// ═══════════════════════════════════════════════════════════════════════════
// ONE SCHEMA, ONE VERIFIER, TWO MARKETS.                            (zzz700)
//
// The US AI summary and the new India one ask a model the same question about
// the same kind of document, and they must not answer it in two shapes. This
// file is the single source of truth for the tool schema, the system prompt
// and the figure verification — extracted verbatim from the US route rather
// than reimplemented, so no behaviour changed on the day it moved.
//
// THE CODEBASE HAS ALREADY PAID FOR THIS LESSON ONCE. `earnings-grade-shared`
// opens with a note that the per-quarter grader existed in two copies which
// "repeatedly DRIFTED", and each drift was a real over-grading bug. A prompt
// and a verifier drift the same way and more quietly: the India card would
// slowly start answering a different question from the US card, and nothing
// would fail — the summaries would just stop meaning the same thing.
//
// What stays market-specific lives in the route: where the document comes
// from (EDGAR exhibits vs an exchange PDF), what counts as a real earnings
// document, and the currency the reader expects.
// ═══════════════════════════════════════════════════════════════════════════

/** The typed answer. The API validates this before the response reaches us. */
export const SUMMARY_TOOL = {
  name: 'file_earnings_summary',
  description: 'Record the structured reading of this earnings release.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict_line: {
        type: 'string',
        description: 'ONE sentence, max 22 words: what this quarter establishes. No recommendation, no price view.',
      },
      guidance: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['raised', 'maintained', 'lowered', 'initiated', 'withdrawn', 'none'],
            description: '"none" means the release gives no forward guidance at all. Do not guess — only what the release states.',
          },
          detail: { type: 'string', description: 'The guided figures exactly as printed, with the period. Empty string if action is "none".' },
          period: { type: 'string', description: 'The period guided, e.g. "FY26" or "Q3 FY26". Empty if none.' },
        },
        required: ['action', 'detail', 'period'],
      },
      segments: {
        type: 'array',
        description: 'Per-segment or per-product-line movement, where the release breaks it out. Empty array if it does not.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            detail: { type: 'string', description: 'The movement with its figure as printed.' },
            direction: { type: 'string', enum: ['up', 'down', 'flat'] },
          },
          required: ['name', 'detail', 'direction'],
        },
      },
      mix_shift: { type: 'string', description: 'Any stated change in product/customer/geographic mix, and what it did to margin. Empty string if the release says nothing about mix.' },
      capital: {
        type: 'object',
        description: 'What the company is doing with its cash, as stated. Empty strings where the release is silent.',
        properties: {
          capex: { type: 'string' },
          buyback: { type: 'string' },
          dividend: { type: 'string' },
          debt: { type: 'string' },
        },
        required: ['capex', 'buyback', 'dividend', 'debt'],
      },
      management: { type: 'string', description: 'Any CEO/CFO/board appointment, departure or succession announced in this release. Empty string if none.' },
      new_business: {
        type: 'array',
        description: 'New products, customers, contracts, awards, facilities or capacity announced in the release. Empty array if none.',
        items: { type: 'string' },
      },
      positives: {
        type: 'array',
        description: '2 to 5 items. Each with a short label and the specific fact with its figure.',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, detail: { type: 'string' } },
          required: ['label', 'detail'],
        },
      },
      negatives: {
        type: 'array',
        description: '0 to 5 items. Declines, margin pressure, cash outflows, elevated spend, stated risks, weak guided lines. Empty array ONLY if the release genuinely contains none.',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, detail: { type: 'string' } },
          required: ['label', 'detail'],
        },
      },
      watch_next: {
        type: 'array',
        description: '1 to 4 items: what the release itself says will decide the next few quarters.',
        items: { type: 'string' },
      },
      not_disclosed: {
        type: 'array',
        description: 'Things a reader would expect and this release does NOT give — no segment breakout, no cash-flow statement, no guidance, no backlog figure, no margin detail. 0 to 4 items. Absence is evidence; say only what is genuinely missing from THIS text.',
        items: { type: 'string' },
      },

      // ═══════════════════════════════════════════════════════════════════
      // v6 — THE CATALYSTS, AND WHY THE MARGIN MOVED.            (zzz699)
      //
      // v5 answered "what does this release say". It could not answer the
      // question an owner actually asks next: WHY did the margin move, is it
      // repeatable, what capacity is being built and when does it earn, how
      // full are the plants, and how big is the order book. Those are the
      // fields below, and they are taken from the owner's own catalyst
      // taxonomy rather than invented here.
      //
      // THE STRUCTURAL / CYCLICAL SPLIT IS THE WHOLE POINT of margin_bridge.
      // A margin built on mix, pricing, operating leverage or automation
      // repeats. One built on a raw-material tailwind, freight normalisation
      // or forex does not, and reads identically on the face of the P&L.
      // ═══════════════════════════════════════════════════════════════════
      catalysts: {
        type: 'array',
        description: 'Every distinct forward-looking catalyst the release names — an order, a customer win, a qualification, a capacity addition, a product launch, an approval, a pricing action, an entry into a new geography. Empty array if the release names none. Do not list ordinary results commentary here.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: "The catalyst in one clause, using the company's own proper nouns." },
            category: {
              type: 'string',
              enum: ['capacity', 'order_or_contract', 'new_customer', 'product', 'pricing_or_margin', 'industry_structural', 'market_share', 'international', 'balance_sheet', 'turnaround', 'management', 'm_and_a', 'technology', 'other'],
            },
            status: {
              type: 'string',
              enum: ['announced', 'under_construction', 'commissioned', 'commercial_production', 'ramping', 'at_full_run_rate', 'delayed', 'not_stated'],
            },
            size_vs_company: { type: 'string', description: 'How big it is relative to the company — order value against annual revenue, new capacity against existing. "not quantified" if the release gives no denominator.' },
            expected_impact_period: { type: 'string', description: 'The period from which it should show in the numbers, in the company\'s words ("FY28", "H2 FY27"). "not stated" if absent.' },
            evidence_quote: { type: 'string', description: 'The sentence from the release that evidences it. Quote, do not paraphrase.' },
          },
          required: ['title', 'category', 'status', 'size_vs_company', 'expected_impact_period', 'evidence_quote'],
        },
      },
      margin_bridge: {
        type: 'object',
        description: 'Why the operating margin moved. Fill only from what the release states; leave drivers empty rather than guessing.',
        properties: {
          opm_change_pp: { type: 'string', description: 'The operating-margin change in percentage points as the release states or as its own figures show, e.g. "+8.8pp". Empty string if not determinable.' },
          drivers: {
            type: 'array',
            description: 'Each stated cause of the margin move. Empty array if the release does not explain it.',
            items: {
              type: 'object',
              properties: {
                driver: {
                  type: 'string',
                  enum: ['mix_shift', 'pricing_power', 'operating_leverage', 'automation', 'yield_improvement', 'in_housing', 'procurement_savings', 'raw_material_tailwind', 'freight_normalisation', 'forex', 'energy_cost', 'one_time_gain', 'volume_only', 'utilisation_increase', 'cost_reduction', 'other'],
                },
                nature: {
                  type: 'string',
                  enum: ['structural', 'cyclical', 'one_off'],
                  description: 'Mix, pricing, operating leverage, automation, yield and in-housing are structural. Raw material, freight, forex and energy are cyclical. A gain that will not recur is one_off.',
                },
                detail: { type: 'string', description: 'The driver with its figure as the release prints it.' },
              },
              required: ['driver', 'nature', 'detail'],
            },
          },
          verdict: {
            type: 'string',
            enum: ['predominantly_structural', 'predominantly_cyclical', 'mixed', 'not_explained'],
          },
          where_in_pnl: {
            type: 'string',
            enum: ['gross_profit', 'ebitda', 'operating_income', 'other_income', 'finance_cost', 'tax', 'exceptional', 'no_divergence', 'not_determinable'],
            description: 'Walk revenue → gross profit → EBITDA → operating income → pre-tax → net. Name the FIRST line where growth diverges sharply from revenue growth.',
          },
        },
        required: ['opm_change_pp', 'drivers', 'verdict', 'where_in_pnl'],
      },
      utilisation: {
        type: 'object',
        description: 'Capacity utilisation. Capacity is potential; utilisation is monetisation. Empty strings where the release is silent — most releases are.',
        properties: {
          current: { type: 'string', description: 'Utilisation this period as disclosed, e.g. "86%".' },
          prior: { type: 'string', description: 'Prior-period or prior-year utilisation, for the before-and-after.' },
          expected: { type: 'string', description: 'The level management guides to.' },
          expected_by: { type: 'string', description: "The period by which that level is expected, in the company's words." },
          basis: { type: 'string', description: 'Which plant, line or segment the figure refers to — a consolidated number hides an idle new plant.' },
        },
        required: ['current', 'prior', 'expected', 'expected_by', 'basis'],
      },
      capex_projects: {
        type: 'array',
        description: 'Each named capital project: what is being built, how big, when it completes and when it earns. Empty array if the release names none.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['greenfield', 'brownfield', 'debottlenecking', 'maintenance', 'r_and_d', 'asset_purchase', 'not_stated'] },
            amount: { type: 'string', description: 'Announced or spent amount as the release prints it. Empty if not given.' },
            capacity_added: { type: 'string', description: 'The capacity it adds, in the release\'s own units.' },
            status: { type: 'string', enum: ['announced', 'under_construction', 'commissioned', 'commercial_production', 'ramping', 'delayed', 'not_stated'] },
            completion_period: { type: 'string', description: 'When it completes, in the company\'s words. "not stated" if absent.' },
            revenue_from: { type: 'string', description: 'The period from which it is expected to contribute revenue. "not stated" if absent.' },
          },
          required: ['name', 'type', 'amount', 'capacity_added', 'status', 'completion_period', 'revenue_from'],
        },
      },
      order_book: {
        type: 'object',
        description: 'Backlog and order intake. Backlog is a promise, not revenue. Empty strings where not disclosed.',
        properties: {
          closing_value: { type: 'string', description: 'Order book or backlog at period end, as printed.' },
          growth: { type: 'string', description: 'Its growth, as the release states it.' },
          order_inflow: { type: 'string', description: 'Orders won during the period.' },
          book_to_bill: { type: 'string', description: 'Book-to-bill if stated. Above 1 means demand exceeds delivery.' },
          execution_period: { type: 'string', description: 'Over what period the book converts to revenue, in management\'s words.' },
          concentration: { type: 'string', description: 'Any statement about a single large order or customer as a share of the book.' },
        },
        required: ['closing_value', 'growth', 'order_inflow', 'book_to_bill', 'execution_period', 'concentration'],
      },
      one_offs: {
        type: 'array',
        description: 'Items the release itself identifies as non-recurring, exceptional, one-time, or a settlement/insurance/tax/forex gain or charge. Empty array if none. These are what make a quarter unrepeatable.',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string' },
            amount: { type: 'string', description: 'As printed. Empty string if the release names the item but not the amount.' },
            direction: { type: 'string', enum: ['gain', 'charge'] },
            recurring: { type: 'string', enum: ['will_not_recur', 'may_recur', 'not_stated'] },
          },
          required: ['item', 'amount', 'direction', 'recurring'],
        },
      },
      operating_leverage_evidence: {
        type: 'string',
        description: 'Any statement that fixed costs were spread over higher volume, or that operating leverage drove the result. Quote it. Empty string if the release makes no such claim.',
      },
    },
    required: ['verdict_line', 'guidance', 'segments', 'mix_shift', 'capital', 'management', 'new_business', 'positives', 'negatives', 'watch_next', 'not_disclosed',
      'catalysts', 'margin_bridge', 'utilisation', 'capex_projects', 'order_book', 'one_offs', 'operating_leverage_evidence'],
  },
};


export const SYSTEM_BASE = `You summarise a single quarterly earnings press release for a professional investor who has already seen the headline numbers.

You MUST answer by calling the file_earnings_summary tool. Do not write prose outside it.

WHAT THE READER ALREADY HAS, so do not repeat it: revenue, EPS, operating margin, cash flow and the year-over-year percentages are already on screen. Your value is everything AROUND those numbers — guidance, mix, segments, capital allocation, people, new business, and what the release quietly does not say.

ABSOLUTE RULES
- Use ONLY the release text provided. You have no other knowledge of this company. Never add context, history, competitor comparison, valuation or market reaction.
- Every number you write must appear in the release text. Copy it as the release prints it, with the same unit — if a table is headed "in thousands" and shows 5,232, write $5.2 million or 5,232 thousand, never a figure of your own construction. Do not compute, derive, annualise or infer any number. If a figure is not in the text, write the point without a figure.
- Never describe anything as a beat or a miss unless the release itself says so: you have not been given consensus estimates.
- Guidance is what management SAYS WILL happen. Never present it as achieved.
- If the release genuinely contains no negatives, say so in one line rather than inventing one.

FIELD DISCIPLINE
- Every field is filled from the release or left empty. An empty string and an empty array are correct answers and are preferred over a guess.
- Keep each detail to one sentence. The reader is scanning, not reading.
- "not_disclosed" is for things genuinely absent from THIS release that a reader would reasonably expect. Do not list something the release does give.
- Do not editorialise. No recommendation, no valuation, no price view, no comparison to other companies.

THE CATALYST AND MARGIN FIELDS (v6)
- "catalysts" is for FORWARD-LOOKING events the release names — an order, a customer win, a qualification, a capacity addition, a product launch, an approval, a pricing action, a new geography. It is NOT for results commentary. If the release names none, return an empty array; a quarter with no catalyst is a common and honest answer.
- "margin_bridge" asks WHY the margin moved, and the structural/cyclical split is the most important judgement in this whole schema. Mix shift, pricing power, operating leverage, automation, yield and in-housing REPEAT and are structural. Raw-material tailwinds, freight normalisation, forex and energy costs DO NOT repeat and are cyclical. A gain the release calls non-recurring is one_off. If the release states no cause, return an empty drivers array and verdict "not_explained" — do not infer a cause from the direction of the number.
- "where_in_pnl" means: walk revenue → gross profit → EBITDA → operating income → pre-tax → net income, and name the FIRST line where growth diverges sharply from revenue growth. If profit grew far faster than revenue and the operating line does not explain it, the divergence is below operating income and you must say which line.
- "utilisation" and "capex_projects" are usually absent from a US earnings release. Empty is the correct and expected answer. Never estimate a utilisation percentage, a project cost or a completion date.
- "one_offs" is only for items the release ITSELF identifies as non-recurring, exceptional, one-time, or a settlement, insurance, tax or forex gain or charge. Do not classify an ordinary operating item as a one-off.
- Every figure in these fields obeys the same rule as everywhere else: it must appear in the release text.`;


// ── THE NUMBERS CHECK ──────────────────────────────────────────────────────
//
// Every figure in the summary must be one the release contains. The first
// version of this compared the digits literally and threw away good summaries
// for a reason that was not fabrication at all: a release states "5,232" in a
// table headed "in thousands", and a summary that says "$5.23 million" is
// RIGHT — it is the same number, correctly converted. Comparing "5.23" against
// "5232" found no match and discarded the lot.
//
// So the comparison is on SIGNIFICANT DIGITS, ignoring the decimal point,
// thousands separators and trailing zeros: 5.23 → "523", which is the leading
// run of 5,232 → "5232". That accepts every honest restatement of a printed
// figure (thousands to millions, $1.5 billion as $1.50B) and still rejects a
// number the release never printed, which is the only thing this guard is for.

/** Significant digits of a number, with separators, the decimal point and
 *  trailing zeros removed. "881.40" → "8814"; "1,500" → "15". */
function sigDigits(n: string): string {
  const d = n.replace(/[^\d]/g, '').replace(/^0+/, '');
  return d.replace(/0+$/, '') || (d ? '0' : '');
}

/** Every dollar figure the model wrote, so an invented one can be caught. */
export function moneyTokens(text: string): string[] {
  return (text.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) || [])
    .map((t) => t.replace(/[^\d.,]/g, ''));
}

/** The significant digits of every number the release prints. */
export function numeralsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(/\d[\d,]*(?:\.\d+)?/g) || []) {
    const d = sigDigits(m);
    if (d) out.add(d);
  }
  return out;
}

/** Is this figure supported by something the release printed? True when its
 *  significant digits match, or begin, the digits of a printed number — which
 *  is what a unit conversion or a rounding to two decimals looks like. */
export function supported(fig: string, release: Set<string>): boolean {
  const d = sigDigits(fig);
  if (!d) return true;                       // nothing numeric to check
  if (d.length <= 1) return true;            // "$5" — too coarse to be evidence either way
  if (release.has(d)) return true;
  for (const r of release) {
    if (r.length >= d.length && r.startsWith(d)) return true;   // 523 ⊂ 5232
    if (d.length > r.length && d.startsWith(r) && d.length - r.length <= 2) return true;
  }
  return false;
}

// ── THE PERCENTAGES, CHECKED THE SAME WAY ──────────────────────────────────
//
// The guard above reads dollar figures only, and a summary is mostly
// percentages: "up 27% year-over-year", "gross margin of 75.0%", "expanding
// 2.6 percentage points". A wrong percentage is as actionable as a wrong
// dollar and was going out unchecked.
//
// A percentage cannot use the digit-prefix rule, because rounding UP breaks it
// — a release printing 105.9% and a summary writing 106% share no prefix. So a
// percentage is supported when some number the release prints ROUNDS to it at
// the precision the summary wrote it: 105.9 → "106" ✓, and a figure the
// release never printed matches nothing. Exact, and it cannot be satisfied by
// accident the way a tolerance band could.

/** Every percentage the model wrote, as {value, decimals}. */
export function pctTokens(text: string): Array<{ v: number; dp: number }> {
  const out: Array<{ v: number; dp: number }> = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent\b|percentage points?\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1].replace(/,/g, '');
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    out.push({ v, dp: (raw.split('.')[1] || '').length });
  }
  return out;
}

/** Every number the release prints, as a value. */
export function valuesIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.match(/\d[\d,]*(?:\.\d+)?/g) || []) {
    const v = Number(m.replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

export function supportedPct(p: { v: number; dp: number }, values: number[]): boolean {
  // A whole-number percentage under 10 is too coarse to be evidence either
  // way — "up 5%" will always find a 5 somewhere — and refusing those would
  // cost more good lines than it catches bad ones.
  if (p.dp === 0 && p.v < 10) return true;
  const f = Math.pow(10, p.dp);
  for (const r of values) {
    if (Math.round(r * f) / f === p.v) return true;
  }
  return false;
}

/**
 * Does this text read like an earnings press release?  (zzz681)
 *
 * Generic by construction — it reads the words every filer uses, never a
 * company or a filename. Two families of evidence:
 *
 *  · a HARD REJECT for the documents that are reliably NOT releases and that
 *    the filename ranker is most likely to pick by accident: the Sarbanes-Oxley
 *    certifications that accompany every 10-Q and 10-K, which announce
 *    themselves in fixed statutory language;
 *  · a POSITIVE test needing at least two independent release markers, so a
 *    document that merely mentions revenue in passing does not qualify.
 *
 * Deliberately permissive on the positive side. A false negative costs a
 * summary the owner could have had; a false positive costs a summary OF THE
 * WRONG DOCUMENT, which is worse, and the reject list is where that is caught.
 */
