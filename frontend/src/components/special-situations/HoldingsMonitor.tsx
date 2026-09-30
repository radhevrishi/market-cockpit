'use client';
// zzz841 — "Your holdings - catalyst monitor". For each holding with radar
// items or ledger entries: the ten monitor answers (never "did the stock go
// up"), an owner tag, a derived catalyst tag, and a shared-driver block.

import React from 'react';
import { PORTFOLIO_TAG_LABEL, THESIS_STATUS_LABEL, type LedgerEntry, type MonitorAnswers, type ThesisMonitor, type RadarItem, type SharedDriverGroup } from '@/lib/multibagger-radar-types';
import { OWNER_TAGS, derivedTag, type OwnerTag } from '@/lib/multibagger-ledger-store';
import { monitorThesisOf, portfolioMonitorOf } from '@/lib/multibagger-radar';
import { normSymbol } from '@/lib/portfolio-symbols';
import { MONITOR_LABEL, R, TAG_COLOR, THESIS_COLOR, box } from './radar-tokens';
import { Chip, Field, input } from './RadarBits';

export function sharedDriversForHoldings(groups: ReadonlyArray<SharedDriverGroup>, holdings: ReadonlyArray<string>): SharedDriverGroup[] {
  const held = new Set(holdings.map(normSymbol));
  const out: SharedDriverGroup[] = [];
  for (const g of groups) {
    const t = Array.from(new Set(g.tickers.filter((x) => held.has(normSymbol(x)))));
    if (t.length >= 2) out.push({ ...g, tickers: t });
  }
  return out;
}

export function HoldingsMonitor({ holdings, holdingsLoaded, items, entries, tags, onTag, sharedDrivers }: {
  holdings: string[]; holdingsLoaded: boolean; items: RadarItem[]; entries: LedgerEntry[];
  tags: Record<string, OwnerTag>; onTag: (ticker: string, tag: OwnerTag | null) => void; sharedDrivers: SharedDriverGroup[];
}) {
  const heading = <div style={{ fontSize: 13, fontWeight: 800 }}>Your holdings - catalyst monitor</div>;
  if (holdings.length === 0) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {heading}
        <div style={{ fontSize: 12, color: R.faint }}>{holdingsLoaded ? 'No holdings supplied. Add them on the Portfolio page and this section fills in.' : 'Loading your holdings...'}</div>
      </section>
    );
  }
  const rows = holdings.map((h) => {
    const k = normSymbol(h);
    return {
      h, k,
      items: items.filter((i) => i.ticker && normSymbol(i.ticker) === k),
      entries: entries.filter((e) => normSymbol(e.ticker) === k),
    };
  });
  const active = rows.filter((r) => r.items.length || r.entries.length);
  const idle = rows.length - active.length;
  const groups = sharedDriversForHoldings(sharedDrivers, holdings);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {heading}
      <div style={{ fontSize: 12, color: R.dim }}>
        {active.length} of {rows.length} holdings have a catalyst in the feed or a ledger entry.{idle > 0 ? ` ${idle} have nothing right now. That is not a negative sign.` : ''}
      </div>
      <div style={box({ padding: 10 })}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>Shared drivers / hidden concentration</div>
        {groups.length === 0
          ? <div style={{ fontSize: 12, color: R.faint }}>No two of your holdings share a driver in the current radar.</div>
          : groups.map((g) => (
            <div key={g.driver} style={{ fontSize: 12, color: R.text, marginBottom: 2 }}>
              These {g.tickers.length} positions share a {g.driver} driver: {g.tickers.join(', ')}.{g.note ? ` ${g.note}` : ''}
            </div>
          ))}
      </div>
      {active.map((r) => {
        const derived = derivedTag(r.entries, r.items);
        const owner = tags[r.k];
        const subjects: Array<{ key: string; label: string; a: MonitorAnswers; t?: ThesisMonitor }> = [
          ...r.entries.map((e) => ({ key: `e:${e.id}`, label: `Ledger: ${e.catalyst}`, a: portfolioMonitorOf(e, r.items.find((i) => i.id === e.fromRadarId) || null), t: monitorThesisOf(e, r.items.find((i) => i.id === e.fromRadarId) || null) })),
          ...r.items.filter((i) => !r.entries.some((e) => e.fromRadarId === i.id)).map((i) => ({ key: `i:${i.id}`, label: `Feed: ${i.event}`, a: portfolioMonitorOf(i, null) })),
        ];
        return (
          <div key={r.k} style={box({ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 })}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <b style={{ fontSize: 14 }}>{r.h}</b>
              {owner && <Chip color={TAG_COLOR[owner]}>{PORTFOLIO_TAG_LABEL[owner]}</Chip>}
              {derived && <Chip color={TAG_COLOR[derived]}>{PORTFOLIO_TAG_LABEL[derived]}</Chip>}
              <select aria-label={`Tag for ${r.h}`} value={owner || ''} onChange={(e) => onTag(r.k, (e.target.value || null) as OwnerTag | null)} style={{ ...input, width: 'auto', marginLeft: 'auto' }}>
                <option value="">No tag</option>
                {OWNER_TAGS.map((t) => <option key={t} value={t}>{PORTFOLIO_TAG_LABEL[t]}</option>)}
              </select>
            </div>
            {subjects.map((s) => (
              <details key={s.key} open={subjects.length === 1}>
                <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: R.cyan }}>{s.label}</summary>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 6, paddingTop: 6 }}>
                  {MONITOR_LABEL.map(([k, l]) => <Field key={k} label={l}>{(s.a as unknown as Record<string, string>)[k] || 'Not established'}</Field>)}
                  {s.t && <>
                    <Field label="Thesis status (from evidence, never price)"><Chip color={THESIS_COLOR[s.t.status]}>{THESIS_STATUS_LABEL[s.t.status].toUpperCase()}</Chip> {s.t.statusReason}</Field>
                    <Field label="Original thesis">{s.t.originalThesis}</Field>
                    <Field label="Leading indicators">{s.t.leadingIndicators}</Field>
                    <Field label="Capacity">{s.t.capacity}</Field>
                    <Field label="Margin">{s.t.margin}</Field>
                    <Field label="Free cash flow">{s.t.fcf}</Field>
                    <Field label="What would break it">{s.t.failureConditions}</Field>
                  </>}
                </div>
              </details>
            ))}
          </div>
        );
      })}
    </section>
  );
}
