'use client';
// zzz1249 — Tradebook stock analytics: top 20 gainers / losers overall (realised + unrealised + dividends), how much of the
// result came from a few names, results by holding period, what happened after you sold, positions stuck in a loss, and a
// full sortable scorecard. Plus `SortTable`, a click-to-sort table used by the holdings list too.
import { useMemo, useState } from 'react';
import type { TradebookAnalytics } from '@/lib/tradebook/server';
import type { StockScore } from '@/lib/tradebook/core';
import { C, inr, pct, tone, Card, Kpi, th, thL, td, tdL } from './tb-ui';

export interface Col<T> {
  key: string; label: string; title?: string; left?: boolean;
  sort?: (r: T) => number | string | null | undefined;
  cell: (r: T, i: number) => React.ReactNode;
}

/** A table whose headers sort it (click again to flip). Empty values always go last. */
export function SortTable<T>({ rows, cols, initial, desc: initialDesc = true, rowKey, limit }: {
  rows: T[]; cols: Col<T>[]; initial?: string; desc?: boolean; rowKey: (r: T, i: number) => string; limit?: number;
}) {
  const [key, setKey] = useState<string | null>(initial ?? null);
  const [desc, setDesc] = useState(initialDesc);
  const sorted = useMemo(() => {
    const c = cols.find((x) => x.key === key);
    if (!c?.sort) return rows;
    const val = c.sort;
    return rows.slice().sort((a, b) => {
      const va = val(a), vb = val(b);
      const na = va == null || (typeof va === 'number' && !Number.isFinite(va)), nb = vb == null || (typeof vb === 'number' && !Number.isFinite(vb));
      if (na || nb) return na === nb ? 0 : na ? 1 : -1;
      const r = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      return desc ? -r : r;
    });
  }, [rows, cols, key, desc]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{cols.map((c) => {
          const on = c.key === key;
          return (
            <th key={c.key} title={c.title ?? (c.sort ? 'Click to sort' : undefined)} onClick={c.sort ? () => { if (on) setDesc(!desc); else { setKey(c.key); setDesc(!(c.left)); } } : undefined}
              style={{ ...(c.left ? thL : th), cursor: c.sort ? 'pointer' : 'default', color: on ? C.blue : th.color, userSelect: 'none' }}>
              {c.label}{c.sort ? <span style={{ opacity: on ? 1 : 0.35, marginLeft: 3 }}>{on ? (desc ? '▼' : '▲') : '↕'}</span> : null}
            </th>
          );
        })}</tr></thead>
        <tbody>{shown.map((r, i) => <tr key={rowKey(r, i)}>{cols.map((c) => <td key={c.key} style={c.left ? tdL : td}>{c.cell(r, i)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const STATUS: Record<StockScore['status'], { label: string; color: string }> = {
  HELD: { label: 'Held', color: C.blue }, PART_SOLD: { label: 'Part sold', color: C.violet }, EXITED: { label: 'Sold out', color: C.dim },
};
const Pill = ({ s }: { s: StockScore['status'] }) => <span style={{ fontSize: 10.5, fontWeight: 800, color: STATUS[s].color, border: `1px solid ${STATUS[s].color}`, borderRadius: 5, padding: '1px 6px' }}>{STATUS[s].label}</span>;

/** A horizontal bar for one stock's result, scaled to the largest in its list. */
function Bar({ v, max }: { v: number; max: number }) {
  const w = max > 0 ? Math.min(100, (Math.abs(v) / max) * 100) : 0;
  return <div style={{ width: 90, height: 8, background: 'var(--mc-bg-2, rgba(127,127,127,.12))', borderRadius: 4, overflow: 'hidden', display: 'inline-block', verticalAlign: 'middle' }}><div style={{ width: `${w}%`, height: '100%', background: v >= 0 ? C.green : C.red }} /></div>;
}

/**
 * zzz1250 — one top list, sorted on open: gainers biggest first, losers biggest loss first. Every column sorts on click;
 * the # column always counts the rows as shown.
 */
function TopList({ title, rows, by, gain }: { title: string; rows: StockScore[]; by: 'rs' | 'pct'; gain: boolean }) {
  const max = Math.max(0, ...rows.map((r) => Math.abs(by === 'rs' ? r.total : (r.pct ?? 0))));
  return (
    <Card title={title}>
      <SortTable key={`${by}-${gain}`} rows={rows} rowKey={(r) => r.isin} initial={by === 'rs' ? 'total' : 'pct'} desc={gain} cols={[
        { key: 'n', label: '#', left: true, cell: (_r, i) => <span style={{ color: C.dim }}>{i + 1}</span> },
        { key: 'sym', label: 'Stock', left: true, sort: (r) => r.symbol, cell: (r) => <><b>{r.symbol}</b> <Pill s={r.status} />{r.includes?.length ? <span style={{ fontSize: 10.5, color: C.dim }} title="Shares received in a demerger; their cost stayed with this company"> + {r.includes.join(', ')}</span> : null}</> },
        { key: 'total', label: 'Total P&L', sort: (r) => r.total, cell: (r) => <span style={{ color: tone(r.total), fontWeight: 800 }} title={`Realised ${inr(r.realized)} · Unrealised ${inr(r.unrealized)} · Dividends ${inr(r.dividends)}`}>{inr(r.total)}</span> },
        { key: 'pct', label: 'Return', title: 'Total P&L ÷ the most money you had in this stock at one time', sort: (r) => r.pct, cell: (r) => <span style={{ color: tone(r.pct), fontWeight: 700 }} title={r.pctTurnover != null ? `${pct(r.pctTurnover)} of all money put into its buys (${inr(r.bought)}, counted again on every round trip)` : undefined}>{pct(r.pct)}</span> },
        { key: 'peak', label: 'Most in it', title: 'The most money you had in this stock at one time (cost of the shares held)', sort: (r) => r.peak, cell: (r) => <span style={{ color: C.mute }}>{inr(r.peak)}</span> },
        { key: 'bar', label: '', cell: (r) => <Bar v={by === 'rs' ? r.total : (r.pct ?? 0)} max={max} /> },
      ]} />
    </Card>
  );
}

export function StockAnalytics({ data }: { data: TradebookAnalytics }) {
  const [by, setBy] = useState<'rs' | 'pct'>('rs');
  const [status, setStatus] = useState<'all' | StockScore['status']>('all');
  const stocks = data.stocks;
  const st = useMemo(() => {
    if (!stocks?.length) return null;
    // a % ranking needs real money behind it — at least ₹10,000 bought
    // cash parked in liquid funds is not a stock pick; a % ranking needs real money behind it — at least ₹10,000 in it at once
    const picks = stocks.filter((s) => !s.cash);
    const pool = by === 'rs' ? picks : picks.filter((s) => s.peak >= 10_000 && s.pct != null);
    const key = (s: StockScore) => (by === 'rs' ? s.total : (s.pct ?? 0));
    const gainers = pool.filter((s) => key(s) > 0).sort((a, b) => key(b) - key(a)).slice(0, 20);
    const losers = pool.filter((s) => key(s) < 0).sort((a, b) => key(a) - key(b)).slice(0, 20);
    const up = picks.filter((s) => s.total > 0), down = picks.filter((s) => s.total < 0);
    const grossUp = up.reduce((s, x) => s + x.total, 0), grossDown = -down.reduce((s, x) => s + x.total, 0);
    const byTotal = up.slice().sort((a, b) => b.total - a.total);
    const top5 = byTotal.slice(0, 5).reduce((s, x) => s + x.total, 0);
    const net = grossUp - grossDown;
    // how many of the best names it took to make the whole net result
    let run = 0, needed = 0;
    for (const x of byTotal) { if (run >= net) break; run += x.total; needed++; }
    return { gainers, losers, up: up.length, down: down.length, grossUp, grossDown, net, top5, needed, total: picks.length, cash: stocks.length - picks.length };
  }, [stocks, by]);

  if (!stocks?.length || !st) return <Card title="Stock analytics"><div style={{ fontSize: 12.5, color: C.mute }}>Press ↻ Recompute once — these figures are new and are not in the last stored result.</div></Card>;

  const seg = (on: boolean) => ({ padding: '4px 12px', fontSize: 11.5, fontWeight: 800, border: 'none', cursor: 'pointer', background: on ? C.blue : 'transparent', color: on ? '#fff' : C.mute } as const);
  const stuck = data.holdings.filter((h) => (h.pnlPct ?? 0) <= -0.2 && (h.daysHeld ?? 0) >= 180).sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0));
  const after = data.afterSale ?? [];
  const early = after.filter((a) => a.amount > 0 && a.movePct >= 0.1).slice(0, 20);
  const good = after.filter((a) => a.amount < 0 && a.movePct <= -0.1).sort((a, b) => a.amount - b.amount).slice(0, 20);
  const leftOnTable = early.reduce((s, a) => s + a.amount, 0), avoided = -good.reduce((s, a) => s + a.amount, 0);
  const rows = status === 'all' ? stocks : stocks.filter((s) => s.status === status);

  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Kpi label="STOCKS TRADED" value={String(st.total)} sub={`${st.up} made money · ${st.down} lost money${st.cash ? ` · ${st.cash} cash fund left out` : ''}`} />
        <Kpi label="STOCK HIT RATE" value={st.up + st.down ? `${Math.round((st.up / (st.up + st.down)) * 100)}%` : '—'} sub="share of stocks with a positive total" />
        <Kpi label="WINNERS MADE" value={inr(st.grossUp)} color={C.green} sub={`losers cost ${inr(-st.grossDown)}`} />
        <Kpi label="TOP 5 STOCKS" value={st.grossUp > 0 ? `${Math.round((st.top5 / st.grossUp) * 100)}%` : '—'} sub="of all money made by winners" />
        <Kpi label="NAMES THAT MADE THE RESULT" value={st.net > 0 ? String(st.needed) : '—'} sub={st.net > 0 ? `the best ${st.needed} add up to the whole net ${inr(st.net)}` : 'net result is not positive'} />
      </div>

      <Card title="Top 20 gainers and losers — overall" right={
        <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setBy('rs')} style={seg(by === 'rs')}>By ₹</button>
          <button onClick={() => setBy('pct')} style={seg(by === 'pct')}>By % return</button>
        </div>}>
        <div style={{ fontSize: 11.5, color: C.mute, marginBottom: 8 }}>
          Total P&amp;L per stock = realised (sold) + unrealised (still held, at {data.priceDate} prices) + estimated dividends. Return = total ÷ the most money you had in that stock at one time (hover a return for the figure on all money put into its buys, which counts the same money again on every round trip).
          {by === 'pct' ? ' The % list leaves out stocks that never had ₹10,000 in them.' : ''} Liquid funds used to park cash are left out. Demerged shares are counted with the parent company. Before charges and tax. Click any column to sort.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 14 }}>
          <TopList title={`▲ Top ${st.gainers.length} gainers`} rows={st.gainers} by={by} gain />
          <TopList title={`▼ Top ${st.losers.length} losers`} rows={st.losers} by={by} gain={false} />
        </div>
      </Card>

      {data.holdBuckets?.length ? (
        <Card title="Results by how long you held" right={<span style={{ fontSize: 11, color: C.dim }}>closed trades only</span>}>
          <SortTable rows={data.holdBuckets} rowKey={(r) => r.label} cols={[
            { key: 'label', label: 'Held for', left: true, cell: (r) => <b>{r.label}</b> },
            { key: 'trades', label: 'Trades', sort: (r) => r.trades, cell: (r) => r.trades },
            { key: 'win', label: 'Win rate', sort: (r) => r.winRate, cell: (r) => (r.winRate != null ? `${Math.round(r.winRate * 100)}%` : '—') },
            { key: 'pnl', label: 'Realised P&L', sort: (r) => r.pnl, cell: (r) => <span style={{ color: tone(r.pnl), fontWeight: 800 }}>{inr(r.pnl)}</span> },
            { key: 'avg', label: 'Return on cost', title: 'Realised P&L ÷ cost of the shares sold', sort: (r) => r.avgPct, cell: (r) => <span style={{ color: tone(r.avgPct) }}>{pct(r.avgPct)}</span> },
          ]} />
        </Card>
      ) : null}

      {(early.length > 0 || good.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 14 }}>
          {([[`Sold, then it kept rising — ${inr(leftOnTable)} left on the table (last exit of each stock, top 20)`, early, 'up'], [`Good exits — it fell after you sold (${inr(avoided)} avoided · last exit of each stock, top 20)`, good, 'down']] as const).map(([t, list, k]) => (
            <Card key={k} title={t}>
              {list.length ? <SortTable rows={list} rowKey={(r) => r.isin} initial="amt" desc={k === 'up'} cols={[
                { key: 'sym', label: 'Stock', left: true, sort: (r) => r.symbol, cell: (r) => <b>{r.symbol}</b> },
                { key: 'last', label: 'Last sold', sort: (r) => r.lastSell, cell: (r) => r.lastSell },
                { key: 'val', label: 'Sold for', title: 'Money you got for the shares of the last exit', sort: (r) => r.qtySold * r.avgSellPx, cell: (r) => inr(r.qtySold * r.avgSellPx) },
                { key: 'sell', label: 'Avg sell', sort: (r) => r.avgSellPx, cell: (r) => r.avgSellPx.toFixed(2) },
                { key: 'now', label: 'Now', sort: (r) => r.priceNow, cell: (r) => r.priceNow.toFixed(2) },
                { key: 'mv', label: 'Since', sort: (r) => r.movePct, cell: (r) => <span style={{ color: tone(r.movePct), fontWeight: 700 }}>{pct(r.movePct)}</span> },
                { key: 'amt', label: k === 'up' ? 'Missed' : 'Avoided', title: 'The shares you sold × (today’s price − your average sell price)', sort: (r) => r.amount, cell: (r) => <span style={{ color: k === 'up' ? C.amber : C.green, fontWeight: 800 }}>{inr(Math.abs(r.amount))}</span> },
              ]} /> : <div style={{ fontSize: 12, color: C.mute }}>None.</div>}
            </Card>
          ))}
        </div>
      )}

      {stuck.length > 0 && (
        <Card title={`Stuck in a loss — held 6+ months and down 20% or more (${stuck.length})`} right={<span style={{ fontSize: 11, color: C.dim }}>{inr(stuck.reduce((s, h) => s + (h.pnl ?? 0), 0))} · {pct(data.summary.value ? stuck.reduce((s, h) => s + (h.value ?? 0), 0) / data.summary.value : null).replace('+', '')} of the book</span>}>
          <SortTable rows={stuck} rowKey={(r) => r.isin} initial="pnl" desc={false} cols={[
            { key: 'sym', label: 'Stock', left: true, sort: (r) => r.symbol, cell: (r) => <b>{r.symbol}</b> },
            { key: 'cost', label: 'Cost', sort: (r) => r.cost, cell: (r) => inr(r.cost) },
            { key: 'val', label: 'Value', sort: (r) => r.value, cell: (r) => inr(r.value) },
            { key: 'pnl', label: 'P&L', sort: (r) => r.pnl, cell: (r) => <span style={{ color: tone(r.pnl), fontWeight: 800 }}>{inr(r.pnl)}</span> },
            { key: 'pct', label: 'P&L %', sort: (r) => r.pnlPct, cell: (r) => <span style={{ color: tone(r.pnlPct) }}>{pct(r.pnlPct)}</span> },
            { key: 'days', label: 'Held', sort: (r) => r.daysHeld, cell: (r) => (r.daysHeld != null ? `${r.daysHeld}d` : '—') },
            { key: 'w', label: 'Weight', sort: (r) => r.weight, cell: (r) => (r.weight != null ? `${(r.weight * 100).toFixed(1)}%` : '—') },
          ]} />
        </Card>
      )}

      <Card title={`Every stock — scorecard (${rows.length})`} right={
        <div style={{ display: 'flex', gap: 4 }}>
          {([['all', 'All'], ['HELD', 'Held'], ['PART_SOLD', 'Part sold'], ['EXITED', 'Sold out']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} style={{ padding: '3px 10px', fontSize: 11, fontWeight: 800, borderRadius: 6, cursor: 'pointer', border: `1px solid ${status === k ? C.blue : C.line}`, background: status === k ? `${C.blue}22` : 'transparent', color: status === k ? C.blue : C.mute }}>{l}</button>
          ))}
        </div>}>
        <SortTable rows={rows} rowKey={(r) => r.isin} initial="total" cols={[
          { key: 'sym', label: 'Stock', left: true, sort: (r) => r.symbol, cell: (r) => <><b>{r.symbol}</b>{r.includes?.length ? <span style={{ fontSize: 10.5, color: C.dim }}> + {r.includes.join(', ')}</span> : null}{r.cash ? <span style={{ fontSize: 10, color: C.dim }}> · cash fund</span> : null}</> },
          { key: 'st', label: 'Status', sort: (r) => r.status, cell: (r) => <Pill s={r.status} /> },
          { key: 'buy', label: 'Bought ₹', sort: (r) => r.bought, cell: (r) => inr(r.bought) },
          { key: 'sold', label: 'Sold ₹', sort: (r) => r.sold, cell: (r) => inr(r.sold) },
          { key: 'real', label: 'Realised', sort: (r) => r.realized, cell: (r) => <span style={{ color: tone(r.realized) }}>{inr(r.realized)}</span> },
          { key: 'unr', label: 'Unrealised', sort: (r) => r.unrealized, cell: (r) => <span style={{ color: tone(r.unrealized) }}>{r.status === 'EXITED' ? '—' : inr(r.unrealized)}</span> },
          { key: 'div', label: 'Dividends', sort: (r) => r.dividends, cell: (r) => (r.dividends ? inr(r.dividends) : '—') },
          { key: 'total', label: 'Total P&L', sort: (r) => r.total, cell: (r) => <span style={{ color: tone(r.total), fontWeight: 800 }}>{inr(r.total)}</span> },
          { key: 'peak', label: 'Most in it', title: 'The most money you had in this stock at one time', sort: (r) => r.peak, cell: (r) => inr(r.peak) },
          { key: 'pct', label: 'Return', title: 'Total ÷ the most money you had in it at one time', sort: (r) => r.pct, cell: (r) => <span style={{ color: tone(r.pct) }}>{pct(r.pct)}</span> },
          { key: 'pctT', label: 'On all buys', title: 'Total ÷ all money put into its buys (counts the same money again on every round trip)', sort: (r) => r.pctTurnover, cell: (r) => <span style={{ color: C.mute }}>{pct(r.pctTurnover)}</span> },
          { key: 'wl', label: 'Won / lost', title: 'Closed trades that made / lost money', sort: (r) => r.wins - r.losses, cell: (r) => (r.wins + r.losses ? `${r.wins} / ${r.losses}` : '—') },
          { key: 'n', label: 'Trades', sort: (r) => r.trades, cell: (r) => r.trades },
          { key: 'first', label: 'First trade', sort: (r) => r.first, cell: (r) => r.first },
          { key: 'last', label: 'Last trade', sort: (r) => r.last, cell: (r) => r.last },
        ]} />
      </Card>
    </>
  );
}
