'use client';
// zzz848 — simple numbered list of active guidance records. Each row expands to the source, date, wording, period, type, verification and link.
import React, { useState } from 'react';
import type { GuUniverseRecord } from '@/lib/guidance-universe-types';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { primaryDisplay, metricShort, verificationMark, verificationTooltip, eventTags, recordPeriodUnclear, PERIOD_UNCLEAR_HINT, PERIOD_UNCLEAR_LABEL } from '@/lib/guidance-upgrades-format';
import { R, box } from './gu-tokens';
import { Chip, btn } from './GuBits';
import { GuCompanyDetail } from './GuCompanyDetail';
import { MARK_COLOR } from './GuHighGrowthList';

const TONE = { green: R.green, red: R.red, amber: R.amber } as const;
const MOBILE_LIMIT = 25;

export function GuUniverseList({ records, showMarket, limit = MOBILE_LIMIT, onFull, emptyText }: { records: GuUniverseRecord[]; showMarket?: boolean; limit?: number; onFull?: (c: GgCompany) => void; emptyText?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!records.length) return <div style={{ fontSize: 12.5, color: R.dim }}>{emptyText || 'Nothing matches this view.'}</div>;
  const list = limit && !all ? records.slice(0, limit) : records;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {list.map((r, i) => {
          const m = verificationMark(r);
          const id = r.record.id;
          const isOpen = open === id;
          const sec = r.alsoDisplay || [];
          return (
            <li key={id} className="gu-card" style={box({ padding: '6px 10px' })}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', width: '100%', fontSize: 14 }}>
                <span style={{ color: R.dim, minWidth: 22 }}>{i + 1}.</span>
                <b>{r.record.company}</b>
                <span>— {primaryDisplay(r)} {metricShort(r.metric || r.record.primary?.metric)}{sec.map((a) => ` / ${a.display} ${metricShort(a.metric)}`).join('')}</span>
                <span title={verificationTooltip(r)} style={{ color: MARK_COLOR[m.glyph], fontWeight: 900 }} aria-label={m.label}>{m.glyph}</span>
                <span style={{ fontSize: 12.5, color: R.dim }}>{r.record.primary?.period || ''}{showMarket ? ` · ${r.record.market === 'IN' ? 'India' : r.record.market === 'US' ? 'USA' : ''}` : ''}</span>
                {recordPeriodUnclear(r) && <span title={PERIOD_UNCLEAR_HINT}><Chip color={R.grey} dashed>{PERIOD_UNCLEAR_LABEL}</Chip></span>}
                {eventTags(r).map((t) => <Chip key={t.label} color={TONE[t.tone]} title={t.tip}>{t.label}</Chip>)}
                <span aria-hidden style={{ marginLeft: 'auto', color: R.dim, fontSize: 12 }}>{isOpen ? 'Hide' : 'Details'}</span>
              </button>
              {isOpen && <GuCompanyDetail r={r} onFull={onFull} />}
            </li>
          );
        })}
      </ol>
      {limit && records.length > limit && (
        <div className="gu-noprint"><button type="button" style={btn()} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${records.length}`}</button></div>
      )}
    </div>
  );
}
