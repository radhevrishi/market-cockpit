'use client';
// zzz848 — 🔥 ACTIVE HIGH-GROWTH GUIDANCE: market toggle, a compact summary (numbers from the response only) and the numbered list.
// Independent of the event window. Empty or failed fetch says 'not available', never an empty success claim.
import React, { useState } from 'react';
import type { GuUniverseRecord } from '@/lib/guidance-universe-types';
import { UNIVERSE_HEADER, UNIVERSE_UNAVAILABLE, sortUniverse, universeSummaryLines } from '@/lib/guidance-upgrades-format';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { R, box, tint } from './gu-tokens';
import { btn } from './GuBits';
import { GuUniverseList } from './GuUniverseList';
import { useGuUniverse } from './useGuUniverse';

type Mk = 'IN' | 'US' | 'ALL';
const TOGGLE: Array<[Mk, string]> = [['IN', 'India'], ['US', 'USA'], ['ALL', 'All']];
const pill = (on: boolean): React.CSSProperties => ({
  fontSize: 11, fontWeight: 800, letterSpacing: 0.3, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
  border: `1px solid ${on ? R.cyan : R.border}`, background: on ? tint(R.cyan, 14) : 'transparent', color: on ? R.cyan : R.dim,
});

export function GuUniverseSummary({ onFull, filterRecords }: { onFull?: (c: GgCompany) => void; filterRecords?: (r: GuUniverseRecord[]) => GuUniverseRecord[] }) {
  const [mk, setMk] = useState<Mk>('IN');
  const { data, state, retry } = useGuUniverse({ market: 'ALL', view: 'active' });
  const lines = data ? universeSummaryLines(data.summary, mk) : [];
  const base = data ? data.records.filter((r) => mk === 'ALL' || r.record?.market === mk) : [];
  const list = sortUniverse(filterRecords ? filterRecords(base) : base);
  return (
    <section aria-label="Active high-growth guidance" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 14, fontWeight: 900, letterSpacing: 0.6, margin: 0 }}>🔥 ACTIVE HIGH-GROWTH GUIDANCE</h2>
        <div className="gu-noprint" style={{ display: 'flex', gap: 6, marginLeft: 'auto' }} role="group" aria-label="Market">
          {TOGGLE.map(([k, l]) => <button key={k} type="button" style={pill(mk === k)} aria-pressed={mk === k} onClick={() => setMk(k)}>{l}</button>)}
        </div>
      </div>
      {state === 'loading' && !data && <div style={box({ padding: 12, fontSize: 13, color: R.dim })}>{UNIVERSE_UNAVAILABLE}. Reading the guidance universe.</div>}
      {state === 'error' && (
        <div style={box({ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}>{UNIVERSE_UNAVAILABLE}. Nothing here means nothing is active. Please try again.</span>
          <button type="button" style={btn(R.cyan, true)} onClick={retry}>Retry</button>
        </div>
      )}
      {data && (
        <>
          <div style={box({ padding: '8px 12px', display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, alignItems: 'baseline' })}>
            {lines.map((l, i) => (
              <span key={i} style={{ color: R.dim }}>{l.value ? <>{l.label} <b style={{ color: R.text }}>{l.value}</b></> : <b style={{ color: R.text, fontSize: 14 }}>{l.label}</b>}</span>
            ))}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>{UNIVERSE_HEADER.toUpperCase()}</div>
          <GuUniverseList records={list} showMarket={mk === 'ALL'} onFull={onFull} emptyText="No active guidance records in this market in the current universe data." />
          {data.scan && !data.scan.complete && <div style={{ fontSize: 11.5, color: R.dim }}>Universe scan incomplete. {data.scan.note}</div>}
        </>
      )}
    </section>
  );
}
