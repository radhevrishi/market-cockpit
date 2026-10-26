// zzz1166 — TRANSFORMATIONAL GAINERS (owner, 25 Oct 2026): keep the events from AI Daily Gainers that can change a company's
// future earnings — the kind behind DEE (qualified orders), Welspun (a less-obvious supplier winning project work), STL / HFCL
// (a business transition), TARIL (capacity → J-curve), Morepen (an earnings inflection) — for 60 days, with a theme and a
// "multibagger chance" read, so they can be studied as a set instead of one day at a time.
//
// WHAT COUNTS (from the research the daily page already did — no new reads, no model call here):
//   · a STRONG event (order / order book, capacity commissioned or started, vendor or regulatory approval, new segment or first
//     commercial sale, AI / data-centre work, acquisition / merger / demerger / JV, strategic investor, guidance raised,
//     turnaround) — positive, and filed by the company (press-only is kept, labelled "verify");
//   · or an EARNINGS INFLECTION in the filed figures: revenue ≥ 25% with profit ≥ 40%, revenue ≥ 15% with margin +3 points,
//     or revenue ≥ 50%;
//   · or two MEDIUM events from the company's own filings (partnership, new product, price increase, capacity plan …).
// Never: price commentary, negative events, routine paperwork, dilution on its own, a recent listing.
// Pure: no imports with side effects, so the page, the archive job and the tests share one rule.

export type TgMarket = 'IN' | 'US';
export type TgKind = 'ORDERS' | 'CAPACITY' | 'APPROVAL' | 'NEW_BUSINESS' | 'STRATEGIC' | 'GUIDANCE' | 'RESULTS' | 'TURNAROUND';
export type TgStrength = 'TRANSFORMATIONAL' | 'INFLECTION' | 'NOTABLE';
export type MbLabel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNLIKELY';

export interface TgFacts { revenueYoY: number | null; patYoY: number | null; marginNow: number | null; marginPrior: number | null; cfoToPat: number | null; guidance: string | null }
export interface MbView { score: number; label: MbLabel; plus: string[]; minus: string[] }
export interface AiMb { label: MbLabel; probabilityPct: number; why: string[]; risks: string[]; verifyNext: string[]; theme: string | null; at: string; model: string | null }

export interface TgItem {
  id: string; market: TgMarket; ticker: string; company: string;
  sessionDate: string; eventDate: string | null;
  movePct: number | null; moveWindow: '1D' | '1W'; returns: { w1: number | null; m1: number | null; m3: number | null };
  marketCap: number | null;   // ₹ Cr (IN) / $ M (US)
  kind: TgKind; strength: TgStrength; signals: string[];
  headline: string; whatChanged: string | null; quote: string | null;
  evidence: 'official' | 'press'; sourceUrl: string | null;
  durationYears: boolean; materiality: string | null;
  theme: string; themeWhy: string | null;
  facts: TgFacts;
  dilution: boolean;
  mb: MbView;
  ai?: AiMb | null;
}

