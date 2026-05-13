# Screener.in columns to add to the Multibagger Excel upload

The Multibagger scoring model picks up these columns **automatically** when
they appear in the Excel export. Every rule skips gracefully when the
field is missing, so you can add them one at a time. Order is by
**institutional impact** — add the top ones first.

The model lives at `frontend/src/app/(dashboard)/multibagger/page.tsx`
and the new rules ship in Patches 0313–0317.

---

## Tier A — highest impact (add these first, in order)

These four together transform the scoring from "looking at single-point
fundamentals" to "looking at trends and working-capital quality."

### 1. `Debtor Days`

- **Screener.in column name**: `Debtor Days` (also accepts `DSO`, `Days Sales Outstanding`)
- **What it catches**: Receivables piling up faster than sales. The single
  best pre-blowup earnings-quality indicator in Indian small-caps.
- **Scoring rule**:
  - > 180 days → HIGH structural red flag (cap 60)
  - > 120 days → −5 rerating + risk note
  - < 30 days in Consumer/Tech sectors → +2 strength (tight collections)

### 2. `Inventory Days`

- **Screener.in column name**: `Inventory Days` (also `DIO`)
- **What it catches**: Demand-slowdown leading indicator for industrials
  and consumer. Inventory pile-up usually shows up 1–2 quarters before
  the YoY numbers reflect it.
- **Scoring rule**:
  - > 240 days → HIGH cyclical red flag (cap 72)
  - > 150 days → −3 rerating + risk note

### 3. `Creditor Days`

- **Screener.in column name**: `Creditor Days` (also `DPO`)
- **What it catches**: Supplier-financing dynamics. Lets us compute the
  Cash Conversion Cycle (CCC) when combined with debtor + inventory days.
- **Scoring rule**: contributes to `workingCapitalDays` derived field.

### 4. `Interest Coverage Ratio`

- **Screener.in column name**: `Interest Coverage Ratio` (also `Interest Coverage`, `ICR`)
- **What it catches**: Leverage distress regardless of D/E. A company with
  D/E of 0.5 but ICR of 1.8× is one bad quarter from going concern.
- **Scoring rule**:
  - < 1.5× → CRITICAL red flag (cap 38)
  - < 3.0× → HIGH structural red flag (cap 60)
  - > 15× → +2 rerating (debt service trivial)

---

## Tier B — trend visibility (add at least 2 of 3)

These switch the model from current-snapshot logic to multi-quarter
trend detection. Massive uplift for catching operator-exits and smart-money
walk-aways before the snapshot shows them.

### 5. Promoter holding history (4 quarters)

- **Screener.in column names** (add ALL FOUR):
  - `Promoter holding 1 quarters back`
  - `Promoter holding 2 quarters back`
  - `Promoter holding 3 quarters back`
  - `Promoter holding 4 quarters back`
- **What it catches**: Steady promoter sell-down over multiple quarters
  (the cleanest pre-pump-and-dump signal). Differentiates one-quarter
  blip from sustained exit.
- **Scoring rule**:
  - 4Q decline > 4pp → HIGH structural red flag (cap 60)
  - 4Q decline > 2pp → −4 rerating + risk note
  - 4Q increase > 2pp → +4 rerating (insider conviction)

### 6. FII / DII holding history (4 quarters)

- **Screener.in column names** (add ALL EIGHT):
  - `FII holding 1 quarters back`, `2`, `3`, `4`
  - `DII holding 1 quarters back`, `2`, `3`, `4`
- **What it catches**: Smart-money walking away. Even when the current
  snapshot looks fine, a 4Q exit trend is a major distress signal.
- **Scoring rule**:
  - Combined FII+DII delta < −3pp → −5 rerating + risk note
  - Combined FII+DII delta > +4pp → +4 rerating (institutional discovery)

### 7. `Tax rate %` (Effective Tax Rate)

