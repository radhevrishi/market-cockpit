'use client';
// zzz863 — "Check unverified with AI now": one press reads the waiting company documents, then verifies the claims, then reloads the page data.
// The AI key stays on the server (Railway). This only calls the owner-only routes; a paid run is capped per run and per month by the server.
import React, { useState } from 'react';
import { R } from './gu-tokens';
import { btn } from './GuBits';
import { aiRunText } from './gu-ui';

export const GU_REFRESH_EVENT = 'gu-refresh';
interface Step { run: Record<string, unknown> | null; error: string | null }
/** One owner-only POST. The real reason is kept (login, rate limit, server error, timeout) so the page can say it instead of a generic line. */
async function post(url: string): Promise<Step> {
  try {
    const r = await fetch(url, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(80_000) });
    const j = await r.json().catch(() => null) as { ok?: boolean; run?: Record<string, unknown>; error?: string } | null;
    if (r.status === 401) return { run: null, error: 'login' };
    if (r.status === 429) return { run: null, error: 'You pressed it too often. Wait one minute and press again.' };
    if (j?.ok && j.run) return { run: j.run, error: null };
    return { run: null, error: j?.error ? `${j.error} (HTTP ${r.status})` : `The server answered HTTP ${r.status} without a result.` };
  } catch (e) {
    const m = String((e as Error)?.name || '');
    return { run: null, error: m === 'TimeoutError' || m === 'AbortError' ? 'The run took longer than 80 seconds. Press again: it continues where it stopped.' : 'The request could not reach the server. Check the connection and press again.' };
  }
}
const num = (o: Record<string, unknown> | null, k: string) => (o && typeof o[k] === 'number' ? (o[k] as number) : 0);

export function GuVerifyButton({ pending }: { pending?: number | null }) {
  const [busy, setBusy] = useState<'' | 'read' | 'check'>('');
  const [res, setRes] = useState<{ tone: 'green' | 'amber' | 'red'; text: string } | null>(null);
  const run = async () => {
    setBusy('read'); setRes(null);
    // up to 3 rounds: each round reads waiting documents, then checks claims; it stops when nothing more is waiting or a round made no progress
    let ex: Record<string, unknown> | null = null; let vf: Record<string, unknown> | null = null; let err: string | null = null;
    let readAll = 0, confAll = 0, badAll = 0, checkedAll = 0, noDoc = 0, spent = 0, left = 0;
    for (let round = 1; round <= 3; round++) {
      setBusy('read');
      const a = await post('/api/v1/guidance-extract');
      if (a.error === 'login') { setRes({ tone: 'red', text: 'Please log in to the site first, then press the button again.' }); setBusy(''); return; }
      setBusy('check');
      const b = await post('/api/v1/ai-verify');
      if (b.error === 'login') { setRes({ tone: 'red', text: 'Please log in to the site first, then press the button again.' }); setBusy(''); return; }
      ex = a.run ?? ex; vf = b.run ?? vf; err = a.error || b.error || err;
      const read = num(a.run, 'ok') + num(a.run, 'noGuidance'); const conf = num(b.run, 'confirmed');
      readAll += read; confAll += conf; badAll += num(b.run, 'contradicted'); checkedAll += num(b.run, 'checked'); noDoc += num(b.run, 'notFound') + num(b.run, 'noPrimary');
      spent += num(a.run, 'spentUsd') + num(b.run, 'spentUsd'); left = num(b.run, 'queueAfter');
      if ((a.run && a.run.available === false) || (b.run && b.run.available === false)) break;
      if (!left || (read + conf + num(b.run, 'checked') === 0)) break;
    }
    setBusy('');
    const off = [ex, vf].find((o) => o && o.available === false);
    if (off) { setRes(aiRunText(ex, vf)); return; }
    if (!ex && !vf) { setRes({ tone: 'red', text: `The AI check could not run. Reason: ${err || 'unknown'}. Nothing was changed.` }); return; }
    const text = `Read ${readAll} company document${readAll === 1 ? '' : 's'} · checked ${checkedAll} claim${checkedAll === 1 ? '' : 's'}: ${confAll} confirmed, ${badAll} not supported by the document, ${noDoc} still without a document${left ? ` · ${left} more wait for the next press` : ''}${spent ? ` · cost about $${spent.toFixed(2)}` : ''}.${err ? ` One step reported: ${err}` : ''}`;
    setRes({ tone: confAll + readAll > 0 ? (err ? 'amber' : 'green') : 'amber', text });
    window.dispatchEvent(new Event(GU_REFRESH_EVENT));
  };
  const col = res ? (res.tone === 'green' ? R.green : res.tone === 'amber' ? R.amber : R.red) : R.dim;
  return (
    <div className="gu-noprint" data-gu-verify style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" style={btn(R.violet, true)} disabled={!!busy} onClick={run}>
        {busy === 'read' ? 'Reading company documents…' : busy === 'check' ? 'Checking claims with AI…' : '🤖 Check unverified with AI now'}
      </button>
      <span style={{ fontSize: 12, color: R.dim }}>{pending ? `${pending} claims are waiting. ` : ''}Reads the company documents, then checks each claim against them. It repeats up to three rounds and can take a few minutes.</span>
      {res && <span data-gu-verify-result role="status" style={{ fontSize: 12, color: col, fontWeight: 700, flexBasis: '100%' }}>{res.text}</span>}
    </div>
  );
}
