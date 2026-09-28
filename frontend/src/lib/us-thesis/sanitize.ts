// ═══════════════════════════════════════════════════════════════════════════
// US EVIDENCE HYGIENE: ONE COMPANY'S FIGURES, AND ONLY REAL FIGURES. (zzz793)
//
// Two defects the owner saw on the live page, both fixed here on the US side
// only (the shared engine and India are untouched):
//
// (1) JUNK EXTRACTIONS. ALB showed "Volume 65" and "Working capital 83%": a
//     number lifted from a management sentence with no unit and no metric
//     next to it. A figure is kept for a thesis variable only when its unit
//     fits the variable (volume and capacity need a physical unit, the order
//     book and working capital need money or days, utilisation needs a
//     percentage) — in the value itself, or directly after the number in the
//     sentence it came from. Bare numbers, bare percentages on a variable
//     that is not a percentage, years, page numbers and footnote references
//     are dropped. Text without figures ("a new customer in Europe") is kept.
//
// (2) ONE COMPANY PER LEDGER. The NTNX card showed RELL's order book. A US
//     ledger, its facts and its documents are checked against the ticker the
//     card belongs to (and the SEC CIK in each document's EDGAR address);
//     anything that belongs to another company is dropped before the engine
//     or Special Focus ever sees it.
// Pure.
// ═══════════════════════════════════════════════════════════════════════════

import type { CompanyLedger } from '@/lib/thesis/evidence-ledger';

export const usTickerKey = (t: string) => String(t || '').toUpperCase().trim().replace(/[./ ]/g, '-');

const PHYS = /\b(?:tonnes?|tons?|kt|kilotonnes?|kilo-?tons?|mt|mmt|metric tons?|lbs?|pounds|kg|ounces|oz|units?|vehicles|aircraft|systems|shipments?|barrels|bbls?|boe|mmboe|mcf|bcf|mwh|gwh|twh|mw|gw|kw|square feet|sq\.? ?ft|devices|subscribers|customers|wafers|gallons|seats|rooms|beds|stores|locations|sites|rigs|vessels|satellites|machines|modules|panels|chips|miles|hours|megawatts|gigawatts|exahash|eh\/s|th\/s|petahash)\b/i;
const MONEY = /\$\s?\d|\b(?:usd|us\$|eur|€|£|cny|rmb)\s?\d|\d[\d,.]*\s*(?:million|billion|thousand|mn|bn|m\b|b\b|k\b)/i;
const PCT = /\d\s*%|\bper ?cent\b/i;
const CHANGE = /\b(?:up|down|increase[sd]?|decrease[sd]?|grew|growth|declin\w*|higher|lower|rose|fell|improv\w*|expan\w*|contract\w*)\b/i;
const DAYS = /\b\d+\s*days?\b/i;
const RATIO = /\d\s*(?:x|×|times)\b|\b\d\.\d{1,2}\b/i;

const JUNK: Array<[RegExp, string]> = [
  [/^\s*(?:19|20)\d{2}\s*$/, 'a year, not a figure'],
  [/\bpage\s*\d+|\bp\.\s*\d+\b/i, 'a page reference'],
  [/^\s*\(\d{1,2}\)\s*$|\bnote\s+\d+\b|\bfootnote\b/i, 'a footnote reference'],
];

/** Which unit a variable's figure must carry. */
const NEED: Record<string, (s: string) => boolean> = {
  volume: (s) => PHYS.test(s) || (PCT.test(s) && CHANGE.test(s)),
  capacity: (s) => PHYS.test(s),
  capacity_addition: (s) => PHYS.test(s),
  new_plant: (s) => PHYS.test(s) || !/\d/.test(s),
  utilisation: (s) => PCT.test(s),
  working_capital: (s) => MONEY.test(s) || DAYS.test(s),
  order_book: (s) => MONEY.test(s) || RATIO.test(s),
  order_intake: (s) => MONEY.test(s) || (PCT.test(s) && CHANGE.test(s)),
  revenue_visibility: (s) => MONEY.test(s) || /\b(?:months?|years?|quarters?)\b/i.test(s),
  book_to_bill: (s) => RATIO.test(s),
  fcf: (s) => MONEY.test(s),
  debt: (s) => MONEY.test(s) || RATIO.test(s),
  price: (s) => PCT.test(s) || MONEY.test(s),
  mix: (s) => PCT.test(s) || MONEY.test(s),
  exports: (s) => PCT.test(s) || MONEY.test(s),
  market_share: (s) => PCT.test(s),
  margin_driver: (s) => PCT.test(s) || MONEY.test(s) || /\bbasis points|\bbps\b|\bpp\b/i.test(s),
};

