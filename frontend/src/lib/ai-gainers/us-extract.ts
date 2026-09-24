// ═══════════════════════════════════════════════════════════════════════════
// US DOCUMENT → StructuredFacts, WITHOUT A MODEL.                    (zzz785)
//
// The SEC item code routes (sec-routing.ts); this reads the words. Each
// extractor looks for narrowly defined statements and keeps the sentence it
// came from as a verbatim quote (checked against the document). Rules:
//   · a number the text does not state stays null — never estimated;
//   · null is UNKNOWN, listed in `unknowns` in plain English — never "no";
//   · a hedged figure (up to / potential / expected to generate) is not a
//     value; a facility's "up to" size is recorded as a TERM, not a value;
//   · ratios only from stated numbers, with the formula shown;
//   · price never enters any field;
//   · press is secondary: verificationRequired until a filing states it.
// ═══════════════════════════════════════════════════════════════════════════

import {
  emptyEconomics, emptyTime, catalystIdOf, favourableLegalOutcome, debtActionOf,
  type EventFacts, type EventKind, type SourceRef, type StructuredFacts,
} from './structured-facts';
import { filingSentences, fmtUsdM, usFormOf } from './us-gainers';
import { routeSecFiling, pressSourceRef, sourceRankOf, isOfficial, rankSources, dedupeSources, type ExtractFocus, type UsPressItem } from './sec-routing';

/** StructuredFacts plus the stated terms a US filing carries that have no
 *  numeric slot in the shared contract (rate, maturity, per-share price,
 *  premium, financing). Structurally a StructuredFacts — it can be passed
 *  anywhere one is expected. */
export interface UsStructuredFacts extends StructuredFacts {
  /** Stated terms in words, each copied from a quoted sentence. */
  terms: Array<{ label: string; value: string }>;
  /** Stated numbers used for ratios (never estimated). */
  stated: { perShare?: number; premiumPct?: number; outstandingShares?: number; sharesRegistered?: number; ratePct?: number; facilityUpToM?: number };
  /** Other documents that state the same event (EX-99.1 beside the 8-K body,
   *  or a press item the filing confirmed). */
  alsoFrom?: SourceRef[];
}

// ── helpers ────────────────────────────────────────────────────────────────

const WS = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

/** A quote is kept only if it is in the document, verbatim (whitespace-normalised). */
export function verifyQuote(q: string, text: string): boolean {
  const n = WS(q);
  return n.length >= 12 && WS(text).includes(n);
}

const HEDGED = /\b(potential(ly)?|could|may|might|up to|as much as|estimated|expected to (generate|be worth|reach|contribute)|anticipat\w+ (revenue|value|to generate)|opportunity|addressable|pipeline|pro forma|combined company|target(ed|ing)? (revenue|value))\b/i;

/** A sentence about what MIGHT happen (risk factor, condition, negation) is
 *  never the event: "If we enter into a letter of intent…" (NUAI), "the
 *  Foundation may elect to acquire…" (USDE). */
const HYPOTHETICAL = /^(if|should|although|while|to the extent|in the event|there can be no assurance|no assurance)\b|\b(if we|if the company|there can be no assurance|no assurance that|may (elect|continue|explore|seek|decide)|is not obligated|are not required|not required to|would be|could be required|we cannot|may not be able|risk factors?|potential (tenants?|partners?|customers?|buyers?))\b/i;
const factual = (s: string) => !HYPOTHETICAL.test(s);

const MONEY_G = /(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mm|mn|m|b)?\b/gi;

/** "$1.3 billion" → 1300 ($M); "$942 million" → 942; "$1,250,000" → 1.25. A bare
 *  small dollar figure ("$9.50") is not a $M amount → null. */
export function moneyToM(num: string, unit?: string | null): number | null {
  const v = parseFloat(String(num).replace(/,/g, ''));
  if (!Number.isFinite(v) || v <= 0) return null;
  const u = String(unit || '').toLowerCase();
  if (/^(billion|bn|b)$/.test(u)) return Math.round(v * 1000 * 1000) / 1000;
  if (/^(million|mm|mn|m)$/.test(u)) return v;
  if (u === 'thousand') return Math.round(v) / 1000;
  return v >= 100_000 ? Math.round((v / 1e6) * 1000) / 1000 : null;
}

function firstMoneyM(s: string): number | null {
  for (const m of s.matchAll(MONEY_G)) { const v = moneyToM(m[1], m[2]); if (v != null) return v; }
  return null;
}

const NUM = (s: string) => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? v : null; };
const r2 = (v: number) => Math.round(v * 100) / 100;

/** "12,500,000" / "12.5 million" → share count. */
function shareCount(n: string, unit?: string | null): number | null {
  const v = NUM(n);
  if (v == null || v <= 0) return null;
  return /million/i.test(String(unit || '')) ? Math.round(v * 1e6) : Math.round(v);
}

// A proper-noun phrase (company or person): capitalised words, &, of/and inside, optional suffix.
const NAME = String.raw`((?:[A-Z][A-Za-z0-9&.'’-]*|&)(?:\s+(?:[A-Z][A-Za-z0-9&.'’-]*|&|of|and|de|du|la|for))*(?:,?\s+(?:Inc|LLC|L\.L\.C|Ltd|Limited|Corp|Corporation|Co|L\.P|LP|plc|N\.V|N\.A|S\.A|AG|GmbH|Holdings)\.?)?)`;
function cleanName(s: string | null | undefined): string | null {
  const n = WS(String(s || '')).replace(/[,;:]+$/, '').replace(/\s+(of|and|de|for|the)$/i, '').replace(/^(the|a|an)\s+/i, '');
  if (!n || n.length < 2 || /^(The|This|Under|Pursuant|Each|Such|Company|Registrant|Agreement|Merger|Parent|Buyer|Seller|Purchaser)$/i.test(n)) return null;
  return n.slice(0, 80);
}

const FINANCIAL_HOLDER = /\b(vanguard|blackrock|state street|fidelity|fmr\b|geode|invesco|t\. ?rowe|wellington|capital (research|group|management|world)|dimensional|renaissance|citadel|susquehanna|jane street|millennium|two sigma|morgan stanley|goldman sachs|j\.?p\.? ?morgan|ubs|barclays|nomura|northern trust|charles schwab|schwab|franklin|alliancebernstein|nuveen|tiaa|pimco|arrowstreet|point72|d\. ?e\. ?shaw|aqr|bridgewater|ark invest|baillie gifford|advisors?|advisers?|asset management|investment management|capital management|capital partners|partners,? l\.?p|fund\b|funds\b|trust\b|master fund|opportunit(y|ies) fund|family office|ventures?\b|venture partners|holdings?,? l\.?l\.?c|securities|bank\b|n\.a\.)/i;

/** Operating company (strategic) vs a fund / manager / bank (financial) or an
 *  individual. `loose` (press headlines, which drop suffixes: "Amazon") lets a
 *  single-word brand through; two bare capitalised words read as a person. */
export function isStrategicHolder(name: string | null | undefined, loose = false): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  if (FINANCIAL_HOLDER.test(n)) return false;
  if (/\b(inc|corp|corporation|company|co|ltd|limited|plc|ag|n\.v|s\.a|se|group)\b\.?/i.test(n) || /\.com\b/i.test(n)) return true;
  return loose && !/\s/.test(n);
}

function stageOf(s: string): EventFacts['stage'] {
  if (/\b(completed|closed|consummated|has acquired|acquired all)\b/i.test(s)) return 'COMPLETED';
  if (/\b(letter of intent|\bloi\b|non-binding|memorandum of understanding|\bmou\b|term sheet|proposal|proposed|in (advanced )?talks|nears? (a )?deal|explor(es|ing)|people familiar|sources say)\b/i.test(s)) return 'PROPOSED';
  if (/\b(awarded|won|received (a|an) (order|contract|award|purchase order))\b/i.test(s)) return 'AWARDED';
  if (/\b(approv(ed|al) (by|from) (the )?(fda|faa|fcc|nrc|regulator|agency))\b/i.test(s)) return 'APPROVED';
  if (/\b(entered into|signed|executed|definitive)\b/i.test(s)) return 'SIGNED';
  return 'ANNOUNCED';
}

function blank(source: SourceRef, kind: EventKind): UsStructuredFacts {
  const verificationRequired = source.kind === 'PRESS' || source.access === 'SUMMARY_ONLY';
  return {
    source, event: { kind, counterparty: null, product: null, geography: null, stage: null },
    economics: { ...emptyEconomics() }, time: { ...emptyTime() }, quotes: [], unknowns: [],
    verificationRequired, terms: [], stated: {},
  };
}

function addQuote(f: UsStructuredFacts, s: string | null | undefined, text: string) {
  if (!s) return;
  const q = WS(s).slice(0, 600);
  if (verifyQuote(q, text) && !f.quotes.includes(q)) f.quotes.push(q);
}
function addTerm(f: UsStructuredFacts, label: string, value: string | null | undefined) {
  if (!value) return;
  if (!f.terms.some((t) => t.label === label)) f.terms.push({ label, value: WS(value).slice(0, 240) });
}

