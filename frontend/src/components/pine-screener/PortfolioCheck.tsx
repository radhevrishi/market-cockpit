'use client';
// zzz999 — "My portfolio check": EVERY holding (with or without a chart pattern) — all daily / weekly / monthly patterns, the
// Weinstein stage, the close against its 21 / 50 / 200-day averages (scan close vs averages of the same bars), RSI and one plain
// verdict word worked out from those numbers only.
import React, { useMemo, useState } from 'react';
import type { PortfolioCheckRow } from '@/lib/screener/pine-view';
import type { ScreenMarket } from '@/lib/screener/types';
import { fmtPrice } from '@/lib/screener/filters';
import { C, PatternChip, Th } from './pine-ui';

const STAGE_NAME: Record<number, string> = { 1: 'Basing', 2: 'Advancing', 3: 'Topping', 4: 'Declining' };
const TONE_COL = { up: C.green, down: C.red, mixed: C.amber, none: C.dim } as const;

export function PortfolioCheck({ items, market, status, error, source, chartHref, openReview }: {
  items: PortfolioCheckRow[]; market: ScreenMarket; status: 'loading' | 'ok' | 'error'; error: string | null; source: string;
  /** a plain chart link (for a new tab) */
  chartHref: (ticker: string, tf: string) => string;
  /** writes the chart's Next / Previous queue (these holdings, in this order) and returns the chart link */
  openReview: (tickers: string[], ticker: string, tf: string) => string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'verdict', dir: 1 });
  const [showAll, setShowAll] = useState(false);   // zzz1002 — weaker / far-off patterns too
  const hiddenTotal = useMemo(() => items.reduce((n, x) => n + (x.hidden || 0), 0), [items]);
  const stageOf = (r: PortfolioCheckRow['row']) => (r ? (r.twSt ?? r.stage ?? null) : null);
  const sorted = useMemo(() => {
    if (sort.key === 'verdict') return sort.dir === 1 ? items : items.slice().reverse();
    const val = (x: PortfolioCheckRow): number | string | null => {
      switch (sort.key) {
        case 't': return x.ticker;
        case 'ma21': return x.ma.d21; case 'ma50': return x.ma.d50; case 'ma200': return x.ma.d200;
        case 'rsi': return x.row?.rsi ?? null;
        case 'stage': return stageOf(x.row);
        case 'pat': return x.best?.c ?? null;
        default: return null;
      }
    };
    return items.slice().sort((a, b) => {
      const p = val(a), q = val(b);
      if (typeof p === 'string' || typeof q === 'string') return String(p ?? '').localeCompare(String(q ?? '')) * sort.dir;
      if (p == null && q == null) return a.ticker.localeCompare(b.ticker);
      if (p == null) return 1;
      if (q == null) return -1;
      return (p - q) * sort.dir;
    });
  }, [items, sort]);
  const tally = useMemo(() => {
    const t = { up: 0, down: 0, mixed: 0, none: 0 };
    for (const x of items) t[x.verdict.tone]++;
    return t;
  }, [items]);

  if (status === 'loading') return <div role="status" aria-busy="true" className="pnx-note" style={{ padding: 16 }}>Reading your holdings…</div>;
  if (!items.length) {
    return (
      <div role="status" style={{ padding: 16, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13.5, display: 'grid', gap: 6 }}>
        <b>No {market === 'IN' ? 'Indian' : 'US'} holdings found.</b>
        <span className="pnx-note">{error ? `${error}. ` : ''}The check reads {market === 'IN' ? 'the holdings saved on the Portfolio page' : 'your US portfolio book'}. Add holdings there, or switch market.</span>
        <span><a className="pnx-link" href={market === 'IN' ? '/portfolio' : '/us-portfolio-book'}>Open {market === 'IN' ? 'the Portfolio page' : 'the US portfolio book'}</a></span>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 13 }}>
        <b style={{ fontSize: 15 }} data-testid="portfolio-count">{items.length} holdings</b>
        <span style={{ color: C.green }}>{tally.up} strong</span>
        <span style={{ color: C.amber }}>{tally.mixed} pulling back</span>
        <span style={{ color: C.red }}>{tally.down} weak</span>
        {tally.none ? <span style={{ color: C.dim }}>{tally.none} without data</span> : null}
        <span className="pnx-note">Holdings from {source}{error ? ` (${error})` : ''}. Every holding is listed, with or without a pattern.</span>
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer', fontSize: 12.5 }} title="Shown by default: shape score 55 or more and, while still forming, within 15% of the pivot / breakdown level. Breakouts, breakdowns and recent failures always show.">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show weaker / far-off patterns too{hiddenTotal ? ` (${hiddenTotal})` : ''}
        </label>
      </div>
      <div className="pnx-wrap">
        <table className="pnx-table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th className="pnx-pin"><Th bare label="Company" k="t" sort={sort} setSort={setSort} /></th>
              <Th label="Verdict" k="verdict" sort={sort} setSort={setSort} title="Worked out from the numbers on this row only — not advice" />
              <Th label="Chart patterns (D / W / M)" k="pat" sort={sort} setSort={setSort} num={false} title="Every pattern on daily, weekly and monthly bars: green bullish, red bearish, grey failed" />
              <Th label="Stage" k="stage" sort={sort} setSort={setSort} num title="Stage (TheWrap method — 13-week range and 10/30/40-week averages): 1 basing, 2 advancing, 3 topping, 4 declining" />
              <Th label="21d" k="ma21" sort={sort} setSort={setSort} num title="% the close is above (+) or below (−) its 21-day simple moving average (same daily bars)" />
              <Th label="50d" k="ma50" sort={sort} setSort={setSort} num title="% the close is above (+) or below (−) its 50-day simple moving average" />
              <Th label="200d" k="ma200" sort={sort} setSort={setSort} num title="% the close is above (+) or below (−) its 200-day simple moving average" />
              <Th label="RSI" k="rsi" sort={sort} setSort={setSort} num title="RSI 14, daily" />
              <th className="pnx-num">Close</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((x) => {
              const r = x.row;
              return (
                <tr key={x.ticker} className="pnx-row" data-holding={x.ticker}>
                  <td className="pnx-pin">
                    {r ? <a href={chartHref(x.ticker, x.best?.tf || 'D')} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); window.location.assign(openReview(sorted.filter((y) => y.row).map((y) => y.ticker), x.ticker, x.best?.tf || 'D')); }} style={{ color: C.accent, fontWeight: 700, textDecoration: 'none' }} data-ticker={x.ticker}>{x.ticker}</a> : <b>{x.ticker}</b>}
                    <div style={{ fontSize: 11.5, color: C.dim, maxWidth: 190, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r?.n || 'not in the screener data'}</div>
                  </td>
                  <td title={x.verdict.why}><b style={{ color: TONE_COL[x.verdict.tone], whiteSpace: 'nowrap' }}>{x.verdict.word}</b></td>
                  <td>
                    <div style={{ display: 'grid', gap: 3 }}>
                      {(showAll ? x.patterns : x.active).filter((p) => p.tags && p.tags.length).map((p) => (
                        <div key={p.tf} className="pnx-chips">{p.tags!.map((t) => <PatternChip key={`${p.tf}-${t.id}`} t={{ ...t, tf: t.tf || p.tf }} market={market} showStage main={t === x.best} />)}</div>
                      ))}
                      {!(showAll ? x.patterns : x.active).some((p) => p.tags && p.tags.length) ? (
                        <span style={{ color: C.dim, fontSize: 12 }}>{!r ? '—' : x.patterns.every((p) => p.tags == null) ? 'not scanned yet' : x.hidden ? `no strong setup near its pivot (${x.hidden} weaker / far-off hidden)` : 'no pattern on D / W / M'}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="pnx-num" title={stageOf(r) ? `Stage ${stageOf(r)} (TheWrap method: weekly 10/30/40-week averages and the 13-week range)${r?.twWk != null ? ` · ${r.twWk} weeks in this stage` : ''}${r?.sata != null ? ` · SATA ${r.sata}/10` : ''}` : 'Not known (under a year of weekly history)'}>{stageOf(r) ? <span>{STAGE_NAME[stageOf(r) as number] || stageOf(r)} <span style={{ color: C.dim }}>{stageOf(r)}</span></span> : '—'}</td>
                  {[x.ma.d21, x.ma.d50, x.ma.d200].map((d, i) => <td key={i} className="pnx-num" style={{ color: d == null ? C.dim : d >= 0 ? C.green : C.red }} title={x.ma.close == null ? 'No close stored' : `${x.ma.basis === 'scan' ? 'Scan close' : 'Latest quote (no scan close stored)'}${x.ma.at ? ` of ${x.ma.at}` : ''}`}>{d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}%`}</td>)}
                  <td className="pnx-num">{typeof r?.rsi === 'number' ? Math.round(r.rsi) : '—'}</td>
                  <td className="pnx-num" title={x.ma.at ? `${x.ma.basis === 'scan' ? 'Scan close' : 'Latest quote'} of ${x.ma.at}` : ''}>{fmtPrice(x.ma.close, market)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pnx-note">Verdict words come from the close, the three averages and live breakouts / breakdowns only — a starting point for a chart review, not advice.</div>
    </div>
  );
}
