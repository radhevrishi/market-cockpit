// zzz839 — Catalyst Score (0–12) for every AI Daily Gainers item, India and USA.
//
// SCORING ONLY. Nothing here changes a rank, a class, a status or a count.
// Pure and deterministic: no price, no AI call, no network. The move (%) is
// never an input — the score is about the EVENT, not the reaction.
//
//   Catalyst Score = Evidence + Mechanism + Duration + Materiality
//                    + (2 − Execution risk) + Confirmation          (max 12)
//
// Each factor is 0 / 1 / 2. A factor the data cannot support is UNSCORED
// (unknown ≠ negative): it adds 0 to the total but is listed, and the card
// shows the highest the score could reach if it were established.
//
// Execution risk scale used here: 0 = low, 1 = manageable, 2 = high, and the
// contribution is 2 − risk (a low-risk event earns 2 points).
//
// Bands: 9–12 RESEARCH NOW · 6–8 WATCH / CONFIRM · 0–5 IGNORE.
// Hard rule: Evidence below 2 (the primary document has not been read)
// can never be RESEARCH NOW. Weak-catalyst types drop one band unless they
// are part of an earnings story. The score means "worth researching" — it
// is not a valuation and not a recommendation.

import type { ResearchItem } from './research-view';

export type FactorKey = 'evidence' | 'mechanism' | 'duration' | 'materiality' | 'execution' | 'confirmation';
export interface ScoreFactor {
  key: FactorKey;
  label: string;
  /** 0–2 points this factor adds to the total (execution: 2 − risk). Null = unscored (unknown). */
  points: number | null;
  /** The 0/1/2 rating as the framework states it (execution: the RISK 0/1/2). Null = unscored. */
  rating: number | null;
  /** Plain reason, from the item's own facts. */
  why: string;
}
export type ScoreBand = 'RESEARCH NOW' | 'WATCH / CONFIRM' | 'IGNORE' | 'NEGATIVE — CHECK RISK' | 'NOT SCORED';
export type DurationTier = 0 | 1 | 2 | 3;

export interface CatalystScore {
  /** False when there is no catalyst event to score (no event / price move only / data unavailable). */
  scored: boolean;
  /** Why not scored, when scored is false. */
  notScoredReason?: string;
  total: number | null;
  max: 12;
  /** Highest the total could reach if every unscored factor turned out to be 2. Equals total when nothing is unscored. */
  ceiling: number | null;
  band: ScoreBand;
  /** One line stating the band and any cap that applied. */
  bandNote: string;
  factors: ScoreFactor[];
  unscored: string[];
  /** Tier 0 noise · 1 temporary · 2 multi-quarter · 3 structural (null when duration is unknown). */
  durationTier: DurationTier | null;
  durationTierLabel: string | null;
  /** True when the event type is on the weak-catalyst list and is not part of an earnings story. */
  weakType: string | null;
  /** True when the evidence rule (Evidence < 2) held the band down. */
  evidenceCapped: boolean;
  /** Event → revenue → utilisation → margin → cash → EPS → future orders → expectations, each step "stated" or "not established". */
  chain: Array<{ step: string; status: 'stated' | 'not established' }>;
  /** Event value against the existing business (order ÷ TTM revenue, ÷ order book, ÷ capacity, ÷ market cap), only where a document-verified figure exists. */
  versusBusiness: string[];
  /** Who pays / funded / customer / firm vs conditional / start / working capital / balance sheet / track record. */
  executionTests: Array<{ test: string; answer: string }>;
  /** What to watch in the next 2–4 quarters. */
  kpis: string[];
  /** What would make the catalyst fail. */
  invalidation: string[];
  disclaimer: string;
}

export const SCORE_DISCLAIMER = 'Worth-researching score for the event — not a valuation and not a recommendation. Price and the size of the move are not used.';

const HALF = ['0', '1', '2'];
void HALF;

