'use client';
// zzz844 — MARKET COVERAGE: what was actually scanned, per market. Incomplete scans are said plainly and never read as "no upgrades".
import React from 'react';
import type { GuScanStatus, GuidanceUpgradesResponse } from '@/lib/guidance-upgrades-types';
import { MARKET_NAME, SCAN_STATE_LABEL, fmtDaysCovered, fmtScanFunnel, coverageCounts, freshnessText, marketIncompleteNote, scanHeadline, scanIncompleteWords } from '@/lib/guidance-upgrades-format';
import { R, box, tint } from './gu-tokens';
import { Chip } from './GuBits';

const STATE_COLOR = { COMPLETE: R.green, PARTIAL: R.amber, FAILED: R.red, NOT_RUN: R.grey } as const;

function lastScan(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'DATA UNAVAILABLE';
}

function Market({ s, now, m, events }: { s: GuScanStatus; now: Date; m?: ByMarket; events: number }) {
  const bad = !s.complete;
  const warn = marketIncompleteNote(s.market, events, s);
  const counts = coverageCounts(m, s);
  return (
    <div style={box({ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, border: `1px ${bad ? 'dashed' : 'solid'} ${bad ? R.amber : R.border}`, background: bad ? tint(R.amber, 8) : undefined })}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{MARKET_NAME[s.market]}</b>
        <span style={{ fontWeight: 900, fontSize: 12, color: bad ? R.amber : R.green }}>{bad ? <b>{scanHeadline(s)}</b> : scanHeadline(s)}</span>
      </div>
      {bad && <div style={{ fontSize: 12 }}>{scanIncompleteWords(s)}</div>}
      {warn && <div role="note" style={{ fontSize: 12, fontWeight: 800, color: R.amber }}>{warn}</div>}
      {counts.length > 0 && <div style={{ fontSize: 12, color: R.dim }}><b>Read so far</b> {counts.join(' · ')}</div>}
      {m?.note && <div style={{ fontSize: 11.5, color: R.dim }}>{m.note}</div>}
      <div style={{ fontSize: 12, color: R.dim, lineHeight: 1.6 }}>
        <b>Days covered</b> {fmtDaysCovered(s)} · <b>LAST SCAN</b> {lastScan(s.lastScanAt)} · <b>DATA FRESHNESS</b> {freshnessText(s.newestItemAt, now)}
      </div>
      <div style={{ fontSize: 12, color: R.dim }}><b>Candidates</b> {fmtScanFunnel(s)}</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {s.sources.map((x, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1.2fr) 90px 70px 2fr', gap: 8, padding: '3px 0', borderTop: `1px solid ${R.border}`, fontSize: 11.5, alignItems: 'baseline' }}>
            <span style={{ fontWeight: 700 }}>{x.name}</span>
            <Chip color={STATE_COLOR[x.state]} dashed={x.state === 'NOT_RUN'}>{SCAN_STATE_LABEL[x.state]}</Chip>
            <span style={{ color: R.dim }}>{x.scanned} scanned</span>
            <span style={{ color: R.dim, overflowWrap: 'anywhere' }}>{x.detail}</span>
          </div>
        ))}
      </div>
      {s.note && <div style={{ fontSize: 11, color: R.dim }}>{s.note}</div>}
    </div>
  );
}

type ByMarket = NonNullable<NonNullable<GuidanceUpgradesResponse['freshness']['byMarket']>['IN']>;
export function GuCoverage({ scan, now, byMarket, eventCounts }: { scan: Partial<Record<'IN' | 'US', GuScanStatus>> | undefined; now: Date; byMarket?: GuidanceUpgradesResponse['freshness']['byMarket']; eventCounts?: Partial<Record<'IN' | 'US', number>> }) {
  const list = (['IN', 'US'] as const).map((k) => scan?.[k]).filter((x): x is GuScanStatus => !!x);
  if (!list.length) return null;
  return (
    <section aria-label="Market coverage" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>MARKET COVERAGE</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 10 }}>
        {list.map((s) => <Market key={s.market} s={s} now={now} m={byMarket?.[s.market]} events={eventCounts?.[s.market] ?? byMarket?.[s.market]?.events ?? 0} />)}
      </div>
    </section>
  );
}
