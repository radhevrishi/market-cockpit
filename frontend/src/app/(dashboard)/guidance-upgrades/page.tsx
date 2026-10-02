'use client';
// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE UPGRADES (zzz843). Positive company guidance raises, verified against a primary source, quantified,
// compared with expectations, valued, and ended with ONE decision (or UNVERIFIED). One fetch, no AI on load.
// My Book is read in this browser only (same sources as the Radar) and overlaid here; the server never sees it.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GuWindow, GuidanceUpgradesResponse } from '@/lib/guidance-upgrades-types';
import { applyFilters, splitToday, zeroEventWording, unresolvedCount, type MetricFilter, type ScopeFilter } from '@/lib/guidance-upgrades-format';
import { overlayBook, countInBook } from '@/lib/guidance-upgrades-book';
import { readLocalBookInput, fetchSavedHoldings } from '@/lib/thesis/book-sources';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { GuTitle, GuTopBar } from '@/components/guidance-upgrades/GuTopBar';
import { GuCard, GuAuditArea } from '@/components/guidance-upgrades/GuCard';
import { GuCoverage } from '@/components/guidance-upgrades/GuCoverage';
import { GuReviewQueue, GuVerificationBlock } from '@/components/guidance-upgrades/GuQueue';
import { GuDetail } from '@/components/guidance-upgrades/GuDetail';
import { GuUniverseSummary } from '@/components/guidance-upgrades/GuUniverseSummary';
import { GuUniverseBrowser } from '@/components/guidance-upgrades/GuUniverseBrowser';
import { GgDetail } from '@/components/growth-guidance/GgDetail';
import { PRINT_CSS, R, box } from '@/components/guidance-upgrades/gu-tokens';
import { btn } from '@/components/guidance-upgrades/GuBits';
import { splitAudit } from '@/components/guidance-upgrades/gu-ui';
import { CappedList } from '@/components/guidance-upgrades/GuMore';
import { GuPanel } from '@/components/guidance-upgrades/GuPanel';