/** The number(s) in a value, as printed. */
const numbersIn = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/,/g, ''));

/**
 * Is `value` a real figure for `variable`? The unit may sit in the value or
 * directly after the same number in `context` (the source sentence).
 */
export function plausibleUsFigure(variable: string, value: string | null | undefined, context?: string | null): { ok: boolean; why: string | null } {
  const v = String(value ?? '').trim();
  if (!v) return { ok: false, why: 'empty' };
  if (!/\d/.test(v)) return { ok: true, why: null };           // words, not a figure
  for (const [re, why] of JUNK) if (re.test(v)) return { ok: false, why };
  const need = NEED[variable];
  if (!need) return { ok: true, why: null };
  if (need(v)) return { ok: true, why: null };
  // The unit may be printed right after the number in the sentence itself.
  const ctx = String(context ?? '');
  if (ctx) {
    for (const n of numbersIn(v)) {
      const esc = n.replace(/\./g, '\\.').replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,?');
      const m = new RegExp(`${esc}\\s*([^\\s.;,]+(?:\\s+[^\\s.;,]+){0,2})`, 'i').exec(ctx);
      if (m && need(`${n} ${m[1]}`) && !/\bpage\b/i.test(ctx.slice(Math.max(0, m.index - 8), m.index))) return { ok: true, why: null };
    }
  }
  const unitLess = /^\s*[~≈]?\s*[\d,.]+\s*%?\s*$/.test(v.replace(/^[a-z\s-]+/i, ''));
  return { ok: false, why: unitLess ? `a bare number with no unit that fits ${variable.replace(/_/g, ' ')}` : `no unit that fits ${variable.replace(/_/g, ' ')}` };
}

// ── A DOLLAR FIGURE CARRIES ITS SCALE.                               (zzz793)
// A 10-Q table is "in millions"; the model copies "$3,250" out of it and the
// card printed "$3,250 → $2,650 · +$0 mn" (MOG-A) — 3,250 dollars. For the
// money variables a "$N" with no million / billion / thousand after it takes
// its scale from its own sentence ("in millions", "(in thousands)"); with no
// scale stated anywhere it is not a usable figure and is dropped (the filed
// XBRL order backlog stands in for it).
const MONEY_VARS = new Set(['order_book', 'order_intake', 'fcf', 'debt', 'working_capital', 'revenue_visibility']);
const BARE_DOLLAR = /\$\s?(\d[\d,]*(?:\.\d+)?)(?![\d,]|\.\d|\s*(?:million|billion|thousand|mn\b|bn\b|m\b|b\b|k\b|%))/gi;
export function usScaleMoney(variable: string, value: string | null | undefined, context?: string | null): { value: string | null; why: string | null } {
  const v = String(value ?? '');
  if (!v || !MONEY_VARS.has(variable)) return { value: value ?? null, why: null };
  BARE_DOLLAR.lastIndex = 0;
  if (!BARE_DOLLAR.test(v)) return { value: v, why: null };
  const ctx = String(context ?? '');
  const scale = /\bin (?:millions|\$ ?millions)|\(\s*(?:in )?(?:\$ ?)?millions?\s*\)|millions of (?:u\.?s\.? )?dollars/i.test(ctx) ? 'million'
    : /\bin thousands|\(\s*(?:in )?(?:\$ ?)?thousands?\s*\)|thousands of (?:u\.?s\.? )?dollars/i.test(ctx) ? 'thousand' : null;
  if (!scale) return { value: null, why: 'a dollar figure with no stated scale (millions? thousands?)' };
  BARE_DOLLAR.lastIndex = 0;
  // zzz797: a table "(in thousands)" figure is shown in millions — OII's
  // "$445,000" (thousands) is $445.0 million, never "$445,000".
  if (scale === 'thousand') {
    return { value: v.replace(BARE_DOLLAR, (_m, n) => {
      const x = Number(String(n).replace(/,/g, '')) / 1000;
      return Number.isFinite(x) ? `$${x.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: x < 10 ? 2 : 1 })} million` : `$${n} thousand`;
    }), why: null };
  }
  return { value: v.replace(BARE_DOLLAR, (_m, n) => `$${n} ${scale}`), why: null };
}

