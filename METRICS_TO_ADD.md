# Screener.in columns to add to the Multibagger Excel upload

## ⚠️ STATUS AFTER YOUR LATEST EXPORT (recent-ipos-8.csv, 54 columns)

The model auto-parses your current export. Most Tier A working-capital
columns are present. The summary below tells you what's wired and what
would unlock additional rules.

### ✅ Already in your export — picked up automatically (final CSV, 59 cols)

- Debtor days · **Tier A**
- Days Inventory Outstanding · **Tier A**
- Days Payable Outstanding · **Tier A**
- Days Receivable Outstanding (alt for debtor days)
- Working Capital Days · **Tier A**
- **Debtor days 3years back** · trend signal
- **Average Working Capital Days 3years** · trend signal
- Interest Coverage Ratio · **Tier A**
- Other income (₹ Cr) — derives Other Income % of PBT via EPS + Equity Capital
- Equity capital — derives share count (₹10 par)
- Promoter / DII / FII holding (current snapshot)
- **Change in promoter holding** (1Q snapshot)
- **Change in promoter holding 3Years** · trend signal (Patch 0334) ✓
- **Change in FII holding** (1Y) ✓
- **Change in FII holding 3Years** · trend signal (Patch 0334) ✓
- **Change in DII holding** (1Y) ✓
- **Change in DII holding 3Years** · trend signal (Patch 0334) ✓
- Pledged percentage
- All quality / growth / valuation / momentum pillars
- High price, From 52w high, **High/Low price all time** (volatility range derived)
- Industry PE, EPS, Sales growth 3Years, ROCE/ROIC, EVEBITDA, FCF Yield
- GPM latest quarter

### 🟡 Auto-derived from what you have (no need to add)

- **Free Float %** ≈ 100 - Promoter holding
- **52 Week Range %** ≈ (High Price All Time - Low Price All Time) / Low × 100
- **Number of equity shares** ≈ Equity Capital × 10 (₹10 par convention)
- **Other Income % of PBT** ≈ Other Income / (EPS × shares / 0.75)

### ❌ Still missing — adding these unlocks specific rules

These are the columns NOT in your current export. Listed in priority order.

#### Tier B trend signals — ✅ DONE via Change-3Years columns

The Change-1Y + Change-3Years deltas you added let the model synthesize
3-point ownership histories (3Y-ago → 1Y-ago → current) which trigger
the same trend rules that 4Q-history columns would. No further work
needed on ownership trends.

#### Most-valuable to add next

1. **Tax rate %** (effective tax rate)
   - Unlocks: aggressive-accounting flag (<12% in non-SEZ)
   - Without it: this check skips

#### Useful but optional

5. **Capex 3Yrs** — value-destroying-reinvestment flag
6. **Dividend Yield** — zero-dividend-with-FCF check
7. **Cash and equivalents** + **Cash and equivalents preceding year** — paper-profits-vs-cash forensic check

#### Forensic Tier E (only if you want stronger pump detection)

8. **Related Party Transactions %** — value-transfer flag
9. **Number of Subsidiaries** — multi-layer scheme detector
10. **Auditor Changes Last 3Y** — governance flag
11. **Number of equity shares preceding 3 years** — 3Y dilution trail (more accurate than the Equity-Capital-derived current count alone)

### How to add Screener custom ratios

For the 4-quarter ownership history columns, Screener.in supports adding
columns via the "Customize columns" gear icon on any saved screen. Search
for the column name exactly as listed above and enable them.

For ratios that aren't pre-built (Other Income % of PBT, etc.), use
Screener's "Add new ratio" feature in the screen builder:
```
Other Income % of PBT = Other Income / Profit before tax * 100
```

Then re-export. The model alias-tolerates spaces, capitalization, and
common variants.



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

## Tier E — Forensic pump-detection (MosChip / RIR Power style)

**Read this section carefully.** These are the columns that catch the
operator-pumped names that look fundamentally clean. Patch 0322 ships
an 11-signal forensic detector; when 3+ signals fire the model
auto-applies a HIGH structural red flag (composite cap 60), and when
5+ fire it goes CRITICAL (cap 38). All checks gate on microcap (mcap
< ₹3000 Cr) since the pump pattern is microcap-specific.

The forensic detector handles cases like:

- **MosChip Technologies**: real revenue growth, expanding margins, but
  growth funded by repeated QIPs (share count grew >50% in 3Y),
  high other-income share of PBT, related-party transactions, and
  promoter holding declined while price ran.
- **RIR Power Electronics**: hot-sector defense pure-play, but with low
  cash conversion despite reported profits, high 52w volatility range,
  small free float, and price action driven by retail flow during pump
  cycles.

Without these columns, conventional fundamental screening (ROCE, OPM,
CFO/PAT) WILL classify these names as A+/A and they will pollute the
Conviction Beats bench. With these columns, the model catches them
forensically before they make the list.

### Forensic columns (please add ALL, in this priority order)

#### F1. `Other Income / PBT %`

- **Screener.in column name**: `Other Income / PBT %` (or `Other Income % of PBT`)
- **What it catches**: Non-operating PBT inflation. When a company books
  treasury gains, FX, sale of investments, or one-off items as part of PBT,
  the headline profit growth is fake. Often used to hide stagnant
  operating performance.