export default function GuidanceUpgradesPage() {
  const [window_, setWindow] = useState<GuWindow>('7D');
  const [scope, setScope] = useState<ScopeFilter>('ALL');
  const [metric, setMetric] = useState<MetricFilter>('ALL');
  const [data, setData] = useState<GuidanceUpgradesResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [held, setHeld] = useState<string[]>([]);
  const [bookLoaded, setBookLoaded] = useState(false);
  const [todayFirst, setTodayFirst] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ggOpen, setGgOpen] = useState<GgCompany | null>(null);
  const now = useMemo(() => new Date(), [data]);

  const acRef = useRef<AbortController | null>(null);
  const load = useCallback(async (w: GuWindow) => {
    acRef.current?.abort();
    const ac = new AbortController(); acRef.current = ac;
    setState('loading');
    try {
      const r = await fetch(`/api/v1/guidance-upgrades?window=${w}&market=ALL`, { cache: 'no-store', signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j || !Array.isArray(j.events)) throw new Error('bad answer');
      if (ac.signal.aborted) return;
      setData(j as GuidanceUpgradesResponse); setState('ok');
    } catch { if (!ac.signal.aborted) setState('error'); }
  }, []);

  useEffect(() => { void load(window_); return () => acRef.current?.abort(); }, [window_, load]);

  useEffect(() => {
    try { const id = new URLSearchParams(window.location.search).get('id'); if (id) setOpenId(id); } catch { /* no id */ }
  }, []);
  const select = useCallback((id: string | null) => {
    setOpenId(id);
    try { const u = new URL(window.location.href); if (id) u.searchParams.set('id', id); else u.searchParams.delete('id'); window.history.replaceState(null, '', u.toString()); } catch { /* cosmetic */ }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const acc: string[] = [];
      try { acc.push(...(readLocalBookInput().browser || [])); } catch { /* ignore */ }
      try { const s = await fetchSavedHoldings(); if (s.ok) acc.push(...s.symbols); } catch { /* ignore */ }
      if (alive) { setHeld(Array.from(new Set(acc))); setBookLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  const events = useMemo(() => overlayBook(data?.events || [], held), [data, held]);
  const filtered = useMemo(() => applyFilters(events, scope, metric), [events, scope, metric]);
  const { main: shown, audit: auditList } = useMemo(() => splitAudit(filtered), [filtered]);
  const { today: todayList, rest: restList } = useMemo(() => splitToday(shown, now), [shown, now]);
  const open = useMemo(() => (openId ? events.find((e) => e.guidance_event_id === openId) || null : null), [openId, events]);
  const eventCounts = useMemo(() => ({ IN: events.filter((e) => e.market === 'IN').length, US: events.filter((e) => e.market === 'US').length }), [events]);
  // zzz855: a window can hold hundreds of events. Each list renders 30 cards, then "Show N more"; every count above comes from the full list.
  const card = useCallback((e: (typeof events)[number]) => <GuCard key={e.guidance_event_id} e={e} onOpen={select} now={now} />, [select, now]);

  return (
    <div className="gu-page" style={{ color: R.text, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{PRINT_CSS}</style>
      <GuTitle newest={data?.freshness.newestAnnouncement || null} checkedAt={data?.freshness.feedCheckedAt || null} />
      <GuUniverseSummary onFull={setGgOpen} />
      <GuUniverseBrowser held={held} onFull={setGgOpen} />
      <GuPanel id="gu-events" icon="📈" title="Guidance raises in this window" accent={R.violet} count={state === 'ok' || data ? shown.length : null}
        hint="New guidance raises announced in the chosen time window. Click a card for the full check.">
      <GuTopBar summary={data?.summary || null} window={window_} onWindow={setWindow} scope={scope} onScope={setScope} metric={metric} onMetric={setMetric}
        inBookCount={countInBook(events)} bookLoaded={bookLoaded} incomplete={!!data?.coverage?.cards?.some((c: any) => c.overall !== 'COMPLETE') || data?.scan?.IN?.complete === false || data?.scan?.US?.complete === false} />
      {scope === 'MY_BOOK' && bookLoaded && held.length === 0 && <div style={{ fontSize: 12, color: R.dim }}>No holdings found. Add them on the Portfolio page and this filter fills in.</div>}

      {state === 'loading' && !data && <div style={box({ padding: 14, fontSize: 13, color: R.dim })}>Looking for guidance raises. This can take a few seconds.</div>}
      {state === 'error' && (
        <div style={box({ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}>The guidance feed could not be read right now. Nothing is wrong with your data. Please try again.</span>
          <button type="button" style={btn(R.cyan, true)} onClick={() => void load(window_)}>Retry</button>
        </div>
      )}
      {state === 'ok' && shown.length === 0 && (
        <div style={box({ padding: 14, fontSize: 13, color: R.dim })}>
          {events.length === 0 ? zeroEventWording(window_, data?.scan) : auditList.length > 0 && filtered.length === auditList.length ? 'No clean raises in this window. See the audit area below for what was found.' : 'Nothing matches these filters. Clear a filter to see the other raises.'}
        </div>
      )}
      {state === 'ok' && (scope === 'INDIA' || scope === 'USA') && shown.length === 0 && (() => {
        const m = data?.summary?.pipelineByMarket?.[scope === 'INDIA' ? 'IN' : 'US']; const nm = scope === 'INDIA' ? 'India' : 'USA';
        return (
          <div data-gu-market-funnel style={box({ padding: 12, fontSize: 12.5, color: R.dim })}>
            <b style={{ color: R.text }}>{nm} in this window:</b> {m && typeof m.processed === 'number' ? `${m.processed} documents processed, ${m.verifiedUpgrades ?? 0} verified upgrades, ${m.awaitingNumbers ?? 0} still waiting for numbers, ${m.awaitingPrimary ?? 0} waiting for the company document.` : 'no documents have been processed yet.'}
            {' '}No {nm} card is shown because nothing {nm} has passed every check. What was found is in the review queue below, and the pipeline status above says how much of {nm} is still unread.
          </div>
        );
      })()}
      {shown.length > 0 && (
        <div className="gu-noprint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" style={btn(todayFirst ? R.cyan : undefined, todayFirst)} aria-pressed={todayFirst} onClick={() => setTodayFirst((v) => !v)}>Today first</button>
          <span style={{ fontSize: 11, color: R.dim }}>{todayList.length} announced today</span>
        </div>
      )}
      <div style={{ display: 'grid', gap: 10, opacity: state === 'loading' && data ? 0.6 : 1 }}>
        {todayFirst && todayList.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>TODAY</div>
            <CappedList key={`today-${window_}-${scope}-${metric}`} items={todayList} render={card} color={R.dim} />
            {restList.length > 0 && <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>EARLIER IN THIS WINDOW</div>}
            <CappedList key={`rest-${window_}-${scope}-${metric}`} items={restList} render={card} color={R.dim} />
          </>
        )}
        {!(todayFirst && todayList.length > 0) && <CappedList key={`all-${window_}-${scope}-${metric}`} items={shown} render={card} color={R.dim} />}
      </div>
      </GuPanel>
      {/* zzz859: audit, review queue, AI verification and coverage together, collapsed until opened */}
      <GuPanel id="gu-checks" icon="🔎" title="Checks, review queue and coverage" accent={R.grey} count={auditList.length + (data?.reviewQueueCount ?? 0)} defaultOpen={false}
        hint="What was found but not shown as a raise, why, and how much of the market was read.">
      <GuAuditArea events={auditList} onOpen={select} now={now} />
      {/* zzz854: items that are not event cards, each with its reason; then the AI verification state (never silent) */}
      <GuReviewQueue items={data?.reviewQueue} count={data?.reviewQueueCount} />
      <GuVerificationBlock data={data as unknown as Parameters<typeof GuVerificationBlock>[0]['data']} />
      <GuCoverage coverage={data?.coverage} queue={data?.queue} invariantViolations={data?.invariantViolations} unresolved={unresolvedCount(data?.unresolved)} scan={data?.scan} now={now} window={window_} byMarket={data?.freshness.byMarket} eventCounts={eventCounts} />
      {!data?.scan && data?.freshness.note && <div style={{ fontSize: 12, color: R.dim }}>{data.freshness.note}</div>}
      </GuPanel>
      <div style={{ fontSize: 11, color: R.faint }}>Company data only. Not investment advice. Prices are context here, never the reason.</div>
      {ggOpen && <GgDetail c={ggOpen} onClose={() => setGgOpen(null)} unverified={ggOpen.verification === 'SECONDARY_ONLY' || ggOpen.verification === 'UNVERIFIED'} />}
      {open && <GuDetail e={open} onClose={() => select(null)} now={now} />}
    </div>
  );
}
