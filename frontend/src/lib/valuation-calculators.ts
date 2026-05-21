// ═══════════════════════════════════════════════════════════════════════════
// VALUATION CALCULATORS (PATCH 0628)
//
// Pure-function institutional valuation helpers. Three calculator families:
//   1. P/S target           — best for growth / SaaS / capex-heavy
//   2. P/E target            — best for FMCG, quality compounders
//   3. EV/EBITDA target     — best for cyclicals, industrials, leveraged
//
// Each takes management guidance + a multiple range and returns market cap
// projection + implied upside annualized over the horizon. Bear / base /
// bull cases derive from a multiple band.
//
// All values in INR Crore unless noted. The /valuations page consumes these.
// ═══════════════════════════════════════════════════════════════════════════

export interface ValuationInput {
  ticker?: string;
  company?: string;
  currentMarketCapCr: number;
  horizonMonths: number; // typically 12, 18, 24
  // PATCH 0631 — auto-populated from /api/market/quotes when ticker is entered.
  // If present we also compute target stock price + upside in price space.
  currentPrice?: number;       // in rupees (or dollars for US)
  sharesOutstandingCr?: number; // in crores; derived as currentMarketCapCr / currentPrice when not provided
  currency?: '₹' | '$';        // display only
}

export interface PSInput extends ValuationInput {
  forwardRevenueCr: number;  // FY27 / FY28 guidance revenue
  bearPS: number;            // e.g. 8
  basePS: number;            // 5-year median, e.g. 11.4
  bullPS: number;            // e.g. 15
}

export interface PEInput extends ValuationInput {
  forwardPATCr: number;      // FY27 PAT
  bearPE: number;            // e.g. 20
  basePE: number;            // 3yr median, e.g. 25
  bullPE: number;            // e.g. 30
}

export interface EvEbitdaInput extends ValuationInput {
  forwardEBITDACr: number;
  bearMultiple: number;
  baseMultiple: number;
  bullMultiple: number;
  netDebtCr?: number;        // subtract from EV to get equity value
}

export interface CalculatorCase {
  label: 'BEAR' | 'BASE' | 'BULL';
  marketCapCr: number;
  upsidePct: number;
  annualizedPct: number;
  color: string;
  // PATCH 0631 — when input.currentPrice is supplied, populate target stock price.
  currentPrice?: number;
  targetPrice?: number;
  currency?: '₹' | '$';
}

export interface CalculatorResult {
  ticker?: string;
  company?: string;
  cases: CalculatorCase[];
  baseSummary: string;       // one-liner
  inputs: any;
}

const annualize = (totalPct: number, months: number) => {
  if (months <= 0) return totalPct;
  // simple CAGR-style annualization
  const years = months / 12;
  const factor = 1 + totalPct / 100;
  if (factor <= 0) return totalPct;
  return (Math.pow(factor, 1 / years) - 1) * 100;
};

const colorFor = (pct: number) =>
  pct >= 50 ? '#10B981' : pct >= 25 ? '#22D3EE' : pct >= 0 ? '#F59E0B' : '#EF4444';

const buildCases = (
  label: 'BEAR' | 'BASE' | 'BULL',
  marketCapCr: number,
  current: number,
  months: number,
  opts?: { currentPrice?: number; sharesOutstandingCr?: number; currency?: '₹' | '$' },
): CalculatorCase => {
  const upsidePct = ((marketCapCr - current) / current) * 100;
  let targetPrice: number | undefined;
  if (opts?.currentPrice && opts?.sharesOutstandingCr && opts.sharesOutstandingCr > 0) {
    targetPrice = marketCapCr / opts.sharesOutstandingCr;  // both in Cr -> price in rupees/dollars
  }
  return {
    label,
    marketCapCr,
    upsidePct,
    annualizedPct: annualize(upsidePct, months),
    color: colorFor(upsidePct),
    currentPrice: opts?.currentPrice,
    targetPrice,
    currency: opts?.currency || '₹',
  };
};

