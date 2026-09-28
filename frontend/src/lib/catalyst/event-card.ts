// ═══════════════════════════════════════════════════════════════════════════
// ONE EVENT, AS A DECISION CARD.                                     (zzz824)
//
// The owner's redesign of "New · last 10 days": EVENT → EVIDENCE → THESIS →
// MATERIALITY → ACTION. Every field below is computed on its own, by a fixed
// rule, from the event's type, what the filing states and the card's thesis
// ledger — never cut out of one text blob:
//
//   evidence_quality  Direct       the filing states a CHANGE (with its prior)
//                     Static       a figure is stated, with no verified prior
//                     Indirect     the event is stated, no figure bears on it
//                     Unproven     not read / could not be read / low-confidence
//                                  extraction / press report only
//                     Conflicting  the evidence disagrees with itself or the ledger
//   evidence_delta    "CHANGE: …" only from a stated prior; otherwise
//                     "LEVEL ONLY — change not established"
//   impact            Supports / Weakens only from a Direct change in a variable
//                     the thesis rests on. An order, acquisition or fund raise
//                     by itself is Neutral — "financial contribution not yet
//                     evidenced". Broken only when the ledger's own break
//                     condition fired on that variable. Unknown is never bad:
//                     unread → "Evidence incomplete", not Weakens.
//   evidence_chain    per event type; ✓ only when the filing or the ledger
//                     evidences that link. next_evidence = the missing links.
//
// Pure: no fetch, no clock, no model. Never invents a number.
// ═══════════════════════════════════════════════════════════════════════════

import { VAR_LABEL } from '../thesis/taxonomy';
import type { RecentEvent } from './recent-events';
import { THESES } from '../thesis/ledger';

export type Impact = 'Supports' | 'Neutral' | 'Weakens' | 'Broken' | 'Evidence incomplete';
export const IMPACTS: Impact[] = ['Supports', 'Neutral', 'Weakens', 'Broken', 'Evidence incomplete'];
/** DIRECT = the filing states the fact (a change with its prior, an amount, a transaction size) · INDIRECT = derived from
 *  commentary / disclosure, no figure bears on it · STATIC = a level with no change established · UNPROVEN = the filing exists but
 *  extraction could not establish the claim (`incomplete` on the card says it could not be read at all) · Conflicting. */
export type EvidenceQuality = 'Direct' | 'Indirect' | 'Static' | 'Unproven' | 'Conflicting';
export type Materiality = 'Material' | 'Notable' | 'Minor' | 'Routine';

/** One thing the evidence says about a thesis variable. `verified` = the filing states the prior too. */
export interface Claim {
  key: string;
  dir: 'up' | 'down' | 'stated';
  verified: boolean;
  text?: string | null;
  /** zzz829: 'xbrl' = the card's SEC XBRL quarter against the same quarter a year earlier (US results). */
  source: 'filing' | 'ledger' | 'xbrl';
}

/** ok = established (✓) · contradicted = the evidence says the opposite (✗) · neither = not yet evidenced (?) */
export interface ChainLink { label: string; ok: boolean; contradicted?: boolean }

/** zzz833: how the event relates to the thesis — never inferred from the mere existence of a thesis or a filing.
 *  Direct = the filing tests a variable registered in this thesis · Indirect = causally related, does not yet establish a
 *  registered variable · No established connection = no defensible mapping · Evidence incomplete = could not be read. */
export type ThesisConnection = 'Direct' | 'Indirect' | 'No established connection' | 'Evidence incomplete';

export interface EventCard {
  eventType: string;
  sourceDocument: string;
  sourceDate: string;
  exchange: string | null;
  materiality: Materiality;
  /** The one number worth reading — only when it means something for this type. */
  keyNumber: string | null;
  /** What happened, in one line. */
  event: string;
  /** What the filing proves ("order disclosed"). */
  evidence: string;
  thesisType: string | null;
  thesisName: string | null;
  thesisVariable: string | null;
  thesisVariableLabel: string | null;
  /** The variable is one the thesis rests on. */
  mapped: boolean;
  impact: Impact;
  why: string;
  quality: EvidenceQuality;
  qualityWhy: string;
  delta: { kind: 'change' | 'increment' | 'level' | 'none'; text: string };
  /** zzz832 — the nullable numbers behind the delta. Null unless the filing states BOTH ends (never invented). */
  previousValue: string | null;
  currentValue: string | null;
  deltaValue: string | null;
  deltaPct: number | null;
  deltaDirection: 'up' | 'down' | null;
  /** zzz832 — economic realization is a different question from thesis impact. */
  realization: string;
  /** A consideration that is not a thesis variable (funding cost, dilution, …) — only when no variable is affected. */
  secondary: string | null;
  /** One short deterministic reason a Material event is Material. */
  whyMaterial: string | null;
  /** NEEDS ATTENTION: the trigger, and what to look at next. */
  whyNow: string | null;
  nextInvestigation: string | null;
  /** Evidence-chain progress (leading ✓ links) — not a score. */
  stage: { done: number; total: number } | null;
  chain: ChainLink[] | null;
  /** "execution → revenue → margin" — the links still missing, in order. */
  next: string | null;
  /** "Order → execution" — the last evidenced link and the first missing one. */
  gap: string | null;
  /** Why this belongs under NEEDS ATTENTION, when it does. */
  attention: string | null;
  lowConfidence: boolean;
  /** zzz833 — independent fields (event ≠ observed variable ≠ thesis link ≠ impact). */
  eventSubtype: string | null;
  /** What the filing observed ("Order book (RPO)", "Revenue", "Debt") — need not be a thesis variable. */
  observed: string | null;
  connection: ThesisConnection;
  /** One deterministic sentence from the evidence and the ledger — never AI, never generic. */
  whyMatters: string | null;
  /** Management events: Investigate (CEO/CFO resign or terminated) · Monitor · Routine. */
  priority: 'Investigate' | 'Monitor' | 'Routine' | null;
  /** Filing exists / parsed / financial evidence / mechanism evidence / thesis evidence — five separate facts. */
  evidenceStatus: { filed: boolean; parsed: boolean; financial: boolean; mechanism: boolean; thesis: boolean };
}

export interface CardInput {
  type: string;
  importance: 'Material' | 'Notable' | 'Minor';
  routine?: boolean;
  read: 'read' | 'failed' | 'pending' | 'not-needed';
  badge: 'filed' | 'press';
  /** The lead filing's subject. */
  title: string;
  /** The line the tab shows (legacy `what`). */
  what: string;
  line: string | null;
  figure: string | null;
  claims: Claim[];
  ctx: { pattern: string | null; fit?: 'exact' | 'provisional' | null; assessment?: any } | null;
  noImpact?: boolean;
  senior?: boolean;
  lowConfidence?: boolean;
  sourceDoc: string;
  exchange: string | null;
  date: string;
  ratingAction?: string | null;
  market?: 'IN' | 'US';
  /** zzz829 (US): the metrics the headline can carry a delta for — a change in another metric of the same filing is
   *  never printed as the headline's delta (it still counts for impact, and is listed as "also in this filing"). */
  headKeys?: string[] | null;
  /** zzz829 (US): why a results event has no year-ago comparison from the card's SEC XBRL figures. */
  xbrlNote?: string | null;
}

const varLabel = (v: string | null | undefined): string => (v && (VAR_LABEL as Record<string, string>)[v]) || String(v || '').replace(/_/g, ' ');

/** Variables an event of this type can speak to, most direct first. */
const TYPE_VARS: Record<string, string[]> = {
  'Order win': ['order_intake', 'order_book', 'book_to_bill', 'revenue_visibility'],
  'Capex / capacity': ['capacity_addition', 'capacity', 'commissioning', 'new_plant', 'capex', 'capex_status', 'utilisation', 'capex_earning'],
  'Results': ['revenue_growth', 'earnings_growth', 'margin', 'operating_leverage', 'cash_conversion'],
  'Acquisition': [],   // zzz832: a transaction names no thesis variable by itself — only a claim the filing makes does
  'Divestment': [],
  'Fund raise': [],
  'Regulatory approval': ['approval', 'qualification', 'new_product'],
  'Guidance': ['guidance', 'management_target'],
  'Credit rating': [],
  'Concall / business update': [],
};

