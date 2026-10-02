'use client';
// zzz848 — 🔥 ACTIVE HIGH-GROWTH GUIDANCE: market toggle, a compact summary (numbers from the response only) and the numbered lists.
// zzz853 — four sections: HIGHEST ACTIVE GUIDANCE (everything that passes the checks), HIGHEST VERIFIED (strict), HIGHEST DERIVED (basis shown),
// CLAIMS AWAITING VERIFICATION. Each is split by cohort (annual / multi-year CAGR / quarterly). Old cached answers without the groups still render the older list.
// Independent of the event window. Empty or failed fetch says 'not available', never an empty success claim.
import React, { useMemo, useState } from 'react';
import { UNIVERSE_UNAVAILABLE, VERIFICATION_LEGEND, ZERO_RECORDS_TEXT, buildHighGrowth, highGrowthLines, unlistedActiveLine } from '@/lib/guidance-upgrades-format';
import type { GgCompany } from '@/lib/growth-guidance-types';
import type { GuUniverseRecord } from '@/lib/guidance-universe-types';
import { R, box, tint } from './gu-tokens';
import { QualityStrip, btn } from './GuBits';
import { GuGroupList, GuHighGrowthList } from './GuHighGrowthList';
import { useGuUniverse, type GuUniverseExt } from './useGuUniverse';
import { BADGE_LEGEND, SECTIONS, SECTION_ACTIVE, cohortCountsLine, cohortTotal, freshnessLines, groupCountsLine, highestActiveHeading, sectionRows } from './gu-ui';

type Mk = 'IN' | 'US' | 'ALL';
const TOGGLE: Array<[Mk, string]> = [['IN', 'India'], ['US', 'USA'], ['ALL', 'All']];
const pill = (on: boolean): React.CSSProperties => ({
  fontSize: 11, fontWeight: 800, letterSpacing: 0.3, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
  border: `1px solid ${on ? R.cyan : R.border}`, background: on ? tint(R.cyan, 14) : 'transparent', color: on ? R.cyan : R.dim,
});

export function recordFinder(data: GuUniverseExt | null): (entityKey: string) => GuUniverseRecord | null {
  const m = new Map<string, GuUniverseRecord>();
  for (const r of data?.records || []) { const k = (r as unknown as { entityKey?: string }).entityKey; if (k) m.set(k, r); }
  return (k) => m.get(k) ?? null;
}

export function GuUniverseSummary({ onFull }: { onFull?: (c: GgCompany) => void }) {
  const [mk, setMk] = useState<Mk>('IN');
  const { data, state, retry, error } = useGuUniverse({ market: 'ALL', view: 'active' });
  const groups = data?.summary?.highGrowthGroups;
  const hasGroups = !!groups && !!groups.cohorts;
  const legacy = useMemo(() => (data && !hasGroups ? buildHighGrowth(data, mk) : null), [data, mk, hasGroups]);
  const lines = legacy ? highGrowthLines(legacy, mk, data?.summary?.threshold ?? 30) : [];
  const quiet = legacy ? unlistedActiveLine(legacy) : null;
  const find = useMemo(() => recordFinder(data), [data]);
  const thr = data?.summary?.threshold ?? groups?.threshold ?? 30;
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
      {data && (
        <>
          <QualityStrip data={data} />
          <FreshnessBlockUniverse data={data} />
          {data.records.length === 0 ? <div style={{ fontSize: 13, color: R.dim }}>{ZERO_RECORDS_TEXT}</div> : (
            <>
              <div style={{ fontSize: 12, color: R.dim }} aria-label="Verification legend">{BADGE_LEGEND}</div>
              {hasGroups ? SECTIONS.map((sec) => {
                const rows = sectionRows(groups, sec.key, mk);
                const total = cohortTotal(rows);
                // zzz854: the Active heading carries its threshold and the backend equation, so 'Active N' vs 'Highest active M' is explained
                const ha = sec.key === 'active' && mk === 'ALL' ? highestActiveHeading(data.countEquations, total, thr) : null;
                return (
                  <div key={sec.key} role="group" aria-label={sec.title} style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: R.text }}>{ha ? ha.title : <>{sec.title} <span style={{ color: R.dim, fontWeight: 600 }}>({total})</span></>}</div>
                    {ha?.note && <div data-gu-highest-note style={{ fontSize: 12, color: R.dim }}>{ha.note}</div>}
                    {ha && data.countEquations?.highestActive && data.countEquations.highestActive.value !== total && <div style={{ fontSize: 12, color: R.amber }}>{total} rows are in this list; the count above says {data.countEquations.highestActive.value}.</div>}
                    <div style={{ fontSize: 12, color: R.dim }}>{sec.hint}</div>
                    {sec.key === 'active' && groups && (
                      <div style={{ fontSize: 12.5, color: R.dim }}>
                        {mk === 'ALL' ? <b style={{ color: R.text }}>{groupCountsLine(groups.counts)}</b> : null}
                        {mk === 'ALL' && cohortCountsLine(groups.counts) ? ' · ' : ''}{mk === 'ALL' ? cohortCountsLine(groups.counts) : `${total} shown for this market`}
                      </div>
                    )}
                    <GuGroupList cohorts={rows} showMarket={mk === 'ALL'} findRecord={find} onFull={onFull}
                      emptyText={sec.key === 'verified' ? `No strictly verified guidance of ${thr}% or more in this market in the current data.` : sec.key === 'derived' ? 'No derived growth of this size in this market.' : sec.key === 'claimsAwaiting' ? 'No claims awaiting verification in this market.' : `No active guidance of ${thr}% or more in this market in the current data.`} />
                  </div>
                );
              }) : legacy && (
                <>
                  <div style={{ fontSize: 12, color: R.dim }} aria-label="Older verification legend">{VERIFICATION_LEGEND}</div>
                  <div style={box({ padding: '8px 12px', display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, alignItems: 'baseline' })}>
                    {lines.map((l, i) => (
                      <span key={i} style={{ color: R.dim }}>{l.value ? <>{l.label} <b style={{ color: R.text }}>{l.value}</b></> : <b style={{ color: R.text, fontSize: 14 }}>{l.label}</b>}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, color: R.text }}>{SECTION_ACTIVE}</div>
                  <GuHighGrowthList rows={legacy.rows} showMarket={mk === 'ALL'} onFull={onFull} emptyText="No active guidance of 30% or more in this market in the current data." />
                  {quiet && <div style={{ fontSize: 12, color: R.dim }}>{quiet}</div>}
                </>
              )}
            </>
          )}
          {data.scan && !data.scan.complete && <div style={{ fontSize: 11.5, color: R.dim }}>Universe scan incomplete. {data.scan.note}</div>}
        </>
      )}
    </section>
  );
}

/** The guidance-data line of the three freshness lines. The event-scan and source lines are shown with the event coverage. */
function FreshnessBlockUniverse({ data }: { data: GuUniverseExt }) {
  const l = freshnessLines({ builtAt: data.builtAt, servedFrom: data.servedFrom })[0];
  return <div style={{ fontSize: 12, color: R.dim }}><b style={{ color: R.text }}>{l.label}:</b> <span style={{ color: l.known ? R.dim : R.amber }}>{l.text}</span></div>;
}
