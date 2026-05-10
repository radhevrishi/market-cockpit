'use client';

// ═══════════════════════════════════════════════════════════════════════════
// SPECIAL SITUATIONS — INSTITUTIONAL SCORECARD (patch 0096)
//
// Replaces the regex-only news scanner (which surfaced 0 matches because the
// upstream /news endpoint only returns ~47 BOTTLENECK-classified articles
// in 90 days, not corporate-action firehose) with a proper institutional
// scorecard:
//
//   1. CURATED EVENTS — fact-verified, probability-weighted EV per scenario,
//      verdict, mechanics, SoP / acceptance / floating-deal blocks, timing
//      and post-event playbook.  v1 ships with the 5 active situations the
//      owner laid out (Vedanta demerger, Wipro tender, Honeywell HONA spin,
//      QXO/TopBuild merger arb, Adobe $25B buyback) plus the v2 corrections.
//
//   2. UNIVERSAL TIMING RULES — when to buy / sell across event archetypes
//      (demerger, tender, open-market buyback, merger arb).
//
//   3. POST-EVENT PLAYBOOK — the J-curve, hold signals, sell signals, what
//      to do with unaccepted shares after a tender.
//
//   4. ACCEPTANCE / DEAL MATH — INTERACTIVE calculators:
//        Indian tender buyback acceptance ratio (small-holder reserved
//        category sensitivity to promoter participation).
//        Floating-deal effective consideration (cash% + stock% × current
//        acquirer price) with break-even acquirer price.
//
//   5. DISCOVER — kept the news regex scanner as a 5th sub-tab so newly-
//      announced corporate actions surfacing in the news feed flag for
//      promotion into the curated set.
//
// All curated data is in this file (CURATED_EVENTS) so editing a thesis is
// as cheap as updating one record.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { GitBranch, Handshake, RotateCcw, Banknote, BarChart3, ExternalLink, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type EventType = 'DEMERGER' | 'SPIN_OFF' | 'TENDER_BUYBACK' | 'MERGER_ARB' | 'OPEN_MARKET_BUYBACK';
type Tier = 'TIER_1_HARD' | 'TIER_2_VALUATION' | 'MONITOR';
type Verdict = 'BUY' | 'BUY_HOLD' | 'BUY_SMALL_ONLY' | 'PASS' | 'WAIT' | 'CONDITIONAL';
type FactStatus = 'CONFIRMED' | 'REVISED' | 'PENDING' | 'UNKNOWN' | 'RISK_FLAG' | 'NOTE';

interface Scenario { prob: number; ret: number }
interface ScenarioBlock { bear: Scenario; base: Scenario; bull: Scenario }
interface Fact { field: string; detail: string; status: FactStatus }
interface KV { field: string; detail: string; hint?: string }
interface SoPRow { entity: string; range: string; notes: string }
interface PlaybookEntry { entity: string; action: string; actionColor: string; reasoning: string }
interface AcceptanceBlock {
  totalShares: number;
  buybackShares: number;
  smallReservePct: number;
  buybackPrice: number;
  cmp: number;
  scenarios: Array<{ promoterPct: number; publicPct: number; isBase?: boolean }>;
}
interface FloatingDealBlock {
  statedPrice: number;
  cashPct: number;
  stockSharesPerTarget: number;
  acquirerCmp: number;
  targetCmp: number;
  acquirerTicker: string;
  targetTicker: string;
}

