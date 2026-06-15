'use client';

// ════════════════════════════════════════════════════════════════════════════
// MARKET CYCLES — PATCH 1089
// Compact reference tab condensing "Mastering Market Cycles: The Complete
// Playbook for Managing Bull Markets, Corrections, Crashes and Recoveries in
// Indian Equities" (~250k-word handbook, June 2026, Quantitative Research).
//
// Eight sub-tabs, mapped to the handbook's six parts:
//   1. OVERVIEW       — Six Truths, How to read, framework summary
//   2. 8 CYCLES       — Liquidity / Credit / Rates / Business / Valuation /
//                       Sentiment / Political / Global flows + interaction
//   3. CRASHBOOK      — Every Indian crash 1992-2026 + global comparators
//   4. PRE-CRASH      — 15-signature checklist + 12 weekly indicators +
//                       Marks "Where Are We?" framework
//   5. DEPLOYMENT     — Staircase protocol, cash allocation, position sizing
//   6. SECTOR ROTATION— Phase-by-phase tilts (early/mid/late bull, bear, recovery)
//   7. PSYCHOLOGY     — 12 destructive biases + crash behavioural protocol
//   8. ELITE PLAYBOOK — 10 elite-investor rules + 7 rules after portfolio doubles
//
// Source: docx uploaded 2026-06-15. Densified — keeps the rules, signatures,
// math and operating manual; drops historical prose narrative.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

const C = {
  bg: 'var(--mc-bg-0)', card: 'var(--mc-bg-1)', card2: 'var(--mc-bg-2)',
  border: 'var(--mc-border-1)', borderStrong: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', text2: 'var(--mc-text-2)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', amber: 'var(--mc-warn)', red: 'var(--mc-bearish)',
  cyan: 'var(--mc-cyan)', saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
};

const MONO: CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

type TabId = 'overview' | 'cycles' | 'crashbook' | 'precrash' | 'deployment' | 'rotation' | 'psychology' | 'elite' | 'checklist';

const TABS: { id: TabId; label: string; emoji: string; sub: string }[] = [
  { id: 'overview',   emoji: '🧭', label: 'Overview',        sub: 'Six Truths + framework' },
  { id: 'cycles',     emoji: '🔄', label: '8 Cycles',         sub: 'Liquidity → Sentiment' },
  { id: 'crashbook',  emoji: '📉', label: 'Crashbook',        sub: '1992-2026 India + global' },
  { id: 'precrash',   emoji: '⚠️', label: 'Pre-Crash',        sub: '15 signatures · 12 weekly' },
  { id: 'deployment', emoji: '🪜', label: 'Deployment',       sub: 'Staircase + cash + sizing' },
  { id: 'rotation',   emoji: '🧬', label: 'Sector Rotation',  sub: 'Phase-by-phase tilts' },
  { id: 'psychology', emoji: '🧠', label: 'Psychology',       sub: '12 biases + crash protocol' },
  { id: 'elite',      emoji: '🦅', label: 'Elite Playbook',   sub: '10 rules + 7 after-double' },
  { id: 'checklist',  emoji: '📋', label: '500-Point Check',  sub: 'Before selling any winner' },
];

// ── Block primitive ─────────────────────────────────────────────────────────
function Card({ title, accent, children }: { title?: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: accent ? `3px solid ${accent}` : `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
      {title && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: accent || C.cyan, textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>}
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function Quote({ text, who }: { text: string; who: string }) {
  return (
    <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.amber}`, borderRadius: 6, padding: '10px 14px', margin: '8px 0', fontStyle: 'italic', fontSize: 13, color: C.text2 }}>
      "{text}"
      <div style={{ fontStyle: 'normal', fontSize: 11, color: C.muted, marginTop: 4 }}>— {who}</div>
    </div>
  );
}

function Tag({ label, color = C.cyan }: { label: string; color?: string }) {
  return <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 3, color, border: `1px solid ${color}40`, background: `${color}10`, marginRight: 6 }}>{label}</span>;
}

// ── Tab content ────────────────────────────────────────────────────────────
function OverviewTab() {
  return (
    <>
      <Card title="🌊 The Framework In One Sentence" accent={C.cyan}>
        Markets cycle. Cycles cannot be predicted with precision but they can be diagnosed with rigour, prepared for with discipline, and survived with structure. The framework is the framework. The math is the math. <strong>Your discipline is the variable.</strong>
      </Card>

      <Card title="📚 How To Read This Handbook" accent={C.saffron}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div><Tag label="Part I" color={C.cyan} /><strong>Why Cycles Exist (§1-3)</strong> — Eight cycle types + how they interact. Foundation.</div>
          <div><Tag label="Part II" color={C.amber} /><strong>Pre-Crash Patterns (§4-6)</strong> — Twelve pre-crash signatures. Diagnostic layer.</div>
          <div><Tag label="Part III" color={C.green} /><strong>Deployment & Allocation (§7-10)</strong> — Staircase protocol + cash discipline. Operational core.</div>
          <div><Tag label="Part IV" color={C.saffron} /><strong>Rotation, Valuation, Psychology, Elite (§11-14)</strong> — Sophistication layer.</div>
          <div><Tag label="Part V" color={C.purple} /><strong>Wealth Creators & Scenarios (§15-16)</strong> — How elite investors held through cycles.</div>
          <div><Tag label="Part VI" color={C.red} /><strong>Operating Manual (§17-19)</strong> — Rule-based crash management system.</div>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: C.muted }}>Budget 25 hours cover-to-cover. Re-read §1 before every major portfolio decision. Reference §7 (Staircase) during any 15%+ drawdown. Print §18 (500-point Checklist) before selling any long-term winner.</div>
      </Card>

      <Card title="⚖️ The Six Truths of Indian Market Cycles" accent={C.green}>
        <div style={{ display: 'grid', gap: 10 }}>
          {[
            { n: 1, t: 'Cycles exist and are knowable — but their timing is not.', body: 'Every cycle has occurred multiple times. The pattern repeats. The catalyst differs. The duration varies. Accept being early at tops AND bottoms.' },
            { n: 2, t: 'Liquidity is the upstream cycle. Every other cycle is downstream.', body: 'Read the global liquidity tide + RBI stance and you predict the direction (not timing) of every other cycle with 70%+ accuracy. Fed balance sheet, DXY, RBI LAF, M3 growth — the foundational dashboard.' },
            { n: 3, t: 'Credit busts produce the best buying opportunities of a decade.', body: '2008 (NBFC/RE), 2018 (IL&FS), 2020 (COVID). Each delivered 100-200% gains over 36 months for those with cash + a list.' },
            { n: 4, t: 'Valuation excess + leverage + euphoria = the universal crash precondition.', body: 'No crash in 35 years occurred without all three. The absence of euphoria is itself a structural safety signal.' },
            { n: 5, t: 'Quality compounders mean-revert through cycles; junk does not recover.', body: 'HDFC Bank, Asian Paints, Eicher have survived 4-5 crashes. Reliance Power, DLF, Yes Bank did not. The 500-point Checklist (§18) is the test.' },
            { n: 6, t: 'The investor\'s discipline matters more than the investor\'s thesis.', body: 'The brain in panic is not the brain that wrote the thesis. Pre-committed rules executed mechanically out-compound any post-hoc reasoning.' },
          ].map((tr) => (
            <div key={tr.n} style={{ borderTop: tr.n > 1 ? `1px solid ${C.border}` : 'none', paddingTop: tr.n > 1 ? 10 : 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <div style={{ minWidth: 26, height: 26, borderRadius: '50%', background: `${C.green}25`, color: C.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>{tr.n}</div>
                <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{tr.t}</div>
              </div>
              <div style={{ fontSize: 12, color: C.text2, marginLeft: 34, marginTop: 4, lineHeight: 1.55 }}>{tr.body}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="🎯 Three Operational Disciplines (§1.13)" accent={C.purple}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div><strong style={{ color: C.cyan }}>A · Monthly Cycle Dashboard</strong> — One page, 20 data points across the 8 cycles. Updated monthly. Minimum dataset: Fed balance sheet, US 2s/10s, India CDS, RBI repo, banking credit growth, capacity util, Nifty trailing PE, breadth, IPO volumes, FII/DII, INR/USD, Brent, DXY, VIX, gold.</div>
          <div><strong style={{ color: C.cyan }}>B · Quarterly Cycle Position Update</strong> — Score 8 cycles on a 5-point scale (-2 deeply contractionary → +2 deeply expansionary). Aggregate score &gt; +6 → defensive bias. &lt; -6 → aggressive deployment.</div>
          <div><strong style={{ color: C.cyan }}>C · Sectoral Cycle Map</strong> — Each major sector occupies a distinct cycle position. Banks may be late-cycle while IT is early-cycle. Rotate accordingly — see Sector Rotation tab.</div>
        </div>
      </Card>

      <Card title="📜 The Closing Commitment" accent={C.amber}>
        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.6 }}>
          Twenty years from now the question will not be whether this framework worked in some abstract sense. It will be whether the investor who ran this framework compounded capital at 18-22% through whatever crashes occurred between 2026 and 2046. The mathematics says yes if the discipline holds. The Indian record back to 1991 says yes. The global record back to 1900 says yes.
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 8, fontStyle: 'italic' }}>— Quantitative Research · June 2026</div>
      </Card>
    </>
  );
}

function CyclesTab() {
  const cycles = [
    { id: 1, name: 'Liquidity', emoji: '💧', color: C.cyan, lead: 'The most upstream cycle.', mech: 'Quantum of money sloshing through the financial system. When abundant, all assets bid up; when scarce, they sell off. Drivers: Fed balance sheet, RBI LAF, G4 CB liquidity, M3 growth.', leads: ['Fed/ECB/BOJ/PBOC balance-sheet change', 'RBI LAF surplus/deficit', 'India M3 growth Y/Y', 'INR/USD direction', 'DXY trajectory'] },
    { id: 2, name: 'Credit', emoji: '🏦', color: C.amber, lead: 'Liquidity intermediated through banks/NBFCs into the real economy.', mech: 'Where liquidity is the water in the reservoir, credit is the water that actually reaches the field. Credit busts (2008, 2018) produce the deepest drawdowns AND the best buying opportunities.', leads: ['Bank credit growth Y/Y', 'NBFC AUM growth', 'Corporate bond spreads AAA-AA', 'CDS on Indian banks', 'Promoter pledge ratios'] },
    { id: 3, name: 'Interest Rate', emoji: '📊', color: C.green, lead: 'The discount rate applied to all future cash flows.', mech: 'A rise compresses present-value across every asset class. A fall expands. The most direct equity input. RBI Repo Rate History 1991-2026 traced in §1.4.', leads: ['RBI repo trajectory', 'Fed funds rate path', 'US 2s/10s curve', 'Indian 10y yield', 'OIS forward curve'] },
    { id: 4, name: 'Business', emoji: '🏭', color: C.purple, lead: 'Real-economy oscillation in output, employment, capex, inventory, profits.', mech: 'Unlike the prior three (financial-sector), the business cycle is the actual economic substrate. Industrial production, capacity utilisation, capex commitments, corporate revenue/EPS growth.', leads: ['India IIP growth', 'Manufacturing PMI', 'GST collections trend', 'Capacity utilisation %', 'Corporate EPS revision direction'] },
    { id: 5, name: 'Valuation', emoji: '💎', color: C.saffron, lead: 'The price paid for a unit of earnings.', mech: 'The most observable cycle for equity investors and the only cycle that mean-reverts mechanically. Nifty trailing PE has cycled 12-30x for 35 years. Below 15x = generational buy. Above 26x = late cycle.', leads: ['Nifty trailing PE', 'Nifty forward PE', 'CAPE (10y Shiller)', 'Market Cap/GDP (Buffett indicator)', 'Earnings yield vs 10y bond'] },
    { id: 6, name: 'Sentiment', emoji: '😱', color: C.red, lead: 'The affective state of the marginal market participant.', mech: 'Marks: "The most reliable cycle, because the human emotional system has not changed in 100,000 years." Oscillates greed↔fear, mania↔depression. Inversely correlated with future returns.', leads: ['India VIX', 'Retail F&O turnover', 'IPO subscription multiples', 'Equity MF flows', 'Margin funding outstanding', 'Google trends for stock terms'] },
    { id: 7, name: 'Political', emoji: '🏛', color: C.amber, lead: 'Policy changes the rules — taxation, capital allocation, regulation.', mech: 'In India: state elections, central elections (2004, 2009, 2014, 2019, 2024), Union Budget cycles, monetary policy stance. Election shocks (2004 -17% in 1 day) are rare but recoverable.', leads: ['Election calendar', 'Budget date', 'RBI MPC dates', 'GST collections (policy proxy)', 'FDI/capex policy announcements'] },
    { id: 8, name: 'Global Capital Flows', emoji: '🌐', color: C.cyan, lead: 'India is an open EM with $700B+ FII ownership.', mech: 'FII/FPI flows are the most volatile single equity driver. Triggered by global risk-on/off, DXY direction, EM-specific catalysts. 2013 Taper Tantrum is the canonical case (FIIs dumped $13B in 5 weeks).', leads: ['FII monthly net buy/sell', 'EM-ex-China ETF flows', 'DXY level', 'US 10y yield', 'Risk-on/off proxies (CDX, VIX)'] },
  ];

  return (
    <>
      <Card title="The Eight Cycles" accent={C.cyan}>
        Markets do not move in straight lines. They oscillate. The oscillation is not random noise — it is the visible surface of eight interacting cycles. Each is observable, measurable, and follows recognisable patterns even when timing varies.
      </Card>

      {cycles.map((cy) => (
        <Card key={cy.id} title={`${cy.id}. ${cy.emoji} ${cy.name.toUpperCase()} CYCLE`} accent={cy.color}>
          <div style={{ fontWeight: 700, color: cy.color, marginBottom: 6 }}>{cy.lead}</div>
          <div style={{ fontSize: 12, color: C.text2, marginBottom: 10, lineHeight: 1.55 }}>{cy.mech}</div>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 0.4, marginBottom: 4 }}>LEADING INDICATORS</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.text2 }}>
            {cy.leads.map((l, i) => <li key={i} style={{ marginBottom: 2 }}>{l}</li>)}
          </ul>
        </Card>
      ))}

      <Card title="🔗 The Cycle Interaction Matrix (§1.10)" accent={C.purple}>
        The eight cycles do not move independently. They reinforce or dampen each other. When liquidity contracts, credit tightens, rates rise, business decelerates, valuations compress, sentiment flips fearful, political risk spikes, and global flows reverse — all simultaneously. <strong>The skill is recognising which cycle is leading</strong>. Liquidity leads → credit follows → business adjusts → valuation re-rates → sentiment confirms.
      </Card>

      <Card title="🧠 Minsky Adapted To India (§1.11)" accent={C.amber}>
        <strong>Stability breeds instability.</strong> Long periods of calm encourage risk-taking, leverage builds, fragility increases, and eventually a small shock triggers cascade. Indian Minsky moments: 2008 (NBFC/RE leverage), 2018 (IL&FS contagion), 2025 (post-budget froth). The framework: identify which entity (corporate, household, government, financial) is the marginal leverage taker and watch its collateral.
      </Card>
    </>
  );
}

