'use client';
// PATCH 1062 v3 — PLAYBOOK / INVESTMENT OPERATING SYSTEM + LIFE SYSTEM
// User feedback (compressed):
//   "playbook text so small, format ui not institutional, one tab with
//    everything, add Dont add losers / dont sell rules. Also add About Me
//    section (health > markets, PERMA, design around wiring) and Life
//    Satisfaction section (relationships, purpose, gratitude, control,
//    + self-compassion / emotion regulation / environment / define enough).
//    I want to be best in what I do — give me guidelines to be best."
//
// v3 design:
//   • ONE scrolling page (no tabs)
//   • Decision Engine widget at top (live state machine)
//   • 21 investment rules in 6 categories
//   • ABOUT ME — 5 personal operating rules
//   • LIFE SATISFACTION — 16 wellbeing principles
//   • Bigger fonts (14px body, 18px section, 32px rule numbers)
//   • Sticky side TOC, color-coded by category
import { useState, useEffect, useMemo } from 'react';

const CARD_BG = '#13131a';
const CARD2   = '#1a1a24';
const BORDER  = 'rgba(255,255,255,0.10)';
const MUTED   = '#9CA3AF';
const TEXT    = '#E5E7EB';
const TEXT2   = '#F3F4F6';
const PURPLE  = '#a78bfa';
const GREEN   = '#10b981';
const YELLOW  = '#f59e0b';
const RED     = '#ef4444';
const CYAN    = '#22d3ee';
const ORANGE  = '#f97316';
const BLUE    = '#60a5fa';
const ROSE    = '#fb7185';
const PEACH   = '#fbbf24';
const TEAL    = '#2dd4bf';
const LIME     = '#84cc16';
const SKY      = '#38bdf8';

const F = { xs: 12, sm: 13, md: 14, lg: 16, h2: 18, h1: 26, ruleNum: 32 };

type State = 'HOLD' | 'WATCH' | 'EXIT';

interface HoldingState {
  ticker: string;
  state: State;
  pnlPct?: number;
  closesBelow50: number;
  absorption: boolean;
  thesisIntact: boolean;
  /** PATCH 1067 — Once `closesBelow50 >= 3`, the trader records whether the
   *  NEXT (4th) candle closed green. A green 4th candle means momentum tried
   *  to reverse — we defer the exit instead of forcing it. */
  fourthCandleGreen?: boolean;
  /** PATCH 1067 — After the 3-close confirmation, the trader tracks whether
   *  any subsequent close has broken below the lowest low of the three
   *  breakdown candles. While that low watermark is intact, the market is
   *  absorbing supply at the same level — keep holding. The moment a close
   *  takes out that low, the breakdown is real and we exit. */
  brokeBelowBreakdownLow?: boolean;
  note?: string;
  updatedAt: number;
}

const STATE_COLOR: Record<State, string> = { HOLD: GREEN, WATCH: YELLOW, EXIT: RED };
const STATE_ICON:  Record<State, string> = { HOLD: '●', WATCH: '◐', EXIT: '✕' };

function classify(
  h: Pick<HoldingState, 'pnlPct' | 'closesBelow50' | 'absorption' | 'thesisIntact' | 'fourthCandleGreen' | 'brokeBelowBreakdownLow'>,
): { state: State; reason: string } {
  // Rule 6 — Capital-protection floor (absolute).
  if ((h.pnlPct ?? 0) <= -13) return { state: 'EXIT', reason: 'Rule 6: P&L ≤ −13% capital-protection floor' };
  // Rule 8 — Fundamental break.
  if (!h.thesisIntact)        return { state: 'EXIT', reason: 'Rule 8: thesis broken — fundamental override' };

  if (h.closesBelow50 >= 3) {
    // Rule 9 — Absorption override (existing, highest precedence).
    if (h.absorption)         return { state: 'WATCH', reason: 'Rule 9: 3 closes < 50DMA but panic-low absorbed' };

    // PATCH 1067 — Rule 7 refinement: defer the exit when the next candle
    // showed a green reversal, OR when the breakdown-low watermark is still
    // intact. Both are evidence the breakdown hasn't yet been confirmed.
    if (h.fourthCandleGreen === true) {
      return { state: 'WATCH', reason: 'Rule 7 deferred: 4th candle closed green — momentum reversal, holding' };
    }
    if (h.brokeBelowBreakdownLow === false) {
      return { state: 'WATCH', reason: 'Rule 7 deferred: breakdown low watermark intact — supply being absorbed, holding' };
    }
    // Fall through to exit only when all overrides have failed.
    return { state: 'EXIT', reason: 'Rule 7: 3 closes < 50DMA · 4th candle not green · low watermark taken out' };
  }
  return { state: 'HOLD', reason: 'above 50DMA · no triggers · do nothing' };
}

// ═══════════════════════════════════════════════════════════════════════════
// INVESTMENT RULES (1–21)
// ═══════════════════════════════════════════════════════════════════════════
type RuleCat = 'ENTRY' | 'EXIT' | 'POSITION' | 'PORTFOLIO' | 'BEHAVIOR' | 'DISCOVERY';

const CAT_COLOR: Record<RuleCat, string> = {
  ENTRY: CYAN, EXIT: RED, POSITION: PURPLE, PORTFOLIO: BLUE, BEHAVIOR: ORANGE, DISCOVERY: GREEN,
};

interface Rule { n: number; cat: RuleCat; title: string; body: string }

const RULES: Rule[] = [
  { n: 1,  cat: 'ENTRY', title: 'Never add to a loser.',
    body: 'Position down ≥ −5%? No fresh capital. The market is telling you the thesis is unproven; do not double the size of an unproven thesis. Adding to a loser is paying twice to be wrong.' },
  { n: 2,  cat: 'ENTRY', title: 'Never average down on a structural break.',
    body: 'If price is below 50DMA AND thesis has weakened, adding capital is gambling, not investing. The structural break is the market telling you something you don\'t know yet — respect it.' },
  { n: 3,  cat: 'ENTRY', title: 'Buy strength, not weakness.',
    body: 'Only add to positions making new highs OR holding above a rising 50DMA with intact fundamentals. Strength is the market confirming the thesis; weakness is the market disputing it.' },
  { n: 4,  cat: 'ENTRY', title: 'No new positions without a trigger.',
    body: 'Watchlist setups need a defined entry trigger: breakout above resistance, BUY-ZONE entry, earnings beat with raised guidance, or absorption confirmation. No "feels cheap" buys. No "the chart looks fine" buys.' },
  { n: 5,  cat: 'ENTRY', title: 'Position size = conviction × volatility.',
    body: '5% max for trend-follows. 8% for core compounders with intact moat. 2% for inflection bets / turnarounds. Never override sizing for "this time it\'s different." Sizing is the only thing you control.' },

  { n: 6,  cat: 'EXIT', title: 'Rule 1 — Capital protection (ABSOLUTE).',
    body: 'P&L ≤ −13% from cost → EXIT on next execution window. No exceptions. Not "let me wait one more day." Not "the thesis is still intact." Not "it\'ll bounce." Capital preserved is capital deployed in the next setup.' },
  { n: 7,  cat: 'EXIT', title: 'Rule 2 — Trend breakdown.',
    body: '3 consecutive closes below the 50DMA puts the position on notice. Exit only when the 4th candle fails to close green AND a subsequent session takes out the lowest low of the three breakdown candles. If the 4th candle is green, OR the breakdown-low watermark stays intact, the position keeps trading on the WATCH list — the market is still absorbing supply at this level. Absorption override (Rule 9) remains the highest-precedence reprieve.' },
  { n: 8,  cat: 'EXIT', title: 'Rule 3 — Fundamental break.',
    body: 'Thesis broken (guidance withdrawn, key driver gone, management credibility destroyed, regulatory shift) → EXIT immediately, irrespective of price. The reason you owned it is gone — you didn\'t sign up for this new business.' },
  { n: 9,  cat: 'EXIT', title: 'Rule 4 — Absorption override (defensive only).',
    body: 'Panic-low NOT revisited for 3–5 sessions after a sharp intraday breakdown → move to WATCH, NOT exit. Institutional demand absorbed the panic. This NEVER triggers a buy — it only delays a forced exit.' },
  { n: 10, cat: 'EXIT', title: 'Never sell a winner just because it\'s up.',
    body: 'Trim only if (a) position size > 10% of book, or (b) thesis exhausted (margins peaked, multi-bagger phase complete). "I\'m up 50%" is not a sell signal. The whole point of asymmetry is to let winners run uncapped.' },

  { n: 11, cat: 'POSITION', title: 'Let winners run, cut losers fast.',
    body: 'Asymmetry is the only edge that compounds: −13% hard floor on losers, no ceiling on winners. One 10x covers ten −13% losses with room to spare. Equal-weighting wins and losses is how retail loses.' },
  { n: 12, cat: 'POSITION', title: 'Trim, don\'t dump.',
    body: 'When trimming a winner, sell ⅓ at a time over multiple green rallies. Never market-sell the full position into a green day. Granular exits preserve optionality on the runner; binary exits guarantee you\'re wrong.' },
  { n: 13, cat: 'POSITION', title: 'Re-rate winners up, never down.',
    body: 'A position that\'s grown to 12% of book because of price appreciation stays at 12% if thesis intact. You don\'t trim a great business to "rebalance" — let the market do its job. Rebalancing winners into losers is the worst trade in finance.' },

  { n: 14, cat: 'PORTFOLIO', title: 'Sector cap 25%.',
    body: 'No single sector > 25% of book. Forces diversification across narratives so a single sector regime change doesn\'t blow up the portfolio. Track weekly; trim oldest names if cap breached.' },
  { n: 15, cat: 'PORTFOLIO', title: 'Theme cap 30%.',
    body: 'No single macro theme (AI / defence / rates-down / crude / renewables) > 30% of book. Crowding kills — when everyone is on the same theme, the door is narrow when sentiment turns. Themes correlate even across sectors.' },
  { n: 16, cat: 'PORTFOLIO', title: 'Cash floor 5%.',
    body: 'Never fully invested. 5% minimum cash for opportunistic adds when setups arrive. Being 100% invested means being 0% prepared. Cash is the ultimate option.' },
  { n: 17, cat: 'PORTFOLIO', title: '20-position ceiling.',
    body: 'Beyond 20 positions you can no longer track thesis intactness for every name. That\'s diworsification, not diversification. Concentrate into your best ideas; if you can\'t name the catalyst for each holding from memory, you own too many.' },

  { n: 18, cat: 'BEHAVIOR', title: 'Execution window only.',
    body: 'Buy/sell decisions made EOD (after 15:30 IST) or during the weekly review. NO intraday execution, ever. Intraday is the casino layer — the system runs on closes. If you have to ask, the answer is "wait until EOD."' },
  { n: 19, cat: 'BEHAVIOR', title: 'No X / news / Telegram for execution.',
    body: 'Social media allowed ONLY during weekly review, treated as entertainment, never signal. If you traded on a tweet, you broke this rule. The information that makes its way to your feed has already been priced in by the people who matter.' },
  { n: 20, cat: 'BEHAVIOR', title: 'The "Is there action?" gate.',
    body: 'When the urge to check portfolio strikes during market hours: ask "Is there any action in my system right now?" → NO → do nothing. YES → wait until EOD window anyway. The gate exists to short-circuit emotional checking.' },

  { n: 21, cat: 'DISCOVERY', title: 'Red-day strength is signal.',
    body: 'On broad-market down days, scan /movers for stocks holding green or printing relative strength. Every multibagger starts life as a daily mover — that\'s where leaders reveal themselves before the crowd notices. Cross-check movers daily; if a name appears 3+ sessions in a quarter with rising volume, add to research watchlist.' },
];