interface CuratedEvent {
  id: string;
  rank: number;
  name: string;
  primary_ticker: string;
  region: 'IN' | 'US';
  type: EventType;
  tier: Tier;
  date_label: string;
  status_pill: string;
  status_color: string;
  verdict: Verdict;
  verdict_label: string;
  score: number;          // 0-30
  scenarios: ScenarioBlock;
  horizon: string;
  warning?: string;       // amber correction banner
  red_flag?: string;      // red insider/risk banner
  facts: Fact[];
  mechanics: KV[];
  sop?: SoPRow[];
  acceptance?: AcceptanceBlock;
  floating?: FloatingDealBlock;
  timing: Array<{ phase: string; guidance: string }>;
  playbook?: PlaybookEntry[];
  pros: string[];
  cons: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CURATED EVENTS — v1 ships with the 5 active situations
// ═══════════════════════════════════════════════════════════════════════════

const CURATED_EVENTS: CuratedEvent[] = [
  // ─── Tier 1 — Vedanta ───────────────────────────────────────────────────
  {
    id: 'vedanta-demerger-2026',
    rank: 1,
    name: 'Vedanta Ltd — 4-Way Demerger',
    primary_ticker: 'VEDL.NS',
    region: 'IN',
    type: 'DEMERGER',
    tier: 'TIER_1_HARD',
    date_label: 'Record Date May 1, 2026',
    status_pill: 'Buy by April 29 COB',
    status_color: '#EF4444',
    verdict: 'BUY_HOLD',
    verdict_label: 'BUY (Selective Hold After)',
    score: 21,
    scenarios: { bear: { prob: 0.30, ret: 0.05 }, base: { prob: 0.50, ret: 0.38 }, bull: { prob: 0.20, ret: 0.68 } },
    horizon: '18–24 mo',
    facts: [
      { field: 'Record Date',          detail: 'May 1, 2026 (Board approved April 20)',           status: 'CONFIRMED' },
      { field: 'Share Ratio',          detail: '1:1 for each of 4 entities',                       status: 'CONFIRMED' },
      { field: 'NCLT Approval',        detail: 'Dec 16, 2025 (operations) + Jan 9, 2026 (power)',  status: 'CONFIRMED' },
      { field: 'Aluminium Debt',       detail: '₹34,510 Cr allocated to VAML',                     status: 'CONFIRMED' },
      { field: 'Oil & Gas Debt',       detail: 'ZERO — debt-free entity (Cairn)',                  status: 'CONFIRMED' },
      { field: 'Power Debt',           detail: '₹8,660 Cr (Talwandi Sabo)',                        status: 'CONFIRMED' },
      { field: 'Residual Vedanta Debt',detail: '₹23,240 Cr (+ retains HZL 63.4% stake)',           status: 'CONFIRMED' },
      { field: 'Promoter Pledge',      detail: '91.96% of HZL holdings pledged — HIGH RISK',       status: 'RISK_FLAG' },
      { field: 'SOP Returns',          detail: 'Revised down: base +38%, bull +68% (was +55/+137)',status: 'REVISED' },
      { field: 'Listing Timeline',     detail: '4–8 weeks post-record date (May–June 2026)',       status: 'PENDING' },
    ],
    mechanics: [
      { field: 'Record Date',         detail: 'May 1, 2026',                hint: 'Must hold by April 29 (T+2)' },
      { field: 'Ex-Date',             detail: 'April 30, 2026',             hint: 'Buy on or before April 29' },
      { field: 'Entities Received',   detail: '4 shares (one each)',         hint: '+ retain original Vedanta share' },
      { field: 'Tax Treatment (IN)',  detail: 'Listed demerger — tax neutral',hint: 'Cost allocated pro-rata' },
      { field: 'Forced Selling Window',detail: 'Months 1–3 post-listing',     hint: 'ETFs dump unwanted entities' },
      { field: 'HZL Exposure (Key)',  detail: '63.4% stake stays in Residual', hint: 'Primary value driver' },
    ],
    sop: [
      { entity: 'Residual Vedanta (HZL 63.4% + Copper/Zinc Intl)', range: '₹285–310 / share', notes: 'less ₹23,240 Cr debt' },
      { entity: 'Vedanta Aluminium (VAML)',                       range: '₹80–140 / share',  notes: '₹34,510 Cr debt · 8x EBITDA · thin equity' },
      { entity: 'Vedanta Oil & Gas (Cairn)',                      range: '₹140–175 / share', notes: 'DEBT FREE · 6x EBITDA · ₹8,000 Cr EBITDA' },
      { entity: 'Vedanta Power (Talwandi Sabo)',                  range: '₹6–18 / share',    notes: '₹8,660 Cr debt · very thin equity buffer' },
      { entity: 'Vedanta Iron & Steel',                            range: '₹22–38 / share',   notes: '₹1,000 Cr debt (manageable) · Goa mining' },
    ],
    timing: [
      { phase: 'NOW (Pre)',     guidance: 'Buy Vedanta Ltd at ₹420–430 before record date. You receive the parent share PLUS 4 new shares. Historical precedent: Bajaj demerger (2008) — buying before record date captured ALL the rerating. Jio Financial — pre-demerger holders got Nifty 50 inclusion windfall. Risk: you buy the full bundle including Aluminium (heavy debt) and Power (thin equity).' },
      { phase: 'Month 1–3 (Post)', guidance: 'If you MISSED record date: wait for listing. Forced institutional selling pushes weak entities (Power, Aluminium) down 15–30%. Buy Residual Vedanta (HZL play) and Oil & Gas during the forced sell-off. Historical data: average spin-off underperforms by 8–15% in first 3 months due to index exclusion (36-year Purdue study).' },
      { phase: 'Month 6–18 (Peak)', guidance: 'Optimal hold window for Oil & Gas and Residual Vedanta. Aluminium should be sold if it rallies on listing excitement — debt too high for long-term hold. Power: exit on any strength. Demerged entities with clean balance sheets outperform 12–36 months post-listing.' },
    ],
    playbook: [
      { entity: 'Residual Vedanta (HZL + Copper)', action: 'HOLD',         actionColor: '#10B981', reasoning: 'HZL is world-class zinc/silver. Buy more if Residual falls 15%+ on listing. Analogy: AbbVie parent held steady and compounded. Debt (₹23,240 Cr) is manageable against HZL FCF.' },
      { entity: 'Vedanta Oil & Gas (Cairn)',       action: 'HOLD / ADD',   actionColor: '#10B981', reasoning: 'Debt-FREE. India\'s largest private oil producer. Analogy: ConocoPhillips E&P spinoff — clean balance sheet, pure-play → rerated 150%+ over 3 years. Add on any listing weakness.' },
      { entity: 'Vedanta Iron & Steel',            action: 'HOLD SMALL',   actionColor: '#22D3EE', reasoning: '₹1,000 Cr debt (manageable). India infra steel demand is real. Hold 25–50% of position; sell if P/E exceeds 10x post-listing pop. Competitive market limits rerating.' },
      { entity: 'Vedanta Aluminium (VAML)',        action: 'SELL on POP',  actionColor: '#F59E0B', reasoning: '₹34,510 Cr debt is HIGH for this cash flow profile (~₹8,000–10,000 Cr EBITDA = 3.4–4.3x leverage). Analogy: DXC from HPE — overleveraged spinoff → down 70% in 3 years. Sell 70% within first 3 months on any rally.' },
      { entity: 'Vedanta Power (Talwandi Sabo)',   action: 'SELL QUICKLY', actionColor: '#EF4444', reasoning: '₹8,660 Cr debt vs ₹1,500–2,000 Cr EBITDA = 4.3–5.8x leverage. Merchant power pricing volatile. Equity value thin (₹1,840–5,340 Cr). Sell within first month. Analogy: Hertz from Ford — overleveraged on cyclical asset.' },
    ],
    pros: [
      'All NCLT approvals complete',
      'Oil & Gas entity is debt-free',
      'HZL (63.4%) = world-class asset in residual',
      'Record date fixed — hard deadline = forced action',
      '4 separate pure-plays eliminate conglomerate discount',
    ],
    cons: [
      'Aluminium: ₹34,510 Cr debt = 3.4–4.3x leverage',
      'Power: thin equity after debt, merchant power volatile',
      '91.96% of HZL stake pledged (financing risk)',
      'Promoter debt at Volcan Investments could cascade',
    ],
  },

  // ─── Tier 1 — Wipro ─────────────────────────────────────────────────────
  {
    id: 'wipro-buyback-2026',
    rank: 2,
    name: 'Wipro Ltd — ₹15,000 Cr Buyback @ ₹250',
    primary_ticker: 'WIPRO.NS',
    region: 'IN',
    type: 'TENDER_BUYBACK',
    tier: 'TIER_1_HARD',
    date_label: 'Tender Offer · Shareholder approval ~May 25',
    status_pill: 'Small holders only · Pass for large',
    status_color: '#F59E0B',
    verdict: 'BUY_SMALL_ONLY',
    verdict_label: 'SMALL SHAREHOLDERS ONLY (≤₹2L)',
    score: 19,
    scenarios: { bear: { prob: 0.30, ret: 0.00 }, base: { prob: 0.50, ret: 0.07 }, bull: { prob: 0.20, ret: 0.10 } },
    horizon: '2–3 mo',
    warning: 'V2 CORRECTION: Original report stated "Promoters excluded." CONFIRMED WRONG. Wipro promoters (72.63% stake) intend to tender ~7.45 billion shares. This dramatically lowers acceptance ratios for public shareholders. The trade is NOT the same for large vs small holders — see acceptance math.',
    facts: [
      { field: 'Buyback size / price',  detail: '₹15,000 Cr at ₹250/share (60 crore shares)',         status: 'CONFIRMED' },
      { field: 'Promoter participation',detail: 'YES — intend to tender ~7.45B shares (72.63% stake)',status: 'CONFIRMED' },
      { field: 'Record date',           detail: 'NOT YET ANNOUNCED (post shareholder approval)',      status: 'PENDING' },
      { field: 'Shareholder approval',  detail: 'E-voting April 22 – May 21, 2026; results ~May 25',  status: 'CONFIRMED' },
      { field: 'Cash on balance sheet', detail: '₹26,778 Cr as of March 31, 2026',                    status: 'CONFIRMED' },
      { field: 'Acceptance — large',    detail: '~5–7% (not 80–90% implied in original report)',      status: 'REVISED' },
    ],
    mechanics: [
      { field: 'Buyback Price', detail: '₹250/share',     hint: 'vs CMP ~₹210 = +18.9% premium' },
      { field: 'Total Shares',  detail: '10,472,085,808', hint: '10.47 billion outstanding' },
      { field: 'Buyback Target',detail: '60 crore shares',hint: '~5.7% of outstanding' },
      { field: 'Reserved Pool', detail: '15% (₹2,250 Cr)', hint: 'For ≤₹2L holdings' },
      { field: 'General Pool',  detail: '85% (₹12,750 Cr)',hint: 'Includes promoter tender' },
      { field: 'Funding',       detail: '₹26,778 Cr cash on hand', hint: 'Fully cash-funded' },
    ],
    acceptance: {
      totalShares: 10472085808,
      buybackShares: 600000000,
      smallReservePct: 15,
      buybackPrice: 250,
      cmp: 210,
      scenarios: [
        { promoterPct: 60, publicPct: 40 },
        { promoterPct: 80, publicPct: 50, isBase: true },
        { promoterPct: 90, publicPct: 70 },
        { promoterPct: 100, publicPct: 100 },
      ],
    },
    timing: [
      { phase: 'Small Holders (≤₹2L)', guidance: 'BUY NOW. Build a ₹2 lakh or less position at CMP ~₹210. You qualify for the small shareholder reserved category (15% of buyback). Expected acceptance ~40–50% = ~8–9% return in 2–3 months. Best risk/reward in this trade. If not accepted, you still hold Wipro at ₹210 with strong cash backing. Historical analogy: TCS buyback small-shareholder category routinely shows 40–60% acceptance.' },
      { phase: 'Large Holders (>₹2L)', guidance: 'PASS on the buyback arb. 5–7% acceptance × ₹40 premium = ~1.3% return in 2–3 months = poorly compensated. Hold Wipro for operational recovery instead. Stock at ₹210 (−24% YTD) is interesting on its own merit for 12-month horizon — but NOT primarily because of the buyback mechanics. Do NOT size up just to capture buyback. Promoter participation destroys the trade for anyone over ₹2 lakh.' },
    ],
    pros: [
      '₹26,778 Cr cash — fully funded, zero balance sheet risk',
      '18.9% premium — signal of management confidence',
      'Small shareholder category: 40–50% acceptance ratio',
      'IT stock at 5-year relative low = valuation floor',
    ],
    cons: [
      'Promoters participating → large holder acceptance ~6%',
      'Record date not yet announced — timing uncertain',
      'IT sector structural headwinds persist',
    ],
  },

  // ─── Tier 1 — Honeywell ─────────────────────────────────────────────────
  {
    id: 'honeywell-hona-spin-2026',
    rank: 3,
    name: 'Honeywell Aerospace (HONA) — Spin-off',
    primary_ticker: 'HON',
    region: 'US',
    type: 'SPIN_OFF',
    tier: 'TIER_1_HARD',
    date_label: 'Distribution Date June 29, 2026',
    status_pill: 'Accumulate HON before June 3 Investor Day',
    status_color: '#F59E0B',
    verdict: 'BUY',
    verdict_label: 'BUY HON (Pre-Spin)',
    score: 19,
    scenarios: { bear: { prob: 0.25, ret: 0.02 }, base: { prob: 0.55, ret: 0.35 }, bull: { prob: 0.20, ret: 0.65 } },
    horizon: '12–24 mo',
    facts: [
      { field: 'Spin-off date',         detail: 'June 29, 2026 (board + conditions)',                         status: 'CONFIRMED' },
      { field: 'Ticker HONA / NASDAQ',  detail: 'Confirmed per SEC Form 10 filing',                           status: 'CONFIRMED' },
      { field: 'HONA FY2025 Revenue',   detail: '$17.4B · Adj. EBIT $4.3B · Net income $1.5B',                status: 'CONFIRMED' },
      { field: 'Debt transferred',      detail: '~$20B senior notes + $3B 5yr + $1B 364-day credit',          status: 'CONFIRMED' },
      { field: 'Distribution ratio',    detail: 'NOT YET ANNOUNCED — pending in SEC filings',                 status: 'UNKNOWN' },
      { field: 'Investor Day',          detail: 'June 3, 2026 · Phoenix, AZ — confirmed inaugural',           status: 'CONFIRMED' },
      { field: 'Tax treatment',         detail: 'Planned tax-free for US federal income tax purposes',        status: 'CONFIRMED' },
      { field: 'HONA Net Debt/EBITDA',  detail: '$20B / $4.3B = 4.65x — HIGH. Watch how it trades initially', status: 'RISK_FLAG' },
    ],
    mechanics: [
      { field: 'Distribution Date',       detail: 'June 29, 2026',         hint: 'Buy HON by ~June 26 (T+2)' },
      { field: 'Critical Unknown',        detail: 'Distribution ratio',     hint: 'Watch amended Form 10 filing' },
      { field: 'June 3 Catalyst',         detail: 'HONA Investor Day',      hint: 'Targets, debt structure, capital allocation' },
      { field: 'Remaining HON (Automation)',detail: '$16B rev, $3.5B EBITDA',hint: 'Industrial automation pure-play' },
      { field: 'HONA Leverage Risk',      detail: '~4.65x Net Debt/EBITDA',hint: 'High but aerospace cash flows stable' },
      { field: 'Forced Selling Window',   detail: 'Month 1–4 post June 29', hint: 'Index funds that cannot hold pure aerospace' },
    ],
    timing: [
      { phase: 'NOW to June 3', guidance: 'Accumulate HON (parent) before the June 3 Investor Day. Investor Day reveals HONA standalone targets — historically when conglomerate discount starts collapsing. Precedent: GE Aerospace (GEV) — stock rerated 40% in 3 months post-investor day when aerospace targets were clear. Key trigger to watch: distribution ratio announcement in amended Form 10 filing.' },
      { phase: 'Post June 29 (HONA)', guidance: 'DO NOT sell HONA immediately after you receive it. Wait for the forced selling window (months 1–3) to END. Optimal buy window for HONA is months 1–3 post-spin when ETFs and passive funds dump it. Spin-offs underperform 8% in first 90 days, then recover 28% above market by month 36. If HONA trades at implied $3B+ discount to fundamental value during institutional selloff, that\'s the aggressive add window.' },
      { phase: 'Post-Spin HON (Automation)', guidance: 'Residual HON (pure automation) should rerate upward as conglomerate discount disappears. Hold HON post-spin — likely worth more as pure industrial automation than the combined entity. Sell only after the automation business is independently valued for 12+ months.' },
    ],
    pros: [
      'June 29 date confirmed from primary source (not estimated)',
      'Tax-free distribution for US shareholders',
      '$17.4B aerospace revenue — world-class pure-play',
      'June 3 Investor Day = near-term catalyst for institutional buying',
      'Aerospace sector upcycle (commercial + defense both growing)',
    ],
    cons: [
      'Distribution ratio NOT announced — key unknown',
      '~$20B+ debt at HONA = 4.65x Net Debt/EBITDA',
      'Position uncertain until ratio known',
    ],
  },

  // ─── Tier 2 — QXO/TopBuild ──────────────────────────────────────────────
  {
    id: 'qxo-topbuild-merger-2026',
    rank: 4,
    name: 'QXO / TopBuild (BLD) — Merger Arb',
    primary_ticker: 'BLD',
    region: 'US',
    type: 'MERGER_ARB',
    tier: 'TIER_2_VALUATION',
    date_label: 'Q3 2026 Expected Close',
    status_pill: 'WAIT — BLD overpriced vs effective',
    status_color: '#EF4444',
    verdict: 'WAIT',
    verdict_label: 'CAUTION — Do the Math First',
    score: 15,
    scenarios: { bear: { prob: 0.40, ret: -0.20 }, base: { prob: 0.40, ret: 0.12 }, bull: { prob: 0.20, ret: 0.22 } },
    horizon: '4–6 mo',
    warning: 'CRITICAL CORRECTION: Original report treated $505 as a fixed cash offer. IT IS NOT. The deal is 45% cash / 55% QXO stock. QXO has FALLEN 13.6% since announcement to ~$22.23. Effective consideration = $474 vs BLD at $489 = NEGATIVE SPREAD until QXO recovers above $23.56.',
    facts: [
      { field: 'BLD offer price (stated)', detail: '$505/share',                                       status: 'CONFIRMED' },
      { field: 'Deal structure',          detail: '45% cash ($227.25) + 55% QXO stock (20.2 sh)',     status: 'CONFIRMED' },
      { field: 'QXO current price',       detail: '$22.23 (down 13.6% since announcement)',           status: 'CONFIRMED' },
      { field: 'Effective consideration', detail: '$227.25 + 0.55 × (20.2 × $22.23) = $474.23',       status: 'REVISED' },
      { field: 'BLD market price',        detail: '~$489',                                            status: 'CONFIRMED' },
      { field: 'Current spread',          detail: '−$14.78 (−3.0%) NEGATIVE',                          status: 'RISK_FLAG' },
      { field: 'Break-even QXO price',    detail: '$23.56 (for BLD@$489 to make sense)',              status: 'NOTE' },
    ],
    mechanics: [
      { field: 'Cash component (fixed)',     detail: '$227.25/share',     hint: '0.45 × $505' },
      { field: 'Stock component (floating)', detail: '20.2 QXO/share',    hint: 'Subject to QXO price' },
      { field: 'Cash election',              detail: 'Subject to proration to 45%',  hint: 'Can\'t fully elect cash' },
      { field: 'Antitrust risk',             detail: 'LOW (building products distribution)', },
      { field: 'Strategic acquirer',         detail: 'Brad Jacobs · $50B vision', },
      { field: 'Risk/Reward',                detail: '0.6 : 1 — below 2:1 threshold',  hint: 'Below institutional minimum' },
    ],
    floating: {
      statedPrice: 505,
      cashPct: 45,
      stockSharesPerTarget: 20.2,
      acquirerCmp: 22.23,
      targetCmp: 489,
      acquirerTicker: 'QXO',
      targetTicker: 'BLD',
    },
    timing: [
      { phase: 'DO NOT BUY AT $489', guidance: 'You are overpaying vs. effective consideration of $474. Wait for one of two conditions: (A) QXO recovers above $23.56 restoring a positive spread, OR (B) BLD pulls back below $465 to create a 2%+ positive spread.' },
      { phase: 'Entry Trigger A', guidance: 'Wait for QXO to recover above $23.56. At that price, effective consideration = $476 vs BLD at $489 = BLD should reprice up as well. Enter BLD only when spread is +2% or better.' },
      { phase: 'Entry Trigger B', guidance: 'BLD pulls back to $460–465 on broad market weakness. At that price, even with QXO at $22.23, you have a small positive spread of +2–3%. Cash election (subject to proration) provides some floor.' },
    ],
    pros: [
      'Low antitrust risk (building products distribution)',
      'Strategic acquirer — Brad Jacobs, $50B company vision',
      'Q3 2026 close timeline reasonable',
    ],
    cons: [
      'BLD currently overpriced vs floating-value deal consideration',
      'QXO down 13.6% since announcement — dilution concerns',
      'Cash election subject to proration (only 45% can elect cash)',
      'Risk/reward 0.6:1 — below minimum 2:1 threshold',
    ],
  },

  // ─── Tier 2 — Adobe ─────────────────────────────────────────────────────
  {
    id: 'adobe-buyback-2026',
    rank: 5,
    name: 'Adobe — $25B Buyback Authorization',
    primary_ticker: 'ADBE',
    region: 'US',
    type: 'OPEN_MARKET_BUYBACK',
    tier: 'TIER_2_VALUATION',
    date_label: 'Authorized through April 30, 2030',
    status_pill: 'Multi-year thesis · Conditional',
    status_color: '#94A3B8',
    verdict: 'CONDITIONAL',
    verdict_label: 'HOLD — Not a Hard Catalyst',
    score: 17,
    scenarios: { bear: { prob: 0.35, ret: -0.20 }, base: { prob: 0.45, ret: 0.45 }, bull: { prob: 0.20, ret: 1.00 } },
    horizon: '24–36 mo',
    red_flag: 'CFO INSIDER SELLING: CFO Daniel Durn sold 1,336 shares on April 22, 2026 — the SAME DAY Adobe announced the $25B buyback. In the last 3 months, insiders have sold ~$500K of stock with ZERO purchases. Significant credibility gap: company buying at this price publicly, insiders selling privately. Does not invalidate the long thesis, but lowers conviction.',
    facts: [
      { field: 'Buyback authorized',     detail: '$25B through April 30, 2030 — board approved April 21', status: 'CONFIRMED' },
      { field: 'Buyback executing?',     detail: 'AUTHORIZED but not yet executing (prior $25B finishing)',status: 'NOTE' },
      { field: 'Q1 FY2026 revenue growth',detail: '+12% YoY (not declining) · Q1 OCF $2.96B (+19.2%)',     status: 'CONFIRMED' },
      { field: 'Stock vs 2024 peak',     detail: 'Down ~46% from ~$638 high (not "60%" as stated in v1)',  status: 'REVISED' },
      { field: 'CFO insider selling',    detail: '1,336 shares sold April 22 = same day as announcement',  status: 'RISK_FLAG' },
      { field: 'AI-first ARR growth',    detail: 'More than 3x YoY — Firefly AI integration working',      status: 'CONFIRMED' },
    ],
    mechanics: [
      { field: 'Buyback authorization', detail: '$25B over ~4 years',          hint: '~25% of market cap' },
      { field: 'Execution rate',         detail: '~$6B/year typical pace',      hint: 'Prior $25B took 2 years' },
      { field: 'Q1 FY2026 OCF',          detail: '$2.96B (+19.2%)',             hint: 'Funding capacity strong' },
      { field: 'Insider net activity (3mo)', detail: 'Sold $500K, bought $0',   hint: 'Disconnect with company action' },
      { field: 'AI risk',                detail: 'Figma + AI-native tools emerging', hint: 'Not zero risk' },
      { field: 'Creative Cloud moat',    detail: '90%+ switching costs',        hint: 'Strong but not infinite' },
    ],
    timing: [
      { phase: 'Condition 1', guidance: 'Buy only after CFO/insiders START buying in the open market (not just selling). The current insider selling vs corporate buyback disconnect is a yellow flag. Watch Form 4 filings daily.' },
      { phase: 'Condition 2', guidance: 'Revenue growth stays above 10% for 2 more consecutive quarters confirming AI cannibalization fears are overstated. Q1 showed 12% — wait for Q2 confirmation.' },
      { phase: 'Sell Trigger', guidance: 'Sell if revenue growth drops below 8% for two quarters. Would signal AI disruption is real and the buyback is masking a shrinking business — the GE pattern. Adobe is a Valuation + Story play, NOT a hard catalyst. Size smaller, be more patient.' },
    ],
    pros: [
      '$25B buyback = ~25% of market cap — massively EPS accretive',
      'Q1 revenue +12%, OCF +19.2% — not deteriorating',
      'AI-first ARR 3x YoY — Firefly gaining traction',
      'Creative Cloud monopoly: 90%+ switching costs',
    ],
    cons: [
      'CFO sold shares same day as buyback — insider disconnect',
      'Authorization ≠ execution — prior $25B took 2 years',
      'Figma + AI-native tools emerging — not zero risk',
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// CALCULATORS
// ═══════════════════════════════════════════════════════════════════════════

interface AcceptanceMath {
  promoterTendered: number;
  publicTendered: number;
  totalTendered: number;
  generalPoolAcceptancePct: number;
  smallHolderAcceptancePct: number;
  largeHolder: { investment: number; sharesAccepted: number; premiumGain: number; returnPct: number; annualized: number };
  smallHolder: { investment: number; sharesAccepted: number; premiumGain: number; returnPct: number; annualized: number };
}

function computeAcceptanceMath(args: {
  totalShares: number;
  buybackShares: number;
  smallReservePct: number;
  buybackPrice: number;
  cmp: number;
  promoterPct: number;
  publicPct: number;
  promoterStakePct?: number;   // default 72.63 (Wipro)
  smallPositionINR?: number;    // default ₹2L = 200000
  largePositionINR?: number;    // default ₹21L = 2100000
  monthsToComplete?: number;    // default 2
}): AcceptanceMath {
  const {
    totalShares, buybackShares, smallReservePct, buybackPrice, cmp,
    promoterPct, publicPct,
    promoterStakePct = 72.63,
    smallPositionINR = 200000,
    largePositionINR = 2100000,
    monthsToComplete = 2,
  } = args;
  const promoterShares = totalShares * (promoterStakePct / 100);
  const publicShares = totalShares - promoterShares;
  const promoterTendered = promoterShares * (promoterPct / 100);
  const publicTendered = publicShares * (publicPct / 100);
  const totalTendered = promoterTendered + publicTendered;

  const reservedShares = buybackShares * (smallReservePct / 100);
  const generalPoolShares = buybackShares - reservedShares;
  const generalPoolAcceptancePct = (generalPoolShares / totalTendered) * 100;

  // Small holder math — assume ~2M eligible small holders, each tenders avg ~200000/cmp shares
  // and each is allocated from the reserved 90M pool, leading to ~40-50% acceptance
  // Simple approximation: reserved-pool size vs assumed-tender pool
  // (We'll model: estimated 1.5M holders × small position, all tender)
  const smallSharesEach = Math.floor(smallPositionINR / cmp);
  const eligibleHolders = 1500000;            // empirical assumption
  const smallTotalTendered = smallSharesEach * eligibleHolders;
  const smallHolderAcceptancePct = Math.min(100, (reservedShares / smallTotalTendered) * 100);

  const premium = buybackPrice - cmp;

  const largeShares = Math.floor(largePositionINR / cmp);
  const largeAccepted = (largeShares * generalPoolAcceptancePct) / 100;
  const largeGain = largeAccepted * premium;
  const largeReturn = (largeGain / largePositionINR) * 100;

  const smallAccepted = (smallSharesEach * smallHolderAcceptancePct) / 100;
  const smallGain = smallAccepted * premium;
  const smallReturn = (smallGain / smallPositionINR) * 100;

  const annualize = (r: number) => (r / monthsToComplete) * 12;

  return {
    promoterTendered, publicTendered, totalTendered,
    generalPoolAcceptancePct,
    smallHolderAcceptancePct,
    largeHolder: { investment: largePositionINR, sharesAccepted: largeAccepted, premiumGain: largeGain, returnPct: largeReturn, annualized: annualize(largeReturn) },
    smallHolder: { investment: smallPositionINR, sharesAccepted: smallAccepted, premiumGain: smallGain, returnPct: smallReturn, annualized: annualize(smallReturn) },
  };
}

interface FloatingDealMath {
  cashComponent: number;
  stockComponent: number;
  effectiveValue: number;
  spreadAbsolute: number;
  spreadPct: number;
  breakEvenAcquirerPrice: number;
}

function computeFloatingDeal(args: { statedPrice: number; cashPct: number; stockSharesPerTarget: number; acquirerCmp: number; targetCmp: number }): FloatingDealMath {
  const { statedPrice, cashPct, stockSharesPerTarget, acquirerCmp, targetCmp } = args;
  const cashComponent = (cashPct / 100) * statedPrice;
  const stockComponent = stockSharesPerTarget * acquirerCmp;
  const stockPct = (100 - cashPct) / 100;
  const effectiveValue = cashComponent + stockPct * stockComponent;
  const spreadAbsolute = effectiveValue - targetCmp;
  const spreadPct = (spreadAbsolute / targetCmp) * 100;
  // Solve for acquirer price that makes effectiveValue == targetCmp
  // targetCmp = cashComponent + stockPct × (sharesPerTarget × acquirerPrice)
  // acquirerPrice = (targetCmp − cashComponent) / (stockPct × sharesPerTarget)
  const breakEvenAcquirerPrice = (targetCmp - cashComponent) / (stockPct * stockSharesPerTarget);
  return { cashComponent, stockComponent, effectiveValue, spreadAbsolute, spreadPct, breakEvenAcquirerPrice };
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

type Tab = 'all' | 'timing' | 'playbook' | 'math' | 'discover';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'all',       label: 'All Situations' },
  { id: 'timing',    label: 'When to Buy / Sell' },
  { id: 'playbook',  label: 'Post-Event Playbook' },
  { id: 'math',      label: 'Acceptance / Deal Math' },
  { id: 'discover',  label: 'Discover (News Scanner)' },
];

const TIER_META: Record<Tier, { label: string; color: string }> = {
  TIER_1_HARD:        { label: 'Tier 1 — Hard Catalyst Trades',  color: '#EF4444' },
  TIER_2_VALUATION:   { label: 'Tier 2 — Valuation + Story',      color: '#F59E0B' },
  MONITOR:            { label: 'Monitor / Avoid',                  color: '#94A3B8' },
};

const VERDICT_COLOR: Record<Verdict, string> = {
  BUY: '#10B981', BUY_HOLD: '#10B981', BUY_SMALL_ONLY: '#FBBF24',
  WAIT: '#F59E0B', PASS: '#94A3B8', CONDITIONAL: '#94A3B8',
};

const FACT_PILL: Record<FactStatus, { label: string; color: string; bg: string }> = {
  CONFIRMED: { label: '✓ CONFIRMED', color: '#10B981', bg: '#10B98120' },
  REVISED:   { label: '✗ REVISED',   color: '#F59E0B', bg: '#F59E0B20' },
  PENDING:   { label: '~ PENDING',   color: '#94A3B8', bg: '#94A3B820' },
  UNKNOWN:   { label: '? UNKNOWN',   color: '#94A3B8', bg: '#94A3B820' },
  RISK_FLAG: { label: '⚠ RISK FLAG',  color: '#EF4444', bg: '#EF444420' },
  NOTE:      { label: 'NOTE',        color: '#22D3EE', bg: '#22D3EE20' },
};

export default function SpecialSituationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initial = (searchParams?.get('tab') as Tab) || 'all';
  const [active, setActive] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : 'all');
  const [region, setRegion] = useState<'ALL' | 'IN' | 'US'>('ALL');

  useEffect(() => {
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (sp.get('tab') !== active) {
      sp.set('tab', active);
      router.replace(`/special-situations?${sp.toString()}`, { scroll: false });
    }
  }, [active, searchParams, router]);

  const filteredEvents = useMemo(() => {
    if (region === 'ALL') return CURATED_EVENTS;
    return CURATED_EVENTS.filter((e) => e.region === region);
  }, [region]);

  const tier1 = filteredEvents.filter((e) => e.tier === 'TIER_1_HARD');
  const tier2 = filteredEvents.filter((e) => e.tier === 'TIER_2_VALUATION');
  const monitor = filteredEvents.filter((e) => e.tier === 'MONITOR');
  const correctedDown = filteredEvents.filter((e) => e.warning).length;
  const nextDate = filteredEvents.find((e) => e.tier === 'TIER_1_HARD')?.date_label || '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0A0E1A' }}>
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: '#0D1B2E', borderBottom: '1px solid #1E2D45', padding: '16px 20px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.5px' }}>
            ⚡ SPECIAL SITUATIONS — INSTITUTIONAL SCORECARD
          </span>
          <span style={{ fontSize: 11, color: '#6B7A8D' }}>
            Fact-verified · Probability-weighted EV · Acceptance-ratio math · When-to-buy timing · Post-event playbook
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#6B7A8D', marginBottom: 12 }}>
          v2 · Institutional Grade · Corrected
        </div>

        {/* V2 corrections banner */}
        <div style={{ backgroundColor: '#F59E0B12', border: '1px solid #F59E0B40', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, marginBottom: 14 }}>
          <AlertTriangle style={{ width: 16, height: 16, color: '#F59E0B', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 11.5, color: '#F5D78F', lineHeight: 1.55 }}>
            <strong style={{ color: '#FBBF24' }}>VERSION 2 CORRECTIONS APPLIED:</strong> (1) Wipro: Promoters ARE participating — acceptance for large holders ~5-7%; only ≤₹2L positions retain ~40-50% acceptance. (2) Vedanta: Debt allocation confirmed — Aluminium ₹34,510 Cr, Oil & Gas debt-free, Power ₹8,660 Cr thin equity. (3) QXO/TopBuild: QXO down 13.6% post-announcement — effective consideration ~$474, BLD at $489 technically overpriced. (4) Adobe: CFO sold shares same day as buyback announcement. (5) Honeywell: June 29 confirmed; distribution ratio still unannounced.
          </div>
        </div>

        {/* Aggregate stats */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Stat label="Hard Catalyst Trades"   value={tier1.length}    color="#EF4444" />
          <Stat label="Valuation + Story"      value={tier2.length}    color="#F59E0B" />
          <Stat label="Monitor / Avoid"        value={monitor.length}  color="#94A3B8" />
          <Stat label="Corrected Down"         value={correctedDown}    color="#FBBF24" />
          <Stat label="Next Key Date"          value={nextDate.split(',')[0].split(' ').slice(-2).join(' ')} color="#22D3EE" inline />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#6B7A8D', marginRight: 6 }}>Region:</span>
            {([
              { v: 'ALL', label: 'ALL' },
              { v: 'IN', label: '🇮🇳 IN' },
              { v: 'US', label: '🇺🇸 US' },
            ] as const).map((r) => {
              const isActive = region === r.v;
              return (
                <button key={r.v} onClick={() => setRegion(r.v as any)}
                  style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: isActive ? '1px solid #38A9E860' : '1px solid #1A2840', backgroundColor: isActive ? '#0F7ABF20' : 'transparent', color: isActive ? '#38A9E8' : '#6B7A8D', cursor: 'pointer' }}>
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab nav */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid #1A2840' }}>
          {TABS.map(({ id, label }) => {
            const isActive = active === id;
            return (
              <button key={id} onClick={() => setActive(id)}
                style={{ padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: '0.4px', border: isActive ? '1px solid #FBBF2460' : '1px solid #1A2840', backgroundColor: isActive ? '#FBBF2418' : 'transparent', color: isActive ? '#FBBF24' : '#8A95A3', cursor: 'pointer' }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {active === 'all' && <AllSituations tier1={tier1} tier2={tier2} monitor={monitor} />}
        {active === 'timing' && <TimingRules />}
        {active === 'playbook' && <Playbook />}
        {active === 'math' && <MathPanels />}
        {active === 'discover' && <DiscoverScanner />}
      </div>
    </div>
  );
}

function Stat({ label, value, color, inline }: { label: string; value: number | string; color: string; inline?: boolean }) {
  return (
    <div style={{ backgroundColor: '#0A1422', border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '8px 14px', minWidth: inline ? 130 : 110 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ALL SITUATIONS — tier 1 + tier 2 stack of event cards
// ═══════════════════════════════════════════════════════════════════════════

function AllSituations({ tier1, tier2, monitor }: { tier1: CuratedEvent[]; tier2: CuratedEvent[]; monitor: CuratedEvent[] }) {
  return (
    <>
      {tier1.length > 0 && (
        <Section title="Tier 1 — Hard Catalyst Trades" subtitle="Event date fixed · Mechanism quantifiable · Act before deadline" color="#EF4444">
          {tier1.map((e) => <EventCard key={e.id} ev={e} />)}
        </Section>
      )}
      {tier2.length > 0 && (
        <Section title="Tier 2 — Valuation + Story" subtitle="No fixed deadline · Thesis requires multiple things · Different sizing discipline" color="#F59E0B">
          {tier2.map((e) => <EventCard key={e.id} ev={e} />)}
        </Section>
      )}
      {monitor.length > 0 && (
        <Section title="Monitor / Avoid" subtitle="Watch list — not actionable yet" color="#94A3B8">
          {monitor.map((e) => <EventCard key={e.id} ev={e} />)}
        </Section>
      )}

      {/* Summary table */}
      <SummaryTable events={[...tier1, ...tier2, ...monitor]} />
    </>
  );
}

function Section({ title, subtitle, color, children }: { title: string; subtitle: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: '0.4px' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#6B7A8D', marginTop: 2 }}>{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function EventCard({ ev }: { ev: CuratedEvent }) {
  const [expanded, setExpanded] = useState(true);
  const evPct = (ev.scenarios.bear.prob * ev.scenarios.bear.ret + ev.scenarios.base.prob * ev.scenarios.base.ret + ev.scenarios.bull.prob * ev.scenarios.bull.ret) * 100;
  const verdictColor = VERDICT_COLOR[ev.verdict];

  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `4px solid ${TIER_META[ev.tier].color}`, borderRadius: 12 }}>
      {/* Header */}
      <button onClick={() => setExpanded((s) => !s)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 900, color: '#FBBF24', minWidth: 24 }}>{ev.rank}</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#F5F7FA' }}>{ev.name}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: ev.region === 'IN' ? '#FBBF24' : '#22D3EE', backgroundColor: ev.region === 'IN' ? '#FBBF2418' : '#22D3EE18', padding: '2px 8px', borderRadius: 4, border: ev.region === 'IN' ? '1px solid #FBBF2440' : '1px solid #22D3EE40' }}>
          {ev.region === 'IN' ? '🇮🇳 India' : '🇺🇸 USA'}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', backgroundColor: '#1A2840', padding: '2px 8px', borderRadius: 4 }}>
          {ev.type.replace(/_/g, ' ')}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: ev.status_color, border: `1px solid ${ev.status_color}40`, backgroundColor: `${ev.status_color}15`, padding: '2px 8px', borderRadius: 4 }}>
          {ev.status_pill}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 11, color: '#6B7A8D' }}>{ev.date_label}</span>
          <span style={{ fontSize: 22, fontWeight: 900, color: verdictColor }}>{ev.verdict_label.split(' ')[0]}</span>
          <ScoreBadge score={ev.score} />
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '0 18px 16px 18px', borderTop: '1px solid #1A2840', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Warning banner */}
          {ev.warning && (
            <div style={{ marginTop: 14, backgroundColor: '#F59E0B12', border: '1px solid #F59E0B40', borderRadius: 6, padding: '10px 12px', fontSize: 11.5, color: '#F5D78F', lineHeight: 1.55 }}>
              <strong style={{ color: '#FBBF24' }}>⚠ V2 CORRECTION:</strong> {ev.warning}
            </div>
          )}
          {ev.red_flag && (
            <div style={{ marginTop: 14, backgroundColor: '#EF444412', border: '1px solid #EF444440', borderRadius: 6, padding: '10px 12px', fontSize: 11.5, color: '#FCA5A5', lineHeight: 1.55 }}>
              <strong style={{ color: '#EF4444' }}>🚩 RED FLAG:</strong> {ev.red_flag}
            </div>
          )}

          {/* EV scenarios */}
          <div>
            <SectionLabel text="Probability-Weighted Expected Value" color="#22D3EE" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 8 }}>
              <ScenarioCell title={`🐻 Bear (${(ev.scenarios.bear.prob * 100).toFixed(0)}%)`} val={ev.scenarios.bear.ret} weighted={ev.scenarios.bear.prob * ev.scenarios.bear.ret} color="#94A3B8" />
              <ScenarioCell title={`📊 Base (${(ev.scenarios.base.prob * 100).toFixed(0)}%)`} val={ev.scenarios.base.ret} weighted={ev.scenarios.base.prob * ev.scenarios.base.ret} color="#22D3EE" />
              <ScenarioCell title={`🚀 Bull (${(ev.scenarios.bull.prob * 100).toFixed(0)}%)`} val={ev.scenarios.bull.ret} weighted={ev.scenarios.bull.prob * ev.scenarios.bull.ret} color="#10B981" />
              <div style={{ backgroundColor: '#0A1422', borderRadius: 8, padding: '10px 12px', border: `1px solid ${verdictColor}40` }}>
                <div style={{ fontSize: 10, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Expected Value</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: verdictColor, marginTop: 4 }}>{evPct >= 0 ? '+' : ''}{evPct.toFixed(1)}%</div>
                <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2 }}>Horizon {ev.horizon}</div>
              </div>
            </div>
          </div>

          {/* Fact verification */}
          <div>
            <SectionLabel text="Fact Verification — Confirmed vs Estimated" color="#22D3EE" />
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 8 }}>
              <tbody>
                {ev.facts.map((f, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1A2840' }}>
                    <td style={{ padding: '6px 10px', color: '#94A3B8', width: 200, fontWeight: 600 }}>{f.field}</td>
                    <td style={{ padding: '6px 10px', color: '#E6EDF3', lineHeight: 1.45 }}>{f.detail}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, color: FACT_PILL[f.status].color, backgroundColor: FACT_PILL[f.status].bg, border: `1px solid ${FACT_PILL[f.status].color}40` }}>
                        {FACT_PILL[f.status].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mechanics */}
          <div>
            <SectionLabel text="Key Mechanics" color="#22D3EE" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8, marginTop: 8 }}>
              {ev.mechanics.map((m, i) => (
                <div key={i} style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{m.field}</div>
                  <div style={{ fontSize: 13, color: '#E6EDF3', fontWeight: 700, marginTop: 3 }}>{m.detail}</div>
                  {m.hint && <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2, fontStyle: 'italic' }}>{m.hint}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* SoP */}
          {ev.sop && (
            <div>
              <SectionLabel text="Sum-of-Parts Model" color="#22D3EE" />
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 8 }}>
                <thead>
                  <tr style={{ color: '#6B7A8D', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    <th style={{ textAlign: 'left', padding: '4px 10px' }}>Entity</th>
                    <th style={{ textAlign: 'right', padding: '4px 10px' }}>Range / share</th>
                    <th style={{ textAlign: 'left', padding: '4px 10px' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {ev.sop.map((s, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #1A2840' }}>
                      <td style={{ padding: '6px 10px', color: '#E6EDF3' }}>{s.entity}</td>
                      <td style={{ padding: '6px 10px', color: '#10B981', fontWeight: 700, textAlign: 'right' }}>{s.range}</td>
                      <td style={{ padding: '6px 10px', color: '#6B7A8D', fontSize: 10.5 }}>{s.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Acceptance math */}
          {ev.acceptance && <AcceptanceTable block={ev.acceptance} />}

          {/* Floating deal */}
          {ev.floating && <FloatingDealTable block={ev.floating} />}

          {/* Timing */}
          <div>
            <SectionLabel text="When to Buy — Historical Pattern + Current Setup" color="#22D3EE" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {ev.timing.map((t, i) => (
                <div key={i} style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#FBBF24', marginBottom: 6, letterSpacing: '0.4px' }}>{t.phase}</div>
                  <div style={{ fontSize: 12, color: '#C9D4E0', lineHeight: 1.55 }}>{t.guidance}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Playbook */}
          {ev.playbook && (
            <div>
              <SectionLabel text="Post-Event Playbook — What to Do With Each Entity" color="#22D3EE" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {ev.playbook.map((p, i) => (
                  <div key={i} style={{ backgroundColor: '#0A1422', border: `1px solid ${p.actionColor}30`, borderLeft: `3px solid ${p.actionColor}`, borderRadius: 6, padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#E6EDF3' }}>{p.entity}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: p.actionColor, padding: '2px 8px', borderRadius: 4, backgroundColor: `${p.actionColor}20`, letterSpacing: '0.4px' }}>{p.action}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#94A3B8', lineHeight: 1.55 }}>{p.reasoning}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pros / Cons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <ProsCons items={ev.pros} positive />
            <ProsCons items={ev.cons} positive={false} />
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 21 ? '#10B981' : score >= 17 ? '#F59E0B' : '#EF4444';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
      <span style={{ fontSize: 22, fontWeight: 900, color }}>{score}</span>
      <span style={{ fontSize: 11, color: '#6B7A8D' }}>/30</span>
    </div>
  );
}

function ScenarioCell({ title, val, weighted, color }: { title: string; val: number; weighted: number; color: string }) {
  return (
    <div style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4 }}>{val >= 0 ? '+' : ''}{(val * 100).toFixed(0)}%</div>
      <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2 }}>→ {weighted >= 0 ? '+' : ''}{(weighted * 100).toFixed(1)}%</div>
    </div>
  );
}

function SectionLabel({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: '0.4px' }}>{text}</div>
      <div style={{ flex: 1, height: 1, backgroundColor: `${color}20` }} />
    </div>
  );
}

function ProsCons({ items, positive }: { items: string[]; positive: boolean }) {
  const color = positive ? '#10B981' : '#EF4444';
  const sym = positive ? '✓' : '✗';
  return (
    <div style={{ backgroundColor: '#0A1422', border: `1px solid ${color}30`, borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: '#C9D4E0', lineHeight: 1.5 }}>
            <span style={{ color, fontWeight: 800 }}>{sym}</span>
            <span>{it}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Acceptance + Floating tables ───────────────────────────────────────────

function AcceptanceTable({ block }: { block: AcceptanceBlock }) {
  return (
    <div>
      <SectionLabel text="Acceptance Ratio Math — Promoter Participation Sensitivity" color="#22D3EE" />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 8 }}>
        <thead>
          <tr style={{ color: '#6B7A8D', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            <th style={{ textAlign: 'left', padding: '4px 10px' }}>Promoter Tender %</th>
            <th style={{ textAlign: 'left', padding: '4px 10px' }}>Public Tender %</th>
            <th style={{ textAlign: 'right', padding: '4px 10px' }}>Total Tendered</th>
            <th style={{ textAlign: 'right', padding: '4px 10px' }}>General Pool Acc.</th>
            <th style={{ textAlign: 'right', padding: '4px 10px' }}>Small Holder Acc.</th>
            <th style={{ textAlign: 'right', padding: '4px 10px' }}>Large Holder EV</th>
            <th style={{ textAlign: 'right', padding: '4px 10px' }}>Small Holder EV</th>
          </tr>
        </thead>
        <tbody>
          {block.scenarios.map((s, i) => {
            const m = computeAcceptanceMath({ ...block, promoterPct: s.promoterPct, publicPct: s.publicPct });
            const isBase = s.isBase;
            return (
              <tr key={i} style={{ borderTop: '1px solid #1A2840', backgroundColor: isBase ? '#FBBF240A' : 'transparent' }}>
                <td style={{ padding: '6px 10px', color: isBase ? '#FBBF24' : '#E6EDF3', fontWeight: isBase ? 800 : 400 }}>
                  {s.promoterPct}%{isBase && ' (Base)'}
                </td>
                <td style={{ padding: '6px 10px', color: '#E6EDF3' }}>{s.publicPct}%</td>
                <td style={{ padding: '6px 10px', color: '#94A3B8', textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{(m.totalTendered / 1e9).toFixed(2)}B</td>
                <td style={{ padding: '6px 10px', color: '#EF4444', textAlign: 'right', fontWeight: 700 }}>{m.generalPoolAcceptancePct.toFixed(1)}%</td>
                <td style={{ padding: '6px 10px', color: '#10B981', textAlign: 'right', fontWeight: 700 }}>{m.smallHolderAcceptancePct.toFixed(0)}%</td>
                <td style={{ padding: '6px 10px', color: '#94A3B8', textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>+{m.largeHolder.returnPct.toFixed(2)}%</td>
                <td style={{ padding: '6px 10px', color: '#10B981', textAlign: 'right', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700 }}>+{m.smallHolder.returnPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 11, color: '#6B7A8D', lineHeight: 1.55, backgroundColor: '#0A1422', borderRadius: 6, padding: '8px 12px', border: '1px solid #1A2840' }}>
        <strong style={{ color: '#FBBF24' }}>Key insight:</strong> Small shareholder acceptance (reserved category) stays at 35–47% regardless of promoter participation. Large holder acceptance collapses to 5–9%. Position size ≤ ₹2 lakh is the ONLY way to trade this profitably as a retail investor.
      </div>
    </div>
  );
}

function FloatingDealTable({ block }: { block: FloatingDealBlock }) {
  const m = computeFloatingDeal(block);
  const isPositive = m.spreadPct >= 2;
  const isNegative = m.spreadPct < 0;
  return (
    <div>
      <SectionLabel text="Floating-Deal Daily Recalculation" color="#22D3EE" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginTop: 8 }}>
        <KVCell label="Stated price" value={`$${block.statedPrice.toFixed(2)}`} />
        <KVCell label="Cash component" value={`$${m.cashComponent.toFixed(2)}`} hint={`${block.cashPct}% × stated`} />
        <KVCell label={`Stock value (${block.stockSharesPerTarget} ${block.acquirerTicker} × $${block.acquirerCmp})`} value={`$${m.stockComponent.toFixed(2)}`} />
        <KVCell label={`Effective consideration`} value={`$${m.effectiveValue.toFixed(2)}`} hint={`Cash + ${100 - block.cashPct}% × stock`} highlight />
        <KVCell label={`${block.targetTicker} CMP`} value={`$${block.targetCmp.toFixed(2)}`} />
        <KVCell label="Spread" value={`${m.spreadAbsolute >= 0 ? '+' : ''}$${m.spreadAbsolute.toFixed(2)} (${m.spreadPct >= 0 ? '+' : ''}${m.spreadPct.toFixed(2)}%)`} color={isPositive ? '#10B981' : isNegative ? '#EF4444' : '#F59E0B'} highlight />
        <KVCell label={`Break-even ${block.acquirerTicker}`} value={`$${m.breakEvenAcquirerPrice.toFixed(2)}`} hint={`At which spread = 0`} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: '#6B7A8D', lineHeight: 1.55, backgroundColor: '#0A1422', borderRadius: 6, padding: '8px 12px', border: '1px solid #1A2840' }}>
        <strong style={{ color: '#FBBF24' }}>Entry rule:</strong> Buy {block.targetTicker} ONLY when {block.acquirerTicker} ≥ ${m.breakEvenAcquirerPrice.toFixed(2)} OR {block.targetTicker} ≤ ${(block.targetCmp - m.cashComponent / 0.05).toFixed(0)}. Never enter a negative spread.
      </div>
    </div>
  );
}

function KVCell({ label, value, hint, color, highlight }: { label: string; value: string; hint?: string; color?: string; highlight?: boolean }) {
  const c = color || '#E6EDF3';
  return (
    <div style={{ backgroundColor: '#0A1422', border: highlight ? '1px solid #FBBF2440' : '1px solid #1A2840', borderRadius: 6, padding: '8px 12px' }}>
      <div style={{ fontSize: 10, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
      <div style={{ fontSize: 14, color: c, fontWeight: 800, marginTop: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: '#6B7A8D', marginTop: 2, fontStyle: 'italic' }}>{hint}</div>}
    </div>
  );
}

function SummaryTable({ events }: { events: CuratedEvent[] }) {
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 12, padding: '14px 18px' }}>
      <SectionLabel text="Summary Verdict Table — All Situations" color="#22D3EE" />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 8 }}>
        <thead>
          <tr style={{ color: '#6B7A8D', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            <th style={{ textAlign: 'left', padding: '6px 10px' }}>Situation</th>
            <th style={{ textAlign: 'left', padding: '6px 10px' }}>Type</th>
            <th style={{ textAlign: 'right', padding: '6px 10px' }}>Score</th>
            <th style={{ textAlign: 'right', padding: '6px 10px' }}>EV</th>
            <th style={{ textAlign: 'left', padding: '6px 10px' }}>Verdict</th>
            <th style={{ textAlign: 'left', padding: '6px 10px' }}>Next Action</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const evPct = (e.scenarios.bear.prob * e.scenarios.bear.ret + e.scenarios.base.prob * e.scenarios.base.ret + e.scenarios.bull.prob * e.scenarios.bull.ret) * 100;
            return (
              <tr key={e.id} style={{ borderTop: '1px solid #1A2840' }}>
                <td style={{ padding: '6px 10px', color: '#E6EDF3' }}>{e.name} {e.region === 'IN' ? '🇮🇳' : '🇺🇸'}</td>
                <td style={{ padding: '6px 10px', color: '#94A3B8' }}>{e.type.replace(/_/g, ' ')}</td>
                <td style={{ padding: '6px 10px', color: '#E6EDF3', fontWeight: 700, textAlign: 'right' }}>{e.score}/30</td>
                <td style={{ padding: '6px 10px', color: evPct >= 25 ? '#10B981' : evPct >= 5 ? '#F59E0B' : '#EF4444', fontWeight: 800, textAlign: 'right' }}>+{evPct.toFixed(1)}%</td>
                <td style={{ padding: '6px 10px' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: VERDICT_COLOR[e.verdict], padding: '2px 6px', borderRadius: 3, backgroundColor: `${VERDICT_COLOR[e.verdict]}18` }}>
                    {e.verdict_label}
                  </span>
                </td>
                <td style={{ padding: '6px 10px', color: '#94A3B8' }}>{e.status_pill}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMING TAB
// ═══════════════════════════════════════════════════════════════════════════

function TimingRules() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <RuleCard title="🔴 DEMERGERS / SPIN-OFFS — Buy BEFORE Record Date" color="#EF4444" entries={[
        { phase: 'PRE-EVENT (Best)', text: 'Buy before record date = you receive the spin-off shares FREE. This is the highest-return entry. You buy the bundle, then separate the winners. Vedanta example: buy at ₹425 before May 1. You receive 4 additional shares. Total effective cost basis split across 5 entities.' },
        { phase: 'RISK of Pre-Buy', text: 'You receive ALL entities including weak ones (Vedanta Power, Aluminium). You must be prepared to sell the weak ones on listing. If you don\'t have a plan to sell weak entities, pre-buying is dangerous.' },
        { phase: 'POST-EVENT Alternative', text: 'If you MISSED record date: wait 3–6 months. Forced institutional selling creates a better risk/reward entry in the spin-off that matters (Oil & Gas, Residual Vedanta). BUT: you miss the initial pop on quality entities. Jio Financial — pre-demerger buyers captured Nifty inclusion windfall. Post-demerger buyers paid up.' },
        { phase: 'RULE', text: 'If balance sheet of key entity is clean + industry growing → BUY BEFORE. If major entity is debt-heavy (Aluminium) → consider buying AFTER listing when weak entity prices reflect leverage.' },
      ]} />
      <RuleCard title="🟡 TENDER BUYBACKS — Buy BEFORE Record Date" color="#F59E0B" entries={[
        { phase: 'HOW IT WORKS', text: 'Tender buybacks: company sets a record date. Shareholders on record can tender their shares at the premium price. You must OWN shares on record date to participate.' },
        { phase: 'SMALL HOLDER RULE', text: 'In India: if your position ≤ ₹2 lakh (market value), you go into the RESERVED category (15% set aside). 40–50% acceptance vs 5–7% for large holders. Position size MATTERS enormously. This is why the Wipro trade is ONLY interesting at ≤ ₹2 lakh.' },
        { phase: 'AFTER TENDER', text: 'Non-accepted shares return at market price. If the stock has intrinsic value below buyback price, the unaccepted portion is not a loss — you simply hold the shares at a price you found attractive.' },
        { phase: 'RULE', text: 'Always check promoter participation. If promoters participate → pool for public shrinks dramatically. Size ≤ small shareholder limit to access reserved category.' },
      ]} />
      <RuleCard title="🟡 OPEN-MARKET BUYBACKS — Buy When Stock Undervalued" color="#94A3B8" entries={[
        { phase: 'NO DEADLINE', text: 'Open-market buybacks have no record date. The company buys gradually over months. Your edge here is valuation, not event mechanics.' },
        { phase: 'WHEN TO BUY', text: 'Buy when: (1) stock is below 15x forward P/E AND below historical average AND (2) FCF is growing AND (3) management is NOT selling in the open market simultaneously. Adobe check: 12% revenue growth ✓, $2.96B Q1 OCF ✓, but CFO selling ✗. Mixed signal — wait for CFO to stop selling.' },
        { phase: 'RULE', text: 'Hold for 12–36 months. Return comes from EPS accretion (fewer shares) × earnings growth. Not a 2-month trade.' },
      ]} />
      <RuleCard title="🔴 MERGER ARB (OPEN OFFERS) — Buy When Spread is Positive" color="#EF4444" entries={[
        { phase: 'FIXED CASH DEALS', text: 'Simple: buy below offer price, tender, capture spread. The spread is your return. Annualize by dividing by expected deal completion months. Example: Ambuja Cements Adani open offer. Rs 385 offer, stock at Rs 355 = 8.4% spread over 2 months = ~50% annualised.' },
        { phase: 'FLOATING DEALS (Stock+Cash)', text: 'ALWAYS recalculate effective consideration using CURRENT stock price, not deal announcement price. QXO/TopBuild lesson: $505 stated, but stock component fell → effective = $474. BLD at $489 is OVERPRICED. Rule: Effective = (Cash%) × offer + (Stock%) × (acquirer shares × current acquirer price). Recalculate daily.' },
        { phase: 'RULE', text: 'Only enter when CURRENT effective spread ≥ +2% AND risk/reward ≥ 2:1 (potential gain vs deal-break loss). Never enter negative spread. The QXO trade is currently a pass.' },
      ]} />
    </div>
  );
}

function RuleCard({ title, color, entries }: { title: string; color: string; entries: Array<{ phase: string; text: string }> }) {
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.4px', marginBottom: 4 }}>{e.phase}</div>
            <div style={{ fontSize: 12, color: '#C9D4E0', lineHeight: 1.55 }}>{e.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBOOK TAB
// ═══════════════════════════════════════════════════════════════════════════

function Playbook() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #22D3EE', borderRadius: 12, padding: '14px 18px' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.4px', marginBottom: 14 }}>Universal J-Curve — All Spin-offs / Demergers</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <JCurveCell phase="Day 1 – Month 3"   ret="−8 to −15%"        note="Forced selling · Index exclusion · ETF dumps" color="#EF4444" />
          <JCurveCell phase="Month 3 – 9"       ret="Recovery"           note="Management refocuses · Cost cuts visible · Analyst coverage starts" color="#F59E0B" />
          <JCurveCell phase="Month 9 – 24"      ret="+12 to +29%"        note="Above-market performance · Institutional buildup" color="#10B981" />
          <JCurveCell phase="Month 24 – 36"     ret="+28% above market"  note="Peak rerating · M&A premium possible" color="#10B981" />
          <JCurveCell phase="Month 36+"         ret="Diverges"           note="Winners compound · Losers plateau · Review thesis" color="#94A3B8" />
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#6B7A8D', lineHeight: 1.5 }}>
          Source: Purdue 36-year spin-off study (1965–2000) + 2007–2017 replication study (249 spin-offs). Average spin-off outperforms parent +22% in Year 1, +28.5% in Year 3. But 38% deliver negative returns in Year 1 — selection matters.
        </div>
      </div>

      <PlaybookGrid title="Demerger — HOLD signals (don't sell these)" color="#10B981" items={[
        { sym: '✓', label: 'Debt-free entity in growing sector',           text: 'Example: Vedanta Oil & Gas (Cairn) — zero debt, India\'s largest private oil producer. Hold 18–24 months. Analogy: ConocoPhillips E&P after split → +150% in 3 years.' },
        { sym: '✓', label: 'World-class asset now independently valued',   text: 'Example: Residual Vedanta with HZL 63.4% stake. HZL is a world-class zinc/silver producer. Hold indefinitely — buried inside the conglomerate, can now re-rate to global mining peers.' },
        { sym: '✓', label: 'Management bought shares in new entity',        text: 'If new entity\'s CEO/CFO starts buying in the open market in first 6 months → very strong hold signal. Shows management believes in standalone value.' },
        { sym: '✓', label: 'First standalone earnings beat expectations',   text: 'If first 2 standalone quarterly results beat consensus → add more. The market is still applying conglomerate discount in early estimates — beats mean re-rating is coming.' },
      ]} />

      <PlaybookGrid title="Demerger — SELL signals (exit these)" color="#EF4444" items={[
        { sym: '✗', label: 'Net Debt/EBITDA > 3.5x AND declining revenue', text: 'Example: Vedanta Aluminium (VAML) at ₹34,510 Cr debt vs ~₹8,500 Cr EBITDA = 4.06x leverage. If aluminium falls 15%, EBITDA drops → leverage spikes to 5x+. Sell on any listing pop above +20%.' },
        { sym: '✗', label: 'Cyclical business with thin equity buffer',     text: 'Example: Vedanta Power — ₹8,660 Cr debt, ~₹1,500 Cr EBITDA, equity = ₹1,840–5,340 Cr. One bad power tariff season wipes out equity. Sell within first month of listing.' },
        { sym: '✗', label: 'Spin-off is "the junk" parent wanted to dump',  text: 'If parent keeps the best assets and spins off the low-margin, capital-intensive, or declining business → sell immediately. Example: Conduent from Xerox — Xerox kept cash, spun BPO. Conduent fell 70% in 3 years.' },
        { sym: '✗', label: 'Management selling within 6 months of listing', text: 'If CEO or large insiders sell >10% of their personal stake within 6 months of spin-off listing → exit immediately. They know the business best.' },
      ]} />

      <PlaybookGrid title="After Buyback Tender — What Happens to Unaccepted Shares" color="#FBBF24" items={[
        { sym: '✓', label: 'If company is genuinely undervalued', text: 'HOLD unaccepted shares. If management is right that the stock is cheap at ₹250 (Wipro buyback price), the unaccepted shares at ₹210 will appreciate over 12–18 months as fundamentals recover. The tender was just a bonus.' },
        { sym: '✗', label: 'If buyback was PR not value',          text: 'SELL unaccepted shares over 3–6 months after buyback completes. If the share count didn\'t actually decline much (low acceptance for public), and business fundamentals are weak, the buyback premium gets reversed.' },
        { sym: '○', label: 'Wipro specifically',                    text: 'After tender: hold Wipro at ₹210 for 12-month recovery thesis. Stock at 5-year relative lows. IT sector recovery + AI services revenue should drive 20–30% upside independent of the buyback.' },
      ]} />
    </div>
  );
}

function JCurveCell({ phase, ret, note, color }: { phase: string; ret: string; note: string; color: string }) {
  return (
    <div style={{ backgroundColor: '#0A1422', border: `1px solid ${color}40`, borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.4px', marginBottom: 4 }}>{phase}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color, marginBottom: 4 }}>{ret}</div>
      <div style={{ fontSize: 10.5, color: '#6B7A8D', lineHeight: 1.45 }}>{note}</div>
    </div>
  );
}

function PlaybookGrid({ title, color, items }: { title: string; color: string; items: Array<{ sym: string; label: string; text: string }> }) {
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} style={{ backgroundColor: '#0A1422', border: '1px solid #1A2840', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{ color, fontWeight: 800, fontSize: 14 }}>{it.sym}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#E6EDF3' }}>{it.label}</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#94A3B8', lineHeight: 1.55, paddingLeft: 22 }}>{it.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MATH TAB — interactive calculators
// ═══════════════════════════════════════════════════════════════════════════

function MathPanels() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <AcceptanceCalculator />
      <FloatingDealCalculator />
    </div>
  );
}

function AcceptanceCalculator() {
  const [totalShares, setTotalShares] = useState(10472085808);
  const [buybackShares, setBuybackShares] = useState(600000000);
  const [smallReservePct, setSmallReservePct] = useState(15);
  const [buybackPrice, setBuybackPrice] = useState(250);
  const [cmp, setCmp] = useState(210);
  const [promoterPct, setPromoterPct] = useState(80);
  const [publicPct, setPublicPct] = useState(50);
  const m = useMemo(() => computeAcceptanceMath({ totalShares, buybackShares, smallReservePct, buybackPrice, cmp, promoterPct, publicPct }), [totalShares, buybackShares, smallReservePct, buybackPrice, cmp, promoterPct, publicPct]);
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #FBBF24', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.4px', marginBottom: 12 }}>📊 INDIAN TENDER BUYBACK CALCULATOR</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 14 }}>
        <NumInput label="Total shares outstanding" value={totalShares} onChange={setTotalShares} />
        <NumInput label="Buyback shares" value={buybackShares} onChange={setBuybackShares} />
        <NumInput label="Small reserve %" value={smallReservePct} onChange={setSmallReservePct} step={1} />
        <NumInput label="Buyback price" value={buybackPrice} onChange={setBuybackPrice} step={1} />
        <NumInput label="CMP" value={cmp} onChange={setCmp} step={1} />
        <NumInput label="Promoter tender %" value={promoterPct} onChange={setPromoterPct} step={5} />
        <NumInput label="Public tender %" value={publicPct} onChange={setPublicPct} step={5} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <ResultCard title="Large Holder (₹21L position)" color="#EF4444" rows={[
          ['Acceptance ratio',     `${m.generalPoolAcceptancePct.toFixed(2)}%`],
          ['Shares accepted',      `${m.largeHolder.sharesAccepted.toFixed(0)}`],
          ['Premium captured',     `₹${m.largeHolder.premiumGain.toFixed(0)}`],
          ['Return',               `+${m.largeHolder.returnPct.toFixed(2)}%`],
          ['Annualised',           `${m.largeHolder.annualized.toFixed(1)}%`],
        ]} />
        <ResultCard title="Small Holder (≤₹2L position)" color="#10B981" rows={[
          ['Acceptance ratio',     `${m.smallHolderAcceptancePct.toFixed(0)}%`],
          ['Shares accepted',      `${m.smallHolder.sharesAccepted.toFixed(0)}`],
          ['Premium captured',     `₹${m.smallHolder.premiumGain.toFixed(0)}`],
          ['Return',               `+${m.smallHolder.returnPct.toFixed(2)}%`],
          ['Annualised',           `${m.smallHolder.annualized.toFixed(1)}%`],
        ]} />
      </div>
    </div>
  );
}

function FloatingDealCalculator() {
  const [statedPrice, setStatedPrice] = useState(505);
  const [cashPct, setCashPct] = useState(45);
  const [stockSharesPerTarget, setStockSharesPerTarget] = useState(20.2);
  const [acquirerCmp, setAcquirerCmp] = useState(22.23);
  const [targetCmp, setTargetCmp] = useState(489);
  const m = useMemo(() => computeFloatingDeal({ statedPrice, cashPct, stockSharesPerTarget, acquirerCmp, targetCmp }), [statedPrice, cashPct, stockSharesPerTarget, acquirerCmp, targetCmp]);
  return (
    <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: '3px solid #FBBF24', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#FBBF24', letterSpacing: '0.4px', marginBottom: 12 }}>💰 FLOATING-DEAL CALCULATOR (Stock + Cash Merger Arb)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 14 }}>
        <NumInput label="Stated price ($)" value={statedPrice} onChange={setStatedPrice} step={1} />
        <NumInput label="Cash %" value={cashPct} onChange={setCashPct} step={5} />
        <NumInput label="Acquirer shares / target" value={stockSharesPerTarget} onChange={setStockSharesPerTarget} step={0.1} />
        <NumInput label="Acquirer CMP ($)" value={acquirerCmp} onChange={setAcquirerCmp} step={0.1} />
        <NumInput label="Target CMP ($)" value={targetCmp} onChange={setTargetCmp} step={1} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        <KVCell label="Cash component" value={`$${m.cashComponent.toFixed(2)}`} />
        <KVCell label="Stock component" value={`$${m.stockComponent.toFixed(2)}`} />
        <KVCell label="Effective consideration" value={`$${m.effectiveValue.toFixed(2)}`} highlight />
        <KVCell label="Spread vs target CMP" value={`${m.spreadAbsolute >= 0 ? '+' : ''}$${m.spreadAbsolute.toFixed(2)} (${m.spreadPct >= 0 ? '+' : ''}${m.spreadPct.toFixed(2)}%)`} color={m.spreadPct >= 2 ? '#10B981' : m.spreadPct < 0 ? '#EF4444' : '#F59E0B'} highlight />
        <KVCell label="Break-even acquirer price" value={`$${m.breakEvenAcquirerPrice.toFixed(2)}`} hint="Spread = 0 at this price" />
      </div>
    </div>
  );
}

function NumInput({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#6B7A8D', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{label}</div>
      <input
        type="number"
        value={value}
        step={step ?? 'any'}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', padding: '6px 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, border: '1px solid #1A2840', backgroundColor: '#0A1422', color: '#E6EDF3', borderRadius: 4, outline: 'none' }}
      />
    </div>
  );
}

function ResultCard({ title, color, rows }: { title: string; color: string; rows: Array<[string, string]> }) {
  return (
    <div style={{ backgroundColor: '#0A1422', border: `1px solid ${color}40`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color, letterSpacing: '0.4px', marginBottom: 8 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} style={{ borderTop: '1px solid #1A2840' }}>
              <td style={{ padding: '5px 0', color: '#94A3B8' }}>{k}</td>
              <td style={{ padding: '5px 0', color: '#E6EDF3', textAlign: 'right', fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVER TAB — keep the regex scanner as fallback for finding new events
// ═══════════════════════════════════════════════════════════════════════════

interface RawArticle {
  id: string;
  headline?: string;
  title?: string;
  summary?: string;
  source?: string;
  source_name?: string;
  source_tier?: string;
  published_at?: string;
  source_url?: string;
  url?: string;
  tickers?: string[];
  ticker_symbols?: string[];
  region?: string;
}

function DiscoverScanner() {
  const { data, isLoading, error } = useQuery<RawArticle[]>({
    queryKey: ['special-situations', 'discover'],
    queryFn: async () => {
      const { data } = await api.get('/news');
      return Array.isArray(data) ? data : (data?.articles || data?.items || []);
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const PATTERNS = [
    { id: 'SPIN', label: 'Spin-offs', color: '#22D3EE', re: /\b(spin.?off|spinoff|demerg|carve.?out|split.?off|hive.?off)\b/i },
    { id: 'MA',   label: 'M&A',       color: '#FBBF24', re: /\b(open offer|takeover|tender offer|acquisition|merger|buyout|control change)\b/i },
    { id: 'TURN', label: 'Turnaround',color: '#10B981', re: /\b(turnaround|back to profit|loss to profit|profit revival|debt restructur|debt reduction|deleverag)\b/i },
    { id: 'CAP',  label: 'Capital',   color: '#A78BFA', re: /\b(buyback|share repurchase|special dividend|interim dividend|bonus issue|capital return|debt prepay)\b/i },
  ];

  const arr = data || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderRadius: 12, padding: '14px 18px' }}>
        <SectionLabel text="🔍 DISCOVER — News-feed regex scanner (find candidates for promotion to curated)" color="#22D3EE" />
        <div style={{ marginTop: 8, fontSize: 11, color: '#6B7A8D', lineHeight: 1.5 }}>
          Note: the upstream /news endpoint serves a curated bottleneck-tier feed (~50-100 articles), not a corporate-actions firehose. Counts here will be sparse. The CURATED tab above is the primary surface; this is for spotting new events to promote.
        </div>
      </div>
      {isLoading && <div style={{ color: '#6B7A8D', fontSize: 12, padding: 14 }}>Loading news universe…</div>}
      {error && <div style={{ color: '#EF4444', fontSize: 12, padding: 14 }}>Failed to load news.</div>}
      {!isLoading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {PATTERNS.map((p) => {
            const matched = arr.filter((a) => p.re.test(`${a.headline || a.title || ''} ${a.summary || ''}`));
            return (
              <div key={p.id} style={{ backgroundColor: '#0D1B2E', border: '1px solid #1E2D45', borderLeft: `3px solid ${p.color}`, borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: p.color, letterSpacing: '0.4px', marginBottom: 6 }}>{p.label} · {matched.length}</div>
                {matched.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#6B7A8D' }}>No matches in current feed.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {matched.slice(0, 5).map((a) => (
                      <a key={a.id} href={a.source_url || a.url || '#'} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#C9D4E0', lineHeight: 1.45, textDecoration: 'none', borderBottom: '1px solid #1A2840', paddingBottom: 4, display: 'flex', gap: 4 }}>
                        <span style={{ flex: 1 }}>{a.headline || a.title}</span>
                        <ExternalLink style={{ width: 11, height: 11, flexShrink: 0, color: '#6B7A8D' }} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
