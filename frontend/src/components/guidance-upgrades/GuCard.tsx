'use client';
// zzz843 — one compact guidance-upgrade card. No score is ever shown; order comes from the engine.
import React from 'react';
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';
import { DURATION_LABEL, FLAG_LABEL, IMPACT_LABEL, MATERIALITY_LABEL, METRIC_LABEL, THESIS_LABEL, UNAVAILABLE, agoText, fmtBeforeAfter, fmtNumber, secondUpgradeText, showsDecision } from '@/lib/guidance-upgrades-format';
import { IMPACT_COLOR, R, box } from './gu-tokens';
import { Chip, DecisionChip, Field, GapBadge, SourceChip, UnverifiedBanner } from './GuBits';

export function GuCard({ e, onOpen, now }: { e: GuidanceEvent; onOpen: (id: string) => void; now: Date }) {
  const verified = showsDecision(e);
  const second = secondUpgradeText(e);
  const v = e.valuation;
  return (
    <article className="gu-card" style={box({ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' })}
      onClick={() => onOpen(e.guidance_event_id)} tabIndex={0} role="button" aria-label={`Open details for ${e.company}`}
      onKeyDown={(k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); onOpen(e.guidance_event_id); } }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>{e.company}</b>
        <span style={{ fontSize: 11, color: R.dim, fontWeight: 700 }}>{e.ticker} · {e.market === 'IN' ? 'India' : e.market === 'US' ? 'USA' : 'Global'}</span>
        <Chip color={R.green}>GUIDANCE UPGRADE · {agoText(e.announcement_timestamp || e.announcement_date, now)}</Chip>
        {e.thesis && <Chip color={R.violet}>{THESIS_LABEL[e.thesis]}</Chip>}
        <span style={{ marginLeft: 'auto' }}><DecisionChip e={e} /></span>
      </header>

      {!verified && <UnverifiedBanner />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {e.changes.map((c, i) => {
          const b = fmtBeforeAfter(c);
          return (
            <div key={i} style={{ fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <b style={{ minWidth: 120 }}>{METRIC_LABEL[c.after.metric]} {c.after.period}</b>
              <span style={{ color: R.dim }}>{b.before}</span><span aria-hidden>→</span><b>{b.after}</b>
              {b.delta ? <span style={{ color: R.green, fontWeight: 800 }}>{b.delta}</span> : <span style={{ color: R.faint }}>change {UNAVAILABLE}</span>}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <GapBadge e={e} />
        {e.flags.map((f) => <Chip key={f} color={f === 'GUIDANCE_PLUS_BOTTLENECK' || f === 'GUIDANCE_PLUS_GAP' ? R.cyan : R.amber}>{f === 'SECOND_UPGRADE_IN_WINDOW' && second ? second : FLAG_LABEL[f]}</Chip>)}
        {e.links.inBook && <Chip color={e.links.portfolioImpact ? IMPACT_COLOR[e.links.portfolioImpact] : R.cyan}>IN PORTFOLIO{e.links.portfolioImpact ? ` · ${IMPACT_LABEL[e.links.portfolioImpact]}` : ''}</Chip>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
        <Field label="Consensus">{fmtNumber(e.consensus)}</Field>
        <Field label="Materiality">{MATERIALITY_LABEL[e.materiality]}</Field>
        <Field label="How long it lasts">{DURATION_LABEL[e.duration]}</Field>
        <Field label="Earnings effect, same multiple">{v ? fmtNumber(v.earningsEffectPct) : UNAVAILABLE}</Field>
        <Field label="Multiple effect (separate)">{v ? fmtNumber(v.multipleSensitivityPct) : UNAVAILABLE}</Field>
      </div>

      <div style={{ fontSize: 12.5 }}><b>Why now:</b> {e.whyNow || UNAVAILABLE}</div>
      {e.nextEvidence[0] && <div style={{ fontSize: 12.5 }}><b>Next evidence:</b> {e.nextEvidence[0]}</div>}
      <SourceChip e={e} />
    </article>
  );
}