// ── unknowns + ratios are functions of the facts (so merges recompute them) ──

export function unknownsFor(f: UsStructuredFacts): string[] {
  const e = f.economics, k = f.event.kind, u: string[] = [];
  const has = (label: RegExp) => f.terms.some((t) => label.test(t.label));
  if (k === 'acquisition') {
    if (!f.event.counterparty) u.push('Counterparty (buyer / target) not named in the text read');
    if (e.considerationNative == null) u.push(has(/per[- ]share/i) ? 'Total deal value not stated (only the per-share price is)' : 'Consideration / deal value not stated');
    if (e.targetRevenueNative == null) u.push("Target's revenue not stated");
    if (e.targetProfitNative == null) u.push("Target's EBITDA / profit not stated");
    if (!has(/financing/i)) u.push('How the deal is financed not stated');
    if (!f.time.expectedCompletion && f.event.stage !== 'COMPLETED') u.push('Expected closing date not stated');
  } else if (k === 'order' || k === 'partnership' || k === 'capacity' || k === 'new_product' || k === 'qualification') {
    if (!f.event.counterparty && k !== 'new_product' && k !== 'capacity') u.push('Customer / partner not named');
    if (e.valueNative == null) u.push('Contract value not stated (a hedged "up to / potential" figure is not a value)');
    if (!f.time.executionPeriod) u.push('Duration / execution period not stated');
    if (k === 'partnership' && f.event.stage === 'PROPOSED') u.push('Whether a definitive (binding) agreement follows — not stated');
  } else if (k === 'debt') {
    if (e.valueNative == null && f.stated.facilityUpToM == null) u.push('Amount borrowed not stated');
    if (f.stated.ratePct == null && !has(/rate/i)) u.push('Interest rate not stated');
    if (!has(/maturity/i)) u.push('Maturity not stated');
  } else if (k === 'fundraising' && f.event.product === 'At-the-market (ATM) equity program') {
    u.push('How many shares will be sold, when, and at what prices — not stated (sales are at market prices over time)');
    u.push('Dilution not computable until shares are actually sold');
  } else if (k === 'fundraising') {
    if (e.sharesIssued == null) u.push('Number of shares sold not stated');
    if (e.issuePrice == null) u.push('Price per share not stated');
    if (!e.allottees.length) u.push('Buyers not named');
    if (e.dilutionPct == null) u.push('Dilution % not computable (shares outstanding not stated in the text)');
    if (e.valueNative == null) u.push('Gross proceeds not stated');
  } else if (k === 'resale_registration') {
    if (f.stated.sharesRegistered == null) u.push('Number of shares registered for resale not stated');
    u.push('Whether or when the selling holders will dispose of their shares — not stated (a registration permits sales; it does not require them)');
  } else if (k === 'stake_by_strategic') {
    if (e.stakePct == null) u.push('Stake percentage not stated');
    u.push(`Any commercial agreement with ${f.event.counterparty || 'the holder'} — not stated`);
    u.push('Price paid for the stake and its date — not stated');
  } else if (k === 'regulatory_negative') {
    u.push('Duration of the setback not stated');
    u.push('Financial impact not stated');
  } else if (k === 'governance') {
    if (!f.event.counterparty) u.push('Who is appointed / leaving not stated');
    if (!f.event.product) u.push('Role not stated');
  } else if (k === 'results') {
    if (!has(/revenue/i)) u.push('Revenue figure not found in the release text read');
    if (!has(/outlook|guidance/i)) u.push('Outlook change not stated');
  }
  return u;
}

export function ratiosFor(f: UsStructuredFacts): EconomicRatio[] {
  const e = f.economics, s = f.stated, out: EconomicRatio[] = [];
  if (f.event.kind === 'acquisition' && e.considerationNative != null) {
    if (e.targetRevenueNative) out.push({ label: 'Deal value / target revenue', value: r2(e.considerationNative / e.targetRevenueNative), formula: `${fmtUsdM(e.considerationNative)} ÷ ${fmtUsdM(e.targetRevenueNative)} (both as stated)` });
    if (e.targetProfitNative && e.targetProfitNative > 0) out.push({ label: 'Deal value / target EBITDA', value: r2(e.considerationNative / e.targetProfitNative), formula: `${fmtUsdM(e.considerationNative)} ÷ ${fmtUsdM(e.targetProfitNative)} (both as stated)` });
  }
  if (f.event.kind === 'fundraising' && e.sharesIssued && s.outstandingShares) {
    out.push({ label: 'New shares / shares outstanding', value: r2((e.sharesIssued / s.outstandingShares) * 100), formula: `${e.sharesIssued.toLocaleString('en-US')} ÷ ${s.outstandingShares.toLocaleString('en-US')} × 100 (%)` });
  }
  if (f.event.kind === 'resale_registration' && s.sharesRegistered && s.outstandingShares) {
    out.push({ label: 'Shares registered for resale / shares outstanding', value: r2((s.sharesRegistered / s.outstandingShares) * 100), formula: `${s.sharesRegistered.toLocaleString('en-US')} ÷ ${s.outstandingShares.toLocaleString('en-US')} × 100 (%)` });
  }
  return out;
}
type EconomicRatio = StructuredFacts['economics']['ratios'][number];

function finalise(f: UsStructuredFacts): UsStructuredFacts {
  if (f.event.kind === 'fundraising' && f.economics.dilutionPct == null && f.economics.sharesIssued && f.stated.outstandingShares) {
    f.economics.dilutionPct = r2((f.economics.sharesIssued / f.stated.outstandingShares) * 100);
  }
  f.economics.ratios = ratiosFor(f);
  if (f.economics.valueNative != null || f.economics.considerationNative != null || f.economics.targetRevenueNative != null || f.economics.targetProfitNative != null) f.economics.currency = 'USD_M';
  f.unknowns = unknownsFor(f);
  return f;
}

// ── extractors ────────────────────────────────────────────────────────────

const OUTSTANDING = /([\d,]{5,}(?:\.\d+)?|\d+(?:\.\d+)?\s+million)\s+shares of (?:the (?:Company|Registrant)['’]s |our |its )?(?:Class [AB] )?common stock(?:,[^.]{0,40})? (?:were |are )?(?:issued and )?outstanding/i;

function outstandingOf(text: string): { n: number; s: string } | null {
  for (const s of filingSentences(text)) {
    const m = OUTSTANDING.exec(s);
    if (m) { const mm = /([\d,.]+)\s*(million)?/i.exec(m[1])!; const n = shareCount(mm[1], mm[2]); if (n) return { n, s }; }
  }
  // Cover-page style ("As of … there were 48,000,000 shares … outstanding") without a sentence break.
  const m = /(?:there were|had)\s+([\d,]{5,})\s+shares of [^.]{0,60}?outstanding/i.exec(WS(text));
  if (m) { const n = shareCount(m[1]); if (n) return { n, s: m[0] }; }
  return null;
}

const DEAL_RX = /\b(agreement and plan of merger|merger agreement|definitive (merger |acquisition |purchase )?agreement to (acquire|be acquired|merge|sell)|to be acquired by|agreed to (acquire|be acquired|sell)|will acquire|to acquire|has acquired|completed (its |the )?(acquisition|sale|divestiture)|acquisition of|take[- ]private|take (?:the )?(?:Company|[A-Z][\w&.-]*) private|go(?:ing)?[- ]private|tender offer|sale of (its|the)|divest\w*)\b/i;
const CONSIDERATION = new RegExp(String.raw`\b(valued at|valuing|value of|total consideration of|aggregate consideration of|(?:aggregate |total )?purchase price of|enterprise value of|equity value of|transaction value of|for (?:a total of |total consideration of |aggregate consideration of )?(?=(?:US)?\$[^.]{0,30}(?:in cash|in stock|cash and stock)))\s*(?:approximately |about |roughly |an aggregate of |a total of )?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|bn|mm|mn|m|b)\b`, 'i');
const CONSIDERATION_BEFORE = /(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|bn|mm|mn)\s+(?:all-cash |cash |all-stock |stock |cash-and-stock )?(transaction|acquisition|merger|deal|take-private|buyout)\b/i;
const PER_SHARE = /\$\s?(\d+(?:\.\d+)?)\s+(?:per share|for each share)(?:\s+in cash)?|right to receive \$\s?(\d+(?:\.\d+)?)(?:\s+(?:per share\s+)?in cash)?/i;
const PREMIUM = /premium of (?:approximately |about )?(\d+(?:\.\d+)?)\s?%|(\d+(?:\.\d+)?)\s?% premium\b/i;
const PERIOD = /\b(trailing twelve|twelve months|12 months|last twelve|\bltm\b|\bttm\b|fiscal (year )?\d{4}|fiscal \d{4}|for (the )?(full )?year|calendar (year )?\d{4}|annual(ly)?|in \d{4})\b/i;
const TARGET_REV = /\b(generated|had|reported|delivered|achieved|recorded)\b[^.]{0,60}?\b(revenues?|net sales|sales)\b[^.]{0,20}?(?:of )?(?:approximately |about )?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million)|\b(revenues?|net sales)\b (?:of|was|were|totaled|totalled) (?:approximately |about )?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million)/i;
const TARGET_EBITDA = /\b(?:adjusted )?ebitda\b[^.]{0,25}?(?:of|was|were|totaled|totalled)? (?:approximately |about )?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million)/i;
const FINANCING = /\b(financ(ed|ing)|funded (with|through|by)|fund the (transaction|merger|acquisition|purchase)|committed (debt |equity )?financing|debt commitment|equity commitment|cash on hand|bridge (loan|facility)|no financing condition|not subject to (a )?financing condition)\b/i;
const CLOSE = /\b(?:is |are )?(?:expected|anticipated) to (?:close|be completed|be consummated) ((?:in|by|during|within|before|on or before|at the end of|late in|early in) [^.,;()]{3,60})/i;
const CONDITIONS = /\bsubject to ([^.;]{5,160})/i;

