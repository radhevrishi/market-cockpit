'use client';
// zzz843 — the detail view: 15 sections, first screen concise, detail below.
import React from 'react';
import type { GuidanceEvent } from '@/lib/guidance-upgrades-types';
import { DURATION_LABEL, FLAG_LABEL, IMPACT_LABEL, MATERIALITY_LABEL, METRIC_LABEL, metricLabelOf, THESIS_LABEL, UNAVAILABLE, agoText, changeMarker, fmtBeforeAfter, fmtNumber, isHeadlineOnly, showsDecision, tickerText } from '@/lib/guidance-upgrades-format';
import { IMPACT_COLOR, R, box } from './gu-tokens';
import { AiCheckBadge, BasisNote, OtherChanges, ValidationNotes, Chip, ConsensusLine, CrossLinks, DecisionChip, HeadlineOnlyBanner, DetectedVia, DurabilityRow, GapBadge, InflectionBadge, List, MetricBasisChip, NumRow, RangeBlock, Scorecard, Section, SourceChip, StageChip, TopEndCutNote, UnitWarnings, UnverifiedBanner, WhyDecision, WhyNow, btn } from './GuBits';

const STAGES: Array<[string, keyof GuidanceEvent['chain']]> = [
  ['EVENT', 'event'], ['EVIDENCE', 'evidence'], ['DRIVER', 'driver'], ['EARNINGS', 'earnings'], ['GAP', 'gap'],
  ['VALUATION', 'valuation'], ['DURABILITY', 'durability'], ['RISK', 'risk'], ['ACTION', 'action'],
];

