'use client';

// ════════════════════════════════════════════════════════════════════════════
// EARNINGS MASTERY — PATCH 1101x
//
// Post-earnings multibagger playbook. 8 sub-tabs covering everything needed
// to identify a great earnings print, time the entry, manage risk, and avoid
// the common traps:
//
//   1. OVERVIEW          — Why earnings = multibagger trigger + PEAD theory
//   2. GREAT EARNINGS    — 7-point checklist for "really great"
//   3. SURPRISE PATTERNS — Tennis ball vs egg + resilience tests
//   4. EARNINGS·SALES·MARGINS — The 3 fundamentals (positive + negative)
//   5. QUALITY           — Quality of earnings signals + red flags
//   6. GUIDANCE          — Forward guidance + analyst revisions
//   7. ENTRY & RISK      — When to buy, stops, position sizing
//   8. INDIA SPECIFICS   — Concalls, promoter speak, sector nuances
//
// Dense reference layout, dark theme, CSS-var colours. Section tabs +
// search-style filter chips.
// ════════════════════════════════════════════════════════════════════════════

import { useState, type CSSProperties } from 'react';

const C = {
  bg: 'var(--mc-bg-0)', card: 'var(--mc-bg-1)', card2: 'var(--mc-bg-2)',
  border: 'var(--mc-border-1)', borderStrong: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', text2: 'var(--mc-text-2)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', amber: 'var(--mc-warn)', red: 'var(--mc-bearish)',
  cyan: 'var(--mc-cyan)', saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
};

const MONO: CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

type TabId = 'overview' | 'great' | 'surprise' | 'fundamentals' | 'quality' | 'guidance' | 'entry' | 'india';

const TABS: { id: TabId; label: string; emoji: string; sub: string; color: keyof typeof C }[] = [
  { id: 'overview',     emoji: '🧭', label: 'Overview',        sub: 'Why earnings = multibagger trigger',  color: 'cyan'    },
  { id: 'great',        emoji: '✅', label: 'Great Earnings',  sub: '7-point checklist',                    color: 'green'   },
  { id: 'surprise',     emoji: '🎾', label: 'Surprise',        sub: 'Tennis ball vs egg test',              color: 'amber'   },
  { id: 'fundamentals', emoji: '📈', label: '3 Fundamentals',  sub: 'Earnings · Sales · Margins',          color: 'green'   },
  { id: 'quality',      emoji: '🔬', label: 'Quality',         sub: 'Real vs paper earnings',               color: 'purple'  },
  { id: 'guidance',     emoji: '📡', label: 'Guidance',        sub: 'Forward + analyst revisions',          color: 'saffron' },
  { id: 'entry',        emoji: '🎯', label: 'Entry & Risk',    sub: 'When/how/how much',                    color: 'cyan'    },
  { id: 'india',        emoji: '🇮🇳', label: 'India Specifics', sub: 'Concalls + sector nuances',            color: 'saffron' },
];

