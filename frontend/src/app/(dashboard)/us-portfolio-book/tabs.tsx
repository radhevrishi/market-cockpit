// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — the tabs (Holdings, Analytics, Sectors, Cash &
// currency, Data check). Same tab idea as the India book, in US dollars.
//                                                                    (zzz793)
// Every number comes from lib/us-book/analytics (tested). Unknown stays "—"
// with the reason next to it. No buy / sell advice anywhere.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useMemo, useState } from 'react';
import type { UsBookView, UsBookRow, UsBookAnalytics, UsCashRow, SectorStat, BucketStat } from '@/lib/us-book/analytics';
import { ageInWords, fmtUsdShort, STALE_PRICE_DAYS, BROKER_BASE_CURRENCY, MOVERS_TOP_N, nonUsTag } from '@/lib/us-book/analytics';
import { SortableTable, type Col } from './sortable-table';
import { C, money, signedMoney, pct, wt, tone, fmtEt, card, cardTitle, Tile, Bar } from './ui';

const tdSum: React.CSSProperties = { padding: '6px 7px', textAlign: 'right', fontWeight: 900, color: C.text, fontVariantNumeric: 'tabular-nums' };
const tdLbl: React.CSSProperties = { padding: '6px 7px', fontWeight: 900, color: C.text };
const sumOf = (rs: UsBookRow[], f: (r: UsBookRow) => number | null) => Math.round(rs.reduce((s, r) => s + (f(r) ?? 0), 0) * 100) / 100;

function statusChip(r: UsBookRow) {
  if (r.priceStatus === 'live') return null;
  const label = r.priceStatus === 'stale' ? 'old price' : r.priceStatus === 'currency-mismatch' ? 'wrong currency' : 'no price';
  return <span title={r.priceReason || ''} style={{ fontSize: 10.5, fontWeight: 800, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 999, padding: '0 6px', marginLeft: 4 }}>{label}</span>;
}

// ── HOLDINGS ───────────────────────────────────────────────────────────────