// ── TABLE FRAGMENTS ARE NOT FIGURES.                                 (zzz797)
// POWL's capex read "announced $ | 6,525 | $ | 5,117 | …": a financial-table
// row (cells joined by the HTML-to-text pipe) lifted as if it were a sentence.
// Any value with a pipe next to a number or a dollar sign is a table cell run,
// not a stated figure, and is dropped wherever it appears.
const TABLE_FRAGMENT = /\|\s*[$€£(]?\s*\d|\d[\d,.)%]*\s*\|\s*[$€£]?|\$\s*\|/;
export const isTableFragment = (s: unknown): boolean => typeof s === 'string' && TABLE_FRAGMENT.test(s);

// ── A SHARE COUNT IS NOT GUIDANCE.                                   (zzz797)
// MDA's "guidance" was "8,106,539 common shares" — a share count from the
// capital section. Guidance names revenue, earnings, margin, cash or a unit
// of output; a number of shares (or warrants / options / units of stock)
// with no dollar or percentage figure is never guidance.
const SHARE_COUNT = /\d[\d,.]*\s*(?:million\s+|m\s+)?(?:(?:common|ordinary|preferred|class [a-z]|restricted)\s+)?(?:shares?|stock options?|options|warrants?|RSUs?|share units?)\b/i;
export function isShareCountNotGuidance(s: unknown): boolean {
  const t = String(s ?? '');
  if (!t.trim() || !SHARE_COUNT.test(t)) return false;
  // a per-share money figure ("$1.20 per share") or a % is a real guide
  if (/\$\s?\d|\d\s*%|per (?:diluted )?share|\bEPS\b/i.test(t)) return false;
  return true;
}

// ── BOILERPLATE / HYPOTHETICAL TEXT IS NOT EVIDENCE.                   (zzz829)
// The 10-day tab confirmed risk-factor and business-description sentences as
// structural evidence: "New customer: Changes to recurring revenue may result
// from … new customer acquisition" (a hypothetical), "Our Industrial segment
// provides on-site services that support new plant construction" (a segment
// description), "New plant: Mercury Financial LLC" (an entity name, no event),
// "$73.8 million in new customer non-maturity deposits" (a bank deposit line),
// an agreement "to sell its dormant exchange" (a disposal, not a customer).
// A sentence is evidence of a thesis variable only when it states an EVENT:
// no may / could / might, no risk-factor wording, and — for a new customer or
// a new plant — an event verb in the same sentence.
const HYPOTHETICAL = /\b(?:may|might|could)\s+(?:(?:not|also|further|continue to|in turn|potentially|materially|significantly)\s+)?(?:be|result|change|affect|vary|cause|include|have|increase|decrease|decline|fluctuate|differ|depend|require|impact|reduce|lead|occur|arise|experience|lose|need|adversely)\b|\bresults? may\b|\bif (?:we|the company|our)\b|\bin the event (?:that|of)\b|\bthere (?:can|may) be no assurance\b|\bno assurance\b|\bwe cannot (?:assure|guarantee|predict)\b|\brisk factors?\b|\bsubject to (?:risks|uncertaint)/i;
const DESCRIPTION = /\b(?:our|the|its) [A-Za-z&-]+(?: [A-Za-z&-]+)? (?:segment|business|division) (?:provides|offers|serves|includes|consists of|delivers|supports)\b|\bservices that support\b|\bwe (?:provide|offer|serve|design|develop|manufacture|market|sell|operate)\b[^.]{0,80}\b(?:to|for|in)\b(?![^.]{0,40}\b(?:new|first|signed|selected|awarded)\b)|\b(?:is|are) (?:a|an|the) (?:leading |global |diversified )?(?:provider|manufacturer|supplier|developer) of\b/i;
const CUSTOMER_EVENT = /\b(?:signed|selected|awarded|won|wins|added|adds|onboarded|secured|entered into|expanded|launched with|went live|chosen by|contracted with)\b/i;
const NOT_A_CUSTOMER = /\bnew customer (?:acquisition|growth|deposits?|accounts?|relationships?|additions? (?:may|could))\b|\b(?:non-maturity|core|customer) deposits?\b|\bto sell\b|\bsale of\b|\bdispos\w*\b|\bto (?:acquire|purchase)\b|\bmerger\b|\bcredit (?:agreement|facility)\b|\bloan agreement\b|\bsettlement agreement\b|\bemployment agreement\b|\blease (?:agreement)?\b|\bindenture\b|\bunderwriting agreement\b/i;
const PLANT_EVENT = /\b(?:opened|opens|commissioned|completed (?:construction|the (?:construction|build|expansion))|began (?:production|operations|shipments|manufacturing)|begins (?:production|operations)|started (?:production|operations)|broke ground|is now operational|became operational|came online|ramped|expanded (?:its|our) (?:plant|facility|capacity))\b/i;
const PLANT_NOUN = /\b(?:plant|facility|factory|fab|campus|line|site|data cent(?:er|re)|warehouse|mill)\b/i;

