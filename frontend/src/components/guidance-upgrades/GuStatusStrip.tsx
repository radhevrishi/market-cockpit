'use client';
// zzz1121 (guidance audit, operational blocker) — one compact line under the page title: when the guidance data was built, whether the
// last refresh worked, and whether new documents are waiting because the monthly AI verification cap is reached. It never raises the
// cap and never marks anything verified; it only says why new guidance may be missing.
import React from 'react';
import { R } from './gu-tokens';
import { useGuUniverse } from './useGuUniverse';
import { ageText } from '@/lib/gu-client-cache';

export function verificationBlockLine(v: any, now: Date = new Date()): string | null {
  // zzz1153 — the provider account refuses every call (Anthropic credit used up, 20 Oct): the AI reading and checking are stalled
  if (v && v.available !== false && typeof v.providerNote === 'string' && v.providerNote) {
    const queue = typeof v.queueSize === 'number' && v.queueSize > 0 ? ` ${v.queueSize} documents are waiting to be checked.` : '';
    return `Verification and guidance reading paused: ${v.providerNote}.${queue} Nothing is marked verified without the check; reading resumes on its own once the account has credit.`;
  }
  if (!v || v.available !== false) return null;
  const reason = String(v.unavailableReason || 'the AI check is not available').replace(/\s*—\s*raise [^.]*$/i, '');
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const queue = typeof v.queueSize === 'number' && v.queueSize > 0 ? ` ${v.queueSize} documents are waiting to be checked.` : '';
  return `Verification paused: ${reason}.${queue}${/cap/i.test(reason) ? ` The monthly cap resets on ${reset}.` : ''} Nothing is marked verified without the check, so new guidance may be missing until then.`;
}

export function GuStatusStrip() {
  const u = useGuUniverse({ market: 'ALL', view: 'active' });
  const d: any = u.data;
  // zzz1138 — a "paused" state read from this browser's SAVED copy can be out of date (the owner raised the cap on Railway and still saw
  // "$40.13 of $40"): when the shown copy is a saved one and says paused, ask the server once for the current state. One request, not a loop.
  const savedPaused = !!d && u.savedAgeMs != null && d.verification?.available === false;
  const asked = React.useRef(false);
  React.useEffect(() => { if (savedPaused && !asked.current) { asked.current = true; u.retry(); } }, [savedPaused, u]);
  if (!d) return null;
  const built = d.builtAt ? new Date(d.builtAt) : null;
  const block = verificationBlockLine(d.verification);
  const parts: string[] = [];
  if (built && Number.isFinite(built.getTime())) parts.push(`Guidance data built ${ageText(Date.now() - built.getTime())}`);
  if (d.servedFrom && d.servedFrom !== 'live') parts.push(d.servedFrom === 'last_good' ? 'served from the last good build (the live build failed)' : 'served from the stored seed');
  if (u.refreshError) parts.push(`last refresh failed (${u.refreshError})`);
  else if (u.savedAgeMs != null) parts.push(`saved copy from ${ageText(u.savedAgeMs)}`);
  if (!parts.length && !block) return null;
  return (
    <div className="gu-noprint" role="status" style={{ display: 'grid', gap: 2, fontSize: 12, color: R.dim }}>
      {parts.length > 0 && <span>{parts.join(' · ')}</span>}
      {block && <span style={{ color: R.amber }}>⚠ {block}{u.savedAgeMs != null ? ` (state saved ${ageText(u.savedAgeMs)} — checking the server now)` : ''}</span>}
    </div>
  );
}
