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
export type EvidenceQuality = 'Direct' | 'Indirect' | 'Static' | 'Unproven' | 'Conflicting';
export type Materiality = 'Material' | 'Notable' | 'Minor' | 'Routine';

/** One thing the evidence says about a thesis variable. `verified` = the filing states the prior too. */
export interface Claim {
  key: string;
  dir: 'up' | 'down' | 'stated';
  verified: boolean;
  text?: string | null;
  source: 'filing' | 'ledger';
}

export interface ChainLink { label: string; ok: boolean }

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
  delta: { kind: 'change' | 'level' | 'none'; text: string };
  chain: ChainLink[] | null;
  /** "execution → revenue → margin" — the links still missing, in order. */
  next: string | null;
  /** "Order → execution" — the last evidenced link and the first missing one. */
  gap: string | null;
  /** Why this belongs under NEEDS ATTENTION, when it does. */
  attention: string | null;
  lowConfidence: boolean;
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
}

const varLabel = (v: string | null | undefined): string => (v && (VAR_LABEL as Record<string, string>)[v]) || String(v || '').replace(/_/g, ' ');

/** Variables an event of this type can speak to, most direct first. */
const TYPE_VARS: Record<string, string[]> = {
  'Order win': ['order_intake', 'order_book', 'book_to_bill', 'revenue_visibility'],
  'Capex / capacity': ['capacity_addition', 'capacity', 'commissioning', 'new_plant', 'capex', 'capex_status', 'utilisation', 'capex_earning'],
  'Results': ['revenue_growth', 'earnings_growth', 'margin', 'operating_leverage', 'cash_conversion'],
  'Acquisition': ['revenue_growth', 'earnings_growth'],
  'Divestment': ['revenue_growth', 'debt'],
  'Fund raise': ['debt', 'capex'],
  'Regulatory approval': ['approval', 'qualification', 'new_product'],
  'Guidance': ['guidance', 'management_target'],
  'Credit rating': ['debt'],
  'Concall / business update': [],
};

/** The chain an event of this type must travel before it is earnings. `n` = how many missing links NEXT shows. */
const CHAINS: Record<string, { links: Array<[string, string]>; n: number }> = {
  'Order win': { links: [['ORDER', 'order'], ['EXECUTION', 'execution'], ['REVENUE', 'revenue'], ['MARGIN', 'margin'], ['CASH', 'cash']], n: 3 },
  'Capex / capacity': { links: [['CAPEX', 'capex'], ['COMMISSIONED', 'commissioning'], ['UTILISATION', 'utilisation'], ['REVENUE', 'revenue'], ['ROCE', 'ROCE']], n: 3 },
  'Results': { links: [['SALES', 'sales'], ['PROFIT', 'profit'], ['MARGIN', 'margin'], ['CASH', 'cash'], ['GUIDANCE', 'guidance']], n: 2 },
  'Acquisition': { links: [['ACQUISITION', 'acquisition'], ['INTEGRATION', 'integration'], ['REVENUE', 'revenue'], ['MARGIN', 'margin'], ['EPS/FCF', 'EPS/FCF']], n: 4 },
  'Regulatory approval': { links: [['APPROVAL', 'approval'], ['LAUNCH', 'launch'], ['REVENUE', 'revenue'], ['MARGIN', 'margin']], n: 3 },
  'Fund raise': { links: [['FUND RAISE', 'fund raise'], ['CAPITAL DEPLOYMENT', 'capital deployment'], ['EARNINGS/RETURN IMPACT', 'earnings/return impact']], n: 2 },
  'Divestment': { links: [['DIVESTMENT', 'divestment'], ['PROCEEDS RECEIVED', 'proceeds received'], ['USE OF PROCEEDS', 'use of proceeds'], ['RETURN IMPACT', 'return impact']], n: 2 },
  'Corporate restructuring': { links: [['SCHEME', 'scheme'], ['APPROVALS', 'approvals'], ['EFFECTIVE', 'effective date'], ['EARNINGS IMPACT', 'earnings impact']], n: 2 },
};

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
  if (unread) return inp.read === 'failed' ? 'filing subject only — the document could not be opened' : inp.read === 'pending' ? 'filing subject only — document being read' : 'filing subject only';
  const l = String(inp.line || '');
  switch (inp.type) {
    case 'Order win': return /order book/i.test(l) && !/^Order (?:from|worth)/i.test(l) ? 'order book stated' : 'order disclosed';
    case 'Results': {
      const had = [/\b(?:Revenue|Sales)\b/.test(l) && 'sales', /\b(?:PAT|profit)\b/i.test(l) && 'profit', /margin/i.test(l) && 'margin'].filter(Boolean);
      return had.length ? `results figures stated: ${had.join(', ')}` : 'results filed — no headline figures';
    }
    case 'Capex / capacity': return /→/.test(l) ? 'capacity before and after stated' : /commission/i.test(l) ? 'commissioning disclosed' : 'capacity / capex disclosed';
    case 'Acquisition': return `acquisition disclosed${/stake/.test(l) ? ', stake stated' : ''}${/for\s+(?:₹|Rs|INR|\$)/i.test(l) ? ', consideration stated' : ''}`;
    case 'Fund raise': return /allot/i.test(`${inp.title} ${inp.sourceDoc}`) ? 'allotment disclosed' : 'fund raise disclosed';
    case 'Divestment': return 'sale / disposal disclosed';
    case 'Regulatory approval': return 'approval disclosed';
    case 'Credit rating': return 'rating action disclosed';
    case 'Corporate action': return 'corporate action disclosed';
    case 'Regulatory / legal action': return inp.noImpact ? 'authority action disclosed — company states no material impact' : 'authority action disclosed';
    case 'Management change': return 'appointment / resignation disclosed';
    case 'Guidance': return 'management guidance stated';
    case 'Concall / business update': return 'management statement / presentation';
    case 'Exchange clarification': return "company's reply to the exchange";
    default: return 'document read';
  }
}