/** The chain an event of this type must travel before it is earnings. `n` = how many missing links NEXT shows. */
const CHAINS: Record<string, { links: Array<[string, string]>; n: number }> = {
  'Order win': { links: [['ORDER', 'order'], ['EXECUTION', 'execution'], ['REVENUE', 'revenue'], ['MARGIN', 'margin'], ['CASH', 'cash']], n: 3 },
  'Capex / capacity': { links: [['CAPEX', 'capex'], ['COMMISSIONED', 'commissioning'], ['UTILISATION', 'utilisation'], ['REVENUE', 'revenue'], ['ROCE', 'ROCE']], n: 3 },
  'Results': { links: [['SALES', 'sales'], ['PROFIT', 'profit'], ['MARGIN', 'margin'], ['CASH', 'cash'], ['FUTURE', 'future outlook']], n: 2 },
  'Acquisition': { links: [['ACQUISITION', 'acquisition'], ['INTEGRATION', 'integration'], ['REVENUE', 'revenue'], ['MARGIN', 'margin'], ['EPS/FCF', 'EPS/FCF']], n: 4 },
  'Regulatory approval': { links: [['APPROVAL', 'approval'], ['COMMERCIALIZATION', 'commercialization'], ['VOLUME', 'volume'], ['REVENUE', 'revenue'], ['MARGIN', 'margin']], n: 3 },
  'Fund raise': { links: [['FUND RAISE', 'fund raise'], ['CAPITAL DEPLOYMENT', 'capital deployment'], ['EARNINGS/RETURN IMPACT', 'earnings/return impact']], n: 2 },
  'Divestment': { links: [['DIVESTMENT', 'divestment'], ['PROCEEDS RECEIVED', 'proceeds received'], ['USE OF PROCEEDS', 'use of proceeds'], ['RETURN IMPACT', 'return impact']], n: 2 },
  'Corporate restructuring': { links: [['SCHEME', 'scheme'], ['APPROVAL', 'approval'], ['EFFECTIVE', 'effective date'], ['BUSINESS TRANSFER', 'business transfer'], ['EARNINGS', 'earnings impact']], n: 3 },
  'Management change': { links: [['CHANGE', 'change'], ['SUCCESSION/RESPONSIBILITY', 'succession / responsibility'], ['BUSINESS CONTINUITY', 'business continuity'], ['OPERATING EFFECT', 'operating effect']], n: 3 },
  'Credit rating': { links: [['RATING', 'rating'], ['FUNDING COST', 'funding cost'], ['LIQUIDITY', 'liquidity'], ['CASH FLOW', 'cash flow']], n: 3 },
};

/** zzz825: SEC chains — the same card model, US wording and US links. An 8-K Item 1.01 contract travels
 *  CONTRACT → EXECUTION → REVENUE → MARGIN → CASH; an FDA / regulatory approval travels APPROVAL →
 *  COMMERCIALIZATION → VOLUME → REVENUE; an offering (Item 3.02, 424B, S-3) is dilution until the proceeds
 *  are deployed. Results keep SALES → PROFIT → MARGIN → CASH → GUIDANCE. */
const CHAINS_US: Record<string, { links: Array<[string, string]>; n: number }> = {
  'Order win': { links: [['CONTRACT', 'contract'], ['EXECUTION', 'execution'], ['REVENUE', 'revenue'], ['MARGIN', 'margin'], ['CASH', 'cash']], n: 3 },
  'Regulatory approval': { links: [['APPROVAL', 'approval'], ['COMMERCIALIZATION', 'commercialization'], ['VOLUME', 'volume'], ['REVENUE', 'revenue']], n: 3 },
  'Fund raise': { links: [['OFFERING', 'offering'], ['PROCEEDS', 'proceeds received'], ['USE OF PROCEEDS', 'use of proceeds'], ['EARNINGS/RETURN IMPACT', 'earnings/return impact']], n: 2 },
  'Acquisition': { links: [['DEAL', 'deal'], ['CLOSING', 'closing'], ['INTEGRATION', 'integration'], ['REVENUE', 'revenue'], ['EPS/FCF', 'EPS/FCF']], n: 3 },
  'Divestment': { links: [['DISPOSAL', 'disposal'], ['PROCEEDS RECEIVED', 'proceeds received'], ['USE OF PROCEEDS', 'use of proceeds'], ['RETURN IMPACT', 'return impact']], n: 2 },
  'Results': { links: [['SALES', 'sales'], ['PROFIT', 'profit'], ['MARGIN', 'margin'], ['CASH', 'cash'], ['GUIDANCE', 'guidance']], n: 2 },
};
/** zzz833: a fund raise is not one thing. Debt travels BORROWING → PROCEEDS → DEPLOYMENT → INTEREST COST → EARNINGS/FCF;
 *  equity (and a convertible, which is both) travels OFFERING → SHARES ISSUED → DILUTION → DEPLOYMENT → EPS/FCF. */
const CHAIN_DEBT: { links: Array<[string, string]>; n: number } = { links: [['BORROWING', 'borrowing'], ['PROCEEDS', 'proceeds received'], ['DEPLOYMENT', 'deployment'], ['INTEREST COST', 'interest cost'], ['EARNINGS/FCF', 'earnings / FCF']], n: 3 };
const CHAIN_EQUITY: { links: Array<[string, string]>; n: number } = { links: [['OFFERING', 'offering'], ['SHARES ISSUED', 'shares issued'], ['DILUTION', 'dilution'], ['DEPLOYMENT', 'deployment'], ['EPS/FCF', 'EPS / FCF']], n: 3 };
const CHAIN_CONVERT: { links: Array<[string, string]>; n: number } = { links: [['OFFERING', 'offering'], ['CONVERSION TERMS', 'conversion terms'], ['DILUTION', 'dilution'], ['DEPLOYMENT', 'deployment'], ['EPS/FCF', 'EPS / FCF']], n: 3 };
/** Pure: the chain spec for an event type in a market (and, for a fund raise, its subtype). */
export function chainSpec(type: string, market: 'IN' | 'US' = 'IN', subtype?: string | null): { links: Array<[string, string]>; n: number } | null {
  if (market === 'US' && type === 'Fund raise' && subtype) {
    if (DEBT_SUBTYPES.has(subtype)) return CHAIN_DEBT;
    if (subtype === 'Convertible') return CHAIN_CONVERT;
    return CHAIN_EQUITY;
  }
  return (market === 'US' ? CHAINS_US[type] : null) || CHAINS[type] || null;
}

const DEBT_SUBTYPES = new Set(['Debt issuance', 'Debt refinancing', 'Credit facility']);
export type FundRaiseSubtype = 'Debt issuance' | 'Debt refinancing' | 'Credit facility' | 'Equity issuance' | 'ATM' | 'Private placement' | 'Convertible' | 'Preferred' | 'Warrant' | 'Secondary offering' | 'Other capital raise';
/** Pure: the fund-raise subtype from the filing's words (title + extracted line). Equity is never called debt and debt is
 *  never called equity: notes / credit words decide debt, share words decide equity, both → Convertible. */
export function fundRaiseSubtype(text: string | null | undefined): FundRaiseSubtype {
  const t = String(text || '');
  if (/(?<!non[- ])convertible/i.test(t)) return 'Convertible';
  if (/at[- ]the[- ]market|\bATM\b/i.test(t)) return 'ATM';
  if (/secondary offering|selling (?:stock|share)holders?|resale/i.test(t)) return 'Secondary offering';
  if (/credit (?:facility|agreement)|revolv|term loan|loan agreement|line of credit/i.test(t)) return 'Credit facility';
  if (/refinanc|redemption of|repay(?:ment)? of/i.test(t) && /notes?|debt|facility|loan/i.test(t)) return 'Debt refinancing';
  if (/\b(?:senior|subordinated|secured|unsecured)?\s*notes?\b(?:\s+due)?|debentures?|\bbonds?\b|indenture/i.test(t) && !/common stock|ordinary shares/i.test(t)) return 'Debt issuance';
  if (/preferred (?:stock|shares|units)|series [A-Z] preferred/i.test(t)) return 'Preferred';
  if (/\bwarrants?\b/i.test(t) && !/no warrants/i.test(t)) return 'Warrant';
  if (/private placement|unregistered sale|item\s*3\.02|\bPIPE\b|exempt from registration/i.test(t)) return 'Private placement';
  if (/common stock|ordinary shares|public offering|\b424B\d?\b|\bS-3\b|prospectus|underwritten|registered direct|equity offering/i.test(t)) return 'Equity issuance';
  return 'Other capital raise';
}

