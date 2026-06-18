'use client';

// ════════════════════════════════════════════════════════════════════════════
// VOLUME & PRICE-ACTION RULES — PATCH 1101t/1101u
//
// Comprehensive institutional pattern library most retail traders never learn.
// Organized into 7 categories with tab navigation:
//   🔊 VOLUME              — dry-up, breakout vol, acc/dis, gaps, pocket pivots
//   📐 BASE PATTERNS       — cup w/handle, flat base, ascending base, VCP, HTF
//   🎯 ENTRIES             — cheat, pivot, pocket pivot, power buy
//   〰 PRICE ACTION        — pullbacks, squat, reversal recovery, spring, screwbar
//   ⤴ TREND CONFIRMATION  — 30W>50W cross, RS new high, stage analysis
//   🔴 TOPS & EXHAUSTION   — climax top, distribution day, failed pattern, scorecard
//   🌐 MARKET CONTEXT      — follow-through day
//
// Each rule carries: Timeframe badge (D/W/D+W) + Source attribution
// (O'Neil/Minervini/Zanger/Wyckoff/Weinstein/Morales-Kacher/Stockbee) +
// 3-5 test conditions + 2-3 fakeout patterns + 5-second visual rule.
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

type Timeframe = 'D' | 'W' | 'D+W';
type Source = "O'Neil (CANSLIM)" | 'Minervini (SEPA)' | 'Zanger' | 'Wyckoff' | 'Weinstein (Stages)' | 'Morales/Kacher' | 'Stockbee' | 'Composite';
type Color = keyof typeof C;

type Rule = {
  id: string;
  title: string;
  emoji: string;
  oneliner: string;
  timeframe: Timeframe;
  source: Source;
  conditions: string[];
  fakeouts: { label: string; detail: string }[];
  visual: string;
  illustration?: string;          // optional ASCII / verbal sketch
  color: Color;
  section: SectionId;
};

type SectionId = 'volume' | 'bases' | 'entries' | 'action' | 'trend' | 'tops' | 'market';

const SECTIONS: { id: SectionId; label: string; emoji: string; tagline: string; color: Color }[] = [
  { id: 'volume',  emoji: '🔊', label: 'VOLUME',           tagline: 'Footprint of institutional size',         color: 'cyan'    },
  { id: 'bases',   emoji: '📐', label: 'BASE PATTERNS',    tagline: 'Where supply gets absorbed',              color: 'green'   },
  { id: 'entries', emoji: '🎯', label: 'ENTRIES',          tagline: 'Where to commit capital',                  color: 'saffron' },
  { id: 'action',  emoji: '〰', label: 'PRICE ACTION',     tagline: 'Pullbacks, reversals, traps',              color: 'amber'   },
  { id: 'trend',   emoji: '⤴', label: 'TREND CONFIRM',    tagline: 'Stage 2 confirmation tools',               color: 'purple'  },
  { id: 'tops',    emoji: '🔴', label: 'TOPS & EXHAUSTION', tagline: 'Where the move ends',                     color: 'red'     },
  { id: 'market',  emoji: '🌐', label: 'MARKET CONTEXT',   tagline: 'Index regime that controls everything',    color: 'cyan'    },
];

