'use client';
// zzz841 — one Multibagger Radar card. Fields follow the owner's spec: ticker,
// company, catalyst, catalyst type, why now, evidence, earnings link, duration,
// next proof, expectations, valuation context, portfolio status, research
// priority. Details (mechanism, chain, bottleneck, break conditions,
// governance, timing) sit in an expander. Research priority is a category with
// a reason. There is no score and no price on the card.

import React, { useState } from 'react';
import {
  EVIDENCE_LABEL, INFLECTION_LABEL, KIND_LABEL, LINK_LABEL, PRIORITY_LABEL,
  type RadarItem,
} from '@/lib/multibagger-radar-types';
import { DIRECTION_LABEL } from '@/lib/multibagger-radar-economics';
import { addFromRadarItem, NOT_ESTABLISHED, type OwnerTag } from '@/lib/multibagger-ledger-store';
import type { LedgerEntry } from '@/lib/multibagger-radar-types';
import {
  CHAIN_MARK, DELTA_LABEL, EVIDENCE_META, INDICATOR_LABEL, LINK_KEY_LABEL, LINK_STATUS_META, MATERIALITY_LABEL, NOT_YET, PRICE_BLOCK_LABEL, PRIORITY_COLOR, QUANT_LABEL, R,
  TAG_COLOR, TRANSMISSION_LABEL, box, collapseChain, evidenceLines, durationLine, has, oneLineRow, orNotYet, populatedSections, progressionText, sourcesLine, statusBadges,
} from './radar-tokens';
import { Chip, Field, btn } from './RadarBits';
import { LedgerForm } from './LedgerForm';
import { PORTFOLIO_TAG_LABEL } from '@/lib/multibagger-radar-types';

const say = orNotYet;
void NOT_ESTABLISHED;

/** One line, no detail panel: corporate actions and items with no earnings link. */
export function RadarRow({ item }: { item: RadarItem }) {
  const r = oneLineRow(item);
  return (
    <div data-radar-row={item.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12, color: R.dim, padding: '3px 0', borderBottom: `1px dotted ${R.border}` }}>
      <b style={{ color: R.text }}>{r.who}</b>
      <span style={{ overflowWrap: 'anywhere' }}>{r.what}</span>
      {r.tag && <span style={{ fontSize: 10, fontWeight: 700, color: R.faint, border: `1px solid ${R.border}`, borderRadius: 3, padding: '0 5px' }}>{r.tag}</span>}
    </div>
  );
}

function Sub({ label, children }: { label: string; children: React.ReactNode }) {
  return <Field label={label}>{children}</Field>;
}

