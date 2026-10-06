'use client';
// zzz927 — Price / Fair value / Upside cells for the focus-list tables. The numbers come from lib/gu-fair-value (the auto-valuation method on
// the company figures the page already read; no model call). A missing or implausible input shows a dash and the reason on hover.
import React from 'react';
import { R } from './gu-tokens';
import { fvTooltip, fmtPrice, fmtUpside, type FvResult } from '@/lib/gu-fair-value';

export const FV_HEAD = ['Price', 'Fair value', 'Upside'];
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
        <td style={dim} title={tip}>—<div style={{ fontSize: 10.5, maxWidth: 150, whiteSpace: 'normal', lineHeight: 1.25 }}>{shortReason(fv.reason)}</div></td>
        <td style={dim} title={tip}>—</td>
      </>
    );
  }
  const up = fv.base.upsidePct;
  const col = up >= 15 ? R.green : up <= -15 ? R.red : R.dim;
  const chk = fv.checks.length > 0;
  return (
    <>
      <td style={{ ...td, whiteSpace: 'nowrap' }} title="Share price read from the company page / quote feed (see the fair-value hover for the day).">{fmtPrice(fv.price, fv.currency)}</td>
      <td style={{ ...td, whiteSpace: 'nowrap' }} title={tip}>
        <b>{fmtPrice(fv.base.fair, fv.currency)}</b>
        <div style={{ fontSize: 10.5, color: R.dim }}>{fmtPrice(fv.bear?.fair, fv.currency)} – {fmtPrice(fv.bull?.fair, fv.currency)}</div>
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }} title={tip}>
        <b style={{ color: col }}>{fmtUpside(up)}</b>
        {chk ? <div style={{ fontSize: 10.5, color: R.amber, fontWeight: 700 }} title={fv.checks.join('\n')}>check</div> : null}
      </td>
    </>
  );
}
const shortReason = (s: string | null): string => {
  const t = String(s || '').replace(/\s+/g, ' ');
  return t.length > 70 ? `${t.slice(0, 67)}…` : t;
};
