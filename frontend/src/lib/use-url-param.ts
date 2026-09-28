'use client';
// zzz834: a filter/sort choice that survives a refresh and can be shared — kept in the URL query (history.replaceState,
// no navigation). The default is never written; the value is read once after mount (no SSR mismatch).
import { useCallback, useEffect, useState } from 'react';

export function useUrlParam<T extends string>(key: string, def: T, allowed?: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(def);
  useEffect(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get(key);
      if (raw && (!allowed || (allowed as readonly string[]).includes(raw))) setV(raw as T);
    } catch { /* no URL access — the default stays */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((next: T) => {
    setV(next);
    try {
      const u = new URL(window.location.href);
      if (next === def) u.searchParams.delete(key); else u.searchParams.set(key, next);
      window.history.replaceState(null, '', u.toString());
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, def]);
  return [v, set];
}
