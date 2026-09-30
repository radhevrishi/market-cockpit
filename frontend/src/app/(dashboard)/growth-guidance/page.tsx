'use client';
// ═══════════════════════════════════════════════════════════════════════════
// GROWTH GUIDANCE (zzz846). Companies where MANAGEMENT has said growth will be unusually high, verified against a source.
// Surface = a simple list. Forensic detail = the drawer. One fetch, no AI on load, no price on the page.
// My Book is read in this browser only and overlaid here; the server never sees it.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GgCompany, GgResponse } from '@/lib/growth-guidance-types';
import {
  ALERT_KIND_LABEL, DEFAULT_FILTERS, DISCLAIMER, DISCOVER_HEADING, DISCOVER_NOTE, SCAN_INCOMPLETE_NOTE, SCAN_STATE_LABEL, buildQuery, isGgResponseLike, lastScanText, listAsText, loadFilters,
  mainPeriod, overlayHeld, safeList, saveFilters, scanHeadline, thresholdTitle, universeHeading, type GgFilters,
} from '@/lib/growth-guidance-format';
import { readLocalBookInput, fetchSavedHoldings } from '@/lib/thesis/book-sources';
import { GgTopBar } from '@/components/growth-guidance/GgTopBar';
import { GgList } from '@/components/growth-guidance/GgList';
import { GgCard } from '@/components/growth-guidance/GgCard';
import { GgDetail } from '@/components/growth-guidance/GgDetail';
import { PRINT_CSS, R, box, tint } from '@/components/growth-guidance/gg-tokens';
import { Chip, StatusLegend, btn } from '@/components/growth-guidance/GgBits';

const LEVEL_COLOR = { HIGH: R.green, MEDIUM: R.cyan, LOW: R.grey } as const;