/** Pure: the sentence is hypothetical / risk-factor wording ("may result from", "no assurance", "if we fail"). */
export const isHypotheticalUs = (s: string | null | undefined): boolean => HYPOTHETICAL.test(String(s || ''));

/** Pure: why this sentence is NOT evidence of `variable` (boilerplate, hypothetical, description, no event), or null. */
export function usBoilerplateEvidence(variable: string | null | undefined, text: string | null | undefined): string | null {
  const v = String(variable || '');
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (!/^(?:guidance|management_target)$/.test(v) && HYPOTHETICAL.test(s)) return 'hypothetical / risk-factor wording — mentioned, not evidence';
  if (v === 'new_customer') {
    if (NOT_A_CUSTOMER.test(s)) return 'not a customer event (deposits, a disposal, financing or customer-acquisition wording) — mentioned, not evidence';
    if (!CUSTOMER_EVENT.test(s)) return 'no customer event stated (no signed / selected / awarded / added) — mentioned, not evidence';
  }
  if (v === 'new_plant' || v === 'capacity_addition' || v === 'commissioning') {
    if (DESCRIPTION.test(s) && !PLANT_EVENT.test(s)) return 'a business / segment description — mentioned, not evidence';
    if (v === 'new_plant' && (!PLANT_EVENT.test(s) || !PLANT_NOUN.test(s))) return 'no plant event stated (opened / commissioned / began production) — mentioned, not evidence';
  }
  if (DESCRIPTION.test(s) && /^(?:new_customer|new_plant|new_product|capacity|capacity_addition|volume)$/.test(v)) return 'a business / segment description — mentioned, not evidence';
  return null;
}

const SUMMARY_FIELDS: Array<[string, string, string]> = [
  ['volume_price_mix', 'volume', 'volume'], ['volume_price_mix', 'price', 'price'], ['volume_price_mix', 'mix', 'mix'], ['volume_price_mix', 'exports', 'exports'],
  ['balance', 'working_capital', 'working_capital'], ['balance', 'fcf', 'fcf'], ['balance', 'debt', 'debt'],
  ['capacity', 'installed', 'capacity'], ['capacity', 'prior_installed', 'capacity'], ['capacity', 'added', 'capacity_addition'], ['capacity', 'new_plant', 'new_plant'],
  ['utilisation', 'current', 'utilisation'], ['utilisation', 'prior', 'utilisation'], ['utilisation', 'expected', 'utilisation'],
  ['order_book', 'closing_value', 'order_book'], ['order_book', 'order_inflow', 'order_intake'], ['order_book', 'book_to_bill', 'book_to_bill'],
  ['demand', 'order_intake', 'order_intake'], ['demand', 'revenue_visibility', 'revenue_visibility'], ['risks', 'market_share', 'market_share'],
];

/** A US summary with every implausible structural figure blanked. Returns
 *  the cleaned copy and what was dropped (for the run log). */