/** Pure: a management event, classified from the filing's own words. Never inferred from Item 5.02 alone. */
export function managementEvent(text: string | null | undefined): { label: string; role: 'CEO' | 'CFO' | 'other executive' | 'director' | 'board' | 'unknown'; action: string; priority: 'Investigate' | 'Monitor' | 'Routine' } {
  const t = String(text || '');
  const role: 'CEO' | 'CFO' | 'other executive' | 'director' | 'board' | 'unknown' =
    /chief executive officer|\bCEO\b|managing director\s*(?:&|and)\s*(?:CEO|chief executive)/i.test(t) ? 'CEO'
    : /chief financial officer|\bCFO\b/i.test(t) ? 'CFO'
    : /chief (?:operating|technology|revenue|marketing|legal|accounting|product|information|commercial) officer|\bCOO\b|\bCTO\b|\bCRO\b|\bCAO\b|president|general counsel|executive vice president|\bEVP\b|managing director|\bofficers?\b/i.test(t) ? 'other executive'
    : /committee|board (?:size|composition)|bylaws?|charter/i.test(t) ? 'board'
    : /\bdirector\b|board of directors|independent director|chair(?:man|person|woman)?/i.test(t) ? 'director' : 'unknown';
  const action =
    /terminat|removed|dismiss|not (?:be )?re-?appointed|for cause/i.test(t) ? 'termination'
    : /resign|step(?:s|ped)? down|cessation|departure|depart/i.test(t) ? 'resignation'
    : /retire/i.test(t) ? 'retirement'
    : /succession|succeed|successor|transition/i.test(t) ? 'planned succession'
    : /appoint|elect|named|join|hire/i.test(t) ? 'appointment'
    : /committee|restructur|expand|reduc|increase the size/i.test(t) ? 'restructuring' : 'change';
  const roleW = role === 'unknown' ? 'management' : role === 'other executive' ? 'executive' : role;
  const label = role === 'board' ? 'Board / committee change' : role === 'unknown' ? 'Management change (role not stated)' : `${roleW} ${action}`;
  const c = role === 'CEO' || role === 'CFO';
  const priority: 'Investigate' | 'Monitor' | 'Routine' =
    c && (action === 'resignation' || action === 'termination') ? 'Investigate'
    : role === 'board' || (role === 'director' && action !== 'termination') ? 'Routine'
    : 'Monitor';
  return { label: label.charAt(0).toUpperCase() + label.slice(1), role, action, priority };
}

/** Event types that are a transaction: by themselves they change no financial variable. */
const TRANSACTION = /^(?:Order win|Acquisition|Fund raise|Divestment|Corporate restructuring)$/;

function checkedRow(ctx: CardInput['ctx'], key: string | null): any | null {
  if (!key || !Array.isArray(ctx?.assessment?.checked)) return null;
  return ctx!.assessment.checked.find((c: any) => c?.key === key) || null;
}
/** A ledger row that carries a real value (not silence, not "not disclosed"). */
function ledgerHas(ctx: CardInput['ctx'], key: string, improving = false): boolean {
  const c = checkedRow(ctx, key);
  if (!c || c.silence) return false;
  if (c.absence) return false;
  if (!(c.after || c.evidence)) return false;
  return improving ? c.verdict === 'improving' : c.verdict !== 'unknown';
}

function thesisVarsOf(ctx: CardInput['ctx']): Set<string> {
  const fromA = ctx?.assessment?.thesis?.variables;
  const list: any[] = Array.isArray(fromA) && fromA.length ? fromA : ((THESES as any)[String(ctx?.pattern || '').toUpperCase()]?.variables || []);
  return new Set(list.map((v: any) => String(v?.key || v)));
}

/** Pure: the one number worth reading, when it means something for this type. */
export function keyNumberOf(type: string, line: string | null, figure: string | null): string | null {
  if (/^(?:Corporate action|Credit rating|Management change|Exchange clarification|Shareholding disclosure|Promoter holding change|Other filing)$/.test(type)) return null;
  const l = String(line || '');
  if (type === 'Results') {
    const r = /\b(?:Revenue|PAT|EBITDA)\s+[₹$][\d,.]+(?:\s?(?:Cr|lakh|million|billion|mn|bn))?(?:\s\((?:up|down)\s[\d.]+%\))?/.exec(l);
    return r ? r[0] : figure;
  }
  if (type === 'Acquisition') {
    const st = /\((\d+(?:\.\d+)?% stake)\)/.exec(l)?.[1];
    const money = /for\s+((?:₹|Rs\.?|INR|\$)\s?[\d,.]+\s?(?:crores?|Cr|lakhs?|million|billion|mn|bn)?)/i.exec(l)?.[1];
    return [st, money].filter(Boolean).join(' · ') || null;
  }
  if (type === 'Capex / capacity') {
    const cap = /Capacity .+?(?=,|$)/.exec(l)?.[0];
    return cap ? cap.replace(/^Capacity\s+(?:addition\s+)?/, '') : figure;
  }
  const money = /(?:₹|Rs\.?|INR|US\$|\$)\s?[\d,]+(?:\.\d+)?(?:\s?(?:crores?|Cr\b|lakhs?|lacs?|million|billion|mn\b|bn\b))?/i.exec(l)?.[0];
  if (money && /(?:crore|cr\b|lakh|lac|million|billion|mn\b|bn\b)/i.test(money)) return money.replace(/^Rs\.?\s?|^INR\s?/i, '₹');
  if (money) {
    const n = parseFloat(money.replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n >= 100000) return money.replace(/^Rs\.?\s?|^INR\s?/i, '₹');
  }
  return figure && /[₹$]|crore|\bCr\b|%/.test(figure) ? figure : null;
}

function evidenceWords(inp: CardInput, unread: boolean): string {
  // zzz825: an SEC offering is never opened (the form says what it is) — its words come from the form
  const formSays = inp.market === 'US' && inp.type === 'Fund raise' && inp.read === 'not-needed';
  if (unread && !formSays) return inp.read === 'failed' ? 'filing subject only — the document could not be opened' : inp.read === 'pending' ? 'filing subject only — document being read' : 'filing subject only';
  const l = String(inp.line || '');
  switch (inp.type) {
    case 'Order win':
      if (inp.market === 'US') return /backlog|remaining performance obligation/i.test(l) ? 'backlog stated' : 'contract / material agreement disclosed';
      return /order book/i.test(l) && !/^Order (?:from|worth)/i.test(l) ? 'order book stated' : 'order disclosed';
    case 'Results': {
      const had = [/\b(?:Revenue|Sales)\b/.test(l) && 'sales', /\b(?:PAT|profit)\b/i.test(l) && 'profit', /margin/i.test(l) && 'margin'].filter(Boolean) as string[];
      // zzz833: SEC XBRL is evidence even when the narrative states no headline figure — say which is which
      const xk: Record<string, string> = { revenue_growth: 'sales', earnings_growth: 'profit', margin: 'margin', operating_leverage: 'margin', cash_conversion: 'cash' };
      const xb = Array.from(new Set(inp.claims.filter((c) => c && c.source === 'xbrl' && xk[c.key]).map((c) => xk[c.key])));
      if (xb.length && !had.length) return `SEC XBRL figures extracted (${xb.join(', ')}); narrative headline not stated`;
      const all = Array.from(new Set([...had, ...xb]));
      return all.length ? `results figures stated: ${all.join(', ')}${xb.length ? ' (SEC XBRL)' : ''}` : 'results filing read; no financial figures extracted — evidence incomplete';
    }
    case 'Capex / capacity': return /→/.test(l) ? 'capacity before and after stated' : /commission/i.test(l) ? 'commissioning disclosed' : 'capacity / capex disclosed';
    case 'Acquisition': return `acquisition disclosed${/stake/.test(l) ? ', stake stated' : ''}${/for\s+(?:₹|Rs|INR|\$)/i.test(l) ? ', consideration stated' : ''}`;
    case 'Fund raise':
      if (inp.market === 'US') {
        const st = fundRaiseSubtype(`${inp.title} ${inp.line || ''} ${inp.sourceDoc}`);
        if (DEBT_SUBTYPES.has(st)) return st === 'Debt issuance' ? 'debt offering — notes, no new shares (no dilution)' : `${st.toLowerCase()} — borrowing, no new shares (no dilution)`;
        if (st === 'Convertible') return 'convertible — debt now, dilution if converted';
        if (st === 'Other capital raise') return 'capital raise disclosed — type not stated in the extract';
        return /\b424B\d?\b|\bS-[13]\b|\bF-[13]\b|prospectus|shelf/i.test(`${inp.title} ${inp.sourceDoc}`) ? `${st.toLowerCase()} — offering / shelf registered (dilution)` : `${st.toLowerCase()} — new shares (dilution)`;
      }
      return /allot/i.test(`${inp.title} ${inp.sourceDoc}`) ? 'allotment disclosed' : 'fund raise disclosed';
    case 'Divestment': return 'sale / disposal disclosed';
    case 'Regulatory approval': return 'approval disclosed';
    case 'Credit rating': return 'rating action disclosed';
    case 'Corporate action': return 'corporate action disclosed';
    case 'Regulatory / legal action': return inp.noImpact ? 'authority action disclosed — company states no material impact' : 'authority action disclosed';
    case 'Management change': return managementEvent(`${inp.title} ${inp.lowConfidence ? '' : l}`).label.toLowerCase() + ' disclosed';
    case 'Guidance': return 'management guidance stated';
    case 'Concall / business update': return 'management statement / presentation';
    case 'Exchange clarification': return "company's reply to the exchange";
    default: return 'document read';
  }
}