function extractDeal(text: string, source: SourceRef, issuerName: string | null): UsStructuredFacts | null {
  const ss = filingSentences(text);
  const EVENT_VERB = /\b(entered into|announce[sd]?|agreed|agrees|signed|signs|completed|completes|closed|consummated|has acquired|will acquire|to be acquired|definitive|agreement and plan of merger|in (advanced )?talks|nears? (a )?deal|explor(es|ing) (a )?(sale|acquisition))\b/i;
  const lead = ss.find((s) => DEAL_RX.test(s) && EVENT_VERB.test(s) && factual(s) && !/forward-looking/i.test(s));
  if (!lead) return null;
  const f = blank(source, 'acquisition');
  const disposition = /\b(sale of (its|the|our)|divest\w*|to sell|agreed to sell|completed (the |its )?(sale|divestiture))\b/i.test(lead) && !/\bto be acquired by\b/i.test(lead);
  // The company is the TARGET when the text says it survives as the buyer's
  // subsidiary, goes private, or is "to be acquired" (PRTH).
  const flat = WS(text);
  const isTarget = /\b(be acquired by|to be acquired|merge with and into the Company|Company surviving the Merger|surviving (the merger )?as a (direct |indirect )?wholly[- ]owned subsidiary of|cease to be a publicly traded|take (the )?Company private|to take [A-Z][\w&.-]* private|take-private|go(ing)?[- ]private)\b/i.test(flat);
  f.event.stage = stageOf(lead);
  const by = new RegExp(String.raw`(?:acquired by|be acquired by|merge with|merger with|with)\s+(?:an affiliate of |affiliates of |funds (?:managed|advised) by |a subsidiary of )?${NAME}`).exec(lead);
  const of = new RegExp(String.raw`(?:to acquire|will acquire|has acquired|acquisition of|acquire|sale of|sell)\s+(?:all (?:of )?the outstanding (?:shares|equity interests) of |a (?:\d+(?:\.\d+)?% )?(?:stake|interest) in |substantially all (?:of )?the assets of )?${NAME}`).exec(lead);
  const acquiredBy = isTarget || /\b(be acquired by|to be acquired|acquired by)\b/i.test(lead);
  const leader = nameAfter(lead, /\binvestor group led by (?:(?:its|the company['’]s) )?(?:(?:executive )?chairman(?: and (?:ceo|chief executive officer))?,? )?(?:founder,? )?/i);
  f.event.counterparty = leader ? `Investor group led by ${leader}` : cleanName(acquiredBy ? by?.[1] : (of?.[1] || by?.[1]));
  if (f.event.counterparty && issuerName && f.event.counterparty.toLowerCase().startsWith(issuerName.toLowerCase().split(/[ ,]/)[0])) f.event.counterparty = cleanName(by?.[1]) || null;
  if (acquiredBy) addTerm(f, 'Role', 'The company is the TARGET (being acquired)');
  // A buyer controlled by the company's own chairman / CEO is a related-party
  // (management) buyout — stated, not inferred.
  const rp = /\b(?:controlled by|led by|affiliates? of)\s+((?:[A-Z][A-Za-z.'’-]*\s?){1,4}),?\s+(?:the Company['’]s|its|our)\s+((?:Chairman|Chief Executive Officer|CEO|founder|President|Executive Chairman)[^,.;()]{0,50})/.exec(flat);
  if (rp) addTerm(f, 'Buyer (related party)', `${WS(rp[1])}, the company's ${WS(rp[2])}`);
  if (disposition) addTerm(f, 'Role', 'The company is the SELLER (disposition)');
  addQuote(f, lead, text);
  const stakePct = /(\d+(?:\.\d+)?)%\s+(?:stake|interest|equity interest|of the outstanding)/i.exec(lead);
  if (stakePct) f.economics.stakePct = NUM(stakePct[1]);
  for (const s of ss) {
    const hedged = HEDGED.test(s);
    if (f.economics.considerationNative == null && !hedged && !/termination fee|break(up)? fee|reverse termination/i.test(s)) {
      const m = CONSIDERATION.exec(s) || null;
      const b = m ? null : CONSIDERATION_BEFORE.exec(s);
      const v = m ? moneyToM(m[2], m[3]) : b ? moneyToM(b[1], b[2]) : null;
      if (v != null) { f.economics.considerationNative = v; f.economics.valueNative = v; addQuote(f, s, text); }
    }
    if (f.stated.perShare == null && /\b(merger|acquir\w*|acquisition|transaction|tender offer|holders|stockholders|shareholders|consideration)\b/i.test(s)) {
      const p = PER_SHARE.exec(s);
      const px = p ? (p[1] ?? p[2]) : null;
      if (p && px) { f.stated.perShare = NUM(px) ?? undefined; addTerm(f, 'Per-share consideration', `$${px} per share${/in cash/i.test(s.slice(p.index, p.index + 60)) ? ' in cash' : ''}`); addQuote(f, s, text); }
    }
    {
      const p = PREMIUM.exec(s);
      const pct = p ? (p[1] ?? p[2]) : null;
      const prem = f.terms.find((t) => t.label === 'Premium (as stated)');
      if (pct && /\b(clos|price|unaffected|average)\w*/i.test(s) && !(prem && prem.value.includes(`${pct}%`)) && (!prem || !prem.value.includes(' · '))) {
        if (f.stated.premiumPct == null) f.stated.premiumPct = NUM(pct) ?? undefined;
        const ref = /(unaffected|before public disclosure|prior to the announcement|last trading day[^,;.]{0,60}|volume[- ]weighted[^,;.]{0,40}|closing (share )?price on [A-Z][a-z]+ \d{1,2}, \d{4})/i.exec(s)?.[0] || 'as stated';
        const v = `${pct}% (${WS(ref).slice(0, 70)})`;
        if (prem) prem.value = `${prem.value} · ${v}`; else addTerm(f, 'Premium (as stated)', v);
        addQuote(f, s, text);
      }
    }
    if (!hedged && PERIOD.test(s)) {
      if (f.economics.targetRevenueNative == null) {
        const r = TARGET_REV.exec(s);
        if (r) { const v = r[3] ? moneyToM(r[3], r[4]) : moneyToM(r[6], r[7]); if (v != null) { f.economics.targetRevenueNative = v; addTerm(f, 'Target revenue (as stated)', `${fmtUsdM(v)} — ${WS(s).slice(0, 160)}`); addQuote(f, s, text); } }
      }
      if (f.economics.targetProfitNative == null) {
        const r = TARGET_EBITDA.exec(s);
        if (r) { const v = moneyToM(r[1], r[2]); if (v != null) { f.economics.targetProfitNative = v; addTerm(f, 'Target EBITDA (as stated)', `${fmtUsdM(v)} — ${WS(s).slice(0, 160)}`); addQuote(f, s, text); } }
      }
    }
    if (FINANCING.test(s) && !/\(as defined|to cause the financing/i.test(s) && /\b(merger|acquisition|transaction|purchase|deal|parent|buyer|consideration)\b/i.test(s)) {
      // The sentence that says HOW it is funded beats one that merely names "the Financing".
      const strong = /\b(expects to fund|is being financed|financed(,)? (in part,? )?by|funded (by|through|with)|through a combination of|equity commitments?|debt commitment)\b/i.test(s);
      const cur = f.terms.find((t) => t.label === 'Financing');
      if (!cur || (strong && !/\b(expects to fund|is being financed|financed(,)? (in part,? )?by|funded (by|through|with)|through a combination of|equity commitments?|debt commitment)\b/i.test(cur.value))) {
        if (cur) cur.value = WS(s).slice(0, 240); else addTerm(f, 'Financing', s);
        addQuote(f, s, text);
      }
    }
    if (/not subject to (a |any )?financing condition/i.test(s)) { addTerm(f, 'Financing condition', 'None (as stated)'); addQuote(f, s, text); }
    if (!f.time.expectedCompletion) {
      const c = CLOSE.exec(s);
      if (c) { f.time.expectedCompletion = WS(c[1]).replace(/\s+(subject|and|following)$/i, ''); addQuote(f, s, text); }
    }
    const cond = CONDITIONS.exec(s);
    if (cond && /\b(approval|clearance|condition|vote|hsr|regulatory)\b/i.test(cond[1]) && f.time.milestones.length < 4) {
      for (const part of cond[1].split(/,\s*|\s+and\s+|;\s*/)) {
        const m = WS(part).replace(/^(including |the |customary closing conditions,? including )/i, '');
        if (/approval|clearance|vote|hsr|waiting period/i.test(m) && !f.time.milestones.includes(m) && f.time.milestones.length < 4) f.time.milestones.push(m.slice(0, 100));
      }
      addQuote(f, s, text);
    }
  }
  if (disposition) f.event.product = 'disposition';
  return f;
}

const ORDER_RX = /\b(awarded|awards|received|receives|won|wins|secured|secures|signed|signs|booked|lands|landed|bags|bagged)\b[^.]{0,80}\b(contract|order|purchase order|task order|award|agreement)\b|\b(contract|order|award) (valued at|worth|with a value of|of)\b/i;
const PARTNER_RX = /\b(strategic (partnership|collaboration|alliance|agreement)|partnership|collaboration|alliance|joint venture|joint development agreement|supply agreement|master (services|supply|purchase) agreement|power (purchase|supply) agreement|license agreement|licensing agreement|distribution agreement|memorandum of understanding|letter of intent|definitive agreement|commercial agreement|services agreement|multi-year agreement|agreement)\b[^.]{0,40}?\bwith\s+(?=[A-Z])/i;
const NAME_AT = new RegExp(String.raw`^(?:the\s+)?${NAME}`);
/** The proper-noun phrase right after a keyword match (case-SENSITIVE, so a
 *  case-insensitive keyword regex cannot drag lowercase words into a name). */
function nameAfter(s: string, rx: RegExp): string | null {
  const m = rx.exec(s);
  if (!m) return null;
  return cleanName(NAME_AT.exec(s.slice(m.index + m[0].length))?.[1]);
}
const LAUNCH_RX = /\b(launch(ed|es)?|introduc(ed|es)|unveil(ed|s)|began shipping|commercial availability|general availability)\b/i;
const CAPACITY_RX = /\b(\d[\d,]*(?:\.\d+)?)\s*(MW|megawatts?|GW|gigawatts?|MWh|GWh|square feet|sq\.? ?ft|tons? per (year|annum|day)|units? per (year|month))\b/i;
const PERIOD_RX = /\b(over|for|during) (?:a |an |the )?(?:(?:initial )?(?:period|term) of )?((?:\w+|\d+)[- ](?:year|month)s?)\b|\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[- ](year|month)\b(?! anniversary)/i;

function extractCommercial(text: string, source: SourceRef): UsStructuredFacts | null {
  const ss = filingSentences(text).filter((s) => !/forward-looking|safe harbor/i.test(s) && factual(s));
  const orderS = ss.find((s) => ORDER_RX.test(s) && !/credit agreement|loan agreement|merger agreement|plan of merger|purchase agreement for (shares|securities)|securities purchase/i.test(s));
  const partS = orderS ? null : ss.find((s) => PARTNER_RX.test(s) && !/credit agreement|loan agreement|merger|indenture|securities purchase|underwriting|registration rights|employment agreement|separation agreement|indemnification|sales agreement|at[- ]the[- ]market|equity distribution|placement agen|subscription agreement|waiver/i.test(s));
  const launchS = orderS || partS ? null : ss.find((s) => LAUNCH_RX.test(s) && /\b(announce[sd]?|today)\b/i.test(s));
  const lead = orderS || partS || launchS;
  if (!lead) return null;
  const kind: EventKind = orderS ? 'order' : partS ? (CAPACITY_RX.test(partS) && /\b(power|data cent(er|re)|campus|plant|facility|site)\b/i.test(partS) ? 'capacity' : 'partnership') : 'new_product';
  const f = blank(source, kind);
  f.event.stage = stageOf(lead);
  f.event.counterparty = orderS ? cleanName(new RegExp(String.raw`\b(?:by|from|with)\s+(?:the\s+)?${NAME}`).exec(lead)?.[1]) : partS ? nameAfter(lead, PARTNER_RX) : null;
  addQuote(f, lead, text);
  if (!HEDGED.test(lead)) {
    const v = firstMoneyM(lead);
    if (v != null && /\b(contract|order|award|agreement|valued|worth)\b/i.test(lead)) { f.economics.valueNative = v; }
  } else {
    const v = firstMoneyM(lead);
    if (v != null) addTerm(f, 'Hedged figure (not a value)', WS(lead).slice(0, 200));
  }
  const cap = CAPACITY_RX.exec(lead) || ss.map((s) => CAPACITY_RX.exec(s)).find(Boolean) || null;
  if (cap && (kind === 'capacity' || kind === 'partnership')) {
    const hedgedCap = /\bup to\b/i.test(lead.slice(Math.max(0, (cap.index ?? 0) - 12), (cap.index ?? 0)));
    f.economics.capacityAfter = `${hedgedCap ? 'up to ' : ''}${cap[1]} ${cap[2]}`;
  }
  const per = PERIOD_RX.exec(lead) || ss.map((s) => (/\b(term|deliver|period|over)\b/i.test(s) ? PERIOD_RX.exec(s) : null)).find(Boolean) || null;
  if (per) f.time.executionPeriod = WS(per[0]).replace(/^(over|for|during) (a |an |the )?((initial )?(period|term) of )?/i, '');
  const prod = /\b(?:to (?:supply|provide|deliver|develop|build|power|deploy))\s+([^.,;]{4,80})/i.exec(lead);
  if (prod) f.event.product = WS(prod[1]);
  const geo = /\b(?:in|located in)\s+((?:[A-Z][a-z]+\s?){1,3}(?:County|State|Texas|California|Nevada|Ohio|Arizona|Europe|Asia|India|Japan|Canada|Germany|United Kingdom|United States))\b/.exec(lead);
  if (geo) f.event.geography = WS(geo[1]);
  // Terms beside the lead (value / duration sentences that follow it).
  for (const s of ss) {
    if (s === lead) continue;
    if (f.economics.valueNative == null && !HEDGED.test(s) && /\b(contract|order|award|agreement)\b[^.]{0,40}\b(valued at|worth|value of|total(s|ing)?)\b/i.test(s)) {
      const v = firstMoneyM(s); if (v != null) { f.economics.valueNative = v; addQuote(f, s, text); }
    }
    if (HEDGED.test(s) && /\$\s?\d/.test(s) && /\b(revenue|value|contract|agreement)\b/i.test(s) && !f.terms.some((t) => t.label.startsWith('Hedged'))) addTerm(f, 'Hedged figure (not a value)', s.slice(0, 200));
  }
  return f;
}

const REG_NEG_RX = /\b(halt(ed|s)?|paus(e|ed|es|ing)|suspend(ed|s)?|moratorium|revok(ed|es)|denied|rejected|withdrew|withdrawn)\b[^.]{0,100}\b(permits?|approvals?|licen[cs]es?|applications?|clearances?)\b|\b(complete response letter|warning letter|clinical hold|import alert|delist(ed|ing) notice)\b/i;
function extractRegulatoryNegative(text: string, source: SourceRef): UsStructuredFacts | null {
  const s = filingSentences(text).find((x) => REG_NEG_RX.test(x) && !favourableLegalOutcome(x) && factual(x) && /\b(on [A-Z][a-z]+ \d{1,2}, \d{4}|announced|directed|issued|received|today)\b/i.test(x));
  if (!s) return null;
  const f = blank(source, 'regulatory_negative');
  f.event.stage = 'ANNOUNCED';
  const who = /\b(Governor [A-Z][a-z]+ [A-Z][a-z]+|the (?:FDA|SEC|FAA|FCC|EPA|NRC|DOE|FTC|DOJ)|[A-Z][A-Za-z]+ (?:Commission|Department|Agency|Board) [^,.;]{0,40})/.exec(s);
  f.event.counterparty = who ? WS(who[1]) : null;
  addQuote(f, s, text);
  addTerm(f, 'Plain English', 'A stated regulatory / permitting setback — its size and duration are what matter.');
  return f;
}

const DEBT_RX = /\b(credit agreement|credit facility|term loan|revolving (credit )?(facility|loan)|delayed[- ]draw|senior (secured )?notes|convertible (senior )?notes|notes due \d{4}|indenture|loan agreement|loan and security agreement|note purchase agreement|aggregate principal amount|equipment financ\w+|redemption of (?:its |the )?[^.]{0,40}notes|redeem(?:ed|s)?\b[^.]{0,60}\bnotes)\b/i;
function extractDebt(text: string, source: SourceRef): UsStructuredFacts | null {
  const ss = filingSentences(text);
  const lead = ss.find((s) => DEBT_RX.test(s) && /\b(entered into|issued|closed|borrow|provid|priced|sold|amend|redeem|repa|prepa|refinanc|repurchas)\w*/i.test(s)) || ss.find((s) => DEBT_RX.test(s));
  if (!lead) return null;
  const f = blank(source, 'debt');
  f.event.stage = stageOf(lead);
  const lender = new RegExp(String.raw`\bwith\s+(?:the lenders? (?:party thereto|from time to time party thereto)(?:,| and)\s+)?${NAME}(?:,? as (?:administrative )?agent|, as lender)`).exec(lead) || new RegExp(String.raw`\b(?:lenders?|provided by|from)\s+${NAME}`).exec(lead);
  f.event.counterparty = cleanName(lender?.[1]);
  addQuote(f, lead, text);
  const action = debtActionOf(lead);
  if (action) addTerm(f, 'Action', action);
  for (const s of [lead, ...ss.filter((x) => x !== lead && (DEBT_RX.test(x) || /\b(bear\w*|interest|matur\w*|due \d{4}|SOFR)\b/i.test(x)))].slice(0, 12)) {
    if (f.economics.valueNative == null && f.stated.facilityUpToM == null) {
      const pa = /(?:aggregate principal amount|(?:facility|facilities|notes|term loan|loan|commitments?)(?: in an aggregate (?:principal )?amount)?) of (up to )?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million)?/i.exec(s)
        || /(up to )?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million)\s+(?:in\s+)?aggregate principal amount/i.exec(s)
        || /(up to )?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million)\s+(?:(?:senior|secured|unsecured|convertible|first[- ]lien|second[- ]lien|term|revolving|delayed[- ]draw)\s+){0,3}(notes|term loan|loan|credit facility|facility|revolv)/i.exec(s);
      if (pa) {
        const v = moneyToM(pa[2], pa[3]);
        if (v != null) {
          if (pa[1] || /\bup to\b/i.test(s.slice(Math.max(0, pa.index - 8), pa.index + 8))) { f.stated.facilityUpToM = v; addTerm(f, 'Facility size (up to — commitment, not drawn)', fmtUsdM(v)); }
          else f.economics.valueNative = v;
          addQuote(f, s, text);
        }
      }
    }
    if (f.stated.ratePct == null) {
      const fixed = /bear(?:s|ing)? interest at (?:a|an annual) (?:fixed )?rate (?:of |equal to )?(\d+(?:\.\d+)?)\s?%/i.exec(s) || /\b(\d+(?:\.\d+)?)\s?% (?:senior |convertible |secured )*notes\b/i.exec(s);
      const floating = /\b((?:term )?SOFR|base rate|prime rate|LIBOR)\b[^.]{0,20}?\bplus\b (?:an applicable margin of |a margin of )?(\d+(?:\.\d+)?)\s?%/i.exec(s);
      if (fixed) { f.stated.ratePct = NUM(fixed[1]) ?? undefined; addTerm(f, 'Interest rate', `${fixed[1]}% (fixed, as stated)`); addQuote(f, s, text); }
      else if (floating) { addTerm(f, 'Interest rate', `${floating[1]} + ${floating[2]}% (floating, as stated)`); addQuote(f, s, text); }
    }
    if (!f.terms.some((t) => t.label === 'Maturity')) {
      const m = /\bmatur(?:es|e|ity date(?: of| is)?)(?: on)? ((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}|\d{4})/i.exec(s) || /\bnotes due (\d{4})\b/i.exec(s);
      if (m) { addTerm(f, 'Maturity', m[1]); f.time.milestones.push(`Maturity ${m[1]}`); addQuote(f, s, text); }
    }
  }
  return f;
}

const EQUITY_SALE_RX = /\b(private placement|securities purchase agreement|subscription agreement|registered direct|underwritten (public )?offering|public offering|at[- ]the[- ]market|unregistered|issued|sold|issue and sell|agreed to sell)\b[^.]{0,120}\b(shares|common stock|warrants|pre-funded|units|preferred stock)\b/i;
const ATM_RX = /\b(at[- ]the[- ]market|ATM (program|offering|facility)|(issuance )?sales agreement|equity distribution agreement|open market sale agreement)\b/i;

/** An at-the-market program: stock MAY be sold over time at market prices —
 *  a supply facility, not money raised. Size is an "up to" term. */
function extractAtm(text: string, source: SourceRef): UsStructuredFacts | null {
  const ss = filingSentences(text);
  const lead = ss.find((s) => ATM_RX.test(s) && /\b(entered into|established|commenced|filed)\b/i.test(s)) || ss.find((s) => ATM_RX.test(s) && /aggregate offering price/i.test(s));
  if (!lead) return null;
  const f = blank(source, 'fundraising');
  f.event.stage = stageOf(lead);
  f.event.product = 'At-the-market (ATM) equity program';
  addQuote(f, lead, text);
  const agents = new RegExp(String.raw`\bwith\s+${NAME}`).exec(lead);
  if (agents) f.event.counterparty = cleanName(agents[1]);
  for (const s of ss) {
    const size = /aggregate offering price of (up to )?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million)?/i.exec(s);
    if (size && f.stated.facilityUpToM == null) { const v = moneyToM(size[2], size[3]); if (v != null) { f.stated.facilityUpToM = v; addTerm(f, 'Program size (up to — shares may be sold over time; none required)', fmtUsdM(v)); addQuote(f, s, text); } }
    const comm = /commission (?:of )?(?:up to )?(\d+(?:\.\d+)?)\s?%/i.exec(s);
    if (comm && !f.terms.some((t) => t.label === 'Agent commission')) { addTerm(f, 'Agent commission', `up to ${comm[1]}% of gross proceeds`); addQuote(f, s, text); }
    if (/use (of )?the net proceeds|intends to use the net proceeds/i.test(s) && !f.terms.some((t) => t.label === 'Use of proceeds')) { addTerm(f, 'Use of proceeds', s); addQuote(f, s, text); }
    if (/not obligated to sell/i.test(s) && !f.terms.some((t) => t.label === 'Obligation')) addTerm(f, 'Obligation', 'The company is not obligated to sell any shares (as stated)');
  }
  addTerm(f, 'Plain English', 'Equity supply facility: shares may be sold into the market over time; nothing has been raised by the filing itself.');
  return f;
}

function extractDilution(text: string, source: SourceRef): UsStructuredFacts | null {
  const atm = extractAtm(text, source);
  if (atm) return atm;
  const ss = filingSentences(text).filter(factual);
  const lead = ss.find((s) => EQUITY_SALE_RX.test(s) && !/selling (stock|share)holders?|resale|issued a press release|press release/i.test(s));
  if (!lead) return null;
  const f = blank(source, 'fundraising');
  f.event.stage = stageOf(lead);
  addQuote(f, lead, text);
  for (const s of [lead, ...ss.filter((x) => x !== lead && /\b(shares|per share|proceeds|purchasers?|investors?)\b/i.test(x))].slice(0, 10)) {
    if (f.economics.sharesIssued == null) {
      const m = /(?:an aggregate of |a total of |aggregate of )?([\d,]{4,}|\d+(?:\.\d+)?\s+million)\s+(?:shares|units)\s+of\s+(?:(?:the Company['’]s|its|our)\s+)?(?:Class [AB] )?(?:common stock|preferred stock|stock)/i.exec(s);
      if (m) { const mm = /([\d,.]+)\s*(million)?/i.exec(m[1])!; f.economics.sharesIssued = shareCount(mm[1], mm[2]); addQuote(f, s, text); }
    }
    if (f.economics.issuePrice == null) {
      const p = /(?:(?:purchase|offering|issue|sale|public offering) price of|at a price of|at|for)\s+\$\s?(\d+(?:\.\d+)?)\s+per (?:share|unit)/i.exec(s);
      if (p) { f.economics.issuePrice = NUM(p[1]); addQuote(f, s, text); }
    }
    if (f.economics.valueNative == null && !HEDGED.test(s)) {
      const g = /gross proceeds (?:to the Company )?(?:of|were|are|totaling) (?:approximately |about )?(?:US)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million)?/i.exec(s);
      if (g) { const v = moneyToM(g[1], g[2]); if (v != null) { f.economics.valueNative = v; addQuote(f, s, text); } }
    }
    if (!f.economics.allottees.length) {
      const b = new RegExp(String.raw`\b(?:to|with|led by|from)\s+(?:certain\s+)?(accredited investors|institutional investors|existing (?:stockholders|investors)|${NAME.slice(1, -1)})`).exec(s);
      const who = cleanName(b?.[1]);
      if (who && /\b(purchasers?|investors?|sold|issued|agreement|led by|subscri)\w*/i.test(s)) { f.economics.allottees.push(who); f.event.counterparty = who; }
    }
  }
  const out = outstandingOf(text);
  if (out) { f.stated.outstandingShares = out.n; addQuote(f, out.s, text); }
  const stated = /(?:represent(?:s|ing)?|approximately) (\d+(?:\.\d+)?)\s?% of (?:the |our )?(?:outstanding|issued and outstanding)/i.exec(WS(text));
  if (stated) f.economics.dilutionPct = NUM(stated[1]);
  return f;
}

const RESALE_RX = /\b(resale|re-sale|selling (stock|share)holders?|offered by the selling|offer and (re)?sell from time to time|may be offered and sold from time to time by)\b/i;
function extractResale(text: string, source: SourceRef): UsStructuredFacts | null {
  const ss = filingSentences(text);
  const lead = ss.find((s) => RESALE_RX.test(s) && /\bshares?\b/i.test(s)) || ss.find((s) => RESALE_RX.test(s));
  if (!lead) return null;
  const f = blank(source, 'resale_registration');
  f.event.stage = 'ANNOUNCED';
  addQuote(f, lead, text);
  const m = /(?:up to |an aggregate of |a total of )?([\d,]{4,}|\d+(?:\.\d+)?\s+million)\s+shares/i.exec(lead);
  if (m) { const mm = /([\d,.]+)\s*(million)?/i.exec(m[1])!; f.stated.sharesRegistered = shareCount(mm[1], mm[2]) ?? undefined; if (f.stated.sharesRegistered) addTerm(f, 'Shares registered for resale', f.stated.sharesRegistered.toLocaleString('en-US')); }
  const noProceeds = ss.find((s) => /will not receive any (of the )?proceeds/i.test(s));
  if (noProceeds) { addTerm(f, 'Proceeds to the company', 'None from the resale (as stated)'); addQuote(f, noProceeds, text); }
  const out = outstandingOf(text);
  if (out) { f.stated.outstandingShares = out.n; addQuote(f, out.s, text); }
  addTerm(f, 'Plain English', RESALE_PLAIN);
  return f;
}
export const RESALE_PLAIN = 'Resale overhang — shares may be sold; this does not by itself mean the price must fall.';

/** Beneficial-ownership report (13D / 13G), old HTML or the 2024+ XML
 *  rendering, or a press line ("Amazon disclosed a 5.3% stake"). */
export function extractBeneficialOwnership(text: string): { holder: string | null; pct: number | null; shares: number | null; quote: string | null } {
  const t = WS(text);
  const holderM = /names? of reporting persons?\s*(?:\(?entities only\)?)?\s*[:.]?\s*(?:I\.?R\.?S\.? identification nos?\.? of above persons? \(entities only\)\s*)?(.{2,90}?)\s+(?:\d{1,2}\s*[.)]?\s*)?(?:check the appropriate|i\.?r\.?s\.? identification|sec use only|citizenship|\(a\)\s*\[?)/i.exec(t);
  const pctM = /percent of class represented by amount in row\s*\(?\s*(?:9|11)\s*\)?\s*[:.]?\s*(\d+(?:\.\d+)?)\s*%/i.exec(t)
    || /(\d+(?:\.\d+)?)\s*%\s+of the (?:outstanding |issued and outstanding )?(?:shares|common stock|class)/i.exec(t);
  const sharesM = /aggregate amount beneficially owned by each reporting person\s*[:.]?\s*([\d,]+(?:\.\d+)?)/i.exec(t);
  if (holderM || pctM) {
    return { holder: cleanName(holderM?.[1]?.replace(/\s+\d+$/, '')), pct: pctM ? NUM(pctM[1]) : null, shares: sharesM ? shareCount(sharesM[1].replace(/\.\d+$/, '')) : null, quote: pctM ? pctM[0] : holderM?.[0] || null };
  }
  const press = new RegExp(String.raw`${NAME}\s+(?:has |had )?(?:discloses|disclosed|reports|reported|reveals|revealed|holds?|took|takes|acquires|acquired|builds|built|owns)\s+(?:a |an )?(?:passive )?(?:stake of )?(\d+(?:\.\d+)?)\s?%\s*(?:stake|interest|ownership|of)`).exec(t);
  if (press) return { holder: cleanName(press[1]), pct: NUM(press[2]), shares: null, quote: press[0] };
  return { holder: null, pct: null, shares: null, quote: null };
}

function extractStake(text: string, source: SourceRef): UsStructuredFacts | null {
  const bo = extractBeneficialOwnership(text);
  if (!bo.holder && bo.pct == null) return null;
  const strategic = isStrategicHolder(bo.holder, source.kind !== 'SEC_FILING');
  const f = blank(source, strategic ? 'stake_by_strategic' : 'other');
  f.event.counterparty = bo.holder;
  f.event.stage = 'ANNOUNCED';
  f.economics.stakePct = bo.pct;
  if (bo.shares) addTerm(f, 'Shares beneficially owned (as reported)', bo.shares.toLocaleString('en-US'));
  if (!strategic) addTerm(f, 'Holder type', bo.holder ? 'Financial investor or individual — not an operating-company (strategic) stake' : 'Holder not named in the text read');
  else addTerm(f, 'Holder type', 'Operating company — strategic holder');
  if (bo.quote) {
    // The ownership table has no sentences; keep the matched span verbatim.
    const q = WS(bo.quote);
    if (verifyQuote(q, text)) f.quotes.push(q);
  }
  return f;
}

const GOV_IN = new RegExp(String.raw`\b(?:appointed|named|elected|hired)\s+${NAME}\s+(?:as|to serve as|to the (?:position|role) of)\s+(?:the Company['’]s |its |our )?((?:Chief [A-Z][a-z]+(?: [A-Z][a-z]+)? Officer|President|Chairman|Chair|Chief Executive Officer|CEO|CFO|COO|General Counsel|Treasurer|Controller|(?:independent |non-executive )?[Dd]irector|member of the Board)[^.,;]{0,40})`);
const GOV_OUT = new RegExp(String.raw`${NAME}\s+(?:notified [^.]{0,60}? of (?:his|her|their) (?:decision|intention) to (?:resign|retire|step down)|resigned|will (?:resign|retire|step down)|has (?:resigned|retired|stepped down)|stepped down|was terminated)\s+(?:as|from)\s+(?:the Company['’]s |its |our )?([^.,;]{3,70})`);
function extractGovernance(text: string, source: SourceRef): UsStructuredFacts | null {
  const ss = filingSentences(text);
  for (const s of ss) {
    const i = GOV_IN.exec(s), o = i ? null : GOV_OUT.exec(s);
    const m = i || o;
    if (!m) continue;
    const f = blank(source, 'governance');
    f.event.counterparty = cleanName(m[1]);
    f.event.product = WS(`${i ? 'Appointed' : 'Leaving'}: ${m[2]}`).slice(0, 90);
    f.event.stage = 'ANNOUNCED';
    addQuote(f, s, text);
    addTerm(f, 'Plain English', 'Governance change — context, not a catalyst by itself.');
    return f;
  }
  return null;
}

const REVENUE_RX = /\b(total |net )?(revenues?|net sales|sales)\b[^.]{0,60}?\b(of|was|were|totaled|totalled|reached|increased|grew|rose|decreased|declined|fell)\b[^.]{0,40}?\$\s?[\d][\d,]*(?:\.\d+)?\s*(billion|million)/i;
const OUTLOOK_RX = /\b(rais(es|ed|ing)|increas(es|ed|ing)|lift(s|ed)?|lower(s|ed|ing)|reduc(es|ed|ing)|cut(s)?|reaffirm(s|ed|ing)?|initiat(es|ed|ing)|introduc(es|ed|ing))\b[^.]{0,40}\b(full[- ]year|fiscal(?: year)? ?\d{0,4}|annual|\d{4})?\s*(guidance|outlook)\b/i;
function extractResults(text: string, source: SourceRef): UsStructuredFacts | null {
  const ss = filingSentences(text);
  const rev = ss.find((s) => REVENUE_RX.test(s) && !HEDGED.test(s));
  const out = ss.find((s) => OUTLOOK_RX.test(s));
  if (!rev && !out) return null;
  const f = blank(source, 'results');
  f.event.stage = 'ANNOUNCED';
  if (rev) { const m = /\$\s?([\d][\d,]*(?:\.\d+)?)\s*(billion|million)/i.exec(rev); addTerm(f, 'Revenue (as stated)', `${m ? fmtUsdM(moneyToM(m[1], m[2])) : ''} — ${rev.slice(0, 180)}`); addQuote(f, rev, text); }
  if (out) {
    const dir = /\b(rais|increas|lift)/i.test(out) ? 'raised' : /\b(lower|reduc|cut)/i.test(out) ? 'lowered' : /\breaffirm/i.test(out) ? 'reaffirmed' : 'issued';
    addTerm(f, 'Outlook (as stated)', `${dir} — ${out.slice(0, 180)}`); addQuote(f, out, text);
  }
  return f;
}

// ── the entry point ────────────────────────────────────────────────────────

export interface UsExtractInput {
  text: string;
  source: SourceRef;
  form?: string | null;
  items?: string[];
  issuerName?: string | null;
}

const CATALYST_ORDER: EventKind[] = ['acquisition', 'stake_by_strategic', 'order', 'capacity', 'partnership', 'new_product', 'qualification', 'fundraising', 'resale_registration', 'regulatory_negative', 'results', 'debt', 'other', 'governance'];

/**
 * Facts stated in ONE document. The SEC item routes which extractors run
 * first; an extractor only emits a fact when the text states it. When an
 * opened 8-K states nothing recognisable, one 'other' fact says so (with the
 * lead sentence) — "opened, nothing stated" is not "not opened".
 */
export function extractUsFacts(inp: UsExtractInput): UsStructuredFacts[] {
  const text = String(inp.text || '');
  if (WS(text).length < (inp.source.kind === 'SEC_FILING' ? 60 : 20)) return [];
  const form = String(inp.form || '').toUpperCase() || (inp.source.kind === 'SEC_FILING' ? usFormOf(inp.source.title) : '');
  const items = inp.items ?? inp.source.secItems ?? [];
  const isPress = inp.source.kind !== 'SEC_FILING';
  const route = isPress ? null : routeSecFiling(form, items);
  const focus = new Set<ExtractFocus>(route ? route.focus : ['general', 'deal', 'stake', 'dilution', 'debt', 'results', 'governance', 'resale']);
  const out: UsStructuredFacts[] = [];
  const push = (f: UsStructuredFacts | null) => { if (f && f.quotes.length) out.push(finalise(f)); };

  if (focus.has('stake')) push(extractStake(text, inp.source));
  if (focus.has('resale') || focus.has('offering')) {
    const resale = extractResale(text, inp.source);
    if (resale) push(resale); else push(extractDilution(text, inp.source));
  }
  if (focus.has('deal') || focus.has('general')) {
    const deal = extractDeal(text, inp.source, inp.issuerName ?? null);
    if (deal) {
      if (deal.event.product === 'disposition') { deal.event.product = null; addTerm(deal, 'Event', 'Disposition (sale), not an acquisition'); }
      push(deal);
    }
    else push(extractCommercial(text, inp.source));
  }
  if (focus.has('dilution') && !out.some((f) => f.event.kind === 'fundraising')) push(extractDilution(text, inp.source));
  if (focus.has('debt') && (items.includes('2.03') || items.includes('2.04') || !out.length)) push(extractDebt(text, inp.source));
  if (focus.has('results')) push(extractResults(text, inp.source));
  if (focus.has('general')) push(extractRegulatoryNegative(text, inp.source));
  if (focus.has('governance')) push(extractGovernance(text, inp.source));
  if (isPress && !out.length) { push(extractStake(text, inp.source)); }

  if (!out.length && route?.open && /^(8-K|6-K)/.test(form)) {
    const ss = filingSentences(text).filter(factual);
    const deck = ss.find((s) => /\b(presentation materials|investor presentation|investor conferences?|slide (deck|presentation))\b/i.test(s));
    const agreement = ss.find((s) => /\bentered into\b/i.test(s));
    const lead = deck || agreement || ss.find((s) => /\b(announce[sd]?|today|signed|completed|reported)\b/i.test(s));
    if (lead) {
      const f = blank(inp.source, 'other');
      addQuote(f, lead, text);
      if (deck && lead === deck) addTerm(f, 'Plain English', 'Investor presentation furnished under Regulation FD — the 8-K itself states no new event.');
      else if (lead === agreement) {
        const nm = /\bentered into (?:an? |the )?((?:[A-Z][\w-]*\s){0,5}(?:Agreement|Letter|Amendment|Waiver|Consent|Plan|Notes?|Warrants?))\b/.exec(lead);
        if (nm) f.event.product = WS(nm[1]);
        f.event.counterparty = nameAfter(lead, /\)?\s+with\s+(?=[A-Z])/);
        f.event.stage = stageOf(lead);
      }
      f.unknowns = [`The document was opened, but it does not state the event in words this reader recognises${items.length ? ` — Item ${items.filter((i) => i !== '9.01').join(', ')} is a routing hint, not the event` : ''}.`];
      if (f.quotes.length) { f.economics.ratios = []; out.push(f); }
    }
  }
  return out.sort((a, b) => CATALYST_ORDER.indexOf(a.event.kind) - CATALYST_ORDER.indexOf(b.event.kind));
}

// ── merging: same event in several documents ───────────────────────────────

const tokens = (s: string | null) => new Set(String(s || '').toLowerCase().replace(/\b(inc|corp|corporation|llc|ltd|co|the|company|holdings)\b\.?/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2));
function sameCounterparty(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const ta = tokens(a), tb = tokens(b);
  return Array.from(ta).some((w) => tb.has(w));
}
const COMPATIBLE: Record<string, string> = { order: 'commercial', partnership: 'commercial', capacity: 'commercial', new_product: 'commercial' };
const family = (k: EventKind) => COMPATIBLE[k] || k;

/** Same event? Same kind family + compatible counterparty (+ value agreement when both state one). */
export function sameEvent(a: StructuredFacts, b: StructuredFacts): boolean {
  if (family(a.event.kind) !== family(b.event.kind)) return false;
  if (a.event.kind === 'other' || a.event.kind === 'governance') return a.event.counterparty != null && a.event.counterparty === b.event.counterparty;
  const va = a.economics.valueNative ?? a.economics.considerationNative, vb = b.economics.valueNative ?? b.economics.considerationNative;
  if (va != null && vb != null && Math.abs(va - vb) / Math.max(va, vb) > 0.05) return false;
  if (a.economics.stakePct != null && b.economics.stakePct != null && Math.abs(a.economics.stakePct - b.economics.stakePct) > 0.3) return false;
  return sameCounterparty(a.event.counterparty, b.event.counterparty) && (!!a.event.counterparty || !!b.event.counterparty || va != null || a.event.kind === b.event.kind);
}

function fill<T>(a: T | null, b: T | null): T | null { return a ?? b ?? null; }

/** Merge b into a (a's source stays — it is the higher-ranked document). */
function mergeInto(a: UsStructuredFacts, b: UsStructuredFacts): UsStructuredFacts {
  const e = a.economics, x = b.economics;
  // "to be acquired by <sponsor>" (the release) names the buyer better than
  // the merger vehicle in the 8-K body ("Acme Parent, LLC").
  const VEHICLE = /\b(Parent|Merger Sub|Bidco|Buyer|Purchaser|Acquisition (Corp|Co|LLC|Inc))\b/;
  const bTarget = b.event.kind === 'acquisition' && !!b.event.counterparty && ((b.terms.some((t) => t.label === 'Role') && !a.terms.some((t) => t.label === 'Role')) || (VEHICLE.test(a.event.counterparty || '') && !VEHICLE.test(b.event.counterparty)));
  const m: UsStructuredFacts = {
    ...a,
    event: { kind: a.event.kind === 'other' ? b.event.kind : a.event.kind, counterparty: bTarget ? fill(b.event.counterparty, a.event.counterparty) : fill(a.event.counterparty, b.event.counterparty), product: fill(a.event.product, b.event.product), geography: fill(a.event.geography, b.event.geography), stage: fill(a.event.stage, b.event.stage) },
    economics: {
      ...e, valueNative: fill(e.valueNative, x.valueNative), sharesIssued: fill(e.sharesIssued, x.sharesIssued), issuePrice: fill(e.issuePrice, x.issuePrice),
      dilutionPct: fill(e.dilutionPct, x.dilutionPct), allottees: Array.from(new Set([...e.allottees, ...x.allottees])),
      considerationNative: fill(e.considerationNative, x.considerationNative), targetRevenueNative: fill(e.targetRevenueNative, x.targetRevenueNative),
      targetProfitNative: fill(e.targetProfitNative, x.targetProfitNative), stakePct: fill(e.stakePct, x.stakePct),
      capacityBefore: fill(e.capacityBefore, x.capacityBefore), capacityAfter: fill(e.capacityAfter, x.capacityAfter), capex: fill(e.capex, x.capex), ratios: [],
      currency: fill(e.currency, x.currency),
    },
    time: { executionPeriod: fill(a.time.executionPeriod, b.time.executionPeriod), expectedCompletion: fill(a.time.expectedCompletion, b.time.expectedCompletion), milestones: Array.from(new Set([...a.time.milestones, ...b.time.milestones])).slice(0, 6) },
    quotes: Array.from(new Set([...a.quotes, ...b.quotes])).slice(0, 8),
    terms: [...a.terms, ...b.terms.filter((t) => !a.terms.some((u) => u.label === t.label))],
    stated: { ...b.stated, ...Object.fromEntries(Object.entries(a.stated).filter(([, v]) => v != null)) },
    alsoFrom: [...(a.alsoFrom || []), b.source, ...(b.alsoFrom || [])],
    verificationRequired: a.verificationRequired && b.verificationRequired,
  };
  return finalise(m);
}

/** Facts from several documents of ONE filing (8-K body + EX-99.1): the same
 *  event is one fact. Highest-ranked source first. Within one accession, one
 *  kind is one event (the body says "Parent", the release names the buyer). */
export function mergeUsFacts(facts: UsStructuredFacts[]): UsStructuredFacts[] {
  const sorted = facts.map((f, i) => ({ f, i })).sort((a, b) => sourceRankOf(a.f.source) - sourceRankOf(b.f.source) || a.i - b.i).map((x) => x.f);
  const out: UsStructuredFacts[] = [];
  const sameFiling = (a: UsStructuredFacts, b: UsStructuredFacts) => !!a.source.accession && a.source.accession === b.source.accession && a.event.kind === b.event.kind && !['other', 'governance'].includes(a.event.kind);
  for (const f of sorted) {
    const j = out.findIndex((o) => sameFiling(o, f) || sameEvent(o, f));
    if (j >= 0) out[j] = mergeInto(out[j], f); else out.push(f);
  }
  return out.sort((a, b) => CATALYST_ORDER.indexOf(a.event.kind) - CATALYST_ORDER.indexOf(b.event.kind));
}

// ── official vs press ──────────────────────────────────────────────────────

export type EvidenceLabel = 'OFFICIAL — SEC filing' | 'OFFICIAL — company release' | 'PRESS — verification required' | 'PRESS — confirmed by filing';

export interface OfficialPressView {
  official: UsStructuredFacts[];
  /** Press facts no official document states yet (verificationRequired). */
  press: UsStructuredFacts[];
  /** Press items that the filing confirmed (same event) — kept as corroboration, never counted twice. */
  confirmed: Array<{ officialIndex: number; press: SourceRef }>;
  sources: SourceRef[];
  labelled: Array<{ label: EvidenceLabel; fact: UsStructuredFacts }>;
}

/** Press facts from headlines / snippets (SUMMARY_ONLY, PRESS). */
export function extractUsPressFacts(issuer: string, items: UsPressItem[], companyHosts: string[] = []): UsStructuredFacts[] {
  const out: UsStructuredFacts[] = [];
  for (const it of items) {
    const text = `${it.title}. ${it.summary || ''}`.trim();
    const ref = pressSourceRef(issuer, it, 'SUMMARY_ONLY', companyHosts);
    const fs = extractUsFacts({ text, source: ref });
    for (const f of fs) { f.verificationRequired = ref.kind === 'PRESS' || f.verificationRequired; out.push(f); }
  }
  return out;
}

/** Keep official and press evidence apart; a press fact the filing also
 *  states is CONFIRMED (and merged, so it is never double counted). */
export function separateOfficialAndPress(all: UsStructuredFacts[]): OfficialPressView {
  const official: UsStructuredFacts[] = [], pressIn: UsStructuredFacts[] = [];
  for (const f of all) (isOfficial(f.source) ? official : pressIn).push(f);
  const merged = mergeUsFacts(official);
  const confirmed: OfficialPressView['confirmed'] = [];
  const press: UsStructuredFacts[] = [];
  for (const p of pressIn) {
    const j = merged.findIndex((o) => sameEvent(o, p));
    if (j >= 0) {
      confirmed.push({ officialIndex: j, press: p.source });
      merged[j] = { ...merged[j], alsoFrom: [...(merged[j].alsoFrom || []), p.source] };
    } else press.push({ ...p, verificationRequired: true });
  }
  const pressMerged = mergeUsFacts(press).map((p) => ({ ...p, verificationRequired: true }));
  const labelled: OfficialPressView['labelled'] = [
    ...merged.map((fact) => ({ label: (fact.source.kind === 'SEC_FILING' ? 'OFFICIAL — SEC filing' : 'OFFICIAL — company release') as EvidenceLabel, fact })),
    ...pressMerged.map((fact) => ({ label: 'PRESS — verification required' as EvidenceLabel, fact })),
  ];
  const sources = dedupeSources([...all.map((f) => f.source), ...all.flatMap((f) => f.alsoFrom || [])]);
  return { official: merged, press: pressMerged, confirmed, sources: rankSources(sources), labelled };
}

// ── one plain line per fact ────────────────────────────────────────────────

export type UsFactState = 'Documented' | 'Potential' | 'Verification Required' | 'Context';

export function usFactState(f: StructuredFacts): UsFactState {
  if (f.verificationRequired || f.source.kind === 'PRESS' || f.source.access === 'SUMMARY_ONLY') return 'Verification Required';
  if (f.event.kind === 'stake_by_strategic' || f.event.stage === 'PROPOSED') return 'Potential';
  if (['governance', 'debt', 'results', 'resale_registration', 'other'].includes(f.event.kind)) return 'Context';
  return 'Documented';
}

/** A short plain-English line. Never BUY/SELL, never "must fall". */
export function describeUsFact(f: UsStructuredFacts | StructuredFacts): { state: UsFactState; label: EvidenceLabel; line: string; id: string } {
  const e = f.economics, k = f.event.kind, cp = f.event.counterparty;
  const terms = (f as UsStructuredFacts).terms || [];
  const term = (re: RegExp) => terms.find((t) => re.test(t.label))?.value || null;
  const label: EvidenceLabel = f.source.kind === 'PRESS' ? 'PRESS — verification required' : f.source.kind === 'SEC_FILING' ? 'OFFICIAL — SEC filing' : 'OFFICIAL — company release';
  let line: string;
  if (k === 'acquisition') {
    const role = term(/^Role$/) || '';
    const bits = [e.considerationNative != null ? `value ${fmtUsdM(e.considerationNative)}` : null, term(/per-share/i), e.targetRevenueNative != null ? `target revenue ${fmtUsdM(e.targetRevenueNative)}` : null, e.targetProfitNative != null ? `target EBITDA ${fmtUsdM(e.targetProfitNative)}` : null, f.time.expectedCompletion ? `expected to close ${f.time.expectedCompletion}` : null].filter(Boolean);
    line = `${/TARGET/.test(role) ? `To be acquired${cp ? ` by ${cp}` : ''}` : /SELLER/.test(role) ? `Sale / disposition${cp ? ` of ${cp}` : ''}` : `Acquisition${cp ? ` of ${cp}` : ''}`}${bits.length ? ` — ${bits.join(', ')}` : ''}.`;
  } else if (k === 'stake_by_strategic') {
    line = `${cp || 'A strategic holder'} disclosed a ${e.stakePct != null ? `${e.stakePct}% ` : ''}stake — a strategic holder; any commercial relationship is not stated.`;
  } else if (k === 'resale_registration') {
    line = RESALE_PLAIN;
  } else if (k === 'fundraising' && f.event.product === 'At-the-market (ATM) equity program') {
    const size = (f as UsStructuredFacts).stated?.facilityUpToM;
    line = `At-the-market equity program${size ? ` of up to ${fmtUsdM(size)}` : ''}${cp ? ` with ${cp}` : ''} — shares may be sold over time; a supply facility, not money raised.`;
  } else if (k === 'fundraising') {
    line = `Equity sale${e.sharesIssued ? ` of ${e.sharesIssued.toLocaleString('en-US')} shares` : ''}${e.issuePrice != null ? ` at $${e.issuePrice}` : ''}${e.allottees.length ? ` to ${e.allottees.join(', ')}` : ''}${e.dilutionPct != null ? ` (${e.dilutionPct}% of shares outstanding)` : ''}.`;
  } else if (k === 'debt') {
    const act = term(/^Action$/);
    if (act && act !== 'raised' && e.valueNative != null) line = `${fmtUsdM(e.valueNative)} of debt ${act}${term(/rate/i) ? ` (${term(/rate/i)})` : ''}${term(/maturity/i) ? `, due ${term(/maturity/i)}` : ''} — financing, not an operating event.`;
    else line = `Debt${cp ? ` with ${cp}` : ''}${e.valueNative != null ? ` — ${fmtUsdM(e.valueNative)}` : (f as UsStructuredFacts).stated?.facilityUpToM ? ` — facility up to ${fmtUsdM((f as UsStructuredFacts).stated.facilityUpToM)}` : ''}${term(/rate/i) ? `, ${term(/rate/i)}` : ''}${term(/maturity/i) ? `, matures ${term(/maturity/i)}` : ''} — financing, not an operating event.`;
  } else if (k === 'regulatory_negative') {
    line = `Regulatory setback${cp ? ` (${cp})` : ''}: ${f.quotes[0] ? f.quotes[0].slice(0, 160) : 'stated in the filing'}.`;
  } else if (k === 'governance') {
    line = `Governance: ${cp || 'officer / director'}${f.event.product ? ` — ${f.event.product}` : ''} (context, not a catalyst by itself).`;
  } else if (k === 'results') {
    line = `Results released${term(/revenue/i) ? ` — ${term(/revenue/i)!.split(' — ')[0]} revenue` : ''}${term(/outlook/i) ? `; outlook ${term(/outlook/i)!.split(' — ')[0]}` : ''}.`;
  } else if (k === 'other' && term(/plain english/i)) {
    line = term(/plain english/i)!;
  } else if (k === 'other' && f.event.product) {
    line = `Agreement signed: ${f.event.product}${cp ? ` with ${cp}` : ''} — no economics stated in words this reader recognises.`;
  } else if (k === 'other' && e.stakePct != null) {
    line = `${cp || 'A holder'} reported a ${e.stakePct}% holding — ${term(/holder type/i) || 'not a strategic stake'}.`;
  } else if (k === 'other') {
    line = f.unknowns[0] || 'Document opened; no event stated in recognisable words.';
  } else {
    line = `${k === 'order' ? 'Order / contract' : k === 'capacity' ? 'Capacity agreement' : k === 'new_product' ? 'Product launch' : 'Agreement'}${cp ? ` with ${cp}` : ''}${e.valueNative != null ? ` — ${fmtUsdM(e.valueNative)}` : ''}${e.capacityAfter ? ` — ${e.capacityAfter}` : ''}${f.time.executionPeriod ? ` over ${f.time.executionPeriod}` : ''}${f.event.stage === 'PROPOSED' ? ' (non-binding / proposed)' : ''}.`;
  }
  line = line.replace(/\.\.$/, '.');
  const state = usFactState(f);
  if (state === 'Verification Required') line = `${line} Verification required — no official filing states this yet.`;
  return { state, label, line, id: catalystIdOf(f.source.issuer, k, cp, f.event.product) };
}
