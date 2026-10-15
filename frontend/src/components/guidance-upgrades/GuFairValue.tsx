'use client';
// zzz927 — Price / Fair value / Upside cells for the focus-list tables. The numbers come from lib/gu-fair-value (the auto-valuation method on
// the company figures the page already read; no model call). A missing or implausible input shows a dash and the reason on hover.
import React from 'react';
import { R } from './gu-tokens';
import { fvTooltip, fmtPrice, fmtUpside, fvStatus, type FvResult } from '@/lib/gu-fair-value';

export const FV_HEAD = ['Price', 'Model fair value', 'Model upside'];
export const FV_COLS = 3;

/** One result per row: null while the company figures are still being read. */
export function FvCells({ fv, waiting, td }: { fv: FvResult | null; waiting: boolean; td: React.CSSProperties }) {
  if (!fv) {
    const w = waiting ? '…' : '—';
    return <><td style={{ ...td, color: R.dim }}>{w}</td><td style={{ ...td, color: R.dim }}>{w}</td><td style={{ ...td, color: R.dim }}>{w}</td></>;
  }
  const tip = fvTooltip(fv);
  const dim: React.CSSProperties = { ...td, color: R.dim, whiteSpace: 'nowrap' };
  if (!fv.ok || !fv.base) {
    return (
      <>
        <td style={{ ...td, whiteSpace: 'nowrap' }} title={fv.price != null ? `Price read from the company page / quote feed.` : tip}>{fmtPrice(fv.price, fv.currency)}</td>
        <td colSpan={2} style={{ ...dim, whiteSpace: 'normal', fontSize: 11.5, fontStyle: 'italic' }} title={tip}>No fair value: {shortReason(fv.reason)}</td>
      </>
    );
  }
  const up = fv.base.upsidePct;
  const st = fvStatus(up);
  const col = up >= 15 ? R.green : up <= -15 ? R.red : R.dim;
  const chk = fv.checks.length > 0;
  return (
    <>
      <td style={{ ...td, whiteSpace: 'nowrap' }} title="Share price read from the company page / quote feed (see the fair-value hover for the day).">{fmtPrice(fv.price, fv.currency)}</td>
      <td style={{ ...td, whiteSpace: 'nowrap' }} title={tip}>
        <b>{fmtPrice(fv.base.fair, fv.currency)}</b>
        <div style={{ fontSize: 10.5, color: R.dim }}>{fmtPrice(fv.bear?.fair, fv.currency)} – {fmtPrice(fv.bull?.fair, fv.currency)}</div>
        <div style={{ fontSize: 10.5, color: R.dim }}>{fv.basis === 'history' ? 'Historical-growth model' : 'Guidance-based model'}</div>
        {fv.inputs.some((v) => v.includes('latest quarter × 4 used as the yearly base')) ? <div style={{ fontSize: 10.5, color: R.amber }}>Quarter ×4 base</div> : null}
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }} title={tip}>
        <b style={{ color: col }}>{fmtUpside(up)}</b>
        <div style={{ fontSize: 10.5, color: st.key === 'below' ? R.green : st.key === 'near' ? R.dim : R.amber, fontWeight: 700, whiteSpace: 'normal', maxWidth: 120, lineHeight: 1.25 }}>
          {st.label}{fv.marketPe != null && st.key === 'far-above' ? ` (~${Math.round(fv.marketPe)}× profit today)` : ''}
        </div>
        {chk ? <div style={{ fontSize: 10.5, color: R.amber, fontWeight: 700 }} title={fv.checks.join('\n')}>check ⓘ</div> : null}
      </td>
    </>
  );
}
// zzz934: a short, whole phrase for each reason (the full sentence stays on hover) — no more cut-off text
const SHORT: Array<[RegExp, string]> = [
  [/bank, lender or insurer/, 'lender / insurer — needs book value'],
  [/blank-cheque|SPAC/, 'blank-cheque company'],
  [/share price not available/, 'price not read yet'],
  [/market value not available/, 'market value not read'],
  [/yearly sales not available/, 'sales not read'],
  [/no growth rate guided and no sales history/, 'no growth figure to project'],
  [/only (\d) valuation method/, 'not enough usable valuation methods — not shown'],
  [/more than \+\d+%/, 'model result too high — not shown'],
  [/below -\d+%/, 'market far above any sector multiple'],
  [/outside the plausible range/, 'projection implausible — not shown'],
  [/company figures not (?:found|read)/, 'company figures not read'],
];
const shortReason = (s: string | null): string => {
  const t = String(s || '').replace(/\s+/g, ' ');
  for (const [re, w] of SHORT) if (re.test(t)) return w;
  return t.length > 70 ? `${t.slice(0, 67)}…` : t;
};
