// ═══════════════════════════════════════════════════════════════════════════
// VALUATION ENGINE — sector default assumptions
//
// WACC, terminal growth, cost of equity, exit multiples per sector bucket.
// India-anchored: 10Y G-sec ~7%, ERP ~6%, risk-free ~7%, base WACC for
// cyclical/leveraged sectors higher, IT/staple lower.
// ═══════════════════════════════════════════════════════════════════════════

import type { SectorAssumption, SectorBucket } from './types';

export const TERMINAL_GROWTH_INDIA = 0.04;   // 4% — real GDP + long-run inflation midpoint
export const TERMINAL_GROWTH_USA = 0.03;     // 3%
export const DEFAULT_TAX_RATE_INDIA = 0.2517; // India corporate tax 25.17% (lower regime)

export const SECTOR_ASSUMPTIONS: Record<SectorBucket, SectorAssumption> = {
  BANKS_NBFC:             { bucket: 'BANKS_NBFC',             wacc: 0.115, terminalGrowth: 0.05, costOfEquity: 0.135, exitPe: 18, exitEvEbitda: 0,   dcfApplicable: false, pbRoeApplicable: true  },
  IT_SOFTWARE:            { bucket: 'IT_SOFTWARE',            wacc: 0.130, terminalGrowth: 0.045,costOfEquity: 0.140, exitPe: 30, exitEvEbitda: 22,  dcfApplicable: true,  pbRoeApplicable: false },
  IT_SERVICES:            { bucket: 'IT_SERVICES',            wacc: 0.130, terminalGrowth: 0.045,costOfEquity: 0.140, exitPe: 28, exitEvEbitda: 20,  dcfApplicable: true,  pbRoeApplicable: false },
  PHARMA_HEALTHCARE:      { bucket: 'PHARMA_HEALTHCARE',      wacc: 0.120, terminalGrowth: 0.04, costOfEquity: 0.135, exitPe: 28, exitEvEbitda: 19,  dcfApplicable: true,  pbRoeApplicable: false },
  SPECIALTY_CHEM:         { bucket: 'SPECIALTY_CHEM',         wacc: 0.125, terminalGrowth: 0.04, costOfEquity: 0.135, exitPe: 30, exitEvEbitda: 22,  dcfApplicable: true,  pbRoeApplicable: false },
  CONSUMER_STAPLE:        { bucket: 'CONSUMER_STAPLE',        wacc: 0.115, terminalGrowth: 0.045,costOfEquity: 0.125, exitPe: 38, exitEvEbitda: 25,  dcfApplicable: true,  pbRoeApplicable: false },
  CONSUMER_DISCRETIONARY: { bucket: 'CONSUMER_DISCRETIONARY', wacc: 0.125, terminalGrowth: 0.04, costOfEquity: 0.135, exitPe: 32, exitEvEbitda: 20,  dcfApplicable: true,  pbRoeApplicable: false },
  AUTO_AUTO_COMP:         { bucket: 'AUTO_AUTO_COMP',         wacc: 0.130, terminalGrowth: 0.035,costOfEquity: 0.140, exitPe: 22, exitEvEbitda: 14,  dcfApplicable: true,  pbRoeApplicable: false },
  CAPITAL_GOODS:          { bucket: 'CAPITAL_GOODS',          wacc: 0.130, terminalGrowth: 0.04, costOfEquity: 0.140, exitPe: 28, exitEvEbitda: 18,  dcfApplicable: true,  pbRoeApplicable: false },
  INDUSTRIAL:             { bucket: 'INDUSTRIAL',             wacc: 0.130, terminalGrowth: 0.04, costOfEquity: 0.140, exitPe: 24, exitEvEbitda: 16,  dcfApplicable: true,  pbRoeApplicable: false },
  INFRA_POWER:            { bucket: 'INFRA_POWER',            wacc: 0.115, terminalGrowth: 0.035,costOfEquity: 0.130, exitPe: 18, exitEvEbitda: 12,  dcfApplicable: true,  pbRoeApplicable: false },
  CYCLICAL_METAL:         { bucket: 'CYCLICAL_METAL',         wacc: 0.145, terminalGrowth: 0.03, costOfEquity: 0.150, exitPe: 12, exitEvEbitda: 7,   dcfApplicable: true,  pbRoeApplicable: false },
  CEMENT:                 { bucket: 'CEMENT',                 wacc: 0.130, terminalGrowth: 0.035,costOfEquity: 0.140, exitPe: 22, exitEvEbitda: 14,  dcfApplicable: true,  pbRoeApplicable: false },
  REALTY:                 { bucket: 'REALTY',                 wacc: 0.140, terminalGrowth: 0.03, costOfEquity: 0.150, exitPe: 18, exitEvEbitda: 12,  dcfApplicable: true,  pbRoeApplicable: false },
  TELECOM:                { bucket: 'TELECOM',                wacc: 0.120, terminalGrowth: 0.035,costOfEquity: 0.130, exitPe: 24, exitEvEbitda: 12,  dcfApplicable: true,  pbRoeApplicable: false },
  OIL_GAS:                { bucket: 'OIL_GAS',                wacc: 0.130, terminalGrowth: 0.03, costOfEquity: 0.140, exitPe: 14, exitEvEbitda: 8,   dcfApplicable: true,  pbRoeApplicable: false },
  FINANCIAL_OTHER:        { bucket: 'FINANCIAL_OTHER',        wacc: 0.120, terminalGrowth: 0.045,costOfEquity: 0.135, exitPe: 22, exitEvEbitda: 0,   dcfApplicable: true,  pbRoeApplicable: false },
  DEFAULT:                { bucket: 'DEFAULT',                wacc: 0.125, terminalGrowth: 0.04, costOfEquity: 0.135, exitPe: 22, exitEvEbitda: 15,  dcfApplicable: true,  pbRoeApplicable: false },
};

