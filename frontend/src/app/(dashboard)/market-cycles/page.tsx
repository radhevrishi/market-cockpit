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
import { PanelFreshness } from '@/components/PanelFreshness';

const C = {
  bg: 'var(--mc-bg-0)', card: 'var(--mc-bg-1)', card2: 'var(--mc-bg-2)',
  border: 'var(--mc-border-1)', borderStrong: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', text2: 'var(--mc-text-2)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', amber: 'var(--mc-warn)', red: 'var(--mc-bearish)',
  cyan: 'var(--mc-cyan)', saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
};

const MONO: CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

type TabId = 'overview' | 'regime' | 'cycles' | 'crashbook' | 'precrash' | 'deployment' | 'rotation' | 'psychology' | 'elite' | 'checklist';

const TABS: { id: TabId; label: string; emoji: string; sub: string }[] = [
  { id: 'overview',   emoji: '🧭', label: 'Overview',        sub: 'Six Truths + framework' },
  { id: 'regime',     emoji: '🌀', label: 'Regime Rotation', sub: 'Shock → stagflation → recovery' },
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

// ── Live NIFTY position → armed deployment rung (breadth-driven) ────────────
// Additive overlay: pulls GET /api/v1/breadth, extracts NIFTY pctOf52wHigh
// (fraction 0..1 of the 52-week high), converts to drawdown-from-high, and
// snaps it onto the static staircase below. Fully defensive — the staircase
// always renders its static rungs; the live marker only appears when the
// breadth payload actually carries the NIFTY 52w-high reading. If it doesn't
// (or the fetch fails), we say so honestly and never guess a rung.
type NiftyPos = { pct52: number; drawdown: number };
type BreadthCtx = { composite?: number; regime?: string; regimeColor?: string; cash?: number; scope?: string };

function extractNiftyPct52(j: any): number | null {
  if (!j || typeof j !== 'object') return null;
  const candidates = [
    j?.['^NSEI']?.pctOf52wHigh,
    j?.byName?.['^NSEI']?.pctOf52wHigh,
    j?.indices?.['^NSEI']?.pctOf52wHigh,
    j?.nifty?.pctOf52wHigh,
    j?.pillars?.trend?.nifty?.pctOf52wHigh,
    j?.pctOf52wHigh,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
      // Normalize: accept either a fraction (0.94) or a percent (94).
      const frac = c > 1.5 ? c / 100 : c;
      if (frac > 0 && frac <= 1.2) return Math.min(frac, 1);
    }
  }
  return null;
}