function chainOf(inp: CardInput, unread: boolean): ChainLink[] | null {
  const c = CHAINS[inp.type];
  if (!c) return null;
  const l = String(inp.line || '');
  const ctx = inp.ctx;
  const ok: boolean[] = c.links.map(() => false);
  // the first link is the event itself — evidenced by the filing that discloses it
  ok[0] = inp.badge === 'filed' || !unread;
  switch (inp.type) {
    case 'Results':
      ok[0] = /\b(?:Revenue|Sales)\b/.test(l);
      ok[1] = /\b(?:PAT|profit)\b/i.test(l);
      ok[2] = /margin/i.test(l);
      ok[3] = ledgerHas(ctx, 'cash_conversion') || ledgerHas(ctx, 'fcf');
      ok[4] = /guidance/i.test(l) || ledgerHas(ctx, 'guidance');
      break;
    case 'Capex / capacity':
      ok[1] = /commission|commercial (?:production|operation)|operational/i.test(l) || ledgerHas(ctx, 'commissioning');
      ok[2] = ok[1] && ledgerHas(ctx, 'utilisation');
      ok[3] = ok[2] && ledgerHas(ctx, 'capex_earning', true);
      ok[4] = ok[3] && ledgerHas(ctx, 'roce');
      break;
    case 'Regulatory approval':
      ok[1] = /\blaunch(?:ed)?\b|commercial(?:ly)? (?:launch|supplies|sale)/i.test(l);
      break;
    case 'Corporate restructuring':
      ok[1] = /sanctioned by the NCLT|no-objection|approved by the board/i.test(l);
      ok[2] = /\beffective\b/i.test(l);
      break;
    case 'Divestment':
      ok[1] = /received|completed/i.test(l) && !/receivable/i.test(l);
      break;
    default: break; // an order, an acquisition, a fund raise: nothing downstream can be evidenced by the same filing
  }
  return c.links.map(([label], i) => ({ label, ok: ok[i] }));
}

