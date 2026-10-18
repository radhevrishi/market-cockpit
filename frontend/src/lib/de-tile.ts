// zzz1089 — the DEBT / EQUITY tile for an India Earnings Opportunities card, with the kind of financial company taken into account
// and a fallback figure from the company's own screener.in page when the stock-screener snapshot has none. Pure.
//   bank                    → "n/a (bank)" — deposits are a bank's raw material
//   NBFC / broker / insurer → borrowings ÷ equity shown as LEVERAGE (green ≤ 3×, amber ≤ 6×, red above)
//   anyone else             → the normal cell (green ≤ 0.5×, amber ≤ 1×, red above; "debt-free", "negative equity")
import { deCell, DE_NEG_EQUITY, type MetricTone } from './cb-metric-view';
import { financialKindOfRow } from './india-eo-card-data';
import { finSubKind, leverageTone, FIN_KIND_WORD } from './fin-kind';

export interface DeTileView { text: string; tone: MetricTone; sub: string; title: string }
export interface DeFallback { de: number | null; deBasis: string | null; pending?: boolean; error?: string | null }

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function deTileView(r: any, snap: { de: number; basis: string } | null | undefined, fb?: DeFallback | null): DeTileView {
  const fk = financialKindOfRow(r);
  const sub = fk ? finSubKind(r, true) : null;
  const val = snap && fin(snap.de) ? { de: snap.de, basis: snap.basis, src: 'stock-screener snapshot' }
    : fb && fin(fb.de) ? { de: fb.de, basis: fb.deBasis || 'company page', src: "the company's screener.in page" } : null;
  if (!val) {
    if (fb?.pending) return { text: '…', tone: 'none', sub: 'reading the company page', title: 'Debt ÷ equity is being read from the company’s screener.in page.' };
    return { text: '—', tone: 'none', sub: fb?.error ? 'no balance sheet found' : 'not in source yet', title: `Debt ÷ equity: neither the stock-screener snapshot nor the company's screener.in page has a balance sheet for this company${fb?.error ? ` (${fb.error})` : ''}. Not a fail.` };
  }
  // zzz1091 — a bank shows its borrowings (deposits NOT counted) ÷ equity, neutral colour: a figure, not a test
  if (sub === 'bank') return { text: `${val.de.toFixed(2)}×`, tone: leverageTone(val.de), sub: `bank · borrowings excl. deposits · ${val.basis}`, title: `Borrowings ÷ equity ${val.de.toFixed(2)}× (${val.basis}; from ${val.src}). Customer deposits are not counted — they are a bank's raw material, so this is not a debt test; judge a bank on capital adequacy and asset quality. Colour: green up to 3×, amber up to 6×, red above.` };
  if (sub === 'nbfc' || sub === 'broker' || sub === 'insurer') {
    const word = FIN_KIND_WORD[sub];
    if (val.de >= DE_NEG_EQUITY) return { text: 'negative equity', tone: 'bad', sub: val.basis, title: `Shareholders' equity is negative (${val.basis}).` };
    return { text: `${val.de.toFixed(2)}×`, tone: leverageTone(val.de), sub: `${word} leverage · ${val.basis}`, title: `Borrowings ÷ equity ${val.de.toFixed(2)}× (${val.basis}; from ${val.src}). For a ${word} this is leverage, not a warning by itself: green up to 3×, amber up to 6×, red above.` };
  }
  const c = deCell(val.de, val.basis, false);
  return { text: c.text, tone: c.tone, sub: sub === 'asset-light' ? `${val.basis} · ${FIN_KIND_WORD['asset-light']}` : val.basis, title: `${c.title} Source: ${val.src}.` };
}

/** zzz1089 — the same rules as a compact cell (Conviction Beats chip / table): bank n/a, NBFC / broker / insurer as leverage. */
export function deCellFor(de: unknown, basis: unknown, row: any, isFinancial: boolean): { label: string; text: string; tone: MetricTone; title: string } {
  if (!isFinancial) return deCell(de, basis, false);
  const sub = finSubKind(row, true);
  if (sub === 'asset-light') return deCell(de, basis, false);
  if (sub === 'bank') return fin(de) && de >= 0
    ? { label: 'D/E', text: `${de.toFixed(2)}× bank`, tone: leverageTone(de), title: `Borrowings ÷ equity ${de.toFixed(2)}× — deposits not counted (a bank's raw material), so not a debt test.` }
    : { label: 'D/E', text: 'n/a (bank)', tone: 'none', title: 'Debt ÷ equity is not meaningful for a bank: customer deposits are its raw material.' };
  if (!fin(de) || de < 0) return { label: 'D/E', text: 'n/a', tone: 'none', title: 'Leverage (borrowings ÷ equity) is not in the source for this company yet. Not a fail.' };
  const word = FIN_KIND_WORD[sub || 'nbfc'];
  const b = typeof basis === 'string' && basis ? ` (${basis})` : '';
  return { label: 'D/E', text: `${de.toFixed(2)}× lev.`, tone: leverageTone(de), title: `Borrowings ÷ equity ${de.toFixed(2)}×${b} — leverage for a ${word}: green up to 3×, amber up to 6×, red above.` };
}