function CrashbookTab() {
  const indiaCrashes = [
    { yr: '1992', name: 'Harshad Mehta Scam', dd: -54, dur: '13mo', cause: 'Bank-fraud-driven mania; G-Sec ready-forward arbitrage; ACC ₹200 → ₹9,000', valEntry: '~45x trailing PE' },
    { yr: '1997', name: 'Asian Crisis', dd: -28, dur: '11mo', cause: 'Thailand baht devaluation; EM contagion; FII outflows', valEntry: '~15x' },
    { yr: '2000', name: 'Dotcom Crash', dd: -56, dur: '17mo', cause: 'IT-services + dotcom IPO mania; Y2K hangover; global tech burst', valEntry: '~28x (IT-driven)' },
    { yr: '2001', name: 'Ketan Parekh Scam', dd: -32, dur: '8mo', cause: 'K-10 circular trading; bank-loan funding; SEBI ban', valEntry: '~18x' },
    { yr: '2004', name: 'Election Shock', dd: -17, dur: '1 day', cause: 'BJP-led NDA loss; UPA with Left support; circuit-breaker invoked', valEntry: '~14x' },
    { yr: '2008', name: 'Global Financial Crisis', dd: -65, dur: '13mo', cause: 'US subprime; Lehman; FII outflows; INR collapse', valEntry: '~28x (peak)' },
    { yr: '2011', name: 'Euro Crisis', dd: -27, dur: '14mo', cause: 'EU sovereign debt; 13 RBI hikes Mar 2010-Oct 2011', valEntry: '~22x' },
    { yr: '2013', name: 'Taper Tantrum', dd: -19, dur: '4mo', cause: 'Bernanke tapering hint; "Fragile Five" worst-hit; INR 68', valEntry: '~17x' },
    { yr: '2015', name: 'China + Yuan', dd: -23, dur: '13mo', cause: 'China deceleration; yuan devaluation; Brent $30; EM risk-off', valEntry: '~22x' },
    { yr: '2016', name: 'Demonetisation', dd: -10, dur: '2mo', cause: '86% of currency withdrawn overnight; consumer/SME shock', valEntry: '~23x' },
    { yr: '2018', name: 'NBFC Crisis', dd: -29, dur: '14mo', cause: 'IL&FS default; DHFL; PNB-Nirav Modi; small/mid-cap massacre', valEntry: '~26x' },
    { yr: '2020', name: 'COVID Crash', dd: -38, dur: '1mo', cause: 'Global pandemic; lockdowns; fastest 30% drop in history', valEntry: '~24x' },
    { yr: '2022', name: 'Inflation/Rate Hike Bear', dd: -16, dur: '10mo', cause: 'Russia-Ukraine; oil $130; Fed 525bps; CPI 7.8%', valEntry: '~24x' },
    { yr: '2024-26', name: 'Correction & Recovery', dd: -18, dur: '~14mo', cause: 'Promoter selling; FII outflows; small-cap froth; geopolitics', valEntry: '~23x' },
  ];

  return (
    <>
      <Card title="🇮🇳 Indian Crash Record 1992-2026 (§2.1-2.14)" accent={C.red}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, ...MONO }}>
            <thead>
              <tr style={{ background: C.card2 }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontSize: 10, letterSpacing: 0.3 }}>YEAR</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontSize: 10 }}>EVENT</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: C.muted, fontSize: 10 }}>NIFTY DD</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: C.muted, fontSize: 10 }}>DURATION</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontSize: 10 }}>VAL ENTERING</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontSize: 10 }}>CAUSE</th>
              </tr>
            </thead>
            <tbody>
              {indiaCrashes.map((c, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '6px 8px', color: C.cyan, fontWeight: 700 }}>{c.yr}</td>
                  <td style={{ padding: '6px 8px', color: C.text, fontWeight: 600 }}>{c.name}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: C.red, fontWeight: 700 }}>{c.dd}%</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: C.text2 }}>{c.dur}</td>
                  <td style={{ padding: '6px 8px', color: C.amber }}>{c.valEntry}</td>
                  <td style={{ padding: '6px 8px', color: C.text2, fontSize: 11 }}>{c.cause}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="📊 Cross-Event Statistical Synthesis (§2.16)" accent={C.amber}>
        <ul style={{ margin: 0, paddingLeft: 18, color: C.text2, fontSize: 13 }}>
          <li><strong style={{ color: C.text }}>Median drawdown:</strong> 28% peak-to-trough.</li>
          <li><strong style={{ color: C.text }}>Mean duration:</strong> 9.5 months from peak to trough.</li>
          <li><strong style={{ color: C.text }}>Median recovery to prior peak:</strong> 13 months.</li>
          <li><strong style={{ color: C.text }}>Forward 1y from -30% drawdown:</strong> +38% mean, +29% median.</li>
          <li><strong style={{ color: C.text }}>Forward 3y from -30%:</strong> +95% mean, +78% median.</li>
          <li><strong style={{ color: C.text }}>Universal precondition:</strong> Valuation excess (Nifty PE &gt; 24x) + leverage + euphoria. No crash without all three.</li>
        </ul>
      </Card>

      <Card title="🌍 Global Crashbook (§3.1-3.10)" accent={C.cyan}>
        <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
          {[
            ['1929 Great Depression', '-89% (Dow), 34mo recovery to peak: 25 years'],
            ['1973-74 Oil Shock + Stagflation', '-48% (S&P), 21mo'],
            ['1987 Black Monday', '-23% in 1 day (Dow), recovery: 2 years'],
            ['1990-91 Nikkei bubble burst', '-82% peak-to-trough; recovery: still incomplete after 35 years'],
            ['1997-98 Asian Crisis + LTCM', '-21% (S&P), 4mo'],
            ['2000-02 Dot-com', '-49% (S&P), -78% Nasdaq, 31mo'],
            ['2007-09 GFC', '-57% (S&P), 17mo'],
            ['2020 COVID', '-34% (S&P), 1mo (fastest)'],
            ['2022 Inflation bear', '-25% (S&P), 9mo'],
          ].map(([n, m]) => (
            <div key={n} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }}>
              <span style={{ color: C.text }}>{n}</span>
              <span style={{ color: C.muted, ...MONO, fontSize: 11 }}>{m}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="🌐 The Universal Pattern (§3.11)" accent={C.purple}>
        Every crash in 95 years featured the same six ingredients: <strong style={{ color: C.amber }}>(1) Liquidity excess</strong> for years prior · <strong style={{ color: C.amber }}>(2) Credit expansion</strong> well above nominal GDP · <strong style={{ color: C.amber }}>(3) Valuation extremes</strong> 1.5σ above mean · <strong style={{ color: C.amber }}>(4) Sector concentration</strong> (one theme drives 50%+ of index gains) · <strong style={{ color: C.amber }}>(5) Retail euphoria</strong> + media optimism · <strong style={{ color: C.amber }}>(6) Specific trigger</strong> (sometimes obvious in retrospect, never visible in advance).
      </Card>

      <Card title="🏆 The Persistence of Wealth Creators (§2.17)" accent={C.green}>
        Through all 14 Indian crashes 1992-2026: <strong>HDFC Bank, Asian Paints, Eicher Motors, Pidilite, Bajaj Finance, Marico, Nestle India</strong> each survived 4-5 drawdowns of 30%+ and compounded at 18-26% CAGR through them. The list of quality compounders that perished: <strong style={{ color: C.red }}>Reliance Power, DLF, Suzlon, Unitech, Yes Bank, Vodafone Idea, IL&FS, DHFL, Reliance Communications</strong>. The 500-point Checklist (§18) is what separates the two lists.
      </Card>
    </>
  );
}

function PreCrashTab() {
  const signatures = [
    'Nifty trailing PE > 24x (1.5σ above mean)',
    'CAPE > 30x',
    'Market Cap / GDP > 110% (Buffett indicator extreme)',
    'IPO subscription multiples > 100x; SME IPO mania',
    'Margin funding outstanding > 1.5% of market cap',
    'Retail F&O turnover > 60% of cash turnover',
    'Bank credit growth > 18% Y/Y',
    'Promoter pledge ratios rising broadly',
    'Sector concentration: one theme > 35% of index gains',
    'PE expansion without commensurate EPS growth',
    'Corporate excess: aggressive M&A, debt-funded buybacks',
    'Currency weakness with rising oil + stagflation hints',
    'Euphoric media — bears mocked publicly',
    'New highs/new lows ratio collapsing while index rises',
    'Yield curve inversion (US 2s/10s)',
  ];

  const weekly = [
    { n: 1, name: 'US 2s/10s curve', threshold: '< -50bps = caution; < -100bps = danger' },
    { n: 2, name: 'India yield curve', threshold: 'Flattening Y/Y' },
    { n: 3, name: 'US HY OAS', threshold: '> 500bps = caution; > 700bps = danger' },
    { n: 4, name: 'India PMI Composite', threshold: '< 50 = caution; < 47 = danger' },
    { n: 5, name: 'Nifty trailing PE', threshold: '> 24x = caution; > 27x = danger' },
    { n: 6, name: 'India VIX', threshold: '> 22 = elevated; > 30 = panic regime' },
    { n: 7, name: 'FII monthly net flow', threshold: 'Net outflow > $3B 2 months running' },
    { n: 8, name: 'Market breadth (% > 200DMA)', threshold: '< 40% while index near high = divergence' },
    { n: 9, name: 'Promoter pledge breadth', threshold: 'Rising in top-100 names' },
    { n: 10, name: 'IPO subscription median', threshold: '> 50x sustained' },
    { n: 11, name: 'Bank credit growth', threshold: '> 18% Y/Y = late cycle' },
    { n: 12, name: 'DXY trajectory', threshold: 'Rising fast = EM headwind' },
  ];

  return (
    <>
      <Card title="🎯 The Forensics Of A Top (§4.0)" accent={C.amber}>
        Tops are not events. Tops are processes. Every Indian top 1992-2026 was preceded by the same 15 signatures, accumulated over 6-18 months. The skill is recognising the regime, not predicting the exact day.
      </Card>

      <Card title="✅ The 15 Pre-Crash Signature Checklist (§4.13)" accent={C.red}>
        <div style={{ display: 'grid', gap: 6 }}>
          {signatures.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.text2 }}>
              <span style={{ display: 'inline-block', minWidth: 22, height: 22, borderRadius: 4, border: `1px solid ${C.borderStrong}`, color: C.muted, fontWeight: 800, textAlign: 'center', lineHeight: '22px', fontSize: 10 }}>{i + 1}</span>
              {s}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, padding: 10, background: C.card2, borderRadius: 6, fontSize: 12, lineHeight: 1.6 }}>
          <strong style={{ color: C.cyan }}>Reading the score:</strong><br />
          <span style={{ color: C.green }}>0-3 signals</span> · healthy or early bull · stay invested<br />
          <span style={{ color: C.amber }}>4-6 signals</span> · mid-to-late cycle · monitor weekly, begin trimming the most expensive<br />
          <span style={{ color: C.red }}>7-9 signals</span> · late cycle · raise cash from 5% to 20-30%<br />
          <span style={{ color: C.red, fontWeight: 700 }}>10+ signals</span> · acute systemic risk · cash 30-40%, staircase armed<br />
        </div>
      </Card>

      <Card title="📅 The 12 Indicators Every Indian Investor Should Track Weekly (§5.29)" accent={C.cyan}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Thirty minutes every Saturday morning. Record against thresholds. Caution/danger counts feed the regime decision.</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.card2 }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontSize: 10, width: 30 }}>#</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontSize: 10 }}>INDICATOR</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontSize: 10 }}>THRESHOLD</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((w) => (
                <tr key={w.n} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '6px 8px', color: C.cyan, fontWeight: 700 }}>{w.n}</td>
                  <td style={{ padding: '6px 8px', color: C.text }}>{w.name}</td>
                  <td style={{ padding: '6px 8px', color: C.amber, fontSize: 11, ...MONO }}>{w.threshold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="🧭 The Howard Marks 'Where Are We?' Framework (§5.27)" accent={C.saffron}>
        <div style={{ fontSize: 13, color: C.text2, marginBottom: 8 }}>Marks' formulation strips out the prediction question entirely. He proposes continuous self-interrogation:</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: C.text }}>
          <li>Are <strong>valuations</strong> high or low?</li>
          <li>Are <strong>spreads</strong> tight or wide?</li>
          <li>Is <strong>sentiment</strong> euphoric or depressed?</li>
          <li>Is <strong>liquidity</strong> abundant or scarce?</li>
          <li>Is <strong>leverage</strong> rising or falling?</li>
          <li>Are <strong>IPOs</strong> being eagerly received?</li>
          <li>Is <strong>credit</strong> being eagerly extended?</li>
        </ul>
        <Quote text="The most dangerous thing is to not appreciate how dangerous things have become. The second most dangerous thing is to fail to act on that appreciation." who="Howard Marks · Mastering the Market Cycle" />
      </Card>

      <Card title="⏰ The Honest Truth on Timing (§5.28)" accent={C.red}>
        <ul style={{ margin: 0, paddingLeft: 18, color: C.text2 }}>
          <li>Predicting tops within <strong style={{ color: C.amber }}>3-6 months</strong> is feasible based on regime indicators.</li>
          <li>Predicting tops within <strong style={{ color: C.red }}>weeks</strong> is not feasible with reliable accuracy. Anyone claiming otherwise is mistaken, lying, or lucky for now.</li>
          <li>Bottoms are easier than tops because capitulation has structural signatures (volume, breadth, sentiment surveys, VIX spikes).</li>
          <li><strong style={{ color: C.text }}>The cost of being early is asymmetric.</strong> Defensive 18 months early forgoes 25-40% of the final-stage rally. Defensive 6 months late suffers 30-40% of the drawdown.</li>
          <li>The useful question is not "when will this top?" but <strong style={{ color: C.cyan }}>"what is my drawdown tolerance and capital posture if this tops in the next 12 months?"</strong></li>
        </ul>
      </Card>
    </>
  );
}