function chainOf(inp: CardInput, unread: boolean, sub: string | null = null): ChainLink[] | null {
  const c = chainSpec(inp.type, inp.market || 'IN', sub);
  if (!c) return null;
  const l = String(inp.line || '');
  const ctx = inp.ctx;
  const ok: boolean[] = c.links.map(() => false);
  const contradicted: boolean[] = c.links.map(() => false);
  // the first link is the event itself — evidenced by the filing that discloses it
  ok[0] = inp.badge === 'filed' || !unread;
  switch (inp.type) {
    case 'Results': {
      // zzz833: SEC XBRL (or a verified before → after) is evidence even when the narrative states no headline figure
      const cl = (keys: string[]) => inp.claims.filter((x) => x && keys.includes(x.key) && (x.verified || x.source === 'xbrl'));
      const node = (i: number, keys: string[], re: RegExp, alt = false) => {
        const cs = cl(keys);
        if (cs.some((x) => x.dir === 'down') && !cs.some((x) => x.dir === 'up')) { contradicted[i] = true; ok[i] = false; return; }
        ok[i] = cs.length > 0 || re.test(l) || alt;
      };
      node(0, ['revenue_growth'], /\b(?:Revenue|Sales)\b/);
      node(1, ['earnings_growth'], /\b(?:PAT|profit|net income|EBITDA)\b/i);
      node(2, ['margin', 'operating_leverage'], /margin/i);
      node(3, ['cash_conversion', 'fcf'], /cash flow|free cash|operating cash/i, ledgerHas(ctx, 'cash_conversion') || ledgerHas(ctx, 'fcf'));
      node(4, ['guidance'], /guidance|outlook/i, ledgerHas(ctx, 'guidance'));
      break;
    }
    case 'Fund raise':
      if (inp.market === 'US' && sub) {
        const t = `${inp.title} ${l}`;
        if (DEBT_SUBTYPES.has(sub)) ok[1] = /(?:closed|completed|consummated)\s+(?:its|the|an?)?\s*(?:offering|issuance|sale|placement)|closing of the (?:offering|sale|issuance)/i.test(t) && !/expected to close|will close/i.test(t);
        else ok[1] = /\d[\d,]{3,}\s+(?:shares|units)/i.test(t);
      }
      break;
    case 'Capex / capacity':
      ok[1] = /commission|commercial (?:production|operation)|operational/i.test(l) || ledgerHas(ctx, 'commissioning');
      ok[2] = ok[1] && ledgerHas(ctx, 'utilisation');
      ok[3] = ok[2] && ledgerHas(ctx, 'capex_earning', true);
      ok[4] = ok[3] && ledgerHas(ctx, 'roce');
      break;
    case 'Regulatory approval':
      ok[1] = /\blaunch(?:ed)?\b|commercial(?:ly)? (?:launch|supplies|sale|availability)|now available/i.test(l);
      break;
    case 'Acquisition':
      // US 8-K Item 2.01 reports a COMPLETED deal — the closing link is the filing itself
      if (inp.market === 'US') ok[1] = /2\.01|complet(?:ed|ion)|closed|consummat/i.test(`${inp.title} ${l}`);
      break;
    case 'Corporate restructuring':
      ok[1] = /sanctioned by the NCLT|no-objection|approved by the board/i.test(l);
      ok[2] = /\beffective\b/i.test(l);
      break;
    case 'Management change':
      ok[1] = /\b(?:appointed|appointment|succe(?:ed|ssor|ssion)|replac|interim|additional charge|new role)\b/i.test(`${inp.title} ${l}`);
      break;
    case 'Credit rating':
      break;
    case 'Divestment':
      ok[1] = /received|completed/i.test(l) && !/receivable/i.test(l);
      break;
    default: break; // an order, an acquisition, a fund raise: nothing downstream can be evidenced by the same filing
  }
  // zzz832: a stated capacity ADDITION starts the chain at CAPACITY (a capex announcement starts it at CAPEX)
  const capAdd = inp.type === 'Capex / capacity' && isCapacityIncrement(l);
  return c.links.map(([label], i) => ({ label: i === 0 && capAdd ? 'CAPACITY' : label, ok: ok[i], ...(contradicted[i] ? { contradicted: true } : {}) }));
}

/** A capacity line that states an amount ADDED (or a before → after) — not a plan, target or proposal. */
export function isCapacityIncrement(line: string | null | undefined): boolean {
  const l = String(line || '');
  if (!/\d/.test(l)) return false;
  if (/\b(?:proposed|planned|plans?|target(?:ed)?|expected|proposes|will (?:be )?add|to be added|upcoming)\b/i.test(l)) return false;
  return /\b(?:added|addition|adds)\b|→/i.test(l);
}
/** The money amount of an order line, when it states one. */
export function orderAmountOf(line: string | null | undefined): string | null {
  const l = String(line || '');
  const m = /(?:₹|Rs\.?|INR|US\$|\$)\s?[\d,]+(?:\.\d+)?\s?(?:crores?|Cr\b|lakhs?|lacs?|million|billion|mn\b|bn\b)/i.exec(l);
  return m ? m[0].replace(/^Rs\.?\s?|^INR\s?/i, '₹') : null;
}

/** Pure: the two ends of a stated "A → B (+x%)" change — null unless BOTH ends are in the text; the % is computed only
 *  when both ends are the same unit, else the filing's own stated % is used. Never invents a previous value. */
export function parseChange(text: string | null | undefined): { previous: string; current: string; deltaValue: string | null; deltaPct: number | null; direction: 'up' | 'down' | null } | null {
  const t = String(text || '');
  const i = t.indexOf('→');
  if (i < 0) return null;
  const NUM = /[$₹]?\d[\d,]*(?:\.\d+)?\+?(?:\s?[A-Za-z][A-Za-z/]*)?/g;
  const left = t.slice(0, i), right = t.slice(i + 1);
  const lm = left.match(NUM), rm = right.match(NUM);
  if (!lm || !rm) return null;
  const previous = lm[lm.length - 1].trim(), current = rm[0].trim();
  const split = (x: string) => { const m = /^[$₹]?(\d[\d,]*(?:\.\d+)?)(\+?)\s?(.*)$/.exec(x)!; return { n: parseFloat(m[1].replace(/,/g, '')), unit: m[3].toLowerCase() }; };
  const a = split(previous), b = split(current);
  const stated = /\(([+\-−]?\d+(?:\.\d+)?)%\)/.exec(right)?.[1];
  let pct: number | null = null, dv: string | null = null;
  if (Number.isFinite(a.n) && Number.isFinite(b.n) && a.n > 0 && a.unit === b.unit) {
    pct = Math.round(((b.n - a.n) / a.n) * 1000) / 10;
    const d = Math.round((b.n - a.n) * 100) / 100;
    dv = `${d > 0 ? '+' : ''}${d.toLocaleString('en-IN')}${a.unit ? ` ${a.unit}` : ''}`;
  } else if (stated != null) pct = parseFloat(stated.replace('−', '-'));
  const direction = pct == null ? (Number.isFinite(a.n) && Number.isFinite(b.n) && a.unit === b.unit ? (b.n > a.n ? 'up' : b.n < a.n ? 'down' : null) : null) : pct > 0 ? 'up' : pct < 0 ? 'down' : null;
  return { previous, current, deltaValue: dv, deltaPct: pct, direction };
}

const SECONDARY: Record<string, string> = {
  'Credit rating': 'Funding cost / balance sheet',
  'Fund raise': 'Balance sheet / dilution',
  'Acquisition': 'Capital allocation / integration',
  'Divestment': 'Balance sheet / business focus',
  'Corporate restructuring': 'Structure / earnings comparability',
  'Management change': 'Continuity / governance',
  'Regulatory / legal action': 'Contingent liability / compliance',
  'Regulatory approval': 'Product / market access',
  'Order win': 'Revenue visibility',
  'Capex / capacity': 'Future capacity',
};

