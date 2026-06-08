'use client';

// ============================================================================
// INVESTING OS (PATCH 1123 — v2)
// Personal investing operating system. Framework-first; interactive scored
// checklists; smart Edge Finder at the very end. Self-contained (react + Link).
// Persists checklist ticks, finder answers and locked edge to localStorage.
// ============================================================================

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';

// ---- palette ----
const C = {
  bg: '#090d13', panel: '#111722', panel2: '#0d131c', line: '#1e2733', line2: '#2b3a4d',
  txt: '#e6edf3', muted: '#8a98ab', dim: '#5b6677',
  green: '#3fb950', red: '#f85149', amber: '#d29922', blue: '#58a6ff',
  violet: '#a78bfa', cyan: '#39d0d8', teal: '#2dd4bf', lime: '#84cc16', orange: '#f0883e',
};
const F = { xs: 13, sm: 14.5, md: 16, base: 17, lg: 20, xl: 24, xxl: 32, hero: 40 };

type Rating = 'Good' | 'Neutral' | 'No edge' | '';
type StyleDef = {
  letter: string; name: string; color: string; rating: Rating;
  money: string; mind: string; focus: string[];
  subs: { tag: string; text: string }[];
  rule?: string; entry?: string; edge?: string; notes?: string[];
};

const STYLES: StyleDef[] = [
  {
    letter: 'A', name: 'Fundamental Inflection Investor', color: C.red, rating: 'Neutral',
    money: 'earnings inflections the market has not repriced yet',
    mind: 'Numbers drive price. The market reprices later — I hold through volatility for big compounders (2–10x).',
    focus: ['Business-driven, multi-quarter winners', 'Numbers lead, price lags', 'Hold through volatility'],
    subs: [
      { tag: 'MB · MultiBagger', text: 'Earnings can grow 3–5x in 3–5 years. Small/mid-cap with scalability, industry growth + market-share gain. Mostly automated (Excel upload; future NVDA/NBIS add to watchlist + forensic prompt).' },
      { tag: 'EI · Earnings Inflection', text: 'Growth is starting NOW: 2–3 quarters of rising revenue growth + improving margins. The shift from flat to strong. Automated via company name in Watchlist / Earnings tab.' },
      { tag: 'NGE · New Growth Engines', text: 'Future drivers — new product / capacity / market — that must become meaningful (20%+ of future revenue).' },
      { tag: 'ST · Structural Tailwinds', text: 'Sector growing faster than GDP, long-term demand (not cyclical). Identify themes and invest — prompts, budget, news.' },
      { tag: 'GU · Guidance Upgrades', text: 'Confirmation: management raising future outlook, analysts increasing estimates.' },
    ],
    rule: 'BUY: good AI ranking + good guidance + tailwind + management + MAF checklist. SELL: PEG > 2.',
    notes: [
      'Sell rule: respect 50/200-DMA. If it loses the 50-DMA, watch 3–4 candles — if the prior 1–3 candle low is NOT reached, hold; else exit.',
      'Find fundamentally great stocks in red markets — green on a red day flags gems (e.g. Acutaas, Nebius).',
      'Titan/Gold-type big-TAM stories: keep on the radar always.',
    ],
  },
  {
    letter: 'B', name: 'Special Situation Investor', color: C.orange, rating: 'Good',
    money: 'event-driven mispricings before the catalyst plays out',
    mind: 'Price moves on events, not earnings. I buy the mispricing before the catalyst plays out (hold 6–24 months).',
    focus: ['Event-driven mispricing', 'Valuation + catalyst', 'Medium holding period'],
    subs: [
      { tag: 'SPIN · Spin-offs', text: 'Conglomerate discount → breakup unlocks value. Forced selling creates mispricing.' },
      { tag: 'M&A · Open Offers', text: 'Offer price = a valuation signal. New promoter → re-rating.' },
      { tag: 'TURN · Turnarounds', text: 'Loss → profit shift, margins improving, buybacks / debt reduction, better capital discipline.' },
      { tag: 'CAP · Capital Allocation', text: 'Capital-allocation shift drives efficiency and re-rating.' },
    ],
    rule: 'SPIN → hidden value · M&A → control change · TURN → recovery · CAP → efficiency.',
    entry: 'Buy only with a clear catalyst, visible mispricing, and limited downside.',
    edge: 'Others wait for earnings — you act on the event + catalyst. (BUY: good AI ranking = buy.)',
    notes: [
      'FII-buying stocks get special focus (Bajaj Consumer & MCX type).',
      'Follow budget + themes closely; focus on the NEW — new product, new branding, new segment — then watch.',
    ],
  },
  {
    letter: 'C', name: 'Earnings / EP Momentum Trader', color: C.lime, rating: 'No edge',
    money: 'buying earnings strength and riding the momentum',
    mind: 'Buy strength + volume, not weakness. Follow momentum and institutional flow (Qullamaggie-style).',
    focus: ['Buy strength, not weakness', 'Volume + price expansion', 'Short–medium term'],
    subs: [
      { tag: 'EP · Earnings Breakout', text: 'Big beat (20–30%+) and the stock breaks out on high volume. EP = the trigger.' },
      { tag: 'PED · Post-Earnings Drift', text: 'Price keeps rising after earnings as institutions accumulate slowly. PED = the trend to ride.' },
      { tag: 'IS · Information Shock', text: 'Sudden positive news (orders, approvals, contracts) → sharp price + volume spike. IS = catalyst spike.' },
    ],
    entry: 'Strong move + volume, breakout confirmation, no immediate rejection.',
    edge: 'Fast-moving alpha, short holding period. Enter on: earnings blockbuster/strong + good guidance + theme OR daily movers/gainers.',
  },
  {
    letter: 'D', name: 'Technical Structure Trader', color: C.blue, rating: 'No edge',
    money: 'clean technical breakouts out of tight bases',
    mind: 'I trust price structure over narrative and wait for clean setups. Compression → expansion.',
    focus: ['Pattern-driven entries', 'Price structure over story', 'Works in trending markets'],
    subs: [
      { tag: 'VCP', text: 'Volatility contraction — tight price compression, falling volatility → breakout setup.' },
      { tag: 'Bases', text: 'Cup & Handle / Flat Base — long consolidation, breakout after testing resistance. IPO Base — new listing consolidates then breaks out.' },
      { tag: 'Reversals', text: 'Double Bottom, Inverse Head & Shoulders.' },
      { tag: 'Continuation', text: 'Bullish Flag, Ascending Triangle, tight ranges within an uptrend. Also: Golden Cross, U-pattern, HTF, ascending bases.' },
    ],
    rule: 'Tight base = strong breakout potential. Compression precedes expansion.',
    entry: 'Clean structure, breakout with volume, no choppy price action.',
    edge: 'Ignore narratives — trade pure price structure + momentum confirmation. See charts of India leaders + Stage-2 + volume + theme.',
  },
  {
    letter: 'E', name: 'Supply–Demand / Flow Trader', color: C.cyan, rating: 'Good',
    money: 'supply–demand imbalances and liquidity squeezes',
    mind: 'I trade imbalances. Flow > fundamentals; speed is the edge.',
    focus: ['Flow-driven edge', 'Trade imbalances', 'Faster moves, higher risk'],
    subs: [
      { tag: 'BN · Bottlenecks', text: 'Supply shortage vs a sudden demand surge; a liquidity squeeze drives sharp price moves. Sourced from news, budgets, meetings.' },
    ],
    rule: 'Imbalance = opportunity. Flow beats fundamentals; speed is the edge.',
    edge: 'Profit from liquidity gaps + forced price discovery.',
  },
  {
    letter: 'F', name: 'Trend Follower (Stage-2)', color: C.violet, rating: '',
    money: 'riding established Stage-2 uptrends',
    mind: "I don't predict — I follow trend strength and capture the middle of the move.",
    focus: ['Stage-2 breakouts, pullbacks, RS leaders', 'Strength = confirmation', 'Best in strong bull markets'],
    subs: [
      { tag: 'Stage-2 Breakouts', text: 'Stock breaks a long base and starts a new uptrend phase.' },
      { tag: 'Pullbacks in Uptrend', text: 'Buy dips in strong stocks while the trend stays intact.' },
      { tag: 'RS Leaders', text: 'Outperforming the market with visible institutional accumulation.' },
    ],
    rule: 'Trend = signal, strength = confirmation, weak stocks ignored.',
    edge: 'Ride established uptrends, not reversals.',
  },
  {
    letter: 'G', name: 'Re-rating / Multiple Expansion Investor', color: C.teal, rating: '',
    money: 'valuation re-ratings as quality gets recognised',
    mind: 'I profit from valuation expansion, not just earnings growth — as the market slowly realises quality improved.',
    focus: ['Business-model shifts', 'Margin expansion', 'PE re-rating'],
    subs: [
      { tag: 'Business-Model Shift', text: 'Low-quality → scalable/high-quality model (SaaS, platform, recurring-revenue transitions).' },
      { tag: 'Margin Expansion', text: 'Operating leverage kicks in; EBITDA margins structurally improve.' },
      { tag: 'Multiple Expansion', text: 'PE re-rates upward, from "cheap" to "quality premium".' },
    ],
    rule: 'Quality improvement → re-rating. Earnings + multiple expansion = outsized returns.',
  },
];
const RATING_COLOR: Record<string, string> = { 'Good': C.green, 'Neutral': C.amber, 'No edge': C.red, '': C.dim };
const byLetter = (l: string) => STYLES.find((s) => s.letter === l);