function DeploymentTab() {
  const stair = [
    { trig: '-10%', tranche: '10%', cum: '10%', tag: 'Routine pullback. Resist temptation to lumpsum.', color: C.green },
    { trig: '-15%', tranche: '+15%', cum: '25%', tag: 'Real correction. First serious deploy.', color: C.green },
    { trig: '-20%', tranche: '+20%', cum: '45%', tag: 'Mid-cycle bear. Asymmetry building.', color: C.amber },
    { trig: '-25%', tranche: '+15%', cum: '60%', tag: 'Late-cycle bear. Press but reserve.', color: C.amber },
    { trig: '-30%', tranche: '+20%', cum: '80%', tag: 'Generational entry begins.', color: C.red },
    { trig: '-40%+', tranche: '+20%', cum: '100%', tag: 'Maximum aggression. Druckenmiller "press the bet".', color: C.red },
  ];

  return (
    <>
      <Card title="🪜 The Staircase Deployment Protocol (§7.7)" accent={C.cyan}>
        <div style={{ fontSize: 12, color: C.text2, marginBottom: 10 }}>The deployable cash bucket is the cash you have set aside <strong>specifically for buying corrections</strong> — distinct from emergency fund, operational cash, short-term goals. Reference for all triggers: % drop from 52-week high. The bucket does not reset until the index makes a new 52-week high.</div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.card2 }}>
                <th style={{ textAlign: 'left', padding: '8px', color: C.muted, fontSize: 10 }}>TRIGGER</th>
                <th style={{ textAlign: 'right', padding: '8px', color: C.muted, fontSize: 10 }}>TRANCHE</th>
                <th style={{ textAlign: 'right', padding: '8px', color: C.muted, fontSize: 10 }}>CUMULATIVE</th>
                <th style={{ textAlign: 'left', padding: '8px', color: C.muted, fontSize: 10 }}>NOTE</th>
              </tr>
            </thead>
            <tbody>
              {stair.map((s, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '8px', color: s.color, fontWeight: 800, ...MONO }}>{s.trig}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: C.text, fontWeight: 700, ...MONO }}>{s.tranche}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: C.cyan, fontWeight: 800, ...MONO }}>{s.cum}</td>
                  <td style={{ padding: '8px', color: C.text2, fontSize: 12 }}>{s.tag}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: C.text2, lineHeight: 1.55 }}>
          <strong style={{ color: C.amber }}>Why the early tranches are smaller:</strong> the data demands it. Forward 1y at -10% is +17%. At -30% is +38%. At -50% is +60-80%. The Druckenmiller principle of <em>"press the bet"</em> applies when asymmetry is overwhelming — you do not whisper, you go.
        </div>
      </Card>

      <Card title="❌ The Five Cardinal Errors of Deployment (§7.10)" accent={C.red}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div><strong style={{ color: C.red }}>1. Treating every 5-8% pullback as a deploy opportunity.</strong> By the time the real correction arrives, the bucket is empty. <em>Discipline: bucket is sacred for 15%+ drops. SIPs continue regardless.</em></div>
          <div><strong style={{ color: C.red }}>2. Calling -20% "the bottom" and lumpsumming.</strong> The index drops another 15%, you run out of capital just as asymmetry peaks. <em>Discipline: staircase has no "bottom call".</em></div>
          <div><strong style={{ color: C.red }}>3. Buying broken businesses cheap.</strong> DLF -30% in 2008. DHFL -40% in 2018. Vodafone Idea -60% in 2020. <em>Discipline: deploy into quality compounders ONLY. Cheap junk gets cheaper.</em></div>
          <div><strong style={{ color: C.red }}>4. Selling too early into the bounce.</strong> First 30% bounce from trough is mechanical short-cover. Real run starts 6-9 months later. <em>Discipline: do not trim before the bucket is fully deployed.</em></div>
          <div><strong style={{ color: C.red }}>5. Failure to pre-commit.</strong> Without a written staircase, the brain in panic rationalises sitting on cash. <em>Discipline: write it, tape it to the monitor.</em></div>
        </div>
      </Card>

      <Card title="💰 The Cash Allocation Playbook (§8.11)" accent={C.green}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Tag label="REGIME 1" color={C.green} />
            <div><strong>Normal markets</strong> (Nifty PE 18-22, mixed signals). <strong style={{ color: C.green }}>Cash 10-15%</strong>. Standard SIPs. Periodic rebalances. <em>90% of years live here.</em></div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Tag label="REGIME 2" color={C.amber} />
            <div><strong>Cautious markets</strong> (Nifty PE 22-28, multiple pre-crash signals firing). <strong style={{ color: C.amber }}>Cash 20-35%</strong>. SIPs continue but no fresh lumpsum. Staircase armed.</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Tag label="REGIME 3" color={C.red} />
            <div><strong>Active correction</strong> (Nifty -15%+ from 52w high). <strong style={{ color: C.red }}>Quarterly cycle suspended</strong>. Section 7 Staircase Protocol takes over. Deploy mechanically per the staircase.</div>
          </div>
        </div>
      </Card>

      <Card title="📐 Position Sizing — Kelly Adapted (§9.4)" accent={C.purple}>
        <div style={{ background: C.card2, padding: '8px 12px', borderRadius: 6, marginBottom: 8 }}>
          <div style={{ ...MONO, fontSize: 14, color: C.cyan, textAlign: 'center', fontWeight: 700 }}>f* = (b·p − q) / b</div>
          <div style={{ ...MONO, fontSize: 13, color: C.amber, textAlign: 'center', marginTop: 6 }}>Investing form: f* ≈ Expected return / Variance</div>
        </div>
        <div style={{ fontSize: 12, color: C.text2 }}>Position size should rise with expected return and fall with variance. Two stocks with the same expected return but different volatilities should be sized differently. <strong>Indian application:</strong> max 8-10% single-name exposure for retail (Kelly fractional, 0.25-0.5×). Concentration above this requires institutional research depth.</div>
      </Card>

      <Card title="📈 Druckenmiller's Rule — Add To Winners (§9.5)" accent={C.green}>
        Positions that work should be added to, not trimmed. The instinct to "lock in profits" by trimming winners is the single most expensive instinct in investing. <strong>The trim-on-double strategy on Bajaj Finance (2010 entry) reduced terminal wealth by 80%.</strong> The add-on-drawdown strategy increased it by 50%. <em>Trim only on thesis impairment or extreme valuation (PE &gt; 40x on quality compounders, or above sector cap).</em>
      </Card>

      <Card title="✂️ Munger's Rule — Cut Losers (§9.6)" accent={C.red}>
        Do not add to losers when the thesis is broken. <strong>Honest test before averaging down:</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: 18, color: C.text2 }}>
          <li>Is the moat intact? New competition (telcos 2017, paints 2025) = moat degraded.</li>
          <li>Is the management intact? Pledging, governance flags, executive exits = stop.</li>
          <li>Is the balance sheet intact? D/E rising fast = stop.</li>
          <li>Is the sector tailwind intact? Cycle turn for cyclicals = stop.</li>
        </ul>
        If any answer is "no" — sell, do not average.
      </Card>
    </>
  );
}

function RotationTab() {
  const phases = [
    { name: 'EARLY BULL', emoji: '🌱', color: C.green, regime: 'Repo cutting · capacity util 65-70% · credit growth 8-12% · sentiment depressed', tilt: '30% IT services · 25% private banks · 20% auto · 15% early capital goods · 10% cash', leaders: 'TCS, HDFC Bank, Maruti, L&T, Bharat Forge' },
    { name: 'MID BULL', emoji: '🌳', color: C.cyan, regime: 'Repo stable · capacity util 75-82% · credit growth 13-16% · earnings revisions positive', tilt: '25% private banks · 20% consumer discretionary · 20% pharma · 15% FMCG · 10% IT · 10% mid-caps', leaders: 'HDFC Bank, Trent, Sun Pharma, ITC, Eicher' },
    { name: 'LATE BULL', emoji: '🌋', color: C.amber, regime: 'Repo hiking · capacity util > 85% · credit growth > 18% · retail F&O peak · IPO mania', tilt: 'Reduce equity · raise cash to 25-40% · within equity, defensive bias (FMCG, pharma, IT)', leaders: 'HUL, Nestle, Dr Reddy, TCS' },
    { name: 'CORRECTION', emoji: '❄️', color: C.red, regime: 'Drawdown phase · falling EPS revisions · widening spreads · VIX > 25', tilt: '40-50% cash · 30% FMCG/pharma/IT defensives · 20% gold/debt', leaders: 'Hold defensives · pre-commit watchlist for trough' },
    { name: 'RECOVERY', emoji: '🔥', color: C.purple, regime: 'Repo cutting fast · capacity util troughing · breadth thrust · panic peak', tilt: '35% financials · 20% industrials · 15% discretionary · 15% IT · 10% utilities · 5% cash', leaders: 'Druckenmiller phase — press financials + industrials hard' },
  ];

  return (
    <>
      <Card title="🌀 The Logic of Sector Rotation (§11.1)" accent={C.cyan}>
        Beyond the index-level cycle, each major sector occupies a distinct cycle position. Banks may be late-cycle while IT is early-cycle. The operating manual rotates the portfolio across the five phases below, biased by the dominant regime indicator: <strong>repo rate trajectory, capacity utilisation, credit growth, EPS revision direction, mid-cap leadership, IPO volumes, retail activity.</strong>
      </Card>

      {phases.map((p, i) => (
        <Card key={i} title={`${i + 1}. ${p.emoji} ${p.name}`} accent={p.color}>
          <div style={{ display: 'grid', gap: 6 }}>
            <div><strong style={{ color: C.muted, fontSize: 10, letterSpacing: 0.4 }}>REGIME</strong><div style={{ color: C.text2, fontSize: 12 }}>{p.regime}</div></div>
            <div><strong style={{ color: C.muted, fontSize: 10, letterSpacing: 0.4 }}>SECTOR TILT</strong><div style={{ color: p.color, fontSize: 12, fontWeight: 600 }}>{p.tilt}</div></div>
            <div><strong style={{ color: C.muted, fontSize: 10, letterSpacing: 0.4 }}>LEADERS</strong><div style={{ color: C.text2, fontSize: 12, ...MONO }}>{p.leaders}</div></div>
          </div>
        </Card>
      ))}

      <Card title="💎 The Valuation Discipline (§12.7)" accent={C.saffron}>
        <ul style={{ margin: 0, paddingLeft: 18, color: C.text2, fontSize: 12 }}>
          <li><strong style={{ color: C.text }}>Quality compounders</strong>: 22-35x trailing PE acceptable. Above 40x requires explicit thesis (10y+ runway, ROCE &gt; 25%, market leadership).</li>
          <li><strong style={{ color: C.text }}>Cyclicals (steel, real estate, capital goods)</strong>: avoid above 14x peak EPS. Peak EPS × peak PE = double destruction when the cycle turns.</li>
          <li><strong style={{ color: C.text }}>PSUs</strong>: governance discount; avoid above 25x (BHEL 45x, BEL 50x, HAL 50x in 2024 = late-cycle).</li>
          <li><strong style={{ color: C.text }}>Margin of safety</strong>: turnarounds 50%+ buffer · mature cyclicals 30-40% · large-cap compounders 15-25%.</li>
        </ul>
      </Card>
    </>
  );
}

