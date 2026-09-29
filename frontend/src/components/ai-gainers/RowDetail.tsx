'use client';
// zzz841 — the detail lines under the compact rows (both markets). The text comes
// from lib/ai-gainers/row-detail.ts, the same lines the PDF prints.
import React from 'react';
import type { ResearchItem } from '@/lib/ai-gainers/research-view';
import { watchLines, olderLines, noCatalystLines, negativeLines, technicalLines, type DetailLine } from '@/lib/ai-gainers/row-detail';
import { ScoreChip } from './ScoreBox';
import { C } from './tokens';

const k: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint, marginRight: 6 };

function Lines({ lines, testid }: { lines: DetailLine[]; testid: string }) {
  if (!lines.length) return null;
  return (
    <div data-testid={testid} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      {lines.map((l, i) => (
        <div key={`${l.key}-${i}`} data-line={l.key} style={{ fontSize: 12, lineHeight: 1.45, color: l.tone === 'amber' ? C.amber : l.tone === 'muted' ? C.faint : C.dim, overflowWrap: 'anywhere' }}>
          {l.label ? <span style={k}>{l.label}</span> : <span style={{ ...k, display: 'inline-block', width: 0 }} />}{l.text}
        </div>
      ))}
    </div>
  );
}

export function WatchDetail({ it }: { it: ResearchItem }) {
  return (
    <div data-testid="watch-detail" style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <Lines lines={watchLines(it)} testid="watch-lines" />
      {it.catalystScore && <div><ScoreChip it={it} /></div>}
    </div>
  );
}
export function OlderDetail({ it, withEvent }: { it: ResearchItem; withEvent?: boolean }) {
  return <Lines lines={olderLines(it, { withEvent })} testid="older-lines" />;
}
export function NoCatalystDetail({ it }: { it: ResearchItem }) {
  return <Lines lines={noCatalystLines(it)} testid="nocat-lines" />;
}
export function NegativeDetail({ it }: { it: ResearchItem }) {
  return <Lines lines={negativeLines(it)} testid="negative-lines" />;
}
export function TechnicalDetail({ it }: { it: ResearchItem }) {
  return <Lines lines={technicalLines(it)} testid="technical-lines" />;
}