export default function EarningsMasteryPage() {
  const [tab, setTab] = useState<TabId>('overview');

  const card: CSSProperties = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: '18px 22px',
    marginBottom: 14,
  };
  const sectionLabel = (color: string): CSSProperties => ({
    fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color,
    textTransform: 'uppercase', marginBottom: 8, marginTop: 14,
  });
  const positiveBox: CSSProperties = {
    background: `color-mix(in srgb, ${C.green} 5%, transparent)`,
    border: `1px solid color-mix(in srgb, ${C.green} 28%, transparent)`,
    borderRadius: 6, padding: '10px 14px',
  };
  const negativeBox: CSSProperties = {
    background: `color-mix(in srgb, ${C.red} 5%, transparent)`,
    border: `1px solid color-mix(in srgb, ${C.red} 28%, transparent)`,
    borderRadius: 6, padding: '10px 14px',
  };
  const neutralBox: CSSProperties = {
    background: `color-mix(in srgb, ${C.cyan} 5%, transparent)`,
    border: `1px solid color-mix(in srgb, ${C.cyan} 28%, transparent)`,
    borderRadius: 6, padding: '10px 14px',
  };
  const warningBox: CSSProperties = {
    background: `color-mix(in srgb, ${C.amber} 5%, transparent)`,
    border: `1px solid color-mix(in srgb, ${C.amber} 28%, transparent)`,
    borderRadius: 6, padding: '10px 14px',
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, padding: '24px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* HEADER */}
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: C.saffron, margin: 0, letterSpacing: 0.3 }}>
            📊 Post-Earnings Multibagger Playbook
          </h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.55 }}>
            Earnings are the single largest re-rating trigger for compounders. This is the field manual:
            8 sub-tabs covering identification · timing · sizing · risk · psychology.
          </div>
        </div>

        {/* SUBTAB NAV */}
        <div style={{ ...card, padding: '10px 14px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TABS.map((t) => {
              const tColor = C[t.color];
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: '8px 14px',
                  background: active ? `color-mix(in srgb, ${tColor} 14%, transparent)` : 'transparent',
                  border: `1px solid ${active ? tColor : C.border}`,
                  borderRadius: 7, color: active ? tColor : C.text2,
                  fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                  {t.emoji} {t.label}
                  <div style={{ fontSize: 9, fontWeight: 600, color: active ? tColor : C.muted, marginTop: 2, textTransform: 'none' }}>{t.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: OVERVIEW                                                  */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <>
            <div style={{ ...card, borderLeft: `3px solid ${C.cyan}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: C.cyan, margin: 0 }}>
                Why earnings = the single best multibagger trigger
              </h2>
              <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.6, marginTop: 10 }}>
                Compounders don&apos;t move on a steady glide path. They move in step-function jumps that almost
                always cluster around earnings prints. Identify the great print, enter inside the first 5-15 sessions,
                size correctly, and the math compounds heavily over 4-8 quarters. Miss the right one once and you&apos;ve
                missed 80% of the move.
              </div>
              <div style={sectionLabel(C.green)}>📚 THE ACADEMIC PHENOMENON — PEAD</div>
              <div style={neutralBox}>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                  <strong style={{ color: C.cyan }}>Post-Earnings Announcement Drift</strong> (Bernard &amp; Thomas, 1989)
                  is one of the most replicated anomalies in finance. After a positive earnings surprise, the stock
                  continues to drift higher for the next 60 trading days. After a negative surprise, the opposite.
                  The drift exists because <em>analysts under-react</em> to the new information and revise estimates
                  slowly. Edge: enter <strong style={{ color: C.green }}>during the analyst-revision window</strong>,
                  not after.
                </div>
              </div>
              <div style={sectionLabel(C.saffron)}>📊 THE NUMBERS (empirically tested across markets)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={positiveBox}>
                  <strong style={{ color: C.green, fontSize: 12 }}>Top decile of earnings surprise (vs estimate)</strong>
                  <div style={{ fontSize: 12, color: C.text2, marginTop: 3 }}>
                    Average +60-day excess return: <strong style={{ ...MONO, color: C.text }}>+6% to +9%</strong> over benchmark.
                  </div>
                </div>
                <div style={positiveBox}>
                  <strong style={{ color: C.green, fontSize: 12 }}>Beat + raise guidance</strong>
                  <div style={{ fontSize: 12, color: C.text2, marginTop: 3 }}>
                    Average +90-day excess return: <strong style={{ ...MONO, color: C.text }}>+12% to +18%</strong>.
                    This is the canonical multibagger trigger.
                  </div>
                </div>
                <div style={negativeBox}>
                  <strong style={{ color: C.red, fontSize: 12 }}>Bottom decile of surprise</strong>
                  <div style={{ fontSize: 12, color: C.text2, marginTop: 3 }}>
                    Average +60-day excess return: <strong style={{ ...MONO, color: C.text }}>−5% to −8%</strong>. Bad surprises drift down for 2-3 months too.
                  </div>
                </div>
              </div>
              <div style={sectionLabel(C.purple)}>🎯 THE 4-QUESTION DECISION FRAMEWORK</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { q: '1. WAS THE PRINT REALLY GREAT?',     a: 'Run the 7-point checklist (next tab). Beat consensus + raised guidance + quality earnings = green.' },
                  { q: '2. HOW IS THE STOCK REACTING?',     a: 'Tennis ball vs egg. Does it rally on the open and HOLD the gain? Or fade?' },
                  { q: '3. ARE THE FUNDAMENTALS RIGHT?',    a: 'Earnings + sales + margins all positive. No paper-only profits, no decel hidden by base effects.' },
                  { q: '4. AM I ENTERING AT THE RIGHT SPOT?', a: 'Inside the first 5-15 sessions, within 5% of pivot, with stop placed below the most recent base low.' },
                ].map((row, i) => (
                  <div key={i} style={{
                    background: C.card2, border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: '10px 14px',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.saffron, letterSpacing: 0.4 }}>{row.q}</div>
                    <div style={{ fontSize: 12, color: C.text2, marginTop: 4, lineHeight: 1.5 }}>{row.a}</div>
                  </div>
                ))}
              </div>
              <div style={sectionLabel(C.amber)}>⚠ WHY MOST RETAIL FAILS HERE</div>
              <ul style={{ paddingLeft: 22, margin: 0, color: C.text2, fontSize: 13, lineHeight: 1.65 }}>
                <li>Chases the gap-up on day 1 instead of waiting for tennis-ball confirmation.</li>
                <li>Buys without checking <em>quality</em> — falls for one-time gains, FX boosts, tax credits.</li>
                <li>Ignores guidance — focuses only on the trailing quarter number.</li>
                <li>Doesn&apos;t check market context — even great prints fail 60% in correcting markets.</li>
                <li>Sizes too small. The whole point of an earnings trigger is to take a meaningful position.</li>
              </ul>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: GREAT EARNINGS — 7-point checklist                        */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {tab === 'great' && (
          <>
            <div style={{ ...card, borderLeft: `3px solid ${C.green}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: C.green, margin: 0 }}>
                ✅ How to know if an earnings report is <em>really</em> great — 7-point checklist
              </h2>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.55 }}>
                All 7 don&apos;t need to be present — but the more, the higher conviction. 3-of-7 = pass. 5-of-7 = strong.
                7-of-7 = top decile of all prints in any quarter.
              </div>

              {[
                {
                  num: 1, title: 'BEAT THE CONSENSUS',
                  body: 'Reported EPS > consensus analyst estimate. Even better if EPS comes in above the HIGHEST analyst estimate in the survey — that\'s a "blowout" tier surprise.',
                  tip: 'Magnitude matters: a 1-2% beat is noise. >5% beat is a real surprise; >10% beat is exceptional. In India, where analyst coverage is thinner, even the existence of a beat (vs miss) is meaningful.',
                },
                {
                  num: 2, title: 'GUIDANCE RAISED SIGNIFICANTLY',
                  body: 'Company raises guidance for the upcoming quarter AND/OR the fiscal year. "Maintained" guidance is neutral; "raised" guidance is the actual multibagger trigger.',
                  tip: 'Significant = >5% upward revision typically. Some companies sandbag — watch for the pattern over 2-3 quarters of consistent beats-and-raises.',
                },
                {
                  num: 3, title: 'PRICE RESILIENT TO PROFIT-TAKING',
                  body: 'Stock reacts positively to the report AND/OR guidance. Crucially: it resists meaningful profit-taking over the next several days/weeks. Big up day + holding the gain = institutional buying. Big up + immediate fade = retail buying.',
                  tip: 'The first 5-15 sessions post-earnings are the diagnostic window. If price stays in the upper half of the day-1 range, conviction is high.',
                },
                {
                  num: 4, title: 'ANALYSTS RAISE ESTIMATES',
                  body: 'Analyst earnings estimates revised upward within 30 days of the print. >5% positive revision from the 30-day-prior estimate is a meaningful change. Multiple analysts raising = stronger.',
                  tip: 'In India, this signal lags by 1-2 weeks; watch broker notes through end-of-month after results.',
                },
                {
                  num: 5, title: 'REVENUE BEATS TOO (not just EPS)',
                  body: 'Revenue/Sales line is above consensus (preferably above the highest estimate) AND also revised upward for forward periods. Revenue beat + EPS beat = real growth. EPS beat alone (with revenue miss) = cost-cutting; limited shelf life.',
                  tip: 'Cost-cut EPS beats can last 1-2 quarters before the source runs out. Revenue-driven beats can compound for years.',
                },
                {
                  num: 6, title: 'QUALITY OF EARNINGS — REAL PROFIT GROWTH',
                  body: 'Profit improvement comes from increased SALES, not from one-time gains, non-operating income, FX, asset sales, tax credits, or accounting changes. Productivity/cost-cutting has a limited life span.',
                  tip: 'Check the cash flow statement: if CFO is growing in line with PAT, quality is high. If PAT is growing but CFO is flat or down, the earnings are paper.',
                },
                {
                  num: 7, title: 'ROE ≥ 15-17% (vs industry)',
                  body: 'Compare ROE with industry peers. 15-17% is a reasonable cutoff for most sectors. Higher is better. Improving ROE QoQ is a particularly strong signal.',
                  tip: 'Indian context: NBFCs and asset-light pharma can sustain 20-25% ROE for decades. Capital-intensive sectors (steel, capital goods) rarely cross 15% — adjust expectations.',
                },
              ].map((row) => (
                <div key={row.num} style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{
                      minWidth: 32, height: 32, borderRadius: 16,
                      background: `color-mix(in srgb, ${C.green} 15%, transparent)`,
                      border: `1px solid ${C.green}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      ...MONO, color: C.green, fontWeight: 900, fontSize: 14,
                    }}>{row.num}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: C.text, letterSpacing: 0.3 }}>{row.title}</div>
                      <div style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.6, marginTop: 4 }}>{row.body}</div>
                      <div style={{
                        marginTop: 6, padding: '6px 10px',
                        background: `color-mix(in srgb, ${C.cyan} 6%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${C.cyan} 22%, transparent)`,
                        borderRadius: 5, fontSize: 11.5, color: C.text2, fontStyle: 'italic',
                      }}>
                        <strong style={{ color: C.cyan, fontStyle: 'normal' }}>💡 Tip: </strong>{row.tip}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 3: SURPRISE PATTERNS — Tennis Ball vs Egg                    */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {tab === 'surprise' && (
          <>
            <div style={{ ...card, borderLeft: `3px solid ${C.amber}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: C.amber, margin: 0 }}>
                🎾 When is an earnings surprise <em>really</em> a surprise?
              </h2>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.55 }}>
                Two stocks can print the same headline numbers. One becomes a 5-bagger. The other goes nowhere.
                The difference is in the PRICE RESPONSE, not the earnings number itself. Read the response, not the press release.
              </div>

              <div style={sectionLabel(C.cyan)}>1️⃣ INITIAL RESPONSE</div>
              <div style={{ ...neutralBox, marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>
                  Did the stock rally or sell off on the print? If it sold off, what happened next? Was the bounce a
                  <strong style={{ color: C.amber }}> "dead-cat bounce"</strong> that then resumed the slide?
                  Or did it come <strong style={{ color: C.green }}>roaring back</strong>?
                </div>
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ ...positiveBox, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.green, letterSpacing: 0.4 }}>🎾 TENNIS BALL</div>
                    <div style={{ fontSize: 11.5, color: C.text2, marginTop: 5, lineHeight: 1.5 }}>
                      Stock drops on the print but BOUNCES BACK sharply within 1-3 sessions. The drop was a
                      shake-out, not real selling. Institutions absorbed the offer. Strongest setup.
                    </div>
                  </div>
                  <div style={{ ...negativeBox, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.red, letterSpacing: 0.4 }}>🥚 EGG</div>
                    <div style={{ fontSize: 11.5, color: C.text2, marginTop: 5, lineHeight: 1.5 }}>
                      Stock drops on the print and STAYS DOWN. Maybe a feeble bounce that fails. The selling
                      is real distribution. Avoid until clear basing structure forms.
                    </div>
                  </div>
                </div>
              </div>

              <div style={sectionLabel(C.cyan)}>2️⃣ SUBSEQUENT STRENGTH</div>
              <div style={{ ...warningBox, marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>
                  How well does the stock <strong style={{ color: C.amber }}>HOLD ITS GAIN</strong> over the next 5-15
                  sessions? Profit-taking from event traders happens days 1-5. Real institutional buying shows up days
                  5-20. Strong stocks <strong style={{ color: C.green }}>spend most of their time in the upper half</strong>
                  of the post-earnings range.
                </div>
                <div style={{ marginTop: 10 }}>
                  <ul style={{ paddingLeft: 22, margin: 0, color: C.text2, fontSize: 12, lineHeight: 1.6 }}>
                    <li><strong style={{ color: C.green }}>Best:</strong> trades in upper 25% of the day-1 range for the next 2 weeks.</li>
                    <li><strong style={{ color: C.amber }}>OK:</strong> trades in upper half of the day-1 range, occasional dip to the midpoint.</li>
                    <li><strong style={{ color: C.red }}>Bad:</strong> sinks below the day-1 close within 5 sessions on rising volume.</li>
                  </ul>
                </div>
              </div>

              <div style={sectionLabel(C.cyan)}>3️⃣ RESILIENCE TO PROFIT-TAKING</div>
              <div style={{ ...positiveBox, marginBottom: 10 }}>
                <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>
                  When the inevitable profit-taking dip comes, does the stock <strong style={{ color: C.green }}>recover quickly and powerfully</strong>?
                  Or does it fail to rally back and grind sideways/down?
                </div>
                <div style={{ marginTop: 10 }}>
                  <ul style={{ paddingLeft: 22, margin: 0, color: C.text2, fontSize: 12, lineHeight: 1.6 }}>
                    <li><strong style={{ color: C.green }}>Resilient (BUY):</strong> Dip is shallow (&lt;7%), recovery is sharp (back to highs within 5 sessions), recovery volume is heavy.</li>
                    <li><strong style={{ color: C.amber }}>Drifting (WATCH):</strong> Dip stretches 2-3 weeks but volume contracts and price holds above prior support. Probably consolidation.</li>
                    <li><strong style={{ color: C.red }}>Failing (EXIT):</strong> Dip of 10%+, weak bounce, recovers less than half. Loses post-earnings high. Pattern broken.</li>
                  </ul>
                </div>
              </div>

              <div style={sectionLabel(C.purple)}>📊 THE 3-DIMENSIONAL SCORECARD</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { dim: 'Day 1 — Initial Response',  goal: 'Up ≥ 3% on heavy volume, close in upper half',                                          weight: 'High'   },
                  { dim: 'Days 2-5 — Profit-Taking',  goal: 'Minimal pullback. Closes stay in upper half. Volume contracts on dips.',                weight: 'High'   },
                  { dim: 'Days 5-15 — Drift',         goal: 'New 52w high within 15 sessions. Rising on heavy volume, declining on light volume.', weight: 'Very High' },
                  { dim: 'Days 15-30 — Sponsorship',   goal: 'Stock builds a new tight base above the gap. Acc-vs-Dis ratio ≥ 2:1 on weeklies.',     weight: 'High'   },
                  { dim: 'Days 30-60 — PEAD',          goal: 'Outperforms benchmark by ≥ 5%. Analyst revisions still flowing in.',                   weight: 'Medium' },
                ].map((r, i) => (
                  <div key={i} style={{
                    background: C.card2, border: `1px solid ${C.border}`,
                    borderRadius: 6, padding: '8px 14px',
                    display: 'grid', gridTemplateColumns: '180px 1fr 70px', gap: 12, alignItems: 'center',
                  }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: C.amber }}>{r.dim}</div>
                    <div style={{ fontSize: 11.5, color: C.text2 }}>{r.goal}</div>
                    <div style={{ fontSize: 10, color: C.muted, textAlign: 'right', textTransform: 'uppercase', letterSpacing: 0.5 }}>{r.weight}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 4: FUNDAMENTALS — Earnings, Sales, Margins                   */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {tab === 'fundamentals' && (
          <>
            <div style={{ ...card, borderLeft: `3px solid ${C.green}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: C.green, margin: 0 }}>
                📈 The 3 Key Fundamentals — Earnings · Sales · Margins
              </h2>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.55 }}>
                After the print, these 3 line items tell you whether you have a real multibagger setup or a one-quarter wonder.
              </div>

              {/* POSITIVE SIGNALS */}
              <div style={sectionLabel(C.green)}>✅ POSITIVE — what you want to see</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { title: 'EARNINGS up 20%+ in most recent 2-3 quarters',
                    detail: 'The bigger the better. Look at a 2-quarter average so a single huge quarter doesn\'t distort. >40% on a 2-quarter average is exceptional.' },
                  { title: 'SALES increasing in most recent 2-3 quarters',
                    detail: 'Revenue is the engine. Sales growth + EPS growth = real expansion. Sales flat + EPS up = margin trick, limited runway.' },
                  { title: 'EARNINGS + SALES ACCELERATION quarter-over-quarter',
                    detail: 'Sequential acceleration is the strongest signal. Look at 2-quarter avg up 20%, then the next 2-quarter avg up 30%, then 40% — that\'s the breakout-year pattern.' },
                  { title: 'CURRENT GROWTH > 3-5 year average',
                    detail: 'A stock printing 35% growth when its 5-yr average is 18% is accelerating. The inflection is what re-rates the multiple. Buy the inflection, not the steady state.' },
                  { title: 'BREAKOUT YEAR',
                    detail: 'Annual EPS up 50%+ vs prior year, with revenue acceleration. CANSLIM "C" + "A" condition both lit simultaneously. Statistically the entry year for almost all megawinners.' },
                  { title: 'STRONG ANNUAL EARNINGS (CAGR ≥ 25% for 3-5 years)',
                    detail: 'Required durability evidence. A single great quarter without backing is suspect. 3 years of 25%+ growth = real company.' },
                  { title: 'EXPANDING PROFIT MARGINS',
                    detail: 'Gross margin and OPM both rising QoQ for 2-3 quarters = pricing power + operating leverage. The single best predictor of next-year EPS growth.' },
                  { title: 'CODE 3 STOCKS (CANSLIM premium signal)',
                    detail: 'Triple-condition lit: triple-digit EPS quarter, EPS rank ≥ 90, RS rank ≥ 90. O\'Neil\'s premium "real multibagger" tag. Rare but explosive.' },
                ].map((row, i) => (
                  <div key={i} style={positiveBox}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.green }}>{row.title}</div>
                    <div style={{ fontSize: 12, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>{row.detail}</div>
                  </div>
                ))}
              </div>

              {/* NEGATIVE SIGNALS */}
              <div style={sectionLabel(C.red)}>⚠ NEGATIVE — what kills the setup</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { title: 'MATERIAL EARNINGS DECELERATION',
                    detail: 'Growth rate of growth turning down. e.g., from +35% to +15% — even if still positive, the second derivative shift kills the multiple. The market punishes deceleration brutally.' },
                  { title: 'ERODING MARGINS',
                    detail: 'OPM falling 200+ bps QoQ for 2 consecutive quarters. Cost inflation passing through, pricing power weakening, or competition intensifying. Sell signal.' },
                  { title: 'POSITIVE EARNINGS WITH NEGATIVE SALES',
                    detail: 'EPS growing while revenue is flat or down = cost-cut driven. Limited runway. Usually 1-3 quarters before the next print exposes it.' },
                  { title: 'STRONG EARNINGS + LOW TAX RATE',
                    detail: 'Effective tax rate < 15% in a non-SEZ context is a red flag. Tax credits, one-time deductions, or aggressive accounting are inflating reported EPS.' },
                  { title: 'GROWTH FUNDED BY DEBT',
                    detail: 'EPS up but debt also up 30%+ YoY. The company is buying its growth. Eventually the interest cost eats the EPS — and one cycle later the debt becomes the story.' },
                  { title: 'EPS UP, CFO FLAT/DOWN',
                    detail: 'Cash flow from operations not tracking with reported PAT. The earnings are paper. Within 2-4 quarters this gets exposed.' },
                ].map((row, i) => (
                  <div key={i} style={negativeBox}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.red }}>{row.title}</div>
                    <div style={{ fontSize: 12, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>{row.detail}</div>
                  </div>
                ))}
              </div>

              {/* THE COMBINATION MATRIX */}
              <div style={sectionLabel(C.purple)}>📋 EARNINGS × SALES MATRIX</div>
              <div style={{
                background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '14px 18px', ...MONO, fontSize: 12, lineHeight: 1.7, color: C.text,
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', ...MONO, fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: C.muted, fontSize: 10, fontWeight: 800 }}>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}></th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>SALES UP</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>SALES FLAT</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>SALES DOWN</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px 4px', fontWeight: 800, color: C.muted }}>EPS UP</td>
                      <td style={{ padding: '8px 4px', color: C.green, fontWeight: 700 }}>BUY · core thesis</td>
                      <td style={{ padding: '8px 4px', color: C.amber }}>WATCH · margin trick</td>
                      <td style={{ padding: '8px 4px', color: C.red }}>AVOID · short shelf life</td>
                    </tr>
                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px 4px', fontWeight: 800, color: C.muted }}>EPS FLAT</td>
                      <td style={{ padding: '8px 4px', color: C.amber }}>WATCH · margin pressure</td>
                      <td style={{ padding: '8px 4px', color: C.muted }}>PASS</td>
                      <td style={{ padding: '8px 4px', color: C.red }}>AVOID</td>
                    </tr>
                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px 4px', fontWeight: 800, color: C.muted }}>EPS DOWN</td>
                      <td style={{ padding: '8px 4px', color: C.amber }}>WATCH · investment phase?</td>
                      <td style={{ padding: '8px 4px', color: C.red }}>AVOID</td>
                      <td style={{ padding: '8px 4px', color: C.red, fontWeight: 700 }}>DANGER · structural decline</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 5: QUALITY — Real vs Paper Earnings                          */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {tab === 'quality' && (
          <>
            <div style={{ ...card, borderLeft: `3px solid ${C.purple}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: C.purple, margin: 0 }}>
                🔬 Quality of Earnings — Real vs Paper Profits
              </h2>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.55 }}>
                A great-looking print can be hollow. These are the checks that distinguish genuine cash compounding from financial engineering.
              </div>

              <div style={sectionLabel(C.green)}>✅ HIGH-QUALITY SIGNATURES</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { t: 'CFO/PAT ≥ 0.85 (5-year average)', d: 'Cash flow from operations tracks with reported profit. Profits are turning into actual cash. The single most important quality signal.' },
                  { t: 'Receivable Days STABLE or DECREASING', d: 'Sales are getting paid promptly. No channel stuffing, no related-party games. If debtor days suddenly expand 30+ days QoQ, dig.' },
                  { t: 'Inventory Days NORMAL for sector', d: 'Inventory growth in line with sales. Sudden inventory build is either pre-festival stocking (OK) or supply-side issues (red flag).' },
                  { t: 'Operating Margin RECONCILES with peer set', d: 'OPM materially above peers needs an explanation: pricing power, vertical integration, scale advantage. Without explanation, the abnormal margin is suspect.' },
                  { t: 'Tax Rate 22-25% (Indian context, ex-SEZ)', d: 'Effective tax rate at the corporate rate = clean accounting. Persistently low ETR needs SEZ / R&D justification.' },
                  { t: 'Working Capital STABLE as % of revenue', d: 'Working capital scaling proportionally with revenue is healthy. Sudden expansion = cash trapped in operations.' },
                ].map((r, i) => (
                  <div key={i} style={positiveBox}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.green }}>{r.t}</div>
                    <div style={{ fontSize: 12, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>{r.d}</div>
                  </div>
                ))}
              </div>

              <div style={sectionLabel(C.red)}>⚠ RED FLAGS — earnings of suspect quality</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { t: 'PAT growing 30%+ but CFO flat/down', d: 'Classic paper-earnings signature. Reported profits aren\'t turning into cash. This pattern preceded most major Indian frauds (Manpasand, Educomp, Vakrangee).' },
                  { t: 'OTHER INCOME > 25% of PBT', d: 'Non-operating income (interest on deposits, dividends, sale of assets, FX gains) is propping up operating PBT. Operating profit alone wouldn\'t hit the headline.' },
                  { t: 'EFFECTIVE TAX RATE persistently < 15%', d: 'Tax credits / loss carry-forwards / SEZ tilt running out. Eventually normalizes and earnings drop by the same amount.' },
                  { t: 'ONE-TIME GAIN BOOSTING THE QUARTER', d: 'Asset sale, IP sale, FX gain, accounting policy change. Look at the YoY ex-one-time growth. If <half the headline number, the underlying isn\'t there.' },
                  { t: 'EXTRA "EXCEPTIONAL ITEMS" line in P&L', d: 'Companies that frequently report "exceptional items" — either gains or losses — are smoothing earnings. Real businesses have less variance in the exceptional line.' },
                  { t: 'INVENTORY UP 40%+ vs SALES UP 15%', d: 'Disproportionate inventory build. Either anticipating demand (and miscalculating), or pulling sales forward, or hiding obsolete stock.' },
                  { t: 'RECEIVABLE DAYS expanding 30+ days QoQ', d: 'Channel-stuffing pattern. Sales recognized but cash not received. Within 1-2 quarters this becomes a write-off.' },
                  { t: 'GROSS MARGIN improving while OPM falling', d: 'Cost saved at the product level but burned at SG&A / employee cost. Hidden expense growth that\'ll eventually swamp gross-margin gains.' },
                  { t: 'CAPEX > Depreciation × 2 for 3+ years', d: 'Heavy investment phase. Not bad per se — but EPS now has limited upside until the capacity yields. Earnings quality during build-out is structurally low.' },
                ].map((r, i) => (
                  <div key={i} style={negativeBox}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.red }}>{r.t}</div>
                    <div style={{ fontSize: 12, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>{r.d}</div>
                  </div>
                ))}
              </div>

              <div style={sectionLabel(C.cyan)}>🧮 THE 5-MINUTE QUALITY CHECK</div>
              <div style={neutralBox}>
                <ol style={{ paddingLeft: 22, margin: 0, fontSize: 12.5, color: C.text, lineHeight: 1.7 }}>
                  <li>Open cash flow statement. <strong>CFO ≥ PAT?</strong> Pass or fail.</li>
                  <li>Open P&L. <strong>Other Income / PBT &lt; 25%?</strong> Pass or fail.</li>
                  <li>Open ratios. <strong>Effective tax rate 22-26%?</strong> Pass or fail.</li>
                  <li>Open balance sheet. <strong>Debtor days flat or improving?</strong> Pass or fail.</li>
                  <li>Open YoY. <strong>Growth ex-one-time ≥ 50% of headline growth?</strong> Pass or fail.</li>
                </ol>
                <div style={{ marginTop: 10, fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
                  Pass 4-of-5 → quality earnings, proceed to entry. Pass 2-of-5 → watchlist only. Pass 0-of-5 → avoid entirely.
                </div>
              </div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 6: GUIDANCE                                                  */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {tab === 'guidance' && (
          <>
            <div style={{ ...card, borderLeft: `3px solid ${C.saffron}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: C.saffron, margin: 0 }}>
                📡 Guidance &amp; Analyst Revisions — Forward-Looking Signals
              </h2>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.55 }}>
                The trailing print is yesterday. Guidance and revisions are tomorrow. Multibagger compounding lives in forward expectations.
              </div>

              <div style={sectionLabel(C.green)}>📊 GUIDANCE QUALITY HIERARCHY</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { tier: 'BEAT + RAISE',         color: C.green,   detail: 'Beat the print AND raised next-quarter/full-year guidance significantly (>5%). The strongest multibagger trigger.' },
                  { tier: 'BEAT + MAINTAIN',      color: C.green,   detail: 'Beat the print, kept guidance unchanged. Healthy — likely setting up a beat-and-raise next quarter (sandbagging).' },
                  { tier: 'IN-LINE + RAISE',      color: C.cyan,    detail: 'Print met estimates, raised guidance. Forward acceleration. Less powerful than beat-and-raise but still positive.' },
                  { tier: 'IN-LINE + MAINTAIN',   color: C.muted,   detail: 'Pass-through quarter. No action — wait for the next print.' },
                  { tier: 'MISS + RAISE',         color: C.amber,   detail: 'Missed on trailing but raised forward. Controversial. The market may interpret as desperate or genuine inflection — watch reaction.' },
                  { tier: 'BEAT + LOWER',         color: C.red,     detail: 'Beat the print but lowered forward guidance. Distribution incoming — exit immediately.' },
                  { tier: 'MISS + LOWER',         color: C.red,     detail: 'Negative on both axes. Hard avoid until structural reset is complete (usually 2-4 quarters).' },
                  { tier: 'GUIDANCE WITHDRAWN',   color: C.red,     detail: 'The company doesn\'t know what next quarter looks like. Avoid entirely until visibility returns.' },
                ].map((r, i) => (
                  <div key={i} style={{
                    background: C.card2, border: `1px solid ${r.color}55`,
                    borderRadius: 7, padding: '9px 14px',
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                  }}>
                    <div style={{
                      minWidth: 130, fontSize: 11, fontWeight: 800, color: r.color, letterSpacing: 0.4,
                    }}>{r.tier}</div>
                    <div style={{ flex: 1, fontSize: 12, color: C.text2, lineHeight: 1.5 }}>{r.detail}</div>
                  </div>
                ))}
              </div>

              <div style={sectionLabel(C.cyan)}>📈 ANALYST REVISIONS — What to track</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { t: 'CONSENSUS EPS revision over 30 days', d: 'Compare today\'s consensus EPS with the 30-day-prior value. >5% upward revision is meaningful. >10% is exceptional.' },
                  { t: 'NUMBER OF ANALYSTS raising vs lowering', d: 'Even with no consensus change, the spread of revisions matters. 5 raising + 2 lowering is bullish; 3 raising + 4 lowering is mixed.' },
                  { t: 'TARGET PRICE REVISIONS', d: 'Multiple analysts raising target prices by >10% within 2 weeks of earnings = re-rating in progress. Multibagger setups frequently feature 30-50% TP revisions.' },
                  { t: 'NEW COVERAGE INITIATIONS', d: 'When a previously-uncovered name gets new analyst coverage, especially from a major broker, institutional flows follow within weeks.' },
                  { t: 'RECOMMENDATION UPGRADES', d: 'Sell → Hold → Buy. Cascade upgrades are the rarest and most predictive. Single-broker upgrade is noise; 3+ broker upgrades in a month = institutional consensus shifting.' },
                  { t: 'EARNINGS SURPRISE HISTORY', d: 'Has the company beaten consensus the last 4+ quarters consistently? Pattern of beats is itself predictive of the next quarter\'s outcome.' },
                ].map((r, i) => (
                  <div key={i} style={neutralBox}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.cyan }}>{r.t}</div>
                    <div style={{ fontSize: 12, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>{r.d}</div>
                  </div>
                ))}
              </div>

              <div style={sectionLabel(C.amber)}>⚠ THE REVISION TIMING TRAP</div>
              <div style={warningBox}>
                <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>
                  Analysts revise SLOWLY. The first round of revisions hits 1-2 weeks after the print. The biggest
                  block of revisions hits 3-5 weeks after the print. By the time consensus has fully caught up
                  (~6-8 weeks), the stock has often moved 20-40%. <strong style={{ color: C.amber }}>The edge lives
                  in the gap between Day 1 and Day 30.</strong> Enter before consensus catches up.
                </div>
              </div>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 7: ENTRY & RISK                                              */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {tab === 'entry' && (
          <>
            <div style={{ ...card, borderLeft: `3px solid ${C.cyan}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: C.cyan, margin: 0 }}>
                🎯 Entry, Stops &amp; Position Sizing
              </h2>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.55 }}>
                When the print is great, the entry mechanics determine 80% of the eventual P&amp;L. Don&apos;t waste
                a great setup with sloppy execution.
              </div>

              <div style={sectionLabel(C.green)}>📅 ENTRY TIMING WINDOWS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { tier: 'DAY 0 (Print day)',         color: C.amber,   detail: 'High volatility, gap-and-go or gap-and-fade. Only buy at the open if the stock was already in a base going in. Volume too noisy to assess.' },
                  { tier: 'DAY 1-5 (Tennis ball)',     color: C.green,   detail: 'Best window. Read price action: tennis ball confirmation (prior tab) lets you size up. Buy on dip into 21EMA or back to gap-up midpoint.' },
                  { tier: 'DAY 5-15 (PEAD window)',    color: C.green,   detail: 'Drift entries. New base forming above the gap. Pocket pivots on declining-volume pullbacks. This is where most institutional money enters.' },
                  { tier: 'DAY 15-30 (Pullback entry)', color: C.cyan,   detail: 'First proper pullback to 21EMA or 50DMA after the initial run. Reduced volatility, tighter stop placement. Best risk-reward window for late entries.' },
                  { tier: 'DAY 30+ (Late chase)',       color: C.red,    detail: 'Avoid. Most of the PEAD has played out. Either wait for the next base, or wait for the next earnings event.' },
                ].map((r, i) => (
                  <div key={i} style={{
                    background: C.card2, border: `1px solid ${r.color}55`,
                    borderRadius: 7, padding: '9px 14px',
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                  }}>
                    <div style={{ minWidth: 170, fontSize: 11, fontWeight: 800, color: r.color, letterSpacing: 0.4 }}>{r.tier}</div>
                    <div style={{ flex: 1, fontSize: 12, color: C.text2, lineHeight: 1.5 }}>{r.detail}</div>
                  </div>
                ))}
              </div>

              <div style={sectionLabel(C.red)}>🛑 STOP PLACEMENT</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={negativeBox}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.red }}>HARD STOP</div>
                  <div style={{ fontSize: 12, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>
                    7% below entry, or below the most recent pre-earnings base low (whichever is tighter). Non-negotiable. Closing below this = exit.
                  </div>
                </div>
                <div style={warningBox}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.amber }}>STRUCTURAL STOP</div>
                  <div style={{ fontSize: 12, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>
                    21EMA on daily for active management, 50DMA for swing positions, 30W MA for long-term. Three consecutive closes below is the trigger.
                  </div>
                </div>
                <div style={positiveBox}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.green }}>TRAILING STOP (after +20%)</div>
                  <div style={{ fontSize: 12, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>
                    Once position is up 20%+, move stop to break-even. After +40%, trail behind 21EMA or 50DMA. Lock in.
                  </div>
                </div>
                <div style={neutralBox}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: C.cyan }}>TIME STOP</div>
                  <div style={{ fontSize: 12, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>
                    If position is flat after 6 weeks despite good print, exit. Capital opportunity cost is real. Earnings triggers that don&apos;t work in 6 weeks usually don&apos;t work at all.
                  </div>
                </div>
              </div>

              <div style={sectionLabel(C.purple)}>📏 POSITION SIZING</div>
              <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: C.muted, fontSize: 10, fontWeight: 800 }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>SETUP QUALITY</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>INITIAL SIZE</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>SCALE-UP RULE</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px', color: C.green, fontWeight: 800 }}>Top-decile (7/7 checklist)</td>
                      <td style={{ padding: '8px', ...MONO, color: C.text }}>5-8% of portfolio</td>
                      <td style={{ padding: '8px', color: C.text2 }}>Add 2-3% at +15% advance, again at +30%</td>
                    </tr>
                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px', color: C.cyan, fontWeight: 800 }}>Strong (5/7)</td>
                      <td style={{ padding: '8px', ...MONO, color: C.text }}>3-5% of portfolio</td>
                      <td style={{ padding: '8px', color: C.text2 }}>Add 2% at +20% advance only</td>
                    </tr>
                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px', color: C.amber, fontWeight: 800 }}>Marginal (3/7)</td>
                      <td style={{ padding: '8px', ...MONO, color: C.text }}>1-2% of portfolio</td>
                      <td style={{ padding: '8px', color: C.text2 }}>No add-ons. Exit at +25% or first pullback</td>
                    </tr>
                    <tr style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '8px', color: C.muted, fontWeight: 800 }}>Below 3/7</td>
                      <td style={{ padding: '8px', ...MONO, color: C.red }}>Pass</td>
                      <td style={{ padding: '8px', color: C.text2 }}>—</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={sectionLabel(C.amber)}>⚠ COMMON ENTRY MISTAKES</div>
              <ul style={{ paddingLeft: 22, margin: 0, color: C.text2, fontSize: 12.5, lineHeight: 1.7 }}>
                <li><strong style={{ color: C.amber }}>Chasing &gt; 7% above pivot</strong> — risk-reward inverts; you&apos;re paying for someone else&apos;s entry.</li>
                <li><strong style={{ color: C.amber }}>Buying the gap-up close-of-day-1</strong> — biggest move usually behind you. Wait for the tennis-ball confirmation.</li>
                <li><strong style={{ color: C.amber }}>Sizing too small</strong> on a 7/7 setup — defeats the purpose of having an edge.</li>
                <li><strong style={{ color: C.amber }}>Doubling down on a failing setup</strong> — averaging into a broken thesis. Stop is stop.</li>
                <li><strong style={{ color: C.amber }}>Ignoring market context</strong> — even 7/7 setups fail 60% in correcting markets.</li>
                <li><strong style={{ color: C.amber }}>Holding through next earnings without re-checklisting</strong> — re-test the 7-point each quarter. Score dropping = trim.</li>
              </ul>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* TAB 8: INDIA SPECIFICS                                           */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {tab === 'india' && (
          <>
            <div style={{ ...card, borderLeft: `3px solid ${C.saffron}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: C.saffron, margin: 0 }}>
                🇮🇳 India-Specific Earnings Mastery
              </h2>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 8, lineHeight: 1.55 }}>
                Indian companies report differently from US peers. Concall language, promoter behavior, sector quirks, and disclosure conventions all shift the framework.
              </div>

              <div style={sectionLabel(C.green)}>📞 THE CONCALL IS THE PRINT</div>
              <div style={neutralBox}>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                  In India, the press release tells you HALF the story. The earnings call transcript tells you the other half — and is often where the multibagger thesis confirms or breaks. Listen to / read the concall within 24 hours of every print.
                </div>
                <div style={{ marginTop: 10 }}>
                  <strong style={{ color: C.green, fontSize: 12 }}>Listen for:</strong>
                  <ul style={{ paddingLeft: 22, margin: '6px 0 0', fontSize: 12, color: C.text2, lineHeight: 1.6 }}>
                    <li>Order book / pipeline disclosures (esp. capital goods, IT services)</li>
                    <li>Capex guidance for next 2-3 years</li>
                    <li>Margin guidance — specific bps targets vs vague "improvement"</li>
                    <li>Geographic / segment growth breakdown</li>
                    <li>Promoter/CEO confidence in delivery (tone, specificity)</li>
                    <li>Questions on slowing segments — how does management respond?</li>
                  </ul>
                </div>
              </div>

              <div style={sectionLabel(C.cyan)}>👤 PROMOTER BEHAVIOR SIGNALS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { sig: 'Promoter INCREASING stake post-earnings', color: C.green,  d: 'Strongest insider signal. Promoter buying open-market within 30 days of results = high conviction in their own numbers.' },
                  { sig: 'Promoter PLEDGE DECREASING',              color: C.green,  d: 'Pledge reduction = personal balance sheet improving. Frees the promoter from leverage stress.' },
                  { sig: 'No change in promoter holding',            color: C.cyan,   d: 'Neutral. Most common. Status quo.' },
                  { sig: 'Promoter REDUCING stake (small <2pp)',     color: C.amber,  d: 'Could be portfolio diversification or routine selling. Watch the pattern across quarters.' },
                  { sig: 'Promoter REDUCING stake (>5pp YoY)',       color: C.red,    d: 'Major red flag. Sustained promoter exit precedes most major Indian disappointments (Yes Bank, DHFL pattern).' },
                  { sig: 'Promoter PLEDGE INCREASING > 30%',         color: C.red,    d: 'Personal leverage rising. Especially dangerous if combined with promoter selling.' },
                ].map((r, i) => (
                  <div key={i} style={{
                    background: C.card2, border: `1px solid ${r.color}55`,
                    borderRadius: 7, padding: '8px 13px',
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                  }}>
                    <div style={{ minWidth: 230, fontSize: 11.5, fontWeight: 800, color: r.color }}>{r.sig}</div>
                    <div style={{ flex: 1, fontSize: 12, color: C.text2, lineHeight: 1.5 }}>{r.d}</div>
                  </div>
                ))}
              </div>

              <div style={sectionLabel(C.purple)}>🏭 SECTOR-SPECIFIC EARNINGS WATCHPOINTS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { sector: 'IT SERVICES',     focus: 'Constant-currency revenue growth (USD), deal TCV (total contract value), book-to-bill ratio, attrition trend, large-deal count.' },
                  { sector: 'BANKS / NBFC',    focus: 'Net Interest Margin (NIM), Gross NPA trend, Provision Coverage Ratio (PCR), Credit growth, ROA. RBI commentary on rates matters.' },
                  { sector: 'PHARMA',          focus: 'USFDA inspection status, US gx revenue trajectory, complex generics pipeline, ANDA approvals, R&D spend as % of sales.' },
                  { sector: 'AUTO / 2W',       focus: 'Volume growth (units), realisation per unit (mix), raw material headwind/tailwind, exports trajectory, EV strategy.' },
                  { sector: 'CONSUMER',        focus: 'Volume growth (vs price-led growth), distribution reach expansion (outlets added), premiumisation %, A&P spend.' },
                  { sector: 'CAPITAL GOODS',   focus: 'Order book to revenue ratio (ideally 2-3x), order inflow growth, execution timelines, working capital cycle.' },
                  { sector: 'CEMENT / STEEL',  focus: 'Realisation per tonne, EBITDA per tonne, cost of energy, capacity utilization, regional pricing discipline.' },
                  { sector: 'SPECIALTY CHEM',  focus: 'China+1 wins, capacity addition pipeline, customer concentration, R&D project count, segment-wise margins.' },
                ].map((r, i) => (
                  <div key={i} style={{
                    background: C.card2, border: `1px solid ${C.border}`,
                    borderRadius: 7, padding: '9px 13px',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.saffron, letterSpacing: 0.4 }}>{r.sector}</div>
                    <div style={{ fontSize: 11.5, color: C.text2, marginTop: 3, lineHeight: 1.5 }}>{r.focus}</div>
                  </div>
                ))}
              </div>

              <div style={sectionLabel(C.amber)}>🇮🇳 INDIA-SPECIFIC RED FLAGS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  'Auditor resignation mid-year — biggest single warning sign in Indian markets.',
                  'CFO change shortly before/after a strong print — verify the numbers carefully.',
                  'Related-party transactions growing as % of total revenue or expenses.',
                  'Subsidiary debt obscured in consolidated statements.',
                  'Group-company transactions (esp. Adani-style) without independent commercial logic.',
                  'Multiple "exceptional items" YoY — earnings smoothing.',
                  'Sustained ETR below 18% in non-SEZ context without disclosure.',
                  'Promoter pledge above 30% — empirically the strongest fraud predictor.',
                ].map((r, i) => (
                  <div key={i} style={{
                    background: `color-mix(in srgb, ${C.red} 4%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${C.red} 22%, transparent)`,
                    borderRadius: 5, padding: '7px 12px',
                    fontSize: 12, color: C.text2, lineHeight: 1.5,
                  }}>⚠ {r}</div>
                ))}
              </div>

              <div style={sectionLabel(C.green)}>🏆 INDIA MEGAWINNER TEMPLATE (Bajaj Finance / Astral / Pidilite pattern)</div>
              <div style={positiveBox}>
                <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>
                  Print after print after print of: <strong>20%+ revenue growth · expanding OPM · CFO/PAT &gt; 1 · zero
                  promoter pledge · raised guidance for the next year</strong>. The pattern doesn&apos;t change for 4-6
                  consecutive quarters. The market initially discounts (PE compresses), then catches on (PE expands rapidly),
                  then re-rates fully (10-bagger). Tier 1 multibagger candidates show this signature.
                </div>
              </div>
            </div>
          </>
        )}

        {/* CLOSING FOOTER — visible on all tabs */}
        <div style={{
          marginTop: 22, padding: '14px 18px',
          background: `linear-gradient(135deg, ${C.card}, color-mix(in srgb, ${C.saffron} 6%, ${C.card2}))`,
          border: `1px solid color-mix(in srgb, ${C.saffron} 30%, transparent)`,
          borderRadius: 10, fontSize: 12.5, color: C.text, lineHeight: 1.6,
        }}>
          <strong style={{ color: C.saffron }}>🎯 The one-line edge:</strong> stocks that beat the print AND raise guidance AND maintain quality of earnings produce 60-day excess returns that no other single setup matches. Your job is to identify them within 48 hours, enter within 15 sessions, and size to make it matter. Everything else on this page is in service of that single workflow.
        </div>
      </div>
    </div>
  );
}
