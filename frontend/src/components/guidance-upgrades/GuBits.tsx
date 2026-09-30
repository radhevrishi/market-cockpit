'use client';
// zzz843 — small presentational pieces for Guidance Upgrades.
import React from 'react';
import type { GuNumber, GuidanceEvent } from '@/lib/guidance-upgrades-types';
import { DECISION_LABEL, GAP_LABEL, LABEL_WORD, UNAVAILABLE, fmtNumber, showsDecision } from '@/lib/guidance-upgrades-format';
import { DECISION_COLOR, GAP_COLOR, R, tint } from './gu-tokens';
export { Chip, Field, btn } from '@/components/special-situations/RadarBits';
import { Chip } from '@/components/special-situations/RadarBits';

export function DecisionChip({ e }: { e: GuidanceEvent }) {
  if (!showsDecision(e)) return <Chip color={R.grey} dashed title="No primary source, so no decision is given.">UNVERIFIED</Chip>;
  return <Chip color={DECISION_COLOR[e.decision]}>{DECISION_LABEL[e.decision]}</Chip>;
}

export function GapBadge({ e }: { e: GuidanceEvent }) {
  return (
    <Chip color={GAP_COLOR[e.expectationGap]} dashed={e.expectationGap === 'UNKNOWN'} title="Guidance compared with what the market expected. Missing consensus is never treated as negative.">
      Guidance ↑ · Expectation gap: {GAP_LABEL[e.expectationGap]}{e.gapPct != null && e.expectationGap !== 'UNKNOWN' ? ` (${e.gapPct >= 0 ? '+' : ''}${e.gapPct.toFixed(1)}%)` : ''}
    </Chip>
  );
}

export function UnverifiedBanner() {
  return (
    <div role="note" style={{ border: `1px dashed ${R.amber}`, background: tint(R.amber, 10), color: R.text, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
      UNVERIFIED. No company filing, release or transcript was found for this. It is a headline only, so no decision is given.
    </div>
  );
}

export function SourceChip({ e }: { e: GuidanceEvent }) {
  const s = e.sources.find((x) => x.tier === 'PRIMARY') || e.sources[0];
  if (!s) return <Chip color={R.grey} dashed>SOURCE: {UNAVAILABLE}</Chip>;
  return (
    <span style={{ fontSize: 11, color: R.dim, lineHeight: 1.5 }}>
      <b>SOURCE</b> {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>{s.name}</a> : s.name}
      {' · '}<b>SOURCE TYPE</b> {s.type}
      {' · '}<b>SOURCE DATE</b> {s.date ? s.date.slice(0, 10) : UNAVAILABLE}
      {' · '}<b>PRIMARY SOURCE AVAILABLE?</b> <span style={{ color: e.primaryAvailable ? R.green : R.red, fontWeight: 800 }}>{e.primaryAvailable ? 'YES' : 'NO'}</span>
    </span>
  );
}

/** A number with its label. MODEL ESTIMATE is dashed and always shows formula and assumptions. */
export function NumRow({ label, n }: { label: string; n: GuNumber | null | undefined }) {
  const model = n?.label === 'MODEL_ESTIMATE';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,160px) 1fr', gap: 8, padding: '5px 0', borderBottom: `1px solid ${R.border}`, fontSize: 12.5 }}>
      <div style={{ color: R.dim, fontWeight: 700 }}>{label}</div>
      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <b style={{ color: n?.value == null ? R.faint : R.text }}>{fmtNumber(n)}</b>{' '}
        <Chip color={model ? R.violet : n?.value == null ? R.grey : R.cyan} dashed={model || n?.value == null}>{LABEL_WORD[n?.label || 'UNAVAILABLE']}</Chip>
        <div style={{ fontSize: 11, color: R.dim }}>
          <b>SOURCE</b> {n?.source || UNAVAILABLE}
          {model && <> · <b>ASSUMPTION</b> {n?.assumptions?.length ? n.assumptions.join('; ') : UNAVAILABLE} · <b>FORMULA</b> {n?.formula || UNAVAILABLE}</>}
        </div>
      </div>
    </div>
  );
}

export function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: `1px solid ${R.border}`, padding: '10px 0' }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: R.dim, marginBottom: 6 }}>{n}. {title}</div>
      <div style={{ fontSize: 13, color: R.text, lineHeight: 1.5 }}>{children}</div>
    </section>
  );
}

export const List = ({ items, empty = UNAVAILABLE }: { items: string[]; empty?: string }) =>
  items.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span style={{ color: R.faint }}>{empty}</span>;