export function GuDetail({ e, onClose, now }: { e: GuidanceEvent; onClose: () => void; now: Date }) {
  const verified = showsDecision(e);
  const st = e.historyStats;
  const v = e.valuation;
  return (
    <aside className="gu-drawer" role="dialog" aria-label={`${e.company} guidance detail`} style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(720px,100vw)', overflowY: 'auto', zIndex: 60,
      background: R.bg, color: R.text, borderLeft: `1px solid ${R.border}`, padding: 16, boxShadow: '-4px 0 16px rgba(0,0,0,0.12)',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 17 }}>{e.company}</b><span style={{ color: R.dim, fontSize: 12 }}>{tickerText(e)} · {e.market}</span>
        <DecisionChip e={e} /><InflectionBadge e={e} /><MetricBasisChip e={e} />
        <button type="button" className="gu-noprint" style={{ ...btn(), marginLeft: 'auto' }} onClick={onClose}>Close</button>
      </div>
      <div style={{ marginTop: 8 }}><StageChip e={e} /></div>
      {!verified && <div style={{ marginTop: 8 }}>{isHeadlineOnly(e) ? <HeadlineOnlyBanner e={e} /> : <UnverifiedBanner />}</div>}
      <div style={{ marginTop: 8 }}><TopEndCutNote e={e} /></div>
      <div style={{ marginTop: 8 }}><UnitWarnings e={e} /></div>
      <div style={{ marginTop: 8, display: 'grid', gap: 6 }}><AiCheckBadge x={e} /><ValidationNotes e={e} /></div>

      {/* First screen: the answer in a few lines. */}
      <div style={box({ padding: 10, margin: '10px 0', display: 'flex', flexDirection: 'column', gap: 6 })}>
        <div style={{ fontSize: 13 }}><b>What changed:</b> {e.whatItMeans || UNAVAILABLE}</div>
        <WhyNow e={e} />
        <RangeBlock e={e} />
        <DurabilityRow e={e} />
        <Scorecard e={e} />
        <DetectedVia e={e} />
        <CrossLinks e={e} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><GapBadge e={e} /><Chip color={R.dim}>Materiality: {MATERIALITY_LABEL[e.materiality]}</Chip><Chip color={R.dim}>{DURATION_LABEL[e.duration]}</Chip></div>
        <WhyDecision e={e} />
      </div>

      <Section n={1} title="What changed">
        {isHeadlineOnly(e) && <div style={{ color: R.dim }}>Raise stated by the source. Before {UNAVAILABLE} · After {UNAVAILABLE}. No percentage is shown.</div>}
        {!isHeadlineOnly(e) && e.changes.map((c, i) => { const b = fmtBeforeAfter(c); const mk = changeMarker(e, i); return (
          <div key={i}><b>{metricLabelOf(c.after)} {c.after.period}:</b> {b.before} → <b>{b.after}</b> {b.delta && c.before ? <b style={{ color: mk.kind === 'UP' ? R.green : mk.kind === 'DOWN' ? R.red : R.amber }}>{mk.glyph ? `${mk.glyph} ` : ''}{mk.kind === 'NEUTRAL' ? `midpoint ${b.delta}` : b.delta}</b> : <span style={{ color: R.faint }}>(change {UNAVAILABLE})</span>}
            {c.after.basis && c.after.basis !== 'UNSTATED' ? ` · ${c.after.basis.replace('_', '-')}` : ''}</div>); })}
        <BasisNote e={e} />
        <OtherChanges e={e} />
        <div style={{ fontSize: 11, color: R.dim }}>Announced {e.announcement_date} ({agoText(e.announcement_timestamp || e.announcement_date, now)}). Percent is a relative change. pp is a change between two rates.</div>
      </Section>

      <Section n={2} title="Primary evidence">
        <SourceChip e={e} />
        {e.sources.length > 1 && <div style={{ marginTop: 4 }}>{e.sources.map((s, i) => <div key={i} style={{ fontSize: 12 }}>{s.tier} · {s.type} · {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>{s.name}</a> : s.name}</div>)}</div>}
        {e.changes.filter((c) => c.after.raw).slice(0, 3).map((c, i) => <blockquote key={i} style={{ margin: '6px 0 0', paddingLeft: 8, borderLeft: `2px solid ${R.border}`, fontSize: 12, color: R.dim }}>{c.after.raw}</blockquote>)}
      </Section>

      <Section n={3} title="Guidance history">
        {e.history.length === 0 ? <span style={{ color: R.faint }}>No earlier guidance stored for this company yet. History builds up as events are seen.</span> : (
          <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead><tr style={{ textAlign: 'left', color: R.dim }}><th>Date</th><th>Metric</th><th>Period</th><th>Guidance</th><th>Change</th><th>Result</th></tr></thead>
            <tbody>{e.history.map((h, i) => <tr key={i} style={{ borderTop: `1px solid ${R.border}` }}><td>{h.date.slice(0, 10)}</td><td>{h.label || METRIC_LABEL[h.metric]}</td><td>{h.period}</td><td>{h.text}</td><td>{h.change.replace('_', ' ')}</td><td>{h.result || 'UNKNOWN'}</td></tr>)}</tbody>
          </table></div>)}
        <div style={{ marginTop: 6, fontSize: 12 }}>
          {st ? <>Raises {st.upgrades} · cuts {st.downgrades} · repeated {st.reiterations} · average revision {st.avgRevisionPct == null ? UNAVAILABLE : `${st.avgRevisionPct.toFixed(1)}%`} · results beat after a raise {st.beatRateAfterUpgrades == null ? `${UNAVAILABLE} (fewer than 2 results known)` : `${Math.round(st.beatRateAfterUpgrades * 100)}% of ${st.resolved}`}</> : `Accuracy record: ${UNAVAILABLE}`}
        </div>
      </Section>

      <Section n={4} title="Why guidance increased">{e.guidance_driver || UNAVAILABLE} <Chip color={R.dim} dashed>Evidence: {e.driverEvidence}</Chip></Section>

      <Section n={5} title="Earnings impact">
        <NumRow label="Revenue" n={e.revenueImpact} /><NumRow label="EBITDA" n={e.ebitdaImpact} />
        <NumRow label="EPS" n={e.epsImpact} /><NumRow label="Free cash flow" n={e.fcfImpact} />
        <div style={{ fontSize: 11, color: R.dim, marginTop: 4 }}>{e.materialityBasis || `Materiality basis: ${UNAVAILABLE}`}</div>
      </Section>

      <Section n={6} title="Consensus and expectations gap">
        {e.consensus?.value != null ? <NumRow label="Consensus" n={e.consensus} /> : <div style={{ fontSize: 12.5 }}><b>Consensus:</b> <ConsensusLine e={e} /></div>}
        <div style={{ marginTop: 4 }}><GapBadge e={e} /></div>
        {e.marketMissing && <div style={{ marginTop: 4 }}>{e.marketMissing}</div>}
      </Section>

      <Section n={7} title="Valuation impact">
        {v ? (<><NumRow label="EPS before" n={v.epsBefore} /><NumRow label="EPS after" n={v.epsAfter} /><NumRow label="Current P/E" n={v.currentPE} />
          <NumRow label="Earnings effect, same multiple" n={v.earningsEffectPct} /><NumRow label="Multiple effect (separate)" n={v.multipleSensitivityPct} />
          {v.priorRerating && <div style={{ fontSize: 12, color: R.dim, marginTop: 4 }}>{v.priorRerating}</div>}</>) : <span style={{ color: R.faint }}>{UNAVAILABLE}</span>}
      </Section>

      <Section n={8} title="Catalyst duration">{DURATION_LABEL[e.duration]}. <span style={{ color: R.dim }}>{e.chain.durability}</span></Section>

      <Section n={9} title="Business quality">Guidance quality: <b>{e.guidance_quality}</b>. Evidence: <b>{e.evidence}</b>. {e.thesis ? `Thesis label: ${THESIS_LABEL[e.thesis]}.` : 'No thesis label fits.'}</Section>

      <Section n={10} title="Bottleneck and structural theme">
        {e.links.bottleneckThemes?.length ? <>{e.links.bottleneckThemes.map((t) => <Chip key={t} color={R.cyan}>{t}</Chip>)} {e.links.structuralAlignment}</> : <span style={{ color: R.faint }}>No stated link to a structural bottleneck. Nothing is assumed.</span>}
        {e.links.newsIds?.length ? <div style={{ fontSize: 11, color: R.dim }}>{e.links.newsIds.length} related News and Signals item(s) already in the feed.</div> : null}
        {e.flags.map((f) => <div key={f} style={{ fontSize: 11 }}>{FLAG_LABEL[f]}</div>)}
      </Section>

      <Section n={11} title="Portfolio context">
        {e.links.inBook ? <><Chip color={e.links.portfolioImpact ? IMPACT_COLOR[e.links.portfolioImpact] : R.cyan}>IN PORTFOLIO{e.links.portfolioImpact ? ` · ${IMPACT_LABEL[e.links.portfolioImpact]}` : ''}</Chip>
          {e.links.bookThesisLabel ? ` Your thesis label: ${THESIS_LABEL[e.links.bookThesisLabel]}.` : ''} This shows how the raise reads against your thesis. It does not tell you to add.</> : <span style={{ color: R.faint }}>Not in your book, or your book is not loaded.</span>}
      </Section>

      <Section n={12} title="Risks"><List items={e.risks.slice(0, 4)} /></Section>
      <Section n={13} title="Evidence gaps"><List items={e.evidenceGaps.length ? e.evidenceGaps : []} empty="None listed." /></Section>
      <Section n={14} title="Next evidence"><List items={e.nextEvidence} /></Section>

      <Section n={15} title="Final decision">
        <div style={{ marginBottom: 6 }}><DecisionChip e={e} /></div>
        {verified ? <List items={e.decisionReason} /> : <span>No decision, because there is no primary source.</span>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
          {STAGES.map(([label, k], i) => (
            <div key={label} style={box({ padding: '4px 8px', fontSize: 11, flex: '1 1 200px' })}><b>{i + 1}. {label}</b><div style={{ color: R.dim }}>{e.chain[k] || UNAVAILABLE}</div></div>
          ))}
        </div>
      </Section>
    </aside>
  );
}