/** Pure: the decision card for one event. */
export function buildCard(inp: CardInput): EventCard {
  const ctx = inp.ctx;
  const pattern = ctx?.pattern && ctx.pattern !== 'UNCLASSIFIED' ? String(ctx.pattern).toUpperCase() : null;
  const tName = pattern ? String((THESES as any)[pattern]?.name || '') : '';
  const vars = pattern ? thesisVarsOf(ctx) : new Set<string>();
  const unread = inp.read === 'pending' || inp.read === 'failed' || (inp.read !== 'read' && !inp.line);
  const low = !!inp.lowConfidence;
  const materiality: Materiality = inp.routine ? 'Routine' : inp.importance;

  // ── the variable: a claimed one the thesis rests on, else the type's first mapped one, else the type's first ──
  const claims = inp.claims.filter((c) => c && c.key);
  const cands = [...claims.map((c) => c.key), ...(TYPE_VARS[inp.type] || [])];
  const mappedKey = cands.find((k) => vars.has(k)) || null;
  const variable = mappedKey || cands[0] || null;
  const mapped = !!mappedKey;

  // ── the event line: low-confidence extraction shows the subject, never the garble ──
  const subj = String(inp.title || '').replace(/\s+/g, ' ').trim();
  const event = low ? `${subj || inp.type} — details in filing` : (inp.what || subj || '(untitled filing)');
  const keyNumber = low ? null : keyNumberOf(inp.type, inp.line, inp.figure);

  // ── quality ──
  const verified = claims.filter((c) => c.verified && c.dir !== 'stated');
  const onVar = (k: string | null) => verified.filter((c) => c.key === k);
  const row = checkedRow(ctx, variable);
  const conflictLedger = Array.isArray(row?.conflict) && row.conflict.length > 0;
  const vUp = verified.some((c) => c.dir === 'up'), vDown = verified.some((c) => c.dir === 'down');
  const sameVarClash = Array.from(new Set(verified.map((c) => c.key))).some((k) => onVar(k).some((c) => c.dir === 'up') && onVar(k).some((c) => c.dir === 'down'));
  let quality: EvidenceQuality; let qualityWhy: string;
  if (inp.badge === 'press') { quality = 'Unproven'; qualityWhy = 'press report only — no filing behind it'; }
  else if (unread && !claims.length) { quality = 'Unproven'; qualityWhy = inp.read === 'failed' ? 'the document could not be opened' : inp.read === 'pending' ? 'the document has not been read yet' : 'only the filing subject is on file'; }
  else if (low) { quality = 'Unproven'; qualityWhy = 'the extraction from this filing is low-confidence'; }
  else if (sameVarClash || (conflictLedger && verified.length)) { quality = 'Conflicting'; qualityWhy = sameVarClash ? 'the filings state opposite moves for the same variable' : 'other documents for the period state a different value'; }
  else if (verified.length) { quality = 'Direct'; qualityWhy = 'the filing states the change with its prior'; }
  else if (keyNumber || inp.figure) { quality = 'Static'; qualityWhy = 'a figure is stated with no prior — a level, not a change'; }
  else { quality = 'Indirect'; qualityWhy = 'the event is stated; no figure bears on a thesis variable'; }

  // ── delta ──
  const dv = (mapped ? onVar(mappedKey) : [])[0] || verified[0] || null;
  const delta: EventCard['delta'] = quality === 'Direct' && dv ? { kind: 'change', text: `CHANGE: ${dv.text || `${varLabel(dv.key)} ${dv.dir}`}` }
    : (keyNumber || inp.figure) && quality !== 'Unproven' ? { kind: 'level', text: 'LEVEL ONLY — change not established' }
    : { kind: 'none', text: quality === 'Unproven' ? 'not established — evidence unproven' : 'no figure stated' };

  // ── impact ──
  let impact: Impact; let why: string;
  const vName = variable ? varLabel(variable).toLowerCase() : null;
  const yourT = pattern ? `your ${pattern}${tName ? ` (${tName.toLowerCase()})` : ''} thesis` : '';
  const upM = verified.filter((c) => vars.has(c.key) && c.dir === 'up');
  const downM = verified.filter((c) => vars.has(c.key) && c.dir === 'down');
  if (!pattern) { impact = 'Evidence incomplete'; why = 'thesis type not set — pick A / B / F / G on the card'; }
  else if (quality === 'Unproven') { impact = 'Evidence incomplete'; why = qualityWhy; }
  else if (quality === 'Conflicting') { impact = 'Evidence incomplete'; why = `${qualityWhy} — verify before acting`; }
  else if (downM.length && ctx?.assessment?.status === 'BROKEN' && downM.some((c) => checkedRow(ctx, c.key)?.invalidation)) {
    const c = downM.find((x) => checkedRow(ctx, x.key)?.invalidation)!;
    impact = 'Broken'; why = `${varLabel(c.key).toLowerCase()} fell and the ledger's break condition fired: ${checkedRow(ctx, c.key).invalidation}`;
  }
  else if (upM.length && !downM.length) { impact = 'Supports'; why = `${varLabel(upM[0].key).toLowerCase()} up, stated with its prior — a variable ${yourT} rests on`; }
  else if (downM.length && !upM.length) { impact = 'Weakens'; why = `${varLabel(downM[0].key).toLowerCase()} down, stated with its prior — a variable ${yourT} rests on`; }
  else if (upM.length && downM.length) { impact = 'Neutral'; why = `mixed: ${varLabel(upM[0].key).toLowerCase()} up, ${varLabel(downM[0].key).toLowerCase()} down`; }
  else if (TRANSACTION.test(inp.type)) { impact = 'Neutral'; why = 'financial contribution not yet evidenced'; }
  else if (inp.type === 'Regulatory / legal action') { impact = 'Neutral'; why = inp.noImpact ? 'company states no material impact' : 'impact not quantified in the filing — unknown, not negative'; }
  else if (inp.type === 'Credit rating') { impact = 'Neutral'; why = /downgrade/.test(String(inp.ratingAction)) ? 'rating downgraded — a funding-cost question, not a thesis variable change' : 'a rating action changes no thesis variable'; }
  else if (delta.kind === 'level') { impact = 'Neutral'; why = 'LEVEL ONLY — change not established'; }
  else if (!mapped && variable) { impact = 'Neutral'; why = `${vName} is not a variable ${yourT} rests on`; }
  else { impact = 'Neutral'; why = 'no thesis variable changed'; }
  if (pattern && ctx?.fit === 'provisional' && (impact === 'Supports' || impact === 'Weakens')) why += ' (thesis type is provisional)';

  // ── chain / next / gap ──
  const chain = chainOf(inp, unread);
  let next: string | null = null, gap: string | null = null;
  if (chain) {
    const spec = CHAINS[inp.type];
    const missing = chain.map((c, i) => ({ c, i })).filter((x) => !x.c.ok);
    if (missing.length) {
      next = missing.slice(0, spec.n).map((x) => spec.links[x.i][1]).join(' → ');
      const first = missing[0].i;
      const prev = first > 0 ? spec.links[first - 1][1] : null;
      const cap = (s: string) => (/^[A-Z/]+$/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1));
      gap = prev ? `${cap(prev)} → ${spec.links[first][1]}` : `${cap(spec.links[first][1])} not evidenced`;
    }
  }

  // ── needs attention ──
  let attention: string | null = null;
  if (impact === 'Broken') attention = 'thesis break condition fired';
  else if (impact === 'Weakens') attention = `${vName || 'a thesis variable'} fell`;
  else if (quality === 'Conflicting') attention = 'conflicting evidence';
  else if (inp.type === 'Regulatory / legal action' && !inp.noImpact) attention = 'authority action — impact not quantified';
  else if (inp.type === 'Credit rating' && inp.ratingAction === 'downgrade') attention = 'credit rating downgraded';
  else if (inp.type === 'Management change' && inp.senior) attention = 'senior management change';
  else if (materiality === 'Material' && inp.read === 'failed') attention = 'material filing could not be read';

  return {
    eventType: inp.type, sourceDocument: inp.sourceDoc, sourceDate: inp.date, exchange: inp.exchange, materiality,
    keyNumber, event, evidence: evidenceWords(inp, unread && !claims.length),
    thesisType: pattern, thesisName: tName || null, thesisVariable: variable, thesisVariableLabel: variable ? varLabel(variable) : null, mapped,
    impact, why, quality, qualityWhy, delta, chain, next, gap, attention, lowConfidence: low,
  };
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
  const t = String(s || '').trim();
  if (!t) return null;
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