/** Sector text → bucket mapping. Maps the free-form sector / industry name
 *  from the Screener CSV to one of our buckets. */
export function classifySector(sector?: string): SectorBucket {
  if (!sector) return 'DEFAULT';
  const s = sector.toUpperCase();
  // PATCH 0479 — broader NBFC/Finance detection. Previously only matched
  // explicit "FINANCE -" with hyphen, missing names tagged just "Finance"
  // (Northern Arc, SG Finserve, etc) which then fell to DEFAULT bucket and
  // got DCF-style multiples applied to lenders. Now catches any of: BANK,
  // NBFC, HOUSING FIN, MICRO FIN, plain FINANCE, LENDING, CREDIT, asset-mgmt.
  if (/BANK|NBFC|HOUSING\s*FIN|MICRO\s*FIN|MORTGAGE|LENDING|CONSUMER\s*FIN|AUTO\s*FIN|\bFINANCE\b|^FIN$/i.test(s)) return 'BANKS_NBFC';
  if (/INSURANCE|REINSURANCE/.test(s)) return 'FINANCIAL_OTHER';
  if (/SOFTWARE/.test(s)) return 'IT_SOFTWARE';
  if (/IT\s*-\s*SERVICE|IT\s*SERVICE|INFOTECH/.test(s)) return 'IT_SERVICES';
  if (/PHARMA|BIOTECH|HEALTHCARE|HOSPITAL|DIAGNOSTIC|MEDICAL/.test(s)) return 'PHARMA_HEALTHCARE';
  if (/SPECIALTY\s*CHEM|CHEMICAL|PETROCHEM|AGROCHEM|FERTILI[SZ]ER/.test(s)) return 'SPECIALTY_CHEM';
  if (/PERSONAL\s*PRODUCT|FOOD|BEVERAGE|HOUSEHOLD|FMCG|CONSUMER\s*STAPLE/.test(s)) return 'CONSUMER_STAPLE';
  if (/RETAIL|APPAREL|TEXTILE|JEWELLERY|JEWELRY|LEISURE|HOTEL|RESTAURANT|ENTERTAINMENT|CONSUMER\s*DURABLE/.test(s)) return 'CONSUMER_DISCRETIONARY';
  if (/AUTOMOBILE|AUTO\s*COMP|AUTOMOTIVE|VEHICLE/.test(s)) return 'AUTO_AUTO_COMP';
  if (/CAPITAL\s*GOODS|ELECTRICAL\s*EQUIP|MACHINERY|ENGINEERING/.test(s)) return 'CAPITAL_GOODS';
  if (/INDUSTRIAL\s*PRODUCT|INDUSTRIAL\s*MANUFACT|COMMERCIAL\s*SERV|TRANSPORT\s*INFRA|TRANSPORT\s*SERV|AEROSPACE|DEFENSE|DEFENCE/.test(s)) return 'INDUSTRIAL';
  if (/POWER|UTILITIES|RENEWABLE/.test(s)) return 'INFRA_POWER';
  if (/INFRA|CONSTRUCT/.test(s)) return 'INFRA_POWER';
  if (/CONSTRUCTION\s*MATERIAL|CEMENT|TILE|CERAMIC/.test(s)) return 'CEMENT';
  if (/REALTY|REAL\s*ESTATE|RESIDENTIAL|COMMERCIAL\s*PROJECT/.test(s)) return 'REALTY';
  if (/METAL|STEEL|IRON|ALUMIN|COPPER|ZINC|MINING|MINERAL|FERROUS|DIVERSIFIED\s*METAL/.test(s)) return 'CYCLICAL_METAL';
  if (/TELECOM/.test(s)) return 'TELECOM';
  if (/OIL|GAS|PETROLEUM|CRUDE/.test(s)) return 'OIL_GAS';
  if (/FINTECH|CAPITAL\s*MARKET|EXCHANGE/.test(s)) return 'FINANCIAL_OTHER';
  return 'DEFAULT';
}

/** Get assumptions for a sector text. */
export function getAssumptions(sector?: string): SectorAssumption {
  return SECTOR_ASSUMPTIONS[classifySector(sector)];
}