const WEAK_TYPES: Array<{ test: (it: ResearchItem, hay: string) => boolean; name: string }> = [
  { test: (it) => it.eventType === 'Buyback', name: 'buyback' },
  { test: (it) => /index inclusion/i.test(it.eventLabel || ''), name: 'index inclusion (fund flow, not an operating change)' },
  { test: (it) => it.eventType === 'Promoter buying', name: 'promoter purchase' },
  { test: (it) => it.eventType === 'Capital allocation', name: 'capital allocation' },
  { test: (it) => it.eventType === 'Rating action' || it.subtype === 'credit_rating', name: 'credit rating action' },
  { test: (it) => it.eventType === 'Management change', name: 'management appointment' },
  { test: (it) => it.subtype === 'subsidiary', name: 'subsidiary incorporation' },
  { test: (it) => it.subtype === 'store_launch' || it.subtype === 'dealership', name: 'small store / dealership opening' },
  { test: (it) => it.subtype === 'tax_demand', name: 'one-off tax matter' },
  { test: (it) => it.subtype === 'price_commentary' || !!it.priceCommentaryOnly, name: 'price commentary (circuit / broker target)' },
  { test: (_it, h) => /\b(?:final |interim |special )?dividend\b/.test(h), name: 'dividend' },
  { test: (_it, h) => /\bbonus (?:shares?|issue)\b/.test(h), name: 'bonus issue' },
  { test: (it, h) => /\b(?:mou|memorandum of understanding)\b/.test(h) && (it.stage === 'PROPOSED' || it.stage === 'UNKNOWN' || it.stage === 'RUMOUR'), name: 'vague MoU' },
];

const KPI_BY_TYPE: Record<string, string[]> = {
  'Earnings': ['Revenue growth vs the same quarter last year', 'Operating margin', 'Operating cash flow', 'Order book / guidance for the next quarters'],
  'Order win': ['Order-book growth and revenue booked from the order', 'Execution start date and billing milestones', 'Operating margin on the order', 'Receivable days / working capital'],
  'Customer win': ['Revenue from the named customer', 'Repeat or follow-on orders', 'Operating margin on the contract'],
  'Contract': ['Revenue recognised under the contract', 'Renewal or extension', 'Margin on the contract'],
  'Capacity expansion': ['Commissioning date', 'Capacity utilisation', 'Revenue per unit of new capacity', 'Capex spent vs plan'],
  'Production ramp': ['Volume per quarter', 'Capacity utilisation', 'Gross margin at scale'],
  'New product': ['First revenue from the product', 'Customer adoption / repeat orders', 'Gross margin'],
  'Pricing': ['Realisation per unit next quarter', 'Volume response', 'Gross margin'],
  'Guidance': ['Actual result vs the guided range next quarter', 'Order book behind the guide'],
  'Acquisition': ['Revenue and margin contribution of the acquired business', 'Integration milestones', 'Net debt after the deal'],
  'Merger': ['Combined revenue and margin', 'Synergy delivered vs stated', 'Net debt'],
  'JV': ['First revenue from the venture', 'Capital committed vs plan'],
  'Partnership': ['Revenue or volume from the partnership', 'Definitive agreement, if this is an MoU'],
  'Strategic expansion': ['Capex spent vs plan', 'First revenue from the expansion'],
  'Regulatory approval': ['Launch date and first sales', 'Revenue in the approved indication / product', 'Label or price restrictions'],
  'Divestment': ['Cash received and use of proceeds', 'Earnings lost from the divested unit'],
};
const KPI_DEFAULT = ['Whether a later filing states revenue or margin from this event'];

const INVALIDATION_BY_TYPE: Record<string, string[]> = {
  'Order win': ['Order cancelled, deferred or cut', 'Margin on the order below the company average', 'Working capital absorbs the cash'],
  'Customer win': ['Customer volumes fall short or the contract is not renewed'],
  'Contract': ['Termination, delay or a lower scope than stated'],
  'Capacity expansion': ['Commissioning slips or utilisation stays low', 'Demand for the new capacity does not appear'],
  'Production ramp': ['Volumes stall or yields disappoint'],
  'New product': ['No customer adoption within two quarters'],
  'Earnings': ['Next quarter reverses the improvement', 'Margin gain proves one-off'],
  'Pricing': ['Price is reversed or volume falls by more than the price gain'],
  'Guidance': ['Guide is cut or missed'],
  'Acquisition': ['Deal fails to close', 'Integration cost or debt is larger than stated'],
  'Regulatory approval': ['Approval is narrowed, delayed or withdrawn'],
};

