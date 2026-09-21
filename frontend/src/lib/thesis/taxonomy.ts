// ═══════════════════════════════════════════════════════════════════════════
// THE STRUCTURAL VARIABLE TAXONOMY.                                 (zzz720)
//
// The owner's distinction, and it is the whole reason this file exists:
//
//   Revenue, profit and margin tell you WHAT happened.
//   Capacity, utilisation, capex, plants, orders, customers, volume,
//   price/mix, guidance and bottlenecks tell you WHY it happened and
//   whether it can continue.
//
// The first engine carried twelve variables and ten of them were the first
// kind. It could tell him operating leverage was 2.9× and had no way to say
// whether that was a plant filling up or a one-quarter cost freeze. So the
// taxonomy below is the second kind, and the financial variables are demoted
// to one group among seven rather than being the whole ledger.
//
// TWO RULES THAT ARE STRUCTURAL, NOT COSMETIC:
//
//   1. NOT DISCLOSED IS NOT FLAT. A variable nobody looked at and a variable
//      that was checked and did not move are different facts, and every
//      surface here keeps them apart. Collapsing them is how an exit engine
//      ends up firing on silence, or — worse — clearing a holding because the
//      filing was thin.
//   2. THE GROUPS ARE READ IN ORDER. Financial first because it is always
//      available, then the structural groups in the order they drive earnings:
//      capacity → demand → capex → volume/price → forward → cash → risk. A
//      reader who stops after two groups has still read the two that matter
//      most for the thesis in front of them.
// ═══════════════════════════════════════════════════════════════════════════

export type VarKey =
  // ── FINANCIAL — what happened. Always available from the graders. ───────
  | 'revenue_growth' | 'earnings_growth' | 'operating_leverage' | 'margin'
  | 'margin_driver' | 'raw_materials'
  // ── CAPACITY — why it happened, and whether it can continue. ────────────
  | 'capacity' | 'capacity_addition' | 'utilisation' | 'new_plant'
  | 'commissioning' | 'capacity_bottleneck'
  // ── DEMAND ──────────────────────────────────────────────────────────────
  | 'order_intake' | 'order_book' | 'book_to_bill' | 'revenue_visibility'
  // ── CAPEX — as a chain, never as an announcement. ───────────────────────
  | 'capex' | 'capex_status' | 'capex_earning' | 'maintenance_vs_growth'
  // ── CUSTOMERS & PRODUCTS ────────────────────────────────────────────────
  | 'new_customer' | 'customer_loss' | 'customer_concentration'
  | 'new_product' | 'qualification' | 'approval'
  // ── VOLUME / PRICE / MIX — the decomposition of revenue. ────────────────
  | 'volume' | 'price' | 'mix' | 'exports'
  // ── FORWARD ─────────────────────────────────────────────────────────────
  | 'guidance' | 'management_target' | 'promise_vs_actual'
  // ── CASH & RETURNS ──────────────────────────────────────────────────────
  | 'cash_conversion' | 'working_capital' | 'fcf' | 'debt' | 'roce'
  | 'one_offs'
  // ── RISK: bottlenecks, execution, position ──────────────────────────────
  | 'supply_bottleneck' | 'execution_delay' | 'shutdown'
  | 'market_share' | 'pricing_power' | 'technology';

export type VarGroup =
  | 'financial' | 'capacity' | 'demand' | 'capex'
  | 'customers' | 'volume_price' | 'forward' | 'cash' | 'risk';

export const GROUP_ORDER: VarGroup[] = [
  'financial', 'capacity', 'demand', 'capex',
  'customers', 'volume_price', 'forward', 'cash', 'risk',
];

export const GROUP_LABEL: Record<VarGroup, string> = {
  financial: 'FINANCIAL — what happened',
  capacity: 'CAPACITY & UTILISATION — whether it can continue',
  demand: 'DEMAND — orders, backlog, visibility',
  capex: 'CAPEX — and whether it is earning yet',
  customers: 'CUSTOMERS, PRODUCTS & APPROVALS',
  volume_price: 'VOLUME / PRICE / MIX — what drove revenue',
  forward: 'FORWARD — guidance and promises',
  cash: 'CASH, WORKING CAPITAL & RETURNS',
  risk: 'BOTTLENECKS, EXECUTION & POSITION',
};

