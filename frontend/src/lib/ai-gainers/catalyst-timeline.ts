// ═══════════════════════════════════════════════════════════════════════════
// CATALYST TIMELINE — one record per UNDERLYING catalyst.            (zzz785 C)
//
// A company's filings, press releases and news articles about the same thing
// (RAYMOND: an aerospace qualification, then an order, then "multi-programme
// orders worth ~₹33 Cr annually") are ONE catalyst with a timeline, not three
// new events. This module:
//
//   · reads StructuredFacts / SourceRefs (workstreams A/B) defensively — and,
//     when a finding carries none, builds one legacy fact from what the
//     finding already says, so today's data still gets a record;
//   · groups facts by catalystIdOf() and merges press into the filing record
//     for the same catalyst ("secondary · confirmed by filing");
//   · derives a state IDENTIFIED → DOCUMENTED → EXECUTING → CONFIRMED →
//     WEAKENING → DISPROVED from the evidence only, merged with the state a
//     previous day stored (persistence-store.ts), so a later gainer sees it.
//
// PURE AND DETERMINISTIC: no clock, no network. Price never enters. A number
// the evidence does not state stays null. Unknown is never negative.
// ═══════════════════════════════════════════════════════════════════════════

import {
  catalystIdOf, emptyEconomics, emptyTime,
  type CatalystRecord, type CatalystState, type EventKind, type SourceKind, type SourceRef, type StructuredFacts,
} from './structured-facts';

// ── defensive readers for the optional Finding fields (A/B contract) ─────

const isObj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
const isSource = (s: any): s is SourceRef => isObj(s) && typeof s.kind === 'string' && typeof s.title === 'string';
const isFact = (x: any): x is StructuredFacts => isObj(x) && isSource(x.source) && isObj(x.event) && typeof x.event.kind === 'string';

/** StructuredFacts[] from `finding.facts` — only when it is the new array
 *  shape. The older `facts` (a Record<string,string>) is NOT this. */
export function structuredFactsOf(f: any): StructuredFacts[] {
  // zzz785 — workstream A publishes the array as `structuredFacts` (the old
  // `facts` name is taken by the reader's key→text map); accept both.
  const raw = f && (Array.isArray((f as any).structuredFacts) ? (f as any).structuredFacts : (f as any).facts);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isFact).map((x) => ({
    ...x,
    economics: { ...emptyEconomics(), ...(isObj(x.economics) ? x.economics : {}) },
    time: { ...emptyTime(), ...(isObj(x.time) ? x.time : {}) },
    quotes: Array.isArray(x.quotes) ? x.quotes.filter((q: any) => typeof q === 'string') : [],
    unknowns: Array.isArray(x.unknowns) ? x.unknowns.filter((q: any) => typeof q === 'string') : [],
  }));
}

/** The older key → string map (zzz775), never the new array. */
export function legacyFactMapOf(f: any): Record<string, string> | null {
  const raw = f && (f as any).facts;
  return isObj(raw) ? raw as Record<string, string> : null;
}

export function sourcesOf(f: any): SourceRef[] {
  const raw = f && (Array.isArray((f as any).sourceRefs) ? (f as any).sourceRefs : (f as any).sources);
  return Array.isArray(raw) ? raw.filter(isSource) : [];
}

export type EvidenceGap = 'NO_CATALYST' | 'EVIDENCE_INCOMPLETE' | 'UNCLASSIFIED';
export function evidenceGapOf(f: any): EvidenceGap | null {
  const g = f && (f as any).evidenceGap;
  return g === 'NO_CATALYST' || g === 'EVIDENCE_INCOMPLETE' || g === 'UNCLASSIFIED' ? g : null;
}

// ── plain-English labels ────────────────────────────────────────────────

