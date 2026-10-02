'use client';
// zzz844 — MARKET COVERAGE: what was actually scanned, per market. Incomplete scans are said plainly and never read as "no upgrades".
import React from 'react';
import type { CoverageCard, GuQueueReport, GuScanStatus, GuWindow, GuidanceUpgradesResponse } from '@/lib/guidance-upgrades-types';
import { COVERAGE_120_INCOMPLETE, MARKET_NAME, SCAN_STATE_LABEL, coverage120, fmtDaysCovered, fmtScanFunnel, coverageCounts, freshnessText, marketIncompleteNote, sourceFailedText, unresolvedLine, scanHeadline, scanIncompleteWords } from '@/lib/guidance-upgrades-format';
import { R, box, tint } from './gu-tokens';
import { Chip, FreshnessBlock } from './GuBits';
import { useGuUniverse } from './useGuUniverse';
import { QUERY_TEXT, TIER_WORD, STATUS_WORD, coverageFailureLine, dataText, documentsLine, fallbackMessage, sourceDisplayName, violationTexts, INVARIANT_BANNER } from './gu-ui';

const STATE_COLOR: Record<string, string> = { COMPLETE: R.green, PARTIAL: R.amber, FAILED: R.red, NOT_RUN: R.grey, NOT_AVAILABLE: R.grey };

function lastScan(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'DATA UNAVAILABLE';
}

