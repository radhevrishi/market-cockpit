// ═══════════════════════════════════════════════════════════════════════════
// LIVE INPUT COST → EQUITY TRANSMISSION ENGINE (PATCH 0096 / 0170)
//
// Tracks major commodity / currency moves and maps them to first-order
// equity impact via a static exposure matrix.
//
// GET /api/v1/transmission
//
// Pipeline:
//   1. Fetch spot/forward prices for: crude (CL=F), copper (HG=F), aluminum
//      (ALI=F), gold (GC=F), silver (SI=F), nat gas (NG=F), zinc (ZN=F),
//      iron ore proxy (X), USD/INR (INR=X), 10y Indian yield (proxy).
//   2. Compute 1d / 1w / 1m / 3m % changes.
//   3. Map each commodity → sector exposures (cost-driver -ve OR revenue-
//      driver +ve) → projected EBIT margin sensitivity.
//   4. Surface top movers + concrete ticker watchlists.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const YH = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface Commodity {
  symbol: string;
  name: string;
  unit: string;
  // Sector mappings: positive = sector benefits from this commodity rising,
  // negative = sector hurt. Magnitude = approximate elasticity of EBIT margin.
  drivers: { sector: string; sign: 1 | -1; sensitivity: 'high' | 'med' | 'low'; sample_tickers: string[] }[];
}