function whyNowOf(inp: CardInput): { now: string; next: string } | null {
  const txt = `${inp.title} ${inp.line || ''}`;
  if (inp.type === 'Management change' && inp.senior) {
    const role = /Managing Director\s*(?:&|and)\s*(?:Chief Executive Officer|CEO)|\bMD\s*(?:&|and)\s*CEO\b/i.test(txt) ? 'MD & CEO'
      : /Chief Executive Officer|\bCEO\b/i.test(txt) ? 'CEO' : /Chief Financial Officer|\bCFO\b/i.test(txt) ? 'CFO'
      : /Managing Director|\bMD\b/i.test(txt) ? 'MD' : /Chairman|Chairperson/i.test(txt) ? 'Chairman' : /Whole[- ]time Director/i.test(txt) ? 'Whole-time Director'
      : /Chief Operating Officer|\bCOO\b/i.test(txt) ? 'COO' : 'Senior management';
    const acts = [/resign|cessation|step(?:s|ped)? down/i.test(txt) && 'resignation', /appoint/i.test(txt) && 'appointment', /new role|change in (?:role|designation)/i.test(txt) && 'change in role'].filter(Boolean);
    return { now: `${role} ${acts.length ? acts.join(' / ') : 'change'}`, next: 'Succession + stated reason + operating responsibility.' };
  }
  if (inp.type === 'Regulatory / legal action' && !inp.noImpact) {
    const w = /property[- ]tax/i.test(txt) ? 'Property-tax demand/notice' : /\btax\b/i.test(txt) ? 'Tax demand/notice' : /show[- ]cause/i.test(txt) ? 'Show-cause notice'
      : /penalt|\bfine\b/i.test(txt) ? 'Penalty / fine' : /\bnotice\b|\bdemand\b/i.test(txt) ? 'Notice / demand' : /\border\b/i.test(txt) ? 'Authority order' : 'Authority action';
    return { now: `${w} disclosed`, next: 'Amount + payment/settlement status + business impact.' };
  }
  if (inp.type === 'Credit rating' && inp.ratingAction === 'downgrade') {
    const ag = /\b(CARE|CRISIL|ICRA|India Ratings|Ind-Ra|Brickwork|Acuit[eé]|Infomerics)\b/i.exec(txt)?.[1];
    return { now: `${ag ? ag.toUpperCase() === ag ? ag : ag : 'Rating agency'} rating downgraded`, next: 'Reason + funding cost + liquidity/leverage implications.' };
  }
  return null;
}


/** Pure: the decision card for one event.
 *  FOUR separate questions (zzz832): the EVENT, its DIRECT EVIDENCE, its THESIS IMPACT (does the evidence move a variable
 *  the thesis rests on?) and its ECONOMIC REALIZATION (has it reached revenue / margin / cash yet?). Impact never waits
 *  for realization; realization is shown as its own field and the chain. */
