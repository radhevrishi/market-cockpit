'use client';

// ═══════════════════════════════════════════════════════════════════════════
// The reading queue behind "New · last 10 days".                     (zzz813)
//
// The page hands over the filings in the window that should be opened
// (newest first). This hook reads them through /api/v1/catalyst/read-filings
// in small batches — 5 per call, one call at a time — and keeps the answers.
// Reads are cached on the server per document; this browser also remembers
// successful reads (localStorage, a convenience only), so a revisit paints at
// once. A document the server could not reach in its time budget is asked
// for again once; a document that cannot be read stays failed with the reason.
// No model is called anywhere on this path.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { normUrl, type ReadRequest } from '@/lib/catalyst/recent-events';
import type { FilingRead } from '@/lib/catalyst/filing-read-types';

const VERSION = 'r3';
const BATCH = 5;
const CLIENT_TIMEOUT_MS = 55_000;
const LS_MAX = 800;

const lsKey = (market: 'IN' | 'US') => `mc:pc-new-reads:v3:${market}`;

function loadLocal(market: 'IN' | 'US'): Record<string, FilingRead> {
  try {
    const raw = window.localStorage.getItem(lsKey(market));
    if (!raw) return {};
    const j = JSON.parse(raw);
    const out: Record<string, FilingRead> = {};
    for (const [k, v] of Object.entries(j || {})) if (v && (v as any).status === 'read' && (v as any).version === VERSION) out[k] = v as FilingRead;
    return out;
  } catch { return {}; }
}

function saveLocal(market: 'IN' | 'US', reads: Record<string, FilingRead>) {
  try {
    const ok = Object.entries(reads).filter(([, v]) => v.status === 'read')
      .sort((a, b) => String(b[1].readAt || '').localeCompare(String(a[1].readAt || ''))).slice(0, LS_MAX);
    window.localStorage.setItem(lsKey(market), JSON.stringify(Object.fromEntries(ok)));
  } catch { /* storage full or blocked — the server cache still holds every read */ }
}

export interface ReadProgress { running: boolean; error: string | null }

export function useFilingReads(queue: ReadRequest[] | null | undefined, market: 'IN' | 'US', enabled: boolean): { reads: Record<string, FilingRead>; progress: ReadProgress } {
  const [reads, setReads] = useState<Record<string, FilingRead>>({});
  const [progress, setProgress] = useState<ReadProgress>({ running: false, error: null });
  const readsRef = useRef<Record<string, FilingRead>>({});
  const queueRef = useRef<ReadRequest[]>([]);
  const attempts = useRef<Map<string, number>>(new Map());
  const running = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const local = loadLocal(market);
    readsRef.current = { ...local, ...readsRef.current };
    setReads(readsRef.current);
    return () => { alive.current = false; };
  }, [market]);

  queueRef.current = queue || [];
  const queueKey = (queue || []).map((q) => q.url).join('|');

  useEffect(() => {
    if (!enabled || running.current) return;
    const pendingNow = () => queueRef.current.filter((q) => {
      const k = normUrl(q.url);
      if (readsRef.current[k]) return false;
      return (attempts.current.get(k) || 0) < 2;
    });
    if (!pendingNow().length) return;
    running.current = true;
    setProgress({ running: true, error: null });
    (async () => {
      let lastError: string | null = null;
      while (alive.current) {
        const batch = pendingNow().slice(0, BATCH);
        if (!batch.length) break;
        for (const q of batch) attempts.current.set(normUrl(q.url), (attempts.current.get(normUrl(q.url)) || 0) + 1);
        let got: FilingRead[] = [];
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);
          const r = await fetch('/api/v1/catalyst/read-filings', {
            method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', signal: ctl.signal,
            body: JSON.stringify({ market, items: batch }),
          });
          clearTimeout(t);
          if (!r.ok) throw new Error(`the reader answered HTTP ${r.status}`);
          const j = await r.json();
          got = Array.isArray(j?.reads) ? j.reads : [];
        } catch (e: any) {
          lastError = e?.name === 'AbortError' ? 'the reader did not answer in time' : (e?.message || 'the reader could not be reached');
          // a second failure for the same documents marks them failed with the reason, never blank
          got = batch.filter((q) => (attempts.current.get(normUrl(q.url)) || 0) >= 2)
            .map((q) => ({ url: q.url, status: 'failed' as const, reason: lastError, version: VERSION }));
        }
        if (!alive.current) break;
        const next = { ...readsRef.current };
        for (const g of got) {
          if (!g || !g.url) continue;
          const k = normUrl(g.url);
          // "not reached in this pass" / "timed out" — asked again once, not recorded yet
          if (g.status === 'failed' && /will retry/i.test(String(g.reason || '')) && (attempts.current.get(k) || 0) < 2) continue;
          next[k] = g;
        }
        readsRef.current = next;
        setReads(next);
        saveLocal(market, next);
      }
      running.current = false;
      if (alive.current) setProgress({ running: false, error: lastError });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, queueKey, market]);

  return { reads, progress };
}
