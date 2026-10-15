'use client';
// zzz1032 — the "Latest result" cell and detail block: the company's latest graded earnings result (Earnings Opportunities and / or
// Conviction Beats), compact in the table, in full in the row detail. Data: lib/screener/latest-result.ts (no fetch here).
import React from 'react';
import NavLink from '@/components/NavLink';   // zzz1052 — prefetch on hover / focus / press, not on scroll-into-view
import { daysSince, profitWord, resultLines, resultLink, shortDate, shownQuarter, type LatestResult, type ResultTier } from '@/lib/screener/latest-result';
import type { ScreenMarket } from '@/lib/screener/types';
import { C } from './pine-ui';

const TIER_STYLE: Record<ResultTier, { fg: string; bg: string }> = {
  BLOCKBUSTER: { fg: C.green, bg: 'var(--pnx-chip-up, #e7f4ee)' },
  STRONG: { fg: C.green, bg: 'var(--pnx-chip-up, #e7f4ee)' },
  GOOD: { fg: C.text1, bg: 'var(--pnx-chip-dim, #f0f2f5)' },
  MIXED: { fg: C.amber, bg: 'var(--pnx-chip-warn, #fbf1e4)' },
  AVOID: { fg: C.red, bg: 'var(--pnx-chip-down, #fbecea)' },
};
export function TierChip({ g }: { g: ResultTier }) {
  const st = TIER_STYLE[g];
  return <span data-tier={g} style={{ display: 'inline-block', padding: '0 5px', borderRadius: 5, fontSize: 10.5, fontWeight: 750, letterSpacing: 0.2, color: st.fg, background: st.bg, lineHeight: '17px' }}>{g}</span>;
}
const sg = (v: number) => `${v > 0 ? '+' : ''}${Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(0)}%`;
const Fig = ({ label, v }: { label: string; v: number | undefined }) => (v === undefined ? null
  : <span style={{ whiteSpace: 'nowrap' }}><span style={{ color: C.dim }}>{label} </span><b style={{ color: v >= 0 ? C.green : C.red, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{sg(v)}</b></span>);

/** The table cell: "Q2 FY27 · 12 Oct · [STRONG] · Sales +24% · PAT +41%" (🏆 = on the Conviction Beats bench). */
export function LatestResultCell({ lr, market, today, loading }: { lr: LatestResult | undefined; market: ScreenMarket; today: string; loading?: boolean }) {
  if (!lr) return <td data-col="result" className="pnx-dim" title={loading ? 'Reading the latest results…' : resultLines(undefined, market, today).join('\n')}>{loading ? '…' : '—'}</td>;
  const tip = resultLines(lr, market, today).join('\n');
  if (!lr.d) return <td data-col="result" title={tip}><span aria-label="On the Conviction Beats bench">🏆</span> <span className="pnx-dim" style={{ fontSize: 11.5 }}>result not on file</span></td>;
  const ago = daysSince(lr.d, today);
  const qc = shownQuarter(lr, market);   // zzz1043 — India: label checked against the filing date; a late one flagged ⚠
  return (
    <td data-col="result" data-result-date={lr.d} title={tip} style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
        {lr.cb ? <span aria-label="On the Conviction Beats bench" title="On the Conviction Beats bench">🏆</span> : null}
        <NavLink href={resultLink(market)} className="pnx-link" style={{ color: C.text1 }} title={`${tip}\n\nOpen ${market === 'US' ? 'US ' : ''}Earnings Opportunities`}>
          {qc.q ? <span>{qc.q}{qc.late ? <span style={{ color: C.amber }} data-late-quarter aria-label={`filed ${qc.late} days after the quarter ended`}> ⚠</span> : null} · </span> : null}<span>{shortDate(lr.d, today)}</span>
        </NavLink>
        {ago != null ? <span className="pnx-dim" style={{ fontSize: 10.5 }}>{ago}d</span> : null}
        {lr.g ? <TierChip g={lr.g} /> : null}
        <Fig label="Sales" v={lr.s} />
        <Fig label={profitWord(market)} v={lr.p} />
      </span>
    </td>
  );
}

/** The row detail's block. */
export function LatestResultDetail({ lr, market, today }: { lr: LatestResult | undefined; market: ScreenMarket; today: string }) {
  const lines = resultLines(lr, market, today);
  return (
    <div data-detail="result">
      <h4 style={{ marginTop: 12 }}>Latest result {lr?.g ? <TierChip g={lr.g} /> : null} {lr?.cb ? <span title="On the Conviction Beats bench">🏆</span> : null}</h4>
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
        {lines.map((l) => <li key={l}>{l}</li>)}
        <li><NavLink href={resultLink(market)} className="pnx-link">Open {market === 'US' ? 'US ' : ''}Earnings Opportunities</NavLink></li>
      </ul>
    </div>
  );
}