// ── Breadth suggested_cash_pct → armed staircase rung (PRIMARY driver) ──────
// The breadth engine's `suggested_cash_pct` (0..100) is the recommended cash
// RESERVE for the current regime: Expansion 0 · Healthy Bull 10 · Transitional
// 25 · Risk-Off 45. As breadth deteriorates the market is falling, so more of
// the pre-committed correction bucket should already be deployed — i.e. a
// deeper rung. Each rung carries `cumN` = cumulative % of the deployable-cash
// bucket deployed (10/25/45/60/80/100). We map suggested cash straight onto
// that cumulative scale (nearest rung by `cumN`) — the interpretation that is
// consistent with how the rungs are defined. Near-zero suggested cash means
// broad participation / near highs, so no rung is armed.
//   returns: -2 = unknown · -1 = near highs (not armed) · >=0 = rung index
function armRungFromCash(cashPct: number | undefined, stair: { cumN: number }[]): number {
  if (typeof cashPct !== 'number' || !Number.isFinite(cashPct)) return -2;
  if (stair.length === 0) return -2;
  // Below half the first rung's cumulative level = strong breadth, near highs.
  if (cashPct < stair[0].cumN / 2) return -1;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < stair.length; i++) {
    const d = Math.abs(stair[i].cumN - cashPct);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

function DeploymentTab() {
  const stair = [
    { trig: '-10%', dd: 10, tranche: '10%', cum: '10%', cumN: 10, tag: 'Routine pullback. Resist temptation to lumpsum.', color: C.green },
    { trig: '-15%', dd: 15, tranche: '+15%', cum: '25%', cumN: 25, tag: 'Real correction. First serious deploy.', color: C.green },
    { trig: '-20%', dd: 20, tranche: '+20%', cum: '45%', cumN: 45, tag: 'Mid-cycle bear. Asymmetry building.', color: C.amber },
    { trig: '-25%', dd: 25, tranche: '+15%', cum: '60%', cumN: 60, tag: 'Late-cycle bear. Press but reserve.', color: C.amber },
    { trig: '-30%', dd: 30, tranche: '+20%', cum: '80%', cumN: 80, tag: 'Generational entry begins.', color: C.red },
    { trig: '-40%+', dd: 40, tranche: '+20%', cum: '100%', cumN: 100, tag: 'Maximum aggression. Druckenmiller "press the bet".', color: C.red },
  ];

  // 'loading' | 'ok' (have NIFTY pos) | 'nopos' (breadth ok but no 52w reading) | 'error'
  const [state, setState] = useState<'loading' | 'ok' | 'nopos' | 'error'>('loading');
  const [pos, setPos] = useState<NiftyPos | null>(null);
  const [ctx, setCtx] = useState<BreadthCtx | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/v1/breadth', { cache: 'no-store' });
        if (!res.ok) throw new Error(`breadth ${res.status}`);
        const j = await res.json();
        if (!alive) return;
        const breadthCtx: BreadthCtx = {
          composite: typeof j?.composite === 'number' ? j.composite : undefined,
          regime: typeof j?.regime === 'string' ? j.regime : undefined,
          regimeColor: typeof j?.regime_color === 'string' ? j.regime_color : undefined,
          cash: typeof j?.suggested_cash_pct === 'number' ? j.suggested_cash_pct : undefined,
          scope: typeof j?.scope === 'string' ? j.scope : undefined,
        };
        setCtx(breadthCtx);
        setFetchedAt(Date.now());
        const pct52 = extractNiftyPct52(j);
        if (pct52 != null) setPos({ pct52, drawdown: Math.max(0, (1 - pct52) * 100) });
        // Normal case: breadth returned. If it carries suggested_cash_pct (or a
        // 52w-high reading), the rung lights up from it. Only fall to the honest
        // 'nopos' path when the payload has neither signal.
        if (breadthCtx.cash != null || pct52 != null) setState('ok');
        else setState('nopos');
      } catch {
        if (!alive) return;
        setState('error');
        setFetchedAt(Date.now());
      }
    })();
    return () => { alive = false; };
  }, []);

  // Snap the live drawdown onto the staircase. armedIdx:
  //   -2 = position unknown, -1 = above the first rung (near highs), >=0 = rung index.
  const armedIdx = useMemo(() => {
    if (state !== 'ok') return -2;
    // PRIMARY driver: breadth's suggested_cash_pct → cumulative-deployment rung.
    // This is what makes the staircase light up in the normal case.
    let idx = armRungFromCash(ctx?.cash, stair);
    // SECONDARY refinement: if a genuine NIFTY 52w-high drawdown is ever present
    // in the payload, take the deeper of the two rungs (a real drawdown reading
    // shouldn't under-arm what breadth already implies).
    if (pos) {
      let ddIdx = -1;
      for (let i = 0; i < stair.length; i++) if (pos.drawdown >= stair[i].dd) ddIdx = i;
      if (ddIdx > idx) idx = ddIdx;
    }
    return idx;
  }, [state, pos, ctx]);

  const armed = armedIdx >= 0 ? stair[armedIdx] : null;
  const armAccent = armed ? armed.color : C.cyan;

  // One-line live readout of the armed rung.
  const readout = (() => {
    if (state === 'loading') return { color: C.muted, text: 'Reading live NIFTY position from /api/v1/breadth…' };
    if (state === 'error')
      return { color: C.amber, text: '⚠ Breadth feed unavailable — live rung unknown. Static protocol below still applies.' };
    if (state === 'nopos') {
      const ctxNote = ctx?.composite != null
        ? ` (breadth composite ${ctx.composite}${ctx.regime ? ` · ${ctx.regime}` : ''})`
        : '';
      return {
        color: C.amber,
        text: `⚠ NIFTY 52-week-high reading not present in breadth payload${ctxNote} — not guessing a rung. Static protocol below still applies.`,
      };
    }
    // state === 'ok' — breadth returned; rung lights up from suggested_cash_pct.
    const compStr = ctx?.composite != null ? `Breadth composite ${ctx.composite}` : 'Breadth';
    const regimeStr = ctx?.regime ? ` (${ctx.regime})` : '';
    const cashStr = ctx?.cash != null ? ` → suggested cash ${ctx.cash}%` : '';
    // Optional secondary context: a live NIFTY 52w-high drawdown, if present.
    const posStr = pos ? ` · NIFTY ${Math.round(pos.pct52 * 100)}% of 52w high (−${pos.drawdown.toFixed(1)}%)` : '';
    if (!armed)
      return {
        color: ctx?.regimeColor || C.green,
        text: `${compStr}${regimeStr}${cashStr} → near highs · staircase not yet armed, hold the deployable-cash reserve.${posStr}`,
      };
    return {
      color: armed.color,
      text: `${compStr}${regimeStr}${cashStr} → ARMED rung ${armed.trig}: deploy this tranche (${armed.tranche}), cumulative ${armed.cum} of the bucket.${posStr}`,
    };
  })();

  return (
    <>
      <Card title="🪜 The Staircase Deployment Protocol (§7.7)" accent={C.cyan}>
        <div style={{ fontSize: 12, color: C.text2, marginBottom: 10 }}>The deployable cash bucket is the cash you have set aside <strong>specifically for buying corrections</strong> — distinct from emergency fund, operational cash, short-term goals. Reference for all triggers: % drop from 52-week high. The bucket does not reset until the index makes a new 52-week high.</div>

        {/* ── LIVE armed-rung readout (breadth-driven, additive) ── */}
        <div style={{ background: C.card2, border: `1px solid ${readout.color}40`, borderLeft: `3px solid ${readout.color}`, borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: readout.color, textTransform: 'uppercase' }}>◉ Live Deployment Position</span>
            {fetchedAt > 0 && <PanelFreshness dataUpdatedAt={fetchedAt} staleAfterMs={5 * 60_000} label="breadth" />}
          </div>
          <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600, lineHeight: 1.5 }}>{readout.text}</div>
          {state === 'ok' && (
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>
              Source: GET /api/v1/breadth → <code style={{ ...MONO }}>suggested_cash_pct</code>
              {pos ? <> + <code style={{ ...MONO }}>^NSEI.pctOf52wHigh</code></> : null}
              {ctx?.scope ? ` · scope: ${ctx.scope}` : ''}
            </div>
          )}
        </div>

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
              {stair.map((s, i) => {
                const isArmed = i === armedIdx;
                return (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}`, background: isArmed ? `${armAccent}18` : 'transparent' }}>
                    <td style={{ padding: '8px', color: s.color, fontWeight: 800, borderLeft: isArmed ? `3px solid ${armAccent}` : '3px solid transparent', ...MONO }}>
                      {s.trig}
                      {isArmed && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: armAccent }}>◄ YOU ARE HERE</span>}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', color: C.text, fontWeight: 700, ...MONO }}>{s.tranche}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: C.cyan, fontWeight: 800, ...MONO }}>{s.cum}</td>
                    <td style={{ padding: '8px', color: C.text2, fontSize: 12 }}>{s.tag}</td>
                  </tr>
                );
              })}
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
                              <span style={{ ...MONO, color: C.dim, fontSize: 12, minWidth: 26, marginTop: 3, fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</span>
                              <span style={{ fontSize: 14.5, color: C.text2, lineHeight: 1.6 }}>{display}</span>
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
                        <span style={{ ...MONO, color: C.dim, fontSize: 12, minWidth: 26, marginTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
                        <span style={{ fontSize: 14.5, color: checked ? C.text : C.text2, lineHeight: 1.6 }}>{q}</span>
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


// ════════════════════════════════════════════════════════════════════════════
// REGIME ROTATION TAB — the stagflation → recovery playbook (zzz430)
// Shock → transmission → broadening → tightening → earnings recession →
// recession bottom → recovery. What drives each phase, what to own, what to
// avoid, seven historical templates, and a live stagflation scoreboard.
// ════════════════════════════════════════════════════════════════════════════
const RG = {
  expansion: C.green, commodity: C.amber, broaden: '#e0a72a', stag: '#ef7d34',
  tighten: '#d1603a', recession: C.red, easing: C.cyan, quality: C.cyan, defensive: C.purple,
};

function RgSection({ n, title, lede, children }: { n: string; title: string; lede?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: lede ? 5 : 12, borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
        <span style={{ ...MONO, fontSize: 11, color: C.saffron, fontWeight: 700 }}>{n}</span>
        <h3 style={{ fontSize: 17, fontWeight: 900, color: C.text, margin: 0 }}>{title}</h3>
      </div>
      {lede && <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, marginBottom: 14, maxWidth: 860 }}>{lede}</div>}
      {children}
    </div>
  );
}
function RgChip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span style={{ ...MONO, fontSize: 11, padding: '4px 8px', borderRadius: 5, background: C.card2, border: `1px solid ${tone || C.border}`, color: C.text, display: 'inline-block' }}>{children}</span>;
}

const RG_PHASES = [
  { n: 'Phase 0', name: 'Expansion', c: RG.expansion,
    macro: ['Inflation contained · central bank neutral/easing', 'Credit available · earnings estimates rising', 'Consumers healthy · capex increasing'],
    own: ['Growth', 'Industrials', 'Small/mid caps', 'Cyclicals', 'AI infra', 'Semis', 'Capital goods', 'Defence', 'Financials'],
    ownNote: 'Where 10-bagger hunting works best — liquidity and earnings expectations reinforce each other.',
    avoid: ['Poor balance sheets'], avoidNote: 'Structurally little to avoid; still shun weak balance sheets.' },
  { n: 'Phase 1', name: 'Commodity Shock', c: RG.commodity,
    macro: ['Wheat / rice / edible oil / fertilizer / crude spike', 'Core inflation has NOT yet reacted', 'Do NOT call this stagflation — it is a relative-price shock'],
    own: ['Energy', 'Fertilizer', 'Agri inputs', 'Metals', 'Commodity chemicals', 'Inventory-rich food producers'],
    ownNote: 'Buy the supply-constrained producer EARLY — by the time the story is obvious, peak earnings may be priced in.',
    avoid: ['Airlines', 'Restaurants', 'Transport', 'Chemicals', 'Packaging', 'Low-margin mfg', 'Discretionary'],
    avoidNote: 'Companies where food/energy is a large share of cost.' },
  { n: 'Phase 2', name: 'Inflation Broadens', c: RG.broaden,
    macro: ['Shock spreads into wages, rents, transport, services, business costs', 'Core CPI / core PCE begin accelerating', 'The critical transition — watch confirmation signals'],
    own: ['Pricing-power names', 'Branded staples', 'Healthcare', 'Essential infra', 'Exporters', 'Net-cash businesses'],
    ownNote: 'Rotate from pure commodity beta toward businesses that raise price without losing volume.',
    avoid: ['Cost-taker manufacturers', 'Thin-margin discretionary', 'Early-cycle high-beta'],
    avoidNote: 'Anyone absorbing input costs without pass-through.' },
  { n: 'Phase 3', name: 'Stagflation', c: RG.stag,
    macro: ['High inflation + weak growth simultaneously', 'Central-bank dilemma: cut → inflation; hike → growth collapses', 'Policy is trapped — the regime can persist'],
    own: ['Pricing power (branded staples · healthcare · essential infra · mission-critical software · monopolies)', 'Strong balance sheets (net cash · low debt · high ROCE · high FCF conv · low WC)', 'Real assets (low-cost energy/power/commodities · gold · infra · land)'],
    ownNote: 'Metric that matters: revenue growth WITH stable/improving margins despite inflation — plus FCF, low debt, high ROCE, governance.',
    avoid: ['Entry-level consumption', 'Leverage', 'Rate-sensitive real estate', 'Low-margin mfg', 'Expensive thematics'],
    avoidNote: 'High-cost producer + heavy debt + peak commodity price is the TRAP version of a "real asset".' },
  { n: 'Phase 4', name: 'Monetary Tightening', c: RG.tighten,
    macro: ['Central bank: "inflation is persistent" — rates high or rising', 'Discount rate rises → value of DISTANT cash flow falls', 'The portfolio changes dramatically here'],
    own: ['Value', 'Cash', 'Short-duration', 'Profitable businesses', 'Quality with near-term FCF'],
    ownNote: 'Earnings quality now beats headline growth. Own cash flows that arrive soon.',
    avoid: ['Long-duration tech', 'Unprofitable growth', 'High-P/E stocks', 'Leveraged small caps', 'Speculative themes', 'Long Treasuries'],
    avoidNote: 'A rising discount rate collapses the multiple even while earnings rise.' },
  { n: 'Phase 5', name: 'Earnings Recession', c: RG.recession,
    macro: ['Revenue + margin estimates falling · order delays · inventory build', 'Working capital & CFO deteriorate · credit stress · hiring freezes', 'Capex postponed · small caps underperform'],
    own: ['Cash', 'Government bonds', 'Only the highest-quality survivors on deep dislocations'],
    ownNote: 'Don’t confuse a −30% tag with "cheap". Diagnose: valuation vs earnings vs balance-sheet vs permanent impairment. Get aggressive LATER.',
    avoid: ['Leverage', 'Cyclicals with peak-cycle debt', 'Anything you can’t underwrite through the trough'],
    avoidNote: 'Balance-sheet impairment and permanent business impairment are not opportunities.' },
  { n: 'Phase 6', name: 'Recession Bottom', c: RG.easing,
    macro: ['Data looks terrible: recession · unemployment · bankruptcies', 'Market looks forward: inflation ↓ → CB less restrictive → yields peak → revisions stabilise → stocks bottom', 'Buying only after data turns good is too late'],
    own: ['1 · Quality growth (survivors · share-gainers · intact demand)', '2 · Financials (after credit stress peaks)', '3 · Industrials (orders stabilise · PMI turns up)', '4 · Small/mid caps — the next multibagger generation'],
    ownNote: 'The market prices "earnings recovery + operating leverage + multiple expansion" at once — extraordinarily powerful.',
    avoid: ['Waiting for the all-clear', 'Chasing after the base already broke out'],
    avoidNote: 'The most important multibaggers are born when headlines are worst.' },
];

const RG_HIST = [
  { k: '1970s US', sub: 'The Great Inflation', c: C.red, era: '1965 – 1982',
    intro: 'The archetypal stagflation — oil shocks, wage pressure, weak productivity, policy mistakes and multiple recessions; inflation and unemployment high together.',
    chain: ['1973 oil embargo — crude quadruples', 'Production costs rise', 'Consumer prices rise', 'Wage expectations rise', 'Inflation expectations un-anchor', 'Monetary tightening', 'Recession'],
    stats: [['~12%', 'CPI inflation by 1974'], ['>7%', 'unemployment, 1974'], ['~14.5%', 'inflation approached, 1980'], ['>7.5%', 'unemployment, 1980']],
    lesson: 'The mistake was calling the oil shock "temporary". Once inflation feeds wages and expectations it becomes embedded — and the cure is far more painful than the disease looked.' },
  { k: 'Volcker', sub: 'Breaking inflation', c: C.cyan, era: '1979 – 1982',
    intro: 'The sequel that matters more than the oil price: the Fed finally prioritised killing inflation — at the cost of a severe recession — setting up one of history’s great disinflation trades.',
    chain: ['Volcker prioritises inflation over growth', 'Fed funds ~11% → 19% by 1981', 'Monetary contraction bites', 'Severe recession', 'Inflation ~15% → ~4% by end-1982', 'Disinflation trade begins'],
    stats: [['19%', 'peak fed funds, 1981'], ['15%→4%', 'inflation, to end-1982'], ['2', 'trades: inflation, then disinflation'], ['1982', 'the great bull begins']],
    lesson: 'There are TWO distinct trades — the inflation trade (commodities, energy, real assets) and the disinflation/recession trade (bonds, quality growth, beaten-down equities). The transition between them is where huge returns are made.' },
  { k: 'India 2010–13', sub: 'Persistent inflation', c: RG.stag, era: '2010 – 2014',
    intro: 'Not merely "food inflation" — it broadened and stuck, dragging growth and the currency with it. Directly relevant to a small/mid-cap book.',
    chain: ['Food + fuel pressure', 'Inflation broadens into core', 'Tight financial conditions', 'Weaker investment', 'Currency pressure (2013 taper tantrum)', 'Slower growth'],
    stats: [['~10.4%', 'CPI 2010–11'], ['~8.4%', 'CPI 2011–12'], ['~10.4%', 'CPI 2012–13'], ['~8.8%', '10Y G-sec yield 2013–14']],
    lesson: 'Persistent inflation can coexist with deteriorating growth and elevated bond yields for years. When it broadens, high-beta small caps and leverage are punished longest — the barbell toward FCF and low debt is not optional.' },
  { k: 'India 2022', sub: 'The modern template', c: C.amber, era: '2022 – 2023',
    intro: 'The best modern study of a supply shock turning into broad inflation — and then reversing. The Russia–Ukraine war drove a global commodity shock into Indian CPI.',
    chain: ['2021 recovery / demand', '2022 oil + food + commodities explode', 'Inflation broadens (food, fuel, core)', 'Above tolerance 10 months straight', 'RBI hikes repo +250 bps', '2023 commodities fall, inflation eases'],
    stats: [['+250 bps', 'RBI repo, May’22–Feb’23'], ['10', 'months above upper tolerance'], ['↑↓', 'commodities: spike then correct'], ['2023', 'rate-cut expectations improve']],
    lesson: 'A major commodity shock can reverse without a permanent stagflation regime once supply normalises and policy works. The first food spike is not the trade — persistence and transmission are.' },
  { k: '2008 GFC', sub: 'Credit shock → deflation scare', c: C.red, era: '2007 – 2009',
    intro: 'A different beast — a credit shock, not an inflation shock. Oil actually spiked to ~$147 in mid-2008 before the demand collapse crushed it. Shows how fast the machine jumps from "inflation" to "deflation scare".',
    chain: ['Housing + credit bubble', 'Oil spikes to ~$147 (Jul 2008)', 'Lehman fails — funding disappears', 'Forced deleveraging · demand collapse', 'Oil crashes to ~$30s', 'Fed to zero + QE → recovery'],
    stats: [['$147→$30s', 'crude, 2008'], ['−57%', 'S&P 500 peak-to-trough'], ['0%', 'Fed funds by Dec 2008'], ['Mar’09', 'equity bottom']],
    lesson: 'When the shock is CREDIT, cash-rich survives and leverage dies — the opposite reflex to an inflation shock. The commodity "winner" (oil) became the biggest loser within months. The bottom formed on the worst headlines, while the Fed was still easing.' },
  { k: '2020 COVID', sub: 'Shock → stimulus → inflation', c: C.cyan, era: '2020 – 2022',
    intro: 'A whole compressed cycle in 24 months: crash, stimulus, everything-rally, then the supply-chain + stimulus inflation that set up the 2022 tightening.',
    chain: ['Feb–Mar 2020 crash (−34% in 33 days)', 'Massive fiscal + monetary stimulus', 'Liquidity-driven everything-rally', 'Supply chains break + demand surges', '2021–22 inflation broadens', '2022 Fed/RBI tighten hard'],
    stats: [['−34%', 'S&P, 33 days'], ['0%', 'policy rates, 2020'], ['~9%', 'US CPI peak, Jun 2022'], ['dur.', 'spec growth led, then broke']],
    lesson: 'Stimulus into a supply-constrained economy is an inflation engine. The exact assets that led the liquidity phase (long-duration growth, speculative tech) were first to break when tightening arrived — a Phase-0 → Phase-4 rotation in fast-forward.' },
  { k: '2000 Dotcom', sub: 'Valuation, not inflation', c: RG.stag, era: '2000 – 2002',
    intro: 'Proof you don’t need high inflation to get a brutal bear market — you need collapsing earnings expectations and absurd valuations meeting a rising discount rate.',
    chain: ['Late-90s mania · IPOs · no earnings', 'Fed hikes into the froth', 'Multiples meet reality', 'Earnings estimates collapse', 'Nasdaq −78% peak-to-trough', 'Survivors compound for a decade'],
    stats: [['−78%', 'Nasdaq, 2000–02'], ['100×+', 'P/S on no-profit names'], ['~3 yrs', 'to the bottom'], ['AMZN', '−90%, then 100×+']],
    lesson: 'A valuation-led crash punishes duration and unprofitability regardless of inflation — but births the next cycle’s champions (Amazon fell ~90% then compounded enormously). The crash-ladder question, valuation vs permanent impairment, separated the survivors from the zeros.' },
];

const RG_INDS = [
  { c: 'Inflation', n: 'Food CPI', s: 1 }, { c: 'Inflation', n: 'Core CPI', s: 1 }, { c: 'Inflation', n: 'Energy', s: 1 }, { c: 'Inflation', n: 'Wage inflation', s: 1 },
  { c: 'Growth', n: 'PMI', s: 1 }, { c: 'Growth', n: 'Industrial prod.', s: 0 }, { c: 'Growth', n: 'Retail volumes', s: 1 }, { c: 'Growth', n: 'Employment', s: 0 },
  { c: 'Financial', n: '10Y yield', s: 1 }, { c: 'Financial', n: 'Credit spreads', s: 0 }, { c: 'Financial', n: 'Currency', s: 1 }, { c: 'Earnings', n: 'Earnings revisions', s: 1 },
];
const RG_ROT = [
  ['A', 'Commodity producers', 'Supply-constrained · disciplined · strong B/S', RG.commodity],
  ['B', 'Pricing-power companies', 'Raise price without losing volume', RG.broaden],
  ['C', 'Defensives', 'Staples · healthcare · utilities', RG.defensive],
  ['D', 'Cash', 'Optionality while discount rate rises', C.muted],
  ['E', 'Long-duration bonds', 'When inflation finally breaks', C.cyan],
  ['F', 'Quality growth', 'Survivors · share-gainers · durable FCF', RG.quality],
  ['G', 'Small / mid-cap cyclicals', 'Operating leverage into recovery', RG.expansion],
  ['H', 'Speculative growth', 'Late-cycle risk appetite returns', '#7bd88f'],
  ['I', '…back to Commodities', 'The wheel turns again', RG.commodity],
];

// ═══════════════════════════════════════════════════════════════════════════
// zzz433 — LIVE MARKET-CYCLES SCOREBOARD (⭐)
//
// Reads the real composite breadth score (/api/v1/breadth — full NSE universe,
// GH-Actions bhavcopy) and maps its four-state regime onto this page's 7-phase
// framework, so the theory tab carries a live "you are here" read instead of
// being purely static. Pillar bars show WHY (trend / sector / smallcap / flow /
// momentum). Degrades to a quiet notice if the breadth blob is cold.
// ═══════════════════════════════════════════════════════════════════════════
interface BreadthPayload {
  composite: number;
  regime: string;
  regime_color: string;
  regime_desc: string;
  suggested_cash_pct: number;
  pillars?: Record<string, { score: number; weight: number }>;
  universe_size?: number;
  cohort_date?: string;
  generated_at?: string;
  scope_label?: string;
}

// Map the breadth 4-state regime onto the nearest framework phase index (0-6).
function breadthToPhase(regime: string, composite: number): { idx: number; name: string } {
  const r = (regime || '').toLowerCase();
  if (r.includes('expansion')) return { idx: 0, name: 'Expansion' };
  if (r.includes('healthy')) return { idx: 0, name: 'Expansion' };
  if (r.includes('transition')) return composite >= 45 ? { idx: 2, name: 'Inflation Broadens' } : { idx: 4, name: 'Monetary Tightening' };
  // risk-off
  return composite <= 25 ? { idx: 5, name: 'Earnings Recession' } : { idx: 3, name: 'Stagflation' };
}

function RegimeLiveScoreboard({ onJumpPhase }: { onJumpPhase: (i: number) => void }) {
  const [data, setData] = useState<BreadthPayload | null>(null);
  const [state, setState] = useState<'load' | 'ok' | 'cold' | 'err'>('load');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/v1/breadth', { cache: 'no-store' });
        if (!r.ok) { if (!cancelled) setState('err'); return; }
        const j = await r.json();
        if (cancelled) return;
        if (j && typeof j.composite === 'number' && j.regime) { setData(j); setState('ok'); }
        else setState('cold');
      } catch { if (!cancelled) setState('err'); }
    })();
    return () => { cancelled = true; };
  }, []);

  const mapped = data ? breadthToPhase(data.regime, data.composite) : null;
  const PILLAR_LABELS: Record<string, string> = { trend: 'Trend', sector: 'Sector', smallcap: 'Small-cap', flow: 'Flow', momentum: 'Momentum' };

  return (
    <div style={{ background: C.card, border: `1px solid ${data?.regime_color || C.borderStrong}`, borderRadius: 10, padding: '16px 18px', marginBottom: 16, backgroundImage: data ? `linear-gradient(90deg, ${data.regime_color}12, transparent 70%)` : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: state === 'ok' ? 12 : 0 }}>
        <div style={{ ...MONO, fontSize: 10, letterSpacing: 1.2, color: C.cyan, textTransform: 'uppercase' }}>⭐ Live regime read · real NSE breadth</div>
        {data?.generated_at && <div style={{ fontSize: 10, color: C.dim }}>{data.scope_label || 'full universe'} · {new Date(data.generated_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</div>}
      </div>

      {state === 'load' && <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>⏳ Reading live breadth…</div>}
      {state === 'err' && <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>Live breadth unavailable right now — the framework below still applies. <a href="/breadth" style={{ color: C.cyan }}>Open Breadth →</a></div>}
      {state === 'cold' && <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>Breadth blob still warming (built nightly from bhavcopy) — check back after the next sync. <a href="/breadth" style={{ color: C.cyan }}>Breadth page →</a></div>}

      {state === 'ok' && data && mapped && (
        <>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 34, fontWeight: 900, color: data.regime_color, ...MONO, lineHeight: 1 }}>{data.composite}<span style={{ fontSize: 14, color: C.dim }}>/100</span></div>
              <div style={{ fontSize: 9, color: C.dim, letterSpacing: 0.5, marginTop: 2 }}>COMPOSITE BREADTH</div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: data.regime_color }}>{data.regime}</div>
              <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.5, marginTop: 2 }}>{data.regime_desc}</div>
              <div style={{ fontSize: 11.5, color: C.text2, marginTop: 6 }}>
                Suggested cash: <b style={{ color: data.regime_color }}>{data.suggested_cash_pct}%</b> · maps to framework{' '}
                <button onClick={() => onJumpPhase(mapped.idx)} style={{ ...MONO, fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 5, cursor: 'pointer', border: `1px solid ${data.regime_color}`, background: `${data.regime_color}18`, color: data.regime_color }}>
                  Phase {mapped.idx} · {mapped.name} →
                </button>
              </div>
            </div>
          </div>

          {data.pillars && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 14 }}>
              {Object.entries(data.pillars).filter(([k]) => PILLAR_LABELS[k]).map(([k, v]) => {
                const sc = Math.round((v as any).score ?? 0);
                const col = sc >= 60 ? C.green : sc >= 40 ? C.amber : C.red;
                return (
                  <div key={k} style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 10, color: C.dim, fontWeight: 700 }}>{PILLAR_LABELS[k]}</span>
                      <span style={{ fontSize: 12, fontWeight: 900, color: col, ...MONO }}>{sc}</span>
                    </div>
                    <div style={{ height: 4, background: C.border, borderRadius: 2, marginTop: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(0, Math.min(100, sc))}%`, height: '100%', background: col }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 10, color: C.dim, marginTop: 10, fontStyle: 'italic', lineHeight: 1.5 }}>
            Breadth is a participation gauge, not a macro-phase oracle — it tells you risk-on vs risk-off across the tape and is mapped to the nearest framework phase as a starting point. Confirm against the macro indicators below before rotating.
          </div>
        </>
      )}
    </div>
  );
}

