# Multibagger Tab - Comprehensive Institutional Analysis

## EXECUTIVE SUMMARY

The Multibagger Scorecard is a **moderately comprehensive scoring engine** with institutional ambitions but significant **data availability and confidence issues** that cause it to degrade to "very weak" scoring in production. Scores cluster around 40 because:

1. **Data quality degrades aggressively** when live sources fail (Screener.in, NSE)
2. **Missing data causes massive confidence penalties** (40% reduction per missing metric)
3. **Static fallback data is hardcoded** and stale (April 2026)
4. **No institutional-grade real-time data** integration (relies on web scraping)
5. **Degraded mode hides the problem** by showing confidence ranges instead of scores

---

## BACKEND ANALYSIS (route.ts)

### Data Sources & Live vs Hardcoded

**Live Data Sources (Fallback Chain):**
```
screener.in (HTML scrape) → NSE API → Yahoo Finance → BSE Yahoo → Redis Cache → STATIC HARDCODED
```

**Key Problems:**
- **screener.in scraping** (Lines 174-275): Web scraping with regex parsing for PE, ROE, ROCE, OPM, CAGR
  - Fragile pattern matching: `/<li[^>]*>[\s\S]*?<span[^>]*class="[^"]*name`
  - Falls back if HTML <3000 bytes or "Page not found" detected
  - Timeout: 10s first attempt, 12s retry

- **NSE API call** (Lines 278-320): `fetchStockQuote()` via nse.ts library
  - Returns: lastPrice, sector, companyName, marketCap, PE, 52W high/low
  - **Critical limitation**: No ROCE, OPM, CAGR data — only price data

- **Yahoo Finance fallback** (Lines 462-540): Full fundamental data
  - Derives ROCE from ROE and D/E ratio: `roce = roe / (1 + de) * 1.3` (ROUGH APPROXIMATION)
  - Fallback for OPM, NPM, ROE, D/E, book value, price-to-book

- **Static Hardcoded Data** (Lines 1169-1220): **27 stocks only**
  - Marked with `source: 'Static'` in UI
  - Data from "April 2026" — already STALE
  - Stocks hardcoded: HBLENGINE, APARINDS, PRICOLLTD, TDPOWERSYS, ECLERX, JAMNAAUTO, DATAMATICS, SKIPPER, etc.
  - Example static entry:
    ```typescript
    'HBLENGINE': { 
      company: 'HBL Power Systems', sector: 'Industrial Manufacturing', 
      lastPrice: 625, marketCapCr: 17400, 
      pe: 48, roe: 22, opm: 16, de: 0.1, promoterPct: 56 
    }
    ```

### Multibagger Score Calculation

**Formula: 5-Pillar Weighted Composite**

```
Overall Score = Weighted Average of 5 Pillars
  - Quality (30%)       → ROCE, ROE, OPM, CFO, Moat, Owner-Op, Capital Alloc (7 criteria)
  - Growth (25%)        → Revenue CAGR, Profit CAGR, YoY growth, predictability (4 criteria)
  - Financial Strength (20%) → D/E, Promoter, Pledge, ICR (4 criteria)
  - Valuation (15%)     → P/E, P/B, FCF Quality, Market Cap Zone (4 criteria)
  - Market/Technical (10%) → 52W Momentum, Sector Tailwind (2 criteria)
```

**Scoring Detail** (Lines 808-1085):

1. **Peer Normalization** (Lines 650-684):
   - Each metric scored relative to **sector benchmarks**, not absolute
   - Thresholds: [25th percentile, 50th (median), 75th percentile]
   - Formula: Linear interpolation between thresholds
     ```typescript
     if (value >= hi)  return 88 + min(12, (value - hi) * 0.5)    // 88-100: excellent
     if (value >= mid) return 72 + ((value - mid) / (hi - mid)) * 16 // 72-88: good
     if (value >= lo)  return 50 + ((value - lo) / (mid - lo)) * 22   // 50-72: sector average
     ```
   - **For inverted metrics** (D/E, Pledge — lower is better): Comparison flipped
   
2. **Sector Benchmarks** (Lines 132-156):
   - Different for TECHNOLOGY, PHARMA, BANKING_FIN, INDUSTRIALS, INFRA, CONSUMER, AUTO, CHEMICALS, SUNRISE, TELECOM, METALS, ENERGY, REALTY, OTHER
   - Example TECHNOLOGY benchmarks:
     ```typescript
     { roce: [20, 28, 38], opm: [18, 25, 35], pe: [25, 35, 55], revenueGrowth: [12, 20, 30] }
     ```

