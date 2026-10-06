// zzz927 — FAIR VALUE for the Guidance Upgrades focus list. Pure: no fetch, no storage, NO AI.
//
// The owner asked for the auto-valuation logic (app/(dashboard)/auto-valuation/engine.ts buildReport) on the focus-list rows. This is
// that logic shrunk to the figures the focus list already holds, so nothing new is bought or asked of a model:
//   • forward figures  = the latest full year (India) or latest quarter × 4 (USA) grown ONE year at the company's guided growth;
//   • three methods    = P/E, EV/EBITDA, P/S, each with the sector's bear / base / bull multiple band from SECTOR_CALCULATOR_MAP
//                        (secondary bands derived from the preferred multiple exactly as the engine's deriveSecondaryBands does);
//   • blend            = the engine's weights P/S 45% · P/E 35% · EV/EBITDA 20%, each times a confidence factor (HIGH 1 · MED 0.7 · LOW 0.3);
//   • guards           = the engine's plausibility gate (guided growth capped, forward / latest within 0.5×–10×), its declining-sales guard
//                        (no guided growth + falling sales → bear = continued decline, base = flat, bull = mild recovery, compressed P/S band),
//                        profit above operating profit is other income (P/E dropped), and a result outside −90% … +250% is not shown.
// A figure that is missing or implausible gives NO number and a plain reason — never a guess. Banks, NBFCs and insurers need book value,
// which is not read here, so they show no fair value. Wording: "fair value" and "upside" only (page rule: no trade words, no score out of 100).
import { SECTOR_CALCULATOR_MAP } from './valuation-calculators';

export type FvConf = 'HIGH' | 'MED' | 'LOW';
export type FvMethod = 'PE' | 'PS' | 'EV_EBITDA';
export interface Band { bear: number; base: number; bull: number }
export type Bands = { PE: Band; PS: Band; EV_EBITDA: Band };

/** The company figures the estimate reads (all public, from the skygold facts; India ₹ Cr, USA $ M). */
export interface FvFacts {
  market: 'IN' | 'US';
  price: number | null; mcap: number | null;
  /** latest full year (India) / latest quarter × 4 (USA) */ salesBase: number | null;
  /** latest full-year operating profit (India only) */ opFy: number | null;
  /** latest full-year net profit (India) / latest quarter × 4 (USA) */ patFy: number | null;
  borrowings: number | null;
  salesGrowthFy: number | null; salesCagr3y: number | null;
  sector: string | null; industry: string | null;
}
/** The guided growth of the row (company-stated preferred). */
export interface FvGrowth {
  growthPct: number | null; growthTrust: string | null; growthType?: string | null; growthMetric?: string | null; growthCohort?: string | null;
}
export interface FvCase { fair: number; upsidePct: number }
export interface FvMethodRow { method: FvMethod; label: string; weight: number; conf: FvConf; baseFair: number; band: Band }
export interface FvResult {
  ok: boolean;
  /** why there is no number (only when ok = false) */ reason: string | null;
  currency: '₹' | '$';
  price: number | null;
  base: FvCase | null; bear: FvCase | null; bull: FvCase | null;
  /** plain notes that say "check this one": upside above +150%, methods that disagree, a capped growth, falling sales … */ checks: string[];
  methods: FvMethodRow[];
  sectorLabel: string; sectorKnown: boolean;
  basis: 'guided' | 'history' | null;
  /** the growth used in each case, % */ growth: { bear: number; base: number; bull: number } | null;
  /** short plain lines on the inputs used (shown in the tooltip) */ inputs: string[];
}

// ── limits ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const GROWTH_CAP_PCT = 100;          // one-year guided growth above this is capped (engine: forward / latest ≤ 10×, a 100%+ jump is almost always a base error)
export const HIST_GROWTH_MAX = 40, HIST_GROWTH_MIN = -30;
export const UPSIDE_CHECK_PCT = 150;        // owner rule: above +150% → "check"
export const UPSIDE_MAX_PCT = 250;          // engine: above +250% is a model artifact → no number
export const UPSIDE_MIN_PCT = -90;
export const DISAGREE_RATIO = 2.5;          // highest method value ÷ lowest, base case
export const FV_WEIGHT: Record<FvMethod, number> = { PS: 0.45, PE: 0.35, EV_EBITDA: 0.2 };   // engine weights
const CONF_F: Record<FvConf, number> = { HIGH: 1, MED: 0.7, LOW: 0.3 };
const METHOD_LABEL: Record<FvMethod, string> = { PE: 'P/E', PS: 'P/S', EV_EBITDA: 'EV/EBITDA' };

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

