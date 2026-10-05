'use client';
// zzz880 — FOCUS LIST at the top of the guidance page: the companies to look at first, ranked, one plain line each.
import React, { useMemo, useState } from 'react';
import { R, tint } from './gu-tokens';
import { pillStyle } from './GuPanel';
import { useGuUniverse } from './useGuUniverse';
import { buildFocusList, type FocusVerdict } from '@/lib/gu-focus';
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';

const VERDICT_COLOR: Record<FocusVerdict, string> = { 'TOP FOCUS': R.green, 'STRONG RAISE': R.green, 'HIGH GROWTH': R.cyan, RAISED: R.violet, WATCH: R.grey };
const FLAG = { IN: '🇮🇳', US: '🇺🇸' } as const;
type Mk = 'ALL' | 'IN' | 'US';

export function GuFocusList({ events, window, onOpen }: { events: readonly GuidanceEvent[]; window: string; onOpen: (id: string) => void }) {
  const { data } = useGuUniverse({ market: 'ALL', view: 'active' });
  const [mk, setMk] = useState<Mk>('ALL');
  const all = useMemo(() => buildFocusList(data?.summary?.highGrowthGroups, events, new Date(), 60), [data, events]);
  const rows = useMemo(() => all.filter((r) => mk === 'ALL' || r.market === mk).slice(0, 15), [all, mk]);
  const top = all.filter((r) => r.verdict === 'TOP FOCUS').length;
  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 800, color: R.dim, borderBottom: `1px solid ${tint(R.grey, 40)}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { textAlign: 'left', padding: '8px', fontSize: 13, borderBottom: `1px solid ${tint(R.grey, 18)}`, verticalAlign: 'top' };
  return (
    <section data-gu-focus aria-label="Focus list" style={{ border: `2px solid ${tint(R.green, 55)}`, borderRadius: 10, padding: '12px 14px', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 16 }}>🎯 Focus list — the companies to look at first</b>
        <span style={{ fontSize: 12.5, color: R.dim }}>
          {all.length ? `${top} with both a guidance raise and 30%+ growth guided · ${all.length} names in total` : 'Loading…'}
        </span>
        <span role="group" aria-label="Market" style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {(['ALL', 'IN', 'US'] as Mk[]).map((k) => (
            <button key={k} type="button" style={pillStyle(mk === k, R.green)} aria-pressed={mk === k} onClick={() => setMk(k)}>
              {k === 'ALL' ? 'All' : k === 'IN' ? 'India' : 'USA'} ({k === 'ALL' ? all.length : all.filter((r) => r.market === k).length})
            </button>
          ))}
        </span>
      </div>
      <div style={{ fontSize: 12, color: R.dim }}>
        Ranked by: a guidance raise <b>and</b> 30%+ growth guided first, then the size of the raise and of the growth, then how recent. Raises are from the {window} window chosen below; growth guidance is everything still in force. Only figures checked against the company's own documents.
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: R.dim }}>{all.length ? 'No names for this market in the current data.' : 'Reading the guidance data…'}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={th}>#</th><th style={th}>Company</th><th style={th}>Guidance raised</th><th style={th}>Growth guided</th><th style={th}>Verdict</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td style={{ ...td, color: R.dim, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                  <td style={td}>
                    <b>{r.company}</b>
                    <div style={{ fontSize: 11.5, color: R.dim }}>{FLAG[r.market]} {r.ticker || ''}</div>
                  </td>
                  <td style={td}>
                    {r.raised ? (
                      <button type="button" onClick={() => r.eventId && onOpen(r.eventId)} title="Open the full check"
                        style={{ all: 'unset', cursor: r.eventId ? 'pointer' : 'default', color: R.text }}>
                        {r.raised}
                        <div style={{ fontSize: 11.5, color: R.dim }}>{r.raiseDate}</div>
                      </button>
                    ) : <span style={{ color: R.dim }}>—</span>}
                  </td>
                  <td style={td}>
                    {r.growth ? (<>
                      <b style={{ color: R.green }}>{r.growth}</b>
                      <div style={{ fontSize: 11.5, color: R.dim }}>{r.growthPeriod || ''}{r.growthTrust === 'derived' ? ' · worked out from company numbers' : ' · stated by company'}</div>
                    </>) : <span style={{ color: R.dim }}>—</span>}
                  </td>
                  <td style={td}>
                    <b style={{ color: VERDICT_COLOR[r.verdict], whiteSpace: 'nowrap' }}>{r.verdict}</b>
                    <div style={{ fontSize: 11.5, color: R.dim }}>{r.why}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