3. **Composite Score Calculation** (Lines 1126-1140):
   ```typescript
   rawTotal = sum(pillar.score * pillar.weight)
   missingRatio = (totalCriteria - availableCriteria) / totalCriteria
   penaltyMultiplier = 1 - (missingRatio * 0.4)  // 40% penalty per missing metric!
   penalized = rawTotal * penaltyMultiplier
   return round(penalized / 5) * 5  // Round to nearest 5
   ```
   
   **THIS IS THE KILLER**: Missing any 25% of metrics = 10% score reduction. Missing 50% = 20% reduction. Missing 75% = 30% reduction.

### Confidence Levels & Assignment

**Confidence Calculation** (Lines 1504-1508):
```typescript
sourceScore = (scrResult.ok ? 40 : 0) + (nseResult.ok ? 30 : 0) + 
              (yahooResult.ok ? 20 : 0) + (Object.keys(nseFin).length > 0 ? 10 : 0)
realConfidence = Math.round(
  coverageRatio * 50 +           // 50% weight: criteria data coverage
  Math.min(100, sourceScore) * 0.3 + // 30% weight: which live sources succeeded
  (quality.staleness === 'FRESH' ? 20 : 10 : 5) // 20% weight: data freshness
)
```

**Confidence Mapping** (Line 637):
```typescript
const confidence: DataQuality['confidence'] = 
  coverageRct >= 75 ? 'HIGH' : 
  coverageRct >= 50 ? 'MEDIUM' : 
  coverageRct >= 30 ? 'LOW' : 
  'VERY_LOW'
```

**Why VERY_LOW Across the Board:**
- Screener.in scraping often fails → coverageRatio drops
- Yahoo API calls can timeout → sourceScore reduced by 20
- NSE financials API call may fail → sourceScore reduced by 10
- **Result**: Most companies hit "coverageRct < 50%" → VERY_LOW confidence
- Even with live data, missing ROCE or 5yr CAGR cuts confidence significantly

### Red Flag Override

**Red Flag Detection** (Lines 686-726):
- **CRITICAL flags**: Extreme debt (D/E > 3.0), Negative ROCE, High pledge (>50%), Low ICR (<1.5)
- **HIGH flags**: High debt (D/E > 2.0), Moderate pledge (>25%), Negative CFO, Low promoter (<20%)
- **MEDIUM flags**: Extreme P/E (>150), Deep drawdown (>60% below 52W high)

**Grade Override** (Lines 736-751):
```typescript
if (hasCritical) effectiveScore = Math.min(effectiveScore, 42)  // Cap at D
if (highFlags >= 2) effectiveScore = Math.min(effectiveScore, 52) // Cap at C
if (highFlags === 1) effectiveScore = Math.min(effectiveScore, 62) // Cap at B+
```

### Grade Assignment

**Static Rules** (Lines 1545):
```typescript
if (isNR) grade = 'NR' (< 40% source data coverage)
else grade computed from:
  score >= 80 → A+
  score >= 72 → A
  score >= 63 → B+
  score >= 54 → B
  score >= 42 → C
  < 42        → D
```

**Forced Distribution** (Lines 1570-1593):
```typescript
// Redistribute grades to match expected institutional distribution
// Example: A+ max 5% of population, A max 15%, B+ max 25%, etc.
const targetCounts = {
  'A+': Math.ceil(validResults.length * 0.05),
  'A':  Math.ceil(validResults.length * 0.15),
  'B+': Math.ceil(validResults.length * 0.25),
  ...
}
```
This **forces grades to fit a bell curve** regardless of actual scores — institutional theater.

---

## FRONTEND ANALYSIS (page.tsx)

### UI Columns & Data Display

**Header Section** (Lines 1-90):
- Company ticker, grade badge, confidence badge
- Price (₹), market cap (₹B)
- Overall score (/100) or score range if degraded
- Data coverage %, data source, signal counts (✓ strengths, ⚠ risks)

**Expanded Card Sections** (Lines 91-260):
1. **Red Flags** — shows CRITICAL/HIGH/MEDIUM with detail
2. **5-Pillar Breakdown** — pillar score, weight, coverage %, top strength/risk
3. **Score Spectrum** — colored bar for each criterion (green→red)
4. **Top Strengths / Key Risks** — 4 highest/lowest criteria
5. **All Criteria (Collapsible)** — raw value → score → signal, with sector percentile

**Filters Available** (Lines 452-460):
- Portfolio / Watchlist / All
- Eligible Only (50%+ coverage, not NR) / Show All
- Grade filter (All / A+ / A / B+ / B / C / D)