type FinderOpt = { label: string; styles: string[] };
const FINDER: { q: string; opts: FinderOpt[] }[] = [
  { q: '1. What gives you conviction?', opts: [
    { label: 'Financials', styles: ['A'] }, { label: 'Corporate events', styles: ['B'] },
    { label: 'Price + volume', styles: ['C'] }, { label: 'Chart patterns', styles: ['D'] },
    { label: 'Order flow / imbalance', styles: ['E'] }, { label: 'Trend strength', styles: ['F'] },
    { label: 'Valuation shift', styles: ['G'] },
  ] },
  { q: '2. Your holding comfort?', opts: [
    { label: 'Months–years', styles: ['A', 'G'] }, { label: 'Weeks–months', styles: ['B', 'F'] },
    { label: 'Days–weeks', styles: ['C', 'D', 'E'] },
  ] },
  { q: '3. What frustrates you most?', opts: [
    { label: 'Missing fundamentals', styles: ['A'] }, { label: 'Missing news / events', styles: ['B'] },
    { label: 'Missing fast moves', styles: ['C', 'E'] }, { label: 'Entering bad patterns', styles: ['D'] },
    { label: 'Fighting the trend', styles: ['F'] },
  ] },
];
const QWEIGHT = [3, 1, 2]; // conviction weighted highest, then frustration, then horizon

type Combo = { key: string; name: string; members: string[]; desc: string; best?: boolean };
const COMBOS: Combo[] = [
  { key: 'A + D', name: 'Best for most', members: ['A', 'D'], desc: 'Fundamental + Technical — find strong companies, enter via VCP / bases. The workhorse used by most top growth investors.', best: true },
  { key: 'C + F', name: 'Momentum elite', members: ['C', 'F'], desc: 'EP + Trend — buy the earnings strength, then ride the established trend.' },
  { key: 'B + D', name: 'Smart money', members: ['B', 'D'], desc: 'Special-situation / earnings + Technical — the event creates the move, the chart gives you timing. Enter on EP, add on trend continuation.' },
  { key: 'A + C', name: 'Aggressive growth', members: ['A', 'C'], desc: 'Fundamental + EP — identify the growth early, enter aggressively on the earnings beat.' },
];

