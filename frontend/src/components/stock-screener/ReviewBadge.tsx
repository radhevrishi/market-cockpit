'use client';
// zzz1006 — review progress as a small badge; clicking it opens the same four choices the dropdown had (stored by workflow.ts).
import { REVIEW_STATES, type ReviewState } from '@/lib/screener/workflow';
import { listKeys, usePopover } from './screener-ui';

export default function ReviewBadge({ ticker, state, onChange }: { ticker: string; state: ReviewState; onChange: (s: ReviewState) => void }) {
  const { open, setOpen, ref } = usePopover();
  const label = REVIEW_STATES.find((x) => x.id === state)?.label || 'Unreviewed';
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className={`mcss-badge ${state}`} aria-label={`Review state for ${ticker}: ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {state === 'chart' || state === 'filings' ? '✓ ' : ''}{label}
      </button>
      {open ? (
        <div className="mcss-pop" role="menu" aria-label={`Review state for ${ticker}`} style={{ minWidth: 170 }} onKeyDown={(e) => listKeys(e)}
          ref={(el) => { if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(); }}>
          {REVIEW_STATES.map((x) => (
            <button key={x.id} type="button" role="menuitemradio" aria-checked={x.id === state} className="mcss-item" onClick={() => { onChange(x.id); setOpen(false); }}>
              <span style={{ width: 14 }}>{x.id === state ? '✓' : ''}</span>{x.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
