'use client';
// zzz843 — small presentational pieces for Guidance Upgrades.
import React from 'react';
import type { GuNumber, GuidanceEvent } from '@/lib/guidance-upgrades-types';
import { AWAITING_PRIMARY, BASIS_LABEL, CONSENSUS_ABSENT, DECISION_LABEL, DURABILITY_LEVEL_LABEL, GAP_LABEL, HEADLINE_ONLY_BANNER, LABEL_WORD, STAGE_LABEL, TOP_END_CUT, decisionChipText, guidanceMarkerWord, hasTopEndCut, isHeadlineOnly, isRealRaiseClass, rangeClassLabel, STAGE_ORDER, UNAVAILABLE, WHY_NOW_UNRESOLVED, fmtNumber, fmtRangeLine, showsDecision, stageIndex, stageNote, stageOf } from '@/lib/guidance-upgrades-format';
import { DECISION_COLOR, GAP_COLOR, RATING_COLOR, R, TONE_COLOR, tint } from './gu-tokens';
import { INVARIANT_BANNER, basisText, freshnessLines, lastVerifiedText, qualityStrip, recordBasis, type BasisText, type FreshnessIn, type GuBadge } from './gu-ui';
export { Chip, Field, btn } from '@/components/special-situations/RadarBits';
import { Chip } from '@/components/special-situations/RadarBits';

export function DecisionChip({ e }: { e: GuidanceEvent }) {
  if (!showsDecision(e) && isHeadlineOnly(e)) return <Chip color={R.grey} dashed title="The source says raised, but old and new numbers were not read, so no decision is given.">{decisionChipText(e)}</Chip>;
  if (!showsDecision(e)) return <Chip color={R.grey} dashed title="No primary source, so no decision is given.">UNVERIFIED</Chip>;
  return <Chip color={DECISION_COLOR[e.decision]}>{DECISION_LABEL[e.decision]}</Chip>;
}

export function GapBadge({ e }: { e: GuidanceEvent }) {
  return (
    <Chip color={GAP_COLOR[e.expectationGap]} dashed={e.expectationGap === 'UNKNOWN'} title="Guidance compared with what the market expected. Missing consensus is never treated as negative.">
      {guidanceMarkerWord(e)} · Expectation gap: {GAP_LABEL[e.expectationGap]}{e.gapPct != null && e.expectationGap !== 'UNKNOWN' ? ` (${e.gapPct >= 0 ? '+' : ''}${e.gapPct.toFixed(1)}%)` : ''}
    </Chip>
  );
}

/** Headline-only candidate: the source says raised, but old and new numbers were not read. No arrow, no percentage. */
export function HeadlineOnlyBanner({ e }: { e: GuidanceEvent }) {
  const sm = e.v2?.statedMetrics?.length ? ` Measures named: ${e.v2.statedMetrics.join(', ')}.` : '';
  return (
    <div role="note" style={{ border: `1px dashed ${R.amber}`, background: tint(R.amber, 10), color: R.text, borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>
      {HEADLINE_ONLY_BANNER}.{sm} <span style={{ fontWeight: 400 }}>Before {UNAVAILABLE} · After {UNAVAILABLE}.</span>
    </div>
  );
}

export function TopEndCutNote({ e }: { e: GuidanceEvent }) {
  return hasTopEndCut(e) ? <AmberNote><b>{TOP_END_CUT}.</b> The midpoint went up but the high end of the range was lowered. This is not a clean raise.</AmberNote> : null;
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

// ── zzz844 V2 pieces ────────────────────────────────────────────────────
/** CANDIDATE → PRIMARY SOURCE → … → DECISION. Current stage is filled; earlier stages are ticked; later ones are plain. */
export function StageChip({ e, compact }: { e: GuidanceEvent; compact?: boolean }) {
  const cur = stageIndex(stageOf(e));
  const note = stageNote(e);
  const list = compact ? [STAGE_ORDER[cur]] : STAGE_ORDER;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }} aria-label={`Stage: ${STAGE_LABEL[STAGE_ORDER[cur]]}`}>
      {list.map((st, i) => {
        const idx = compact ? cur : i;
        const on = idx === cur; const done = idx < cur;
        return (
          <span key={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3, padding: '2px 6px', borderRadius: 10,
              border: `1px ${on ? 'solid' : 'dashed'} ${on ? R.cyan : done ? R.green : R.border}`, background: on ? tint(R.cyan, 18) : 'transparent',
              color: on ? R.cyan : done ? R.green : R.faint }}>{done ? '✓ ' : ''}{STAGE_LABEL[st]}</span>
            {!compact && i < list.length - 1 && <span aria-hidden style={{ color: R.faint, fontSize: 10 }}>→</span>}
          </span>
        );
      })}
      {note && <span style={{ fontSize: 11, color: R.amber, fontWeight: 700 }}>{note}</span>}
    </div>
  );
}

export function AmberNote({ children }: { children: React.ReactNode }) {
  return <div role="note" style={{ border: `1px dashed ${R.amber}`, background: tint(R.amber, 10), borderRadius: 6, padding: '5px 9px', fontSize: 12, color: R.text }}>{children}</div>;
}

