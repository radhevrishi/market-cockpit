'use client';
// zzz841 — the Thesis ledger view: entries with status chips, last review, next
// proof point; edit, change status (written reason required), delete.
// No price or move input exists here.

import React, { useState } from 'react';
import { THESIS_STATUS_LABEL, type LedgerEntry, type ThesisStatus } from '@/lib/multibagger-radar-types';
import { changeLogOf, updateStatusIn } from '@/lib/multibagger-ledger-store';
import { R, THESIS_COLOR, box } from './radar-tokens';
import { Chip, Field, btn, input } from './RadarBits';
import { LedgerForm } from './LedgerForm';

const STATUS_LIST = Object.keys(THESIS_STATUS_LABEL) as ThesisStatus[];

function Row({ e, onEdit, onDelete, onStatus, now }: {
  e: LedgerEntry; onEdit: (e: LedgerEntry) => void; onDelete: (id: string) => void; onStatus: (id: string, to: ThesisStatus, reason: string, extra?: { postMortem?: { detectionFailureWhy?: string; failurePoint?: string } }) => string | undefined; now: string;
}) {
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState<ThesisStatus>(e.status);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [why, setWhy] = useState('');
  const log = changeLogOf(e);
  const versions = e.versions || [];
  void now;
  return (
    <div style={box({ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 })}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>{e.ticker}</b><span style={{ color: R.dim, fontSize: 12 }}>{e.company}</span>
        <span style={{ marginLeft: 'auto' }}><Chip color={THESIS_COLOR[e.status]}>{THESIS_STATUS_LABEL[e.status].toUpperCase()}</Chip></span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '6px 14px' }}>
        <Field label="Catalyst">{e.catalyst}</Field>
        <Field label="Next proof point">{e.nextProofPoint}</Field>
        <Field label="Last review">{e.lastReview || 'Not reviewed yet'}</Field>
        <Field label="Identified">{e.dateIdentified || 'Not established'}</Field>
        <Field label="First discovered">{e.firstDiscovered || 'Not established'}</Field>
        <Field label="First primary confirmation">{e.firstPrimaryConfirmation || 'Not yet'}</Field>
        <Field label="First financial confirmation">{e.firstFinancialConfirmation || 'Not yet'}</Field>
        <Field label="First material earnings impact">{e.firstMaterialEarningsImpact || 'Not yet'}</Field>
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: R.cyan }}>Full thesis, versions and change log ({versions.length} version{versions.length === 1 ? '' : 's'})</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, paddingTop: 8 }}>
          <Field label="Thesis">{e.thesis}</Field><Field label="Why now">{e.whyNow}</Field><Field label="Mechanism">{e.mechanism}</Field>
          <Field label="Evidence">{e.evidence}</Field><Field label="Assumptions">{e.assumptions}</Field><Field label="What must happen">{e.whatMustHappen}</Field>
          <Field label="What would confirm it">{e.whatWouldConfirm}</Field><Field label="What would weaken it">{e.whatWouldWeaken}</Field><Field label="What would break it">{e.whatWouldBreak}</Field>
          <Field label="Duration">{e.catalystDuration}</Field><Field label="Earnings link">{e.earningsLink}</Field><Field label="Management commentary">{e.managementCommentary}</Field>
          <Field label="Valuation context">{e.valuationContext}</Field><Field label="Technical context">{e.technicalContext}</Field>
          <Field label="Would upgrade it">{e.upgradeCondition || 'Not established'}</Field><Field label="Would downgrade it">{e.downgradeCondition || 'Not established'}</Field>
        </div>
        {log.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }} aria-label="Thesis change log">
            <thead><tr>{['Date', 'Change', 'Evidence', 'Impact'].map((h) => <th key={h} style={{ textAlign: 'left', borderBottom: `1px solid ${R.border}`, padding: '3px 6px', color: R.faint, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
            <tbody>{log.map((r, i) => (
              <tr key={i}>{[r.date, r.change, r.evidence, r.impact].map((c, j) => <td key={j} style={{ verticalAlign: 'top', borderBottom: `1px solid ${R.border}`, padding: '3px 6px', color: R.text }}>{c}</td>)}</tr>
            ))}</tbody>
          </table>
        )}
        {e.postMortem && (
          <div style={{ marginTop: 8, fontSize: 12, color: R.text }}>
            <b style={{ color: R.red }}>Post-mortem</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              <li>Original catalyst: {e.postMortem.originalCatalyst}</li><li>Evidence level: {e.postMortem.evidenceLevel}</li><li>Expected mechanism: {e.postMortem.expectedMechanism}</li>
              <li>Where it failed: {e.postMortem.failurePoint}</li><li>What happened: {e.postMortem.actualOutcome}</li><li>Why we missed it: {e.postMortem.detectionFailureWhy}</li>
            </ul>
          </div>
        )}
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: R.dim }}>
          {e.history.length === 0 && <li>No status changes yet.</li>}
          {e.history.map((h, i) => <li key={i}>{h.date}: {THESIS_STATUS_LABEL[h.from]} to {THESIS_STATUS_LABEL[h.to]} - {h.reason}</li>)}
        </ul>
      </details>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={to} onChange={(x) => setTo(x.target.value as ThesisStatus)} style={{ ...input, width: 'auto' }} aria-label="New status">
          {STATUS_LIST.map((s) => <option key={s} value={s}>{THESIS_STATUS_LABEL[s]}</option>)}
        </select>
        {to === 'BROKEN' && e.status !== 'BROKEN' && <input value={why} onChange={(x) => setWhy(x.target.value)} placeholder="Why did we miss it? (for the post-mortem)" style={{ ...input, flex: 1, minWidth: 200, width: 'auto' }} />}
        <input value={reason} onChange={(x) => setReason(x.target.value)} placeholder="Reason: what evidence changed (required)" style={{ ...input, flex: 1, minWidth: 200, width: 'auto' }} />
        <button type="button" style={btn(R.cyan, true)} onClick={() => { const m = onStatus(e.id, to, reason, to === 'BROKEN' && why.trim() ? { postMortem: { detectionFailureWhy: why.trim() } } : undefined); setErr(m || null); if (!m) setReason(''); }}>Change status</button>
        <button type="button" style={btn()} onClick={() => setEditing((v) => !v)}>{editing ? 'Close edit' : 'Edit'}</button>
        {confirmDel
          ? <><button type="button" style={btn(R.red, true)} onClick={() => onDelete(e.id)}>Confirm delete</button><button type="button" style={btn()} onClick={() => setConfirmDel(false)}>Keep</button></>
          : <button type="button" style={btn(R.red)} onClick={() => setConfirmDel(true)}>Delete</button>}
      </div>
      {err && <div style={{ fontSize: 11, color: R.red }}>{err}</div>}
      {editing && <LedgerForm initial={e} title={`Edit ${e.ticker}`} saveLabel="Save changes" onSave={(v) => { onEdit(v); setEditing(false); }} onCancel={() => setEditing(false)} />}
    </div>
  );
}

export function LedgerPanel({ entries, onEdit, onDelete, onStatus, now }: {
  entries: LedgerEntry[]; onEdit: (e: LedgerEntry) => void; onDelete: (id: string) => void;
  onStatus: (id: string, to: ThesisStatus, reason: string, extra?: { postMortem?: { detectionFailureWhy?: string; failurePoint?: string } }) => string | undefined; now: string;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Thesis ledger">
      <div style={{ fontSize: 13, fontWeight: 800, color: R.text }}>Thesis ledger ({entries.length})</div>
      <div style={{ fontSize: 12, color: R.dim }}>
        Names you chose to track. Status moves only on written evidence, never on a price move. Saved in this browser only.
      </div>
      {entries.length === 0 && <div style={{ fontSize: 12, color: R.faint }}>Nothing in the ledger yet. Use Add to thesis ledger on a radar card.</div>}
      {entries.map((e) => <Row key={e.id} e={e} onEdit={onEdit} onDelete={onDelete} onStatus={onStatus} now={now} />)}
    </section>
  );
}

export { updateStatusIn };