// ── the signals ────────────────────────────────────────────────────────────
const STRONG: Record<string, TgKind> = {
  // India rule ids (lib/ai-gainers/in-event-taxonomy.ts)
  order_win: 'ORDERS', order_book: 'ORDERS', capacity_commissioned: 'CAPACITY', vendor_approval: 'APPROVAL', regulatory_approval: 'APPROVAL',
  joint_venture: 'STRATEGIC', acquisition: 'STRATEGIC', merger: 'STRATEGIC', demerger: 'STRATEGIC', strategic_investor: 'STRATEGIC',
  guidance: 'GUIDANCE', turnaround_profit: 'TURNAROUND',
  // US rule ids (lib/ai-gainers/us-event-taxonomy.ts)
  guidance_raise: 'GUIDANCE', growth_acceleration: 'RESULTS', first_commercial: 'NEW_BUSINESS', new_segment: 'NEW_BUSINESS', ai_datacenter: 'NEW_BUSINESS',
  new_facility: 'CAPACITY', production_start: 'CAPACITY', gov_contract: 'ORDERS', major_contract: 'ORDERS', backlog: 'ORDERS',
  customer_win: 'ORDERS', supply_agreement: 'ORDERS', fda_approval: 'APPROVAL', intl_approval: 'APPROVAL', priority_review_voucher: 'APPROVAL',
  turned_profitable: 'TURNAROUND', collaboration_expanded: 'STRATEGIC', licensing: 'STRATEGIC', strategic_investment: 'STRATEGIC', activist_stake: 'STRATEGIC',
  merger_agreement: 'STRATEGIC',
};
const MEDIUM: Record<string, TgKind> = {
  capacity_expansion: 'CAPACITY', partnership: 'STRATEGIC', new_product: 'NEW_BUSINESS', price_hike: 'RESULTS', promoter_buying: 'STRATEGIC',
  record_results: 'RESULTS', margin_expansion: 'RESULTS', tech_milestone: 'NEW_BUSINESS', product_launch: 'NEW_BUSINESS', trial_results: 'APPROVAL',
  designation: 'APPROVAL', insider_buying: 'STRATEGIC', product_mix: 'RESULTS', pricing_action: 'RESULTS',
};
const KIND_WORD: Record<TgKind, string> = {
  ORDERS: 'Orders / contracts', CAPACITY: 'Capacity / production', APPROVAL: 'Approval / qualification', NEW_BUSINESS: 'New business / segment',
  STRATEGIC: 'Strategic deal', GUIDANCE: 'Guidance raised', RESULTS: 'Earnings inflection', TURNAROUND: 'Turnaround',
};
export const tgKindWord = (k: TgKind) => KIND_WORD[k];