export function buildCard(inp: CardInput): EventCard {
  const ctx = inp.ctx;
  const pattern = ctx?.pattern && ctx.pattern !== 'UNCLASSIFIED' ? String(ctx.pattern).toUpperCase() : null;
  const tName = pattern ? String((THESES as any)[pattern]?.name || '') : '';
  const vars = pattern ? thesisVarsOf(ctx) : new Set<string>();
  const unread = inp.read === 'pending' || inp.read === 'failed' || (inp.read !== 'read' && !inp.line);
  const materiality: Materiality = inp.routine ? 'Routine' : inp.importance;
  const line = String(inp.line || '');
  // zzz833: subtype from the filing's own words — a fund raise is debt OR equity, a 5.02 is a CEO exit OR a routine director
  const isFR = inp.type === 'Fund raise';
  const frSub: FundRaiseSubtype | null = isFR ? fundRaiseSubtype(`${inp.title} ${inp.lowConfidence ? '' : line} ${inp.sourceDoc}`) : null;
  const mg = inp.type === 'Management change' ? managementEvent(`${inp.title} ${inp.lowConfidence ? '' : line}`) : null;
  const eventSubtype = frSub || (mg ? mg.label : null);

  // ── the claims, and whether a ledger-verified before → after outweighs a marketing-looking extraction ──
  const claims = inp.claims.filter((c) => c && c.key);
  const verified = claims.filter((c) => c.verified && c.dir !== 'stated');
  const ledgerProof = verified.find((c) => c.source === 'ledger' && c.text);
  // a low-confidence READ (marketing text, garbled sentence) is not a low-confidence FACT when the ledger holds a
  // verified before → after quoted from the filing itself
  const low = !!inp.lowConfidence && !ledgerProof;
  const cands = [...claims.map((c) => c.key), ...(TYPE_VARS[inp.type] || [])];
  const mappedKey = cands.find((k) => vars.has(k)) || null;

  // ── the event line: a low-confidence extraction shows the subject, never the garble ──
  const subj = String(inp.title || '').replace(/\s+/g, ' ').trim();
  const event = low ? `${subj || inp.type} — details in filing` : (ledgerProof && !!inp.lowConfidence ? String(ledgerProof.text) : (inp.what || subj || '(untitled filing)'));
  const keyNumber = low ? null : keyNumberOf(inp.type, inp.line, inp.figure);
  // zzz833: a Results event whose narrative states no headline figure is headlined by the SEC XBRL fact (never a stray sentence);
  // a fund raise whose extract is not about the raise is headlined by its subtype, not by marketing text
  const xbrlHead = inp.type === 'Results' && inp.claims.find((c) => c && c.source === 'xbrl' && c.text && c.verified);
  const raiseText = /offering|notes?\b|shares|stock|placement|facility|warrant|proceeds|indenture|\$\s?\d/i;
  let eventLine = event;
  if (xbrlHead && !/\b(?:Revenue|Sales|PAT|EBITDA)\b/.test(String(inp.what || ''))) eventLine = String(xbrlHead.text).split(' · ')[0];
  else if (isFR && frSub && !low && !raiseText.test(String(inp.what || ''))) eventLine = `${frSub}${keyNumber ? ` · ${keyNumber}` : ''} — ${subj || 'see filing'}`;
  else if (mg && mg.role !== 'unknown') eventLine = low ? `${mg.label} — details in filing` : event;

  // ── increments: an order with an amount, a capacity ADDED with a figure, are new quantities on their own ──
  const orderAmt = !low && inp.type === 'Order win' && inp.read === 'read' ? orderAmountOf(line) : null;
  const capInc = !low && inp.type === 'Capex / capacity' && inp.read === 'read' && isCapacityIncrement(line);
  const increment = !!orderAmt || capInc;
  const incVar = increment ? ((TYPE_VARS[inp.type] || []).find((k) => vars.has(k)) || null) : null;

  const onVar = (k: string | null) => verified.filter((c) => c.key === k);
  const conflictLedger = Array.isArray(checkedRow(ctx, mappedKey)?.conflict) && checkedRow(ctx, mappedKey).conflict.length > 0;
  const headV = inp.headKeys ? verified.filter((c) => inp.headKeys!.includes(c.key)) : verified;
  const sameVarClash = Array.from(new Set(verified.map((c) => c.key))).some((k) => onVar(k).some((c) => c.dir === 'up') && onVar(k).some((c) => c.dir === 'down'));
  const dv = (mappedKey ? headV.filter((c) => c.key === mappedKey) : [])[0] || headV.find((c) => vars.has(c.key)) || headV[0] || null;
  const parsed = dv ? parseChange(dv.text) : null;

  // ── evidence quality ──
  const isTx = /^(?:Acquisition|Fund raise|Divestment|Corporate restructuring)$/.test(inp.type);
  const txFigure = isTx && !low && inp.read === 'read' && (!!keyNumber || /\d{3}/.test(line.replace(/\d{2}\.\d{2}\.\d{4}/g, '')));
  let quality: EvidenceQuality; let qualityWhy: string; let incomplete = false;
  if (inp.badge === 'press') { quality = 'Unproven'; incomplete = true; qualityWhy = 'press report only — no filing behind it'; }
  else if (unread && !claims.length && !(inp.market === 'US' && inp.type === 'Fund raise' && inp.read === 'not-needed')) { quality = 'Unproven'; incomplete = true; qualityWhy = inp.read === 'failed' ? 'the document could not be opened' : inp.read === 'pending' ? 'the document has not been read yet' : 'only the filing subject is on file'; }
  else if (mg && low) { quality = 'Unproven'; qualityWhy = 'role and reason are not established from the extract — open the filing'; }
  else if (low) { quality = 'Unproven'; incomplete = true; qualityWhy = 'the extraction from this filing is low-confidence'; }
  else if (sameVarClash || (conflictLedger && verified.length)) { quality = 'Conflicting'; qualityWhy = sameVarClash ? 'the filings state opposite moves for the same variable' : 'other documents for the period state a different value'; }
  else if (headV.length) {
    quality = 'Direct';
    qualityWhy = headV.some((c) => c.source === 'xbrl') && !headV.some((c) => c.source !== 'xbrl') ? 'the change against the same quarter a year earlier, from the SEC XBRL figures for this quarter' : 'the filing states the change with its prior';
  }
  else if (orderAmt) { quality = 'Static'; qualityWhy = 'an order amount is stated; no prior order book — change not established'; }
  else if (increment) { quality = 'Direct'; qualityWhy = 'the filing states the capacity added, with a figure'; }
  else if (txFigure) { quality = 'Direct'; qualityWhy = 'the filing states the transaction and its size'; }
  else if (keyNumber || inp.figure) { quality = 'Static'; qualityWhy = 'a level is stated; no increment or prior — change not established'; }
  else { quality = 'Indirect'; qualityWhy = 'the event is stated; no figure bears on a thesis variable'; }

  // ── delta (all numbers nullable; never a previous value that is not in the filing) ──
  let delta: EventCard['delta'];
  let previousValue: string | null = null, currentValue: string | null = null, deltaValue: string | null = null, deltaPct: number | null = null, deltaDirection: 'up' | 'down' | null = null;
  if (quality === 'Direct' && dv && headV.length) {
    if (parsed) { previousValue = parsed.previous; currentValue = parsed.current; deltaValue = parsed.deltaValue; deltaPct = parsed.deltaPct; deltaDirection = parsed.direction; }
    delta = { kind: 'change', text: `CHANGE: ${dv.text || `${varLabel(dv.key)} ${dv.dir}`}` };
  }
  else if (increment && quality === 'Direct') {
    delta = orderAmt ? { kind: 'increment', text: `NEW ORDER ${orderAmt} — order book before / after not stated` }
      : { kind: 'increment', text: `CAPACITY ADDED ${keyNumber || ''} — installed capacity before / after not stated`.replace('  ', ' ') };
    currentValue = orderAmt || keyNumber || null;
  }
  else if (quality === 'Direct' && txFigure) delta = { kind: 'none', text: `${keyNumber || 'size'} stated — an event size, not a before → after` };
  else if ((keyNumber || inp.figure) && !incomplete) delta = { kind: 'level', text: 'LEVEL ONLY — change not established' };
  else delta = { kind: 'none', text: incomplete ? 'not established — source not reliably read' : 'no figure stated' };

  // ── the thesis variable AFFECTED — optional; only a variable this event actually moves or measures ──
  const yourT = pattern ? `your ${pattern}${tName ? ` (${tName.toLowerCase()})` : ''} thesis` : '';
  const upM = verified.filter((c) => vars.has(c.key) && c.dir === 'up');
  const downM = verified.filter((c) => vars.has(c.key) && c.dir === 'down');
  const vDownAny = verified.find((c) => c.dir === 'down') || null;
  let variable: string | null = null;
  if (upM.length && !downM.length) variable = upM[0].key;
  else if (downM.length) variable = downM[0].key;
  else if (incVar) variable = incVar;
  else if (/^(?:Results|Guidance|Concall \/ business update)$/.test(inp.type)) variable = mappedKey;
  const mapped = !!variable && vars.has(variable);
  const vName = variable ? varLabel(variable).toLowerCase() : null;

  // ── thesis impact ──
  let impact: Impact; let why: string;
  const NOVAR = 'Relevant event; no direct thesis variable affected';
  if (!pattern) { impact = 'Evidence incomplete'; why = 'thesis type not set — pick A / B / F / G on the card'; }
  else if (incomplete) { impact = 'Evidence incomplete'; why = qualityWhy; }
  else if (quality === 'Conflicting') { impact = 'Evidence incomplete'; why = `${qualityWhy} — verify before acting`; }
  else if (downM.length && ctx?.assessment?.status === 'BROKEN' && downM.some((c) => checkedRow(ctx, c.key)?.invalidation)) {
    const c = downM.find((x) => checkedRow(ctx, x.key)?.invalidation)!;
    impact = 'Broken'; why = `${varLabel(c.key).toLowerCase()} fell and the ledger's break condition fired: ${checkedRow(ctx, c.key).invalidation}`;
  }
  else if (upM.length && !downM.length) { impact = 'Supports'; why = `${upM.map((c) => varLabel(c.key).toLowerCase()).filter((x, i, a) => a.indexOf(x) === i).slice(0, 2).join(' and ')} up, ${upM.every((c) => c.source === 'xbrl') ? 'against the same quarter a year earlier (SEC XBRL)' : 'stated with its prior'} — ${upM.length > 1 ? 'variables' : 'a variable'} ${yourT} rests on`; }
  else if (downM.length && !upM.length) { impact = 'Weakens'; why = `${varLabel(downM[0].key).toLowerCase()} down, ${downM.every((c) => c.source === 'xbrl') ? 'against the same quarter a year earlier (SEC XBRL)' : 'stated with its prior'}${inp.headKeys && !inp.headKeys.includes(downM[0].key) ? ' in the same filing' : ''} — a variable ${yourT} rests on`; }
  else if (upM.length && downM.length) { impact = 'Neutral'; why = `mixed: ${varLabel(upM[0].key).toLowerCase()} up, ${varLabel(downM[0].key).toLowerCase()} down`; }
  else if (incVar) { impact = 'Neutral'; why = 'financial contribution not yet evidenced'; }
  else if (inp.market === 'US' && vDownAny) { impact = 'Neutral'; why = `${varLabel(vDownAny.key).toLowerCase()} down (stated with its prior) — not a variable ${yourT} rests on`; }
  else if (inp.type === 'Regulatory / legal action') { impact = 'Neutral'; why = inp.noImpact ? 'company states no material impact' : 'impact not quantified in the filing — unknown, not negative'; }
  else if (delta.kind === 'level') { impact = 'Neutral'; why = inp.xbrlNote ? `LEVEL ONLY — ${inp.xbrlNote}` : 'LEVEL ONLY — change not established'; }
  else { impact = 'Neutral'; why = `${NOVAR}.`; }
  if (pattern && ctx?.fit === 'provisional' && (impact === 'Supports' || impact === 'Weakens')) why += ' (thesis type is provisional)';

  // ── zzz833: THESIS CONNECTION — separate from the impact; a variable is named only if the thesis registers it ──
  const INDIRECT_TYPES = /^(?:Order win|Capex \/ capacity|Acquisition|Divestment|Results|Regulatory approval|Guidance|Corporate restructuring)$/;
  const debtRegistered = vars.has('debt') && !!frSub && (DEBT_SUBTYPES.has(frSub) || frSub === 'Convertible');
  let connection: ThesisConnection;
  if (!pattern) connection = 'No established connection';
  else if (incomplete || quality === 'Conflicting') connection = 'Evidence incomplete';
  else if (mapped && (upM.length || downM.length || incVar)) connection = 'Direct';
  else if (INDIRECT_TYPES.test(inp.type) || debtRegistered) connection = 'Indirect';
  else connection = 'No established connection';
  if (impact === 'Neutral' && why === `${NOVAR}.`) {
    why = mg ? (mg.priority === 'Investigate' ? `${mg.label}: no thesis variable is tested by it; business effect not established — read the filing`
        : `${mg.label}: no thesis variable is tested by it; not by itself a thesis change`)
      : isFR || connection === 'Indirect' ? 'financial contribution not yet evidenced'
      : 'no registered thesis variable is tested by this event';
  }
  // what the filing OBSERVED — need not be a thesis variable, and is never shown as one
  const observed: string | null = variable ? varLabel(variable)
    : inp.type === 'Order win' ? (/backlog|remaining performance obligation/i.test(line) ? 'Backlog / order book' : 'Order intake')
    : inp.type === 'Capex / capacity' ? 'Capacity'
    : isFR ? (frSub && (DEBT_SUBTYPES.has(frSub) ? 'Debt' : frSub === 'Convertible' ? 'Debt + dilution' : 'Share count (dilution)')) || null
    : inp.type === 'Acquisition' ? 'Acquisition' : inp.type === 'Results' ? 'Revenue / earnings' : inp.type === 'Guidance' ? 'Guidance' : null;

  const secondary = pattern && !variable && impact === 'Neutral' ? (SECONDARY[inp.type] || null) : null;

  // ── chain / stage / next / gap ── (economic realization: how far the evidence has travelled)
  const chain = chainOf(inp, unread, frSub);
  let next: string | null = null, gap: string | null = null, stage: EventCard['stage'] = null;
  if (chain) {
    const spec = chainSpec(inp.type, inp.market || 'IN', frSub)!;
    let done = 0; while (done < chain.length && chain[done].ok) done++;
    stage = { done, total: chain.length };
    const missing = chain.map((c, i) => ({ c, i })).filter((x) => !x.c.ok);
    if (missing.length) {
      next = missing.slice(0, spec.n).map((x) => spec.links[x.i][1]).join(' → ');
      const first = missing[0].i;
      const prev = first > 0 ? spec.links[first - 1][1] : null;
      const cap = (x: string) => (/^[A-Z/]+$/.test(x) ? x : x.charAt(0).toUpperCase() + x.slice(1));
      gap = prev ? `${cap(prev)} → ${spec.links[first][1]}` : `${cap(spec.links[first][1])} not evidenced`;
    }
    // a rating or a management change is followed up under NEEDS ATTENTION, not as an economic-evidence gap
    if (inp.type === 'Management change' || inp.type === 'Credit rating') gap = null;
  }
  const realization = !chain ? 'n/a — not an economic event'
    : stage && stage.done >= stage.total ? 'Evidenced through the last link'
    : stage && stage.done <= 1 ? 'Not yet evidenced — the event is disclosed; its economic effect is still open'
    : `Partly evidenced — ${stage!.done} of ${stage!.total} links`;

  // ── needs attention ── (+ why now / next investigation)
  let attention: string | null = null;
  if (impact === 'Broken') attention = 'thesis break condition fired';
  else if (impact === 'Weakens') attention = `${vName || 'a thesis variable'} fell`;
  else if (quality === 'Conflicting') attention = 'conflicting evidence';
  else if (inp.type === 'Regulatory / legal action' && !inp.noImpact) attention = 'authority action — impact not quantified';
  else if (inp.type === 'Credit rating' && inp.ratingAction === 'downgrade') attention = 'credit rating downgraded';
  else if (mg && (inp.market === 'US' ? mg.priority === 'Investigate' : !!inp.senior)) attention = inp.market === 'US' ? mg.label.toLowerCase() : 'senior management change';
  else if (materiality === 'Material' && inp.read === 'failed') attention = 'material filing could not be read';
  let whyNow: string | null = null, nextInvestigation: string | null = null;
  if (attention) {
    const w = whyNowOf({ ...inp, senior: !!mg && (inp.market === 'US' ? mg.priority === 'Investigate' : !!inp.senior) });
    if (w) { whyNow = w.now; nextInvestigation = w.next; }
    else {
      whyNow = attention;
      nextInvestigation = impact === 'Broken' || impact === 'Weakens' ? `Next filing on ${vName || 'the variable'}: one-off or trend?`
        : quality === 'Conflicting' ? 'Reconcile the two figures against the primary filing.' : 'Open the filing and read it directly.';
    }
  }

  // ── why material: one short deterministic reason, never prose ──
  let whyMaterial: string | null = null;
  if (materiality === 'Material') {
    const stake = /(\d+(?:\.\d+)?)%\s*stake/i.exec(line)?.[1];
    if (deltaPct != null && dv) whyMaterial = `${/capacity/i.test(dv.key) ? 'stated capacity' : varLabel(dv.key).toLowerCase()} ${deltaPct > 0 ? '+' : ''}${deltaPct}%`;
    else if (orderAmt) whyMaterial = `${orderAmt} order`;
    else if (capInc) whyMaterial = `capacity added ${keyNumber || ''}`.trim();
    else if (inp.type === 'Acquisition' && stake) whyMaterial = parseFloat(stake) >= 10 ? `${stake}% strategic acquisition` : `${stake}% stake — acquisition / strategic investment`;
    else if (inp.type === 'Acquisition') whyMaterial = 'acquisition disclosed';
    else if (attention) whyMaterial = whyNow || attention;
    else whyMaterial = keyNumber ? `${inp.type.toLowerCase()} · ${keyNumber}` : inp.type.toLowerCase();
  }

  // ── zzz833: WHY THIS MATTERS — a deterministic sentence from the evidence and the ledger; never AI ──
  let whyMatters: string | null = null;
  if ((materiality === 'Material' || materiality === 'Notable') && !low) {
    const missing = chain ? chain.filter((c) => !c.ok && !c.contradicted).slice(0, 3).map((c) => c.label.toLowerCase()) : [];
    const gapTxt = missing.length ? `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not yet evidenced.` : '';
    const T = pattern ? ` in the ${pattern} thesis` : '';
    if (inp.type === 'Results' && (upM.length || downM.length)) {
      const ms = [...upM, ...downM].map((c) => varLabel(c.key).toLowerCase()).filter((x, i, a) => a.indexOf(x) === i).slice(0, 2).join(' and ');
      const pct = deltaPct != null ? ` ${deltaPct > 0 ? '+' : ''}${deltaPct}%` : '';
      whyMatters = `${ms.charAt(0).toUpperCase()}${ms.slice(1)} ${downM.length && !upM.length ? 'fell' : 'rose'}${pct} against the same quarter a year earlier, directly testing ${ms}${T}. ${gapTxt}`.trim();
    }
    else if (inp.type === 'Order win') whyMatters = `${orderAmt ? `The ${orderAmt} order` : 'The order'} adds to future backlog, but ${gapTxt ? gapTxt.replace(/ (?:is|are) not yet evidenced\.$/, ' contribution is not yet evidenced.') : 'its revenue, margin and cash contribution are not yet evidenced.'}`.replace('contribution contribution','contribution');
    else if (inp.type === 'Capex / capacity') whyMatters = `Capacity ${capInc ? 'added' : 'announced'}, but it earns nothing until it is used: ${gapTxt || 'utilisation, revenue and ROCE are not yet evidenced.'}`;
    else if (inp.type === 'Acquisition') whyMatters = `The deal changes the business only once it closes and is integrated: ${gapTxt || 'closing, integration, revenue and EPS/FCF are not yet evidenced.'}`;
    else if (isFR && frSub) whyMatters = DEBT_SUBTYPES.has(frSub)
      ? `New borrowing raises interest cost and leverage, and helps only if the proceeds earn more than they cost: ${gapTxt || 'use of proceeds and earnings effect are not yet evidenced.'}`
      : frSub === 'Convertible' ? `A convertible is debt now and dilution if converted: ${gapTxt || 'terms, deployment and EPS/FCF effect are not yet evidenced.'}`
      : `New shares dilute existing holders until the proceeds earn a return: ${gapTxt || 'deployment and EPS/FCF effect are not yet evidenced.'}`;
    else if (mg) whyMatters = mg.priority === 'Investigate' ? `${mg.label} at a senior level — succession, stated reason and operating responsibility decide whether it matters.` : `${mg.label} — routine unless the filing shows a wider change; no thesis variable is tested.`;
    else if (inp.type === 'Results') whyMatters = `Results are on file but no financial figure was extracted, so no thesis variable is tested yet.`;
  }
  if (whyMatters) whyMatters = whyMatters.replace(/\s+/g, ' ').trim();
  const evidenceStatus = {
    filed: inp.badge === 'filed', parsed: inp.read === 'read' || (inp.read === 'not-needed' && inp.badge === 'filed'),
    financial: claims.some((c) => c.source === 'xbrl' || c.verified) || !!orderAmt || (!!keyNumber && !low),
    mechanism: !!chain && chain.slice(1).some((c) => c.ok) || increment,
    thesis: connection === 'Direct' && (impact === 'Supports' || impact === 'Weakens' || impact === 'Broken'),
  };
  return {
    eventSubtype, observed, connection, whyMatters, priority: mg ? mg.priority : null, evidenceStatus,
    eventType: inp.type, sourceDocument: inp.sourceDoc, sourceDate: inp.date, exchange: inp.exchange, materiality,
    keyNumber, event: eventLine, evidence: evidenceWords(inp, unread && !claims.length),
    thesisType: pattern, thesisName: tName || null, thesisVariable: variable, thesisVariableLabel: variable ? varLabel(variable) : null, mapped,
    impact, why, quality, qualityWhy, delta, previousValue, currentValue, deltaValue, deltaPct, deltaDirection,
    realization, secondary, whyMaterial, whyNow, nextInvestigation, stage, chain, next, gap, attention, lowConfidence: low,
  };
}