// ── sector ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Banks, NBFCs, insurers and the like are valued on book value, which the focus list does not read. */
const FINANCIAL = /\bbanks?\b|\bnbfc\b|non[- ]?banking|insurance|insurer|housing finance|financial institution|microfinance|consumer finance|\bfinance\b|\blending\b|savings institution|credit services|mortgage/i;
export function isFinancialText(text: string): boolean { return FINANCIAL.test(text); }

/** Ordered: first match wins. Words are screener.in / Nasdaq industry names; the value is a SECTOR_CALCULATOR_MAP key. */
const SECTOR_WORDS: Array<[RegExp, string]> = [
  [/defen[cs]e|aerospace|military/i, 'Defence'],
  [/bulk drug|\bapi\b|active pharma/i, 'API / Bulk Drugs'],
  [/pharma|drug|biotech|medicinal/i, 'Pharmaceuticals'],
  [/hospital/i, 'Hospitals / Healthcare Services'],
  [/diagnos|pathology/i, 'Diagnostics & Pathology'],
  [/agrochem|pesticide|fertili[sz]er|crop protection/i, 'Agrochemicals & Crop Protection'],
  [/chemical/i, 'Specialty Chemicals'],
  [/auto (?:components|ancillar|parts)|auto parts|tyre|tire|motor vehicle parts/i, 'Auto Components'],
  [/cement/i, 'Cement'],
  [/\bsteel|\biron\b|alumin|copper|zinc|metals?\b/i, 'Steel & Metals'],
  [/mining|\bcoal\b|minerals?\b/i, 'Mining'],
  [/textile|apparel|garment|\bfabric|cotton/i, 'Textiles & Apparel'],
  [/hotel|resort|hospitality|lodging/i, 'Hotels & Hospitality'],
  [/airline|aviation|air transport/i, 'Aviation'],
  [/logistic|courier|freight|warehous|shipping|marine port/i, 'Logistics & Warehousing'],
  [/sugar/i, 'Sugar / Agri Processing'],
  [/telecom|wireless/i, 'Telecom'],
  [/renewable|solar|\bwind\b/i, 'Renewable Energy'],
  [/power generation|electric utilit|power utilit|independent power/i, 'Power Utility (Generation)'],
  [/transmission|electrical equipment|power equipment/i, 'Power / Transmission'],
  [/edible oil|oilseed|solvent extraction|food|agri/i, 'Consumer Durables / FMCG'],
  [/gas distribution|city gas|natural gas distribution/i, 'Gas Distribution / CGD'],
  [/refiner|oil marketing|petroleum products/i, 'Oil & Gas — Refining & Marketing'],
  [/oil|gas explor|exploration|crude|petroleum/i, 'Oil & Gas — Upstream'],
  [/railway|\brail\b/i, 'Rail / Metro / Mobility'],
  [/real estate|realty|construction|engineering & construction|infrastructure/i, 'Real Estate / Construction'],
  [/brew|distill|liquor|alcohol|spirits|wine/i, 'Breweries / Distilleries'],
  [/tobacco|cigarette/i, 'Tobacco / Cigarettes'],
  [/\btea\b|coffee|plantation/i, 'Plantations / Tea / Coffee'],
  [/media|broadcast|publishing|print|entertainment/i, 'Media / Print / Broadcasting'],
  [/education|edtech|training/i, 'Education / Edtech'],
  [/retail|e-?commerce|department store|internet retail/i, 'Retail & E-Commerce'],
  [/consumer durables|jewel|watches|fmcg|household|personal care|packaged food|food products|beverage|footwear|consumer staples/i, 'Consumer Durables / FMCG'],
  [/prepackaged software|software|it services|information technology|computer services|it consulting/i, 'IT / Tech Services'],
  [/capital goods|machinery|industrial|equipment|electrical|electronics|engineering|manufactur/i, 'Industrials / Capital Goods'],
];
export function sectorOf(industry: string | null | undefined, sector: string | null | undefined, _company?: string | null): { key: string | null; label: string } {
  const text = `${industry || ''} ${sector || ''}`.trim();
  if (text) for (const [re, key] of SECTOR_WORDS) if (re.test(text)) return { key, label: key };
  return { key: null, label: text ? `${industry || sector} (no sector band — generic multiples)` : 'sector not known (generic multiples)' };
}

