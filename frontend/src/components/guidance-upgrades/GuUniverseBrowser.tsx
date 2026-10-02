'use client';
// zzz848 — 📊 GUIDANCE UNIVERSE: scope chips (All | India | USA | My Book), metric chips and the Active / All active view.
// It never reads the event window. My Book is a client-side overlay using the holdings the page already loaded.
import React, { useMemo, useState } from 'react';
import { normSymbol } from '@/lib/portfolio-symbols';
import {
  UNIVERSE_METRICS, UNIVERSE_SCOPES, UNIVERSE_UNAVAILABLE, ZERO_RECORDS_TEXT, universeNoticeLine, filterUniverse, sortUniverse, universeApiMarket, universeApiMetric,
  type UniverseMetric, type UniverseScope,
} from '@/lib/guidance-upgrades-format';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { R, box, tint } from './gu-tokens';
import { btn } from './GuBits';
import { VIEW_HINT, VIEW_ORDER, expiryLine, excludedWhy, reasonCountsLine, sourceDisplayName, viewCountsLine, viewLabel, type GuView } from './gu-ui';
import { GuUniverseList } from './GuUniverseList';
import { useGuUniverse } from './useGuUniverse';
import { CappedList } from './GuMore';
import { GuPanel, pillStyle } from './GuPanel';

const pill = (on: boolean): React.CSSProperties => pillStyle(on, R.cyan);

export function GuUniverseBrowser({ held, onFull }: { held: string[]; onFull?: (c: GgCompany) => void }) {
  const [scope, setScope] = useState<UniverseScope>('ALL');
  const [metric, setMetric] = useState<UniverseMetric>('ALL');
  const [view, setView] = useState<GuView>('active');
  const { data, state, retry, error } = useGuUniverse({ market: universeApiMarket(scope), metric: universeApiMetric(metric), view });
  const heldSet = useMemo(() => new Set(held.map(normSymbol)), [held]);
  const list = useMemo(
    () => sortUniverse(filterUniverse(data?.records || [], scope, metric, (t) => heldSet.has(normSymbol(t)))),
    [data, scope, metric, heldSet],
  );
  return (
    <GuPanel id="gu-universe" icon="📊" title="Guidance universe" accent={R.cyan} count={data ? list.length : null}
      hint="Every guidance still in force, whenever it was announced. The time window in the next section only filters events; it does not change this universe.">
      <div className="gu-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label="Universe market">
        <span style={{ fontSize: 11, fontWeight: 800, color: R.dim, width: 56 }}>MARKET</span>
        {UNIVERSE_SCOPES.map(([k, l]) => <button key={k} type="button" style={pill(scope === k)} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}
        <span style={{ width: 10 }} /><span style={{ fontSize: 11, fontWeight: 800, color: R.dim }}>VIEW</span>
        {VIEW_ORDER.map((k) => (
          <button key={k} type="button" style={pill(view === k)} aria-pressed={view === k} title={VIEW_HINT[k]} onClick={() => setView(k)}>{viewLabel(k, data?.viewCounts)}</button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: R.dim }}>{VIEW_HINT[view]}</div>
      <div className="gu-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label="Universe metric">
        <span style={{ fontSize: 11, fontWeight: 800, color: R.dim, width: 56 }}>METRIC</span>
        {UNIVERSE_METRICS.map(([k, l]) => <button key={k} type="button" style={pill(metric === k)} aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}
      </div>
      {scope === 'MY_BOOK' && held.length === 0 && <div style={{ fontSize: 12, color: R.dim }}>No holdings found. Add them on the Portfolio page and this view fills in.</div>}
      {state === 'loading' && !data && <div style={box({ padding: 12, fontSize: 13, color: R.dim })}>Reading the guidance universe.</div>}
      {state === 'error' && (
        <div style={box({ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}><b>{UNIVERSE_UNAVAILABLE}.</b> {error || 'Unknown error'}</span>
          <button type="button" style={btn(R.cyan, true)} onClick={retry}>Retry</button>
        </div>
      )}
      {data && (
        <>
          {universeNoticeLine(data.summary) && <div style={{ fontSize: 12, color: R.dim }}>{universeNoticeLine(data.summary)}</div>}
          {viewCountsLine(data.viewCounts) && <div style={{ fontSize: 12, color: R.dim }}>{viewCountsLine(data.viewCounts)}</div>}
          {view === 'review' && reasonCountsLine(data.summary?.reviewReasonCounts) && <div style={{ fontSize: 12, color: R.dim }}><b>Reasons:</b> {reasonCountsLine(data.summary?.reviewReasonCounts)}</div>}
          {view === 'claims' && <div style={{ fontSize: 12, color: R.dim }}>{data.countEquations?.claimsAwaiting?.text || 'Claims awaiting verification are found in media or not yet confirmed by the company\'s own document. They are never ranked or counted in Active.'}</div>}
          {data.countEquations?.rows?.text && <div style={{ fontSize: 12, color: data.countEquations.rows.holds === false ? R.red : R.dim }}><b>How the lists add up:</b> {data.countEquations.rows.text}</div>}
          <div style={{ fontSize: 12, color: R.dim }}>{list.length} shown</div>
          <div style={{ opacity: state === 'loading' ? 0.6 : 1 }}>
            <GuUniverseList records={list} showMarket={scope === 'ALL' || scope === 'MY_BOOK'} onFull={onFull} emptyText={data.records.length === 0 ? (view === 'review' ? 'Nothing is waiting for review.' : view === 'claims' ? 'No claims are waiting for verification.' : ZERO_RECORDS_TEXT) : "Nothing matches these filters. Clear a filter to see more."} />
          </div>
          {view === 'history' && (
            <div style={{ display: 'grid', gap: 4 }}>
              {expiryLine(data.summary?.expiry) && <div style={{ fontSize: 12, color: R.dim }}>{expiryLine(data.summary?.expiry)}</div>}
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>NO LONGER ACTIVE ({(data.inactive || []).length})</div>
              {(data.inactive || []).length === 0 ? <div style={{ fontSize: 12.5, color: R.dim }}>None.</div> : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
                  <CappedList inList color={R.dim} items={(data.inactive || []).filter((x) => scope === 'ALL' || scope === 'MY_BOOK' || (scope === 'INDIA' ? x.market === 'IN' : x.market === 'US'))} render={(x, i) => (
                    <li key={`${x.entityKey}-${i}`} className="gu-card" style={box({ padding: '5px 10px', fontSize: 13 })}>
                      <b>{x.company}</b> — {x.display} <span style={{ color: R.dim }}>{x.period} · {x.expiryReason || x.status}{x.sourceName ? ` · ${sourceDisplayName(x.sourceName)}` : ''}</span>
                    </li>
                  )} />
                </ul>
              )}
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>LEFT OUT ON PURPOSE ({(data.excluded || []).length})</div>
              {(data.excluded || []).length === 0 ? <div style={{ fontSize: 12.5, color: R.dim }}>None.</div> : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
                  {(data.excluded || []).slice(0, 50).map((x, i) => (
                    <li key={i} style={{ fontSize: 12.5, color: R.dim }}><b style={{ color: R.text }}>{x.company}</b> {x.period} — {excludedWhy(x)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </GuPanel>
  );
}