// Curated exposure matrix — derived from sector-cost-of-goods structure and
// pricing power. Each commodity lists the SECTORS most exposed plus a handful
// of marquee Indian tickers in each sector.
const COMMODITIES: Commodity[] = [
  {
    symbol: 'CL=F', name: 'Crude Oil (WTI)', unit: '$/bbl',
    drivers: [
      { sector: 'Aviation',      sign: -1, sensitivity: 'high', sample_tickers: ['INDIGO', 'SPICEJET'] },
      { sector: 'Paints',        sign: -1, sensitivity: 'high', sample_tickers: ['ASIANPAINT', 'BERGEPAINT', 'KANSAINER'] },
      { sector: 'Tyres',         sign: -1, sensitivity: 'high', sample_tickers: ['MRF', 'APOLLOTYRE', 'CEATLTD', 'BALKRISIND'] },
      { sector: 'Refining',      sign: 1,  sensitivity: 'med',  sample_tickers: ['RELIANCE', 'BPCL', 'IOC', 'HINDPETRO', 'MRPL', 'CHENNPETRO'] },
      { sector: 'Petrochem',     sign: -1, sensitivity: 'high', sample_tickers: ['SRF', 'NAVINFLUOR', 'AARTIIND', 'GUJALKALI'] },
      { sector: 'Cement (kiln)', sign: -1, sensitivity: 'med',  sample_tickers: ['ULTRACEMCO', 'SHREECEM', 'AMBUJACEM', 'ACC'] },
      { sector: 'FMCG (logistics)', sign: -1, sensitivity: 'low', sample_tickers: ['HINDUNILVR', 'DABUR', 'GODREJCP'] },
    ],
  },
  {
    symbol: 'HG=F', name: 'Copper', unit: '$/lb',
    drivers: [
      { sector: 'Copper miners',  sign: 1,  sensitivity: 'high', sample_tickers: ['HINDCOPPER', 'VEDL'] },
      { sector: 'Wires & Cables', sign: -1, sensitivity: 'high', sample_tickers: ['POLYCAB', 'KEI', 'HAVELLS', 'FINCABLES', 'RRKABEL'] },
      { sector: 'Capital Goods',  sign: -1, sensitivity: 'med',  sample_tickers: ['ABB', 'SIEMENS', 'BHEL'] },
      { sector: 'EV (BoM)',       sign: -1, sensitivity: 'med',  sample_tickers: ['TATAPOWER', 'TATAMOTORS'] },
    ],
  },
  {
    symbol: 'ALI=F', name: 'Aluminum', unit: '$/lb',
    drivers: [
      { sector: 'Aluminum miners', sign: 1,  sensitivity: 'high', sample_tickers: ['HINDALCO', 'NATIONALUM', 'VEDL'] },
      { sector: 'Auto (lightweighting)', sign: -1, sensitivity: 'med', sample_tickers: ['MARUTI', 'TATAMOTORS', 'M&M'] },
      { sector: 'Packaging',       sign: -1, sensitivity: 'med',  sample_tickers: ['POLYPLEX', 'COSMOFILMS'] },
    ],
  },
  {
    symbol: 'GC=F', name: 'Gold', unit: '$/oz',
    drivers: [
      { sector: 'Jewellery',     sign: -1, sensitivity: 'high', sample_tickers: ['TITAN', 'KALYANKJIL', 'SENCO', 'PCJEWELLER'] },
      { sector: 'Bullion / Refining', sign: 1, sensitivity: 'high', sample_tickers: ['MMTC', 'RAJESHEXPO'] },
      { sector: 'Banks (gold loans)', sign: 1, sensitivity: 'med', sample_tickers: ['MANAPPURAM', 'MUTHOOTFIN', 'IIFLWAM'] },
    ],
  },
  {
    symbol: 'SI=F', name: 'Silver', unit: '$/oz',
    drivers: [
      { sector: 'Silver miners',  sign: 1,  sensitivity: 'high', sample_tickers: ['HINDZINC', 'VEDL'] },
      { sector: 'Solar panel (silver paste)', sign: -1, sensitivity: 'med', sample_tickers: ['WAAREEENER', 'PREMIERENE', 'TATAPOWER'] },
    ],
  },
  {
    symbol: 'INR=X', name: 'USD/INR', unit: '₹/$',
    drivers: [
      { sector: 'IT Services (USD revenue)', sign: 1,  sensitivity: 'high', sample_tickers: ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LTIM', 'PERSISTENT', 'COFORGE', 'MPHASIS'] },
      { sector: 'Pharma (US generics)',      sign: 1,  sensitivity: 'high', sample_tickers: ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'LUPIN', 'AUROPHARMA'] },
      { sector: 'Imported feedstock',         sign: -1, sensitivity: 'high', sample_tickers: ['BPCL', 'HINDUNILVR', 'BERGEPAINT', 'ASIANPAINT'] },
      { sector: 'Forex debt heavy',           sign: -1, sensitivity: 'med',  sample_tickers: ['INDIGO', 'TATASTEEL'] },
    ],
  },
  {
    symbol: 'NG=F', name: 'Natural Gas', unit: '$/MMBtu',
    drivers: [
      { sector: 'City gas',        sign: -1, sensitivity: 'high', sample_tickers: ['IGL', 'MGL', 'GUJGASLTD', 'ADANIGAS', 'IRMENERGY'] },
      { sector: 'Fertilizers',     sign: -1, sensitivity: 'high', sample_tickers: ['CHAMBLFERT', 'COROMANDEL', 'GSFC', 'GNFC'] },
      { sector: 'Power generation', sign: -1, sensitivity: 'med', sample_tickers: ['NTPC', 'TATAPOWER'] },
    ],
  },
  {
    symbol: 'ZN=F', name: 'Zinc', unit: '$/lb',
    drivers: [
      { sector: 'Zinc miners',    sign: 1,  sensitivity: 'high', sample_tickers: ['HINDZINC', 'VEDL'] },
      { sector: 'Galvanizing',    sign: -1, sensitivity: 'med',  sample_tickers: ['APLAPOLLO', 'TATASTEEL'] },
    ],
  },
  {
    symbol: '^TNX', name: '10Y US Yield', unit: '%',
    drivers: [
      { sector: 'Banks (NIM)',      sign: 1,  sensitivity: 'med', sample_tickers: ['HDFCBANK', 'ICICIBANK', 'AXISBANK', 'KOTAKBANK', 'SBIN'] },
      { sector: 'Realty (rates)',   sign: -1, sensitivity: 'high', sample_tickers: ['DLF', 'OBEROIRLTY', 'GODREJPROP', 'LODHA'] },
      { sector: 'NBFC (cost-funds)', sign: -1, sensitivity: 'high', sample_tickers: ['BAJFINANCE', 'CHOLAFIN', 'AAVAS', 'CANFINHOME', 'PNBHOUSING'] },
    ],
  },
];

