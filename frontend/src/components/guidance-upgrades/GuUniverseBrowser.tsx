'use client';
// zzz848 — 📊 GUIDANCE UNIVERSE: scope chips (All | India | USA | My Book), metric chips and the Active / All active view.
// It never reads the event window. My Book is a client-side overlay using the holdings the page already loaded.
import React, { useMemo, useState } from 'react';
import { normSymbol } from '@/lib/portfolio-symbols';
import {
  UNIVERSE_METRICS, UNIVERSE_SCOPES, UNIVERSE_UNAVAILABLE, ZERO_RECORDS_TEXT, universeNoticeLine, filterUniverse, sortUniverse, universeApiMarket, universeApiMetric,
  type UniverseMetric, type UniverseScope, type UniverseView,
} from '@/lib/guidance-upgrades-format';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { R, box, tint } from './gu-tokens';
import { btn } from './GuBits';
import { GuUniverseList } from './GuUniverseList';
import { useGuUniverse } from './useGuUniverse';

const pill = (on: boolean): React.CSSProperties => ({
  fontSize: 11, fontWeight: 800, letterSpacing: 0.3, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
  border: `1px solid ${on ? R.cyan : R.border}`, background: on ? tint(R.cyan, 14) : 'transparent', color: on ? R.cyan : R.dim,
});

export function GuUniverseBrowser({ held, onFull }: { held: string[]; onFull?: (c: GgCompany) => void }) {
  const [scope, setScope] = useState<UniverseScope>('ALL');
  const [metric, setMetric] = useState<UniverseMetric>('ALL');
  const [view, setView] = useState<UniverseView>('active');
  const { data, state, retry, error } = useGuUniverse({ market: universeApiMarket(scope), metric: universeApiMetric(metric), view });
  const heldSet = useMemo(() => new Set(held.map(normSymbol)), [held]);
  const list = useMemo(
    () => sortUniverse(filterUniverse(data?.records || [], scope, metric, (t) => heldSet.has(normSymbol(t)))),
    [data, scope, metric, heldSet],
  );
  return (
    <section aria-label="Guidance universe" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ fontSize: 14, fontWeight: 900, letterSpacing: 0.6, margin: 0 }}>📊 GUIDANCE UNIVERSE</h2>
      <div style={{ fontSize: 12, color: R.dim }}>Guidance that is still in force, whenever it was announced. The time window in the next section only filters events. It does not change this universe.</div>
      <div className="gu-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Universe market">
        {UNIVERSE_SCOPES.map(([k, l]) => <button key={k} type="button" style={pill(scope === k)} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}
        <span style={{ width: 10 }} />
        {([['active', 'Active guidance'], ['all', 'Active + history']] as Array<[UniverseView, string]>).map(([k, l]) => (
          <button key={k} type="button" style={pill(view === k)} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      <div className="gu-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Universe metric">
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
          <div style={{ fontSize: 12, color: R.dim }}>{list.length} shown</div>
          <div style={{ opacity: state === 'loading' ? 0.6 : 1 }}>
            <GuUniverseList records={list} showMarket={scope === 'ALL' || scope === 'MY_BOOK'} onFull={onFull} emptyText={data.records.length === 0 ? ZERO_RECORDS_TEXT : "Nothing matches these filters. Clear a filter to see more."} />
          </div>
        </>
      )}
    </section>
  );
}
