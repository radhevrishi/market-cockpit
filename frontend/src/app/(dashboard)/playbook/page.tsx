'use client';

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBOOK (PATCH 0626) — institutional how-to guide.
//
// Step-by-step process for turning the portal's signals into a money-making
// workflow. Written from the user's seat: they're not a sell-side analyst,
// they're a self-funded research-driven investor running a personal book.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import Link from 'next/link';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

const STEPS: Array<{
  num: number;
  title: string;
  emoji: string;
  color: string;
  body: string;
  do: string[];
  surfaces: Array<{ label: string; href: string }>;
  example?: string;
}> = [
  {
    num: 1,
    title: 'Refresh your data weekly',
    emoji: '📥',
    color: '#22D3EE',
    body: 'Your Multibagger scorer runs entirely on CSVs you upload. Stale data = stale conviction. Reset every Sunday so the engine sees the latest quarterly numbers.',
    do: [
      'Open Screener.in → export your India universe to Excel/CSV → upload on the India sub-tab.',
      'Open TradingView → export your US universe → upload on the USA sub-tab.',
      'Watch the Home header — if the "Multibagger upload Nd ago" amber chip is showing, you skipped a week.',
    ],
    surfaces: [
      { label: 'Multibagger →', href: '/multibagger' },
    ],
    example: 'Bumping the engine on Sunday means Monday morning Tier 1 already reflects the new quarterly results — no manual ranking needed.',
  },
  {
    num: 2,
    title: 'Start each morning at Home',
    emoji: '🌅',
    color: '#10B981',
    body: 'Home is a Bloomberg-style ops view. 15 minutes covers everything you need to make decisions for the day.',
    do: [
      'Read Tier 1 (cross-confirmed picks — A-grade ∩ Conviction Beats ∩ no decision yet).',
      'Glance at Bottleneck Pulse — if any theme is red HIGH, click through to the Workbench.',
      'Read In-Play News + Concall Intel for last 24h catalysts.',
      'Check Earnings Today and Upcoming Earnings for filings on your bench.',
      'Note what your Watchlist Pulse + Top Movers are doing.',
    ],
    surfaces: [
      { label: 'Home →', href: '/' },
    ],
    example: 'If Tier 1 #1 is ATLANTAELE A-grade and Bottleneck Pulse shows POWER_GRID is HIGH, those two signals reinforce each other — that\'s the day\'s strongest setup.',
  },
  {
    num: 3,
    title: 'Cross-confirm before sizing',
    emoji: '🔬',
    color: '#A78BFA',
    body: 'A high score alone is not enough. The portal\'s edge is layering multiple independent signals on the same name.',
    do: [
      'Open the Stock Sheet for the ticker. Read Fundamental Health + Promoter Trust + Sector KPIs.',
      'Check Conviction Beats: is the name already on the bench? When did it land?',
      'Check Super Investors: which marquee investor holds it, at what stake, last disclosed when?',
      'Open Concall Intel page → search ticker. Read the latest management commentary tone.',
      'Open Special Situations or Order Book pages → confirm no fresh negative catalyst.',
    ],
    surfaces: [
      { label: 'Stock Sheet →', href: '/stock-sheet' },
      { label: 'Conviction Beats →', href: '/earnings-opportunities' },
      { label: 'Super Investors →', href: '/super-investors' },
      { label: 'Concall Intel →', href: '/concall-intel' },
    ],
    example: 'NITTAGELA is A++ in Multibagger + on CB bench + Mukherjea holds 30-Apr disclosure + concall tone "Neutral with positive guidance" + no negative special-sit → strong cross-confirm.',
  },
  {
    num: 4,
    title: 'Size based on conviction tier',
    emoji: '💰',
    color: '#F59E0B',
    body: 'Position sizing reflects how many independent signals cross-confirm. Never max-size on a single A-grade score alone.',
    do: [
      'Tier 1 cross-confirmed (★) — full conviction position (4-6% of book).',
      'Tier 1 top-up (+) — half position (2-3%).',
      'Tier 2 watchlist — quarter position (1-2%) while it builds.',
      'Tier 3 experimental — 0.5-1% scout position to learn.',
      'USA names: cap at 1.5% (PAYS rule — single-name USA exposure is structurally riskier given quarterly liquidity gaps).',
    ],
    surfaces: [
      { label: 'My Book →', href: '/portfolio' },
    ],
    example: 'If your portfolio is ₹50 lakh, a Tier 1 ★ position is ₹2-3 lakh. A Tier 3 scout is ₹25-50k. Never go max on score alone.',
  },
  {
    num: 5,
    title: 'Use the Valuation Calculators before buying',
    emoji: '🧮',
    color: '#22D3EE',
    body: 'The score tells you "this is a good business". The Valuation tab tells you "is the price OK today?". Always run the calculator before entry.',
    do: [
      'Open /valuations → pick the right calculator for the sector (P/S for growth/SaaS, P/E for FMCG/quality, EV/EBITDA for industrials/cyclicals).',
      'Enter management guidance for FY27/FY28 (look this up in the Concall AI tab under Earnings Hub).',
      'Read out base / bull / bear case upside in months. If base-case upside is < 25% over 18 months, wait for a better entry.',
      'Compare against the Stock Sheet 5-year median multiple chip.',
    ],
    surfaces: [
      { label: 'Valuations →', href: '/valuations' },
      { label: 'Concall AI →', href: '/earnings-hub' },
    ],
    example: 'DEEDEV at ₹499 with FY27 PAT guidance ₹100 Cr at 30x P/E = ₹3,000 Cr market cap. Current ₹3,136 Cr. Implied 18-month upside = roughly flat. Wait for a -15% pullback before sizing.',
  },
  {
    num: 6,
    title: 'Log every decision in the Decision Logbook',
    emoji: '📒',
    color: '#A78BFA',
    body: 'The portal\'s long-term edge compounds when you record WHY you acted. Future-you reads it before re-entering or doubling down.',
    do: [
      'On the Stock Sheet, click BUY / WATCH / NEUTRAL / REJECTED and write a one-line reason.',
      'Bad reasons: "looks good". Good reasons: "FY27 ₹100Cr PAT at 30x P/E = ₹3000Cr; bought at ₹3100Cr trusting CB cross-confirm".',
      'Decisions persist across CSV re-uploads — your historical record never resets.',
    ],
    surfaces: [
      { label: 'Decision Logbook →', href: '/decisions' },
    ],
    example: 'Six months later when you ask "why did I buy DEEDEV?", the log shows your exact thesis. You can audit if it held.',
  },
  {
    num: 7,
    title: 'Set up News Alerts for what you care about',
    emoji: '🔔',
    color: '#EF4444',
    body: 'You can\'t watch the news feed all day. The alert system fires browser notifications when matches arrive.',
    do: [
      'Open /news-alerts → click any Recommended Preset (AI Infra HIGH-only / Power Grid Bottleneck / Order Wins / Rating Upgrade / Marquee PE / Capacity Expansion / Earnings Surprise / Promoter Buying).',
      'Customize with your own keyword: company name, sector, theme.',
      'Grant browser notification permission — alerts fire even when the tab is in background.',
    ],
    surfaces: [
      { label: 'News Alerts →', href: '/news-alerts' },
    ],
    example: 'Alert "AI Infra HIGH-only" fires when a Nvidia memory bottleneck article hits. You open Bottleneck Workbench → see Indian proxies HBL POWER / KAYNES → check if either is on your bench → size up.',
  },
  {
    num: 8,
    title: 'Watch your Conviction Beats bench',
    emoji: '🏆',
    color: '#F59E0B',
    body: 'Your CB bench is the institutional shortlist — names that hit BLOCKBUSTER/STRONG on Earnings Opportunities. It auto-populates from your Multibagger upload.',
    do: [
      'Open Earnings Opportunities → review the BLOCKBUSTER + STRONG tiers.',
      'Names auto-add to CB bench when they cross BLOCKBUSTER threshold.',
      'CB bench drives Tier 1 cross-confirmation on Home. Always know what\'s on it.',
      'Header chip "🏆 CB N" is always live count.',
    ],
    surfaces: [
      { label: 'Earnings Opportunities →', href: '/earnings-opportunities' },
      { label: 'Watchlist →', href: '/watchlists' },
    ],
  },
  {
    num: 9,
    title: 'Track Special Situations + Order Book + Rating Actions',
    emoji: '🎯',
    color: '#EF4444',
    body: 'Re-rating events come from three sources: (a) merger/acquisition/spinoff filings, (b) large PSU order wins like DEEDEV-style contracts, (c) rating agency upgrades.',
    do: [
      'Open /special-situations weekly to spot SAST / preferential / merger-arb / NCLT events.',
      'Open /order-book to spot LoA / large contract wins; tier-1 PSU customers (HAL/BHEL/NTPC/PGCIL) are the highest signal.',
      'Open /rating-actions to spot ICRA/CRISIL upgrade catalysts.',
      'Cross-reference: a name with ALL THREE in one quarter is a setup worth max-sizing.',
    ],
    surfaces: [
      { label: 'Special Situations →', href: '/special-situations' },
      { label: 'Order Book Intel →', href: '/order-book' },
      { label: 'Rating Actions →', href: '/rating-actions' },
    ],
    example: 'BEL (Bharat Electronics) — Order Book win + Rating Upgrade + on CB bench — would be a 3-source confirmation event.',
  },
  {
    num: 10,
    title: 'Review weekly + month-end',
    emoji: '📊',
    color: '#10B981',
    body: 'Performance review is what separates a process from gambling.',
    do: [
      'Sunday review: read your Decision Log entries from the past week. Did the reasons hold?',
      'Check Home → Engine consistency chip — has your average score across uploads stayed within ±5 points?',
      'Check Movers + Portfolio P&L line — what worked / what didn\'t.',
      'Adjust position sizes if a thesis broke (e.g. promoter sold, USFDA observation).',
      'End of month: export Decision Log JSON as backup.',
    ],
    surfaces: [
      { label: 'Decision Logbook →', href: '/decisions' },
      { label: 'My Book →', href: '/portfolio' },
    ],
  },
];