function RegimeTab() {
  const [ph, setPh] = useState(0);
  const [hc, setHc] = useState(0);
  const [sev, setSev] = useState<number[]>(RG_INDS.map((x) => x.s));
  const P = RG_PHASES[ph];
  const H = RG_HIST[hc];
  const total = sev.reduce((a, b) => a + b, 0);
  const regime = total <= 5 ? ['NORMAL EXPANSION', C.green]
    : total <= 9 ? ['INFLATION WARNING', '#e0c02a']
    : total <= 14 ? ['INFLATIONARY SLOWDOWN', C.amber]
    : total <= 18 ? ['STAGFLATION', RG.stag]
    : ['STAGFLATIONARY RECESSION', C.red];
  const sevCol = (s: number) => (s === 0 ? C.green : s === 1 ? C.amber : C.red);

  return (
    <div>
      {/* zzz433 — LIVE scoreboard: real NSE-breadth regime read, mapped onto the framework */}
      <RegimeLiveScoreboard onJumpPhase={setPh} />

      {/* hero line */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px', marginBottom: 20, backgroundImage: 'linear-gradient(90deg, rgba(245,166,35,.06), transparent 70%)' }}>
        <div style={{ ...MONO, fontSize: 10, letterSpacing: 1.5, color: C.saffron, textTransform: 'uppercase', marginBottom: 8 }}>The stagflation → recovery playbook</div>
        <div style={{ fontSize: 19, fontWeight: 900, color: C.text, lineHeight: 1.25, marginBottom: 8 }}>Position for the <span style={{ color: C.saffron }}>transition</span>, not the event.</div>
        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.55, maxWidth: 860 }}>Money isn’t made predicting "inflation" or "recession" as a binary — it’s made by identifying which <em>phase</em> you’re in, because the winners of Phase&nbsp;1 become the losers of Phase&nbsp;3. A food-price spike is not the trade; <strong style={{ color: C.text }}>its persistence and transmission are the trade.</strong></div>
      </div>

      {/* 01 machine */}
      <RgSection n="01" title="First, understand the machine" lede={<>Investors blur four different shocks into one word. They have different winners — and the dangerous regime is when they <strong style={{ color: C.text }}>stack</strong>.</>}>
        <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 620 }}>
            <thead><tr>{['Shock', 'First-order effect', 'Beneficiaries', 'Victims'].map((h) => <th key={h} style={{ ...MONO, textAlign: 'left', padding: '10px 12px', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: C.dim, borderBottom: `1px solid ${C.border}`, background: C.card2 }}>{h}</th>)}</tr></thead>
            <tbody>
              {[['Food shock', 'Household purchasing power falls', 'Agri inputs · select food producers', 'Discretionary consumption'],
                ['Oil / energy', 'Input + transport costs rise', 'Energy producers', 'Airlines · chemicals · transport'],
                ['Demand inflation', 'Economy overheating', 'Cyclicals (initially)', 'Eventually bonds & growth'],
                ['Credit shock', 'Financing disappears', 'Cash-rich companies', 'Leveraged companies']].map((r, i) => (
                <tr key={i} style={{ borderBottom: i < 3 ? `1px solid ${C.border}` : 'none' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: C.text, whiteSpace: 'nowrap' }}>{r[0]}</td>
                  <td style={{ padding: '10px 12px', color: C.text2 }}>{r[1]}</td>
                  <td style={{ padding: '10px 12px', color: C.green }}>{r[2]}</td>
                  <td style={{ padding: '10px 12px', color: C.red }}>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, background: C.card2, borderLeft: `3px solid ${C.red}`, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', fontSize: 12.5, color: C.text2, lineHeight: 1.55 }}>
          When they stack — <strong style={{ color: C.red }}>Food ↑ + Oil ↑ + wages ↑ + services ↑ + credit tightens</strong> — a relative-price shock becomes genuine stagflation. US runs <span style={MONO}>energy/imports → services inflation → Fed stays tight → demand slows</span>; India runs through <span style={MONO}>food · fuel · weather · rural purchasing power · supply bottlenecks</span>.
        </div>
      </RgSection>

      {/* 02 phases */}
      <RgSection n="02" title="The seven-phase cycle" lede={<>The core engine. Each phase has a distinct macro state, assets that lead, and assets that bleed. <strong style={{ color: C.text }}>Select a phase.</strong></>}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 14 }}>
          {RG_PHASES.map((p, i) => {
            const on = i === ph;
            return (
              <button key={i} onClick={() => setPh(i)} style={{ flexShrink: 0, cursor: 'pointer', borderRadius: 7, padding: '8px 12px', border: `1px solid ${on ? p.c : C.border}`, background: on ? p.c : C.card, color: on ? '#0a0d12' : C.text2, fontWeight: 700, ...MONO, fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 18, height: 18, borderRadius: 4, display: 'grid', placeItems: 'center', fontSize: 10, background: on ? 'rgba(0,0,0,.2)' : C.card2, color: on ? '#0a0d12' : C.dim }}>{i}</span>{p.name}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 12 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${P.c}`, borderRadius: 8, padding: 16 }}>
            <div style={{ ...MONO, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: P.c }}>{P.n}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text, margin: '4px 0 10px' }}>{P.name}</div>
            {P.macro.map((m, i) => <div key={i} style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.5, paddingLeft: 14, position: 'relative', marginBottom: 4 }}><span style={{ position: 'absolute', left: 0, color: P.c }}>›</span>{m}</div>)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
              <div style={{ ...MONO, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: C.green, marginBottom: 9 }}>▲ Own / overweight</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{P.own.map((o, i) => <RgChip key={i} tone={`${C.green}55`}>{o}</RgChip>)}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>{P.ownNote}</div>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
              <div style={{ ...MONO, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: C.red, marginBottom: 9 }}>▼ Avoid / reduce</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{P.avoid.map((o, i) => <RgChip key={i} tone={`${C.red}44`}>{o}</RgChip>)}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>{P.avoidNote}</div>
            </div>
          </div>
        </div>
      </RgSection>

      {/* 03 confirmation */}
      <RgSection n="03" title="The three-confirmation rule" lede="Never call stagflation early. Escalate the regime only as signals actually confirm — the single discipline that prevents buying 'inflation' when it is still just a commodity blip.">
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {[['01', 'Food / energy rises alone', 'Core has not reacted — a relative-price shock.', '🟢 COMMODITY SHOCK', RG.commodity],
            ['02', 'Food ↑ + core ↑', 'The shock is propagating into goods & services.', '🟡 BROADENING', RG.broaden],
            ['03', 'Food ↑ + core ↑ + growth ↓', 'High inflation now coincides with weak growth.', '🔴 STAGFLATION', RG.stag],
            ['04', '+ employment ↓ + earnings ↓', 'Demand and labour roll over. Protect capital.', '🔴🔴 STAGFLATIONARY RECESSION', C.red]].map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14, alignItems: 'center', padding: '13px 16px', background: C.card, borderBottom: i < 3 ? `1px solid ${C.border}` : 'none', borderLeft: `4px solid ${r[4]}` }}>
              <div style={{ ...MONO, fontSize: 18, color: r[4] as string, fontWeight: 600 }}>{r[0]}</div>
              <div><div style={{ fontWeight: 800, color: C.text, fontSize: 13.5 }}>{r[1]}</div><div style={{ fontSize: 12, color: C.muted }}>{r[2]}</div></div>
              <div style={{ ...MONO, fontSize: 10.5, color: r[4] as string, fontWeight: 700, textAlign: 'right' }}>{r[3]}</div>
            </div>
          ))}
        </div>
        <Card accent={C.saffron}><strong style={{ color: C.text }}>What to watch — </strong> India: food CPI, core CPI, rural wages, FMCG volumes, wheat/rice/edible-oil, crude, rupee, rural consumption. US: core CPI, core PCE, wages, rent, insurance, healthcare, gasoline, consumer credit, employment.</Card>
      </RgSection>

      {/* 04 valuation */}
      <RgSection n="04" title="The valuation rotation" lede={<>When the central bank tightens, the discount rate rises and the value of <strong style={{ color: C.text }}>distant</strong> cash flow falls hardest. Earnings can keep rising while the multiple collapses — which is why, in tightening, earnings quality beats headline growth.</>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
          {[{ t: 'Company A — long-duration growth', tag: 'P/E 100×', tagc: C.red, bars: [100, 60, 40], labs: ['100×', '60×', '40×'], col: C.red, out: <>EPS rises ₹1 → ₹1.5 → ₹2 → ₹3, yet the multiple re-rates <strong style={{ color: C.text }}>100× → 40×</strong>. The stock can <strong style={{ color: C.text }}>fall</strong> while earnings grow.</> },
            { t: 'Company B — profitable value', tag: 'P/E 10×', tagc: C.green, bars: [100, 95, 90], labs: ['10×', '9.5×', '9×'], col: C.green, out: <>EPS ₹10 → ₹11 → ₹12 and the multiple barely moves <strong style={{ color: C.text }}>10× → 9×</strong>. Short-duration earnings are defended.</> }].map((v, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13.5, fontWeight: 800, color: C.text }}>{v.t}<span style={{ ...MONO, fontSize: 10, padding: '3px 7px', borderRadius: 5, background: `${v.tagc}22`, color: v.tagc }}>{v.tag}</span></div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 96, margin: '16px 0 4px' }}>
                {v.bars.map((b, j) => <div key={j} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 5, height: '100%' }}><div style={{ width: '100%', height: `${b}%`, background: `linear-gradient(180deg, ${v.col}, ${v.col}55)`, borderRadius: '5px 5px 0 0' }} /><span style={{ ...MONO, fontSize: 10, color: C.dim }}>{v.labs[j]}</span></div>)}
              </div>
              <div style={{ ...MONO, fontSize: 11.5, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 8, lineHeight: 1.6 }}>{v.out}</div>
            </div>
          ))}
        </div>
      </RgSection>

      {/* 05 crash ladder */}
      <RgSection n="05" title="The crash-buying ladder" lede={<>A −30% tag is not automatically "cheap". First decide which drawdown it is: <strong style={{ color: C.text }}>valuation compression · earnings impairment · balance-sheet impairment · permanent business impairment</strong>. Only the first two are opportunities.</>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          {[['−20%', 'Start investigating', 'Open the file. Re-underwrite. No action yet.', '#e0c02a', 25],
            ['−30%', 'Buy if intact', 'Thesis + earnings intact · strong B/S · valuation materially improved.', RG.stag, 50],
            ['−40%', 'Get aggressive', 'Only if the recession is cyclical, not structural.', '#e5624d', 75],
            ['−50%+', 'Extraordinary', 'Hunt the exceptional — but verify the balance sheet FIRST.', C.red, 100]].map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 15 }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: r[3] as string, letterSpacing: -0.5 }}>{r[0]}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text, margin: '3px 0 6px' }}>{r[1]}</div>
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{r[2]}</div>
              <div style={{ height: 4, background: C.card2, borderRadius: 3, marginTop: 11, overflow: 'hidden' }}><div style={{ height: '100%', width: `${r[4]}%`, background: r[3] as string }} /></div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 14, fontWeight: 800, color: C.text, padding: 16, background: C.card, border: `1px dashed ${C.borderStrong}`, borderRadius: 8 }}>Never buy because of the % decline. Buy the gap between <span style={{ color: C.saffron }}>price decline</span> and <span style={{ color: C.saffron }}>intrinsic-value decline</span>.</div>
      </RgSection>

      {/* 06 history */}
      <RgSection n="06" title="Historical templates" lede={<>Every regime rhymes. Seven case studies — the transmission chain, the numbers, and the one lesson each burns in. <strong style={{ color: C.text }}>Pick a case.</strong></>}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {RG_HIST.map((h, i) => {
            const on = i === hc;
            return <button key={i} onClick={() => setHc(i)} style={{ cursor: 'pointer', textAlign: 'left', borderRadius: 7, padding: '8px 12px', border: `1px solid ${on ? h.c : C.border}`, background: on ? `${h.c}18` : C.card, color: on ? h.c : C.text2, ...MONO, fontSize: 11.5, fontWeight: 700 }}>{h.k}<span style={{ display: 'block', fontSize: 9.5, color: on ? h.c : C.dim, fontWeight: 400, marginTop: 2 }}>{h.sub}</span></button>;
          })}
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.border}`, backgroundImage: `linear-gradient(90deg, ${H.c}14, transparent 70%)` }}>
            <div style={{ ...MONO, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: H.c }}>{H.era}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text, margin: '5px 0 6px' }}>{H.k} · {H.sub}</div>
            <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.55 }}>{H.intro}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
            <div style={{ padding: '16px 18px' }}>
              <div style={{ ...MONO, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: C.dim, marginBottom: 10 }}>Transmission chain</div>
              {H.chain.map((c, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: C.text }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: H.c, flexShrink: 0 }} />{c}</div>
                  {i < H.chain.length - 1 && <div style={{ width: 7, height: 12, borderLeft: `1px solid ${C.borderStrong}`, marginLeft: 3 }} />}
                </div>
              ))}
            </div>
            <div style={{ padding: '16px 18px', borderLeft: `1px solid ${C.border}`, background: C.card2 }}>
              <div style={{ ...MONO, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: C.dim, marginBottom: 10 }}>By the numbers</div>
              {H.stats.map((s, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: i < H.stats.length - 1 ? `1px dotted ${C.border}` : 'none' }}><span style={{ fontSize: 12, color: C.muted }}>{s[1]}</span><span style={{ ...MONO, fontWeight: 600, color: H.c }}>{s[0]}</span></div>)}
            </div>
          </div>
          <div style={{ padding: '14px 18px', borderTop: `1px solid ${C.border}`, backgroundImage: `linear-gradient(90deg, ${H.c}14, transparent 70%)` }}>
            <div style={{ ...MONO, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: C.dim, marginBottom: 6 }}>The lesson</div>
            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>{H.lesson}</div>
          </div>
        </div>
      </RgSection>

      {/* 07 commodity cure */}
      <RgSection n="07" title="Inflation cures itself — eventually" lede="The reason commodity trades are rentals, not marriages. A high price is its own antidote.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          {[['Trigger', 'Price spikes', 'Oil $70→$100→$130. Energy & commodity producers win first; estimates race up.', C.amber],
            ['Response', 'Supply wakes up', 'High prices make new production & alternatives economic. Idle capacity restarts. Inventories build.', C.text2],
            ['Response', 'Demand destructs', 'Consumers drive less; industry substitutes and conserves. Volume quietly falls.', C.text2],
            ['Result', 'Price reverts', 'Supply up + demand down ⇒ the commodity — and the trade — rolls over. The late buyer holds peak-earnings valuation.', C.cyan]].map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `2px solid ${r[3]}`, borderRadius: 8, padding: 14 }}>
              <div style={{ ...MONO, fontSize: 9.5, letterSpacing: 0.8, textTransform: 'uppercase', color: C.dim, marginBottom: 7 }}>{r[0]}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 6 }}>{r[1]}</div>
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{r[2]}</div>
            </div>
          ))}
        </div>
        <Card accent={C.amber}><strong style={{ color: C.text }}>India 2022–23 is the live proof:</strong> after the war-driven peak, global energy, food and metals corrected as supply normalised and demand pressures eased — inflation moderated without a permanent stagflation regime.</Card>
      </RgSection>

      {/* 08 sectors */}
      <RgSection n="08" title="Sector playbook" lede="Where to lean by phase and market. India is food/fuel/rural-sensitive; the US transmits through services, wages, housing, insurance and imports.">
        <div style={{ ...MONO, fontSize: 12, color: C.amber, letterSpacing: 0.5, margin: '2px 0 10px', fontWeight: 700 }}>🇮🇳 INDIA · EARLY INFLATION — overweight</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10 }}>
          {[['Fertilizer', 'Demand structurally essential even as input prices rise. Watch subsidy policy, gas/feedstock cost, realization, government pricing.'],
            ['Agri inputs', 'Seeds, crop protection, irrigation, farm equipment. But high FOOD prices ≠ automatically higher FARMER profitability.'],
            ['Energy & select commodities', 'Strong early-cycle — only when price ↑ AND supply-constrained AND capacity-disciplined AND balance sheet strong.']].map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.amber}`, borderRadius: 8, padding: 14 }}><div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 6 }}>{r[0]}</div><div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{r[1]}</div></div>
          ))}
        </div>
        <div style={{ ...MONO, fontSize: 12, color: C.purple, letterSpacing: 0.5, margin: '20px 0 10px', fontWeight: 700 }}>🇮🇳 INDIA · INFLATION BROADENS — defensive</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{['FMCG', 'Healthcare', 'Utilities', 'Essential infra', 'High-quality banks', 'Exporters', 'Net-cash compounders'].map((x) => <RgChip key={x}>{x}</RgChip>)}</div>
        <div style={{ ...MONO, fontSize: 12, color: C.red, letterSpacing: 0.5, margin: '20px 0 10px', fontWeight: 700 }}>🇮🇳 INDIA · SEVERE STAGFLATION — avoid</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}>
          {[['Entry-level consumption', 'Lower-income households feel food inflation first and hardest.', C.red],
            ['Highly leveraged businesses', 'Interest cost ↑ + weak demand = double damage.', C.red],
            ['Rate-sensitive real estate', 'Expensive financing throttles demand.', C.red],
            ['Low-margin manufacturers', 'Raw material ↑ but no pricing power ⇒ margin collapse.', C.red],
            ['Expensive thematics', 'P/E 80× + growth fading 30%→10% ⇒ brutal multiple compression.', C.red],
            ['✓ Prefer: inflation-resistant compounders', 'Price ↑ · volume stable · margins stable · FCF ↑ · ROCE ↑. You don’t need the commodity cycle to stay favourable.', C.cyan]].map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${r[2]}`, borderRadius: 8, padding: 14 }}><div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 5 }}>{r[0]}</div><div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{r[1]}</div></div>
          ))}
        </div>
        <div style={{ ...MONO, fontSize: 12, color: C.saffron, letterSpacing: 0.5, margin: '20px 0 10px', fontWeight: 700 }}>🇺🇸 US · POSITIONING</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.green}`, borderRadius: 8, padding: 14 }}><div style={{ ...MONO, fontSize: 10, color: C.green, marginBottom: 9, letterSpacing: 0.6 }}>EARLY INFLATION · PREFER</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{['Energy', 'Infrastructure', 'Healthcare', 'Staples', 'Value', 'Select financials'].map((x) => <RgChip key={x} tone={`${C.green}44`}>{x}</RgChip>)}</div></div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.red}`, borderRadius: 8, padding: 14 }}><div style={{ ...MONO, fontSize: 10, color: C.red, marginBottom: 9, letterSpacing: 0.6 }}>AVOID</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{['Unprofitable AI', 'Speculative SaaS', 'Long-duration growth', 'Expensive small caps', 'Leverage'].map((x) => <RgChip key={x} tone={`${C.red}44`}>{x}</RgChip>)}</div></div>
        </div>
        <div style={{ ...MONO, fontSize: 12, color: C.cyan, letterSpacing: 0.5, margin: '20px 0 10px', fontWeight: 700 }}>◆ THE AI QUESTION — don’t sell indiscriminately</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}>
          {[['Type A · resilient', 'Current cash generators', 'Strong FCF + pricing power + dominant position. Short duration — can hold up.', C.green],
            ['Type B · sticky capex', 'Infrastructure bottlenecks', 'Power, grid, cooling, networking, semis, data-center. Capex continues even as consumer demand weakens.', C.amber],
            ['Type C · vulnerable', 'Speculative future AI', 'High valuation + negative FCF + distant earnings. First to break.', C.red]].map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `2px solid ${r[3]}`, borderRadius: 8, padding: 14 }}><div style={{ ...MONO, fontSize: 9.5, color: C.dim, marginBottom: 6, letterSpacing: 0.6 }}>{r[0]}</div><div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>{r[1]}</div><div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{r[2]}</div></div>
          ))}
        </div>
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 14, fontWeight: 800, color: C.text, padding: 14, background: C.card, border: `1px dashed ${C.borderStrong}`, borderRadius: 8 }}>In stagflation, don’t sell AI — <span style={{ color: C.saffron }}>sell duration and weak balance sheets.</span></div>
      </RgSection>

      {/* 09 matrix */}
      <RgSection n="09" title="The regime matrix" lede={<>Two axes decide almost everything: is <strong style={{ color: C.text }}>inflation</strong> rising or falling, and are <strong style={{ color: C.text }}>earnings</strong> rising or falling?</>}>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 8, maxWidth: 720 }}>
          <div />
          <div style={{ ...MONO, fontSize: 11, color: C.text2, textAlign: 'center', alignSelf: 'center' }}>Earnings rising →</div>
          <div style={{ ...MONO, fontSize: 11, color: C.text2, textAlign: 'center', alignSelf: 'center' }}>Earnings falling →</div>
          <div style={{ ...MONO, fontSize: 11, color: C.text2, alignSelf: 'center', textAlign: 'center' }}>Inflation<br />falling ↓</div>
          {[['🟢 Best', 'Multibagger hunting', 'Risk-on. Growth, cyclicals, small/mid-cap inflections.', C.green],
            ['🔵 Recovery watch', 'Begin accumulating', 'Inflation breaking + easing ahead. Bonds, then quality growth.', C.cyan]].map((m, i) => (
            <div key={i} style={{ borderRadius: 8, padding: 14, minHeight: 110, background: `${m[3]}12`, border: `1px solid ${m[3]}44` }}><div style={{ ...MONO, fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, color: m[3] as string }}>{m[0]}</div><div style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: '5px 0 4px' }}>{m[1]}</div><div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.45 }}>{m[2]}</div></div>
          ))}
          <div style={{ ...MONO, fontSize: 11, color: C.text2, alignSelf: 'center', textAlign: 'center' }}>Inflation<br />rising ↑</div>
          {[['🟡 Cyclical', 'Commodities & pricing power', 'Overheating but earnings still up. Energy, real assets, pricing power.', C.amber],
            ['🔴 Stagflation', 'Protect capital', 'Defensives, staples, low-debt / high-FCF, real assets. Raise cash for Phase 5/6.', C.red]].map((m, i) => (
            <div key={i} style={{ borderRadius: 8, padding: 14, minHeight: 110, background: `${m[3]}12`, border: `1px solid ${m[3]}44` }}><div style={{ ...MONO, fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, color: m[3] as string }}>{m[0]}</div><div style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: '5px 0 4px' }}>{m[1]}</div><div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.45 }}>{m[2]}</div></div>
          ))}
        </div>
        <Card accent={C.saffron}><strong style={{ color: C.text }}>Add the third dimension — growth & credit</strong> — and the four boxes fan into a spectrum: 🟢 risk-on → 🟡 cyclicals → 🟠 defensives/pricing-power → 🔴 stagflation → 🔴 recession (credit stress) → 🔵 begin accumulating (easing) → 🟢 multibagger hunting. That last transition generates the largest returns.</Card>
      </RgSection>

      {/* 10 indicators */}
      <RgSection n="10" title="The three indicators that beat a headline">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
          {[['01 · direction', 'Acceleration, not level', 'Inflation 6% FALLING 5.5→5→4.5 is 🟢 bullish. Inflation 4% RISING 4→4.5→5 is 🔴 dangerous. Direction > level.', C.saffron],
            ['02 · real yields', 'Nominal yield − inflation exp.', 'Rising real yields punish speculative growth, long duration, gold, expensive tech. When they PEAK & FALL, quality growth gets interesting.', C.cyan],
            ['03 · revisions', 'Earnings revision score', '+2 rising sharply · +1 stable · 0 mixed · −1 falling · −2 collapsing. The single most important signal — combine with inflation direction.', C.green]].map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `2px solid ${r[3]}`, borderRadius: 8, padding: 14 }}><div style={{ ...MONO, fontSize: 9.5, color: C.dim, marginBottom: 6, letterSpacing: 0.5 }}>{r[0]}</div><div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>{r[1]}</div><div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{r[2]}</div></div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10, marginTop: 12 }}>
          <Card title="Buy levels — signals, not dates" accent={C.green}>
            {[['L1 · Early shock', 'commodity supply beneficiaries — shortage confirmed, estimates rising, valuation reasonable, B/S strong', C.amber],
              ['L2 · Stagflation', 'pricing power + essential demand — margins stable, FCF positive, debt low, demand resilient', RG.stag],
              ['L3 · Recession', 'quality names whose price fell far faster than intrinsic value; earnings visibility + moat', C.cyan],
              ['L4 · Recession bottom', 'the aggressive multibagger zone — revisions stop falling, PMI bottoms, credit eases, bases form', C.green]].map((r, i) => (
              <div key={i} style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 6, paddingLeft: 12, position: 'relative' }}><span style={{ position: 'absolute', left: 0, color: r[2] as string }}>›</span><strong style={{ color: r[2] as string }}>{r[0]}</strong> — {r[1]}</div>
            ))}
          </Card>
          <Card title="Technical confirmation — don't catch the exact bottom" accent={C.cyan}>
            {['Weekly — Stage-2 transition, 30/40-week MA flattening then rising, relative strength improving', 'Daily — higher lows, accumulation volume, breakout from base, an earnings catalyst', 'Let price CONFIRM the macro thesis. Miss the first 10% to avoid the last 30%.'].map((t, i) => (
              <div key={i} style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 6, paddingLeft: 12, position: 'relative' }}><span style={{ position: 'absolute', left: 0, color: C.saffron }}>›</span>{t}</div>
            ))}
          </Card>
        </div>
      </RgSection>

      {/* 11 scoreboard */}
      <RgSection n="11" title="The stagflation scoreboard" lede={<>Twelve indicators, each <strong style={{ color: C.text }}>0 benign · 1 warning · 2 severe</strong> — max 24. Converts "does this feel like stagflation?" into a number and a regime band. <strong style={{ color: C.text }}>Click any indicator</strong> to cycle its severity. <span style={{ color: C.dim }}>(framework, not an official classification)</span></>}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span style={{ fontSize: 40, fontWeight: 900, color: regime[1] as string, letterSpacing: -1 }}>{total}</span><span style={{ ...MONO, color: C.dim, fontSize: 14 }}>/ 24</span></div>
            <div style={{ ...MONO, fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 7, color: regime[1] as string, background: `${regime[1]}18`, letterSpacing: 0.4 }}>{regime[0]}</div>
          </div>
          <div style={{ height: 9, borderRadius: 5, background: `linear-gradient(90deg, ${C.green}, ${C.amber} 40%, ${RG.stag} 66%, ${C.red})`, position: 'relative', marginBottom: 6 }}>
            <div style={{ position: 'absolute', top: -5, left: `${total / 24 * 100}%`, width: 3, height: 19, background: '#fff', borderRadius: 2, boxShadow: '0 0 8px rgba(255,255,255,.5)', transition: 'left .25s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...MONO, fontSize: 9, color: C.dim, marginBottom: 18 }}><span>0 normal</span><span>6 warning</span><span>10 slowdown</span><span>15 stagflation</span><span>19–24 recession</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
            {RG_INDS.map((x, i) => (
              <div key={i} onClick={() => setSev((prev) => prev.map((v, j) => (j === i ? (v + 1) % 3 : v)))} style={{ cursor: 'pointer', userSelect: 'none', background: C.card2, border: `1px solid ${C.border}`, borderRadius: 7, padding: '10px 11px' }}>
                <div style={{ ...MONO, fontSize: 8.5, letterSpacing: 0.6, textTransform: 'uppercase', color: C.dim, marginBottom: 5 }}>{x.c}</div>
                <div style={{ fontSize: 12, color: C.text, fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{x.n}<span style={{ ...MONO, fontSize: 10, color: sevCol(sev[i]) }}>{sev[i]}</span></div>
                <div style={{ height: 5, borderRadius: 3, background: C.card, marginTop: 8, overflow: 'hidden' }}><div style={{ height: '100%', width: sev[i] === 0 ? '14%' : sev[i] === 1 ? '55%' : '100%', background: sevCol(sev[i]), transition: '.2s' }} /></div>
              </div>
            ))}
          </div>
          <div style={{ ...MONO, fontSize: 10.5, color: C.dim, marginTop: 14, textAlign: 'center' }}>tap to cycle severity · benign → warning → severe</div>
        </div>
      </RgSection>

      {/* 12 rotation */}
      <RgSection n="12" title="The master rotation wheel" lede="One turn of the machine. Money migrates through these seats in order — being one seat early is the entire game.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 9 }}>
          {RG_ROT.map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${r[3]}`, borderRadius: 8, padding: '12px 14px' }}><div style={{ ...MONO, fontSize: 9.5, color: C.dim }}>STAGE {r[0]}</div><div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, margin: '2px 0 3px' }}>{r[1]}</div><div style={{ fontSize: 11.5, color: C.muted }}>{r[2]}</div></div>
          ))}
        </div>
      </RgSection>

      {/* 13 decision tree + questions */}
      <RgSection n="13" title="The decision tree & the ten questions" lede="Walk the branches instead of reacting to the headline. Then locate yourself with ten questions that beat any recession call.">
        <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, padding: 8 }}>
          <pre style={{ ...MONO, fontSize: 11.5, lineHeight: 1.85, color: C.muted, padding: 14, margin: 0, minWidth: 520, whiteSpace: 'pre' }}>{`             FOOD / OIL SHOCK
                    │
             Is it temporary?
              /            \\
           YES              NO
            │                │
     Keep growth       Core inflation?
                          /        \\
                        NO          YES
                         │           │
                  `}<span style={{ color: C.amber }}>COMMODITY</span>{`   Growth slowing?
                    `}<span style={{ color: C.amber }}>trade</span>{`         /        \\
                                NO         YES
                                 │          │
                          `}<span style={{ color: C.amber }}>INFLATION</span>{`  `}<span style={{ color: C.red }}>STAGFLATION</span>{`
                                            │
                              `}<span style={{ color: RG.stag }}>Pricing power · staples</span>{`
                              `}<span style={{ color: RG.stag }}>Energy · real assets · low debt</span>{`
                                            │
                                   `}<span style={{ color: C.red }}>RECESSION RISK</span>{`
                                → sell weak businesses
                                            │
                                 `}<span style={{ color: C.cyan }}>Inflation ↓ · CB easing</span>{`
                                            │
                              `}<span style={{ color: C.green }}>BUY QUALITY GROWTH</span>{`
                              `}<span style={{ color: C.green }}>→ INDUSTRIALS · FINANCIALS</span>{`
                              `}<span style={{ color: C.green }}>→ SMALL / MID-CAP INFLECTIONS</span>{`
                                            │
                                   NEW BULL CYCLE`}</pre>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10, marginTop: 12 }}>
          <Card title="The ten questions that locate you" accent={C.saffron}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 18px' }}>
              {['Is inflation accelerating?', 'Is inflation broadening?', 'Is the central bank tightening?', 'Are financial conditions tightening?', 'Are earnings estimates falling?', 'Is credit deteriorating?', 'Has inflation peaked?', 'Has revision pressure peaked?', 'Has the central bank turned?', 'Are leading indicators recovering?'].map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}><span style={{ ...MONO, color: C.saffron, fontWeight: 600 }}>{i + 1}</span><span style={{ color: C.text }}>{q}</span></div>
              ))}
            </div>
          </Card>
          <Card title="Why you should WANT a recession — if your names survive it" accent={C.green}>
            <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, marginBottom: 10 }}>A recession manufactures the setup: <strong style={{ color: C.text }}>lower valuation + temporary earnings depression + forced selling</strong> over an intact structural story.</div>
            <div style={{ ...MONO, fontSize: 11.5, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: 10, lineHeight: 1.9 }}>
              Pre-recession &nbsp;₹800 · EPS ₹20 · 40×<br />Trough &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;₹300 · EPS ₹12 · 25×<br />Recovery + re-rate &nbsp;EPS ₹40 · 35× = <strong style={{ color: C.green }}>₹1,400</strong><br /><span style={{ color: C.saffron }}>₹300 → ₹1,400 = 4.7× — next cycle can make it a 10-bagger.</span>
            </div>
          </Card>
        </div>
      </RgSection>

      {/* 14 investment clock */}
      <RgSection n="14" title="The Investment Clock" lede={<>The canonical connector: plot <strong style={{ color: C.text }}>growth</strong> against <strong style={{ color: C.text }}>inflation</strong> and one asset class leads each quadrant. The economy rotates <strong style={{ color: C.text }}>clockwise</strong> — Reflation → Recovery → Overheat → Stagflation → back — which is the same seven phases seen from the top.</>}>
        <div style={{ display: 'grid', gridTemplateColumns: '104px 1fr 1fr', gap: 8, maxWidth: 760 }}>
          <div />
          <div style={{ ...MONO, fontSize: 11, color: C.text2, textAlign: 'center', alignSelf: 'center' }}>Inflation falling ↓</div>
          <div style={{ ...MONO, fontSize: 11, color: C.text2, textAlign: 'center', alignSelf: 'center' }}>Inflation rising ↑</div>
          <div style={{ ...MONO, fontSize: 11, color: C.text2, alignSelf: 'center', textAlign: 'center' }}>Growth<br />rising ↑</div>
          {[['RECOVERY', 'Stocks lead', 'Bonds → stocks handoff. Tech, discretionary, financials, small caps.', 'Phase 0 · 6', C.green],
            ['OVERHEAT', 'Commodities lead', 'Energy, materials, industrials. Late-cycle cyclicals; pricing power.', 'Phase 1 · 2', C.amber]].map((q, i) => (
            <div key={i} style={{ borderRadius: 8, padding: 14, minHeight: 118, background: `${q[4]}12`, border: `1px solid ${q[4]}44` }}>
              <div style={{ ...MONO, fontSize: 9.5, letterSpacing: 0.8, fontWeight: 700, color: q[4] as string }}>{q[0]} <span style={{ color: C.dim }}>· {q[3]}</span></div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: '5px 0 4px' }}>{q[1]}</div>
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.45 }}>{q[2]}</div>
            </div>
          ))}
          <div style={{ ...MONO, fontSize: 11, color: C.text2, alignSelf: 'center', textAlign: 'center' }}>Growth<br />falling ↓</div>
          {[['REFLATION', 'Bonds lead', 'Growth & inflation both weak; CB easing. Staples, utilities, healthcare.', 'Phase 5 · 6-early', C.cyan],
            ['STAGFLATION', 'Cash & gold lead', 'Weak growth, high inflation. Energy, staples, healthcare; defend.', 'Phase 3 · 4', C.red]].map((q, i) => (
            <div key={i} style={{ borderRadius: 8, padding: 14, minHeight: 118, background: `${q[4]}12`, border: `1px solid ${q[4]}44` }}>
              <div style={{ ...MONO, fontSize: 9.5, letterSpacing: 0.8, fontWeight: 700, color: q[4] as string }}>{q[0]} <span style={{ color: C.dim }}>· {q[3]}</span></div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: '5px 0 4px' }}>{q[1]}</div>
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.45 }}>{q[2]}</div>
            </div>
          ))}
        </div>
        <Card accent={C.saffron}><strong style={{ color: C.text }}>The order of leadership</strong> around the clock is <span style={MONO}>Bonds → Stocks → Commodities → Cash</span> and back. Being one quadrant early is the whole edge — you buy bonds while the headlines still scream inflation, and buy stocks while they still scream recession.</Card>
      </RgSection>

      {/* 15 cross-asset map */}
      <RgSection n="15" title="Cross-asset map by phase" lede="The dots between phases and everything you can hold. What each major asset class tends to do as the machine turns — equities, government bonds, commodities, gold, cash and the US dollar.">
        <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
            <thead><tr>{['Phase', 'Equities', 'Gov bonds', 'Commodities', 'Gold', 'Cash', 'USD'].map((h, i) => <th key={h} style={{ ...MONO, textAlign: i === 0 ? 'left' : 'center', padding: '9px 10px', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: C.dim, borderBottom: `1px solid ${C.border}`, background: C.card2 }}>{h}</th>)}</tr></thead>
            <tbody>
              {[['Expansion', ['↑↑', '→', '↑', '→', '↓', '→']],
                ['Commodity shock', ['↑', '↓', '↑↑', '↑', '→', '↑']],
                ['Broadening', ['→', '↓↓', '↑', '↑', '↑', '↑']],
                ['Stagflation', ['↓', '↓', '→', '↑↑', '↑↑', '↑']],
                ['Tightening', ['↓↓', '↓', '↓', '→', '↑↑', '↑↑']],
                ['Earnings recession', ['↓↓', '↑↑', '↓↓', '↑', '↑↑', '↑']],
                ['Recession bottom', ['↑', '→', '→', '→', '↓', '↓']]].map((r, i) => (
                <tr key={i} style={{ borderBottom: i < 6 ? `1px solid ${C.border}` : 'none' }}>
                  <td style={{ padding: '9px 10px', fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>{r[0]}</td>
                  {(r[1] as string[]).map((cell, ci) => {
                    const col = cell[0] === '↑' ? C.green : cell[0] === '↓' ? C.red : C.dim;
                    return <td key={ci} style={{ ...MONO, padding: '9px 10px', textAlign: 'center', color: col, fontWeight: 600 }}>{cell}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...MONO, fontSize: 10.5, color: C.dim, marginTop: 8 }}>↑ up · → flat · ↓ down · double = strong. Note how gold &amp; cash peak in stagflation, bonds lead in the earnings recession, and equities turn UP at the bottom while everything else still looks bad.</div>
      </RgSection>

      {/* 16 dominoes */}
      <RgSection n="16" title="The signal dominoes" lede={<>The dots fall in a <strong style={{ color: C.text }}>fixed order</strong>. Leading signals fire long before the recession is visible; lagging signals confirm it after the fact. Crucially, <strong style={{ color: C.text }}>stocks bottom before the data does</strong> — which is why waiting for good news is waiting too long.</>}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
          {[['1', 'Yield curve inverts', 'LEADING · ~12–18m ahead', C.cyan],
            ['2', 'Credit spreads widen', 'LEADING', C.cyan],
            ['3', 'New orders / PMI < 50', 'LEADING', C.cyan],
            ['4', 'Earnings revisions ↓', 'COINCIDENT', C.amber],
            ['★', 'Stocks BOTTOM', 'forward-looking · before the data', C.green],
            ['5', 'Unemployment rises', 'LAGGING', C.red],
            ['6', 'Central bank pivots to cutting', 'policy reaction', RG.easing],
            ['7', 'GDP / earnings recover', 'LAGGING · confirms', C.red]].map((d, i) => (
            <div key={i} style={{ flex: '1 1 150px', minWidth: 140, background: d[0] === '★' ? `${C.green}12` : C.card, border: `1px solid ${d[0] === '★' ? C.green : C.border}`, borderRadius: 8, padding: '11px 12px', position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}><span style={{ width: 20, height: 20, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: d[3] as string, color: '#0a0d12' }}>{d[0]}</span><span style={{ ...MONO, fontSize: 8.5, letterSpacing: 0.5, color: d[3] as string, fontWeight: 700 }}>{d[2]}</span></div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{d[1]}</div>
            </div>
          ))}
        </div>
        <Card accent={C.green}><strong style={{ color: C.text }}>The key dot:</strong> the ★ (stocks bottoming) sits <em>between</em> the leading signals and the lagging ones. Unemployment is still rising and GDP still falling when the market turns — because the market has already priced the recovery the data hasn’t delivered yet.</Card>
      </RgSection>

      {/* 17 sector rotation clock */}
      <RgSection n="17" title="Sector rotation clock" lede="Which sectors carry the baton in each phase. Connects the seven phases to your Sector Rotation tab — read top-to-bottom to watch leadership rotate from cyclicals → commodities → defensives → back to cyclicals.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 9 }}>
          {[['Expansion', RG.expansion, ['Financials', 'Industrials', 'Discretionary', 'Tech', 'Small caps']],
            ['Commodity shock', RG.commodity, ['Energy', 'Metals', 'Fertilizer', 'Materials']],
            ['Broadening', RG.broaden, ['Staples', 'Healthcare', 'Energy (still)', 'Exporters']],
            ['Stagflation', RG.stag, ['Energy', 'Staples', 'Healthcare', 'Utilities', 'Gold']],
            ['Tightening', RG.tighten, ['Value', 'Cash-rich', 'Low-duration', 'avoid Tech']],
            ['Earnings recession', RG.recession, ['Staples', 'Utilities', 'Healthcare', 'Bond proxies']],
            ['Recession bottom', RG.easing, ['Financials', 'Tech', 'Industrials', 'Small/mid caps']]].map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${r[1]}`, borderRadius: 8, padding: 13 }}>
              <div style={{ ...MONO, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase', color: r[1] as string, fontWeight: 700, marginBottom: 9 }}>{r[0]}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{(r[2] as string[]).map((s, j) => <RgChip key={j} tone={`${r[1]}44`}>{s}</RgChip>)}</div>
            </div>
          ))}
        </div>
      </RgSection>

      {/* 18 india vs us */}
      <RgSection n="18" title="🇮🇳 India vs 🇺🇸 US — same regime, different machine" lede="The same global shock transmits differently. India is food/fuel/rural-sensitive with an import-inflation currency channel; the US transmits through services, wages and shelter. Positioning must respect which machine you’re trading.">
        <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 620 }}>
            <thead><tr>{['', '🇮🇳 India', '🇺🇸 US'].map((h, i) => <th key={i} style={{ ...MONO, textAlign: 'left', padding: '9px 12px', fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: i === 1 ? C.saffron : i === 2 ? C.cyan : C.dim, borderBottom: `1px solid ${C.border}`, background: C.card2 }}>{h}</th>)}</tr></thead>
            <tbody>
              {[['Primary CPI driver', 'Food · fuel · rural wages', 'Services · wages · shelter · insurance'],
                ['Transmission', 'Weather → food → rural demand', 'Energy/imports → services → wages'],
                ['Rate sensitivity', 'High — leveraged small caps, real estate', 'High — long-duration tech, housing'],
                ['Currency channel', 'INR ↓ imports inflation (crude)', 'USD ↑ exports disinflation'],
                ['Leads early-cycle', 'Fertilizer · agri · energy · PSU', 'Energy · value · healthcare'],
                ['Key watch-list', 'Monsoon · MSP · crude · rupee · CPI', 'Core PCE · shelter · wages · jobless claims'],
                ['Policy body', 'RBI — repo, CRR, OMO', 'Fed — funds rate, QT']].map((r, i) => (
                <tr key={i} style={{ borderBottom: i < 6 ? `1px solid ${C.border}` : 'none' }}>
                  <td style={{ padding: '9px 12px', fontWeight: 700, color: C.text2, whiteSpace: 'nowrap' }}>{r[0]}</td>
                  <td style={{ padding: '9px 12px', color: C.text }}>{r[1]}</td>
                  <td style={{ padding: '9px 12px', color: C.text }}>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </RgSection>

      {/* 19 traps */}
      <RgSection n="19" title="The trap in every phase" lede="Each phase has one recurring mistake that quietly destroys returns. Naming the trap in advance is how you avoid paying its tuition — this is the behavioural layer connecting to the Psychology tab.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
          {[['Phase 0 · Expansion', 'Chasing junk', 'Complacency buys low-quality high-beta on momentum alone.', RG.expansion],
            ['Phase 1 · Shock', 'Buying the winner late', 'The obvious energy/commodity trade — bought at peak-earnings valuation.', RG.commodity],
            ['Phase 2 · Broadening', 'Mistiming the label', 'Calling stagflation too early — or ignoring the broadening entirely.', RG.broaden],
            ['Phase 3 · Stagflation', 'Fake real assets', 'High-cost, indebted producers at peak prices, masquerading as safety.', RG.stag],
            ['Phase 4 · Tightening', 'Averaging down duration', 'Adding to unprofitable growth while the multiple keeps compressing.', RG.tighten],
            ['Phase 5 · Earnings recession', '“Cheap at −30%”', 'Confusing a price fall with a value gain; ignoring the impairment type.', RG.recession],
            ['Phase 6 · Bottom', 'Waiting for the all-clear', 'Buying only after the data turns good — by then the move is gone.', RG.easing]].map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `2px solid ${r[3]}`, borderRadius: 8, padding: 14 }}>
              <div style={{ ...MONO, fontSize: 9.5, color: C.dim, letterSpacing: 0.4, marginBottom: 6 }}>{r[0]}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: r[3] as string, marginBottom: 5 }}>⚠ {r[1]}</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{r[2]}</div>
            </div>
          ))}
        </div>
      </RgSection>

      {/* 20 cheat sheet */}
      <RgSection n="20" title="The one-screen cheat sheet" lede={<>Every dot on a single grid. For each phase: where it sits on the clock, what the central bank is doing, the asset that leads, the sectors that carry it, and <strong style={{ color: C.text }}>your move</strong>. This is the table to keep open.</>}>
        <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 820 }}>
            <thead><tr>{['Phase', 'Clock', 'Central bank', 'Lead asset', 'Lead sectors', 'Your move'].map((h) => <th key={h} style={{ ...MONO, textAlign: 'left', padding: '9px 11px', fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: C.dim, borderBottom: `1px solid ${C.border}`, background: C.card2, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {[['Expansion', 'Recovery', 'Neutral / easing', 'Equities', 'Cyclicals · Tech', 'Hunt multibaggers', RG.expansion],
                ['Commodity shock', 'Overheat', 'Watching', 'Commodities', 'Energy · Materials', 'Buy supply early, keep valuation discipline', RG.commodity],
                ['Broadening', 'Overheat', 'Starting to hike', 'Pricing power', 'Staples · Healthcare', 'Rotate commodity beta → quality', RG.broaden],
                ['Stagflation', 'Stagflation', 'Trapped / hawkish', 'Cash · Gold', 'Energy · Staples', 'Defend margins, raise cash', RG.stag],
                ['Tightening', 'Stagflation→Reflation', 'Peak hawkish', 'Cash · short bonds', 'Value', 'Cut duration & leverage', RG.tighten],
                ['Earnings recession', 'Reflation', 'Pivoting', 'Gov bonds', 'Defensives', 'Protect capital, build the buy-list', RG.recession],
                ['Recession bottom', 'Recovery', 'Easing', 'Equities (early)', 'Financials → Small caps', 'Deploy into quality survivors', RG.easing]].map((r, i) => (
                <tr key={i} style={{ borderBottom: i < 6 ? `1px solid ${C.border}` : 'none' }}>
                  <td style={{ padding: '9px 11px', fontWeight: 800, color: r[6] as string, whiteSpace: 'nowrap', borderLeft: `3px solid ${r[6]}` }}>{r[0]}</td>
                  <td style={{ ...MONO, padding: '9px 11px', color: C.text2, whiteSpace: 'nowrap' }}>{r[1]}</td>
                  <td style={{ padding: '9px 11px', color: C.muted }}>{r[2]}</td>
                  <td style={{ padding: '9px 11px', color: C.text, fontWeight: 600 }}>{r[3]}</td>
                  <td style={{ padding: '9px 11px', color: C.muted }}>{r[4]}</td>
                  <td style={{ padding: '9px 11px', color: C.text }}>{r[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </RgSection>

      {/* 21 now */}
      <RgSection n="21" title="Reading the current tape" lede={<>Best treated as an <strong style={{ color: C.text }}>inflationary-slowdown / stagflation-watch</strong> regime — US growth cooling with inflation above target; India still more food-sensitive. Not a confirmed recession. So: don’t make a full recessionary shift yet — run a <strong style={{ color: C.text }}>barbell</strong>, and keep a cash reserve for Phase 5/6.</>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
          {[['Core · high', 'Quality compounders', ['Strong FCF', 'Low / no debt', 'Pricing power', 'High ROCE'], C.cyan],
            ['Tactical · moderate', 'Real-asset sleeve', ['Energy · power', 'Select commodities', 'Agri inputs', 'Low-cost producers only'], C.amber],
            ['Optionality · moderate', 'Structural capex', ['AI infrastructure', 'Defence', 'Industrial / capex cycle', 'Sticky order books'], C.saffron],
            ['Reduce · low', 'Fragile exposure', ['Leveraged small caps', 'Discretionary consumption', 'Extreme valuations', 'Weak FCF'], C.red]].map((r, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${r[3]}`, borderRadius: 8, padding: 14 }}>
              <div style={{ ...MONO, fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', color: r[3] as string, fontWeight: 700 }}>{r[0]}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.text, margin: '5px 0 8px' }}>{r[1]}</div>
              {(r[2] as string[]).map((x, j) => <div key={j} style={{ fontSize: 12, color: C.muted, padding: '2px 0 2px 12px', position: 'relative' }}><span style={{ position: 'absolute', left: 0, color: r[3] as string }}>–</span>{x}</div>)}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 13.5, fontWeight: 700, color: C.text, padding: 16, background: C.card, border: `1px dashed ${C.borderStrong}`, borderRadius: 8, lineHeight: 1.7 }}>
          Early shock → <strong style={{ color: C.saffron }}>commodities.</strong> Broadening → <strong style={{ color: C.saffron }}>pricing power.</strong> Tightening → <strong style={{ color: C.saffron }}>quality / value / cash.</strong> Earnings recession → <strong style={{ color: C.saffron }}>protect.</strong> Disinflation → <strong style={{ color: C.saffron }}>bonds & quality growth.</strong> Recovery → <strong style={{ color: C.saffron }}>cyclicals.</strong> Early bull → <strong style={{ color: C.saffron }}>small/mid-cap multibaggers.</strong>
        </div>
        <div style={{ marginTop: 14, fontSize: 11, color: C.dim, lineHeight: 1.6, ...MONO }}>Educational framework for macro-regime rotation — not investment advice. Historical figures (1970s US, India 2010–14 & 2022–23, 2008, 2020, 2000) are drawn from central-bank/public records and are approximate, for teaching the mechanism. The scoreboard is a proposed portfolio framework, not an official classification.</div>
      </RgSection>
    </div>
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
        {active === 'regime'     && <RegimeTab />}
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