export default function GrowthGuidancePage() {
  const [f, setF] = useState<GgFilters>(DEFAULT_FILTERS);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<GgResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [held, setHeld] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDiscover, setShowDiscover] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { setF(loadFilters()); setReady(true); }, []);

  const load = useCallback(async (filters: GgFilters) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState('loading');
    try {
      const r = await fetch(`/api/v1/growth-guidance?${buildQuery(filters)}`, { cache: 'no-store', signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!isGgResponseLike(j)) throw new Error('bad answer');
      if (ac.signal.aborted) return;
      setData(j as GgResponse); setState('ok');
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setState('error');
    }
  }, []);

  useEffect(() => { if (ready) { void load(f); saveFilters(f); } return () => abortRef.current?.abort(); }, [ready, f, load]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const acc: string[] = [];
      try { acc.push(...(readLocalBookInput().browser || [])); } catch { /* ignore */ }
      try { const s = await fetchSavedHoldings(); if (s.ok) acc.push(...s.symbols); } catch { /* ignore */ }
      if (alive) setHeld(Array.from(new Set(acc)));
    })();
    return () => { alive = false; };
  }, []);

  const companies = useMemo(() => overlayHeld(safeList(data?.companies), held), [data, held]);
  const discovery = useMemo(() => overlayHeld(safeList(data?.discovery), held), [data, held]);
  const byId = useMemo(() => { const m = new Map<string, { c: GgCompany; unverified: boolean }>(); companies.forEach((c) => m.set(c.id, { c, unverified: false })); discovery.forEach((c) => m.set(c.id, { c, unverified: true })); return m; }, [companies, discovery]);
  const open = openId ? byId.get(openId) || null : null;
  const title = thresholdTitle(data?.threshold ?? f.threshold, data?.metric ?? f.metric, mainPeriod(companies));
  const incomplete = !!data && data.scan && !data.scan.complete;
  const todayItems = safeList(data?.newToday);

  const copy = async () => {
    try { await navigator.clipboard.writeText(listAsText(companies, title)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="gg-page" style={{ color: R.text, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <style>{PRINT_CSS}</style>
      <GgTopBar f={f} onChange={(p) => setF((prev) => ({ ...prev, ...p }))} data={data} onRefresh={() => void load(f)} loading={state === 'loading'} />

      {state === 'loading' && !data && <div style={box({ padding: 14, fontSize: 13, color: R.dim })}>Looking for growth guidance. This can take a few seconds.</div>}
      {state === 'error' && (
        <div style={box({ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' })} role="alert">
          <span style={{ fontSize: 13 }}>The growth guidance feed could not be read right now. Nothing is wrong with your data. Please try again.</span>
          <button type="button" style={btn(R.cyan, true)} onClick={() => void load(f)}>Retry</button>
        </div>
      )}
      {data?.note && <div style={{ fontSize: 12, color: R.dim }}>{data.note}</div>}

      {/* 🔥 NEW TODAY */}
      {todayItems.length > 0 && (
        <section aria-label="New today">
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.4, color: R.dim, marginBottom: 6 }}>🔥 NEW TODAY</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {todayItems.map((a) => (
              <button key={`${a.id}-${a.kind}`} type="button" onClick={() => byId.has(a.id) && setOpenId(a.id)}
                style={{ ...box({ padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', textAlign: 'left', cursor: byId.has(a.id) ? 'pointer' : 'default' }) as React.CSSProperties }}>
                <Chip color={LEVEL_COLOR[a.level] ?? R.grey}>{ALERT_KIND_LABEL[a.kind] ?? a.kind}</Chip>
                <b style={{ fontSize: 13 }}>{a.company}</b><span style={{ fontSize: 11, color: R.dim }}>{a.ticker || 'ticker not resolved'}</span>
                <span style={{ fontSize: 12.5, color: R.text }}>{a.text}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 📈 UNIVERSE */}
      <section aria-label="Growth guidance universe">
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.4, color: R.dim }}>📈 {universeHeading(f.threshold)}</div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{title}</h2>
          </div>
          {companies.length > 0 && (
            <div className="gg-noprint" style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={btn(R.cyan)} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy list'}</button>
              <button type="button" style={btn(R.cyan)} onClick={() => { try { window.print(); } catch { /* no print */ } }}>Print list</button>
            </div>
          )}
        </div>
        {state === 'ok' && companies.length === 0 && (
          <div style={box({ padding: 14, fontSize: 13, color: R.dim })}>
            {incomplete ? SCAN_INCOMPLETE_NOTE : `No verified guidance of ${f.threshold}%+ found with these filters. Try a lower threshold or widen the size filter. Quiet periods are normal.`}
          </div>
        )}
        {companies.length > 0 && (
          <div style={{ opacity: state === 'loading' ? 0.6 : 1 }}>
            <GgList items={companies} onOpen={setOpenId} />
            <div style={{ marginTop: 8 }}><StatusLegend /></div>
          </div>
        )}
      </section>

      {/* 🔎 DISCOVER: collapsed, clearly not verified */}
      <section aria-label="Discover">
        <button type="button" className="gg-noprint" aria-expanded={showDiscover} onClick={() => setShowDiscover((v) => !v)} style={{ ...btn(R.amber, showDiscover), fontSize: 12 }}>
          🔎 {DISCOVER_HEADING} ({discovery.length}) — not verified {showDiscover ? '▲' : '▼'}
        </button>
        {showDiscover && (
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <div role="note" style={{ border: `1px dashed ${R.amber}`, background: tint(R.amber, 10), borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700 }}>{DISCOVER_NOTE}</div>
            {discovery.length === 0 && <div style={{ fontSize: 12, color: R.dim }}>Nothing in discovery for these filters.</div>}
            {discovery.map((c) => <GgCard key={c.id} c={c} onOpen={setOpenId} unverified />)}
          </div>
        )}
      </section>

      {/* coverage / scan panel */}
      {data?.scan && (
        <section aria-label="Scan coverage" style={box({ padding: 10, display: 'grid', gap: 6 })}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip color={data.scan.complete ? R.green : R.amber} dashed={!data.scan.complete}>{scanHeadline(data.scan)}</Chip>
            <span style={{ fontSize: 11, color: R.dim }}>{lastScanText(data.scan.lastScanAt)}</span>
          </div>
          {data.scan.note && <div style={{ fontSize: 12, color: R.dim }}>{data.scan.note}</div>}
          {safeList(data.scan.sources).length > 0 && (
            <div style={{ display: 'grid', gap: 2 }}>
              {safeList(data.scan.sources).map((s, i) => (
                <div key={i} style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ minWidth: 140 }}>{s.name}</b>
                  <span style={{ color: s.state === 'COMPLETE' ? R.green : s.state === 'FAILED' ? R.red : R.amber, fontWeight: 800 }}>{SCAN_STATE_LABEL[s.state] ?? s.state}</span>
                  <span style={{ color: R.dim }}>{s.scanned} read</span>
                  {s.detail && <span style={{ color: R.dim }}>{s.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div style={{ fontSize: 11, color: R.faint }}>{DISCLAIMER}</div>
      {open && <GgDetail c={open.c} unverified={open.unverified} onClose={() => setOpenId(null)} />}
    </div>
  );
}
