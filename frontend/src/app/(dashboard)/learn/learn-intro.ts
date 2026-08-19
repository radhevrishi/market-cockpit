// zzz407 — First Principles (pinned flagship lesson for the Learn tab).
// Additive only — rendered as a special pinned top section; book-data.ts untouched.
// Combines the owner's own trading rules with institutional best-practice,
// each as a rule card: the rule, WHY it works, a real example, the common mistake.

export interface RuleCard {
  n: number;
  title: string;
  rule: string;
  why: string;
  example: string;
  pitfall?: string;
  tag: 'entry' | 'catalyst' | 'exit' | 'risk' | 'process' | 'psychology';
}
export interface RuleGroup { heading: string; blurb: string; cards: RuleCard[]; }

export const FP_INTRO =
  'Read this first. These are the non-negotiable operating rules — the 90% of outcomes that come from a handful of habits. The rest of the playbook teaches you HOW to analyse; this page teaches you HOW to behave. Most money is lost not from bad analysis but from good analysis executed with bad discipline: chasing weakness, acting without a catalyst, holding losers, and selling winners early. Internalise these, then let the deeper sections make you sharper.';

export const FP_TAG_META: Record<RuleCard['tag'], { label: string; color: string }> = {
  entry:      { label: 'ENTRY',      color: '#22C55E' },
  catalyst:   { label: 'CATALYST',   color: '#FBBF24' },
  exit:       { label: 'EXIT',       color: '#EF4444' },
  risk:       { label: 'RISK',       color: '#F59E0B' },
  process:    { label: 'PROCESS',    color: '#06B6D4' },
  psychology: { label: 'MINDSET',    color: '#A78BFA' },
};