function PsychologyTab() {
  const biases = [
    { n: 1, name: 'Amygdala Hijack', body: 'Panic at -5% intraday triggers same biology as physical danger. Prefrontal blood flow drops 30% — you are literally not the same brain. Countermeasure: 48-hour rule, physical movement, re-read pre-committed plan.' },
    { n: 2, name: 'FOMO / Reward-Centre Activation', body: 'Watching peers compound triggers dopamine craving stronger than your own gains. Countermeasure: hide social media; track your own framework, not the loudest neighbour.' },
    { n: 3, name: 'Loss Aversion (2:1)', body: 'A ₹1 loss hurts 2× as much as a ₹1 gain feels good. Drives premature selling of winners + holding losers. Countermeasure: pre-commit sell rules tied to thesis, not price.' },
    { n: 4, name: 'Anchoring', body: 'Stuck on entry price as a reference. "I will sell when it gets back to ₹500." Countermeasure: every quarter ask "would I buy this today at this price?"' },
    { n: 5, name: 'Confirmation Bias', body: 'Reading only bullish/bearish takes that agree with current positioning. Countermeasure: maintain a "thesis-killer" list — what would prove me wrong.' },
    { n: 6, name: 'Recency Bias', body: 'Treating last 3 years as the future. 2003-07 bull made everyone a momentum genius. 2025 SME IPO mania = same pattern. Countermeasure: study 35-year history (Crashbook tab).' },
    { n: 7, name: 'Disposition Effect', body: 'Selling winners early, holding losers forever. Inverse of what works. Countermeasure: Druckenmiller rule (add to winners), Munger rule (cut losers).' },
    { n: 8, name: 'Herd Behaviour', body: 'Buying when WhatsApp groups are euphoric, selling when CNBC is panicked. Countermeasure: do the opposite mechanically.' },
    { n: 9, name: 'Sunk Cost Fallacy', body: '"I have already lost 40% — I will hold for breakeven." Countermeasure: the question is forward, never backward.' },
    { n: 10, name: 'Overconfidence', body: 'Three lucky picks → believing you have an edge. Countermeasure: journal every decision, review quarterly, force humility.' },
    { n: 11, name: 'Narrative Fallacy', body: 'Brain prefers stories over base rates. "EVs will compound 50% for 20 years" sounds true; the base rate of any sector compounding 50% for 20y is ~0%.' },
    { n: 12, name: 'Authority Bias', body: 'Buying because Buffett/Jhunjhunwala did. They have a different time horizon, tax position, and information set. Countermeasure: borrow framework, not picks.' },
  ];

  return (
    <>
      <Card title="🧠 The Mental Game (§13.1)" accent={C.purple}>
        The brain in panic is not the brain that wrote the thesis. The single largest source of long-term underperformance is behavioural — not stock selection. The 12 biases below appear in every Indian crash record from 1992 to 2026.
      </Card>

      <Card title="❌ The Twelve Destructive Biases (§13.2)" accent={C.red}>
        <div style={{ display: 'grid', gap: 10 }}>
          {biases.map((b) => (
            <div key={b.n} style={{ borderTop: b.n > 1 ? `1px solid ${C.border}` : 'none', paddingTop: b.n > 1 ? 8 : 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: C.red, fontWeight: 800, ...MONO, minWidth: 22 }}>{b.n}.</span>
                <strong style={{ color: C.text, fontSize: 13 }}>{b.name}</strong>
              </div>
              <div style={{ fontSize: 12, color: C.text2, marginLeft: 30, marginTop: 3, lineHeight: 1.55 }}>{b.body}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="🛡 The Crash Behavioural Protocol (§13.4)" accent={C.amber}>
        <div style={{ fontSize: 12, color: C.text2, marginBottom: 10 }}>Pre-committed, operationalised. Print it. Tape it to your monitor. Read it when the screen is red.</div>
        <Quote text="What the wise man does in the beginning, the fool does in the end. Buying when everyone is selling is uncomfortable but profitable." who="Howard Marks" />
        <Quote text="Be fearful when others are greedy. Be greedy when others are fearful. Time in the market beats timing the market — but the patient investor wins both." who="Warren Buffett" />
        <Quote text="I'm only rich because I know when I'm wrong. The market doesn't care about your ego. Pivot when the facts change." who="Stan Druckenmiller" />

        <div style={{ marginTop: 10, padding: 12, background: C.card2, borderRadius: 6, fontSize: 12, lineHeight: 1.7 }}>
          <strong style={{ color: C.cyan }}>Operational rules during corrections &gt;8% from peak:</strong>
          <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
            <li>Mute CNBC, ET Now, BloombergQuint for at least one week.</li>
            <li>48-hour rule: no trading decisions for 48 hours after a 5%+ intraday drop.</li>
            <li>Physical movement before checking screens (walk, 50 pushups).</li>
            <li>Re-read your written investment policy. Trust the staircase, not the panic.</li>
            <li>Open the journal: what did you commit to last quarter?</li>
          </ul>
        </div>
      </Card>

      <Card title="📦 The Indian Practitioner's Crash Survival Kit (§13.6)" accent={C.green}>
        <ul style={{ margin: 0, paddingLeft: 18, color: C.text2 }}>
          <li><strong>Investment Policy Statement</strong> (written in calm times) — target allocation, rebalance thresholds, cash rules.</li>
          <li><strong>Curated watchlist with pre-committed buy triggers</strong> — three columns: name, current price, trigger price.</li>
          <li><strong>Investment journal</strong> — every Buy/Sell/Hold decision with thesis in 200 words + 3-year expected return + what would prove me wrong.</li>
          <li><strong>Crisis reading list</strong> — Marks memos, Buffett shareholder letters, Marcellus notes. Read during panic.</li>
          <li><strong>Quarterly review ritual</strong> — past entries become the data set for understanding your own biases.</li>
        </ul>
      </Card>
    </>
  );
}

function EliteTab() {
  const rules = [
    { n: 1, t: 'Always Have Cash', body: 'Buffett: $40-128B. Marks: $5-15B undeployed. Druckenmiller: variable but always meaningful. Jhunjhunwala: significant. The investor with no cash during a crisis cannot deploy. Indian SIP investor equivalent: 10-20% cash sleeve regardless of how good markets look.' },
    { n: 2, t: 'Read During Panic', body: 'Druckenmiller re-read Soros in Oct 1987. Marks wrote memos through every crisis. Lynch read shareholder letters constantly. The act of reading articulates the framework. Maintain a "crisis reading list".' },
    { n: 3, t: 'Pre-Commit The Framework', body: 'Every elite investor had a pre-written rule set. Buffett: "be greedy when others are fearful." Marks: distressed fund vehicle. Lynch: PEG-driven screen. The pre-commitment is what survives the moment of panic.' },
    { n: 4, t: 'Concentrate When You Have Edge', body: 'Munger: 3 stocks for 50% of portfolio. Druckenmiller: "When I have high conviction I bet 30% of fund." Kacholia: "Concentrate when you have conviction, diversify when you do not." Edge requires concentration.' },
    { n: 5, t: 'Time-Horizon Asymmetry', body: 'Every elite operates on 3-10y horizon while the median investor operates on 3-10 month horizon. The horizon mismatch IS the edge. Anyone willing to hold 5 years has structural alpha over anyone holding 5 months.' },
    { n: 6, t: 'Quality > Cheap', body: 'Buffett pivoted from Graham (cheap) to Munger (quality at fair price) and compounded faster. The Indian record agrees — Asian Paints at 50x outperformed L&T at 12x over 25 years.' },
    { n: 7, t: 'Add To Winners, Cut Losers', body: 'The Druckenmiller-Munger pair. Inverse of retail instinct. The single largest behavioural delta between elite and median.' },
    { n: 8, t: 'Survive First, Compound Second', body: 'No elite investor blew up. Marks: "The first goal is not to lose money." Risk management precedes return generation. Survival = staying in the game for the next 30 cycles.' },
    { n: 9, t: 'Build A Curated Universe Of 30-50 Names', body: 'Elite investors do not screen 5,000 names quarterly. They watch 30-50 deeply, with pre-committed triggers. The crash is when the trigger fires.' },
    { n: 10, t: 'Journal Every Decision', body: 'Lynch journaled. Marks wrote memos. Jhunjhunwala kept notebooks. Without the journal there is no learning loop. With it, every cycle teaches.' },
  ];

  const afterDouble = [
    { n: 1, t: 'Default to hold', body: 'The base case after a position doubles is to do nothing. Action requires affirmative justification. The historical record across Indian and global compounders demonstrates this overwhelmingly.' },
    { n: 2, t: 'Examine the thesis before the price', body: 'The first question is not "should I trim?" but "is the business thesis still intact?" If yes, the trim question is secondary. If no, the trim question is moot — exit fully.' },
    { n: 3, t: 'Trim only the expensive, never the cheap', body: 'Quality compounders at moderate PE (15-25x) should be held through gains, even 500-1000%. Quality compounders at extreme PE (&gt;40x) merit partial trim.' },
    { n: 4, t: 'Use regime indicators, not gut feel', body: 'When 7+ of the 12 indicators (Pre-Crash tab) flash caution, raise cash from baseline 5% to 15-20%. When &lt; 4 indicators flash caution, deploy.' },
    { n: 5, t: 'Never fully exit a quality compounder', body: 'The single largest unforced error in Indian retail investing is full exit from an Asian Paints, an HDFC Bank, an Eicher Motors at early-stage gains.' },
    { n: 6, t: 'Tax-aware trimming', body: 'Post-July 2024 LTCG at 12.5% (was 10%). A 20-year hold pays tax once on cumulative gain. A trim-every-double pays 10 times. Tax compounds against trimmers.' },
    { n: 7, t: 'Pre-commit the trim rule', body: 'Write it: "If PE &gt; 45x AND 7+ regime indicators flash caution, trim 25%." Mechanical execution beats gut feel through every cycle.' },
  ];

  return (
    <>
      <Card title="🦅 The Ten Elite-Investor Playbook Rules (§14.13)" accent={C.cyan}>
        <div style={{ fontSize: 12, color: C.text2, marginBottom: 10 }}>After studying eleven elite investors (Buffett, Druckenmiller, Marks, Lynch, Pabrai, Sleep, Jhunjhunwala, Damani, Kela, Mukherjea, Naren) across six major crises, the patterns converge. The framework below is the synthesis.</div>
        <div style={{ display: 'grid', gap: 12 }}>
          {rules.map((r) => (
            <div key={r.n} style={{ borderTop: r.n > 1 ? `1px solid ${C.border}` : 'none', paddingTop: r.n > 1 ? 10 : 0 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ minWidth: 28, height: 28, borderRadius: '50%', background: `${C.cyan}25`, color: C.cyan, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>{r.n}</span>
                <strong style={{ color: C.text, fontSize: 13 }}>{r.t}</strong>
              </div>
              <div style={{ fontSize: 12, color: C.text2, marginLeft: 38, marginTop: 4, lineHeight: 1.55 }}>{r.body}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="💰 The 7 Rules After Portfolio Doubles (§6.10)" accent={C.green}>
        <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', marginBottom: 10 }}>The operational distillation. Print this list. Tape it inside the cover of your investment journal.</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {afterDouble.map((r) => (
            <div key={r.n} style={{ borderTop: r.n > 1 ? `1px solid ${C.border}` : 'none', paddingTop: r.n > 1 ? 8 : 0 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: C.green, fontWeight: 800, ...MONO, minWidth: 26 }}>R{r.n}.</span>
                <strong style={{ color: C.text, fontSize: 13 }}>{r.t}</strong>
              </div>
              <div style={{ fontSize: 12, color: C.text2, marginLeft: 34, marginTop: 4, lineHeight: 1.55 }}>{r.body}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="🏆 The Final Synthesis (§14.15)" accent={C.amber}>
        <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
          <div><strong style={{ color: C.cyan }}>On framework:</strong> Build a multi-decade investment philosophy in 500 words. Do not change it in reaction to a crisis. Apply it through every crisis.</div>
          <div><strong style={{ color: C.cyan }}>On execution:</strong> Maintain a 10-20% cash sleeve. Maintain a curated watchlist with pre-committed buy triggers. Execute mechanically when triggers hit during crashes.</div>
          <div><strong style={{ color: C.cyan }}>On psychology:</strong> The brain in panic is not the brain that wrote the thesis. Use the 48-hour rule. Trust the pre-committed plan. Read your journal during the worst moments.</div>
        </div>
        <Quote text="The Indian investor with thirty years of investing ahead has the rarest gift available in markets: time. The framework above, applied with discipline through the next five crises (and there will be five), is sufficient to compound capital at 18-22% CAGR for two decades." who="Quantitative Research, June 2026" />
      </Card>

      <Card title="📖 The Five Best Books On Cycles" accent={C.purple}>
        <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
          <div>1. <strong>Howard Marks</strong> — <em>Mastering the Market Cycle</em> (cycles & pendulums)</div>
          <div>2. <strong>Ray Dalio</strong> — <em>Principles for Navigating Big Debt Crises</em> (Minsky + macro)</div>
          <div>3. <strong>Peter Lynch</strong> — <em>One Up On Wall Street</em> (stock-picking + valuation discipline)</div>
          <div>4. <strong>Ben Graham</strong> — <em>The Intelligent Investor</em> (margin of safety + temperament)</div>
          <div>5. <strong>Saurabh Mukherjea</strong> — <em>Coffee Can Investing / The Unusual Billionaires</em> (Indian compounder framework)</div>
        </div>
      </Card>
    </>
  );
}

const CHECKLIST_500: { n: number; emoji: string; name: string; questions: string[] }[] = [
  { n: 1, emoji: '🏛', name: "Business Model Durability",
    questions: [
      "Is the core product or service still in demand five years from now under reasonable assumptions?",
      "Has the customer’s underlying need (functional, emotional, status) remained stable for at least 5 years?",
      "Is the business model still cash-generative without subsidies, promotional spending, or unsustainable working capital extensions?",
      "Has the business successfully extended into adjacent products/services in the last 3 years?",
      "Is there a credible 10-year growth runway based on penetration, geography, category extension, or pricing?",
      "Has the company demonstrated category leadership in at least 2 distinct economic cycles?",
      "Is the business model resilient to a 30% drop in volumes for 12 months?",
      "Are recurring revenues at least 30% of total revenue (subscriptions, contracts, repeat purchases)?",
      "Is the customer-acquisition cost stable or declining over 3 years?",
      "Is customer retention rate above 85% for B2C and 90% for B2B?",
      "Does the business model improve with scale (rising margins, falling per-unit costs)?",
      "Has the business successfully reinvented its core product or distribution at least once in the last decade?",
      "Is the supply chain robust against single-source dependencies?",
      "Is the business model defensible against a well-funded new entrant with $1bn capital?",
      "Has the business model been validated in multiple geographies or sub-markets?",
      "Does the business model have meaningful network effects, platform effects, or two-sided market dynamics?",
      "Is the pricing structure (margin × volume × frequency) stable across cycles?",
      "Has the unit economics (LTV/CAC, gross margin, contribution margin) improved over 3 years?",
      "Is the business model regulated in a way that creates entry barriers rather than profit ceilings?",
      "Would the business model survive 2 years of zero new customer acquisition?",
    ] },
  { n: 2, emoji: '🛡', name: "Competitive Moat Status",
    questions: [
      "Has market share been stable or rising over the last 5 years?",
      "Has the gross margin been stable or rising over the last 5 years?",
      "Are there at least 3 named structural moats (brand, scale, distribution, switching cost, network effect, regulatory, IP, cost advantage)?",
      "Has the company successfully defended against at least one credible new entrant?",
      "Is the moat strengthening, stable, or eroding (with evidence)?",
      "Are customer-switching costs measurable and meaningful?",
      "Does the company own its distribution channel sufficiently to prevent disintermediation?",
      "Is the brand the dominant choice in unprompted recall surveys?",
      "Does the company have pricing power demonstrated by past price increases without volume loss?",
      "Is there a meaningful gap (>200 bps) in ROCE versus the nearest competitor?",
      "Has the company successfully resisted a major price-discount competitor?",
      "Are competitive responses to company actions slow (>12 months) and partial?",
      "Does scale provide cost advantages of at least 5% on COGS versus #3-5 players?",
      "Is the company’s R&D / innovation pipeline ahead of competitors?",
      "Is the talent base — management, key technical staff, sales — stable and not poachable?",
      "Do customers measure the company on quality more than price?",
      "Is the company’s brand premium quantifiable in price-per-unit data versus generic?",
      "Has the company successfully entered any competitor’s home market in the last 5 years?",
      "Are competitive losses (lost contracts, deserted customers, displaced sales) below 5% per year?",
      "Is the moat sustainable through a 50% input cost shock?",
    ] },
  { n: 3, emoji: '👔', name: "Management Quality & Tenure",
    questions: [
      "Has the CEO been in role for at least 5 years (or successor groomed visibly for 2+)?",
      "Does the CEO have substantial personal ownership (>5% for promoter CEO, >1% for hired CEO)?",
      "Has management consistently delivered on stated 3-year guidance?",
      "Has management demonstrated honest communication during downturns (no misleading earnings calls)?",
      "Is the CFO experienced, with at least 5-year tenure and clean audit history?",
      "Are board members independent in substance, not just form?",
      "Has management successfully navigated at least one major industry crisis or regulation change?",
      "Is the senior leadership team (CXOs) stable, with <15% annual turnover?",
      "Has management voluntarily acknowledged a past strategic mistake publicly?",
      "Does management share visibly in shareholder pain (no excessive bonuses during loss years)?",
      "Is management compensation reasonable relative to peer industry?",
      "Has the management team been built from within or recruited externally with success?",
      "Does management have a clear succession plan publicly articulated?",
      "Has management successfully integrated at least one acquisition?",
      "Is the management’s investor communication consistent and substantive (no spin)?",
      "Has management avoided related-party transactions that disadvantage minority shareholders?",
      "Does management focus on long-term wealth creation versus short-term EPS optimization?",
      "Has the management proactively managed regulatory risk?",
      "Is management’s vision for the business clear, articulated, and credible?",
      "Would I trust this management team with another 20% of my portfolio?",
    ] },
  { n: 4, emoji: '🤝', name: "Promoter Integrity",
    questions: [
      "Has the promoter family/group maintained or increased holding over the last 5 years?",
      "Are promoter pledges below 10% of holding?",
      "Have there been any related-party transactions in the last 3 years that disadvantage minority shareholders?",
      "Has the promoter been investigated, fined, or prosecuted by any regulator?",
      "Is the promoter’s other listed/unlisted business activity consistent with high standards?",
      "Has the promoter avoided significant insider trading flags?",
      "Has the promoter clearly delineated personal wealth from company wealth?",
      "Is the promoter’s lifestyle (visible) consistent with stated commitment to long-term value creation?",
      "Has the promoter publicly committed to specific shareholder-returns policies (dividends, buybacks)?",
      "Has the promoter avoided unrelated diversification destructive to shareholder value?",
      "Is the promoter family’s next generation visibly engaged in or transitioning from the business?",
      "Has the promoter avoided personal endorsement of speculative investments via company resources?",
      "Are promoter-loan-against-shares transactions transparent and disclosed?",
      "Has the promoter demonstrated ability to attract top-tier external talent?",
      "Has the promoter maintained ethical relationships with regulators, employees, customers?",
      "Are promoter dividend payouts consistent with company’s stated dividend policy?",
      "Has the promoter avoided manipulating earnings to support stock price?",
      "Has the promoter shown long-term skin in the game during downturns (no significant pledging during stress)?",
      "Has the promoter avoided actions that suggest impending exit (e.g., progressive stake reduction)?",
      "Would I be comfortable investing in any other business this promoter starts?",
    ] },
  { n: 5, emoji: '💰', name: "Financial Health",
    questions: [
      "Is net debt-to-equity below 0.5x?",
      "Is interest coverage above 6x?",
      "Is the current ratio above 1.5x?",
      "Has working capital been stable as % of revenue?",
      "Has debt-to-EBITDA stayed below 2x for 5 years?",
      "Is the cash conversion cycle stable or improving?",
      "Has the company avoided emergency rights issues, qualified institutional placements at distressed prices?",
      "Are the credit ratings (CRISIL, ICRA) stable AA- or above?",
      "Has goodwill on balance sheet stayed below 25% of equity?",
      "Are contingent liabilities disclosed and immaterial (<15% of equity)?",
      "Are receivables aging-profiles healthy (>90% under 90 days)?",
      "Has inventory turnover been stable or improving?",
      "Have the auditors been stable and reputable (Big 4 or established Indian firm)?",
      "Is the proportion of pension/employee benefit obligations to equity manageable?",
      "Are forex hedging policies prudent and disclosed?",
      "Are off-balance-sheet structures (SPVs, JVs) transparent?",
      "Has the company avoided complex derivative exposures?",
      "Are minority interest reserves treated transparently?",
      "Has the company maintained adequate insurance against operational risks?",
      "Would a stress scenario of 30% revenue decline still leave the company solvent?",
    ] },
  { n: 6, emoji: '📈', name: "Earnings Trajectory",
    questions: [
      "Has earnings (PAT) grown at least 15% CAGR over the last 5 years?",
      "Has revenue grown at least 12% CAGR over the last 5 years?",
      "Has the company avoided declining earnings in more than 2 of the last 10 years?",
      "Has earnings quality (PAT vs. CFO) been stable, with CFO/PAT >0.85?",
      "Are next-12-month earnings estimates rising over the last 3 quarters?",
      "Have quarterly results consistently exceeded or matched consensus by >50% frequency?",
      "Has EBITDA margin been stable or expanding over 5 years?",
      "Has gross margin been stable or expanding over 5 years?",
      "Has the operating leverage worked in favor (rising margins on rising revenue)?",
      "Has the company demonstrated pricing-led growth (not just volume)?",
      "Has the company demonstrated volume-led growth (not just pricing)?",
      "Is the earnings trajectory consistent with management’s medium-term guidance?",
      "Has tax rate been stable (avoiding suspicious one-time benefits)?",
      "Have one-time gains/losses been clearly disclosed and immaterial?",
      "Has the company avoided aggressive revenue recognition or capitalization?",
      "Is the earnings-power of mature products and emerging products clearly segmentable?",
      "Is the dependency on top 5 customers declining over time?",
      "Has the company’s gross margin moved in the right direction even when input costs spiked?",
      "Has the company demonstrated counter-cyclical earnings stability?",
      "Will the earnings trajectory of the next 3 years be self-sustaining without new capital infusion?",
    ] },
  { n: 7, emoji: '💸', name: "Free Cash Flow Status",
    questions: [
      "Is FCF positive in each of the last 5 years?",
      "Is FCF/PAT > 70% on a 5-year average?",
      "Has working capital deterioration not exceeded 200 bps of revenue in any year?",
      "Has capex intensity (capex/revenue) been stable?",
      "Has the company funded growth from internal cash generation?",
      "Are dividend payouts sustainable (DPR < 40% of net profit, on average)?",
      "Has the company avoided destructive M&A using debt-funded cash?",
      "Has the company demonstrated FCF growth at least as fast as PAT growth?",
      "Are receivable days under industry median?",
      "Are payable days reasonable (not stretched in a way that risks supplier relationships)?",
      "Is the depreciation policy consistent with industry norms?",
      "Is the maintenance capex separately disclosed from growth capex?",
      "Has the company avoided substantial working capital seasonality risks?",
      "Have FCF margins been expanding over time?",
      "Has the company minimized financial-cost drag through prudent treasury?",
      "Are R&D expenses appropriately balanced (not too high, not too low) for the industry?",
      "Has the company avoided treating R&D capitalization as a tool to inflate FCF?",
      "Are minority dividend obligations from subsidiaries managed properly?",
      "Has the company demonstrated counter-cyclical FCF resilience?",
      "Will the next 3 years’ FCF support both growth investments and shareholder returns?",
    ] },
  { n: 8, emoji: '♻️', name: "ROCE & Capital Allocation",
    questions: [
      "Is ROCE > 20% in each of the last 5 years?",
      "Has ROCE been stable or rising?",
      "Has incremental ROCE on new capital deployed been > 18%?",
      "Has the company avoided destructive M&A (ROCE-dilutive acquisitions)?",
      "Are buybacks executed at value-accretive levels (below intrinsic value)?",
      "Are dividends growing at a sustainable rate (5-15% per year)?",
      "Has the company avoided “diversification for diversification’s sake”?",
      "Are spin-offs, demergers, or restructurings value-accretive?",
      "Has the company demonstrated discipline in saying NO to bad capital deployment?",
      "Is the company’s capital structure optimized for risk-adjusted ROE?",
      "Has the company avoided excessive financial leverage to boost ROE?",
      "Are joint ventures and partnerships value-accretive?",
      "Has the company avoided destructive related-party transactions?",
      "Is treasury operations conservative (cash held in safe instruments)?",
      "Have promoter-related capital allocations been minimal?",
      "Has the company communicated capital allocation philosophy clearly?",
      "Are stock-option grants reasonable (not excessive dilution)?",
      "Has the company avoided value-destructive cross-holdings in unrelated businesses?",
      "Has the company maintained a buyback program when stock was undervalued?",
      "Are the next 5 years’ capital allocation priorities transparent and rational?",
    ] },
  { n: 9, emoji: '🌬', name: "Industry Tailwind/Headwind",
    questions: [
      "Is the industry in a 5-10 year structural tailwind phase?",
      "Has industry growth been at least 8% CAGR over 5 years?",
      "Is industry penetration in India still below 50% of mature-market levels?",
      "Are regulatory trends favorable (formalization, GST benefits, etc.)?",
      "Is the industry consolidating in favor of larger players?",
      "Are technological changes disrupting the industry in the company’s favor?",
      "Is the demographic profile supportive (young population, urbanization, income growth)?",
      "Has the industry demonstrated resilience through past economic crises?",
      "Are imports/exports trends favorable for the company?",
      "Is per-capita consumption growing year-on-year?",
      "Is the industry’s pricing environment rational (no destructive competition)?",
      "Are the industry’s input costs trending stable or favorable?",
      "Has industry capacity utilization been in a healthy range (75-90%)?",
      "Are there any disruptive substitutes entering the industry?",
      "Has the company’s industry segment outperformed the broader industry?",
      "Are sub-segments where the company plays growing faster than the overall industry?",
      "Has government policy been supportive of the industry (PLI schemes, etc.)?",
      "Are international peers in the same industry showing healthy performance?",
      "Is the industry’s cyclicality reducing (becoming more secular)?",
      "Will the next 5 years see continued industry tailwind?",
    ] },
  { n: 10, emoji: '🛒', name: "Customer Base Health",
    questions: [
      "Is the customer concentration (top 10 customers as % of revenue) below 30%?",
      "Has customer retention rate stayed above 85%?",
      "Has the customer base been growing year-on-year?",
      "Are customer demographics shifting in favorable directions?",
      "Has the customer satisfaction (NPS, ratings) stayed above industry benchmark?",
      "Has customer feedback been incorporated into product roadmap?",
      "Is the customer’s willingness-to-pay growing (premium attach rates)?",
      "Has customer acquisition cost been declining or stable?",
      "Is the customer’s underlying demand stable across economic cycles?",
      "Has the customer geographic spread been diversifying?",
      "Has the company successfully entered new customer segments?",
      "Is the customer engagement increasing (frequency, basket size, duration)?",
      "Has the customer’s adjacent-needs been addressed by the company?",
      "Are repeat-purchase rates among target customer base above 60%?",
      "Has the company avoided customer-acquisition deceleration?",
      "Are demographic shifts (rural-to-urban, female workforce, etc.) favorable?",
      "Has the company captured share-of-wallet from competitors?",
      "Has the customer’s distribution channel (offline, online, omni-channel) been managed well?",
      "Are customers showing willingness to advocate the brand (organic growth)?",
      "Will the next 5 years see continued customer health?",
    ] },
  { n: 11, emoji: '💎', name: "Pricing Power",
    questions: [
      "Has the company raised prices in each of the last 5 years?",
      "Have price increases stayed below inflation rate consistently?",
      "Has the company successfully passed input cost shocks to customers?",
      "Has gross margin remained stable or expanded across cycles?",
      "Has the company avoided race-to-the-bottom pricing wars?",
      "Is the company’s price premium versus generic alternatives stable or growing?",
      "Has the company successfully introduced premium variants?",
      "Is the price-elasticity of demand low (price increases don’t hurt volume materially)?",
      "Has the company demonstrated brand premium captured in pricing data?",
      "Has the company avoided destructive discounting practices?",
      "Is the company’s pricing structure (cap, variable, surge) optimized?",
      "Has the company successfully captured premiumization trends?",
      "Are pricing benchmarks vs. global peers favorable?",
      "Has the company successfully entered higher-margin segments?",
      "Has price-led growth contributed at least 5% to revenue growth in recent years?",
      "Has the company demonstrated competitive resilience against discount challengers?",
      "Are pricing policies clearly communicated to all stakeholders?",
      "Has the company maintained pricing during periods of weak demand?",
      "Is the company’s premium-pricing strategy sustainable over the next 5 years?",
      "Has the company avoided over-promotion that erodes brand equity?",
    ] },
  { n: 12, emoji: '📊', name: "Volume Growth",
    questions: [
      "Has volume growth been at least 8% CAGR over the last 5 years?",
      "Has volume growth been broad-based across geographies/segments?",
      "Has volume growth been sustainable without unsustainable subsidies?",
      "Has the company avoided volume contraction in more than 1 of the last 5 years?",
      "Is the volume growth driven by structural rather than cyclical factors?",
      "Has the company captured share-gains from competitors?",
      "Has volume growth in the company’s premium segment exceeded overall volume growth?",
      "Has the company demonstrated geographic expansion without margin dilution?",
      "Has the company’s distribution density increased?",
      "Are new products contributing 20%+ of incremental volume?",
      "Has volume growth been balanced across customer cohorts?",
      "Has the company successfully entered new occasion/use-case segments?",
      "Has the channel mix (offline, online, omni-channel) been optimizing volume?",
      "Has the company successfully scaled in tier-2/tier-3/rural markets?",
      "Has volume growth been counter-cyclically resilient?",
      "Has the company avoided destocking/restocking shocks that distort volume reads?",
      "Has manufacturing capacity utilization stayed healthy (75-90%)?",
      "Is the capacity addition pipeline aligned with demand visibility?",
      "Has volume growth been confirmed by independent third-party data?",
      "Will the next 5 years see continued volume growth at 8%+?",
    ] },
  { n: 13, emoji: '📐', name: "Margin Profile",
    questions: [
      "Has EBITDA margin stayed above industry median?",
      "Has EBITDA margin been stable or expanding over 5 years?",
      "Has gross margin been stable or expanding over 5 years?",
      "Has the company demonstrated operating leverage benefit?",
      "Has the company avoided margin compression from competitive intensity?",
      "Has the company successfully managed input cost volatility?",
      "Are forex margins managed prudently?",
      "Has the company avoided destructive promotion that erodes margins?",
      "Has the company demonstrated margin-of-safety pricing power?",
      "Have the new products/segments matured to deliver expected margins?",
      "Has the company maintained margin during periods of input cost spike?",
      "Has the company successfully premiumized the product mix?",
      "Are fixed costs being managed efficiently?",
      "Has the company avoided one-time margin shocks that mask underlying deterioration?",
      "Are the margins comparable to (or better than) global peers in similar industries?",
      "Has the company’s operating leverage worked in volume-up cycles?",
      "Has the company’s operating leverage been manageable in volume-down cycles?",
      "Are margin guidance and actuals consistent?",
      "Has margin from emerging segments been improving?",
      "Will the next 5 years see margin expansion or stable margin?",
    ] },
  { n: 14, emoji: '🔄', name: "Working Capital Cycle",
    questions: [
      "Has the cash conversion cycle stayed below industry median?",
      "Have receivable days been stable or improving?",
      "Are inventory days appropriate for the business model?",
      "Are payable days reasonable and not excessively stretched?",
      "Has working capital been managed during demand cycles?",
      "Has the company avoided distress-driven inventory write-downs?",
      "Has the company maintained healthy supplier relationships?",
      "Has the company managed channel inventory effectively?",
      "Has the company avoided receivable concentration that creates collection risk?",
      "Have working capital ratios been benchmarked against global peers?",
      "Has the company demonstrated working capital resilience in crisis?",
      "Has the company optimized supply chain for cost and speed?",
      "Are demand forecasts driving inventory decisions effectively?",
      "Has the company avoided unnecessary working capital intensity?",
      "Is the dealer/distributor inventory healthy (no overstocking)?",
      "Has the company managed currency exposure in working capital?",
      "Has the company’s days-sales-outstanding been consistent with peers?",
      "Is the company’s float management effective?",
      "Has the company avoided receivable factoring/bill discounting that masks issues?",
      "Will the next 5 years see continued working capital efficiency?",
    ] },
  { n: 15, emoji: '⚖️', name: "Balance Sheet (Debt & Cash)",
    questions: [
      "Is gross debt below 1.5x EBITDA?",
      "Is the debt-to-equity ratio below 0.5x?",
      "Is the interest coverage above 6x?",
      "Are the credit ratings stable AA- or above?",
      "Has the company avoided emergency capital raises in distress?",
      "Has the company avoided opaque off-balance-sheet structures?",
      "Are pension/employee benefit obligations manageable?",
      "Has the company maintained adequate cash reserves?",
      "Has cash been deployed in high-quality short-term instruments?",
      "Is the debt maturity profile manageable (no concentration risk)?",
      "Are the bank facilities adequate without being excessive?",
      "Has the company avoided expensive subordinated debt?",
      "Has the company avoided destructive related-party guarantees?",
      "Are contingent liabilities disclosed and immaterial?",
      "Is the FX exposure hedged prudently?",
      "Are minority-interest obligations transparent?",
      "Has the company avoided destructive convertible debt or PE-style equity?",
      "Has goodwill/intangibles been impairment-tested and stable?",
      "Has the company avoided “creative accounting” on balance sheet?",
      "Will the next 5 years see continued balance sheet strength?",
    ] },
  { n: 16, emoji: '🏗', name: "Capex Cycle Status",
    questions: [
      "Has the capex cycle been matched to demand visibility?",
      "Has the company avoided over-investment that hurt ROCE?",
      "Are capex projects delivering expected payback?",
      "Has the company avoided destructive M&A at high valuations?",
      "Has growth capex been funded primarily by internal cash flow?",
      "Has maintenance capex been adequate to maintain operational excellence?",
      "Has the company’s R&D capex been productive (new products delivering revenue)?",
      "Are technology investments aligned with industry direction?",
      "Has the company avoided geographic expansion that destroyed value?",
      "Has the company’s capex cycle been counter-cyclical (investing in downturns)?",
      "Are project commissioning timelines being met?",
      "Has the company avoided cost overruns in large projects?",
      "Are capacity expansion plans aligned with demand visibility?",
      "Has the company maintained capital discipline in over-heated industries?",
      "Are JVs and partnerships value-accretive?",
      "Has the company avoided destructive vertical integration?",
      "Are exit options (sale of underperforming assets) being exercised when appropriate?",
      "Has the company demonstrated ability to scale capex execution?",
      "Are environmental and regulatory capex costs being managed?",
      "Will the next 5 years see disciplined capex deployment?",
    ] },
  { n: 17, emoji: '🌍', name: "Geopolitical Risk",
    questions: [
      "Is the company’s revenue geographically diversified (no single country >40%)?",
      "Has the company managed exposure to US-China decoupling?",
      "Has the company benefited from China+1 sourcing trends?",
      "Is the company insulated from oil-price shocks?",
      "Has the company diversified its supply chain to manage geopolitical risk?",
      "Has the company avoided overexposure to crisis-prone geographies?",
      "Has the company demonstrated resilience to currency volatility?",
      "Has the company managed sanctions and trade-war risks?",
      "Has the company benefited from India’s strategic positioning?",
      "Are export markets stable and growing?",
      "Has the company hedged geopolitical risks where possible?",
      "Has the company demonstrated political-risk awareness in expansion?",
      "Has the company avoided dependence on government contracts that are politically vulnerable?",
      "Has the company managed trade-tariff risks?",
      "Has the company maintained relationships with multiple geographic stakeholders?",
      "Has the company demonstrated agility in shifting production geographically?",
      "Has the company managed visa/talent-mobility risks?",
      "Has the company avoided overexposure to regulated authoritarian markets?",
      "Has the company demonstrated resilience to climate-geopolitical events?",
      "Will the next 5 years see continued geopolitical resilience?",
    ] },
  { n: 18, emoji: '📜', name: "Regulatory Risk",
    questions: [
      "Is the company in a regulatory environment that is stable and predictable?",
      "Has the company successfully navigated past regulatory changes?",
      "Is the company’s regulatory burden manageable (not crushing)?",
      "Has the company maintained good relationships with regulators?",
      "Has the company avoided regulatory violations or fines?",
      "Has the company anticipated and prepared for emerging regulations?",
      "Has the company benefited from regulatory tailwinds (GST, formalization, PLI)?",
      "Has the company avoided dependence on regulatory subsidies?",
      "Is the company’s tax planning prudent and not aggressive?",
      "Has the company managed environmental compliance?",
      "Has the company managed worker-safety and labor regulations?",
      "Has the company managed data-privacy and cybersecurity regulations?",
      "Has the company’s sector-specific regulatory framework been stable?",
      "Has the company maintained good relationships with industry bodies?",
      "Has the company avoided destructive litigation?",
      "Has the company prepared for potential industry restructuring (e.g., telecom AGR)?",
      "Has the company managed ESG-related regulatory pressure?",
      "Has the company’s lobby-and-advocacy efforts been ethical?",
      "Has the company avoided dependence on political connections?",
      "Will the next 5 years see continued regulatory navigability?",
    ] },
  { n: 19, emoji: '⚙️', name: "Technology Disruption",
    questions: [
      "Is the business model insulated from AI disruption?",
      "Has the company adopted technology to enhance its moat?",
      "Has the company avoided technology obsolescence?",
      "Has the company’s R&D pipeline addressed emerging technology?",
      "Has the company built digital capabilities competitive with new entrants?",
      "Has the company’s customer experience been digitally optimized?",
      "Has the company managed supply-chain technology effectively?",
      "Has the company’s manufacturing technology kept pace with global peers?",
      "Has the company invested adequately in data and analytics?",
      "Has the company avoided dependence on legacy technology?",
      "Has the company managed the technology talent pipeline?",
      "Has the company anticipated technology shifts in the customer’s industry?",
      "Has the company avoided being commoditized by technology?",
      "Has the company built a tech-enabled premium position?",
      "Has the company managed the platform vs. proprietary tradeoff?",
      "Has the company partnered with leading technology providers?",
      "Has the company built robust cybersecurity?",
      "Has the company avoided destructive technology bets?",
      "Has the company’s technology strategy been transparent to investors?",
      "Will the next 5 years see continued technology resilience?",
    ] },
  { n: 20, emoji: '🌱', name: "ESG & Governance",
    questions: [
      "Is the company rated highly on independent ESG metrics?",
      "Are board independence and diversity meaningful?",
      "Has the company avoided major governance scandals?",
      "Are auditor relationships stable and reputable?",
      "Has the company demonstrated environmental responsibility?",
      "Has the company managed worker rights and safety?",
      "Has the company avoided greenwashing?",
      "Are CEO/management compensation linked to long-term value creation?",
      "Has the company managed climate-related risks?",
      "Has the company demonstrated supply chain ESG management?",
      "Are minority shareholder rights protected?",
      "Has the company maintained ethical relationships with all stakeholders?",
      "Has the company managed data privacy and customer trust?",
      "Has the company avoided destructive related-party transactions?",
      "Has the company demonstrated transparency in financial reporting?",
      "Has the company anticipated emerging ESG trends?",
      "Has the company avoided over-optimization that erodes governance quality?",
      "Has the company integrated ESG into business strategy?",
      "Has the company communicated ESG progress to all stakeholders?",
      "Will the next 5 years see continued ESG and governance excellence?",
    ] },
  { n: 21, emoji: '🧮', name: "Valuation",
    questions: [
      "Is the current P/E within 1 standard deviation of the 10-year average?",
      "Is the current P/E reasonable relative to global peers?",
      "Is the EV/EBITDA reasonable relative to the company’s own history?",
      "Has the implied earnings growth in the current valuation been reasonable?",
      "Is the dividend yield reasonable relative to peers and risk-free rate?",
      "Is the price-to-book within reasonable range?",
      "Is the price-to-sales ratio reasonable for the business model?",
      "Is the company’s market cap consistent with intrinsic value estimates?",
      "Has the valuation premium relative to peers been justified?",
      "Has the company’s valuation been growing in line with earnings (not multiple expansion)?",
      "Is the next-12-month earnings growth expectation reasonable?",
      "Has the company been trading near recent 52-week high or low?",
      "Is the company’s valuation reasonable in light of the macro environment?",
      "Has the company’s valuation responded to fundamental drivers?",
      "Is the company’s valuation supportive of long-term ownership?",
      "Has the company’s valuation been validated by precedent transactions?",
      "Has the company’s valuation kept pace with sector benchmarks?",
      "Is the company’s free cash flow yield reasonable?",
      "Has the company’s valuation been supported by multiple expansion or contraction?",
      "Will the next 5 years see continued valuation reasonableness?",
    ] },
  { n: 22, emoji: '💼', name: "Tax Considerations",
    questions: [
      "Will the sale trigger LTCG above the ₹1.25 lakh annual exemption?",
      "Has the position been held long enough to qualify for LTCG (12 months+ for equity)?",
      "Have I considered the LTCG tax rate of 12.5% (post-July 2024)?",
      "Have I considered the STCG tax rate of 20% (post-July 2024)?",
      "Have I planned for the tax payment liquidity?",
      "Have I considered offsetting losses from other positions?",
      "Have I considered the indexation benefit (if applicable)?",
      "Have I considered the tax impact on dividend income?",
      "Have I considered the tax efficiency of the alternative investment?",
      "Have I considered the impact on overall tax planning?",
      "Have I considered the HUF transfer option for tax efficiency?",
      "Have I considered the family planning aspects?",
      "Have I consulted with a tax advisor for complex situations?",
      "Have I considered the timing of the sale relative to financial year-end?",
      "Have I considered the impact on annual tax filings?",
      "Have I considered the wealth tax/estate planning implications?",
      "Have I considered the gift tax implications?",
      "Have I considered the impact on tax loss harvesting opportunities?",
      "Have I considered the long-term tax-efficient withdrawal strategy?",
      "Will the tax cost reduce my net return enough to question the sale decision?",
    ] },
  { n: 23, emoji: '📦', name: "Position Size & Concentration",
    questions: [
      "Is the current position size aligned with my target weight for this name?",
      "Has the position grown to >25% of the total portfolio due to outperformance?",
      "Has the position grown to >5% of my net worth?",
      "Is the position size consistent with my risk tolerance?",
      "Does the position size require trimming for risk management?",
      "Would selling reduce concentration risk meaningfully?",
      "Is the position correlated with other holdings (sector, factor)?",
      "Has the position reached the maximum size I had pre-committed?",
      "Has the position become my largest holding in the portfolio?",
      "Would partial trimming achieve the position-size objective?",
      "Is the position size consistent with my conviction level?",
      "Has the position size grown faster than my net worth?",
      "Is the position size consistent with my long-term plan?",
      "Would full exit destroy a hard-built position with future compounding upside?",
      "Has the position size limited my ability to add other opportunities?",
      "Has the position size created a behavioral overhang (focusing too much on it)?",
      "Has the position size triggered any wealth-planning thresholds (estate, gifts)?",
      "Is the position size manageable from a liquidity perspective?",
      "Has the position size been considered against my retirement runway?",
      "Will the position size grow further without trimming?",
    ] },
  { n: 24, emoji: '🔀', name: "Alternative Opportunities",
    questions: [
      "Is there an alternative investment with higher expected return for the same risk?",
      "Is there an alternative investment with lower risk for the same return?",
      "Have I researched the alternative thoroughly?",
      "Has the alternative been compared on absolute and relative valuation?",
      "Has the alternative demonstrated comparable management quality?",
      "Has the alternative demonstrated comparable competitive moat?",
      "Has the alternative demonstrated comparable industry tailwinds?",
      "Is the alternative more liquid than the current position?",
      "Is the alternative providing portfolio diversification benefits?",
      "Is the alternative aligned with my long-term strategy?",
      "Has the alternative been stress-tested through past cycles?",
      "Has the alternative been compared on tax efficiency?",
      "Has the alternative been compared on transaction costs?",
      "Has the alternative been verified by independent research?",
      "Has the alternative been examined for management quality risk?",
      "Has the alternative been examined for promoter integrity?",
      "Has the alternative been examined for accounting quality?",
      "Has the alternative been examined for industry positioning?",
      "Has the alternative been examined for competitive risk?",
      "Will the alternative compound at 25%+ over the next 10 years if held?",
    ] },
  { n: 25, emoji: '🧠', name: "Emotional State",
    questions: [
      "Am I selling because of recent negative news headlines rather than fundamentals?",
      "Am I selling because the stock has moved against me in the short term?",
      "Am I selling because of peer pressure or social proof?",
      "Am I selling because the market is in a panic phase?",
      "Am I selling because I’m bored with the position?",
      "Am I selling to chase a new “hot” opportunity?",
      "Am I selling because the position has performed well and I want to “lock in”?",
      "Am I selling because I’m tired of the volatility?",
      "Am I selling to fund a non-investment expense?",
      "Am I selling because of conflict with my spouse, family, or partner?",
      "Am I selling because of recent personal stress (job change, illness, etc.)?",
      "Am I selling because of FOMO on a different investment?",
      "Am I selling because I read an article that scared me?",
      "Am I selling because the stock has been talked down by an influential commentator?",
      "Am I selling because the stock has been frozen for trading and I panic?",
      "Have I spoken to my accountability partner about this sale?",
      "Have I waited 48 hours since the decision to sell?",
      "Have I documented my rationale in writing?",
      "Have I considered the lessons from past wrong sells in similar situations?",
      "If I sold all my multibaggers at this same point in their journey, would I have built any wealth?",
    ] },
];

// ── 500-Point Checklist (PATCH 1091) ───────────────────────────────────────
const VERDICT = {
  HOLD:    { label: 'STRONG HOLD',       color: 'var(--mc-bullish)',          rule: 'Score ≥ 80%. Do not sell. Add 25% on next 10% pullback. Quarterly review only.' },
  MONITOR: { label: 'HOLD WITH MONITORING', color: 'var(--mc-cyan)',          rule: 'Score 60-80%. Do not sell now. Intensify monitoring to monthly. Re-run checklist in 3 months.' },
  TRIM:    { label: 'TRIM 25-50%',       color: 'var(--mc-warn)',             rule: 'Score 40-60%. Sell 25-50% of position. Hold remainder. Re-run checklist in 6 months.' },
  EXIT:    { label: 'EXIT PROGRESSIVELY', color: 'var(--mc-bearish)',         rule: 'Score < 40%. Sell over 3-6 months to manage tax. Document rationale. Identify replacement.' },
};

function verdictFor(yesCount: number, coffeeCan: boolean): { key: keyof typeof VERDICT; pct: number } {
  const pct = (yesCount / 500) * 100;
  if (coffeeCan && pct >= 50) return { key: 'HOLD', pct };
  if (pct >= 80) return { key: 'HOLD', pct };
  if (pct >= 60) return { key: 'MONITOR', pct };
  if (pct >= 40) return { key: 'TRIM', pct };
  return { key: 'EXIT', pct };
}

function ChecklistTab() {
  const [ticker, setTicker] = useState<string>('');
  const [tickerInput, setTickerInput] = useState<string>('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [coffeeCan, setCoffeeCan] = useState<boolean>(false);
  const [expandedCat, setExpandedCat] = useState<number | null>(null);
  // PATCH 1092 — browse-mode state for the empty/reference view so users can
  // read all 500 questions before starting a checklist for any ticker.
  const [browseOpen, setBrowseOpen] = useState<Set<number>>(new Set([1, 2, 3])); // first three open
  const [browseFilter, setBrowseFilter] = useState<string>('');

  const STORAGE_KEY = (t: string) => `mc:cycles:checklist:${t.toUpperCase()}`;

  // Hydrate when ticker locks in
  useEffect(() => {
    if (typeof window === 'undefined' || !ticker) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY(ticker));
      if (raw) {
        const p = JSON.parse(raw);
        setChecks(p.checks || {});
        setCoffeeCan(!!p.coffeeCan);
      } else {
        setChecks({});
        setCoffeeCan(false);
      }
    } catch {}
  }, [ticker]);

  // Persist on every change
  useEffect(() => {
    if (typeof window === 'undefined' || !ticker) return;
    try {
      window.localStorage.setItem(STORAGE_KEY(ticker), JSON.stringify({ checks, coffeeCan, ts: Date.now() }));
    } catch {}
  }, [checks, coffeeCan, ticker]);

  const yesCount = useMemo(() => Object.values(checks).filter(Boolean).length, [checks]);
  const { key: vKey, pct } = verdictFor(yesCount, coffeeCan);
  const v = VERDICT[vKey];

  const catCount = (catN: number) => {
    let n = 0;
    for (let i = 0; i < 20; i++) if (checks[`${catN}:${i}`]) n++;
    return n;
  };

  const toggle = (catN: number, qIdx: number) => {
    const k = `${catN}:${qIdx}`;
    setChecks((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const markAllInCategory = (catN: number, value: boolean) => {
    setChecks((prev) => {
      const next = { ...prev };
      for (let i = 0; i < 20; i++) next[`${catN}:${i}`] = value;
      return next;
    });
  };

  const reset = () => {
    if (typeof window !== 'undefined' && window.confirm(`Reset checklist for ${ticker}?`)) {
      setChecks({});
      setCoffeeCan(false);
    }
  };

  if (!ticker) {
    return (
      <>
        <Card title="📋 The 500-Point Checklist (§18)" accent={C.amber}>
          <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.6, marginBottom: 10 }}>
            <strong>The friction mechanism</strong> that separates the analytical "should I sell" from the impulsive one. 25 categories × 20 questions = 500 checks. Forces the seller to verify, in writing, against every reasonable dimension of the thesis before exiting a long-held winner.
          </div>
          <Quote text="The hardest investing decision is the decision NOT to act. The 500-point checklist forces you to earn the right to sell — by proving the thesis is genuinely broken on the data, not on the price." who="Quantitative Research" />
          <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>
            <strong style={{ color: C.cyan }}>Recommended usage:</strong> Annual deep review (1× per major holding) · Triggered review (whenever the impulse to sell arises) · Within 90 days of any new initial buy · Quarterly sample rotation (1-2 positions per quarter).
          </div>
        </Card>

        <Card title="🎯 Start: Enter The Stock Under Review" accent={C.cyan}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter' && tickerInput.trim()) setTicker(tickerInput.trim()); }}
              placeholder="e.g. HDFCBANK, ASIANPAINT, BAJFINANCE"
              style={{
                flex: 1, minWidth: 240, padding: '10px 14px', borderRadius: 6,
                border: `1px solid ${C.border}`, background: C.card2, color: C.text,
                fontSize: 14, fontWeight: 600, letterSpacing: 0.5, ...MONO,
              }}
            />
            <button
              onClick={() => tickerInput.trim() && setTicker(tickerInput.trim())}
              style={{
                padding: '10px 22px', borderRadius: 6,
                background: C.cyan, color: '#000', fontSize: 13, fontWeight: 800,
                border: 'none', cursor: 'pointer', letterSpacing: 0.4,
              }}
            >
              START CHECKLIST →
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
            Your responses persist in browser storage keyed to this ticker. You can come back any time and resume.
          </div>
        </Card>

        {/* Compact category-index chip strip — jump-to anchors */}
        <Card title="📊 Jump To Category" accent={C.purple}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6, fontSize: 12 }}>
            {CHECKLIST_500.map((c) => (
              <button
                key={c.n}
                onClick={() => {
                  setBrowseOpen((prev) => { const next = new Set(prev); next.add(c.n); return next; });
                  setTimeout(() => { document.getElementById(`browse-cat-${c.n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
                }}
                style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 8px', background: C.card2, borderRadius: 4, border: `1px solid ${C.border}`, cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ fontSize: 14 }}>{c.emoji}</span>
                <span style={{ color: C.muted, fontWeight: 700, ...MONO, fontSize: 10 }}>{String(c.n).padStart(2, '0')}</span>
                <span style={{ color: C.text, fontWeight: 600 }}>{c.name}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="🪙 The Coffee Can Test (§18.26)" accent={C.green}>
          The final filter: <strong>"Would I be comfortable owning this position with no ability to trade for 10 years?"</strong> If yes — HOLD regardless of marginal score. If no — the sale rationale is strengthened. This filter overrides the math when the math is over-weighting near-term noise.
        </Card>

        {/* PATCH 1092 — browsable reference view of all 500 questions */}
        <div style={{ marginTop: 18, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.amber, letterSpacing: 0.4, textTransform: 'uppercase' }}>📖 Read All 500 Questions</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>The full reference. Read once before your first review · skim before each sell decision.</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="search"
                placeholder="🔍 filter questions…"
                value={browseFilter}
                onChange={(e) => setBrowseFilter(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.card2, color: C.text, fontSize: 12, width: 200 }}
              />
              <button
                onClick={() => setBrowseOpen(new Set(CHECKLIST_500.map(c => c.n)))}
                style={{ fontSize: 11, padding: '6px 10px', background: 'transparent', border: `1px solid ${C.cyan}40`, color: C.cyan, borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
              >▾ EXPAND ALL</button>
              <button
                onClick={() => setBrowseOpen(new Set())}
                style={{ fontSize: 11, padding: '6px 10px', background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
              >▸ COLLAPSE ALL</button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {CHECKLIST_500.map((cat) => {
              const open = browseOpen.has(cat.n);
              const f = browseFilter.trim().toLowerCase();
              const matches = f ? cat.questions.filter(q => q.toLowerCase().includes(f)) : cat.questions;
              const filterHit = f && matches.length > 0;
              // When filter active, force open + show only matches
              const effOpen = open || filterHit;
              const list = f ? matches : cat.questions;
              if (f && matches.length === 0) return null;
              return (
                <div
                  key={cat.n}
                  id={`browse-cat-${cat.n}`}
                  style={{
                    background: C.card, border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${C.purple}`, borderRadius: 6,
                    overflow: 'hidden', scrollMarginTop: 24,
                  }}
                >
                  <button
                    onClick={() => setBrowseOpen((prev) => { const next = new Set(prev); if (next.has(cat.n)) next.delete(cat.n); else next.add(cat.n); return next; })}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', background: 'transparent', border: 'none',
                      cursor: 'pointer', textAlign: 'left', color: C.text,
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{cat.emoji}</span>
                    <span style={{ color: C.purple, fontWeight: 800, ...MONO, fontSize: 11, minWidth: 50 }}>CAT&nbsp;{String(cat.n).padStart(2, '0')}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{cat.name}</span>
                    <span style={{ ...MONO, fontSize: 11, color: C.muted, fontWeight: 700 }}>{list.length} q</span>
                    <span style={{ color: C.muted, fontSize: 14, marginLeft: 4 }}>{effOpen ? '▾' : '▸'}</span>
                  </button>

                  {effOpen && (
                    <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 16px 14px', background: C.bg }}>
                      <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                        {list.map((q, i) => {
                          // Highlight matched substring when filter active
                          let display: React.ReactNode = q;
                          if (f) {
                            const idx = q.toLowerCase().indexOf(f);
                            if (idx >= 0) {
                              display = (
                                <>
                                  {q.slice(0, idx)}
                                  <mark style={{ background: `${C.amber}50`, color: C.text, padding: '0 2px', borderRadius: 2 }}>{q.slice(idx, idx + f.length)}</mark>
                                  {q.slice(idx + f.length)}
                                </>
                              );
                            }
                          }
                          return (
                            <li key={i} style={{ display: 'flex', gap: 10, padding: '6px 4px', borderBottom: i < list.length - 1 ? `1px dashed ${C.border}` : 'none' }}>
                              <span style={{ ...MONO, color: C.dim, fontSize: 10, minWidth: 22, marginTop: 2, fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</span>
                              <span style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.55 }}>{display}</span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {browseFilter && CHECKLIST_500.every(c => c.questions.filter(q => q.toLowerCase().includes(browseFilter.trim().toLowerCase())).length === 0) && (
            <div style={{ padding: 16, textAlign: 'center', color: C.muted, fontSize: 12, fontStyle: 'italic' }}>
              No questions match "{browseFilter}". Try a different term.
            </div>
          )}
        </div>
      </>
    );
  }

  // ── Active checklist view ─────────────────────────────────────────────
  return (
    <>
      {/* Header — ticker + scorecard */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${v.color}`, borderRadius: 8,
        padding: 16, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, letterSpacing: 0.4 }}>STOCK UNDER REVIEW</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: C.text, ...MONO, letterSpacing: 1 }}>{ticker}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={reset} style={{
              padding: '6px 12px', background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 4, color: C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>↻ RESET</button>
            <button onClick={() => { setTicker(''); setTickerInput(''); }} style={{
              padding: '6px 12px', background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 4, color: C.muted, fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>← CHANGE</button>
          </div>
        </div>

        {/* Score row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 14 }}>
          <div style={{ padding: 12, background: C.card2, borderRadius: 6, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.4 }}>YES COUNT</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: C.cyan, ...MONO }}>{yesCount} <span style={{ fontSize: 14, color: C.muted }}>/ 500</span></div>
          </div>
          <div style={{ padding: 12, background: C.card2, borderRadius: 6, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.4 }}>COMPOSITE</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: v.color, ...MONO }}>{pct.toFixed(0)}%</div>
          </div>
          <div style={{ padding: 12, background: C.card2, borderRadius: 6, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: 0.4 }}>VERDICT</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: v.color, letterSpacing: 0.4, marginTop: 4 }}>{v.label}</div>
          </div>
          <div style={{ padding: 12, background: C.card2, borderRadius: 6 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={coffeeCan}
                onChange={(e) => setCoffeeCan(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--mc-bullish)' }}
              />
              <div>
                <div style={{ fontSize: 11, color: C.text, fontWeight: 700 }}>🪙 Coffee Can Test</div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Override: HOLD if 50%+ and willing to hold 10y</div>
              </div>
            </label>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginTop: 12, height: 8, background: C.card2, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${C.red}, ${C.amber} 40%, ${C.cyan} 60%, ${C.green})`, transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10, padding: '8px 10px', background: C.card2, borderRadius: 4, borderLeft: `3px solid ${v.color}` }}>
          <strong style={{ color: v.color }}>Rule:</strong> {v.rule}
        </div>
      </div>

      {/* Category grid */}
      <div style={{ display: 'grid', gap: 8 }}>
        {CHECKLIST_500.map((cat) => {
          const cn = catCount(cat.n);
          const catPct = (cn / 20) * 100;
          const expanded = expandedCat === cat.n;
          const catColor = cn >= 16 ? C.green : cn >= 12 ? C.cyan : cn >= 8 ? C.amber : C.red;
          return (
            <div key={cat.n} style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${catColor}`, borderRadius: 6,
              overflow: 'hidden',
            }}>
              <button
                onClick={() => setExpandedCat(expanded ? null : cat.n)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', background: 'transparent', border: 'none',
                  cursor: 'pointer', textAlign: 'left', color: C.text,
                }}
              >
                <span style={{ fontSize: 18 }}>{cat.emoji}</span>
                <span style={{ color: C.muted, fontWeight: 700, ...MONO, fontSize: 11, minWidth: 28 }}>{String(cat.n).padStart(2, '0')}</span>
                <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{cat.name}</span>
                <span style={{ ...MONO, fontSize: 11, color: catColor, fontWeight: 800, minWidth: 50, textAlign: 'right' }}>{cn}/20</span>
                <div style={{ width: 80, height: 5, background: C.card2, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${catPct}%`, height: '100%', background: catColor, transition: 'width 0.2s' }} />
                </div>
                <span style={{ color: C.muted, fontSize: 12, marginLeft: 4 }}>{expanded ? '▾' : '▸'}</span>
              </button>

              {expanded && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: '8px 14px 12px' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginBottom: 6 }}>
                    <button onClick={() => markAllInCategory(cat.n, true)} style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: `1px solid ${C.green}40`, color: C.green, borderRadius: 3, fontWeight: 700, cursor: 'pointer' }}>✓ ALL YES</button>
                    <button onClick={() => markAllInCategory(cat.n, false)} style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 3, fontWeight: 700, cursor: 'pointer' }}>RESET</button>
                  </div>
                  {cat.questions.map((q, i) => {
                    const k = `${cat.n}:${i}`;
                    const checked = !!checks[k];
                    return (
                      <label
                        key={i}
                        style={{
                          display: 'flex', gap: 10, alignItems: 'flex-start',
                          padding: '7px 8px', borderRadius: 4, cursor: 'pointer',
                          background: checked ? `${C.green}08` : 'transparent',
                          marginBottom: 2,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(cat.n, i)}
                          style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--mc-bullish)', flexShrink: 0 }}
                        />
                        <span style={{ ...MONO, color: C.dim, fontSize: 10, minWidth: 22, marginTop: 1 }}>{String(i + 1).padStart(2, '0')}</span>
                        <span style={{ fontSize: 12, color: checked ? C.text : C.text2, lineHeight: 1.5, textDecoration: checked ? 'none' : 'none' }}>{q}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom decision tree */}
      <Card title="📐 Scoring & Decision (§18.26)" accent={v.color}>
        <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
          <div style={{ color: C.text }}><strong style={{ color: C.green }}>≥ 80% (400+ YES):</strong> STRONG HOLD — Do not sell · Add 25% on next 10% pullback · Quarterly review only.</div>
          <div style={{ color: C.text }}><strong style={{ color: C.cyan }}>60-80% (300-400 YES):</strong> HOLD WITH MONITORING — Do not sell now · Intensify monitoring to monthly · Re-run in 3 months.</div>
          <div style={{ color: C.text }}><strong style={{ color: C.amber }}>40-60% (200-300 YES):</strong> TRIM 25-50% — Sell 25-50% of position · Hold remainder · Re-run in 6 months · Document which categories failed.</div>
          <div style={{ color: C.text }}><strong style={{ color: C.red }}>&lt; 40% (&lt;200 YES):</strong> EXIT PROGRESSIVELY — Sell over 3-6 months to manage tax · Document rationale · Identify replacement.</div>
        </div>
        <div style={{ marginTop: 10, padding: 10, background: C.card2, borderRadius: 6, fontSize: 12, color: C.text2 }}>
          <strong style={{ color: C.green }}>Coffee Can Override:</strong> Would I be comfortable owning this with NO ability to trade for 10 years? If yes — HOLD regardless of marginal score.
        </div>
      </Card>
    </>
  );
}


// ── Page shell ──────────────────────────────────────────────────────────────
export default function MarketCyclesPage() {
  const [active, setActive] = useState<TabId>('overview');

  return (
    <div style={{ minHeight: '100%', background: C.bg, color: C.text }}>
      <div style={{ padding: '20px 24px 12px', borderBottom: `1px solid ${C.border}`, background: C.card }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: 0 }}>🎢 Market Cycles</h1>
          <span style={{ fontSize: 11, color: C.cyan, fontWeight: 700, border: `1px solid ${C.cyan}50`, background: `${C.cyan}15`, padding: '2px 7px', borderRadius: 4 }}>HANDBOOK · 19 SECTIONS · 250k WORDS COMPRESSED</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
          Mastering Market Cycles — The Complete Playbook for Managing Bull Markets, Corrections, Crashes and Recoveries in Indian Equities · Quantitative Research, June 2026
        </div>

        {/* Tab strip */}
        <div style={{ display: 'flex', gap: 4, marginTop: 14, overflowX: 'auto', whiteSpace: 'nowrap', scrollbarWidth: 'thin' }}>
          {TABS.map((t) => {
            const isActive = t.id === active;
            return (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                style={{
                  flexShrink: 0,
                  background: isActive ? `${C.cyan}15` : 'transparent',
                  border: `1px solid ${isActive ? C.cyan : C.border}`,
                  borderRadius: 6,
                  padding: '8px 14px',
                  cursor: 'pointer',
                  color: isActive ? C.cyan : C.text2,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                  minWidth: 130,
                }}
              >
                <span>{t.emoji} {t.label.toUpperCase()}</span>
                <span style={{ fontSize: 9, color: isActive ? C.cyan : C.dim, fontWeight: 500, letterSpacing: 0.2 }}>{t.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
        {active === 'overview'   && <OverviewTab />}
        {active === 'cycles'     && <CyclesTab />}
        {active === 'crashbook'  && <CrashbookTab />}
        {active === 'precrash'   && <PreCrashTab />}
        {active === 'deployment' && <DeploymentTab />}
        {active === 'rotation'   && <RotationTab />}
        {active === 'psychology' && <PsychologyTab />}
        {active === 'elite'      && <EliteTab />}
        {active === 'checklist'  && <ChecklistTab />}

        <div style={{ marginTop: 24, padding: 14, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, color: C.muted, textAlign: 'center', lineHeight: 1.6 }}>
          The framework is the framework. The math is the math. <strong style={{ color: C.amber }}>Your discipline is the variable.</strong>
        </div>
      </div>
    </div>
  );
}