const CYCLICALS: { sector: string; driver: string }[] = [
  { sector: 'Semiconductors', driver: 'Inventory cycle, capex cycles' },
  { sector: 'Specialty chemicals', driver: 'Pricing power returning after a demand slump' },
  { sector: 'Metals (steel, copper, aluminium)', driver: 'Supply cuts + demand recovery' },
  { sector: 'Energy (oil, gas)', driver: 'Supply discipline + price spikes' },
  { sector: 'Shipping (dry bulk, containers, tankers)', driver: 'Freight-rate cycles' },
  { sector: 'Autos', driver: 'Demand recovery + inventory normalisation' },
  { sector: 'Capital goods / industrials', driver: 'Order cycle turning up' },
  { sector: 'Construction / housing', driver: 'Rate cycle + demand rebound' },
];
const CYCLICAL_PROFIT = ['Inventory normalisation', 'Capacity cuts (supply destruction)', 'Pricing power returning', 'Margin expansion from depressed levels', 'Demand inflection (small improvement = big earnings jump)', 'Multiple expansion (market re-rates before earnings peak)'];
const GREEN_FLAGS = ['New product / branding, cost cutting, narrative regime shift, insider buying', 'GAAP profitability, positive FCF in the quarter, order book, ROCE expanding', 'Aggressive new brand / stores, early to adopt new technology', 'Tailwind, PLI-type incentives, budget inclusion, margin expansion', 'Revenue growth > 25%, operating leverage, inflection, disciplined dilution'];
const RED_FLAGS = ['Bad revenue guidance, decelerating revenue, negative CFO despite profit', 'Margin compression, weak vs competitor comparison', 'Order-to-revenue lag, high customer concentration', 'High valuation + inconsistent execution', 'High PE + unstable earnings, frequent equity dilution'];

const KILL_SWITCH: { icon: string; title: string; checks: string[] }[] = [
  { icon: '🧠', title: 'Moat', checks: ['Pricing power present?', 'Switching cost high?', 'Customer concentration < 30%?'] },
  { icon: '🌍', title: 'Market runway', checks: ['TAM supports 5–10x growth?', 'Company share < 10% of industry?', 'Structural tailwind exists?'] },
  { icon: '🔁', title: 'Revenue quality', checks: ['Not a cyclical spike?', 'Not single-product driven?', 'Not order-book dependent only?'] },
  { icon: '💰', title: 'Capital allocation', checks: ['No excessive dilution?', 'Capex returns > ROCE?', 'Management reinvests efficiently?'] },
  { icon: '⚔️', title: 'Competitive stability', checks: ['Margins stable across cycles?', 'No aggressive new-entrant pressure?', 'No structural commoditisation risk?'] },
  { icon: '🏛', title: 'Governance', checks: ['Clean auditor history?', 'No major related-party concerns?', 'No hidden / off-balance-sheet leverage?'] },
  { icon: '🔄', title: 'Reinvestment engine', checks: ['Incremental ROCE stable or rising?', 'Free-cash reinvestment opportunity exists?'] },
  { icon: '⚠️', title: 'Downside stress', checks: ['Survives a 30–50% earnings decline?', 'No existential liquidity risk?'] },
];

const BUY_CHECKLIST: { n: number; title: string; items: string[]; note?: string }[] = [
  { n: 1, title: 'Theme / Macro', items: ['Policy aligned? (EOs, DoD, IRA, subsidies, export controls)', 'Multi-year secular trend?', 'Supply-constrained industry?', 'Strategic / national importance?', 'Multi-theme exposure?', 'Capital flowing into the theme?', 'Theme activation visible?'] },
  { n: 2, title: 'Catalyst / Inflection', items: ['Government contracts?', 'Earnings inflection?', 'Strategic partnerships?', 'Product launch?', 'Regulatory tailwind?', 'Capacity expansion?', 'Supply shortages?', 'Estimate revisions likely?', 'Verifiable re-rating event?', 'Catalyst within 6–18 months?'], note: 'Example: Centrus (LEU) = only US uranium-enrichment exposure + Executive-Order tailwind.' },
  { n: 3, title: 'Sentiment / Market Interest', items: ['Analyst upgrades?', 'Conference mentions?', 'Social volume (Twitter/Reddit)?', 'Institutional accumulation?', 'Retail attention increasing?', 'Under-followed by Wall Street? (< 10 analysts)'] },
  { n: 4, title: 'Price / Volume Action', items: ['Chart setup strong?', 'Relative strength vs market?', 'High-volume breakout?', 'Sector-breadth participation?', 'Dark-pool activity?', 'Options-flow surges?', 'Real money entering the sector?'] },
  { n: 5, title: 'Financial Quality', items: ['Revenue growth > 20%?', 'EPS growth accelerating?', 'ROIC > 15%?', 'Gross margin > 40%?', 'Margins stable or expanding?', 'Operating leverage visible?', 'FCF positive OR path within 12 months?', 'Debt/Equity < 1.5?', 'Strong liquidity / cash runway?', 'Can avoid emergency dilution?'] },
  { n: 6, title: 'Business Model', items: ['What do they sell?', 'Who are the customers?', 'How do they sell / distribute?', 'Which 2–3 products = 80% of revenue?', 'Revenue by segment?', 'Revenue by geography?', 'Customer-concentration risk?', 'Blue-chip customers / partners?'] },
  { n: 7, title: 'Moat / Competitive Advantage', items: ['Technology advantage?', 'IP advantage?', 'Regulatory moat?', 'Scale advantage?', 'Switching costs?', 'Scarcity / monopoly asset?', 'National-security relevance?', 'Moat widening?', 'Rarity premium exists?'], note: 'Examples: LEU = US HALEU monopoly · HII = nuclear shipbuilding monopoly.' },
  { n: 8, title: 'Competition / Industry Structure', items: ['Direct competitors?', 'Competitor scale?', 'Fragmented or consolidated?', 'Cyclical or secular?', 'Where are we in the cycle?', 'Market share increasing?'] },
  { n: 9, title: 'Management / Insider Alignment', items: ['Founder-led?', 'CEO / operator quality?', 'Insider ownership > 5%?', 'Skin in the game?', 'Recent insider buys / sells?', 'Are insider transactions meaningful?', 'Capital allocation disciplined?'] },
  { n: 10, title: 'Dilution / Share Structure', items: ['Share-count trend over 3–5 years?', 'Heavy SBC?', 'Frequent equity raises?', 'Convertible-debt risk?', 'Warrants / outstanding dilution?', 'Can the company self-fund growth?'] },
  { n: 11, title: 'Red Flags (uncheck if present)', items: ['No customer over-concentration?', 'No accounting complexity?', 'No legal / regulatory issues?', 'Balance sheet sound?', 'No mispriced cyclical earnings risk?', 'No mispriced commodity exposure?', 'Execution risk contained?', 'Not dependent on subsidies / policy?'] },
  { n: 12, title: 'TAM / Optionality', items: ['TAM > 10x current revenue?', 'Large adjacencies?', 'International expansion?', 'Optional future products / services?', 'Multiple growth vectors?'] },
];