/** Derive shares-outstanding-in-Cr from market-cap-in-Cr + price.
 *  marketCap (Cr) = price (₹) × shares (Cr) → shares = marketCap / price.
 */
function deriveShares(input: ValuationInput): number | undefined {
  if (input.sharesOutstandingCr) return input.sharesOutstandingCr;
  if (input.currentPrice && input.currentPrice > 0) return input.currentMarketCapCr / input.currentPrice;
  return undefined;
}

// ─── 1. P/S Calculator ──────────────────────────────────────────────────
export function calculatePS(input: PSInput): CalculatorResult {
  const { forwardRevenueCr, bearPS, basePS, bullPS, currentMarketCapCr, horizonMonths } = input;
  const shares = deriveShares(input);
  const opts = { currentPrice: input.currentPrice, sharesOutstandingCr: shares, currency: input.currency };
  const cases: CalculatorCase[] = [
    buildCases('BEAR', forwardRevenueCr * bearPS, currentMarketCapCr, horizonMonths, opts),
    buildCases('BASE', forwardRevenueCr * basePS, currentMarketCapCr, horizonMonths, opts),
    buildCases('BULL', forwardRevenueCr * bullPS, currentMarketCapCr, horizonMonths, opts),
  ];
  const base = cases.find(c => c.label === 'BASE')!;
  const baseSummary = `At base ${basePS.toFixed(1)}x P/S on ₹${forwardRevenueCr} Cr forward revenue → ₹${Math.round(base.marketCapCr).toLocaleString()} Cr market cap = ${base.upsidePct >= 0 ? '+' : ''}${base.upsidePct.toFixed(0)}% upside over ${horizonMonths} months (${base.annualizedPct >= 0 ? '+' : ''}${base.annualizedPct.toFixed(0)}% CAGR).`;
  return { ticker: input.ticker, company: input.company, cases, baseSummary, inputs: input };
}

// ─── 2. P/E Calculator ──────────────────────────────────────────────────
export function calculatePE(input: PEInput): CalculatorResult {
  const { forwardPATCr, bearPE, basePE, bullPE, currentMarketCapCr, horizonMonths } = input;
  const shares = deriveShares(input);
  const opts = { currentPrice: input.currentPrice, sharesOutstandingCr: shares, currency: input.currency };
  const cases: CalculatorCase[] = [
    buildCases('BEAR', forwardPATCr * bearPE, currentMarketCapCr, horizonMonths, opts),
    buildCases('BASE', forwardPATCr * basePE, currentMarketCapCr, horizonMonths, opts),
    buildCases('BULL', forwardPATCr * bullPE, currentMarketCapCr, horizonMonths, opts),
  ];
  const base = cases.find(c => c.label === 'BASE')!;
  const baseSummary = `At base ${basePE}x P/E on ₹${forwardPATCr} Cr forward PAT → ₹${Math.round(base.marketCapCr).toLocaleString()} Cr market cap = ${base.upsidePct >= 0 ? '+' : ''}${base.upsidePct.toFixed(0)}% upside over ${horizonMonths} months (${base.annualizedPct >= 0 ? '+' : ''}${base.annualizedPct.toFixed(0)}% CAGR).`;
  return { ticker: input.ticker, company: input.company, cases, baseSummary, inputs: input };
}

