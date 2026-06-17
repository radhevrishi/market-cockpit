'use client';

// ════════════════════════════════════════════════════════════════════════════
// VOLUME RULES — PATCH 1101t
//
// Nine institutional-grade volume and price-action rules most retail traders
// never learn. Each rule has:
//   - Test: 4 conditions that ALL must be true
//   - Looks like X but isn't: 3 common false-positive patterns
//   - Visual rule: how to spot it on a chart in 5 seconds
//
// Closes with a combined 7-step walkthrough that ties all nine into a single
// chart-read sequence. Dense reference layout, no marketing prose.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState, type CSSProperties } from 'react';

const C = {
  bg: 'var(--mc-bg-0)', card: 'var(--mc-bg-1)', card2: 'var(--mc-bg-2)',
  border: 'var(--mc-border-1)', borderStrong: 'var(--mc-border-2)',
  text: 'var(--mc-text-1)', text2: 'var(--mc-text-2)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', amber: 'var(--mc-warn)', red: 'var(--mc-bearish)',
  cyan: 'var(--mc-cyan)', saffron: 'var(--mc-saffron)',
  purple: 'var(--mc-state-persistent)',
};

const MONO: CSSProperties = { fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace' };

type Rule = {
  id: string;
  title: string;
  emoji: string;
  oneliner: string;
  conditions: string[];           // ALL must be true
  fakeouts: { label: string; detail: string }[];  // looks like X but isn't
  visual: string;                  // 5-second chart-read rule
  color: keyof typeof C;
};

const RULES: Rule[] = [
  {
    id: 'volume-dry-up',
    title: 'Volume Dry-Up',
    emoji: '📉',
    oneliner: 'Coiled-spring signature — institutional accumulation in stealth.',
    color: 'cyan',
    conditions: [
      "Last 4 weeks' average volume < 0.85× of the 20-week average.",
      'Stock is inside a base — sideways action, not declining.',
      'The 30-week MA is flat or rising (not falling).',
      'Price is within 15% of the base high (not sitting at the lows).',
    ],
    fakeouts: [
      { label: 'Death by neglect', detail: 'Volume falling because the stock is boring — at all-time highs that nobody cares about anymore. Not a coiled spring; abandoned interest.' },
      { label: 'Falling 200-DMA dry-up', detail: 'Dry-up below a falling 200-day MA is a stock being abandoned. Real dry-up happens in stage 1 or stage 2, never stage 4.' },
      { label: 'Pre-earnings dry-up', detail: '"Dry-up" right before earnings is just traders sitting on hands — event positioning, not institutional accumulation.' },
    ],
    visual: 'The volume bars get visibly shorter over 4-6 weeks while the price candles stay tight in a horizontal band above a flat 30-week MA. If the price is also drifting down, it\'s not dry-up — it\'s distribution disguised as dry-up.',
  },
  {
    id: 'breakout-volume',
    title: 'Breakout Volume',
    emoji: '💥',
    oneliner: 'The institutional commitment signature at the pivot.',
    color: 'green',
    conditions: [
      'Price closed above the pivot (base high) — not intraday wick, the WEEKLY CLOSE.',
      "That week's volume ≥ 2.0× of 20-week average (1.5× is marginal, 3.0× is great).",
      'The breakout week candle closes in the UPPER HALF of its range (not a wick top).',
      'The next 1-2 weeks do not reverse back below the pivot on equal or heavier volume.',
    ],
    fakeouts: [
      { label: 'Distribution at the pivot', detail: 'Heavy volume but the candle closes near the low. Failed breakout incoming — institutions handing shares to retail.' },
      { label: 'Event volume', detail: 'Heavy volume on a single news headline (analyst upgrade, earnings) that disappears the next week. Event positioning, not institutional commitment.' },
      { label: 'Wrong market context', detail: 'Breakout volume in a market that itself is in correction. Even good breakouts fail 60% of the time when the index is selling off.' },
    ],
    visual: 'Look for the volume bar on breakout week to TOWER over the surrounding bars — visibly 2-3× taller. If you have to squint to see the volume difference, it\'s not enough.',
  },
  {
    id: 'tight-weeks',
    title: 'Tight Weeks',
    emoji: '🔧',
    oneliner: 'Minervini VCP signature — supply absorbed before the move.',
    color: 'amber',
    conditions: [
      'Weekly range (high − low) < 6% of the close.',
      'Happens inside a base, not after a 20%+ run.',
      'At least 3 such weeks in the last 8 weeks of the base.',
      'Each contraction is TIGHTER than the prior — VCP signature (Minervini).',
    ],
    fakeouts: [
      { label: 'Exhaustion pause', detail: 'Tight ranges at all-time highs after an extended run. Often precedes a top, not a continuation.' },
      { label: 'Dying coil', detail: 'Tight in a stock with declining volume AND a falling 30W MA. The stock is dying, not coiling.' },
      { label: 'Controlled distribution', detail: 'Tight weeks with the close drifting lower week-over-week. Look at close-to-close direction, not just the range.' },
    ],
    visual: 'Looking at the candles, the BODIES should look like little dashes — short, flat, no wicks. Each successive contraction\'s range should narrow: 25% → 15% → 8% → 4% = textbook VCP.',
  },
  {
    id: 'acc-dis-count',
    title: '12-Week Accumulation vs Distribution Count',
    emoji: '⚖',
    oneliner: 'The post-pivot sponsorship audit — who\'s really buying.',
    color: 'cyan',
    conditions: [
      'Count weeks in the 12 post-pivot weeks where volume ≥ 1.25× of 20W average AND week closed UP (= accumulation) vs DOWN (= distribution).',
      'Acc weeks ≥ 5 over 12 weeks = healthy.',
      'Dis weeks ≤ 2 = healthy.',
      'Acc : Dis ratio ≥ 2.5 : 1 = strong sponsorship.',
    ],
    fakeouts: [
      { label: 'Stealth distribution', detail: '6 accumulation weeks but the stock is flat. Institutions are distributing into strength on every up week.' },
      { label: 'Dead stock', detail: '0 distribution but also only 1-2 accumulation. Nobody cares enough to fight over it.' },
      { label: 'RS divergence', detail: 'Accumulation count rising while RS line is falling. Relative weakness despite the buying — buy side is small money.' },
    ],
    visual: 'Mark the heavy-volume bars (>1.25× average) with two colors — green for up, red for down. Count them. If green outnumbers red by 3:1 or better over 12 weeks AND the price is making higher highs, sponsorship is real.',
  },
  {
    id: 'gap-at-pivot',
    title: 'Max Gap at Pivot',
    emoji: '🪂',
    oneliner: 'Institutional urgency — they couldn\'t wait for a clean fill.',
    color: 'green',
    conditions: [
      "Open gap = (today's open − yesterday's close) / yesterday's close ≥ 3%.",
      'Happens AT or just AFTER the pivot, not 5 weeks later.',
      'The gap is NOT filled within the next 5 trading days.',
      'Volume on the gap day is ≥ 2× of 20-day average.',
    ],
    fakeouts: [
      { label: 'Mechanical gap', detail: 'A gap on options-expiry Friday or futures-roll day. Mechanical settlement effect, not directional intent.' },
      { label: 'Trader gap', detail: 'A gap that fills within 3 days. Event traders taking profits, not institutional commitment.' },
      { label: 'Retail FOMO gap', detail: 'Pre-market gap that fades by lunch on the SAME day. Retail rushed the open, institutions sold them.' },
    ],
    visual: 'Look for the gap to STAY OPEN — the price doesn\'t trade back into it for at least a week. The day\'s candle should close near the high, not retrace the gap.',
  },
  {
    id: 'rs-new-high',
    title: 'Relative Strength New High',
    emoji: '📈',
    oneliner: 'The institutional preview — money flowing in before price moves.',
    color: 'purple',
    conditions: [
      'Plot stock price ÷ benchmark (Nifty or S&P).',
      'That ratio (the RS line) hits a NEW 52-WEEK HIGH.',
      "The new high happens BEFORE the stock's own price makes a new high (the timing edge).",
      'Index itself is in stage 1 or stage 2 (NOT in stage 4 bear market).',
    ],
    fakeouts: [
      { label: 'Relative win, absolute loss', detail: 'RS rising because the INDEX is falling faster than the stock. You still lose money.' },
      { label: 'RS spike fakeout', detail: 'RS at new high on a single-day spike that reverses next week. False breakout in the RS line.' },
      { label: 'Sentiment shift only', detail: 'RS leading but volume drying up. Sentiment is shifting but no institutional weight behind it yet.' },
    ],
    visual: 'On any charting platform, plot stock/index ratio. The line should be CLIMBING while the stock\'s own chart is still in a base. That divergence — RS climbing while price chops sideways — is the pre-breakout footprint.',
  },
  {
    id: 'stage-2-cross',
    title: '30-Week > 50-Week MA Cross (Stage-2)',
    emoji: '⤴',
    oneliner: 'Weinstein stage-2 trend confirmation.',
    color: 'green',
    conditions: [
      '30-week MA crosses ABOVE the 50-week MA.',
      'Both MAs are RISING after the cross (not flat or falling).',
      'The cross happens within 12 weeks of the price pivot — not 3 years later.',
      'Price stays above BOTH MAs for at least 4 consecutive weeks after the cross.',
    ],
    fakeouts: [
      { label: 'Sideways whipsaw', detail: 'A cross with both MAs FLAT. That\'s a sideways market, not stage 2. Flat-MA crosses whipsaw constantly.' },
      { label: 'Late confirmation', detail: 'Cross 3 years into a run. Useful as exit confirmation but not entry — the move is already mature.' },
      { label: 'Bad market beta', detail: 'Cross while the index is in stage 4. Individual stock strength gets crushed by market beta on average.' },
    ],
    visual: 'The 30W (orange/red in most platforms) must visibly OVERTAKE the 50W (blue/purple) at an upward angle, not horizontally. Both lines sloping up = stage 2 confirmed. Both lines flat = no signal.',
  },
  {
    id: 'shallow-pullback',
    title: 'Shallow Pullback (10W & 30W Behaviour)',
    emoji: '🌊',
    oneliner: 'Trend integrity check — does the stock respect its MAs?',
    color: 'amber',
    conditions: [
      'After the breakout, deepest close below 10W MA is between 0% and −7%.',
      'Deepest close below 30W MA is between 0% and −8%.',
      'EACH time price tested those MAs, it reclaimed them within 3 weeks.',
      'Volume on the pullback was DRY (below average), volume on the reclaim was HEAVY (>1.5× average).',
    ],
    fakeouts: [
      { label: 'Distribution at the trendline', detail: 'Touching 30W on heavy DOWN volume. Distribution at the trendline often precedes failure.' },
      { label: 'No-conviction bounce', detail: 'Reclaim on weak volume (below average). Bounce without conviction, often fails again.' },
      { label: 'Broken trend', detail: 'Spending 4+ weeks below 30W even by just −3%. The trend has actually broken; the thesis is at risk.' },
    ],
    visual: 'Every time the price comes down to the 10W or 30W MA, look at the candles AT the MA — wicks pointing down (touched MA, closed back above) = healthy. Bodies closing below the MA = problem.',
  },
  {
    id: 'return-scorecard',
    title: '+12W and +52W Returns (Outcome Scorecard)',
    emoji: '📊',
    oneliner: 'Post-entry diagnostic — is this trade actually working?',
    color: 'saffron',
    conditions: [
      '+12W return ≥ +25% with healthy acc:dis = strong start; let it run.',
      '+12W return between 0% and +10% = lukewarm; tighten stops, don\'t add.',
      '+12W return negative AND no recovery to pivot within 6 weeks = breakout failed; exit.',
      '+52W return ≥ +50% with rising 30W = core compounder; long-term hold. < +20% despite 4 quarters of trying = redeploy.',
    ],
    fakeouts: [
      { label: 'News-spike winner', detail: '+30% in 12 weeks but ALL of it from one gap on news. Unstable, will retrace.' },
      { label: 'Climax move', detail: '+100% in 8 weeks (vertical). Climax — expect a 30-50% reset before next leg.' },
      { label: 'Retail rally', detail: '+60% in 52W but acc:dis is 2:6. Retail-driven, not institutional. Distribution incoming.' },
    ],
    visual: 'Mark your entry on the chart. Look at where the price is at the 12W and 52W marks. Higher highs + higher lows + 30W rising = real winner. Single vertical spike followed by sideways or down = one-week wonder.',
  },
];

const WALKTHROUGH = [
  { step: 1, label: '30W MA slope',          rule: 'Flat or up → continue. Down → pass on this stock.' },
  { step: 2, label: 'Base structure',         rule: 'At least 6 weeks sideways. No base → no setup.' },
  { step: 3, label: 'Volume dry-up',          rule: 'Last 4 weeks shorter than 20-week average. Wet → wait.' },
  { step: 4, label: 'Tight weeks',            rule: 'At least 3 in the base. None → wait.' },
  { step: 5, label: 'Pocket pivots',          rule: '2+ inside the base above the 10W. Zero → no institutional interest yet.' },
  { step: 6, label: 'RS line',                rule: 'At new 52-week high BEFORE price. RS lagging → pass.' },
  { step: 7, label: 'Pivot break',            rule: 'Pivot break + heavy volume + close in upper half + holds the gap → ENTRY.' },
];

export default function VolumeRulesPage() {
  const [activeRule, setActiveRule] = useState<string>(RULES[0].id);
  const [expandedFakeouts, setExpandedFakeouts] = useState<Record<string, boolean>>({});

  // Smooth scroll to rule when clicked in nav
  useEffect(() => {
    if (!activeRule) return;
    try {
      const el = document.getElementById(`rule-${activeRule}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {}
  }, [activeRule]);

  const card: CSSProperties = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: '18px 22px',
    marginBottom: 14,
  };
  const header: CSSProperties = {
    fontSize: 18,
    fontWeight: 900,
    color: C.text,
    marginBottom: 4,
    letterSpacing: 0.2,
  };
  const sub: CSSProperties = { fontSize: 12, color: C.muted, lineHeight: 1.5 };
  const sectionLabel = (color: string): CSSProperties => ({
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 0.8,
    color,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 14,
  });

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, padding: '24px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* HEADER */}
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: C.cyan, margin: 0, letterSpacing: 0.3 }}>
            🎯 Volume Rules — What Retail Never Learns
          </h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.55 }}>
            Nine institutional volume and price-action rules · Each rule: 4-condition test · 3 common fakeouts · 5-second visual.
            Closes with a 7-step combined walkthrough that ties them into a single chart-read sequence.
          </div>
        </div>

        {/* QUICK NAV */}
        <div style={{ ...card, padding: '12px 14px', marginBottom: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {RULES.map((r, i) => (
              <button key={r.id} onClick={() => setActiveRule(r.id)} style={{
                padding: '6px 11px',
                background: activeRule === r.id ? `color-mix(in srgb, ${C[r.color]} 14%, transparent)` : 'transparent',
                border: `1px solid ${activeRule === r.id ? C[r.color] : C.border}`,
                borderRadius: 6,
                color: activeRule === r.id ? C[r.color] : C.text2,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}>
                {r.emoji} {i + 1}. {r.title}
              </button>
            ))}
            <button onClick={() => setActiveRule('walkthrough')} style={{
              padding: '6px 11px',
              background: activeRule === 'walkthrough' ? `color-mix(in srgb, ${C.saffron} 14%, transparent)` : 'transparent',
              border: `1px solid ${activeRule === 'walkthrough' ? C.saffron : C.border}`,
              borderRadius: 6,
              color: activeRule === 'walkthrough' ? C.saffron : C.text2,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>
              🗺 Combined Walkthrough
            </button>
          </div>
        </div>

        {/* RULE CARDS */}
        {RULES.map((r, i) => {
          const ruleColor = C[r.color];
          const fakeoutsOpen = expandedFakeouts[r.id] !== false;
          return (
            <div key={r.id} id={`rule-${r.id}`} style={{
              ...card,
              borderLeft: `3px solid ${ruleColor}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 22, lineHeight: 1.2 }}>{r.emoji}</div>
                <div style={{ flex: 1 }}>
                  <div style={header}>
                    {i + 1}. {r.title.toUpperCase()}
                  </div>
                  <div style={{ ...sub, color: ruleColor, fontWeight: 700, fontStyle: 'italic' }}>{r.oneliner}</div>
                </div>
              </div>

              {/* THE TEST */}
              <div style={sectionLabel(C.green)}>✅ THE TEST (all must be true)</div>
              <ol style={{ paddingLeft: 22, margin: 0, color: C.text, fontSize: 13, lineHeight: 1.65 }}>
                {r.conditions.map((c, j) => (
                  <li key={j} style={{ marginBottom: 6 }}><span style={MONO}>{c}</span></li>
                ))}
              </ol>

              {/* FAKEOUTS */}
              <div style={sectionLabel(C.red)}>⚠ LOOKS LIKE IT BUT ISN'T</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {r.fakeouts.map((f, j) => (
                  <div key={j} style={{
                    background: `color-mix(in srgb, ${C.red} 4%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${C.red} 22%, transparent)`,
                    borderRadius: 6,
                    padding: '8px 12px',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.red, marginBottom: 3 }}>{f.label}</div>
                    <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.5 }}>{f.detail}</div>
                  </div>
                ))}
              </div>

              {/* VISUAL RULE */}
              <div style={sectionLabel(C.cyan)}>👁 VISUAL RULE (5 seconds)</div>
              <div style={{
                background: `color-mix(in srgb, ${C.cyan} 6%, transparent)`,
                border: `1px solid color-mix(in srgb, ${C.cyan} 28%, transparent)`,
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 12.5,
                color: C.text,
                lineHeight: 1.6,
                fontStyle: 'italic',
              }}>
                {r.visual}
              </div>
            </div>
          );
        })}

        {/* COMBINED WALKTHROUGH */}
        <div id="rule-walkthrough" style={{
          ...card,
          borderLeft: `3px solid ${C.saffron}`,
          background: `linear-gradient(135deg, ${C.card}, color-mix(in srgb, ${C.saffron} 5%, ${C.card2}))`,
        }}>
          <div style={{ ...header, color: C.saffron, fontSize: 20 }}>
            🗺 THE COMBINED VISUAL RULE — One Walkthrough, Every Chart
          </div>
          <div style={{ ...sub, marginBottom: 16 }}>
            Walk every chart in this exact order. Bail at the first failure. The first chart that passes all 7 steps is your trade.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {WALKTHROUGH.map((w) => (
              <div key={w.step} style={{
                background: C.card2,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
              }}>
                <div style={{
                  fontSize: 16,
                  fontWeight: 900,
                  color: C.saffron,
                  minWidth: 28,
                  textAlign: 'center',
                  ...MONO,
                }}>
                  {w.step}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 2 }}>{w.label}</div>
                  <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.5 }}>{w.rule}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 16,
            padding: '12px 16px',
            background: `color-mix(in srgb, ${C.green} 6%, transparent)`,
            border: `1px solid color-mix(in srgb, ${C.green} 28%, transparent)`,
            borderRadius: 8,
            fontSize: 12.5,
            color: C.text,
            lineHeight: 1.55,
          }}>
            <strong style={{ color: C.green }}>Mental model:</strong> these 9 rules describe institutional accumulation in real-time.
            Volume is the footprint of size. Tight ranges are supply absorption. RS line is forward indicator of where capital is rotating.
            When all 7 walkthrough steps align, you are reading a chart the same way a portfolio manager reading the same chart sees it — and you are entering at the same point.
          </div>
        </div>

      </div>
    </div>
  );
}
