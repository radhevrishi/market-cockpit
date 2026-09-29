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
  capex_earning: 'Capex earning',
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

// ═══════════════════════════════════════════════════════════════════════════
// DIMENSIONS — WHY A GOOD NUMBER IS NOT A CONFIRMED THESIS.         (zzz723)
//
// The owner's closing rule: "Never let a good number automatically create a
// green status. Revenue +50%, margin +500bp, earnings +100% does not mean
// thesis strengthening. The engine must ask WHY."
//
// Groups are for READING the card. Dimensions are for JUDGING it. A thesis is
// a claim that a MECHANISM will keep producing earnings, and a mechanism has
// parts: the financial output, the operating driver that caused it, the demand
// that sustains it, the capital that funds it, and what management says comes
// next. Financial output alone is the RESULT of the mechanism, never evidence
// that the mechanism is intact — which is exactly how AETHER reached "THESIS
// STRENGTHENING" on revenue and cash with capacity, orders, capex, customers
// and guidance all untouched.
export type VarDimension =
  | 'financial'          // the output: revenue, margin, earnings, leverage
  | 'operating_driver'   // WHY: capacity, utilisation, volume, mix, plant
  | 'demand'             // whether it sustains: orders, backlog, customers
  | 'capital'            // what funds it: capex and whether it is earning
  | 'forward'            // what management commits to next
  | 'quality'            // whether the output is real: one-offs, cash, WC
  | 'execution';         // what could stop it: delays, bottlenecks, shutdowns

export const VAR_DIMENSION: Record<VarKey, VarDimension> = {
  revenue_growth: 'financial', earnings_growth: 'financial',
  operating_leverage: 'financial', margin: 'financial',
  margin_driver: 'operating_driver', raw_materials: 'operating_driver',

  capacity: 'operating_driver', capacity_addition: 'operating_driver',
  utilisation: 'operating_driver', new_plant: 'operating_driver',
  commissioning: 'capital', capacity_bottleneck: 'execution',

  order_intake: 'demand', order_book: 'demand',
  book_to_bill: 'demand', revenue_visibility: 'demand',

  capex: 'capital', capex_status: 'capital', capex_earning: 'capital',
  maintenance_vs_growth: 'capital',

  new_customer: 'demand', customer_loss: 'demand',
  customer_concentration: 'demand', new_product: 'operating_driver',
  qualification: 'operating_driver', approval: 'operating_driver',

  volume: 'operating_driver', price: 'operating_driver',
  mix: 'operating_driver', exports: 'demand',

  guidance: 'forward', management_target: 'forward', promise_vs_actual: 'forward',

  cash_conversion: 'quality', working_capital: 'quality', fcf: 'quality',
  debt: 'quality', roce: 'quality', one_offs: 'quality',

  supply_bottleneck: 'execution', execution_delay: 'execution', shutdown: 'execution',
  market_share: 'demand', pricing_power: 'operating_driver', technology: 'operating_driver',
};

export const DIMENSION_LABEL: Record<VarDimension, string> = {
  financial: 'financial output',
  operating_driver: 'operating driver',
  demand: 'demand',
  capital: 'capital deployment',
  forward: 'forward commitment',
  quality: 'earnings quality',
  execution: 'execution',
};

// ═══════════════════════════════════════════════════════════════════════════
// WHY A VARIABLE IS ABSENT.                                         (zzz723)
//
// A hollow ○ used to mean seven different things at once: not searched, not
// read, not disclosed, mentioned unclearly, not applicable, present in another
// document, or an extraction that failed. Those are completely different facts
// and they lead to different actions — "read the filing" versus "the company
// does not disclose this" versus "this does not apply to a services business".
//
// NOT_READ is the only one that is the reader's fault and the only one a
// button can fix. Keeping them apart is what turns this from a dashboard into
// a database worth querying next quarter.
export type AbsenceReason =
  /** No evidence document has been read for this holding yet. */
  | 'not_read'
  /** The sources could not be reached — not the same as silence. (zzz765) */
  | 'source_unavailable'
  /** A document WAS read and is silent on this. Absence is itself evidence. */
  | 'not_disclosed'
  /** The variable cannot apply to this business (utilisation of a lender). */
  | 'not_applicable'
  /** Mentioned, but not in a form that can be read as a figure or direction. */
  | 'unclear'
  /** ── THE ABSENCE NO FILING CAN FILL.                            (zzz757)
   *
   *  Revenue growth, earnings growth, margin, cash conversion and ROCE are
   *  computed from filed STATEMENTS by the grading engine, not read out of
   *  a concall. A company with no graded and no screener row therefore has
   *  them blank however many documents are read — and the page was telling
   *  the owner "0/2 core variables checked · EVIDENCE NOT YET REVIEWED" on
   *  holdings where three documents HAD been read and thirteen facts
   *  extracted. Pressing the read button again can never change it. */
  | 'no_grader_row';