export function RadarCard({ item, held, ownerTag, ledgerIds, onSaveLedger, now }: {
  item: RadarItem; held: boolean; ownerTag?: OwnerTag; ledgerIds: ReadonlySet<string>;
  onSaveLedger: (e: LedgerEntry) => void; now: string;
}) {
  const [adding, setAdding] = useState(false);
  const ev = EVIDENCE_META[item.evidence.status];
  const draft = addFromRadarItem(item, now);
  const inLedger = ledgerIds.has(draft.id);
  const show = new Set(populatedSections(item, held));
  const portfolio = held ? (ownerTag ? PORTFOLIO_TAG_LABEL[ownerTag] + ' - in your holdings' : 'In your holdings') : 'Not in your holdings';
  const govNote = item.governance.status === 'NOT_CHECKED' ? 'Not checked' : item.governance.status === 'CLEAR' ? 'Clear' : 'Flagged';
  const govColor = item.governance.status === 'FLAGGED' ? R.red : item.governance.status === 'CLEAR' ? R.green : R.faint;
  const feedHref = item.feedEventId ? `/special-situations?tab=all#${encodeURIComponent(item.feedEventId)}` : '/special-situations?tab=all';
  const badges = statusBadges(item);
  const links = item.catalystChain || [];
  const chainView = collapseChain(links, (c) => LINK_KEY_LABEL[c.link]);
  const oldUnknown = item.chain.filter((c) => c.status === 'unknown').map((c) => c.step);
  const evLine = evidenceLines(item);
  const transmission = item.financialTransmission || item.link;
  const eligible = item.ledgerEligible !== false;
  const prog = progressionText(item);
  const kindText = KIND_LABEL[item.kind] + (item.subKind ? ` - ${KIND_LABEL[item.subKind]}` : '') + (item.inflection !== 'NOT_ASSESSED' ? ` - ${INFLECTION_LABEL[item.inflection]}` : '');
  return (
    <div style={box({ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, opacity: item.lowSignal ? 0.78 : 1 })} data-radar-card={item.id}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: R.text }}>{item.ticker || 'No ticker'}</span>
        <span style={{ fontSize: 13, color: R.dim }}>{item.company}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip color={ev.color} dashed={ev.dashed} title={item.evidence.why}>{ev.mark} Evidence: {item.evidenceLabel || EVIDENCE_LABEL[item.evidence.status]}</Chip>
          <Chip color={PRIORITY_COLOR[item.priority]} title={item.priorityReason}>Research priority: {PRIORITY_LABEL[item.priority]}</Chip>
        </span>
      </div>

      {/* three separate statuses - never merged into one "Confirmed" */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Three separate statuses">
        {badges.map((b) => <Chip key={b.key} color={b.color} dashed={b.dashed}>{b.heading}: {b.label}</Chip>)}
      </div>
      {(item.catalystDirection || has(item.sourceSubjectLine)) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {item.catalystDirection && (
            <Chip color={item.catalystDirection === 'positive' ? R.green : item.catalystDirection === 'negative' ? R.red : item.catalystDirection === 'mixed' ? R.amber : R.faint} title={item.directionBasis}>
              {DIRECTION_LABEL[item.catalystDirection]}{item.inflectionStrength && item.inflectionStrength !== 'unknown' && item.inflectionStrength !== 'none' ? ` - ${item.inflectionStrength} inflection` : ''}
            </Chip>
          )}
          {has(item.sourceSubjectLine) && <span style={{ fontSize: 11.5, color: R.faint }}>{item.sourceSubjectLine}{has(item.financialOwner) ? ` | Financial owner: ${item.financialOwner}` : ''}</span>}
        </div>
      )}
      {item.secondaryEvent && <div style={{ fontSize: 12, color: R.dim }} data-radar-secondary><b>{item.secondaryEvent.label}:</b> {item.secondaryEvent.text}</div>}
      {has(item.confirmationLabel) && <div style={{ fontSize: 12, color: R.dim }}>{item.confirmationLabel}</div>}

      {show.has('chain') && (
      <div>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: R.faint, textTransform: 'uppercase' }}>
          {item.evidenceChain && item.evidenceChain.length > 0 ? `Evidence chain (${(item.evidenceChainKind || 'OPERATING').replace(/_/g, ' ').toLowerCase()})` : 'Catalyst chain'}
        </div>
        {item.evidenceChain && item.evidenceChain.length > 0 && (
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 4 }} data-radar-evidence-chain>
            {item.evidenceChain.map((c) => (
              <li key={c.step}><Chip color={c.state === 'confirmed' ? R.green : R.faint} dashed={c.state !== 'confirmed'} title={c.detail || undefined}>{c.state === 'confirmed' ? '\u2713' : '?'} {c.step}</Chip></li>
            ))}
          </ul>
        )}
        {item.evidenceChain && item.evidenceChain.length > 0 ? (chainView.notApplicable ? <div style={{ fontSize: 11.5, color: R.faint, marginTop: 4 }} data-radar-chain-na>{chainView.notApplicable}</div> : null) : links.length > 0 ? (
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 4 }} data-radar-chain>
            {chainView.shown.map((c) => {
              const m = LINK_STATUS_META[c.status];
              const tip = [c.evidence, c.source, c.date, c.confidence !== 'UNKNOWN' ? `confidence ${c.confidence.toLowerCase()}` : null].filter(has).join(' | ');
              return <li key={c.link}><Chip color={m.color} dashed={m.dashed} title={tip || undefined}>{m.mark} {LINK_KEY_LABEL[c.link]}: {m.label}</Chip></li>;
            })}
            {chainView.notApplicable && <li style={{ fontSize: 11.5, color: R.faint }} data-radar-chain-na>{chainView.notApplicable}</li>}
          </ul>
        ) : (
          <ol style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {item.chain.map((c, i) => {
              if (c.status === 'unknown') return null;
              const m = CHAIN_MARK[c.status];
              return (
                <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', borderLeft: `2px ${m.border} ${m.color}`, paddingLeft: 8, opacity: m.opacity }}>
                  <span style={{ color: m.color, fontWeight: 900 }} aria-hidden>{m.mark}</span>
                  <span style={{ fontSize: 12, color: R.text }}>
                    <b>{i + 1}. {c.step}</b> <span style={{ color: m.color }}>({m.word})</span>{c.text ? ` - ${c.text}` : ''}
                  </span>
                </li>
              );
            })}
            {item.chain.length === 0 && <li style={{ fontSize: 12, color: R.faint }}>{NOT_YET}</li>}
            {oldUnknown.length > 0 && <li style={{ fontSize: 11.5, color: R.faint }} data-radar-chain-na>Not applicable or not established: {oldUnknown.join(', ')}</li>}
          </ol>
        )}
      </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '8px 14px' }}>
        {show.has('catalyst') && <Sub label="Catalyst">{say(item.event)}</Sub>}
        <Sub label="Catalyst type">{kindText}</Sub>
        <Sub label="Why now">{item.whyNow ? item.whyNow : say(item.whyItMatters)}</Sub>
        {show.has('mechanism') && (
          <Sub label="Economic mechanism">
            {has(item.economicMechanism) ? <span title={item.mechanismHelp || undefined}><b>{item.economicMechanism}</b></span> : null}
            {has(item.economicMechanism) ? ' ' : ''}{has(item.oneSentenceMechanism) ? item.oneSentenceMechanism : ''}
            {!has(item.economicMechanism) && !has(item.oneSentenceMechanism) && has(item.mechanism) ? item.mechanism : ''}
          </Sub>
        )}
        {has(item.economicPayoff) && <Sub label="Economic payoff">{item.economicPayoff}</Sub>}
        <Sub label="Event evidence">
          <span style={{ color: ev.color, fontWeight: 700 }}>{item.eventEvidence ? evLine.event : EVIDENCE_LABEL[item.evidence.status]}</span>
          {' - '}{say(item.evidence.sourceLabel)}. {say(item.evidence.why)}
        </Sub>
        {item.economicEvidence && (
          <Sub label="Economic evidence">
            <span style={{ fontWeight: 700 }}>{evLine.economic}</span>
            {item.economicEvidence === 'NOT_ESTABLISHED' ? '. The source states no company revenue, EBITDA or profit figure; a confirmed event does not make an earnings link.' : ''}
          </Sub>
        )}
        {show.has('scope') && item.evidenceScope && (
          <Sub label="Evidence scope">
            {item.evidenceScope.confirmed.length > 0 && <div><b style={{ color: R.green }}>Confirmed:</b> {item.evidenceScope.confirmed.join('; ')}</div>}
            {item.evidenceScope.notConfirmed.length > 0 && <div><b style={{ color: R.amber }}>Not confirmed:</b> {item.evidenceScope.notConfirmed.join('; ')}</div>}
          </Sub>
        )}
        {show.has('proven') && (
          <Sub label="Proven / not proven">
            {item.evidenceChain && item.evidenceChain.length > 0
              ? `${item.evidenceChain.filter((c) => c.state === 'confirmed').length} of ${item.evidenceChain.length} steps confirmed.`
              : item.provenThrough >= 0 ? 'Some steps are confirmed.' : 'No step confirmed yet.'}
            {has(item.weakestUnprovenLink) ? ` Weakest unproven link: ${item.weakestUnprovenLink}.` : ''}
          </Sub>
        )}
        <Sub label="Earnings link">
          {TRANSMISSION_LABEL[transmission] || LINK_LABEL[transmission]}. {say(item.financialImpact)}
          {item.quantificationStatus ? ` Quantification: ${QUANT_LABEL[item.quantificationStatus]}.` : ''}
        </Sub>
        {has(item.parentImpactLine) && <Sub label="Company earnings effect">{item.parentImpactLine}</Sub>}
        {(item.numberLines || []).length > 0 && (
          <Sub label="Numbers in the source, by owner"><ul style={{ margin: '2px 0 0', paddingLeft: 18 }} data-radar-numbers>{(item.numberLines || []).map((l, i) => <li key={i}>{l}</li>)}</ul></Sub>
        )}
        {(item.dealTermLines || []).length > 0 && (
          <Sub label="Deal terms">
            <ul style={{ margin: '2px 0 0', paddingLeft: 18 }} data-radar-dealterms>
              {(item.dealTermLines || []).map((l) => <li key={l.label} style={{ color: l.stated ? undefined : R.faint }}>{l.label}: {l.value}{l.calculated ? ' (calculated)' : ''}</li>)}
            </ul>
          </Sub>
        )}
        {item.factScope && (
          <Sub label="What is confirmed, inferred and unknown">
            {item.factScope.confirmed.length > 0 && <div><b style={{ color: R.green }}>Confirmed facts:</b> {item.factScope.confirmed.map((c) => `${c.text} (owner: ${c.owner})`).join('; ')}</div>}
            {item.factScope.inference.length > 0 && <div><b style={{ color: R.amber }}>Model inference:</b> {item.factScope.inference.join('; ')}</div>}
            {item.factScope.unknown.length > 0 && <div><b>Unknown:</b> {item.factScope.unknown.join('; ')}</div>}
          </Sub>
        )}
        {has(item.nextStep) && <Sub label="Next step">{item.nextStep}</Sub>}
        <Sub label="Duration">{durationLine(item.duration)}</Sub>
        {show.has('maturity') && (
          <Sub label="Catalyst maturity">
            {[prog, item.evidenceDelta ? `Evidence: ${DELTA_LABEL[item.evidenceDelta]}` : null].filter(Boolean).join(' - ')}
            {item.indicator?.type ? <> <Chip color={R.dim}>{INDICATOR_LABEL[item.indicator.type]}</Chip></> : null}
          </Sub>
        )}
        {show.has('materiality') && item.catalystMateriality && (
          <Sub label="Materiality">{MATERIALITY_LABEL[item.catalystMateriality]}{has(item.materialityNote) ? ` - ${item.materialityNote}` : ''}</Sub>
        )}
        {show.has('nextProof') && <Sub label="Next proof">{say(item.proof.what)}{item.proof.when ? ` - ${item.proof.when}` : ''}</Sub>}
        {!show.has('nextProof') && <Sub label="Next proof">{NOT_YET}</Sub>}
        {show.has('expectations') && <Sub label="Expectations">{item.expectations.note}</Sub>}
        {show.has('valuation') && <Sub label="Valuation context">{item.valuationContext}</Sub>}
        <Sub label="Portfolio status">{portfolio}</Sub>
      </div>

      {show.has('price') && item.priceResponse && (
        <div data-radar-price style={{ border: `1px dashed ${R.border}`, borderRadius: 6, padding: '6px 10px', fontSize: 11.5, color: R.faint, lineHeight: 1.45 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>{PRICE_BLOCK_LABEL}</div>
          {item.priceResponse.text}{has(item.priceResponse.note) ? ` ${item.priceResponse.note}` : ''}
        </div>
      )}

      <div style={{ fontSize: 12, color: R.dim, lineHeight: 1.45, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div title={item.priorityFactors ? `Information value ${item.priorityFactors.informationValue}; materiality ${item.priorityFactors.materiality}; evidence uncertainty ${item.priorityFactors.evidenceUncertainty}; proximity ${item.priorityFactors.proximity}; persistence ${item.priorityFactors.persistence}; portfolio relevance ${item.priorityFactors.portfolio}` : undefined}><b style={{ color: PRIORITY_COLOR[item.priority] }}>Why this priority:</b> {say(item.priorityReason)}</div>
        {(item.whyNotHigher || []).filter(has).length > 0 && <div><b>Why not higher?</b> {(item.whyNotHigher || []).filter(has).join('; ')}</div>}
        {has(item.upgradeTrigger) && <div><b>What would upgrade?</b> {item.upgradeTrigger}</div>}
        {has(item.downgradeTrigger) && <div><b>What would downgrade?</b> {item.downgradeTrigger}</div>}
      </div>
      {show.has('sources') && <div style={{ fontSize: 11.5, color: R.faint }}><b>Source quality and diversity:</b> {sourcesLine(item.evidence)}</div>}
      {item.drivers.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {item.drivers.map((d) => <Chip key={d} color={R.faint} title="Shared driver tag">{d}</Chip>)}
        </div>
      )}

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: R.cyan }}>Details: definition, break conditions, governance, timing (answers WHEN, not WHY)</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
          <Field label="Mechanism (general definition of this kind of event)">{say(item.mechanismHelp || item.mechanism)}</Field>
          {item.bottleneckQuestion && <Field label="Bottleneck question">{item.bottleneckQuestion}</Field>}
          <Field label="Break conditions">
            {item.breakConditions.filter(has).length ? <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>{item.breakConditions.filter(has).map((b, i) => <li key={i}>{b}</li>)}</ul> : NOT_YET}
          </Field>
          <Field label="Governance">
            {item.governance.status === 'NOT_CHECKED' && !item.governance.flags.length
              ? <span style={{ color: govColor, fontWeight: 700 }}>Governance relevance: Not assessed</span>
              : <><span style={{ color: govColor, fontWeight: 700 }}>{govNote}</span>{item.governance.flags.length ? ` - ${item.governance.flags.join('; ')}` : ''}{item.governance.note ? `. ${item.governance.note}` : ''}</>}
          </Field>
          {item.technical.note ? <Field label="Timing note (answers WHEN, not WHY)">{item.technical.note}</Field> : null}
          <div style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
            <a href={feedHref} style={{ color: R.cyan }}>Open the Special Situations card</a>
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ color: R.cyan }}>Source filing</a>}
          </div>
        </div>
      </details>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {inLedger
          ? <Chip color={R.green}>In thesis ledger</Chip>
          : eligible
            ? <button type="button" onClick={() => setAdding((a) => !a)} style={btn(R.cyan, adding)}>{adding ? 'Close' : 'Add to thesis ledger'}</button>
            : (
              <span data-radar-ledger-blocked style={{ fontSize: 11.5, color: R.faint }}>
                Not ready for the thesis ledger{(item.ledgerBlockers || []).filter(has).length ? `: ${(item.ledgerBlockers || []).filter(has).join('; ')}` : '.'}
              </span>
            )}
        {held && ownerTag && <Chip color={TAG_COLOR[ownerTag]}>{PORTFOLIO_TAG_LABEL[ownerTag]}</Chip>}
      </div>
      {adding && !inLedger && eligible && (
        <LedgerForm initial={draft} title="Add to thesis ledger - please review" saveLabel="Confirm and save to ledger"
          onSave={(e) => { onSaveLedger(e); setAdding(false); }} onCancel={() => setAdding(false)} />
      )}
    </div>
  );
}