export function HoldingsTab({ view, onEdit, onRemove }: { view: UsBookView; onEdit: (r: UsBookRow) => void; onRemove: (r: UsBookRow) => void }) {
  const [listing, setListing] = useState<'all' | 'US' | 'NON_US'>('all');
  const [q, setQ] = useState('');
  const shown = useMemo(() => view.rows.filter((r) => (listing === 'all' || r.listing === listing)
    && (!q.trim() || `${r.ticker} ${r.name || ''} ${r.sector}`.toLowerCase().includes(q.trim().toLowerCase()))), [view.rows, listing, q]);
  const filtered = listing !== 'all' || !!q.trim();
  const cols: Col<UsBookRow>[] = [
    { key: 'ticker', label: 'Ticker', sort: (r) => r.ticker, render: (r) => (
      <div title={r.rawTicker !== r.ticker ? `imported as "${r.rawTicker}" · priced on Yahoo as ${r.quoteSymbol}` : `priced on Yahoo as ${r.quoteSymbol}`}>
        <div style={{ fontWeight: 900 }}>{r.ticker}</div>
        <div style={{ fontSize: 11, color: C.faint, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || '—'}</div>
      </div>) },
    { key: 'sector', label: 'Sector', sort: (r) => (/^Unknown/.test(r.sector) ? null : r.sector), render: (r) => <span style={{ color: /^Unknown/.test(r.sector) ? C.faint : C.dim, fontSize: 12 }} title={r.sicDescription ? `SEC industry: ${r.sicDescription}` : undefined}>{r.sector}</span> },
    { key: 'listing', label: 'Listing', sort: (r) => `${r.listing} ${r.exchange}`, render: (r) => (
      <span title={r.listingNote} style={{ fontSize: 12, fontWeight: 800, color: r.listing === 'US' ? C.green : C.amber }}>{r.listing === 'US' ? 'US' : 'NON-US'} · {r.exchange || '—'}</span>) },
    { key: 'qty', label: 'Qty', align: 'right', sort: (r) => r.quantity, render: (r) => r.quantity.toLocaleString('en-US') },
    { key: 'avg', label: 'Avg cost', align: 'right', sort: (r) => (r.avgPrice == null || r.fxToUsd == null ? null : r.avgPrice * r.fxToUsd), title: 'Your average cost per share, in the currency you bought in', render: (r) => money(r.avgPrice, r.currency) },
    { key: 'price', label: 'Price', align: 'right', sort: (r) => (r.price == null || r.fxToUsd == null ? null : r.price * r.fxToUsd), title: 'Latest price in the listing currency (Yahoo Finance)', render: (r) => (
      <span title={r.priceReason || `Yahoo ${r.quoteSymbol}`}>{r.price == null ? <span style={{ color: C.faint }}>—</span> : money(r.price, r.currency)}{statusChip(r)}</span>) },
    { key: 'ptime', label: 'Price as of', sort: (r) => (r.priceTime ? Date.parse(r.priceTime) : null), render: (r) => <span style={{ fontSize: 11.5, color: r.priceStatus === 'stale' ? C.amber : C.faint, whiteSpace: 'nowrap' }}>{fmtEt(r.priceTime)}</span> },
    { key: 'dayp', label: 'Day %', align: 'right', sort: (r) => r.dayChangePct, title: 'Change since the previous close — blank when the source gave no previous close', render: (r) => <span style={{ color: tone(r.dayChangePct) }}>{pct(r.dayChangePct)}</span> },
    { key: 'dayu', label: 'Day $', align: 'right', sort: (r) => r.dayChangeUsd, render: (r) => <span style={{ color: tone(r.dayChangeUsd) }}>{signedMoney(r.dayChangeUsd, 'USD', 0)}</span> },
    { key: 'mv', label: 'Value $', align: 'right', sort: (r) => r.mvUsd, title: 'Market value in US dollars', render: (r) => <b title={r.mvUsd == null ? r.priceReason || '' : r.currency !== 'USD' ? `${money(r.marketValue, r.currency)} at ${r.currency}/USD ${r.fxToUsd?.toFixed(4)}` : undefined}>{money(r.mvUsd, 'USD')}</b> },
    { key: 'cost', label: 'Cost $', align: 'right', sort: (r) => r.costUsd, title: 'What you paid (quantity × average cost), in US dollars', render: (r) => money(r.costUsd, 'USD') },
    { key: 'pnl', label: 'P&L $', align: 'right', sort: (r) => r.pnlUsd, title: 'Unrealized profit or loss against your average cost', render: (r) => <span style={{ color: tone(r.pnlUsd) }}>{signedMoney(r.pnlUsd, 'USD')}</span> },
    { key: 'pnlp', label: 'P&L %', align: 'right', sort: (r) => r.pnlPct, render: (r) => <span style={{ color: tone(r.pnlPct) }} title={r.pnlPct == null ? r.priceReason || '' : undefined}>{pct(r.pnlPct)}</span> },
    { key: 'w', label: 'Weight', align: 'right', sort: (r) => r.weightPct, title: 'Share of the whole book (valued shares + cash)', render: (r) => wt(r.weightPct) },
    { key: 'act', label: '', render: (r) => (
      <span style={{ whiteSpace: 'nowrap' }}>
        <button onClick={() => onEdit(r)} style={{ all: 'unset', cursor: 'pointer', color: C.cyan, fontSize: 12, fontWeight: 800, marginRight: 8 }}>edit</button>
        <button onClick={() => onRemove(r)} style={{ all: 'unset', cursor: 'pointer', color: C.red, fontSize: 12, fontWeight: 800 }}>remove</button>
      </span>) },
  ];
  const t = view.totals;
  const mv = sumOf(shown, (r) => r.mvUsd), cost = sumOf(shown, (r) => r.costUsd), pnl = sumOf(shown, (r) => r.pnlUsd), day = sumOf(shown, (r) => r.dayChangeUsd);
  const costWithPnl = sumOf(shown, (r) => (r.pnlUsd != null ? r.costUsd : null));
  const w = shown.reduce((s, r) => s + (r.weightPct ?? 0), 0);
  const blank = (n: number) => Array.from({ length: n }, (_, i) => <td key={`b${i}`} />);
  const footer = (
    <>
      <tr style={{ borderTop: `2px solid ${C.border}` }}>
        <td style={tdLbl} colSpan={8}>{filtered ? `Total of the ${shown.length} shown` : `Shares — ${shown.length} holdings`}{shown.some((r) => r.mvUsd == null) ? <span style={{ fontSize: 11, color: C.amber, fontWeight: 700 }}> · {shown.filter((r) => r.mvUsd == null).length} not valued (left out)</span> : null}</td>
        <td style={{ ...tdSum, color: tone(day) }}>{signedMoney(day, 'USD', 0)}</td>
        <td style={tdSum} data-testid="us-total-mv">{money(mv, 'USD')}</td>
        <td style={tdSum}>{money(cost, 'USD')}</td>
        <td style={{ ...tdSum, color: tone(pnl) }}>{signedMoney(pnl, 'USD')}</td>
        <td style={{ ...tdSum, color: tone(pnl) }} title={`on the cost of the valued rows, ${money(costWithPnl, 'USD')}`}>{pct(costWithPnl ? (pnl / Math.abs(costWithPnl)) * 100 : null)}</td>
        <td style={tdSum}>{wt(w)}</td>
        <td />
      </tr>
      {!filtered && view.cash.map((c) => (
        <tr key={c.currency}>
          <td style={{ ...tdLbl, fontWeight: 700 }} colSpan={9}>Cash · {c.currency}{c.currency !== 'USD' ? ` (${money(c.amount, c.currency)})` : ''}{c.usd == null ? <span style={{ color: C.amber }}> — FX unavailable, left out</span> : ''}</td>
          <td style={{ ...tdSum, fontWeight: 700 }}>{money(c.usd, 'USD')}</td>
          {blank(3)}
          <td style={{ ...tdSum, fontWeight: 700 }}>{wt(c.weightPct)}</td>
          <td />
        </tr>
      ))}
      {!filtered && (
        <tr style={{ borderTop: `1px solid ${C.border}` }}>
          <td style={tdLbl} colSpan={9}>Whole book (shares + cash)</td>
          <td style={tdSum} data-testid="us-total-book">{money(t.totalUsd, 'USD')}</td>
          {blank(3)}
          <td style={tdSum} data-testid="us-weight-sum">{wt(t.weightsHoldingsPct + t.weightsCashPct)}</td>
          <td />
        </tr>
      )}
    </>
  );
  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        {([['all', `All ${view.rows.length}`], ['US', `US-listed ${view.rows.filter((r) => r.listing === 'US').length}`], ['NON_US', `Non-US ${view.rows.filter((r) => r.listing !== 'US').length}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setListing(k)} style={{ fontSize: 12.5, fontWeight: 800, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${listing === k ? C.cyan : C.border}`, background: 'transparent', color: listing === k ? C.cyan : C.dim }}>{l}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find ticker, name or sector" style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, width: 220 }} />
        <span style={{ fontSize: 12, color: C.faint }}>All $ amounts are US dollars. Avg cost and price are in the listing currency (€ for Frankfurt lines).</span>
      </div>
      {!view.rows.length ? <div style={{ fontSize: 13.5, color: C.dim }}>No holdings yet — use the Manage tab to import or add one.</div> : (
        <SortableTable testId="us-holdings" rows={shown} cols={cols} rowKey={(r) => r.key} defaultSort={{ key: 'mv', dir: 'desc' }} footer={footer} />
      )}
    </div>
  );
}

// ── ANALYTICS ──────────────────────────────────────────────────────────────

export function AnalyticsTab({ view, a }: { view: UsBookView; a: UsBookAnalytics }) {
  const t = view.totals;
  const priced = view.rows.filter((r) => r.pnlUsd != null);
  const perfCols: Col<UsBookRow>[] = [
    { key: 'ticker', label: 'Ticker', sort: (r) => r.ticker, render: (r) => <b>{r.ticker}</b> },
    { key: 'sector', label: 'Sector', sort: (r) => (/^Unknown/.test(r.sector) ? null : r.sector), render: (r) => <span style={{ fontSize: 12, color: C.dim }}>{r.sector}</span> },
    { key: 'pnlp', label: 'P&L %', align: 'right', sort: (r) => r.pnlPct, render: (r) => <span style={{ color: tone(r.pnlPct) }}>{pct(r.pnlPct, 1)}</span> },
    { key: 'pnl', label: 'P&L $', align: 'right', sort: (r) => r.pnlUsd, render: (r) => <span style={{ color: tone(r.pnlUsd) }}>{signedMoney(r.pnlUsd, 'USD', 0)}</span> },
    { key: 'share', label: 'Share of total P&L', align: 'right', sort: (r) => (t.pnlUsd ? ((r.pnlUsd as number) / Math.abs(t.pnlUsd)) * 100 : null), title: 'This holding’s P&L as a share of the whole book’s P&L', render: (r) => pct(t.pnlUsd ? ((r.pnlUsd as number) / Math.abs(t.pnlUsd)) * 100 : null, 1) },
    { key: 'day', label: 'Day %', align: 'right', sort: (r) => r.dayChangePct, render: (r) => <span style={{ color: tone(r.dayChangePct) }}>{pct(r.dayChangePct)}</span> },
    { key: 'w', label: 'Weight', align: 'right', sort: (r) => r.weightPct, render: (r) => wt(r.weightPct) },
  ];
  const sizeCols: Col<BucketStat>[] = [
    { key: 'label', label: 'Position size', sort: (b) => b.label, render: (b) => b.label },
    { key: 'count', label: 'Holdings', align: 'right', sort: (b) => b.count, render: (b) => b.count },
    { key: 'value', label: 'Value $', align: 'right', sort: (b) => b.valueUsd, render: (b) => fmtUsdShort(b.valueUsd) },
    { key: 'w', label: 'Weight', align: 'right', sort: (b) => b.weightPct, render: (b) => wt(b.weightPct) },
  ];
  const Mini = ({ title, rows, field }: { title: string; rows: UsBookRow[]; field: 'pnlUsd' | 'dayChangePct' }) => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 900, color: C.faint, marginBottom: 4 }}>{title}</div>
      {rows.length ? rows.map((r) => {
        const tag = nonUsTag(r);
        // A non-US line's $ figure is its own-currency move × the live FX rate (analytics.ts); no rate → "—".
        const usd = field === 'pnlUsd' ? r.pnlUsd : r.dayChangeUsd;
        const fxNote = tag ? (r.fxToUsd != null ? `${r.currency} line — $ converted at ${r.currency}/USD ${r.fxToUsd.toFixed(4)}` : (r.fxReason || `no live ${r.currency}/USD rate`)) : undefined;
        return (
          <div key={r.key} title={fxNote} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12.5, padding: '1px 0' }}>
            <span style={{ color: C.dim, fontWeight: 700, minWidth: 0 }}>{r.ticker}{tag ? <span style={{ fontSize: 10.5, fontWeight: 800, color: C.amber }}> ({tag})</span> : null}</span>
            <span style={{ color: tone(r[field]), fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {field === 'pnlUsd' ? signedMoney(r.pnlUsd, 'USD', 0) : <>{pct(r.dayChangePct)}<span style={{ fontSize: 10.5, fontWeight: 700, color: C.faint }}> {usd == null ? '$—' : signedMoney(usd, 'USD', 0)}</span></>}
            </span>
          </div>);
      }) : <div style={{ fontSize: 12, color: C.faint }}>none</div>}
    </div>
  );
  const capStyle: React.CSSProperties = { fontSize: 11, color: C.faint, marginTop: 6, lineHeight: 1.45, whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', overflowWrap: 'break-word' };
  const hasNonUs = [...a.dayUp, ...a.dayDown, ...a.contributors, ...a.drags].some((r) => nonUsTag(r));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Tile label="WHOLE BOOK" value={fmtUsdShort(t.totalUsd)} sub={`shares ${fmtUsdShort(t.holdingsUsd)} + cash ${fmtUsdShort(t.cashUsd)}`} />
        <Tile label="UNREALIZED P&L" value={signedMoney(t.pnlUsd, 'USD', 0)} color={tone(t.pnlUsd)} sub={`${pct(t.pnlPct)} on cost ${fmtUsdShort(t.costValuedUsd)}`} />
        <Tile label="DAY CHANGE" value={t.dayCovered ? signedMoney(t.dayChangeUsd, 'USD', 0) : '—'} color={tone(t.dayCovered ? t.dayChangeUsd : null)} sub={t.dayCovered ? `${pct(t.dayChangePct)} · ${t.dayCovered} of ${t.count} had a previous close` : 'no previous close available'} />
        <Tile label="IN PROFIT / IN LOSS" value={`${a.winners} / ${a.losers}`} sub={`${priced.length} with a price and a cost${a.flat ? ` · ${a.flat} flat` : ''}`} />
        <Tile label="TOP-5 SHARE" value={wt(a.top5Pct, 0)} color={(a.top5Pct ?? 0) > 60 ? C.amber : undefined} sub={a.largest ? `largest ${a.largest.ticker} ${wt(a.largest.weightPct)}` : undefined} />
        <Tile label="SPREAD" value={a.effectivePositions == null ? '—' : a.effectivePositions.toFixed(1)} sub="like holding this many equal-size positions" />
        <Tile label="CASH" value={wt(a.cashPct)} sub={`of the whole book · ${fmtUsdShort(t.cashUsd)}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <div style={card}>
          <div style={cardTitle}>Where the money is</div>
          {a.listingSplit.map((b) => <Bar key={b.label} label={`${b.label} · ${b.count}`} pctValue={b.weightPct} right={`${wt(b.weightPct)} · ${fmtUsdShort(b.valueUsd)}`} color={b.label === 'Cash' ? C.cyan : b.label.startsWith('Non') ? C.amber : C.green} />)}
          <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Share of the whole book. Non-US lines (Frankfurt) are valued from their euro quote.</div>
        </div>
        <div style={card}>
          <div style={cardTitle}>Currency exposure</div>
          {a.currencySplit.map((b) => <Bar key={b.label} label={b.label} pctValue={b.weightPct} right={`${wt(b.weightPct)} · ${fmtUsdShort(b.valueUsd)}`} />)}
          <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>How much of the book moves with each currency.</div>
        </div>
        <div style={card}>
          <div style={cardTitle}>Performance</div>
          {[
            ['Best (P&L %)', a.best ? `${a.best.ticker} ${pct(a.best.pnlPct, 1)}` : '—', tone(a.best?.pnlPct)],
            ['Worst (P&L %)', a.worst ? `${a.worst.ticker} ${pct(a.worst.pnlPct, 1)}` : '—', tone(a.worst?.pnlPct)],
            ['Whole-book return on cost', pct(t.pnlPct), tone(t.pnlPct)],
            ['Cost → value (valued rows)', `${fmtUsdShort(t.costValuedUsd)} → ${fmtUsdShort(t.costValuedUsd + t.pnlUsd)}`, C.text],
            ['Gains in winners', signedMoney(a.winnerUsd, 'USD', 0), C.green],
            ['Losses in losers', a.loserUsd ? `−${money(a.loserUsd, 'USD', 0)}` : '$0', a.loserUsd ? C.red : C.faint],
          ].map(([k, v, col]) => (
            <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}><span style={{ color: C.faint }}>{k}</span><b style={{ color: col as string }}>{v}</b></div>
          ))}
          <div style={{ height: 8, display: 'flex', borderRadius: 4, overflow: 'hidden', marginTop: 4, border: `1px solid ${C.border}` }}>
            <div style={{ width: `${priced.length ? (a.winners / priced.length) * 100 : 0}%`, background: C.green }} />
            <div style={{ flex: 1, background: priced.length ? C.red : 'transparent' }} />
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{priced.length ? `${Math.round((a.winners / priced.length) * 100)}% of priced holdings are above their average cost` : 'no priced holdings'}</div>
        </div>
        <div style={card}>
          <div style={cardTitle}>Who moved the P&amp;L</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Mini title="▲ BIGGEST GAINS ($)" rows={a.contributors} field="pnlUsd" />
            <Mini title="▼ BIGGEST LOSSES ($)" rows={a.drags} field="pnlUsd" />
          </div>
          <div style={capStyle}>Up to {MOVERS_TOP_N} each way, ranked by profit or loss in US dollars against your average cost.{hasNonUs ? ' Lines marked (FWB, EUR) trade in Frankfurt in euros; their dollar figures use the live EUR/USD rate.' : ''}</div>
        </div>
        <div style={card}>
          <div style={cardTitle}>Today’s movers</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Mini title="▲ UP MOST" rows={a.dayUp} field="dayChangePct" />
            <Mini title="▼ DOWN MOST" rows={a.dayDown} field="dayChangePct" />
          </div>
          <div style={capStyle} data-testid="us-movers-caption">Up to {MOVERS_TOP_N} each way. Change since the previous close; only holdings with a previous close are ranked. The small figure is the day’s change in US dollars.{hasNonUs ? ' Lines marked (FWB, EUR) trade in Frankfurt in euros and are converted at the live EUR/USD rate.' : ''}</div>
        </div>
        <div style={card}>
          <div style={cardTitle}>Concentration — worth knowing</div>
          {a.notes.length ? a.notes.map((n) => <div key={n} style={{ fontSize: 12.5, color: C.dim, marginBottom: 5 }}>• {n}</div>) : <div style={{ fontSize: 12.5, color: C.faint }}>No single holding is 10% or more of the book, and no known sector is 30% or more of your shares.</div>}
        </div>
      </div>

      <div style={card}>
        <div style={cardTitle}>Position sizes</div>
        <SortableTable testId="us-size-buckets" rows={a.sizeBuckets} cols={sizeCols} rowKey={(b) => b.label} compact />
      </div>
      <div style={card}>
        <div style={cardTitle}>Winners and losers — every priced holding</div>
        <SortableTable testId="us-performance" rows={priced} cols={perfCols} rowKey={(r) => r.key} defaultSort={{ key: 'pnlp', dir: 'desc' }} compact />
      </div>
    </div>
  );
}

// ── SECTORS ────────────────────────────────────────────────────────────────

export function SectorsTab({ view, a, profileState }: { view: UsBookView; a: UsBookAnalytics; profileState: string | null }) {
  const cols: Col<SectorStat>[] = [
    { key: 'sector', label: 'Sector', sort: (s) => s.sector, render: (s) => <b style={{ color: /^Unknown/.test(s.sector) ? C.faint : C.text }}>{s.sector}</b> },
    { key: 'count', label: 'Holdings', align: 'right', sort: (s) => s.count, render: (s) => `${s.count}${s.valued < s.count ? ` (${s.count - s.valued} not valued)` : ''}` },
    { key: 'value', label: 'Value $', align: 'right', sort: (s) => s.valueUsd, render: (s) => money(s.valueUsd, 'USD', 0) },
    { key: 'w', label: 'Of whole book', align: 'right', sort: (s) => s.weightPct, render: (s) => wt(s.weightPct) },
    { key: 'h', label: 'Of your shares', align: 'right', sort: (s) => s.shareOfHoldingsPct, render: (s) => wt(s.shareOfHoldingsPct) },
    { key: 'pnl', label: 'P&L $', align: 'right', sort: (s) => (s.costUsd ? s.pnlUsd : null), render: (s) => <span style={{ color: tone(s.costUsd ? s.pnlUsd : null) }}>{s.costUsd ? signedMoney(s.pnlUsd, 'USD', 0) : '—'}</span> },
    { key: 'pnlp', label: 'P&L %', align: 'right', sort: (s) => s.pnlPct, render: (s) => <span style={{ color: tone(s.pnlPct) }}>{pct(s.pnlPct, 1)}</span> },
  ];
  const hCols: Col<UsBookRow>[] = [
    { key: 'ticker', label: 'Ticker', sort: (r) => r.ticker, render: (r) => <b>{r.ticker}</b> },
    { key: 'name', label: 'Company (SEC name)', sort: (r) => r.name, render: (r) => <span style={{ fontSize: 12 }}>{r.name || '—'}</span> },
    { key: 'sector', label: 'Sector', sort: (r) => (/^Unknown/.test(r.sector) ? null : r.sector), render: (r) => r.sector },
    { key: 'sic', label: 'SEC industry', sort: (r) => r.sicDescription, render: (r) => <span style={{ fontSize: 12, color: C.faint }}>{r.sicDescription || (r.listing !== 'US' ? 'no SEC filer' : '—')}</span> },
    { key: 'w', label: 'Weight', align: 'right', sort: (r) => r.weightPct, render: (r) => wt(r.weightPct) },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <div style={cardTitle}>Sector split</div>
        <div style={{ fontSize: 12, color: C.faint, marginBottom: 8, lineHeight: 1.5 }}>
          Each company’s sector comes from its SEC industry code (the code every US filer reports), grouped by us into eleven familiar sectors — so it is a close guide, not an official index label.
          Frankfurt lines have no SEC filer and show as Unknown. {profileState || ''}
        </div>
        {a.sectors.filter((s) => s.valueUsd > 0).map((s) => <Bar key={s.sector} label={`${s.sector} · ${s.count}`} pctValue={s.shareOfHoldingsPct} right={`${wt(s.shareOfHoldingsPct)} of shares · ${fmtUsdShort(s.valueUsd)}`} color={/^Unknown/.test(s.sector) ? C.faint : C.cyan} />)}
        <SortableTable testId="us-sectors" rows={a.sectors} cols={cols} rowKey={(s) => s.sector} defaultSort={{ key: 'value', dir: 'desc' }} compact />
      </div>
      <div style={card}>
        <div style={cardTitle}>Each holding’s sector</div>
        <SortableTable testId="us-sector-holdings" rows={view.rows} cols={hCols} rowKey={(r) => r.key} defaultSort={{ key: 'w', dir: 'desc' }} compact />
      </div>
    </div>
  );
}

// ── CASH & CURRENCY ────────────────────────────────────────────────────────

export function CashTab({ view, a }: { view: UsBookView; a: UsBookAnalytics }) {
  const cols: Col<UsCashRow>[] = [
    { key: 'ccy', label: 'Currency', sort: (c) => c.currency, render: (c) => <b>{c.currency}</b> },
    { key: 'amt', label: 'Amount', align: 'right', sort: (c) => c.usd, render: (c) => money(c.amount, c.currency) },
    { key: 'fx', label: 'Rate to USD', align: 'right', sort: (c) => c.fxToUsd, render: (c) => (c.currency === 'USD' ? '1' : c.fxToUsd == null ? <span style={{ color: C.amber }}>FX unavailable</span> : c.fxToUsd.toFixed(4)) },
    { key: 'usd', label: 'In US $', align: 'right', sort: (c) => c.usd, render: (c) => money(c.usd, 'USD') },
    { key: 'w', label: 'Of whole book', align: 'right', sort: (c) => c.weightPct, render: (c) => wt(c.weightPct) },
  ];
  const eur = view.fx.EUR;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card} data-testid="us-cash">
        <div style={cardTitle}>Cash — kept apart from your shares</div>
        {view.cash.length ? <SortableTable rows={view.cash} cols={cols} rowKey={(c) => c.currency} defaultSort={{ key: 'usd', dir: 'desc' }} compact />
          : <div style={{ fontSize: 13, color: C.dim }}>No cash on file. Add it on the Manage tab, or include a CASH row in your import.</div>}
        <div style={{ fontSize: 12, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
          Total cash {money(view.totals.cashUsd, 'USD')} = {wt(a.cashPct)} of the whole book.
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, marginTop: 8, lineHeight: 1.5, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          <b>About “BASE”.</b> Your broker account’s base currency is {BROKER_BASE_CURRENCY}. The broker also prints one grand total of all your cash in that base currency.
          {view.baseCash != null
            ? <> Your import had it: {money(view.baseCash, BROKER_BASE_CURRENCY)}. It is the same money as the lines above, just added up in euros — so it is shown here for reference and never added again.</>
            : <> Your import did not include that line. Nothing is missing — it would only repeat the cash lines above in euros.</>}
        </div>
      </div>
      <div style={card}>
        <div style={cardTitle}>Exchange rates used</div>
        {Object.keys(view.fx).length === 0 ? <div style={{ fontSize: 12.5, color: C.faint }}>No rates loaded yet — press “Refresh prices”.</div> :
          Object.entries(view.fx).map(([c, d]) => (
            <div key={c} style={{ fontSize: 12.5, color: d.rate ? C.dim : C.amber, marginBottom: 4 }}>
              {c}/USD: {d.rate ? <b style={{ color: C.text }}>{d.rate.toFixed(4)}</b> : <b>FX unavailable</b>} · {d.source}{d.symbol ? ` (${d.symbol})` : ''}{d.at ? ` · as of ${fmtEt(d.at)}` : ''}{!d.rate && d.error ? ` · ${d.error}` : ''}
            </div>
          ))}
        <div style={{ fontSize: 12.5, color: C.dim, marginTop: 6 }}>
          Whole book in euros: {view.totalEur != null ? <b style={{ color: C.text }}>{money(view.totalEur, 'EUR')}</b> : <b style={{ color: C.amber }}>FX unavailable</b>}
          {view.totalEur != null && eur?.rate ? <span style={{ color: C.faint }}> (US$ total ÷ EUR/USD {eur.rate.toFixed(4)})</span> : null}
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>
          Euro lines (shares and cash) are turned into US dollars at today’s rate — both their cost and their value — so their P&amp;L shows the share price move only, not the currency move.
        </div>
      </div>
      <div style={card}>
        <div style={cardTitle}>Currency exposure</div>
        {a.currencySplit.map((b) => <Bar key={b.label} label={b.label} pctValue={b.weightPct} right={`${wt(b.weightPct)} · ${fmtUsdShort(b.valueUsd)}`} />)}
      </div>
    </div>
  );
}

// ── DATA CHECK ─────────────────────────────────────────────────────────────

export function DataCheckTab({ view, importAt, quotesAt, quoteErr, profileState }: { view: UsBookView; importAt: string | null; quotesAt: string | null; quoteErr: string | null; profileState: string | null }) {
  const t = view.totals;
  const sumRows = sumOf(view.rows, (r) => r.mvUsd);
  const wsum = t.weightsHoldingsPct + t.weightsCashPct;
  const problems = view.rows.filter((r) => r.priceStatus !== 'live' || r.fxToUsd == null || r.avgPrice == null || r.dayChangePct == null);
  const pCols: Col<UsBookRow>[] = [
    { key: 'ticker', label: 'Ticker', sort: (r) => r.ticker, render: (r) => <b>{r.ticker}</b> },
    { key: 'sym', label: 'Priced as', sort: (r) => r.quoteSymbol, render: (r) => <code style={{ fontSize: 12 }}>{r.quoteSymbol}</code> },
    { key: 'issue', label: 'What is missing', sort: (r) => (r.priceStatus !== 'live' ? r.priceStatus : r.fxToUsd == null ? 'fx' : r.avgPrice == null ? 'cost' : 'day'), render: (r) => (
      <span style={{ fontSize: 12.5, color: C.dim }}>{r.priceStatus !== 'live' || r.fxToUsd == null || r.avgPrice == null ? r.priceReason : 'no previous close from the source — day change left blank'}</span>) },
    { key: 'time', label: 'Price as of', sort: (r) => (r.priceTime ? Date.parse(r.priceTime) : null), render: (r) => <span style={{ fontSize: 12 }}>{fmtEt(r.priceTime)}</span> },
  ];
  const mapCols: Col<UsBookRow>[] = [
    { key: 'ticker', label: 'Book ticker', sort: (r) => r.ticker, render: (r) => <b>{r.ticker}</b> },
    { key: 'raw', label: 'Imported as', sort: (r) => r.rawTicker, render: (r) => r.rawTicker },
    { key: 'sym', label: 'Yahoo symbol', sort: (r) => r.quoteSymbol, render: (r) => <code style={{ fontSize: 12 }}>{r.quoteSymbol}</code> },
    { key: 'name', label: 'SEC company', sort: (r) => r.name, render: (r) => <span style={{ fontSize: 12 }}>{r.listing !== 'US' ? 'no SEC filer (non-US listing)' : r.name || '—'}</span> },
  ];
  const ok = (b: boolean) => <b style={{ color: b ? C.green : C.red }}>{b ? '✓' : '✗'}</b>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <div style={cardTitle}>Where the numbers come from</div>
        <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.7 }}>
          <div>• <b>Quantities, average cost and cash</b>: your last import{importAt ? <> — <b style={{ color: C.text }}>{ageInWords(importAt)}</b> ({new Date(importAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })})</> : ' (no import on file — added by hand)'}. Re-import after you trade.</div>
          <div>• <b>Prices</b>: Yahoo Finance, one lookup per holding{quotesAt ? `, fetched ${ageInWords(quotesAt)}` : ''}. Each row shows the time its price is from. A price older than {STALE_PRICE_DAYS} days, in the wrong currency, or missing is shown as “—” and left out of the totals.{quoteErr ? <span style={{ color: C.red }}> Last price refresh failed: {quoteErr}</span> : null}</div>
          <div>• <b>Exchange rate</b>: Yahoo Finance (EURUSD=X). If it cannot be fetched, euro lines say “FX unavailable” — no rate is assumed.</div>
          <div>• <b>Company names and sectors</b>: SEC EDGAR (company list + industry code). {profileState || ''}</div>
        </div>
      </div>
      <div style={card}>
        <div style={cardTitle}>Do the numbers add up?</div>
        <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.8 }}>
          <div>{ok(Math.abs(sumRows - t.holdingsUsd) < 0.011)} Shares total {money(t.holdingsUsd, 'USD')} = sum of the {t.valued} valued rows ({money(sumRows, 'USD')})</div>
          <div>{ok(Math.abs(t.holdingsUsd + t.cashUsd - t.totalUsd) < 0.011)} Whole book {money(t.totalUsd, 'USD')} = shares {money(t.holdingsUsd, 'USD')} + cash {money(t.cashUsd, 'USD')}</div>
          <div>{ok(t.totalUsd <= 0 || Math.abs(wsum - 100) < 0.001)} Weights add up to {wt(wsum, 2)} (shares {wt(t.weightsHoldingsPct, 2)} + cash {wt(t.weightsCashPct, 2)})</div>
          <div>{ok(true)} {t.valued} of {t.count} holdings valued{t.unvalued ? ` — ${t.unvalued} left out of every total (listed below)` : ''}</div>
        </div>
        {view.leftOut.length > 0 && <div style={{ fontSize: 12.5, color: C.amber, marginTop: 6 }}>Left out of the totals: {view.leftOut.map((x) => `${x.what} (${x.reason})`).join(' · ')}</div>}
      </div>
      <div style={card}>
        <div style={cardTitle}>Rows with something missing — {problems.length}</div>
        {problems.length ? <SortableTable testId="us-data-problems" rows={problems} cols={pCols} rowKey={(r) => r.key} compact /> : <div style={{ fontSize: 12.5, color: C.faint }}>Every holding has a recent price, a cost, an exchange rate and a previous close.</div>}
      </div>
      <div style={card}>
        <div style={cardTitle}>Ticker check — how each line is looked up</div>
        <div style={{ fontSize: 12, color: C.faint, marginBottom: 6 }}>Share classes are written with a dash (MOG A / MOG.A → MOG-A, BRK.B → BRK-B) — the spelling both the SEC and Yahoo use. Frankfurt lines get Yahoo’s “.F” ending.</div>
        <SortableTable testId="us-ticker-map" rows={view.rows} cols={mapCols} rowKey={(r) => r.key} defaultSort={{ key: 'ticker', dir: 'asc' }} compact />
      </div>
    </div>
  );
}