export function sanitizeUsSummary(summary: any): { summary: any; dropped: string[] } {
  if (!summary || typeof summary !== 'object') return { summary, dropped: [] };
  const s = JSON.parse(JSON.stringify(summary));
  const dropped: string[] = [];
  // zzz797: table-cell runs anywhere in the summary (strings blanked, array
  // items that carry one dropped); share counts never stand as guidance.
  // A quote / evidence sentence may legitimately come from a table; only the
  // VALUE fields are tested.
  const QUOTE_KEY = /evidence|quote|context|source|url|text|label/i;
  const strip = (o: any, path: string): any => {
    if (typeof o === 'string') { if (isTableFragment(o)) { dropped.push(`${path} "${o.slice(0, 40)}" — a table row, not a stated figure`); return ''; } return o; }
    if (Array.isArray(o)) {
      return o.filter((it) => {
        const bad = typeof it === 'string' ? isTableFragment(it)
          : it && typeof it === 'object' && Object.entries(it).some(([k, x]) => !QUOTE_KEY.test(k) && isTableFragment(x));
        if (bad) dropped.push(`${path}[] — a table row, not a stated figure`);
        return !bad;
      }).map((it, i) => strip(it, `${path}[${i}]`));
    }
    if (o && typeof o === 'object') { for (const k of Object.keys(o)) if (!QUOTE_KEY.test(k)) o[k] = strip(o[k], path ? `${path}.${k}` : k); return o; }
    return o;
  };
  for (const k of Object.keys(s)) if (k !== 'events' && !QUOTE_KEY.test(k)) s[k] = strip(s[k], k);
  if (s.guidance && typeof s.guidance === 'object' && isShareCountNotGuidance(s.guidance.detail)) {
    dropped.push(`guidance "${String(s.guidance.detail).slice(0, 40)}" — a share count, not guidance`);
    s.guidance = { ...s.guidance, action: 'none', detail: '' };
  }
  if (Array.isArray(s.management_targets)) {
    s.management_targets = s.management_targets.filter((t: any) => {
      const bad = isShareCountNotGuidance(`${t?.target ?? ''}`) && !/\$|%/.test(`${t?.metric ?? ''}`);
      if (bad) dropped.push(`management target "${String(t?.target).slice(0, 40)}" — a share count, not guidance`);
      return !bad;
    });
  }
  for (const [grp, key, variable] of SUMMARY_FIELDS) {
    const o = s[grp];
    if (!o || typeof o !== 'object' || typeof o[key] !== 'string' || !o[key].trim()) continue;
    const sc = usScaleMoney(variable, o[key], null);
    if (sc.value == null) { dropped.push(`${grp}.${key} "${String(o[key]).slice(0, 40)}" — ${sc.why}`); o[key] = ''; continue; }
    o[key] = sc.value;
    // zzz829: "Mercury Financial LLC" as a new plant — an entity name, no plant and no event
    if (variable === 'new_plant' && !PLANT_NOUN.test(o[key]) && !PLANT_EVENT.test(o[key])) { dropped.push(`${grp}.${key} "${String(o[key]).slice(0, 40)}" — no plant or plant event named`); o[key] = ''; continue; }
    if (HYPOTHETICAL.test(o[key]) || (DESCRIPTION.test(o[key]) && !PLANT_EVENT.test(o[key]))) { dropped.push(`${grp}.${key} "${String(o[key]).slice(0, 40)}" — hypothetical / description, not evidence`); o[key] = ''; continue; }
    const r = plausibleUsFigure(variable, o[key], null);
    if (!r.ok) { dropped.push(`${grp}.${key} "${String(o[key]).slice(0, 40)}" — ${r.why}`); o[key] = ''; }
  }
  if (Array.isArray(s.events)) {
    const before = s.events.length;
    s.events = sanitizeUsEvents(s.events);
    if (s.events.length < before) dropped.push(`${before - s.events.length} event(s) without a real figure`);
  }
  return { summary: s, dropped };
}

/** Structural events: the same test, on each event's own sentence. */
export function sanitizeUsEvents<T extends { variable: string; after: string | null; before?: string | null; unit?: string | null; evidence_text?: string }>(events: T[]): T[] {
  const out: T[] = [];
  for (const e0 of events || []) {
    if (!e0) continue;
    const v = String(e0.variable || '');
    if (isTableFragment(e0.after) || isTableFragment(e0.before)) continue;
    if (/guidance|target/i.test(v) && isShareCountNotGuidance(e0.after)) continue;
    // zzz829: a hypothetical / risk-factor / description sentence is not evidence
    if (usBoilerplateEvidence(v, e0.evidence_text || e0.after)) continue;
    const a = usScaleMoney(v, e0.after, e0.evidence_text);
    if (e0.after && a.value == null) continue;
    const b = e0.before ? usScaleMoney(v, e0.before, e0.evidence_text) : { value: e0.before ?? null };
    const e = { ...e0, after: a.value ?? e0.after, before: b.value ?? null } as T;
    if (!e.after || plausibleUsFigure(v, `${e.after}${e.unit ? ` ${e.unit}` : ''}`, e.evidence_text || '').ok) out.push(e);
  }
  return out;
}