- **Screener.in column name**: `Tax rate %` or `Effective Tax Rate`
- **What it catches**: Aggressive accounting policy. Sustained < 15%
  effective tax rate in non-SEZ sectors (statutory is ~25%) flags either
  legitimate SEZ benefits or earnings management.
- **Scoring rule**:
  - < 12% in non-SEZ sector → −4 rerating + risk note
  - > 30% → mild −1 (paying full tax, no shelters but no inflated post-tax PAT)

---

## Tier C — capital efficiency (nice to have)

### 8. `Capex 3Yrs` (cumulative capex over last 3 years)

- **Screener.in column name**: `Capex 3Yrs` (also `Capex 3 Years`, `Capex 3yr`)
- **What it catches**: Value-destroying reinvestment. Heavy capex (>30%
  of revenue) without ROCE expansion = capital being deployed at sub-cost
  rates. Fisher's cardinal sin.
- **Scoring rule**:
  - capex3yr / approx-revenue > 30% AND roceExpansion < 0 → −5 + risk note

### 9. `Dividend Yield`

- **Screener.in column name**: `Dividend Yield` (also `Div Yield`, `DY`)
- **What it catches**: Capital allocation transparency. When a company has
  +FCF for years yet pays zero dividend AND ROCE isn't expanding, the
  cash is going somewhere unaccounted for (related-party loans, asset
  acquisitions, etc.).
- **Scoring rule**:
  - DY = 0 + FCF > 0 + ROCE not expanding + mcap > 200 Cr → −3 + risk note

---

## Tier D — liquidity (optional)

### 10. Average Daily Traded Value

- **Screener.in column name**: `Avg traded value` (or `ADV`, `Avg Daily Value (Cr)`)
- **What it catches**: Whether the stock is sizable enough to hold
  institutionally. Below ₹50L/day = essentially untradeable for serious
  positions.
- **Scoring rule**:
  - < ₹0.5 Cr/day → −3 rerating + risk note
  - < ₹1 Cr/day → −1 rerating (mild)

---

## How to add columns to your Screener.in export

1. Open the screen / portfolio in Screener.in.
2. Click the gear icon → **Customize columns**.
3. Search for each column name above and tick it.
4. Save the screen.
5. Export to Excel (the default export honors your column selection).
6. Upload the Excel to the Multibagger page — that's it.

The parser is alias-tolerant — if Screener has renamed a column (e.g.
`Tax rate %` vs `Effective Tax Rate`), the parser accepts both forms.

## Notes on column naming

For the 4-quarter histories, Screener typically uses one of these
patterns; the parser accepts all three:

- `Promoter holding 1 quarters back` (default)
- `Promoter holding Q1` (rare alternate)
- The implicit single column with comma-separated history is **not**
  supported — please add separate columns for each quarter.

## Verification

After upload, expand any row in the Multibagger table. The new
**SCORE AUDIT — WHY <N>?** chip strip (Patch 0316) shows every active
cap and severity bucket. If a Tier-A rule fired, you'll see it there.

If a column you added isn't being picked up, check the strengths/risks
panels for the column name — the parser will not silently drop a column
it doesn't recognize; it will simply leave the field undefined and the
rule will skip.

---

## Roadmap for what these unlock (when the data is in)

Once you have Tier A + Tier B columns, additional rules become possible
and will ship in subsequent patches:

- **Cash Conversion Cycle bonus / penalty** — CCC < 30d in industrials is
  a quiet moat signal; > 200d is operational distress.
- **Working capital velocity** — change in CCC quarter-over-quarter as a
  leading indicator.
- **Real-time promoter sell-down alert** — when 4Q history shows
  accelerating decline (each quarter worse than the prior), surface as
  a `MUTED → ACTIVE` watch on the home page.
- **Institutional accumulation as Conviction Beats input** — when FII +
  DII have added > 5pp over 4Q on a small-cap, auto-flag as
  "institutional discovery in progress."

Just add the columns. The scoring will adapt automatically. No code
changes needed on your end.