// ═══════════════════════════════════════════════════════════════════════════
// ABOUT ME — 5 personal operating rules (institutional voice, personalized)
// ═══════════════════════════════════════════════════════════════════════════
interface LifeRule { n: number; title: string; body: string; actions?: string[] }

const ABOUT_ME: LifeRule[] = [
  { n: 1, title: 'Health before markets.',
    body: '16-hour days on screens, no exercise, vertigo + anxiety — this is the first fire. Sleep loss and screen overload destroy edge faster than any bad trade. Your nervous system is the substrate analysis runs on; if it breaks, the model breaks.',
    actions: [
      'Fixed sleep window 11 pm–7 am. Treat late-night research as a LOSS, not a gain.',
      'Move 20–30 min daily — walk + light stretch. Reduces anxiety, improves cognition.',
      'Hard screen cut-off 1 hour before bed. No charts, no Twitter, no news.',
    ] },
  { n: 2, title: 'Structure your relationship with investing.',
    body: 'Right now investing invades every corner of life. That mental load blocks happiness AND blocks edge. Constant ad-hoc checking is the opposite of disciplined investing — it\'s anxiety dressed up as work.',
    actions: [
      'Time-box market work: 3 blocks (pre-market review · mid-day check · post-market analysis). No ad-hoc checking between.',
      'No-trade zones: meals, exercise, deep work = portfolio-free. No apps, no P&L, no Twitter.',
      'Track process metrics (concalls reviewed, theses updated, journals written) — NOT daily P&L. Hedonic adaptation kills happiness from green ticks.',
    ] },
  { n: 3, title: 'Build a life portfolio (PERMA).',
    body: 'PERMA = Positive emotion, Engagement, Relationships, Meaning, Accomplishment. You over-index on Engagement + Accomplishment. The other three need intentional work or compounding feels hollow.',
    actions: [
      'Positive emotion: small daily joys — food, music, nature walk, Malayalam movie, gratitude journal.',
      'Engagement (flow): one company / one concall at a time. No tab-hopping across 10 stocks.',
      'Relationships: schedule calls / time with family + friends. Strongest predictor of long-term happiness, per Harvard 80-year study.',
      'Meaning: investing as enabling family security, freedom to teach. Bigger than P&L.',
      'Accomplishment: celebrate finishing a model or deeply understanding a sector — not just hitting 10x.',
      'Weekly: rate 1–10 on each PERMA area. Pick one small action to nudge the lowest up.',
    ] },
  { n: 4, title: 'Accept your wiring, then design around it.',
    body: 'You drift into other worlds instead of focusing on one thing. Fighting your nature loses. Designing systems around it wins. Obsession is fuel — direct it, don\'t resist it.',
    actions: [
      'Pick 1–2 core themes (e.g. India semis + power infra). Go very deep. Drop chase of every hot small/mid-cap.',
      'Pomodoro: 25 min single-task deep work (one company, one concall) → 5 min break to "wander."',
      'Externalize the brain: written playbook (this page), daily to-do list. Don\'t hold things in working memory — they\'ll spike anxiety when you\'re tired or hungry.',
    ] },
  { n: 5, title: 'Define happiness metrics, not just return metrics.',
    body: 'Optimized for 10x returns and 10-year retirement, but undefined for day-to-day happiness. Reach the financial goal, still feel restless. Build a life dashboard with the same rigor as the portfolio dashboard.',
    actions: [
      'DAILY: Did I move my body? Did I have a real conversation NOT about markets? Did I spend 30–60 min on something "useless" (movie, music, reading) WITHOUT guilt?',
      'WEEKLY: Did I have one full or half day without checking portfolio? Did I do one thing purely for others (help, support, kindness)?',
      'Track these like KPIs. Equal weight to portfolio CAGR.',
    ] },
];