// ── multiple bands (the engine's, kept in step by hand — engine.ts lines ~1150-1200) ────────────────────────────────────────────
function deriveSecondary(primary: FvMethod, mid: number, sec: string): Partial<Bands> {
  const rnd = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
  if (primary === 'EV_EBITDA') return { PE: { bear: rnd(mid * 1.0), base: rnd(mid * 1.4), bull: rnd(mid * 1.9) }, PS: { bear: rnd(mid * 0.08, 2), base: rnd(mid * 0.12, 2), bull: rnd(mid * 0.18, 2) } };
  if (primary === 'PE') {
    const f = /Defence|FMCG|Insurance|Pharma|AI Infra|Rail/i.test(sec) ? 0.22 : 0.14;
    return { EV_EBITDA: { bear: rnd(mid * 0.5), base: rnd(mid * 0.7), bull: rnd(mid * 0.95) }, PS: { bear: rnd(mid * f * 0.7, 2), base: rnd(mid * f, 2), bull: rnd(mid * f * 1.6, 2) } };
  }
  return { PE: { bear: rnd(mid * 5), base: rnd(mid * 8), bull: rnd(mid * 15) }, EV_EBITDA: { bear: rnd(mid * 3), base: rnd(mid * 5), bull: rnd(mid * 8) } };
}
/** The bear / base / bull multiples for each method. `declining` compresses the generic P/S band (engine: sales falling). */
export function bandsFor(sectorKey: string | null, declining: boolean): Bands {
  const b: Bands = {
    PE: { bear: 18, base: 25, bull: 35 },
    PS: declining ? { bear: 0.8, base: 1.5, bull: 2.5 } : { bear: 2, base: 3.5, bull: 6 },
    EV_EBITDA: { bear: 10, base: 14, bull: 20 },
  };
  const conf = sectorKey ? SECTOR_CALCULATOR_MAP[sectorKey] : undefined;
  const m = conf ? /(\d+)\s*-\s*(\d+)/.exec(conf.multipleHint) : null;
  if (conf && m) {
    const lo = parseInt(m[1], 10), hi = parseInt(m[2], 10), mid = Math.round((lo + hi) / 2);
    const sec = deriveSecondary(conf.calc, mid, sectorKey || '');
    if (sec.PE) b.PE = sec.PE as Band; if (sec.PS) b.PS = sec.PS as Band; if (sec.EV_EBITDA) b.EV_EBITDA = sec.EV_EBITDA as Band;
    b[conf.calc] = { bear: lo, base: mid, bull: hi };
  }
  return b;
}

// ── growth ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const REVENUE_METRICS = new Set(['REVENUE', 'REVENUE_GROWTH', 'ORGANIC_GROWTH']);
const PROFIT_METRICS = new Set(['PAT', 'NET_PROFIT', 'EPS', 'ADJ_EPS', 'EBITDA', 'EBIT']);
export type GrowthClass = 'revenue' | 'profit' | 'other';
export const growthClass = (metric: string | null | undefined): GrowthClass => (REVENUE_METRICS.has(String(metric || '')) ? 'revenue' : PROFIT_METRICS.has(String(metric || '')) ? 'profit' : 'other');

/** zzz929: the one place that decides which guided growth is usable for a one-year projection (verified / derived, above zero, capped at GROWTH_CAP_PCT)
 *  and whether it is a sales or a profit rate. gu-opportunity reads the same function, so the implied-profit math cannot drift from the fair-value math. */
export function statedGrowth(g: FvGrowth | null | undefined): { raw: number; base: number; capped: boolean; cls: GrowthClass } | null {
  if (!g || !fin(g.growthPct) || g.growthPct <= 0 || !(g.growthTrust === 'verified' || g.growthTrust === 'derived')) return null;
  return { raw: g.growthPct, base: Math.min(g.growthPct, GROWTH_CAP_PCT), capped: g.growthPct > GROWTH_CAP_PCT, cls: growthClass(g.growthMetric) };
}

