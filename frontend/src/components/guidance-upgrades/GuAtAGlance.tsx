'use client';
// zzz880 — AT A GLANCE: one plain row per market at the top of the guidance page, numbers straight from the response, with a one-word verdict.
// The detailed data-quality strips, claims table and audits now sit in a fold below it (Rishi: "format can be a lot better").
import React from 'react';
import { R, tint } from './gu-tokens';
import { cohortTotal, sectionRows } from './gu-ui';
import type { GuUniverseExt } from './useGuUniverse';
import { glanceVerdict } from '@/lib/gu-glance';

const NAME = { IN: '🇮🇳 India', US: '🇺🇸 USA' } as const;
const TONE: Record<string, string> = { good: R.green, reading: R.amber, thin: R.amber, none: R.red };

export function GuAtAGlance({ data, threshold }: { data: GuUniverseExt; threshold: number }) {
  const groups = data.summary?.highGrowthGroups;
  const q = (data.extractCoverage as any)?.quality?.markets as Record<'IN' | 'US', { documentsPending?: number }> | undefined;
  const rows = (['IN', 'US'] as const).map((m) => {
    const mv = data.marketViews?.[m];
    const active = mv?.active ?? null;
    const high = groups ? cohortTotal(sectionRows(groups, 'active', m)) : null;
    const verified = groups ? cohortTotal(sectionRows(groups, 'verified', m)) : null;
    const pending = q?.[m]?.documentsPending ?? null;
    return { m, active, high, verified, review: mv?.review ?? null, pending, v: glanceVerdict({ active, high, pending }) };
  });
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 11, fontWeight: 800, color: R.dim, borderBottom: `1px solid ${tint(R.grey, 40)}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 10px', fontSize: 13.5, fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${tint(R.grey, 20)}` };
  const n = (x: number | null) => (x == null ? '—' : x.toLocaleString('en-US'));
  return (
    <div data-gu-glance style={{ border: `1px solid ${tint(R.green, 40)}`, borderRadius: 8, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Market</th>
            <th style={th} title="Company guidance still in force">Guidance in force</th>
            <th style={th} title={`Guided growth of ${threshold}% or more`}>{threshold}%+ growth</th>
            <th style={th} title="Confirmed word for word in the company's own document">Verified</th>
            <th style={th} title="Found, but a check is not finished (period, unit or source)">Needs a check</th>
            <th style={th} title="Company documents collected but not read by the AI yet (each is read once)">Documents to read</th>
            <th style={{ ...th, textAlign: 'left' }}>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.m}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 800 }}>{NAME[r.m]}</td>
              <td style={td}>{n(r.active)}</td>
              <td style={{ ...td, fontWeight: 800, color: R.green }}>{n(r.high)}</td>
              <td style={td}>{n(r.verified)}</td>
              <td style={{ ...td, color: R.dim }}>{n(r.review)}</td>
              <td style={{ ...td, color: (r.pending ?? 0) > 50 ? R.amber : R.dim }}>{n(r.pending)}</td>
              <td style={{ ...td, textAlign: 'left', fontWeight: 800, color: TONE[r.v.tone] }} title={r.v.why}>{r.v.word}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
