'use client';
// zzz858 — events shown before the AI has checked them against the company document. The feed marks each one with
// `verification_pending`; the page puts their ids in this context and every card shows a "Not checked yet" chip.
import React, { createContext, useContext } from 'react';

export type PendingMap = ReadonlyMap<string, string>; // event id → reason text
export const PendingContext = createContext<PendingMap>(new Map());

/** Ids (and reason text) of shown events still waiting for the AI check, from the feed's events. */
export function pendingMapOf(events: ReadonlyArray<any> | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of events || []) {
    const p = e?.verification_pending;
    if (p && e?.event_id && !e?.quarantine_reason) m.set(String(e.event_id), String(p.reasonText || 'Not checked yet against the company document.'));
  }
  return m;
}

export function NotCheckedChip({ id }: { id: string | null | undefined }) {
  const m = useContext(PendingContext);
  const why = id ? m.get(String(id)) : undefined;
  if (!why) return null;
  return (
    <span data-ss-not-checked title={`${why} The AI check runs every hour; anything it cannot confirm is removed.`}
      style={{ fontSize: 11, fontWeight: 700, color: '#B45309', border: '1px dashed #B45309', borderRadius: 4, padding: '1px 6px', background: 'rgba(245,158,11,0.08)', whiteSpace: 'nowrap' }}>
      ⏳ Not checked yet
    </span>
  );
}
