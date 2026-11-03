// ═══════════════════════════════════════════════════════════════════════════
// zzz1227 — Turnaround → Compounder (the owner's monograph "Turnaround to Compounder", 3 Nov 2026).
//
// Added ON TOP of AI Daily Gainers and Transformational Gainers; nothing existing changes. For one company's event texts and
// filed figures it answers, in plain words:
//   archetype   — OWNERSHIP_RESCUE (new controlling owner / open offer / funded sponsor), BRAND_LICENSE (new brand rights or
//                 licence on an existing distribution system — Timex), FORMAT_SCALING (a store / unit format rolling out — Zudio),
//                 FUNDING_REPAIR (refinancing, settlement, rating upgrade), OPERATING_REVIVAL (loss → profit, or a low-margin
//                 business whose margin and sales recover together — the earnings rule that keeps Timex-type names in view)
//   stage       — the six-stage clock: 0 distress · 1 catalyst · 2 funding / closing · 3 first proof · 4 repeatability ·
//                 5 compounding. 4 and 5 need several periods of figures, which one event never shows, so this never claims them.
//   gates       — survive (can it fund the next 12–24 months?), dilution (new shares / warrants / rights → re-work per-share
//                 value), governance (auditor exit, default, pledge, going concern = hard stop)
//   next proof  — the one observable milestone that moves it to the next stage, and the kill event
// Survival solved and minority-equity returns are separate questions; a famous owner is not a return thesis. Rules only, pure,
// no price input. Research, never a recommendation.
// ═══════════════════════════════════════════════════════════════════════════

export type TaArchetype = 'OWNERSHIP_RESCUE' | 'BRAND_LICENSE' | 'FORMAT_SCALING' | 'FUNDING_REPAIR' | 'OPERATING_REVIVAL';
export type TaStage = 0 | 1 | 2 | 3;
export type TaGate = 'PASS' | 'OPEN' | 'STOP';
export type TaDecision = 'HARD_STOP' | 'RESEARCH' | 'MONITOR' | 'OBSERVE';

export interface TaFacts {
  revenueYoY?: number | null; patYoY?: number | null;
  marginNow?: number | null; marginPrior?: number | null;
  cfoToPat?: number | null;
}

export interface TaInput {
  /** catalyst labels and sentences, headline, what changed, quote — anything the card says */
  texts: Array<string | null | undefined>;
  /** event rule ids when known (in-event-taxonomy / us-event-taxonomy), including negative ones */
  ids?: Array<string | null | undefined>;
  facts?: TaFacts | null;
  /** new shares already flagged by the card */
  dilution?: boolean;
}

export interface Turnaround {
  archetype: TaArchetype;
  archetypeWord: string;
  analogue: string;            // the monograph's model case for this archetype
  stage: TaStage;
  stageWord: string;
  catalyst: string;            // what changed, one line
  proof: string | null;        // operating proof already filed, if any
  gates: { survive: TaGate; dilution: TaGate; governance: TaGate; notes: string[] };
  hardStops: string[];
  nextProof: string;
  killEvent: string;
  decision: TaDecision;
  decisionWord: string;
  /** the monograph's five-line memo, filled as far as the event allows (unknowns say so) */
  memo: string[];
}