export const FIRST_PRINCIPLES: RuleGroup[] = [
  {
    heading: '1 · Finding & Entering Leaders',
    blurb: 'You do not buy the cheapest stock; you buy the strongest business at a sane entry. Leadership shows up before the crowd sees it.',
    cards: [
      {
        n: 1, tag: 'entry',
        title: 'Look for strength on red days',
        rule: 'On broad down days, note what refuses to fall — those are tomorrow’s leaders.',
        why: 'Relative strength is information. When the index is red and a stock is flat or green on volume, real money is accumulating it and unwilling to sell. That divergence usually precedes a leadership move.',
        example: 'In a −2% Nifty session, if Dixon or a defence name closes green while peers bleed, that is institutions absorbing supply. Build a shortlist of "green-on-red" names each correction; they tend to break out first when the market turns.',
        pitfall: 'Don’t confuse strength with a stock that simply hasn’t reacted yet. Require volume and a reason (earnings, order win, sector tailwind) behind the resilience.',
      },
      {
        n: 2, tag: 'entry',
        title: 'Only add leaders near key moving-average pullbacks',
        rule: 'Buy strong stocks into pullbacks to the 20/50-DMA, not into vertical breakouts.',
        why: 'A leading stock in an uptrend keeps finding support at rising moving averages. Entering there gives you a tight, logical stop (just below the MA) and a far better risk/reward than chasing an extended move.',
        example: 'A stock like Astral or Polycab in a clean uptrend repeatedly pulls back to its 50-DMA and resumes. Entering on the third such pullback with a stop 3–4% below the MA risks little to make a lot; chasing +15% above the MA risks a lot to make a little.',
        pitfall: 'A pullback in a LEADER is an opportunity; the same "pullback" in a broken Stage-4 chart is a falling knife. Only apply this to stocks in confirmed uptrends.',
      },
      {
        n: 3, tag: 'entry',
        title: 'Buy strength, not weakness',
        rule: 'Add to what is working; never "bottom-fish" a downtrend hoping to be early.',
        why: 'Trends persist longer than most expect. Buying a rising leader aligns you with the dominant flow; buying a falling stock puts you against it and against every trapped holder waiting to exit at breakeven.',
        example: 'Buying DMart or Titan on strength through their multi-year uptrends compounded beautifully. Buying a "cheap" falling PSU or a de-rating story to catch the bottom usually means averaging down for two more years.',
        pitfall: 'Cheapness is not a catalyst. A stock down 60% can still fall another 60%. Wait for the base and the turn.',
      },
    ],
  },
  {
    heading: '2 · Catalysts, News & Patience',
    blurb: 'The biggest moves come from a small number of the right catalysts. Your edge is reading a lot and acting rarely — only when something real changes.',
    cards: [
      {
        n: 4, tag: 'catalyst',
        title: 'Wait for the RIGHT news — a few catalysts drive the giant moves',
        rule: 'Most news is noise; a handful of genuine catalysts create 100–200% moves. Position for those.',
        why: 'Markets re-rate violently when the earnings power or the addressable opportunity of a business structurally changes. Ordinary quarterly beats fade; a genuine inflection (new product, capacity commissioned, regulatory approval, a bottleneck breaking your way) is what compounds.',
        example: 'Moderna’s cancer-vaccine data drove an outsized single-day move because it changed the terminal opportunity, not the next quarter. Indian analogues: a pharma player getting a major USFDA/marketing approval, an EMS name winning an anchor client, or a chemical company commissioning a large new plant — each can re-rate the whole business.',
        pitfall: 'Don’t trade every headline. Ask: does this change the multi-year earnings power, or just this quarter? Only the former deserves size.',
      },
      {
        n: 5, tag: 'process',
        title: 'Act less, read more',
        rule: 'Do far more reading than trading. Most days the correct action is none.',
        why: 'Edge comes from knowing a few businesses deeply and recognising the moment the market is wrong about them. Overtrading converts that edge into brokerage, taxes, and whipsaw. Great investors are famous for long stretches of doing nothing.',
        example: 'Track 20–30 businesses closely (concalls, order books, capacity, margins). Most weeks you simply update your notes. Then a handful of times a year one of them hits an inflection or a fat pitch — and you act decisively because you were prepared.',
        pitfall: 'Boredom is not a signal. If you find yourself trading to feel productive, close the terminal and go read an annual report.',
      },
      {
        n: 6, tag: 'catalyst',
        title: 'One idea, one catalyst, one invalidation',
        rule: 'For every position, write the single reason you own it and the single thing that proves you wrong.',
        why: 'A thesis you can’t state in one sentence is a thesis you can’t manage. Naming the catalyst tells you when the move should happen; naming the invalidation tells you exactly when to leave — before emotion takes over.',
        example: '"I own X for the margin inflection as the new plant ramps; I’m wrong if utilisation stalls below 60% or gross margin doesn’t expand by Q3." Now every concall is a scoreboard, not a mood.',
        pitfall: 'If you can’t write the invalidation, you don’t have a thesis — you have a hope.',
      },
      {
        n: 7, tag: 'catalyst',
        title: 'Find the bottleneck before the earnings',
        rule: 'Map the value chain and buy the choke-point that captures the pricing power.',
        why: 'When demand surges, profits pool at whoever is capacity-constrained. Spotting the bottleneck (a scarce input, a sold-out capacity, a regulatory gate) lets you own the earnings surprise before it prints.',
        example: 'In an AI-capex wave, the bottleneck may be power/transformers or specific components, not the headline hyperscaler. In an infra push, it can be the one company with sold-out capacity for a critical product. Own the constraint, not the theme.',
        pitfall: 'Themes are crowded and priced; bottlenecks are specific and often missed. Do the value-chain work.',
      },
    ],
  },
  {
    heading: '3 · Risk, Losers & Winners',
    blurb: 'Survival first. The single largest driver of long-term returns is how you handle mistakes and how long you can sit with what is working.',
    cards: [
      {
        n: 8, tag: 'exit',
        title: 'Cut losers fast',
        rule: 'When the thesis breaks or your stop is hit, exit immediately — no negotiating.',
        why: 'Small losses are the cost of doing business; large losses end careers. A −8% loss needs +9% to recover; a −50% loss needs +100%. Cutting fast keeps every mistake survivable and keeps capital available for the next fat pitch.',
        example: 'You buy for a margin inflection; the concall reveals margins slipping and management dodging. The thesis is dead — sell that day, even at a loss. The worst outcome is "averaging down" into a broken story and turning a 10% loss into a 40% one.',
        pitfall: 'Hope and "it’ll come back" are not risk management. Pre-commit the stop and the invalidation before you buy.',
      },
      {
        n: 9, tag: 'exit',
        title: 'Don’t sell winners early',
        rule: 'Let a working thesis run; trim to manage risk, but don’t amputate compounders for a quick gain.',
        why: 'A few big winners pay for everything. Selling a 30% gain feels smart but caps your best ideas at mediocre outcomes, while your losers are unbounded — the exact opposite of what you want. Ride winners as long as the thesis and the trend hold.',
        example: 'Selling Titan or Bajaj Finance after the first double would have forfeited multibaggers. The right question is not "am I up a lot?" but "is the thesis still intact and the trend still up?" If yes, hold.',
        pitfall: 'The urge to "book profits" is loss-aversion in disguise. Manage with a trailing stop and the thesis, not with the size of the unrealised gain.',
      },
      {
        n: 10, tag: 'risk',
        title: 'Size to conviction × liquidity — never to excitement',
        rule: 'Position size = how sure you are, adjusted down for how illiquid and volatile the stock is.',
        why: 'A great idea in the wrong size is a bad trade. Microcaps swing 2–3× a large-cap; a "score 90" microcap is not the same risk as a "score 90" bluechip. Sizing by liquidity and volatility, not by how excited you feel, keeps any single mistake from being fatal.',
        example: 'Cap a thin sub-₹1,000 Cr microcap at ~1.5–2% of the book even at top conviction; a liquid large-cap compounder can carry 5–8%. Your best idea can still be a small position if it can’t be exited cleanly.',
        pitfall: 'Betting big because a story is thrilling is how one bad quarter erases a year of gains.',
      },
      {
        n: 11, tag: 'risk',
        title: 'Never average down a broken thesis — add to winners instead',
        rule: 'Add on strength and confirmation, not on falling prices and hope.',
        why: 'Adding to a loser doubles your bet that the market is wrong; adding to a winner presses a bet the market is confirming. Pyramiding into strength builds your largest positions in your best-performing ideas — exactly where you want the most capital.',
        example: 'If a leader breaks out, holds the pullback, and the next concall confirms the inflection, add a second tranche. If a "value" name keeps falling as fundamentals deteriorate, adding is just funding your own drawdown.',
        pitfall: 'Averaging down is defensible ONLY when price fell but the thesis strengthened. If the thesis weakened, averaging down is the single most expensive mistake retail makes.',
      },
      {
        n: 12, tag: 'risk',
        title: 'Cash is a position',
        rule: 'Holding cash when there is no fat pitch is a decision, not a failure.',
        why: 'You are never forced to act. Cash preserves optionality and dry powder for the rare, obvious opportunities. Forcing trades in a thin tape guarantees mediocre entries.',
        example: 'In a euphoric, expensive market with no clean setups, sitting 30–40% cash and waiting for the correction that hands you leaders near their moving averages is a strategy — not indecision.',
        pitfall: 'FOMO makes cash feel like underperformance. It isn’t; it’s ammunition.',
      },
    ],
  },
  {
    heading: '4 · Process, Valuation & Mindset',
    blurb: 'Repeatable process beats sporadic brilliance. Judge your decisions by their quality, not only their outcome.',
    cards: [
      {
        n: 13, tag: 'process',
        title: 'Price the expectations, not just the business',
        rule: 'Ask what the current price already assumes, then bet only when reality will beat that.',
        why: 'You can be right about a great company and still lose if perfection is already priced. Returns come from the gap between what happens and what was expected — variant perception — not from the quality of the business alone.',
        example: 'A stock at 60× P/E is pricing years of >25% growth. If you merely expect 20%, you have no edge even if it’s wonderful. The edge is finding where the market’s implied expectation is clearly too low (or, for shorts, too high).',
        pitfall: '"Great company" is not "great investment." Always separate the business quality from the price you’re paying for it.',
      },
      {
        n: 14, tag: 'process',
        title: 'Respect the capital cycle and base rates',
        rule: 'When everyone is expanding capacity, future returns fall; when capex dries up, the next up-cycle is born.',
        why: 'High returns invite competition, capacity floods in, and margins revert — most "structural growth" is a supercycle in disguise. Reading where an industry sits in its capital cycle prevents you from buying the top and selling the bottom.',
        example: 'Commodity chemicals, steel, and shipping repeatedly lure investors at peak margins (peak P/E illusion) right before capacity additions crush pricing. The money is made buying when capex has stopped and utilisation is about to tighten.',
        pitfall: 'Extrapolating peak-cycle margins into perpetuity is the classic cyclical trap. Ask "what is normalised?", not "what is trailing?".',
      },
      {
        n: 15, tag: 'psychology',
        title: 'Keep a decision journal — grade process, not outcome',
        rule: 'Write why you bought, your catalyst, and your invalidation; review winners and losers for process quality.',
        why: 'Good decisions can lose and bad decisions can win over short spans. Only by recording your reasoning can you separate skill from luck and actually improve. The journal is where your edge compounds.',
        example: 'A loser you cut fast on a broken thesis is a GOOD decision even though it lost money. A winner you bought with no thesis is a BAD decision even though it paid — because you’ll repeat it and eventually get hurt.',
        pitfall: 'Judging yourself only by P&L teaches you to gamble. Judge the process; the P&L follows over time.',
      },
      {
        n: 16, tag: 'psychology',
        title: 'Patience on entry and exit — mind the impact cost',
        rule: 'In smaller names, work your orders; don’t pay up to get filled or dump to get out.',
        why: 'Liquidity is a hidden tax. In thin stocks, chasing the offer or hitting the bid can cost several percent before the thesis even plays out — and in a panic, exits gap. Patience with limit orders preserves the edge you worked to find.',
        example: 'Accumulating a microcap over days with limit orders near support, rather than one market order that moves the price 4%, can be the difference between a good and a poor entry. Same discipline in reverse when exiting.',
        pitfall: 'Treating a ₹300 Cr microcap like a large-cap and market-ordering size is how you give back your alpha to the spread.',
      },
    ],
  },
];
