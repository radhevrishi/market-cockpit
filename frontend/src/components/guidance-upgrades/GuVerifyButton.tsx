'use client';
// zzz863 — "Check unverified with AI now": one press reads the waiting company documents, then verifies the claims, then reloads the page data.
// The AI key stays on the server (Railway). This only calls the owner-only routes; a paid run is capped per run and per month by the server.
import React, { useState } from 'react';
import { R } from './gu-tokens';
import { btn } from './GuBits';
import { aiRunText } from './gu-ui';

export const GU_REFRESH_EVENT = 'gu-refresh';
async function post(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(75_000) });
    if (r.status === 401) throw new Error('login');
    const j = await r.json().catch(() => null) as { ok?: boolean; run?: Record<string, unknown>; error?: string } | null;
    return j?.ok && j.run ? j.run : null;
  } catch (e) { if ((e as Error)?.message === 'login') throw e; return null; }
}

export function GuVerifyButton({ pending }: { pending?: number | null }) {
  const [busy, setBusy] = useState<'' | 'read' | 'check'>('');
  const [res, setRes] = useState<{ tone: 'green' | 'amber' | 'red'; text: string } | null>(null);
  const run = async () => {
    setBusy('read'); setRes(null);
    try {
      const ex = await post('/api/v1/guidance-extract');
      setBusy('check');
      const vf = await post('/api/v1/ai-verify');
      setRes(aiRunText(ex, vf));
      if (ex || vf) window.dispatchEvent(new Event(GU_REFRESH_EVENT));
    } catch { setRes({ tone: 'red', text: 'Please log in to the site first, then press the button again.' }); }
    setBusy('');
  };
  const col = res ? (res.tone === 'green' ? R.green : res.tone === 'amber' ? R.amber : R.red) : R.dim;
  return (
    <div className="gu-noprint" data-gu-verify style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" style={btn(R.violet, true)} disabled={!!busy} onClick={run}>
        {busy === 'read' ? 'Reading company documents…' : busy === 'check' ? 'Checking claims with AI…' : '🤖 Check unverified with AI now'}
      </button>
      <span style={{ fontSize: 12, color: R.dim }}>{pending ? `${pending} claims are waiting. ` : ''}Reads the company documents, then checks each claim against them. Takes up to two minutes.</span>
      {res && <span data-gu-verify-result role="status" style={{ fontSize: 12, color: col, fontWeight: 700, flexBasis: '100%' }}>{res.text}</span>}
    </div>
  );
}