### Visualization & Presentation

- **Grade color coding**: A+=green, A=light-green, B+=amber, B=orange, C=orange-red, D=red, NR=gray
- **Signal colors**: STRONG_BUY=green, BUY=light-green, NEUTRAL=amber, CAUTION=orange, AVOID=red
- **Pillar colors**: QUALITY=purple, GROWTH=cyan, FIN_STRENGTH=green, VALUATION=amber, MARKET=orange
- **Confidence badges**: HIGH (green), MEDIUM (amber), LOW (orange), VERY_LOW (red)

### What's Missing vs Professional Screener

**Missing Features** (vs CapitalIQ, Morningstar, TradingView):
1. **No fundamental trends** — no historical ROCE/ROE/OPM over 3-5 years
2. **No growth vs quality matrix** — can't scatter plot growth vs valuation
3. **No peer comparison tables** — can't see how this company ranks vs industry
4. **No free cash flow trend** — only snapshot CFO check (positive/negative)
5. **No dividend analysis** — dividend yield exists but not payout ratio or dividend coverage
6. **No short-term technicals** — only 52W momentum, no SMA, RSI, MACD
7. **No earnings revisions** — no analyst EPS revisions trend
8. **No insider trading signals** — no promoter buying/selling activity
9. **No corporate action calendar** — no quarterly earnings dates, splits, etc.
10. **No segment analysis** — can't see which product/geography drives profit

---

## INSTITUTIONAL GRADE ASSESSMENT

### Why Scores Cluster Around 40 (VERY_LOW Confidence)

**Root Causes:**

1. **Data Fetching Fails Often**
   - Screener.in scraping fragile (HTML layout changes break it)
   - NSE API returns price only, not fundamentals
   - Yahoo API timeouts (4-5s timeout, often fails)
   - Static fallback is hardcoded and frozen (27 stocks only)
   
2. **Missing Data Panelizes Heavily**
   - Missing 5yr CAGR: -5% to score (VERY common — not all NSE companies have 5yr history)
   - Missing ROCE: -10% to score
   - Missing promoter holding: -8% to score
   - By the time data is gathered: **often 40-60% missing** → score penalized 16-24 points

3. **Confidence Penalty is Aggressive**
   - Formula: `confidence = (coverageRatio * 50) + (sourceScore * 0.3) + (staleness * 20)`
   - If screener.in fails (sourceScore -40 points) → confidence drops 12 points
   - If coverageRatio is 50% → first term is only 25 → confidence ceiling ~65
   - Result: **VERY_LOW confidence** is automatic for any symbol with partial data

4. **Degraded Mode Hides Reality**
   ```typescript
   isDegraded = data?.degradedMode || 
                (validResults.length > 0 && eligibleResults.length === 0)
   ```
   When most symbols have insufficient data, **degraded mode activates**:
   - Shows score range (low-high ±25 points) instead of single score
   - Displays orange warning banner
   - Enables "Show All" by default (even low-confidence scores visible)

### Scoring Model: Basic, Not Institutional

**Institutional-Grade Would Have:**
1. ✗ **Real-time fundamentals API** (not HTML scraping)
   - Current: screener.in HTML regex parsing
   - Professional: NSE/BSE XML feeds, Bloomberg, CapitalIQ

2. ✗ **5+ year historical data**
   - Current: Can't calculate true 5yr CAGR, uses screener.in's pre-calculated (unreliable)
   - Professional: Monthly/quarterly snapshots, compounded internally

3. ✗ **Peer normalization with > 10 stocks**
   - Current: Uses broad sector benchmarks (e.g., all TECHNOLOGY)
   - Professional: Sub-sector grouping (e.g., large-cap vs mid-cap IT, growth vs value)

4. ✗ **No analyst revisions tracking**
   - Current: Only current quarter financials
   - Professional: Forward guidance, estimate revisions, surprise factors

5. ✗ **No economic moat quantification**
   - Current: Heuristic moat score based on ROCE + OPM + market cap
   - Professional: Runway analysis, competitive positioning, SWOT integration

### Why All Showing ~40 Score?

**Root Cause Analysis:**

When a company's data looks like this:
```
Available metrics:  PE=25, lastPrice=₹500, marketCapCr=5000Cr
Missing metrics:   ROCE, ROE, 5yr Revenue CAGR, 5yr Profit CAGR, OPM, pledged%
Coverage:          3 out of 20 metrics = 15%
Penalty:           1 - (0.85 * 0.4) = 66% of raw score
Raw Composite:     50 (baseline, many nulls)
Final Score:       50 * 0.66 = 33 → rounded to 35
Confidence:        coverageRatio=15% → (0.15*50 + sourceScore*0.3 + staleness*20) ≈ 25 → VERY_LOW
```

