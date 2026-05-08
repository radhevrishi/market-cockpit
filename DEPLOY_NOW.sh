#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# Deploy all five Cowork-built fixes to Vercel in one shot.
#
# Run this from the root of your local market-cockpit clone:
#   chmod +x DEPLOY_NOW.sh && ./DEPLOY_NOW.sh
#
# What it does:
#   1. git pull origin main             (sync to current deployed HEAD)
#   2. git am 0001..0005.patch          (apply all 5 fixes)
#   3. git push origin main             (Vercel auto-deploys on push)
#
# Patches included:
#   0001 — NSE primary, Screener.in fallback for India quarterly P&L
#   0002 — fix ACMESOLAR.NS-style "No data found" (recent IPOs)
#   0003 — Latest Quarter table: QoQ/YoY for OP, OPM, Net Margin, EPS
#   0004 — Quarterly Trend (8Q): OP value + EPS YoY% + concall upload
#                                + TSLA EPS source alignment
#   0005 — drop Div Yield · US concall upload · TSLA EPS YoY fallback
#
# If `git am` fails on a patch (e.g. existing local changes), run:
#   git am --abort
#   git stash
#   ./DEPLOY_NOW.sh
#   git stash pop
# ─────────────────────────────────────────────────────────────────────────
set -e

if [ ! -d ".git" ]; then
  echo "ERROR: run this from the root of your market-cockpit git clone."
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1/3  Pull latest from origin/main"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
git pull origin main

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2/3  Apply 5 patches"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for p in 0001-fix-india-NSE-primary-Screener.in-fallback-for-quart.patch \
         0002-fix-india-use-india-screener-as-primary-lookup-cover.patch \
         0003-fix-india-Latest-Quarter-table-compute-QoQ-YoY-for-O.patch \
         0004-fix-earnings-trend-table-OP-EPS-deltas-concall-uploa.patch \
         0005-fix-earnings-remove-Div-Yield-US-concall-upload-EPS-.patch; do
  if [ ! -f "$p" ]; then
    echo "ERROR: patch file not found: $p"
    echo "Make sure DEPLOY_NOW.sh is in the same folder as the .patch files."
    exit 1
  fi
  echo "  applying $p"
  git am "$p"
done

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 3/3  Push to origin/main (Vercel auto-deploys)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
git push origin main

echo
echo "✓ DONE. Vercel will deploy in 1-2 minutes."
echo "  Watch the build at https://vercel.com/dashboard"
echo "  Test at https://market-cockpit.vercel.app/earnings-analysis"
echo
echo "Verification checklist after deploy:"
echo "  1. BAJAJCON.NS — Latest Quarter table shows QoQ + YoY for ALL six rows"
echo "                   (not just Revenue and PAT)"
echo "  2. BAJAJCON.NS — Quarterly Trend (8Q) table has Op Profit + OP YoY%"
echo "                   + PAT QoQ% + EPS YoY% columns"
echo "  3. BAJAJCON.NS — Profitability & Leverage row no longer has Div Yield"
echo "  4. BAJAJCON.NS — Concall / Guidance card has '+ Upload Concall' button"
echo "  5. BAJAJCON.NS — Footer reads 'financials: nse_quarterly_results'"
echo "                   instead of 'screener_in'"
echo "  6. ACMESOLAR.NS — loads (was 'No data found' before)"
echo "  7. TSLA — Scorecard EPS matches Trend EPS (both 0.41 OR both 0.15)"
echo "  8. TSLA — Scorecard EPS row YoY column shows a number, not '—'"
echo "  9. TSLA — Guidance card has '+ Upload Concall' button"
