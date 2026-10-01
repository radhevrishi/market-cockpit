'use client';
// zzz844 — MARKET COVERAGE: what was actually scanned, per market. Incomplete scans are said plainly and never read as "no upgrades".
import React from 'react';
import type { GuScanStatus, GuWindow, GuidanceUpgradesResponse } from '@/lib/guidance-upgrades-types';
import { COVERAGE_120_INCOMPLETE, MARKET_NAME, SCAN_STATE_LABEL, coverage120, fmtDaysCovered, fmtScanFunnel, coverageCounts, freshnessText, marketIncompleteNote, sourceFailedText, unresolvedLine, scanHeadline, scanIncompleteWords } from '@/lib/guidance-upgrades-format';
import { R, box, tint } from './gu-tokens';
import { Chip } from './GuBits';

const STATE_COLOR: Record<string, string> = { COMPLETE: R.green, PARTIAL: R.amber, FAILED: R.red, NOT_RUN: R.grey, NOT_AVAILABLE: R.grey };

function lastScan(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'DATA UNAVAILABLE';
}

function Cov120({ s }: { s: GuScanStatus }) {
  const c = coverage120(s);
  return (
    <div role="group" aria-label={`${MARKET_NAME[s.market]} 120D coverage`} style={{ borderTop: `1px solid ${R.border}`, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12, letterSpacing: 0.3 }}>120D COVERAGE</b>
        <Chip color={STATE_COLOR[c.state]} dashed={c.state === 'NOT_AVAILABLE'}>{SCAN_STATE_LABEL[c.state]}</Chip>
      </div>
      <div style={{ fontSize: 12, color: R.dim }}><b>{c.days}</b> days · Sources {c.sources} · Unprocessed {c.unprocessed} · Missing {c.missing}</div>
      {c.incomplete && <div role="note" style={{ fontSize: 12, fontWeight: 800, color: R.amber }}>{COVERAGE_120_INCOMPLETE}</div>}
    </div>
  );
}

function Market({ s, now, m, events, window }: { s: GuScanStatus; now: Date; m?: ByMarket; events: number; window?: GuWindow }) {
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
            <Chip color={STATE_COLOR[x.state]} dashed={x.state === 'NOT_RUN' || String(x.state) === 'NOT_AVAILABLE'}>{SCAN_STATE_LABEL[x.state]}</Chip>
            <span style={{ color: R.dim }}>{x.scanned} scanned</span>
            {sourceFailedText(x) ? <span style={{ color: R.red, fontWeight: 800, overflowWrap: 'anywhere' }} role="alert">Failed: {sourceFailedText(x)}</span> : <span style={{ color: R.dim, overflowWrap: 'anywhere' }}>{x.detail}</span>}
          </div>
        ))}
      </div>
      {s.note && <div style={{ fontSize: 11, color: R.dim }}>{s.note}</div>}
      {window === '120D' && <Cov120 s={s} />}
    </div>
  );
}

type ByMarket = NonNullable<NonNullable<GuidanceUpgradesResponse['freshness']['byMarket']>['IN']>;
export function GuCoverage({ scan, now, byMarket, eventCounts, window, unresolved }: { unresolved?: number; window?: GuWindow; scan: Partial<Record<'IN' | 'US', GuScanStatus>> | undefined; now: Date; byMarket?: GuidanceUpgradesResponse['freshness']['byMarket']; eventCounts?: Partial<Record<'IN' | 'US', number>> }) {
  const list = (['IN', 'US'] as const).map((k) => scan?.[k]).filter((x): x is GuScanStatus => !!x);
  if (!list.length && !(unresolved && unresolved > 0)) return null;
  return (
    <section aria-label="Market coverage" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>COVERAGE</div>
      {unresolved != null && unresolved > 0 && <div role="note" style={{ fontSize: 12, color: R.dim }}>{unresolvedLine(unresolved)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 10 }}>
        {list.map((s) => <Market key={s.market} s={s} now={now} m={byMarket?.[s.market]} events={eventCounts?.[s.market] ?? byMarket?.[s.market]?.events ?? 0} window={window} />)}
      </div>
    </section>
  );
}
