# Payload contract — US Earnings Opportunities expand panel

Every field below is attached by `src/app/api/v1/earnings/graded-us/route.ts` to each
row in `by_tier[*]`. **All of them are optional and may be `null` or absent** for any
row: a PRELIM print has no cash-flow statement, a first-year filer has no 3-year
history, a company that gives no outlook has no guide. The UI must render whatever is
present and silently omit the rest — never a placeholder row of dashes, never an
invented number.

```ts
// ── 1. Long quarterly history (from src/lib/us-earnings-core.ts) ────────────
// Arrays are all the same length as `ends`, index-aligned, OLDEST → NEWEST,
// last element == the quarter being graded. Up to 16 quarters.
series?: {
  ends: string[];                       // period-end ISO dates
  revenue: (number | null)[];           // $M
  gross_profit: (number | null)[];      // $M
  operating_income: (number | null)[];  // $M
  net_income: (number | null)[];        // $M
  eps: (number | null)[];               // $/share, diluted GAAP
  cfo: (number | null)[];               // $M
  fcf: (number | null)[];               // $M  (cfo − capex)
} | null;

// NOTE ON `series.eps`: EDGAR restates EPS only for the periods a later filing
// re-presents, so quarters more than ~5 back can be PRE-split while recent ones
// are POST-split. Dollar lines (revenue, net income, fcf …) are immune.
//
// AS OF THE SPLIT-BASIS WORK, THE ARRAY IS NO LONGER A MIXTURE. Every element is
// either on the CURRENT quarter's share count or `null`:
//   • where the filing that established a quarter and the filing that
//     established the current one can be chained through a period they both
//     re-present, the ratio between those two share counts is the split factor
//     between them, and the old figure is restated by it (NVIDIA's April-2023
//     quarter now reads 0.08, not the pre-split 0.82 it used to sit at beside a
//     post-split 0.25);
//   • where a basis change is PROVEN to lie between the two filings but its
//     size cannot be attributed to that interval, the element is `null`;
//   • where there is no evidence either way the figure is left exactly as filed.
// A `null` in the middle of the array is therefore a refusal, not a gap in the
// filer's tagging, and must be rendered as a break in the line — never
// interpolated. Non-splitting filers are untouched: 320 of 320 control filers in
// the verification corpus came back byte-identical.
// => Compute any multi-year earnings growth from `net_income` all the same: it
//    needs no restatement and never goes blank.
//
// `quarters_eps` (the four-quarter strip) is built from the same restated
// values and truncates at the first refusal, so the trailing-twelve-month sum —
// and the P/E built on it — can no longer mix two share counts.

// ── 2. Balance-sheet / capital-return context ───────────────────────────────
context?: {
  cash_musd: number | null;
  cash_incl_st_inv: boolean;            // true => the figure includes short-term investments
  debt_musd: number | null;             // null when the filer tags no total debt line
  sbc_musd: number | null;              // stock-based comp, the `flows_as_of` quarter
  buyback_musd: number | null;          // common-stock repurchases, same quarter
  dividends_musd: number | null;        // dividends paid, same quarter
  diluted_shares_m: number | null;      // same quarter
  diluted_shares_yoy_pct: number | null;// negative = share count shrinking
  as_of: string | null;                 // balance-sheet date used
  total_assets_musd: number | null;
  current_liabilities_musd: number | null;

  // WHERE THE BALANCE SHEET CAME FROM. Absent or 'xbrl' = a filed 10-Q/10-K.
  // 'release' = the condensed consolidated balance sheet printed in the
  // earnings 8-K itself (src/lib/us-pr-balance.ts), which on a PRELIM row is
  // the only place the ANNOUNCED quarter's balance sheet exists yet — so
  // `as_of` is that quarter, not the one before it. Columns are bound by their
  // headers (two instants; one must name the announced period end) and every
  // line is published only when the release's own COMPARATIVE column — a date
  // already on EDGAR — reproduces the filer's XBRL there, which is what proves
  // both the scale and the composition. Nothing is published otherwise; the
  // fallback is unchanged, i.e. the PREVIOUS quarter's XBRL with its own
  // `as_of`. The row also carries `balance_source: 'release'` and the
  // methodology tag "balance sheet from the release".
  source?: 'xbrl' | 'release';

  // THE FLOW LINES MAY COVER A DIFFERENT PERIOD FROM THE BALANCE SHEET.
  // A release's cash-flow statement is year-to-date and usually cannot be
  // de-cumulated, so on a release-derived context the stock comp / buybacks /
  // dividends / diluted share count normally stay on the PREVIOUS quarter's
  // XBRL. `flows_as_of` is the period those four cover whenever it is not
  // `as_of`. The card says so in words; never present them as current when
  // this field disagrees with `as_of`.
  flows_as_of?: string | null;
} | null;

// ── 3. Actual vs the company's OWN guidance from last quarter ───────────────
// (from src/lib/us-prior-guidance.ts)
vs_guide?: {
  prior_filing_date: string | null;
  prior_filing_url: string | null;
  for_quarter: GuidedItem[];            // guides for the quarter just reported
  for_year: GuidedItem[];               // guides for the FY containing it
} | null;

interface GuidedItem {
  metric: string;                       // 'revenue' | 'eps' | 'operating_income' | …
  basis: 'gaap' | 'adjusted' | null;
  period: 'quarter' | 'year';
  guide_low: number | null;
  guide_high: number | null;
  guide_mid: number | null;
  unit: string;                         // 'usd' | 'pct' | …
  actual: number | null;
  guided_on: string;
  guided_for_label: string | null;
  source_url: string | null;
  compare: {                            // null when no actual could be paired
    verdict: 'beat' | 'missed' | 'in-line' | null;
    delta_pct: number | null;
    delta_abs: number | null;
    text: string | null;                // e.g. "beat the midpoint of its own guide by 3.3%"
  } | null;
}

// ── 4. How this quarter's guide moved vs last quarter's guide ───────────────
guide_change?: Array<{
  metric: string;
  basis: 'gaap' | 'adjusted' | null;
  period_label: string | null;          // "FY27"
  prev_low: number | null; prev_high: number | null;
  new_low: number | null;  new_high: number | null;
  direction: 'raised' | 'lowered' | 'reiterated' | 'narrowed' | 'widened';
  delta_pct: number | null;             // change in the midpoint, %
  unit: string;
}> | null;

// ── 4b. WHY there is no outlook, when there is none ─────────────────────────
// Set only when the guidance block is empty — never alongside `guidance` or a
// non-empty `guidance_figures`. Three different facts that used to look
// identical to the reader (see src/lib/us-guidance.ts):
//   'unreadable-format'   the company DID publish an outlook, in a document
//                         with no extractable text — an image-only shareholder
//                         letter or a PDF. `guidance_absent_doc_url` links it
//                         and `guidance_absent_doc_label` names it ("shareholder
//                         letter"). No OCR is attempted.
//   'none-given'          the release was readable and carries no
//                         forward-looking figures.
//   'release-unavailable' the exhibit could not be fetched from EDGAR.
guidance_absent_reason?: 'unreadable-format' | 'none-given' | 'release-unavailable' | null;
guidance_absent_doc_url?: string | null;
guidance_absent_doc_label?: string | null;

// ── 4c. WHY there is no EPS comparison, when there is none ──────────────────
// `eps_compare_blocked` is set when `eps_prev`, `eps_yoy_pct`,
// `eps_gaap_yoy_pct` and `eps_swing` are all null NOT because the figures are
// missing but because the engine REFUSED them: this quarter and the year-ago
// quarter are on different share counts and the filer's own record does not
// establish the factor, or the share count one of them asserts is not
// believable against the filer's other filings (Virtuix tags 0.22 weighted
// shares and $32,787,960 of EPS for a quarter, against 23,046,654 shares in its
// own 10-K). `caveat_tags` then carries `per-share comparison unavailable`,
// which costs no quality points — it is a measurement problem, not a business
// one. The card must say so in words rather than printing "no prior base"; the
// dollar tiles beside it are unaffected, because a split cannot move them.
eps_compare_blocked?: boolean;

// ── 4d. THE SECOND AXIS — quality × inflection ──────────────────────────────
// Written by src/lib/us-earnings-core.ts at grade time and OVERWRITTEN by
// src/app/api/v1/earnings/graded-us/route.ts once ROCE is known (ROCE needs the
// balance sheet, which is attached later), so the payload's values are the final
// ones. Unlike everything else in this file these four are always present on a
// graded row — the scorer falls back to a neutral 50 on an axis it cannot judge
// rather than emitting null. A row read back from an older cache or an older
// bench record may still lack them, and the UI treats that absence as an
// absence: no badge, no chip match, a blank table cell.
//
//   quality_score: number;      // 0–100. What the business IS: return on
//                               // capital, cash conversion, margin LEVEL,
//                               // whether it makes money at all.
//   inflection_score: number;   // 0–100. What it is BECOMING: growth, the
//                               // CHANGE in margin, the direction of the guide,
//                               // distance travelled toward profitability.
//   quadrant: 'COMPOUNDER' | 'TURNAROUND ACCELERATOR' | 'QUALITY' | 'REJECT';
//   quadrant_parts: {
//     quality:    Array<{ label: string; points: number; of: number }>;
//     inflection: Array<{ label: string; points: number; of: number }>;
//   };
//
// `quadrant_parts` lists ONLY the components the filing actually supported —
// each score is the points earned as a share of the points ASSESSABLE, so a
// component that is absent from the array was never scored and is not in either
// denominator. The card renders the two arrays as a two-column breakdown and
// must not add a "0 of N" row for anything missing: that would misdescribe both
// the number and the company.
//
// The quadrant NEVER promotes a row's tier, and the card must never let a
// guided figure sit at the same visual weight as a reported one. The expand
// panel enforces that with three explicit bands, in order:
//   ACTUAL   — what the filing reports.
//   GUIDED   — `guidance_figures`, `vs_guide`, `guide_change`, the guidance
//              snippets. Marked as a management statement, attributed to the
//              release and dated with `filing_date`.
//   IMPLIED  — arithmetic consequences of the guide, each computed on screen
//              from `guidance_figures` (absolute dollars) against `series`
//              ($M) and nothing else. Where the guide supports no derivation —
//              no full-year revenue guide, a fiscal quarter that cannot be
//              placed from the `quarter` label, a prior-year base that is zero
//              or negative, a gap in the series — the item is absent and the
//              band does not render. An implied figure is never modelled,
//              extrapolated or carried over from another row.

// ── 5. Already on the row today (do not re-derive) ──────────────────────────
// guidance, guidance_score, guidance_snippets, guidance_url,
// guidance_figures: Array<GuidanceFigure & {
//     est?: number | null,          // the street's number for the period this
//                                   //   figure guides, matched by fiscal-end
//                                   //   date AND by period kind (a quarterly
//                                   //   guide may only meet a quarterly
//                                   //   estimate). Null whenever the pairing
//                                   //   could not be proved.
//     est_absent?:                  // WHY there is no `est`, so a bare row is
//                                   //   never mistaken for an unchecked one.
//         | 'metric-not-covered'    //   the feed carries revenue and EPS only
//         | 'basis-mismatch'        //   a GAAP guide against a non-GAAP consensus
//         | 'period-unmatched'      //   no estimate lands on that period's end
//         | 'ambiguous-feed'        //   two different numbers for one date
//         | 'implausible'           //   the candidate is not the same quantity
//         | null,                   //   (set to null when `est` is present)
//   }>,
//   Rendering rule: a figure with `est` carries its OWN three-way street
//   verdict (above = bullish, below = bearish, inside the range = in-line, in
//   IN_LINE_COLOR); a figure without one prints "no street est." and no verdict.
//   The own-guide direction (`guide_change`) is printed as a SEPARATE, labelled
//   token on the same row and never shares the street's glyph or colour —
//   "raised its own outlook" and "guides above consensus" are two facts and one
//   may point up while the other points down.
// key_metrics: KeyMetric[],
// eps_adj, eps_estimate, eps_surprise_pct, eps_basis,
// prelim, prelim_matched, release_url,
// quarters_revenue / quarters_eps / quarters_opm (last 4, no dates — legacy)
```
