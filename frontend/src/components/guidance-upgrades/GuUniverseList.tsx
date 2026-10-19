'use client';
// zzz848 — simple numbered list of active guidance records. Each row expands to the source, date, wording, period, type, verification and link.
import React, { useState } from 'react';
import type { GuUniverseRecord } from '@/lib/guidance-universe-types';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { primaryDisplay, metricShort, eventTags, recordPeriodUnclear, PERIOD_UNCLEAR_HINT, PERIOD_UNCLEAR_LABEL } from '@/lib/guidance-upgrades-format';
import { cohortLabel, reasonsPlain, recordBasis, recordBadge, recordReconcileLines, type GuRecX } from './gu-ui';
import { R, box } from './gu-tokens';
import { Chip, VerBadge, BasisLine, LastVerified, btn } from './GuBits';
import { GuCompanyDetail } from './GuCompanyDetail';

const TONE = { green: R.green, red: R.red, amber: R.amber } as const;
const MOBILE_LIMIT = 25;

export function GuUniverseList({ records, showMarket, limit = MOBILE_LIMIT, onFull, emptyText, onShownChange }: { records: GuUniverseRecord[]; showMarket?: boolean; limit?: number; onFull?: (c: GgCompany) => void; emptyText?: string; /** zzz1120: how many rows are on screen */ onShownChange?: (n: number) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll0] = useState(false);
  const setAll = (v: boolean) => { setAll0(v); onShownChange?.(v || !limit ? records.length : Math.min(limit, records.length)); };
  if (!records.length) return <div style={{ fontSize: 12.5, color: R.dim }}>{emptyText || 'Nothing matches this view.'}</div>;
  const list = limit && !all ? records.slice(0, limit) : records;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {list.map((r, i) => {
          const x = r as GuRecX;
          const b = recordBadge(x);
          const reasons = reasonsPlain(x);
          const basis = recordBasis(x);
          const id = r.record.id;
          const isOpen = open === id;
          const sec = r.alsoDisplay || [];
          const recon = recordReconcileLines(x);
          return (
            <li key={id} className="gu-card" style={box({ padding: '6px 10px' })}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', width: '100%', fontSize: 14 }}>
                <span style={{ color: R.dim, minWidth: 22 }}>{i + 1}.</span>
                <b>{r.record.company}</b>
                <span>— {primaryDisplay(r)} {metricShort(r.metric || r.record.primary?.metric)}{sec.map((a) => ` / ${a.display} ${metricShort(a.metric)}`).join('')}</span>
                <VerBadge b={b} />
                {x.cohort && <span title="Annual, multi-year CAGR and quarterly figures are not comparable with each other."><Chip color={R.grey} dashed>{cohortLabel(x.cohort)}</Chip></span>}
                <span style={{ fontSize: 12.5, color: R.dim }}>{r.record.primary?.period || ''}{showMarket ? ` · ${r.record.market === 'IN' ? 'India' : r.record.market === 'US' ? 'USA' : ''}` : ''}</span>
                {recordPeriodUnclear(r) && <span title={PERIOD_UNCLEAR_HINT}><Chip color={R.grey} dashed>{PERIOD_UNCLEAR_LABEL}</Chip></span>}
                {eventTags(r).map((t) => <Chip key={t.label} color={TONE[t.tone]} title={t.tip}>{t.label}</Chip>)}
                <span aria-hidden style={{ marginLeft: 'auto', color: R.dim, fontSize: 12 }}>{isOpen ? 'Hide' : 'Details'}</span>
              </button>
              {/* zzz1136 (R6) — a figure that is most likely one business says so beside the row (the verified badge is about the source) */}
              {((x as any).points || []).filter((p: any) => p?.scopeHeldReason).map((p: any, k: number) => (
                <div key={`sh-${k}`} data-gu-scope-held style={{ fontSize: 12, color: R.amber, paddingLeft: 30 }}>⚠ {p.display}: {p.scopeHeldReason}.</div>
              ))}
              {(basis?.line || reasons.length > 0 || recon.length > 0 || x.lastVerified || x.lastVerifiedDaysAgo != null) && (
                <div style={{ display: 'grid', gap: 1, paddingLeft: 30, marginTop: 2 }}>
                  <BasisLine t={basis} />
                  {reasons.length > 0 && <div style={{ fontSize: 12, color: R.amber }}><b>{x.listBucket === 'CLAIMS' ? 'Why not verified:' : 'Needs review:'}</b> {reasons.join(' ')}</div>}
                  {recon.map((l, k) => <div key={k} data-gu-reconcile style={{ fontSize: 12, color: l.tone === 'red' ? R.red : l.tone === 'amber' ? R.amber : R.dim }}>{l.text}</div>)}
                  <LastVerified r={x} />
                </div>
              )}
              {isOpen && <GuCompanyDetail r={r} onFull={onFull} />}
            </li>
          );
        })}
      </ol>
      {limit && records.length > limit && (
        <div className="gu-noprint"><button type="button" style={btn()} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${records.length}`}</button></div>
      )}
    </div>
  );
}
