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

// PATCH 0636 — module-level cached universe for autocomplete.
// One fetch per session (5-min TTL) to avoid hammering /api/market/quotes
// every keystroke. Returns ticker + company + sector for typeahead.
let _universeCache: { ts: number; india: any[]; us: any[] } | null = null;
const UNIVERSE_TTL_MS = 5 * 60 * 1000;

export interface TickerHit {
  ticker: string;
  company?: string;
  sector?: string;
  price?: number;
  marketCap?: number;  // raw rupees from API
  market: 'india' | 'us';
}

export async function loadTickerUniverse(market: 'india' | 'us' = 'india'): Promise<TickerHit[]> {
  const now = Date.now();
  if (_universeCache && now - _universeCache.ts < UNIVERSE_TTL_MS) {
    return market === 'us' ? _universeCache.us : _universeCache.india;
  }
  try {
    const r = await fetch(`/api/market/quotes?market=${market}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    const stocks: any[] = j?.stocks || [];
    const hits: TickerHit[] = stocks.map(s => ({
      ticker: s.ticker || '',
      company: s.company,
      sector: s.sector,
      price: s.price,
      marketCap: s.marketCap,
      market,
    })).filter(h => h.ticker);
    // Cache both sides — for now we only fetch one but keep the structure
    if (!_universeCache) _universeCache = { ts: now, india: [], us: [] };
    if (market === 'us') _universeCache.us = hits;
    else _universeCache.india = hits;
    _universeCache.ts = now;
    return hits;
  } catch { return []; }
}

/** Filters cached universe by prefix or substring match on ticker/company. */
export function searchTickerUniverse(query: string, market: 'india' | 'us' = 'india', limit = 12): TickerHit[] {
  if (!_universeCache) return [];
  const arr = market === 'us' ? _universeCache.us : _universeCache.india;
  const q = query.trim().toUpperCase();
  if (!q) return [];
  // Score: exact ticker prefix > ticker substring > company prefix > company substring
  return arr
    .map(h => {
      const t = (h.ticker || '').toUpperCase();
      const c = (h.company || '').toUpperCase();
      let score = 0;
      if (t.startsWith(q)) score = 100 - (t.length - q.length);
      else if (t.includes(q)) score = 50;
      else if (c.startsWith(q)) score = 40;
      else if (c.includes(q)) score = 20;
      return { h, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.h);
}

export async function fetchQuoteAutofill(ticker: string, market: 'india' | 'us' = 'india'): Promise<QuoteAutoFill | null> {
  if (!ticker) return null;
  const t = ticker.trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  const currency: '₹' | '$' = market === 'us' ? '$' : '₹';

  // Primary: /api/market/quotes
  // PATCH 0645 — flexible ticker matching: exact → prefix → company-name contains.
  // Caters for MTAR/MTARTECH, BAJAJ-AUTO/BAJAJAUTO, KAYNES-Q4FY26 etc.
  try {
    const r = await fetch(`/api/market/quotes?market=${market}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const stocks: any[] = j?.stocks || [];
      let hit: any = stocks.find((s) => (s.ticker || '').toUpperCase() === t);
      // Prefix match: 'MTAR' -> 'MTARTECH' (when no exact hit)
      if (!hit && t.length >= 3) {
        const prefixHits = stocks.filter((s) => (s.ticker || '').toUpperCase().startsWith(t));
        if (prefixHits.length === 1) hit = prefixHits[0];
        // If multiple, pick shortest ticker (closest to original input intent)
        else if (prefixHits.length > 1) hit = prefixHits.sort((a, b) => (a.ticker || '').length - (b.ticker || '').length)[0];
      }
      // Company-name contains (handles BAJAJCON -> 'Bajaj Consumer Care')
      if (!hit && t.length >= 4) {
        const ncon = stocks.filter((s) => {
          const c = (s.company || '').toUpperCase().replace(/[^A-Z]/g, '');
          return c.startsWith(t) || c.includes(t);
        });
        if (ncon.length === 1) hit = ncon[0];
      }
      if (hit && hit.price) {
        const marketCapCr = (hit.marketCap || 0) / 1e7;
        return {
          ticker: hit.ticker || t,
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
      // PATCH 0639 — realistic ~₹2,100 Cr current mcap (was placeholder 21,000).
      // Forward revenue trimmed to realistic FY28 target proportional to base.
      currentMarketCapCr: 2130,
      horizonMonths: 18,
      forwardRevenueCr: 1200,    // realistic FY28 target on growth-stage formulator
      bearPS: 6, basePS: 9, bullPS: 13,
    },
  },
  bajajConsumer: {
    label: 'Bajaj Consumer — P/E, 12m (FMCG)',
    type: 'PE' as const,
    input: {
      ticker: 'BAJAJCON', company: 'Bajaj Consumer Care',
      currentMarketCapCr: 2400,    // BAJAJCON not in /api/market/quotes universe — manual default
      horizonMonths: 12,
      forwardPATCr: 190,
      bearPE: 20, basePE: 24, bullPE: 30,
      currentPrice: 167,           // approx — user can override
    },
  },
  tdPower: {
    label: 'TD Power — P/E on FY27, 18m',
    type: 'PE' as const,
    input: {
      ticker: 'TDPOWERSYS', company: 'TD Power Systems',
      currentMarketCapCr: 6500,    // realistic
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
      currentMarketCapCr: 5500,    // realistic
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
      currentMarketCapCr: 5047,    // user-confirmed
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
      currentMarketCapCr: 2600,    // user-confirmed (was 12000 placeholder)
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
      currentMarketCapCr: 3136,    // user-confirmed
      horizonMonths: 18,
      forwardPATCr: 100,
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

  // ─── PATCH 0849 — 25 new India sectors covering most NSE-listed industries
  'Breweries / Distilleries':     { calc: 'PE',         multipleHint: 'PE 25-40x · brand-driven · regulated demand',
                                    examples: ['UNITDSPR (United Spirits)', 'RADICO (Radico Khaitan)', 'GLOBUSSPR (Globus Spirits)', 'ASSOCALC (Associated Alcohols)', 'TILAKNGR (Tilaknagar Industries)'] },
  'Cement':                       { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 10-15x · cycle-sensitive',
                                    examples: ['ULTRACEMCO (UltraTech)', 'SHREECEM (Shree Cement)', 'AMBUJACEM (Ambuja Cements)', 'ACC (ACC Ltd)', 'JKCEMENT (JK Cement)'] },
  'Hotels & Hospitality':         { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 18-28x · cyclical-RevPAR-driven',
                                    examples: ['INDHOTEL (Indian Hotels)', 'CHALET (Chalet Hotels)', 'LEMONTREE (Lemon Tree)', 'EIHOTEL (EIH)', 'TAJGVK (Taj GVK)'] },
  'Aviation':                     { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 6-12x · volatile-fuel-cycle',
                                    examples: ['INDIGO (InterGlobe Aviation)', 'SPICEJET (SpiceJet)'] },
  'Logistics & Warehousing':      { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 14-22x · asset-light premium',
                                    examples: ['CONCOR (Container Corp)', 'BLUEDART (Blue Dart)', 'TCIEXP (TCI Express)', 'MAHLOG (Mahindra Logistics)', 'DELHIVERY (Delhivery)'] },
  'Sugar / Agri Processing':      { calc: 'PE',         multipleHint: 'PE 10-20x · cyclical/MSP-driven',
                                    examples: ['BAJAJHIND (Bajaj Hindusthan)', 'DCMSHRIRAM (DCM Shriram)', 'TRIVENI (Triveni Engg)', 'BALRAMCHIN (Balrampur Chini)', 'DALMIASUG (Dalmia Bharat Sugar)'] },
  'Steel & Metals':               { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 5-8x · cycle-peak-compresses',
                                    examples: ['TATASTEEL (Tata Steel)', 'JSWSTEEL (JSW Steel)', 'SAIL (SAIL)', 'HINDALCO (Hindalco)', 'JINDALSTEL (Jindal Steel)'] },
  'Mining':                       { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 5-9x · commodity-cycle',
                                    examples: ['COALINDIA (Coal India)', 'NMDC (NMDC)', 'HINDZINC (Hindustan Zinc)', 'VEDL (Vedanta)', 'GMDCLTD (Gujarat Mineral Development)'] },
  'Textiles & Apparel':           { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 8-14x · margin-volatile',
                                    examples: ['PAGEIND (Page Industries)', 'KPRMILL (KPR Mill)', 'VARDHACRLC (Vardhman Textiles)', 'WELSPUNLIV (Welspun Living)', 'TRIDENT (Trident)'] },
  'Real Estate / Construction':   { calc: 'PE',         multipleHint: 'PE 22-35x · cyclical-bookings-driven',
                                    examples: ['DLF (DLF)', 'GODREJPROP (Godrej Properties)', 'OBEROIRLTY (Oberoi Realty)', 'PRESTIGE (Prestige Estates)', 'BRIGADE (Brigade Enterprises)'] },
  'Telecom':                      { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 8-12x · ARPU-driven',
                                    examples: ['BHARTIARTL (Bharti Airtel)', 'IDEA (Vodafone Idea)', 'INDUSTOWER (Indus Towers)', 'TATACOMM (Tata Communications)'] },
  'Hospitals / Healthcare Services': { calc: 'EV_EBITDA', multipleHint: 'EV/EBITDA 18-28x · ARPOB-led growth',
                                    examples: ['APOLLOHOSP (Apollo Hospitals)', 'FORTIS (Fortis Healthcare)', 'MAXHEALTH (Max Healthcare)', 'NH (Narayana Health)', 'KIMS (KIMS Hospitals)'] },
  'Diagnostics & Pathology':      { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 20-32x · scale-economics',
                                    examples: ['DRLAL (Dr Lal Pathlabs)', 'METROPOLIS (Metropolis Healthcare)', 'THYROCARE (Thyrocare)', 'VIJAYA (Vijaya Diagnostic)', 'KRSNAA (Krsnaa Diagnostics)'] },
  'Power Utility (Generation)':   { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 8-14x · PPA-linked',
                                    examples: ['NTPC (NTPC)', 'POWERGRID (Power Grid)', 'TATAPOWER (Tata Power)', 'JSWENERGY (JSW Energy)', 'NHPC (NHPC)'] },
  'Renewable Energy':             { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 15-25x · capex-cycle premium',
                                    examples: ['ADANIGREEN (Adani Green)', 'SUZLON (Suzlon)', 'INOXWIND (Inox Wind)', 'ORIENTGREEN (Orient Green)', 'WAAREE (Waaree Energies)'] },
  'Insurance':                    { calc: 'PE',         multipleHint: 'PE 30-50x · APE-growth-led',
                                    examples: ['SBILIFE (SBI Life)', 'HDFCLIFE (HDFC Life)', 'ICICIPRULI (ICICI Pru Life)', 'ICICIGI (ICICI Lombard)', 'STARHEALTH (Star Health)'] },
  'Oil & Gas — Upstream':         { calc: 'PE',         multipleHint: 'PE 6-12x · oil-cycle-sensitive',
                                    examples: ['ONGC (ONGC)', 'OIL (Oil India)'] },
  'Oil & Gas — Refining & Marketing': { calc: 'EV_EBITDA', multipleHint: 'EV/EBITDA 5-10x · GRM-driven',
                                    examples: ['RELIANCE (Reliance)', 'IOC (Indian Oil)', 'BPCL (BPCL)', 'HINDPETRO (HPCL)', 'CHENNPETRO (Chennai Petroleum)'] },
  'Gas Distribution / CGD':       { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 10-14x · regulated-volume-led',
                                    examples: ['IGL (Indraprastha Gas)', 'GUJGASLTD (Gujarat Gas)', 'MGL (Mahanagar Gas)', 'GAIL (GAIL)', 'PETRONET (Petronet LNG)'] },
  'Media / Print / Broadcasting': { calc: 'PE',         multipleHint: 'PE 10-20x · declining-print, digital-bet',
                                    examples: ['ZEEL (Zee Entertainment)', 'SUNTV (Sun TV)', 'DBCORP (D B Corp)', 'TVTODAY (TV Today)', 'JAGRAN (Jagran Prakashan)'] },
  'Tobacco / Cigarettes':         { calc: 'PE',         multipleHint: 'PE 22-30x · brand-pricing-power',
                                    examples: ['ITC (ITC)', 'GODFRYPHLP (Godfrey Phillips)', 'VST (VST Industries)'] },
  'Plantations / Tea / Coffee':   { calc: 'PE',         multipleHint: 'PE 15-25x · agri-volatile',
                                    examples: ['MCLEODRUSS (McLeod Russel)', 'HARRMALAYA (Harrisons Malayalam)', 'BOMDYEING (Bombay Dyeing)', 'CCL (CCL Products)'] },
  'Retail & E-Commerce':          { calc: 'PE',         multipleHint: 'PE 50-90x · SSSG-led growth premium',
                                    examples: ['DMART (Avenue Supermarts)', 'TRENT (Trent)', 'VMART (V-Mart)', 'SHOPERSTOP (Shoppers Stop)', 'ABFRL (Aditya Birla Fashion)'] },
  'Education / Edtech':           { calc: 'PE',         multipleHint: 'PE 25-40x · enrollment-led growth',
                                    examples: ['NIITLTD (NIIT)', 'CAREERP (Career Point)', 'CLEDUCATE (CL Educate)', 'NAVNETEDUL (Navneet Education)'] },
  'Agrochemicals & Crop Protection': { calc: 'EV_EBITDA', multipleHint: 'EV/EBITDA 12-18x · monsoon-sensitive',
                                    examples: ['UPL (UPL)', 'PIIND (PI Industries)', 'BAYERCROP (Bayer CropScience)', 'SUMICHEM (Sumitomo Chemical)', 'RALLIS (Rallis India)'] },
  'API / Bulk Drugs':             { calc: 'EV_EBITDA',  multipleHint: 'EV/EBITDA 14-22x · capacity-utilization-driven',
                                    examples: ['DIVISLAB (Divis Labs)', 'GRANULES (Granules India)', 'LAURUSLABS (Laurus Labs)', 'AARTIDRUGS (Aarti Drugs)', 'NEULAND (Neuland Labs)'] },
};