export const KIND_WORD: Record<EventKind, string> = {
  order: 'Order', capacity: 'Capacity', qualification: 'Qualification / approval', acquisition: 'Acquisition',
  new_product: 'New product', fundraising: 'Fundraising', partnership: 'Partnership', stake_by_strategic: 'Strategic investment',
  guidance: 'Guidance', results: 'Results', regulatory_negative: 'Regulatory action', tax_litigation: 'Tax / legal demand',
  debt: 'Debt', governance: 'Governance', resale_registration: 'Resale registration', other: 'Event',
  // zzz787 — distinct ownership / corporate kinds.
  merger: 'Merger', strategic_expansion: 'Strategic expansion', strategic_investment: 'Strategic investment',
  promoter_buying: 'Promoter stake purchase', capital_allocation: 'Capital allocation',
};

export const NEGATIVE_KINDS = new Set<EventKind>(['regulatory_negative', 'tax_litigation']);
/** Kinds that move money around or register stock — not an operating mechanism.
 *  zzz787: promoter buying and capital allocation (buyback / dividend) are
 *  capital-allocation research, not an operating mechanism either. */
export const NON_OPERATING_KINDS = new Set<EventKind>(['fundraising', 'resale_registration', 'debt', 'governance', 'tax_litigation', 'regulatory_negative', 'promoter_buying', 'capital_allocation']);
/** zzz787: neutral kinds (financing / housekeeping) — never listed as good or bad news. */
const NEUTRAL_KINDS = new Set<EventKind>(['resale_registration', 'debt', 'governance', 'capital_allocation']);
export const polarityOfKind = (k: EventKind): 'positive' | 'negative' | 'neutral' => (NEGATIVE_KINDS.has(k) ? 'negative' : NEUTRAL_KINDS.has(k) ? 'neutral' : 'positive');

export const OFFICIAL_KINDS = new Set<SourceKind>(['EXCHANGE_FILING', 'SEC_FILING', 'SUBSIDIARY_FILING', 'COMPANY_IR']);
export const isOfficial = (s: SourceRef) => OFFICIAL_KINDS.has(s.kind);

export const SOURCE_WORD: Record<SourceKind, string> = {
  EXCHANGE_FILING: 'Exchange filing', SEC_FILING: 'SEC filing', COMPANY_IR: 'Company release',
  PRESS: 'Press', SUBSIDIARY_FILING: 'Group-company filing',
};

// ── legacy finding → one StructuredFacts ────────────────────────────────

const CATEGORY_KIND: Record<string, EventKind> = {
  order_win: 'order', backlog_increase: 'order', order_cancellation: 'order', new_customer: 'order', customer_ramp: 'order',
  capacity_expansion: 'capacity', production_ramp: 'capacity', utilization_increase: 'capacity',
  product_qualification: 'qualification', regulatory_approval: 'qualification', export_approval: 'qualification',
  acquisition: 'acquisition', open_offer: 'acquisition', strategic_investor: 'stake_by_strategic',
  // zzz787: no longer 'other' / forced into acquisition.
  new_geography: 'strategic_expansion', promoter_purchase: 'promoter_buying', buyback: 'capital_allocation',
  new_product: 'new_product', fundraising: 'fundraising', dilution: 'fundraising',
  joint_venture: 'partnership', quarterly_result: 'results', margin_expansion: 'results',
  revenue_guidance_increase: 'guidance', guidance_reduction: 'guidance',
  tax_litigation: 'tax_litigation', regulatory_investigation: 'regulatory_negative',
  debt_stress: 'debt', debt_reduction: 'debt', management_change: 'governance', auditor_resignation: 'governance', governance: 'governance',
};
const RX_RESALE = /resale \/ shelf|resale (registration|prospectus)|shelf registration|selling (stock|share)holders?/i;

/** A finding stored before workstreams A/B carry no StructuredFacts. The
 *  finding's own category, stated value, source and quote become ONE fact —
 *  nothing more is inferred. Null for a finding with no event. */
