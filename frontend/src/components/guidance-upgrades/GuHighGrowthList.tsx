'use client';
// zzz849 — the SHORT compact active high-growth list: rank, company, guidance, period, verification mark, Details.
import React, { useState } from 'react';
import type { HighGrowthRow } from '@/lib/guidance-upgrades-format';
import { PERIOD_UNCLEAR_HINT, PERIOD_UNCLEAR_LABEL, eventTags } from '@/lib/guidance-upgrades-format';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { R, box } from './gu-tokens';
import { Chip, btn } from './GuBits';
import { GuCompanyDetail } from './GuCompanyDetail';

export const MARK_COLOR = { '✓': R.green, '◐': R.amber, '○': R.grey } as Record<string, string>;
const TONE = { green: R.green, red: R.red, amber: R.amber } as const;
const SHORT = 10;

export function GuHighGrowthList({ rows, showMarket, onFull, emptyText }: { rows: HighGrowthRow[]; showMarket?: boolean; onFull?: (c: GgCompany) => void; emptyText: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!rows.length) return <div style={{ fontSize: 13, color: R.dim }}>{emptyText}</div>;
  const list = all ? rows : rows.slice(0, SHORT);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {list.map((h, i) => {
          const isOpen = open === h.key;
          const tags = h.rec ? eventTags(h.rec) : [];
          return (
            <li key={h.key} className="gu-card" style={box({ padding: '6px 10px' })}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 14 }}>
                <span style={{ color: R.dim, minWidth: 22 }}>{i + 1}.</span>
                <b>{h.company}</b>
                <span>{h.guidance}</span>
                <span style={{ fontSize: 12.5, color: R.dim }}>{h.period || ''}{showMarket && h.market ? ` · ${h.market === 'IN' ? 'India' : h.market === 'US' ? 'USA' : ''}` : ''}</span>
                {h.periodUnclear && <span title={PERIOD_UNCLEAR_HINT}><Chip color={R.grey} dashed>{PERIOD_UNCLEAR_LABEL}</Chip></span>}
                <span style={{ color: MARK_COLOR[h.glyph], fontWeight: 900 }} aria-label={h.markLabel} title={h.markLabel}>{h.glyph}</span>
                {tags.map((t) => <Chip key={t.label} color={TONE[t.tone]} title={t.tip}>{t.label}</Chip>)}
                <span style={{ marginLeft: 'auto' }}>
                  {h.rec
                    ? <button type="button" className="gu-noprint" style={btn()} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : h.key)}>{isOpen ? 'Hide' : 'Details'}</button>
                    : <span style={{ fontSize: 12, color: R.dim }}>Details in the universe below</span>}
                </span>
              </div>
              {isOpen && h.rec && <GuCompanyDetail r={h.rec} onFull={onFull} />}
            </li>
          );
        })}
      </ol>
      {rows.length > SHORT && <div className="gu-noprint"><button type="button" style={btn()} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button></div>}
    </div>
  );
}