const VAL_GROWTH = ['PEG < 1.5', 'EV/Revenue < 5 for 30% growers', 'EV/Revenue < 10 for 50%+ growers + profitability path', 'Forward P/E < 30 with EPS growth > 25%'];
const VAL_RELATIVE = ['Cheap vs peers?', 'Cheap vs historical multiples?', 'Cheap vs private-market value?', 'Cheap vs strategic value?'];
const VAL_BYTYPE: { k: string; v: string }[] = [
  { k: 'P/E', v: 'stable profitable companies' }, { k: 'EV/EBITDA', v: 'capital-intensive' },
  { k: 'P/S · EV/Sales', v: 'high growth' }, { k: 'P/FCF', v: 'mature cash generators' },
  { k: 'EV/ARR', v: 'SaaS / subscription' }, { k: 'Private-market value', v: 'monopoly / scarcity assets' },
];
const RARITY = ['Policy alignment', 'Theme activation', 'Irreplaceability confirmation', 'Strategic-monopoly status', 'National-security importance'];
const PORTFOLIO_BUCKETS: { name: string; color: string; tickers: string[] }[] = [
  { name: 'Speculative', color: C.red, tickers: ['OKLO', 'NNE', 'SMR'] },
  { name: 'Picks & Shovels', color: C.amber, tickers: ['UUUU', 'VIAV', 'AMKR', 'ENS'] },
  { name: 'Industry Leaders', color: C.green, tickers: ['LEU', 'HII', 'NBIS', 'KTOS'] },
  { name: 'Rarity Premium', color: C.violet, tickers: ['LEU', 'HII', 'AMKR'] },
];
const FINAL_QS = ['Is this a genuine strategic asset, or just narrative hype?', 'Would I hold through a 50% drawdown?', 'Is this institutionally ownable in 3–5 years?', 'Can this re-rate into a category leader?', 'Is Wall Street still early here?'];
const INVESTORS: { name: string; note: string }[] = [
  { name: 'Pradeep Bonde', note: 'Growth, turnaround, themes, EP / delayed EP — market movers' },
  { name: 'Mark Minervini', note: 'VCP' }, { name: 'Dan Zanger / Leif Soreide', note: 'High Tight Flag (HTF)' },
  { name: 'Stan Weinstein', note: 'Stage analysis' }, { name: 'Stanley Druckenmiller', note: 'Macro + concentration' },
  { name: 'Suresh KBN', note: 'PEAD (post-earnings-announcement drift)' },
];
const GUIDANCE: { name: string; guide: string }[] = [
  { name: 'HFCL', guide: '20–25% growth guidance, margins to expand 3–4%' },
  { name: 'Aeroflex Industries', guide: '35% growth for FY27' },
  { name: 'MTAR Tech', guide: '80%+ growth guidance for FY27' },
  { name: 'Yasho Industries', guide: '35–45% volume growth in FY27' },
  { name: 'Wakefit Innovations', guide: '20%+ revenue growth in FY27' },
  { name: 'Viyash Scientific', guide: '40% CDMO growth in FY27' },
  { name: 'Shivalik Bimetals', guide: '20–30% revenue growth in FY27–28' },
  { name: 'Senores Pharma', guide: '30–40% revenue growth in FY27' },
  { name: 'KKDL', guide: '20% revenue CAGR expected' },
  { name: 'CSB Bank', guide: '25% loan growth in FY27' },
  { name: 'Shilpa Medicare', guide: '40–50% formulation revenue growth in FY27' },
  { name: 'Netweb Tech', guide: '35–40% revenue growth FY27, margins 13–14%' },
  { name: 'Syrma SGS', guide: '35% revenue growth, targeting ₹700cr EBITDA in FY27' },
  { name: 'Inox India', guide: '18–20% FY27 growth guidance' },
  { name: 'Acutaas Chemicals', guide: '25% FY27 revenue growth guidance' },
  { name: 'Aimtron Electronics', guide: '40–50% revenue guidance for FY27–29' },
  { name: 'Apollo Micro', guide: '40–50% revenue CAGR over next 3 years' },
  { name: 'Gravita India', guide: '25% volume CAGR, 30–35% PAT growth' },
  { name: 'Sedemac Mechatronics', guide: '200% revenue growth for FY27' },
  { name: 'Rossell Techsys', guide: '80%+ growth guidance in FY27' },
];

const SECTIONS: { id: string; label: string }[] = [
  { id: 'styles', label: '7 Styles' }, { id: 'combos', label: 'Combos' }, { id: 'avoid', label: 'Avoid' },
  { id: 'cyclical', label: 'Cyclical' }, { id: 'flags', label: 'Green/Red' }, { id: 'bagger', label: '100-Bagger' },
  { id: 'checklist', label: 'Buy Checklist' }, { id: 'valuation', label: 'Valuation' }, { id: 'portfolio', label: 'Portfolio' },
  { id: 'investors', label: 'Investors' }, { id: 'guidance', label: 'Guidance' }, { id: 'finder', label: 'Edge Finder' },
];

// ---- helpers ----
const band = (r: number) => (r >= 0.8 ? C.green : r >= 0.6 ? C.amber : C.red);
const verdict = (r: number) => (r >= 0.8 ? 'Strong' : r >= 0.6 ? 'Decent' : r > 0 ? 'Weak' : '—');