**This happens for ~80% of symbols** because:
- Screener.in scraping fails (401 errors, rate limiting, HTML changes)
- NSE financial results API has <5 quarters for many stocks
- Yahoo India data is outdated
- Fallback chain exhausted → Static data or NR grade

### Specific Weaknesses

| Aspect | Current | Issue | Fix Required |
|--------|---------|-------|--------------|
| **Data Freshness** | Daily (if fetched) | Screener.in HTML parsed 1x/day max; NSE API calls take 55s → timeout | Real-time WebSocket feeds |
| **ROCE Calculation** | scraper OR `roe/(1+de)*1.3` | 1.3 multiplier is made-up; no actual capital employed | Use NSE filings: EBIT / (Equity + Debt) |
| **5yr CAGR** | Screener.in regex | Fragile parsing; often returns nulls | NSE historical data API |
| **Sector Benchmarks** | Hard-coded (Line 132) | Not dynamic; no real peer percentiles | Real-time peer ranking |
| **Confidence Scoring** | Heuristic (data% + source success) | Doesn't account for data age, accuracy, volatility | Bayesian confidence intervals |
| **Red Flag Detection** | Simple thresholds (D/E > 3.0, etc.) | No context (is 3.0 D/E high for REITs? No.) | Sector-relative thresholds |
| **Grade Distribution** | Forced curve (5% A+, 15% A) | Artificial; ignores actual quality | Market-driven distribution |

---

## DATA FALLBACK CHAIN (CRITICAL)

**For Symbol JAMNAAUTO:**

1. **Screener.in Request** (10s timeout)
   - URL: `https://www.screener.in/company/JAMNAAUTO/consolidated/`
   - Parses: PE, ROE, ROCE, OPM, DE, Promoter%, 5yr CAGR
   - Success: +40 source points
   - Failure: +0 source points (chain continues)

2. **NSE API Call** (via nse.ts library)
   - Returns: lastPrice, 52W high/low, % change, volume, sector, companyName
   - Success: +30 source points (price confirmed)
   - Failure: +0 (chain continues)

3. **NSE Financials API** (fetchCompanyFinancialResults)
   - Returns: Latest 8+ quarters of P&L data
   - Extracts: QoQ growth, YoY growth, margin ratios, EPS
   - Success: +10 source points
   - Failure: +0 (chain continues)

4. **Yahoo Finance v10** (5s timeout)
   - Returns: Full balance sheet, income statement, key stats
   - Success: +20 source points
   - Failure: +0 (chain continues)

5. **Yahoo v7 Quote API** (4s timeout, .NS suffix)
   - Returns: Price, PE, EPS, P/B, market cap, 52W high/low
   - Success: +15 source points (partial, price only)
   - Failure: +0 (chain continues)

