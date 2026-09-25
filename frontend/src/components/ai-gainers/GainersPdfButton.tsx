'use client';
// "⬇ Download PDF" on the AI Daily Gainers page — sits next to RESCAN.
// Writes what the page shows for the selected market to an A4 research note.
// jspdf (and the builder) load only on the click, never with the page. (zzz800)

import React, { useState } from 'react';
import type { ResearchView } from '@/lib/ai-gainers/research-view';
import { C } from './tokens';

export interface GainersPdfButtonProps {
  view: ResearchView | null;
  market: 'IN' | 'US';
  sessionNote?: string | null;
  criteria?: string | null;
  demo?: boolean;
  /** Set while the scan / research is still loading: the button is disabled and says why. */
  disabledReason?: string | null;
}

export function GainersPdfButton({ view, market, sessionNote, criteria, demo, disabledReason }: GainersPdfButtonProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reason = !view ? 'Nothing to export yet — the page has no research view.' : disabledReason || null;
  const disabled = busy || !!reason;

  const onClick = async () => {
    if (disabled || !view) return;
    setBusy(true); setErr(null);
    try {
      const { downloadGainersPdf } = await import('@/lib/ai-gainers/gainers-pdf');
      await downloadGainersPdf({ view, market, sessionNote, criteria, demo });
    } catch (e: any) {
      setErr(`The PDF could not be built: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled} data-testid="gainers-pdf"
        title={reason || `Download a research PDF of this page (${market === 'US' ? 'USA' : 'India'}): summary, research queue with every card, and the lists below it.`}
        style={{
          fontSize: 12, fontWeight: 800, letterSpacing: 0.3, padding: '4px 10px', borderRadius: 6, lineHeight: 1.4, whiteSpace: 'nowrap',
          border: `1px solid ${disabled ? C.border : C.cyan}`, background: 'transparent', color: disabled ? C.faint : C.cyan,
          cursor: busy ? 'wait' : disabled ? 'not-allowed' : 'pointer',
        }}>
        {busy ? 'Building PDF…' : '⬇ Download PDF'}
      </button>
      {reason && !busy && <span style={{ fontSize: 11.5, color: C.faint }}>{reason}</span>}
      {err && <span role="alert" style={{ fontSize: 11.5, color: C.amber }}>{err}</span>}
    </span>
  );
}