export function legacyFactFromFinding(f: any): StructuredFacts | null {
  if (!f || !f.ticker) return null;
  const st = String(f.status || '');
  if (!(st === 'catalyst' || st === 'negative')) return null;
  const hay = `${f.headline || ''} ${f.evidenceQuote || ''} ${(f.notes || []).join(' ')}`;
  let kind: EventKind = CATEGORY_KIND[String(f.category || '')] || 'other';
  if (kind === 'fundraising' && f.market === 'US' && RX_RESALE.test(hay)) kind = 'resale_registration';
  const legacy = legacyFactMapOf(f) || {};
  const tier = String(f.sourceTier || '');
  const kindOfSource: SourceKind = tier === 'secondary' || tier === 'tertiary' || tier === 'unsourced' ? 'PRESS' : f.market === 'US' ? 'SEC_FILING' : 'EXCHANGE_FILING';
  const read = !!(f.modelRead || f.docExtract);
  const value = typeof f.valueStated === 'number' && Number.isFinite(f.valueStated) ? f.valueStated : null;
  const stage = f.stage === 'enabling' ? 'PROPOSED' : f.stage === 'executed' ? 'AWARDED' : null;
  return {
    source: {
      kind: kindOfSource, access: read ? 'DOCUMENT_READ' : 'SUMMARY_ONLY', issuer: String(f.ticker).toUpperCase(),
      date: f.sourceDate ? String(f.sourceDate).slice(0, 10) : null, url: f.sourceUrl || null, title: String(f.headline || KIND_WORD[kind]),
    },
    event: { kind, counterparty: legacy.counterparty || null, product: legacy.product || null, geography: null, stage },
    economics: { ...emptyEconomics(), valueNative: value, currency: value == null ? null : f.market === 'US' ? 'USD_M' : 'INR_CR' },
    time: { ...emptyTime(), executionPeriod: legacy.execution_period || null },
    quotes: f.evidenceQuote ? [String(f.evidenceQuote)] : [],
    unknowns: [],
    verificationRequired: kindOfSource === 'PRESS' || !read,
  };
}

/** Every fact the finding carries: the structured ones, or the legacy one. */
export function factsForFinding(f: any): StructuredFacts[] {
  const s = structuredFactsOf(f);
  if (s.length) return s;
  const one = legacyFactFromFinding(f);
  return one ? [one] : [];
}

// ── grouping + dedup ────────────────────────────────────────────────────

const normTitle = (s: string) => String(s || '').toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').replace(/[^a-z0-9₹$.]+/g, ' ').replace(/\s+/g, ' ').trim();
const flat = (s: string) => s.replace(/-/g, '');
export function sourceKey(s: SourceRef): string {
  if (s.hash) return `h:${s.hash}`;
  if (s.accession) return `a:${s.accession}`;
  if (s.url) return `u:${String(s.url).replace(/[?#].*$/, '').toLowerCase()}`;
  return `t:${s.kind}|${normTitle(s.title)}|${s.date || ''}`;
}

const anchorOf = (id: string) => id.split(':').slice(2).join(':');
/** Two anchors name the same thing ("powergrid" ⊂ "power-grid-of-india"). */
function sameAnchor(a: string, b: string): boolean {
  if (!a || !b || a === 'general' || b === 'general') return false;
  if (a === b) return true;
  const fa = flat(a), fb = flat(b);
  return fa.length >= 4 && fb.length >= 4 && (fa.includes(fb) || fb.includes(fa));
}

const dateCmp = (a: string | null, b: string | null) => (a && b ? (a < b ? -1 : a > b ? 1 : 0) : a ? -1 : b ? 1 : 0);

export interface TimelineEntry {
  date: string | null;
  title: string;
  kind: SourceKind;
  kindWord: string;
  access: SourceRef['access'];
  url: string | null;
  eventKind: EventKind;
  /** 'official' / 'secondary · verification required' / 'secondary · confirmed by filing'. */
  status: string;
  /** Id of the catalyst this entry belongs to (a thread spans related ids). */
  catalystId: string;
}

