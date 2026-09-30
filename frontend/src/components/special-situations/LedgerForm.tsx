'use client';
// zzz841 — editable ledger fields. Used by the "Add to thesis ledger" confirm
// panel (human approval: nothing is saved until the owner presses Save) and by
// the ledger's edit mode. There is no price or move field anywhere in it.

import React, { useState } from 'react';
import type { LedgerEntry } from '@/lib/multibagger-radar-types';
import { FIELD_LABEL, TEXT_FIELDS, validateEntry } from '@/lib/multibagger-ledger-store';
import { R } from './radar-tokens';
import { btn, input } from './RadarBits';

export function LedgerForm({ initial, title, saveLabel, onSave, onCancel }: {
  initial: LedgerEntry; title: string; saveLabel: string; onSave: (e: LedgerEntry) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<LedgerEntry>(initial);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const save = () => {
    const v = validateEntry(draft);
    if (!v) { setErr('Ticker is required.'); return; }
    onSave(v);
  };
  return (
    <div style={{ border: `1px solid ${R.cyan}`, borderRadius: 8, padding: 10, background: R.bg2, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: R.text }}>{title}</div>
      <div style={{ fontSize: 11, color: R.dim }}>
        Pre-filled from the radar. Edit anything, then save. Nothing enters the ledger until you press the button. Fields the feed could not fill say Not established.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
        {TEXT_FIELDS.map((f) => (
          <label key={f} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: R.faint, textTransform: 'uppercase', letterSpacing: 0.5 }}>{FIELD_LABEL[f]}</span>
            <textarea value={draft[f]} rows={2} onChange={(e) => set(f, e.target.value)} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
          </label>
        ))}
        {(['upgradeCondition', 'downgradeCondition'] as const).map((f) => (
          <label key={f} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: R.faint, textTransform: 'uppercase', letterSpacing: 0.5 }}>{f === 'upgradeCondition' ? 'What would upgrade it' : 'What would downgrade it'}</span>
            <textarea value={draft[f] || ''} rows={2} onChange={(e) => set(f, e.target.value)} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
          </label>
        ))}
      </div>
      {err && <div style={{ fontSize: 11, color: R.red }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={save} style={btn(R.green, true)}>{saveLabel}</button>
        <button type="button" onClick={onCancel} style={btn()}>Cancel</button>
      </div>
    </div>
  );
}
