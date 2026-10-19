'use client';
// zzz843 — one compact guidance-upgrade card. No score is ever shown; order comes from the engine.
import React from 'react';
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';
import { DURATION_LABEL, FLAG_LABEL, IMPACT_LABEL, MATERIALITY_LABEL, METRIC_LABEL, metricLabelOf, THESIS_LABEL, UNAVAILABLE, agoText, changeMarker, fmtBeforeAfter, fmtNumber, isHeadlineOnly, secondUpgradeText, showsDecision, tickerText, hasRealRaise, isReiteration, raiseVsPreviousText, sourceConflictLine } from '@/lib/guidance-upgrades-format';
import { IMPACT_COLOR, R, TONE_COLOR, box } from './gu-tokens';
import { CappedList } from './GuMore';
import { primarySourceView, safeEventLabel, sourceDisplayName, taxonomyText } from './gu-ui';
import { AiCheckBadge, BasisNote, OtherChanges, ValidationNotes, Chip, ConsensusLine, CrossLinks, DecisionChip, DetectedVia, DurabilityRow, Field, GapBadge, HeadlineOnlyBanner, InflectionBadge, MetricBasisChip, RangeBlock, SourceChip, StageChip, TopEndCutNote, UnitWarnings, UnverifiedBanner, WhyNow } from './GuBits';

