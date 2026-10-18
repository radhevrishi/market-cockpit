// zzz1089 — which KIND of financial company a card is, for the two cash / debt tiles. The earnings engine marks every company in
// the "Financial Services" sector as a lender, so an asset manager (CRAMC), a payments / fintech company (MPIMANIPAL) or a broker
// showed "n/a (lender)" for both debt ÷ equity and cash conversion. Only for a BANK is debt ÷ equity truly not meaningful
// (deposits are its raw material). For an NBFC or a broker it is leverage — shown, on lender thresholds. For an asset manager,
// fintech, exchange or ratings agency both figures mean what they mean for any company. Read from the industry words, never a
// ticker list. Pure.

export type FinSubKind = 'bank' | 'nbfc' | 'broker' | 'insurer' | 'asset-light' | null;

const txt = (r: any) => [r?.industry, r?.broad_industry, r?.sub_sector, r?.sector, r?.company].filter(Boolean).map(String).join(' | ').replace(/&amp;/g, '&');

export function finSubKind(r: any, isFinancial: boolean): FinSubKind {
  const t = txt(r);
  const ind = [r?.industry, r?.broad_industry, r?.sub_sector].filter(Boolean).map(String).join(' | ');
  if (/asset management|\bamc\b|fintech|financial technology|exchange (?:&|and) data|depositor|rating agenc|credit rating|wealth management|insurance distribution|insurance broking|registrar/i.test(ind)) return 'asset-light';
  if (/stock ?broking|broking|brokerage|capital markets/i.test(ind) && !/bank|nbfc|non banking/i.test(ind)) return 'broker';
  if (/\b(insurance|assurance)\b/i.test(t) && !/\bbank\b/i.test(ind)) return 'insurer';
  if (/\bbank\b/i.test(ind) || (!ind && /\bbank\b/i.test(String(r?.company || '')))) return 'bank';
  if (/nbfc|non[- ]banking|housing finance|micro ?finance|financial institution|finance|lending|leasing|credit/i.test(ind)) return 'nbfc';
  return isFinancial ? 'nbfc' : null;
}

/** Leverage colours for lenders and brokers (borrowings ÷ equity): up to 3× green, up to 6× amber, above red. */
export function leverageTone(de: number): 'good' | 'warn' | 'bad' {
  return de <= 3 ? 'good' : de <= 6 ? 'warn' : 'bad';
}

export const FIN_KIND_WORD: Record<Exclude<FinSubKind, null>, string> = {
  bank: 'bank', nbfc: 'NBFC / lender', broker: 'broker', insurer: 'insurer', 'asset-light': 'asset-light financial',
};