export const ABSENCE_MARK: Record<AbsenceReason, { mark: string; label: string; hint: string }> = {
  not_read: { mark: '○', label: 'not read',
    hint: 'No evidence document has been read for this holding yet. This is the only absence a button can fix.' },
  source_unavailable: { mark: '⚠', label: 'source unavailable',
    hint: 'The documents could not be fetched on the last attempt (timeout or server error). This says nothing about what the company disclosed; retry the read.' },
  not_disclosed: { mark: '—', label: 'not disclosed',
    hint: 'A document was read and says nothing about this. Absence is evidence: a company that stops disclosing utilisation has told you something.' },
  not_applicable: { mark: 'n/a', label: 'not applicable',
    hint: 'This variable cannot apply to this kind of business, so it is never counted against the thesis.' },
  no_grader_row: { mark: '⊘', label: 'no figures on file',
    hint: 'This figure is computed from the filed statements by the grading engine, and this company has no graded or screener row. Reading more filings cannot fill it — the name needs to enter the graded universe first.' },
  unclear: { mark: '?', label: 'unclear',
    hint: 'Mentioned in the document but not in a form that can be read as a figure or a direction.' },
};

/**
 * ── VARIABLES WHERE SILENCE IS THE GOOD ANSWER.                   (zzz757)
 *
 * The F · PROFIT JUMP ledger makes one-offs a CORE variable, and its
 * invalidation condition is "The jump is traced to one-off or below-the-line
 * items." Sixteen holdings sat at EVIDENCE INCOMPLETE reading "Missing:
 * one-offs" with three documents read apiece — and what that actually means
 * is that three documents were searched and NO one-off was found. That is
 * the forensic test PASSING, and the page was filing it as a gap.
 *
 * These variables describe things that go WRONG. A read that found none of
 * them is a check that passed, and it is recorded as flat — never as
 * improving, because absence is not a positive finding either.
 *
 * The rule holds only after a document was genuinely read. Where nothing was
 * read, silence means nothing at all.
 */
export const SILENCE_IS_A_PASS: ReadonlySet<VarKey> = new Set<VarKey>([
  'one_offs', 'customer_loss', 'execution_delay', 'shutdown',
  'capacity_bottleneck', 'supply_bottleneck',
]);

/**
 * ── ONLY THE THESIS'S OWN MECHANISM MAY MOVE ITS STATUS.            (zzz773)
 *
 * LLOYDSENT, JINDRILL, TI, CLEANMAX and EXICOM read "THESIS WEAKENING —
 * thesis-critical mechanism deteriorating … No stated thesis-break condition
 * has been met" on a generic rule: earnings down, margin down, any holding,
 * any thesis. The owner's rule: a variable may change a thesis's status only
 * when it is mapped to that thesis type. A deterioration anywhere else is
 * context — shown as WATCH, never status-changing.
 *
 *   A · OPERATING INFLECTION  utilisation, volume, price / mix, operating
 *                             leverage, capacity (and the capex that fills it)
 *   B · DEMAND EXPLOSION      orders, order book, book-to-bill, customers,
 *                             programme conversion into revenue
 *   F · PROFIT JUMP           earnings, margin, cash conversion — and the
 *                             forensic checks on them (one-offs, working capital)
 *   G · SILENT QUALITY        the compounding itself: earnings, revenue,
 *                             margin, cash, returns, balance sheet
 *   UNCLASSIFIED              no thesis type on file: only the ledger's own
 *                             base case (revenue direction) and an outright
 *                             customer loss. Earnings and margin are watch.
 */
export const THESIS_STATUS_VARS: Readonly<Record<string, ReadonlySet<VarKey>>> = {
  A: new Set<VarKey>(['utilisation', 'volume', 'price', 'mix', 'margin_driver', 'operating_leverage',
    'capacity', 'capacity_addition', 'commissioning', 'capex_earning', 'capacity_bottleneck']),
  B: new Set<VarKey>(['order_book', 'order_intake', 'book_to_bill', 'revenue_visibility', 'new_customer',
    'customer_loss', 'customer_concentration', 'execution_delay', 'revenue_growth']),
  F: new Set<VarKey>(['earnings_growth', 'margin', 'cash_conversion', 'one_offs', 'margin_driver', 'working_capital']),
  G: new Set<VarKey>(['earnings_growth', 'revenue_growth', 'margin', 'cash_conversion', 'roce', 'debt', 'one_offs']),
  UNCLASSIFIED: new Set<VarKey>(['revenue_growth', 'customer_loss']),
};