const none = (reason: string, currency: '₹' | '$', price: number | null, extra: Partial<FvResult> = {}): FvResult => ({
  ok: false, reason, currency, price, base: null, bear: null, bull: null, checks: [], methods: [], sectorLabel: '', sectorKnown: false, basis: null, growth: null, inputs: [], ...extra,
});

/** Pure: a base-case (with bear / bull) fair value per share for one focus-list row, or a plain reason why there is none. */
export function fairValue(f: FvFacts | null | undefined, g: FvGrowth | null | undefined, company?: string | null): FvResult {
  const currency: '₹' | '$' = f?.market === 'US' ? '$' : '₹';
  if (!f) return none('company figures not read yet', currency, null);
  const price = fin(f.price) && f.price > 0 ? f.price : null;
  const unit = f.market === 'US' ? 'M' : ' Cr';
  const money = (v: number) => (f.market === 'US' ? `$${Math.round(v).toLocaleString('en-US')}M` : `₹${Math.round(v).toLocaleString('en-IN')} Cr`);
  const sec = sectorOf(f.industry, f.sector, company);
  const text = `${f.industry || ''} ${f.sector || ''}`;
  if (isFinancialText(text) || (sec.key && /Financial Services|Insurance/.test(sec.key))) return none('a bank, lender or insurer is valued on book value, which is not read here', currency, price, { sectorLabel: sec.label });
  if (price == null) return none('share price not available', currency, price, { sectorLabel: sec.label });
  if (!fin(f.mcap) || f.mcap <= 0) return none('market value not available', currency, price, { sectorLabel: sec.label });
  if (!fin(f.salesBase) || f.salesBase <= 0) return none('yearly sales not available', currency, price, { sectorLabel: sec.label });
  const sales = f.salesBase;
  const pat = fin(f.patFy) ? f.patFy : null;
  const ebitda = f.market === 'IN' && fin(f.opFy) ? f.opFy : null;
  const checks: string[] = [];
  const inputs: string[] = [];

  // ── growth: company-stated preferred; one year forward ──────────────────────────────────────────────────────────────────
  const sg0 = statedGrowth(g);
  const stated = sg0 ? g! : null;
  const cls = sg0 ? sg0.cls : 'other';
  const histKnown = [f.salesGrowthFy, f.salesCagr3y].filter(fin) as number[];
  const hist = histKnown.length ? histKnown.reduce((a, b) => a + b, 0) / histKnown.length : null;
  const salesFalling = fin(f.salesGrowthFy) ? f.salesGrowthFy < 0 : fin(f.salesCagr3y) ? f.salesCagr3y < 0 : false;
  let basis: 'guided' | 'history';
  let gs: { bear: number; base: number; bull: number };
  let useCls: GrowthClass;
  if (stated && cls !== 'other') {
    basis = 'guided'; useCls = cls;
    const raw = sg0!.raw;
    const base = sg0!.base;
    if (sg0!.capped) checks.push(`guided growth ${r1(raw)}% capped at ${GROWTH_CAP_PCT}% for one year`);
    gs = { bear: r1(base * 0.5), base: r1(base), bull: r1(Math.min(base * 1.15, GROWTH_CAP_PCT)) };
    inputs.push(`growth ${r1(base)}% (${stated.growthType === 'DERIVED' || stated.growthTrust === 'derived' ? 'worked out from company numbers' : 'stated by the company'}${stated.growthCohort === 'MULTI_YEAR_CAGR' ? ', a yearly pace from a multi-year plan' : ''}), applied to ${cls === 'revenue' ? 'sales' : 'profit'} for one year; bear half of it, bull +15%`);
    if (salesFalling) checks.push('reported sales fell last year');
  } else {
    // no usable guided growth (a raise-only row, or growth of a measure that is not sales or profit): the engine's historical fallback
    basis = 'history'; useCls = 'revenue';
    if (hist == null) return none('no growth rate guided and no sales history to project from', currency, price, { sectorLabel: sec.label });
    const h = Math.max(HIST_GROWTH_MIN, Math.min(HIST_GROWTH_MAX, hist));
    if (h < 0) gs = { bear: r1(h), base: 0, bull: 5 };   // declining-sales guard: continued decline / flat / mild recovery
    else gs = { bear: r1(h * 0.5), base: r1(h), bull: r1(Math.min(h * 1.25, HIST_GROWTH_MAX)) };
    inputs.push(`no company growth rate to use — past sales pace ${r1(h)}% a year used (lower confidence)${h < 0 ? '; sales falling, so base case is flat' : ''}`);
    if (stated && cls === 'other') inputs.push(`guided ${stated.growthMetric || 'measure'} growth is not a sales or profit growth rate and was not used`);
    if (h < 0) checks.push('reported sales are falling');
  }

  // ── plausibility gate (engine): forward / latest within 0.5× … 10× ──────────────────────────────────────────────────────
  for (const k of ['bear', 'base', 'bull'] as const) {
    const ratio = 1 + gs[k] / 100;
    if (ratio < 0.5 || ratio > 10) return none(`projected figures are ${r1(ratio)}× the latest — outside the plausible range`, currency, price, { sectorLabel: sec.label });
  }

  // ── what each method reads ──────────────────────────────────────────────────────────────────────────────────────────────
  const declining = basis === 'history' ? gs.base <= 0 : salesFalling;
  const bands = bandsFor(sec.key, declining);
  const patOk = pat != null && pat > 0 && !(ebitda != null && pat > ebitda);   // profit above operating profit = other income / one-offs
  if (pat != null && pat > 0 && !patOk) inputs.push('net profit is above operating profit (other income) — P/E not used');
  if (pat == null || pat <= 0) inputs.push(pat == null ? 'net profit not read — P/E not used' : 'loss-making — P/E not used');
  const ebitdaOk = ebitda != null && ebitda > 0 && fin(f.borrowings);
  if (f.market === 'US') inputs.push('USA: latest quarter × 4 used as the yearly base; EV/EBITDA not used (no depreciation figure read)');
  else if (!ebitdaOk) inputs.push(ebitda == null ? 'operating profit not read — EV/EBITDA not used' : ebitda <= 0 ? 'operating loss — EV/EBITDA not used' : 'borrowings not read — EV/EBITDA not used');
  const m1 = useCls === 'revenue';
  const conf: Record<FvMethod, FvConf> = m1
    ? { PS: basis === 'guided' ? 'HIGH' : 'MED', PE: basis === 'guided' ? 'MED' : 'LOW', EV_EBITDA: 'MED' }
    : { PS: 'LOW', PE: 'HIGH', EV_EBITDA: stated && /EBITDA|EBIT/.test(String(stated.growthMetric)) ? 'HIGH' : 'MED' };
  if (f.market === 'US') for (const k of ['PS', 'PE'] as const) conf[k] = conf[k] === 'HIGH' ? 'MED' : conf[k] === 'MED' ? 'LOW' : 'LOW';   // a one-quarter run-rate: one notch lower
  if (!sec.key) for (const k of ['PS', 'PE', 'EV_EBITDA'] as const) conf[k] = conf[k] === 'HIGH' ? 'MED' : conf[k] === 'MED' ? 'LOW' : 'LOW';   // generic band: one notch lower

  // equity value of each method in each case (same unit as the market value)
  const equity = (m: FvMethod, k: 'bear' | 'base' | 'bull'): number | null => {
    const gr = 1 + gs[k] / 100;
    const mult = bands[m][k];
    if (m === 'PS') return m1 ? sales * gr * mult : null;                                  // a profit-only growth gives no sales projection
    if (m === 'PE') return patOk ? (pat as number) * gr * mult : null;
    if (m === 'EV_EBITDA') { if (!ebitdaOk || f.market !== 'IN') return null; const v = (ebitda as number) * gr * mult - (f.borrowings as number); return v > 0 ? v : null; }
    return null;
  };
  const rows: FvMethodRow[] = [];
  for (const m of ['PS', 'PE', 'EV_EBITDA'] as const) {
    const e = equity(m, 'base'); if (e == null) continue;
    rows.push({ method: m, label: METHOD_LABEL[m], weight: FV_WEIGHT[m] * CONF_F[conf[m]], conf: conf[m], baseFair: r2(price * (e / f.mcap!)), band: bands[m] });
  }
  if (rows.length < 2) return none(`only ${rows.length} valuation method could be worked${rows[0] ? ` (${rows[0].label})` : ''} — not enough to cross-check`, currency, price, { sectorLabel: sec.label, inputs, basis });
  const blend = (k: 'bear' | 'base' | 'bull'): number => {
    let w = 0, s = 0;
    for (const r of rows) { const e = equity(r.method, k) as number; w += r.weight; s += r.weight * e; }
    return s / w;
  };
  const mcap = f.mcap;
  const mk = (k: 'bear' | 'base' | 'bull'): FvCase => { const eq = blend(k); return { fair: r2(price * (eq / mcap)), upsidePct: r1((eq / mcap - 1) * 100) }; };
  const base = mk('base'), bear = mk('bear'), bull = mk('bull');
  if (!Number.isFinite(base.fair) || !Number.isFinite(base.upsidePct)) return none('the figures did not produce a usable number', currency, price, { sectorLabel: sec.label, inputs, basis });
  if (base.upsidePct > UPSIDE_MAX_PCT) return none(`the model gives more than +${UPSIDE_MAX_PCT}% — almost certainly an input or sector-band error, so no number is shown`, currency, price, { sectorLabel: sec.label, inputs, basis, methods: rows });
  if (base.upsidePct < UPSIDE_MIN_PCT) return none(`the model gives below ${UPSIDE_MIN_PCT}% — the market multiple is far above the sector band, so no number is shown`, currency, price, { sectorLabel: sec.label, inputs, basis, methods: rows });

  // ── "check" flags ───────────────────────────────────────────────────────────────────────────────────────────────────────
  if (base.upsidePct > UPSIDE_CHECK_PCT) checks.push(`upside above +${UPSIDE_CHECK_PCT}%`);
  if (base.upsidePct < -60) checks.push('far below the market price — the sector band may not fit this company');
  const vals = rows.map((r) => r.baseFair).filter((v) => v > 0);
  if (vals.length >= 2 && Math.max(...vals) / Math.min(...vals) > DISAGREE_RATIO) checks.push(`methods disagree (${rows.map((r) => `${r.label} ${currency}${r.baseFair.toLocaleString(f.market === 'US' ? 'en-US' : 'en-IN')}`).join(' · ')})`);
  if (!sec.key) checks.push('no sector band — generic multiples used');
  if (basis === 'history') checks.push('based on past sales growth, not company guidance');
  inputs.push(`price ${currency}${price.toLocaleString(f.market === 'US' ? 'en-US' : 'en-IN')} · market value ${money(f.mcap)} · yearly sales ${money(sales)}${pat != null ? ` · net profit ${money(pat)}` : ''}${ebitda != null ? ` · operating profit ${money(ebitda)}` : ''}${fin(f.borrowings) ? ` · borrowings ${money(f.borrowings)}` : ''}`);
  inputs.push(`sector: ${sec.label}`);
  void unit;
  return { ok: true, reason: null, currency, price, base, bear, bull, checks, methods: rows, sectorLabel: sec.label, sectorKnown: !!sec.key, basis, growth: gs, inputs };
}

