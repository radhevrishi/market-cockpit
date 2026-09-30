'use client';
// zzz843 — one compact guidance-upgrade card. No score is ever shown; order comes from the engine.
import React from 'react';
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';
import { DURATION_LABEL, FLAG_LABEL, IMPACT_LABEL, MATERIALITY_LABEL, METRIC_LABEL, THESIS_LABEL, UNAVAILABLE, agoText, changeMarker, fmtBeforeAfter, fmtNumber, isHeadlineOnly, secondUpgradeText, showsDecision, tickerText, hasRealRaise } from '@/lib/guidance-upgrades-format';
import { IMPACT_COLOR, R, box } from './gu-tokens';
import { Chip, ConsensusLine, CrossLinks, DecisionChip, DetectedVia, DurabilityRow, Field, GapBadge, HeadlineOnlyBanner, InflectionBadge, MetricBasisChip, RangeBlock, SourceChip, StageChip, TopEndCutNote, UnitWarnings, UnverifiedBanner, WhyNow } from './GuBits';

export function GuCard({ e, onOpen, now }: { e: GuidanceEvent; onOpen: (id: string) => void; now: Date }) {
  const verified = showsDecision(e);
  const second = secondUpgradeText(e);
  const v = e.valuation;
  const headline = isHeadlineOnly(e);
  return (
    <article className="gu-card" style={box({ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' })}
      onClick={() => onOpen(e.guidance_event_id)} tabIndex={0} role="button" aria-label={`Open details for ${e.company}`}
      onKeyDown={(k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); onOpen(e.guidance_event_id); } }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>{e.company}</b>
        <span style={{ fontSize: 11, color: R.dim, fontWeight: 700 }}>{tickerText(e)} · {e.market === 'IN' ? 'India' : e.market === 'US' ? 'USA' : 'Global'}</span>
        {headline
          ? <Chip color={R.amber} dashed>DETECTED · {agoText(e.announcement_timestamp || e.announcement_date, now)}</Chip>
          : <Chip color={hasRealRaise(e) ? R.green : R.amber}>{hasRealRaise(e) ? 'GUIDANCE UPGRADE' : 'GUIDANCE UPDATE'} · {agoText(e.announcement_timestamp || e.announcement_date, now)}</Chip>}
        <InflectionBadge e={e} /><MetricBasisChip e={e} />
        {e.thesis && <Chip color={R.violet}>{THESIS_LABEL[e.thesis]}</Chip>}
        <span style={{ marginLeft: 'auto' }}><DecisionChip e={e} /></span>
      </header>

      <StageChip e={e} />
      {headline ? <HeadlineOnlyBanner e={e} /> : !verified && <UnverifiedBanner />}
      <TopEndCutNote e={e} />
      <UnitWarnings e={e} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {!headline && e.changes.map((c, i) => {
          const b = fmtBeforeAfter(c);
          const mk = changeMarker(e, i);
          const unknownBefore = !c.before;
          return (
            <div key={i} style={{ fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <b style={{ minWidth: 120 }}>{METRIC_LABEL[c.after.metric]} {c.after.period}</b>
              <span style={{ color: R.dim }}>{b.before}</span><span aria-hidden>→</span><b>{b.after}</b>
              {unknownBefore || !b.delta
                ? <span style={{ color: R.faint }}>change {UNAVAILABLE}</span>
                : <span style={{ color: mk.kind === 'UP' ? R.green : mk.kind === 'DOWN' ? R.red : R.amber, fontWeight: 800 }}>{mk.glyph ? `${mk.glyph} ` : ''}{mk.kind === 'NEUTRAL' ? `midpoint ${b.delta}` : b.delta}</span>}
            </div>
          );
        })}
      </div>

      <RangeBlock e={e} />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <GapBadge e={e} />
        {e.flags.map((f) => <Chip key={f} color={f === 'GUIDANCE_PLUS_BOTTLENECK' || f === 'GUIDANCE_PLUS_GAP' ? R.cyan : R.amber}>{f === 'SECOND_UPGRADE_IN_WINDOW' && second ? second : FLAG_LABEL[f]}</Chip>)}
        {e.links.inBook && <Chip color={e.links.portfolioImpact ? IMPACT_COLOR[e.links.portfolioImpact] : R.cyan}>IN PORTFOLIO{e.links.portfolioImpact ? ` · ${IMPACT_LABEL[e.links.portfolioImpact]}` : ''}</Chip>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
        <Field label="Materiality">{MATERIALITY_LABEL[e.materiality]}</Field>
        <Field label="How long it lasts">{DURATION_LABEL[e.duration]}</Field>
        <Field label="Earnings effect, same multiple">{v ? fmtNumber(v.earningsEffectPct) : UNAVAILABLE}</Field>
        <Field label="Multiple effect (separate)">{v ? fmtNumber(v.multipleSensitivityPct) : UNAVAILABLE}</Field>
        <Field label="Consensus (optional)"><ConsensusLine e={e} /></Field>
      </div>

      <WhyNow e={e} />
      <DurabilityRow e={e} />
      {e.nextEvidence[0] && <div style={{ fontSize: 12.5 }}><b>Next evidence:</b> {e.nextEvidence[0]}</div>}
      <DetectedVia e={e} />
      <SourceChip e={e} />
      <CrossLinks e={e} />
    </article>
  );
}
