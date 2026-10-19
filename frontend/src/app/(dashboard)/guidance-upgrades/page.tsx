'use client';
// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE UPGRADES (zzz843). Positive company guidance raises, verified against a primary source, quantified,
// compared with expectations, valued, and ended with ONE decision (or UNVERIFIED). One fetch, no AI on load.
// My Book is read in this browser only (same sources as the Radar) and overlaid here; the server never sees it.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GuWindow, GuidanceUpgradesResponse } from '@/lib/guidance-upgrades-types';
import { applyFilters, splitToday, zeroEventWording, unresolvedCount, type MetricFilter, type ScopeFilter } from '@/lib/guidance-upgrades-format';
import { overlayBook, countInBook } from '@/lib/guidance-upgrades-book';
import { readLocalBookInput, fetchSavedHoldings } from '@/lib/thesis/book-sources';
import { readBook } from '@/components/charts/useBookWatchlistSync';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { GuTitle, GuTopBar } from '@/components/guidance-upgrades/GuTopBar';
import { GuCard, GuAuditArea } from '@/components/guidance-upgrades/GuCard';
import { GuCoverage } from '@/components/guidance-upgrades/GuCoverage';
import { GuReviewQueue, GuVerificationBlock } from '@/components/guidance-upgrades/GuQueue';
import { GuDetailShell, normalizeFullEvent, type DetailLoad } from '@/components/guidance-upgrades/GuDetailShell';
import { GuUniverseSummary } from '@/components/guidance-upgrades/GuUniverseSummary';
import { GuFocusList } from '@/components/guidance-upgrades/GuFocusList';
import { GuStatusStrip } from '@/components/guidance-upgrades/GuStatusStrip';
import { GuUniverseBrowser } from '@/components/guidance-upgrades/GuUniverseBrowser';
import { GgDetail } from '@/components/growth-guidance/GgDetail';
import { PRINT_CSS, R, box } from '@/components/guidance-upgrades/gu-tokens';
import { btn } from '@/components/guidance-upgrades/GuBits';
import { splitAudit } from '@/components/guidance-upgrades/gu-ui';
import { CappedList } from '@/components/guidance-upgrades/GuMore';
import { GuPanel } from '@/components/guidance-upgrades/GuPanel';
import { GuUpgradeAudit } from '@/components/guidance-upgrades/GuIntegrityAudit';
import { GuNameCheck } from '@/components/guidance-upgrades/GuNameCheck';
import { readCacheAsync, writeCache, FRESH_MS, ageText } from '@/lib/gu-client-cache';
import { GU_WORKSPACES, GU_WS_KEY, parseWorkspace, sectionShown, type GuWorkspace } from '@/lib/gu-workspace';

