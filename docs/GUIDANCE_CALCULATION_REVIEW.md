# Guidance calculation review — 7 October 2026

Reviewed the Guidance Upgrades adapter and pure calculations. This is an input-contract audit and synthetic calculation simulation, not a certification of every live company filing.

## Input availability

| Calculation | Available to the current adapter | Missing or ambiguous | Decision |
|---|---|---|---|
| India remaining-year revenue requirement | Fiscal-labelled annual revenue and quarter series, guided annual growth | Some companies lack matching quarters or annual bases | Calculate only when all existing matching-period checks pass; use actual guidance, not the valuation scenario cap |
| Revenue-to-EPS estimate | Historical revenue, profit and guided sales growth | Forward margin and diluted shares | Retain the estimate; visibly label fixed shares and modelling assumptions |
| EBITDA-to-EPS bridge | EBITDA growth and some historical profit inputs | Complete forward depreciation, interest, tax, non-operating items and diluted shares | Do not replace the existing approximation with invented inputs |
| US FY/TTM valuation | Latest-quarter SEC row, fiscal label and some analyst estimates | Matched annual/TTM sales and earnings in SkyFacts | Retain labelled run-rate fallback; defer numerical replacement |
| Net-debt valuation | Borrowings for India | Cash is not read by SkyFacts | Do not assume zero cash or add guessed cash |
| Guidance freshness | Per-growth headline freshness and lastVerifiedDaysAgo, document URL/date | Exact verification date is not always supplied | Show supplied verification age and recheck status; never substitute announcement date |
| Annual versus multi-year | Separate backend cohort arrays | Comparable single-year target for a CAGR is not guaranteed | Offer horizon selection before per-company merging; preserve All horizons default |

## Synthetic simulations (not company forecasts)

Prior-year revenue 1,000; prior H1 440; current H1 560; prior remaining H2 560.

| Annual revenue guidance | Full-year target | Required remaining revenue | Required H2 YoY growth |
|---|---:|---:|---:|
| +40% | 1,400 | 840 | +50% |
| +100% | 2,000 | 1,440 | +157.1% |
| +180% | 2,800 | 2,240 | +300% |

The old feasibility calculation substituted the valuation cap (+100%) for +180% guidance and reported +157.1%. The correction uses actual annual revenue guidance. Valuation growth caps are unchanged. Missing inputs, US data without YTD series, and multi-year guidance retain their unavailable fallback. Profit-delivery calculations are unchanged pending accounting-basis and share-count work.

EPS sensitivity demonstrates why a guaranteed forward-EPS calculation cannot be supplied from today's adapter:

- Revenue +40%, net margin unchanged at 10%, shares unchanged: EPS +40%.
- Revenue +40%, net margin 10% to 8%, shares unchanged: EPS +12%.
- Net profit +40%, shares +20%: EPS +16.7%.

These examples assume fictional inputs. They do not predict margin or dilution for any listed company.

## Changes and safeguards

- Annual guidance divided by four is explicitly a simple average, not a next-quarter hurdle; no unverified quarterly target is generated.
- Explicit fixed-share EPS estimate labels and visible model-cap notice; numeric proxy and score weights preserved.
- Annual/CAGR growth selector before company deduplication. Guidance raises remain visible; default combined view preserved.
- Source links, supplied verification age and stale/recheck labels on focus growth rows.
- Access to all supplied failed-check messages, retaining existing data exclusions.
- Valuation presentation identifies model estimates and existing run-rate assumptions without inferring market expectations.
- Actual annual revenue target in remaining-year delivery calculation, covered by synthetic mathematical regression checks and unavailable-input tests.

No data migration, paid provider or AI request is added. Existing production deployment validation runs tests, the type-error baseline gate and Next build. Concurrent Claude development is preserved by building commits from the latest repository tree and checking target-file overlap before publication.
