'use client';
// ═══════════════════════════════════════════════════════════════════════════
// 🔥 SPECIAL FOCUS — a research-time allocation, never a recommendation.
//                                                                     (zzz780)
// Cross-cutting layer over the thesis queues: companies whose evidence shows
// a MECHANISM that can keep producing output for several periods. Portfolio
// detections are computed here from each holding's evidence ledger; AI Daily
// Gainers detections arrive from the shared memory (/api/v1/special-focus);
// the same TICKER:KIND id merges both. No price anywhere in this file.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { detectPersistentCatalysts, rankOf, CONFIDENCE_LABEL, type PersistentCatalyst } from '@/lib/catalyst/persistence';

const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2, var(--mc-bg-1))', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)',
  cyan: 'var(--tc-accent, #22D3EE)', green: 'var(--mc-verdict-up, #34D399)', red: 'var(--mc-verdict-down, #F87171)',
};
const STATE_WORD: Record<string, string> = { IDENTIFIED: 'Identified', VALIDATED: 'Validated', RAMPING: 'Ramping', SCALING: 'Scaling', MATURE: 'Mature', STALLING: 'Stalling', WEAKENING: 'Weakening', COMPLETED: 'Completed', DISPROVED: 'Disproved' };

export interface FocusRow {
  symbol: string; origin?: string | null; market?: string | null;
  assessment?: any; ledger?: any; graded?: any; pattern?: any;
  /** zzz784: the card's capex chain — Special Focus reads the same build state. */
  capex?: any;
}
interface Stored {
  id: string; ticker: string; kind: string; label: string; sfId: number | null; firstSeen: string; lastSeen: string;
  origins: string[]; everSpecialFocus: boolean;
  timeline: Array<{ at: string; origin: string; state: string; confidence: string; latestEvidenceDate: string | null; summary: string; specialFocus: boolean }>;
  latest: PersistentCatalyst; user: { state: string; at: string; note: string | null } | null;
  focus: { inQueue: boolean; decayed: boolean; note: string | null };
}

export function detectForRow(r: FocusRow): PersistentCatalyst[] {
  if (!r.ledger && !r.assessment) return [];
  try {
    return detectPersistentCatalysts({ ticker: r.symbol, ledger: r.ledger, assessment: r.assessment, capex: r.capex ?? null, origin: 'portfolio', quarterRevenueCr: typeof r.graded?.sales_curr_cr === 'number' ? r.graded.sales_curr_cr : null });
  } catch { return []; }
}

/** Compact strip above a holding's card — only when there is something meaningful. */
export function PersistentStrip({ pcs, onOpenFocus }: { pcs: PersistentCatalyst[]; onOpenFocus?: () => void }) {
  const best = pcs.find((p) => p.specialFocus) || pcs.find((p) => p.confidence === 'HIGH' || p.confidence === 'MEDIUM');
  if (!best) return null;
  return (
    <div data-testid="persistent-strip" style={{ border: `1px solid ${C.amber}`, borderBottom: 'none', borderRadius: '8px 8px 0 0', padding: '6px 12px', background: C.bg, fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
      <b style={{ color: C.amber }}>🔥 {best.specialFocus ? 'Persistent catalyst detected · Special Focus' : 'Persistent catalyst candidate'}</b>{' '}
      <b style={{ color: C.text }}>{best.label}</b>
      <span style={{ color: C.faint }}> · {CONFIDENCE_LABEL[best.confidence]} · {STATE_WORD[best.state]}</span>
      <div>{best.stage ? <span style={{ color: C.faint }}>Stage: {best.stage} · </span> : null}{best.mechanism}</div>
      <div style={{ color: C.faint }}>Runway: {best.runway.text}{best.nextEvidence || best.nextMilestone ? ` · Next comparable evidence: ${best.nextEvidence || best.nextMilestone}` : ''}{best.managementTarget ? ` · ${best.managementTarget}` : ''}</div>
      {onOpenFocus && best.specialFocus && <button onClick={onOpenFocus} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: C.amber }}>Open in Special Focus →</button>}
    </div>
  );
}

