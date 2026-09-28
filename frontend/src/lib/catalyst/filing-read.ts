// ═══════════════════════════════════════════════════════════════════════════
// ONE FILING, READ — the line that matters and the figures it states. (zzz813)
//
// The "New · last 10 days" tab listed exchange subject lines. This reads the
// attachment text (fetched and cached per URL by /api/v1/catalyst/read-filings)
// and returns, WITHOUT a model:
//   · kind     — what the document shows happened (one of the tab's types)
//   · line     — one plain-English line: "Q1 FY27: Revenue ₹781.05 Cr (up 9%),
//                PAT ₹58.2 Cr", "Capacity 5,000 → 9,600+ MTPA (+92%),
//                commissioned", "Scheme: X's business demerged into Y; share
//                swap 1 for every 10", "Tax notice …— company says no material
//                impact"
//   · figures  — figures literally in that line (a capacity % change is the
//                only computed figure, from two stated capacities)
//   · routine  — paperwork / nothing material stated
//   · touches  — the thesis variables it moves (up / down / stated)
// Reuses the India event taxonomy (in-event-taxonomy, zzz801/803), the India
// fact extractor (india-extract, zzz785) and the US taxonomy (us-event-taxonomy).
// Pure: no fetch, no clock, no model.
// ═══════════════════════════════════════════════════════════════════════════

import { classifyIndiaEvents, inSentences, inFiguresIn, type InEventHit } from '../ai-gainers/in-event-taxonomy';
import { classifyUsEvents, eventSentences, figuresIn, BOILERPLATE, type UsEventHit } from '../ai-gainers/us-event-taxonomy';
import { extractIndiaFacts, type IndiaFacts } from '../ai-gainers/india-extract';
import { subjectClass, type RecentEventType } from './recent-events';
import type { FilingRead, Touch } from './filing-read-types';

export const FILING_READ_VERSION = 'r1';
export const MIN_TEXT = 200;

export type ReadCore = Omit<FilingRead, 'url' | 'status' | 'version' | 'readAt'>;

