// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — SECTOR FROM THE SEC INDUSTRY CODE.             (zzz793)
//
// Every SEC filer carries a 4-digit SIC industry code (EDGAR submissions:
// `sic`, `sicDescription`). This maps that code into eleven broad US sector
// groups (the familiar S&P-style names) so the book can show a sector split.
// It is OUR grouping of the SEC code — the page says so, and shows the SEC's
// own industry words next to it. A code we cannot place is "Unknown", never a
// guess; a line with no SEC filer (e.g. Frankfurt) is "Unknown (no SEC filer)".
// Pure.
// ═══════════════════════════════════════════════════════════════════════════

export const US_SECTORS = [
  'Information Technology', 'Health Care', 'Financials', 'Real Estate', 'Industrials', 'Energy', 'Materials',
  'Consumer Discretionary', 'Consumer Staples', 'Utilities', 'Communication Services',
] as const;
export type UsSector = typeof US_SECTORS[number] | 'Unknown';

const inR = (n: number, a: number, b: number) => n >= a && n <= b;

export function sicToSector(sic: string | number | null | undefined): UsSector {
  const n = Number(String(sic ?? '').trim());
  if (!Number.isInteger(n) || n <= 0) return 'Unknown';
  // Specific codes first.
  if (n === 6798) return 'Real Estate';                                   // REITs
  if (n === 2834 || n === 2835 || n === 2836 || n === 2833) return 'Health Care';
  if (n === 3651 || inR(n, 3630, 3639)) return 'Consumer Discretionary';  // household audio / appliances
  if (inR(n, 3660, 3679)) return 'Information Technology';                // comms equipment, semis & components
  if (inR(n, 3570, 3579)) return 'Information Technology';                // computers
  if (inR(n, 3820, 3829) || inR(n, 3860, 3861)) return 'Information Technology'; // measuring instruments, photo
  if (inR(n, 3840, 3851)) return 'Health Care';                           // medical instruments
  if (inR(n, 3870, 3873)) return 'Consumer Discretionary';
  if (inR(n, 3710, 3716) || inR(n, 3750, 3751)) return 'Consumer Discretionary'; // motor vehicles, motorcycles
  if (inR(n, 7370, 7379)) return 'Information Technology';                // software & IT services
  if (inR(n, 7310, 7319)) return 'Communication Services';                // advertising
  if (inR(n, 1311, 1389) || inR(n, 1200, 1299) || inR(n, 2900, 2999)) return 'Energy';
  if (inR(n, 2840, 2844)) return 'Consumer Staples';                      // soaps, cosmetics
  if (inR(n, 5120, 5122)) return 'Health Care';                           // drug wholesale
  if (inR(n, 5140, 5149) || inR(n, 5400, 5499) || n === 5912) return 'Consumer Staples';
  if (inR(n, 4950, 4959)) return 'Industrials';                           // waste management
  if (n === 8731) return 'Health Care';                                   // commercial biological research
  // Broad ranges.
  if (inR(n, 100, 999)) return 'Consumer Staples';
  if (inR(n, 1000, 1499)) return 'Materials';
  if (inR(n, 1500, 1799)) return 'Industrials';
  if (inR(n, 2000, 2199)) return 'Consumer Staples';
  if (inR(n, 2200, 2399)) return 'Consumer Discretionary';
  if (inR(n, 2400, 2499)) return 'Materials';
  if (inR(n, 2500, 2599)) return 'Consumer Discretionary';
  if (inR(n, 2600, 2699)) return 'Materials';
  if (inR(n, 2700, 2799)) return 'Communication Services';
  if (inR(n, 2800, 2899)) return 'Materials';
  if (inR(n, 3000, 3399)) return 'Materials';
  if (inR(n, 3400, 3499)) return 'Industrials';
  if (inR(n, 3500, 3599)) return 'Industrials';
  if (inR(n, 3600, 3699)) return 'Industrials';
  if (inR(n, 3700, 3799)) return 'Industrials';
  if (inR(n, 3800, 3899)) return 'Industrials';
  if (inR(n, 3900, 3999)) return 'Consumer Discretionary';
  if (inR(n, 4000, 4799)) return 'Industrials';
  if (inR(n, 4800, 4899)) return 'Communication Services';
  if (inR(n, 4900, 4999)) return 'Utilities';
  if (inR(n, 5000, 5199)) return 'Industrials';
  if (inR(n, 5200, 5999)) return 'Consumer Discretionary';
  if (inR(n, 6000, 6499)) return 'Financials';
  if (inR(n, 6500, 6599)) return 'Real Estate';
  if (inR(n, 6700, 6799)) return 'Financials';
  if (inR(n, 7000, 7299)) return 'Consumer Discretionary';
  if (inR(n, 7300, 7399)) return 'Industrials';
  if (inR(n, 7500, 7599)) return 'Consumer Discretionary';
  if (inR(n, 7800, 7899)) return 'Communication Services';
  if (inR(n, 7900, 7999)) return 'Consumer Discretionary';
  if (inR(n, 8000, 8099)) return 'Health Care';
  if (inR(n, 8200, 8299)) return 'Consumer Discretionary';
  if (inR(n, 8100, 8999)) return 'Industrials';
  return 'Unknown';
}
