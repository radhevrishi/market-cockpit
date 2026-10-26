'use client';
// zzz1166 — the "multibagger chance" chip: the rules read (always), and the AI read beside it when there is one. Click opens why.
import React, { useState } from 'react';
import { R, tint } from '@/components/special-situations/radar-tokens';
import { MB_WORD, chanceOf, type AiMb, type MbLabel, type MbView } from '@/lib/transformational/core';

export const MB_COLOR: Record<MbLabel, string> = { HIGH: R.green, MEDIUM: R.cyan, LOW: R.amber, UNLIKELY: R.grey };

export function MbChip({ mb, ai, compact = false }: { mb: MbView; ai?: AiMb | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const c = MB_COLOR[mb.label];
  const ac = ai ? MB_COLOR[ai.label] : null;
  const all = chanceOf({ mb, ai });
  const oc = MB_COLOR[all.label];
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, verticalAlign: 'top' }}>
      {ai && (
        <button type="button" onClick={() => setOpen((v) => !v)} title="The ranking: the rules read and the AI read, half each."
          style={{ cursor: 'pointer', alignSelf: 'flex-start', fontSize: 12, fontWeight: 900, padding: '3px 9px', borderRadius: 6, border: `1px solid ${oc}`, color: oc, background: tint(oc, 14), whiteSpace: 'nowrap' }}>
          Overall: {MB_WORD[all.label]} · {all.score}/100
        </button>
      )}
      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen((v) => !v)} title="Multibagger chance (rules): size, how big and lasting the event is, growth, margin, cash, theme, evidence, how far the share already ran. Click for why."
          style={{ cursor: 'pointer', fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 999, border: `1px solid ${c}`, color: c, background: tint(c, 10), whiteSpace: 'nowrap' }}>
          🚀 {ai ? 'Rules' : 'Multibagger chance'}: {MB_WORD[mb.label]} · {mb.score}/100
        </button>
        {ai && ac && (
          <button type="button" onClick={() => setOpen((v) => !v)} title="The AI's own read of the same facts (a second opinion). Click for why."
            style={{ cursor: 'pointer', fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 999, border: `1px dashed ${ac}`, color: ac, background: tint(ac, 8), whiteSpace: 'nowrap' }}>
            🤖 AI: {MB_WORD[ai.label]} · {ai.probabilityPct}% chance of 3x+
          </button>
        )}
      </span>
      {open && (
        <span style={{ display: 'block', fontSize: 12, lineHeight: 1.45, color: R.text, background: R.bg2, border: `1px solid ${R.border}`, borderRadius: 8, padding: '8px 10px', maxWidth: 560 }}>
          <b style={{ color: c }}>Rules read ({mb.score}/100)</b>
          {mb.plus.length > 0 && <span style={{ display: 'block' }}>{mb.plus.map((p) => <span key={p} style={{ display: 'block', color: R.green }}>+ {p}</span>)}</span>}
          {mb.minus.length > 0 && <span style={{ display: 'block' }}>{mb.minus.map((p) => <span key={p} style={{ display: 'block', color: R.red }}>− {p}</span>)}</span>}
          {ai && (
            <span style={{ display: 'block', marginTop: 6, paddingTop: 6, borderTop: `1px solid ${R.border}` }}>
              <b style={{ color: ac || R.text }}>AI read · {ai.probabilityPct}% chance of 3x or more in 2–4 years</b>
              {ai.why.map((w) => <span key={w} style={{ display: 'block', color: R.green }}>+ {w}</span>)}
              {ai.risks.map((w) => <span key={w} style={{ display: 'block', color: R.red }}>− {w}</span>)}
              {ai.verifyNext.length > 0 && <span style={{ display: 'block', marginTop: 4, color: R.dim }}>Check next: {ai.verifyNext.join(' · ')}</span>}
              {ai.theme && <span style={{ display: 'block', color: R.dim }}>AI suggests theme: {ai.theme}</span>}
            </span>
          )}
          <span style={{ display: 'block', marginTop: 4, color: R.faint, fontSize: 11 }}>A research prompt from the filed facts — not a forecast or advice.</span>
        </span>
      )}
    </span>
  );
}