function GuCardBody({ e, onOpen, now }: { e: GuidanceEvent; onOpen: (id: string) => void; now: Date }) {
  const verified = showsDecision(e);
  const second = secondUpgradeText(e);
  const v = e.valuation;
  const headline = isHeadlineOnly(e);
  const lab = safeEventLabel(e);
  const conflict = sourceConflictLine(e);
  const primary = primarySourceView(e);
  const tax = taxonomyText(e);
  return (
    <article className="gu-card" style={box({ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' })}
      onClick={() => onOpen(e.guidance_event_id)} tabIndex={0} role="button" aria-label={`Open details for ${e.company}`}
      onKeyDown={(k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); onOpen(e.guidance_event_id); } }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>{e.company}</b>
        <span style={{ fontSize: 11, color: R.dim, fontWeight: 700 }}>{tickerText(e)} · {e.market === 'IN' ? 'India' : e.market === 'US' ? 'USA' : 'Global'}</span>
        <Chip color={lab.tone === 'green' ? R.green : lab.tone === 'grey' ? R.grey : lab.tone === 'red' ? R.red : R.amber} dashed={lab.dashed}
          title={lab.label === 'GUIDANCE UPGRADE' ? 'Numbers say the guidance went up and the company\'s own document confirms it.' : lab.label === 'REITERATION' ? 'The company repeated its earlier guidance. Nothing was raised.' : lab.label === 'UNVERIFIED CLAIM' ? 'Reported by a media or secondary source. The company document has not been read, so this is not counted as an upgrade.' : lab.label === 'GUIDANCE LOWERED' ? 'The numbers went down.' : 'Some numbers went up and some did not, or the range moved. Not a clean raise.'}>
          {lab.label} · {agoText(e.announcement_timestamp || e.announcement_date, now)}
        </Chip>
        {tax && <Chip color={R.dim} dashed title="What kind of statement this is. Only a formal upgrade with old and new numbers can be a guidance upgrade.">{tax}</Chip>}
        <InflectionBadge e={e} /><MetricBasisChip e={e} />
        {e.thesis && <Chip color={R.violet}>{THESIS_LABEL[e.thesis]}</Chip>}
        <span style={{ marginLeft: 'auto' }}><DecisionChip e={e} /></span>
      </header>

      <StageChip e={e} />
      {lab.note && <div role="note" style={{ fontSize: 12.5, color: R.dim, borderLeft: `3px solid ${R.grey}`, paddingLeft: 8 }}><b>Audit note:</b> {lab.note}</div>}
      {/* zzz854: ONE primary-source state. When it is not 'read, figures found' the stage strip above already says it, so it is not repeated. */}
      {primary && (!e.primarySourceState || primary.tone === 'green') && <div style={{ fontSize: 12.5, color: primary.tone === 'green' ? R.green : R.amber }}>{/^primary source/i.test(primary.text) ? primary.text : <><b>Primary source:</b> {primary.text}</>}</div>}
      <AiCheckBadge x={e} />
      {conflict && <div role="note" style={{ fontSize: 12.5, color: R.red }}><b>Sources disagree.</b> {conflict}. Both are kept.</div>}
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
              <b style={{ minWidth: 120 }}>{metricLabelOf(c.after)} {c.after.period}</b>
              <span style={{ color: R.dim }}>{b.before}</span><span aria-hidden>→</span><b>{b.after}</b>
              {unknownBefore || !b.delta
                ? <span style={{ color: R.faint }}>change {UNAVAILABLE}</span>
                : <span title={raiseVsPreviousText(c) || undefined} style={{ color: mk.kind === 'UP' ? R.green : mk.kind === 'DOWN' ? R.red : R.amber, fontWeight: 800 }}>{mk.glyph ? `${mk.glyph} ` : ''}{mk.kind === 'NEUTRAL' ? `midpoint ${b.delta}` : b.delta}</span>}
            </div>
          );
        })}
      </div>

      <BasisNote e={e} />
      <OtherChanges e={e} />
      <ValidationNotes e={e} />
      <RangeBlock e={e} />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <GapBadge e={e} />
        {e.flags.map((f) => <Chip key={f} color={f === 'GUIDANCE_PLUS_BOTTLENECK' || f === 'GUIDANCE_PLUS_GAP' ? R.cyan : R.amber}>{f === 'SECOND_UPGRADE_IN_WINDOW' && second ? second : FLAG_LABEL[f]}</Chip>)}
        {e.links.inBook && <Chip color={e.links.portfolioImpact ? IMPACT_COLOR[e.links.portfolioImpact] : R.cyan}>IN PORTFOLIO{e.links.portfolioImpact ? ` · ${IMPACT_LABEL[e.links.portfolioImpact]}` : ''}</Chip>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
        <Field label="Materiality">{MATERIALITY_LABEL[e.materiality]}</Field>
        <Field label="How long it lasts">{DURATION_LABEL[e.duration]}</Field>
        <Field label="Earnings effect, same multiple">{v ? fmtNumber(v.earningsEffectPct) : UNAVAILABLE}{v && (v.earningsEffectPct as any)?.assumptions?.some((a: string) => a.startsWith('Small base')) ? <span title={(v.earningsEffectPct as any).assumptions.find((a: string) => a.startsWith('Small base'))} style={{ fontSize: 11, opacity: 0.75 }}> (small EPS base)</span> : null}</Field>
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

/** zzz855: memoised, so opening one event's detail does not rebuild every card on the page. */
export const GuCard = React.memo(GuCardBody);

/** Audit area: events that are NOT a clean verified raise (repeats, mixed, lowered, adjusted-only). Shown apart, never counted as upgrades. */
export function GuAuditArea({ events, onOpen, now }: { events: GuidanceEvent[]; onOpen: (id: string) => void; now: Date }) {
  if (!events.length) return null;
  return (
    <section aria-label="Audit only events" style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>AUDIT ONLY ({events.length})</div>
      <div style={{ fontSize: 12, color: R.dim }}>These were found but are not clean raises. They are kept for checking and are not counted as upgrades.</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        <CappedList items={events} color={R.dim} inList render={(e) => {
          const l = safeEventLabel(e);
          return (
            <li key={e.guidance_event_id} className="gu-card" style={box({ padding: '6px 10px', display: 'grid', gap: 2 })}>
              <button type="button" onClick={() => onOpen(e.guidance_event_id)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 13 }} aria-label={`Open details for ${e.company}`}>
                <b>{e.company}</b>
                <span style={{ fontSize: 11, color: R.dim }}>{tickerText(e)} · {e.market === 'IN' ? 'India' : e.market === 'US' ? 'USA' : 'Global'}</span>
                <Chip color={TONE_COLOR[l.tone]} dashed={l.dashed}>{l.label}</Chip>
                <span style={{ fontSize: 11.5, color: R.dim }}>{agoText(e.announcement_timestamp || e.announcement_date, now)}</span>
                {e.sources?.[0]?.name && <span style={{ fontSize: 11.5, color: R.dim }}>{sourceDisplayName(e.sources[0].name)}</span>}
              </button>
              <div style={{ fontSize: 12.5, color: R.dim }}>{l.note ?? e.pipeline?.reason ?? 'No audit note was given.'}{taxonomyText(e) ? ` (${taxonomyText(e)})` : ''}</div>
            </li>
          );
        }} />
      </ul>
    </section>
  );
}
