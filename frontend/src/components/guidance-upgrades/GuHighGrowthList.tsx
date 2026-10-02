'use client';
// zzz849 — the SHORT compact active high-growth list: rank, company, guidance, period, verification mark, Details.
import React, { useState } from 'react';
import type { HighGrowthRow } from '@/lib/guidance-upgrades-format';
import { PERIOD_UNCLEAR_HINT, PERIOD_UNCLEAR_LABEL, eventTags } from '@/lib/guidance-upgrades-format';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { R, box, tint, TONE_COLOR } from './gu-tokens';
import { Chip, VerBadge, BasisLine, btn } from './GuBits';
import type { GuHgGroupRow, GuUniverseRecord } from '@/lib/guidance-universe-types';
import { COHORT_HINT, COHORT_LABEL, COHORT_ORDER, UNKNOWN, basisText, groupRowText, metricBadge, rowBadge, sourceDisplayName, type CohortRows } from './gu-ui';
import { GuCompanyDetail } from './GuCompanyDetail';

export const MARK_COLOR = { '✓': R.green, '◐': R.amber, '◑': R.violet, '⚠': R.red, '○': R.grey } as Record<string, string>;
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


const metricName = (m: string) => (m === 'PAT' ? 'PAT' : m ? m.charAt(0) + m.slice(1).toLowerCase() : '');

/** zzz853: rows of one section, split by cohort. Annual, multi-year CAGR and quarterly are never mixed into one ranking. */
export function GuGroupList({ cohorts, showMarket, findRecord, onFull, emptyText, limit = SHORT }: {
  cohorts: CohortRows; showMarket?: boolean; findRecord?: (entityKey: string) => GuUniverseRecord | null; onFull?: (c: GgCompany) => void; emptyText: string; limit?: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState<Record<string, boolean>>({});
  const present = COHORT_ORDER.filter((c) => cohorts[c].length > 0);
  if (!present.length) return <div style={{ fontSize: 13, color: R.dim }}>{emptyText}</div>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {present.map((c) => {
        const rows: GuHgGroupRow[] = cohorts[c];
        const list = all[c] ? rows : rows.slice(0, limit);
        return (
          <div key={c} role="group" aria-label={COHORT_LABEL[c]} style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: R.dim, textTransform: 'uppercase' }} title={COHORT_HINT[c]}>{COHORT_LABEL[c]} <span style={{ fontWeight: 600 }}>({rows.length})</span> <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— {COHORT_HINT[c]}</span></div>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {list.map((h, i) => {
                const key = `${c}:${h.id}`;
                const rec = findRecord ? findRecord(h.entityKey) : null;
                const isOpen = open === key;
                const b = rowBadge(h);
                return (
                  <li key={key} className="gu-card" style={box({ padding: '8px 12px', borderLeft: `3px solid ${TONE_COLOR[b.tone as keyof typeof TONE_COLOR] || R.grey}` })}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
                      <span style={{ minWidth: 24, height: 24, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 800, color: R.dim, background: tint(R.grey, 12) }}>{i + 1}</span>
                      <b style={{ fontSize: 14.5 }}>{h.company}</b>
                      <span style={{ fontWeight: 800, color: b.tone === 'green' ? R.green : b.tone === 'violet' ? R.violet : b.tone === 'amber' ? R.amber : R.text }}>{groupRowText(h)}</span>
                      <span style={{ fontSize: 12.5, color: R.dim }}>{h.headline?.periodNormalized || h.headline?.period || ''}{showMarket ? ` · ${h.market === 'IN' ? 'India' : h.market === 'US' ? 'USA' : ''}` : ''}</span>
                      <VerBadge b={b} />
                      {rec && <span style={{ marginLeft: 'auto' }}><button type="button" className="gu-noprint" style={btn()} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>{isOpen ? 'Hide' : 'Details'}</button></span>}
                    </div>
                    <div style={{ display: 'grid', gap: 1, marginTop: 4, paddingLeft: 32 }}>
                      {(h.metrics || []).map((m, j) => (
                        <div key={j} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 54 }}>{metricName(m.metric)}</span>
                          <VerBadge b={metricBadge(m)} compact />
                          <BasisLine t={basisText(m)} />
                        </div>
                      ))}
                      <div style={{ fontSize: 11.5, color: R.dim }}>{h.sourceName ? `Source: ${sourceDisplayName(h.sourceName)}${h.sourceDate ? `, ${String(h.sourceDate).slice(0, 10)}` : ''}` : `Source: ${UNKNOWN}`}</div>
                    </div>
                    {isOpen && rec && <GuCompanyDetail r={rec} onFull={onFull} />}
                  </li>
                );
              })}
            </ol>
            {rows.length > limit && <div className="gu-noprint"><button type="button" style={btn()} onClick={() => setAll((v) => ({ ...v, [c]: !v[c] }))}>{all[c] ? 'Show fewer' : `Show all ${rows.length}`}</button></div>}
          </div>
        );
      })}
    </div>
  );
}