// ─── 3. EV/EBITDA Calculator ─────────────────────────────────────────────
export function calculateEvEbitda(input: EvEbitdaInput): CalculatorResult {
  const { forwardEBITDACr, bearMultiple, baseMultiple, bullMultiple, currentMarketCapCr, horizonMonths } = input;
  const netDebt = input.netDebtCr || 0;
  const shares = deriveShares(input);
  const opts = { currentPrice: input.currentPrice, sharesOutstandingCr: shares, currency: input.currency };
  const buildEv = (mult: number) => Math.max(0, forwardEBITDACr * mult - netDebt);
  const cases: CalculatorCase[] = [
    buildCases('BEAR', buildEv(bearMultiple), currentMarketCapCr, horizonMonths, opts),
    buildCases('BASE', buildEv(baseMultiple), currentMarketCapCr, horizonMonths, opts),
    buildCases('BULL', buildEv(bullMultiple), currentMarketCapCr, horizonMonths, opts),
  ];
  const base = cases.find(c => c.label === 'BASE')!;
  const baseSummary = `At base ${baseMultiple}x EV/EBITDA on ₹${forwardEBITDACr} Cr EBITDA${netDebt ? ` (net debt ₹${netDebt} Cr)` : ''} → equity value ₹${Math.round(base.marketCapCr).toLocaleString()} Cr = ${base.upsidePct >= 0 ? '+' : ''}${base.upsidePct.toFixed(0)}% upside over ${horizonMonths} months.`;
  return { ticker: input.ticker, company: input.company, cases, baseSummary, inputs: input };
}

// ─── Quote auto-fetch (PATCH 0631) ──────────────────────────────────────
/** Fetches current price + market cap for an India ticker via /api/market/quotes.
 *  Multiple fallbacks: stock-sheet enrich → user manual override.
 *  Returns null on failure; UI keeps the user's manual inputs intact. */
export interface QuoteAutoFill {
  ticker: string;
  company?: string;
  currentPrice?: number;
  currentMarketCapCr?: number;
  sharesOutstandingCr?: number;
  currency?: '₹' | '$';
  source?: string;
}

// ─── Saved Valuations (PATCH 0633) ──────────────────────────────────────
// Persists user's valuation runs in localStorage so they can come back,
// review, edit, or delete. Cross-tab sync via 'mc:valuations-updated'.
const SAVED_VAL_KEY = 'mc:saved-valuations:v1';

export interface SavedValuation {
  id: string;
  savedAt: string;            // ISO timestamp
  calcKind: 'PS' | 'PE' | 'EV_EBITDA';
  ticker?: string;
  company?: string;
  inputs: any;                // PSInput | PEInput | EvEbitdaInput at save time
  baseSummary: string;
  notes?: string;
}

export function loadSavedValuations(): SavedValuation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_VAL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedValuation[];
    if (!Array.isArray(arr)) return [];
    return arr.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  } catch { return []; }
}