const SECTOR_PLAYBOOK: Array<{ sector: string; calculator: string; multiple: string; emoji: string }> = [
  { sector: 'Industrial / Capex / Engineering',     calculator: 'P/E or EV/EBITDA on FY27 forward earnings', multiple: 'P/E 25-45x, EV/EBITDA 15-22x', emoji: '🏭' },
  { sector: 'Defence / PSU',                         calculator: 'P/E on FY27 + Order Book / Revenue ratio', multiple: 'P/E 30-50x (order-book backed)',  emoji: '🛡' },
  { sector: 'Power / Transmission',                  calculator: 'P/E + EV/EBITDA on capex utilization',     multiple: 'P/E 35-55x, EV/EBITDA 18-28x',    emoji: '⚡' },
  { sector: 'Pharma / Speciality Chemicals',         calculator: 'P/E + EV/EBITDA + capex roadmap',          multiple: 'P/E 30-45x, EV/EBITDA 20-30x',    emoji: '💊' },
  { sector: 'Consumer / FMCG / Discretionary',       calculator: 'P/E on stable margin base',                multiple: 'P/E 40-70x (quality)',            emoji: '🛍' },
  { sector: 'Auto / Auto Components',                calculator: 'P/E + EV/EBITDA on cycle midpoint',        multiple: 'P/E 20-30x, EV/EBITDA 12-18x',    emoji: '🚗' },
  { sector: 'Financial Services / NBFC',             calculator: 'P/B + ROE',                                multiple: 'P/B 2-5x',                        emoji: '🏦' },
  { sector: 'IT Services',                           calculator: 'P/E on USD revenue growth',                multiple: 'P/E 20-35x',                      emoji: '💻' },
  { sector: 'SaaS / Tech (US)',                      calculator: 'P/S + Rule of 40',                         multiple: 'P/S 8-25x (R40 elite)',           emoji: '☁' },
];

