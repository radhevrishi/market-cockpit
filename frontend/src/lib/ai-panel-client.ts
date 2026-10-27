// zzz1181 — browser side of a background AI run: start it (POST), then ask for its state every few seconds (GET) until it
// is done, failed or 7 minutes passed. Works across a page reload: call poll() on mount when the GET says "running".
export interface PanelGet<R> { ok: boolean; report: R | null; job?: { state: 'idle' | 'running' | 'done' | 'error'; startedAt: string | null; error: string | null } }

export async function pollJob<R>(url: string, startedAt: string | null, onTick?: (secs: number) => void): Promise<{ report: R | null; error: string | null }> {
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60_000) {
    await new Promise((r) => setTimeout(r, 5000));
    onTick?.(Math.round((Date.now() - (startedAt ? Date.parse(startedAt) : t0)) / 1000));
    const j: PanelGet<R> | null = await fetch(url, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    const st = j?.job?.state;
    if (st === 'done') return { report: j?.report ?? null, error: null };
    if (st === 'error') return { report: j?.report ?? null, error: j?.job?.error || 'The AI run failed.' };
  }
  return { report: null, error: 'Still running after 7 minutes — check back later; the page will show the result once it is saved.' };
}

export async function startAndPoll<R>(url: string, onTick?: (secs: number) => void): Promise<{ report: R | null; error: string | null }> {
  const r = await fetch(url, { method: 'POST' });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) return { report: null, error: j?.error || `Could not start (HTTP ${r.status})` };
  return pollJob<R>(url, j.job?.startedAt ?? null, onTick);
}
