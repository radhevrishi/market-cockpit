'use client';

// ═══════════════════════════════════════════════════════════════════════════
// India Earnings Opportunities — multi-day window loader  (zzz814)
//
//   1. Every date in the window that this page has not read yet is read from
//      the server's graded store in ONE batched request (a few when the window
//      is dense — the server returns what fits and names the rest `deferred`).
//   2. Dates the store has never graded are graded through the existing India
//      path (/api/v1/earnings/graded?date=…) ONE AT A TIME, newest first, with
//      a short pause between them — that path enriches from Screener/NSE, and
//      it is the rate limit there that sets the pace, not the page.
//   3. Nothing already on file is ever graded again. A date stored only under
//      the previous engine is shown as it is and labelled.
//
// Days land progressively; the page never waits for the whole window. Read
// days are kept for the life of the page, so widening 10d → 30d only reads the
// 20 new days.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  windowDates, windowProgress, nextToGrade, mergeWindowDays,
  type DayState, type WindowDay, type WindowRow, type WindowRowBase, type WindowProgress,
} from '@/lib/india-earnings-window';

interface Entry<R extends WindowRowBase> { state: DayState; day?: WindowDay<R>; error?: string }

const BATCH_MAX_DATES = 40;
const GRADE_TIMEOUT_MS = 150_000;
const GRADE_GAP_MS = 1_500;

export interface IndiaWindowState<R extends WindowRowBase> {
  dates: string[];
  states: Record<string, DayState | undefined>;
  errors: Record<string, string | undefined>;
  days: WindowDay<R>[];
  rows: WindowRow<R>[];
  progress: WindowProgress;
  retryFailed: () => void;
}

export function useIndiaEarningsWindow<R extends WindowRowBase>(opts: {
  anchor: string;
  sessions: number;
  today: string;
  enabled: boolean;
}): IndiaWindowState<R> {
  const { anchor, sessions, today, enabled } = opts;
  const dates = useMemo(
    () => (enabled ? windowDates(anchor, sessions, today) : []),
    [enabled, anchor, sessions, today],
  );
  const datesKey = dates.join(',');

  const storeRef = useRef<Map<string, Entry<R>>>(new Map());
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [nonce, setNonce] = useState(0);

  // ── 1. Batched read from the graded store ──────────────────────────────
  useEffect(() => {
    if (!enabled || dates.length === 0) return;
    const store = storeRef.current;
    // Today is still filling up during the day, so it is re-read each time the
    // window is (re)opened; every other date is read once per page life.
    const need = dates.filter((d) => {
      const e = store.get(d);
      if (!e) return true;
      if (d === today && (e.state === 'ready' || e.state === 'stale')) return true;
      return false;
    });
    if (need.length === 0) return;
    for (const d of need) if (!store.get(d) || store.get(d)!.state !== 'ready') store.set(d, { state: 'loading' });
    bump();
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      let pending = need.slice();
      let guard = 0;
      while (pending.length > 0 && !cancelled && guard++ < 30) {
        const ask = pending.slice(0, BATCH_MAX_DATES);
        pending = pending.slice(BATCH_MAX_DATES);
        try {
          const res = await fetch(`/api/v1/earnings/graded-window?dates=${ask.join(',')}`, { cache: 'no-store', signal: ctrl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const j: any = await res.json();
          for (const day of (j?.days || [])) {
            if (!day?.date || !day?.payload) continue;
            store.set(day.date, {
              state: day.stale ? 'stale' : 'ready',
              day: { date: day.date, by_tier: day.payload.by_tier, engine_stale: !!day.stale, engine: day.engine || null },
            });
          }
          for (const d of (j?.missing || [])) {
            const e = store.get(d);
            if (!e || e.state === 'loading') store.set(d, { state: 'queued' });
          }
          // Too big for one response — ask again for these, first in line.
          const deferred: string[] = Array.isArray(j?.deferred) ? j.deferred : [];
          if (deferred.length) pending = [...deferred, ...pending];
          // Anything the server did not mention at all stays readable next time.
          for (const d of ask) {
            if (store.get(d)?.state === 'loading' && !deferred.includes(d)) store.delete(d);
          }
        } catch (e: any) {
          if (cancelled || e?.name === 'AbortError') break;
          for (const d of ask) {
            if (store.get(d)?.state === 'loading') store.set(d, { state: 'failed', error: `could not read the graded store (${String(e?.message || e)})` });
          }
        }
        if (!cancelled) bump();
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
      // Unfinished reads are forgotten so the next run asks for them again.
      for (const [d, e] of store) if (e.state === 'loading') store.delete(d);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, datesKey, today, nonce]);

  // ── 2. One-at-a-time grading queue, newest first ───────────────────────
  const busyRef = useRef(false);
  const unmountCtrl = useRef<AbortController | null>(null);
  useEffect(() => () => { unmountCtrl.current?.abort(); }, []);
  useEffect(() => {
    if (!enabled || busyRef.current) return;
    const store = storeRef.current;
    const states: Record<string, DayState | undefined> = {};
    for (const d of dates) states[d] = store.get(d)?.state;
    // Wait until the store has answered for the whole window, so nothing that
    // is already graded gets sent to the grader.
    if (dates.some((d) => states[d] === 'loading' || states[d] === undefined)) return;
    const d = nextToGrade(dates, states);
    if (!d) return;
    busyRef.current = true;
    store.set(d, { state: 'grading' });
    bump();
    const ctrl = new AbortController();
    unmountCtrl.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), GRADE_TIMEOUT_MS);
    (async () => {
      try {
        const res = await fetch(`/api/v1/earnings/graded?date=${d}`, { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const p: any = await res.json();
        if (!p?.by_tier) throw new Error(p?.error || 'no graded payload');
        store.set(d, { state: 'ready', day: { date: d, by_tier: p.by_tier, engine_stale: false, engine: null } });
      } catch (e: any) {
        const msg = e?.name === 'AbortError' ? `took longer than ${GRADE_TIMEOUT_MS / 1000}s` : String(e?.message || e);
        store.set(d, { state: 'failed', error: msg });
      } finally {
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, GRADE_GAP_MS));
        busyRef.current = false;
        bump();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, datesKey, version]);

  const retryFailed = useCallback(() => {
    const store = storeRef.current;
    for (const [d, e] of store) if (e.state === 'failed') store.delete(d);
    setNonce((n) => n + 1);
    bump();
  }, [bump]);

  const snapshot = useMemo(() => {
    const store = storeRef.current;
    const states: Record<string, DayState | undefined> = {};
    const errors: Record<string, string | undefined> = {};
    const days: WindowDay<R>[] = [];
    for (const d of dates) {
      const e = store.get(d);
      states[d] = e?.state ?? 'loading';
      if (e?.error) errors[d] = e.error;
      if (e?.day && (e.state === 'ready' || e.state === 'stale')) days.push(e.day);
    }
    return { states, errors, days, rows: mergeWindowDays<R>(days), progress: windowProgress(dates, states) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datesKey, version]);

  return { dates, ...snapshot, retryFailed };
}