/**
 * ── A LAST-YEAR FIGURE IS HISTORY, NOT THIS QUARTER'S EVIDENCE.     (zzz773)
 *
 * The screener's cash conversion and ROCE are LAST FULL YEAR's ratios. On a
 * Q1 FY27 card "cash conversion −7.62× (last FY)" drove "THESIS WEAKENING —
 * thesis-critical mechanism deteriorating". A historical figure is shown as
 * history and does not change the current-period status — unless it is a
 * thesis-critical PERSISTENT condition of that thesis type, and then it is
 * labelled "historical / unresolved".
 */
export const HISTORICAL_PERSISTENT: Readonly<Record<string, ReadonlySet<VarKey>>> = {
  F: new Set<VarKey>(['cash_conversion']),
  G: new Set<VarKey>(['cash_conversion', 'roce']),
};

/** A variable's evidence can only ever be one of these three things, and the
 *  spec is explicit that they must never merge. */
export type EvidenceKind =
  /** The document states it as a fact about the period reported. */
  | 'fact'
  /** Management asserts it about the future or about causes. */
  | 'claim'
  /** This engine derived it from stated figures. Arithmetic only. */
  | 'derived';

// ═══════════════════════════════════════════════════════════════════════════
// PER-VARIABLE EVIDENCE STATE.                                    (zzz770)
//
// The owner's rule: once evidence has been read, a variable never shows a bare
// "—". It shows WHICH of seven different facts it is, because they lead to
// different actions:
//
//   FOUND               a value was read (a direction, a level, a statement)
//   NOT_DISCLOSED       documents were read and are silent on it
//   NOT_SEARCHED        nothing that could carry it has been read yet
//   UNCLEAR             read, but not in a form that can be judged (a ratio
//                       whose sign or denominator is ambiguous)
//   NOT_APPLICABLE      it cannot apply to this business or this thesis
//   SOURCE_UNAVAILABLE  the source that carries it is not on file
//   RETRIEVAL_FAILED    a fetch failed — says nothing about the company
//
// UNCLEAR is never counted as contradicted, NOT_APPLICABLE never as pending.
// ═══════════════════════════════════════════════════════════════════════════
export type EvidenceState =
  | 'FOUND' | 'NOT_DISCLOSED' | 'NOT_SEARCHED' | 'UNCLEAR'
  | 'NOT_APPLICABLE' | 'SOURCE_UNAVAILABLE' | 'RETRIEVAL_FAILED';

export const EVIDENCE_STATE_META: Record<EvidenceState, { word: string; short: string; hint: string }> = {
  FOUND: { word: 'FOUND', short: 'found', hint: 'A value was read from the evidence.' },
  NOT_DISCLOSED: { word: 'NOT DISCLOSED', short: 'not disclosed',
    hint: 'The documents read say nothing about this. Unknown — never counted against the thesis.' },
  NOT_SEARCHED: { word: 'NOT SEARCHED', short: 'not searched',
    hint: 'No document that could carry this has been read yet. Unknown, not bad.' },
  UNCLEAR: { word: 'UNCLEAR', short: 'unclear',
    hint: 'Read, but not in a form that can be judged either way. Counted neither as confirmed nor as contradicted.' },
  NOT_APPLICABLE: { word: 'N/A', short: 'n/a',
    hint: 'Not relevant to this business or this thesis. Never counted as pending.' },
  SOURCE_UNAVAILABLE: { word: 'SOURCE UNAVAILABLE', short: 'source unavailable',
    hint: 'The source that carries this figure is not on file. Says nothing about the company.' },
  RETRIEVAL_FAILED: { word: 'RETRIEVAL FAILED', short: 'retrieval failed',
    hint: 'A fetch failed on the last attempt. Says nothing about what the company disclosed.' },
};

/** The state an absence reason maps to. */
export function stateOfAbsence(a: AbsenceReason | null | undefined, retrievalFailed = false): EvidenceState {
  switch (a) {
    case 'not_read': return 'NOT_SEARCHED';
    case 'source_unavailable': return retrievalFailed ? 'RETRIEVAL_FAILED' : 'SOURCE_UNAVAILABLE';
    case 'not_disclosed': return 'NOT_DISCLOSED';
    case 'not_applicable': return 'NOT_APPLICABLE';
    case 'unclear': return 'UNCLEAR';
    case 'no_grader_row': return 'SOURCE_UNAVAILABLE';
    default: return 'NOT_SEARCHED';
  }
}