export interface CatalystView extends CatalystRecord {
  timeline: TimelineEntry[];
  polarity: 'positive' | 'negative' | 'neutral';
  /** The single-line plain-English verification status of the record. */
  verification: string;
  /** Latest structured facts for this catalyst (newest last). */
  facts: StructuredFacts[];
  /** How many documents repeated the same thing (dedup count). */
  duplicatesMerged: number;
}

// ── state machine ───────────────────────────────────────────────────────

export const STATE_WORD: Record<CatalystState, string> = {
  IDENTIFIED: 'Identified (not yet in an official filing)', DOCUMENTED: 'Documented in a filing', EXECUTING: 'Executing — follow-up evidence on file',
  CONFIRMED: 'Confirmed — completed / delivering', WEAKENING: 'Weakening — delay or cut on file', DISPROVED: 'Disproved — cancelled or denied',
};
const LADDER: CatalystState[] = ['IDENTIFIED', 'DOCUMENTED', 'EXECUTING', 'CONFIRMED'];
const rank = (s: CatalystState) => LADDER.indexOf(s);
const RX_DISPROVE = /\bcancel(l?ed|lation)\b|\bterminat(ed|ion)\b|\bwithdrawn\b|\brevoked\b|\blapsed\b|\bcalled off\b|\brescind|\bno such (order|deal|agreement|proposal)\b|\bdenie[sd]\b/i;
const RX_WEAKEN = /\bdelay(ed|s)?\b|\bdeferred\b|\bpostponed\b|\bscaled down\b|\breduced (order|scope|quantity)\b|\bshort ?fall\b|\bput on hold\b|\bcurtail|\bslow(er|down)\b/i;

function textOf(x: StructuredFacts) { return `${x.source.title} ${x.quotes.join(' ')}`; }

export function deriveState(facts: StructuredFacts[]): CatalystState {
  const sorted = [...facts].sort((a, b) => dateCmp(a.source.date, b.source.date));
  const official = sorted.filter((x) => isOfficial(x.source));
  const kind = sorted[0]?.event.kind;
  // Negative words only change the state when an OFFICIAL source says them;
  // a press line about a delay stays a question, never a verdict.
  const lastOfficial = official[official.length - 1];
  if (lastOfficial && !NEGATIVE_KINDS.has(kind!)) {
    const t = textOf(lastOfficial);
    if (RX_DISPROVE.test(t)) return 'DISPROVED';
    if (RX_WEAKEN.test(t)) return 'WEAKENING';
  }
  if (!official.length) return 'IDENTIFIED';
  const dates = new Set(official.map((x) => x.source.date).filter(Boolean));
  const stages = new Set(official.map((x) => x.event.stage));
  if (stages.has('COMPLETED') || (dates.size >= 2 && stages.has('COMMISSIONED'))) return 'CONFIRMED';
  if (stages.has('COMMISSIONED') || dates.size >= 2) return 'EXECUTING';
  return 'DOCUMENTED';
}