// ── words for the tooltip ──────────────────────────────────────────────────────────────────────────────────────────────────
const sg = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
export function fvTooltip(r: FvResult): string {
  if (!r.ok) return `No fair value: ${r.reason}.${r.inputs.length ? `\n${r.inputs.join('\n')}` : ''}`;
  const loc = r.currency === '$' ? 'en-US' : 'en-IN';
  const p = (c: FvCase | null) => (c ? `${r.currency}${c.fair.toLocaleString(loc)} (${sg(c.upsidePct)})` : '—');
  const lines = [
    `Fair value for the next fiscal year at the sector's usual multiples.`,
    `Bear ${p(r.bear)} · Base ${p(r.base)} · Bull ${p(r.bull)}`,
    `Methods: ${r.methods.map((m) => `${m.label} ${m.band.bear}–${m.band.base}–${m.band.bull}× (base ${r.currency}${m.baseFair.toLocaleString(loc)}, ${Math.round(m.weight * 100)}% weight, ${m.conf.toLowerCase()} confidence)`).join('; ')}`,
    ...r.inputs,
  ];
  if (r.checks.length) lines.push(`Check: ${r.checks.join('; ')}`);
  lines.push('Not advice. Estimate from public figures, no model call.');
  return lines.join('\n');
}
export const fmtPrice = (v: number | null | undefined, cur: '₹' | '$'): string => (typeof v === 'number' && Number.isFinite(v) ? `${cur}${v.toLocaleString(cur === '$' ? 'en-US' : 'en-IN', { maximumFractionDigits: v >= 100 ? 0 : 2 })}` : '—');
export const fmtUpside = (v: number): string => `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
