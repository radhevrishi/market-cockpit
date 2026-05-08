'use client';

import React, { useEffect, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { CHAT_ID } from '@/lib/config';

// ─────────────────────────────────────────────────────────────────────────
// SECTOR CYCLES — cross-stock aggregation MVP
//
// Aggregates the user's watchlist by sector and computes:
//   - Average revenue YoY growth across the sector
//   - Average OPM YoY change (margin cycle)
//   - Working capital trend
//   - Order-book / capex mention frequency (when concalls available)
//
// V2 will pull commodity prices + sector indices for proper cycle
// detection. This MVP uses the data we already pull from Screener.
// ─────────────────────────────────────────────────────────────────────────

interface SectorAggregate {
  sector: string;
  count: number;
  tickers: string[];
  avgRevYoY: number | null;
  avgOpmYoYBps: number | null;
  avgPatYoY: number | null;
  marginExpanding: number;
  marginCompressing: number;
  cycle: 'expansion' | 'peak' | 'contraction' | 'trough' | 'mixed';
}

export default function SectorCyclesPage() {
  const { palette } = useTheme();
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [aggs, setAggs] = useState<Record<string, SectorAggregate>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/watchlist?chatId=${CHAT_ID}`)
      .then((r) => r.json())
      .then((j) => setWatchlist(j?.symbols || j?.watchlist || []))
      .catch(() => setWatchlist([]));
  }, []);

  useEffect(() => {
    if (watchlist.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const sectorMap: Record<string, {
        tickers: string[];
        revYoYs: number[];
        opmYoYs: number[];
        patYoYs: number[];
      }> = {};
      const concurrency = 4;
      const queue = [...watchlist];

      const workers = Array.from({ length: concurrency }, async () => {
        while (queue.length > 0) {
          const t = queue.shift();
          if (!t || cancelled) return;
          try {
            const norm = t.includes('.') ? t : `${t}.NS`;
            const res = await fetch(`/api/earnings/india-screener?ticker=${encodeURIComponent(norm)}`);
            const json = await res.json().catch(() => null);
            if (!json?.ok) continue;
            const sector: string = json.sector?.displayName || json.sector || 'Unclassified';
            const latest = json.latest || {};
            const yoy = json.yoyPriorQuarter || {};
            const revYoY = yoy?.revenue && latest?.revenue ? ((latest.revenue - yoy.revenue) / yoy.revenue) * 100 : null;
            const patYoY = yoy?.netIncome && latest?.netIncome ? ((latest.netIncome - yoy.netIncome) / Math.abs(yoy.netIncome)) * 100 : null;
            const opmYoY = yoy?.ebitdaMargin != null && latest?.ebitdaMargin != null ? (latest.ebitdaMargin - yoy.ebitdaMargin) * 100 : null;

            if (!sectorMap[sector]) sectorMap[sector] = { tickers: [], revYoYs: [], opmYoYs: [], patYoYs: [] };
            sectorMap[sector].tickers.push(t);
            if (revYoY !== null) sectorMap[sector].revYoYs.push(revYoY);
            if (opmYoY !== null) sectorMap[sector].opmYoYs.push(opmYoY);
            if (patYoY !== null) sectorMap[sector].patYoYs.push(patYoY);
          } catch {}
        }
      });
      await Promise.all(workers);

      if (cancelled) return;
      const result: Record<string, SectorAggregate> = {};
      for (const [sector, d] of Object.entries(sectorMap)) {
        const avg = (a: number[]) => a.length === 0 ? null : a.reduce((s, x) => s + x, 0) / a.length;
        const avgRev = avg(d.revYoYs);
        const avgOpm = avg(d.opmYoYs);
        const avgPat = avg(d.patYoYs);
        const expanding = d.opmYoYs.filter((v) => v > 50).length;
        const compressing = d.opmYoYs.filter((v) => v < -50).length;
        // Cycle classification
        let cycle: SectorAggregate['cycle'] = 'mixed';
        if (avgRev !== null && avgOpm !== null) {
          if (avgRev > 10 && avgOpm > 0) cycle = 'expansion';
          else if (avgRev > 5 && avgOpm < -100) cycle = 'peak';
          else if (avgRev < 0 && avgOpm < -100) cycle = 'contraction';
          else if (avgRev < 5 && avgOpm > 100) cycle = 'trough';
        }
        result[sector] = {
          sector,
          count: d.tickers.length,
          tickers: d.tickers,
          avgRevYoY: avgRev,
          avgOpmYoYBps: avgOpm,
          avgPatYoY: avgPat,
          marginExpanding: expanding,
          marginCompressing: compressing,
          cycle,
        };
      }
      setAggs(result);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [watchlist.join(',')]);

  const sorted = Object.values(aggs).sort((a, b) => (b.avgRevYoY || 0) - (a.avgRevYoY || 0));

  const cycleColor = (c: SectorAggregate['cycle']): string => {
    return c === 'expansion' ? palette.GREEN
      : c === 'peak' ? palette.ACCENT
      : c === 'contraction' ? palette.RED
      : c === 'trough' ? '#7dd3fc'
      : palette.MUTED;
  };

  return (
    <div style={{ background: palette.BG, minHeight: '100vh', padding: '24px 20px', maxWidth: 1200, margin: '0 auto', color: palette.TEXT, fontFamily: palette.FONT }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Sector Cycles</h1>
      <div style={{ fontSize: 12, color: palette.MUTED, marginTop: 4, marginBottom: 18 }}>
        Cross-stock sector aggregation from your watchlist. Cycle phase derived from revenue-growth + margin-trajectory. Add commodity / index feeds in V2 for full cycle detection.
      </div>

      {loading && <div style={{ color: palette.MUTED, fontSize: 12 }}>Aggregating {watchlist.length} tickers…</div>}
      {!loading && watchlist.length === 0 && (
        <div style={{ background: palette.PANEL, border: `1px solid ${palette.BORDER}`, borderRadius: 8, padding: 16, color: palette.MUTED, fontSize: 12 }}>
          Watchlist empty — add tickers via Watchlist tab to see sector aggregates.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        {sorted.map((s) => (
          <div key={s.sector} style={{ background: palette.PANEL, border: `1px solid ${palette.BORDER}`, borderLeft: `3px solid ${cycleColor(s.cycle)}`, borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: palette.TEXT }}>{s.sector}</div>
              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 3, color: cycleColor(s.cycle), border: `1px solid ${cycleColor(s.cycle)}40`, background: `${cycleColor(s.cycle)}15`, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {s.cycle}
              </span>
            </div>
            <div style={{ fontSize: 10, color: palette.MUTED, marginBottom: 8 }}>{s.count} ticker{s.count === 1 ? '' : 's'}: {s.tickers.join(', ')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 10 }}>
              <div>
                <div style={{ color: palette.MUTED, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Rev YoY</div>
                <div style={{ fontSize: 14, fontFamily: palette.MONO, fontWeight: 700, color: s.avgRevYoY != null && s.avgRevYoY >= 0 ? palette.GREEN : palette.RED }}>
                  {s.avgRevYoY != null ? `${s.avgRevYoY >= 0 ? '+' : ''}${s.avgRevYoY.toFixed(1)}%` : '—'}
                </div>
              </div>
              <div>
                <div style={{ color: palette.MUTED, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>OPM YoY</div>
                <div style={{ fontSize: 14, fontFamily: palette.MONO, fontWeight: 700, color: s.avgOpmYoYBps != null && s.avgOpmYoYBps >= 0 ? palette.GREEN : palette.RED }}>
                  {s.avgOpmYoYBps != null ? `${s.avgOpmYoYBps >= 0 ? '+' : ''}${Math.round(s.avgOpmYoYBps)} bps` : '—'}
                </div>
              </div>
              <div>
                <div style={{ color: palette.MUTED, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>PAT YoY</div>
                <div style={{ fontSize: 14, fontFamily: palette.MONO, fontWeight: 700, color: s.avgPatYoY != null && s.avgPatYoY >= 0 ? palette.GREEN : palette.RED }}>
                  {s.avgPatYoY != null ? `${s.avgPatYoY >= 0 ? '+' : ''}${s.avgPatYoY.toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 10, color: palette.MUTED, marginTop: 8 }}>
              {s.marginExpanding} expanding · {s.marginCompressing} compressing margins
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