const DEFAULT_NEXT: Partial<Record<EventKind, string>> = {
  order: 'First execution or billing update against this order (next results or order-book disclosure)',
  capacity: 'Commissioning date and the first utilisation figure for the new capacity',
  qualification: 'First commercial purchase order from the qualified customer',
  acquisition: 'Deal completion and the first consolidated quarter including the target',
  new_product: 'First named customer order or revenue from the product',
  fundraising: 'Allotment filing with price, allottees and the stated use of proceeds',
  stake_by_strategic: 'An official filing (SAST / 13D / exchange disclosure) that confirms the stake',
  resale_registration: 'Actual sales by the registered holders (Form 4 / 144 filings)',
  tax_litigation: 'Company response, appeal or final order — and any amount paid or provided',
  regulatory_negative: 'Company response or final order, and any amount paid or provided',
  partnership: 'Definitive agreement or first binding order under it',
  results: 'Next quarter\'s result — does the change repeat?',
  guidance: 'Next quarter against the guidance',
  merger: 'Scheme / merger approvals (board, shareholders, NCLT) and the effective date',
  strategic_expansion: 'First revenue, order or investment figure from the new entity / geography',
  strategic_investment: 'An official filing (SAST / 13D / exchange disclosure) that confirms the stake, then any commercial agreement',
  promoter_buying: 'Next shareholding disclosure — does the promoter keep buying?',
  capital_allocation: 'Completion of the buyback / payout and what it does to the share count',
};
const INVALIDATION: Partial<Record<EventKind, string>> = {
  order: 'Order cancelled, cut or delayed, or no revenue from it by the end of the stated execution period.',
  capacity: 'Commissioning slips, or utilisation of the new capacity stays low.',
  qualification: 'No commercial order follows, or the customer drops the programme.',
  acquisition: 'Deal terminated, or the target\'s revenue / profit falls short of what was stated.',
  new_product: 'No orders or revenue from the product over the next few quarters.',
  fundraising: 'Allotment not completed, or proceeds used for something other than stated.',
  stake_by_strategic: 'Official filings do not confirm the stake, or the investor sells it.',
  resale_registration: 'Not a business catalyst — nothing to invalidate; watch the volume actually sold.',
  tax_litigation: 'Clears if the demand is quashed or settled small; worsens if a larger or repeated demand follows.',
  regulatory_negative: 'Clears if the action is withdrawn; worsens if penalties or restrictions follow.',
  partnership: 'Agreement lapses without a binding order.',
  results: 'Next quarter does not repeat the change.',
  guidance: 'Next quarter falls short of the guidance.',
  merger: 'Scheme withdrawn, rejected or delayed by approvals.',
  strategic_expansion: 'The new entity stays dormant — no revenue, order or investment follows.',
  strategic_investment: 'Official filings do not confirm the stake, or the investor sells it.',
  promoter_buying: 'Promoter sells or pledges shares.',
  capital_allocation: 'Buyback / payout withdrawn or not completed.',
};

function titleOf(kind: EventKind, facts: StructuredFacts[]): string {
  const best = [...facts].sort((a, b) => Number(isOfficial(b.source)) - Number(isOfficial(a.source)) || dateCmp(b.source.date, a.source.date))[0];
  const who = facts.map((x) => x.event.counterparty).find(Boolean);
  const what = facts.map((x) => x.event.product).find(Boolean);
  const tail = [who, what].filter(Boolean).join(' · ');
  return tail ? `${KIND_WORD[kind]} — ${tail}` : (best?.source.title || KIND_WORD[kind]);
}

export interface BuildOptions {
  /** Records stored on an earlier day, keyed by id (persistence-store.ts). */
  prior?: Record<string, CatalystRecord> | null;
  /** ISO date for firstSeen / lastSeen when a record is new; never the clock. */
  today?: string | null;
}

/** Group one company's facts into catalyst records (current evidence merged
 *  with the stored prior). Sorted: most recent evidence first. */