// ── themes: words in the company's own event text (and its name), first match wins ──
export const THEMES: Array<{ name: string; re: RegExp; structural: boolean }> = [
  { name: 'AI / data-centre infrastructure', re: /\b(?:data ?cent(?:er|re)s?|hyperscal\w*|\bAI\b|artificial intelligence|GPU|accelerator|liquid cooling|server|optical (?:fibre|fiber|interconnect|transceiver)|co-?packaged)\b/i, structural: true },
  { name: 'Power grid / transformers / T&D', re: /\b(?:transformers?|switchgear|transmission|substation|grid|HVDC|power cables?|conductors?|reactors?|busbar|energy meters?)\b/i, structural: true },
  { name: 'Power generation & gas turbines', re: /\b(?:gas turbines?|HRSG|boilers?|thermal power|power plants?|combined cycle|steam turbines?|nuclear|SMR)\b/i, structural: true },
  { name: 'Renewables / solar / storage', re: /\b(?:solar|photovoltaic|PV modules?|wind|battery|energy storage|BESS|green hydrogen|electrolys\w+|renewable)\b/i, structural: true },
  { name: 'Oil & gas / pipelines / LNG', re: /\b(?:pipelines?|LNG|oil (?:and|&) gas|upstream|refiner\w*|line pipe|OCTG|drilling|offshore|petrochem\w*|gas infrastructure)\b/i, structural: true },
  { name: 'Defence & aerospace', re: /\b(?:defen[cs]e|aerospace|missiles?|munitions?|ammunition|radar|military|DRDO|HAL|BEL|navy|army|air force|drones?|UAV|satellites?)\b/i, structural: true },
  { name: 'Railways & metro', re: /\b(?:railways?|rail|metro|Vande Bharat|wagons?|locomotives?|coaches|RVNL|IRCON|signall?ing)\b/i, structural: true },
  { name: 'Electronics / EMS / semiconductors', re: /\b(?:EMS|electronics manufactur\w*|PCBs?|printed circuit|semiconductors?|chips?|OSAT|wafers?|fab|display|components? for mobiles?)\b/i, structural: true },
  { name: 'Pharma CDMO / API / healthcare', re: /\b(?:CDMO|CRAMS|API|ANDA|USFDA|FDA|drug|pharma\w*|biolog\w+|clinical|hospitals?|healthcare|health care|diagnostic\w*|medical devices?|vaccines?|peptides?|GLP-?1|formulations?|therapeutics?|biotech\w*)\b/i, structural: true },
  { name: 'Specialty chemicals & materials', re: /\b(?:specialty chemicals?|chemicals?|fluoro\w*|polymers?|resins?|pigments?|agrochem\w*|catalysts?|carbon black|graphite|rare earths?|lithium)\b/i, structural: true },
  { name: 'Auto / EV components', re: /\b(?:auto(?:motive)? components?|EVs?|electric vehicles?|wheels?|forgings?|castings?|two-?wheelers?|tractors?|commercial vehicles?|OEMs?)\b/i, structural: false },
  { name: 'Capital goods / industrial machinery', re: /\b(?:capital goods|machinery|machine tools?|pumps?|valves?|compressors?|engineering|fabrication|heavy equipment|cranes?)\b/i, structural: true },
  { name: 'Infrastructure / construction / EPC', re: /\b(?:EPC|construction|infrastructure|highways?|roads?|bridges?|tunnel\w*|water (?:supply|treatment)|irrigation|smart cit\w+)\b/i, structural: true },
  { name: 'Telecom / networking', re: /\b(?:telecom|5G|network(?:ing)?|fib(?:re|er) optic|broadband|towers?)\b/i, structural: true },
  { name: 'Software / IT services / SaaS', re: /\b(?:software|SaaS|cloud|IT services|digital|cyber ?security|subscription|ARR)\b/i, structural: false },
  { name: 'Metals & mining', re: /\b(?:steel|aluminium|aluminum|copper|zinc|iron ore|mining|minerals?|coal)\b/i, structural: false },
  { name: 'Paper & packaging', re: /\b(?:paper|paperboard|packaging|kraft|corrugat\w*|pulp|labels?|flexible packaging)\b/i, structural: false },
  { name: 'Cement & building materials', re: /\b(?:cement|tiles?|sanitaryware|pipes? and fittings|plywood|laminates?|building materials?|glass)\b/i, structural: false },
  { name: 'Sugar / agri / food processing', re: /\b(?:sugar|ethanol|distiller\w*|agri\w*|fertili[sz]ers?|seeds?|edible oils?|dairy|poultry|aquaculture|tea|coffee|rice)\b/i, structural: false },
  { name: 'Power utilities & distribution', re: /\b(?:power utilit\w+|discoms?|electricity|power distribution|power generation compan\w+|independent power)\b/i, structural: true },
  { name: 'Consumer / retail / brands', re: /\b(?:consumer|FMCG|retail|stores?|brands?|apparel|footwear|jewell?ery|beverages?|foods?|restaurants?|QSR|e-?commerce)\b/i, structural: false },
  { name: 'Financials / lending', re: /\b(?:bank|NBFC|lending|loans?|AUM|insurance|asset management|broking|fintech|microfinance)\b/i, structural: false },
  { name: 'Real estate', re: /\b(?:real estate|realty|residential|housing|pre-?sales|land parcels?|REIT)\b/i, structural: false },
  { name: 'Logistics / shipping', re: /\b(?:logistics|shipping|ports?|tankers?|vessels?|freight|warehous\w+|containers?)\b/i, structural: false },
  { name: 'Textiles', re: /\b(?:textiles?|yarn|spinning|fabrics?|garments?)\b/i, structural: false },
];
export const STRUCTURAL_THEMES = new Set(THEMES.filter((t) => t.structural).map((t) => t.name));
export const OTHER_THEME = 'Other / not classified yet';