// ═══════════════════════════════════════════════════════════════════════════
// LIFE SATISFACTION — 16 principles (12 general + 4 user-added)
// ═══════════════════════════════════════════════════════════════════════════
const LIFE_SAT: LifeRule[] = [
  { n: 1,  title: 'Prioritize relationships over possessions.',
    body: 'Quality of close relationships predicts long-term happiness more than income or status. Harvard Adult Development Study (80 years running) finds good relationships among the strongest predictors of health and happiness in later life.',
    actions: ['Time with family and trusted friends', 'Invest in meaningful conversations', 'Resolve conflicts instead of avoiding', 'Build community, not large social network'] },
  { n: 2,  title: 'Have a purpose larger than yourself.',
    body: 'People whose actions feel meaningful report higher life satisfaction. The specific purpose matters less than believing your actions matter. Raising children, building a business, creating, serving, teaching, scientific discovery — pick one and lean in.',
    actions: ['Define your "why" in one sentence', 'Re-read it weekly', 'Align big decisions to it'] },
  { n: 3,  title: 'Protect your physical health.',
    body: 'Mental health and physical health are inseparable. Exercise is one of the most consistently effective non-pharmaceutical interventions for mood improvement.',
    actions: ['7–9 hours sleep', 'Regular exercise', 'Nutritious food', 'Time outdoors', 'Limit alcohol and addictive habits'] },
  { n: 4,  title: 'Practice gratitude.',
    body: 'The brain biases toward threats and problems. Regularly recognizing what\'s already going well shifts attention from scarcity to abundance.',
    actions: ['Every night write down 3 things that went well that day', '10 seconds each. Consistency > depth.'] },
  { n: 5,  title: 'Compare yourself only to your past self.',
    body: 'Social comparison creates dissatisfaction. Personal progress creates more durable satisfaction than outperforming others.',
    actions: ['Am I healthier than last year?', 'Have I learned something new?', 'Am I kinder?', 'Am I financially stronger?'] },
  { n: 6,  title: 'Accept that suffering is unavoidable.',
    body: 'Stoicism, Buddhism, modern psychology converge: happiness comes not from avoiding pain but from responding wisely to it. Reframe: not "why is this happening to me" but "what can I learn from this."',
    actions: ['When pain arrives, ask the second question first'] },
  { n: 7,  title: 'Limit excessive consumption.',
    body: 'More money helps happiness when it removes hardship; beyond that, material accumulation has diminishing returns. Experiences and relationships create longer-lasting happiness than luxury goods.',
    actions: ['Spend on time-with-people, not stuff', 'One-in-one-out rule for possessions'] },
  { n: 8,  title: 'Keep learning.',
    body: 'Learning creates novelty and confidence. Books, languages, history, instrument, professional expertise. Growth creates forward momentum.',
    actions: ['One book / month minimum', 'One skill in 12-month progression at any time'] },
  { n: 9,  title: 'Be useful to other people.',
    body: 'Helping others increases meaning and satisfaction. Contribution produces deeper fulfillment than consumption.',
    actions: ['Teach', 'Volunteer', 'Mentor juniors', 'Donate wisely', 'Help family members'] },
  { n: 10, title: 'Control what you can.',
    body: 'Anxiety comes from trying to control what\'s outside your influence. Stoicism and CBT converge here.',
    actions: ['FOCUS ON: your actions, preparation, habits, reactions', 'LET GO OF: others\' opinions, past mistakes, market movements, random events'] },
  { n: 11, title: 'Keep expectations realistic.',
    body: 'Expecting perfect success, relationships, or circumstances creates chronic disappointment. Contentment comes from appreciating "good enough" while continuing to improve.',
    actions: ['Reframe perfect as the enemy of done', 'Celebrate good-enough wins'] },
  { n: 12, title: 'Design your daily life well.',
    body: 'Happiness is less about rare extraordinary moments than about ordinary days. Small daily improvements compound over years.',
    actions: ['Do I enjoy my mornings?', 'Do I like the people I spend time with?', 'Is my work meaningful?', 'Do I have time for hobbies?', 'Am I constantly stressed?'] },
  // —— your 4 additions ——
  { n: 13, title: 'Self-compassion (treat yourself like a friend).',
    body: 'Driven people are harshly self-critical — this increases anxiety and reduces resilience. Self-compassion (acknowledging mistakes + taking responsibility + dropping self-attack) correlates with better mental health, stable motivation, higher life satisfaction after setbacks.',
    actions: [
      'After a bad trade / unproductive day, write: "What went wrong? What did I learn? What is my next concrete step?"',
      'NOT: "I am not good enough." That loop is the enemy.',
    ] },
  { n: 14, title: 'Emotional regulation — body-level, not just philosophy.',
    body: 'Stoicism and CBT are the cognitive layer. They fail when the nervous system is already overloaded. Need body-level tools too. Especially important given your vertigo and anxiety episodes.',
    actions: [
      'Slow-exhale breathing when anxiety spikes (4 in, 6 out, repeat 5×)',
      'Body scan or short mindfulness when overwhelmed',
      'Label emotions explicitly ("I feel anxious / frustrated / jealous") then challenge the underlying thought',
    ] },
  { n: 15, title: 'Environment design (shape context, not willpower).',
    body: 'Willpower depletes. Environment doesn\'t. Default path of least resistance should align with your values. Strong, often-ignored lever for long-term satisfaction.',
    actions: [
      'PHYSICAL: clean workspace, minimal clutter. Exercise gear visible. Junk food / addictive apps less accessible.',
      'DIGITAL: disable non-essential notifications. Remove quick links to distracting sites. Separate browser profiles for "deep work" vs "casual browsing."',
    ] },
  { n: 16, title: 'Define your "enough."',
    body: 'Perceived financial security (not raw income) strongly associates with life satisfaction. Without a written "enough", the 10x and 10-year retirement goals become an endless treadmill that undermines the wellbeing they\'re supposed to enable.',
    actions: [
      'Write down target capital, monthly expenses covered, buffer required.',
      'Re-read at every milestone. When you hit "enough," act like it. Drive should support wellbeing, not consume it.',
    ] },
];

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW CADENCE — how often to look at each thing (exactly one rhythm each)
// ═══════════════════════════════════════════════════════════════════════════
interface CadenceBucket { freq: string; when: string; accent: string; checks: string[]; note?: string }

const CADENCE: CadenceBucket[] = [
  { freq: 'DAILY', when: 'ONCE · after 15:30 IST close · ~5 min', accent: CYAN,
    checks: [
      'One look at the portfolio — EOD only. Not intraday, not "just checking". One look means one look.',
      'For each holding, check the 50DMA: did price CLOSE below its 50-day moving average today? If yes, add 1 to its 3-close counter; if it closed back above, reset to 0. When the counter hits 3, also flag the lowest low across those three sessions, and on the 4th day note whether the candle closed green. From then on, only treat the breakdown as confirmed if the close eventually breaks BELOW the 3-session low — until that happens, the position keeps holding.',
      'Run the Decision Engine: did anything hit −13%, 3 closes < 50DMA without absorption, or a broken thesis? Mark the action for the next execution window.',
      'On a red market day, glance at /movers for names holding green / relative strength (Rule 21). Log them — do not buy.',
      'Then close the app. The daily job is DETECTION, not action. If nothing fired, you are done.',
    ],
    note: 'No second look. The urge to re-check during the day is anxiety, not analysis — apply the "Is there action?" gate (Rule 20).' },
  { freq: 'WEEKLY', when: 'Weekend review · ~30–45 min', accent: BLUE,
    checks: [
      'Sector cap: is any single sector > 25% of book? If breached, trim the oldest names back under the cap (Rule 14).',
      'Theme cap: is any macro theme (AI / defence / rates-down / crude / renewables) > 30%? Trim if breached (Rule 15).',
      'Cash floor: still ≥ 5% cash for opportunistic adds? (Rule 16).',
      'Watchlist: refresh entry triggers; promote any name that printed relative strength 3+ sessions this week.',
      'Social media / news / Telegram: allowed ONLY now, as entertainment — never as a live signal (Rule 19).',
      'PERMA self-rating 1–10 on each area; pick one small action to nudge the lowest (About Me A3).',
    ] },
  { freq: 'MONTHLY', when: 'Full portfolio audit · ~1–2 hrs', accent: PURPLE,
    checks: [
      'Thesis intactness for EVERY holding: can you state its catalyst from memory? If not, it is a candidate to exit (Rule 17).',
      '20-position ceiling: above 20 names? Concentrate into your best ideas — diworsification is not diversification.',
      'Position sizing: did any winner grow past 10% of book? Decide trim-vs-let-run on THESIS, never to "rebalance" (Rules 10 & 13).',
      'Process metrics, not P&L: concalls reviewed, theses updated, journals written (About Me A2).',
      'Life dashboard: did you hit the daily / weekly wellbeing KPIs this month? (About Me A5).',
      'Re-read this whole playbook end to end.',
    ] },
  { freq: 'QUARTERLY', when: 'Step back · ~half day', accent: PEACH,
    checks: [
      'Earnings season: re-underwrite each core holding against the latest results / concall.',
      'Theme rotation: is a core theme maturing? Plan the rotation before the crowd starts exiting.',
      'Define "enough" check: re-read your target capital and buffer — still on plan? (Life L16).',
      'Self-compassion review: what did last quarter teach you, and what is the next concrete step? No self-attack (Life L13).',
    ] },
];

