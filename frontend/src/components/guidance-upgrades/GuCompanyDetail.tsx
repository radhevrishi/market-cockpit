'use client';
// zzz849 — company details for one active guidance record. Sections: current guidance, guidance, history, why, next proof, source.
// Every line comes from the record. Nothing is invented; a missing value says so.
import React from 'react';
import type { GuUniverseRecord } from '@/lib/guidance-universe-types';
import type { GgGuidancePoint } from '@/lib/growth-guidance-types';
import { fmtGrowthDisplay, metricShort, recordPeriodUnclear, PERIOD_UNCLEAR_HINT, PERIOD_UNCLEAR_LABEL } from '@/lib/guidance-upgrades-format';
import { kindLabel, verificationText } from '@/lib/growth-guidance-format';
import { R, tint } from './gu-tokens';
import { Chip, btn } from './GuBits';
import type { GgCompany } from '@/lib/growth-guidance-types';

const H = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: R.dim, marginTop: 4 }}>{children}</div>;
const day = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : '—');
const VALIDITY: Record<string, string> = { ACTIVE: 'Active', SUPERSEDED: 'Replaced by newer guidance', ACHIEVED: 'Achieved', MISSED: 'Missed', WITHDRAWN: 'Withdrawn', EXPIRED: 'Expired' };

function backed(r: GuUniverseRecord, p: GgGuidancePoint): boolean {
  if (r.record.primary === p) return r.record.verification === 'VERIFIED' && !r.mediaOnly;
  const a = (r.alsoDisplay || []).find((x) => x.metric === p.metric);
  return (a?.verification ?? r.record.verification) === 'VERIFIED' && !r.mediaOnly;
}
function money(a: NonNullable<GgGuidancePoint['absoluteTarget']>): string { return `${a.currency || ''}${a.value} ${a.unit}`.trim(); }

export function GuCompanyDetail({ r, onFull }: { r: GuUniverseRecord; onFull?: (c: GgCompany) => void }) {
  const c = r.record;
  const pts = [c.primary, ...(c.others || [])].filter((p): p is GgGuidancePoint => !!p);
  const srcs = c.sources || [];
  const primarySrc = srcs.find((s) => s.primary);
  const link = primarySrc?.url || srcs.find((s) => s.url)?.url;
  const available = srcs.some((s) => s.primary);
  const read = typeof r.primarySourceRead === 'boolean' ? r.primarySourceRead : available && c.verification === 'VERIFIED' && !r.mediaOnly;
  const rl = c.reality;
  const hasNumbers = !!rl && [rl.fyActualRevenue, rl.latestQuarterGrowthPct, rl.latestAnnualGrowthPct, rl.ttmRevenue, rl.requiredGrowthFromRunRate].some((n) => typeof n === 'number');
  const hist = [...(c.history || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const unclear = recordPeriodUnclear(r);
  return (
    <div style={{ borderTop: `1px solid ${R.border}`, marginTop: 6, paddingTop: 6, display: 'grid', gap: 3, fontSize: 12.5, color: R.text }}>
      <H>CURRENT GUIDANCE</H>
      {pts.map((p, i) => (
        <div key={i}>
          <b>{metricShort(p.metric)} {fmtGrowthDisplay(p)}</b> <span style={{ color: R.dim }}>{p.period || ''}</span>
          {!backed(r, p) && <span style={{ color: R.amber, fontWeight: 700 }}> · Not independently verified</span>}
          {p.growthOrigin === 'IMPLIED' && (
            <div style={{ color: R.dim, fontSize: 12 }}>
              Implied growth, worked out from an absolute target. Not a % the company stated.
              {p.base ? ` Base: ${p.base.value} (${p.base.period}).` : ' Base not available.'}
              {p.absoluteTarget ? ` Target: ${money(p.absoluteTarget)}.` : ''}
            </div>
          )}
        </div>
      ))}
      <H>GUIDANCE</H>
      <div>
        <b>Period</b> {c.primary?.period || '—'}{unclear && <> <span title={PERIOD_UNCLEAR_HINT}><Chip color={R.grey} dashed>{PERIOD_UNCLEAR_LABEL}</Chip></span></>}
        {' · '}<b>Type</b> {c.primary ? kindLabel(c.primary.kind) : '—'}
        {' · '}<b>Status</b> {VALIDITY[c.validity] || c.validity || '—'} ({verificationText(c.verification)})
      </div>
      {unclear && <div style={{ color: R.dim, fontSize: 12 }}>{PERIOD_UNCLEAR_HINT}</div>}
      <div><b>Issued</b> {day(c.announcedAt)} · <b>Latest update</b> {day(c.lastEvidenceAt)} · {link ? <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>Source link</a> : <span style={{ color: R.dim }}>no source link</span>}</div>
      {c.primary?.originalStatement && c.primary.originalStatement.trim() && (
        <blockquote style={{ margin: 0, padding: '4px 10px', borderLeft: `3px solid ${R.cyan}`, background: tint(R.cyan, 6), fontStyle: 'italic', overflowWrap: 'anywhere' }}>“{c.primary.originalStatement}”</blockquote>
      )}
      <H>GUIDANCE HISTORY</H>
      {hist.length === 0 ? <div style={{ color: R.dim }}>No earlier guidance stored for this company.</div> : hist.map((h, i) => (
        <div key={i}>{day(h.date)} · {metricShort(h.metric)} {h.period} · {h.old && h.old.trim() ? <>{h.old} → <b>{h.next}</b></> : <>first seen: <b>{h.next}</b></>} <span style={{ color: R.dim }}>({h.revision.toLowerCase()})</span></div>
      ))}
      <H>WHY</H>
      <div>{c.driverText && c.driverText.trim() ? c.driverText : <span style={{ color: R.dim }}>No reason stated in the source.</span>}</div>
      <H>NEXT PROOF</H>
      <div>{c.nextProof && c.nextProof.trim() ? c.nextProof : <span style={{ color: R.dim }}>Not set.</span>}</div>
      {hasNumbers && rl && rl.trackingWhy && <div style={{ color: R.dim }}>{rl.trackingWhy}</div>}
      <H>SOURCE</H>
      <div><b>Primary source available:</b> {available ? 'Yes' : 'No'} · <b>Primary source read:</b> {read ? 'Yes' : 'No'}</div>
      {srcs.length === 0 && <div style={{ color: R.dim }}>No source listed.</div>}
      {srcs.map((s, i) => (
        <div key={i}>{s.name} · {s.type}{s.primary ? ' (primary)' : ' (secondary)'} · {day(s.date)} {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>Open link</a> : <span style={{ color: R.dim }}>no link</span>}</div>
      ))}
      {onFull && <div className="gu-noprint"><button type="button" style={btn()} onClick={() => onFull(c)}>Full growth guidance detail</button></div>}
    </div>
  );
}
