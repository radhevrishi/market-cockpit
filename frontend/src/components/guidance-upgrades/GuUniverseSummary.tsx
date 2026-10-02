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
import { GuFold, GuPanel, pillStyle } from './GuPanel';
import { GuDataQuality } from './GuDataQuality';
import { GuClaimsTable } from './GuClaimsTable';
import { SCOPE_NOTE, scopedTitle } from '@/lib/guidance-semantics';
import { BADGE_LEGEND, SECTIONS, SECTION_ACTIVE, cohortCountsLine, cohortTotal, freshnessLines, highestActiveHeading, rowCohortLine, rowTrustLine, sectionRows } from './gu-ui';

type Mk = 'IN' | 'US' | 'ALL';
const TOGGLE: Array<[Mk, string]> = [['ALL', 'All markets'], ['IN', 'India'], ['US', 'USA']];
const SECTION_ACCENT: Record<string, string> = { active: R.cyan, verified: R.green, derived: R.violet, claimsAwaiting: R.amber };

export function recordFinder(data: GuUniverseExt | null): (entityKey: string) => GuUniverseRecord | null {
  const m = new Map<string, GuUniverseRecord>();
  for (const r of data?.records || []) { const k = (r as unknown as { entityKey?: string }).entityKey; if (k) m.set(k, r); }
  return (k) => m.get(k) ?? null;
}