// ═══════════════════════════════════════════════════════════════════════════
// RELATIONSHIPS & CHARACTER — how to be someone people feel better around
// ═══════════════════════════════════════════════════════════════════════
const RELATIONSHIPS: LifeRule[] = [
  { n: 1, title: 'Treat everyone with respect.',
    body: 'Speak politely even when you disagree. The real test is how you treat people who cannot benefit you — waiters, cleaners, strangers, juniors. Respect is remembered far longer than intelligence, wealth, or status.',
    actions: ['Say please and thank you, every time', 'Be kind to people who can do nothing for you', 'Disagree with the idea, never belittle the person'] },
  { n: 2, title: 'Be reliable — keep your word.',
    body: 'Reliability builds trust, and trust is the foundation every friendship is built on. If you cannot do something, say so honestly instead of disappearing. A dependable "no" beats an unreliable "yes".',
    actions: ['Keep promises; arrive on time', 'If plans change, communicate early and honestly', 'Under-promise, over-deliver'] },
  { n: 3, title: 'Listen more than you speak.',
    body: 'People often like good listeners more than good speakers. Being interesting is less about talking a lot and more about making the other person feel heard. Ask, then actually listen to the answer.',
    actions: ['Let people finish without interrupting', 'Ask one thoughtful question every conversation', 'Respond to what they said, not what you wanted to say'] },
  { n: 4, title: 'Show genuine interest in others.',
    body: 'People enjoy those who make them feel important. Remembering details and following up signals that you care beyond the surface. This is the cheapest, highest-return relationship habit there is.',
    actions: ['"How did your interview go?" "How is your family?"', 'Remember names, birthdays, important events', 'Follow up on previous conversations'] },
  { n: 5, title: 'Be the calm in the room.',
    body: 'People prefer those who bring calm over those who bring drama. Constant complaining, anger, jealousy and gossip push people away even when you are right. Emotional stability is magnetic.',
    actions: ['Skip the chronic complaining', 'Never speak negatively about people who are absent', 'Regulate first, react second (Life L14)'] },
  { n: 6, title: 'Help without expecting an immediate return.',
    body: 'Explain something, share knowledge, support a friend through a hard time. Goodwill compounds quietly over years. But help because it is right — not solely to win approval; people sense the difference.',
    actions: ['Offer help before being asked', 'Support people in their bad times, not just their good ones', 'Keep no scorecard'] },
  { n: 7, title: 'Have integrity.',
    body: 'Integrity is doing the right thing when nobody is watching. Admit mistakes, keep confidences, do not manipulate. Strong character is what turns acquaintances into long-term friends.',
    actions: ['Own your mistakes openly', 'Do not betray things told in confidence', 'Do not lie for convenience'] },
  { n: 8, title: 'Have your own goals and interests.',
    body: 'People are drawn to those with purpose and direction. A full life — skills, reading, exercise, a career, hobbies — gives you positive energy to bring into relationships instead of neediness.',
    actions: ['Keep building your own thing', 'Bring energy in, do not only take it out', 'Be interesting by being engaged with life'] },
  { n: 9, title: 'Be positive, but authentic.',
    body: 'You do not have to fake happiness. Appreciate good things, encourage others, and celebrate their wins instead of competing with them. Genuine positivity is contagious; performed positivity is hollow.',
    actions: ['Celebrate others\' success sincerely', 'Give compliments only when deserved', 'Encourage without flattery'] },
  { n: 10, title: 'Be fully present.',
    body: 'Attention is the rarest gift you can give. Phone away, eyes up, fully there. In a world of half-distracted conversations, undivided attention makes people feel uniquely valued.',
    actions: ['Put the phone away in conversation', 'Maintain eye contact', 'Do not plan your reply while they are still talking'] },
  { n: 11, title: 'Repair quickly after friction.',
    body: 'Every close relationship has conflict; what matters is how fast you repair it. A sincere, early "I was wrong / I am sorry" protects the relationship more than never clashing in the first place.',
    actions: ['Address tension early, not after it festers', 'Apologise specifically, not vaguely', 'Ask: advice, or just listen? before responding to someone upset'] },
  { n: 12, title: 'Accept that not everyone will like you.',
    body: 'No matter how kind or capable you are, some personalities simply will not match yours — and trying to please everyone makes you appear inauthentic. Be respectful and consistent, then let it go.',
    actions: ['Aim for respect and consistency, not universal approval', 'Do not contort yourself to be liked', 'Invest in the people who match your energy'] },
];

// ═══════════════════════════════════════════════════════════════════════════
// PEAK PERFORMANCE — reflexes · focus · mastery (cricket · investing · IT)
// ═══════════════════════════════════════════════════════════════════════════
const MASTERY: LifeRule[] = [
  { n: 1, title: 'Anticipation beats raw reaction — read the cues early.',
    body: 'The biggest finding in sport science: experts do not react faster, they SEE sooner. World-class cricket batsmen read the bowler\'s hand and arm BEFORE the ball is released; weaker players wait for ball flight (Müller & Abernethy). The same edge applies everywhere — read the setup before the breakout, smell the bug before the stack trace.',
    actions: [
      'Temporal-occlusion drill: watch a bowler on video, pause at the instant of release, and call line / length from the arm + wrist alone — a meta-analysis confirms this training accelerates real anticipation.',
      'Investing: build "if I see X → I do Y" pattern cards so the decision is pre-made.',
      'IT: learn failure signatures so debugging starts from a hypothesis, not a search.',
    ] },
  { n: 2, title: 'Still train raw reflexes — the fast base layer.',
    body: 'Anticipation sits on top of trainable reaction speed and hand-eye coordination. Build the base so the body is ready when the mind reads the cue.',
    actions: [
      'Reaction-ball drill: catch after the first bounce — 3 sets of 10.',
      'Tennis-ball wall catches, alternating hands; partner ball-drops from shoulder height.',
      'Cricket: throwdowns / sidearm + slip-catching cradle; agility-ladder footwork.',
      'Reaction-light / aim-trainer apps a few minutes daily.',
    ] },
  { n: 3, title: 'Quiet Eye — a steady final fixation before you act.',
    body: 'Elite performers hold a longer, still gaze on the target in the last beat before moving. It is one of the most robust findings in the field — a meta-analysis found large effects on both gaze (d ≈ 1.5) and performance (d ≈ 0.8), and it lowers arousal under pressure. It is trainable.',
    actions: [
      'Cricket: lock a calm, quiet gaze on the ball at release — do not let the eyes dart.',
      'Pressure moments (a big delivery, a sizing decision): one steady fixation on the single thing that matters before you commit.',
      'It doubles as a nerve-settler when the stakes are high.',
    ] },
  { n: 4, title: 'Protect deep-work blocks ruthlessly.',
    body: 'A single interruption costs ~23 minutes to fully refocus (Gloria Mark), and "attention residue" leaves part of your mind stuck on the last task (Leroy). Context-switching is the silent killer of research and code quality. 60–90 min, single task, phone in another room, notifications off.',
    actions: ['One task to completion — no tab-hopping', 'Phone in a DIFFERENT room, not face-down on the desk', 'Two protected deep blocks a day, minimum'] },
  { n: 5, title: 'Reset focus with the physiological sigh.',
    body: 'Two short inhales through the nose, one long exhale through the mouth. A 2023 Stanford RCT (Huberman / Spiegel) found this beat mindfulness meditation for lowering cortisol and lifting mood — the fastest real-time way to calm the nervous system.',
    actions: ['1–3 sighs between deep blocks, or before a big ball / decision', 'Use it the instant anxiety or vertigo spikes', 'Pairs with the Quiet Eye for pressure moments'] },
  { n: 6, title: 'Mindfulness builds the attention muscle.',
    body: '10–20 min/day of breath focus measurably improves sustained attention over weeks. While reading dense material, set a timer and ask "did my mind wander?" — refocus without self-judgement.',
    actions: ['10–20 min daily breath focus', 'Wander-check timer while reading concalls / docs', 'Label the distraction, return to the task'] },
  { n: 7, title: 'Deliberate practice = mental representations at the edge.',
    body: 'Ericsson\'s core finding (Peak): expertise is not hours — it is near-maximal effort just BEYOND your current ability, with feedback and reflection, repeated. Its real product is richer mental representations — the detailed internal models that let experts see patterns and plan ahead. A coach or feedback source accelerates this hugely.',
    actions: ['Practice at the edge of comfort, not inside it', 'Get feedback — a coach, a mentor, or a measured metric', 'Reflect and update after every rep; do not just repeat'] },
  { n: 8, title: 'Run the tight practice loop.',
    body: 'Learn ONE concept → apply it immediately → get feedback → correct the error → repeat. A few focused loops beat hours of passive reading.',
    actions: [
      'Cricket: isolate ONE technical flaw per session and drill only that.',
      'Investing: one company / one concall, deeply — then journal the thesis.',
      'IT: read a feature 20 min → build a tiny project → fix errors → teach it back.',
    ] },
  { n: 9, title: 'Break the skill down, attack the weakest link.',
    body: 'Split each craft into sub-skills, pinpoint the exact gap — slow footwork, weak valuation, shaky system design — and spend most reps there. Targeted practice compounds; vague practice does not.',
    actions: ['List sub-skills per arena', 'Rate yourself 1–10 on each monthly', 'Most reps on the lowest score'] },
  { n: 10, title: 'Learn fast: recall, spacing, interleaving, teaching.',
    body: 'The four highest-yield learning methods in cognitive science. Test yourself instead of rereading; review at increasing intervals; mix related topics; explain to expose gaps.',
    actions: ['Active recall: quiz yourself, do not reread', 'Spaced repetition for facts / formulas / patterns', 'Interleave drills; teach one thing you learned each week'] },
  { n: 11, title: 'Study the film — yours and the masters\'.',
    body: 'Observation accelerates everything. Watch experts and, crucially, your OWN record — looking for the if/then decisions behind their actions.',
    actions: [
      'Cricket: review your dismissals + a great player\'s technique.',
      'Investing: keep a trade journal; review winners and losers monthly (ties to Cadence).',
      'IT: read excellent codebases and incident post-mortems.',
    ] },
  { n: 12, title: 'Make the right action automatic.',
    body: 'Repeat the correct rep until it is button-press reflexive — a defensive shot, a position-sizing rule, a refactor pattern. Automaticity frees your attention for judgement under pressure.',
    actions: ['Drill correct form slowly, then at speed', 'Codify rules so execution needs no deliberation', 'Quality reps only — do not practice mistakes'] },
  { n: 13, title: 'Sleep IS practice — skills consolidate overnight.',
    body: 'Motor skills keep improving AFTER you practice, during sleep: slow-wave sleep early in the night and REM late drive "offline" gains, and the improvement is sleep-dependent, not just time-dependent. Practising hard then sleeping literally makes you better by morning. Naps help too.',
    actions: ['Fixed sleep + wake window; 7.5–9 h', 'Practise a skill, then protect that night\'s sleep', 'Treat lost sleep as a performance loss, not extra work (reinforces About Me A1)'] },
  { n: 14, title: 'Train the body for the brain (and the cricket).',
    body: 'Exercise improves blood flow, memory, and processing speed — and is the base for cricket fitness. Strength 3–4×/week, cardio 2–3×, sprint / agility 1–2×.',
    actions: ['Strength 3–4×, cardio 2–3×, sprint / agility 1–2× weekly', 'Agility-ladder + footwork doubles as reflex work', 'Daily 20–30 min movement minimum'] },
  { n: 15, title: 'Fuel and hydrate for cognition.',
    body: 'Protein, omega-3s (fish, flax), fruit, vegetables, nuts, and water support reaction time and focus. Limit excess sugar, alcohol, and ultra-processed food. Caffeine helps alertness but too much raises anxiety and cuts concentration.',
    actions: ['Protein + omega-3 daily; hydrate consistently', 'Cut sugar spikes before deep work / matches', 'Caffeine in moderation — dose, do not overdose'] },
];

