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
import { ageText } from '@/lib/gu-client-cache';
import { universeStatusLine, useGuUniverse, type GuUniverseExt } from './useGuUniverse';
import { useHeldKeys, withoutHeld } from '@/lib/gu-held-store';
import { quarantineCounts } from '@/lib/gu-quarantine';
import { GuFold, GuPanel, pillStyle } from './GuPanel';
import { GuVerifyButton } from './GuVerifyButton';
import { GuDataQuality } from './GuDataQuality';
import { GuClaimsTable } from './GuClaimsTable';
import { GuDerivedAudit } from './GuIntegrityAudit';
import { GuAtAGlance } from './GuAtAGlance';
import { SCOPE_NOTE, scopedTitle } from '@/lib/guidance-semantics';
import { BADGE_LEGEND, SECTIONS, SECTION_ACTIVE, cohortCountsLine, cohortTotal, freshnessLines, highestActiveFinal, rowCohortLine, rowTrustLine, sectionRows } from './gu-ui';

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
  const uh = useGuUniverse({ market: 'ALL', view: 'active' });
  const { data, state, retry, error } = uh;
  const uLine = universeStatusLine(uh, ageText);   // zzz1129 (R2): refresh failures shown here too
  const heldKeys = useHeldKeys();   // zzz1116 (G04): the Focus list's held-back growths leave these rankings too
  const groups = useMemo(() => withoutHeld(data?.summary?.highGrowthGroups, heldKeys), [data, heldKeys]);
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
      {uLine && uLine.tone === 'warn' && <div role="alert" style={{ fontSize: 12, color: R.amber, display: 'flex', gap: 8, alignItems: 'center' }}><span>{uLine.text}</span><button type="button" style={btn()} onClick={retry}>Retry</button></div>}
      {state === 'error' && (
        <div style={box({ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}><b>{UNIVERSE_UNAVAILABLE}.</b> {error || 'Unknown error'}. An empty list here does not mean nothing is active.</span>
          <button type="button" style={btn(R.cyan, true)} onClick={retry}>Retry</button>
        </div>
      )}
      {data && (
        <>
          {/* zzz880 — the plain summary first; the technical checks are folded below it */}
          <GuAtAGlance data={data} threshold={thr} />
          {(data.invariantViolations?.length ?? 0) > 0 && (() => {
            // zzz1116 (G04) — counted three ways from the same snapshot; the points really are out of every ranking now
            const q = quarantineCounts(data.invariantViolations);
            const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
            return <div role="alert" style={{ fontSize: 12.5, color: R.red }}>Data checks failed: {pl(q.checks, 'failed check', 'failed checks')}{q.points ? ` on ${pl(q.points, 'guidance point', 'guidance points')} of ${pl(q.companies, 'company', 'companies')}` : ''} — those points are kept out of every ranked list on this page (they stay under Review). Details under "Data quality and checks".</div>;
          })()}
          <GuFold title="Data quality and checks" accent={R.grey} hint="Sources, scan coverage, verification, claims and how each growth figure was calculated">
          <GuDataQuality quality={data.extractCoverage?.quality} />
          <GuVerifyButton pending={data.viewCounts?.claimsAwaiting ?? null} />
          <GuClaimsTable claims={data.pipeline?.claims} market={mk} />
          <GuDerivedAudit audit={data.derivedAudit} />
          {hasGroups && mk !== 'US' && cohortTotal(sectionRows(groups, 'active', 'IN')) === 0 && cohortTotal(sectionRows(groups, 'claimsAwaiting', 'IN')) > 0 && (
            <div data-gu-india-note style={{ fontSize: 12.5, color: R.amber }}>India: no guidance is verified against the company's own document yet. {data.pipeline?.claimCounts?.IN?.claims ?? cohortTotal(sectionRows(groups, 'claimsAwaiting', 'IN'))} India claim rows reported by media ({cohortTotal(sectionRows(groups, 'claimsAwaiting', 'IN'))} of them at {thr}% or more, which is all this ranked list shows) wait for their company documents; see "Claims and what happens next".</div>
          )}
          <div data-gu-populations style={{ fontSize: 12.5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span><b>Active guidance universe:</b> {data.summary?.all?.active ?? data.records.length}</span>
            <span><b>High-growth active subset ({thr}% or more):</b> {hasGroups ? cohortTotal(sectionRows(groups, 'active', mk)) : (legacy ? legacy.rows.length : 0)}</span>
            <span style={{ color: R.dim }}>The second is a part of the first.</span>
          </div>
          <QualityStrip data={data} />
          {data.scan && !data.scan.complete && <div style={{ fontSize: 11.5, color: R.dim }}>Universe scan incomplete. {data.scan.note}</div>}
          </GuFold>
          {data.records.length === 0 ? <div style={{ fontSize: 13, color: R.dim }}>{ZERO_RECORDS_TEXT}</div> : (
            <>
              {hasGroups ? SECTIONS.map((sec) => {
                const rows = sectionRows(groups, sec.key, mk);
                const total = cohortTotal(rows);
                // zzz854: the Active heading carries its threshold and the backend equation, so 'Active N' vs 'Highest active M' is explained
                const ha = sec.key === 'active' && mk === 'ALL' ? highestActiveFinal(groups, data.countEquations?.active?.value ?? null, thr) : null;   // zzz1130 (R3)
                // zzz859: each list folds; the ranked lists open when they have rows, claims awaiting verification stay closed
                const accent = SECTION_ACCENT[sec.key] || R.cyan;
                return (
                  <div key={sec.key} role="group" aria-label={sec.title}>
                  <GuFold title={scopedTitle(ha ? ha.title.replace(/\s*\(\d+\)\s*$/, '') : sec.title.replace(/\s*\(\d+\)\s*$/, ''), mk)} count={total} accent={accent} defaultOpen={sec.key === 'active' && total > 0}>
                    {ha?.note && <div data-gu-highest-note style={{ fontSize: 12, color: R.dim }}>{ha.note}</div>}
                    {ha && groups && groups.counts.rows !== total && <div style={{ fontSize: 12, color: R.amber }}>{total} rows are in this list; the count above says {groups.counts.rows}.</div>}
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
          <GuFold title="Freshness, legend and scan notes" accent={R.grey} hint="Where the data came from and what the badges mean">
            <FreshnessBlockUniverse data={data} />
            <div style={{ fontSize: 11.5, color: R.dim }} aria-label="Verification legend">{BADGE_LEGEND}</div>
            </GuFold>
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
