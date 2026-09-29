'use client';
// zzz839 — the Catalyst Score (0–12): a chip for lists and a full breakdown for the card.
// Read-only. Never used to sort. Price is not an input.
import React from 'react';
import type { ResearchItem } from '@/lib/ai-gainers/research-view';
import { scoreChipText } from '@/lib/ai-gainers/catalyst-score';
import { C, tint } from './tokens';

const bandColor = (b: string) => b === 'RESEARCH NOW' ? C.green : b === 'WATCH / CONFIRM' ? C.amber : b.startsWith('NEGATIVE') ? C.red : C.faint;
const lab: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.faint };

export function ScoreChip({ it }: { it: ResearchItem }) {
  const s = it.catalystScore;
  if (!s) return null;
  const col = bandColor(s.band);
  return (
    <span data-testid="score-chip" title={s.bandNote} style={{ fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 999, color: col, background: tint(col, 14), border: `1px solid ${tint(col, 40)}`, whiteSpace: 'nowrap' }}>
      {scoreChipText(s)}
    </span>
  );
}

export function ScoreBox({ it }: { it: ResearchItem }) {
  const s = it.catalystScore;
  if (!s) return null;
  if (!s.scored) return <div data-testid="score-box" style={{ fontSize: 12, color: C.faint }}><span style={{ ...lab, marginRight: 6 }}>CATALYST SCORE</span>Not scored — {s.notScoredReason}</div>;
  const col = bandColor(s.band);
  return (
    <details data-testid="score-box" style={{ background: C.bg2, borderRadius: 6, padding: '7px 10px', fontSize: 12.5, lineHeight: 1.5 }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
        <span style={{ ...lab, marginRight: 8 }}>CATALYST SCORE</span>
        <span style={{ fontWeight: 900, fontSize: 15, color: col }}>{s.total}/12</span>
        <span style={{ fontWeight: 800, color: col, marginLeft: 8 }}>{s.band}</span>
        {s.unscored.length > 0 && <span style={{ color: C.dim, marginLeft: 8 }}>· {s.unscored.length} factor{s.unscored.length > 1 ? 's' : ''} unknown (up to {s.ceiling})</span>}
        <span style={{ color: C.faint, marginLeft: 8 }}>▸ details</span>
      </summary>
      <div style={{ marginTop: 6, display: 'grid', gap: 3 }}>
        {s.factors.map((f) => (
          <div key={f.key} style={{ color: C.dim }}>
            <b style={{ color: C.text }}>{f.label} {f.points == null ? '?' : `${f.points}/2`}</b>{f.key === 'execution' && f.rating != null ? ` (risk ${f.rating})` : ''} — {f.why}
          </div>
        ))}
        <div style={{ color: C.dim }}><b style={{ color: C.text }}>Rule</b> — {s.bandNote}</div>
        {s.durationTierLabel && <div style={{ color: C.dim }}><b style={{ color: C.text }}>Duration tier</b> — {s.durationTierLabel}</div>}
        {s.versusBusiness.length > 0 && <div style={{ color: C.dim }}><b style={{ color: C.text }}>Versus the business</b> — {s.versusBusiness.join('; ')}</div>}
        <div style={{ color: C.dim }}><b style={{ color: C.text }}>Earnings chain</b> — {s.chain.map((c) => `${c.step}: ${c.status === 'stated' ? 'yes' : 'not established'}`).join(' → ')}</div>
        <div style={{ color: C.dim }}><b style={{ color: C.text }}>Execution tests</b> — {s.executionTests.map((t) => `${t.test}: ${t.answer}`).join(' · ')}</div>
        <div style={{ color: C.dim }}><b style={{ color: C.text }}>Watch next 2–4 quarters</b> — {s.kpis.join('; ')}</div>
        <div style={{ color: C.dim }}><b style={{ color: C.text }}>Fails if</b> — {s.invalidation.join('; ')}</div>
        <div style={{ color: C.faint }}>{s.disclaimer}</div>
      </div>
    </details>
  );
}