interface YahooPoint { ts: number; close: number; }
async function fetchSeries(symbol: string): Promise<YahooPoint[] | null> {
  try {
    const res = await fetch(`${YH}/${encodeURIComponent(symbol)}?range=3mo&interval=1d`, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r) return null;
    const ts: number[] = r.timestamp || [];
    const cl: (number | null)[] = r.indicators?.quote?.[0]?.close || [];
    const out: YahooPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (cl[i] != null && Number.isFinite(cl[i])) out.push({ ts: ts[i], close: cl[i] as number });
    }
    return out.length > 0 ? out : null;
  } catch { return null; }
}

function pctChange(pts: YahooPoint[], daysBack: number): number | null {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1].close;
  const targetIdx = Math.max(0, pts.length - 1 - daysBack);
  const ref = pts[targetIdx].close;
  if (ref <= 0) return null;
  return ((last - ref) / ref) * 100;
}

export async function GET() {
  const t0 = Date.now();

  const seriesArr = await Promise.all(COMMODITIES.map((c) => fetchSeries(c.symbol)));
  const out = COMMODITIES.map((c, i) => {
    const pts = seriesArr[i];
    if (!pts) return { ...c, fetched: false, last: null, change_1d: null, change_1w: null, change_1m: null, change_3m: null, impacts: [] };
    const last = pts[pts.length - 1].close;
    const c1d = pctChange(pts, 1);
    const c1w = pctChange(pts, 5);
    const c1m = pctChange(pts, 21);
    const c3m = pctChange(pts, 63);
    // Build impact list — for each sector mapped, compute projected EBIT pressure
    // For sensitivity {high: 0.6, med: 0.3, low: 0.15} this maps commodity-move
    // to first-order margin-pressure-pp on the dependent sector.
    const sensFactor: Record<string, number> = { high: 0.6, med: 0.3, low: 0.15 };
    const impacts = c.drivers.map((d) => {
      const f = sensFactor[d.sensitivity];
      const mPressure1m = c1m != null ? c1m * d.sign * f : null;
      const mPressure3m = c3m != null ? c3m * d.sign * f : null;
      return {
        sector: d.sector,
        sign: d.sign,
        sensitivity: d.sensitivity,
        margin_pressure_pp_1m: mPressure1m != null ? Math.round(mPressure1m * 10) / 10 : null,
        margin_pressure_pp_3m: mPressure3m != null ? Math.round(mPressure3m * 10) / 10 : null,
        sample_tickers: d.sample_tickers,
      };
    });
    return {
      symbol: c.symbol, name: c.name, unit: c.unit,
      fetched: true,
      last: Math.round(last * 100) / 100,
      change_1d: c1d != null ? Math.round(c1d * 100) / 100 : null,
      change_1w: c1w != null ? Math.round(c1w * 100) / 100 : null,
      change_1m: c1m != null ? Math.round(c1m * 100) / 100 : null,
      change_3m: c3m != null ? Math.round(c3m * 100) / 100 : null,
      impacts,
    };
  });

  // Top transmission shocks: largest |1m change × sensitivity| pairs across all
  // commodities, grouped by sector.
  const shocks: Array<{ commodity: string; sector: string; pressure_pp: number; sign: 1 | -1; sensitivity: 'high'|'med'|'low'; tickers: string[] }> = [];
  for (const c of out) {
    if (!c.fetched || c.change_1m == null) continue;
    for (const imp of c.impacts) {
      if (imp.margin_pressure_pp_1m == null) continue;
      if (Math.abs(imp.margin_pressure_pp_1m) < 1) continue;
      shocks.push({
        commodity: c.name,
        sector: imp.sector,
        pressure_pp: imp.margin_pressure_pp_1m,
        sign: imp.sign as 1 | -1,
        sensitivity: imp.sensitivity as 'high'|'med'|'low',
        tickers: imp.sample_tickers,
      });
    }
  }
  shocks.sort((a, b) => Math.abs(b.pressure_pp) - Math.abs(a.pressure_pp));

  return NextResponse.json({
    commodities: out,
    top_shocks: shocks.slice(0, 25),
    fetched_at: new Date().toISOString(),
    ms: Date.now() - t0,
  }, { headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=1800' } });
}
