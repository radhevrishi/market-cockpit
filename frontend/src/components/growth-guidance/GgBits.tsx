'use client';
// zzz846 — small presentational pieces for Growth Guidance.
import React from 'react';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { ANALYST_MARKER, CAP_LABEL, MARKET_LABEL, ORGANIC_LABEL, VALIDITY_LABEL, isAnalyst, kindLabel, statusOf, verificationText, STATUS_LEGEND } from '@/lib/growth-guidance-format';
import { R, STATUS_COLOR, VALIDITY_COLOR, tint } from './gg-tokens';
export { Chip, Field, btn } from '@/components/special-situations/RadarBits';
import { Chip } from '@/components/special-situations/RadarBits';

export function StatusDotView({ c, compact }: { c: Pick<GgCompany, 'reality' | 'verification'>; compact?: boolean }) {
  const s = statusOf(c);
  return (
    <span title={`Tracking: ${s.label}. Evidence: ${verificationText(c.verification)}.`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 800, color: STATUS_COLOR[s.colorKey] }}>
      <span aria-hidden>{s.dot}</span>{!compact && s.label}{compact && <span className="gg-printonly">{s.label}</span>}
    </span>
  );
}

export function StatusLegend() {
  return (
    <div className="gg-noprint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: R.dim }} aria-label="Status dot legend">
      {STATUS_LEGEND.map((s) => <span key={s.key}>{s.dot} {s.label}</span>)}
      <span>⚪ NOT ASSESSED (unknown, not bad)</span>
    </div>
  );
}

export function ValidityChip({ v }: { v: GgCompany['validity'] }) {
  return <Chip color={VALIDITY_COLOR[v] ?? R.grey} dashed={v !== 'ACTIVE'} title="Is this guidance still the current one?">{VALIDITY_LABEL[v] ?? v}</Chip>;
}

export function KindChip({ c }: { c: GgCompany }) {
  const a = isAnalyst(c.primary?.kind);
  return a
    ? <Chip color={R.violet} dashed title={ANALYST_MARKER}>ANALYST · {kindLabel(c.primary.kind)}</Chip>
    : <Chip color={R.cyan} title="What kind of statement this is.">{kindLabel(c.primary?.kind)}</Chip>;
}

export function OrganicChip({ c }: { c: GgCompany }) {
  const o = c.primary?.organic ?? 'UNKNOWN';
  return <Chip color={o === 'ORGANIC' ? R.green : o === 'UNKNOWN' ? R.grey : R.amber} dashed={o === 'UNKNOWN'}>{ORGANIC_LABEL[o]}</Chip>;
}

export function HeldChip({ held }: { held: boolean }) {
  // Not held is never negative, so it is shown in a quiet neutral tone.
  return held ? <Chip color={R.green}>IN PORTFOLIO</Chip> : <Chip color={R.grey} dashed title="Not held. This is neutral, not a warning.">Not held</Chip>;
}

export function MarketTag({ c }: { c: GgCompany }) {
  return <span style={{ fontSize: 11, color: R.dim }}>{MARKET_LABEL[c.market] ?? c.market} · {CAP_LABEL[c.capBand] ?? ''}</span>;
}

export function ConflictBanner({ c }: { c: GgCompany }) {
  if (!c.conflict) return null;
  return (
    <div role="note" style={{ border: `1px dashed ${R.amber}`, background: tint(R.amber, 10), color: R.text, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
      SOURCE CONFLICT. {c.conflict.primary} vs {c.conflict.other}. {c.conflict.note}
    </div>
  );
}

export function NotVerifiedBanner() {
  return (
    <div role="note" style={{ border: `1px dashed ${R.amber}`, background: tint(R.amber, 10), color: R.text, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
      NOT VERIFIED. Only secondary sources mention this. No company filing, release or call confirms it yet.
    </div>
  );
}

export function SectionHead({ n, title }: { n: number; title: string }) {
  return <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: R.dim, textTransform: 'uppercase', margin: '14px 0 6px' }}>{n}. {title}</div>;
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,170px) 1fr', gap: 8, padding: '5px 0', borderBottom: `1px solid ${R.border}`, fontSize: 12.5 }}>
      <div style={{ color: R.dim, fontWeight: 700 }}>{k}</div>
      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{v}</div>
    </div>
  );
}
