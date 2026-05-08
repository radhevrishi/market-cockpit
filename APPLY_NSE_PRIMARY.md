# Apply NSE-primary fix for India earnings

## What this fix does

The earnings-analysis page footer was reading `financials: screener_in · history: screener_in` even though NSE has the authoritative quarterly filing data.

This patch flips the priority:
- **NSE** is now PRIMARY for quarterly P&L (Revenue, OP, OPM, PAT, EPS, margins, history)
- **Screener.in** remains the source for TTM ratios (P/E, ROCE, ROE, Book Value, D/E), annual P&L, balance sheet, cash flow, shareholding, and sector classification — fields NSE doesn't expose

After deploy, the footer should read `financials: nse_quarterly_results · history: nse_quarterly_results` for any company NSE returns ≥4 valid quarterly filings for, falling back to `screener_in` only when NSE is missing or insufficient.

## How to apply

Four patches need to land together:
- `0001-fix-india-NSE-primary-Screener.in-fallback-for-quart.patch` — flips quarterly P&L source priority to NSE-primary inside the india-screener route
- `0002-fix-india-use-india-screener-as-primary-lookup-cover.patch` — fixes ACMESOLAR.NS-style "No data found" by routing the page's first lookup through the (now NSE-primary) india-screener route instead of the narrower india route
- `0003-fix-india-Latest-Quarter-table-compute-QoQ-YoY-for-O.patch` — populates the missing QoQ/YoY deltas for Operating Profit, OPM QoQ, Net Margin, and EPS in the Latest Quarter summary table
- `0004-fix-earnings-trend-table-OP-EPS-deltas-concall-uploa.patch` — adds Op Profit value + OP YoY% + PAT QoQ% + EPS YoY% to the 8-quarter trend table; adds an "Upload Concall" button that opens a paste-text modal which re-runs the snapshot builder with guidance/tone extraction; aligns Tesla-style EPS scorecard and trend so they show the same number from FMP earnings-surprises

The Cowork sandbox can't push to GitHub directly (no credentials). Apply all four from your machine:

```bash
cd /path/to/market-cockpit
git pull origin main
git am 0001-fix-india-NSE-primary-Screener.in-fallback-for-quart.patch
git am 0002-fix-india-use-india-screener-as-primary-lookup-cover.patch
git am 0003-fix-india-Latest-Quarter-table-compute-QoQ-YoY-for-O.patch
git am 0004-fix-earnings-trend-table-OP-EPS-deltas-concall-uploa.patch
git push origin main
```

Vercel will auto-deploy on push.

## Verify after deploy

1. Open `https://market-cockpit.vercel.app/earnings-analysis`
2. Run **ACMESOLAR.NS** — should now load (was "No data found" before)
3. Run **BIOCON.NS** — Latest Quarter table should show QoQ + YoY deltas on every row (Operating Profit, OPM, PAT, Net Margin, EPS), not just Revenue and PAT
4. Run **BAJAJCON.NS** or **RELIANCE.NS** — footer should read `financials: nse_quarterly_results · history: nse_quarterly_results`
5. Run **TCS.NS** or **HDFCBANK.NS** — same NSE-quarterly footer
6. Open the `DEBUG · INDIA PIPELINE PROVENANCE` accordion — `endpointsHit` should include `nse_corporates_financial_results` for tickers where NSE has filed

If a ticker shows `screener_in` after the deploy, that means NSE didn't return enough quarterly filings (the filter requires ≥4 single-quarter filings within the last 3 years; H1/9M/FY/cumulative rows are excluded). For new IPOs like ACMESOLAR, Screener falls back automatically.

## Files changed

- `frontend/src/app/api/earnings/india-screener/route.ts` — runs NSE fetch in parallel; merges NSE quarterly into the response when available; adds `provenance` field; new graceful Screener-down → NSE-only path
- `frontend/src/lib/earnings/india-build.ts` — reads `screener.provenance` to label `sources.financials` and `sources.history`; threads `endpointsHit` through to the debug panel
- `frontend/src/app/(dashboard)/earnings-analysis/page.tsx` — adds `fetchFromScreenerIndia` mapper; reorders India lookup priority (india-screener → india → FMP)