function SectionHead({ id, n, title, sub, color }: { id: string; n: number; title: string; sub?: string; color: string }) {
  return (
    <div id={id} style={{ scrollMarginTop: 64, marginTop: 38, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: `${color}1f`, border: `1px solid ${color}59`, color, fontSize: F.sm, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
        <span style={{ fontSize: F.xl, fontWeight: 800, letterSpacing: 0.3 }}>{title}</span>
      </div>
      {sub ? <div style={{ fontSize: F.sm, color: C.muted, marginTop: 6, lineHeight: 1.55, maxWidth: 880 }}>{sub}</div> : null}
      <div style={{ height: 2, background: `linear-gradient(90deg, ${color}, transparent)`, marginTop: 10, borderRadius: 2 }} />
    </div>
  );
}
function Pill({ text, color }: { text: string; color: string }) {
  return <span style={{ fontSize: F.xs, fontWeight: 800, color, border: `1px solid ${color}66`, background: `${color}14`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{text}</span>;
}

function StyleCard({ s }: { s: StyleDef }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderLeft: `4px solid ${s.color}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.xl, fontWeight: 900, color: s.color }}>{s.letter}.</span>
        <span style={{ fontSize: F.lg, fontWeight: 800 }}>{s.name}</span>
        {s.rating ? <Pill text={s.rating === 'Good' ? '✓ My good strategy' : s.rating === 'No edge' ? '✕ No edge yet' : '~ Neutral'} color={RATING_COLOR[s.rating]} /> : null}
      </div>
      <div style={{ fontSize: F.sm, color: C.txt, fontStyle: 'italic', marginTop: 8, lineHeight: 1.55 }}>“{s.mind}”</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {s.focus.map((f, i) => <span key={i} style={{ fontSize: F.xs, color: C.muted, background: C.panel2, border: `1px solid ${C.line2}`, borderRadius: 6, padding: '3px 8px' }}>{f}</span>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, marginTop: 12 }}>
        {s.subs.map((sub, i) => (
          <div key={i} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: F.xs, fontWeight: 800, color: s.color, marginBottom: 4 }}>{sub.tag}</div>
            <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.5 }}>{sub.text}</div>
          </div>
        ))}
      </div>
      {(s.rule || s.entry || s.edge) && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {s.rule ? <div style={{ fontSize: F.sm, color: C.txt }}><b style={{ color: s.color }}>Rule · </b>{s.rule}</div> : null}
          {s.entry ? <div style={{ fontSize: F.sm, color: C.txt }}><b style={{ color: s.color }}>Entry · </b>{s.entry}</div> : null}
          {s.edge ? <div style={{ fontSize: F.sm, color: C.txt }}><b style={{ color: s.color }}>Edge · </b>{s.edge}</div> : null}
        </div>
      )}
      {s.notes && s.notes.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
          {s.notes.map((nt, i) => <li key={i} style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.55, marginBottom: 3 }}>{nt}</li>)}
        </ul>
      )}
    </div>
  );
}

const LS = { bagger: 'mc:ios:bagger', buy: 'mc:ios:buy', picks: 'mc:ios:picks', edge: 'mc:ios:edge' };

export default function InvestingOSPage() {
  const [bagger, setBagger] = useState<Record<string, boolean>>({});
  const [buy, setBuy] = useState<Record<string, boolean>>({});
  const [picks, setPicks] = useState<number[]>([-1, -1, -1]);
  const [locked, setLocked] = useState<{ primary: string; secondary: string } | null>(null);

  useEffect(() => {
    try {
      const b = JSON.parse(localStorage.getItem(LS.bagger) || '{}'); if (b && typeof b === 'object') setBagger(b);
      const y = JSON.parse(localStorage.getItem(LS.buy) || '{}'); if (y && typeof y === 'object') setBuy(y);
      const p = JSON.parse(localStorage.getItem(LS.picks) || 'null'); if (Array.isArray(p) && p.length === 3) setPicks(p);
      const l = JSON.parse(localStorage.getItem(LS.edge) || 'null'); if (l && l.primary) setLocked(l);
    } catch {}
  }, []);
  const save = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const toggleBagger = (k: string) => setBagger((p) => { const n = { ...p, [k]: !p[k] }; save(LS.bagger, n); return n; });
  const toggleBuy = (k: string) => setBuy((p) => { const n = { ...p, [k]: !p[k] }; save(LS.buy, n); return n; });
  const resetBagger = () => { setBagger({}); save(LS.bagger, {}); };
  const resetBuy = () => { setBuy({}); save(LS.buy, {}); };
  const choose = (qi: number, oi: number) => setPicks((p) => { const n = p.map((v, i) => (i === qi ? (v === oi ? -1 : oi) : v)); save(LS.picks, n); return n; });
  const resetFinder = () => { setPicks([-1, -1, -1]); save(LS.picks, [-1, -1, -1]); };

  // scores
  const baggerTotal = KILL_SWITCH.reduce((a, t) => a + t.checks.length, 0);
  const baggerDone = Object.values(bagger).filter(Boolean).length;
  const buyTotal = BUY_CHECKLIST.reduce((a, s) => a + s.items.length, 0);
  const buyDone = Object.values(buy).filter(Boolean).length;

  const { ranked, answered } = useMemo(() => {
    const score: Record<string, number> = {};
    let n = 0;
    picks.forEach((oi, qi) => {
      if (oi < 0) return; n++;
      const opt = FINDER[qi].opts[oi];
      const w = QWEIGHT[qi] / opt.styles.length;
      opt.styles.forEach((s) => { score[s] = (score[s] || 0) + w; });
    });
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    return { ranked, answered: n };
  }, [picks]);

  const primary = ranked[0]?.[0] || '';
  const secondary = ranked[1] && ranked[1][1] > 0 ? ranked[1][0] : '';
  const maxScore = ranked[0]?.[1] || 1;
  const finderCombos = COMBOS.filter((c) => c.members.includes(primary))
    .sort((a, b) => (b.members.every((m) => ranked.some((r) => r[0] === m && r[1] > 0)) ? 1 : 0) - (a.members.every((m) => ranked.some((r) => r[0] === m && r[1] > 0)) ? 1 : 0));
  const lockEdge = () => { const v = { primary, secondary }; setLocked(v); save(LS.edge, v); };

  const lockedPrimary = locked ? byLetter(locked.primary) : null;
  const lockedSecondary = locked && locked.secondary ? byLetter(locked.secondary) : null;

  const wrap = { maxWidth: 1680, margin: '0 auto', padding: '0 22px' } as const;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.txt, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      {/* sticky nav */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: `${C.bg}f0`, borderBottom: `1px solid ${C.line}`, backdropFilter: 'blur(8px)' }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 16px' }}>
          <Link href="/" style={{ fontSize: F.sm, color: C.muted, textDecoration: 'none', fontWeight: 700 }}>← Home</Link>
          <span style={{ fontSize: F.md, fontWeight: 900, color: C.teal, letterSpacing: 0.5 }}>🧠 INVESTING OS</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
            {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} style={{ fontSize: F.xs, color: C.muted, textDecoration: 'none', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '2px 8px' }}>{s.label}</a>)}
          </div>
        </div>
      </div>

      {/* HERO */}
      <div style={{ borderBottom: `1px solid ${C.line}`, background: `radial-gradient(900px 240px at 12% -40%, ${C.teal}1a, transparent), radial-gradient(700px 220px at 90% -60%, ${C.violet}14, transparent)` }}>
        <div style={{ ...wrap, padding: '30px 16px 26px' }}>
          <div style={{ fontSize: F.xs, fontWeight: 800, color: C.teal, letterSpacing: 1.4, textTransform: 'uppercase' }}>Your investing operating system</div>
          <div style={{ fontSize: F.hero, fontWeight: 900, letterSpacing: 0.2, marginTop: 6, lineHeight: 1.1 }}>Find your edge. Then execute it.</div>
          <div style={{ fontSize: F.base, color: C.muted, lineHeight: 1.6, marginTop: 12, maxWidth: 860 }}>
            Pick <b style={{ color: C.txt }}>1–2 edge categories, max</b> — that defines your whole strategy. Most retail failure comes from mixing every style with no edge. Read the styles, lock a primary (and one complementary), then run every buy through the <b style={{ color: C.txt }}>scored checklist</b> and the <b style={{ color: C.txt }}>100-bagger kill-switch</b>. The Edge Finder at the bottom turns your answers into a declared edge.
          </div>
          {locked && lockedPrimary ? (
            <div style={{ marginTop: 18, background: `${C.green}10`, border: `1px solid ${C.green}59`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: F.xs, fontWeight: 900, color: C.green, letterSpacing: 0.6 }}>🔒 YOUR EDGE</span>
              <Pill text={`${lockedPrimary.letter} · ${lockedPrimary.name}`} color={lockedPrimary.color} />
              {lockedSecondary ? <span style={{ color: C.dim, fontSize: F.sm }}>+</span> : null}
              {lockedSecondary ? <Pill text={`${lockedSecondary.letter} · ${lockedSecondary.name}`} color={lockedSecondary.color} /> : null}
              <span style={{ fontSize: F.sm, color: C.txt }}>“I make money primarily from <b>{lockedPrimary.money}</b>{lockedSecondary ? <> — with a secondary edge in <b>{lockedSecondary.money}</b></> : null}.”</span>
              <a href="#finder" style={{ marginLeft: 'auto', fontSize: F.xs, color: C.muted, textDecoration: 'none', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '3px 10px' }}>Change ↓</a>
            </div>
          ) : (
            <div style={{ marginTop: 16, fontSize: F.sm, color: C.dim }}>No edge locked yet — scroll to the Edge Finder at the bottom to declare one.</div>
          )}
        </div>
      </div>

      <div style={{ ...wrap, padding: '6px 16px 90px' }}>

        {/* 1 · STYLES */}
        <SectionHead id="styles" n={1} title="The 7 Edge Styles (A–G)" sub="Badges show your own self-assessment. Green = your good strategy · Amber = neutral · Red = no edge yet." color={C.blue} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: 12, alignItems: 'start' }}>
          {STYLES.map((s) => <StyleCard key={s.letter} s={s} />)}
        </div>

        {/* 2 · COMBOS */}
        <SectionHead id="combos" n={2} title="Recommended Combinations" sub="Proven pairings (not theory). Combine a primary with one complementary style — never more." color={C.green} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
          {COMBOS.map((c) => (
            <div key={c.key} style={{ background: c.best ? `${C.green}10` : C.panel, border: `1px solid ${c.best ? C.green : C.line}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: F.lg, fontWeight: 900, color: c.best ? C.green : C.txt }}>{c.key}</span>
                <span style={{ fontSize: F.sm, fontWeight: 800, color: c.best ? C.green : C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{c.name}</span>
                {c.best ? <Pill text="Best for most" color={C.green} /> : null}
              </div>
              <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.55, marginTop: 8 }}>{c.desc}</div>
            </div>
          ))}
        </div>

        {/* 3 · AVOID */}
        <SectionHead id="avoid" n={3} title="What To Avoid · Final Rule" color={C.red} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <div style={{ background: `${C.red}0d`, border: `1px solid ${C.red}40`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 8 }}>Most retail failure comes from</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {['Mixing all styles randomly', 'No clear edge', 'Switching strategy after losses', 'Buying low-P/E stocks when the sector / theme is ignored', 'Ignoring the story — sometimes the balance sheet / P&L shows a delay; understand the narrative first'].map((x, i) => <li key={i} style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.55, marginBottom: 4 }}>{x}</li>)}
            </ul>
          </div>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.teal, marginBottom: 8 }}>🔴 Final rule</div>
            <div style={{ fontSize: F.base, color: C.txt, lineHeight: 1.6, fontWeight: 700 }}>If you cannot clearly say “I make money primarily from ______”, you don't have an edge.</div>
            <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.55, marginTop: 10 }}>Cyclical version: “I make money from buying supply–demand inflections and selling peak margins,” or “…from cyclical inflections where earnings recover faster than expected and valuations expand.”</div>
          </div>
        </div>

        {/* 4 · CYCLICAL */}
        <SectionHead id="cyclical" n={4} title="Cyclical Inflection Playbook" sub="When the index falls 40–50%, hunt cyclicals (semis, specialty chemicals, etc.). You don't just buy low — you buy the inflection." color={C.orange} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 12 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 6 }}>
            {CYCLICALS.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 10px', borderBottom: i < CYCLICALS.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                <div style={{ fontSize: F.sm, fontWeight: 800, color: C.orange, minWidth: 150 }}>{c.sector}</div>
                <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.5 }}>{c.driver}</div>
              </div>
            ))}
          </div>
          <div style={{ background: `${C.orange}0d`, border: `1px solid ${C.orange}40`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.orange, marginBottom: 8 }}>You profit from</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{CYCLICAL_PROFIT.map((x, i) => <li key={i} style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.55, marginBottom: 4 }}>{x}</li>)}</ul>
          </div>
        </div>

        {/* 5 · FLAGS */}
        <SectionHead id="flags" n={5} title="Green Flags · Red Flags" sub="Fast quality screen for earnings / momentum names." color={C.lime} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <div style={{ background: `${C.green}0d`, border: `1px solid ${C.green}40`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.green, marginBottom: 8 }}>🟢 Green flags</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>{GREEN_FLAGS.map((x, i) => <li key={i} style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.55, marginBottom: 5 }}>{x}</li>)}</ol>
          </div>
          <div style={{ background: `${C.red}0d`, border: `1px solid ${C.red}40`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 8 }}>🔴 Red flags</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>{RED_FLAGS.map((x, i) => <li key={i} style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.55, marginBottom: 5 }}>{x}</li>)}</ol>
          </div>
        </div>

        {/* 6 · 100-BAGGER (scored) */}
        <SectionHead id="bagger" n={6} title="100-Bagger Kill-Switch" sub="Tick what passes. Any unchecked box is a flag to dig deeper. Also confirm it's a high-margin business vs peers (India / USA) and do forensic analysis." color={C.violet} />
        <ScoreBar done={baggerDone} total={baggerTotal} color={C.violet} onReset={resetBagger} label="Kill-switch score" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 12 }}>
          {KILL_SWITCH.map((t, i) => {
            const done = t.checks.filter((_, j) => bagger[`b${i}:${j}`]).length;
            return (
              <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: F.md, fontWeight: 800, color: C.violet }}>{t.icon} {i + 1}. {t.title}</span>
                  <span style={{ fontSize: F.xs, fontWeight: 800, color: band(done / t.checks.length) }}>{done}/{t.checks.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {t.checks.map((c, j) => <CheckRow key={j} on={!!bagger[`b${i}:${j}`]} onClick={() => toggleBagger(`b${i}:${j}`)} text={c} color={C.violet} />)}
                </div>
              </div>
            );
          })}
        </div>

        {/* 7 · BUY CHECKLIST (scored) */}
        <SectionHead id="checklist" n={7} title="Stock-Buying Checklist" sub="Run every candidate through these and watch the live score. Don't buy a cheap multiple if the theme is being ignored." color={C.cyan} />
        <ScoreBar done={buyDone} total={buyTotal} color={C.cyan} onReset={resetBuy} label="Conviction score" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 12 }}>
          {BUY_CHECKLIST.map((sec, si) => {
            const done = sec.items.filter((_, j) => buy[`y${si}:${j}`]).length;
            return (
              <div key={sec.n} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: F.md, fontWeight: 800, color: C.cyan }}>{sec.n}. {sec.title}</span>
                  <span style={{ fontSize: F.xs, fontWeight: 800, color: band(done / sec.items.length) }}>{done}/{sec.items.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sec.items.map((it, j) => <CheckRow key={j} on={!!buy[`y${si}:${j}`]} onClick={() => toggleBuy(`y${si}:${j}`)} text={it} color={C.cyan} />)}
                </div>
                {sec.note ? <div style={{ fontSize: F.xs, color: C.dim, fontStyle: 'italic', marginTop: 8, lineHeight: 1.5 }}>{sec.note}</div> : null}
              </div>
            );
          })}
        </div>

        {/* 8 · VALUATION */}
        <SectionHead id="valuation" n={8} title="Valuation Frameworks" color={C.amber} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 8 }}>Growth framework</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{VAL_GROWTH.map((x, i) => <li key={i} style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.55, marginBottom: 4 }}>{x}</li>)}</ul>
          </div>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 8 }}>Relative</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{VAL_RELATIVE.map((x, i) => <li key={i} style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.55, marginBottom: 4 }}>{x}</li>)}</ul>
          </div>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 8 }}>By business type</div>
            {VAL_BYTYPE.map((x, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
                <span style={{ fontSize: F.sm, fontWeight: 800, color: C.txt, minWidth: 128 }}>{x.k}</span>
                <span style={{ fontSize: F.sm, color: C.muted }}>{x.v}</span>
              </div>
            ))}
          </div>
          <div style={{ background: `${C.amber}0d`, border: `1px solid ${C.amber}40`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 8 }}>Rarity-premium multipliers</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{RARITY.map((x, i) => <li key={i} style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.55, marginBottom: 4 }}>{x}</li>)}</ul>
            <div style={{ fontSize: F.xs, color: C.dim, fontStyle: 'italic', marginTop: 8, lineHeight: 1.5 }}>e.g. valuing LEU on a commodity framework instead of a strategic-monopoly framework = mispricing.</div>
          </div>
        </div>

        {/* 9 · PORTFOLIO */}
        <SectionHead id="portfolio" n={9} title="Portfolio Classification" sub="Size positions by bucket. Concentrate quality, keep speculative small." color={C.blue} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
          {PORTFOLIO_BUCKETS.map((b, i) => (
            <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderTop: `3px solid ${b.color}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: F.md, fontWeight: 800, color: b.color, marginBottom: 8 }}>{b.name}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {b.tickers.map((t) => <span key={t} style={{ fontSize: F.sm, fontWeight: 800, color: C.txt, background: C.panel2, border: `1px solid ${C.line2}`, borderRadius: 6, padding: '3px 9px' }}>{t}</span>)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: F.md, fontWeight: 800, color: C.txt, marginBottom: 8 }}>Final questions before you commit</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{FINAL_QS.map((x, i) => <li key={i} style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.55, marginBottom: 4 }}>{x}</li>)}</ul>
        </div>

        {/* 10 · INVESTORS */}
        <SectionHead id="investors" n={10} title="Investors To Follow" color={C.lime} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10 }}>
          {INVESTORS.map((iv, i) => (
            <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '10px 13px' }}>
              <div style={{ fontSize: F.sm, fontWeight: 800, color: C.lime }}>{iv.name}</div>
              <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.5, marginTop: 2 }}>{iv.note}</div>
            </div>
          ))}
        </div>

        {/* 11 · GUIDANCE */}
        <SectionHead id="guidance" n={11} title="Guidance Watchlist — PAT can double in 2–3 years" sub="20 companies with management guidance pointing to a possible PAT double. Tracking list, not a recommendation — verify each independently." color={C.green} />
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden' }}>
          {GUIDANCE.map((g, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '9px 14px', alignItems: 'baseline', background: i % 2 ? C.panel2 : 'transparent', borderBottom: i < GUIDANCE.length - 1 ? `1px solid ${C.line}` : 'none' }}>
              <span style={{ fontSize: F.xs, color: C.dim, minWidth: 20, fontWeight: 800 }}>{i + 1}</span>
              <span style={{ fontSize: F.sm, fontWeight: 800, color: C.txt, minWidth: 170 }}>{g.name}</span>
              <span style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.45 }}>{g.guide}</span>
            </div>
          ))}
        </div>

        {/* 12 · EDGE FINDER (at the end) */}
        <SectionHead id="finder" n={12} title="🎯 Edge Finder" sub="Answer honestly. Conviction is weighted highest, then frustration, then horizon. The finder ranks the styles, shows your matched edge in full, and lets you lock it in." color={C.teal} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {FINDER.map((blk, qi) => (
            <div key={qi} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: F.md, fontWeight: 800, marginBottom: 10 }}>{blk.q}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {blk.opts.map((o, oi) => {
                  const on = picks[qi] === oi;
                  return (
                    <button key={oi} onClick={() => choose(qi, oi)} style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 8, padding: '8px 11px', border: `1px solid ${on ? C.teal : C.line2}`, background: on ? `${C.teal}1f` : C.panel2, color: on ? C.txt : C.muted, fontSize: F.sm, fontWeight: on ? 800 : 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span>{o.label}</span>
                      <span style={{ fontSize: F.xs, color: on ? C.teal : C.dim, fontWeight: 800 }}>{o.styles.join(' / ')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* finder result */}
        <div style={{ marginTop: 14, background: `${C.teal}0d`, border: `1px solid ${C.teal}59`, borderRadius: 14, padding: 16 }}>
          {answered === 0 ? (
            <div style={{ fontSize: F.sm, color: C.muted }}>Pick an answer above to rank your edge.</div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: F.md, fontWeight: 900, color: C.teal, letterSpacing: 0.4 }}>STYLE RANKING</span>
                <button onClick={resetFinder} style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: F.xs, color: C.muted, background: 'transparent', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '3px 10px' }}>Reset</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {ranked.filter((r) => r[1] > 0).map(([l, sc]) => {
                  const s = byLetter(l); if (!s) return null;
                  const pct = Math.round((sc / maxScore) * 100);
                  return (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: F.xs, fontWeight: 900, color: s.color, minWidth: 16 }}>{s.letter}</span>
                      <span style={{ fontSize: F.xs, color: C.muted, minWidth: 190 }}>{s.name}</span>
                      <div style={{ flex: 1, height: 9, background: C.panel2, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.line}` }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: s.color, opacity: l === primary ? 1 : 0.5 }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {primary && (
                <div style={{ marginTop: 16, padding: 14, background: `${C.teal}10`, border: `1px solid ${C.teal}40`, borderRadius: 12 }}>
                  <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.6 }}>
                    <b style={{ color: C.teal }}>Your edge statement:</b> “I make money primarily from <b>{byLetter(primary)?.money}</b>{secondary ? <> — with a secondary edge in <b>{byLetter(secondary)?.money}</b></> : null}.”
                  </div>
                  {finderCombos.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: F.sm, color: C.txt }}>
                      <b style={{ color: C.green }}>Proven combo:</b> {finderCombos.map((c) => `${c.key} (${c.name})`).join(', ')}.
                    </div>
                  )}
                  <button onClick={lockEdge} style={{ marginTop: 12, cursor: 'pointer', fontSize: F.sm, fontWeight: 800, color: '#05231a', background: C.teal, border: 'none', borderRadius: 8, padding: '8px 16px' }}>
                    {locked && locked.primary === primary && locked.secondary === secondary ? '✓ Edge locked' : '🔒 Lock in this edge'}
                  </button>
                </div>
              )}

              {primary && byLetter(primary) ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: F.xs, fontWeight: 800, color: C.muted, letterSpacing: 0.5, marginBottom: 8 }}>YOUR MATCHED STYLE IN FULL</div>
                  <StyleCard s={byLetter(primary)!} />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div style={{ marginTop: 28, fontSize: F.xs, color: C.dim, lineHeight: 1.6, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
          Personal strategy reference, not investment advice. Checklist ticks and your locked edge are saved in this browser only. Guidance figures are management/analyst expectations and can change — verify each name independently before acting.
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ done, total, color, onReset, label }: { done: number; total: number; color: string; onReset: () => void; label: string }) {
  const r = total ? done / total : 0;
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <span style={{ fontSize: F.sm, fontWeight: 800, color: C.txt }}>{label}</span>
      <div style={{ flex: 1, minWidth: 160, height: 10, background: C.panel2, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.line}` }}>
        <div style={{ width: `${Math.round(r * 100)}%`, height: '100%', background: band(r) }} />
      </div>
      <span style={{ fontSize: F.sm, fontWeight: 900, color: band(r) }}>{done}/{total} · {Math.round(r * 100)}% · {verdict(r)}</span>
      <button onClick={onReset} style={{ cursor: 'pointer', fontSize: F.xs, color: C.muted, background: 'transparent', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '3px 10px' }}>Reset</button>
    </div>
  );
}

function CheckRow({ on, onClick, text, color }: { on: boolean; onClick: () => void; text: string; color: string }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 'none', padding: '3px 0', width: '100%' }}>
      <span style={{ color: on ? color : C.dim, fontSize: F.base, lineHeight: 1.3, fontWeight: 900, minWidth: 16 }}>{on ? '☑' : '☐'}</span>
      <span style={{ fontSize: F.sm, color: on ? C.txt : C.muted, lineHeight: 1.45, textDecoration: on ? 'none' : 'none' }}>{text}</span>
    </button>
  );
}
