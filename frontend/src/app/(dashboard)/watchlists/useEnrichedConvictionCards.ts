'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect, useCallback, useRef } from 'react';
import { type EarningsScanCard } from '@/components/EarningsScanCard';
import { readRichCache, getCachedCard, writeRichCache } from './helpers';

/** Hook — owns enriched-card state for the bench. */
export function useEnrichedConvictionCards(tickers: string[]) {
  const [cards, setCards] = useState<Record<string, EarningsScanCard>>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  // PATCH 0541 — unmount guard for the refetch path (the useEffect path
  // already has its own cancelled flag; refetch was missing it).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (tickers.length === 0) return;
    let cancelled = false;
    const cache = readRichCache();

    // Hydrate from cache first
    const fromCache: Record<string, EarningsScanCard> = {};
    const missing: string[] = [];
    for (const t of tickers) {
      const hit = getCachedCard(t, cache);
      if (hit) fromCache[t.toUpperCase()] = hit;
      else missing.push(t.toUpperCase());
    }
    setCards(fromCache);

    if (missing.length === 0) {
      setProgress({ done: tickers.length, total: tickers.length });
      return;
    }

    setLoading(true);
    setProgress({ done: tickers.length - missing.length, total: tickers.length });
    setError(null);

    (async () => {
      try {
        const BATCH = 30;
        const PARALLEL = 3;
        const batches: string[][] = [];
        for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
        const updated: Record<string, EarningsScanCard> = { ...fromCache };
        const cacheUpdate = readRichCache();

        for (let w = 0; w < batches.length; w += PARALLEL) {
          if (cancelled) return;
          const wave = batches.slice(w, w + PARALLEL);
          const results = await Promise.allSettled(
            wave.map(async (batch) => {
              const ctl = new AbortController();
              const timer = setTimeout(() => ctl.abort(), 25_000);
              try {
                const encoded = batch.map(s => encodeURIComponent(s)).join(',');
                const res = await fetch(`/api/market/earnings-scan?symbols=${encoded}`, { signal: ctl.signal });
                clearTimeout(timer);
                if (!res.ok) return null;
                return (await res.json()) as { cards: EarningsScanCard[] };
              } catch {
                clearTimeout(timer);
                return null;
              }
            })
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              for (const c of (r.value.cards || [])) {
                const key = c.symbol.toUpperCase();
                updated[key] = { ...c, universeTag: 'conviction', isConviction: true };
                cacheUpdate.cards[key] = { card: updated[key], ts: Date.now() };
              }
            }
          }
          if (cancelled) return;
          setCards({ ...updated });
          setProgress({ done: Object.keys(updated).length, total: tickers.length });
        }
        writeRichCache(cacheUpdate);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to fetch enriched cards');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join('|')]);

  const refetch = useCallback(() => {
    // Force-bust cache for these tickers, then re-trigger by toggling state
    const cache = readRichCache();
    for (const t of tickers) delete cache.cards[t.toUpperCase()];
    writeRichCache(cache);
    setCards({});
    // re-trigger effect via dummy state change (will re-read tickers)
    setProgress({ done: 0, total: tickers.length });
    // The effect depends on tickers.join('|'); we have to nudge it via a
    // ref-like state. Simplest: just re-run the same load logic inline.
    (async () => {
      if (!mountedRef.current) return;
      setLoading(true);
      try {
        const BATCH = 30;
        const PARALLEL = 3;
        const all = tickers.map(t => t.toUpperCase());
        const batches: string[][] = [];
        for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
        const updated: Record<string, EarningsScanCard> = {};
        const cacheUpdate = readRichCache();
        for (let w = 0; w < batches.length; w += PARALLEL) {
          if (!mountedRef.current) return;
          const wave = batches.slice(w, w + PARALLEL);
          const results = await Promise.allSettled(
            wave.map(async (batch) => {
              const encoded = batch.map(s => encodeURIComponent(s)).join(',');
              // PATCH 0716 — added 25s timeout + safe JSON parse.
              try {
                const _esCtl = new AbortController();
                const _esTimer = setTimeout(() => _esCtl.abort(), 25_000);
                try {
                  const res = await fetch(`/api/market/earnings-scan?symbols=${encoded}`, { signal: _esCtl.signal });
                  if (!res.ok) return null;
                  try { return (await res.json()) as { cards: EarningsScanCard[] }; } catch { return null; }
                } finally { clearTimeout(_esTimer); }
              } catch { return null; }
            })
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              for (const c of (r.value.cards || [])) {
                const key = c.symbol.toUpperCase();
                updated[key] = { ...c, universeTag: 'conviction', isConviction: true };
                cacheUpdate.cards[key] = { card: updated[key], ts: Date.now() };
              }
            }
          }
          if (!mountedRef.current) return;
          setCards({ ...updated });
          setProgress({ done: Object.keys(updated).length, total: tickers.length });
        }
        writeRichCache(cacheUpdate);
      } catch (e: any) {
        console.warn('[Conviction enrichment refetch]', e?.message || e);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();
  }, [tickers]);

  return { cards, loading, progress, error, refetch };
}