// ── zzz829: US DOLLARS, ONE SPELLING, THE FILING'S OWN TABLE SCALE. ─────────
// US extracted numbers printed raw thousands ("$30,934 impairment", "$21,803 thousand", "48,688 thousand →
// 55,906 thousand") and raw dollars ("$125,000,000"). A US amount is shown in $ mn / $ bn; a bare table figure
// ("$30,934") is scaled only by the scale the filing itself states ("(in thousands)") — never guessed.

/** Pure: "$163 mn", "$1.25 bn", "$96", "$45,000" — a dollar amount in words (sub-million amounts in dollars). */
export function usdShort(n: number, sign = true): string {
  const neg = n < 0 ? '−' : '';
  const a = Math.abs(n);
  const cur = sign ? '$' : '';
  const trim = (x: number, d: number) => x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
  if (a >= 1e9) return `${neg}${cur}${trim(a / 1e9, a >= 1e11 ? 0 : 2)} bn`;
  if (a >= 1e6) return `${neg}${cur}${trim(a / 1e6, 1)} mn`;
  return `${neg}${cur}${Math.round(a).toLocaleString('en-US')}`;
}

/** Pure: the table scale a US filing states ("(in thousands, except per share data)", "dollars in millions"). */
export function usTableScale(text: string | null | undefined): 'thousand' | 'million' | null {
  const t = String(text || '');
  const m = /\(\s*(?:\$|US\$|U\.?S\.?\s+dollars?|dollars|amounts?)?\s*(?:in\s+)?(thousands|millions)\b[^)]{0,80}\)|\b(?:in|amounts in|dollars in)\s+(thousands|millions)(?:\s+of\s+(?:U\.?S\.?\s+)?dollars)?\b|\b(thousands|millions) of (?:U\.?S\.?\s+)?dollars\b/i.exec(t);
  if (!m) return null;
  return /^thousand/i.test(m[1] || m[2] || m[3]) ? 'thousand' : 'million';
}