const RULES: Rule[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // 🔊 VOLUME
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'volume-dry-up',
    title: 'Volume Dry-Up',
    emoji: '📉',
    oneliner: 'Coiled-spring signature — institutional accumulation in stealth.',
    timeframe: 'W',
    source: 'Composite',
    color: 'cyan',
    section: 'volume',
    conditions: [
      "Last 4 weeks' average volume < 0.85× of the 20-week average. On daily charts: last 20 days < 0.85× of trailing 50-day average.",
      'Stock is inside a base — sideways action, not declining.',
      'The 30-week MA (weekly) or 200-day MA (daily) is flat or rising — never falling.',
      'Price is within 15% of the base high (not sitting at the lows).',
    ],
    fakeouts: [
      { label: 'Death by neglect', detail: 'Volume falling because the stock is boring — at all-time highs that nobody cares about anymore. Abandoned interest, not a coiled spring.' },
      { label: 'Falling 200-DMA dry-up', detail: 'Dry-up below a falling 200-day MA. Real dry-up happens in Stage 1 or Stage 2, never Stage 4.' },
      { label: 'Pre-earnings dry-up', detail: '"Dry-up" right before earnings is just traders sitting on hands — event positioning, not institutional accumulation.' },
    ],
    visual: 'Volume bars get visibly shorter over 4-6 weeks (or 20-30 days) while the price candles stay tight in a horizontal band above a flat 30W/200D MA. If price is also drifting down, it\'s distribution disguised as dry-up.',
  },
  {
    id: 'breakout-volume',
    title: 'Breakout Volume',
    emoji: '💥',
    oneliner: 'Institutional commitment signature at the pivot.',
    timeframe: 'D+W',
    source: "O'Neil (CANSLIM)",
    color: 'green',
    section: 'volume',
    conditions: [
      'Price closes above the pivot (base high). Daily entry trigger; WEEKLY close confirms.',
      'Breakout day volume ≥ 1.5× of 50-day average (2.0× strong, 3.0× exceptional). Weekly ≥ 2.0× of 20W average.',
      'Closing in the UPPER HALF of the day/week range (not a wick top).',
      'Next 1-2 sessions/weeks do NOT reverse back below the pivot on equal or heavier volume.',
    ],
    fakeouts: [
      { label: 'Distribution at the pivot', detail: 'Heavy volume but candle closes near the low. Failed breakout incoming — institutions handing shares to retail.' },
      { label: 'Event volume', detail: 'Heavy volume on a single news headline that disappears the next session. Event positioning, not commitment.' },
      { label: 'Wrong market context', detail: 'Breakout volume in a market that itself is in correction. 60% of clean breakouts fail when the index is selling off.' },
    ],
    visual: 'The breakout-day bar TOWERS over the surrounding bars — visibly 2-3× taller. If you have to squint, it\'s not enough.',
  },
  {
    id: 'acc-dis-count',
    title: '12-Week Accumulation vs Distribution Count',
    emoji: '⚖',
    oneliner: 'The post-pivot sponsorship audit — who\'s really buying.',
    timeframe: 'W',
    source: "O'Neil (CANSLIM)",
    color: 'cyan',
    section: 'volume',
    conditions: [
      'In the 12 post-pivot weeks: count weeks where volume ≥ 1.25× of 20W average AND close UP (accumulation) vs close DOWN (distribution).',
      'Accumulation weeks ≥ 5 / 12 = healthy.',
      'Distribution weeks ≤ 2 / 12 = healthy.',
      'Acc : Dis ratio ≥ 2.5 : 1 = strong institutional sponsorship.',
    ],
    fakeouts: [
      { label: 'Stealth distribution', detail: '6 accumulation weeks but stock is flat. Institutions distributing into strength on every up week.' },
      { label: 'Dead stock', detail: 'Only 1-2 accumulation, 0 distribution. Nobody cares enough to fight.' },
      { label: 'RS divergence', detail: 'Accumulation count rising while RS line is falling. Buy side is small money.' },
    ],
    visual: 'Color heavy-volume bars (>1.25× avg) — green up, red down. Green outnumbering red 3:1+ with higher highs = real sponsorship.',
  },
  {
    id: 'gap-at-pivot',
    title: 'Max Gap at Pivot',
    emoji: '🪂',
    oneliner: 'Institutional urgency — they couldn\'t wait for a clean fill.',
    timeframe: 'D',
    source: 'Composite',
    color: 'green',
    section: 'volume',
    conditions: [
      "Open gap = (today's open − yesterday's close) / yesterday's close ≥ 3%.",
      'Happens AT or just AFTER the pivot, not 5 weeks later.',
      'The gap is NOT filled within the next 5 trading days.',
      'Volume on the gap day is ≥ 2× of 50-day average.',
    ],
    fakeouts: [
      { label: 'Mechanical gap', detail: 'A gap on options-expiry Friday or futures-roll day. Settlement effect, not directional intent.' },
      { label: 'Trader gap', detail: 'A gap that fills within 3 days. Event profit-taking, not institutional commitment.' },
      { label: 'Retail FOMO gap', detail: 'Pre-market gap that fades by lunch on the same day. Retail rushed the open, institutions sold to them.' },
    ],
    visual: 'The gap STAYS OPEN — price doesn\'t trade back into it for at least a week. The day\'s candle closes near the high, not retracing the gap.',
  },
  {
    id: 'tight-weeks',
    title: 'Tight Weeks (Inside the Base)',
    emoji: '🔧',
    oneliner: 'Supply absorption signature before a real move.',
    timeframe: 'W',
    source: 'Composite',
    color: 'amber',
    section: 'volume',
    conditions: [
      'Weekly range (high − low) < 6% of the close. (Daily equivalent: < 2.5% range on the daily candle for 5+ consecutive days.)',
      'Happens INSIDE a base, not after a 20%+ run.',
      'At least 3 such weeks in the last 8 weeks of the base.',
      'Each successive contraction is TIGHTER than the prior — VCP signature.',
    ],
    fakeouts: [
      { label: 'Exhaustion pause', detail: 'Tight ranges at all-time highs after an extended run. Precedes tops, not continuations.' },
      { label: 'Dying coil', detail: 'Tight + declining volume + falling 30W. The stock is dying, not coiling.' },
      { label: 'Controlled distribution', detail: 'Tight weeks with close drifting lower week-over-week. Look at close-to-close direction, not just the range.' },
    ],
    visual: 'Candles look like little dashes — short bodies, no wicks. Sequence: 25% range → 15% → 8% → 4% = textbook contraction.',
  },
  {
    id: 'pocket-pivot',
    title: 'Pocket Pivot',
    emoji: '🔹',
    oneliner: 'Institutional footprint INSIDE the base — buying before the breakout.',
    timeframe: 'D',
    source: 'Morales/Kacher',
    color: 'green',
    section: 'volume',
    conditions: [
      'Today\'s up-day volume > the HIGHEST down-day volume of the prior 10 trading days.',
      'Price holds at or above the 10-day MA (and ideally the 50-day MA).',
      'Setup is INSIDE a constructive base or right after a tight contraction.',
      'No bearish wide-range bar in the prior 10 sessions that hasn\'t been retraced.',
    ],
    fakeouts: [
      { label: 'Below the 10-DMA pocket', detail: 'A pocket-pivot-shaped volume bar but price closes below the 10-DMA. Not a pocket pivot — it\'s a dead-cat bounce within a downtrend.' },
      { label: 'After a vertical run', detail: 'Pocket pivot late in an extended run. The footprint stops being predictive after the move is mature.' },
      { label: 'News-driven pocket', detail: 'The up-volume bar is an earnings-day or news-day spike. Single events don\'t mean institutional accumulation.' },
    ],
    visual: 'On the daily chart, mark the up-volume days in green and down-volume days in red. A pocket pivot day\'s green bar visibly TOWERS over every red bar in the prior 10. That\'s the institutional footprint.',
    illustration: 'red red green red red red GREEN← red green red ← pocket pivot',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 📐 BASE PATTERNS
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'cup-with-handle',
    title: 'Cup with Handle',
    emoji: '☕',
    oneliner: 'The flagship O\'Neil base — half of all megawinners.',
    timeframe: 'W',
    source: "O'Neil (CANSLIM)",
    color: 'green',
    section: 'bases',
    conditions: [
      'Cup duration ≥ 7 weeks (13-26 typical). Cup depth 12-33% (deeper allowed only at major market bottoms).',
      'Rounded bottom — no sharp V. Both sides of the cup show similar volume character.',
      'Handle forms in the UPPER HALF of the cup (handle in lower half is a disqualifier).',
      'Handle drifts down 8-12% on declining volume for 1-2 weeks minimum. Pivot = handle high + 10 paise/cents.',
    ],
    fakeouts: [
      { label: 'Handle in lower half', detail: 'A "handle" that drops into the lower half of the cup is not a handle — it\'s renewed selling pressure.' },
      { label: 'Cup > 33% in a calm market', detail: 'Outside major bear-market bottoms, cup depths above 33% have materially higher failure rates.' },
      { label: 'V-bottom cup', detail: 'Sharp V-shaped bottom = panic dip, no real accumulation. Real cups round out.' },
    ],
    visual: 'A clean U-shape, not a V. Volume dries up on the right side and through the handle. Pivot break with 2× volume is the entry.',
    illustration: '    ____         <- cup high + handle\n   /    \\___   <- handle\n  /         \\\n /           \\\n/_____________\\',
  },
  {
    id: 'flat-base',
    title: 'Flat Base',
    emoji: '═',
    oneliner: 'The continuation base — secondary entry after a prior move.',
    timeframe: 'W',
    source: "O'Neil (CANSLIM)",
    color: 'green',
    section: 'bases',
    conditions: [
      'Sideways consolidation, ≥ 5 weeks duration.',
      'Maximum depth 12-15% (tighter than a cup).',
      'Usually forms AFTER a prior 20-30% advance from a cup-with-handle or other primary base.',
      'Pivot = high of the consolidation. Volume dry-up in the final 2-3 weeks is bullish.',
    ],
    fakeouts: [
      { label: 'Drift-down "flat"', detail: 'A flat base that\'s really drifting lower closes is controlled distribution. Check close-to-close direction.' },
      { label: 'Too deep', detail: 'A "flat base" wider than 15% depth is functionally a cup, not a flat — apply cup-with-handle rules instead.' },
      { label: 'No prior advance', detail: 'A flat base without a prior real move is just a Stage 1 range. Wait for evidence of accumulation first.' },
    ],
    visual: 'Price chops in a narrow horizontal band <15% deep for 5-9 weeks. The flatter and tighter, the better.',
    illustration: '__/¯¯|¯¯|¯¯|¯¯|¯¯|¯¯|__ flat\n         5-9 weeks',
  },
  {
    id: 'ascending-base',
    title: 'Ascending Base',
    emoji: '⛰',
    oneliner: 'The series of higher-low pullbacks — strongest CANSLIM base statistically.',
    timeframe: 'W',
    source: "O'Neil (CANSLIM)",
    color: 'green',
    section: 'bases',
    conditions: [
      'Three pullbacks of 10-20% each, occurring within an existing uptrend.',
      'Each successive low is HIGHER than the prior — series of higher lows.',
      'Total base duration 9-16 weeks.',
      'Pivot = high of the third pullback. Breakout volume confirmation as usual.',
    ],
    fakeouts: [
      { label: 'Lower low somewhere', detail: 'If any of the three lows is LOWER than the prior, it\'s not an ascending base — it\'s a broken trend.' },
      { label: 'Pullbacks too deep', detail: 'Pullbacks > 20% break the staircase structure. Treat as a separate base.' },
      { label: 'Tagged to a falling 30W', detail: 'Ascending base only works in Stage 2. If the 30W MA is flat or down, the staircase is illusion.' },
    ],
    visual: 'Three "stairsteps" of higher lows visible in the weekly chart. Each pullback shorter than the prior advance.',
    illustration: '       /\\\n      /  \\___/\\___/\\___ ← pivot\n     /\n____/\n  1st  2nd   3rd pullback',
  },
  {
    id: 'vcp',
    title: 'Volatility Contraction Pattern (VCP)',
    emoji: '🎯',
    oneliner: 'Minervini\'s signature setup — sequential tightening of swings.',
    timeframe: 'W',
    source: 'Minervini (SEPA)',
    color: 'green',
    section: 'bases',
    conditions: [
      'Sequential contractions, each ~50% the depth of the prior (e.g., 25% → 12% → 6% → 3%).',
      'Volume DECLINES through each successive contraction (volume dry-up to "VDU").',
      'Marked by tightness count: 2T (two contractions), 3T (three), 4T (four). 2T–4T is the sweet spot.',
      'Pivot = high of the final tightest contraction. Breakout with ≥ 100% volume expansion.',
    ],
    fakeouts: [
      { label: 'Equal-size swings', detail: 'Pullbacks that stay the same size aren\'t contractions — they\'re a sideways range. No coil = no VCP.' },
      { label: 'Volume rising into pivot', detail: 'If volume INCREASES through the contractions, supply isn\'t getting absorbed — it\'s building. Failed setup.' },
      { label: 'Wide last contraction', detail: 'A "final" contraction wider than the prior one means the structure broke. Wait for a new VCP to form.' },
    ],
    visual: 'Wedge-like compression: bigger swings on the left, smaller on the right, volume tapering as you go. Final dash-like candle clusters just before breakout.',
    illustration: '|\\        \n| \\  /\\   \n|  \\/  \\ /\\___ ← pivot\n     25%  12% 6% 3%',
  },
  {
    id: 'high-tight-flag',
    title: 'High Tight Flag (HTF)',
    emoji: '🚀',
    oneliner: 'Rarest and most powerful base — 5x potential when real.',
    timeframe: 'W',
    source: "O'Neil (CANSLIM)",
    color: 'amber',
    section: 'bases',
    conditions: [
      'Stock advances 100%+ in 4-8 weeks (a vertical run, not gradual).',
      'Then consolidates in a tight 10-25% range for 3-5 weeks (the "flag").',
      'Flag must be ABOVE the prior breakout point — never undercuts.',
      'Volume dries up sharply in the flag and explodes again on the second breakout.',
    ],
    fakeouts: [
      { label: 'Wide consolidation', detail: 'A "flag" wider than 25% is not a flag — it\'s a normal correction. The whole pattern fails.' },
      { label: 'Long consolidation', detail: 'A flag that takes 8+ weeks loses energy. HTFs that work resolve in 3-5 weeks.' },
      { label: 'Pre-100% misreading', detail: 'Without the 100%-in-8-weeks prior advance, what looks like an HTF is just a tight base. Different setup.' },
    ],
    visual: 'A near-vertical move on the chart followed by a tight horizontal band sitting at the top of the run. Looks like a flagpole with a small rectangular flag.',
    illustration: '       _____\n      /     \\_  ← flag (10-25%)\n     /\n    /\n   /\n  /  (+100% in 4-8 weeks)\n /\n/',
  },
  {
    id: 'three-weeks-tight',
    title: 'Three Weeks Tight (3WT)',
    emoji: '〰',
    oneliner: 'The minimal-volatility add-on signal during a strong uptrend.',
    timeframe: 'W',
    source: 'Stockbee',
    color: 'cyan',
    section: 'bases',
    conditions: [
      'Three CONSECUTIVE weekly closes within ~1.5% of each other.',
      'Stock is already in Stage 2 (uptrend), not basing for the first time.',
      'Volume contracts through the three weeks.',
      'Add-on entry on breakout above the three-week high.',
    ],
    fakeouts: [
      { label: '3WT at lows', detail: '3WT in a Stage 4 downtrend = sellers pausing, not buyers absorbing. Don\'t trade it long.' },
      { label: 'Spread closes', detail: 'Three closes within 3-4% is NOT 3WT. The discipline of ~1.5% is what makes the signal rare and predictive.' },
      { label: 'After a vertical move', detail: '3WT immediately after a 50%+ vertical move is exhaustion, not consolidation. Wait for proper base first.' },
    ],
    visual: 'Three weekly candles whose closes look identical. Volume contracting. Breakout = continuation entry.',
  },
  {
    id: 'double-bottom-w',
    title: 'Double Bottom / W Bottom',
    emoji: '🇼',
    oneliner: 'Zanger\'s favourite reversal setup — undercut + reclaim.',
    timeframe: 'D+W',
    source: 'Zanger',
    color: 'green',
    section: 'bases',
    conditions: [
      'W-shaped pattern: low #1 → bounce → low #2 (must UNDERCUT low #1 by a small amount — the shakeout).',
      'Middle peak (top of the W) becomes the pivot.',
      'Volume: light into the lows, EXPANDS off the second low.',
      'Pivot break on volume ≥ 1.5× of 50-day average.',
    ],
    fakeouts: [
      { label: 'No undercut', detail: 'A "double bottom" where low #2 doesn\'t pierce low #1 leaves trapped longs — they sell into the bounce. Real W needs the shakeout.' },
      { label: 'Equal peaks of the W', detail: 'If the middle peak is below the side highs, what looks like a W is a continuation pattern, not a reversal.' },
      { label: 'Stage 4 W', detail: 'Multiple W bottoms can form inside a long downtrend. Don\'t buy until the 200-day MA flattens.' },
    ],
    visual: 'On the daily, low #2 spikes BELOW low #1 then closes back above. That undercut + reclaim is the entry trigger.',
    illustration: 'X    X  <- middle peak = pivot\n \\  / \\\n  \\/   \\\n  bot1  \\__bot2 (undercut + reclaim)',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 🎯 ENTRIES
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'cheat-entry',
    title: 'Cup-Completion Cheat (CCC)',
    emoji: '🔓',
    oneliner: 'Minervini\'s early entry — buy inside the base before the proper pivot.',
    timeframe: 'W',
    source: 'Minervini (SEPA)',
    color: 'saffron',
    section: 'entries',
    conditions: [
      'Stock has formed a cup that\'s 80%+ complete (right side advancing back toward the prior high).',
      'A small "shelf" or mini-consolidation forms BELOW the prior high — this is the cheat pivot.',
      'Cheat pivot = high of that shelf. Entry triggers on volume expansion above it.',
      'Stop is tight (5-7% max), placed just below the shelf low.',
    ],
    fakeouts: [
      { label: 'No shelf, just hope', detail: 'Buying mid-cup without a tight shelf is averaging into a pre-breakout zone. Wait for the consolidation.' },
      { label: 'Shelf above prior high', detail: 'A shelf forming above the prior high is the proper pivot, not a cheat. Use standard breakout rules.' },
      { label: 'Cheat in late-stage base', detail: 'Cheats work in EARLY-stage bases. Late-stage cheats fail at higher rates than proper pivots.' },
    ],
    visual: 'The cup\'s right side is climbing. A tight horizontal pause forms just below the cup high. Volume dries up in the pause, expands on the break of the pause.',
    illustration: '   ___      ____ cup high\n  /   \\___ /\n /        ^___ cheat pivot (small shelf)\n/',
  },
  {
    id: 'power-buy',
    title: 'Power Buy',
    emoji: '⚡',
    oneliner: 'Minervini\'s aggressive entry on first day of explosive move out of base.',
    timeframe: 'D',
    source: 'Minervini (SEPA)',
    color: 'saffron',
    section: 'entries',
    conditions: [
      'Stock is in a constructive base or just broke out within the last 1-3 sessions.',
      'A single trading session prints a +5-7% move on volume ≥ 2× of 50-day average.',
      'Close in the upper 25% of the day\'s range.',
      'No prior +5% sessions in the last 10 trading days (so this is a real ignition, not noise).',
    ],
    fakeouts: [
      { label: 'Earnings day power', detail: 'A +6% day on earnings is often a one-time gap, not a power buy. Wait for follow-through the next 2-3 sessions.' },
      { label: 'Close near the low', detail: 'A +6% intraday move that closes near the low is short-squeeze unwound. Reversal signal, not buy.' },
      { label: 'Inside a downtrend', detail: 'Power buys only work when 30W MA is rising. Below a falling 30W, big up-days are dead-cat bounces.' },
    ],
    visual: 'The biggest green candle on the chart for 10+ sessions, closing near the high, on volume that visibly towers over everything.',
  },
  {
    id: 'proper-pivot-buy',
    title: 'Proper Pivot Buy (Classic)',
    emoji: '🎯',
    oneliner: 'The canonical CANSLIM entry — base high + 10 paise.',
    timeframe: 'D',
    source: "O'Neil (CANSLIM)",
    color: 'green',
    section: 'entries',
    conditions: [
      'Identify pivot before entry: cup-with-handle handle high, flat-base high, ascending-base 3rd-pullback high, VCP final-contraction high.',
      'Enter at pivot + 0.10 (paise or cents). Never below the pivot.',
      'Volume on the breakout day ≥ 1.5× of 50-day average. ≥ 2× preferred.',
      'Buy within the 5% buy zone above the pivot. Beyond +5% extended → wait for new base.',
    ],
    fakeouts: [
      { label: 'Chasing extended', detail: 'Buying at +8% above pivot is the most expensive mistake in CANSLIM. The risk-reward inverts. Wait for the next base.' },
      { label: 'Buying intraday wick', detail: 'Buying when price wicks above pivot but closes below is not a breakout. Wait for the CLOSE above pivot.' },
      { label: 'Pivot in Stage 4 market', detail: 'Even perfect pivots fail 60% in correcting markets. Wait for a Follow-Through Day on the index first.' },
    ],
    visual: 'Mark the pivot as a horizontal line on the chart. Wait for the price to close decisively above it on a heavy volume bar. Enter same day.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 〰 PRICE ACTION
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'shallow-pullback',
    title: 'Shallow Pullback (10W & 30W Behaviour)',
    emoji: '🌊',
    oneliner: 'Trend integrity check — does the stock respect its MAs?',
    timeframe: 'D+W',
    source: 'Weinstein (Stages)',
    color: 'amber',
    section: 'action',
    conditions: [
      'After the breakout, deepest close below 10W MA is between 0% and −7%. (Daily: < −5% below 21EMA.)',
      'Deepest close below 30W MA is between 0% and −8%. (Daily: < −7% below 50DMA.)',
      'EACH time price tested the MA, it reclaimed within 3 weeks (or 5 sessions on daily).',
      'Volume on the pullback was DRY (below average); volume on the reclaim was HEAVY (>1.5× average).',
    ],
    fakeouts: [
      { label: 'Distribution at the trendline', detail: 'Touching 30W on heavy DOWN volume. Distribution at the trendline often precedes failure.' },
      { label: 'No-conviction bounce', detail: 'Reclaim on weak volume. Bounce without conviction, often fails again.' },
      { label: 'Broken trend', detail: 'Spending 4+ weeks below 30W even by just −3%. The trend has actually broken.' },
    ],
    visual: 'At each MA test, look at the candles — wicks pointing down (touched MA, closed back above) = healthy. Bodies closing below the MA = problem.',
  },
  {
    id: 'squat',
    title: 'Squat',
    emoji: '🦘',
    oneliner: 'Minervini\'s sharp early dip in a base — shake out weak holders, keep going.',
    timeframe: 'D',
    source: 'Minervini (SEPA)',
    color: 'amber',
    section: 'action',
    conditions: [
      'Sharp 1-3 session drop early in a base (first 3 weeks), 5-10% magnitude.',
      'Drop is QUICKLY reversed — back above the pre-squat range within 5 sessions.',
      'Volume spikes on the drop (panic selling), then volume dries up on the reclaim.',
      'After the squat, the base resumes normal sideways character.',
    ],
    fakeouts: [
      { label: 'Squat that doesn\'t recover', detail: 'A sharp drop that does NOT reclaim within 5 sessions isn\'t a squat — the base is broken. Pattern void.' },
      { label: 'Squat in extended stock', detail: 'A "squat" 30 weeks into a parabolic move is the start of distribution, not a shakeout.' },
      { label: 'Squat into news', detail: 'A 7% drop on news doesn\'t reset the base — it changes the thesis. Re-evaluate fundamentals.' },
    ],
    visual: 'A single deep red candle on heavy volume sticking out below the otherwise tight base. Then it reverses — the base continues as if nothing happened.',
  },
  {
    id: 'reversal-recovery',
    title: 'Reversal Recovery',
    emoji: '↩',
    oneliner: 'Minervini\'s V-shaped reclaim of a key level — strong-hand commitment.',
    timeframe: 'D+W',
    source: 'Minervini (SEPA)',
    color: 'green',
    section: 'action',
    conditions: [
      'Stock dips below a key support (50-day MA, prior pivot, base low).',
      'Recovers and CLOSES back above that support within 1-3 sessions.',
      'Volume on the recovery day ≥ 1.5× of 50-day average.',
      'Range of the recovery day spans 70%+ of the prior down-move.',
    ],
    fakeouts: [
      { label: 'Recovery on light volume', detail: 'Reclaiming the level on weak volume = relief bounce, not commitment. Usually fails on the second test.' },
      { label: 'Multiple tests needed', detail: 'A "reversal" that takes 5+ sessions to reclaim is not a V-recovery — it\'s a re-test pattern with weaker odds.' },
      { label: 'In a falling 200-DMA', detail: 'Reversal recoveries in a Stage 4 market are dead-cat bounces. Demand the 200-DMA be flat or rising.' },
    ],
    visual: 'A sharp red day or two followed by an even sharper green day that closes ABOVE the prior support. Sticks out as a "V" in the chart.',
    illustration: '\\        /\n \\      /\n  \\    /  <- recovery day\n   \\  /\n    \\/  <- pierced support\n   support line',
  },
  {
    id: 'spring',
    title: 'Wyckoff Spring',
    emoji: '🌱',
    oneliner: 'Final shakeout below support before institutional markup.',
    timeframe: 'D+W',
    source: 'Wyckoff',
    color: 'green',
    section: 'action',
    conditions: [
      'Price has been ranging (Wyckoff "accumulation" phase) for weeks/months.',
      'A sudden push BELOW the support of that range triggers stop-losses.',
      'Price quickly snaps back inside the range — usually same day or next.',
      'Volume on the spring is heavy (capitulation), then volume diminishes as price holds.',
    ],
    fakeouts: [
      { label: 'No recovery into range', detail: 'A break below support that fails to recover into the range is a real breakdown, not a spring. Watch for stage 4.' },
      { label: 'Spring on light volume', detail: 'A false break with light volume is just a low-energy probe. Real springs trap stops in size — volume confirms.' },
      { label: 'Late-stage spring', detail: 'Springs work after months of accumulation. A "spring" two weeks into a new range is just chop.' },
    ],
    visual: 'A long lower wick pokes BELOW the support line, but the candle closes back inside the range. That trap candle is the spring.',
    illustration: '═══════════ range top\n  ___\n /   \\\n____ ___ <- support\n     |\n     V  <- spring (wick below + close inside)',
  },
  {
    id: 'shakeout',
    title: 'Shakeout',
    emoji: '🌀',
    oneliner: 'Mid-base trap that washes out weak hands before the breakout.',
    timeframe: 'D+W',
    source: 'Composite',
    color: 'amber',
    section: 'action',
    conditions: [
      'Inside a base, price suddenly violates a key support (50-DMA, base low) intraday.',
      'Recovers same session — closes inside the prior range.',
      'Volume on the shakeout day is heavy (panic).',
      'Within 1-3 weeks of the shakeout, price tests and breaks the proper pivot.',
    ],
    fakeouts: [
      { label: 'Shakeout that doesn\'t recover', detail: 'Closing below support is a real breakdown. Once the close confirms, the structure is broken.' },
      { label: 'Repeated shakeouts', detail: 'A "shakeout" every two weeks is just choppy accumulation that\'s failing. One clean shakeout is enough; multiple = sloppy supply.' },
      { label: 'Shakeout late in base', detail: 'A shakeout in week 8 of a 9-week base is too late — the energy is gone. Shakeouts work mid-base.' },
    ],
    visual: 'A single panicky day with a long lower wick that closes back at the top of the day\'s range. Volume spikes; the next day is quiet.',
  },
  {
    id: 'screwbar',
    title: 'Screwbar (Bearish Reversal)',
    emoji: '🔻',
    oneliner: 'Zanger\'s rejection candle — long upper wick, close near the low.',
    timeframe: 'D',
    source: 'Zanger',
    color: 'red',
    section: 'action',
    conditions: [
      'Price opens, runs UP sharply intraday, then sells off and closes near the day\'s LOW.',
      'Upper wick is 2-3× the body size; lower wick minimal.',
      'Volume on the screwbar day is heavy (heavy distribution at highs).',
      'Occurs at resistance or after an extended run — not mid-base.',
    ],
    fakeouts: [
      { label: 'Screwbar in early base', detail: 'Long upper wicks early in an accumulation base are not screwbars — they\'re routine supply tests.' },
      { label: 'Light volume', detail: 'A screwbar pattern without volume is just routine intraday rejection. Real screwbars print on the heaviest volume of the trend.' },
      { label: 'Reversed next day', detail: 'If the next session closes ABOVE the screwbar high, the rejection was absorbed. The pattern voids.' },
    ],
    visual: 'A vertical candle that looks like an inverted hammer/shooting star with a tiny body at the bottom. Volume bar is the tallest in recent memory.',
    illustration: '|\n|  ← upper wick (rejection)\n|\n|\n█  ← small body at bottom\n   close near low',
  },
  {
    id: 'inverse-screwbar',
    title: 'Inverse Screwbar (Bullish Reversal)',
    emoji: '🔺',
    oneliner: 'Zanger\'s capitulation candle — long lower wick, close near the high.',
    timeframe: 'D',
    source: 'Zanger',
    color: 'green',
    section: 'action',
    conditions: [
      'Price opens, drops sharply intraday, then rallies and closes near the day\'s HIGH.',
      'Lower wick is 2-3× the body size; upper wick minimal.',
      'Volume is heavy (capitulation flush absorbed by institutions).',
      'Occurs at support — prior base low, 200-DMA, prior breakout level.',
    ],
    fakeouts: [
      { label: 'Inverse screwbar in mid-trend', detail: 'In a strong uptrend, intraday dips are routine. Inverse screwbars are powerful only at MAJOR support after a correction.' },
      { label: 'Light volume reversal', detail: 'Light-volume bullish reversal = no institutional commitment. Wait for the heavy-volume version.' },
      { label: 'Failed next day', detail: 'If the next session closes BELOW the inverse screwbar low, the bullish signal voids. Stop is the inverse-screwbar low.' },
    ],
    visual: 'A vertical candle shaped like a hammer with a tiny body at the top. Stands out as a long lower wick at a major support level.',
    illustration: '   close near high\n█  ← small body at top\n|\n|\n|  ← lower wick (flush absorbed)\n|',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ⤴ TREND CONFIRMATION
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'stage-2-cross',
    title: '30-Week > 50-Week MA Cross (Stage-2)',
    emoji: '⤴',
    oneliner: 'Weinstein stage-2 trend confirmation.',
    timeframe: 'W',
    source: 'Weinstein (Stages)',
    color: 'green',
    section: 'trend',
    conditions: [
      '30-week MA crosses ABOVE the 50-week MA.',
      'Both MAs are RISING after the cross (not flat or falling).',
      'The cross happens within 12 weeks of the price pivot — not 3 years later.',
      'Price stays above BOTH MAs for at least 4 consecutive weeks after the cross.',
    ],
    fakeouts: [
      { label: 'Sideways whipsaw', detail: 'A cross with both MAs FLAT. Sideways market crosses whipsaw constantly.' },
      { label: 'Late confirmation', detail: 'Cross 3 years into a run. Useful as exit confirmation but not entry — the move is mature.' },
      { label: 'Bad market beta', detail: 'Cross while the index is in Stage 4. Individual stock strength gets crushed by market beta.' },
    ],
    visual: '30W must visibly OVERTAKE the 50W at an upward angle, not horizontally. Both lines sloping up = Stage 2 confirmed.',
  },
  {
    id: 'rs-new-high',
    title: 'Relative Strength New High',
    emoji: '📈',
    oneliner: 'Institutional preview — money flowing in before price moves.',
    timeframe: 'D+W',
    source: "O'Neil (CANSLIM)",
    color: 'purple',
    section: 'trend',
    conditions: [
      'Plot stock price ÷ benchmark (Nifty / S&P).',
      'That ratio (the RS line) hits a NEW 52-WEEK HIGH.',
      'The new high happens BEFORE the stock\'s own price makes a new high (timing edge).',
      'Index itself is in Stage 1 or Stage 2 (NOT Stage 4 bear market).',
    ],
    fakeouts: [
      { label: 'Relative win, absolute loss', detail: 'RS rising because the INDEX is falling faster. You still lose money.' },
      { label: 'RS spike fakeout', detail: 'RS at new high on a single-day spike that reverses next week. False RS breakout.' },
      { label: 'Sentiment shift only', detail: 'RS leading but volume drying up. Sentiment shifting, no institutional weight behind it yet.' },
    ],
    visual: 'Plot stock/index ratio. The line CLIMBING while the stock\'s own chart is still in a base. That divergence is the pre-breakout footprint.',
  },
  {
    id: 'weinstein-stages',
    title: 'Weinstein Stage Analysis (1-4)',
    emoji: '🔁',
    oneliner: 'Where in the cycle is this stock? Buy only in Stage 2.',
    timeframe: 'W',
    source: 'Weinstein (Stages)',
    color: 'purple',
    section: 'trend',
    conditions: [
      'STAGE 1 (Basing): 30W flat, price oscillating in a range, no directional bias. Volume muted.',
      'STAGE 2 (Advancing): price breaks above 30W on volume; 30W inflects UP. Buy only here.',
      'STAGE 3 (Topping): 30W flattens, advances fail to make new highs, distribution accumulates.',
      'STAGE 4 (Declining): price breaks below flattening/falling 30W. Short rallies fail beneath it. All longs out.',
    ],
    fakeouts: [
      { label: 'Premature Stage 2', detail: 'A break above a still-FALLING 30W isn\'t Stage 2 — it\'s a Stage 1-to-2 transition that hasn\'t confirmed. Wait for 30W slope to turn up.' },
      { label: 'Stage 1 boredom buy', detail: 'Buying in Stage 1 because it "looks oversold" is dead money. Stage 1 can last for years.' },
      { label: 'Stage 3 catch-up FOMO', detail: 'Buying in Stage 3 because "everyone else got rich" is the textbook bagholder trap.' },
    ],
    visual: 'Look at the 30W MA slope. Flat = Stage 1. Rising and price above = Stage 2. Flattening at highs = Stage 3. Falling and price below = Stage 4.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 🔴 TOPS & EXHAUSTION
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'climax-top',
    title: 'Climax Top',
    emoji: '🌋',
    oneliner: 'The parabolic blow-off that ends major advances.',
    timeframe: 'D+W',
    source: "O'Neil (CANSLIM)",
    color: 'red',
    section: 'tops',
    conditions: [
      'Stock has advanced 100%+ in the prior 6-18 months (extended).',
      'Largest weekly price advance of the entire move — 25-50% in 1-3 weeks.',
      'Exhaustion gap UP at the start of the final spurt.',
      'Furthest above the 200-DMA the stock has been during the whole run (typically >70% above).',
    ],
    fakeouts: [
      { label: 'Healthy continuation', detail: 'A +15% week in a strong uptrend after a base is continuation, not climax. Climax requires the COMBINATION of conditions.' },
      { label: 'Single big gap', detail: 'One gap on news does not equal climax. Climax needs the full parabolic structure: extension + sharpest week + exhaustion gap.' },
      { label: 'Index-driven move', detail: 'A vertical move because the whole market gapped up isn\'t individual climax — it\'s market beta. Wait for the stock-specific signature.' },
    ],
    visual: 'The chart looks like a hockey stick — long calm advance, then a near-vertical spike at the very end with a gap up. That\'s the top.',
  },
  {
    id: 'distribution-day-count',
    title: 'Distribution Day Count',
    emoji: '📊',
    oneliner: 'Index health audit — 5+ distribution days = market topping.',
    timeframe: 'D',
    source: "O'Neil (CANSLIM)",
    color: 'red',
    section: 'tops',
    conditions: [
      'On a major index (Nifty / S&P), a distribution day = close DOWN ≥ 0.2% on volume HIGHER than the prior session.',
      'Rolling 25-session window. A distribution day "rolls off" after 25 sessions OR earlier if the index rallies 5% from the distribution day close.',
      '1-2 distribution days = normal · 3-4 = warning · 5-6 = institutions distributing · 6+ = correction often imminent.',
      '"Stalling days" (flat close on heavy volume) count as half-distribution.',
    ],
    fakeouts: [
      { label: 'Volume up 1%', detail: 'A "distribution" day with volume barely higher than prior is borderline. Use ≥10% higher volume threshold for high-conviction count.' },
      { label: 'News-day distribution', detail: 'A distribution day immediately on bad macro news may resolve quickly. Watch for clusters, not single days.' },
      { label: 'After-hours distribution', detail: 'Day-end distribution from forced rebalancing (month-end, index reconstitution) is mechanical, not directional.' },
    ],
    visual: 'On the index chart, mark each red-down-bigger-volume day with a small red dot. When you see 5+ dots in the last 25 sessions, raise cash.',
  },
  {
    id: 'failed-pattern',
    title: 'Failed Pattern Signs',
    emoji: '❌',
    oneliner: 'When the breakout doesn\'t do what breakouts do — get out.',
    timeframe: 'D+W',
    source: 'Composite',
    color: 'red',
    section: 'tops',
    conditions: [
      'After breakout, price falls back BELOW the pivot within 3 sessions on volume ≥ pre-breakout average.',
      '+12-week return is negative AND no recovery to the pivot within 6 weeks.',
      '50-day MA crossed back below 200-day MA within 4 weeks of the breakout.',
      'RS line peaks before price and turns down. The buy thesis is rejected.',
    ],
    fakeouts: [
      { label: 'Routine pullback', detail: 'A 5-7% pullback to test the pivot is healthy. Failed-pattern test: closes BELOW pivot, not just dips intraday.' },
      { label: 'Volatile market', detail: 'In a violent macro market, even good setups fake out. Distinguish stock-specific failure from index-driven volatility.' },
      { label: 'Earnings event', detail: 'A failure on an earnings day may be a one-day reaction. Wait 2-3 sessions for the verdict.' },
    ],
    visual: 'Mark the pivot. If the price closes back below the pivot on heavy volume — exit immediately. The pattern voided.',
  },
  {
    id: 'return-scorecard',
    title: '+12W and +52W Returns (Scorecard)',
    emoji: '📅',
    oneliner: 'Post-entry diagnostic — is this trade actually working?',
    timeframe: 'W',
    source: 'Composite',
    color: 'saffron',
    section: 'tops',
    conditions: [
      '+12W return ≥ +25% with healthy acc:dis = strong start; let it run.',
      '+12W return 0% to +10% = lukewarm; tighten stops, don\'t add.',
      '+12W return negative AND no recovery to pivot in 6 weeks = breakout failed; exit.',
      '+52W return ≥ +50% with rising 30W = core compounder; long-term hold. < +20% over 52W = redeploy capital.',
    ],
    fakeouts: [
      { label: 'News-spike winner', detail: '+30% in 12 weeks but ALL of it from one gap on news. Unstable, will retrace.' },
      { label: 'Climax move', detail: '+100% in 8 weeks (vertical). Climax — expect a 30-50% reset before next leg.' },
      { label: 'Retail rally', detail: '+60% in 52W but acc:dis is 2:6. Retail-driven, not institutional. Distribution incoming.' },
    ],
    visual: 'Mark entry on chart. At 12W and 52W marks: higher highs + higher lows + 30W rising = real winner. Single vertical spike + sideways = one-week wonder.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 🌐 MARKET CONTEXT
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'follow-through-day',
    title: 'Follow-Through Day (FTD)',
    emoji: '🚦',
    oneliner: 'O\'Neil\'s market bottom signal — required for new positions.',
    timeframe: 'D',
    source: "O'Neil (CANSLIM)",
    color: 'green',
    section: 'market',
    conditions: [
      'After a correction, the index has rallied from its low for at least 4 days (an "attempted rally").',
      'On day 4-7 (rarely as late as day 10-14): index closes UP ≥ 1.0% (1.7% historically) on volume HIGHER than the prior day.',
      'No new lower low in the prior 4 sessions during the attempted rally.',
      'Strongest leaders break out of bases within 4-14 weeks of a valid FTD — first leaders confirm the FTD.',
    ],
    fakeouts: [
      { label: 'Day 1-3 false start', detail: 'An "FTD" on day 1, 2 or 3 of the attempted rally is too early. Statistically these fail. Demand day 4 minimum.' },
      { label: 'No leader confirmation', detail: 'A valid FTD must be followed by leaders breaking out from bases within ~14 weeks. If no leaders confirm, the FTD was false.' },
      { label: 'FTD without prior pain', detail: 'A "FTD" without a real prior correction is just a strong day in an uptrend. FTDs only matter after a 10%+ index drop.' },
    ],
    visual: 'On the index chart, after a correction low: count days of attempted rally. When day 4+ closes >1% up on heavier volume than the prior day, that\'s the green light to start adding new positions.',
  },
];

