'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect, useMemo } from 'react';
import { type SavedValuation, loadSavedValuations, deleteValuation } from '@/lib/valuation-calculators';
import { armBookFlag } from '@/lib/book-flags-client';
import { BUY_UPSIDE, CARD, BORDER, DIM, TEXT } from './constants';
import { enrichSaved } from './helpers';

export function SavedValuationsPanel({ onLoad }: { onLoad?: (v: SavedValuation) => void }) {
  const [tick, setTick] = useState(0);
  // PATCH 0858 — ticker→live-price map fetched once on mount (and on save).
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener('mc:valuations-updated', h);
    return () => window.removeEventListener('mc:valuations-updated', h);
  }, []);
  const saved = loadSavedValuations();
  const enriched = useMemo(() => saved.map(enrichSaved), [saved]);

  // PATCH 0858 — fetch live prices via the canonical quotes endpoint. India
  // always; US too if any saved entry is a $-denominated valuation. Never throws.
  useEffect(() => {
    let cancelled = false;
    const needsUS = enriched.some(e => e.isUS);
    const run = async () => {
      const markets: Array<'india' | 'us'> = needsUS ? ['india', 'us'] : ['india'];
      const map: Record<string, number> = {};
      for (const m of markets) {
        try {
          const res = await fetch(`/api/market/quotes?market=${m}`, { cache: 'no-store' });
          if (!res.ok) continue;
          const j = await res.json();
          const stocks = Array.isArray(j?.stocks) ? j.stocks : [];
          for (const s of stocks) {
            const t = String(s?.ticker || '').toUpperCase().trim();
            const p = Number(s?.price);
            if (t && Number.isFinite(p) && p > 0) map[t] = p;
          }
        } catch { /* ignore this market, never throw */ }
      }
      if (!cancelled) setLivePrices(map);
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // PATCH 0858 — arm a Book Watch flag on a FRESH WATCH→BUY crossing:
  // saved upside was below the BUY bar, live upside is now at/above it.
  // armBookFlag self-dedups by kind+ticker+day, so this is safe to re-run.
  useEffect(() => {
    if (Object.keys(livePrices).length === 0) return;
    for (const e of enriched) {
      const sym = String(e.v.ticker || '').toUpperCase().trim();
      if (!sym) continue;
      const live = livePrices[sym];
      const fair = e.fairValue;
      if (!live || !fair) continue;
      const liveUpside = ((fair - live) / live) * 100;
      const savedUpside = e.savedUpside;
      if (savedUpside === undefined) continue;
      if (savedUpside < BUY_UPSIDE && liveUpside >= BUY_UPSIDE) {
        armBookFlag({
          kind: 'THESIS_DRIFT_REOPEN', ticker: sym, company: e.v.company, severity: 'warning',
          message: `${sym} valuation crossed into BUY zone — live upside +${Math.round(liveUpside)}% (fair ₹${Math.round(fair)} vs ₹${Math.round(live)})`,
          detail: 'saved valuation',
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePrices]);

  if (saved.length === 0) {
    return (
      <div style={{ background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 8, padding: '14px 16px', fontSize: 12, color: DIM, fontStyle: 'italic' }}>
        💾 No saved valuations yet. Run a calculator and click <b style={{ color: 'var(--mc-bullish)' }}>SAVE VALUATION</b> to persist it here for later review.
      </div>
    );
  }
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: TEXT }}>💾 Saved Valuations ({saved.length})</h2>
        <span style={{ fontSize: 10, color: DIM, fontFamily: 'ui-monospace, monospace' }}>persists in your browser</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {enriched.slice(0, 30).map(({ v, fairValue, priceAtSave, savedUpside, currency }) => {
          // PATCH 0858 — live upside recomputed against the live price.
          const sym = String(v.ticker || '').toUpperCase().trim();
          const live = sym ? livePrices[sym] : undefined;
          const hasLive = !!(live && fairValue);
          const liveUpside = hasLive ? ((fairValue! - live!) / live!) * 100 : undefined;
          const crossed = savedUpside !== undefined && liveUpside !== undefined
            && savedUpside < BUY_UPSIDE && liveUpside >= BUY_UPSIDE;
          const upColor = liveUpside === undefined ? DIM
            : liveUpside >= BUY_UPSIDE ? 'var(--mc-bullish)'
            : liveUpside >= 0 ? 'var(--mc-warn)' : 'var(--mc-bearish)';
          const arrow = (liveUpside !== undefined && savedUpside !== undefined)
            ? (liveUpside >= savedUpside ? '▲' : '▼') : '▲';
          const chipTitle = [
            `Saved upside: ${savedUpside !== undefined ? (savedUpside >= 0 ? '+' : '') + Math.round(savedUpside) + '%' : 'n/a'}`,
            priceAtSave ? `Price at save: ${currency}${Math.round(priceAtSave).toLocaleString('en-IN')}` : '',
            (hasLive) ? `Live price: ${currency}${Math.round(live!).toLocaleString('en-IN')}` : '',
            fairValue ? `Fair value (base): ${currency}${Math.round(fairValue).toLocaleString('en-IN')}` : '',
          ].filter(Boolean).join(' · ');
          /*
           * PATCH 0965 UX — Saved-valuation row label.
           * Root cause: when neither ticker nor company was populated at
           * save time, the visible row showed only "—" and the internal
           * UUID id was carried around as the React key + delete handle.
           * If the user opens the underlying JSON or exports a PDF the
           * UUID surfaced as the "name" — making rows indistinguishable.
           * Fix: build a stable user-facing label from
           *   ${company || ticker} · ${YYYY-MM-DD}
           * with a sensible "Untitled" fallback. The UUID `v.id` is kept
           * as React key + the delete handler argument — purely internal.
           */
          const dateStr = (v.savedAt || '').slice(0, 10);
          const primary = (v.company || v.ticker || '').trim();
          const displayLabel = primary
            ? `${primary} · ${dateStr}`
            : `Untitled valuation · ${dateStr}`;
          return (
          <div key={v.id} style={{
            background: 'var(--mc-bg-0)', border: `1px solid ${BORDER}`, borderRadius: 5,
            padding: '8px 10px',
            display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 11, color: 'var(--mc-cyan)', fontWeight: 800, fontFamily: 'ui-monospace, monospace', minWidth: 50 }}>
              {v.calcKind === 'EV_EBITDA' ? 'EV/EB' : v.calcKind}
            </span>
            <span style={{ fontSize: 12, color: TEXT, fontWeight: 700 }} title={`Saved ${v.savedAt}`}>{displayLabel}</span>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--mc-text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {v.baseSummary}
            </span>
            {v.notes && (
              <span style={{ fontSize: 10, color: DIM, fontStyle: 'italic' }} title={v.notes}>
                📝 {v.notes.slice(0, 40)}{v.notes.length > 40 ? '…' : ''}
              </span>
            )}
            {/* PATCH 0858 — live-upside chip (saved upside on hover) + WATCH→BUY crossing chip */}
            {liveUpside !== undefined && (
              <span
                title={chipTitle}
                style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 3, fontWeight: 800,
                  fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', cursor: 'help',
                  color: upColor,
                  background: `color-mix(in srgb, ${upColor} 10%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${upColor} 30%, transparent)`,
                }}
              >
                {arrow} upside now {liveUpside >= 0 ? '+' : ''}{Math.round(liveUpside)}%
                {savedUpside !== undefined ? ` (was ${savedUpside >= 0 ? '+' : ''}${Math.round(savedUpside)}%)` : ''}
              </span>
            )}
            {crossed && (
              <span
                title={`Live upside +${Math.round(liveUpside!)}% ≥ BUY bar ${BUY_UPSIDE}% (saved ${Math.round(savedUpside!)}%)`}
                style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 3, fontWeight: 800,
                  whiteSpace: 'nowrap',
                  color: 'var(--mc-bullish)',
                  background: 'color-mix(in srgb, var(--mc-bullish) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--mc-bullish) 45%, transparent)',
                }}
              >
                🎯 crossed into BUY zone
              </span>
            )}
            <span style={{ fontSize: 9, color: DIM, fontFamily: 'ui-monospace, monospace' }}>
              {v.savedAt.slice(0, 10)}
            </span>
            <button onClick={() => {
              // PATCH 0636 — fire event so the matching calculator tab loads it
              window.dispatchEvent(new CustomEvent('mc:load-valuation', { detail: v }));
              onLoad?.(v);
            }} style={{
              fontSize: 10, padding: '3px 8px',
              background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 31%, transparent)', color: 'var(--mc-cyan)',
              borderRadius: 3, cursor: 'pointer', fontWeight: 700,
            }}>EDIT</button>
            <button onClick={() => { if (confirm(`Delete saved valuation for ${v.ticker || '—'}?`)) deleteValuation(v.id); }} style={{
              fontSize: 10, padding: '3px 8px',
              background: 'color-mix(in srgb, var(--mc-bearish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bearish) 31%, transparent)', color: 'var(--mc-bearish)',
              borderRadius: 3, cursor: 'pointer', fontWeight: 700,
            }}>×</button>
          </div>
          );
        })}
      </div>
    </div>
  );
}