export function UnitWarnings({ e }: { e: GuidanceEvent }) {
  const w = e.v2?.unitWarnings || [];
  if (!w.length) return null;
  return <AmberNote><b>Check units:</b> {w.join(' · ')}</AmberNote>;
}

/** Range maths: before low/mid/high → after, then the class in plain words. */
export function RangeBlock({ e }: { e: GuidanceEvent }) {
  const r = e.v2?.ranges || [];
  if (!r.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {r.map((x, i) => {
        const c = e.changes[i];
        const unit = c?.after.isGrowthRate ? '%' : '';
        const down = x.klass === 'DOWNGRADE';
        const good = isRealRaiseClass(x.klass);
        return (
          <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            {c && <b>{c.after.metric.replace(/_/g, ' ').toLowerCase()} {c.after.period}: </b>}
            <span style={{ color: R.dim }}>{fmtRangeLine(x, unit)}</span>{' '}
            <Chip color={down ? R.red : good ? R.green : x.klass === 'UNKNOWN' ? R.grey : R.amber} dashed={x.klass === 'UNKNOWN'}>{rangeClassLabel(x)}</Chip>
          </div>
        );
      })}
    </div>
  );
}

export function MetricBasisChip({ e }: { e: GuidanceEvent }) {
  const b = e.v2?.metricBasis;
  return b ? <Chip color={R.dim} dashed={b === 'UNSTATED'} title="Which version of the number the company gave">{BASIS_LABEL[b]}</Chip> : null;
}

export function WhyNow({ e }: { e: GuidanceEvent }) {
  const v = e.v2;
  const resolved = v ? v.whyNowResolved : !!e.whyNow;
  return (
    <div style={{ fontSize: 12.5 }}>
      <b>WHY NOW:</b> {resolved ? (e.whyNow || UNAVAILABLE) : <span style={{ color: R.amber, fontWeight: 700 }}>{WHY_NOW_UNRESOLVED}</span>}
      {v?.operatingVariable && <> · <b>Operating variable:</b> {v.operatingVariable}</>}
    </div>
  );
}

export function DurabilityRow({ e }: { e: GuidanceEvent }) {
  const v = e.v2;
  if (!v) return null;
  return <div style={{ fontSize: 12.5 }}><b>Durability:</b> {DURABILITY_LEVEL_LABEL[v.durabilityLevel]}{v.durabilityWhy ? <span style={{ color: R.dim }}> — {v.durabilityWhy}</span> : null}</div>;
}

export function Scorecard({ e }: { e: GuidanceEvent }) {
  const items = e.v2?.scorecard || [];
  if (!items.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 6 }}>
      {items.map((it, i) => (
        <div key={i} style={{ fontSize: 12 }}>
          <Chip color={RATING_COLOR[it.rating]} dashed={it.rating === 'UNKNOWN'}>{it.label}: {it.rating}</Chip>
          {it.detail && <div style={{ color: R.dim, fontSize: 11 }}>{it.detail}</div>}
        </div>
      ))}
    </div>
  );
}

export function InflectionBadge({ e }: { e: GuidanceEvent }) {
  return e.v2?.smallMidCapInflection ? <Chip color={R.violet}>SMALL/MID-CAP INFLECTION</Chip> : null;
}

export function DetectedVia({ e }: { e: GuidanceEvent }) {
  const d = e.v2?.detectedVia || [];
  if (!d.length) return null;
  return <div style={{ fontSize: 11.5, color: R.dim }}><b>Detected via:</b> {d.join(' · ')}</div>;
}

/** Consensus is a side note. Missing consensus is never negative and never needed to detect the upgrade. */
export function ConsensusLine({ e }: { e: GuidanceEvent }) {
  const has = e.consensus?.value != null;
  return <span style={{ fontSize: 12 }}>{has ? fmtNumber(e.consensus) : <span style={{ color: R.faint }}>{CONSENSUS_ABSENT}</span>}</span>;
}

export function WhyDecision({ e }: { e: GuidanceEvent }) {
  const ok = showsDecision(e);
  return (
    <div style={{ border: `1px solid ${R.border}`, borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: R.dim }}>Why this decision</div>
      {ok && e.decisionReason.length ? (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5 }}>{e.decisionReason.map((x, i) => <li key={i}>{x}</li>)}</ol>
      ) : <div style={{ fontSize: 12.5, color: R.dim }}>{ok ? UNAVAILABLE : `No decision yet. ${AWAITING_PRIMARY}.`}</div>}
    </div>
  );
}

