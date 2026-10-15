// zzz1029 — an overlay's status line docked as one chip in the overlay summary row (OverlaySummary): the row decides which chip's
// details are open (one at a time); the chip box sits in the row's flex line and its details open under the row, not under the chip.
import type { CSSProperties } from 'react';

export interface OverlayDock {
  open: boolean;
  setOpen: (v: boolean) => void;
}

/** the chip's box inside the summary row: keeps a readable width (pattern name + condition, stage + confirmation) — the row wraps onto
 *  a second line instead of cutting chips down to "Daily: …" (zzz1031, QA) */
export const DOCK_BOX: CSSProperties = { position: 'static', flex: '0 1 auto', minWidth: 'min(240px, 100%)', maxWidth: 440, fontSize: 12, pointerEvents: 'auto' };
/** the chip's pill: one line, the text shrinks first */
export const DOCK_PILL: CSSProperties = { minWidth: 0, overflow: 'hidden' };
/** the details panel: under the whole row (the row is the positioned parent), above the legend */
export const DOCK_PANEL: CSSProperties = { position: 'absolute', left: 0, top: 'calc(100% + 6px)', marginTop: 0, zIndex: 8 };
