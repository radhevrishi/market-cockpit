'use client';
// zzz837 — the one-click AI resolver controls, shared by both Portfolio
// Catalysts pages. Nothing here starts on its own: every button is a click.

import type { AiTypePlan } from '@/lib/thesis/ai-type';
import { CONFIRMATION_BANNER, RESOLVE_ALL_LABEL, RESOLVE_ALL_NOTE, type ConfirmationBreakdown } from '@/lib/thesis/ai-type';
import type { AiTypeRun } from '@/lib/thesis/use-ai-type';

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)', cyan: 'var(--tc-accent, #22D3EE)',
};
const pill = (color: string, strong = true): React.CSSProperties => ({
  fontSize: 13.5, fontWeight: strong ? 800 : 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${color}`, background: 'transparent', color,
});

export function AiResolveBar(p: {
  typePlan: AiTypePlan;
  /** Names with missing details (the existing gap fill). */
  gapCount: number;
  run: AiTypeRun;
  /** The book's own bulk-read progress (the details phase). */
  detailsBatch: { running: boolean; done: number; total: number };
  disabled?: boolean;
  onTypes: () => void;
  onAll: () => void;
  onStop: () => void;
}) {
  const { typePlan: tp, run } = p;
  const working = run.running;
  const done = run.phase === 'details' ? p.detailsBatch.done : run.done;
  const total = run.phase === 'details' ? p.detailsBatch.total : run.total;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const undecidedNote = tp.undecided.length ? ` · ${tp.undecided.length} AI could not decide (pick by hand)` : '';
  return (
    <span data-testid="ai-resolve" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {!working && tp.total > 0 && (
        <button data-testid="ai-type-bulk-go" onClick={p.onTypes} disabled={p.disabled}
          title={`AI reads each provisional name's business description and filed figures and picks A, B, F or G (or says undecided). One call per name, three at a time, Stop works. Only on click. AI never sees a price. Each card says the type was chosen by AI and you can change it with the picker.${undecidedNote}`}
          style={pill(C.cyan)}>{tp.label}</button>
      )}
      {!working && (tp.total > 0 || p.gapCount > 0) && (
        <button data-testid="ai-resolve-all-go" onClick={p.onAll} disabled={p.disabled}
          title={`${RESOLVE_ALL_NOTE} ${tp.total} type call${tp.total === 1 ? '' : 's'} first, then up to ${p.gapCount} missing-details read${p.gapCount === 1 ? '' : 's'}.`}
          style={pill(C.cyan)}>{RESOLVE_ALL_LABEL}</button>
      )}
      {!working && (tp.total > 0 || p.gapCount > 0) && (
        <span style={{ fontSize: 12.5, color: C.faint }}>uses AI, only on click · up to {tp.total + p.gapCount} calls</span>
      )}
      {working && (
        <span role="status" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.cyan }}>
            {run.phase === 'types' ? `Choosing types ${run.done} of ${run.total}…` : `Filling missing details ${p.detailsBatch.done} of ${p.detailsBatch.total}…`}
          </span>
          <span aria-hidden style={{ width: 140, height: 6, borderRadius: 3, background: 'var(--mc-bg-4)', display: 'inline-block', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: C.cyan }} />
          </span>
          <button onClick={p.onStop} style={pill(C.amber, false)}>Stop</button>
        </span>
      )}
      {!working && run.summary && (
        <span data-testid="ai-resolve-summary" style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>
          {run.stopped ? 'Stopped — ' : 'Done — '}{run.summary}
        </span>
      )}
    </span>
  );
}

/** The short "confirmation required" banner: what it is, and the AI option. */
export function ProvisionalBanner(p: { nearest: number; weak: number; breakdown: ConfirmationBreakdown; symbols: string[] }) {
  if (p.nearest <= 0) return null;
  return (
    <div data-testid="provisional-banner" style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
      <b style={{ color: C.cyan }}>{p.nearest} name{p.nearest === 1 ? ' is' : 's are'} on a provisional type (nearest fit, chosen by rules).</b>{' '}
      {CONFIRMATION_BANNER}
      {p.breakdown.total > 0 ? <> Of the {p.breakdown.total} at CONFIRMATION REQUIRED: {p.breakdown.line}.</> : null}
      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: C.faint }}>How a provisional type is confirmed, and which names</summary>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
          A type is confirmed when you pick it, when AI chooses it (you click), or when the filings confirm it: at least two of the type&apos;s checks confirmed from filed figures, one of them the core mechanism, covering at least 40% of its checks, nothing contradicted. A weak fit is never promoted by the filings.{p.weak > 0 ? ` ${p.weak} of these are a weak fit.` : ''}
          <div style={{ marginTop: 4 }}>{p.symbols.join(' · ')}</div>
        </div>
      </details>
    </div>
  );
}
