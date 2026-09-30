'use client';
// zzz846 — the simple headline table: # | Company | Revenue growth | PAT growth | Guidance period | Status.
import React from 'react';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { LIST_HEADERS, fmtGrowth, isAnalyst, isMuted, pointFor } from '@/lib/growth-guidance-format';
import { R } from './gg-tokens';
import { Chip, StatusDotView } from './GgBits';

export function GgList({ items, onOpen }: { items: GgCompany[]; onOpen: (id: string) => void }) {
  return (
    <div className="gg-scroll">
      <table className="gg-table">
        <thead><tr>{LIST_HEADERS.map((h) => <th key={h}>{h === 'Status' ? 'Status' : h}</th>)}</tr></thead>
        <tbody>
          {items.map((c, i) => {
            const analyst = isAnalyst(c.primary?.kind);
            const muted = isMuted(c.validity);
            return (
              <tr key={c.id} className="gg-row" tabIndex={0} role="button" onClick={() => onOpen(c.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c.id); } }}
                style={{ opacity: muted ? 0.6 : 1, outline: analyst ? `1px dashed ${R.violet}` : undefined }}>
                <td style={{ color: R.dim }}>{i + 1}</td>
                <td>
                  <b>{c.company}</b> <span style={{ fontSize: 11, color: R.dim }}>{c.ticker || 'ticker not resolved'}</span>
                  {c.portfolio?.held && <> <Chip color={R.green}>IN PORTFOLIO</Chip></>}
                  {analyst && <> <Chip color={R.violet} dashed title="Analyst number. Not management guidance.">ANALYST</Chip></>}
                  {muted && <> <Chip color={R.grey} dashed>{c.validity}</Chip></>}
                  {c.conflict && <> <Chip color={R.amber} dashed>SOURCE CONFLICT</Chip></>}
                </td>
                <td style={{ fontWeight: 700 }}>{fmtGrowth(pointFor(c, 'REVENUE'))}</td>
                <td style={{ fontWeight: 700 }}>{fmtGrowth(pointFor(c, 'PAT'))}</td>
                <td>{c.primary?.period || '—'}</td>
                <td><StatusDotView c={c} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
