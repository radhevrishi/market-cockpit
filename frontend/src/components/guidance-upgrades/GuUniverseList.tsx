'use client';
// zzz848 — simple numbered list of active guidance records. Each row expands to the source, date, wording, period, type, verification and link.
import React, { useState } from 'react';
import type { GuUniverseRecord } from '@/lib/guidance-universe-types';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { primaryDisplay, metricShort, verificationMark, verificationTooltip } from '@/lib/guidance-upgrades-format';
import { kindLabel, verificationText } from '@/lib/growth-guidance-format';
import { R, box, tint } from './gu-tokens';
import { Chip, btn } from './GuBits';

const MARK_COLOR = { '✓': R.green, '◐': R.amber, '○': R.grey } as Record<string, string>;

function Detail({ r, onFull }: { r: GuUniverseRecord; onFull?: (c: GgCompany) => void }) {
  const c = r.record;
  const p = c.primary;
  const srcs = c.sources || [];
  return (
    <div style={{ borderTop: `1px solid ${R.border}`, marginTop: 6, paddingTop: 6, display: 'grid', gap: 4, fontSize: 12, color: R.text }}>
      <div><b>Period</b> {p?.period || '—'} · <b>Type</b> {p ? kindLabel(p.kind) : '—'} · <b>Verification</b> {verificationText(c.verification)}{r.mediaOnly ? ' (primary source pending)' : ''}</div>
      {p?.originalStatement && p.originalStatement.trim() && (
        <blockquote style={{ margin: 0, padding: '4px 10px', borderLeft: `3px solid ${R.cyan}`, background: tint(R.cyan, 6), fontStyle: 'italic', overflowWrap: 'anywhere' }}>“{p.originalStatement}”</blockquote>
      )}
      {c.driverText && c.driverText.trim() && <div><b>Why</b> {c.driverText}</div>}
      {srcs.length === 0 && <div style={{ color: R.dim }}>No source listed.</div>}
      {srcs.map((s, i) => (
        <div key={i}>
          <b>Source</b> {s.name} · {s.type}{s.primary ? ' (primary)' : ' (secondary)'} · <b>Date</b> {s.date ? s.date.slice(0, 10) : '—'}{' '}
          {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>Open link</a> : <span style={{ color: R.dim }}>no link</span>}
        </div>
      ))}
      {onFull && <div className="gu-noprint"><button type="button" style={btn()} onClick={() => onFull(c)}>Full growth guidance detail</button></div>}
    </div>
  );
}

export function GuUniverseList({ records, showMarket, limit, onFull, emptyText }: { records: GuUniverseRecord[]; showMarket?: boolean; limit?: number; onFull?: (c: GgCompany) => void; emptyText?: string }) {
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
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', width: '100%', fontSize: 13.5 }}>
                <span style={{ color: R.dim, minWidth: 22 }}>{i + 1}.</span>
                <b>{r.record.company}</b>
                <span>— {primaryDisplay(r)} {metricShort(r.metric || r.record.primary?.metric)}{sec.map((a) => ` / ${a.display} ${metricShort(a.metric)}`).join('')}</span>
                <span title={verificationTooltip(r)} style={{ color: MARK_COLOR[m.glyph], fontWeight: 900 }} aria-label={m.label}>{m.glyph}</span>
                <span style={{ fontSize: 11.5, color: R.dim }}>{r.record.primary?.period || ''}{showMarket ? ` · ${r.record.market === 'IN' ? 'India' : r.record.market === 'US' ? 'USA' : ''}` : ''}</span>
                {r.revision === 'RAISED' && <Chip color={R.green}>RAISED</Chip>}
                {r.revision === 'LOWERED' && <Chip color={R.red}>CUT</Chip>}
                {r.atRisk && <Chip color={R.amber}>AT RISK</Chip>}
                <span aria-hidden style={{ marginLeft: 'auto', color: R.dim, fontSize: 11 }}>{isOpen ? 'Hide' : 'Details'}</span>
              </button>
              {isOpen && <Detail r={r} onFull={onFull} />}
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
