# Market Cockpit — Claude Session Handoff
_Last updated: 2026-05-07_

---

## Project Overview
**Market Cockpit** — Bloomberg-lite financial dashboard for India + US markets.
**Stack:** Next.js 14 App Router, TypeScript, React, deployed on Vercel.
**Repo root:** `frontend/` (this is the Next.js app)
**Live URL:** https://market-cockpit.vercel.app

---

## API Keys (hardcoded in source)
| Service | Key |
|---------|-----|
| FMP (Financial Modeling Prep) | `SywZSfKoRQ9JmcUZ1w98MT78rrVvHGng` |
| Alpha Vantage | `62EKUKC2M5WSZB9Z` |

---

## Key Files
| File | Purpose |
|------|---------|
| `frontend/src/app/(dashboard)/earnings-analysis/page.tsx` | **Main active file** — Earnings Intelligence page (~3590 lines) |
| `frontend/src/app/(dashboard)/orders/page.tsx` | Intelligence/Orders tab — fixed cache bug |

---

## Architecture Decisions (CRITICAL — do not revert)

### Source Hierarchy
**US Stocks:**
1. **SEC EDGAR XBRL** — PRIMARY (deterministic, 100% accurate, free)
2. **FMP** — fallback only when EDGAR has no XBRL data
3. Never suggest "add exchange suffix" for US tickers (FSLY, OSS are already US tickers)

**India Stocks (.NS / .BO):**
1. **FMP** with correct suffix — primary
2. Error message should suggest correct suffix (e.g. `RELIANCE.NS`, `AEROFLEX.BO`)

**Analyst Estimates (all markets):**
- Always from FMP (`earnings-surprises` + `analyst-estimates` endpoints) — fetched in parallel after financials

### Architecture Principle
> "Claude interprets structured truth — never reconstructs it."
> LLM = interpretation/scoring layer only. XBRL/APIs = financial truth.

---

## EDGAR XBRL Integration (in `earnings-analysis/page.tsx`)

### CIK Lookup
```
GET https://www.sec.gov/files/company_tickers.json
Headers: { 'User-Agent': 'MarketCockpit/1.0 info@market-cockpit.com' }
```
- Cached in `(window as any).__edgarCache` (Record<string, number>)
- OSS → CIK 1394056 ✓ verified
- Returns `null` if ticker not found

### Facts Endpoint
```
GET https://data.sec.gov/api/xbrl/companyfacts/CIK{paddedCIK}.json
```
- `paddedCIK` = 10-digit zero-padded string
- Revenue concepts (try in order): `RevenueFromContractWithCustomerExcludingAssessedTax`, `Revenues`, `SalesRevenueNet`, `RevenueFromContractWithCustomer`
- XBRL values are **absolute dollars** → divide by 1e6 to get $ Mn (`SCALE = 1e-6`)
- Filter: `form === '10-Q' || form === '10-K'`

### Verified OSS Data (Q1 2026)
- Revenue: $8,069,610 raw → $8.07 Mn ✓ (user confirmed "$8.1M")
- CIK: 1394056

---

## Key Functions in `earnings-analysis/page.tsx`

| Function | Lines (approx) | Purpose |
|----------|---------------|---------|
| `getEdgarCIK(ticker)` | ~2085 | CIK lookup with window cache |
| `fetchFromEDGARXBRL(ticker)` | ~2107 | Builds full RawFinancials from XBRL |
| `fetchFromFMP(ticker)` | ~2244 | Builds RawFinancials from FMP APIs |
| `fetchFromTicker(sym)` | ~2315 | **Orchestrator** — EDGAR first, FMP fallback |
| `parseEarnings(text)` | ~500 | PDF/paste text parser (legacy path) |
| `scoreAccountingQuality(d)` | ~700 | Engine 1 — accounting quality score |
| `scoreEarningsReaction(d)` | ~800 | Engine 2 — market reaction score |
| `scoreNarrative(d)` | ~900 | Engine 3 — narrative/theme score |
| `sanitizeMetrics(d)` | ~600 | Validates metrics for impossible values |

---

## Scoring System (3 Engines)

### Engine Weights
**US Equities:**
- Guidance + JAT: 40%
- Margins: 25%
- Revenue Surprise: 20%
- Narrative: 10%
- Accounting: 5%

