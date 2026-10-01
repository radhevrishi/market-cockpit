'use client';
// zzz848 — 🔥 ACTIVE HIGH-GROWTH GUIDANCE: market toggle, a compact summary (numbers from the response only) and the numbered list.
// Independent of the event window. Empty or failed fetch says 'not available', never an empty success claim.
import React, { useMemo, useState } from 'react';
import { UNIVERSE_HEADER, UNIVERSE_UNAVAILABLE, VERIFICATION_LEGEND, ZERO_RECORDS_TEXT, buildHighGrowth, highGrowthLines, unlistedActiveLine } from '@/lib/guidance-upgrades-format';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { R, box, tint } from './gu-tokens';
import { btn } from './GuBits';
import { GuHighGrowthList } from './GuHighGrowthList';
import { useGuUniverse } from './useGuUniverse';

type Mk = 'IN' | 'US' | 'ALL';
const TOGGLE: Array<[Mk, string]> = [['IN', 'India'], ['US', 'USA'], ['ALL', 'All']];
const pill = (on: boolean): React.CSSProperties => ({
  fontSize: 11, fontWeight: 800, letterSpacing: 0.3, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
  border: `1px solid ${on ? R.cyan : R.border}`, background: on ? tint(R.cyan, 14) : 'transparent', color: on ? R.cyan : R.dim,
});

export function GuUniverseSummary({ onFull }: { onFull?: (c: GgCompany) => void }) {
  const [mk, setMk] = useState<Mk>('IN');
  const { data, state, retry, error } = useGuUniverse({ market: 'ALL', view: 'active' });
  const view = useMemo(() => (data ? buildHighGrowth(data, mk) : null), [data, mk]);
  const lines = view ? highGrowthLines(view, mk, data?.summary?.threshold ?? 30) : [];
  const quiet = view ? unlistedActiveLine(view) : null;
  return (
    <section aria-label="Active high-growth guidance" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 14, fontWeight: 900, letterSpacing: 0.6, margin: 0 }}>🔥 ACTIVE HIGH-GROWTH GUIDANCE</h2>
        <div className="gu-noprint" style={{ display: 'flex', gap: 6, marginLeft: 'auto' }} role="group" aria-label="Market">
          {TOGGLE.map(([k, l]) => <button key={k} type="button" style={pill(mk === k)} aria-pressed={mk === k} onClick={() => setMk(k)}>{l}</button>)}
        </div>
      </div>
      {state === 'loading' && !data && <div style={box({ padding: 12, fontSize: 13, color: R.dim })}>Reading the guidance universe.</div>}
      {state === 'error' && (
        <div style={box({ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}><b>{UNIVERSE_UNAVAILABLE}.</b> {error || 'Unknown error'}. An empty list here does not mean nothing is active.</span>
          <button type="button" style={btn(R.cyan, true)} onClick={retry}>Retry</button>
        </div>
      )}
      {data && view && (
        <>
          {data.records.length === 0 ? <div style={{ fontSize: 13, color: R.dim }}>{ZERO_RECORDS_TEXT}</div> : (
            <>
              <div style={box({ padding: '8px 12px', display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, alignItems: 'baseline' })}>
                {lines.map((l, i) => (
                  <span key={i} style={{ color: R.dim }}>{l.value ? <>{l.label} <b style={{ color: R.text }}>{l.value}</b></> : <b style={{ color: R.text, fontSize: 14 }}>{l.label}</b>}</span>
                ))}
              </div>
              <div style={{ fontSize: 12, color: R.dim }} aria-label="Verification legend">{VERIFICATION_LEGEND}</div>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>{UNIVERSE_HEADER.toUpperCase()}</div>
              <GuHighGrowthList rows={view.rows} showMarket={mk === 'ALL'} onFull={onFull} emptyText="No active guidance of 30% or more in this market in the current data." />
              {quiet && <div style={{ fontSize: 12, color: R.dim }}>{quiet}</div>}
            </>
          )}
          {data.scan && !data.scan.complete && <div style={{ fontSize: 11.5, color: R.dim }}>Universe scan incomplete. {data.scan.note}</div>}
        </>
      )}
    </section>
  );
}