// ═══════════════════════════════════════════════════════════════════════════
// STRESS & RESILIENCE — handle pressure the evidence-based way
// ═══════════════════════════════════════════════════════════════════════════
const STRESS: LifeRule[] = [
  { n: 1, title: 'The 3-step circuit for any stress spike.',
    body: 'When stress hits — a red portfolio, a missed task, a kid melting down, a vertigo wave, a bad over — run the same portable circuit: STOP → NAME → CHOOSE. It works because it puts the thinking brain back online before you act.',
    actions: [
      'STOP: 1–3 physiological sighs (two inhales, one long exhale).',
      'NAME: label the feeling — "I feel anxious / angry / ashamed".',
      'CHOOSE: pick ONE next action you actually control, and do only that.',
    ] },
  { n: 2, title: 'Name it to tame it.',
    body: 'Putting a feeling into words measurably lowers the brain\'s threat response (affect labelling). Naming the emotion — instead of being swept by it — is the fastest cognitive off-ramp from a spiral.',
    actions: ['Say it plainly: "this is anxiety / frustration / fear"', 'Name the trigger too: "stock down → fear of being wrong"', 'Naming creates the gap between feeling and reaction'] },
  { n: 3, title: 'The physiological sigh — your fastest reset.',
    body: 'Two short inhales through the nose, one long exhale through the mouth. A 2023 Stanford RCT found cyclic sighing beat meditation for lowering cortisol and lifting mood in real time. This is your front-line tool for vertigo spikes, market drops, and pre-confrontation nerves.',
    actions: ['1–3 sighs the instant stress rises', 'Use before reacting to a falling stock or a child', 'Longer exhale than inhale is the active ingredient'] },
  { n: 4, title: 'Reappraise: stress is mobilisation, not failure.',
    body: 'Cognitive reappraisal — reframing what a situation means — reliably lowers negative emotion. A racing heart is your body delivering oxygen and focus, not proof you are failing. "I can handle this" changes the physiology, not just the mood.',
    actions: ['Read stress symptoms as energy / readiness', 'Reframe a falling stck as a known cost of the game, not a verdict on you', 'Ask: "what would I tell a friend in this exact spot?"'] },
  { n: 5, title: 'Accept the wave — don\'t add a second arrow.',
    body: 'Acceptance and reappraisal are complementary. Fighting a feeling ("I shouldn\'t feel this") adds a second layer of suffering on top of the first. Let the wave of stress be present; it peaks and passes faster when you stop bracing against it. This is especially true for vertigo — resistance amplifies the sensation.',
    actions: ['Allow the feeling without judging it', 'Drop the "I shouldn\'t be stressed" story', 'Ride it out — discomfort is not danger'] },
  { n: 6, title: 'Control what you can; release the rest.',
    body: 'Most of your stressors — the market, others\' opinions, a child\'s mood, when vertigo strikes — are outside your control. Anxiety lives in the gap between what you want to control and what you can. Pour energy into your actions, preparation, breathing, and next step; let go of the rest. (Reinforces Life L10.)',
    actions: ['IN your control: prep, reaction, rules, breath, effort', 'NOT in your control: outcomes, others, markets, the past', 'Act on the first list; make peace with the second'] },
  { n: 7, title: 'Market-drawdown protocol.',
    body: 'A falling portfolio is a visceral, physical event — loss aversion makes losses hurt about twice as much as equivalent gains, and the urge to sell at the bottom is the most destructive instinct in investing (in 2008 those who sold at peak fear missed the ~400% rally that followed). Your written rules exist precisely so panic never makes the decision.',
    actions: ['Obey the Playbook exits — no in-the-moment, intraday selling',
      'Decisions at EOD only; the system runs on closes, not feelings',
      'Re-read your "enough" (Life L16) — a drawdown does not change the plan'] },
  { n: 8, title: 'Parenting stress — borrow calm, don\'t broadcast panic.',
    body: 'A child regulates by borrowing your nervous system (co-regulation) — your calm is literally the tool that settles them. Regulate yourself FIRST: breathe, drop your voice, get your thinking brain back online, then respond. "Naughty" behaviour is usually a child being a child, not an emergency.',
    actions: ['Breathe and lower your voice before you speak', 'Stay physically close and calm — presence over lecture', 'Repair afterwards; you are modelling regulation, not perfection'] },
  { n: 9, title: 'Break the vertigo–anxiety loop.',
    body: 'Vertigo triggers anxiety, and anxiety sharpens the vestibular sensation — a self-feeding loop. You break it at the anxiety end: slow-exhale breathing, sensory grounding, and acceptance rather than fighting the spin. (This is coping — see a doctor for the underlying vestibular cause.)',
    actions: ['Slow-exhale breathing (4 in, 6 out) when it starts',
      'Grounding: name 5 things you see, 4 you hear, 3 you feel',
      'Accept the sensation instead of bracing — bracing feeds it'] },
  { n: 10, title: 'Separate your worth from the outcome.',
    body: 'A bad over, a red day, a missed task, a shipped bug — these are events, not verdicts on who you are. The missed-task spiral ("I\'m not good enough") is the real damage, not the missed task. Self-compassion — treating yourself like a friend — builds resilience and steadier motivation than self-attack. (Reinforces Life L13.)',
    actions: ['After a setback: "what went wrong, what did I learn, next step?"',
      'Ban the "I am not good enough" loop — it is the enemy',
      'You are not your worst moment of the day'] },
  { n: 11, title: 'When people misread your intent.',
    body: 'You can control your actions and your integrity — not how others interpret them. When you mean well and people assume otherwise, the cleanest move is to act with good intent, communicate clearly, and release the need to be understood by everyone. Some will misread you; that is about them, not your worth. (Ties Relationships R12 + Life L10.)',
    actions: ['Act on intent + clear communication; then let go', 'Do not contort yourself to fix every misperception', 'Keep the people who see you accurately close'] },
  { n: 12, title: 'Build the buffer so stress lands softer.',
    body: 'Acute tools handle the spike; the buffer decides how hard it hits. Sleep, exercise, sunlight, real relationships and genuine time off raise your stress threshold. Chronic overload shrinks the buffer — which is why family, cricket, work and markets all feel heavier at once. Rebuild it deliberately.',
    actions: ['Protect sleep + movement first — they set the baseline',
      'One real, screen-free connection daily (family counts most)',
      'Schedule recovery like a task; a rested you handles everything better'] },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTIONS (table of contents)
// ═══════════════════════════════════════════════════════════════════════════
const SECTIONS: Array<{ id: string; label: string; cat?: RuleCat | 'ABOUT' | 'LIFE'; range?: string; accent?: string }> = [
  { id: 'engine',     label: '⚙ Decision Engine' },
  { id: 'cadence',    label: '🗓 Review Cadence',  accent: CYAN   },
  { id: 'entry',      label: '🟢 Entry Rules',     cat: 'ENTRY',     range: '1–5',   accent: CYAN   },
  { id: 'exit',       label: '🔴 Exit Rules',      cat: 'EXIT',      range: '6–10',  accent: RED    },
  { id: 'position',   label: '🟣 Position',        cat: 'POSITION',  range: '11–13', accent: PURPLE },
  { id: 'portfolio',  label: '🔵 Portfolio',       cat: 'PORTFOLIO', range: '14–17', accent: BLUE   },
  { id: 'behavior',   label: '🟠 Behavior',        cat: 'BEHAVIOR',  range: '18–20', accent: ORANGE },
  { id: 'discovery',  label: '🟢 Discovery',       cat: 'DISCOVERY', range: '21',    accent: GREEN  },
  { id: 'summary',    label: '📜 System Summary',  accent: GREEN },
  { id: 'about-me',   label: '🌿 About Me',        cat: 'ABOUT',     range: 'A1–A5', accent: ROSE   },
  { id: 'life-sat',   label: '🌅 Life Satisfaction', cat: 'LIFE',    range: 'L1–L16', accent: PEACH },
  { id: 'relationships', label: '🤝 Relationships',  range: 'R1–R12', accent: TEAL },
  { id: 'mastery',    label: '🏏 Peak Performance', range: 'M1–M15', accent: LIME },
  { id: 'stress',     label: '🧘 Stress & Resilience', range: 'S1–S12', accent: SKY },
];

export default function PlaybookPage() {
  const [holdings, setHoldings] = useState<HoldingState[]>([]);
  const [addTicker, setAddTicker] = useState('');

  // PATCH 1086 — about-me anchor scroll. Direct-URL hashes (e.g.
  // /playbook#about-me) were landing at the top of the page because the
  // sections below the fold mount after first paint; the browser had nothing
  // to scroll to when it processed the hash. This effect re-applies the hash
  // after a short delay so any anchor — about-me, life-sat, cadence,
  // relationships, mastery, stress — scrolls into view on direct navigation.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const t = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let saved: HoldingState[] = [];
    try { saved = JSON.parse(localStorage.getItem('mc:playbook:states:v1') || '[]'); } catch {}
    let portfolio: string[] = [];
    try {
      const port = JSON.parse(localStorage.getItem('mc:portfolio:v3') || localStorage.getItem('mc:portfolio:v2') || localStorage.getItem('mc:portfolio:v1') || '[]');
      if (Array.isArray(port)) portfolio = port.map((p: any) => (p?.ticker || p?.symbol || '').toUpperCase()).filter(Boolean);
    } catch {}
    const savedMap = new Map(saved.map(h => [h.ticker, h]));
    const merged: HoldingState[] = portfolio.map(t =>
      savedMap.get(t) || { ticker: t, state: 'HOLD' as State, closesBelow50: 0, absorption: false, thesisIntact: true, fourthCandleGreen: undefined, brokeBelowBreakdownLow: undefined, updatedAt: Date.now() }
    );
    saved.forEach(h => { if (!merged.find(m => m.ticker === h.ticker)) merged.push(h); });
    setHoldings(merged);
  }, []);

  function persist(next: HoldingState[]) {
    setHoldings(next);
    try { localStorage.setItem('mc:playbook:states:v1', JSON.stringify(next)); } catch {}
  }
  function updateHolding(ticker: string, patch: Partial<HoldingState>) {
    persist(holdings.map(h => h.ticker === ticker ? { ...h, ...patch, updatedAt: Date.now() } : h));
  }
  function addManual() {
    const t = addTicker.trim().toUpperCase();
    if (!t || holdings.find(h => h.ticker === t)) { setAddTicker(''); return; }
    persist([...holdings, { ticker: t, state: 'HOLD', closesBelow50: 0, absorption: false, thesisIntact: true, fourthCandleGreen: undefined, brokeBelowBreakdownLow: undefined, updatedAt: Date.now() }]);
    setAddTicker('');
  }

  const counts = useMemo(() => {
    const c = { HOLD: 0, WATCH: 0, EXIT: 0 } as Record<State, number>;
    holdings.forEach(h => { c[classify(h).state]++; });
    return c;
  }, [holdings]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '28px 24px', color: TEXT, fontVariantNumeric: 'tabular-nums' }}>
      {/* HEADER */}
      <div style={{
        marginBottom: 20, padding: '16px 20px',
        backgroundColor: CARD_BG, border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${PURPLE}`, borderRadius: 12,
        display: 'flex', alignItems: 'baseline', gap: 18, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: F.h1, fontWeight: 900, color: PURPLE, letterSpacing: 0.5 }}>📖 PLAYBOOK</span>
        <span style={{ fontSize: F.lg, color: TEXT, fontWeight: 700, letterSpacing: 0.4 }}>· INVESTMENT + LIFE OPERATING SYSTEM</span>
        <span style={{ fontSize: F.sm, color: MUTED, fontWeight: 600 }}>21 investment rules · 5 personal rules · 16 life principles · 12 relationship rules · review cadence · single page</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <Pill color={GREEN}  label={`HOLD ${counts.HOLD}`}   />
          <Pill color={YELLOW} label={`WATCH ${counts.WATCH}`} />
          <Pill color={RED}    label={`EXIT ${counts.EXIT}`}   />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 24, alignItems: 'start' }}>
        {/* MAIN */}
        <div>
          {/* DECISION ENGINE */}
          <SectionAnchor id="engine" />
          <SectionHeader title="DECISION ENGINE — live state machine" sub="For each holding mark the 4 inputs the rule engine needs. State + firing rule shown live." color={PURPLE} />
          <DecisionEngineCard
            holdings={holdings} updateHolding={updateHolding} persist={persist}
            addTicker={addTicker} setAddTicker={setAddTicker} onAdd={addManual}
          />

          {/* REVIEW CADENCE */}
          <SectionAnchor id="cadence" />
          <SectionHeader title="REVIEW CADENCE — how often to look" sub="Daily = detect · Weekly = enforce caps · Monthly = audit theses · Quarterly = step back" color={CYAN} />
          <div style={{ marginBottom: 12, padding: '12px 16px', backgroundColor: `${CYAN}0A`, border: `1px solid ${CYAN}40`, borderLeft: `4px solid ${CYAN}`, borderRadius: 10, fontSize: F.md, color: TEXT, lineHeight: 1.55 }}>
            Over-checking is a tax on both returns and peace of mind. Every task below has exactly <strong style={{ color: CYAN }}>one</strong> rhythm — do it then, not before. The portfolio gets a quick <strong style={{ color: CYAN }}>daily</strong> detection pass and a full deep audit only <strong style={{ color: CYAN }}>once a month</strong>.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {CADENCE.map(b => <CadenceCard key={b.freq} bucket={b} />)}
          </div>

          {/* INVESTMENT RULES */}
          {(['ENTRY','EXIT','POSITION','PORTFOLIO','BEHAVIOR','DISCOVERY'] as RuleCat[]).map(cat => {
            const meta = SECTIONS.find(s => s.cat === cat)!;
            const rules = RULES.filter(r => r.cat === cat);
            const titles: Record<RuleCat, string> = {
              ENTRY: 'when to buy', EXIT: 'when to sell', POSITION: 'how to hold',
              PORTFOLIO: 'construction limits', BEHAVIOR: 'meta-rules', DISCOVERY: 'finding the next mover',
            };
            return (
              <div key={cat}>
                <SectionAnchor id={meta.id} />
                <SectionHeader title={`${cat} RULES — ${titles[cat]}`} sub={`Rules ${meta.range}`} color={CAT_COLOR[cat]} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                  {rules.map(r => <RuleCard key={r.n} rule={r} />)}
                </div>
              </div>
            );
          })}

          {/* SYSTEM SUMMARY */}
          <SectionAnchor id="summary" />
          <SectionHeader title="ONE-LINE SYSTEM SUMMARY" color={GREEN} />
          <div style={{ marginBottom: 16, padding: '16px 20px', backgroundColor: `${GREEN}0A`, border: `1px solid ${GREEN}40`, borderLeft: `4px solid ${GREEN}`, borderRadius: 10 }}>
            <div style={{ fontSize: F.lg, color: TEXT2, fontStyle: 'italic', lineHeight: 1.55, fontWeight: 600 }}>
              &quot;I run a disciplined trend-following portfolio where exits trigger only on capital loss (−13%),
              structural breakdown (3 closes &lt; 50DMA without absorption), or fundamental deterioration. Winners run uncapped;
              losers cut fast. Sizing, sector and theme caps enforce diversification. Behavior is rules-based — execution
              EOD only, no intraday, no social media for signal. Discovery starts with movers on red days.&quot;
            </div>
          </div>
          <div style={{ marginBottom: 32, padding: '12px 16px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${CYAN}`, borderRadius: 8, fontSize: F.sm, color: MUTED, lineHeight: 1.5 }}>
            <strong style={{ color: CYAN, fontSize: F.sm, fontWeight: 800 }}>WHAT YOU NOW HAVE — </strong>
            A state-machine portfolio system, not a discretionary checklist. A rules engine, not a psychological guideline.
            One operating manual, not multiple overlapping rules. Behaves like a hedge-fund risk desk.
          </div>

          {/* ABOUT ME */}
          <SectionAnchor id="about-me" />
          <SectionHeader title="ABOUT ME — life operating rules" sub="Health · structure · PERMA · wiring · happiness metrics" color={ROSE} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {ABOUT_ME.map(r => <LifeCard key={r.n} rule={r} prefix="A" accent={ROSE} />)}
          </div>

          {/* LIFE SATISFACTION */}
          <SectionAnchor id="life-sat" />
          <SectionHeader title="LIFE SATISFACTION — wellbeing principles" sub="12 evergreen + 4 self-additions (self-compassion · emotion regulation · environment · enough)" color={PEACH} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
            {LIFE_SAT.map(r => <LifeCard key={r.n} rule={r} prefix="L" accent={PEACH} />)}
          </div>

          {/* RELATIONSHIPS & CHARACTER */}
          <SectionAnchor id="relationships" />
          <SectionHeader title="RELATIONSHIPS & CHARACTER — how to be someone people feel better around" sub="Respect · reliability · listening · interest · integrity · presence" color={TEAL} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {RELATIONSHIPS.map(r => <LifeCard key={r.n} rule={r} prefix="R" accent={TEAL} />)}
          </div>
          <div style={{ marginBottom: 24, padding: '14px 18px', backgroundColor: `${TEAL}08`, border: `1px solid ${TEAL}40`, borderLeft: `4px solid ${TEAL}`, borderRadius: 10 }}>
            <div style={{ fontSize: F.lg, color: TEXT2, fontStyle: 'italic', lineHeight: 1.6, fontWeight: 600 }}>
              The short rule: be the kind of person people feel better around after talking to you.
            </div>
            <div style={{ fontSize: F.sm, color: MUTED, lineHeight: 1.55, marginTop: 8 }}>
              <strong style={{ color: TEAL }}>Vasudhaiva Kutumbakam</strong> — the world is one family — and the Golden Rule found across cultures say the same thing: treat others with the dignity and compassion you would want for yourself. Trustworthy, respectful, kind, dependable and genuinely interested beats charisma, appearance or status every time.
            </div>
          </div>

          {/* PEAK PERFORMANCE */}
          <SectionAnchor id="mastery" />
          <SectionHeader title="PEAK PERFORMANCE — reflexes · focus · mastery" sub="Evidence-based, tuned for cricket · investing · IT — train the engine, not just the hours" color={LIME} />
          <div style={{ marginBottom: 16, padding: '14px 18px', backgroundColor: `${LIME}0A`, border: `1px solid ${LIME}40`, borderLeft: `4px solid ${LIME}`, borderRadius: 10 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: LIME, letterSpacing: 0.4, marginBottom: 8 }}>📅 THE DAILY PLAN TO WIN</div>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {[
                'Morning: 10 min mindfulness + 20–30 min movement (cardio or strength).',
                'Reps: 15–30 min reflex / skill drills (reaction ball, footwork, throwdowns) — finish with one anticipation / quiet-eye rep.',
                'Deep block 1: 60–90 min single-task — research a company or build / ship code. Phone in another room.',
                'Deep block 2: 60–90 min — the deliberate-practice loop on ONE weakness, at the edge of your ability, with feedback.',
                'Evening: review the film (trade journal / your footage / a post-mortem) + active recall.',
                'Night: 7.5–9 h sleep, no screens the last hour — sleep consolidates the day\'s skills.',
              ].map((a, i) => (
                <li key={i} style={{ fontSize: F.md, color: TEXT, lineHeight: 1.55, padding: '4px 0 4px 18px', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0, color: LIME, fontWeight: 900 }}>›</span>{a}
                </li>
              ))}
            </ul>
            <div style={{ fontSize: F.sm, color: MUTED, fontStyle: 'italic', marginTop: 10, lineHeight: 1.5 }}>
              Reflexes, focus and expertise are not talent — they are sleep + physical training + deliberate practice + distraction-free deep work + systematic review, repeated over months. Same engine wins the crease, the screen, and the terminal.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {MASTERY.map(r => <LifeCard key={r.n} rule={r} prefix="M" accent={LIME} />)}
          </div>

          {/* STRESS & RESILIENCE */}
          <SectionAnchor id="stress" />
          <SectionHeader title="STRESS & RESILIENCE — handle pressure the evidence-based way" sub="Markets · missed tasks · parenting · vertigo · cricket · work · family" color={SKY} />
          <div style={{ marginBottom: 16, padding: '14px 18px', backgroundColor: `${SKY}0A`, border: `1px solid ${SKY}40`, borderLeft: `4px solid ${SKY}`, borderRadius: 10 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: SKY, letterSpacing: 0.4, marginBottom: 8 }}>🧘 THE ONE CIRCUIT TO REMEMBER</div>
            <div style={{ fontSize: F.lg, color: TEXT2, fontWeight: 700, lineHeight: 1.5 }}>STOP (sigh) → NAME the feeling → CHOOSE one action you control.</div>
            <div style={{ fontSize: F.sm, color: MUTED, lineHeight: 1.55, marginTop: 8 }}>
              The same three steps work for a falling stock, a missed task, a child melting down, a vertigo wave, a tough over, or a hard moment at home. Stress is not the enemy — an unmanaged stress reaction is. You can be calm under pressure and still care deeply.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {STRESS.map(r => <LifeCard key={r.n} rule={r} prefix="S" accent={SKY} />)}
          </div>

          {/* CLOSING NOTE */}
          <div style={{ marginBottom: 24, padding: '14px 18px', backgroundColor: `${ROSE}08`, border: `1px solid ${ROSE}40`, borderLeft: `4px solid ${ROSE}`, borderRadius: 10 }}>
            <div style={{ fontSize: F.lg, color: TEXT2, fontStyle: 'italic', lineHeight: 1.6, fontWeight: 600 }}>
              The 21 investment rules are how I win the game. The 5 + 16 life rules are why winning matters.
              The first set is for the next decade of compounding. The second set is so I&apos;m still around — present, healthy,
              loved — when the compounding pays off.
            </div>
          </div>
        </div>

        {/* STICKY TOC */}
        <nav style={{ position: 'sticky', top: 20, alignSelf: 'start' }}>
          <div style={{ padding: '14px 16px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10 }}>
            <div style={{ fontSize: F.xs, fontWeight: 800, color: MUTED, letterSpacing: 0.6, marginBottom: 12 }}>ON THIS PAGE</div>
            {SECTIONS.map(s => (
              <a key={s.id} href={`#${s.id}`} style={{
                display: 'block', padding: '7px 0', fontSize: F.sm, fontWeight: 700,
                color: s.accent || TEXT, textDecoration: 'none', letterSpacing: 0.3,
                borderBottom: `1px solid ${BORDER}`,
              }}>
                {s.label}
                {s.range && <span style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginLeft: 6 }}>{s.range}</span>}
              </a>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: '10px 14px', backgroundColor: `${PURPLE}10`, border: `1px solid ${PURPLE}40`, borderRadius: 8, fontSize: F.xs, color: PURPLE, fontWeight: 700, letterSpacing: 0.3, lineHeight: 1.5 }}>
            📌 Bookmark this page.<br/>Re-read weekly.
          </div>
        </nav>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════
function SectionAnchor({ id }: { id: string }) { return <div id={id} style={{ scrollMarginTop: 20 }} />; }

function SectionHeader({ title, sub, color }: { title: string; sub?: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '24px 0 12px 0', flexWrap: 'wrap' }}>
      <span style={{ fontSize: F.h2, fontWeight: 900, color, letterSpacing: 0.6 }}>{title}</span>
      {sub && <span style={{ fontSize: F.sm, color: MUTED, fontWeight: 600 }}>· {sub}</span>}
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}50, transparent)`, marginLeft: 8 }} />
    </div>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return <span style={{ fontSize: F.sm, fontWeight: 800, color, border: `1px solid ${color}50`, backgroundColor: `${color}18`, padding: '4px 12px', borderRadius: 5, letterSpacing: 0.4 }}>{label}</span>;
}

function RuleCard({ rule }: { rule: Rule }) {
  const color = CAT_COLOR[rule.cat];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '56px 1fr', gap: 16,
      padding: '14px 18px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`,
      borderLeft: `4px solid ${color}`, borderRadius: 10,
    }}>
      <div style={{ fontSize: F.ruleNum, fontWeight: 900, color, letterSpacing: -0.5, lineHeight: 1, alignSelf: 'start' }}>{rule.n}</div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: F.lg, fontWeight: 800, color: TEXT2, letterSpacing: 0.2 }}>{rule.title}</span>
          <span style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 3, backgroundColor: `${color}18`, border: `1px solid ${color}40` }}>{rule.cat}</span>
        </div>
        <div style={{ fontSize: F.md, color: TEXT, lineHeight: 1.55 }}>{rule.body}</div>
      </div>
    </div>
  );
}