/** Short document names for "searched current filing + concall". */
export function searchedPhrase(docs: Array<{ kind?: string | null; label?: string | null }> | null | undefined): string {
  const names: string[] = [];
  for (const d of docs || []) {
    const k = `${d.kind || ''} ${d.label || ''}`.toLowerCase();
    const n = /transcript|concall|earnings call/.test(k) ? 'concall'
      : /presentation|\bppt\b|deck/.test(k) ? 'presentation'
        : /annual report/.test(k) ? 'annual report'
          : /result|financial/.test(k) ? 'results filing'
            : /announcement|reg(?:ulation)?\.? ?30|press/.test(k) ? 'exchange announcement'
              : 'filing';
    if (!names.includes(n)) names.push(n);
  }
  return names.length ? names.join(' + ') : '';
}

/** The words a card prints for a variable in a given state — never a bare dash.
 *  `reason` is the specific cause for UNCLEAR / N/A when one is known. */
export function evidenceStateLine(state: EvidenceState, o: { docs?: Array<{ kind?: string | null; label?: string | null }> | null; reason?: string | null } = {}): string {
  const searched = searchedPhrase(o.docs);
  switch (state) {
    case 'FOUND': return 'FOUND';
    case 'NOT_DISCLOSED': return `NOT DISCLOSED — ${searched ? `searched ${searched}` : o.reason || 'searched the documents read'}`;
    case 'NOT_SEARCHED': return 'NOT SEARCHED — no document that could carry it has been read yet';
    case 'UNCLEAR': return `UNCLEAR — ${o.reason || 'read, but not in a form that can be judged'}`;
    case 'NOT_APPLICABLE': return `N/A — ${o.reason || 'not relevant to this thesis'}`;
    case 'SOURCE_UNAVAILABLE': return `SOURCE UNAVAILABLE — ${o.reason || 'the source that carries it is not on file'}`;
    case 'RETRIEVAL_FAILED': return `RETRIEVAL FAILED — ${o.reason || 'the last fetch failed; nothing is inferred from it'}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICES / SOFTWARE — WHERE A PLANT DOES NOT EXIST.             (zzz770)
//
// Capacity and utilisation are physical variables. For a software, IT-services
// or financial-services business they are not "pending" — there is no plant to
// fill — so they are NOT_APPLICABLE. The detection is deliberately
// conservative: it needs an explicit sector/industry word or several services
// words in the company's own text, and never fires on a manufacturer that
// merely mentions software. A variable that IS disclosed is always kept.
// ═══════════════════════════════════════════════════════════════════════════
export const PHYSICAL_CAPACITY_VARS: ReadonlySet<VarKey> = new Set<VarKey>([
  'capacity', 'capacity_addition', 'utilisation', 'capacity_bottleneck', 'new_plant',
]);
const SERVICES_SECTOR = /\b(it services|information technology|software|saas|technology services|it consulting|consulting|bpo|bpm|business process|staffing|recruitment|edtech|education services|banks?|banking|nbfc|non[- ]banking|financial services|insurance|asset management|wealth management|broking|stock ?broking|capital markets|fintech)\b/i;
const MANUFACTURING = /\b(manufactur\w*|plants?|factory|factories|mtpa|tonnes?|tons?|kld|mw\b|utili[sz]ation|capacity additions?|installed capacity|production lines?|dipping lines?|forging|casting|smelter|refinery|furnace|reactor|kiln|spindles?|looms?|gpus?|data cent(?:re|er)s?)\b/i;
const SERVICES_TEXT = /\b(software|saas|subscription|licen[cs]e revenue|annual recurring revenue|\barr\b|headcount|attrition|billable|offshore|onsite|digital transformation|it services|consulting|deal wins?|tcv|clients? (?:in|across)|loan book|aum|disbursements?|net interest margin|\bnim\b|gross npa|premiums?|policyholders?|brokerage|services (?:segment|revenue|business)|engineering services|deal (?:momentum|pipeline|wins?)|anchor accounts?|revenue cycle management)\b/gi;

export interface BusinessProfile { sector?: string | null; industry?: string | null; text?: string | null }

// ── zzz837: businesses with no physical capacity, by industry WORD (never a ticker).
// Each carries the alternates the type documents in place of capacity / utilisation.
export type NoPlantKind = 'exchange' | 'it_services' | 'retail' | 'media' | 'leisure' | 'ports' | 'insurance_finance';
const NO_PLANT_WORDS: Array<{ kind: NoPlantKind; re: RegExp; what: string; alternates: string }> = [
  { kind: 'exchange', re: /\b(stock ?exchange|commodity exchange|exchange and data platform|market infrastructure|depositor(?:y|ies)|clearing corporation)\b/i,
    what: 'an exchange / market infrastructure business', alternates: 'transaction volumes, market share and operating leverage' },
  { kind: 'it_services', re: /\b(it services|it[- ]enabled|information technology|software|saas|technology services|it consulting|consulting|bpo|bpm|business process|staffing|recruitment|engineering services|it\s*[-–]\s*(?:software|services))\b/i,
    what: 'an IT / technology-services business', alternates: 'order book / deal wins, headcount and revenue per employee' },
  { kind: 'retail', re: /\b(retail(?:ing)?|e-?commerce|online marketplace|department stores?|fashion retail|apparel retail|eyewear|jewellery retail|supermarkets?|trading)\b/i,
    what: 'a retail / trading business', alternates: 'same-store sales growth, store additions and volume growth' },
  { kind: 'media', re: /\b(media|entertainment|broadcast\w*|publishing|music|television|radio|ott)\b/i,
    what: 'a media / content business', alternates: 'subscriber or user growth, content volume and volume growth' },
  { kind: 'leisure', re: /\b(leisure|amusement|theme parks?|hospitality|resorts?|hotels?|restaurants?|cinemas?|multiplex)\b/i,
    what: 'a leisure / consumer-services business', alternates: 'visitor / footfall growth and same-store growth' },
  { kind: 'ports', re: /\b(ports?|port services|port operations|shipping)\b/i,
    what: 'a ports / shipping business', alternates: 'cargo volume growth and order book' },
  { kind: 'insurance_finance', re: /\b(insurance|nbfc|non[- ]banking|financial services|banks?|banking|asset management|wealth management|broking|fintech|capital markets)\b/i,
    what: 'an insurance / finance business', alternates: 'premium or AUM growth and volume growth' },
];
/** Pure: the no-plant kind from the industry / sector label words, else null.
 *  A label that names plant words is never classified here. */
export function noPlantBusinessOf(b: BusinessProfile | null | undefined): { kind: NoPlantKind; reason: string; alternates: string } | null {
  if (!b) return null;
  const label = `${b.sector || ''} ${b.industry || ''}`.trim();
  if (!label || MANUFACTURING.test(label)) return null;
  for (const w of NO_PLANT_WORDS) {
    if (w.re.test(label)) return { kind: w.kind, reason: `${w.what} (industry "${label}") has no physical capacity to fill`, alternates: w.alternates };
  }
  return null;
}

/** True only on clear evidence of a services / software / financial business. */
export function isServicesBusiness(b: BusinessProfile | null | undefined): boolean {
  if (!b) return false;
  const label = `${b.sector || ''} ${b.industry || ''}`.trim();
  if (label && SERVICES_SECTOR.test(label) && !MANUFACTURING.test(label)) return true;
  if (noPlantBusinessOf(b)) return true;
  const text = String(b.text || '');
  if (!text) return false;
  const hits = new Set((text.match(SERVICES_TEXT) || []).map((s) => s.toLowerCase()));
  const phys = (text.match(new RegExp(MANUFACTURING.source, 'gi')) || []).length;
  return hits.size >= 3 && phys === 0;
}

/** Business text from what the row actually carries: a graded row's sector /
 *  industry if present, and the read summary's own descriptive sentences. */
export function businessProfileOf(graded: any | null | undefined, summary: any | null | undefined): BusinessProfile | null {
  const s = summary || {};
  const parts: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v.trim()) parts.push(v); };
  push(s.verdict_line); push(s.mix_shift); push(s.management);
  for (const g of Array.isArray(s.segments) ? s.segments : []) { push(g?.name); push(g?.detail); }
  for (const p of Array.isArray(s.positives) ? s.positives : []) { push(p?.label); push(p?.detail); }
  const sector = graded?.sector ?? graded?.industry_group ?? null;
  const industry = graded?.industry ?? null;
  if (!parts.length && !sector && !industry) return null;
  return { sector: sector ? String(sector) : null, industry: industry ? String(industry) : null, text: parts.join(' · ') || null };
}