export function buildCatalystRecords(ticker: string, market: 'IN' | 'US', facts: StructuredFacts[], opt: BuildOptions = {}): CatalystView[] {
  const T = String(ticker || '').toUpperCase();
  const groups = new Map<string, StructuredFacts[]>();
  for (const x of facts) {
    const id = catalystIdOf(T, x.event.kind, x.event.counterparty, x.event.product);
    groups.set(id, [...(groups.get(id) || []), x]);
  }
  // Fold near-identical anchors together ("powergrid" / "power-grid-of-india"),
  // then fold a 'general' group (press with no counterparty) into the one
  // specific record of the same kind — press → the filing record.
  const ids = Array.from(groups.keys()).sort();
  for (const a of ids) {
    if (!groups.has(a)) continue;
    for (const b of ids) {
      if (a >= b || !groups.has(b)) continue;
      const [ka, kb] = [a.split(':')[1], b.split(':')[1]];
      if (ka === kb && sameAnchor(anchorOf(a), anchorOf(b))) { groups.set(a, [...groups.get(a)!, ...groups.get(b)!]); groups.delete(b); }
    }
  }
  for (const id of Array.from(groups.keys())) {
    if (anchorOf(id) !== 'general') continue;
    const k = id.split(':')[1];
    const specific = Array.from(groups.keys()).filter((o) => o !== id && o.split(':')[1] === k).sort();
    if (!specific.length) continue;
    // Several specific records of this kind: the press goes to the one filed
    // closest to it (ties → the newer filing).
    const pressDate = groups.get(id)!.map((x) => x.source.date).filter(Boolean).sort()[0] || null;
    const gap = (o: string) => {
      const ds = groups.get(o)!.map((x) => x.source.date).filter(Boolean) as string[];
      if (!pressDate || !ds.length) return 1e9;
      return Math.min(...ds.map((d) => Math.abs(Date.parse(d) - Date.parse(pressDate)) / 86_400_000));
    };
    const newest = (o: string) => groups.get(o)!.map((x) => x.source.date || '').sort().slice(-1)[0];
    const target = specific.reduce((best, o) => (gap(o) < gap(best) || (gap(o) === gap(best) && newest(o) > newest(best)) ? o : best), specific[0]);
    groups.set(target, [...groups.get(target)!, ...groups.get(id)!]); groups.delete(id);
  }
  // A stored record whose id is similar (anchor containment) adopts today's group.
  const prior = opt.prior || {};
  const priorFor = (id: string): CatalystRecord | null => {
    if (prior[id]) return prior[id];
    const k = id.split(':')[1];
    const hit = Object.values(prior).find((r) => r && r.ticker === T && r.kind === k && sameAnchor(anchorOf(r.id), anchorOf(id)));
    return hit || null;
  };

  const out: CatalystView[] = [];
  for (const [id0, list] of Array.from(groups.entries())) {
    const p = priorFor(id0);
    const id = p ? p.id : id0;
    const kind = list[0].event.kind;
    // dedup sources: today's + stored, one entry per document
    const seen = new Map<string, SourceRef>();
    const titleSeen = new Set<string>();
    let dup = 0;
    // Earliest copy of a repeated document / headline is the one kept.
    const all: SourceRef[] = [...(p?.sources || []), ...list.map((x) => x.source)].map((x, i) => [x, i] as const)
      .sort((a, b) => dateCmp(a[0].date, b[0].date) || a[1] - b[1]).map((x) => x[0]);
    for (const s of all) {
      const k = sourceKey(s);
      // a repeated headline (same words, any date) from press is one item
      const tk = s.kind === 'PRESS' ? `p:${normTitle(s.title)}` : null;
      if (seen.has(k) || (tk && titleSeen.has(tk))) { dup++; continue; }
      seen.set(k, s); if (tk) titleSeen.add(tk);
    }
    const sources = Array.from(seen.values()).sort((a, b) => dateCmp(a.date, b.date));
    const anyOfficial = sources.some(isOfficial);
    // State from today's facts plus pseudo-facts for stored official sources
    // (a stored filing is still a filing on file).
    const stored: StructuredFacts[] = (p?.sources || []).filter((s) => !list.some((x) => sourceKey(x.source) === sourceKey(s))).map((s) => ({
      source: s, event: { kind, counterparty: null, product: null, geography: null, stage: null }, economics: emptyEconomics(), time: emptyTime(), quotes: [], unknowns: [], verificationRequired: !isOfficial(s),
    }));
    let state = deriveState([...stored, ...list]);
    let previousState: CatalystState | null = p ? p.previousState : null;
    if (p) {
      const newOfficial = list.some((x) => isOfficial(x.source) && !(p.sources || []).some((s) => sourceKey(s) === sourceKey(x.source)));
      const pNeg = p.state === 'WEAKENING' || p.state === 'DISPROVED';
      if (state !== 'WEAKENING' && state !== 'DISPROVED') {
        if (pNeg && !newOfficial) state = p.state;                         // no new filing: the stored warning stands
        else if (!pNeg && rank(p.state) > rank(state)) state = p.state;    // the ladder never slides back without contrary evidence
      }
      if (state !== p.state) previousState = p.state;
    }
    const newest = [...list].sort((a, b) => dateCmp(b.source.date, a.source.date))[0];
    const stated = [...list].reverse().map((x) => x.time.milestones[0] || (x.time.expectedCompletion ? `Completion expected ${x.time.expectedCompletion} (as stated)` : null)).find(Boolean) || null;
    const nextMilestone = !anyOfficial ? 'An official filing that confirms it' : stated || DEFAULT_NEXT[kind] || 'Next filing that states numbers for this event';
    const latest = sources[sources.length - 1];
    const latestEvidence = latest ? `${latest.date || 'undated'} · ${SOURCE_WORD[latest.kind]}: ${latest.title}` : null;
    const firstSeen = p?.firstSeen || opt.today || sources[0]?.date || newest?.source.date || '';
    const lastSeen = opt.today || newest?.source.date || p?.lastSeen || firstSeen;
    const timeline: TimelineEntry[] = sources.map((s) => ({
      date: s.date, title: s.title, kind: s.kind, kindWord: SOURCE_WORD[s.kind] || s.kind, access: s.access, url: s.url || null, eventKind: kind, catalystId: id,
      status: isOfficial(s) ? (s.access === 'SUMMARY_ONLY' ? 'official · subject line only' : 'official') : anyOfficial ? 'secondary · confirmed by filing' : 'secondary · verification required',
    }));
    out.push({
      id, ticker: T, market, kind, title: titleOf(kind, list), state, previousState,
      latestEvidence, nextMilestone, invalidation: INVALIDATION[kind] || 'A later filing that contradicts it.',
      sources, firstSeen, lastSeen, timeline,
      // zzz789: a tax / legal matter whose every fact is a FAVOURABLE outcome (appeal allowed, demand
      // reduced / quashed) is resolved — positive, never listed as negative (PRIORITY).
      polarity: NEGATIVE_KINDS.has(kind) && list.length > 0 && list.every((x) => (x as any).polarity === 'positive') ? 'positive' : polarityOfKind(kind),
      verification: anyOfficial ? (sources.some((s) => !isOfficial(s)) ? 'Official filing on file · press merged into it' : 'Official filing on file') : 'Secondary · verification required',
      facts: [...list].sort((a, b) => dateCmp(a.source.date, b.source.date)), duplicatesMerged: dup,
    });
  }
  return out.sort((a, b) => dateCmp(b.timeline[b.timeline.length - 1]?.date ?? null, a.timeline[a.timeline.length - 1]?.date ?? null) || (a.id < b.id ? -1 : 1));
}