function LifeCard({ rule, prefix, accent }: { rule: LifeRule; prefix: string; accent: string }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '64px 1fr', gap: 16,
      padding: '16px 20px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`,
      borderLeft: `4px solid ${accent}`, borderRadius: 10,
    }}>
      <div style={{ fontSize: F.ruleNum, fontWeight: 900, color: accent, letterSpacing: -0.5, lineHeight: 1, alignSelf: 'start' }}>{prefix}{rule.n}</div>
      <div>
        <div style={{ fontSize: F.lg, fontWeight: 800, color: TEXT2, letterSpacing: 0.2, marginBottom: 6 }}>{rule.title}</div>
        <div style={{ fontSize: F.md, color: TEXT, lineHeight: 1.55, marginBottom: rule.actions ? 10 : 0 }}>{rule.body}</div>
        {rule.actions && (
          <ul style={{ margin: '4px 0 0 0', paddingLeft: 0, listStyle: 'none' }}>
            {rule.actions.map((a, i) => (
              <li key={i} style={{ fontSize: F.sm, color: MUTED, lineHeight: 1.5, padding: '3px 0 3px 16px', position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, color: accent, fontWeight: 900 }}>›</span>
                {a}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CadenceCard({ bucket }: { bucket: CadenceBucket }) {
  return (
    <div style={{ padding: '14px 18px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${bucket.accent}`, borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.h2, fontWeight: 900, color: bucket.accent, letterSpacing: 0.6 }}>{bucket.freq}</span>
        <span style={{ fontSize: F.sm, color: MUTED, fontWeight: 700, letterSpacing: 0.3 }}>{bucket.when}</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
        {bucket.checks.map((c, i) => (
          <li key={i} style={{ fontSize: F.md, color: TEXT, lineHeight: 1.55, padding: '4px 0 4px 18px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: 0, color: bucket.accent, fontWeight: 900 }}>›</span>
            {c}
          </li>
        ))}
      </ul>
      {bucket.note && (
        <div style={{ marginTop: 10, fontSize: F.sm, color: bucket.accent, fontStyle: 'italic', fontWeight: 600, lineHeight: 1.5 }}>{bucket.note}</div>
      )}
    </div>
  );
}

function DecisionEngineCard({ holdings, updateHolding, persist, addTicker, setAddTicker, onAdd }:
  { holdings: HoldingState[]; updateHolding: (t: string, p: Partial<HoldingState>) => void; persist: (n: HoldingState[]) => void; addTicker: string; setAddTicker: (s: string) => void; onAdd: () => void }) {
  if (holdings.length === 0) {
    return (
      <div style={{ padding: '20px 22px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${PURPLE}`, borderRadius: 10, marginBottom: 24 }}>
        <div style={{ fontSize: F.md, color: TEXT, lineHeight: 1.55, marginBottom: 12 }}>
          No portfolio detected. Either upload portfolio tickers in <a href="/portfolio" style={{ color: CYAN, fontWeight: 700 }}>/portfolio</a>,
          or add tickers manually below to run the state machine.
        </div>
        <ManualAdd addTicker={addTicker} setAddTicker={setAddTicker} onAdd={onAdd} />
      </div>
    );
  }
  return (
    <div style={{ padding: '16px 18px', backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${PURPLE}`, borderRadius: 10, marginBottom: 24 }}>
      <div style={{ fontSize: F.sm, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
        For each holding mark the four inputs the engine needs. Engine classifies into HOLD / WATCH / EXIT and tells you the rule that fired. Run this at EOD.
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(90px,110px) 70px 70px 80px 80px 80px 80px 90px 1fr',
        gap: 8, fontSize: F.xs, color: MUTED, fontWeight: 800, letterSpacing: 0.4,
        padding: '6px 8px', borderBottom: `1px solid ${BORDER}`,
      }}>
        <span>TICKER</span><span>P&amp;L %</span><span>3-CLOSE&lt;50</span><span>ABSORB</span><span>4TH GREEN</span><span>LOW BROKEN</span><span>THESIS</span><span>STATE</span><span>REASON · ACTION</span>
      </div>
      {holdings.map(h => {
        const cls = classify(h);
        return (
          <div key={h.ticker} style={{
            display: 'grid', gridTemplateColumns: 'minmax(90px,110px) 70px 70px 80px 80px 80px 80px 90px 1fr',
            gap: 8, alignItems: 'center', fontSize: F.sm, padding: '8px', borderBottom: `1px solid ${BORDER}60`,
          }}>
            <span style={{ fontWeight: 800, color: TEXT2, letterSpacing: 0.3 }}>{h.ticker}</span>
            <input type="number" value={h.pnlPct ?? ''} onChange={e => updateHolding(h.ticker, { pnlPct: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="—" style={inputStyle()} />
            <select value={h.closesBelow50} onChange={e => updateHolding(h.ticker, { closesBelow50: Number(e.target.value) })} style={selectStyle()}>
              <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3+</option>
            </select>
            <ToggleChip value={h.absorption}   onToggle={() => updateHolding(h.ticker, { absorption:   !h.absorption })}   onLabel="YES" offLabel="NO"     onColor={CYAN}  offColor={MUTED} />
            <TriToggleChip
              value={h.fourthCandleGreen}
              onCycle={() => updateHolding(h.ticker, { fourthCandleGreen: cycleTri(h.fourthCandleGreen) })}
              onLabel="GREEN" offLabel="RED" naLabel="N/A"
              onColor={GREEN} offColor={RED} naColor={MUTED}
            />
            <TriToggleChip
              value={h.brokeBelowBreakdownLow}
              onCycle={() => updateHolding(h.ticker, { brokeBelowBreakdownLow: cycleTri(h.brokeBelowBreakdownLow) })}
              onLabel="YES" offLabel="NO" naLabel="N/A"
              onColor={RED} offColor={GREEN} naColor={MUTED}
            />
            <ToggleChip value={h.thesisIntact} onToggle={() => updateHolding(h.ticker, { thesisIntact: !h.thesisIntact })} onLabel="OK"  offLabel="BROKEN" onColor={GREEN} offColor={RED} />
            <span style={{ fontSize: F.sm, fontWeight: 800, color: STATE_COLOR[cls.state], padding: '4px 8px', borderRadius: 5, textAlign: 'center', letterSpacing: 0.4, backgroundColor: `${STATE_COLOR[cls.state]}18`, border: `1px solid ${STATE_COLOR[cls.state]}40` }}>{STATE_ICON[cls.state]} {cls.state}</span>
            <span style={{ fontSize: F.xs, color: MUTED, lineHeight: 1.4 }}>{cls.reason}</span>
          </div>
        );
      })}
      <ManualAdd addTicker={addTicker} setAddTicker={setAddTicker} onAdd={onAdd} />
    </div>
  );
}

function ManualAdd({ addTicker, setAddTicker, onAdd }: { addTicker: string; setAddTicker: (s: string) => void; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
      <input value={addTicker} onChange={e => setAddTicker(e.target.value)} placeholder="ADD TICKER (e.g. NORTHARC)" onKeyDown={e => e.key === 'Enter' && onAdd()} style={{ ...inputStyle(), width: 240, padding: '6px 10px', fontSize: F.sm }} />
      <button onClick={onAdd} style={{ fontSize: F.sm, fontWeight: 800, padding: '6px 14px', borderRadius: 5, background: `${PURPLE}18`, border: `1px solid ${PURPLE}50`, color: PURPLE, cursor: 'pointer' }}>+ ADD</button>
    </div>
  );
}

function ToggleChip({ value, onToggle, onLabel, offLabel, onColor, offColor }: { value: boolean; onToggle: () => void; onLabel: string; offLabel: string; onColor: string; offColor: string }) {
  const c = value ? onColor : offColor;
  return (<button onClick={onToggle} style={{ fontSize: F.xs, fontWeight: 800, padding: '4px 8px', borderRadius: 4, background: `${c}18`, border: `1px solid ${c}50`, color: c, cursor: 'pointer', letterSpacing: 0.3 }}>{value ? onLabel : offLabel}</button>);
}

// PATCH 1067 — Tri-state chip cycler. Cycles between three states each click:
//   undefined (N/A) → true (YES/GREEN) → false (NO/RED) → undefined.
// Tracks a *deferred* observation: until the trader actually sees the 4th
// candle / the breakdown-low test, the field stays undefined and Rule 7
// leaves the state at WATCH. Once they record a value, classify() uses it.
export function cycleTri(v: boolean | undefined): boolean | undefined {
  if (v === undefined) return true;
  if (v === true) return false;
  return undefined;
}

function TriToggleChip({
  value, onCycle, onLabel, offLabel, naLabel, onColor, offColor, naColor,
}: {
  value: boolean | undefined;
  onCycle: () => void;
  onLabel: string; offLabel: string; naLabel: string;
  onColor: string; offColor: string; naColor: string;
}) {
  const c = value === true ? onColor : value === false ? offColor : naColor;
  const label = value === true ? onLabel : value === false ? offLabel : naLabel;
  return (
    <button
      onClick={onCycle}
      title={`Click to cycle: ${naLabel} → ${onLabel} → ${offLabel} → ${naLabel}`}
      style={{
        fontSize: F.xs, fontWeight: 800, padding: '4px 8px', borderRadius: 4,
        background: `${c}18`, border: `1px solid ${c}50`, color: c,
        cursor: 'pointer', letterSpacing: 0.3,
      }}
    >
      {label}
    </button>
  );
}

function inputStyle(): React.CSSProperties {
  return { fontSize: F.xs, padding: '4px 8px', backgroundColor: CARD2, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, width: '100%', fontVariantNumeric: 'tabular-nums' };
}
function selectStyle(): React.CSSProperties {
  return { fontSize: F.xs, padding: '4px 6px', backgroundColor: CARD2, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontWeight: 700, cursor: 'pointer' };
}