/** Links only where the event carries data for them. */
export function crossLinks(e: GuidanceEvent): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [];
  const l = e.links || {};
  if (l.newsIds?.length) out.push({ label: 'News & Signals', href: '/news' });
  if (l.bottleneckThemes?.length) out.push({ label: 'Bottleneck', href: '/bottleneck-intel' });
  const viaConcall = (e.v2?.detectedVia || []).some((x) => /concall|transcript/i.test(x)) || e.sources.some((s) => /transcript/i.test(s.type));
  if (viaConcall) out.push({ label: 'Concall / Event-Driven', href: '/concall-intel?tab=radar' });
  if (l.structuralAlignment || l.bottleneckThemes?.length) out.push({ label: 'Research', href: '/ai-desk' });
  if (l.inBook) out.push({ label: 'My Book', href: e.market === 'US' ? '/us-portfolio-book' : '/portfolio' });
  return out;
}
export function CrossLinks({ e }: { e: GuidanceEvent }) {
  const ls = crossLinks(e);
  if (!ls.length) return null;
  return <div className="gu-noprint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>{ls.map((x) => <a key={x.label} href={x.href} style={{ color: R.cyan, fontWeight: 700 }} onClick={(ev) => ev.stopPropagation()}>{x.label} →</a>)}</div>;
}


// ═══ zzz853 additions ═══════════════════════════════════════════════════════════════════════════════════════════════
/** Verification badge: glyph + plain word, with a plain-English tooltip. The glyph is never the only signal (the word is printed too). */
export function VerBadge({ b, compact }: { b: GuBadge; compact?: boolean }) {
  return (
    <span title={b.tip} aria-label={`${b.label}. ${b.tip}`} style={{ color: TONE_COLOR[b.tone], fontWeight: 800, fontSize: compact ? 13 : 12, whiteSpace: 'nowrap' }}>
      <span aria-hidden style={{ fontWeight: 900 }}>{b.glyph}</span>{compact ? null : ` ${b.label}`}
    </span>
  );
}

/** Growth basis on one line, e.g. '+94% vs FY26 actual (derived) · +20.8% vs prior guidance'. Calculation detail sits in the tooltip and a small second line. */
export function BasisLine({ t, showDetail }: { t: BasisText | null | undefined; showDetail?: boolean }) {
  if (!t || !t.line) return null;
  return (
    <div style={{ fontSize: 12, color: R.dim, overflowWrap: 'anywhere' }} title={t.detail ? `Worked out from: ${t.detail}` : undefined}>
      {t.line}
      {showDetail && t.detail && <div style={{ fontSize: 11.5 }}>Worked out from: {t.detail}</div>}
    </div>
  );
}
export { basisText, recordBasis };

export function LastVerified({ r }: { r: Parameters<typeof lastVerifiedText>[0] }) {
  const v = lastVerifiedText(r);
  return <span style={{ fontSize: 11.5, color: v.stale ? R.amber : R.dim, fontWeight: v.stale ? 800 : 400 }} title={v.stale ? 'Not checked against the company document for a while. Still active until its period ends or it is replaced.' : undefined}>{v.stale ? '⚠ ' : ''}{v.text}</span>;
}

/** Three freshness lines: guidance data, event scan, source feed. Unknown stays Unknown. */
export function FreshnessBlock(p: FreshnessIn) {
  const lines = freshnessLines(p);
  return (
    <div role="group" aria-label="Data freshness" style={{ display: 'grid', gap: 2, fontSize: 12, color: R.dim }}>
      {lines.map((l) => <div key={l.label}><b style={{ color: R.text }}>{l.label}:</b> <span style={{ color: l.known ? R.dim : R.amber }}>{l.text}</span></div>)}
    </div>
  );
}

/** Data-quality strip for the universe: counts, review reasons, stale and conflict counts, invariant banner, live-feed notice. */
export function QualityStrip({ data }: { data: Parameters<typeof qualityStrip>[0] }) {
  const q = qualityStrip(data);
  const parts: string[] = [];
  if (q.stateLine) parts.push(q.stateLine);
  if (q.reviewQueue != null) parts.push(`${q.reviewQueue} need review`);
  if (q.stale != null) parts.push(`${q.stale} verification stale`);
  if (q.conflicts != null) parts.push(`${q.conflicts} source conflict${q.conflicts === 1 ? '' : 's'}`);
  if (!parts.length && !q.reasonLine && !q.violations.length && !q.liveError && !q.servedNote) return null;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {q.violations.length > 0 && (
        <div role="alert" style={{ border: `1px solid ${R.red}`, background: tint(R.red, 8), borderRadius: 6, padding: '6px 10px', fontSize: 12.5 }}>
          <b style={{ color: R.red }}>{INVARIANT_BANNER}</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{q.violations.slice(0, 5).map((v, i) => <li key={i}>{v}</li>)}</ul>
          {q.violations.length > 5 && <div>and {q.violations.length - 5} more.</div>}
        </div>
      )}
      {(q.liveError || q.servedNote) && (
        <div role="note" style={{ border: `1px dashed ${R.amber}`, background: tint(R.amber, 8), borderRadius: 6, padding: '6px 10px', fontSize: 12.5 }}>
          {q.servedNote && <div><b>{q.servedNote}</b></div>}
          {q.liveError && <div>Live feed problem: {q.liveError}. The saved guidance is still shown.</div>}
        </div>
      )}
      {parts.length > 0 && <div style={{ fontSize: 12.5, color: R.dim }} aria-label="Data quality counts">{parts.join(' · ')}</div>}
      {q.reasonLine && <div style={{ fontSize: 12, color: R.dim }}><b>Why records need review:</b> {q.reasonLine}</div>}
    </div>
  );
}
