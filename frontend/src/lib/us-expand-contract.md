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
// => Compute any multi-year earnings growth from `net_income`, NEVER from the
//    old end of the eps array. QoQ and YoY EPS (1 and 4 quarters back) are safe.

// ── 2. Balance-sheet / capital-return context ───────────────────────────────
context?: {
  cash_musd: number | null;
  cash_incl_st_inv: boolean;            // true => the figure includes short-term investments
  debt_musd: number | null;             // null when the filer tags no total debt line
  sbc_musd: number | null;              // stock-based comp, THIS quarter
  buyback_musd: number | null;          // common-stock repurchases, THIS quarter
  dividends_musd: number | null;        // dividends paid, THIS quarter
  diluted_shares_m: number | null;
  diluted_shares_yoy_pct: number | null;// negative = share count shrinking
  as_of: string | null;                 // balance-sheet date used
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

// ── 5. Already on the row today (do not re-derive) ──────────────────────────
// guidance, guidance_score, guidance_snippets, guidance_url,
// guidance_figures: Array<GuidanceFigure & { est?: number | null }>,
// key_metrics: KeyMetric[],
// eps_adj, eps_estimate, eps_surprise_pct, eps_basis,
// prelim, prelim_matched, release_url,
// quarters_revenue / quarters_eps / quarters_opm (last 4, no dates — legacy)
```
