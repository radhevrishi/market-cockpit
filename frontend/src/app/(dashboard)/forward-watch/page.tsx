'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';
import { CHAT_ID } from '@/lib/config';

// ─────────────────────────────────────────────────────────────────────────
// FORWARD WATCH — institutional dashboard aggregating watch points across
// the user's watchlist. For every ticker we fetch the india-screener
// snapshot, extract the latest QoQ/YoY trajectory, and surface the
// forward-most-relevant signal (sector KPIs, working-capital strain,
// promoter actions). Goal: one-screen morning brief — what to watch
// across the whole portfolio THIS quarter.
// ─────────────────────────────────────────────────────────────────────────

interface WatchRow {
  ticker: string;
  loading: boolean;
  error?: string;
  company?: string;
  sector?: string;
  latestPeriod?: string;
  revenueYoY?: number | null;
  opmYoY?: number | null;
  patYoY?: number | null;
  promoterChange?: number | null;
  watchKpis?: string[];
  flag?: string | null;
}

export default function ForwardWatchPage() {
  const { palette } = useTheme();
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, WatchRow>>({});

  // Load watchlist from KV
  useEffect(() => {
    fetch(`/api/watchlist?chatId=${CHAT_ID}`)
      .then((r) => r.json())
      .then((j) => {
        const list: string[] = j?.symbols || j?.watchlist || [];
        setWatchlist(list);
      })
      .catch(() => setWatchlist([]));
  }, []);

  // Fetch each ticker in parallel (rate-limited to 4 at a time)
  useEffect(() => {
    if (watchlist.length === 0) return;
    let cancelled = false;
    (async () => {
      const queue = [...watchlist];
      const init: Record<string, WatchRow> = {};
      queue.forEach((t) => { init[t] = { ticker: t, loading: true }; });
      setRows(init);

      const concurrency = 4;
      const workers = Array.from({ length: concurrency }, async () => {
        while (queue.length > 0) {
          const t = queue.shift();
          if (!t || cancelled) return;
          try {
            const norm = t.includes('.') ? t : `${t}.NS`;
            const res = await fetch(`/api/earnings/india-screener?ticker=${encodeURIComponent(norm)}`);
            const json = await res.json().catch(() => null);
            if (!json?.ok) {
              setRows((p) => ({ ...p, [t]: { ticker: t, loading: false, error: json?.error || 'no data' } }));
              continue;
            }
            const latest = json.latest || {};
            const yoy = json.yoyPriorQuarter || {};
            const revYoY = yoy?.revenue && latest?.revenue ? ((latest.revenue - yoy.revenue) / yoy.revenue) * 100 : null;
            const patYoY = yoy?.netIncome && latest?.netIncome ? ((latest.netIncome - yoy.netIncome) / Math.abs(yoy.netIncome)) * 100 : null;
            const opmYoY = yoy?.ebitdaMargin != null && latest?.ebitdaMargin != null ? (latest.ebitdaMargin - yoy.ebitdaMargin) * 100 : null;
            // Pull pre-built sector KPIs from the snapshot API if exposed; else fall back to top-3 generic
            const watchKpis = (json.sector?.kpis || [])
              .filter((k: any) => k.importance === 'critical')
              .slice(0, 3)
              .map((k: any) => k.label);
            // Single-line risk flag — first acctQ-style flag we can compute locally
            let flag: string | null = null;
            if (revYoY !== null && revYoY < 0) flag = `Revenue contracting ${revYoY.toFixed(1)}% YoY`;
            else if (patYoY !== null && patYoY < -10) flag = `PAT down ${Math.abs(patYoY).toFixed(0)}% YoY`;
            else if (opmYoY !== null && opmYoY < -200) flag = `OPM compressed ${Math.abs(Math.round(opmYoY))} bps YoY`;

            setRows((p) => ({
              ...p,
              [t]: {
                ticker: t,
                loading: false,
                company: json.company || norm,
                sector: json.sector?.displayName || json.sector || '',
                latestPeriod: latest?.period || '',
                revenueYoY: revYoY,
                opmYoY,
                patYoY,
                promoterChange: null,
                watchKpis,
                flag,
              },
            }));
          } catch (err: any) {
            setRows((p) => ({ ...p, [t]: { ticker: t, loading: false, error: err?.message || 'fetch failed' } }));
          }
        }
      });
      await Promise.all(workers);
    })();
    return () => { cancelled = true; };
  }, [watchlist.join(',')]);

  const sortedRows = watchlist.map((t) => rows[t] || { ticker: t, loading: true });

  return (
    <div style={{ background: palette.BG, minHeight: '100vh', padding: '24px 20px', maxWidth: 1280, margin: '0 auto', color: palette.TEXT, fontFamily: palette.FONT }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: palette.TEXT, margin: 0, letterSpacing: '-0.5px' }}>Forward Watch</h1>
        <div style={{ fontSize: 12, color: palette.MUTED, marginTop: 4 }}>
          One-screen morning brief — what to watch across your watchlist this quarter. Sector KPIs · YoY trajectory · risk flags.
        </div>
      </div>

      {watchlist.length === 0 && (
        <div style={{ background: palette.PANEL, border: `1px solid ${palette.BORDER}`, borderRadius: 8, padding: 20, color: palette.MUTED, fontSize: 13 }}>
          Your watchlist is empty. Add tickers via <Link href="/watchlists" style={{ color: palette.ACCENT }}>Watchlist</Link> first.
        </div>
      )}

      {watchlist.length > 0 && (
        <div style={{ background: palette.PANEL, border: `1px solid ${palette.BORDER}`, borderRadius: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${palette.BORDER2}`, background: palette.PANEL2, color: palette.MUTED }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700 }}>Ticker</th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Sector</th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Period</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Rev YoY%</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>OPM YoY</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>PAT YoY%</th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Watch KPIs</th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Risk Flag</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const revColor = r.revenueYoY == null ? palette.MUTED : r.revenueYoY >= 0 ? palette.GREEN : palette.RED;
                const opmColor = r.opmYoY == null ? palette.MUTED : r.opmYoY >= 0 ? palette.GREEN : palette.RED;
                const patColor = r.patYoY == null ? palette.MUTED : r.patYoY >= 0 ? palette.GREEN : palette.RED;
                return (
                  <tr key={r.ticker} style={{ borderBottom: `1px solid ${palette.BORDER}` }}>
                    <td style={{ padding: '10px 12px' }}>
                      <Link href={`/earnings-analysis?ticker=${encodeURIComponent(r.ticker)}`} style={{ color: palette.ACCENT, fontWeight: 700, fontFamily: palette.MONO }}>
                        {r.ticker}
                      </Link>
                      {r.company && <div style={{ fontSize: 10, color: palette.MUTED }}>{r.company}</div>}
                    </td>
                    <td style={{ padding: '10px 12px', color: palette.MUTED }}>{r.sector || '—'}</td>
                    <td style={{ padding: '10px 12px', fontFamily: palette.MONO, color: palette.TEXT }}>{r.latestPeriod || (r.loading ? '…' : '—')}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: revColor, fontFamily: palette.MONO, fontWeight: 600 }}>
                      {r.revenueYoY != null ? `${r.revenueYoY >= 0 ? '+' : ''}${r.revenueYoY.toFixed(1)}%` : (r.loading ? '…' : '—')}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: opmColor, fontFamily: palette.MONO, fontWeight: 600 }}>
                      {r.opmYoY != null ? `${r.opmYoY >= 0 ? '+' : ''}${Math.round(r.opmYoY)} bps` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: patColor, fontFamily: palette.MONO, fontWeight: 600 }}>
                      {r.patYoY != null ? `${r.patYoY >= 0 ? '+' : ''}${r.patYoY.toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: palette.TEXT }}>
                      {r.watchKpis && r.watchKpis.length > 0 ? r.watchKpis.join(' · ') : <span style={{ color: palette.FAINT }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: r.flag ? palette.ORANGE : palette.MUTED }}>
                      {r.flag || (r.error ? <span style={{ color: palette.RED }}>{r.error}</span> : '—')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
