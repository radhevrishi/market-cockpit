'use client';
// ═══════════════════════════════════════════════════════════════════════════
// 🔥 US SPECIAL FOCUS — a research-time allocation, never a recommendation.
//                                                                     (zzz790)
// The India panel (components/special-focus-panel) talks to the India memory
// (/api/v1/special-focus → persist:v1:all). This one is the same view over
// the SAME shared logic — detection (the shared detector via usDetect, fed US inputs), the queue
// (specialFocusQueue), near misses (nearMissList), the button words
// (focusButtonWords) — talking to the US memory (/api/v1/us-thesis/
// special-focus → us-persist:v1:all). So the queue count, the near-miss count
// and the near-miss rows come from one list each, exactly as in India, and a
// US detection never lands in India's memory. No price anywhere in this file.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rankOf, persistenceWords, catalystThesisLine, type PersistentCatalyst } from '@/lib/catalyst/persistence';
import { specialFocusQueue, nearMissList, focusButtonWords } from '@/lib/catalyst/cross-view';
import { type FocusRow } from '@/components/special-focus-panel';
import { usDetect } from '@/lib/us-thesis/persist-us';
import { catalystIsolated } from '@/lib/us-thesis/sanitize';

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)',
  cyan: 'var(--tc-accent, #22D3EE)', green: 'var(--mc-verdict-up, #34D399)', red: 'var(--mc-verdict-down, #F87171)',
};
const ENDPOINT = '/api/v1/us-thesis/special-focus';

interface Stored {
  id: string; ticker: string; kind: string; label: string; sfId: number | null; firstSeen: string; lastSeen: string;
  origins: string[]; everSpecialFocus: boolean;
  timeline: Array<{ at: string; origin: string; state: string; confidence: string; latestEvidenceDate: string | null; summary: string; specialFocus: boolean }>;
  latest: PersistentCatalyst; user: { state: string; at: string; note: string | null } | null;
  focus: { inQueue: boolean; decayed: boolean; note: string | null };
}

/** Pure helper shared with the page: detections for every row, one map. */
export function usLiveDetections(rows: FocusRow[]): Map<string, { pc: PersistentCatalyst; row: FocusRow }> {
  const m = new Map<string, { pc: PersistentCatalyst; row: FocusRow }>();
  for (const r of rows) for (const pc of usDetect(r as any)) m.set(pc.id, { pc, row: r });
  return m;
}

