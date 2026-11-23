'use client';
// zzz1297 — Company Lab "rejected" list. A company is REJECTED when it carries a red-flag combination (automatic) or the
// owner rejected it by hand; "keep" overrides an automatic reject (the owner has checked the flag away). Stored in this
// browser and synced by the vault (mc:company-lab:marks:v1); the filter choice is mc:company-lab:view:v1.
import { useCallback, useEffect, useState } from 'react';

export type LabMark = 'rejected' | 'kept';
export type LabView = 'all' | 'strong' | 'hide-rejected' | 'rejected' | 'red';
const KEY = 'mc:company-lab:marks:v1';
const VIEW_KEY = 'mc:company-lab:view:v1';
const EVT = 'mc:company-lab:marks';

const read = (): Record<string, { m: LabMark; at: string }> => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };

export function useLabMarks() {
  const [marks, setMarks] = useState<Record<string, { m: LabMark; at: string }>>({});
  const [view, setView0] = useState<LabView>('all');
  useEffect(() => {
    const f = () => setMarks(read());
    f();
    try { const v = localStorage.getItem(VIEW_KEY) as LabView | null; if (v && ['all', 'strong', 'hide-rejected', 'rejected', 'red'].includes(v)) setView0(v); } catch { /* default */ }
    window.addEventListener('storage', f); window.addEventListener(EVT, f);
    return () => { window.removeEventListener('storage', f); window.removeEventListener(EVT, f); };
  }, []);
  const mark = useCallback((key: string, m: LabMark | null) => {
    const cur = read();
    if (m) cur[key] = { m, at: new Date().toISOString().slice(0, 10) }; else delete cur[key];
    try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* not kept */ }
    setMarks(cur); window.dispatchEvent(new Event(EVT));
  }, []);
  const setView = useCallback((v: LabView) => { setView0(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* not kept */ } }, []);
  return { marks, mark, view, setView };
}

/** Is this company rejected: by hand, or automatically by a red flag the owner has not kept. */
export function rejectState(key: string, redCount: number, marks: Record<string, { m: LabMark }>): { rejected: boolean; why: 'manual' | 'red-flag' | null; kept: boolean } {
  const m = marks[key]?.m;
  if (m === 'rejected') return { rejected: true, why: 'manual', kept: false };
  if (m === 'kept') return { rejected: false, why: null, kept: true };
  return redCount > 0 ? { rejected: true, why: 'red-flag', kept: false } : { rejected: false, why: null, kept: false };
}