const TIMEFRAME_LABEL: Record<Timeframe, string> = { D: 'DAILY', W: 'WEEKLY', 'D+W': 'DAILY+WEEKLY' };
const TIMEFRAME_COLOR: Record<Timeframe, string> = { D: 'var(--mc-cyan)', W: 'var(--mc-saffron)', 'D+W': 'var(--mc-state-persistent)' };

export default function VolumeRulesPage() {
  const [activeSection, setActiveSection] = useState<SectionId | 'all'>('all');
  const [search, setSearch] = useState('');

  const filtered = RULES.filter((r) => {
    if (activeSection !== 'all' && r.section !== activeSection) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${r.title} ${r.oneliner} ${r.source} ${r.conditions.join(' ')} ${r.fakeouts.map(f => f.label + ' ' + f.detail).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const card: CSSProperties = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: '18px 22px',
    marginBottom: 14,
  };

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
            🎯 Volume & Price-Action Rules
          </h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.55 }}>
            Pattern library most retail never learns · {RULES.length} institutional rules across 7 categories ·
            Sourced from O\'Neil, Minervini, Zanger, Wyckoff, Weinstein, Morales/Kacher, Stockbee.
          </div>
        </div>

        {/* SECTION TABS */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button onClick={() => setActiveSection('all')} style={{
              padding: '7px 13px',
              background: activeSection === 'all' ? `color-mix(in srgb, ${C.cyan} 14%, transparent)` : 'transparent',
              border: `1px solid ${activeSection === 'all' ? C.cyan : C.border}`,
              borderRadius: 6, color: activeSection === 'all' ? C.cyan : C.text2,
              fontSize: 12, fontWeight: 800, cursor: 'pointer',
            }}>
              🗂 ALL ({RULES.length})
            </button>
            {SECTIONS.map((s) => {
              const sectionColor = C[s.color];
              const isActive = activeSection === s.id;
              const count = RULES.filter(r => r.section === s.id).length;
              return (
                <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
                  padding: '7px 13px',
                  background: isActive ? `color-mix(in srgb, ${sectionColor} 14%, transparent)` : 'transparent',
                  border: `1px solid ${isActive ? sectionColor : C.border}`,
                  borderRadius: 6, color: isActive ? sectionColor : C.text2,
                  fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                  {s.emoji} {s.label} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* SEARCH */}
        <div style={{ marginBottom: 18 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔎 Search rules (cup, VCP, screwbar, climax, gap…)"
            style={{
              width: '100%', padding: '10px 14px',
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
              color: C.text, fontSize: 13, outline: 'none',
            }}
          />
        </div>

        {/* RULE CARDS */}
        {filtered.length === 0 && (
          <div style={{ ...card, color: C.muted, textAlign: 'center', fontStyle: 'italic' }}>
            No rules match — try a different search or tab.
          </div>
        )}
        {filtered.map((r, i) => {
          const ruleColor = C[r.color];
          return (
            <div key={r.id} id={`rule-${r.id}`} style={{
              ...card,
              borderLeft: `3px solid ${ruleColor}`,
            }}>
              {/* HEADER */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 22, lineHeight: 1.2 }}>{r.emoji}</div>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: C.text, letterSpacing: 0.2 }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: 12, color: ruleColor, fontWeight: 700, fontStyle: 'italic', marginTop: 3 }}>
                    {r.oneliner}
                  </div>
                </div>
                {/* BADGES */}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                    padding: '3px 7px', borderRadius: 4,
                    color: TIMEFRAME_COLOR[r.timeframe],
                    border: `1px solid ${TIMEFRAME_COLOR[r.timeframe]}55`,
                    background: `color-mix(in srgb, ${TIMEFRAME_COLOR[r.timeframe]} 10%, transparent)`,
                  }}>📅 {TIMEFRAME_LABEL[r.timeframe]}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                    padding: '3px 7px', borderRadius: 4,
                    color: C.muted, border: `1px solid ${C.border}`,
                    background: C.card2,
                  }}>📚 {r.source}</span>
                </div>
              </div>

              {/* THE TEST */}
              <div style={sectionLabel(C.green)}>✅ THE TEST (all must be true)</div>
              <ol style={{ paddingLeft: 22, margin: 0, color: C.text, fontSize: 13, lineHeight: 1.65 }}>
                {r.conditions.map((c, j) => (
                  <li key={j} style={{ marginBottom: 5 }}>{c}</li>
                ))}
              </ol>

              {/* FAKEOUTS */}
              <div style={sectionLabel(C.red)}>⚠ LOOKS LIKE IT BUT ISN&apos;T</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {r.fakeouts.map((f, j) => (
                  <div key={j} style={{
                    background: `color-mix(in srgb, ${C.red} 4%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${C.red} 22%, transparent)`,
                    borderRadius: 6, padding: '7px 11px',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.red, marginBottom: 2 }}>{f.label}</div>
                    <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.5 }}>{f.detail}</div>
                  </div>
                ))}
              </div>

              {/* ILLUSTRATION (optional) */}
              {r.illustration && (
                <>
                  <div style={sectionLabel(C.purple)}>📐 PATTERN SKETCH</div>
                  <pre style={{
                    ...MONO,
                    background: C.card2,
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    padding: '10px 14px',
                    fontSize: 11.5, color: C.text2,
                    lineHeight: 1.4, whiteSpace: 'pre-wrap', margin: 0,
                  }}>{r.illustration}</pre>
                </>
              )}

              {/* VISUAL RULE */}
              <div style={sectionLabel(C.cyan)}>👁 VISUAL RULE (5 seconds)</div>
              <div style={{
                background: `color-mix(in srgb, ${C.cyan} 6%, transparent)`,
                border: `1px solid color-mix(in srgb, ${C.cyan} 28%, transparent)`,
                borderRadius: 6, padding: '9px 13px',
                fontSize: 12.5, color: C.text, lineHeight: 1.55, fontStyle: 'italic',
              }}>
                {r.visual}
              </div>
            </div>
          );
        })}

        {/* COMBINED WALKTHROUGH */}
        {activeSection === 'all' && !search && (
          <div style={{
            ...card,
            borderLeft: `3px solid ${C.saffron}`,
            background: `linear-gradient(135deg, ${C.card}, color-mix(in srgb, ${C.saffron} 5%, ${C.card2}))`,
            marginTop: 24,
          }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.saffron, marginBottom: 4, letterSpacing: 0.3 }}>
              🗺 THE COMBINED CHART-READ WALKTHROUGH
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 1.55 }}>
              Apply every chart in this exact order. Bail at the first failure. The first chart that passes all 7 = your trade.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { step: 1, label: 'MARKET REGIME',     rule: 'Recent Follow-Through Day on the index + distribution day count ≤ 4. No FTD or too many dist days → cash.' },
                { step: 2, label: 'STAGE 2 CONFIRMED', rule: '30W rising, price above 30W, 30W>50W cross intact. Stage 1 / 3 / 4 → pass.' },
                { step: 3, label: 'BASE STRUCTURE',    rule: 'Recognizable base (cup w/handle, flat, ascending, VCP, HTF, 3WT, W bottom). No base → no setup.' },
                { step: 4, label: 'VOLUME DRY-UP',     rule: 'Right side of base shows declining volume. Wet → wait.' },
                { step: 5, label: 'TIGHT WEEKS',       rule: 'Final 2-4 weeks of base show narrow ranges, sequential contraction. No tightness → wait.' },
                { step: 6, label: 'POCKET PIVOTS',     rule: '2+ pocket pivots inside the base above the 10D MA. Zero → no institutional accumulation yet.' },
                { step: 7, label: 'RS NEW HIGH',       rule: 'RS line at new 52-week high BEFORE price. RS lagging → pass.' },
                { step: 8, label: 'PIVOT BREAK',       rule: 'Close above pivot + volume ≥ 1.5-2× of 50DMA + upper-half close + gap holds → ENTRY. Within 5% buy zone.' },
              ].map((w) => (
                <div key={w.step} style={{
                  background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 14,
                }}>
                  <div style={{
                    fontSize: 16, fontWeight: 900, color: C.saffron,
                    minWidth: 28, textAlign: 'center', ...MONO,
                  }}>{w.step}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 2 }}>{w.label}</div>
                    <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.5 }}>{w.rule}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 16, padding: '12px 16px',
              background: `color-mix(in srgb, ${C.green} 6%, transparent)`,
              border: `1px solid color-mix(in srgb, ${C.green} 28%, transparent)`,
              borderRadius: 8, fontSize: 12.5, color: C.text, lineHeight: 1.55,
            }}>
              <strong style={{ color: C.green }}>Mental model:</strong> these rules describe institutional accumulation in real-time.
              Volume is the footprint of size. Tight ranges are supply absorption. RS line is forward indicator of where capital is rotating.
              Stages are the macro skeleton. Patterns are the body. Volume is the breath. When all 8 align, you read the chart the same way a portfolio manager does — and enter at the same point.
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