export const VAR_LABEL: Record<VarKey, string> = {
  revenue_growth: 'Revenue growth',
  earnings_growth: 'Earnings growth',
  operating_leverage: 'Operating leverage',
  margin: 'Operating margin',
  margin_driver: 'Margin driver',
  raw_materials: 'Raw-material cost',

  capacity: 'Installed capacity',
  capacity_addition: 'Capacity added',
  utilisation: 'Capacity utilisation',
  new_plant: 'New plant',
  commissioning: 'Commissioning',
  capacity_bottleneck: 'Capacity bottleneck',

  order_intake: 'Order intake',
  order_book: 'Order book',
  book_to_bill: 'Book-to-bill',
  revenue_visibility: 'Revenue visibility',

  capex: 'Capex',
  capex_status: 'Capex status',
  capex_earning: 'Capex earning yet?',
  maintenance_vs_growth: 'Growth vs maintenance capex',

  new_customer: 'New customer',
  customer_loss: 'Customer loss',
  customer_concentration: 'Customer concentration',
  new_product: 'New product',
  qualification: 'Qualification',
  approval: 'Regulatory approval',

  volume: 'Volume',
  price: 'Price',
  mix: 'Product mix',
  exports: 'Exports / new geography',

  guidance: 'Guidance',
  management_target: 'Management target',
  promise_vs_actual: 'Promise vs actual',

  cash_conversion: 'Cash conversion',
  working_capital: 'Working capital',
  fcf: 'Free cash flow',
  debt: 'Debt',
  roce: 'ROCE',
  one_offs: 'One-offs',

  supply_bottleneck: 'Supply bottleneck',
  execution_delay: 'Execution delay',
  shutdown: 'Plant shutdown',
  market_share: 'Market share',
  pricing_power: 'Pricing power',
  technology: 'Technology / automation',
};

export const VAR_GROUP: Record<VarKey, VarGroup> = {
  revenue_growth: 'financial', earnings_growth: 'financial',
  operating_leverage: 'financial', margin: 'financial',
  margin_driver: 'financial', raw_materials: 'financial',

  capacity: 'capacity', capacity_addition: 'capacity', utilisation: 'capacity',
  new_plant: 'capacity', commissioning: 'capacity', capacity_bottleneck: 'capacity',

  order_intake: 'demand', order_book: 'demand',
  book_to_bill: 'demand', revenue_visibility: 'demand',

  capex: 'capex', capex_status: 'capex', capex_earning: 'capex',
  maintenance_vs_growth: 'capex',

  new_customer: 'customers', customer_loss: 'customers',
  customer_concentration: 'customers', new_product: 'customers',
  qualification: 'customers', approval: 'customers',

  volume: 'volume_price', price: 'volume_price',
  mix: 'volume_price', exports: 'volume_price',

  guidance: 'forward', management_target: 'forward', promise_vs_actual: 'forward',

  cash_conversion: 'cash', working_capital: 'cash', fcf: 'cash',
  debt: 'cash', roce: 'cash', one_offs: 'cash',

  supply_bottleneck: 'risk', execution_delay: 'risk', shutdown: 'risk',
  market_share: 'risk', pricing_power: 'risk', technology: 'risk',
};

// ── WHERE A VARIABLE CAN COME FROM AT ALL.                         (zzz720)
//
// This matters for an honest "missing" list. Utilisation is never in a graded
// row — it is only ever in the filing — so telling the owner "utilisation not
// checked" while he is looking at a page that has read no filings is telling
// him something he cannot act on twice. The card uses this to say WHY a
// variable is unchecked: not disclosed in a filing that WAS read, versus no
// filing read yet.
export const GRADER_AVAILABLE: ReadonlySet<VarKey> = new Set<VarKey>([
  'revenue_growth', 'earnings_growth', 'operating_leverage', 'margin',
  'cash_conversion', 'roce',
]);

/** A variable's evidence can only ever be one of these three things, and the
 *  spec is explicit that they must never merge. */
export type EvidenceKind =
  /** The document states it as a fact about the period reported. */
  | 'fact'
  /** Management asserts it about the future or about causes. */
  | 'claim'
  /** This engine derived it from stated figures. Arithmetic only. */
  | 'derived';