/** Pure: every US amount in a line in $ mn / $ bn. "N thousand" → mn; a raw "$125,000,000" → "$125 mn"; a bare
 *  table figure ("$30,934", no unit) only with the filing's stated `scale`. Per-share figures ("$0.84") untouched. */
export function usScaleAmounts(line: string | null | undefined, scale: 'thousand' | 'million' | null = null): string {
  let t = String(line || '');
  if (!t) return t;
  const n = (s: string) => Number(String(s).replace(/,/g, ''));
  // "$21,803 thousand", "48,688 thousand" (a figure copied with its table scale as a word)
  t = t.replace(/(\$\s?)?(\d[\d,]*(?:\.\d+)?)\s?thousands?\b/gi, (m, d, x) => (Number.isFinite(n(x)) ? usdShort(n(x) * 1e3, !!d) : m));
  // "$46.0M" / "$1.2B" / "$750K" → "$46.0 mn" / "$1.2 bn" / "$750,000"
  t = t.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?([MBK])\b(?!\.\w)/g, (m, x, u) => (u === 'K' ? usdShort(n(x) * 1e3) : `$${x} ${u === 'M' ? 'mn' : 'bn'}`));
  // bare dollars, no unit after them
  t = t.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)(?![\d,]|\.\d|\s?(?:mn|bn|million|billion|thousand|[MBK]\b|per\b|\/share|a share))/g, (m, x) => {
    const v = n(x);
    if (!Number.isFinite(v)) return m;
    if (v >= 1e6) return usdShort(v);                                   // "$125,000,000" — dollars as written
    if (!/,/.test(x) && v < 1000) return m;                               // "$551", "$0.84" — a price / per-share figure
    if (scale === 'thousand') return usdShort(v * 1e3);
    if (scale === 'million') return usdShort(v * 1e6);
    return m;
  });
  return t;
}

/** Pure: a dollar amount stated in a line, in USD (the first one), or null — "$100 mn" → 1e8, "$500,000" → 5e5. */
export function usdAmountIn(line: string | null | undefined): number | null {
  const m = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(bn|billion|mn|million|thousand|[MBK]\b)?/i.exec(String(line || ''));
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  const u = String(m[2] || '').toLowerCase();
  return v * (/^(?:bn|billion|b)$/.test(u) ? 1e9 : /^(?:mn|million|m)$/.test(u) ? 1e6 : /^(?:thousand|k)$/.test(u) ? 1e3 : 1);
}

/** Pure: Indian digit grouping — 2073 → "2,073", 100000 → "1,00,000", 12345678.5 → "1,23,45,678.5". */
export function indianGroup(n: string | number): string {
  const [int, dec] = String(n).replace(/,/g, '').split('.');
  if (!/^\d+$/.test(int)) return String(n);
  const last3 = int.slice(-3), rest = int.slice(0, -3);
  const g = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return dec != null ? `${g}.${dec}` : g;
}

/** Pure: "₹150 bn", "₹2,073 Cr" — one spelling for a stated figure (a bare Indian figure is rupees), rupee
 *  amounts in Indian digit grouping. */
export function tidyFigure(s: string | null | undefined, market: 'IN' | 'US' = 'IN'): string | null {
  const t0 = tidyUnits(s, market);
  return t0 == null ? null : t0.replace(/₹\s?(\d[\d,]*(?:\.\d+)?)/g, (_m, n) => `₹${indianGroup(n)}`);
}
function tidyUnits(s: string | null | undefined, market: 'IN' | 'US'): string | null {
  const t0 = String(s || '').trim();
  if (!t0) return null;
  // zzz829: US amounts in $ mn / $ bn ("$21,803 thousand" → "$21.8 mn", "$125,000,000" → "$125 mn")
  const t = market === 'US' ? usScaleAmounts(t0, null) : t0;
  return t.replace(/(^|\s|→\s?)(?:Rs\.?|INR)\s?/g, '$1₹')
    .replace(/(^|[\s(]|→\s?)(\d[\d,]*(?:\.\d+)?)\s?(billion|bn)\b/gi, (_m, a, n) => `${a}${market === 'US' ? '$' : '₹'}${n} bn`)
    .replace(/(^|[\s(]|→\s?)(\d[\d,]*(?:\.\d+)?)\s?(crores?|cr)\b/gi, (_m, a, n) => `${a}₹${n} Cr`)
    .replace(/\s?crores?\b/gi, ' Cr').replace(/\s?billion\b/gi, ' bn').replace(/\s?million\b/gi, ' mn')
    .replace(/\s{2,}/g, ' ').trim();
}

/** Pure: a before → after pair where both numbers appear in the quoted source text. */
export function pairVerified(before: string | null | undefined, after: string | null | undefined, source: string | null | undefined): boolean {
  const num = (s: string | null | undefined) => (String(s || '').match(/\d[\d,]*(?:\.\d+)?/) || [''])[0].replace(/,/g, '');
  const b = num(before), a = num(after);
  if (!b || !a || b === a) return false;
  const src = String(source || '').replace(/,/g, '');
  const has = (n: string) => new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(src);
  return has(b) && has(a);
}

/** zzz824: what the thesis-ledger side panel shows for one event — ONLY that event's own ticker: its ledger
 *  (the event's ctx, built per row by the page), its evidence, and its own events in the window. Pure. */
export interface LedgerView {
  ticker: string;
  status: string | null;
  rows: Array<{ key: string; label: string; weight: number; before: string | null; after: string | null; verdict: string; withinMateriality: boolean; absence: string | null; state: string | null }>;
  latest: string[];
  missing: string[];
  events: RecentEvent[];
}
export function ledgerView(e: RecentEvent, all: RecentEvent[]): LedgerView {
  const t = e.ticker.toUpperCase();
  // the ctx must belong to this ticker: an event's ctx is set from its own filing row; a ctx that says otherwise is dropped
  const own = (x: RecentEvent) => x.ticker.toUpperCase() === t;
  const ctxTicker = (e.ctx as any)?.ticker ? String((e.ctx as any).ticker).toUpperCase() : null;
  const a: any = ctxTicker && ctxTicker !== t ? null : e.ctx?.assessment || null;
  const rows = (Array.isArray(a?.checked) ? [...a.checked] : []).sort((x: any, y: any) => (y.weight || 0) - (x.weight || 0)).map((r: any) => ({
    key: String(r.key), label: String(r.label || r.key), weight: Number(r.weight || 0), before: r.before ?? null, after: r.after ?? null,
    verdict: String(r.verdict || ''), withinMateriality: !!r.withinMateriality, absence: r.absence ?? null, state: r.state ?? null,
  }));
  const latest = [
    ...((a?.evidenceItems?.structural as string[]) || []), ...((a?.evidenceItems?.supporting as string[]) || []),
    ...(((a?.mechanismEvidence as Array<{ text: string }>) || []).map((m) => m.text)),
  ].filter((x, i, arr) => x && arr.indexOf(x) === i).slice(0, 6);
  const missing: string[] = (a?.verdict?.coverage?.missing as string[]) || rows.filter((r) => r.absence && r.weight >= 3).map((r) => r.label);
  return { ticker: e.ticker, status: a?.status || null, rows, latest, missing, events: all.filter(own).slice(0, 8) };
}


// ── zzz833: THE COUNTS, ONE HIERARCHY. ──────────────────────────────────────
// tracked names → filings read → EVENTS detected (Material + Notable + Minor) → routine filings (not events).
export interface CatalystCounts {
  names: number; filingsRead: number; filingsTotal: number; events: number;
  material: number; notable: number; minor: number; routine: number;
  directThesis: number; investigate: number; evidenceIncomplete: number; line: string;
}
export function calculateCatalystCounts(o: { names: number; filingsRead: number; filingsTotal: number; routine: number; cards: EventCard[] }): CatalystCounts {
  const c = o.cards;
  const material = c.filter((x) => x.materiality === 'Material').length;
  const notable = c.filter((x) => x.materiality === 'Notable').length;
  const minor = c.filter((x) => x.materiality === 'Minor').length;
  const events = material + notable + minor;
  const directThesis = c.filter((x) => x.evidenceStatus.thesis).length;
  const investigate = c.filter((x) => x.attention || (x.materiality === 'Material' && (x.quality === 'Unproven' || x.impact === 'Evidence incomplete'))).length;
  const evidenceIncomplete = c.filter((x) => x.impact === 'Evidence incomplete').length;
  const line = `${o.names} names tracked · ${o.filingsRead} of ${o.filingsTotal} filings read · ${events} events (${material} Material · ${notable} Notable · ${minor} Minor)`
    + (o.routine ? ` · ${o.routine} routine filing${o.routine === 1 ? '' : 's'} not counted as events` : '');
  return { names: o.names, filingsRead: o.filingsRead, filingsTotal: o.filingsTotal, events, material, notable, minor, routine: o.routine, directThesis, investigate, evidenceIncomplete, line };
}