export default function GuidanceUpgradesPage() {
  const [window_, setWindow] = useState<GuWindow>('7D');
  const [scope, setScope] = useState<ScopeFilter>('ALL');
  const [metric, setMetric] = useState<MetricFilter>('ALL');
  const [data, setData] = useState<GuidanceUpgradesResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  // zzz882: when the fresh load fails, the saved copy stays on screen — and the page now SAYS so, with its age and a retry (Rishi saw a 3-hour-old copy as if live)
  const [savedOnly, setSavedOnly] = useState<number | null>(null);
  const [held, setHeld] = useState<string[]>([]);
  const [bookLoaded, setBookLoaded] = useState(false);
  const [todayFirst, setTodayFirst] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ggOpen, setGgOpen] = useState<GgCompany | null>(null);
  const now = useMemo(() => new Date(), [data]);
  // zzz1123 — four workspaces (URL ?ws= first, then this browser's last choice, then Focus)
  const [ws, setWs0] = useState<GuWorkspace>('focus');
  useEffect(() => {
    let w: GuWorkspace | null = null;
    try { w = parseWorkspace(new URLSearchParams(window.location.search).get('ws')); } catch { /* none */ }
    if (!w) try { w = parseWorkspace(localStorage.getItem(GU_WS_KEY)); } catch { /* blocked */ }
    if (w) setWs0(w);
  }, []);
  const setWs = useCallback((w: GuWorkspace) => {
    setWs0(w);
    try { localStorage.setItem(GU_WS_KEY, w); } catch { /* blocked */ }
    try { const u = new URL(window.location.href); u.searchParams.set('ws', w); window.history.replaceState(null, '', u.toString()); } catch { /* cosmetic */ }
  }, []);
  const vis = (sec: Parameters<typeof sectionShown>[1]): CSSProperties | undefined => (sectionShown(ws, sec) ? undefined : { display: 'none' });

  const acRef = useRef<AbortController | null>(null);
  const load = useCallback(async (w: GuWindow, force = false) => {
    acRef.current?.abort();
    const ac = new AbortController(); acRef.current = ac;
    // zzz863: the saved answer for this window is shown at once; fresh data is fetched in the background (skipped when it is under 90 seconds old)
    const key = `/api/v1/guidance-upgrades?window=${w}&market=ALL&lean=1`;   // zzz886: list without detail-only text; an opened card fetches its full event
    const hit = force ? null : await readCacheAsync<GuidanceUpgradesResponse>(key);
    if (ac.signal.aborted) return;
    if (hit && Array.isArray((hit.data as { events?: unknown })?.events)) {
      setData(hit.data); setState('ok'); setSavedOnly(null);
      if (hit.ageMs < FRESH_MS) return;
    } else setState('loading');
    const get = async (url: string) => {
      const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j || !Array.isArray(j.events)) throw new Error('bad answer');
      return j as GuidanceUpgradesResponse & { servedFromSaved?: boolean; savedAt?: string };
    };
    try {
      let j = await get(key);
      if (ac.signal.aborted) return;
      writeCache(key, j);
      setData(j); setState('ok'); setSavedOnly(null);
      // zzz865: the server may answer from its saved copy (fast); ask once more for the fresh build in the background, keeping the saved data on screen meanwhile
      if (j.servedFromSaved) {
        setRefreshing(true);
        try {
          const j2 = await get(`${key}&force=1`);
          if (!ac.signal.aborted) { writeCache(key, j2); setData(j2); }
        } catch { /* the saved copy stays on screen */ }
        if (!ac.signal.aborted) setRefreshing(false);
      }
    } catch {
      if (ac.signal.aborted) return;
      if (!hit) { setState('error'); return; }
      setSavedOnly(hit.at);
      // one automatic retry after 20 s (a deploy restarts the server for about a minute)
      setTimeout(() => { if (acRef.current === ac) void load(w, true); }, 20_000);
    }
  }, []);

  useEffect(() => { void load(window_); return () => acRef.current?.abort(); }, [window_, load]);
  useEffect(() => { const h = () => void load(window_, true); window.addEventListener('gu-refresh', h); return () => window.removeEventListener('gu-refresh', h); }, [window_, load]);

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
      // zzz1119 (G08) — each holding carries its market: the India book (browser + Portfolio page) as IN:, the US book as US:
      const acc: string[] = [];
      try { acc.push(...(readLocalBookInput().browser || []).map((t) => `IN:${t}`)); } catch { /* ignore */ }
      try { const s = await fetchSavedHoldings(); if (s.ok) acc.push(...s.symbols.map((t) => `IN:${t}`)); } catch { /* ignore */ }
      try { const u = await readBook('US'); if (u.ok) acc.push(...u.items.map((x) => `US:${x.t}`)); } catch { /* the US book needs sign-in; India still works */ }
      if (alive) { setHeld(Array.from(new Set(acc))); setBookLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  const events = useMemo(() => overlayBook(data?.events || [], held), [data, held]);
  const filtered = useMemo(() => applyFilters(events, scope, metric), [events, scope, metric]);
  const { main: shown, audit: auditList } = useMemo(() => splitAudit(filtered), [filtered]);
  const { today: todayList, rest: restList } = useMemo(() => splitToday(shown, now), [shown, now]);
  const openLean = useMemo(() => (openId ? events.find((e) => e.guidance_event_id === openId) || null : null), [openId, events]);
  // zzz886: the opened card's full event (why this decision, chain, impacts …), fetched once; the lean row shows meanwhile
  // zzz1112 (G01) — per-event load state; the full panel renders only from a validated full record (GuDetailShell)
  const [fullEv, setFullEv] = useState<Record<string, DetailLoad>>({});
  const [retryTick, setRetryTick] = useState(0);
  const openId0 = openLean?.guidance_event_id ?? null;
  const openIsLean = !!(openLean as any)?.lean;
  useEffect(() => {
    if (!openId0) return;
    if (!openIsLean) { const ev = normalizeFullEvent(openLean, openId0); setFullEv((m) => ({ ...m, [openId0]: ev ? { status: 'ok', event: ev } : { status: 'error', text: 'the record is incomplete' } })); return; }
    const cur = fullEv[openId0];
    if (cur && cur.status !== 'error') return;
    if (cur?.status === 'error' && retryTick === 0) return;
    const id = openId0;
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, 20_000);
    setFullEv((m) => ({ ...m, [id]: { status: 'loading' } }));
    fetch(`/api/v1/guidance-upgrades?window=${window_}&market=ALL&id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: ctrl.signal })
      .then(async (r) => {
        if (r.status === 404) throw new Error('this event is no longer in the feed');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json().catch(() => null);
        const ev = normalizeFullEvent(j?.event ? { ...openLean, ...j.event, lean: false } : null, id);
        if (!ev) throw new Error('the answer did not contain this event');
        setFullEv((m) => ({ ...m, [id]: { status: 'ok', event: ev } }));
      })
      .catch((e: any) => {
        if (ctrl.signal.aborted && !timedOut) return;   // closed / another company opened: drop this answer
        setFullEv((m) => ({ ...m, [id]: { status: 'error', text: timedOut ? 'no answer within 20 seconds' : String(e?.message || e) } }));
      })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctrl.abort(); };
    // fullEv is read once per open / retry (not a trigger): re-running on every state write would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId0, openIsLean, window_, retryTick]);
  const openLoad = openId0 ? fullEv[openId0] : undefined;
  const eventCounts = useMemo(() => ({ IN: events.filter((e) => e.market === 'IN').length, US: events.filter((e) => e.market === 'US').length }), [events]);
  // zzz855: a window can hold hundreds of events. Each list renders 30 cards, then "Show N more"; every count above comes from the full list.
  const card = useCallback((e: (typeof events)[number]) => <GuCard key={e.guidance_event_id} e={e} onOpen={select} now={now} />, [select, now]);

  return (
    <div className="gu-page" style={{ color: R.text, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{PRINT_CSS}</style>
      <GuTitle newest={data?.freshness.newestAnnouncement || null} checkedAt={data?.freshness.feedCheckedAt || null} loading={!data} />
      {savedOnly != null && data && (
        <div role="status" className="gu-noprint" style={{ fontSize: 12.5, padding: '6px 10px', borderRadius: 6, border: `1px solid ${R.amber}`, color: R.text }}>
          ⚠ Showing a saved copy from {ageText(Date.now() - savedOnly)} — the fresh load did not answer. It retries by itself in 20 seconds.{' '}
          <button type="button" onClick={() => void load(window_, true)} style={{ textDecoration: 'underline', background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }}>Retry now</button>
        </div>
      )}
      {refreshing && data && <div className="gu-noprint" style={{ fontSize: 11.5, color: R.dim }}>Showing the saved copy from {ageText(Date.now() - new Date((data as any).savedAt || Date.now()).getTime())}. Fresh data is loading in the background.</div>}
      <GuStatusStrip />
      <div role="tablist" aria-label="Guidance workspaces" className="gu-noprint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: `1px solid ${R.border}`, paddingBottom: 6 }}>
        {GU_WORKSPACES.map((w) => (
          <button key={w.id} type="button" role="tab" aria-selected={ws === w.id} title={w.hint} onClick={() => setWs(w.id)}
            style={{ fontSize: 13.5, fontWeight: ws === w.id ? 800 : 600, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${ws === w.id ? R.cyan : R.border}`, background: 'transparent', color: ws === w.id ? R.cyan : R.text }}>
            {w.label}{w.id === 'changes' && data ? ` (${shown.length})` : ''}
          </button>
        ))}
      </div>
      {ws !== 'all' && <div className="gu-noprint" style={{ fontSize: 12, color: R.dim, marginTop: -8 }}>{GU_WORKSPACES.find((w) => w.id === ws)?.hint}</div>}
      {/* zzz880 — the companies to look at first, before any detail */}
      <div style={vis('focus')}><GuFocusList events={events} window={window_} onOpen={select} caps={(data as any)?.caps ?? null} /></div>
      <div style={vis('summary')}><GuUniverseSummary onFull={setGgOpen} /></div>
      <div style={vis('browser')}><GuUniverseBrowser held={held} onFull={setGgOpen} /></div>
      <div style={vis('namecheck')}><GuNameCheck /></div>
      <div style={vis('events')}>
      <GuPanel id="gu-events" icon="📈" title="Guidance raises in this window" accent={R.violet} count={state === 'ok' || data ? shown.length : null}
        hint="New guidance raises announced in the chosen time window. Click a card for the full check.">
      <GuTopBar summary={data?.summary || null} window={window_} onWindow={setWindow} scope={scope} onScope={setScope} metric={metric} onMetric={setMetric}
        inBookCount={countInBook(events)} bookLoaded={bookLoaded} incomplete={!!data?.coverage?.cards?.some((c: any) => c.overall !== 'COMPLETE') || data?.scan?.IN?.complete === false || data?.scan?.US?.complete === false} />
      {scope === 'MY_BOOK' && bookLoaded && held.length === 0 && <div style={{ fontSize: 12, color: R.dim }}>No holdings found. Add them on the Portfolio page and this filter fills in.</div>}

      {state === 'loading' && !data && <div style={box({ padding: 14, fontSize: 13, color: R.dim })}>Looking for guidance raises. This can take a few seconds.</div>}
      {state === 'error' && (
        <div style={box({ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}>The guidance feed could not be read right now. Nothing is wrong with your data. Please try again.</span>
          <button type="button" style={btn(R.cyan, true)} onClick={() => void load(window_, true)}>Retry</button>
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
      </div>
      {/* zzz859: audit, review queue, AI verification and coverage together, collapsed until opened */}
      <div style={vis('checks')}>
      <GuPanel key={`checks-${ws === 'review'}`} id="gu-checks" icon="🔎" title="Checks, review queue and coverage" accent={R.grey} count={auditList.length + (data?.reviewQueueCount ?? 0)} defaultOpen={ws === 'review'}
        hint="What was found but not shown as a raise, why, and how much of the market was read.">
      <GuUpgradeAudit audit={(data as any)?.upgradeAudit} />
      <GuAuditArea events={auditList} onOpen={select} now={now} />
      {/* zzz854: items that are not event cards, each with its reason; then the AI verification state (never silent) */}
      <GuReviewQueue items={data?.reviewQueue} count={data?.reviewQueueCount} />
      <GuVerificationBlock data={data as unknown as Parameters<typeof GuVerificationBlock>[0]['data']} />
      <GuCoverage coverage={data?.coverage} queue={data?.queue} invariantViolations={data?.invariantViolations} unresolved={unresolvedCount(data?.unresolved)} scan={data?.scan} now={now} window={window_} byMarket={data?.freshness.byMarket} eventCounts={eventCounts} />
      {!data?.scan && data?.freshness.note && <div style={{ fontSize: 12, color: R.dim }}>{data.freshness.note}</div>}
      </GuPanel>
      </div>
      <div style={{ fontSize: 11, color: R.faint }}>Company data only. Not investment advice. Prices are context here, never the reason.</div>
      {ggOpen && <GgDetail c={ggOpen} onClose={() => setGgOpen(null)} unverified={ggOpen.verification === 'SECONDARY_ONLY' || ggOpen.verification === 'UNVERIFIED'} />}
      {openLean && <GuDetailShell lean={openLean} load={openLoad} onClose={() => select(null)} onRetry={() => setRetryTick((n) => n + 1)} now={now} />}
    </div>
  );
}