const ARCH_WORD: Record<TaArchetype, string> = {
  OWNERSHIP_RESCUE: 'Ownership rescue',
  BRAND_LICENSE: 'Dormant brand / new licence',
  FORMAT_SCALING: 'Format scaling',
  FUNDING_REPAIR: 'Funding repair',
  OPERATING_REVIVAL: 'Operating revival',
};
const ANALOGUE: Record<TaArchetype, string> = {
  OWNERSHIP_RESCUE: 'CG Power 2020 / Satyam 2009 — trap: a famous owner is not a return thesis',
  BRAND_LICENSE: 'Timex 2022 (Guess/Gc rights) — trap: strong brand, weak unit economics',
  FORMAT_SCALING: 'Trent / Zudio — trap: capital-hungry roll-out',
  FUNDING_REPAIR: 'CG Power after the TII funding — trap: dilution takes the recovery',
  OPERATING_REVIVAL: 'Timex FY2023 — trap: one good quarter or a tax credit is not a trend',
};
export const TA_STAGE_WORD: Record<TaStage, string> = {
  0: 'Stage 0 · distress — problems visible, cause uncertain',
  1: 'Stage 1 · catalyst — signed / launched, not yet funded or closed',
  2: 'Stage 2 · funding / closing done — operations still to respond',
  3: 'Stage 3 · first proof — figures respond (repeatability needs 2–4 more periods)',
};
const DECISION_WORD: Record<TaDecision, string> = {
  HARD_STOP: 'Hard gate — risk review before anything else',
  RESEARCH: 'Research — build the dated filing packet and diluted share count',
  MONITOR: 'Monitor milestones — catalyst is real, proof is not',
  OBSERVE: 'Observe — no dated catalyst yet',
};

const has = (t: string, re: RegExp) => re.test(t);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ── what each archetype looks like in a filing ──
// a SAST stake disclosure or the company buying a stake in someone else is NOT an ownership change of this company
const OWNERSHIP_RE = /\b(change (?:in|of) (?:control|management)|controlling (?:stake|interest) (?:in|of) the company|share purchase agreement|open offer|new promoters?|reclassif\w* .{0,30}promoter|takeover of the company|strategic investor|board (?:and management )?reconstitut\w*)\b/i;
const BRAND_RE = /\b(licen[cs]e (?:agreement|rights|deal)|licensing (?:agreement|deal)|brand (?:licen[cs]e|rights)|(?:exclusive )?(?:distribution|manufacturing and distribution|marketing) rights|rights (?:for|in) india|trademark rights|in-licen[cs]\w*)\b/i;
const FORMAT_RE = /\b(\d{2,5}(?:st|nd|rd|th)? (?:stores?|outlets?|showrooms?|restaurants?|clinics?|centres?|centers?)|store (?:roll-?out|expansion|additions?)|same[- ]store sales|like[- ]for[- ]like)\b/i;
const FUNDING_RE = /\b(one[- ]time settlement|\bOTS\b|debt (?:restructuring|resolution|settlement)|refinanc\w*|lenders? (?:approved|sanctioned|agreed)|resolution plan|rating (?:upgrade|upgraded)|upgraded .{0,30}rating|fresh (?:equity|capital|funding)|(?:equity|capital) infusion|rights issue|preferential (?:issue|allotment)|warrants?|qualified institutions? placement|\bQIP\b)\b/i;
const REVIVAL_RE = /\b(turn(?:ed|s)? (?:to )?(?:profit|profitable|around)|return(?:ed)? to (?:profit|profitability|black)|first (?:profitable|profit) (?:quarter|year)|swung to (?:a )?profit|loss to (?:a )?profit|turnaround)\b/i;

// ── stage evidence ──
const DONE_RE = /\b(completed|completion|closed|consummated|transferred|transfer of (?:\d[\d,]* )?shares|acquired|allotted|allotment of|received|infused|disbursed|signed definitive|definitive (?:agreement|documents?) (?:signed|executed)|approved by (?:the )?(?:shareholders|lenders|NCLT|CCI|SEBI)|board (?:and management )?reconstitut\w*)\b/i;
const PROPOSED_RE = /\b(proposed|proposal|letter of intent|\bLOI\b|term sheet|in-principle|subject to|board approved|board has approved|announced|intends?|plans? to|agreed to acquire|will acquire)\b/i;