/** Letter wording in front of the fact ("We wish to inform that …", "With reference to …,") is cut. */
const LETTER_LEAD = /^(?:(?:with reference to|in continuation (?:of|to)|further to|pursuant to|in terms of)[^,]{0,160},\s*)?(?:we (?:wish|would like|hereby wish) to (?:inform|state|intimate|submit|clarify)(?: you)?(?: that)?,?\s*|this is to (?:inform|intimate)(?: you)?(?: that)?\s*|please be informed that\s*|we hereby inform(?: you)? that\s*)/i;
const clip = (s: string, n = 180): string => {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  const cut = t.replace(LETTER_LEAD, '');
  if (cut !== t && cut.length > 20) t = cut.charAt(0).toUpperCase() + cut.slice(1);
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s\S*$/, '')}…` : t;
};

// ── results ────────────────────────────────────────────────────────────────

const MONEY = String.raw`(?:(?:₹|Rs\.?|INR)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:crores?|cr\b\.?|lakhs?|lacs?|million|mn\b|billion|bn\b))?|(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:billion|million|thousand|bn\b|mn\b|[MB]\b))?|\d[\d,]*(?:\.\d+)?\s?(?:crores?|cr\b\.?))`;
const METRICS: Array<[string, RegExp]> = [
  ['Revenue', /\b(?:revenue from operations|total revenues?|net revenues?|consolidated revenues?|revenues?|total income|net sales|sales|turnover|income from operations|top[- ]?line)\b/i],
  ['EBITDA', /\bEBITDA\b(?!\s*margin)/i],
  ['PAT', /\b(?:net profit|profit after tax|\bPAT\b|net income|net earnings|profit for the (?:quarter|period|year))\b/i],
];
const ANY_METRIC = /\b(?:revenue|total income|net sales|sales|turnover|EBITDA|net profit|profit after tax|PAT|net income|PBT|profit before tax|EPS|earnings per share)\b/i;
const GROWTH = /\b(up|increase[sd]?|grew|growth(?: of)?|rose|higher(?: by)?|jump(?:ed)?|surge[sd]?|improv(?:ed|ement of)|down|decrease[sd]?|decline[sd]?|fell|lower(?: by)?|drop(?:ped)?|de-?growth(?: of)?)\b[^.;%]{0,28}?(\d+(?:\.\d+)?)\s?(?:%|per ?cent)/i;
const GROWTH_PRE = /(\d+(?:\.\d+)?)\s?(?:%|per ?cent)\s*(?:y-?o-?y\s+|yoy\s+|year[- ]on[- ]year\s+|year[- ]over[- ]year\s+)?(growth|increase|rise|jump|decline|de-?growth|drop|fall)/i;
const PRIOR = new RegExp(String.raw`\b(?:as against|against|compared (?:to|with)|vs\.?|versus|from)\s+(${MONEY})`, 'i');
const NEG = /^(down|decrease|decline|fell|lower|drop|de-?growth)/i;

function unitWord(m: string): string {
  return m.replace(/\s?crores?\b/i, ' Cr').replace(/\s?cr\b\.?/i, ' Cr').replace(/\s?lakhs?\b|\s?lacs?\b/i, ' lakh')
    .replace(/\s?million\b/i, ' million').replace(/\s?billion\b/i, ' billion').replace(/^Rs\.?\s?|^INR\s?/i, '₹').replace(/\s{2,}/g, ' ').trim();
}

/** Period named in the document ("Q1 FY27", "H1 FY27", "second quarter 2026"). */
export function periodOf(text: string): string | null {
  const t = String(text || '').slice(0, 6000);
  const q = /\b(Q[1-4]|H[12]|9M)\s?[-']?\s?FY\s?'?(\d{2,4})\b/i.exec(t);
  if (q) return `${q[1].toUpperCase()} FY${q[2].slice(-2)}`;
  const q2 = /\b(Q[1-4])\s?(?:FY)?\s?'?(20\d\d)\b/.exec(t);
  if (q2) return `${q2[1]} ${q2[2]}`;
  const e = /(?:quarter|period|half[- ]year|year) ended\s+(?:on\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+,?\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i.exec(t);
  if (e) return `period ended ${e[1].replace(/\s+/g, ' ')}`;
  const w = /\b(first|second|third|fourth) quarter(?: of)?(?: fiscal(?: year)?)?\s+(20\d\d)\b/i.exec(t);
  if (w) return `${w[1][0].toUpperCase()}${w[1].slice(1).toLowerCase()} quarter ${w[2]}`;
  return null;
}

/** Pure: "Q1 FY27: Revenue ₹781.05 Cr (up 9%), PAT ₹58.2 Cr (vs ₹41 Cr)" — only stated figures. */
export function resultsLine(text: string, market: 'IN' | 'US' = 'IN'): string | null {
  const sents = (market === 'US' ? eventSentences(text) : inSentences(text)).slice(0, 400);
  const parts = new Map<string, string>();
  let marginPart: string | null = null;
  const moneyRe = new RegExp(MONEY, 'i');
  for (const s0 of sents) {
    if (BOILERPLATE.test(s0) || s0.length > 600) continue;
    const s = s0.replace(/\s+/g, ' ');
    for (const [name, re] of METRICS) {
      if (parts.has(name)) continue;
      const m = re.exec(s);
      if (!m) continue;
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 110);
      const mm = moneyRe.exec(after);
      if (!mm) continue;
      const between = after.slice(0, mm.index);
      // another metric between the keyword and the figure: the figure is that metric's
      if (ANY_METRIC.test(between) || /margin|per share|guidance|target|expect/i.test(between)) continue;
      let part = `${name} ${unitWord(mm[0])}`;
      const rest = after.slice(mm.index + mm[0].length, mm.index + mm[0].length + 120);
      const g = GROWTH.exec(rest.split(ANY_METRIC)[0]);
      const gp = GROWTH_PRE.exec(rest.split(ANY_METRIC)[0]);
      if (g) part += ` (${NEG.test(g[1]) ? 'down' : 'up'} ${g[2]}%)`;
      else if (gp) part += ` (${/decline|de-?growth|drop|fall/i.test(gp[2]) ? 'down' : 'up'} ${gp[1]}%)`;
      else { const pr = PRIOR.exec(rest.split(ANY_METRIC)[0]); if (pr) part += ` (vs ${unitWord(pr[1])})`; }
      parts.set(name, part);
    }
    if (!marginPart) {
      const mg = /\bEBITDA margins?\b[^.;%]{0,40}?(\d+(?:\.\d+)?)\s?%/i.exec(s);
      if (mg) marginPart = `EBITDA margin ${mg[1]}%`;
    }
  }
  const out = ['Revenue', 'EBITDA', 'PAT'].filter((k) => parts.has(k)).map((k) => parts.get(k) as string);
  if (marginPart && out.length) out.push(marginPart);
  if (!out.length) return null;
  const p = periodOf(text);
  return `${p ? `${p}: ` : ''}${out.join(', ')}`;
}

// ── capacity ───────────────────────────────────────────────────────────────

const CAP_UNIT = String.raw`(?:MTPA|TPA|TPD|TPM|KTPA|MT|tonnes?|tons?|MW|GW|MWp|MWh|KLPD|KL|MLD|units|lakh units|million units|sq\.? ?ft|beds|spindles|rotors|looms)`;
const num = (s: string) => parseFloat(String(s).replace(/[~+,]/g, ''));

/** Pure: "Capacity 5,000 → 9,600+ MTPA (+92%), commissioned". The % is computed from the two stated capacities. */
export function capacityLine(text: string): string | null {
  const t = String(text || '').replace(/\s+/g, ' ');
  const re = new RegExp(String.raw`\b(?:capacity|production|capacities)\b[^.;]{0,90}?\bfrom\s+(?:~|about|approx(?:imately|\.)?\s+)?(\d[\d,]*(?:\.\d+)?\+?)\s*(${CAP_UNIT})?\s*(?:to|→|->)\s*(?:~|about|over\s+)?(\d[\d,]*(?:\.\d+)?\+?)\s*(${CAP_UNIT})`, 'i');
  const m = re.exec(t);
  const stage = /successful(?:ly)? commission|has been commissioned|commissioned|commenced commercial (?:production|operations)|started commercial|operational/i.test(t) ? ', commissioned'
    : /board (?:has )?(?:considered and )?approved|approved (?:the )?(?:capacity|expansion|capex)/i.test(t) ? ', approved by the board' : '';
  if (m) {
    const a = num(m[1]), b = num(m[3]);
    const unit = m[4] || m[2] || '';
    const pct = a > 0 && b > 0 && (!m[2] || !m[4] || m[2].toLowerCase() === m[4].toLowerCase()) ? Math.round(((b - a) / a) * 100) : null;
    return `Capacity ${m[1]} → ${m[3]} ${unit}${pct != null && Math.abs(pct) < 1000 ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}${stage}`.replace(/\s{2,}/g, ' ');
  }
  const add = new RegExp(String.raw`\b(?:capacity|capacities)\s+(?:addition|expansion|enhancement)\s+(?:of\s+)?(?:~|about)?\s*(\d[\d,]*(?:\.\d+)?\+?)\s*(${CAP_UNIT})`, 'i').exec(t)
    || new RegExp(String.raw`\b(?:additional|new)\s+capacity\s+of\s+(\d[\d,]*(?:\.\d+)?\+?)\s*(${CAP_UNIT})`, 'i').exec(t);
  if (add) return `Capacity addition ${add[1]} ${add[2]}${stage}`;
  return null;
}

// ── schemes ────────────────────────────────────────────────────────────────

function party(t: string, role: RegExp): string | null {
  const re = new RegExp(String.raw`((?:M\/s\.?\s*)?[A-Z][A-Za-z0-9&.,'\- ]{3,90}?)\s*\(\s*(?:hereinafter\s+(?:referred\s+to\s+as\s+)?)?["'“‘]*\s*(?:the\s+)?["'“‘]*\s*` + role.source, 'i');
  const m = re.exec(t);
  if (!m) return null;
  return m[1].replace(/^M\/s\.?\s*/i, '').replace(/^(?:of|between|and|with|among)\s+/i, '').replace(/.*\b(?:between|among|of)\s+(?=[A-Z])/, '').replace(/[,\s]+$/, '').trim().slice(0, 80) || null;
}

/** Pure: "Scheme: Dalmia Bharat Refractories' business demerged into Himadri Speciality Chemical; share swap …". */
export function schemeLine(text: string, company?: string | null): string | null {
  const t = String(text || '').replace(/\s+/g, ' ');
  if (!/scheme of (?:arrangement|amalgamation)|demerg|amalgamat|\bmerger\b/i.test(t)) return null;
  const demerged = party(t, /Demerged Company/), resulting = party(t, /Resulting Company/);
  const transferor = party(t, /Transferor Company/), transferee = party(t, /Transferee Company/);
  let head = '';
  let from: string | null = null, to: string | null = null;
  if (demerged && resulting) { head = `Scheme: ${demerged}'s business demerged into ${resulting}`; from = demerged; to = resulting; }
  else if (transferor && transferee) { head = `Scheme: ${transferor} to be amalgamated into ${transferee}`; from = transferor; to = transferee; }
  else if (/demerg/i.test(t)) head = 'Scheme of arrangement (demerger)';
  else head = 'Scheme of arrangement / amalgamation';
  const ratio = /(\d+)\s*(?:\([A-Za-z ]+\)\s*)?(?:fully paid[- ]up\s+)?equity shares?[^.;]{0,140}?\bfor every\s+(\d+)\s*(?:\([A-Za-z ]+\)\s*)?(?:fully paid[- ]up\s+)?equity shares?/i.exec(t);
  const stage = /(?:NCLT|Tribunal)[^.;]{0,60}(?:sanction|approv)|sanctioned the scheme|order sanctioning/i.test(t) ? 'sanctioned by the NCLT'
    : /effective date|scheme (?:has )?become effective|made effective/i.test(t) ? 'effective'
    : /board of directors[^.;]{0,80}(?:considered and )?approved|approved the (?:draft |composite )?scheme/i.test(t) ? 'approved by the board'
    : /observation letter|no[- ]objection|no adverse observation/i.test(t) ? 'exchange no-objection received' : null;
  const parts = [head];
  if (ratio) parts.push(`share swap ${ratio[1]} for every ${ratio[2]} shares`);
  if (stage) parts.push(stage);
  let line = parts.join('; ');
  const word = String(company || '').toLowerCase().replace(/\b(limited|ltd|india|the|industries|company)\b/g, ' ').trim().split(/\s+/).find((w) => w.length >= 4);
  if (word && to && to.toLowerCase().includes(word)) line += ' — the company receives the business';
  else if (word && from && from.toLowerCase().includes(word)) line += ' — the company gives up the business';
  return line;
}

// ── other lines ────────────────────────────────────────────────────────────

const NO_IMPACT = /\bno (?:material|significant|major|adverse)\s+(?:financial\s+|adverse\s+)?(?:impact|effect|bearing|implication)|not (?:expected to )?(?:have|be) (?:any )?(?:material|significant)|no impact on (?:the )?(?:financial|operations|business)|does not have any material/i;

function sentenceWith(text: string, re: RegExp, market: 'IN' | 'US', preferFigure = true): string | null {
  const sents = (market === 'US' ? eventSentences(text) : inSentences(text)).filter((s) => !BOILERPLATE.test(s) && s.length < 700);
  const hits = sents.filter((s) => re.test(s));
  if (!hits.length) return null;
  const withFig = preferFigure ? hits.find((s) => (market === 'US' ? figuresIn(s) : inFiguresIn(s)).length) : null;
  return withFig || hits[0];
}

/** A cover letter's first real sentence ("… we wish to inform that …"). */
function leadSentence(text: string): string | null {
  const sents = inSentences(text).filter((s) => !BOILERPLATE.test(s) && s.length >= 40 && s.length < 600
    && !/scrip code|symbol\s*:|dear sir|listing (?:department|compliance)|corporate relationship|exchange plaza|dalal street|^sub(?:ject)?\s*:|^ref\s*:|cin\s*:|regd\.? off|website|e-?mail/i.test(s));
  return sents.find((s) => /\b(?:inform|intimate|announce|pleased|hereby|has (?:received|approved|entered|signed|completed|commenced)|board of directors)\b/i.test(s)) || null;
}

// ── touches ────────────────────────────────────────────────────────────────

const IN_TOUCH: Record<string, [string, Touch['dir'] | ((h: InEventHit) => Touch['dir'])]> = {
  revenue_growth: ['revenue_growth', 'up'], revenue_decline: ['revenue_growth', 'down'],
  profit_growth: ['earnings_growth', 'up'], turnaround_profit: ['earnings_growth', 'up'], record_results: ['earnings_growth', 'up'],
  profit_decline: ['earnings_growth', 'down'], net_loss: ['earnings_growth', 'down'],
  revenue_vs_prior: ['revenue_growth', (h) => (h.direction === 'positive' ? 'up' : h.direction === 'negative' ? 'down' : 'stated')],
  profit_vs_prior: ['earnings_growth', (h) => (h.direction === 'positive' ? 'up' : h.direction === 'negative' ? 'down' : 'stated')],
  margin_expansion: ['margin', 'up'], margin_compression: ['margin', 'down'],
  guidance: ['guidance', (h) => (/\b(?:cut|lower(?:ed)?|reduc|revised down|downgrad)/i.test(h.sentence) ? 'down' : /\b(?:rais|upgrad|higher|increas)/i.test(h.sentence) ? 'up' : 'stated')],
  order_book: ['order_book', 'stated'], order_win: ['order_intake', 'up'], order_cancellation: ['order_intake', 'down'],
  capacity_commissioned: ['capacity_addition', 'up'], capacity_expansion: ['capacity_addition', 'up'],
  regulatory_approval: ['approval', 'up'], vendor_approval: ['qualification', 'up'], regulatory_setback: ['approval', 'down'],
  new_product: ['new_product', 'up'], partnership: ['new_customer', 'up'], price_hike: ['price', 'up'],
};
const US_TOUCH: Record<string, [string, Touch['dir']]> = {
  earnings_beat: ['revenue_growth', 'up'], record_results: ['revenue_growth', 'up'], revenue_growth: ['revenue_growth', 'up'],
  growth_acceleration: ['revenue_growth', 'up'], revenue_decline: ['revenue_growth', 'down'], earnings_miss: ['earnings_growth', 'down'],
  margin_expansion: ['margin', 'up'], margin_compression: ['margin', 'down'], turned_profitable: ['earnings_growth', 'up'],
  guidance_raise: ['guidance', 'up'], guidance_cut: ['guidance', 'down'], guidance_issued: ['guidance', 'stated'],
  capacity_expansion: ['capacity_addition', 'up'], new_facility: ['new_plant', 'up'], production_start: ['capacity_addition', 'up'],
  facility_closure: ['capacity', 'down'], major_contract: ['order_intake', 'up'], gov_contract: ['order_intake', 'up'],
  backlog: ['order_book', 'up'], customer_win: ['new_customer', 'up'], fda_approval: ['approval', 'up'], intl_approval: ['approval', 'up'],
  fda_crl: ['approval', 'down'], product_launch: ['new_product', 'up'], first_commercial: ['new_product', 'up'],
};

function inTouches(hits: InEventHit[]): Touch[] {
  const out: Touch[] = [];
  for (const h of hits) {
    const m = IN_TOUCH[h.id];
    if (!m) continue;
    out.push({ key: m[0], dir: typeof m[1] === 'function' ? m[1](h) : m[1] });
  }
  return out;
}

// ── kind from the document ─────────────────────────────────────────────────

const IN_HIT_KIND: Record<string, RecentEventType> = {
  order_win: 'Order win', order_cancellation: 'Order win', capacity_commissioned: 'Capex / capacity', capacity_expansion: 'Capex / capacity',
  acquisition: 'Acquisition', joint_venture: 'Acquisition', merger: 'Corporate restructuring', demerger: 'Corporate restructuring',
  divestment: 'Divestment', equity_raise: 'Fund raise', debt_raise: 'Fund raise', regulatory_approval: 'Regulatory approval',
  vendor_approval: 'Regulatory approval', regulatory_setback: 'Regulatory / legal action', tax_demand: 'Regulatory / legal action',
  legal_win: 'Regulatory / legal action', insolvency_default: 'Regulatory / legal action', operations_disruption: 'Regulatory / legal action',
  kmp_resignation: 'Management change', kmp_appointment: 'Management change', auditor_resignation: 'Management change', independent_director_exit: 'Management change',
  price_clarification: 'Exchange clarification', media_clarification: 'Exchange clarification', exchange_query: 'Exchange clarification',
  open_offer: 'Shareholding disclosure', promoter_selling: 'Shareholding disclosure', promoter_stake_sale: 'Shareholding disclosure',
  promoter_buying: 'Shareholding disclosure', pledge: 'Shareholding disclosure', block_deal: 'Shareholding disclosure', stake_disclosure: 'Shareholding disclosure',
  strategic_investor: 'Fund raise', partnership: 'Concall / business update', new_product: 'Concall / business update', price_hike: 'Concall / business update',
  guidance: 'Guidance', order_book: 'Order win',
};
const FACT_KIND: Record<string, RecentEventType> = {
  order: 'Order win', capacity: 'Capex / capacity', qualification: 'Regulatory approval', acquisition: 'Acquisition',
  fundraising: 'Fund raise', partnership: 'Concall / business update', new_product: 'Concall / business update',
  tax_litigation: 'Regulatory / legal action', governance: 'Regulatory / legal action', regulatory_negative: 'Regulatory / legal action',
  results: 'Results', promoter_buying: 'Shareholding disclosure', guidance: 'Guidance', merger: 'Corporate restructuring',
};
const US_HIT_KIND: Record<string, RecentEventType> = {
  takeover_bid: 'Acquisition', merger_agreement: 'Corporate restructuring', acquisition: 'Acquisition', divestiture: 'Divestment',
  restructuring: 'Corporate restructuring', management_change: 'Management change', gov_contract: 'Order win', major_contract: 'Order win',
  backlog: 'Order win', customer_win: 'Order win', partnership: 'Concall / business update', joint_venture: 'Acquisition',
  licensing: 'Concall / business update', supply_agreement: 'Order win', strategic_investment: 'Fund raise',
  fda_crl: 'Regulatory / legal action', regulatory_probe: 'Regulatory / legal action', settlement: 'Regulatory / legal action',
  patent_litigation_win: 'Regulatory / legal action', fda_approval: 'Regulatory approval', intl_approval: 'Regulatory approval',
  fda_submission: 'Regulatory approval', designation: 'Regulatory approval', equity_offering: 'Fund raise', convertible: 'Fund raise',
  warrant_exercise: 'Fund raise', debt_refinancing: 'Fund raise', capacity_expansion: 'Capex / capacity', new_facility: 'Capex / capacity',
  production_start: 'Capex / capacity', facility_closure: 'Capex / capacity', guidance_raise: 'Guidance', guidance_cut: 'Guidance',
  guidance_issued: 'Guidance', activist_stake: 'Shareholding disclosure', insider_buying: 'Shareholding disclosure',
  product_launch: 'Concall / business update', first_commercial: 'Concall / business update', trial_results: 'Concall / business update',
};

// ── the reader ─────────────────────────────────────────────────────────────

export interface ReadInput {
  subject: string;
  text: string;
  market: 'IN' | 'US';
  company?: string | null;
  issuer?: string | null;
  date?: string | null;
  url?: string | null;
}

/** Pure: one filing's text → the line that matters. Never invents a figure. */
export function readFilingText(inp: ReadInput): ReadCore {
  const text = String(inp.text || '').replace(/\s+/g, ' ').trim();
  if (text.length < MIN_TEXT) return { kind: null, line: null, figures: [], routine: null, touches: [], chars: text.length };
  return inp.market === 'US' ? readUs(inp, text) : readIn(inp, text);
}

function lineOut(core: ReadCore, market: 'IN' | 'US'): ReadCore {
  const line = core.line ? clip(core.line, 240) : null;
  const figs = line ? (market === 'US' ? figuresIn(line) : inFiguresIn(line)) : [];
  // the one computed figure: a capacity change % from two stated capacities
  const cap = line && /^Capacity .*→.*\(([+-]?\d+)%\)/.exec(line);
  if (cap && !figs.some((f) => f.replace(/\s/g, '') === `${cap[1]}%`)) figs.push(`${cap[1]}%`);
  return { ...core, line, figures: figs };
}

function readIn(inp: ReadInput, text: string): ReadCore {
  const subj = subjectClass(inp.subject);
  const hits = classifyIndiaEvents(text, { max: 16 });
  const real = hits.filter((h) => !h.routine && h.id !== 'commodity_price');
  let facts: IndiaFacts[] = [];
  let factRoutine: string | null = null;
  try {
    const x = extractIndiaFacts({ text, issuer: inp.issuer || '', date: inp.date || null, url: inp.url || null, title: inp.subject });
    facts = x.facts; factRoutine = x.routineReason;
  } catch { facts = []; }
  const touches = inTouches(real);
  // facts the taxonomy has no rule for, read from the body the same way (stated, never inferred)
  if (capacityLine(text) && !touches.some((t) => t.key === 'capacity_addition')) touches.push({ key: 'capacity_addition', dir: 'up' });
  if (/\bnew\s+(?:[A-Z]{2,6}\s+|global\s+|international\s+|marquee\s+|large\s+)*(?:customers?|clients?)\b|added\s+\d+\s+new\s+(?:customers?|clients?)/i.test(text)) touches.push({ key: 'new_customer', dir: 'up' });
  if (/\b(?:site|facility|plant|unit)s?\b[^.]{0,60}\b(?:approved|qualified|audited successfully)\s+by\b|\bqualified\s+(?:as\s+a\s+)?(?:vendor|supplier)\b/i.test(text)) touches.push({ key: 'qualification', dir: 'up' });
  const noImpact = NO_IMPACT.test(text);
  const senior = /\b(?:ceo|chief executive|cfo|chief financial|managing director|chairman|chairperson|whole[- ]time director|executive director|coo|chief operating)\b/i.test(`${inp.subject} ${real.filter((h) => /kmp|auditor|director/.test(h.id)).map((h) => h.sentence).join(' ')}`);

  // what the document shows
  const resultsHit = real.find((h) => h.category === 'Results' && h.id !== 'guidance' && h.id !== 'order_book');
  const fact = facts[0] || null;
  let kind: RecentEventType | null = null;
  if (/scheme of (?:arrangement|amalgamation)|demerged company|resulting company|transferor company/i.test(text)) kind = 'Corporate restructuring';
  else if (fact && FACT_KIND[fact.event.kind] && fact.event.kind !== 'results') kind = FACT_KIND[fact.event.kind];
  else if (resultsHit && (resultsHit.id !== 'results_filed' || /financial results|results for the quarter/i.test(text))) kind = 'Results';
  else if (real[0]) kind = IN_HIT_KIND[real[0].id] || (real[0].category === 'Results' ? 'Results' : null);
  const type: RecentEventType = subj.generic || subj.type === 'Other filing' ? (kind || 'Other filing') : subj.type;

  // nothing material: a generic subject whose body names no event
  if (!real.length && !facts.length && (subj.generic || subj.type === 'Other filing')) {
    const r = factRoutine || hits.find((h) => h.routine)?.label?.toLowerCase() || 'nothing material stated in the document';
    return { kind: null, line: leadSentence(text) ? clip(leadSentence(text) as string, 200) : null, figures: [], routine: r, touches: [], chars: text.length, senior, noImpact };
  }

  let line: string | null = null;
  const hitLine = (ids: RegExp) => { const h = real.find((x) => ids.test(x.id)); return h ? h.sentence : null; };
  switch (type) {
    case 'Results': line = resultsLine(text, 'IN') || (resultsHit ? `${resultsHit.label}: ${clip(resultsHit.sentence, 170)}` : 'Results filed — the figures are in the statement tables, no headline sentence'); break;
    case 'Order win': line = fact?.event.kind === 'order' ? fact.headline : hitLine(/order_win|order_book/); break;
    case 'Capex / capacity': line = capacityLine(text) || (fact?.event.kind === 'capacity' ? fact.headline : hitLine(/capacity/)); break;
    case 'Corporate restructuring': line = schemeLine(text, inp.company); break;
    case 'Acquisition': case 'Divestment': case 'Fund raise': case 'Regulatory approval':
      line = fact && FACT_KIND[fact.event.kind] === type ? fact.headline : (real[0] ? `${real[0].label}: ${clip(real[0].sentence, 170)}` : null); break;
    case 'Regulatory / legal action': {
      const base = fact && (fact.event.kind === 'tax_litigation' || fact.event.kind === 'governance') ? fact.headline
        : sentenceWith(text, /\b(?:demand|penalt|notice|order|fine|levied|assessment|show cause|proceeding)\b/i, 'IN');
      line = base ? `${clip(base, 170)}${noImpact ? ' — company says no material impact' : ''}` : null; break;
    }
    case 'Management change': line = sentenceWith(text, /\b(?:appoint|resign|cessation|re-?appoint|re-?designat|steps? down|superannuat)/i, 'IN', false); break;
    case 'Exchange clarification': {
      const re = /not aware|no (?:such )?(?:information|announcement|event|price sensitive|undisclosed)|purely market|market[- ]driven|no knowledge|nothing to (?:disclose|report)/i;
      const ss = inSentences(text).filter((x) => re.test(x) && x.length < 600).slice(0, 2).map((x) => clip(x, 130));
      line = ss.length ? `Company says: “${ss.map((x) => x.replace(/[.…]$/, '')).join('. ')}.”` : null; break;
    }
    case 'Shareholding disclosure': case 'Promoter holding change': line = sentenceWith(text, /\b(?:shares?|stake|holding|voting rights)\b[^.]{0,120}\d/i, 'IN'); break;
    case 'Guidance': line = hitLine(/guidance/); break;
    case 'Concall / business update': {
      const top = real.filter((h) => h.figures.length).slice(0, 2);
      const cap = capacityLine(text);
      const bits: string[] = [];
      if (cap) bits.push(cap);
      for (const h of top) if (bits.length < 2 && !(cap && /capacity/.test(h.id))) bits.push(`${h.label}: ${clip(h.sentence, 110)}`);
      const cust = sentenceWith(text, /\bnew\s+(?:[A-Z]{2,6}\s+|global\s+|international\s+|marquee\s+|large\s+)*(?:customers?|clients?)\b/i, 'IN', false);
      if (cust && bits.length < 3) bits.push(clip(cust, 90));
      const appr = sentenceWith(text, /\b(?:site|facility|plant|unit)s?\b[^.]{0,60}\b(?:approved|qualified)\s+by\b/i, 'IN', false);
      if (appr && bits.length < 3 && appr !== cust) bits.push(clip(appr, 90));
      line = bits.join('; ') || (real[0] ? `${real[0].label}: ${clip(real[0].sentence, 150)}` : null);
      break;
    }
    default: line = real[0] ? `${real[0].label}: ${clip(real[0].sentence, 170)}` : leadSentence(text);
  }
  return lineOut({ kind, line, routine: null, touches, chars: text.length, senior, noImpact }, 'IN');
}

function readUs(inp: ReadInput, text: string): ReadCore {
  const subj = subjectClass(inp.subject);
  const hits: UsEventHit[] = classifyUsEvents(text, { max: 12 });
  const touches: Touch[] = hits.map((h) => US_TOUCH[h.id]).filter(Boolean).map(([key, dir]) => ({ key, dir }));
  const noImpact = NO_IMPACT.test(text);
  const senior = /\b(?:ceo|chief executive|cfo|chief financial|president|chairman|coo|chief operating)\b/i.test(`${inp.subject} ${hits.filter((h) => h.id === 'management_change').map((h) => h.sentence).join(' ')}`);
  const earn = hits.find((h) => h.category === 'Earnings' && !/^guidance/.test(h.id));
  let kind: RecentEventType | null = earn ? 'Results' : hits[0] ? (US_HIT_KIND[hits[0].id] || null) : null;
  if (/scheme of arrangement|spin-?off|separation/i.test(text) && !kind) kind = 'Corporate restructuring';
  const type: RecentEventType = subj.generic || subj.type === 'Other filing' ? (kind || 'Other filing') : subj.type;
  if (!hits.length && (subj.generic || subj.type === 'Other filing')) {
    return { kind: null, line: null, figures: [], routine: 'nothing material stated in the filing', touches: [], chars: text.length, senior, noImpact };
  }
  let line: string | null = null;
  if (type === 'Results') {
    const r = resultsLine(text, 'US');
    const g = hits.find((h) => /^guidance_(raise|cut)/.test(h.id));
    line = r ? `${r}${g ? `; ${g.label.toLowerCase()}` : ''}` : (earn ? `${earn.label}: ${clip(earn.sentence, 170)}` : null);
  } else {
    const lead = hits.find((h) => US_HIT_KIND[h.id] === type) || hits[0];
    line = lead ? `${lead.label}: ${clip(lead.sentence, 180)}` : null;
    if (type === 'Regulatory / legal action' && line && noImpact) line += ' — company says no material impact';
  }
  return lineOut({ kind, line, routine: null, touches, chars: text.length, senior, noImpact }, 'US');
}

/** Pure: the cache / response record for one filing. */
export function toFilingRead(url: string, core: ReadCore | null, failure: string | null, now: Date = new Date()): FilingRead {
  if (!core || failure) return { url, status: 'failed', reason: failure || 'no readable text', version: FILING_READ_VERSION, readAt: now.toISOString() };
  if ((core.chars || 0) < MIN_TEXT) return { url, status: 'failed', reason: 'no readable text in the document (scanned image or empty)', version: FILING_READ_VERSION, readAt: now.toISOString() };
  return { url, status: 'read', ...core, version: FILING_READ_VERSION, readAt: now.toISOString() };
}
