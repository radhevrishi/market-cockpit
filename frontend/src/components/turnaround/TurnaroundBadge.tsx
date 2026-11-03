'use client';
// zzz1227 — "Turnaround → Compounder" read on an AI Daily Gainers card or a Transformational Gainers row. Additive: it only
// shows when the event is a turnaround catalyst (new owner, new brand licence, format roll-out, funding repair, loss → profit).
import React, { useMemo, useState } from 'react';
import { R, tint } from '@/components/special-situations/radar-tokens';
import type { Turnaround } from '@/lib/turnaround/core';

const GATE_COLOR = { PASS: R.green, OPEN: R.amber, STOP: R.red } as const;
const GATE_WORD = { PASS: 'ok', OPEN: 'check', STOP: 'STOP' } as const;

export function TurnaroundBadge({ ta, compact = false }: { ta: Turnaround | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const c = useMemo(() => (ta ? (ta.decision === 'HARD_STOP' ? R.red : ta.stage >= 3 ? R.green : ta.stage === 2 ? R.cyan : R.amber) : R.faint), [ta]);
  if (!ta) return null;
  return (
    <div data-testid="turnaround-badge" style={{ padding: compact ? 0 : '6px 8px', borderRadius: 8, background: compact ? 'transparent' : tint(c, 6), border: compact ? 'none' : `1px solid ${tint(c, 35)}` }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        title={`${ta.archetypeWord} · ${ta.stageWord}. Model case: ${ta.analogue}. Click for the gates and the next proof.`}
        style={{ fontSize: 11, fontWeight: 800, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: '3px 8px', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        🔄 Turnaround · {ta.archetypeWord} · Stage {ta.stage}{ta.decision === 'HARD_STOP' ? ' · HARD GATE' : ''} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={{ fontSize: 11.5, color: R.dim, lineHeight: 1.5, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div><b style={{ color: R.text }}>{ta.stageWord}</b></div>
          <div><b style={{ color: R.text }}>Catalyst:</b> {ta.catalyst}</div>
          {ta.proof && <div><b style={{ color: R.text }}>Proof already filed:</b> {ta.proof}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['survive', 'dilution', 'governance'] as const).map((k) => (
              <span key={k} style={{ fontSize: 10.5, fontWeight: 700, color: GATE_COLOR[ta.gates[k]], border: `1px solid ${tint(GATE_COLOR[ta.gates[k]], 50)}`, borderRadius: 4, padding: '1px 6px' }}>
                {k === 'survive' ? 'Survive' : k === 'dilution' ? 'Dilution' : 'Governance'}: {GATE_WORD[ta.gates[k]]}
              </span>
            ))}
          </div>
          {ta.hardStops.length > 0 && <div style={{ color: R.red, fontWeight: 700 }}>Hard gate: {ta.hardStops.join(' · ')}</div>}
          {ta.gates.notes.map((n, i) => <div key={i} style={{ color: R.amber }}>• {n}</div>)}
          <div><b style={{ color: R.text }}>Next proof:</b> {ta.nextProof}</div>
          <div><b style={{ color: R.text }}>Kill event:</b> {ta.killEvent}</div>
          <div><b style={{ color: R.text }}>Decision:</b> {ta.decisionWord}</div>
          <div style={{ color: R.faint }}>Model case: {ta.analogue}</div>
          <details>
            <summary style={{ cursor: 'pointer', color: R.faint }}>Five-line decision memo</summary>
            {ta.memo.map((m, i) => <div key={i}>{m}</div>)}
          </details>
          <div style={{ color: R.faint, fontSize: 10.5 }}>Survival solved and a good return for minority shareholders are separate questions. Research, not a recommendation.</div>
        </div>
      )}
    </div>
  );
}