function has(s: unknown): s is string { return typeof s === 'string' && s.trim().length > 0; }

function hayOf(it: ResearchItem): string {
  return [it.headline, it.eventLabel, it.whatChanged].filter(has).join(' ').toLowerCase();
}

/** The event this card shows is a real, scoreable event (not a no-catalyst / price-only / data-failure row). */
function scoreable(it: ResearchItem): string | null {
  if (it.eventClass === 'DATA_UNAVAILABLE') return 'Data was unavailable — nothing to score (not a "no catalyst" finding).';
  if (it.eventClass === 'LISTING') return 'Recent listing — excluded from comparison.';
  if (it.eventClass === 'MARKET_MOVE_ONLY' || it.eventType === 'Market/technical move') return 'Market or technical move only — no event to score.';
  const lab = `${it.eventLabel || ''} ${it.usCard?.catalysts?.[0]?.label || ''}`.toLowerCase();
  if (/sector\/theme sympathy|law-firm notice|investor-litigation/.test(lab) || it.subtype === 'price_commentary' && it.priceCommentaryOnly) return 'No company event (sympathy move, law-firm notice or price commentary) — nothing to score.';
  if (it.eventClass === 'NO_CATALYST' || it.eventType === 'No identified catalyst') return 'No classifiable event in the filings — read the filing; any press item is unverified — nothing to score yet.';
  return null;
}

function evidenceOf(it: ResearchItem): ScoreFactor {
  const ev = it.evidenceVerification;
  const label = 'Evidence';
  if (it.priceCommentaryOnly || it.stage === 'RUMOUR') return { key: 'evidence', label, points: 0, rating: 0, why: 'Rumour / price commentary — not evidence of an event.' };
  if (ev === 'document_read') return { key: 'evidence', label, points: 2, rating: 2, why: 'The primary filing was read and contains the event.' };
  if (ev === 'contradicted') return { key: 'evidence', label, points: 0, rating: 0, why: 'Another source contradicts the headline value — treated as unverified until resolved.' };
  if (ev === 'document_not_read') return { key: 'evidence', label, points: 1, rating: 1, why: 'A filing exists but its document was not read — not verified.' };
  if (ev === 'secondary_only') return { key: 'evidence', label, points: 1, rating: 1, why: 'Press / summary only — no primary filing read.' };
  if (ev === 'none') return { key: 'evidence', label, points: 0, rating: 0, why: 'No source found for the headline event.' };
  // Older items without the split fields: fall back to the source confidence.
  if (it.sourceConfidence === 'VERIFIED_DOCUMENT') return { key: 'evidence', label, points: 2, rating: 2, why: 'Primary document verified.' };
  if (it.sourceConfidence === 'VERIFIED_FILING' || it.sourceConfidence === 'SECONDARY_SUMMARY') return { key: 'evidence', label, points: 1, rating: 1, why: 'Filing or summary on file; document not confirmed as read.' };
  return { key: 'evidence', label, points: 0, rating: 0, why: 'Unverified source.' };
}

function mechanismOf(it: ResearchItem): ScoreFactor {
  const label = 'Earnings mechanism';
  const revRatio = (it.materiality?.ratios || []).find((r) => r.basis === 'ttm_revenue' || r.basis === 'annual_revenue' || r.basis === 'order_book' || r.basis === 'ebitda');
  const earn = it.earnings && (it.earnings as any);
  if (it.eventType === 'Earnings' && earn) return { key: 'mechanism', label, points: 2, rating: 2, why: 'Reported results — the effect on revenue / profit is stated in the filing.' };
  if (revRatio && it.materiality?.verification !== 'PENDING') return { key: 'mechanism', label, points: 2, rating: 2, why: `Quantified path to revenue: ${revRatio.text}.` };
  if (it.transmission === 'DIRECT' || it.transmission === 'NEAR_TERM') return { key: 'mechanism', label, points: 1, rating: 1, why: 'A plausible route to revenue or profit, but the amount or timing is not quantified.' };
  if (it.transmission === 'LONG_TERM') return { key: 'mechanism', label, points: 1, rating: 1, why: 'A long-dated route to earnings; not quantified.' };
  if (it.transmission === 'WEAK' || it.transmission === 'NONE') return { key: 'mechanism', label, points: 0, rating: 0, why: 'No clear route from this event to earnings.' };
  return { key: 'mechanism', label, points: null, rating: null, why: 'Route to earnings not established.' };
}