**India Equities:**
- Revenue + Margins: 30%
- Earnings Quality: 25%
- JAT (operational momentum): 25%
- Narrative: 20%

### JAT Definition
- **US:** Revision trajectory (guidance-driven) — are analysts raising estimates?
- **India:** Operational momentum (execution-driven) — sequential improvement

---

## Bugs Fixed This Session

### 1. Null crash on avData
**Error:** `Cannot read properties of null (reading 'epsEstCurrentYear')`
**Fix:** Changed `!== null` to `!= null` (catches both null and undefined); replaced `avData!.X` with `avData?.X ?? 0`

### 2. Wrong primary source (CRITICAL)
**Problem:** FMP was primary for US — OSS had no FMP data → bad error message
**Fix:** EDGAR XBRL is now primary for all US tickers; FMP is fallback
**Bad error removed:** "Try adding exchange suffix: FSLY, OSS, AEROFLEX.NS" (FSLY/OSS ARE US tickers!)

### 3. Revenue scale errors (historical, already fixed)
- Scale boundary was 1e8 → changed to 1e6 (values ≥ 1e6 are absolute dollars → factor = 1e-6)
- "K Mn" display bug: `n()` function now unit-aware (≥1000 Mn shows as Bn)

### 4. Intelligence tab always reloading on tab switch
**File:** `frontend/src/app/(dashboard)/orders/page.tsx`
**Fix:**
- `useState(true)` → `useState(() => _cache === null)` (only loads on first mount, not tab switch)
- `useEffect([fetchData])` → `useEffect([daysFilter])` with cache check
- Cache TTL: 2 min → 30 min
- Removed 2-minute auto-refresh interval

---

## RawFinancials Interface
```typescript
interface RawFinancials {
  company: string;
  ticker: string;
  period: string;           // e.g. "Q1 2026"
  periodType: 'quarterly' | 'annual';
  filingType: string;       // e.g. "SEC 10-Q (EDGAR)"
  currency: 'USD' | 'INR' | 'EUR' | 'unknown';
  scaleLabel: string;       // "$ Mn" or "₹ Mn"
  scaleFactor: number;      // 1e-6
  revenueSource: 'sec_edgar_xbrl' | 'fmp_api' | 'pdf_parse' | 'manual';
  parseState: 'verified' | 'partial' | 'failed';
  parseConfidence: number;  // 0-100
  revenue: number | null;   // in Mn
  revPrior: number | null;
  grossProfit: number | null;
  grossMargin: number | null;  // percentage
  ebit: number | null;
  ebitMargin: number | null;
  ebitda: number | null;
  ebitdaMargin: number | null;
  pat: number | null;       // Profit After Tax
  patMargin: number | null;
  eps: number | null;
  // ... plus balance sheet, cash flow, ratios, guidance[], themes[], etc.
}
```

---

## Output Format Spec (Earnings Analysis)
5 sections in order:
1. **Actuals vs Consensus** — Revenue, EPS, Gross Margin vs estimates
2. **Surprise** — Beat/miss magnitude and quality
3. **Guidance** — Management outlook vs street expectations
4. **JAT** — Just Ahead Trajectory (US: estimate revisions; India: operational momentum)
5. **Final Score** — Weighted composite with letter grade

---

## Things Still TODO / Pending Verification
1. **Intelligence tab no-reload** — deployed but user hasn't confirmed it's working in prod
2. **EDGAR XBRL for OSS in prod** — the fix is deployed but needs live test with OSS ticker
3. **Guidance parsing** — `guidance[]` array is always empty for ticker-first path (EDGAR/FMP don't give guidance text); only populated from PDF/paste path. Could improve with LLM call to parse press release.
4. **India equity scoring weights** — weights coded but JAT for India is stub (returns neutral). Full operational momentum scoring needs quarterly sequence data.

---

## Environment
- Node/npm project in `frontend/`
- Build: `cd frontend && npm run build`
- Type check: `cd frontend && npx tsc --noEmit`
- Both pass with zero errors as of 2026-05-07

---

## How to Resume in New Session
1. Tell Claude: "I'm working on Market Cockpit at `/sessions/.../mnt/market-cockpit`. Read `CLAUDE_HANDOFF.md` first."
2. Point Claude to the handoff file: `mnt/market-cockpit/CLAUDE_HANDOFF.md`
3. The main active file is `frontend/src/app/(dashboard)/earnings-analysis/page.tsx`