- **Scoring rule**: > 25% adds 2 pump points. Sustained > 25% is the
  cleanest accounting-inflation signal.

#### F2. `Cash and equivalents` + `Cash and equivalents preceding year`

- **Screener.in column names** (add BOTH):
  - `Cash and equivalents`
  - `Cash and equivalents preceding year`
- **What it catches**: Cash balance declining despite reported profit
  growth — paper profits not converting to balance-sheet cash. Strongest
  signal that PAT is real on paper but fictional in execution.
- **Scoring rule**: Cash declined > 30% YoY while profit grew > 20% YoY
  adds 2 pump points.

#### F3. `Number of equity shares` + `Number of equity shares preceding 3 years`

- **Screener.in column names** (add BOTH):
  - `Number of equity shares`
  - `Number of equity shares preceding 3 years`
- **What it catches**: Dilution-funded growth. When share count grew
  > 25% over 3Y, the "revenue growth" was funded by issuing new equity
  (QIPs, preferential allotments), not by the underlying business
  earning more. EPS growth is partly fictional.
- **Scoring rule**: > 50% dilution → 3 pump points (extreme). > 25% → 2.

#### F4. `Related Party Transactions %` (% of revenue)

- **Screener.in column name**: `Related Party Transactions %`
  (or `RPT % Revenue`, `Related Party % Revenue`)
- **What it catches**: Value transfer to / from promoter group via
  related-party deals. > 5% of revenue = material; > 20% = the company
  is largely a value-extraction vehicle.
- **Scoring rule**: > 20% adds 3 pump points; > 10% adds 2; > 5% adds 1.

#### F5. `Auditor Changes Last 3Y`

- **Screener.in column name**: `Auditor Changes Last 3Y`
  (Screener exposes this as a flag in the company info page)
- **What it catches**: Frequent auditor rotation. Real companies change
  auditors rarely; companies hiding things change them when the
  current auditor starts asking hard questions. ≥ 2 changes in 3Y is
  a major governance flag.
- **Scoring rule**: ≥ 2 changes → 2 pump points. 1 change → 1.

#### F6. `Number of Subsidiaries`

- **Screener.in column name**: `Number of Subsidiaries`
  (or `Subsidiary Count`)
- **What it catches**: Multi-layer subsidiary structures favored by
  operator-driven schemes for value extraction. ≥ 10 subsidiaries on
  a sub-₹1000Cr microcap is a structural red flag — there's almost no
  business reason for that complexity at that size.
- **Scoring rule**: ≥ 10 subsidiaries on mcap < ₹1000Cr → 2 pump points.

#### F7. `52 Week Range %` (high vs low)

- **Screener.in column name**: `52 Week Range %`
  (or `High Low Range %`, or compute: (52wHigh - 52wLow) / 52wLow × 100)
- **What it catches**: Operator-induced volatility. Real businesses
  don't 3× then halve in a year. Range > 200% is consistent with
  coordinated activity (pumps and rinses).
- **Scoring rule**: > 200% adds 2 pump points; > 120% adds 1.

#### F8. `Free Float %`

- **Screener.in column name**: `Free Float %` (or `Public Float %`)
- **What it catches**: Thin floats are vulnerable to coordinated
  activity. < 15% free float means a small group can move price
  meaningfully on low capital.
- **Scoring rule**: < 15% adds 1 pump point.

#### F9. `Promoter Group Entities` (count of entities in promoter group)

- **Screener.in column name**: `Promoter Group Entities`
  (or `Promoter Entities Count`)
- **What it catches**: Complex group structures with many promoter-
  affiliated entities obscure stake tracking and enable invisible
  related-party transactions.
- **Scoring rule**: ≥ 15 entities → 1 pump point.

#### F10. Sector growth rate (for relative-growth check)

- **Screener.in column name**: Not directly available. Can be
  approximated by adding a custom "Industry / Sector Sales CAGR"
  column if Screener supports it for your selection.
- **What it catches**: A 60% sales CAGR is great in a sector growing
  10%. The same 60% in a sector also growing 50% is just riding the
  wave. Distinguishes the company from the sector. (Currently we
  use absolute thresholds; sector-relative thresholds are better.)
- **Scoring rule**: Will be wired in a future patch when this data
  is available.

#### F11. Promoter pledge with non-bank flag

- **Screener.in column name**: Not directly available. Current
  `Pledged percentage` doesn't distinguish bank vs NBFC vs HNI.
  Pledging with NBFCs/HNIs at high interest rates is a distress
  signal that pledging with banks isn't.
- **Scoring rule**: Will be wired when this distinction is
  available; currently we just track total pledge.

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

## Forensic detector — confidence scale

When you've added the Tier E columns and re-uploaded, the model
computes a hidden **pump score** for every microcap. Severity tiers:

- **0–1 pump points**: clean profile, no forensic concerns
- **2 pump points**: −2 rerating, one risk-note (mild caution)
- **3–4 pump points**: HIGH structural red flag → composite capped at 60
- **5+ pump points**: CRITICAL red flag → composite capped at 38

The forensic score is independently visible in the **SCORE AUDIT** chip
strip on each row's expand panel — you'll see the specific signals
that fired so you can verify them yourself.

The detector ONLY fires on microcaps (mcap < ₹3000 Cr). Mid- and
large-caps are governed by the other quality checks because the pump
pattern requires manipulable float (small mcap + low free float).

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
