'use client';
// ═══════════════════════════════════════════════════════════════════════════
// GUIDANCE UPGRADES (zzz843). Positive company guidance raises, verified against a primary source, quantified,
// compared with expectations, valued, and ended with ONE decision (or UNVERIFIED). One fetch, no AI on load.
// My Book is read in this browser only (same sources as the Radar) and overlaid here; the server never sees it.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GuWindow, GuidanceUpgradesResponse } from '@/lib/guidance-upgrades-types';
import { applyFilters, type MetricFilter, type ScopeFilter } from '@/lib/guidance-upgrades-format';
import { overlayBook, countInBook } from '@/lib/guidance-upgrades-book';
import { readLocalBookInput, fetchSavedHoldings } from '@/lib/thesis/book-sources';
import { GuTopBar } from '@/components/guidance-upgrades/GuTopBar';
import { GuCard } from '@/components/guidance-upgrades/GuCard';
import { GuDetail } from '@/components/guidance-upgrades/GuDetail';
import { PRINT_CSS, R, box } from '@/components/guidance-upgrades/gu-tokens';
import { btn } from '@/components/guidance-upgrades/GuBits';

export default function GuidanceUpgradesPage() {
  const [window_, setWindow] = useState<GuWindow>('7D');
  const [scope, setScope] = useState<ScopeFilter>('ALL');
  const [metric, setMetric] = useState<MetricFilter>('ALL');
  const [data, setData] = useState<GuidanceUpgradesResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [held, setHeld] = useState<string[]>([]);
  const [bookLoaded, setBookLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), [data]);

  const load = useCallback(async (w: GuWindow) => {
    setState('loading');
    try {
      const r = await fetch(`/api/v1/guidance-upgrades?window=${w}&market=ALL`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j || !Array.isArray(j.events)) throw new Error('bad answer');
      setData(j as GuidanceUpgradesResponse); setState('ok');
    } catch { setState('error'); }
  }, []);

  useEffect(() => { void load(window_); }, [window_, load]);

  useEffect(() => {
    try { const id = new URLSearchParams(window.location.search).get('id'); if (id) setOpenId(id); } catch { /* no id */ }
  }, []);
  const select = (id: string | null) => {
    setOpenId(id);
    try { const u = new URL(window.location.href); if (id) u.searchParams.set('id', id); else u.searchParams.delete('id'); window.history.replaceState(null, '', u.toString()); } catch { /* cosmetic */ }
  };

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
  const shown = useMemo(() => applyFilters(events, scope, metric), [events, scope, metric]);
  const open = openId ? events.find((e) => e.guidance_event_id === openId) || null : null;

  return (
    <div className="gu-page" style={{ color: R.text, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <style>{PRINT_CSS}</style>
      <GuTopBar summary={data?.summary || null} window={window_} onWindow={setWindow} scope={scope} onScope={setScope} metric={metric} onMetric={setMetric}
        newest={data?.freshness.newestAnnouncement || null} checkedAt={data?.freshness.feedCheckedAt || null} inBookCount={countInBook(events)} bookLoaded={bookLoaded} />
      {scope === 'MY_BOOK' && bookLoaded && held.length === 0 && <div style={{ fontSize: 12, color: R.dim }}>No holdings found. Add them on the Portfolio page and this filter fills in.</div>}
      {data?.freshness.note && <div style={{ fontSize: 12, color: R.dim }}>{data.freshness.note}</div>}

      {state === 'loading' && !data && <div style={box({ padding: 14, fontSize: 13, color: R.dim })}>Looking for guidance raises. This can take a few seconds.</div>}
      {state === 'error' && (
        <div style={box({ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}>The guidance feed could not be read right now. Nothing is wrong with your data. Please try again.</span>
          <button type="button" style={btn(R.cyan, true)} onClick={() => void load(window_)}>Retry</button>
        </div>
      )}
      {state === 'ok' && shown.length === 0 && (
        <div style={box({ padding: 14, fontSize: 13, color: R.dim })}>
          {events.length === 0
            ? 'No verified guidance raises found in this window. Try a longer window. Quiet weeks are normal.'
            : 'Nothing matches these filters. Clear a filter to see the other raises.'}
        </div>
      )}
      <div style={{ display: 'grid', gap: 10, opacity: state === 'loading' && data ? 0.6 : 1 }}>
        {shown.map((e) => <GuCard key={e.guidance_event_id} e={e} onOpen={select} now={now} />)}
      </div>
      <div style={{ fontSize: 11, color: R.faint }}>Company data only. Not investment advice. Prices are context here, never the reason.</div>
      {open && <GuDetail e={open} onClose={() => select(null)} now={now} />}
    </div>
  );
}