// ── hard gates ──
const STOP_RE: Array<[RegExp, string]> = [
  [/\b(auditor(?:'s)? resign\w*|resignation of (?:the )?(?:statutory )?auditor)\b/i, 'Auditor resigned'],
  [/\b(going concern)\b/i, 'Going-concern doubt in the accounts'],
  [/\b(qualified (?:audit )?opinion|adverse opinion|disclaimer of opinion)\b/i, 'Qualified / adverse audit opinion'],
  [/\b(default(?:ed)? on|payment default|insolvency|\bCIRP\b|\bNCLT admit\w*|wilful defaulter)\b/i, 'Default / insolvency'],
  [/\b(forensic audit|fraud|siphon\w*|misappropriat\w*)\b/i, 'Fraud / forensic audit'],
];
const PLEDGE_RE = /\b(pledg\w*|encumb\w*)\b/i;
const DILUTION_RE = /\b(rights issue|preferential (?:issue|allotment)|warrants?|\bQIP\b|qualified institutions? placement|fresh issue|conversion of (?:loans?|debt) into equity|equity raise)\b/i;
const LOSS_RE = /\b(net loss|loss of ₹|reported a loss|losses (?:widened|continued))\b/i;

const NEXT: Record<TaArchetype, string> = {
  OWNERSHIP_RESCUE: 'Closing proof: regulatory consent, funds received, board reconstituted — then the first full quarter under the new owner (orders, working capital, margin).',
  BRAND_LICENSE: 'Licensed products on shelves, sell-through and the all-in gross profit after royalty and marketing — not just higher turnover.',
  FORMAT_SCALING: 'New-store cohort productivity, cash invested per store and payback; same-store growth that holds.',
  FUNDING_REPAIR: 'Diluted share count fixed, 12–24 months of funded liquidity, and operating cash turning positive after working capital.',
  OPERATING_REVIVAL: 'Two to four more quarters of normalised profit with operating cash after working capital — strip one-offs and tax credits.',
};
const KILL: Record<TaArchetype, string> = {
  OWNERSHIP_RESCUE: 'The deal or the lender package fails, or the fresh issue leaves old shareholders a small slice of the post-money value.',
  BRAND_LICENSE: 'Sales rise but gross profit after royalty / marketing does not; inventory builds.',
  FORMAT_SCALING: 'New cohorts underperform or the roll-out needs repeated equity.',
  FUNDING_REPAIR: 'Another capital call at a lower price, or refinancing depends on hope.',
  OPERATING_REVIVAL: 'Profit came from a one-off, tax credit or raw-material relief and reverses next quarter.',
};

/** Turnaround reading for one company event, or null when nothing in it is a turnaround catalyst. Pure. */
export function turnaroundOf(x: TaInput): Turnaround | null {
  const texts = (x.texts || []).map((t) => String(t || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = texts.join(' · ');
  const ids = new Set((x.ids || []).map((i) => String(i || '')).filter(Boolean));
  const f = x.facts || {};
  const rev = num(f.revenueYoY), pat = num(f.patYoY), mNow = num(f.marginNow), mPrior = num(f.marginPrior), cfo = num(f.cfoToPat);
  const dm = mNow != null && mPrior != null ? mNow - mPrior : null;

  // the monograph's earnings rule (keeps Timex-type names without an ownership event): sales > 20%, margin up from a LOW base,
  // cash not negative — a low base (margin under 8%) is what separates a revival from an ordinary good quarter
  const earningsRule = rev != null && rev > 20 && dm != null && dm >= 2 && mPrior != null && mPrior < 8 && (cfo == null || cfo >= 0.8);
  // a loss → profit swing on flat or falling sales (under +10%) is cost cuts or a one-off, not yet a revival (owner's monograph:
  // 'one good quarter or a tax credit is not a trend') — it only counts when sales are growing or not known
  const swing = ids.has('turnaround_profit') || ids.has('turned_profitable') || has(all, REVIVAL_RE);
  const revival = (swing && !(rev != null && rev < 10)) || earningsRule;

  let archetype: TaArchetype | null = null;
  if (ids.has('open_offer') || ids.has('strategic_investor') || ids.has('activist_stake') || has(all, OWNERSHIP_RE)) archetype = 'OWNERSHIP_RESCUE';
  // zzz1228: the archetype is a dormant BRAND reborn under a new licence (Timex / Guess). A drug or technology licence
  // (Vir + Gilead collaboration and license) is a pipeline deal, not a brand turnaround
  else if ((ids.has('licensing') || has(all, BRAND_RE)) && !/\b(?:collaboration|clinical|drug|therap\w*|molecule|antibod\w*|vaccine|patent|platform technology|royalt\w*|milestone payments?)\b/i.test(all)) archetype = 'BRAND_LICENSE';
  else if ((ids.has('store_launch') || ids.has('dealership_expansion')) && has(all, FORMAT_RE) || (has(all, FORMAT_RE) && /\bsame[- ]store|like[- ]for[- ]like|\d{3,5}(?:st|nd|rd|th)? stores?\b/i.test(all))) archetype = 'FORMAT_SCALING';
  else if (ids.has('rating_upgrade') || has(all, FUNDING_RE) && /\b(settlement|restructur|refinanc|lender|rating|infusion|fresh (?:equity|capital))/i.test(all)) archetype = 'FUNDING_REPAIR';
  else if (revival) archetype = 'OPERATING_REVIVAL';
  if (!archetype) return null;

  // ── gates ──
  const hardStops: string[] = [];
  for (const [re, why] of STOP_RE) if (re.test(all)) hardStops.push(why);
  if (ids.has('auditor_resignation') && !hardStops.includes('Auditor resigned')) hardStops.push('Auditor resigned');
  if (ids.has('insolvency_default') && !hardStops.includes('Default / insolvency')) hardStops.push('Default / insolvency');
  const notes: string[] = [];
  const loss = has(all, LOSS_RE) || ids.has('net_loss') || (pat != null && pat < -50);
  const funded = has(all, FUNDING_RE) && has(all, DONE_RE);
  const survive: TaGate = hardStops.length ? 'STOP' : loss && !funded && !revival ? 'OPEN' : 'PASS';
  if (survive === 'OPEN') notes.push('Still loss-making and no completed funding in the filing — check 12–24 months of liquidity.');
  const diluting = !!x.dilution || ids.has('equity_raise') || has(all, DILUTION_RE);
  const dilution: TaGate = diluting ? 'OPEN' : 'PASS';
  if (diluting) notes.push('New shares / warrants / rights: re-work earnings and value per FULLY DILUTED share before anything else.');
  const pledge = ids.has('pledge') || has(all, PLEDGE_RE);
  const governance: TaGate = hardStops.length ? 'STOP' : pledge || ids.has('kmp_resignation') || ids.has('independent_director_exit') ? 'OPEN' : 'PASS';
  if (pledge) notes.push('Promoter pledge / encumbrance mentioned — mandatory financing-risk review.');
  if (ids.has('kmp_resignation') || ids.has('independent_director_exit')) notes.push('Senior / independent resignation alongside the event — ask why.');

  // ── stage ──
  const proofParts: string[] = [];
  if (swing) proofParts.push(rev != null && rev < 10 ? 'profit turned positive on flat sales' : 'profit turned positive');
  if (rev != null && rev >= 15) proofParts.push(`sales ${rev >= 0 ? '+' : ''}${Math.round(rev)}%`);
  if (dm != null && dm >= 2) proofParts.push(`margin +${dm.toFixed(1)} points`);
  if (cfo != null && cfo >= 0.8) proofParts.push(`cash conversion ${cfo.toFixed(2)}×`);
  const operatingProof = (proofParts.includes('profit turned positive') || earningsRule) && !(cfo != null && cfo < 0);
  let stage: TaStage;
  if (operatingProof) stage = 3;
  else if (archetype === 'OPERATING_REVIVAL') stage = loss ? 0 : 3;
  else if (has(all, DONE_RE) && !/\b(proposed|subject to|letter of intent|\bLOI\b|term sheet)\b/i.test(all)) stage = 2;
  else if (has(all, PROPOSED_RE) || archetype !== null) stage = 1;
  else stage = 0;

  const catalystLine = texts.find((t) => {
    if (archetype === 'OWNERSHIP_RESCUE') return OWNERSHIP_RE.test(t);
    if (archetype === 'BRAND_LICENSE') return BRAND_RE.test(t);
    if (archetype === 'FORMAT_SCALING') return FORMAT_RE.test(t);
    if (archetype === 'FUNDING_REPAIR') return FUNDING_RE.test(t);
    return REVIVAL_RE.test(t);
  }) || (earningsRule ? `Sales +${Math.round(rev!)}% with margin up ${dm!.toFixed(1)} points from ${mPrior!.toFixed(1)}%` : texts[0] || ARCH_WORD[archetype]);

  const decision: TaDecision = hardStops.length ? 'HARD_STOP' : stage >= 2 && survive !== 'OPEN' ? 'RESEARCH' : stage >= 1 ? 'MONITOR' : 'OBSERVE';
  const proof = proofParts.length ? proofParts.join(', ') : null;
  const memo = [
    `1 · What changed: ${catalystLine.slice(0, 200)}`,
    `2 · Why the franchise could be scarce: not shown by the event — name the asset (brand, customers, approvals, distribution) before going further.`,
    `3 · Where owners can lose permanently: ${[hardStops.length ? hardStops.join(', ') : '', diluting ? 'dilution' : '', pledge ? 'pledge' : '', survive === 'OPEN' ? 'liquidity' : ''].filter(Boolean).join(', ') || 'no red flag in the event — check liquidity, dilution, governance in the filings'}.`,
    `4 · 10-year per-share return at a LOWER exit multiple: not computed here — needs fully diluted EPS in three cases.`,
    `5 · Evidence that changes the decision: ${NEXT[archetype]}`,
  ];
  return {
    archetype, archetypeWord: ARCH_WORD[archetype], analogue: ANALOGUE[archetype],
    stage, stageWord: TA_STAGE_WORD[stage], catalyst: catalystLine.slice(0, 240), proof,
    gates: { survive, dilution, governance, notes }, hardStops,
    nextProof: NEXT[archetype], killEvent: KILL[archetype],
    decision, decisionWord: DECISION_WORD[decision], memo,
  };
}

/** From an AI Daily Gainers research item (India or US card): every catalyst (positive and negative) plus the card's own text. Pure. */
export function turnaroundFromGainer(it: any): Turnaround | null {
  if (!it) return null;
  const us = it.market === 'US';
  const cats: any[] = us ? (it.usCard?.catalysts || []) : (it.inCard?.catalysts || []);
  const fresh = cats.filter((c) => c && !(typeof c.ageDays === 'number' && c.ageDays > 30));
  const e = us ? it.usCard?.earnings : it.earnings;
  return turnaroundOf({
    texts: [it.headline, it.whatChanged, it.quote, ...fresh.flatMap((c) => [c.label, c.sentence])],
    ids: fresh.map((c) => c.id),
    facts: us
      ? { revenueYoY: e?.revenueGrowthPct, patYoY: e?.profitGrowthPct, marginNow: e?.margin?.cur, marginPrior: e?.margin?.prev, cfoToPat: null }
      : { revenueYoY: e?.revenueYoY, patYoY: e?.patYoY, marginNow: e?.marginNow, marginPrior: e?.marginPrior, cfoToPat: e?.cfoToPat },
    dilution: !!it.flags?.dilution,
  });
}

/** From a stored Transformational Gainers row (signals, headline, what changed, quote, filed figures). Pure. */
export function turnaroundFromTg(x: { signals?: string[]; headline?: string | null; whatChanged?: string | null; quote?: string | null; kind?: string; facts?: TaFacts | null; dilution?: boolean }): Turnaround | null {
  return turnaroundOf({
    texts: [x.headline, x.whatChanged, x.quote, ...(x.signals || [])],
    ids: x.kind === 'TURNAROUND' ? ['turnaround_profit'] : [],
    facts: x.facts || null,
    dilution: !!x.dilution,
  });
}