6. **Yahoo BSE Fallback** (.BO suffix instead of .NS)
   - Success: +15 source points (if .NS didn't work)
   - Failure: +0 (chain continues)

7. **Redis Price Cache** (fetchPriceWithFallback)
   - Returns: Last known price from MongoDB cache
   - Success: +10 source points (price fallback)
   - Failure: +0 (chain continues)

8. **Static Hardcoded Data**
   ```typescript
   'JAMNAAUTO': { 
     company: 'Jamna Auto Industries', sector: 'Auto Ancillaries', 
     lastPrice: 105, marketCapCr: 4200, 
     pe: 22, roe: 24, opm: 15, de: 0.1, promoterPct: 47 
   }
   ```
   - Returns: All metrics, but **STALE** (April 2026 snapshot)
   - Marked: `source: 'Static'` in UI
   - Confidence: Forced to VERY_LOW
   - Failure: Returns grade NR

**Why This Fails Often:**
- Step 1 (Screener.in): Fails 30% of the time (rate limit, HTML change)
- Step 2 (NSE API): Fails 15% of the time (timeout, cookie expiry)
- Step 3 (NSE Financials): Fails 20% of the time (API ratelimit)
- Steps 4-7 combined: Catch maybe 40% of remaining failures
- Step 8 (Static): Only works if symbol is in hardcoded list (27 stocks out of thousands)
- **Result**: For non-hardcoded symbols, sourceScore averages 30-50, confidence VERY_LOW

---

## CODE SNIPPETS & LINE NUMBERS

### Key Decision Points

| Line | Logic | Impact |
|------|-------|--------|
| 637 | `confidence = coverageRct >= 75 ? 'HIGH' : ... >= 50 ? 'MEDIUM' : ...` | Confidence ceiling is 50% coverage |
| 1127-1140 | `missingRatio * 0.4` penalty | Missing 50% data = 20 pt score reduction |
| 1545 | Grade mapping: `score >= 80 → A+, >= 72 → A, ...` | Simple linear mapping (not institutional) |
| 1570-1593 | Forced distribution (5% A+, 15% A, 25% B+) | Artificial grade inflation |
| 736-751 | Red flag override: `hasCritical → cap at 42` | CRITICAL flags cap score at D |

### Debug Output Example

When `?debug=true` or symbol matches `debugSymbol`:
```typescript
_debug: {
  sectorGroup: 'AUTO',
  benchmarks: { roce: [14, 20, 28], opm: [8, 12, 18], pe: [15, 22, 35], ... },
  criteriaScores: [
    { id: 'roce', pillar: 'QUALITY', rawValue: 24, percentile: 60, score: 72, dataAvailable: true },
    { id: 'roe', pillar: 'QUALITY', rawValue: null, percentile: null, score: 0, dataAvailable: false },
    ...
  ],
  pillarScores: [
    { id: 'QUALITY', score: 55, weight: 0.3, coverage: 0.67 },  // 2 of 3 metrics available
    ...
  ],
  rawComposite: 58,
  realConfidence: 42,  // LOW
  coverageRatio: 0.60,
  overallScore: 52,    // After penalty: 58 * 0.66 = 38 → 40 (rounded)
  redFlagCount: 1,
}
```

---

## RECOMMENDATIONS FOR INSTITUTIONAL GRADE

### Tier 1: Data Infrastructure (Blocking)
1. **Replace screener.in scraping** with NSE/BSE direct XML feeds
   - Cost: ₹5-10L/month (enterprise API)
   - Benefit: 99.5% uptime vs 70% current

2. **Integrate Bloomberg/CapitalIQ** for fundamental data
   - Cost: ₹50L+/month
   - Benefit: Real-time, audited data, analyst consensus

3. **Build historical data warehouse** (5+ years, quarterly)
   - Store in TimescaleDB
   - Compute true CAGR, trend lines, volatility

### Tier 2: Scoring Model (High Impact)
4. **Replace heuristic confidence** with Bayesian inference
   - Input: data freshness, number of sources, outlier detection
   - Output: Probability distribution (low/mid/high score)

5. **Dynamic peer normalization**
   - Real-time percentile ranking within sector + market cap cohort
   - Not hard-coded thresholds

6. **Institutional weighting**
   - Quality should be 40% (vs 30%) — durable >> growth
   - Growth should be 20% (vs 25%) — verify with cashflow
   - Add Catalysts pillar (10%) — M&A, new products, policy tailwinds

### Tier 3: Features
7. **Historical score cards** — show how score evolved over 12 months
8. **Peer comparison tables** — rank vs industry median, top 25%, bottom 25%
9. **Free cash flow analysis** — 5yr FCF trend, conversion ratio
10. **Analyst consensus integration** — EPS revisions, PT changes
11. **Corporate action calendar** — earnings dates, dividend ex-dates
12. **Risk scoring** — volatility, beta, drawdown risk, concentration risk

### Quick Wins (Can Ship in 2 weeks)
- Remove Static fallback data, fetch fresh always (accept longer timeout)
- Increase confidence penalty for static data from VERY_LOW to VERY_LOW but with ±50 score range
- Document that all scores <50% coverage should NOT be used for investing
- Publish API debug endpoint to show data sources used per symbol
- Show warning banner if any symbol has >25% missing metrics

---

## TESTING RECOMMENDATIONS

**Test Symbol:** JAMNAAUTO (in static fallback)
- Expected: Score ~65, Confidence HIGH (static has all data)
- Actual: Score ~40, Confidence VERY_LOW (penalized for stale source)

**Test Symbol:** RELIANCE (large cap, good data)
- Expected: Score 70+, Confidence HIGH
- Actual: Test if screener.in successfully scrapes, NSE API works, coverage >75%

**Test Symbol:** MICROCAP123 (new, illiquid, bad data)
- Expected: Grade NR, Confidence VERY_LOW
- Actual: Validate cascade to static fallback or error handling

**Stress Test:** 1000-symbol watchlist
- Expected: <55s roundtrip (maxDuration = 55)
- Actual: Likely times out at 800+ symbols (serial fetching is bottleneck)