export function saveValuation(v: Omit<SavedValuation, 'id' | 'savedAt'> & { id?: string }): SavedValuation {
  const full: SavedValuation = {
    ...v,
    id: v.id || `val-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: new Date().toISOString(),
  };
  const all = loadSavedValuations();
  const filtered = all.filter(x => x.id !== full.id);
  filtered.unshift(full);
  // keep most-recent 100
  const trimmed = filtered.slice(0, 100);
  if (typeof window !== 'undefined') {
    localStorage.setItem(SAVED_VAL_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent('mc:valuations-updated'));
  }
  return full;
}

export function deleteValuation(id: string): void {
  const all = loadSavedValuations();
  const filtered = all.filter(x => x.id !== id);
  if (typeof window !== 'undefined') {
    localStorage.setItem(SAVED_VAL_KEY, JSON.stringify(filtered));
    window.dispatchEvent(new CustomEvent('mc:valuations-updated'));
  }
}

export async function fetchQuoteAutofill(ticker: string, market: 'india' | 'us' = 'india'): Promise<QuoteAutoFill | null> {
  if (!ticker) return null;
  const t = ticker.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  const currency: '₹' | '$' = market === 'us' ? '$' : '₹';

  // Primary: /api/market/quotes
  try {
    const r = await fetch(`/api/market/quotes?market=${market}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const stocks: any[] = j?.stocks || [];
      const hit = stocks.find((s) => (s.ticker || '').toUpperCase() === t);
      if (hit && hit.price) {
        // marketCap in API returns absolute rupees → convert to crore for India
        const marketCapCr = market === 'india'
          ? (hit.marketCap || 0) / 1e7
          : (hit.marketCap || 0) / 1e7;
        return {
          ticker: t,
          company: hit.company,
          currentPrice: hit.price,
          currentMarketCapCr: marketCapCr || undefined,
          sharesOutstandingCr: marketCapCr && hit.price ? marketCapCr / hit.price : undefined,
          currency,
          source: 'api/market/quotes',
        };
      }
    }
  } catch {}

  // Fallback: stock-sheet enrich endpoint
  try {
    const r = await fetch(`/api/v1/earnings/enrich?symbol=${encodeURIComponent(t)}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const price = j?.cmp || j?.price;
      const mcap = j?.market_cap_cr || j?.marketCapCr;
      if (price && mcap) {
        return {
          ticker: t,
          company: j?.company,
          currentPrice: price,
          currentMarketCapCr: mcap,
          sharesOutstandingCr: mcap / price,
          currency,
          source: 'api/v1/earnings/enrich',
        };
      }
    }
  } catch {}

  return null;
}

// ─── WORKED EXAMPLES (from user's case studies) ─────────────────────────
// Used as defaults / examples in the UI so the user can see realistic
// inputs and tweak from there.
export const WORKED_EXAMPLES = {
  rubicon: {
    label: 'Rubicon Research — P/S, 18m',
    type: 'PS' as const,
    input: {
      ticker: 'RUBICON', company: 'Rubicon Research',
      currentMarketCapCr: 21000,
      horizonMonths: 18,
      forwardRevenueCr: 2995,
      bearPS: 8, basePS: 11.4, bullPS: 15,
    },
  },
  bajajConsumer: {
    label: 'Bajaj Consumer — P/E, 12m (FMCG)',
    type: 'PE' as const,
    input: {
      ticker: 'BAJAJCON', company: 'Bajaj Consumer Care',
      currentMarketCapCr: 2700,
      horizonMonths: 12,
      forwardPATCr: 190,
      bearPE: 20, basePE: 24, bullPE: 30,
    },
  },
  tdPower: {
    label: 'TD Power — P/E on FY27, 18m',
    type: 'PE' as const,
    input: {
      ticker: 'TDPOWERSYS', company: 'TD Power Systems',
      currentMarketCapCr: 8000,
      horizonMonths: 18,
      forwardPATCr: 400,
      bearPE: 30, basePE: 44.4, bullPE: 55,
    },
  },
  sterlite: {
    label: 'Sterlite — P/E with AI re-rating, 18m',
    type: 'PE' as const,
    input: {
      ticker: 'STRTECH', company: 'Sterlite Technologies',
      currentMarketCapCr: 12000,
      horizonMonths: 18,
      forwardPATCr: 400,
      bearPE: 30, basePE: 48, bullPE: 60,
    },
  },
  aeroflex: {
    label: 'Aeroflex — P/E on FY27, 18m',
    type: 'PE' as const,
    input: {
      ticker: 'AEROFLEX', company: 'Aeroflex Industries',
      currentMarketCapCr: 5047,
      horizonMonths: 18,
      forwardPATCr: 95,
      bearPE: 45, basePE: 60, bullPE: 80,
    },
  },
  atlantaElectricals: {
    label: 'Atlanta Electricals — P/E on FY27, 18m',
    type: 'PE' as const,
    input: {
      ticker: 'ATLANTAELE', company: 'Atlanta Electricals',
      currentMarketCapCr: 12000,
      horizonMonths: 18,
      forwardPATCr: 335,
      bearPE: 28, basePE: 36, bullPE: 50,
    },
  },
  deeDev: {
    label: 'DEE Development — P/E on FY27 management guidance',
    type: 'PE' as const,
    input: {
      ticker: 'DEEDEV', company: 'DEE Development Engineers',
      currentMarketCapCr: 3136,
      horizonMonths: 18,
      forwardPATCr: 100,           // 18-19% EBITDA margin on ₹1500 Cr -> ₹270 Cr EBITDA -> ~₹100 Cr PAT
      bearPE: 25, basePE: 35, bullPE: 50,
    },
  },
};

// ─── Sector → recommended calculator + 5 institutional examples ────────
// Examples drawn from names actually discussed in the portal (Multibagger
// CSV, Critical Themes leaders, Conviction Beats, chat history). Quick
// pattern-match: pick the row that matches your name's sector → use the
// listed calculator → benchmark against the multiple hint range.
export const SECTOR_CALCULATOR_MAP: Record<string, { calc: 'PS' | 'PE' | 'EV_EBITDA'; multipleHint: string; examples: string[] }> = {
  'Industrials / Capital Goods':  { calc: 'PE',         multipleHint: 'PE 25-45x · cycle peaks compress to 18-22x',
                                    examples: ['DEEDEV (DEE Development)', 'TDPOWERSYS (TD Power)', 'AEROFLEX (Aeroflex Industries)', 'TRITURBINE (Triveni Turbine)', 'AXTEL (Axtel Industries)'] },
  'Defence':                      { calc: 'PE',         multipleHint: 'PE 30-50x · order-book backed',
                                    examples: ['HAL (Hindustan Aeronautics)', 'BEL (Bharat Electronics)', 'BDL (Bharat Dynamics)', 'MAZDOCK (Mazagon Dock)', 'SOLARINDS (Solar Industries)'] },
  'Power / Transmission':         { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 18-28x · capex cycle',
                                    examples: ['ATLANTAELE (Atlanta Electricals)', 'KEC (KEC International)', 'CGPOWER (CG Power)', 'POWERMECH (Power Mech)', 'STRTECH (Sterlite Tech)'] },
  'Pharmaceuticals':              { calc: 'PE',         multipleHint: 'PE 30-45x · USFDA premium',
                                    examples: ['RUBICON (Rubicon Research)', 'KPL (Kwality Pharma)', 'NEULAND (Neuland Labs)', 'DRREDDY (Dr Reddy\'s)', 'LUPIN (Lupin)'] },
  'Specialty Chemicals':          { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 20-30x · CDMO premium',
                                    examples: ['NITTAGELA (Nitta Gelatin)', 'AARTIIND (Aarti Industries)', 'NEOGEN (Neogen Chemicals)', 'PIIND (PI Industries)', 'SRF (SRF Ltd)'] },
  'Consumer Durables / FMCG':     { calc: 'PE',         multipleHint: 'PE 40-70x · quality moat',
                                    examples: ['TITAN (Titan Company)', 'BAJAJCON (Bajaj Consumer)', 'MAYURUNIQ (Mayur Uniquoters)', 'THANGAMAYL (Thangamayil)', 'SAFARI (Safari Industries)'] },
  'Auto Components':              { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 12-18x · cycle-midpoint',
                                    examples: ['CEAT (CEAT)', 'SANSERA (Sansera Engineering)', 'MOTHERSON (Samvardhana Motherson)', 'SCHAEFFLER (Schaeffler India)', 'BOSCHLTD (Bosch)'] },
  'Financial Services / NBFC':    { calc: 'PE',         multipleHint: 'PE 18-28x · ROE-linked',
                                    examples: ['HDFCAMC (HDFC AMC)', 'NIPPONLIFE (Nippon Life AMC)', 'BSE (BSE Ltd)', 'CDSL (Central Depository)', 'BAJFINANCE (Bajaj Finance)'] },
  'IT / Tech Services':           { calc: 'PE',         multipleHint: 'PE 20-35x · USD growth',
                                    examples: ['TCS (Tata Consultancy)', 'INFY (Infosys)', 'PERSISTENT (Persistent Systems)', 'COFORGE (Coforge)', 'MPHASIS (Mphasis)'] },
  'SaaS / Software (US)':         { calc: 'PS',         multipleHint: 'P/S 8-25x · Rule of 40',
                                    examples: ['PAYS (Paysign)', 'CRWD (CrowdStrike)', 'PLTR (Palantir)', 'NOW (ServiceNow)', 'MNDY (Monday.com)'] },
  'Pre-revenue / Growth':         { calc: 'PS',         multipleHint: 'P/S only — earnings noisy or negative',
                                    examples: ['CRDO (Credo Technology)', 'FLYW (Flywire)', 'UAN (CVR Partners)', 'ELA (Envela)', 'VMD (Viemed Healthcare)'] },

  // ─── NEW THEMES (P0632) — robotics, AI infra, EV, nuclear, etc. ─────
  'AI Compute & Infrastructure (US)': { calc: 'PS',     multipleHint: 'P/S 12-30x · capex-cycle premium',
                                    examples: ['NVDA (NVIDIA)', 'AVGO (Broadcom)', 'TSM (Taiwan Semi)', 'MU (Micron · HBM)', 'CDNS (Cadence)'] },
  'AI Infrastructure (India)':    { calc: 'PE',         multipleHint: 'PE 35-60x · ESDM premium',
                                    examples: ['KAYNES (Kaynes Technology)', 'NETWEB (Netweb Tech)', 'CYIENT (Cyient DLM)', 'TATAELXSI (Tata Elxsi)', 'PERSISTENT (Persistent Systems)'] },
  'Robotics & Automation':        { calc: 'PE',         multipleHint: 'PE 40-65x · industrial automation premium',
                                    examples: ['ABB (ABB India)', 'SIEMENS (Siemens India)', 'HONAUT (Honeywell Automation)', 'AJAXENGG (Ajax Engineering)', 'TIINDIA (Tube Investments)'] },
  'EV / Battery / Charging':      { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 18-30x · capex-heavy',
                                    examples: ['TATAPOWER (Tata Power)', 'EXIDEIND (Exide Industries)', 'AMARAJABAT (Amara Raja)', 'OLECTRA (Olectra Greentech)', 'JBMA (JBM Auto)'] },
  'Nuclear / Clean Energy (US)':  { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 18-30x · PPA-linked',
                                    examples: ['CEG (Constellation Energy)', 'VST (Vistra)', 'CCJ (Cameco)', 'NEE (NextEra Energy)', 'LEU (Centrus Energy)'] },
  'Rail / Metro / Mobility':      { calc: 'PE',         multipleHint: 'PE 25-40x · GoI-backed order book',
                                    examples: ['RVNL (Rail Vikas Nigam)', 'IRCON (IRCON International)', 'TITAGARH (Titagarh Rail)', 'BEML (BEML Ltd)', 'JWL (Jupiter Wagons)'] },
  'Critical Minerals / Rare Earth (US)': { calc: 'EV_EBITDA', multipleHint: 'EV/EBITDA 10-22x · supply-crunch optionality',
                                    examples: ['MP (MP Materials)', 'UUUU (Energy Fuels)', 'LYC (Lynas Rare Earths)', 'CCJ (Cameco)', 'URA (Global X Uranium ETF)'] },
  'GLP-1 / Healthcare (US)':      { calc: 'PE',         multipleHint: 'PE 30-50x · pricing-power-while-patent',
                                    examples: ['LLY (Eli Lilly)', 'NVO (Novo Nordisk)', 'VRTX (Vertex Pharma)', 'REGN (Regeneron)', 'ISRG (Intuitive Surgical)'] },
  'Cybersecurity (US)':           { calc: 'PS',         multipleHint: 'P/S 10-25x · cloud-native premium',
                                    examples: ['CRWD (CrowdStrike)', 'PANW (Palo Alto Networks)', 'ZS (Zscaler)', 'NET (Cloudflare)', 'OKTA (Okta)'] },
  'Quantum / Frontier Tech':      { calc: 'PS',         multipleHint: 'P/S volatile · narrative-driven',
                                    examples: ['IONQ (IonQ)', 'RGTI (Rigetti)', 'QBTS (D-Wave)', 'ARQQ (Arqit Quantum)', 'QUBT (Quantum Computing)'] },
};