export function durationTierOf(it: ResearchItem): { tier: DurationTier | null; label: string | null } {
  const p = it.potentialDuration?.value ?? it.persistence;
  if (!p || p === 'UNKNOWN') return { tier: null, label: null };
  if (p === 'DAYS') return { tier: 0, label: 'Tier 0 — noise (0–1 quarter)' };
  if (p === 'QUARTER') return { tier: 1, label: 'Tier 1 — temporary (1–3 quarters)' };
  const c = it.durations?.contractual || '';
  const yrs = /(\d+(?:\.\d+)?)\s*-?\s*(?:year|yr)/i.exec(c);
  if (yrs && Number(yrs[1]) >= 3) return { tier: 3, label: 'Tier 3 — structural (multi-year)' };
  return { tier: 2, label: 'Tier 2 — multi-quarter (4–8+ quarters)' };
}

function durationOf(it: ResearchItem): ScoreFactor {
  const label = 'Duration';
  const { tier } = durationTierOf(it);
  const basis = it.potentialDuration?.basis === 'TYPE' ? ' (by event type — not evidence)' : '';
  if (tier == null) return { key: 'duration', label, points: null, rating: null, why: 'How long the effect lasts is not established.' };
  if (tier === 0) return { key: 'duration', label, points: 0, rating: 0, why: `One-off / days-long effect${basis}.` };
  if (tier === 1) return { key: 'duration', label, points: 1, rating: 1, why: `Effect lasts about 2–3 quarters${basis}.` };
  return { key: 'duration', label, points: 2, rating: 2, why: `Effect can run 4+ quarters${basis}.` };
}

function materialityOf(it: ResearchItem): ScoreFactor {
  const label = 'Materiality';
  const m = it.materiality;
  if (!m || m.label === 'UNKNOWN') return { key: 'materiality', label, points: null, rating: null, why: 'Size against the business not established (value not disclosed or not verified).' };
  if (m.label === 'SIGNIFICANT') return { key: 'materiality', label, points: 2, rating: 2, why: `Large against the business${m.ratios[0] ? `: ${m.ratios[0].text}` : ''}.` };
  if (m.label === 'MODERATE') return { key: 'materiality', label, points: 1, rating: 1, why: `Moderate${m.ratios[0] ? `: ${m.ratios[0].text}` : ''}.` };
  return { key: 'materiality', label, points: 0, rating: 0, why: `Small${m.ratios[0] ? `: ${m.ratios[0].text}` : ' against the business'}.` };
}

function executionOf(it: ResearchItem): ScoreFactor {
  const label = 'Execution risk';
  const t = it.eventType;
  let risk: number | null = null; let why = '';
  if (t === 'Earnings') { risk = 0; why = 'Already reported — nothing left to execute.'; }
  else if (it.stage === 'OPERATIONAL' || it.stage === 'MONETIZING' || it.stage === 'EXECUTED') { risk = 0; why = 'Already executing or delivering.'; }
  else if (it.stage === 'SIGNED' || it.stage === 'AWARDED') { risk = 1; why = 'Signed / awarded — delivery still ahead.'; }
  else if (it.stage === 'ENABLING' || it.stage === 'PROPOSED' || it.stage === 'RUMOUR') { risk = 2; why = 'Not yet contracted or built — a proposal / enabling step only.'; }
  if (risk != null) {
    if (it.durations?.capacity?.demand === 'absent' && risk < 2) { risk = 2; why = 'Capacity or licence without demand on file — capability is not demand.'; }
    else if ((it.flags?.dilution || it.valueStatus === 'conflicting') && risk < 2) { risk += 1; why += it.flags?.dilution ? ' Funding involves dilution.' : ' Value conflict on file.'; }
  }
  if (risk == null) return { key: 'execution', label, points: null, rating: null, why: 'Stage of delivery not established.' };
  return { key: 'execution', label, points: 2 - risk, rating: risk, why: `${['Low', 'Manageable', 'High'][risk]} risk: ${why}` };
}