/** The theme a set of texts points to: the theme with the most words, ties to the earlier (more specific) one. Pure. */
export function themeOf(texts: Array<string | null | undefined>, industry?: string | null): { theme: string; why: string | null } {
  // the company's industry counts twice: it says what the company IS, the filing says what happened
  const hay = [industry, industry, ...texts].filter(Boolean).join(' \n ').slice(0, 6000);
  let best: { name: string; n: number; word: string } | null = null;
  for (const t of THEMES) {
    const g = new RegExp(t.re.source, 'gi');
    const hits = hay.match(g);
    if (hits && hits.length && (!best || hits.length > best.n)) best = { name: t.name, n: hits.length, word: hits[0] };
  }
  if (best) return { theme: best.name, why: `the filing / industry says "${best.word}"` };
  // zzz1167 — no table theme: the company's own industry becomes the theme (a NEW theme the table did not know), never "Other"
  const ind = String(industry || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return ind ? { theme: ind.slice(0, 60), why: 'the company\'s industry (screener)' } : { theme: OTHER_THEME, why: null };
}

// ── the multibagger read (rules; the AI read is separate and labelled as such) ──
export function multibaggerOf(x: Pick<TgItem, 'market' | 'marketCap' | 'strength' | 'facts' | 'durationYears' | 'theme' | 'evidence' | 'dilution' | 'returns' | 'kind'>): MbView {
  const plus: string[] = []; const minus: string[] = []; let s = 0;
  const cap = x.marketCap;
  if (cap != null && cap > 0) {
    const small = x.market === 'IN' ? cap < 2_000 : cap < 500, mid = x.market === 'IN' ? cap < 8_000 : cap < 2_000, upper = x.market === 'IN' ? cap < 25_000 : cap < 8_000;
    if (small) { s += 20; plus.push('small company — room for earnings and valuation to grow many times'); }
    else if (mid) { s += 14; plus.push('small-to-mid size — room to grow'); }
    else if (upper) { s += 6; plus.push('mid size'); }
    else minus.push('already large — a 5–10x is much harder from here');
  } else minus.push('size not known');
  if (x.strength === 'TRANSFORMATIONAL') { s += 20; plus.push('the event can change future earnings for years'); }
  else if (x.strength === 'INFLECTION') { s += 12; plus.push('earnings are turning up now'); }
  else s += 4;
  const f = x.facts;
  if (f.revenueYoY != null) { if (f.revenueYoY >= 40) { s += 12; plus.push(`revenue +${Math.round(f.revenueYoY)}% a year`); } else if (f.revenueYoY >= 25) { s += 8; plus.push(`revenue +${Math.round(f.revenueYoY)}% a year`); } else if (f.revenueYoY < 10) { s -= 4; minus.push(`revenue growth only ${Math.round(f.revenueYoY)}%`); } }
  if (f.patYoY != null && f.patYoY >= 60) { s += 8; plus.push(`profit +${Math.round(f.patYoY)}%`); }
  if (f.marginNow != null && f.marginPrior != null) { const d = f.marginNow - f.marginPrior; if (d >= 3) { s += 6; plus.push(`margin up ${d.toFixed(1)} points (operating leverage)`); } else if (d <= -2) { s -= 4; minus.push(`margin down ${Math.abs(d).toFixed(1)} points`); } }
  if (f.guidance && /RAISED/i.test(f.guidance)) { s += 6; plus.push('management raised its guidance'); }
  if (x.durationYears) { s += 10; plus.push('multi-year runway stated (orders / capacity / programme)'); }
  if (STRUCTURAL_THEMES.has(x.theme)) { s += 8; plus.push(`structural theme: ${x.theme}`); }
  if (x.evidence === 'official') { s += 6; plus.push('in the company\'s own filing'); } else { s -= 8; minus.push('press only — verify with the company\'s filing'); }
  if (f.cfoToPat != null) { if (f.cfoToPat < 0.5) { s -= 8; minus.push(`profit not backed by cash (cash ÷ profit ${f.cfoToPat.toFixed(2)})`); } else if (f.cfoToPat >= 1) { s += 4; plus.push('profit backed by cash'); } }
  if (x.dilution) { s -= 10; minus.push('new shares / dilution'); }
  const m3 = x.returns.m3;
  if (m3 != null) { if (m3 >= 100) { s -= 10; minus.push(`already up ${Math.round(m3)}% in 3 months — much may be priced`); } else if (m3 >= 60) { s -= 5; minus.push(`up ${Math.round(m3)}% in 3 months`); } }
  s = Math.max(0, Math.min(100, Math.round(s)));
  const label: MbLabel = s >= 65 ? 'HIGH' : s >= 45 ? 'MEDIUM' : s >= 25 ? 'LOW' : 'UNLIKELY';
  return { score: s, label, plus, minus };
}
export const MB_WORD: Record<MbLabel, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', UNLIKELY: 'Unlikely' };

// ── reading one research item ────────────────────────────────────────────────
type AnyItem = Record<string, any>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const BAD_CLASS = new Set(['NEGATIVE', 'NO_CATALYST', 'MARKET_MOVE_ONLY', 'LISTING', 'DATA_UNAVAILABLE']);

interface Hit { id: string; label: string; kind: TgKind; strong: boolean; official: boolean; date: string | null; sentence: string; url: string | null }

function hitsOf(it: AnyItem): Hit[] {
  const out: Hit[] = [];
  // zzz1168 — "only the most important": a deal counts as STRONG only when it is material to the company (an associate stake
  // going 32% → 36% is not transformational); an order counts unless it is known to be small.
  const mat = String((it.market === 'US' ? it.usCard?.material?.label : it.materiality?.label) || '').toUpperCase();
  const material = /SIGNIFICANT|MODERATE|HIGH/.test(mat), small = /SMALL|LOW/.test(mat);
  const cats: any[] = it.market === 'US' ? (it.usCard?.catalysts || []) : (it.inCard?.catalysts || []);
  for (const c of cats) {
    if (!c || c.routine || c.direction === 'negative' || c.direction === 'neutral') continue;
    if (typeof c.ageDays === 'number' && c.ageDays > 21) continue;
    const id = String(c.id || '');
    const kind = STRONG[id] ?? MEDIUM[id];
    if (!kind) continue;
    let strong = !!STRONG[id];
    if (strong && kind === 'STRATEGIC' && !material) strong = false;
    if (strong && kind === 'ORDERS' && small) strong = false;
    if (id === 'guidance' && !/rais|upgrad|increas|higher|improv/i.test(String(c.sentence || ''))) continue;   // India: only a RAISED guide
    const official = it.market === 'US' ? c.source === 'SEC' : (c.source === 'FILING' || c.confirmedByFiling === true);
    out.push({ id, label: String(c.label || id), kind, strong, official, date: c.date ?? null, sentence: String(c.sentence || ''), url: c.url ?? null });
  }
  return out;
}

function factsOf(it: AnyItem): TgFacts {
  if (it.market === 'US') {
    const e = it.usCard?.earnings;
    return {
      revenueYoY: num(e?.revenueGrowthPct), patYoY: num(e?.profitGrowthPct),
      marginNow: num(e?.margin?.cur), marginPrior: num(e?.margin?.prev), cfoToPat: null, guidance: e?.guidance ?? null,
    };
  }
  const e = it.earnings;
  return { revenueYoY: num(e?.revenueYoY), patYoY: num(e?.patYoY), marginNow: num(e?.marginNow), marginPrior: num(e?.marginPrior), cfoToPat: num(e?.cfoToPat), guidance: e?.guidance ?? null };
}

/** Earnings inflection in the FILED figures (never press). */
export function inflectionOf(f: TgFacts): string | null {
  const r = f.revenueYoY, p = f.patYoY, dm = f.marginNow != null && f.marginPrior != null ? f.marginNow - f.marginPrior : null;
  if (r != null && r >= 50) return `revenue +${Math.round(r)}%`;
  if (r != null && p != null && r >= 25 && p >= 40) return `revenue +${Math.round(r)}%, profit +${Math.round(p)}%`;
  if (r != null && dm != null && r >= 15 && dm >= 3) return `revenue +${Math.round(r)}%, margin +${dm.toFixed(1)} points`;
  return null;
}

const capOf = (it: AnyItem): number | null => {
  const v = num(it.marketCap);
  if (v == null) return null;
  return it.market === 'US' && v > 1e6 ? Math.round(v / 1e6) : v;   // US boards carry dollars; store $M
};

/** The transformational items in one session's research view. Pure. */
export function transformationalFrom(items: AnyItem[], market: TgMarket, sessionDate: string): TgItem[] {
  const out: TgItem[] = [];
  for (const it of items || []) {
    if (!it || !it.ticker || BAD_CLASS.has(String(it.eventClass)) || it.priceCommentaryOnly || it.direction === 'negative') continue;
    const hits = hitsOf({ ...it, market });
    const facts = factsOf({ ...it, market });
    const usOfficialEarnings = market === 'US' && it.usCard?.source?.tier === 'SEC';
    const inOfficialEarnings = market === 'IN' && !!it.earnings && !it.earnings.stale;
    const infl = (usOfficialEarnings || inOfficialEarnings) ? inflectionOf(facts) : null;
    const strongOff = hits.filter((h) => h.strong && h.official);
    const strongAny = hits.filter((h) => h.strong);
    // two medium events count only when they are not both just the results release (record / margin lines come with every good quarter)
    const medOff = hits.filter((h) => !h.strong && h.official && h.kind !== 'RESULTS');
    // zzz1167 (owner: "most of the multibaggers from AI Daily Gainers should be here") — a candidate is any positive event with
    // substance: a strong event, an inflection, a medium event from the company, or filed growth (sales ≥ 15% or profit ≥ 30%).
    // Strong / inflection / two medium events always stay; the rest stay when the multibagger read is at least LOW-plus (≥ 40).
    const filedGrowth = (usOfficialEarnings || inOfficialEarnings) && ((facts.revenueYoY ?? 0) >= 15 || (facts.patYoY ?? 0) >= 30);
    const core = strongAny.length > 0 || !!infl || medOff.length >= 2;
    if (!core && !medOff.length && !filedGrowth) continue;
    const lead = strongOff[0] || (infl ? null : strongAny[0]) || medOff[0] || null;
    const kind: TgKind = lead ? lead.kind : (facts.revenueYoY != null && facts.patYoY == null && /turn|profit/i.test(String(it.headline || '')) ? 'TURNAROUND' : 'RESULTS');
    const evidence: 'official' | 'press' = strongOff.length || infl || medOff.length || filedGrowth ? 'official' : 'press';
    const durationYears = it.persistence === 'YEARS' || it.potentialDuration?.value === 'YEARS';
    const matLabel = market === 'US' ? (it.usCard?.material?.label ?? null) : (it.materiality?.label ?? null);
    const significant = /SIGNIFICANT|HIGH/i.test(String(matLabel || ''));
    const strength: TgStrength = (strongOff.length && (durationYears || significant || infl)) ? 'TRANSFORMATIONAL'
      : (infl || strongOff.length) ? 'INFLECTION' : 'NOTABLE';
    const company = String(it.companyName || it.company || it.ticker);
    const th = themeOf([company, it.headline, it.whatChanged, ...hits.map((h) => h.sentence), it.quote], it.industry || it.sector || null);
    const signals = Array.from(new Set([...(infl ? [`Earnings inflection: ${infl}`] : []), ...hits.map((h) => `${h.label}${h.official ? '' : ' (press)'}`)])).slice(0, 8);
    const eventDate = (lead?.date || it.headlineFiledDate || it.filedDate || null);
    const base = {
      market, ticker: String(it.ticker).toUpperCase(), company,
      marketCap: capOf({ ...it, market }), strength, facts, durationYears, theme: th.theme, evidence, kind,
      dilution: !!it.flags?.dilution, returns: { w1: num(it.returns?.w1), m1: num(it.returns?.m1), m3: num(it.returns?.m3) },
    };
    out.push({
      ...base,
      id: `${market}:${base.ticker}:${String(eventDate || sessionDate).slice(0, 10)}:${kind}`,
      sessionDate, eventDate: eventDate ? String(eventDate).slice(0, 10) : null,
      movePct: num(it.move?.pct) ?? num(it.move1d), moveWindow: it.move?.window === '1W' ? '1W' : '1D',
      signals, headline: String(it.headline || lead?.label || '').slice(0, 300), whatChanged: it.whatChanged ? String(it.whatChanged).slice(0, 400) : null,
      quote: (lead?.sentence || it.quote || null) ? String(lead?.sentence || it.quote).slice(0, 400) : null,
      sourceUrl: lead?.url || it.sourceUrl || null, materiality: matLabel, themeWhy: th.why,
      mb: multibaggerOf(base as any),
    });
    // zzz1168 — kept: a filed STRONG event, an inflection or two medium events from the company; anything weaker (press-only,
    // one medium event, plain growth) only with a clear multibagger read (≥ 55)
    const firm = strongOff.length > 0 || !!infl || medOff.length >= 2;
    if (!firm && out[out.length - 1].mb.score < 55) out.pop();
  }
  return out;
}

// ── the 60-day board: themes, new names, ordering ────────────────────────────
export interface TgThemeRow { theme: string; structural: boolean; companies: number; events: number; firstSeen: string; lastSeen: string; isNew: boolean; tickers: string[] }
export interface TgBoard { items: TgItem[]; themes: TgThemeRow[]; newCompanies: string[]; days: number; from: string; to: string }

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The board over `days` ending `today`: newest first, themes with counts, themes and companies first seen in the last 7 days. */
export function buildBoard(all: TgItem[], today: string, days = 60): TgBoard {
  const from = addDays(today, -days), recent = addDays(today, -7);
  const items = all.filter((x) => x.sessionDate >= from && x.sessionDate <= today)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.mb.score - a.mb.score);
  const firstByTicker = new Map<string, string>();
  for (const x of all) { const k = `${x.market}:${x.ticker}`; const f = firstByTicker.get(k); if (!f || x.sessionDate < f) firstByTicker.set(k, x.sessionDate); }
  const th = new Map<string, TgThemeRow & { set: Set<string> }>();
  for (const x of items) {
    const r = th.get(x.theme) || { theme: x.theme, structural: STRUCTURAL_THEMES.has(x.theme), companies: 0, events: 0, firstSeen: x.sessionDate, lastSeen: x.sessionDate, isNew: false, tickers: [], set: new Set<string>() };
    r.events++; r.set.add(`${x.market}:${x.ticker}`);
    if (x.sessionDate < r.firstSeen) r.firstSeen = x.sessionDate; if (x.sessionDate > r.lastSeen) r.lastSeen = x.sessionDate;
    th.set(x.theme, r);
  }
  const themes = [...th.values()].map(({ set, ...r }) => ({ ...r, companies: set.size, tickers: [...set].map((k) => k.split(':')[1]), isNew: r.firstSeen >= recent && r.theme !== OTHER_THEME }))
    .sort((a, b) => b.companies - a.companies || b.events - a.events);
  const newCompanies = [...new Set(items.filter((x) => (firstByTicker.get(`${x.market}:${x.ticker}`) || '') >= recent).map((x) => `${x.market}:${x.ticker}`))];
  return { items, themes, newCompanies, days, from, to: today };
}