const cikOf = (url: string | null | undefined): string | null => {
  const m = /\/edgar\/data\/(\d+)\//i.exec(String(url || ''));
  return m ? String(Number(m[1])) : null;
};

/**
 * One company's ledger, and nothing of anyone else's: null when the ledger
 * itself belongs to another ticker; otherwise a copy with every document and
 * fact whose EDGAR address or ticker names another company removed, and every
 * implausible figure dropped from the facts, events and summaries.
 */
export function isolateUsLedger(ledger: CompanyLedger | null | undefined, ticker: string): CompanyLedger | null {
  if (!ledger || typeof ledger !== 'object' || !ledger.periods) return null;
  const want = usTickerKey(ticker);
  if (ledger.ticker && usTickerKey(ledger.ticker) !== want) return null;
  // The company's CIK: the one most of its own documents are filed under.
  const counts = new Map<string, number>();
  for (const p of Object.values(ledger.periods)) for (const d of p?.documents || []) { const c = cikOf(d.url); if (c) counts.set(c, (counts.get(c) || 0) + 1); }
  const cik = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const mine = (url: string | null | undefined) => { const c = cikOf(url); return !c || !cik || c === cik; };
  const periods: CompanyLedger['periods'] = {};
  for (const [k, p] of Object.entries(ledger.periods)) {
    if (!p) continue;
    const docs = (p.documents || []).filter((d) => mine(d.url));
    const facts = (p.facts || []).filter((f: any) => (!f.ticker || usTickerKey(f.ticker) === want) && mine(f.source_url))
      .filter((f: any) => !isTableFragment(f.after_value) && !isTableFragment(f.before_value) && !isTableFragment(f.value)
        && !(/guidance|target/i.test(String(f.metric_name || '')) && isShareCountNotGuidance(f.after_value ?? f.value))
        && !usBoilerplateEvidence(String(f.metric_name || ''), f.source_quote || f.after_value || f.value))
      .map((f: any) => {
        const m = String(f.metric_name || '');
        const a = usScaleMoney(m, f.after_value, f.source_quote);
        if (f.after_value && a.value == null) return null;
        const b = f.before_value ? usScaleMoney(m, f.before_value, f.source_quote).value : f.before_value;
        return a.value === f.after_value && b === f.before_value ? f : { ...f, after_value: a.value, value: a.value ?? f.value, before_value: b ?? null };
      })
      .filter((f: any) => f && (!f.after_value || plausibleUsFigure(String(f.metric_name || ''), `${f.after_value}${f.unit && !String(f.after_value).includes(String(f.unit)) ? ` ${f.unit}` : ''}`, f.source_quote).ok));
    const events = sanitizeUsEvents((p.events || []) as any[]);
    const summary = p.summary ? sanitizeUsSummary(p.summary).summary : p.summary;
    periods[k] = { ...p, documents: docs, facts, events, summary } as any;
  }
  return { ...ledger, ticker: ledger.ticker || want, periods };
}

// ── ONE COMPANY PER SPECIAL FOCUS RECORD (see special-focus-store). ──
const cikIn = (url: string | null | undefined): string | null => {
  const m = /\/edgar\/data\/(\d+)\//i.exec(String(url || ''));
  return m ? String(Number(m[1])) : null;
};
export function catalystIsolated(pc: { id: string; ticker: string } & { evidence?: Array<{ sources?: Array<{ url?: string | null }> }> }, ownCik?: number | string | null): boolean {
  const t = String(pc?.ticker || '').toUpperCase();
  if (!t || !String(pc?.id || '').toUpperCase().startsWith(`${t}:`)) return false;
  const ciks = new Set<string>();
  for (const it of pc.evidence || []) for (const s of it?.sources || []) { const c = cikIn(s?.url); if (c) ciks.add(c); }
  if (ciks.size > 1) return false;
  if (ownCik != null && ciks.size === 1 && !ciks.has(String(Number(ownCik)))) return false;
  return true;
}