function kpisOf(it: ResearchItem): string[] {
  const base = KPI_BY_TYPE[it.eventType] || [];
  return [...base, ...((it.durations?.nextEvidence || []).filter(has))].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);
}

function confirmationOf(it: ResearchItem): ScoreFactor {
  const label = 'Confirmation';
  const k = KPI_BY_TYPE[it.eventType];
  if (k && k.length >= 3) return { key: 'confirmation', label, points: 2, rating: 2, why: 'Clear quarterly numbers will show whether it worked (by event type).' };
  if (k && k.length >= 1) return { key: 'confirmation', label, points: 1, rating: 1, why: 'Some measurable follow-up numbers (by event type).' };
  if (it.eventType === 'No identified catalyst') return { key: 'confirmation', label, points: null, rating: null, why: 'No event.' };
  return { key: 'confirmation', label, points: 0, rating: 0, why: 'Hard to measure in later results (by event type).' };
}

function chainOf(it: ResearchItem): CatalystScore['chain'] {
  const tc = (it.transmissionChain || []).join(' ').toLowerCase();
  const stated = (re: RegExp) => (re.test(tc) && !/tbd|not disclosed|not established/.test((tc.match(re) || [''])[0]) ? 'stated' : 'not established') as 'stated' | 'not established';
  const r = it.materiality?.ratios?.length ? 'stated' : 'not established';
  const e = it.earnings ? 'stated' : 'not established';
  return [
    { step: 'Event', status: it.headline ? 'stated' : 'not established' },
    { step: 'Revenue', status: r },
    { step: 'Utilisation', status: it.durations?.capacity ? 'stated' : 'not established' },
    { step: 'Margin', status: stated(/margin[^→>]*/) },
    { step: 'Cash', status: stated(/(?:cash|fcf)[^→>]*/) },
    { step: 'EPS', status: e === 'stated' ? 'stated' : stated(/eps[^→>]*/) },
    { step: 'Future orders', status: it.durations?.revenueVisibility ? 'stated' : 'not established' },
    { step: 'Expectations', status: it.expectationGap && it.expectationGap.level !== 'UNKNOWN' ? 'stated' : 'not established' },
  ];
}

function testsOf(it: ResearchItem): CatalystScore['executionTests'] {
  const na = 'Not established';
  const firm = it.stage === 'SIGNED' || it.stage === 'AWARDED' || it.stage === 'EXECUTED' || it.stage === 'OPERATIONAL' || it.stage === 'MONETIZING' ? 'Firm (signed / awarded / executing)'
    : it.stage === 'PROPOSED' || it.stage === 'RUMOUR' || it.stage === 'ENABLING' ? 'Conditional / proposed' : na;
  const acq = it.acquisition as any;
  return [
    { test: 'Firm or conditional', answer: firm },
    { test: 'Funded', answer: acq?.financing && String(acq.financing) !== 'Not stated' ? String(acq.financing) : it.flags?.dilution ? 'Through dilution (equity issue)' : na },
    { test: 'Customer named', answer: (it.usCard as any)?.counterparty || (it.inCard as any)?.counterparty || na },
    { test: 'Start date / execution period', answer: it.durations?.contractual || na },
    { test: 'Utilisation needed', answer: it.durations?.capacity?.text || na },
    { test: 'Working capital / balance sheet', answer: na },
    { test: 'Management track record', answer: na },
  ];
}

const BAND_RANK: ScoreBand[] = ['IGNORE', 'WATCH / CONFIRM', 'RESEARCH NOW'];