function Cov120({ s }: { s: GuScanStatus }) {
  const c = coverage120(s);
  const q = useGuUniverse({ market: 'ALL', view: 'active' }).data?.extractCoverage?.quality?.markets?.[s.market];   // zzz860: the collectors' own numbers
  return (
    <div role="group" aria-label={`${MARKET_NAME[s.market]} 120D coverage`} style={{ borderTop: `1px solid ${R.border}`, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12, letterSpacing: 0.3 }}>120D COVERAGE</b>
        <Chip color={STATE_COLOR[c.state]} dashed={c.state === 'NOT_AVAILABLE'}>{SCAN_STATE_LABEL[c.state]}</Chip>
      </div>
      <div style={{ fontSize: 12, color: R.dim }}><b>{c.days}</b> days · Sources {c.sources} · Unprocessed {c.unprocessed} · Missing {c.missing}</div>
      {q && (
        <div data-gu-cov120-numbers style={{ fontSize: 12, color: R.dim }}>
          <b>{q.tradingDays}</b> trading days in the window · fully covered <b>{q.daysFullyCovered}</b> · partly <b>{q.daysPartial}</b> · failed <b>{q.daysFailed}</b> · not read <b>{q.daysNotRead}</b> · documents found <b>{q.documentsDiscovered}</b>, read <b>{q.documentsProcessed}</b>, pending <b>{q.documentsPending}</b>
        </div>
      )}
      {((q && q.status !== 'COMPLETE') || c.incomplete) && <div role="note" style={{ fontSize: 12, fontWeight: 800, color: R.amber }}>PARTIAL COVERAGE. {COVERAGE_120_INCOMPLETE}</div>}
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
function LegacyCoverage({ scan, now, byMarket, eventCounts, window, unresolved }: { unresolved?: number; window?: GuWindow; scan: Partial<Record<'IN' | 'US', GuScanStatus>> | undefined; now: Date; byMarket?: GuidanceUpgradesResponse['freshness']['byMarket']; eventCounts?: Partial<Record<'IN' | 'US', number>> }) {
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

/** 'Next try of the blocked exchange feed after 22:40 UTC'. Null when no retry time was sent. */
function retryText(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? `Next try of the blocked exchange feed after ${new Date(t).toISOString().slice(11, 16)} UTC.` : null;
}

const OVERALL_COLOR: Record<string, string> = { COMPLETE: R.green, PARTIAL: R.amber, FAILED: R.red };
const SRC_COLOR: Record<string, string> = { COMPLETE: R.green, PARTIAL: R.amber, FAILED: R.red, EMPTY: R.grey };

/** One standard card per market. Query status (did the question get answered) is shown apart from data status (what the answer held). */
export function CoverageCardView({ c }: { c: CoverageCard }) {
  const fb = fallbackMessage(c);
  const docs = documentsLine(c);
  const bad = c.overall !== 'COMPLETE';
  return (
    <div role="group" aria-label={`${MARKET_NAME[c.market]} coverage`} style={box({ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, border: `1px ${bad ? 'dashed' : 'solid'} ${bad ? R.amber : R.border}`, background: bad ? tint(R.amber, 6) : undefined })}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{MARKET_NAME[c.market]}</b>
        <Chip color={OVERALL_COLOR[c.overall] || R.grey}>{c.overall}</Chip>
        <span style={{ fontSize: 12, color: R.dim }}>{c.requestedWindow} window · {c.calendarDays} calendar days · {c.tradingDays} trading days</span>
      </div>
      <div style={{ fontSize: 12.5 }}>{c.headline}</div>
      <div style={{ fontSize: 12, color: R.dim, lineHeight: 1.6 }}>
        <b>Read from primary feeds</b> {c.coveredLabel}
        {c.partialLabel ? <> · <b>Partly covered</b> {c.partialLabel}</> : null}
        {c.daysFailed > 0 ? <> · <b>Nobody answered</b> {c.daysFailed} day{c.daysFailed === 1 ? '' : 's'}</> : null}
        {c.daysNotAttempted > 0 ? <> · <b>Not asked this run</b> {c.daysNotAttempted} day{c.daysNotAttempted === 1 ? '' : 's'}{c.daysFromEarlierRuns > 0 ? ` (${c.daysFromEarlierRuns} done in earlier runs)` : ''}</> : null}
      </div>
      {bad && c.overallReason && <div role="note" style={{ fontSize: 12, color: R.amber, fontWeight: 700 }}>{c.overallReason}. Zero events here does not mean no upgrades.</div>}
      {retryText((c as { retryAfter?: string | null }).retryAfter) && <div role="note" style={{ fontSize: 12, color: R.amber, fontWeight: 700 }}>{retryText((c as { retryAfter?: string | null }).retryAfter)}</div>}
      {fb && <div role="note" style={{ fontSize: 12, fontWeight: 800, color: R.amber }}>{fb}</div>}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {(c.sources || []).map((x, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1.2fr) auto', gap: 8, padding: '4px 0', borderTop: `1px solid ${R.border}`, fontSize: 11.5, alignItems: 'baseline' }}>
            <div>
              <span style={{ fontWeight: 700 }}>{sourceDisplayName(x.name)}</span> <span style={{ color: R.dim }}>· {TIER_WORD[x.tier] || x.tier}</span>
              <div style={{ color: R.dim }}><b>Query:</b> {QUERY_TEXT[x.queryStatus] || x.queryStatus} · <b>Data:</b> {dataText(x)}{x.daysAttempted ? ` · ${x.daysSucceeded} of ${x.daysAttempted} days answered` : ''}</div>
              {coverageFailureLine(x as Parameters<typeof coverageFailureLine>[0]) && <div data-gu-failure style={{ color: R.red, fontWeight: 800 }}>{coverageFailureLine(x as Parameters<typeof coverageFailureLine>[0])}</div>}
              {x.reason && <div style={{ color: x.status === 'FAILED' ? R.red : R.dim, overflowWrap: 'anywhere' }}>{x.reason}</div>}
            </div>
            <Chip color={SRC_COLOR[x.status] || R.grey} dashed={x.status === 'EMPTY'}>{STATUS_WORD[x.status] || x.status}</Chip>
          </div>
        ))}
      </div>
      {(c.cache || []).length > 0 && (
        <div style={{ fontSize: 11.5, color: R.dim, borderTop: `1px solid ${R.border}`, paddingTop: 4 }}>
          {(c.cache || []).map((k, i) => <div key={i}><b>{sourceDisplayName(k.name)}:</b> {k.text}</div>)}
        </div>
      )}
      <div style={{ fontSize: 12, borderTop: `1px solid ${R.border}`, paddingTop: 4, display: 'grid', gap: 1 }}>
        <div style={{ color: R.dim }}><b>Funnel</b> {c.candidatesDiscovered} discovered · {c.processed} processed · {c.verified} verified</div>
        {docs.map((d, i) => <div key={i} style={{ color: i === 1 && c.documentsAwaitingGrading > 0 ? R.amber : R.dim }}>{d}</div>)}
      </div>
    </div>
  );
}

export function GuCoverage({ scan, now, byMarket, eventCounts, window, unresolved, coverage, queue, invariantViolations }: {
  unresolved?: number; window?: GuWindow; scan: Partial<Record<'IN' | 'US', GuScanStatus>> | undefined; now: Date; byMarket?: GuidanceUpgradesResponse['freshness']['byMarket'];
  eventCounts?: Partial<Record<'IN' | 'US', number>>; coverage?: GuidanceUpgradesResponse['coverage']; queue?: GuQueueReport; invariantViolations?: string[];
}) {
  const uni = useGuUniverse({ market: 'ALL', view: 'active' });
  const cards = Array.isArray(coverage?.cards) ? coverage!.cards : [];
  const viol = violationTexts(invariantViolations);
  const fresh = (
    <FreshnessBlock builtAt={uni.data?.builtAt} servedFrom={uni.data?.servedFrom} now={now}
      scanRuns={(['IN', 'US'] as const).map((k) => scan?.[k]?.lastScanAt)} newestItems={(['IN', 'US'] as const).map((k) => scan?.[k]?.newestItemAt)} generatedAt={coverage?.generatedAt} />
  );
  if (!cards.length) {
    return (<div style={{ display: 'grid', gap: 8 }}>{fresh}<LegacyCoverage unresolved={unresolved} scan={scan} now={now} byMarket={byMarket} eventCounts={eventCounts} window={window} /></div>);
  }
  return (
    <section aria-label="Market coverage" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>COVERAGE</div>
      {fresh}
      {viol.length > 0 && (
        <div role="alert" style={{ border: `1px solid ${R.red}`, background: tint(R.red, 8), borderRadius: 6, padding: '6px 10px', fontSize: 12.5 }}>
          <b style={{ color: R.red }}>{INVARIANT_BANNER}</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{viol.slice(0, 5).map((v, i) => <li key={i}>{v}</li>)}</ul>
        </div>
      )}
      {unresolved != null && unresolved > 0 && <div role="note" style={{ fontSize: 12, color: R.dim }}>{unresolvedLine(unresolved)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 10 }}>
        {cards.map((c) => <CoverageCardView key={c.market} c={c} />)}
      </div>
      {queue && <div style={{ fontSize: 12, color: R.dim }}><b>Document queue</b> {queue.note || 'No documents are waiting to be read.'} {queue.done} read so far · {queue.sourceUnavailable} source unavailable (not counted as waiting). Documents of companies that already have guidance are read first.</div>}
      {coverage?.windowNote && <div style={{ fontSize: 11, color: R.faint }}>{coverage.windowNote}</div>}
    </section>
  );
}