/** The CIK most of a row's own SEC documents are filed under. */
function rowCik(r: FocusRow | null | undefined): string | null {
  const counts = new Map<string, number>();
  for (const p of Object.values<any>(r?.ledger?.periods || {})) for (const d of p?.documents || []) {
    const m = /\/edgar\/data\/(\d+)\//i.exec(String(d?.url || ''));
    if (m) { const c = String(Number(m[1])); counts.set(c, (counts.get(c) || 0) + 1); }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

export function UsSpecialFocusPanel({ rows, ready, thesisLabel, onJump, onReadPrior, priorRunning, display }: {
  rows: FocusRow[]; ready: boolean;
  /** zzz793: the company's own fiscal periods and SEC wording for what is printed. */
  display?: (ticker: string, x: any) => any;
  thesisLabel: (r: FocusRow) => string;
  onJump: (ticker: string) => void;
  onReadPrior?: (tickers: string[]) => void; priorRunning?: boolean;
}) {
  const [stored, setStored] = useState<Record<string, Stored>>({});
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showNear, setShowNear] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const upserted = useRef(false);

  const live = useMemo(() => usLiveDetections(rows), [rows]);
  const load = (json: any) => {
    const map: Record<string, Stored> = {};
    // zzz793: a stored record whose evidence names another company is not shown.
    const rowOf = new Map(rows.map((r) => [r.symbol.toUpperCase(), r] as const));
    for (const rec of (json?.records || []) as Stored[]) {
      if (!catalystIsolated({ ...(rec.latest as any), id: rec.id, ticker: rec.ticker }, rowCik(rowOf.get(String(rec.ticker).toUpperCase())))) continue;
      map[rec.id] = rec;
    }
    setStored(map);
  };
  useEffect(() => {
    fetch(ENDPOINT, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(load).catch((e) => setErr(String(e?.message || e)));
  }, []);
  useEffect(() => {
    if (!ready || upserted.current || live.size === 0) return;
    upserted.current = true;
    const worth = [...live.values()].map((x) => x.pc).filter((p) => p.specialFocus || p.confidence === 'HIGH' || p.confidence === 'MEDIUM');
    if (!worth.length) return;
    fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upsert', catalysts: worth }) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => j && load(j)).catch(() => null);
  }, [ready, live]);

  const act = async (id: string, state: string | null) => {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'user', id, state }) }).catch(() => null);
    const j = r && r.ok ? await r.json() : null;
    if (j?.record) setStored((s) => ({ ...s, [id]: j.record }));
  };

  const queue = useMemo(() => {
    const rowOf = new Map(rows.map((r) => [r.symbol.toUpperCase(), r] as const));
    return specialFocusQueue<FocusRow>(live, stored as any, (t) => rowOf.get(t) || null);
  }, [live, stored, rows]);
  const entries = useMemo(() => queue.entries.map((e) => ({ ...e, st: e.st as Stored | null }))
    .sort((a, b) => (Number(b.st?.user?.state === 'confirmed') - Number(a.st?.user?.state === 'confirmed')) || (Number(a.decayed) - Number(b.decayed)) || (rankOf(b.pc) - rankOf(a.pc))), [queue]);
  const nearInfo = useMemo(() => nearMissList<FocusRow>(live, entries), [live, entries]);
  const near = nearInfo.near;
  const priorable = near.filter((x) => Object.keys(x.row.ledger?.periods || {}).length <= 1).map((x) => x.pc.ticker);
  const shown = entries.filter((e) => !e.dismissed);
  const visible = showAll ? shown : shown.slice(0, 8);
  const btn = (id: string, u: string | null, label: string, state: string, color: string) => (
    <button key={label} onClick={() => act(id, u === state ? null : state)} style={{ fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${u === state ? color : C.border}`, background: 'transparent', color }}>{u === state ? `✓ ${label}` : label}</button>
  );

  return (
    <div id="us-special-focus" data-testid="us-special-focus" style={{ border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 12px', background: C.bg, scrollMarginTop: 70 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: C.amber }}>🔥 US Special Focus — {shown.length} persistent catalyst{shown.length === 1 ? '' : 's'}</span>
        <span style={{ fontSize: 12.5, color: C.faint }}>
          A business mechanism (capacity ramp, backlog, customer ramp) with filed SEC evidence and runway for several periods. Research allocation only — not a buy list, no price used. Output growth alone never qualifies; a target is a milestone, not evidence.
        </span>
      </div>
      {err && <div style={{ fontSize: 12.5, color: C.amber }}>US memory not reachable ({err}) — showing today&apos;s detections only.</div>}
      {!ready && <div style={{ fontSize: 12.5, color: C.faint }}>Waiting for the stored evidence…</div>}
      {ready && shown.length === 0 && <div style={{ fontSize: 13, color: C.dim }}>No US company currently meets the Special Focus gate (a validated mechanism, filed figures, an evidence-supported runway, thesis not broken).</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map((e) => {
          const pc: PersistentCatalyst = display ? display(e.pc.ticker, e.pc) : e.pc;
          const u = e.st?.user?.state || null;
          const isOpen = !!open[e.id];
          return (
            <div key={e.id} data-testid="us-special-focus-card" style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', opacity: e.decayed ? 0.85 : 1 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: C.amber }}>🔥 {e.st?.sfId ? `#${e.st.sfId}` : 'NEW'}</span>
                <button onClick={() => onJump(pc.ticker)} style={{ all: 'unset', cursor: 'pointer', fontSize: 15, fontWeight: 900, color: C.text }}>{pc.ticker}</button>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{pc.label}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: pc.state === 'STALLING' || pc.state === 'WEAKENING' ? C.red : C.cyan }}>{persistenceWords(pc).evidence}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: pc.confidence === 'HIGH' ? C.green : C.cyan }}>{persistenceWords(pc).persistence}</span>
                <span style={{ fontSize: 12, color: C.faint }}>{e.row ? (e.row.origin === 'bench' ? '🏆 Bench' : e.row.origin === 'both' ? '📗 Book · 🏆 Bench' : '📗 Book') : 'not in the US book'} · Thesis: {e.row ? thesisLabel(e.row) : 'n/a'}</span>
              </div>
              {(() => { const tl = display ? display(pc.ticker, catalystThesisLine(e.pc, e.row?.assessment)) : catalystThesisLine(e.pc, e.row?.assessment); return (
                <div style={{ fontSize: 13, fontWeight: 700, color: /Thesis: (weakening|broken|behind)/.test(tl) ? C.red : C.dim }}>{tl}</div>); })()}
              {e.note && <div style={{ fontSize: 12.5, color: e.decayed ? C.amber : C.faint }}>{display ? display(pc.ticker, e.note) : e.note}</div>}
              <div style={{ fontSize: 13.5, color: C.dim }}><b style={{ color: C.text }}>Mechanism:</b> {pc.mechanism}</div>
              {pc.headroom && <div style={{ fontSize: 13, color: C.dim }}>{pc.headroom}</div>}
              <div style={{ fontSize: 13, color: C.dim }}><b style={{ color: C.text }}>Runway:</b> {pc.runway.text}</div>
              <div style={{ fontSize: 13, color: C.dim }}><b style={{ color: C.text }}>Next comparable evidence:</b> {pc.nextEvidence || pc.nextMilestone || 'none evidenced'} · <b style={{ color: C.text }}>{pc.duration}</b></div>
              {pc.sfBasis && <div style={{ fontSize: 12.5, color: C.green }}>Special Focus because: {pc.sfBasis}</div>}
              {pc.managementTarget && <div style={{ fontSize: 12.5, color: C.faint }}>◌ {pc.managementTarget}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                <button onClick={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))} style={{ fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan }}>{isOpen ? 'Hide evidence' : 'Evidence · before → after'}</button>
                {btn(e.id, u, 'Confirm', 'confirmed', C.green)}{btn(e.id, u, 'Watch', 'watch', C.cyan)}{btn(e.id, u, 'Reviewed', 'reviewed', C.dim)}{btn(e.id, u, 'Dismiss', 'dismissed', C.red)}{btn(e.id, u, 'Archive', 'archived', C.faint)}
              </div>
              {isOpen && (
                <div style={{ marginTop: 6, fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
                  {pc.why.map((w, i) => <div key={i}>· {w}</div>)}
                  {pc.evidence.slice(0, 8).map((it, i) => (
                    <div key={`ev${i}`}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: it.cls === 'HARD' ? C.green : C.faint, marginRight: 5 }}>{it.cls === 'HARD' ? 'FILED FIGURE' : 'MANAGEMENT REMARK'}</span>
                      {it.text}<span style={{ color: C.faint }}> — {it.sources.map((s) => `${s.name}${s.date ? ` ${s.date}` : ''}`).join(' · ')}{it.period ? ` · ${it.period}` : ''}</span>
                    </div>
                  ))}
                  {pc.beforeAfter.map((b, i) => <div key={`ba${i}`}>{b.variable}: {b.before} → {b.current} <b>{b.direction}</b> <span style={{ color: C.faint }}>({b.source}{b.date ? ` ${b.date}` : ''})</span></div>)}
                  <div><b style={{ color: C.text }}>Would confirm it:</b> {pc.confirmWith}</div>
                  <div><b style={{ color: C.text }}>Would invalidate it:</b> {pc.invalidateIf}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {near.length > 0 && <button onClick={() => setShowNear((v) => !v)} style={{ fontSize: 12.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber }}>{showNear ? 'Hide near misses' : focusButtonWords(shown.length, near.length).near}</button>}
        {shown.length > 8 && <button onClick={() => setShowAll((v) => !v)} style={{ fontSize: 12.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.dim }}>{showAll ? 'Show top 8 Special Focus' : focusButtonWords(shown.length, near.length).all}</button>}
      </div>
      {showNear && near.length > 0 && (
        <div style={{ marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
          <div data-testid="us-near-miss-count" style={{ fontSize: 12.5, color: C.faint, marginBottom: 4 }}>
            {near.length} near miss{near.length === 1 ? '' : 'es'} (one line per company{nearInfo.excludedInQueue ? `; ${nearInfo.excludedInQueue} already in Special Focus not repeated` : ''}) — a validated mechanism missing one or two pieces of evidence.
            {onReadPrior && priorable.length > 0 && (
              <button disabled={priorRunning} onClick={() => onReadPrior(priorable)} style={{ marginLeft: 8, fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, cursor: priorRunning ? 'wait' : 'pointer', border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan }}>
                {priorRunning ? 'Reading prior quarters…' : `✨ Read prior quarter for ${priorable.length} (uses AI)`}
              </button>
            )}
          </div>
          {near.map(({ pc: pc0 }) => { const pc: PersistentCatalyst = display ? display(pc0.ticker, pc0) : pc0; return (
            <div key={pc.id} style={{ fontSize: 13, color: C.dim, padding: '3px 0', borderTop: `1px solid ${C.border}` }}>
              <button onClick={() => onJump(pc.ticker)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 900, color: C.text }}>{pc.ticker}</button>
              <span style={{ color: C.faint }}> · {persistenceWords(pc).line} · {pc.mechanism}</span>
              <div style={{ color: C.amber }}>Needs: {pc.toQualify.join(' · ')}</div>
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}