export function catalystScoreOf(it: ResearchItem): CatalystScore {
  const reason = scoreable(it);
  const empty = (why: string): CatalystScore => ({
    scored: false, notScoredReason: why, total: null, max: 12, ceiling: null, band: 'NOT SCORED', bandNote: why, factors: [], unscored: [],
    durationTier: null, durationTierLabel: null, weakType: null, evidenceCapped: false, chain: [], versusBusiness: [], executionTests: [], kpis: [], invalidation: [], disclaimer: SCORE_DISCLAIMER,
  });
  if (reason) return empty(reason);

  const factors = [evidenceOf(it), mechanismOf(it), durationOf(it), materialityOf(it), executionOf(it), confirmationOf(it)];
  const total = factors.reduce((n, f) => n + (f.points ?? 0), 0);
  const unscored = factors.filter((f) => f.points == null).map((f) => f.label);
  const ceiling = total + 2 * unscored.length;
  const { tier, label: tierLabel } = durationTierOf(it);

  const hay = hayOf(it);
  const earningsStory = it.eventType === 'Earnings' || (it.clusters || []).some((c) => /result|earning|quarter/i.test(c.label));
  const weak = earningsStory ? null : (WEAK_TYPES.find((w) => w.test(it, hay))?.name ?? null);

  let band: ScoreBand = total >= 9 ? 'RESEARCH NOW' : total >= 6 ? 'WATCH / CONFIRM' : 'IGNORE';
  const notes: string[] = [`${total}/12 → ${band}`];
  const evidence = factors[0];
  let evidenceCapped = false;
  if (band === 'RESEARCH NOW' && (evidence.points ?? 0) < 2) {
    band = 'WATCH / CONFIRM'; evidenceCapped = true;
    notes.push('capped: the primary document has not been read (Evidence below 2 is never high conviction)');
  }
  if (weak) {
    const i = Math.max(0, BAND_RANK.indexOf(band) - 1);
    if (BAND_RANK[i] !== band) { band = BAND_RANK[i]; notes.push(`dropped one band: ${weak} is a weak-catalyst type`); }
    else notes.push(`${weak} is a weak-catalyst type`);
  }
  if (it.direction === 'NEGATIVE' || it.eventClass === 'NEGATIVE') {
    band = 'NEGATIVE — CHECK RISK';
    notes.push('the event is negative: the score is its strength, not upside');
  }
  if (unscored.length && ceiling >= 6 && total < 6) notes.push(`could rise to WATCH / CONFIRM once ${unscored.join(', ').toLowerCase()} is established`);
  else if (unscored.length && ceiling >= 9 && total < 9) notes.push(`could reach RESEARCH NOW once ${unscored.join(', ').toLowerCase()} is established`);

  const vs = (it.materiality?.verification !== 'PENDING' ? it.materiality?.ratios || [] : []).map((r) => r.text).filter(has);
  const inv = [
    ...(INVALIDATION_BY_TYPE[it.eventType] || ['A later filing contradicts or withdraws the event']),
    ...((it.catalysts?.[0]?.invalidation && has(it.catalysts[0].invalidation)) ? [String(it.catalysts[0].invalidation)] : []),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);

  return {
    scored: true, total, max: 12, ceiling, band, bandNote: notes.join(' · '), factors, unscored,
    durationTier: tier, durationTierLabel: tierLabel, weakType: weak, evidenceCapped,
    chain: chainOf(it), versusBusiness: vs, executionTests: testsOf(it), kpis: kpisOf(it).length ? kpisOf(it) : KPI_DEFAULT, invalidation: inv, disclaimer: SCORE_DISCLAIMER,
  };
}

/** Short text for a chip: "9/12 · RESEARCH NOW" or "6/12 (3 unknown) · WATCH / CONFIRM". */
export function scoreChipText(s: CatalystScore | null | undefined): string {
  if (!s) return 'Score: —';
  if (!s.scored) return 'Score: not scored';
  return `${s.total}/12${s.unscored.length ? ` (${s.unscored.length} unknown)` : ''} · ${s.band}`;
}

/** The six factors on one line: "E2 M1 D2 Mat1 X2 C2". Unscored = "?". */
export function scoreFactorLine(s: CatalystScore): string {
  const short: Record<FactorKey, string> = { evidence: 'Evidence', mechanism: 'Mechanism', duration: 'Duration', materiality: 'Materiality', execution: 'Execution', confirmation: 'Confirmation' };
  return s.factors.map((f) => `${short[f.key]} ${f.points == null ? '?' : f.points}`).join(' · ');
}