export function GuUniverseSummary({ onFull }: { onFull?: (c: GgCompany) => void }) {
  const [mk, setMk] = useState<Mk>('ALL');
  const { data, state, retry, error } = useGuUniverse({ market: 'ALL', view: 'active' });
  const groups = data?.summary?.highGrowthGroups;
  const hasGroups = !!groups && !!groups.cohorts;
  const legacy = useMemo(() => (data && !hasGroups ? buildHighGrowth(data, mk) : null), [data, mk, hasGroups]);
  const lines = legacy ? highGrowthLines(legacy, mk, data?.summary?.threshold ?? 30) : [];
  const quiet = legacy ? unlistedActiveLine(legacy) : null;
  const find = useMemo(() => recordFinder(data), [data]);
  const thr = data?.summary?.threshold ?? groups?.threshold ?? 30;
  const scopeWord = SCOPE_NOTE[mk].toLowerCase().replace(' together', '');
  return (
    <GuPanel id="gu-high-growth" icon="🔥" title="Active high-growth guidance" accent={R.green}
      hint={`Companies that have guided ${thr}% or more growth and whose guidance is still in force.`}
      right={<div role="group" aria-label="Market" style={{ display: 'flex', gap: 6 }}>{TOGGLE.map(([k, l]) => <button key={k} type="button" style={pillStyle(mk === k, R.green)} aria-pressed={mk === k} onClick={() => setMk(k)}>{l}</button>)}</div>}>
      {state === 'loading' && !data && <div style={box({ padding: 12, fontSize: 13, color: R.dim })}>Reading the guidance universe.</div>}
      {state === 'error' && (
        <div style={box({ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}><b>{UNIVERSE_UNAVAILABLE}.</b> {error || 'Unknown error'}. An empty list here does not mean nothing is active.</span>
          <button type="button" style={btn(R.cyan, true)} onClick={retry}>Retry</button>
        </div>
      )}
      {data && (
        <>
          <GuDataQuality quality={data.extractCoverage?.quality} />
          <div data-gu-datasets style={{ fontSize: 12, color: R.dim }}>Four separate lists on this page: <b style={{ color: R.text }}>Guidance universe</b> (all guidance in force today) · <b style={{ color: R.text }}>Upgrade events</b> (changes inside the chosen window) · <b style={{ color: R.text }}>Claim queue</b> (media claims waiting for the company document) · <b style={{ color: R.text }}>Document queue</b> (company filings waiting to be read).</div>
          <GuClaimsTable claims={data.pipeline?.claims} market={mk} />
          <div data-gu-scope style={{ fontSize: 12.5, color: R.dim }}>Showing: <b style={{ color: R.text }}>{SCOPE_NOTE[mk]}</b>. Switch the market above; every heading and count below follows it.</div>
          {hasGroups && mk !== 'US' && cohortTotal(sectionRows(groups, 'active', 'IN')) === 0 && cohortTotal(sectionRows(groups, 'claimsAwaiting', 'IN')) > 0 && (
            <div data-gu-india-note style={{ fontSize: 12.5, color: R.amber }}>India: no guidance is verified against the company's own document yet. {data.pipeline?.claimCounts?.IN?.claims ?? cohortTotal(sectionRows(groups, 'claimsAwaiting', 'IN'))} India claim rows reported by media ({cohortTotal(sectionRows(groups, 'claimsAwaiting', 'IN'))} of them at {thr}% or more, which is all this ranked list shows) wait for their company documents; see "Claims and what happens next".</div>
          )}
          <QualityStrip data={data} />
          {data.records.length === 0 ? <div style={{ fontSize: 13, color: R.dim }}>{ZERO_RECORDS_TEXT}</div> : (
            <>
              {hasGroups ? SECTIONS.map((sec) => {
                const rows = sectionRows(groups, sec.key, mk);
                const total = cohortTotal(rows);
                // zzz854: the Active heading carries its threshold and the backend equation, so 'Active N' vs 'Highest active M' is explained
                const ha = sec.key === 'active' && mk === 'ALL' ? highestActiveHeading(data.countEquations, total, thr) : null;
                // zzz859: each list folds; the ranked lists open when they have rows, claims awaiting verification stay closed
                const accent = SECTION_ACCENT[sec.key] || R.cyan;
                return (
                  <div key={sec.key} role="group" aria-label={sec.title}>
                  <GuFold title={scopedTitle(ha ? ha.title.replace(/\s*\(\d+\)\s*$/, '') : sec.title.replace(/\s*\(\d+\)\s*$/, ''), mk)} count={total} accent={accent} defaultOpen={sec.key !== 'claimsAwaiting' && total > 0}>
                    {ha?.note && <div data-gu-highest-note style={{ fontSize: 12, color: R.dim }}>{ha.note}</div>}
                    {ha && data.countEquations?.highestActive && data.countEquations.highestActive.value !== total && <div style={{ fontSize: 12, color: R.amber }}>{total} rows are in this list; the count above says {data.countEquations.highestActive.value}.</div>}
                    <div style={{ fontSize: 12, color: R.dim }}>{sec.hint}</div>
                    {sec.key === 'active' && groups && (
                      <div style={{ fontSize: 12.5, color: R.dim }}>
                        <b data-gu-trust-line style={{ color: R.text }}>{rowTrustLine(rows)}</b> · {rowCohortLine(rows)}
                      </div>
                    )}
                    <GuGroupList cohorts={rows} showMarket={mk === 'ALL'} findRecord={find} onFull={onFull}
                      emptyText={sec.key === 'verified' ? `No strictly verified guidance of ${thr}% or more for ${scopeWord} in the current data.` : sec.key === 'derived' ? `No derived growth of this size for ${scopeWord}.` : sec.key === 'claimsAwaiting' ? `No claims awaiting verification for ${scopeWord}.` : `No active guidance of ${thr}% or more for ${scopeWord} in the current data.`} />
                  </GuFold>
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
                  <GuHighGrowthList rows={legacy.rows} showMarket={mk === 'ALL'} onFull={onFull} emptyText={`No active guidance of 30% or more for ${scopeWord} in the current data.`} />
                  {quiet && <div style={{ fontSize: 12, color: R.dim }}>{quiet}</div>}
                </>
              )}
            </>
          )}
          <div style={{ display: 'grid', gap: 2, borderTop: `1px dashed ${R.border}`, paddingTop: 6 }}>
            <FreshnessBlockUniverse data={data} />
            <div style={{ fontSize: 11.5, color: R.dim }} aria-label="Verification legend">{BADGE_LEGEND}</div>
          </div>
          {data.scan && !data.scan.complete && <div style={{ fontSize: 11.5, color: R.dim }}>Universe scan incomplete. {data.scan.note}</div>}
        </>
      )}
    </GuPanel>
  );
}

/** The guidance-data line of the three freshness lines. The event-scan and source lines are shown with the event coverage. */
function FreshnessBlockUniverse({ data }: { data: GuUniverseExt }) {
  const l = freshnessLines({ builtAt: data.builtAt, servedFrom: data.servedFrom })[0];
  return <div style={{ fontSize: 12, color: R.dim }}><b style={{ color: R.text }}>{l.label}:</b> <span style={{ color: l.known ? R.dim : R.amber }}>{l.text}</span></div>;
}
