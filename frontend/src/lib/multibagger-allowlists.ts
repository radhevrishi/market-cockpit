// ═══════════════════════════════════════════════════════════════════════════
// MULTIBAGGER ALLOWLISTS — extracted from multibagger/page.tsx in Patch 0614.
//
// Static lookup tables used by the India + USA scoring engines. Extracted from
// the 9K-line page.tsx as a first step toward modularising the scorer.
// Adding a ticker here is a one-line edit; no JSX changes required.
//
// MNC_ALLOWLIST_IN
//   Indian listings of foreign-parent multinationals whose low FII+DII
//   ownership is structural (the parent holds majority), NOT a diligence
//   red flag. Including them in the allowlist keeps clean MNC subsidiaries
//   from being penalized by the low-institutional governance rule.
//
//   Categories represented:
//     - Industrial / Engineering: Kennametal India, Carraro India, Nitta Gelatin,
//       Grindwell Norton, Bosch, ABB, Siemens, 3M India, Honeywell Auto, Timken,
//       SKF India, Schaeffler, Cummins, Sulzer, Linde India, ESAB India
//     - Consumer / FMCG: Nestle India, HUL, Colgate-Palmolive, Gillette,
//       P&G Hygiene, Whirlpool
//     - Pharma: GSK, Sanofi, Pfizer, AstraZeneca
//     - Lubricants / Auto: Castrol India, Mahindra Scooters
//     - Travel: Thomas Cook
// ═══════════════════════════════════════════════════════════════════════════

export const MNC_ALLOWLIST_IN = new Set<string>([
  'KENNAMET', 'CARRARO', 'NITTAGELA', 'GRINDWELL', 'BOSCHLTD', 'ABB', 'SIEMENS',
  '3MINDIA',  'HONAUT',  'CASTROLIND', 'CASTROL',  'NESTLEIND', 'HUL', 'HINDUNILVR',
  'COLPAL',   'GILLETTE','GSK',       'SANOFI',   'PFIZER',   'PROCTER', 'PGHH', 'PROCTERG',
  'WHIRLPOOL','ASTRAZEN','THOMASCOOK','TIMKEN',   'SKFINDIA', 'FAGBEAR', 'MAHSCOOTER',
  'CUMMINSIND','SCHAEFFLER','SULZER', 'LINDEINDIA','ESABINDIA',
]);

/** Helper: returns true if the ticker (uppercased, NSE/BSE suffix stripped) is on the MNC allowlist. */
export function isMncIn(symbol?: string): boolean {
  if (!symbol) return false;
  const sym = symbol.toUpperCase().replace(/\.(NS|BO)$/i, '');
  return MNC_ALLOWLIST_IN.has(sym);
}