/** A THREAD: the record plus every related record of the same company that
 *  names the same counterparty / product (qualification → order → repeat
 *  order), merged into one timeline, oldest → newest. RAYMOND's older
 *  aerospace filings and the current one read as one story. */
const THREAD_STOP = new Set(['leading', 'indian', 'india', 'major', 'oem', 'global', 'international', 'the', 'and', 'of', 'a', 'an', 'for', 'company', 'group', 'customer', 'client', 'general', 'domestic', 'large', 'reputed', 'marquee']);
const anchorTokens = (a: string) => new Set(a.split('-').filter((t) => t.length > 2 && !THREAD_STOP.has(t)));
/** Related catalysts: the same anchor, or anchors that share their
 *  significant words ("leading Indian aerospace and defence major" /
 *  "… OEM" → {aerospace, defence}). Display only — never merges records. */
export function relatedAnchor(a: string, b: string): boolean {
  if (sameAnchor(a, b)) return true;
  const A = anchorTokens(a), B = anchorTokens(b);
  if (!A.size || !B.size) return false;
  let inter = 0; A.forEach((t) => { if (B.has(t)) inter++; });
  return inter / (A.size + B.size - inter) >= 0.5;
}

export function threadTimeline(records: CatalystView[], current: CatalystView): TimelineEntry[] {
  const a = anchorOf(current.id);
  const related = records.filter((r) => r.id === current.id || (r.ticker === current.ticker && relatedAnchor(anchorOf(r.id), a)));
  const seen = new Set<string>();
  const out: TimelineEntry[] = [];
  for (const r of related) for (const t of r.timeline) {
    const k = `${t.url || ''}|${normTitle(t.title)}|${t.date || ''}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out.sort((x, y) => dateCmp(x.date, y.date));
}

/** Independent dimensions of the evidence — never a raw item count. */
export interface EvidenceBreadth { documents: number; sourceKinds: number; eventKinds: number; text: string }
export function evidenceBreadthOf(f: any, records: CatalystView[]): EvidenceBreadth | null {
  const given = f && (f as any).evidenceBreadth;
  const n = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  let documents: number | null = null, sourceKinds: number | null = null, eventKinds: number | null = null;
  if (isObj(given)) { documents = n(given.documents); sourceKinds = n(given.sourceKinds); eventKinds = n(given.eventKinds); }
  if (documents == null || sourceKinds == null || eventKinds == null) {
    if (!records.length) return null;
    const docs = new Set<string>(), kinds = new Set<string>(), evs = new Set<string>();
    for (const r of records) { evs.add(r.kind); for (const s of r.sources) { docs.add(sourceKey(s)); kinds.add(s.kind); } }
    documents = documents ?? docs.size; sourceKinds = sourceKinds ?? kinds.size; eventKinds = eventKinds ?? evs.size;
  }
  const pl = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  return { documents, sourceKinds, eventKinds, text: `${pl(documents, 'document')} · ${pl(sourceKinds, 'source kind')} · ${pl(eventKinds, 'event kind')}` };
}

/** Strip a view to the stored contract (what persistence-store keeps). */
export function toStoredRecord(v: CatalystView, maxSources = 12): CatalystRecord {
  return {
    id: v.id, ticker: v.ticker, market: v.market, kind: v.kind, title: v.title, state: v.state, previousState: v.previousState,
    latestEvidence: v.latestEvidence, nextMilestone: v.nextMilestone, invalidation: v.invalidation,
    sources: v.sources.slice(-maxSources), firstSeen: v.firstSeen, lastSeen: v.lastSeen,
  };
}

/** A stored record (earlier day) with no evidence today, as a view — so the
 *  card's timeline still shows the older related filings. */
export function storedView(r: CatalystRecord): CatalystView {
  const anyOfficial = (r.sources || []).some(isOfficial);
  const sources = [...(r.sources || [])].sort((a, b) => dateCmp(a.date, b.date));
  return {
    ...r, sources,
    timeline: sources.map((s) => ({
      date: s.date, title: s.title, kind: s.kind, kindWord: SOURCE_WORD[s.kind] || s.kind, access: s.access, url: s.url || null, eventKind: r.kind, catalystId: r.id,
      status: isOfficial(s) ? (s.access === 'SUMMARY_ONLY' ? 'official · subject line only' : 'official') : anyOfficial ? 'secondary · confirmed by filing' : 'secondary · verification required',
    })),
    polarity: polarityOfKind(r.kind),
    verification: anyOfficial ? 'Official filing on file (earlier day)' : 'Secondary · verification required',
    facts: [], duplicatesMerged: 0,
  };
}
