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
import { addFromRadarItem, NOT_ESTABLISHED, type OwnerTag } from '@/lib/multibagger-ledger-store';
import type { LedgerEntry } from '@/lib/multibagger-radar-types';
import { CHAIN_MARK, EVIDENCE_META, PRIORITY_COLOR, R, TAG_COLOR, box, tint } from './radar-tokens';
import { Chip, Field, btn } from './RadarBits';
import { LedgerForm } from './LedgerForm';
import { PORTFOLIO_TAG_LABEL } from '@/lib/multibagger-radar-types';

const say = (s: string | null | undefined): string => (s && s.trim() ? s : NOT_ESTABLISHED);

export function RadarCard({ item, held, ownerTag, ledgerIds, onSaveLedger, now }: {
  item: RadarItem; held: boolean; ownerTag?: OwnerTag; ledgerIds: ReadonlySet<string>;
  onSaveLedger: (e: LedgerEntry) => void; now: string;
}) {
  const [adding, setAdding] = useState(false);
  const ev = EVIDENCE_META[item.evidence.status];
  const draft = addFromRadarItem(item, now);
  const inLedger = ledgerIds.has(draft.id);
  const portfolio = held ? (ownerTag ? PORTFOLIO_TAG_LABEL[ownerTag] + ' - in your holdings' : 'In your holdings') : 'Not in your holdings';
  const govNote = item.governance.status === 'NOT_CHECKED' ? 'Not checked' : item.governance.status === 'CLEAR' ? 'Clear' : 'Flagged';
  const govColor = item.governance.status === 'FLAGGED' ? R.red : item.governance.status === 'CLEAR' ? R.green : R.faint;
  const feedHref = item.feedEventId ? `/special-situations?tab=all#${encodeURIComponent(item.feedEventId)}` : '/special-situations?tab=all';
  return (
    <div style={box({ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, opacity: item.lowSignal ? 0.78 : 1 })} data-radar-card={item.id}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: R.text }}>{item.ticker || 'No ticker'}</span>
        <span style={{ fontSize: 13, color: R.dim }}>{item.company}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip color={ev.color} dashed={ev.dashed} title={item.evidence.why}>{ev.mark} {EVIDENCE_LABEL[item.evidence.status]}</Chip>
          <Chip color={PRIORITY_COLOR[item.priority]} title={item.priorityReason}>Research priority: {PRIORITY_LABEL[item.priority]}</Chip>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '8px 14px' }}>
        <Field label="Catalyst">{say(item.event)}</Field>
        <Field label="Catalyst type">{KIND_LABEL[item.kind]}{item.inflection !== 'NOT_ASSESSED' ? ` - ${INFLECTION_LABEL[item.inflection]}` : ''}</Field>
        <Field label="Why now">{say(item.whyItMatters)}</Field>
        <Field label="Evidence">
          <span style={{ color: ev.color, fontWeight: 700 }}>{EVIDENCE_LABEL[item.evidence.status]}</span>
          {' - '}{say(item.evidence.sourceLabel)}. {say(item.evidence.why)}
        </Field>
        <Field label="Earnings link">{LINK_LABEL[item.link]}. {say(item.financialImpact)}</Field>
        <Field label="Duration">
          {say(item.duration.label)}{item.duration.evidence ? ` - ${item.duration.evidence}` : ''}{item.duration.basis === 'type' ? ' (by event type)' : ''}
        </Field>
        <Field label="Next proof">{say(item.proof.what)}{' - '}{item.proof.when ? item.proof.when : 'timing not stated'}</Field>
        <Field label="Expectations">{say(item.expectations.note)}</Field>
        <Field label="Valuation context">{say(item.valuationContext)}</Field>
        <Field label="Portfolio status">{portfolio}</Field>
      </div>
      <div style={{ fontSize: 12, color: R.dim, lineHeight: 1.45 }}><b style={{ color: PRIORITY_COLOR[item.priority] }}>Why this priority:</b> {say(item.priorityReason)}</div>
      {item.drivers.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {item.drivers.map((d) => <Chip key={d} color={R.faint} title="Shared driver tag">{d}</Chip>)}
        </div>
      )}

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: R.cyan }}>Details: mechanism, chain, break conditions</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
          <Field label="Mechanism">{say(item.mechanism)}</Field>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: R.faint, textTransform: 'uppercase' }}>
              Catalyst chain - {item.provenThrough >= 0 ? `proven through step ${item.provenThrough + 1}` : 'no step proven yet'}
            </div>
            <ol style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {item.chain.map((c, i) => {
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
              {item.chain.length === 0 && <li style={{ fontSize: 12, color: R.faint }}>{NOT_ESTABLISHED}</li>}
            </ol>
          </div>
          {item.bottleneckQuestion && <Field label="Bottleneck question">{item.bottleneckQuestion}</Field>}
          <Field label="Break conditions">
            {item.breakConditions.length ? <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>{item.breakConditions.map((b, i) => <li key={i}>{b}</li>)}</ul> : NOT_ESTABLISHED}
          </Field>
          <Field label="Governance">
            <span style={{ color: govColor, fontWeight: 700 }}>{govNote}</span>
            {item.governance.flags.length ? ` - ${item.governance.flags.join('; ')}` : ''}{item.governance.note ? `. ${item.governance.note}` : ''}
          </Field>
          <Field label="Timing note (answers WHEN, not WHY)">{item.technical.note ? item.technical.note : 'No technical data supplied.'}</Field>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
            <a href={feedHref} style={{ color: R.cyan }}>Open the Special Situations card</a>
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ color: R.cyan }}>Source filing</a>}
          </div>
        </div>
      </details>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {inLedger
          ? <Chip color={R.green}>In thesis ledger</Chip>
          : <button type="button" onClick={() => setAdding((a) => !a)} style={btn(R.cyan, adding)}>{adding ? 'Close' : 'Add to thesis ledger'}</button>}
        {held && ownerTag && <Chip color={TAG_COLOR[ownerTag]}>{PORTFOLIO_TAG_LABEL[ownerTag]}</Chip>}
      </div>
      {adding && !inLedger && (
        <LedgerForm initial={draft} title="Add to thesis ledger - please review" saveLabel="Confirm and save to ledger"
          onSave={(e) => { onSaveLedger(e); setAdding(false); }} onCancel={() => setAdding(false)} />
      )}
    </div>
  );
}