export function SpecialFocusPanel({ rows, ready, thesisLabel, onJump, onReadPrior, priorRunning }: {
  rows: FocusRow[]; ready: boolean;
  /** zzz781: read the prior quarter (AI, on click) for near misses — one document set per name. */
  onReadPrior?: (tickers: string[]) => void; priorRunning?: boolean;
  thesisLabel: (r: FocusRow) => string;
  onJump: (ticker: string) => void;
}) {
  const [stored, setStored] = useState<Record<string, Stored>>({});
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const upserted = useRef(false);

  const live = useMemo(() => {
    const m = new Map<string, { pc: PersistentCatalyst; row: FocusRow }>();
    for (const r of rows) for (const pc of detectForRow(r)) m.set(pc.id, { pc, row: r });
    return m;
  }, [rows]);

  const load = (json: any) => {
    const map: Record<string, Stored> = {};
    for (const rec of (json?.records || []) as Stored[]) map[rec.id] = rec;
    setStored(map);
  };
  useEffect(() => {
    fetch('/api/v1/special-focus', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(load).catch((e) => setErr(String(e?.message || e)));
  }, []);
  // Remember today's portfolio detections (once per page load, after the evidence is in).
  useEffect(() => {
    if (!ready || upserted.current || live.size === 0) return;
    upserted.current = true;
    const worth = [...live.values()].map((x) => x.pc).filter((p) => p.specialFocus || p.confidence === 'HIGH' || p.confidence === 'MEDIUM');
    fetch('/api/v1/special-focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upsert', origin: 'portfolio', catalysts: worth }) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => j && load(j)).catch(() => null);
  }, [ready, live]);

  const act = async (id: string, state: string | null) => {
    const r = await fetch('/api/v1/special-focus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'user', id, state }) }).catch(() => null);
    const j = r && r.ok ? await r.json() : null;
    if (j?.record) setStored((s) => ({ ...s, [id]: j.record }));
  };

  // The queue: live Special Focus detections + stored records still in the queue (gainers, confirmed, decayed).
  const entries = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, x] of live) if (x.pc.specialFocus) ids.add(id);
    for (const [id, s] of Object.entries(stored)) if (s.focus?.inQueue) ids.add(id);
    const rowOf = new Map(rows.map((r) => [r.symbol.toUpperCase(), r] as const));
    return [...ids].map((id) => {
      const lv = live.get(id);
      const st = stored[id];
      const pc = lv?.pc || st?.latest;
      if (!pc) return null;
      const dismissed = st?.user?.state === 'dismissed' || st?.user?.state === 'archived';
      return { id, pc, st, row: lv?.row || rowOf.get(pc.ticker) || null, dismissed, decayed: !!st?.focus?.decayed && !lv?.pc.specialFocus, note: st?.focus?.note || null };
    }).filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => (Number(b.st?.user?.state === 'confirmed') - Number(a.st?.user?.state === 'confirmed')) || (Number(a.decayed) - Number(b.decayed)) || (rankOf(b.pc) - rankOf(a.pc)));
  }, [live, stored, rows]);
  const hiddenByUser = Object.values(stored).filter((s) => s.user?.state === 'dismissed' || s.user?.state === 'archived');
  // zzz781 — NEAR MISSES: one or two pieces of evidence away. The research to do
  // is named per name; reading the prior quarter often supplies the second figure.
  const [showNear, setShowNear] = useState(false);
  const near = useMemo(() => {
    const inQ = new Set(entries.map((e) => e.pc.ticker));
    const best = new Map<string, { pc: PersistentCatalyst; row: FocusRow }>();
    for (const x of live.values()) {
      if (!x.pc.nearMiss || inQ.has(x.pc.ticker)) continue;
      const prev = best.get(x.pc.ticker);
      if (!prev || rankOf(x.pc) > rankOf(prev.pc)) best.set(x.pc.ticker, x);
    }
    return [...best.values()].sort((a, b) => rankOf(b.pc) - rankOf(a.pc));
  }, [live, entries]);
  // zzz782 — TRACKED POTENTIAL: enabling steps (MoU / JDA / LoI) remembered from
  // Daily Gainers with their conversion chain. Never in the queue on their own.
  const [showTracked, setShowTracked] = useState(false);
  const tracked = useMemo(() => Object.values(stored).filter((s) => s.latest?.kind === 'PROJECT_PIPELINE' && s.user?.state !== 'dismissed' && s.user?.state !== 'archived'), [stored]);
  const priorable = near.filter((x) => (x.row.market || 'IN') !== 'US' && Object.keys(x.row.ledger?.periods || {}).length <= 1).map((x) => x.pc.ticker);
  const shown = entries.filter((e) => !e.dismissed);
  const visible = showAll ? shown : shown.slice(0, 8);

  return (
    <div id="special-focus" style={{ border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 12px', background: C.bg, scrollMarginTop: 70 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: C.amber }}>🔥 Special Focus — {shown.length} persistent catalyst{shown.length === 1 ? '' : 's'}</span>
        <span style={{ fontSize: 12.5, color: C.faint }}>
          Where to spend extra research time: a business mechanism (capacity ramp, order book, customer ramp) with filed evidence and runway for several periods.
          Research allocation only — not a buy list, no price used. Output growth alone never qualifies; a target is a milestone, not evidence.
        </span>
      </div>
      {err && <div style={{ fontSize: 12.5, color: C.amber }}>Memory not reachable ({err}) — showing today's portfolio detections only.</div>}
      {!ready && <div style={{ fontSize: 12.5, color: C.faint }}>Waiting for the stored evidence…</div>}
      {ready && shown.length === 0 && <div style={{ fontSize: 13, color: C.dim }}>No company currently meets the Special Focus gate (a validated mechanism, filed figures, an evidence-supported runway, thesis not broken).</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map((e) => {
          const pc = e.pc;
          const isOpen = !!open[e.id];
          const portfolio = !e.row ? 'Not in book / bench (Daily Gainers)' : e.row.origin === 'both' ? '📗 Book · 🏆 Bench' : e.row.origin === 'bench' ? '🏆 Bench' : '📗 Book';
          const u = e.st?.user?.state || null;
          const btn = (label: string, state: string | null, color = C.dim) => (
            <button key={label} onClick={() => act(e.id, u === state ? null : state)} style={{ fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${u === state ? color : C.border}`, background: u === state ? `color-mix(in srgb, ${color} 16%, transparent)` : 'transparent', color }}>{u === state ? `✓ ${label}` : label}</button>
          );
          return (
            <div key={e.id} data-testid="special-focus-card" style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', opacity: e.decayed ? 0.85 : 1 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: C.amber }}>🔥 {e.st?.sfId ? `#${e.st.sfId}` : 'NEW'}</span>
                <button onClick={() => onJump(pc.ticker)} style={{ all: 'unset', cursor: 'pointer', fontSize: 15, fontWeight: 900, color: C.text }}>{pc.ticker}</button>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{pc.label}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: pc.confidence === 'HIGH' ? C.green : C.cyan }}>{CONFIDENCE_LABEL[pc.confidence]}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: pc.state === 'STALLING' || pc.state === 'WEAKENING' ? C.red : pc.state === 'MATURE' ? C.faint : C.cyan }}>{STATE_WORD[pc.state]}</span>
                <span style={{ fontSize: 12, color: C.faint }}>{portfolio} · Thesis: {e.row ? thesisLabel(e.row) : 'n/a'}{e.row?.assessment?.status ? ` · status ${String(e.row.assessment.status).replace(/_/g, ' ').toLowerCase()}` : ''}</span>
                <span style={{ fontSize: 12, color: C.faint }}>Sources: {pc.origins.map((o) => (o === 'gainers' ? 'Daily Gainers' : 'Portfolio Catalysts')).join(' + ')}</span>
              </div>
              {e.decayed && <div style={{ fontSize: 12.5, color: C.amber }}>{e.note}</div>}
              {!e.decayed && e.note && <div style={{ fontSize: 12.5, color: C.faint }}>{e.note}</div>}
              {/* zzz784: stage, source quality and the next COMPARABLE evidence —
                  the same normalized evidence the card reads (capex build state included). */}
              <div data-testid="sf-stage" style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
                <b style={{ color: C.text }}>Catalyst type:</b> {pc.label} · <b style={{ color: C.text }}>Stage:</b> {pc.stage || STATE_WORD[pc.state]} · <b style={{ color: C.text }}>Current state:</b> {STATE_WORD[pc.state]}
                {' '}· <b style={{ color: C.text }}>Evidence quality:</b> {pc.sourceQuality || `${pc.hardCount} filed mechanism figure${pc.hardCount === 1 ? '' : 's'}`}
              </div>
              <div style={{ fontSize: 13.5, color: C.dim }}><b style={{ color: C.text }}>Mechanism:</b> {pc.mechanism}</div>
              <div style={{ fontSize: 13, color: C.dim }}><b style={{ color: C.text }}>Runway:</b> {pc.runway.text}</div>
              <div style={{ fontSize: 13, color: C.dim }}><b style={{ color: C.text }}>Next comparable evidence:</b> {pc.nextEvidence || pc.nextMilestone || 'none evidenced'} · <b style={{ color: C.text }}>{pc.duration}</b></div>
              {pc.managementTarget && <div style={{ fontSize: 12.5, color: C.faint }}>◌ {pc.managementTarget}</div>}
              {pc.capexNote && <div data-testid="sf-capex-note" style={{ fontSize: 12.5, color: C.faint }}>{pc.capexNote}</div>}
              <div style={{ fontSize: 12, color: C.faint }}>Last evidence: {pc.latestEvidenceDate || 'undated'} · {pc.freshness === 'CURRENT' ? 'current' : 'historical'} · {pc.hardCount} filed mechanism figure{pc.hardCount === 1 ? '' : 's'} across {pc.distinctMetrics} metric{pc.distinctMetrics === 1 ? '' : 's'}{pc.periods.length > 1 ? ` and ${pc.periods.length} periods` : ''}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                <button onClick={() => setOpen((o) => ({ ...o, [e.id]: !isOpen }))} style={{ fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan }}>{isOpen ? 'Hide evidence' : 'Evidence · timeline · before → after'}</button>
                {e.row && <button onClick={() => onJump(pc.ticker)} style={{ fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.dim }}>Open Portfolio Catalyst</button>}
                {pc.origins.includes('gainers') && <a href="/ai-gainers" style={{ fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, border: `1px solid ${C.border}`, color: C.dim, textDecoration: 'none' }}>Open Daily Gainer event</a>}
                {btn('Confirm', 'confirmed', C.green)}{btn('Watch', 'watch', C.cyan)}{btn('Reviewed', 'reviewed', C.dim)}{btn('Dismiss', 'dismissed', C.red)}{btn('Archive', 'archived', C.faint)}
              </div>
              {isOpen && (
                <div style={{ marginTop: 6, fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 800, color: C.text }}>Why Special Focus</div>
                  {pc.why.map((w, i) => <div key={i}>· {w}</div>)}
                  <div style={{ fontWeight: 800, color: C.text, marginTop: 5 }}>Evidence (filed figures first; one figure = one item, all its sources)</div>
                  {pc.evidence.slice(0, 8).map((it, i) => (
                    <div key={i}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: it.cls === 'HARD' ? C.green : C.faint, marginRight: 5 }}>{it.cls === 'HARD' ? 'FILED FIGURE' : 'MANAGEMENT REMARK'}</span>
                      {it.text}
                      <span style={{ color: C.faint }}> — {it.sources.map((s, k) => s.url ? <a key={k} href={s.url} target="_blank" rel="noreferrer" style={{ color: C.cyan }}>{s.name}{s.date ? ` ${s.date}` : ''}</a> : <span key={k}>{s.name}{s.date ? ` ${s.date}` : ''}</span>).reduce<React.ReactNode[]>((a, n, k) => (k ? [...a, ' · ', n] : [n]), [])}{it.period ? ` · ${it.period}` : ''}</span>
                    </div>
                  ))}
                  {pc.forward.length > 0 && <>
                    <div style={{ fontWeight: 800, color: C.text, marginTop: 5 }}>Management targets (milestones, not evidence)</div>
                    {pc.forward.slice(0, 3).map((it, i) => <div key={i} style={{ color: C.faint }}>◌ {it.text} — {it.sources[0]?.name}{it.date ? ` ${it.date}` : ''}</div>)}
                  </>}
                  {pc.beforeAfter.length > 0 && (
                    <table style={{ borderCollapse: 'collapse', marginTop: 6, fontSize: 12.5 }}>
                      <thead><tr style={{ color: C.faint, textAlign: 'left' }}><th style={{ padding: '2px 8px 2px 0' }}>Variable</th><th style={{ padding: '2px 8px' }}>Before</th><th style={{ padding: '2px 8px' }}>Current</th><th style={{ padding: '2px 8px' }}>Dir</th><th style={{ padding: '2px 8px' }}>Source</th></tr></thead>
                      <tbody>{pc.beforeAfter.map((b, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}><td style={{ padding: '2px 8px 2px 0', color: C.text }}>{b.variable}</td><td style={{ padding: '2px 8px' }}>{b.before}</td><td style={{ padding: '2px 8px' }}>{b.current}</td><td style={{ padding: '2px 8px', fontWeight: 900, color: b.direction === '↑' ? C.green : b.direction === '↓' ? C.red : C.faint }}>{b.direction}</td><td style={{ padding: '2px 8px', color: C.faint }}>{b.source}{b.date ? ` ${b.date}` : ''}</td></tr>
                      ))}</tbody>
                    </table>
                  )}
                  <div style={{ marginTop: 5 }}><b style={{ color: C.text }}>Already happened:</b> {pc.happened.join(' · ') || '—'}</div>
                  <div><b style={{ color: C.text }}>Not yet:</b> {pc.notYet.join(' · ') || '—'}</div>
                  <div><b style={{ color: C.text }}>Would confirm it:</b> {pc.confirmWith}</div>
                  <div><b style={{ color: C.text }}>Would invalidate it:</b> {pc.invalidateIf}</div>
                  {pc.temporarySignals.length > 0 && <div style={{ color: C.amber }}>Temporary signals on file: {pc.temporarySignals.join(' · ')}</div>}
                  {(e.st?.timeline?.length || 0) > 0 && <>
                    <div style={{ fontWeight: 800, color: C.text, marginTop: 5 }}>Catalyst timeline (memory — first seen {String(e.st!.firstSeen).slice(0, 10)})</div>
                    {e.st!.timeline.slice(-8).map((t, i) => <div key={i} style={{ color: C.faint }}>{String(t.at).slice(0, 10)} · {t.origin === 'gainers' ? 'Daily Gainers' : 'Portfolio'} · {STATE_WORD[t.state] || t.state} · {t.confidence.toLowerCase().replace('_', ' ')}{t.specialFocus ? ' · Special Focus' : ''} — {t.summary}</div>)}
                  </>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {near.length > 0 && <button onClick={() => setShowNear((v) => !v)} style={{ fontSize: 12.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber }}>{showNear ? 'Hide near misses' : `${near.length} near miss${near.length === 1 ? '' : 'es'} — one piece of evidence away`}</button>}
        {tracked.length > 0 && <button onClick={() => setShowTracked((v) => !v)} style={{ fontSize: 12.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px dashed ${C.cyan}`, background: 'transparent', color: C.cyan }}>{showTracked ? 'Hide tracked potential' : `◌ ${tracked.length} tracked potential catalyst${tracked.length === 1 ? '' : 's'} (enabling steps)`}</button>}
        {shown.length > 8 && <button onClick={() => setShowAll((v) => !v)} style={{ fontSize: 12.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.dim }}>{showAll ? 'Show top 8' : `Show all ${shown.length}`}</button>}
        {hiddenByUser.length > 0 && <button onClick={() => setShowHidden((v) => !v)} style={{ fontSize: 12.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.faint }}>{showHidden ? 'Hide' : `${hiddenByUser.length} dismissed / archived`}</button>}
      </div>
      {showNear && near.length > 0 && (
        <div style={{ marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
          <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 4 }}>
            Near misses — a validated mechanism is missing one or two pieces of evidence. Not Special Focus; the line says exactly what would qualify it.
            {onReadPrior && priorable.length > 0 && (
              <button disabled={priorRunning} onClick={() => onReadPrior(priorable)} title="Reads each name's PRIOR quarter documents (one AI read per name, on this click only). Two periods give the before → after and the second figure most near misses lack."
                style={{ marginLeft: 8, fontSize: 12, fontWeight: 800, padding: '2px 9px', borderRadius: 999, cursor: priorRunning ? 'wait' : 'pointer', border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan }}>
                {priorRunning ? 'Reading prior quarters…' : `✨ Read prior quarter for ${priorable.length} (uses AI)`}
              </button>
            )}
          </div>
          {near.map(({ pc }) => (
            <div key={pc.id} style={{ fontSize: 13, color: C.dim, padding: '3px 0', borderTop: `1px solid ${C.border}` }}>
              <button onClick={() => onJump(pc.ticker)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 900, color: C.text }}>{pc.ticker}</button>
              <span style={{ color: C.faint }}> · {pc.label} · {STATE_WORD[pc.state]} · {pc.mechanism}</span>
              <div style={{ color: C.amber }}>Needs: {pc.toQualify.join(' · ')}</div>
            </div>
          ))}
        </div>
      )}
      {showTracked && tracked.length > 0 && (
        <div style={{ marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
          <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 4 }}>Tracked potential catalysts — an MoU / JDA / LoI books nothing yet. Each is kept with its chain so the next filing (definitive agreement, approvals, launch…) can be checked against it. Not Special Focus.</div>
          {tracked.map((t) => (
            <div key={t.id} style={{ fontSize: 13, color: C.dim, padding: '3px 0', borderTop: `1px solid ${C.border}` }}>
              <b style={{ color: C.text }}>{t.latest.ticker}</b> <span style={{ color: C.faint }}>· first seen {String(t.latest.firstEvidenceDate || '').slice(0, 10) || 'n/a'} · from Daily Gainers</span>
              <div>{t.latest.mechanism}</div>
              {t.latest.nextMilestone && <div style={{ color: C.cyan }}>Next milestone: {t.latest.nextMilestone}</div>}
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <button onClick={() => act(t.id, 'watch')} style={{ all: 'unset', cursor: 'pointer', color: C.cyan, fontWeight: 800, fontSize: 12 }}>Watch</button>
                <button onClick={() => act(t.id, 'dismissed')} style={{ all: 'unset', cursor: 'pointer', color: C.faint, fontWeight: 800, fontSize: 12 }}>Dismiss</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {showHidden && hiddenByUser.map((s) => (
        <div key={s.id} style={{ fontSize: 12.5, color: C.faint }}>{s.ticker} · {s.label} · {s.user?.state} {String(s.user?.at || '').slice(0, 10)} <button onClick={() => act(s.id, null)} style={{ all: 'unset', cursor: 'pointer', color: C.cyan, fontWeight: 800 }}>restore</button></div>
      ))}
    </div>
  );
}
