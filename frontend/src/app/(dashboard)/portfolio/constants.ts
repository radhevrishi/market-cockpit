// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

/* ── Constants ─────────────────────────────────────────────────────── */

export const STORAGE_KEY = 'mc_portfolio_holdings';

/* ── Summary Cards ─────────────────────────────────────────────────── */

// PATCH 1101zzz9 — Since-Inception tracking. Two extra fields the user
// asked for: an editable INITIAL CAPITAL (deposit ₹) and an inception
// DATE (when that capital was first committed). From those + current
// portfolio value we derive:
//   • TOTAL RETURN since inception (₹ gain and %)
//   • CAGR since inception (annualized — meaningful because >1y of data)
//
// Defaults: ₹35,40,000 deposited Aug 2022 (user-supplied). User can edit
// inline; values persist in localStorage so a refresh doesn't reset them.
export const INCEPTION_CAPITAL_KEY = 'mc_portfolio_inception_capital_v1';

export const INCEPTION_DATE_KEY = 'mc_portfolio_inception_date_v1';

export const DEFAULT_INCEPTION_CAPITAL = 3540000;

export const DEFAULT_INCEPTION_DATE = '2022-08-01';

// PATCH 1101zzz10 — Cash positions. Multiple labelled buckets (Savings,
// Liquid Fund, FD, etc.) so the dashboard reflects TOTAL WEALTH (equities +
// cash), not just equity value. Every summary metric — current value, total
// P&L, since-inception return, CAGR, allocation — now folds cash in.
export const CASH_POSITIONS_KEY = 'mc_portfolio_cash_positions_v1';

/* ── Main Page ─────────────────────────────────────────────────────── */

/* ── PATCH 1100 — Market-cap helpers + Portfolio Analytics ──────────── */

export const CAP_COLORS: Record<string, string> = { all: '#8BA3C1', large: '#60A5FA', mid: '#A78BFA', small: '#34D399', micro: '#FBBF24', other: '#64748B' };

// ═══════════════════════════════════════════════════════════════════════════
// PATCH 1103 — PORTFOLIO REGIME EXPOSURE
//
// Maps every holding's sector onto the 7-phase Market-Cycles framework and
// answers the question the Analytics tab can't: "if the macro regime turns,
// which way does MY book lean?" For a selected phase, each holding is bucketed
// FAVORED / NEUTRAL / EXPOSED by matching its sector against that phase's
// own/avoid lists (mirrors /market-cycles → Regime Rotation), weighted by live
// position value. Also scores regime-readiness across all 7 phases so the
// blind-spot is obvious at a glance. Pure client-side, no new data source.
// ═══════════════════════════════════════════════════════════════════════════
export const REGIME_PHASES_PF: {
  key: string; name: string; emoji: string; c: string;
  own: string[]; avoid: string[]; note: string;
}[] = [
  { key: 'expansion', name: 'Expansion', emoji: '🌱', c: '#10B981',
    own: ['industrial', 'capital good', 'cyclical', 'engineering', 'infra', 'defence', 'defense', 'auto', 'ancillary', 'semi', 'electronic', 'technology', 'it ', 'software', 'financ', 'bank', 'nbfc', 'small', 'mid', 'growth', 'realty', 'real estate', 'cement', 'power', 'railway'],
    avoid: [],
    note: 'Broadest opportunity set — cyclicals & growth compound with rising earnings and liquidity.' },
  { key: 'commodity', name: 'Commodity Shock', emoji: '🛢️', c: '#F59E0B',
    own: ['energy', 'oil', 'gas', 'fertil', 'agri', 'metal', 'mining', 'commodity', 'chemical', 'sugar', 'food producer', 'coal'],
    avoid: ['airline', 'aviation', 'restaurant', 'transport', 'logistic', 'packaging', 'discretionary', 'paint', 'tyre'],
    note: 'Supply-constrained producers win; input-cost takers get squeezed.' },
  { key: 'broaden', name: 'Inflation Broadens', emoji: '📈', c: '#EF7C3C',
    own: ['staple', 'fmcg', 'branded', 'consumer', 'healthcare', 'pharma', 'hospital', 'export', 'essential', 'utility', 'infra'],
    avoid: ['manufactur', 'discretionary', 'high-beta', 'auto ancillary', 'thin margin'],
    note: 'Pricing-power names pass costs through; cost-taker manufacturers lose margin.' },
  { key: 'stag', name: 'Stagflation', emoji: '⚠️', c: '#DC2626',
    own: ['staple', 'branded', 'healthcare', 'pharma', 'essential', 'infra', 'software', 'monopol', 'utility', 'power', 'gold', 'energy', 'fmcg'],
    avoid: ['discretionary', 'real estate', 'realty', 'nbfc', 'leverage', 'low-margin', 'entry-level', 'consumer discretionary', 'auto'],
    note: 'Pricing power + net-cash + real assets survive; leverage and rate-sensitives are the trap.' },
  { key: 'tighten', name: 'Monetary Tightening', emoji: '🏦', c: '#8B5CF6',
    own: ['value', 'bank', 'financ', 'staple', 'pharma', 'quality', 'cash', 'utility'],
    avoid: ['tech', 'software', 'it ', 'realty', 'real estate', 'nbfc', 'high-p/e', 'small', 'speculative', 'unprofitable', 'growth'],
    note: 'A rising discount rate collapses long-duration multiples even as earnings rise.' },
  { key: 'recession', name: 'Earnings Recession', emoji: '🔻', c: '#64748B',
    own: ['staple', 'pharma', 'healthcare', 'utility', 'gold', 'consumer', 'fmcg'],
    avoid: ['cyclical', 'industrial', 'metal', 'auto', 'realty', 'small', 'leverage', 'nbfc', 'capital good', 'infra'],
    note: 'Only the highest-quality survivors hold; peak-cycle leverage impairs.' },
  { key: 'bottom', name: 'Recession Bottom', emoji: '🌅', c: '#22D3EE',
    own: ['quality', 'growth', 'financ', 'bank', 'industrial', 'small', 'mid', 'cyclical', 'infra', 'capital good', 'auto'],
    avoid: [],
    note: 'Where the next multibagger generation is born — quality growth + financials + industrials as the cycle turns.' },
];