export default function PlaybookPage() {
  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '24px 28px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        <div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: TEXT, letterSpacing: '-0.3px' }}>📚 Playbook</h1>
          <div style={{ marginTop: 6, fontSize: 14, color: DIM, lineHeight: 1.55, maxWidth: 800 }}>
            The 10-step institutional process for turning Market Cockpit signals into a money-making research workflow.
            Read it once. Bookmark it. Come back every Sunday for the weekly checklist.
          </div>
        </div>

        {/* HOW THIS PORTAL GIVES YOU AN EDGE */}
        <div style={{
          background: 'linear-gradient(180deg, #22D3EE12 0%, transparent 100%)',
          border: '1px solid #22D3EE40',
          borderRadius: 8,
          padding: '16px 18px',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#22D3EE', letterSpacing: '0.5px', marginBottom: 8 }}>
            🎯 WHY THIS WORKS
          </div>
          <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.65 }}>
            Bloomberg-style operating dashboards work because they cross-confirm signals from independent data sources.
            Multibagger scoring (fundamentals) + Conviction Beats (institutional bench) + Bottleneck Intel (structural themes) +
            Concall AI (management commentary) + Super Investors (marquee positioning) + Rating Actions / Order Book
            (re-rating events) — when 3+ of these align on the same name, that's an institutional-grade setup.
            Acting on one signal alone is gambling. Acting on 3-5 layered signals is research.
          </div>
        </div>

        {/* STEPS */}
        {STEPS.map((s) => (
          <div key={s.num} style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderLeft: `3px solid ${s.color}`,
            borderRadius: 8,
            padding: '18px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: s.color, letterSpacing: '1px', minWidth: 50 }}>
                STEP {s.num}
              </span>
              <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: TEXT }}>
                {s.emoji} {s.title}
              </h2>
            </div>
            <p style={{ margin: '8px 0 12px 0', fontSize: 13.5, color: '#C9D4E0', lineHeight: 1.65 }}>{s.body}</p>

            <div style={{ fontSize: 11, color: DIM, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 6 }}>WHAT TO DO</div>
            <ul style={{ margin: 0, paddingLeft: 22, fontSize: 13, color: TEXT, lineHeight: 1.7 }}>
              {s.do.map((d, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{d}</li>
              ))}
            </ul>

            {s.example && (
              <div style={{
                marginTop: 12,
                padding: '10px 14px',
                background: `${s.color}10`,
                borderLeft: `3px solid ${s.color}80`,
                borderRadius: 4,
                fontSize: 13,
                color: '#D5DDE5',
                lineHeight: 1.6,
                fontStyle: 'italic',
              }}>
                Example — {s.example}
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {s.surfaces.map((surf) => (
                <Link key={surf.href} href={surf.href} style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  background: `${s.color}22`,
                  border: `1px solid ${s.color}60`,
                  borderRadius: 4,
                  color: s.color,
                  textDecoration: 'none',
                  fontWeight: 700,
                }}>
                  {surf.label}
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* SECTOR PLAYBOOK TABLE */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '18px 20px' }}>
          <h2 style={{ margin: '0 0 8px 0', fontSize: 19, fontWeight: 800, color: TEXT }}>
            🧮 Sector → Calculator Lookup
          </h2>
          <p style={{ margin: '0 0 14px 0', fontSize: 13, color: DIM, lineHeight: 1.6 }}>
            Which calculator to use, and what multiple range is institutionally defensible, by sector.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 14px', fontSize: 12.5 }}>
            <div style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px', fontSize: 11, paddingBottom: 4, borderBottom: `1px solid ${BORDER}` }}>SECTOR</div>
            <div style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px', fontSize: 11, paddingBottom: 4, borderBottom: `1px solid ${BORDER}` }}>CALCULATOR</div>
            <div style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px', fontSize: 11, paddingBottom: 4, borderBottom: `1px solid ${BORDER}` }}>MULTIPLE RANGE</div>
            {/* PATCH 0966 — missing-keys: bare <>…</> fragment inside .map() with
                inner-div `key` props produced React "each child needs unique key"
                warnings (and only the fragment-level key actually counts). The
                inner keys did nothing because they sat on siblings of the
                fragment. Switch to React.Fragment with the fragment-level key
                and drop the redundant inner keys. */}
            {SECTOR_PLAYBOOK.map((s) => (
              <React.Fragment key={s.sector}>
                <div style={{ color: TEXT, fontWeight: 600 }}>{s.emoji} {s.sector}</div>
                <div style={{ color: '#C9D4E0' }}>{s.calculator}</div>
                <div style={{ color: '#22D3EE', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{s.multiple}</div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* DANGER ZONE */}
        <div style={{
          background: '#EF444415',
          border: '1px solid #EF444460',
          borderRadius: 8,
          padding: '16px 18px',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#EF4444', letterSpacing: '0.5px', marginBottom: 8 }}>
            ⚠ COMMON MISTAKES TO AVOID
          </div>
          <ul style={{ margin: 0, paddingLeft: 22, fontSize: 13, color: TEXT, lineHeight: 1.75 }}>
            <li><b>Score-only sizing.</b> A+ alone is not a buy signal. Always cross-confirm with at least one other layer.</li>
            <li><b>Skipping the Valuation calc.</b> Quality at any price is not a strategy. Run P/E or P/S target before entry.</li>
            <li><b>Ignoring promoter trust / governance.</b> Read the Promoter Trust chip on Stock Sheet. Low promoter + low DII + microcap = operator stock.</li>
            <li><b>Acting on stale CSV data.</b> If the amber "Multibagger upload Nd ago" chip is up, re-upload before sizing anything new.</li>
            <li><b>No Decision Log entry.</b> If you can't write a one-line thesis, you don't understand the position. Don't enter.</li>
            <li><b>Chasing structural alerts in In-Play.</b> Structural items are filtered out of the main feed for a reason — they're commentary, not actionable catalysts.</li>
            <li><b>Max-sizing USA names.</b> Single-name USA exposure has structurally larger drawdowns (PAYS rule); cap at 1.5%.</li>
          </ul>
        </div>

      </div>
    </div>
  );
}
